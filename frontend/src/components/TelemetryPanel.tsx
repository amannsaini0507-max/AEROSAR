import type { MissionModel } from '../types';
import { formatClock } from '../lib/time';

/**
 * Panel 6: Live Telemetry
 * Lat, Lon, Altitude, Heading, Ground Speed.
 * Driven strictly by WebSocket telemetry / drone_pose envelopes.
 */
export default function TelemetryPanel({ model }: { model: MissionModel }) {
  const pose = model.pose;
  const isGpsDenied = model.mission?.navMode === 'GPS_DENIED' || pose?.gpsFix === false;

  return (
    <section className="panel dashboard__telemetry" aria-label="Live Telemetry">
      <div className="panel__head">
        <span className="panel__title">
          <span className={`pulse-dot ${pose ? '' : 'offline'}`} style={{ position: 'static' }} />
          Live Telemetry (30 Hz)
        </span>
        <span className="panel__count mono">
          {pose ? formatClock(pose.time) : '--:--:--'}
        </span>
      </div>
      <div className="panel__body panel__body--padded">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <div className="telemetry-card">
            <span className="telemetry-label">Latitude</span>
            <span className="telemetry-val mono">{pose?.lat != null ? pose.lat.toFixed(6) : '—'}</span>
          </div>
          <div className="telemetry-card">
            <span className="telemetry-label">Longitude</span>
            <span className="telemetry-val mono">{pose?.lng != null ? pose.lng.toFixed(6) : '—'}</span>
          </div>
          <div className="telemetry-card">
            <span className="telemetry-label">Altitude (AGL)</span>
            <span className="telemetry-val mono">{pose?.altitude != null ? `${pose.altitude.toFixed(1)} m` : '—'}</span>
          </div>
          <div className="telemetry-card">
            <span className="telemetry-label">Heading</span>
            <span className="telemetry-val mono">{pose?.heading != null ? `${Math.round(pose.heading).toString().padStart(3, '0')}°` : '—'}</span>
          </div>
          <div className="telemetry-card">
            <span className="telemetry-label">Ground Speed</span>
            <span className="telemetry-val mono">{pose?.speed != null ? `${pose.speed.toFixed(1)} m/s` : '—'}</span>
          </div>
          <div className="telemetry-card">
            <span className="telemetry-label">GPS Status</span>
            <span className={`telemetry-val mono ${isGpsDenied ? 'warn-text' : 'ok-text'}`}>
              {isGpsDenied ? 'GPS DENIED (LOCAL NAV)' : '3D FIX (HEALTHY)'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
