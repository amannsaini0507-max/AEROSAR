import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutContext } from '../layouts/AppLayout';
import ConnectionIndicator from '../components/ConnectionIndicator';
import PriorityList from '../components/PriorityList';
import { hazardCounts } from '../lib/derive';
import { hazardLabel } from '../lib/levels';

/**
 * Large-type summary for a projector or a second monitor (§14.1 "legibility
 * from a distance"). Same live data as the main view, fewer things on screen.
 */
export default function BriefingView() {
  const { model, link } = useOutletContext<LayoutContext>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hazards = hazardCounts(model);
  const m = model.mission;

  return (
    <div className="page briefing">
      <div className="briefing__top">
        <div>
          <p className="briefing__mission mono">{m?.missionId ?? 'No mission'}</p>
          <h1 className="briefing__state">{m ? m.state.charAt(0) + m.state.slice(1).toLowerCase() : 'Waiting for drone'}</h1>
        </div>
        <ConnectionIndicator link={link} />
      </div>

      <div className="briefing__figures">
        <div className="figure">
          <span className="figure__value">{Object.keys(model.survivors).length}</span>
          <span className="figure__label">Survivors located</span>
        </div>
        <div className="figure">
          <span className="figure__value">{Object.keys(model.hazards).length}</span>
          <span className="figure__label">Hazards mapped</span>
        </div>
        <div className="figure">
          <span className="figure__value">{m ? `${Math.round(m.coverage)}%` : '—'}</span>
          <span className="figure__label">Area covered</span>
        </div>
        <div className="figure">
          <span className="figure__value">{m ? `${Math.round(m.battery)}%` : '—'}</span>
          <span className="figure__label">Battery</span>
        </div>
      </div>

      <PriorityList model={model} selectedId={selectedId} onSelect={setSelectedId} limit={5} large />

      <p className="briefing__hazards">
        {Object.keys(hazards).length === 0
          ? 'No hazards mapped yet.'
          : `Hazards: ${Object.entries(hazards)
              .map(([t, n]) => `${hazardLabel(t)} ${n}`)
              .join(', ')}`}
      </p>
    </div>
  );
}
