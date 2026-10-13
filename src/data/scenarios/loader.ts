import type { Scenario } from '../../types/poker';
import { validateScenario } from '../../engine/rules';
export interface ScenarioLoadIssue {
  index: number;
  id?: string;
  errors: string[];
}
/** Each entry may be a JSON object or a lazy TypeScript factory. A bad seed,
 * missing field, duplicate id or impossible betting line cannot crash the pack. */
export function loadScenarios(input: unknown): {
  scenarios: Scenario[];
  issues: ScenarioLoadIssue[];
} {
  if (!Array.isArray(input))
    return { scenarios: [], issues: [{ index: -1, errors: ['Scenario pack must be an array.'] }] };
  const scenarios: Scenario[] = [],
    issues: ScenarioLoadIssue[] = [],
    ids = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    let candidate: unknown;
    try {
      candidate = typeof input[index] === 'function' ? input[index]() : input[index];
    } catch (error) {
      issues.push({
        index,
        errors: [error instanceof Error ? error.message : 'Scenario construction failed.'],
      });
      continue;
    }
    const validation = validateScenario(candidate);
    const id =
      typeof candidate === 'object' &&
      candidate !== null &&
      'id' in candidate &&
      typeof candidate.id === 'string'
        ? candidate.id
        : undefined;
    if (!validation.valid) {
      issues.push({ index, id, errors: validation.errors });
      continue;
    }
    const scenario = candidate as Scenario;
    if (ids.has(scenario.id)) {
      issues.push({ index, id: scenario.id, errors: ['Duplicate scenario id.'] });
      continue;
    }
    ids.add(scenario.id);
    scenarios.push(scenario);
  }
  return { scenarios, issues };
}
