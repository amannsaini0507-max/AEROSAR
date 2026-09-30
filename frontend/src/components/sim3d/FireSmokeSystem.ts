import * as THREE from 'three';
import type { QualityPreset } from './types';
import { PRESET_CONFIGS } from './types';

export class FireSmokeSystem {
  public group: THREE.Group;
  public fireLight: THREE.PointLight;
  public flameMeshes: THREE.Mesh[] = [];
  public emberPoints: THREE.Points;
  public smokePoints: THREE.Points;
  public charredDecal: THREE.Mesh;
  public emberPositions: Float32Array;
  public emberVelocities: Float32Array;
  public emberLifetimes: Float32Array;
  public smokePositions: Float32Array;
  public smokeVelocities: Float32Array;
  public smokeSizes: Float32Array;
  public smokeOpacities: Float32Array;
  private emberCount = 200;
  private smokeCount = 180;
  private flameMaterial: THREE.ShaderMaterial;
  private emberMaterial: THREE.PointsMaterial;
  private smokeMaterial: THREE.PointsMaterial;
  public position: THREE.Vector3;

  constructor(pos: [number, number, number] = [5.5, 0, 6.5]) {
    this.group = new THREE.Group();
    this.position = new THREE.Vector3(...pos);
    this.group.position.copy(this.position);

    // Thermal target metadata
    this.group.userData = {
      isThermalTarget: true,
      thermalTemp: 750.0, // Active raging fire (degrees C)
      label: 'Zone C Active Fire',
    };

    const textureLoader = new THREE.TextureLoader();
    const sparkTex = textureLoader.load('/assets/textures/fx/spark.png');
    const circleTex = textureLoader.load('/assets/textures/fx/circle.png');

    // 1. Flickering Fire Point Light (Casts warm light & soft shadows)
    this.fireLight = new THREE.PointLight(0xff6a14, 6.5, 18, 1.8);
    this.fireLight.position.set(0, 1.4, 0);
    this.fireLight.castShadow = true;
    this.fireLight.shadow.bias = -0.002;
    this.fireLight.shadow.mapSize.width = 512;
    this.fireLight.shadow.mapSize.height = 512;
    this.group.add(this.fireLight);

    // 2. Charred and Glowing Ground Decal
    const decalGeo = new THREE.PlaneGeometry(5.2, 5.2);
    decalGeo.rotateX(-Math.PI / 2);

    const decalMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center) * 2.0;
          if (dist > 1.0) discard;

          // Charred blackened ash rim
          float ashAlpha = smoothstep(1.0, 0.4, dist) * 0.88;
          vec3 ashCol = vec3(0.06, 0.05, 0.05);

          // Glowing glowing hot core
          float glowCore = smoothstep(0.55, 0.05, dist);
          float pulse = sin(uTime * 4.0) * 0.15 + 0.85;
          vec3 glowCol = vec3(1.0, 0.35, 0.05) * glowCore * pulse * 2.2;

