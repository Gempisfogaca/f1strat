/**
 * ============================================================================
 *  PITWALL — TUNING CONFIG
 * ============================================================================
 * Every gameplay number lives here. Tweak freely; the simulation modules only
 * read from this object.
 *
 * Conventions
 *  - Times are in seconds, temperatures in °C, speeds in km/h, fuel in kg.
 *  - Tyre wear is a percentage (0 = new, 100 = destroyed).
 *  - "Per lap" wear/fuel numbers are specified for a REFERENCE_LAPS race and
 *    are scaled automatically for shorter races, so a 12-lap sprint still
 *    needs a 1- or 2-stop strategy just like a full-length race.
 * ============================================================================
 */
import type { Compound, Difficulty } from './types';

export interface CompoundCfg {
  name: string;
  color: string;
  /** Seconds per lap slower than a new Soft in the dry. */
  basePace: number;
  /** Wear % per lap (reference race length, 30 °C track, balanced pace). */
  wearPerLap: number;
  /** Wear % at which the tyre falls off the "cliff". */
  cliff: number;
  /** Wetness (0–1) where this tyre is at its best (slicks: 0). */
  optimalWetness: number;
}

export interface CircuitCfg {
  id: string;
  name: string;
  country: string;
  character: string;
  lengthKm: number;
  /** Reference lap time for a 100-rated car/driver on new softs, empty tank, dry. */
  baseLapTime: number;
  /** Full-distance race laps (race length options take a fraction of this). */
  fullLaps: number;
  /** Multiplier on tyre wear. */
  wearMult: number;
  /** Pace advantage (s/lap) the chasing car needs for a realistic pass chance. */
  overtakeThreshold: number;
  /** Multiplier on the dirty-air penalty. */
  dirtyAirMult: number;
  /** Time lost driving through the pit lane vs. staying on track (excl. the stop). */
  pitLaneLoss: number;
  /** Base track temperature. */
  trackTemp: number;
  /** Chance (0–1) that a "random weather" race brings rain. */
  rainChance: number;
  /** Safety-car/VSC incident chance per lap (reference race length). */
  incidentPerLap: number;
  /** Number of DRS zones (the longest straights get them). */
  drsZones: number;
}

