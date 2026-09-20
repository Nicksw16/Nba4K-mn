/**
 * FISICA DA BOLA (secao 13).
 *
 * A bola e um corpo independente. Nunca e "colada" na mao: quando um atleta
 * tem posse, a posicao da bola e escrita a partir da mao dele, mas assim que
 * sai (arremesso, passe, poke, fumble) ela volta a ser integrada com
 * gravidade, arrasto, efeito Magnus e colisoes reais com aro, tabela e chao.
 *
 * O aro e tratado como um toro: calcula-se o ponto mais proximo no circulo do
 * aro e reflete-se a velocidade na normal daquele ponto. E por isso que uma
 * bola pode rodar na borda e cair para dentro ou para fora.
 */
import { Vec2, Vec3, v2, v3, add3, mul3, sub3, len3, norm3, flat } from '../math/vec.js';
import { clamp, clamp01 } from '../math/util.js';
import { COURT, Side, backboardPlaneX, hoopPos } from '../config/court.js';
import { Tuning } from '../config/tuning.js';

export type BallState =
  | 'held'
  | 'dribbling'
  | 'shot'
  | 'pass'
  | 'loose'
  | 'rolling'
  | 'dead';

export interface Ball {
  pos: Vec3;
  vel: Vec3;
  /** Rotacao: eixo horizontal (backspin positivo) e lateral. */
  spin: Vec3;
  state: BallState;
  /** Dono atual (id) quando state = held/dribbling. */
  ownerId?: string;
  /** Quem lancou por ultimo (para creditos e goaltending). */
  lastTouchId?: string;
  lastShooterId?: string;
  /** Cesta alvo do arremesso em voo. */
  targetSide?: Side;
  /** Marcado como arremesso valido (para rebote/estatistica). */
  shotContext?: ShotContext;
  /** Alvo do passe em voo. */
  passTargetId?: string;
  /** Tempo no estado atual. */
  age: number;
  /** Altura do quique de drible alvo. */
  dribbleHeight: number;
}

export interface ShotContext {
  shooterId: string;
  from: Vec2;
  value: 2 | 3;
  /** Probabilidade calculada no release: usada para decidir make/miss. */
  probability: number;
  /** Resultado ja sorteado no release (a fisica apenas encena a trajetoria). */
  willMake: boolean;
  contest: number;
  timing: number;
  zone: string;
  assistedById?: string;
  isFreeThrow?: boolean;
  andOne?: boolean;
  /** Quando true, a bola ja foi resolvida (evita contar duas vezes). */
  resolved: boolean;
  /** Tocada por defensor: bloqueio. */
  blockedById?: string;
}

export type BallEventKind =
  | 'floor_bounce'
  | 'rim_hit'
  | 'backboard_hit'
  | 'made'
  | 'miss_through'
  | 'out_of_bounds'
  | 'caught'
  | 'settled';

export interface BallEvent {
  kind: BallEventKind;
  pos: Vec3;
  speed: number;
  side?: Side;
}

export function createBall(): Ball {
  return {
    pos: v3(COURT.length / 2, COURT.width / 2, 1.1),
    vel: v3(),
    spin: v3(),
    state: 'dead',
    age: 0,
    dribbleHeight: 0.85,
  };
}

const RIM_TUBE = 0.0095;

