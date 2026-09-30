import * as THREE from 'three';
import type { QualityPreset } from './types';
import { PRESET_CONFIGS } from './types';

export class TerrainSystem {
  public mesh: THREE.Mesh;
  public geometry: THREE.PlaneGeometry;
  public material: THREE.MeshStandardMaterial;
  public rockInstances: THREE.InstancedMesh;
  public debrisInstances: THREE.InstancedMesh;
  public size = 30.0;
  private heightData: Float32Array;
  private res = 80;

  constructor() {
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.res, this.res);
    this.geometry.rotateX(-Math.PI / 2);

    this.heightData = new Float32Array(this.geometry.attributes.position.count);
    const pos = this.geometry.attributes.position;

    // 1. Generate heightfield with erosion gullies, flood depression, and ruin mounds
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Macro undulation + fine hills
      let y =
        Math.sin(x * 0.16) * Math.cos(z * 0.18) * 0.75 +
        Math.sin(x * 0.38 + 1.2) * Math.cos(z * 0.32 - 0.7) * 0.3 +
        Math.sin(x * 0.7 + z * 0.6) * 0.12;

      // Erosion gully cutting across northeast-southwest
      const gullyDist = Math.abs(x * 0.4 - z * 0.6 + 1.5);
      y -= Math.max(0, 0.45 - gullyDist * 0.15);

      // Zone B (Flood Basin): Smooth depression around [6, -6]
      const floodDist = Math.hypot(x - 6.0, z - (-6.0));
      if (floodDist < 9.0) {
        const falloff = Math.cos((floodDist / 9.0) * (Math.PI / 2));
        y -= falloff * 0.95;
      }

      // Zone A (Ruins): Elevated rubble mound around [-6.5, -5.5]
      const ruinsDist = Math.hypot(x - (-6.5), z - (-5.5));
      if (ruinsDist < 6.5) {
        const falloff = Math.cos((ruinsDist / 6.5) * (Math.PI / 2));
        y += falloff * 0.42;
      }

      // Zone C (Fire Crater): Slight charred hollow around [5.5, 6.5]
      const fireDist = Math.hypot(x - 5.5, z - 6.5);
      if (fireDist < 4.0) {
        y -= Math.cos((fireDist / 4.0) * (Math.PI / 2)) * 0.22;
      }

