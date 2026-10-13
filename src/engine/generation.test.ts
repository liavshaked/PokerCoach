import { describe, expect, it } from 'vitest';
import type {
  Card,
  Rank,
  Suit,
  WeightedCombo,
  Street,
  ScenarioCategory,
  OpponentProfileId,
  Difficulty,
} from '../types/poker';
import { assertCards, createDeck } from './cards';
import {
  compareHands,
  evaluateHand,
  removeBlockedCombos,
  riverEquity,
  validateRange,
} from './equity';
import { generateScenario, generationOptions } from './generation';
import { seededRandom, shuffled } from './generation/random';
import { modeledRiverRange } from './generation/river';
import { getDecisionOptions, evaluateDecision } from './evaluation';
import { bluffBreakEven, callEV, drawProbability, foldEV } from './math';
import { modeledPreflopRange } from './ranges';
import { replayHistory, validateScenario } from './rules';
const suitMap: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (value: string): Card[] =>
  value.split(' ').map((card) => ({ rank: card[0] as Rank, suit: suitMap[card[1]] }));
const combo = (value: string, weight: number): WeightedCombo => ({
  cards: cards(value) as [Card, Card],
  weight,
});
/** Independent five-card reference used only in tests (lexicographic ranks).
 * The production evaluator is the external MIT pokersolver library. */
