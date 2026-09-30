import * as THREE from 'three';

export class ThermalPipeline {
  public renderTargetThermal: THREE.WebGLRenderTarget;
  public renderTargetRGB: THREE.WebGLRenderTarget;
  private thermalMaterialsMap: Map<string, THREE.ShaderMaterial> = new Map();
  private originalMaterialsMap: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();

  constructor() {
    // Sensor render targets (320x240, 10-15 Hz budget per spec)
    this.renderTargetThermal = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this.renderTargetRGB = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
  }

  /**
   * Generates a calibrated Ironbow / FLIR false-color thermal shader for a specific temperature
   */
  public getThermalMaterial(tempC: number, isTransparent = false, opacity = 1.0): THREE.ShaderMaterial {
    const key = `${tempC.toFixed(1)}_${isTransparent}_${opacity.toFixed(2)}`;
    let mat = this.thermalMaterialsMap.get(key);
    if (mat) return mat;

    mat = new THREE.ShaderMaterial({
      transparent: isTransparent,
      opacity: opacity,
      depthWrite: !isTransparent,
      uniforms: {
        uTempC: { value: tempC },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTempC;
        varying vec3 vNormal;
        varying vec3 vViewPos;

        // Physical Ironbow FLIR SAR False Color Palette
        // 10C - 20C : Deep Indigo -> Navy
        // 20C - 32C : Slate Teal -> Olive
        // 32C - 42C : Yellow -> Orange-Red (Human body 36.5C pops clearly)
        // 50C - 750C: Vivid Orange -> Pure White (Fire 600C - 750C)
        vec3 evaluateThermalColor(float temp) {
          // Normalize into multi-tier radiance response
          float t;
          if (temp < 30.0) {
            // Ambient ground / water tier (10 - 30 C)
            t = clamp((temp - 12.0) / 18.0, 0.0, 1.0);
            vec3 cCold = vec3(0.04, 0.02, 0.18); // Deep purple-black
            vec3 cCool = vec3(0.12, 0.22, 0.55); // Blue
            return mix(cCold, cCool, t);
          } else if (temp < 48.0) {
            // Biological human survivor tier (30 - 48 C)
            t = clamp((temp - 30.0) / 18.0, 0.0, 1.0);
            vec3 cBio1 = vec3(0.25, 0.65, 0.20); // Greenish transition
            vec3 cBio2 = vec3(0.98, 0.82, 0.05); // Bright gold-yellow (body heat core)
            vec3 cBio3 = vec3(0.95, 0.22, 0.05); // High crimson
            return t < 0.5 ? mix(cBio1, cBio2, t * 2.0) : mix(cBio2, cBio3, (t - 0.5) * 2.0);
          } else {
            // Hazard fire & hot debris tier (48 - 750 C)
            t = clamp((temp - 48.0) / 600.0, 0.0, 1.0);
            vec3 cFire1 = vec3(0.98, 0.35, 0.02); // Fire orange
            vec3 cFire2 = vec3(1.0, 0.85, 0.45);  // Yellow hot
            vec3 cFire3 = vec3(1.0, 1.0, 1.0);   // Pure white hot (700C+)
            return t < 0.6 ? mix(cFire1, cFire2, t / 0.6) : mix(cFire2, cFire3, (t - 0.6) / 0.4);
          }
        }

        void main() {
          vec3 n = normalize(vNormal);
          vec3 v = normalize(vViewPos);
          // Subtle thermal limb darkening (Fresnel view-angle falloff)
          float fresnel = clamp(dot(n, v), 0.2, 1.0);

          vec3 color = evaluateThermalColor(uTempC) * (0.85 + 0.15 * fresnel);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.thermalMaterialsMap.set(key, mat);
    return mat;
  }

  /**
   * Renders the true thermal sensor pass using per-object physical temperatures
   */
  public renderThermalPass(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    target: THREE.WebGLRenderTarget | null
  ) {
    this.originalMaterialsMap.clear();

    // 1. Traverse and assign per-object calibrated thermal shaders
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        this.originalMaterialsMap.set(obj, obj.material);

        let tempC = 20.0; // default ambient
        if (obj.userData?.thermalTemp != null) {
          tempC = obj.userData.thermalTemp;
        } else if (obj.parent?.userData?.thermalTemp != null) {
          tempC = obj.parent.userData.thermalTemp;
        }

        const isTransparent = Boolean(
          Array.isArray(obj.material) ? obj.material[0].transparent : obj.material.transparent
        );
        const opacity = Array.isArray(obj.material) ? obj.material[0].opacity : obj.material.opacity;

        obj.material = this.getThermalMaterial(tempC, isTransparent, opacity);
      } else if (obj instanceof THREE.Points) {
        // Smoke is semi-transparent in thermal
        if (obj.userData?.thermalTemp != null) {
          const mat = obj.material as THREE.PointsMaterial;
          mat.color.setHex(0x6e4530); // Dim thermal infrared glow
          mat.opacity = 0.22; // Partly transparent in thermal
        }
      }
    });

    // 2. Render to target with thermal background
    const prevBg = scene.background;
    scene.background = new THREE.Color(0x060312); // Deep cold void

    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 3. Restore original materials and background
    scene.background = prevBg;
    this.originalMaterialsMap.forEach((origMat, mesh) => {
      mesh.material = origMat;
    });
    this.originalMaterialsMap.clear();
  }

  public dispose() {
    this.renderTargetThermal.dispose();
    this.renderTargetRGB.dispose();
    this.thermalMaterialsMap.forEach((m) => m.dispose());
    this.thermalMaterialsMap.clear();
  }
}
