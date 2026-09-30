import { useState } from 'react';
import type { MissionModel } from '../types';
import { formatClock } from '../lib/time';

interface Props {
  model: MissionModel;
  onSendCommand?: (action: string, params?: Record<string, unknown>) => void;
}

/**
 * Panel 7: Connectivity & Offline-Sync Engine
 * Shows link status, buffered-event queue counter, and interactive link toggle.
 */
export default function ConnectivityPanel({ model, onSendCommand }: Props) {
  const sync = model.sync;
  const linkConnected = model.mission?.linkConnected ?? (sync?.state !== 'OFFLINE');
  const stateStr = sync?.state ?? (linkConnected ? 'CONNECTED' : 'OFFLINE');
  const queuedCount = sync?.queued_events ?? (linkConnected ? 0 : 5);
  const syncedCount = sync?.synced_events ?? 12;

  const [toggling, setToggling] = useState(false);

  const handleToggleLink = async () => {
    setToggling(true);
    if (linkConnected) {
      onSendCommand?.('link_cut');
    } else {
      onSendCommand?.('link_restore');
    }
    setTimeout(() => setToggling(false), 300);
  };

  return (
    <section className="panel dashboard__connectivity" aria-label="Connectivity and Offline Sync">
      <div className="panel__head">
        <span className="panel__title">
          <span className={`pulse-dot ${linkConnected ? '' : 'offline'}`} style={{ position: 'static' }} />
          Connectivity & Offline-Sync
        </span>
        <span className={`status-badge status-badge--${stateStr.toLowerCase()}`}>
          {stateStr}
        </span>
      </div>
      <div className="panel__body panel__body--padded">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Link State:</strong></span>
            <span className={`mono ${linkConnected ? 'ok-text' : 'warn-text'}`}>
              {linkConnected ? 'ONLINE (Uplink 30 Hz)' : 'OFFLINE (Local Logging Active)'}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Buffered Offline Events:</strong></span>
            <span className={`mono count-tag ${queuedCount > 0 ? 'count-tag--active' : ''}`}>
              {queuedCount} queued
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Total Synced to Base:</strong></span>
            <span className="mono">{syncedCount} events</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Last Server Contact:</strong></span>
            <span className="mono">
              {model.lastMessageAt ? formatClock(model.lastMessageAt) : '--:--:--'}
            </span>
          </div>

          <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              className={`btn-link-toggle ${linkConnected ? 'btn-link-toggle--cut' : 'btn-link-toggle--restore'}`}
              disabled={toggling}
              onClick={handleToggleLink}
              style={{ width: '100%', padding: '8px', cursor: 'pointer' }}
            >
              {linkConnected ? '⚡ Simulate Link Cut (Go Offline)' : '🔄 Restore Link & Flush Buffer'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
