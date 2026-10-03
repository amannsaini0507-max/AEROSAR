import * as THREE from 'three';

export class DroneModel {
  public group: THREE.Group;
  public rotors: THREE.Group[] = [];
  public rotorBlades: THREE.Mesh[] = [];
  public rotorBlurs: THREE.Mesh[] = [];
  public strobeLight: THREE.PointLight;
  public statusLedMesh: THREE.Mesh;
  public blobShadow: THREE.Mesh;
  public fpvMount: THREE.Group;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'quadrotor_uav';

    // Thermal properties for drone (motors warm, chassis ambient)
    this.group.userData = {
      isThermalTarget: true,
      thermalTemp: 28.0,
      detectionId: 'drone_uav_01',
    };

    // Carbon fiber and alloy PBR materials
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x181a1d,
      roughness: 0.35,
      metalness: 0.85,
    });
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0x3d444d,
      roughness: 0.25,
      metalness: 0.9,
    });
    const motorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c0e,
      roughness: 0.2,
      metalness: 0.95,
    });
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0xe68a19, // Search & Rescue emergency safety orange
      roughness: 0.3,
      metalness: 0.1,
    });

    // 1. Central Chassis Body
    const bodyCenter = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.32), carbonMat);
    bodyCenter.castShadow = true;
    bodyCenter.receiveShadow = true;
    bodyCenter.userData = { thermalTemp: 26.0 };
    this.group.add(bodyCenter);

    // Aerodynamic orange canopy shell
    const canopyGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.06, 6);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 0.07;
    canopy.castShadow = true;
    canopy.userData = { thermalTemp: 25.0 };
    this.group.add(canopy);

    // Drone-Mounted 16-Channel LiDAR Scanner Puck (Mounted underneath chassis)
    const lidarPuckGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16);
    const lidarPuckMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.2,
      metalness: 0.9,
    });
    const lidarPuck = new THREE.Mesh(lidarPuckGeo, lidarPuckMat);
    lidarPuck.position.set(0, -0.08, 0);
    lidarPuck.castShadow = true;
    // Optical NIR sensor ring
    const opticalRingGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.015, 16);
    const opticalRingMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.5,
      emissive: 0x0369a1,
      emissiveIntensity: 0.5,
    });
    const opticalRing = new THREE.Mesh(opticalRingGeo, opticalRingMat);
    opticalRing.position.set(0, -0.08, 0);
    this.group.add(lidarPuck);
    this.group.add(opticalRing);

    // 2. Landing Gear Skids
    const skidMat = new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.6, metalness: 0.5 });
    const createSkid = (sideX: number) => {
      const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18), skidMat);
      leg1.position.set(sideX, -0.09, 0.12);
      leg1.rotation.x = -0.3;
      leg1.castShadow = true;
      this.group.add(leg1);

      const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18), skidMat);
      leg2.position.set(sideX, -0.09, -0.12);
      leg2.rotation.x = 0.3;
      leg2.castShadow = true;
      this.group.add(leg2);

      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42), skidMat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(sideX, -0.17, 0);
      bar.castShadow = true;
      this.group.add(bar);
    };
    createSkid(0.18);
    createSkid(-0.18);

    // 3. Four Quadrotor Arms (X configuration, 45 degree symmetry)
    const armGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.44, 8);
    const armOffsets = [
      { angle: Math.PI / 4, x: 0.28, z: 0.28, isFront: true, isRight: true },
      { angle: -Math.PI / 4, x: -0.28, z: 0.28, isFront: true, isRight: false },
      { angle: (3 * Math.PI) / 4, x: 0.28, z: -0.28, isFront: false, isRight: true },
      { angle: (-3 * Math.PI) / 4, x: -0.28, z: -0.28, isFront: false, isRight: false },
    ];

    armOffsets.forEach((cfg) => {
      const arm = new THREE.Mesh(armGeo, carbonMat);
      arm.rotation.y = cfg.angle;
      arm.rotation.z = Math.PI / 2;
      arm.position.set(cfg.x * 0.5, 0.01, cfg.z * 0.5);
      arm.castShadow = true;
      this.group.add(arm);

      // Motor Pod
      const motorPod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.065, 12), motorMat);
      motorPod.position.set(cfg.x, 0.04, cfg.z);
      motorPod.castShadow = true;
      motorPod.userData = { thermalTemp: 44.0 }; // Warm brushless motor
      this.group.add(motorPod);

      // Rotor Assembly
      const rotorGroup = new THREE.Group();
      rotorGroup.position.set(cfg.x, 0.08, cfg.z);

      // Blade geometry (2-blade propeller)
      const bladeGeo = new THREE.BoxGeometry(0.34, 0.005, 0.024);
      const blade = new THREE.Mesh(bladeGeo, alloyMat);
      blade.castShadow = true;
      rotorGroup.add(blade);
      this.rotorBlades.push(blade);

      // Rotor motion blur disc (translucent cylinder)
      const blurGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.004, 20);
      const blurMat = new THREE.MeshBasicMaterial({
        color: 0x90caf9,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
      const blur = new THREE.Mesh(blurGeo, blurMat);
      blur.position.y = 0.005;
      rotorGroup.add(blur);
      this.rotorBlurs.push(blur);

      this.rotors.push(rotorGroup);
      this.group.add(rotorGroup);

      // Navigation LEDs on motor tips
      const ledColor = cfg.isFront ? (cfg.isRight ? 0x00ff44 : 0xff2222) : 0xffffff;
      const ledMat = new THREE.MeshBasicMaterial({ color: ledColor });
      const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), ledMat);
      ledMesh.position.set(cfg.x * 1.08, 0.01, cfg.z * 1.08);
      this.group.add(ledMesh);
    });

    // 4. Dual Sensor Camera Gimbal
    this.fpvMount = new THREE.Group();
    this.fpvMount.position.set(0, -0.06, 0.14);
    this.fpvMount.rotation.x = -Math.PI / 4; // 45 deg down

    const gimbalHousing = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.08), carbonMat);
    this.fpvMount.add(gimbalHousing);

    // RGB Lens (Left)
    const rgbLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.02, 10),
      new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.9 })
    );
    rgbLens.rotation.x = Math.PI / 2;
    rgbLens.position.set(-0.025, 0, 0.04);
    this.fpvMount.add(rgbLens);

    // Germanium Thermal Lens (Right)
    const thermalLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.02, 10),
      new THREE.MeshStandardMaterial({ color: 0x332211, roughness: 0.15, metalness: 0.85 })
    );
    thermalLens.rotation.x = Math.PI / 2;
    thermalLens.position.set(0.025, 0, 0.04);
    this.fpvMount.add(thermalLens);

    this.group.add(this.fpvMount);

    // 5. Strobe Beacon Light
    this.strobeLight = new THREE.PointLight(0xffffff, 0, 4, 2);
    this.strobeLight.position.set(0, 0.12, -0.08);
    this.group.add(this.strobeLight);

    const statusLedMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.statusLedMesh = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), statusLedMat);
    this.statusLedMesh.position.set(0, 0.11, -0.08);
    this.group.add(this.statusLedMesh);

    // 6. Dynamic Ground Blob Shadow (Smooth contact shadow below drone)
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d')!;
    const gradient = sctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.6,
    });
    this.blobShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), shadowMat);
    this.blobShadow.rotation.x = -Math.PI / 2;
    this.blobShadow.position.y = 0.02;
    this.blobShadow.renderOrder = 2;
  }

  public update(deltaSec: number, simTimeSec: number, droneAltitude: number, isGpsDenied: boolean) {
    // 1. High-speed rotor rotation (alternating CW / CCW directions)
    const spinSpeed = 48.0; // rad/sec
    this.rotors.forEach((rotor, idx) => {
      const dir = idx % 2 === 0 ? 1 : -1;
      rotor.rotation.y += dir * spinSpeed * deltaSec;
    });

    // 2. Navigation strobe pulse (2 Hz flashing)
    const strobeFreq = 2.0;
    const strobeOn = (simTimeSec * strobeFreq) % 1.0 < 0.15;
    this.strobeLight.intensity = strobeOn ? 3.0 : 0.0;

    // 3. Status LED color (Green = GPS_NAV, Flashing Blue/Amber = GPS_DENIED)
    const ledMat = this.statusLedMesh.material as THREE.MeshBasicMaterial;
    if (isGpsDenied) {
      const blink = Math.sin(simTimeSec * 10) > 0;
      ledMat.color.setHex(blink ? 0xffaa00 : 0x0044ff);
    } else {
      ledMat.color.setHex(0x00ff88);
    }

    // 4. Ground Blob Shadow update
    if (this.blobShadow) {
      // Scale shadow with altitude
      const alt = Math.max(0.1, droneAltitude);
      const scale = Math.min(3.5, 1.0 + alt * 0.25);
      this.blobShadow.scale.set(scale, scale, 1);
      // Fade out with altitude
      const mat = this.blobShadow.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0.08, 0.65 - alt * 0.04);
      // Place directly underneath drone on ground plane
      this.blobShadow.position.x = this.group.position.x;
      this.blobShadow.position.z = this.group.position.z;
    }
  }
}
