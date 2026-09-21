/**
 * IA DEFENSIVA (secoes 21, 22, 32, 33, 34).
 *
 * Tres camadas:
 *  1) ATRIBUICAO: quem marca quem, por tamanho, velocidade e ameaca.
 *  2) INDIVIDUAL: posicao ideal, cushion, forcar mao fraca, contest, closeout.
 *  3) COLETIVA: cobertura de pick-and-roll, ajuda do lado fraco, rotacao de
 *     recuperacao (X-out), dobra na estrela.
 *
 * A cobertura de PnR e o coracao tatico: o mesmo bloqueio gera respostas
 * completamente diferentes (drop, hedge, switch, blitz, ice) e o ataque pode
 * ler e explorar cada uma delas.
 */
import { Vec2, add2, dist2, dot2, fromAngle, len2, mul2, norm2, sub2, toAngle, v2, angleDiff } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor } from '../sim/actor.js';
import { LocomotionIntent } from '../sim/locomotion.js';
import { CourtView } from './perception.js';
import { Tuning } from '../config/tuning.js';
import { COURT, Side, clampToCourt, distToHoop, hoopGround, isInPaint, isThreePointShot } from '../config/court.js';
import { Gameplan, PnrCoverage } from '../model/team.js';
import { chooseStance, idealDefensivePosition, planCutoff, reactionTime } from '../sim/defense.js';
import { AiProfile } from '../config/sliders.js';

export interface DefensiveAssignment {
  defenderId: string;
  attackerId: string;
  /** Qualidade do casamento (0..1). 1 = defensor bem equipado para a tarefa. */
  fit: number;
}

/** Atribui marcacoes: cada defensor pega o atacante que melhor consegue conter. */
export function assignMatchups(defenders: Actor[], attackers: Actor[], gameplan: Gameplan): DefensiveAssignment[] {
  const out: DefensiveAssignment[] = [];
  const available = defenders.filter((d) => d.onCourt);
  const targets = attackers.filter((a) => a.onCourt);

  // Ordena atacantes por ameaca: a melhor opcao defensiva vai para o mais perigoso.
  const threat = (a: Actor) => a.effective.threePoint * 0.3 + a.effective.drivingLayup * 0.25
    + a.effective.ballHandle * 0.2 + a.effective.postControl * 0.1 + a.effective.speedWithBall * 0.15;
  const sorted = [...targets].sort((x, y) => threat(y) - threat(x));

  const used = new Set<string>();
  for (const att of sorted) {
    let best: Actor | undefined;
    let bestFit = -Infinity;
    for (const def of available) {
      if (used.has(def.id)) continue;
      const fit = matchupFit(def, att);
      if (fit > bestFit) {
        bestFit = fit;
        best = def;
      }
    }
    if (best) {
      used.add(best.id);
      out.push({ defenderId: best.id, attackerId: att.id, fit: clamp01(bestFit) });
      best.assignmentId = att.id;
      att.markedById = best.id;
    }
  }
  return out;
}

export function matchupFit(def: Actor, att: Actor): number {
  const heightGap = def.profile.physique.height - att.profile.physique.height;
  const sizeFit = 1 - Math.abs(heightGap) / 0.25;
  const speedFit = clamp01((def.effective.lateralQuickness - att.effective.speedWithBall + 15) / 30);
  const strengthFit = clamp01((def.effective.strength - att.effective.strength + 15) / 30);
  const perimeterNeed = clamp01((att.effective.threePoint - 60) / 39);
  const interiorNeed = clamp01((att.effective.postControl - 60) / 39);
  const skillFit = def.effective.perimeterDefense / 99 * perimeterNeed + def.effective.interiorDefense / 99 * interiorNeed;
  return sizeFit * 0.3 + speedFit * 0.25 + strengthFit * 0.15 + skillFit * 0.3;
}

