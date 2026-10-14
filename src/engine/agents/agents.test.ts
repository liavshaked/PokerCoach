import { describe, expect, it } from 'vitest';
import { applyAction, createHand, getAgentView, getLegalActions } from '../game';
import type { AgentView, GameState } from '../game';
import { seededRandom } from '../generation/random';
import {
  agentProfiles,
  blankObservation,
  chooseAgentAction,
  holdingFeatures,
  observePublicAction,
  policyDistribution,
} from './index';

const hand = (seed = 'policy-test', count = 6) =>
  createHand({
    seed,
    players: Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      name: `Seat ${index}`,
      stack: 100,
    })),
    smallBlind: 0.5,
    bigBlind: 1,
  });
const options = (view: AgentView, profile: (typeof agentProfiles)[number]['id']) =>
  policyDistribution(view, { profile, difficulty: 'advanced' });

describe('honest conditional opponent policies', () => {
  it('gives balanced advanced and expert genuinely different blocker-aware policies', () => {
    let state = hand('expert-blocker-selection', 2);
    state = applyAction(state, { type: 'raise', amount: 3 });
    state = applyAction(state, { type: 'raise', amount: 9 });
    const view = getAgentView(state, state.actorId!);
    view.holeCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: 'J', suit: 'clubs' },
    ];
    const advanced = policyDistribution(view, { profile: 'balanced', difficulty: 'advanced' });
    const expert = policyDistribution(view, { profile: 'balanced', difficulty: 'expert' });
    expect(
      expert.options.find((option) => option.action.type === 'raise')!.probability,
    ).toBeGreaterThan(
      advanced.options.find((option) => option.action.type === 'raise')!.probability,
    );
    expect(expert.reasons.join(' ')).toContain('blocker selection');
  });
  it('creates genuinely different profile distributions rather than changing names', () => {
    const state = hand();
    const view = getAgentView(state, state.actorId!);
    view.holeCards = [
      { rank: 'K', suit: 'clubs' },
      { rank: '9', suit: 'diamonds' },
    ];
    const loose = options(view, 'loose-aggressive');
    const tight = options(view, 'tight-aggressive');
    expect(loose.options.find((option) => option.action.type === 'fold')!.probability).toBeLessThan(
      tight.options.find((option) => option.action.type === 'fold')!.probability,
    );
    view.holeCards = [
      { rank: 'A', suit: 'clubs' },
      { rank: 'A', suit: 'spades' },
    ];
    expect(
      options(view, 'tight-aggressive').options.find((option) => option.action.type === 'raise')!
        .probability,
    ).toBeGreaterThan(
      options(view, 'passive').options.find((option) => option.action.type === 'raise')!
        .probability,
    );
    expect(
      new Set(agentProfiles.map((profile) => JSON.stringify(options(view, profile.id).options)))
        .size,
    ).toBe(6);
  });

  it('cannot change a decision based on unknown cards or future deck order', () => {
    const original = hand();
    const actor = original.actorId!;
    const view = getAgentView(original, actor);
    const changed = structuredClone(original);
    changed.deck.reverse();
    for (const player of changed.players) if (player.id !== actor) player.holeCards.reverse();
    const otherView = getAgentView(changed, actor);
    expect(otherView).toEqual(view);
    const context = {
      profile: 'balanced' as const,
      difficulty: 'expert' as const,
      randomValue: 0.37,
    };
    expect(chooseAgentAction(otherView, context)).toEqual(chooseAgentAction(view, context));
    expect(view.table).not.toHaveProperty('deck');
    expect(view.table).not.toHaveProperty('seed');
    expect(
      view.table.players.every(
        (player) => !('holeCards' in player) && !('revealedCards' in player),
      ),
    ).toBe(true);
    expect(
      view.table.events
        .filter((event) => event.type === 'hole-cards-dealt')
        .every((event) => !('cards' in event)),
    ).toBe(true);
  });

  it('uses card structure, drawing potential and relevant blockers without calling them equity', () => {
    const features = holdingFeatures(
      [
        { rank: 'A', suit: 'hearts' },
        { rank: 'J', suit: 'hearts' },
      ],
      [
        { rank: 'K', suit: 'hearts' },
        { rank: 'Q', suit: 'hearts' },
        { rank: '2', suit: 'clubs' },
      ],
    );
    expect(features.flushDraw).toBe(true);
    expect(features.straightDraw).toBe(true);
    expect(features.strength).toBeGreaterThan(0);
    expect(features).not.toHaveProperty('equity');
  });

  it('adapts only after enough public observations and only in the declared expert policy', () => {
    let state: GameState = hand('adaptation', 2);
    while (state.street !== 'river')
      state = applyAction(state, {
        type: getLegalActions(state).some((action) => action.type === 'check') ? 'check' : 'call',
      });
    const view = getAgentView(state, state.actorId!);
    view.table.board = [
      { rank: 'K', suit: 'hearts' },
      { rank: 'Q', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
      { rank: '4', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
    ];
    view.holeCards = [
      { rank: 'A', suit: 'hearts' },
      { rank: '7', suit: 'clubs' },
    ];
    const other = state.players.find((player) => player.id !== state.actorId)!.id;
    const observed = {
      [other]: { ...blankObservation(), actions: 50, riverBetFaced: 8, riverFolds: 7 },
    };
    const base = policyDistribution(view, {
      profile: 'exploitative',
      difficulty: 'expert',
      observations: {},
    });
    const adapted = policyDistribution(view, {
      profile: 'exploitative',
      difficulty: 'expert',
      observations: observed,
    });
    expect(adapted.adaptation).toContain('eight');
    expect(
      adapted.options.find((option) => option.action.type === 'bet')!.probability,
    ).toBeGreaterThan(base.options.find((option) => option.action.type === 'bet')!.probability);
    expect(
      policyDistribution(view, {
        profile: 'exploitative',
        difficulty: 'intermediate',
        observations: observed,
      }).adaptation,
    ).toBeNull();
    expect(
      policyDistribution(view, {
        profile: 'exploitative',
        difficulty: 'expert',
        observations: { [other]: { ...observed[other], riverBetFaced: 7, riverFolds: 7 } },
      }).adaptation,
    ).toBeNull();
  });

  it('records only public actions, counts entry once and never stores private cards', () => {
    const state = hand();
    const view = getAgentView(state, state.actorId!);
    const first = observePublicAction({}, view, { type: 'call' });
    const second = observePublicAction(first, view, { type: 'raise', amount: 3 });
    expect(second[view.playerId]).toMatchObject({
      actions: 2,
      voluntaryEntries: 1,
      preflopOpportunities: 1,
      raises: 1,
    });
    expect(JSON.stringify(second)).not.toContain('holeCards');
  });

  it('produces legal deterministic actions through complete hands at every format/profile/difficulty', () => {
    for (const count of [2, 3, 6])
      for (const profile of agentProfiles)
        for (const difficulty of ['beginner', 'intermediate', 'advanced', 'expert'] as const) {
          let state = hand(`legal-${count}-${profile.id}-${difficulty}`, count);
          let actions = 0;
          while (!state.result) {
            const view = getAgentView(state, state.actorId!);
            const context = {
              profile: profile.id,
              difficulty,
              randomValue: seededRandom(
                `independent-policy-test:${state.events.length}:${state.actorId}`,
              )(),
            };
            const action = chooseAgentAction(view, context);
            expect(chooseAgentAction(view, context)).toEqual(action);
            state = applyAction(state, action);
            expect(++actions).toBeLessThan(150);
          }
          expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBeCloseTo(
            count * 100,
            8,
          );
        }
  });
});
