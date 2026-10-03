/**
 * Core LiDAR raycasting engine.
 * Computes 16-channel spinning raycasts against MeshBVH and capsule victim colliders.
 * Operates with pure Three.js math objects and Float32Array buffers.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  type LidarSensorConfig,
  type LidarScanRequest,
  type LidarScanResult,
  type LidarVictimCapsule,
  DEFAULT_LIDAR_CONFIG,
  MATERIAL_TABLE,
} from './lidarTypes';

// Box-Muller Gaussian random number generator
function gaussianRandom(mean = 0, sigma = 0.02): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * sigma;
}

/**
 * Tests ray intersection against a vertical capsule collider.
 * Returns intersection distance along ray or Infinity if missed.
 */
function intersectRayCapsule(
  ray: THREE.Ray,
  capsule: LidarVictimCapsule
): number {
  const p0 = new THREE.Vector3(capsule.x, capsule.y, capsule.z);
  const p1 = new THREE.Vector3(capsule.x, capsule.y + capsule.height, capsule.z);
  const r = capsule.radius;

  // Approximate distance from ray to segment
  const segDir = p1.clone().sub(p0);
  const segLen = segDir.length();
  if (segLen > 0) segDir.divideScalar(segLen);

  // Parameter along ray
  const t = (p0.clone().addScaledVector(segDir, segLen * 0.5).sub(ray.origin)).dot(ray.direction);
  if (t < 0.2) return Infinity;

  const rayPt = ray.origin.clone().addScaledVector(ray.direction, t);
  // Closest point on line segment
  const s = Math.max(0, Math.min(segLen, rayPt.clone().sub(p0).dot(segDir)));
  const segPt = p0.clone().addScaledVector(segDir, s);

  const distSq = rayPt.distanceToSquared(segPt);
  if (distSq <= r * r) {
    return t;
  }
  return Infinity;
}

export function executeLidarScan(
  bvh: MeshBVH | null,
  materialIndexMap: Uint8Array | null, // maps faceIndex to material type enum
  req: LidarScanRequest,
  config: LidarSensorConfig = DEFAULT_LIDAR_CONFIG
): LidarScanResult {
  const t0 = performance.now();

  const channels = req.lowPower ? config.lowPowerChannels : config.channels;
  const numRaysPerChannel = Math.round(360.0 / config.horizontalResDeg);
  const totalRays = channels * numRaysPerChannel;

  // Preallocate buffer: 4 floats per hit (x, y, z, intensity)
  const maxHits = totalRays;
  const outPoints = new Float32Array(maxHits * 4);
  let hitCount = 0;

  // 8 Sectors minimum ranges initialized to maxRangeM
  // Sector 0 is forward (yaw 0 +/- 22.5 deg)
  const sectorMinRanges: [number, number, number, number, number, number, number, number] = [
    config.maxRangeM,
    config.maxRangeM,
    config.maxRangeM,
    config.maxRangeM,
    config.maxRangeM,
    config.maxRangeM,
    config.maxRangeM,
    config.maxRangeM,
  ];

  const dronePos = new THREE.Vector3(...req.dronePos);
  // Sensor mount offset 15cm below drone chassis
  const sensorOrigin = dronePos.clone().add(new THREE.Vector3(0, -0.15, 0));
  const droneQuat = new THREE.Quaternion(...req.droneQuat);

  const ray = new THREE.Ray();
  ray.origin.copy(sensorOrigin);

  const fovSpan = config.verticalFovMaxDeg - config.verticalFovMinDeg;
  const channelStep = channels > 1 ? fovSpan / (channels - 1) : 0;

  // Temporary vectors
  const localDir = new THREE.Vector3();
  const worldDir = new THREE.Vector3();

  for (let ch = 0; ch < channels; ch++) {
    const pitchDeg = config.verticalFovMinDeg + ch * channelStep;
    const pitchRad = (pitchDeg * Math.PI) / 180.0;
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);

    for (let az = 0; az < numRaysPerChannel; az++) {
      const yawDeg = az * config.horizontalResDeg;
      const yawRad = (yawDeg * Math.PI) / 180.0;

      // Local direction relative to drone heading:
      // In Three.js: -Z is forward, +X is right, +Y is up
      localDir.set(
        Math.sin(yawRad) * cosPitch,
        sinPitch,
        -Math.cos(yawRad) * cosPitch
      ).normalize();

      worldDir.copy(localDir).applyQuaternion(droneQuat).normalize();
      ray.direction.copy(worldDir);

      let closestDist = config.maxRangeM;
      let hitPoint: THREE.Vector3 | null = null;
      let hitMaterial = 'concrete';

      // 1. Raycast against MeshBVH
      if (bvh) {
        const hit = bvh.raycastFirst(ray);
        if (hit && hit.distance >= config.minRangeM && hit.distance <= config.maxRangeM) {
          closestDist = hit.distance;
          hitPoint = hit.point;
          // Look up material if map provided
          if (materialIndexMap && hit.faceIndex != null) {
            const matIdx = materialIndexMap[hit.faceIndex] || 0;
            const mats = ['concrete', 'dirt', 'metal', 'debris', 'water'];
            hitMaterial = mats[matIdx] || 'concrete';
          }
        }
      }

      // 2. Raycast against victim capsule colliders
      if (req.victims && req.victims.length > 0) {
        for (const vic of req.victims) {
          const vicDist = intersectRayCapsule(ray, vic);
          if (vicDist >= config.minRangeM && vicDist < closestDist) {
            closestDist = vicDist;
            hitPoint = ray.origin.clone().addScaledVector(ray.direction, vicDist);
            hitMaterial = 'human';
          }
        }
      }

      // Check hit validation and material response
      if (hitPoint && closestDist < config.maxRangeM) {
        const matProp = MATERIAL_TABLE[hitMaterial as keyof typeof MATERIAL_TABLE] || MATERIAL_TABLE.concrete;

        // Fire returns nothing
        if (matProp.reflectivity === 0.0) continue;

        // Water has ~70% dropout (30% return)
        if (Math.random() < matProp.dropoutProbability) continue;

        // Random dropout (2%)
        if (Math.random() < config.dropoutRate) continue;

        // Gaussian range measurement noise
        const noisyDist = Math.max(config.minRangeM, closestDist + gaussianRandom(0, config.noiseSigmaM));
        const noisyPoint = ray.origin.clone().addScaledVector(ray.direction, noisyDist);

        // Record point [x, y, z, intensity]
        const idx = hitCount * 4;
        outPoints[idx] = noisyPoint.x;
        outPoints[idx + 1] = noisyPoint.y;
        outPoints[idx + 2] = noisyPoint.z;
        outPoints[idx + 3] = matProp.reflectivity;
        hitCount++;

        // Calculate 8-sector index from horizontal azimuth relative to forward
        // yawDeg is in [0, 360). Sector 0 is centered at 0 ([-22.5, +22.5])
        const sectorIdx = Math.floor(((yawDeg + 22.5) % 360.0) / 45.0) & 7;
        if (noisyDist < sectorMinRanges[sectorIdx]) {
          sectorMinRanges[sectorIdx] = Math.round(noisyDist * 100) / 100;
        }
      }
    }
  }

  const scanTimeMs = Math.round((performance.now() - t0) * 10) / 10;

  // Trim or slice pointBuffer
  const finalBuffer = outPoints.subarray(0, hitCount * 4);

  return {
    pointBuffer: finalBuffer,
    pointCount: hitCount,
    sectorMinRanges,
    hitCount,
    scanTimeMs,
  };
}