export interface ScreenSituation {
  screenerId: string;
  handlerId: string;
  /** Distancia do bloqueio ao portador. */
  distance: number;
  /** Lado do bloqueio. */
  side: -1 | 1;
  /** Ja houve contato com o defensor do portador. */
  engaged: boolean;
}

export function detectScreen(view: CourtView, handler: Actor): ScreenSituation | undefined {
  for (const a of view.offense) {
    if (!a.onCourt || a.id === handler.id) continue;
    if (a.state !== 'screen' && a.action.kind !== 'screen') continue;
    const d = dist2(a.pos, handler.pos);
    if (d > 3.2) continue;
    const toScreen = norm2(sub2(a.pos, handler.pos));
    const forward = len2(handler.vel) > 0.6 ? norm2(handler.vel) : fromAngle(handler.heading);
    const perp = v2(-forward.y, forward.x);
    const side = dot2(toScreen, perp) > 0 ? 1 : -1;
    const defender = view.defense.find((x) => x.id === handler.markedById);
    const engaged = defender ? dist2(defender.pos, a.pos) < 1.3 : false;
    return { screenerId: a.id, handlerId: handler.id, distance: d, side: side as -1 | 1, engaged };
  }
  return undefined;
}

export interface DefensiveDecision {
  intent: LocomotionIntent;
  /** Acoes pedidas neste tique. */
  contest: boolean;
  attemptSteal: boolean;
  attemptBlock: boolean;
  boxout: boolean;
  /** Alvo de boxout, se houver. */
  boxoutTargetId?: string;
  /** Rotulo para o visualizador de decisao (ferramenta de debug, secao 138). */
  reason: string;
  /** Cobertura aplicada, se em PnR. */
  coverage?: PnrCoverage;
}

