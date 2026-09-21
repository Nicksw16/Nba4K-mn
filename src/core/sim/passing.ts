/**
 * PASSE (secoes 15, 16, 17).
 *
 * O passe e um projetil de verdade: sai da mao, viaja com velocidade propria e
 * pode ser interceptado no caminho. O erro angular vem de Pass Accuracy,
 * pressao no passador, dificuldade do tipo e se o passador esta olhando ou nao
 * para o alvo (no-look vende a direcao errada mas custa precisao).
 */
import { Vec2, Vec3, add2, dist2, dot2, fromAngle, len2, mul2, norm2, rotate2, sub2, toAngle, v2, v3, angleDiff, distToSegment } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor, addCue, bv } from './actor.js';
import { Tuning } from '../config/tuning.js';
import { Rng } from '../math/rng.js';
import { COURT, Side, clampToCourt, hoopPos } from '../config/court.js';
import { standingReach } from '../model/attributes.js';
import { ballisticVelocity, leadPassVelocity } from './ball.js';

export type PassType =
  | 'chest' | 'bounce' | 'overhead' | 'bullet' | 'lob' | 'lead'
  | 'skip' | 'touch' | 'flashy' | 'outlet' | 'pocket' | 'handoff'
  | 'alley_oop' | 'no_look';

export interface PassPlan {
  type: PassType;
  target: Actor;
  /** Ponto para onde a bola e enviada (pode liderar o receptor). */
  aim: Vec3;
  speed: number;
  /** Erro angular aplicado (rad). */
  error: number;
  /** Tempo de voo estimado. */
  flightTime: number;
  /** 0..1: qualidade do passe, usada como bonus de catch-and-shoot. */
  quality: number;
  /** Risco calculado de interceptacao. */
  riskIntercept: number;
  /** Para onde o corpo/olhar aponta (no-look aponta para outro lugar). */
  gaze: number;
}

export function passSpeed(type: PassType, t: Tuning): number {
  switch (type) {
    case 'bullet': return t.passing.speedBullet;
    case 'bounce': return t.passing.speedBounce;
    case 'lob':
    case 'alley_oop': return t.passing.speedLob;
    case 'touch':
    case 'handoff': return t.passing.speedTouch;
    case 'skip': return t.passing.speedBullet * 0.92;
    case 'outlet': return t.passing.speedBullet * 0.95;
    default: return t.passing.speedChest;
  }
}

/** Dificuldade intrinseca do tipo (multiplica o erro). */
export function passDifficulty(type: PassType, t: Tuning): number {
  switch (type) {
    case 'chest': return 1;
    case 'bounce': return 1.05;
    case 'overhead': return 1.02;
    case 'bullet': return 1.25;
    case 'lob': return 1.3;
    case 'alley_oop': return 1.5;
    case 'lead': return 1.2;
    case 'skip': return 1.45;
    case 'touch': return 1.35;
    case 'flashy': return t.passing.flashyPenalty;
    case 'no_look': return t.passing.noLookPenalty;
    case 'outlet': return 1.35;
    case 'pocket': return 1.28;
    case 'handoff': return 0.85;
    default: return 1;
  }
}

/** Pressao sobre o passador (defensores proximos). */
export function passerPressure(passer: Actor, defenders: Actor[]): number {
  let p = 0;
  for (const d of defenders) {
    if (d.team === passer.team || !d.onCourt) continue;
    const dist = dist2(d.pos, passer.pos);
    if (dist < 2.2) p += clamp01(1 - dist / 2.2);
  }
  return clamp01(p);
}

/** Risco de interceptacao na linha do passe. */
export function interceptionRisk(
  from: Vec2, to: Vec2, passer: Actor, defenders: Actor[], speed: number, height: number, t: Tuning,
): { risk: number; defender?: Actor } {
  let worst = 0;
  let who: Actor | undefined;
  const flight = Math.max(0.08, dist2(from, to) / Math.max(1, speed));
  for (const d of defenders) {
    if (d.team === passer.team || !d.onCourt) continue;
    // Onde o defensor consegue chegar no tempo de voo.
    const reachRadius = d.physics.topSpeed * flight * 0.55 + t.passing.laneRadius;
    const perp = distToSegment(d.pos, from, to);
    if (perp > reachRadius) continue;
    // Altura: um lob passa por cima de quem nao alcanca.
    const canReach = standingReach(d.profile.physique) + 0.55 >= height - 0.15;
    if (!canReach) continue;
    const proximity = clamp01(1 - perp / Math.max(0.3, reachRadius));
    const anticipation = attr01(d.effective.defensiveIQ) * 0.4 + attr01(d.effective.steal) * 0.35 + attr01(d.effective.agility) * 0.25;
    const badge = bv(d, 'def.interception');
    const tendency = d.profile.tendencies.playPassingLane / 100;
    const risk = clamp01(t.passing.interceptBase * proximity * (0.35 + anticipation) * (1 + badge) * (0.5 + tendency));
    if (risk > worst) {
      worst = risk;
      who = d;
    }
  }
  return { risk: worst, defender: who };
}

