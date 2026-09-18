# AEROSAR Backend — Member 4

FastAPI command-center service for storing mission events, calculating explainable rescue priority, issuing alerts, and streaming updates to the dashboard.

## Run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/docs` for generated API documentation. In a second terminal, run `python demo_data.py` to populate a fire-survivor scenario and connectivity transitions.

## Interfaces

- Health: `GET /health`
- Event ingestion/history: `POST`/`GET /api/events`
- Dashboard feed: `ws://127.0.0.1:8000/ws/dashboard`
- Direct test inputs: `POST /api/detections`, `POST /api/hazards`, `POST /api/mission/status`

The backend stores events in `aerosar.db`. Inserts use UUID event IDs and are idempotent; history is ordered by the drone-generated `created_at` time.

ROS integration is deliberately a thin adapter in `app/ros_bridge.py`. It consumes `/perception/detection`, `/perception/hazard`, and `/mission/status`, leaving the API and risk-scoring logic independent of ROS.
