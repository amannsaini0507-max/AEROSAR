"""
AEROSAR Synthetic & Edge Perception Engine.
Section 2 Compliance:
- Synthetic perception matching measured YOLOv8n benchmark:
  * Recall ~0.54 and precision 1.0 at conf threshold 0.35
  * Confidences drawn from roughly 0.30 - 0.55 for standard targets
  * Detection likelihood degrades deterministically with distance and occlusion
  * Victim 3 in Zone C exhibits thermal-confirmed high confidence (~0.88)
- Pinhole camera geotagging and standard Detection schema output
"""

import math
import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .geo import BASE_ALT, BASE_LAT, BASE_LON, enu_to_geodetic, geotag_detection


@dataclass
class GroundTruthVictim:
    id: str
    enu: Tuple[float, float]  # (x, y) meters in local arena
    base_confidence: float
    occlusion: float  # 0.0 (clear) to 1.0 (fully blocked)
    thermal_confirmed: bool
    description: str


class SyntheticPerceptionEngine:
    def __init__(self, seed: int = 42, fov_radius_m: float = 4.8):
        self.rng = random.Random(seed)
        self.fov_radius_m = fov_radius_m

        # Scene Ground Truth in 30x30 Arena
        self.victims: List[GroundTruthVictim] = [
            GroundTruthVictim(
                id="victim_1",
                enu=(-6.8, 6.2),
                base_confidence=0.50,
                occlusion=0.35,  # Concrete block occlusion in Zone A
                thermal_confirmed=False,
                description="Collapsed Ruins Victim",
            ),
            GroundTruthVictim(
                id="victim_2",
                enu=(7.2, 6.8),
                base_confidence=0.52,
                occlusion=0.15,  # Water refraction in Zone B
                thermal_confirmed=False,
                description="Flooded Basin Survivor",
            ),
            GroundTruthVictim(
                id="victim_3",
                enu=(5.5, -6.8),
                base_confidence=0.88,
                occlusion=0.05,  # Unobstructed thermal signature near fire in Zone C
                thermal_confirmed=True,
                description="Fire Zone Critical Survivor",
            ),
        ]
        self.detected_ids = set()

    def reset(self):
        self.detected_ids.clear()

    def evaluate_candidates(
        self,
        drone_x: float,
        drone_y: float,
        drone_z: float = 2.2,
        heading_deg: float = 0.0,
        sim_time: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        Evaluates perception model against ground truth from current vehicle pose.
        Returns list of newly detected, confirmed detection dictionaries.
        """
        new_detections: List[Dict[str, Any]] = []

        for vic in self.victims:
            vx, vy = vic.enu
            dist = math.hypot(drone_x - vx, drone_y - vy)

            if dist > self.fov_radius_m:
                continue

            # Distance falloff factor: closer is more detectable
            dist_factor = max(0.1, 1.0 - (dist / self.fov_radius_m) ** 1.5)
            # Visibility after obstacle occlusion
            vis_factor = max(0.1, 1.0 - vic.occlusion)

            # Probabilistic detection modeling measured YOLOv8n recall ~0.54
            if vic.id == "victim_3":
                # High-emissivity thermal signature ensures reliable detection near fire
                p_detect = 0.95
                conf = round(self.rng.uniform(0.85, 0.90), 2)
            else:
                p_detect = 0.54 * dist_factor * vis_factor
                conf = round(self.rng.uniform(0.35, 0.55), 2)

            if vic.id not in self.detected_ids:
                if self.rng.random() <= p_detect or dist <= 2.5:
                    self.detected_ids.add(vic.id)

                    vlat, vlon, _ = enu_to_geodetic(vx, vy, 0.0)
                    det_dict = {
                        "id": vic.id,
                        "detection_type": "person",
                        "confidence": conf,
                        "bbox_x": 0.45,
                        "bbox_y": 0.45,
                        "bbox_w": 0.10,
                        "bbox_h": 0.15,
                        "thermal_confirmed": vic.thermal_confirmed,
                        "latitude": round(vlat, 7),
                        "longitude": round(vlon, 7),
                        "altitude": 0.0,
                        "description": vic.description,
                        "stamp": {
                            "sec": int(sim_time),
                            "nanosec": int((sim_time % 1) * 1e9),
                        },
                    }
                    new_detections.append(det_dict)

        return new_detections
