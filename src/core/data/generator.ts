/**
 * Geracao procedural de atletas, times e liga.
 * Distribuicao de talento calibrada para produzir uma liga com poucas estrelas,
 * muitos titulares medianos e reservas fracos - como uma liga real.
 */
import { Rng } from '../math/rng.js';
import { Attributes, Position, POSITIONS, clampAttributes, makeAttributes, overall } from '../model/attributes.js';
import { PlayerProfile, defaultSlotsFor, makePlayer } from '../model/player.js';
import { PlayStyle, tendenciesForStyle } from '../model/tendencies.js';
import { BADGES, BadgeLoadout, BadgeTier, maxTierFor } from '../model/badges.js';
import { Coach, DEFAULT_GAMEPLAN, Team, TeamIdentity, deriveGameplan } from '../model/team.js';
import { ARENA_NAMES, CITIES, COACH_FIRST, COACH_LAST, FIRST_NAMES, LAST_NAMES, TEAM_NAMES } from './names.js';
import { clamp } from '../math/util.js';

const STYLE_BY_POSITION: Record<Position, PlayStyle[]> = {
  PG: ['cerebral_floor_general', 'shifty_shot_creator', 'power_guard', 'movement_shooter'],
  SG: ['shifty_shot_creator', 'movement_shooter', 'isolation_scorer', 'connector_3d', 'explosive_slasher'],
  SF: ['connector_3d', 'explosive_slasher', 'point_forward', 'lockdown_wing', 'isolation_scorer'],
  PF: ['stretch_big', 'rim_runner', 'post_scorer', 'defensive_anchor', 'point_forward'],
  C: ['defensive_anchor', 'rim_runner', 'post_scorer', 'stretch_big'],
};

const HEIGHT_RANGE: Record<Position, [number, number]> = {
  PG: [72, 77], SG: [75, 79], SF: [78, 81], PF: [80, 83], C: [82, 87],
};

const WEIGHT_BY_HEIGHT = (h: number, rng: Rng): number => Math.round(h * 2.72 - 15 + rng.normal(0, 9));

/** Perfil de atributo por posicao: media relativa ao nivel geral do atleta. */
const POSITION_PROFILE: Record<Position, Partial<Record<keyof Attributes, number>>> = {
  PG: { ballHandle: 14, passAccuracy: 13, passIQ: 12, passVision: 11, speedWithBall: 12, threePoint: 6, midRange: 3, freeThrow: 7, speed: 9, acceleration: 9, agility: 8, steal: 4, perimeterDefense: 2, lateralQuickness: 6, strength: -16, interiorDefense: -18, block: -22, defensiveRebound: -16, offensiveRebound: -20, standingDunk: -22, postControl: -16, drivingDunk: -6, closeShot: -2, vertical: -2 },
  SG: { threePoint: 9, midRange: 7, ballHandle: 6, freeThrow: 6, speed: 6, acceleration: 6, agility: 6, perimeterDefense: 4, steal: 3, passAccuracy: -2, passIQ: -3, strength: -8, interiorDefense: -12, block: -14, defensiveRebound: -10, offensiveRebound: -14, standingDunk: -12, postControl: -10 },
  SF: { threePoint: 4, drivingLayup: 5, drivingDunk: 5, perimeterDefense: 5, defensiveRebound: 0, strength: 0, closeShot: 3, hands: 3, passIQ: -1, ballHandle: -3, block: -5, interiorDefense: -4, standingDunk: -4, postControl: -4, speedWithBall: -3 },
  PF: { standingDunk: 7, interiorDefense: 8, defensiveRebound: 9, offensiveRebound: 7, strength: 9, block: 6, closeShot: 4, postControl: 5, threePoint: -5, ballHandle: -12, passAccuracy: -7, speedWithBall: -12, speed: -6, agility: -6, lateralQuickness: -6, passVision: -6 },
  C: { standingDunk: 11, interiorDefense: 13, defensiveRebound: 13, offensiveRebound: 11, strength: 13, block: 12, closeShot: 6, postControl: 8, hands: 4, threePoint: -14, midRange: -8, ballHandle: -20, passAccuracy: -10, speedWithBall: -20, speed: -12, agility: -12, acceleration: -10, lateralQuickness: -10, passVision: -8, freeThrow: -8 },
};

