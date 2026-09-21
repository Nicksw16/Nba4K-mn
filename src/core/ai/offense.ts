/**
 * IA OFENSIVA (secoes 29, 30, 31).
 *
 * Com bola, a decisao e uma comparacao de VALOR ESPERADO entre:
 *   arremessar agora | penetrar | passar para uma opcao melhor | criar com drible
 * Cada opcao carrega qualidade estimada, risco e a tendencia pessoal do atleta.
 * Um pontuador de isolacao com 30% de tendencia de passe decide diferente de um
 * armador cerebral com os mesmos atributos.
 *
 * Sem bola, cada atleta executa seu papel na jogada chamada, mas ABANDONA o
 * papel quando le uma vantagem melhor (defensor virou de costas -> corta;
 * a penetracao veio na sua direcao -> reposiciona no canto).
 */
import { Vec2, add2, dist2, dot2, fromAngle, len2, mul2, norm2, sub2, toAngle, v2, angleDiff } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor } from '../sim/actor.js';
import { LocomotionIntent } from '../sim/locomotion.js';
import { CourtView, PlayerRead, bestLane, shotQuality, spacingSpot } from './perception.js';
import { Tuning } from '../config/tuning.js';
import { COURT, Side, clampToCourt, distToHoop, hoopGround, isInPaint, isThreePointShot, shotZone } from '../config/court.js';
import { Gameplan } from '../model/team.js';
import { Rng } from '../math/rng.js';
import { Play, PlayContext, RoleInstruction } from './playbook.js';
import { rankPassTargets } from '../sim/passing.js';
import { AiProfile } from '../config/sliders.js';
import { pickMove } from '../sim/dribble.js';

export type OffensiveIntentKind =
  | 'shoot' | 'drive' | 'pass' | 'dribble_move' | 'post_up' | 'move' | 'screen' | 'handoff' | 'reset' | 'cut';

export interface OffensiveDecision {
  kind: OffensiveIntentKind;
  intent: LocomotionIntent;
  /** Alvo de passe. */
  passTargetId?: string;
  /** Move de drible escolhido. */
  moveId?: string;
  moveSide?: -1 | 1;
  /** Motivo legivel (comentario, play art, debug). */
  reason: string;
  /** Qualidade estimada da acao escolhida. */
  value: number;
}

export interface OffenseContext {
  view: CourtView;
  gameplan: Gameplan;
  t: Tuning;
  profile: AiProfile;
  rng: Rng;
  shotClock: number;
  gameClock: number;
  scoreDiff: number;
  play?: Play;
  playPhase: number;
  playWing: -1 | 1;
  /** Papel deste ator na jogada (0 = portador). */
  role: number;
  /** Tempo desde que recebeu a bola. */
  timeWithBall: number;
  transition: boolean;
  /** Tempo decorrido desde o inicio da posse (disciplina de relogio). */
  possessionAge: number;
  /** Fracao das tentativas da equipe que ja sao deste atleta. */
  usageShare: number;
}