/** Decisao defensiva completa de um defensor. */
export function decideDefense(
  defender: Actor,
  view: CourtView,
  gameplan: Gameplan,
  t: Tuning,
  profile: AiProfile,
  ctx: { shotInFlight: boolean; loosePos?: Vec2; timeLeft: number; scoreDiff: number },
): DefensiveDecision {
  const handler = view.ballHandler;
  const assignment = view.offense.find((a) => a.id === defender.assignmentId);
  const hoop = hoopGround(view.attackingSide);
  const defaultIntent: LocomotionIntent = { move: v2(), sprint: false, stance: 'defense', brake: true };

  // Bola solta ou rebote: todo mundo vai para a bola/boxout.
  if (ctx.loosePos) {
    const dir = norm2(sub2(ctx.loosePos, defender.pos));
    const target = assignment && dist2(defender.pos, ctx.loosePos) > 2.6 ? assignment : undefined;
    return {
      intent: { move: dir, sprint: true, facing: toAngle(dir), stance: 'normal', brake: false },
      contest: false, attemptSteal: false, attemptBlock: false,
      boxout: !!target, boxoutTargetId: target?.id,
      reason: 'bola solta',
    };
  }

  if (ctx.shotInFlight) {
    // Boxout: fica entre o adversario e o aro.
    if (assignment) {
      const between = add2(assignment.pos, mul2(norm2(sub2(hoop, assignment.pos)), 0.55));
      const dir = sub2(between, defender.pos);
      return {
        intent: { move: len2(dir) > 0.2 ? norm2(dir) : v2(), sprint: len2(dir) > 2.4, facing: toAngle(sub2(assignment.pos, defender.pos)), stance: 'defense', brake: len2(dir) < 0.2 },
        contest: false, attemptSteal: false, attemptBlock: false,
        boxout: true, boxoutTargetId: assignment.id,
        reason: 'boxout no arremesso',
      };
    }
    const dir = sub2(hoop, defender.pos);
    return { intent: { move: norm2(dir), sprint: true, stance: 'normal', brake: false }, contest: false, attemptSteal: false, attemptBlock: false, boxout: false, reason: 'crash defensivo' };
  }

  if (!handler) return { intent: defaultIntent, contest: false, attemptSteal: false, attemptBlock: false, boxout: false, reason: 'sem portador' };

  const onBall = defender.assignmentId === handler.id;
  const stance = chooseStance(defender, onBall ? handler : (assignment ?? handler), view.attackingSide, t, gameplan.foulTolerance);

  // ---------------------------------------------------------------- ON BALL
  if (onBall) {
    const screen = detectScreen(view, handler);
    if (screen) {
      return coverageDecision(defender, handler, screen, view, gameplan, t, profile);
    }

    const cutoff = planCutoff(defender, handler, view.attackingSide, t);
    const ideal = idealDefensivePosition(defender, handler, view.attackingSide, stance);
    const target = cutoff.viable && len2(handler.vel) > 2.5 ? cutoff.target : ideal;
    const toTarget = sub2(target, defender.pos);
    const distToHandler = dist2(defender.pos, handler.pos);

    const shooting = handler.action.kind === 'shot_windup';
    const drivingFast = len2(handler.vel) > 3.2;
    const contestNow = shooting || (distToHandler < t.defense.contestRange && handler.action.kind === 'shot_release');

    // Roubo: so quando a bola esta exposta e a postura permite.
    const exposure = handler.action.kind === 'dribble_move' ? 0.6 : 0.25;
    const stealUrge = (defender.profile.tendencies.attemptSteal / 100) * profile.aggression;
    const attemptStealNow = exposure > 0.5 && distToHandler < 1.25 && stealUrge > 0.62 && defender.balance > 0.7;

    return {
      intent: {
        move: len2(toTarget) > 0.12 ? norm2(toTarget) : v2(),
        sprint: len2(toTarget) > 2.2 || drivingFast,
        facing: toAngle(sub2(handler.pos, defender.pos)),
        stance: 'defense',
        brake: len2(toTarget) < 0.12,
      },
      contest: contestNow,
      attemptSteal: attemptStealNow,
      attemptBlock: shooting && distToHandler < 2.2 && isInPaint(handler.pos, view.attackingSide === 0 ? 0 : 1),
      boxout: false,
      reason: cutoff.viable ? `contencao ${cutoff.kind}` : 'marcacao individual',
    };
  }

  // --------------------------------------------------------------- OFF BALL
  if (!assignment) {
    const dir = sub2(hoop, defender.pos);
    return { intent: { move: norm2(dir), sprint: false, stance: 'defense', brake: false }, contest: false, attemptSteal: false, attemptBlock: false, boxout: false, reason: 'recuperando' };
  }

  // Precisa ajudar? O portador venceu o marcador dele e vai ao aro.
  const help = evaluateHelp(defender, handler, view, gameplan, t, profile);
  if (help.shouldHelp) {
    const toHelp = sub2(help.target, defender.pos);
    return {
      intent: { move: len2(toHelp) > 0.15 ? norm2(toHelp) : v2(), sprint: true, facing: toAngle(sub2(handler.pos, defender.pos)), stance: 'defense', brake: false },
      contest: dist2(defender.pos, handler.pos) < t.defense.contestRange,
      attemptSteal: false,
      attemptBlock: dist2(defender.pos, handler.pos) < 2.0 && handler.action.kind === 'gather',
      boxout: false,
      reason: `ajuda ${help.kind}`,
    };
  }

  // Posicao de ajuda-e-recuperacao: um passo dentro da linha, sem perder o homem.
  const ballLine = norm2(sub2(handler.pos, assignment.pos));
  const sag = clamp(
    lerp(0.4, 2.4, 1 - attr01(assignment.effective.threePoint)) * (0.6 + gameplan.helpAggression * 0.8),
    0.3, 3.2,
  );
  const denyTarget = add2(assignment.pos, mul2(ballLine, sag * 0.55));
  const helpTarget = add2(assignment.pos, mul2(norm2(sub2(hoop, assignment.pos)), sag * 0.45));
  const weakSide = Math.abs(assignment.pos.y - handler.pos.y) > 4.5;
  const target = weakSide ? helpTarget : denyTarget;
  const toTarget = sub2(target, defender.pos);

  return {
    intent: {
      move: len2(toTarget) > 0.2 ? norm2(toTarget) : v2(),
      sprint: len2(toTarget) > 3,
      facing: toAngle(sub2(mul2(add2(handler.pos, assignment.pos), 0.5), defender.pos)),
      stance: 'defense',
      brake: len2(toTarget) < 0.2,
    },
    contest: false,
    // Tentativa fora da bola e sobre a LINHA DE PASSE do proprio marcado,
    // nao sobre o portador do outro lado da quadra.
    attemptSteal: false,
    attemptBlock: false,
    boxout: false,
    reason: weakSide ? 'ajuda do lado fraco' : 'negando a linha de passe',
  };
}

