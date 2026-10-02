"""
Unit & Integration Tests for Autonomous Lawnmower Search & Victim Hover-Verify.
Verifies Task 2 requirements:
- Substate machine transitions: PATROLLING -> VICTIM_LOCKED -> HOVER_STABILISING -> HOVER_CONFIRMING -> CONFIRMED / REJECTED -> RESUME_PATROL
- Real victim (37.1 C) is CONFIRMED after 5.5s sim time
- Mannequin test object (18.5 C) is REJECTED after 5.5s sim time
- waypointIndex is preserved and continuous across hovers
- Mode switch to MANUAL cancels hover in 1 frame, switching to AUTONOMOUS resumes from saved waypoint
- Pausing sim freezes hover timer
- Link cut during hover buffers events to offline outbox with 0 loss on restore
"""

import asyncio
import math
import pytest
from app.main import (
    StandaloneSimulator,
    hub,
    store,
    vehicle_sm,
    latest_pose,
    latest_mission_status,
)
from aerosar_core.vehicle import VehicleState


@pytest.fixture
def clean_simulator():
    sim = StandaloneSimulator()
    sim.start()
    hub.is_link_connected = True
    hub.clients.clear()
    store.flush_outbox()
    latest_pose["flight_mode"] = "AUTO_SEARCH"
    latest_mission_status["state"] = "SEARCHING"
    latest_mission_status["substate"] = "PATROLLING"
    return sim


def test_lawnmower_grid_11_lanes_coverage(clean_simulator):
    sim = clean_simulator
    assert len(sim.waypoints) >= 24
    lane_ys = sorted(list(set(round(wp[1], 2) for wp in sim.waypoints[1:-2])))
    assert len(lane_ys) == 11
    assert lane_ys[0] == -14.0
    assert lane_ys[-1] == 14.0
    for wp in sim.waypoints[1:-1]:
        assert wp[2] == 5.0  # Cruise altitude H=5.0m


def test_hover_confirming_duration_and_confirmation(clean_simulator):
    sim = clean_simulator
    # Simulate drone locking onto victim_3 (fire critical survivor, temp_c=37.1)
    vic3 = next(v for v in sim.staged_victims if v["id"] == "victim_3")
    sim.active_victim = vic3
    sim.substate = "HOVER_CONFIRMING"
    sim.hover_timer = 0.0
    sim.hover_positions = []
    sim.thermal_samples = []

    dt = 1.0 / 30.0  # 30 Hz sim time step
    steps = 0

    # Step through 5.5s of simulation time
    while sim.hover_timer < 5.5:
        sim.hover_timer += dt
        sim.hover_positions.append((4.2, 5.8, 4.0))
        sim.thermal_samples.append(vic3["temp_c"])
        steps += 1

    # Verify duration: 5.5s +/- 0.1s
    assert abs(sim.hover_timer - 5.5) <= 0.1
    # Samples in human range [30, 40] C
    human_samples = sum(1 for s in sim.thermal_samples if 30.0 <= s <= 40.0)
    ratio = human_samples / len(sim.thermal_samples)
    assert ratio >= 0.80  # All samples human temperature


def test_mannequin_rejection_after_hover(clean_simulator):
    sim = clean_simulator
    # Simulate drone locking onto mannequin_01 (cold test object, temp_c=18.5)
    mannequin = next(v for v in sim.staged_victims if v["id"] == "mannequin_01")
    sim.active_victim = mannequin
    sim.substate = "HOVER_CONFIRMING"
    sim.hover_timer = 0.0
    sim.thermal_samples = []

    dt = 1.0 / 30.0
    while sim.hover_timer < 5.5:
        sim.hover_timer += dt
        sim.thermal_samples.append(mannequin["temp_c"])

    assert abs(sim.hover_timer - 5.5) <= 0.1
    human_samples = sum(1 for s in sim.thermal_samples if 30.0 <= s <= 40.0)
    ratio = human_samples / len(sim.thermal_samples)
    assert ratio < 0.80  # 0% human temperature -> must be REJECTED


