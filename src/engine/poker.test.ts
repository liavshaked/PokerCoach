import { describe, expect, it } from 'vitest';
import { scenarios } from '../data/scenarios';
import type { HistoryAction, Scenario } from '../types/poker';
import { potOdds, replayHistory, validateScenario } from './rules';
import { evaluateDecision } from './evaluation';
import {
  CuratedOpponentStrategy,
  sampleVerifiedAction,
  toPublicGameState,
  type VerifiedActionDistribution,
} from './strategies';

/** Independent example: BB has paid 1; BTN raises its 0.5 blind to 2.5. */
function blindDefense(): Scenario {
  return {
    id: 'test-blind-defense',
    title: 'Blind defense',
    description: 'The button opens to 2.5 BB.',
    difficulty: 'beginner',
    street: 'preflop',
    heroPosition: 'BB',
    opponentPosition: 'BTN',
    blinds: { small: 0.5, big: 1 },
    heroCards: [
      { rank: 'A', suit: 'spades' },
      { rank: 'Q', suit: 'diamonds' },
    ],
    board: [],
    startingStacks: { hero: 100, opponent: 100 },
    stacks: { hero: 99, opponent: 97.5 },
    potBeforeAction: 1.5,
    currentPot: 3.5,
    toCall: 1.5,
    opponentAction: { kind: 'raise', amount: 2.5, label: 'Raises to 2.5 BB' },
    legalActions: [
      {
        id: 'fold',
        kind: 'fold',
        label: 'Fold',
        grade: 'mistaken',
        explanation: 'This strong holding has playable alternatives.',
      },
      {
        id: 'call',
        kind: 'call',
        amount: 1.5,
        label: 'Call 1.5 BB',
        grade: 'defensible',
        explanation: 'Calling preserves the opponent’s weaker hands.',
      },
      {
        id: 'raise',
        kind: 'raise',
        amount: 8,
        label: 'Raise to 8 BB',
        grade: 'preferred',
        explanation: 'A value three-bet is favored under this illustrative open range.',
      },
    ],
    history: [
      { actor: 'opponent', street: 'preflop', kind: 'post', amount: 0.5 },
      { actor: 'hero', street: 'preflop', kind: 'post', amount: 1 },
      { actor: 'opponent', street: 'preflop', kind: 'raise', amount: 2.5 },
    ],
    prompt: 'Choose an action.',
    hint: 'Consider the price and position.',
    principle: 'Count the chips already contributed.',
    reasoning: 'This is an illustrative range assumption, not measured equilibrium output.',
    deepDive: 'Pot odds give the price; they do not establish actual hand equity.',
    tags: ['preflop defense'],
    source: {
      category: 'illustrative',
      label: 'Illustrative / heuristic',
      description: 'A test fixture with qualitative coaching, without solver data.',
    },
  };
}

