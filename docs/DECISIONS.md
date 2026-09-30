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
