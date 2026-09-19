# AEROSAR — Dashboard ⇄ Backend Contract

**Owners:** Member 4 (backend, producer) and Member 5 (dashboard, consumer).
**Source of truth:** master document §7.1 (message types), §7.2 (topics), §6.4/§6.5 (endpoints), §13 (offline/sync).

Field names below are copied from the locked `aerosar_msgs` definitions, so the
backend bridge can forward ROS messages with **no renaming**. Anything marked
**EXTENSION** is not in §7.1 yet: it is optional, the dashboard still works
without it, and adding it to a `.msg` file needs whole-team sign-off (§7).

The TypeScript version of this file is `src/types.ts`. If the two ever disagree,
fix whichever is wrong in the same PR.

---

## Endpoints

| Kind | Path | Required? | Notes |
|---|---|---|---|
| WebSocket | `/ws/live` | **Yes** | Server → dashboard push. The dashboard never needs to send anything. |
| REST GET | `/api/missions/{id}/history` | For replay | Returns the §13.2 events table for one mission. |
| REST POST | `/api/mission/start` | Optional | Forwards to ROS service `/mission/start` (std_srvs/Trigger). |
| REST POST | `/api/mission/abort` | Optional | Forwards to ROS service `/mission/abort`. |

The two POST endpoints are a **proposal** — §7.3 defines the ROS services but
not how the dashboard reaches them. Response shape mirrors `std_srvs/Trigger`:
`{ "success": true, "message": "..." }`. If Member 4 skips them, the buttons
just show the error; nothing else breaks.

The dashboard reconnects every 3 s if the socket drops. The backend doesn't
need any reconnection logic — just accept new connections. It helps a lot if a
newly connected client receives the current mission's events as one `batch`
message (see below), so a refreshed browser isn't empty mid-demo.

---

## Frame format

Every WebSocket text frame is one JSON object:

```json
{ "type": "<message_type>", "data": { ... } }
```

### Timestamps (`stamp`)

Any of these is accepted — use whatever is easiest in the bridge:

- `builtin_interfaces/Time` as JSON: `{ "sec": 1789582831, "nanosec": 736000000 }`
- ISO-8601 string: `"2026-09-16T10:15:04.736Z"`
- epoch seconds (float) or epoch milliseconds (int)

**Always send the drone-side time the event happened**, not the time the
backend received it (§13.6). The dashboard sorts alerts and the log by `stamp`,
and marks anything that arrives more than 3 s after its stamp as
"synced after reconnect" — that is what makes the offline demo moment readable.

Coordinates are always `latitude` / `longitude` in decimal degrees.

---

## Message types

### `detection` — `aerosar_msgs/Detection` from `/perception/detection`
```json
{
  "type": "detection",
  "data": {
    "id": "det-0192",
    "detection_type": "person",
    "confidence": 0.87,
    "bbox_x": 0.42, "bbox_y": 0.38, "bbox_w": 0.12, "bbox_h": 0.22,
    "thermal_confirmed": true,
    "latitude": 26.239066, "longitude": 73.024901, "altitude": 0.0,
    "stamp": { "sec": 1789582831, "nanosec": 0 }
  }
}
```
- `detection_type: "person"` → survivor. A hazard class here is drawn as a hazard.
- Re-sending the same `id` updates it (no duplicate pin).
- `bbox_*` are accepted but not drawn yet.

### `hazard` — `aerosar_msgs/Hazard` from `/perception/hazard`
```json
{ "type": "hazard", "data": { "id": "haz-07", "hazard_type": "fire", "confidence": 0.93,
  "latitude": 26.239080, "longitude": 73.024910, "stamp": "2026-09-16T10:15:02Z" } }
```
`hazard_type`: `fire | smoke | flood | debris | damaged_structure | landslide`.
Unknown values still render (grey). The map draws a 10 m indicative zone because
`Hazard.msg` has no footprint field.

### `risk_score` — `aerosar_msgs/RiskScore` from `/rescue/risk_score`
```json
{ "type": "risk_score", "data": { "detection_id": "det-0192", "score": 0.767,
  "priority_level": "CRITICAL",
  "reason": "CRITICAL: high detection confidence (0.87), located near an active hazard, thermal-confirmed" } }
```
- `priority_level`: `LOW | MEDIUM | HIGH | CRITICAL` (§11.4 thresholds).
- Send it again whenever the score changes (e.g. a hazard is found near an
  existing survivor). **The dashboard never computes scores** — survivors
  without one show as "Unscored" at the bottom of the list.
- `reason` is shown in full next to each survivor (§11.6). The leading
  `"LEVEL: "` prefix is stripped for display.

### `priority` — ranked list (`/rescue/priority`, or backend-only)
```json
{ "type": "priority", "data": { "ranked": [ { "detection_id": "det-0192", "score": 0.767,
  "priority_level": "CRITICAL", "reason": "..." } ] } }
```
Optional. If sent, the priority list uses this order; otherwise it sorts by score.

