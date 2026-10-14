import { describe, expect, it } from 'vitest';
import { scenarios } from '../../data/scenarios';
import { generateScenario } from '../../engine/generation';
import { replayHistory } from '../../engine/rules';
import {
  applyAction,
  createHand,
  deserializeHand,
  getLegalActions,
  getPublicView,
  replayHand,
  serializeHand,
  type GameState,
} from '../../engine/game';
import type { Scenario, Street } from '../../types/poker';
import { spotReplayFrames } from '../../features/practice/spot-replay';
import { gameReplayFrames, tableView } from './game-replay';

const boardCount: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };
function completedHand(foldedOpponent = false): GameState {
  let state = createHand({
    seed: foldedOpponent ? 'visual-folded-opponent' : 'visual-showdown',
    smallBlind: 0.5,
    bigBlind: 1,
    players: [
      { id: 'hero', name: 'You', stack: 100 },
      { id: 'one', name: 'One', stack: 100 },
      { id: 'two', name: 'Two', stack: 100 },
    ],
  });
  if (foldedOpponent) {
    state = applyAction(state, { type: 'call' });
    state = applyAction(state, { type: 'fold' });
  }
  while (!state.result)
    state = applyAction(state, {
      type: getLegalActions(state).some((action) => action.type === 'check') ? 'check' : 'call',
    });
  return state;
}

function assertSpotFrames(scenario: Scenario): void {
  const before = JSON.stringify(scenario);
  const frames = spotReplayFrames(scenario, 'Learner');
  expect(JSON.stringify(scenario)).toBe(before);
  expect(frames[0].state.pot).toBe(0);
  expect(frames[0].state.board).toEqual([]);
  expect(frames[0].state.seats.map((seat) => seat.stack)).toEqual([
    scenario.startingStacks.hero,
    scenario.startingStacks.opponent,
  ]);
  let cursor = 0;
  let street: Street = 'preflop';
  scenario.history.forEach((action, index) => {
    if (action.street !== street) {
      street = action.street;
      cursor++;
      const dealt = frames[cursor];
      expect(dealt.label).toMatch(/dealt$/);
      expect(dealt.state.board).toEqual(scenario.board.slice(0, boardCount[street]));
    }
    cursor++;
    const frame = frames[cursor];
    expect(frame.actor).toBe(action.actor === 'hero' ? 0 : 1);
    if (index >= 1) {
      const independentlyReplayed = replayHistory({
        ...scenario,
        history: scenario.history.slice(0, index + 1),
      });
      expect(frame.state.pot).toBeCloseTo(independentlyReplayed.pot, 10);
      expect(frame.state.seats.map((seat) => seat.stack)).toEqual([
        independentlyReplayed.stacks.hero,
        independentlyReplayed.stacks.opponent,
      ]);
      expect(frame.state.seats.map((seat) => seat.bet)).toEqual([
        independentlyReplayed.contributions.hero,
        independentlyReplayed.contributions.opponent,
      ]);
    }
  });
  for (const frame of frames) {
    expect(frame.state.board).toEqual(scenario.board.slice(0, boardCount[frame.street]));
    expect(frame.state.seats[0].cards).toEqual(scenario.heroCards);
    expect(frame.state.seats[1].cards).toBeUndefined();
    expect(frame.state).not.toHaveProperty('legalActions');
    expect(frame.state).not.toHaveProperty('reasoning');
    expect(frame.state).not.toHaveProperty('hint');
    expect(
      frame.state.seats.reduce((sum, seat) => sum + seat.stack, 0) + frame.state.pot,
    ).toBeCloseTo(scenario.startingStacks.hero + scenario.startingStacks.opponent, 10);
  }
  const final = frames.at(-1)!;
  expect(final.state.street).toBe(scenario.street);
  expect(final.state.pot).toBeCloseTo(scenario.currentPot, 10);
  expect(final.state.board).toEqual(scenario.board);
  expect(final.state.actingSeat).toBe(0);
  expect(final.state.completed).toBe(false);
  expect(final.state.seats.map((seat) => seat.stack)).toEqual([
    scenario.stacks.hero,
    scenario.stacks.opponent,
  ]);
  expect(final.state.dealer).toBe(scenario.heroPosition === 'BTN' ? 0 : 1);
}

