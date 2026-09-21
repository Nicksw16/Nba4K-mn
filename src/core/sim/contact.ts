/**
 * SISTEMA DE CONTATO (secao 12).
 *
 * Nenhum atleta atravessa outro. Toda sobreposicao e resolvida com correcao
 * posicional ponderada por massa + troca de impulso, e cada contato e
 * CLASSIFICADO (peito, ombro, quadril, screen, boxout, aterrissagem, bola solta)
 * porque os outros sistemas reagem de forma diferente a cada tipo.
 */
import { Vec2, add2, dot2, len2, mul2, norm2, sub2, v2, dist2, toAngle, fromAngle, angleDiff } from '../math/vec.js';
import { clamp, clamp01 } from '../math/util.js';
import { Actor, addCue, bv } from './actor.js';
import { Tuning } from '../config/tuning.js';

export type ContactType =
  | 'body_up'
  | 'chest'
  | 'shoulder'
  | 'hip'
  | 'screen'
  | 'boxout'
  | 'landing'
  | 'loose_ball'
  | 'incidental';

export interface ContactEvent {
  a: Actor;
  b: Actor;
  type: ContactType;
  /** Intensidade 0..1 derivada da massa e da velocidade relativa. */
  severity: number;
  /** Direcao do contato de a para b. */
  normal: Vec2;
  /** Velocidade de aproximacao (m/s). */
  closingSpeed: number;
  /** True quando `a` foi o agente ativo (quem chegou por cima). */
  aggressorIsA: boolean;
  /** Angulo do contato em relacao ao peito de quem sofre (0 = de frente). */
  frontality: number;
  /** True quando os dois chegaram igual: contato mutuo, sem responsavel claro. */
  mutual: boolean;
}

const POSITION_SLOP = 0.008;

/**
 * Resolve todas as sobreposicoes do frame e devolve os contatos relevantes.
 * `ballLoose` importa: um encontrao com a bola solta e disputa de bola; o mesmo
 * encontrao com a bola na mao de alguem e apenas contato fora da bola.
 */
export function resolveContacts(actors: Actor[], dt: number, t: Tuning, ballLoose = false): ContactEvent[] {
  const events: ContactEvent[] = [];
  const onCourt = actors.filter((a) => a.onCourt && a.state !== 'down');
  for (let i = 0; i < onCourt.length; i++) {
    for (let j = i + 1; j < onCourt.length; j++) {
      const ev = resolvePair(onCourt[i], onCourt[j], dt, t, ballLoose);
      if (ev) events.push(ev);
    }
  }
  return events;
}

function resolvePair(a: Actor, b: Actor, dt: number, t: Tuning, ballLoose: boolean): ContactEvent | null {
  // Atletas em alturas muito diferentes (um no ar, outro no chao) colidem menos.
  const zGap = Math.abs(a.z - b.z);
  const verticalFactor = clamp01(1 - zGap / 1.1);
  if (verticalFactor <= 0.01) return null;

  const d = sub2(b.pos, a.pos);
  const dist = len2(d);
  const minDist = (a.physics.radius + b.physics.radius) * 0.94;
  if (dist >= minDist || dist < 1e-6) return null;

  const normal = mul2(d, 1 / dist);
  const penetration = minDist - dist;

  const relVel = sub2(b.vel, a.vel);
  const closing = -dot2(relVel, normal); // >0 quando se aproximam

  // --- Correcao posicional ponderada por massa ---
  const ma = Math.max(35, a.physics.mass);
  const mb = Math.max(35, b.physics.mass);
  const invA = 1 / ma;
  const invB = 1 / mb;
  const invSum = invA + invB;

  // Quem esta plantado e forte cede menos terreno (o "hold ground" real).
  const anchorA = anchorStrength(a, t);
  const anchorB = anchorStrength(b, t);
  const shareA = (invA / invSum) * (1 - anchorA * 0.45);
  const shareB = (invB / invSum) * (1 - anchorB * 0.45);
  const norm = Math.max(1e-6, shareA + shareB);
  const corr = Math.max(0, penetration - POSITION_SLOP) * verticalFactor;

  a.pos = sub2(a.pos, mul2(normal, corr * (shareA / norm)));
  b.pos = add2(b.pos, mul2(normal, corr * (shareB / norm)));

  // --- Impulso ---
  let severity = 0;
  if (closing > 0.05) {
    const restitution = 0.06; // corpos humanos nao quicam
    const jImp = (-(1 + restitution) * -closing) / invSum;
    const impulse = mul2(normal, jImp * verticalFactor);
    a.vel = sub2(a.vel, mul2(impulse, invA));
    b.vel = add2(b.vel, mul2(impulse, invB));

    const reducedMass = (ma * mb) / (ma + mb);
    severity = clamp01((reducedMass * closing) / 420);
  }

  const type = classify(a, b, normal, closing, severity, ballLoose);

  // Quem e o agressor: quem se desloca MAIS na direcao do outro.
  // O desempate importa: comparar os dois produtos escalares direto fazia com
  // que empates (dois corpos quase parados) culpassem sempre o segundo ator da
  // lista - e como a lista e ordenada por time, um dos times cometia 3x mais
  // faltas do que o outro com elencos identicos.
  // `normal` aponta de a para b. A velocidade de aproximacao de cada um e a
  // componente da propria velocidade na direcao do OUTRO corpo.
  const aClosing = dot2(a.vel, normal);
  const bClosing = -dot2(b.vel, normal);
  const closingDelta = aClosing - bClosing;
  const aggressorIsA = Math.abs(closingDelta) < 0.15
    ? len2(a.vel) > len2(b.vel)
    : closingDelta > 0;
  const victim = aggressorIsA ? b : a;
  const aggressor = aggressorIsA ? a : b;
  const frontality = Math.abs(angleDiff(victim.heading, toAngle(mul2(normal, aggressorIsA ? -1 : 1))));

  if (severity > 0.02) {
    applyBalanceFromContact(victim, aggressor, severity, frontality, type, t);
    applyBalanceFromContact(aggressor, victim, severity * 0.45, 0, type, t);
    const drain = t.fatigue.contactDrain * severity;
    a.stamina = clamp01(a.stamina - drain * dt * 60);
    b.stamina = clamp01(b.stamina - drain * dt * 60);
    a.load += severity * dt;
    b.load += severity * dt;
  }

  if (severity < 0.015 && type === 'incidental') return null;

  return {
    a, b, type, severity, normal,
    closingSpeed: Math.max(0, closing),
    aggressorIsA,
    frontality,
    mutual: Math.abs(closingDelta) < 0.35,
  };
}

