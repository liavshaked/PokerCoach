import type {
  Card,
  Difficulty,
  MathAnswer,
  MathExercise,
  OpponentProfileId,
  Scenario,
  Street,
} from '../../types/poker';
import { createDeck, ranks, suits } from '../cards';
import { bluffBreakEven, drawProbability } from '../math';
import { potOdds } from '../rules';
import { blindPosts, finalizeScenario, historyAction, option, postflopHistory } from './common';
import { pick, shuffled } from './random';
function answers(
  value: number,
  explanation: string,
  random: () => number,
  difficulty: Difficulty,
): MathAnswer[] {
  const spread = difficulty === 'beginner' ? 0.2 : difficulty === 'advanced' ? 0.04 : 0.12;
  const lower = difficulty === 'beginner' ? 0.15 : difficulty === 'advanced' ? 0.025 : 0.09;
  const distractors = [
    value < 0.7 ? value + spread : value - spread,
    value > lower + 0.02 ? value - lower : value + 0.25,
  ];
  if (difficulty === 'advanced') distractors.push(value < 0.8 ? value + 0.09 : value - 0.09);
  return shuffled(
    [value, ...distractors].map((number, index) => ({
      id: `answer-${index}`,
      label: `${(number * 100).toFixed(1)}%`,
      value: number,
      grade: index === 0 ? ('preferred' as const) : ('mistaken' as const),
      explanation:
        index === 0
          ? explanation
          : `The correct result is ${(value * 100).toFixed(1)}%. ${explanation}`,
    })),
    random,
  );
}
function drawingCards(
  street: 'flop' | 'turn',
  random: () => number,
  difficulty: Difficulty,
): { hero: Card[]; board: Card[]; outs: number; draw: string } {
  const family = pick(
      difficulty === 'beginner'
        ? (['flush'] as const)
        : (['flush', 'open-ended', 'gutshot'] as const),
      random,
    ),
    count = street === 'flop' ? 3 : 4;
  if (family === 'flush') {
    const suit = pick(suits, random),
      suited = shuffled(
        createDeck().filter((card) => card.suit === suit),
        random,
      ),
      other = shuffled(
        createDeck().filter((card) => card.suit !== suit),
        random,
      );
    return {
      hero: suited.slice(0, 2),
      board: [...suited.slice(2, 4), ...other.slice(0, count - 2)],
      outs: 9,
      draw: 'flush',
    };
  }
  const low =
    family === 'open-ended'
      ? pick([1, 2, 3, 4, 5, 6, 7, 8], random)
      : pick([0, 1, 2, 3, 4, 5, 6, 7, 8], random);
  const missing = family === 'gutshot' ? pick([1, 2, 3], random) : -1;
  const indices = Array.from({ length: family === 'open-ended' ? 4 : 5 }, (_, i) => low + i).filter(
    (_, i) => i !== missing,
  );

  const four = shuffled(
    indices.map((i) => ({ rank: ranks[i], suit: pick(suits, random) })),
    random,
  );
  // Paired filler ranks preserve precisely four/eight direct straight outs.
  // Arbitrary extra ranks can silently create a double gutshot or made straight.
  const filler = shuffled(
    createDeck(four).filter((card) => indices.includes(ranks.indexOf(card.rank))),
    random,
  );
  return {
    hero: four.slice(0, 2),
    board: [...four.slice(2), ...filler.slice(0, count - 2)],
    outs: family === 'open-ended' ? 8 : 4,
    draw: family === 'open-ended' ? 'open-ended straight' : 'gutshot straight',
  };
}
export function generateMath(
  seed: string,
  id: string,
  kind: MathExercise['kind'],
  street: Street,
  profile: OpponentProfileId,
  difficulty: Difficulty,
  random: () => number,
): Scenario {
  const deck = shuffled(createDeck(), random),
    drawing =
      kind === 'drawing-odds' ? drawingCards(street as 'flop' | 'turn', random, difficulty) : null;
  const heroCards = drawing?.hero ?? deck.slice(0, 2),
    board = drawing?.board ?? deck.slice(2, 2 + { preflop: 0, flop: 3, turn: 4, river: 5 }[street]);
  const position = kind === 'bluff-math' ? 'BTN' : random() < 0.5 ? 'BTN' : 'BB';
  const open = pick([2, 2.5, 3, 3.5], random);
  const history =
    street === 'preflop'
      ? [...blindPosts('BB'), historyAction('preflop', 'opponent', 'raise', open)]
      : postflopHistory(
          street,
          position,
          random,
          kind === 'bluff-math' ? 'check' : 'bet',
          difficulty,
        );
  let scenario = finalizeScenario({
    id,
    title: 'Read the price',
    description:
      'A mathematical exercise on a legal poker table. Answer the question; no unsupported poker-action recommendation is assigned.',
    difficulty,
    street,
    heroPosition: street === 'preflop' ? 'BB' : position,
    heroCards,
    board,
    history,
    legalActions: [],
    prompt: '',
    hint: 'Identify the numerator and denominator before choosing your answer.',
    principle: 'Separate exact arithmetic from assumptions about how often a hand wins.',
    reasoning: '',
    deepDive: '',
    tags: [kind],
    source: {
      category: 'mathematical-model',
      label: 'Poker mathematics',
      description:
        'An exact probability or break-even calculation under explicitly stated assumptions; not a strategic solver recommendation.',
    },
  });
  let value: number,
    question: string,
    explanation: string,
    math: NonNullable<Scenario['generated']>['math'];
  if (kind === 'drawing-odds' && drawing) {
    const cardsToCome =
        street === 'flop' &&
        (difficulty === 'advanced' || (difficulty === 'intermediate' && random() < 0.5))
          ? 2
          : 1,
      unseen = 52 - heroCards.length - board.length;
    value = drawProbability(drawing.outs, unseen, cardsToCome);
    question = `You have ${drawing.outs} direct ${drawing.draw} outs. What is the chance to hit at least one ${cardsToCome === 2 ? 'by the river' : 'on the next card'}?`;
    explanation =
      cardsToCome === 1
        ? `${drawing.outs} / ${unseen} = ${(value * 100).toFixed(1)}%.`
        : `1 − (${unseen - drawing.outs}/${unseen}) × (${unseen - drawing.outs - 1}/${unseen - 1}) = ${(value * 100).toFixed(1)}%.`;
    scenario.title = `${drawing.outs} outs: ${cardsToCome === 2 ? 'two cards' : 'one card'} to come`;
    math = { outs: drawing.outs, drawProbability: value };
  } else if (kind === 'bluff-math') {
    const bet = Math.max(
      1,
      Math.min(
        Math.round(scenario.currentPot * pick([0.33, 0.5, 0.75, 1, 1.5], random) * 2) / 2,
        scenario.stacks.hero,
      ),
    );
    value = bluffBreakEven(bet, scenario.currentPot);
    question = `A hypothetical zero-equity bluff risks ${bet} BB to win ${scenario.currentPot} BB. How often must it work to break even?`;
    explanation = `Risk / (reward + risk) = ${bet} / (${scenario.currentPot} + ${bet}) = ${(value * 100).toFixed(1)}%. The hypothetical bluff loses whenever called; it is not a recommendation to bluff this actual hand.`;
    scenario.title = 'Price a river bluff';
    scenario.legalActions = [
      option(
        'check',
        'defensible',
        'Available real poker action, not evaluated by this arithmetic drill.',
      ),
      option('bet', 'defensible', 'Hypothetical risk amount used in the question.', bet),
    ];
    math = { bluffBreakEven: value };
  } else {
    value = potOdds(scenario.toCall, scenario.currentPot);
    question = `Calling ${scenario.toCall} BB into ${scenario.currentPot} BB requires what immediate equity?`;
    explanation = `Call / (current pot + call) = ${scenario.toCall} / (${scenario.currentPot} + ${scenario.toCall}) = ${(value * 100).toFixed(1)}%. This is the price, not measured hand equity.`;
    math = { requiredEquity: value };
  }
  if (!scenario.legalActions.length)
    scenario.legalActions = [
      option(
        'fold',
        'defensible',
        'Available real action; the exercise evaluates mathematics only.',
      ),
      option(
        'call',
        'defensible',
        'Available real action; the exercise does not estimate profitable postflop play.',
        scenario.toCall,
      ),
    ];
  scenario = {
    ...scenario,
    prompt: question,
    reasoning: explanation,
    deepDive:
      kind === 'drawing-odds'
        ? 'The draw calculation conditions only on visible cards and a uniformly unknown deck. It counts hitting the stated direct outs, not actual winning equity: an improved hand may still lose, and other improvement paths are outside this question. A two-card probability does not imply that calling one flop bet buys both cards.'
        : kind === 'bluff-math'
          ? 'This break-even model assumes zero showdown equity, no raises, no rake and no future betting. The actual visible hand may have showdown value; the question prices a hypothetical pure bluff, without recommending one.'
          : 'The current pot already contains the opponent bet. Divide the additional call by the final pot after calling. Earlier-street equity realization and later bets can change the strategic value of a call.',
    exercise: { kind, question, answers: answers(value, explanation, random, difficulty) },
    generated: {
      seed,
      version: 1,
      category: kind,
      profile,
      provenance: 'mathematical-model',
      scored: true,
      assumptions: [
        '100 BB heads-up; no rake.',
        'Math answers are scored independently of poker actions.',
        kind === 'drawing-odds'
          ? 'Unseen cards are uniformly distributed; fixed direct outs do not equal winning equity.'
          : kind === 'bluff-math'
            ? 'Hypothetical pure bluff has zero equity when called.'
            : 'Immediate pot odds omit future bets and equity realization.',
      ],
      math,
    },
  };
  return scenario;
}