/** Decisao do portador da bola. */
export function decideOnBall(a: Actor, ctx: OffenseContext): OffensiveDecision {
  const { view, t, rng, shotClock } = ctx;
  const hoop = hoopGround(view.attackingSide);
  const read = view.reads.get(a.id);
  const toRim = dist2(a.pos, hoop);
  const desperation = shotClock < 3.2;

  // --- Valor de arremessar agora ---
  const sq = shotQuality(view, a, t);
  const clutchUrgency = ctx.gameClock < 24 && ctx.scoreDiff < 0 ? 0.15 : 0;
  // Disciplina de relogio: nos primeiros segundos da posse, so um arremesso
  // claramente bom justifica encerrar a jogada. Sem isso a IA "queima" a posse
  // em 5 segundos e o jogo vira 250 posses por partida.
  // Excecao importante: bola recem-recebida com o homem livre e exatamente o
  // arremesso que o sistema QUER. Penalizar isso mataria o catch-and-shoot -
  // e, junto com ele, as assistencias.
  // A excecao de catch-and-shoot precisa ser estreita: com bom espacamento
  // quase toda recepcao fica "aberta", e a posse inteira virava um passe e um
  // arremesso de 3 segundos.
  const freshCatch = ctx.timeWithBall < 0.8
    && (read?.nearestDefender ?? 0) > 3.0
    && (read?.shotThreat ?? 0) > 0.5
    && ctx.possessionAge > 3.5;
  const earlyClock = ctx.possessionAge < 14 && !ctx.transition && !freshCatch;
  const earlyPenalty = earlyClock ? 0.78 - ctx.possessionAge * 0.045 : 0;
  // Controle de uso: nem a estrela chuta metade da equipe. Acima da fatia que
  // a tendencia pessoal justifica, o valor de arremessar cai e o de passar sobe.
  const usageCap = 0.2 + (a.profile.tendencies.isolation + a.profile.tendencies.pullup) / 500;
  const usagePenalty = clamp01((ctx.usageShare - usageCap) / 0.2) * 0.35;

  const shootValue = sq * (desperation ? 1.9 : 1) + clutchUrgency - earlyPenalty - usagePenalty
    + (shotClock < t.ai.clockPressureStart ? (t.ai.clockPressureStart - shotClock) * 0.06 : 0);

  // --- Valor de penetrar ---
  const lane = bestLane(view, 1.6);
  const driveSkill = attr01(a.effective.drivingLayup) * 0.45 + attr01(a.effective.speedWithBall) * 0.35 + attr01(a.effective.acceleration) * 0.2;
  const rimProtection = view.paintLoad;
  const driveValue = lane
    ? clamp01(lane.score * 0.55 + driveSkill * 0.4 - rimProtection * 0.3)
      * (0.55 + (a.profile.tendencies.drive / 100) * 0.9)
      * (a.adrenaline > 0.2 ? 1 : 0.7)
    : 0;

  // --- Valor de passar ---
  const teammates = view.offense.filter((o) => o.id !== a.id);
  const candidates = rankPassTargets(a, teammates, view.defense, view.attackingSide, t);
  const bestPass = candidates[0];
  const passValue = bestPass
    ? clamp01(bestPass.score) * (0.5 + (a.profile.tendencies.pass / 100) * 1.1) * t.ai.passWillingness * 2.1
      * (1 + usagePenalty)
    : 0;

  // --- Valor de criar com drible ---
  const creationValue = clamp01(
    attr01(a.effective.ballHandle) * 0.55
    + (a.profile.tendencies.dribbleFrequency / 100) * 0.35
    - (shotClock < 8 ? 0.25 : 0)
    - (1 - a.adrenaline) * 0.2,
  ) * (read && read.nearestDefender < 2.2 ? 1 : 0.4);

  // --- Valor de postar ---
  const mismatch = view.mismatches.find((m) => m.attackerId === a.id);
  const postValue = mismatch && mismatch.kind === 'post'
    ? clamp01(0.4 + mismatch.magnitude / 40) * (a.profile.tendencies.postUp / 100) * 1.4
    : 0;

  const options: { kind: OffensiveIntentKind; value: number }[] = [
    { kind: 'shoot', value: shootValue },
    { kind: 'drive', value: driveValue },
    { kind: 'pass', value: passValue },
    { kind: 'dribble_move', value: creationValue },
    { kind: 'post_up', value: postValue },
  ];
  options.sort((x, y) => y.value - x.value);
  const top = options[0];

  // Limiar de qualidade: nao arremessa qualquer coisa so por ser a melhor opcao.
  const threshold = t.ai.shotQualityThreshold * (desperation ? 0.35 : 1) + (earlyClock ? 0.14 : 0) - (freshCatch ? 0.1 : 0);

  if (top.kind === 'shoot' && (sq >= threshold || desperation)) {
    return {
      kind: 'shoot',
      intent: { move: v2(), sprint: false, facing: toAngle(sub2(hoop, a.pos)), stance: 'dribble', brake: true },
      reason: desperation ? 'relogio estourando' : `arremesso de qualidade ${(sq * 100).toFixed(0)}%`,
      value: sq,
    };
  }

  if (top.kind === 'drive' && lane) {
    return {
      kind: 'drive',
      intent: { move: lane.dir, sprint: true, facing: toAngle(lane.dir), stance: 'dribble', brake: false },
      reason: `linha livre (${lane.clearance.toFixed(1)} m)`,
      value: driveValue,
    };
  }

  if (top.kind === 'pass' && bestPass) {
    const dir = norm2(sub2(bestPass.actor.pos, a.pos));
    return {
      kind: 'pass',
      intent: { move: v2(), sprint: false, facing: toAngle(dir), stance: 'dribble', brake: true },
      passTargetId: bestPass.actor.id,
      reason: bestPass.reason,
      value: passValue,
    };
  }

  if (top.kind === 'post_up' && mismatch) {
    const postSpot = add2(hoop, mul2(norm2(sub2(a.pos, hoop)), 3.2));
    const dir = sub2(postSpot, a.pos);
    return {
      kind: 'post_up',
      intent: { move: len2(dir) > 0.3 ? norm2(dir) : v2(), sprint: false, facing: toAngle(sub2(hoop, a.pos)), stance: 'post', brake: len2(dir) < 0.3 },
      reason: `mismatch de tamanho (+${(mismatch.sizeEdge * 100).toFixed(0)} cm)`,
      value: postValue,
    };
  }

  if (top.kind === 'dribble_move') {
    const defender = view.defense.find((d) => d.id === a.markedById);
    const desired = lane ? lane.dir : norm2(sub2(hoop, a.pos));
    const spaceAhead = lane ? lane.clearance : 1;
    const picked = pickMove(a, defender?.weightShift, desired, spaceAhead, shotClock, rng, a.profile.signature.dribbleMoves);
    if (picked) {
      return {
        kind: 'dribble_move',
        intent: { move: mul2(desired, 0.35), sprint: false, facing: toAngle(desired), stance: 'dribble', brake: false },
        moveId: picked.move.id,
        moveSide: picked.side,
        reason: `criando com ${picked.move.name}`,
        value: creationValue,
      };
    }
  }

  // Reset: recua e reorganiza.
  const resetSpot = add2(hoop, mul2(norm2(sub2(a.pos, hoop)), COURT.threeArcRadius + 1.4));
  const dir = sub2(resetSpot, a.pos);
  return {
    kind: 'reset',
    intent: { move: len2(dir) > 0.4 ? norm2(dir) : v2(), sprint: false, facing: toAngle(sub2(hoop, a.pos)), stance: 'dribble', brake: len2(dir) < 0.4 },
    reason: 'reorganizando a posse',
    value: 0.2,
  };
}