/** O quanto um atleta consegue nao ceder terreno: forca + base plantada + equilibrio. */
export function anchorStrength(a: Actor, t: Tuning): number {
  const strength = clamp01((a.effective.strength - 40) / 55);
  const planted = a.grounded ? (len2(a.vel) < 1.2 ? 1 : 0.55) : 0.1;
  const stance = a.state === 'boxout' || a.state === 'screen' || a.state === 'posture_post' ? 1.25 : 1;
  const hold = bv(a, 'phys.strengthHold');
  const lowCom = clamp01(1.05 - a.physics.com / 1.15);
  return clamp01(strength * 0.55 * stance * planted * (1 + hold) + lowCom * 0.2 + a.balance * 0.2);
}

function classify(a: Actor, b: Actor, normal: Vec2, closing: number, severity: number, ballLoose: boolean): ContactType {
  if (a.state === 'screen' || b.state === 'screen') return 'screen';
  if (a.state === 'boxout' || b.state === 'boxout') return 'boxout';
  if (!a.grounded || !b.grounded) return 'landing';
  // Disputa de bola solta so existe se a bola estiver realmente solta.
  if (ballLoose && !a.hasBall && !b.hasBall && severity > 0.12) return 'loose_ball';

  if (!a.hasBall && !b.hasBall) return severity > 0.22 ? 'shoulder' : 'incidental';

  const ballCarrier = a.hasBall ? a : b.hasBall ? b : null;
  if (ballCarrier) {
    const other = ballCarrier === a ? b : a;
    const dirToCarrier = norm2(sub2(ballCarrier.pos, other.pos));
    const facing = Math.abs(angleDiff(ballCarrier.heading, toAngle(mul2(dirToCarrier, -1))));
    if (severity < 0.1) return 'body_up';
    if (facing < 0.9) return 'chest';
    if (facing > 2.2) return 'hip';
    return 'shoulder';
  }
  return severity > 0.1 ? 'shoulder' : 'incidental';
}

function applyBalanceFromContact(victim: Actor, aggressor: Actor, severity: number, frontality: number, type: ContactType, t: Tuning): void {
  // Contato de frente e absorvido pelo peito; de lado ou nas costas derruba.
  const angleFactor = 0.45 + clamp01(frontality / Math.PI) * 0.9;
  const resist = bv(victim, 'phys.contactBalance');
  const strengthGap = clamp((aggressor.effective.strength - victim.effective.strength) / 60, -0.6, 0.9);
  const airborne = victim.grounded ? 1 : 1.6;
  let loss = severity * angleFactor * (1 + strengthGap) * airborne * 0.55;
  loss *= 1 - clamp01(resist) * 0.45;
  if (type === 'screen') loss *= 1.35;
  if (type === 'boxout') loss *= 0.8;
  victim.balance = clamp01(victim.balance - loss);
  if (loss > 0.2) addCue(victim, 'contact_stagger');
}

/**
 * BODY-UP / CONTENCAO (secoes 21, 22).
 * O defensor nao teleporta na frente: ele aplica uma forca lateral de
 * contencao que so funciona se ele realmente estiver a frente do atacante.
 */
