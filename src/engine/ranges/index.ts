import type { Card, OpponentProfileId, WeightedCombo } from '../../types/poker';
import { createDeck, ranks } from '../cards';
import { removeBlockedCombos } from '../equity';
export interface OpponentProfile {
  id: OpponentProfileId;
  label: string;
  description: string;
  openFloor: number;
  threeBetFloor: number;
  bluffMultiplier: number;
}
/** Authored model parameters, not measured population frequencies or GTO data. */
export const opponentProfiles: OpponentProfile[] = [
  {
    id: 'balanced',
    label: 'Baseline model',
    description:
      'Broad heads-up ranges; river polar weights follow the current betting price. Educational, not solved equilibrium.',
    openFloor: 17,
    threeBetFloor: 31,
    bluffMultiplier: 1,
  },
  {
    id: 'tight',
    label: 'Tight',
    description: 'Narrower preflop ranges and one third of the baseline river bluff weight.',
    openFloor: 24,
    threeBetFloor: 37,
    bluffMultiplier: 1 / 3,
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Wider preflop pressure and 1.7 times the baseline river bluff weight.',
    openFloor: 14,
    threeBetFloor: 27,
    bluffMultiplier: 1.7,
  },
  {
    id: 'recreational',
    label: 'Recreational',
    description: 'A broad, less selective range; river bets include medium-strength hands.',
    openFloor: 13,
    threeBetFloor: 25,
    bluffMultiplier: 0.7,
  },
];
export function getOpponentProfile(id: OpponentProfileId): OpponentProfile {
  const profile = opponentProfiles.find((item) => item.id === id);
  if (!profile) throw new Error(`Unsupported opponent profile: ${String(id)}.`);
  return profile;
}
/** A transparent ordinal hand-structure score. This is NOT preflop equity,
 * a solved range chart, or a measured profitability threshold. */
export function preflopStrength(cards: readonly Card[]): number {
  if (cards.length !== 2) throw new Error('Two cards required.');
  const values = cards.map((card) => ranks.indexOf(card.rank) + 2).sort((a, b) => b - a);
  const [high, low] = values;
  if (high === low) return 20 + high * 3;
  const gap = high - low - 1;
  return (
    high * 2 +
    low +
    (cards[0].suit === cards[1].suit ? 4 : 0) +
    Math.max(0, 3 - gap * 2) -
    (gap >= 4 ? 3 : 0)
  );
}
const rangeCache = new Map<string, WeightedCombo[]>();
/** Explicit 100 BB heads-up authored range. Weights describe our model only.
 * They are smooth membership weights, never prescribed action frequencies. */
export function modeledPreflopRange(
  profileId: OpponentProfileId,
  context: 'open' | 'three-bet',
  deadCards: readonly Card[] = [],
): WeightedCombo[] {
  const key = `${profileId}:${context}`;
  let range = rangeCache.get(key);
  if (!range) {
    const profile = getOpponentProfile(profileId),
      deck = createDeck();
    const floor = context === 'open' ? profile.openFloor : profile.threeBetFloor;
    range = [];
    for (let i = 0; i < deck.length; i++)
      for (let j = i + 1; j < deck.length; j++) {
        const cards: [Card, Card] = [deck[i], deck[j]],
          score = preflopStrength(cards);
        if (score >= floor) range.push({ cards, weight: Math.min(1, 0.2 + (score - floor) / 15) });
      }
    rangeCache.set(key, range);
  }
  return removeBlockedCombos(range, deadCards);
}
export function weightedHandPercentile(
  hero: readonly Card[],
  range: readonly WeightedCombo[],
): { percentile: number; meanStrength: number } {
  const own = preflopStrength(hero);
  let below = 0,
    total = 0,
    sum = 0;
  for (const combo of range) {
    const value = preflopStrength(combo.cards);
    total += combo.weight;
    sum += value * combo.weight;
    below += combo.weight * (value < own ? 1 : value === own ? 0.5 : 0);
  }
  if (total <= 0) throw new Error('Cannot compare against an empty range.');
  return { percentile: below / total, meanStrength: sum / total };
}
