#!/usr/bin/env python3
"""
AEROSAR Master Live Scenario & Telemetry Background Runner
Member 6 & Member 1 — Live Integration Engine
SIH 2026 — PS 26177

Continuously runs all 5 disaster scenarios and streams live telemetry:
  - Scenario 1: Flood Disaster & Survivor Ingestion
  - Scenario 2: Fire + Smoke Hazard + CRITICAL Risk Survivor + A* Safe Route
  - Scenario 3: Collapsed Building & Obstacle Avoidance
  - Scenario 4: GPS-Denied Zone Navigation & Recovery
  - Scenario 5: Network Severance & Resilient Offline SQLite Buffer Sync
"""

import json
import math
import os
import sys
import time
from urllib.request import Request, urlopen

# Add backend directory to sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Try ROS 2 integration if available
rclpy_available = False
try:
    import rclpy
    from rclpy.node import Node
    from sensor_msgs.msg import NavSatFix, NavSatStatus, Imu
    from std_msgs.msg import Bool
    from aerosar_msgs.msg import Hazard as RosHazard, Detection as RosDetection, Alert as RosAlert, MissionStatus as RosStatus
    rclpy_available = True
except Exception:
    rclpy_available = False

BASE_URL = "http://127.0.0.1:8000"
BASE_LAT = 26.9124
BASE_LON = 75.7873


def post_api(path: str, payload: dict) -> dict:
    url = f"{BASE_URL}{path}"
    req = Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=3.0) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}


def log_step(scenario: str, msg: str):
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] [{scenario}] {msg}", flush=True)


