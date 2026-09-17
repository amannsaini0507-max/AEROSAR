import type { MissionModel } from '../types';
import type { LogEntry } from '../lib/derive';
import { arrivedLate, formatClock } from '../lib/time';
import { hazardLabel } from '../lib/levels';

/**
 * Chronological event log. Makes the offline→sync demo moment legible:
 * events captured offline show up in their true position with a "synced" tag.
 */
export default function MissionLog({ model }: { model: MissionModel }) {
  const entries: LogEntry[] = [
    ...Object.values(model.survivors).map((s) => ({
      id: s.id,
      time: s.time,
      receivedAt: s.receivedAt,
      kind: 'survivor' as const,
      text: `Survivor #${s.seq} detected, confidence ${s.confidence.toFixed(2)}${s.thermalConfirmed ? ', thermal-confirmed' : ''}`
    })),
    ...Object.values(model.hazards).map((h) => ({
      id: h.id,
      time: h.time,
      receivedAt: h.receivedAt,
      kind: 'hazard' as const,
      text: `${hazardLabel(h.hazardType)} hazard detected, confidence ${h.confidence.toFixed(2)}`
    })),
    ...model.alerts
      .filter((a) => a.alertType !== 'SURVIVOR_DETECTED' && a.alertType !== 'HAZARD_DETECTED')
      .map((a) => ({ id: a.id, time: a.time, receivedAt: a.receivedAt, kind: 'alert' as const, level: a.level, text: a.message }))
  ].sort((a, b) => b.time - a.time);

  return (
    <section className="panel dashboard__log" aria-label="Mission log">
      <div className="panel__head">
        <span className="panel__title">Mission log</span>
        <span className="panel__count">{entries.length} events</span>
      </div>
      <div className="panel__body">
        {entries.length === 0 ? (
          <div className="empty-state">
            <span>The log fills in as the drone reports detections and mission events.</span>
          </div>
        ) : (
          <div className="log-list scrollbar-thin">
            {entries.map((e) => (
              <div key={e.kind + e.id} className="log-row">
                <span className="log-row__time">{formatClock(e.time)}</span>
                <span className={`tag tag--${e.kind}`}>{e.kind}</span>
                <span>
                  {e.text}
                  {arrivedLate(e) && <span className="synced-tag">synced {formatClock(e.receivedAt)}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
