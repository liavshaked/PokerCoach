import { getPublicView, replayHand } from '../../engine/game';
import type { GameState, GameEvent, PublicGameState } from '../../engine/game/types';
import type { ReplayFrame } from './HandReplay';
import type { TableViewState } from '../poker/TableView';

export function tableView(state: PublicGameState, heroSeat = 0): TableViewState {
  return {
    id: state.id,
    street: state.street,
    pot: state.pot,
    board: state.board,
    heroSeat,
    dealer: state.buttonSeat,
    actingSeat: state.players.find((player) => player.id === state.actorId)?.seat ?? null,
    completed: Boolean(state.result),
    seats: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      stack: player.stack,
      bet: player.streetCommitted,
      position: player.position,
      cards: player.revealedCards,
      folded: player.status === 'folded',
      allIn: player.status === 'all-in',
      winner: state.result?.winnerIds.includes(player.id),
      action: player.lastAction
        ? `${player.lastAction.type}${player.lastAction.amount === undefined ? '' : ` ${player.lastAction.amount}`}`
        : undefined,
    })),
  };
}
export function eventLabel(event: GameEvent, names: Record<string, string>): string {
  const name = 'playerId' in event ? (names[event.playerId] ?? 'Player') : '';
  switch (event.type) {
    case 'hand-started':
      return 'A new hand begins';
    case 'blind-posted':
      return `${name} posts ${event.blind} blind · ${event.amount}`;
    case 'hole-cards-dealt':
      return `${name} receives two private cards`;
    case 'action':
      return `${name} ${event.action.type}${event.action.amount === undefined ? '' : `${event.action.type === 'bet' || event.action.type === 'raise' ? ' to' : ''} ${event.action.amount}`} ${event.paid > 0 ? `· ${event.paid} chips added` : ''}`;
    case 'board-dealt':
      return `${event.street[0].toUpperCase() + event.street.slice(1)} dealt`;
    case 'uncalled-returned':
      return `${event.amount} uncalled chips returned to ${name}`;
    case 'hand-settled':
      return `${event.result.reason === 'showdown' ? 'Showdown' : 'Everyone else folded'} · ${event.result.winnerIds.map((id) => names[id]).join(' & ')} wins`;
  }
}
export function gameReplayFrames(hand: GameState): ReplayFrame[] {
  const names = Object.fromEntries(hand.players.map((player) => [player.id, player.name]));
  return hand.events.map((event, index) => {
    const state = replayHand(hand.events, index + 1);
    return {
      state: tableView(getPublicView(state, 0)),
      label: eventLabel(event, names),
      street: event.street,
      eventIndex: index,
      actor:
        'playerId' in event
          ? state.players.find((player) => player.id === event.playerId)?.seat
          : undefined,
    };
  });
}
