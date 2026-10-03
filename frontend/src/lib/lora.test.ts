import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateTimeOnAirMs,
  calculatePathLossDb,
  selectAdaptiveSpreadingFactor,
  DutyCycleTracker,
  calculateLinkBudget,
  SX1276_SPECS,
} from './lora/loraPhysics';

import {
  packHeartbeat,
  packVictim,
  packHazard,
  packAck,
  unpackFrame,
} from './lora/loraFrames';

import { FrameType } from './lora/loraTypes';

test('LoRa Time-on-Air within 1 ms of Semtech formula for 3 SF/payload combinations', () => {
  // Test case 1: SF7, 16 bytes payload
  // Theoretical Semtech AN1200.13: 51.46 ms
  const toa1 = calculateTimeOnAirMs(16, 7);
  assert.ok(
    Math.abs(toa1 - 51.46) < 1.0,
    `SF7 16B expected ~51.46 ms, got ${toa1.toFixed(2)} ms`
  );

  // Test case 2: SF8, 16 bytes payload
  // Theoretical Semtech AN1200.13: 92.67 ms
  const toa2 = calculateTimeOnAirMs(16, 8);
  assert.ok(
    Math.abs(toa2 - 92.67) < 1.0,
    `SF8 16B expected ~92.67 ms, got ${toa2.toFixed(2)} ms`
  );

  // Test case 3: SF12, 16 bytes payload
  // Theoretical Semtech AN1200.13 (DE=1): 1318.91 ms
  const toa3 = calculateTimeOnAirMs(16, 12);
  assert.ok(
    Math.abs(toa3 - 1318.91) < 1.0,
    `SF12 16B expected ~1318.91 ms, got ${toa3.toFixed(2)} ms`
  );

  // Additional sanity check: SF10, 32 bytes payload (Semtech AN1200.13: 452.61 ms)
  const toa4 = calculateTimeOnAirMs(32, 10);
  assert.ok(Math.abs(toa4 - 452.61) < 1.0, `SF10 32B exact Semtech match: ${toa4.toFixed(2)} ms`);
});

test('LoRa log-distance path loss is strictly monotonic with distance', () => {
  const distances = [1, 5, 10, 50, 100, 500, 1000, 2000];
  let prevPl = -Infinity;

  for (const d of distances) {
    const pl = calculatePathLossDb(d);
    assert.ok(
      pl > prevPl,
      `Path loss at ${d}m (${pl.toFixed(2)} dB) must be strictly greater than at previous distance (${prevPl.toFixed(2)} dB)`
    );
    prevPl = pl;
  }
});

test('Adaptive SF selection picks lowest SF with at least 6 dB margin and steps up on signal degradation', () => {
  // Strong signal: RSSI -85 dBm, SNR +10 dB -> should pick SF7 (lowest SF, fastest, least airtime)
  const sfStrong = selectAdaptiveSpreadingFactor(-85, 10, 6.0);
  assert.equal(sfStrong, 7, `Expected SF7 for strong signal, got SF${sfStrong}`);

  // Medium signal where SF7 does not have 6 dB margin:
  // SF7 sensitivity is -123 dBm (-123 + 6 = -117 dBm threshold)
  // Let RSSI = -120 dBm (only 3 dB margin for SF7, but SF8 sensitivity is -126 dBm -> 6 dB margin)
  // and SNR = 0 dB (SF8 min SNR is -10 dB -> 10 dB margin >= 6 dB)
  const sfMedium = selectAdaptiveSpreadingFactor(-120, 0, 6.0);
  assert.equal(sfMedium, 8, `Expected SF8 for -120 dBm and 0 dB SNR, got SF${sfMedium}`);

  // Very weak signal: RSSI -132 dBm -> SF7..SF10 do not have 6 dB margin, SF12 needed
  const sfWeak = selectAdaptiveSpreadingFactor(-132, -16, 6.0);
  assert.ok(sfWeak >= 11, `Expected SF11 or SF12 for weak signal, got SF${sfWeak}`);
});

