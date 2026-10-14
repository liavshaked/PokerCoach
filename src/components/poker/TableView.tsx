import { motion } from 'motion/react';
import { Crown, Shield, UserRound } from 'lucide-react';
import type { Card } from '../../types/poker';
import { PlayingCard, Chip } from './PlayingCard';

export interface SeatView {
  seat: number;
  name: string;
  stack: number;
  bet: number;
  position: string;
  cards?: Card[];
  folded: boolean;
  allIn: boolean;
  action?: string;
  profile?: string;
  winner?: boolean;
}
export interface TableViewState {
  id: string;
  street: string;
  pot: number;
  board: Card[];
  seats: SeatView[];
  heroSeat: number;
  dealer: number;
  actingSeat: number | null;
  completed: boolean;
}
export const chips = (value: number) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);

/** Seats occupy named grid areas: shared geometry, with distinct compact phone rows. */
export function TableView({
  state,
  highlightSeat,
  replay = false,
}: {
  state: TableViewState;
  highlightSeat?: number;
  replay?: boolean;
}) {
  const order = [...state.seats].sort(
    (a, b) =>
      ((a.seat - state.heroSeat + state.seats.length) % state.seats.length) -
      ((b.seat - state.heroSeat + state.seats.length) % state.seats.length),
  );
  const areas =
    state.seats.length === 2
      ? ['hero', 'north']
      : state.seats.length === 3
        ? ['hero', 'northwest', 'northeast']
        : ['hero', 'southwest', 'northwest', 'north', 'northeast', 'southeast'];
  return (
    <div
      className={`live-table table-${state.seats.length} ${replay ? 'table-replaying' : ''}`}
      aria-label={`${state.seats.length}-player poker table`}
      data-street={state.street}
    >
      <div className="live-felt">
        <div className="live-felt-stitch" />
        <span>
          FELTLAB<span>THE ART OF THE DECISION</span>
        </span>
      </div>
      <div className="live-board">
        <div className="live-pot">
          <span>{state.completed ? 'HAND COMPLETE' : 'TOTAL POT'}</span>
          <strong>
            {chips(state.pot)} <small>chips</small>
          </strong>
        </div>
        <div className="live-community" aria-label="Community cards">
          {state.board.map((card, i) => (
            <motion.div
              key={`${state.id}-${card.rank}-${card.suit}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: i * 0.025 }}
            >
              <PlayingCard card={card} size="board" />
            </motion.div>
          ))}
          {Array.from({ length: 5 - state.board.length }, (_, i) => (
            <span className="live-card-slot" key={i} aria-label="Undealt community card">
              ♠
            </span>
          ))}
        </div>
        <span className="live-street">
          {state.street}
          {replay && ' · REPLAY'}
        </span>
      </div>
      {order.map((seat, index) => (
        <div
          key={seat.seat}
          style={{ gridArea: areas[index] }}
          className={`live-seat ${seat.seat === state.heroSeat ? 'seat-hero' : ''} ${seat.folded ? 'seat-folded' : ''} ${state.actingSeat === seat.seat && !state.completed ? 'seat-acting' : ''} ${highlightSeat === seat.seat ? 'seat-highlight' : ''} ${seat.winner ? 'seat-winner' : ''}`}
          data-seat={seat.seat}
        >
          <div className="seat-cards" aria-label={`${seat.name} cards`}>
            {seat.cards?.length ? (
              seat.cards.map((card, i) => (
                <PlayingCard
                  key={`${card.rank}-${card.suit}`}
                  card={card}
                  size={seat.seat === state.heroSeat ? 'hero' : 'small'}
                  index={i}
                />
              ))
            ) : (
              <>
                <PlayingCard hidden small />
                <PlayingCard hidden small />
              </>
            )}
          </div>
          <div className="seat-plaque">
            <span className="seat-avatar">
              {seat.winner ? (
                <Crown size={16} />
              ) : seat.seat === state.heroSeat ? (
                <UserRound size={16} />
              ) : (
                <Shield size={15} />
              )}
            </span>
            <div>
              <strong>{seat.name}</strong>
              <span>
                {seat.position}
                <i />
                {chips(seat.stack)}
              </span>
            </div>
            {state.dealer === seat.seat && (
              <span className="seat-dealer" aria-label="Dealer button">
                D
              </span>
            )}
          </div>
          <div className="seat-status">
            {seat.folded
              ? 'Folded'
              : seat.allIn
                ? 'All-in'
                : (seat.action ??
                  (state.actingSeat === seat.seat ? 'To act' : (seat.profile ?? 'Ready')))}
          </div>
          {seat.bet > 0 && (
            <motion.div
              className="seat-wager"
              key={`${state.id}-${seat.bet}`}
              initial={{ opacity: 0.4, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18 }}
            >
              <Chip stack={2} color={seat.seat === state.heroSeat ? 'mint' : 'gold'} />
              <span>{chips(seat.bet)}</span>
            </motion.div>
          )}
        </div>
      ))}
    </div>
  );
}