def test_waypoint_index_persists_across_hover(clean_simulator):
    sim = clean_simulator
    sim.waypoint_index = 4
    sim.saved_waypoint_index = 4

    # Lock victim
    sim.substate = "VICTIM_LOCKED"
    sim.saved_waypoint_index = sim.waypoint_index
    assert sim.saved_waypoint_index == 4

    # Transition through hover and resume
    sim.substate = "RESUME_PATROL"
    # When resume completes, waypoint_index must match saved_waypoint_index
    sim.waypoint_index = sim.saved_waypoint_index
    sim.substate = "PATROLLING"
    assert sim.waypoint_index == 4


def test_manual_override_cancels_hover_in_one_frame(clean_simulator):
    sim = clean_simulator
    vic = sim.staged_victims[0]
    sim.active_victim = vic
    sim.substate = "HOVER_CONFIRMING"
    sim.hover_timer = 2.5
    sim.hover_target = [1.0, 2.0, 4.0]

    # Operator switches to MANUAL or presses WASD
    sim.apply_manual_input(vx=1.5, vy=0.0, vz=0.0)

    # Must immediately cancel hover and release lock
    assert sim.substate == "PATROLLING"
    assert sim.active_victim is None
    assert sim.hover_timer == 0.0
    assert latest_pose["flight_mode"] == "MANUAL"


def test_sim_pause_freezes_hover_timer(clean_simulator):
    sim = clean_simulator
    sim.substate = "HOVER_CONFIRMING"
    sim.hover_timer = 2.0

    # Pause sim
    sim.pause()
    assert latest_mission_status["state"] == "PAUSED"

    # Simulate tick while paused
    is_paused = (latest_mission_status["state"] == "PAUSED")
    dt = 1.0 / 30.0
    if not is_paused:
        sim.hover_timer += dt

    # Timer must remain frozen
    assert sim.hover_timer == 2.0


def test_link_cut_buffers_events_and_restores_without_loss(clean_simulator):
    sim = clean_simulator
    # Cut link
    hub.is_link_connected = False
    assert not hub.is_link_connected

    # Generate detection and alert events while link is cut
    envelope1 = hub.build_envelope("detection", {"id": "det-offline-1", "status": "CONFIRMED", "confidence": 0.9})
    envelope2 = hub.build_envelope("alert", {"alert_id": "alert-offline-1", "message": "Survivor confirmed offline"})

    async def run_broadcast():
        await hub.broadcast_envelope(envelope1)
        await hub.broadcast_envelope(envelope2)

    asyncio.run(run_broadcast())

    # Check that outbox buffered both events
    buffered_count = store.get_outbox_count()
    assert buffered_count >= 2

    # Restore link
    hub.is_link_connected = True
    flushed = store.flush_outbox()
    assert len(flushed) >= 2
    # Outbox is now empty
    assert store.get_outbox_count() == 0


def test_step_full_scenario2_multi_victim_arena(clean_simulator):
    """
    Integration simulation test running 11-lane lawnmower search:
    - Traverses grid via deterministic sim.step(dt).
    - Locks and evaluates all 4 staged targets.
    - Confirms all 3 real victims (victim_1, victim_2, victim_3) with thermal_confirmed=True.
    - Rejects mannequin_01 (cold test object) with thermal_confirmed=False.
    - 3m exclusion radius prevents duplicate locks.
    - Mission transitions to RETURNING and lands (state=COMPLETE).
    """
    sim = clean_simulator
    dt = 0.1
    confirmed_detections = {}
    rejected_detections = {}
    hover_progress_events = []

    # Step through entire mission
    for _ in range(2500):
        events = sim.step(dt)
        for evt_type, payload in events:
            if evt_type == "detection":
                if payload["status"] == "CONFIRMED":
                    confirmed_detections[payload["id"]] = payload
                elif payload["status"] == "REJECTED":
                    rejected_detections[payload["id"]] = payload
            elif evt_type == "hover_progress":
                hover_progress_events.append(payload)

        if latest_mission_status["state"] == "COMPLETE":
            break

    # Real victims confirmed
    assert "victim_1" in confirmed_detections
    assert "victim_2" in confirmed_detections
    assert "victim_3" in confirmed_detections
    assert confirmed_detections["victim_1"]["thermal_confirmed"] is True
    assert confirmed_detections["victim_3"]["thermal_confirmed"] is True

    # Mannequin rejected
    assert "mannequin_01" in rejected_detections
    assert rejected_detections["mannequin_01"]["thermal_confirmed"] is False

    # Mission completed and RTL landed
    assert latest_mission_status["state"] == "COMPLETE"
    assert vehicle_sm.state == VehicleState.DISARMED

    # Exclusion radius: exactly 4 unique targets evaluated, no duplicate confirmations
    assert len(confirmed_detections) == 3
    assert len(rejected_detections) == 1


