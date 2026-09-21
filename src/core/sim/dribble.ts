/**
 * ENGINE DE DRIBLE (secoes 6, 7, 8, 14, 121).
 *
 * Cada move e um DADO, nao uma animacao fixa: declara duracao, direcao de
 * saida, quanto vende a direcao errada (misdirection), quanto expoe a bola e
 * quanto custa. O corpo executa via locomocao normal - o move so define a
 * INTENCAO de velocidade durante sua janela. Por isso um pivo pesado executa o
 * mesmo crossover mais devagar do que um armador agil, sem nenhuma regra extra.
 *
 * ANKLE BREAKER (secao 8) nao tem RNG de animacao. Ele mede:
 *   leverage = quanto o peso do defensor esta comprometido na direcao OPOSTA
 *              a saida do atacante
 * e converte isso em perda de equilibrio. Se o defensor nao se comprometeu,
 * nao existe ankle breaker por mais bonito que seja o move.
 */
import { Vec2, add2, dot2, fromAngle, len2, mul2, norm2, rotate2, sub2, toAngle, v2, angleDiff } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor, addCue, bv, movePenalty, noteMove, startAction } from './actor.js';
import { Tuning } from '../config/tuning.js';
import { Rng } from '../math/rng.js';
import { LocomotionIntent } from './locomotion.js';

export type MoveFamily = 'stationary' | 'size_up' | 'combo' | 'escape' | 'misdirection' | 'lateral' | 'spin' | 'signature';

export interface DribbleMove {
  id: string;
  name: string;
  family: MoveFamily;
  /** Duracao base (s), escalada por ball handle e agilidade. */
  duration: number;
  /** Componente lateral da saida: -1 esquerda, +1 direita, 0 frontal. */
  lateral: number;
  /** Componente para tras (escapes e stepbacks). */
  retreat: number;
  /** Ganho base de separacao (m). */
  separation: number;
  /** 0..1 - quanto o move vende a direcao contraria antes de sair. */
  misdirection: number;
  /** 0..1 - exposicao da bola a roubo durante o move. */
  exposure: number;
  /** 0..1 - quanto da velocidade de avanco e preservada. */
  speedPreserve: number;
  /** Multiplicadores de custo. */
  staminaCost: number;
  adrenalineCost: number;
  /** Ball handle minimo para executar bem. */
  minBallHandle: number;
  /** True para moves explosivos (consomem adrenalina de verdade). */
  explosive: boolean;
}

const M = (
  id: string, name: string, family: MoveFamily, duration: number, lateral: number, retreat: number,
  separation: number, misdirection: number, exposure: number, speedPreserve: number,
  staminaCost: number, adrenalineCost: number, minBallHandle: number, explosive = false,
): DribbleMove => ({ id, name, family, duration, lateral, retreat, separation, misdirection, exposure, speedPreserve, staminaCost, adrenalineCost, minBallHandle, explosive });

