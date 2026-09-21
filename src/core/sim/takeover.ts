/**
 * TAKEOVER (secao 27).
 *
 * Cinco disciplinas independentes, cada uma com seu proprio medidor e estado:
 * FROZEN -> COLD -> NEUTRAL -> WARM -> HOT -> TAKEOVER.
 * Um jogador pode estar HOT em defesa e FROZEN em arremesso ao mesmo tempo.
 */
import { clamp01 } from '../math/util.js';
import { Actor, TakeoverMeters, addCue } from './actor.js';
import { Tuning } from '../config/tuning.js';

export type TakeoverCategory = keyof TakeoverMeters;
export const TAKEOVER_CATEGORIES: TakeoverCategory[] = ['shooting', 'finishing', 'playmaking', 'defense', 'rebounding'];

export type TakeoverState = 'frozen' | 'cold' | 'neutral' | 'warm' | 'hot' | 'takeover';

export const TAKEOVER_LABELS: Record<TakeoverCategory, string> = {
  shooting: 'Arremesso',
  finishing: 'Finalizacao',
  playmaking: 'Criacao',
  defense: 'Defesa',
  rebounding: 'Rebote',
};

/** Especializacoes concedidas quando o takeover dispara. */
export type TakeoverSpecialty =
  | 'off_dribble_specialist' | 'set_shooter' | 'deep_shooter'
  | 'inside_finisher' | 'advanced_layup' | 'dunk_specialist' | 'post_scorer'
  | 'blow_by_creator' | 'ankle_breaker' | 'passing_specialist'
  | 'lockdown' | 'steal_specialist' | 'rim_protector'
  | 'screen_specialist' | 'boxout_specialist' | 'putback_specialist' | 'rebound_prediction'
  | 'energy_keeper';

export const SPECIALTY_LABELS: Record<TakeoverSpecialty, string> = {
  off_dribble_specialist: 'Especialista em arremesso apos drible',
  set_shooter: 'Arremessador de pe',
  deep_shooter: 'Atirador de longe',
  inside_finisher: 'Finalizador interior',
  advanced_layup: 'Bandejas avancadas',
  dunk_specialist: 'Especialista em enterradas',
  post_scorer: 'Pontuador de poste',
  blow_by_creator: 'Criador de arrancada',
  ankle_breaker: 'Quebrador de tornozelos',
  passing_specialist: 'Especialista em passes',
  lockdown: 'Travador',
  steal_specialist: 'Especialista em roubos',
  rim_protector: 'Protetor de aro',
  screen_specialist: 'Especialista em bloqueios',
  boxout_specialist: 'Especialista em boxout',
  putback_specialist: 'Especialista em putback',
  rebound_prediction: 'Leitura de rebote',
  energy_keeper: 'Preservacao de energia',
};

export const SPECIALTIES_BY_CATEGORY: Record<TakeoverCategory, TakeoverSpecialty[]> = {
  shooting: ['off_dribble_specialist', 'set_shooter', 'deep_shooter'],
  finishing: ['inside_finisher', 'advanced_layup', 'dunk_specialist', 'post_scorer'],
  playmaking: ['blow_by_creator', 'ankle_breaker', 'passing_specialist'],
  defense: ['lockdown', 'steal_specialist', 'rim_protector'],
  rebounding: ['screen_specialist', 'boxout_specialist', 'putback_specialist', 'rebound_prediction'],
};

export function takeoverState(value: number, t: Tuning): TakeoverState {
  const T = t.takeover;
  if (value >= T.takeoverAt) return 'takeover';
  if (value > T.hotAbove) return 'hot';
  if (value > T.warmAbove) return 'warm';
  if (value < T.frozenBelow) return 'frozen';
  if (value < T.coldBelow) return 'cold';
  return 'neutral';
}

export type TakeoverEvent =
  | 'made2' | 'made3' | 'dunk' | 'assist' | 'rebound' | 'steal' | 'block' | 'stop'
  | 'miss' | 'turnover' | 'scored_on';

