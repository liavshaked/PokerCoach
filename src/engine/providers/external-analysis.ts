/**
 * Dormant contract for a future AUTHORIZED SERVER implementation.
 * No transport, credentials, adapter instance, or enabled product feature exists.
 * Public specification: https://developers.gtowizard.com/openapi/business/v4.json
 * Benchmarking API access does not grant permission to implement this service.
 */
export interface CompletedHandAnalysisUpload {
  handId: string;
  completedAt: string;
  /** Importer/serialization must be explicitly accepted by the provider. */
  approvedHistoryFormat: string;
  rawHistory: string;
  heroNickname: string;
  contentType: 'nlhe.cash.1';
  /** Limit an initial integration to one analyzed seat per hand. */
  scope: 'player';
}

export interface ExternalDecisionAnalysis {
  /** Local decision mapping must be validated against the provider's history. */
  decisionId: string;
  status: 'solved' | 'unsolved';
  /** Provider score, 0..1. Never substitute FeltLab's heuristic/model grade. */
  providerScore: number | null;
  evLossBb: number | null;
  rejectionReason?: string;
}

export type ExternalAnalysisTask =
  | { status: 'pending'; taskId: string; retryAfterMs?: number }
  | { status: 'failed'; taskId: string; reason: string }
  | {
      status: 'complete';
      taskId: string;
      provider: 'gto-wizard-score';
      apiVersion: 'v4';
      metric: 'CHIP_EV';
      analyzedAt: string;
      billableUnits: number;
      hands: {
        handId: string;
        status: 'solved' | 'rejected';
        rejectionReason?: string;
        decisions: ExternalDecisionAnalysis[];
      }[];
    };

/**
 * Implementation belongs in a separately authorized server deployment.
 * It must enforce completed hands, approved formats, user upload consent,
 * one active task/application, spending limits, timeouts, and response validation.
 * OAuth client secrets/tokens must never be supplied by or returned to the PWA.
 */
export interface GtoWizardScoreServerAdapter {
  readonly authorization: {
    status: 'authorized';
    contractReference: string;
    approvedHistoryFormats: readonly string[];
  };
  submitCompletedHands(
    uploads: readonly CompletedHandAnalysisUpload[],
    signal: AbortSignal,
  ): Promise<{ taskId: string }>;
  readTask(taskId: string, signal: AbortSignal): Promise<ExternalAnalysisTask>;
}
