/**
 * Time, identidade e gameplan (secoes 33, 35).
 * Toda marca e ficticia e original.
 */
import { PlayerProfile } from './player.js';
import { Position } from './attributes.js';

export type Tempo = 'grind' | 'balanced' | 'push' | 'blitz';
export type OffensiveFocus = 'inside' | 'balanced' | 'perimeter' | 'movement' | 'iso' | 'pick_and_roll' | 'post';
export type DefensiveScheme = 'man_tight' | 'man_sag' | 'switch_all' | 'drop_bigs' | 'aggressive_traps' | 'zone_23' | 'zone_32';
export type PnrCoverage = 'switch' | 'hedge' | 'drop' | 'blitz' | 'trap' | 'ice' | 'weak' | 'over' | 'under' | 'late_switch';

export interface Gameplan {
  tempo: Tempo;
  offensiveFocus: OffensiveFocus;
  defensiveScheme: DefensiveScheme;
  pnrCoverage: PnrCoverage;
  /** 0..1 */
  crashOffensiveGlass: number;
  helpAggression: number;
  doubleTeamStar: number;
  pressFullCourt: number;
  threePointEmphasis: number;
  paintEmphasis: number;
  transitionEmphasis: number;
  foulTolerance: number;
  /** Alvo de matchup hunting: id do defensor adversario a ser cacado. */
  huntTargetId?: string;
}

export const DEFAULT_GAMEPLAN: Gameplan = {
  tempo: 'balanced',
  offensiveFocus: 'balanced',
  defensiveScheme: 'man_tight',
  pnrCoverage: 'drop',
  crashOffensiveGlass: 0.3,
  helpAggression: 0.5,
  doubleTeamStar: 0.2,
  pressFullCourt: 0,
  threePointEmphasis: 0.5,
  paintEmphasis: 0.5,
  transitionEmphasis: 0.5,
  foulTolerance: 0.5,
};

export interface TeamIdentity {
  id: string;
  city: string;
  name: string;
  abbreviation: string;
  colors: { primary: string; secondary: string; accent: string };
  arena: string;
  conference: 'Leste' | 'Oeste';
  division: string;
  marketSize: 'big' | 'mid' | 'small';
}

export interface Coach {
  id: string;
  name: string;
  /** 0..100 */
  offenseRating: number;
  defenseRating: number;
  development: number;
  rotationDiscipline: number;
  adaptability: number;
  preferredGameplan: Gameplan;
}

export interface Team {
  identity: TeamIdentity;
  roster: PlayerProfile[];
  starters: string[];
  rotation: string[];
  gameplan: Gameplan;
  coach: Coach;
  /** Estado de franquia. */
  wins: number;
  losses: number;
  chemistry: number;
  /** Folha salarial em milhoes. */
  payroll?: number;
}

export function teamLabel(t: TeamIdentity): string {
  return `${t.city} ${t.name}`;
}

export function findPlayer(team: Team, id: string): PlayerProfile | undefined {
  return team.roster.find((p) => p.id === id);
}

export function startersOf(team: Team): PlayerProfile[] {
  const out: PlayerProfile[] = [];
  for (const id of team.starters) {
    const p = findPlayer(team, id);
    if (p) out.push(p);
  }
  return out;
}

/** Ordena a escalacao por posicao natural para desenhar o spacing inicial. */
export function sortByPosition(players: PlayerProfile[]): PlayerProfile[] {
  const order: Record<Position, number> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
  return [...players].sort((a, b) => order[a.position] - order[b.position]);
}

/** Identidade tatica derivada do elenco - usada pela IA quando nao ha gameplan manual. */
export function deriveGameplan(team: Team): Gameplan {
  const roster = startersOf(team);
  if (roster.length === 0) return { ...team.coach.preferredGameplan };
  const avg = (f: (p: PlayerProfile) => number) => roster.reduce((s, p) => s + f(p), 0) / roster.length;
  const three = avg((p) => p.attributes.threePoint);
  const speed = avg((p) => p.attributes.speed);
  const strength = avg((p) => p.attributes.strength);
  const bigDefense = Math.max(...roster.map((p) => p.attributes.interiorDefense));
  const lateral = avg((p) => p.attributes.lateralQuickness);

  const gp: Gameplan = { ...team.coach.preferredGameplan };
  gp.tempo = speed > 80 ? 'push' : speed > 74 ? 'balanced' : 'grind';
  gp.offensiveFocus = three > 80 ? 'perimeter' : strength > 82 ? 'inside' : 'balanced';
  gp.threePointEmphasis = Math.min(1, Math.max(0, (three - 62) / 30));
  gp.paintEmphasis = Math.min(1, Math.max(0, (strength - 62) / 30));
  gp.transitionEmphasis = Math.min(1, Math.max(0, (speed - 64) / 28));
  gp.pnrCoverage = bigDefense > 86 ? 'drop' : lateral > 80 ? 'switch' : 'hedge';
  gp.defensiveScheme = lateral > 82 ? 'switch_all' : bigDefense > 86 ? 'drop_bigs' : 'man_tight';
  return gp;
}
