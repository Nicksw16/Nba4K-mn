/**
 * PERCEPCAO ESPACIAL (secao 28).
 *
 * Antes de decidir qualquer coisa, a IA constroi uma leitura da quadra:
 * quem esta livre, onde existem linhas de penetracao, onde a defesa esta
 * sobrecarregada, quais mismatches existem e quanta "gravidade" cada
 * arremessador exerce sobre o seu marcador.
 *
 * Nada aqui decide acao. Isto e so o que os olhos veem - o que separa
 * "IF PLAYER_OPEN -> PASS" de um jogador que entende espacamento.
 */
import { Vec2, add2, dist2, dot2, fromAngle, len2, mul2, norm2, rotate2, sub2, toAngle, v2, distToSegment } from '../math/vec.js';
import { attr01, clamp, clamp01, lerp } from '../math/util.js';
import { Actor } from '../sim/actor.js';
import { Tuning } from '../config/tuning.js';
import { COURT, Side, distToHoop, hoopGround, isInPaint, isThreePointShot, shotZone, clampToCourt } from '../config/court.js';
import { Attributes } from '../model/attributes.js';

export interface DriveLane {
  /** Direcao no mundo. */
  dir: Vec2;
  /** Espaco livre nessa direcao (m) ate o primeiro corpo. */
  clearance: number;
  /** Quao proximo essa direcao leva ao aro (0..1). */
  rimValue: number;
  /** Quem esta bloqueando (se houver). */
  blockerId?: string;
  /** Pontuacao final da linha. */
  score: number;
}

export interface PlayerRead {
  actor: Actor;
  /** Distancia ao defensor mais proximo. */
  nearestDefender: number;
  nearestDefenderId?: string;
  /** 0..1 - quao livre esta. */
  openness: number;
  /** Ameaca de arremesso a partir da posicao atual. */
  shotThreat: number;
  /** Gravidade: quanto esse jogador prende o defensor. */
  gravity: number;
  /** Distancia ate o aro alvo. */
  distToRim: number;
  /** Esta no canto? */
  inCorner: boolean;
  /** Esta cortando para o aro? */
  cutting: boolean;
}

export interface Mismatch {
  attackerId: string;
  defenderId: string;
  /** Vantagem de tamanho (m) e de velocidade (atributo). */
  sizeEdge: number;
  speedEdge: number;
  strengthEdge: number;
  /** Tipo de vantagem para a IA explorar. */
  kind: 'post' | 'speed' | 'strength' | 'shooting' | 'none';
  magnitude: number;
}

export interface CourtView {
  side: Side;
  /** Lado que o ataque ataca. */
  attackingSide: Side;
  ballHandler?: Actor;
  offense: Actor[];
  defense: Actor[];
  reads: Map<string, PlayerRead>;
  lanes: DriveLane[];
  mismatches: Mismatch[];
  /** Densidade defensiva no garrafao (0..1). */
  paintLoad: number;
  /** Quantos defensores estao do lado forte. */
  strongSideCount: number;
  weakSideCount: number;
  /** Qualidade media do espacamento do ataque. */
  spacing: number;
  /** Defensores fora de posicao (recuperando). */
  scrambling: string[];
}

const LANE_SAMPLES = 16;

export function buildCourtView(
  offense: Actor[],
  defense: Actor[],
  ballHandler: Actor | undefined,
  attackingSide: Side,
  t: Tuning,
): CourtView {
  const hoop = hoopGround(attackingSide);
  const reads = new Map<string, PlayerRead>();

  for (const a of offense) {
    if (!a.onCourt) continue;
    let nearest = 99;
    let nearestId: string | undefined;
    for (const d of defense) {
      if (!d.onCourt) continue;
      const dd = dist2(d.pos, a.pos);
      if (dd < nearest) {
        nearest = dd;
        nearestId = d.id;
      }
    }
    const distToRim = dist2(a.pos, hoop);
    const three = isThreePointShot(a.pos, attackingSide);
    const shotAttr = three ? a.effective.threePoint : distToRim < 4.2 ? a.effective.closeShot : a.effective.midRange;
    const shotThreat = clamp01(attr01(shotAttr) * clamp01(1 - (distToRim - 2) / 12) + (three ? 0.12 : 0));
    const openness = clamp01((nearest - 0.9) / 3.0);
    const inCorner = Math.min(a.pos.y, COURT.width - a.pos.y) < COURT.threeCornerY + 1.1 && three;
    const cutting = len2(a.vel) > 3.2 && dot2(norm2(a.vel), norm2(sub2(hoop, a.pos))) > 0.6;

    // Gravidade: atirador de elite no canto prende o defensor mesmo parado.
    const gravity = clamp01(
      attr01(shotAttr) * 0.55
      + (inCorner ? t.ai.cornerGravity * 0.35 : 0)
      + (cutting ? 0.25 : 0)
      + clamp01(a.heat) * 0.15,
    );

    reads.set(a.id, { actor: a, nearestDefender: nearest, nearestDefenderId: nearestId, openness, shotThreat, gravity, distToRim, inCorner, cutting });
  }

  const lanes = ballHandler ? computeDriveLanes(ballHandler, offense, defense, attackingSide, t) : [];

  // Carga do garrafao e lado forte/fraco.
  let paintLoad = 0;
  for (const d of defense) {
    if (d.onCourt && isInPaint(d.pos, attackingSide === 0 ? 0 : 1)) paintLoad += 1;
  }
  paintLoad = clamp01(paintLoad / 3.2);

  const ballY = ballHandler ? ballHandler.pos.y : COURT.width / 2;
  const strongSideCount = defense.filter((d) => d.onCourt && Math.sign(d.pos.y - COURT.width / 2) === Math.sign(ballY - COURT.width / 2) && Math.abs(ballY - COURT.width / 2) > 1).length;
  const weakSideCount = defense.filter((d) => d.onCourt).length - strongSideCount;

  const spacing = computeSpacing(offense.filter((a) => a.onCourt), t);
  const scrambling = defense.filter((d) => d.onCourt && (d.balance < 0.55 || d.state === 'stumble')).map((d) => d.id);
  const mismatches = findMismatches(offense, defense, t);

  return {
    side: attackingSide,
    attackingSide,
    ballHandler,
    offense,
    defense,
    reads,
    lanes,
    paintLoad,
    strongSideCount,
    weakSideCount,
    spacing,
    scrambling,
    mismatches,
  };
}

