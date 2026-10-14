import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  createHand,
  getLegalActions,
  type AgentView,
  type GameAction,
} from '../../engine/game';
import { createDeck } from '../../engine/cards';
import type { Card } from '../../types/poker';
import * as agents from '../../engine/agents';
import * as analysis from '../../engine/analysis';
import { decisionToken, canRevealAnalysis, canRevealHandRecord } from './types';
import {
  defaultTableConfig,
  RECENT_HAND_LIMIT,
  sanitizeTableData,
  TABLE_STORAGE_KEY,
  useTableStore,
} from './store';

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}
function reset() {
  useTableStore.setState({
    totals: { hands: 0, decisions: 0, heroNet: 0 },
    config: { ...defaultTableConfig, profiles: [...defaultTableConfig.profiles] },
    currentHand: null,
    decisions: [],
    hands: [],
    savedHands: [],
    session: null,
    observations: {},
    paused: false,
    storageAvailable: true,
    error: null,
  });
}
function finishHand() {
  let count = 0;
  while (!useTableStore.getState().currentHand!.result) {
    const state = useTableStore.getState();
    const hand = state.currentHand!;
    if (hand.actorId === 'hero') {
      const options = getLegalActions(hand);
      const action =
        options.find((option) => option.type === 'fold') ??
        options.find((option) => option.type === 'check') ??
        options.find((option) => option.type === 'call')!;
      expect(state.submitHero({ type: action.type }, decisionToken(hand))).toBe(true);
    } else expect(state.stepBot(decisionToken(hand))).toBe(true);
    expect(++count).toBeLessThan(150);
  }
}

const passiveAction = (view: AgentView): GameAction => ({
  type: view.legalActions.some((action) => action.type === 'check') ? 'check' : 'call',
});
const shoveAction = (view: AgentView): GameAction => {
  const aggressive = view.legalActions.find(
    (action) => action.type === 'raise' || action.type === 'bet',
  );
  return aggressive
    ? { type: aggressive.type, amount: aggressive.maxAmount ?? aggressive.amount }
    : passiveAction(view);
};

