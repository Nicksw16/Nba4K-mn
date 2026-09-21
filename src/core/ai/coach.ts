/**
 * TREINADOR (secoes 33, 35).
 *
 * O tecnico observa a partida e mexe em tres alavancas:
 *  - PLAYCALLING: qual jogada chamar agora, dado o placar, o relogio e quem
 *    esta quente;
 *  - ROTACAO: quem entra e quem sai, por fadiga, faltas e rendimento;
 *  - ESTRATEGIA: mudar cobertura de PnR, agressividade de ajuda, ritmo e foco
 *    quando o que esta sendo feito nao funciona.
 *
 * A adaptacao usa dados da propria partida (o que o adversario esta
 * convertendo), nao valores fixos.
 */
import { clamp, clamp01, lerp } from '../math/util.js';
import { Actor } from '../sim/actor.js';
import { Coach, Gameplan, PnrCoverage, Team, Tempo, OffensiveFocus } from '../model/team.js';
import { Play, PLAYS, PLAY_BY_ID, choosePlay } from './playbook.js';
import { Rng } from '../math/rng.js';
import { Tuning } from '../config/tuning.js';
import { AiProfile } from '../config/sliders.js';
import { overall } from '../model/attributes.js';

export interface GameSnapshot {
  period: number;
  clock: number;
  scoreFor: number;
  scoreAgainst: number;
  /** Ultimos 3 minutos: pontos cedidos por zona. */
  opponentPaintPoints: number;
  opponentThreePoints: number;
  opponentTransitionPoints: number;
  ownTurnovers: number;
  ownOffensiveRating: number;
  opponentOffensiveRating: number;
  teamFouls: number;
  timeoutsLeft: number;
  /** Sequencia recente do adversario (pontos sem resposta). */
  opponentRun: number;
}

export interface CoachDecision {
  play?: Play;
  gameplanChanges: Partial<Gameplan>;
  substitutions: { out: string; in: string }[];
  timeout: boolean;
  /** Explicacao para a apresentacao/comentario. */
  notes: string[];
}

/** Chama a jogada da posse. */
export function callPlay(
  team: Team, lineup: Actor[], snapshot: GameSnapshot, transition: boolean, mismatchKind: string | undefined, rng: Rng,
): Play {
  // Fim de jogo apertado: a bola vai para quem esta quente ou para o melhor criador.
  const clutch = snapshot.period >= 4 && snapshot.clock < 120 && Math.abs(snapshot.scoreFor - snapshot.scoreAgainst) <= 6;
  if (clutch) {
    const hot = [...lineup].sort((a, b) => b.heat - a.heat)[0];
    if (hot && hot.heat > 0.3) {
      return hot.effective.ballHandle > 78 ? PLAY_BY_ID.get('iso_top')! : PLAY_BY_ID.get('pindown')!;
    }
    return PLAY_BY_ID.get('spread_pnr')!;
  }
  return choosePlay(lineup, team.gameplan.offensiveFocus, mismatchKind, transition, rng);
}

