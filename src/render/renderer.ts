/**
 * Canvas renderer. Pure drawing: reads engine state, never mutates it.
 * The track is built once into Path2D objects in world space; each frame
 * we set a world→screen transform (fit-to-screen or follow-cam).
 */
import { CONFIG } from '../sim/config';
import type { Car, RaceEngine } from '../sim/race';
import type { Compound } from '../sim/types';
import { PIT_LANE_OFFSET, pitPosAt, posAt, type Track } from '../sim/track';

const TRACK_W = 22;

interface Cam {
  cx: number;
  cy: number;
  zoom: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private track: Track;
  private center: Path2D;
  private pitPath: Path2D;
  private kerbSegs: { path: Path2D; red: boolean }[] = [];
  private drsPaths: Path2D[] = [];
  private cam: Cam | null = null;
  private lastW = 0;
  private lastH = 0;
  private labels: { x: number; y: number; w: number }[] = [];
  private rainDrops: { x: number; y: number; l: number }[] = [];

  constructor(private canvas: HTMLCanvasElement, track: Track) {
    this.ctx = canvas.getContext('2d')!;
    this.track = track;
    const t = track;

    this.center = new Path2D();
    for (let i = 0; i <= t.n; i++) {
      const k = i % t.n;
      if (i === 0) this.center.moveTo(t.x[k], t.y[k]);
      else this.center.lineTo(t.x[k], t.y[k]);
    }

    this.pitPath = new Path2D();
    for (let i = 0; i <= 100; i++) {
      const p = pitPosAt(t, i / 100);
      if (i === 0) this.pitPath.moveTo(p.x, p.y);
      else this.pitPath.lineTo(p.x, p.y);
    }

    // Kerbs: short alternating red/white segments on the inside edge.
    const off = TRACK_W / 2 + 1.5;
    for (let i = 0; i < t.n; i += 3) {
      const side = t.kerb[i];
      if (!side) continue;
      const j = (i + 3) % t.n;
      const path = new Path2D();
      path.moveTo(t.x[i] + t.nx[i] * off * side, t.y[i] + t.ny[i] * off * side);
      path.lineTo(t.x[j] + t.nx[j] * off * side, t.y[j] + t.ny[j] * off * side);
      this.kerbSegs.push({ path, red: (i / 3) % 2 === 0 });
    }

    for (const z of t.drsZones) {
      const path = new Path2D();
      const len = z.end >= z.start ? z.end - z.start : 1 - z.start + z.end;
      for (let s = 0; s <= 60; s++) {
        const p = posAt(t, z.start + (len * s) / 60, -t.pitSide * (TRACK_W / 2 + 5));
        if (s === 0) path.moveTo(p.x, p.y);
        else path.lineTo(p.x, p.y);
      }
      this.drsPaths.push(path);
    }

    for (let i = 0; i < 140; i++) this.rainDrops.push({ x: Math.random(), y: Math.random(), l: 0.5 + Math.random() });
  }

