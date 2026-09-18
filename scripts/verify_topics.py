#!/usr/bin/env python3
"""
AEROSAR ROS 2 Topic Verification Script
Member 6 — Integration & Testing Tool

Verifies that all canonical AEROSAR topics specified in topic_interface_spec.md
are properly registered and active.
"""

import sys
import subprocess

EXPECTED_TOPICS = [
    "/camera/image_raw",
    "/thermal/image_raw",
    "/imu/data",
    "/gps/fix",
    "/perception/person",
    "/perception/hazard",
    "/perception/detection",
    "/navigation/cmd_vel",
    "/rescue/risk_score",
    "/alerts/emergency",
    "/mission/status"
]

def main():
    print("=" * 60)
    print("  AEROSAR Member 6 — Topic Integration Checker")
    print("=" * 60)
    
    try:
        res = subprocess.run(["ros2", "topic", "list"], capture_output=True, text=True, check=True)
        active_topics = set(res.stdout.strip().split("\n"))
        print(f"\nTotal Active ROS 2 Topics Found: {len(active_topics)}\n")
        
        found = 0
        for topic in EXPECTED_TOPICS:
            if topic in active_topics:
                print(f" [PASS] {topic:<30} -> ACTIVE")
                found += 1
            else:
                print(f" [MISS] {topic:<30} -> NOT FOUND")
        
        print("\n" + "-" * 60)
        print(f"Verification Summary: {found}/{len(EXPECTED_TOPICS)} canonical topics active.")
        print("-" * 60)
    except FileNotFoundError:
        print("[WARNING] `ros2` command not found in environment. Ensure ROS 2 environment is sourced.")
        print("Expected Topics List:")
        for t in EXPECTED_TOPICS:
            print(f"  - {t}")

if __name__ == "__main__":
    main()
