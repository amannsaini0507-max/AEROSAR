import * as THREE from 'three';
import type { LightingVariant, ScenarioDefinition } from './types';
import { ProceduralHuman } from './ProceduralHuman';
import type { TerrainSystem } from './TerrainSystem';
import type { FireSmokeSystem } from './FireSmokeSystem';
import type { WaterSystem } from './WaterSystem';
import type { RuinsSystem } from './RuinsSystem';
import type { EnvironmentSystem } from './EnvironmentSystem';

export class ScenarioManager {
  public currentScenario: ScenarioDefinition | null = null;
  public humans: ProceduralHuman[] = [];
  public victimGroup: THREE.Group;

  constructor(
    public scene: THREE.Scene,
    public terrain: TerrainSystem,
    public fireSmoke: FireSmokeSystem,
    public water: WaterSystem,
    public ruins: RuinsSystem,
    public env: EnvironmentSystem
  ) {
    this.victimGroup = new THREE.Group();
    this.victimGroup.name = 'scenario_victims';
    this.scene.add(this.victimGroup);
  }

  public async loadScenario(
    scenarioId: string,
    overrideLighting?: LightingVariant
  ): Promise<ScenarioDefinition> {
    let def: ScenarioDefinition;
    try {
      const res = await fetch(`/scenarios/scenario_${scenarioId}.json`);
      if (!res.ok) {
        // Try fallback without prefix
        const res2 = await fetch(`/scenarios/${scenarioId}.json`);
        if (!res2.ok) throw new Error(`HTTP ${res.status}`);
        def = await res2.json();
      } else {
        def = await res.json();
      }
    } catch {
      // Offline fallback mock data for the 5 scenarios + combined
      def = this.getFallbackScenario(scenarioId);
    }

    this.currentScenario = def;

    // 1. Configure Lighting Variant
    const lighting = overrideLighting ?? def.default_lighting ?? 'day';
    await this.env.setLighting(lighting);

    // 2. Configure Zones
    // Zone A (Ruins)
    const ruinsActive = def.zones.zone_a_ruins?.active ?? false;
    this.ruins.group.visible = ruinsActive;
    if (def.zones.zone_a_ruins?.position) {
      this.ruins.group.position.set(...def.zones.zone_a_ruins.position);
    }
    this.ruins.setShowZones(Boolean(def.zones.gps_denied?.show_overlay));

    // Zone B (Flood)
    const floodActive = def.zones.zone_b_flood?.active ?? false;
    this.water.mesh.visible = floodActive;
    this.water.debrisGroup.visible = floodActive;
    if (def.zones.zone_b_flood?.position) {
      this.water.mesh.position.set(...def.zones.zone_b_flood.position);
      this.water.debrisGroup.position.set(...def.zones.zone_b_flood.position);
    }

    // Zone C (Fire & Smoke)
    const fireActive = def.zones.zone_c_fire?.active ?? false;
    this.fireSmoke.group.visible = fireActive;
    if (def.zones.zone_c_fire?.position) {
      this.fireSmoke.group.position.set(...def.zones.zone_c_fire.position);
    }

    // 3. Clear and Spawn Scenario Victims
    this.clearVictims();
    def.victims.forEach((v) => {
      const human = new ProceduralHuman({
        id: v.id,
        name: v.name,
        pose: v.pose,
        clothingColor: v.clothing,
        tempC: v.temp_c,
      });

      // Align to terrain surface heightfield
      const [vx, , vz] = v.position;
      const groundY = this.terrain.getElevationAt(vx, vz);
      human.group.position.set(vx, groundY + (v.pose === 'seated' ? 0.32 : 0.14), vz);

      this.humans.push(human);
      this.victimGroup.add(human.group);
    });

    return def;
  }

  public update(simTimeSec: number) {
    this.humans.forEach((h) => h.update(simTimeSec));
  }

  public clearVictims() {
    this.humans.forEach((h) => {
      this.victimGroup.remove(h.group);
    });
    this.humans = [];
  }