/** Ajusta o gameplan com base no que o adversario esta fazendo. */
export function adaptGameplan(team: Team, snapshot: GameSnapshot, profile: AiProfile): { changes: Partial<Gameplan>; notes: string[] } {
  const raw: Partial<Gameplan> = {};
  const changes: Partial<Gameplan> = {};
  const notes: string[] = [];
  const willing = team.coach.adaptability / 100 * profile.adaptivity;
  if (willing < 0.18) return { changes, notes };

  const gp = team.gameplan;

  // Levando muito no garrafao -> proteger o aro.
  if (snapshot.opponentPaintPoints > snapshot.opponentThreePoints * 1.6 && snapshot.opponentPaintPoints > 14) {
    if (gp.pnrCoverage !== 'drop') {
      changes.pnrCoverage = 'drop';
      notes.push('Mudanca: recuar o pivo no pick and roll para fechar o garrafao.');
    }
    changes.helpAggression = clamp01(gp.helpAggression + 0.18);
    changes.paintEmphasis = clamp01(gp.paintEmphasis + 0.1);
  }

  // Levando muito de tres -> sair mais forte no perimetro.
  if (snapshot.opponentThreePoints > 21 && snapshot.opponentThreePoints > snapshot.opponentPaintPoints) {
    if (gp.pnrCoverage === 'drop' || gp.pnrCoverage === 'under') {
      changes.pnrCoverage = 'over';
      notes.push('Mudanca: passar por cima dos bloqueios e negar o arremesso de tres.');
    }
    changes.helpAggression = clamp01(gp.helpAggression - 0.12);
  }

  // Levando em transicao -> segurar o rebote ofensivo.
  if (snapshot.opponentTransitionPoints > 12) {
    changes.crashOffensiveGlass = clamp01(gp.crashOffensiveGlass - 0.2);
    notes.push('Mudanca: parar de atacar o rebote ofensivo para proteger a transicao.');
  }

  // Ataque travado -> mudar foco.
  if (snapshot.ownOffensiveRating < 95 && snapshot.period >= 2) {
    const next: OffensiveFocus = gp.offensiveFocus === 'perimeter' ? 'pick_and_roll'
      : gp.offensiveFocus === 'pick_and_roll' ? 'movement'
      : gp.offensiveFocus === 'movement' ? 'inside' : 'perimeter';
    changes.offensiveFocus = next;
    notes.push(`Mudanca ofensiva: foco em ${next}.`);
  }

  // Perdendo no final -> acelerar e pressionar.
  const diff = snapshot.scoreFor - snapshot.scoreAgainst;
  if (snapshot.period >= 4 && diff < -6 && snapshot.clock < 300) {
    changes.tempo = 'blitz' as Tempo;
    changes.pressFullCourt = clamp01(gp.pressFullCourt + 0.35);
    changes.threePointEmphasis = clamp01(gp.threePointEmphasis + 0.25);
    notes.push('Mudanca: acelerar o ritmo, pressionar a quadra inteira e caçar o tres.');
  }
  // Ganhando no final -> segurar a bola.
  if (snapshot.period >= 4 && diff > 8 && snapshot.clock < 240) {
    changes.tempo = 'grind' as Tempo;
    changes.crashOffensiveGlass = clamp01(gp.crashOffensiveGlass - 0.25);
    notes.push('Mudanca: segurar o ritmo e proteger a vantagem.');
  }

  // Muita falta -> baixar a agressividade.
  if (snapshot.teamFouls >= 4 && snapshot.period <= 3) {
    changes.foulTolerance = clamp01(gp.foulTolerance - 0.25);
    notes.push('Mudanca: defender sem arriscar falta.');
  }

  // Filtra: mudanca que nao altera nada nao e mudanca (e nao vira anuncio).
  for (const key of Object.keys(changes) as (keyof Gameplan)[]) {
    const before = gp[key];
    const after = changes[key];
    if (after === undefined) continue;
    if (typeof before === 'number' && typeof after === 'number' && Math.abs(before - after) < 0.02) {
      delete changes[key];
    } else if (before === after) {
      delete changes[key];
    }
  }
  if (Object.keys(changes).length === 0) return { changes, notes: [] };
  return { changes, notes };
}

export interface RotationState {
  /** Segundos jogados nesta partida por atleta. */
  minutes: Map<string, number>;
  /** Alvo de minutos por atleta. */
  targets: Map<string, number>;
  lastSubClock: number;
}

export function buildRotationTargets(team: Team): Map<string, number> {
  const targets = new Map<string, number>();
  const ranked = [...team.roster].sort((a, b) => overall(b.attributes, b.position) - overall(a.attributes, a.position));
  const minutesCurve = [2160, 2040, 1980, 1860, 1800, 1320, 1200, 1080, 900, 600, 240, 120, 0, 0, 0];
  ranked.forEach((p, i) => targets.set(p.id, (minutesCurve[i] ?? 0) / 60));
  return targets;
}

/**
 * Substituicoes: prioriza fadiga real, problema de falta e rendimento,
 * respeitando a disciplina de rotacao do tecnico.
 */
