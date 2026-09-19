import { useState } from 'react';
import type { MissionModel } from '../types';
import { formatClock } from '../lib/time';

type Channel = 'rgb' | 'thermal';

/**
 * Live drone feed with RGB / thermal toggle (§14.2, demo beat 2:00–2:45).
 * Source priority per channel: pushed JPEG frame → stream URL (MJPEG/HTTP) →
 * simulator illustration (simulator only) → "no signal".
 */
export default function VideoFeed({ model, linkOffline = false }: { model: MissionModel; linkOffline?: boolean }) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const { video, pose, mission } = model;

  const src =
    channel === 'rgb' ? video.rgbFrame ?? video.rgbUrl : video.thermalFrame ?? video.thermalUrl;
  const flying = mission?.state === 'SEARCHING' || mission?.state === 'RETURNING';
  const showSim = !src && model.source === 'simulator' && flying;
  const live = Boolean(src) || showSim;

  return (
    <section className="panel dashboard__video" aria-label="Live drone feed">
      <div className="panel__head">
        <span className="panel__title">
          <span className={`pulse-dot ${live ? '' : 'offline'}`} style={{ position: 'static' }} />
          Live drone feed
        </span>
        <div className="segmented" role="tablist" aria-label="Camera channel">
          {(['rgb', 'thermal'] as Channel[]).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              className={'segmented__btn' + (channel === c ? ' is-active' : '')}
              onClick={() => setChannel(c)}
            >
              {c === 'rgb' ? 'RGB' : 'Thermal'}
            </button>
          ))}
        </div>
      </div>
      <div className="panel__body">
        <div className={`video-frame video-frame--${channel}`}>
          {src ? (
            <img className="video-frame__img" src={src} alt={`${channel === 'rgb' ? 'RGB' : 'Thermal'} camera feed`} />
          ) : showSim ? (
            <SimulatedScene channel={channel} heading={pose?.heading ?? 0} />
          ) : (
            <div className="video-frame__placeholder">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M2 3l19 19M17 10.5l4-3v9l-4-3M14 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>No {channel === 'rgb' ? 'RGB' : 'thermal'} stream yet</span>
            </div>
          )}

          <div className="video-frame__hud">
            <span className="hud-corner tl" />
            <span className="hud-corner tr" />
            <span className="hud-corner bl" />
            <span className="hud-corner br" />
            <div className="hud-readout top-left">
              ALT {pose?.altitude != null ? pose.altitude.toFixed(1) : '—'} m
              <br />
              SPD {pose?.speed != null ? pose.speed.toFixed(1) : '—'} m/s
            </div>
            <div className="hud-readout top-right">
              {channel === 'thermal' ? 'THERMAL' : 'RGB'}
              <br />
              HDG {pose?.heading != null ? Math.round(pose.heading).toString().padStart(3, '0') : '—'}°
            </div>
            <div className="hud-readout bottom-left">
              {pose ? `${pose.lat.toFixed(5)}, ${pose.lng.toFixed(5)}` : 'No position'}
              {mission?.navMode === 'GPS_DENIED' && <span className="hud-warn"> GPS LOST</span>}
            </div>
            <div className="hud-readout bottom-right">{pose ? formatClock(pose.time) : '--:--:--'}</div>
          </div>
          {showSim && <div className="video-frame__sim-tag">Simulated view</div>}
          {linkOffline && live && <div className="video-paused">Feed paused — drone link lost. Last frame shown.</div>}
        </div>
      </div>
    </section>
  );
}

/** Lightweight illustrative scene so the RGB/thermal toggle can be rehearsed without a stream. */
function SimulatedScene({ channel, heading }: { channel: Channel; heading: number }) {
  const thermal = channel === 'thermal';
  const drift = (heading % 90) / 90;
  return (
    <svg className="video-frame__sim" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="heat" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6a8" />
          <stop offset="35%" stopColor="#ffb13b" />
          <stop offset="70%" stopColor="#e5484d" />
          <stop offset="100%" stopColor="#e5484d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill={thermal ? '#1a1033' : '#6f7f5e'} />
      <g transform={`translate(${-20 * drift} 0)`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={20 + i * 70}
            y={30 + (i % 2) * 60}
            width="44"
            height="34"
            fill={thermal ? '#2c1f55' : '#8d8a7c'}
            opacity="0.9"
          />
        ))}
        <circle cx="210" cy="112" r={thermal ? 26 : 9} fill={thermal ? 'url(#heat)' : '#d9a25b'} />
        {!thermal && <rect x="203" y="120" width="14" height="6" fill="#3b4a6b" />}
        <rect x="190" y="90" width="42" height="46" fill="none" stroke={thermal ? '#ffffff' : '#f07b1f'} strokeWidth="1.5" strokeDasharray="4 3" />
      </g>
    </svg>
  );
}
