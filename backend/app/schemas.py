"""HTTP and WebSocket data contracts for the AEROSAR backend."""

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Detection(APIModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    detection_type: str = "person"
    confidence: float = Field(ge=0, le=1)
    bbox_x: float = 0
    bbox_y: float = 0
    bbox_w: float = 0
    bbox_h: float = 0
    thermal_confirmed: bool = False
    latitude: float
    longitude: float
    altitude: float = 0
    stamp: datetime = Field(default_factory=utc_now)

    @field_validator("detection_type")
    @classmethod
    def only_person_for_rescue_queue(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("detection_type cannot be empty")
        return value.strip().lower()


class Hazard(APIModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    hazard_type: Literal["fire", "smoke", "flood", "debris", "damaged_structure", "landslide"]
    confidence: float = Field(ge=0, le=1)
    latitude: float
    longitude: float
    stamp: datetime = Field(default_factory=utc_now)


class MissionStatus(APIModel):
    mission_id: str = "search-01"
    state: Literal["IDLE", "SEARCHING", "RETURNING", "COMPLETE"] = "IDLE"
    battery_percent: float = Field(ge=0, le=100)
    coverage_percent: float = Field(ge=0, le=100)
    link_connected: bool
    stamp: datetime = Field(default_factory=utc_now)


class EventIn(APIModel):
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    event_type: Literal["detection", "hazard", "alert", "status", "risk_score"]
    payload: dict[str, Any]
    created_at: datetime = Field(default_factory=utc_now)


class Alert(APIModel):
    alert_id: str = Field(default_factory=lambda: str(uuid4()))
    alert_type: Literal["SURVIVOR_DETECTED", "HAZARD_DETECTED", "CRITICAL_PRIORITY", "LINK_LOST", "LINK_RESTORED"]
    message: str
    latitude: float = 0
    longitude: float = 0
    stamp: datetime = Field(default_factory=utc_now)


class RiskScore(APIModel):
    detection_id: str
    score: float = Field(ge=0, le=1)
    priority_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    reason: str