/** Os 28 componentes do arsenal (secao 6). Cada um pode ser equipado separadamente. */
export const DRIBBLE_MOVES: DribbleMove[] = [
  M('triple_threat', 'Triple Threat', 'stationary', 0.35, 0, 0, 0.05, 0.15, 0.1, 0.2, 0.3, 0, 30),
  M('triple_threat_breakdown', 'Triple Threat Breakdown', 'stationary', 0.55, 0.3, 0, 0.18, 0.4, 0.2, 0.25, 0.6, 0.3, 55),
  M('jab_step', 'Jab Step', 'stationary', 0.3, 0.6, 0, 0.14, 0.55, 0.12, 0.3, 0.4, 0.2, 40),
  M('stepover', 'Stepover', 'stationary', 0.45, 0.7, 0, 0.22, 0.6, 0.22, 0.35, 0.6, 0.35, 62),
  M('size_up', 'Signature Size-Up', 'size_up', 0.6, 0.4, 0.1, 0.2, 0.5, 0.18, 0.3, 0.7, 0.3, 60),
  M('moving_breakdown', 'Moving Breakdown', 'size_up', 0.55, 0.5, 0, 0.26, 0.5, 0.24, 0.6, 0.8, 0.4, 70),
  M('breakdown_combo', 'Breakdown Combo', 'combo', 0.85, 0.8, 0.05, 0.34, 0.65, 0.34, 0.45, 1.2, 0.7, 78),
  M('combo_move', 'Combo Move', 'combo', 0.8, 0.9, 0, 0.36, 0.6, 0.35, 0.55, 1.15, 0.75, 76),
  M('crossover', 'Crossover', 'lateral', 0.42, 1, 0, 0.32, 0.7, 0.28, 0.6, 0.65, 0.5, 55, true),
  M('moving_crossover', 'Moving Crossover', 'lateral', 0.4, 1, 0, 0.38, 0.72, 0.3, 0.85, 0.75, 0.6, 68, true),
  M('between_legs', 'Between the Legs', 'lateral', 0.48, 0.9, 0.05, 0.28, 0.6, 0.18, 0.55, 0.6, 0.45, 60),
  M('behind_back', 'Behind the Back', 'lateral', 0.52, 1, 0.1, 0.34, 0.68, 0.22, 0.5, 0.8, 0.55, 72),
  M('spin', 'Spin Move', 'spin', 0.62, 0.8, 0, 0.4, 0.45, 0.4, 0.7, 1.0, 0.8, 70, true),
  M('hesitation', 'Hesitation', 'misdirection', 0.38, 0.3, 0, 0.3, 0.8, 0.14, 0.8, 0.5, 0.45, 55, true),
  M('stepback', 'Stepback', 'escape', 0.5, 0.2, 1, 0.45, 0.35, 0.2, 0.2, 0.8, 0.6, 68, true),
  M('hesitation_escape', 'Hesitation Escape', 'escape', 0.46, 0.4, 0.8, 0.4, 0.62, 0.18, 0.3, 0.75, 0.55, 70),
  M('crossover_escape', 'Crossover Escape', 'escape', 0.5, 0.9, 0.7, 0.44, 0.6, 0.26, 0.3, 0.85, 0.6, 74),
  M('between_legs_escape', 'Between Legs Escape', 'escape', 0.54, 0.8, 0.75, 0.42, 0.55, 0.2, 0.28, 0.8, 0.55, 72),
  M('behind_back_escape', 'Behind the Back Escape', 'escape', 0.56, 0.95, 0.8, 0.46, 0.6, 0.24, 0.28, 0.9, 0.62, 78),
  M('misdirection_hesitation', 'Misdirection Hesitation', 'misdirection', 0.5, 0.5, 0, 0.36, 0.9, 0.2, 0.7, 0.8, 0.6, 76, true),
  M('misdirection_crossover', 'Misdirection Crossover', 'misdirection', 0.52, 1, 0, 0.42, 0.92, 0.3, 0.7, 0.95, 0.7, 80, true),
  M('misdirection_behind_back', 'Misdirection Behind the Back', 'misdirection', 0.58, 1, 0.05, 0.44, 0.9, 0.3, 0.6, 1.0, 0.72, 84, true),
  M('double_crossover', 'Double Crossover', 'combo', 0.66, 1, 0, 0.4, 0.78, 0.34, 0.6, 1.0, 0.7, 80, true),
  M('stepback_crossover', 'Stepback Crossover', 'combo', 0.72, 0.9, 0.7, 0.5, 0.7, 0.32, 0.3, 1.15, 0.8, 84, true),
  M('lateral_stepback', 'Lateral Stepback', 'escape', 0.48, 1, 0.5, 0.44, 0.5, 0.22, 0.35, 0.85, 0.65, 76, true),
  M('moving_cross_spin', 'Moving Cross Spin', 'spin', 0.78, 0.9, 0, 0.5, 0.6, 0.42, 0.75, 1.25, 0.9, 86, true),
  M('in_and_out', 'In and Out', 'misdirection', 0.44, 0.8, 0, 0.34, 0.85, 0.24, 0.75, 0.7, 0.55, 74, true),
  M('lateral_hesitation', 'Lateral Hesitation', 'lateral', 0.44, 0.9, 0.1, 0.32, 0.75, 0.2, 0.7, 0.7, 0.5, 70),
];

export const MOVE_BY_ID = new Map(DRIBBLE_MOVES.map((m) => [m.id, m]));

