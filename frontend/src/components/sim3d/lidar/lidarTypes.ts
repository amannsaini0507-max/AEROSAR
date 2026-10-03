/**
 * LiDAR Subsystem Types & Configurations for AEROSAR.
 * 16-channel spinning LiDAR with +/-15 deg vertical FOV, 1 deg horizontal resolution.
 */

export interface LidarSensorConfig {
  channels: number;           // 16 channels default
  verticalFovMinDeg: number;  // -15 deg
  verticalFovMaxDeg: number;  // +15 deg
  horizontalResDeg: number;   // 1.0 deg (360 rays per ring)
  frequencyHz: number;        // 10 Hz
  minRangeM: number;          // 0.5 m
  maxRangeM: number;          // 40.0 m
  noiseSigmaM: number;        // 0.02 m (Gaussian noise)
  dropoutRate: number;        // 0.02 (2% random dropout)
  lowPowerChannels: number;   // 8 channels
  lowPowerFreqHz: number;     // 5 Hz
}

export const DEFAULT_LIDAR_CONFIG: LidarSensorConfig = {
  channels: 16,
  verticalFovMinDeg: -15.0,
  verticalFovMaxDeg: 15.0,
  horizontalResDeg: 1.0,
  frequencyHz: 10.0,
  minRangeM: 0.5,
  maxRangeM: 40.0,
  noiseSigmaM: 0.02,
  dropoutRate: 0.02,
  lowPowerChannels: 8,
  lowPowerFreqHz: 5.0,
};

export type MaterialType =
  | 'concrete'
  | 'dirt'
  | 'metal'
  | 'debris'
  | 'water'
  | 'fire'
  | 'smoke'
  | 'human';

export interface MaterialProperties {
  reflectivity: number; // 0..1 intensity
  dropoutProbability: number; // probability ray does not return
  penetrable: boolean; // if true, ray does not stop
}

export const MATERIAL_TABLE: Record<MaterialType, MaterialProperties> = {
  concrete: { reflectivity: 0.85, dropoutProbability: 0.0, penetrable: false },
  dirt:     { reflectivity: 0.70, dropoutProbability: 0.0, penetrable: false },
  metal:    { reflectivity: 0.95, dropoutProbability: 0.0, penetrable: false },
  debris:   { reflectivity: 0.80, dropoutProbability: 0.0, penetrable: false },
  human:    { reflectivity: 0.90, dropoutProbability: 0.0, penetrable: false },
  water:    { reflectivity: 0.25, dropoutProbability: 0.70, penetrable: false }, // 30% return
  fire:     { reflectivity: 0.00, dropoutProbability: 1.00, penetrable: true },  // returns nothing
  smoke:    { reflectivity: 0.10, dropoutProbability: 0.05, penetrable: true },  // transparent with slight dropout
};

export interface LidarVictimCapsule {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

export interface LidarScanRequest {
  dronePos: [number, number, number];
  droneQuat: [number, number, number, number]; // [x, y, z, w]
  lowPower: boolean;
  victims?: LidarVictimCapsule[];
}

export interface LidarScanResult {
  pointBuffer: Float32Array; // [x, y, z, intensity, ...]
  pointCount: number;
  sectorMinRanges: [number, number, number, number, number, number, number, number]; // 8 sectors
  hitCount: number;
  scanTimeMs: number;
}

export interface LidarSummaryMsg {
  sector_ranges: [number, number, number, number, number, number, number, number];
  hit_count: number;
  scan_time_ms: number;
}
