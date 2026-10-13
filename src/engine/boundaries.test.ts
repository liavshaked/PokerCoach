import { describe, expect, it } from 'vitest';
import { scenarios, scenarioLoadIssues, loadScenarios } from '../data/scenarios';
import { validateScenario } from './rules';
import {
  CuratedOpponentStrategy,
  RangeAwarePreflopAgent,
  toPublicGameState,
  validateVerifiedDistribution,
  sampleVerifiedAction,
  type VerifiedActionDistribution,
} from './strategies';
describe('resilient scenario-pack loading', () => {
  it('keeps the 16 original valid spots without load issues', () => {
    expect(scenarios).toHaveLength(16);
    expect(scenarioLoadIssues).toEqual([]);
  });
  it('recovers the valid entries when shapes and factories fail', () => {
    const result = loadScenarios([
      null,
      () => {
        throw new Error('Broken seed.');
      },
      scenarios[0],
      { ...scenarios[1], board: null },
      scenarios[1],
    ]);
    expect(result.scenarios.map((spot) => spot.id)).toEqual([scenarios[0].id, scenarios[1].id]);
    expect(result.issues.map((issue) => issue.index)).toEqual([0, 1, 3]);
    expect(result.issues[1].errors).toEqual(['Broken seed.']);
  });
  it('returns an empty pack and useful diagnostics when every entry fails', () => {
    const result = loadScenarios([null, {}, { heroCards: [] }]);
    expect(result.scenarios).toEqual([]);
    expect(result.issues).toHaveLength(3);
    expect(loadScenarios(null).issues[0].errors[0]).toMatch(/array/);
  });
  it('does not silently overwrite a duplicate scenario id', () => {
    const result = loadScenarios([scenarios[0], scenarios[0]]);
    expect(result.scenarios).toHaveLength(1);
    expect(result.issues[0].errors).toEqual(['Duplicate scenario id.']);
  });
  it('rejects sparse card arrays rather than throwing in a downstream check', () => {
    const heroCards = Array(2);
    heroCards[1] = scenarios[0].heroCards[1];
    expect(validateScenario({ ...scenarios[0], heroCards }).valid).toBe(false);
  });
});
describe('policy boundaries and imported frequency distributions', () => {
  const fixture = (): VerifiedActionDistribution => ({
    source: {
      category: 'expert-reviewed',
      reviewer: 'Synthetic test only',
      reference: 'test-only',
      label: 'Synthetic fixture',
      description: 'Arithmetic test only, not real strategy.',
    },
    actions: [
      { action: { kind: 'check', label: 'Check' }, probability: 0.5 },
      { action: { kind: 'bet', amount: 3, label: 'Bet 3 BB' }, probability: 0.5 },
    ],
  });
  it.each([
    null,
    {},
    { source: null, actions: null },
    { source: { category: 'mathematical-model' }, actions: [] },
  ])('rejects malformed distribution %#', (value) => {
    expect(validateVerifiedDistribution(value).valid).toBe(false);
  });
  it('rejects invalid action amounts even when weights sum to one', () => {
    const distribution = fixture();
    distribution.actions[1].action.amount = -3;
    expect(validateVerifiedDistribution(distribution).valid).toBe(false);
  });
  it('normalizes machine-tolerance totals without ever sampling a zero-weight tail', () => {
    const distribution = fixture();
    distribution.actions[1].probability = 0.499999999;
    distribution.actions.push({ action: { kind: 'fold', label: 'Fold' }, probability: 0 });
    expect(sampleVerifiedAction(distribution, () => 0.9999999999).kind).toBe('bet');
  });
  it('only picks a supported legal option from an explicit preflop heuristic', () => {
    const scenario = scenarios[0],
      state = toPublicGameState(scenario),
      agent = new RangeAwarePreflopAgent();
    const decision = agent.decide(
      state,
      {
        cards: [
          { rank: 'A', suit: 'hearts' },
          { rank: 'A', suit: 'spades' },
        ],
      },
      {
        profile: 'balanced',
        legalActions: [
          { kind: 'fold', label: 'Fold' },
          { kind: 'call', amount: 1.5, label: 'Call' },
          { kind: 'raise', amount: 8, label: 'Raise' },
        ],
      },
    );
    expect(decision.action.kind).toBe('raise');
    expect(decision.provenance).toBe('heuristic');
    expect(() =>
      agent.decide(
        { ...state, street: 'flop' },
        { cards: scenario.heroCards },
        { profile: 'balanced', legalActions: scenario.legalActions },
      ),
    ).toThrow(/preflop only/);
    const curated = new CuratedOpponentStrategy([scenario]);
    expect(curated.getAction(state, { cards: [] })).toEqual(scenario.opponentAction);
  });
});
