/**
 * LoRa Physical Layer & Protocol Types for AEROSAR.
 * SX1276 transceiver model, compact binary frames, and radio link metrics.
 */

export type LoRaSpreadingFactor = 7 | 8 | 9 | 10 | 11 | 12;

export type LinkMode = 'NETWORK' | 'LORA_ONLY' | 'OFFLINE';
export type LinkModeCommand = 'auto' | 'force_lora' | 'force_offline';

export type PacketPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface LoRaRadioConfig {
  frequencyHz: number;        // e.g. 865_000_000 Hz
  bandwidthHz: number;        // e.g. 125_000 Hz
  codingRate: number;         // 1 = 4/5, 2 = 4/6, 3 = 4/7, 4 = 4/8
  preambleLength: number;     // 8 symbols
  txPowerDbm: number;         // 14 dBm
  droneAntennaGainDbi: number;   // 2 dBi
  stationAntennaGainDbi: number; // 3 dBi
  pathLossExponent: number;   // 2.7
  shadowingSigmaDb: number;   // 3 dB
  noiseFigureDb: number;      // 6 dB
  worldScale: number;         // 40 (1 sim m = 40 real m for radio)
  stationDistanceOffsetM: number; // 0 m
  dutyCycleMax: number;       // 0.01 (1%)
}

export const DEFAULT_LORA_CONFIG: LoRaRadioConfig = {
  frequencyHz: 865_000_000,
  bandwidthHz: 125_000,
  codingRate: 1, // 4/5
  preambleLength: 8,
  txPowerDbm: 14.0,
  droneAntennaGainDbi: 2.0,
  stationAntennaGainDbi: 3.0,
  pathLossExponent: 2.7,
  shadowingSigmaDb: 3.0,
  noiseFigureDb: 6.0,
  worldScale: 40.0,
  stationDistanceOffsetM: 0.0,
  dutyCycleMax: 0.01,
};

export interface StationDefinition {
  pos: [number, number];       // [x, z] in arena meters
  antennaHeight: number;       // e.g. 6 meters
}

export interface NoNetworkZone {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export enum FrameType {
  HEARTBEAT = 1,
  VICTIM = 2,
  HAZARD = 3,
  ACK = 4,
}

export interface HeartbeatFramePayload {
  type: FrameType.HEARTBEAT;
  state: number;               // 0=IDLE, 1=SEARCHING, 2=VERIFYING, 3=RETURNING, 4=COMPLETE, 5=EMERGENCY_LAND
  batteryPercent: number;      // 0..100
  lat: number;                 // decimal degrees
  lon: number;                 // decimal degrees
  altM: number;                // altitude in meters
  seq: number;
}

export interface VictimFramePayload {
  type: FrameType.VICTIM;
  id: string;                  // e.g. "victim_3"
  lat: number;
  lon: number;
  confidence: number;          // 0.0 .. 1.0
  thermalConfirmed: boolean;
  riskLevel: number;           // 0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL
  seq: number;
}

export interface HazardFramePayload {
  type: FrameType.HAZARD;
  hazardType: number;          // 0=fire, 1=smoke, 2=flood, 3=debris, 4=damaged_structure
  lat: number;
  lon: number;
  radiusM: number;
  seq: number;
}

export interface AckFramePayload {
  type: FrameType.ACK;
  ackSeq: number;
  status: number;              // 0=OK
}

export type LoRaFramePayload =
  | HeartbeatFramePayload
  | VictimFramePayload
  | HazardFramePayload
  | AckFramePayload;

export interface QueuedPacket {
  id: string;
  seq: number;
  priority: PacketPriority;
  rawBuffer: Uint8Array;
  payload: LoRaFramePayload;
  attempts: number;
  maxAttempts: number;
  enqueuedAtSimTime: number;
  nextRetrySimTime: number;
}

export interface LinkStats {
  mode: LinkMode;
  rssiDb: number;
  snrDb: number;
  currentSf: LoRaSpreadingFactor;
  pdr: number;                 // Packet Delivery Ratio 0..1
  lastPacketAgeMs: number;
  queueLength: number;
  dutyCycleUse: number;        // 0..1
  packetsDelivered: number;
  packetsLost: number;
  isObstructed: boolean;
  obstructionLossDb: number;
  scaledDistanceM: number;
}

export interface LoRaPacketLog {
  dir: 'tx' | 'rx';
  type: 'HEARTBEAT' | 'VICTIM' | 'HAZARD' | 'ACK';
  size: number;
  sf: LoRaSpreadingFactor;
  rssi: number;
  snr: number;
  airtime_ms: number;
  result: 'delivered' | 'lost' | 'duty_exhausted' | 'ack';
  sim_time: number;
}
