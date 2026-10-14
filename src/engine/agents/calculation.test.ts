import { describe, expect, it } from 'vitest';
import type { Card, Rank, Suit } from '../../types/poker';
import { createDeck } from '../cards';
import { evaluateHand } from '../equity';
import { createHand, getAgentView } from '../game';
import { seededRandom } from '../generation/random';
import { estimateSituation, policyDistribution } from './index';
import { sampleHandRank } from './sample-rank';

const cards = (value: string): Card[] =>
  value.split(' ').map((key) => ({
    rank: key[0] as Rank,
    suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as Record<string, Suit>)[key[1]],
  }));
function viewFor(own = 'As Qd', board = 'Ac 9d 6s 3h 2c', count = 2) {
  const hand = createHand({
    seed: 'calculation-public-fixture',
    players: Array.from({ length: count }, (_, seat) => ({
      id: `p${seat}`,
      name: `Player ${seat}`,
      stack: 100,
    })),
    smallBlind: 0.5,
    bigBlind: 1,
  });
  const view = getAgentView(hand, hand.actorId!);
  view.holeCards = cards(own);
  view.table.board = board ? cards(board) : [];
  view.table.street = board ? 'river' : 'preflop';
  view.table.events = [];
  view.table.pot = 20;
  for (const player of view.table.players) {
    player.committed = 20 / count;
    player.streetCommitted = 0;
    player.stack = 100 - player.committed;
    player.status = 'active';
  }
  view.table.currentBet = 0;
  view.legalActions = [{ type: 'check' }, { type: 'bet', minAmount: 1, maxAmount: 90 }];
  return view;
}

describe('calculated public-state policy', () => {
  it('differentially validates simulation ranking against pokersolver including wheel, board ties and two trips', () => {
    const fixtures = [
      ['Ac 2d 3s 4h 5c Ks Kd', '2c 3d 4s 5h 6c As Ad'],
      ['Ac Ah As Kc Kh Ks 2d', 'Qc Qh Qs Jc Jh Js 2d'],
      ['As Ks Qs Js Ts 2d 3d', 'As Ks Qs Js Ts 9d 8d'],
      ['2s 4s 8s Js Ks Ac Ad', '3h 5h 9h Jh Kh Qc Qd'],
    ];
    for (const [one, two] of fixtures) {
      const first = cards(one),
        second = cards(two);
      expect(Math.sign(sampleHandRank(second) - sampleHandRank(first))).toBe(
        evaluateHand(first).compare(evaluateHand(second)),
      );
    }
    const random = seededRandom('simulation-rank-independent-check');
    for (let trial = 0; trial < 2000; trial += 1) {
      const deck = createDeck();
      for (let index = deck.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [deck[index], deck[swap]] = [deck[swap], deck[index]];
      }
      const count = 5 + (trial % 3);
      const first = deck.slice(0, count),
        second = deck.slice(count, count * 2);
      expect(Math.sign(sampleHandRank(second) - sampleHandRank(first))).toBe(
        evaluateHand(first).compare(evaluateHand(second)),
      );
    }
  });

  it('finds nut wins and equal board splits, including a six-way shared royal flush', () => {
    expect(estimateSituation(viewFor('As Ks', 'Qs Js Ts 2d 3c')).equity).toBe(1);
    const tied = estimateSituation(viewFor('2d 3c', 'As Ks Qs Js Ts', 6));
    expect(tied.equity).toBeCloseTo(1 / 6, 10);
    expect(tied.opponents).toBe(5);
    expect(tied.samples).toBe(128);
  });

  it('distinguishes weak and strong holdings and accounts for multiple opponents', () => {
    const weak = estimateSituation(viewFor('7s 2d', '', 2));
    const strong = estimateSituation(viewFor('As Ad', '', 2));
    const multiway = estimateSituation(viewFor('As Ad', '', 6));
    expect(strong.equity).toBeGreaterThan(0.7);
    expect(strong.equity).toBeGreaterThan(weak.equity + 0.35);
    expect(multiway.equity).toBeLessThan(strong.equity - 0.1);
  });

  it('keeps the same sample holdings while a worse price reduces calling', () => {
    const cheap = viewFor();
    cheap.legalActions = [{ type: 'fold' }, { type: 'call', amount: 2 }];
    const expensive = structuredClone(cheap);
    expensive.legalActions = [{ type: 'fold' }, { type: 'call', amount: 40 }];
    const low = policyDistribution(cheap, { profile: 'balanced', difficulty: 'advanced' });
    const high = policyDistribution(expensive, { profile: 'balanced', difficulty: 'advanced' });
    expect(low.calculation.equity).toBeCloseTo(high.calculation.equity, 10);
    expect(low.calculation.requiredEquity).toBeLessThan(high.calculation.requiredEquity!);
    expect(
      low.options.find((option) => option.action.type === 'call')!.probability,
    ).toBeGreaterThan(high.options.find((option) => option.action.type === 'call')!.probability);
  });

  it('tightens sampled ranges after visible raises and excludes eliminated seats', () => {
    const loose = viewFor('9h 9s', 'Ac Kd 7s 3h 2c', 3);
    const actor = loose.table.players.find((player) => player.id === loose.playerId)!;
    const opponent = loose.table.players.find((player) => player.id !== loose.playerId)!;
    const tight = structuredClone(loose);
    tight.table.events = [0, 1].map((index) => ({
      index,
      type: 'action',
      street: 'river',
      playerId: opponent.id,
      action: { type: 'raise', amount: 50 + index * 20 },
      paid: 40,
    }));
    expect(estimateSituation(tight, 256).equity).toBeLessThan(estimateSituation(loose, 256).equity);
    const empty = loose.table.players.find(
      (player) => player.id !== actor.id && player.id !== opponent.id,
    )!;
    empty.stack = 0;
    empty.committed = 0;
    expect(estimateSituation(loose).opponents).toBe(1);
  });

  it('prices only eligible pot layers and gives the short stack a fair share of the main pot', () => {
    const view = viewFor('2d 3c', 'As Ks Qs Js Ts', 3);
    const hero = view.table.players.find((player) => player.id === view.playerId)!;
    hero.committed = 10;
    hero.stack = 5;
    for (const opponent of view.table.players.filter((player) => player.id !== hero.id)) {
      opponent.committed = 50;
      opponent.stack = 0;
      opponent.status = 'all-in';
    }
    view.table.pot = 110;
    view.legalActions = [{ type: 'fold' }, { type: 'call', amount: 5 }];
    const result = estimateSituation(view);
    expect(result.eligiblePot).toBe(40);
    expect(result.requiredEquity).toBeCloseTo(5 / 45);
    expect(result.equity).toBeCloseTo(1 / 3);
  });

  it('is deterministic, validates cards and samples, and exposes assumptions separately from uncertainty', () => {
    const view = viewFor();
    expect(estimateSituation(view)).toEqual(estimateSituation(structuredClone(view)));
    expect(estimateSituation(view).assumptions.join(' ')).toContain('simulation noise only');
    expect(estimateSituation(view).equityStandardError).toBeLessThanOrEqual(0.05);
    expect(() => estimateSituation(view, 10000)).toThrow('32–256');
    view.holeCards = cards('As As');
    expect(() => estimateSituation(view)).toThrow('Duplicate');
  });
});
