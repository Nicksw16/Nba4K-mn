/**
 * Geometria da quadra em metros. Origem no canto (0,0);
 * X = comprimento (baseline a baseline), Y = largura, Z = altura.
 *
 * Cesta de casa (time 0 ataca -> HOME_HOOP e a cesta que o time 1 defende).
 */
import { Vec2, Vec3, v2, v3 } from '../math/vec.js';
import { feetToM, inchesToM } from '../math/util.js';

export const COURT = {
  length: feetToM(94), // 28.651
  width: feetToM(50), // 15.24
  /** Distancia do centro do aro ate a linha de fundo. */
  hoopFromBaseline: feetToM(5.25),
  rimRadius: inchesToM(9),
  ballRadius: inchesToM(4.7),
  rimHeight: feetToM(10), // 3.048
  backboardWidth: feetToM(6),
  backboardHeight: feetToM(3.5),
  backboardBottom: feetToM(9),
  backboardFromBaseline: feetToM(4),
  threeArcRadius: feetToM(23.75),
  threeCornerY: feetToM(3), // distancia da linha lateral
  restrictedRadius: feetToM(4),
  paintWidth: feetToM(16),
  paintDepth: feetToM(19),
  freeThrowLineFromBaseline: feetToM(19),
  freeThrowCircleRadius: feetToM(6),
  centerCircleRadius: feetToM(6),
  midcourt: feetToM(47),
} as const;

export type Side = 0 | 1;

/** Centro do aro do lado informado. */
export function hoopPos(side: Side): Vec3 {
  return side === 0
    ? v3(COURT.hoopFromBaseline, COURT.width / 2, COURT.rimHeight)
    : v3(COURT.length - COURT.hoopFromBaseline, COURT.width / 2, COURT.rimHeight);
}

export function hoopGround(side: Side): Vec2 {
  const h = hoopPos(side);
  return v2(h.x, h.y);
}

/** Plano do vidro (x constante) e limites do tabuleiro. */
export function backboardPlaneX(side: Side): number {
  return side === 0 ? COURT.backboardFromBaseline : COURT.length - COURT.backboardFromBaseline;
}

/** Normal do tabuleiro apontando para dentro da quadra. */
export function backboardNormalX(side: Side): number {
  return side === 0 ? 1 : -1;
}

/** Distancia horizontal ate o aro que o lado `side` defende. */
export function distToHoop(p: Vec2, side: Side): number {
  const h = hoopGround(side);
  return Math.hypot(p.x - h.x, p.y - h.y);
}

/** True se o chute daquele ponto vale 3 pontos. */
export function isThreePointShot(p: Vec2, side: Side): boolean {
  const h = hoopGround(side);
  const cornerLimitY = COURT.threeCornerY;
  const inCornerBand = p.y <= cornerLimitY || p.y >= COURT.width - cornerLimitY;
  if (inCornerBand) {
    // Nos cantos a linha e reta (paralela a lateral) ate o ponto de quebra do arco.
    const breakX = h.x + Math.sqrt(Math.max(0, COURT.threeArcRadius ** 2 - (COURT.width / 2 - cornerLimitY) ** 2)) * (side === 0 ? 1 : -1);
    const beyondBreak = side === 0 ? p.x > breakX : p.x < breakX;
    if (!beyondBreak) return true;
  }
  return Math.hypot(p.x - h.x, p.y - h.y) >= COURT.threeArcRadius;
}

export function shotValue(p: Vec2, side: Side): 2 | 3 {
  return isThreePointShot(p, side) ? 3 : 2;
}

/** True se o ponto esta dentro do garrafao defendido por `side`. */
export function isInPaint(p: Vec2, side: Side): boolean {
  const halfW = COURT.paintWidth / 2;
  if (Math.abs(p.y - COURT.width / 2) > halfW) return false;
  return side === 0 ? p.x <= COURT.paintDepth : p.x >= COURT.length - COURT.paintDepth;
}

export function isInRestrictedArea(p: Vec2, side: Side): boolean {
  return distToHoop(p, side) <= COURT.restrictedRadius;
}

/** Mantem uma posicao dentro dos limites da quadra com uma margem. */
export function clampToCourt(p: Vec2, margin = 0.15): Vec2 {
  return v2(
    Math.max(margin, Math.min(COURT.length - margin, p.x)),
    Math.max(margin, Math.min(COURT.width - margin, p.y)),
  );
}

export function isOutOfBounds(p: Vec2, margin = 0): boolean {
  return p.x < -margin || p.x > COURT.length + margin || p.y < -margin || p.y > COURT.width + margin;
}

/** Posicao da linha de lance livre do lado `side`. */
export function freeThrowSpot(side: Side): Vec2 {
  return side === 0
    ? v2(COURT.freeThrowLineFromBaseline, COURT.width / 2)
    : v2(COURT.length - COURT.freeThrowLineFromBaseline, COURT.width / 2);
}

/** Sinal do eixo X na direcao do ataque contra `defSide`. */
export function attackDir(defSide: Side): number {
  return defSide === 0 ? -1 : 1;
}

/** Zonas usadas por shot chart, hot/cold e tendencias da IA. */
export type ShotZone =
  | 'rim'
  | 'paint'
  | 'short_mid'
  | 'long_mid'
  | 'corner_three'
  | 'wing_three'
  | 'top_three'
  | 'deep_three';

export function shotZone(p: Vec2, side: Side): ShotZone {
  const d = distToHoop(p, side);
  const three = isThreePointShot(p, side);
  if (three) {
    if (d > COURT.threeArcRadius + 1.7) return 'deep_three';
    const fromCenter = Math.abs(p.y - COURT.width / 2);
    if (fromCenter > COURT.width / 2 - COURT.threeCornerY - 0.9) return 'corner_three';
    return fromCenter > 2.6 ? 'wing_three' : 'top_three';
  }
  if (d <= COURT.restrictedRadius) return 'rim';
  if (isInPaint(p, side)) return 'paint';
  return d < 5.2 ? 'short_mid' : 'long_mid';
}

export const ZONE_LABELS: Record<ShotZone, string> = {
  rim: 'Aro',
  paint: 'Garrafao',
  short_mid: 'Meia-distancia curta',
  long_mid: 'Meia-distancia longa',
  corner_three: '3PT canto',
  wing_three: '3PT asa',
  top_three: '3PT frontal',
  deep_three: '3PT profundo',
};
