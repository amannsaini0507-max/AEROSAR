import type { RosStamp } from '../types';

/**
 * Converts any stamp format the backend might send into epoch milliseconds.
 * Accepts builtin_interfaces/Time ({sec, nanosec}), ISO-8601 strings, and
 * numbers in epoch seconds or milliseconds. Falls back to `fallback` (usually
 * "now") when the stamp is missing or unparsable, so a bad stamp never crashes
 * a panel.
 */
export function stampToMs(stamp: RosStamp | undefined | null, fallback = Date.now()): number {
  if (stamp == null) return fallback;
  if (typeof stamp === 'number') {
    if (!Number.isFinite(stamp)) return fallback;
    return stamp < 1e12 ? stamp * 1000 : stamp;
  }
  if (typeof stamp === 'string') {
    const parsed = Date.parse(stamp);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  if (typeof stamp === 'object' && typeof stamp.sec === 'number') {
    return stamp.sec * 1000 + Math.floor((stamp.nanosec ?? 0) / 1e6);
  }
  return fallback;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

/** An event counts as "synced late" if it reached the dashboard well after it happened (§13.6). */
export const LATE_SYNC_THRESHOLD_MS = 3000;
export function arrivedLate(item: { time: number; receivedAt: number }): boolean {
  return item.receivedAt - item.time > LATE_SYNC_THRESHOLD_MS;
}
