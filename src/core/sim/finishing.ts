/**
 * FINALIZACAO (secoes 9, 10, 11).
 *
 * Nenhuma bandeja e igual porque a escolha e composta em tempo real:
 *   GATHER (como o corpo recolhe a bola)  x  FINISH (como a mao termina)
 * A selecao NAO e aleatoria: ela le o lado de onde vem o defensor, o angulo
 * em relacao ao aro, a velocidade, o contato e o alcance. Se o defensor chega
 * pela direita, o finalizador protege a bola com a mao esquerda - isso cai
 * direto do calculo geometrico, nao de um sorteio.
 *
 * O DUNK METER e dinamico: a janela de timing e recalculada em tres momentos
 * (decolagem, meio do salto, apice) porque o contexto muda durante o voo.
 */
import { Vec2, add2, dist2, dot2, len2, mul2, norm2, sub2, v2, v3, angleDiff, toAngle, fromAngle } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor, addCue, bv } from './actor.js';
import { Tuning } from '../config/tuning.js';
import { COURT, Side, distToHoop, hoopPos, isInRestrictedArea } from '../config/court.js';
import { Rng } from '../math/rng.js';
import { maxReachHeight, standingReach, verticalLeap } from '../model/attributes.js';

export type GatherType = 'normal' | 'hop' | 'euro' | 'spin' | 'stride' | 'hesitation' | 'power';
export type FinishType =
  | 'finger_roll' | 'scoop' | 'reverse' | 'extension' | 'floater'
  | 'contact' | 'high_hand' | 'inside_hand' | 'outside_hand';

export interface FinishSelection {
  gather: GatherType;
  finish: FinishType;
  /** Mao usada. */
  hand: 'left' | 'right';
  /** Duracao do gather (s). */
  gatherTime: number;
  /** Deslocamento lateral do gather (m) - euro/hop movem o corpo de verdade. */
  gatherOffset: Vec2;
  /** Bonus/penalidade de probabilidade vindos da escolha. */
  modifier: number;
  /** Explicacao legivel (debug e comentario). */
  reason: string;
  /** Exposicao da bola durante o gather (risco de strip). */
  exposure: number;
}

export interface FinishContext {
  attacker: Actor;
  defenders: Actor[];
  side: Side;
  /** Contato registrado no frame do gather. */
  contact: number;
  t: Tuning;
}

