/**
 * Track geometry + derived data.
 *
 * Each circuit is a closed centripetal Catmull-Rom spline through the real
 * circuit outline (circuitShapes.ts), fitted into world space 1600×1000. The spline is resampled at uniform
 * arc length; curvature gives a physically-flavoured speed profile (corner
 * speed from lateral grip, then acceleration/braking passes). That profile is
 * only used as a *shape*: the lap time itself comes from the lap-time model,
 * and each car's progress rate is `shape(u) / lapTime`.
 *
 * Distances along the lap are expressed as a lap fraction u ∈ [0,1),
 * with u = 0 at the start/finish line.
 */
import { CIRCUIT_SHAPES } from './circuitShapes';
import { circuitCfg, type CircuitCfg } from './config';

interface TrackGeom {
  points: [number, number][];
  /** World position of the start/finish line. */
  start: [number, number];
  /** Pit entry/exit as lap fractions relative to the line (entry negative). */
  pitEntry: number;
  pitExit: number;
}

const WORLD_W = 1600, WORLD_H = 1000, WORLD_PAD = 60;

/**
 * Real circuit outline (metres, from circuitShapes.ts) → world space.
 * The outline is rotated to whichever angle fills a landscape screen best,
 * then scaled and centred in the 1600×1000 world.
 */
function geometryFor(cfg: CircuitCfg): TrackGeom {
  const raw = CIRCUIT_SHAPES[cfg.id];
  if (!raw) throw new Error(`No shape for circuit ${cfg.id}`);
  let best = { scale: 0, rot: 0 };
  for (let deg = 0; deg < 180; deg += 3) {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of raw) {
      const rx = x * c - y * s, ry = x * s + y * c;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
    const scale = Math.min((WORLD_W - 2 * WORLD_PAD) / (maxX - minX), (WORLD_H - 2 * WORLD_PAD) / (maxY - minY));
    // Prefer the natural (north-up) orientation unless rotating is clearly better.
    if (scale > best.scale * (deg === 0 ? 1 : 1.04)) best = { scale, rot: r };
  }
  const c = Math.cos(best.rot), s = Math.sin(best.rot);
  const rot = raw.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const xs = rot.map((p) => p[0]), ys = rot.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const points = rot.map(([x, y]) => [WORLD_W / 2 + (x - cx) * best.scale, WORLD_H / 2 + (y - cy) * best.scale] as [number, number]);
  return { points, start: points[0], pitEntry: cfg.pitEntry ?? -0.045, pitExit: cfg.pitExit ?? 0.04 };
}

export interface Zone {
  start: number;
  end: number;
}