export const CONFIG = {
  // --------------------------------------------------------------------------
  sim: {
    /** Fixed simulation rate. Rendering is decoupled and interpolates nothing — it just draws the latest state. */
    HZ: 60,
    /** Sim seconds per real second at "1x". Raise to make every speed faster. */
    BASE_TIME_SCALE: 1,
    SPEEDS: [0, 1, 2, 4, 8] as number[],
    /** Safety cap on sim steps executed per animation frame. */
    MAX_STEPS_PER_FRAME: 900,
    /** How often (ms) the HTML panels refresh. */
    UI_REFRESH_MS: 150,
  },

  // --------------------------------------------------------------------------
  race: {
    REFERENCE_LAPS: 50,
    LENGTH_OPTIONS: [
      { id: 'sprint', label: 'Sprint', pct: 0.25 },
      { id: 'short', label: 'Short', pct: 0.4 },
      { id: 'medium', label: 'Medium', pct: 0.6 },
      { id: 'full', label: 'Full', pct: 1.0 },
    ],
    MIN_LAPS: 8,
    LIGHTS_SECONDS: 4,
    /** Distance between grid slots (m). */
    GRID_SLOT_M: 9,
    /** Seconds it takes a car to get up to speed from standstill. */
    LAUNCH_SECONDS: 3.5,
    /** Launch reaction randomness (s). */
    LAUNCH_JITTER: 0.35,
    /** After the leader finishes, give the rest this long to cross the line. */
    FINISH_TIMEOUT_S: 120,
    /** Using only one dry compound in a dry race → this time penalty. */
    COMPOUND_RULE_PENALTY: 30,
    POINTS: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    FASTEST_LAP_POINT: 1,
  },

  // --------------------------------------------------------------------------
  pace: {
    /** Seconds per lap for each point of car rating below 100. */
    carSecPerPoint: 0.06,
    /** Seconds per lap for each point of driver rating below 100. */
    driverSecPerPoint: 0.03,
    /** Std-dev of random lap-to-lap variance. */
    lapVarianceSd: 0.16,
    /** Std-dev of qualifying performance noise. */
    qualiVarianceSd: 0.22,
    modes: {
      push: { time: -0.45, wear: 1.45 },
      balanced: { time: 0, wear: 1.0 },
      conserve: { time: 0.55, wear: 0.65 },
    },
  },

  // --------------------------------------------------------------------------
  fuel: {
    /** Fuel at the start of a reference-length race. */
    startKg: 100,
    /** Lap time cost per kg carried. The car gets ~3 s faster over the race. */
    secPerKg: 0.03,
  },

  // --------------------------------------------------------------------------
  tyres: {
    compounds: {
      S: { name: 'Soft', color: '#ff3b3b', basePace: 0.0, wearPerLap: 3.3, cliff: 72, optimalWetness: 0 },
      M: { name: 'Medium', color: '#ffd23f', basePace: 0.55, wearPerLap: 2.3, cliff: 76, optimalWetness: 0 },
      H: { name: 'Hard', color: '#f2f2f2', basePace: 1.05, wearPerLap: 1.6, cliff: 80, optimalWetness: 0 },
      I: { name: 'Intermediate', color: '#2ecc71', basePace: 0, wearPerLap: 2.4, cliff: 78, optimalWetness: 0.35 },
      W: { name: 'Wet', color: '#3aa0ff', basePace: 0, wearPerLap: 2.0, cliff: 80, optimalWetness: 0.8 },
    } as Record<Compound, CompoundCfg>,
    /** Linear degradation: seconds per lap per % wear. */
    degSecPerPct: 0.025,
    /** Past the cliff: extra seconds per lap per % of wear beyond it. */
    cliffSecPerPct: 0.2,
    /** Wear multiplier rises this much per °C above TEMP_REF (falls below). */
    tempRef: 30,
    wearPerDegC: 0.02,
    /** Cold tyres on the out-lap. */
    outLapPenalty: 1.0,
    /** Extra wear when running in dirty air. */
    dirtyAirWearMult: 1.12,
    /** Wear multiplier on wet-weather tyres used on a dry-ish track (overheating). */
    wetTyreOverheatMult: 2.5,
  },

  // --------------------------------------------------------------------------
  weather: {
    /** General slowdown of a wet track for everyone (s/lap at wetness 1). */
    wetTrackSlowSec: 7,
    /** Slick tyre penalty = slickWetSec * wetness^slickWetExp. */
    slickWetSec: 32,
    slickWetExp: 1.3,
    /** Intermediate: penalty per unit of wetness below/above optimum. */
    interBelowSec: 7,
    interAboveSec: 14,
    /** Full wet: penalty per unit of wetness below optimum (above is ~fine). */
    wetBelowSec: 9,
    wetAboveSec: 2,
    /** Fraction of the gap to target wetness closed per lap when rain is heavier / lighter than wetness. */
    wettingPerLap: 0.45,
    dryingPerLap: 0.18,
    /** Track cools by this much at full rain. */
    rainCooling: 12,
    /** Rain event length as a fraction of race distance. */
    rainDurationPct: [0.2, 0.45] as [number, number],
    rainIntensity: [0.25, 0.95] as [number, number],
    /** Chance of an extra "threat" that shows on the forecast but never arrives. */
    falseAlarmChance: 0.35,
    FORECAST_LAPS: 10,
  },

  // --------------------------------------------------------------------------
  traffic: {
    /** Cars closer than this (s) are held behind unless they pass. */
    minGapSec: 0.28,
    /** Dirty air starts to hurt inside this interval (s). */
    dirtyAirWindow: 1.2,
    /** Dirty-air penalty (s/lap) right on the gearbox; tapers to 0 at the window edge. */
    dirtyAirSec: 0.55,
    drsWindow: 1.0,
    /** Speed multiplier in a DRS zone with DRS open. */
    drsSpeedBoost: 1.035,
    /** Equivalent pace advantage DRS adds to a pass attempt. */
    drsPassBonus: 0.4,
    /** Base chance of a pass when the advantage equals the threshold. */
    passBaseChance: 0.3,
    /** Extra chance per second of advantage beyond the threshold. */
    passChancePerSec: 0.9,
    passMaxChance: 0.92,
    /** Tiny chance of a pass with less than threshold advantage (mistakes). */
    passFluke: 0.03,
    /** Lap 1 chaos: added to pass chance. */
    lapOnePassBonus: 0.15,
    /** Lapped cars yield (blue flags) but cost the lapping car this much. */
    blueFlagLoss: 0.25,
    /** DRS enabled from this lap onwards (and N laps after a restart). */
    drsFromLap: 3,
  },

  // --------------------------------------------------------------------------
  pit: {
    stopMean: 2.5,
    stopSd: 0.22,
    stopMin: 1.95,
    /** Each pit-crew point below 90 adds this to the mean. */
    crewSecPerPoint: 0.03,
    slowChance: 0.06,
    slowExtra: [1.5, 5.5] as [number, number],
    /** Pit lane speed shown in the UI. */
    laneSpeedKmh: 80,
  },

  // --------------------------------------------------------------------------
  safetyCar: {
    /** Chance an incident brings the full Safety Car (else VSC). */
    scShare: 0.55,
    scLapFactor: 1.6,
    vscLapFactor: 1.4,
    scLaps: [2, 4] as [number, number],
    vscLaps: [1, 2] as [number, number],
    /** Under SC, cars this far behind the car ahead (s) catch up at this lap-time factor. */
    bunchGap: 0.7,
    bunchFactor: 0.82,
    maxPerRace: 2,
    /** No new incidents in the final N laps. */
    noneInFinalLaps: 3,
    /** A DNF stopping on track triggers SC/VSC with this chance. */
    dnfTriggerChance: 0.5,
  },

  // --------------------------------------------------------------------------
  reliability: {
    /** Chance per car per lap of a mechanical DNF (reference race length). */
    dnfPerLap: 0.0004,
    /** Each car-rating point below 95 multiplies the chance by (1 + this). */
    ratingFactor: 0.05,
  },

  // --------------------------------------------------------------------------
  difficulty: {
    easy: {
      label: 'Easy',
      aiPlanTopN: 12, aiPlanTolerance: 14, aiPitNoiseLaps: 4, aiReactToSC: 0.1, aiWeatherLoss: 5, aiWearMargin: -6,
      rivalWear: 'exact', forecastAccuracy: 0.92, forecastNoise: 0.05,
    },
    normal: {
      label: 'Normal',
      aiPlanTopN: 5, aiPlanTolerance: 5, aiPitNoiseLaps: 2, aiReactToSC: 0.6, aiWeatherLoss: 3, aiWearMargin: 0,
      rivalWear: 'approx', forecastAccuracy: 0.78, forecastNoise: 0.12,
    },
    hard: {
      label: 'Hard',
      aiPlanTopN: 3, aiPlanTolerance: 1.5, aiPitNoiseLaps: 1, aiReactToSC: 1.0, aiWeatherLoss: 1.5, aiWearMargin: 3,
      rivalWear: 'hidden', forecastAccuracy: 0.62, forecastNoise: 0.2,
    },
  } as Record<Difficulty, {
    label: string;
    /** AI picks randomly among its N best plans. */
    aiPlanTopN: number;
    /** …but only plans within this many seconds of the optimum. */
    aiPlanTolerance: number;
    /** Random ± laps added to AI planned stop laps. */
    aiPitNoiseLaps: number;
    /** Probability AI pits early under SC/VSC when a stop is due soon. */
    aiReactToSC: number;
    /** AI changes tyres for weather once the wrong tyre costs this much (s/lap). */
    aiWeatherLoss: number;
    /** AI boxes when wear reaches (cliff - margin). Negative = runs over the cliff. */
    aiWearMargin: number;
    rivalWear: 'exact' | 'approx' | 'hidden';
    forecastAccuracy: number;
    forecastNoise: number;
  }>,

  // --------------------------------------------------------------------------
  circuits: [
    {
      id: 'velocita', name: 'Velocità Park', country: 'Italia', character: 'High-speed',
      lengthKm: 5.79, baseLapTime: 81.5, fullLaps: 53,
      wearMult: 1.15, overtakeThreshold: 0.3, dirtyAirMult: 0.8, pitLaneLoss: 20.5,
      trackTemp: 31, rainChance: 0.25, incidentPerLap: 0.008, drsZones: 2,
    },
    {
      id: 'marina', name: 'Porto Marina', country: 'Monaco-sur-Mer', character: 'Twisty street',
      lengthKm: 4.21, baseLapTime: 86.0, fullLaps: 60,
      wearMult: 0.75, overtakeThreshold: 1.1, dirtyAirMult: 1.35, pitLaneLoss: 19.0,
      trackTemp: 38, rainChance: 0.35, incidentPerLap: 0.02, drsZones: 1,
    },
    {
      id: 'highland', name: 'Highland Ring', country: 'Scotland', character: 'Balanced',
      lengthKm: 5.35, baseLapTime: 89.0, fullLaps: 55,
      wearMult: 1.0, overtakeThreshold: 0.6, dirtyAirMult: 1.0, pitLaneLoss: 21.5,
      trackTemp: 26, rainChance: 0.45, incidentPerLap: 0.012, drsZones: 2,
    },
  ] as CircuitCfg[],
};

export function circuitCfg(id: string): CircuitCfg {
  const c = CONFIG.circuits.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown circuit ${id}`);
  return c;
}

/** Race laps for a circuit and length option. */
export function lapsFor(circuitId: string, lengthId: string): number {
  const c = circuitCfg(circuitId);
  const opt = CONFIG.race.LENGTH_OPTIONS.find((o) => o.id === lengthId) ?? CONFIG.race.LENGTH_OPTIONS[1];
  return Math.max(CONFIG.race.MIN_LAPS, Math.round(c.fullLaps * opt.pct));
}
