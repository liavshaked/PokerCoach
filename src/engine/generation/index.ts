import type {
  Difficulty,
  OpponentProfileId,
  Scenario,
  ScenarioCategory,
  Street,
} from '../../types/poker';
import { getOpponentProfile } from '../ranges';
import { validateScenario } from '../rules';
import { generateMath } from './math';
import { generatePreflop } from './preflop';
import { generateRiver } from './river';
import { pick, seededRandom } from './random';
export { opponentProfiles } from '../ranges';
export interface GenerationOptions {
  seed: string;
  street?: Street;
  category?: ScenarioCategory;
  profile?: OpponentProfileId;
  difficulty?: Difficulty;
}
export const scenarioCategories: { id: ScenarioCategory; label: string; streets: Street[] }[] = [
  { id: 'blind-defense', label: 'Blind defense', streets: ['preflop'] },
  { id: 'facing-three-bet', label: 'Facing a three-bet', streets: ['preflop'] },
  { id: 'river-bluff-catching', label: 'River bluff catching', streets: ['river'] },
  { id: 'pot-odds', label: 'Pot odds', streets: ['preflop', 'flop', 'turn', 'river'] },
  { id: 'drawing-odds', label: 'Drawing odds', streets: ['flop', 'turn'] },
  { id: 'bluff-math', label: 'Bluff mathematics', streets: ['river'] },
];
/** Throws a useful error for unsupported filters; never substitutes a fake
 * solved strategy or silently changes the requested training concept. */
export function generateScenario(options: GenerationOptions): Scenario {
  if (!options || typeof options !== 'object') throw new Error('Generation options are required.');
  const random = seededRandom(options.seed),
    streets: Street[] = ['preflop', 'flop', 'turn', 'river'];
  const selectedCategory =
    options.category === undefined
      ? undefined
      : scenarioCategories.find((item) => item.id === options.category);
  if (options.category !== undefined && !selectedCategory)
    throw new Error(`Unsupported category: ${String(options.category)}.`);
  const defaultStreet = pick(selectedCategory?.streets ?? streets, random),
    street = options.street ?? defaultStreet;
  if (!streets.includes(street)) throw new Error(`Unsupported street: ${String(street)}.`);
  if (selectedCategory && !selectedCategory.streets.includes(street))
    throw new Error(`${selectedCategory.label} does not support ${street}.`);
  const defaults: Record<Street, ScenarioCategory[]> = {
    preflop: ['blind-defense', 'facing-three-bet'],
    flop: ['pot-odds', 'drawing-odds'],
    turn: ['pot-odds', 'drawing-odds'],
    river: ['river-bluff-catching', 'river-bluff-catching', 'river-bluff-catching', 'bluff-math'],
  };
  const defaultCategory = pick(defaults[street], random),
    category = options.category ?? defaultCategory;
  const profile = options.profile ?? 'balanced';
  getOpponentProfile(profile);
  const difficulty = options.difficulty ?? 'intermediate';
  if (!['beginner', 'intermediate', 'advanced'].includes(difficulty))
    throw new Error('Unsupported difficulty.');
  const id = `g1:${encodeURIComponent(options.seed)}:${street}:${category}:${profile}:${difficulty}`;
  let scenario: Scenario;
  if (category === 'blind-defense' || category === 'facing-three-bet')
    scenario = generatePreflop(options.seed, id, category, profile, difficulty, random);
  else if (category === 'river-bluff-catching')
    scenario = generateRiver(options.seed, id, profile, difficulty, random);
  else scenario = generateMath(options.seed, id, category, street, profile, difficulty, random);
  const validation = validateScenario(scenario);
  if (!validation.valid)
    throw new Error(`Generated scenario failed validation: ${validation.errors.join(' ')}`);
  return scenario;
}
export function generationOptions(scenario: Scenario): GenerationOptions | null {
  return scenario.generated
    ? {
        seed: scenario.generated.seed,
        street: scenario.street,
        category: scenario.generated.category,
        profile: scenario.generated.profile,
        difficulty: scenario.difficulty,
      }
    : null;
}
