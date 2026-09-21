/**
 * PLAYBOOK (secoes 30, 95).
 *
 * Cada jogada e uma funcao do tempo: dado o papel (0 = portador, 1..4) e a
 * fase da jogada, ela devolve para onde ir e o que fazer la. A IA nao "executa
 * animacao de jogada": ela recebe um destino e uma intencao, e o motor de
 * locomocao leva o corpo ate la com a fisica de sempre.
 *
 * Isso tambem alimenta o PLAY ART do HUD: as mesmas posicoes desenham as setas.
 */
import { Vec2, add2, mul2, norm2, sub2, v2 } from '../math/vec.js';
import { clamp01, lerp } from '../math/util.js';
import { COURT, Side, clampToCourt, hoopGround } from '../config/court.js';
import { Actor } from '../sim/actor.js';

export type PlayAction = 'spot' | 'screen' | 'cut' | 'roll' | 'pop' | 'handoff' | 'post' | 'clear' | 'relocate' | 'flare';

export interface RoleInstruction {
  target: Vec2;
  action: PlayAction;
  /** Prioridade de recepcao (0..1): quem e a primeira opcao nessa fase. */
  readPriority: number;
  /** Se acao = screen, quem recebe o bloqueio. */
  screenForRole?: number;
}

export interface PlayContext {
  side: Side;
  /** Papeis -> atores. */
  roles: Actor[];
  /** Fase 0..1 da jogada. */
  phase: number;
  /** Lado preferencial (-1 esquerda, +1 direita). */
  wing: -1 | 1;
}

export interface Play {
  id: string;
  name: string;
  type: 'pnr' | 'iso' | 'post' | 'motion' | 'horns' | 'transition' | 'dho' | 'off_ball';
  /** Duracao nominal (s). */
  duration: number;
  /** Descricao curta para o HUD. */
  description: string;
  /** Quais perfis a jogada pede em cada papel. */
  wants: ('handler' | 'shooter' | 'big' | 'wing' | 'any')[];
  instruction(role: number, ctx: PlayContext): RoleInstruction;
}

/** Converte coordenadas relativas ao aro atacado em coordenadas de mundo. */
function spot(ctx: PlayContext, depth: number, lateral: number): Vec2 {
  const hoop = hoopGround(ctx.side);
  const dir = ctx.side === 0 ? 1 : -1; // afastar da cesta
  return clampToCourt(v2(hoop.x + dir * depth, COURT.width / 2 + lateral), 0.6);
}

const THREE = COURT.threeArcRadius;