### `alert` — `aerosar_msgs/Alert` from `/alerts/emergency`
```json
{ "type": "alert", "data": { "alert_id": "alert-04", "alert_type": "CRITICAL_PRIORITY",
  "message": "Survivor #2 — CRITICAL priority near fire",
  "latitude": 26.239066, "longitude": 73.024901, "stamp": "2026-09-16T10:15:05Z" } }
```
`Alert.msg` has no severity, so the dashboard derives the colour from `alert_type`:

| `alert_type` | Shown as |
|---|---|
| `CRITICAL_PRIORITY` | Critical (red) + pop-up |
| `SURVIVOR_DETECTED` | the survivor's priority level if a survivor sits at the same coordinates, else High |
| `LINK_LOST`, `GPS_LOST` | Medium (yellow) + pop-up |
| `LINK_RESTORED`, `HAZARD_DETECTED`, `GPS_RESTORED`, anything else | Info |

`GPS_LOST` / `GPS_RESTORED` come from §10.4 and are **EXTENSION** values for the
`alert_type` enum. Alerts are de-duplicated by `alert_id`, so re-sending a batch
after a dropped ack is harmless (§13.4).

### `mission_status` — `aerosar_msgs/MissionStatus` from `/mission/status` (~1 Hz)
```json
{ "type": "mission_status", "data": { "mission_id": "search-01", "state": "SEARCHING",
  "battery_percent": 78.0, "coverage_percent": 52.0, "link_connected": true,
  "nav_mode": "GPS_NAV", "stamp": "2026-09-16T10:15:05Z" } }
```
- `state`: `IDLE | SEARCHING | RETURNING | COMPLETE`.
- `link_connected: false` → top bar shows **OFFLINE — logging locally** (§13.8 step 3).
- `nav_mode` (**EXTENSION**): `GPS_NAV | GPS_DENIED`, shown as the "Mode" line in §14.2.
- A new `mission_id` clears the previous mission from the screen.
- **Keep sending it about once a second.** If none arrives for 5 s during a
  mission, the dashboard shows OFFLINE on its own (§16.3 "OFFLINE within 5 s").

### `drone_pose` — **EXTENSION** (relayed from `/gps/fix` or the SLAM pose)
```json
{ "type": "drone_pose", "data": { "latitude": 26.23912, "longitude": 73.02479, "altitude": 30.0,
  "heading_deg": 270, "speed_mps": 8.0, "gps_fix": true, "stamp": "2026-09-16T10:15:05Z" } }
```
Draws the drone arrow and its track, and fills the video HUD. 2–5 Hz is plenty.
Keep sending the (dead-reckoned) position while GPS is denied so the track has no gap (Scenario 4).

### `sync_status` — **EXTENSION** (offline queue / sync engine, §13.3)
```json
{ "type": "sync_status", "data": { "state": "SYNCING", "queued_events": 3, "synced_events": 4 } }
```
- `state`: `CONNECTED | OFFLINE | SYNCING`. `SYNCING` wins over everything else on the indicator.
- Counts are optional; if present they're shown ("4 events queued").
- Suggested sequence on reconnect: `SYNCING` → the queued events (oldest first, or as one `batch`) → `CONNECTED`.

### `route` — **EXTENSION** (safe route, §12 — skip entirely if not built)
```json
{ "type": "route", "data": { "survivor_id": "det-0192",
  "points": [[26.2389, 73.0243], [26.2390, 73.0246], [26.2393, 73.0250]] } }
```
Points are `[lat, lng]`. Send `"points": []` to clear.

### `video_status` / `video_frame` — **EXTENSION** (live feed, §14.3)
```json
{ "type": "video_status", "data": { "rgb_url": "http://10.0.0.5:8080/rgb.mjpg", "thermal_url": null } }
{ "type": "video_frame",  "data": { "channel": "thermal", "jpeg_base64": "/9j/4AAQ..." } }
```
Use either. `*_url` must be something an `<img>` tag can show (MJPEG stream or a
JPEG URL). `video_frame` pushes single JPEG frames; keep them small (≤ 640 px, a few fps).
If neither is sent, the panel shows "No stream yet".

### `batch`
```json
{ "type": "batch", "data": [ { "type": "detection", "data": { ... } }, { "type": "alert", "data": { ... } } ] }
```
Any messages above, applied in order. Use it for sync drains and for late-joining clients.

---

## `GET /api/missions/{id}/history`

Returns the §13.2 events table for that mission:

```json
{
  "mission_id": "search-01",
  "events": [
    { "event_id": "3f1c…", "event_type": "detection", "payload": { "...Detection fields..." },
      "created_at": "2026-09-16T10:15:04Z", "synced_at": "2026-09-16T10:15:40Z" }
  ]
}
```
- `event_type`: `detection | hazard | alert | status` (plus optionally `risk_score`, `priority`, `drone_pose`).
- `payload`: the same `data` object as the WebSocket message (object or JSON string).
- A bare array of events is also accepted.

---

## Try it without the real backend

`npm run mock:server` implements everything above on port 8000 using the same
demo scenario as the in-browser simulator. Two extra debug endpoints emulate
Member 6's network toggle:

```bash
curl -X POST http://localhost:8000/api/debug/link/cut
curl -X POST http://localhost:8000/api/debug/link/restore
```
