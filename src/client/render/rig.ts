/**
 * ESQUELETO ARTICULADO (secao 36: physics-driven animation).
 *
 * Nao existe clipe de animacao aqui, e nao deveria existir: o simulador ja
 * sabe onde cada pe esta plantado, em que fase da passada o corpo esta, para
 * onde o quadril aponta, para onde os ombros apontam, para onde o atleta
 * olha, quanto equilibrio resta e que acao esta em curso. Um esqueleto
 * resolvido desse estado a cada quadro da movimento continuo de graca, sem
 * blending e sem o "escorregar" tipico de animacao tocada por cima da fisica.
 *
 * As juntas saem em METROS, no espaco do mundo. Quem desenha projeta.
 *
 * Convencao do mundo: x ao longo da quadra, y na largura, z para cima.
 */
import { Vec2, Vec3, v3, add3, sub3, mul3, norm3, len3, fromAngle, rotate2, v2 } from '../../core/math/vec.js';
import { clamp, clamp01, lerp, smoothstep } from '../../core/math/util.js';
import { Actor } from '../../core/sim/actor.js';

/** Uma junta do esqueleto, em metros no espaco do mundo. */
export type Joint =
  | 'pelvis' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'elbowL' | 'wristL' | 'handL'
  | 'shoulderR' | 'elbowR' | 'wristR' | 'handR'
  | 'hipL' | 'kneeL' | 'ankleL' | 'toeL'
  | 'hipR' | 'kneeR' | 'ankleR' | 'toeR';

export type Skeleton = Record<Joint, Vec3>;

/** Medidas derivadas do fisico do atleta. Tudo proporcional a altura real. */
interface Proportions {
  height: number;
  legLength: number;
  thigh: number;
  shin: number;
  torso: number;
  neckLen: number;
  headRadius: number;
  shoulderHalf: number;
  hipHalf: number;
  upperArm: number;
  foreArm: number;
  handLen: number;
  footLen: number;
}

export function proportionsOf(actor: Actor): Proportions {
  const h = actor.profile.physique.height;
  const wing = actor.profile.physique.wingspan;
  // Perna do chao ao quadril ~52% da altura, tronco ~28%, cabeca e pescoco
  // ~20%: somam 1. Errar essa divisao e o que faz o corpo parecer anao ou
  // girafa. A envergadura decide o braco, que e onde um atleta de basquete
  // mais foge da media da populacao.
  const legLength = h * 0.52;
  const armSpan = wing * 0.5 - h * 0.052; // do ombro ate o punho
  return {
    height: h,
    legLength,
    thigh: legLength * 0.52,
    shin: legLength * 0.48,
    torso: h * 0.28,
    neckLen: h * 0.038,
    headRadius: h * 0.065,
    shoulderHalf: h * 0.5 * (0.235 + actor.profile.physique.shoulderWidth * 0.13),
    hipHalf: h * 0.082,
    upperArm: armSpan * 0.47,
    foreArm: armSpan * 0.38,
    handLen: armSpan * 0.15,
    footLen: h * 0.126,
  };
}

/**
 * IK de duas ossadas. Dado raiz, alvo e comprimentos, devolve a junta do meio.
 * `poleDir` diz para que lado a articulacao dobra (joelho para frente,
 * cotovelo para fora) -- sem isso a perna dobra para o lado errado e o
 * resultado parece uma marionete.
 */
function solveTwoBone(root: Vec3, target: Vec3, a: number, b: number, poleDir: Vec3): Vec3 {
  const toTarget = sub3(target, root);
  const dist = clamp(len3(toTarget), 1e-4, (a + b) * 0.999);
  const dir = mul3(toTarget, 1 / Math.max(1e-4, len3(toTarget)));
  // Lei dos cossenos: distancia da raiz ate a projecao da junta no eixo.
  const along = (dist * dist + a * a - b * b) / (2 * dist);
  const perp = Math.sqrt(Math.max(0, a * a - along * along));
  // Ortogonaliza o polo contra o eixo para nao inclinar a dobra.
  const dotP = poleDir.x * dir.x + poleDir.y * dir.y + poleDir.z * dir.z;
  let side = sub3(poleDir, mul3(dir, dotP));
  const sideLen = len3(side);
  side = sideLen < 1e-4 ? v3(0, 0, 1) : mul3(side, 1 / sideLen);
  return add3(root, add3(mul3(dir, along), mul3(side, perp)));
}

