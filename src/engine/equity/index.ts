import solver, { type SolvedHand } from 'pokersolver';
const { Hand } = solver;
import type { Card, WeightedCombo } from '../../types/poker';
import { assertCards, cardKey, isCard } from '../cards';
export function evaluateHand(cards: readonly Card[]): SolvedHand {
  assertCards(cards, 5, 7);
  return Hand.solve(cards.map(cardKey), 'standard');
}
/** -1: first wins; 0: tie; +1: second wins. Includes best-five kickers. */
export function compareHands(first: readonly Card[], second: readonly Card[]): number {
  return evaluateHand(first).compare(evaluateHand(second));
}
export interface RiverEquity {
  equity: number;
  winProbability: number;
  tieProbability: number;
  lossProbability: number;
  totalWeight: number;
  combos: number;
  blockedCombos: number;
}
export function validateRange(range: unknown): range is WeightedCombo[] {
  if (!Array.isArray(range) || !range.length) return false;
  const seen = new Set<string>();
  return (
    range.every((combo) => {
      if (
        !combo ||
        !Array.isArray(combo.cards) ||
        combo.cards.length !== 2 ||
        !combo.cards.every(isCard) ||
        !Number.isFinite(combo.weight) ||
        combo.weight < 0
      )
        return false;
      const keys = combo.cards.map(cardKey).sort();
      const key = keys.join(':');
      if (keys[0] === keys[1] || seen.has(key)) return false;
      seen.add(key);
      return true;
    }) && range.some((combo) => combo.weight > 0)
  );
}
export function removeBlockedCombos(
  range: readonly WeightedCombo[],
  knownCards: readonly Card[],
): WeightedCombo[] {
  if (!validateRange(range))
    throw new Error(
      'Range requires unique two-card combinations and nonnegative finite weights with positive total mass.',
    );
  assertCards(knownCards);
  const dead = new Set(knownCards.map(cardKey));
  return range
    .filter((combo) => combo.weight > 0 && combo.cards.every((card) => !dead.has(cardKey(card))))
    .map((combo) => ({
      cards: [{ ...combo.cards[0] }, { ...combo.cards[1] }],
      weight: combo.weight,
    }));
}
/** Exact weighted showdown equity against the supplied finite river model,
 * after conditioning its weights on all known cards. Ties count half a pot. */
export function riverEquity(
  hero: readonly Card[],
  board: readonly Card[],
  range: readonly WeightedCombo[],
  deadCards: readonly Card[] = [],
): RiverEquity {
  assertCards(hero, 2, 2);
  assertCards(board, 5, 5);
  assertCards([...hero, ...board, ...deadCards]);
  const legal = removeBlockedCombos(range, [...hero, ...board, ...deadCards]);
  if (!legal.length) throw new Error('No unblocked positive-weight opponent combinations.');
  const heroHand = evaluateHand([...hero, ...board]);
  let wins = 0,
    ties = 0,
    losses = 0;
  for (const combo of legal) {
    const result = heroHand.compare(evaluateHand([...combo.cards, ...board]));
    if (result < 0) wins += combo.weight;
    else if (result === 0) ties += combo.weight;
    else losses += combo.weight;
  }
  const totalWeight = wins + ties + losses;
  return {
    equity: (wins + ties / 2) / totalWeight,
    winProbability: wins / totalWeight,
    tieProbability: ties / totalWeight,
    lossProbability: losses / totalWeight,
    totalWeight,
    combos: legal.length,
    blockedCombos: range.length - legal.length,
  };
}