/** Integra a bola um passo. Retorna eventos ocorridos. */
export function stepBall(ball: Ball, dt: number, t: Tuning): BallEvent[] {
  const events: BallEvent[] = [];
  ball.age += dt;
  if (ball.state === 'held' || ball.state === 'dead') return events;

  const prev = v3(ball.pos.x, ball.pos.y, ball.pos.z);

  // --- Forcas ---
  const speed = len3(ball.vel);
  // Arrasto quadratico simplificado.
  if (speed > 0.01) {
    const dragAcc = mul3(norm3(ball.vel), -t.ball.drag * speed);
    ball.vel = add3(ball.vel, mul3(dragAcc, dt));
  }
  // Magnus: backspin gera sustentacao; sidespin curva a trajetoria.
  if (speed > 0.5) {
    const w = ball.spin;
    const vdir = norm3(ball.vel);
    const magnus = v3(
      (w.y * vdir.z - w.z * vdir.y) * t.ball.magnus,
      (w.z * vdir.x - w.x * vdir.z) * t.ball.magnus,
      (w.x * vdir.y - w.y * vdir.x) * t.ball.magnus,
    );
    ball.vel = add3(ball.vel, mul3(magnus, dt));
  }
  ball.vel.z -= t.sim.gravity * dt;
  ball.spin = mul3(ball.spin, Math.max(0, 1 - t.ball.spinDecay * dt));

  ball.pos = add3(ball.pos, mul3(ball.vel, dt));

  // --- Colisoes ---
  for (const side of [0, 1] as Side[]) {
    const bb = collideBackboard(ball, side, prev, t);
    if (bb) events.push(bb);
    const rim = collideRim(ball, side, t);
    if (rim) events.push(rim);
    const scored = checkThroughHoop(ball, side, prev);
    if (scored) events.push(scored);
  }

  // Chao
  if (ball.pos.z <= t.ball.radius) {
    const impact = Math.abs(ball.vel.z);
    ball.pos.z = t.ball.radius;
    if (impact > 0.4) {
      ball.vel.z = impact * t.ball.restitutionFloor;
      ball.vel.x *= 1 - t.ball.friction * 0.35;
      ball.vel.y *= 1 - t.ball.friction * 0.35;
      // O backspin vira velocidade horizontal ao tocar o chao.
      ball.vel.x += ball.spin.y * 0.035;
      ball.vel.y -= ball.spin.x * 0.035;
      ball.spin = mul3(ball.spin, 0.55);
      events.push({ kind: 'floor_bounce', pos: v3(ball.pos.x, ball.pos.y, ball.pos.z), speed: impact });
    } else {
      ball.vel.z = 0;
      ball.vel.x *= 1 - dt * 1.6;
      ball.vel.y *= 1 - dt * 1.6;
      if (ball.state !== 'rolling' && ball.state !== 'dribbling') ball.state = 'rolling';
      if (Math.hypot(ball.vel.x, ball.vel.y) < t.ball.restSpeed) {
        ball.vel.x = 0;
        ball.vel.y = 0;
        events.push({ kind: 'settled', pos: v3(ball.pos.x, ball.pos.y, ball.pos.z), speed: 0 });
      }
    }
  }

  // Fora de quadra (a bola sai; quem estava com ela por ultimo perde a posse)
  if (ball.state !== 'dribbling' && isBallOut(ball)) {
    events.push({ kind: 'out_of_bounds', pos: v3(ball.pos.x, ball.pos.y, ball.pos.z), speed: len3(ball.vel) });
  }

  return events;
}

export function isBallOut(ball: Ball): boolean {
  return ball.pos.x < -0.05 || ball.pos.x > COURT.length + 0.05 || ball.pos.y < -0.05 || ball.pos.y > COURT.width + 0.05;
}

function collideRim(ball: Ball, side: Side, t: Tuning): BallEvent | null {
  const hoop = hoopPos(side);
  const dx = ball.pos.x - hoop.x;
  const dy = ball.pos.y - hoop.y;
  const horiz = Math.hypot(dx, dy);
  // Fora do alcance do aro
  if (Math.abs(ball.pos.z - hoop.z) > t.ball.radius + RIM_TUBE + 0.03) return null;
  if (Math.abs(horiz - COURT.rimRadius) > t.ball.radius + RIM_TUBE + 0.03) return null;
  if (horiz < 1e-6) return null;

  // Ponto mais proximo no circulo do aro
  const nx = hoop.x + (dx / horiz) * COURT.rimRadius;
  const ny = hoop.y + (dy / horiz) * COURT.rimRadius;
  const nz = hoop.z;
  const toBall = v3(ball.pos.x - nx, ball.pos.y - ny, ball.pos.z - nz);
  const dist = len3(toBall);
  const minDist = t.ball.radius + RIM_TUBE;
  if (dist >= minDist || dist < 1e-6) return null;

  const n = mul3(toBall, 1 / dist);
  // Separacao
  ball.pos = add3(ball.pos, mul3(n, minDist - dist + 0.001));
  const vn = ball.vel.x * n.x + ball.vel.y * n.y + ball.vel.z * n.z;
  if (vn < 0) {
    const impulse = -(1 + t.ball.restitutionRim) * vn;
    ball.vel = add3(ball.vel, mul3(n, impulse));
    // Atrito tangencial: a bola perde energia e ganha rotacao na borda.
    const vt = sub3(ball.vel, mul3(n, ball.vel.x * n.x + ball.vel.y * n.y + ball.vel.z * n.z));
    ball.vel = add3(mul3(n, ball.vel.x * n.x + ball.vel.y * n.y + ball.vel.z * n.z), mul3(vt, 1 - t.ball.friction * 0.5));
    ball.spin = add3(mul3(ball.spin, 0.7), v3(vt.y * 2.2, -vt.x * 2.2, 0));
  }
  return { kind: 'rim_hit', pos: v3(ball.pos.x, ball.pos.y, ball.pos.z), speed: Math.abs(vn), side };
}

