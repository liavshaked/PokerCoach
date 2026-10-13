import { Shield, UserRound } from 'lucide-react';
import type { Scenario } from '../../types/poker';
import { PlayingCard, Chip, bb } from './PlayingCard';

export function PokerTable({
  scenario,
  displayName,
  decided,
  preview = false,
}: {
  scenario: Scenario;
  displayName: string;
  decided: boolean;
  preview?: boolean;
}) {
  const opponentName = scenario.generated
    ? {
        balanced: 'Balanced regular',
        tight: 'Tight regular',
        aggressive: 'Aggressive regular',
        recreational: 'Recreational player',
      }[scenario.generated.profile]
    : 'The regular';
  const startingStacks =
    scenario.startingStacks.hero === scenario.startingStacks.opponent
      ? `${bb(scenario.startingStacks.hero)} starting stacks`
      : `${bb(scenario.startingStacks.hero)} / ${bb(scenario.startingStacks.opponent)} starting stacks`;
  return (
    <div
      className={`table-stage ${preview ? 'table-preview' : ''}`}
      aria-label="Heads-up poker table"
    >
      <div className="table-ambient" />
      <div className="poker-table">
        <div className="table-rail">
          <div className="table-felt">
            <div className="table-stitch" />
            <div className="felt-watermark">
              FELTLAB<span>THE PRACTICE ROOM</span>
            </div>
          </div>
        </div>
      </div>
      <div className="seat opponent-seat">
        <div className="opponent-cards">
          <PlayingCard hidden small />
          <PlayingCard hidden small index={1} />
        </div>
        <div className="player-badge">
          <span className="player-avatar opponent-avatar">
            <Shield size={19} strokeWidth={1.6} />
          </span>
          <div>
            <strong>{opponentName}</strong>
            <span>
              {scenario.opponentPosition} <i /> {bb(scenario.stacks.opponent)}
            </span>
          </div>
        </div>
        <span className="opponent-action">
          <span className="tiny-dot" />
          {scenario.opponentAction.label}
        </span>
        {scenario.opponentPosition === 'BTN' && (
          <span className="dealer-button opponent-dealer" title="Button / small blind">
            D
          </span>
        )}
      </div>
      <div className="table-center">
        <div className="pot-label">
          <span>CURRENT POT</span>
          <strong>{bb(scenario.currentPot)}</strong>
        </div>
        <div className="community-cards" aria-label="Community cards">
          {scenario.board.map((card, index) => (
            <PlayingCard key={`${card.rank}-${card.suit}`} card={card} size="board" index={index} />
          ))}
          {Array.from({ length: 5 - scenario.board.length }, (_, i) => (
            <div className="card-placeholder" key={i} aria-label="Undealt community card">
              <span>♠</span>
            </div>
          ))}
        </div>
        <div className="pot-chips">
          <Chip stack={3} />
          <Chip color="gold" stack={2} />
          <Chip color="slate" stack={4} />
          <span>{bb(scenario.currentPot)}</span>
        </div>
      </div>
      <div className="table-street">
        <span className="tiny-dot" />
        {scenario.street} <span>·</span> {scenario.blinds.small} / {scenario.blinds.big} BB
      </div>
      <div className="seat hero-seat">
        <div className="hero-cards">
          {scenario.heroCards.map((card, index) => (
            <PlayingCard
              key={`${card.rank}-${card.suit}`}
              card={card}
              size="hero"
              index={index + 2}
            />
          ))}
        </div>
        <div className={`player-badge hero-badge ${!decided && !preview ? 'your-turn' : ''}`}>
          <span className="player-avatar hero-avatar">
            <UserRound size={19} strokeWidth={1.6} />
          </span>
          <div>
            <strong>
              <span className="player-name" title={displayName || 'You'}>
                {displayName || 'You'}
              </span>
              <span className="you-label">YOU</span>
            </strong>
            <span>
              {scenario.heroPosition} <i /> {bb(scenario.stacks.hero)}
            </span>
          </div>
        </div>
        {scenario.heroPosition === 'BTN' && (
          <span className="dealer-button hero-dealer" title="Button / small blind">
            D
          </span>
        )}
      </div>
      <span className="table-note">
        {startingStacks} · {scenario.generated ? 'Range-based exercise' : 'Curated opponent'}
      </span>
    </div>
  );
}