test('ETSI duty-cycle tracker enforces 1% limit and calculates utilization accurately', () => {
  const tracker = new DutyCycleTracker(0.01, 60.0); // 1% over 60s window = max 0.6s airtime
  const airtimeMs = 250.0; // 0.25s

  // First transmission (0.25s of 0.6s) -> allowed
  assert.equal(tracker.canTransmit(airtimeMs, 10.0), true);
  tracker.recordTransmission(airtimeMs, 10.0);

  // Second transmission (+0.25s = 0.5s of 0.6s) -> allowed
  assert.equal(tracker.canTransmit(airtimeMs, 15.0), true);
  tracker.recordTransmission(airtimeMs, 15.0);

  // Third transmission (+0.25s = 0.75s > 0.6s) -> BLOCKED
  assert.equal(tracker.canTransmit(airtimeMs, 20.0), false);

  // Utilization should be ~ 0.5s / 0.6s = 83.3%
  const util = tracker.getUtilization(20.0);
  assert.ok(Math.abs(util - 0.833) < 0.05, `Expected ~0.83 utilization, got ${util}`);

  // After 60 seconds (at t=75s), the first transmission expires (t=10s was 65s ago)
  // Only the second transmission (t=15s, 60s ago) remains or expires soon
  assert.equal(tracker.canTransmit(airtimeMs, 76.0), true);
});

test('LoRa binary frames pack and unpack with perfect round trip fidelity and size <= 51 bytes', () => {
  // 1. HEARTBEAT
  const hbData = {
    state: 1, // SEARCHING
    batteryPercent: 88,
    lat: 26.9124351,
    lon: 75.7873214,
    altM: 5.2,
    seq: 42,
  };
  const hbRaw = packHeartbeat(hbData);
  assert.ok(hbRaw.byteLength <= 51, `Heartbeat length ${hbRaw.byteLength} exceeds 51 bytes`);
  const hbUnpacked = unpackFrame(hbRaw);
  assert.equal(hbUnpacked.type, FrameType.HEARTBEAT);
  if (hbUnpacked.type === FrameType.HEARTBEAT) {
    assert.equal(hbUnpacked.state, hbData.state);
    assert.equal(hbUnpacked.batteryPercent, hbData.batteryPercent);
    assert.ok(Math.abs(hbUnpacked.lat - hbData.lat) < 1e-6);
    assert.ok(Math.abs(hbUnpacked.lon - hbData.lon) < 1e-6);
    assert.ok(Math.abs(hbUnpacked.altM - hbData.altM) < 0.15);
    assert.equal(hbUnpacked.seq, hbData.seq);
  }

  // 2. VICTIM
  const vicData = {
    id: 'victim_3',
    lat: 26.9125555,
    lon: 75.7874444,
    confidence: 0.92,
    thermalConfirmed: true,
    riskLevel: 3, // CRITICAL
    seq: 101,
  };
  const vicRaw = packVictim(vicData);
  assert.ok(vicRaw.byteLength <= 51, `Victim frame length ${vicRaw.byteLength} exceeds 51 bytes`);
  const vicUnpacked = unpackFrame(vicRaw);
  assert.equal(vicUnpacked.type, FrameType.VICTIM);
  if (vicUnpacked.type === FrameType.VICTIM) {
    assert.equal(vicUnpacked.id, vicData.id);
    assert.ok(Math.abs(vicUnpacked.lat - vicData.lat) < 1e-6);
    assert.ok(Math.abs(vicUnpacked.lon - vicData.lon) < 1e-6);
    assert.ok(Math.abs(vicUnpacked.confidence - vicData.confidence) < 0.02);
    assert.equal(vicUnpacked.thermalConfirmed, true);
    assert.equal(vicUnpacked.riskLevel, 3);
    assert.equal(vicUnpacked.seq, vicData.seq);
  }

  // 3. HAZARD
  const hazData = {
    hazardType: 0, // fire
    lat: 26.9123000,
    lon: 75.7872000,
    radiusM: 4.5,
    seq: 77,
  };
  const hazRaw = packHazard(hazData);
  assert.ok(hazRaw.byteLength <= 51, `Hazard frame length ${hazRaw.byteLength} exceeds 51 bytes`);
  const hazUnpacked = unpackFrame(hazRaw);
  assert.equal(hazUnpacked.type, FrameType.HAZARD);
  if (hazUnpacked.type === FrameType.HAZARD) {
    assert.equal(hazUnpacked.hazardType, 0);
    assert.ok(Math.abs(hazUnpacked.radiusM - hazData.radiusM) < 0.15);
    assert.equal(hazUnpacked.seq, hazData.seq);
  }

  // 4. ACK
  const ackData = {
    ackSeq: 101,
    status: 0,
  };
  const ackRaw = packAck(ackData);
  assert.ok(ackRaw.byteLength <= 51, `Ack frame length ${ackRaw.byteLength} exceeds 51 bytes`);
  const ackUnpacked = unpackFrame(ackRaw);
  assert.equal(ackUnpacked.type, FrameType.ACK);
  if (ackUnpacked.type === FrameType.ACK) {
    assert.equal(ackUnpacked.ackSeq, ackData.ackSeq);
    assert.equal(ackUnpacked.status, 0);
  }
});