/** Moves liberados pelo atributo do atleta (o arsenal que ele CONSEGUE usar). */
export function availableMoves(ballHandle: number, equipped?: string[]): DribbleMove[] {
  const pool = equipped && equipped.length
    ? DRIBBLE_MOVES.filter((m) => equipped.includes(m.id) || m.family === 'stationary')
    : DRIBBLE_MOVES;
  return pool.filter((m) => ballHandle >= m.minBallHandle - 6);
}

export interface DribbleExecution {
  move: DribbleMove;
  /** Direcao de saida no mundo. */
  exitDir: Vec2;
  /** Direcao vendida antes da saida (para onde o corpo finge ir). */
  sellDir: Vec2;
  /** Duracao real ajustada por atributo/fadiga. */
  duration: number;
  /** Momento (s) em que o corpo troca de direcao - o ponto do ankle breaker. */
  breakAt: number;
  /** Qualidade da execucao 0..1. */
  quality: number;
  /** Separacao teorica gerada. */
  separation: number;
  /** Penalidade por repeticao (anti-cheese). */
  repetition: number;
}

/**
 * Inicia um move. Nao move ninguem por si: prepara a acao. O deslocamento
 * acontece nos frames seguintes via dribbleIntent().
 */
export function startDribbleMove(
  a: Actor,
  moveId: string,
  side: -1 | 1,
  aimDir: Vec2,
  t: Tuning,
  rng: Rng,
): DribbleExecution | null {
  const move = MOVE_BY_ID.get(moveId);
  if (!move) return null;

  const bh = a.effective.ballHandle;
  const skill = clamp01((bh - (move.minBallHandle - 20)) / 40);
  const agility = attr01(a.effective.agility);
  const repetition = movePenalty(a, move.id, t);
  noteMove(a, move.id, t);

  // Mao fraca custa qualidade.
  const handPenalty = (side === 1 && a.profile.physique.handedness === 'left') || (side === -1 && a.profile.physique.handedness === 'right')
    ? 0.06 : 0;

  const quality = clamp01(skill * 0.6 + agility * 0.25 + a.balance * 0.15 - repetition - handPenalty)
    * (0.75 + a.stamina * 0.25);

  // Duracao: mais habilidade = move mais rapido; fadiga e inercia atrasam.
  const duration = move.duration * lerp(1.22, 0.82, skill) * lerp(1, 1.14, 1 - a.stamina) * lerp(1, 1.1, clamp01(a.physics.inertia - 1));
  const breakAt = duration * lerp(0.62, 0.45, skill);

  const forward = len2(aimDir) > 0.01 ? norm2(aimDir) : fromAngle(a.heading);
  const perp = v2(-forward.y, forward.x);
  const exitDir = norm2(add2(
    mul2(forward, 1 - Math.abs(move.lateral) * 0.55 - move.retreat * 0.9),
    add2(mul2(perp, move.lateral * side), mul2(forward, -move.retreat * 1.1)),
  ));
  const sellDir = norm2(add2(mul2(perp, -move.lateral * side * move.misdirection), mul2(forward, 0.4)));

  const separationBadge = bv(a, 'play.separation');
  const separation = t.dribble.separationBase * move.separation * 2.2 * (0.6 + quality * 0.8) * (1 + separationBadge);

  const staminaBadge = bv(a, 'play.moveStamina') + bv(a, 'phys.staminaCost');
  a.stamina = clamp01(a.stamina - t.dribble.staminaCostBase * move.staminaCost * (1 - clamp01(staminaBadge) * 0.5));
  if (move.explosive) {
    a.adrenaline = clamp01(a.adrenaline - t.adrenaline.explosiveMoveCost * move.adrenalineCost);
  }

  startAction(a, 'dribble_move', duration, breakAt, {
    moveId: move.id,
    exitDir,
    sellDir,
    breakAt,
    quality,
    separation,
    side,
  }, false);

  addCue(a, `move_${move.id}`);
  return { move, exitDir, sellDir, duration, breakAt, quality, separation, repetition };
}

/**
 * Intencao de locomocao durante o move. Antes do ponto de quebra o corpo
 * vende a direcao contraria; depois, explode na direcao de saida.
 */
