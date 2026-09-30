# Project Attributions & Licensing Compliance

In accordance with SIH 2026 regulations and open-source licensing compliance, this document acknowledges all external research, libraries, and algorithmic references incorporated into AEROSAR.

| Project / Reference | License | Idea / Component Used | Implementation Notes |
|---|---|---|---|
| **EchoRescue** | Proprietary | Flight telemetry replay mechanism and structured safety reports | Architecture & concepts only. No proprietary source code, text, or schemas were copied. Clean-room Python/TypeScript implementation. |
| **gym-pybullet-drones** | MIT License | Quadrotor physics & dynamics formulation (thrust, aerodynamic drag, attitude response, velocity controller) | Reimplemented purely from published physical equations into 120 Hz fixed-step integrator in TypeScript and pure Python. No codebase source imported. |
| **EGO-Planner / Fast-Planner** (ZJU-FAST-Lab) | GPLv3 / BSD-3-Clause | Uniform cubic B-spline trajectory generation and analytic obstacle distance field with repulsive gradient | Reimplemented cleanly from the authors' published academic papers. No GPL source code was copied or linked. |
| **Ultralytics YOLOv8** | AGPL-3.0 | Real-time computer vision inference benchmark & optional detection backend | Integrated via standard API; project includes a synthetic perception fallback mimicking real precision/recall numbers (recall ~0.54, conf 0.35) without requiring model execution. |
| **Three.js** | MIT License | WebGL 3D rendering pipeline for browser-embedded simulation arena | Pinned npm dependency; all world meshes, terrain, and shaders are procedurally generated offline. |
| **Leaflet** | BSD-2-Clause | 2D interactive disaster tactical map | Initialized in canvas raster mode (`preferCanvas: true`) with local procedural grid tile basemap. |
| **FastAPI / Uvicorn** | MIT License / BSD-3-Clause | Asynchronous HTTP and WebSocket application server | Core API framework for telemetry routing and state synchronization. |

## 3D Environment Assets & Textures (CC0 / Permissive)

All visual textures, HDRIs, and sprites are CC0 / MIT licensed and committed locally in `public/assets/` to ensure 100% offline runtime operation without remote CDN dependencies.

| Asset Name | Source URL | License | Where Used |
|---|---|---|---|
| `overcast_day_1k.hdr` | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 | Default overcast post-disaster daylight IBL PMREM background & lighting |
| `dusk_1k.hdr` | https://polyhaven.com/a/spruit_sunrise | CC0 | Dusk tactical scenario lighting variant |
| `night_1k.hdr` | https://polyhaven.com/a/dikhololo_night | CC0 | Night searchlight & thermal testing scenario variant |
| `smoke_overcast_1k.hdr` | https://polyhaven.com/a/overcast_soil_puresky | CC0 | Low-visibility heavy smoke scenario variant |
| `mud_diff_1k.jpg`, `mud_nor_1k.jpg`, `mud_rough_1k.jpg` | https://polyhaven.com/a/brown_mud_dry | CC0 | Terrain splatting: wet mud & basin soil |
| `gravel_diff_1k.jpg`, `gravel_nor_1k.jpg`, `gravel_rough_1k.jpg` | https://polyhaven.com/a/bicolour_gravel | CC0 | Terrain splatting: gravel roads & ruin debris foundation |
| `dirt_diff_1k.jpg`, `dirt_nor_1k.jpg`, `dirt_rough_1k.jpg` | https://polyhaven.com/a/aerial_ground_rock | CC0 | Terrain splatting: dry rocky dirt & elevated mounds |
| `waternormals.jpg` | mrdoob/three.js (examples/textures/waternormals.jpg) | MIT / CC0 | Zone B Flooded Basin animated wave ripple normal map |
| `spark.png`, `circle.png`, `disc.png` | mrdoob/three.js (examples/textures/sprites/) | MIT / CC0 | Zone C rising flame embers, drifting smoke puffs, and dust particles |
| Humanoid Survivor Models | Procedural skinned / segmented anatomy mesh generator | MIT (Project code) | Prone, seated, and trapped survivor figures with idle breathing motion |

