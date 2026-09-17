import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutContext } from '../layouts/AppLayout';
import { API_BASE, WS_URL } from '../lib/config';
import { formatClock } from '../lib/time';

type Status = { tone: 'ok' | 'error'; text: string } | null;

/**
 * Mission start/abort (§7.3 `/mission/start`, `/mission/abort`) plus the
 * connection diagnostics Member 5 needs for Day 2 ("confirm live message
 * receipt") and Day 12 integration.
 */
export default function MissionControl() {
  const { model, now, link, controls } = useOutletContext<LayoutContext>();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const sim = model.source === 'simulator';
  const state = model.mission?.state;
  const flying = state === 'SEARCHING' || state === 'RETURNING';

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ tone: 'ok', text: await action() });
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const counts = Object.entries(model.messageCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Mission control</h1>
          <p className="page-header__subtitle">Start or abort the autonomous search and check the data link.</p>
        </div>
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="panel__head">
            <span className="panel__title">Mission</span>
            <span className="panel__count mono">{model.mission?.missionId ?? 'No mission'}</span>
          </div>
          <div className="panel__body panel__body--padded">
            <p className="body-copy">
              Start begins the autonomous search pattern. Abort sends the drone back to its launch point.
              {sim ? ' These buttons drive the built-in simulator.' : ' These call the backend, which forwards them to the ROS 2 services.'}
            </p>
            <div className="form-actions">
              <button className="btn btn--primary" type="button" disabled={busy || flying} onClick={() => run(controls.start)}>
                Start mission
              </button>
              <button className="btn btn--danger" type="button" disabled={busy || state !== 'SEARCHING'} onClick={() => run(controls.abort)}>
                Abort mission
              </button>
            </div>
            {status && <p className={`inline-status inline-status--${status.tone}`}>{status.text}</p>}

            {controls.cutLink && controls.restoreLink && (
              <>
                <h3 className="subheading">Rehearse the offline moment</h3>
                <p className="body-copy">
                  The demo scenario cuts the link automatically on the last search lane. Use these to rehearse it by hand
                  (on the real system Member 6's network toggle does this).
                </p>
                <div className="form-actions">
                  <button className="btn btn--ghost" type="button" disabled={!flying || link.state === 'OFFLINE'} onClick={controls.cutLink}>
                    Cut drone link
                  </button>
                  <button className="btn btn--ghost" type="button" disabled={link.state !== 'OFFLINE'} onClick={controls.restoreLink}>
                    Restore drone link
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <span className="panel__title">Data link</span>
            <span className={`link-pill link-pill--${link.state.toLowerCase()}`}>{link.state}</span>
          </div>
          <div className="panel__body panel__body--padded">
            <dl className="kv">
              <dt>Data source</dt>
              <dd>{sim ? 'Built-in simulator' : 'Backend WebSocket'}</dd>
              <dt>WebSocket</dt>
              <dd className="mono">{WS_URL ?? '—'}</dd>
              <dt>REST base</dt>
              <dd className="mono">{API_BASE ?? '—'}</dd>
              <dt>Socket</dt>
              <dd>{model.socket}</dd>
              <dt>Link detail</dt>
              <dd>{link.detail}</dd>
              <dt>Last message</dt>
              <dd>{model.lastMessageAt ? `${formatClock(model.lastMessageAt)} (${Math.round((now - model.lastMessageAt) / 1000)} s ago)` : 'None yet'}</dd>
            </dl>
            <h3 className="subheading">Messages received</h3>
            {counts.length === 0 ? (
              <p className="body-copy">Nothing received yet.</p>
            ) : (
              <table className="history-table history-table--compact">
                <tbody>
                  {counts.map(([type, n]) => (
                    <tr key={type}>
                      <td className="mono">{type}</td>
                      <td className="mono num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
