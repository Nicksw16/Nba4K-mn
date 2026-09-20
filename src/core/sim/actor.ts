/**
 * Ator de simulacao: o CORPO do atleta dentro da partida.
 *
 * Cada ator carrega estado continuo (posicao, velocidade, equilibrio, apoio dos
 * pes, fadiga, adrenalina) e nunca e teleportado. Toda mudanca de posicao passa
 * por integracao com aceleracao limitada (ver locomotion.ts).
 */
import { Vec2, v2 } from '../math/vec.js';
import { PlayerProfile } from '../model/player.js';
import { BadgeLoadout } from '../model/badges.js';
import { activeBadges } from '../model/player.js';
import { Attributes, centerOfMass, effectiveMass, standingReach } from '../model/attributes.js';
import { Tuning } from '../config/tuning.js';
import { attr01, clamp, clamp01 } from '../math/util.js';

export type LocomotionState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'shuffle'
  | 'backpedal'
  | 'jump'
  | 'land'
  | 'stumble'
  | 'gather'
  | 'posture_post'
  | 'boxout'
  | 'screen'
  | 'down';

export type ActionKind =
  | 'none'
  | 'dribble_move'
  | 'shot_windup'
  | 'shot_release'
  | 'pass'
  | 'gather'
  | 'layup'
  | 'dunk'
  | 'block_attempt'
  | 'steal_attempt'
  | 'screen'
  | 'boxout'
  | 'rebound_jump'
  | 'inbound'
  | 'free_throw';

export interface ActiveAction {
  kind: ActionKind;
  /** Tempo decorrido dentro da acao (s). */
  t: number;
  /** Duracao total prevista (s). */
  duration: number;
  /** Momento (s) em que a acao produz seu efeito (release, contato, etc.). */
  triggerAt: number;
  triggered: boolean;
  /** Dados livres por acao (id do move, alvo do passe, etc.). */
  data: Record<string, unknown>;
  /** Se true, o ator nao pode interromper esta acao. */
  committed: boolean;
}

export interface FootState {
  /** Posicao no chao de cada pe (m). Usado para foot planting e render. */
  left: Vec2;
  right: Vec2;
  /** Qual pe esta plantado agora. */
  planted: 'left' | 'right' | 'both' | 'none';
  /** Fase da passada 0..1. A planta ocorre perto de 0. */
  phase: number;
  /** Tempo desde a ultima planta (s). Cortes so sao eficientes logo apos a planta. */
  sincePlant: number;
  /** Comprimento da passada atual (m). */
  strideLength: number;
  /** Deslizamento acumulado: se subir, a animacao esta "patinando" (metrica de QA). */
  slip: number;
}

export interface TakeoverMeters {
  shooting: number;
  finishing: number;
  playmaking: number;
  defense: number;
  rebounding: number;
}

export interface Actor {
  id: string;
  profile: PlayerProfile;
  team: 0 | 1;
  /** Indice no lineup (0..4) enquanto em quadra. */
  slot: number;
  onCourt: boolean;

  pos: Vec2;
  vel: Vec2;
  /** Altura do quadril acima do chao em salto (m). 0 = no chao. */
  z: number;
  vz: number;
  grounded: boolean;

  /** Direcao do tronco/ombros (rad). Difere da direcao da velocidade. */
  heading: number;
  /** Direcao do quadril - base da postura defensiva e do body-up. */
  hipHeading: number;
  /** Para onde o atleta esta olhando (usado por no-look e leitura corporal). */
  gaze: number;

  state: LocomotionState;
  action: ActiveAction;

  /** 0..1. Abaixo de stumbleThreshold o atleta tropeca. */
  balance: number;
  stamina: number;
  adrenaline: number;

  /** Deslocamento de peso: para onde o corpo esta comprometido (base do ankle breaker). */
  weightShift: Vec2;

  hasBall: boolean;
  /** Tempo (s) com a posse da bola na mao. */
  ballTime: number;
  /** Mao que controla a bola no momento. */
  ballHand: 'left' | 'right';

  /** Contexto defensivo: quem este ator esta marcando. */
  assignmentId?: string;
  /** Marcado por (preenchido pela IA defensiva a cada frame). */
  markedById?: string;

  takeover: TakeoverMeters;
  activeTakeover?: keyof TakeoverMeters;
  takeoverEnergy: number;

  /** Anti-cheese: historico recente de moves. */
  recentMoves: { id: string; weight: number }[];

  /** Faltas e estatistica de carga. */
  fouls: number;
  secondsPlayed: number;
  /** Intensidade acumulada (para fadiga e lesao). */
  load: number;

  feet: FootState;

  /** Cache de atributos efetivos no frame (fadiga, takeover, adrenalina aplicados). */
  effective: Attributes;
  /** Cache de metricas fisicas. */
  physics: ActorPhysics;

  /** Micro-reacoes visuais pendentes (secao 103). */
  cues: { kind: string; t: number }[];

  /** Hot/cold por zona (secao 19). */
  heat: number;

  /** Sinergias de badge REACTION ativas. */
  reactionActive: Set<string>;
  reactionCounters: Record<string, number>;
  reactionExpiry: Record<string, number>;

  /** Se controlado pelo humano nesta partida. */
  userControlled: boolean;
}

export interface ActorPhysics {
  mass: number;
  reach: number;
  com: number;
  radius: number;
  topSpeed: number;
  accel: number;
  brake: number;
  turnRate: number;
  inertia: number;
}

export function createAction(): ActiveAction {
  return { kind: 'none', t: 0, duration: 0, triggerAt: 0, triggered: true, data: {}, committed: false };
}

