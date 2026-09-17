import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMessage, createInitialModel } from './reducer.ts';
import { deriveLink, derivePriority, STALE_AFTER_MS } from './derive.ts';
import { stampToMs } from './time.ts';
import { alertLevel } from './levels.ts';
import { scoreSurvivor } from '../mock/riskScore.ts';
import type { MissionModel, ServerMessage } from '../types.ts';

const T0 = Date.parse('2026-09-16T10:00:00Z');
const apply = (m: MissionModel, msgs: ServerMessage[], now = T0) => msgs.reduce((acc, msg) => applyMessage(acc, msg, now), m);

const status = (over: Partial<Record<string, unknown>> = {}): ServerMessage => ({
  type: 'mission_status',
  data: { mission_id: 'm1', state: 'SEARCHING', battery_percent: 80, coverage_percent: 10, link_connected: true, stamp: T0 / 1000, ...over } as never
});

test('stamp formats all normalise to epoch ms', () => {
  assert.equal(stampToMs({ sec: 1_700_000_000, nanosec: 500_000_000 }), 1_700_000_000_500);
  assert.equal(stampToMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(stampToMs(1_700_000_000_123), 1_700_000_000_123);
  assert.equal(stampToMs('2026-09-16T10:00:00Z'), T0);
  assert.equal(stampToMs('garbage', 42), 42);
});

test('worked example from master doc §11.7 scores 0.717 HIGH', () => {
  const r = scoreSurvivor({ confidence: 0.82, thermalConfirmed: true, distanceToHazard: 4, clusterCount: 1 });
  assert.equal(r.score, 0.717);
  assert.equal(r.level, 'HIGH');
  assert.equal(r.reason, 'HIGH: high detection confidence (0.82), located near an active hazard, thermal-confirmed');
});

test('person detections become survivors, hazard-class detections become hazards', () => {
  const m = apply(createInitialModel('websocket'), [
    { type: 'detection', data: { id: 'd1', detection_type: 'person', confidence: 0.9, thermal_confirmed: true, latitude: 1, longitude: 2, stamp: T0 } },
    { type: 'detection', data: { id: 'h1', detection_type: 'fire', confidence: 0.8, thermal_confirmed: false, latitude: 1, longitude: 2, stamp: T0 } }
  ]);
  assert.equal(Object.keys(m.survivors).length, 1);
  assert.equal(m.survivors.d1.seq, 1);
  assert.equal(m.hazards.h1.hazardType, 'fire');
});

test('alerts are de-duplicated by id and ordered by event time, not arrival (§13.4, §13.6)', () => {
  const late = { alert_id: 'a-old', alert_type: 'SURVIVOR_DETECTED', message: 'queued offline', stamp: new Date(T0 - 30_000).toISOString() };
  const m = apply(createInitialModel('websocket'), [
    { type: 'alert', data: { alert_id: 'a-new', alert_type: 'LINK_RESTORED', message: 'back', stamp: new Date(T0).toISOString() } },
    { type: 'alert', data: late },
    { type: 'alert', data: late }
  ]);
  assert.deepEqual(m.alerts.map((a) => a.id), ['a-new', 'a-old']);
  assert.equal(m.alerts[1].receivedAt - m.alerts[1].time, 30_000);
});

test('alert severity mapping', () => {
  assert.equal(alertLevel('CRITICAL_PRIORITY'), 'CRITICAL');
  assert.equal(alertLevel('SURVIVOR_DETECTED'), 'HIGH');
  assert.equal(alertLevel('LINK_LOST'), 'MEDIUM');
  assert.equal(alertLevel('SOMETHING_NEW'), 'INFO');
});

test('priority list follows backend ranking, then scores, unscored last', () => {
  const det = (id: string): ServerMessage => ({
    type: 'detection',
    data: { id, detection_type: 'person', confidence: 0.5, thermal_confirmed: false, latitude: 0, longitude: 0, stamp: T0 }
  });
  let m = apply(createInitialModel('websocket'), [det('a'), det('b'), det('c'), { type: 'risk_score', data: { detection_id: 'a', score: 0.4, priority_level: 'MEDIUM', reason: 'x' } }, { type: 'risk_score', data: { detection_id: 'b', score: 0.8, priority_level: 'CRITICAL', reason: 'y' } }]);
  assert.deepEqual(derivePriority(m).map((r) => r.survivor.id), ['b', 'a', 'c']);
  m = applyMessage(m, { type: 'priority', data: { ranked: [{ detection_id: 'a', score: 0.9, priority_level: 'CRITICAL', reason: 'z' }] } }, T0);
  assert.deepEqual(derivePriority(m).map((r) => r.survivor.id), ['a', 'b', 'c']);
});

test('link indicator: CONNECTED → OFFLINE (reported) → SYNCING → CONNECTED', () => {
  let m = apply(createInitialModel('websocket'), [status()]);
  m = { ...m, socket: 'open' };
  assert.equal(deriveLink(m, T0).state, 'CONNECTED');
  m = apply(m, [status({ link_connected: false }), { type: 'sync_status', data: { state: 'OFFLINE', queued_events: 4 } }]);
  const offline = deriveLink(m, T0);
  assert.equal(offline.state, 'OFFLINE');
  assert.match(offline.detail, /4 events queued/);
  m = apply(m, [{ type: 'sync_status', data: { state: 'SYNCING', synced_events: 2 } }]);
  assert.equal(deriveLink(m, T0).state, 'SYNCING');
  m = apply(m, [{ type: 'sync_status', data: { state: 'CONNECTED' } }, status()]);
  assert.equal(deriveLink(m, T0).state, 'CONNECTED');
});

test('link indicator goes OFFLINE when status is stale (§16.3: within 5 s)', () => {
  const m = { ...apply(createInitialModel('websocket'), [status()]), socket: 'open' as const };
  assert.equal(deriveLink(m, T0 + STALE_AFTER_MS - 1).state, 'CONNECTED');
  assert.equal(deriveLink(m, T0 + STALE_AFTER_MS + 1).state, 'OFFLINE');
});

test('link indicator shows OFFLINE when the backend socket is closed', () => {
  const m = { ...createInitialModel('websocket'), socket: 'closed' as const };
  assert.equal(deriveLink(m, T0).state, 'OFFLINE');
});

test('a new mission id clears the previous mission', () => {
  let m = apply(createInitialModel('websocket'), [
    status(),
    { type: 'detection', data: { id: 'd1', detection_type: 'person', confidence: 0.9, thermal_confirmed: true, latitude: 1, longitude: 2, stamp: T0 } }
  ]);
  m = applyMessage(m, status({ mission_id: 'm2' }), T0);
  assert.equal(Object.keys(m.survivors).length, 0);
  assert.equal(m.mission?.missionId, 'm2');
});

test('batch messages apply every inner message; malformed messages are ignored', () => {
  const m = applyMessage(createInitialModel('websocket'), { type: 'batch', data: [status(), { type: 'nonsense' } as never] }, T0);
  assert.equal(m.mission?.state, 'SEARCHING');
  assert.equal(applyMessage(m, null as never, T0), m);
});
