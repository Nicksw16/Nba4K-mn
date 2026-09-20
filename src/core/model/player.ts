/**
 * Perfil persistente do atleta. Separado do ator de simulacao (sim/actor.ts):
 * o perfil e o que existe entre partidas (carreira, franquia, colecao);
 * o ator e o corpo fisico dentro de uma partida.
 */
import { Attributes, Physique, Position, clampAttributes, makeAttributes, makePhysique, naturalPosition, overall } from './attributes.js';
import { BadgeLoadout, BadgeSlots, emptySlots } from './badges.js';
import { PlayStyle, Tendencies, tendenciesForStyle } from './tendencies.js';

export interface SignatureAnimations {
  /** Ids de moves de drible equipados (ver sim/dribble.ts). */
  dribbleMoves: string[];
  /** Base de assinatura de arremesso: afeta tempo de release e cue visual. */
  jumpshot: string;
  dunkPackage: string;
  layupPackage: string;
  /** Estilo de corrida/idle, puramente visual. */
  movementStyle: PlayStyle;
}

export interface PlayerContract {
  salary: number;
  yearsRemaining: number;
  teamOption: boolean;
  playerOption: boolean;
  guaranteed: boolean;
  incentives: { description: string; amount: number; met: boolean }[];
  noTrade: boolean;
}

export interface PlayerPersonality {
  /** 0..100 */
  loyalty: number;
  ambition: number;
  ego: number;
  workEthic: number;
  leadership: number;
  coachability: number;
  marketPreference: 'big' | 'small' | 'any';
  winNowPreference: number;
}

export interface PlayerProfile {
  id: string;
  firstName: string;
  lastName: string;
  jersey: number;
  position: Position;
  secondaryPosition: Position;
  age: number;
  experience: number;
  attributes: Attributes;
  potential: Attributes;
  physique: Physique;
  tendencies: Tendencies;
  badges: BadgeLoadout;
  badgeSlots: BadgeSlots;
  /** Loadouts nomeados (secao 46). */
  loadouts: { name: string; badges: BadgeLoadout }[];
  activeLoadout: number;
  signature: SignatureAnimations;
  personality: PlayerPersonality;
  contract?: PlayerContract;
  /** Estado de saude persistente. */
  health: { condition: number; injury?: { type: string; gamesOut: number; severity: number } };
  /** Tag de origem: gerado, criado pelo usuario, draftado. */
  origin: 'generated' | 'user' | 'draft';
  teamId?: string;
}

export function fullName(p: PlayerProfile): string {
  return `${p.firstName} ${p.lastName}`;
}

export function shortName(p: PlayerProfile): string {
  return `${p.firstName.charAt(0)}. ${p.lastName}`;
}

export function playerOverall(p: PlayerProfile): number {
  return overall(p.attributes, p.position);
}

export interface PlayerSeed {
  id: string;
  firstName: string;
  lastName: string;
  position?: Position;
  heightInches: number;
  weightLbs: number;
  wingspanInches?: number;
  style: PlayStyle;
  attributes: Partial<Attributes>;
  age?: number;
  jersey?: number;
  badges?: BadgeLoadout;
}

export function makePlayer(seed: PlayerSeed): PlayerProfile {
  const attributes = clampAttributes(makeAttributes(55, seed.attributes));
  const physique = makePhysique(seed.heightInches, seed.weightLbs, seed.wingspanInches);
  const position = seed.position ?? naturalPosition(attributes, physique);
  const potential = clampAttributes(makeAttributes(0, Object.fromEntries(
    Object.entries(attributes).map(([k, v]) => [k, Math.min(99, v + 6)]),
  ) as Partial<Attributes>));
  return {
    id: seed.id,
    firstName: seed.firstName,
    lastName: seed.lastName,
    jersey: seed.jersey ?? 0,
    position,
    secondaryPosition: position,
    age: seed.age ?? 25,
    experience: Math.max(0, (seed.age ?? 25) - 20),
    attributes,
    potential,
    physique,
    tendencies: tendenciesForStyle(seed.style),
    badges: seed.badges ?? {},
    badgeSlots: defaultSlotsFor(position),
    loadouts: [],
    activeLoadout: 0,
    signature: {
      dribbleMoves: ['crossover', 'between_legs', 'hesitation', 'stepback'],
      jumpshot: 'base_a',
      dunkPackage: 'standard',
      layupPackage: 'standard',
      movementStyle: seed.style,
    },
    personality: {
      loyalty: 50, ambition: 50, ego: 45, workEthic: 55, leadership: 45, coachability: 55,
      marketPreference: 'any', winNowPreference: 50,
    },
    health: { condition: 1 },
    origin: 'generated',
  };
}

export function defaultSlotsFor(pos: Position): BadgeSlots {
  const s = emptySlots();
  const base: Record<Position, BadgeSlots> = {
    PG: { shooting: 5, finishing: 3, playmaking: 6, defense: 4, rebounding: 1, physicals: 3 },
    SG: { shooting: 6, finishing: 4, playmaking: 4, defense: 4, rebounding: 2, physicals: 3 },
    SF: { shooting: 5, finishing: 5, playmaking: 3, defense: 5, rebounding: 3, physicals: 3 },
    PF: { shooting: 3, finishing: 5, playmaking: 2, defense: 5, rebounding: 5, physicals: 4 },
    C: { shooting: 2, finishing: 6, playmaking: 2, defense: 6, rebounding: 6, physicals: 4 },
  };
  return { ...s, ...base[pos] };
}

/** Loadout efetivo (aplica o slot ativo, se houver). */
export function activeBadges(p: PlayerProfile): BadgeLoadout {
  const lo = p.loadouts[p.activeLoadout];
  return lo ? lo.badges : p.badges;
}
