import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createHand, getLegalActions } from '../../engine/game';
import * as agents from '../../engine/agents';
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  reset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('persisted full-hand table sessions', () => {
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

  it('continues beyond retained history, rotates buttons, rebuys and preserves saved full replay data', async () => {
    useTableStore.getState().startSession({ playerCount: 2, autoRebuy: true }, 'unlimited-hands');
    finishHand();
    const first = useTableStore.getState().hands[0];
    const savedId = useTableStore.getState().saveHand(first.id)!;
    useTableStore.getState().updateSavedHand(savedId, {
      notes: 'Review this opening decision',
      tags: ['Preflop', 'Preflop', '  Defense  '],
      marked: true,
    });
    for (let index = 1; index < RECENT_HAND_LIMIT + 5; index += 1) {
      const oldButton = useTableStore.getState().currentHand!.buttonSeat;
      expect(useTableStore.getState().nextHand()).toBe(true);
      const next = useTableStore.getState().currentHand!;
      expect(next.buttonSeat).toBe((oldButton + 1) % 2);
      expect(next.players.every((player) => player.startingStack >= 100)).toBe(true);
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
});
