"""SQLite append-only event storage with idempotent inserts."""

import json
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

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

    def insert(self, event: EventIn) -> bool:
        """Return True only when an event is newly stored; retries are harmless."""
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO events(event_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
                (event.event_id, event.event_type, json.dumps(event.payload, default=str), event.created_at.isoformat()),
            )
            connection.commit()
            return cursor.rowcount == 1

    def list(self, event_type: str | None = None) -> list[dict]:
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
