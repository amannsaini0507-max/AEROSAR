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

    # 6. Operator emergency landing triggers failsafe and generates structured report
    sm_fresh = VehicleStateMachine()
    sm_fresh.arm()
    sm_fresh.start_flight()
    _, op_report = sm_fresh.trigger_failsafe(
        trigger="OPERATOR_COMMAND",
        sim_time=15.0,
        inputs={"command": "emergency_land"},
        outcome="Operator commanded landing",
    )
    assert sm_fresh.state == VehicleState.EMERGENCY_LAND
    assert op_report.trigger == "OPERATOR_COMMAND"
    assert op_report.state_before == "IN_FLIGHT"
    assert op_report.state_after == "EMERGENCY_LAND"


def test_gps_noise_model():
    """Verify GPS noise model adds realistic small Gaussian jitter < 1.5 m."""
    import random
    from aerosar_core.geo import add_gps_noise, geo_distance_m

    rng = random.Random(12345)
    lat_noisy, lon_noisy = add_gps_noise(BASE_LAT, BASE_LON, std_m=0.35, rng=rng)
    dist_m = geo_distance_m(BASE_LAT, BASE_LON, lat_noisy, lon_noisy)
    assert dist_m > 0.0, "Noise must jitter the coordinate"
    assert dist_m < 1.5, f"Gaussian noise jitter too high: {dist_m} m"


def test_synthetic_perception_engine():
    """Verify synthetic perception matches Section 2 YOLOv8n benchmark and victim 3 thermal confirmation."""
    from aerosar_core.perception import SyntheticPerceptionEngine

    engine = SyntheticPerceptionEngine(seed=42, fov_radius_m=4.8)

    # 1. Drone far away at (0, 0): no victims in FOV
    dets_empty = engine.evaluate_candidates(drone_x=0.0, drone_y=0.0, drone_z=2.2, heading_deg=0.0, sim_time=1.0)
    assert len(dets_empty) == 0

    # 2. Drone approaching Zone C fire victim (5.5, -6.8)
    dets_fire = engine.evaluate_candidates(drone_x=5.5, drone_y=-6.8, drone_z=2.2, heading_deg=0.0, sim_time=10.0)
    assert len(dets_fire) == 1
    v3 = dets_fire[0]
    assert v3["id"] == "victim_3"
    assert v3["thermal_confirmed"] is True
    assert v3["confidence"] >= 0.85
    assert "Fire Zone" in v3["description"]

    # 3. Repeat evaluation: already detected victims are not duplicated
    dets_repeat = engine.evaluate_candidates(drone_x=5.5, drone_y=-6.8, drone_z=2.2, heading_deg=0.0, sim_time=11.0)
    assert len(dets_repeat) == 0


def test_lawnmower_11_lanes_coverage():
    """Verify that default lawnmower waypoints generate 11 lanes covering -14m to +14m at H=5.0m."""
    from aerosar_core.trajectory import generate_lawnmower_waypoints

    wps = generate_lawnmower_waypoints()
    assert len(wps) >= 24

    # Extract distinct y-coordinates for lanes (excluding start/end return points)
    lane_ys = sorted(list(set(round(wp[1], 2) for wp in wps[1:-2])))
    assert len(lane_ys) == 11, f"Expected 11 lanes, got {len(lane_ys)}: {lane_ys}"
    assert lane_ys[0] == -14.0, f"Expected first lane at -14.0, got {lane_ys[0]}"
    assert lane_ys[-1] == 14.0, f"Expected last lane at 14.0, got {lane_ys[-1]}"

    # Verify altitude
    for wp in wps[1:-1]:
        assert wp[2] == 5.0, f"Cruise altitude must be 5.0m, got {wp[2]}"


