/**
 * RaceEngine — the fixed-step race simulation.
 *
 * Each car has a continuous race distance `dist` measured in laps (negative
 * on the grid, 0 = first crossing of the line). Every step:
 *
 *   1. weather + flag (SC / VSC) state machines advance
 *   2. each car's target lap time comes from the lap-time model
 *      (laptime.ts); progress rate = trackShape(u) / lapTime
 *   3. traffic is resolved: a car closing on the car physically ahead is held
 *      at a minimum gap unless it wins a pass roll in a passing zone (needs a
 *      pace advantage above the circuit's threshold; DRS helps)
 *   4. cars move; timing points are recorded so gaps/intervals are real
 *      time differences; line crossings, pit entry/exit, wear and fuel update
 *   5. AI strategy decisions and engineer radio messages
 *
 * The UI only reads state and calls the command methods at the bottom.
 */
import { CONFIG, type CircuitCfg } from './config';
import { computeLapTime, type LapTimeBreakdown } from './laptime';
import { Rng } from './rng';
import { enumeratePlans, raceScale, stintCost } from './strategy';
import { buildTrack, idx, inZone, timeFraction, zoneProgress, type Track } from './track';
import { bestCompoundFor, compoundCfg, isSlick, wearPerLap, wetMismatch } from './tyres';
import { DRIVERS, teamById } from './teams';
import { Weather } from './weather';
import {
  DRY_COMPOUNDS,
  type CarResult, type Compound, type DriverDef, type Flag, type PaceMode, type PitStopRecord,
  type PlanStop, type RaceResult, type RaceSetup, type RadioMsg, type RecapItem, type StintRecord,
  type TeamDef, type TeamOrder,
} from './types';

const K = 40; // timing points per lap

export interface PitState {
  startDist: number;
  span: number;
  laneTime: number;
  moved: number;
  stopTime: number;
  stopLeft: number;
  stopped: boolean;
  toCompound: Compound;
  record: PitStopRecord;
}

export interface Car {
  id: string;
  driver: DriverDef;
  team: TeamDef;
  isPlayer: boolean;
  grid: number;
  dist: number;
  compound: Compound;
  wear: number;
  tyreAge: number;
  used: Set<Compound>;
  paceMode: PaceMode;
  fuelKg: number;
  noise: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  lt: LapTimeBreakdown;
  speedKmh: number;
  interval: number;
  gapLeader: number;
  position: number;
  aheadId: string | null;
  pit: PitState | null;
  boxRequest: Compound | null;
  plan: PlanStop[];
  autoPlan: boolean;
  pitStops: PitStopRecord[];
  stints: StintRecord[];
  status: 'running' | 'finished' | 'dnf';
  finishTime: number;
  finishOrder: number;
  finishLaps: number;
  lateral: number;
  latTarget: number;
  passing: { targetId: string; until: number } | null;
  passTried: Set<string>;
  drsZone: number;
  drsOpen: boolean;
  outLap: boolean;
  launchDelay: number;
  slowTimer: number;
  blockedLap: number;
  stats: { traffic: number; cliff: number; weather: number; slowStop: number; scStops: number; missedSC: number };
  tp: Float64Array;
  penalty: number;
  scReactRolled: number;
  warned: Set<string>;
  lastDecisionLap: number;
  rngSalt: number;
}

export type RaceState = 'lights' | 'running' | 'finishing' | 'finished';

export class RaceEngine {
  readonly track: Track;
  readonly circuit: CircuitCfg;
  readonly setup: RaceSetup;
  readonly laps: number;
  readonly scale: number;
  readonly weather: Weather;
  readonly cars: Car[] = [];
  readonly rng: Rng;
  time = 0;
  lightsLeft = CONFIG.race.LIGHTS_SECONDS;
  state: RaceState = 'lights';
  flag: Flag = 'green';
  flagLapsLeft = 0;
  flagEnding = false;
  incidents = 0;
  restartLap = -99;
  leaderLap = 0;
  finishedAt = 0;
  fastest: { carId: string; time: number } | null = null;
  radio: RadioMsg[] = [];
  teamOrder: TeamOrder = 'none';
  order: Car[] = [];
  private msgId = 0;
  private finishCount = 0;
  private cooldown = new Map<string, number>();
  private scTimes = 0;

  constructor(setup: RaceSetup) {
    this.setup = setup;
    this.rng = new Rng(setup.seed);
    this.track = buildTrack(setup.circuitId);
    this.circuit = this.track.cfg;
    this.laps = setup.laps;
    this.scale = raceScale(setup.laps);
    this.weather = new Weather(this.circuit, this.laps, setup.weather, setup.tempOffset, setup.rainChanceMult, this.rng);

    const startFuel = Math.max(15, CONFIG.fuel.startKg * Math.min(1, this.laps / CONFIG.race.REFERENCE_LAPS));
    const aiPlans = this.aiPlanPool();

    setup.grid.forEach((driverId, gi) => {
      const driver = DRIVERS.find((d) => d.id === driverId)!;
      const team = teamById(driver.teamId);
      const isPlayer = team.id === setup.playerTeamId;
      let startCompound: Compound;
      let plan: PlanStop[];
      if (isPlayer) {
        const s = setup.playerStrategies[driver.id];
        startCompound = s.startCompound;
        plan = s.stops.map((x) => ({ ...x }));
      } else {
        const s = this.pickAiPlan(aiPlans);
        startCompound = s.startCompound;
        plan = s.stops;
      }
      const gridM = 12 + gi * CONFIG.race.GRID_SLOT_M;
      const car: Car = {
        id: driver.id, driver, team, isPlayer, grid: gi + 1,
        dist: -gridM / this.track.lengthM,
        compound: startCompound, wear: 0, tyreAge: 0, used: new Set([startCompound]),
        paceMode: 'balanced', fuelKg: startFuel, noise: 0, lapStart: 0, lastLap: 0, bestLap: Infinity,
        lt: undefined as unknown as LapTimeBreakdown, speedKmh: 0, interval: Infinity, gapLeader: 0,
        position: gi + 1, aheadId: null, pit: null, boxRequest: null, plan, autoPlan: true,
        pitStops: [], stints: [{ compound: startCompound, startLap: 1, endLap: 0, maxWear: 0 }],
        status: 'running', finishTime: 0, finishOrder: 0, finishLaps: 0,
        lateral: (gi % 2 === 0 ? -1 : 1) * 5, latTarget: 0, passing: null, passTried: new Set(),
        drsZone: -1, drsOpen: false, outLap: false,
        launchDelay: this.rng.range(0, CONFIG.race.LAUNCH_JITTER), slowTimer: 0, blockedLap: 0,
        stats: { traffic: 0, cliff: 0, weather: 0, slowStop: 0, scStops: 0, missedSC: 0 },
        tp: new Float64Array((this.laps + 4) * K).fill(NaN), penalty: 0, scReactRolled: -1,
        warned: new Set(), lastDecisionLap: -1, rngSalt: this.rng.int(1, 1e6),
      };
      car.lt = this.lapTime(car);
      this.cars.push(car);
    });
    this.order = [...this.cars];

    const wx = this.weather;
    this.say('info', `${this.circuit.name}: ${this.laps} laps. Track ${wx.trackTemp.toFixed(0)}°C.`);
    const head = wx.headline(0, setup.difficulty);
    if (wx.wetness > 0.2) this.say('warn', 'Track is wet for the start.');
    else if (head) this.say('warn', `Forecast: ${head}.`);
  }