export interface GeneratePlayerOptions {
  level: number; // 35..95, nivel geral do atleta
  position?: Position;
  age?: number;
  id?: string;
}

export function generatePlayer(rng: Rng, opts: GeneratePlayerOptions): PlayerProfile {
  const position = opts.position ?? rng.pick(POSITIONS);
  const style = rng.pick(STYLE_BY_POSITION[position]);
  const [hMin, hMax] = HEIGHT_RANGE[position];
  const heightInches = Math.round(rng.range(hMin, hMax + 0.99));
  const weightLbs = clamp(WEIGHT_BY_HEIGHT(heightInches, rng), 160, 300);
  const wingspanInches = heightInches + Math.round(rng.range(0, 7));
  const age = opts.age ?? Math.round(clamp(rng.normal(26, 3.6), 19, 39));

  const profile = POSITION_PROFILE[position];
  const attrs: Partial<Attributes> = {};
  const noise = () => rng.normal(0, 6.5);
  for (const key of Object.keys(makeAttributes(0)) as (keyof Attributes)[]) {
    const bias = profile[key] ?? 0;
    attrs[key] = clamp(Math.round(opts.level + bias + noise()), 25, 99);
  }
  // Coerencia interna: uma especialidade puxa as vizinhas.
  const star = rng.next();
  if (star > 0.86) {
    const focus = rng.pick(['shooting', 'finishing', 'playmaking', 'defense'] as const);
    const boost = (k: keyof Attributes, v: number) => { attrs[k] = clamp((attrs[k] ?? 60) + v, 25, 99); };
    if (focus === 'shooting') { boost('threePoint', 9); boost('midRange', 7); boost('freeThrow', 6); boost('shotIQ', 5); }
    if (focus === 'finishing') { boost('drivingLayup', 8); boost('drivingDunk', 8); boost('vertical', 6); boost('drawFoul', 5); }
    if (focus === 'playmaking') { boost('passAccuracy', 8); boost('ballHandle', 8); boost('passIQ', 7); boost('passVision', 7); }
    if (focus === 'defense') { boost('perimeterDefense', 8); boost('interiorDefense', 7); boost('defensiveIQ', 7); boost('steal', 5); boost('block', 5); }
  }
  // Curva de idade: jovens tem menos QI, veteranos menos fisico.
  const iqShift = clamp((age - 24) * 1.1, -8, 8);
  for (const k of ['shotIQ', 'passIQ', 'defensiveIQ', 'helpDefenseIQ', 'discipline'] as (keyof Attributes)[]) {
    attrs[k] = clamp((attrs[k] ?? 60) + iqShift, 25, 99);
  }
  const physShift = age >= 31 ? -(age - 30) * 1.6 : age <= 21 ? -1.5 : 0;
  for (const k of ['speed', 'acceleration', 'vertical', 'agility', 'lateralQuickness', 'stamina'] as (keyof Attributes)[]) {
    attrs[k] = clamp((attrs[k] ?? 60) + physShift, 25, 99);
  }

  const player = makePlayer({
    id: opts.id ?? `p_${rng.int(100000, 999999)}`,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    position,
    heightInches,
    weightLbs,
    wingspanInches,
    style,
    attributes: attrs,
    age,
    jersey: rng.int(0, 56),
  });

  player.tendencies = tendenciesForStyle(style, {
    shootThree: clamp(30 + (player.attributes.threePoint - 55) * 1.15 + rng.normal(0, 7), 5, 95),
    drive: clamp(35 + (player.attributes.drivingLayup - 55) * 0.9 + rng.normal(0, 8), 5, 95),
    pass: clamp(35 + (player.attributes.passIQ - 55) * 0.9 + rng.normal(0, 8), 10, 95),
    postUp: clamp(10 + (player.attributes.postControl - 55) * 1.1 + rng.normal(0, 7), 2, 92),
  });

  player.potential = clampAttributes(makeAttributes(0, Object.fromEntries(
    (Object.keys(player.attributes) as (keyof Attributes)[]).map((k) => {
      const room = age <= 22 ? rng.range(4, 16) : age <= 25 ? rng.range(2, 9) : age <= 29 ? rng.range(0, 4) : 0;
      return [k, Math.min(99, player.attributes[k] + Math.round(room))];
    }),
  ) as Partial<Attributes>));

  player.badgeSlots = defaultSlotsFor(position);
  player.badges = autoBadges(rng, player);
  player.personality = {
    loyalty: Math.round(clamp(rng.normal(50, 18), 5, 95)),
    ambition: Math.round(clamp(rng.normal(55, 18), 5, 95)),
    ego: Math.round(clamp(rng.normal(45, 20), 5, 95)),
    workEthic: Math.round(clamp(rng.normal(58, 17), 5, 95)),
    leadership: Math.round(clamp(rng.normal(48, 18), 5, 95)),
    coachability: Math.round(clamp(rng.normal(56, 17), 5, 95)),
    marketPreference: rng.pick(['big', 'small', 'any', 'any'] as const),
    winNowPreference: Math.round(clamp(rng.normal(50 + (age - 26) * 2.5, 16), 5, 95)),
  };
  return player;
}

