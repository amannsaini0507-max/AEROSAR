import type { FeedSource, MissionModel, PriorityLevel, ServerMessage } from '../types';
import { applyMessage, createInitialModel } from './reducer';
import { LATE_SYNC_THRESHOLD_MS } from './time';
import type { ReplayEvent } from './replay';

/* ==========================================================================
   Mission record book.

   Every mission the dashboard watches is kept in this browser so it can be
   reopened and replayed after the mission ends — even after a refresh or on
   the next day. This is a *display convenience* only: the authoritative record
   is Member 4's events table (master doc §13.2), which the dashboard can also
   load through GET /api/missions/{id}/history.
   ========================================================================== */

const INDEX_KEY = 'aerosar.missions.index';
const EVENTS_PREFIX = 'aerosar.mission.';
export const MAX_ARCHIVED_MISSIONS = 12;
/** Keep the drone path but not every single pose — keeps a mission well under 1 MB. */
const POSE_SAMPLE = 3;

export interface MissionSummary {
  missionId: string;
  source: FeedSource;
  startedAt: number;
  endedAt: number;
  state: string;
  durationMs: number;
  survivors: number;
  byLevel: Record<PriorityLevel, number>;
  hazards: number;
  alerts: number;
  coverage: number;
  battery: number;
  /** Events that reached the dashboard well after they happened, i.e. captured during a link loss. */
  offlineEvents: number;
  topReason: string | null;
  eventCount: number;
}

interface StoredEvent {
  t: number;
  m: ServerMessage;
  /** arrival time, kept so "synced after reconnect" tags survive a reload */
  r?: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Store | null {
  try {
    const s = window.localStorage;
    s.setItem('aerosar.probe', '1');
    s.removeItem('aerosar.probe');
    return s;
  } catch {
    return null; // private mode or storage disabled — the dashboard still works
  }
}

const EMPTY_LEVELS: Record<PriorityLevel, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

/** Builds the record-book row for a mission by replaying its events through the normal reducer. */
export function summarise(events: ReplayEvent[], source: FeedSource): MissionSummary | null {
  if (events.length === 0) return null;
  let model: MissionModel = { ...createInitialModel(source), socket: 'open' };
  events.forEach((e) => {
    model = applyMessage(model, e.msg, e.time);
  });
  if (!model.mission) return null;

  const byLevel = { ...EMPTY_LEVELS };
  Object.values(model.survivors).forEach((s) => {
    const level = model.risks[s.id]?.level;
    if (level) byLevel[level] += 1;
  });
  // Anything that reached the dashboard well after it happened was captured during a link loss.
  const offlineEvents = events.filter(
    (e) => e.receivedAt != null && e.receivedAt - e.time > LATE_SYNC_THRESHOLD_MS && e.msg.type !== 'drone_pose'
  ).length;
  const top = Object.values(model.risks).sort((a, b) => b.score - a.score)[0] ?? null;

  return {
    missionId: model.mission.missionId,
    source,
    startedAt: model.missionStartedAt ?? events[0].time,
    endedAt: events[events.length - 1].time,
    state: model.mission.state,
    durationMs: Math.max(0, events[events.length - 1].time - (model.missionStartedAt ?? events[0].time)),
    survivors: Object.keys(model.survivors).length,
    byLevel,
    hazards: Object.keys(model.hazards).length,
    alerts: model.alerts.length,
    coverage: model.mission.coverage,
    battery: model.mission.battery,
    offlineEvents,
    topReason: top ? top.reason : null,
    eventCount: events.length
  };
}

export function listMissions(): MissionSummary[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as MissionSummary[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.startedAt - a.startedAt) : [];
  } catch {
    return [];
  }
}

export function loadMissionEvents(missionId: string): ReplayEvent[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(EVENTS_PREFIX + missionId);
    if (!raw) return [];
    const stored = JSON.parse(raw) as StoredEvent[];
    return stored.map((e, i) => ({ id: `a${i}`, msg: e.m, time: e.t, receivedAt: e.r }));
  } catch {
    return [];
  }
}

export function deleteMission(missionId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(EVENTS_PREFIX + missionId);
    const rest = listMissions().filter((m) => m.missionId !== missionId);
    s.setItem(INDEX_KEY, JSON.stringify(rest));
  } catch {
    /* ignore */
  }
}

export function clearArchive(): void {
  listMissions().forEach((m) => deleteMission(m.missionId));
}

/**
 * Saves (or updates) one mission in the record book. Older missions beyond
 * MAX_ARCHIVED_MISSIONS are dropped, and if the browser runs out of space the
 * oldest are removed and the save is retried once.
 */
export function saveMission(events: ReplayEvent[], source: FeedSource): MissionSummary | null {
  const s = storage();
  if (!s) return null;
  const summary = summarise(events, source);
  if (!summary) return null;

  let poseSeen = 0;
  const stored: StoredEvent[] = events
    .filter((e) => {
      if (e.msg.type === 'video_frame') return false;
      if (e.msg.type === 'drone_pose') return poseSeen++ % POSE_SAMPLE === 0;
      return true;
    })
    .map((e) => ({ t: e.time, m: e.msg, ...(e.receivedAt != null && e.receivedAt !== e.time ? { r: e.receivedAt } : {}) }));

  const index = [summary, ...listMissions().filter((m) => m.missionId !== summary.missionId)]
    .sort((a, b) => b.startedAt - a.startedAt);
  const keep = index.slice(0, MAX_ARCHIVED_MISSIONS);
  index.slice(MAX_ARCHIVED_MISSIONS).forEach((m) => deleteMission(m.missionId));

  const write = () => {
    s.setItem(EVENTS_PREFIX + summary.missionId, JSON.stringify(stored));
    s.setItem(INDEX_KEY, JSON.stringify(keep));
  };
  try {
    write();
  } catch {
    // Out of space: drop the oldest missions and try once more.
    keep.slice(Math.max(1, Math.floor(keep.length / 2))).forEach((m) => deleteMission(m.missionId));
    try {
      write();
    } catch {
      return null;
    }
  }
  return summary;
}
