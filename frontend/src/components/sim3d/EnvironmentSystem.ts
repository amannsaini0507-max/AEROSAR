import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { LightingVariant, QualityPreset } from './types';
import { PRESET_CONFIGS } from './types';

export class EnvironmentSystem {
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;
  public sunLight: THREE.DirectionalLight;
  public ambientLight: THREE.AmbientLight;
  public hemisphereLight: THREE.HemisphereLight;
  public pmremGenerator: THREE.PMREMGenerator;
  public currentVariant: LightingVariant = 'day';
  private envMapCache: Map<string, THREE.Texture> = new Map();
  private loader: RGBELoader;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;

    // PMREM generator for high-performance IBL irradiance maps
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.loader = new RGBELoader();

    // 1. Directional Sun Light
    this.sunLight = new THREE.DirectionalLight(0xfff5ea, 1.4);
    this.sunLight.position.set(14, 28, 12);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.left = -18;
    this.sunLight.shadow.camera.right = 18;
    this.sunLight.shadow.camera.top = 18;
    this.sunLight.shadow.camera.bottom = -18;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 70;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);

    // 2. Ambient & Sky Hemisphere Fill
    this.ambientLight = new THREE.AmbientLight(0xced8e6, 0.45);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0xddeeff, 0x3d352b, 0.4);
    this.scene.add(this.hemisphereLight);

    // 3. Post-disaster atmospheric depth fog
    this.scene.fog = new THREE.FogExp2(0x1a212b, 0.015);
  }

  public setQuality(preset: QualityPreset) {
    const config = PRESET_CONFIGS[preset];
    this.sunLight.castShadow = config.shadows;
    if (config.shadows) {
      this.sunLight.shadow.mapSize.width = config.shadowMapSize;
      this.sunLight.shadow.mapSize.height = config.shadowMapSize;
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
    }
  }

  public async setLighting(variant: LightingVariant): Promise<void> {
    this.currentVariant = variant;

    let hdriFile = 'overcast_day_1k.hdr';
    let sunColor = 0xfff3e3;
    let sunIntensity = 1.4;
    let fogColor = 0x222a36;
    let fogDensity = 0.014;
    let ambColor = 0xcad7e8;
    let ambIntensity = 0.45;
    let exposure = 1.0;

    switch (variant) {
      case 'dusk':
        hdriFile = 'dusk_1k.hdr';
        sunColor = 0xff7733;
        sunIntensity = 1.1;
        fogColor = 0x2d1d1f;
        fogDensity = 0.018;
        ambColor = 0xa8776a;
        ambIntensity = 0.35;
        exposure = 0.95;
        break;
      case 'night':
        hdriFile = 'night_1k.hdr';
        sunColor = 0x7fa2c7; // Moonlight
        sunIntensity = 0.35;
        fogColor = 0x06080e;
        fogDensity = 0.024;
        ambColor = 0x1f2b3d;
        ambIntensity = 0.15;
        exposure = 1.25; // Boost camera gain in night mode
        break;
      case 'smoke':
        hdriFile = 'smoke_overcast_1k.hdr';
        sunColor = 0xcca070; // Filtered through dense particulate
        sunIntensity = 0.85;
        fogColor = 0x26211c;
        fogDensity = 0.035; // Heavy smoke aerial haze
        ambColor = 0x544738;
        ambIntensity = 0.3;
        exposure = 1.05;
        break;
      case 'day':
      default:
        hdriFile = 'overcast_day_1k.hdr';
        sunColor = 0xfff5ea;
        sunIntensity = 1.4;
        fogColor = 0x242c38;
        fogDensity = 0.014;
        ambColor = 0xcad7e8;
        ambIntensity = 0.45;
        exposure = 1.0;
        break;
    }

    this.sunLight.color.setHex(sunColor);
    this.sunLight.intensity = sunIntensity;
    this.ambientLight.color.setHex(ambColor);
    this.ambientLight.intensity = ambIntensity;
    this.renderer.toneMappingExposure = exposure;

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(fogColor);
      this.scene.fog.density = fogDensity;
    }

    // Load / Cache HDRI Environment Map
    try {
      let envTexture = this.envMapCache.get(hdriFile);
      if (!envTexture) {
        const url = `/assets/hdri/${hdriFile}`;
        const hdr = await this.loader.loadAsync(url);
        const pmrem = this.pmremGenerator.fromEquirectangular(hdr);
        envTexture = pmrem.texture;
        hdr.dispose();
        pmrem.dispose();
        this.envMapCache.set(hdriFile, envTexture);
      }

      this.scene.environment = envTexture;
      this.scene.background = envTexture;
    } catch {
      // Offline fallback: Procedural sky color gradient
      this.scene.background = new THREE.Color(fogColor);
    }
  }

  public dispose() {
    this.envMapCache.forEach((tex) => tex.dispose());
    this.envMapCache.clear();
    this.pmremGenerator.dispose();
  }
}