  // ==========================================================================
  //  AI strategy
  // ==========================================================================

  private optCtx() {
    return { circuit: this.circuit, laps: this.laps, trackTemp: this.weather.trackTemp };
  }

  private aiPlanPool() {
    return enumeratePlans(this.optCtx()).slice(0, 60);
  }

  private get diff() {
    return CONFIG.difficulty[this.setup.difficulty];
  }

  private pickAiPlan(pool: ReturnType<RaceEngine['aiPlanPool']>) {
    const D = this.diff;
    if (this.weather.wetness > 0.2) {
      return { startCompound: bestCompoundFor(this.weather.wetness), stops: [] as PlanStop[] };
    }
    const chosen = this.rng.pick(this.candidatePlans(pool)).strategy;
    // Jitter stop laps (keeping stints at least 3 laps long) so the field spreads out.
    const noise = D.aiPitNoiseLaps;
    let prev = 0;
    const stops = chosen.stops.map((s) => {
      const lap = Math.max(prev + 3, Math.min(this.laps - 2, s.lap + Math.round(this.rng.range(-noise, noise))));
      prev = lap;
      return { lap, compound: s.compound };
    }).filter((s) => s.lap <= this.laps - 2);
    return { startCompound: chosen.startCompound, stops };
  }

  /** Distinct compound sequences within the difficulty's tolerance of the best plan. */
  private candidatePlans(plans: ReturnType<RaceEngine['aiPlanPool']>) {
    const D = this.diff;
    const distinct: typeof plans = [];
    const seen = new Set<string>();
    for (const p of plans) {
      const k = p.strategy.startCompound + p.strategy.stops.map((s) => s.compound).join('');
      if (!seen.has(k)) { seen.add(k); distinct.push(p); }
    }
    if (!distinct.length) return plans.slice(0, 1);
    const best = distinct[0].time;
    const ok = distinct.filter((p) => p.time - best <= D.aiPlanTolerance).slice(0, Math.max(1, D.aiPlanTopN));
    return ok.length ? ok : distinct.slice(0, 1);
  }

  /** Re-plan the rest of the race after an unplanned stop. */
  private replan(car: Car, fromLap: number) {
    if (!isSlick(car.compound)) { car.plan = []; return; }
    const needSecond = !this.weather.isWetRace && [...car.used].filter((c) => DRY_COMPOUNDS.includes(c)).length < 2;
    const plans = enumeratePlans(this.optCtx(), { fromLap, current: car.compound, startWear: car.wear, needSecond });
    car.plan = plans.length ? this.rng.pick(this.candidatePlans(plans)).strategy.stops.map((s) => ({ ...s })) : [];
  }

  /** Best slick for running the rest of the race (no more stops). */
  private bestSlickForRest(car: Car): Compound {
    const rest = Math.max(1, this.laps - this.lapOf(car));
    let best: Compound = 'M', bestT = Infinity;
    for (const c of DRY_COMPOUNDS) {
      const t = stintCost(this.optCtx(), c, rest).time;
      if (t < bestT) { bestT = t; best = c; }
    }
    return best;
  }

  /** Called once per lap per car shortly before pit entry. */
  private decide(car: Car) {
    const lap = this.lapOf(car);
    if (car.lastDecisionLap === lap) return;
    car.lastDecisionLap = lap;
    if (car.status !== 'running' || car.pit || this.state !== 'running') return;
    const remaining = this.laps - lap;
    if (remaining < 1) return;

    // Player cars: only execute the planned stops (if auto plan is on).
    if (car.isPlayer) {
      const next = car.plan[0];
      if (!car.boxRequest && car.autoPlan && next && next.lap <= lap) {
        car.boxRequest = next.compound;
        this.say('info', `Box, box. Plan stop — ${compoundCfg(next.compound).name}s.`, car);
      }
      return;
    }
    if (car.boxRequest) return;
    const D = this.diff;
    const w = this.weather.wetness;

    // 1. Weather — wrong tyre for conditions? (Hard AI also looks 2 laps ahead.)
    const lookW = this.setup.difficulty === 'hard' && this.weather.realRainAhead(this.leaderLap, 2) ? Math.max(w, 0.3) : w;
    const bestC = bestCompoundFor(lookW, this.bestSlickForRest(car));
    const loss = wetMismatch(car.compound, lookW) - wetMismatch(bestC, lookW);
    const typeWrong = isSlick(bestC) !== isSlick(car.compound) || (!isSlick(bestC) && bestC !== car.compound);
    if (typeWrong && loss > D.aiWeatherLoss && remaining >= 2) {
      car.boxRequest = bestC;
      return;
    }
    // 2. Safety car — take the cheap stop if one is due soon.
    if (this.flag !== 'green' && car.scReactRolled !== this.scTimes) {
      car.scReactRolled = this.scTimes;
      const next = car.plan[0];
      const window = Math.max(3, Math.round(this.laps * 0.2));
      if (next && next.lap - lap <= window && remaining > 3 && this.rng.chance(D.aiReactToSC)) {
        car.boxRequest = next.compound;
        return;
      }
    }
    // 3. Planned stop.
    const next = car.plan[0];
    if (next && next.lap <= lap && remaining >= 2) {
      car.boxRequest = isSlick(car.compound) ? next.compound : bestC;
      return;
    }
    // 4. Tyres finished.
    const cliff = compoundCfg(car.compound).cliff;
    if (car.wear > cliff - D.aiWearMargin && remaining >= 3) {
      car.boxRequest = isSlick(car.compound) ? this.bestSlickForRest(car) : bestC;
    }
  }

  // ==========================================================================
  //  Helpers
  // ==========================================================================

  lapOf(car: Car): number {
    return Math.max(1, Math.min(this.laps, Math.floor(car.dist) + 1));
  }

  private frac(d: number) {
    return d - Math.floor(d);
  }

  /** Time the car passed race distance d (interpolated), or NaN. */
  timeAt(car: Car, d: number): number {
    if (d < 0) return NaN;
    const f = d * K;
    const i = Math.floor(f);
    if (i + 1 >= car.tp.length) return NaN;
    const a = car.tp[i], b = car.tp[i + 1];
    if (isNaN(a)) return NaN;
    if (isNaN(b)) return a;
    return a + (b - a) * (f - i);
  }

