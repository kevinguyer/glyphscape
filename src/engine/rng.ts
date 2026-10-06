/** Deterministic RNG (mulberry32). Every scene draws from one of these so a seed recalls a look. */
export interface Rng {
  (): number;
  seed: number;
  range(min: number, max: number): number;
  int(min: number, maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  gauss(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9;
  const next = (() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.seed = seed;
  next.range = (min, max) => min + (max - min) * next();
  next.int = (min, max) => min + Math.floor(next() * (max - min));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  next.gauss = () => {
    const u = Math.max(1e-9, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return next;
}

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 99999);
}

/** Integer hash to [0,1). Stateless, for per-cell variation. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
