/**
 * ARREMESSO (secoes 18, 19, 20).
 *
 * Tres blocos independentes:
 *  1) RHYTHM SHOOTING: o usuario controla inicio, tempo e soltura. Mede-se
 *     erro de timing E qualidade do ritmo (o quanto o tempo do stick acompanhou
 *     a subida do corpo). Ritmo bom AUMENTA a janela verde; ritmo picotado reduz.
 *  2) CONTEST MULTINIVEL: distancia + direcao + mao levantada + envergadura +
 *     timing do salto + velocidade de chegada. Nao e um raio binario.
 *  3) PROBABILIDADE: nunca "80 de tres = 80%". A base sai do atributo do TIPO
 *     de arremesso naquela distancia e e modulada por timing, contest,
 *     equilibrio, movimento, fadiga, assistencia, hot/cold e badges da SITUACAO.
 *
 * O sorteio acontece UMA vez, no release. A fisica depois encena o resultado:
 * uma bola marcada como erro recebe desvio compativel com o motivo do erro
 * (curta, longa, lateral), entao ela bate no aro, no vidro ou passa reto.
 */
import { Vec2, Vec3, add3, dist2, len2, norm2, sub2, toAngle, v2, v3, angleDiff, fromAngle, dot2 } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp, remap } from '../math/util.js';
import { Actor, bv } from './actor.js';
import { badges } from './actor.js';
import { badgeValue } from '../model/badges.js';
import { Tuning } from '../config/tuning.js';
import { COURT, Side, ShotZone, distToHoop, hoopPos, isInPaint, shotValue, shotZone } from '../config/court.js';
import { Rng } from '../math/rng.js';
import { backspinFor, solveLaunchVelocity } from './ball.js';
import { standingReach } from '../model/attributes.js';

export type ShotType =
  | 'set'
  | 'catch_and_shoot'
  | 'pullup'
  | 'stepback'
  | 'fadeaway'
  | 'floater'
  | 'post_fade'
  | 'hook'
  | 'free_throw';

export interface ShotAttempt {
  shooter: Actor;
  type: ShotType;
  from: Vec2;
  side: Side;
  distance: number;
  zone: ShotZone;
  value: 2 | 3;
  /** Recebeu passe ha pouco (catch and shoot). */
  assisted: boolean;
  assistQuality: number;
  assistedById?: string;
  /** Velocidade lateral no release (arremesso em movimento). */
  movement: number;
  shotClockPressure: boolean;
}

export interface ContestDetail {
  /** 0..1 total. */
  total: number;
  proximity: number;
  hand: number;
  height: number;
  timing: number;
  closing: number;
  defenderId?: string;
  /** Rotulo para o HUD (secao 20). */
  label: 'aberto' | 'leve' | 'medio' | 'pesado' | 'total';
}