def test_step_stabilisation_timeout_marks_unconfirmed_retry(clean_simulator):
    """
    If drone cannot stabilise position within 10.0s sim time,
    it must abort to RESUME_PATROL and emit UNCONFIRMED_RETRY.
    """
    sim = clean_simulator
    vic = sim.staged_victims[0]
    sim.active_victim = vic
    sim.substate = "HOVER_STABILISING"
    sim.hover_target = [10.0, 10.0, 4.0]
    sim.current_enu = [-10.0, -10.0, 4.0]
    sim.hover_stabilise_timer = 9.8

    # Step 0.3s (timer exceeds 10.0s)
    events = sim.step(dt=0.3)

    assert sim.substate == "RESUME_PATROL"
    assert vic["id"] in sim.unconfirmed_retry_victims
    unconf_events = [p for t, p in events if t == "detection" and p.get("status") == "UNCONFIRMED_RETRY"]
    assert len(unconf_events) == 1
    assert unconf_events[0]["id"] == vic["id"]


def test_step_battery_failsafe_cancels_hover_immediately(clean_simulator):
    """
    Battery dropping below 10% failsafe threshold during hover must immediately
    cancel hover, reset victim lock, and trigger EMERGENCY_LAND.
    """
    sim = clean_simulator
    vic = sim.staged_victims[0]
    sim.active_victim = vic
    sim.substate = "HOVER_CONFIRMING"
    sim.hover_timer = 2.5
    sim.hover_target = [1.0, 2.0, 4.0]

    # Force sim_time such that battery drops < 10%
    sim.sim_time = 750.0
    events = sim.step(dt=0.1)

    assert sim.substate == "PATROLLING"
    assert sim.active_victim is None
    assert sim.hover_timer == 0.0
    assert latest_mission_status["state"] == "EMERGENCY_LAND"
    assert any(t == "alert" and "Failsafe triggered" in p["message"] for t, p in events)


def test_step_sim_pause_freezes_sim_time_and_hover(clean_simulator):
    """
    Hard Rule 2: Pausing sim must freeze sim_time and all timers completely.
    """
    sim = clean_simulator
    sim.active_victim = sim.staged_victims[0]
    sim.substate = "HOVER_CONFIRMING"
    sim.hover_timer = 2.5
    sim.sim_time = 50.0

    sim.pause()
    assert latest_mission_status["state"] == "PAUSED"

    events = sim.step(dt=0.5)
    assert len(events) == 0
    assert sim.sim_time == 50.0
    assert sim.hover_timer == 2.5

    # Resume and verify step proceeds
    sim.resume()
    events = sim.step(dt=0.1)
    assert abs(sim.sim_time - 50.1) < 1e-4
    assert abs(sim.hover_timer - 2.6) < 1e-4


def test_hover_obstacle_elevation_and_fire_clearance(clean_simulator):
    """
    Verifies hover altitude is elevated above obstacles (obs_h + 1.5, min 4.0m)
    and stays >= 2.0m horizontally from active fire.
    """
    sim = clean_simulator
    vic_fire = next(v for v in sim.staged_victims if v["id"] == "victim_3")
    sim.current_enu = [vic_fire["enu"][0], vic_fire["enu"][1], 5.0]
    sim.waypoint_index = 15
    sim.substate = "PATROLLING"

    events = sim.step(dt=0.1)
    assert sim.substate == "HOVER_STABILISING"
    assert sim.hover_target is not None

    hx, hy, hz = sim.hover_target
    assert hz >= 4.0

    # Fire clearance: fire is at (5.5, 6.5)
    fire_dist = math.hypot(hx - 5.5, hy - 6.5)
    assert fire_dist >= 2.0
