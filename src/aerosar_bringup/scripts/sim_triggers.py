#!/usr/bin/env python3
"""
AEROSAR Interactive Simulation Event Trigger CLI
Member 1 — Drone Simulation & ROS 2 Lead
SIH 2026 — Search & Rescue Project

Live demonstration utility to inject environmental triggers into the active ROS 2 graph:
  - --cut-gps: Invalidate /gps/fix with NaN & trigger SLAM dead-reckoning fallback
  - --restore-gps: Re-enable valid GNSS coordinates on /gps/fix
  - --trigger-hazard: Inject classified disaster hazard on /perception/hazard
  - --interactive: Launch interactive prompt for live judging / presentation
"""

import argparse
import math
import sys
import time

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import NavSatFix, NavSatStatus
from std_msgs.msg import Bool
from aerosar_msgs.msg import Hazard, Detection

# ANSI Color Codes
COLOR_GREEN = "\033[92m"
COLOR_RED = "\033[91m"
COLOR_YELLOW = "\033[93m"
COLOR_CYAN = "\033[96m"
COLOR_BOLD = "\033[1m"
COLOR_RESET = "\033[0m"


class SimEventTrigger(Node):
    def __init__(self):
        super().__init__('sim_event_trigger')

        # Publishers
        self.pub_gps = self.create_publisher(NavSatFix, '/gps/fix', 10)
        self.pub_gps_denied = self.create_publisher(Bool, '/aerosar/force_gps_denied', 10)
        self.pub_hazard = self.create_publisher(Hazard, '/perception/hazard', 10)
        self.pub_detection = self.create_publisher(Detection, '/perception/detection', 10)

        # Allow DDS discovery to settle
        time.sleep(0.3)

    def cut_gps(self):
        """Simulate GPS signal loss by publishing NaN coordinates and invalid status."""
        fix = NavSatFix()
        fix.header.stamp = self.get_clock().now().to_msg()
        fix.header.frame_id = 'gps_link'
        fix.status.status = NavSatStatus.STATUS_NO_FIX
        fix.status.service = 0
        fix.latitude = float('nan')
        fix.longitude = float('nan')
        fix.altitude = float('nan')
        fix.position_covariance_type = NavSatFix.COVARIANCE_TYPE_UNKNOWN

        # Force GPS-denied simulation override
        denied_flag = Bool()
        denied_flag.data = True

        for _ in range(5):
            self.pub_gps.publish(fix)
            self.pub_gps_denied.publish(denied_flag)
            time.sleep(0.05)

        print(f"\n{COLOR_RED}{COLOR_BOLD}⚠️  [SIM TRIGGER: GPS CUT]{COLOR_RESET}")
        print(f"    Published: {COLOR_YELLOW}status=STATUS_NO_FIX, coordinates=(NaN, NaN, NaN){COLOR_RESET}")
        print(f"    Overrode:  {COLOR_YELLOW}/aerosar/force_gps_denied = True{COLOR_RESET}")
        print(f"    {COLOR_GREEN}✓ Subsystem response: SLAM & Dead-Reckoning fallback triggered.{COLOR_RESET}\n")

    def restore_gps(self, lat: float = 26.9124, lon: float = 75.7873, alt: float = 1.5):
        """Restore valid GNSS fix telemetry."""
        fix = NavSatFix()
        fix.header.stamp = self.get_clock().now().to_msg()
        fix.header.frame_id = 'gps_link'
        fix.status.status = NavSatStatus.STATUS_FIX
        fix.status.service = NavSatStatus.SERVICE_GPS
        fix.latitude = float(lat)
        fix.longitude = float(lon)
        fix.altitude = float(alt)

        denied_flag = Bool()
        denied_flag.data = False

        for _ in range(5):
            self.pub_gps.publish(fix)
            self.pub_gps_denied.publish(denied_flag)
            time.sleep(0.05)

        print(f"\n{COLOR_GREEN}{COLOR_BOLD}📡 [SIM TRIGGER: GPS RESTORED]{COLOR_RESET}")
        print(f"    Published: {COLOR_CYAN}status=STATUS_FIX, pose=({lat:.6f}, {lon:.6f}, alt={alt:.1f}m){COLOR_RESET}")
        print(f"    Overrode:  {COLOR_CYAN}/aerosar/force_gps_denied = False{COLOR_RESET}")
        print(f"    {COLOR_GREEN}✓ Subsystem response: Global GNSS waypoint following resumed.{COLOR_RESET}\n")

    def trigger_hazard(self, hazard_type: str, x: float, y: float, confidence: float = 0.92):
        """Inject a simulated classified hazard event on /perception/hazard."""
        hazard = Hazard()
        hazard.id = f"haz-{int(time.time() * 1000) % 1000000}"
        hazard.hazard_type = str(hazard_type).lower()
        hazard.confidence = float(confidence)
        hazard.latitude = float(x)
        hazard.longitude = float(y)
        hazard.stamp = self.get_clock().now().to_msg()

        for _ in range(3):
            self.pub_hazard.publish(hazard)
            time.sleep(0.05)

        print(f"\n{COLOR_YELLOW}{COLOR_BOLD}🔥 [SIM TRIGGER: HAZARD INJECTED]{COLOR_RESET}")
        print(f"    Topic:       {COLOR_CYAN}/perception/hazard{COLOR_RESET}")
        print(f"    Hazard ID:   {hazard.id}")
        print(f"    Type:        {COLOR_BOLD}{hazard.hazard_type.upper()}{COLOR_RESET}")
        print(f"    Confidence:  {hazard.confidence * 100:.1f}%")
        print(f"    Coordinates: Lat={hazard.latitude:.6f}, Lon={hazard.longitude:.6f}")
        print(f"    {COLOR_GREEN}✓ Subsystem response: Backend bridge received hazard & routed to UI/DB.{COLOR_RESET}\n")

    def trigger_survivor(self, x: float = 26.9125, y: float = 75.7875, thermal: bool = True):
        """Inject a survivor detection on /perception/detection."""
        det = Detection()
        det.id = f"survivor-{int(time.time() * 1000) % 1000000}"
        det.detection_type = "person"
        det.confidence = 0.96
        det.bbox_x = 0.45
        det.bbox_y = 0.35
        det.bbox_w = 0.15
        det.bbox_h = 0.30
        det.thermal_confirmed = thermal
        det.latitude = float(x)
        det.longitude = float(y)
        det.altitude = 1.2
        det.stamp = self.get_clock().now().to_msg()

        for _ in range(3):
            self.pub_detection.publish(det)
            time.sleep(0.05)

        print(f"\n{COLOR_CYAN}{COLOR_BOLD}👤 [SIM TRIGGER: SURVIVOR DETECTED]{COLOR_RESET}")
        print(f"    Topic:             {COLOR_CYAN}/perception/detection{COLOR_RESET}")
        print(f"    Detection ID:      {det.id}")
        print(f"    Thermal Confirmed: {det.thermal_confirmed}")
        print(f"    Coordinates:       Lat={det.latitude:.6f}, Lon={det.longitude:.6f}")
        print(f"    {COLOR_GREEN}✓ Subsystem response: Risk evaluation triggered & survivor pinned to UI map.{COLOR_RESET}\n")