/** Calcula o contest somando os niveis descritos na secao 20. */
export function computeContest(attempt: ShotAttempt, defenders: Actor[], t: Tuning): ContestDetail {
  const shooter = attempt.shooter;
  let best: ContestDetail = { total: 0, proximity: 0, hand: 0, height: 0, timing: 0, closing: 0, label: 'aberto' };

  const releaseHeight = standingReach(shooter.profile.physique) + shooter.z + 0.35;

  for (const d of defenders) {
    if (!d.onCourt || d.team === shooter.team) continue;
    const dist = dist2(d.pos, shooter.pos);
    if (dist > t.defense.contestRange * 1.6) continue;

    // 1) Proximidade (nao linear: os ultimos 60 cm pesam muito mais)
    const proximity = clamp01(1 - dist / (t.defense.contestRange * 1.15)) ** 1.5;

    // 2) Direcao: defensor precisa estar ENTRE o arremessador e a cesta
    const toHoop = norm2(sub2(v2(hoopPos(attempt.side).x, hoopPos(attempt.side).y), shooter.pos));
    const toDef = norm2(sub2(d.pos, shooter.pos));
    const inLine = clamp01(dot2(toHoop, toDef));

    // 3) Mao levantada: braco no ar + altura efetiva alcancada
    const defenderReach = standingReach(d.profile.physique) + d.z;
    const handUp = d.grounded
      ? (d.state === 'jump' ? 1 : clamp01(0.35 + attr01(d.effective.perimeterDefense) * 0.4))
      : 1;
    const hand = handUp * clamp01((defenderReach - releaseHeight + 0.55) / 0.9);

    // 4) Envergadura/altura relativa
    const height = clamp01((d.profile.physique.wingspan - shooter.profile.physique.wingspan) / 0.35) * 0.5 + 0.25;

    // 5) Timing do salto do defensor: pular junto vale mais do que pular cedo
    const timing = d.state === 'jump' ? clamp01(1 - Math.abs(d.vz) / 4.2) : 0.35;

    // 6) Velocidade de chegada: closeout tardio contesta menos
    const closingVel = dot2(d.vel, norm2(sub2(shooter.pos, d.pos)));
    const closing = clamp01(1 - Math.abs(closingVel) / 6.5);

    const badgeBonus = bv(d, 'def.contest')
      + (isInPaint(attempt.from, attempt.side) ? bv(d, 'def.verticality') * 0.5 : 0);

    let total = clamp01(
      proximity * t.defense.contestProximityWeight * (0.4 + inLine * 0.8) +
      hand * t.defense.contestHandWeight +
      height * t.defense.contestHeightWeight +
      timing * t.defense.contestTimingWeight +
      closing * 0.08,
    );
    total = clamp01(total * (1 + badgeBonus) * (0.75 + d.balance * 0.3));

    if (total > best.total) {
      best = { total, proximity, hand, height, timing, closing, defenderId: d.id, label: 'aberto' };
    }
  }

  best.label = best.total < 0.12 ? 'aberto'
    : best.total < 0.3 ? 'leve'
    : best.total < 0.52 ? 'medio'
    : best.total < 0.75 ? 'pesado' : 'total';
  return best;
}

/** Atributo de arremesso relevante para a distancia/tipo. */
export function shootingAttribute(a: Actor, attempt: ShotAttempt): number {
  if (attempt.type === 'free_throw') return a.effective.freeThrow;
  if (attempt.value === 3) return a.effective.threePoint;
  if (attempt.distance <= 4.2) return a.effective.closeShot;
  return a.effective.midRange;
}

/** Tempo de release por tipo, ajustado por badge e fadiga. */
export function releaseTime(a: Actor, type: ShotType, t: Tuning): number {
  const S = t.shooting;
  const base = type === 'catch_and_shoot' || type === 'set' ? S.releaseSet
    : type === 'pullup' ? S.releasePullup
    : type === 'stepback' ? S.releaseStepback
    : type === 'fadeaway' || type === 'post_fade' ? S.releaseFadeaway
    : type === 'floater' ? S.releaseFloater
    : type === 'hook' ? S.releaseFloater * 1.1
    : S.releaseSet;
  const quick = bv(a, 'shot.quickRelease');
  return base * (1 - clamp01(quick)) * lerp(1, 1.12, 1 - a.stamina);
}

/** Tamanho da janela verde (s) para o timing perfeito. */
export function greenWindow(a: Actor, attempt: ShotAttempt, contest: number, rhythm: number, t: Tuning): number {
  const S = t.shooting;
  const attr = attr01(shootingAttribute(a, attempt));
  let w = S.greenWindowBase + attr * S.greenWindowAttrGain;
  w += bv(a, 'shot.greenWindow');
  w *= lerp(1, S.rhythmWindowBonus, clamp01(rhythm));
  w *= 1 - S.contestWindowPenalty * clamp01(contest);
  w *= lerp(0.8, 1.05, a.balance);
  return Math.max(0.012, w);
}

export interface ShotTiming {
  /** Erro absoluto (s) em relacao ao release ideal. */
  error: number;
  /** 0..1, 1 = dentro da janela verde. */
  quality: number;
  /** Qualidade do ritmo do stick 0..1. */
  rhythm: number;
  green: boolean;
  /** Cedo/tarde para o feedback visual. */
  direction: 'early' | 'late' | 'perfect';
}

/**
 * MEDIDOR DE RITMO (secao 18).
 * O stick e amostrado durante a subida. Comparamos o perfil real com o ideal
 * (aceleracao suave e continua). Tempo travado ou solavanco derruba o ritmo.
 */
export class RhythmMeter {
  private samples: { t: number; value: number }[] = [];
  private started = false;
  startTime = 0;

  reset(): void {
    this.samples = [];
    this.started = false;
    this.startTime = 0;
  }

