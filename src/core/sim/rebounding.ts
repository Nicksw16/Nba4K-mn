/**
 * REBOTE (secoes 23, 24).
 *
 * A disputa nao e um sorteio: a bola tem trajetoria e um ponto de queda
 * previsivel. Cada atleta calcula onde a bola vai cair (com erro proporcional
 * ao seu QI/atributo de rebote), corre ate la e disputa com posicao, boxout,
 * alcance e timing de salto. Quem chega melhor posicionado ganha na maioria
 * das vezes - e "na maioria" porque tip-outs existem.
 */
import { Vec2, Vec3, dist2, dot2, len2, mul2, norm2, sub2, v2 } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor, bv } from './actor.js';
import { badges } from './actor.js';
import { badgeValue } from '../model/badges.js';
import { Tuning } from '../config/tuning.js';
import { Rng } from '../math/rng.js';
import { Ball, predictCatchPoint } from './ball.js';
import { Side, hoopPos } from '../config/court.js';
import { maxReachHeight } from '../model/attributes.js';

export interface ReboundPrediction {
  /** Ponto estimado de queda. */
  spot: Vec2;
  /** Tempo ate ficar pegavel. */
  time: number;
  /** Altura no ponto de captura. */
  height: number;
  /** Erro de leitura do atleta (m). */
  error: number;
}

/**
 * Previsao individual: o mesmo rebote e "lido" de forma diferente por cada
 * atleta. Quem tem leitura de trajetoria erra pouco; quem nao tem persegue
 * o ponto errado por alguns decimos de segundo.
 */
export function predictRebound(a: Actor, ball: Ball, t: Tuning, rng: Rng): ReboundPrediction {
  const truth = predictCatchPoint(ball, 3.2, 2.6, t.sim.gravity, t.ball.drag);
  const read = clamp01(
    attr01(a.effective.defensiveRebound) * 0.3
    + attr01(a.effective.offensiveRebound) * 0.2
    + attr01(a.effective.defensiveIQ) * 0.2
    + clamp01(bv(a, 'reb.prediction')) * 0.3,
  );
  const error = lerp(1.5, 0.12, read);
  return {
    spot: v2(truth.pos.x + rng.normal(0, error), truth.pos.y + rng.normal(0, error)),
    time: truth.time,
    height: truth.height,
    error,
  };
}

export interface ReboundContender {
  actor: Actor;
  /** Distancia ate o ponto real de queda. */
  distance: number;
  /** Alcance vertical maximo. */
  reach: number;
  /** Qualidade do boxout aplicado (positivo = favorece). */
  boxout: number;
  score: number;
}

/**
 * Resolve a disputa quando a bola chega ao ponto de captura.
 * Retorna o vencedor e se foi apenas um toque (tip).
 */
export function contestRebound(
  candidates: Actor[],
  spot: Vec2,
  height: number,
  offensiveSide: Side,
  boxoutMap: Map<string, number>,
  t: Tuning,
  rng: Rng,
): { winner?: Actor; tip: boolean; contenders: ReboundContender[] } {
  const R = t.rebounding;
  const list: ReboundContender[] = [];

  for (const a of candidates) {
    if (!a.onCourt) continue;
    const distance = dist2(a.pos, spot);
    if (distance > 6.5) continue;
    const offensive = a.team !== offensiveSide;
    const attr = offensive ? a.effective.offensiveRebound : a.effective.defensiveRebound;
    const reach = maxReachHeight(
      a.profile.physique, a.effective.vertical,
      t.finishing.verticalAt99, t.finishing.verticalAt25,
      a.stamina, t.fatigue.verticalPenalty, a.adrenaline, t.adrenaline.depletedPenalty,
    );
    const boxout = boxoutMap.get(a.id) ?? 0;

    const positionScore = clamp01(1 - distance / 4.2);
    const attributeScore = attr01(attr);
    const reachScore = clamp01((reach - height) / 0.9);
    const badgeBonus = badgeValue(badges(a), offensive ? 'reb.offensive' : 'reb.defensive');
    const hustle = attr01(a.effective.hustle) * 0.12;

    // Vantagem estrutural da defesa: ela comeca a jogada entre o adversario e
    // a cesta. Sem esse termo, a taxa de rebote ofensivo fica muito acima da
    // realidade (36% contra os ~26% de uma liga profissional).
    const defensiveEdge = offensive ? 0 : 0.42;

    const score = clamp01(
      positionScore * R.positionWeight
      + attributeScore * R.attributeWeight
      + reachScore * R.reachWeight
      + boxout * R.boxoutWeight
      + badgeBonus
      + hustle
      + defensiveEdge
      - (1 - a.balance) * 0.18,
    );
    list.push({ actor: a, distance, reach, boxout, score });
  }

  if (!list.length) return { tip: false, contenders: [] };
  list.sort((x, y) => y.score - x.score);

  // Disputa apertada pode virar tip-out em vez de posse limpa.
  const top = list[0];
  const second = list[1];
  const contested = second && top.score - second.score < 0.09;
  if (contested && rng.chance(t.rebounding.tipChance + clamp01(badgeValue(badges(top.actor), 'reb.tip')))) {
    return { winner: top.actor, tip: true, contenders: list };
  }

  // Escolha ponderada pelos scores: o melhor posicionado normalmente ganha,
  // mas um score proximo mantem a disputa viva.
  const winner = rng.weighted(list.map((c) => ({ item: c.actor, weight: Math.pow(Math.max(0.01, c.score), 3.2) })));
  return { winner, tip: false, contenders: list };
}

/** Destino do tip: de volta para o aro ou para fora do trafego. */
export function tipTarget(a: Actor, spot: Vec2, side: Side, rng: Rng): Vec2 {
  const hoop = hoopPos(side);
  const toHoop = norm2(sub2(v2(hoop.x, hoop.y), spot));
  const putback = attr01(a.effective.offensiveRebound) > 0.6;
  if (putback) return v2(hoop.x, hoop.y);
  const away = mul2(toHoop, -1);
  return v2(spot.x + away.x * 3 + rng.normal(0, 1.2), spot.y + away.y * 3 + rng.normal(0, 1.5));
}

/** Rebotes longos sao mais comuns em arremessos de tres. */
export function expectedReboundDistance(shotDistance: number, made: boolean): number {
  if (made) return 0;
  return clamp(1.4 + (shotDistance - 4) * 0.28, 1.2, 6.5);
}
