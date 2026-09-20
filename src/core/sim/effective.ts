/**
 * Atributos efetivos por frame.
 *
 * O atributo do perfil e o teto. O que o corpo entrega AGORA depende de
 * fadiga, adrenalina e takeover. E por isso que o mesmo jogador defende pior
 * no quarto periodo do que no primeiro sem que nenhum numero do perfil mude.
 */
import { Actor, TakeoverMeters } from './actor.js';
import { Attributes, ATTRIBUTE_KEYS, effectiveMass, standingReach, centerOfMass, inertiaFactor } from '../model/attributes.js';
import { Tuning } from '../config/tuning.js';
import { attr01, clamp, clamp01 } from '../math/util.js';
import { badgeValue } from '../model/badges.js';
import { badges } from './actor.js';

/** Atributos afetados por cada penalidade de fadiga. */
const FATIGUE_GROUPS: { keys: (keyof Attributes)[]; penalty: keyof Tuning['fatigue'] }[] = [
  { keys: ['speed', 'acceleration', 'agility', 'lateralQuickness', 'speedWithBall'], penalty: 'speedPenalty' },
  { keys: ['vertical', 'drivingDunk', 'standingDunk'], penalty: 'verticalPenalty' },
  { keys: ['closeShot', 'midRange', 'threePoint', 'freeThrow', 'drivingLayup'], penalty: 'shootingPenalty' },
  { keys: ['ballHandle', 'passAccuracy', 'hands', 'postControl'], penalty: 'controlPenalty' },
  { keys: ['defensiveIQ', 'helpDefenseIQ', 'steal', 'block', 'perimeterDefense', 'interiorDefense'], penalty: 'reactionPenalty' },
];

const TAKEOVER_KEYS: Record<keyof TakeoverMeters, (keyof Attributes)[]> = {
  shooting: ['closeShot', 'midRange', 'threePoint', 'freeThrow', 'shotIQ'],
  finishing: ['drivingLayup', 'drivingDunk', 'standingDunk', 'postControl', 'drawFoul', 'hands'],
  playmaking: ['passAccuracy', 'ballHandle', 'speedWithBall', 'passIQ', 'passVision'],
  defense: ['interiorDefense', 'perimeterDefense', 'steal', 'block', 'defensiveIQ', 'helpDefenseIQ', 'lateralQuickness'],
  rebounding: ['offensiveRebound', 'defensiveRebound'],
};

export function refreshEffective(a: Actor, t: Tuning): void {
  const base = a.profile.attributes;
  const eff = a.effective;
  const fatigue = 1 - clamp01(a.stamina); // 0 = fresco
  const adrenalineLack = 1 - clamp01(a.adrenaline / t.adrenaline.max);

  for (const k of ATTRIBUTE_KEYS) eff[k] = base[k];

  // Fadiga reduz por grupo. "Pernas de aco" devolve parte da perda de arremesso.
  const shotFatigueResist = badgeValue(badges(a), 'shot.fatigueResist');
  for (const group of FATIGUE_GROUPS) {
    let penalty = t.fatigue[group.penalty] as number;
    if (group.penalty === 'shootingPenalty') penalty *= 1 - clamp01(shotFatigueResist);
    const scale = 1 - penalty * fatigue;
    for (const k of group.keys) eff[k] = eff[k] * scale;
  }

  // Adrenalina zerada corta explosao (nao corta tecnica).
  const explosive = 1 - t.adrenaline.depletedPenalty * adrenalineLack * 0.5;
  for (const k of ['acceleration', 'vertical', 'speedWithBall', 'lateralQuickness'] as (keyof Attributes)[]) {
    eff[k] = eff[k] * explosive;
  }

  // Takeover ativo eleva sua disciplina.
  if (a.activeTakeover) {
    for (const k of TAKEOVER_KEYS[a.activeTakeover]) eff[k] = eff[k] * (1 + t.takeover.boost);
  }

  // Badges fisicas que mexem em capacidade bruta.
  const verticalBoost = badgeValue(badges(a), 'phys.verticalBoost');
  if (verticalBoost) eff.vertical *= 1 + verticalBoost;
  const strengthHold = badgeValue(badges(a), 'phys.strengthHold');
  if (strengthHold) eff.strength *= 1 + strengthHold * 0.25;

  for (const k of ATTRIBUTE_KEYS) eff[k] = clamp(eff[k], 20, 110);

  refreshPhysics(a, t);
}

export function refreshPhysics(a: Actor, t: Tuning): void {
  const L = t.locomotion;
  const p = a.profile.physique;
  const eff = a.effective;
  const ph = a.physics;
  ph.mass = effectiveMass(p, eff.strength);
  ph.reach = standingReach(p);
  ph.com = centerOfMass(p);
  ph.radius = 0.2 + p.shoulderWidth * 0.52;
  ph.topSpeed = L.topSpeedAt25 + attr01(eff.speed) * (L.topSpeedAt99 - L.topSpeedAt25);
  ph.accel = L.accelAt25 + attr01(eff.acceleration) * (L.accelAt99 - L.accelAt25);
  ph.brake = ph.accel * L.brakeFactor;
  ph.inertia = inertiaFactor(p, eff.strength, eff.agility, L.referenceMass, L.massInertiaScale);
  ph.turnRate = L.turnRateBase * (0.7 + attr01(eff.agility) * 0.6) / ph.inertia;
}

/** Velocidade maxima util no contexto atual (com bola, defendendo, cansado). */
export function contextTopSpeed(a: Actor, t: Tuning, mode: 'free' | 'ball' | 'defense' | 'backpedal'): number {
  const L = t.locomotion;
  let v = a.physics.topSpeed;
  if (mode === 'ball') {
    const swb = attr01(a.effective.speedWithBall);
    v *= L.dribbleSpeedFactor + swb * (1 - L.dribbleSpeedFactor) * 0.9;
    v *= 1 + badgeValue(badges(a), 'play.speedWithBall');
  } else if (mode === 'defense') {
    v *= L.lateralFactor + attr01(a.effective.lateralQuickness) * 0.28;
  } else if (mode === 'backpedal') {
    v *= L.backpedalFactor;
  }
  return v * (a.balance * 0.35 + 0.65);
}
