#!/usr/bin/env python3
"""
AEROSAR Network Cut/Restore Toggle Script
Member 6 — Integration & Testing Tool

Usage:
    python3 network_toggle.py cut     # Simulates link failure (offline mode)
    python3 network_toggle.py restore # Restores link connection (sync mode)
    python3 network_toggle.py status  # Displays current link state
"""

import sys
import os
import json
import time

STATE_FILE = os.path.expanduser("~/.aerosar_network_state.json")

def set_state(connected: bool):
    data = {
        "link_connected": connected,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    with open(STATE_FILE, "w") as f:
        json.dump(data, f, indent=2)
    state_str = "CONNECTED (Online)" if connected else "DISCONNECTED (Offline Mode Active)"
    print(f"[AEROSAR Network Toggle] Link state updated to: {state_str}")

def get_state():
    if not os.path.exists(STATE_FILE):
        return True
    try:
        with open(STATE_FILE, "r") as f:
            data = json.load(f)
            return data.get("link_connected", True)
    except Exception:
        return True

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    cmd = sys.argv[1].lower()
    if cmd == "cut":
        set_state(False)
    elif cmd == "restore":
        set_state(True)
    elif cmd == "status":
        state = get_state()
        print(f"[AEROSAR Network Status] Link Connected: {state}")
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)

if __name__ == "__main__":
    main()
