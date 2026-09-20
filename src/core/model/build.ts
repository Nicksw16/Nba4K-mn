/**
 * MyPLAYER BUILDER (secoes 41, 42, 47, 48, 49, 50).
 *
 * Regras:
 *  - Aparencia nao muda atributo nenhum. O FISICO muda o CUSTO de cada atributo
 *    e a fisica do corpo (alcance, massa, inercia).
 *  - Um pivo de 2,13 m paga barato em rebote/toco e caro em drible/velocidade.
 *    Um armador de 1,85 m paga o inverso. Esse e o tradeoff real do builder.
 *  - O preview de cap breakers e calculado antes de confirmar (secao 48).
 */
import { Attributes, ATTRIBUTE_CATEGORY, ATTRIBUTE_KEYS, AttributeCategory, Physique, Position, clampAttributes, makeAttributes, makePhysique, naturalPosition } from './attributes.js';
import { BadgeSlots, emptySlots } from './badges.js';
import { PlayStyle, tendenciesForStyle } from './tendencies.js';
import { PlayerProfile, defaultSlotsFor } from './player.js';
import { clamp, inchesToM, lbsToKg } from '../math/util.js';

export interface BuildInput {
  name: { first: string; last: string };
  position: Position;
  heightInches: number;
  weightLbs: number;
  wingspanInches: number;
  style: PlayStyle;
  /** Valores-alvo 25..99 por atributo. */
  targets: Partial<Attributes>;
  handedness?: 'left' | 'right';
}

/** Orcamento base de pontos de build. */
export const BUILD_BUDGET = 3600;

/** Custo por ponto de atributo, crescente em faixas (evita "tudo 99"). */
export function pointCost(from: number, to: number, multiplier: number): number {
  let cost = 0;
  for (let v = from; v < to; v++) {
    const band = v < 60 ? 1 : v < 70 ? 1.6 : v < 80 ? 2.6 : v < 88 ? 4.2 : v < 93 ? 6.4 : 9.5;
    cost += band * multiplier;
  }
  return Math.round(cost);
}

/**
 * Multiplicador de custo por atributo dado o fisico.
 * 1.0 = neutro. >1 caro. <1 barato.
 */
export function costMultipliers(physique: Physique): Record<keyof Attributes, number> {
  const hIn = physique.height / inchesToM(1);
  const wLbs = physique.weight / lbsToKg(1);
  const wsIn = physique.wingspan / inchesToM(1);
  // Desvios normalizados em relacao a um ala de 1,98 m / 100 kg.
  const tall = (hIn - 78) / 8; // +1 = ~2,03 m
  const heavy = (wLbs - 220) / 55;
  const longArms = (wsIn - hIn - 3) / 6;

  const m = {} as Record<keyof Attributes, number>;
  for (const k of ATTRIBUTE_KEYS) m[k] = 1;

  const bump = (k: keyof Attributes, v: number) => {
    m[k] = clamp(m[k] + v, 0.55, 2.4);
  };

  // Altura: barato por dentro, caro por fora.
  bump('standingDunk', -0.34 * tall);
  bump('interiorDefense', -0.3 * tall);
  bump('block', -0.32 * tall);
  bump('offensiveRebound', -0.3 * tall);
  bump('defensiveRebound', -0.32 * tall);
  bump('postControl', -0.26 * tall);
  bump('closeShot', -0.14 * tall);
  bump('ballHandle', 0.4 * tall);
  bump('speedWithBall', 0.34 * tall);
  bump('threePoint', 0.26 * tall);
  bump('passAccuracy', 0.2 * tall);
  bump('perimeterDefense', 0.22 * tall);
  bump('lateralQuickness', 0.26 * tall);
  bump('speed', 0.28 * tall);
  bump('agility', 0.3 * tall);
  bump('drivingLayup', 0.16 * tall);

  // Peso: forca barata, explosao cara.
  bump('strength', -0.42 * heavy);
  bump('interiorDefense', -0.14 * heavy);
  bump('offensiveRebound', -0.1 * heavy);
  bump('vertical', 0.38 * heavy);
  bump('speed', 0.3 * heavy);
  bump('acceleration', 0.34 * heavy);
  bump('agility', 0.3 * heavy);
  bump('stamina', 0.22 * heavy);
  bump('lateralQuickness', 0.2 * heavy);

  // Envergadura: defesa e finalizacao baratas, arremesso caro.
  bump('block', -0.3 * longArms);
  bump('steal', -0.16 * longArms);
  bump('perimeterDefense', -0.18 * longArms);
  bump('interiorDefense', -0.16 * longArms);
  bump('drivingLayup', -0.12 * longArms);
  bump('defensiveRebound', -0.14 * longArms);
  bump('threePoint', 0.3 * longArms);
  bump('midRange', 0.24 * longArms);
  bump('freeThrow', 0.16 * longArms);

  return m;
}

