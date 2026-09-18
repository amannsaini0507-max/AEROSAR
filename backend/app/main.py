"""FastAPI command-center API and dashboard event stream."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect

from app.database import EventStore
from app.schemas import Alert, Detection, EventIn, Hazard, MissionStatus
from app.services.risk_scoring import score_detection


class DashboardConnections:
    def __init__(self) -> None:
        self.clients: list[WebSocket] = []

    async def broadcast(self, event_name: str, data: dict) -> None:
        stale: list[WebSocket] = []
        for client in self.clients:
            try:
                await client.send_json({"type": event_name, "data": data})
            except Exception:
                stale.append(client)
        for client in stale:
            self.clients.remove(client)


DB_PATH = Path(os.getenv("AEROSAR_DB_PATH", "aerosar.db"))
store = EventStore(DB_PATH)
connections = DashboardConnections()


def event_payload(event: EventIn) -> dict:
    return event.model_dump(mode="json")


async def store_and_broadcast(event: EventIn, websocket_type: str) -> bool:
    created = store.insert(event)
    if created:
        await connections.broadcast(websocket_type, event_payload(event))
    return created


def create_event(event_type: str, item: object, event_id: str | None = None) -> EventIn:
    payload = item.model_dump(mode="json")  # all internal events are Pydantic models
    return EventIn(event_id=event_id or payload.get("id") or payload.get("alert_id"), event_type=event_type, payload=payload)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="AEROSAR Command Center", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "aerosar-backend"}


@app.post("/api/events")
async def ingest_event(event: EventIn) -> dict:
    created = await store_and_broadcast(event, f"{event.event_type}_created")
    return {"event_id": event.event_id, "created": created}


@app.get("/api/events")
def events() -> list[dict]:
    return store.list()


@app.get("/api/detections")
def detections() -> list[dict]:
    return store.list("detection")


@app.get("/api/hazards")
def hazards() -> list[dict]:
    return store.list("hazard")


@app.get("/api/priority")
def priorities() -> list[dict]:
    return sorted(store.list("risk_score"), key=lambda row: row["payload"]["score"], reverse=True)


@app.get("/api/mission/status")
def mission_status() -> dict:
    statuses = store.list("status")
    if not statuses:
        raise HTTPException(status_code=404, detail="No mission status received")
    return statuses[-1]


@app.post("/api/hazards")
async def add_hazard(hazard: Hazard) -> dict:
    event = create_event("hazard", hazard, hazard.id)
    await store_and_broadcast(event, "hazard_created")
    alert = Alert(alert_type="HAZARD_DETECTED", message=f"{hazard.hazard_type} detected", latitude=hazard.latitude, longitude=hazard.longitude)
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert_created")
    return event_payload(event)


@app.post("/api/detections")
async def add_detection(detection: Detection) -> dict:
    event = create_event("detection", detection, detection.id)
    await store_and_broadcast(event, "detection_created")
    alert = Alert(alert_type="SURVIVOR_DETECTED", message="Survivor detected", latitude=detection.latitude, longitude=detection.longitude)
    await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert_created")
    all_hazards = [Hazard.model_validate(row["payload"]) for row in store.list("hazard")]
    all_detections = [Detection.model_validate(row["payload"]) for row in store.list("detection")]
    risk = score_detection(detection, all_hazards, all_detections)
    risk_event = EventIn(event_id=f"risk-{detection.id}", event_type="risk_score", payload=risk.model_dump(mode="json"))
    await store_and_broadcast(risk_event, "risk_score_created")
    if risk.priority_level == "CRITICAL":
        critical = Alert(alert_type="CRITICAL_PRIORITY", message=risk.reason, latitude=detection.latitude, longitude=detection.longitude)
        await store_and_broadcast(create_event("alert", critical, critical.alert_id), "alert_created")
    return {"detection": event_payload(event), "risk_score": risk.model_dump(mode="json")}


@app.post("/api/mission/status")
async def update_status(status: MissionStatus) -> dict:
    previous = store.list("status")
    event = create_event("status", status, f"status-{status.mission_id}-{status.stamp.isoformat()}")
    await store_and_broadcast(event, "mission_status_updated")
    was_connected = previous[-1]["payload"].get("link_connected") if previous else status.link_connected
    if was_connected and not status.link_connected:
        alert = Alert(alert_type="LINK_LOST", message="OFFLINE — logging locally")
        await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert_created")
    elif not was_connected and status.link_connected:
        await connections.broadcast("sync_started", {"message": "SYNCING…"})
        alert = Alert(alert_type="LINK_RESTORED", message="Link restored; queued events synchronized")
        await store_and_broadcast(create_event("alert", alert, alert.alert_id), "alert_created")
        await connections.broadcast("sync_completed", {"message": "CONNECTED"})
    return event_payload(event)


@app.websocket("/ws/dashboard")
async def dashboard_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    connections.clients.append(websocket)
    await websocket.send_json({"type": "snapshot", "data": {"events": store.list()}})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in connections.clients:
            connections.clients.remove(websocket)
