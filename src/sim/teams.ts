// Fictional teams and drivers. Ratings feed the lap-time model (see config.pace).
import type { DriverDef, TeamDef } from './types';

export const TEAMS: TeamDef[] = [
  { id: 'aurora', name: 'Aurora Racing', short: 'AUR', color: '#ef3340', carRating: 95, pitCrew: 92 },
  { id: 'nordwind', name: 'Nordwind GP', short: 'NRD', color: '#2f7cf6', carRating: 94, pitCrew: 94 },
  { id: 'solaris', name: 'Solaris Motorsport', short: 'SOL', color: '#ff8a00', carRating: 92, pitCrew: 90 },
  { id: 'verdant', name: 'Verdant F1 Team', short: 'VER', color: '#19c37d', carRating: 90, pitCrew: 88 },
  { id: 'obsidian', name: 'Obsidian Works', short: 'OBS', color: '#aab4bf', carRating: 89, pitCrew: 91 },
  { id: 'tempest', name: 'Tempest Racing', short: 'TMP', color: '#8e5cf7', carRating: 87, pitCrew: 86 },
  { id: 'kestrel', name: 'Kestrel GP', short: 'KES', color: '#14c4c4', carRating: 86, pitCrew: 87 },
  { id: 'monarch', name: 'Monarch Autosport', short: 'MON', color: '#e8c547', carRating: 85, pitCrew: 84 },
  { id: 'rossovela', name: 'Rosso Vela', short: 'RSV', color: '#ff4fa3', carRating: 83, pitCrew: 85 },
  { id: 'ironclad', name: 'Ironclad Racing', short: 'IRN', color: '#8d6e63', carRating: 82, pitCrew: 83 },
];

export const DRIVERS: DriverDef[] = [
  { id: 'd1', name: 'Luca Moretti', code: 'MOR', number: 1, teamId: 'aurora', rating: 94 },
  { id: 'd2', name: 'Theo Lambert', code: 'LAM', number: 16, teamId: 'aurora', rating: 89 },
  { id: 'd3', name: 'Erik Halvorsen', code: 'HAL', number: 4, teamId: 'nordwind', rating: 93 },
  { id: 'd4', name: 'Kai Brandt', code: 'BRA', number: 81, teamId: 'nordwind', rating: 88 },
  { id: 'd5', name: 'Diego Ferraz', code: 'FER', number: 11, teamId: 'solaris', rating: 91 },
  { id: 'd6', name: 'Sam Whitlock', code: 'WHI', number: 63, teamId: 'solaris', rating: 87 },
  { id: 'd7', name: 'Yuto Arai', code: 'ARA', number: 22, teamId: 'verdant', rating: 89 },
  { id: 'd8', name: 'Noah Keller', code: 'KEL', number: 5, teamId: 'verdant', rating: 85 },
  { id: 'd9', name: 'Mathis Duval', code: 'DUV', number: 10, teamId: 'obsidian', rating: 88 },
  { id: 'd10', name: 'Oscar Lindqvist', code: 'LIN', number: 27, teamId: 'obsidian', rating: 86 },
  { id: 'd11', name: 'Rafael Costa', code: 'COS', number: 7, teamId: 'tempest', rating: 87 },
  { id: 'd12', name: 'Ivan Petrov', code: 'PET', number: 31, teamId: 'tempest', rating: 83 },
  { id: 'd13', name: 'Jonah Reyes', code: 'REY', number: 44, teamId: 'kestrel', rating: 86 },
  { id: 'd14', name: 'Felix Novak', code: 'NOV', number: 14, teamId: 'kestrel', rating: 84 },
  { id: 'd15', name: 'Arjun Mehta', code: 'MEH', number: 3, teamId: 'monarch', rating: 85 },
  { id: 'd16', name: 'Liam O\'Hara', code: 'OHA', number: 77, teamId: 'monarch', rating: 82 },
  { id: 'd17', name: 'Marco Bellini', code: 'BEL', number: 20, teamId: 'rossovela', rating: 84 },
  { id: 'd18', name: 'Hugo Sandoval', code: 'SAN', number: 9, teamId: 'rossovela', rating: 81 },
  { id: 'd19', name: 'Pieter de Vries', code: 'DEV', number: 18, teamId: 'ironclad', rating: 83 },
  { id: 'd20', name: 'Tomás Rivera', code: 'RIV', number: 2, teamId: 'ironclad', rating: 80 },
];

export const teamById = (id: string) => TEAMS.find((t) => t.id === id)!;
export const driverById = (id: string) => DRIVERS.find((d) => d.id === id)!;
export const driversOfTeam = (teamId: string) => DRIVERS.filter((d) => d.teamId === teamId);
