# AEROSAR Architectural & Engineering Decisions

This document records architectural decisions, defaults, and conflict resolutions for the AEROSAR project (SIH 2026, PS 26177).

## 1. Runtime Architecture: Two Runtimes, One Brain
- **Decision:** All mathematical and operational logic (rescue priority risk scoring, A* safe route planning, multi-sensor fusion, spatial deduplication, geodetic math, and vehicle state management) is encapsulated in a pure-Python package `aerosar_core/`.
- **Rationale:** Prevents logic duplication between the ROS 2 Linux stack and the Windows standalone stack.
- **Rule:** `aerosar_core` strictly contains standard Python library and numerical dependencies (`math`, `heapq`, `typing`, `dataclasses`, `pydantic`), and NEVER imports `rclpy` or ROS 2 dependencies.

## 2. ROS 2 vs. Standalone Mode Detection
- **Decision:** `rclpy` is imported conditionally inside a `try/except ImportError` block in `backend/app/main.py`.
- **Behavior:**
  - If `rclpy` is present and functional: Starts in `mode: "ros2"`.
  - If `rclpy` is missing or fails: Starts in `mode: "standalone"`, running local 30 Hz drone simulation, synthetic perception, and WebSocket telemetry dispatch.
- **Health Reporting:** `/health` and `/api/health` expose `{"status": "ok", "mode": "ros2" | "standalone", "ros2_active": bool}`.

## 3. Ports and Networking
- **Backend API & WebSocket:** Port 8000 (configurable via `PORT` environment variable).
- **Frontend Dashboard:** Port 5173 (standard Vite development server).
- **Conflict Handling:** The Node launcher (`scripts/start_aerosar.js`) probes ports 8000 and 5173 before startup and reports or frees occupying processes cleanly.

## 4. Single Source of Truth Alignment (Master Document)
- **Document:** `docs/AEROSAR_SIH_PS26177_Master_Document_final.md` is the authoritative specification.
- **Origin Reference:** Jaipur Disaster Arena:
  - Latitude: 26.9124 N
  - Longitude: 75.7873 E
  - Base Altitude: 1.5 m AGL
- **Risk Formula (§11):**
  - Weights: `0.35 * C + 0.30 * proximity + 0.20 * cluster + thermal_bonus`
  - Max distance: `MAX_DIST = 20.0` meters
  - Max count: `MAX_COUNT = 5` survivors within `CLUSTER_RADIUS = 10.0` meters
  - Thermal bonus: `0.15` when `thermal_confirmed == True`
  - Priority levels: `< 0.35` LOW, `< 0.55` MEDIUM, `< 0.75` HIGH, `>= 0.75` CRITICAL
  - Human-readable explainable reason string per §11.6.

## 5. Storage & Persistence
- **Engine:** SQLite with Write-Ahead Logging (`PRAGMA journal_mode=WAL;`).
- **Location:** `data/aerosar.db`, created with `pathlib.Path("data")`.
- **Tables:**
  - `events`: append-only event log with `synced` flag for offline buffering.
  - `replay_frames`: frame-accurate mission recordings indexed by `(mission_id, seq)`.
  - `safety_reports`: structured failsafe audit trail.

## 6. Zero SVG / Zero Mermaid / Zero CDN Policy
- **Rendering:** All icons use HTML Canvas rendering or CSS shapes. No `<svg>` tags or SVG vector draws.
- **Leaflet:** Map initialized with `{ preferCanvas: true }` and procedural dark grid canvas tile layer.
- **WebGL:** Three.js is pinned in `package.json` and bundled locally by Vite; all textures and particle shaders are procedurally generated with zero remote asset downloads.

## 7. Fullscreen Canvas & Resize Bug Resolution
- **Confirmed Root Cause:** The canvas container lacked a ResizeObserver and relied solely on window resize and initial mount dimensions, while the WebGL canvas lacked display:block and 100% CSS styling and renderer.setSize was called without updateStyle=false, causing high-DPR rendering to remain clipped to the top-left quarter when container layout changed.
- **Implementation Strategy:**
  - Standardized on a dedicated `ResizeObserver` observing the canvas container directly.
  - A single `resize()` pipeline reads clientWidth/clientHeight in a `requestAnimationFrame`, sets camera aspect, updates projection matrix, updates pixel ratio (`Math.min(devicePixelRatio, 2)`), and invokes `renderer.setSize(w, h, false)`.
  - Resizes composer passes (`postProcessing.setSize(w, h)`) while strictly preserving the 320x240 camera sensor render targets.
  - Fullscreen API wraps the composite container containing the canvas, tactical HUD, and flight controls, with a clean CSS fallback (`fixed inset-0 z-50`) without stacking mechanisms.

