"""SQLite append-only event storage with idempotent inserts and offline sync tracking."""

import json
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional

from app.schemas import EventIn


class EventStore:
    def __init__(self, database_path: str | Path = "aerosar.db") -> None:
        self.path = str(database_path)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    synced INTEGER NOT NULL DEFAULT 0,
                    synced_at TEXT
                )
            """)
            connection.commit()

    def insert(self, event: EventIn, synced: bool = False) -> bool:
        """Return True only when an event is newly stored; retries are harmless."""
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO events(event_id, event_type, payload, created_at, synced, synced_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    event.event_id,
                    event.event_type,
                    json.dumps(event.payload, default=str),
                    event.created_at.isoformat(),
                    1 if synced else 0,
                    datetime.utcnow().isoformat() if synced else None,
                ),
            )
            connection.commit()
            return cursor.rowcount == 1

    def list(self, event_type: str | None = None) -> List[Dict]:
        query = "SELECT * FROM events"
        params: tuple[str, ...] = ()
        if event_type:
            query += " WHERE event_type = ?"
            params = (event_type,)
        query += " ORDER BY created_at ASC"
        with closing(self._connect()) as connection:
            return [
                {**dict(row), "payload": json.loads(row["payload"]), "synced": bool(row["synced"])}
                for row in connection.execute(query, params).fetchall()
            ]

    def get_unsynced(self) -> List[Dict]:
        query = "SELECT * FROM events WHERE synced = 0 ORDER BY created_at ASC"
        with closing(self._connect()) as connection:
            return [
                {**dict(row), "payload": json.loads(row["payload"]), "synced": bool(row["synced"])}
                for row in connection.execute(query).fetchall()
            ]

    def mark_all_synced(self) -> int:
        now_str = datetime.utcnow().isoformat()
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "UPDATE events SET synced = 1, synced_at = ? WHERE synced = 0",
                (now_str,)
            )
            connection.commit()
            return cursor.rowcount

    def get_sync_status(self, is_online: bool = True) -> Dict:
        with closing(self._connect()) as connection:
            total = connection.execute("SELECT count(*) FROM events").fetchone()[0]
            unsynced = connection.execute("SELECT count(*) FROM events WHERE synced = 0").fetchone()[0]
            synced = total - unsynced
            return {
                "state": "CONNECTED" if is_online else "OFFLINE",
                "queued_events": unsynced,
                "synced_events": synced,
            }
