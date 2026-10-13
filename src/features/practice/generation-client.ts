import type { GenerationOptions } from '../../engine/generation';
import type { Scenario } from '../../types/poker';

export const GENERATION_TIMEOUT_MS = 12_000;

/** A fresh worker keeps expensive enumeration off the UI and makes cancellation final. */
export function generateScenarioAsync(
  options: GenerationOptions,
  signal?: AbortSignal,
): Promise<Scenario> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    const finish = (error?: Error, scenario?: Scenario) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error);
      else resolve(scenario!);
    };
    const abort = () => finish(new Error('Practice generation was cancelled.'));
    const timeout = setTimeout(
      () => finish(new Error('This hand took too long to prepare. Retry to continue.')),
      GENERATION_TIMEOUT_MS,
    );
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });

    // Tests and environments without workers retain the same seeded engine.
    if (typeof Worker === 'undefined') {
      void import('../../engine/generation')
        .then(({ generateScenario }) => {
          if (!settled) finish(undefined, generateScenario(options));
        })
        .catch(() => finish(new Error('Could not prepare this hand. Retry to continue.')));
      return;
    }
    try {
      worker = new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ scenario?: Scenario; error?: string }>) => {
        if (event.data?.scenario?.generated?.seed !== options.seed || event.data.error) {
          finish(new Error('Could not prepare this hand. Retry to continue.'));
        } else finish(undefined, event.data.scenario);
      };
      worker.onerror = () =>
        finish(new Error('The practice engine could not start. Retry to continue.'));
      worker.onmessageerror = () =>
        finish(new Error('The practice engine returned an unreadable hand. Retry to continue.'));
      worker.postMessage(options);
    } catch {
      finish(new Error('The practice engine could not start. Retry to continue.'));
    }
  });
}
