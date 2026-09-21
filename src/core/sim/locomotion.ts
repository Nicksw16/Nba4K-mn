/**
 * MOTOR DE MOVIMENTO (secoes 3, 4, 5, 36, 126, 127).
 *
 * Como funciona, em uma frase: o input NAO define a velocidade, define a
 * velocidade DESEJADA. Entre o desejo e o corpo existem aceleracao limitada,
 * inercia por massa, atrito disponivel no pe plantado e equilibrio.
 *
 * Consequencias diretas dessa escolha:
 *  - nao existe mudanca instantanea de direcao: quem corre para a esquerda
 *    precisa frear antes de ir para a direita, e um pivo de 120 kg frea mais
 *    devagar que um armador de 85 kg;
 *  - o pe so "gruda" quando existe atrito disponivel; pedir mais do que o
 *    atrito permite faz o atleta escorregar e perder equilibrio;
 *  - o corpo se compromete com uma direcao (weightShift) e esse compromisso e
 *    exatamente o que o drible adversario ataca no ankle breaker.
 */
import { Vec2, add2, clampLen2, dot2, fromAngle, len2, mul2, norm2, sub2, toAngle, v2, angleDiff, rotate2 } from '../math/vec.js';
import { clamp, clamp01, damp, lerp } from '../math/util.js';
import { Actor, addCue, bv } from './actor.js';
import { contextTopSpeed } from './effective.js';
import { Tuning } from '../config/tuning.js';

/** Coeficiente de atrito solado-madeira. Limita a aceleracao lateral real. */
export const SHOE_FRICTION = 1.62;

export type Stance = 'normal' | 'dribble' | 'defense' | 'post' | 'boxout';

export interface LocomotionIntent {
  /** Direcao desejada no mundo, magnitude 0..1 (analogico). */
  move: Vec2;
  sprint: boolean;
  /** Direcao para onde o tronco deve olhar. Se undefined, olha para onde corre. */
  facing?: number;
  stance: Stance;
  /** Freio explicito (o jogador soltou o analogico ou pediu parada). */
  brake: boolean;
}

export function idleIntent(): LocomotionIntent {
  return { move: v2(), sprint: false, stance: 'normal', brake: true };
}

export interface LocomotionResult {
  /** Aceleracao pedida (m/s^2) antes dos limites. */
  requested: number;
  /** Aceleracao efetivamente aplicada. */
  applied: number;
  /** Quanto de atrito faltou (0 = nenhum deslizamento). */
  slip: number;
  /** Equilibrio perdido neste passo. */
  balanceLost: number;
  planted: boolean;
}

/**
 * Integra um passo de locomocao. Chamado uma vez por substep fisico.
 */
