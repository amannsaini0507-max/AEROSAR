import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutContext } from '../layouts/AppLayout';
import { API_BASE } from '../lib/config';
import { fromHistoryRows, fromSessionLog, modelAt, type HistoryEventRow, type ReplayEvent } from '../lib/replay';
import { formatClock, formatDuration } from '../lib/time';
import { deleteMission, listMissions, loadMissionEvents, type MissionSummary } from '../lib/missionArchive';
import MapPanel from '../components/MapPanel';
import PriorityList from '../components/PriorityList';
import LevelBadge from '../components/LevelBadge';
import { alertLevel, hazardLabel } from '../lib/levels';

type Loaded = { label: string; events: ReplayEvent[] };

function describe(ev: ReplayEvent): { text: string; level: ReturnType<typeof alertLevel> | null } {
  const { msg } = ev;
  switch (msg.type) {
    case 'detection':
      return { text: `Detection: ${msg.data.detection_type}, confidence ${msg.data.confidence.toFixed(2)}`, level: null };
    case 'hazard':
      return { text: `Hazard: ${hazardLabel(msg.data.hazard_type)}`, level: null };
    case 'alert':
      return { text: msg.data.message, level: alertLevel(msg.data.alert_type) };
    case 'risk_score':
      return { text: `Risk score ${msg.data.score.toFixed(2)} — ${msg.data.reason}`, level: msg.data.priority_level };
    case 'mission_status':
      return { text: `Mission state: ${msg.data.state.toLowerCase()} (coverage ${Math.round(msg.data.coverage_percent)}%)`, level: null };
    default:
      return { text: msg.type.replace('_', ' '), level: null };
  }
}

/**
 * Mission replay (master doc §2 Level 3, §6.5 "REST /api/missions/{id}/history").
 * Replays either this browser session or a mission stored by the backend,
 * through the same reducer the live view uses.
 */