export interface Track {
  cfg: CircuitCfg;
  n: number;
  x: Float32Array;
  y: Float32Array;
  /** Unit normal (left of travel direction). */
  nx: Float32Array;
  ny: Float32Array;
  heading: Float32Array;
  /** Signed curvature per metre. */
  curv: Float32Array;
  /** Natural speed profile, km/h. */
  speedKmh: Float32Array;
  /** Relative speed shape s(u); ∫du/s = 1 so a car's rate is s(u)/lapTime. */
  shape: Float32Array;
  /** Cumulative ∫du/s from the line up to sample i (0..1). */
  cumTime: Float32Array;
  lengthM: number;
  mPerPx: number;
  drsZones: Zone[];
  /** Straights where passing is possible (superset of DRS zones). */
  passZones: Zone[];
  /** Pit entry (lap fraction ~0.93) and exit (~0.05). */
  pitEntry: number;
  pitExit: number;
  /** +1/-1: which normal side the pit lane is on. */
  pitSide: number;
  /** Per-sample kerb marker: 0 none, ±1 kerb on that normal side. */
  kerb: Int8Array;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const N = 1600;
const PIT_OFFSET = 30; // world units

/** Centripetal Catmull-Rom point between p1 and p2. */
function catmull(p0: number[], p1: number[], p2: number[], p3: number[], t: number): [number, number] {
  const alpha = 0.5;
  const tj = (ti: number, a: number[], b: number[]) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha);
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a: number[], b: number[], ta: number, tb: number) => {
    const w = tb - ta === 0 ? 0 : (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  const c = lerp(b1, b2, t1, t2);
  return [c[0], c[1]];
}

function findZones(mask: (i: number) => boolean, n: number, minLen: number): Zone[] {
  // Rotate so we start in a "false" region to handle wrap-around.
  let offset = 0;
  while (offset < n && mask(offset)) offset++;
  const zones: Zone[] = [];
  let startIdx = -1;
  for (let k = 0; k <= n; k++) {
    const i = (offset + k) % n;
    const on = k < n && mask(i);
    if (on && startIdx < 0) startIdx = offset + k;
    if (!on && startIdx >= 0) {
      const endIdx = offset + k;
      if ((endIdx - startIdx) / n >= minLen) zones.push({ start: (startIdx % n) / n, end: (endIdx % n) / n });
      startIdx = -1;
    }
  }
  return zones;
}

export function zoneLength(z: Zone): number {
  return z.end >= z.start ? z.end - z.start : 1 - z.start + z.end;
}

export function inZone(z: Zone, u: number): boolean {
  return z.end >= z.start ? u >= z.start && u < z.end : u >= z.start || u < z.end;
}

/** Progress (0..1) through zone, or -1 when outside. */
export function zoneProgress(z: Zone, u: number): number {
  if (!inZone(z, u)) return -1;
  const d = u >= z.start ? u - z.start : 1 - z.start + u;
  return d / zoneLength(z);
}

export function buildTrack(circuitId: string): Track {
  const cfg = circuitCfg(circuitId);
  const geom = geometryFor(cfg);
  const P = geom.points;
  const m = P.length;

  // 1. Dense spline sampling.
  const dense: [number, number][] = [];
  const SUB = 60;
  for (let i = 0; i < m; i++) {
    const p0 = P[(i - 1 + m) % m], p1 = P[i], p2 = P[(i + 1) % m], p3 = P[(i + 2) % m];
    for (let s = 0; s < SUB; s++) dense.push(catmull(p0, p1, p2, p3, s / SUB));
  }
  const dl = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    dl.push(dl[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const totalPx = dl[dl.length - 1];

  // 2. Find start-line arc length (closest dense point to geom.start).
  let best = 0, bestD = Infinity;
  dense.forEach((p, i) => {
    const d = Math.hypot(p[0] - geom.start[0], p[1] - geom.start[1]);
    if (d < bestD) { bestD = d; best = i; }
  });
  const startS = dl[best];

  // 3. Uniform resample, starting at the line.
  const x = new Float32Array(N), y = new Float32Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    let s = startS + (i / N) * totalPx;
    if (s >= totalPx) s -= totalPx;
    if (j > 0 && dl[j] > s) j = 0;
    while (dl[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const w = (s - dl[j]) / Math.max(1e-6, dl[j + 1] - dl[j]);
    x[i] = a[0] + (b[0] - a[0]) * w;
    y[i] = a[1] + (b[1] - a[1]) * w;
  }

  const mPerPx = (cfg.lengthKm * 1000) / totalPx;
  const ds = (totalPx / N) * mPerPx; // metres per sample

  // 4. Heading, normals, curvature.
  const heading = new Float32Array(N), nx = new Float32Array(N), ny = new Float32Array(N), curv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const h = Math.atan2(y[b] - y[a], x[b] - x[a]);
    heading[i] = h;
    nx[i] = -Math.sin(h);
    ny[i] = Math.cos(h);
  }
  const W = 6;
  for (let i = 0; i < N; i++) {
    let dh = heading[(i + W) % N] - heading[(i - W + N) % N];
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    curv[i] = dh / (2 * W * ds);
  }

  // 5. Speed profile (m/s): lateral grip limit, then accel & braking passes.
  const VMAX = 345 / 3.6, A_LAT = 42, BRAKE = 38;
  const v = new Float32Array(N);
  for (let i = 0; i < N; i++) v[i] = Math.min(VMAX, Math.sqrt(A_LAT / Math.max(1e-5, Math.abs(curv[i]))));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k <= N; k++) {
      const i = k % N, p = k - 1;
      const acc = 13 * (1 - (0.75 * v[p]) / VMAX);
      v[i] = Math.min(v[i], Math.sqrt(v[p] * v[p] + 2 * acc * ds));
    }
    for (let k = N - 1; k >= 0; k--) {
      const i = k, nxt = (k + 1) % N;
      v[i] = Math.min(v[i], Math.sqrt(v[nxt] * v[nxt] + 2 * BRAKE * ds));
    }
  }
  let natural = 0;
  for (let i = 0; i < N; i++) natural += ds / v[i];
  const vMean = (cfg.lengthKm * 1000) / natural;
  const shape = new Float32Array(N), cumTime = new Float32Array(N + 1), speedKmh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    shape[i] = v[i] / vMean;
    speedKmh[i] = v[i] * 3.6;
    cumTime[i + 1] = cumTime[i] + 1 / N / shape[i];
  }
  // Normalise tiny rounding so cumTime[N] === 1.
  for (let i = 0; i <= N; i++) cumTime[i] /= cumTime[N];

  // 6. Zones.
  const fast = (thr: number) => (i: number) => v[i] > thr * VMAX;
  const passZones = findZones(fast(0.8), N, 0.03);
  const drsZones = [...findZones(fast(0.88), N, 0.05)]
    .sort((a, b) => zoneLength(b) - zoneLength(a))
    .slice(0, cfg.drsZones);
  if (drsZones.length === 0 && passZones.length) {
    drsZones.push([...passZones].sort((a, b) => zoneLength(b) - zoneLength(a))[0]);
  }

  // 7. Kerbs on the inside of tight corners.
  const kerb = new Int8Array(N);
  for (let i = 0; i < N; i++) if (Math.abs(curv[i]) > 1 / 140) kerb[i] = curv[i] > 0 ? 1 : -1;

  // 8. Pit lane side: towards the circuit's centroid at the line.
  let cx = 0, cy = 0;
  for (let i = 0; i < N; i++) { cx += x[i]; cy += y[i]; }
  cx /= N; cy /= N;
  const pitSide = (cx - x[0]) * nx[0] + (cy - y[0]) * ny[0] > 0 ? 1 : -1;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]);
  }

  return {
    cfg, n: N, x, y, nx, ny, heading, curv, speedKmh, shape, cumTime,
    lengthM: cfg.lengthKm * 1000, mPerPx, drsZones, passZones,
    pitEntry: 1 + geom.pitEntry, pitExit: geom.pitExit, pitSide, kerb,
    bounds: { minX, minY, maxX, maxY },
  };
}

