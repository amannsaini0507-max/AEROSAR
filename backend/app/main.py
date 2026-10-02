"""
AEROSAR Command Center Backend & Hybrid ROS 2 / Standalone Server.
Complies with Hard Rules:
- Pure-Python aerosar_core logic integration (Two runtimes, one brain)
- Optional rclpy import; starts in STANDALONE mode if missing
- Versioned WebSocket v1 contract: { v: 1, type, seq, sim_time, payload }
- Offline outbox buffering & replay logging in SQLite WAL mode under data/
- 30 Hz live telemetry, explainable risk scoring, and A* safe route planning
"""

import asyncio
import base64
import json
import math
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

# Ensure aerosar_core is resolvable
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from aerosar_core.geo import (
    BASE_LAT,
    BASE_LON,
    BASE_ALT,
    enu_to_geodetic,
    geodetic_to_enu,
    geo_distance_m,
    geotag_detection,
    add_gps_noise,
)
from aerosar_core.perception import (
    SyntheticPerceptionEngine,
)
from aerosar_core.risk import (
    calculate_risk,
    score_detection as core_score_detection,
    RiskResult,
    MAX_RELEVANT_DISTANCE,
    MAX_RELEVANT_COUNT,
)
from aerosar_core.route import AStarPlanner, HazardZone
from aerosar_core.vehicle import (
    VehicleStateMachine,
    VehicleState,
    SafetyReport,
)
from aerosar_core.trajectory import (
    UniformCubicBSpline,
    ObstaclePotentialField,
    generate_lawnmower_waypoints,
)

from app.database import EventStore
from app.schemas import (
    Alert,
    Detection,
    EventIn,
    Hazard,
    MissionStatus,
    RiskScore,
    WSEnvelope,
    WSCommandPayload,
)