  /** Gap in seconds from `behind` to `ahead`. */
  gapBetween(ahead: Car, behind: Car): number {
    const t = this.timeAt(ahead, behind.dist);
    if (!isNaN(t)) return Math.max(0, this.time - t);
    return Math.max(0, (ahead.dist - behind.dist) * (behind.lt?.total ?? this.circuit.baseLapTime));
  }

  private lapTime(car: Car): LapTimeBreakdown {
    return computeLapTime({
      baseLapTime: this.circuit.baseLapTime,
      carRating: car.team.carRating,
      driverRating: car.driver.rating,
      compound: car.compound,
      wear: car.wear,
      fuelKg: car.fuelKg,
      paceMode: car.paceMode,
      interval: car.interval,
      dirtyAirMult: this.circuit.dirtyAirMult,
      wetness: this.weather.wetness,
      outLap: car.outLap,
      noise: car.noise,
    });
  }

  /** Lap time the car will actually run given the flag. */
  private effectiveLapTime(car: Car): number {
    let T = car.lt.total;
    if (car.status === 'finished') return T * 1.3;
    const base = this.circuit.baseLapTime;
    if (this.flag === 'vsc') T = Math.max(T, base * CONFIG.safetyCar.vscLapFactor);
    if (this.flag === 'sc') {
      const sc = base * CONFIG.safetyCar.scLapFactor;
      T = Math.max(T, sc);
      if (car.aheadId && car.interval > CONFIG.safetyCar.bunchGap) T = Math.max(car.lt.total, sc * CONFIG.safetyCar.bunchFactor);
    }
    return T;
  }

  private pitLaneTime(): number {
    const segment = timeFraction(this.track, this.track.pitEntry, 1 + this.track.pitExit);
    return (this.circuit.baseLapTime + 2) * segment + this.circuit.pitLaneLoss;
  }

  /** Pit loss right now for this car (lane + stop − time it would take on track). */
  pitLossNow(car: Car): number {
    const segment = timeFraction(this.track, this.track.pitEntry, 1 + this.track.pitExit);
    return this.pitLaneTime() + CONFIG.pit.stopMean + (car.outLap ? 0 : CONFIG.tyres.outLapPenalty) - this.flagLapTime(car) * segment;
  }

  /**
   * Pit loss expressed in green-flag seconds. Under SC/VSC every gap is
   * stretched by the slower pace, so the raw loss overstates the real cost.
   */
  pitLossGreenEquiv(car: Car): number {
    return this.pitLossNow(car) * (car.lt.total / this.flagLapTime(car));
  }

  /** Lap time imposed by the current flag (ignores SC bunching catch-up). */
  private flagLapTime(car: Car): number {
    const base = this.circuit.baseLapTime;
    if (this.flag === 'sc') return Math.max(car.lt.total, base * CONFIG.safetyCar.scLapFactor);
    if (this.flag === 'vsc') return Math.max(car.lt.total, base * CONFIG.safetyCar.vscLapFactor);
    return car.lt.total;
  }

  private say(level: RadioMsg['level'], text: string, car?: Car, key?: string, cooldownS = 0) {
    if (key) {
      const k = `${car?.id ?? ''}:${key}`;
      const last = this.cooldown.get(k);
      if (last !== undefined && this.time - last < cooldownS) return;
      this.cooldown.set(k, this.time);
    }
    const lap = Math.max(0, Math.floor(this.leaderLap) + 1);
    const prefix = car ? `${car.driver.code}: ` : '';
    this.radio.push({ id: ++this.msgId, time: this.time, lap: Math.min(lap, this.laps), carId: car?.id, level, text: prefix + text });
    if (this.radio.length > 80) this.radio.shift();
  }

  // ==========================================================================
  //  Main step
  // ==========================================================================