export const PLAYS: Play[] = [
  {
    id: 'spread_pnr',
    name: 'Pick & Roll Aberto',
    type: 'pnr',
    duration: 7,
    description: 'Bloqueio no topo com tres atiradores abertos. Le a cobertura e decide.',
    wants: ['handler', 'big', 'shooter', 'shooter', 'shooter'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) return { target: spot(ctx, THREE * 0.95, ctx.wing * 1.2), action: 'spot', readPriority: 1 };
      if (role === 1) {
        // Big: sobe para bloquear e depois rola ou abre.
        if (p < 0.35) return { target: spot(ctx, THREE * 0.88, ctx.wing * 2.4), action: 'screen', readPriority: 0.3, screenForRole: 0 };
        return { target: spot(ctx, 1.6, ctx.wing * 0.6), action: 'roll', readPriority: 0.75 };
      }
      if (role === 2) return { target: spot(ctx, 1.5, -ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.55 };
      if (role === 3) return { target: spot(ctx, THREE * 0.72, -ctx.wing * 4.6), action: 'spot', readPriority: 0.6 };
      return { target: spot(ctx, 1.5, ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.5 };
    },
  },
  {
    id: 'horns',
    name: 'Horns',
    type: 'horns',
    duration: 8,
    description: 'Dois grandes nos cotovelos: bloqueio duplo, handoff ou entrada no poste.',
    wants: ['handler', 'big', 'big', 'shooter', 'shooter'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) return { target: spot(ctx, THREE * 0.98, 0), action: 'spot', readPriority: 1 };
      if (role === 1) {
        if (p < 0.3) return { target: spot(ctx, 5.6, -2.4), action: 'screen', readPriority: 0.3, screenForRole: 0 };
        return { target: spot(ctx, 1.8, -1.2), action: 'roll', readPriority: 0.7 };
      }
      if (role === 2) {
        if (p < 0.3) return { target: spot(ctx, 5.6, 2.4), action: 'screen', readPriority: 0.25, screenForRole: 0 };
        return { target: spot(ctx, THREE * 0.9, 3.4), action: 'pop', readPriority: 0.6 };
      }
      if (role === 3) return { target: spot(ctx, 1.4, -(COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.55 };
      return { target: spot(ctx, 1.4, COURT.width / 2 - COURT.threeCornerY + 0.2), action: 'spot', readPriority: 0.55 };
    },
  },
  {
    id: 'side_pnr',
    name: 'Pick & Roll de Lado',
    type: 'pnr',
    duration: 7,
    description: 'Bloqueio na asa com canto cheio: ataca o lado curto da ajuda.',
    wants: ['handler', 'big', 'shooter', 'wing', 'shooter'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) return { target: spot(ctx, THREE * 0.8, ctx.wing * 5.2), action: 'spot', readPriority: 1 };
      if (role === 1) {
        if (p < 0.35) return { target: spot(ctx, THREE * 0.72, ctx.wing * 6.4), action: 'screen', readPriority: 0.3, screenForRole: 0 };
        return { target: spot(ctx, 1.9, ctx.wing * 1.4), action: 'roll', readPriority: 0.72 };
      }
      if (role === 2) return { target: spot(ctx, 1.4, ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.62 };
      if (role === 3) return { target: spot(ctx, THREE * 1.0, -ctx.wing * 1.6), action: 'spot', readPriority: 0.5 };
      return { target: spot(ctx, 1.4, -ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'flare', readPriority: 0.58 };
    },
  },
  {
    id: 'iso_top',
    name: 'Isolacao no Topo',
    type: 'iso',
    duration: 9,
    description: 'Esvazia o lado forte e deixa o criador atacar um contra um.',
    wants: ['handler', 'shooter', 'shooter', 'shooter', 'big'],
    instruction(role, ctx) {
      if (role === 0) return { target: spot(ctx, THREE * 0.95, ctx.wing * 1.0), action: 'spot', readPriority: 1 };
      if (role === 1) return { target: spot(ctx, 1.4, -(COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'clear', readPriority: 0.4 };
      if (role === 2) return { target: spot(ctx, 1.4, COURT.width / 2 - COURT.threeCornerY + 0.2), action: 'clear', readPriority: 0.4 };
      if (role === 3) return { target: spot(ctx, THREE * 0.78, -ctx.wing * 5.4), action: 'spot', readPriority: 0.45 };
      return { target: spot(ctx, THREE * 0.86, ctx.wing * 5.8), action: 'spot', readPriority: 0.35 };
    },
  },
  {
    id: 'post_split',
    name: 'Entrada de Poste com Corte',
    type: 'post',
    duration: 8,
    description: 'Entrada para o poste e corte por cima: pontua ou acha o cortador.',
    wants: ['handler', 'big', 'wing', 'shooter', 'shooter'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) {
        if (p < 0.4) return { target: spot(ctx, THREE * 0.85, ctx.wing * 4.2), action: 'spot', readPriority: 1 };
        return { target: spot(ctx, THREE * 0.72, ctx.wing * 2.0), action: 'cut', readPriority: 0.55 };
      }
      if (role === 1) return { target: spot(ctx, 3.1, ctx.wing * 2.1), action: 'post', readPriority: 0.9 };
      if (role === 2) return { target: spot(ctx, THREE * 0.95, -ctx.wing * 3.0), action: 'spot', readPriority: 0.5 };
      if (role === 3) return { target: spot(ctx, 1.4, -(COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.6 };
      return { target: spot(ctx, 1.4, COURT.width / 2 - COURT.threeCornerY + 0.2), action: 'spot', readPriority: 0.55 };
    },
  },
  {
    id: 'floppy',
    name: 'Floppy',
    type: 'off_ball',
    duration: 8,
    description: 'Atirador escolhe o lado por tras de bloqueios duplos.',
    wants: ['handler', 'shooter', 'big', 'big', 'wing'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) return { target: spot(ctx, THREE * 1.0, 0), action: 'spot', readPriority: 0.6 };
      if (role === 1) {
        if (p < 0.25) return { target: spot(ctx, 1.3, 0), action: 'cut', readPriority: 0.4 };
        return { target: spot(ctx, THREE * 0.8, ctx.wing * 5.6), action: 'relocate', readPriority: 1 };
      }
      if (role === 2) return { target: spot(ctx, 2.4, -3.0), action: 'screen', readPriority: 0.2, screenForRole: 1 };
      if (role === 3) return { target: spot(ctx, 2.4, 3.0), action: 'screen', readPriority: 0.2, screenForRole: 1 };
      return { target: spot(ctx, THREE * 0.75, -ctx.wing * 5.2), action: 'spot', readPriority: 0.5 };
    },
  },
  {
    id: 'dho_chain',
    name: 'Corrente de Handoff',
    type: 'dho',
    duration: 7,
    description: 'Entrega de mao em mao com o grande, criando vantagem em movimento.',
    wants: ['handler', 'big', 'shooter', 'shooter', 'wing'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) {
        if (p < 0.4) return { target: spot(ctx, THREE * 0.9, ctx.wing * 4.0), action: 'spot', readPriority: 0.7 };
        return { target: spot(ctx, THREE * 0.7, -ctx.wing * 1.2), action: 'cut', readPriority: 1 };
      }
      if (role === 1) return { target: spot(ctx, THREE * 0.78, ctx.wing * 1.4), action: 'handoff', readPriority: 0.5, screenForRole: 0 };
      if (role === 2) return { target: spot(ctx, 1.4, ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.6 };
      if (role === 3) return { target: spot(ctx, 1.4, -ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.6 };
      return { target: spot(ctx, THREE * 0.95, -ctx.wing * 4.6), action: 'spot', readPriority: 0.5 };
    },
  },
  {
    id: 'pindown',
    name: 'Pindown no Canto',
    type: 'off_ball',
    duration: 6,
    description: 'Bloqueio descendo para liberar o atirador saindo do canto.',
    wants: ['handler', 'shooter', 'big', 'wing', 'shooter'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) return { target: spot(ctx, THREE * 0.95, -ctx.wing * 2.0), action: 'spot', readPriority: 0.65 };
      if (role === 1) {
        if (p < 0.35) return { target: spot(ctx, 1.4, ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.4 };
        return { target: spot(ctx, THREE * 0.8, ctx.wing * 5.4), action: 'relocate', readPriority: 1 };
      }
      if (role === 2) return { target: spot(ctx, 4.0, ctx.wing * 4.6), action: 'screen', readPriority: 0.3, screenForRole: 1 };
      if (role === 3) return { target: spot(ctx, THREE * 0.86, -ctx.wing * 5.2), action: 'spot', readPriority: 0.5 };
      return { target: spot(ctx, 1.4, -ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.55 };
    },
  },
  {
    id: 'drag',
    name: 'Drag Screen de Transicao',
    type: 'transition',
    duration: 5,
    description: 'Bloqueio cedo em transicao antes da defesa se organizar.',
    wants: ['handler', 'big', 'shooter', 'shooter', 'wing'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) return { target: spot(ctx, THREE * 1.05, ctx.wing * 1.6), action: 'spot', readPriority: 1 };
      if (role === 1) {
        if (p < 0.4) return { target: spot(ctx, THREE * 1.0, ctx.wing * 3.2), action: 'screen', readPriority: 0.3, screenForRole: 0 };
        return { target: spot(ctx, 1.5, 0), action: 'roll', readPriority: 0.8 };
      }
      if (role === 2) return { target: spot(ctx, 1.4, -(COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'spot', readPriority: 0.65 };
      if (role === 3) return { target: spot(ctx, 1.4, COURT.width / 2 - COURT.threeCornerY + 0.2), action: 'spot', readPriority: 0.65 };
      return { target: spot(ctx, THREE * 0.85, -ctx.wing * 4.8), action: 'spot', readPriority: 0.5 };
    },
  },
  {
    id: 'hammer',
    name: 'Hammer',
    type: 'motion',
    duration: 7,
    description: 'Penetracao pela linha de fundo com bloqueio cego no canto oposto.',
    wants: ['handler', 'wing', 'shooter', 'big', 'shooter'],
    instruction(role, ctx) {
      const p = ctx.phase;
      if (role === 0) {
        if (p < 0.45) return { target: spot(ctx, THREE * 0.82, ctx.wing * 5.0), action: 'spot', readPriority: 1 };
        return { target: spot(ctx, 2.2, ctx.wing * 3.0), action: 'cut', readPriority: 1 };
      }
      if (role === 1) return { target: spot(ctx, 1.4, -ctx.wing * (COURT.width / 2 - COURT.threeCornerY + 0.2)), action: 'relocate', readPriority: 0.85 };
      if (role === 2) return { target: spot(ctx, 3.6, -ctx.wing * 4.4), action: 'screen', readPriority: 0.2, screenForRole: 1 };
      if (role === 3) return { target: spot(ctx, 2.0, -ctx.wing * 1.2), action: 'spot', readPriority: 0.45 };
      return { target: spot(ctx, THREE * 0.95, -ctx.wing * 1.0), action: 'spot', readPriority: 0.5 };
    },
  },
];

export const PLAY_BY_ID = new Map(PLAYS.map((p) => [p.id, p]));

/** Escolhe a jogada que melhor casa com o elenco em quadra e o gameplan. */
export function choosePlay(
  lineup: Actor[],
  focus: string,
  mismatchKind: string | undefined,
  transition: boolean,
  rng: { next(): number; weighted<T>(e: readonly { item: T; weight: number }[]): T | undefined },
): Play {
  if (transition) return PLAY_BY_ID.get('drag')!;
  const hasShooters = lineup.filter((a) => a.effective.threePoint > 74).length;
  const hasPost = lineup.some((a) => a.effective.postControl > 76);
  const hasRoller = lineup.some((a) => a.effective.standingDunk > 78 || a.effective.vertical > 82);
  const creator = lineup.some((a) => a.effective.ballHandle > 82);

  const entries = PLAYS.map((play) => {
    let w = 1;
    if (play.type === 'pnr') w *= hasRoller ? 2.1 : 1.1;
    if (play.type === 'post') w *= hasPost ? 2.4 : 0.25;
    if (play.type === 'iso') w *= creator ? 1.7 : 0.4;
    if (play.type === 'off_ball') w *= hasShooters >= 2 ? 1.8 : 0.6;
    if (play.type === 'dho') w *= hasShooters >= 2 ? 1.4 : 0.7;
    if (play.type === 'horns') w *= lineup.filter((a) => a.profile.position === 'C' || a.profile.position === 'PF').length >= 2 ? 1.6 : 0.6;
    if (play.type === 'transition') w *= 0.1;

    if (focus === 'inside' && (play.type === 'post' || play.type === 'pnr')) w *= 1.6;
    if (focus === 'perimeter' && (play.type === 'off_ball' || play.type === 'dho')) w *= 1.7;
    if (focus === 'iso' && play.type === 'iso') w *= 2.4;
    if (focus === 'pick_and_roll' && play.type === 'pnr') w *= 2.4;
    if (focus === 'post' && play.type === 'post') w *= 2.6;
    if (focus === 'movement' && (play.type === 'off_ball' || play.type === 'motion')) w *= 2.0;

    if (mismatchKind === 'post' && play.type === 'post') w *= 2.2;
    if (mismatchKind === 'speed' && play.type === 'iso') w *= 1.9;
    return { item: play, weight: Math.max(0.02, w) };
  });
  return rng.weighted(entries) ?? PLAYS[0];
}
