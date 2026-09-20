/**
 * RNG deterministico (mulberry32 + hash de string) para que partidas,
 * temporadas e testes sejam reproduziveis a partir de uma seed.
 */

export class Rng {
  private state: number;

  constructor(seed: number | string = 1) {
    this.state = typeof seed === 'string' ? Rng.hash(seed) : seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  static hash(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** float em [0,1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(loInclusive: number, hiExclusive: number): number {
    return Math.floor(this.range(loInclusive, hiExclusive));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Normal padrao via Box-Muller. */
  normal(mean = 0, stdDev = 1): number {
    const u1 = Math.max(1e-9, this.next());
    const u2 = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Escolha ponderada. Pesos negativos sao tratados como 0. */
  weighted<T>(entries: readonly { item: T; weight: number }[]): T | undefined {
    let total = 0;
    for (const e of entries) total += Math.max(0, e.weight);
    if (total <= 0) return entries.length ? entries[0].item : undefined;
    let r = this.next() * total;
    for (const e of entries) {
      r -= Math.max(0, e.weight);
      if (r <= 0) return e.item;
    }
    return entries[entries.length - 1].item;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  fork(tag: string): Rng {
    return new Rng((this.state ^ Rng.hash(tag)) >>> 0);
  }

  getState(): number {
    return this.state;
  }

  setState(s: number): void {
    this.state = s >>> 0;
  }
}
