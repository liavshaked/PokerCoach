import { generateScenario, type GenerationOptions } from '../../engine/generation';

// Keep this worker's input limited to public generation parameters.
self.onmessage = (event: MessageEvent<GenerationOptions>) => {
  try {
    self.postMessage({ scenario: generateScenario(event.data) });
  } catch {
    self.postMessage({ error: 'Unable to generate a valid practice hand.' });
  }
};
