/**
 * Vetores 2D/3D minimos, mutaveis onde importa para o loop de fisica.
 * Unidades do projeto: metros, segundos, quilogramas, radianos.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const clone2 = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });
export const clone3 = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const len2sq = (a: Vec2): number => a.x * a.x + a.y * a.y;

export function norm2(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function clampLen2(a: Vec2, max: number): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l <= max || l < 1e-9) return { x: a.x, y: a.y };
  const s = max / l;
  return { x: a.x * s, y: a.y * s };
}

export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2sq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export const flat = (a: Vec3): Vec2 => ({ x: a.x, y: a.y });

/** Angulo assinado (radianos) entre dois vetores 2D. */
export function angleBetween2(a: Vec2, b: Vec2): number {
  return Math.atan2(cross2(a, b), dot2(a, b));
}

/** Interpola angulos pelo caminho mais curto. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function angleDiff(a: number, b: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const fromAngle = (rad: number, len = 1): Vec2 => ({ x: Math.cos(rad) * len, y: Math.sin(rad) * len });
export const toAngle = (a: Vec2): number => Math.atan2(a.y, a.x);

/** Rotaciona um vetor 2D. */
export function rotate2(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Ponto mais proximo de `p` no segmento `a`-`b`. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub2(b, a);
  const l = len2sq(ab);
  if (l < 1e-9) return clone2(a);
  let t = dot2(sub2(p, a), ab) / l;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** Distancia perpendicular de `p` ao segmento `a`-`b`. Usado em linhas de passe. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist2(p, closestPointOnSegment(p, a, b));
}
