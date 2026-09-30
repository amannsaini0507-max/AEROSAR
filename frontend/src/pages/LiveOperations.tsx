import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { LayoutContext } from '../layouts/AppLayout';
import ConnectionIndicator from '../components/ConnectionIndicator';
import Simulator3DView from '../components/Simulator3DView';
import MapPanel from '../components/MapPanel';
import PriorityList from '../components/PriorityList';
import AlertsPanel from '../components/AlertsPanel';
import MissionStatusPanel from '../components/MissionStatusPanel';
import TelemetryPanel from '../components/TelemetryPanel';
import ConnectivityPanel from '../components/ConnectivityPanel';
import FlightControlsPanel from '../components/FlightControlsPanel';
import ReplayBar from '../components/ReplayBar';

/**
 * Live Operations Command Center.
 * Section 5 Compliance: 8 dedicated panels driven strictly by WebSocket telemetry:
 * 1. 3D WebGL Three.js view with RGB/Thermal toggle
 * 2. Leaflet Map (drone icon, survivor pins, hazard zones, A* safe route, canvas basemap)
 * 3. Ranked survivor queue with explainable risk breakdown
 * 4. Alert feed (CRITICAL red, HIGH orange, with explain text)
 * 5. Mission status and battery %
 * 6. Live telemetry (lat, lon, altitude, heading, speed)
 * 7. Connectivity & offline-sync toggle with buffered-event counter
 * 8. Flight controls (Start, Pause, Resume, RTL, Emergency Land, manual WASD)
 * Plus Section 3 frame-accurate Mission Replay Bar.
 */
export default function LiveOperations() {
  const { model, now, link, theme, controls, ingest } = useOutletContext<LayoutContext>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="page page--wide">
      <div className="page-header page-header--tight">
        <div>
          <h1 className="page-header__title">AEROSAR Command Center</h1>
          <p className="page-header__subtitle">
            {model.mission ? `Mission ${model.mission.missionId} · 30m x 30m Tactical Arena` : 'Waiting for drone link...'}
          </p>
        </div>
        <div className="page-header__action">
          <ConnectionIndicator link={link} />
        </div>
      </div>

      {/* Frame-accurate Mission Replay Bar (Section 3) */}
      <ReplayBar onReplayFrame={ingest} activeMissionId={model.mission?.missionId ?? 'MISSION-AEROSAR-01'} />

      {/* 8-Panel Tactical Grid (Section 5) */}
      <div className="dashboard" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {/* Panel 1: 3D WebGL Simulator */}
        <Simulator3DView model={model} onSendCommand={controls.sendCommand} />

        {/* Panel 2: Leaflet Tactical Map */}
        <MapPanel model={model} theme={theme} selectedId={selectedId} onSelect={setSelectedId} />

        {/* Panel 3: Ranked Survivor Queue */}
        <PriorityList model={model} selectedId={selectedId} onSelect={setSelectedId} />

        {/* Panel 4: Alert Feed */}
        <AlertsPanel model={model} />

        {/* Panel 5: Mission Status & Battery */}
        <MissionStatusPanel model={model} now={now} />

        {/* Panel 6: Live Telemetry */}
        <TelemetryPanel model={model} />

        {/* Panel 7: Connectivity & Offline Sync */}
        <ConnectivityPanel model={model} onSendCommand={controls.sendCommand} />

        {/* Panel 8: Flight Controls */}
        <FlightControlsPanel model={model} onSendCommand={controls.sendCommand} />
      </div>
    </div>
  );
}
