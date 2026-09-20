/** Utilitarios numericos compartilhados por todos os sistemas. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Remapeia `v` de [inMin,inMax] para [outMin,outMax] com clamp. */
export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (Math.abs(inMax - inMin) < 1e-9) return outMin;
  return clamp(outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin), Math.min(outMin, outMax), Math.max(outMin, outMax));
}

export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const smootherstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Curva logistica: base para quase toda probabilidade do jogo. */
export function logistic(x: number, midpoint = 0, steepness = 1): number {
  return 1 / (1 + Math.exp(-(x - midpoint) * steepness));
}

/**
 * Converte um atributo 25..99 para um multiplicador em torno de 1.0.
 * 75 e o ponto neutro (jogador de rotacao da liga).
 */
export function attrScale(attr: number, spread = 0.35, pivot = 75): number {
  return 1 + ((attr - pivot) / 25) * spread;
}

/** Atributo 25..99 -> 0..1 normalizado linear. */
export const attr01 = (attr: number): number => clamp01((attr - 25) / 74);

/** Aproximacao exponencial independente de framerate. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export const feetToM = (ft: number): number => ft * 0.3048;
export const inchesToM = (inches: number): number => inches * 0.0254;
export const mToFeetInches = (m: number): string => {
  const totalIn = Math.round(m / 0.0254);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
};
export const lbsToKg = (lbs: number): number => lbs * 0.45359237;
export const kgToLbs = (kg: number): number => kg / 0.45359237;

export function sum(values: number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  if (m === 0 && rem < 10) return rem.toFixed(1);
  return `${m}:${Math.floor(rem).toString().padStart(2, '0')}`;
}

export function pct(made: number, att: number, digits = 1): string {
  if (att === 0) return '-';
  return ((made / att) * 100).toFixed(digits);
}
