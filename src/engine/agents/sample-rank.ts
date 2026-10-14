import type { Card } from '../../types/poker';

const descending = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const suitIndex = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
const encode = (category: number, kickers: number[]) => {
  let score = category;
  for (let index = 0; index < 5; index += 1) score = score * 15 + (kickers[index] ?? 0);
  return score;
};
function straightHigh(mask: number): number {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let high = 14; high >= 5; high -= 1)
    if ((mask & (31 << (high - 4))) === 31 << (high - 4)) return high;
  return 0;
}

/** Exact best-five standard Hold'em rank for valid 5–7-card simulations; larger wins.
 * The game still settles with pokersolver. Differential tests validate this hot-path helper.
 */
export function sampleHandRank(cards: readonly Card[]): number {
  const counts = new Uint8Array(15);
  const suitCounts = new Uint8Array(4);
  const suitMasks = new Uint16Array(4);
  let mask = 0;
  for (const card of cards) {
    const rank = '23456789TJQKA'.indexOf(card.rank) + 2;
    const suit = suitIndex[card.suit];
    counts[rank] += 1;
    suitCounts[suit] += 1;
    suitMasks[suit] |= 1 << rank;
    mask |= 1 << rank;
  }
  const flushSuit = suitCounts.findIndex((count) => count >= 5);
  if (flushSuit >= 0) {
    const straightFlush = straightHigh(suitMasks[flushSuit]);
    if (straightFlush) return encode(8, [straightFlush]);
  }
  const quads = descending.find((rank) => counts[rank] === 4);
  if (quads) return encode(7, [quads, descending.find((rank) => rank !== quads && counts[rank])!]);
  const trips = descending.filter((rank) => counts[rank] >= 3);
  const pairs = descending.filter((rank) => counts[rank] >= 2);
  if (trips.length && pairs.some((rank) => rank !== trips[0]))
    return encode(6, [trips[0], pairs.find((rank) => rank !== trips[0])!]);
  if (flushSuit >= 0)
    return encode(5, descending.filter((rank) => suitMasks[flushSuit] & (1 << rank)).slice(0, 5));
  const straight = straightHigh(mask);
  if (straight) return encode(4, [straight]);
  if (trips.length)
    return encode(3, [
      trips[0],
      ...descending.filter((rank) => rank !== trips[0] && counts[rank]).slice(0, 2),
    ]);
  if (pairs.length >= 2)
    return encode(2, [
      pairs[0],
      pairs[1],
      descending.find((rank) => rank !== pairs[0] && rank !== pairs[1] && counts[rank])!,
    ]);
  if (pairs.length)
    return encode(1, [
      pairs[0],
      ...descending.filter((rank) => rank !== pairs[0] && counts[rank]).slice(0, 3),
    ]);
  return encode(0, descending.filter((rank) => counts[rank]).slice(0, 5));
}
