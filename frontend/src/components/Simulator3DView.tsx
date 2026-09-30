import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { MissionModel } from '../types';
import { geodeticToEnu } from '../lib/geo';
import type { CameraViewMode, LightingVariant, QualityPreset, SensorChannel } from './sim3d/types';
import { EnvironmentSystem } from './sim3d/EnvironmentSystem';
import { TerrainSystem } from './sim3d/TerrainSystem';
import { FireSmokeSystem } from './sim3d/FireSmokeSystem';
import { WaterSystem } from './sim3d/WaterSystem';
import { RuinsSystem } from './sim3d/RuinsSystem';
import { DroneModel } from './sim3d/DroneModel';
import { ThermalPipeline } from './sim3d/ThermalPipeline';
import { PostProcessingPipeline } from './sim3d/PostProcessingPipeline';
import { ScenarioManager } from './sim3d/ScenarioManager';
import { PhotoModeManager } from './sim3d/PhotoMode';

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // UI States
  const [channel, setChannel] = useState<SensorChannel>('rgb');
  const [cameraMode, setCameraMode] = useState<CameraViewMode>('orbit');
  const [preset, setPreset] = useState<QualityPreset>(lowPower ? 'low' : 'high');
  const [lighting, setLighting] = useState<LightingVariant>('day');
  const [scenarioId, setScenarioId] = useState<string>('2'); // Scenario 2 (Fire & Critical Survivor) default primary demo
  const [showZones, setShowZones] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [photoModeActive, setPhotoModeActive] = useState<boolean>(false);
  const [photoResolution, setPhotoResolution] = useState<'viewport' | '1080p' | '2k' | '4k'>('1080p');
  const [manualActive, setManualActive] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [yoloMode, setYoloMode] = useState(false);
  const [liveFps, setLiveFps] = useState<number>(60.0);
  const [liveMs, setLiveMs] = useState<number>(16.6);

  // Simulation instances ref
  const simRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    mainCamera: THREE.PerspectiveCamera;
    fpvCamera: THREE.PerspectiveCamera;
    envSystem: EnvironmentSystem;
    terrainSystem: TerrainSystem;
    fireSmokeSystem: FireSmokeSystem;
    waterSystem: WaterSystem;
    ruinsSystem: RuinsSystem;
    drone: DroneModel;
    thermalPipeline: ThermalPipeline;
    postProcessing: PostProcessingPipeline;
    scenarioManager: ScenarioManager;
    photoMode: PhotoModeManager;
    dronePos: THREE.Vector3;
    droneVel: THREE.Vector3;
    droneRot: THREE.Euler;
    targetVel: THREE.Vector3;
    running: boolean;
  } | null>(null);

  const channelRef = useRef(channel);
  channelRef.current = channel;
  const cameraModeRef = useRef(cameraMode);
  cameraModeRef.current = cameraMode;
  const photoModeRef = useRef(photoModeActive);
  photoModeRef.current = photoModeActive;

  // Initialize Three.js high-fidelity WebGL scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 360;

    // 1. Physically Based WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      precision: 'highp',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    canvasRef.current = renderer.domElement;

    // 2. Main Scene & Atmospheric Fog
    const scene = new THREE.Scene();

    // 3. Perspective Cameras
    const mainCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
    mainCamera.position.set(0, 18, 22);
    mainCamera.lookAt(0, 0, 0);

    const fpvCamera = new THREE.PerspectiveCamera(72, 4 / 3, 0.1, 80);
    fpvCamera.rotation.x = -Math.PI / 4; // 45 deg forward-downward tactical angle

    // 4. Subsystem Instantiations
    const envSystem = new EnvironmentSystem(scene, renderer);
    const terrainSystem = new TerrainSystem();
    scene.add(terrainSystem.mesh);
    scene.add(terrainSystem.rockInstances);
    scene.add(terrainSystem.debrisInstances);

    const waterSystem = new WaterSystem();
    scene.add(waterSystem.mesh);
    scene.add(waterSystem.debrisGroup);

    const fireSmokeSystem = new FireSmokeSystem();
    scene.add(fireSmokeSystem.group);

    const ruinsSystem = new RuinsSystem();
    scene.add(ruinsSystem.group);

    const drone = new DroneModel();
    drone.group.position.set(0, 1.5, 0);
    drone.fpvMount.add(fpvCamera);
    scene.add(drone.group);
    scene.add(drone.blobShadow);

    const thermalPipeline = new ThermalPipeline();
    const postProcessing = new PostProcessingPipeline(renderer, scene, mainCamera, width, height);
    const scenarioManager = new ScenarioManager(
      scene,
      terrainSystem,
      fireSmokeSystem,
      waterSystem,
      ruinsSystem,
      envSystem
    );
    const photoMode = new PhotoModeManager(renderer, scene, mainCamera, renderer.domElement);

    simRef.current = {
      renderer,
      scene,
      mainCamera,
      fpvCamera,
      envSystem,
      terrainSystem,
      fireSmokeSystem,
      waterSystem,
      ruinsSystem,
      drone,
      thermalPipeline,
      postProcessing,
      scenarioManager,
      photoMode,
      dronePos: new THREE.Vector3(0, 1.5, 0),
      droneVel: new THREE.Vector3(0, 0, 0),
      droneRot: new THREE.Euler(0, 0, 0),
      targetVel: new THREE.Vector3(0, 0, 0),
      running: true,
    };

    // Load initial scenario (Scenario 2: Fire + Smoke + Critical Survivor)
    scenarioManager.loadScenario(scenarioId, lighting);

    // 5. High-Precision Fixed-Step Dynamics & Rendering Loop
    let animId = 0;
    let lastTime = performance.now();
    const fixedDt = 1.0 / 120.0;
    let accumulator = 0.0;
    let fpsUpdateTimer = 0;
    let offscreenSensorTimer = 0;

    const renderLoop = (timeNow: number) => {
      if (!simRef.current?.running) return;

      const delta = Math.min(0.1, (timeNow - lastTime) / 1000.0);
      lastTime = timeNow;
      const sim = simRef.current;

      // In Photo Mode, pause simulation dynamics and update orbit controls
      if (photoModeRef.current) {
        sim.photoMode.update();
        sim.postProcessing.render(delta);
        animId = requestAnimationFrame(renderLoop);
        return;
      }

      accumulator += delta;
      // Fixed 120 Hz Sub-stepping (gym-pybullet-drones aerodynamics)
      while (accumulator >= fixedDt) {
        accumulator -= fixedDt;

        // Dynamics velocity tracking & 1st order attitude response
        const tau = 0.12;
        const targetPitch = -sim.targetVel.z * 0.18;
        const targetRoll = sim.targetVel.x * 0.18;

        sim.droneRot.x += (targetPitch - sim.droneRot.x) * (fixedDt / tau);
        sim.droneRot.z += (targetRoll - sim.droneRot.z) * (fixedDt / tau);

        sim.dronePos.addScaledVector(sim.droneVel, fixedDt);
        sim.droneVel.addScaledVector(sim.targetVel.clone().sub(sim.droneVel), fixedDt * 3.8);

        // Keep drone within 30m x 30m arena boundaries
        sim.dronePos.x = Math.max(-14.5, Math.min(14.5, sim.dronePos.x));
        sim.dronePos.z = Math.max(-14.5, Math.min(14.5, sim.dronePos.z));
        sim.dronePos.y = Math.max(0.2, Math.min(16.0, sim.dronePos.y));

        sim.drone.group.position.copy(sim.dronePos);
        sim.drone.group.rotation.copy(sim.droneRot);
      }

      const simTimeSec = timeNow / 1000.0;

      // Update Subsystems
      sim.drone.update(delta, simTimeSec, sim.dronePos.y, gpsDenied);
      sim.fireSmokeSystem.update(delta, simTimeSec);
      sim.waterSystem.update(simTimeSec);
      sim.ruinsSystem.update(delta, simTimeSec);
      sim.scenarioManager.update(simTimeSec);

      // Camera Positioning Mode
      let activeCam: THREE.PerspectiveCamera = sim.mainCamera;
      if (cameraModeRef.current === 'drone_fpv') {
        activeCam = sim.fpvCamera;
      } else if (cameraModeRef.current === 'top_down') {
        sim.mainCamera.position.set(0, 32, 0);
        sim.mainCamera.lookAt(0, 0, 0);
        activeCam = sim.mainCamera;
      } else if (cameraModeRef.current === 'ruins_cam') {
        sim.mainCamera.position.set(-11, 4.5, -9);
        sim.mainCamera.lookAt(-6.5, 1.2, -5.5);
        activeCam = sim.mainCamera;
      } else if (cameraModeRef.current === 'fire_cam') {
        sim.mainCamera.position.set(2.5, 2.5, 3.5);
        sim.mainCamera.lookAt(5.5, 1.2, 6.5);
        activeCam = sim.mainCamera;
      } else if (cameraModeRef.current === 'flood_cam') {
        sim.mainCamera.position.set(2.0, 3.0, -10.5);
        sim.mainCamera.lookAt(6.0, 0.2, -6.0);
        activeCam = sim.mainCamera;
      } else {
        // Orbit mode around active drone
        const orbitRadius = 13.5;
        const orbitSpeed = 0.00025;
        sim.mainCamera.position.x = sim.dronePos.x + orbitRadius * Math.sin(timeNow * orbitSpeed);
        sim.mainCamera.position.z = sim.dronePos.z + orbitRadius * Math.cos(timeNow * orbitSpeed);
        sim.mainCamera.position.y = Math.max(7.5, sim.dronePos.y + 6.5);
        sim.mainCamera.lookAt(sim.dronePos);
        activeCam = sim.mainCamera;
      }

      // Sensor Render Targets (Dual RGB / Thermal at 320x240, 10-15 Hz budget)
      offscreenSensorTimer += delta;
      if (offscreenSensorTimer >= 0.08) {
        offscreenSensorTimer = 0;
        // Offscreen RGB Sensor pass
        sim.renderer.setRenderTarget(sim.thermalPipeline.renderTargetRGB);
        sim.renderer.render(sim.scene, sim.fpvCamera);

        // Offscreen Thermal Sensor pass
        sim.thermalPipeline.renderThermalPass(
          sim.renderer,
          sim.scene,
          sim.fpvCamera,
          sim.thermalPipeline.renderTargetThermal
        );
        sim.renderer.setRenderTarget(null);
      }

      // Main Viewport Render
      if (channelRef.current === 'thermal') {
        // Render calibrated false-color thermal pass to viewport
        sim.thermalPipeline.renderThermalPass(sim.renderer, sim.scene, activeCam, null);
      } else {
        // High-fidelity PBR pass with postprocessing
        sim.postProcessing.camera = activeCam;
        sim.postProcessing.renderPass.camera = activeCam;
        sim.postProcessing.render(delta);
      }

      // Adaptive framerate protection monitoring
      const curW = container?.clientWidth || 640;
      const curH = container?.clientHeight || 360;
      sim.postProcessing.updateAdaptiveResolution(curW, curH);

      fpsUpdateTimer += delta;
      if (fpsUpdateTimer >= 0.5) {
        fpsUpdateTimer = 0;
        setLiveFps(sim.postProcessing.currentFps);
        setLiveMs(sim.postProcessing.currentFrameTimeMs);
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
      simRef.current.postProcessing.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (simRef.current) {
        simRef.current.running = false;
        simRef.current.envSystem.dispose();
        simRef.current.thermalPipeline.dispose();
        simRef.current.postProcessing.dispose();
        simRef.current.photoMode.dispose();
        simRef.current.renderer.dispose();
      }
    };
  }, []);

  // Update Quality Preset
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !containerRef.current) return;
    const w = containerRef.current.clientWidth || 640;
    const h = containerRef.current.clientHeight || 360;
    sim.envSystem.setQuality(preset);
    sim.terrainSystem.setQuality(preset);
    sim.fireSmokeSystem.setQuality(preset);
    sim.waterSystem.setQuality(preset);
    sim.ruinsSystem.setQuality(preset);
    sim.postProcessing.setPreset(preset, w, h);
  }, [preset]);

  // Update Lighting Variant
  useEffect(() => {
    simRef.current?.envSystem.setLighting(lighting);
  }, [lighting]);

  // Update Scenario
  const handleScenarioChange = useCallback(
    (id: string) => {
      setScenarioId(id);
      simRef.current?.scenarioManager.loadScenario(id, lighting).then((def) => {
        if (def.default_lighting && lighting === 'day') {
          setLighting(def.default_lighting);
        }
      });
    },
    [lighting]
  );

  // Update Zone Overlay
  useEffect(() => {
    simRef.current?.ruinsSystem.setShowZones(showZones);
  }, [showZones]);

  // Sync drone position from model telemetry in autonomous mode
  useEffect(() => {
    if (manualActive || !model.pose || !simRef.current) return;
    const [x, y, z] = geodeticToEnu(model.pose.lat, model.pose.lng, model.pose.altitude ?? 1.5);
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

      if (keys['KeyW'] || keys['ArrowUp']) vz -= 2.5;
      if (keys['KeyS'] || keys['ArrowDown']) vz += 2.5;
      if (keys['KeyA'] || keys['ArrowLeft']) vx -= 2.5;
      if (keys['KeyD'] || keys['ArrowRight']) vx += 2.5;
      if (keys['Space']) vy += 2.0;
      if (keys['ShiftLeft'] || keys['KeyC']) vy -= 2.0;

      simRef.current.targetVel.set(vx, vy, vz);
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

  // 5 Hz YOLO Frame Dispatch to Backend
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
        // Fallback silence
      }
    }, 200);
    return () => clearInterval(interval);
  }, [yoloMode]);

  // Photo Mode handlers
  const handleTogglePhotoMode = () => {
    if (!simRef.current) return;
    if (photoModeActive) {
      simRef.current.photoMode.exitPhotoMode();
      setPhotoModeActive(false);
    } else {
      simRef.current.photoMode.enterPhotoMode();
      setPhotoModeActive(true);
    }
  };

  const handleCapturePhoto = async () => {
    if (!simRef.current) return;
    await simRef.current.photoMode.captureSnapshot({
      resolution: photoResolution,
      fileNamePrefix: `aerosar_scenario_${scenarioId}`,
    });
  };

  // Command handlers
  const handleStart = () => onSendCommand?.('start');
  const handlePause = () => onSendCommand?.('pause');
  const handleResume = () => onSendCommand?.('resume');
  const handleRTL = () => onSendCommand?.('rtl');
  const handleEmergencyLand = () => onSendCommand?.('emergency_land');

  // Fullscreen container style
  const panelStyle: React.CSSProperties = isFullscreen
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        background: '#0a0d14',
        margin: 0,
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        position: 'relative',
      };

  const canvasHeight = isFullscreen ? 'calc(100vh - 120px)' : '380px';

  return (
    <section
      className={`panel dashboard__sim3d ${isFullscreen ? 'is-fullscreen' : ''}`}
      style={panelStyle}
      aria-label="Near-Photorealistic 3D Disaster Arena"
    >
      {/* Top Header Bar */}
      <div className="panel__head" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="pulse-dot" style={{ position: 'static' }} />
          <span className="panel__title">
            3D Tactical Arena (Three.js WebGL)
          </span>
          <span
            style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              padding: '2px 6px',
              background: liveFps >= 50 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
              color: liveFps >= 50 ? '#4ade80' : '#facc15',
              borderRadius: '4px',
              border: `1px solid ${liveFps >= 50 ? '#22c55e' : '#eab308'}`,
            }}
          >
            {liveFps.toFixed(1)} FPS ({liveMs.toFixed(1)}ms)
          </span>
        </div>

        {/* Quality Preset Selector */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginLeft: 'auto' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Preset:</span>
          {(['low', 'medium', 'high', 'ultra'] as QualityPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`btn-tag ${preset === p ? 'is-active' : ''}`}
              onClick={() => setPreset(p)}
              style={{ textTransform: 'capitalize', padding: '2px 6px', fontSize: '11px' }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* RGB vs Thermal Mode */}
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

        {/* Fullscreen / Expand Toggle */}
        <button
          type="button"
          className="btn-control"
          onClick={() => setIsFullscreen(!isFullscreen)}
          title={isFullscreen ? 'Restore standard view' : 'Expand full screen'}
          style={{ padding: '4px 10px', fontSize: '12px' }}
        >
          {isFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen'}
        </button>
      </div>

      {/* Main 3D Canvas Area */}
      <div className="panel__body" style={{ position: 'relative', overflow: 'hidden', flex: 1, padding: 0 }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: canvasHeight, minHeight: '340px' }}
        />

        {/* Top-Left: Scenario & Lighting Pickers */}
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            background: 'rgba(11, 15, 23, 0.88)',
            padding: '6px 10px',
            borderRadius: '6px',
            zIndex: 10,
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            maxWidth: '360px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#38bdf8' }}>Scenario:</span>
            <select
              value={scenarioId}
              onChange={(e) => handleScenarioChange(e.target.value)}
              style={{
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              <option value="1">1: Flood + Survivors (Zone B)</option>
              <option value="2">2: Fire + Smoke + Critical (Primary)</option>
              <option value="3">3: Collapsed Building (Zone A)</option>
              <option value="4">4: GPS-Denied Navigation</option>
              <option value="5">5: Network Failure & Sync</option>
              <option value="combined">Combined Demo (2 + 5)</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>Lighting:</span>
            {(['day', 'dusk', 'night', 'smoke'] as LightingVariant[]).map((l) => (
              <button
                key={l}
                type="button"
                className={`btn-tag ${lighting === l ? 'is-active' : ''}`}
                onClick={() => setLighting(l)}
                style={{ textTransform: 'capitalize', padding: '1px 6px', fontSize: '10px' }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Top-Right: Camera Mode Switcher */}
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            background: 'rgba(11, 15, 23, 0.88)',
            padding: '6px 8px',
            borderRadius: '6px',
            zIndex: 10,
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
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
          <button
            type="button"
            className={`btn-tag ${cameraMode === 'fire_cam' ? 'is-active' : ''}`}
            onClick={() => setCameraMode('fire_cam')}
          >
            Zone C
          </button>
          <button
            type="button"
            className={`btn-tag ${cameraMode === 'ruins_cam' ? 'is-active' : ''}`}
            onClick={() => setCameraMode('ruins_cam')}
          >
            Zone A
          </button>
          <button
            type="button"
            className={`btn-tag ${cameraMode === 'flood_cam' ? 'is-active' : ''}`}
            onClick={() => setCameraMode('flood_cam')}
          >
            Zone B
          </button>

          {/* Photo Mode Trigger */}
          <button
            type="button"
            className={`btn-tag ${photoModeActive ? 'is-active' : ''}`}
            onClick={handleTogglePhotoMode}
            style={{
              background: photoModeActive ? '#e11d48' : '#0284c7',
              color: '#ffffff',
              fontWeight: 600,
            }}
          >
            {photoModeActive ? 'Exit Photo' : 'Photo Mode'}
          </button>
        </div>

        {/* Photo Mode Active HUD Overlay */}
        {photoModeActive && (
          <div
            style={{
              position: 'absolute',
              top: '60px',
              right: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              background: 'rgba(15, 23, 42, 0.95)',
              padding: '12px 14px',
              borderRadius: '8px',
              zIndex: 20,
              border: '1px solid #38bdf8',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
              width: '240px',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8' }}>
              Photo Mode (Simulation Paused)
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              Drag to orbit, scroll to zoom, right-click to pan.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#f8fafc' }}>Res:</span>
              <select
                value={photoResolution}
                onChange={(e) => setPhotoResolution(e.target.value as 'viewport' | '1080p' | '2k' | '4k')}
                style={{
                  background: '#334155',
                  color: '#fff',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  flex: 1,
                }}
              >
                <option value="viewport">Viewport (1x)</option>
                <option value="1080p">1080p FHD (1920x1080)</option>
                <option value="2k">2K QHD (2560x1440)</option>
                <option value="4k">4K UHD (3840x2160)</option>
              </select>
            </div>

            <button
              type="button"
              className="btn-control"
              onClick={handleCapturePhoto}
              style={{
                background: '#0284c7',
                color: '#fff',
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Export PNG
            </button>
          </div>
        )}

        {/* Bottom Control Bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            right: '8px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(11, 15, 23, 0.92)',
            padding: '6px 12px',
            borderRadius: '6px',
            zIndex: 10,
            fontSize: '12px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Flight Controls */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: '#94a3b8' }}>Flight:</span>
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

          {/* Operational Toggles */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={manualActive}
                onChange={(e) => setManualActive(e.target.checked)}
              />
              WASD Manual
            </label>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={showZones}
                onChange={(e) => setShowZones(e.target.checked)}
              />
              Show Zones
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
              YOLO Infer
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