/** Vetor horizontal a partir de um angulo, com altura opcional. */
const dirH = (rad: number, len = 1, z = 0): Vec3 => {
  const f = fromAngle(rad, len);
  return v3(f.x, f.y, z);
};

/** Quanto o corpo esta agachado agora (0 = ereto, 1 = agachamento profundo). */
function crouchOf(actor: Actor): number {
  const s = actor.state;
  if (s === 'gather') return 0.62;
  if (s === 'posture_post' || s === 'boxout') return 0.42;
  if (s === 'shuffle') return 0.52;
  if (s === 'screen') return 0.3;
  if (s === 'stumble') return 0.55;
  if (s === 'down') return 0.95;
  if (s === 'land') return 0.44;
  const k = actor.action.kind;
  if (k === 'shot_windup') return 0.3 + 0.22 * Math.sin(Math.PI * clamp01(actor.action.t / Math.max(0.05, actor.action.triggerAt)));
  if (k === 'rebound_jump' || k === 'block_attempt') return 0.2;
  // Correndo, o centro de massa desce um pouco.
  return clamp01(0.06 + Math.min(0.9, lenOf(actor.vel) / 7) * 0.12);
}

const lenOf = (a: Vec2): number => Math.hypot(a.x, a.y);

/**
 * Onde a mao que controla a bola deve estar, e quanto ela manda na pose.
 * O peso diz o quanto o alvo sobrepoe o balanco natural do braco.
 */
interface ArmTarget {
  left?: Vec3;
  right?: Vec3;
  /** 0..1 por braco. */
  weight: number;
}

