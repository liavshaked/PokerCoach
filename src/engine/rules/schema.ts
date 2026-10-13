import type { Scenario } from '../../types/poker';
import { isCard } from '../cards';
import { validateRange } from '../equity';
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const kinds = ['fold', 'check', 'call', 'bet', 'raise'];
const streets = ['preflop', 'flop', 'turn', 'river'];
const grades = ['preferred', 'defensible', 'mistaken'];
export function scenarioShapeErrors(value: unknown): string[] {
  if (!record(value)) return ['Scenario must be an object.'];
  const errors: string[] = [];
  for (const field of [
    'id',
    'title',
    'description',
    'prompt',
    'hint',
    'principle',
    'reasoning',
    'deepDive',
  ])
    if (!text(value[field])) errors.push(`${field} must be nonempty text.`);
  if (!['beginner', 'intermediate', 'advanced'].includes(String(value.difficulty)))
    errors.push('Unknown difficulty.');
  if (!streets.includes(String(value.street))) errors.push('Unknown street.');
  for (const field of ['heroPosition', 'opponentPosition'])
    if (!['BTN', 'BB'].includes(String(value[field]))) errors.push(`${field} must be BTN or BB.`);
  for (const field of ['heroCards', 'board'])
    if (!Array.isArray(value[field]) || ![...value[field]].every(isCard))
      errors.push(`${field} must contain valid cards.`);
  for (const [field, keys] of [
    ['blinds', ['small', 'big']],
    ['startingStacks', ['hero', 'opponent']],
    ['stacks', ['hero', 'opponent']],
  ] as const) {
    const object = value[field];
    if (
      !record(object) ||
      keys.some((key) => typeof object[key] !== 'number' || !Number.isFinite(object[key]))
    )
      errors.push(`${field} must contain finite chip amounts.`);
  }
  for (const field of ['potBeforeAction', 'currentPot', 'toCall'])
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]))
      errors.push(`${field} must be a finite number.`);
  if (!Array.isArray(value.tags) || !value.tags.length || !value.tags.every(text))
    errors.push('Tags must be a nonempty text array.');
  if (!Array.isArray(value.history)) errors.push('History must be an array.');
  else
    value.history.forEach((action, index) => {
      if (
        !record(action) ||
        !['hero', 'opponent'].includes(String(action.actor)) ||
        !streets.includes(String(action.street)) ||
        ![...kinds, 'post'].includes(String(action.kind)) ||
        (action.amount !== undefined &&
          (typeof action.amount !== 'number' || !Number.isFinite(action.amount)))
      )
        errors.push(`Invalid history action ${index}.`);
    });
  const actionValid = (action: unknown): boolean =>
    record(action) &&
    kinds.includes(String(action.kind)) &&
    text(action.label) &&
    (action.amount === undefined ||
      (typeof action.amount === 'number' && Number.isFinite(action.amount)));
  if (!actionValid(value.opponentAction)) errors.push('Invalid opponent action.');
  if (!Array.isArray(value.legalActions) || !value.legalActions.length)
    errors.push('Legal actions must be a nonempty array.');
  else
    value.legalActions.forEach((action, index) => {
      if (
        !actionValid(action) ||
        !record(action) ||
        !text(action.id) ||
        !text(action.explanation) ||
        !grades.includes(String(action.grade))
      )
        errors.push(`Invalid legal action ${index}.`);
    });
  const source = value.source;
  if (
    !record(source) ||
    !['illustrative', 'mathematical-model', 'expert-reviewed', 'solver-verified'].includes(
      String(source.category),
    ) ||
    !text(source.label) ||
    !text(source.description)
  )
    errors.push('Invalid strategy provenance.');
  else {
    if (source.category === 'illustrative' && !/illustrative|heuristic/i.test(String(source.label)))
      errors.push('Heuristic source must be labeled illustrative or heuristic.');
    if (
      source.category === 'expert-reviewed' &&
      (!text(source.reviewer) || !text(source.reference))
    )
      errors.push('Expert-reviewed source requires a reviewer and traceable reference.');
    if (source.category === 'solver-verified' && (!text(source.solver) || !text(source.reference)))
      errors.push('Solver source requires a solver and traceable reference.');
  }
  if (value.exercise !== undefined) {
    const exercise = value.exercise;
    if (
      !record(exercise) ||
      !['pot-odds', 'drawing-odds', 'bluff-math'].includes(String(exercise.kind)) ||
      !text(exercise.question) ||
      !Array.isArray(exercise.answers) ||
      exercise.answers.length < 2
    )
      errors.push('Invalid mathematical exercise.');
    else {
      if (
        exercise.answers.some(
          (answer) =>
            !record(answer) ||
            !text(answer.id) ||
            !text(answer.label) ||
            !text(answer.explanation) ||
            !grades.includes(String(answer.grade)) ||
            typeof answer.value !== 'number' ||
            !Number.isFinite(answer.value) ||
            answer.value < 0 ||
            answer.value > 1,
        )
      )
        errors.push('Invalid mathematical answer.');
      if (
        exercise.answers.filter((answer) => record(answer) && answer.grade === 'preferred')
          .length !== 1
      )
        errors.push('Math exercise needs exactly one correct answer.');
      if (
        new Set(exercise.answers.map((answer) => (record(answer) ? answer.id : undefined))).size !==
        exercise.answers.length
      )
        errors.push('Duplicate math answer ids.');
    }
  }
  if (value.generated !== undefined) {
    const generated = value.generated;
    if (
      !record(generated) ||
      !text(generated.seed) ||
      generated.seed.length > 256 ||
      generated.version !== 1 ||
      ![
        'blind-defense',
        'facing-three-bet',
        'river-bluff-catching',
        'pot-odds',
        'drawing-odds',
        'bluff-math',
      ].includes(String(generated.category)) ||
      !['balanced', 'tight', 'aggressive', 'recreational'].includes(String(generated.profile)) ||
      !['mathematical-model', 'heuristic'].includes(String(generated.provenance)) ||
      typeof generated.scored !== 'boolean' ||
      !Array.isArray(generated.assumptions) ||
      !generated.assumptions.every(text)
    )
      errors.push('Invalid generation metadata.');
    else {
      if (
        generated.provenance === 'heuristic' &&
        (generated.scored || !record(source) || source.category !== 'illustrative')
      )
        errors.push('Heuristic guidance cannot be labeled as scored mathematical strategy.');
      if (
        generated.provenance === 'mathematical-model' &&
        (!record(source) || source.category !== 'mathematical-model')
      )
        errors.push('Mathematical evaluation requires a mathematical source label.');
      if (generated.range !== undefined && !validateRange(generated.range))
        errors.push('Invalid weighted opponent range.');
      if (generated.math !== undefined) {
        if (
          !record(generated.math) ||
          Object.values(generated.math).some(
            (number) => typeof number !== 'number' || !Number.isFinite(number),
          )
        )
          errors.push('Invalid mathematical metadata.');
        else
          for (const field of [
            'equity',
            'requiredEquity',
            'drawProbability',
            'bluffBreakEven',
            'tieProbability',
            'handPercentile',
          ]) {
            const number = generated.math[field];
            if (number !== undefined && (typeof number !== 'number' || number < 0 || number > 1))
              errors.push(`${field} must be between zero and one.`);
          }
      }
    }
  }
  return errors;
}
export function hasScenarioShape(value: unknown): value is Scenario {
  return scenarioShapeErrors(value).length === 0;
}