  private targetCam(engine: RaceEngine, followId: string | null, w: number, h: number): Cam {
    const b = this.track.bounds;
    const pad = 40;
    const fit = Math.max(0.05, Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY)));
    const fitCam = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom: fit };
    if (!followId) return fitCam;
    const car = engine.cars.find((c) => c.id === followId);
    if (!car) return fitCam;
    const p = this.carPos(car);
    return { cx: p.x, cy: p.y, zoom: fit * 2.6 };
  }

  private carPos(car: Car) {
    if (car.pit) return pitPosAt(this.track, Math.min(1, car.pit.moved / car.pit.laneTime));
    return posAt(this.track, car.dist, car.lateral);
  }

  draw(engine: RaceEngine, opts: { followId: string | null; selectedId: string | null; dt: number }) {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    if (w < 20 || h < 20) return;
    const target = this.targetCam(engine, opts.followId, w, h);
    // Snap (no easing) on first frame and whenever the canvas is resized.
    if (!this.cam || w !== this.lastW || h !== this.lastH) this.cam = { ...target };
    this.lastW = w;
    this.lastH = h;
    const k = Math.min(1, opts.dt * 5);
    this.cam.cx += (target.cx - this.cam.cx) * k;
    this.cam.cy += (target.cy - this.cam.cy) * k;
    this.cam.zoom += (target.zoom - this.cam.zoom) * k;
    const cam = this.cam;
    const s = cam.zoom;
    const ox = w / 2 - cam.cx * s, oy = h / 2 - cam.cy * s;
    const toScreen = (x: number, y: number) => ({ x: x * s + ox, y: y * s + oy });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e4e9e2';
    ctx.fillRect(0, 0, w, h);
    // Subtle grid.
    ctx.strokeStyle = 'rgba(0,0,0,0.035)';
    ctx.lineWidth = 1;
    const grid = 50 * s;
    if (grid > 8) {
      ctx.beginPath();
      for (let x = ox % grid; x < w; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = oy % grid; y < h; y += grid) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    }

    // World-space track.
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d3dacf';
    ctx.lineWidth = TRACK_W + 26;
    ctx.stroke(this.center);
    // Pit lane.
    ctx.strokeStyle = '#9aa1aa';
    ctx.lineWidth = 12;
    ctx.stroke(this.pitPath);
    ctx.strokeStyle = '#b9bec5';
    ctx.lineWidth = 10;
    ctx.stroke(this.pitPath);
    // Track edges + tarmac.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = TRACK_W + 2.4;
    ctx.stroke(this.center);
    const wet = engine.weather.wetness;
    ctx.strokeStyle = wet > 0.05 ? mix('#646a73', '#4a5566', Math.min(1, wet * 1.4)) : '#646a73';
    ctx.lineWidth = TRACK_W;
    ctx.stroke(this.center);
    // Racing line hint.
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 6;
    ctx.stroke(this.center);
    // Kerbs.
    ctx.lineCap = 'butt';
    ctx.lineWidth = 3;
    for (const kseg of this.kerbSegs) {
      ctx.strokeStyle = kseg.red ? '#e23b3b' : '#f1f1f1';
      ctx.stroke(kseg.path);
    }
    // DRS zones.
    ctx.strokeStyle = engine.flag === 'green' ? 'rgba(12, 160, 90, 0.7)' : 'rgba(120,120,120,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    for (const p of this.drsPaths) ctx.stroke(p);
    ctx.setLineDash([]);
    ctx.lineCap = 'round';

    // Pit boxes.
    this.drawPitBoxes(engine);
    // Start/finish line.
    this.drawStartLine();

    // Screen-space overlays.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 10px "Barlow Condensed", sans-serif';
    ctx.fillStyle = 'rgba(10,130,72,0.95)';
    for (const z of this.track.drsZones) {
      const p = posAt(this.track, z.start, -this.track.pitSide * (TRACK_W / 2 + 14));
      const sp = toScreen(p.x, p.y);
      ctx.fillText('DRS', sp.x - 8, sp.y + 3);
    }
    {
      const p = pitPosAt(this.track, 0.5);
      const sp = toScreen(p.x + this.track.nx[0] * this.track.pitSide * 18, p.y + this.track.ny[0] * this.track.pitSide * 18);
      ctx.fillStyle = 'rgba(30,36,46,0.55)';
      ctx.fillText('PIT', sp.x - 8, sp.y + 3);
    }

    // Cars (back to front so leaders are drawn on top).
    const cars = [...engine.cars].sort((a, b) => b.position - a.position);
    for (const car of cars) this.drawCar(car, s, toScreen, opts.selectedId === car.id);
    // Number labels: player cars first, then by position; skip rivals whose label would overlap.
    this.labels = [];
    const byPriority = [...engine.cars].sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer) || a.position - b.position);
    for (const car of byPriority) this.drawLabel(car, s, toScreen);

    // Safety car.
    if (engine.flag === 'sc') {
      const leader = engine.order.find((c) => c.status === 'running' && !c.pit);
      if (leader) {
        const p = posAt(this.track, leader.dist + 180 / this.track.lengthM, 0);
        const sp = toScreen(p.x, p.y);
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(p.h);
        ctx.fillStyle = '#ffcc00';
        roundRect(ctx, -7 * s, -3 * s, 14 * s, 6 * s, 2 * s);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ffcc00';
        ctx.font = '700 11px "Barlow Condensed", sans-serif';
        ctx.fillText('SC', sp.x + 8, sp.y - 8);
      }
    }

    // Rain.
    if (engine.weather.rain > 0.02) {
      const r = engine.weather.rain;
      ctx.fillStyle = `rgba(60, 100, 160, ${0.14 * r})`;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(50, 90, 150, ${0.25 + 0.3 * r})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const count = Math.floor(this.rainDrops.length * Math.min(1, r * 1.2));
      for (let i = 0; i < count; i++) {
        const d = this.rainDrops[i];
        d.y += opts.dt * (0.9 + d.l * 0.6);
        d.x += opts.dt * 0.15;
        if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
        if (d.x > 1) d.x -= 1;
        const x = d.x * w, y = d.y * h;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 3, y + 12 * d.l);
      }
      ctx.stroke();
    }

    // Start lights.
    if (engine.state === 'lights') this.drawLights(engine, w);
  }

  private drawCar(car: Car, s: number, toScreen: (x: number, y: number) => { x: number; y: number }, selected: boolean) {
    const ctx = this.ctx;
    const p = this.carPos(car);
    const sp = toScreen(p.x, p.y);
    const L = 13 * s, W = 6 * s;
    const minL = Math.max(L, 9), minW = Math.max(W, 4.2);
    const dnf = car.status === 'dnf';
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(p.h);
    ctx.globalAlpha = dnf ? 0.35 : 1;
    // Body.
    ctx.fillStyle = car.team.color;
    roundRect(ctx, -minL / 2, -minW / 2, minL, minW, minW * 0.35);
    ctx.fill();
    // Nose / front wing accent.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(minL / 2 - minL * 0.22, -minW / 2, minL * 0.22, minW);
    // Tyre compound dot (cockpit).
    ctx.fillStyle = compoundColor(car.compound);
    ctx.beginPath();
    ctx.arc(-minL * 0.08, 0, minW * 0.26, 0, Math.PI * 2);
    ctx.fill();
    if (car.isPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      roundRect(ctx, -minL / 2 - 1, -minW / 2 - 1, minL + 2, minW + 2, minW * 0.4);
      ctx.stroke();
    }
    if (car.drsOpen) {
      ctx.fillStyle = '#2ee68c';
      ctx.fillRect(-minL / 2 - 2.5, -minW / 2, 2, minW);
    }
    ctx.restore();

    if (selected) {
      ctx.strokeStyle = 'rgba(20,26,34,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(12, 10 * s) + Math.sin(performance.now() / 180) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

  }

  private drawLabel(car: Car, s: number, toScreen: (x: number, y: number) => { x: number; y: number }) {
    if (car.status === 'dnf') return;
    const ctx = this.ctx;
    const p = this.carPos(car);
    const sp = toScreen(p.x, p.y);
    const label = String(car.driver.number);
    ctx.font = car.isPlayer ? '800 12px "Barlow Condensed", sans-serif' : '700 10px "Barlow Condensed", sans-serif';
    const tw = ctx.measureText(label).width;
    const lx = sp.x - tw / 2, ly = sp.y - Math.max(9, 7 * s) - 3;
    if (!car.isPlayer && this.labels.some((l) => Math.abs(l.x - lx) < (l.w + tw) / 2 + 5 && Math.abs(l.y - ly) < 12)) return;
    this.labels.push({ x: lx, y: ly, w: tw });
    ctx.fillStyle = car.isPlayer ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.55)';
    roundRect(ctx, lx - 3, ly - 9, tw + 6, 12, 3);
    ctx.fill();
    ctx.fillStyle = car.isPlayer ? '#ffffff' : car.team.color;
    ctx.fillText(label, lx, ly);
  }

  private drawPitBoxes(engine: RaceEngine) {
    const ctx = this.ctx;
    const t = this.track;
    const teams = [...new Map(engine.cars.map((c) => [c.team.id, c.team])).values()];
    teams.forEach((team, i) => {
      const prog = 0.25 + (i / Math.max(1, teams.length - 1)) * 0.5;
      const p = pitPosAt(t, prog);
      const ix = Math.floor(((t.pitEntry + (1 - t.pitEntry + t.pitExit) * prog) % 1) * t.n) % t.n;
      const off = t.pitSide * 8;
      ctx.save();
      ctx.translate(p.x + t.nx[ix] * off, p.y + t.ny[ix] * off);
      ctx.rotate(t.heading[ix]);
      ctx.fillStyle = team.color;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(-5, -2, 10, 4);
      ctx.restore();
    });
    void PIT_LANE_OFFSET;
  }

  private drawStartLine() {
    const ctx = this.ctx;
    const t = this.track;
    const x = t.x[0], y = t.y[0], nx = t.nx[0], ny = t.ny[0];
    const h = t.heading[0];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(h);
    const sq = 2.2;
    const rows = Math.ceil(TRACK_W / sq);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111111';
        ctx.fillRect(c * sq - sq, -TRACK_W / 2 + r * sq, sq, sq);
      }
    }
    ctx.restore();
    void nx; void ny;
  }

  private drawLights(engine: RaceEngine, w: number) {
    const ctx = this.ctx;
    const total = 4;
    const elapsed = 4 - engine.lightsLeft;
    const lit = Math.min(5, Math.floor((elapsed / total) * 6));
    const bw = 5 * 34 + 20;
    const x0 = w / 2 - bw / 2, y0 = 24;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    roundRect(ctx, x0, y0, bw, 50, 10);
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(x0 + 27 + i * 34, y0 + 25, 11, 0, Math.PI * 2);
      ctx.fillStyle = i < lit ? '#ff2020' : '#2a1a1a';
      ctx.fill();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function compoundColor(c: Compound) {
  return CONFIG.tyres.compounds[c].color;
}

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, sh: number) => (p >> sh) & 255;
  const r = Math.round(ch(pa, 16) + (ch(pb, 16) - ch(pa, 16)) * t);
  const g = Math.round(ch(pa, 8) + (ch(pb, 8) - ch(pa, 8)) * t);
  const bl = Math.round(ch(pa, 0) + (ch(pb, 0) - ch(pa, 0)) * t);
  return `rgb(${r},${g},${bl})`;
}
