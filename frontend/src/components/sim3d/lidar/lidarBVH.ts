/**
 * Merged static geometry and BVH generator for LiDAR and radio LOS calculations.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MaterialType } from './lidarTypes';

export interface CollidableMeshEntry {
  mesh: THREE.Mesh;
  materialType: MaterialType;
}

export interface MergedBVHData {
  bvh: MeshBVH;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  indices: Uint32Array;
  materialIndexMap: Uint8Array; // per triangle material index: 0=concrete, 1=dirt, 2=metal, 3=debris, 4=water
}

const MATERIAL_MAP: Record<MaterialType, number> = {
  concrete: 0,
  dirt: 1,
  metal: 2,
  debris: 3,
  water: 4,
  human: 0,
  fire: 0,
  smoke: 0,
};

/**
 * Traverses an Object3D, collects all descendant meshes, and assigns a default material type.
 */
export function extractCollidableMeshes(
  root: THREE.Object3D,
  defaultMaterial: MaterialType = 'concrete'
): CollidableMeshEntry[] {
  const result: CollidableMeshEntry[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && mesh.geometry.attributes.position) {
        let mat = defaultMaterial;
        if (mesh.name.toLowerCase().includes('metal') || mesh.name.toLowerCase().includes('pipe')) {
          mat = 'metal';
        } else if (mesh.name.toLowerCase().includes('rubble') || mesh.name.toLowerCase().includes('debris')) {
          mat = 'debris';
        }
        result.push({ mesh, materialType: mat });
      }
    }
  });
  return result;
}

/**
 * Merges collidable meshes into a single world-space BufferGeometry and builds a MeshBVH.
 */
export function buildMergedSceneBVH(entries: CollidableMeshEntry[]): MergedBVHData {
  let totalVerts = 0;
  let totalIndices = 0;

  // First pass: calculate total vertex and index requirements
  for (const { mesh } of entries) {
    mesh.updateWorldMatrix(true, false);
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    if (!posAttr) continue;
    const vertCount = posAttr.count;
    totalVerts += vertCount;
    if (geom.index) {
      totalIndices += geom.index.count;
    } else {
      totalIndices += vertCount;
    }
  }

  const mergedPositions = new Float32Array(totalVerts * 3);
  const mergedIndices = new Uint32Array(totalIndices);
  const materialIndexMap = new Uint8Array(totalIndices / 3);

  let vertOffset = 0;
  let indexOffset = 0;
  let triangleOffset = 0;

  const tempVec = new THREE.Vector3();

  // Second pass: transform and pack into unified buffers
  for (const { mesh, materialType } of entries) {
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    if (!posAttr) continue;

    const count = posAttr.count;
    const matrix = mesh.matrixWorld;
    const baseVert = vertOffset / 3;
    const matCode = MATERIAL_MAP[materialType] ?? 0;

    for (let i = 0; i < count; i++) {
      tempVec.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      mergedPositions[vertOffset++] = tempVec.x;
      mergedPositions[vertOffset++] = tempVec.y;
      mergedPositions[vertOffset++] = tempVec.z;
    }

    if (geom.index) {
      const idxCount = geom.index.count;
      const idxArray = geom.index.array;
      for (let i = 0; i < idxCount; i++) {
        mergedIndices[indexOffset++] = idxArray[i] + baseVert;
      }
      const numTris = idxCount / 3;
      for (let t = 0; t < numTris; t++) {
        materialIndexMap[triangleOffset++] = matCode;
      }
    } else {
      for (let i = 0; i < count; i++) {
        mergedIndices[indexOffset++] = i + baseVert;
      }
      const numTris = count / 3;
      for (let t = 0; t < numTris; t++) {
        materialIndexMap[triangleOffset++] = matCode;
      }
    }
  }

  const mergedGeom = new THREE.BufferGeometry();
  mergedGeom.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
  mergedGeom.setIndex(new THREE.BufferAttribute(mergedIndices, 1));

  const bvh = new MeshBVH(mergedGeom);

  return {
    bvh,
    geometry: mergedGeom,
    positions: mergedPositions,
    indices: mergedIndices,
    materialIndexMap,
  };
}