/** Decisao sem bola: executa o papel na jogada, mas le vantagens melhores. */
export function decideOffBall(a: Actor, ctx: OffenseContext): OffensiveDecision {
  const { view, t, rng } = ctx;
  const hoop = hoopGround(view.attackingSide);
  const handler = view.ballHandler;
  const read = view.reads.get(a.id);
  const defender = view.defense.find((d) => d.id === a.markedById);

  // 1) Backdoor cut: o defensor virou a cabeca para a bola e esta colado.
  if (defender && handler) {
    const defFacingBall = Math.abs(angleDiff(defender.heading, toAngle(sub2(handler.pos, defender.pos)))) < 0.7;
    const tight = dist2(defender.pos, a.pos) < 1.6;
    const laneToRim = dist2(a.pos, hoop) > 2 && dist2(a.pos, hoop) < 9;
    const cutUrge = (a.profile.tendencies.cut / 100) * ctx.profile.readQuality;
    if (defFacingBall && tight && laneToRim && rng.chance(cutUrge * 0.08)) {
      const dir = norm2(sub2(hoop, a.pos));
      return { kind: 'cut', intent: { move: dir, sprint: true, facing: toAngle(dir), stance: 'normal', brake: false }, reason: 'backdoor: defensor de costas', value: 0.8 };
    }
  }

  // 2) Reposicionar quando a penetracao vem na sua direcao (drift/relocate).
  if (handler && len2(handler.vel) > 3 && dist2(handler.pos, a.pos) < 6) {
    const driveDir = norm2(handler.vel);
    const towardMe = dot2(driveDir, norm2(sub2(a.pos, handler.pos)));
    if (towardMe > 0.55) {
      const away = norm2(sub2(a.pos, handler.pos));
      const target = clampToCourt(add2(a.pos, mul2(away, 2.6)), 0.7);
      const dir = sub2(target, a.pos);
      return {
        kind: 'move',
        intent: { move: norm2(dir), sprint: false, facing: toAngle(sub2(hoop, a.pos)), stance: 'normal', brake: false },
        reason: 'abrindo espaco para a penetracao',
        value: 0.6,
      };
    }
  }

  // 3) Papel na jogada chamada.
  if (ctx.play) {
    const playCtx: PlayContext = { side: view.attackingSide, roles: view.offense, phase: ctx.playPhase, wing: ctx.playWing };
    const instr: RoleInstruction = ctx.play.instruction(ctx.role, playCtx);
    const dir = sub2(instr.target, a.pos);
    const d = len2(dir);
    const arrived = d < 0.5;

    if (instr.action === 'screen' && arrived) {
      return { kind: 'screen', intent: { move: v2(), sprint: false, facing: handler ? toAngle(sub2(handler.pos, a.pos)) : a.heading, stance: 'normal', brake: true }, reason: 'colocando bloqueio', value: 0.5 };
    }
    if (instr.action === 'handoff' && arrived) {
      return { kind: 'handoff', intent: { move: v2(), sprint: false, facing: handler ? toAngle(sub2(handler.pos, a.pos)) : a.heading, stance: 'normal', brake: true }, reason: 'esperando o handoff', value: 0.5 };
    }
    if (instr.action === 'post' && arrived) {
      return { kind: 'post_up', intent: { move: v2(), sprint: false, facing: toAngle(sub2(hoop, a.pos)), stance: 'post', brake: true }, reason: 'segurando posicao de poste', value: 0.5 };
    }

    const sprint = instr.action === 'cut' || instr.action === 'roll' || instr.action === 'relocate' || d > 4.5;
    return {
      kind: instr.action === 'cut' || instr.action === 'roll' ? 'cut' : 'move',
      intent: {
        move: d > 0.25 ? norm2(dir) : v2(),
        sprint,
        facing: toAngle(sub2(handler ? handler.pos : hoop, a.pos)),
        stance: 'normal',
        brake: d <= 0.25,
      },
      reason: `${ctx.play.name}: ${instr.action}`,
      value: instr.readPriority,
    };
  }

  // 4) Sem jogada: mantem espacamento.
  const spot = spacingSpot(view, a, ctx.role, t);
  const dir = sub2(spot, a.pos);
  return {
    kind: 'move',
    intent: {
      move: len2(dir) > 0.3 ? norm2(dir) : v2(),
      sprint: len2(dir) > 4,
      facing: toAngle(sub2(handler ? handler.pos : hoop, a.pos)),
      stance: 'normal',
      brake: len2(dir) <= 0.3,
    },
    reason: 'mantendo espacamento',
    value: 0.3,
  };
}

