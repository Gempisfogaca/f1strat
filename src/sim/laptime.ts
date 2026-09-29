/**
 * Lap-time model.
 *
 *   lapTime = base pace (car + driver)
 *           + compound offset + tyre degradation (+ cliff)
 *           + fuel load
 *           + pace mode
 *           + dirty air (traffic)
 *           + wet track / wrong-tyre penalty
 *           + out-lap penalty
 *           + random per-lap variance
 *
 * The breakdown is kept so the post-race recap can attribute lost time.
 */
import { CONFIG } from './config';
import { compoundPace, degPenalty, wetMismatch } from './tyres';
import type { Compound, PaceMode } from './types';

export interface LapTimeInput {
  baseLapTime: number;
  carRating: number;
  driverRating: number;
  compound: Compound;
  wear: number;
  fuelKg: number;
  paceMode: PaceMode;
  /** Interval to the car ahead (s), or Infinity. */
  interval: number;
  dirtyAirMult: number;
  wetness: number;
  outLap: boolean;
  noise: number;
}

export interface LapTimeBreakdown {
  total: number;
  base: number;
  compound: number;
  deg: number;
  cliff: number;
  fuel: number;
  pace: number;
  dirtyAir: number;
  wetTrack: number;
  mismatch: number;
  outLap: number;
  noise: number;
}

export function basePace(baseLapTime: number, carRating: number, driverRating: number): number {
  const P = CONFIG.pace;
  return baseLapTime + (100 - carRating) * P.carSecPerPoint + (100 - driverRating) * P.driverSecPerPoint;
}

export function dirtyAirPenalty(interval: number, mult: number): number {
  const TR = CONFIG.traffic;
  if (!(interval < TR.dirtyAirWindow)) return 0;
  return TR.dirtyAirSec * mult * (1 - Math.max(0, interval) / TR.dirtyAirWindow);
}

export function computeLapTime(i: LapTimeInput): LapTimeBreakdown {
  const base = basePace(i.baseLapTime, i.carRating, i.driverRating);
  const compound = compoundPace(i.compound);
  const { linear: deg, cliff } = degPenalty(i.compound, i.wear);
  const fuel = i.fuelKg * CONFIG.fuel.secPerKg;
  const pace = CONFIG.pace.modes[i.paceMode].time;
  const dirtyAir = dirtyAirPenalty(i.interval, i.dirtyAirMult);
  const wetTrack = CONFIG.weather.wetTrackSlowSec * i.wetness;
  const mismatch = wetMismatch(i.compound, i.wetness);
  const outLap = i.outLap ? CONFIG.tyres.outLapPenalty : 0;
  const total = base + compound + deg + cliff + fuel + pace + dirtyAir + wetTrack + mismatch + outLap + i.noise;
  return { total, base, compound, deg, cliff, fuel, pace, dirtyAir, wetTrack, mismatch, outLap, noise: i.noise };
}
