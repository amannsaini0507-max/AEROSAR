import * as THREE from 'three';
import type { QualityPreset } from './types';

export class WaterSystem {
  public mesh: THREE.Mesh;
  public geometry: THREE.PlaneGeometry;
  public material: THREE.ShaderMaterial;
  public debrisGroup: THREE.Group;
  public position: THREE.Vector3;
  private floatingItems: Array<{ mesh: THREE.Mesh; basePos: THREE.Vector3; freq: number; phase: number }> = [];

  constructor(pos: [number, number, number] = [6.0, 0.18, -6.0], size: [number, number] = [16.0, 16.0]) {
    this.position = new THREE.Vector3(...pos);
    this.geometry = new THREE.PlaneGeometry(size[0], size[1], 48, 48);
    this.geometry.rotateX(-Math.PI / 2);

    const textureLoader = new THREE.TextureLoader();
    const waterNormals = textureLoader.load('/assets/textures/water/waternormals.jpg');
    waterNormals.wrapS = THREE.RepeatWrapping;
    waterNormals.wrapT = THREE.RepeatWrapping;

    // Physically accurate murky flood water shader
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        tNormals: { value: waterNormals },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
        uDeepColor: { value: new THREE.Color(0x133842) }, // Murky flood depth
        uShallowColor: { value: new THREE.Color(0x286373) }, // Shallow murky sediment
        uFoamColor: { value: new THREE.Color(0xdceef5) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vViewDir;
        uniform float uTime;

        void main() {
          vUv = uv * 6.0;
          vec3 pos = position;
          // Gentle physical swell
          float wave1 = sin(pos.x * 0.8 + uTime * 1.5) * cos(pos.z * 0.8 + uTime * 1.2) * 0.04;
          float wave2 = sin(pos.x * 1.8 - uTime * 2.2) * 0.015;
          pos.y += wave1 + wave2;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vViewDir = cameraPosition - worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D tNormals;
        uniform vec3 uSunDir;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;

        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vViewDir;

        void main() {
          vec3 viewDir = normalize(vViewDir);

          // Bi-directional scrolling waves interference
          vec2 uv1 = vUv + vec2(uTime * 0.035, uTime * 0.025);
          vec2 uv2 = vUv * 1.4 - vec2(uTime * 0.028, -uTime * 0.038);
          vec3 n1 = texture2D(tNormals, uv1).rgb * 2.0 - 1.0;
          vec3 n2 = texture2D(tNormals, uv2).rgb * 2.0 - 1.0;
          vec3 normal = normalize(vec3(n1.x + n2.x, 2.8, n1.y + n2.y));

          // Fresnel reflectance (Schlick approximation)
          float cosTheta = clamp(dot(normal, viewDir), 0.0, 1.0);
          float fresnel = 0.04 + (1.0 - 0.04) * pow(1.0 - cosTheta, 5.0);

          // Specular sunlight highlight
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 128.0) * 1.8;

          // Shoreline distance falloff (simulated edge transparency)
          float edgeDist = min(
            min(vWorldPos.x - (-2.0), 14.0 - vWorldPos.x),
            min(vWorldPos.z - (-14.0), 2.0 - vWorldPos.z)
          );
          float edgeAlpha = clamp(edgeDist * 0.8, 0.45, 0.88);

          // Shoreline foam fringe
          float foam = smoothstep(0.4, 0.05, edgeDist) * 0.5;

          vec3 waterCol = mix(uDeepColor, uShallowColor, fresnel * 0.7);
          waterCol += spec * vec3(1.0, 0.95, 0.85);
          waterCol = mix(waterCol, uFoamColor, foam);

          gl_FragColor = vec4(waterCol, edgeAlpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.copy(this.position);
    this.mesh.receiveShadow = true;

    // Thermal properties: Water cooler than ground (~16.0 deg C)
    this.mesh.userData = {
      isThermalTarget: true,
      thermalTemp: 16.0,
      label: 'Zone B Flooded Basin',
    };

    // 4. Floating Bobbing Debris (Wooden planks, barrels, debris)
    this.debrisGroup = new THREE.Group();
    this.debrisGroup.position.copy(this.position);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a432b, roughness: 0.8 });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x245580, roughness: 0.4, metalness: 0.6 });

    // Floating wooden planks
    for (let i = 0; i < 5; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.8 + Math.random() * 0.6, 0.06, 0.28), woodMat);
      const bx = (Math.random() - 0.5) * 8.0;
      const bz = (Math.random() - 0.5) * 8.0;
      plank.position.set(bx, 0.02, bz);
      plank.rotation.y = Math.random() * Math.PI;
      plank.castShadow = true;
      this.debrisGroup.add(plank);
      this.floatingItems.push({
        mesh: plank,
        basePos: new THREE.Vector3(bx, 0.02, bz),
        freq: 1.2 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Floating plastic/metal barrels
    for (let i = 0; i < 3; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.65, 10), barrelMat);
      barrel.rotation.z = Math.PI / 2.2;
      const bx = (Math.random() - 0.5) * 7.0;
      const bz = (Math.random() - 0.5) * 7.0;
      barrel.position.set(bx, 0.05, bz);
      barrel.castShadow = true;
      this.debrisGroup.add(barrel);
      this.floatingItems.push({
        mesh: barrel,
        basePos: new THREE.Vector3(bx, 0.05, bz),
        freq: 1.5 + Math.random() * 0.6,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  public update(simTimeSec: number) {
    this.material.uniforms.uTime.value = simTimeSec;

    // Bobbing debris animation
    this.floatingItems.forEach((item) => {
      const wave = Math.sin(simTimeSec * item.freq + item.phase) * 0.035;
      item.mesh.position.y = item.basePos.y + wave;
      item.mesh.rotation.x = Math.sin(simTimeSec * item.freq * 0.8) * 0.08;
      item.mesh.rotation.z = Math.cos(simTimeSec * item.freq * 0.7) * 0.08;
    });
  }

  public setQuality(preset: QualityPreset) {
    this.debrisGroup.visible = preset !== 'low';
  }
}