export function stepLocomotion(a: Actor, intent: LocomotionIntent, dt: number, t: Tuning): LocomotionResult {
  const L = t.locomotion;
  const result: LocomotionResult = { requested: 0, applied: 0, slip: 0, balanceLost: 0, planted: false };

  // --- 1. Velocidade desejada -------------------------------------------------
  const mode = a.hasBall ? 'ball' : intent.stance === 'defense' ? 'defense' : 'free';
  let top = contextTopSpeed(a, t, mode);
  if (intent.sprint && a.adrenaline > 0.02) top *= L.sprintFactor;
  if (intent.stance === 'post' || intent.stance === 'boxout') top *= 0.45;

  const moveLen = Math.min(1, len2(intent.move));
  const desiredDir = moveLen > 0.001 ? norm2(intent.move) : v2();
  let desired = mul2(desiredDir, top * moveLen);

  // Defensor deslizando de lado paga a penalidade lateral de verdade:
  // correr de costas ou de lado custa velocidade.
  if (intent.stance === 'defense' && moveLen > 0.001) {
    const facing = intent.facing ?? a.hipHeading;
    const alignment = Math.cos(angleDiff(facing, toAngle(desiredDir)));
    const lateralPenalty = lerp(L.lateralFactor, 1, clamp01((alignment + 1) / 2));
    desired = mul2(desired, lateralPenalty);
  }

  if (intent.brake || moveLen < 0.001) desired = v2();

  // --- 2. Orcamento de aceleracao --------------------------------------------
  const speed = len2(a.vel);
  const delta = sub2(desired, a.vel);
  const deltaLen = len2(delta);
  result.requested = deltaLen / Math.max(dt, 1e-6);

  const goingOpposite = speed > 0.2 && deltaLen > 0.001 ? dot2(norm2(a.vel), norm2(delta)) < 0 : false;
  let budget = goingOpposite ? a.physics.brake : a.physics.accel;

  // Inercia: massa alta e agilidade baixa encarecem inverter o corpo.
  const turnSeverity = speed > 0.4 && moveLen > 0.05
    ? clamp01((1 - dot2(norm2(a.vel), desiredDir)) / 2)
    : 0;
  budget /= lerp(1, a.physics.inertia, turnSeverity);

  // Foot planting: cortar com o pe plantado e mais eficiente do que no ar da
  // passada. Isso e o que impede a mudanca de direcao "flutuante".
  const plantWindow = plantEfficiency(a, t);
  budget *= lerp(0.52, 1, plantWindow);
  result.planted = plantWindow > 0.6;

  // Equilibrio ruim tira forca do apoio.
  budget *= lerp(0.45, 1, clamp01(a.balance));
  if (a.state === 'stumble') budget *= 0.35;

  // --- 3. Limite de atrito ----------------------------------------------------
  const maxTraction = SHOE_FRICTION * t.sim.gravity * lerp(0.6, 1.05, clamp01(a.balance));
  const cap = Math.min(budget, maxTraction);
  const applied = Math.min(result.requested, cap);
  result.applied = applied;

  if (result.requested > cap + 0.05) {
    // Pediu mais do que o pe aguenta: escorrega. Nao cancelamos o movimento -
    // a diferenca vira deslizamento e perda de equilibrio, nunca teleporte.
    result.slip = (result.requested - cap) / Math.max(1, maxTraction);
    a.feet.slip = Math.min(3, a.feet.slip + result.slip * dt * 4);
  } else {
    a.feet.slip = Math.max(0, a.feet.slip - dt * 1.5);
  }

  if (deltaLen > 1e-6 && a.grounded) {
    const accelVec = mul2(norm2(delta), applied * dt);
    a.vel = add2(a.vel, accelVec);
  } else if (!a.grounded && deltaLen > 1e-6) {
    // No ar existe apenas correcao minima: sem apoio nao ha como acelerar.
    a.vel = add2(a.vel, mul2(norm2(delta), Math.min(applied, 1.4) * dt * 0.25));
  }

  // Arrasto residual quando nao ha comando (o corpo nao para sozinho no ar).
  if (moveLen < 0.001 && a.grounded) {
    const decel = a.physics.brake * dt;
    const s = len2(a.vel);
    if (s <= decel) a.vel = v2();
    else a.vel = mul2(norm2(a.vel), s - decel);
  }

  a.vel = clampLen2(a.vel, top * 1.12 + 0.6);

  // --- 4. Integracao ----------------------------------------------------------
  a.pos = add2(a.pos, mul2(a.vel, dt));

  // --- 5. Vertical ------------------------------------------------------------
  if (!a.grounded || a.z > 0 || a.vz > 0) {
    a.vz -= t.sim.gravity * dt;
    a.z += a.vz * dt;
    if (a.z <= 0) {
      const impact = Math.abs(a.vz);
      a.z = 0;
      a.vz = 0;
      a.grounded = true;
      // Aterrissagem custa equilibrio proporcional a energia vertical.
      const landPenalty = clamp01((impact - 3.2) / 9) * 0.5;
      if (landPenalty > 0.01) {
        a.balance = clamp01(a.balance - landPenalty);
        result.balanceLost += landPenalty;
        if (landPenalty > 0.18) addCue(a, 'hard_landing');
      }
      a.stamina = clamp01(a.stamina - t.fatigue.jumpDrain * 0.5);
      if (a.state === 'jump') a.state = 'land';
      plantBothFeet(a);
    } else {
      a.grounded = false;
    }
  }

  // --- 6. Rotacao do corpo ----------------------------------------------------
  const targetFacing = intent.facing !== undefined
    ? intent.facing
    : speed > 0.35
      ? toAngle(a.vel)
      : a.heading;
  const speedFactor = 1 - clamp01(speed / Math.max(1, a.physics.topSpeed)) * L.turnRateSpeedPenalty;
  const maxTurn = a.physics.turnRate * speedFactor * dt;
  const diff = angleDiff(a.heading, targetFacing);
  a.heading += clamp(diff, -maxTurn, maxTurn);
  // O quadril acompanha o tronco com atraso - base da leitura corporal.
  a.hipHeading += clamp(angleDiff(a.hipHeading, a.heading), -maxTurn * 0.8, maxTurn * 0.8);

  // --- 7. Foot planting -------------------------------------------------------
  stepFeet(a, dt, t);

  // --- 8. Equilibrio ----------------------------------------------------------
  // O equilibrio e ameacado por duas coisas: torcer o corpo para o lado
  // (componente perpendicular a velocidade) e pedir quase todo o atrito
  // disponivel de uma vez (frear ou arrancar no limite).
  const lateralAccel = lateralComponent(a.vel, delta, applied);
  const lateralSharpness = clamp01(lateralAccel / Math.max(1, maxTraction));
  const tractionSharpness = clamp01((applied / Math.max(1, maxTraction) - 0.55) / 0.45);
  const sharpness = clamp01(Math.max(lateralSharpness, tractionSharpness * 0.75));
  const loss = sharpness * L.balanceLossScale * dt * 60 * lerp(1.15, 0.7, clamp01(a.effective.agility / 99));
  const contactBalanceBadge = bv(a, 'phys.contactBalance');
  const realLoss = loss * (1 - clamp01(contactBalanceBadge) * 0.35);
  if (realLoss > 0) {
    a.balance = clamp01(a.balance - realLoss);
    result.balanceLost += realLoss;
  }
  const recovery = L.balanceRecovery * dt * (0.6 + clamp01(a.effective.agility / 99) * 0.7) * (0.5 + a.stamina * 0.5);
  a.balance = clamp01(a.balance + recovery * (1 - sharpness));

  if (a.balance < L.stumbleThreshold && a.grounded && a.state !== 'stumble') {
    a.state = 'stumble';
    addCue(a, 'stumble');
  } else if (a.state === 'stumble' && a.balance > L.stumbleThreshold + 0.18) {
    a.state = 'idle';
  }

  // --- 9. Deslocamento de peso ------------------------------------------------
  // Filtro passa-baixa da direcao de aceleracao: para onde o corpo se comprometeu.
  const commitTarget = deltaLen > 0.05 && applied > 0.4 ? mul2(norm2(delta), clamp01(applied / Math.max(1, maxTraction))) : v2();
  a.weightShift = v2(
    damp(a.weightShift.x, commitTarget.x, 7.5, dt),
    damp(a.weightShift.y, commitTarget.y, 7.5, dt),
  );

  // --- 10. Estado de locomocao ------------------------------------------------
  if (a.state !== 'stumble' && a.state !== 'gather' && a.state !== 'screen' && a.state !== 'boxout' && a.state !== 'down') {
    if (!a.grounded) a.state = 'jump';
    // Jogo de costas e postura, nao acao: precisa sobreviver ao frame seguinte.
    // Escrever `posture_post` uma vez e deixar a locomocao reescrever depois
    // fazia o botao de poste parecer que nao funcionava.
    else if (intent.stance === 'post') a.state = 'posture_post';
    else if (intent.stance === 'boxout') a.state = 'boxout';
    else if (intent.stance === 'defense') a.state = speed > 0.6 ? 'shuffle' : 'idle';
    else if (speed < 0.35) a.state = 'idle';
    else if (speed < 2.1) a.state = 'walk';
    else if (intent.sprint && speed > a.physics.topSpeed * 0.8) a.state = 'sprint';
    else a.state = 'run';
  }

  return result;
}

