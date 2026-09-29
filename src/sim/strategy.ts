/**
 * Strategy optimizer.
 *
 * Estimates the total tyre-related race time of a plan (compound pace + wear
 * degradation + cliff + pit losses) in a dry race, ignoring traffic. Used by:
 *   - the pre-race screen (suggested 1-stop / 2-stop plans + custom estimate)
 *   - the AI (picks among its N best plans depending on difficulty)
 *   - AI re-planning after an unplanned stop (SC, weather)
 */
import { CONFIG, type CircuitCfg } from './config';
import { degPenalty, compoundPace, wearPerLap } from './tyres';
import { DRY_COMPOUNDS, type Compound, type Strategy } from './types';

export interface PlanEval {
  strategy: Strategy;
  time: number;
  stops: number;
  label: string;
}

export interface OptimizerCtx {
  circuit: CircuitCfg;
  laps: number;
  trackTemp: number;
}

export function raceScale(laps: number) {
  return CONFIG.race.REFERENCE_LAPS / laps;
}

export function pitCost(circuit: CircuitCfg): number {
  return circuit.pitLaneLoss + CONFIG.pit.stopMean + CONFIG.tyres.outLapPenalty;
}

const stintCache = new Map<string, Float64Array>();

/** Time cost of running `n` laps on a compound starting at `startWear`. Also returns end wear. */
export function stintCost(ctx: OptimizerCtx, c: Compound, n: number, startWear = 0): { time: number; wear: number } {
  const temp = Math.round(ctx.trackTemp);
  const w = wearPerLap({
    compound: c, trackWearMult: ctx.circuit.wearMult, trackTemp: temp,
    paceMode: 'balanced', dirtyAir: false, wetness: 0, raceScale: raceScale(ctx.laps),
  });
  const lapCost = (wear: number) => {
    const d = degPenalty(c, wear + w / 2);
    return compoundPace(c) + d.linear + d.cliff;
  };
  if (startWear === 0) {
    // Fresh tyres: cumulative cost table, cached per circuit/length/temp/compound.
    const key = `${ctx.circuit.id}|${ctx.laps}|${temp}|${c}`;
    let cum = stintCache.get(key);
    if (!cum) {
      cum = new Float64Array(ctx.laps + 2);
      for (let i = 0; i <= ctx.laps; i++) cum[i + 1] = cum[i] + lapCost(i * w);
      stintCache.set(key, cum);
    }
    const k = Math.max(0, Math.min(n, ctx.laps + 1));
    return { time: cum[k], wear: n * w };
  }
  let wear = startWear, t = 0;
  for (let i = 0; i < n; i++) { t += lapCost(wear); wear += w; }
  return { time: t, wear };
}

export function evaluate(ctx: OptimizerCtx, s: Strategy, fromLap = 0, startWear = 0): number {
  let t = 0, cur = s.startCompound, lap = fromLap, wear = startWear;
  const stops = s.stops.filter((x) => x.lap > fromLap).sort((a, b) => a.lap - b.lap);
  for (const st of stops) {
    const r = stintCost(ctx, cur, st.lap - lap, wear);
    t += r.time + pitCost(ctx.circuit);
    cur = st.compound; lap = st.lap; wear = 0;
  }
  t += stintCost(ctx, cur, ctx.laps - lap, wear).time;
  return t;
}

export function describe(s: Strategy): string {
  return [s.startCompound, ...s.stops.map((x) => `${x.compound}(L${x.lap})`)].join(' → ');
}

/**
 * Enumerate 0/1/2-stop dry plans from `fromLap` with the car currently on
 * `current` at `startWear`. `needSecond` enforces the two-compound rule.
 */
export function enumeratePlans(
  ctx: OptimizerCtx,
  opts: { fromLap?: number; current?: Compound; startWear?: number; needSecond?: boolean; startOptions?: Compound[] } = {},
): PlanEval[] {
  const from = opts.fromLap ?? 0;
  const startWear = opts.startWear ?? 0;
  const remaining = ctx.laps - from;
  const starts = opts.current ? [opts.current] : opts.startOptions ?? DRY_COMPOUNDS;
  const out: PlanEval[] = [];
  const minStint = Math.max(2, Math.round(ctx.laps * 0.12));
  const lastPit = ctx.laps - Math.max(2, Math.round(ctx.laps * 0.08));

  for (const c0 of starts) {
    const needSecond = opts.needSecond ?? true;
    // 0 stops
    if (!needSecond || !DRY_COMPOUNDS.includes(c0)) {
      const s: Strategy = { startCompound: c0, stops: [] };
      out.push({ strategy: s, time: evaluate(ctx, s, from, startWear), stops: 0, label: 'No stop' });
    }
    // 1 stop
    for (let p = from + (opts.current ? 1 : minStint); p <= Math.min(lastPit, ctx.laps - minStint); p++) {
      for (const c1 of DRY_COMPOUNDS) {
        if (needSecond && c1 === c0) continue;
        const s: Strategy = { startCompound: c0, stops: [{ lap: p, compound: c1 }] };
        out.push({ strategy: s, time: evaluate(ctx, s, from, startWear), stops: 1, label: '1-stop' });
      }
    }
    // 2 stops
    if (remaining >= minStint * 3) {
      for (let p1 = from + (opts.current ? 1 : minStint); p1 <= lastPit - minStint; p1++) {
        for (let p2 = p1 + minStint; p2 <= Math.min(lastPit, ctx.laps - minStint); p2++) {
          for (const c1 of DRY_COMPOUNDS) {
            for (const c2 of DRY_COMPOUNDS) {
              if (needSecond && c0 === c1 && c1 === c2) continue;
              const s: Strategy = { startCompound: c0, stops: [{ lap: p1, compound: c1 }, { lap: p2, compound: c2 }] };
              out.push({ strategy: s, time: evaluate(ctx, s, from, startWear), stops: 2, label: '2-stop' });
            }
          }
        }
      }
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Best plan for each stop count (for the pre-race screen). */
export function suggestedPlans(ctx: OptimizerCtx, startCompound?: Compound): { oneStop: PlanEval; twoStop: PlanEval } {
  const all = enumeratePlans(ctx, startCompound ? { startOptions: [startCompound] } : {});
  const oneStop = all.find((p) => p.stops === 1) ?? all[0];
  const twoStop = all.find((p) => p.stops === 2) ?? oneStop;
  return { oneStop, twoStop };
}

/** Distinct best plans (dedupes near-identical ones by compound sequence + stop count). */
export function topDistinctPlans(ctx: OptimizerCtx, n: number): PlanEval[] {
  const all = enumeratePlans(ctx);
  const seen = new Map<string, PlanEval>();
  for (const p of all) {
    const key = `${p.strategy.startCompound}-${p.strategy.stops.map((s) => s.compound).join('')}`;
    if (!seen.has(key)) seen.set(key, p);
    if (seen.size >= n) break;
  }
  return [...seen.values()];
}