  sample(time: number, stickValue: number): void {
    if (!this.started && stickValue > 0.2) {
      this.started = true;
      this.startTime = time;
    }
    if (this.started) this.samples.push({ t: time, value: clamp01(stickValue) });
    if (this.samples.length > 240) this.samples.shift();
  }

  get active(): boolean {
    return this.started;
  }

  /** 0..1: suavidade e continuidade do movimento do stick. */
  quality(idealDuration: number): number {
    if (this.samples.length < 4) return 0.35;
    const total = this.samples[this.samples.length - 1].t - this.samples[0].t;
    if (total <= 1e-3) return 0.3;
    // 1) Duracao proxima da ideal
    const durationScore = clamp01(1 - Math.abs(total - idealDuration) / Math.max(0.12, idealDuration));
    // 2) Monotonicidade: o stick deve subir sem recuar
    let regress = 0;
    for (let i = 1; i < this.samples.length; i++) {
      const d = this.samples[i].value - this.samples[i - 1].value;
      if (d < 0) regress += -d;
    }
    const smoothScore = clamp01(1 - regress * 2.2);
    // 3) Constancia da velocidade
    const speeds: number[] = [];
    for (let i = 1; i < this.samples.length; i++) {
      const dt = this.samples[i].t - this.samples[i - 1].t;
      if (dt > 1e-4) speeds.push((this.samples[i].value - this.samples[i - 1].value) / dt);
    }
    const mean = speeds.reduce((s, v) => s + v, 0) / Math.max(1, speeds.length);
    const variance = speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, speeds.length);
    const steadyScore = clamp01(1 - Math.sqrt(variance) / Math.max(0.6, Math.abs(mean) * 2.5 + 0.6));
    return clamp01(durationScore * 0.4 + smoothScore * 0.35 + steadyScore * 0.25);
  }
}

export function evaluateTiming(releaseAt: number, idealAt: number, window: number, rhythm: number): ShotTiming {
  const error = releaseAt - idealAt;
  const abs = Math.abs(error);
  const green = abs <= window;
  const quality = green ? 1 : clamp01(1 - (abs - window) / (window * 4 + 0.16));
  return {
    error: abs,
    quality,
    rhythm,
    green,
    direction: green ? 'perfect' : error < 0 ? 'early' : 'late',
  };
}

export interface ShotProbabilityBreakdown {
  base: number;
  timing: number;
  contest: number;
  balance: number;
  movement: number;
  fatigue: number;
  assist: number;
  heat: number;
  badge: number;
  clutch: number;
  final: number;
}

