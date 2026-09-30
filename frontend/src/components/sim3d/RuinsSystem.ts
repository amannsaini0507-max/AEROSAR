import * as THREE from 'three';
import type { QualityPreset } from './types';
import { PRESET_CONFIGS } from './types';

export class RuinsSystem {
  public group: THREE.Group;
  public gpsDeniedZone: THREE.Group;
  public dustParticles: THREE.Points;
  public rubbleInstances: THREE.InstancedMesh;
  public position: THREE.Vector3;
  private dustPositions: Float32Array;
  private dustVelocities: Float32Array;
  private dustCount = 140;

  constructor(pos: [number, number, number] = [-6.5, 0, -5.5]) {
    this.group = new THREE.Group();
    this.position = new THREE.Vector3(...pos);
    this.group.position.copy(this.position);

    // Thermal properties
    this.group.userData = {
      isThermalTarget: true,
      thermalTemp: 18.5,
      label: 'Zone A Collapsed Ruins',
    };

    // Realistic concrete and steel PBR materials
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x8a8c91,
      roughness: 0.92,
      metalness: 0.05,
    });
    const darkConcreteMat = new THREE.MeshStandardMaterial({
      color: 0x5a5c61,
      roughness: 0.94,
      metalness: 0.04,
    });
    const rebarMat = new THREE.MeshStandardMaterial({
      color: 0x6e3822, // Rusted oxidized rebar steel
      roughness: 0.65,
      metalness: 0.8,
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x3d454a,
      roughness: 0.35,
      metalness: 0.85,
    });

    // 1. Tilted Collapsed Roof & Floor Slabs
    // Slab 1 (Heavily tilted, ground collapse)
    const slab1Geo = new THREE.BoxGeometry(4.2, 0.28, 3.6);
    const slab1 = new THREE.Mesh(slab1Geo, concreteMat);
    slab1.position.set(0.2, 1.3, -0.4);
    slab1.rotation.set(0.35, -0.2, 0.42);
    slab1.castShadow = true;
    slab1.receiveShadow = true;
    this.group.add(slab1);

    // Slab 2 (Upper floor partial collapse)
    const slab2Geo = new THREE.BoxGeometry(3.6, 0.24, 3.2);
    const slab2 = new THREE.Mesh(slab2Geo, darkConcreteMat);
    slab2.position.set(-0.8, 2.7, 0.2);
    slab2.rotation.set(-0.25, 0.35, -0.3);
    slab2.castShadow = true;
    slab2.receiveShadow = true;
    this.group.add(slab2);

    // 2. Broken Structural Columns & Modular Walls
    const colGeo = new THREE.BoxGeometry(0.35, 2.6, 0.35);
    const col1 = new THREE.Mesh(colGeo, concreteMat);
    col1.position.set(-1.6, 1.3, -1.4);
    col1.rotation.z = -0.12;
    col1.castShadow = true;
    this.group.add(col1);

    const col2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.4, 0.35), concreteMat);
    col2.position.set(1.4, 0.7, 1.2);
    col2.rotation.x = 0.28;
    col2.castShadow = true;
    this.group.add(col2);

    // Fractured upright wall fragment
    const wallGeo = new THREE.BoxGeometry(0.25, 2.8, 2.4);
    const wall = new THREE.Mesh(wallGeo, concreteMat);
    wall.position.set(-1.7, 1.4, 0.4);
    wall.rotation.y = 0.2;
    wall.castShadow = true;
    this.group.add(wall);

    // 3. Exposed Rebar Wire Meshes (Protruding from fractured concrete edges)
    const rebarGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6);
    const rebarConfigs = [
      { pos: [1.8, 1.6, -0.4], rot: [0.3, 0.2, 1.2] },
      { pos: [1.9, 1.4, -0.2], rot: [0.1, -0.4, 1.4] },
      { pos: [1.7, 1.8, -0.6], rot: [-0.2, 0.5, 1.1] },
      { pos: [-1.8, 2.9, 0.4], rot: [-0.4, 0.3, -1.3] },
      { pos: [-1.9, 2.7, 0.2], rot: [-0.2, -0.2, -1.4] },
    ];
    rebarConfigs.forEach((cfg) => {
      const rMesh = new THREE.Mesh(rebarGeo, rebarMat);
      rMesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      rMesh.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
      rMesh.castShadow = true;
      this.group.add(rMesh);
    });

    // 4. Broken Metal Conduits & Hanging Pipes
    const pipeGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8);
    const pipe1 = new THREE.Mesh(pipeGeo, pipeMat);
    pipe1.position.set(-0.6, 1.8, 1.4);
    pipe1.rotation.set(0.4, 0.3, 0.8);
    pipe1.castShadow = true;
    this.group.add(pipe1);

    // 5. Instanced Fractured Rubble Chunks (100+ irregular chunks in 1 draw call)
    const chunkGeo = new THREE.DodecahedronGeometry(0.22, 0);
    const chunkMat = new THREE.MeshStandardMaterial({
      color: 0x7c7e82,
      roughness: 0.9,
    });
    this.rubbleInstances = new THREE.InstancedMesh(chunkGeo, chunkMat, 100);
    this.rubbleInstances.castShadow = true;
    this.rubbleInstances.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < 100; i++) {
      const r = Math.random() * 3.4;
      const theta = Math.random() * Math.PI * 2;
      const rx = Math.cos(theta) * r;
      const rz = Math.sin(theta) * r;
      const ry = Math.max(0.08, 0.8 - r * 0.22 + Math.random() * 0.25);
      const scale = 0.5 + Math.random() * 0.9;

      dummy.position.set(rx, ry, rz);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.set(scale, scale * (0.6 + Math.random() * 0.7), scale);
      dummy.updateMatrix();
      this.rubbleInstances.setMatrixAt(i, dummy.matrix);
    }
    this.rubbleInstances.instanceMatrix.needsUpdate = true;
    this.group.add(this.rubbleInstances);

    // 6. Drifting Dust Particles (Soft particulate volume inside ruins)
    const textureLoader = new THREE.TextureLoader();
    const circleTex = textureLoader.load('/assets/textures/fx/circle.png');

    const dustGeo = new THREE.BufferGeometry();
    this.dustPositions = new Float32Array(this.dustCount * 3);
    this.dustVelocities = new Float32Array(this.dustCount * 3);

    for (let i = 0; i < this.dustCount; i++) {
      this.dustPositions[i * 3] = (Math.random() - 0.5) * 5.0;
      this.dustPositions[i * 3 + 1] = 0.2 + Math.random() * 3.5;
      this.dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 5.0;

      this.dustVelocities[i * 3] = (Math.random() - 0.5) * 0.15 + 0.08;
      this.dustVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.06;
      this.dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3));

    const dustMat = new THREE.PointsMaterial({
      map: circleTex,
      color: 0x9b9a96,
      size: 0.15,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.dustParticles = new THREE.Points(dustGeo, dustMat);
    this.group.add(this.dustParticles);

    // 7. GPS-Denied Zone Bounding Volume Overlay
    this.gpsDeniedZone = new THREE.Group();
    this.gpsDeniedZone.name = 'gps_denied_volume';

    // Faint boundary floor box
    const boxGeo = new THREE.BoxGeometry(6.5, 3.8, 6.5);
    const boxEdges = new THREE.EdgesGeometry(boxGeo);
    const boxLineMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.45 });
    const wireBox = new THREE.LineSegments(boxEdges, boxLineMat);
    wireBox.position.set(0, 1.9, 0);
    this.gpsDeniedZone.add(wireBox);

    // Floor grid overlay
    const gridOverlay = new THREE.GridHelper(6.5, 10, 0xffaa00, 0x554400);
    gridOverlay.position.set(0, 0.05, 0);
    (gridOverlay.material as THREE.Material).transparent = true;
    (gridOverlay.material as THREE.Material).opacity = 0.35;
    this.gpsDeniedZone.add(gridOverlay);

    this.gpsDeniedZone.visible = false; // Hidden by default; toggled via 'show zones'
    this.group.add(this.gpsDeniedZone);
  }

  public update(deltaSec: number, simTimeSec: number) {
    // Drifting dust particles
    const posAttr = this.dustParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.dustCount; i++) {
      this.dustPositions[i * 3] += this.dustVelocities[i * 3] * deltaSec;
      this.dustPositions[i * 3 + 1] += Math.sin(simTimeSec + i) * 0.005;
      this.dustPositions[i * 3 + 2] += this.dustVelocities[i * 3 + 2] * deltaSec;

      // Wrap around bounds
      if (this.dustPositions[i * 3] > 3.0) this.dustPositions[i * 3] = -3.0;
      if (this.dustPositions[i * 3] < -3.0) this.dustPositions[i * 3] = 3.0;
      if (this.dustPositions[i * 3 + 2] > 3.0) this.dustPositions[i * 3 + 2] = -3.0;
      if (this.dustPositions[i * 3 + 2] < -3.0) this.dustPositions[i * 3 + 2] = 3.0;
    }
    posAttr.needsUpdate = true;
  }

  public setShowZones(visible: boolean) {
    this.gpsDeniedZone.visible = visible;
  }

  public setQuality(preset: QualityPreset) {
    const config = PRESET_CONFIGS[preset];
    this.rubbleInstances.castShadow = config.shadows;
    this.rubbleInstances.count = Math.min(100, Math.floor(config.instancedCount * 0.8));
    this.rubbleInstances.instanceMatrix.needsUpdate = true;
    this.dustParticles.visible = preset !== 'low';
  }
}
