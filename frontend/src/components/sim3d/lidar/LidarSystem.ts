/**
 * LiDAR Subsystem Manager.
 * Orchestrates:
 * 1. Merged scene BVH generation at scene load.
 * 2. Asynchronous Web Worker scan execution at 10 Hz (or 5 Hz in LOW_POWER).
 * 3. 3-second zero-allocation ring buffer for THREE.Points rendering.
 * 4. Height/intensity colormapping.
 * 5. 8-sector minimum obstacle ranges feeding reactive avoidance and 5 Hz WebSocket summary.
 */

import * as THREE from 'three';
import {
  type LidarSensorConfig,
  type LidarScanResult,
  type LidarVictimCapsule,
  type LidarSummaryMsg,
  DEFAULT_LIDAR_CONFIG,
} from './lidarTypes';
import { buildMergedSceneBVH, extractCollidableMeshes, type MergedBVHData } from './lidarBVH';
import { executeLidarScan } from './lidarWorkerCore';

export class LidarSystem {
  public pointsMesh: THREE.Points;
  public geometry: THREE.BufferGeometry;
  public bvhData: MergedBVHData | null = null;
  public currentSectorRanges: [number, number, number, number, number, number, number, number] = [
    40, 40, 40, 40, 40, 40, 40, 40,
  ];
  public lastHitCount = 0;
  public lastScanTimeMs = 0;

  private worker: Worker | null = null;
  private workerReady = false;
  private scanPending = false;
  private scanTimer = 0;
  private summaryTimer = 0;
  private config: LidarSensorConfig;

  // Ring buffer: 3 seconds at 10 Hz = 30 scans * 5,760 points = 172,800 points max
  private readonly maxRingPoints: number;
  private positions: Float32Array;
  private colors: Float32Array;
  private ringWriteIndex = 0;
  private activePointCount = 0;

  public colorMode: 'height' | 'intensity' = 'height';
  public onSummaryUpdate?: (summary: LidarSummaryMsg) => void;