## 8. Autonomous Lawnmower Search & Hover-Verify Lifecycle
- **Arena & Grid:** 30m x 30m arena, cruise altitude `H = 5.0m`, cruise speed `2.5m/s`, 11 lanes spanning -14m to +14m at 2.8m spacing.
- **Sub-State Machine:** Runs inside `IN_FLIGHT`:
  `PATROLLING -> VICTIM_LOCKED -> HOVER_STABILISING -> HOVER_CONFIRMING -> (CONFIRMED | REJECTED) -> RESUME_PATROL`.
- **Hover Verification:**
  - 5.5s fixed simulation-time verification duration (freezes when simulation is paused).
  - Target hover point is directly above candidate at `Y = 4.0m`, maintaining >=2.0m clearance from active fire hazards.
  - Thermal false-color render-target and biological signature analysis: >=80% samples in 30-40 C range confirms genuine survivor, while cold mannequin test objects (<30 C) or fire hotspots (>50 C) are rejected.
  - Manual flight override immediately aborts hover in 1 frame, releasing WASD flight controls; returning to AUTONOMOUS seamlessly resumes search from the saved waypoint index.

## 9. WebGL LiDAR Sensor & Raycasting Architecture
- **Specification:**
  - 16 vertical channels spanning $\pm 15^\circ$ elevation ($2^\circ$ channel spacing), $1^\circ$ azimuthal resolution ($360$ steps), producing $5,760$ rays per full $360^\circ$ scan.
  - Scan rate: 10 Hz in standard mode, 5 Hz in LOW_POWER mode.
  - Range: 0.5 m to 40.0 m.
  - Noise model: Zero-mean Gaussian measurement noise ($\sigma = 0.02\text{ m}$ / 2 cm), coupled with a 2% random ray dropout rate.
  - Material response table: Concrete/Ruins (reflectivity 0.65, 0% dropout), Terrain/Soil (reflectivity 0.50, 0% dropout), Metal/Drone (reflectivity 0.90, 0% dropout), Water (reflectivity 0.30, 70% specular absorption dropout), Fire (reflectivity 0.0, 100% absorption dropout), Smoke (reflectivity 0.15, transparent / 0% dropout).
  - Target proxies: Dynamic survivor victim capsules (radius 0.35m, height 1.7m) are intersected via analytic capsule math, yielding high reflectivity (0.85).
- **Worker Offload:**
  - All static collidable scene meshes (ruins, pillars, terrain, walls) are extracted and merged into a single `BufferGeometry` on scene initialization.
  - A single accelerated bounding volume hierarchy is constructed with `three-mesh-bvh`.
  - The $5,760$ raycasts are performed asynchronously inside a dedicated Web Worker (`lidar.worker.ts`).
  - Point cloud returns are transferred back to the main thread via zero-copy `Float32Array` buffer transfer (`postMessage(..., [buffer])`), eliminating main thread garbage collection pauses and frame drops.
- **Rendering & Ring Buffer:**
  - Main thread maintains a preallocated 3-second ring buffer (172,800 points max) in a `THREE.BufferGeometry` rendered via `THREE.Points`.
  - Vertex colors are procedurally evaluated from relative elevation and return reflectivity.
  - Real-time 8-sector minimum obstacle ranges are computed per scan and dispatched via `lidar_summary` at 5 Hz, feeding reactive obstacle deflection (<2.0m repulsion) and the tactical 2D HUD radar plot.

## 10. Ground Source Station Entity
- **Position & Geometry:**
  - Positioned at fixed scenario coordinates `[-13.0, -13.0]` with antenna mast height $6.0\text{ m}$.
  - Visualized as a 3D structural mast with an omnidirectional collinear antenna, animated pulsing LED beacon (amber in LoRa mode, green in Network mode), and an ground coverage radius ring.
- **Role:**
  - Acts as the central RF sink and relay bridge when terrestrial IP network coverage is severed.
  - Decodes incoming binary LoRa frames, runs error checking, updates link statistics, and relays survivor and hazard updates directly to the mission command engine with `via: "lora"`.

