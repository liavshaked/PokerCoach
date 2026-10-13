import type { ActionGrade, LegalAction, MathAnswer, Scenario } from '../../types/poker';
import { potOdds } from '../rules';
export type DecisionOption = LegalAction | MathAnswer;
export interface DecisionEvaluation {
  chosenAction: DecisionOption;
  recommendedActions: DecisionOption[];
  grade: ActionGrade;
  explanation: string;
  principle: string;
  reasoning: string;
  deepDive: string;
  potOdds: number | null;
  generated?: Scenario['generated'];
  scored: boolean;
}
/** Math choices are separate from legal poker actions: answering a percentage
 * never pretends that the user called, folded, or placed a real bet. */
export function getDecisionOptions(scenario: Scenario): DecisionOption[] {
  return scenario.exercise?.answers ?? scenario.legalActions;
}
export function evaluateDecision(scenario: Scenario, actionId: string): DecisionEvaluation {
  const options = getDecisionOptions(scenario),
    chosenAction = options.find((action) => action.id === actionId);
  if (!chosenAction)
    throw new Error(`Action ${actionId} is not supported in scenario ${scenario.id}.`);
  return {
    chosenAction,
    recommendedActions: options.filter((action) => action.grade === 'preferred'),
    grade: chosenAction.grade,
    explanation: chosenAction.explanation,
    principle: scenario.principle,
    reasoning: scenario.reasoning,
    deepDive: scenario.deepDive,
    potOdds: scenario.toCall > 0 ? potOdds(scenario.toCall, scenario.currentPot) : null,
    generated: scenario.generated,
    scored: scenario.generated?.scored ?? false,
  };
}
