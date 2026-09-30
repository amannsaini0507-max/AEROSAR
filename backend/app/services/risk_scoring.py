"""
Explainable, deterministic rescue-priority scoring.
Delegates directly to aerosar_core.risk to ensure zero duplicated logic.
"""

from aerosar_core.risk import (
    calculate_risk,
    score_detection as core_score_detection,
    MAX_RELEVANT_DISTANCE,
    MAX_RELEVANT_COUNT,
    CLUSTER_RADIUS,
    priority_level_for,
    build_reason,
)
from app.schemas import Detection, Hazard, RiskScore


def priority_for(score: float) -> str:
    return priority_level_for(score)


def score_detection(detection: Detection, hazards: list[Hazard], detections: list[Detection]) -> RiskScore:
    det_dict = detection.model_dump(mode="json") if hasattr(detection, "model_dump") else dict(detection)
    haz_dicts = [h.model_dump(mode="json") if hasattr(h, "model_dump") else dict(h) for h in hazards]
    all_det_dicts = [d.model_dump(mode="json") if hasattr(d, "model_dump") else dict(d) for d in detections]

    res = core_score_detection(det_dict, haz_dicts, all_det_dicts)
    return RiskScore(
        detection_id=res.detection_id,
        score=res.score,
        priority_level=res.priority_level,
        reason=res.reason,
        explain=res.explain,
    )
