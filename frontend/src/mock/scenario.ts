import type { AlertMsg, MissionStateName, NavMode, ServerMessage } from '../types';
import { scoreSurvivor } from './riskScore';

/* ==========================================================================
   Demo scenario engine — DEMO-ONLY DATA (master doc §2 "three-tier rule").

   Plays master doc §15.1's recommended demo: Scenario 2 (fire + smoke +
   survivor → CRITICAL) and Scenario 5 (network cut → offline queue → sync)
   in one continuous flight, plus a GPS-denied strip (Scenario 4), a flood
   survivor (Scenario 1) and a damaged structure (Scenario 3).

   It emits exactly the WebSocket messages described in WS_CONTRACT.md, so
   the dashboard code path is identical to the real backend. It runs in the
   browser (no backend) and inside `npm run mock:server` (real WebSocket).
   It has no DOM dependencies on purpose.
   ========================================================================== */

export const ORIGIN = { lat: 26.2389, lng: 73.0243 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Local world meters (x = east, y = north) → [lat, lng]. Mirrors the 1:1 Webots mapping in §1 row 5. */
export function toLatLng(x: number, y: number): [number, number] {
  return [ORIGIN.lat + y / M_PER_DEG_LAT, ORIGIN.lng + x / M_PER_DEG_LNG];
}

type ObjectKind = 'person' | 'fire' | 'smoke' | 'flood' | 'debris' | 'damaged_structure';
interface WorldObject {
  key: string;
  kind: ObjectKind;
  x: number;
  y: number;
  confidence: number;
  thermal?: boolean;
}

/** Numbers chosen so the §11.3 formula lands on CRITICAL / HIGH / MEDIUM / LOW. */
const WORLD: WorldObject[] = [
  { key: 'survivor-d', kind: 'person', x: 15, y: 10, confidence: 0.55 },
  { key: 'survivor-a', kind: 'person', x: 69, y: 18.5, confidence: 0.87, thermal: true },
  { key: 'fire', kind: 'fire', x: 70, y: 20, confidence: 0.93 },
  { key: 'smoke', kind: 'smoke', x: 74, y: 26, confidence: 0.81 },
  { key: 'structure', kind: 'damaged_structure', x: 84, y: 64, confidence: 0.77 },
  { key: 'flood', kind: 'flood', x: 20, y: 60, confidence: 0.9 },
  { key: 'survivor-b', kind: 'person', x: 26, y: 63, confidence: 0.74, thermal: true },
  { key: 'debris', kind: 'debris', x: 60, y: 76, confidence: 0.72 },
  { key: 'survivor-c', kind: 'person', x: 90, y: 70, confidence: 0.61 }
];

const AREA = { w: 100, h: 80 };
const LANES_Y = [8, 24, 40, 56, 72];
const GPS_DENIED_ZONE = { x0: 62, x1: 100, y0: 34, y1: 46 };
const SENSOR_RADIUS_M = 13;
const CLUSTER_RADIUS_M = 10;
const CELL_M = 5;
const CRUISE_ALT_M = 30;
const SPEED_MPS = 8;
/** Auto network cut starts when the drone begins the last lane and lasts this long. */
const AUTO_CUT_LANE_INDEX = LANES_Y.length - 1;
const AUTO_CUT_DURATION_S = 14;

function buildSearchPath(): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  LANES_Y.forEach((y, i) => {
    const [a, b] = i % 2 === 0 ? [5, 95] : [95, 5];
    pts.push({ x: a, y }, { x: b, y });
  });
  pts.push({ x: 0, y: 0 });
  return pts;
}

export interface ScenarioOptions {
  /** Start a mission immediately (default true). */
  autoStart?: boolean;
  /** Cut and restore the link automatically on the last lane (default true). */
  autoLinkCut?: boolean;
  /** Time multiplier, e.g. 2 = twice as fast (default 1). */
  speed?: number;
}

export interface ScenarioControls {
  start(): void;
  abort(): void;
  cutLink(): void;
  restoreLink(): void;
  isLinkUp(): boolean;
  stop(): void;
}

