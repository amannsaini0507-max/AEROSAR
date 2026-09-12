#!/usr/bin/env python3
"""
AEROSAR Member 6 — Master Interactive Demo Controller
Member 6 — Integration, Hardware, & Testing Tool

Complete interactive command center for Member 6 to operate during the live demo:
- Control network cut / restore toggle (Requirement 7)
- Run Test Scenario 1 (Flood Zone & Survivors)
- Run Test Scenario 2 (Fire + Smoke + CRITICAL Survivor ★ Primary Demo)
- Run Test Scenario 3 (Collapsed Building & Obstacle Avoidance)
- Run Test Scenario 4 (GPS-Denied Mode Transition)
- Run Test Scenario 5 (Network Failure & Offline Resilience Sync)
- Execute Master Automated Test Benchmark Suite (All Tests)
- Run system health & ROS 2 topic audits
"""

import sys
import os
import time
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def clear_screen():
    os.system('clear' if os.name != 'nt' else 'cls')

def run_script(script_name, *args):
    script_path = os.path.join(SCRIPT_DIR, script_name)
    cmd = [sys.executable, script_path] + list(args)
    subprocess.run(cmd)

def main_menu():
    while True:
        clear_screen()
        print("=" * 72)
        print("  🛸 AEROSAR — MEMBER 6 MASTER INTERACTIVE DEMO CONTROLLER")
        print("  Master Control Panel for Live Presentation & Testing (Days 1–14)")
        print("=" * 72)
        print("\n  [1]  📡 Check Current Network Link Status")
        print("  [2]  🔌 CUT Network Connection  (Simulate Offline Mode for Req 7)")
        print("  [3]  🟢 RESTORE Network Connection (Trigger Queue Sync)")
        print("  [4]  🌊 Run Scenario 1: Flood Zone & Survivors")
        print("  [5]  🔥 Run Scenario 2: Fire + Smoke + CRITICAL Survivor ★ (PRIMARY DEMO)")
        print("  [6]  🏚️ Run Scenario 3: Collapsed Building & Obstacle Avoidance")
        print("  [7]  🛰️ Run Scenario 4: GPS-Denied Mode Transition (SLAM Local Mode)")
        print("  [8]  ⚡ Run Scenario 5: Network Failure & Offline Reconnection Sync")
        print("  [9]  🏆 RUN ALL 5 SCENARIOS (Master Test Matrix Benchmark)")
        print("  [10] 🚁 Launch Mock Drone Flight Telemetry Generator")
        print("  [11] 🩺 Run System Health & Integrity Audit")
        print("  [12] 📋 Verify Active ROS 2 Topics")
        print("  [0]  ❌ Exit Demo Controller\n")
        print("-" * 72)
        
        choice = input("Select an option (0-12): ").strip()
        print()
        
        if choice == "1":
            run_script("network_toggle.py", "status")
            input("\nPress Enter to return to menu...")
        elif choice == "2":
            run_script("network_toggle.py", "cut")
            input("\nPress Enter to return to menu...")
        elif choice == "3":
            run_script("network_toggle.py", "restore")
            input("\nPress Enter to return to menu...")
        elif choice == "4":
            run_script("scenario_1_flood.py")
            input("\nPress Enter to return to menu...")
        elif choice == "5":
            run_script("scenario_2_fire_critical.py")
            input("\nPress Enter to return to menu...")
        elif choice == "6":
            run_script("scenario_3_collapsed_building.py")
            input("\nPress Enter to return to menu...")
        elif choice == "7":
            run_script("scenario_4_gps_denied.py")
            input("\nPress Enter to return to menu...")
        elif choice == "8":
            run_script("scenario_5_network_failure.py")
            input("\nPress Enter to return to menu...")
        elif choice == "9":
            run_script("run_all_tests.py")
            input("\nPress Enter to return to menu...")
        elif choice == "10":
            run_script("mock_telemetry_publisher.py")
            input("\nPress Enter to return to menu...")
        elif choice == "11":
            run_script("system_health_check.py")
            input("\nPress Enter to return to menu...")
        elif choice == "12":
            run_script("verify_topics.py")
            input("\nPress Enter to return to menu...")
        elif choice == "0":
            print("Exiting Demo Controller. Good luck with AEROSAR!\n")
            sys.exit(0)
        else:
            print("Invalid selection. Please try again.")
            time.sleep(1)

if __name__ == "__main__":
    main_menu()
