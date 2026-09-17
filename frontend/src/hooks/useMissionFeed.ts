import { useCallback, useEffect, useRef, useState } from 'react';
import type { MissionModel } from '../types';
import { applyMessage, createInitialModel, parseFrame } from '../lib/reducer';
import { createScenario, type ScenarioControls } from '../mock/scenario';
import { API_BASE } from '../lib/config';
import type { ServerMessage } from '../types';

export interface RecordedMessage {
  msg: ServerMessage;
  receivedAt: number;
}
const MAX_SESSION_LOG = 20000;

const RECONNECT_MS = 3000;

export interface MissionControls {
  /** `/mission/start` (std_srvs/Trigger) — see WS_CONTRACT.md §REST. */
  start(): Promise<string>;
  /** `/mission/abort` (std_srvs/Trigger). */
  abort(): Promise<string>;
  /** Simulator only: emulate Member 6's network toggle. */
  cutLink?: () => void;
  restoreLink?: () => void;
}

async function postTrigger(path: string): Promise<string> {
  if (!API_BASE) throw new Error('No API base configured (set VITE_API_BASE).');
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Backend answered ${res.status} for ${path}`);
  }
  return body.message || 'OK';
}

/**
 * Single source of mission data for the whole app.
 * - `wsUrl` set  → connects to the backend WebSocket, auto-reconnects every 3 s.
 * - `wsUrl` null → runs the demo scenario in the browser (same messages).
 */
export function useMissionFeed(wsUrl: string | null) {
  const source = wsUrl ? 'websocket' : 'simulator';
  const [model, setModel] = useState<MissionModel>(() => createInitialModel(source));
  const [now, setNow] = useState(() => Date.now());
  const scenarioRef = useRef<ScenarioControls | null>(null);
  const sessionLog = useRef<RecordedMessage[]>([]);

  const ingest = useCallback((msg: ServerMessage) => {
    const log = sessionLog.current;
    log.push({ msg, receivedAt: Date.now() });
    if (log.length > MAX_SESSION_LOG) log.splice(0, log.length - MAX_SESSION_LOG);
    setModel((m) => applyMessage(m, msg));
  }, []);

  // 1 Hz clock so "stale link" and elapsed time update even when no messages arrive.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setModel(createInitialModel(source));
    sessionLog.current = [];

    if (!wsUrl) {
      const scenario = createScenario((msg) => {
        if (!cancelled) ingest(msg);
      });
      scenarioRef.current = scenario;
      return () => {
        cancelled = true;
        scenario.stop();
        scenarioRef.current = null;
      };
    }

    let socket: WebSocket | null = null;
    let retry: number | null = null;

    const connect = () => {
      setModel((m) => ({ ...m, socket: 'connecting' }));
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        if (!cancelled) setModel((m) => ({ ...m, socket: 'open' }));
      };
      socket.onmessage = (event) => {
        if (cancelled) return;
        const msg = parseFrame(event.data);
        if (msg) ingest(msg);
      };
      socket.onclose = () => {
        if (cancelled) return;
        setModel((m) => ({ ...m, socket: 'closed' }));
        retry = window.setTimeout(connect, RECONNECT_MS);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [wsUrl, source, ingest]);

  const start = useCallback(async () => {
    if (scenarioRef.current) {
      scenarioRef.current.start();
      return 'Simulated mission started';
    }
    return postTrigger('/api/mission/start');
  }, []);

  const abort = useCallback(async () => {
    if (scenarioRef.current) {
      scenarioRef.current.abort();
      return 'Simulated mission aborted — returning to launch';
    }
    return postTrigger('/api/mission/abort');
  }, []);

  const controls: MissionControls = {
    start,
    abort,
    ...(source === 'simulator'
      ? { cutLink: () => scenarioRef.current?.cutLink(), restoreLink: () => scenarioRef.current?.restoreLink() }
      : {})
  };

  const getSessionLog = useCallback(() => sessionLog.current.slice(), []);

  return { model, now, controls, getSessionLog };
}
