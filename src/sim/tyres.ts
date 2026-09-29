/**
 * Tyre model: wear rates, degradation (including the cliff) and wet-weather
 * suitability. All numbers come from CONFIG.tyres / CONFIG.weather.
 */
import { CONFIG } from './config';
import { ALL_COMPOUNDS, type Compound, type PaceMode } from './types';

const T = CONFIG.tyres;
const WX = CONFIG.weather;

export const compoundCfg = (c: Compound) => T.compounds[c];
export const isSlick = (c: Compound) => c === 'S' || c === 'M' || c === 'H';

/**
 * Wear in % per lap for the given conditions.
 * @param raceScale REFERENCE_LAPS / raceLaps — shorter races wear faster so strategy stays relevant.
 */
export function wearPerLap(opts: {
  compound: Compound;
  trackWearMult: number;
  trackTemp: number;
  paceMode: PaceMode;
  dirtyAir: boolean;
  wetness: number;
  raceScale: number;
}): number {
  const c = compoundCfg(opts.compound);
  let w = c.wearPerLap * opts.trackWearMult * opts.raceScale;
  w *= Math.max(0.5, 1 + (opts.trackTemp - T.tempRef) * T.wearPerDegC);
  w *= CONFIG.pace.modes[opts.paceMode].wear;
  if (opts.dirtyAir) w *= T.dirtyAirWearMult;
  // Wet tyres overheat and shred on a drying track.
  if (!isSlick(opts.compound)) {
    const dryness = Math.max(0, c.optimalWetness - 0.15 - opts.wetness) / Math.max(0.01, c.optimalWetness - 0.15 + 0.15);
    w *= 1 + dryness * (T.wetTyreOverheatMult - 1);
  } else {
    // Slicks on a wet track run cool and wear slowly.
    w *= 1 - Math.min(0.5, opts.wetness);
  }
  return w;
}

/** Degradation lap-time penalty split into the linear part and the cliff part. */
export function degPenalty(compound: Compound, wear: number): { linear: number; cliff: number } {
  const c = compoundCfg(compound);
  const linear = Math.min(wear, 100) * T.degSecPerPct;
  const cliff = wear > c.cliff ? (wear - c.cliff) * T.cliffSecPerPct : 0;
  return { linear, cliff };
}

/**
 * Seconds lost because of the compound vs. the track wetness.
 * Excludes the general wet-track slowdown that applies to everyone.
 */
export function wetMismatch(compound: Compound, wetness: number): number {
  const w = Math.max(0, Math.min(1, wetness));
  switch (compound) {
    case 'S':
    case 'M':
    case 'H':
      return WX.slickWetSec * Math.pow(w, WX.slickWetExp);
    case 'I': {
      const o = compoundCfg('I').optimalWetness;
      return w < o ? WX.interBelowSec * (o - w) : WX.interAboveSec * (w - o);
    }
    case 'W': {
      const o = compoundCfg('W').optimalWetness;
      return w < o ? WX.wetBelowSec * (o - w) : WX.wetAboveSec * (w - o);
    }
  }
}

/** Dry pace offset (only slicks have one; wet tyres are handled by wetMismatch). */
export function compoundPace(compound: Compound): number {
  return compoundCfg(compound).basePace;
}

/** Best compound for a given wetness, measured on new tyres. */
export function bestCompoundFor(wetness: number, dryChoice: Compound = 'M'): Compound {
  let best: Compound = dryChoice;
  let bestT = Infinity;
  for (const c of ALL_COMPOUNDS) {
    if (isSlick(c) && c !== dryChoice) continue;
    const t = wetMismatch(c, wetness) + (isSlick(c) ? compoundPace(c) : 0.6);
    if (t < bestT) { bestT = t; best = c; }
  }
  return best;
}

/** Colour for a wear % bar: green → yellow → red. */
export function wearColor(wear: number, cliff: number): string {
  if (wear >= cliff) return '#ff3b3b';
  if (wear >= cliff - 15) return '#ff9f1a';
  if (wear >= 40) return '#ffd23f';
  return '#2ecc71';
}