  step(dt: number) {
    if (this.state === 'lights') {
      this.lightsLeft -= dt;
      if (this.lightsLeft <= 0) {
        this.state = 'running';
        this.say('good', 'Lights out and away we go!');
      }
      return;
    }
    if (this.state === 'finished') {
      // Keep cool-down laps rolling for the visuals.
      this.moveFree(dt);
      return;
    }
    this.time += dt;
    const leader = this.order.find((c) => c.status !== 'dnf') ?? this.cars[0];
    this.leaderLap = Math.max(0, leader.dist);
    this.weather.update(dt, this.leaderLap, this.circuit.baseLapTime);

    const T = this.track;
    const moves = new Map<Car, number>();
    const desiredMoves = new Map<Car, number>();

    // --- 1. desired movement per car -------------------------------------
    for (const car of this.cars) {
      if (car.status === 'dnf') continue;
      if (car.pit) continue;
      car.lt = this.lapTime(car);
      const Tlap = this.effectiveLapTime(car);
      const u = this.frac(car.dist);
      let rate = T.shape[idx(T, u)] / Tlap;
      // Launch ramp.
      if (this.time < CONFIG.race.LAUNCH_SECONDS + 1) {
        const k = Math.max(0, Math.min(1, (this.time - car.launchDelay) / CONFIG.race.LAUNCH_SECONDS));
        rate *= Math.max(0.02, k);
      }
      // DRS.
      const zi = T.drsZones.findIndex((z) => inZone(z, u));
      if (zi !== car.drsZone) {
        car.drsZone = zi;
        const lapsSinceRestart = this.lapOf(car) - this.restartLap;
        car.drsOpen = zi >= 0 && this.flag === 'green' && this.lapOf(car) >= CONFIG.traffic.drsFromLap &&
          lapsSinceRestart >= 2 && car.interval < CONFIG.traffic.drsWindow && car.status === 'running' && this.weather.wetness < 0.3;
      }
      if (car.drsOpen) rate *= CONFIG.traffic.drsSpeedBoost;
      if (car.slowTimer > 0) { car.slowTimer -= dt; rate *= 0.5; }
      // Team orders: swap → the car ahead backs off.
      if (this.teamOrder === 'swap' && car.isPlayer && this.swapLeaderId === car.id) rate *= 0.96;
      if (car.passing) rate *= 1.02;
      desiredMoves.set(car, rate * dt);
      moves.set(car, rate * dt);
    }

    // --- 2. traffic resolution ------------------------------------------
    const onTrack = this.cars.filter((c) => c.status === 'running' && !c.pit && c.dist > -1);
    onTrack.sort((a, b) => b.dist - a.dist);
    // Physical ring order by lap fraction.
    const ring = [...onTrack].sort((a, b) => this.frac(b.dist) - this.frac(a.dist));
    const newFrac = new Map<Car, number>();
    for (const c of onTrack) newFrac.set(c, c.dist + moves.get(c)!);
    for (const b of onTrack) {
      const ri = ring.indexOf(b);
      if (ring.length < 2) break;
      const a = ring[(ri - 1 + ring.length) % ring.length];
      if (a === b) continue;
      const aNew = newFrac.get(a)!;
      const bNew = newFrac.get(b)!;
      let gap = this.frac(aNew) - this.frac(bNew);
      if (gap < 0) gap += 1;
      if (gap > 0.3) continue;
      const aRate = moves.get(a)! / dt;
      const minGap = CONFIG.traffic.minGapSec * Math.max(aRate, 1e-4);
      if (gap >= minGap) continue;
      if (b.dist < 0 && a.dist < 0 && this.time < 1) continue; // still on the grid

      if (b.passing && b.passing.targetId === a.id && this.time < b.passing.until) {
        b.latTarget = 9; a.latTarget = -6;
        continue;
      }
      if (this.tryPass(b, a)) {
        b.latTarget = 9; a.latTarget = -6;
        continue;
      }
      // Held up: clamp behind the car ahead.
      const want = moves.get(b)!;
      let allowed = want - (minGap - gap);
      allowed = Math.max(0, allowed);
      moves.set(b, allowed);
      newFrac.set(b, b.dist + allowed);
      if (want > 0) {
        const lost = dt * (1 - allowed / want);
        if (this.flag === 'green') { b.stats.traffic += lost; b.blockedLap += lost; }
      }
    }

    // --- 3. move cars ----------------------------------------------------
    for (const car of this.cars) {
      if (car.status === 'dnf') { this.moveDnf(car, dt); continue; }
      if (car.pit) { this.movePit(car, dt); continue; }
      const mv = moves.get(car) ?? 0;
      this.advance(car, mv, dt);
      // Clear finished passes.
      if (car.passing) {
        const tgt = this.cars.find((c) => c.id === car.passing!.targetId);
        let lead = tgt ? this.frac(car.dist) - this.frac(tgt.dist) : 1;
        if (lead < -0.5) lead += 1;
        if (!tgt || this.time > car.passing.until || (lead > 0.0015 && lead < 0.5)) {
          car.passing = null;
          car.latTarget = 0;
          if (tgt) tgt.latTarget = 0;
        }
      }
      car.lateral += (car.latTarget - car.lateral) * Math.min(1, dt * 3);
      const TL = this.effectiveLapTime(car);
      car.speedKmh = (T.shape[idx(T, car.dist)] * T.lengthM / TL) * 3.6 * (car.drsOpen ? CONFIG.traffic.drsSpeedBoost : 1);
      if (this.time < CONFIG.race.LAUNCH_SECONDS + 1 && desiredMoves.get(car)) {
        car.speedKmh *= Math.min(1, (moves.get(car) ?? 0) / desiredMoves.get(car)! );
      }
    }

    // --- 4. order, gaps --------------------------------------------------
    this.updateOrder();
    if (this.teamOrder === 'swap' && this.time - this.swapSince > 40) {
      this.teamOrder = 'none';
      this.swapLeaderId = null;
      this.say('info', 'Swap cancelled.');
    }

    // --- 5. finishing ----------------------------------------------------
    if (this.state === 'finishing') {
      const allDone = this.cars.every((c) => c.status !== 'running');
      if (allDone || this.time - this.finishedAt > CONFIG.race.FINISH_TIMEOUT_S) this.endRace();
    }
  }

  /** Movement once the race is over — everyone cruises. */
  private moveFree(dt: number) {
    for (const car of this.cars) {
      if (car.status === 'dnf') continue;
      if (car.pit) { this.movePit(car, dt); continue; }
      const T = this.track;
      const rate = T.shape[idx(T, car.dist)] / (this.circuit.baseLapTime * 1.35);
      car.dist += rate * dt;
      car.speedKmh = rate * T.lengthM * 3.6;
      car.lateral += (0 - car.lateral) * Math.min(1, dt * 2);
    }
  }

  private tryPass(b: Car, a: Car): boolean {
    const TR = CONFIG.traffic;
    // Blue flags: lapped car lets the leader through.
    if (a.dist < b.dist - 0.5 || a.status === 'finished') {
      b.passing = { targetId: a.id, until: this.time + 4 };
      b.slowTimer = TR.blueFlagLoss * 2;
      return true;
    }
    if (this.flag !== 'green' || this.time < 2) return false;
    // Team orders.
    if (a.isPlayer && b.isPlayer) {
      if (this.teamOrder === 'hold') return false;
      if (this.teamOrder === 'swap' && this.swapLeaderId === a.id) {
        b.passing = { targetId: a.id, until: this.time + 5 };
        this.teamOrder = 'none';
        this.swapLeaderId = null;
        this.say('info', `Swap done — ${b.driver.code} through.`);
        return true;
      }
    }
    const u = this.frac(b.dist);
    const zi = this.track.passZones.findIndex((z) => {
      const p = zoneProgress(z, u);
      return p > 0.35;
    });
    const lapOne = b.dist < 1;
    if (zi < 0 && !lapOne) return false;
    const key = `${a.id}:${Math.floor(b.dist)}:${zi}`;
    if (b.passTried.has(key)) return false;
    b.passTried.add(key);
    if (b.passTried.size > 60) b.passTried.clear(), b.passTried.add(key);

    const adv = (a.lt.total - a.lt.dirtyAir) - (b.lt.total - b.lt.dirtyAir) + (b.drsOpen ? TR.drsPassBonus : 0);
    const thr = this.circuit.overtakeThreshold;
    let p = adv >= thr ? TR.passBaseChance + (adv - thr) * TR.passChancePerSec : TR.passFluke;
    if (lapOne) p += TR.lapOnePassBonus * (adv > 0 ? 1 : 0.3);
    if (a.isPlayer && b.isPlayer && this.teamOrder === 'none') p *= 0.7; // teammates race cleanly
    p = Math.min(TR.passMaxChance, p);
    if (this.rng.chance(p)) {
      b.passing = { targetId: a.id, until: this.time + 4 };
      if (a.isPlayer) this.say('warn', `Lost a place to #${b.driver.number} ${b.driver.code}.`, a, 'lostpos', 8);
      if (b.isPlayer) this.say('good', `Great move on #${a.driver.number} ${a.driver.code}!`, b, 'gainpos', 8);
      return true;
    }
    return false;
  }

  swapLeaderId: string | null = null;
  private swapSince = 0;

  /** Swap only makes sense when the two player cars are adjacent and close. */
  canSwap(): boolean {
    const mine = this.order.filter((c) => c.isPlayer && c.status === 'running' && !c.pit);
    if (mine.length < 2 || this.flag !== 'green') return false;
    return Math.abs(mine[0].position - mine[1].position) === 1 && this.gapBetween(mine[0], mine[1]) < 2.5;
  }

