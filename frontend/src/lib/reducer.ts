import type { FeedSource, MissionModel, Risk, ServerMessage } from '../types';
import { HAZARD_TYPES } from '../types';
import { alertLevel, isPriorityLevel } from './levels';
import { stampToMs } from './time';

const MAX_ALERTS = 200;
const MAX_TRACK_POINTS = 2000;

export function createInitialModel(source: FeedSource): MissionModel {
  return {
    source,
    socket: source === 'simulator' ? 'open' : 'connecting',
    survivors: {},
    hazards: {},
    risks: {},
    ranking: null,
    alerts: [],
    mission: null,
    missionStartedAt: null,
    pose: null,
    track: [],
    sync: null,
    route: null,
    video: { rgbUrl: null, thermalUrl: null, rgbFrame: null, thermalFrame: null },
    lastMessageAt: null,
    messageCounts: {},
    survivorSeq: 0
  };
}

function toRisk(r: { detection_id: string; score: number; priority_level: string; reason: string }): Risk | null {
  if (!r || typeof r.detection_id !== 'string' || !isPriorityLevel(r.priority_level)) return null;
  return {
    detectionId: r.detection_id,
    score: Number(r.score) || 0,
    level: r.priority_level,
    reason: typeof r.reason === 'string' ? r.reason : ''
  };
}

function applyOne(model: MissionModel, msg: ServerMessage, now: number): MissionModel {
  switch (msg.type) {
    case 'detection': {
      const d = msg.data;
      // §7.1: detection_type is "person" or a hazard class — route hazards to the hazard layer.
      if (d.detection_type !== 'person') {
        if ((HAZARD_TYPES as string[]).includes(d.detection_type)) {
          return applyOne(
            model,
            {
              type: 'hazard',
              data: {
                id: d.id,
                hazard_type: d.detection_type,
                confidence: d.confidence,
                latitude: d.latitude,
                longitude: d.longitude,
                stamp: d.stamp
              }
            },
            now
          );
        }
        return model;
      }
      const existing = model.survivors[d.id];
      const seq = existing ? existing.seq : model.survivorSeq + 1;
      return {
        ...model,
        survivorSeq: existing ? model.survivorSeq : seq,
        survivors: {
          ...model.survivors,
          [d.id]: {
            id: d.id,
            confidence: Number(d.confidence) || 0,
            thermalConfirmed: Boolean(d.thermal_confirmed),
            lat: d.latitude,
            lng: d.longitude,
            altitude: d.altitude,
            time: stampToMs(d.stamp, now),
            receivedAt: existing?.receivedAt ?? now,
            seq
          }
        }
      };
    }
    case 'hazard': {
      const h = msg.data;
      const existing = model.hazards[h.id];
      return {
        ...model,
        hazards: {
          ...model.hazards,
          [h.id]: {
            id: h.id,
            hazardType: h.hazard_type,
            confidence: Number(h.confidence) || 0,
            lat: h.latitude,
            lng: h.longitude,
            time: stampToMs(h.stamp, now),
            receivedAt: existing?.receivedAt ?? now
          }
        }
      };
    }
    case 'risk_score': {
      const risk = toRisk(msg.data);
      if (!risk) return model;
      return { ...model, risks: { ...model.risks, [risk.detectionId]: risk } };
    }
    case 'priority': {
      const risks = { ...model.risks };
      const ranking: string[] = [];
      (msg.data.ranked ?? []).forEach((r) => {
        const risk = toRisk(r);
        if (!risk) return;
        risks[risk.detectionId] = risk;
        ranking.push(risk.detectionId);
      });
      return { ...model, risks, ranking };
    }
    case 'alert': {
      const a = msg.data;
      // §13.4: dedupe by id — a retried sync batch must not duplicate alerts.
      if (model.alerts.some((x) => x.id === a.alert_id)) return model;
      const alerts = [
        ...model.alerts,
        {
          id: a.alert_id,
          alertType: a.alert_type,
          level: alertLevel(a.alert_type),
          message: a.message,
          lat: a.latitude,
          lng: a.longitude,
          time: stampToMs(a.stamp, now),
          receivedAt: now
        }
      ]
        // §13.6: order by when it happened, not when it arrived.
        .sort((x, y) => y.time - x.time)
        .slice(0, MAX_ALERTS);
      return { ...model, alerts };
    }
    case 'mission_status': {
      const s = msg.data;
      const time = stampToMs(s.stamp, now);
      const isNewMission = model.mission && model.mission.missionId !== s.mission_id;
      const base = isNewMission ? { ...createInitialModel(model.source), socket: model.socket, messageCounts: model.messageCounts } : model;
      let missionStartedAt = base.missionStartedAt;
      if (s.state === 'IDLE') missionStartedAt = null;
      else if (missionStartedAt == null) missionStartedAt = time;
      const linkConnected = s.link_connected !== false;
      // A fresh "link up" status supersedes a leftover OFFLINE sync state.
      const sync = linkConnected && base.sync?.state === 'OFFLINE' ? null : base.sync;
      return {
        ...base,
        sync,
        missionStartedAt,
        mission: {
          missionId: s.mission_id,
          state: s.state,
          battery: Number(s.battery_percent) || 0,
          coverage: Number(s.coverage_percent) || 0,
          linkConnected,
          navMode: s.nav_mode,
          time,
          receivedAt: now
        }
      };
    }
    case 'drone_pose': {
      const p = msg.data;
      if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return model;
      const point: [number, number] = [p.latitude, p.longitude];
      return {
        ...model,
        pose: {
          lat: p.latitude,
          lng: p.longitude,
          altitude: p.altitude,
          heading: p.heading_deg,
          speed: p.speed_mps,
          gpsFix: p.gps_fix,
          time: stampToMs(p.stamp, now)
        },
        track: [...model.track, point].slice(-MAX_TRACK_POINTS)
      };
    }
    case 'sync_status':
      return { ...model, sync: msg.data };
    case 'route':
      return { ...model, route: Array.isArray(msg.data?.points) ? msg.data : null };
    case 'video_status':
      return {
        ...model,
        video: { ...model.video, rgbUrl: msg.data.rgb_url ?? null, thermalUrl: msg.data.thermal_url ?? null }
      };
    case 'video_frame': {
      const src = `data:image/jpeg;base64,${msg.data.jpeg_base64}`;
      return {
        ...model,
        video: msg.data.channel === 'thermal' ? { ...model.video, thermalFrame: src } : { ...model.video, rgbFrame: src }
      };
    }
    case 'batch':
      return (msg.data ?? []).reduce((m, inner) => applyOne(m, inner, now), model);
    default:
      return model;
  }
}

/** Pure reducer: apply one server message to the model. Unknown types are ignored. */
export function applyMessage(model: MissionModel, msg: ServerMessage, now = Date.now()): MissionModel {
  if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return model;
  const next = applyOne(model, msg, now);
  const counts = { ...next.messageCounts, [msg.type]: (next.messageCounts[msg.type] ?? 0) + 1 };
  return { ...next, lastMessageAt: now, messageCounts: counts };
}

/** Parses a raw WebSocket frame. Returns null (and logs) for malformed input. */
export function parseFrame(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === 'string') return parsed as ServerMessage;
  } catch {
    /* fall through */
  }
  console.warn('[aerosar] ignored malformed WebSocket frame', raw);
  return null;
}