/** Bot 1's aces win an unpaired, non-flush board; every event still comes from the engine. */
function riggedHand(stacks: number[], handNumber = 1) {
  const ranks: Card['rank'][] = ['K', 'A', 'Q', 'J', '9', '7'];
  const slots = new Map<number, Card>();
  const order = Array.from(
    { length: stacks.length },
    (_, offset) => (offset + 1) % stacks.length,
  ).filter((seat) => stacks[seat] > 0);
  for (const [offset, seat] of order.entries()) {
    slots.set(offset, { rank: ranks[seat], suit: 'clubs' });
    slots.set(offset + order.length, { rank: ranks[seat], suit: 'hearts' });
  }
  const board: Card[] = [
    { rank: '2', suit: 'diamonds' },
    { rank: '4', suit: 'hearts' },
    { rank: '6', suit: 'spades' },
    { rank: '8', suit: 'diamonds' },
    { rank: 'T', suit: 'clubs' },
  ];
  const start = order.length * 2;
  [start + 1, start + 2, start + 3, start + 5, start + 7].forEach((slot, index) =>
    slots.set(slot, board[index]),
  );
  const remaining = createDeck([...slots.values()]);
  return createHand({
    seed: 'elimination-fixture',
    handNumber,
    players: stacks.map((stack, seat) => ({
      id: seat ? `bot-${seat}` : 'hero',
      name: seat ? `Bot ${seat}` : 'You',
      stack,
    })),
    buttonSeat: 0,
    smallBlind: 0.5,
    bigBlind: 1,
    deck: Array.from({ length: 52 }, (_, index) => slots.get(index) ?? remaining.shift()!),
  });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  reset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('persisted full-hand table sessions', () => {
  it.each([2, 3, 6] as const)(
    'declares one winner and records simultaneous eliminations at a %i-seat table',
    async (playerCount) => {
      vi.spyOn(agents, 'chooseAgentAction').mockImplementation(shoveAction);
      const state = useTableStore.getState();
      expect(state.startSession({ playerCount, autoRebuy: true }, `winner-${playerCount}`)).toBe(
        true,
      );
      useTableStore.setState({ currentHand: riggedHand(Array(playerCount).fill(100)) });
      for (let guard = 0; !useTableStore.getState().session?.endedAt && guard < 10; guard += 1) {
        const next = useTableStore.getState();
        const hand = next.currentHand!;
        if (hand.actorId === 'hero') {
          const action = getLegalActions(hand).find((option) => option.type === 'raise');
          expect(
            next.submitHero(
              action ? { type: 'raise', amount: action.maxAmount } : { type: 'call' },
              decisionToken(hand),
            ),
          ).toBe(true);
        } else expect(next.fastForward(decisionToken(hand))).toBe(true);
      }
      const completed = useTableStore.getState();
      expect(completed.error).toBeNull();
      expect(completed.session).toMatchObject({
        winnerId: 'bot-1',
        endedReason: 'winner',
        handsCompleted: 1,
      });
      expect(completed.session?.endedAt).not.toBeNull();
      expect(completed.session?.eliminations).toHaveLength(playerCount - 1);
      expect(
        completed.session?.eliminations.every(
          (entry) => entry.place === 2 && entry.handNumber === 1,
        ),
      ).toBe(true);
      expect(completed.currentHand?.players[1].stack).toBe(playerCount * 100);
      expect(completed.nextHand(decisionToken(completed.currentHand))).toBe(false);
      expect(completed.fastForward(decisionToken(completed.currentHand))).toBe(false);
      completed.resume();
      expect(useTableStore.getState().paused).toBe(true);
      await useTableStore.persist.rehydrate();
      expect(useTableStore.getState().session).toEqual(completed.session);
      expect(useTableStore.getState().totals.hands).toBe(1);
      expect(useTableStore.getState().config.autoRebuy).toBe(false);
    },
  );

  it('keeps an eliminated hero out while remaining opponents play heads-up to a winner', async () => {
    const policy = vi.spyOn(agents, 'chooseAgentAction').mockImplementation(passiveAction);
    useTableStore
      .getState()
      .startSession({ playerCount: 3, feedbackTiming: 'session-review' }, 'spectate-final');
    useTableStore.setState({ currentHand: riggedHand([10, 100, 100]) });
    let state = useTableStore.getState();
    expect(state.submitHero({ type: 'raise', amount: 10 }, decisionToken(state.currentHand))).toBe(
      true,
    );
    // Zero chips behind an all-in bet does not yet mean eliminated.
    await useTableStore.persist.rehydrate();
    state = useTableStore.getState();
    expect(state.session?.eliminations).toEqual([]);
    expect(state.fastForward(decisionToken(state.currentHand))).toBe(true);
    state = useTableStore.getState();
    expect(state.session?.eliminations).toEqual([{ playerId: 'hero', handNumber: 1, place: 3 }]);
    expect(state.session?.endedAt).toBeNull();
    expect(canRevealHandRecord(state.config, state.hands[0], state.session)).toBe(false);
    const completedToken = decisionToken(state.currentHand);
    expect(state.nextHand(completedToken)).toBe(true);
    expect(useTableStore.getState().nextHand(completedToken)).toBe(false);
    state = useTableStore.getState();
    expect(state.currentHand?.players[0]).toMatchObject({
      stack: 0,
      startingStack: 0,
      holeCards: [],
      status: 'folded',
    });
    expect(state.currentHand?.players.filter((player) => player.startingStack > 0)).toHaveLength(2);
    expect(state.currentHand?.smallBlindSeat).toBe(state.currentHand?.buttonSeat);
    expect(state.submitHero({ type: 'fold' }, decisionToken(state.currentHand))).toBe(false);
    await useTableStore.persist.rehydrate();
    expect(useTableStore.getState().currentHand?.players[0].startingStack).toBe(0);
    policy.mockImplementation(shoveAction);
    for (let guard = 0; !useTableStore.getState().session?.endedAt && guard < 20; guard += 1) {
      state = useTableStore.getState();
      if (state.currentHand?.result)
        expect(state.nextHand(decisionToken(state.currentHand))).toBe(true);
      else expect(state.fastForward(decisionToken(state.currentHand))).toBe(true);
    }
    state = useTableStore.getState();
    expect(state.session?.endedReason).toBe('winner');
    expect(['bot-1', 'bot-2']).toContain(state.session?.winnerId);
    expect(state.session?.eliminations).toHaveLength(2);
    expect(state.session?.eliminations.find((entry) => entry.playerId === 'hero')?.place).toBe(3);
    expect(state.currentHand?.players[0].startingStack).toBe(0);
    expect(state.session?.decisions).toBe(1);
    expect(canRevealHandRecord(state.config, state.hands[0], state.session)).toBe(true);
  });

  it('fast-forwards only opponents and rejects paused, stale and repeated requests', () => {
    vi.spyOn(agents, 'chooseAgentAction').mockImplementation(passiveAction);
    useTableStore.getState().startSession({ playerCount: 6 }, 'fast-forward-boundary');
    const initial = useTableStore.getState().currentHand!;
    const token = decisionToken(initial);
    useTableStore.getState().pause();
    expect(useTableStore.getState().fastForward(token)).toBe(false);
    useTableStore.getState().resume();
    expect(useTableStore.getState().fastForward(token)).toBe(true);
    const heroTurn = useTableStore.getState().currentHand!;
    expect(heroTurn.actorId).toBe('hero');
    expect(heroTurn.board).toEqual([]);
    expect(useTableStore.getState().decisions).toEqual([]);
    expect(useTableStore.getState().fastForward(token)).toBe(false);
    expect(useTableStore.getState().fastForward(decisionToken(heroTurn))).toBe(false);
    expect(useTableStore.getState().currentHand!.events).toEqual(heroTurn.events);
    expect(useTableStore.getState().submitHero({ type: 'fold' }, decisionToken(heroTurn))).toBe(
      true,
    );
    const foldedToken = decisionToken(useTableStore.getState().currentHand);
    expect(useTableStore.getState().fastForward(foldedToken)).toBe(true);
    const finished = useTableStore.getState();
    expect(finished.currentHand?.result).not.toBeNull();
    expect(finished.session?.handsStarted).toBe(1);
    expect(finished.decisions).toHaveLength(1);
    finished.pause();
    expect(useTableStore.getState().nextHand(decisionToken(finished.currentHand))).toBe(false);
    finished.resume();
    expect(useTableStore.getState().nextHand(decisionToken(finished.currentHand))).toBe(true);
    expect(useTableStore.getState().nextHand(decisionToken(finished.currentHand))).toBe(false);
  });

  it('ranks simultaneous busts by entering stacks and migrates a legacy save without rebuys', async () => {
    vi.spyOn(agents, 'chooseAgentAction').mockImplementation(shoveAction);
    useTableStore.getState().startSession({ playerCount: 3 }, 'legacy-elimination');
    useTableStore.setState({ currentHand: riggedHand([10, 100, 20]) });
    const hand = useTableStore.getState().currentHand!;
    expect(
      useTableStore.getState().submitHero({ type: 'raise', amount: 10 }, decisionToken(hand)),
    ).toBe(true);
    expect(
      useTableStore.getState().fastForward(decisionToken(useTableStore.getState().currentHand)),
    ).toBe(true);
    expect(useTableStore.getState().session?.eliminations).toEqual([
      { playerId: 'hero', handNumber: 1, place: 3 },
      { playerId: 'bot-2', handNumber: 1, place: 2 },
    ]);
    const raw = JSON.parse(localStorage.getItem(TABLE_STORAGE_KEY)!);
    delete raw.state.session.winnerId;
    delete raw.state.session.eliminations;
    delete raw.state.session.endedReason;
    raw.state.session.endedAt = null;
    raw.state.config.autoRebuy = true;
    localStorage.setItem(TABLE_STORAGE_KEY, JSON.stringify(raw));
    await useTableStore.persist.rehydrate();
    const restored = useTableStore.getState();
    expect(restored.config.autoRebuy).toBe(false);
    expect(restored.session?.winnerId).toBe('bot-1');
    expect(restored.session?.endedReason).toBe('winner');
    expect(restored.session?.eliminations).toHaveLength(2);
    expect(restored.totals.hands).toBe(1);
    expect(restored.nextHand()).toBe(false);
  });

  it('records a hand that runs out immediately from an all-in blind exactly once', async () => {
    useTableStore.getState().startSession({ playerCount: 2 }, 'instant-blind-runout');
    useTableStore.setState({ currentHand: riggedHand([1, 100]) });
    let state = useTableStore.getState();
    expect(state.submitHero({ type: 'fold' }, decisionToken(state.currentHand))).toBe(true);
    state = useTableStore.getState();
    expect(state.currentHand?.players[0].stack).toBe(0.5);
    const firstToken = decisionToken(state.currentHand);
    expect(state.nextHand(firstToken)).toBe(true);
    state = useTableStore.getState();
    expect(state.currentHand?.handNumber).toBe(2);
    expect(state.currentHand?.result).not.toBeNull();
    expect(state.currentHand?.events.some((event) => event.type === 'action')).toBe(false);
    expect(state.hands).toHaveLength(2);
    expect(state.session).toMatchObject({ handsStarted: 2, handsCompleted: 2, decisions: 1 });
    expect(state.totals.hands).toBe(2);
    expect(state.nextHand(firstToken)).toBe(false);
    await useTableStore.persist.rehydrate();
    expect(useTableStore.getState().hands).toHaveLength(2);
    expect(useTableStore.getState().totals.hands).toBe(2);
    expect(useTableStore.getState().session?.handsCompleted).toBe(2);
  });

  it('leaves an unfinished match without awarding a winner or inventing a completed hand', () => {
    useTableStore.getState().startSession({ playerCount: 3 }, 'leave-match');
    expect(useTableStore.getState().startSession({ playerCount: 2 })).toBe(false);
    useTableStore.getState().endSession();
    const left = useTableStore.getState();
    expect(left.session).toMatchObject({ endedReason: 'left', winnerId: null, handsCompleted: 0 });
    expect(left.hands).toEqual([]);
    expect(left.totals.hands).toBe(0);
    left.resume();
    expect(useTableStore.getState().paused).toBe(true);
    expect(left.fastForward(decisionToken(left.currentHand))).toBe(false);
    expect(left.startSession({ playerCount: 2 })).toBe(true);
    expect(useTableStore.getState().session).toMatchObject({
      endedReason: null,
      winnerId: null,
      eliminations: [],
    });
  });
  it('keeps independent policy randomness reproducible across refresh without passing a deck seed', async () => {
    const spy = vi.spyOn(agents, 'chooseAgentAction');
    useTableStore.getState().startSession({ playerCount: 6 }, 'private-deck-master');
    const original = useTableStore.getState().currentHand!;
    const raw = localStorage.getItem(TABLE_STORAGE_KEY)!;
    expect(useTableStore.getState().session?.policySeed).not.toBe('private-deck-master');
    expect(useTableStore.getState().stepBot(decisionToken(original))).toBe(true);
    const firstCall = spy.mock.calls[0];
    const firstHistory = useTableStore.getState().currentHand!.events;
    expect(Object.keys(firstCall[1]).sort()).toEqual([
      'difficulty',
      'observations',
      'profile',
      'randomValue',
    ]);
    expect(JSON.stringify(firstCall)).not.toContain('private-deck-master');
    reset();
    localStorage.setItem(TABLE_STORAGE_KEY, raw);
    await useTableStore.persist.rehydrate();
    expect(
      useTableStore.getState().stepBot(decisionToken(useTableStore.getState().currentHand)),
    ).toBe(true);
    expect(spy.mock.calls[1][1].randomValue).toBe(firstCall[1].randomValue);
    expect(useTableStore.getState().currentHand!.events).toEqual(firstHistory);
  });
  it('supports two, three and six player tables and records every hero action once', () => {
    for (const playerCount of [2, 3, 6] as const) {
      expect(
        useTableStore.getState().startSession({ playerCount }, `store-format-${playerCount}`),
      ).toBe(true);
      finishHand();
      const state = useTableStore.getState();
      const hand = state.currentHand!;
      expect(hand.players).toHaveLength(playerCount);
      expect(state.decisions).toHaveLength(
        hand.events.filter((event) => event.type === 'action' && event.playerId === 'hero').length,
      );
      expect(state.hands[0].report.totalDecisions).toBe(state.decisions.length);
      expect(state.hands[0].outcome.heroNet).toBe(hand.result!.netResults.hero);
      expect(state.session?.handsCompleted).toBe(1);
      state.endSession();
    }
  });

  it('rejects stale duplicate hero actions even when hero immediately acts on a new street', () => {
    useTableStore.getState().startSession({ playerCount: 2 }, 'duplicate-token');
    const hand = createHand({
      seed: 'hero-bb',
      players: [
        { id: 'hero', name: 'You', stack: 100 },
        { id: 'bot-1', name: 'Bot', stack: 100 },
      ],
      buttonSeat: 1,
      smallBlind: 0.5,
      bigBlind: 1,
    });
    // A big-blind hero checks last preflop and is first to act on the flop.
    const direct = createHand({
      seed: 'hero-bb-2',
      players: hand.config.players,
      buttonSeat: 1,
      smallBlind: 0.5,
      bigBlind: 1,
    });
    const called = applyAction(direct, { type: 'call' });
    useTableStore.setState({ currentHand: called, decisions: [], hands: [] });
    const token = decisionToken(called);
    expect(useTableStore.getState().submitHero({ type: 'check' }, token)).toBe(true);
    expect(useTableStore.getState().currentHand?.actorId).toBe('hero');
    expect(useTableStore.getState().currentHand?.street).toBe('flop');
    expect(useTableStore.getState().submitHero({ type: 'check' }, token)).toBe(false);
    expect(useTableStore.getState().decisions).toHaveLength(1);
  });

  it('pauses bot work and rejects a repeated delayed callback after resuming', () => {
    useTableStore.getState().startSession({ playerCount: 6 }, 'pause-bot');
    const hand = useTableStore.getState().currentHand!;
    const token = decisionToken(hand);
    useTableStore.getState().pause();
    expect(useTableStore.getState().stepBot(token)).toBe(false);
    expect(useTableStore.getState().currentHand?.events.length).toBe(hand.events.length);
    useTableStore.getState().resume();
    expect(useTableStore.getState().stepBot(token)).toBe(true);
    expect(useTableStore.getState().stepBot(token)).toBe(false);
  });

  it('continues beyond retained history, rotates buttons, carries stacks and preserves saved full replay data', async () => {
    useTableStore.getState().startSession({ playerCount: 2, autoRebuy: true }, 'unlimited-hands');
    expect(useTableStore.getState().config.autoRebuy).toBe(false);
    finishHand();
    const first = useTableStore.getState().hands[0];
    const savedId = useTableStore.getState().saveHand(first.id)!;
    useTableStore.getState().updateSavedHand(savedId, {
      notes: 'Review this opening decision',
      tags: ['Preflop', 'Preflop', '  Defense  '],
      marked: true,
    });
    for (let index = 1; index < RECENT_HAND_LIMIT + 5; index += 1) {
      const previous = useTableStore.getState().currentHand!;
      const oldButton = previous.buttonSeat;
      expect(useTableStore.getState().nextHand()).toBe(true);
      const next = useTableStore.getState().currentHand!;
      expect(next.buttonSeat).toBe((oldButton + 1) % 2);
      expect(next.players.map((player) => player.startingStack)).toEqual(
        previous.players.map((player) => player.stack),
      );
      finishHand();
    }
    const state = useTableStore.getState();
    expect(state.hands).toHaveLength(RECENT_HAND_LIMIT);
    expect(state.session?.handsCompleted).toBe(RECENT_HAND_LIMIT + 5);
    expect(state.totals.hands).toBe(RECENT_HAND_LIMIT + 5);
    expect(state.hands.some((hand) => hand.id === first.id)).toBe(false);
    expect(state.savedHands[0]).toMatchObject({
      handId: first.id,
      notes: 'Review this opening decision',
      tags: ['Preflop', 'Defense'],
      marked: true,
    });
    await useTableStore.persist.rehydrate();
    expect(useTableStore.getState().savedHands[0].state.events).toEqual(first.state.events);
    useTableStore.getState().endSession();
    useTableStore.getState().startSession({ playerCount: 2 }, 'another-table');
    expect(useTableStore.getState().totals.hands).toBe(RECENT_HAND_LIMIT + 5);
    expect(useTableStore.getState().session?.handsCompleted).toBe(0);
  });

  it('restores live actor, decisions and paused state without touching legacy progress', async () => {
    localStorage.setItem('feltlab-training-v1', 'original-v1');
    localStorage.setItem('feltlab-generated-v2', 'original-v2');
    useTableStore.getState().startSession({ playerCount: 2 }, 'refresh-live');
    const current = useTableStore.getState().currentHand!;
    useTableStore.getState().submitHero({ type: 'call' }, decisionToken(current));
    useTableStore.getState().pause();
    const original = useTableStore.getState().currentHand!;
    const raw = localStorage.getItem(TABLE_STORAGE_KEY)!;
    reset();
    localStorage.setItem(TABLE_STORAGE_KEY, raw);
    await useTableStore.persist.rehydrate();
    const restored = useTableStore.getState();
    expect(restored.currentHand?.events).toEqual(original.events);
    expect(restored.paused).toBe(true);
    expect(restored.decisions).toHaveLength(1);
    expect(restored.decisions[0].analysis.evLoss).toBeNull();
    restored.clearProgress();
    expect(localStorage.getItem('feltlab-training-v1')).toBe('original-v1');
    expect(localStorage.getItem('feltlab-generated-v2')).toBe('original-v2');
  });

  it('rejects bad history and forged decision metadata while preserving validated config', () => {
    useTableStore.getState().startSession({ playerCount: 2 }, 'malformed-table');
    const hand = useTableStore.getState().currentHand!;
    useTableStore.getState().submitHero({ type: 'call' }, decisionToken(hand));
    const raw = JSON.parse(localStorage.getItem(TABLE_STORAGE_KEY)!).state;
    const valid = sanitizeTableData({
      ...raw,
      decisions: [
        ...raw.decisions,
        { ...raw.decisions[0], id: 'duplicate' },
        { id: 'forged', eventIndex: 1, createdAt: new Date().toISOString() },
      ],
    });
    expect(valid.decisions).toHaveLength(1);
    const recovered = sanitizeTableData({
      ...raw,
      decisions: [],
      totals: { hands: 0, decisions: 0, heroNet: 0 },
    });
    expect(recovered.decisions).toHaveLength(1);
    expect(recovered.decisions[0].createdAt).toBeNull();
    expect(recovered.totals.decisions).toBe(1);
    const broken = sanitizeTableData({
      ...raw,
      currentHand: '{invalid',
      config: { ...raw.config, feedbackTiming: 'instant' },
    });
    expect(broken.currentHand).toBeNull();
    expect(broken.decisions).toEqual([]);
    expect(broken.config.feedbackTiming).toBe('instant');
  });

  it('suppresses spoilers until the configured hand or session boundary', () => {
    useTableStore
      .getState()
      .startSession({ playerCount: 2, feedbackTiming: 'full-hand' }, 'feedback-boundary');
    let state = useTableStore.getState();
    expect(canRevealAnalysis(state.config, state.currentHand, state.session)).toBe(false);
    finishHand();
    state = useTableStore.getState();
    expect(canRevealAnalysis(state.config, state.currentHand, state.session)).toBe(true);
    state.updateConfig({ feedbackTiming: 'session-review' });
    state = useTableStore.getState();
    expect(canRevealAnalysis(state.config, state.currentHand, state.session)).toBe(false);
    expect(canRevealHandRecord(state.config, state.hands[0], state.session)).toBe(false);
    state.endSession();
    state = useTableStore.getState();
    expect(canRevealAnalysis(state.config, state.currentHand, state.session)).toBe(true);
    expect(canRevealHandRecord(state.config, state.hands[0], state.session)).toBe(true);
  });

  it('exports authoritative replay histories and keeps configuration on reset', () => {
    useTableStore
      .getState()
      .startSession({ playerCount: 2, feedbackTiming: 'instant' }, 'export-hand');
    finishHand();
    const data = JSON.parse(useTableStore.getState().exportJSON());
    expect(data.version).toBe(3);
    expect(data.hands[0].state.events).toEqual(useTableStore.getState().hands[0].state.events);
    expect(data.hands[0].state).not.toHaveProperty('deck');
    useTableStore.getState().clearProgress();
    expect(useTableStore.getState().config.feedbackTiming).toBe('instant');
  });

  it('rebuilds each unique decision once when current, recent and notebook history overlap', async () => {
    useTableStore.getState().startSession({ playerCount: 2 }, 'restore-deduplication');
    finishHand();
    const state = useTableStore.getState();
    state.saveHand(state.currentHand!.id);
    const spy = vi.spyOn(analysis, 'analyzeDecision');
    const raw = JSON.parse(localStorage.getItem(TABLE_STORAGE_KEY)!);
    raw.state.decisions = [];
    localStorage.setItem(TABLE_STORAGE_KEY, JSON.stringify(raw));
    await useTableStore.persist.rehydrate();
    const restored = useTableStore.getState();
    expect(spy).toHaveBeenCalledTimes(state.decisions.length);
    expect(restored.decisions[0].createdAt).toBeNull();
    expect(restored.hands[0].decisions[0].createdAt).toBe(state.decisions[0].createdAt);
    expect(restored.savedHands[0].decisions[0].analysis).toEqual(restored.decisions[0].analysis);
  });
});
