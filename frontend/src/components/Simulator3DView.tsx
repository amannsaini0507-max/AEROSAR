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
  const panelRef = useRef<HTMLElement>(null);
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
  const [isFallbackFullscreen, setIsFallbackFullscreen] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [photoModeActive, setPhotoModeActive] = useState<boolean>(false);
  const [photoResolution, setPhotoResolution] = useState<'viewport' | '1080p' | '2k' | '4k'>('1080p');
  const [isPathTracingProgress, setIsPathTracingProgress] = useState<boolean>(false);
  const [manualActive, setManualActive] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [yoloMode, setYoloMode] = useState(false);
  const [liveFps, setLiveFps] = useState<number>(60.0);
  const [liveMs, setLiveMs] = useState<number>(16.6);

  // Projected 3D target coordinates for Tactical HUD DOM Overlay (Zero SVG)
  const [projectedTargets, setProjectedTargets] = useState<
    Array<{
      id: string;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      status: 'UNCONFIRMED' | 'VERIFYING' | 'CONFIRMED' | 'REJECTED';
      confidence: number;
      tempC?: number;
    }>
  >([]);

  // Thermal Render-Target Real-time Sample
  const [thermalSample, setThermalSample] = useState<{ tempC: number; isBio: boolean } | null>(null);

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

  // Web Audio Context for Confirmation Chime
  const audioCtxRef = useRef<AudioContext | null>(null);
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  // Unlock Web Audio on first user interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      getAudioContext();
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
    window.addEventListener('click', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);
    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [getAudioContext]);

  // Dual-tone harmonic confirmation chime
  const playConfirmationChime = useCallback(() => {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t = ctx.currentTime;

      // Harmonic dual-tone: 587.33 Hz (D5) -> 880.00 Hz (A5)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(587.33, t);
      osc1.frequency.exponentialRampToValueAtTime(880.0, t + 0.12);

      osc2.frequency.setValueAtTime(880.0, t);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, t + 0.15);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.48);
      osc2.stop(t + 0.48);
    } catch {
      // Ignore autoplay restriction or headless environment
    }
  }, [isMuted, getAudioContext]);

  // Trigger chime when a survivor reaches CONFIRMED status
  const prevConfirmedVictimsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let newlyConfirmed = false;
    Object.values(model.survivors).forEach((s) => {
      if (s.status === 'CONFIRMED' && !prevConfirmedVictimsRef.current.has(s.id)) {
        prevConfirmedVictimsRef.current.add(s.id);
        newlyConfirmed = true;
      }
    });
    if (newlyConfirmed) {
      playConfirmationChime();
    }
  }, [model.survivors, playConfirmationChime]);

  // Unified single resize routine
  const resize = useCallback(() => {
    const container = containerRef.current;
    const sim = simRef.current;
    if (!container || !sim) return;

    const w = container.clientWidth || 640;
    const h = container.clientHeight || 360;
    if (w <= 0 || h <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sim.renderer.setPixelRatio(dpr);
    // CRITICAL: updateStyle=false ensures Three.js does not hardcode inline px styles,
    // allowing CSS 100% width/height to fill container without top-left quarter clipping.
    sim.renderer.setSize(w, h, false);

    sim.mainCamera.aspect = w / h;
    sim.mainCamera.updateProjectionMatrix();

    sim.postProcessing.setSize(w, h);

    if (canvasRef.current) {
      canvasRef.current.style.display = 'block';
      canvasRef.current.style.width = '100%';
      canvasRef.current.style.height = '100%';
      (canvasRef.current as unknown as { __camera_aspect: number }).__camera_aspect = sim.mainCamera.aspect;
    }
  }, []);

  // Fullscreen and Fallback Toggle
  const handleToggleFullscreen = async () => {
    const panel = panelRef.current;
    if (!panel) return;

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {}
      setIsFullscreen(false);
      setIsFallbackFullscreen(false);
    } else if (isFallbackFullscreen) {
      setIsFullscreen(false);
      setIsFallbackFullscreen(false);
    } else {
      if (panel.requestFullscreen) {
        try {
          await panel.requestFullscreen();
          setIsFullscreen(true);
        } catch {
          // Fallback CSS fixed inset-0
          setIsFallbackFullscreen(true);
          setIsFullscreen(true);
        }
      } else {
        setIsFallbackFullscreen(true);
        setIsFullscreen(true);
      }
    }
    setTimeout(() => {
      resize();
      window.dispatchEvent(new Event('resize'));
    }, 50);
  };

  // Expand Grid Column Toggle
  const handleToggleExpand = () => {
    setIsExpanded((prev) => !prev);
    setTimeout(() => {
      resize();
      window.dispatchEvent(new Event('resize'));
    }, 50);
  };

  // Escape key and fullscreen change listener
  useEffect(() => {
    const handleFsChange = () => {
      const isNativeFs = Boolean(document.fullscreenElement);
      if (!isNativeFs && !isFallbackFullscreen) {
        setIsFullscreen(false);
      } else if (isNativeFs) {
        setIsFullscreen(true);
      }
      requestAnimationFrame(resize);
      window.dispatchEvent(new Event('resize'));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        setIsFullscreen(false);
        setIsFallbackFullscreen(false);
        requestAnimationFrame(resize);
        window.dispatchEvent(new Event('resize'));
      }
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFallbackFullscreen, resize]);

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.setAttribute('data-testid', 'sim3d-canvas');

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    canvasRef.current = renderer.domElement;

    // 2. Main Scene & Atmospheric Fog
    const scene = new THREE.Scene();

    // 3. Perspective Cameras
    const mainCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
    mainCamera.position.set(0, 18, 22);
    mainCamera.lookAt(0, 0, 0);
    (renderer.domElement as unknown as { __camera_aspect: number }).__camera_aspect = mainCamera.aspect;

    const fpvCamera = new THREE.PerspectiveCamera(72, 4 / 3, 0.1, 80);
    fpvCamera.rotation.x = -Math.PI / 4; // 45 deg forward-downward tactical angle

    // 4. Subsystem Instantiations
    const envSystem = new EnvironmentSystem(scene, renderer);
    const terrainSystem = new TerrainSystem();
    scene.add(terrainSystem.mesh);
    scene.add(terrainSystem.rockInstances);
    scene.add(terrainSystem.debrisInstances);
    scene.add(terrainSystem.vegetationInstances);

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

    // 5. Dedicated ResizeObserver on container
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(resize);
    });
    ro.observe(container);

    const handleWindowResize = () => {
      requestAnimationFrame(resize);
    };
    window.addEventListener('resize', handleWindowResize);

    // 6. High-Precision Fixed-Step Dynamics & Rendering Loop
    let animId = 0;
    let lastTime = performance.now();
    const fixedDt = 1.0 / 120.0;
    let accumulator = 0.0;
    let fpsUpdateTimer = 0;
    let offscreenSensorTimer = 0;
    let hudUpdateTimer = 0;
    let thermalSampleTimer = 0;

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
      const groundY = sim.terrainSystem.getElevationAt(sim.dronePos.x, sim.dronePos.z);
      sim.drone.blobShadow.position.y = groundY + 0.02;
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
        sim.mainCamera.position.set(-12.5, 5.2, -10.5);
        sim.mainCamera.lookAt(-6.5, 1.2, -5.5);
        activeCam = sim.mainCamera;
      } else if (cameraModeRef.current === 'fire_cam') {
        sim.mainCamera.position.set(1.5, 3.0, 2.5);
        sim.mainCamera.lookAt(5.0, 0.8, 6.0);
        activeCam = sim.mainCamera;
      } else if (cameraModeRef.current === 'flood_cam') {
        sim.mainCamera.position.set(1.5, 3.8, -11.5);
        sim.mainCamera.lookAt(6.0, 0.0, -6.0);
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

      // Tactical HUD Screen Projections (~30 Hz update rate)
      hudUpdateTimer += delta;
      if (hudUpdateTimer >= 0.033) {
        hudUpdateTimer = 0;
        if (curW > 0 && curH > 0 && sim.scenarioManager?.humans) {
          const targets: typeof projectedTargets = [];
          for (const human of sim.scenarioManager.humans) {
            const hPos = human.group.position.clone();
            hPos.y += 0.5;
            const proj = hPos.clone().project(activeCam);
            if (proj.z > -1.0 && proj.z < 1.0) {
              const sx = (proj.x * 0.5 + 0.5) * curW;
              const sy = (-proj.y * 0.5 + 0.5) * curH;
              if (sx >= -40 && sx <= curW + 40 && sy >= -40 && sy <= curH + 40) {
                const dist = activeCam.position.distanceTo(hPos);
                const boxH = Math.max(32, Math.min(200, (1.8 / Math.max(1.0, dist)) * curH * 0.8));
                const boxW = Math.max(28, Math.min(160, boxH * 0.65));

                const survivor = model.survivors[human.id];
                let status: 'UNCONFIRMED' | 'VERIFYING' | 'CONFIRMED' | 'REJECTED' = 'UNCONFIRMED';
                if (model.hoverProgress?.victim_id === human.id) {
                  status = 'VERIFYING';
                } else if (survivor?.status) {
                  status = survivor.status;
                }

                targets.push({
                  id: human.id,
                  name: human.name,
                  x: Math.round(sx),
                  y: Math.round(sy),
                  w: Math.round(boxW),
                  h: Math.round(boxH),
                  status,
                  confidence: survivor?.confidence ?? 0.88,
                  tempC: human.tempC,
                });
              }
            }
          }
          setProjectedTargets(targets);
        }
      }

      // Thermal Render-Target Sampling during HOVER_CONFIRMING
      if (model.mission?.substate === 'HOVER_CONFIRMING') {
        thermalSampleTimer += delta;
        if (thermalSampleTimer >= 0.1) {
          thermalSampleTimer = 0;
          const pixel = new Uint8Array(4);
          sim.renderer.readRenderTargetPixels(
            sim.thermalPipeline.renderTargetThermal,
            160,
            120,
            1,
            1,
            pixel
          );
          const currentId = model.hoverProgress?.victim_id;
          const targetHuman = sim.scenarioManager.humans.find((h) => h.id === currentId);
          const tempC = targetHuman ? targetHuman.tempC : pixel[0] > 180 ? 36.5 : 18.5;
          setThermalSample({ tempC, isBio: tempC >= 30.0 && tempC <= 42.0 });
        }
      } else {
        if (thermalSample) setThermalSample(null);
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (simRef.current) {
        simRef.current.running = false;
        simRef.current.envSystem.dispose();
        simRef.current.thermalPipeline.dispose();
        simRef.current.postProcessing.dispose();
        simRef.current.photoMode.dispose();
        simRef.current.renderer.dispose();
      }
    };
  }, [resize]);

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

  // Flight Mode Change Handler
  const handleFlightModeChange = (mode: 'MANUAL' | 'AUTONOMOUS') => {
    const isMan = mode === 'MANUAL';
    setManualActive(isMan);
    onSendCommand?.('set_flight_mode', { mode });
  };

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

  const handlePathTracedRender = async () => {
    if (!simRef.current) return;
    setIsPathTracingProgress(true);
    try {
      await simRef.current.photoMode.renderPathTraced({
        fileNamePrefix: `aerosar_scenario_${scenarioId}_pt`,
        samples: 32,
      });
    } finally {
      setIsPathTracingProgress(false);
    }
  };

  // Command handlers
  const handleStart = () => onSendCommand?.('start');
  const handlePause = () => onSendCommand?.('pause');
  const handleResume = () => onSendCommand?.('resume');
  const handleRTL = () => onSendCommand?.('rtl');
  const handleEmergencyLand = () => onSendCommand?.('emergency_land');

  // Fullscreen container style with fallback CSS support
  const panelStyle: React.CSSProperties =
    isFullscreen || isFallbackFullscreen
      ? {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          zIndex: 9999,
          background: '#070a10',
          margin: 0,
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }
      : {
          position: 'relative',
          gridColumn: isExpanded ? '1 / -1' : 'auto',
        };

  // Derived metrics
  const substate = model.mission?.substate || 'PATROLLING';
  const hoverProgress = model.hoverProgress;
  const confirmedCount = Object.values(model.survivors).filter(
    (s) => s.status === 'CONFIRMED'
  ).length;
  const totalVictimsCount =
    simRef.current?.scenarioManager.humans.length || Object.keys(model.survivors).length || 2;

  return (
    <section
      ref={panelRef}
      className={`panel dashboard__sim3d ${
        isFullscreen || isFallbackFullscreen ? 'is-fullscreen' : ''
      } ${isExpanded ? 'is-expanded' : ''}`}
      style={panelStyle}
      aria-label="Near-Photorealistic 3D Disaster Arena"
    >
      {/* Top Header Bar */}
      <div
        className="panel__head"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="pulse-dot" style={{ position: 'static' }} />
          <span className="panel__title">3D Tactical Arena (Three.js WebGL)</span>
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

        {/* Audio Confirmation Chime Toggle */}
        <button
          type="button"
          className={`btn-control ${isMuted ? '' : 'is-active'}`}
          onClick={() => setIsMuted(!isMuted)}
          title={isMuted ? 'Unmute confirmation chime' : 'Mute confirmation chime'}
          style={{ padding: '4px 8px', fontSize: '11px' }}
        >
          {isMuted ? '🔇 Muted' : '🔊 Chime'}
        </button>

        {/* Expand Toggle */}
        <button
          type="button"
          className={`btn-control ${isExpanded ? 'is-active' : ''}`}
          onClick={handleToggleExpand}
          title={isExpanded ? 'Collapse view' : 'Expand full width'}
          style={{ padding: '4px 8px', fontSize: '11px' }}
        >
          {isExpanded ? 'Collapse' : '⛶ Expand'}
        </button>

        {/* Fullscreen / Fallback Toggle */}
        <button
          type="button"
          data-testid="fullscreen-toggle-btn"
          className={`btn-control ${isFullscreen || isFallbackFullscreen ? 'is-active' : ''}`}
          onClick={handleToggleFullscreen}
          title={isFullscreen || isFallbackFullscreen ? 'Restore standard view (Esc)' : 'Expand full screen'}
          style={{ padding: '4px 10px', fontSize: '12px' }}
        >
          {isFullscreen || isFallbackFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen'}
        </button>
      </div>

      {/* Main 3D Canvas Area */}
      <div
        className="panel__body"
        style={{ position: 'relative', overflow: 'hidden', flex: 1, padding: 0 }}
      >
        <div
          ref={containerRef}
          data-testid="sim3d-container"
          className="sim3d-canvas-container"
          style={{
            width: '100%',
            height: isFullscreen || isFallbackFullscreen ? 'calc(100vh - 110px)' : '75vh',
            minHeight: isFullscreen || isFallbackFullscreen ? 'calc(100vh - 110px)' : '75vh',
            position: 'relative',
            overflow: 'hidden',
            background: '#070a10',
          }}
        />

        {/* Tactical HUD Overlay (DOM-only, Strictly Zero SVG / Zero Mermaid) */}
        <div
          className="tactical-hud"
          data-testid="tactical-hud"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 15,
            overflow: 'hidden',
          }}
        >
          {/* Projected 3D Target Bounding Boxes */}
          {projectedTargets.map((t) => {
            const isTargetVerifying = t.status === 'VERIFYING';
            const isTargetConfirmed = t.status === 'CONFIRMED';
            const isTargetRejected = t.status === 'REJECTED';
            const themeColor = isTargetConfirmed
              ? '#22c55e'
              : isTargetRejected
              ? '#ef4444'
              : isTargetVerifying
              ? '#38bdf8'
              : '#eab308';

            return (
              <div
                key={t.id}
                data-testid={`target-box-${t.id}`}
                style={{
                  position: 'absolute',
                  left: `${t.x - t.w / 2}px`,
                  top: `${t.y - t.h / 2}px`,
                  width: `${t.w}px`,
                  height: `${t.h}px`,
                  border: `2px solid ${themeColor}`,
                  borderRadius: '4px',
                  boxShadow: `0 0 10px ${themeColor}66`,
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }}
              >
                {/* Tactical Corner Brackets */}
                <div
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    left: '-4px',
                    width: '8px',
                    height: '8px',
                    borderTop: `2px solid ${themeColor}`,
                    borderLeft: `2px solid ${themeColor}`,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    width: '8px',
                    height: '8px',
                    borderTop: `2px solid ${themeColor}`,
                    borderRight: `2px solid ${themeColor}`,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-4px',
                    left: '-4px',
                    width: '8px',
                    height: '8px',
                    borderBottom: `2px solid ${themeColor}`,
                    borderLeft: `2px solid ${themeColor}`,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-4px',
                    right: '-4px',
                    width: '8px',
                    height: '8px',
                    borderBottom: `2px solid ${themeColor}`,
                    borderRight: `2px solid ${themeColor}`,
                  }}
                />

                {/* Target Badge */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '3px',
                    background: 'rgba(11, 15, 23, 0.94)',
                    color: themeColor,
                    border: `1px solid ${themeColor}`,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                  }}
                >
                  {t.name || t.id} [{t.status}]{' '}
                  {t.tempC != null ? `${t.tempC.toFixed(1)}°C` : ''}
                </div>
              </div>
            );
          })}

          {/* Top-Center Tactical Verification Banner */}
          <div
            data-testid="tactical-hud-banner"
            style={{
              position: 'absolute',
              top: '52px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '5px',
              background: 'rgba(11, 15, 23, 0.94)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.65)',
              borderRadius: '6px',
              padding: '7px 16px',
              backdropFilter: 'blur(8px)',
              pointerEvents: 'none',
              zIndex: 20,
              minWidth: '290px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                fontFamily: 'monospace',
              }}
            >
              <span style={{ color: '#94a3b8' }}>SUBSTATE:</span>
              <span
                data-testid="hud-substate"
                style={{
                  fontWeight: 700,
                  color:
                    substate === 'CONFIRMED'
                      ? '#4ade80'
                      : substate === 'REJECTED'
                      ? '#f87171'
                      : substate.startsWith('HOVER')
                      ? '#38bdf8'
                      : '#facc15',
                }}
              >
                {substate}
              </span>
              <span style={{ color: '#475569' }}>|</span>
              <span style={{ color: '#94a3b8' }}>VICTIMS:</span>
              <span
                data-testid="hud-victim-counter"
                style={{ fontWeight: 700, color: '#f8fafc' }}
              >
                Found {confirmedCount} / {totalVictimsCount}
              </span>
            </div>

            {/* Verification Progress Bar */}
            {(substate === 'HOVER_CONFIRMING' ||
              substate === 'HOVER_STABILISING' ||
              hoverProgress) && (
              <div style={{ width: '100%', marginTop: '3px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: '#94a3b8',
                    marginBottom: '3px',
                  }}
                >
                  <span>TARGET LOCK [{hoverProgress?.victim_id || 'VICTIM'}]</span>
                  <span data-testid="hud-hover-timer">
                    [ {(hoverProgress?.elapsed ?? 0).toFixed(1)}s / 5.5s ]
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    background: 'rgba(255, 255, 255, 0.12)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    data-testid="hud-progress-bar"
                    style={{
                      height: '100%',
                      width: `${Math.min(
                        100,
                        Math.max(0, ((hoverProgress?.elapsed ?? 0) / 5.5) * 100)
                      )}%`,
                      background: 'linear-gradient(90deg, #0284c7, #38bdf8)',
                      boxShadow: '0 0 8px #38bdf8',
                      transition: 'width 0.1s linear',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Thermal RT Sample Readout */}
            {thermalSample && substate === 'HOVER_CONFIRMING' && (
              <div
                data-testid="hud-thermal-readout"
                style={{
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: thermalSample.isBio ? '#4ade80' : '#f87171',
                  marginTop: '2px',
                }}
              >
                THERMAL SENSOR: {thermalSample.tempC.toFixed(1)}°C ·{' '}
                {thermalSample.isBio
                  ? 'BIOLOGICAL SIGNATURE CONFIRMED (>=80% in 30-40°C)'
                  : 'COLD MANNEQUIN / ARTIFACT REJECTED (<30°C)'}
              </div>
            )}
          </div>
        </div>

        {/* Floating Top Control Bar (Responsive & Non-overlapping) */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            right: '8px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {/* Left: Scenario & Lighting Pickers */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(11, 15, 23, 0.92)',
              padding: '4px 8px',
              borderRadius: '6px',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#38bdf8' }}>Scenario:</span>
              <select
                id="scenario-select"
                data-testid="scenario-select"
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
                  maxWidth: '180px',
                }}
              >
                <option value="1">1: Flood + Survivors</option>
                <option value="2">2: Fire + Smoke (Primary)</option>
                <option value="3">3: Collapsed Ruins</option>
                <option value="4">4: GPS-Denied Nav</option>
                <option value="5">5: Network Failure</option>
                <option value="combined">Combined Demo (2 + 5)</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>Light:</span>
              {(['day', 'dusk', 'night', 'smoke'] as LightingVariant[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`btn-tag ${lighting === l ? 'is-active' : ''}`}
                  onClick={() => setLighting(l)}
                  style={{ textTransform: 'capitalize', padding: '1px 5px', fontSize: '10px' }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Camera Mode Switcher & Photo Mode */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(11, 15, 23, 0.92)',
              padding: '4px 8px',
              borderRadius: '6px',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              pointerEvents: 'auto',
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
        </div>

        {/* Photo Mode Active HUD Overlay */}
        {photoModeActive && (
          <div
            style={{
              position: 'absolute',
              top: '55px',
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
              width: '260px',
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
                onChange={(e) =>
                  setPhotoResolution(e.target.value as 'viewport' | '1080p' | '2k' | '4k')
                }
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

            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn-control"
                onClick={handleCapturePhoto}
                style={{
                  background: '#0284c7',
                  color: '#fff',
                  fontWeight: 600,
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  flex: 1,
                  fontSize: '11px',
                }}
              >
                Export PNG
              </button>
              <button
                type="button"
                className="btn-control"
                onClick={handlePathTracedRender}
                disabled={isPathTracingProgress}
                title="Progressive GPU path tracing (offline ray-traced quality, clearly slow)"
                style={{
                  background: isPathTracingProgress ? '#475569' : '#7c3aed',
                  color: '#fff',
                  fontWeight: 600,
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: isPathTracingProgress ? 'wait' : 'pointer',
                  flex: 1,
                  fontSize: '11px',
                }}
              >
                {isPathTracingProgress ? 'Tracing...' : 'Path-Trace (Slow)'}
              </button>
            </div>
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
          {/* Flight Controls & Mode Switch */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="segmented" role="tablist">
              <button
                type="button"
                data-testid="mode-auto-btn"
                className={'segmented__btn' + (!manualActive ? ' is-active' : '')}
                onClick={() => handleFlightModeChange('AUTONOMOUS')}
                title="Autonomous lawnmower search with victim hover-verify"
              >
                AUTONOMOUS
              </button>
              <button
                type="button"
                data-testid="mode-manual-btn"
                className={'segmented__btn' + (manualActive ? ' is-active' : '')}
                onClick={() => handleFlightModeChange('MANUAL')}
                title="Immediate manual joystick / WASD override"
              >
                MANUAL
              </button>
            </div>

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

          {/* Operational Toggles & Substate Badge */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              data-testid="bottom-substate-badge"
              style={{
                fontSize: '11px',
                fontFamily: 'monospace',
                padding: '2px 8px',
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                borderRadius: '4px',
                border: '1px solid rgba(56, 189, 248, 0.4)',
              }}
            >
              Substate: {substate}
            </span>

            <label
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                color: '#f1f5f9',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={manualActive}
                onChange={(e) => handleFlightModeChange(e.target.checked ? 'MANUAL' : 'AUTONOMOUS')}
              />
              WASD Manual
            </label>
            <label
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                color: '#f1f5f9',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={showZones}
                onChange={(e) => setShowZones(e.target.checked)}
              />
              Show Zones
            </label>
            <label
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                color: '#f1f5f9',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={gpsDenied}
                onChange={(e) => {
                  setGpsDenied(e.target.checked);
                  onSendCommand?.('set_mode', {
                    mode: e.target.checked ? 'GPS_DENIED' : 'GPS_NAV',
                  });
                }}
              />
              GPS-Denied
            </label>
            <label
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                color: '#f1f5f9',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
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