export interface BuildResult {
  ok: boolean;
  spent: number;
  budget: number;
  remaining: number;
  attributes: Attributes;
  physique: Physique;
  perAttributeCost: Partial<Record<keyof Attributes, number>>;
  maxPossible: Partial<Record<keyof Attributes, number>>;
  problems: string[];
  badgeSlots: BadgeSlots;
}

const FLOOR = 25;

/** Calcula custo, limites e slots de badge resultantes de um build. */
export function evaluateBuild(input: BuildInput, budget = BUILD_BUDGET): BuildResult {
  const physique = makePhysique(input.heightInches, input.weightLbs, input.wingspanInches, {
    handedness: input.handedness ?? 'right',
  });
  const mult = costMultipliers(physique);
  const attrs = makeAttributes(FLOOR, input.targets);
  const clamped = clampAttributes(attrs);
  const perAttributeCost: Partial<Record<keyof Attributes, number>> = {};
  let spent = 0;
  for (const k of ATTRIBUTE_KEYS) {
    const c = pointCost(FLOOR, clamped[k], mult[k]);
    perAttributeCost[k] = c;
    spent += c;
  }
  const problems: string[] = [];
  if (spent > budget) problems.push(`Orcamento estourado em ${spent - budget} pontos.`);
  if (input.wingspanInches < input.heightInches - 4) problems.push('Envergadura minima: altura - 4 polegadas.');
  if (input.wingspanInches > input.heightInches + 10) problems.push('Envergadura maxima: altura + 10 polegadas.');

  // Maximo alcancavel por atributo gastando todo o restante nele.
  const remaining = budget - spent;
  const maxPossible: Partial<Record<keyof Attributes, number>> = {};
  for (const k of ATTRIBUTE_KEYS) {
    let v = clamped[k];
    let pool = remaining;
    while (v < 99) {
      const step = pointCost(v, v + 1, mult[k]);
      if (step > pool) break;
      pool -= step;
      v++;
    }
    maxPossible[k] = v;
  }

  return {
    ok: problems.length === 0,
    spent,
    budget,
    remaining,
    attributes: clamped,
    physique,
    perAttributeCost,
    maxPossible,
    problems,
    badgeSlots: slotsForBuild(clamped, input.position),
  };
}

/** Slots de badge derivados do build: atributos altos em uma categoria dao mais slots. */
export function slotsForBuild(attrs: Attributes, pos: Position): BadgeSlots {
  const base = defaultSlotsFor(pos);
  const out = emptySlots();
  const cats: AttributeCategory[] = ['shooting', 'finishing', 'playmaking', 'defense', 'rebounding', 'physicals'];
  for (const cat of cats) {
    const keys = ATTRIBUTE_KEYS.filter((k) => ATTRIBUTE_CATEGORY[k] === cat);
    const best = Math.max(...keys.map((k) => attrs[k]));
    const bonus = best >= 92 ? 3 : best >= 85 ? 2 : best >= 78 ? 1 : 0;
    out[cat] = base[cat] + bonus;
  }
  return out;
}

export function buildToPlayer(input: BuildInput, id: string, result?: BuildResult): PlayerProfile {
  const r = result ?? evaluateBuild(input);
  const position = input.position ?? naturalPosition(r.attributes, r.physique);
  return {
    id,
    firstName: input.name.first,
    lastName: input.name.last,
    jersey: 0,
    position,
    secondaryPosition: position,
    age: 19,
    experience: 0,
    attributes: r.attributes,
    potential: clampAttributes(makeAttributes(0, Object.fromEntries(
      ATTRIBUTE_KEYS.map((k) => [k, Math.min(99, r.maxPossible[k] ?? r.attributes[k])]),
    ) as Partial<Attributes>)),
    physique: r.physique,
    tendencies: tendenciesForStyle(input.style),
    badges: {},
    badgeSlots: r.badgeSlots,
    loadouts: [
      { name: 'Principal', badges: {} },
      { name: 'Defensivo', badges: {} },
      { name: 'Criacao', badges: {} },
      { name: 'Matchup', badges: {} },
    ],
    activeLoadout: 0,
    signature: {
      dribbleMoves: ['crossover', 'between_legs', 'hesitation', 'stepback'],
      jumpshot: 'base_a',
      dunkPackage: 'standard',
      layupPackage: 'standard',
      movementStyle: input.style,
    },
    personality: { loyalty: 55, ambition: 70, ego: 45, workEthic: 70, leadership: 50, coachability: 65, marketPreference: 'any', winNowPreference: 55 },
    health: { condition: 1 },
    origin: 'user',
  };
}