export default function MissionHistory() {
  const { model, theme, getSessionLog } = useOutletContext<LayoutContext>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [cursor, setCursor] = useState<number>(0);
  const [missionId, setMissionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [archive, setArchive] = useState<MissionSummary[]>([]);

  const refreshArchive = useCallback(() => setArchive(listMissions()), []);
  useEffect(refreshArchive, [refreshArchive, model.mission?.missionId, model.mission?.state]);

  function show(label: string, events: ReplayEvent[]) {
    setLoaded({ label, events });
    setCursor(events.length ? events[events.length - 1].time : 0);
    setSelectedId(null);
  }

  function openArchived(summary: MissionSummary) {
    const events = loadMissionEvents(summary.missionId);
    if (events.length === 0) {
      setError(`No saved events left for ${summary.missionId}.`);
      return;
    }
    setError(null);
    show(`${summary.missionId} (recorded ${new Date(summary.startedAt).toLocaleString()})`, events);
  }

  function removeArchived(summary: MissionSummary) {
    deleteMission(summary.missionId);
    refreshArchive();
    if (loaded?.label.startsWith(summary.missionId)) setLoaded(null);
  }

  function loadSession() {
    setError(null);
    const events = fromSessionLog(getSessionLog());
    if (events.length === 0) {
      setError('Nothing recorded in this session yet. Leave Live operations running for a bit, then try again.');
      return;
    }
    show('This browser session', events);
  }

  async function loadBackend() {
    const id = missionId.trim() || model.mission?.missionId || '';
    if (!API_BASE) return setError('No backend configured. Set VITE_API_BASE or VITE_WS_URL.');
    if (!id) return setError('Enter a mission ID to load.');
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/missions/${encodeURIComponent(id)}/history`);
      if (!res.ok) throw new Error(`Backend answered ${res.status} for mission ${id}.`);
      const body = await res.json();
      const rows: HistoryEventRow[] = Array.isArray(body) ? body : body.events ?? [];
      const events = fromHistoryRows(rows);
      if (events.length === 0) throw new Error(`Mission ${id} has no replayable events.`);
      show(`Mission ${id} (backend)`, events);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const first = loaded?.events[0]?.time ?? 0;
  const last = loaded?.events[loaded.events.length - 1]?.time ?? 0;
  const snapshot = useMemo(() => (loaded ? modelAt(loaded.events, cursor, model.source) : null), [loaded, cursor, model.source]);
  const visibleEvents = useMemo(() => {
    if (!loaded) return [];
    let lastState = '';
    return loaded.events
      .filter((e) => {
        if (e.time > cursor) return false;
        if (e.msg.type === 'mission_status') {
          // only show state changes, not the 1 Hz heartbeat
          const changed = e.msg.data.state !== lastState;
          lastState = e.msg.data.state;
          return changed;
        }
        return e.msg.type !== 'drone_pose' && e.msg.type !== 'priority' && e.msg.type !== 'video_status' && e.msg.type !== 'route';
      })
      .slice(-40)
      .reverse();
  }, [loaded, cursor]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Mission history</h1>
          <p className="page-header__subtitle">A record of the missions this dashboard has watched. Open one to scrub back through it.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel__head">
          <span className="panel__title">Recorded missions</span>
          <span className="panel__count">{archive.length ? `${archive.length} saved in this browser` : 'none yet'}</span>
        </div>
        <div className="panel__body">
          {archive.length === 0 ? (
            <div className="empty-state">
              <strong>No missions recorded yet</strong>
              <span>Every mission this dashboard watches is saved here automatically, and stays after a refresh.</span>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="history-table record-book">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Mission</th>
                    <th>Length</th>
                    <th>Survivors</th>
                    <th>Hazards</th>
                    <th>Coverage</th>
                    <th>Offline</th>
                    <th>Ended</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {archive.map((m) => (
                    <tr key={m.missionId}>
                      <td>{new Date(m.startedAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="mono">
                        {m.missionId}
                        {m.source === 'simulator' && <span className="tag tag--sim">sim</span>}
                      </td>
                      <td className="mono">{formatDuration(m.durationMs / 1000)}</td>
                      <td>
                        <span className="count-chips">
                          <strong>{m.survivors}</strong>
                          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)
                            .filter((lvl) => m.byLevel?.[lvl])
                            .map((lvl) => (
                              <span key={lvl} className={`dot-count level-${lvl.toLowerCase()}`}>
                                {m.byLevel[lvl]}
                              </span>
                            ))}
                        </span>
                      </td>
                      <td>{m.hazards}</td>
                      <td>{Math.round(m.coverage)}%</td>
                      <td>{m.offlineEvents > 0 ? `${m.offlineEvents} synced` : '—'}</td>
                      <td>{m.state === 'COMPLETE' ? 'Complete' : m.state.charAt(0) + m.state.slice(1).toLowerCase()}</td>
                      <td className="record-book__actions">
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => openArchived(m)}>
                          Open
                        </button>
                        <button type="button" className="link-btn" onClick={() => removeArchived(m)} title="Remove from this browser">
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__body panel__body--padded">
          <div className="history-controls">
            <button className="btn btn--primary" type="button" onClick={loadSession}>
              Replay the mission running now
            </button>
            <span className="history-controls__or">or load one from the backend</span>
            <div className="form-field form-field--inline">
              <label htmlFor="missionId" className="visually-hidden">
                Mission ID
              </label>
              <input
                id="missionId"
                type="text"
                placeholder={model.mission?.missionId ?? 'Mission ID'}
                value={missionId}
                onChange={(e) => setMissionId(e.target.value)}
              />
            </div>
            <button className="btn btn--ghost" type="button" onClick={loadBackend} disabled={loading || !API_BASE}>
              {loading ? 'Loading…' : 'Load mission'}
            </button>
          </div>
          {!API_BASE && <p className="body-copy">Backend loading is off because no backend is configured.</p>}
          {error && <p className="inline-status inline-status--error">{error}</p>}
        </div>
      </section>

      {loaded && snapshot && (
        <>
          <section className="panel replay-bar">
            <div className="panel__body panel__body--padded">
              <div className="replay-bar__top">
                <strong>{loaded.label}</strong>
                <span className="mono">
                  {formatClock(cursor)} · T+{formatDuration((cursor - first) / 1000)} of {formatDuration((last - first) / 1000)}
                </span>
              </div>
              <input
                className="replay-slider"
                type="range"
                min={first}
                max={last}
                step={250}
                value={cursor}
                onChange={(e) => setCursor(Number(e.target.value))}
                aria-label="Replay position"
              />
            </div>
          </section>

          <div className="replay-grid">
            <MapPanel model={snapshot} theme={theme} selectedId={selectedId} onSelect={setSelectedId} />
            <PriorityList model={snapshot} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          <section className="panel">
            <div className="panel__head">
              <span className="panel__title">Events up to this point</span>
              <span className="panel__count">latest 40</span>
            </div>
            <div className="table-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((ev) => {
                    const d = describe(ev);
                    return (
                      <tr key={ev.id}>
                        <td className="mono">{formatClock(ev.time)}</td>
                        <td>{d.level ? <LevelBadge level={d.level} /> : <span className="tag">{ev.msg.type.replace('_', ' ')}</span>}</td>
                        <td>{d.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
