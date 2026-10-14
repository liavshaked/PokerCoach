import { describe, expect, it } from 'vitest';
import { createHand, getAgentView, applyAction, getLegalActions } from '../game';
import type { AgentView } from '../game';
import {
  analyzeDecision,
  decisionPotOdds,
  evaluateSpecifiedRiverRange,
  summarizeHand,
} from './index';
import type { HeroDecision } from './types';

const view = (count = 2): AgentView => {
  const state = createHand({
    seed: 'analysis-tests',
    players: Array.from({ length: count }, (_, i) => ({
      id: i ? `bot-${i}` : 'hero',
      name: i ? 'Bot' : 'You',
      stack: 100,
    })),
    smallBlind: 0.5,
    bigBlind: 1,
  });
  return getAgentView(state, state.actorId!);
};
const decision = (information: AgentView): HeroDecision => {
  const snapshot = {
    id: 'decision-1',
    handId: information.table.id,
    eventIndex: information.table.events.length,
    createdAt: '2026-10-13T12:00:00.000Z',
    view: information,
    chosenAction: { type: 'call' as const },
  };
  return { ...snapshot, analysis: analyzeDecision(snapshot) };
};

describe('transparent full-hand analysis', () => {
  it('calculates the calling threshold and caps inaccessible side pots', () => {
    const information = view(3);
    information.playerId = 'hero';
    information.table.actorId = 'hero';
    information.table.players[0].committed = 10;
    information.table.players[1].committed = 100;
    information.table.players[2].committed = 100;
    information.table.pot = 210;
    information.legalActions = [{ type: 'fold' }, { type: 'call', amount: 10 }];
    const odds = decisionPotOdds(information)!;
    expect(odds.eligiblePot).toBe(50);
    expect(odds.requiredEquity).toBeCloseTo(10 / 60);
    expect(odds.currentPot).toBe(210);
    expect(odds.explanation).toContain('not your actual equity');
  });

  it('assigns supported model agreement, no solver labels or invented EV', () => {
    const item = decision(view());
    expect(item.analysis.level).toBe('model');
    expect(item.analysis.scored).toBe(true);
    expect(item.analysis.score).toBeGreaterThanOrEqual(0);
    expect(item.analysis.score).toBeLessThanOrEqual(100);
    expect(item.analysis.evLoss).toBeNull();
    expect(item.analysis.source.category).toBe('model-based');
    expect(item.analysis.assumptions.join(' ')).toContain('not solver');
  });

  it('keeps multi-way postflop and unsupported stack depths unscored with useful explanations', () => {
    let state = createHand({
      seed: 'multiway-analysis',
      players: Array.from({ length: 3 }, (_, i) => ({
        id: i ? `bot-${i}` : 'hero',
        name: `Seat ${i}`,
        stack: 100,
      })),
      smallBlind: 0.5,
      bigBlind: 1,
    });
    while (state.street === 'preflop')
      state = applyAction(state, {
        type: getLegalActions(state).some((action) => action.type === 'check') ? 'check' : 'call',
      });
    const item = decision(getAgentView(state, state.actorId!));
    expect(item.analysis.score).toBeNull();
    expect(item.analysis.grade).toBeNull();
    expect(item.analysis.explanation).toContain('Multi-way');
    const unsupported = view();
    unsupported.table.players.find((player) => player.id === unsupported.playerId)!.startingStack =
      500;
    expect(decision(unsupported).analysis.scored).toBe(false);
  });

  it('cannot let a few simple scored decisions conceal an important unscored choice', () => {
    const supported = decision(view());
    const unsupported = {
      ...supported,
      id: 'unsupported',
      analysis: { ...supported.analysis, scored: false, score: null, grade: null, importance: 4 },
    };
    const report = summarizeHand([
      supported,
      { ...supported, id: 'two' },
      { ...supported, id: 'three' },
      unsupported,
    ]);
    expect(report.coverage).toBe(0.75);
    expect(report.score).toBeNull();
    expect(report.mostImportantDecisionId).toBe('unsupported');
    expect(report.biggestEvLoss).toBeNull();
  });

  it('aggregates only supported scores and returns no number for zero coverage', () => {
    const item = decision(view());
    const report = summarizeHand([item]);
    expect(report.score).toBe(item.analysis.score);
    expect(report.scoreLabel).toBe('Model agreement');
    expect(summarizeHand([]).score).toBeNull();
    expect(
      summarizeHand([
        { ...item, analysis: { ...item.analysis, scored: false, score: null, grade: null } },
      ]).score,
    ).toBeNull();
    expect(report.method).toContain('Outcome is never an input');
  });

  it('integrates exact weighted river enumeration only for an explicitly supplied range', () => {
    const result = evaluateSpecifiedRiverRange(
      [
        { rank: 'A', suit: 'spades' },
        { rank: 'A', suit: 'hearts' },
      ],
      [
        { rank: 'K', suit: 'clubs' },
        { rank: 'Q', suit: 'diamonds' },
        { rank: '7', suit: 'hearts' },
        { rank: '3', suit: 'spades' },
        { rank: '2', suit: 'clubs' },
      ],
      [
        {
          cards: [
            { rank: 'K', suit: 'diamonds' },
            { rank: 'J', suit: 'diamonds' },
          ],
          weight: 3,
        },
        {
          cards: [
            { rank: 'K', suit: 'hearts' },
            { rank: 'K', suit: 'spades' },
          ],
          weight: 1,
        },
      ],
      30,
      10,
    );
    expect(result.equity).toBe(0.75);
    expect(result.callEV).toBe(20);
    expect(result.requiredEquity).toBe(0.25);
    expect(result.source).toContain('supplied range');
  });
});
