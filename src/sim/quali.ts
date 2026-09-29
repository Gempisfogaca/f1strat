// Simulated qualifying: one lap on softs with a bit of noise per driver.
import { CONFIG, circuitCfg } from './config';
import { basePace } from './laptime';
import type { Rng } from './rng';
import { DRIVERS, teamById } from './teams';

export interface QualiResult {
  driverId: string;
  time: number;
}

export function runQualifying(circuitId: string, rng: Rng): QualiResult[] {
  const c = circuitCfg(circuitId);
  return DRIVERS.map((d) => {
    const team = teamById(d.teamId);
    const t = basePace(c.baseLapTime, team.carRating, d.rating) + rng.normal(0, CONFIG.pace.qualiVarianceSd) - 0.8;
    return { driverId: d.id, time: t };
  }).sort((a, b) => a.time - b.time);
}