          vec3 finalCol = mix(ashCol, glowCol, glowCore * 0.85);
          float alpha = max(ashAlpha, glowCore * 0.95);
          gl_FragColor = vec4(finalCol, alpha);
        }
      `,
    });

    this.charredDecal = new THREE.Mesh(decalGeo, decalMat);
    this.charredDecal.position.y = 0.03;
    this.charredDecal.userData = { thermalTemp: 180.0 };
    this.group.add(this.charredDecal);

    // 3. Layered Flame Cards with Turbulence Shaders
    this.flameMaterial = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;

        // Fast Simplex-like noise
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          vec2 uv = vUv;
          // Animated upward flame motion
          vec2 flowUv = uv * vec2(2.5, 3.5) - vec2(0.0, uTime * 3.8);
          float n = noise(flowUv) * 0.5 + noise(flowUv * 2.0) * 0.25;

          // Flame tear shape (narrow at top, wide at base)
          float shape = (1.0 - uv.y) * 1.2;
          float d = abs(uv.x - 0.5) * 2.4;
          float flameMask = smoothstep(shape, shape - 0.35, d + n * 0.45);
          flameMask *= smoothstep(0.0, 0.15, uv.y) * smoothstep(1.0, 0.6, uv.y);

          // Color gradient: white-yellow core -> bright orange -> dark crimson tip
          vec3 cCore = vec3(1.0, 0.95, 0.8);
          vec3 cMid = vec3(1.0, 0.45, 0.05);
          vec3 cTip = vec3(0.8, 0.1, 0.0);

          vec3 col = mix(cCore, cMid, uv.y * 1.2);
          col = mix(col, cTip, smoothstep(0.4, 0.95, uv.y));

          gl_FragColor = vec4(col * 2.0, flameMask * 0.9);
        }
      `,
    });

    // 4 intersecting cross-billboards for full 3D volumetric appearance
    const flameGeo = new THREE.PlaneGeometry(1.6, 2.8);
    flameGeo.translate(0, 1.4, 0);

    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(flameGeo, this.flameMaterial);
      mesh.rotation.y = (i * Math.PI) / 4;
      mesh.userData = { thermalTemp: 750.0 };
      this.flameMeshes.push(mesh);
      this.group.add(mesh);
    }

    // 4. Rising Glowing Embers Particle System
    const emberGeo = new THREE.BufferGeometry();
    this.emberPositions = new Float32Array(this.emberCount * 3);
    this.emberVelocities = new Float32Array(this.emberCount * 3);
    this.emberLifetimes = new Float32Array(this.emberCount);

    for (let i = 0; i < this.emberCount; i++) {
      this.resetEmber(i, true);
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(this.emberPositions, 3));

    this.emberMaterial = new THREE.PointsMaterial({
      map: sparkTex,
      color: 0xffaa33,
      size: 0.18,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.emberPoints = new THREE.Points(emberGeo, this.emberMaterial);
    this.emberPoints.userData = { thermalTemp: 450.0 };
    this.group.add(this.emberPoints);

    // 5. Soft Particle Smoke Plume (Wind-blown & buoyant)
    const smokeGeo = new THREE.BufferGeometry();
    this.smokePositions = new Float32Array(this.smokeCount * 3);
    this.smokeVelocities = new Float32Array(this.smokeCount * 3);
    this.smokeSizes = new Float32Array(this.smokeCount);
    this.smokeOpacities = new Float32Array(this.smokeCount);

    for (let i = 0; i < this.smokeCount; i++) {
      this.resetSmoke(i, true);
    }
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.smokePositions, 3));

    this.smokeMaterial = new THREE.PointsMaterial({
      map: circleTex,
      color: 0x3d3835,
      size: 1.2,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.smokePoints = new THREE.Points(smokeGeo, this.smokeMaterial);
    this.smokePoints.userData = {
      isThermalTarget: true,
      thermalTemp: 42.0, // Smoke warm but semi-transparent
    };
    this.group.add(this.smokePoints);
  }

  private resetEmber(i: number, randomTime = false) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.8;
    this.emberPositions[i * 3] = Math.cos(angle) * r;
    this.emberPositions[i * 3 + 1] = randomTime ? Math.random() * 3.5 : 0.2;
    this.emberPositions[i * 3 + 2] = Math.sin(angle) * r;

    // Upward velocity + outward drift
    this.emberVelocities[i * 3] = (Math.random() - 0.5) * 0.6 + 0.3; // wind drift
    this.emberVelocities[i * 3 + 1] = 1.2 + Math.random() * 1.8; // rise
    this.emberVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.6 + 0.2;

    this.emberLifetimes[i] = randomTime ? Math.random() * 2.5 : 0;
  }

  private resetSmoke(i: number, randomTime = false) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.6;
    this.smokePositions[i * 3] = Math.cos(angle) * r;
    this.smokePositions[i * 3 + 1] = randomTime ? Math.random() * 7.0 : 1.2;
    this.smokePositions[i * 3 + 2] = Math.sin(angle) * r;

    // Wind drift vector (+X, +Z) with slight swirl
    this.smokeVelocities[i * 3] = 0.5 + Math.random() * 0.4;
    this.smokeVelocities[i * 3 + 1] = 0.8 + Math.random() * 0.6; // rise
    this.smokeVelocities[i * 3 + 2] = 0.4 + Math.random() * 0.3;

    this.smokeSizes[i] = 0.6 + Math.random() * 0.4;
    this.smokeOpacities[i] = randomTime ? Math.random() : 0.0;
  }

  public update(deltaSec: number, simTimeSec: number) {
    // 1. Point Light Flicker
    const flicker =
      Math.sin(simTimeSec * 16.0) * 0.8 +
      Math.sin(simTimeSec * 31.0) * 0.5 +
      (Math.random() - 0.5) * 0.9;
    this.fireLight.intensity = Math.max(3.5, 6.5 + flicker);

    // 2. Update Shaders
    this.flameMaterial.uniforms.uTime.value = simTimeSec;
    const decalMat = this.charredDecal.material as THREE.ShaderMaterial;
    if (decalMat.uniforms?.uTime) decalMat.uniforms.uTime.value = simTimeSec;

    // 3. Embers Physics Loop
    const posAttr = this.emberPoints.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.emberCount; i++) {
      this.emberLifetimes[i] += deltaSec;
      if (this.emberLifetimes[i] > 2.8 || this.emberPositions[i * 3 + 1] > 4.5) {
        this.resetEmber(i);
      } else {
        // Turbulent swirl
        const swirl = Math.sin(simTimeSec * 4.0 + i) * 0.02;
        this.emberPositions[i * 3] += (this.emberVelocities[i * 3] + swirl) * deltaSec;
        this.emberPositions[i * 3 + 1] += this.emberVelocities[i * 3 + 1] * deltaSec;
        this.emberPositions[i * 3 + 2] += (this.emberVelocities[i * 3 + 2] - swirl) * deltaSec;
      }
    }
    posAttr.needsUpdate = true;

    // 4. Smoke Plume Physics Loop
    const smokePosAttr = this.smokePoints.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.smokeCount; i++) {
      this.smokePositions[i * 3 + 1] += this.smokeVelocities[i * 3 + 1] * deltaSec;
      this.smokePositions[i * 3] += this.smokeVelocities[i * 3] * deltaSec;
      this.smokePositions[i * 3 + 2] += this.smokeVelocities[i * 3 + 2] * deltaSec;

      // Expand as it ascends
      if (this.smokePositions[i * 3 + 1] > 8.0) {
        this.resetSmoke(i);
      }
    }
    smokePosAttr.needsUpdate = true;
  }

  public setQuality(preset: QualityPreset) {
    const config = PRESET_CONFIGS[preset];
    this.fireLight.castShadow = config.shadows;
    this.emberMaterial.size = preset === 'low' ? 0.25 : 0.18;
  }
}
