"""
AEROSAR Command Center Backend & ROS 2 Bridge Server
Member 4 — Backend, Risk Data & Mapping Lead
SIH 2026 — PS 26177

Provides:
- Non-blocking WebSocket broadcast on /ws/live (and /ws/dashboard)
- ROS 2 Bridge Node spinning in a background executor thread
- Explainable Risk Scoring Engine
- A* Safe Route Planner around hazard costmaps
- Offline SQLite event queue & automatic reconnect synchronizer
"""

import asyncio
import base64
import json
import math
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.database import EventStore
from app.schemas import Alert, Detection, EventIn, Hazard, MissionStatus, RiskScore
from app.services.risk_scoring import score_detection
from app.services.safe_route import AStarRoutePlanner, HazardCostZone


class DashboardHub:
    def __init__(self) -> None:
        self.clients: List[WebSocket] = []
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.is_link_connected: bool = True

    def register_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def broadcast_direct(self, message: dict) -> None:
        if not self.clients:
            return
        stale: List[WebSocket] = []
        for client in self.clients:
            try:
                await client.send_json(message)
            except Exception:
                stale.append(client)
        for s in stale:
            if s in self.clients:
                self.clients.remove(s)

    def threadsafe_broadcast(self, message: dict) -> None:
        if self.loop is not None and not self.loop.is_closed():
            asyncio.run_coroutine_threadsafe(self.broadcast_direct(message), self.loop)


DB_PATH = Path(os.getenv("AEROSAR_DB_PATH", "aerosar.db"))
store = EventStore(DB_PATH)
hub = DashboardHub()

# Reference base coordinates (Disaster sim origin: Jaipur)
BASE_LAT = 26.9124
BASE_LON = 75.7873

# Safe route planner instance
route_planner = AStarRoutePlanner(ref_lat=BASE_LAT, ref_lon=BASE_LON)

# State cache
latest_pose = {
    "latitude": BASE_LAT,
    "longitude": BASE_LON,
    "altitude": 1.5,
    "heading_deg": 0.0,
    "speed_mps": 0.0,
    "gps_fix": True,
    "stamp": {"sec": int(time.time()), "nanosec": 0}
}
latest_mission_status = {
    "mission_id": "MISSION-AEROSAR-01",
    "state": "ACTIVE",
    "battery_percent": 98.5,
    "coverage_percent": 12.0,
    "link_connected": True,
    "nav_mode": "AUTO_SEARCH",
    "stamp": {"sec": int(time.time()), "nanosec": 0}
}


def event_payload(event: EventIn) -> dict:
    return event.model_dump(mode="json")


def create_event(event_type: str, item: object, event_id: str | None = None) -> EventIn:
    payload = item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
    eid = event_id or payload.get("id") or payload.get("alert_id") or f"{event_type}_{int(time.time()*1000)}"
    return EventIn(event_id=eid, event_type=event_type, payload=payload)


async def store_and_broadcast(event: EventIn, ws_type: str, client_data: dict) -> bool:
    is_online = hub.is_link_connected
    created = store.insert(event, synced=is_online)
    if is_online:
        await hub.broadcast_direct({"type": ws_type, "data": client_data})
    return created


# ==============================================================================
# ROS 2 Subsystem Integration Seam (Runs in background daemon thread)
# ==============================================================================
ros_node = None
ros_thread = None