/** Equipa badges coerentes com o perfil, respeitando requisitos e slots. */
export function autoBadges(rng: Rng, p: PlayerProfile): BadgeLoadout {
  const loadout: BadgeLoadout = {};
  const used = { shooting: 0, finishing: 0, playmaking: 0, defense: 0, rebounding: 0, physicals: 0 };
  const candidates = BADGES
    .map((def) => ({ def, tier: maxTierFor(def, p.attributes) }))
    .filter((c) => c.tier > 0)
    .sort((a, b) => b.tier - a.tier);
  for (const c of candidates) {
    const cat = c.def.category;
    if (used[cat] + c.def.slotCost > p.badgeSlots[cat]) continue;
    // Um pouco de variedade: nem todo jogador maximiza.
    const tier = Math.max(1, Math.min(c.tier, Math.round(c.tier - rng.range(0, 1.2)))) as BadgeTier;
    loadout[c.def.id] = tier;
    used[cat] += c.def.slotCost;
  }
  return loadout;
}

export function generateCoach(rng: Rng, id: string): Coach {
  return {
    id,
    name: `${rng.pick(COACH_FIRST)} ${rng.pick(COACH_LAST)}`,
    offenseRating: Math.round(clamp(rng.normal(70, 12), 35, 98)),
    defenseRating: Math.round(clamp(rng.normal(70, 12), 35, 98)),
    development: Math.round(clamp(rng.normal(65, 14), 30, 98)),
    rotationDiscipline: Math.round(clamp(rng.normal(68, 13), 30, 98)),
    adaptability: Math.round(clamp(rng.normal(65, 15), 25, 98)),
    preferredGameplan: { ...DEFAULT_GAMEPLAN },
  };
}

export interface GenerateTeamOptions {
  id: string;
  city: string;
  name: string;
  abbreviation: string;
  conference: 'Leste' | 'Oeste';
  division: string;
  /** 0..1: qualidade do elenco. */
  strength: number;
}

const COLOR_SETS = [
  ['#1b3a6b', '#e8b84b', '#ffffff'], ['#7a1f2b', '#d9d2c5', '#12141a'], ['#0f6f4f', '#f2f0e6', '#1b1b1b'],
  ['#2b2f77', '#ff6b35', '#f5f5f5'], ['#5c2d91', '#f5c518', '#101014'], ['#0b6e99', '#8fd6ff', '#0d1117'],
  ['#8c3b0f', '#f0d9b5', '#1c1c1c'], ['#14532d', '#c8f169', '#0a0a0a'], ['#b3123f', '#ffd166', '#1a1a1a'],
  ['#28394d', '#7fd1b9', '#eaeaea'],
];

