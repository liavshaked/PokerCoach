import type { ActionGrade, Street } from '../../types/poker';
import type { AgentView, GameAction } from '../game/types';

export interface DecisionSnapshot {
  id: string;
  handId: string;
  eventIndex: number;
  /** Null only when recovering an authoritative action whose timestamp metadata was lost. */
  createdAt: string | null;
  view: AgentView;
  chosenAction: GameAction;
}
export interface PotOddsAnalysis {
  toCall: number;
  eligiblePot: number;
  currentPot: number;
  requiredEquity: number;
  explanation: string;
}
export interface DecisionCoaching {
  situation: string;
  verdict: string;
  why: string;
  alternative: string;
  takeaway: string;
}
export interface EstimatedDecisionEquity {
  share: number;
  samples: number;
  /** Approximate 95% Monte Carlo sampling margin; excludes range-model uncertainty. */
  samplingMargin: number;
  opponents: number;
  method: string;
}
export interface DecisionAnalysis {
  status: 'available' | 'unavailable';
  level: 'model' | 'heuristic' | 'mathematical' | 'solver';
  source: {
    category: 'model-based' | 'heuristic' | 'mathematical' | 'solver-verified';
    label: string;
  };
  model: string;
  confidence: 'low' | 'medium' | 'high';
  confidenceWeight: number;
  grade: ActionGrade | null;
  score: number | null;
  scored: boolean;
  importance: number;
  recommendedActions: GameAction[];
  explanation: string;
  principle: string;
  assumptions: string[];
  potOdds: PotOddsAnalysis | null;
  evLoss: number | null;
  tags: string[];
  /** Optional only for compatibility with older saved reports. Rebuilt from the decision snapshot. */
  coaching?: DecisionCoaching;
  estimatedEquity?: EstimatedDecisionEquity;
}
export interface HeroDecision extends DecisionSnapshot {
  analysis: DecisionAnalysis;
}
export interface StreetReport {
  street: Street;
  decisions: number;
  scored: number;
  score: number | null;
  assessment: string;
}
export interface HandReport {
  score: number | null;
  scoreLabel: 'Model agreement';
  coverage: number;
  weightedCoverage: number;
  totalDecisions: number;
  evaluatedDecisions: number;
  scoredDecisions: number;
  confidence: 'low' | 'medium' | 'high';
  strongDecisions: number;
  notableMistakes: number;
  mostImportantDecisionId: string | null;
  biggestEvLoss: number | null;
  streets: StreetReport[];
  lessons: string[];
  method: string;
  summary?: string;
  strengths?: CoachingPoint[];
  improvements?: CoachingPoint[];
}
export interface CoachingPoint {
  decisionId: string;
  street: string;
  title: string;
  detail: string;
}
