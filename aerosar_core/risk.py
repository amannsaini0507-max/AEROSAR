"""
AEROSAR Rescue Priority Risk Scoring Engine.
Source of Truth: Master Document Section 11.
Deterministic, transparent, and explainable multi-factor risk evaluator.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from .geo import geo_distance_m

MAX_RELEVANT_DISTANCE: float = 20.0  # meters
MAX_RELEVANT_COUNT: int = 5
CLUSTER_RADIUS: float = 10.0  # meters


@dataclass
class RiskResult:
    detection_id: str
    score: float
    priority_level: str  # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    reason: str
    explain: List[str] = field(default_factory=list)


def priority_level_for(score: float) -> str:
    """Returns priority category per Section 11.4 thresholds."""
    if score >= 0.75:
        return "CRITICAL"
    if score >= 0.55:
        return "HIGH"
    if score >= 0.35:
        return "MEDIUM"
    return "LOW"


def build_reason(
    confidence: float,
    hazard_proximity_risk: float,
    survivor_count: int,
    thermal_confirmed: bool,
    priority_level: str,
) -> str:
    """Human-readable explanation string strictly matching Section 11.6."""
    parts = []
    if confidence >= 0.7:
        parts.append(f"high detection confidence ({confidence:.2f})")
    if hazard_proximity_risk >= 0.5:
        parts.append("located near an active hazard")
    if survivor_count > 1:
        parts.append(f"{survivor_count} survivors detected in cluster")
    if thermal_confirmed:
        parts.append("thermal-confirmed")
    if not parts:
        parts.append("baseline detection factors")
    return f"{priority_level}: " + ", ".join(parts)


def calculate_risk(
    detection_id: str,
    confidence: float,
    thermal_confirmed: bool,
    nearest_hazard_dist_m: float,
    cluster_survivor_count: int,
) -> RiskResult:
    """
    Computes exact risk score according to Section 11.3:
      score = clamp(0.35*C + 0.30*proximity + 0.20*cluster + thermal_bonus, 0, 1)
      proximity = clamp(1 - Dh/MAX_DIST, 0, 1)
      cluster = clamp(N/MAX_COUNT, 0, 1)
      thermal_bonus = 0.15 if T else 0.0
    """
    c_clamped = max(0.0, min(1.0, float(confidence)))
    dh = max(0.0, float(nearest_hazard_dist_m))
    n = max(1, int(cluster_survivor_count))

    hazard_proximity_risk = max(0.0, min(1.0, 1.0 - (dh / MAX_RELEVANT_DISTANCE)))
    survivor_count_factor = max(0.0, min(1.0, n / MAX_RELEVANT_COUNT))
    thermal_bonus = 0.15 if thermal_confirmed else 0.0

    c_contrib = 0.35 * c_clamped
    h_contrib = 0.30 * hazard_proximity_risk
    s_contrib = 0.20 * survivor_count_factor

    raw_score = c_contrib + h_contrib + s_contrib + thermal_bonus
    score = max(0.0, min(1.0, raw_score))
    rounded_score = round(score, 3)

    priority = priority_level_for(rounded_score)
    reason = build_reason(c_clamped, hazard_proximity_risk, n, thermal_confirmed, priority)

    explain = [
        f"Confidence ({c_clamped:.2f}): +{c_contrib:.3f}",
        f"Hazard proximity ({dh:.1f}m -> risk {hazard_proximity_risk:.2f}): +{h_contrib:.3f}",
        f"Cluster count ({n} survivors -> factor {survivor_count_factor:.2f}): +{s_contrib:.3f}",
        f"Thermal confirmation bonus: +{thermal_bonus:.3f}",
        f"Total score: {rounded_score:.3f} => {priority}",
    ]

    return RiskResult(
        detection_id=detection_id,
        score=rounded_score,
        priority_level=priority,
        reason=reason,
        explain=explain,
    )


def score_detection(
    detection: dict,
    hazards: List[dict],
    all_detections: List[dict],
) -> RiskResult:
    """
    Convenience evaluator operating on lists of detection and hazard dictionaries.
    Each detection dict requires: id, confidence, thermal_confirmed, latitude, longitude.
    Each hazard dict requires: latitude, longitude.
    """
    det_lat = detection.get("latitude", 0.0)
    det_lon = detection.get("longitude", 0.0)
    det_id = str(detection.get("id", "unknown"))
    conf = float(detection.get("confidence", 0.5))
    thermal = bool(detection.get("thermal_confirmed", False))

    # Nearest hazard distance
    nearest_hazard_dist = MAX_RELEVANT_DISTANCE
    for h in hazards:
        h_lat = h.get("latitude", 0.0)
        h_lon = h.get("longitude", 0.0)
        dist = geo_distance_m(det_lat, det_lon, h_lat, h_lon)
        if dist < nearest_hazard_dist:
            nearest_hazard_dist = dist

    # Cluster survivor count within CLUSTER_RADIUS
    cluster_count = 0
    for other in all_detections:
        if other.get("detection_type", "person") == "person":
            o_lat = other.get("latitude", 0.0)
            o_lon = other.get("longitude", 0.0)
            dist = geo_distance_m(det_lat, det_lon, o_lat, o_lon)
            if dist <= CLUSTER_RADIUS:
                cluster_count += 1
    cluster_count = max(1, cluster_count)

    return calculate_risk(
        detection_id=det_id,
        confidence=conf,
        thermal_confirmed=thermal,
        nearest_hazard_dist_m=nearest_hazard_dist,
        cluster_survivor_count=cluster_count,
    )