## 11. Browser-Simulated LoRa RF Propagation Model
- **Frequency & Radio Specs:**
  - Band: EU868 (868 MHz), Bandwidth: 125 kHz, Coding Rate: 4/5, Preamble: 8 symbols, Explicit Header, CRC enabled.
  - Receiver Sensitivity and SNR thresholds modeled directly on the Semtech SX1276 transceiver datasheet:
    - SF7: Sensitivity $-123\text{ dBm}$, SNR threshold $-7.5\text{ dB}$, Bitrate $5,470\text{ bps}$.
    - SF8: Sensitivity $-126\text{ dBm}$, SNR threshold $-10.0\text{ dB}$, Bitrate $3,125\text{ bps}$.
    - SF9: Sensitivity $-129\text{ dBm}$, SNR threshold $-12.5\text{ dB}$, Bitrate $1,758\text{ bps}$.
    - SF10: Sensitivity $-132\text{ dBm}$, SNR threshold $-15.0\text{ dB}$, Bitrate $977\text{ bps}$.
    - SF11: Sensitivity $-134.5\text{ dBm}$, SNR threshold $-17.5\text{ dB}$, Bitrate $537\text{ bps}$.
    - SF12: Sensitivity $-137\text{ dBm}$, SNR threshold $-20.0\text{ dB}$, Bitrate $293\text{ bps}$.
- **"Radio-Scaled" Distance Assumption (`worldScale = 40`):**
  - To faithfully simulate kilometer-range RF propagation physics, building shadow fading, and adaptive spreading factor transitions within a compact $30\text{m} \times 30\text{m}$ disaster arena, a radio scaling factor of $40\times$ is applied to RF path calculations.
  - 1 meter of 3D arena coordinate distance corresponds to 40 meters of RF path distance (arena diagonal $42.4\text{m} \rightarrow 1,697\text{m}$ RF distance).
  - Both dashboard Panel 7 and telemetry explicitly flag this with a `"radio-scaled"` indicator.
- **Propagation Physics:**
  - Free-space path loss at 1 meter: $PL_0 = 20\log_{10}(1) + 20\log_{10}(868\times 10^6) - 147.55 \approx 31.2\text{ dB}$.
  - Log-distance path loss with path loss exponent $n = 2.7$ (urban disaster environment):
    $$PL(d) = PL_0 + 10 \cdot n \cdot \log_{10}(d_{\text{scaled}})$$
  - Building obstruction raycast: A line-of-sight ray is cast against the scene mesh BVH between the drone position and station antenna. Each intersected concrete obstacle contributes $+8.0\text{ dB}$ attenuation; debris contributes $+4.0\text{ dB}$.
  - Adaptive Data Rate (ADR): Selects lowest SF (fastest airtime) providing at least $\ge 6.0\text{ dB}$ fade margin above sensitivity and SNR limits.
- **Airtime & Duty Cycle Regulations:**
  - Exact Time-on-Air (ToA) computed using the Semtech AN1200.13 analytical formula.
  - Strict ETSI 1% airtime limit enforced using a rolling 1-hour window accumulator (`DutyCycleTracker`). Transmissions are delayed if duty cycle allowance is exceeded.
- **Priority Queue & Offline Outbox:**
  - Priority order: `CRITICAL` (Victim detections) > `HIGH` (Hazards) > `NORMAL` (Periodic heartbeats).
  - Packets are retried up to 3 times with exponential backoff and random jitter.
  - During prolonged disconnection or offline conditions, packets accumulate in a persistent outbox buffer and flush automatically upon link recovery.

## 12. Compact Binary Telemetry Frame Format
- **Constraint:** All frames are limited to $\le 51$ bytes to respect the strictest LoRaWAN EU868 DR0 payload budget.
- **Structure:** Encoded via big-endian `DataView` with 0xAE magic byte and 1-byte CRC-8 check:
  - `HEARTBEAT` (15 bytes): Magic (`0xAE`), Type (`0x01`), Seq (`uint16`), State (`uint8`), Battery (`uint8`), Lat (`int32` $\times 10^{-7}$), Lon (`int32` $\times 10^{-7}$), Alt (`uint16` in 0.1m units).
  - `VICTIM` (31 bytes): Magic (`0xAE`), Type (`0x02`), Seq (`uint16`), VictimId (8 bytes UTF-8/ASCII null-padded), Status (`uint8`: 1=VERIFYING, 2=CONFIRMED, 3=REJECTED), Conf (`uint8`, 0-100), Lat (`int32`), Lon (`int32`), Alt (`uint16`), Temp (`uint16` in 0.1°C), RiskScore (`uint8`, 0-100), Priority (`uint8`: 0=LOW, 1=MED, 2=HIGH, 3=CRITICAL).
  - `HAZARD` (14 bytes): Magic (`0xAE`), Type (`0x03`), Seq (`uint16`), HazardType (`uint8`: 1=fire, 2=smoke, 3=flood, 4=debris, 5=structure), Conf (`uint8`, 0-100), Lat (`int32`), Lon (`int32`), Radius (`uint16` in 0.1m units).
  - `ACK` (4 bytes): Magic (`0xAE`), Type (`0x04`), AckedSeq (`uint16`), Checksum (`uint8`).