describe('historical Practice table frames', () => {
  it('matches every preserved V2 spot’s validated chip/action history without future board cards or answers', () => {
    for (const scenario of scenarios) assertSpotFrames(scenario);
  });
  it('replays seeded generated scenarios from every supported street without changing the unanswered spot', () => {
    for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
      for (let index = 0; index < 3; index++)
        assertSpotFrames(generateScenario({ seed: `replay-${street}-${index}`, street }));
    }
  });
  it('introduces each community street before its first action and shows no premature acting hero', () => {
    const scenario = scenarios.find((spot) => spot.street === 'river')!;
    const frames = spotReplayFrames(scenario);
    expect(
      frames.filter((frame) => frame.label.endsWith('dealt')).map((frame) => frame.street),
    ).toEqual(['flop', 'turn', 'river']);
    expect(frames.slice(0, -1).every((frame) => frame.state.actingSeat === null)).toBe(true);
    expect(frames.at(-1)?.state.actingSeat).toBe(0);
  });
});

describe('full game replay and public table adapter', () => {
  it('maps every visual frame to the exact authoritative event prefix, including independent reload', () => {
    const hand = completedHand();
    const frames = gameReplayFrames(hand);
    expect(frames).toHaveLength(hand.events.length);
    frames.forEach((frame, index) => {
      const actual = replayHand(hand.events, index + 1);
      expect(frame.state).toEqual(tableView(getPublicView(actual, 0)));
      expect(frame.eventIndex).toBe(index);
      expect(frame.street).toBe(hand.events[index].street);
      expect(frame.state.board).toEqual(actual.board);
      expect(frame.state.seats.map((seat) => seat.stack)).toEqual(
        actual.players.map((player) => player.stack),
      );
      expect(frame.state.seats.map((seat) => seat.bet)).toEqual(
        actual.players.map((player) => player.streetCommitted),
      );
      if (
        actual.players.some((player) => player.startingStack > 0 && player.holeCards.length !== 2)
      ) {
        expect(frame.state.actingSeat).toBeNull();
        expect(getLegalActions(actual)).toEqual([]);
      }
    });
    expect(gameReplayFrames(deserializeHand(serializeHand(hand)))).toEqual(frames);
    expect(frames.at(-1)?.state.seats.every((seat) => seat.bet === 0)).toBe(true);
  });
  it('exposes opponent cards only at the actual showdown event, retaining folded cards as unknown', () => {
    const hand = completedHand(true);
    const frames = gameReplayFrames(hand);
    const showdown = hand.events.findIndex((event) => event.type === 'hand-settled');
    frames.forEach((frame, index) => {
      for (const seat of frame.state.seats.slice(1)) {
        if (index < showdown || seat.folded) expect(seat.cards).toBeUndefined();
        else expect(seat.cards).toEqual(hand.players[seat.seat].holeCards);
      }
      expect(frame.state.board.length).toBe(boardCount[frame.state.street]);
    });
    expect(frames.at(-1)?.state.seats[1].folded).toBe(true);
    expect(frames.at(-1)?.state.seats[1].cards).toBeUndefined();
  });
  it('shows an uncontested hand ending without exposing future board or unshown opponent cards', () => {
    let state = createHand({
      seed: 'fold-visual',
      smallBlind: 0.5,
      bigBlind: 1,
      players: [
        { id: 'hero', name: 'You', stack: 100 },
        { id: 'opponent', name: 'Opponent', stack: 100 },
      ],
    });
    state = applyAction(state, { type: 'raise', amount: 3 });
    state = applyAction(state, { type: 'fold' });
    const frames = gameReplayFrames(state);
    expect(frames.every((frame) => frame.state.board.length === 0)).toBe(true);
    expect(frames.every((frame) => frame.state.seats[1].cards === undefined)).toBe(true);
    expect(frames.at(-1)?.state.completed).toBe(true);
    expect(frames.at(-1)?.state.seats[0].winner).toBe(true);
    expect(frames.some((frame) => frame.label.includes('uncalled'))).toBe(true);
  });
  it('never passes seeds, deck order, future event logs or private config into the shared table presentation', () => {
    const hand = completedHand();
    const frames = gameReplayFrames(hand);
    for (const frame of frames) {
      expect(frame.state).not.toHaveProperty('seed');
      expect(frame.state).not.toHaveProperty('deck');
      expect(frame.state).not.toHaveProperty('events');
      expect(frame.state).not.toHaveProperty('config');
      expect(frame.label).not.toContain(hand.seed);
    }
    expect(frames[0].state.seats.every((seat) => !seat.cards?.length)).toBe(true);
  });
});