export function createScenario(emit: (msg: ServerMessage) => void, options: ScenarioOptions = {}): ScenarioControls {
  const speed = options.speed ?? 1;
  const autoLinkCut = options.autoLinkCut ?? true;
  const TICK_MS = 200;

  let missionId = '';
  let state: MissionStateName = 'IDLE';
  let idleUntil = 0;
  let pos = { x: 0, y: 0 };
  let heading = 0;
  let path = buildSearchPath();
  let wp = 0;
  let elapsed = 0; // sim seconds since SEARCHING began
  let battery = 100;
  let covered = new Set<string>();
  let found = new Set<string>();
  let survivorOrder: string[] = [];
  let idFor = new Map<string, string>();
  let risks = new Map<string, { score: number; level: string; reason: string }>();
  let criticalAlerted = new Set<string>();
  let navMode: NavMode = 'GPS_NAV';
  let counter = 0;
  let lastStatusAt = 0;
  let autoCutDone = false;

  // Link simulation (drone ↔ command center)
  let linkUp = true;
  let offlineQueue: ServerMessage[] = [];
  let syncing = false;
  let autoRestoreAt: number | null = null;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  const nowIso = () => new Date().toISOString();
  const nextId = (p: string) => `${missionId}-${p}-${(++counter).toString().padStart(3, '0')}`;
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      pendingTimers.delete(t);
      fn();
    }, ms);
    pendingTimers.add(t);
  };

  /** Drone-side event: sent if the link is up, otherwise written to the local queue (§13.1). */
  function droneEvent(msg: ServerMessage) {
    if (linkUp && !syncing) emit(msg);
    else offlineQueue.push(msg);
  }

  function droneAlert(alert_type: string, message: string, x?: number, y?: number) {
    const [lat, lng] = x != null && y != null ? toLatLng(x, y) : [undefined, undefined];
    const data: AlertMsg = { alert_id: nextId('alert'), alert_type, message, latitude: lat, longitude: lng, stamp: nowIso() };
    droneEvent({ type: 'alert', data });
  }

  function statusMsg(): ServerMessage {
    return {
      type: 'mission_status',
      data: {
        mission_id: missionId,
        state,
        battery_percent: Math.round(battery * 10) / 10,
        coverage_percent: Math.round((covered.size / ((AREA.w / CELL_M) * (AREA.h / CELL_M))) * 1000) / 10,
        link_connected: linkUp,
        nav_mode: navMode,
        stamp: nowIso()
      }
    };
  }

  function rescoreAll() {
    const survivors = WORLD.filter((o) => o.kind === 'person' && found.has(o.key));
    const hazards = WORLD.filter((o) => o.kind !== 'person' && found.has(o.key));
    const changed: string[] = [];
    survivors.forEach((s) => {
      const distances = hazards.map((h) => Math.hypot(h.x - s.x, h.y - s.y));
      const cluster = survivors.filter((o) => Math.hypot(o.x - s.x, o.y - s.y) <= CLUSTER_RADIUS_M).length;
      const r = scoreSurvivor({
        confidence: s.confidence,
        thermalConfirmed: Boolean(s.thermal),
        distanceToHazard: distances.length ? Math.min(...distances) : null,
        clusterCount: cluster
      });
      const id = idFor.get(s.key)!;
      const prev = risks.get(id);
      if (!prev || prev.score !== r.score) {
        risks.set(id, r);
        changed.push(id);
        droneEvent({ type: 'risk_score', data: { detection_id: id, score: r.score, priority_level: r.level, reason: r.reason } });
        if (r.level === 'CRITICAL' && !criticalAlerted.has(id)) {
          criticalAlerted.add(id);
          const label = `Survivor #${survivorOrder.indexOf(s.key) + 1}`;
          const nearest = hazards.length ? hazards[distances.indexOf(Math.min(...distances))] : null;
          const near = nearest ? ` near ${nearest.kind.replace('_', ' ')}` : '';
          droneAlert('CRITICAL_PRIORITY', `${label} — CRITICAL priority${near}`, s.x, s.y);
        }
      }
    });
    if (changed.length) {
      const ranked = [...risks.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .map(([detection_id, r]) => ({
          detection_id,
          score: r.score,
          priority_level: r.level as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
          reason: r.reason
        }));
      droneEvent({ type: 'priority', data: { ranked } });
    }
  }

  function detect(o: WorldObject) {
    found.add(o.key);
    const [lat, lng] = toLatLng(o.x, o.y);
    if (o.kind === 'person') {
      const id = nextId('det');
      idFor.set(o.key, id);
      survivorOrder.push(o.key);
      droneEvent({
        type: 'detection',
        data: {
          id,
          detection_type: 'person',
          confidence: o.confidence,
          bbox_x: 0.42,
          bbox_y: 0.38,
          bbox_w: 0.12,
          bbox_h: 0.22,
          thermal_confirmed: Boolean(o.thermal),
          latitude: lat,
          longitude: lng,
          altitude: 0,
          stamp: nowIso()
        }
      });
      const n = survivorOrder.length;
      droneAlert(
        'SURVIVOR_DETECTED',
        `Survivor #${n} detected${o.thermal ? ' (thermal-confirmed)' : ''} — confidence ${o.confidence.toFixed(2)}`,
        o.x,
        o.y
      );
    } else {
      const id = nextId('haz');
      idFor.set(o.key, id);
      droneEvent({ type: 'hazard', data: { id, hazard_type: o.kind, confidence: o.confidence, latitude: lat, longitude: lng, stamp: nowIso() } });
      const label = o.kind.replace('_', ' ');
      droneAlert('HAZARD_DETECTED', `Hazard: ${label} — confidence ${o.confidence.toFixed(2)}`, o.x, o.y);
    }
    rescoreAll();
  }

  function markCoverage() {
    for (let cx = 0; cx < AREA.w / CELL_M; cx++) {
      for (let cy = 0; cy < AREA.h / CELL_M; cy++) {
        const mx = cx * CELL_M + CELL_M / 2;
        const my = cy * CELL_M + CELL_M / 2;
        if (Math.hypot(mx - pos.x, my - pos.y) <= SENSOR_RADIUS_M) covered.add(`${cx}:${cy}`);
      }
    }
  }

  function reset() {
    missionId = `SAR-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
    state = 'IDLE';
    pos = { x: 0, y: 0 };
    heading = 0;
    path = buildSearchPath();
    wp = 0;
    elapsed = 0;
    battery = 100;
    covered = new Set();
    found = new Set();
    survivorOrder = [];
    idFor = new Map();
    risks = new Map();
    criticalAlerted = new Set();
    navMode = 'GPS_NAV';
    counter = 0;
    autoCutDone = false;
    autoRestoreAt = null;
    linkUp = true;
    syncing = false;
    offlineQueue = [];
  }

  function start() {
    if (state === 'SEARCHING' || state === 'RETURNING') return;
    reset();
    idleUntil = Date.now() + 1500 / speed;
    emit(statusMsg());
    emit({ type: 'sync_status', data: { state: 'CONNECTED' } });
    emit({ type: 'video_status', data: { rgb_url: null, thermal_url: null } });
    emit({ type: 'drone_pose', data: poseData() });
  }

  function abort() {
    if (state !== 'SEARCHING') return;
    state = 'RETURNING';
    path = [{ x: 0, y: 0 }];
    wp = 0;
    droneAlert('MISSION_ABORTED', 'Mission aborted by operator — returning to launch');
  }

  function cutLink() {
    if (!linkUp) return;
    linkUp = false;
    // Command-center side notices immediately and says so (§13.8 step 3).
    emit({ type: 'alert', data: { alert_id: nextId('alert'), alert_type: 'LINK_LOST', message: 'Drone link lost — drone continues logging locally', stamp: nowIso() } });
    emit(statusMsg());
    emit({ type: 'sync_status', data: { state: 'OFFLINE', queued_events: offlineQueue.length } });
  }

  function restoreLink() {
    if (linkUp) return;
    linkUp = true;
    syncing = true;
    const queue = offlineQueue;
    offlineQueue = [];
    emit({ type: 'sync_status', data: { state: 'SYNCING', queued_events: queue.length, synced_events: 0 } });
    // Drain oldest-first with a small delay so the SYNCING state is visible on screen (§14.5).
    const stepMs = 160;
    queue.forEach((msg, i) => {
      later(() => {
        emit(msg);
        emit({ type: 'sync_status', data: { state: 'SYNCING', queued_events: queue.length - i - 1, synced_events: i + 1 } });
      }, 400 + i * stepMs);
    });
    later(() => {
      syncing = false;
      const backlog = offlineQueue; // events that happened while draining
      offlineQueue = [];
      backlog.forEach(emit);
      emit({ type: 'sync_status', data: { state: 'CONNECTED', synced_events: queue.length } });
      emit({
        type: 'alert',
        data: { alert_id: nextId('alert'), alert_type: 'LINK_RESTORED', message: `Link restored — ${queue.length} queued events synced`, stamp: nowIso() }
      });
      emit(statusMsg());
    }, 400 + queue.length * stepMs + 300);
  }

  function poseData() {
    const [lat, lng] = toLatLng(pos.x, pos.y);
    const flying = state === 'SEARCHING' || state === 'RETURNING';
    return {
      latitude: lat,
      longitude: lng,
      altitude: flying ? CRUISE_ALT_M : 0,
      heading_deg: Math.round(heading),
      speed_mps: flying ? SPEED_MPS : 0,
      gps_fix: navMode === 'GPS_NAV',
      stamp: nowIso()
    };
  }

  function tick() {
    const nowMs = Date.now();
    const dt = (TICK_MS / 1000) * speed;

    if (state === 'IDLE') {
      if (missionId && nowMs >= idleUntil) {
        state = 'SEARCHING';
        droneAlert('MISSION_STARTED', `Mission ${missionId} started — autonomous search pattern`);
        emit(statusMsg());
      }
      return;
    }
    if (state === 'COMPLETE') return;

    // Move along the path.
    let remaining = SPEED_MPS * dt;
    while (remaining > 0 && wp < path.length) {
      const target = path[wp];
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6) heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      if (dist <= remaining) {
        pos = { ...target };
        remaining -= dist;
        wp += 1;
        if (autoLinkCut && !autoCutDone && state === 'SEARCHING' && wp === 1 + AUTO_CUT_LANE_INDEX * 2) {
          autoCutDone = true;
          cutLink();
          autoRestoreAt = nowMs + (AUTO_CUT_DURATION_S * 1000) / speed;
        }
      } else {
        pos = { x: pos.x + (dx / dist) * remaining, y: pos.y + (dy / dist) * remaining };
        remaining = 0;
      }
    }

    elapsed += dt;
    battery = Math.max(5, 100 - elapsed * 0.4); // linear drain (§17)

    if (state === 'SEARCHING') {
      markCoverage();
      if (wp === path.length - 1) state = 'RETURNING'; // last waypoint is "home"
      WORLD.forEach((o) => {
        if (!found.has(o.key) && Math.hypot(o.x - pos.x, o.y - pos.y) <= SENSOR_RADIUS_M) detect(o);
      });
    }

    const inDenied =
      pos.x >= GPS_DENIED_ZONE.x0 && pos.x <= GPS_DENIED_ZONE.x1 && pos.y >= GPS_DENIED_ZONE.y0 && pos.y <= GPS_DENIED_ZONE.y1;
    if (inDenied && navMode === 'GPS_NAV') {
      navMode = 'GPS_DENIED';
      droneAlert('GPS_LOST', 'GPS signal lost — local navigation active');
    } else if (!inDenied && navMode === 'GPS_DENIED') {
      navMode = 'GPS_NAV';
      droneAlert('GPS_RESTORED', 'GPS signal restored — GPS navigation resumed');
    }

    if (wp >= path.length && state === 'RETURNING') {
      state = 'COMPLETE';
      droneAlert('MISSION_COMPLETE', `Mission complete — ${Math.round((covered.size / ((AREA.w / CELL_M) * (AREA.h / CELL_M))) * 100)}% of search area covered`);
    }

    // Live telemetry only flows while the link is up.
    if (linkUp) emit({ type: 'drone_pose', data: poseData() });
    if (nowMs - lastStatusAt >= 1000 / Math.max(1, speed) || state === 'COMPLETE') {
      lastStatusAt = nowMs;
      if (linkUp) emit(statusMsg());
      else emit({ type: 'sync_status', data: { state: 'OFFLINE', queued_events: offlineQueue.length } });
    }

    if (autoRestoreAt != null && nowMs >= autoRestoreAt) {
      autoRestoreAt = null;
      restoreLink();
    }
  }

  const interval = setInterval(tick, TICK_MS);
  if (options.autoStart ?? true) start();

  return {
    start,
    abort,
    cutLink: () => {
      autoRestoreAt = null;
      cutLink();
    },
    restoreLink: () => {
      autoRestoreAt = null;
      restoreLink();
    },
    isLinkUp: () => linkUp,
    stop: () => {
      clearInterval(interval);
      pendingTimers.forEach(clearTimeout);
      pendingTimers.clear();
    }
  };
}

