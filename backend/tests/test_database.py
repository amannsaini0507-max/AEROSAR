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
