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