export interface HelpEvaluation {
  shouldHelp: boolean;
  target: Vec2;
  kind: 'rim' | 'gap' | 'double' | 'none';
}

/** Decide se este defensor deve largar o homem para proteger o aro. */
export function evaluateHelp(
  defender: Actor, handler: Actor, view: CourtView, gameplan: Gameplan, t: Tuning, profile: AiProfile,
): HelpEvaluation {
  const hoop = hoopGround(view.attackingSide);
  const handlerToRim = dist2(handler.pos, hoop);
  const onBallDefender = view.defense.find((d) => d.id === handler.markedById);
  const beaten = onBallDefender
    ? dot2(norm2(sub2(hoop, handler.pos)), norm2(sub2(onBallDefender.pos, handler.pos))) < 0.25 && len2(handler.vel) > 2.4
    : true;

  const myAssignment = view.offense.find((a) => a.id === defender.assignmentId);
  const myThreat = myAssignment ? (view.reads.get(myAssignment.id)?.gravity ?? 0.4) : 0.4;
  const distanceToHelp = dist2(defender.pos, handler.pos);

  // Dobra na estrela (gameplan).
  if (gameplan.doubleTeamStar > 0.35 && handler.id === gameplan.huntTargetId && distanceToHelp < 5) {
    return { shouldHelp: true, target: add2(handler.pos, mul2(norm2(sub2(defender.pos, handler.pos)), 0.8)), kind: 'double' };
  }

  if (!beaten || handlerToRim > 6.5) return { shouldHelp: false, target: defender.pos, kind: 'none' };
  if (distanceToHelp > t.ai.helpDistance * (0.7 + gameplan.helpAggression * 0.8)) {
    return { shouldHelp: false, target: defender.pos, kind: 'none' };
  }

  // Um atirador de elite no canto NAO e largado facilmente: essa e a gravidade.
  const willingness = clamp01(
    (attr01(defender.effective.helpDefenseIQ) * 0.5 + profile.readQuality * 0.3 + gameplan.helpAggression * 0.4)
    - myThreat * 0.55,
  );
  if (willingness < 0.32) return { shouldHelp: false, target: defender.pos, kind: 'none' };

  const interceptPoint = add2(hoop, mul2(norm2(sub2(handler.pos, hoop)), 1.5));
  return { shouldHelp: true, target: interceptPoint, kind: handlerToRim < 4 ? 'rim' : 'gap' };
}

