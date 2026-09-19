"""Post a complete fire-survivor and offline/reconnect demo to a running backend."""

import json
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8000"


def post(path: str, payload: dict) -> None:
    request = Request(f"{BASE_URL}{path}", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request) as response:
        print(response.read().decode())


if __name__ == "__main__":
    post("/api/mission/status", {"mission_id": "search-01", "state": "SEARCHING", "battery_percent": 88, "coverage_percent": 32, "link_connected": True})
    post("/api/hazards", {"id": "hazard-fire-1", "hazard_type": "fire", "confidence": 0.96, "latitude": 19.076000, "longitude": 72.877700})
    post("/api/detections", {"id": "survivor-1", "detection_type": "person", "confidence": 0.89, "thermal_confirmed": True, "latitude": 19.076036, "longitude": 72.877700, "altitude": 15})
    post("/api/mission/status", {"mission_id": "search-01", "state": "SEARCHING", "battery_percent": 85, "coverage_percent": 48, "link_connected": False})
    post("/api/mission/status", {"mission_id": "search-01", "state": "SEARCHING", "battery_percent": 84, "coverage_percent": 52, "link_connected": True})
