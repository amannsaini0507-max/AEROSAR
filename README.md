# AEROSAR — AI-Enabled Autonomous Emergency Search and Rescue Drone

[![SIH 2026](https://img.shields.io/badge/SIH-2026_PS_26177-blue.svg)](#)
[![Python](https://img.shields.io/badge/Python-3.10%2B-green.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-orange.svg)](#)

AEROSAR is an AI-powered autonomous UAV system engineered for emergency search-and-rescue operations in disaster environments (earthquakes, structural collapses, floods, and wildfires). It features onboard AI perception, false-color thermal sensor simulation, multi-sensor fusion, explainable rescue risk prioritization, resilient offline synchronization, and an embedded 3D WebGL Tactical Command Center.

---

## 1. Dual-Runtime Architecture ("Two Runtimes, One Brain")

The codebase is built on a shared algorithmic core (`aerosar_core/`) that runs seamlessly in two environments:

1. **Native Windows 10/11 Runtime (Standalone / Demo Mode)**:
   - Runs natively on Windows with Python 3.10+ and Node.js 18+ — **no WSL, Docker, or Linux required**.
   - Features an embedded near-photorealistic 3D WebGL simulator (Three.js) running directly inside the React Command Center.
   - Provides 120 Hz quadrotor flight dynamics, dual RGB/Thermal camera render passes, and autonomous lawnmower search with thermal hover-verification.

2. **Native Linux Runtime (ROS 2 / Middleware Mode)**:
   - Full ROS 2 Galactic/Humble compatibility with Webots desktop simulation.
   - ROS 2 nodes and custom messages (`aerosar_msgs`) delegate path planning, sensor fusion, and risk calculation directly to `aerosar_core`.

```text
               +-------------------------------------------------+
               |         aerosar_core (Pure Python)              |
               | • Risk Engine (§11 Formula)                     |
               | • A* Safe Access Route Planner                  |
               | • Multi-Sensor Fusion & Deduplication           |
               | • Geodetic ENU Coordinate Conversions           |
               | • Validated Vehicle State Machine               |
               +-----------------------+-------------------------+
                                       |
                   +-------------------+-------------------+
                   |                                       |
    [Standalone Windows Mode]                   [ROS 2 Linux Mode]
  FastAPI Server (uvicorn :8000)             ROS 2 Nodes & Topics
  WebSocket Telemetry Stream (/ws/live)      Webots Desktop Simulation
  SQLite WAL Event & Replay DB               Custom ROS 2 Messages
  React + Vite Command Center (:5173)        Gazebo / Webots Worlds
```

---

## 2. Prerequisites

Before running the project on your machine, ensure you have:

- **Node.js**: Version 18.0 or newer ([nodejs.org](https://nodejs.org/))
- **Python**: Version 3.10 or newer ([python.org](https://www.python.org/))
- **Git**: Installed and available in your terminal ([git-scm.com](https://git-scm.com/))
- **Browser**: Any modern browser (Google Chrome, Microsoft Edge, Brave, Firefox) with WebGL 2.0 enabled.

---

## 3. Quick Start (Single-Command Launch)

The project includes an intelligent, cross-platform unified launcher that automates environment setup:

### Clone the Repository
```bash
git clone https://github.com/amannsaini0507-max/AEROSAR.git
cd AEROSAR
```

### Launch on Windows (Recommended)
Run either of the following commands from the root directory:

```powershell
npm start
```
*Or using the PowerShell wrapper:*
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_aerosar.ps1
```

### What the Unified Launcher Does Automatically:
1. Validates Node.js ($\ge 18$) and Python ($\ge 3.10$) versions.
2. Creates a Python virtual environment (`.venv`) and installs dependencies from `requirements.txt` if needed.
3. Runs `npm install` inside `frontend/` if `node_modules` is missing.
4. Detects and resolves port conflicts on port `8000` (backend) and `5173` (frontend).
5. Starts the FastAPI backend with SQLite WAL mode.
6. Starts the Vite frontend server.
7. Polls `/api/health` until HTTP 200 is reported, then **automatically opens your default browser** to `http://localhost:5173`.
8. Tears down all backend and frontend processes cleanly when you press `Ctrl+C`.

---

## 4. Manual Setup (Alternative Step-by-Step)

If you prefer to start the backend and frontend separately:

### Step 1: Backend Setup
```bash
# From the repository root
python -m venv .venv

# Activate virtual environment:
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI server
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Step 2: Frontend Setup
```bash
# In a new terminal window
cd frontend
npm install
npm run dev -- --port 5173
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 5. Command Center Features (8-Panel Dashboard)

```text
+---------------------------------------------------------------------------------------+
|  AEROSAR Command Center (SIH 2026 PS 26177)                  [ LINK: CONNECTED 30Hz ] |
+---------------------------------------------------------------------------------------+
|  [Replay Bar]: [Play] [Pause] [Scrub Slider: 00:00 / 01:15] [Speed: 1x | 2x | 4x]    |
+-------------------------------------------+-------------------------------------------+
| Panel 1: 3D WebGL Simulator (Three.js)    | Panel 2: Leaflet Tactical Map (Canvas)   |
| • Procedural 30m x 30m Arena              | • Local dark grid basemap (zero CDN)     |
| • Quadrotor with 120Hz flight dynamics    | • Drone position & heading marker        |
| • Zone A: Collapsed Ruins (Victim 1)      | • Survivor pins (color-coded by priority)|
| • Zone B: Flooded Basin (Victim 2)        | • Hazard danger zones (fire, debris)     |
| • Zone C: Fire Zone & Smoke (Victim 3)    | • Real-time A* safe access route line    |
| • [RGB / Thermal Camera] shader toggle    |                                           |
| • [YOLO CPU Mode] edge inference toggle   |                                           |
| • Fullscreen & Expand view (no clipping)  |                                           |
| • Tactical HUD overlay with target boxes  |                                           |
| • Photo Mode with 4K export & path tracer |                                           |
+-------------------------------------------+-------------------------------------------+
| Panel 3: Ranked Survivor Queue            | Panel 4: Alert Feed                       |
| • Master Doc §11 exact risk formula       | • Real-time failsafe & detection alerts   |
| • Proximity, cluster, and thermal bonuses | • CRITICAL (Red) with explainable reasons |
| • Survivor pins with GPS coordinates      | • HIGH / MEDIUM situational warnings      |
+-------------------------------------------+-------------------------------------------+
| Panel 5: Mission Status & Battery         | Panel 6: Live Telemetry                   |
| • State: DISARMED -> ARMED -> IN_FLIGHT   | • Latitude / Longitude (with GPS noise)   |
| • Battery percentage & drain rate         | • Altitude (AGL), Heading, Ground Speed   |
| • Heartbeat pulse (1 Hz watchdog)         | • IMU Pitch, Roll, Yaw rates              |
+-------------------------------------------+-------------------------------------------+
| Panel 7: Offline Resilience & Link Sync   | Panel 8: Flight Controls                  |
| • [Simulate Link Cut] / [Restore Link]    | • Autonomous Lawnmower Search [Start]     |
| • Outbox buffer count (zero lost events)  | • [Pause] / [Resume] / [RTL]              |
| • Stale packet detection (< 5s threshold) | • [EMERGENCY LAND] failsafe trigger       |
|                                           | • Instant Manual WASD keyboard overrides  |
+-------------------------------------------+-------------------------------------------+
```

### Key Interactive Operations:
- **Autonomous Search**: Click **"Start Mission"** or toggle **"AUTONOMOUS"**. The drone sweeps an 11-lane grid ($-14\text{ m}$ to $+14\text{ m}$ at $2.8\text{ m}$ spacing at $5.0\text{ m}$ altitude).
- **Hover-Verify**: When encountering a survivor, the drone stabilizes and enters a $5.5\text{ s}$ thermal verification scan. True body heat ($37^\circ\text{C}$) confirms the survivor, calculates risk score, and plots an A* safe route. Cold mannequins ($18.5^\circ\text{C}$) or fire hotspots are rejected.
- **Manual WASD Flight Override**: Click **"MANUAL"** at any moment during autonomous flight to immediately regain keyboard control (<kbd>W</kbd>/<kbd>S</kbd> pitch, <kbd>A</kbd>/<kbd>D</kbd> roll, <kbd>Space</kbd>/<kbd>Shift</kbd> altitude). Switching back to **"AUTONOMOUS"** resumes search from the saved waypoint.
- **Thermal Infrared Shader**: Toggle **"Thermal"** in Panel 1 to switch from natural RGB to false-color ironbow infrared view showing human heat signatures and fire hotspots.
- **Offline Resilience**: Click **"Simulate Link Cut"** in Panel 7. The connection enters `OFFLINE`, and newly detected events buffer in the SQLite outbox. Click **"Restore Link"** to flush all buffered telemetry in order with zero lost events.
- **Frame-Accurate Replay**: Scrub past flight sessions using the Replay Bar with 1x, 2x, and 4x speeds.

---

## 6. Repository Structure

```text
AEROSAR/
├── aerosar_core/            # Pure-Python shared brain (zero ROS dependency)
│   ├── fusion.py            # Spatial clustering, deduplication, and sensor fusion
│   ├── geo.py               # WGS84 lat/lon <-> local ENU conversions & GPS noise
│   ├── perception.py        # Deterministic synthetic perception & YOLO degradation
│   ├── risk.py              # Master Document §11 exact rescue risk engine
│   ├── route.py             # 8-connected A* safe access path planner with obstacle inflation
│   └── vehicle.py           # Validated state machine & failsafe management
├── backend/                 # FastAPI standalone backend & simulation engine
│   ├── app/
│   │   ├── database.py      # SQLite WAL connection, outbox buffering & replay logging
│   │   ├── main.py          # 30 Hz simulation loop, WebSocket router & command handler
│   │   └── schemas.py       # Pydantic v1 protocol envelope schemas
│   └── tests/               # Backend database and risk scoring test suites
├── data/                    # Local SQLite database (aerosar.db) & mission bags
├── docs/                    # Technical architecture & specification documents
│   ├── AEROSAR_SIH_PS26177_Master_Document_final.md  # Official specification
│   ├── ATTRIBUTIONS.md      # CC0 asset licenses & library attributions
│   ├── DECISIONS.md         # Architectural decisions & conflict resolutions
│   ├── ENVIRONMENT_PLAN.md  # 3D WebGL environment architecture plan
│   ├── PROTOCOL.md          # WebSocket envelope & message schema specification
│   ├── WINDOWS_AUDIT.md     # Cross-platform migration audit table
│   └── screens/             # Playwright multi-viewport acceptance screenshots
├── frontend/                # React 18 + Vite + Three.js Command Center
│   ├── public/assets/       # Local CC0 HDRIs, PBR textures, and water normal maps
│   ├── src/
│   │   ├── components/      # 8 tactical panels, HUD overlay, and 3D simulator
│   │   │   ├── sim3d/       # Terrain, Water, Fire, Victims, PhotoMode, Thermal
│   │   │   ├── Simulator3DView.tsx    # Three.js viewport & camera controls
│   │   │   ├── TacticalHudOverlay.tsx # 2D screen projected HUD boxes & banner
│   │   │   ├── MapPanel.tsx           # Leaflet canvas map & A* route renderer
│   │   │   └── ...                    # Telemetry, Alert, Priority, Controls panels
│   │   └── lib/             # WebSocket reducer, audio chime, and state management
├── navigation/              # ROS 2 autonomous navigation nodes
├── perception/              # ROS 2 perception, YOLOv8, and sensor fusion nodes
├── launch/                  # ROS 2 XML/Python launch files
├── scripts/                 # Launchers and verification test suites
│   ├── start_aerosar.js     # Primary cross-platform launcher (Node.js)
│   ├── start_aerosar.ps1    # Thin PowerShell execution wrapper
│   ├── verify_headless.js   # Automated 4-assertion end-to-end headless suite
│   ├── verify_task1_task2.js# Playwright multi-viewport acceptance verification
│   └── benchmark_screens.js # Playwright 6-scenario x 4-preset FPS benchmark
├── src/                     # ROS 2 CMake and Python package workspaces
├── tests/                   # aerosar_core unit test suite
├── worlds/                  # Webots .wbt disaster arena world definitions
├── requirements.txt         # Root Python dependency manifest
├── package.json             # Root NPM scripts manifest
└── pytest.ini               # Pytest configuration
```

---

## 7. Testing & Verification

All subsystems are backed by automated verification scripts:

| Test Command | Description | What It Verifies |
| :--- | :--- | :--- |
| `npm test` | Python Test Suite (`pytest -v`) | 28 tests: Risk formula (§11.7 worked example), A* hazard avoidance, state machine transitions, geodetic math error $<0.01\text{ m}$, 11-lane coverage, 5.5s hover-verify lifecycle, and SQLite idempotency. |
| `npm run test:frontend` | Frontend Unit Tests (`npm --prefix frontend test`) | 12 tests: Telemetry normalisation, priority queue sorting, alert deduplication, stale connection detection, and mission record summaries. |
| `npm run verify` | Headless End-to-End Suite (`scripts/verify_headless.js`) | 4 assertions: 30 Hz telemetry pacing, victim_3 CRITICAL priority alert, zero event loss across link cut/restore, and monotonic replay frame storage. |
| `node scripts/start_aerosar.js --check` | Environment Preflight Check | Validates Node, Python, required libraries, and port availability without starting servers. |
| `node scripts/verify_task1_task2.js` | Browser Playwright Acceptance Suite | 20 checks: Canvas coverage $\ge 99\%$ across 1280x720, 1920x1080, and 390x844 viewports, double-fullscreen stability, HUD target projection, and flight mode switches. |
| `npm run build` | Frontend Production Build | TypeScript typechecking (`tsc -b`) and Vite production bundle optimization. |

---

## 8. Compliance & Offline-First Principles

- **Zero Network Dependence**: All PBR textures (mud, gravel, dirt), HDRIs (overcast daylight, dusk, night, smoke), normal maps, and Leaflet dark grid basemaps are bundled locally inside `frontend/public/assets/`. Zero external CDN calls are made at runtime.
- **Zero SVG / Zero Mermaid**: In compliance with strict operational dashboard rules, all tactical HUD elements, status indicators, and bounding boxes are rendered via pure DOM `div`s and HTML5 Canvas.
- **Licensing & Attributions**: All embedded 3D assets and HDRIs are CC0 or open permissive licenses. Complete provenance and URLs are documented in [`docs/ATTRIBUTIONS.md`](docs/ATTRIBUTIONS.md).

---

## 9. Team & Problem Statement

- **Event**: Smart India Hackathon (SIH) 2026
- **Problem Statement**: PS 26177 — AI-Enabled Autonomous Emergency Search and Rescue Drone
- **Repository**: [amannsaini0507-max/AEROSAR](https://github.com/amannsaini0507-max/AEROSAR)
- **Status**: Production-Ready Demo & Verification Passed.