  /** Move a car forward by `mv` laps of distance, recording timing and events. */
  private advance(car: Car, mv: number, dt: number) {
    const d0 = car.dist;
    const d1 = d0 + mv;
    const t0 = this.time - dt;
    // Timing points.
    const i0 = Math.max(0, Math.ceil(d0 * K));
    const i1 = Math.floor(d1 * K);
    for (let i = i0; i <= i1 && i < car.tp.length; i++) {
      const w = mv > 0 ? (i / K - d0) / mv : 1;
      if (isNaN(car.tp[i])) car.tp[i] = t0 + dt * w;
    }
    car.dist = d1;

    if (car.status === 'running') {
      // Wear & fuel.
      const Tlap = this.effectiveLapTime(car);
      const lapsDone = mv; // fraction of a lap covered this step
      const flagWear = this.flag === 'green' ? 1 : 0.35;
      const wr = wearPerLap({
        compound: car.compound, trackWearMult: this.circuit.wearMult, trackTemp: this.weather.trackTemp,
        paceMode: car.paceMode, dirtyAir: car.interval < CONFIG.traffic.dirtyAirWindow,
        wetness: this.weather.wetness, raceScale: this.scale,
      });
      car.wear = Math.min(100, car.wear + wr * lapsDone * flagWear);
      const burn = (CONFIG.fuel.startKg * Math.min(1, this.laps / CONFIG.race.REFERENCE_LAPS)) / this.laps;
      car.fuelKg = Math.max(0.5, car.fuelKg - burn * lapsDone * (this.flag === 'green' ? 1 : 0.5));
      // Stats (time lost while racing).
      if (this.flag === 'green' && mv > 0) {
        const lapShare = dt / Tlap;
        car.stats.cliff += car.lt.cliff * lapShare;
        const best = bestCompoundFor(this.weather.wetness, car.compound);
        car.stats.weather += Math.max(0, wetMismatch(car.compound, this.weather.wetness) - wetMismatch(best, this.weather.wetness)) * lapShare;
        car.stats.traffic += car.lt.dirtyAir * lapShare;
      }
      const st = car.stints[car.stints.length - 1];
      st.maxWear = Math.max(st.maxWear, car.wear);
      if (car.isPlayer) this.playerWarnings(car);
    }

    // Decision point shortly before pit entry.
    const decisionU = this.track.pitEntry - 0.035;
    if (this.crossed(d0, d1, decisionU)) this.decide(car);

    // Pit entry.
    if (car.status === 'running' && car.boxRequest && this.crossed(d0, d1, this.track.pitEntry) && this.state === 'running') {
      const lap = this.lapOf(car);
      if (lap < this.laps) this.enterPit(car);
    }

    // Line crossing.
    if (Math.floor(d1) > Math.floor(d0) && d1 >= 0) this.onLine(car, Math.floor(d1), t0 + dt * ((Math.floor(d1) - d0) / Math.max(1e-9, mv)));
  }

  /** Did distance go from d0 to d1 across lap-fraction u? */
  private crossed(d0: number, d1: number, u: number): boolean {
    return Math.floor(d1 - u) > Math.floor(d0 - u);
  }

  private onLine(car: Car, lapsDone: number, crossTime: number) {
    if (lapsDone === 0) { car.lapStart = crossTime; return; }
    if (car.status !== 'running') return;
    const lt = crossTime - car.lapStart;
    car.lastLap = lt;
    car.lapStart = crossTime;
    if (lapsDone > 1 || lt < this.circuit.baseLapTime * 1.6) {
      if (lt < car.bestLap) car.bestLap = lt;
      if (this.flag === 'green' && (!this.fastest || lt < this.fastest.time)) {
        const had = this.fastest;
        this.fastest = { carId: car.id, time: lt };
        if (car.isPlayer && had && lapsDone > 2) this.say('good', `Fastest lap! ${fmtLap(lt)}`, car, 'fl', 20);
      }
    }
    car.tyreAge++;
    if (!car.pit) car.outLap = false;
    car.noise = this.rng.normal(0, CONFIG.pace.lapVarianceSd);

    // Player traffic note.
    if (car.isPlayer && car.blockedLap > 0.6 && car.aheadId) {
      const a = this.cars.find((c) => c.id === car.aheadId);
      if (a) this.say('warn', `Stuck behind #${a.driver.number} ${a.driver.code} — lost ${car.blockedLap.toFixed(1)}s that lap.`, car, 'stuck', 40);
    }
    car.blockedLap = 0;

    const isLeader = this.order[0] === car || lapsDone >= Math.floor(this.leaderLap);
    if (isLeader && this.state === 'running') this.onLeaderLap(lapsDone);

    // Finish.
    if (this.state === 'finishing' || lapsDone >= this.laps) {
      if (this.state === 'running') {
        this.state = 'finishing';
        this.finishedAt = crossTime;
        this.say('good', `Chequered flag! ${car.driver.name} wins.`);
      }
      car.status = 'finished';
      car.finishTime = crossTime;
      car.finishOrder = ++this.finishCount;
      car.finishLaps = lapsDone;
      car.stints[car.stints.length - 1].endLap = lapsDone;
      if (car.isPlayer) {
        const pos = this.order.indexOf(car) + 1;
        this.say(pos <= 3 ? 'good' : 'info', `Finished P${pos}.`, car);
      }
      return;
    }

    // Reliability.
    const rel = CONFIG.reliability;
    const pDnf = rel.dnfPerLap * this.scale * (1 + Math.max(0, 95 - car.team.carRating) * rel.ratingFactor);
    if (this.rng.chance(pDnf)) this.retire(car);
  }

  private lastLeaderLap = 0;

  private onLeaderLap(lapsDone: number) {
    if (lapsDone <= this.lastLeaderLap) return;
    this.lastLeaderLap = lapsDone;
    const SC = CONFIG.safetyCar;
    // Flag countdown.
    if (this.flag !== 'green') {
      if (this.flagEnding) {
        const was = this.flag;
        this.flag = 'green';
        this.flagEnding = false;
        this.restartLap = lapsDone + 1;
        this.say('good', was === 'sc' ? 'Safety Car is in — green flag, go go go!' : 'VSC ending — green flag!');
      } else {
        this.flagLapsLeft--;
        if (this.flagLapsLeft <= 0) {
          this.flagEnding = true;
          this.say('info', this.flag === 'sc' ? 'Safety Car in this lap.' : 'VSC ending this lap.');
        }
      }
    } else if (lapsDone >= 1 && lapsDone <= this.laps - SC.noneInFinalLaps && this.incidents < SC.maxPerRace) {
      const p = Math.min(0.25, this.circuit.incidentPerLap * this.scale);
      if (this.rng.chance(p)) this.deployFlag(this.rng.chance(SC.scShare) ? 'sc' : 'vsc', 'Incident on track');
    }
    if (lapsDone === this.laps - 1) this.say('info', 'Final lap!');
    this.weatherRadio();
  }