export function dribbleIntent(a: Actor, t: Tuning): LocomotionIntent | null {
  if (a.action.kind !== 'dribble_move') return null;
  const d = a.action.data as { moveId: string; exitDir: Vec2; sellDir: Vec2; breakAt: number; quality: number };
  const move = MOVE_BY_ID.get(d.moveId);
  if (!move) return null;

  const beforeBreak = a.action.t < d.breakAt;
  const dir = beforeBreak ? d.sellDir : d.exitDir;
  const intensity = beforeBreak
    ? 0.45 + move.misdirection * 0.45
    : 0.85 + d.quality * 0.3;

  return {
    move: mul2(dir, intensity),
    sprint: !beforeBreak && move.explosive,
    facing: beforeBreak ? toAngle(d.sellDir) : toAngle(d.exitDir),
    stance: 'dribble',
    brake: false,
  };
}

export interface AnkleBreakResult {
  /** Quanto de equilibrio o defensor perdeu. */
  balanceLost: number;
  /** True quando o defensor efetivamente quebrou (cai ou fica fora da jogada). */
  broken: boolean;
  /** Alavancagem medida: >0 significa que o defensor estava comprometido ao contrario. */
  leverage: number;
  /** Separacao real conquistada (m). */
  separation: number;
}

/**
 * Resolve o momento de quebra. Chamado uma unica vez, quando a acao atinge
 * breakAt. Tudo aqui e causal: o resultado vem da geometria e do momentum.
 */
export function resolveBreakPoint(attacker: Actor, defender: Actor | undefined, t: Tuning): AnkleBreakResult {
  const d = attacker.action.data as { exitDir: Vec2; quality: number; separation: number; moveId: string };
  const move = MOVE_BY_ID.get(d.moveId);
  const empty: AnkleBreakResult = { balanceLost: 0, broken: false, leverage: 0, separation: d?.separation ?? 0 };
  if (!defender || !move) return empty;

  const exitDir = norm2(d.exitDir);

  // 1) Quanto o defensor comprometeu o peso na direcao ERRADA.
  //    weightShift aponta para onde ele acelerou; se aponta contra a saida,
  //    ele tera que inverter o proprio momentum - e isso custa tempo real.
  const shift = defender.weightShift;
  const shiftMag = Math.hypot(shift.x, shift.y);
  const leverage = shiftMag > 0.02 ? clamp(-dot2(norm2(shift), exitDir), -1, 1) * clamp01(shiftMag) : 0;

  // 2) Momentum defensivo bruto: correr forte para o lado errado e pior ainda.
  const defSpeed = len2(defender.vel);
  const momentumTerm = defSpeed > 0.5
    ? clamp(-dot2(norm2(defender.vel), exitDir), -1, 1) * clamp01(defSpeed / Math.max(1, defender.physics.topSpeed))
    : 0;

  // 3) Capacidade de recuperacao do defensor.
  const recovery = clamp01(
    attr01(defender.effective.lateralQuickness) * 0.45 +
    attr01(defender.effective.agility) * 0.2 +
    defender.balance * 0.25 +
    clamp01(defender.stamina) * 0.1,
  );

  // 4) Proximidade: um defensor a 4 m nao tem tornozelo a perder.
  const dist = Math.hypot(defender.pos.x - attacker.pos.x, defender.pos.y - attacker.pos.y);
  const proximity = clamp01(1 - (dist - 0.8) / 2.4);

  const attackerEdge = clamp01(
    attr01(attacker.effective.ballHandle) * 0.5 +
    d.quality * 0.35 +
    attr01(attacker.effective.speedWithBall) * 0.15,
  );
  const ankleBadge = bv(attacker, 'play.ankleBreak');

  const rawLeverage = clamp01(leverage * t.dribble.momentumLeverage + momentumTerm * 0.55 + move.misdirection * 0.22);
  const severity = clamp01(
    rawLeverage * (0.55 + attackerEdge * 0.75) * proximity * (1 + ankleBadge) - recovery * 0.55,
  );

  const balanceLost = severity * t.dribble.defenderBalanceScale;
  defender.balance = clamp01(defender.balance - balanceLost);

  const broken = severity >= t.dribble.ankleBreakThreshold && defender.balance < t.locomotion.stumbleThreshold + 0.08;
  if (broken) {
    defender.state = 'stumble';
    // O defensor mantem o momentum errado: ele continua indo para o lado errado.
    defender.vel = mul2(defender.vel, 0.55);
    addCue(defender, 'ankle_broken');
    addCue(attacker, 'ankle_break_reaction');
  } else if (severity > 0.15) {
    addCue(defender, 'off_balance');
  }

  const separation = d.separation * (1 + severity * 1.4);
  return { balanceLost, broken, leverage: rawLeverage, separation };
}

