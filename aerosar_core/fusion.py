"""
AEROSAR Sensor Fusion & Spatial Deduplication Engine.
Merges RGB candidates with thermal signature verification and IMU/GPS geotagging.
Deduplicates detections within a 5.0m spatial radius and 15s time window.
"""

import math
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from .geo import geo_distance_m, geotag_detection


@dataclass
class FusedDetection:
    id: str
    detection_type: str
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    thermal_confirmed: bool
    latitude: float
    longitude: float
    altitude: float
    timestamp: float
    hit_count: int = 1


class SensorFusionEngine:
    def __init__(
        self,
        dedup_radius_m: float = 5.0,
        dedup_window_s: float = 15.0,
    ):
        self.dedup_radius_m = dedup_radius_m
        self.dedup_window_s = dedup_window_s
        self.detections: Dict[str, FusedDetection] = {}

    def process_candidate(
        self,
        candidate_id: str,
        detection_type: str,
        confidence: float,
        bbox: Tuple[float, float, float, float],  # (x, y, w, h)
        drone_pose: Dict[str, float],             # lat, lon, alt, heading
        thermal_confirmed: bool = False,
        timestamp: Optional[float] = None,
    ) -> Tuple[FusedDetection, bool]:
        """
        Geotags candidate, matches against existing detections within dedup radius.
        Returns (FusedDetection, is_new: bool).
        """
        now = timestamp if timestamp is not None else time.time()
        bx, by, bw, bh = bbox

        lat, lon = geotag_detection(
            drone_lat=drone_pose.get("latitude", 26.9124),
            drone_lon=drone_pose.get("longitude", 75.7873),
            drone_alt=drone_pose.get("altitude", 1.5),
            heading_deg=drone_pose.get("heading_deg", 0.0),
            bbox_x_norm=bx + bw / 2.0,
            bbox_y_norm=by + bh / 2.0,
        )

        # Spatial-temporal deduplication check
        matched: Optional[FusedDetection] = None
        for existing in self.detections.values():
            if existing.detection_type == detection_type:
                dist = geo_distance_m(lat, lon, existing.latitude, existing.longitude)
                time_diff = abs(now - existing.timestamp)
                if dist <= self.dedup_radius_m and time_diff <= self.dedup_window_s:
                    matched = existing
                    break

        if matched is not None:
            # Reinforce existing detection
            matched.hit_count += 1
            # Update confidence if higher
            matched.confidence = max(matched.confidence, confidence)
            if thermal_confirmed:
                matched.thermal_confirmed = True
            matched.timestamp = now
            return matched, False
        else:
            new_det = FusedDetection(
                id=candidate_id,
                detection_type=detection_type,
                confidence=confidence,
                bbox_x=bx,
                bbox_y=by,
                bbox_w=bw,
                bbox_h=bh,
                thermal_confirmed=thermal_confirmed,
                latitude=round(lat, 7),
                longitude=round(lon, 7),
                altitude=round(drone_pose.get("altitude", 1.5), 2),
                timestamp=now,
                hit_count=1,
            )
            self.detections[candidate_id] = new_det
            return new_det, True

    def get_all_detections(self) -> List[FusedDetection]:
        return list(self.detections.values())
