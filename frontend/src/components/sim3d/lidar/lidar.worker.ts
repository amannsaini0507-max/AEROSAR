/**
 * Dedicated Web Worker for LiDAR raycasting.
 * Offloads 5,760+ BVH raycasts per scan from the main render thread.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { executeLidarScan } from './lidarWorkerCore';
import {
  type LidarScanRequest,
  type LidarSensorConfig,
  DEFAULT_LIDAR_CONFIG,
} from './lidarTypes';

let bvh: MeshBVH | null = null;
let materialIndexMap: Uint8Array | null = null;
let sensorConfig: LidarSensorConfig = DEFAULT_LIDAR_CONFIG;

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    const { positions, indices, materials, config } = payload;
    if (config) sensorConfig = config;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));

    bvh = new MeshBVH(geom);
    materialIndexMap = materials;

    self.postMessage({ type: 'INIT_DONE' });
  } else if (type === 'SCAN') {
    const req = payload as LidarScanRequest;
    const result = executeLidarScan(bvh, materialIndexMap, req, sensorConfig);

    // Transfer pointBuffer ownership for zero-copy IPC
    (self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void }).postMessage(
      {
        type: 'SCAN_DONE',
        id: e.data.id,
        result: {
          pointCount: result.pointCount,
          sectorMinRanges: result.sectorMinRanges,
          hitCount: result.hitCount,
          scanTimeMs: result.scanTimeMs,
          pointBuffer: result.pointBuffer,
        },
      },
      [result.pointBuffer.buffer]
    );
  }
};
