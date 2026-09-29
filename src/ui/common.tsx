// Small shared UI pieces.
import { useEffect, useRef } from 'react';
import { CONFIG } from '../sim/config';
import { buildTrack } from '../sim/track';
import type { Compound } from '../sim/types';
import { wearColor } from '../sim/tyres';

export function TyreBadge({ c, size = 22 }: { c: Compound; size?: number }) {
  const cfg = CONFIG.tyres.compounds[c];
  return (
    <span className="tyre" style={{ width: size, height: size, borderColor: cfg.color, color: cfg.color, fontSize: size * 0.5 }} title={cfg.name}>
      {c}
    </span>
  );
}

export function WearBar({ wear, compound }: { wear: number; compound: Compound }) {
  const cliff = CONFIG.tyres.compounds[compound].cliff;
  return (
    <div className="wearbar" title={`Cliff at ${cliff}%`}>
      <div className="wearfill" style={{ width: `${Math.min(100, wear)}%`, background: wearColor(wear, cliff) }} />
      <div className="wearcliff" style={{ left: `${cliff}%` }} />
    </div>
  );
}

export function TeamDot({ color }: { color: string }) {
  return <span className="teamdot" style={{ background: color }} />;
}

const trackCache = new Map<string, ReturnType<typeof buildTrack>>();
export function getTrack(id: string) {
  if (!trackCache.has(id)) trackCache.set(id, buildTrack(id));
  return trackCache.get(id)!;
}

/** Small outline of a circuit. */
export function TrackThumb({ id, w = 160, h = 100 }: { id: string; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d')!;
    const t = getTrack(id);
    const b = t.bounds;
    const s = Math.min((w - 12) / (b.maxX - b.minX), (h - 12) / (b.maxY - b.minY));
    const ox = w / 2 - ((b.minX + b.maxX) / 2) * s, oy = h / 2 - ((b.minY + b.maxY) / 2) * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    for (let i = 0; i <= t.n; i += 4) {
      const k = i % t.n;
      const x = t.x[k] * s + ox, y = t.y[k] * s + oy;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#e8ecf2';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.arc(t.x[0] * s + ox, t.y[0] * s + oy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }, [id, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

export function fmtGap(s: number): string {
  if (!isFinite(s)) return '—';
  return `+${s.toFixed(1)}`;
}