function armTargets(actor: Actor, p: Proportions, shoulderL: Vec3, shoulderR: Vec3, ball: Vec3 | null, time: number): ArmTarget {
  const k = actor.action.kind;
  const prog = actor.action.duration > 0 ? clamp01(actor.action.t / actor.action.duration) : 0;
  const face = actor.heading;
  const ballSide = actor.ballHand === 'left';
  const shoulder = ballSide ? shoulderL : shoulderR;
  const reach = p.upperArm + p.foreArm + p.handLen;

  // Mao livre para acoes que precisam do alvo exato da bola.
  const toBall = (fallbackZ: number): Vec3 => ball ?? add3(shoulder, dirH(face, reach * 0.5, fallbackZ));

  switch (k) {
    case 'shot_windup': {
      // Sobe ate o set point: bola acima e a frente da testa do lado dominante.
      const t = smoothstep(prog);
      const set = add3(shoulder, v3(0, 0, p.headRadius * 2.1 * t));
      const fwd = dirH(face, reach * lerp(0.34, 0.22, t));
      const point = add3(set, fwd);
      // A mao de apoio acompanha por baixo, um pouco para dentro.
      const guide = add3(point, dirH(face + (ballSide ? -1.35 : 1.35), p.shoulderHalf * 0.72));
      return ballSide ? { left: point, right: guide, weight: 1 } : { right: point, left: guide, weight: 1 };
    }
    case 'shot_release':
    case 'free_throw': {
      // Extensao total e follow-through: punho quebra para baixo.
      const t = smoothstep(prog);
      const point = add3(shoulder, add3(v3(0, 0, reach * lerp(0.82, 0.96, t)), dirH(face, reach * lerp(0.28, 0.42, t))));
      const guide = add3(shoulder, add3(v3(0, 0, reach * lerp(0.7, 0.5, t)), dirH(face + (ballSide ? -1.2 : 1.2), p.shoulderHalf * 0.9)));
      return ballSide ? { left: point, right: guide, weight: 1 } : { right: point, left: guide, weight: 1 };
    }
    case 'layup':
    case 'dunk': {
      // Braco estendido para cima e para frente, na direcao do aro.
      const t = smoothstep(prog);
      const up = k === 'dunk' ? 0.99 : 0.9;
      const point = add3(shoulder, add3(v3(0, 0, reach * up), dirH(face, reach * lerp(0.25, 0.5, t))));
      const other = add3(shoulder, add3(v3(0, 0, reach * 0.3), dirH(face + (ballSide ? -1.6 : 1.6), reach * 0.34)));
      return ballSide ? { left: point, right: other, weight: 1 } : { right: point, left: other, weight: 1 };
    }
    case 'pass':
    case 'inbound': {
      // Duas maos saindo do peito na direcao do passe.
      const t = smoothstep(prog);
      const fwd = dirH(face, reach * lerp(0.3, 0.78, t), p.torso * 0.12);
      return {
        left: add3(shoulderL, fwd),
        right: add3(shoulderR, fwd),
        weight: 1,
      };
    }
    case 'block_attempt':
    case 'rebound_jump': {
      // Os dois bracos verticais, abertos.
      const t = smoothstep(prog);
      const up = reach * lerp(0.72, 0.99, t);
      const out = p.shoulderHalf * 0.55;
      return {
        left: add3(shoulderL, add3(v3(0, 0, up), dirH(face + Math.PI / 2, out))),
        right: add3(shoulderR, add3(v3(0, 0, up), dirH(face - Math.PI / 2, out))),
        weight: 1,
      };
    }
    case 'steal_attempt': {
      const t = Math.sin(Math.PI * prog);
      const jab = add3(shoulder, add3(dirH(face, reach * (0.55 + 0.4 * t)), v3(0, 0, -p.torso * 0.28)));
      return ballSide ? { left: jab, weight: 1 } : { right: jab, weight: 1 };
    }
    case 'screen': {
      // Bracos cruzados no peito, postura legal de bloqueio.
      const inward = p.shoulderHalf * 0.2;
      return {
        left: add3(shoulderL, add3(dirH(face + Math.PI / 2, -inward), v3(0, 0, -p.torso * 0.22))),
        right: add3(shoulderR, add3(dirH(face - Math.PI / 2, -inward), v3(0, 0, -p.torso * 0.22))),
        weight: 0.9,
      };
    }
    case 'boxout': {
      // Cotovelos para fora, ocupando espaco.
      const out = p.shoulderHalf * 1.35;
      return {
        left: add3(shoulderL, add3(dirH(face + Math.PI / 2, out), v3(0, 0, -p.torso * 0.1))),
        right: add3(shoulderR, add3(dirH(face - Math.PI / 2, out), v3(0, 0, -p.torso * 0.1))),
        weight: 0.95,
      };
    }
    case 'gather':
    case 'dribble_move':
    default:
      break;
  }

  // Sem acao declarada: a postura vem do estado de locomocao.
  if (actor.hasBall) {
    // Drible: a mao da bola acompanha a bola; a outra protege.
    const hand = toBall(p.torso * 0.5);
    const guard = add3(ballSide ? shoulderR : shoulderL, add3(
      dirH(face + (ballSide ? -0.9 : 0.9), reach * 0.42),
      v3(0, 0, -p.torso * 0.16),
    ));
    return ballSide ? { left: hand, right: guard, weight: 0.92 } : { right: hand, left: guard, weight: 0.92 };
  }

  if (actor.state === 'shuffle') {
    // Defesa: bracos abertos, um para a linha de passe.
    const out = reach * 0.72;
    return {
      left: add3(shoulderL, add3(dirH(face + 1.25, out), v3(0, 0, -p.torso * 0.05))),
      right: add3(shoulderR, add3(dirH(face - 1.25, out), v3(0, 0, -p.torso * 0.05))),
      weight: 0.85,
    };
  }

  if (actor.state === 'posture_post') {
    const out = reach * 0.6;
    return {
      left: add3(shoulderL, add3(dirH(face + 1.9, out), v3(0, 0, p.torso * 0.1))),
      right: add3(shoulderR, add3(dirH(face - 1.9, out), v3(0, 0, p.torso * 0.1))),
      weight: 0.85,
    };
  }

  // Corrida: balanco contrario a passada. E o que mais vende "corpo real".
  const swing = Math.sin(actor.feet.phase * Math.PI * 2);
  const speed01 = clamp01(lenOf(actor.vel) / Math.max(2, actor.physics.topSpeed));
  const amp = reach * (0.3 + speed01 * 0.3);
  const drop = -p.torso * (0.34 - speed01 * 0.1);
  return {
    left: add3(shoulderL, add3(dirH(face, amp * swing), v3(0, 0, drop))),
    right: add3(shoulderR, add3(dirH(face, -amp * swing), v3(0, 0, drop))),
    weight: 0.72 + speed01 * 0.2,
  };
}

/**
 * Resolve o esqueleto inteiro para este quadro.
 *
 * `ball` e a posicao da bola em metros quando este ator a controla -- a mao
 * de drible segue a bola de verdade, entao o quique e a mao nunca divergem.
 */