  private deployFlag(f: Flag, reason: string) {
    if (this.flag !== 'green' || this.leaderLap > this.laps - CONFIG.safetyCar.noneInFinalLaps) return;
    const SC = CONFIG.safetyCar;
    this.flag = f;
    this.flagEnding = false;
    this.incidents++;
    this.scTimes++;
    const range = f === 'sc' ? SC.scLaps : SC.vscLaps;
    this.flagLapsLeft = this.rng.int(range[0], range[1]);
    const player = this.cars.find((c) => c.isPlayer && c.status === 'running');
    const loss = player ? this.pitLossGreenEquiv(player) : 0;
    const green = player ? this.pitLaneTime() + CONFIG.pit.stopMean - player.lt.total * timeFraction(this.track, this.track.pitEntry, 1 + this.track.pitExit) : 0;
    this.say('alert', `${reason} — ${f === 'sc' ? 'SAFETY CAR' : 'VIRTUAL SAFETY CAR'} deployed. Cheap stop: ~${loss.toFixed(0)}s instead of ~${green.toFixed(0)}s.`);
    // Track who could have used it (for the recap).
    for (const c of this.cars) if (c.isPlayer && c.status === 'running' && c.plan.length > 0) c.stats.missedSC++;
  }

  private retire(car: Car) {
    car.status = 'dnf';
    car.boxRequest = null;
    car.stints[car.stints.length - 1].endLap = this.lapOf(car);
    car.latTarget = 24;
    this.say(car.isPlayer ? 'alert' : 'warn', car.isPlayer ? 'We have a problem… car is stopping. Retire the car, sorry.' : `#${car.driver.number} ${car.driver.code} has stopped on track — DNF.`, car.isPlayer ? car : undefined);
    if (this.rng.chance(CONFIG.safetyCar.dnfTriggerChance) && this.state === 'running') {
      this.deployFlag(this.rng.chance(0.5) ? 'sc' : 'vsc', `#${car.driver.number} stopped`);
    }
  }

  private moveDnf(car: Car, dt: number) {
    // Coast to a halt, off the racing line.
    car.speedKmh = Math.max(0, car.speedKmh - 160 * dt);
    const rate = (car.speedKmh / 3.6) / this.track.lengthM;
    car.dist += rate * dt;
    car.lateral += (car.latTarget - car.lateral) * Math.min(1, dt * 1.5);
  }

  // ==========================================================================
  //  Pit stops
  // ==========================================================================

  private enterPit(car: Car) {
    const P = CONFIG.pit;
    const to = car.boxRequest!;
    car.boxRequest = null;
    let stop = Math.max(P.stopMin, this.rng.normal(P.stopMean + Math.max(0, 90 - car.team.pitCrew) * P.crewSecPerPoint, P.stopSd));
    let slow = false;
    if (this.rng.chance(P.slowChance)) { stop += this.rng.range(P.slowExtra[0], P.slowExtra[1]); slow = true; }
    const span = 1 - this.track.pitEntry + this.track.pitExit;
    const lane = this.pitLaneTime();
    const posBefore = this.order.indexOf(car) + 1;
    car.pit = {
      startDist: car.dist, span, laneTime: lane, moved: 0, stopTime: stop, stopLeft: stop, stopped: false, toCompound: to,
      record: { lap: this.lapOf(car), from: car.compound, to, stopTime: stop, slow, underFlag: this.flag, posBefore, posAfter: null, wearAtStop: car.wear },
    };
    car.drsOpen = false;
    car.passing = null;
    car.lateral = 0;
    car.latTarget = 0;
    if (!car.isPlayer) {
      // Tell the player when a nearby rival pits.
      for (const p of this.cars.filter((c) => c.isPlayer && c.status === 'running' && !c.pit)) {
        const pi = this.order.indexOf(p), ci = this.order.indexOf(car);
        if (Math.abs(pi - ci) === 1) {
          const ahead = ci < pi;
          this.say('info', ahead
            ? `#${car.driver.number} ${car.driver.code} ahead has pitted — undercut attempt? Consider covering.`
            : `#${car.driver.number} ${car.driver.code} behind has pitted — watch the undercut.`, p, 'rivalpit' + car.id, 30);
        }
      }
    }
  }

  private movePit(car: Car, dt: number) {
    const p = car.pit!;
    const d0 = car.dist;
    if (!p.stopped && p.moved >= p.laneTime / 2) {
      // Stationary: change tyres.
      p.stopLeft -= dt;
      car.speedKmh = 0;
      if (p.stopLeft <= 0) {
        p.stopped = true;
        this.fitTyres(car, p.toCompound);
        if (car.isPlayer) {
          const r = p.record;
          if (r.slow) this.say('warn', `Slow stop, ${r.stopTime.toFixed(1)}s — sorry.`, car);
          else this.say('good', `${r.stopTime.toFixed(1)}s stop. ${compoundCfg(p.toCompound).name}s fitted.`, car);
        }
      }
      return;
    }
    p.moved += dt;
    const prog = Math.min(1, p.moved / p.laneTime);
    const newDist = p.startDist + p.span * prog;
    const mv = newDist - d0;
    car.speedKmh = CONFIG.pit.laneSpeedKmh;
    // Timing & line crossing via the generic path (no wear in the lane).
    const savedWear = car.wear, savedFuel = car.fuelKg;
    this.advance(car, mv, dt);
    car.wear = savedWear; car.fuelKg = savedFuel;
    if (prog >= 1) {
      const r = p.record;
      car.pitStops.push(r);
      if (r.slow) car.stats.slowStop += r.stopTime - CONFIG.pit.stopMean;
      if (r.underFlag !== 'green') car.stats.scStops++;
      car.pit = null;
      car.outLap = true;
      if (car.isPlayer) this.checkRejoinLater(car, r);
    }
  }

  private checkRejoinLater(car: Car, r: PitStopRecord) {
    // Position after the stop is recorded once the car is back on track.
    r.posAfter = this.order.indexOf(car) + 1;
    const ahead = this.order[this.order.indexOf(car) - 1];
    if (ahead) this.say('info', `Rejoined P${r.posAfter}, ${this.gapBetween(ahead, car).toFixed(1)}s behind #${ahead.driver.number}.`, car);
  }

  private fitTyres(car: Car, c: Compound) {
    car.stints[car.stints.length - 1].endLap = this.lapOf(car);
    car.stints.push({ compound: c, startLap: this.lapOf(car) + 1, endLap: 0, maxWear: 0 });
    car.compound = c;
    car.wear = 0;
    car.tyreAge = 0;
    car.used.add(c);
    car.warned.clear();
    // Consume the planned stop this one replaces.
    if (car.plan.length) car.plan.shift();
    if (!car.isPlayer) {
      const lap = this.lapOf(car);
      // Unplanned/weather stop → re-plan the rest of the race.
      if (!isSlick(c) || car.plan.length === 0 || Math.abs((car.plan[0]?.lap ?? lap) - lap) < 3) this.replan(car, lap);
    }
  }

