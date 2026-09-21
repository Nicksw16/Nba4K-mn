/**
 * DEFESA (secoes 21, 22).
 *
 * Postura importa: maos agressivas contestam mais e cometem mais falta;
 * maos conservadoras mantem a base e cedem contest. Toco exige antecipacao +
 * timing real (o defensor precisa estar no ar no momento certo, e um toco fora
 * de tempo vira falta ou cesta facil). Cutoff e contencao fisica, nao script.
 */
import { Vec2, dist2, dot2, len2, mul2, norm2, sub2, toAngle, v2, angleDiff, fromAngle, add2 } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor, addCue, bv } from './actor.js';
import { badges } from './actor.js';
import { badgeValue } from '../model/badges.js';
import { Tuning } from '../config/tuning.js';
import { Rng } from '../math/rng.js';
import { Side, hoopPos, isInPaint } from '../config/court.js';
import { standingReach } from '../model/attributes.js';

export type HandsPosture = 'aggressive' | 'conservative' | 'neutral' | 'deny';

export interface DefensiveStance {
  posture: HandsPosture;
  /** Distancia alvo do marcador (m). */
  cushion: number;
  /** Lado que o defensor esta forcando (-1 esquerda, +1 direita, 0 nenhum). */
  forceSide: -1 | 0 | 1;
  /** True quando esta negando a recepcao. */
  denyPass: boolean;
}

/** Tempo de reacao do defensor (s), derivado de QI defensivo e fadiga. */
export function reactionTime(d: Actor, t: Tuning): number {
  const iq = attr01(d.effective.defensiveIQ);
  const base = lerp(t.defense.reactionAt25, t.defense.reactionAt99, iq);
  const fatigue = 1 + (1 - d.stamina) * t.fatigue.reactionPenalty;
  const badge = bv(d, 'phys.reaction');
  return base * fatigue * (1 - clamp01(badge) * 0.35);
}

/** Posicao ideal de marcacao: entre o atacante e a cesta, com cushion. */
export function idealDefensivePosition(defender: Actor, attacker: Actor, side: Side, stance: DefensiveStance): Vec2 {
  const hoop = hoopPos(side);
  const toHoop = norm2(sub2(v2(hoop.x, hoop.y), attacker.pos));
  const perp = v2(-toHoop.y, toHoop.x);
  const base = add2(attacker.pos, mul2(toHoop, stance.cushion));
  if (stance.forceSide !== 0) {
    // Forcar um lado = posicionar o corpo deslocado para o lado contrario.
    return add2(base, mul2(perp, -stance.forceSide * 0.45));
  }
  return base;
}

/** Postura recomendada dado o contexto. */
export function chooseStance(defender: Actor, attacker: Actor, side: Side, t: Tuning, foulTolerance: number): DefensiveStance {
  const dist = dist2(defender.pos, attacker.pos);
  const inPaint = isInPaint(attacker.pos, side);
  const shooter = attr01(attacker.effective.threePoint);
  const driver = attr01(attacker.effective.drivingLayup) * 0.6 + attr01(attacker.effective.speedWithBall) * 0.4;
  const foulTrouble = defender.fouls >= t.fouls.foulOutLimit - 2;

  // Cushion: respeita a arrancada de quem penetra, encosta em quem so arremessa.
  let cushion = lerp(1.65, 0.75, shooter) + driver * 0.75;
  if (inPaint) cushion = Math.min(cushion, 1.0);
  cushion = clamp(cushion, 0.55, 2.4);

  let posture: HandsPosture = 'neutral';
  if (foulTrouble || foulTolerance < 0.25) posture = 'conservative';
  else if (shooter > 0.75 && dist < 2.2) posture = 'aggressive';
  else if (defender.profile.tendencies.contest > 65) posture = 'aggressive';

  // Forcar para a mao fraca.
  const weak = attacker.profile.physique.handedness === 'right' ? -1 : 1;
  const forceSide = attr01(defender.effective.defensiveIQ) > 0.55 ? (weak as -1 | 1) : 0;

  return { posture, cushion, forceSide, denyPass: false };
}

export interface ContestModifiers {
  contestMult: number;
  foulMult: number;
}