  constructor(config: LidarSensorConfig = DEFAULT_LIDAR_CONFIG) {
    this.config = { ...config };
    this.maxRingPoints = Math.round(3.0 * this.config.frequencyHz * (this.config.channels * 360));

    this.positions = new Float32Array(this.maxRingPoints * 3);
    this.colors = new Float32Array(this.maxRingPoints * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);

    const pointsMaterial = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });

    this.pointsMesh = new THREE.Points(this.geometry, pointsMaterial);
    this.pointsMesh.name = 'lidar_point_cloud';
    this.pointsMesh.visible = false; // toggled when LiDAR channel active

    this.initWorker();
  }

  private initWorker() {
    try {
      if (typeof window !== 'undefined' && typeof window.Worker !== 'undefined') {
        this.worker = new Worker(new URL('./lidar.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (e) => {
          if (e.data.type === 'INIT_DONE') {
            this.workerReady = true;
          } else if (e.data.type === 'SCAN_DONE') {
            this.scanPending = false;
            this.handleScanResult(e.data.result);
          }
        };
      }
    } catch {
      // Fallback to synchronous execution if workers are disallowed or in test environments
      this.worker = null;
      this.workerReady = true;
    }
  }

  /**
   * Initializes or rebuilds the scene BVH once at scene load.
   */
  public buildSceneBVH(collidableRoots: THREE.Object3D[]): void {
    const entries = collidableRoots.flatMap((root) => extractCollidableMeshes(root));
    if (entries.length === 0) return;

    this.bvhData = buildMergedSceneBVH(entries);

    if (this.worker) {
      this.worker.postMessage({
        type: 'INIT',
        payload: {
          positions: this.bvhData.positions,
          indices: this.bvhData.indices,
          materials: this.bvhData.materialIndexMap,
          config: this.config,
        },
      });
    } else {
      this.workerReady = true;
    }
  }

  /**
   * Updates LiDAR scan cycle during simulation loop.
   */
  public update(
    delta: number,
    dronePos: THREE.Vector3,
    droneQuat: THREE.Quaternion,
    lowPower: boolean,
    isLidarViewActive: boolean,
    isAvoidanceActive = true,
    victims: LidarVictimCapsule[] = []
  ): void {
    // Optimization rule: pause scans when LiDAR view is hidden AND no avoidance consumer needs them
    if (!isLidarViewActive && !isAvoidanceActive) {
      return;
    }

    const scanInterval = 1.0 / (lowPower ? this.config.lowPowerFreqHz : this.config.frequencyHz);
    this.scanTimer += delta;

    if (this.scanTimer >= scanInterval && !this.scanPending) {
      this.scanTimer = 0;
      this.triggerScan(dronePos, droneQuat, lowPower, victims);
    }

    // Publish WebSocket summary at 5 Hz (every 0.20s)
    this.summaryTimer += delta;
    if (this.summaryTimer >= 0.2) {
      this.summaryTimer = 0;
      if (this.onSummaryUpdate) {
        this.onSummaryUpdate({
          sector_ranges: [...this.currentSectorRanges],
          hit_count: this.lastHitCount,
          scan_time_ms: this.lastScanTimeMs,
        });
      }
    }
  }

  private triggerScan(
    dronePos: THREE.Vector3,
    droneQuat: THREE.Quaternion,
    lowPower: boolean,
    victims: LidarVictimCapsule[]
  ): void {
    const req = {
      dronePos: [dronePos.x, dronePos.y, dronePos.z] as [number, number, number],
      droneQuat: [droneQuat.x, droneQuat.y, droneQuat.z, droneQuat.w] as [number, number, number, number],
      lowPower,
      victims,
    };

    if (this.worker && this.workerReady) {
      this.scanPending = true;
      this.worker.postMessage({ type: 'SCAN', payload: req });
    } else if (this.bvhData) {
      // Synchronous fallback
      const result = executeLidarScan(this.bvhData.bvh, this.bvhData.materialIndexMap, req, this.config);
      this.handleScanResult(result);
    }
  }

  private handleScanResult(result: LidarScanResult): void {
    this.currentSectorRanges = result.sectorMinRanges;
    this.lastHitCount = result.hitCount;
    this.lastScanTimeMs = result.scanTimeMs;

    const count = result.pointCount;
    const buf = result.pointBuffer;

    // Ingest into preallocated ring buffer without per-frame garbage collection
    for (let i = 0; i < count; i++) {
      const bIdx = i * 4;
      const x = buf[bIdx];
      const y = buf[bIdx + 1];
      const z = buf[bIdx + 2];
      const intensity = buf[bIdx + 3];

      const rIdx = (this.ringWriteIndex + i) % this.maxRingPoints;
      const vIdx = rIdx * 3;

      this.positions[vIdx] = x;
      this.positions[vIdx + 1] = y;
      this.positions[vIdx + 2] = z;

      // Color mapping
      let r = 0;
      let g = 0;
      let b = 0;

      if (this.colorMode === 'height') {
        // Altitude ramp: Blue (y <= 0) -> Cyan -> Green -> Yellow -> Red (y >= 8m)
        const t = Math.max(0.0, Math.min(1.0, (y - 0.2) / 7.5));
        if (t < 0.25) {
          const u = t / 0.25;
          r = 0.0;
          g = u;
          b = 1.0;
        } else if (t < 0.5) {
          const u = (t - 0.25) / 0.25;
          r = 0.0;
          g = 1.0;
          b = 1.0 - u;
        } else if (t < 0.75) {
          const u = (t - 0.5) / 0.25;
          r = u;
          g = 1.0;
          b = 0.0;
        } else {
          const u = (t - 0.75) / 0.25;
          r = 1.0;
          g = 1.0 - u * 0.8;
          b = 0.0;
        }
      } else {
        // Intensity ramp: Amber / thermal-like
        r = intensity;
        g = intensity * 0.75;
        b = intensity * 0.2;
      }

      this.colors[vIdx] = r;
      this.colors[vIdx + 1] = g;
      this.colors[vIdx + 2] = b;
    }

    this.ringWriteIndex = (this.ringWriteIndex + count) % this.maxRingPoints;
    this.activePointCount = Math.min(this.maxRingPoints, this.activePointCount + count);

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.setDrawRange(0, this.activePointCount);
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.geometry.dispose();
  }
}
