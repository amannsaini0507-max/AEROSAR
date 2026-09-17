# AEROSAR Command Center — Dashboard (Member 5)

React + TypeScript + Vite + Leaflet dashboard for SIH 2026 PS 26177.
It covers Requirement 8 and the on-screen half of Requirement 7 (offline resilience) from the master
document (`../docs/AEROSAR_SIH_PS26177_Master_Document_final.md`, §6.5 and §14).

## Run it

Needs Node.js 18 or newer.

```bash
cd frontend
npm install
npm run dev              # dashboard on http://localhost:5173 with the built-in demo scenario
```

The demo scenario plays the doc's recommended demo (§15.1) on a loop you can restart:
a fire + smoke survivor that becomes **CRITICAL**, a flood survivor (HIGH), a survivor near a damaged
structure (MEDIUM) and one out in the open (LOW), a GPS-denied strip, and an automatic network cut on the
last search lane. Two detections happen while offline and appear after the SYNCING step, in their real
time order. Everything shown is labelled "Simulated data".

### Against a real WebSocket

```bash
# terminal 1 — mock backend with the same endpoints Member 4 will build
npm run mock:server      # ws://localhost:8000/ws/live

# terminal 2
npm run dev:backend      # uses .env.backend
```

For Member 4's real backend, copy `.env.example` to `.env.local` and set `VITE_WS_URL` / `VITE_API_BASE`,
or open the dashboard with a URL parameter (handy on demo day, no rebuild needed):

```
http://localhost:5173/?ws=ws://192.168.1.20:8000/ws/live
http://localhost:5173/?ws=sim          # force the simulator
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dashboard + simulator |
| `npm run dev:backend` | Dashboard pointed at `localhost:8000` |
| `npm run mock:server` | Mock backend (WebSocket + REST) on port 8000 |
| `npm test` | Unit tests: reducer, link indicator, priority order, §11.7 worked example |
| `npm run build` | Type-check and production build into `dist/` |

## Pages

| Page | Purpose |
|---|---|
| **Live operations** `/` | The judge-facing screen: feed (RGB/thermal), mission status, disaster map, survivor priority list, alerts, mission log, link indicator. |
| **Mission control** | Start / abort mission; data-link diagnostics and per-type message counts (Day 2 "confirm live message receipt"); buttons to rehearse the network cut in the simulator. |
| **Mission history** | Replay slider for this browser session, or for any mission from `GET /api/missions/{id}/history`. |
| **Briefing view** | Large-type summary for a projector or second monitor. |

## How the requirement-8 elements map to the screen (§14.3)

| Element | Where | Message |
|---|---|---|
| Live drone feed | Live drone feed panel, RGB/Thermal toggle | `video_status` / `video_frame` |
| Survivor locations | Numbered circles on the map + priority list | `detection` + `risk_score` |
| Hazard locations | Squares with shaded zone on the map | `hazard` |
| Mission status | Mission status panel | `mission_status` |
| Alerts | Alerts panel + pop-ups for critical/link events | `alert` |
| Drone status | Battery, navigation mode, video HUD | `mission_status`, `drone_pose` |
| Map | Disaster map | all of the above + `route` |
| Connectivity | Top bar and page header indicator | `mission_status.link_connected`, `sync_status`, 5 s staleness |

## Code map

```
src/
  types.ts                 contract types (mirror aerosar_msgs) + client model
  lib/reducer.ts           pure: WebSocket message → model   (unit-tested)
  lib/derive.ts            link indicator, priority ordering, alert colours
  lib/levels.ts            priority colours/labels — one place for §14.4
  lib/time.ts              stamp normalisation (ROS Time / ISO / epoch)
  lib/replay.ts            mission replay from session log or REST history
  lib/config.ts            VITE_WS_URL / VITE_API_BASE / ?ws= override
  hooks/useMissionFeed.ts  WebSocket (auto-reconnect) or simulator
  mock/scenario.ts         demo scenario engine (browser + mock server)
  mock/riskScore.ts        §11.3 formula — demo data only, never used on real data
  components/              panels
  pages/                   routes
mock-server/server.ts      mock backend
```

## Rules this code follows (so please keep them)

- **No business logic in the dashboard.** Scores, priority levels and reasons come from the backend.
- **Order by event time, not arrival** (§13.6). Deduplicate by id (§13.4).
- **Honest labels.** Simulated data, simulated video and indicative hazard zones are labelled as such (§17, §21.2).
- **Works without internet at the venue.** Leaflet CSS is bundled; if map tiles can't load, markers
  still draw on a grid. Fonts fall back to system fonts.
- The contract lives in `WS_CONTRACT.md` and `src/types.ts`. Change both together, and get team sign-off
  for anything that touches `aerosar_msgs` (§7).

See `TESTING.md` for the Member 5 test checklist.