/**
 * TRANSICAO (secao 31): assim que a posse muda, os cinco tem tarefas
 * imediatas - correr a lane, abrir o campo, liderar o contra-ataque.
 */
export function transitionAssignment(a: Actor, ctx: OffenseContext, index: number): OffensiveDecision {
  const { view } = ctx;
  const hoop = hoopGround(view.attackingSide);
  const dirToHoop = view.attackingSide === 0 ? -1 : 1;
  const runner = attr01(a.effective.speed) * 0.5 + (a.profile.tendencies.runFloor / 100) * 0.5;

  // Rim run para quem corre bem e finaliza; lanes largas para os atiradores.
  let target: Vec2;
  let reason: string;
  if (a.hasBall) {
    target = add2(hoop, mul2(v2(-dirToHoop, 0), 7));
    reason = 'conduzindo o contra-ataque';
  } else if (runner > 0.6 && a.effective.drivingDunk > 74) {
    target = add2(hoop, mul2(v2(-dirToHoop, 0), 1.8));
    reason = 'rim run';
  } else if (index % 2 === 0) {
    target = v2(hoop.x - dirToHoop * (COURT.threeArcRadius * 0.75), COURT.threeCornerY + 0.4);
    reason = 'lane larga esquerda';
  } else {
    target = v2(hoop.x - dirToHoop * (COURT.threeArcRadius * 0.75), COURT.width - COURT.threeCornerY - 0.4);
    reason = 'lane larga direita';
  }
  target = clampToCourt(target, 0.6);
  const dir = sub2(target, a.pos);
  return {
    kind: 'move',
    intent: { move: len2(dir) > 0.4 ? norm2(dir) : v2(), sprint: true, facing: toAngle(sub2(hoop, a.pos)), stance: 'normal', brake: len2(dir) <= 0.4 },
    reason,
    value: 0.7,
  };
}

/** Defesa de transicao: quem volta e quem ataca o rebote ofensivo. */
export function shouldCrashGlass(a: Actor, gameplan: Gameplan, distanceToRim: number): boolean {
  const tendency = a.profile.tendencies.crashOffensiveGlass / 100;
  return distanceToRim < 6.5 && tendency * (0.5 + gameplan.crashOffensiveGlass) > 0.32;
}