export function solveRig(actor: Actor, ball: Vec3 | null, time: number): Skeleton {
  const p = proportionsOf(actor);
  const face = actor.heading;
  const hipFace = actor.hipHeading;
  const crouch = crouchOf(actor);
  const airborne = actor.z > 0.02;

  // --- QUADRIL -------------------------------------------------------------
  // Altura do quadril: perna esticada menos o agachamento, mais o salto.
  const hipHeight = p.legLength * (1 - crouch * 0.36) + actor.z;
  const pelvis = v3(actor.pos.x, actor.pos.y, hipHeight);

  // Inclinacao do tronco. Vem da aceleracao real (peso deslocado) e do
  // equilibrio: quem esta perdendo o equilibrio inclina mais do que quer.
  const shift = actor.weightShift;
  const shiftLen = Math.hypot(shift.x, shift.y);
  const off = (1 - clamp01(actor.balance)) * 0.5;
  const leanAmt = clamp(shiftLen * 0.16 + off, 0, 0.42);
  const leanDir = shiftLen > 1e-3 ? v2(shift.x / shiftLen, shift.y / shiftLen) : fromAngle(face);
  const lean = v3(leanDir.x * leanAmt, leanDir.y * leanAmt, 0);

  // --- COLUNA --------------------------------------------------------------
  // O tronco inclina para a frente no agachamento: contrapeso natural.
  const pitch = crouch * 0.55 + leanAmt * 0.5;
  const spineDir = norm3(add3(v3(0, 0, 1), add3(lean, dirH(face, pitch * 0.62))));
  const spine = add3(pelvis, mul3(spineDir, p.torso * 0.34));
  const chest = add3(pelvis, mul3(spineDir, p.torso * 0.86));
  const neck = add3(pelvis, mul3(spineDir, p.torso + p.neckLen * 0.4));

  // Cabeca: olha para onde o gaze aponta, nao para onde o corpo vai. Essa
  // separacao e o que faz o no-look e a leitura de quadra aparecerem.
  const head = add3(neck, add3(v3(0, 0, p.neckLen + p.headRadius * 0.82), dirH(actor.gaze, p.headRadius * 0.34)));

  // --- OMBROS E QUADRIS ----------------------------------------------------
  // Ombros giram com `heading`, quadris com `hipHeading`. A separacao entre
  // os dois e postura de basquete de verdade (defesa, jogo de costas, cortes).
  const shoulderAxis = fromAngle(face + Math.PI / 2, p.shoulderHalf);
  const shoulderL = add3(chest, v3(shoulderAxis.x, shoulderAxis.y, 0));
  const shoulderR = add3(chest, v3(-shoulderAxis.x, -shoulderAxis.y, 0));
  const hipAxis = fromAngle(hipFace + Math.PI / 2, p.hipHalf);
  const hipL = add3(pelvis, v3(hipAxis.x, hipAxis.y, 0));
  const hipR = add3(pelvis, v3(-hipAxis.x, -hipAxis.y, 0));

  // --- PERNAS --------------------------------------------------------------
  // Os pes vem do simulador: sao posicoes plantadas de verdade. O pe em voo
  // sobe conforme a fase da passada, entao a passada tem altura sem que
  // ninguem tenha animado nada.
  const plant = actor.feet.planted;
  const phase = actor.feet.phase;
  const swingLift = (isLeft: boolean): number => {
    if (airborne) return actor.z * 0.18;
    const swinging = plant === 'right' ? isLeft : plant === 'left' ? !isLeft : false;
    if (!swinging) return 0;
    // Meio arco: sobe no meio da passada, zera na planta.
    return Math.sin(Math.PI * phase) * p.legLength * 0.19;
  };

  const ankleL = v3(actor.feet.left.x, actor.feet.left.y, swingLift(true) + actor.z * 0.9);
  const ankleR = v3(actor.feet.right.x, actor.feet.right.y, swingLift(false) + actor.z * 0.9);

  // O joelho dobra para a frente do QUADRIL, nunca para o lado.
  const kneePole = dirH(hipFace, 1, 0.22);
  const kneeL = solveTwoBone(hipL, ankleL, p.thigh, p.shin, kneePole);
  const kneeR = solveTwoBone(hipR, ankleR, p.thigh, p.shin, kneePole);

  // Ponta do pe: aponta na direcao do quadril; no ar, aponta para baixo.
  const toeDir = dirH(hipFace, p.footLen, airborne ? -0.5 : 0);
  const toeL = add3(ankleL, toeDir);
  const toeR = add3(ankleR, toeDir);

  // --- BRACOS --------------------------------------------------------------
  const targets = armTargets(actor, p, shoulderL, shoulderR, ball, time);
  const armReach = p.upperArm + p.foreArm;

  const restL = add3(shoulderL, add3(v3(0, 0, -armReach * 0.92), dirH(face + 1.4, armReach * 0.14)));
  const restR = add3(shoulderR, add3(v3(0, 0, -armReach * 0.92), dirH(face - 1.4, armReach * 0.14)));
  const wL = targets.left ? targets.weight : 0;
  const wR = targets.right ? targets.weight : 0;
  const handL = mixTarget(restL, targets.left, wL);
  const handR = mixTarget(restR, targets.right, wR);

  // O cotovelo abre para fora e um pouco para tras: dobra anatomica.
  // O cotovelo humano aponta para fora e para TRAS. Polo para frente produz
  // aquela dobra em Z que denuncia marionete.
  const elbowPoleL = dirH(face + 2.45, 1, -0.5);
  const elbowPoleR = dirH(face - 2.45, 1, -0.5);
  const wristL = solveTwoBone(shoulderL, handL, p.upperArm, p.foreArm, elbowPoleL);
  const wristR = solveTwoBone(shoulderR, handR, p.upperArm, p.foreArm, elbowPoleR);

  return {
    pelvis, spine, chest, neck, head,
    shoulderL, elbowL: wristL, wristL: midOf(wristL, handL), handL,
    shoulderR, elbowR: wristR, wristR: midOf(wristR, handR), handR,
    hipL, kneeL, ankleL, toeL,
    hipR, kneeR, ankleR, toeR,
  };
}