function riverDecision(): Scenario {
  const spot = blindDefense();
  return {
    ...spot,
    id: 'test-river-price',
    street: 'river',
    board: [
      { rank: 'Q', suit: 'clubs' },
      { rank: '8', suit: 'hearts' },
      { rank: '4', suit: 'spades' },
      { rank: '2', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
    ],
    stacks: { hero: 95.5, opponent: 89.5 },
    potBeforeAction: 9,
    currentPot: 15,
    toCall: 6,
    opponentAction: { kind: 'bet', amount: 6, label: 'Bets 6 BB' },
    legalActions: [
      { ...spot.legalActions[0] },
      { ...spot.legalActions[1], amount: 6, label: 'Call 6 BB', grade: 'preferred' },
    ],
    history: [
      ...spot.history,
      { actor: 'hero', street: 'preflop', kind: 'call', amount: 1.5 },
      { actor: 'hero', street: 'flop', kind: 'check' },
      { actor: 'opponent', street: 'flop', kind: 'bet', amount: 2 },
      { actor: 'hero', street: 'flop', kind: 'call', amount: 2 },
      { actor: 'hero', street: 'turn', kind: 'check' },
      { actor: 'opponent', street: 'turn', kind: 'check' },
      { actor: 'hero', street: 'river', kind: 'check' },
      { actor: 'opponent', street: 'river', kind: 'bet', amount: 6 },
    ],
  };
}

function append(spot: Scenario, action: HistoryAction): Scenario {
  return { ...spot, history: [...spot.history, action] };
}

function facingAllIn(): Scenario {
  const spot = blindDefense();
  return {
    ...spot,
    id: 'test-matched-all-in',
    heroPosition: 'BTN',
    opponentPosition: 'BB',
    heroCards: [
      { rank: 'A', suit: 'spades' },
      { rank: 'A', suit: 'hearts' },
    ],
    stacks: { hero: 97.5, opponent: 0 },
    currentPot: 102.5,
    potBeforeAction: 3.5,
    toCall: 97.5,
    opponentAction: { kind: 'raise', amount: 100, label: 'Raises all-in to 100 BB' },
    legalActions: [
      { ...spot.legalActions[0] },
      { ...spot.legalActions[1], amount: 97.5, label: 'Call 97.5 BB', grade: 'preferred' },
    ],
    history: [
      { actor: 'hero', street: 'preflop', kind: 'post', amount: 0.5 },
      { actor: 'opponent', street: 'preflop', kind: 'post', amount: 1 },
      { actor: 'hero', street: 'preflop', kind: 'raise', amount: 2.5 },
      { actor: 'opponent', street: 'preflop', kind: 'raise', amount: 100 },
    ],
  };
}

describe('independent pot accounting and pricing examples', () => {
  it('counts the posted blind toward a raise and call', () => {
    expect(validateScenario(blindDefense())).toEqual({ valid: true, errors: [] });
    expect(potOdds(1.5, 3.5)).toBeCloseTo(0.3, 12);
  });

  it('replays a real four-street line with no extra chips on checks', () => {
    expect(validateScenario(riverDecision())).toEqual({ valid: true, errors: [] });
    expect(potOdds(6, 15)).toBeCloseTo(2 / 7, 12);
  });

  it('replays a three-bet to 8 and call as a 16 BB pot with 92 BB behind each', () => {
    const spot = blindDefense();
    spot.history.push(
      { actor: 'hero', street: 'preflop', kind: 'raise', amount: 8 },
      { actor: 'opponent', street: 'preflop', kind: 'call', amount: 5.5 },
    );
    const state = replayHistory(spot);
    expect(state.pot).toBe(16);
    expect(state.stacks).toEqual({ hero: 92, opponent: 92 });
    expect(state.contributions).toEqual({ hero: 8, opponent: 8 });
    expect(state.pending).toEqual([]);
  });

  it('supports a fully covered all-in call and conserves all 200 BB', () => {
    const spot = facingAllIn();
    expect(validateScenario(spot)).toEqual({ valid: true, errors: [] });
    const state = replayHistory(
      append(spot, { actor: 'hero', street: 'preflop', kind: 'call', amount: 97.5 }),
    );
    expect(state.pot).toBe(200);
    expect(state.stacks).toEqual({ hero: 0, opponent: 0 });
    expect(state.pending).toEqual([]);
    expect(potOdds(97.5, 102.5)).toBe(0.4875);
  });

  it.each([
    [5, 15, 0.25],
    [10, 20, 1 / 3],
    [2, 8, 0.2],
    [0, 10, 0],
  ])('prices a %s BB call into a %s BB current pot', (call, currentPot, expected) => {
    expect(potOdds(call, currentPot)).toBeCloseTo(expected, 12);
  });

  it.each([
    [-1, 10],
    [1, -1],
    [Number.NaN, 10],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects invalid pot-odds inputs (%s, %s)', (call, currentPot) => {
    expect(() => potOdds(call, currentPot)).toThrow();
  });

  it('rejects a displayed pot that double counts the small blind', () => {
    expect(validateScenario({ ...blindDefense(), currentPot: 4 }).valid).toBe(false);
  });

  it('rejects a remaining stack inconsistent with the history', () => {
    expect(
      validateScenario({ ...blindDefense(), stacks: { hero: 100, opponent: 97.5 } }).valid,
    ).toBe(false);
  });

  it('rejects an incorrect call amount even when the pot is correct', () => {
    expect(validateScenario({ ...blindDefense(), toCall: 2.5 }).valid).toBe(false);
  });
});

describe('heads-up legal action order and raise convention', () => {
  it('requires the button/small blind to act first preflop', () => {
    const spot = blindDefense();
    spot.history[2] = { actor: 'hero', street: 'preflop', kind: 'raise', amount: 2.5 };
    expect(() => replayHistory(spot)).toThrow();
  });

  it('requires the big blind to act first on a new postflop street', () => {
    const spot = riverDecision();
    spot.history[4] = { actor: 'opponent', street: 'flop', kind: 'check' };
    expect(() => replayHistory(spot)).toThrow();
  });

  it('rejects checking while facing an outstanding bet', () => {
    expect(() =>
      replayHistory(append(blindDefense(), { actor: 'hero', street: 'preflop', kind: 'check' })),
    ).toThrow();
  });

  it('rejects a new street before the prior bet is matched', () => {
    expect(() =>
      replayHistory(append(blindDefense(), { actor: 'hero', street: 'flop', kind: 'check' })),
    ).toThrow();
  });

  it('rejects skipping directly from preflop to turn', () => {
    const spot = blindDefense();
    spot.history.push(
      { actor: 'hero', street: 'preflop', kind: 'call', amount: 1.5 },
      { actor: 'hero', street: 'turn', kind: 'check' },
    );
    expect(() => replayHistory(spot)).toThrow();
  });

  it('rejects acting twice in succession', () => {
    expect(() =>
      replayHistory(
        append(blindDefense(), { actor: 'opponent', street: 'preflop', kind: 'raise', amount: 8 }),
      ),
    ).toThrow();
  });

  it('accepts a minimum raise-to 4 after the 1.5 BB opening raise increment', () => {
    const spot = blindDefense();
    spot.legalActions[2] = { ...spot.legalActions[2], amount: 4, label: 'Raise to 4 BB' };
    expect(validateScenario(spot).valid).toBe(true);
  });

  it('rejects raise-to 3.5 after an opening raise-to 2.5', () => {
    const spot = blindDefense();
    spot.legalActions[2] = { ...spot.legalActions[2], amount: 3.5, label: 'Raise to 3.5 BB' };
    expect(validateScenario(spot).valid).toBe(false);
    expect(() =>
      replayHistory(
        append(blindDefense(), { actor: 'hero', street: 'preflop', kind: 'raise', amount: 3.5 }),
      ),
    ).toThrow();
  });

  it('requires a full 5.5 BB increment after the three-bet from 2.5 to 8', () => {
    const threeBet = append(blindDefense(), {
      actor: 'hero',
      street: 'preflop',
      kind: 'raise',
      amount: 8,
    });
    expect(() =>
      replayHistory(
        append(threeBet, { actor: 'opponent', street: 'preflop', kind: 'raise', amount: 13 }),
      ),
    ).toThrow();
    const state = replayHistory(
      append(threeBet, { actor: 'opponent', street: 'preflop', kind: 'raise', amount: 13.5 }),
    );
    expect(state.pot).toBe(21.5);
    expect(state.lastFullRaise).toBe(5.5);
    expect(state.currentBet - state.contributions.hero).toBe(5.5);
  });

  it('rejects call amounts that add the entire raise-to instead of the difference', () => {
    expect(() =>
      replayHistory(
        append(blindDefense(), { actor: 'hero', street: 'preflop', kind: 'call', amount: 2.5 }),
      ),
    ).toThrow();
  });

  it('does not offer check when a call is due', () => {
    const spot = blindDefense();
    spot.legalActions.push({
      id: 'check',
      kind: 'check',
      label: 'Check',
      grade: 'mistaken',
      explanation: 'Invalid test action.',
    });
    expect(validateScenario(spot).valid).toBe(false);
  });

  it('does not offer an uncovered raise against an all-in opponent', () => {
    const spot = facingAllIn();
    spot.legalActions.push({
      id: 'over-raise',
      kind: 'raise',
      amount: 200,
      label: 'Raise to 200 BB',
      grade: 'mistaken',
      explanation: 'Unsupported test action.',
    });
    expect(validateScenario(spot).valid).toBe(false);
  });

  it('does not accept a further betting decision after a matched all-in call', () => {
    const called = append(facingAllIn(), {
      actor: 'hero',
      street: 'preflop',
      kind: 'call',
      amount: 97.5,
    });
    expect(() =>
      replayHistory(append(called, { actor: 'opponent', street: 'flop', kind: 'check' })),
    ).toThrow();
  });
});

describe('cards, current street, and training provenance', () => {
  it('rejects repeated hole cards', () => {
    const spot = blindDefense();
    spot.heroCards[1] = { ...spot.heroCards[0] };
    expect(validateScenario(spot).valid).toBe(false);
  });

  it('rejects a hole card repeated on the board', () => {
    const spot = riverDecision();
    spot.board[0] = { ...spot.heroCards[0] };
    expect(validateScenario(spot).valid).toBe(false);
  });

  it('rejects repeated community cards', () => {
    const spot = riverDecision();
    spot.board[1] = { ...spot.board[0] };
    expect(validateScenario(spot).valid).toBe(false);
  });

  it('rejects cards outside the normal 52-card deck at runtime', () => {
    const spot = blindDefense();
    spot.heroCards[0] = { rank: 'Z', suit: 'stars' } as unknown as Scenario['heroCards'][number];
    expect(validateScenario(spot).valid).toBe(false);
  });

  it('requires five community cards at the river', () => {
    const spot = riverDecision();
    spot.board.pop();
    expect(validateScenario(spot).valid).toBe(false);
  });

  it('rejects a current street that disagrees with the latest action', () => {
    expect(validateScenario({ ...riverDecision(), street: 'turn' }).valid).toBe(false);
  });

  it('audits every curated spot and conserves the 200 BB starting chips', () => {
    expect(scenarios).toHaveLength(16);
    expect(new Set(scenarios.map((spot) => spot.id)).size).toBe(scenarios.length);
    for (const spot of scenarios) {
      expect(validateScenario(spot), spot.id).toEqual({ valid: true, errors: [] });
      expect(spot.startingStacks.hero, spot.id).toBe(100);
      expect(spot.startingStacks.opponent, spot.id).toBe(100);
      expect(spot.stacks.hero + spot.stacks.opponent + spot.currentPot, spot.id).toBeCloseTo(
        200,
        12,
      );
      expect(spot.source.category, spot.id).toBe('illustrative');
      expect(spot.source.label, spot.id).toMatch(/illustrative|heuristic/i);
      expect(
        spot.legalActions.some((action) => action.grade === 'preferred'),
        spot.id,
      ).toBe(true);
    }
    expect(new Set(scenarios.map((spot) => spot.street))).toEqual(
      new Set(['preflop', 'flop', 'turn', 'river']),
    );
  });
});

describe('qualitative feedback and opponent information boundary', () => {
  it('returns scenario feedback with the chosen action and exact price', () => {
    const spot = blindDefense();
    const feedback = evaluateDecision(spot, 'call');
    expect(feedback.grade).toBe('defensible');
    expect(feedback.chosenAction.id).toBe('call');
    expect(feedback.recommendedActions.map((action) => action.id)).toEqual(['raise']);
    expect(feedback.potOdds).toBeCloseTo(0.3, 12);
    expect(feedback.explanation).toBe(spot.legalActions[1].explanation);
  });

  it('rejects actions absent from the scenario instead of assigning a fabricated grade', () => {
    expect(() => evaluateDecision(blindDefense(), 'raise-to-1000')).toThrow();
  });

  it('excludes hero hole cards and coaching answers from public opponent input', () => {
    const spot = blindDefense();
    const publicState = toPublicGameState(spot);
    expect(publicState).not.toHaveProperty('heroCards');
    expect(publicState).not.toHaveProperty('legalActions');
    expect(publicState).not.toHaveProperty('reasoning');
    expect(publicState).not.toHaveProperty('hint');
    const changed = {
      ...spot,
      heroCards: [
        { rank: '7', suit: 'clubs' },
        { rank: '2', suit: 'hearts' },
      ],
    } satisfies Scenario;
    expect(toPublicGameState(changed)).toEqual(publicState);
  });

  it('gives the same curated response when only hero private cards change', () => {
    const spot = blindDefense();
    const strategy = new CuratedOpponentStrategy([spot]);
    const changed = {
      ...spot,
      heroCards: [
        { rank: '7', suit: 'clubs' },
        { rank: '2', suit: 'hearts' },
      ],
    } satisfies Scenario;
    expect(strategy.getAction(toPublicGameState(spot), { cards: [] })).toEqual(spot.opponentAction);
    expect(strategy.getAction(toPublicGameState(changed), { cards: [] })).toEqual(
      spot.opponentAction,
    );
  });

  it('rejects a scenario outside the curated opponent registry', () => {
    const spot = blindDefense();
    const strategy = new CuratedOpponentStrategy([spot]);
    expect(() =>
      strategy.getAction({ ...toPublicGameState(spot), scenarioId: 'unknown' }, { cards: [] }),
    ).toThrow();
  });

  it('copies public state so an opponent cannot mutate the training cards or history', () => {
    const spot = riverDecision();
    const publicState = toPublicGameState(spot);
    publicState.board[0].rank = '3';
    publicState.history[0].amount = 99;
    publicState.stacks.hero = 0;
    expect(spot.board[0].rank).toBe('Q');
    expect(spot.history[0].amount).toBe(0.5);
    expect(spot.stacks.hero).toBe(95.5);
  });

  it('does not display a call-equity threshold when checking is free', () => {
    const spot = scenarios.find((scenario) => scenario.toCall === 0)!;
    expect(evaluateDecision(spot, spot.legalActions[0].id).potOdds).toBeNull();
  });
});

/** Synthetic sampling weights test cumulative arithmetic only. They are not
 * recommended poker frequencies or reviewed strategy data. */
function samplingFixture(): VerifiedActionDistribution {
  return {
    source: {
      category: 'expert-reviewed',
      reviewer: 'Synthetic test fixture',
      label: 'Synthetic sampling test',
      description: 'Unit-test-only distribution, not poker strategy.',
      reference: 'unit-test-fixture',
    },
    actions: [
      { action: { kind: 'check', label: 'Check' }, probability: 0.25 },
      { action: { kind: 'bet', amount: 3, label: 'Bet 3 BB' }, probability: 0.75 },
    ],
  };
}

describe('future weighted strategy requires provenance and valid probabilities', () => {
  it.each([
    [0, 'check'],
    [0.249999, 'check'],
    [0.25, 'bet'],
    [0.999999, 'bet'],
  ] as const)('samples the correct cumulative bucket at %s', (draw, expected) => {
    expect(sampleVerifiedAction(samplingFixture(), () => draw).kind).toBe(expected);
  });

  it('never selects an action with zero probability, including at draw zero', () => {
    const distribution = samplingFixture();
    distribution.actions[0].probability = 0;
    distribution.actions[1].probability = 1;
    expect(sampleVerifiedAction(distribution, () => 0).kind).toBe('bet');
  });

  it('rejects illustrative provenance for a frequency distribution', () => {
    const distribution = samplingFixture();
    distribution.source = {
      category: 'illustrative',
      label: 'Heuristic',
      description: 'No reviewed frequencies.',
    } as unknown as VerifiedActionDistribution['source'];
    expect(() => sampleVerifiedAction(distribution)).toThrow();
  });

  it.each(['', '   '])('requires a traceable reference (%j)', (reference) => {
    const distribution = samplingFixture();
    distribution.source.reference = reference;
    expect(() => sampleVerifiedAction(distribution)).toThrow();
  });

  it('requires an identified reviewer for expert-reviewed data', () => {
    const distribution = samplingFixture();
    distribution.source = {
      category: 'expert-reviewed',
      label: 'Test',
      description: 'Test',
      reference: 'unit-test-fixture',
      reviewer: ' ',
    };
    expect(() => sampleVerifiedAction(distribution)).toThrow();
  });

  it('requires an identified solver for solver-verified data', () => {
    const distribution = samplingFixture();
    distribution.source = {
      category: 'solver-verified',
      label: 'Test',
      description: 'Test',
      reference: 'unit-test-fixture',
      solver: ' ',
    };
    expect(() => sampleVerifiedAction(distribution)).toThrow();
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects probability %s',
    (probability) => {
      const distribution = samplingFixture();
      distribution.actions[0].probability = probability;
      expect(() => sampleVerifiedAction(distribution)).toThrow();
    },
  );

  it('rejects frequencies that do not sum to one', () => {
    const distribution = samplingFixture();
    distribution.actions[1].probability = 0.5;
    expect(() => sampleVerifiedAction(distribution)).toThrow();
  });

  it('rejects an empty action distribution', () => {
    expect(() => sampleVerifiedAction({ ...samplingFixture(), actions: [] })).toThrow();
  });

  it.each([-0.1, 1, Number.NaN])('rejects invalid random draw %s', (draw) => {
    expect(() => sampleVerifiedAction(samplingFixture(), () => draw)).toThrow();
  });
});
