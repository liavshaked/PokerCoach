import type { Actor, Scenario, Street } from '../../types/poker';
import type { ReplayFrame } from '../../components/replay/HandReplay';
import type { TableViewState } from '../../components/poker/TableView';

/** A strict fold of the authoritative V2 history. No inferred or future actions. */
export function spotReplayFrames(scenario: Scenario, displayName = 'You'): ReplayFrame[] {
  let street: Street = 'preflop';
  const stacks = { ...scenario.startingStacks };
  let bets = { hero: 0, opponent: 0 };
  let pot = 0;
  const count = { preflop: 0, flop: 3, turn: 4, river: 5 };
  const frames: ReplayFrame[] = [];
  const snapshot = (label: string, actor?: Actor) => {
    const state: TableViewState = {
      id: scenario.id,
      street,
      pot,
      board: scenario.board.slice(0, count[street]),
      heroSeat: 0,
      dealer: scenario.heroPosition === 'BTN' ? 0 : 1,
      actingSeat: null,
      completed: false,
      seats: [
        {
          seat: 0,
          name: displayName,
          position: scenario.heroPosition,
          stack: stacks.hero,
          bet: bets.hero,
          cards: [...scenario.heroCards],
          folded: false,
          allIn: stacks.hero === 0,
        },
        {
          seat: 1,
          name: 'Opponent',
          position: scenario.opponentPosition,
          stack: stacks.opponent,
          bet: bets.opponent,
          folded: false,
          allIn: stacks.opponent === 0,
        },
      ],
    };
    frames.push({
      state,
      label,
      street,
      actor: actor === undefined ? undefined : actor === 'hero' ? 0 : 1,
      eventIndex: frames.length,
    });
  };
  snapshot('Take your seats');
  scenario.history.forEach((action) => {
    if (action.street !== street) {
      street = action.street;
      bets = { hero: 0, opponent: 0 };
      snapshot(`${street[0].toUpperCase() + street.slice(1)} dealt`);
    }
    const contribution =
      action.kind === 'bet' || action.kind === 'raise'
        ? (action.amount ?? 0) - bets[action.actor]
        : action.kind === 'post' || action.kind === 'call'
          ? (action.amount ?? 0)
          : 0;
    stacks[action.actor] -= contribution;
    bets[action.actor] += contribution;
    pot += contribution;
    const verb = {
      post: 'posts',
      fold: 'folds',
      check: 'checks',
      call: 'calls',
      bet: 'bets',
      raise: 'raises to',
    }[action.kind];
    snapshot(
      `${action.actor === 'hero' ? displayName : 'Opponent'} ${verb}${action.amount === undefined ? '' : ` ${action.amount} BB`}`,
      action.actor,
    );
  });
  if (street !== scenario.street) {
    street = scenario.street;
    bets = { hero: 0, opponent: 0 };
    snapshot(`${street[0].toUpperCase() + street.slice(1)} dealt`);
  }
  const final = frames.at(-1)!;
  final.state.actingSeat = 0;
  return frames;
}
