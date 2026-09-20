/**
 * Atributos do atleta (secao 42) e perfil fisico (secao 41).
 *
 * Regra do projeto: aparencia nao altera atributos. O fisico (altura, peso,
 * envergadura) altera FISICA (alcance, massa, inercia) e o CUSTO de progressao,
 * nunca o valor do atributo diretamente.
 */
import { attr01, attrScale, clamp, inchesToM, lbsToKg } from '../math/util.js';

export interface Attributes {
  // SHOOTING
  closeShot: number;
  midRange: number;
  threePoint: number;
  freeThrow: number;
  shotIQ: number;
  // FINISHING
  drivingLayup: number;
  drivingDunk: number;
  standingDunk: number;
  postControl: number;
  drawFoul: number;
  hands: number;
  // PLAYMAKING
  passAccuracy: number;
  ballHandle: number;
  speedWithBall: number;
  passIQ: number;
  passVision: number;
  // DEFENSE
  interiorDefense: number;
  perimeterDefense: number;
  steal: number;
  block: number;
  defensiveIQ: number;
  helpDefenseIQ: number;
  lateralQuickness: number;
  // REBOUNDING
  offensiveRebound: number;
  defensiveRebound: number;
  // PHYSICALS
  speed: number;
  acceleration: number;
  strength: number;
  vertical: number;
  stamina: number;
  agility: number;
  hustle: number;
  durability: number;
  discipline: number;
}

export const ATTRIBUTE_KEYS: (keyof Attributes)[] = [
  'closeShot', 'midRange', 'threePoint', 'freeThrow', 'shotIQ',
  'drivingLayup', 'drivingDunk', 'standingDunk', 'postControl', 'drawFoul', 'hands',
  'passAccuracy', 'ballHandle', 'speedWithBall', 'passIQ', 'passVision',
  'interiorDefense', 'perimeterDefense', 'steal', 'block', 'defensiveIQ', 'helpDefenseIQ', 'lateralQuickness',
  'offensiveRebound', 'defensiveRebound',
  'speed', 'acceleration', 'strength', 'vertical', 'stamina', 'agility', 'hustle', 'durability', 'discipline',
];

export type AttributeCategory = 'shooting' | 'finishing' | 'playmaking' | 'defense' | 'rebounding' | 'physicals';

export const ATTRIBUTE_CATEGORY: Record<keyof Attributes, AttributeCategory> = {
  closeShot: 'shooting', midRange: 'shooting', threePoint: 'shooting', freeThrow: 'shooting', shotIQ: 'shooting',
  drivingLayup: 'finishing', drivingDunk: 'finishing', standingDunk: 'finishing', postControl: 'finishing', drawFoul: 'finishing', hands: 'finishing',
  passAccuracy: 'playmaking', ballHandle: 'playmaking', speedWithBall: 'playmaking', passIQ: 'playmaking', passVision: 'playmaking',
  interiorDefense: 'defense', perimeterDefense: 'defense', steal: 'defense', block: 'defense', defensiveIQ: 'defense', helpDefenseIQ: 'defense', lateralQuickness: 'defense',
  offensiveRebound: 'rebounding', defensiveRebound: 'rebounding',
  speed: 'physicals', acceleration: 'physicals', strength: 'physicals', vertical: 'physicals', stamina: 'physicals', agility: 'physicals', hustle: 'physicals', durability: 'physicals', discipline: 'physicals',
};

export const ATTRIBUTE_LABELS: Record<keyof Attributes, string> = {
  closeShot: 'Arremesso curto', midRange: 'Meia-distancia', threePoint: 'Tres pontos', freeThrow: 'Lance livre', shotIQ: 'QI de arremesso',
  drivingLayup: 'Bandeja em movimento', drivingDunk: 'Enterrada em movimento', standingDunk: 'Enterrada parado', postControl: 'Jogo de costas', drawFoul: 'Provocar falta', hands: 'Maos',
  passAccuracy: 'Precisao de passe', ballHandle: 'Controle de bola', speedWithBall: 'Velocidade com bola', passIQ: 'QI de passe', passVision: 'Visao de jogo',
  interiorDefense: 'Defesa interior', perimeterDefense: 'Defesa de perimetro', steal: 'Roubo', block: 'Toco', defensiveIQ: 'QI defensivo', helpDefenseIQ: 'QI de ajuda', lateralQuickness: 'Agilidade lateral',
  offensiveRebound: 'Rebote ofensivo', defensiveRebound: 'Rebote defensivo',
  speed: 'Velocidade', acceleration: 'Aceleracao', strength: 'Forca', vertical: 'Impulsao', stamina: 'Resistencia', agility: 'Agilidade', hustle: 'Empenho', durability: 'Durabilidade', discipline: 'Disciplina',
};

export function makeAttributes(base = 60, overrides: Partial<Attributes> = {}): Attributes {
  const a = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) a[k] = base;
  return Object.assign(a, overrides);
}

export function clampAttributes(a: Attributes, lo = 25, hi = 99): Attributes {
  const out = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = Math.round(clamp(a[k], lo, hi));
  return out;
}

/** Perfil fisico. Guardado em unidades SI; a UI converte para pes/polegadas. */
export interface Physique {
  /** metros */
  height: number;
  /** quilos */
  weight: number;
  /** metros, ponta a ponta */
  wingspan: number;
  /** 0..1, afeta centro de massa e alcance de bandeja */
  torsoRatio: number;
  shoulderWidth: number;
  handSize: number;
  /** Mao dominante. A mao fraca custa controle em certos moves. */
  handedness: 'left' | 'right';
}