/** Defensor mais relevante e de que lado ele vem. */
function primaryDefender(ctx: FinishContext): { def?: Actor; side: -1 | 0 | 1; dist: number; inFront: number; reachAdv: number } {
  const a = ctx.attacker;
  const hoop = hoopPos(ctx.side);
  const toHoop = norm2(sub2(v2(hoop.x, hoop.y), a.pos));
  const perp = v2(-toHoop.y, toHoop.x);
  let best: Actor | undefined;
  let bestScore = -Infinity;
  for (const d of ctx.defenders) {
    if (d.team === a.team || !d.onCourt) continue;
    const dist = dist2(d.pos, a.pos);
    if (dist > 3.4) continue;
    const inFront = clamp01(dot2(norm2(sub2(d.pos, a.pos)), toHoop));
    const score = inFront * 2 - dist * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  if (!best) return { side: 0, dist: 99, inFront: 0, reachAdv: 0 };
  const rel = sub2(best.pos, a.pos);
  const lateral = dot2(rel, perp);
  const reachAdv = (standingReach(best.profile.physique) + best.z) - (standingReach(a.profile.physique) + a.z);
  return {
    def: best,
    side: Math.abs(lateral) < 0.35 ? 0 : lateral > 0 ? 1 : -1,
    dist: dist2(best.pos, a.pos),
    inFront: clamp01(dot2(norm2(rel), norm2(sub2(v2(hoop.x, hoop.y), a.pos)))),
    reachAdv,
  };
}

/**
 * Escolhe gather + finish. Determinista dado o contexto (secao 128: variacao
 * com motivo, nao caos aleatorio). O rng so desempata escolhas equivalentes.
 */
export function selectFinish(ctx: FinishContext, rng: Rng): FinishSelection {
  const a = ctx.attacker;
  const t = ctx.t;
  const hoop = hoopPos(ctx.side);
  const hoopFlat = v2(hoop.x, hoop.y);
  const toHoop = sub2(hoopFlat, a.pos);
  const dist = len2(toHoop);
  const dir = norm2(toHoop);
  const perp = v2(-dir.y, dir.x);
  const speed = len2(a.vel);
  const approachAngle = Math.abs(angleDiff(toAngle(dir), toAngle(a.vel.x || a.vel.y ? a.vel : dir)));
  const d = primaryDefender(ctx);

  // Lateralidade: o corpo termina do lado OPOSTO ao defensor sempre que possivel.
  const protectSide: -1 | 1 = d.side === 0 ? (rng.sign() as -1 | 1) : (d.side === 1 ? -1 : 1);
  const baseHand: 'left' | 'right' = protectSide === 1 ? 'right' : 'left';
  const weakHandPenalty = baseHand === a.profile.physique.handedness ? 0 : 0.05 * (1 - attr01(a.effective.drivingLayup));

  const gatherControl = bv(a, 'finish.gatherControl');
  const layupSkill = attr01(a.effective.drivingLayup);
  const controlBudget = clamp01(layupSkill * 0.6 + attr01(a.effective.agility) * 0.2 + gatherControl + a.balance * 0.2);

  let gather: GatherType = 'normal';
  let reason = '';

  if (ctx.contact > 0.28 && a.effective.strength > 68) {
    gather = 'power';
    reason = 'contato no gather: recolhe forte para absorver';
  } else if (d.dist < 1.25 && d.side !== 0 && controlBudget > 0.45) {
    gather = 'euro';
    reason = `defensor pela ${d.side === 1 ? 'direita' : 'esquerda'}: euro para o lado oposto`;
  } else if (d.inFront > 0.7 && d.dist < 1.6 && controlBudget > 0.55) {
    gather = 'spin';
    reason = 'defensor cortou a linha: giro para reencontrar o aro';
  } else if (speed > 5.2 && dist > 2.4) {
    gather = 'stride';
    reason = 'velocidade alta com espaco: passada longa';
  } else if (speed < 2 && d.dist < 1.6) {
    gather = 'hesitation';
    reason = 'sem velocidade e marcado: hesita para reabrir';
  } else if (approachAngle > 1.0 && dist < 2.6) {
    gather = 'hop';
    reason = 'angulo fechado: hop para reposicionar o corpo';
  } else {
    gather = 'normal';
    reason = 'linha livre: gather padrao';
  }

  // FINISH: altura relativa do defensor e proximidade do aro decidem a mao.
  const reachH = maxReachHeight(a.profile.physique, a.effective.vertical, t.finishing.verticalAt99, t.finishing.verticalAt25, a.stamina, t.fatigue.verticalPenalty, a.adrenaline, t.adrenaline.depletedPenalty);
  const canExtend = reachH > COURT.rimHeight + 0.05;
  let finish: FinishType;

  if (ctx.contact > 0.35) finish = 'contact';
  else if (d.reachAdv > 0.16 && d.dist < 1.2) finish = dist < 1.6 ? 'reverse' : 'scoop';
  else if (d.dist < 1.3 && d.inFront > 0.55) finish = canExtend ? 'high_hand' : 'floater';
  else if (dist > 3.6) finish = 'floater';
  else if (d.side !== 0 && d.dist < 1.8) finish = protectSide === (d.side === 1 ? -1 : 1) ? 'inside_hand' : 'outside_hand';
  else if (canExtend && dist < 2.2) finish = 'extension';
  else finish = speed > 4 ? 'finger_roll' : 'scoop';

  // Modificadores de probabilidade por combinacao.
  const table: Partial<Record<FinishType, number>> = {
    finger_roll: 0.02,
    scoop: -0.01,
    reverse: -0.06,
    extension: 0.05,
    floater: -0.04,
    contact: -0.08,
    high_hand: 0.0,
    inside_hand: 0.03,
    outside_hand: 0.01,
  };
  const gatherMod: Partial<Record<GatherType, number>> = {
    normal: 0.02, hop: 0, euro: -0.01, spin: -0.04, stride: 0.01, hesitation: -0.02, power: -0.03,
  };

  let modifier = (table[finish] ?? 0) + (gatherMod[gather] ?? 0) - weakHandPenalty;
  // Badges da situacao exata.
  if (finish === 'reverse' || gather === 'euro' || gather === 'spin' || gather === 'hop') modifier += bv(a, 'finish.layup');
  if (finish === 'contact') modifier += bv(a, 'finish.contact');
  if (finish === 'floater') modifier += bv(a, 'finish.floater');
  if (finish === 'inside_hand' || finish === 'outside_hand') modifier += t.finishing.handProtectionBonus * 0.5;
  modifier += bv(a, 'finish.gatherControl') * 0.1;

  const gatherTime = lerp(0.42, 0.24, controlBudget) * (gather === 'euro' || gather === 'spin' ? 1.3 : gather === 'power' ? 1.15 : 1);
  const offsetMag = gather === 'euro' ? 0.85 : gather === 'hop' ? 0.45 : gather === 'spin' ? 0.6 : 0;
  const gatherOffset = mul2(perp, offsetMag * protectSide);

  const exposure = gather === 'power' ? 0.5 : gather === 'spin' ? 0.45 : gather === 'euro' ? 0.35 : 0.25;

  return { gather, finish, hand: baseHand, gatherTime, gatherOffset, modifier, reason, exposure };
}

export interface FinishProbabilityInput {
  attacker: Actor;
  selection: FinishSelection;
  distance: number;
  contest: number;
  contact: number;
  side: Side;
  t: Tuning;
  successMultiplier: number;
}

export function layupProbability(input: FinishProbabilityInput): number {
  const { attacker: a, selection, distance, contest, contact, t } = input;
  const skill = attr01(a.effective.drivingLayup);
  const close = attr01(a.effective.closeShot);
  const base = t.finishing.layupBase * lerp(0.62, 1.05, skill * 0.7 + close * 0.3);
  const distancePenalty = clamp01((distance - 1.4) / 4.2) * 0.2;
  const contestPenalty = contest * t.finishing.contactImpact;
  const contactPenalty = contact * t.finishing.contactImpact * (1 - clamp01(bv(a, 'finish.contact')));
  const balancePenalty = (1 - a.balance) * 0.22;
  const fatiguePenalty = (1 - a.stamina) * 0.1;
  return clamp(
    (base + selection.modifier - distancePenalty - contestPenalty - contactPenalty - balancePenalty - fatiguePenalty) * input.successMultiplier,
    0.02,
    0.98,
  );
}

// ---------------------------------------------------------------------------
// ENTERRADA (secao 11)
// ---------------------------------------------------------------------------

export type DunkKind = 'standing' | 'one_hand' | 'two_hand' | 'power' | 'alley_oop' | 'putback';

export interface DunkCheck {
  possible: boolean;
  kind: DunkKind;
  /** Folga vertical acima do aro (m). */
  clearance: number;
  reason: string;
}

/** O atleta so enterra se a mao realmente passa do aro com folga. */
export function canDunk(a: Actor, distance: number, contact: number, t: Tuning): DunkCheck {
  const reach = maxReachHeight(
    a.profile.physique, a.effective.vertical,
    t.finishing.verticalAt99, t.finishing.verticalAt25,
    a.stamina, t.fatigue.verticalPenalty, a.adrenaline, t.adrenaline.depletedPenalty,
  );
  const clearance = reach - COURT.rimHeight;
  if (clearance < t.finishing.dunkClearance) {
    return { possible: false, kind: 'standing', clearance, reason: 'alcance insuficiente para enterrar' };
  }
  const speed = len2(a.vel);
  const driving = attr01(a.effective.drivingDunk);
  const standing = attr01(a.effective.standingDunk);
  if (distance > 3.2) return { possible: false, kind: 'standing', clearance, reason: 'longe demais do aro' };
  if (contact > 0.5 && a.effective.strength < 70) {
    return { possible: false, kind: 'power', clearance, reason: 'contato forte demais para sustentar a enterrada' };
  }
  if (speed < 2.2) {
    return standing > 0.35
      ? { possible: true, kind: 'standing', clearance, reason: 'parado dentro do garrafao' }
      : { possible: false, kind: 'standing', clearance, reason: 'sem enterrada parada' };
  }
  if (driving < 0.25) return { possible: false, kind: 'one_hand', clearance, reason: 'enterrada em movimento fraca' };
  const kind: DunkKind = contact > 0.25 ? 'power' : clearance > 0.36 && driving > 0.7 ? 'two_hand' : 'one_hand';
  return { possible: true, kind, clearance, reason: 'espaco e impulsao suficientes' };
}

export interface DunkMeterState {
  /** Fase 0..1 do salto. */
  phase: number;
  /** Centro da janela (fase). */
  windowCenter: number;
  /** Largura da janela em fase. */
  windowWidth: number;
  /** Historico do contexto avaliado. */
  evaluations: { at: 'takeoff' | 'midair' | 'apex'; contest: number; width: number }[];
  released: boolean;
  timingQuality: number;
}

export function startDunkMeter(a: Actor, contestAtTakeoff: number, kind: DunkKind, t: Tuning): DunkMeterState {
  const skill = attr01(kind === 'standing' ? a.effective.standingDunk : a.effective.drivingDunk);
  const badge = bv(a, 'finish.dunkWindow');
  const open = lerp(t.finishing.dunkWindowContested, t.finishing.dunkWindowOpen, 1 - clamp01(contestAtTakeoff));
  const width = clamp(open * (0.75 + skill * 0.6) * (1 + badge), 0.05, 0.6);
  return {
    phase: 0,
    windowCenter: 0.72,
    windowWidth: width,
    evaluations: [{ at: 'takeoff', contest: contestAtTakeoff, width }],
    released: false,
    timingQuality: 0,
  };
}

/**
 * Reavalia a janela durante o voo. Uma rotacao defensiva perfeita no meio do
 * salto ENCOLHE a janela; o defensor errar o timing a ALARGA.
 */
export function updateDunkMeter(meter: DunkMeterState, a: Actor, contestNow: number, t: Tuning, dt: number, totalAirTime: number): DunkMeterState {
  meter.phase = clamp01(meter.phase + dt / Math.max(0.2, totalAirTime));
  const stage: 'takeoff' | 'midair' | 'apex' = meter.phase < 0.35 ? 'takeoff' : meter.phase < 0.75 ? 'midair' : 'apex';
  const last = meter.evaluations[meter.evaluations.length - 1];
  if (last.at !== stage) {
    const skill = attr01(a.effective.drivingDunk);
    const badge = bv(a, 'finish.dunkWindow');
    const open = lerp(t.finishing.dunkWindowContested, t.finishing.dunkWindowOpen, 1 - clamp01(contestNow));
    const width = clamp(open * (0.75 + skill * 0.6) * (1 + badge) * (stage === 'apex' ? 0.9 : 1), 0.04, 0.6);
    meter.windowWidth = lerp(meter.windowWidth, width, 0.75);
    meter.evaluations.push({ at: stage, contest: contestNow, width });
  }
  return meter;
}

/** Avalia a soltura do dunk meter na fase atual. */
export function releaseDunkMeter(meter: DunkMeterState): number {
  meter.released = true;
  const d = Math.abs(meter.phase - meter.windowCenter);
  meter.timingQuality = clamp01(1 - d / Math.max(0.03, meter.windowWidth));
  return meter.timingQuality;
}

export function dunkProbability(a: Actor, kind: DunkKind, timing: number, contest: number, contact: number, t: Tuning, successMultiplier: number): number {
  const skill = attr01(kind === 'standing' ? a.effective.standingDunk : a.effective.drivingDunk);
  let base = t.finishing.dunkBase * lerp(0.7, 1.02, skill);
  base *= lerp(0.55, 1, timing);
  const contestPenalty = contest * 0.3 * (1 - clamp01(bv(a, 'finish.contact')) * 0.5);
  const contactPenalty = contact * 0.22 * (1 - clamp01(attr01(a.effective.strength)));
  let bonus = 0;
  if (kind === 'standing') bonus += bv(a, 'finish.standingDunk');
  if (kind === 'alley_oop') bonus += bv(a, 'finish.alleyOop');
  if (kind === 'putback') bonus += bv(a, 'finish.putback');
  if (contact > 0.2) bonus += bv(a, 'finish.contact');
  return clamp((base + bonus - contestPenalty - contactPenalty) * successMultiplier, 0.05, 0.995);
}

// ---------------------------------------------------------------------------
// STEP-THROUGH / UP-AND-UNDER (secao 10)
// ---------------------------------------------------------------------------

export interface PumpFakeResult {
  /** Defensor mordeu a finta? */
  bit: boolean;
  /** Quanto tempo o defensor fica fora da jogada (s). */
  recoveryTime: number;
  /** Direcoes livres para o step-through. */
  openDirections: Vec2[];
}

export function resolvePumpFake(a: Actor, defenders: Actor[], side: Side, t: Tuning, rng: Rng): PumpFakeResult {
  const hoop = hoopPos(side);
  const toHoop = norm2(sub2(v2(hoop.x, hoop.y), a.pos));
  const perp = v2(-toHoop.y, toHoop.x);
  const result: PumpFakeResult = { bit: false, recoveryTime: 0, openDirections: [] };

  for (const d of defenders) {
    if (d.team === a.team || !d.onCourt) continue;
    const dist = dist2(d.pos, a.pos);
    if (dist > 2.6) continue;
    // Disciplina + QI defensivo resistem; agressividade e closeout rapido mordem.
    const discipline = attr01(d.effective.discipline) * 0.5 + attr01(d.effective.defensiveIQ) * 0.5;
    const shooterRep = attr01(a.effective.threePoint) * 0.5 + clamp01(a.heat) * 0.3;
    const closing = clamp01(dot2(d.vel, norm2(sub2(a.pos, d.pos))) / 4);
    const biteChance = clamp01(0.55 * shooterRep + closing * 0.35 - discipline * 0.6 + 0.12);
    if (rng.chance(biteChance)) {
      result.bit = true;
      result.recoveryTime = Math.max(result.recoveryTime, lerp(0.75, 0.3, discipline));
      // O defensor sobe: perde base e fica no ar.
      d.vz = Math.max(d.vz, 2.4);
      d.grounded = false;
      d.balance = clamp01(d.balance - 0.28);
      addCue(d, 'bit_fake');
    }
  }
  if (result.bit) {
    result.openDirections = [toHoop, perp, mul2(perp, -1)];
    addCue(a, 'pump_fake');
  }
  return result;
}

/** Direcao do step-through: contorna o defensor pelo lado mais livre. */
export function stepThroughDirection(a: Actor, defenders: Actor[], side: Side): Vec2 {
  const hoop = hoopPos(side);
  const toHoop = norm2(sub2(v2(hoop.x, hoop.y), a.pos));
  const perp = v2(-toHoop.y, toHoop.x);
  let leftCost = 0;
  let rightCost = 0;
  for (const d of defenders) {
    if (d.team === a.team || !d.onCourt) continue;
    const rel = sub2(d.pos, a.pos);
    const dist = Math.max(0.3, len2(rel));
    if (dist > 3) continue;
    const lateral = dot2(rel, perp);
    if (lateral > 0) rightCost += 1 / dist;
    else leftCost += 1 / dist;
  }
  const dirSign = rightCost > leftCost ? -1 : 1;
  return norm2(add2(mul2(toHoop, 0.75), mul2(perp, dirSign * 0.65)));
}

/** And-one: contato forte + cesta convertida. */
export function rollAndOne(a: Actor, contact: number, t: Tuning, rng: Rng): boolean {
  if (contact < 0.3) return false;
  const draw = attr01(a.effective.drawFoul);
  const badge = bv(a, 'finish.andOne');
  return rng.chance(clamp01(t.finishing.andOneChance * (0.6 + draw * 0.9) * (1 + badge) * contact * 1.4));
}
