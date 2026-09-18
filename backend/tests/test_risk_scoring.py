from app.schemas import Detection, Hazard
from app.services.risk_scoring import build_reason, priority_for, score_detection


def person(**overrides):
    base = {"id": "person-1", "confidence": 0.82, "thermal_confirmed": True, "latitude": 19.0760, "longitude": 72.8777}
    return Detection(**(base | overrides))


def test_priority_boundaries():
    assert priority_for(0.34) == "LOW"
    assert priority_for(0.35) == "MEDIUM"
    assert priority_for(0.55) == "HIGH"
    assert priority_for(0.75) == "CRITICAL"


def test_score_is_explainable_and_high_near_fire():
    detection = person()
    fire = Hazard(id="fire-1", hazard_type="fire", confidence=0.9, latitude=19.076036, longitude=72.8777)
    result = score_detection(detection, [fire], [detection])
    assert result.priority_level in {"HIGH", "CRITICAL"}
    assert "thermal-confirmed" in result.reason
    assert "active hazard" in result.reason


def test_reason_has_baseline_when_no_factor_is_notable():
    reason = build_reason(0.2, 0.0, 1, False, "LOW")
    assert reason == "LOW: baseline detection factors"
