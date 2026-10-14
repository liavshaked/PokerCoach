import { describe, expect, it } from 'vitest';
import type { Card } from '../../types/poker';
import { cardKey, createDeck } from '../cards';
import { seededRandom } from '../generation/random';
import {
  applyAction,
  buildSidePots,
  createHand,
  deserializeHand,
  getAgentView,
  getLegalActions,
  getPublicView,
  nextHand,
  replayHand,
  serializeHand,
  validateGameState,
  type GameAction,
  type GameState,
  type HandConfig,
} from './index';

function config(count: 2 | 3 | 6 = 3, stacks: number[] = []): HandConfig {
  return {
    seed: 'game-regression',
    players: Array.from({ length: count }, (_, seat) => ({
      id: `p${seat}`,
      name: `Player ${seat}`,
      stack: stacks[seat] ?? 100,
    })),
    buttonSeat: 0,
    smallBlind: 0.5,
    bigBlind: 1,
    chipUnit: 0.5,
  };
}
function act(state: GameState, type: GameAction['type'], amount?: number): GameState {
  return applyAction(state, { type, ...(amount === undefined ? {} : { amount }) });
}
function checkCall(state: GameState): GameState {
  for (let guard = 0; !state.result && guard < 100; guard++)
    state = applyAction(state, {
      type: getLegalActions(state).some((action) => action.type === 'check') ? 'check' : 'call',
    });
  if (!state.result) throw new Error('Check/call line failed to finish.');
  return state;
}
function fixedDeck(count: number, holes: Card[][], board: Card[]): Card[] {
  const slots = new Map<number, Card>();
  for (let offset = 0; offset < count; offset++) {
    const seat = (1 + offset) % count;
    slots.set(offset, holes[seat][0]);
    slots.set(offset + count, holes[seat][1]);
  }
  const start = count * 2;
  [start + 1, start + 2, start + 3, start + 5, start + 7].forEach((index, i) =>
    slots.set(index, board[i]),
  );
  const available = createDeck([...slots.values()]);
  return Array.from({ length: 52 }, (_, index) => slots.get(index) ?? available.shift()!);
}
const c = (rank: Card['rank'], suit: Card['suit'] = 'clubs'): Card => ({ rank, suit });

