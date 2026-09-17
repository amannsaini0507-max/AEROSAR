import { useState } from 'react';
import type { MissionModel } from '../types';
import LevelBadge from './LevelBadge';
import { CheckIcon } from './icons';
import { arrivedLate, formatClock } from '../lib/time';
import { alertDisplayLevel } from '../lib/derive';

/** Alert feed (§14.2). Ordered by when the event happened, newest first (§13.6). */
export default function AlertsPanel({ model }: { model: MissionModel }) {
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [showAck, setShowAck] = useState(false);
  const list = model.alerts.filter((a) => showAck || !acknowledged.has(a.id));

  return (
    <section className="panel dashboard__alerts" aria-label="Alerts">
      <div className="panel__head">
        <span className="panel__title">Alerts</span>
        <button type="button" className="link-btn" onClick={() => setShowAck((v) => !v)}>
          {showAck ? 'Hide acknowledged' : `Show acknowledged (${acknowledged.size})`}
        </button>
      </div>
      <div className="panel__body">
        {list.length === 0 ? (
          <div className="empty-state">
            <strong>No alerts</strong>
            <span>Survivor, hazard, and link alerts appear here as the drone reports them.</span>
          </div>
        ) : (
          <ul className="feed scrollbar-thin">
            {list.map((a) => {
              const acked = acknowledged.has(a.id);
              const level = alertDisplayLevel(model, a);
              return (
                <li key={a.id} className={`feed-row level-row-${level.toLowerCase()}${acked ? ' is-acked' : ''}`}>
                  <LevelBadge level={level} />
                  <div className="feed-row__body">
                    <p className="feed-row__title">{a.message}</p>
                    <p className="feed-row__meta">
                      {formatClock(a.time)}
                      {arrivedLate(a) && <span className="synced-tag">synced after reconnect</span>}
                    </p>
                  </div>
                  {!acked && (
                    <button
                      className="feed-row__ack"
                      type="button"
                      aria-label="Acknowledge alert"
                      title="Acknowledge"
                      onClick={() => setAcknowledged((prev) => new Set(prev).add(a.id))}
                    >
                      <CheckIcon />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
