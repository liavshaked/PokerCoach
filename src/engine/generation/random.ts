/** Stable, local PRNG. The same string seed always reconstructs the same drill. */
export function seededRandom(seed: string): () => number {
  if (typeof seed !== 'string' || !seed.trim() || seed.length > 256)
    throw new Error('Seed must be a nonempty string of at most 256 characters.');
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick<T>(items: readonly T[], random: () => number): T {
  if (!items.length) throw new Error('Cannot sample an empty collection.');
  return items[Math.floor(random() * items.length)];
}
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