class LiveScenarioRunner:
    def __init__(self):
        self.ros_node = None
        if rclpy_available:
            try:
                if not rclpy.ok():
                    rclpy.init(args=None)
                self.ros_node = rclpy.create_node("master_live_scenario_runner")
                self.pub_gps = self.ros_node.create_publisher(NavSatFix, "/gps/fix", 10)
                self.pub_imu = self.ros_node.create_publisher(Imu, "/imu/data", 10)
                self.pub_hazard = self.ros_node.create_publisher(RosHazard, "/perception/hazard", 10)
                self.pub_det = self.ros_node.create_publisher(RosDetection, "/perception/detection", 10)
                self.pub_gps_denied = self.ros_node.create_publisher(Bool, "/aerosar/force_gps_denied", 10)
                print("[LIVE RUNNER] ROS 2 publisher initialized.", flush=True)
            except Exception as e:
                print(f"[LIVE RUNNER] ROS 2 init skipped: {e}", flush=True)

    def publish_ros_telemetry(self, lat: float, lon: float, alt: float = 15.0, heading_deg: float = 0.0, gps_valid: bool = True):
        if not self.ros_node:
            return
        try:
            fix = NavSatFix()
            fix.header.stamp = self.ros_node.get_clock().now().to_msg()
            fix.header.frame_id = "gps_link"
            if gps_valid:
                fix.status.status = NavSatStatus.STATUS_FIX
                fix.latitude = lat
                fix.longitude = lon
                fix.altitude = alt
            else:
                fix.status.status = NavSatStatus.STATUS_NO_FIX
                fix.latitude = float("nan")
                fix.longitude = float("nan")
                fix.altitude = float("nan")
            self.pub_gps.publish(fix)

            imu = Imu()
            imu.header.stamp = self.ros_node.get_clock().now().to_msg()
            imu.header.frame_id = "base_link"
            yaw_rad = math.radians(heading_deg)
            imu.orientation.z = math.sin(yaw_rad / 2.0)
            imu.orientation.w = math.cos(yaw_rad / 2.0)
            self.pub_imu.publish(imu)
            rclpy.spin_once(self.ros_node, timeout_sec=0.01)
        except Exception:
            pass

    def run_all_scenarios(self):
        print("\n" + "=" * 70, flush=True)
        print("  🚁 AEROSAR MASTER LIVE SCENARIO & TELEMETRY BACKGROUND RUNNER", flush=True)
        print("  Broadcasting live events to Dashboard (ws://localhost:8000) & ROS 2", flush=True)
        print("=" * 70 + "\n", flush=True)

        cycle = 1
        while True:
            log_step("MISSION", f"=== Starting Full Disaster Search Cycle #{cycle} ===")
            post_api("/api/mission/start", {})

            # -------------------------------------------------------------
            # STEP 1: Autonomous Search Grid & Initial Telemetry
            # -------------------------------------------------------------
            log_step("PATROL", "Drone airborne. Flying serpentine search pattern...")
            for step in range(1, 6):
                d_lat = (step * 0.0001)
                d_lon = (math.sin(step) * 0.00015)
                cur_lat = BASE_LAT + d_lat
                cur_lon = BASE_LON + d_lon
                self.publish_ros_telemetry(cur_lat, cur_lon, alt=15.0, heading_deg=step * 45.0)
                time.sleep(1.2)

            # -------------------------------------------------------------
            # SCENARIO 1: Flood Disaster & Survivor Ingestion
            # -------------------------------------------------------------
            log_step("SCENARIO 1", "Entering Flood Inundation Sector...")
            flood_lat = BASE_LAT + 0.0003
            flood_lon = BASE_LON + 0.0002
            self.publish_ros_telemetry(flood_lat, flood_lon, alt=14.0, heading_deg=90.0)

            post_api("/api/hazards", {
                "id": f"flood_zone_{cycle}",
                "hazard_type": "flood",
                "confidence": 0.94,
                "latitude": flood_lat,
                "longitude": flood_lon
            })
            log_step("SCENARIO 1", "⚠️ Flood Hazard geotagged & costmap updated.")
            time.sleep(2.0)

            post_api("/api/detections", {
                "id": f"victim_flood_edge_{cycle}",
                "detection_type": "person",
                "confidence": 0.89,
                "thermal_confirmed": True,
                "latitude": flood_lat + 0.00008,
                "longitude": flood_lon + 0.00008,
                "altitude": 1.5
            })
            log_step("SCENARIO 1", "👤 Survivor #1 detected at flood boundary (HIGH priority).")
            time.sleep(2.5)

            # -------------------------------------------------------------
            # SCENARIO 2: Fire + Smoke Hazard + CRITICAL Survivor + Safe Route
            # -------------------------------------------------------------
            log_step("SCENARIO 2", "Approaching active industrial fire sector...")
            fire_lat = BASE_LAT + 0.0001
            fire_lon = BASE_LON + 0.0003
            self.publish_ros_telemetry(fire_lat, fire_lon, alt=18.0, heading_deg=135.0)

            post_api("/api/hazards", {
                "id": f"fire_active_{cycle}",
                "hazard_type": "fire",
                "confidence": 0.97,
                "latitude": fire_lat,
                "longitude": fire_lon
            })
            post_api("/api/hazards", {
                "id": f"smoke_plume_{cycle}",
                "hazard_type": "smoke",
                "confidence": 0.86,
                "latitude": fire_lat + 0.00005,
                "longitude": fire_lon + 0.00005
            })
            log_step("SCENARIO 2", "🔥 FIRE & SMOKE disaster hazards registered.")
            time.sleep(2.0)

            res = post_api("/api/detections", {
                "id": f"survivor_fire_trap_{cycle}",
                "detection_type": "person",
                "confidence": 0.93,
                "thermal_confirmed": True,
                "latitude": fire_lat + 0.00004,
                "longitude": fire_lon + 0.00003,
                "altitude": 1.2
            })
            risk_info = res.get("risk_score", {})
            log_step("SCENARIO 2", f"🚨 CRITICAL SURVIVOR DETECTED: Score={risk_info.get('score')} | {risk_info.get('reason')}")
            log_step("SCENARIO 2", "🛣️ A* Safe Evacuation Route computed bypassing fire perimeter.")
            time.sleep(3.0)

            # -------------------------------------------------------------
            # SCENARIO 3: Collapsed Structure & Obstacle Avoidance
            # -------------------------------------------------------------
            log_step("SCENARIO 3", "Navigating toward collapsed masonry structure...")
            struct_lat = BASE_LAT - 0.0002
            struct_lon = BASE_LON + 0.0004
            self.publish_ros_telemetry(struct_lat, struct_lon, alt=12.0, heading_deg=210.0)

            post_api("/api/hazards", {
                "id": f"structure_collapse_{cycle}",
                "hazard_type": "damaged_structure",
                "confidence": 0.91,
                "latitude": struct_lat,
                "longitude": struct_lon
            })
            post_api("/api/hazards", {
                "id": f"debris_field_{cycle}",
                "hazard_type": "debris",
                "confidence": 0.84,
                "latitude": struct_lat - 0.00005,
                "longitude": struct_lon + 0.00005
            })
            log_step("SCENARIO 3", "🚧 Unstable structural rubble & debris detected. Executing obstacle standoff avoidance.")
            time.sleep(2.0)

            post_api("/api/detections", {
                "id": f"survivor_rubble_{cycle}",
                "detection_type": "person",
                "confidence": 0.82,
                "thermal_confirmed": True,
                "latitude": struct_lat + 0.00006,
                "longitude": struct_lon - 0.00004,
                "altitude": 1.0
            })
            log_step("SCENARIO 3", "👤 Survivor located trapped beside building collapse.")
            time.sleep(3.0)

            # -------------------------------------------------------------
            # SCENARIO 4: GPS-Denied Zone Entry & Recovery
            # -------------------------------------------------------------
            log_step("SCENARIO 4", "⚠️ Entering covered hangar/tunnel zone: Simulating GPS denial...")
            self.publish_ros_telemetry(struct_lat, struct_lon, gps_valid=False)
            if self.ros_node:
                flag = Bool()
                flag.data = True
                self.pub_gps_denied.publish(flag)
            log_step("SCENARIO 4", "📡 /gps/fix interrupted. Fallback engaged: IMU Dead-Reckoning & VIO Odometry.")
            time.sleep(3.5)

            log_step("SCENARIO 4", "☀️ Exiting covered structure: Reacquiring GNSS satellites...")
            if self.ros_node:
                flag.data = False
                self.pub_gps_denied.publish(flag)
            self.publish_ros_telemetry(BASE_LAT, BASE_LON, alt=15.0, heading_deg=0.0, gps_valid=True)
            log_step("SCENARIO 4", "✓ GPS Fix restored (Mode reverted to autonomous GPS waypoint navigation).")
            time.sleep(2.5)

            # -------------------------------------------------------------
            # SCENARIO 5: Network Disconnection & Offline Resilient Sync
            # -------------------------------------------------------------
            log_step("SCENARIO 5", "🔌 Simulating catastrophic command-link cut (Requirement 7 test)...")
            post_api("/api/debug/link/cut", {})
            log_step("SCENARIO 5", "Dashboard status: OFFLINE. Logging telemetry & events to on-drone SQLite buffer.")
            time.sleep(2.0)

            # Ingest events while offline
            post_api("/api/hazards", {
                "id": f"offline_gas_leak_{cycle}",
                "hazard_type": "toxic_gas",
                "confidence": 0.88,
                "latitude": BASE_LAT + 0.0002,
                "longitude": BASE_LON - 0.0002
            })
            post_api("/api/detections", {
                "id": f"survivor_offline_shelter_{cycle}",
                "detection_type": "person",
                "confidence": 0.85,
                "thermal_confirmed": True,
                "latitude": BASE_LAT + 0.00025,
                "longitude": BASE_LON - 0.00022,
                "altitude": 1.4
            })
            log_step("SCENARIO 5", "Queued 2 new disaster events into local offline SQLite buffer.")
            time.sleep(3.0)

            log_step("SCENARIO 5", "🟢 Telemetry link restored! Triggering automatic synchronization...")
            sync_res = post_api("/api/debug/link/restore", {})
            synced_cnt = sync_res.get("synced_events", 0)
            log_step("SCENARIO 5", f"⚡ Synchronization complete: {synced_cnt} queued events flushed to Dashboard in timestamp order.")

            log_step("MISSION", f"=== Completed Disaster Search Cycle #{cycle}. Pausing before next sweep ===")
            cycle += 1
            time.sleep(5.0)


def main():
    runner = LiveScenarioRunner()
    try:
        runner.run_all_scenarios()
    except KeyboardInterrupt:
        print("\n[LIVE RUNNER] Exiting on user request.")
    finally:
        if rclpy_available and rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
