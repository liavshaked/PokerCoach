import type { Card } from '../../types/poker';

const SUITS = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };

export type PlayingCardSize = 'board' | 'hero' | 'small';

export function PlayingCard({
  card,
  hidden = false,
  small = false,
  size,
  index = 0,
}: {
  card?: Card;
  hidden?: boolean;
  small?: boolean;
  size?: PlayingCardSize;
  index?: number;
}) {
  const cardSize = size ?? (small ? 'small' : 'board');
  if (hidden || !card)
    return (
      <div
        className={`playing-card card-back card-${cardSize}`}
        aria-label="Hidden opponent card"
        style={{ animationDelay: `${index * 55}ms` }}
      >
        <div className="card-back-pattern">
          <span>♠</span>
        </div>
      </div>
    );
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  const rank = card.rank === 'T' ? '10' : card.rank;
  return (
    <div
      className={`playing-card ${red ? 'card-red' : 'card-black'} card-${cardSize}`}
      aria-label={`${rank} of ${card.suit}`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div className="card-corner">
        <strong>{rank}</strong>
        <span>{SUITS[card.suit]}</span>
      </div>
      <span className="card-center-suit" aria-hidden="true">
        {SUITS[card.suit]}
      </span>
      <div className="card-corner card-corner-bottom" aria-hidden="true">
        <strong>{rank}</strong>
        <span>{SUITS[card.suit]}</span>
      </div>
    </div>
  );
}

export function Chip({
  color = 'mint',
  stack = 1,
}: {
  color?: 'mint' | 'gold' | 'slate';
  stack?: number;
}) {
  return (
    <span className={`chip-stack chip-${color}`} aria-hidden="true">
      {Array.from({ length: stack }, (_, i) => (
        <span key={i} className="poker-chip" style={{ bottom: i * 4 }}>
          <span />
        </span>
      ))}
    </span>
  );
}

export function bb(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} BB`;
}
