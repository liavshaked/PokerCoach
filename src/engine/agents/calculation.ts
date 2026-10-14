import type { Card } from '../../types/poker';
import { assertCards, cardKey, createDeck } from '../cards';
import type { AgentView, PublicGamePlayer } from '../game/types';
import { seededRandom } from '../generation/random';
import { preflopStrength } from '../ranges';
import { sampleHandRank } from './sample-rank';

export interface SituationCalculation {
  /** Expected showdown share under the explicit sampled ranges, never known opponent equity. */
  equity: number;
  /** Monte Carlo sampling uncertainty only; excludes uncertainty about opponent ranges. */
  equityStandardError: number;
  samples: number;
  opponents: number;
  toCall: number;
  eligiblePot: number;
  requiredEquity: number | null;
  equityEdge: number | null;
  effectiveStack: number;
  spr: number;
  inPosition: boolean;
  facingAggression: number;
  assumptions: string[];
  method: 'public-range-monte-carlo-v2';
}

interface WeightedHolding {
  first: number;
  second: number;
  cumulative: number;
}
interface RangeSummary {
  preflopRaises: number;
  preflopCalls: number;
  late: boolean;
  streets: Array<{ board: Card[]; raises: number; calls: number; large: boolean }>;
}
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const logistic = (value: number) => 1 / (1 + Math.exp(-value));
const rankValue = (card: Card) => '23456789TJQKA'.indexOf(card.rank) + 2;
const suitIndex = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
interface PreparedStreet {
  ranks: Uint8Array;
  suits: Uint8Array;
  mask: number;
  high: number;
  pairCount: number;
  length: number;
  raises: number;
  calls: number;
  large: boolean;
}
function prepareStreet(street: RangeSummary['streets'][number]): PreparedStreet {
  const ranks = new Uint8Array(15),
    suits = new Uint8Array(4);
  let mask = 0,
    high = 0;
  for (const card of street.board) {
    const rank = rankValue(card);
    ranks[rank] += 1;
    suits[suitIndex[card.suit]] += 1;
    mask |= 1 << rank;
    high = Math.max(high, rank);
  }
  return {
    ranks,
    suits,
    mask,
    high,
    pairCount: ranks.filter((count) => count >= 2).length,
    length: street.board.length,
    raises: street.raises,
    calls: street.calls,
    large: street.large,
  };
}

function summarizeRange(view: AgentView, player: PublicGamePlayer): RangeSummary {
  const actions = view.table.events.filter(
    (event) => event.type === 'action' && event.playerId === player.id,
  );
  const preflop = actions.filter((event) => event.street === 'preflop');
  return {
    preflopRaises: preflop.filter((event) => event.action?.type === 'raise').length,
    preflopCalls: preflop.filter((event) => event.action?.type === 'call').length,
    late: player.position.startsWith('BTN') || player.position === 'CO',
    streets: (['flop', 'turn', 'river'] as const).flatMap((street, index) => {
      const events = actions.filter((event) => event.street === street);
      const raises = events.filter((event) => ['bet', 'raise'].includes(event.action?.type ?? ''));
      const calls = events.filter((event) => event.action?.type === 'call');
      return raises.length || calls.length
        ? [
            {
              board: view.table.board.slice(0, index + 3),
              raises: raises.length,
              calls: calls.length,
              large: raises.some((event) => (event.paid ?? 0) >= player.startingStack * 0.35),
            },
          ]
        : [];
    }),
  };
}

