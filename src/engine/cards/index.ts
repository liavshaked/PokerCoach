import type { Card, Rank, Suit } from '../../types/poker';
export const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const suits: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
export const cardKey = (card: Card): string => `${card.rank}${card.suit[0]}`;
export function isCard(value: unknown): value is Card {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rank' in value &&
    'suit' in value &&
    ranks.includes(value.rank as Rank) &&
    suits.includes(value.suit as Suit)
  );
}
export function assertCards(cards: readonly Card[], min = 0, max = 52): void {
  if (!Array.isArray(cards) || cards.length < min || cards.length > max || !cards.every(isCard))
    throw new Error('Invalid card format or card count.');
  if (new Set(cards.map(cardKey)).size !== cards.length) throw new Error('Duplicate cards.');
}
export function createDeck(excluded: readonly Card[] = []): Card[] {
  assertCards(excluded);
  const dead = new Set(excluded.map(cardKey));
  return ranks
    .flatMap((rank) => suits.map((suit) => ({ rank, suit })))
    .filter((card) => !dead.has(cardKey(card)));
}
export const displayCard = (card: Card): string =>
  `${card.rank}${{ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[card.suit]}`;
export const displayCards = (cards: readonly Card[]): string => cards.map(displayCard).join(' ');
