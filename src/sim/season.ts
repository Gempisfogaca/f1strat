/**
 * Season mode + localStorage persistence.
 * The full season follows the real 2026 calendar (24 rounds); Short (8) and
 * Medium (16) seasons pick random circuits, raced in calendar order.
 */
import { circuitCfg } from './config';
import type { Difficulty, RaceResult } from './types';
import { DRIVERS, TEAMS, teamById } from './teams';

export interface SeasonRound {
  name: string;
  circuitId: string;
  tempOffset: number;
  rainMult: number;
}

/** Full calendar, in race order. */
export const FULL_CALENDAR = [
  'melbourne', 'shanghai', 'suzuka', 'bahrain', 'jeddah', 'miami', 'montreal', 'monaco',
  'barcelona', 'spielberg', 'silverstone', 'spa', 'hungaroring', 'zandvoort', 'monza', 'madring',
  'baku', 'singapore', 'austin', 'mexico', 'interlagos', 'lasvegas', 'lusail', 'yasmarina',
];

export type SeasonFormat = 'short' | 'medium' | 'full';

/** Short and Medium pick random circuits from the calendar each new season. */
export const SEASON_FORMATS: Record<SeasonFormat, { label: string; races: number }> = {
  short: { label: 'Short', races: 8 },
  medium: { label: 'Medium', races: 16 },
  full: { label: 'Full', races: FULL_CALENDAR.length },
};

/** Random selection of `n` circuits, kept in calendar order. */
export function pickRounds(format: SeasonFormat, rand: () => number = Math.random): string[] {
  const n = SEASON_FORMATS[format].races;
  if (n >= FULL_CALENDAR.length) return [...FULL_CALENDAR];
  const pool = [...FULL_CALENDAR];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = new Set(pool.slice(0, n));
  return FULL_CALENDAR.filter((id) => chosen.has(id));
}

export const circuitNameOf = (id: string) => circuitCfg(id).name;

export const roundOf = (circuitId: string): SeasonRound => ({
  name: circuitCfg(circuitId).gpName,
  circuitId,
  tempOffset: 0,
  rainMult: 1,
});

export interface SeasonState {
  teamId: string;
  difficulty: Difficulty;
  lengthId: string;
  format: SeasonFormat;
  /** Circuit ids for this season, in order. */
  rounds: string[];
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
  seasonFormat: SeasonFormat;
}

export interface SaveData {
  version: 3;
  settings: Settings;
  season: SeasonState | null;
}

const KEY = 'pitwall.save.v1';

const DEFAULT_SAVE: SaveData = {
  version: 3,
  settings: { difficulty: 'normal', lengthId: 'short', teamId: 'williams', seasonFormat: 'short' },
  season: null,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const d = JSON.parse(raw) as { version: number; settings?: Partial<Settings>; season?: SeasonState | null };
    const settings = { ...DEFAULT_SAVE.settings, ...d.settings };
    if (!teamById(settings.teamId)) settings.teamId = DEFAULT_SAVE.settings.teamId;
    // Older saves used fictional teams/circuits: keep settings, drop the season.
    if (d.version !== 3) return { ...structuredClone(DEFAULT_SAVE), settings };
    const season = d.season && d.season.rounds?.every((id) => FULL_CALENDAR.includes(id)) && teamById(d.season.teamId) ? d.season : null;
    return { version: 3, settings, season };
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

export function newSeason(teamId: string, difficulty: Difficulty, lengthId: string, format: SeasonFormat): SeasonState {
  return {
    teamId, difficulty, lengthId, format, rounds: pickRounds(format),
    round: 0, seed: Math.floor(Math.random() * 1e9), results: [],
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

export const seasonDone = (s: SeasonState) => s.round >= s.rounds.length;
export const seasonRounds = (s: SeasonState) => s.rounds.map(roundOf);
