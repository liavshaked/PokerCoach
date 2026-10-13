import type {
  Card,
  Difficulty,
  OpponentProfileId,
  Scenario,
  WeightedCombo,
} from '../../types/poker';
import { createDeck } from '../cards';
import { evaluateHand, riverEquity } from '../equity';
import { callEV } from '../math';
import { getOpponentProfile } from '../ranges';
import { potOdds } from '../rules';
import { finalizeScenario, option, postflopHistory } from './common';
import { shuffled } from './random';
/** Public board only: the model cannot peek at hero's holding. The strongest
 * and weakest of 48 sampled holdings form a deliberately finite polar model. */
export function modeledRiverRange(
  board: readonly Card[],
  profileId: OpponentProfileId,
  potBeforeBet: number,
  bet: number,
  random: () => number,
): WeightedCombo[] {
  const deck = createDeck(board),
    keys = new Set<string>(),
    sample: { cards: [Card, Card]; hand: ReturnType<typeof evaluateHand> }[] = [];
  let attempts = 0;
  while (sample.length < 48 && attempts++ < 1000) {
    const first = Math.floor(random() * deck.length),
      second = Math.floor(random() * deck.length);
    if (first === second) continue;
    const key = [first, second].sort((a, b) => a - b).join(':');
    if (keys.has(key)) continue;
    keys.add(key);
    const cards: [Card, Card] = [deck[first], deck[second]];
    sample.push({ cards, hand: evaluateHand([...cards, ...board]) });
  }
  if (sample.length < 48) throw new Error('Could not build the bounded public range.');
  sample.sort((a, b) => a.hand.compare(b.hand));
  const profile = getOpponentProfile(profileId),
    value = sample.slice(0, 16),
    bluffs = sample.slice(-16);
  // Polar indifference: bluff/value weight ratio = bet/(potBeforeBet+bet).
  const bluffWeight = (bet / (potBeforeBet + bet)) * profile.bluffMultiplier;
  const range = [
    ...value.map((item) => ({ cards: item.cards, weight: 1 })),
    ...bluffs.map((item) => ({ cards: item.cards, weight: bluffWeight })),
  ];
  if (profileId === 'recreational')
    range.push(...sample.slice(16, 32).map((item) => ({ cards: item.cards, weight: 0.6 })));
  return range;
}
export function generateRiver(
  seed: string,
  id: string,
  profileId: OpponentProfileId,
  difficulty: Difficulty,
  random: () => number,
): Scenario {
  const deck = shuffled(createDeck(), random),
    board = deck.slice(0, 5),
    heroCards = deck.slice(5, 7),
    heroPosition = random() < 0.5 ? 'BTN' : 'BB';
  let scenario = finalizeScenario({
    id,
    title: 'The river decision',
    description:
      'A river bet closes the action if you call. Compare the price with the stated finite opponent range.',
    difficulty,
    street: 'river',
    heroPosition,
    heroCards,
    board,
    history: postflopHistory('river', heroPosition, random, 'bet', difficulty),
    legalActions: [],
    prompt: 'Call or fold against this modeled river range?',
    hint: 'The bet is already included in the displayed pot. Ties return half the final pot.',
    principle: 'A river call earns money only when its weighted equity clears the price.',
    reasoning: '',
    deepDive: '',
    tags: ['river-bluff-catching', 'pot-odds'],
    source: {
      category: 'mathematical-model',
      label: 'Exact river model',
      description:
        'Exact weighted showdown calculation against a finite authored range; zero rake and no future actions. Not a GTO solution.',
    },
  });
  const profile = getOpponentProfile(profileId),
    range = modeledRiverRange(board, profileId, scenario.potBeforeAction, scenario.toCall, random),
    result = riverEquity(heroCards, board, range),
    price = potOdds(scenario.toCall, scenario.currentPot),
    ev = callEV(result.equity, scenario.currentPot, scenario.toCall),
    close = Math.abs(ev) <= 0.05;
  const preferred = ev >= 0 ? 'call' : 'fold';
  scenario = {
    ...scenario,
    title: `${profile.label}: river call or fold`,
    legalActions: [
      option(
        'fold',
        preferred === 'fold' ? 'preferred' : close ? 'defensible' : 'mistaken',
        'Folding has 0 BB incremental EV; previous contributions are sunk.',
      ),
      option(
        'call',
        preferred === 'call' ? 'preferred' : close ? 'defensible' : 'mistaken',
        `Against the displayed model, calling has ${ev.toFixed(2)} BB EV relative to folding.`,
        scenario.toCall,
      ),
    ],
    reasoning: `Your hand has ${(result.equity * 100).toFixed(1)}% weighted equity including ties, compared with a ${(price * 100).toFixed(1)}% call threshold. Calling has ${ev >= 0 ? '+' : ''}${ev.toFixed(2)} BB incremental EV; folding has 0 BB.`,
    deepDive: `Equity is calculated exactly over ${result.combos} unblocked combinations from the finite model (${result.blockedCombos} blocked). EV = equity × (${scenario.currentPot} + ${scenario.toCall}) − ${scenario.toCall}. The range uses the strongest and weakest of 48 holdings sampled using only the public board; weights are authored profile assumptions. It is not an estimate of an unknown real opponent's full range. Prior streets are legal but the model does not infer their strategic likelihood.`,
    generated: {
      seed,
      version: 1,
      category: 'river-bluff-catching',
      profile: profileId,
      provenance: 'mathematical-model',
      scored: true,
      range,
      assumptions: [
        '100 BB heads-up, zero rake.',
        'Call ends betting and goes directly to showdown; no raises in this exercise.',
        'Range constructed from the public board only; hero cards are used solely for removal and equity.',
        profile.description,
        'Finite sampled range is a training model, not solver output or a real opponent read.',
      ],
      math: {
        equity: result.equity,
        requiredEquity: price,
        callEv: ev,
        foldEv: 0,
        rangeCombos: result.combos,
        blockedCombos: result.blockedCombos,
        tieProbability: result.tieProbability,
      },
    },
  };
  return scenario;
}
