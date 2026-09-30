# AEROSAR — SIH 2026, PS 26177
### AI-Powered Autonomous Drone for Search & Rescue
**Master Technical & Execution Document**

Source of truth: official PS 26177 (Qualcomm Inc, Robotics & Drones theme). All scope below traces back to the 8 "Expected Solution" bullets in that document. The PS explicitly permits "some or all of the following" — this document marks what we commit to (MUST) vs. defer (NICE-TO-HAVE) explicitly, rather than silently dropping anything.

---

## SECTION 1 — Requirement-to-Feature Mapping

| # | OFFICIAL REQUIREMENT | → OUR FEATURE | → IMPLEMENTATION | → SIMULATION METHOD | → TEAM MEMBER | → DEMO EVIDENCE |
|---|---|---|---|---|---|---|
| 1 | **Autonomous Navigation** — GPS-enabled + GPS-denied, AI, SLAM, obstacle avoidance | Dual-mode flight controller (GPS waypoint mode + SLAM local mode) | ROS 2 Nav2-style stack; waypoint follower for GPS; lightweight SLAM (RTAB-Map class) for GPS-denied; costmap obstacle avoidance | Webots world with togglable GPS plugin; a "GPS-denied zone" (inside collapsed-building mesh) that cuts GPS signal in software | Member 3 (Navigation/SLAM) | Screen recording: GPS waypoint flight → enters zone → HUD "GPS LOST → SLAM ACTIVE" → continues navigating |
| 2 | **On-Device AI Inference** — real-time, no cloud dependence | Edge-deployed detection models, fully local | YOLO-family model, ONNX/TensorRT export, ROS 2 node on camera topics | Same inference node runs against Webots camera feed — identical code path to hardware | Member 2 (AI/CV) | Network disabled on-screen + detections still streaming to dashboard |
| 3 | **Multi-Sensor Fusion** — RGB + thermal + IMU + GPS | Fusion node: RGB detection + thermal confirmation + IMU/GPS geolocation | RGB candidate → thermal heat-check on same bbox region → combined confidence → IMU/GPS → geocoordinate | MVP: second Webots camera rendering a heat-mapped texture on "victim" models. Advanced: real thermal cam if procured | Member 2 (AI/CV) + Member 4 (Backend) | Split-screen RGB box + thermal overlay → pin drops at correct coordinate on map |
| 4 | **Hazard Classification** — flood, fire, smoke, debris, unstable structures, landslide zones (+ background text: electrical/chemical hazards treated as examples, not separate mandatory classes) | Parallel hazard-detection pipeline, multi-class | Model per class or single multi-class detector; each emits `HazardType`, confidence, bbox, location | Webots world objects tagged/textured as fire, smoke particles, flood plane, debris, tilted structures — deterministic labels usable pre-trained-model | Member 2 (AI/CV) | Hazard panel populates live as drone overflies each staged zone |
| 5 | **Geo-Tagged Mapping** — survivor locations, hazard zones, safe access routes | Live 2D map: occupancy grid + marker layer + route overlay | SLAM/GPS pose fused with detection geotags; A* over hazard-cost grid for safe route; served via WebSocket | 1:1 coordinate mapping from Webots world to dashboard grid | Member 4 (Mapping/Backend) | Map updates live in-flight: survivor pins, hazard zones, drawn route |
| 6 | **Emergency Alerting** — automatic alerts + prioritized rescue recommendations | Risk-scoring engine + alert dispatcher | Rule-based score (confidence, hazard proximity/severity) → LOW/MED/HIGH/CRITICAL → dashboard alert + log | Identical logic sim vs. real — consumes detection messages only | Member 4 (Backend) | CRITICAL alert fires with one-line explanation when survivor detected near fire |
| 7 | **Offline Resilience** — comms-constrained ops, optional Wi-Fi/5G | Local-first pipeline: on-drone detection/mapping/logging regardless of link; sync engine on reconnect | Local queue (SQLite) on-drone; background sync service; timestamp-based conflict resolution | Toggle ROS bridge/network off mid-demo, show local logging continue, re-enable | Member 4 (Backend) + Member 6 (Integration/Testing) | "OFFLINE — logging locally" → reconnect → "SYNCING… N events synced" |
| 8 | **Command Center Dashboard** — live feed, survivors, hazards, mission status | Web dashboard | FastAPI + WebSocket backend, React/simple web frontend | Dashboard agnostic to sim/real — consumes same topics either way | Member 5 (Dashboard/Frontend) | Continuous on-screen throughout demo |

**Explicit scope note:** Exposed electrical lines and chemical leaks appear only in the PS *background paragraph*, not the bulleted Expected Solution. We treat these as illustrative examples of "hazards," not separate mandatory detector classes, and state this assumption in our submission rather than silently omitting them.

---

## SECTION 2 — MVP Definition (3 Levels)

Each level is scoped to be **fully demoable end-to-end** — no level should leave you with disconnected pieces. Levels build strictly on top of each other; nothing in Level 2 breaks Level 1.

### LEVEL 1 — Minimum Working Prototype
*Goal: prove the core loop works, live, in front of anyone. This is your insurance policy — if nothing else ships, this still wins baseline credibility.*

| Capability | Maps to Requirement # | MUST / NICE |
|---|---|---|
| Webots world with a simple disaster-ish terrain (flat ground + a few obstacle blocks + 1-2 "victim" models) | — (scaffolding) | MUST |
| Drone spawns and flies a pre-set or simple waypoint path autonomously (no manual joystick control during demo) | 1 (GPS-enabled leg only) | MUST |
| RGB camera stream from drone into ROS 2 | 2, 3 | MUST |
| One working person-detector (even a basic YOLO pretrained on COCO "person" class — no custom training needed yet) | 2 | MUST |
| One deterministic hazard object (e.g., a red "fire" cube with a hardcoded label — no CV needed yet) | 4 | MUST |
| Detected survivor/hazard geotagged with drone's simulated GPS/pose at time of detection | 5 | MUST |
| A bare map (even a 2D scatter plot / simple grid) showing where detections occurred | 5 | MUST |
| One alert type: text/log line "SURVIVOR DETECTED at (x, y)" printed to a console or a minimal webpage | 6 | MUST |
| SLAM / GPS-denied nav | 1 | NOT in L1 — explicitly deferred |
| Thermal fusion | 3 | NOT in L1 — deterministic hazard stands in |
| Dashboard UI | 8 | NOT in L1 — console/log output is enough |
| Offline/sync | 7 | NOT in L1 |

**Definition of Done for L1:** A single unattended run — drone launches, flies its path, detects the person model and the hazard cube, prints a geotagged detection and an alert line, without anyone touching a keyboard mid-flight. If you can screen-record this today, you have a hackathon fallback no matter what else slips.

---

### LEVEL 2 — Strong SIH Prototype
*Goal: this is the version you actually submit if timeline is tight. Covers 6 of 8 official requirements convincingly.*

Adds on top of L1:

| Capability | Maps to Requirement # | MUST / NICE |
|---|---|---|
| Simulated thermal channel (second camera in Webots rendering heat-mapped "victim" textures) fused with RGB for confirmed detection | 3 | MUST |
| Autonomous **search** behavior (lawnmower/grid coverage pattern), not just a fixed path | 1 | MUST |
| Basic obstacle avoidance (reactive, e.g. costmap + simple local planner) around static obstacles | 1 | MUST |
| Multi-class hazard detection (fire, smoke, flood, debris — via deterministic tagged objects OR a lightly-trained/fine-tuned model, whichever is faster) | 4 | MUST |
| Risk scoring engine producing LOW/MEDIUM/HIGH/CRITICAL with a visible reason | 6 | MUST |
| Real web dashboard (live feed, map with pins, alert feed, mission status) replacing console output | 8 | MUST |
| Offline local storage: detections/logs written locally even if backend link is cut | 7 (storage half) | MUST |
| Synchronization on reconnect | 7 (sync half) | NICE — MUST if time allows, else demo-scripted as "future work" with storage still shown working |
| GPS-denied SLAM navigation | 1 (SLAM leg) | NOT in L2 — explicitly deferred to L3 |
| Safe-route planning (A*/Dijkstra over hazard costmap) | 5 (route leg) | NICE |

**Definition of Done for L2:** All 8 official requirement rows have *at least a working demoable instance* except full GPS-denied SLAM, which is explicitly flagged as a Level 3 stretch goal in your submission narrative — this is a legitimate, PS-permitted scope statement, not a gap you're hiding.

---

### LEVEL 3 — Winning / Advanced Prototype
*Goal: differentiation layer. Only attempt these once L2 is fully working and demo-stable — L3 features are what separate a good submission from a winning one, but a broken L3 demo is worse than a solid L2 demo.*

Adds on top of L2:

| Capability | Maps to Requirement # | MUST / NICE |
|---|---|---|
| Real GPS-denied navigation via SLAM (visual or LiDAR-based) with live GPS-loss simulation | 1 | NICE (this is the single highest-differentiation item — prioritize if only one L3 item is achievable) |
| Advanced sensor fusion (weighted confidence combining RGB+thermal+IMU+GPS rather than simple AND-logic) | 3 | NICE |
| Safe-route planning fully integrated into dashboard (route drawn live, recalculates if a new hazard appears) | 5 | NICE |
| Full offline→sync cycle with conflict handling and retry, demonstrated live by cutting/restoring network | 7 | NICE |
| Edge optimization (TensorRT/ONNX quantization, measured FPS improvement) | 2 | NICE |
| Mission replay (scrub back through a completed mission on the dashboard) | 8 | NICE |
| Multi-drone support | — (not in PS; only include if trivial — do not let this eat SLAM's time budget) | OPTIONAL, LOW PRIORITY |
| Basic analytics (detections over time, coverage %, response time stats) | 8 | NICE |

**Definition of Done for L3:** Each L3 item is additive and independently demoable — if SLAM works but mission replay doesn't get built, that's fine. Never let an L3 feature block or destabilize the L2 baseline; L2 must remain the fallback demo path at all times.

---

### Scope Discipline Rule (applies to all three levels)

For every feature marked difficult in later sections of this document, we will always specify three implementation tiers:
1. **Full implementation** — the "correct" engineering approach
2. **Simplified implementation** — reduced but real functionality
3. **Demo-only implementation** — deterministic/scripted, sufficient to convince judges live, clearly labeled internally as such so the team knows what's real vs. staged

This is not deception — SIH judges expect prototypes, not shipped products, and being explicit about MVP vs. production boundaries (Part 17 of your original brief) is itself a credibility signal.

---

---

## SECTION 3 — Part 1: System Architecture

### 3.1 Overall Architecture (narrative)

AEROSAR has three physical/logical layers that stay identical whether you're in Webots or on real hardware:

1. **Drone layer** — sensors, on-board compute, ROS 2 nodes for perception/navigation/fusion. This layer is *self-sufficient*: it can complete a full mission with zero connectivity.
2. **Link layer** — Wi-Fi/5G bridge (or Webots↔ROS 2 bridge in sim) carrying telemetry, detections, and video out; carrying commands in. This layer is *optional*, not load-bearing.
3. **Command-center layer** — backend (FastAPI/WebSocket), local database, and dashboard frontend. Consumes whatever the link layer delivers, including delayed/batched sync data.

The reason this three-layer split matters: it's what makes Requirement 7 (offline resilience) architecturally trivial rather than a bolt-on. The drone layer never *waits* on the command-center layer for anything safety- or mission-critical.

### 3.2 Hardware Architecture (sim-first, MVP-realistic)

```
                     ┌─────────────────────────────┐
                     │        DRONE PLATFORM        │
                     │                               │
  RGB Camera ────────┤                               │
  Thermal Cam(sim/real)─┤   Companion Computer          │
  IMU ────────────────┤   (Jetson Nano/Orin Nano OR   │
  GPS module ─────────┤    Raspberry Pi 4/5 for       │
  LiDAR (optional,L3)─┤    non-AI nodes)              │
                     │        │                       │
                     │        ▼                       │
                     │  Flight Controller (Pixhawk/    │
                     │  PX4 SITL in sim)               │
                     └─────────────┬─────────────────┘
                                   │  Wi-Fi/5G (optional)
                                   ▼
                     ┌─────────────────────────────┐
                     │      COMMAND CENTER (laptop) │
                     │  Backend + DB + Dashboard     │
                     └─────────────────────────────┘
```

In simulation, "Companion Computer" and "Flight Controller" are both just processes on your dev laptop talking to Webots via its ROS 2 API / controller plugin — no separate physical boxes needed until you port to hardware.

### 3.3 Software Architecture (layered)

```
┌───────────────────────────────────────────────────────────┐
│  APPLICATION LAYER: Rescue Priority · Safe Route · Alerts   │
├───────────────────────────────────────────────────────────┤
│  PERCEPTION LAYER: Person Detection · Hazard Detection ·     │
│                     Sensor Fusion                            │
├───────────────────────────────────────────────────────────┤
│  NAVIGATION LAYER: GPS Waypoints · SLAM · Obstacle Avoidance │
├───────────────────────────────────────────────────────────┤
│  MIDDLEWARE LAYER: ROS 2 (DDS) — topics/services/actions     │
├───────────────────────────────────────────────────────────┤
│  DRIVER/SIM LAYER: Webots sensor/actuator plugins            │
│                     (later: real sensor drivers, MAVLink)    │
└───────────────────────────────────────────────────────────┘
```

Every layer above the driver/sim layer is **hardware-agnostic** — this is the whole point of the ROS 2 + simulation-first approach: swapping Webots for real hardware only touches the bottom layer.

### 3.4 AI Architecture

```
Camera topics ──▶ Preprocess (resize/normalize) ──▶ Inference (ONNX/TensorRT)
                                                          │
                        ┌─────────────────────────────────┤
                        ▼                                 ▼
                Person Detector                   Hazard Detector(s)
                (YOLO, class="person")             (fire/smoke/flood/debris/
                        │                            damaged-structure)
                        ▼                                 ▼
                  Confidence filter                Confidence filter
                        │                                 │
                        └───────────────┬─────────────────┘
                                        ▼
                              Fusion Node (+ thermal, IMU, GPS)
                                        ▼
                              Confirmed Detection message
```

### 3.5 ROS 2 Architecture (high-level — full topic list in Section on Part 7)

```
[sensor nodes] → [perception nodes] → [fusion node] → [risk/priority node] → [alert node]
       │                                                      │
       └──────────────► [navigation nodes] ◄──────────────────┘
                              │
                              ▼
                        [map/mission node] → (bridge) → [backend/dashboard]
```

### 3.6 Communication Architecture

```
DRONE (offline-capable)                    LINK                COMMAND CENTER
┌─────────────────┐        Wi-Fi/5G (optional, best-effort)   ┌──────────────┐
│ ROS 2 nodes      │ ───────────────────────────────────────▶ │ ROSbridge/WS  │
│ Local SQLite log │ ◀─────────────────────────────────────── │ FastAPI       │
└─────────────────┘        (commands / ack, non-blocking)     │ Database      │
                                                                │ Dashboard UI  │
                                                                └──────────────┘
```

If the link drops: drone nodes keep running, local log keeps appending, dashboard shows "OFFLINE — last seen Txx:xx." Nothing on the drone side blocks or errors.

### 3.7 Simulation Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Webots World (.wbt): terrain, victim models, hazard        │
│  objects, drone (Mavic-class or custom), obstacles           │
├───────────────────────────────────────────────────────────┤
│  Webots Controller / ros2_webots bridge                     │
│    → publishes: /camera/image_raw, /thermal/image_raw,       │
│      /imu/data, /gps/fix, (/lidar/points if L3)              │
│    → subscribes: /navigation/cmd_vel                         │
├───────────────────────────────────────────────────────────┤
│  Rest of the ROS 2 graph (perception/nav/fusion/etc.)        │
│  runs UNCHANGED whether source is Webots or real hardware    │
└───────────────────────────────────────────────────────────┘
```

### 3.8 Command-Center Architecture

```
Dashboard (React/simple web) ──WebSocket──▶ FastAPI backend ──▶ SQLite/Postgres
        ▲                                        │
        └────────────── REST (history/replay) ───┘
```

### 3.9 End-to-End Data Flow (single detection, from sensor to dashboard pin)

```
Camera frame ─▶ Person Detector ─▶ [candidate] ─▶ Thermal check ─▶ [confirmed]
     │                                                                 │
     ▼                                                                 ▼
IMU + GPS pose at capture time ───────────────────────────▶ Geotag computed
                                                                        │
                                                                        ▼
                                                        Risk score assigned
                                                                        │
                                                                        ▼
                                              Local log write (always happens)
                                                                        │
                                                          (if link available)
                                                                        ▼
                                                     Sent to backend → DB write
                                                                        │
                                                                        ▼
                                                    Dashboard pin + alert appear
```

---

### 3.10 Subsystem Diagrams A–P

**A. Complete System**
```
[Disaster Site] → [AEROSAR Drone] ⇄ [Link] ⇄ [Command Center] → [Rescue Team decisions]
```

**B. Drone Architecture**
```
Sensors → Companion Computer (Perception+Fusion+Nav) → Flight Controller → Motors
                                    │
                              Local Storage
```

**C. Sensor Pipeline**
```
RGB Cam ─┐
Thermal ─┼─▶ Sync/Timestamp ─▶ ROS 2 topics ─▶ Perception nodes
IMU ─────┤
GPS ─────┘
```

**D. AI Inference Pipeline**
```
Frame in → Preprocess → Model (ONNX/TensorRT) → Postprocess (NMS, thresholds) → Detection msg out
```

**E. Navigation Pipeline**
```
Mission plan → Mode select (GPS/SLAM) → Local planner → Obstacle check → cmd_vel → Flight controller
```

**F. SLAM / GPS-Denied Navigation**
```
GPS valid? ──No──▶ Camera/LiDAR ─▶ SLAM (pose+local map) ─▶ Local planner
     │Yes
     ▼
GPS pose ─▶ Waypoint planner
```

**G. Survivor Detection**
```
RGB frame → Person detector → bbox+confidence → (pass to Fusion, diagram I)
```

**H. Hazard Detection**
```
RGB frame → Multi-class hazard detector → {fire|smoke|flood|debris|structure} + confidence
```

**I. Sensor Fusion**
```
Person bbox ─┐
Thermal bbox ─┼─▶ Overlap+confidence combine ─▶ Confirmed survivor
IMU/GPS pose ─┘                                        │
                                                         ▼
                                                   Geotagged detection
```

**J. Risk Assessment**
```
Detection(s) + Hazard proximity + Confidence + Accessibility → Weighted score → LOW/MED/HIGH/CRITICAL
```

**K. Rescue-Priority Engine**
```
All active detections → Sort by risk score → Ranked survivor queue → Dashboard priority list
```

**L. Safe-Route Generation**
```
Rescue-team pos + Survivor pos + Hazard costmap → A* search → Lowest-risk path → Map overlay
```

**M. Emergency Alerting**
```
New CRITICAL/HIGH detection → Alert generator → {Dashboard push, Local log} → Rescue team notified
```

**N. Offline Mode**
```
Link down → Drone continues full pipeline → Local SQLite queue grows
Link up → Sync engine drains queue → Backend dedupes/timestamps → DB updated → Dashboard refreshes
```

**O. Dashboard**
```
WebSocket feed → {Video panel, Map panel, Alert panel, Status panel} → Judge/operator view
```

**P. End-to-End Mission**
```
Launch → Autonomous search → Detect survivor → Thermal confirm → Hazard nearby detected →
Risk=CRITICAL → Alert fired → Map pin + route drawn → (optional) link cut → offline continues →
link restored → sync → mission complete → dashboard shows final situational picture
```

---

---

## SECTION 4 — Part 2: Technology Stack

**Recommended stack at a glance** (justification for each item follows below):

```
Simulation:   Webots (primary)
Robotics:     ROS 2 (Humble/Jazzy) + MAVLink bridge (for realism, not required for MVP)
AI:           YOLOv8 (or YOLO11) → ONNX → (TensorRT only if/when on real Jetson)
Mapping:      Simple 2D occupancy grid + RTAB-Map (only if L3 SLAM attempted)
Backend:      Python + FastAPI + WebSockets + SQLite (Postgres only if scaling matters)
Frontend:     React (Vite) + Leaflet for map + simple video panel
Hardware(if/when physical): Raspberry Pi 5 (non-AI) or Jetson Orin Nano (AI) + Pixhawk 6C + Pi Camera + FLIR Lepton (thermal) + Neo-M8N GPS + generic IMU
```

Below, every technology is scored against the same 5 questions the brief requires: **why / what / MVP-required / simulatable / alternative**.

### 4.1 Simulation

| Tech | Why we need it | What it does | MVP-required? | Simulatable? | Recommended alternative |
|---|---|---|---|---|---|
| **Webots** | Free, open-source, has a real ROS 2 interface out of the box, easy drone/quadrotor models, good sensor plugin support (camera, IMU, GPS, LiDAR) — lowest setup friction for a 6-person student team on a deadline | Full 3D physics simulator: world building, sensor simulation, robot controllers | **YES** — this is your entire development and demo environment | N/A (it is the simulator) | Gazebo (more powerful but steeper learning curve, worse out-of-box drone support); AirSim (excellent drone realism but Unreal-based — heavy, harder to set up, less active maintenance recently) |
| Gazebo | Considered as alternative — more accurate physics, larger ROS 2 community | Physics sim + sensor plugins | NO | — | Use only if a team member already has strong Gazebo experience; otherwise Webots wins on time-to-first-demo |
| AirSim | Considered — best-in-class drone flight dynamics and photorealism | Unreal-Engine-based drone/car simulator | NO | — | Reserve as a "nice to reference" for L3 stretch if someone wants dramatically better visuals for the demo video, not for core development |

**Decision: Webots.** It directly supports your requirement to be "completely simulated using Webots and/or another suitable simulator" and has the shortest path from zero to a flying, sensing drone in ROS 2.

### 4.2 Robotics Middleware / Flight Stack

| Tech | Why | What it does | MVP-required? | Simulatable? | Alternative |
|---|---|---|---|---|---|
| **ROS 2** (Humble or Jazzy) | Industry-standard robotics middleware; pub/sub topics map perfectly onto your sensor→perception→nav→dashboard pipeline; huge tooling/debugging ecosystem (rqt, ros2 bag, rviz2) | Message-passing middleware: nodes, topics, services, actions | **YES** | Yes — Webots has native ROS 2 bridge support | None realistic — this is the correct choice |
| MAVLink / PX4 SITL | Gives you a "real" flight-controller abstraction (arm, takeoff, waypoint, RTL commands) instead of hand-rolling motor control, and is the same protocol real Pixhawk hardware speaks | Communication protocol between companion computer and flight controller | NICE — improves realism and eases hardware port later | Yes, PX4 has a SITL (software-in-the-loop) mode | For MVP, a simplified direct `cmd_vel`-style controller in Webots is acceptable and saves setup time; add MAVLink once L1/L2 core loop is proven |

### 4.3 AI / Perception

| Tech | Why | What it does | MVP-required? | Simulatable? | Alternative |
|---|---|---|---|---|---|
| **YOLOv8/YOLO11** (Ultralytics) | Best effort-to-accuracy ratio for a student team; pretrained COCO weights already detect "person" out of the box — zero training needed for Level 1; easy to fine-tune later for hazard classes | Real-time object detection: bounding boxes + class + confidence | **YES** (person detection) | Yes — runs on Webots camera frames identically to real frames | Faster R-CNN (too slow for real-time), MobileNet-SSD (lighter but noticeably less accurate — only consider if edge hardware is very constrained) |
| OpenCV | Needed for preprocessing, drawing overlays, basic image ops, and as a fallback for deterministic "detection" (e.g. color-thresholding a red fire-cube) before a trained model exists | Computer vision utility library | **YES** | Yes | None — effectively mandatory glue library |
| PyTorch | Training/fine-tuning framework underlying YOLO | Deep learning framework | Only if you fine-tune custom hazard classes | Yes (training happens offline on a dev machine, not in Webots) | TensorFlow (viable but Ultralytics' ecosystem is PyTorch-native — switching adds friction for no benefit) |
| ONNX | Portable model format — export once, run anywhere (dev laptop now, Jetson later) without re-writing inference code | Model interchange/runtime format | **YES** — this is what makes "simulate now, deploy later" actually true | Yes | Skip only if you truly never plan to touch real hardware — not recommended even then, it's free insurance |
| TensorRT | NVIDIA-specific inference optimizer — real speed/latency wins on Jetson hardware | Model optimization/runtime for NVIDIA edge devices | **NO for MVP** — only matters once you have real Jetson hardware | N/A (hardware-specific) | Plain ONNX Runtime is sufficient for all sim work and even acceptable on real hardware if latency targets are met without it |
| Edge AI (general) | The PS explicitly requires on-device inference — you must demonstrate this isn't cloud-dependent | Running inference locally rather than via a cloud API | **YES** (architecturally — see Requirement 2) | Yes — "on-device" in sim just means the inference node runs on your dev machine, not calling any external API | — |

### 4.4 Mapping / Localization

| Tech | Why | What it does | MVP-required? | Simulatable? | Alternative |
|---|---|---|---|---|---|
| Basic occupancy grid / scatter map | Needed for Requirement 5 (live disaster map) at minimum | Plots detections + drone path on a 2D grid | **YES** (Level 1+) | Trivial in sim — you already have ground-truth pose | — |
| **RTAB-Map** | If attempting real SLAM (Level 3), this is the most student-friendly, well-documented ROS 2 SLAM package with both visual and LiDAR modes | Simultaneous Localization and Mapping | NO for L1/L2 — **NICE for L3** | Yes, works with simulated camera/LiDAR in Webots | ORB-SLAM3 (more accurate, notably harder to build/integrate — higher risk for a deadline); Cartographer (LiDAR-focused, good but heavier dependency footprint) |
| LiDAR (sim) | Improves SLAM quality/reliability over vision-only | Point-cloud depth sensing | NO for L1/L2 — optional for L3 SLAM | Yes, Webots has a LiDAR sensor node | Depth camera (RGB-D) is a lighter-weight substitute if going vision-only |
| GPS (sim) | Required for GPS-enabled navigation mode | Absolute positioning | **YES** | Yes, Webots GPS node | — |

### 4.5 Backend

| Tech | Why | What it does | MVP-required? | Simulatable? | Alternative |
|---|---|---|---|---|---|
| **Python** | Team likely already knows it; matches ROS 2's Python client library (`rclpy`); same language across AI, backend, and ROS nodes reduces context-switching for a small team | General-purpose language | **YES** | — | — |
| **FastAPI** | Async-native (good fit for WebSocket streaming), auto-generates docs, minimal boilerplate — fast to build with under deadline pressure | Web API framework | **YES** | — | Flask (simpler but weaker async/WebSocket story) |
| **WebSockets** | Dashboard needs live push updates (video, pins, alerts) — polling REST would be laggy and look bad in a live demo | Bi-directional real-time communication | **YES** | — | Server-Sent Events (simpler, one-directional only — fine if dashboard never sends commands back) |
| SQLite | Zero-setup embedded database — perfect for both the on-drone local queue (Requirement 7) and the command-center store at prototype scale | Local relational database | **YES** | — | Postgres — only worth the setup overhead if you specifically want to demo "production-readiness" to judges; not necessary for scope |

### 4.6 Frontend / Dashboard

| Tech | Why | What it does | MVP-required? | Simulatable? | Alternative |
|---|---|---|---|---|---|
| **React (Vite)** | Fast dev loop, component model fits a dashboard with many independent live-updating panels (video/map/alerts/status) | Frontend UI framework | **YES** | — | Plain HTML/JS (viable for Level 1 console-style output; upgrade to React by Level 2) |
| **Leaflet** | Free, lightweight, well-documented map library; easy custom marker/overlay support for survivors/hazards/routes | Interactive map rendering | **YES** (once past L1) | — | Mapbox GL (nicer visuals, but requires an API key/account — unnecessary dependency for a prototype); raw `rviz2`-style 2D canvas (acceptable stopgap for Level 1) |

### 4.7 Hardware (only relevant once/if you port off simulation — avoid buying anything until L2 is proven in sim)

| Tech | Why | What it does | MVP-required? | Simulatable first? | Recommended alternative |
|---|---|---|---|---|---|
| Raspberry Pi 4/5 | Cheap, well-supported, fine for non-AI ROS 2 nodes (fusion, mapping, backend relay) | General companion computer | NO for MVP | Yes | — |
| NVIDIA Jetson Nano / Orin Nano | Needed only if you want real on-device GPU-accelerated inference on physical hardware | AI-capable edge computer | NO for MVP | Yes — sim doesn't need it at all | Skip entirely until/unless your team reaches physical hardware integration; even then, prefer the cheapest Jetson SKU that meets your FPS target rather than the most powerful one |
| Qualcomm edge hardware (e.g. RB5/Dragonwing-class boards) | PS is a Qualcomm problem statement — mentioning a Qualcomm edge kit as your "real deployment target" strengthens problem-statement alignment for judges, even if you never actually acquire one | Qualcomm-based edge AI compute | **NO** — mention as future deployment target only, do not attempt to source/integrate under hackathon time pressure unless the kit is already provided | N/A | State in your submission: "designed for on-device inference on Qualcomm edge silicon; validated on [Jetson/dev laptop] equivalent compute in prototype phase" |
| Flight controller (Pixhawk-class) | Only needed for real hardware; Webots PX4 SITL is the sim equivalent | Low-level flight stabilization/control | NO for MVP | Yes (PX4 SITL) | — |
| RGB camera | Any USB/Pi camera works for real hardware | Visual sensing | NO for MVP | Yes (Webots camera node) | — |
| Thermal camera (e.g. FLIR Lepton breakout) | Needed only for real hardware version of Requirement 3 | Heat-signature sensing | NO for MVP — **do not buy until L2 sim fusion logic is proven** | Yes — simulate via heat-mapped texture (see Section 1, Req. 3) | — |
| LiDAR (e.g. RPLidar A1) | Only relevant if attempting real SLAM on hardware | Point-cloud ranging | NO for MVP | Yes (Webots LiDAR node) | Depth camera cheaper alternative if pursuing real hardware later |
| IMU / GPS module | Needed for real hardware pose estimation | Orientation / absolute position sensing | NO for MVP | Yes (Webots IMU/GPS nodes) | — |

**Hardware philosophy, stated plainly:** don't buy anything until the corresponding simulated version is working end-to-end. Every sensor above has a Webots equivalent that produces the *same ROS 2 message type* a real sensor would — so hardware becomes a drop-in replacement, not a redesign, if/when your team decides to attempt it (and it remains entirely optional per the PS, which only requires a deployable/demonstrable solution, not necessarily flown hardware).

---

---

## SECTION 5 — Part 4: Complete Development Roadmap (14-Day Reality Check)

**Read this before the phase table.** With 6 people and 14 days, phases cannot run sequentially the way the brief's Phase 0→22 numbering implies — that structure assumes a multi-week or multi-month timeline. What we do instead: **compress to 3 stages, run almost everything in parallel from Day 1 across members, and treat Level 3 as opportunistic only.**

**Target commitment: Level 2 fully working by Day 12, Days 13–14 reserved for integration hardening + demo rehearsal — not new features.** Any Level 3 item is a bonus attempted only by a member who finishes their Level 2 work early, and only if it doesn't touch shared interfaces (topics/message formats) that other members depend on.

### 5.1 The 14-Day Structure

```
DAYS 1–2   STAGE 0: Setup — environment, repo, world, skeleton ROS graph, wireframes
DAYS 3–6   STAGE 1: Level 1 — every member gets their piece minimally working solo
DAYS 7–11  STAGE 2: Level 2 — fusion, search behavior, dashboard, risk engine, offline
DAYS 12    STAGE 3: Full integration — all 6 members' pieces wired together, on one machine/repo
DAYS 13–14 STAGE 4: Testing, bug-fixing, demo script rehearsal, backup recording
```

If Level 2 integration on Day 12 reveals big gaps, Days 13–14 absorb that — **do not let feature work bleed into these two days.** A rehearsed, stable Level 2 demo beats a half-working Level 3 demo every time in front of judges.

### 5.2 Phase Table (compressed — mapped to the original 22 phases, but grouped by stage)

| Original Phase(s) | Stage | Objective | Key Tasks | Tools | Owner(s) | Duration | Definition of Done | Common Failure Point | Testing Method |
|---|---|---|---|---|---|---|---|---|---|
| 0 — Requirements & Architecture | Day 1 (all) | Everyone aligned on scope before writing code | Read this document as a team; confirm Level 2 as the committed target; assign the 6 roles | This doc, a shared doc/Notion | All 6 | 0.5 day | Every member can state their role's ROS topics in/out from memory | Skipping this and starting to code immediately → integration chaos later | Verbal walkthrough, each member explains their interface |
| 1 — Dev Environment | Day 1 (all) | Everyone has a working ROS 2 + Webots install | Install ROS 2, Webots, create shared Git repo with branch structure (see Part 18 later) | ROS 2, Webots, Git/GitHub | All 6 | 0.5–1 day | `ros2 topic list` and Webots both run on every laptop | Version mismatches across laptops (different ROS 2 distros) | Everyone runs a "hello world" publisher/subscriber and confirms |
| 2 — Webots Disaster Environment | Days 1–3 | A world exists to fly/test in | Flat terrain + obstacle blocks + 2–3 victim models + hazard objects (fire cube, smoke particle, flood plane, debris pile) | Webots world editor | Member 1 (+ Member 6 support) | 2 days | World loads, drone spawns, all objects visible and correctly tagged/named for later detection | Over-designing the world (photorealism) instead of functional tagging | Manual visual check + object names verified in Webots scene tree |
| 3 — Drone Simulation | Days 2–4 | Drone flies autonomously on a fixed path | Spawn drone model, basic waypoint controller, `cmd_vel`-style movement | Webots, ROS 2 | Member 1 | 2 days | Drone completes a pre-set path unattended | PID/control tuning eating time — use Webots' built-in stabilization if available rather than hand-tuning | Run 5x, confirm consistent completion |
| 4 — Sensor Simulation | Days 2–4 (parallel w/ Phase 3) | Drone publishes camera/IMU/GPS/thermal(sim) data | Attach camera, thermal-proxy camera, IMU, GPS nodes to drone in Webots | Webots sensor plugins | Member 1 (+ Member 2 for camera specifics) | 2 days | `ros2 topic echo` shows live data on all 4 topics | Thermal "camera" not actually needed as separate node initially — can be same camera with different post-processing until later | Topic hz check (`ros2 topic hz`) |
| 5 — ROS 2 Integration | Days 3–5 | All sensor/nav topics wired correctly | Confirm topic names/types match the spec in Part 7 (later section) before anyone builds against them | ROS 2 | Member 1 (owns), all consume | 1–2 days (parallel) | `rqt_graph` shows expected node/topic graph | Topic name drift between members (e.g. `/camera/image_raw` vs `/rgb/image`) — lock names on Day 1 | `rqt_graph` visual diff against spec |
| 6, 7, 8 — AI Perception, Survivor Detection, Hazard Detection | Days 3–7 | Working person + hazard detection | Pretrained YOLO for person (zero training needed); deterministic color/tag-based detection for hazards initially, upgrade to trained model only if time allows | YOLOv8 (Ultralytics), OpenCV | Member 2 | 4–5 days | Both detectors publish correctly-typed messages on live Webots camera feed | Trying to train a custom hazard model from scratch first — start deterministic, only add training if Days 8+ have slack | Run against recorded rosbag of a flight; check detection accuracy manually |
| 9 — Sensor Fusion | Days 6–8 | RGB+thermal+pose → confirmed geotagged detection | Fusion node combining detection outputs + pose | ROS 2, Python | Member 2 (+ Member 4 for geotag/storage) | 2 days | A detected person produces one correctly-geotagged message, not duplicates | Double-counting the same person across frames — needs simple deduplication (distance threshold) | Fly past known victim model, confirm single geotagged output within expected coordinate tolerance |
| 10, 11 — Autonomous Navigation, GPS Navigation | Days 4–8 | Search-pattern flight + waypoint mode | Lawnmower/grid coverage pattern; basic reactive obstacle avoidance | ROS 2, Webots | Member 3 | 4–5 days | Drone covers a defined area without manual input, avoids static obstacles | Full coverage-path-planning algorithms are overkill — a fixed serpentine pattern is sufficient and much faster to build | Visual + logged path coverage percentage |
| 12 — GPS-Denied / SLAM | Days 9–12 (**stretch only**) | GPS-loss triggers SLAM fallback | Only attempted if Member 3 finishes Phase 10/11 by Day 8 | RTAB-Map or simplified visual odometry | Member 3 | Remaining time only | Drone continues moving (even crudely) after simulated GPS loss | This is the single most likely thing to be cut — budget for that reality | Toggle GPS off mid-flight, observe behavior |
| 13 — Mapping | Days 5–9 | Live map with detection pins | 2D grid/scatter map fed by geotagged detections | Backend + Leaflet | Member 4 | 3–4 days | Map updates in near-real-time as detections occur | Coordinate frame mismatches (drone-local vs. world/lat-long) — agree on one frame early | Fly known path, verify pin positions match expected locations |
| 14 — Risk Assessment | Days 7–9 | Score every detection | Implement the scoring formula (Part 11, later section) | Python/backend | Member 4 | 1–2 days | Every detection gets a LOW/MED/HIGH/CRITICAL label with a visible reason string | Overcomplicating weights before the simple version even works — start with 2–3 factors, add more only if time allows | Unit test with known inputs → known score outputs |
| 15 — Rescue Priority | Days 8–9 (parallel w/14) | Ranked survivor list | Sort active detections by score | Python/backend | Member 4 | 0.5–1 day | Dashboard priority list re-sorts live as new detections arrive | — | Manual multi-survivor test scenario |
| 16 — Safe Route Planning | Days 9–11 (**nice-to-have**) | Route from rescue team to survivor avoiding hazards | A* over hazard-cost grid | Python (networkx or custom) | Member 4 (+ Member 3 if free) | 1–2 days | Route line renders on dashboard, visibly avoids hazard zones | Second thing likely to be cut if time is short — keep isolated so cutting it doesn't break anything else | Visual check: route bends around a placed hazard |
| 17 — Backend | Days 4–8 | API + WebSocket + DB serving everything above | FastAPI app, WebSocket broadcast, SQLite schema | FastAPI, SQLite | Member 4 | 4–5 days | Dashboard receives live pushes for detections/alerts/status | Building REST-only first and bolting on WebSocket later — build WebSocket-first, it's the actual demo requirement | Connect a WebSocket test client, confirm live messages |
| 18 — Dashboard | Days 4–10 | Full command-center UI | Video panel, map (Leaflet), alert feed, mission status, priority list | React (Vite) | Member 5 | 6–7 days | All 8 dashboard elements from Requirement 8 visible and live-updating | Polishing visuals before functionality works — get all panels wired to real data first, style last | Live demo dry-run against real backend |
| 19 — Offline Mode | Days 9–11 | Local logging + sync | SQLite queue on "drone side," sync service on reconnect | SQLite, Python | Member 4 (+ Member 6 for the demo-toggle mechanism) | 2–3 days | Cutting the link mid-mission doesn't stop detection/logging; reconnecting triggers visible sync | Sync logic getting complex (conflict resolution) — for 2 weeks, timestamp-order "last write wins" is entirely acceptable | Manually kill/restore the WebSocket connection during a run |
| 20 — Full Integration | Day 12 | Everything running together | All 6 members' nodes running simultaneously against one Webots instance | Everything | All 6 | 1 day (all hands) | A single `ros2 launch` (or documented multi-terminal sequence) brings up the entire system | This is where hidden interface mismatches surface — this is *why* Phase 5's topic-name lock-in on Day 1 matters so much | Full unattended mission run, 3x in a row without manual intervention |
| 21 — Testing | Days 13 | Stabilize, fix integration bugs | Run the 5 demo scenarios (Part 15, later section) repeatedly | — | All 6 | 1 day | Demo scenarios succeed reliably (aim for 4/5 clean runs minimum) | Chasing edge-case bugs that won't appear in the actual demo path — prioritize the exact demo script's reliability over general robustness | Scripted scenario runs with a checklist |
| 22 — Demo & Presentation | Day 14 | Polished, rehearsed demo | Record backup video, rehearse narration (Part 20, later section), prep slides | OBS/screen recorder, slides | All 6 (Member 6 leads) | 1 day | Backup video exists in case live demo fails; every member can narrate their part | No backup recording → single point of failure on demo day | Full run-through timed to 5–7 minutes |

### 5.3 Non-Negotiable Rule for a 14-Day Timeline

**Lock all ROS 2 topic names, message types, and the WebSocket message schema by end of Day 2**, even if the nodes behind them are still stubs. This is the single highest-leverage thing you can do — every other phase from Day 3 onward can proceed in parallel *only if* members can build against an agreed interface without waiting on each other's implementation to exist. The exact topic/message spec is coming in the ROS 2 Architecture section — get that locked first, code second.

---

---

## SECTION 6 — Part 5 & 6: Six-Member Division + Individual Roadmaps

Roles assigned purely by **workload balance** against the 14-day plan in Section 5 — total effort-days are kept roughly even across all six, even though the *type* of work differs a lot. Where Section 5 named an owner, that assignment is preserved here.

### 6.0 Workload Balance Check (sanity check before the details)

| Member | Primary Stage(s) Owned | Approx. effort-days (of 14) |
|---|---|---|
| 1 — Drone Sim & ROS 2 | World + drone + sensors + topic spec | ~9 |
| 2 — AI / Computer Vision | Person + hazard detection + fusion (with M4) | ~10 |
| 3 — Navigation / SLAM | Search pattern + obstacle avoidance + (stretch) SLAM | ~9 |
| 4 — Mapping / Backend / Data | Backend, DB, risk engine, priority, route, offline, geotag | ~11 (heaviest — split sub-tasks with M6 if it slips) |
| 5 — Dashboard / Frontend | All 8 dashboard panels | ~9 |
| 6 — Integration / Hardware / Testing | Supports everyone Days 1–11, owns Days 12–14 fully | ~9 (front-loaded lighter, back-loaded heavy) |

If Member 4 falls behind (most likely bottleneck given the load), Member 6 should shift from support work to directly picking up offline-mode or route-planning by Day 9 — flagged now so it isn't a surprise mid-sprint.

---

### 6.1 MEMBER 1 — Drone Simulation & ROS 2

**Responsibilities:** Own the Webots world, the drone model, all sensor topics, and the canonical ROS 2 topic/message spec everyone else builds against.

**Technologies to learn:** Webots world-building basics, Webots ROS 2 controller API, ROS 2 pub/sub fundamentals (`rclpy`).

**Day-by-day:**
- **Day 1:** Install Webots + ROS 2. Create repo skeleton, `feature/webots` branch. Draft topic/message spec (names, types, hz) in a shared doc.
- **Day 2:** Build base world: terrain, boundary. Spawn a drone model. Get topic spec reviewed and locked by all 6 members by end of day.
- **Day 3:** Add camera, IMU, GPS sensor nodes to drone. Confirm `ros2 topic echo` on all of them.
- **Day 4:** Add thermal-proxy camera (second camera view). Add hazard/victim placeholder objects to world (hand off styling to whoever has time). Basic fixed-path controller working.
- **Day 5:** Support Member 3 wiring `cmd_vel` into the drone controller. Fix any topic-mismatch bugs surfacing from other members' early integration attempts.
- **Day 6:** Buffer/bugfix day. Confirm `rqt_graph` matches the locked spec exactly.
- **Days 7–11:** Shift to support role — helping Member 3 (nav) and Member 6 (integration) as needed; own any Webots-world changes required (new hazard placements, obstacle tuning).
- **Day 12:** Full integration — ensure world/drone/sensors launch cleanly as part of the single combined launch.
- **Days 13–14:** Testing support, demo rehearsal — likely the person who operates Webots live during the demo.

**Week-by-week:** Week 1 = world + drone + sensors + locked spec (this is the critical path everyone else waits on). Week 2 = support role + integration + demo.

**Dependencies on others:** None incoming in Week 1 (this is why Member 1 starts first). Everyone else depends on Member 1's Day 2 topic-lock.

**Deliverables:** Working Webots world file, drone controller, all sensor topics live, topic/message spec doc.

**Git branch/modules owned:** `feature/webots`, `/worlds/`, `/drone_description/`

**Topics exposed:** `/camera/image_raw`, `/thermal/image_raw`, `/imu/data`, `/gps/fix`, (`/lidar/points` only if L3 attempted)

**Definition of Done:** All sensor topics publish at expected rate; drone completes a manual test flight in the world; spec doc is the single source of truth and hasn't changed since Day 2 without team sign-off.

**Testing checklist:** `ros2 topic hz` on each sensor topic; visual check of world in Webots; 5x repeat of fixed-path flight.

**Demo responsibilities:** Operates/monitors Webots during the live run.

**Backup responsibilities:** Can step into Member 3's nav debugging if nav slips (shares ROS 2 context).

**Skills required:** Comfort with 3D coordinate systems, patience for simulator quirks, ROS 2 basics.

**Learning resources:** Webots official ROS 2 tutorial, `rclpy` publisher/subscriber tutorial from ROS 2 docs.

---

### 6.2 MEMBER 2 — AI / Computer Vision

**Responsibilities:** Person detection, hazard detection, and (jointly with Member 4) the sensor fusion node.

**Technologies to learn:** YOLOv8 (Ultralytics) inference API, OpenCV basics, ONNX export.

**Day-by-day:**
- **Day 1:** Install Ultralytics/YOLO, OpenCV. Pull pretrained COCO weights, confirm "person" class detects on sample images.
- **Day 2:** Write ROS 2 node skeleton that will subscribe to `/camera/image_raw` (per Member 1's spec) — stub with test images until real topic is live.
- **Day 3:** Wire node to real `/camera/image_raw`. Get first live person detections on Webots feed.
- **Day 4:** Build deterministic hazard detector (color/tag-based on the placeholder hazard objects Member 1 added). Publish `/perception/hazard`.
- **Day 5:** Publish `/perception/person` in final message format. Confidence thresholding + basic NMS cleanup.
- **Day 6:** Begin thermal-confirmation logic — check heat-mapped texture region overlapping RGB bbox.
- **Day 7:** Fusion node v1: RGB + thermal → confirmed detection message. Coordinate with Member 4 on geotag handoff format.
- **Day 8:** Deduplication logic (avoid re-reporting same survivor across consecutive frames).
- **Day 9:** If ahead of schedule: attempt fine-tuning hazard classes beyond deterministic detection. If behind: polish/stabilize what exists — do not start new model training this late.
- **Day 10:** Bugfix, accuracy tuning against recorded test flights.
- **Day 11:** Freeze AI pipeline — no further model changes after this point except critical bug fixes.
- **Day 12:** Integration support.
- **Days 13–14:** Testing support, demo narration prep for the AI portion.

**Week-by-week:** Week 1 = person detection + hazard detection working solo. Week 2 = fusion + polish + freeze.

**Dependencies on others:** Needs Member 1's camera/thermal topics live by Day 3. Fusion needs Member 1's IMU/GPS topics and Member 4's geotag format agreed by Day 7.

**Deliverables:** `/perception/person`, `/perception/hazard`, `/perception/detection` (fused output) nodes.

**Git branch/modules owned:** `feature/ai`, `/perception/`

**Topics exposed:** `/perception/person`, `/perception/hazard`, `/perception/detection`

**Definition of Done:** All three topics publish correctly-typed messages on a live Webots flight; fusion node produces one confirmed detection per real victim encounter, not duplicates.

**Testing checklist:** Recorded rosbag replay accuracy check; live flyover of each hazard type; dedup test (fly past same victim twice, confirm single confirmed detection or intentional re-confirmation logic).

**Demo responsibilities:** Narrates the AI/detection portion of the demo script.

**Backup responsibilities:** Can assist Member 4 with risk-score logic (adjacent domain).

**Skills required:** Basic Python, willingness to read Ultralytics docs, patience for tuning thresholds.

**Learning resources:** Ultralytics YOLOv8 quickstart docs, OpenCV bounding-box drawing tutorial.

---

### 6.3 MEMBER 3 — Navigation / SLAM

**Responsibilities:** Autonomous search pattern, obstacle avoidance, GPS-denied SLAM (stretch only).

**Technologies to learn:** Basic path-planning (serpentine/lawnmower coverage), ROS 2 costmap concepts, (stretch) RTAB-Map basics.

**Day-by-day:**
- **Day 1:** Review locked topic spec once available (end of Day 2 from Member 1) — plan `cmd_vel` interface in the meantime using stub topic.
- **Day 2:** Confirm interface with Member 1. Start basic waypoint-follower node.
- **Day 3:** Get drone flying a simple fixed path via `cmd_vel` commands (replacing Member 1's placeholder controller).
- **Day 4:** Implement serpentine/lawnmower search-coverage pattern over the world's search area.
- **Day 5:** Basic reactive obstacle avoidance (stop/reroute on obstacle proximity using camera or simple distance check).
- **Day 6:** Tune coverage pattern + obstacle avoidance together; measure area-coverage percentage.
- **Day 7:** Buffer/bugfix day.
- **Day 8:** **Decision point:** if search+avoidance is solid, begin SLAM stretch attempt (RTAB-Map or simplified visual odometry) with a hard rule — if not visibly working by Day 10, abandon and fall back to GPS-only, no exceptions.
- **Day 9–10:** SLAM stretch work (only if Day 8 decision was "go").
- **Day 11:** Freeze navigation — GPS-only fallback confirmed working regardless of SLAM outcome.
- **Day 12:** Integration support.
- **Days 13–14:** Testing support, demo narration prep for navigation portion.

**Week-by-week:** Week 1 = reliable GPS-mode search + obstacle avoidance (this is the real deliverable). Week 2 = stretch SLAM attempt with a firm cutoff, then integration.

**Dependencies on others:** Needs Member 1's locked topic spec and `cmd_vel` interface by Day 2.

**Deliverables:** `/navigation/cmd_vel` publisher node; documented coverage-pattern behavior.

**Git branch/modules owned:** `feature/navigation`, `/navigation/`

**Topics exposed:** `/navigation/cmd_vel` (subscribes to sensor topics, does not publish detections)

**Definition of Done:** Drone autonomously covers the defined search area without manual input and avoids at least the static obstacles placed in the world, across 5 repeated runs.

**Testing checklist:** Coverage percentage measurement; obstacle-avoidance trigger test; (if SLAM attempted) GPS-loss toggle test.

**Demo responsibilities:** Narrates the autonomous search / navigation portion.

**Backup responsibilities:** Can assist Member 1 with world/drone debugging (shares Webots context).

**Skills required:** Basic trigonometry/geometry comfort, ROS 2 basics, patience for control-loop tuning.

**Learning resources:** ROS 2 Nav2 concepts overview (even if not using Nav2 directly, the concepts transfer), RTAB-Map ROS 2 wiki (only if attempting stretch).

---

### 6.4 MEMBER 4 — Mapping / Backend / Data (heaviest load — see 6.0)

**Responsibilities:** Backend API/WebSocket, database, geotagging, risk scoring, rescue priority, safe-route (stretch), offline/sync.

**Technologies to learn:** FastAPI, WebSockets, SQLite, basic A* implementation.

**Day-by-day:**
- **Day 1:** Set up FastAPI project skeleton, SQLite schema draft (detections, hazards, alerts, mission events tables).
- **Day 2:** WebSocket broadcast endpoint working with dummy/mock data (don't wait on real detections yet).
- **Day 3:** Wire real `/perception/detection` and `/perception/hazard` topics (via a ROS 2↔backend bridge node) into the database.
- **Day 4:** Geotagging logic: combine detection with IMU/GPS pose at capture time into a lat/long-equivalent coordinate.
- **Day 5:** Risk-scoring engine v1 (start with 2–3 factors: confidence, hazard proximity, survivor count).
- **Day 6:** Rescue-priority sorting endpoint (ranked list, live-updating).
- **Day 7:** Fusion handoff coordination with Member 2 — confirm final message format for confirmed detections.
- **Day 8:** Offline mode: local SQLite queue that works even without a live WebSocket client attached.
- **Day 9:** Sync engine: on reconnect, drain the queue, timestamp-order writes, push to any connected dashboard.
- **Day 10:** **Decision point:** if ahead, attempt safe-route A* over hazard costmap. If behind, skip — route is explicitly NICE-TO-HAVE.
- **Day 11:** Freeze backend — bugfixing only.
- **Day 12:** Integration — this is likely the most bug-prone integration point (everyone's data flows through here).
- **Days 13–14:** Testing support, demo narration prep for risk/priority/offline portions.

**Week-by-week:** Week 1 = backend skeleton + WebSocket + geotag + risk scoring. Week 2 = priority + offline/sync + (stretch) route + integration.

**Dependencies on others:** Needs Member 2's detection message format agreed by Day 7 (can build against a stub before that). Needs Member 1's topic spec from Day 2.

**Deliverables:** FastAPI backend, SQLite DB, WebSocket broadcast, risk-scoring module, offline queue + sync engine.

**Git branch/modules owned:** `feature/backend`, `/backend/`

**Topics/APIs exposed:** Subscribes to `/perception/detection`, `/perception/hazard`; exposes WebSocket endpoint `/ws/live` and REST `/api/missions/{id}/history`.

**Definition of Done:** A detection published on ROS 2 appears in the database, gets scored, and is pushed to any connected WebSocket client within ~1 second; offline queue survives a WebSocket disconnect and syncs correctly on reconnect.

**Testing checklist:** Unit tests on risk-score formula with known inputs; WebSocket client manual connect/disconnect test; offline→sync end-to-end test.

**Demo responsibilities:** Narrates risk scoring, priority ranking, and the offline/sync moment in the demo.

**Backup responsibilities:** Can assist Member 5 with dashboard data-wiring issues (owns the API they consume).

**Skills required:** Backend API comfort, basic database schema design, calm under the heaviest workload — flag early to teammates if falling behind.

**Learning resources:** FastAPI official WebSocket tutorial, SQLite Python (`sqlite3`) quickstart.

---

### 6.5 MEMBER 5 — Dashboard / Frontend

**Responsibilities:** All 8 command-center dashboard elements (Requirement 8).

**Technologies to learn:** React (Vite), Leaflet, WebSocket client-side consumption.

**Day-by-day:**
- **Day 1:** Scaffold React app, install Leaflet, build static wireframe layout (all 8 panels as empty boxes) — see dashboard wireframe once written in a later part.
- **Day 2:** Connect WebSocket client to Member 4's mock-data endpoint. Confirm live message receipt in console.
- **Day 3:** Build video panel (can use a static/looping placeholder feed until real video streaming is wired).
- **Day 4:** Build map panel with Leaflet — plot dummy pins first.
- **Day 5:** Wire map panel to real detection data from backend.
- **Day 6:** Build alert feed panel (live-updating list) and mission status panel.
- **Day 7:** Build survivor priority list panel — wire to Member 4's ranked-list endpoint.
- **Day 8:** Build hazard markers on map (distinct styling from survivor pins). Build connectivity/offline indicator.
- **Day 9:** Wire real video stream (or best-effort screen-captured Webots feed if full streaming is too time-costly — acceptable simplification).
- **Day 10:** Polish: styling pass, responsive layout check, ensure judge-readability (large fonts, clear color coding for priority levels) — only after all panels are functionally wired.
- **Day 11:** Freeze dashboard — bugfixing only.
- **Day 12:** Integration.
- **Days 13–14:** Testing support, demo rehearsal — this is the screen judges watch most, so extra rehearsal time here is worth it.

**Week-by-week:** Week 1 = wireframe + WebSocket wiring + video/map panels. Week 2 = remaining panels + polish + integration.

**Dependencies on others:** Needs Member 4's WebSocket endpoint (mock data acceptable from Day 2, real data by Day 5+).

**Deliverables:** Full React dashboard app with all 8 required panels live-wired.

**Git branch/modules owned:** `feature/dashboard`, `/frontend/`

**APIs consumed:** WebSocket `/ws/live`, REST `/api/missions/{id}/history` (for replay, if attempted).

**Definition of Done:** All 8 dashboard elements from Requirement 8 are present and update live during a real mission run, without manual refresh.

**Testing checklist:** Live run-through with real backend; verify no panel silently fails to update; verify offline indicator correctly reflects connection state.

**Demo responsibilities:** Owns the visible screen during the entire demo — the single most judge-facing role; should be very comfortable narrating what's on screen.

**Backup responsibilities:** Can assist Member 4 with API contract clarifications (primary consumer of the API).

**Skills required:** React/JS comfort, an eye for clear/readable UI under demo pressure (avoid clutter).

**Learning resources:** React + Vite quickstart, Leaflet "Quick Start" guide, native WebSocket API (`new WebSocket(...)`) basics.

---

### 6.6 MEMBER 6 — Integration / Hardware / Testing

**Responsibilities:** Cross-cutting support Days 1–11 (floats to whichever member needs help), then owns full integration and testing Days 12–14. Also owns the offline/online toggle mechanism used in the demo.

**Technologies to learn:** Git branching/merging at a practical level, basic ROS 2 debugging (`rqt_graph`, `ros2 topic echo`, `ros2 bag`), enough of every other member's stack to unblock them.

**Day-by-day:**
- **Day 1:** Set up repo structure, branch protection, CI-lite (even just a lint/build check), issue tracker labels (details in a later GitHub-strategy part).
- **Day 2:** Float to whichever member needs a second pair of hands after the topic-spec lock discussion (likely Member 1 or 4).
- **Day 3–4:** Build the "network cut/restore" demo mechanism (a simple script or UI toggle that kills/restores the WebSocket connection or ROS bridge) — needed for the offline demo moment, owned early so it's not a Day-13 scramble.
- **Day 5–7:** Float support — whoever is most behind schedule (check in daily). Also begin writing integration test scripts (scripted scenario runs).
- **Day 8–9:** Continue float support. Draft the 5 demo scenarios (detailed in a later simulation-scenarios part) so they're ready to run on Day 12.
- **Day 10–11:** Prep the single combined launch file/sequence that brings up all 6 members' nodes together — do this *before* Day 12 so integration day isn't spent on launch plumbing.
- **Day 12:** Lead full integration — run the combined system, log every failure, triage by severity.
- **Day 13:** Lead testing day — run the 5 scenarios repeatedly, track pass/fail.
- **Day 14:** Lead demo rehearsal, record backup video, finalize timing to 5–7 minutes.

**Week-by-week:** Week 1 = repo/tooling setup + floating support + build the network-toggle demo mechanism. Week 2 = float support → full integration lead → testing lead → demo lead.

**Dependencies on others:** Everyone — this role is explicitly about unblocking others, so it has no fixed upstream dependency but a lot of downstream responsibility.

**Deliverables:** Repo structure, combined launch sequence, network-toggle mechanism, integration test scripts, backup demo recording.

**Git branch/modules owned:** `main`/`develop` (merge gatekeeper), `/scripts/`, `/launch/`

**APIs/topics touched:** All of them, at integration level, not ownership level.

**Definition of Done:** Full system launches from one command/sequence; all 5 demo scenarios pass at least 4/5 clean runs; backup video exists.

**Testing checklist:** Owns executing and tracking the full test matrix (detailed in a later testing-strategy part).

**Demo responsibilities:** Overall demo stage-manager — cues transitions, operates the network-toggle moment, is the fallback narrator if anyone freezes.

**Backup responsibilities:** By Day 12 should understand every module well enough to explain it to judges if the primary owner is unavailable.

**Skills required:** Organizational/systems thinking, calm troubleshooting under pressure, broad-but-shallow comfort across the whole stack.

**Learning resources:** Git branching strategy basics, `ros2 launch` file tutorial, general debugging mindset (read error messages fully before assuming the cause).

---

---

## SECTION 7 — Part 7: ROS 2 Architecture (Full Spec — Lock This by End of Day 2)

This is the interface contract the entire 14-day parallel-work plan depends on. Once locked, changing a topic name or message field requires a full-team sign-off, not a unilateral edit — that's what makes six people able to build independently without stepping on each other.

### 7.1 Custom Message Types

Define these in a shared `aerosar_msgs` package so every node imports from one place.

```
# aerosar_msgs/msg/Detection.msg
string id                  # unique detection id (uuid or counter)
string detection_type      # "person" or one of the hazard classes
float32 confidence         # 0.0–1.0
float32 bbox_x
float32 bbox_y
float32 bbox_w
float32 bbox_h
bool thermal_confirmed      # true if thermal channel confirmed the RGB candidate
float64 latitude            # geotag, computed from IMU/GPS at capture time
float64 longitude
float64 altitude
builtin_interfaces/Time stamp

# aerosar_msgs/msg/Hazard.msg
string id
string hazard_type          # "fire" | "smoke" | "flood" | "debris" | "damaged_structure" | "landslide"
float32 confidence
float64 latitude
float64 longitude
builtin_interfaces/Time stamp

# aerosar_msgs/msg/RiskScore.msg
string detection_id         # references Detection.id
float32 score                # numeric score, see Part 11 formula
string priority_level        # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
string reason                # human-readable explanation string

# aerosar_msgs/msg/Alert.msg
string alert_id
string alert_type            # "SURVIVOR_DETECTED" | "HAZARD_DETECTED" | "CRITICAL_PRIORITY" | "LINK_LOST" | "LINK_RESTORED"
string message
float64 latitude
float64 longitude
builtin_interfaces/Time stamp

# aerosar_msgs/msg/MissionStatus.msg
string mission_id
string state                  # "IDLE" | "SEARCHING" | "RETURNING" | "COMPLETE"
float32 battery_percent        # simulated
float32 coverage_percent
bool link_connected
builtin_interfaces/Time stamp
```

### 7.2 Full Topic Table

| Topic | Type | Publisher | Subscriber(s) | Frequency | Notes |
|---|---|---|---|---|---|
| `/camera/image_raw` | `sensor_msgs/Image` | Member 1 (Webots) | Member 2 (AI) | ~15–30 Hz | RGB feed |
| `/thermal/image_raw` | `sensor_msgs/Image` | Member 1 (Webots) | Member 2 (AI) | ~10 Hz | Heat-mapped proxy camera (MVP) |
| `/imu/data` | `sensor_msgs/Imu` | Member 1 (Webots) | Member 2 (fusion), Member 3 (nav) | ~50 Hz | Standard IMU msg |
| `/gps/fix` | `sensor_msgs/NavSatFix` | Member 1 (Webots) | Member 2 (fusion), Member 3 (nav), Member 4 (backend bridge) | ~5–10 Hz | Simulated GPS; can be zeroed/interrupted to simulate GPS-denial |
| `/lidar/points` | `sensor_msgs/PointCloud2` | Member 1 (Webots, L3 only) | Member 3 (SLAM, stretch) | ~10 Hz | Only if SLAM stretch attempted |
| `/perception/person` | `aerosar_msgs/Detection` | Member 2 | Member 2 (internal, feeds fusion) | Event-driven | Raw person candidate, pre-fusion |
| `/perception/hazard` | `aerosar_msgs/Hazard` | Member 2 | Member 4 (backend bridge) | Event-driven | |
| `/perception/detection` | `aerosar_msgs/Detection` | Member 2 (fusion node output) | Member 4 (backend bridge) | Event-driven | Final confirmed, geotagged, deduplicated detection |
| `/navigation/cmd_vel` | `geometry_msgs/Twist` | Member 3 | Member 1 (Webots drone controller) | ~20 Hz | Standard velocity command |
| `/mapping/map` | `nav_msgs/OccupancyGrid` (or simplified custom grid) | Member 4 | Member 5 (dashboard bridge) | On update | L1: can be a simple scatter list instead of a full grid |
| `/rescue/risk_score` | `aerosar_msgs/RiskScore` | Member 4 | Member 4 (internal), Member 5 (bridge) | Event-driven | |
| `/rescue/priority` | custom list of `RiskScore` (or REST/WebSocket only — ROS topic optional) | Member 4 | Member 5 (bridge) | On update | Acceptable to implement as backend-only, not a ROS topic, if simpler |
| `/alerts/emergency` | `aerosar_msgs/Alert` | Member 4 | Member 5 (bridge) | Event-driven | |
| `/mission/status` | `aerosar_msgs/MissionStatus` | Member 1 or Member 6 (whichever owns mission state) | Member 4 (backend bridge), Member 5 | ~1 Hz | |

**Note on the "backend bridge":** Member 4 owns a small ROS 2 node whose only job is subscribing to the topics above and forwarding them into the FastAPI/WebSocket layer. This is the single seam between ROS 2 and the web stack — keep it thin (no business logic in the bridge itself).

### 7.3 Services / Actions (kept minimal for a 14-day scope)

Full Nav2-style action servers are not required for this timeline. Two simple services are enough:

```
/mission/start   (std_srvs/Trigger)   — begins autonomous search
/mission/abort   (std_srvs/Trigger)   — commands RTL / stop
```

Anything more elaborate (multi-goal actions, feedback/cancel semantics) is explicitly out of scope for 14 days — a service call is sufficient for a demo.

### 7.4 Complete ROS Graph (ASCII)

```
                         ┌───────────────────────────┐
                         │      Webots (Member 1)      │
                         │  drone + world simulation   │
                         └─────────────┬───────────────┘
              /camera/image_raw │  /thermal/image_raw │ /imu/data │ /gps/fix │ (/lidar/points)
                                 ▼
                    ┌────────────────────────┐
                    │   Perception Node(s)     │◀────── (Member 2)
                    │  person + hazard detect  │
                    └───────────┬───────────────┘
              /perception/person │ /perception/hazard
                                 ▼
                    ┌────────────────────────┐
                    │      Fusion Node          │◀────── (Member 2, uses /imu, /gps)
                    └───────────┬───────────────┘
                     /perception/detection
                                 ▼
                    ┌────────────────────────┐
                    │  Backend Bridge Node      │◀────── (Member 4)
                    │  (ROS 2 ↔ FastAPI/WS)     │
                    └───────────┬───────────────┘
                                 │
                    ┌────────────┴───────────────┐
                    │  Risk Scoring + Priority     │
                    │  Geotag + Mapping + Offline   │
                    │  Queue + Sync (Member 4)      │
                    └───────────┬───────────────────┘
                        WebSocket /ws/live
                                 ▼
                    ┌────────────────────────┐
                    │   React Dashboard         │◀────── (Member 5)
                    │  video/map/alerts/status  │
                    └────────────────────────┘

     Separately:
     ┌────────────────────────┐        /navigation/cmd_vel        ┌───────────────────────────┐
     │  Navigation Node          │ ─────────────────────────────▶ │      Webots (drone control)  │
     │  (Member 3, uses /imu,    │                                └───────────────────────────┘
     │   /gps, camera for        │
     │   obstacle avoidance)     │
     └────────────────────────┘
```

**Why the fusion node needs `/imu` and `/gps` directly rather than going through the perception node:** geotagging requires the *pose at the exact capture timestamp*, not a delayed/derived value — so it subscribes directly rather than waiting on an intermediate hop. This is a subtle point worth Member 2 and Member 1 confirming together on Day 2, since a timestamp-sync bug here is a classic source of "detections show up in the wrong place on the map."

---

---

## SECTION 8 — Part 8: AI Design

**Framing for a 14-day timeline:** the single biggest AI-related risk is a team burning 4–5 days trying to collect and annotate a custom dataset for hazard classes, then having a mediocre model with no time left to integrate it. The design below is built to avoid that trap — most hazard classes are **deterministic in simulation** and don't need a trained model at all for Levels 1–2.

### 8.1 Dataset Requirements & Sources (only relevant for classes that need real training)

| Need | Source | Notes |
|---|---|---|
| Person detection | **None needed** — COCO-pretrained YOLO already detects "person" at high accuracy | Zero data collection required |
| Fire/smoke (if fine-tuning attempted) | Public wildfire/fire-detection datasets (e.g. Kaggle fire-detection sets), or self-recorded images of controlled small flames/smoke sources for photos | Only attempt if Days 8+ have slack (per Member 2's roadmap) |
| Flood | Public flood-scene datasets (e.g. flood segmentation sets on Kaggle/academic sources), or simply water-texture objects in Webots for the deterministic route | Deterministic route strongly preferred for 14 days |
| Debris/damaged structure | Public disaster-imagery datasets (e.g. xBD building-damage dataset is the well-known academic one, though large/heavy for a 2-week project) | Deterministic route strongly preferred |
| Annotation (if any real training attempted) | Roboflow (free tier) or LabelImg | Roboflow is faster for a small team — auto-augmentation and direct YOLO-format export |

**Recommendation: do not attempt custom dataset collection/annotation/training within a 14-day sprint unless a team member already has a dataset or strong prior ML experience.** The deterministic approach below satisfies Requirement 4 (hazard classification) for demo purposes and is architecturally identical from the fusion/backend/dashboard's point of view — those layers just see a `Hazard` message with a `hazard_type` field regardless of how that field was populated.

### 8.2 The "Simulate vs. Train" Decision, Per Class

| Class | MVP approach (Level 1–2) | Why this is legitimate, not a shortcut | L3 upgrade path (only if time allows) |
|---|---|---|---|
| **Person** | Real trained model (pretrained YOLO, zero extra work) | Already solved by an off-the-shelf model — no reason to simulate this one | Fine-tune on synthetic Webots-rendered humanoid models for slightly better sim-specific accuracy |
| **Fire** | Deterministic: a distinctly-colored/textured object in Webots tagged `hazard_type=fire`, detected via simple color-thresholding (OpenCV) or object-name lookup from the simulator | The PS asks for hazard *classification* and *response* — the value being demonstrated is what happens *after* detection (risk scoring, alerting, routing), not the detector's ML sophistication | Fine-tuned YOLO class on real fire imagery |
| **Smoke** | Deterministic: particle system or semi-transparent gray object tagged similarly | Same reasoning | Fine-tuned model, or classical CV smoke-texture heuristics (harder than it sounds — treat as stretch only) |
| **Flood** | Deterministic: a blue plane/texture object covering part of the terrain, tagged `hazard_type=flood` | Water is visually simple and reliably distinguishable even with basic color-thresholding, so this is one of the more defensible "detect for real" candidates if time allows | Real color/texture-based CV detector (moderate difficulty, good ROI) |
| **Debris** | Deterministic: irregular placed objects tagged `hazard_type=debris` | Real debris detection is genuinely hard (high visual variance) — not a good use of a 2-week team's time | Skip for hackathon scope entirely unless a member is specifically excited about it |
| **Damaged/unstable structure** | Deterministic: pre-built "tilted/cracked" structure model tagged `hazard_type=damaged_structure` | Same — structural damage assessment is a hard, genuinely research-level CV problem | Skip for hackathon scope |

**How to present this to judges honestly:** state plainly that hazard classes are represented via tagged simulation objects for the prototype phase, with the architecture designed so any class can be swapped for a trained model without touching the fusion, risk-scoring, or dashboard layers — then demonstrate that architectural claim by actually having person detection be the one real trained model in the system. This is a stronger, more credible story than claiming six fully-trained hazard classifiers that are actually undertested.

### 8.3 Model Selection & Deployment Pipeline

```
Pretrained YOLOv8n/YOLOv8s (person)
        │
        ▼
  Export to ONNX  ──────────────▶  Run via ONNX Runtime (dev laptop, sim phase)
        │
        ▼ (only if/when real Jetson hardware acquired)
  TensorRT engine build  ────────▶  Run via TensorRT (edge deployment phase)
```

- **YOLOv8n (nano)** recommended over larger variants (`s`/`m`/`l`) — the accuracy gain from bigger models is not worth the latency cost for a prototype where "person" is already a well-solved COCO class.
- Export once to ONNX; this is what makes the "simulate now, deploy later" claim literally true rather than aspirational — the exact same `.onnx` file and inference code runs against Webots frames or real camera frames.

### 8.4 Confidence Thresholds

| Class | Suggested threshold | Rationale |
|---|---|---|
| Person | 0.5 | Standard YOLO default; COCO-pretrained is reliable enough not to need aggressive tuning |
| Deterministic hazards | N/A (rule-based, not probabilistic) — treat as always 1.0 confidence when the tag/color match fires, OR simulate a confidence value (e.g. 0.85) if you want the dashboard's confidence display to look realistic | Deterministic detection is binary in reality; injecting an artificial confidence number for UI realism is a defensible demo choice as long as it's documented internally as such |

### 8.5 False Positive / False Negative Handling

- **False positives (person):** apply a minimum bounding-box size filter (very small/distant boxes are often noise) and require 2 consecutive frame detections before publishing a confirmed candidate — cheap, effective for a prototype.
- **False negatives (person):** acceptable to leave unaddressed for a 14-day scope beyond ensuring good camera framing/altitude in the demo flight path — a full recall-optimization pass is not a good use of remaining time.
- **Hazard false positives/negatives:** not applicable to the deterministic approach (it either matches the tag or it doesn't) — this is actually one more argument in favor of the deterministic route for a hard deadline: it removes an entire category of debugging.

### 8.6 What This Means for Member 2's Day-by-Day Plan (cross-reference)

This section confirms the approach already baked into Member 2's roadmap (Section 6.2): build the deterministic hazard detector first (Day 4), get person detection solid (Days 3–5), and only attempt real training on any hazard class if Day 9 shows genuine slack — with an explicit instruction not to start new model training that late if behind schedule.

---

---

## SECTION 9 — Part 9: Thermal + RGB Sensor Fusion

### 9.1 The Core Design Principle

The architecture must be **identical** whether the thermal signal comes from a simulated proxy or a real FLIR-class sensor. The fusion node should never know or care which one it's receiving — it just subscribes to `/thermal/image_raw` and processes whatever arrives. This is what makes "simulate now, deploy later" true for Requirement 3, not just a slogan.

```
RGB → detection ──┐
                    ├──▶ Sensor Fusion ──▶ Confirmed Survivor
Thermal → confirm ─┘
```

### 9.2 MVP: Simulating Thermal Without a Real Thermal Camera

**Approach:** attach a second camera device to the drone in Webots, pointed the same direction as the RGB camera, rendering a scene where "victim" models are given a distinct emissive/bright texture (e.g. a warm-colored glow material) against a cooler-toned background. This is not a physically accurate thermal simulation — it doesn't need to be. Its only job is to let the fusion logic exercise the real code path: *"does the region where RGB found a person also show a heat-like signature in the second channel?"*

```
Webots victim model
   │
   ├── RGB material: realistic human-like texture/color
   └── Thermal-proxy material: bright/warm-toned emissive texture
                    (only visible on the thermal-proxy camera's render layer)
```

Practical implementation note for Member 1: Webots supports assigning different appearance/material properties per camera render pass, or alternatively a second camera can simply view a parallel/duplicate scene where non-victim objects are dimmed and victim objects are brightened. Either approach is acceptable — the fusion node doesn't care how the image was produced, only that `/thermal/image_raw` contains a detectable bright region aligned with the RGB detection.

### 9.3 Fusion Node Logic

```
1. RGB detector publishes candidate: bbox (x, y, w, h), confidence, timestamp
2. Fusion node crops the corresponding region from the latest /thermal/image_raw
   frame (matched by nearest timestamp)
3. Simple check: average brightness/heat-proxy value within that cropped region
   exceeds a threshold?
      YES → thermal_confirmed = true, combined confidence = boosted
      NO  → thermal_confirmed = false, combined confidence = RGB-only value,
            still published (do not discard — a real thermal sensor could
            plausibly miss on cool days too; treat as lower-confidence,
            not invalid)
4. Attach IMU/GPS pose (timestamp-matched) → compute geotag
5. Deduplicate against recently-published detections (distance + time window)
6. Publish aerosar_msgs/Detection on /perception/detection
```

**Why not discard unconfirmed detections:** a real-world thermal camera can fail to register a signature for many legitimate reasons (clothing insulation, distance, camera angle). Silently dropping RGB-only detections would mean an SIH judge could ask "what if the thermal camera is defective/out of range — do you lose survivors entirely?" and the honest answer would be yes. Publishing with a lower confidence/no-thermal-confirmed flag instead is a materially better and more defensible design.

### 9.4 Timestamp Matching (the detail most likely to cause bugs)

RGB and thermal frames won't arrive at exactly the same ROS time. Use a small tolerance window (e.g. ±100ms) when matching frames for fusion — if no thermal frame exists within that window, treat as "thermal unavailable for this detection" (same handling as a non-confirming thermal check, not an error state).

### 9.5 Advanced (Real Hardware) Path — Explicitly Deferred

If your team later acquires a real thermal camera (e.g. FLIR Lepton breakout board):

| Aspect | What changes | What stays identical |
|---|---|---|
| Camera driver | New ROS 2 driver node publishing `/thermal/image_raw` from the real sensor | Message type (`sensor_msgs/Image`) — no change |
| Calibration | Real thermal cameras need RGB↔thermal alignment/calibration (different FOV, different mounting offset) — this is genuinely nontrivial | Fusion node's subscription and logic — no change |
| Threshold tuning | Real heat-signature values will differ numerically from the simulated proxy — thresholds need re-tuning | The architecture and message flow — no change |

**This is explicitly Level 3 / post-hackathon scope** unless your team already has a thermal camera in hand before Day 1 — do not attempt to source and calibrate one mid-sprint per the hardware philosophy established in Part 2.

---

---

## SECTION 10 — Part 10: Navigation

### 10.1 Mode Selection Logic

```
                    ┌─────────────────────┐
                    │  Check /gps/fix       │
                    │  validity + signal     │
                    └──────────┬─────────────┘
                    Valid GPS? │
              ┌────────────────┴────────────────┐
             YES                                 NO
              │                                   │
              ▼                                   ▼
      MODE A: GPS Navigation             MODE B: GPS-Denied Navigation
      (waypoints, absolute pose)          (SLAM/local pose, relative)
```

The mode-select check should run continuously (not just once at mission start) — a real disaster environment can lose and regain GPS mid-flight (e.g. flying under a collapsed structure and back out), and the architecture should handle that transition gracefully, not just a fixed "GPS mode for this mission" assumption.

### 10.2 MODE A — GPS Available

```
GPS fix (lat/long/alt) ──▶ Waypoint planner ──▶ Path segments ──▶ Local obstacle
                                                                     check
                                                                        │
                                                                        ▼
                                                                  /navigation/cmd_vel
```

**For the 14-day prototype:** waypoints are a pre-defined serpentine/lawnmower search pattern over the world's search area (per Member 3's roadmap), not a dynamically-planned route to arbitrary targets — full dynamic path planning is unnecessary complexity for demonstrating "autonomous search."

**Obstacle avoidance (simplified for MVP):** rather than a full costmap + planner, a reactive rule is sufficient and much faster to implement:
```
IF obstacle detected within threshold distance in current heading:
    stop forward motion, yaw by fixed increment, resume forward motion
```
This is a legitimate "simplified implementation" tier per the three-tier rule established in Section 2 — it demonstrably avoids obstacles in the demo without requiring a full navigation stack.

### 10.3 MODE B — GPS Denied

```
GPS invalid/lost ──▶ Camera/LiDAR feed ──▶ SLAM (pose estimate + local map)
                                                    │
                                                    ▼
                                          Local planner (relative to
                                          last-known-good position)
                                                    │
                                                    ▼
                                            /navigation/cmd_vel
```

**Three implementation tiers for GPS-denied mode (per the difficulty rule from Section 2):**

1. **Full implementation:** RTAB-Map or similar visual/LiDAR SLAM producing a real pose estimate and local occupancy map, drone continues autonomous search using the SLAM-derived pose.
2. **Simplified implementation:** dead-reckoning from IMU integration alone (no visual SLAM) — accept accumulating drift, sufficient to show the drone "continuing to move sensibly" for a short GPS-denied segment (30–60 seconds) rather than freezing or crashing.
3. **Demo-only implementation:** a scripted behavior — when GPS is lost, the drone switches to a pre-programmed local maneuver (e.g. continue last heading at reduced speed for N seconds, or execute a small pre-set search loop) while the dashboard displays "GPS LOST — LOCAL NAVIGATION ACTIVE." This is clearly labeled internally as scripted, not derived from real localization, but is a legitimate way to demonstrate the *concept* and the *system's designed response* to GPS loss within a 14-day timeline.

**Recommendation for your team:** target tier 2 (IMU dead-reckoning) as the realistic default, with tier 1 (real SLAM) as Member 3's opportunistic Day 8–10 stretch attempt per their roadmap, and tier 3 as the guaranteed fallback if both above run out of time. Never present tier 3 to judges as if it were tier 1 — if asked directly "is this real SLAM," the honest answer should be ready regardless of which tier you shipped.

### 10.4 What Happens at the Mode Transition

This transition moment is actually one of your best demo beats (see Requirement 1 + your own demo script draft in the original brief) — worth building deliberately rather than as an afterthought:

```
GPS valid ──▶ [transition detected] ──▶ Dashboard alert: "GPS SIGNAL LOST"
                                          Mission status updates: mode=GPS_DENIED
                                          Drone visibly continues (not stopping)
                                          ──▶ [GPS restored] ──▶ Dashboard alert:
                                          "GPS SIGNAL RESTORED"
                                          Mode reverts to GPS_NAV
```

### 10.5 What to Simplify vs. What to Keep Real (summary table)

| Component | Keep real | Simplify |
|---|---|---|
| GPS waypoint following | ✅ Real (straightforward) | — |
| Search coverage pattern | ✅ Real (fixed serpentine) | — |
| Obstacle avoidance | ✅ Real (reactive rule-based) | Skip full costmap/planner |
| SLAM pose estimation | Stretch only (Member 3, Day 8+) | Default to IMU dead-reckoning or scripted fallback |
| Dynamic path re-planning to arbitrary targets | — | Not attempted — out of scope for 14 days |
| Mode-transition detection + dashboard signaling | ✅ Real — cheap to build, high demo value | — |

---

---

## SECTION 11 — Part 11: Rescue Priority Algorithm

### 11.1 Design Goal: Transparent and Explainable

The PS asks for "prioritized rescue recommendations based on detected risks." For a 14-day prototype, a simple, transparent weighted-sum formula is strongly preferable to anything opaque (e.g. a trained scoring model) — it's faster to build, trivial to unit-test, and — critically — every score comes with a plain-English reason string, which is exactly the kind of explainability judges respond well to.

### 11.2 Factors (start with these 3–4 for Level 2; the rest are stretch)

| Factor | Symbol | Range | Source |
|---|---|---|---|
| Detection confidence | `C` | 0.0–1.0 | From `Detection.confidence` |
| Thermal confirmation | `T` | 0 or 1 (boolean) | From `Detection.thermal_confirmed` |
| Distance to nearest hazard | `Dh` | meters, converted to 0–1 risk (closer = higher) | Computed against active `Hazard` list |
| Number of survivors in cluster | `N` | integer, converted to 0–1 (more = higher, capped) | Count of detections within a small radius |
| *(Stretch)* Hazard severity | `S` | 0.0–1.0, per hazard type | e.g. fire=0.9, smoke=0.6, flood=0.7, debris=0.5 |
| *(Stretch)* Accessibility | `A` | 0.0–1.0 (lower = harder to reach) | Derived from safe-route cost if Part 12 route planning is implemented |

### 11.3 The Formula (Level 2 — recommended starting point)

```
hazard_proximity_risk = clamp(1 - (Dh / MAX_RELEVANT_DISTANCE), 0, 1)
survivor_count_factor = clamp(N / MAX_RELEVANT_COUNT, 0, 1)
thermal_bonus = 0.15 if T == 1 else 0.0

raw_score = (0.35 * C)
          + (0.30 * hazard_proximity_risk)
          + (0.20 * survivor_count_factor)
          + thermal_bonus

score = clamp(raw_score, 0, 1)
```

Where `MAX_RELEVANT_DISTANCE` (e.g. 20 meters — tune to your world scale) is the distance beyond which nearby hazards stop mattering, and `MAX_RELEVANT_COUNT` (e.g. 5) is the cluster size beyond which additional survivors stop increasing urgency proportionally.

**Weights are intentionally simple and round** (0.35/0.30/0.20 + flat bonus) — this is a deliberate choice for explainability. A judge or teammate can sanity-check the formula in their head; a formula with seven decimal-precision weights derived from "tuning" looks more sophisticated but is actually less defensible when asked "why these specific numbers?"

### 11.4 Priority Level Thresholds

| Score range | Priority Level |
|---|---|
| `score < 0.35` | LOW |
| `0.35 ≤ score < 0.55` | MEDIUM |
| `0.55 ≤ score < 0.75` | HIGH |
| `score ≥ 0.75` | CRITICAL |

**Note:** a survivor detected with thermal confirmation directly adjacent to a hazard will land in HIGH/CRITICAL almost automatically given these weights — which is the correct behavior and a good thing to verify in testing (Part 16) as a sanity check that the formula behaves as intended, not just that it runs without errors.

### 11.5 Stretch Formula (Level 3, if hazard severity + accessibility are implemented)

```
raw_score = (0.30 * C)
          + (0.25 * hazard_proximity_risk)
          + (0.15 * survivor_count_factor)
          + (0.15 * hazard_severity_factor)     # uses S
          + (0.15 * (1 - accessibility_factor))  # uses A; harder to reach = more urgent
          + thermal_bonus
```

Only adopt this if both `S` and `A` are actually available — do not add factors with placeholder/fake values just to look more sophisticated; an unused or dummy-valued factor is worse for explainability than not having it.

### 11.6 Generating the "Why" Reason String

This is what turns a bare number into something a rescue team (or a judge) can actually use:

```python
def build_reason(C, hazard_proximity_risk, N, T, priority_level):
    parts = []
    if C >= 0.7:
        parts.append(f"high detection confidence ({C:.2f})")
    if hazard_proximity_risk >= 0.5:
        parts.append("located near an active hazard")
    if N > 1:
        parts.append(f"{N} survivors detected in cluster")
    if T:
        parts.append("thermal-confirmed")
    if not parts:
        parts.append("baseline detection factors")
    return f"{priority_level}: " + ", ".join(parts)
```

Example output: `"CRITICAL: high detection confidence (0.87), located near an active hazard, thermal-confirmed"`

This string is what populates the `reason` field in `aerosar_msgs/RiskScore` (Part 7) and is what the dashboard's priority list should display prominently next to each ranked survivor — it's a small addition that meaningfully strengthens the "explainable AI" story for judges.

### 11.7 Worked Example

A survivor detected with confidence 0.82, thermal-confirmed, 4 meters from an active fire (assume `MAX_RELEVANT_DISTANCE = 20`), alone (N=1):

```
hazard_proximity_risk = 1 - (4/20) = 0.80
survivor_count_factor = 1/5 = 0.20
thermal_bonus = 0.15

raw_score = (0.35 * 0.82) + (0.30 * 0.80) + (0.20 * 0.20) + 0.15
          = 0.287 + 0.24 + 0.04 + 0.15
          = 0.717

→ Priority: HIGH (just under CRITICAL's 0.75 threshold)
→ Reason: "HIGH: high detection confidence (0.82), located near an active hazard, thermal-confirmed"
```

Worth including a worked example like this directly in your team's submission/report — it's concrete proof the formula does something meaningful rather than just being a black box that outputs colors.

---

---

## SECTION 12 — Part 12: Safe Route Planning

**Scope reminder:** this is marked NICE-TO-HAVE in Section 2's Level 2 definition and is Member 4's Day 10 decision-point item. Everything below is designed so that skipping it entirely does not break any other part of the system — the map, priority list, and alerts all function completely without a route layer.

### 12.1 Algorithm Choice: A*

| Option | Verdict | Why |
|---|---|---|
| **A\*** | **Recommended** | Well-known, simple to implement over a grid, naturally supports weighted costs (hazard zones = high cost), fast enough for a small prototype map, and — importantly — easy to explain to judges in one sentence |
| Dijkstra | Viable alternative | Functionally similar to A* without a heuristic — slightly simpler to implement but slightly slower; acceptable if a team member is more comfortable with it, no real downside either way at this map scale |
| Cost maps alone (no search algorithm) | Not recommended | Without a search algorithm you'd need to hand-code route logic — more work, less general, no benefit |

**Decision: A\*** for the marginal implementation-simplicity and "sounds impressive but is actually straightforward" quality that's well-suited to a judge Q&A.

### 12.2 Algorithm Design

```
1. Discretize the operating area into a grid (reuse the same grid resolution
   as the mapping system from Requirement 5, so no coordinate translation
   needed between "the map" and "the route grid")

2. Assign cost per grid cell:
      base cost = 1 (open/unknown terrain)
      cost near a hazard = base + (hazard_severity * proximity_falloff)
      cost inside a hazard footprint = very high (effectively "avoid unless
      no alternative exists" rather than "never enter" — a real hazard zone
      might still be the only path in some scenarios, and the algorithm
      should reflect that reality rather than hard-blocking)

3. Run A* from rescue-team start position to survivor position using this
   cost grid, with the standard A* heuristic (Euclidean or Manhattan
   distance to goal)

4. Output: ordered list of waypoints forming the lowest-total-cost path

5. Publish/serve this path to the dashboard for rendering as a line overlay
```

### 12.3 ASCII Illustration

```
Cost grid (■ = hazard, high cost | · = open, low cost | S = start | G = survivor):

  S · · · ■ ■ · · ·
  · · · · ■ ■ · · ·
  · · · · · · · · ·
  · · ■ · · · · · ·
  · · ■ · · · · · G

A* route (avoiding the ■ blocks, shown as *):
  S * * * ■ ■ · · ·
  · · * * ■ ■ · · ·
  · · · * * * * · ·
  · · ■ · · · * · ·
  · · ■ · · · · * G
```

### 12.4 Implementation Notes for a 14-Day Timeline

- Use a well-tested small Python A* implementation (or the `networkx` library's built-in A* if the grid is represented as a graph) rather than writing pathfinding from scratch under time pressure — this is a solved problem, no need to reinvent it.
- Recompute the route only when triggered (e.g. new hazard detected within some radius of the current best route), not on every single frame — continuous recomputation adds complexity and computational cost with little demo-visible benefit.
- Keep the grid resolution coarse (e.g. 1–2 meter cells) — fine-grained resolution looks nicer but isn't necessary to demonstrate the concept and slows down the search.

### 12.5 If Member 4's Day 10 Decision Is "Skip"

This is a completely legitimate outcome given the timeline, and here's exactly how to handle it without weakening your submission:

1. **In the report/pitch:** describe the algorithm design (this section) as "designed and specified, implementation deferred post-hackathon due to timeline" — this is honest and still demonstrates engineering thinking, which is worth real credit with judges even without a working implementation.
2. **In the demo:** simply don't include the route-line visual. The map still shows hazard zones and survivor pins, which covers the core of Requirement 5 (geo-tagged mapping) — the "safe access routes" sub-clause is the only piece not demonstrated live.
3. **If asked directly by a judge:** state plainly that route planning was scoped as a stretch goal given a 2-week build window, and that the architecture (cost-grid + A*) is ready to implement against the existing hazard/map data without any redesign — then optionally show this section's diagram as evidence the design work was actually done, not just skipped silently.

---

---

## SECTION 13 — Part 13: Offline-First Architecture

### 13.1 Core Principle

The drone-side pipeline must **never block on network availability**. Every write (detection, hazard, alert, mission status) goes to local storage first, unconditionally — network transmission is a secondary, best-effort action layered on top, never a prerequisite for the drone continuing its mission.

```
WRONG (network-dependent):
  Detection occurs → try to send to backend → [if fails, detection is lost or
  mission stalls waiting for retry]

RIGHT (offline-first):
  Detection occurs → write to local SQLite (always succeeds, it's local) →
  separately, if link available, also push to backend → if link unavailable,
  local write already succeeded, nothing lost
```

### 13.2 Local Storage Design

```sql
-- events table (append-only, this is the offline queue)
CREATE TABLE events (
    event_id TEXT PRIMARY KEY,        -- uuid, generated at creation time
    event_type TEXT,                   -- "detection" | "hazard" | "alert" | "status"
    payload TEXT,                      -- JSON blob of the actual message
    created_at TIMESTAMP,              -- when the event occurred (drone-side clock)
    synced BOOLEAN DEFAULT 0,          -- has this reached the command center?
    synced_at TIMESTAMP NULL
);
```

Every event gets a **drone-generated UUID at creation time** — this is what makes sync idempotent (safe to retry/resend without creating duplicates on the backend side).

### 13.3 Synchronization Engine

```
┌────────────────────────┐
│  Local events table       │
│  (synced = 0 rows exist)  │
└──────────┬─────────────────┘
           │  link check (periodic, e.g. every 5s)
           ▼
    Link available? ──No──▶ wait, retry check next interval
           │Yes
           ▼
    Send unsynced events to backend (batch, ordered by created_at)
           │
           ▼
    Backend acknowledges receipt (by event_id)
           │
           ▼
    Mark local rows as synced=1, synced_at=now()
```

### 13.4 Conflict Handling

For a 14-day prototype scope, conflicts are rare and low-stakes (this system is append-only event logging, not collaborative editing) — so the simplest defensible policy is sufficient:

**Policy: event_id-based deduplication, created_at-based ordering ("last-write-wins" is not even really needed since nothing is being overwritten — events are just inserted).**

```
On backend receipt of a batch:
    FOR each event in batch:
        IF event_id already exists in backend DB:
            skip (already received, likely a retry after a dropped ack)
        ELSE:
            insert event, ordered for display by created_at (not received_at)
```

This correctly handles the realistic failure case: link drops mid-send, drone retries, backend might receive the same event twice — the UUID-based dedup makes that harmless.

### 13.5 Retry Mechanism

```
Simple exponential-ish backoff, capped:
  Attempt 1: immediate (on next periodic check)
  Attempt 2: wait 5s
  Attempt 3: wait 15s
  Attempt 4+: wait 30s (cap, keep retrying indefinitely — no giving up,
  since a disaster response system shouldn't silently stop trying to sync)
```

For a 14-day build, a fixed 5-second periodic check-and-send-if-available loop is a perfectly acceptable simplification of the above — full exponential backoff is not necessary to demonstrate the concept, and I'd recommend Member 4 not over-engineer this part.

### 13.6 Timestamping Discipline

Use **drone-local `created_at`** (when the event actually happened) as the source of truth for display ordering on the dashboard — not `synced_at` (when it happened to reach the backend). This matters for the offline demo moment specifically: if the network was down for 30 seconds and 4 detections queued up, they should appear on the dashboard in the order they actually occurred once synced, not bunched together with a "just now" timestamp that misrepresents when they really happened. This is a small detail that a sharp judge might actually notice and ask about.

### 13.7 GPS Tagging While Offline

No special handling needed — geotagging (Part 9) already happens fully on-drone at detection time using local IMU/GPS, independent of network state. This is worth stating explicitly in your submission because it directly answers "does losing connectivity affect location accuracy?" — no, because geotagging was never network-dependent in the first place.

### 13.8 The Demo Sequence for This Feature (ties to Member 6's network-toggle mechanism)

```
1. Mission running normally, dashboard shows "CONNECTED"
2. Member 6 triggers network cut (toggle/script)
3. Dashboard updates to "OFFLINE — logging locally" (driven by MissionStatus.link_connected=false)
4. Drone continues detecting/scoring/alerting — narrate that this is happening
   even though the dashboard can't see it yet
5. Member 6 restores network
6. Dashboard shows "SYNCING…" then updates with all queued events, correctly
   ordered by original detection time
7. Dashboard returns to "CONNECTED", event count confirms nothing was lost
```

This sequence is what Part 20 (Final Demo Script, later section) will build directly on top of — worth Member 4 and Member 6 rehearsing this specific moment together well before Day 14, since it involves two people's systems interacting live.

---

---

## SECTION 14 — Part 14: Dashboard Design

### 14.1 Design Priorities for a Judge-Facing Screen

This is the single screen judges will look at for most of your 5–7 minute demo (per Member 5's roadmap note in Section 6.5). Three priorities, in order:

1. **Legibility from a distance** — large fonts, high-contrast priority color coding (judges may be watching a projected screen from several meters away)
2. **Live-update visibility** — something should visibly change on screen every time something happens in the mission; a dashboard that looks static even while the drone is working undersells the whole system
3. **No clutter** — 8 required elements is already a lot of information; resist the urge to add more panels than necessary

### 14.2 Full Wireframe (ASCII)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  AEROSAR COMMAND CENTER          MISSION: search-01     ● CONNECTED       │
├───────────────────────────────────┬──────────────────────────────────────┤
│                                     │  MISSION STATUS                      │
│                                     │  State: SEARCHING                    │
│         LIVE DRONE FEED             │  Battery: ▓▓▓▓▓▓▓▓░░ 78%             │
│      (RGB / thermal toggle)          │  Coverage: ▓▓▓▓▓░░░░░ 52%            │
│                                     │  Mode: GPS_NAV                       │
│                                     │                                       │
│                                     ├──────────────────────────────────────┤
│                                     │  ALERTS                              │
│                                     │  ⚠ CRITICAL  Survivor #3 — near fire  │
├───────────────────────────────────┤  ⚠ HIGH      Survivor #1              │
│                                     │  ℹ INFO      Hazard: flood zone       │
│                                     │  ℹ INFO      Mission started          │
│           DISASTER MAP              │                                       │
│                                     ├──────────────────────────────────────┤
│    ● survivor   ■ hazard             │  SURVIVOR PRIORITY LIST              │
│    ▲ drone      ┄ safe route         │  1. CRITICAL — Survivor #3  0.81     │
│                                     │     near fire, thermal-confirmed      │
│         ▲                           │  2. HIGH — Survivor #1      0.68     │
│        ╱                            │     thermal-confirmed                 │
│    ●  ╱    ■■■                      │  3. MEDIUM — Survivor #2    0.41     │
│      ╱                              │                                       │
│  ●┄┄╱                               │                                       │
│                                     │                                       │
└───────────────────────────────────┴──────────────────────────────────────┘
```

### 14.3 Panel-by-Panel Breakdown Against Requirement 8

| PS Requirement 8 element | Wireframe location | Data source |
|---|---|---|
| Live drone feed | Top-left panel | `/camera/image_raw` (and `/thermal/image_raw` via toggle) relayed through backend |
| Survivor locations | Map panel (● markers) + priority list | `/perception/detection` via WebSocket |
| Hazard locations | Map panel (■ markers) | `/perception/hazard` via WebSocket |
| Mission status | Top-right status block | `MissionStatus` messages |
| Alerts | Alerts panel | `aerosar_msgs/Alert` via WebSocket |
| Drone status | Battery + mode within Mission Status block | `MissionStatus` |
| Map | Center-bottom map panel | Leaflet + detection/hazard markers |
| (Connectivity, mentioned in PS background) | Top-bar "● CONNECTED / ○ OFFLINE" indicator | `MissionStatus.link_connected` |

All 8 required elements are present without needing extra panels beyond what the PS actually asks for — resist scope creep here even if it's tempting to add "impressive-looking" extra widgets (see Part 21 judge-perspective guidance, later section, on features that look impressive but add little value).

### 14.4 Color Coding (for the priority list and alerts — keep consistent across both)

| Priority | Suggested color | 
|---|---|
| CRITICAL | Red |
| HIGH | Orange |
| MEDIUM | Yellow |
| LOW | Gray/Blue (deliberately unalarming) |

Consistency matters more than the specific colors chosen — a judge should be able to glance at either the map or the priority list and instantly read urgency without reading text.

### 14.5 Offline State (visual treatment)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  AEROSAR COMMAND CENTER          MISSION: search-01     ○ OFFLINE         │
│                                    (logging locally — 4 events queued)      │
```

Then on reconnect, briefly:
```
│  AEROSAR COMMAND CENTER          MISSION: search-01     ⟳ SYNCING...      │
```
then back to CONNECTED with the queued events now populated. This visual sequence is what makes Requirement 7 (offline resilience) *demonstrable*, not just claimed in a slide.

### 14.6 Build Order (cross-reference to Member 5's roadmap)

Confirms the sequencing already in Section 6.5: wireframe skeleton first (Day 1), WebSocket wiring with mock data second (Day 2), video + map panels next (Days 3–5), remaining panels (Days 6–8), real video stream + polish last (Days 9–10). Building in this order means that even if Member 5 runs out of time, whatever exists at any checkpoint is a complete-if-basic dashboard, not a half-wired one.

---

---

## SECTION 15 — Part 15: Simulation Scenarios

These 5 scenarios are what Member 6 builds test scripts against (Section 6.6, Days 8–9) and what the demo script (a later section) draws its live-run structure from. Each should exist as a saved/reloadable Webots world state or scripted sequence so it can be run repeatably, not improvised each time.

### Scenario 1 — Flood + Survivors

| Aspect | Detail |
|---|---|
| World setup | Terrain with a blue "flood" plane covering ~30% of the search area; 2 victim models placed at the edge of the flooded region |
| Drone starting position | Outside the flooded area, standard launch point |
| Mission | Autonomous search sweep covering the full area including over the flood |
| Expected detections | 2 person detections (thermal-confirmed), 1 flood hazard detection |
| Expected map | 2 survivor pins near the flood boundary, flood hazard zone shaded on map |
| Expected alerts | 2x SURVIVOR_DETECTED, 1x HAZARD_DETECTED (flood) |
| Expected rescue priority | Both survivors scored MEDIUM–HIGH depending on proximity to flood edge (per Part 11 formula) |
| Expected final result | Dashboard shows both survivors ranked, flood zone visible, mission completes with full coverage |

### Scenario 2 — Fire + Smoke + Survivor

| Aspect | Detail |
|---|---|
| World setup | 1 "fire" object + adjacent "smoke" particle/object, 1 victim model placed close (within ~5m) to the fire |
| Drone starting position | Standard launch point |
| Mission | Autonomous search sweep |
| Expected detections | 1 person detection (thermal-confirmed), 1 fire hazard, 1 smoke hazard |
| Expected map | Survivor pin very close to fire+smoke hazard zone |
| Expected alerts | SURVIVOR_DETECTED, 2x HAZARD_DETECTED, and — this is the key one — CRITICAL_PRIORITY alert given proximity |
| Expected rescue priority | CRITICAL (this is your worked-example scenario from Part 11 — use these exact numbers if convenient) |
| Expected final result | This should be your **primary demo scenario** — it's the clearest, most dramatic illustration of the full detect→fuse→score→alert pipeline working together |

### Scenario 3 — Collapsed Building + Survivor

| Aspect | Detail |
|---|---|
| World setup | A tilted/damaged "structure" model, 1 victim model placed partially near/under it |
| Drone starting position | Standard launch point |
| Mission | Autonomous search sweep, including navigating around the structure's debris footprint (tests obstacle avoidance) |
| Expected detections | 1 person detection, 1 damaged_structure hazard, possibly 1 debris hazard if separately modeled |
| Expected map | Survivor pin near/inside the structure hazard zone |
| Expected alerts | SURVIVOR_DETECTED, HAZARD_DETECTED (structure) |
| Expected rescue priority | HIGH–CRITICAL depending on hazard proximity weighting |
| Expected final result | Demonstrates obstacle avoidance (flying around/near the structure without collision) in addition to detection — good secondary scenario if time allows two scenarios in the demo |

### Scenario 4 — GPS-Denied Environment

| Aspect | Detail |
|---|---|
| World setup | A defined "GPS-denied zone" region (e.g. under/inside a structure) where GPS signal is programmatically cut |
| Drone starting position | Standard launch, flies toward and through the GPS-denied zone |
| Mission | Continue search pattern; demonstrate mode transition |
| Expected detections | Whatever survivors/hazards happen to be placed in or near the zone (optional — this scenario is primarily about the navigation behavior, not detection) |
| Expected map | Drone track shown continuing through the zone without a gap/freeze |
| Expected alerts | "GPS SIGNAL LOST" / "GPS SIGNAL RESTORED" (Part 10.4) |
| Expected rescue priority | N/A unless combined with a detection |
| Expected final result | Dashboard mode indicator visibly transitions GPS_NAV → GPS_DENIED → GPS_NAV; drone does not stop or crash during the transition (this holds regardless of which of the 3 navigation tiers from Part 10.3 you shipped) |

### Scenario 5 — Network Failure

| Aspect | Detail |
|---|---|
| World setup | No special world changes needed — this scenario is about the communication layer, not the physical environment |
| Drone starting position | Standard launch, mid-mission |
| Mission | Normal search, with Member 6's network-toggle mechanism triggered partway through |
| Expected detections | At least 1–2 detections should occur *during* the offline window specifically, to prove they're captured locally, not just before/after |
| Expected map | Detections that occurred offline appear on the map only after sync, correctly timestamped to when they actually happened (Part 13.6) |
| Expected alerts | "LINK_LOST" on cut, "LINK_RESTORED" on reconnect, plus the queued detection/hazard alerts appearing post-sync |
| Expected rescue priority | Unaffected — scoring happens on-drone regardless of connectivity |
| Expected final result | This is your **second-most-important demo scenario** alongside Scenario 2 — it's the clearest live proof of Requirement 7, and directly showcases the offline-first architecture from Part 13 |

### 15.1 Recommended Demo Combination

Given a 5–7 minute demo window (Part 20, later section), running all 5 scenarios separately is too long. Recommended: **combine Scenario 2 (fire+survivor+CRITICAL) and Scenario 5 (network failure) into a single continuous flight** — this is exactly what the original brief's suggested demo sequence does, and it's the right call: it shows the full pipeline (detect → fuse → score → alert) *and* offline resilience in one coherent narrative, without needing separate world reloads mid-demo.

Scenarios 1, 3, and 4 remain valuable as **testing scenarios** (Part 16, later section) even if not all shown live — they're what Member 6 runs repeatedly during Day 13 testing to build confidence the system behaves correctly across different conditions, even if the live demo itself only shows one combined narrative.

---

---

## SECTION 16 — Part 16: Testing Strategy

### 16.1 Testing Philosophy for a 14-Day Timeline

Full formal test coverage (unit tests for every function, integration tests for every pairwise interaction) is not realistic in this window. The right allocation of effort: **heavy testing on the exact demo path, light-but-present testing everywhere else.** A bug in a code path the demo never exercises costs you nothing on demo day; a bug in the demo path costs everything.

### 16.2 Test Categories and What They Actually Mean Here

| Category | What it covers | Owner | When |
|---|---|---|---|
| Unit tests | Risk-scoring formula, dedup logic, A* pathfinding (if built) | Whoever owns the module (self-tested) | As each module is built, Days 3–11 |
| Integration tests | Two-module interactions (e.g. perception→fusion, backend→dashboard) | Module owners, pairwise | As modules connect, Days 5–11 |
| AI tests | Detection accuracy on recorded flight footage | Member 2 | Days 5–10 |
| Navigation tests | Coverage %, obstacle avoidance triggers, GPS-loss transition | Member 3 | Days 5–11 |
| Sensor tests | Topic publish rate/type correctness | Member 1 | Days 3–6 |
| ROS tests | `rqt_graph` matches spec, no orphaned topics | Member 1 + Member 6 | Days 5, 12 |
| Communication tests | WebSocket connect/disconnect/reconnect behavior | Member 4 + Member 6 | Days 8–9, 12 |
| Offline tests | Full Scenario 5 sequence, event ordering correctness | Member 4 + Member 6 | Days 9, 13 |
| Performance tests | FPS, detection latency, dashboard update latency (targets in Part 17, later section) | Member 6 | Day 13 |
| End-to-end tests | All 5 scenarios (Part 15) run start to finish | Member 6 (leads), all support | Day 13 |

### 16.3 Test Matrix Template

Use this exact format for tracking — simple enough to fill in live during Day 13 testing without slowing the team down:

| TEST | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---|---|---|---|
| Person detection on Scenario 2 flight | Survivor detected within 3s of entering camera FOV | _(fill during testing)_ | |
| Thermal confirmation on Scenario 2 | `thermal_confirmed=true` on the detection | | |
| Fire hazard detection on Scenario 2 | Hazard published within 3s of entering FOV | | |
| Risk score on Scenario 2's survivor | Score ≥ 0.75 (CRITICAL) | | |
| Alert fired on CRITICAL detection | Alert appears on dashboard within 1s of score computation | | |
| Map pin location accuracy | Pin within acceptable tolerance (e.g. 2m) of actual model position | | |
| Network cut mid-mission (Scenario 5) | Dashboard shows OFFLINE within 5s | | |
| Detection during offline window | Detection logged locally, not lost | | |
| Network restore | Dashboard shows SYNCING then CONNECTED, queued events appear correctly ordered | | |
| Obstacle avoidance (Scenario 3) | Drone alters path within 2m of obstacle, no collision | | |
| GPS-loss transition (Scenario 4) | Dashboard mode indicator updates, drone continues moving (any tier) | | |
| GPS-restore transition (Scenario 4) | Mode indicator reverts to GPS_NAV | | |
| Full combined demo run (Scenario 2+5) | End-to-end sequence completes without manual intervention | | |
| Repeat full demo run x5 | ≥4/5 clean runs (per Section 5.2 Phase 21 target) | | |

Expand this table with rows specific to your actual build as Days 1–11 progress — this template is the minimum starting set, not exhaustive.

### 16.4 Bug Triage Priority (for Day 12–13 when time is short)

When integration reveals more bugs than can all be fixed:

```
Priority 1 (must fix): anything that breaks the exact demo script sequence
Priority 2 (should fix): anything visible on the dashboard during the demo,
                          even if outside the core sequence (e.g. a panel
                          showing stale/wrong data)
Priority 3 (fix if time): anything in a code path the demo never exercises
Priority 4 (log and ignore): cosmetic issues, edge cases outside demo scope
```

Member 6 should own making this triage call in real time on Day 12–13 rather than letting the whole team debate every bug — speed of decision-making matters more than perfect prioritization with 2 days left.

---

---

## SECTION 17 — Part 17: Performance Targets

**Rule for this whole section:** every target below is a **prototype target** — realistic for a 14-day student build running mostly on dev laptops in simulation. None of these should be confused with production/military-grade specifications, and your submission should state that distinction explicitly rather than let judges assume otherwise.

| Metric | Prototype target | Production target (stated for contrast only — not a commitment) | Notes |
|---|---|---|---|
| Detection latency (frame → published detection) | ≤ 500ms | ≤ 100ms | Sim-phase latency includes non-optimized Python inference; acceptable for demo purposes |
| Inference FPS | 5–10 FPS | 30+ FPS | Real-time-*enough* for a slow-moving search drone; not video-game-smooth |
| AI confidence threshold | 0.5 (person) | Tuned per deployment environment | See Part 8.4 |
| Navigation update rate | 5–10 Hz (`cmd_vel` publish rate) | 50+ Hz | Sufficient for a simulated quadrotor at demo speeds |
| Map update rate | On-event (not fixed Hz) | Continuous streaming | Event-driven updates are actually more honest/useful than fake continuous updates for a mostly-static disaster map |
| Alert latency (detection → dashboard alert visible) | ≤ 2s | ≤ 500ms | Includes WebSocket round-trip; still feels "live" to a human observer |
| Offline storage capacity | Hours of typical mission events on SQLite (trivial at this data volume) | Enterprise-grade distributed storage | Not a meaningful constraint at prototype scale — don't over-engineer this |
| Battery simulation | Simple linear drain model tied to mission time | Real battery discharge curve modeling | A linear model is honest and sufficient — don't fake sophistication here |
| Mission completion (coverage) | ≥ 80% of defined search area per run | Near-100% with redundancy/multi-pass | 80% is a reasonable, defensible target for a fixed serpentine pattern |
| False positive rate (person detection) | Not rigorously measured — acceptable qualitative statement: "rare in the demo scenarios, deterministic hazards have zero false positives by design" | Formally measured against a validation set with confusion matrices | Don't claim a numeric FP rate you haven't actually measured — an honest qualitative statement is more credible than a fabricated number |

### 17.1 Why Stating This Distinction Explicitly Helps You

SIH judges evaluate prototypes, not shipped products (this is directly acknowledged in Part 21's judge-perspective analysis, later section). A team that says "our detection latency is 500ms in simulation; a production deployment on optimized edge hardware would target under 100ms" reads as more technically mature than a team that either (a) doesn't mention latency at all, or (b) claims production-grade numbers they clearly haven't measured. Precision about what's real vs. aspirational is itself a credibility signal.

---

---

## SECTION 18 — Part 18: GitHub / Software Development Plan

### 18.1 Repository Structure

```
aerosar/
├── worlds/                  # Webots .wbt world files          (Member 1)
├── drone_description/       # drone model/controller config     (Member 1)
├── aerosar_msgs/             # shared custom ROS 2 message defs  (all, but Member 1 gatekeeps changes)
├── perception/                # AI nodes: person, hazard, fusion  (Member 2)
├── navigation/                 # nav/SLAM nodes                    (Member 3)
├── backend/                    # FastAPI, WebSocket, DB, scoring   (Member 4)
├── frontend/                    # React dashboard                   (Member 5)
├── launch/                      # combined launch files              (Member 6)
├── scripts/                      # network-toggle, test scripts, demo utilities (Member 6)
├── docs/                          # this document + any submission materials
└── README.md
```

### 18.2 Branching Strategy

```
main       ── always demo-able; only merged into on Day 12+ integration, and
              only from develop after a successful integration test
develop    ── integration branch; each feature branch merges here once its
              owner considers it "done enough to test with others"
feature/webots
feature/ai
feature/navigation
feature/backend
feature/dashboard
feature/integration   (Member 6's launch files, scripts, test infra)
```

**Rule: no one merges directly to `main` except Member 6, and only after Day 12 integration testing passes.** Before that, `main` should simply mirror the last known-good `develop` state, or stay untouched — for a 14-day sprint with 6 people, protecting one branch as "the thing that always works" is worth the small friction of an extra merge step.

### 18.3 Commit Strategy

- Small, frequent commits over large infrequent ones — easier to bisect if something breaks during integration.
- Commit message format: `[module] short description` (e.g. `[perception] add confidence threshold filter`) — trivial to enforce, makes the history scannable when six people are committing in parallel.

### 18.4 Pull Request Strategy

For a 14-day sprint, **full PR review for every commit is unrealistic and would slow the team down more than it helps.** Recommended lightweight process:
- PRs required only for merges into `develop` (not for every commit within a feature branch).
- One other team member skims the PR (not a deep review) — mainly to catch obvious topic-name/interface mismatches against the Part 7 spec, which is the failure mode most worth catching early.
- No PR is required to touch `aerosar_msgs/` without at least a heads-up to the whole team — this is the one shared contract everyone depends on.

### 18.5 Issue Labels

```
type:bug            type:feature         type:integration
priority:blocker    priority:high        priority:normal
member:1  member:2  member:3  member:4  member:5  member:6
scope:mvp  scope:l2  scope:l3-stretch
```

The `scope:` labels directly mirror the Level 1/2/3 distinction from Section 2 — this makes it trivial to filter "what's actually required" vs. "what's a stretch goal" when triaging issues under time pressure on Day 12–13.

### 18.6 Milestones

```
Milestone 1: "Stage 0 complete" — due end of Day 2 (env + spec locked)
Milestone 2: "Level 1 complete" — due end of Day 6
Milestone 3: "Level 2 complete" — due end of Day 11
Milestone 4: "Integrated + tested" — due end of Day 13
Milestone 5: "Demo ready" — due end of Day 14
```

### 18.7 Integration Strategy

Directly reflects Section 5's stage structure: feature branches develop independently against the locked Part 7 interface spec through Day 11, converge into `develop` continuously (not saved up for one big merge), and Day 12 is reserved specifically for resolving whatever integration issues remain after that continuous merging — not for merging everything for the first time. **Continuous integration into `develop` throughout Days 3–11, not a "big bang" merge on Day 12, is the single most important process discipline for this timeline** — the alternative (everyone integrates for the first time on Day 12) is a well-known way for student teams to lose their last two days to interface bugs that could have been caught days earlier.

---

---

## SECTION 19 — Part 19: Daily Scrum Plan

### 19.1 Daily 15-Minute Scrum Format

Same time every day (recommend first thing, before anyone starts heads-down work). Each member answers, in under 90 seconds each:

```
1. What did I complete (since yesterday's scrum)?
2. What am I working on today?
3. What is blocking me?
4. What integration do I need from someone else today?
```

**Facilitation note:** Member 6 should run this, and its only job is surfacing blockers — not solving them live. If question 3 or 4 reveals something that needs real discussion, take it offline immediately after the 15 minutes, don't let the scrum turn into a 45-minute meeting. This matters more with 14 days than it would with a longer timeline — meeting time is a real cost you can't afford to lose repeatedly.

### 19.2 Weekly Review Checklist

Given the 14-day window, "weekly" effectively means an **end-of-Week-1 checkpoint (Day 6/7)** and an **end-of-Week-2 checkpoint (Day 12)**:

**End of Week 1 checklist (should align with "Level 1 complete," Section 5.1):**
```
[ ] Drone flies autonomously in Webots
[ ] Camera/IMU/GPS topics all live and correctly typed
[ ] Person detection working on live feed
[ ] At least one deterministic hazard detected
[ ] Detections geotagged (even roughly)
[ ] Basic map/log showing detection locations
[ ] Basic alert mechanism (even console output) working
[ ] No member is more than 1 day behind their roadmap without a team-known plan to catch up
```

**End of Week 2 / pre-integration checklist (should align with "Level 2 complete," Section 5.1):**
```
[ ] Thermal fusion working (sim-based)
[ ] Autonomous search pattern + obstacle avoidance working
[ ] Multi-class hazard detection working
[ ] Risk scoring producing correct LOW/MED/HIGH/CRITICAL labels
[ ] Dashboard showing all 8 required elements, wired to real data
[ ] Offline local storage working
[ ] Sync-on-reconnect working (or explicitly descoped per Part 13/Section 2 rules)
[ ] Combined launch sequence exists and has been test-run at least once
[ ] Team has explicitly decided go/no-go on each Level 3 stretch item
      (SLAM, safe route) per the Day 8/10 decision points in Section 6
```

### 19.3 If the Weekly Checklist Reveals Slippage

Be explicit about this now rather than discovering it under pressure on Day 12: if the End of Week 1 checklist has unchecked items going into Week 2, **the correct response is cutting Level 3 stretch items immediately, not compressing Level 2 work into less time.** Section 6.0 already identifies Member 4 as the most likely bottleneck and names Member 6 as the pressure-relief valve — this is the point in the timeline where that plan should actually activate if needed, not be revisited from scratch.

---

---

## SECTION 20 — Part 20: Final Demonstration

### 20.1 Demo Structure (5–7 minutes, built on Scenario 2 + Scenario 5 combined per Section 15.1)

```
0:00–0:30   Setup: brief context ("disaster site, rescue team needs situational
            awareness before entering")
0:30–1:00   Drone launches, autonomous search begins — dashboard visible
1:00–2:00   Drone approaches survivor near fire — detection occurs live
2:00–2:45   Thermal confirmation shown (RGB/thermal toggle on dashboard),
            fire+smoke hazard detected, CRITICAL priority assigned with
            reason string shown
2:45–3:15   Map updates live: survivor pin + hazard zone + (if built) safe route
3:15–3:45   Network cut triggered — dashboard shows OFFLINE, narrate that
            the drone keeps working
3:45–4:15   Drone continues, detects something during the offline window
            (per Section 15's Scenario 5 requirement)
4:15–4:45   Network restored — SYNCING, then all events appear correctly
            ordered
4:45–5:15   Final dashboard state: full situational picture, mission summary
5:15–6:00   (buffer / Q&A lead-in) — wrap narration, invite judge questions
```

Stay within 5–7 minutes even if you have extra material ready — judges consistently respond better to a tight, well-rehearsed demo than a longer one padded with lower-value content.

### 20.2 Narration Script (adapt to your team's voice — this is a starting draft, not a script to read verbatim)

> "This is AEROSAR — an autonomous drone for search and rescue, built for PS 26177. A disaster's just occurred, and the rescue team has launched the drone to get situational awareness before sending people in.
>
> The drone is now flying an autonomous search pattern — no manual control, no GPS commands from us right now. It's running its own coverage pattern over the affected area.
>
> [pause as drone approaches survivor] Here — the drone's on-device AI has just detected a person. That detection is happening entirely on local compute, no cloud involved. You can see the RGB detection here — and if I switch to the thermal view, you'll see the heat signature that confirms this is a real person, not a false positive.
>
> The system's also picked up a fire and smoke nearby. Because this survivor is close to an active hazard, the risk-scoring engine has assigned CRITICAL priority — and you can see exactly why: high detection confidence, thermal-confirmed, and proximity to the fire. This isn't a black box — every score comes with a plain-language reason.
>
> The map's updating live — survivor location, hazard zone, all geotagged automatically using the drone's own IMU and GPS.
>
> Now — disaster environments don't have reliable connectivity. So we're going to cut the network right now. [trigger cut] You can see the dashboard go offline — but the drone doesn't stop. It's still detecting, still scoring, still logging everything locally. [wait for a detection during the offline window] That detection just happened while we were offline, and it's not lost.
>
> [trigger reconnect] And now we restore the connection — the system syncs everything that happened while offline, in the correct order, with the correct timestamps. Nothing was lost.
>
> This is AEROSAR: on-device AI, multi-sensor fusion, explainable risk scoring, and offline-first design — built to work in exactly the conditions a real disaster response team would face."

### 20.3 What Makes This Sequence Effective (for your team's own understanding, not to say aloud)

- It touches **6 of the 8 official PS requirements visibly** (on-device AI, multi-sensor fusion, hazard classification, geo-tagged mapping, emergency alerting, offline resilience) within one continuous narrative rather than jumping between disconnected demos.
- The CRITICAL priority moment and the offline moment are your two strongest "wow" beats — both are placed deliberately, not buried.
- It never claims more than what's actually built — narration should be adjusted based on which navigation tier (Part 10.3) and whether safe-route (Part 12.5) actually shipped, so nothing said aloud contradicts what's on screen.

### 20.4 Backup Plan

Per Member 6's Day 14 responsibilities (Section 6.6): a screen-recorded backup of a clean successful run should exist before demo day, in case live conditions (Wi-Fi issues at the venue, a Webots crash, timing pressure) prevent a clean live run. If the live demo has to fall back to the recording partway through, having it ready and cued up is far better than losing the whole demo slot to a technical failure.

---

---

## SECTION 21 — Part 21: Judge Perspective

*Acting as an SIH judge evaluating this proposed solution.*

### 21.1 Evaluation Against Standard Criteria

| Criterion | Assessment | Reasoning |
|---|---|---|
| Innovation | Moderate-High | The transparent, explainable risk-scoring with reason strings (Part 11) and the offline-first architecture (Part 13) are genuinely thoughtful design choices, not just checkbox features — most student teams under-invest in explainability and offline handling |
| Technical feasibility | High, for the scoped Level 2 | The honest three-tier approach (full/simplified/demo-only) throughout this document means what's claimed matches what's actually achievable in 14 days — this is itself a feasibility strength, not a weakness |
| Social impact | High | Directly addresses a real, well-documented gap (rapid situational awareness in the critical first hours of disaster response in India) |
| Scalability | Moderate | Architecture is modular and hardware-agnostic (Part 1.3), which is the right foundation for scaling, but the prototype itself doesn't demonstrate multi-drone or large-area scale — acceptable for hackathon scope, worth acknowledging as future work |
| Cost | Strong | The "simulate first, buy nothing until proven" hardware philosophy (Part 2) keeps this realistic and low-cost, and is worth stating explicitly in the pitch as a strength, not hiding as a limitation |
| Hardware feasibility | Strong for MVP, honest about limits | Deliberately doesn't overclaim real hardware integration within 14 days — the sim-to-real path is designed but explicitly not executed, which is more credible than a rushed, likely-broken hardware demo |
| AI novelty | Low-Moderate | Using pretrained YOLO for person detection and deterministic tagging for hazards is not novel AI research — but this is the *correct* choice for a 14-day prototype, and judges evaluating "AI novelty" for an SIH hackathon (not a research paper) should weight practical execution over algorithmic originality |
| Real-world applicability | Moderate | Strong conceptual applicability; actual real-world deployment would require significant additional work (real thermal camera calibration, robust SLAM, hardware ruggedization) that is explicitly out of scope here |
| Demo quality | Depends entirely on execution | The demo script (Part 20) is designed to be dramatic and clear if rehearsed — this criterion is about your team's execution on Day 14, not the design |
| Problem-statement alignment | Strong | Section 1's requirement-to-feature mapping traces every official PS bullet to a specific implementation — this is exactly the kind of explicit alignment judges reward, since many teams drift from the actual PS text |

### 21.2 Weak Points and Risks

- **AI is largely not "real" AI for hazards** (deterministic tagging, per Part 8). A technically sharp judge will notice this if they look closely at your hazard pipeline. Mitigation: be upfront about it rather than hoping it goes unnoticed — Part 8.2's honesty framing is your best defense here.
- **SLAM/GPS-denied navigation is likely to be a scripted/simplified fallback**, not real localization (Part 10.3). Same mitigation: don't overclaim.
- **No real hardware demonstrated.** Some SIH judges specifically favor teams with a physical prototype, even a rough one. This is a real risk that simulation-only prototypes face regardless of software quality.
- **Safe-route planning may not ship** (Part 12.5) — one of the PS's explicitly-listed "expected solution" elements might be design-only, not demonstrated.

### 21.3 Features That Look Impressive But Provide Little Value (avoid over-investing here)

- Extra dashboard panels beyond the PS's 8 required elements (flagged already in Part 14.3) — adds visual complexity without addressing a requirement.
- Elaborate 3D-rendered/photorealistic Webots world — visually nice but doesn't move any evaluation criterion; time is better spent on functional correctness.
- Multi-drone support (already flagged as low-priority in Section 2's Level 3) — sounds impressive in a pitch but isn't asked for by the PS and risks destabilizing the core single-drone demo if attempted.
- Numeric precision that isn't backed by real measurement (e.g. fake FPS/accuracy stats) — judges who probe with a follow-up question will catch this, and it damages credibility more than admitting a simpler truth would.

### 21.4 Features Judges Will Likely Appreciate

- The explainable risk-scoring reason strings (Part 11.6) — concrete, demonstrable "AI you can trust" narrative.
- The offline-first demo moment (Part 13.8/20.1) — directly, visibly proves a PS requirement rather than just claiming it in a slide.
- Explicit, honest scoping (Level 1/2/3 distinction, three-tier implementation rule) — signals engineering maturity uncommon in student submissions, which tend to either overclaim or under-explain their limitations.
- The sim-to-hardware architectural story (identical ROS 2 graph regardless of sensor source) — a genuinely good answer to "how would this actually get deployed," which is a question judges often ask.

### 21.5 Improvements That Increase Winning Potential Without Much Added Complexity

1. **Prepare the honest-limitations answer in advance** for each weak point above — a team that answers "is this real SLAM?" with a calm, accurate explanation of what's simulated vs. real looks far stronger than one that gets caught off guard.
2. **Lead the pitch with the requirement-to-feature mapping (Section 1)** — opening with "here's exactly how we address each line of the official PS" is a strong, low-effort framing device that immediately signals rigor to judges skimming many submissions.
3. **Show the worked risk-score example (Part 11.7) in your slides**, not just live in the demo — a concrete number trail is memorable and reviewable after your demo slot ends, when judges are comparing notes.
4. **If SLAM doesn't ship, show the architecture diagram for it anyway** (Part 10.3) with a clear "designed, not implemented in this timeline" label — partial credit for design thinking is real and worth claiming explicitly rather than silently.

---

---

## SECTION 22 — Master Timeline (All 6 Members, Combined)

| Day | M1 (Drone/ROS) | M2 (AI) | M3 (Nav) | M4 (Backend) | M5 (Dashboard) | M6 (Integration) |
|---|---|---|---|---|---|---|
| 1 | Install, repo, draft spec | Install YOLO/CV tools | Review spec (in progress) | FastAPI skeleton, DB schema | React scaffold, wireframe | Repo structure, branch rules |
| 2 | Base world, drone spawn, **lock spec** | Node skeleton (stub) | Confirm spec, waypoint node start | WebSocket + mock data | Wireframe + WS mock connect | Float support (spec lock) |
| 3 | Camera/IMU/GPS nodes | Wire to real camera, first detections | Fixed-path flight via cmd_vel | Wire real detection/hazard topics | Video panel (placeholder) | Build network-toggle mechanism |
| 4 | Thermal-proxy cam, placeholder hazards | Deterministic hazard detector | Serpentine search pattern | Geotagging logic | Map panel (dummy pins) | Network-toggle mechanism (cont.) |
| 5 | Support M3 (cmd_vel wiring) | Person detection finalized | Reactive obstacle avoidance | Risk-scoring v1 | Map wired to real data | Float support (whoever's behind) |
| 6 | Buffer/bugfix, `rqt_graph` check | Thermal-confirmation logic starts | Tune coverage + avoidance | Priority sorting endpoint | Alert feed + mission status panels | Float support + begin test scripts |
| **~Wk1** | **World+drone+sensors+spec done** | **Person+hazard detection solo-working** | **GPS search+avoidance working** | **Backend+geotag+scoring v1** | **Wireframe+video+map wired** | **Toggle built, test scripts started** |
| 7 | Support M3/M6 | Fusion node v1 (+geotag handoff w/ M4) | Buffer/bugfix | Fusion handoff coordination | Priority list panel | Draft 5 demo scenarios |
| 8 | Support M3/M6 | Dedup logic | **SLAM go/no-go decision** | Offline local queue | Hazard markers, connectivity indicator | Continue scenario drafting |
| 9 | Support M3/M6 | Ahead: fine-tune / Behind: polish | SLAM stretch (if "go") | Sync engine (reconnect) | Real video stream wiring | Continue float support |
| 10 | Support M3/M6 | Bugfix, accuracy tuning | SLAM stretch (cont.) | **Route go/no-go decision** | Polish pass, judge-readability | Prep combined launch file |
| 11 | Support M3/M6 | **Freeze AI pipeline** | **Freeze nav** (GPS fallback confirmed) | **Freeze backend** | **Freeze dashboard** | Finish combined launch file |
| **~Wk2 pre-int** | | | | | | **Level 2 complete — pre-integration checklist run** |
| 12 | **Full integration (all hands)** | Integration support | Integration support | Integration support (highest bug-risk seam) | Integration support | **Lead integration, triage bugs** |
| 13 | Testing support | Testing support | Testing support | Testing support | Testing support | **Lead testing, run test matrix** |
| 14 | Demo rehearsal (operates Webots) | Demo rehearsal (narrates AI) | Demo rehearsal (narrates nav) | Demo rehearsal (narrates scoring/offline) | Demo rehearsal (owns screen) | **Lead rehearsal, record backup video** |

**Critical path callouts visible in this view:**
- **Day 2** is the single highest-risk day — everything downstream depends on the spec lock happening on schedule.
- **Days 8 and 10** are explicit go/no-go decision points (SLAM, safe-route) — these are calendared, not left to drift.
- **Day 11** is a hard freeze across AI/nav/backend/dashboard simultaneously — this is what makes Day 12 integration tractable rather than chaotic.
- **Member 6's load is visibly back-loaded** — light float-support role for 9 days, then sole ownership of the three highest-stakes days.

---

## SECTION 23 — Final "Build This First" Checklist

This is the checklist to pin somewhere visible for the whole team. Ordered by actual build priority, not by the original brief's part numbering — if your team can only get through part of this list, stop wherever you are and you'll still have a demoable system at every checkpoint.

### Absolute Foundation (Days 1–2 — nothing else can start without this)
```
[ ] Webots + ROS 2 installed on every laptop
[ ] Shared Git repo created with branch structure
[ ] ROS 2 topic/message spec (Section 7) drafted and LOCKED by all 6 members
[ ] Basic Webots world with drone spawned
```

### Level 1 — Minimum Working Prototype (target: Day 6)
```
[ ] Drone flies a fixed path autonomously
[ ] Camera/IMU/GPS topics live and correctly typed
[ ] Person detection working on live Webots feed (pretrained YOLO, zero training)
[ ] One deterministic hazard detected
[ ] Detections geotagged (even roughly)
[ ] Basic map/log of detection locations
[ ] Basic alert output (console acceptable at this stage)
```

### Level 2 — Strong SIH Prototype (target: Day 11)
```
[ ] Simulated thermal fusion (RGB + thermal-proxy → confirmed detection)
[ ] Autonomous search pattern (not just fixed path)
[ ] Basic reactive obstacle avoidance
[ ] Multi-class hazard detection (deterministic, all 4–6 classes)
[ ] Risk-scoring engine with LOW/MED/HIGH/CRITICAL + reason string
[ ] Rescue-priority ranked list
[ ] Full dashboard — all 8 Requirement-8 elements wired to real data
[ ] Offline local storage (drone continues logging without link)
[ ] Sync-on-reconnect (or explicitly descoped, per Part 13/Section 2)
```

### Level 3 — Stretch Only (attempt only if Level 2 checklist above is 100% done early)
```
[ ] GPS-denied navigation (real SLAM — highest-priority stretch item)
[ ] Safe-route planning (A* over hazard costmap)
[ ] Advanced weighted sensor fusion
[ ] Mission replay
[ ] Edge optimization / measured FPS improvement
```

### Integration & Demo Readiness (Days 12–14 — non-negotiable, not optional)
```
[ ] Single combined launch sequence brings up entire system
[ ] All 5 test scenarios (Part 15) run at least once each
[ ] Demo scenario (Scenario 2 + 5 combined) runs cleanly 5x in a row, ≥4/5 pass
[ ] Backup demo video recorded
[ ] Every member can narrate their own portion of the demo script
[ ] Member 6 can narrate any portion if someone is unavailable
[ ] Requirement-to-feature mapping (Section 1) ready as opening pitch material
[ ] Honest answers prepared for each weak point in Part 21.2 (SLAM, deterministic
    hazards, no real hardware, route planning status)
```

### The One Rule That Matters Most
**If forced to choose between adding one more feature and rehearsing the existing demo one more time in the final two days — always choose rehearsal.** A judge remembers a smooth, confident 6-minute demo of a Level 2 system far more favorably than a stumbling demo of a system that technically has more features.

---

*Document complete. This master document covers Parts 1–22 of the original brief, restructured and scoped for a realistic 14-day, 6-person build targeting Level 2 as the committed deliverable with Level 3 as explicit, calendared stretch goals. Good luck with AEROSAR.*
