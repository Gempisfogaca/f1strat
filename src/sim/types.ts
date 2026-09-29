// Shared simulation types.

export type Compound = 'S' | 'M' | 'H' | 'I' | 'W';
export const DRY_COMPOUNDS: Compound[] = ['S', 'M', 'H'];
export const ALL_COMPOUNDS: Compound[] = ['S', 'M', 'H', 'I', 'W'];

export type PaceMode = 'push' | 'balanced' | 'conserve';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Flag = 'green' | 'vsc' | 'sc';
export type WeatherMode = 'random' | 'dry' | 'wet';
export type TeamOrder = 'none' | 'hold' | 'swap';

export interface TeamDef {
  id: string;
  name: string;
  short: string;
  color: string;
  /** 0–100, main contributor to car pace */
  carRating: number;
  /** 0–100, affects stop time */
  pitCrew: number;
}

export interface DriverDef {
  id: string;
  name: string;
  code: string;
  number: number;
  teamId: string;
  /** 0–100 */
  rating: number;
}

/** A planned stop: the car boxes at the end of `lap` and fits `compound`. */
export interface PlanStop {
  lap: number;
  compound: Compound;
}

export interface Strategy {
  startCompound: Compound;
  stops: PlanStop[];
}

export interface RadioMsg {
  id: number;
  time: number;
  lap: number;
  carId?: string;
  level: 'info' | 'warn' | 'alert' | 'good';
  text: string;
}

export interface RaceSetup {
  circuitId: string;
  /** Season round id, or null for a quick race. */
  roundName: string;
  laps: number;
  difficulty: Difficulty;
  weather: WeatherMode;
  playerTeamId: string;
  /** Temperature offset for this event (°C). */
  tempOffset: number;
  /** Multiplier on the circuit's base rain chance. */
  rainChanceMult: number;
  seed: number;
  /** Strategy for each player car (keyed by driver id). */
  playerStrategies: Record<string, Strategy>;
  /** Grid order (driver ids), produced by qualifying. */
  grid: string[];
}

export interface PitStopRecord {
  lap: number;
  from: Compound;
  to: Compound;
  stopTime: number;
  slow: boolean;
  underFlag: Flag;
  posBefore: number;
  posAfter: number | null;
  wearAtStop: number;
}

export interface StintRecord {
  compound: Compound;
  startLap: number;
  endLap: number;
  maxWear: number;
}

export interface CarResult {
  driverId: string;
  teamId: string;
  position: number;
  status: 'finished' | 'dnf';
  laps: number;
  totalTime: number;
  gapText: string;
  bestLap: number;
  points: number;
  pitStops: number;
  penalty: number;
  grid: number;
}

export interface RaceResult {
  roundName: string;
  circuitId: string;
  results: CarResult[];
  fastestLap: { driverId: string; time: number } | null;
  recap: Record<string, RecapItem[]>;
}

export interface RecapItem {
  good: boolean;
  text: string;
}