  // ==========================================================================
  //  Order & gaps
  // ==========================================================================

  private updateOrder() {
    // Finished cars rank by laps completed then finish order; running cars by distance.
    const score = (c: Car) => (c.status === 'finished' ? c.finishLaps - c.finishOrder * 1e-6 : c.dist);
    const alive = this.cars.filter((c) => c.status !== 'dnf').sort((a, b) => score(b) - score(a));
    const dnf = this.cars.filter((c) => c.status === 'dnf').sort((a, b) => b.dist - a.dist);
    this.order = [...alive, ...dnf];
    const leader = this.order[0];
    this.order.forEach((c, i) => {
      c.position = i + 1;
      const ahead = i > 0 ? this.order[i - 1] : null;
      c.aheadId = ahead?.id ?? null;
      if (c.status === 'finished') return;
      if (c.status === 'dnf') { c.interval = Infinity; return; }
      c.gapLeader = c === leader ? 0 : this.gapBetween(leader, c);
      // Interval for dirty air uses the car physically ahead on track.
      c.interval = ahead && ahead.status !== 'dnf' && !ahead.pit ? this.gapBetween(ahead, c) : Infinity;
    });
  }

  // ==========================================================================
  //  Player warnings
  // ==========================================================================

  private playerWarnings(car: Car) {
    const cfg = compoundCfg(car.compound);
    const warn = (key: string, cond: boolean, level: RadioMsg['level'], text: string) => {
      if (cond && !car.warned.has(key)) { car.warned.add(key); this.say(level, text, car); }
    };
    warn('w50', car.wear >= 50, 'info', `Tyres at 50%.`);
    warn('wgo', car.wear >= cfg.cliff - 10, 'warn', `Tyres are going off — cliff in ~${Math.max(1, Math.round(10 / this.wearRate(car)))} laps.`);
    warn('wcliff', car.wear >= cfg.cliff, 'warn', `We're over the cliff! Losing big time — box now!`);
    // Weather advice.
    const w = this.weather.wetness;
    const best = bestCompoundFor(w, isSlick(car.compound) ? car.compound : 'M');
    const loss = wetMismatch(car.compound, w) - wetMismatch(best, w);
    if (loss > 1.5 && best !== car.compound && !car.boxRequest && (isSlick(best) !== isSlick(car.compound) || !isSlick(best))) {
      this.say('warn', isSlick(best) ? `Track is drying — slicks would be ${loss.toFixed(1)}s/lap faster.` : `${compoundCfg(best).name}s are ${loss.toFixed(1)}s/lap faster now!`, car, 'wx', 150);
    }
  }

  private rainWarned = { soon: false, raining: false };

  /** Once per leader lap: forecast / rain messages. */
  private weatherRadio() {
    const f = this.weather.forecast(this.leaderLap, this.setup.difficulty);
    const soon = f.slice(0, 3).find((x) => x.prob >= 50);
    const any = f.find((x) => x.prob >= 30);
    if (this.weather.rain > 0.05) {
      if (!this.rainWarned.raining) this.say('alert', `It's raining! Track is getting wet.`);
      this.rainWarned.raining = true;
    } else {
      if (this.rainWarned.raining && this.weather.wetness < 0.25) this.say('info', 'Rain has stopped. Track will dry out.');
      this.rainWarned.raining = false;
      if (soon && !this.rainWarned.soon) {
        this.say('warn', `Rain expected in ~${soon.lap - Math.floor(this.leaderLap)} laps (${soon.prob}%).`);
        this.rainWarned.soon = true;
      } else if (!soon) {
        if (any && !this.rainWarned.soon) this.say('info', `Weather: ${this.weather.headline(this.leaderLap, this.setup.difficulty)}.`, undefined, 'fc', 400);
        if (!any) this.rainWarned.soon = false;
      }
    }
  }

  private wearRate(car: Car): number {
    return wearPerLap({
      compound: car.compound, trackWearMult: this.circuit.wearMult, trackTemp: this.weather.trackTemp,
      paceMode: car.paceMode, dirtyAir: false, wetness: this.weather.wetness, raceScale: this.scale,
    });
  }

  // ==========================================================================
  //  Commands (from the UI)
  // ==========================================================================

  setBox(carId: string, compound: Compound | null) {
    const car = this.cars.find((c) => c.id === carId);
    if (!car || car.status !== 'running' || car.pit) return;
    car.boxRequest = compound;
    if (compound) this.say('info', `Copy, box this lap for ${compoundCfg(compound).name}s.`, car);
    else this.say('info', `Stay out, stay out.`, car);
  }

  setPaceMode(carId: string, mode: PaceMode) {
    const car = this.cars.find((c) => c.id === carId);
    if (!car || car.paceMode === mode) return;
    car.paceMode = mode;
    const t = { push: 'Push now, push push.', balanced: 'Standard mode.', conserve: 'Look after the tyres.' }[mode];
    this.say('info', t, car);
  }

  setAutoPlan(carId: string, on: boolean) {
    const car = this.cars.find((c) => c.id === carId);
    if (car) car.autoPlan = on;
  }

  skipPlanStop(carId: string) {
    const car = this.cars.find((c) => c.id === carId);
    if (car && car.plan.length) {
      const s = car.plan.shift()!;
      this.say('info', `Skipping the lap ${s.lap} stop.`, car);
      if (car.boxRequest === s.compound) car.boxRequest = null;
    }
  }

  setTeamOrder(order: TeamOrder) {
    const mine = this.order.filter((c) => c.isPlayer && c.status === 'running');
    if (order === 'swap') {
      if (!this.canSwap()) {
        this.say('warn', `Can't swap — the cars need to be running nose-to-tail (within 2.5s).`);
        return;
      }
      this.swapLeaderId = mine[0].id;
      this.swapSince = this.time;
      this.say('info', `${mine[0].driver.code}, let ${mine[1].driver.code} through, please.`);
    } else if (order === 'hold') {
      this.swapLeaderId = null;
      this.say('info', `Hold positions, both cars.`);
    } else {
      this.swapLeaderId = null;
      this.say('info', `You're free to race.`);
    }
    this.teamOrder = order;
  }

  /** Where would this car rejoin if it pitted this lap? */
  estimateRejoin(carId: string) {
    const car = this.cars.find((c) => c.id === carId);
    if (!car || car.status !== 'running') return null;
    const loss = this.pitLossNow(car);
    const projected = car.gapLeader + loss;
    const others = this.order.filter((c) => c !== car && c.status === 'running');
    let pos = 1;
    let ahead: Car | null = null, behind: Car | null = null;
    for (const o of others) {
      if (o.gapLeader < projected) { pos++; if (!ahead || o.gapLeader > ahead.gapLeader) ahead = o; }
      else if (!behind || o.gapLeader < behind.gapLeader) behind = o;
    }
    return {
      loss,
      lossGreen: this.pitLossGreenEquiv(car),
      pos,
      ahead: ahead ? { number: ahead.driver.number, code: ahead.driver.code, gap: projected - ahead.gapLeader } : null,
      behind: behind ? { number: behind.driver.number, code: behind.driver.code, gap: behind.gapLeader - projected } : null,
    };
  }

