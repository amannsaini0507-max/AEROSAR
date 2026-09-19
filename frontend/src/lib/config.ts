/**
 * Runtime configuration.
 *
 *   VITE_WS_URL    e.g. ws://localhost:8000/ws/live   (empty → in-browser simulator)
 *   VITE_API_BASE  e.g. http://localhost:8000
 *
 * For demo-day switching without a rebuild, URL parameters override the env:
 *   ?ws=ws://192.168.1.20:8000/ws/live&api=http://192.168.1.20:8000
 *   ?ws=sim   → force the simulator
 */
function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

const wsParam = readParam('ws');
const apiParam = readParam('api');

const envWs = (import.meta.env.VITE_WS_URL as string | undefined)?.trim() || '';
const envApi = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || '';

export const WS_URL: string | null = wsParam === 'sim' ? null : wsParam || envWs || null;

/** REST base. If only a WS URL is given, derive http(s)://host from it. */
export const API_BASE: string | null = (() => {
  const explicit = apiParam || envApi;
  if (explicit) return explicit.replace(/\/$/, '');
  if (!WS_URL) return null;
  try {
    const u = new URL(WS_URL);
    return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
  } catch {
    return null;
  }
})();