export function makePhysique(heightInches: number, weightLbs: number, wingspanInches?: number, overrides: Partial<Physique> = {}): Physique {
  const h = inchesToM(heightInches);
  return {
    height: h,
    weight: lbsToKg(weightLbs),
    wingspan: inchesToM(wingspanInches ?? heightInches + 3),
    torsoRatio: 0.52,
    shoulderWidth: 0.42 + (heightInches - 72) * 0.004,
    handSize: 0.21 + (heightInches - 72) * 0.002,
    handedness: 'right',
    ...overrides,
  };
}

/** Alcance em pe com o braco estendido (m). Base para contest, toco e enterrada. */
export function standingReach(p: Physique): number {
  return p.height * 0.87 + p.wingspan * 0.42;
}

/** Massa efetiva para colisoes: peso + rigidez do core (strength). */
export function effectiveMass(p: Physique, strength: number): number {
  return p.weight * (0.9 + attr01(strength) * 0.22);
}

/** Centro de massa (m do chao) - mais baixo = mais estavel em contato. */
export function centerOfMass(p: Physique): number {
  return p.height * (0.52 + (p.torsoRatio - 0.52) * 0.3);
}

/** Momento de inercia relativo (quanto custa girar/inverter direcao). */
export function inertiaFactor(p: Physique, strength: number, agility: number, referenceMass: number, scale: number): number {
  const massTerm = 1 + ((effectiveMass(p, strength) - referenceMass) / referenceMass) * scale;
  const agilityTerm = 1 / attrScale(agility, 0.3);
  return Math.max(0.55, massTerm * agilityTerm);
}

/** Salto vertical (m) considerando atributo, fadiga e adrenalina. */
export function verticalLeap(vertical: number, at99: number, at25: number, fatigue01: number, fatiguePenalty: number, adrenaline01: number, adrenalinePenalty: number): number {
  const base = at25 + attr01(vertical) * (at99 - at25);
  const fatigued = base * (1 - fatiguePenalty * (1 - fatigue01));
  const drained = fatigued * (1 - adrenalinePenalty * (1 - adrenaline01) * 0.5);
  return Math.max(0.16, drained);
}

/** Altura maxima alcancada pela mao em salto maximo. */
export function maxReachHeight(p: Physique, vertical: number, at99: number, at25: number, fatigue01 = 1, fatiguePenalty = 0, adrenaline01 = 1, adrenalinePenalty = 0): number {
  return standingReach(p) + verticalLeap(vertical, at99, at25, fatigue01, fatiguePenalty, adrenaline01, adrenalinePenalty);
}

/** Overall ponderado por posicao - somente apresentacao, nunca usado na fisica. */
export function overall(a: Attributes, pos: Position): number {
  const w = OVERALL_WEIGHTS[pos];
  let total = 0;
  let wsum = 0;
  for (const key of Object.keys(w) as (keyof Attributes)[]) {
    const weight = w[key] ?? 0;
    total += a[key] * weight;
    wsum += weight;
  }
  return Math.round(clamp(total / Math.max(1e-6, wsum), 25, 99));
}

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

type WeightMap = Partial<Record<keyof Attributes, number>>;

export const OVERALL_WEIGHTS: Record<Position, WeightMap> = {
  PG: { ballHandle: 1.1, passAccuracy: 1.1, passIQ: 0.9, threePoint: 1.2, midRange: 0.8, drivingLayup: 0.9, speedWithBall: 1, speed: 0.9, acceleration: 0.8, perimeterDefense: 0.8, steal: 0.6, defensiveIQ: 0.6, shotIQ: 0.6, closeShot: 0.4 },
  SG: { threePoint: 1.3, midRange: 1, drivingLayup: 1, drivingDunk: 0.7, ballHandle: 0.9, passAccuracy: 0.6, perimeterDefense: 0.9, steal: 0.6, speed: 0.8, acceleration: 0.8, shotIQ: 0.7, defensiveIQ: 0.6, closeShot: 0.5 },
  SF: { threePoint: 1.1, midRange: 0.9, drivingLayup: 1, drivingDunk: 0.9, perimeterDefense: 1, defensiveRebound: 0.7, ballHandle: 0.7, passAccuracy: 0.6, strength: 0.6, speed: 0.7, defensiveIQ: 0.7, closeShot: 0.6, block: 0.4 },
  PF: { closeShot: 0.9, midRange: 0.7, threePoint: 0.8, standingDunk: 0.9, drivingDunk: 0.7, postControl: 0.8, interiorDefense: 1.1, defensiveRebound: 1.2, offensiveRebound: 0.8, strength: 0.9, block: 0.8, defensiveIQ: 0.7, vertical: 0.5 },
  C: { closeShot: 1, standingDunk: 1.1, postControl: 0.9, interiorDefense: 1.3, block: 1.1, defensiveRebound: 1.3, offensiveRebound: 1, strength: 1.1, defensiveIQ: 0.8, hands: 0.6, midRange: 0.4, threePoint: 0.45, vertical: 0.6 },
};

/** Melhor posicao natural dado o fisico e os atributos. */
export function naturalPosition(a: Attributes, p: Physique): Position {
  let best: Position = 'SF';
  let bestScore = -Infinity;
  for (const pos of POSITIONS) {
    const heightFit = 1 - Math.abs(p.height - POSITION_IDEAL_HEIGHT[pos]) / 0.35;
    const score = overall(a, pos) * 0.02 + heightFit;
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
  }
  return best;
}

export const POSITION_IDEAL_HEIGHT: Record<Position, number> = {
  PG: inchesToM(74),
  SG: inchesToM(77),
  SF: inchesToM(80),
  PF: inchesToM(82),
  C: inchesToM(84),
};