class DashboardHub:
    def __init__(self) -> None:
        self.clients: List[WebSocket] = []
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.is_link_connected: bool = True
        self.seq: int = 0
        self.mission_id: str = "MISSION-AEROSAR-01"
        self.sim_start_time: float = time.time()
        self.low_power: bool = False

    def register_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    def get_sim_time(self) -> float:
        return round(time.time() - self.sim_start_time, 2)

    def next_seq(self) -> int:
        self.seq += 1
        return self.seq

    def build_envelope(self, msg_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Creates version 1 envelope with backward-compatible data field."""
        seq = self.next_seq()
        sim_time = self.get_sim_time()
        return {
            "v": 1,
            "type": msg_type,
            "seq": seq,
            "sim_time": sim_time,
            "payload": payload,
            "data": payload,  # Dual-compatibility for existing UI components
        }

    async def broadcast_envelope(self, envelope: Dict[str, Any], record_replay: bool = True) -> None:
        # Replay logging
        if record_replay:
            store.record_replay_frame(
                mission_id=self.mission_id,
                seq=envelope["seq"],
                sim_time=envelope["sim_time"],
                msg_type=envelope["type"],
                payload=envelope["payload"],
            )

        # Offline buffering if link cut
        if not self.is_link_connected:
            eid = envelope["payload"].get("id") or envelope["payload"].get("alert_id") or f"{envelope['type']}_{envelope['seq']}"
            store.push_outbox(event_id=eid, event_type=envelope["type"], payload=envelope["payload"])
            return

        if not self.clients:
            return

        stale: List[WebSocket] = []
        for client in self.clients:
            try:
                await client.send_json(envelope)
            except Exception:
                stale.append(client)
        for s in stale:
            if s in self.clients:
                self.clients.remove(s)

    def threadsafe_broadcast(self, envelope: Dict[str, Any], record_replay: bool = True) -> None:
        if self.loop is not None and not self.loop.is_closed():
            asyncio.run_coroutine_threadsafe(
                self.broadcast_envelope(envelope, record_replay=record_replay), self.loop
            )


# Initialize Database under data/aerosar.db
data_dir = ROOT_DIR / "data"
data_dir.mkdir(parents=True, exist_ok=True)
DB_PATH = data_dir / "aerosar.db"
store = EventStore(DB_PATH)
hub = DashboardHub()

# Core planners & state machines
route_planner = AStarPlanner(ref_lat=BASE_LAT, ref_lon=BASE_LON, arena_size_m=30.0, cell_size_m=0.5)
vehicle_sm = VehicleStateMachine(battery_failsafe_pct=10.0, geofence_max_dist_m=22.0)
potential_field = ObstaclePotentialField(influence_dist_m=3.5, k_rep=2.0)

# Pre-register known static obstacles in 30x30 arena
potential_field.add_obstacle(-7.0, 6.0, 0.0, radius=2.5)   # Zone A Ruins
potential_field.add_obstacle(7.0, 7.0, 0.0, radius=3.0)    # Zone B Flood Basin
potential_field.add_obstacle(6.0, -7.0, 0.0, radius=2.5)   # Zone C Fire Core

# Dynamic State Caches
latest_pose = {
    "latitude": BASE_LAT,
    "longitude": BASE_LON,
    "altitude": 1.5,
    "heading_deg": 0.0,
    "speed_mps": 0.0,
    "gps_fix": True,
    "battery_percent": 98.5,
    "flight_mode": "AUTO_SEARCH",
    "pitch_deg": 0.0,
    "roll_deg": 0.0,
    "yaw_deg": 0.0,
    "pitch_rate_dps": 0.0,
    "roll_rate_dps": 0.0,
    "yaw_rate_dps": 0.0,
    "stamp": {"sec": int(time.time()), "nanosec": 0},
}

latest_mission_status = {
    "mission_id": hub.mission_id,
    "state": "IDLE",
    "battery_percent": 98.5,
    "coverage_percent": 0.0,
    "link_connected": True,
    "nav_mode": "GPS_NAV",
    "stamp": {"sec": int(time.time()), "nanosec": 0},
}


def create_event(event_type: str, item: object, event_id: Optional[str] = None) -> EventIn:
    payload = item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
    eid = event_id or payload.get("id") or payload.get("alert_id") or f"{event_type}_{int(time.time()*1000)}"
    return EventIn(event_id=eid, event_type=event_type, payload=payload)


async def store_and_broadcast(event: EventIn, ws_type: str, payload_data: dict) -> bool:
    created = store.insert(event, synced=hub.is_link_connected)
    envelope = hub.build_envelope(ws_type, payload_data)
    await hub.broadcast_envelope(envelope)
    return created


# ==============================================================================
# ROS 2 Subsystem Integration Seam (Optional)
# ==============================================================================
ros_node = None
ros_thread = None


def init_ros2_bridge():
    global ros_node, ros_thread
    try:
        import rclpy
        from rclpy.node import Node
        from sensor_msgs.msg import Image, Imu, NavSatFix
        from aerosar_msgs.msg import (
            Alert as RosAlert,
            Detection as RosDetection,
            Hazard as RosHazard,
            MissionStatus as RosMissionStatus,
            RiskScore as RosRiskScore,
        )

        if not rclpy.ok():
            rclpy.init(args=None)

        class Ros2Bridge(Node):
            def __init__(self):
                super().__init__("aerosar_backend_bridge")
                self.get_logger().info("ROS 2 AerosarBackendBridgeNode spinning.")

                self.sub_det = self.create_subscription(RosDetection, "/perception/detection", self.on_detection, 10)
                self.sub_haz = self.create_subscription(RosHazard, "/perception/hazard", self.on_hazard, 10)
                self.sub_status = self.create_subscription(RosMissionStatus, "/mission/status", self.on_status, 10)
                self.sub_alert = self.create_subscription(RosAlert, "/alerts/emergency", self.on_alert, 10)
                self.sub_gps = self.create_subscription(NavSatFix, "/gps/fix", self.on_gps, 10)
                self.sub_imu = self.create_subscription(Imu, "/imu/data", self.on_imu, 10)

                self.last_status_time = 0.0
                self.known_alerts: Dict[str, dict] = {}

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
                        "stamp": {"sec": int(msg.stamp.sec), "nanosec": int(msg.stamp.nanosec)},
                    }
                    det_model = Detection(**det_dict)
                    store.insert(create_event("detection", det_model, det_model.id), synced=hub.is_link_connected)

                    # Compute explainable risk score using aerosar_core
                    hazards = [r["payload"] for r in store.list("hazard")]
                    detections = [r["payload"] for r in store.list("detection")]
                    risk_res = core_score_detection(det_dict, hazards, detections)

                    risk_dict = {
                        "detection_id": risk_res.detection_id,
                        "score": risk_res.score,
                        "priority_level": risk_res.priority_level,
                        "reason": risk_res.reason,
                        "explain": risk_res.explain,
                    }
                    store.insert(EventIn(event_id=f"risk-{risk_res.detection_id}", event_type="risk_score", payload=risk_dict), synced=hub.is_link_connected)

                    # Safe route calculation
                    path_pts = route_planner.plan_path(BASE_LAT, BASE_LON, lat, lon)

                    hub.threadsafe_broadcast(hub.build_envelope("detection", det_dict))
                    hub.threadsafe_broadcast(hub.build_envelope("risk", risk_dict))
                    hub.threadsafe_broadcast(hub.build_envelope("route", {"survivor_id": det_model.id, "points": path_pts}))

                    # Priority ranking
                    all_risks = sorted(store.list("risk_score"), key=lambda r: r["payload"]["score"], reverse=True)
                    hub.threadsafe_broadcast(hub.build_envelope("priority", {"ranked": [r["payload"] for r in all_risks]}))

                    alert_key = f"survivor_{det_model.id}"
                    if alert_key not in self.known_alerts:
                        alert_dict = {
                            "alert_id": f"alert-survivor-{len(self.known_alerts) + 1}",
                            "alert_type": "CRITICAL_PRIORITY" if risk_res.priority_level == "CRITICAL" else "SURVIVOR_DETECTED",
                            "message": f"Survivor detected ({risk_res.priority_level}): {risk_res.reason}",
                            "latitude": lat,
                            "longitude": lon,
                            "stamp": det_dict["stamp"],
                        }
                        self.known_alerts[alert_key] = alert_dict
                        store.insert(create_event("alert", alert_dict, alert_dict["alert_id"]), synced=hub.is_link_connected)
                        hub.threadsafe_broadcast(hub.build_envelope("alert", alert_dict))
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
                        "stamp": {"sec": int(msg.stamp.sec), "nanosec": int(msg.stamp.nanosec)},
                    }
                    store.insert(create_event("hazard", haz_dict, haz_dict["id"]), synced=hub.is_link_connected)
                    route_planner.add_hazard(HazardZone(lat=lat, lon=lon, radius_m=3.0, safety_margin_m=1.5))
                    hub.threadsafe_broadcast(hub.build_envelope("hazard", haz_dict))
                except Exception as e:
                    self.get_logger().error(f"Error in on_hazard: {e}")

            def on_status(self, msg: RosMissionStatus):
                self.last_status_time = time.time()
                stat_dict = {
                    "mission_id": msg.mission_id,
                    "state": msg.state,
                    "battery_percent": float(msg.battery_percent),
                    "coverage_percent": float(msg.coverage_percent),
                    "link_connected": bool(msg.link_connected),
                    "nav_mode": "GPS_NAV",
                    "stamp": {"sec": int(msg.stamp.sec), "nanosec": int(msg.stamp.nanosec)},
                }
                global latest_mission_status
                latest_mission_status = stat_dict
                hub.threadsafe_broadcast(hub.build_envelope("mission_status", stat_dict))

            def on_gps(self, msg: NavSatFix):
                lat = float(msg.latitude) if not math.isnan(msg.latitude) else BASE_LAT
                lon = float(msg.longitude) if not math.isnan(msg.longitude) else BASE_LON
                alt = float(msg.altitude) if not math.isnan(msg.altitude) else 1.5
                global latest_pose
                latest_pose["latitude"] = lat
                latest_pose["longitude"] = lon
                latest_pose["altitude"] = alt
                latest_pose["gps_fix"] = not (math.isnan(msg.latitude) or math.isnan(msg.longitude))
                hub.threadsafe_broadcast(hub.build_envelope("telemetry", latest_pose))

            def on_imu(self, msg: Imu):
                q = msg.orientation
                siny_cosp = 2 * (q.w * q.z + q.x * q.y)
                cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
                yaw_rad = math.atan2(siny_cosp, cosy_cosp)
                latest_pose["heading_deg"] = round(math.degrees(yaw_rad) % 360, 1)

        ros_node = Ros2Bridge()
        ros_thread = threading.Thread(target=lambda: rclpy.spin(ros_node), daemon=True)
        ros_thread.start()
        print("[BACKEND] ROS 2 Backend Bridge Node running in background thread.")
    except Exception as e:
        print(f"[BACKEND] Running in STANDALONE mode (ROS 2 inactive: {e})")


# ==============================================================================
# Standalone Simulation Engine (Runs if ROS 2 is not present)
# ==============================================================================
class StandaloneSimulator:
    def __init__(self):
        self.running: bool = False
        self.task: Optional[asyncio.Task] = None
        self.sim_time: float = 0.0

        # Lawnmower flight path waypoints in 30x30m arena (11 lanes from -14 to +14m)
        self.waypoints = generate_lawnmower_waypoints(
            x_min=-14.0, x_max=14.0, y_min=-14.0, y_max=14.0, altitude=5.0, lane_spacing=2.8
        )
        self.waypoint_index: int = 0
        self.saved_waypoint_index: int = 0

        # Vehicle navigation state
        self.current_enu = [0.0, 0.0, 0.5]
        self.drone_vel = [0.0, 0.0, 0.0]
        self.manual_vel = [0.0, 0.0, 0.0]
        self.last_known_gps = (BASE_LAT, BASE_LON)

        # Verification mode ('demo' or 'realistic')
        self.verify_mode: str = "demo"

        # Hover-verify sub-state machine:
        # PATROLLING -> VICTIM_LOCKED -> HOVER_STABILISING -> HOVER_CONFIRMING -> (CONFIRMED | REJECTED) -> RESUME_PATROL
        self.substate: str = "PATROLLING"
        self.active_victim: Optional[Dict[str, Any]] = None
        self.hover_target: Optional[List[float]] = None
        self.hover_timer: float = 0.0
        self.hover_stabilise_timer: float = 0.0
        self.hover_positions: List[Tuple[float, float, float]] = []
        self.thermal_samples: List[float] = []
        self.confirmed_victims: set = set()
        self.rejected_victims: set = set()

        # Synthetic perception engine
        self.perception_engine = SyntheticPerceptionEngine(seed=42, fov_radius_m=4.8)

        # Scenario hazards
        self.staged_hazards = [
            {"id": "haz-ruins-01", "hazard_type": "damaged_structure", "confidence": 0.90, "enu": (-7.0, 6.0)},
            {"id": "haz-flood-01", "hazard_type": "flood", "confidence": 0.95, "enu": (7.0, 7.0)},
            {"id": "haz-fire-01", "hazard_type": "fire", "confidence": 0.98, "enu": (5.5, 6.5)},
        ]
        # Scenario victims & mannequin test object
        self.staged_victims = [
            {"id": "victim_1", "confidence": 0.50, "thermal": True, "temp_c": 36.5, "enu": (-6.8, 6.2, 0.2), "desc": "Collapsed Ruins Victim"},
            {"id": "victim_2", "confidence": 0.52, "thermal": True, "temp_c": 36.4, "enu": (7.2, 7.0, 0.2), "desc": "Flooded Basin Survivor"},
            {"id": "victim_3", "confidence": 0.95, "thermal": True, "temp_c": 37.1, "enu": (4.2, 5.8, 0.2), "desc": "Fire Zone Critical Survivor"},
            {"id": "mannequin_01", "confidence": 0.75, "thermal": False, "temp_c": 18.5, "enu": (-2.0, 0.0, 0.2), "desc": "Mannequin Test Object (Non-biological / Cold)"},
        ]
        self.triggered_hazards = set()

    def start(self):
        if not self.running:
            self.running = True
            vehicle_sm.arm()
            vehicle_sm.start_flight()
            latest_mission_status["state"] = "SEARCHING"
            latest_mission_status["substate"] = "PATROLLING"
            latest_pose["flight_mode"] = "AUTO_SEARCH"

    def pause(self):
        latest_mission_status["state"] = "PAUSED"

    def resume(self):
        latest_mission_status["state"] = "SEARCHING"
        if latest_pose["flight_mode"] == "AUTO_SEARCH":
            latest_mission_status["substate"] = self.substate

    def rtl(self):
        vehicle_sm.return_to_launch()
        latest_mission_status["state"] = "RETURNING"
        latest_mission_status["substate"] = "PATROLLING"
        latest_pose["flight_mode"] = "RTL"
        self.substate = "PATROLLING"
        self.active_victim = None
        self.hover_timer = 0.0

    def emergency_land(self, trigger: str = "OPERATOR_COMMAND") -> Optional[SafetyReport]:
        _, report = vehicle_sm.trigger_failsafe(
            trigger=trigger,
            sim_time=self.sim_time,
            inputs={"battery_percent": latest_pose["battery_percent"], "command": "emergency_land"},
            outcome="Operator emergency landing initiated; descent engaged.",
        )
        latest_mission_status["state"] = "EMERGENCY_LAND"
        latest_mission_status["substate"] = "EMERGENCY_LAND"
        latest_pose["flight_mode"] = "EMERGENCY_LAND"
        self.substate = "EMERGENCY_LAND"
        self.active_victim = None
        self.hover_timer = 0.0
        return report

    def apply_manual_input(self, vx: float, vy: float, vz: float, yaw_rate: float = 0.0):
        self.manual_vel = [float(vx), float(vy), float(vz)]
        if math.hypot(vx, vy) > 0.01 or abs(vz) > 0.01:
            latest_pose["flight_mode"] = "MANUAL"
            latest_mission_status["substate"] = "MANUAL"
            # Manual override immediately cancels any hover lock in 1 frame
            if self.substate != "PATROLLING":
                self.substate = "PATROLLING"
                self.active_victim = None
                self.hover_timer = 0.0
                self.hover_target = None

    def set_flight_mode(self, mode: str):
        if mode == "MANUAL":
            latest_pose["flight_mode"] = "MANUAL"
            latest_mission_status["substate"] = "MANUAL"
            if self.substate != "PATROLLING":
                self.substate = "PATROLLING"
                self.active_victim = None
                self.hover_timer = 0.0
                self.hover_target = None
        else:
            latest_pose["flight_mode"] = "AUTO_SEARCH"
            self.substate = "PATROLLING"
            latest_mission_status["substate"] = "PATROLLING"
            # Resumes search from saved waypoint index
            self.waypoint_index = self.saved_waypoint_index


sim_engine = StandaloneSimulator()


async def standalone_sim_loop():
    """High-frequency (30 Hz / 15 Hz) simulation update loop with drift-compensated pacing."""
    print("[BACKEND] Standalone Simulation Engine initialized.")
    last_hb_time = 0.0
    start_wall_time = time.time()
    next_tick = time.perf_counter()

    while True:
        try:
            rate_hz = 15.0 if hub.low_power else 30.0
            dt = 1.0 / rate_hz

            next_tick += dt
            sleep_duration = next_tick - time.perf_counter()
            if sleep_duration > 0:
                await asyncio.sleep(sleep_duration)
            else:
                next_tick = time.perf_counter()
                await asyncio.sleep(0.001)

            sim_time = time.time() - start_wall_time
            sim_engine.sim_time = sim_time

            # Update drone position
            state = vehicle_sm.state
            if state == VehicleState.IN_FLIGHT and latest_mission_status["state"] in ("SEARCHING", "PAUSED"):
                is_paused = (latest_mission_status["state"] == "PAUSED")

                if latest_pose["flight_mode"] == "MANUAL" and any(abs(v) > 0.01 for v in sim_engine.manual_vel):
                    # Manual flight mode velocity integration
                    sim_engine.current_enu[0] = max(-14.8, min(14.8, sim_engine.current_enu[0] + sim_engine.manual_vel[0] * dt))
                    sim_engine.current_enu[1] = max(-14.8, min(14.8, sim_engine.current_enu[1] + sim_engine.manual_vel[1] * dt))
                    sim_engine.current_enu[2] = max(0.5, min(15.0, sim_engine.current_enu[2] + sim_engine.manual_vel[2] * dt))
                    x, y, z = sim_engine.current_enu
                    heading_rad = math.atan2(sim_engine.manual_vel[0], sim_engine.manual_vel[1]) if math.hypot(sim_engine.manual_vel[0], sim_engine.manual_vel[1]) > 0.1 else 0.0
                    heading_deg = (math.degrees(heading_rad) + 360.0) % 360.0

                elif latest_mission_status["state"] == "SEARCHING":
                    x, y, z = sim_engine.current_enu

                    # Sub-state machine execution (PATROLLING -> VICTIM_LOCKED -> HOVER_STABILISING -> HOVER_CONFIRMING -> CONFIRMED/REJECTED -> RESUME_PATROL)
                    if sim_engine.substate == "PATROLLING":
                        # Follow waypoints at cruise altitude 5.0m, speed 2.5m/s
                        if sim_engine.waypoint_index >= len(sim_engine.waypoints):
                            sim_engine.rtl()
                            target_wp = (0.0, 0.0, 5.0)
                        else:
                            target_wp = sim_engine.waypoints[sim_engine.waypoint_index]

                        wp_dx = target_wp[0] - x
                        wp_dy = target_wp[1] - y
                        wp_dz = target_wp[2] - z
                        dist_to_wp = math.hypot(wp_dx, wp_dy)

                        # Advance waypoint when close
                        if dist_to_wp < 0.6:
                            sim_engine.waypoint_index = min(len(sim_engine.waypoints) - 1, sim_engine.waypoint_index + 1)
                            sim_engine.saved_waypoint_index = sim_engine.waypoint_index
                            target_wp = sim_engine.waypoints[sim_engine.waypoint_index]
                            wp_dx = target_wp[0] - x
                            wp_dy = target_wp[1] - y
                            wp_dz = target_wp[2] - z
                            dist_to_wp = math.hypot(wp_dx, wp_dy)

                        # Slow slightly in turns
                        target_speed = 1.8 if dist_to_wp < 1.2 else 2.5
                        desired_vx = (wp_dx / max(0.01, dist_to_wp)) * target_speed
                        desired_vy = (wp_dy / max(0.01, dist_to_wp)) * target_speed
                        desired_vz = max(-1.5, min(1.5, wp_dz * 2.0))

                        # Jerk-limited first-order velocity tracking
                        sim_engine.drone_vel[0] += (desired_vx - sim_engine.drone_vel[0]) * min(1.0, dt * 5.0)
                        sim_engine.drone_vel[1] += (desired_vy - sim_engine.drone_vel[1]) * min(1.0, dt * 5.0)
                        sim_engine.drone_vel[2] += (desired_vz - sim_engine.drone_vel[2]) * min(1.0, dt * 5.0)

                        # Add obstacle avoidance repulsive force
                        rfx, rfy, rfz = potential_field.compute_repulsive_force((x, y, z))
                        actual_vx = sim_engine.drone_vel[0] + rfx * 0.3
                        actual_vy = sim_engine.drone_vel[1] + rfy * 0.3
                        actual_vz = sim_engine.drone_vel[2] + rfz * 0.3

                        x = max(-14.8, min(14.8, x + actual_vx * dt))
                        y = max(-14.8, min(14.8, y + actual_vy * dt))
                        z = max(0.5, min(15.0, z + actual_vz * dt))
                        sim_engine.current_enu = [x, y, z]

                        heading_rad = math.atan2(actual_vx, actual_vy) if math.hypot(actual_vx, actual_vy) > 0.05 else 0.0
                        heading_deg = (math.degrees(heading_rad) + 360.0) % 360.0

                        # Check detection triggers for un-handled candidates
                        fov_radius = z * math.tan(math.radians(36.0)) # ~3.63m at 5.0m
                        best_vic = None
                        best_dist = 999.0

                        for vic in sim_engine.staged_victims:
                            vic_id = vic["id"]
                            if vic_id in sim_engine.confirmed_victims or vic_id in sim_engine.rejected_victims:
                                continue
                            vx, vy, _ = vic["enu"]
                            h_dist = math.hypot(x - vx, y - vy)
                            # Demo trigger: inside ground footprint AND horizontal dist < 2.5m
                            if h_dist <= fov_radius and h_dist < 2.5:
                                if h_dist < best_dist:
                                    best_dist = h_dist
                                    best_vic = vic

                        if best_vic is not None:
                            # 1. VICTIM_LOCKED: freeze waypoint progression, save waypointIndex
                            sim_engine.substate = "VICTIM_LOCKED"
                            sim_engine.active_victim = best_vic
                            sim_engine.saved_waypoint_index = sim_engine.waypoint_index

                            # 2. Compute hover point: Y=4.0m, >=2m from fire hazard, above obstacle
                            vx, vy, _ = best_vic["enu"]
                            hover_x, hover_y, hover_z = vx, vy, 4.0

                            # Fire hazard clearance (stay >= 2m horizontally from fire at 5.5, 6.5)
                            fire_dist = math.hypot(vx - 5.5, vy - 6.5)
                            if fire_dist < 2.0:
                                f_dx, f_dy = vx - 5.5, vy - 6.5
                                f_mag = max(0.01, math.hypot(f_dx, f_dy))
                                hover_x = 5.5 + (f_dx / f_mag) * 2.1
                                hover_y = 6.5 + (f_dy / f_mag) * 2.1

                            sim_engine.hover_target = [hover_x, hover_y, hover_z]
                            sim_engine.hover_stabilise_timer = 0.0
                            sim_engine.substate = "HOVER_STABILISING"

                            await hub.broadcast_envelope(hub.build_envelope("hover_progress", {
                                "victim_id": best_vic["id"],
                                "elapsed": 0.0,
                                "total": 5.5,
                                "state": "HOVER_STABILISING",
                            }))

                    elif sim_engine.substate == "HOVER_STABILISING":
                        # Move to hover point smoothly without teleporting
                        target_x, target_y, target_z = sim_engine.hover_target
                        hx_dx = target_x - x
                        hx_dy = target_y - y
                        hx_dz = target_z - z
                        pos_error = math.hypot(hx_dx, math.hypot(hx_dy, hx_dz))
                        curr_speed = math.hypot(sim_engine.drone_vel[0], math.hypot(sim_engine.drone_vel[1], sim_engine.drone_vel[2]))

                        desired_speed = min(1.8, pos_error * 1.6)
                        desired_vx = (hx_dx / max(0.01, pos_error)) * desired_speed
                        desired_vy = (hx_dy / max(0.01, pos_error)) * desired_speed
                        desired_vz = (hx_dz / max(0.01, pos_error)) * desired_speed

                        sim_engine.drone_vel[0] += (desired_vx - sim_engine.drone_vel[0]) * min(1.0, dt * 6.0)
                        sim_engine.drone_vel[1] += (desired_vy - sim_engine.drone_vel[1]) * min(1.0, dt * 6.0)
                        sim_engine.drone_vel[2] += (desired_vz - sim_engine.drone_vel[2]) * min(1.0, dt * 6.0)

                        x += sim_engine.drone_vel[0] * dt
                        y += sim_engine.drone_vel[1] * dt
                        z += sim_engine.drone_vel[2] * dt
                        sim_engine.current_enu = [x, y, z]

                        # Point heading toward victim
                        vic = sim_engine.active_victim
                        heading_deg = (math.degrees(math.atan2(vic["enu"][0] - x, vic["enu"][1] - y)) + 360.0) % 360.0

                        if not is_paused:
                            sim_engine.hover_stabilise_timer += dt

                        # 3. HOVER_STABILISING check: error < 0.3m and speed < 0.2m/s
                        if pos_error < 0.3 and curr_speed < 0.2:
                            sim_engine.substate = "HOVER_CONFIRMING"
                            sim_engine.hover_timer = 0.0
                            sim_engine.hover_positions = []
                            sim_engine.thermal_samples = []
                            await hub.broadcast_envelope(hub.build_envelope("hover_progress", {
                                "victim_id": vic["id"],
                                "elapsed": 0.0,
                                "total": 5.5,
                                "state": "HOVER_CONFIRMING",
                            }))
                        elif sim_engine.hover_stabilise_timer >= 10.0:
                            # 10s stabilisation timeout: abort to RESUME_PATROL
                            sim_engine.substate = "RESUME_PATROL"

                    elif sim_engine.substate == "HOVER_CONFIRMING":
                        # 4. HOVER_CONFIRMING (5.5 s sim time): freeze position, sample thermal signature
                        sim_engine.drone_vel = [0.0, 0.0, 0.0]
                        vic = sim_engine.active_victim
                        heading_deg = (math.degrees(math.atan2(vic["enu"][0] - x, vic["enu"][1] - y)) + 360.0) % 360.0

                        if not is_paused:
                            sim_engine.hover_timer += dt
                            sim_engine.hover_positions.append((x, y, z))
                            # Sample thermal render target simulation
                            sample_temp = vic.get("temp_c", 36.5 if vic.get("thermal") else 18.5)
                            sim_engine.thermal_samples.append(sample_temp)

                        # Broadcast live hover progress each frame
                        await hub.broadcast_envelope(hub.build_envelope("hover_progress", {
                            "victim_id": vic["id"],
                            "elapsed": round(min(5.5, sim_engine.hover_timer), 2),
                            "total": 5.5,
                            "state": "HOVER_CONFIRMING",
                        }))

                        if sim_engine.hover_timer >= 5.5:
                            # Check thermal samples: >=80% in human range (30 - 40 C)
                            human_samples = sum(1 for s in sim_engine.thermal_samples if 30.0 <= s <= 40.0)
                            ratio = human_samples / max(1, len(sim_engine.thermal_samples))

                            if ratio >= 0.80 and vic.get("thermal", False):
                                # 5. CONFIRMED: lock geotag, thermal_confirmed = True, risk score, alert
                                sim_engine.confirmed_victims.add(vic["id"])
                                avg_x = sum(p[0] for p in sim_engine.hover_positions) / len(sim_engine.hover_positions)
                                avg_y = sum(p[1] for p in sim_engine.hover_positions) / len(sim_engine.hover_positions)
                                vlat, vlon, _ = enu_to_geodetic(avg_x, avg_y)

                                det_dict = {
                                    "id": vic["id"],
                                    "detection_type": "person",
                                    "confidence": vic["confidence"],
                                    "bbox_x": 0.45,
                                    "bbox_y": 0.45,
                                    "bbox_w": 0.10,
                                    "bbox_h": 0.15,
                                    "thermal_confirmed": True,
                                    "status": "CONFIRMED",
                                    "latitude": round(vlat, 7),
                                    "longitude": round(vlon, 7),
                                    "altitude": 0.0,
                                    "stamp": latest_pose["stamp"],
                                }
                                store.insert(create_event("detection", det_dict, vic["id"]), synced=hub.is_link_connected)
                                await hub.broadcast_envelope(hub.build_envelope("detection", det_dict))

                                hazards = [r["payload"] for r in store.list("hazard")]
                                detections = [r["payload"] for r in store.list("detection")]
                                risk_res = core_score_detection(det_dict, hazards, detections)

                                risk_dict = {
                                    "detection_id": risk_res.detection_id,
                                    "score": risk_res.score,
                                    "priority_level": risk_res.priority_level,
                                    "reason": risk_res.reason,
                                    "explain": risk_res.explain,
                                }
                                store.insert(EventIn(event_id=f"risk-{vic['id']}", event_type="risk_score", payload=risk_dict), synced=hub.is_link_connected)
                                await hub.broadcast_envelope(hub.build_envelope("risk", risk_dict))

                                all_risks = sorted(store.list("risk_score"), key=lambda r: r["payload"]["score"], reverse=True)
                                await hub.broadcast_envelope(hub.build_envelope("priority", {"ranked": [r["payload"] for r in all_risks]}))

                                safe_path = route_planner.plan_path(BASE_LAT, BASE_LON, vlat, vlon)
                                await hub.broadcast_envelope(hub.build_envelope("route", {"survivor_id": vic["id"], "points": safe_path}))

                                alert_type = "CRITICAL_PRIORITY" if risk_res.priority_level == "CRITICAL" else "SURVIVOR_DETECTED"
                                alert_dict = {
                                    "alert_id": f"alert-{vic['id']}",
                                    "alert_type": alert_type,
                                    "message": f"{vic['desc']} ({risk_res.priority_level}): {risk_res.reason}",
                                    "latitude": round(vlat, 7),
                                    "longitude": round(vlon, 7),
                                    "stamp": latest_pose["stamp"],
                                }
                                store.insert(create_event("alert", alert_dict, alert_dict["alert_id"]), synced=hub.is_link_connected)
                                await hub.broadcast_envelope(hub.build_envelope("alert", alert_dict))

                                await hub.broadcast_envelope(hub.build_envelope("hover_progress", {
                                    "victim_id": vic["id"],
                                    "elapsed": 5.5,
                                    "total": 5.5,
                                    "state": "CONFIRMED",
                                }))
                            else:
                                # REJECTED: mannequin, debris, fire glow; added to blacklist
                                sim_engine.rejected_victims.add(vic["id"])
                                vlat, vlon, _ = enu_to_geodetic(vic["enu"][0], vic["enu"][1])

                                det_dict = {
                                    "id": vic["id"],
                                    "detection_type": "person",
                                    "confidence": vic["confidence"],
                                    "bbox_x": 0.45,
                                    "bbox_y": 0.45,
                                    "bbox_w": 0.10,
                                    "bbox_h": 0.15,
                                    "thermal_confirmed": False,
                                    "status": "REJECTED",
                                    "latitude": round(vlat, 7),
                                    "longitude": round(vlon, 7),
                                    "altitude": 0.0,
                                    "stamp": latest_pose["stamp"],
                                }
                                store.insert(create_event("detection", det_dict, vic["id"]), synced=hub.is_link_connected)
                                await hub.broadcast_envelope(hub.build_envelope("detection", det_dict))

                                alert_dict = {
                                    "alert_id": f"alert-rejected-{vic['id']}",
                                    "alert_type": "INFO",
                                    "message": f"Target {vic['id']} REJECTED: NO THERMAL MATCH (mannequin / non-biological)",
                                    "latitude": round(vlat, 7),
                                    "longitude": round(vlon, 7),
                                    "stamp": latest_pose["stamp"],
                                }
                                store.insert(create_event("alert", alert_dict, alert_dict["alert_id"]), synced=hub.is_link_connected)
                                await hub.broadcast_envelope(hub.build_envelope("alert", alert_dict))

                                await hub.broadcast_envelope(hub.build_envelope("hover_progress", {
                                    "victim_id": vic["id"],
                                    "elapsed": 5.5,
                                    "total": 5.5,
                                    "state": "REJECTED",
                                }))

                            # Transition to RESUME_PATROL
                            sim_engine.substate = "RESUME_PATROL"

                    elif sim_engine.substate == "RESUME_PATROL":
                        # 6. RESUME_PATROL: climb back to H=5.0m and rejoin saved waypoint
                        target_wp = sim_engine.waypoints[min(len(sim_engine.waypoints) - 1, sim_engine.saved_waypoint_index)]
                        dz = 5.0 - z
                        sim_engine.drone_vel[2] += (dz * 2.0 - sim_engine.drone_vel[2]) * min(1.0, dt * 4.0)
                        z += sim_engine.drone_vel[2] * dt

                        wp_dx = target_wp[0] - x
                        wp_dy = target_wp[1] - y
                        dist_to_wp = math.hypot(wp_dx, wp_dy)
                        desired_vx = (wp_dx / max(0.01, dist_to_wp)) * 2.2
                        desired_vy = (wp_dy / max(0.01, dist_to_wp)) * 2.2

                        sim_engine.drone_vel[0] += (desired_vx - sim_engine.drone_vel[0]) * min(1.0, dt * 4.0)
                        sim_engine.drone_vel[1] += (desired_vy - sim_engine.drone_vel[1]) * min(1.0, dt * 4.0)

                        x += sim_engine.drone_vel[0] * dt
                        y += sim_engine.drone_vel[1] * dt
                        sim_engine.current_enu = [x, y, z]

                        if z >= 4.7:
                            sim_engine.substate = "PATROLLING"
                            sim_engine.waypoint_index = sim_engine.saved_waypoint_index
                            sim_engine.active_victim = None
                            sim_engine.hover_target = None
                else:
                    x, y, z = sim_engine.current_enu
                    heading_deg = latest_pose["heading_deg"]

                plat, plon, palt = enu_to_geodetic(x, y, z)

                # Battery drain model
                latest_pose["battery_percent"] = max(5.0, round(98.5 - (sim_time * 0.12), 1))
                latest_mission_status["battery_percent"] = latest_pose["battery_percent"]
                total_wps = max(1, len(sim_engine.waypoints) - 1)
                latest_mission_status["coverage_percent"] = round((sim_engine.waypoint_index / total_wps) * 100.0, 1)
                latest_mission_status["substate"] = sim_engine.substate

                # GPS sensor model: Gaussian noise if GPS active; frozen if GPS-denied
                if latest_mission_status["nav_mode"] == "GPS_DENIED":
                    latest_pose["gps_fix"] = False
                    latest_pose["latitude"] = sim_engine.last_known_gps[0]
                    latest_pose["longitude"] = sim_engine.last_known_gps[1]
                else:
                    latest_pose["gps_fix"] = True
                    noisy_lat, noisy_lon = add_gps_noise(plat, plon, std_m=0.35)
                    sim_engine.last_known_gps = (round(noisy_lat, 7), round(noisy_lon, 7))
                    latest_pose["latitude"] = sim_engine.last_known_gps[0]
                    latest_pose["longitude"] = sim_engine.last_known_gps[1]

                latest_pose["altitude"] = round(z, 2)
                latest_pose["heading_deg"] = round(heading_deg, 1)
                latest_pose["speed_mps"] = round(math.hypot(sim_engine.drone_vel[0], math.hypot(sim_engine.drone_vel[1], sim_engine.drone_vel[2])), 2)
                latest_pose["pitch_deg"] = round(-sim_engine.drone_vel[1] * 4.0, 1)
                latest_pose["roll_deg"] = round(sim_engine.drone_vel[0] * 4.0, 1)
                latest_pose["yaw_deg"] = round(heading_deg, 1)
                latest_pose["stamp"] = {"sec": int(sim_time), "nanosec": int((sim_time % 1) * 1e9)}

                # Broadcast telemetry
                await hub.broadcast_envelope(hub.build_envelope("telemetry", latest_pose))

                # Check proximity triggers for staged hazards
                for haz in sim_engine.staged_hazards:
                    if haz["id"] not in sim_engine.triggered_hazards:
                        hx, hy = haz["enu"]
                        dist = math.hypot(x - hx, y - hy)
                        if dist <= 5.0:  # Sensor FOV threshold
                            sim_engine.triggered_hazards.add(haz["id"])
                            hlat, hlon, _ = enu_to_geodetic(hx, hy)
                            haz_dict = {
                                "id": haz["id"],
                                "hazard_type": haz["hazard_type"],
                                "confidence": haz["confidence"],
                                "latitude": round(hlat, 7),
                                "longitude": round(hlon, 7),
                                "radius_m": 8.0,
                                "stamp": latest_pose["stamp"],
                            }
                            store.insert(create_event("hazard", haz_dict, haz["id"]), synced=hub.is_link_connected)
                            route_planner.add_hazard(HazardZone(lat=hlat, lon=hlon, radius_m=3.0, safety_margin_m=1.5))
                            await hub.broadcast_envelope(hub.build_envelope("hazard", haz_dict))

                            alert_dict = {
                                "alert_id": f"alert-{haz['id']}",
                                "alert_type": "HAZARD_DETECTED",
                                "message": f"{haz['hazard_type'].upper()} hazard classified in sector",
                                "latitude": round(hlat, 7),
                                "longitude": round(hlon, 7),
                                "stamp": latest_pose["stamp"],
                            }
                            store.insert(create_event("alert", alert_dict, alert_dict["alert_id"]), synced=hub.is_link_connected)
                            await hub.broadcast_envelope(hub.build_envelope("alert", alert_dict))

                # Check failsafes (battery < 10% or geofence)
                dist_origin = math.hypot(x, y)
                report = vehicle_sm.check_failsafes(
                    battery_pct=latest_pose["battery_percent"],
                    dist_from_origin_m=dist_origin,
                    sim_time=sim_time,
                )
                if report:
                    store.save_safety_report(report.to_dict())
                    alert_dict = {
                        "alert_id": f"alert-{report.id}",
                        "alert_type": "FAILSAFE",
                        "message": f"Failsafe triggered [{report.trigger}]: {report.outcome}",
                        "latitude": round(plat, 7),
                        "longitude": round(plon, 7),
                        "stamp": latest_pose["stamp"],
                    }
                    store.insert(create_event("alert", alert_dict, alert_dict["alert_id"]), synced=hub.is_link_connected)
                    await hub.broadcast_envelope(hub.build_envelope("alert", alert_dict))

            # 1 Hz Heartbeat dispatch
            if (sim_time - last_hb_time) >= 1.0:
                last_hb_time = sim_time
                hb = vehicle_sm.generate_heartbeat(
                    battery_pct=latest_pose["battery_percent"],
                    link_connected=hub.is_link_connected,
                    nav_mode=latest_mission_status["nav_mode"],
                )
                await hub.broadcast_envelope(hub.build_envelope("heartbeat", hb))

                latest_mission_status["stamp"] = latest_pose["stamp"]
                await hub.broadcast_envelope(hub.build_envelope("mission_status", latest_mission_status))

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[BACKEND SIM ERROR]: {e}")
            await asyncio.sleep(0.5)


# ==============================================================================
# FastAPI Lifespan & Application Definition
# ==============================================================================
@asynccontextmanager
async def lifespan(_: FastAPI):
    loop = asyncio.get_running_loop()
    hub.register_loop(loop)
    init_ros2_bridge()

    sim_task = asyncio.create_task(standalone_sim_loop())
    yield
    sim_task.cancel()
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
@app.get("/api/health")
def health() -> dict:
    mode = "ros2" if ros_node is not None else "standalone"
    return {
        "status": "ok",
        "service": "aerosar-backend",
        "mode": mode,
        "ros2_active": ros_node is not None,
        "clients_connected": len(hub.clients),
        "link_connected": hub.is_link_connected,
        "database": str(DB_PATH),
    }


@app.get("/api/missions")
def list_missions() -> list[dict]:
    return store.list_missions()


@app.get("/api/missions/{mission_id}/replay")
def get_mission_replay(mission_id: str) -> list[dict]:
    frames = store.get_mission_replay(mission_id)
    if not frames:
        raise HTTPException(status_code=404, detail=f"Mission '{mission_id}' not found in replay storage")
    return frames


@app.get("/api/safety_reports")
def list_safety_reports() -> list[dict]:
    return store.list_safety_reports()


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
    return latest_mission_status


@app.get("/api/sync/status")
def get_sync_status() -> dict:
    return store.get_sync_status(is_online=hub.is_link_connected)


@app.post("/api/events")
async def ingest_event(event: EventIn) -> dict:
    created = await store_and_broadcast(event, event.event_type, event.payload)
    return {"event_id": event.event_id, "created": created}


@app.post("/api/hazards")
async def add_hazard(hazard: Hazard) -> dict:
    event = create_event("hazard", hazard, hazard.id)
    await store_and_broadcast(event, "hazard", hazard.model_dump(mode="json"))
    route_planner.add_hazard(HazardZone(lat=hazard.latitude, lon=hazard.longitude, radius_m=hazard.radius_m))
    alert = Alert(
        alert_type="HAZARD_DETECTED",
        message=f"{hazard.hazard_type.upper()} disaster hazard detected",
        latitude=hazard.latitude,
        longitude=hazard.longitude,
    )
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert", alert.model_dump(mode="json"))
    return event.model_dump(mode="json")


@app.post("/api/detections")
async def add_detection(detection: Detection) -> dict:
    event = create_event("detection", detection, detection.id)
    await store_and_broadcast(event, "detection", detection.model_dump(mode="json"))

    hazards = [row["payload"] for row in store.list("hazard")]
    detections = [row["payload"] for row in store.list("detection")]
    risk_res = core_score_detection(detection.model_dump(mode="json"), hazards, detections)

    risk_dict = {
        "detection_id": risk_res.detection_id,
        "score": risk_res.score,
        "priority_level": risk_res.priority_level,
        "reason": risk_res.reason,
        "explain": risk_res.explain,
    }
    risk_event = EventIn(event_id=f"risk-{detection.id}", event_type="risk_score", payload=risk_dict)
    await store_and_broadcast(risk_event, "risk", risk_dict)

    # Safe Route
    path = route_planner.plan_path(BASE_LAT, BASE_LON, detection.latitude, detection.longitude)
    await hub.broadcast_envelope(hub.build_envelope("route", {"survivor_id": detection.id, "points": path}))

    alert_type = "CRITICAL_PRIORITY" if risk_res.priority_level == "CRITICAL" else "SURVIVOR_DETECTED"
    alert = Alert(
        alert_type=alert_type,
        message=f"Survivor detected: {risk_res.reason}",
        latitude=detection.latitude,
        longitude=detection.longitude,
    )
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert", alert.model_dump(mode="json"))
    return {"detection": event.model_dump(mode="json"), "risk_score": risk_dict, "route": path}


@app.post("/api/mission/start")
async def mission_start() -> dict:
    sim_engine.start()
    latest_mission_status["state"] = "SEARCHING"
    await hub.broadcast_envelope(hub.build_envelope("mission_status", latest_mission_status))
    return {"success": True, "message": "Mission started successfully"}


@app.post("/api/mission/abort")
async def mission_abort() -> dict:
    sim_engine.rtl()
    latest_mission_status["state"] = "RETURNING"
    await hub.broadcast_envelope(hub.build_envelope("mission_status", latest_mission_status))
    return {"success": True, "message": "Mission abort initiated — returning to launch"}


@app.post("/api/debug/link/cut")
async def debug_link_cut() -> dict:
    hub.is_link_connected = False
    latest_mission_status["link_connected"] = False
    link_state = store.get_sync_status(is_online=False)
    await hub.broadcast_envelope(hub.build_envelope("link_state", link_state))
    alert = Alert(alert_type="LINK_LOST", message="OFFLINE — logging locally to SQLite buffer")
    store.insert(create_event("alert", alert, alert.alert_id), synced=False)
    return {"success": True, "link_connected": False}


@app.post("/api/debug/link/restore")
async def debug_link_restore() -> dict:
    hub.is_link_connected = True
    latest_mission_status["link_connected"] = True

    # Flush outbox in order and deduplicate
    flushed_items = store.flush_outbox()
    synced_count = len(flushed_items)

    for item in flushed_items:
        # Re-broadcast flushed items to online clients
        await hub.broadcast_envelope(hub.build_envelope(item["event_type"], item["payload"]))

    store.mark_all_synced()
    link_state = {"state": "CONNECTED", "queued_events": 0, "synced_events": synced_count}
    await hub.broadcast_envelope(hub.build_envelope("link_state", link_state))

    alert = Alert(alert_type="LINK_RESTORED", message=f"Link restored; {synced_count} queued events synchronized")
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert", alert.model_dump(mode="json"))
    return {"success": True, "link_connected": True, "synced_events": synced_count}


# Optional YOLO CPU inference endpoint
@app.post("/api/detect")
async def detect_frame(payload: Dict[str, Any]) -> dict:
    """
    Runs YOLOv8n inference if ultralytics is installed;
    falls back gracefully to synthetic detection if missing.
    """
    b64_data = payload.get("image_base64", "")
    if not b64_data:
        return {"mode": "synthetic", "detections": []}

    try:
        from ultralytics import YOLO
        # Initialize nano model
        model = YOLO("yolov8n.pt")
        img_bytes = base64.b64decode(b64_data.split(",")[-1])
        np_arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        results = model(img, conf=0.35, verbose=False)
        detections = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = model.names[cls_id]
                if cls_name == "person":
                    xyxy = box.xyxy[0].tolist()
                    detections.append({
                        "class": "person",
                        "confidence": round(float(box.conf[0]), 2),
                        "bbox": xyxy,
                    })
        return {"mode": "yolo", "detections": detections}
    except Exception as e:
        return {"mode": "synthetic", "fallback": True, "reason": str(e), "detections": []}


# ==============================================================================
# WebSocket Live Streaming Endpoints (/ws/live and /ws/dashboard)
# ==============================================================================
async def handle_websocket(websocket: WebSocket):
    await websocket.accept()
    hub.clients.append(websocket)

    async def send_init_envelope(msg_type: str, payload: dict):
        env = hub.build_envelope(msg_type, payload)
        store.record_replay_frame(
            mission_id=hub.mission_id,
            seq=env["seq"],
            sim_time=env["sim_time"],
            msg_type=env["type"],
            payload=env["payload"],
        )
        await websocket.send_json(env)

    # 1. Immediate link state
    sync_status = store.get_sync_status(is_online=hub.is_link_connected)
    await send_init_envelope("link_state", sync_status)

    # 2. Replay all active buffered detections, hazards, alerts
    for h in store.list("hazard"):
        await send_init_envelope("hazard", h["payload"])
    for d in store.list("detection"):
        await send_init_envelope("detection", d["payload"])
    for r in store.list("risk_score"):
        await send_init_envelope("risk", r["payload"])
    for a in store.list("alert"):
        await send_init_envelope("alert", a["payload"])

    # 3. Current telemetry and status
    await send_init_envelope("telemetry", latest_pose)
    await send_init_envelope("mission_status", latest_mission_status)

    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
            except Exception:
                await websocket.send_json({"error": "Invalid JSON format"})
                continue

            # Validate version v if envelope received
            if "v" in data:
                if data.get("v") != 1:
                    await websocket.send_json({
                        "error": "Unsupported protocol version",
                        "received_version": data.get("v"),
                        "supported_version": 1,
                    })
                    continue

            # Handle client commands with Pydantic validation
            cmd_action = None
            cmd_params = {}

            if data.get("type") == "cmd":
                raw_payload = data.get("payload", {})
                try:
                    cmd_model = WSCommandPayload(**raw_payload)
                    cmd_action = cmd_model.action
                    cmd_params = cmd_model.params
                except ValidationError:
                    cmd_action = raw_payload.get("action")
                    cmd_params = raw_payload.get("params", {})
            elif "action" in data:  # Direct command
                try:
                    cmd_model = WSCommandPayload(**data)
                    cmd_action = cmd_model.action
                    cmd_params = cmd_model.params
                except ValidationError:
                    cmd_action = data.get("action")
                    cmd_params = data.get("params", {})

            if cmd_action == "start":
                sim_engine.start()
            elif cmd_action == "pause":
                sim_engine.pause()
            elif cmd_action == "resume":
                sim_engine.resume()
            elif cmd_action == "rtl":
                sim_engine.rtl()
            elif cmd_action == "arm":
                vehicle_sm.arm()
            elif cmd_action == "disarm":
                vehicle_sm.disarm()
            elif cmd_action == "emergency_land":
                report = sim_engine.emergency_land(trigger="OPERATOR_COMMAND")
                if report:
                    store.save_safety_report(report.to_dict())
                    alert_dict = {
                        "alert_id": f"alert-{report.id}",
                        "alert_type": "FAILSAFE",
                        "message": f"Failsafe triggered [{report.trigger}]: {report.outcome}",
                        "latitude": latest_pose["latitude"],
                        "longitude": latest_pose["longitude"],
                        "stamp": latest_pose["stamp"],
                    }
                    store.insert(create_event("alert", alert_dict, alert_dict["alert_id"]), synced=hub.is_link_connected)
                    await hub.broadcast_envelope(hub.build_envelope("alert", alert_dict))
            elif cmd_action == "manual_input":
                vx = float(cmd_params.get("vx", 0.0))
                vy = float(cmd_params.get("vy", 0.0))
                vz = float(cmd_params.get("vz", 0.0))
                yaw_rate = float(cmd_params.get("yaw_rate", 0.0))
                sim_engine.apply_manual_input(vx, vy, vz, yaw_rate)
            elif cmd_action == "link_cut":
                hub.is_link_connected = False
                latest_mission_status["link_connected"] = False
                await websocket.send_json(hub.build_envelope("link_state", store.get_sync_status(is_online=False)))
            elif cmd_action == "link_restore":
                hub.is_link_connected = True
                latest_mission_status["link_connected"] = True
                flushed = store.flush_outbox()
                for item in flushed:
                    await hub.broadcast_envelope(hub.build_envelope(item["event_type"], item["payload"]))
                store.mark_all_synced()
                await hub.broadcast_envelope(hub.build_envelope("link_state", {"state": "CONNECTED", "queued_events": 0, "synced_events": len(flushed)}))
            elif cmd_action == "set_mode":
                if "low_power" in cmd_params:
                    hub.low_power = bool(cmd_params["low_power"])
                if "mode" in cmd_params:
                    mode_val = str(cmd_params["mode"])
                    latest_mission_status["nav_mode"] = mode_val
                    latest_pose["gps_fix"] = (mode_val != "GPS_DENIED")
            elif cmd_action == "set_flight_mode":
                flight_mode = str(cmd_params.get("mode", "AUTONOMOUS")).upper()
                sim_engine.set_flight_mode(flight_mode)
            elif cmd_action == "sync":
                synced = store.mark_all_synced()
                await websocket.send_json(hub.build_envelope("link_state", {"state": "CONNECTED", "queued_events": 0, "synced_events": synced}))
            elif cmd_action == "fast_forward":
                sim_engine.waypoint_index = int(cmd_params.get("waypoint_index", 2))

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
