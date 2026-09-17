import type { AlertItem, DisplayLevel, MissionModel, PriorityLevel, Risk, Survivor } from '../types';
import { LEVEL_ORDER } from './levels';

/** No MissionStatus for this long (it is published ~1 Hz, §7.2) → treat the drone link as down. */
export const STALE_AFTER_MS = 5000;

export type LinkDisplay = 'CONNECTED' | 'OFFLINE' | 'SYNCING';

export interface LinkView {
  state: LinkDisplay;
  detail: string;
}

/**
 * Decides what the top-bar connectivity indicator shows (§14.5).
 * Priority: backend explicitly syncing → SYNCING; socket down, drone link
 * reported down, or telemetry gone stale → OFFLINE; otherwise CONNECTED.
 */
export function deriveLink(model: MissionModel, now: number): LinkView {
  if (model.source === 'websocket' && model.socket !== 'open') {
    return {
      state: 'OFFLINE',
      detail: model.socket === 'connecting' ? 'Connecting to command-center backend…' : 'Backend unreachable — retrying every 3 s'
    };
  }
  if (model.sync?.state === 'SYNCING') {
    const n = model.sync.synced_events;
    return { state: 'SYNCING', detail: n != null ? `${n} queued events received so far` : 'Receiving queued events' };
  }
  const queued = model.sync?.queued_events;
  const queuedText = queued != null ? ` — ${queued} event${queued === 1 ? '' : 's'} queued` : '';
  if (model.sync?.state === 'OFFLINE' || model.mission?.linkConnected === false) {
    return { state: 'OFFLINE', detail: `Drone logging locally${queuedText}` };
  }
  const missionLive = model.mission && model.mission.state !== 'COMPLETE' && model.mission.state !== 'IDLE';
  if (missionLive && model.mission && now - model.mission.receivedAt > STALE_AFTER_MS) {
    const secs = Math.round((now - model.mission.receivedAt) / 1000);
    return { state: 'OFFLINE', detail: `No drone status for ${secs} s` };
  }
  if (!model.mission) return { state: 'CONNECTED', detail: 'Waiting for mission status' };
  return { state: 'CONNECTED', detail: 'Live link to drone' };
}

export interface PriorityRow {
  survivor: Survivor;
  risk: Risk | null;
}

/**
 * Survivor priority list. Uses the backend's ranking when one was sent
 * (§6.4 "rescue-priority sorting endpoint"); otherwise sorts by the backend's
 * risk scores. The dashboard never computes scores itself — survivors the
 * backend hasn't scored yet sit at the bottom as "unscored".
 */
export function derivePriority(model: MissionModel): PriorityRow[] {
  const rows: PriorityRow[] = Object.values(model.survivors).map((s) => ({ survivor: s, risk: model.risks[s.id] ?? null }));
  const rankIndex = new Map<string, number>();
  model.ranking?.forEach((id, i) => rankIndex.set(id, i));
  return rows.sort((a, b) => {
    const ra = rankIndex.get(a.survivor.id);
    const rb = rankIndex.get(b.survivor.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    if (a.risk && b.risk) return b.risk.score - a.risk.score || LEVEL_ORDER[a.risk.level] - LEVEL_ORDER[b.risk.level];
    if (a.risk) return -1;
    if (b.risk) return 1;
    return a.survivor.seq - b.survivor.seq;
  });
}

export function survivorLevel(model: MissionModel, id: string): PriorityLevel | null {
  return model.risks[id]?.level ?? null;
}

export function hazardCounts(model: MissionModel): Record<string, number> {
  const counts: Record<string, number> = {};
  Object.values(model.hazards).forEach((h) => {
    counts[h.hazardType] = (counts[h.hazardType] ?? 0) + 1;
  });
  return counts;
}

export interface LogEntry {
  id: string;
  time: number;
  receivedAt: number;
  kind: 'survivor' | 'hazard' | 'alert';
  level?: AlertItem['level'];
  text: string;
}

/**
 * Keeps alert colours consistent with the map and priority list (§14.4):
 * a SURVIVOR_DETECTED alert takes the priority level of the survivor at the
 * same coordinates once the backend has scored it.
 */
export function alertDisplayLevel(model: MissionModel, alert: AlertItem): DisplayLevel {
  if (alert.alertType !== 'SURVIVOR_DETECTED' || alert.lat == null || alert.lng == null) return alert.level;
  const match = Object.values(model.survivors).find(
    (s) => Math.abs(s.lat - alert.lat!) < 1e-6 && Math.abs(s.lng - alert.lng!) < 1e-6
  );
  return (match && model.risks[match.id]?.level) || alert.level;
}
