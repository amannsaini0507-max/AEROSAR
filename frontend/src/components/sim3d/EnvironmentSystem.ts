import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { LightingVariant, QualityPreset } from './types';
import { PRESET_CONFIGS } from './types';

interface CachedEnv {
  hdrTexture: THREE.DataTexture;
  pmremTexture: THREE.Texture;
}

export class EnvironmentSystem {
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;
  public sunLight: THREE.DirectionalLight;
  public ambientLight: THREE.AmbientLight;
  public hemisphereLight: THREE.HemisphereLight;
  public pmremGenerator: THREE.PMREMGenerator;
  public currentVariant: LightingVariant = 'day';
  private envMapCache: Map<string, CachedEnv> = new Map();
  private loader: RGBELoader;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;

    // PMREM generator for high-performance IBL irradiance maps
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.loader = new RGBELoader();

    // 1. Directional Sun Light
    this.sunLight = new THREE.DirectionalLight(0xfff5ea, 1.8);
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
    this.ambientLight = new THREE.AmbientLight(0xcad7e8, 0.55);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0xddeeff, 0x3d352b, 0.45);
    this.scene.add(this.hemisphereLight);

    // 3. Post-disaster atmospheric depth fog
    this.scene.fog = new THREE.FogExp2(0x7b8f9e, 0.006);
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
    let sunColor = 0xfff5ea;
    let sunIntensity = 2.0;
    let fogColor = 0x7b8f9e;
    let fogDensity = 0.006;
    let ambColor = 0xb4c4d6;
    let ambIntensity = 0.75;
    let exposure = 1.1;

    switch (variant) {
      case 'dusk':
        hdriFile = 'dusk_1k.hdr';
        sunColor = 0xff6828;
        sunIntensity = 1.8;
        fogColor = 0x4a2c26;
        fogDensity = 0.008;
        ambColor = 0xa86c5c;
        ambIntensity = 0.6;
        exposure = 1.05;
        break;
      case 'night':
        hdriFile = 'night_1k.hdr';
        sunColor = 0x7094be; // Moonlight
        sunIntensity = 0.5;
        fogColor = 0x080d18;
        fogDensity = 0.01;
        ambColor = 0x1c2838;
        ambIntensity = 0.3;
        exposure = 1.35; // Boost camera gain in night mode
        break;
      case 'smoke':
        hdriFile = 'smoke_overcast_1k.hdr';
        sunColor = 0xc49460; // Filtered through particulate
        sunIntensity = 1.2;
        fogColor = 0x3a3228;
        fogDensity = 0.014; // Realistic smoke aerial haze
        ambColor = 0x544738;
        ambIntensity = 0.55;
        exposure = 1.1;
        break;
      case 'day':
      default:
        hdriFile = 'overcast_day_1k.hdr';
        sunColor = 0xfff5ea;
        sunIntensity = 2.2;
        fogColor = 0x7b8f9e;
        fogDensity = 0.006; // Clear daylight visibility
        ambColor = 0xb4c4d6;
        ambIntensity = 0.8;
        exposure = 1.15;
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
      let cached = this.envMapCache.get(hdriFile);
      if (!cached) {
        const url = `/assets/hdri/${hdriFile}`;
        const hdr = await this.loader.loadAsync(url);
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = this.pmremGenerator.fromEquirectangular(hdr);
        cached = {
          hdrTexture: hdr,
          pmremTexture: pmrem.texture,
        };
        this.envMapCache.set(hdriFile, cached);
      }

      this.scene.background = cached.hdrTexture;
      this.scene.environment = cached.pmremTexture;
    } catch {
      // Offline fallback: Procedural sky color
      this.scene.background = new THREE.Color(fogColor);
    }
  }

  public dispose() {
    this.envMapCache.forEach(({ hdrTexture, pmremTexture }) => {
      hdrTexture.dispose();
      pmremTexture.dispose();
    });
    this.envMapCache.clear();
    this.pmremGenerator.dispose();
  }
}
