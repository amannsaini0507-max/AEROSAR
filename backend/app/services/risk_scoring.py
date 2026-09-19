"""Explainable, deterministic rescue-priority scoring."""

from math import cos, radians, sqrt

from app.schemas import Detection, Hazard, RiskScore

MAX_RELEVANT_DISTANCE_M = 20.0
MAX_RELEVANT_COUNT = 5
CLUSTER_RADIUS_M = 10.0


def distance_m(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    """Small-area equirectangular distance, accurate enough for one simulated site."""
    latitude_scale = 111_320.0
    longitude_scale = latitude_scale * cos(radians((latitude_a + latitude_b) / 2))
    return sqrt(((latitude_b - latitude_a) * latitude_scale) ** 2 + ((longitude_b - longitude_a) * longitude_scale) ** 2)


def priority_for(score: float) -> str:
    if score >= 0.75:
        return "CRITICAL"
    if score >= 0.55:
        return "HIGH"
    if score >= 0.35:
        return "MEDIUM"
    return "LOW"


def build_reason(confidence: float, hazard_risk: float, survivor_count: int, thermal_confirmed: bool, priority: str) -> str:
    parts: list[str] = []
    if confidence >= 0.7:
        parts.append(f"high detection confidence ({confidence:.2f})")
    if hazard_risk >= 0.5:
        parts.append("located near an active hazard")
    if survivor_count > 1:
        parts.append(f"{survivor_count} survivors detected in cluster")
    if thermal_confirmed:
        parts.append("thermal-confirmed")
    return f"{priority}: " + ", ".join(parts or ["baseline detection factors"])


def score_detection(detection: Detection, hazards: list[Hazard], detections: list[Detection]) -> RiskScore:
    nearest_hazard = min(
        (distance_m(detection.latitude, detection.longitude, h.latitude, h.longitude) for h in hazards),
        default=MAX_RELEVANT_DISTANCE_M,
    )
    hazard_risk = max(0.0, min(1.0, 1 - nearest_hazard / MAX_RELEVANT_DISTANCE_M))
    survivors = sum(
        1 for other in detections
        if other.detection_type == "person"
        and distance_m(detection.latitude, detection.longitude, other.latitude, other.longitude) <= CLUSTER_RADIUS_M
    )
    survivors = max(1, survivors)
    count_factor = min(1.0, survivors / MAX_RELEVANT_COUNT)
    score = max(0.0, min(1.0, 0.35 * detection.confidence + 0.30 * hazard_risk + 0.20 * count_factor + (0.15 if detection.thermal_confirmed else 0.0)))
    priority = priority_for(score)
    return RiskScore(
        detection_id=detection.id,
        score=round(score, 3),
        priority_level=priority,
        reason=build_reason(detection.confidence, hazard_risk, survivors, detection.thermal_confirmed, priority),
    )
