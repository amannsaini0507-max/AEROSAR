/**
 * Mock command-center backend for Member 5 (master doc §6.5 Day 2).
 *
 * Serves the SAME endpoints Member 4's FastAPI backend will expose, driven by
 * the same demo scenario as the in-browser simulator, so the dashboard can be
 * tested over a real WebSocket before the real backend exists.
 *
 *   WS    ws://localhost:8000/ws/live
 *   GET   /api/missions/{id}/history
 *   POST  /api/mission/start      → {success, message}   (std_srvs/Trigger shape)
 *   POST  /api/mission/abort
 *   POST  /api/debug/link/cut     → simulate Member 6's network toggle
 *   POST  /api/debug/link/restore
 *
 * Run:  npm run mock:server     (PORT=8001 npm run mock:server to change port)
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createScenario } from '../src/mock/scenario.ts';
import type { ServerMessage } from '../src/types.ts';

const PORT = Number(process.env.PORT ?? 8000);

interface StoredEvent {
  event_id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
  synced_at: string;
}

const HISTORY_TYPES: Record<string, string> = {
  detection: 'detection',
  hazard: 'hazard',
  alert: 'alert',
  mission_status: 'status',
  risk_score: 'risk_score',
  priority: 'priority',
  drone_pose: 'drone_pose'
};

const history = new Map<string, StoredEvent[]>();
let currentMission = '';
let counter = 0;

function store(msg: ServerMessage) {
  if (msg.type === 'mission_status') currentMission = msg.data.mission_id;
  const eventType = HISTORY_TYPES[msg.type];
  if (!eventType || !currentMission) return;
  const data = msg.data as { stamp?: unknown };
  const stamp = typeof data.stamp === 'string' ? data.stamp : new Date().toISOString();
  const list = history.get(currentMission) ?? [];
  list.push({ event_id: `evt-${++counter}`, event_type: eventType, payload: msg.data, created_at: stamp, synced_at: new Date().toISOString() });
  history.set(currentMission, list);
}

const clients = new Set<WebSocket>();
function broadcast(msg: ServerMessage) {
  store(msg);
  const frame = JSON.stringify(msg);
  clients.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(frame));
}

const scenario = createScenario(broadcast, { autoStart: true });

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  const historyMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/history$/);
  if (req.method === 'GET' && historyMatch) {
    const id = decodeURIComponent(historyMatch[1]);
    const events = history.get(id);
    if (!events) return sendJson(res, 404, { detail: `Unknown mission ${id}` });
    return sendJson(res, 200, { mission_id: id, events });
  }
  if (req.method === 'GET' && url.pathname === '/api/missions') {
    return sendJson(res, 200, { missions: [...history.keys()] });
  }
  if (req.method === 'POST' && url.pathname === '/api/mission/start') {
    scenario.start();
    return sendJson(res, 200, { success: true, message: 'Mission started (mock)' });
  }
  if (req.method === 'POST' && url.pathname === '/api/mission/abort') {
    scenario.abort();
    return sendJson(res, 200, { success: true, message: 'Mission aborted — returning to launch (mock)' });
  }
  if (req.method === 'POST' && url.pathname === '/api/debug/link/cut') {
    scenario.cutLink();
    return sendJson(res, 200, { success: true, message: 'Drone link cut (mock)' });
  }
  if (req.method === 'POST' && url.pathname === '/api/debug/link/restore') {
    scenario.restoreLink();
    return sendJson(res, 200, { success: true, message: 'Drone link restored (mock)' });
  }
  sendJson(res, 404, { detail: 'Not found' });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws/live') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    // Late joiners get the current mission's events so panels aren't empty.
    const backlog = history.get(currentMission) ?? [];
    const replay: ServerMessage[] = backlog
      .filter((e) => e.event_type !== 'drone_pose')
      .map((e) => ({ type: e.event_type === 'status' ? 'mission_status' : e.event_type, data: e.payload }) as ServerMessage);
    if (replay.length) ws.send(JSON.stringify({ type: 'batch', data: replay }));
    ws.on('close', () => clients.delete(ws));
  });
});

server.listen(PORT, () => {
  console.log(`AEROSAR mock backend on http://localhost:${PORT}`);
  console.log(`  WebSocket  ws://localhost:${PORT}/ws/live`);
  console.log(`  History    http://localhost:${PORT}/api/missions/<id>/history`);
  console.log('Dashboard:  npm run dev:backend   (in another terminal)');
});
