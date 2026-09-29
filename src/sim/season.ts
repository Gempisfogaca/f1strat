/**
 * Season mode + localStorage persistence.
 * 8 rounds rotating the 3 circuits with different conditions.
 */
import type { Difficulty, RaceResult } from './types';
import { DRIVERS, TEAMS } from './teams';

export interface SeasonRound {
  name: string;
  circuitId: string;
  tempOffset: number;
  rainMult: number;
}

export const CALENDAR: SeasonRound[] = [
  { name: 'Grand Prix of Italia', circuitId: 'velocita', tempOffset: 0, rainMult: 0.8 },
  { name: 'Porto Marina Grand Prix', circuitId: 'marina', tempOffset: 2, rainMult: 0.7 },
  { name: 'Highland Grand Prix', circuitId: 'highland', tempOffset: -2, rainMult: 1.3 },
  { name: 'Velocità Night Race', circuitId: 'velocita', tempOffset: -6, rainMult: 0.6 },
  { name: 'Marina Summer Classic', circuitId: 'marina', tempOffset: 8, rainMult: 0.4 },
  { name: 'Highland Autumn Trophy', circuitId: 'highland', tempOffset: -5, rainMult: 1.6 },
  { name: 'Grand Prix of the Lakes', circuitId: 'velocita', tempOffset: 3, rainMult: 1.2 },
  { name: 'Porto Marina Finale', circuitId: 'marina', tempOffset: 0, rainMult: 1.0 },
];

export interface SeasonState {
  teamId: string;
  difficulty: Difficulty;
  lengthId: string;
  round: number;
  seed: number;
  results: RaceResult[];
  driverPoints: Record<string, number>;
  teamPoints: Record<string, number>;
}

export interface Settings {
  difficulty: Difficulty;
  lengthId: string;
  teamId: string;
}

export interface SaveData {
  version: 1;
  settings: Settings;
  season: SeasonState | null;
}

const KEY = 'pitwall.save.v1';

const DEFAULT_SAVE: SaveData = {
  version: 1,
  settings: { difficulty: 'normal', lengthId: 'short', teamId: 'verdant' },
  season: null,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1) return structuredClone(DEFAULT_SAVE);
    return { ...DEFAULT_SAVE, ...d, settings: { ...DEFAULT_SAVE.settings, ...d.settings } };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage full / blocked — ignore */
  }
}

export function newSeason(teamId: string, difficulty: Difficulty, lengthId: string): SeasonState {
  return {
    teamId, difficulty, lengthId, round: 0, seed: Math.floor(Math.random() * 1e9), results: [],
    driverPoints: Object.fromEntries(DRIVERS.map((d) => [d.id, 0])),
    teamPoints: Object.fromEntries(TEAMS.map((t) => [t.id, 0])),
  };
}

export function applyResult(s: SeasonState, r: RaceResult): SeasonState {
  const driverPoints = { ...s.driverPoints };
  const teamPoints = { ...s.teamPoints };
  for (const c of r.results) {
    driverPoints[c.driverId] = (driverPoints[c.driverId] ?? 0) + c.points;
    teamPoints[c.teamId] = (teamPoints[c.teamId] ?? 0) + c.points;
  }
  return { ...s, round: s.round + 1, results: [...s.results, r], driverPoints, teamPoints };
}

export function driverStandings(s: SeasonState) {
  return DRIVERS.map((d) => ({
    driver: d,
    points: s.driverPoints[d.id] ?? 0,
    wins: s.results.filter((r) => r.results[0]?.driverId === d.id).length,
    podiums: s.results.filter((r) => r.results.slice(0, 3).some((x) => x.driverId === d.id)).length,
  })).sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums);
}

export function teamStandings(s: SeasonState) {
  return TEAMS.map((t) => ({
    team: t,
    points: s.teamPoints[t.id] ?? 0,
    wins: s.results.filter((r) => r.results[0]?.teamId === t.id).length,
  })).sort((a, b) => b.points - a.points || b.wins - a.wins);
}

export const seasonDone = (s: SeasonState) => s.round >= CALENDAR.length;
