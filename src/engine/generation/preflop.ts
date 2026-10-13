import type { Difficulty, OpponentProfileId, Scenario, ScenarioCategory } from '../../types/poker';
import { createDeck, displayCards } from '../cards';
import {
  getOpponentProfile,
  modeledPreflopRange,
  preflopStrength,
  weightedHandPercentile,
} from '../ranges';
import { potOdds } from '../rules';
import { blindPosts, finalizeScenario, historyAction, option } from './common';
import { pick, shuffled } from './random';
export function generatePreflop(
  seed: string,
  id: string,
  category: Extract<ScenarioCategory, 'blind-defense' | 'facing-three-bet'>,
  profileId: OpponentProfileId,
  difficulty: Difficulty,
  random: () => number,
): Scenario {
  const deck = shuffled(createDeck(), random);
  const candidateHands = Array.from({ length: 26 }, (_, index) =>
    deck.slice(index * 2, index * 2 + 2),
  );
  const eligible = candidateHands.filter((hand) => {
    const strength = preflopStrength(hand);
    return difficulty === 'beginner'
      ? strength >= 44 || strength <= 23
      : difficulty === 'advanced'
        ? strength >= 26 && strength <= 42
        : true;
  });
  const cards =
      difficulty === 'intermediate'
        ? deck.slice(0, 2)
        : pick(eligible.length ? eligible : candidateHands, random),
    threeBet = category === 'facing-three-bet',
    position = threeBet ? 'BTN' : 'BB';
  const open = pick([2, 2.5, 3, 3.5], random),
    raise = pick([8, 9, 10, 11, 12], random);
  const history = threeBet
    ? [
        ...blindPosts(position),
        historyAction('preflop', 'hero', 'raise', open),
        historyAction('preflop', 'opponent', 'raise', raise),
      ]
    : [...blindPosts(position), historyAction('preflop', 'opponent', 'raise', open)];
  let scenario = finalizeScenario({
    id,
    title: threeBet ? 'Facing a heads-up three-bet' : 'Defend the big blind',
    description:
      'An authored heads-up range model provides educational guidance. No verified range chart is claimed.',
    difficulty,
    street: 'preflop',
    heroPosition: position,
    heroCards: cards,
    board: [],
    history,
    legalActions: [],
    prompt: threeBet
      ? 'How does this hand fit against the modeled three-betting range?'
      : 'Choose a defense against the modeled button opening range.',
    hint: 'Compare your hand structure with the range and price. A strength percentile is not equity.',
    principle: 'Range width, price, position and playability all matter before the flop.',
    reasoning: '',
    deepDive: '',
    tags: [category, 'preflop-ranges'],
    source: {
      category: 'illustrative',
      label: 'Heuristic range model',
      description:
        'Authored 100 BB heads-up weighted range and hand-structure heuristic. Not a verified chart, solver result or measured EV.',
    },
  });
  const profile = getOpponentProfile(profileId),
    range = modeledPreflopRange(profileId, threeBet ? 'three-bet' : 'open', cards),
    comparison = weightedHandPercentile(cards, range),
    price = potOdds(scenario.toCall, scenario.currentPot);
  // Explicit teaching heuristic, not an equity calculation. Larger prices
  // require a stronger structural percentile; near boundaries remain defensible.
  const defendFloor = Math.max(0.1, Math.min(0.45, price * (threeBet ? 1.1 : 0.55))),
    raiseFloor = threeBet ? 0.88 : 0.84;
  const preference =
    comparison.percentile < defendFloor
      ? 'fold'
      : comparison.percentile >= raiseFloor
        ? 'raise'
        : 'call';
  const grade = (kind: 'fold' | 'call' | 'raise') =>
    kind === preference
      ? 'preferred'
      : kind === 'call' && comparison.percentile >= defendFloor - 0.1
        ? 'defensible'
        : kind === 'raise' && comparison.percentile >= raiseFloor - 0.12
          ? 'defensible'
          : kind === 'fold' && comparison.percentile < defendFloor + 0.1
            ? 'defensible'
            : 'mistaken';
  const raiseTo = threeBet ? raise * 2.5 : open * 3.5;
  scenario = {
    ...scenario,
    title: `${profile.label}: ${threeBet ? 'three-bet response' : 'blind defense'}`,
    description: `${displayCards(cards)} faces ${threeBet ? 'a big-blind three-bet' : 'a heads-up button open'} to ${threeBet ? raise : open} BB. ${profile.description}`,
    legalActions: [
      option(
        'fold',
        grade('fold'),
        'The model favors folding below its range-relative hand-structure threshold; this is qualitative guidance.',
      ),
      option(
        'call',
        grade('call'),
        'Calling retains a broad range. The educational threshold accounts for price but does not calculate equity realization.',
        scenario.toCall,
      ),
      option(
        'raise',
        grade('raise'),
        'The model favors a value-oriented raise near the top of its weighted structure ranking. It does not claim a solved mixing frequency.',
        raiseTo,
      ),
    ],
    reasoning: `Your hand's structural rank is at the ${(comparison.percentile * 100).toFixed(0)}th percentile of this weighted ${threeBet ? 'three-bet' : 'opening'} model. The immediate call price is ${(price * 100).toFixed(1)}%. These are different quantities: structural percentile is NOT hand equity. ${preference[0].toUpperCase() + preference.slice(1)} is this heuristic's teaching preference.`,
    deepDive: `The model enumerates ${range.length} legal weighted opponent combinations after card removal. It scores pairs, high cards, suitedness and connectedness, then compares that ordinal score with a profile-specific weighted range. Authored thresholds account for the immediate price and facing an open versus a three-bet. This cannot solve postflop equity realization or exact mixed strategies, so these decisions are excluded from mathematical challenge scoring. No imported 6-max charts are used as heads-up data.`,
    generated: {
      seed,
      version: 1,
      category,
      profile: profileId,
      provenance: 'heuristic',
      scored: false,
      range,
      assumptions: [
        '100 BB heads-up BTN/small blind versus BB; zero rake.',
        profile.description,
        'Authored hand-structure ranking and range membership weights; not a verified range chart.',
        'Range weights are not action frequencies. Heuristic feedback is recorded separately from mathematical results.',
      ],
      math: {
        requiredEquity: price,
        handPercentile: comparison.percentile,
        rangeMeanStrength: comparison.meanStrength,
      },
    },
  };
  return scenario;
}
