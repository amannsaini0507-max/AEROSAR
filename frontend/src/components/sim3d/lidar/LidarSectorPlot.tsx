/**
 * 2D Canvas Tactical LiDAR Sector Range Plot (Zero SVG).
 * Displays real-time 8-sector obstacle proximity around the UAV.
 */

import { useEffect, useRef } from 'react';

interface Props {
  ranges: [number, number, number, number, number, number, number, number];
  maxPlotRangeM?: number;
  dangerThresholdM?: number;
}

const SECTOR_LABELS = ['FWD', 'FR', 'RGT', 'RR', 'AFT', 'RL', 'LFT', 'FL'];

export default function LidarSectorPlot({
  ranges,
  maxPlotRangeM = 15.0,
  dangerThresholdM = 2.0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) - 16;

    // Clear background
    ctx.fillStyle = 'rgba(7, 10, 16, 0.85)';
    ctx.fillRect(0, 0, w, h);

    // Range rings
    ctx.lineWidth = 1;
    const rings = [0.25, 0.5, 0.75, 1.0];
    for (const frac of rings) {
      const r = maxR * frac;
      ctx.strokeStyle = frac === 1.0 ? 'rgba(74, 222, 128, 0.3)' : 'rgba(148, 163, 184, 0.15)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Danger ring (2.0m)
    const dangerR = (dangerThresholdM / maxPlotRangeM) * maxR;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, dangerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 8 radial sector division lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    for (let i = 0; i < 8; i++) {
      const angle = (i * 45 - 90) * (Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
      ctx.stroke();
    }

    // Draw obstacle proximity wedges for each sector
    for (let i = 0; i < 8; i++) {
      const dist = ranges[i];
      const clampedDist = Math.max(0.5, Math.min(maxPlotRangeM, dist));
      const r = (clampedDist / maxPlotRangeM) * maxR;

      // Sector i angle span: (i*45 - 22.5 - 90) to (i*45 + 22.5 - 90) deg
      const startAngle = ((i * 45 - 22.5 - 90) * Math.PI) / 180.0;
      const endAngle = ((i * 45 + 22.5 - 90) * Math.PI) / 180.0;

      const isDanger = dist <= dangerThresholdM;
      const isWarn = dist <= dangerThresholdM * 2.0;

      ctx.fillStyle = isDanger
        ? 'rgba(239, 68, 68, 0.45)'
        : isWarn
        ? 'rgba(245, 158, 11, 0.35)'
        : 'rgba(34, 197, 94, 0.25)';

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isDanger ? '#ef4444' : isWarn ? '#f59e0b' : '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.stroke();
    }

    // Center drone icon (chevron)
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.closePath();
    ctx.fill();

    // Labels
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(203, 213, 225, 0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      const angle = (i * 45 - 90) * (Math.PI / 180);
      const lx = cx + Math.cos(angle) * (maxR + 10);
      const ly = cy + Math.sin(angle) * (maxR + 10);
      ctx.fillText(SECTOR_LABELS[i], lx, ly);
    }

    // Min range readout
    const minVal = Math.min(...ranges);
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = minVal <= dangerThresholdM ? '#ef4444' : '#38bdf8';
    ctx.fillText(`${minVal.toFixed(1)}m`, cx, cy + maxR - 4);
  }, [ranges, maxPlotRangeM, dangerThresholdM]);

  return (
    <div
      style={{
        background: 'rgba(10, 15, 24, 0.85)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        borderRadius: '6px',
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: '#94a3b8',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        LiDAR Obstacle Radar
      </div>
      <canvas
        ref={canvasRef}
        width={130}
        height={130}
        style={{ width: '130px', height: '130px', display: 'block' }}
      />
    </div>
  );
}