def init_ros2_bridge():
    global ros_node, ros_thread
    try:
        import rclpy
        from rclpy.node import Node
        from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
        from sensor_msgs.msg import Image, Imu, NavSatFix
        from aerosar_msgs.msg import Alert as RosAlert, Detection as RosDetection, Hazard as RosHazard, MissionStatus as RosMissionStatus, RiskScore as RosRiskScore

        if not rclpy.ok():
            rclpy.init(args=None)

        class Ros2Bridge(Node):
            def __init__(self):
                super().__init__('aerosar_backend_bridge')
                self.get_logger().info('ROS 2 AerosarBackendBridgeNode spinning.')

                self.sub_det = self.create_subscription(
                    RosDetection, '/perception/detection', self.on_detection, 10
                )
                self.sub_haz = self.create_subscription(
                    RosHazard, '/perception/hazard', self.on_hazard, 10
                )
                self.sub_status = self.create_subscription(
                    RosMissionStatus, '/mission/status', self.on_status, 10
                )
                self.sub_alert = self.create_subscription(
                    RosAlert, '/alerts/emergency', self.on_alert, 10
                )
                self.sub_gps = self.create_subscription(
                    NavSatFix, '/gps/fix', self.on_gps, 10
                )
                self.sub_imu = self.create_subscription(
                    Imu, '/imu/data', self.on_imu, 10
                )
                self.sub_cam = self.create_subscription(
                    Image, '/camera/image_raw', self.on_cam, 10
                )
                self.sub_thermal = self.create_subscription(
                    Image, '/thermal/image_raw', self.on_thermal, 10
                )

                self.last_cam_time = 0.0
                self.last_thermal_time = 0.0
                self.last_gps_time = 0.0
                self.recent_boxes = []

            def on_detection(self, msg: RosDetection):
                try:
                    lat = float(msg.latitude) if not math.isnan(msg.latitude) else BASE_LAT
                    lon = float(msg.longitude) if not math.isnan(msg.longitude) else BASE_LON
                    det_dict = {
                        "id": msg.id,
                        "detection_type": msg.detection_type,
                        "confidence": float(msg.confidence),
                        "bbox_x": float(msg.bbox_x),
                        "bbox_y": float(msg.bbox_y),
                        "bbox_w": float(msg.bbox_w),
                        "bbox_h": float(msg.bbox_h),
                        "thermal_confirmed": bool(msg.thermal_confirmed),
                        "latitude": lat,
                        "longitude": lon,
                        "altitude": float(msg.altitude) if not math.isnan(msg.altitude) else 1.5,
                        "stamp": {"sec": int(msg.stamp.sec), "nanosec": int(msg.stamp.nanosec)}
                    }
                    det_model = Detection(**det_dict)
                    event = create_event("detection", det_model, det_model.id)
                    store.insert(event, synced=hub.is_link_connected)

                    # Compute explainable risk score
                    hazards = [Hazard.model_validate(r["payload"]) for r in store.list("hazard")]
                    detections = [Detection.model_validate(r["payload"]) for r in store.list("detection")]
                    risk = score_detection(det_model, hazards, detections)
                    risk_event = EventIn(event_id=f"risk-{det_model.id}", event_type="risk_score", payload=risk.model_dump(mode="json"))
                    store.insert(risk_event, synced=hub.is_link_connected)

                    # Compute safe route from base to survivor
                    path_pts = route_planner.plan_safe_path(BASE_LAT, BASE_LON, lat, lon)

                    if hub.is_link_connected:
                        hub.threadsafe_broadcast({"type": "detection", "data": det_dict})
                        hub.threadsafe_broadcast({"type": "risk_score", "data": risk.model_dump(mode="json")})
                        # Also broadcast ranked priority list
                        priorities = sorted(store.list("risk_score"), key=lambda r: r["payload"]["score"], reverse=True)
                        ranked_payload = [p["payload"] for p in priorities]
                        hub.threadsafe_broadcast({"type": "priority", "data": {"ranked": ranked_payload}})
                        hub.threadsafe_broadcast({"type": "route", "data": {"survivor_id": det_model.id, "points": path_pts}})

                        # Alert
                        alert_dict = {
                            "alert_id": f"alert-{det_model.id}",
                            "alert_type": "CRITICAL_PRIORITY" if risk.priority_level == "CRITICAL" else "SURVIVOR_DETECTED",
                            "message": f"Survivor detected ({risk.priority_level}): {risk.reason}",
                            "latitude": lat,
                            "longitude": lon,
                            "stamp": det_dict["stamp"]
                        }
                        hub.threadsafe_broadcast({"type": "alert", "data": alert_dict})

                        # Track detection bbox for live video feed HUD overlay
                        lbl = f"SURVIVOR ({int(det_model.confidence * 100)}%)" if not det_model.thermal_confirmed else f"SURVIVOR+HEAT ({int(det_model.confidence * 100)}%)"
                        self.recent_boxes.append({
                            "x": float(det_model.bbox_x),
                            "y": float(det_model.bbox_y),
                            "w": float(det_model.bbox_w),
                            "h": float(det_model.bbox_h),
                            "label": lbl,
                            "expiry": time.time() + 3.0
                        })
                except Exception as e:
                    self.get_logger().error(f"Error in on_detection: {e}")

            def on_hazard(self, msg: RosHazard):
                try:
                    lat = float(msg.latitude) if not math.isnan(msg.latitude) and msg.latitude != 0.0 else (BASE_LAT + 0.00015)
                    lon = float(msg.longitude) if not math.isnan(msg.longitude) and msg.longitude != 0.0 else (BASE_LON + 0.00015)
                    haz_dict = {
                        "id": msg.id,
                        "hazard_type": msg.hazard_type,
                        "confidence": float(msg.confidence),
                        "latitude": lat,
                        "longitude": lon,
                        "stamp": {"sec": int(msg.stamp.sec), "nanosec": int(msg.stamp.nanosec)}
                    }
                    haz_model = Hazard(**haz_dict)
                    event = create_event("hazard", haz_model, haz_model.id)
                    store.insert(event, synced=hub.is_link_connected)

                    # Register in route planner
                    route_planner.add_hazard(HazardCostZone(lat=lat, lon=lon, radius_m=8.0, severity=haz_model.confidence))

                    if hub.is_link_connected:
                        hub.threadsafe_broadcast({"type": "hazard", "data": haz_dict})
                        alert_dict = {
                            "alert_id": f"alert-haz-{haz_model.id}",
                            "alert_type": "HAZARD_DETECTED",
                            "message": f"{haz_model.hazard_type.upper()} disaster hazard detected (conf: {haz_model.confidence:.2f})",
                            "latitude": lat,
                            "longitude": lon,
                            "stamp": haz_dict["stamp"]
                        }
                        hub.threadsafe_broadcast({"type": "alert", "data": alert_dict})
                except Exception as e:
                    self.get_logger().error(f"Error in on_hazard: {e}")

            def on_status(self, msg: RosMissionStatus):
                try:
                    stat_dict = {
                        "mission_id": msg.mission_id,
                        "state": msg.state,
                        "battery_percent": float(msg.battery_percent),
                        "coverage_percent": float(msg.coverage_percent),
                        "link_connected": bool(msg.link_connected),
                        "nav_mode": "AUTO_SEARCH",
                        "stamp": {"sec": int(msg.stamp.sec), "nanosec": int(msg.stamp.nanosec)}
                    }
                    global latest_mission_status
                    latest_mission_status = stat_dict
                    event = create_event("status", stat_dict, f"status-{msg.mission_id}-{int(time.time())}")
                    store.insert(event, synced=hub.is_link_connected)
                    if hub.is_link_connected:
                        hub.threadsafe_broadcast({"type": "mission_status", "data": stat_dict})
                except Exception as e:
                    self.get_logger().error(f"Error in on_status: {e}")

            def on_alert(self, msg: RosAlert):
                alert_dict = {
                    "alert_id": msg.alert_id,
                    "alert_type": msg.alert_type,
                    "message": msg.message,
                    "latitude": float(msg.latitude),
                    "longitude": float(msg.longitude),
                    "stamp": {"sec": msg.stamp.sec, "nanosec": msg.stamp.nanosec}
                }
                if hub.is_link_connected:
                    hub.threadsafe_broadcast({"type": "alert", "data": alert_dict})

            def on_gps(self, msg: NavSatFix):
                now = time.time()
                if (now - self.last_gps_time) < 0.10:  # ~10 Hz rate limit
                    return
                self.last_gps_time = now

                lat = float(msg.latitude) if not math.isnan(msg.latitude) else BASE_LAT
                lon = float(msg.longitude) if not math.isnan(msg.longitude) else BASE_LON
                alt = float(msg.altitude) if not math.isnan(msg.altitude) else 1.5

                global latest_pose
                latest_pose["latitude"] = lat
                latest_pose["longitude"] = lon
                latest_pose["altitude"] = alt
                latest_pose["gps_fix"] = not (math.isnan(msg.latitude) or math.isnan(msg.longitude))
                latest_pose["stamp"] = {"sec": msg.header.stamp.sec, "nanosec": msg.header.stamp.nanosec}

                if hub.is_link_connected:
                    hub.threadsafe_broadcast({"type": "drone_pose", "data": latest_pose})

            def on_imu(self, msg: Imu):
                global latest_pose
                q = msg.orientation
                siny_cosp = 2 * (q.w * q.z + q.x * q.y)
                cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
                yaw_rad = math.atan2(siny_cosp, cosy_cosp)
                latest_pose["heading_deg"] = round(math.degrees(yaw_rad) % 360, 1)

            def on_cam(self, msg: Image):
                now = time.time()
                if (now - self.last_cam_time) < 0.10:  # ~10 Hz for fluid WebSocket video preview
                    return
                self.last_cam_time = now

                if not hub.is_link_connected or not hub.clients:
                    return

                try:
                    # Convert raw RGB/BGR to JPEG base64
                    np_arr = np.frombuffer(msg.data, dtype=np.uint8).reshape((msg.height, msg.width, -1))
                    if np_arr.shape[2] == 4:
                        bgr = cv2.cvtColor(np_arr, cv2.COLOR_BGRA2BGR)
                    elif np_arr.shape[2] == 3:
                        bgr = cv2.cvtColor(np_arr, cv2.COLOR_RGB2BGR)
                    else:
                        bgr = cv2.cvtColor(np_arr, cv2.COLOR_GRAY2BGR)

                    # Downsample slightly for crisp, low-latency socket frame
                    small = cv2.resize(bgr, (320, 240))

                    # Overlay active survivor bounding boxes
                    self.recent_boxes = [b for b in self.recent_boxes if b["expiry"] > now]
                    h_s, w_s = small.shape[:2]
                    for box in self.recent_boxes:
                        bx = int(box["x"] * w_s)
                        by = int(box["y"] * h_s)
                        bw = max(12, int(box["w"] * w_s))
                        bh = max(12, int(box["h"] * h_s))
                        cv2.rectangle(small, (bx, by), (bx + bw, by + bh), (0, 255, 0), 2)
                        cv2.putText(small, box["label"], (bx, max(12, by - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 255, 0), 1)

                    _, buf = cv2.imencode('.jpg', small, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                    b64 = base64.b64encode(buf).decode('utf-8')
                    hub.threadsafe_broadcast({"type": "video_frame", "data": {"channel": "rgb", "jpeg_base64": b64}})
                except Exception:
                    pass

            def on_thermal(self, msg: Image):
                now = time.time()
                if (now - self.last_thermal_time) < 0.20:  # ~5 Hz for thermal feed
                    return
                self.last_thermal_time = now

                if not hub.is_link_connected or not hub.clients:
                    return

                try:
                    np_arr = np.frombuffer(msg.data, dtype=np.uint8).reshape((msg.height, msg.width, -1))
                    if np_arr.shape[2] == 4:
                        bgr = cv2.cvtColor(np_arr, cv2.COLOR_BGRA2BGR)
                    elif np_arr.shape[2] == 3:
                        bgr = cv2.cvtColor(np_arr, cv2.COLOR_RGB2BGR)
                    else:
                        bgr = cv2.cvtColor(np_arr, cv2.COLOR_GRAY2BGR)

                    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
                    thermal_colored = cv2.applyColorMap(gray, cv2.COLORMAP_INFERNO)
                    small = cv2.resize(thermal_colored, (320, 240))
                    _, buf = cv2.imencode('.jpg', small, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
                    b64 = base64.b64encode(buf).decode('utf-8')
                    hub.threadsafe_broadcast({"type": "video_frame", "data": {"channel": "thermal", "jpeg_base64": b64}})
                except Exception:
                    pass

        ros_node = Ros2Bridge()
        ros_thread = threading.Thread(target=lambda: rclpy.spin(ros_node), daemon=True)
        ros_thread.start()
        print("[BACKEND] ROS 2 Backend Bridge Node running in background thread.")
    except Exception as e:
        print(f"[BACKEND] ROS 2 initialization skipped or running standalone: {e}")


# ==============================================================================
# FastAPI Lifespan & Application Definition
# ==============================================================================
@asynccontextmanager
async def lifespan(_: FastAPI):
    loop = asyncio.get_running_loop()
    hub.register_loop(loop)
    init_ros2_bridge()
    yield
    if ros_node is not None:
        try:
            ros_node.destroy_node()
        except Exception:
            pass


app = FastAPI(title="AEROSAR Command Center", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "aerosar-backend",
        "ros2_active": ros_node is not None,
        "clients_connected": len(hub.clients),
        "link_connected": hub.is_link_connected,
    }


@app.get("/api/events")
def get_events() -> list[dict]:
    return store.list()


@app.get("/api/detections")
def get_detections() -> list[dict]:
    return store.list("detection")


@app.get("/api/hazards")
def get_hazards() -> list[dict]:
    return store.list("hazard")


@app.get("/api/priority")
def get_priorities() -> list[dict]:
    return sorted(store.list("risk_score"), key=lambda row: row["payload"]["score"], reverse=True)


@app.get("/api/mission/status")
def get_mission_status() -> dict:
    statuses = store.list("status")
    if statuses:
        return statuses[-1]["payload"]
    return latest_mission_status


@app.get("/api/sync/status")
def get_sync_status() -> dict:
    return store.get_sync_status(is_online=hub.is_link_connected)


@app.post("/api/events")
async def ingest_event(event: EventIn) -> dict:
    created = await store_and_broadcast(event, f"{event.event_type}", event.payload)
    return {"event_id": event.event_id, "created": created}


@app.post("/api/hazards")
async def add_hazard(hazard: Hazard) -> dict:
    event = create_event("hazard", hazard, hazard.id)
    await store_and_broadcast(event, "hazard", hazard.model_dump(mode="json"))
    route_planner.add_hazard(HazardCostZone(lat=hazard.latitude, lon=hazard.longitude, severity=hazard.confidence))
    alert = Alert(
        alert_type="HAZARD_DETECTED",
        message=f"{hazard.hazard_type.upper()} detected",
        latitude=hazard.latitude,
        longitude=hazard.longitude,
    )
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert", alert.model_dump(mode="json"))
    return event_payload(event)


@app.post("/api/detections")
async def add_detection(detection: Detection) -> dict:
    event = create_event("detection", detection, detection.id)
    await store_and_broadcast(event, "detection", detection.model_dump(mode="json"))

    hazards = [Hazard.model_validate(row["payload"]) for row in store.list("hazard")]
    detections = [Detection.model_validate(row["payload"]) for row in store.list("detection")]
    risk = score_detection(detection, hazards, detections)
    risk_event = EventIn(event_id=f"risk-{detection.id}", event_type="risk_score", payload=risk.model_dump(mode="json"))
    await store_and_broadcast(risk_event, "risk_score", risk.model_dump(mode="json"))

    # Priority ranking broadcast
    priorities = sorted(store.list("risk_score"), key=lambda r: r["payload"]["score"], reverse=True)
    await hub.broadcast_direct({"type": "priority", "data": {"ranked": [p["payload"] for p in priorities]}})

    # Safe Route
    path = route_planner.plan_safe_path(BASE_LAT, BASE_LON, detection.latitude, detection.longitude)
    await hub.broadcast_direct({"type": "route", "data": {"survivor_id": detection.id, "points": path}})

    alert = Alert(
        alert_type="CRITICAL_PRIORITY" if risk.priority_level == "CRITICAL" else "SURVIVOR_DETECTED",
        message=f"Survivor detected: {risk.reason}",
        latitude=detection.latitude,
        longitude=detection.longitude,
    )
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert", alert.model_dump(mode="json"))
    return {"detection": event_payload(event), "risk_score": risk.model_dump(mode="json"), "route": path}


@app.post("/api/mission/start")
async def mission_start() -> dict:
    global latest_mission_status
    latest_mission_status["state"] = "ACTIVE"
    event = create_event("status", latest_mission_status, f"status-start-{int(time.time())}")
    await store_and_broadcast(event, "mission_status", latest_mission_status)
    return {"success": True, "message": "Mission started successfully"}


@app.post("/api/mission/abort")
async def mission_abort() -> dict:
    global latest_mission_status
    latest_mission_status["state"] = "ABORTING"
    event = create_event("status", latest_mission_status, f"status-abort-{int(time.time())}")
    await store_and_broadcast(event, "mission_status", latest_mission_status)
    return {"success": True, "message": "Mission abort initiated — returning to base"}


@app.post("/api/debug/link/cut")
async def debug_link_cut() -> dict:
    hub.is_link_connected = False
    latest_mission_status["link_connected"] = False
    await hub.broadcast_direct({"type": "sync_status", "data": store.get_sync_status(is_online=False)})
    alert = Alert(alert_type="LINK_LOST", message="OFFLINE — logging locally to SQLite buffer")
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert", alert.model_dump(mode="json"))
    return {"success": True, "link_connected": False}


@app.post("/api/debug/link/restore")
async def debug_link_restore() -> dict:
    hub.is_link_connected = True
    latest_mission_status["link_connected"] = True
    synced_count = store.mark_all_synced()
    await hub.broadcast_direct({"type": "sync_status", "data": {"state": "SYNCING", "synced_events": synced_count}})
    await hub.broadcast_direct({"type": "sync_status", "data": {"state": "CONNECTED", "synced_events": synced_count}})
    alert = Alert(alert_type="LINK_RESTORED", message=f"Link restored; {synced_count} queued events synchronized")
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert", alert.model_dump(mode="json"))
    return {"success": True, "link_connected": True, "synced_events": synced_count}


# ==============================================================================
# WebSocket Live Streaming Endpoints (/ws/live and /ws/dashboard)
# ==============================================================================
async def handle_websocket(websocket: WebSocket):
    await websocket.accept()
    hub.clients.append(websocket)

    # 1. Send immediate sync status
    await websocket.send_json({"type": "sync_status", "data": store.get_sync_status(is_online=hub.is_link_connected)})

    # 2. Replay all buffered detections & hazards
    events = store.list()
    batch_frames = []
    for ev in events:
        etype = ev["event_type"]
        if etype in ("detection", "hazard", "risk_score", "alert", "status"):
            ws_type = "mission_status" if etype == "status" else etype
            batch_frames.append({"type": ws_type, "data": ev["payload"]})

    if batch_frames:
        await websocket.send_json({"type": "batch", "data": batch_frames})

    # 3. Send current drone pose and mission status
    await websocket.send_json({"type": "mission_status", "data": latest_mission_status})
    await websocket.send_json({"type": "drone_pose", "data": latest_pose})

    try:
        while True:
            # Handle incoming client commands or ping frames
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
                if data.get("action") == "sync":
                    synced = store.mark_all_synced()
                    await websocket.send_json({"type": "sync_status", "data": {"state": "CONNECTED", "synced_events": synced}})
            except Exception:
                pass
    except WebSocketDisconnect:
        if websocket in hub.clients:
            hub.clients.remove(websocket)


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    await handle_websocket(websocket)


@app.websocket("/ws/dashboard")
async def websocket_dashboard_endpoint(websocket: WebSocket):
    await handle_websocket(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