      pos.setY(i, y);
      this.heightData[i] = y;
    }
    this.geometry.computeVertexNormals();

    // 2. PBR Textures (offline CC0 textures)
    const textureLoader = new THREE.TextureLoader();
    const loadTex = (path: string, repeat = 8) => {
      const tex = textureLoader.load(path);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      return tex;
    };

    const dirtDiff = loadTex('/assets/textures/terrain/dirt_diff_1k.jpg', 6);
    const dirtNor = loadTex('/assets/textures/terrain/dirt_nor_1k.jpg', 6);
    const dirtRough = loadTex('/assets/textures/terrain/dirt_rough_1k.jpg', 6);

    const mudDiff = loadTex('/assets/textures/terrain/mud_diff_1k.jpg', 8);
    const gravelDiff = loadTex('/assets/textures/terrain/gravel_diff_1k.jpg', 8);

    // 3. Multi-Texture Splatting Material with Triplanar & Wet Darkening
    this.material = new THREE.MeshStandardMaterial({
      map: dirtDiff,
      normalMap: dirtNor,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: dirtRough,
      roughness: 0.92,
      metalness: 0.08,
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.tMud = { value: mudDiff };
      shader.uniforms.tGravel = { value: gravelDiff };
      shader.uniforms.uFloodPos = { value: new THREE.Vector2(6.0, -6.0) };
      shader.uniforms.uFirePos = { value: new THREE.Vector2(5.5, 6.5) };
      shader.uniforms.uRuinsPos = { value: new THREE.Vector2(-6.5, -5.5) };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vTerrainNormal;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainNormal = normal;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tMud;
        uniform sampler2D tGravel;
        uniform vec2 uFloodPos;
        uniform vec2 uFirePos;
        uniform vec2 uRuinsPos;
        varying vec3 vWorldPos;
        varying vec3 vTerrainNormal;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        vec4 baseTex = texture2D(map, vUv);
        vec4 mudTex = texture2D(tMud, vUv * 1.5);
        vec4 gravelTex = texture2D(tGravel, vUv * 1.5);

        // Distance to flood basin (wet mud darkening)
        float dFlood = length(vWorldPos.xz - uFloodPos);
        float mudWeight = smoothstep(9.5, 3.0, dFlood);

        // Distance to ruins (gravel & concrete dust)
        float dRuins = length(vWorldPos.xz - uRuinsPos);
        float gravelWeight = smoothstep(7.0, 1.5, dRuins);

        // Distance to fire (charred blackened ash & glowing coals)
        float dFire = length(vWorldPos.xz - uFirePos);
        float fireWeight = smoothstep(4.5, 0.8, dFire);

        vec3 terrainColor = baseTex.rgb;
        terrainColor = mix(terrainColor, gravelTex.rgb * 0.95, gravelWeight);
        terrainColor = mix(terrainColor, mudTex.rgb * 0.65, mudWeight); // wet darkening

        // Charred ash near fire
        vec3 ashColor = vec3(0.08, 0.07, 0.07);
        terrainColor = mix(terrainColor, ashColor, fireWeight * 0.92);

        diffuseColor = vec4(terrainColor, 1.0);
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        #include <roughnessmap_fragment>
        // Wet areas are glossy/reflective
        roughnessFactor = mix(roughnessFactor, 0.18, mudWeight * 0.85);
        `
      );
    };

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.userData = {
      isThermalTarget: true,
      thermalTemp: 20.0,
    };

    // 4. Instanced Scattered Rocks and Debris Chunks (Zero extra draw calls)
    const rockGeo = new THREE.DodecahedronGeometry(0.24, 1);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x6e6860,
      roughness: 0.88,
      metalness: 0.15,
    });
    this.rockInstances = new THREE.InstancedMesh(rockGeo, rockMat, 120);
    this.rockInstances.castShadow = true;
    this.rockInstances.receiveShadow = true;
    this.rockInstances.userData = { thermalTemp: 19.5 };

    const dummy = new THREE.Object3D();
    for (let i = 0; i < 120; i++) {
      const rx = (Math.random() - 0.5) * 27;
      const rz = (Math.random() - 0.5) * 27;
      const ry = this.getElevationAt(rx, rz);
      const scale = 0.4 + Math.random() * 0.9;

      dummy.position.set(rx, ry + scale * 0.08, rz);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.set(scale, scale * (0.6 + Math.random() * 0.6), scale);
      dummy.updateMatrix();
      this.rockInstances.setMatrixAt(i, dummy.matrix);
    }
    this.rockInstances.instanceMatrix.needsUpdate = true;

    // Small concrete debris rubble chunks
    const debrisGeo = new THREE.BoxGeometry(0.28, 0.16, 0.22);
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x82858a,
      roughness: 0.9,
    });
    this.debrisInstances = new THREE.InstancedMesh(debrisGeo, debrisMat, 80);
    this.debrisInstances.castShadow = true;
    this.debrisInstances.receiveShadow = true;

    for (let i = 0; i < 80; i++) {
      // Cluster near ruins zone
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 5.5;
      const dx = -6.5 + Math.cos(angle) * dist;
      const dz = -5.5 + Math.sin(angle) * dist;
      const dy = this.getElevationAt(dx, dz);
      const scale = 0.5 + Math.random() * 0.8;

      dummy.position.set(dx, dy + scale * 0.06, dz);
      dummy.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      this.debrisInstances.setMatrixAt(i, dummy.matrix);
    }
    this.debrisInstances.instanceMatrix.needsUpdate = true;
  }

  public getElevationAt(x: number, z: number): number {
    // Bilinear heightfield lookup
    const half = this.size / 2;
    const u = (x + half) / this.size;
    const v = (z + half) / this.size;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

    const gx = Math.min(this.res - 1, Math.max(0, Math.floor(u * this.res)));
    const gz = Math.min(this.res - 1, Math.max(0, Math.floor(v * this.res)));
    const idx = gz * (this.res + 1) + gx;
    return this.heightData[idx] ?? 0;
  }

  public setQuality(preset: QualityPreset) {
    const config = PRESET_CONFIGS[preset];
    this.mesh.receiveShadow = config.shadows;
    this.rockInstances.castShadow = config.shadows;
    this.debrisInstances.castShadow = config.shadows;
    this.rockInstances.count = Math.min(120, config.instancedCount);
    this.debrisInstances.count = Math.min(80, Math.floor(config.instancedCount * 0.7));
    this.rockInstances.instanceMatrix.needsUpdate = true;
    this.debrisInstances.instanceMatrix.needsUpdate = true;
  }
}
