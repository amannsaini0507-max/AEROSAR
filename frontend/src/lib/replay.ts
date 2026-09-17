import type { FeedSource, MissionModel, ServerMessage } from '../types';
import { applyMessage, createInitialModel } from './reducer';
import { stampToMs } from './time';

export interface ReplayEvent {
  id: string;
  msg: ServerMessage;
  /** When it happened (drone clock), falling back to when it was received. */
  time: number;
}

/** Row shape of the backend events table (master doc §13.2), as served by /api/missions/{id}/history. */
export interface HistoryEventRow {
  event_id: string;
  event_type: string;
  payload: unknown;
  created_at: string | number;
  synced_at?: string | number | null;
}

const EVENT_TYPE_TO_MESSAGE: Record<string, ServerMessage['type']> = {
  detection: 'detection',
  hazard: 'hazard',
  alert: 'alert',
  status: 'mission_status',
  mission_status: 'mission_status',
  risk_score: 'risk_score',
  priority: 'priority',
  drone_pose: 'drone_pose',
  route: 'route'
};

function timeOf(msg: ServerMessage, fallback: number): number {
  const data = msg.data as { stamp?: unknown } | undefined;
  return data && 'stamp' in data ? stampToMs(data.stamp as never, fallback) : fallback;
}

export function fromSessionLog(log: { msg: ServerMessage; receivedAt: number }[]): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  log.forEach(({ msg, receivedAt }, i) => {
    if (msg.type === 'batch') {
      msg.data.forEach((inner, j) => out.push({ id: `s${i}.${j}`, msg: inner, time: timeOf(inner, receivedAt) }));
    } else if (msg.type !== 'video_frame' && msg.type !== 'sync_status') {
      out.push({ id: `s${i}`, msg, time: timeOf(msg, receivedAt) });
    }
  });
  return sortEvents(out);
}

export function fromHistoryRows(rows: HistoryEventRow[]): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  rows.forEach((row) => {
    const type = EVENT_TYPE_TO_MESSAGE[row.event_type];
    if (!type) return;
    let data = row.payload;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    const created = stampToMs(row.created_at as never, Date.now());
    out.push({ id: row.event_id, msg: { type, data } as ServerMessage, time: created });
  });
  return sortEvents(out);
}

/**
 * Stable sort by event time. Risk scores and priority lists have no stamp
 * of their own, so when times tie the original order is kept.
 */
function sortEvents(events: ReplayEvent[]): ReplayEvent[] {
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.time - b.e.time || a.i - b.i).map(({ e }) => e);
}

/** Rebuild the dashboard model as it was at `cursor` (epoch ms). */
export function modelAt(events: ReplayEvent[], cursor: number, source: FeedSource): MissionModel {
  let model: MissionModel = { ...createInitialModel(source), socket: 'open' };
  for (const ev of events) {
    if (ev.time > cursor) break;
    model = applyMessage(model, ev.msg, ev.time);
  }
  return model;
}