export function createActor(profile: PlayerProfile, team: 0 | 1, slot: number, pos: Vec2, tuning: Tuning): Actor {
  const actor: Actor = {
    id: profile.id,
    profile,
    team,
    slot,
    onCourt: slot < 5,
    pos: v2(pos.x, pos.y),
    vel: v2(),
    z: 0,
    vz: 0,
    grounded: true,
    heading: team === 0 ? 0 : Math.PI,
    hipHeading: team === 0 ? 0 : Math.PI,
    gaze: team === 0 ? 0 : Math.PI,
    state: 'idle',
    action: createAction(),
    balance: 1,
    stamina: 1,
    adrenaline: tuning.adrenaline.max,
    weightShift: v2(),
    hasBall: false,
    ballTime: 0,
    ballHand: profile.physique.handedness,
    takeover: { shooting: 0, finishing: 0, playmaking: 0, defense: 0, rebounding: 0 },
    takeoverEnergy: 0,
    recentMoves: [],
    fouls: 0,
    secondsPlayed: 0,
    load: 0,
    feet: {
      left: v2(pos.x, pos.y - 0.16),
      right: v2(pos.x, pos.y + 0.16),
      planted: 'both',
      phase: 0,
      sincePlant: 0,
      strideLength: profile.physique.height * 0.55,
      slip: 0,
    },
    effective: { ...profile.attributes },
    physics: {
      mass: effectiveMass(profile.physique, profile.attributes.strength),
      reach: standingReach(profile.physique),
      com: centerOfMass(profile.physique),
      radius: 0.22 + profile.physique.shoulderWidth * 0.5,
      topSpeed: 0,
      accel: 0,
      brake: 0,
      turnRate: 0,
      inertia: 1,
    },
    cues: [],
    heat: 0,
    reactionActive: new Set(),
    reactionCounters: {},
    reactionExpiry: {},
    userControlled: false,
  };
  return actor;
}

export function badges(a: Actor): BadgeLoadout {
  return activeBadges(a.profile);
}

/** Atributo efetivo: base + takeover, degradado por fadiga onde faz sentido. */
export function effAttr(a: Actor, key: keyof Attributes): number {
  return a.effective[key];
}

/** Multiplicador 0..1 de energia: 1 = fresco. */
export function energy(a: Actor): number {
  return clamp01(a.stamina);
}

/** Estado publico de fadiga usado por HUD e IA. */
export function fatigueLevel(a: Actor): 'fresh' | 'winded' | 'tired' | 'gassed' {
  if (a.stamina > 0.75) return 'fresh';
  if (a.stamina > 0.5) return 'winded';
  if (a.stamina > 0.25) return 'tired';
  return 'gassed';
}

export function isStumbling(a: Actor, tuning: Tuning): boolean {
  return a.balance < tuning.locomotion.stumbleThreshold;
}

export function busy(a: Actor): boolean {
  return a.action.kind !== 'none' && a.action.t < a.action.duration;
}

export function committed(a: Actor): boolean {
  return busy(a) && a.action.committed;
}

export function startAction(a: Actor, kind: ActionKind, duration: number, triggerAt: number, data: Record<string, unknown> = {}, committedAction = true): void {
  a.action = { kind, t: 0, duration, triggerAt, triggered: false, data, committed: committedAction };
}

export function clearAction(a: Actor): void {
  a.action = createAction();
}

/** Registra um move para o sistema anti-cheese (secao 121). */
export function noteMove(a: Actor, id: string, tuning: Tuning): number {
  const entry = a.recentMoves.find((m) => m.id === id);
  const penalty = entry ? entry.weight * tuning.dribble.repetitionPenalty : 0;
  if (entry) entry.weight = Math.min(4, entry.weight + 1);
  else a.recentMoves.push({ id, weight: 1 });
  return penalty;
}

export function decayMoves(a: Actor, dt: number, tuning: Tuning): void {
  for (const m of a.recentMoves) m.weight = Math.max(0, m.weight - tuning.dribble.repetitionDecay * dt);
  a.recentMoves = a.recentMoves.filter((m) => m.weight > 0.01);
}

export function movePenalty(a: Actor, id: string, tuning: Tuning): number {
  const entry = a.recentMoves.find((m) => m.id === id);
  return entry ? clamp01(entry.weight * tuning.dribble.repetitionPenalty) : 0;
}

export function addCue(a: Actor, kind: string): void {
  a.cues.push({ kind, t: 0 });
  if (a.cues.length > 8) a.cues.shift();
}

/** Alcance maximo da mao neste instante, incluindo salto atual. */
export function currentReach(a: Actor): number {
  return a.physics.reach + a.z;
}

/** Fracao de explosividade disponivel (fadiga + adrenalina). */
export function explosiveness(a: Actor, tuning: Tuning): number {
  const fat = 1 - tuning.fatigue.verticalPenalty * (1 - a.stamina);
  const adr = 1 - tuning.adrenaline.depletedPenalty * (1 - clamp01(a.adrenaline / tuning.adrenaline.max));
  return clamp(fat * adr, 0.35, 1.15);
}

/** Peso corporal comprometido em uma direcao (0..1) - insumo do ankle breaker. */
export function commitment(a: Actor): number {
  return clamp01(Math.hypot(a.weightShift.x, a.weightShift.y));
}

export function attrBonusFromTakeover(a: Actor, cat: keyof TakeoverMeters, tuning: Tuning): number {
  return a.activeTakeover === cat ? tuning.takeover.boost : 0;
}

export function staminaDrainScale(a: Actor, tuning: Tuning): number {
  // Stamina alta reduz o dreno; a escala vem do tuning para ser ajustavel por slider.
  return 1 - attr01(a.effective.stamina) * tuning.fatigue.staminaScale;
}