/** SIGNATURE BLUEPRINTS (secao 47): builds prontos, todos originais. */
export interface Blueprint {
  id: string;
  name: string;
  description: string;
  archetypes: [string, string, string];
  input: BuildInput;
}

const bp = (
  id: string,
  name: string,
  description: string,
  archetypes: [string, string, string],
  position: Position,
  heightInches: number,
  weightLbs: number,
  wingspanInches: number,
  style: PlayStyle,
  targets: Partial<Attributes>,
): Blueprint => ({
  id, name, description, archetypes,
  input: { name: { first: 'Novo', last: 'Atleta' }, position, heightInches, weightLbs, wingspanInches, style, targets },
});

export const BLUEPRINTS: Blueprint[] = [
  bp('two_way_engine', 'O Motor de Duas Vias', 'Cria vantagem com o drible e apaga o melhor perimetro adversario.',
    ['Criador', 'Travador', 'Motor'], 'SG', 77, 205, 82, 'shifty_shot_creator', {
      threePoint: 86, midRange: 82, closeShot: 78, freeThrow: 82, shotIQ: 84,
      drivingLayup: 84, drivingDunk: 76, hands: 78, drawFoul: 76,
      ballHandle: 88, passAccuracy: 78, speedWithBall: 84, passIQ: 76, passVision: 74,
      perimeterDefense: 86, steal: 80, defensiveIQ: 82, lateralQuickness: 85, block: 55,
      defensiveRebound: 62, offensiveRebound: 45,
      speed: 85, acceleration: 86, agility: 86, strength: 70, vertical: 78, stamina: 88, hustle: 80, durability: 75, discipline: 72,
    }),
  bp('point_forward', 'O Ala-Armador', 'Um corpo de ala com cabeca de armador: mismatch permanente.',
    ['Distribuidor', 'Mismatch', 'Conector'], 'SF', 80, 225, 85, 'point_forward', {
      threePoint: 80, midRange: 78, closeShot: 80, freeThrow: 78, shotIQ: 84,
      drivingLayup: 84, drivingDunk: 80, postControl: 74, hands: 82,
      ballHandle: 84, passAccuracy: 90, speedWithBall: 78, passIQ: 88, passVision: 88,
      perimeterDefense: 78, defensiveIQ: 82, helpDefenseIQ: 80, steal: 72, block: 62, lateralQuickness: 74,
      defensiveRebound: 78, offensiveRebound: 60,
      speed: 76, acceleration: 76, agility: 76, strength: 78, vertical: 74, stamina: 85, hustle: 76, durability: 78, discipline: 76,
    }),
  bp('slashing_wing', 'A Ala Cortante', 'Vive no aro, corta sem bola e finaliza em contato.',
    ['Infiltrador', 'Cortador', 'Finalizador'], 'SF', 79, 215, 84, 'explosive_slasher', {
      threePoint: 70, midRange: 72, closeShot: 86, freeThrow: 74, shotIQ: 72,
      drivingLayup: 92, drivingDunk: 92, standingDunk: 78, hands: 80, drawFoul: 84,
      ballHandle: 76, passAccuracy: 68, speedWithBall: 80, passIQ: 66,
      perimeterDefense: 78, steal: 74, defensiveIQ: 74, lateralQuickness: 78, block: 66,
      defensiveRebound: 70, offensiveRebound: 68,
      speed: 88, acceleration: 90, agility: 86, strength: 76, vertical: 92, stamina: 86, hustle: 84, durability: 76, discipline: 66,
    }),
  bp('floor_general', 'O General de Quadra', 'Controla ritmo, le cobertura e entrega a bola no lugar certo.',
    ['Cerebro', 'Pick & Roll', 'Atirador'], 'PG', 74, 190, 78, 'cerebral_floor_general', {
      threePoint: 88, midRange: 84, closeShot: 76, freeThrow: 88, shotIQ: 88,
      drivingLayup: 82, drivingDunk: 58, hands: 78, drawFoul: 74,
      ballHandle: 90, passAccuracy: 92, speedWithBall: 86, passIQ: 92, passVision: 90,
      perimeterDefense: 70, steal: 76, defensiveIQ: 80, lateralQuickness: 78,
      defensiveRebound: 52, offensiveRebound: 38,
      speed: 84, acceleration: 86, agility: 84, strength: 60, vertical: 66, stamina: 90, hustle: 74, durability: 76, discipline: 82,
    }),
  bp('interior_anchor', 'A Ancora Interior', 'Protege o aro, domina o vidro e finaliza tudo no garrafao.',
    ['Protetor', 'Reboteiro', 'Finalizador'], 'C', 84, 260, 90, 'defensive_anchor', {
      closeShot: 84, midRange: 58, threePoint: 40, freeThrow: 68, shotIQ: 70,
      standingDunk: 94, drivingDunk: 82, postControl: 82, hands: 82, drawFoul: 70,
      passAccuracy: 66, ballHandle: 48, passIQ: 68,
      interiorDefense: 94, block: 92, defensiveIQ: 88, helpDefenseIQ: 88, perimeterDefense: 62, lateralQuickness: 62, steal: 55,
      defensiveRebound: 94, offensiveRebound: 86,
      speed: 62, acceleration: 64, agility: 60, strength: 92, vertical: 80, stamina: 82, hustle: 84, durability: 82, discipline: 74,
    }),
  bp('stretch_five', 'O Pivo que Abre a Quadra', 'Puxa o protetor de aro para fora e ainda defende o garrafao.',
    ['Espaco', 'Protetor', 'Bloqueio'], 'C', 83, 245, 88, 'stretch_big', {
      closeShot: 80, midRange: 80, threePoint: 84, freeThrow: 80, shotIQ: 78,
      standingDunk: 84, drivingDunk: 72, postControl: 70, hands: 78,
      passAccuracy: 74, ballHandle: 58, passIQ: 74,
      interiorDefense: 82, block: 84, defensiveIQ: 82, helpDefenseIQ: 80, perimeterDefense: 66, lateralQuickness: 66,
      defensiveRebound: 86, offensiveRebound: 70,
      speed: 66, acceleration: 66, agility: 64, strength: 82, vertical: 74, stamina: 82, hustle: 76, durability: 78, discipline: 78,
    }),
  bp('iso_maestro', 'O Maestro da Isolacao', 'Um contra um em qualquer lugar acima da linha de lance livre.',
    ['Isolacao', 'Stepback', 'Meia-Distancia'], 'SG', 78, 215, 82, 'isolation_scorer', {
      threePoint: 88, midRange: 92, closeShot: 82, freeThrow: 88, shotIQ: 86,
      drivingLayup: 84, drivingDunk: 78, postControl: 70, hands: 78, drawFoul: 86,
      ballHandle: 90, passAccuracy: 72, speedWithBall: 84, passIQ: 68,
      perimeterDefense: 68, steal: 66, defensiveIQ: 70, lateralQuickness: 70,
      defensiveRebound: 60, offensiveRebound: 40,
      speed: 80, acceleration: 82, agility: 84, strength: 74, vertical: 76, stamina: 88, hustle: 68, durability: 78, discipline: 70,
    }),
  bp('three_and_d', 'O Conector 3&D', 'Nao precisa da bola para decidir o jogo.',
    ['Canto', 'Travador', 'Conector'], 'SF', 79, 210, 85, 'connector_3d', {
      threePoint: 88, midRange: 74, closeShot: 76, freeThrow: 82, shotIQ: 80,
      drivingLayup: 76, drivingDunk: 76, hands: 80,
      passAccuracy: 74, ballHandle: 68, passIQ: 74, passVision: 72,
      perimeterDefense: 90, steal: 80, defensiveIQ: 86, helpDefenseIQ: 84, lateralQuickness: 88, block: 68,
      defensiveRebound: 74, offensiveRebound: 52,
      speed: 82, acceleration: 82, agility: 84, strength: 76, vertical: 78, stamina: 88, hustle: 86, durability: 80, discipline: 82,
    }),
  bp('power_guard', 'O Armador de Forca', 'Entra no contato de proposito e termina do outro lado.',
    ['Forca', 'Contato', 'Finalizacao'], 'PG', 76, 215, 81, 'power_guard', {
      threePoint: 78, midRange: 80, closeShot: 84, freeThrow: 80, shotIQ: 78,
      drivingLayup: 88, drivingDunk: 80, postControl: 68, hands: 78, drawFoul: 88,
      ballHandle: 84, passAccuracy: 82, speedWithBall: 82, passIQ: 80,
      perimeterDefense: 80, steal: 74, defensiveIQ: 78, lateralQuickness: 76,
      defensiveRebound: 70, offensiveRebound: 56,
      speed: 80, acceleration: 82, agility: 78, strength: 88, vertical: 78, stamina: 88, hustle: 82, durability: 82, discipline: 72,
    }),
  bp('rim_runner', 'O Corredor de Aro', 'Corre a quadra inteira, bloqueia e termina em cima.',
    ['Transicao', 'Bloqueio', 'Lob'], 'PF', 82, 235, 88, 'rim_runner', {
      closeShot: 82, midRange: 58, threePoint: 42, freeThrow: 66, shotIQ: 70,
      standingDunk: 90, drivingDunk: 90, postControl: 62, hands: 84,
      passAccuracy: 64, ballHandle: 55, passIQ: 66,
      interiorDefense: 84, block: 86, defensiveIQ: 80, helpDefenseIQ: 80, perimeterDefense: 68, lateralQuickness: 72,
      defensiveRebound: 86, offensiveRebound: 84,
      speed: 80, acceleration: 80, agility: 74, strength: 84, vertical: 90, stamina: 86, hustle: 88, durability: 80, discipline: 74,
    }),
  bp('post_technician', 'O Tecnico de Poste', 'Jogo de costas, footwork e leitura de dobra.',
    ['Poste', 'Passe', 'Vidro'], 'PF', 82, 250, 87, 'post_scorer', {
      closeShot: 88, midRange: 80, threePoint: 58, freeThrow: 76, shotIQ: 84,
      standingDunk: 86, drivingDunk: 74, postControl: 92, hands: 84, drawFoul: 80,
      passAccuracy: 80, ballHandle: 62, passIQ: 82, passVision: 76,
      interiorDefense: 84, block: 76, defensiveIQ: 82, helpDefenseIQ: 78, perimeterDefense: 64,
      defensiveRebound: 88, offensiveRebound: 80,
      speed: 66, acceleration: 68, agility: 66, strength: 90, vertical: 72, stamina: 82, hustle: 78, durability: 80, discipline: 78,
    }),
  bp('movement_sniper', 'O Atirador em Movimento', 'Nunca para de correr sem a bola.',
    ['Movimento', 'Catch & Shoot', 'Corte'], 'SG', 76, 195, 79, 'movement_shooter', {
      threePoint: 94, midRange: 86, closeShot: 78, freeThrow: 90, shotIQ: 88,
      drivingLayup: 78, drivingDunk: 62, hands: 82,
      passAccuracy: 76, ballHandle: 78, speedWithBall: 76, passIQ: 76,
      perimeterDefense: 72, steal: 70, defensiveIQ: 76, lateralQuickness: 76,
      defensiveRebound: 56, offensiveRebound: 40,
      speed: 84, acceleration: 84, agility: 88, strength: 64, vertical: 70, stamina: 92, hustle: 86, durability: 76, discipline: 80,
    }),
];

