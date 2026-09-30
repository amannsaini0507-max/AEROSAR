from datetime import datetime, timezone

from app.database import EventStore
from app.schemas import EventIn


def test_duplicate_event_is_idempotent(tmp_path):
    store = EventStore(tmp_path / "test.db")
    event = EventIn(event_id="same-id", event_type="detection", payload={"id": "person-1"})
    assert store.insert(event) is True
    assert store.insert(event) is False
    assert len(store.list()) == 1


def test_events_are_ordered_by_original_event_time(tmp_path):
    store = EventStore(tmp_path / "test.db")
    later = EventIn(event_id="later", event_type="detection", payload={}, created_at=datetime(2026, 1, 2, tzinfo=timezone.utc))
    earlier = EventIn(event_id="earlier", event_type="detection", payload={}, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    store.insert(later)
    store.insert(earlier)
    assert [item["event_id"] for item in store.list()] == ["earlier", "later"]


def test_outbox_buffering_and_flush(tmp_path):
    store = EventStore(tmp_path / "test.db")
    store.push_outbox("evt-1", "detection", {"id": "p1"})
    store.push_outbox("evt-2", "alert", {"msg": "warning"})
    assert store.get_outbox_count() == 2
    flushed = store.flush_outbox()
    assert len(flushed) == 2
    assert store.get_outbox_count() == 0
    assert flushed[0]["event_id"] == "evt-1"


def test_safety_report_persistence(tmp_path):
    store = EventStore(tmp_path / "test.db")
    report = {
        "id": "failsafe-001",
        "sim_time": 12.5,
        "trigger": "BATTERY_LOW",
        "state_before": "IN_FLIGHT",
        "state_after": "EMERGENCY_LAND",
        "inputs": {"battery_pct": 8.0},
        "outcome": "Forced emergency descent",
    }
    store.save_safety_report(report)
    reports = store.list_safety_reports()
    assert len(reports) == 1
    assert reports[0]["id"] == "failsafe-001"
    assert reports[0]["inputs"]["battery_pct"] == 8.0


def test_mission_replay_frames_ordering(tmp_path):
    store = EventStore(tmp_path / "test.db")
    store.record_replay_frame("MISSION-1", seq=2, sim_time=1.0, msg_type="telemetry", payload={"lat": 1.0})
    store.record_replay_frame("MISSION-1", seq=1, sim_time=0.5, msg_type="telemetry", payload={"lat": 0.5})
    frames = store.get_mission_replay("MISSION-1")
    assert len(frames) == 2
    assert [f["seq"] for f in frames] == [1, 2]