export interface CutoffResult {
  applied: boolean;
  /** Quanto o atacante foi redirecionado (m/s^2). */
  force: number;
  /** 0..1 - qualidade da posicao defensiva. */
  quality: number;
}

export function applyCutoff(defender: Actor, attacker: Actor, driveDir: Vec2, dt: number, t: Tuning): CutoffResult {
  const toDef = sub2(defender.pos, attacker.pos);
  const dist = len2(toDef);
  if (dist > t.defense.bodyUpRange * 1.9 || dist < 1e-4) return { applied: false, force: 0, quality: 0 };

  const dir = norm2(driveDir.x === 0 && driveDir.y === 0 ? (len2(attacker.vel) > 0.2 ? attacker.vel : fromAngle(attacker.heading)) : driveDir);
  const ahead = dot2(norm2(toDef), dir); // 1 = defensor exatamente na frente
  if (ahead < 0.15) return { applied: false, force: 0, quality: clamp01(ahead) };

  // Qualidade = estar na frente + quadril orientado + equilibrio + agilidade lateral.
  const hipAlign = 1 - Math.abs(angleDiff(defender.hipHeading, toAngle(mul2(dir, -1)))) / Math.PI;
  const lateral = clamp01((defender.effective.lateralQuickness - 40) / 55);
  const quality = clamp01(ahead * 0.5 + hipAlign * 0.2 + lateral * 0.15 + defender.balance * 0.15);

  // Forca perpendicular a direcao da arrancada: empurra o atacante para fora da linha.
  const perp = v2(-dir.y, dir.x);
  const side = dot2(sub2(attacker.pos, defender.pos), perp) >= 0 ? 1 : -1;
  const strengthTerm = 0.65 + clamp01((defender.effective.strength - 40) / 60) * 0.7;
  const proximity = clamp01(1 - (dist - t.defense.bodyUpRange * 0.5) / t.defense.bodyUpRange);
  const magnitude = t.defense.cutoffForce * quality * strengthTerm * proximity;

  attacker.vel = add2(attacker.vel, mul2(perp, side * magnitude * dt));
  // Frear o avanco tambem: contencao boa tira velocidade.
  const brakeTerm = magnitude * 0.42 * dt;
  const forward = dot2(attacker.vel, dir);
  if (forward > 0) attacker.vel = sub2(attacker.vel, mul2(dir, Math.min(forward, brakeTerm)));

  defender.stamina = clamp01(defender.stamina - t.fatigue.defenseDrain * quality * dt * 60);
  attacker.stamina = clamp01(attacker.stamina - t.fatigue.contactDrain * 0.4 * quality * dt * 60);

  return { applied: true, force: magnitude, quality };
}

/**
 * SCREEN (bloqueio). O bloqueador vira um obstaculo fisico real: ele nao
 * "cola" o defensor, apenas ocupa espaco com massa e postura.
 */
export function setScreen(screener: Actor, dt: number): void {
  screener.state = 'screen';
  screener.vel = mul2(screener.vel, Math.max(0, 1 - dt * 9));
}

export function releaseScreen(screener: Actor): void {
  if (screener.state === 'screen') screener.state = 'idle';
}

/** Qualidade de navegacao do defensor por um bloqueio. */
export function screenNavigation(defender: Actor, screener: Actor, t: Tuning): number {
  const agility = clamp01((defender.effective.agility - 40) / 55);
  const iq = clamp01((defender.effective.defensiveIQ - 40) / 55);
  const badge = bv(defender, 'def.screenNavigation');
  const screenerMass = clamp01((screener.physics.mass - 80) / 50);
  const quality = bv(screener, 'reb.screenSet');
  return clamp01(agility * 0.4 + iq * 0.3 + badge * 0.5 - screenerMass * 0.25 - quality * 0.3 + 0.25);
}

/** BOXOUT (secao 24): posicionar-se entre o adversario e o aro, com contato. */
export function applyBoxout(boxer: Actor, target: Actor, hoop: Vec2, dt: number, t: Tuning): number {
  const toHoop = norm2(sub2(hoop, boxer.pos));
  const betweenness = clamp01(dot2(norm2(sub2(target.pos, boxer.pos)), mul2(toHoop, -1)));
  if (betweenness < 0.1) return 0;
  const d = dist2(boxer.pos, target.pos);
  if (d > 1.5) return betweenness * 0.3;

  boxer.state = 'boxout';
  const strength = clamp01((boxer.effective.strength - 40) / 55);
  const badge = bv(boxer, 'reb.boxout');
  const power = (0.55 + strength * 0.8 + badge) * betweenness;
  const push = mul2(mul2(toHoop, -1), power * 5.2 * dt);
  target.vel = add2(target.vel, push);
  target.balance = clamp01(target.balance - power * 0.04 * dt * 60 * 0.02);
  boxer.stamina = clamp01(boxer.stamina - t.fatigue.contactDrain * 0.5 * dt * 60);
  return clamp01(power * 0.6);
}
