# AEROSAR — Canonical ROS 2 Topic & Interface Specification

> **Status:** LOCKED (Day 2 Interface Contract)  
> **Owner:** Member 6 (Integration Lead) & Member 1 (Sim & ROS 2 Lead)

This document specifies the exact topic names, custom message types, frequencies, and publisher/subscriber assignments across all 6 subsystems. **No topic name or message field may be changed without explicit team sign-off.**

---

## Custom Message Definitions (`aerosar_msgs`)

- [`Detection.msg`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/aerosar_msgs/msg/Detection.msg)
- [`Hazard.msg`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/aerosar_msgs/msg/Hazard.msg)
- [`RiskScore.msg`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/aerosar_msgs/msg/RiskScore.msg)
- [`Alert.msg`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/aerosar_msgs/msg/Alert.msg)
- [`MissionStatus.msg`](file:///Users/admin/Desktop/Sih/aerosar-sih-2026/aerosar_msgs/msg/MissionStatus.msg)

---

## Master ROS 2 Topic Matrix

| Topic Name | Message Type | Publisher | Subscriber(s) | Expected Frequency | Description |
|---|---|---|---|---|---|
| `/camera/image_raw` | `sensor_msgs/Image` | Member 1 (Webots) | Member 2 (AI) | ~15–30 Hz | Primary RGB video feed |
| `/thermal/image_raw` | `sensor_msgs/Image` | Member 1 (Webots) | Member 2 (AI) | ~10 Hz | Heat-mapped proxy camera feed |
| `/imu/data` | `sensor_msgs/Imu` | Member 1 (Webots) | Member 2 (Fusion), Member 3 (Nav) | ~50 Hz | IMU orientation & acceleration |
| `/gps/fix` | `sensor_msgs/NavSatFix` | Member 1 (Webots) | Member 2 (Fusion), Member 3 (Nav), Member 4 (Backend Bridge) | ~5–10 Hz | GNSS coordinates (toggled for GPS-denied tests) |
| `/lidar/points` | `sensor_msgs/PointCloud2` | Member 1 (Webots, L3) | Member 3 (SLAM) | ~10 Hz | Optional pointcloud for L3 SLAM |
| `/perception/person` | `aerosar_msgs/Detection` | Member 2 (AI) | Member 2 (Internal Fusion) | Event-driven | Pre-fusion candidate person detection |
| `/perception/hazard` | `aerosar_msgs/Hazard` | Member 2 (AI) | Member 4 (Backend Bridge) | Event-driven | Classified disaster hazard |
| `/perception/detection` | `aerosar_msgs/Detection` | Member 2 (Fusion) | Member 4 (Backend Bridge) | Event-driven | Confirmed, geotagged, deduplicated detection |
| `/navigation/cmd_vel` | `geometry_msgs/Twist` | Member 3 (Nav) | Member 1 (Webots Controller) | ~20 Hz | Drone velocity command |
| `/rescue/risk_score` | `aerosar_msgs/RiskScore` | Member 4 (Backend) | Member 4 (DB/Queue), Member 5 (Dashboard) | Event-driven | Priority score & explainable reason string |
| `/alerts/emergency` | `aerosar_msgs/Alert` | Member 4 (Backend) | Member 5 (Dashboard) | Event-driven | Push alerts for UI feed |
| `/mission/status` | `aerosar_msgs/MissionStatus` | Member 1 / Member 6 | Member 4 (Backend), Member 5 (Dashboard) | ~1 Hz | Telemetry, battery, coverage, link status |

---

## Backend & Dashboard Seam (WebSocket Schema)

* **Endpoint:** `ws://localhost:8000/ws/live`
* **JSON Payload Types:** `detection`, `hazard`, `alert`, `mission_status`, `sync_event`
* **Offline Protocol:** Drone writes to local SQLite queue `events` table unconditionally. On reconnection, sync engine drains queue ordered by `created_at` timestamp.
