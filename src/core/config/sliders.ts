/**
 * Sliders e dificuldade (secoes 83, 84, 85).
 *
 * Regra de design: a dificuldade NAO infla atributos da CPU. Ela muda
 * inteligencia, tempo de reacao, disciplina e agressividade da IA, alem de
 * assistencias concedidas ao jogador humano.
 */
import { DeepPartial, Tuning, cloneTuning, patchTuning } from './tuning.js';

export type Difficulty = 'rookie' | 'pro' | 'allstar' | 'superstar' | 'legend';

export interface AiProfile {
  /** Escala do tempo de reacao (1 = base; >1 mais lento). */
  reactionScale: number;
  /** Qualidade da leitura de spacing/help (0..1). */
  readQuality: number;
  /** Consistencia do timing de arremesso da CPU (0..1). */
  shotTimingSkill: number;
  /** Disciplina defensiva: reduz mordidas em fintas e faltas bobas. */
  discipline: number;
  /** Frequencia de ajustes de gameplan durante o jogo. */
  adaptivity: number;
  /** Agressividade em ajudar, dobrar e pressionar. */
  aggression: number;
}

export interface AssistProfile {
  /** Correcao de mira no passe (0 = nenhuma). */
  passAssist: number;
  /** Ampliacao da janela verde do humano. */
  shotWindowScale: number;
  /** Auto-posicionamento defensivo. */
  defensiveAssist: number;
  /** Deteccao automatica do melhor gather de finalizacao. */
  finishingAssist: number;
}

export interface Sliders {
  difficulty: Difficulty;
  gameSpeed: number;
  quarterLengthSeconds: number;
  /** Multiplicadores globais 0..2 (1 = padrao). */
  userShotSuccess: number;
  cpuShotSuccess: number;
  userContest: number;
  cpuContest: number;
  foulFrequency: number;
  stealFrequency: number;
  blockFrequency: number;
  fatigueRate: number;
  injuryFrequency: number;
  passSpeed: number;
  reboundParity: number;
  aiReaction: number;
  simulationMode: boolean;
  immersionMode: boolean;
}

export const DEFAULT_SLIDERS: Sliders = {
  difficulty: 'allstar',
  gameSpeed: 1,
  quarterLengthSeconds: 720,
  userShotSuccess: 1,
  cpuShotSuccess: 1,
  userContest: 1,
  cpuContest: 1,
  foulFrequency: 1,
  stealFrequency: 1,
  blockFrequency: 1,
  fatigueRate: 1,
  injuryFrequency: 1,
  passSpeed: 1,
  reboundParity: 1,
  aiReaction: 1,
  simulationMode: true,
  immersionMode: false,
};

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  rookie: { reactionScale: 1.9, readQuality: 0.32, shotTimingSkill: 0.35, discipline: 0.3, adaptivity: 0.15, aggression: 0.35 },
  pro: { reactionScale: 1.45, readQuality: 0.52, shotTimingSkill: 0.55, discipline: 0.5, adaptivity: 0.35, aggression: 0.5 },
  allstar: { reactionScale: 1.1, readQuality: 0.7, shotTimingSkill: 0.7, discipline: 0.68, adaptivity: 0.6, aggression: 0.66 },
  superstar: { reactionScale: 0.92, readQuality: 0.85, shotTimingSkill: 0.82, discipline: 0.82, adaptivity: 0.8, aggression: 0.8 },
  legend: { reactionScale: 0.8, readQuality: 0.96, shotTimingSkill: 0.92, discipline: 0.92, adaptivity: 0.95, aggression: 0.9 },
};

export const ASSIST_PROFILES: Record<Difficulty, AssistProfile> = {
  rookie: { passAssist: 0.95, shotWindowScale: 1.7, defensiveAssist: 0.8, finishingAssist: 1 },
  pro: { passAssist: 0.75, shotWindowScale: 1.3, defensiveAssist: 0.55, finishingAssist: 0.8 },
  allstar: { passAssist: 0.55, shotWindowScale: 1.05, defensiveAssist: 0.35, finishingAssist: 0.6 },
  superstar: { passAssist: 0.4, shotWindowScale: 0.92, defensiveAssist: 0.2, finishingAssist: 0.45 },
  legend: { passAssist: 0.25, shotWindowScale: 0.85, defensiveAssist: 0.1, finishingAssist: 0.3 },
};

/** Preset que empurra o jogo para posses longas e distribuicao de arremesso realista. */
export const SIMULATION_PATCH: DeepPartial<Tuning> = {
  ai: { shotQualityThreshold: 0.54, passWillingness: 0.66, clockPressureStart: 6 },
  fatigue: { sprintDrain: 0.014, recoverOnCourt: 0.0068 },
  fouls: { contactBase: 0.115 },
};

/** Preset arcade-ish: posses rapidas, mais transicao, menos faltas. */
export const ARCADE_PATCH: DeepPartial<Tuning> = {
  ai: { shotQualityThreshold: 0.4, passWillingness: 0.44, driveWillingness: 0.62 },
  fouls: { contactBase: 0.07 },
  fatigue: { sprintDrain: 0.009, recoverOnCourt: 0.0095 },
};

/** Converte sliders em um Tuning efetivo. */
export function applySliders(base: Tuning, s: Sliders): Tuning {
  let t = cloneTuning(base);
  if (s.simulationMode) t = patchTuning(t, SIMULATION_PATCH);
  else t = patchTuning(t, ARCADE_PATCH);

  t.game.periodSeconds = s.quarterLengthSeconds;
  t.sim.dt = base.sim.dt; // o passo fisico nunca muda com sliders
  t.defense.stealBase *= s.stealFrequency;
  t.defense.blockBase *= s.blockFrequency;
  t.defense.contestRange *= 0.5 + 0.5 * Math.max(s.userContest, s.cpuContest);
  t.fouls.contactBase *= s.foulFrequency;
  t.fouls.chargeBase *= s.foulFrequency;
  t.defense.stealFoulBase *= s.foulFrequency;
  t.defense.blockFoulBase *= s.foulFrequency;
  t.fatigue.sprintDrain *= s.fatigueRate;
  t.fatigue.moveDrain *= s.fatigueRate;
  t.fatigue.defenseDrain *= s.fatigueRate;
  t.fatigue.contactDrain *= s.fatigueRate;
  t.passing.speedChest *= s.passSpeed;
  t.passing.speedBounce *= s.passSpeed;
  t.passing.speedBullet *= s.passSpeed;
  t.passing.speedTouch *= s.passSpeed;

  const prof = AI_PROFILES[s.difficulty];
  t.defense.reactionAt99 *= prof.reactionScale * s.aiReaction;
  t.defense.reactionAt25 *= prof.reactionScale * s.aiReaction;
  return t;
}

export function aiProfile(s: Sliders): AiProfile {
  return AI_PROFILES[s.difficulty];
}

export function assistProfile(s: Sliders): AssistProfile {
  return ASSIST_PROFILES[s.difficulty];
}

/** Multiplicador de sucesso de arremesso por lado (user vs cpu). */
export function shotSuccessMultiplier(s: Sliders, isUserControlled: boolean): number {
  return isUserControlled ? s.userShotSuccess : s.cpuShotSuccess;
}
