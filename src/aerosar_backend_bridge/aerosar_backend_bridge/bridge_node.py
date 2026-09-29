#!/usr/bin/env python3
"""
AEROSAR Member 4 — Backend & Data Integration Bridge Node
Subscribes:
  - /perception/detection (aerosar_msgs/Detection)
  - /perception/hazard (aerosar_msgs/Hazard)
  - /rescue/risk_score (aerosar_msgs/RiskScore)
  - /alerts/emergency (aerosar_msgs/Alert)
  - /mission/status (aerosar_msgs/MissionStatus)
  - /gps/fix (sensor_msgs/NavSatFix)
  - /imu/data (sensor_msgs/Imu)
  - /camera/image_raw (sensor_msgs/Image)
Launches the FastAPI command center server (port 8000) and broadcasts live telemetry.
"""

import sys
import os
import socket
import threading
import time
from pathlib import Path

# Add backend directory to sys.path
current_path = Path(__file__).resolve()
backend_found = False
for p in [current_path] + list(current_path.parents):
    candidate = p / "backend"
    if (candidate / "app" / "main.py").exists():
        if str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))
        backend_found = True
        break
if not backend_found and Path("/home/saksh/aerosar_ws_native/backend").exists():
    sys.path.insert(0, "/home/saksh/aerosar_ws_native/backend")

import rclpy
from rclpy.node import Node


def is_port_in_use(port: int = 8000) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def start_fastapi_server():
    if is_port_in_use(8000):
        print("[BRIDGE] FastAPI server already running on port 8000.")
        return
    import uvicorn
    print("[BRIDGE] Launching FastAPI backend server on http://0.0.0.0:8000 ...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, log_level="warning")


def main(args=None):
    # 1. Start FastAPI server in a background thread
    server_thread = threading.Thread(target=start_fastapi_server, daemon=True)
    server_thread.start()
    time.sleep(1.0)

    # 2. Initialize ROS 2
    if not rclpy.ok():
        rclpy.init(args=args)

    # Import backend app to register with running hub
    try:
        from app.main import ros_node
        if ros_node is not None:
            # Already spinning in thread via lifespan
            print("[BRIDGE] ROS 2 Bridge Node is active and streaming live.")
            try:
                while rclpy.ok():
                    time.sleep(1.0)
            except KeyboardInterrupt:
                pass
            return
    except Exception:
        pass

    # If standalone node needed
    class StandaloneBridgeNode(Node):
        def __init__(self):
            super().__init__('aerosar_backend_bridge')
            self.get_logger().info('Standalone AerosarBackendBridgeNode active.')

    node = StandaloneBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
