/**
 * Seeded PRNG (mulberry32). The sim must never call Math.random(); all randomness
 * goes through the state's `rng` so that runs are reproducible from inputs alone.
 */
export function nextRandom(state: { rng: number }): number {
  const a = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