export interface PassOptions {
  type?: PassType;
  lead?: boolean;
  noLook?: boolean;
  /** Assistencia de mira do slider de dificuldade (0..1). */
  assist?: number;
}

/**
 * Monta o plano de passe: tipo, ponto de chegada, erro e risco.
 * Passes para alvos em movimento sao liderados (lead pass).
 */
export function planPass(
  passer: Actor,
  target: Actor,
  defenders: Actor[],
  t: Tuning,
  rng: Rng,
  opts: PassOptions = {},
): PassPlan {
  const acc = attr01(passer.effective.passAccuracy);
  const iq = attr01(passer.effective.passIQ);
  const vision = attr01(passer.effective.passVision);
  const pressure = passerPressure(passer, defenders);

  const dist = dist2(passer.pos, target.pos);
  let type: PassType = opts.type ?? inferPassType(passer, target, defenders, dist, opts, t);
  if (opts.noLook && type !== 'alley_oop') type = 'no_look';

  const speed = passSpeed(type, t);
  const flightTime = Math.max(0.08, dist / Math.max(1, speed));

  // Lead pass: mira onde o receptor VAI estar.
  const leadFactor = opts.lead === false ? 0 : clamp01(0.55 + iq * 0.6);
  const predicted = add2(target.pos, mul2(target.vel, flightTime * leadFactor));

  const targetHeight = type === 'alley_oop' || type === 'lob'
    ? COURT.rimHeight + 0.35
    : type === 'bounce'
      ? 0.55
      : standingReach(target.profile.physique) * 0.72;

  // Erro angular: base / precisao, ampliado por dificuldade e pressao.
  const difficulty = passDifficulty(type, t);
  const needleBadge = bv(passer, 'play.needleThread');
  const typeBadge =
    type === 'alley_oop' || type === 'lob' ? bv(passer, 'play.lobAccuracy')
    : type === 'outlet' ? bv(passer, 'play.outlet')
    : type === 'handoff' ? bv(passer, 'play.handoff')
    : passer.state === 'posture_post' ? bv(passer, 'play.postPass')
    : 0;

  let error = t.passing.errorBase * difficulty
    * (1.35 - acc * 0.85)
    * (1 + pressure * (t.passing.pressurePenalty - 1))
    * (1 - clamp01(typeBadge) * 0.55)
    * (1 - clamp01(passer.balance < 0.6 ? 0 : 0.1))
    * lerp(1.25, 0.9, passer.balance);
  error *= 1 - clamp01(opts.assist ?? 0) * 0.8;
  const applied = rng.normal(0, error);

  const dir = norm2(sub2(predicted, passer.pos));
  const rotated = rotate2(dir, applied);
  // O erro desvia o passe, mas o passador nao joga a bola para a arquibancada:
  // o alvo continua dentro dos limites da quadra.
  const aimFlat = clampToCourt(add2(passer.pos, mul2(rotated, dist)), 0.35);
  const aim = v3(aimFlat.x, aimFlat.y, targetHeight);

  const { risk } = interceptionRisk(passer.pos, v2(aim.x, aim.y), passer, defenders, speed, targetHeight, t);
  const effectiveRisk = clamp01(risk * (1 - clamp01(needleBadge) * 0.6) * (1 + (type === 'flashy' ? 0.5 : 0)));

  const quality = clamp01(
    (1 - Math.abs(applied) / Math.max(0.02, error * 3)) * 0.55
    + vision * 0.2 + acc * 0.15 + (1 - pressure) * 0.1,
  );

  // No-look: o olhar aponta para OUTRO lugar (vende a direcao errada).
  const gaze = type === 'no_look'
    ? toAngle(rotate2(dir, rng.sign() * lerp(0.9, 1.5, vision)))
    : toAngle(dir);

  return { type, target, aim, speed, error: applied, flightTime, quality, riskIntercept: effectiveRisk, gaze };
}

function inferPassType(passer: Actor, target: Actor, defenders: Actor[], dist: number, opts: PassOptions, t: Tuning): PassType {
  const laneBlocked = interceptionRisk(passer.pos, target.pos, passer, defenders, t.passing.speedChest, 1.2, t).risk > 0.16;
  const targetRunningToRim = len2(target.vel) > 4;
  const hoop = hoopPos(target.team === 0 ? 1 : 0);
  const targetNearRim = dist2(target.pos, v2(hoop.x, hoop.y)) < 3.4;

  if (targetRunningToRim && targetNearRim && target.effective.vertical > 70) return 'alley_oop';
  if (dist > 12) return 'skip';
  if (dist > 8 && !laneBlocked) return 'bullet';
  if (dist < 2.4) return 'handoff';
  if (laneBlocked && dist < 7) return 'bounce';
  if (target.state === 'posture_post') return 'overhead';
  return 'chest';
}

