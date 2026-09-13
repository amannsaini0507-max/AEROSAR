#!/usr/bin/env python3
"""
AEROSAR Member 1 All Scenarios & GPS-Denied Automated Verification Suite
Member 1 — Task 3 Verification Tool (Days 7–11)

Tests:
- Scenario 1: Flood + Survivors world (all topics + rates)
- Scenario 2: Fire + Smoke + Critical Survivor world (all topics + rates)
- Scenario 3: Collapsed Building + Survivor world (all topics + rates)
- Scenario 4: GPS-Denied Zone world & live /gps/fix broadcast interruption
"""

import os
import sys
import time
import subprocess
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import NavSatFix, Image, Imu
from std_msgs.msg import Bool
from geometry_msgs.msg import Twist

WS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLDS_DIR = os.path.join(WS_DIR, "src", "aerosar_sim", "worlds")

SCENARIOS = [
    ("Scenario 1 (Flood)", "scenario_1_flood.wbt"),
    ("Scenario 2 (Fire Critical)", "scenario_2_fire.wbt"),
    ("Scenario 3 (Collapsed)", "scenario_3_collapsed.wbt"),
    ("Scenario 4 (GPS-Denied)", "scenario_4_gps_denied.wbt")
]


def run_scenario_check(scenario_name, world_file):
    print("\n" + "=" * 70)
    print(f"  Testing {scenario_name}: {world_file}")
    print("=" * 70)

    world_path = os.path.join(WORLDS_DIR, world_file)
    if not os.path.isfile(world_path):
        print(f"  [FAIL] World file not found: {world_path}")
        return False

    print(f"  [1] World file verified exists: {world_file}")

    subprocess.run(["pkill", "-9", "webots"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-9", "driver"], stderr=subprocess.DEVNULL)
    time.sleep(1.0)

    # Launch Webots
    env = os.environ.copy()
    env["GALLIUM_DRIVER"] = "llvmpipe"
    env["LIBGL_ALWAYS_SOFTWARE"] = "1"
    env["LD_LIBRARY_PATH"] = f"/usr/local/webots/lib/controller:{env.get('LD_LIBRARY_PATH', '')}"
    env["WEBOTS_HOME"] = "/usr/local/webots"
    env["WEBOTS_CONTROLLER_URL"] = "tcp://127.0.0.1:1234/Mavic 2 PRO"
    env["PYTHONPATH"] = f"{WS_DIR}/install/aerosar_sim/lib/python3.10/site-packages:/usr/local/webots/lib/controller/python:{env.get('PYTHONPATH', '')}"
    env["AMENT_PREFIX_PATH"] = f"{WS_DIR}/install/aerosar_sim:{WS_DIR}/install/aerosar_msgs:{env.get('AMENT_PREFIX_PATH', '/opt/ros/humble')}"

    cmd_webots = [
        "webots", "--stdout", "--stderr", "--batch", "--mode=realtime", world_path
    ]
    webots_proc = subprocess.Popen(
        cmd_webots, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True
    )

    # Wait for Webots readiness
    ready = False
    start_wait = time.time()
    while time.time() - start_wait < 25.0:
        line = webots_proc.stdout.readline()
        if "Waiting for local or remote connection" in line:
            ready = True
            break
        if webots_proc.poll() is not None:
            break

    if not ready:
        print("  [FAIL] Webots failed to initialize within timeout.")
        webots_proc.kill()
        return False

    print(f"  [2] Webots simulation world loaded & extern controller port ready.")

    # Launch ROS 2 Driver
    cmd_driver = [
        "/opt/ros/humble/lib/webots_ros2_driver/driver",
        "--ros-args",
        "-p", f"robot_description:={WS_DIR}/install/aerosar_sim/share/aerosar_sim/resource/mavic_aerosar.urdf",
        "-r", "/camera/image_color:=/camera/image_raw",
        "-r", "/camera/image_raw/image_color:=/camera/image_raw",
        "-r", "/thermal/image_color:=/thermal/image_raw",
        "-r", "/thermal/image_raw/image_color:=/thermal/image_raw"
    ]
    driver_proc = subprocess.Popen(cmd_driver, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)

    # Allow driver to connect
    time.sleep(6.0)

    # ROS 2 Verification
    if not rclpy.ok():
        rclpy.init(args=None)

    check_node = rclpy.create_node(f'checker_{int(time.time() * 1000) % 100000}')

    received = {"camera": 0, "thermal": 0, "imu": 0, "gps": 0}
    check_node.create_subscription(Image, '/camera/image_raw', lambda m: received.__setitem__('camera', received['camera'] + 1), 10)
    check_node.create_subscription(Image, '/thermal/image_raw', lambda m: received.__setitem__('thermal', received['thermal'] + 1), 10)
    check_node.create_subscription(Imu, '/imu/data', lambda m: received.__setitem__('imu', received['imu'] + 1), 10)
    check_node.create_subscription(NavSatFix, '/gps/fix', lambda m: received.__setitem__('gps', received['gps'] + 1), 10)

    t_start = time.time()
    while time.time() - t_start < 12.0:
        rclpy.spin_once(check_node, timeout_sec=0.1)
        if received['camera'] > 0 and received['thermal'] > 0 and received['imu'] > 0 and received['gps'] > 0:
            # Let it spin a bit more to accumulate counts
            time.sleep(0.5)
            for _ in range(5):
                rclpy.spin_once(check_node, timeout_sec=0.1)
            break

    print(f"  [3] Sensor Streams Received:")
    print(f"      • /camera/image_raw:   {received['camera']} frames")
    print(f"      • /thermal/image_raw:  {received['thermal']} frames")
    print(f"      • /imu/data:           {received['imu']} samples")
    print(f"      • /gps/fix:            {received['gps']} fixes")

    all_passed = (received['camera'] > 0 and received['thermal'] > 0 and received['imu'] > 0 and received['gps'] > 0)
    if all_passed:
        print(f"  [PASS] All canonical sensor topics active & streaming in {scenario_name}!")
    else:
        print(f"  [WARN] Sensor verification partial in {scenario_name}")

    # For Scenario 4: Test GPS-Denied Interruption
    if "Scenario 4" in scenario_name:
        print(f"\n  [4] Executing Scenario 4 GPS-Denied Zone Interruption Verification:")
        gps_override_pub = check_node.create_publisher(Bool, '/aerosar/force_gps_denied', 10)
        
        # Trigger Cutoff: continuously publish override for 1 second while spinning
        msg_cut = Bool()
        msg_cut.data = True
        t_pub = time.time()
        while time.time() - t_pub < 1.0:
            gps_override_pub.publish(msg_cut)
            rclpy.spin_once(check_node, timeout_sec=0.1)
        print("      ⚠️ Triggered GPS-Denied zone entry -> Cut signal...")

        gps_during_cut = 0
        def _gps_counter(m):
            nonlocal gps_during_cut
            gps_during_cut += 1
        
        sub_cut = check_node.create_subscription(NavSatFix, '/gps/fix', _gps_counter, 10)
        t_cut = time.time()
        while time.time() - t_cut < 2.0:
            gps_override_pub.publish(msg_cut)
            rclpy.spin_once(check_node, timeout_sec=0.1)

        print(f"      • /gps/fix messages received while inside GPS-denied zone: {gps_during_cut}")
        gps_cut_ok = (gps_during_cut == 0)
        if gps_cut_ok:
            print("      [PASS] /gps/fix broadcast successfully INTERRUPTED in GPS-denied zone!")
        else:
            print("      [FAIL] GPS was not cut.")

        # Restore GPS
        msg_restore = Bool()
        msg_restore.data = False
        t_pub2 = time.time()
        while time.time() - t_pub2 < 1.0:
            gps_override_pub.publish(msg_restore)
            rclpy.spin_once(check_node, timeout_sec=0.1)
        print("      ☀️ Triggered GPS-Denied zone exit -> Restored signal...")
        
        gps_restored = 0
        def _gps_restore_counter(m):
            nonlocal gps_restored
            gps_restored += 1
        sub_restore = check_node.create_subscription(NavSatFix, '/gps/fix', _gps_restore_counter, 10)
        t_res = time.time()
        while time.time() - t_res < 3.0:
            gps_override_pub.publish(msg_restore)
            rclpy.spin_once(check_node, timeout_sec=0.1)
            if gps_restored > 0:
                break

        print(f"      • /gps/fix messages received after exiting zone: {gps_restored}")
        if gps_restored > 0:
            print("      [PASS] /gps/fix broadcast successfully RESTORED upon exiting zone!")

        all_passed = all_passed and gps_cut_ok and (gps_restored > 0)

    check_node.destroy_node()
    try:
        driver_proc.kill()
        webots_proc.kill()
        driver_proc.wait(timeout=3)
        webots_proc.wait(timeout=3)
    except Exception:
        pass
    subprocess.run(["pkill", "-9", "webots"], stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-9", "driver"], stderr=subprocess.DEVNULL)
    time.sleep(2.5)

    return all_passed


def main():
    print("=" * 72)
    print("  🛸 AEROSAR — Member 1 Task 3: Comprehensive Scenario Test Suite")
    print("  Testing Scenarios 1, 2, 3, and 4 in Webots + ROS 2 stack")
    print("=" * 72)

    results = {}
    for name, world in SCENARIOS:
        res = run_scenario_check(name, world)
        results[name] = res
        time.sleep(2.0)

    print("\n" + "=" * 72)
    print("  Task 3 All-Scenarios Verification Summary")
    print("=" * 72)
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    for name, ok in results.items():
        status = "[PASS]" if ok else "[FAIL]"
        print(f"  {status} {name:<35}")
    print(f"\n  Final Score: {passed}/{total} scenarios fully validated.")
    print("=" * 72 + "\n")

    if rclpy.ok():
        rclpy.shutdown()
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
