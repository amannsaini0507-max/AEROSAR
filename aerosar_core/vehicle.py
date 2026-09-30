"""
AEROSAR Vehicle State Machine, Failsafe Engine & Safety Report Generator.
Section 3 Compliance:
- Strict state transitions: DISARMED -> ARMED -> IN_FLIGHT -> RTL_RETURNING -> DISARMED
- EMERGENCY_LAND accessible from any airborne state
- Validation with structured error return (no uncaught exceptions)
- Failsafe triggers: low battery (<10%), geofence breach, operator command
- Structured safety incident logging
- 1 Hz heartbeat synthesis
"""

import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class VehicleState(str, Enum):
    DISARMED = "DISARMED"
    ARMED = "ARMED"
    IN_FLIGHT = "IN_FLIGHT"
    RTL_RETURNING = "RTL_RETURNING"
    EMERGENCY_LAND = "EMERGENCY_LAND"


@dataclass
class SafetyReport:
    id: str
    sim_time: float
    trigger: str  # "BATTERY_LOW" | "GEOFENCE_BREACH" | "OPERATOR_COMMAND" | "COMM_TIMEOUT"
    state_before: str
    state_after: str
    inputs: Dict[str, Any]
    outcome: str
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class VehicleStateMachine:
    """
    Guarantees valid flight transitions and triggers automated failsafes.
    Returns structured results dict `{"success": bool, "state": str, "error": Optional[str]}`.
    """

    # Allowed transitions map: current_state -> set of valid next states
    VALID_TRANSITIONS = {
        VehicleState.DISARMED: {VehicleState.ARMED},
        VehicleState.ARMED: {VehicleState.DISARMED, VehicleState.IN_FLIGHT},
        VehicleState.IN_FLIGHT: {VehicleState.RTL_RETURNING, VehicleState.EMERGENCY_LAND},
        VehicleState.RTL_RETURNING: {VehicleState.DISARMED, VehicleState.EMERGENCY_LAND},
        VehicleState.EMERGENCY_LAND: {VehicleState.DISARMED},
    }

    def __init__(
        self,
        battery_failsafe_pct: float = 10.0,
        geofence_max_dist_m: float = 22.0,  # 30m arena = 15m radius + 7m margin
    ):
        self.state: VehicleState = VehicleState.DISARMED
        self.battery_failsafe_pct = battery_failsafe_pct
        self.geofence_max_dist_m = geofence_max_dist_m
        self.safety_reports: List[SafetyReport] = []
        self.heartbeat_seq: int = 0
        self.last_heartbeat_time: float = 0.0

    def transition_to(
        self,
        new_state: VehicleState,
        command: str = "manual",
        sim_time: float = 0.0,
        inputs: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Attempts state transition. Returns structured dict:
          {"success": True/False, "state": state_str, "error": str_or_none}
        """
        if new_state == self.state:
            return {"success": True, "state": self.state.value, "error": None}

        allowed = self.VALID_TRANSITIONS.get(self.state, set())
        if new_state not in allowed:
            err_msg = (
                f"Illegal state transition from {self.state.value} to {new_state.value} "
                f"via command '{command}'"
            )
            return {
                "success": False,
                "state": self.state.value,
                "error": err_msg,
            }

        prev_state = self.state.value
        self.state = new_state
        return {
            "success": True,
            "state": self.state.value,
            "prev_state": prev_state,
            "error": None,
        }

    # Command handlers
    def arm(self) -> Dict[str, Any]:
        return self.transition_to(VehicleState.ARMED, command="arm")

    def disarm(self) -> Dict[str, Any]:
        return self.transition_to(VehicleState.DISARMED, command="disarm")

    def start_flight(self) -> Dict[str, Any]:
        return self.transition_to(VehicleState.IN_FLIGHT, command="start")

    def return_to_launch(self) -> Dict[str, Any]:
        return self.transition_to(VehicleState.RTL_RETURNING, command="rtl")

    def trigger_failsafe(
        self,
        trigger: str,
        sim_time: float,
        inputs: Dict[str, Any],
        outcome: str = "Immediate emergency descent and motor shutdown upon touchdown",
    ) -> Tuple[Dict[str, Any], Optional[SafetyReport]]:
        """
        Executes immediate transition to EMERGENCY_LAND and creates structured safety report.
        """
        prev_state = self.state.value
        res = self.transition_to(
            VehicleState.EMERGENCY_LAND,
            command=f"failsafe_{trigger}",
            sim_time=sim_time,
            inputs=inputs,
        )

        report = SafetyReport(
            id=f"failsafe-{uuid.uuid4().hex[:8]}",
            sim_time=round(sim_time, 2),
            trigger=trigger,
            state_before=prev_state,
            state_after=self.state.value,
            inputs=inputs,
            outcome=outcome,
        )
        self.safety_reports.append(report)
        return res, report

    def check_failsafes(
        self,
        battery_pct: float,
        dist_from_origin_m: float,
        sim_time: float,
    ) -> Optional[SafetyReport]:
        """
        Continuously evaluates sensor inputs against failsafe thresholds.
        Only airborne states (IN_FLIGHT, RTL_RETURNING) can trigger landing failsafes.
        """
        if self.state not in (VehicleState.IN_FLIGHT, VehicleState.RTL_RETURNING):
            return None

        # 1. Battery failsafe (< 10%)
        if battery_pct < self.battery_failsafe_pct:
            _, report = self.trigger_failsafe(
                trigger="BATTERY_LOW",
                sim_time=sim_time,
                inputs={"battery_percent": battery_pct, "threshold": self.battery_failsafe_pct},
                outcome="Battery critical (<10%); emergency descent engaged.",
            )
            return report

        # 2. Geofence breach
        if dist_from_origin_m > self.geofence_max_dist_m:
            _, report = self.trigger_failsafe(
                trigger="GEOFENCE_BREACH",
                sim_time=sim_time,
                inputs={"dist_from_origin_m": round(dist_from_origin_m, 2), "limit_m": self.geofence_max_dist_m},
                outcome="Geofence boundary exceeded; immediate descent to prevent flyaway.",
            )
            return report

        return None

    def generate_heartbeat(
        self,
        battery_pct: float,
        link_connected: bool,
        nav_mode: str = "GPS_NAV",
    ) -> Dict[str, Any]:
        """Synthesizes a 1 Hz heartbeat payload."""
        self.heartbeat_seq += 1
        return {
            "state": self.state.value,
            "battery": round(battery_pct, 1),
            "link": link_connected,
            "mode": nav_mode,
            "seq": self.heartbeat_seq,
        }
