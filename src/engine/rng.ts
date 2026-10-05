/**
 * Seeded pseudo random number generator (sfc32). The whole state is four
 * 32-bit integers, so it can be copied into replay frames and restored
 * exactly, which keeps every run reproducible from its seed.
 */
export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32 expands one seed into four well mixed words.
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const state: RngState = [next(), next(), next(), next()];
  // Warm up so nearby seeds diverge quickly.
  for (let i = 0; i < 12; i++) nextFloat(state);
  return state;
}

/** Returns a float in [0, 1) and advances the state in place. */
export function nextFloat(st: RngState): number {
  let [a, b, c, d] = st;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  st[0] = a >>> 0; st[1] = b; st[2] = c; st[3] = d;
  return t / 4294967296;
}

export function randInt(st: RngState, min: number, maxInclusive: number): number {
  return min + Math.floor(nextFloat(st) * (maxInclusive - min + 1));
}

export function chance(st: RngState, p: number): boolean {
  return nextFloat(st) < p;
}

export function pick<T>(st: RngState, items: readonly T[]): T {
  return items[Math.floor(nextFloat(st) * items.length)];
}

/** Gaussian-ish value from the sum of three uniforms, mean 0, sd about 0.5. */
export function jitter(st: RngState): number {
  return (nextFloat(st) + nextFloat(st) + nextFloat(st)) - 1.5;
}

/** Stable hash for decorative per-tile variation (never touches run state). */
export function hash2(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