function referenceFive(hand: Card[]): number {
  const ranks = hand.map((card) => '23456789TJQKA'.indexOf(card.rank) + 2).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = hand.every((card) => card.suit === hand[0].suit),
    unique = [...new Set(ranks)];
  const straight =
    unique.length === 5
      ? unique[0] - unique[4] === 4
        ? unique[0]
        : unique.join(',') === '14,5,4,3,2'
          ? 5
          : 0
      : 0;
  let category = 0,
    kickers = ranks;
  if (flush && straight) {
    category = 8;
    kickers = [straight];
  } else if (groups[0][1] === 4) {
    category = 7;
    kickers = groups.map((group) => group[0]);
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = 6;
    kickers = groups.map((group) => group[0]);
  } else if (flush) {
    category = 5;
  } else if (straight) {
    category = 4;
    kickers = [straight];
  } else if (groups[0][1] === 3) {
    category = 3;
    kickers = groups.map((group) => group[0]);
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = 2;
    kickers = groups.map((group) => group[0]);
  } else if (groups[0][1] === 2) {
    category = 1;
    kickers = groups.map((group) => group[0]);
  }
  return [category, ...kickers, ...Array(5 - kickers.length).fill(0)].reduce(
    (value, rank) => value * 15 + rank,
    0,
  );
}
function referenceSeven(hand: Card[]): number {
  let best = 0;
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      best = Math.max(best, referenceFive(hand.filter((_, index) => index !== a && index !== b)));
  return best;
}
describe('browser hand evaluator and exact weighted river equity', () => {
  it.each([
    ['As Ks Qs Js Ts 2c 3d', '9h 9d 9c 9s Ah 2c 3d', -1],
    ['Ac 2d 3h 4s 5c Kh Qd', '2c 3d 4h 5s 6c Ah Kd', 1],
    ['Ah Ad Ac Kd Kh 2s 3s', 'As Ad Ac Qd Qh 2s 3s', -1],
    ['As Ks 9s 6s 2s Qd Jc', 'Ah Kh 9h 5h 4h Qd Jc', -1],
    ['As Ad Kc Qc Jh 3d 2s', 'Ah Ac Kd Qd Js 8c 4h', 0],
    ['2c 3d As Ks Qs Js Ts', '8h 8d As Ks Qs Js Ts', 0],
  ])('ranks best five with kickers (%s)', (first, second, result) => {
    expect(compareHands(cards(first), cards(second))).toBe(result);
  });
  it('matches an independent best-of-21 five-card reference on 250 random deals', () => {
    const random = seededRandom('independent-reference');
    for (let i = 0; i < 250; i++) {
      const deck = shuffled(createDeck(), random),
        first = deck.slice(0, 7),
        second = deck.slice(7, 14);
      expect(Math.sign(compareHands(first, second))).toBe(
        -Math.sign(referenceSeven(first) - referenceSeven(second)),
      );
    }
  });
  it('counts weights, ties and card removal exactly', () => {
    const hero = cards('As Ah'),
      board = cards('Kc 7d 4h 2c 9s');
    const range = [combo('Ac Ad', 1), combo('Kd Kh', 1), combo('Qc Qd', 2), combo('As Qs', 100)];
    const result = riverEquity(hero, board, range);
    expect(result.equity).toBe(0.625);
    expect(result.tieProbability).toBe(0.25);
    expect(result.blockedCombos).toBe(1);
    expect(result.totalWeight).toBe(4);
    expect(riverEquity(hero, board, range, cards('Qc')).equity).toBe(0.25);
  });
  it('gives every player half the pot when the board plays', () => {
    expect(
      riverEquity(cards('2d 3c'), cards('As Ks Qs Js Ts'), [combo('Ah Ad', 3), combo('9c 9h', 7)])
        .equity,
    ).toBe(0.5);
  });
  it('rejects duplicate, malformed and entirely blocked ranges', () => {
    expect(validateRange([combo('As Ah', 1), combo('Ah As', 2)])).toBe(false);
    expect(validateRange([combo('As As', 1)])).toBe(false);
    expect(validateRange(null)).toBe(false);
    expect(validateRange([{ cards: null, weight: 1 }])).toBe(false);
    expect(() => riverEquity(cards('As Ah'), cards('Kc 7d 4h 2c 9s'), [combo('As Qs', 1)])).toThrow(
      /unblocked/,
    );
    expect(() => evaluateHand(cards('As As Kc Qd Jh'))).toThrow(/Duplicate/);
    expect(() => removeBlockedCombos([combo('Ac Ad', -1)], [])).toThrow();
  });
  it('constructs public river ranges independently of hero hidden cards', () => {
    const board = cards('Kc 7d 4h 2c 9s');
    const range = modeledRiverRange(board, 'balanced', 10, 5, seededRandom('public-policy'));
    expect(range).toEqual(
      modeledRiverRange(board, 'balanced', 10, 5, seededRandom('public-policy')),
    );
    expect(riverEquity(cards('As Ah'), board, range).equity).not.toBe(
      riverEquity(cards('3d 6h'), board, range).equity,
    );
  });
});
describe('mathematical training values', () => {
  it('computes incremental call/fold EV including split pots', () => {
    expect(callEV(0.25, 15, 5)).toBe(0);
    expect(callEV(0.5, 15, 5)).toBe(5);
    expect(callEV(0, 15, 5)).toBe(-5);
    expect(foldEV()).toBe(0);
  });
  it('computes one- and two-card draw chances without replacement', () => {
    expect(drawProbability(9, 47)).toBeCloseTo(9 / 47, 12);
    expect(drawProbability(9, 47, 2)).toBeCloseTo(1 - (38 / 47) * (37 / 46), 12);
    expect(drawProbability(8, 46)).toBeCloseTo(8 / 46, 12);
    expect(drawProbability(4, 46)).toBeCloseTo(4 / 46, 12);
    expect(bluffBreakEven(5, 10)).toBeCloseTo(1 / 3, 12);
  });
  it('rejects invalid numeric model inputs', () => {
    for (const equity of [NaN, -0.1, 1.1, Infinity]) expect(() => callEV(equity, 10, 5)).toThrow();
    expect(() => drawProbability(48, 47)).toThrow();
    expect(() => drawProbability(2.5, 47)).toThrow();
    expect(() => bluffBreakEven(-1, 10)).toThrow();
  });
  it('uses separate answers for math and excludes heuristic choices from math scoring', () => {
    const drill = generateScenario({
      seed: 'math-answer',
      category: 'drawing-odds',
      street: 'flop',
    });
    expect(getDecisionOptions(drill)).toEqual(drill.exercise?.answers);
    const correct = getDecisionOptions(drill).find((answer) => answer.grade === 'preferred')!;
    expect(evaluateDecision(drill, correct.id).scored).toBe(true);
    expect(() => evaluateDecision(drill, 'fold')).toThrow();
    const heuristic = generateScenario({ seed: 'preflop-answer', street: 'preflop' });
    expect(evaluateDecision(heuristic, heuristic.legalActions[0].id).scored).toBe(false);
    expect(heuristic.generated?.provenance).toBe('heuristic');
  });
});
describe('seeded scenario generation and runtime boundaries', () => {
  it('validates 10,000 seeded scenarios across all types and profiles and deterministically reproduces each', () => {
    const types: [Street, ScenarioCategory][] = [
      ['preflop', 'blind-defense'],
      ['preflop', 'facing-three-bet'],
      ['flop', 'pot-odds'],
      ['flop', 'drawing-odds'],
      ['turn', 'pot-odds'],
      ['turn', 'drawing-odds'],
      ['river', 'river-bluff-catching'],
      ['river', 'bluff-math'],
      ['preflop', 'pot-odds'],
      ['river', 'pot-odds'],
    ];
    const profiles: OpponentProfileId[] = ['balanced', 'tight', 'aggressive', 'recreational'];
    const fingerprints = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const [street, category] = types[i % types.length],
        options = {
          seed: `property-${i}`,
          street,
          category,
          profile: profiles[Math.floor(i / types.length) % 4],
          difficulty: (['beginner', 'intermediate', 'advanced'] as Difficulty[])[
            Math.floor(i / (types.length * 4)) % 3
          ],
        };
      const scenario = generateScenario(options),
        repeated = generateScenario(generationOptions(scenario)!);
      expect(repeated).toEqual(scenario);
      expect(validateScenario(scenario), scenario.id).toEqual({ valid: true, errors: [] });
      assertCards([...scenario.heroCards, ...scenario.board]);
      expect(scenario.currentPot + scenario.stacks.hero + scenario.stacks.opponent).toBeCloseTo(
        200,
        10,
      );
      expect(replayHistory(scenario).nextActor).toBe('hero');
      expect(getDecisionOptions(scenario).some((answer) => answer.grade === 'preferred')).toBe(
        true,
      );
      fingerprints.add(
        JSON.stringify([scenario.heroCards, scenario.board, scenario.currentPot, scenario.toCall]),
      );
      if (category === 'river-bluff-catching')
        expect(scenario.generated?.math?.callEv).toBeCloseTo(
          callEV(scenario.generated!.math!.equity!, scenario.currentPot, scenario.toCall),
          10,
        );
    }
    expect(fingerprints.size).toBeGreaterThan(9000);
  }, 180000);
  it('reproduces options originally generated with omitted filters', () => {
    for (let i = 0; i < 30; i++) {
      const scenario = generateScenario({ seed: `automatic-${i}` });
      expect(generateScenario(generationOptions(scenario)!)).toEqual(scenario);
    }
  });
  it('rejects unsupported strategies and malformed input instead of inventing a solver answer', () => {
    expect(() =>
      generateScenario({ seed: 'bad', street: 'flop', category: 'blind-defense' }),
    ).toThrow(/does not support/);
    expect(() => generateScenario({ seed: 'bad', category: 'solver' as ScenarioCategory })).toThrow(
      /Unsupported/,
    );
    expect(() => generateScenario({ seed: '' })).toThrow(/Seed/);
    for (const input of [null, undefined, {}, [], { heroCards: null }, { source: null }])
      expect(validateScenario(input).valid).toBe(false);
    const valid = generateScenario({ seed: 'runtime-invalid', street: 'preflop' });
    for (const partial of [
      { board: null },
      { heroCards: [null, null] },
      { history: [null] },
      {
        source: { category: 'solver-verified', label: 'Solver', description: 'Unsupported claim' },
      },
      { legalActions: [null] },
      { street: 'showdown' },
      { generated: {} },
    ])
      expect(validateScenario({ ...valid, ...partial }).valid).toBe(false);
  });
  it('uses distinct, properly blocked heads-up profile ranges', () => {
    const tight = modeledPreflopRange('tight', 'open'),
      wide = modeledPreflopRange('aggressive', 'open');
    expect(tight.length).toBeLessThan(wide.length);
    const blocked = modeledPreflopRange('balanced', 'open', cards('As Ah'));
    expect(
      blocked.every((item) =>
        item.cards.every(
          (card) => !(card.rank === 'A' && (card.suit === 'spades' || card.suit === 'hearts')),
        ),
      ),
    ).toBe(true);
  });
});
