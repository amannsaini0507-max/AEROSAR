import type { MissionModel } from '../types';
import { hazardCounts } from '../lib/derive';
import { hazardLabel } from '../lib/levels';
import { formatDuration } from '../lib/time';

const STATE_LABEL: Record<string, string> = {
  IDLE: 'Idle',
  SEARCHING: 'Searching',
  RETURNING: 'Returning',
  COMPLETE: 'Complete'
};

const COVERAGE_TARGET = 80; // §17 prototype target

function Meter({ value, tone, target }: { value: number; tone: 'battery' | 'coverage' | 'low'; target?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`meter meter--${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className="meter__fill" style={{ width: `${pct}%` }} />
      {target != null && <div className="meter__target" style={{ left: `${target}%` }} title={`Target ${target}%`} />}
    </div>
  );
}

/** Mission + drone status block (§14.2 top-right). */
export default function MissionStatusPanel({ model, now }: { model: MissionModel; now: number }) {
  const { mission, missionStartedAt } = model;
  const survivors = Object.keys(model.survivors).length;
  const hazards = hazardCounts(model);
  const hazardTotal = Object.values(hazards).reduce((a, b) => a + b, 0);
  const elapsed = missionStartedAt && mission ? ((mission.state === 'COMPLETE' ? mission.time : now) - missionStartedAt) / 1000 : 0;
  const battery = mission?.battery ?? null;
  const denied = mission?.navMode === 'GPS_DENIED';

  return (
    <section className="panel dashboard__status" aria-label="Mission status">
      <div className="panel__head">
        <span className="panel__title">Mission status</span>
        <span className="panel__count mono">{mission ? formatDuration(elapsed) : '--:--'}</span>
      </div>
      <div className="panel__body panel__body--padded status-grid">
        <div className="status-row">
          <span className="status-row__label">State</span>
          <span className={`state-chip state-chip--${(mission?.state ?? 'none').toLowerCase()}`}>
            {mission ? STATE_LABEL[mission.state] ?? mission.state : 'Waiting for drone'}
          </span>
        </div>

        <div className="status-row">
          <span className="status-row__label">Battery</span>
          <Meter value={battery ?? 0} tone={battery != null && battery < 25 ? 'low' : 'battery'} />
          <span className="status-row__value mono">{battery != null ? `${Math.round(battery)}%` : '—'}</span>
        </div>

        <div className="status-row">
          <span className="status-row__label">Coverage</span>
          <Meter value={mission?.coverage ?? 0} tone="coverage" target={COVERAGE_TARGET} />
          <span className="status-row__value mono">{mission ? `${Math.round(mission.coverage)}%` : '—'}</span>
        </div>

        <div className="status-row">
          <span className="status-row__label">Navigation</span>
          <span className={`mode-chip${denied ? ' mode-chip--denied' : ''}`}>
            {mission?.navMode ? (denied ? 'GPS denied — local nav' : 'GPS navigation') : '—'}
          </span>
        </div>

        <div className="status-counts">
          <div className="status-count">
            <span className="status-count__value">{survivors}</span>
            <span className="status-count__label">Survivors</span>
          </div>
          <div className="status-count">
            <span className="status-count__value">{hazardTotal}</span>
            <span className="status-count__label">Hazards</span>
          </div>
          <div className="status-count status-count--wide">
            <span className="status-count__breakdown">
              {hazardTotal === 0
                ? 'No hazards yet'
                : Object.entries(hazards)
                    .map(([t, n]) => `${hazardLabel(t)} ${n}`)
                    .join(', ')}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