describe('complete NLHE event engine', () => {
  it('uses button/SB first preflop and BB first postflop heads-up', () => {
    let state = createHand(config(2));
    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(1);
    expect(state.actorId).toBe('p0');
    state = act(state, 'call');
    expect(state.actorId).toBe('p1');
    state = act(state, 'check');
    expect(state.street).toBe('flop');
    expect(state.actorId).toBe('p1');
    expect(state.pot).toBe(2);
  });
  it('starts 3 and 6 player action left of BB and starts flop left of button', () => {
    for (const count of [3, 6] as const) {
      let state = createHand(config(count));
      expect(state.actorId).toBe(count === 3 ? 'p0' : 'p3');
      while (state.street === 'preflop')
        state = act(
          state,
          getLegalActions(state).some((action) => action.type === 'check') ? 'check' : 'call',
        );
      expect(state.actorId).toBe('p1');
      expect(state.pot).toBe(count);
    }
  });
  it('refunds the uncalled portion and terminates after folds without a fake board', () => {
    let state = createHand(config(3));
    state = act(state, 'raise', 20);
    state = act(state, 'fold');
    state = act(state, 'fold');
    expect(state.result?.reason).toBe('folds');
    expect(state.board).toEqual([]);
    expect(state.players.map((player) => player.stack)).toEqual([101.5, 99.5, 99]);
    expect(state.events.find((event) => event.type === 'uncalled-returned')).toMatchObject({
      amount: 19,
    });
    expect(validateGameState(state).valid).toBe(true);
  });
  it('requires the full last raise increment, and rejects off-grid sizes and out-of-turn actions', () => {
    let state = createHand(config(3));
    state = act(state, 'raise', 2.5);
    expect(getLegalActions(state).find((action) => action.type === 'raise')?.minAmount).toBe(4);
    expect(() => act(state, 'raise', 3.5)).toThrow();
    expect(() => act(state, 'raise', 4.1)).toThrow();
    expect(() => act(state, 'check')).toThrow();
    expect(getLegalActions(state, 'p0')).toEqual([]);
  });
  it('does not reopen a full raiser after cumulative short all-ins below a full raise', () => {
    let state = createHand(config(3, [100, 14, 18]));
    state = act(state, 'raise', 10);
    state = act(state, 'raise', 14);
    state = act(state, 'raise', 18);
    expect(state.actorId).toBe('p0');
    expect(state.minRaise).toBe(9);
    expect(getLegalActions(state).map((action) => action.type)).toEqual(['fold', 'call']);
    expect(() => act(state, 'raise', 30)).toThrow();
    state = act(state, 'call');
    expect(state.result?.reason).toBe('showdown');
    expect(state.board).toHaveLength(5);
  });
  it('reopens after cumulative short all-ins reach the full increment when another player can call', () => {
    let state = createHand(config(6, [100, 100, 100, 100, 14, 19]));
    state = act(state, 'raise', 10); // UTG p3
    state = act(state, 'raise', 14); // p4 short all-in
    state = act(state, 'raise', 19); // p5 another short all-in
    state = act(state, 'call'); // p0
    state = act(state, 'call'); // p1
    state = act(state, 'call'); // p2
    expect(state.actorId).toBe('p3');
    expect(state.minRaise).toBe(9);
    expect(getLegalActions(state).find((action) => action.type === 'raise')?.minAmount).toBe(28);
    expect(() => act(state, 'raise', 27.5)).toThrow();
    expect(act(state, 'raise', 28).currentBet).toBe(28);
  });
  it('keeps players who called an intervening short raise closed until their own full increment is faced', () => {
    let state = createHand(config(6, [19, 100, 100, 100, 14, 100]));
    state = act(state, 'raise', 10);
    state = act(state, 'raise', 14);
    state = act(state, 'call');
    state = act(state, 'raise', 19);
    state = act(state, 'call');
    state = act(state, 'call');
    state = act(state, 'call');
    expect(state.actorId).toBe('p5');
    expect(state.lastActedBet.p5).toBe(14);
    expect(state.minRaise).toBe(9);
    expect(getLegalActions(state).map((action) => action.type)).toEqual(['fold', 'call']);
  });
  it('supports under-minimum opening bets only when they are all-in, preserving prior check closure', () => {
    let state = createHand(config(3, [100, 1.5, 100]));
    state = act(state, 'call');
    state = act(state, 'call');
    state = act(state, 'check');
    expect(state.actorId).toBe('p1');
    expect(getLegalActions(state).find((action) => action.type === 'bet')).toMatchObject({
      minAmount: 0.5,
      maxAmount: 0.5,
      allInOnly: true,
    });
    state = act(state, 'bet', 0.5);
    expect(state.minRaise).toBe(1);
    expect(getLegalActions(state).find((action) => action.type === 'raise')?.minAmount).toBe(1.5);
  });
  it('does not create a dry side-pot raise when no remaining opponent can cover the current wager', () => {
    let state = createHand(config(6, [50, 50, 50, 80, 20, 100]));
    state = act(state, 'raise', 80);
    state = act(state, 'call');
    expect(state.actorId).toBe('p5');
    expect(getLegalActions(state).map((action) => action.type)).toEqual(['fold', 'call']);
    expect(() => act(state, 'raise', 100)).toThrow();
  });
  it('does not reopen a prior check after an incomplete opening all-in wager', () => {
    let state = createHand(config(3, [100, 100, 1.5]));
    state = act(state, 'call');
    state = act(state, 'call');
    state = act(state, 'check');
    expect(state.actorId).toBe('p1');
    state = act(state, 'check');
    state = act(state, 'bet', 0.5);
    expect(state.actorId).toBe('p0');
    expect(getLegalActions(state).find((action) => action.type === 'raise')?.minAmount).toBe(1.5);
    state = act(state, 'call');
    expect(state.actorId).toBe('p1');
    expect(getLegalActions(state).map((action) => action.type)).toEqual(['fold', 'call']);
    expect(() => act(state, 'raise', 1.5)).toThrow();
  });
  it('constructs and resolves multiple side pots with folded players ineligible', () => {
    const holes = [
      [c('A', 'hearts'), c('A', 'spades')],
      [c('K', 'hearts'), c('K', 'spades')],
      [c('Q', 'hearts'), c('Q', 'spades')],
    ];
    const board = [c('2'), c('4', 'diamonds'), c('6'), c('8', 'diamonds'), c('T')];
    let state = createHand({ ...config(3, [10, 20, 30]), deck: fixedDeck(3, holes, board) });
    state = act(state, 'raise', 10);
    state = act(state, 'raise', 20);
    state = act(state, 'call');
    expect(state.result?.pots.map((pot) => pot.amount)).toEqual([30, 20]);
    expect(state.result?.pots.map((pot) => pot.winnerIds)).toEqual([['p0'], ['p1']]);
    expect(state.players.map((player) => player.stack)).toEqual([30, 20, 10]);
    expect(state.pot).toBe(0);
  });
  it('splits a shared straight flush and sends an odd chip first clockwise from button', () => {
    const holes = [
      [c('2', 'hearts'), c('3', 'hearts')],
      [c('4', 'hearts'), c('5', 'hearts')],
      [c('6', 'hearts'), c('7', 'hearts')],
    ];
    const board = [c('A'), c('K'), c('Q'), c('J'), c('T')];
    let state = createHand({ ...config(3), deck: fixedDeck(3, holes, board) });
    state = act(state, 'raise', 2.5);
    state = act(state, 'fold');
    state = act(state, 'call');
    state = checkCall(state);
    expect(state.result?.pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(5.5);
    expect(state.result?.payouts).toEqual({ p0: 2.5, p1: 0, p2: 3 });
    expect(state.result?.winnerIds).toEqual(['p2', 'p0']);
  });
  it('preserves previous states, serializes the authoritative events and reconstructs every prefix', () => {
    const original = createHand(config(3));
    const before = JSON.stringify(original);
    const finished = checkCall(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(deserializeHand(serializeHand(finished))).toEqual(finished);
    expect(Object.isFrozen(finished.events)).toBe(true);
    expect(Object.isFrozen(finished.events[0])).toBe(true);
    expect(() => {
      finished.events[0].index = 900;
    }).toThrow();
    for (let count = 1; count <= finished.events.length; count++) {
      const frame = replayHand(finished.events, count);
      expect(frame.events).toHaveLength(count);
      expect(validateGameState(frame).valid).toBe(true);
      const publicFrame = getPublicView(frame);
      expect(publicFrame.board).toEqual(frame.board);
      if (!frame.result)
        expect(
          publicFrame.players.slice(1).every((player) => player.revealedCards === undefined),
        ).toBe(true);
    }
  });
  it('does not expose other live cards, seeded deck or private initialization through agent projections', () => {
    const state = createHand(config(6));
    const view = getAgentView(state, 'p3');
    expect(view.holeCards).toEqual(state.players[3].holeCards);
    expect(view.table).not.toHaveProperty('seed');
    expect(view.table).not.toHaveProperty('deck');
    expect(view.table).not.toHaveProperty('config');
    expect(view.table.id).not.toContain(state.seed);
    expect(
      view.table.players.every((player) => !('holeCards' in player) && !player.revealedCards),
    ).toBe(true);
    expect(
      view.table.events.every((event) => event.type !== 'hole-cards-dealt' || !event.cards),
    ).toBe(true);
    view.holeCards[0].rank = '2';
    expect(view.holeCards).not.toEqual(state.players[3].holeCards);
  });
  it('uses opaque hand identity without changing seeded deals or replay identity', () => {
    const first = createHand(config(3));
    const second = createHand(config(3));
    expect(first.id).not.toBe(second.id);
    expect(first.players.map((player) => player.holeCards)).toEqual(
      second.players.map((player) => player.holeCards),
    );
    expect(first.deck).toEqual(second.deck);
    expect(deserializeHand(serializeHand(first)).id).toBe(first.id);
    const named = createHand({ ...config(3), id: 'an-explicit-public-hand-id' });
    expect(named.id).toBe('an-explicit-public-hand-id');
  });
  it('rejects corrupted import events and settlement results rather than trusting snapshot chips', () => {
    const finished = checkCall(createHand(config(3)));
    const data = JSON.parse(serializeHand(finished));
    const action = data.events.find((event: { type: string }) => event.type === 'action');
    action.paid += 1;
    expect(() => deserializeHand(JSON.stringify(data))).toThrow();
    expect(() => deserializeHand('{"version":2,"events":[]}')).toThrow();
    expect(() =>
      deserializeHand(JSON.stringify({ version: 3, events: finished.events.slice(0, 2) })),
    ).toThrow();
    expect(() =>
      createHand({ ...config(), players: [{ id: 'x', name: 'X', stack: 1 }] }),
    ).toThrow();
    const unknown = JSON.parse(serializeHand(finished));
    unknown.events[4].type = 'untrusted-command';
    expect(() => deserializeHand(JSON.stringify(unknown))).toThrow();
    const missingBlind = JSON.parse(serializeHand(finished));
    missingBlind.events.splice(2, 1);
    missingBlind.events.forEach((event: { index: number }, index: number) => {
      event.index = index;
    });
    expect(() => deserializeHand(JSON.stringify(missingBlind))).toThrow();
  });
  it('rotates the button and continues sessions without a fixed hand limit', () => {
    let state = createHand(config(3));
    for (let hand = 1; hand <= 101; hand++) {
      state = checkCall(state);
      expect(state.handNumber).toBe(hand);
      if (hand <= 100) state = nextHand(state, { seed: `continuous-${hand}`, autoRebuy: true });
    }
    expect(state.buttonSeat).toBe(1);
    expect(validateGameState(state).valid).toBe(true);
  });
  it.each([2, 3, 6] as const)(
    'carries winning and losing stacks into the next %i-player hand with auto-rebuy enabled',
    (count) => {
      const completed = checkCall(createHand(config(count)));
      const stacks = completed.players.map((player) => player.stack);
      expect(stacks.some((stack) => stack > 0 && stack < 100)).toBe(true);
      const following = nextHand(completed, {
        seed: `carry-stacks-${count}`,
        autoRebuy: true,
        startingStack: 100,
      });
      expect(following.players.map((player) => player.startingStack)).toEqual(stacks);
      expect(following.players.reduce((sum, player) => sum + player.stack, following.pot)).toBe(
        count * 100,
      );
    },
  );
  it('rebuys only busted seats while preserving funded players below and above the starting stack', () => {
    const completed = checkCall(createHand(config(3, [100, 0, 100])));
    expect(completed.players.some((player) => player.stack > 0 && player.stack < 100)).toBe(true);
    const following = nextHand(completed, {
      seed: 'rebuy-busted-only',
      autoRebuy: true,
      startingStack: 100,
    });
    expect(following.players.map((player) => player.startingStack)).toEqual(
      completed.players.map((player) => (player.stack === 0 ? 100 : player.stack)),
    );
    expect(following.players[1].startingStack).toBe(100);
    expect(following.players.reduce((sum, player) => sum + player.stack, following.pot)).toBe(300);
  });
  it('keeps busted seats out without rebuy and uses heads-up rules when two funded players remain', () => {
    let state = createHand(config(6, [100, 0, 0, 100, 0, 0]));
    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(3);
    expect(state.actorId).toBe('p0');
    expect(state.players.filter((player) => player.holeCards.length)).toHaveLength(2);
    expect(getPublicView(state).players[1].position).toBe('OUT');
    state = checkCall(state);
    const following = nextHand(state, { seed: 'busted-seat-rotation', autoRebuy: false });
    expect(following.buttonSeat).toBe(3);
    expect(following.smallBlindSeat).toBe(3);
    expect(following.bigBlindSeat).toBe(0);
    expect(following.players[1].stack).toBe(0);
    expect(deserializeHand(serializeHand(following))).toEqual(following);
  });
});

describe('10,000 complete seeded hands across 2/3/6 seats', () => {
  it('preserves denominations and tiny-stack blind/all-in accounting on decimal and integer chip grids', () => {
    for (const denomination of [0.01, 0.1, 1]) {
      for (let index = 0; index < 60; index++) {
        const random = seededRandom(`chip-grid-${denomination}-${index}`);
        const count = [2, 3, 6][index % 3] as 2 | 3 | 6;
        const stacks = Array.from({ length: count }, () =>
          Number(((1 + Math.floor(random() * 40)) * denomination).toFixed(6)),
        );
        let state = createHand({
          ...config(count, stacks),
          seed: `chip-grid-deck-${index}`,
          chipUnit: denomination,
          smallBlind: denomination,
          bigBlind: denomination * 2,
        });
        let guard = 0;
        while (!state.result && guard++ < 200) {
          const actions = getLegalActions(state);
          const selected = actions[Math.floor(random() * actions.length)];
          const amount =
            selected.type === 'bet' || selected.type === 'raise'
              ? selected.maxAmount
              : selected.amount;
          state = applyAction(state, {
            type: selected.type,
            ...(amount === undefined ? {} : { amount }),
          });
          expect(validateGameState(state).valid).toBe(true);
        }
        expect(state.result).not.toBeNull();
        expect(deserializeHand(serializeHand(state))).toEqual(state);
      }
    }
  });
  it('finishes legal adversarial action streams with conserved chips, unique cards and exact event replay', () => {
    let foldedHands = 0,
      showdownHands = 0,
      multiWayShowdowns = 0,
      totalActions = 0;
    const counts = [2, 3, 6] as const;
    for (let index = 0; index < 10000; index++) {
      const count = counts[index % 3];
      const random = seededRandom(`stress-actions-${index}`);
      const stacks = Array.from({ length: count }, () => (1 + Math.floor(random() * 200)) * 0.5);
      let state = createHand({
        ...config(count, stacks),
        seed: `stress-deck-${index}`,
        buttonSeat: index % count,
      });
      let guard = 0;
      while (!state.result && guard++ < 300) {
        const options = getLegalActions(state);
        expect(options.length).toBeGreaterThan(0);
        const option = options[Math.floor(random() * options.length)];
        const amount =
          option.type === 'bet' || option.type === 'raise'
            ? random() < 0.45
              ? option.maxAmount
              : option.minAmount! +
                Math.floor(random() * ((option.maxAmount! - option.minAmount!) / 0.5 + 1)) * 0.5
            : option.amount;
        state = applyAction(state, {
          type: option.type,
          ...(amount === undefined ? {} : { amount }),
        });
        if (!validateGameState(state).valid)
          throw new Error(`Invalid seed ${index}: ${validateGameState(state).errors.join(', ')}`);
        totalActions++;
      }
      if (!state.result) throw new Error(`Deadlock or infinite betting in seed ${index}.`);
      if (state.result.reason === 'folds') foldedHands++;
      else {
        showdownHands++;
        if (state.players.filter((player) => player.status !== 'folded').length >= 3)
          multiWayShowdowns++;
      }
      const replayed = deserializeHand(serializeHand(state));
      if (JSON.stringify(replayed) !== JSON.stringify(state))
        throw new Error(`Replay diverged at seed ${index}.`);
      const seen = [...state.players.flatMap((player) => player.holeCards), ...state.board].map(
        cardKey,
      );
      expect(new Set(seen).size).toBe(seen.length);
      expect(state.result.pots.reduce((sum, pot) => sum + pot.amount, 0)).toBeCloseTo(
        Object.values(state.result.payouts).reduce((sum, value) => sum + value, 0),
      );
      expect(
        buildSidePots(state).every((pot) =>
          pot.eligiblePlayerIds.every(
            (id) => state.players.find((player) => player.id === id)?.status !== 'folded',
          ),
        ),
      ).toBe(true);
    }
    console.info(
      JSON.stringify({
        hands: 10000,
        seatCounts: { 2: 3334, 3: 3333, 6: 3333 },
        foldedHands,
        showdownHands,
        multiWayShowdowns,
        totalActions,
      }),
    );
    expect(foldedHands).toBeGreaterThan(100);
    expect(showdownHands).toBeGreaterThan(100);
    expect(multiWayShowdowns).toBeGreaterThan(100);
  }, 180000);
});
