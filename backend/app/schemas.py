"""HTTP and WebSocket data contracts for the AEROSAR backend."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Union
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_stamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, dict):
        sec = value.get("sec", 0)
        nanosec = value.get("nanosec", 0)
        if sec > 0:
            return datetime.fromtimestamp(sec + nanosec * 1e-9, tz=timezone.utc)
        return utc_now()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except Exception:
            return utc_now()
    return utc_now()


class APIModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Detection(APIModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    detection_type: str = "person"
    confidence: float = Field(ge=0, le=1)
    bbox_x: float = 0
    bbox_y: float = 0
    bbox_w: float = 0
    bbox_h: float = 0
    thermal_confirmed: bool = False
    status: Literal["UNCONFIRMED", "VERIFYING", "CONFIRMED", "REJECTED"] = "UNCONFIRMED"
    latitude: float
    longitude: float
    altitude: float = 0
    stamp: datetime = Field(default_factory=utc_now)

    @field_validator("stamp", mode="before")
    @classmethod
    def validate_stamp(cls, v: Any) -> datetime:
        return parse_stamp(v)

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
    radius_m: float = 8.0
    stamp: datetime = Field(default_factory=utc_now)

    @field_validator("stamp", mode="before")
    @classmethod
    def validate_stamp(cls, v: Any) -> datetime:
        return parse_stamp(v)


class MissionStatus(APIModel):
    mission_id: str = "search-01"
    state: str = "IDLE"
    substate: Optional[str] = "PATROLLING"
    battery_percent: float = Field(ge=0, le=100)
    coverage_percent: float = Field(ge=0, le=100)
    link_connected: bool = True
    nav_mode: str = "GPS_NAV"
    stamp: datetime = Field(default_factory=utc_now)

    @field_validator("stamp", mode="before")
    @classmethod
    def validate_stamp(cls, v: Any) -> datetime:
        return parse_stamp(v)


class HoverProgress(APIModel):
    victim_id: str
    elapsed: float
    total: float = 5.5
    state: str


class EventIn(APIModel):
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    event_type: Literal["detection", "hazard", "alert", "status", "risk_score", "hover_progress"]
    payload: dict[str, Any]
    created_at: datetime = Field(default_factory=utc_now)

    @field_validator("created_at", mode="before")
    @classmethod
    def validate_created_at(cls, v: Any) -> datetime:
        return parse_stamp(v)


class Alert(APIModel):
    alert_id: str = Field(default_factory=lambda: str(uuid4()))
    alert_type: str = "INFO"
    message: str
    latitude: float = 0
    longitude: float = 0
    stamp: datetime = Field(default_factory=utc_now)

    @field_validator("stamp", mode="before")
    @classmethod
    def validate_stamp(cls, v: Any) -> datetime:
        return parse_stamp(v)


class RiskScore(APIModel):
    detection_id: str
    score: float = Field(ge=0, le=1)
    priority_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    reason: str
    explain: List[str] = Field(default_factory=list)


# ==============================================================================
# WebSocket v1 Protocol Schema
# ==============================================================================
class WSEnvelope(APIModel):
    v: int = Field(default=1, description="Protocol version, must be 1")
    type: str
    seq: int = 0
    sim_time: float = 0.0
    payload: Dict[str, Any] = Field(default_factory=dict)


class WSCommandPayload(APIModel):
    action: Literal[
        "start",
        "pause",
        "resume",
        "rtl",
        "arm",
        "disarm",
        "emergency_land",
        "manual_input",
        "link_cut",
        "link_restore",
        "set_mode",
        "set_flight_mode",
        "sync",
    ]
    params: Dict[str, Any] = Field(default_factory=dict)