/** Cheap, authored likelihood features for range weighting, not a hand-ranking or equity evaluator. */
function rangeWeight(
  cards: [Card, Card],
  summary: RangeSummary,
  streets: PreparedStreet[],
): number {
  let weight = 1;
  if (summary.preflopRaises || summary.preflopCalls) {
    const floor = (summary.late ? 23 : 27) + Math.min(3, summary.preflopRaises) * 5;
    weight *= 0.045 + 0.955 * logistic((preflopStrength(cards) - floor) / 5);
  }
  const firstRank = rankValue(cards[0]),
    secondRank = rankValue(cards[1]);
  const firstSuit = suitIndex[cards[0].suit],
    secondSuit = suitIndex[cards[1].suit];
  const ownPair = firstRank === secondRank;
  for (const street of streets) {
    const pairedOwn = street.ranks[firstRank] > 0 || street.ranks[secondRank] > 0;
    const topPair = firstRank === street.high || secondRank === street.high;
    const trips =
      street.ranks[firstRank] + (ownPair ? 2 : 1) >= 3 ||
      street.ranks[secondRank] + (ownPair ? 2 : 1) >= 3;
    const pairCount =
      street.pairCount +
      (street.ranks[firstRank] < 2 && street.ranks[firstRank] + (ownPair ? 2 : 1) >= 2 ? 1 : 0) +
      (!ownPair && street.ranks[secondRank] === 1 ? 1 : 0);
    const firstSuitCount = street.suits[firstSuit] + (firstSuit === secondSuit ? 2 : 1);
    const secondSuitCount = street.suits[secondSuit] + (firstSuit === secondSuit ? 2 : 1);
    const flush =
      firstSuitCount >= 5 || secondSuitCount >= 5 || street.suits.some((count) => count >= 5);
    let mask = street.mask | (1 << firstRank) | (1 << secondRank);
    if (mask & (1 << 14)) mask |= 1 << 1;
    let straight = false;
    let straightDraw = false;
    for (let low = 1; low <= 10; low += 1) {
      const window = (mask >>> low) & 31;
      let count = 0;
      for (let bits = window; bits; bits &= bits - 1) count += 1;
      straight ||= count === 5;
      straightDraw ||= count === 4;
    }
    const draw =
      street.length < 5 && (straightDraw || firstSuitCount === 4 || secondSuitCount === 4);
    const strong = flush || straight || trips || (pairCount >= 2 && pairedOwn);
    const value = strong
      ? 0.95
      : ownPair && firstRank > street.high
        ? 0.75
        : topPair && pairedOwn
          ? 0.68
          : pairedOwn || ownPair
            ? 0.42
            : 0.12;
    if (street.raises) {
      const blocker =
        (firstRank === 14 && street.suits[firstSuit] >= 3) ||
        (secondRank === 14 && street.suits[secondSuit] >= 3);
      const likelihood =
        0.06 +
        0.8 * logistic((value - (street.large ? 0.7 : 0.55)) * 9) +
        (draw ? 0.2 : 0) +
        (blocker ? 0.06 : 0);
      weight *= Math.pow(clamp(likelihood, 0.05, 1), Math.min(street.raises, 2));
    }
    if (street.calls) weight *= clamp(0.12 + value * 0.8 + (draw ? 0.2 : 0), 0.08, 1);
  }
  return Math.max(0.002, weight);
}

function buildRange(deck: Card[], summary: RangeSummary): WeightedHolding[] {
  const range: WeightedHolding[] = [];
  const streets = summary.streets.map(prepareStreet);
  let cumulative = 0;
  for (let first = 0; first < deck.length - 1; first += 1)
    for (let second = first + 1; second < deck.length; second += 1) {
      cumulative += rangeWeight([deck[first], deck[second]], summary, streets);
      range.push({ first, second, cumulative });
    }
  return range;
}

function sampleHolding(
  range: WeightedHolding[],
  used: Set<number>,
  random: () => number,
): [number, number] {
  // Rejection preserves the weighted marginal conditioned on already assigned cards.
  // The exact weighted fallback bounds runtime without silently falling back to a uniform range.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const draw = random() * range.at(-1)!.cumulative;
    let low = 0,
      high = range.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (range[middle].cumulative < draw) low = middle + 1;
      else high = middle;
    }
    const pair = range[low];
    if (!used.has(pair.first) && !used.has(pair.second)) return [pair.first, pair.second];
  }
  let total = 0;
  const allowed = range.map((pair, index) => {
    const weight =
      used.has(pair.first) || used.has(pair.second)
        ? 0
        : pair.cumulative - (range[index - 1]?.cumulative ?? 0);
    total += weight;
    return weight;
  });
  let draw = random() * total;
  for (let index = 0; index < range.length; index += 1) {
    draw -= allowed[index];
    if (draw < 0) return [range[index].first, range[index].second];
  }
  throw new Error('No unblocked opponent holding is available.');
}

interface EquityResult {
  equity: number;
  equityStandardError: number;
  samples: number;
}
const equityCache = new Map<string, EquityResult>();

