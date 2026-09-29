/**
 * Dynamic weather.
 *
 * At race start we pre-generate rain events (lap ranges + intensity) plus
 * optional "threats" that appear on the forecast but never arrive. Track
 * wetness chases the current rain intensity with separate wetting/drying
 * rates; track temperature drops while it rains. The forecast panel shows a
 * noisy probability per upcoming lap — accuracy depends on difficulty.
 */
import { CONFIG, type CircuitCfg } from './config';
import { hash01, type Rng } from './rng';
import type { Difficulty, WeatherMode } from './types';

const WX = CONFIG.weather;

interface RainEvent {
  start: number;
  end: number;
  peak: number;
  real: boolean;
}

export interface ForecastLap {
  lap: number;
  prob: number; // 0–100
  intensity: 'light' | 'heavy' | null;
}

export class Weather {
  events: RainEvent[] = [];
  wetness = 0;
  rain = 0;
  trackTemp: number;
  airTemp: number;
  private baseTemp: number;
  private seed: number;

  constructor(cfg: CircuitCfg, private laps: number, mode: WeatherMode, tempOffset: number, rainMult: number, rng: Rng) {
    this.baseTemp = cfg.trackTemp + tempOffset + rng.range(-3, 3);
    this.trackTemp = this.baseTemp;
    this.airTemp = this.baseTemp - 9;
    this.seed = rng.int(1, 1e6);

    const dur = () => Math.max(3, laps * rng.range(WX.rainDurationPct[0], WX.rainDurationPct[1]));
    const peak = () => rng.range(WX.rainIntensity[0], WX.rainIntensity[1]);

    if (mode === 'wet') {
      // Start wet; it may dry out later.
      const end = laps * rng.range(0.35, 0.75);
      this.events.push({ start: -2, end, peak: rng.range(0.55, 0.9), real: true });
      this.wetness = this.events[0].peak;
      this.rain = this.events[0].peak;
      if (rng.chance(0.3)) {
        const s = end + laps * rng.range(0.1, 0.25);
        if (s < laps - 2) this.events.push({ start: s, end: s + dur(), peak: peak(), real: true });
      }
    } else if (mode === 'random' && rng.chance(Math.min(0.95, cfg.rainChance * rainMult))) {
      const s = laps * rng.range(0.15, 0.8);
      this.events.push({ start: s, end: s + dur(), peak: peak(), real: true });
    }
    if (mode !== 'dry' && rng.chance(WX.falseAlarmChance)) {
      const s = laps * rng.range(0.15, 0.85);
      if (!this.events.some((e) => s > e.start - 4 && s < e.end + 4)) {
        this.events.push({ start: s, end: s + dur() * 0.6, peak: peak(), real: false });
      }
    }
    this.events.sort((a, b) => a.start - b.start);
  }

  /** Rain intensity from real events at race-lap position `lap` (trapezoid ramp). */
  rainAt(lap: number, includeThreats = false): number {
    let r = 0;
    for (const e of this.events) {
      if (!e.real && !includeThreats) continue;
      if (lap < e.start || lap > e.end) continue;
      const ramp = Math.min(1, (lap - e.start) / 1.5, (e.end - lap) / 1.5);
      r = Math.max(r, e.peak * Math.max(0, Math.min(1, ramp)));
    }
    return r;
  }

  /** Advance by dt seconds. `leaderLap` is the leader's fractional race distance. */
  update(dt: number, leaderLap: number, refLapTime: number) {
    this.rain = this.rainAt(leaderLap);
    const target = this.rain;
    const perLap = target > this.wetness ? WX.wettingPerLap : WX.dryingPerLap * (1 + (this.trackTemp - 25) * 0.02);
    const k = 1 - Math.pow(1 - Math.min(0.99, perLap), dt / refLapTime);
    this.wetness += (target - this.wetness) * k;
    if (this.wetness < 0.005 && target === 0) this.wetness = 0;
    const tTarget = this.baseTemp - WX.rainCooling * this.rain - 4 * this.wetness;
    this.trackTemp += (tTarget - this.trackTemp) * (1 - Math.pow(0.5, dt / 60));
    this.airTemp = Math.min(this.trackTemp - 3, this.baseTemp - 9 - 3 * this.rain);
  }

  /** Probability of rain for each of the next laps, as a strategist would see it. */
  forecast(leaderLap: number, difficulty: Difficulty): ForecastLap[] {
    const D = CONFIG.difficulty[difficulty];
    const cur = Math.max(0, Math.floor(leaderLap));
    const out: ForecastLap[] = [];
    for (let h = 1; h <= WX.FORECAST_LAPS; h++) {
      const lap = cur + h;
      if (lap > this.laps) break;
      const real = this.rainAt(lap);
      const threat = this.rainAt(lap, true);
      const jitter = (hash01(this.seed, cur, h) - 0.5) * 2 * D.forecastNoise;
      const horizonDecay = 1 - 0.025 * h;
      let p: number;
      let intensityVal = 0;
      if (real > 0.05) {
        p = D.forecastAccuracy * horizonDecay + jitter;
        intensityVal = real;
      } else if (threat > 0.05) {
        p = (1 - D.forecastAccuracy) + 0.2 + jitter;
        intensityVal = threat;
      } else {
        p = 0.05 + Math.abs(jitter) * 0.6;
      }
      p = Math.max(0, Math.min(0.98, p));
      const prob = Math.round(p * 20) * 5;
      out.push({ lap, prob, intensity: prob >= 30 ? (intensityVal > 0.55 ? 'heavy' : 'light') : null });
    }
    return out;
  }

  /** Headline like "40% rain in 6 laps" or null. */
  headline(leaderLap: number, difficulty: Difficulty): string | null {
    const f = this.forecast(leaderLap, difficulty);
    const first = f.find((x) => x.prob >= 30);
    if (this.rain > 0.05) {
      const dryIn = f.findIndex((x) => x.prob < 30);
      return dryIn >= 0 ? `Rain easing in ~${dryIn + 1} laps` : 'Rain continuing';
    }
    if (!first) return null;
    const laps = first.lap - Math.floor(leaderLap);
    return `${first.prob}% ${first.intensity === 'heavy' ? 'heavy ' : ''}rain in ${laps} lap${laps === 1 ? '' : 's'}`;
  }

  /** True if any real rain is expected in the future (used by AI & optimizer). */
  realRainAhead(leaderLap: number, within: number): boolean {
    for (let l = Math.ceil(leaderLap); l <= leaderLap + within; l++) if (this.rainAt(l) > 0.1) return true;
    return false;
  }

  /** Pre-race headline risk of rain at some point in the race (0–100), noisy by difficulty. */
  raceRainRisk(difficulty: Difficulty): number {
    const D = CONFIG.difficulty[difficulty];
    const j = (hash01(this.seed, 99) - 0.5) * 2 * D.forecastNoise;
    const future = this.events.filter((e) => e.start > 0);
    let p = 0.08 + Math.abs(j) * 0.5;
    if (future.some((e) => e.real)) p = D.forecastAccuracy - 0.1 + j;
    else if (future.length) p = 1 - D.forecastAccuracy + 0.15 + j;
    return Math.round(Math.max(0, Math.min(0.95, p)) * 20) * 5;
  }

  /** Whether any real rain has fallen or will fall in the race. */
  get isWetRace(): boolean {
    return this.events.some((e) => e.real);
  }
}