  // ==========================================================================
  //  End of race
  // ==========================================================================

  result: RaceResult | null = null;

  private endRace() {
    this.state = 'finished';
    for (const c of this.cars) if (c.status === 'running') {
      // Timed out — classify on current laps.
      c.status = 'finished';
      c.finishTime = this.time;
      c.finishOrder = ++this.finishCount;
      c.finishLaps = Math.floor(c.dist);
    }
    this.result = this.buildResult();
  }

  private buildResult(): RaceResult {
    const R = CONFIG.race;
    const dryRace = !this.weather.isWetRace;
    for (const c of this.cars) {
      const dryUsed = [...c.used].filter((x) => DRY_COMPOUNDS.includes(x)).length;
      if (dryRace && c.status === 'finished' && dryUsed < 2) c.penalty = R.COMPOUND_RULE_PENALTY;
    }
    const finished = this.cars.filter((c) => c.status === 'finished');
    const lapsOf = (c: Car) => Math.min(this.laps, c.finishLaps);
    const classified = [...finished].sort((a, b) =>
      lapsOf(b) - lapsOf(a) || (a.finishTime + a.penalty) - (b.finishTime + b.penalty));
    const dnf = this.cars.filter((c) => c.status === 'dnf').sort((a, b) => b.dist - a.dist);
    const winner = classified[0];
    const all = [...classified, ...dnf];
    const results: CarResult[] = all.map((c, i) => {
      const laps = c.status === 'dnf' ? Math.max(0, Math.floor(c.dist)) : lapsOf(c);
      const total = c.finishTime + c.penalty;
      let gapText = '';
      if (c.status === 'dnf') gapText = 'DNF';
      else if (i === 0) gapText = fmtRaceTime(total);
      else if (laps < lapsOf(winner)) gapText = `+${lapsOf(winner) - laps} lap${lapsOf(winner) - laps > 1 ? 's' : ''}`;
      else gapText = `+${(total - (winner.finishTime + winner.penalty)).toFixed(3)}s`;
      let points = c.status === 'finished' ? R.POINTS[i] ?? 0 : 0;
      if (this.fastest?.carId === c.id && i < 10 && c.status === 'finished') points += R.FASTEST_LAP_POINT;
      return {
        driverId: c.id, teamId: c.team.id, position: i + 1, status: c.status === 'dnf' ? 'dnf' : 'finished',
        laps, totalTime: total, gapText, bestLap: c.bestLap, points, pitStops: c.pitStops.length, penalty: c.penalty, grid: c.grid,
      };
    });
    const recap: Record<string, RecapItem[]> = {};
    for (const c of this.cars.filter((x) => x.isPlayer)) recap[c.id] = this.recapFor(c, results.find((r) => r.driverId === c.id)!);
    return {
      roundName: this.setup.roundName,
      circuitId: this.setup.circuitId,
      results,
      fastestLap: this.fastest ? { driverId: this.fastest.carId, time: this.fastest.time } : null,
      recap,
    };
  }

  private recapFor(c: Car, r: CarResult): RecapItem[] {
    const out: RecapItem[] = [];
    const delta = c.grid - r.position;
    if (r.status === 'dnf') out.push({ good: false, text: `Retired on lap ${r.laps + 1} — mechanical failure.` });
    else if (delta > 0) out.push({ good: true, text: `Gained ${delta} place${delta > 1 ? 's' : ''} from P${c.grid} to P${r.position}.` });
    else if (delta < 0) out.push({ good: false, text: `Lost ${-delta} place${delta < -1 ? 's' : ''} from P${c.grid} to P${r.position}.` });
    else out.push({ good: true, text: `Held P${r.position} from the grid.` });

    const stints = c.stints.map((s) => `${s.compound}${s.endLap ? ` (${Math.max(1, s.endLap - s.startLap + 1)})` : ''}`).join(' → ');
    out.push({ good: true, text: `Strategy: ${stints}. ${c.pitStops.length} stop${c.pitStops.length === 1 ? '' : 's'}.` });

    for (const p of c.pitStops) {
      if (p.underFlag !== 'green') out.push({ good: true, text: `Lap ${p.lap}: cheap stop under ${p.underFlag === 'sc' ? 'Safety Car' : 'VSC'}.` });
      if (p.slow) out.push({ good: false, text: `Lap ${p.lap}: slow stop (${p.stopTime.toFixed(1)}s) cost ~${(p.stopTime - CONFIG.pit.stopMean).toFixed(1)}s.` });
      if (p.posAfter !== null) {
        const net = p.posBefore - p.posAfter;
        if (net >= 0 && p.underFlag === 'green') out.push({ good: true, text: `Lap ${p.lap}: rejoined P${p.posAfter} — no track position lost.` });
      }
      if (p.wearAtStop > compoundCfg(p.from).cliff + 3) out.push({ good: false, text: `Lap ${p.lap}: pitted late — ${compoundCfg(p.from).name}s were at ${p.wearAtStop.toFixed(0)}%.` });
    }
    const scUsed = c.pitStops.filter((p) => p.underFlag !== 'green').length;
    if (c.stats.missedSC > 0 && scUsed === 0 && c.pitStops.length > 0) out.push({ good: false, text: `Didn't use the ${this.incidents > 1 ? 'Safety Car periods' : 'Safety Car'} for a cheaper stop.` });
    if (c.stats.traffic > 3) out.push({ good: false, text: `Traffic and dirty air cost ~${c.stats.traffic.toFixed(1)}s.` });
    else out.push({ good: true, text: `Clean air most of the race (only ${c.stats.traffic.toFixed(1)}s lost in traffic).` });
    if (c.stats.cliff > 1) out.push({ good: false, text: `Running past the tyre cliff cost ~${c.stats.cliff.toFixed(1)}s.` });
    if (c.stats.weather > 2) out.push({ good: false, text: `Being on the wrong tyre for the conditions cost ~${c.stats.weather.toFixed(1)}s.` });
    else if (this.weather.isWetRace) out.push({ good: true, text: `Timed the weather calls well.` });
    if (c.penalty > 0) out.push({ good: false, text: `+${c.penalty}s penalty: only one dry compound used.` });
    if (this.fastest?.carId === c.id) out.push({ good: true, text: `Set the fastest lap (${fmtLap(this.fastest.time)}).` });
    return out;
  }
}

export function fmtLap(t: number): string {
  if (!isFinite(t) || t <= 0) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtRaceTime(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h > 0 ? h + ':' : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