/** Only actor cards, visible board, public betting and stacks enter this bounded calculation. */
export function estimateSituation(view: AgentView, samples = 128): SituationCalculation {
  assertCards(view.holeCards, 2, 2);
  assertCards([...view.holeCards, ...view.table.board]);
  if (![0, 3, 4, 5].includes(view.table.board.length)) throw new Error('Invalid public board.');
  if (!Number.isInteger(samples) || samples < 32 || samples > 256)
    throw new Error('Use 32–256 equity samples.');
  const hero = view.table.players.find((player) => player.id === view.playerId);
  if (!hero) throw new Error('Missing acting player.');
  const opponents = view.table.players.filter(
    (player) =>
      player.id !== hero.id && player.status !== 'folded' && player.stack + player.committed > 0,
  );
  const toCall = view.legalActions.find((action) => action.type === 'call')?.amount ?? 0;
  const cap = hero.committed + toCall;
  const eligiblePot =
    toCall > 0
      ? view.table.players.reduce((sum, player) => sum + Math.min(player.committed, cap), 0)
      : view.table.pot;
  const requiredEquity = toCall > 0 ? toCall / (eligiblePot + toCall) : null;
  const effectiveStack = Math.min(
    hero.stack,
    Math.max(0, ...opponents.map((player) => player.stack)),
  );
  const distance = (seat: number) =>
    (seat - view.table.buttonSeat + view.table.players.length - 1) % view.table.players.length;
  const inPosition = opponents.every((player) => distance(hero.seat) > distance(player.seat));
  const summaries = opponents.map((player) => summarizeRange(view, player));
  const layers =
    toCall > 0
      ? [
          ...new Set(
            view.table.players.map((player) =>
              Math.min(player.id === hero.id ? cap : player.committed, cap),
            ),
          ),
        ]
          .filter((amount) => amount > 0)
          .sort((a, b) => a - b)
          .map((level, index, levels) => ({
            amount:
              (level - (levels[index - 1] ?? 0)) *
              view.table.players.filter(
                (player) => (player.id === hero.id ? cap : player.committed) >= level,
              ).length,
            contenders: opponents
              .map((player, opponentIndex) =>
                player.stack + player.committed >= level ? opponentIndex : -1,
              )
              .filter((index) => index >= 0),
          }))
      : [{ amount: 1, contenders: opponents.map((_, index) => index) }];
  const key = JSON.stringify([
    view.holeCards.map(cardKey).sort(),
    view.table.board.map(cardKey),
    summaries,
    layers,
    samples,
  ]);
  let result = equityCache.get(key);
  if (!result) {
    // Hold simulation draws constant when only price changes; noisy re-sampling must not reward an expensive call.
    const samplingKey = JSON.stringify([
      view.holeCards.map(cardKey).sort(),
      view.table.board.map(cardKey),
      summaries,
      samples,
    ]);
    let publicHash = 2166136261;
    for (let index = 0; index < samplingKey.length; index += 1)
      publicHash = Math.imul(publicHash ^ samplingKey.charCodeAt(index), 16777619);
    const random = seededRandom(`feltlab-public-equity-v2:${publicHash >>> 0}`);
    const deck = createDeck([...view.holeCards, ...view.table.board]);
    const sharedRanges = new Map<string, WeightedHolding[]>();
    const ranges = summaries.map((summary) => {
      const rangeKey = JSON.stringify(summary);
      if (!sharedRanges.has(rangeKey)) sharedRanges.set(rangeKey, buildRange(deck, summary));
      return sharedRanges.get(rangeKey)!;
    });
    let total = 0,
      squared = 0;
    for (let sample = 0; sample < samples; sample += 1) {
      const used = new Set<number>();
      const holes: Card[][] = Array.from({ length: opponents.length }, () => []);
      // Random order reduces seat-order effects from sequential blocked range conditioning.
      const order = opponents.map((_, index) => index);
      for (let index = order.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [order[index], order[swap]] = [order[swap], order[index]];
      }
      for (const index of order) {
        const pair = sampleHolding(ranges[index], used, random);
        pair.forEach((card) => used.add(card));
        holes[index] = pair.map((card) => deck[card]);
      }
      const runout = [...view.table.board];
      while (runout.length < 5) {
        const card = Math.floor(random() * deck.length);
        if (!used.has(card)) {
          used.add(card);
          runout.push(deck[card]);
        }
      }
      const ownHand = sampleHandRank([...view.holeCards, ...runout]);
      const comparisons = holes.map((cards) =>
        Math.sign(sampleHandRank([...cards, ...runout]) - ownHand),
      );
      const totalPot = layers.reduce((sum, layer) => sum + layer.amount, 0);
      const share =
        layers.reduce((sum, layer) => {
          const lost = layer.contenders.some((index) => comparisons[index] > 0);
          const tied = layer.contenders.filter((index) => comparisons[index] === 0).length;
          return sum + (lost ? 0 : layer.amount / (1 + tied));
        }, 0) / Math.max(totalPot, Number.EPSILON);
      total += share;
      squared += share * share;
    }
    const equity = total / samples;
    result = {
      equity,
      samples,
      equityStandardError: Math.sqrt(
        Math.max(0, squared / samples - equity * equity) / Math.max(1, samples - 1),
      ),
    };
    if (equityCache.size >= 384) equityCache.delete(equityCache.keys().next().value!);
    equityCache.set(key, result);
  }
  return {
    ...result,
    opponents: opponents.length,
    toCall,
    eligiblePot,
    requiredEquity,
    equityEdge: requiredEquity === null ? null : result.equity - requiredEquity,
    effectiveStack,
    spr: effectiveStack / Math.max(view.table.pot, view.table.bigBlind),
    inPosition,
    facingAggression: view.table.events.filter(
      (event) =>
        event.type === 'action' &&
        event.street === view.table.street &&
        event.playerId !== hero.id &&
        ['bet', 'raise'].includes(event.action?.type ?? ''),
    ).length,
    assumptions: [
      `${samples} deterministic showdown samples use only your cards, the visible board and public actions; other holdings and future cards are sampled.`,
      'Opponent ranges use authored preflop entry and postflop value/draw/bluff likelihood weights; these are assumptions, not observed hidden cards or solved ranges.',
      'Multiple opponents are sampled without card collisions, with randomized order. This is a sequential range approximation, not an exact joint posterior.',
      'Call equity weights currently eligible pot layers; opponents able to fund a layer are assumed to contest it. Future calls, folds, betting, rake and tournament payout utility are excluded.',
      'The sampling error describes simulation noise only. Uncertainty about opponent ranges can be substantially larger.',
    ],
    method: 'public-range-monte-carlo-v2',
  };
}
