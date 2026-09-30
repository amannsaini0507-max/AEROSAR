import { useEffect, useRef, useState } from 'react';
import type { MissionModel } from '../types';
import { formatClock } from '../lib/time';

type Channel = 'rgb' | 'thermal';

/**
 * Live drone feed with RGB / thermal toggle.
 * Uses 100% Canvas rendering (Zero SVG compliance).
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
            <SimulatedCanvasScene channel={channel} heading={pose?.heading ?? 0} />
          ) : (
            <div className="video-frame__placeholder">
              <CameraPlaceholderCanvas channel={channel} />
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

function CameraPlaceholderCanvas({ channel }: { channel: Channel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 30, 30);
    ctx.strokeStyle = '#8a8f98';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(3, 8, 20, 14);
    ctx.beginPath();
    ctx.arc(13, 15, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeRect(8, 5, 6, 3);
  }, [channel]);

  return <canvas ref={canvasRef} width={30} height={30} aria-hidden="true" />;
}

function SimulatedCanvasScene({ channel, heading }: { channel: Channel; heading: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const thermal = channel === 'thermal';
    const drift = ((heading % 90) / 90) * 20;

    // Background
    ctx.fillStyle = thermal ? '#1a1033' : '#6f7f5e';
    ctx.fillRect(0, 0, 320, 180);

    ctx.save();
    ctx.translate(-drift, 0);

    // Hazard & Obstacle Blocks
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = thermal ? '#2c1f55' : '#8d8a7c';
      ctx.fillRect(20 + i * 70, 30 + (i % 2) * 60, 44, 34);
    }

    // Survivor / Heat Source
    if (thermal) {
      const grad = ctx.createRadialGradient(210, 112, 0, 210, 112, 26);
      grad.addColorStop(0, '#fff6a8');
      grad.addColorStop(0.35, '#ffb13b');
      grad.addColorStop(0.7, '#e5484d');
      grad.addColorStop(1, 'rgba(229, 72, 77, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(210, 112, 26, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#d9a25b';
      ctx.beginPath();
      ctx.arc(210, 112, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b4a6b';
      ctx.fillRect(203, 120, 14, 6);
    }

    // Detection box
    ctx.strokeStyle = thermal ? '#ffffff' : '#f07b1f';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(190, 90, 42, 46);

    ctx.restore();
  }, [channel, heading]);

  return <canvas ref={canvasRef} width={320} height={180} className="video-frame__sim" aria-hidden="true" />;
}