/**
 * SEGURANCA DA BOLA (secao 14).
 * Chance de perder o controle a cada frame sob pressao/contato/trafego.
 */
export interface BallSecurityContext {
  /** Defensores dentro do raio de pressao. */
  pressure: number;
  /** Contato recente (0..1). */
  contact: number;
  /** Exposicao do move atual. */
  exposure: number;
  /** Trafego: quantos corpos perto. */
  traffic: number;
}

/** Retorna o risco por SEGUNDO de perder a bola (multiplicar por dt). */
export function ballSecurityRisk(a: Actor, ctx: BallSecurityContext, t: Tuning): number {
  const handle = attr01(a.effective.ballHandle);
  const hands = attr01(a.effective.hands);
  const strength = attr01(a.effective.strength);
  const security = bv(a, 'play.ballSecurity');

  const base = t.dribble.fumbleBase
    * (1 + ctx.pressure * 2.2 + ctx.contact * 2.6 + ctx.exposure * 1.8 + ctx.traffic * 0.5)
    * (1 - a.balance * 0.35);

  const control = clamp01(handle * 0.5 + hands * 0.22 + strength * 0.13 + clamp01(security) * 0.3 + a.stamina * 0.1);
  return clamp01(base * (1.45 - control));
}

/** Rola o risco de fumble. Retorna true se a bola escapou. */
export function rollFumble(a: Actor, ctx: BallSecurityContext, dt: number, t: Tuning, rng: Rng): boolean {
  const risk = ballSecurityRisk(a, ctx, t) * dt;
  if (rng.chance(risk)) {
    addCue(a, 'fumble');
    return true;
  }
  return false;
}

/** Escolhe o move mais adequado ao contexto (usado pela IA e pelo auto-assist). */
export function pickMove(
  a: Actor,
  defenderShift: Vec2 | undefined,
  desiredDir: Vec2,
  spaceAhead: number,
  shotClock: number,
  rng: Rng,
  equipped?: string[],
): { move: DribbleMove; side: -1 | 1 } | null {
  const pool = availableMoves(a.effective.ballHandle, equipped);
  if (!pool.length) return null;
  const forward = len2(desiredDir) > 0.01 ? norm2(desiredDir) : fromAngle(a.heading);
  const perp = v2(-forward.y, forward.x);

  // Se o defensor comprometeu peso para um lado, sair para o outro e o melhor move.
  let preferredSide: -1 | 1 = rng.sign() as -1 | 1;
  if (defenderShift) {
    const lateralCommit = dot2(defenderShift, perp);
    if (Math.abs(lateralCommit) > 0.08) preferredSide = (lateralCommit > 0 ? -1 : 1) as -1 | 1;
  }

  const entries = pool.map((move) => {
    let w = 1;
    // Sem espaco a frente: escapes e stepbacks valem mais.
    if (spaceAhead < 1.4) w *= move.retreat > 0.4 ? 2.4 : 0.5;
    else w *= move.retreat > 0.4 ? 0.5 : 1.3;
    // Relogio curto: moves rapidos.
    if (shotClock < 6) w *= move.duration < 0.5 ? 1.8 : 0.5;
    // Tendencia de combos.
    if (move.family === 'combo') w *= 0.5 + (a.profile.tendencies.comboMoves / 100) * 1.8;
    if (move.family === 'size_up' || move.family === 'stationary') w *= 0.4 + (a.profile.tendencies.sizeUp / 100) * 1.6;
    if (move.family === 'misdirection') w *= 0.7 + (a.profile.tendencies.comboMoves / 100) * 1.2;
    // Anti-cheese: repetir custa peso.
    w *= 1 - movePenalty(a, move.id, { dribble: { repetitionPenalty: 0.22 } } as unknown as Tuning) * 0.9;
    // Stamina baixa evita explosivos.
    if (move.explosive && a.adrenaline < 0.25) w *= 0.25;
    return { item: move, weight: Math.max(0.01, w) };
  });

  const move = rng.weighted(entries);
  return move ? { move, side: preferredSide } : null;
}