/** Componente de aceleracao perpendicular a velocidade atual (o que "torce" o tornozelo). */
function lateralComponent(vel: Vec2, delta: Vec2, applied: number): number {
  const speed = len2(vel);
  if (speed < 0.3 || applied < 0.01) return 0;
  const dir = norm2(vel);
  const dl = len2(delta);
  if (dl < 1e-6) return 0;
  const dd = norm2(delta);
  const perp = Math.abs(dir.x * dd.y - dir.y * dd.x);
  return applied * perp;
}

/**
 * Eficiencia do apoio: 1 logo apos a planta do pe, caindo no meio da passada.
 * E o gate fisico que impede cortes "no ar".
 */
export function plantEfficiency(a: Actor, t: Tuning): number {
  if (!a.grounded) return 0.15;
  const speed = len2(a.vel);
  if (speed < 0.8) return 1; // parado, os dois pes estao no chao
  const phase = a.feet.phase;
  // Janela boa perto de 0 e de 0.5 (troca de pe).
  const d = Math.min(Math.abs(phase), Math.abs(phase - 0.5), Math.abs(phase - 1));
  return clamp01(1 - d / 0.26);
}

function plantBothFeet(a: Actor): void {
  const side = rotate2(fromAngle(a.heading, 0.17), Math.PI / 2);
  a.feet.left = v2(a.pos.x + side.x, a.pos.y + side.y);
  a.feet.right = v2(a.pos.x - side.x, a.pos.y - side.y);
  a.feet.planted = 'both';
  a.feet.sincePlant = 0;
  a.feet.phase = 0;
}

