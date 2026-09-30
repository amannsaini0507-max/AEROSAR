export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type LightingVariant = 'day' | 'dusk' | 'night' | 'smoke';
export type CameraViewMode = 'orbit' | 'drone_fpv' | 'top_down' | 'ruins_cam' | 'fire_cam' | 'flood_cam';
export type SensorChannel = 'rgb' | 'thermal';

export interface ScenarioDefinition {
  id: string;
  name: string;
  seed: number;
  description: string;
  default_lighting: LightingVariant;
  arena: { width: number; length: number };
  drone_spawn: { x: number; y: number; z: number; heading: number };
  zones: {
    zone_a_ruins: { active: boolean; position: [number, number, number]; debris_radius?: number };
    zone_b_flood: { active: boolean; position: [number, number, number]; size?: [number, number]; water_level?: number };
    zone_c_fire: { active: boolean; position: [number, number, number]; intensity?: number; smoke_spread?: number };
    gps_denied: { active: boolean; bounds: [number, number, number, number]; show_overlay?: boolean };
  };
  victims: Array<{
    id: string;
    name: string;
    position: [number, number, number];
    pose: 'prone' | 'seated' | 'trapped';
    clothing: string;
    temp_c: number;
  }>;
  hazards: Array<{
    id: string;
    type: 'flood' | 'fire' | 'smoke' | 'damaged_structure' | 'debris';
    position: [number, number, number];
    radius: number;
    confidence: number;
  }>;
  expected_detections?: {
    survivors: number;
    hazards: number;
    priority: string;
  };
}

export interface PresetConfig {
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  bloomStrength: number;
  ao: boolean;
  antialiasing: 'none' | 'fxaa' | 'smaa';
  vignette: boolean;
  pixelRatio: number;
  maxParticles: number;
  waterQuality: 'simple' | 'high';
  instancedCount: number;
}

export const PRESET_CONFIGS: Record<QualityPreset, PresetConfig> = {
  low: {
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    bloomStrength: 0,
    ao: false,
    antialiasing: 'none',
    vignette: false,
    pixelRatio: 1.0,
    maxParticles: 150,
    waterQuality: 'simple',
    instancedCount: 30,
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    bloomStrength: 0.35,
    ao: false,
    antialiasing: 'fxaa',
    vignette: true,
    pixelRatio: 1.0,
    maxParticles: 400,
    waterQuality: 'high',
    instancedCount: 60,
  },
  high: {
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    bloomStrength: 0.6,
    ao: true,
    antialiasing: 'smaa',
    vignette: true,
    pixelRatio: 1.25,
    maxParticles: 900,
    waterQuality: 'high',
    instancedCount: 120,
  },
  ultra: {
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    bloomStrength: 0.8,
    ao: true,
    antialiasing: 'smaa',
    vignette: true,
    pixelRatio: 1.5,
    maxParticles: 1600,
    waterQuality: 'high',
    instancedCount: 180,
  },
};