const midOf = (a: Vec3, b: Vec3): Vec3 => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);

function mixTarget(rest: Vec3, target: Vec3 | undefined, w: number): Vec3 {
  if (!target || w <= 0) return rest;
  return v3(lerp(rest.x, target.x, w), lerp(rest.y, target.y, w), lerp(rest.z, target.z, w));
}

/** Um osso a desenhar: extremos no mundo e raio em cada ponta (metros). */
export interface Bone {
  a: Vec3;
  b: Vec3;
  rA: number;
  rB: number;
  /** Que material usar ao pintar. */
  skin: 'jersey' | 'shorts' | 'skin' | 'shoe';
}

/** Ossos do corpo, do mais interno ao mais externo. */
export function bonesOf(s: Skeleton, actor: Actor): Bone[] {
  const p = proportionsOf(actor);
  const bulk = 0.92 + clamp01((actor.profile.physique.weight - 84) / 60) * 0.3;
  const limb = p.height * 0.031 * bulk;
  const trunk = p.shoulderHalf * 0.86;

  return [
    // Pernas
    { a: s.hipL, b: s.kneeL, rA: limb * 1.62, rB: limb * 1.05, skin: 'shorts' },
    { a: s.hipR, b: s.kneeR, rA: limb * 1.62, rB: limb * 1.05, skin: 'shorts' },
    { a: s.kneeL, b: s.ankleL, rA: limb * 1.0, rB: limb * 0.54, skin: 'skin' },
    { a: s.kneeR, b: s.ankleR, rA: limb * 1.0, rB: limb * 0.54, skin: 'skin' },
    { a: s.ankleL, b: s.toeL, rA: limb * 1.02, rB: limb * 0.8, skin: 'shoe' },
    { a: s.ankleR, b: s.toeR, rA: limb * 1.02, rB: limb * 0.8, skin: 'shoe' },
    // Tronco em tres partes para existir cintura: quadril largo, cintura
    // estreita, peito largo. Sem esse V o corpo vira um tubo.
    { a: s.pelvis, b: s.spine, rA: p.hipHalf * 1.44, rB: trunk * 0.7, skin: 'shorts' },
    { a: s.spine, b: s.chest, rA: trunk * 0.72, rB: trunk, skin: 'jersey' },
    { a: s.chest, b: s.neck, rA: trunk * 0.62, rB: p.headRadius * 0.52, skin: 'skin' },
    // Bracos
    { a: s.shoulderL, b: s.elbowL, rA: limb * 1.1, rB: limb * 0.82, skin: 'skin' },
    { a: s.shoulderR, b: s.elbowR, rA: limb * 1.1, rB: limb * 0.82, skin: 'skin' },
    { a: s.elbowL, b: s.handL, rA: limb * 0.8, rB: limb * 0.52, skin: 'skin' },
    { a: s.elbowR, b: s.handR, rA: limb * 0.8, rB: limb * 0.52, skin: 'skin' },
  ];
}