const EVENT_TO_CATEGORY: Record<TakeoverEvent, TakeoverCategory[]> = {
  made2: ['shooting'],
  made3: ['shooting'],
  dunk: ['finishing'],
  assist: ['playmaking'],
  rebound: ['rebounding'],
  steal: ['defense'],
  block: ['defense'],
  stop: ['defense'],
  miss: ['shooting'],
  turnover: ['playmaking'],
  scored_on: ['defense'],
};

export function applyTakeoverEvent(a: Actor, event: TakeoverEvent, t: Tuning): void {
  const T = t.takeover;
  const gains: Record<TakeoverEvent, number> = {
    made2: T.gainMade2, made3: T.gainMade3, dunk: T.gainDunk, assist: T.gainAssist,
    rebound: T.gainRebound, steal: T.gainSteal, block: T.gainBlock, stop: T.gainStop,
    miss: -T.lossMiss, turnover: -T.lossTurnover, scored_on: -T.lossScoredOn,
  };
  const delta = gains[event];
  for (const cat of EVENT_TO_CATEGORY[event]) {
    const before = a.takeover[cat];
    a.takeover[cat] = clamp01(before + delta);
    if (before < T.takeoverAt && a.takeover[cat] >= T.takeoverAt && !a.activeTakeover) {
      activateTakeover(a, cat, t);
    }
  }
}

export function activateTakeover(a: Actor, cat: TakeoverCategory, t: Tuning): void {
  a.activeTakeover = cat;
  a.takeoverEnergy = 1;
  addCue(a, `takeover_${cat}`);
}

export function stepTakeover(a: Actor, dt: number, t: Tuning): void {
  const T = t.takeover;
  if (a.activeTakeover) {
    a.takeoverEnergy = clamp01(a.takeoverEnergy - T.activeDrainPerSec * dt);
    if (a.takeoverEnergy <= 0) {
      a.takeover[a.activeTakeover] = 0.35;
      a.activeTakeover = undefined;
      addCue(a, 'takeover_end');
    }
    return;
  }
  for (const cat of TAKEOVER_CATEGORIES) {
    a.takeover[cat] = clamp01(a.takeover[cat] - T.decayPerSec * dt);
  }
}

/** Especialidade escolhida a partir do perfil do atleta. */
export function specialtyFor(a: Actor, cat: TakeoverCategory): TakeoverSpecialty {
  const at = a.profile.attributes;
  switch (cat) {
    case 'shooting':
      if (at.threePoint >= 88 && a.profile.tendencies.shootDeepThree > 30) return 'deep_shooter';
      return a.profile.tendencies.pullup > a.profile.tendencies.catchAndShoot ? 'off_dribble_specialist' : 'set_shooter';
    case 'finishing':
      if (at.drivingDunk >= 85) return 'dunk_specialist';
      if (at.postControl >= 78) return 'post_scorer';
      return at.drivingLayup >= 82 ? 'advanced_layup' : 'inside_finisher';
    case 'playmaking':
      if (at.passAccuracy >= 85) return 'passing_specialist';
      return at.ballHandle >= 85 ? 'ankle_breaker' : 'blow_by_creator';
    case 'defense':
      if (at.block >= 82) return 'rim_protector';
      return at.steal >= 80 ? 'steal_specialist' : 'lockdown';
    case 'rebounding':
      if (at.offensiveRebound >= 82) return 'putback_specialist';
      if (at.strength >= 84) return 'boxout_specialist';
      return at.defensiveIQ >= 80 ? 'rebound_prediction' : 'screen_specialist';
  }
}

/** Resumo para o HUD. */
export function takeoverSummary(a: Actor, t: Tuning): { cat: TakeoverCategory; value: number; state: TakeoverState }[] {
  return TAKEOVER_CATEGORIES.map((cat) => ({ cat, value: a.takeover[cat], state: takeoverState(a.takeover[cat], t) }));
}