/** Amostra direcoes ao redor do portador e mede o espaco real de cada uma. */
export function computeDriveLanes(handler: Actor, offense: Actor[], defense: Actor[], side: Side, t: Tuning): DriveLane[] {
  const hoop = hoopGround(side);
  const toHoop = norm2(sub2(hoop, handler.pos));
  const lanes: DriveLane[] = [];

  for (let i = 0; i < LANE_SAMPLES; i++) {
    const angle = (i / LANE_SAMPLES) * Math.PI * 2;
    const dir = fromAngle(angle);
    // So interessa quem avanca em direcao a cesta (ou lateraliza para criar).
    const rimValue = clamp01((dot2(dir, toHoop) + 0.25) / 1.25);
    if (rimValue <= 0.02) continue;

    let clearance = 9;
    let blockerId: string | undefined;
    const bodies = [...defense, ...offense.filter((o) => o.id !== handler.id)];
    for (const b of bodies) {
      if (!b.onCourt) continue;
      const rel = sub2(b.pos, handler.pos);
      const along = dot2(rel, dir);
      if (along <= 0.2 || along > 9) continue;
      const perp = Math.abs(dot2(rel, v2(-dir.y, dir.x)));
      const corridor = b.physics.radius + 0.42;
      if (perp < corridor) {
        // Defensor em movimento de recuperacao fecha a linha mais tarde.
        const closing = dot2(b.vel, mul2(dir, -1));
        const effective = along + clamp(closing * 0.25, -0.6, 0.8);
        if (effective < clearance) {
          clearance = effective;
          blockerId = b.id;
        }
      }
    }
    // Paredes da quadra tambem limitam.
    const wall = distanceToSideline(handler.pos, dir);
    clearance = Math.min(clearance, wall);

    const score = clamp01(clearance / 5.5) * 0.62 + rimValue * 0.38;
    lanes.push({ dir, clearance, rimValue, blockerId, score });
  }
  return lanes.sort((a, b) => b.score - a.score);
}

function distanceToSideline(p: Vec2, dir: Vec2): number {
  let best = 12;
  if (dir.x > 1e-3) best = Math.min(best, (COURT.length - 0.4 - p.x) / dir.x);
  if (dir.x < -1e-3) best = Math.min(best, (p.x - 0.4) / -dir.x);
  if (dir.y > 1e-3) best = Math.min(best, (COURT.width - 0.4 - p.y) / dir.y);
  if (dir.y < -1e-3) best = Math.min(best, (p.y - 0.4) / -dir.y);
  return Math.max(0, best);
}

/** Espacamento: media das distancias entre companheiros, penalizando aglomeracao. */
export function computeSpacing(offense: Actor[], t: Tuning): number {
  if (offense.length < 2) return 1;
  let total = 0;
  let count = 0;
  for (let i = 0; i < offense.length; i++) {
    for (let j = i + 1; j < offense.length; j++) {
      const d = dist2(offense[i].pos, offense[j].pos);
      total += clamp01(d / t.ai.spacingTarget);
      count++;
    }
  }
  return count ? total / count : 1;
}

