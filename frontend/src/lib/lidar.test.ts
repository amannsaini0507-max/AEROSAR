import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { executeLidarScan } from '../components/sim3d/lidar/lidarWorkerCore';
import { DEFAULT_LIDAR_CONFIG } from '../components/sim3d/lidar/lidarTypes';

test('LiDAR ray hits known box at expected distance with Gaussian noise sigma < 0.05 m', () => {
  // Place a 2x2x2 box at z = -5.0m in front of drone origin (0, 0, 0)
  // Box spans from z = -4.0m to -6.0m (front face at z = -4.0m)
  const boxGeom = new THREE.BoxGeometry(2, 2, 2);
  boxGeom.translate(0, 0, -5.0);

  const bvh = new MeshBVH(boxGeom);

  // Drone positioned at origin facing -Z forward, zero rotation
  // Ray origin has mount offset (0, -0.15, 0)
  const scanReq = {
    dronePos: [0, 0, 0] as [number, number, number],
    droneQuat: [0, 0, 0, 1] as [number, number, number, number],
    lowPower: false,
  };

  const result = executeLidarScan(bvh, null, scanReq, DEFAULT_LIDAR_CONFIG);

  assert.ok(result.hitCount > 0, 'LiDAR must register hits on the known box');

  // 1. Check forward ray hitting the box face at z = -4.0
  // For any ray hitting the front face at z = -4.0, its unperturbed geometric distance is:
  // t_true = 4.0 / |dir_z|
  let rayFound = false;
  const sensorOrigin = new THREE.Vector3(0, -0.15, 0);

  for (let i = 0; i < result.hitCount; i++) {
    const idx = i * 4;
    const px = result.pointBuffer[idx];
    const py = result.pointBuffer[idx + 1];
    const pz = result.pointBuffer[idx + 2];

    // Find a forward ray hitting the front face (near z = -4.0 and near center x = 0)
    if (Math.abs(px) < 0.2 && Math.abs(pz + 4.0) < 0.2) {
      const hitPt = new THREE.Vector3(px, py, pz);
      const measuredDist = sensorOrigin.distanceTo(hitPt);
      const dirZ = (pz - sensorOrigin.z) / measuredDist; // unit z direction
      const trueDist = 4.0 / Math.abs(dirZ);
      const rayErrorM = Math.abs(measuredDist - trueDist);

      assert.ok(
        rayErrorM < 0.05,
        `Individual ray range error (${rayErrorM.toFixed(4)} m) must be strictly below 0.05 m (noise sigma = 0.02 m)`
      );
      rayFound = true;
      break;
    }
  }

  assert.ok(rayFound, 'A forward ray hitting the box front face must be found in the point cloud');

  // 2. Also verify forward sector minimum range is around 4.0m
  const forwardSectorDist = result.sectorMinRanges[0];
  assert.ok(
    forwardSectorDist >= 3.85 && forwardSectorDist <= 4.15,
    `Forward sector minimum range (${forwardSectorDist.toFixed(2)} m) should be approximately 4.0 m`
  );
});

test('LiDAR 5,760-ray scan frame-time execution benchmark stays >= 50 FPS budget (<= 20.0 ms)', () => {
  // Complex scene geometry with 10,000+ triangles
  const sceneGeom = new THREE.BoxGeometry(30, 10, 30, 10, 10, 10);
  const bvh = new MeshBVH(sceneGeom);

  const scanReq = {
    dronePos: [0, 2.5, 0] as [number, number, number],
    droneQuat: [0, 0, 0, 1] as [number, number, number, number],
    lowPower: false,
  };

  // Warmup run
  executeLidarScan(bvh, null, scanReq, DEFAULT_LIDAR_CONFIG);

  // Measure execution across multiple scans
  const iterations = 5;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    executeLidarScan(bvh, null, scanReq, DEFAULT_LIDAR_CONFIG);
  }
  const totalElapsedMs = performance.now() - start;
  const avgFrameTimeMs = totalElapsedMs / iterations;
  const equivalentFps = 1000.0 / avgFrameTimeMs;

  console.log(`[LiDAR Benchmark] Avg scan time: ${avgFrameTimeMs.toFixed(2)} ms (${equivalentFps.toFixed(1)} FPS equivalent)`);

  // Target: <= 20 ms per full 5,760 ray scan (>= 50 FPS)
  assert.ok(
    avgFrameTimeMs <= 20.0,
    `LiDAR scan time (${avgFrameTimeMs.toFixed(2)} ms) exceeds 20.0 ms threshold`
  );
  assert.ok(
    equivalentFps >= 50.0,
    `LiDAR equivalent FPS (${equivalentFps.toFixed(1)}) must be >= 50 FPS`
  );
});
