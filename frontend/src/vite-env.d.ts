/// <reference types="vite/client" />

declare module 'three-gpu-pathtracer' {
  import * as THREE from 'three';
  export class WebGLPathTracer {
    constructor(renderer: THREE.WebGLRenderer);
    setScene(scene: THREE.Scene, camera: THREE.Camera): void;
    setSceneAsync(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
    renderSample(): void;
    reset(): void;
    dispose(): void;
    samples: number;
    bounces: number;
    tiles: THREE.Vector2;
  }
}
