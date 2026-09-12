#!/usr/bin/env python3
"""
AEROSAR Mock Telemetry & Detection Publisher
Member 6 — Integration & Testing Tool

Simulates a drone executing a serpentine search grid over a disaster zone.
Publishes live telemetry, battery drain, survivor detections (with thermal confirmation),
hazard markers, and emergency alerts.

Usage:
    python3 mock_telemetry_publisher.py
"""

import sys
import time
import math
import json
import random

# Center coordinates for simulated disaster search zone
BASE_LAT = 26.9124  # Example coordinates (Jaipur / disaster site)
BASE_LON = 75.7873
BASE_ALT = 15.0     # Flight altitude in meters

def generate_telemetry(step):
    # Simulate a serpentine (lawnmower) flight pattern
    sweep = (step // 20) % 5
    progress = (step % 20) / 20.0
    direction = 1 if sweep % 2 == 0 else -1
    
    offset_x = (sweep * 0.0003)
    offset_y = (direction * progress * 0.0010)
    
    current_lat = BASE_LAT + offset_x
    current_lon = BASE_LON + offset_y
    battery = max(100.0 - (step * 0.5), 10.0)
    coverage = min((step / 100.0) * 100.0, 100.0)
    
    return {
        "mission_id": "search-grid-01",
        "state": "SEARCHING",
        "latitude": round(current_lat, 6),
        "longitude": round(current_lon, 6),
        "altitude": BASE_ALT,
        "battery_percent": round(battery, 1),
        "coverage_percent": round(coverage, 1),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

def main():
    print("=" * 60)
    print("  AEROSAR Member 6 — Mock Telemetry & Detection Generator")
    print("  Simulates live drone flight, survivor & hazard detections")
    print("=" * 60 + "\n")
    
    step = 0
    try:
        while step < 100:
            telem = generate_telemetry(step)
            print(f"[{telem['timestamp']}] Drone Pos: ({telem['latitude']}, {telem['longitude']}) | Battery: {telem['battery_percent']}% | Coverage: {telem['coverage_percent']}%")
            
            # Event trigger: Survivor #1 encounter at step 15
            if step == 15:
                det = {
                    "id": "det-survivor-01",
                    "detection_type": "person",
                    "confidence": 0.88,
                    "thermal_confirmed": True,
                    "latitude": telem['latitude'],
                    "longitude": telem['longitude'],
                    "altitude": telem['altitude'],
                    "timestamp": telem['timestamp']
                }
                print(f"  [SURVIVOR DETECTED] Person found! Thermal Confirmed: YES at ({det['latitude']}, {det['longitude']})")
            
            # Event trigger: Fire hazard encounter at step 30
            if step == 30:
                haz = {
                    "id": "haz-fire-01",
                    "hazard_type": "fire",
                    "confidence": 0.92,
                    "latitude": telem['latitude'],
                    "longitude": telem['longitude'],
                    "timestamp": telem['timestamp']
                }
                print(f"  [HAZARD DETECTED] Active Fire hazard at ({haz['latitude']}, {haz['longitude']})")
            
            # Event trigger: Critical Survivor near fire at step 35
            if step == 35:
                risk = {
                    "detection_id": "det-survivor-02",
                    "score": 0.85,
                    "priority_level": "CRITICAL",
                    "reason": "CRITICAL: high confidence (0.89), thermal-confirmed, 4m from active fire"
                }
                print(f"  [CRITICAL RISK ALERT] Survivor #2 scored CRITICAL! Reason: {risk['reason']}")
            
            time.sleep(1.0)
            step += 1
            
    except KeyboardInterrupt:
        print("\n[Mock Publisher] Simulation stopped by user.")

if __name__ == "__main__":
    main()