export function postureModifiers(posture: HandsPosture, t: Tuning): ContestModifiers {
  switch (posture) {
    case 'aggressive': return { contestMult: t.defense.aggressiveContestMult, foulMult: t.defense.aggressiveFoulMult };
    case 'conservative': return { contestMult: t.defense.conservativeContestMult, foulMult: t.defense.conservativeFoulMult };
    case 'deny': return { contestMult: 1.05, foulMult: 1.35 };
    default: return { contestMult: 1, foulMult: 1 };
  }
}

export interface StealAttempt {
  success: boolean;
  foul: boolean;
  /** Quanto o defensor fica exposto se errar (s). */
  recovery: number;
}

/** Tentativa de roubo: chance real, falta real, e custo real ao errar. */
export function attemptSteal(
  defender: Actor, attacker: Actor, ballExposure: number, t: Tuning, rng: Rng, posture: HandsPosture,
): StealAttempt {
  const dist = dist2(defender.pos, attacker.pos);
  if (dist > 2.2) return { success: false, foul: false, recovery: 0.35 };

  const skill = attr01(defender.effective.steal);
  const iq = attr01(defender.effective.defensiveIQ);
  const handle = attr01(attacker.effective.ballHandle);
  const security = bv(attacker, 'play.ballSecurity');
  const pickpocket = bv(defender, 'def.pickpocket');
  const proximity = clamp01(1 - (dist - 0.5) / 1.7);

  const chance = clamp01(
    t.defense.stealBase
    * (0.4 + skill * 1.3 + iq * 0.3)
    * (1 + pickpocket)
    * proximity
    * (0.45 + ballExposure * 1.5)
    * (1.5 - handle - clamp01(security) * 0.4)
    * postureModifiers(posture, t).contestMult,
  );

  const discipline = attr01(defender.effective.discipline);
  const foulResist = bv(defender, 'def.foulResist');
  const foulChance = clamp01(
    t.defense.stealFoulBase
    * postureModifiers(posture, t).foulMult
    * (1.5 - discipline - clamp01(foulResist) * 0.5)
    * (0.6 + proximity * 0.8),
  );

  const success = rng.chance(chance);
  const foul = !success && rng.chance(foulChance);
  // Errar o roubo custa posicao: o braco sai, o corpo abre.
  const recovery = success ? 0 : lerp(0.65, 0.3, iq);
  if (!success) {
    defender.balance = clamp01(defender.balance - 0.12);
    addCue(defender, 'steal_whiff');
  }
  return { success, foul, recovery };
}

export interface BlockAttempt {
  success: boolean;
  foul: boolean;
  goaltend: boolean;
  quality: number;
}

/**
 * TOCO: exige que a mao do defensor esteja acima da bola no instante do release,
 * dentro do alcance. Pular cedo demais = ja desceu; tarde = nao chega.
 */
export function attemptBlock(
  defender: Actor, shooter: Actor, ballHeight: number, timeToRelease: number, t: Tuning, rng: Rng, chasedown = false,
): BlockAttempt {
  const dist = dist2(defender.pos, shooter.pos);
  const reach = standingReach(defender.profile.physique) + defender.z;
  const vertical = t.finishing.verticalAt25 + attr01(defender.effective.vertical) * (t.finishing.verticalAt99 - t.finishing.verticalAt25);
  const maxReach = reach + (defender.grounded ? vertical : 0);

  if (dist > 2.6 || maxReach < ballHeight - 0.12) {
    return { success: false, foul: false, goaltend: false, quality: 0 };
  }

  // Timing: o ideal e estar no apice quando a bola sai.
  const timeToApex = defender.grounded ? Math.sqrt(Math.max(0.01, 2 * vertical / t.sim.gravity)) : Math.max(0, defender.vz / t.sim.gravity);
  const timingError = Math.abs(timeToApex - timeToRelease);
  const timing = clamp01(1 - timingError / 0.38);

  const skill = attr01(defender.effective.block);
  const iq = attr01(defender.effective.defensiveIQ);
  const proximity = clamp01(1 - (dist - 0.4) / 2.2);
  const heightAdv = clamp01((maxReach - ballHeight + 0.3) / 0.6);
  const badge = badgeValue(badges(defender), chasedown ? 'def.chasedown' : 'def.block');

  const quality = clamp01(timing * 0.35 + skill * 0.25 + proximity * 0.2 + heightAdv * 0.15 + iq * 0.05);
  const chance = clamp01(t.defense.blockBase * (0.3 + quality * 1.8) * (1 + badge));

  const discipline = attr01(defender.effective.discipline);
  const foulResist = bv(defender, 'def.foulResist');
  const foulChance = clamp01(
    t.defense.blockFoulBase * (1.6 - discipline - clamp01(foulResist) * 0.5) * (1 - timing * 0.6) * (1 + (dist < 0.8 ? 0.5 : 0)),
  );

  const success = rng.chance(chance);
  const foul = !success && rng.chance(foulChance);
  // Goaltending: acertar a bola na descida acima do aro.
  const goaltend = success && rng.chance(clamp01(0.06 * (1 - iq)));
  return { success, foul, goaltend, quality };
}

