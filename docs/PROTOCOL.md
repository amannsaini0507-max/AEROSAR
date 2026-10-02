# AEROSAR WebSocket & Telemetry Protocol Specification (v1)

This document specifies the real-time communication protocol between the AEROSAR backend server and connected dashboard clients via `/ws/live`.

## 1. Versioned Message Envelope

Every WebSocket message exchanged on `/ws/live` is wrapped in a versioned envelope:

```json
{
  "v": 1,
  "type": "string",
  "seq": 1042,
  "sim_time": 12.35,
  "payload": {}
}
```

Envelope Fields:
| Field | Type | Required | Description |
|---|---|---|---|
| `v` | integer | Yes | Protocol version. MUST be 1. Messages with unknown versions are rejected. |
| `type` | string | Yes | Message type identifier indicating the schema of `payload`. |
| `seq` | integer | Yes | Monotonically increasing sequence number assigned by the sender. |
| `sim_time` | float | Yes | Simulation or mission elapsed time in seconds from mission start. |
| `payload` | object | Yes | The type-specific structured data object. |

---

## 2. Server-to-Client Messages

### 2.1 telemetry
High-frequency vehicle state broadcast (~30 Hz in normal mode, ~15 Hz in low-power mode).

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `latitude` | float | Current vehicle latitude (WGS84 decimal degrees). |
| `longitude` | float | Current vehicle longitude (WGS84 decimal degrees). |
| `altitude` | float | Height above ground level (meters AGL). |
| `heading_deg` | float | Compass heading in degrees (0.0 - 359.9). |
| `speed_mps` | float | Ground speed in meters per second. |
| `gps_fix` | boolean | True if GPS signal is healthy, False if GPS-denied. |
| `battery_percent` | float | Current remaining battery charge (0.0 - 100.0). |
| `flight_mode` | string | Current mode: AUTO_SEARCH, MANUAL, PAUSED, RTL, EMERGENCY_LAND. |

### 2.2 detection
Emitted whenever a survivor candidate is detected, verified, and geotagged.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `id` | string | Unique detection identifier (e.g., "det-01"). |
| `detection_type` | string | Object class: "person". |
| `confidence` | float | Detection confidence score (0.0 - 1.0). |
| `bbox_x` | float | Normalized bounding box center X (0.0 - 1.0). |
| `bbox_y` | float | Normalized bounding box center Y (0.0 - 1.0). |
| `bbox_w` | float | Normalized bounding box width (0.0 - 1.0). |
| `bbox_h` | float | Normalized bounding box height (0.0 - 1.0). |
| `thermal_confirmed` | boolean | True if confirmed via thermal camera signature. |
| `status` | string | Verification status: "UNCONFIRMED", "VERIFYING", "CONFIRMED", "REJECTED". |
| `latitude` | float | Calculated survivor latitude. |
| `longitude` | float | Calculated survivor longitude. |
| `altitude` | float | Terrain elevation at detection point. |
| `stamp` | object/string | Detection timestamp { sec, nanosec } or ISO string. |

### 2.3 hazard
Emitted whenever a environmental disaster hazard is classified.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `id` | string | Unique hazard identifier (e.g., "haz-fire-01"). |
| `hazard_type` | string | Class: "fire", "smoke", "flood", "debris", "damaged_structure", "landslide". |
| `confidence` | float | Classification confidence (0.0 - 1.0). |
| `latitude` | float | Hazard center latitude. |
| `longitude` | float | Hazard center longitude. |
| `radius_m` | float | Hazard influence radius in meters (default 8.0 m). |
| `stamp` | object/string | Timestamp of detection. |

### 2.4 risk
Emitted following detection to provide explainable rescue prioritization.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `detection_id` | string | ID of the associated survivor detection. |
| `score` | float | Normalized risk score between 0.0 and 1.0. |
| `priority_level` | string | Categorical priority: "LOW", "MEDIUM", "HIGH", "CRITICAL". |
| `reason` | string | Human-readable summary of risk factors. |
| `explain` | list[string] | Granular breakdown of formula factor contributions. |

