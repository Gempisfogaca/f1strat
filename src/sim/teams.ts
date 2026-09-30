// The 2026 grid: 11 teams, 22 drivers.
// Ratings (0–100) are gameplay estimates, not official data — they feed the
// lap-time model (see config.pace) and are meant to be tuned freely.
import type { DriverDef, TeamDef } from './types';

export const TEAMS: TeamDef[] = [
  { id: 'mclaren', name: 'McLaren', short: 'MCL', color: '#ff8000', carRating: 94, pitCrew: 94 },
  { id: 'ferrari', name: 'Ferrari', short: 'FER', color: '#e8002d', carRating: 93, pitCrew: 93 },
  { id: 'redbull', name: 'Red Bull Racing', short: 'RBR', color: '#3671c6', carRating: 92, pitCrew: 95 },
  { id: 'mercedes', name: 'Mercedes', short: 'MER', color: '#27f4d2', carRating: 95, pitCrew: 92 },
  { id: 'astonmartin', name: 'Aston Martin', short: 'AMR', color: '#229971', carRating: 85, pitCrew: 88 },
  { id: 'alpine', name: 'Alpine', short: 'ALP', color: '#ff87bc', carRating: 87, pitCrew: 87 },
  { id: 'williams', name: 'Williams', short: 'WIL', color: '#64c4ff', carRating: 86, pitCrew: 89 },
  { id: 'racingbulls', name: 'Racing Bulls', short: 'RB', color: '#6692ff', carRating: 86, pitCrew: 88 },
  { id: 'haas', name: 'Haas', short: 'HAA', color: '#b6babd', carRating: 87, pitCrew: 86 },
  { id: 'audi', name: 'Audi', short: 'AUD', color: '#f50537', carRating: 85, pitCrew: 86 },
  { id: 'cadillac', name: 'Cadillac', short: 'CAD', color: '#d4af37', carRating: 82, pitCrew: 84 },
];

export const DRIVERS: DriverDef[] = [
  { id: 'norris', name: 'Lando Norris', code: 'NOR', number: 1, teamId: 'mclaren', rating: 94 },
  { id: 'piastri', name: 'Oscar Piastri', code: 'PIA', number: 81, teamId: 'mclaren', rating: 92 },
  { id: 'leclerc', name: 'Charles Leclerc', code: 'LEC', number: 16, teamId: 'ferrari', rating: 93 },
  { id: 'hamilton', name: 'Lewis Hamilton', code: 'HAM', number: 44, teamId: 'ferrari', rating: 91 },
  { id: 'verstappen', name: 'Max Verstappen', code: 'VER', number: 3, teamId: 'redbull', rating: 96 },
  { id: 'hadjar', name: 'Isack Hadjar', code: 'HAD', number: 6, teamId: 'redbull', rating: 86 },
  { id: 'russell', name: 'George Russell', code: 'RUS', number: 63, teamId: 'mercedes', rating: 93 },
  { id: 'antonelli', name: 'Kimi Antonelli', code: 'ANT', number: 12, teamId: 'mercedes', rating: 89 },
  { id: 'alonso', name: 'Fernando Alonso', code: 'ALO', number: 14, teamId: 'astonmartin', rating: 90 },
  { id: 'stroll', name: 'Lance Stroll', code: 'STR', number: 18, teamId: 'astonmartin', rating: 81 },
  { id: 'gasly', name: 'Pierre Gasly', code: 'GAS', number: 10, teamId: 'alpine', rating: 87 },
  { id: 'colapinto', name: 'Franco Colapinto', code: 'COL', number: 43, teamId: 'alpine', rating: 82 },
  { id: 'albon', name: 'Alexander Albon', code: 'ALB', number: 23, teamId: 'williams', rating: 87 },
  { id: 'sainz', name: 'Carlos Sainz', code: 'SAI', number: 55, teamId: 'williams', rating: 89 },
  { id: 'lawson', name: 'Liam Lawson', code: 'LAW', number: 30, teamId: 'racingbulls', rating: 84 },
  { id: 'lindblad', name: 'Arvid Lindblad', code: 'LIN', number: 41, teamId: 'racingbulls', rating: 82 },
  { id: 'ocon', name: 'Esteban Ocon', code: 'OCO', number: 31, teamId: 'haas', rating: 85 },
  { id: 'bearman', name: 'Oliver Bearman', code: 'BEA', number: 87, teamId: 'haas', rating: 86 },
  { id: 'hulkenberg', name: 'Nico Hülkenberg', code: 'HUL', number: 27, teamId: 'audi', rating: 85 },
  { id: 'bortoleto', name: 'Gabriel Bortoleto', code: 'BOR', number: 5, teamId: 'audi', rating: 85 },
  { id: 'perez', name: 'Sergio Pérez', code: 'PER', number: 11, teamId: 'cadillac', rating: 86 },
  { id: 'bottas', name: 'Valtteri Bottas', code: 'BOT', number: 77, teamId: 'cadillac', rating: 85 },
];

export const teamById = (id: string) => TEAMS.find((t) => t.id === id)!;
export const driverById = (id: string) => DRIVERS.find((d) => d.id === id)!;
export const driversOfTeam = (teamId: string) => DRIVERS.filter((d) => d.teamId === teamId);