export function generateTeam(rng: Rng, opts: GenerateTeamOptions): Team {
  const colors = rng.pick(COLOR_SETS);
  const identity: TeamIdentity = {
    id: opts.id,
    city: opts.city,
    name: opts.name,
    abbreviation: opts.abbreviation,
    colors: { primary: colors[0], secondary: colors[1], accent: colors[2] },
    arena: rng.pick(ARENA_NAMES),
    conference: opts.conference,
    division: opts.division,
    marketSize: rng.pick(['big', 'mid', 'small'] as const),
  };

  // Curva do elenco: 1 estrela, 2 titulares bons, resto decai.
  const baseLevel = 58 + opts.strength * 18;
  const curve = [18, 10, 5, 1, -2, -4, -6, -8, -11, -13, -16, -19, -22, -25, -28];
  const needed: Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF', 'C', 'PG'];
  const roster: PlayerProfile[] = [];
  for (let i = 0; i < 15; i++) {
    const level = clamp(baseLevel + curve[i] + rng.normal(0, 3), 32, 96);
    const p = generatePlayer(rng, { level, position: needed[i], id: `${opts.id}_p${i}` });
    p.teamId = opts.id;
    p.jersey = i * 3 + rng.int(0, 3);
    roster.push(p);
  }
  roster.sort((a, b) => overall(b.attributes, b.position) - overall(a.attributes, a.position));

  const starters = pickStarters(roster);
  const team: Team = {
    identity,
    roster,
    starters: starters.map((p) => p.id),
    rotation: roster.slice(0, 10).map((p) => p.id),
    gameplan: { ...DEFAULT_GAMEPLAN },
    coach: generateCoach(rng, `${opts.id}_coach`),
    wins: 0,
    losses: 0,
    chemistry: 0.55 + rng.range(-0.1, 0.15),
  };
  team.gameplan = deriveGameplan(team);
  return team;
}

/** Escolhe 5 titulares cobrindo as posicoes, priorizando overall. */
export function pickStarters(roster: PlayerProfile[]): PlayerProfile[] {
  const byOvr = [...roster].sort((a, b) => overall(b.attributes, b.position) - overall(a.attributes, a.position));
  const chosen: PlayerProfile[] = [];
  const taken = new Set<string>();
  for (const pos of POSITIONS) {
    const pick = byOvr.find((p) => !taken.has(p.id) && p.position === pos);
    if (pick) {
      chosen.push(pick);
      taken.add(pick.id);
    }
  }
  for (const p of byOvr) {
    if (chosen.length >= 5) break;
    if (!taken.has(p.id)) {
      chosen.push(p);
      taken.add(p.id);
    }
  }
  return chosen.slice(0, 5);
}

export interface League {
  teams: Team[];
  season: number;
}

const DIVISIONS_EAST = ['Atlantico', 'Central', 'Sudeste'];
const DIVISIONS_WEST = ['Noroeste', 'Pacifico', 'Sudoeste'];

export function generateLeague(seed: number | string = 'courtside', teamCount = 30): League {
  const rng = new Rng(seed);
  const cities = rng.shuffle([...CITIES]).slice(0, teamCount);
  const names = rng.shuffle([...TEAM_NAMES]).slice(0, teamCount);
  const teams: Team[] = [];
  const usedAbbr = new Set<string>();
  for (let i = 0; i < teamCount; i++) {
    const conference: 'Leste' | 'Oeste' = i < teamCount / 2 ? 'Leste' : 'Oeste';
    const divs = conference === 'Leste' ? DIVISIONS_EAST : DIVISIONS_WEST;
    const division = divs[Math.floor((i % (teamCount / 2)) / (teamCount / 6))] ?? divs[0];
    let abbr = (cities[i].replace(/[^A-Za-z]/g, '').slice(0, 3) || 'TMX').toUpperCase();
    let n = 1;
    while (usedAbbr.has(abbr)) abbr = abbr.slice(0, 2) + String(n++);
    usedAbbr.add(abbr);
    teams.push(generateTeam(rng, {
      id: `t${i}`,
      city: cities[i],
      name: names[i],
      abbreviation: abbr,
      conference,
      division,
      strength: rng.next(),
    }));
  }
  return { teams, season: 1 };
}
