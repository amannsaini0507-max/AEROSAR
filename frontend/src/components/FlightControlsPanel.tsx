import { useState } from 'react';
import type { MissionModel } from '../types';

interface Props {
  model: MissionModel;
  onSendCommand?: (action: string, params?: Record<string, unknown>) => void;
}

/**
 * Panel 8: Flight Controls & Mission Executive
 * Start, Pause, Resume, RTL, Emergency Land, and Manual Flight Controls.
 */
export default function FlightControlsPanel({ model, onSendCommand }: Props) {
  const [manual, setManual] = useState(false);
  const state = model.mission?.state ?? 'IDLE';

  const send = (action: string, params?: Record<string, unknown>) => {
    onSendCommand?.(action, params);
  };

  return (
    <section className="panel dashboard__flight-controls" aria-label="Flight Controls">
      <div className="panel__head">
        <span className="panel__title">Flight Controls & Modes</span>
        <span className="panel__count mono">State: {state}</span>
      </div>
      <div className="panel__body panel__body--padded">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          <button
            type="button"
            className="btn-action btn-action--start"
            onClick={() => send('start')}
          >
            ▶ Start Autonomous Search
          </button>
          <button
            type="button"
            className="btn-action"
            onClick={() => send('pause')}
          >
            ⏸ Pause Flight
          </button>
          <button
            type="button"
            className="btn-action"
            onClick={() => send('resume')}
          >
            ⏯ Resume Search
          </button>
          <button
            type="button"
            className="btn-action btn-action--rtl"
            onClick={() => send('rtl')}
          >
            🏠 Return To Launch (RTL)
          </button>
        </div>

        <div style={{ marginTop: '12px' }}>
          <button
            type="button"
            className="btn-action btn-action--emergency"
            onClick={() => send('emergency_land')}
            style={{ width: '100%', fontWeight: 'bold' }}
          >
            ⚠ EMERGENCY LAND (Failsafe)
          </button>
        </div>

        <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span><strong>Manual Controller Override:</strong></span>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox"
                checked={manual}
                onChange={(e) => setManual(e.target.checked)}
              />
              Enable Keyboard (WASD)
            </label>
          </div>

          {manual && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', maxWidth: '240px', margin: '0 auto' }}>
              <div />
              <button
                type="button"
                className="btn-manual"
                onClick={() => send('manual_input', { vx: 0, vy: 1.5, vz: 0, yaw_rate: 0 })}
              >
                ▲
              </button>
              <div />
              <button
                type="button"
                className="btn-manual"
                onClick={() => send('manual_input', { vx: -1.5, vy: 0, vz: 0, yaw_rate: 0 })}
              >
                ◀
              </button>
              <button
                type="button"
                className="btn-manual"
                onClick={() => send('manual_input', { vx: 0, vy: -1.5, vz: 0, yaw_rate: 0 })}
              >
                ▼
              </button>
              <button
                type="button"
                className="btn-manual"
                onClick={() => send('manual_input', { vx: 1.5, vy: 0, vz: 0, yaw_rate: 0 })}
              >
                ▶
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
