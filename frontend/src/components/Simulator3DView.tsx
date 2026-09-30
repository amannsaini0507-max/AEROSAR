import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MissionModel } from '../types';
import { geodeticToEnu } from '../lib/geo';

interface Simulator3DProps {
  model: MissionModel;
  onSendCommand?: (action: string, params?: Record<string, unknown>) => void;
  lowPower?: boolean;
}

export default function Simulator3DView({
  model,
  onSendCommand,
  lowPower = false,
}: Simulator3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [channel, setChannel] = useState<'rgb' | 'thermal'>('rgb');
  const [cameraMode, setCameraMode] = useState<'orbit' | 'drone_fpv' | 'top_down'>('orbit');
  const [manualActive, setManualActive] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [yoloMode, setYoloMode] = useState(false);

  // Three.js instances ref
  const simRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    mainCamera: THREE.PerspectiveCamera;
    droneGroup: THREE.Group;
    rotors: THREE.Mesh[];
    fireLight: THREE.PointLight;
    smokeParticles: THREE.Points;
    waterMesh: THREE.Mesh;
    dronePos: THREE.Vector3;
    droneVel: THREE.Vector3;
    droneRot: THREE.Euler;
    targetVel: THREE.Vector3;
    fpvCamera: THREE.PerspectiveCamera;
    renderTargetRGB: THREE.WebGLRenderTarget;
    renderTargetThermal: THREE.WebGLRenderTarget;
    thermalMaterial: THREE.ShaderMaterial;
    running: boolean;
  } | null>(null);

  const channelRef = useRef(channel);
  channelRef.current = channel;
  const cameraModeRef = useRef(cameraMode);
  cameraModeRef.current = cameraMode;
  const lowPowerRef = useRef(lowPower);
  lowPowerRef.current = lowPower;
  const gpsDeniedRef = useRef(gpsDenied);
  gpsDeniedRef.current = gpsDenied;

  // Initialize Three.js 3D WebGL Arena
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 360;

    // 1. Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: !lowPowerRef.current,
      powerPreference: 'high-performance',
      precision: 'mediump',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    if (!lowPowerRef.current) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f141c);
    scene.fog = new THREE.FogExp2(0x0f141c, 0.015);

    // 3. Cameras
    const mainCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 150);
    mainCamera.position.set(0, 18, 22);
    mainCamera.lookAt(0, 0, 0);

    const fpvCamera = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 60);
    fpvCamera.rotation.x = -Math.PI / 4; // 45 deg tilt down

    // Offscreen render targets for drone sensors (320x240)
    const renderTargetRGB = new THREE.WebGLRenderTarget(320, 240);
    const renderTargetThermal = new THREE.WebGLRenderTarget(320, 240);

    // Procedural terrain texture using offscreen canvas (Zero network assets)
    const canvasTex = document.createElement('canvas');
    canvasTex.width = 512;
    canvasTex.height = 512;
    const ctx = canvasTex.getContext('2d')!;
    ctx.fillStyle = '#2d3326';
    ctx.fillRect(0, 0, 512, 512);
    // Add procedural dirt/gravel speckles
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = Math.random() * 2 + 0.5;
      ctx.fillStyle = Math.random() > 0.5 ? '#1f241a' : '#3d4434';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const groundTexture = new THREE.CanvasTexture(canvasTex);
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(6, 6);

    // 4. Terrain: 30m x 30m Heightfield
    const terrainGeo = new THREE.PlaneGeometry(30, 30, 48, 48);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      // Gentle natural elevation variation
      const elevation =
        Math.sin(vx * 0.2) * Math.cos(vz * 0.2) * 0.45 +
        Math.sin(vx * 0.4 + 1.2) * 0.15;
      posAttr.setY(i, elevation);
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      map: groundTexture,
      roughness: 0.9,
      metalness: 0.1,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = !lowPowerRef.current;
    scene.add(terrainMesh);

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xddeeff, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8ee, 1.2);
    dirLight.position.set(12, 25, 10);
    if (!lowPowerRef.current) {
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 60;
      dirLight.shadow.camera.left = -16;
      dirLight.shadow.camera.right = 16;
      dirLight.shadow.camera.top = 16;
      dirLight.shadow.camera.bottom = -16;
    }
    scene.add(dirLight);

    // 6. ZONE A: Collapsed Ruins (-7, 6)
    const ruinsGroup = new THREE.Group();
    ruinsGroup.position.set(-7, 0, -6); // Note Three.js Z corresponds to -Y ENU
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x7a7d82, roughness: 0.85 });
    for (let i = 0; i < 9; i++) {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(0.8 + Math.random() * 0.8, 0.4 + Math.random() * 0.9, 0.7 + Math.random() * 0.8),
        concreteMat
      );
      block.position.set((Math.random() - 0.5) * 3, Math.random() * 0.4, (Math.random() - 0.5) * 3);
      block.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.3);
      block.castShadow = !lowPowerRef.current;
      ruinsGroup.add(block);
    }
    // Victim 1 (partly occluded)
    const victim1 = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 0.7, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3b6ea5 })
    );
    victim1.position.set(0.3, 0.25, 0.2);
    victim1.rotation.z = Math.PI / 2.2;
    ruinsGroup.add(victim1);
    scene.add(ruinsGroup);

    // 7. ZONE B: Flooded Basin (7, 7) -> (7, -7) in Three.js
    const waterGeo = new THREE.PlaneGeometry(7.5, 7.5);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1f5c88,
      roughness: 0.15,
      metalness: 0.7,
      transparent: true,
      opacity: 0.75,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(7, 0.1, -7);
    scene.add(waterMesh);

    // Victim 2 (floating marker nearby)
    const victim2 = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.8, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xe08a3c })
    );
    victim2.position.set(7.2, 0.2, -6.8);
    victim2.rotation.x = Math.PI / 2.5;
    scene.add(victim2);

    // 8. ZONE C: Fire Zone (6, -7) -> (6, 7) in Three.js
    const fireGroup = new THREE.Group();
    fireGroup.position.set(6, 0, 7);

    // Charred ground
    const charred = new THREE.Mesh(
      new THREE.CircleGeometry(3.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x121110 })
    );
    charred.rotateX(-Math.PI / 2);
    charred.position.y = 0.02;
    fireGroup.add(charred);

    // Flickering fire light
    const fireLight = new THREE.PointLight(0xff6600, 3.5, 12, 1.8);
    fireLight.position.set(0, 1.2, 0);
    fireGroup.add(fireLight);

    // Flame mesh core
    const flameCore = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 })
    );
    flameCore.position.set(0, 0.9, 0);
    fireGroup.add(flameCore);

    // Particle Smoke
    const smokeGeo = new THREE.BufferGeometry();
    const smokeCount = lowPowerRef.current ? 30 : 90;
    const smokePos = new Float32Array(smokeCount * 3);
    for (let i = 0; i < smokeCount; i++) {
      smokePos[i * 3] = (Math.random() - 0.5) * 1.5;
      smokePos[i * 3 + 1] = Math.random() * 3.5;
      smokePos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    }
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
    const smokeMat = new THREE.PointsMaterial({
      color: 0x555555,
      size: 0.35,
      transparent: true,
      opacity: 0.45,
    });
    const smokeParticles = new THREE.Points(smokeGeo, smokeMat);
    fireGroup.add(smokeParticles);

    // Victim 3 (within 5m of flame)
    const victim3 = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.8, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9383a })
    );
    victim3.position.set(-1.2, 0.25, 0.8);
    victim3.rotation.z = Math.PI / 2.3;
    fireGroup.add(victim3);
    scene.add(fireGroup);

    // 9. Quadrotor Drone Mesh
    const droneGroup = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });
    const bodyCenter = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), frameMat);
    droneGroup.add(bodyCenter);

    // 4 arms
    const armMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.65), armMat);
    arm1.rotation.z = Math.PI / 4;
    arm1.rotation.x = Math.PI / 2;
    droneGroup.add(arm1);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.65), armMat);
    arm2.rotation.z = -Math.PI / 4;
    arm2.rotation.x = Math.PI / 2;
    droneGroup.add(arm2);

    // 4 spinning rotors
    const rotors: THREE.Mesh[] = [];
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.65 });
    const rotorOffsets = [
      [0.28, 0.08, 0.28],
      [-0.28, 0.08, 0.28],
      [0.28, 0.08, -0.28],
      [-0.28, 0.08, -0.28],
    ];
    rotorOffsets.forEach(([rx, ry, rz]) => {
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.01, 12), rotorMat);
      rotor.position.set(rx, ry, rz);
      droneGroup.add(rotor);
      rotors.push(rotor);
    });

    droneGroup.position.set(0, 1.5, 0);
    droneGroup.add(fpvCamera);
    scene.add(droneGroup);

    // Thermal Palette Custom Shader
    const thermalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float brightness = dot(col.rgb, vec3(0.299, 0.587, 0.114));
          // Infernal Thermal Palette: dark purple -> magenta -> orange -> white
          vec3 c1 = vec3(0.05, 0.0, 0.2);
          vec3 c2 = vec3(0.6, 0.05, 0.5);
          vec3 c3 = vec3(1.0, 0.5, 0.0);
          vec3 c4 = vec3(1.0, 1.0, 0.9);
          vec3 finalColor = mix(c1, c2, smoothstep(0.0, 0.35, brightness));
          finalColor = mix(finalColor, c3, smoothstep(0.35, 0.7, brightness));
          finalColor = mix(finalColor, c4, smoothstep(0.7, 1.0, brightness));
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });

    // Fullscreen quad for thermal post-process shader
    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), thermalMaterial);
    postScene.add(postQuad);

    simRef.current = {
      renderer,
      scene,
      mainCamera,
      droneGroup,
      rotors,
      fireLight,
      smokeParticles,
      waterMesh,
      dronePos: new THREE.Vector3(0, 1.5, 0),
      droneVel: new THREE.Vector3(0, 0, 0),
      droneRot: new THREE.Euler(0, 0, 0),
      targetVel: new THREE.Vector3(0, 0, 0),
      fpvCamera,
      renderTargetRGB,
      renderTargetThermal,
      thermalMaterial,
      running: true,
    };

    // Animation & Physics Substepping Loop (Fixed 120 Hz dynamics step)
    let animId = 0;
    let lastTime = performance.now();
    const fixedDt = 1.0 / 120.0;
    let accumulator = 0.0;

    const renderLoop = (timeNow: number) => {
      if (!simRef.current?.running) return;

      const delta = (timeNow - lastTime) / 1000.0;
      lastTime = timeNow;
      accumulator = Math.min(0.2, accumulator + delta);

      // Dynamics Sub-stepping at 120 Hz (gym-pybullet-drones formulation)
      while (accumulator >= fixedDt) {
        accumulator -= fixedDt;
        const sim = simRef.current;
        if (!sim) break;

        // Rotor spin
        sim.rotors.forEach((r, idx) => {
          r.rotation.y += (idx % 2 === 0 ? 0.35 : -0.35);
        });

        // Fire flicker
        sim.fireLight.intensity = 3.0 + Math.sin(timeNow * 0.01) * 0.8 + Math.random() * 0.4;

        // Animate water
        sim.waterMesh.position.y = 0.1 + Math.sin(timeNow * 0.002) * 0.03;

        // Dynamics velocity tracking with drag and 1st order attitude
        const tau = 0.12; // attitude response time constant
        const targetPitch = -sim.targetVel.z * 0.18;
        const targetRoll = sim.targetVel.x * 0.18;

        sim.droneRot.x += (targetPitch - sim.droneRot.x) * (fixedDt / tau);
        sim.droneRot.z += (targetRoll - sim.droneRot.z) * (fixedDt / tau);

        // Position integration
        sim.dronePos.addScaledVector(sim.droneVel, fixedDt);
        // Drag damping
        sim.droneVel.addScaledVector(sim.targetVel.clone().sub(sim.droneVel), fixedDt * 3.5);

        // Keep drone inside 30m boundary
        sim.dronePos.x = Math.max(-14.5, Math.min(14.5, sim.dronePos.x));
        sim.dronePos.z = Math.max(-14.5, Math.min(14.5, sim.dronePos.z));
        sim.dronePos.y = Math.max(0.2, Math.min(15.0, sim.dronePos.y));

        sim.droneGroup.position.copy(sim.dronePos);
        sim.droneGroup.rotation.copy(sim.droneRot);
      }

      // Camera selection & Thermal vs RGB Render Pass
      const sim = simRef.current;
      if (sim) {
        let activeCam: THREE.PerspectiveCamera = sim.mainCamera;
        if (cameraModeRef.current === 'drone_fpv') {
          activeCam = sim.fpvCamera;
        } else if (cameraModeRef.current === 'top_down') {
          sim.mainCamera.position.set(0, 28, 0);
          sim.mainCamera.lookAt(0, 0, 0);
          activeCam = sim.mainCamera;
        } else {
          sim.mainCamera.position.x = sim.dronePos.x + 14 * Math.sin(timeNow * 0.0003);
          sim.mainCamera.position.z = sim.dronePos.z + 14 * Math.cos(timeNow * 0.0003);
          sim.mainCamera.position.y = Math.max(8, sim.dronePos.y + 7);
          sim.mainCamera.lookAt(sim.dronePos);
          activeCam = sim.mainCamera;
        }

        if (channelRef.current === 'thermal') {
          // Offscreen pass into render target texture
          sim.renderer.setRenderTarget(sim.renderTargetRGB);
          sim.renderer.render(sim.scene, activeCam);
          sim.renderer.setRenderTarget(null);

          // Thermal palette fragment shader pass
          sim.thermalMaterial.uniforms.tDiffuse.value = sim.renderTargetRGB.texture;
          sim.renderer.render(postScene, postCamera);
        } else {
          // Direct RGB render
          sim.renderer.setRenderTarget(null);
          sim.renderer.render(sim.scene, activeCam);
        }
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);

    const handleResize = () => {
      if (!container || !simRef.current) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 360;
      simRef.current.mainCamera.aspect = w / h;
      simRef.current.mainCamera.updateProjectionMatrix();
      simRef.current.renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (simRef.current) {
        simRef.current.running = false;
        simRef.current.renderer.dispose();
      }
    };
  }, []);

  // Sync drone position from model telemetry if in autonomous mode
  useEffect(() => {
    if (manualActive || !model.pose || !simRef.current) return;

    // Convert geodetic to local ENU
    const [x, y, z] = geodeticToEnu(model.pose.lat, model.pose.lng, model.pose.altitude ?? 1.5);
    // Three.js coords: X=East, Y=Altitude, Z=-North
    simRef.current.dronePos.set(x, z, -y);

    if (model.pose.heading != null) {
      simRef.current.droneRot.y = (-model.pose.heading * Math.PI) / 180.0;
    }
  }, [model.pose, manualActive]);

  // Keyboard navigation listener for manual flight override
  useEffect(() => {
    if (!manualActive) return;

    const keys: Record<string, boolean> = {};

    const updateVelocity = () => {
      if (!simRef.current) return;
      let vx = 0;
      let vz = 0;
      let vy = 0;

      if (keys['KeyW'] || keys['ArrowUp']) vz -= 2.0;
      if (keys['KeyS'] || keys['ArrowDown']) vz += 2.0;
      if (keys['KeyA'] || keys['ArrowLeft']) vx -= 2.0;
      if (keys['KeyD'] || keys['ArrowRight']) vx += 2.0;
      if (keys['Space']) vy += 1.5;
      if (keys['ShiftLeft'] || keys['KeyC']) vy -= 1.5;

      simRef.current.targetVel.set(vx, vy, vz);

      // Report manual velocity command to backend
      onSendCommand?.('manual_input', { vx, vy: -vz, vz: vy, yaw_rate: 0 });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      keys[e.code] = true;
      updateVelocity();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.code] = false;
      updateVelocity();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [manualActive, onSendCommand]);

  // Section 2: 5 Hz YOLO Frame Dispatch to Backend (optional YOLO CPU inference mode)
  useEffect(() => {
    if (!yoloMode) return;

    const interval = setInterval(async () => {
      const sim = simRef.current;
      if (!sim) return;
      try {
        const frameData = sim.renderer.domElement.toDataURL('image/jpeg', 0.5);
        await fetch('http://127.0.0.1:8000/api/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: frameData }),
        });
      } catch {
        // Fallback or offline silence
      }
    }, 200);

    return () => clearInterval(interval);
  }, [yoloMode]);

  // Command handlers
  const handleStart = () => onSendCommand?.('start');
  const handlePause = () => onSendCommand?.('pause');
  const handleResume = () => onSendCommand?.('resume');
  const handleRTL = () => onSendCommand?.('rtl');
  const handleEmergencyLand = () => onSendCommand?.('emergency_land');

  return (
    <section className="panel dashboard__sim3d" aria-label="Embedded 3D Disaster Arena Simulator">
      <div className="panel__head">
        <span className="panel__title">
          <span className="pulse-dot" style={{ position: 'static' }} />
          3D WebGL Simulator (Three.js 30m Arena)
        </span>
        <div className="segmented" role="tablist">
          <button
            type="button"
            className={'segmented__btn' + (channel === 'rgb' ? ' is-active' : '')}
            onClick={() => setChannel('rgb')}
          >
            RGB
          </button>
          <button
            type="button"
            className={'segmented__btn' + (channel === 'thermal' ? ' is-active' : '')}
            onClick={() => setChannel('thermal')}
          >
            Thermal
          </button>
        </div>
      </div>

      <div className="panel__body" style={{ position: 'relative', overflow: 'hidden' }}>
        {/* Three.js Canvas Container */}
        <div ref={containerRef} style={{ width: '100%', height: '320px', minHeight: '300px' }} />

        {/* View Mode Controls */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            display: 'flex',
            gap: '6px',
            background: 'rgba(15, 20, 28, 0.8)',
            padding: '4px 8px',
            borderRadius: '4px',
            zIndex: 10,
          }}
        >
          <button
            type="button"
            className={`btn-tag ${cameraMode === 'orbit' ? 'is-active' : ''}`}
            onClick={() => setCameraMode('orbit')}
          >
            Orbit
          </button>
          <button
            type="button"
            className={`btn-tag ${cameraMode === 'drone_fpv' ? 'is-active' : ''}`}
            onClick={() => setCameraMode('drone_fpv')}
          >
            Drone FPV
          </button>
          <button
            type="button"
            className={`btn-tag ${cameraMode === 'top_down' ? 'is-active' : ''}`}
            onClick={() => setCameraMode('top_down')}
          >
            Tactical Top
          </button>
        </div>

        {/* Sensor & Control Overlays */}
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            right: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(15, 20, 28, 0.85)',
            padding: '6px 12px',
            borderRadius: '6px',
            zIndex: 10,
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span><strong>Flight:</strong></span>
            <button type="button" className="btn-control" onClick={handleStart}>
              Start
            </button>
            <button type="button" className="btn-control" onClick={handlePause}>
              Pause
            </button>
            <button type="button" className="btn-control" onClick={handleResume}>
              Resume
            </button>
            <button type="button" className="btn-control" onClick={handleRTL}>
              RTL
            </button>
            <button
              type="button"
              className="btn-control btn-control--danger"
              onClick={handleEmergencyLand}
            >
              EMERGENCY LAND
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={manualActive}
                onChange={(e) => setManualActive(e.target.checked)}
              />
              Manual (WASD)
            </label>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={gpsDenied}
                onChange={(e) => {
                  setGpsDenied(e.target.checked);
                  onSendCommand?.('set_mode', { mode: e.target.checked ? 'GPS_DENIED' : 'GPS_NAV' });
                }}
              />
              GPS-Denied
            </label>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={yoloMode}
                onChange={(e) => setYoloMode(e.target.checked)}
              />
              YOLO Inference
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
