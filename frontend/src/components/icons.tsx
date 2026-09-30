import { useEffect, useRef } from 'react';

/**
 * Procedural Canvas Sprite Icon Renderer (Zero SVG Compliance per Hard Rule 5).
 * All icons render purely onto HTML5 2D Canvas contexts.
 */

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

function useCanvasDrawer(
  draw: (ctx: CanvasRenderingContext2D, size: number, color: string) => void,
  size: number,
  color: string
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    draw(ctx, size, color);
    ctx.restore();
  }, [draw, size, color]);

  return canvasRef;
}

export function SparkleIcon({ size = 18, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.fillStyle = col;
    const mid = s / 2;
    ctx.beginPath();
    ctx.moveTo(mid, 2);
    ctx.quadraticCurveTo(mid, mid, s - 2, mid);
    ctx.quadraticCurveTo(mid, mid, mid, s - 2);
    ctx.quadraticCurveTo(mid, mid, 2, mid);
    ctx.quadraticCurveTo(mid, mid, mid, 2);
    ctx.fill();
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function PulseIcon({ size = 15, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(2, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.5);
    ctx.lineTo(s * 0.45, s * 0.15);
    ctx.lineTo(s * 0.6, s * 0.85);
    ctx.lineTo(s * 0.75, s * 0.5);
    ctx.lineTo(s - 2, s * 0.5);
    ctx.stroke();
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function SlidersIcon({ size = 15, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';

    // 3 slider lines
    [s * 0.25, s * 0.5, s * 0.75].forEach((y, i) => {
      ctx.beginPath();
      ctx.moveTo(3, y);
      ctx.lineTo(s - 3, y);
      ctx.stroke();

      const cx = i === 1 ? s * 0.65 : s * 0.35;
      ctx.beginPath();
      ctx.arc(cx, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function ClockIcon({ size = 15, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    const mid = s / 2;
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.lineTo(mid, mid * 0.5);
    ctx.moveTo(mid, mid);
    ctx.lineTo(mid * 1.4, mid * 1.2);
    ctx.stroke();
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function GlobeIcon({ size = 15, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    const mid = s / 2;
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(2, mid);
    ctx.lineTo(s - 2, mid);
    ctx.moveTo(mid, 2);
    ctx.lineTo(mid, s - 2);
    ctx.stroke();
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function HamburgerIcon({ size = 18, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    [s * 0.25, s * 0.5, s * 0.75].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(3, y);
      ctx.lineTo(s - 3, y);
      ctx.stroke();
    });
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function SunIcon({ size = 17, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    const mid = s / 2;
    ctx.beginPath();
    ctx.arc(mid, mid, 3.5, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const x1 = mid + Math.cos(angle) * 5.5;
      const y1 = mid + Math.sin(angle) * 5.5;
      const x2 = mid + Math.cos(angle) * 7.5;
      const y2 = mid + Math.sin(angle) * 7.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function MoonIcon({ size = 16, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.38, -Math.PI * 0.3, Math.PI * 0.8, false);
    ctx.quadraticCurveTo(s * 0.45, s * 0.5, s * 0.5 + Math.cos(-Math.PI * 0.3) * s * 0.38, s * 0.5 + Math.sin(-Math.PI * 0.3) * s * 0.38);
    ctx.stroke();
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function BatteryIcon({ level, size = 14, color = 'currentColor' }: { level: number } & IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.4;

    const w = s * 0.8;
    const h = s * 0.55;
    const x = 1;
    const y = (s - h) / 2;

    ctx.strokeRect(x, y, w, h);
    ctx.fillRect(x + w, y + h * 0.25, 2, h * 0.5);

    const fillW = Math.max(1, ((w - 3) * Math.min(100, Math.max(0, level))) / 100);
    ctx.fillRect(x + 1.5, y + 1.5, fillW, h - 3);
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function SignalIcon({ size = 14, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.fillStyle = col;
    const barW = 2;
    const heights = [s * 0.25, s * 0.5, s * 0.75, s * 0.95];
    heights.forEach((bh, i) => {
      const bx = 2 + i * (barW + 1.5);
      ctx.fillRect(bx, s - bh, barW, bh);
    });
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function GpsIcon({ size = 14, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    const mid = s / 2;
    ctx.beginPath();
    ctx.arc(mid, mid, 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mid, 1);
    ctx.lineTo(mid, 3.5);
    ctx.moveTo(mid, s - 1);
    ctx.lineTo(mid, s - 3.5);
    ctx.moveTo(1, mid);
    ctx.lineTo(3.5, mid);
    ctx.moveTo(s - 1, mid);
    ctx.lineTo(s - 3.5, mid);
    ctx.stroke();
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function CheckIcon({ size = 13, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(2, s * 0.5);
    ctx.lineTo(s * 0.4, s * 0.85);
    ctx.lineTo(s - 2, s * 0.2);
    ctx.stroke();
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}

export function WarningIcon({ size = 12, color = 'currentColor' }: IconProps) {
  const draw = (ctx: CanvasRenderingContext2D, s: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    const mid = s / 2;
    ctx.beginPath();
    ctx.moveTo(mid, 1.5);
    ctx.lineTo(s - 1.5, s - 2);
    ctx.lineTo(1.5, s - 2);
    ctx.closePath();
    ctx.stroke();

    ctx.fillRect(mid - 0.75, s * 0.4, 1.5, s * 0.25);
    ctx.fillRect(mid - 0.75, s * 0.75, 1.5, 1.5);
  };
  const ref = useCanvasDrawer(draw, size, color);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />;
}
