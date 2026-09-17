# Dashboard test checklist (Member 5)

From master doc §6.5 "Testing checklist", §16.3 test matrix and §17 targets.
Copy this table into your team's test sheet and fill in the result columns on Day 12–13.

## Automated

```bash
npm test          # 11 unit tests
npm run build     # must pass with zero TypeScript errors
```

## Manual — simulator (`npm run dev`)

| # | Check | Expected | Pass? |
|---|---|---|---|
| 1 | Load `/` | Mission starts within 2 s; top bar shows CONNECTED and "Simulated data" | |
| 2 | Watch first lane | Survivor #1 appears LOW; drone arrow moves; coverage bar grows | |
| 3 | Fire found | Survivor #2 turns red CRITICAL with reason string; critical pop-up appears | |
| 4 | RGB/Thermal toggle | Feed switches; HUD label changes | |
| 5 | GPS-denied strip | Navigation shows "GPS denied — local nav"; drone arrow turns orange; no freeze | |
| 6 | Last lane | Indicator OFFLINE with queued count; feed shows "paused" | |
| 7 | ~14 s later | SYNCING, then CONNECTED; debris + Survivor #4 appear with "synced after reconnect" tags, in time order | |
| 8 | Mission ends | State Complete, coverage ≥ 80 % | |
| 9 | Click a priority row | Map flies to that survivor and opens its popup | |
| 10 | Mission history → Replay this session | Slider scrubs map + priority list back in time | |
| 11 | Theme toggle, 420 px wide window | Everything readable, no horizontal scroll | |

## Manual — real WebSocket (`npm run mock:server` + `npm run dev:backend`)

| # | Check | Expected | Pass? |
|---|---|---|---|
| 12 | Mission control page | Socket "open", message counts increase | |
| 13 | Refresh browser mid-mission | Panels refill immediately (batch backlog), no toast flood | |
| 14 | `curl -X POST localhost:8000/api/debug/link/cut` | OFFLINE within 5 s | |
| 15 | `curl -X POST localhost:8000/api/debug/link/restore` | SYNCING → CONNECTED, queued events ordered correctly | |
| 16 | Stop the mock server (Ctrl+C) | OFFLINE "Backend unreachable — retrying"; restart it → reconnects by itself | |
| 17 | Mission history → Load mission | Loads the mission from REST and replays it | |
| 18 | Start / Abort buttons | Success message; state changes to SEARCHING / RETURNING | |

## Integration with Member 4's backend (Day 5+ / Day 12)

| # | Check (§16.3) | Target | Result |
|---|---|---|---|
| 19 | Detection published on ROS → pin on map | ≤ 2 s (§17 alert latency) | |
| 20 | CRITICAL detection → alert visible | ≤ 1 s after score computed | |
| 21 | Network cut (Member 6 toggle) | OFFLINE within 5 s | |
| 22 | Network restore | SYNCING then CONNECTED, events in original order | |
| 23 | GPS loss (Scenario 4) | Mode indicator updates, track continues | |
| 24 | No panel silently stops updating during a full run | — | |
| 25 | Offline indicator matches `link_connected` for the whole run | — | |

If anything fails, use the Mission control message counts to see whether the backend sent the
message at all before debugging the UI.