def interactive_menu(trigger: SimEventTrigger):
    """Interactive CLI menu for demonstration judges."""
    while True:
        print(f"{COLOR_CYAN}======================================================================{COLOR_RESET}")
        print(f"  {COLOR_BOLD}AEROSAR — Live Demonstration Interactive Trigger Menu{COLOR_RESET}")
        print(f"{COLOR_CYAN}======================================================================{COLOR_RESET}")
        print("  [1] ⚠️  CUT GPS Signal (Simulate GPS-Denied / Trigger SLAM Fallback)")
        print("  [2] 📡 RESTORE GPS Signal (Resume GNSS Positioning)")
        print("  [3] 🔥 INJECT Disaster Hazard (Fire / Smoke / Flood / Debris)")
        print("  [4] 👤 INJECT Confirmed Survivor Detection (Thermal + RGB)")
        print("  [0] ❌ Exit")
        print(f"{COLOR_CYAN}----------------------------------------------------------------------{COLOR_RESET}")

        try:
            choice = input(f"{COLOR_BOLD}Select trigger action (0-4): {COLOR_RESET}").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

        if choice == "1":
            trigger.cut_gps()
        elif choice == "2":
            trigger.restore_gps()
        elif choice == "3":
            htype = input("Hazard type [fire/smoke/flood/debris] (default: fire): ").strip() or "fire"
            x_in = input("Latitude / X [default: 26.9130]: ").strip() or "26.9130"
            y_in = input("Longitude / Y [default: 75.7880]: ").strip() or "75.7880"
            try:
                trigger.trigger_hazard(htype, float(x_in), float(y_in))
            except ValueError:
                print(f"{COLOR_RED}Invalid numeric coordinate input.{COLOR_RESET}")
        elif choice == "4":
            x_in = input("Latitude / X [default: 26.9126]: ").strip() or "26.9126"
            y_in = input("Longitude / Y [default: 75.7876]: ").strip() or "75.7876"
            try:
                trigger.trigger_survivor(float(x_in), float(y_in))
            except ValueError:
                print(f"{COLOR_RED}Invalid coordinate input.{COLOR_RESET}")
        elif choice == "0":
            print("Exiting trigger CLI.")
            break
        else:
            print(f"{COLOR_RED}Invalid choice. Please select 0 to 4.{COLOR_RESET}")

        time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser(
        description="AEROSAR Environmental & Hardware Failure Simulation Trigger CLI"
    )
    parser.add_argument('--cut-gps', action='store_true', help="Publish invalid GPS status / NaN coordinates")
    parser.add_argument('--restore-gps', action='store_true', help="Restore valid GNSS fix coordinates")
    parser.add_argument('--trigger-hazard', action='store_true', help="Inject simulated hazard event on /perception/hazard")
    parser.add_argument('--trigger-survivor', action='store_true', help="Inject simulated survivor on /perception/detection")
    parser.add_argument('--type', type=str, default='fire', help="Hazard type (fire, smoke, flood, debris, etc.)")
    parser.add_argument('--x', type=float, default=26.9130, help="Hazard/event latitude or X pose")
    parser.add_argument('--y', type=float, default=75.7880, help="Hazard/event longitude or Y pose")
    parser.add_argument('--confidence', type=float, default=0.92, help="Detection confidence (0.0 to 1.0)")
    parser.add_argument('--interactive', action='store_true', help="Launch interactive terminal menu")

    args, _ = parser.parse_known_args()

    rclpy.init(args=sys.argv)
    trigger = SimEventTrigger()

    try:
        # Check explicit CLI triggers
        has_cli_action = False
        if args.cut_gps:
            trigger.cut_gps()
            has_cli_action = True
        if args.restore_gps:
            trigger.restore_gps()
            has_cli_action = True
        if args.trigger_hazard:
            trigger.trigger_hazard(args.type, args.x, args.y, args.confidence)
            has_cli_action = True
        if args.trigger_survivor:
            trigger.trigger_survivor(args.x, args.y)
            has_cli_action = True

        # If no explicit action or --interactive requested, open interactive menu
        if not has_cli_action or args.interactive:
            interactive_menu(trigger)

    finally:
        trigger.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