export function planSubstitutions(
  onCourt: Actor[],
  bench: Actor[],
  state: RotationState,
  snapshot: GameSnapshot,
  coach: Coach,
  t: Tuning,
): { out: string; in: string }[] {
  const subs: { out: string; in: string }[] = [];
  if (bench.length === 0) return subs;
  // Nao troca em qualquer momento: respeita um intervalo minimo.
  if (snapshot.clock > 0 && Math.abs(state.lastSubClock - snapshot.clock) < 150) return subs;

  const discipline = coach.rotationDiscipline / 100;
  const candidatesOut = onCourt
    .map((a) => {
      const foulTrouble = a.fouls >= (snapshot.period <= 2 ? 3 : snapshot.period === 3 ? 4 : 5);
      const gassed = 1 - a.stamina;
      const minutes = state.minutes.get(a.id) ?? 0;
      const target = state.targets.get(a.id) ?? 20;
      const overplayed = clamp01((minutes / 60 - target) / 8);
      const urgency = gassed * 0.6 + (foulTrouble ? 0.55 : 0) + overplayed * discipline * 0.5;
      return { actor: a, urgency, foulTrouble };
    })
    .filter((c) => c.urgency > 0.62)
    .sort((x, y) => y.urgency - x.urgency);

  const candidatesIn = bench
    .filter((b) => b.stamina > 0.7 && b.fouls < t.fouls.foulOutLimit)
    .map((b) => {
      const minutes = state.minutes.get(b.id) ?? 0;
      const target = state.targets.get(b.id) ?? 12;
      const owed = clamp01((target - minutes / 60) / 8);
      return { actor: b, score: overall(b.profile.attributes, b.profile.position) / 99 * 0.6 + owed * 0.4 + b.stamina * 0.2 };
    })
    .sort((x, y) => y.score - x.score);

  const usedIn = new Set<string>();
  for (const out of candidatesOut.slice(0, 1)) {
    const replacement = candidatesIn.find((c) => !usedIn.has(c.actor.id));
    if (!replacement) break;
    usedIn.add(replacement.actor.id);
    subs.push({ out: out.actor.id, in: replacement.actor.id });
  }
  return subs;
}

/** Pedido de tempo: sequencia adversaria, colapso ofensivo ou fim de jogo. */
export function shouldCallTimeout(snapshot: GameSnapshot, coach: Coach): boolean {
  if (snapshot.timeoutsLeft <= 0) return false;
  const diff = snapshot.scoreFor - snapshot.scoreAgainst;
  const panic = snapshot.opponentRun >= 8 && diff < 8;
  const endgame = snapshot.period >= 4 && snapshot.clock < 60 && Math.abs(diff) <= 5;
  const collapse = snapshot.ownOffensiveRating < 80 && snapshot.period >= 2;
  const willingness = coach.adaptability / 100;
  return (panic && willingness > 0.3) || endgame || (collapse && willingness > 0.55);
}

/** Decide quem deve ser cacado no matchup hunting. */
export function pickHuntTarget(opponents: Actor[]): string | undefined {
  const weakest = [...opponents]
    .filter((d) => d.onCourt)
    .sort((a, b) => {
      const sa = a.effective.perimeterDefense * 0.5 + a.effective.lateralQuickness * 0.3 + a.effective.defensiveIQ * 0.2;
      const sb = b.effective.perimeterDefense * 0.5 + b.effective.lateralQuickness * 0.3 + b.effective.defensiveIQ * 0.2;
      return sa - sb;
    })[0];
  return weakest?.id;
}

export function fullCoachDecision(
  team: Team,
  onCourt: Actor[],
  bench: Actor[],
  state: RotationState,
  snapshot: GameSnapshot,
  profile: AiProfile,
  t: Tuning,
): CoachDecision {
  const { changes, notes } = adaptGameplan(team, snapshot, profile);
  const substitutions = planSubstitutions(onCourt, bench, state, snapshot, team.coach, t);
  const timeout = shouldCallTimeout(snapshot, team.coach);
  return { gameplanChanges: changes, substitutions, timeout, notes };
}
