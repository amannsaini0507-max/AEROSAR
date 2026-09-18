#!/usr/bin/env python3
"""
AEROSAR Master Automated Integration & Test Matrix Runner
Member 6 — Integration & Testing Tool

Executes the full test matrix across all 5 disaster scenarios, audits system health,
tests database queue integrity, and outputs a complete Pass/Fail report.
"""

import sys
import os
import subprocess
import time

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

SCENARIO_SCRIPTS = [
    ("system_health_check.py", "System Health & File Integrity Audit"),
    ("scenario_1_flood.py", "Scenario 1: Flood Zone & Survivors"),
    ("scenario_2_fire_critical.py", "Scenario 2: Fire + Smoke + CRITICAL Survivor ★"),
    ("scenario_3_collapsed_building.py", "Scenario 3: Collapsed Building & Obstacle Avoidance"),
    ("scenario_4_gps_denied.py", "Scenario 4: GPS-Denied Mode Transition"),
    ("scenario_5_network_failure.py", "Scenario 5: Network Failure & Sync (Req 7)"),
    ("test_offline_sync.py", "Offline SQLite Queue Synchronization Test"),
    ("test_navigation_member3.py", "Member 3: Navigation & Obstacle Avoidance Suite")
]

def main():
    print("=" * 70)
    print("  🛸 AEROSAR — MEMBER 6 MASTER AUTOMATED TEST MATRIX RUNNER")
    print("  Full Pre-Integration Benchmark Suite (Days 11–13)")
    print("=" * 70 + "\n")
    
    results = []
    start_time = time.time()
    
    for script_name, description in SCENARIO_SCRIPTS:
        script_path = os.path.join(SCRIPT_DIR, script_name)
        print(f"\n[TESTING] {description} ({script_name})...")
        print("-" * 70)
        
        try:
            res = subprocess.run([sys.executable, script_path], capture_output=True, text=True, encoding='utf-8', errors='replace', check=True)
            if res.stdout:
                print(res.stdout.strip())
            results.append((description, "PASS [OK]"))
        except subprocess.CalledProcessError as e:
            if e.stdout:
                print(e.stdout.strip())
            if e.stderr:
                print(e.stderr.strip())
            results.append((description, "FAIL [ERR]"))
            
    elapsed = round(time.time() - start_time, 2)
    
    print("\n" + "=" * 70)
    print("  MASTER TEST MATRIX EXECUTION SUMMARY")
    print(f"  Total Execution Time: {elapsed} seconds")
    print("=" * 70)
    
    total_passed = 0
    for name, status in results:
        print(f"  • {name:<55} -> {status}")
        if "PASS" in status:
            total_passed += 1
            
    print("-" * 70)
    print(f"  Final Benchmark Score: {total_passed}/{len(results)} Passed ({int(total_passed/len(results)*100)}% Success Rate)")
    print("=" * 70 + "\n")

if __name__ == "__main__":
    main()
