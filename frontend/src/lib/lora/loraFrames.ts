/**
 * Compact binary frame serializer/deserializer using DataView.
 * Strictly guarantees packet sizes <= 51 bytes and int32 x 1e-7 geodetic encoding.
 */

import {
  FrameType,
  type HeartbeatFramePayload,
  type VictimFramePayload,
  type HazardFramePayload,
  type AckFramePayload,
  type LoRaFramePayload,
} from './loraTypes';

const GEODETIC_SCALE = 1e7;

export function packHeartbeat(p: Omit<HeartbeatFramePayload, 'type'>): Uint8Array {
  // 1 (type) + 1 (state) + 1 (battery) + 4 (lat) + 4 (lon) + 2 (alt) + 2 (seq) = 15 bytes
  const buffer = new ArrayBuffer(15);
  const view = new DataView(buffer);

  view.setUint8(0, FrameType.HEARTBEAT);
  view.setUint8(1, Math.max(0, Math.min(255, p.state)));
  view.setUint8(2, Math.max(0, Math.min(100, Math.round(p.batteryPercent))));
  view.setInt32(3, Math.round(p.lat * GEODETIC_SCALE), true);
  view.setInt32(7, Math.round(p.lon * GEODETIC_SCALE), true);
  view.setUint16(11, Math.max(0, Math.min(65535, Math.round(p.altM * 10))), true);
  view.setUint16(13, p.seq & 0xffff, true);

  return new Uint8Array(buffer);
}

export function packVictim(p: Omit<VictimFramePayload, 'type'>): Uint8Array {
  // 1 (type) + 1 (id_len) + N (id bytes, max 16) + 4 (lat) + 4 (lon) + 1 (conf) + 1 (thermal) + 1 (risk) + 2 (seq)
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(p.id.slice(0, 16));
  const idLen = idBytes.length;

  const totalLen = 1 + 1 + idLen + 4 + 4 + 1 + 1 + 1 + 2; // max 31 bytes
  const buffer = new ArrayBuffer(totalLen);
  const view = new DataView(buffer);

  let offset = 0;
  view.setUint8(offset++, FrameType.VICTIM);
  view.setUint8(offset++, idLen);

  new Uint8Array(buffer, offset, idLen).set(idBytes);
  offset += idLen;

  view.setInt32(offset, Math.round(p.lat * GEODETIC_SCALE), true);
  offset += 4;
  view.setInt32(offset, Math.round(p.lon * GEODETIC_SCALE), true);
  offset += 4;

  view.setUint8(offset++, Math.max(0, Math.min(100, Math.round(p.confidence * 100))));
  view.setUint8(offset++, p.thermalConfirmed ? 1 : 0);
  view.setUint8(offset++, Math.max(0, Math.min(3, p.riskLevel)));
  view.setUint16(offset, p.seq & 0xffff, true);

  return new Uint8Array(buffer);
}

export function packHazard(p: Omit<HazardFramePayload, 'type'>): Uint8Array {
  // 1 (type) + 1 (hazardType) + 4 (lat) + 4 (lon) + 2 (radius) + 2 (seq) = 14 bytes
  const buffer = new ArrayBuffer(14);
  const view = new DataView(buffer);

  view.setUint8(0, FrameType.HAZARD);
  view.setUint8(1, Math.max(0, Math.min(255, p.hazardType)));
  view.setInt32(2, Math.round(p.lat * GEODETIC_SCALE), true);
  view.setInt32(6, Math.round(p.lon * GEODETIC_SCALE), true);
  view.setUint16(10, Math.max(0, Math.min(65535, Math.round(p.radiusM * 10))), true);
  view.setUint16(12, p.seq & 0xffff, true);

  return new Uint8Array(buffer);
}

export function packAck(p: Omit<AckFramePayload, 'type'>): Uint8Array {
  // 1 (type) + 2 (ackSeq) + 1 (status) = 4 bytes
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);

  view.setUint8(0, FrameType.ACK);
  view.setUint16(1, p.ackSeq & 0xffff, true);
  view.setUint8(3, Math.max(0, Math.min(255, p.status)));

  return new Uint8Array(buffer);
}

export function unpackFrame(raw: Uint8Array): LoRaFramePayload {
  if (raw.byteLength < 4) {
    throw new Error(`Frame too short: ${raw.byteLength} bytes`);
  }
  if (raw.byteLength > 51) {
    throw new Error(`Frame exceeds 51 bytes: ${raw.byteLength} bytes`);
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const type = view.getUint8(0);

  switch (type) {
    case FrameType.HEARTBEAT: {
      if (raw.byteLength < 15) throw new Error('Invalid HEARTBEAT frame size');
      return {
        type: FrameType.HEARTBEAT,
        state: view.getUint8(1),
        batteryPercent: view.getUint8(2),
        lat: view.getInt32(3, true) / GEODETIC_SCALE,
        lon: view.getInt32(7, true) / GEODETIC_SCALE,
        altM: view.getUint16(11, true) / 10.0,
        seq: view.getUint16(13, true),
      };
    }
    case FrameType.VICTIM: {
      if (raw.byteLength < 15) throw new Error('Invalid VICTIM frame size');
      const idLen = view.getUint8(1);
      let offset = 2;
      const idBytes = raw.subarray(offset, offset + idLen);
      offset += idLen;
      const id = new TextDecoder().decode(idBytes);

      const lat = view.getInt32(offset, true) / GEODETIC_SCALE;
      offset += 4;
      const lon = view.getInt32(offset, true) / GEODETIC_SCALE;
      offset += 4;
      const conf = view.getUint8(offset++) / 100.0;
      const thermalConfirmed = view.getUint8(offset++) === 1;
      const riskLevel = view.getUint8(offset++);
      const seq = view.getUint16(offset, true);

      return {
        type: FrameType.VICTIM,
        id,
        lat,
        lon,
        confidence: conf,
        thermalConfirmed,
        riskLevel,
        seq,
      };
    }
    case FrameType.HAZARD: {
      if (raw.byteLength < 14) throw new Error('Invalid HAZARD frame size');
      return {
        type: FrameType.HAZARD,
        hazardType: view.getUint8(1),
        lat: view.getInt32(2, true) / GEODETIC_SCALE,
        lon: view.getInt32(6, true) / GEODETIC_SCALE,
        radiusM: view.getUint16(10, true) / 10.0,
        seq: view.getUint16(12, true),
      };
    }
    case FrameType.ACK: {
      if (raw.byteLength < 4) throw new Error('Invalid ACK frame size');
      return {
        type: FrameType.ACK,
        ackSeq: view.getUint16(1, true),
        status: view.getUint8(3),
      };
    }
    default:
      throw new Error(`Unknown LoRa frame type: ${type}`);
  }
}
