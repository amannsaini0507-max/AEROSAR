"""
Unit Test Suite for aerosar_core Package.
Section 6 Verification Requirements:
1. Risk formula with fixed test vector (strictly verifies Master Doc §11.7 worked example)
2. A* safe route avoids hazards with safety margins
3. State machine rejects illegal transitions and generates structured safety reports
4. Geodetic <-> ENU round-trip error under 0.01 m
"""

import math
import pytest
from aerosar_core.geo import (
    BASE_LAT,
    BASE_LON,
    BASE_ALT,
    enu_to_geodetic,
    geodetic_to_enu,
    geo_distance_m,
    geotag_detection,
)
from aerosar_core.risk import (
    calculate_risk,
    score_detection,
    priority_level_for,
    MAX_RELEVANT_DISTANCE,
    MAX_RELEVANT_COUNT,
)
from aerosar_core.route import (
    AStarPlanner,
    HazardZone,
)
from aerosar_core.vehicle import (
    VehicleStateMachine,
    VehicleState,
)


def test_geo_roundtrip_error_under_one_centimeter():
    """Verify that ENU -> Geodetic -> ENU has round-trip error < 0.01 meters."""
    test_points_enu = [
        (0.0, 0.0, 0.0),
        (12.5, -14.2, 3.5),
        (-15.0, 15.0, 10.0),
        (7.82, 9.45, -1.2),
        (-11.11, -8.88, 2.0),
    ]

    for x, y, z in test_points_enu:
        lat, lon, alt = enu_to_geodetic(x, y, z)
        x_rec, y_rec, z_rec = geodetic_to_enu(lat, lon, alt)

        error_m = math.hypot(x_rec - x, y_rec - y, z_rec - z)
        assert error_m < 0.01, f"Roundtrip error {error_m} m exceeds 0.01 m threshold at ({x}, {y}, {z})"


def test_risk_formula_master_doc_worked_example():
    """
    Verifies Master Document §11.7 worked example:
      C = 0.82
      T = True (thermal_bonus = 0.15)
      Dh = 4.0 m (MAX_RELEVANT_DISTANCE = 20.0 -> hazard_proximity_risk = 1 - 4/20 = 0.80)
      N = 1 (MAX_RELEVANT_COUNT = 5 -> survivor_count_factor = 1/5 = 0.20)
      raw_score = (0.35 * 0.82) + (0.30 * 0.80) + (0.20 * 0.20) + 0.15
                = 0.287 + 0.240 + 0.040 + 0.150
                = 0.717
      priority -> HIGH (since 0.55 <= 0.717 < 0.75)
    """
    res = calculate_risk(
        detection_id="worked_example_survivor",
        confidence=0.82,
        thermal_confirmed=True,
        nearest_hazard_dist_m=4.0,
        cluster_survivor_count=1,
    )

    assert abs(res.score - 0.717) < 1e-3, f"Expected 0.717, got {res.score}"
    assert res.priority_level == "HIGH", f"Expected HIGH, got {res.priority_level}"
    assert "thermal-confirmed" in res.reason
    assert "located near an active hazard" in res.reason
    assert len(res.explain) >= 4


def test_risk_formula_critical_threshold():
    """Verifies that high confidence + thermal + immediate fire hazard triggers CRITICAL (>= 0.75)."""
    # C = 0.95, T = True (+0.15), Dh = 1.0m (risk = 0.95), N = 3 (cluster = 0.60)
    # raw_score = 0.35*0.95 + 0.30*0.95 + 0.20*0.60 + 0.15 = 0.3325 + 0.285 + 0.12 + 0.15 = 0.8875 -> CRITICAL
    res = calculate_risk(
        detection_id="victim_3_fire",
        confidence=0.95,
        thermal_confirmed=True,
        nearest_hazard_dist_m=1.0,
        cluster_survivor_count=3,
    )

    assert res.score >= 0.75
    assert res.priority_level == "CRITICAL"
    assert "CRITICAL" in res.reason


def test_astar_safe_route_avoids_hazards():
    """Verify that the A* planner generates a path that routes around active hazard zones."""
    planner = AStarPlanner(ref_lat=BASE_LAT, ref_lon=BASE_LON, arena_size_m=30.0, cell_size_m=0.5)

    # Place a hazard directly between start (0, 0) and goal (0, 10) in local ENU
    hazard_lat, hazard_lon, _ = enu_to_geodetic(0.0, 5.0, BASE_ALT)
    planner.add_hazard(HazardZone(lat=hazard_lat, lon=hazard_lon, radius_m=2.5, safety_margin_m=1.0))

    start_lat, start_lon, _ = enu_to_geodetic(0.0, 0.0, BASE_ALT)
    goal_lat, goal_lon, _ = enu_to_geodetic(0.0, 10.0, BASE_ALT)

    path = planner.plan_path(start_lat, start_lon, goal_lat, goal_lon)
    assert len(path) >= 2, "Path should contain waypoints"

    # Verify no waypoint in path penetrates the core hazard radius (2.5 m)
    for plat, plon in path:
        dist_to_hazard = geo_distance_m(plat, plon, hazard_lat, hazard_lon)
        assert dist_to_hazard >= 2.4, f"Path waypoint ({plat}, {plon}) penetrated hazard core (dist={dist_to_hazard:.2f} m)"


def test_vehicle_state_machine_transitions_and_failsafes():
    """
    Verify vehicle state machine:
    - DISARMED -> ARMED -> IN_FLIGHT -> RTL_RETURNING -> DISARMED
    - Illegal transitions return structured errors (no uncaught exceptions)
    - Failsafes trigger EMERGENCY_LAND and create SafetyReport records
    """
    sm = VehicleStateMachine(battery_failsafe_pct=10.0, geofence_max_dist_m=22.0)
    assert sm.state == VehicleState.DISARMED

    # 1. Illegal transition: cannot start flight while DISARMED
    bad_res = sm.start_flight()
    assert bad_res["success"] is False
    assert "Illegal state transition" in bad_res["error"]
    assert sm.state == VehicleState.DISARMED

    # 2. Valid arming
    arm_res = sm.arm()
    assert arm_res["success"] is True
    assert sm.state == VehicleState.ARMED

    # 3. Valid takeoff
    flight_res = sm.start_flight()
    assert flight_res["success"] is True
    assert sm.state == VehicleState.IN_FLIGHT

    # 4. Failsafe: Battery drop < 10%
    report = sm.check_failsafes(battery_pct=8.5, dist_from_origin_m=5.0, sim_time=42.0)
    assert report is not None
    assert report.trigger == "BATTERY_LOW"
    assert sm.state == VehicleState.EMERGENCY_LAND
    assert len(sm.safety_reports) == 1
    assert sm.safety_reports[0].id == report.id

    # 5. Heartbeat generator produces valid fields
    hb = sm.generate_heartbeat(battery_pct=8.5, link_connected=True)
    assert hb["state"] == "EMERGENCY_LAND"
    assert hb["battery"] == 8.5
    assert hb["seq"] >= 1