/** CAP BREAKERS (secao 48): pontos extras acima do teto inicial. */
export interface CapBreaker {
  attribute: keyof Attributes;
  amount: number;
}

export interface CapBreakerPreview {
  before: number;
  after: number;
  costPoints: number;
  allowed: boolean;
  reason?: string;
}

export function previewCapBreaker(p: PlayerProfile, attribute: keyof Attributes, amount: number, availableBreakers: number): CapBreakerPreview {
  const before = p.attributes[attribute];
  const after = Math.min(99, before + amount);
  const allowed = availableBreakers >= amount && after > before;
  return {
    before,
    after,
    costPoints: amount,
    allowed,
    reason: allowed ? undefined : after === before ? 'Atributo ja esta no maximo.' : 'Cap breakers insuficientes.',
  };
}

export function applyCapBreaker(p: PlayerProfile, attribute: keyof Attributes, amount: number): void {
  p.attributes[attribute] = Math.min(99, p.attributes[attribute] + amount);
  p.potential[attribute] = Math.max(p.potential[attribute], p.attributes[attribute]);
}

/** REBIRTH (secao 49): um novo build herda parte do progresso. */
export interface RebirthResult {
  carriedBadgeTokens: BadgeSlots;
  startingLevel: number;
  attributeHeadStart: number;
  note: string;
}

export function rebirth(previousLevel: number, previousTokens: BadgeSlots, previousRebirths: number): RebirthResult {
  const carry = Math.max(0.25, 0.55 - previousRebirths * 0.06);
  const carried = emptySlots();
  for (const k of Object.keys(carried) as (keyof BadgeSlots)[]) {
    carried[k] = Math.floor(previousTokens[k] * carry);
  }
  return {
    carriedBadgeTokens: carried,
    startingLevel: Math.max(1, Math.floor(previousLevel * carry)),
    attributeHeadStart: Math.round(previousLevel * carry * 1.5),
    note: `Rebirth #${previousRebirths + 1}: ${Math.round(carry * 100)}% do progresso herdado.`,
  };
}
