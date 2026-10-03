import { useState } from 'react';
import type { MissionModel } from '../types';
import { formatClock } from '../lib/time';

interface Props {
  model: MissionModel;
  onSendCommand?: (action: string, params?: Record<string, unknown>) => void;
}

/**
 * Panel 7: Ground Station / LoRa Link & Offline-Sync Engine
 * Shows link mode, radio propagation metrics (radio-scaled), duty cycle, and LoRa controls.
 */
export default function ConnectivityPanel({ model, onSendCommand }: Props) {
  const sync = model.sync;
  const station = model.station;

  const currentMode = station?.mode ?? sync?.mode ?? (model.mission?.linkConnected !== false ? 'NETWORK' : 'OFFLINE');
  const linkConnected = currentMode === 'NETWORK';
  const isLora = currentMode === 'LORA_ONLY';
  const stateStr = currentMode;

  const queuedCount = station?.queue_length ?? sync?.queued_events ?? (linkConnected ? 0 : 5);
  const syncedCount = station?.packets_delivered ?? sync?.synced_events ?? 12;

  const rssi = station?.rssi ?? sync?.rssi ?? -85.0;
  const snr = station?.snr ?? sync?.snr ?? 10.5;
  const sf = station?.sf ?? sync?.sf ?? 7;
  const pdr = station ? Math.round(station.pdr * 100) : 100;
  const packetAgeSec = station?.last_packet_age_ms != null ? (station.last_packet_age_ms / 1000).toFixed(1) : '--';
  const dutyCyclePct = station ? Math.round(station.duty_cycle_use * 100) : 0;
  const pktsDelivered = station?.packets_delivered ?? 0;
  const pktsLost = station?.packets_lost ?? 0;
  const isObstructed = station?.is_obstructed ?? false;
  const obstructionLoss = station?.obstruction_loss_db ?? 0.0;
  const scaledDist = station?.scaled_distance_m != null ? `${station.scaled_distance_m.toFixed(0)}m` : '320m';

  const [toggling, setToggling] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'auto' | 'force_lora' | 'force_offline'>('auto');

  const handleSetLinkMode = (mode: 'auto' | 'force_lora' | 'force_offline') => {
    setSelectedMode(mode);
    onSendCommand?.('set_link_mode', { mode });
  };

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
    <section className="panel dashboard__connectivity" aria-label="Ground Station and LoRa Link">
      <div className="panel__head">
        <span className="panel__title">
          <span
            className={`pulse-dot ${linkConnected ? '' : isLora ? 'warn' : 'offline'}`}
            style={{
              position: 'static',
              backgroundColor: isLora ? '#f59e0b' : undefined,
              boxShadow: isLora ? '0 0 8px #f59e0b' : undefined,
            }}
          />
          Ground Station / LoRa Link
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              fontFamily: 'monospace',
            }}
            title="World scale 40x applied to radio distances"
          >
            radio-scaled
          </span>
          <span
            className={`status-badge status-badge--${
              linkConnected ? 'connected' : isLora ? 'warning' : 'offline'
            }`}
            style={{
              backgroundColor: isLora ? '#d97706' : undefined,
              color: isLora ? '#ffffff' : undefined,
            }}
          >
            {stateStr}
          </span>
        </div>
      </div>

      <div className="panel__body panel__body--padded">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Link Status & Mode */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Link Mode:</strong></span>
            <span
              className="mono"
              style={{
                color: linkConnected ? '#22c55e' : isLora ? '#f59e0b' : '#ef4444',
                fontWeight: 600,
              }}
            >
              {linkConnected
                ? 'NETWORK (30 Hz TCP/WS)'
                : isLora
                ? 'LORA_ONLY (Ground Station)'
                : 'OFFLINE (Outbox Buffered)'}
            </span>
          </div>

          {/* Radio Metrics Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '6px',
              background: 'rgba(15, 23, 42, 0.5)',
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              fontSize: '11px',
            }}
          >
            <div>
              <span style={{ color: '#94a3b8' }}>RSSI / SNR:</span>{' '}
              <span className="mono" style={{ color: '#f8fafc' }}>
                {rssi.toFixed(1)} dBm / {snr > 0 ? `+${snr.toFixed(1)}` : snr.toFixed(1)} dB
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Adaptive SF:</span>{' '}
              <span className="mono" style={{ color: '#38bdf8', fontWeight: 600 }}>
                SF{sf}
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>PDR:</span>{' '}
              <span className="mono" style={{ color: pdr >= 90 ? '#22c55e' : '#f59e0b' }}>
                {pdr}%
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Last Pkt Age:</span>{' '}
              <span className="mono" style={{ color: '#f8fafc' }}>
                {packetAgeSec}s
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Duty Cycle:</span>{' '}
              <span className="mono" style={{ color: dutyCyclePct > 80 ? '#ef4444' : '#22c55e' }}>
                {dutyCyclePct}% of 1%
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Delivered / Lost:</span>{' '}
              <span className="mono" style={{ color: '#f8fafc' }}>
                {pktsDelivered} / {pktsLost}
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Radio Dist:</span>{' '}
              <span className="mono" style={{ color: '#f8fafc' }}>
                {scaledDist}
              </span>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>LOS Obstruction:</span>{' '}
              <span
                className="mono"
                style={{ color: isObstructed ? '#f59e0b' : '#22c55e' }}
              >
                {isObstructed ? `BLOCK (+${obstructionLoss.toFixed(0)}dB)` : 'CLEAR'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Buffered Queue / Outbox:</strong></span>
            <span className={`mono count-tag ${queuedCount > 0 ? 'count-tag--active' : ''}`}>
              {queuedCount} queued
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Total Synced to Base:</strong></span>
            <span className="mono">{syncedCount} events</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>Last Base Contact:</strong></span>
            <span className="mono">
              {model.lastMessageAt ? formatClock(model.lastMessageAt) : '--:--:--'}
            </span>
          </div>

          {/* Manual Link Mode Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}><strong>Link Mode Override:</strong></span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['auto', 'force_lora', 'force_offline'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSetLinkMode(m)}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                    background: selectedMode === m ? '#0284c7' : 'rgba(30, 41, 59, 0.6)',
                    color: selectedMode === m ? '#ffffff' : '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  {m === 'auto' ? 'Auto' : m === 'force_lora' ? 'Force LoRa' : 'Offline'}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Toggle Button */}
          <div style={{ paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              className={`btn-link-toggle ${linkConnected ? 'btn-link-toggle--cut' : 'btn-link-toggle--restore'}`}
              disabled={toggling}
              onClick={handleToggleLink}
              style={{ width: '100%', padding: '6px', cursor: 'pointer', fontSize: '11px' }}
            >
              {linkConnected ? '⚡ Simulate Network Cut (Switch to LoRa)' : '🔄 Restore Network & Flush Outbox'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
