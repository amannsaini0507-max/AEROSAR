import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SAOPass } from 'three/examples/jsm/postprocessing/SAOPass.js';
import type { QualityPreset } from './types';
import { PRESET_CONFIGS } from './types';

export class PostProcessingPipeline {
  public composer: EffectComposer;
  public renderPass: RenderPass;
  public bloomPass: UnrealBloomPass;
  public saoPass: SAOPass;
  public fxaaPass: ShaderPass;
  public vignettePass: ShaderPass;
  public outputPass: OutputPass;
  public currentPreset: QualityPreset = 'high';
  public resolutionScale = 1.0;

  // Adaptive framerate protection
  private frameTimes: number[] = [];
  private lastTime = performance.now();
  public currentFps = 60.0;
  public currentFrameTimeMs = 16.6;

  constructor(
    public renderer: THREE.WebGLRenderer,
    public scene: THREE.Scene,
    public camera: THREE.PerspectiveCamera,
    width: number,
    height: number
  ) {
    this.composer = new EffectComposer(renderer);

    // 1. Scene Render Pass
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Ambient Occlusion (SAO) Pass
    this.saoPass = new SAOPass(scene, camera);
    this.saoPass.params.saoBias = 0.5;
    this.saoPass.params.saoIntensity = 0.035; // Gentle contact shadows
    this.saoPass.params.saoScale = 1.8;
    this.saoPass.params.saoKernelRadius = 20;
    this.saoPass.params.saoBlur = true;
    this.composer.addPass(this.saoPass);

    // 3. Selective Bloom Pass (targeting fire and hot embers)
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.45, // strength
      0.3, // radius
      0.88 // threshold (only bright fire core & sparks bloom)
    );
    this.composer.addPass(this.bloomPass);

    // 4. Subtle Cinematic Vignette Pass
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value = 1.05;
    this.vignettePass.uniforms['darkness'].value = 0.95;
    this.composer.addPass(this.vignettePass);

    // 5. Anti-Aliasing (FXAA) Pass
    this.fxaaPass = new ShaderPass(FXAAShader);
    const pixelRatio = renderer.getPixelRatio();
    this.fxaaPass.uniforms['resolution'].value.x = 1 / (width * pixelRatio);
    this.fxaaPass.uniforms['resolution'].value.y = 1 / (height * pixelRatio);
    this.composer.addPass(this.fxaaPass);

    // 6. ACES Filmic Tone Mapping and Color Space Output Pass
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.setPreset('high', width, height);
  }

  public setPreset(preset: QualityPreset, width: number, height: number) {
    this.currentPreset = preset;
    const config = PRESET_CONFIGS[preset];

    // Configure passes per preset
    this.saoPass.enabled = config.ao;
    this.bloomPass.enabled = config.bloom;
    this.bloomPass.strength = config.bloomStrength;
    this.vignettePass.enabled = config.vignette;
    this.fxaaPass.enabled = config.antialiasing !== 'none';

    // Set pixel ratio
    this.renderer.setPixelRatio(config.pixelRatio);
    this.setSize(width, height);
  }

  public setSize(width: number, height: number) {
    const effectiveWidth = Math.floor(width * this.resolutionScale);
    const effectiveHeight = Math.floor(height * this.resolutionScale);

    this.composer.setSize(effectiveWidth, effectiveHeight);
    this.bloomPass.resolution.set(effectiveWidth, effectiveHeight);

    const pr = this.renderer.getPixelRatio();
    this.fxaaPass.uniforms['resolution'].value.x = 1 / (effectiveWidth * pr);
    this.fxaaPass.uniforms['resolution'].value.y = 1 / (effectiveHeight * pr);
  }

  public updateAdaptiveResolution(width: number, height: number) {
    const now = performance.now();
    const dt = now - this.lastTime;
    this.lastTime = now;

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();

    const avgDt = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.currentFrameTimeMs = Math.round(avgDt * 10) / 10;
    this.currentFps = Math.round((1000.0 / Math.max(1, avgDt)) * 10) / 10;

    // Framerate protection budget:
    // If framerate drops below 45 FPS (frametime > 22ms), dynamically scale viewport down
    if (avgDt > 22.0 && this.resolutionScale > 0.7) {
      this.resolutionScale = Math.max(0.7, this.resolutionScale - 0.05);
      this.setSize(width, height);
    } else if (avgDt < 16.0 && this.resolutionScale < 1.0) {
      this.resolutionScale = Math.min(1.0, this.resolutionScale + 0.02);
      this.setSize(width, height);
    }
  }

  public render(delta: number) {
    if (this.currentPreset === 'low') {
      // Direct render for lowest overhead (30+ FPS floor)
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render(delta);
    }
  }

  public dispose() {
    this.composer.dispose();
  }
}