/** Executa a cobertura de pick-and-roll escolhida pelo gameplan (secao 32). */
export function coverageDecision(
  defender: Actor,
  handler: Actor,
  screen: ScreenSituation,
  view: CourtView,
  gameplan: Gameplan,
  t: Tuning,
  profile: AiProfile,
): DefensiveDecision {
  const hoop = hoopGround(view.attackingSide);
  const screener = view.offense.find((a) => a.id === screen.screenerId);
  const coverage = adaptCoverage(gameplan.pnrCoverage, handler, screener, defender, profile);
  const forward = len2(handler.vel) > 0.6 ? norm2(handler.vel) : norm2(sub2(hoop, handler.pos));
  const perp = v2(-forward.y, forward.x);
  let target: Vec2;
  let sprint = true;
  let reason = coverage;

  switch (coverage) {
    case 'over':
      // Passa por cima do bloqueio, colado no ombro do portador.
      target = add2(handler.pos, mul2(norm2(sub2(hoop, handler.pos)), 0.8));
      break;
    case 'under':
      // Passa por baixo: cede o arremesso, protege a penetracao.
      target = add2(handler.pos, mul2(norm2(sub2(hoop, handler.pos)), 1.7));
      sprint = false;
      break;
    case 'ice':
      // Empurra o portador para a linha lateral, longe do bloqueio.
      target = add2(handler.pos, mul2(perp, -screen.side * 1.1));
      break;
    case 'switch':
    case 'late_switch':
      // Troca: assume o bloqueador, o outro defensor assume o portador.
      target = screener ? add2(screener.pos, mul2(norm2(sub2(hoop, screener.pos)), 0.7)) : handler.pos;
      if (screener) {
        defender.assignmentId = screener.id;
        screener.markedById = defender.id;
      }
      break;
    case 'blitz':
    case 'trap':
      target = add2(handler.pos, mul2(norm2(sub2(defender.pos, handler.pos)), 0.7));
      break;
    case 'hedge':
      target = screener ? add2(screener.pos, mul2(forward, 0.9)) : handler.pos;
      break;
    case 'weak':
      target = add2(handler.pos, mul2(perp, screen.side * 0.9));
      break;
    case 'drop':
    default:
      target = add2(handler.pos, mul2(norm2(sub2(hoop, handler.pos)), 2.2));
      sprint = false;
      break;
  }

  const toTarget = sub2(target, defender.pos);
  return {
    intent: {
      move: len2(toTarget) > 0.12 ? norm2(toTarget) : v2(),
      sprint,
      facing: toAngle(sub2(handler.pos, defender.pos)),
      stance: 'defense',
      brake: len2(toTarget) < 0.12,
    },
    contest: dist2(defender.pos, handler.pos) < t.defense.contestRange && handler.action.kind === 'shot_windup',
    attemptSteal: (coverage === 'blitz' || coverage === 'trap') && dist2(defender.pos, handler.pos) < 1.4,
    attemptBlock: false,
    boxout: false,
    reason: `PnR: ${reason}`,
    coverage,
  };
}

/**
 * Adapta a cobertura ao contexto real: um pivo lento nao faz switch em um
 * armador rapido; um grande que nao arremessa libera drop profundo.
 */
export function adaptCoverage(
  base: PnrCoverage, handler: Actor, screener: Actor | undefined, defender: Actor, profile: AiProfile,
): PnrCoverage {
  if (!screener) return base;
  const handlerShooting = attr01(handler.effective.threePoint);
  const screenerShooting = attr01(screener.effective.threePoint);
  const defenderLateral = attr01(defender.effective.lateralQuickness);

  // Com leitura alta, a IA corrige coberturas obviamente erradas.
  if (profile.readQuality > 0.55) {
    if (base === 'drop' && handlerShooting > 0.85) return 'over';
    if (base === 'switch' && defenderLateral < 0.4 && attr01(handler.effective.speedWithBall) > 0.8) return 'hedge';
    if (base === 'under' && handlerShooting > 0.8) return 'over';
    if ((base === 'hedge' || base === 'blitz') && screenerShooting > 0.8) return 'switch';
  }
  return base;
}

/** MATCHUP HUNTING: o ataque cacando um defensor especifico (secao 34). */
export function shouldSwitchToAvoidHunt(view: CourtView, gameplan: Gameplan): boolean {
  if (!gameplan.huntTargetId) return false;
  const hunted = view.defense.find((d) => d.id === gameplan.huntTargetId);
  return !!hunted && hunted.fouls < 4;
}