/** Modelo de probabilidade (secao 19). Cada termo e somado explicitamente. */
export function shotProbability(
  attempt: ShotAttempt,
  timing: ShotTiming,
  contest: ContestDetail,
  t: Tuning,
  context: { clutch: boolean; lead: number; userControlled: boolean; successMultiplier: number },
): ShotProbabilityBreakdown {
  const S = t.shooting;
  const a = attempt.shooter;
  const attrValue = shootingAttribute(a, attempt);
  const attr = attr01(attrValue);

  // Base: probabilidade com timing perfeito, aberto, no ponto confortavel.
  let base = lerp(S.baseBadTiming, S.basePerfect, timing.quality);
  if (attempt.type === 'free_throw') {
    base = S.freeThrowBase * lerp(0.72, 1.04, attr) * lerp(0.86, 1, timing.quality);
    const ft = bv(a, 'shot.freeThrow');
    const fin = clamp01(base * (1 + ft) * context.successMultiplier);
    return { base, timing: timing.quality, contest: 0, balance: 0, movement: 0, fatigue: 0, assist: 0, heat: 0, badge: ft, clutch: 0, final: fin };
  }

  // Distancia confortavel cresce com o atributo. Alem dela, queda por metro.
  const comfort = lerp(S.comfortDistAt25, S.comfortDistAt99, attr);
  const beyond = Math.max(0, attempt.distance - comfort);
  const distancePenalty = beyond * S.distanceFalloff;

  // Habilidade bruta ancora a taxa: 25 -> muito baixo, 99 -> elite.
  const skillFloor = lerp(0.2, 0.62, attr);
  base = lerp(skillFloor, base, 0.72) - distancePenalty;

  const contestPenalty = contest.total * S.contestImpact * (1 - clamp01(bv(a, 'shot.contested')) * 0.55);
  const balancePenalty = (1 - a.balance) * S.balanceImpact;
  const movementTolerance = bv(a, 'shot.movementTolerance');
  const movementPenalty = clamp01(attempt.movement / 4.5) * S.movementImpact * (1 - clamp01(movementTolerance));
  const fatiguePenalty = (1 - a.stamina) * S.fatigueImpact * (1 - clamp01(bv(a, 'shot.fatigueResist')) * 0.6);
  const assistBonus = attempt.assisted ? S.assistBonus * attempt.assistQuality : 0;
  const heatBonus = clamp(a.heat, -1, 1) * S.hotColdRange;

  // Badges especificas da SITUACAO (e so da situacao).
  let badgeBonus = 0;
  const bd = badges(a);
  if (attempt.type === 'catch_and_shoot' || attempt.type === 'set') badgeBonus += badgeValue(bd, 'shot.catchShoot');
  if (attempt.type === 'pullup') badgeBonus += badgeValue(bd, 'shot.offDribble');
  if (attempt.type === 'stepback') badgeBonus += badgeValue(bd, 'shot.stepback');
  if (attempt.type === 'post_fade' || attempt.type === 'fadeaway') badgeBonus += badgeValue(bd, 'shot.postFade');
  if (attempt.zone === 'corner_three') badgeBonus += badgeValue(bd, 'shot.corner');
  if (attempt.zone === 'deep_three') badgeBonus += badgeValue(bd, 'shot.deep');
  if (attempt.distance >= 4.5 && attempt.distance <= 7 && attempt.value === 2) badgeBonus += badgeValue(bd, 'shot.midRangeSpot');

  const clutchBonus = context.clutch ? badgeValue(bd, 'shot.clutch') - 0.02 : 0;

  const final = clamp(
    (base - contestPenalty - balancePenalty - movementPenalty - fatiguePenalty + assistBonus + heatBonus + badgeBonus + clutchBonus)
    * context.successMultiplier,
    0.008,
    0.985,
  );

  return {
    base,
    timing: timing.quality,
    contest: -contestPenalty,
    balance: -balancePenalty,
    movement: -movementPenalty,
    fatigue: -fatiguePenalty,
    assist: assistBonus,
    heat: heatBonus,
    badge: badgeBonus,
    clutch: clutchBonus,
    final,
  };
}

export interface ShotRelease {
  origin: Vec3;
  velocity: Vec3;
  spin: Vec3;
  willMake: boolean;
  probability: number;
  arc: number;
  /** Motivo do erro, para a fisica encenar corretamente. */
  missKind?: 'short' | 'long' | 'left' | 'right' | 'flat';
}

/**
 * Constroi a trajetoria real do arremesso. Cestas miram o centro com leve
 * variacao; erros recebem desvio coerente com a causa (curto por fadiga,
 * lateral por contest lateral, longo por soltar tarde).
 */