function collideBackboard(ball: Ball, side: Side, prev: Vec3, t: Tuning): BallEvent | null {
  const planeX = backboardPlaneX(side);
  const inward = side === 0 ? 1 : -1;
  // A face relevante e a voltada para dentro da quadra.
  const faceX = planeX + inward * 0.0;
  const halfW = COURT.backboardWidth / 2;
  const withinY = Math.abs(ball.pos.y - COURT.width / 2) <= halfW;
  const withinZ = ball.pos.z >= COURT.backboardBottom && ball.pos.z <= COURT.backboardBottom + COURT.backboardHeight;
  if (!withinY || !withinZ) return null;

  const before = (prev.x - faceX) * inward;
  const after = (ball.pos.x - faceX) * inward;
  const touching = after < t.ball.radius;
  const crossed = before >= t.ball.radius && touching;
  if (!crossed && !(touching && after > -0.25)) return null;

  ball.pos.x = faceX + inward * t.ball.radius;
  if (ball.vel.x * inward < 0) {
    ball.vel.x = -ball.vel.x * t.ball.restitutionBackboard;
    ball.vel.y *= 1 - t.ball.friction * 0.25;
    ball.vel.z *= 1 - t.ball.friction * 0.18;
    ball.spin = mul3(ball.spin, 0.5);
  }
  return { kind: 'backboard_hit', pos: v3(ball.pos.x, ball.pos.y, ball.pos.z), speed: Math.abs(ball.vel.x), side };
}

/** Deteccao de cesta: centro da bola cruza o plano do aro descendo, dentro do circulo. */
function checkThroughHoop(ball: Ball, side: Side, prev: Vec3): BallEvent | null {
  const hoop = hoopPos(side);
  if (!(prev.z > hoop.z && ball.pos.z <= hoop.z)) return null;
  if (ball.vel.z >= 0) return null;
  const tt = (prev.z - hoop.z) / Math.max(1e-6, prev.z - ball.pos.z);
  const cx = prev.x + (ball.pos.x - prev.x) * tt;
  const cy = prev.y + (ball.pos.y - prev.y) * tt;
  const horiz = Math.hypot(cx - hoop.x, cy - hoop.y);
  if (horiz <= COURT.rimRadius - 0.035) {
    return { kind: 'made', pos: v3(cx, cy, hoop.z), speed: Math.abs(ball.vel.z), side };
  }
  return null;
}

/** Coloca a bola na mao de um ator (posicao da mao, nao do centro do corpo). */
export function attachBall(ball: Ball, pos: Vec2, height: number, ownerId: string): void {
  ball.state = 'held';
  ball.ownerId = ownerId;
  ball.lastTouchId = ownerId;
  ball.pos = v3(pos.x, pos.y, height);
  ball.vel = v3();
  ball.spin = v3();
  ball.age = 0;
}

export function releaseBall(ball: Ball, from: Vec3, vel: Vec3, spin: Vec3, state: BallState, ownerId: string): void {
  ball.state = state;
  ball.pos = v3(from.x, from.y, from.z);
  ball.vel = v3(vel.x, vel.y, vel.z);
  ball.spin = v3(spin.x, spin.y, spin.z);
  ball.ownerId = undefined;
  ball.lastTouchId = ownerId;
  ball.age = 0;
}

/**
 * Trajetoria balistica para acertar um alvo 3D com um arco pedido.
 * Usado por arremesso, lob e alley-oop. Retorna a velocidade inicial.
 */
export function ballisticVelocity(from: Vec3, to: Vec3, arcDegrees: number, gravity: number): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horiz = Math.hypot(dx, dy);
  const theta = (clamp(arcDegrees, 12, 78) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const tan = Math.tan(theta);
  const denom = 2 * cos * cos * (horiz * tan - dz);
  if (denom <= 1e-6 || horiz < 1e-4) {
    // Alvo praticamente em cima: sobe quase reto.
    const tt = Math.sqrt(Math.max(0.05, (2 * Math.abs(dz)) / gravity));
    return v3(dx / Math.max(0.2, tt), dy / Math.max(0.2, tt), Math.max(2, dz / Math.max(0.2, tt) + gravity * tt * 0.5));
  }
  const v = Math.sqrt((gravity * horiz * horiz) / denom);
  const vh = v * cos;
  const vz = v * Math.sin(theta);
  return v3((dx / horiz) * vh, (dy / horiz) * vh, vz);
}

/**
 * Resolve a velocidade de lancamento que REALMENTE acerta o alvo considerando
 * arrasto e Magnus. A formula balistica pura erra por ~40 cm em um chute de 7 m,
 * o que transformaria todo arremesso mirado no centro em bola curta no aro.
 *
 * Busca binaria sobre a escala da velocidade: a distancia percorrida cresce
 * monotonicamente com a velocidade inicial, entao 14 iteracoes convergem.
 */
