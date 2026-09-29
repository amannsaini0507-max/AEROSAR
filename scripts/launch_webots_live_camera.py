#!/usr/bin/env python3
"""
AEROSAR Webots Simulation & Live Camera Bridge Daemon (Persistent)
Member 1 & Member 4 — Live Vision Seam
SIH 2026 — PS 26177

Persistently runs Webots simulation and streams real-time RGB and Thermal
camera frames directly into ROS 2 (/camera/image_raw) and the Command Center
Dashboard WebSocket feed. Includes automatic recovery and continuous streaming.
"""

import os
import sys
import time
import subprocess
import signal

WS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLD_PATH = os.path.join(WS_DIR, "src", "aerosar_sim", "worlds", "world_scenario_2_fire.wbt")

# Configure environment for Webots Mesa rendering and controller IPC
os.environ["GALLIUM_DRIVER"] = "llvmpipe"
os.environ["LIBGL_ALWAYS_SOFTWARE"] = "1"
os.environ["WEBOTS_HOME"] = "/usr/local/webots"
os.environ["LD_LIBRARY_PATH"] = f"/usr/local/webots/lib/controller:{os.environ.get('LD_LIBRARY_PATH', '')}"
os.environ["WEBOTS_CONTROLLER_URL"] = "tcp://127.0.0.1:1234/Mavic 2 PRO"

webots_python = "/usr/local/webots/lib/controller/python"
if webots_python not in sys.path:
    sys.path.insert(0, webots_python)

sim_pkgs = os.path.join(WS_DIR, "install", "aerosar_sim", "lib", "python3.10", "site-packages")
if sim_pkgs not in sys.path:
    sys.path.insert(0, sim_pkgs)

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from builtin_interfaces.msg import Time as RosTime


def cleanup():
    subprocess.run(["pkill", "-9", "-f", "webots-bin"], stderr=subprocess.DEVNULL)
    time.sleep(1.0)


def run_session(node, cam_pub, thermal_pub):
    cleanup()

    cmd_webots = [
        "webots", WORLD_PATH, "--batch", "--mode=realtime", "--port=1234", "--stdout", "--stderr"
    ]
    print(f"[WEBOTS] Starting Webots simulation (world: {os.path.basename(WORLD_PATH)})...", flush=True)
    webots_proc = subprocess.Popen(
        cmd_webots,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=os.environ.copy()
    )

    ready = False
    start_time = time.time()
    while time.time() - start_time < 20.0:
        line = webots_proc.stdout.readline()
        if "Waiting for local or remote connection" in line:
            ready = True
            break
        if webots_proc.poll() is not None:
            break

    if not ready:
        print("[WEBOTS ERROR] Webots failed to bind port 1234.", flush=True)
        if webots_proc:
            webots_proc.kill()
        return False

    time.sleep(0.5)

    try:
        from controller import Robot
        robot = Robot()
        print(f"[WEBOTS] Connected to drone: {robot.getName()}", flush=True)

        timestep = int(robot.getBasicTimeStep())
        cam = robot.getDevice("camera")
        thermal_cam = robot.getDevice("thermal_camera")

        if cam:
            cam.enable(timestep)
            print(f"[WEBOTS] RGB Camera enabled: {cam.getWidth()}x{cam.getHeight()}", flush=True)
        if thermal_cam:
            thermal_cam.enable(timestep)
            print(f"[WEBOTS] Thermal Camera enabled: {thermal_cam.getWidth()}x{thermal_cam.getHeight()}", flush=True)

        print("[WEBOTS] ★ LIVE CAMERA STREAMING ACTIVE TO /camera/image_raw & DASHBOARD ★", flush=True)

        frame_count = 0
        last_log = time.time()

        while rclpy.ok():
            step_res = robot.step(timestep)
            if step_res == -1:
                print("[WEBOTS WARN] Simulation step returned -1 (simulation completed/reset).", flush=True)
                break

            now = time.time()
            now_stamp = RosTime()
            now_stamp.sec = int(now)
            now_stamp.nanosec = int((now % 1.0) * 1e9)

            # Publish RGB frame
            if cam:
                rgb_data = cam.getImage()
                if rgb_data:
                    msg = Image()
                    msg.header.stamp = now_stamp
                    msg.header.frame_id = "camera_link"
                    msg.height = cam.getHeight()
                    msg.width = cam.getWidth()
                    msg.encoding = "bgra8"
                    msg.is_bigendian = 0
                    msg.step = cam.getWidth() * 4
                    msg.data = bytes(rgb_data)
                    cam_pub.publish(msg)
                    frame_count += 1

            # Publish Thermal frame
            if thermal_cam:
                thermal_data = thermal_cam.getImage()
                if thermal_data:
                    t_msg = Image()
                    t_msg.header.stamp = now_stamp
                    t_msg.header.frame_id = "thermal_camera_link"
                    t_msg.height = thermal_cam.getHeight()
                    t_msg.width = thermal_cam.getWidth()
                    t_msg.encoding = "bgra8"
                    t_msg.is_bigendian = 0
                    t_msg.step = thermal_cam.getWidth() * 4
                    t_msg.data = bytes(thermal_data)
                    thermal_pub.publish(t_msg)

            rclpy.spin_once(node, timeout_sec=0.001)

            if now - last_log >= 5.0:
                print(f"[WEBOTS CAMERA] Streaming ~{frame_count / 5.0:.1f} FPS (Frames: {frame_count})", flush=True)
                frame_count = 0
                last_log = now

    except Exception as e:
        print(f"[WEBOTS ERROR] Error in simulation session: {e}", flush=True)
    finally:
        print("[WEBOTS] Cleaning up session...", flush=True)
        if webots_proc:
            try:
                webots_proc.kill()
            except Exception:
                pass
        cleanup()
    return True


def main():
    print("=" * 65, flush=True)
    print("  🎥 AEROSAR WEBOTS PERSISTENT LIVE CAMERA BRIDGE DAEMON", flush=True)
    print(f"  World: {os.path.basename(WORLD_PATH)}", flush=True)
    print("=" * 65 + "\n", flush=True)

    if not rclpy.ok():
        rclpy.init(args=None)

    node = rclpy.create_node("webots_live_camera_bridge")
    cam_pub = node.create_publisher(Image, "/camera/image_raw", 10)
    thermal_pub = node.create_publisher(Image, "/thermal/image_raw", 10)

    try:
        session = 1
        while rclpy.ok():
            print(f"\n[WEBOTS SUPERVISOR] Launching Simulation Session #{session}...", flush=True)
            run_session(node, cam_pub, thermal_pub)
            session += 1
            print("[WEBOTS SUPERVISOR] Session ended. Restarting in 2.0s to maintain continuous live feed...", flush=True)
            time.sleep(2.0)
    except KeyboardInterrupt:
        print("\n[WEBOTS] Exiting on user request.", flush=True)
    finally:
        if node:
            node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        cleanup()


if __name__ == "__main__":
    main()