export function buildRelease(
  attempt: ShotAttempt,
  probability: number,
  timing: ShotTiming,
  contest: ContestDetail,
  t: Tuning,
  rng: Rng,
): ShotRelease {
  const a = attempt.shooter;
  const hoop = hoopPos(attempt.side);
  const willMake = rng.chance(probability);
  const dist = attempt.distance;

  const reach = standingReach(a.profile.physique);
  const origin = v3(
    a.pos.x,
    a.pos.y,
    reach + a.z + (attempt.type === 'floater' ? 0.15 : 0.3),
  );
  // O corpo recua em fadeaway/stepback: a origem se afasta da cesta.
  if (attempt.type === 'fadeaway' || attempt.type === 'post_fade' || attempt.type === 'stepback') {
    const away = norm2(sub2(a.pos, v2(hoop.x, hoop.y)));
    origin.x += away.x * 0.35;
    origin.y += away.y * 0.35;
  }

  const arcBase = lerp(t.shooting.arcNear, t.shooting.arcFar, clamp01((dist - 2) / 7));
  const arc = clamp(arcBase + (attempt.type === 'floater' ? 9 : 0) + rng.normal(0, 1.1), 36, 66);

  let target = v3(hoop.x, hoop.y, hoop.z + 0.02);
  let missKind: ShotRelease['missKind'];

  if (willMake) {
    // Mesmo entrando, a bola nao passa sempre pelo mesmo ponto.
    const jitter = lerp(0.04, 0.012, timing.quality);
    target = v3(hoop.x + rng.normal(0, jitter), hoop.y + rng.normal(0, jitter), hoop.z + 0.02);
  } else {
    // Causa do erro define a direcao do desvio.
    const late = timing.direction === 'late';
    const early = timing.direction === 'early';
    const tired = a.stamina < 0.45;
    const lateral = contest.total > 0.35 || attempt.movement > 2.2;

    const roll = rng.next();
    if ((tired || early) && roll < 0.45) missKind = 'short';
    else if (late && roll < 0.55) missKind = 'long';
    else if (lateral && roll < 0.8) missKind = rng.sign() > 0 ? 'left' : 'right';
    else missKind = rng.pick(['short', 'long', 'left', 'right', 'flat'] as const);

    const severity = lerp(0.45, 0.14, timing.quality) + contest.total * 0.18 + (1 - a.balance) * 0.12;
    const toHoop = norm2(sub2(v2(hoop.x, hoop.y), v2(origin.x, origin.y)));
    const perp = v2(-toHoop.y, toHoop.x);
    const radial = missKind === 'short' ? -(0.16 + severity * 0.55)
      : missKind === 'long' ? (0.16 + severity * 0.5) : rng.normal(0, 0.1);
    const side = missKind === 'left' ? (0.15 + severity * 0.5)
      : missKind === 'right' ? -(0.15 + severity * 0.5) : rng.normal(0, 0.09);

    target = v3(
      hoop.x + toHoop.x * radial + perp.x * side,
      hoop.y + toHoop.y * radial + perp.y * side,
      hoop.z + (missKind === 'flat' ? -0.04 : 0.02),
    );
  }

  const spin = backspinFor(dist);
  // A rotacao gira com a direcao do arremesso.
  const dir = norm2(sub2(v2(target.x, target.y), v2(origin.x, origin.y)));
  const spinWorld = v3(-dir.y * spin.y, dir.x * spin.y, 0);
  const velocity = solveLaunchVelocity(origin, target, missKind === 'flat' ? arc - 12 : arc, spinWorld, t);

  return { origin, velocity, spin: spinWorld, willMake, probability, arc, missKind };
}

/** Classifica o tipo de arremesso a partir do estado do corpo. */
export function inferShotType(a: Actor, timeSinceCatch: number, lastMoveId?: string): ShotType {
  const speed = len2(a.vel);
  if (lastMoveId === 'stepback' || lastMoveId === 'stepback_crossover' || lastMoveId === 'lateral_stepback') return 'stepback';
  if (a.state === 'posture_post') return 'post_fade';
  if (timeSinceCatch < 0.7 && speed < 3.6) return 'catch_and_shoot';
  if (speed > 2.2) return 'pullup';
  return 'set';
}

/** Monta a tentativa a partir do estado atual. */
export function buildAttempt(
  a: Actor,
  side: Side,
  type: ShotType,
  opts: { assisted?: boolean; assistQuality?: number; assistedById?: string; shotClockPressure?: boolean } = {},
): ShotAttempt {
  const from = v2(a.pos.x, a.pos.y);
  const distance = distToHoop(from, side);
  return {
    shooter: a,
    type,
    from,
    side,
    distance,
    zone: shotZone(from, side),
    value: shotValue(from, side),
    assisted: opts.assisted ?? false,
    assistQuality: opts.assistQuality ?? 0,
    assistedById: opts.assistedById,
    movement: len2(a.vel),
    shotClockPressure: opts.shotClockPressure ?? false,
  };
}

/** Bonus de arremesso concedido pelo passador (badge Garcom). */
export function assistBonusFrom(passer: Actor): number {
  return bv(passer, 'play.dimeBonus');
}

/** Atualiza hot/cold apos um arremesso (secao 19). */
export function updateHeat(a: Actor, made: boolean, value: 2 | 3): void {
  const delta = made ? (value === 3 ? 0.34 : 0.26) : -0.22;
  a.heat = clamp(a.heat + delta, -1, 1);
}

export function decayHeat(a: Actor, dt: number): void {
  a.heat *= Math.max(0, 1 - dt * 0.012);
}
