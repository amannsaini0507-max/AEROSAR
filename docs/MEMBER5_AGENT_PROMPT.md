# Prompt for an agentic coding tool (Codex, Antigravity, Claude Code, Cursor…)

Open the **`aerosar` repository folder** in the tool, then paste everything inside the box below.
Replace the line in `<angle brackets>` with what you want done today (examples at the bottom).

---

```text
You are helping Member 5 (Dashboard / Frontend) of team AEROSAR, SIH 2026 problem statement 26177
(AI-powered autonomous drone for search & rescue).

READ FIRST, before changing anything:
1. docs/AEROSAR_SIH_PS26177_Master_Document_final.md — the team's master plan. The parts that matter
   for this role are §6.5 (Member 5 roadmap), §7 (locked ROS 2 message contract), §11 (rescue priority),
   §13 (offline-first + sync), §14 (dashboard design), §15.1 and §20 (demo), §16–17 (tests and targets),
   §18 (git rules), §21 (what judges value).
2. frontend/README.md, frontend/WS_CONTRACT.md, frontend/TESTING.md.
3. frontend/src/types.ts, frontend/src/lib/reducer.ts, frontend/src/lib/derive.ts.

WHAT ALREADY EXISTS (do not rebuild it):
- frontend/ is a working React 18 + TypeScript + Vite + Leaflet dashboard.
- Live operations page has all 8 Requirement-8 elements, the CONNECTED / OFFLINE / SYNCING indicator,
  survivor priority list with backend reason strings, and a mission log.
- useMissionFeed connects to VITE_WS_URL (auto-reconnect) or runs a built-in demo scenario.
- mock-server/server.ts (npm run mock:server) serves /ws/live, /api/missions/{id}/history,
  /api/mission/start|abort and debug link cut/restore on port 8000.
- Mission control, Mission history (replay) and Briefing view pages exist.
- 11 unit tests (npm test).

HARD RULES:
- Only edit files inside frontend/ (and docs/ if asked). Other folders belong to other team members.
- Never compute risk scores or priority levels in dashboard code. They come from the backend.
  frontend/src/mock/riskScore.ts is for demo data only.
- Do not rename message fields or topics from master doc §7.1/§7.2. If something new is truly needed,
  make it optional, mark it EXTENSION in both src/types.ts and WS_CONTRACT.md, and tell me it needs
  team sign-off.
- Order events by their stamp (drone time), not arrival time. Deduplicate by id.
- Keep the UI legible from a distance and uncluttered; do not add panels beyond the 8 required
  elements unless I ask (master doc §14.1, §21.3).
- Label anything simulated or approximate as such. Never invent metrics.
- No new runtime dependencies unless you explain why and I agree.
- Keep src/types.ts and WS_CONTRACT.md in sync in the same change.

HOW TO WORK:
1. Tell me your plan in a few bullet points and which files you will touch. Wait for my OK if the
   change is bigger than one component.
2. Make the change in small steps.
3. After changing code, run from frontend/:  npm test  and  npm run build  — both must pass.
   Add or update unit tests in src/lib/reducer.test.ts for any logic you change.
4. Explain how I can see the result (which page, simulator or mock server, what to click).
5. Suggest a commit message in the format  [frontend] short description  and remind me to commit on
   the feature/dashboard branch. Do not push or merge for me.

TODAY'S TASK:
<describe the task here>
```

---

## Example tasks to paste in place of `<describe the task here>`

**Wire up Member 4's real backend (roadmap Day 5)**
> Member 4's backend is running at ws://<their-ip>:8000/ws/live. Help me point the dashboard at it,
> compare the messages it actually sends (use the Mission control page counts and the browser console)
> against WS_CONTRACT.md, and list every mismatch. Fix mismatches on our side only when the backend
> is following the contract; otherwise write me a short note to send to Member 4.

**Real video feed (roadmap Day 9)**
> Member 1 can expose the Webots RGB and thermal cameras as MJPEG streams at <url1> and <url2>.
> Make the mock server send a video_status message with those URLs so I can test, and check that
> the RGB/Thermal toggle in VideoFeed.tsx shows them. If the stream fails to load, show a clear
> "stream unavailable" message instead of a broken image.

**Polish pass for judges (roadmap Day 10)**
> Review the Live operations page at 1920×1080 and on a projector-like 1366×768 screen. List
> anything too small to read from 3 metres or visually cluttered, then fix the top five issues
> using the existing CSS tokens in src/index.css.

**Integration bug**
> During integration the priority list shows survivors as "Unscored" even though the backend logs
> risk scores. Find out why (check field names, detection_id vs id, message type) and fix it, with
> a unit test that reproduces the bug.

**Demo rehearsal helper (Days 13–14)**
> Write docs/DEMO_SCRIPT_MEMBER5.md: what to point at on the dashboard for each timestamp of the
> master doc §20.1 demo, and a backup plan if the WebSocket drops during the demo (switch to ?ws=sim).