/** Cria a velocidade real do passe (o arco depende do tipo). */
export function passVelocity(plan: PassPlan, from: Vec3, t: Tuning): Vec3 {
  if (plan.type === 'alley_oop' || plan.type === 'lob') {
    return ballisticVelocity(from, plan.aim, 42, t.sim.gravity);
  }
  if (plan.type === 'bounce') {
    // Mira o ponto de quique a ~60% do caminho.
    const mid = v3(
      from.x + (plan.aim.x - from.x) * 0.62,
      from.y + (plan.aim.y - from.y) * 0.62,
      0.14,
    );
    return leadPassVelocity(from, mid, plan.speed, t.sim.gravity);
  }
  return leadPassVelocity(from, plan.aim, plan.speed, t.sim.gravity);
}

/** Escolha inteligente do alvo (secao 15: target selection). */
export interface PassCandidate {
  actor: Actor;
  score: number;
  openness: number;
  advancement: number;
  risk: number;
  reason: string;
}

export function rankPassTargets(
  passer: Actor,
  teammates: Actor[],
  defenders: Actor[],
  side: Side,
  t: Tuning,
): PassCandidate[] {
  const hoop = hoopPos(side);
  const hoopFlat = v2(hoop.x, hoop.y);
  const myDist = dist2(passer.pos, hoopFlat);
  const out: PassCandidate[] = [];

  for (const mate of teammates) {
    if (mate.id === passer.id || !mate.onCourt) continue;
    const dist = dist2(passer.pos, mate.pos);
    if (dist < 1.1) continue;

    // Quao livre esta o companheiro
    let nearest = 99;
    for (const d of defenders) {
      if (d.team === passer.team || !d.onCourt) continue;
      nearest = Math.min(nearest, dist2(d.pos, mate.pos));
    }
    const openness = clamp01((nearest - 0.9) / 3.2);

    // Quanto ele avanca a jogada
    const mateDist = dist2(mate.pos, hoopFlat);
    const advancement = clamp01((myDist - mateDist) / 8 + 0.4);

    const speedGuess = passSpeed('chest', t);
    const { risk } = interceptionRisk(passer.pos, mate.pos, passer, defenders, speedGuess, 1.2, t);

    // Um atirador de elite parado no canto vale mais do que um pivo aberto no meio.
    const shooterValue = attr01(mate.effective.threePoint) * 0.5 + attr01(mate.effective.closeShot) * 0.2;
    const cutting = len2(mate.vel) > 3.5 && dot2(norm2(mate.vel), norm2(sub2(hoopFlat, mate.pos))) > 0.65 ? 0.35 : 0;

    const score = openness * 0.4 + advancement * 0.22 + shooterValue * 0.18 + cutting * 0.2 - risk * 0.9;
    const reason = cutting > 0 ? 'cortando para o aro'
      : openness > 0.7 ? 'completamente livre'
      : risk > 0.25 ? 'linha arriscada'
      : 'opcao de circulacao';

    out.push({ actor: mate, score, openness, advancement, risk, reason });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Recepcao: pode falhar por maos ruins, passe forte ou pressao. */
export function catchCheck(receiver: Actor, plan: PassPlan, contested: boolean, t: Tuning, rng: Rng): boolean {
  const hands = attr01(receiver.effective.hands);
  const difficulty = clamp01(Math.abs(plan.error) / 0.16) * 0.5 + (plan.type === 'bullet' ? 0.15 : 0) + (contested ? 0.18 : 0);
  const success = clamp01(0.94 + hands * 0.06 - difficulty * 0.45 - (1 - receiver.balance) * 0.12);
  const ok = rng.chance(success);
  if (!ok) addCue(receiver, 'bobble');
  return ok;
}

/** ALLEY-OOP (secao 17): o receptor ajusta a trajetoria e escolhe a mao. */
export interface OopFinish {
  canFinish: boolean;
  hand: 'left' | 'right';
  dunk: boolean;
  quality: number;
}

export function evaluateOop(receiver: Actor, ballPos: Vec3, side: Side, contest: number, t: Tuning): OopFinish {
  const hoop = hoopPos(side);
  const reach = standingReach(receiver.profile.physique)
    + (t.finishing.verticalAt25 + attr01(receiver.effective.vertical) * (t.finishing.verticalAt99 - t.finishing.verticalAt25));
  const canReachBall = reach + 0.25 >= ballPos.z;
  const nearRim = dist2(receiver.pos, v2(hoop.x, hoop.y)) < 2.2;
  const dunk = reach > COURT.rimHeight + t.finishing.dunkClearance && nearRim;
  // A mao escolhida e a do lado de onde a bola chega.
  const rel = sub2(v2(ballPos.x, ballPos.y), receiver.pos);
  const toHoop = norm2(sub2(v2(hoop.x, hoop.y), receiver.pos));
  const perp = v2(-toHoop.y, toHoop.x);
  const hand: 'left' | 'right' = dot2(rel, perp) > 0 ? 'right' : 'left';
  const quality = clamp01(
    attr01(receiver.effective.hands) * 0.3
    + attr01(receiver.effective.vertical) * 0.3
    + (1 - contest) * 0.25
    + clamp01(bv(receiver, 'finish.alleyOop')) * 0.15,
  );
  return { canFinish: canReachBall && nearRim, hand, dunk, quality };
}
