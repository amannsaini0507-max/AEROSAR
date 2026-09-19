import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutContext } from '../layouts/AppLayout';
import ConnectionIndicator from '../components/ConnectionIndicator';
import VideoFeed from '../components/VideoFeed';
import MapPanel from '../components/MapPanel';
import MissionStatusPanel from '../components/MissionStatusPanel';
import AlertsPanel from '../components/AlertsPanel';
import PriorityList from '../components/PriorityList';
import MissionLog from '../components/MissionLog';

/** The judge-facing screen: layout follows the wireframe in master doc §14.2. */
export default function LiveOperations() {
  const { model, now, link, theme } = useOutletContext<LayoutContext>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="page page--wide">
      <div className="page-header page-header--tight">
        <div>
          <h1 className="page-header__title">Live operations</h1>
          <p className="page-header__subtitle">
            {model.mission ? `Mission ${model.mission.missionId}` : 'Waiting for the drone to report a mission'}
          </p>
        </div>
        <div className="page-header__action">
          <ConnectionIndicator link={link} />
        </div>
      </div>

      <div className="dashboard">
        <VideoFeed model={model} linkOffline={link.state === 'OFFLINE'} />
        <MissionStatusPanel model={model} now={now} />
        <MapPanel model={model} theme={theme} selectedId={selectedId} onSelect={setSelectedId} />
        <AlertsPanel model={model} />
        <PriorityList model={model} selectedId={selectedId} onSelect={setSelectedId} />
        <MissionLog model={model} />
      </div>

      {model.source === 'simulator' && (
        <div className="footer-note">
          Showing the built-in demo scenario. Set VITE_WS_URL (or open with ?ws=ws://host:8000/ws/live) to use the real backend.
        </div>
      )}
    </div>
  );
}
