/**
 * FADIGA E ADRENALINA (secoes 25, 26).
 *
 * Duas reservas distintas:
 *  - STAMINA: reserva longa. Cai ao longo do jogo e muda o que o corpo entrega
 *    (velocidade, salto, precisao, controle, reacao). Recupera devagar em
 *    quadra e rapido no banco.
 *  - ADRENALINA: reserva curta de EXPLOSAO. Sprints e moves explosivos gastam;
 *    recupera em segundos. Sem adrenalina o atleta ainda corre, mas perde o
 *    primeiro passo - e o que impede o spam de moves.
 */
import { clamp01, lerp } from '../math/util.js';
import { Actor, bv } from './actor.js';
import { Tuning } from '../config/tuning.js';
import { len2 } from '../math/vec.js';
import { staminaDrainScale } from './actor.js';

export interface FatigueInput {
  sprinting: boolean;
  defending: boolean;
  /** Contato acumulado no frame (0..1). */
  contact: number;
  onCourt: boolean;
}

export function stepFatigue(a: Actor, input: FatigueInput, dt: number, t: Tuning): void {
  const F = t.fatigue;
  const scale = staminaDrainScale(a, t);
  const efficiency = 1 - clamp01(bv(a, 'phys.staminaCost'));
  const speed = len2(a.vel);
  const speedFrac = clamp01(speed / Math.max(1, a.physics.topSpeed));

  if (!input.onCourt) {
    a.stamina = clamp01(a.stamina + F.recoverBench * dt);
    a.adrenaline = clamp01(a.adrenaline + t.adrenaline.regenPerSec * 2 * dt);
    return;
  }

  let drain = 0;
  if (input.sprinting && speedFrac > 0.6) drain += F.sprintDrain * speedFrac;
  else if (speedFrac > 0.25) drain += F.sprintDrain * 0.35 * speedFrac;
  if (input.defending) drain += F.defenseDrain * (0.4 + speedFrac * 0.8);
  if (a.hasBall) drain += F.moveDrain * 0.35;
  drain += F.contactDrain * input.contact;

  drain *= scale * efficiency;

  if (drain > 0) a.stamina = clamp01(a.stamina - drain * dt * 60 * 0.0166);

  // Recuperacao: parado recupera mais.
  const idleBonus = speedFrac < 0.15 ? F.recoverIdle : F.recoverOnCourt;
  const recovery = idleBonus * dt * (0.7 + clamp01(a.effective.stamina / 99) * 0.6);
  a.stamina = clamp01(a.stamina + recovery * (1 - clamp01(drain * 40)));

  // Adrenalina
  const A = t.adrenaline;
  const regenBadge = bv(a, 'phys.adrenalineRegen');
  let adrDrain = 0;
  if (input.sprinting && speedFrac > 0.65) adrDrain += A.sprintCost * dt;
  a.adrenaline = clamp01(a.adrenaline - adrDrain);
  const regen = (A.regenPerSec + (speedFrac < 0.2 ? A.regenIdleBonus : 0)) * (1 + regenBadge) * dt;
  a.adrenaline = clamp01(Math.min(A.max, a.adrenaline + regen * (adrDrain > 0 ? 0.15 : 1)));

  a.load += (drain * 60 + input.contact * 0.5) * dt;
  a.secondsPlayed += dt;
}

/** Recuperacao acelerada durante bola morta / intervalo. */
export function restDuringDeadBall(a: Actor, seconds: number, t: Tuning): void {
  a.stamina = clamp01(a.stamina + t.fatigue.recoverIdle * seconds * 1.4);
  a.adrenaline = clamp01(a.adrenaline + t.adrenaline.regenPerSec * seconds * 1.6);
}

export function restOnBench(a: Actor, seconds: number, t: Tuning): void {
  a.stamina = clamp01(a.stamina + t.fatigue.recoverBench * seconds);
  a.adrenaline = clamp01(a.adrenaline + t.adrenaline.regenPerSec * seconds * 2);
}

/** Quanto o corpo esta entregando agora, de 0 a 1 (HUD e IA de substituicao). */
export function outputLevel(a: Actor, t: Tuning): number {
  return clamp01(lerp(1 - t.fatigue.speedPenalty, 1, a.stamina));
}