/**
 * Avanca a passada. O pe plantado fica FIXO no chao ate a proxima planta;
 * quem desenha o atleta usa essas posicoes, entao o pe nunca "arrasta" a menos
 * que o corpo realmente esteja escorregando (feet.slip > 0).
 */
export function stepFeet(a: Actor, dt: number, t: Tuning): void {
  const speed = len2(a.vel);
  const f = a.feet;
  f.sincePlant += dt;

  if (!a.grounded) {
    f.planted = 'none';
    return;
  }

  if (speed < 0.8) {
    if (f.planted !== 'both') plantBothFeet(a);
    f.phase = 0;
    return;
  }

  // Comprimento da passada cresce com velocidade e com a perna do atleta.
  const legLength = a.profile.physique.height * (1 - a.profile.physique.torsoRatio) * 1.02;
  f.strideLength = clamp(legLength * (1.15 + speed * 0.19), 0.7, 2.75);
  const strideTime = Math.max(t.locomotion.strideBase * 0.55, f.strideLength / Math.max(0.6, speed));
  f.phase += dt / strideTime;

  while (f.phase >= 1) {
    f.phase -= 1;
  }

  const prevPlanted = f.planted;
  const next: 'left' | 'right' = f.phase < 0.5 ? 'left' : 'right';
  if (next !== prevPlanted) {
    // Nova planta: o pe pousa a frente do corpo, deslocado lateralmente.
    const dir = norm2(a.vel);
    const side = rotate2(dir, Math.PI / 2);
    const lateral = next === 'left' ? 0.13 : -0.13;
    const forward = f.strideLength * 0.42;
    const p = v2(
      a.pos.x + dir.x * forward + side.x * lateral,
      a.pos.y + dir.y * forward + side.y * lateral,
    );
    if (next === 'left') f.left = p;
    else f.right = p;
    f.planted = next;
    f.sincePlant = 0;
  }
}

/** Aplica um salto vertical imediato (usado por arremesso, toco, rebote, enterrada). */
export function jump(a: Actor, height: number, t: Tuning): void {
  if (!a.grounded) return;
  a.vz = Math.sqrt(Math.max(0.01, 2 * t.sim.gravity * Math.max(0.05, height)));
  a.grounded = false;
  a.state = 'jump';
  a.stamina = clamp01(a.stamina - t.fatigue.jumpDrain);
  a.feet.planted = 'none';
}

/** Impulso horizontal instantaneo (contato, empurrao de bloqueio, screen). */
export function applyImpulse(a: Actor, impulse: Vec2, t: Tuning): void {
  const inv = 1 / Math.max(35, a.physics.mass);
  a.vel = add2(a.vel, mul2(impulse, inv));
  const mag = len2(impulse) * inv;
  const resist = bv(a, 'phys.contactBalance');
  const loss = clamp01(mag / 5.5) * (1 - clamp01(resist) * 0.4);
  a.balance = clamp01(a.balance - loss);
  a.stamina = clamp01(a.stamina - t.fatigue.contactDrain * clamp01(mag / 3));
}