  private getFallbackScenario(id: string): ScenarioDefinition {
    if (id === '1') {
      return {
        id: '1',
        name: 'Scenario 1: Flood + Survivors',
        seed: 101,
        description: 'Flooded basin covering ~30% of the arena with 2 victims at the flood edge.',
        default_lighting: 'day',
        arena: { width: 30, length: 30 },
        drone_spawn: { x: -8, y: 1.5, z: 8, heading: 45 },
        zones: {
          zone_a_ruins: { active: false, position: [-7, 0, -6] },
          zone_b_flood: { active: true, position: [6, 0.15, -6] },
          zone_c_fire: { active: false, position: [6, 0, 7] },
          gps_denied: { active: false, bounds: [-11, -3, -10, -2] },
        },
        victims: [
          { id: 'survivor_1', name: 'Survivor #1', position: [3.5, 0.22, -3.8], pose: 'seated', clothing: '#2b5c8f', temp_c: 36.5 },
          { id: 'survivor_2', name: 'Survivor #2', position: [6.8, 0.18, -1.2], pose: 'prone', clothing: '#d47a32', temp_c: 36.2 },
        ],
        hazards: [{ id: 'hazard_flood', type: 'flood', position: [6, 0, -6], radius: 7.5, confidence: 0.92 }],
      };
    } else if (id === '3') {
      return {
        id: '3',
        name: 'Scenario 3: Collapsed Building + Survivor',
        seed: 303,
        description: 'Tilted structure with rubble and partially occluded survivor.',
        default_lighting: 'dusk',
        arena: { width: 30, length: 30 },
        drone_spawn: { x: 6, y: 1.5, z: 6, heading: 225 },
        zones: {
          zone_a_ruins: { active: true, position: [-6.5, 0, -5.5] },
          zone_b_flood: { active: false, position: [6, 0, -6] },
          zone_c_fire: { active: false, position: [6, 0, 7] },
          gps_denied: { active: true, bounds: [-10, -3, -9, -2] },
        },
        victims: [{ id: 'survivor_rubble', name: 'Rubble Survivor', position: [-5.8, 0.35, -4.6], pose: 'trapped', clothing: '#477291', temp_c: 36.4 }],
        hazards: [{ id: 'hazard_structure', type: 'damaged_structure', position: [-6.5, 0, -5.5], radius: 5.0, confidence: 0.89 }],
      };
    } else if (id === '4') {
      return {
        id: '4',
        name: 'Scenario 4: GPS-Denied Navigation',
        seed: 404,
        description: 'Marked GPS-denied volume under damaged structure.',
        default_lighting: 'day',
        arena: { width: 30, length: 30 },
        drone_spawn: { x: 0, y: 2.5, z: 0, heading: 180 },
        zones: {
          zone_a_ruins: { active: true, position: [-6.5, 0, -5.5] },
          zone_b_flood: { active: false, position: [6, 0, -6] },
          zone_c_fire: { active: false, position: [6, 0, 7] },
          gps_denied: { active: true, bounds: [-10, -3, -9, -2], show_overlay: true },
        },
        victims: [{ id: 'survivor_zone4', name: 'Deep Ruin Survivor', position: [-7.2, 0.25, -5.2], pose: 'seated', clothing: '#8c4f2b', temp_c: 36.6 }],
        hazards: [{ id: 'hazard_structure_4', type: 'damaged_structure', position: [-6.5, 0, -5.5], radius: 5.0, confidence: 0.85 }],
      };
    } else if (id === '5') {
      return {
        id: '5',
        name: 'Scenario 5: Network Failure & Offline Resilience',
        seed: 505,
        description: 'Link cut & restore with event buffering.',
        default_lighting: 'dusk',
        arena: { width: 30, length: 30 },
        drone_spawn: { x: 2, y: 2.0, z: -4, heading: 120 },
        zones: {
          zone_a_ruins: { active: true, position: [-6.5, 0, -5.5] },
          zone_b_flood: { active: true, position: [6, 0.15, -6] },
          zone_c_fire: { active: false, position: [6, 0, 7] },
          gps_denied: { active: false, bounds: [-10, -3, -9, -2] },
        },
        victims: [{ id: 'offline_survivor_01', name: 'Offline Survivor #1', position: [1.5, 0.2, -2.5], pose: 'prone', clothing: '#3d7a5a', temp_c: 36.8 }],
        hazards: [{ id: 'hazard_debris_5', type: 'debris', position: [0, 0, -2.0], radius: 3.0, confidence: 0.81 }],
      };
    } else if (id === 'combined') {
      return {
        id: 'combined',
        name: 'Combined Demo (Scenario 2 + 5 Full Pipeline)',
        seed: 999,
        description: 'Active fire, critical survivor scoring, and outbox sync.',
        default_lighting: 'smoke',
        arena: { width: 30, length: 30 },
        drone_spawn: { x: 0, y: 1.5, z: 0, heading: 0 },
        zones: {
          zone_a_ruins: { active: true, position: [-6.5, 0, -5.5] },
          zone_b_flood: { active: true, position: [6, 0.15, -6] },
          zone_c_fire: { active: true, position: [5.5, 0, 6.5] },
          gps_denied: { active: true, bounds: [-10, -3, -9, -2] },
        },
        victims: [
          { id: 'victim_3', name: 'Critical Fire Survivor', position: [4.2, 0.22, 5.8], pose: 'prone', clothing: '#c93b3b', temp_c: 37.1 },
          { id: 'survivor_flood', name: 'Flood Survivor', position: [3.8, 0.2, -4.2], pose: 'seated', clothing: '#2b5c8f', temp_c: 36.4 },
        ],
        hazards: [
          { id: 'hazard_fire', type: 'fire', position: [5.5, 0, 6.5], radius: 4.0, confidence: 0.95 },
          { id: 'hazard_flood', type: 'flood', position: [6, 0, -6], radius: 7.5, confidence: 0.92 },
        ],
      };
    }

    // Default: Scenario 2 (Fire + Smoke + Survivor)
    return {
      id: '2',
      name: 'Scenario 2: Fire + Smoke + Survivor (Primary Demo)',
      seed: 202,
      description: 'Active raging fire with smoke plume and victim within 5m.',
      default_lighting: 'smoke',
      arena: { width: 30, length: 30 },
      drone_spawn: { x: 0, y: 1.5, z: 0, heading: 90 },
      zones: {
        zone_a_ruins: { active: false, position: [-7, 0, -6] },
        zone_b_flood: { active: false, position: [6, 0, -6] },
        zone_c_fire: { active: true, position: [5.5, 0, 6.5] },
        gps_denied: { active: false, bounds: [-11, -3, -10, -2] },
      },
      victims: [{ id: 'victim_3', name: 'Survivor near Fire', position: [4.2, 0.22, 5.8], pose: 'prone', clothing: '#c93b3b', temp_c: 37.1 }],
      hazards: [
        { id: 'hazard_fire', type: 'fire', position: [5.5, 0, 6.5], radius: 4.0, confidence: 0.95 },
        { id: 'hazard_smoke', type: 'smoke', position: [6.2, 2.0, 7.8], radius: 5.5, confidence: 0.88 },
      ],
    };
  }
}