/** Sample index for lap fraction u. */
export function idx(track: Track, u: number): number {
  const f = u - Math.floor(u);
  return Math.min(track.n - 1, Math.floor(f * track.n));
}

/** Fraction of a lap's time spent between lap fractions a → b (going forward, may wrap). */
export function timeFraction(track: Track, a: number, b: number): number {
  const at = (u: number) => {
    const f = u - Math.floor(u);
    const i = Math.min(track.n - 1, Math.floor(f * track.n));
    const w = f * track.n - i;
    return track.cumTime[i] + (track.cumTime[i + 1] - track.cumTime[i]) * w;
  };
  const whole = Math.floor(b - a);
  let t = at(b) - at(a);
  if (t < 0) t += 1;
  return whole + t;
}

/** World position (and heading) at lap fraction u with lateral offset (world units). */
export function posAt(track: Track, u: number, lateral = 0): { x: number; y: number; h: number } {
  const f = (u - Math.floor(u)) * track.n;
  const i = Math.floor(f) % track.n, k = (i + 1) % track.n, w = f - Math.floor(f);
  const x = track.x[i] + (track.x[k] - track.x[i]) * w;
  const y = track.y[i] + (track.y[k] - track.y[i]) * w;
  return { x: x + track.nx[i] * lateral, y: y + track.ny[i] * lateral, h: track.heading[i] };
}

/** Pit lane position for progress p ∈ [0,1] from entry to exit. */
export function pitPosAt(track: Track, p: number): { x: number; y: number; h: number } {
  const span = 1 - track.pitEntry + track.pitExit;
  const u = track.pitEntry + span * p;
  const ramp = (t: number) => t * t * (3 - 2 * t);
  const edge = 0.14;
  const o = p < edge ? ramp(p / edge) : p > 1 - edge ? ramp((1 - p) / edge) : 1;
  return posAt(track, u, track.pitSide * PIT_OFFSET * o);
}

export const PIT_LANE_OFFSET = PIT_OFFSET;