export function solveLaunchVelocity(from: Vec3, to: Vec3, arcDegrees: number, spin: Vec3, t: Tuning): Vec3 {
  const base = ballisticVelocity(from, to, arcDegrees, t.sim.gravity);
  const targetHoriz = Math.hypot(to.x - from.x, to.y - from.y);
  if (targetHoriz < 0.05) return base;

  const rangeFor = (scale: number): number => {
    let p = v3(from.x, from.y, from.z);
    let v = mul3(base, scale);
    const w = spin;
    const step = 1 / 360;
    for (let i = 0; i < 360 * 4; i++) {
      const s = len3(v);
      if (s > 0.01) v = add3(v, mul3(norm3(v), -t.ball.drag * s * step));
      if (s > 0.5) {
        const vd = norm3(v);
        v = add3(v, mul3(v3(
          (w.y * vd.z - w.z * vd.y),
          (w.z * vd.x - w.x * vd.z),
          (w.x * vd.y - w.y * vd.x),
        ), t.ball.magnus * step));
      }
      v.z -= t.sim.gravity * step;
      const prevZ = p.z;
      p = add3(p, mul3(v, step));
      if (prevZ > to.z && p.z <= to.z && v.z < 0) {
        return Math.hypot(p.x - from.x, p.y - from.y);
      }
      if (p.z < -0.5) break;
    }
    return Math.hypot(p.x - from.x, p.y - from.y);
  };

  let lo = 0.75;
  let hi = 1.7;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (rangeFor(mid) < targetHoriz) lo = mid;
    else hi = mid;
  }
  return mul3(base, (lo + hi) / 2);
}

/** Velocidade para um passe direto com velocidade escalar dada (com leve compensacao de gravidade). */
export function leadPassVelocity(from: Vec3, to: Vec3, speed: number, gravity: number): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horiz = Math.hypot(dx, dy);
  const time = Math.max(0.08, horiz / Math.max(1, speed));
  return v3(dx / time, dy / time, dz / time + 0.5 * gravity * time);
}

/** Tempo aproximado de voo ate o ponto mais proximo do alvo. */
export function estimateFlightTime(from: Vec3, to: Vec3, speed: number): number {
  return Math.max(0.05, Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, speed));
}

/** Posicao futura da bola (integracao simples, sem colisao) - usado pela IA e pelo rebote. */
export function predictBall(ball: Ball, time: number, gravity: number, drag: number): Vec3 {
  let p = v3(ball.pos.x, ball.pos.y, ball.pos.z);
  let v = v3(ball.vel.x, ball.vel.y, ball.vel.z);
  const step = 1 / 60;
  for (let elapsed = 0; elapsed < time; elapsed += step) {
    const s = len3(v);
    if (s > 0.01) v = add3(v, mul3(norm3(v), -drag * s * step));
    v.z -= gravity * step;
    p = add3(p, mul3(v, step));
    if (p.z < 0.1) break;
  }
  return p;
}

/** Ponto e instante em que a bola fica pegavel (altura de captura). */
export function predictCatchPoint(ball: Ball, maxTime: number, catchHeight: number, gravity: number, drag: number): { pos: Vec2; time: number; height: number } {
  let p = v3(ball.pos.x, ball.pos.y, ball.pos.z);
  let v = v3(ball.vel.x, ball.vel.y, ball.vel.z);
  const step = 1 / 60;
  let time = 0;
  while (time < maxTime) {
    const s = len3(v);
    if (s > 0.01) v = add3(v, mul3(norm3(v), -drag * s * step));
    v.z -= gravity * step;
    p = add3(p, mul3(v, step));
    time += step;
    if (p.z <= catchHeight && v.z < 0) break;
    if (p.z <= 0.12) break;
  }
  return { pos: v2(p.x, p.y), time, height: clamp(p.z, 0.1, 4) };
}

export function ballGround(ball: Ball): Vec2 {
  return flat(ball.pos);
}

export function ballSpeed(ball: Ball): number {
  return len3(ball.vel);
}

/** Altura natural da mao para segurar a bola. */
export function handHeight(actorHeight: number, z: number, state: 'hold' | 'dribble' | 'gather' | 'release'): number {
  const base = actorHeight * (state === 'release' ? 1.24 : state === 'gather' ? 0.82 : 0.66);
  return base + z;
}

export function isCatchable(ball: Ball, t: Tuning): boolean {
  return (ball.state === 'loose' || ball.state === 'rolling' || ball.state === 'pass' || ball.state === 'shot')
    && ball.pos.z <= t.ball.catchHeightMax;
}

export function clampSpin(spin: Vec3, max = 45): Vec3 {
  return v3(clamp(spin.x, -max, max), clamp(spin.y, -max, max), clamp(spin.z, -max, max));
}

export function backspinFor(shotDistance: number): Vec3 {
  // Backspin em torno do eixo perpendicular ao plano de arremesso.
  return v3(0, clamp(9 + shotDistance * 0.55, 6, 26), 0);
}

export const clamp01Export = clamp01;