### 2.5 alert
High-visibility emergency and operational alerts dispatched to the operator feed.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `alert_id` | string | Unique alert identifier. |
| `alert_type` | string | "SURVIVOR_DETECTED", "HAZARD_DETECTED", "CRITICAL_PRIORITY", "LINK_LOST", "LINK_RESTORED", "FAILSAFE". |
| `message` | string | Actionable operator notice. |
| `latitude` | float | Relevant location latitude (optional). |
| `longitude` | float | Relevant location longitude (optional). |
| `stamp` | object/string | Alert trigger timestamp. |

### 2.6 mission_status
Regular status update (~1 Hz) detailing overall search mission progress.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `mission_id` | string | Active mission identifier string. |
| `state` | string | "DISARMED", "ARMED", "IN_FLIGHT", "RTL_RETURNING", "EMERGENCY_LAND", "COMPLETE". |
| `substate` | string | Autonomous sub-state: "PATROLLING", "VICTIM_LOCKED", "HOVER_STABILISING", "HOVER_CONFIRMING", "CONFIRMED", "REJECTED", "RESUME_PATROL", "MANUAL". |
| `battery_percent` | float | Remaining drone battery percentage. |
| `coverage_percent` | float | Estimated percentage of search arena covered (0.0 - 100.0). |
| `link_connected` | boolean | True if operator link is active. |
| `nav_mode` | string | "GPS_NAV" or "GPS_DENIED". |
| `stamp` | object/string | Timestamp. |

### 2.7 heartbeat
Periodic 1 Hz watchdog message.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `state` | string | Vehicle state machine state. |
| `battery` | float | Battery percentage. |
| `link` | boolean | Link connectivity status. |
| `mode` | string | Current flight control mode. |
| `seq` | integer | Heartbeat sequence counter. |

### 2.8 link_state
Offline synchronization engine state notification.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `state` | string | "CONNECTED", "OFFLINE", "SYNCING". |
| `queued_events` | integer | Number of unsynchronized events in local buffer. |
| `synced_events` | integer | Total synchronized events count. |

### 2.9 route
A* safe access path from base staging location to target survivor pin.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `survivor_id` | string | Target survivor identifier. |
| `points` | list[[lat, lon]] | Ordered sequence of geographic waypoints avoiding hazard buffers. |

### 2.10 replay_frame
Emitted during mission replay scrub or playback.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `mission_id` | string | Target mission id. |
| `frame_seq` | integer | Sequence index of the recorded frame. |
| `total_frames` | integer | Total frames recorded in mission session. |
| `envelope` | object | The original recorded versioned envelope. |

### 2.11 hover_progress
Emitted during autonomous victim hover-verify lifecycle.

Payload Fields:
| Field | Type | Description |
|---|---|---|
| `victim_id` | string | Target survivor or test object identifier. |
| `elapsed` | float | Elapsed simulation time during hover (seconds). |
| `total` | float | Total required hover verification duration (5.5 seconds). |
| `state` | string | Hover substate: "HOVER_STABILISING", "HOVER_CONFIRMING", "CONFIRMED", "REJECTED". |

---

## 3. Client-to-Server Messages

Clients transmit command envelopes on the same `/ws/live` channel:

```json
{
  "v": 1,
  "type": "cmd",
  "seq": 45,
  "sim_time": 0.0,
  "payload": {
    "action": "start",
    "params": {}
  }
}
```

Allowed `action` values in `cmd`:
| Action | Parameters | Description |
|---|---|---|
| `arm` | None | Arm motors from DISARMED state. |
| `disarm` | None | Disarm motors if on ground. |
| `start` | None | Launch autonomous search flight. |
| `pause` | None | Pause in-flight navigation, hold position. |
| `resume` | None | Resume autonomous search path. |
| `rtl` | None | Command Return-To-Launch. |
| `emergency_land` | None | Trigger immediate descent and motor kill upon landing. |
| `manual_input` | `{"vx": float, "vy": float, "vz": float, "yaw_rate": float}` | Manual velocity override vector. |
| `set_flight_mode` | `{"mode": "MANUAL" \| "AUTONOMOUS"}` | Mode switch between manual flight and autonomous search. |
| `link_cut` | None | Emulate communication link loss (switches to offline buffering). |
| `link_restore` | None | Emulate communication link restoration (flushes buffer). |
| `set_mode` | `{"mode": "GPS_NAV" \| "GPS_DENIED", "low_power": bool}` | Update simulation navigation or power mode. |
