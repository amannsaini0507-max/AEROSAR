import type { MissionModel } from '../types';
import { derivePriority } from '../lib/derive';
import LevelBadge from './LevelBadge';
import { arrivedLate } from '../lib/time';

interface Props {
  model: MissionModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
  limit?: number;
  large?: boolean;
}

/**
 * Survivor priority list (§14.2). Shows the backend's score and its
 * plain-English reason string (§11.6) — the "why" judges look for.
 */
export default function PriorityList({ model, selectedId, onSelect, limit, large = false }: Props) {
  const rows = derivePriority(model).slice(0, limit);

  return (
    <section className={`panel dashboard__priority${large ? ' panel--large' : ''}`} aria-label="Survivor priority list">
      <div className="panel__head">
        <span className="panel__title">Survivor priority</span>
        <span className="panel__count">{Object.keys(model.survivors).length} located</span>
      </div>
      <div className="panel__body">
        {rows.length === 0 ? (
          <div className="empty-state">
            <strong>No survivors located yet</strong>
            <span>Ranked survivors appear here with their risk score and reason.</span>
          </div>
        ) : (
          <ol className="priority-list scrollbar-thin">
            {rows.map(({ survivor, risk }, i) => (
              <li key={survivor.id}>
                <button
                  type="button"
                  className={`priority-row level-row-${risk ? risk.level.toLowerCase() : 'unscored'}${selectedId === survivor.id ? ' is-selected' : ''}`}
                  onClick={() => onSelect(survivor.id)}
                  title="Show on map"
                >
                  <span className="priority-row__rank">{i + 1}</span>
                  <span className="priority-row__main">
                    <span className="priority-row__line">
                      <LevelBadge level={risk?.level ?? null} large={large} />
                      <span className="priority-row__name">Survivor #{survivor.seq}</span>
                      <span className="priority-row__score mono">{risk ? risk.score.toFixed(2) : '—'}</span>
                    </span>
                    <span className="priority-row__reason">
                      {risk ? risk.reason.replace(/^[A-Z]+:\s*/, '') : 'Waiting for risk score from backend'}
                    </span>
                    {arrivedLate(survivor) && <span className="synced-tag">detected while offline</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
