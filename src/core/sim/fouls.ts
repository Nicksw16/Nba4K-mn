/**
 * FALTAS.
 *
 * Falta nao e sorteio puro: nasce de um contato classificado como ilegal
 * (defensor em movimento lateral tardio, braco no corpo, carga ofensiva) e e
 * modulada por disciplina, QI defensivo e tolerancia do gameplan.
 */
import { clamp01, attr01, lerp } from '../math/util.js';
import { Actor, bv } from './actor.js';
import { Tuning } from '../config/tuning.js';
import { Rng } from '../math/rng.js';
import { ContactEvent } from './contact.js';
import { dot2, norm2, sub2, len2 } from '../math/vec.js';

export type FoulKind =
  | 'shooting' | 'personal' | 'offensive_charge' | 'offensive_illegal_screen'
  | 'loose_ball' | 'reach_in' | 'blocking' | 'clear_path' | 'technical';

export interface FoulResult {
  kind: FoulKind;
  onId: string;
  byId: string;
  freeThrows: number;
  /** True se a posse muda (falta ofensiva). */
  turnover: boolean;
}

/**
 * Avalia se um contato vira falta.
 * Regra central: quem esta com o corpo em movimento lateral/para frente CONTRA
 * a linha do adversario e o responsavel. Defensor plantado com verticalidade
 * nao comete falta.
 */
export function judgeContact(
  ev: ContactEvent,
  t: Tuning,
  rng: Rng,
  ctx: { shooting: boolean; foulTolerance: number },
): FoulResult | null {
  const aggressor = ev.aggressorIsA ? ev.a : ev.b;
  const victim = ev.aggressorIsA ? ev.b : ev.a;
  if (ev.severity < 0.08) return null;

  // Contato mutuo (os dois chegaram junto) nao tem responsavel: nao se marca.
  if (ev.mutual && ev.severity < 0.5) return null;

  const aggressorSpeed = len2(aggressor.vel);
  const victimSpeed = len2(victim.vel);
  const aggressorPlanted = aggressor.grounded && aggressorSpeed < 1.1;
  const victimPlanted = victim.grounded && victimSpeed < 0.9;

  const discipline = attr01(aggressor.effective.discipline);
  const iq = attr01(aggressor.effective.defensiveIQ);
  const resist = bv(aggressor, 'def.foulResist');
  const verticality = bv(aggressor, 'def.verticality');

  // ---------------------------------------------------------------- ATAQUE
  // Quem carrega a bola e entra no defensor: ou e carga (defensor plantado e
  // posicionado), ou e contato normal de basquete. Nao existe "falta de
  // bloqueio" cometida por quem ataca.
  if (aggressor.hasBall) {
    if (victimPlanted && ev.frontality < 1.1) {
      const readSkill = attr01(victim.effective.defensiveIQ);
      const chargeChance = clamp01(t.fouls.chargeBase * (0.4 + ev.severity * 2.2) * (0.55 + readSkill * 0.9));
      if (rng.chance(chargeChance)) {
        return { kind: 'offensive_charge', onId: aggressor.id, byId: aggressor.id, freeThrows: 0, turnover: true };
      }
    }
    // Defensor em movimento levando contato do atacante: quase sempre nada.
    return null;
  }

  // Screen ilegal: bloqueador em movimento no momento do contato.
  if (ev.type === 'screen') {
    const screener = aggressor.state === 'screen' ? aggressor : victim.state === 'screen' ? victim : null;
    if (screener && len2(screener.vel) > 2.2 && rng.chance(clamp01(0.1 * ev.severity * 2))) {
      return { kind: 'offensive_illegal_screen', onId: screener.id, byId: screener.id, freeThrows: 0, turnover: true };
    }
  }

  // ---------------------------------------------------------------- DEFESA
  // Contato fora da bola so vira falta em situacoes severas.
  const offBall = !victim.hasBall && ev.type !== 'loose_ball' && ev.type !== 'boxout';
  if (offBall && ev.severity < 0.42) return null;

  let base = t.fouls.contactBase * (ev.severity * 2.6);
  if (aggressorPlanted) base *= 0.3 * (1 - clamp01(verticality) * 0.5);
  if (offBall) base *= 0.12;
  if (ev.type === 'boxout') base *= 0.2;
  // Disputa de rebote gera muito encontrao e pouquissima falta marcada.
  if (ev.type === 'loose_ball') base *= 0.22;
  // Contato sobre quem esta no ato do arremesso, ao contrario, e o caso
  // classico de falta: e a maior fatia dos lances livres em um jogo real.
  if (ctx.shooting) base *= 2.6;
  if (ev.type === 'landing') base *= 0.4;
  base *= lerp(1.5, 0.55, discipline * 0.6 + iq * 0.4);
  base *= 1 - clamp01(resist) * 0.4;
  base *= lerp(0.7, 1.3, clamp01(ctx.foulTolerance));

  if (!rng.chance(clamp01(base))) return null;

  const kind: FoulKind = ctx.shooting ? 'shooting'
    : ev.type === 'loose_ball' ? 'loose_ball'
    : ev.type === 'body_up' ? 'reach_in'
    : aggressorSpeed > 2.2 ? 'blocking' : 'personal';

  return { kind, onId: victim.id, byId: aggressor.id, freeThrows: 0, turnover: false };
}

/** Quantos lances livres a falta gera. */
export function freeThrowsFor(
  kind: FoulKind,
  shotValue: 2 | 3 | 0,
  made: boolean,
  teamFoulsThisPeriod: number,
  t: Tuning,
): number {
  if (kind === 'offensive_charge' || kind === 'offensive_illegal_screen') return 0;
  if (kind === 'shooting') {
    if (made) return 1;
    return shotValue === 3 ? 3 : 2;
  }
  if (kind === 'clear_path') return 2;
  if (kind === 'technical') return 1;
  return teamFoulsThisPeriod >= t.fouls.teamFoulBonus ? 2 : 0;
}

export function isFoulOut(a: Actor, t: Tuning): boolean {
  return a.fouls >= t.fouls.foulOutLimit;
}

/** Falta intencional para parar o relogio (fim de jogo). */
export function shouldFoulIntentionally(scoreDiff: number, secondsLeft: number, hasPossession: boolean): boolean {
  return !hasPossession && scoreDiff < 0 && scoreDiff >= -9 && secondsLeft < 35 && secondsLeft > 1.5;
}
