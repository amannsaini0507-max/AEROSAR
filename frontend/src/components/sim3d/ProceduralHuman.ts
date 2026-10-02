import * as THREE from 'three';

export interface HumanConfig {
  id: string;
  name: string;
  pose: 'prone' | 'seated' | 'trapped';
  clothingColor?: string | number;
  pantsColor?: string | number;
  tempC?: number;
}

export class ProceduralHuman {
  public group: THREE.Group;
  public chestMesh: THREE.Mesh;
  public headMesh: THREE.Mesh;
  public limbMeshes: THREE.Mesh[] = [];
  public breathPhase: number = Math.random() * Math.PI * 2;
  public id: string;
  public name: string;
  public basePose: 'prone' | 'seated' | 'trapped';
  public tempC: number;

  constructor(config: HumanConfig) {
    this.id = config.id;
    this.name = config.name;
    this.group = new THREE.Group();
    this.group.name = `human_${config.id}`;
    this.basePose = config.pose;
    this.tempC = config.tempC ?? 36.5;

    // Thermal attribute metadata
    this.group.userData = {
      isThermalTarget: true,
      thermalTemp: this.tempC,
      detectionId: config.id,
      label: config.name,
    };

    const jacketColor = config.clothingColor ? new THREE.Color(config.clothingColor) : new THREE.Color(0xd45028);
    const pantsColor = config.pantsColor ? new THREE.Color(config.pantsColor) : new THREE.Color(0x28384d);
    const skinColor = new THREE.Color(0xd9a07b);
    const bootsColor = new THREE.Color(0x1a1a1a);

    // Physically based materials with realistic roughness
    const jacketMat = new THREE.MeshStandardMaterial({
      color: jacketColor,
      roughness: 0.85,
      metalness: 0.05,
    });
    const pantsMat = new THREE.MeshStandardMaterial({
      color: pantsColor,
      roughness: 0.88,
      metalness: 0.05,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: skinColor,
      roughness: 0.65,
      metalness: 0.0,
    });
    const bootsMat = new THREE.MeshStandardMaterial({
      color: bootsColor,
      roughness: 0.7,
      metalness: 0.1,
    });

    // 1. Torso / Ribcage
    const chestGeo = new THREE.BoxGeometry(0.38, 0.44, 0.22);
    this.chestMesh = new THREE.Mesh(chestGeo, jacketMat);
    this.chestMesh.castShadow = true;
    this.chestMesh.receiveShadow = true;
    this.chestMesh.userData = { thermalTemp: this.tempC };
    this.group.add(this.chestMesh);

    // 2. Head with hair / cap
    const headGroup = new THREE.Group();
    const headGeo = new THREE.SphereGeometry(0.12, 12, 10);
    headGeo.scale(1.0, 1.15, 1.05);
    const headFace = new THREE.Mesh(headGeo, skinMat);
    headFace.castShadow = true;
    headFace.userData = { thermalTemp: this.tempC + 0.3 };
    headGroup.add(headFace);

    // Hair / cap cap
    const hairGeo = new THREE.SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x221a15, roughness: 0.9 });
    const hairMesh = new THREE.Mesh(hairGeo, hairMat);
    hairMesh.rotation.x = -0.15;
    headGroup.add(hairMesh);

    headGroup.position.set(0, 0.32, 0);
    this.headMesh = headFace;
    this.group.add(headGroup);

    // 3. Pelvis / Hips
    const pelvisGeo = new THREE.BoxGeometry(0.34, 0.18, 0.2);
    const pelvis = new THREE.Mesh(pelvisGeo, pantsMat);
    pelvis.position.set(0, -0.26, 0);
    pelvis.castShadow = true;
    pelvis.userData = { thermalTemp: this.tempC };
    this.group.add(pelvis);

    // 4. Limbs Setup depending on pose
    this.setupPose(jacketMat, pantsMat, skinMat, bootsMat, headGroup);
  }

  private setupPose(
    jacketMat: THREE.Material,
    pantsMat: THREE.Material,
    skinMat: THREE.Material,
    bootsMat: THREE.Material,
    headGroup: THREE.Group
  ) {
    const createLimb = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      pos: [number, number, number],
      rot: [number, number, number]
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { thermalTemp: this.tempC };
      this.limbMeshes.push(mesh);
      this.group.add(mesh);
      return mesh;
    };

    const armGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.32, 8);
    const forearmGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.28, 8);
    const thighGeo = new THREE.CylinderGeometry(0.09, 0.075, 0.42, 8);
    const calfGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.38, 8);
    const bootGeo = new THREE.BoxGeometry(0.11, 0.1, 0.22);

    if (this.basePose === 'prone') {
      // Body lying prone on ground (chest down / slight tilt)
      this.group.rotation.x = Math.PI / 2;
      this.group.rotation.z = 0.2;
      this.group.position.y = 0.12;

      // Arms splayed
      createLimb(armGeo, jacketMat, [-0.26, 0.12, 0.05], [0.3, 0.2, 0.8]);
      createLimb(forearmGeo, skinMat, [-0.44, 0.28, 0.05], [0.2, 0.1, 1.4]);
      createLimb(armGeo, jacketMat, [0.26, 0.14, 0.0], [0.1, -0.3, -0.7]);
      createLimb(forearmGeo, skinMat, [0.42, 0.32, 0.0], [0.1, -0.2, -1.2]);

      // Legs slightly parted
      createLimb(thighGeo, pantsMat, [-0.14, -0.52, 0.0], [0.1, 0.0, 0.15]);
      createLimb(calfGeo, pantsMat, [-0.18, -0.88, 0.0], [0.15, 0.0, 0.25]);
      createLimb(bootGeo, bootsMat, [-0.2, -1.06, 0.06], [-0.3, 0.0, 0.2]);

      createLimb(thighGeo, pantsMat, [0.14, -0.52, 0.0], [-0.1, 0.0, -0.15]);
      createLimb(calfGeo, pantsMat, [0.18, -0.88, 0.0], [-0.1, 0.0, -0.2]);
      createLimb(bootGeo, bootsMat, [0.2, -1.06, 0.06], [-0.3, 0.0, -0.2]);

      headGroup.rotation.y = 0.6; // head turned sideways
      headGroup.rotation.x = -0.3;
    } else if (this.basePose === 'seated') {
      // Sitting with knees drawn up, back slumped forward
      this.group.position.y = 0.32;
      this.chestMesh.rotation.x = 0.35; // slumped forward
      headGroup.position.set(0, 0.28, 0.1);
      headGroup.rotation.x = 0.4; // head lowered

      // Arms resting on knees
      createLimb(armGeo, jacketMat, [-0.24, 0.05, 0.12], [0.9, 0.3, 0.3]);
      createLimb(forearmGeo, skinMat, [-0.2, -0.1, 0.28], [1.3, -0.2, 0.1]);
      createLimb(armGeo, jacketMat, [0.24, 0.05, 0.12], [0.9, -0.3, -0.3]);
      createLimb(forearmGeo, skinMat, [0.2, -0.1, 0.28], [1.3, 0.2, -0.1]);

      // Bent thighs and calves
      createLimb(thighGeo, pantsMat, [-0.15, -0.22, 0.2], [-1.2, 0.15, 0]);
      createLimb(calfGeo, pantsMat, [-0.15, -0.18, 0.36], [0.35, 0, 0]);
      createLimb(bootGeo, bootsMat, [-0.15, -0.36, 0.42], [0, 0, 0]);

      createLimb(thighGeo, pantsMat, [0.15, -0.22, 0.2], [-1.2, -0.15, 0]);
      createLimb(calfGeo, pantsMat, [0.15, -0.18, 0.36], [0.35, 0, 0]);
      createLimb(bootGeo, bootsMat, [0.15, -0.36, 0.42], [0, 0, 0]);
    } else {
      // Trapped pose (lower torso & legs pinned, one arm reaching out)
      this.group.rotation.x = Math.PI / 2.3;
      this.group.rotation.z = -0.4;
      this.group.position.y = 0.16;

      createLimb(armGeo, jacketMat, [-0.26, 0.15, 0.0], [-0.2, 0.2, 1.2]); // reaching arm
      createLimb(forearmGeo, skinMat, [-0.48, 0.35, 0.05], [-0.1, 0.1, 1.6]);
      createLimb(armGeo, jacketMat, [0.24, 0.08, -0.05], [0.3, -0.2, -0.5]);

      // One visible pinned leg
      createLimb(thighGeo, pantsMat, [0.16, -0.48, 0.05], [0.2, 0, -0.2]);
      createLimb(calfGeo, pantsMat, [0.22, -0.84, 0.1], [0.4, 0, -0.15]);
      createLimb(bootGeo, bootsMat, [0.26, -1.02, 0.18], [0.1, 0, -0.1]);

      headGroup.rotation.y = -0.5;
    }
  }

  public update(timeSec: number) {
    // Subtle, believable breathing motion (~0.25 Hz = 15 breaths per minute)
    const breathRate = 1.6; // rad/sec
    const breathVal = Math.sin(timeSec * breathRate + this.breathPhase);

    // Torso expand / contract
    const chestScale = 1.0 + breathVal * 0.035;
    this.chestMesh.scale.set(chestScale, 1.0 + breathVal * 0.02, chestScale);

    // Subtle head tilt synchronized with respiration
    if (this.headMesh.parent) {
      this.headMesh.parent.position.y = (this.basePose === 'seated' ? 0.28 : 0.32) + breathVal * 0.008;
    }
  }
}