/** MATCHUP INTELLIGENCE (secao 34). */
export function findMismatches(offense: Actor[], defense: Actor[], t: Tuning): Mismatch[] {
  const out: Mismatch[] = [];
  for (const a of offense) {
    if (!a.onCourt) continue;
    const defId = a.markedById;
    const d = defense.find((x) => x.id === defId);
    if (!d) continue;
    const sizeEdge = a.profile.physique.height - d.profile.physique.height;
    const speedEdge = a.effective.speedWithBall - d.effective.lateralQuickness;
    const strengthEdge = a.effective.strength - d.effective.strength;
    const shootEdge = a.effective.threePoint - d.effective.perimeterDefense;

    let kind: Mismatch['kind'] = 'none';
    let magnitude = 0;
    if (sizeEdge > 0.1 && a.effective.postControl > 62 && strengthEdge > 4) {
      kind = 'post';
      magnitude = sizeEdge * 55 + strengthEdge * 0.35;
    } else if (speedEdge > t.ai.mismatchThreshold) {
      kind = 'speed';
      magnitude = speedEdge;
    } else if (strengthEdge > t.ai.mismatchThreshold && a.effective.drivingLayup > 70) {
      kind = 'strength';
      magnitude = strengthEdge;
    } else if (shootEdge > t.ai.mismatchThreshold + 4) {
      kind = 'shooting';
      magnitude = shootEdge;
    }
    if (kind !== 'none') {
      out.push({ attackerId: a.id, defenderId: d.id, sizeEdge, speedEdge, strengthEdge, kind, magnitude });
    }
  }
  return out.sort((x, y) => y.magnitude - x.magnitude);
}

/** Qualidade estimada de um arremesso daquela posicao, sem simular. */
export function shotQuality(view: CourtView, shooter: Actor, t: Tuning): number {
  const read = view.reads.get(shooter.id);
  if (!read) return 0;
  const zone = shotZone(shooter.pos, view.attackingSide);
  const three = zone.includes('three');
  const attr = three ? shooter.effective.threePoint : read.distToRim < 4.2 ? shooter.effective.closeShot : shooter.effective.midRange;
  const skill = attr01(attr);
  const openness = read.openness;
  const balance = shooter.balance;
  const moving = clamp01(1 - len2(shooter.vel) / 5);
  // Valor esperado por posse: o 3 vale 1.5x mais por tentativa.
  const valueWeight = three ? 1.18 : read.distToRim < 4.0 ? 1.12 : 0.9;
  const tendency = three ? shooter.profile.tendencies.shootThree / 100
    : read.distToRim < 4.0 ? shooter.profile.tendencies.shootRim / 100
    : shooter.profile.tendencies.shootMid / 100;
  return clamp01((skill * 0.42 + openness * 0.3 + balance * 0.12 + moving * 0.16) * valueWeight * (0.6 + tendency * 0.7));
}

/** Melhor linha de penetracao disponivel agora. */
export function bestLane(view: CourtView, minClearance = 1.8): DriveLane | undefined {
  return view.lanes.find((l) => l.clearance >= minClearance);
}

/** Posicao de spacing recomendada para um jogador sem bola. */
export function spacingSpot(view: CourtView, player: Actor, index: number, t: Tuning): Vec2 {
  const hoop = hoopGround(view.attackingSide);
  const handler = view.ballHandler;
  const ballPos = handler ? handler.pos : v2(COURT.length / 2, COURT.width / 2);
  const threeR = COURT.threeArcRadius + 0.7;
  const dirToHoop = view.attackingSide === 0 ? -1 : 1;

  // Cinco pontos classicos: dois cantos, duas asas, topo - ajustados pela bola.
  const spots: Vec2[] = [
    v2(hoop.x - dirToHoop * 1.4, COURT.threeCornerY - 0.35),
    v2(hoop.x - dirToHoop * 1.4, COURT.width - COURT.threeCornerY + 0.35),
    v2(hoop.x - dirToHoop * threeR * 0.72, COURT.width / 2 - threeR * 0.62),
    v2(hoop.x - dirToHoop * threeR * 0.72, COURT.width / 2 + threeR * 0.62),
    v2(hoop.x - dirToHoop * threeR, COURT.width / 2),
  ];

  // Pivos com pouco arremesso ficam no short roll / dunker spot em vez do canto.
  if (player.effective.threePoint < 58) {
    const dunker = v2(hoop.x - dirToHoop * 1.2, COURT.width / 2 + (index % 2 === 0 ? 2.6 : -2.6));
    return clampToCourt(dunker, 0.6);
  }

  const spot = spots[index % spots.length];
  // Afasta do portador para nao amontoar.
  const away = sub2(spot, ballPos);
  const adjusted = len2(away) < t.ai.spacingTarget * 0.65
    ? add2(spot, mul2(norm2(away), t.ai.spacingTarget * 0.5))
    : spot;
  return clampToCourt(adjusted, 0.6);
}

/** Linha de passe livre entre dois pontos? */
export function laneIsOpen(from: Vec2, to: Vec2, defenders: Actor[], radius: number): boolean {
  for (const d of defenders) {
    if (!d.onCourt) continue;
    if (distToSegment(d.pos, from, to) < radius) return false;
  }
  return true;
}
