import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PhotoCaptureOptions {
  resolution: 'viewport' | '1080p' | '2k' | '4k';
  fileNamePrefix?: string;
}

export class PhotoModeManager {
  public isActive = false;
  public isPathTracing = false;
  public controls: OrbitControls | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private savedCameraPos = new THREE.Vector3();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
  }

  public enterPhotoMode() {
    this.isActive = true;
    this.savedCameraPos.copy(this.camera.position);

    if (!this.controls) {
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.maxDistance = 50.0;
      this.controls.minDistance = 0.5;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below ground plane
    }

    this.controls.enabled = true;
  }

  public exitPhotoMode() {
    this.isActive = false;
    this.isPathTracing = false;
    if (this.controls) {
      this.controls.enabled = false;
    }
  }

  public update() {
    if (this.isActive && this.controls?.enabled) {
      this.controls.update();
    }
  }

  /**
   * Captures high-resolution screenshot up to 4K and downloads as PNG
   */
  public async captureSnapshot(options: PhotoCaptureOptions): Promise<string> {
    const { resolution, fileNamePrefix = 'aerosar_photo' } = options;

    let targetWidth = this.canvas.clientWidth;
    let targetHeight = this.canvas.clientHeight;

    if (resolution === '1080p') {
      targetWidth = 1920;
      targetHeight = 1080;
    } else if (resolution === '2k') {
      targetWidth = 2560;
      targetHeight = 1440;
    } else if (resolution === '4k') {
      targetWidth = 3840;
      targetHeight = 2160;
    }

    // Save previous renderer state
    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevPixelRatio = this.renderer.getPixelRatio();
    const prevAspect = this.camera.aspect;

    // Render offscreen at high resolution
    const rt = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this.camera.aspect = targetWidth / targetHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    // Read back pixel data to 2D canvas for PNG export
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = targetWidth;
    offscreenCanvas.height = targetHeight;
    const ctx = offscreenCanvas.getContext('2d')!;

    const pixels = new Uint8Array(targetWidth * targetHeight * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, targetWidth, targetHeight, pixels);

    // Flip vertical (WebGL pixel origin is bottom-left)
    const imgData = ctx.createImageData(targetWidth, targetHeight);
    for (let y = 0; y < targetHeight; y++) {
      const srcY = targetHeight - 1 - y;
      const srcOffset = srcY * targetWidth * 4;
      const destOffset = y * targetWidth * 4;
      for (let x = 0; x < targetWidth * 4; x++) {
        imgData.data[destOffset + x] = pixels[srcOffset + x];
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const dataUrl = offscreenCanvas.toDataURL('image/png');

    // Trigger browser download
    const link = document.createElement('a');
    link.download = `${fileNamePrefix}_${resolution}_${Date.now()}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Restore previous renderer and camera settings
    rt.dispose();
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.renderer.setPixelRatio(prevPixelRatio);

    return dataUrl;
  }

  public dispose() {
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
  }
}
