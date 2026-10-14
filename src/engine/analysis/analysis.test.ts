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
import type { Card } from '../../types/poker';

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

const drawDecision = (): AgentView => {
  const information = view();
  information.table.street = 'flop';
  information.table.board = [
    { rank: 'K', suit: 'hearts' },
    { rank: '9', suit: 'hearts' },
    { rank: '2', suit: 'clubs' },
  ];
  information.holeCards = [
    { rank: 'A', suit: 'hearts' },
    { rank: 'J', suit: 'hearts' },
  ];
  information.table.players[0] = {
    ...information.table.players[0],
    stack: 96,
    committed: 4,
    streetCommitted: 0,
  };
  information.table.players[1] = {
    ...information.table.players[1],
    stack: 92,
    committed: 8,
    streetCommitted: 4,
  };
  information.table.pot = 12;
  information.table.currentBet = 4;
  information.legalActions = [
    { type: 'fold' },
    { type: 'call', amount: 4 },
    { type: 'raise', minAmount: 8, maxAmount: 96 },
  ];
  information.table.events.push({
    index: information.table.events.length,
    street: 'flop',
    type: 'action',
    playerId: 'bot-1',
    action: { type: 'bet', amount: 4 },
    paid: 4,
  });
  return information;
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

  it('explains a draw using the actual cards, calling price, position and an actionable comparison', () => {
    const item = decision(drawDecision());
    expect(item.analysis.coaching?.situation).toContain('A♥ J♥');
    expect(item.analysis.coaching?.situation).toContain('flush draw');
    expect(item.analysis.coaching?.why).toContain('Calling costs 4 chips to contest 16 chips');
    expect(item.analysis.coaching?.why).toContain('25%');
    expect(item.analysis.coaching?.why).toContain('estimated showdown share');
    expect(item.analysis.coaching?.why).toContain('does not guarantee winning');
    expect(item.analysis.coaching?.why).toContain('You act after');
    expect(item.analysis.coaching?.alternative).toMatch(/chips|checking/);
    expect(item.analysis.coaching?.takeaway).toContain('25% price');
    expect(item.analysis.estimatedEquity?.samples).toBeGreaterThanOrEqual(128);
    expect(item.analysis.estimatedEquity?.samplingMargin).toBeGreaterThan(0);
    expect(item.analysis.assumptions.join(' ')).toContain('uncertainty in the opponent range');
  });

  it('describes street-total raises as the actual extra chips risked, rather than spending the same chips twice', () => {
    const information = drawDecision();
    information.table.players[0].streetCommitted = 2;
    information.table.players[0].stack = 94;
    information.table.players[0].committed = 6;
    information.table.pot = 14;
    information.legalActions = [
      { type: 'fold' },
      { type: 'call', amount: 2 },
      { type: 'raise', minAmount: 8, maxAmount: 96 },
    ];
    const snapshot = {
      ...decision(information),
      chosenAction: { type: 'raise' as const, amount: 12 },
    };
    const analysis = analyzeDecision(snapshot);
    expect(analysis.coaching?.why).toContain('raise adds 10 chips and leaves 84 behind');
    expect(analysis.coaching?.alternative).not.toContain(' BB');
  });

  it('teaches the different heads-up positions and excludes eliminated seats from scoring limits', () => {
    const information = view(6);
    information.playerId = 'hero';
    information.table.actorId = 'hero';
    information.table.players[0].position = 'BTN/SB';
    for (const player of information.table.players.slice(2)) {
      player.stack = 0;
      player.startingStack = 0;
      player.committed = 0;
      player.streetCommitted = 0;
      player.status = 'folded';
    }
    const result = decision(information);
    expect(result.analysis.scored).toBe(true);
    expect(result.analysis.coaching?.why).toContain(
      'Heads-up, the button acts first before the flop and last on later streets',
    );
    expect(result.analysis.estimatedEquity?.opponents).toBe(1);
    information.table.players[0].position = 'BB';
    expect(decision(information).analysis.coaching?.why).toContain(
      'big blind acts first after the flop',
    );
  });

  it('keeps a terminal all-in call qualitative and explains that no later payment is needed', () => {
    const information = drawDecision();
    information.table.players[1].status = 'all-in';
    information.table.players[1].stack = 0;
    information.legalActions = [{ type: 'fold' }, { type: 'call', amount: 4 }];
    const result = decision(information);
    expect(result.analysis.score).toBeNull();
    expect(result.analysis.grade).toBeNull();
    expect(result.analysis.coaching?.why).toContain('without another payment from you');
    expect(result.analysis.coaching?.why).not.toContain('can cost more than this call alone');
    expect(result.analysis.coaching?.alternative).not.toContain('Reassess if the price changes');
    expect(result.analysis.coaching?.takeaway).not.toContain('Allow for future bets');
  });

  it('does not score an all-in raise as a supported ordinary sizing choice', () => {
    const snapshot = decision(view());
    const hero = snapshot.view.table.players.find(
      (player) => player.id === snapshot.view.playerId,
    )!;
    snapshot.chosenAction = { type: 'raise', amount: hero.stack + hero.streetCommitted };
    const analysis = analyzeDecision(snapshot);
    expect(analysis.score).toBeNull();
    expect(analysis.grade).toBeNull();
    expect(analysis.coaching?.why).toContain('leaves 0 behind');
  });

  it('produces the same review when hidden opponent cards and future deck cards change', () => {
    const state = createHand({
      seed: 'review-information-boundary',
      players: [
        { id: 'hero', name: 'You', stack: 100 },
        { id: 'bot-1', name: 'Bot', stack: 100 },
      ],
      smallBlind: 0.5,
      bigBlind: 1,
    });
    const before = decision(getAgentView(state, 'hero'));
    const changed = structuredClone(state);
    changed.players[1].holeCards = [...changed.deck.slice(-2)] as Card[];
    changed.deck = [...changed.deck].reverse();
    changed.seed = 'a-future-deck-must-not-be-an-input';
    const after = decision(getAgentView(changed, 'hero'));
    expect(after.analysis).toEqual(before.analysis);
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
    expect(report.improvements?.some((point) => point.decisionId === 'unsupported')).toBe(true);
    expect(report.summary).toContain('reviewed in words');
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
