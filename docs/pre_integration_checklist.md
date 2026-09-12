# AEROSAR — Pre-Integration Handoff Checklist (Day 11)

> **Owner:** Member 6 (Integration Lead)  
> **Target Date:** End of Day 11  
> **Purpose:** Ensure all 6 subsystem packages are ready for Day 12 Full System Integration.

---

## Subsystem Handoff Checklist

### Member 1 — Drone Simulation & ROS 2 (`drone_description/` & `worlds/`)
- [ ] Webots disaster world file (`.wbt`) loads without missing texture errors.
- [ ] Drone model publishes `/camera/image_raw` (~15-30 Hz) and `/thermal/image_raw` (~10 Hz).
- [ ] `/imu/data` (~50 Hz) and `/gps/fix` (~5-10 Hz) publish valid timestamps.
- [ ] Drone controller responds correctly to `/navigation/cmd_vel` velocity commands.

### Member 2 — AI Perception & Fusion (`perception/`)
- [ ] Person detector node subscribes to `/camera/image_raw` and publishes candidate detections.
- [ ] Deterministic hazard detector publishes `/perception/hazard` messages.
- [ ] Sensor fusion node combines RGB + Thermal proxy, attaches IMU/GPS pose, deduplicates, and publishes `/perception/detection`.

### Member 3 — Autonomous Navigation (`navigation/`)
- [ ] Lawnmower/serpentine search pattern node publishes `/navigation/cmd_vel`.
- [ ] Reactive obstacle avoidance stops/yaws drone when obstacle detected within 2 meters.
- [ ] GPS-loss transition handler switches navigation mode cleanly to `GPS_DENIED`.

### Member 4 — Backend & Risk Engine (`backend/`)
- [ ] ROS 2 to FastAPI/WebSocket bridge node subscribes to `/perception/detection` and `/perception/hazard`.
- [ ] Risk scoring engine calculates LOW/MED/HIGH/CRITICAL priority and generates plain-text reason strings.
- [ ] Local SQLite queue logs events when offline and syncs in timestamp order upon reconnection.

### Member 5 — Command Center Dashboard (`frontend/`)
- [ ] React UI connects to `ws://localhost:8000/ws/live`.
- [ ] Live video feed panel, disaster Leaflet map, alert feed, mission status, and ranked survivor priority list render without UI crash.
- [ ] Top bar correctly displays `CONNECTED`, `OFFLINE`, and `SYNCING` states.

### Member 6 — Integration Lead (`launch/` & `scripts/`)
- [ ] All 5 disaster scenarios verified using [`run_all_tests.py`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/scripts/run_all_tests.py).
- [ ] Master launch file [`aerosar_system.launch.py`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/launch/aerosar_system.launch.py) tested.
- [ ] Demo controller [`demo_controller.py`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/scripts/demo_controller.py) verified for presentation day.