export type CutoffKind = 'quick' | 'extended' | 'sprint';

export interface CutoffPlan {
  kind: CutoffKind;
  /** Ponto que o defensor precisa alcancar. */
  target: Vec2;
  /** Tempo estimado para chegar. */
  eta: number;
  /** Tempo do atacante ate o mesmo ponto. */
  attackerEta: number;
  /** True se a contencao e viavel. */
  viable: boolean;
}

/**
 * Planeja a contencao (secao 22). O defensor projeta a linha de penetracao e
 * escolhe o ponto onde consegue chegar ANTES do atacante - se existir.
 */
export function planCutoff(defender: Actor, attacker: Actor, side: Side, t: Tuning): CutoffPlan {
  const hoop = hoopPos(side);
  const driveDir = len2(attacker.vel) > 0.8 ? norm2(attacker.vel) : norm2(sub2(v2(hoop.x, hoop.y), attacker.pos));
  const attackerSpeed = Math.max(1.2, len2(attacker.vel));
  const defSpeed = Math.max(1.2, defender.physics.topSpeed * lerp(0.62, 0.95, attr01(defender.effective.lateralQuickness)));

  let best: CutoffPlan = { kind: 'quick', target: v2(defender.pos.x, defender.pos.y), eta: 99, attackerEta: 99, viable: false };
  // Testa pontos a 1, 2 e 4 m a frente do atacante.
  const options: { d: number; kind: CutoffKind }[] = [
    { d: 1.1, kind: 'quick' },
    { d: 2.4, kind: 'extended' },
    { d: 4.2, kind: 'sprint' },
  ];
  for (const opt of options) {
    const target = add2(attacker.pos, mul2(driveDir, opt.d));
    const eta = dist2(defender.pos, target) / defSpeed;
    const attackerEta = opt.d / attackerSpeed;
    const viable = eta <= attackerEta * 1.02;
    if (viable && (!best.viable || eta < best.eta)) {
      best = { kind: opt.kind, target, eta, attackerEta, viable };
    } else if (!best.viable && eta - attackerEta < best.eta - best.attackerEta) {
      best = { kind: opt.kind, target, eta, attackerEta, viable: false };
    }
  }
  return best;
}

/** Qualidade do closeout: chegar rapido sem perder o controle do corpo. */
export function closeoutQuality(defender: Actor, shooter: Actor, t: Tuning): number {
  const dist = dist2(defender.pos, shooter.pos);
  const closing = dot2(defender.vel, norm2(sub2(shooter.pos, defender.pos)));
  const badge = bv(defender, 'def.closeout');
  // Chegar voando reduz a capacidade de reagir a finta.
  const controlled = clamp01(1 - Math.abs(closing) / 7.5);
  const proximity = clamp01(1 - (dist - 0.6) / 2.4);
  return clamp01(proximity * 0.55 + controlled * 0.3 + clamp01(badge) * 0.2);
}

/** Pressao na bola aplicada pelo defensor (afeta seguranca da bola e passe). */
export function onBallPressure(defender: Actor, attacker: Actor, t: Tuning): number {
  const dist = dist2(defender.pos, attacker.pos);
  if (dist > 2.4) return 0;
  const proximity = clamp01(1 - dist / 2.4);
  const skill = attr01(defender.effective.perimeterDefense);
  const badge = bv(defender, 'def.onBallPressure');
  const facing = 1 - Math.abs(angleDiff(defender.hipHeading, toAngle(sub2(attacker.pos, defender.pos)))) / Math.PI;
  return clamp01(proximity * (0.45 + skill * 0.5) * (1 + badge) * (0.6 + facing * 0.55) * (0.6 + defender.balance * 0.5));
}
