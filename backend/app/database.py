"""
SQLite append-only event and mission replay storage with idempotent inserts, WAL mode, and offline outbox.
All database access is routed strictly through this module.
"""

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.schemas import EventIn


class EventStore:
    def __init__(self, database_path: Optional[str | Path] = None) -> None:
        if database_path is None:
            # Default to data/aerosar.db relative to workspace root
            root_dir = Path(__file__).resolve().parent.parent.parent
            data_dir = root_dir / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            self.path = str(data_dir / "aerosar.db")
        else:
            p = Path(database_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            self.path = str(p)

        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL;")
        connection.execute("PRAGMA synchronous=NORMAL;")
        connection.execute("PRAGMA busy_timeout=30000;")
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    synced INTEGER NOT NULL DEFAULT 0,
                    synced_at TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS outbox (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS missions (
                    mission_id TEXT PRIMARY KEY,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    frame_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'ACTIVE'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS replay_frames (
                    mission_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    sim_time REAL NOT NULL,
                    type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (mission_id, seq)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS safety_reports (
                    id TEXT PRIMARY KEY,
                    sim_time REAL NOT NULL,
                    trigger TEXT NOT NULL,
                    state_before TEXT NOT NULL,
                    state_after TEXT NOT NULL,
                    inputs TEXT NOT NULL,
                    outcome TEXT NOT NULL,
                    created_at REAL NOT NULL
                )
            """)
            conn.commit()

    def insert(self, event: EventIn, synced: bool = False) -> bool:
        """Return True only when an event is newly stored; retries are harmless."""
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO events(event_id, event_type, payload, created_at, synced, synced_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    event.event_id,
                    event.event_type,
                    json.dumps(event.payload, default=str),
                    event.created_at.isoformat(),
                    1 if synced else 0,
                    datetime.now(timezone.utc).isoformat() if synced else None,
                ),
            )
            conn.commit()
            return cursor.rowcount == 1

    def list(self, event_type: Optional[str] = None) -> List[Dict[str, Any]]:
        query = "SELECT * FROM events"
        params: tuple = ()
        if event_type:
            query += " WHERE event_type = ?"
            params = (event_type,)
        query += " ORDER BY created_at ASC"
        with closing(self._connect()) as conn:
            return [
                {**dict(row), "payload": json.loads(row["payload"]), "synced": bool(row["synced"])}
                for row in conn.execute(query, params).fetchall()
            ]

    def get_unsynced(self) -> List[Dict[str, Any]]:
        query = "SELECT * FROM events WHERE synced = 0 ORDER BY created_at ASC"
        with closing(self._connect()) as conn:
            return [
                {**dict(row), "payload": json.loads(row["payload"]), "synced": bool(row["synced"])}
                for row in conn.execute(query).fetchall()
            ]

    def mark_all_synced(self) -> int:
        now_str = datetime.now(timezone.utc).isoformat()
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                "UPDATE events SET synced = 1, synced_at = ? WHERE synced = 0",
                (now_str,)
            )
            conn.commit()
            return cursor.rowcount

    # Outbox buffering for offline link_cut / link_restore
    def push_outbox(self, event_id: str, event_type: str, payload: Dict[str, Any]) -> bool:
        now_str = datetime.now(timezone.utc).isoformat()
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO outbox(event_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
                (event_id, event_type, json.dumps(payload, default=str), now_str)
            )
            conn.commit()
            return cursor.rowcount == 1

    def flush_outbox(self) -> List[Dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT * FROM outbox ORDER BY created_at ASC").fetchall()
            results = [
                {
                    "event_id": row["event_id"],
                    "event_type": row["event_type"],
                    "payload": json.loads(row["payload"]),
                    "created_at": row["created_at"],
                }
                for row in rows
            ]
            conn.execute("DELETE FROM outbox")
            conn.commit()
            return results

    def get_outbox_count(self) -> int:
        with closing(self._connect()) as conn:
            return conn.execute("SELECT count(*) FROM outbox").fetchone()[0]

    def get_sync_status(self, is_online: bool = True, mode: str = None, via: str = None) -> Dict[str, Any]:
        with closing(self._connect()) as conn:
            total = conn.execute("SELECT count(*) FROM events").fetchone()[0]
            unsynced = conn.execute("SELECT count(*) FROM events WHERE synced = 0").fetchone()[0]
            outbox_count = conn.execute("SELECT count(*) FROM outbox").fetchone()[0]
            synced = total - unsynced
            current_mode = mode or ("NETWORK" if is_online else "OFFLINE")
            current_via = via or ("network" if is_online else "lora")
            return {
                "state": "CONNECTED" if is_online else "OFFLINE",
                "queued_events": unsynced + outbox_count,
                "synced_events": synced,
                "mode": current_mode,
                "via": current_via,
                "rssi": -85.0 if is_online else -102.5,
                "snr": 12.0 if is_online else 6.5,
                "sf": 7,
            }

    # Replay frames & Mission logging
    def record_replay_frame(
        self,
        mission_id: str,
        seq: int,
        sim_time: float,
        msg_type: str,
        payload: Dict[str, Any],
    ) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO missions(mission_id, started_at, status) VALUES (?, ?, 'ACTIVE')",
                (mission_id, datetime.now(timezone.utc).isoformat()),
            )
            conn.execute(
                "INSERT OR REPLACE INTO replay_frames(mission_id, seq, sim_time, type, payload) VALUES (?, ?, ?, ?, ?)",
                (mission_id, seq, sim_time, msg_type, json.dumps(payload, default=str)),
            )
            conn.execute(
                "UPDATE missions SET frame_count = frame_count + 1 WHERE mission_id = ?",
                (mission_id,),
            )
            conn.commit()

    def list_missions(self) -> List[Dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT * FROM missions ORDER BY started_at DESC").fetchall()
            return [dict(r) for r in rows]

    def get_mission_replay(self, mission_id: str) -> List[Dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM replay_frames WHERE mission_id = ? ORDER BY seq ASC",
                (mission_id,),
            ).fetchall()
            return [
                {
                    "mission_id": r["mission_id"],
                    "seq": r["seq"],
                    "sim_time": r["sim_time"],
                    "type": r["type"],
                    "payload": json.loads(r["payload"]),
                }
                for r in rows
            ]

    # Safety reports
    def save_safety_report(self, report: Dict[str, Any]) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO safety_reports(id, sim_time, trigger, state_before, state_after, inputs, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    report["id"],
                    report["sim_time"],
                    report["trigger"],
                    report["state_before"],
                    report["state_after"],
                    json.dumps(report.get("inputs", {}), default=str),
                    report["outcome"],
                    report.get("created_at", datetime.now(timezone.utc).timestamp()),
                ),
            )
            conn.commit()

    def list_safety_reports(self) -> List[Dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT * FROM safety_reports ORDER BY sim_time ASC").fetchall()
            return [
                {
                    **dict(r),
                    "inputs": json.loads(r["inputs"]),
                }
                for r in rows
            ]
