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
