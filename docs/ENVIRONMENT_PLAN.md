# AEROSAR: 3D Disaster Environment Architecture Plan
SIH 2026 - Problem Statement 26177

================================================================================
1. CURRENT SCENE AUDIT & IDENTIFIED DEFECTS
================================================================================

Current Scene Defects (Simulator3DView.tsx):
- Terrain: Flat 30m x 30m grid with simple sine-wave displacement; single 2D
  canvas speckle texture with severe tiling and no normal/roughness detail.
- Zone A (Ruins): 9 basic grey boxes (BoxGeometry), no concrete fractures,
  no exposed rebar, no dust or volumetric debris.
- Zone B (Flooded Basin): Flat blue plane with static opacity; no wave normal
  ripples, no Fresnel reflection, no shoreline foam, no depth extinction.
- Zone C (Fire & Smoke): Solid yellow ConeGeometry; basic point light with random
  jitter; simple low-density point cloud for smoke; no heat shimmer or embers.
- Victims: Generic primitive CapsuleGeometry cylinders with solid RGB colors.
- Drone: Simplified box and cylinder assembly; no rotor blur or status beacons.
- Thermal Camera: Naive post-processing RGB luminance recolor
  (dot(rgb, [0.299, 0.587, 0.114])) rather than true per-object heat radiation.
- Layout & UI: Hardcoded 320px height in sidebar card; no fullscreen view; no
  preset selection; no live FPS counter; no photo mode.

================================================================================
2. GRAPHICS ARCHITECTURE & RENDERING PIPELINE
================================================================================

Renderer Configuration:
- Color Space: Linear-sRGB workflow with THREE.SRGBColorSpace.
- Tone Mapping: ACESFilmicToneMapping with configurable exposure (0.9 - 1.2).
- Shadows: Directional cascade/fitted PCFSoftShadowMap (1024x1024 to 2048x2048).
- Lighting: Image-Based Lighting (IBL) via PMREMGenerator from high-dynamic
  range equirectangular environment maps (day, dusk, night, smoke variants).

Post-Processing Stack (postprocessing / three/examples/jsm):
- GTAO / SSAO: Screen-space ambient occlusion for realistic ground contact
  shadows under rubble, debris, and victim bodies.
- Bloom: Selective unreal bloom pass targeting flame emitters and glowing embers.
- Anti-Aliasing: SMAA (Subpixel Morphological Anti-Aliasing) on High/Ultra;
  FXAA on Medium; disabled on Low.
- Vignette & Aerial Haze: Soft perimeter falloff and atmospheric depth fog.

================================================================================
3. ASSETS & LOCAL STORAGE (Zero CDN / 100% Offline Runtime)
================================================================================

All assets pre-downloaded and stored under public/assets/ (total < 60 MB):

1. HDR Environment Maps (public/assets/hdri/):
   - overcast_day_1k.hdr     (CC0 - Poly Haven) : Post-disaster overcast daylight
   - dusk_1k.hdr             (CC0 - Poly Haven) : Sunset tactical lighting
   - night_1k.hdr            (CC0 - Poly Haven) : Low-light searchlight testing
   - smoke_overcast_1k.hdr   (CC0 - Poly Haven) : Dense particulate sky

2. Terrain PBR Textures (public/assets/textures/terrain/):
   - mud_diff_1k.jpg, mud_nor_1k.jpg, mud_rough_1k.jpg         (CC0 - ambientCG)
   - gravel_diff_1k.jpg, gravel_nor_1k.jpg, gravel_rough_1k.jpg (CC0 - ambientCG)
   - dirt_diff_1k.jpg, dirt_nor_1k.jpg, dirt_rough_1k.jpg     (CC0 - ambientCG)
   - ash_diff_1k.jpg, ash_nor_1k.jpg, ash_rough_1k.jpg         (CC0 - ambientCG)

3. Water & FX Textures (public/assets/textures/fx/):
   - water_normal.jpg        (CC0/MIT - Three.js examples) : Wave ripple normal map
   - flame_sheet.png         (CC0 - Kenney/custom generated) : Multi-frame flame card
   - smoke_puff.png          (CC0 - Particle pack) : Soft particulate smoke
   - ember_spark.png         (CC0 - Particle pack) : Glowing rising sparks
   - concrete_crack.jpg      (CC0 - ambientCG) : Ruin fracture decal

4. 3D Models & Meshes (public/assets/models/):
   - Quadrotor drone: Detailed carbon-frame chassis, motor mounts, landing skids,
     propeller blur discs, navigation LEDs.
   - Ruins & Debris: Fractured concrete slabs, exposed reinforcement rebar meshes,
     instanced rubble piles (120+ chunks with zero extra draw calls).
   - Victims: Believable human figures (seated survivor, prone survivor, trapped
     survivor) with clothing color variation and subtle breathing animation.

================================================================================
4. QUALITY PRESETS & PERFORMANCE TARGETS
================================================================================

Performance Budget:
- Ultra: 1080p, GTAO, Bloom, SMAA, 2048 shadow maps, 1500 particles, Target: 60 FPS
- High:  1080p, SSAO, Bloom, SMAA, 1024 shadow maps, 800 particles,  Target: 60 FPS
- Medium: 720p-1080p, FXAA, Bloom, 1024 shadow maps, 400 particles,   Target: 60 FPS
- Low:   Native res, no post-proc, basic shadows off, 150 particles,  Min: 30 FPS

Adaptive Dynamic Resolution:
- Rolling 30-frame frametime monitoring.
- If render frametime > 22ms (< 45 FPS), drops viewport scale from 1.0 to 0.75.
- Recovers back to 1.0 when frametime stabilizes under 15ms.

================================================================================
5. THERMAL CAM PHYSICS SPECIFICATION
================================================================================

Per-object thermal radiance material channel:
- Human Victims:       36.5 deg C (Radiance 0.65)
- Fire Core:           750.0 deg C (Radiance 1.00)
- Charred / Embers:    120.0 deg C (Radiance 0.85)
- Mud / Dry Ground:     20.0 deg C (Radiance 0.22)
- Water Basin:          16.0 deg C (Radiance 0.15)
- Concrete Ruins:       18.0 deg C (Radiance 0.19)
- Smoke Plume:          38.0 deg C (Radiance 0.30, 40% thermal transmittance)

Palette: Multi-stop Ironbow / Inferno false color LUT (Deep Blue -> Purple ->
Orange -> White Hot) driven strictly by physical temperatures.

================================================================================
6. MILESTONE EXECUTION ORDER
================================================================================

- Milestone A: Core renderer, IBL/HDRI, ACES tone mapping, postprocessing stack,
  quality presets, live FPS counter, fullscreen toggle.
- Milestone B: Heightfield terrain, triplanar texture splatting, Zone C fire,
  smoke plume, embers, heat shimmer.
- Milestone C: Zone B water (Fresnel, ripple normals, depth foam), Zone A ruins
  (fractured modular slabs, exposed rebar, GPS-denied volume).
- Milestone D: Believable victim models with breathing motion, quadrotor drone,
  thermal shader consistency, scenario JSON loader.
- Milestone E: Instancing & LOD optimization, Photo Mode (orbit + 4K capture +
  path tracer), attribution audit, automated Playwright benchmarks.
