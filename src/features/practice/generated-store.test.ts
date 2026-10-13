import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateScenario,
  scenarioCategories,
  type GenerationOptions,
} from '../../engine/generation';
import { getDecisionOptions } from '../../engine/evaluation';
import type { Scenario } from '../../types/poker';
import { generateScenarioAsync, GENERATION_TIMEOUT_MS } from './generation-client';
import {
  createGeneratedStore,
  GENERATED_STORAGE_KEY,
  generatedCategoryStreets,
  generatedWeaknesses,
  sanitizeGeneratedState,
  selectGeneratedStatistics,
  GENERATED_DUPLICATE_RETRIES,
  GENERATED_HISTORY_LIMIT,
  generatedSituationFingerprint,
  type GeneratedResult,
} from './generated-store';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const generate = async (options: GenerationOptions) => generateScenario(options);
const chosen = (scenario: Scenario, grade = 'preferred') =>
  getDecisionOptions(scenario).find((option) => option.grade === grade) ??
  getDecisionOptions(scenario)[0];
function result(seed: string, overrides: Partial<GeneratedResult> = {}): GeneratedResult {
  return {
    id: `r-${seed}`,
    sessionId: 's',
    scenarioId: `g-${seed}`,
    seed,
    title: 'Pot odds',
    actionId: 'a',
    actionLabel: '25%',
    grade: 'preferred',
    street: 'flop',
    category: 'pot-odds',
    profile: 'balanced',
    difficulty: 'beginner',
    scored: true,
    source: { category: 'mathematical-model', label: 'Mathematical model' },
    createdAt: '2026-10-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('generated session progression', () => {
  it('completes 120 fresh decisions without losing results or counting replays', async () => {
    const store = createGeneratedStore({ generate, storage: memoryStorage() });
    expect(await store.getState().startSession('endless')).toBe(true);
    const seen = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      const state = store.getState(),
        scenario = state.currentScenario!;
      expect(seen.has(scenario.id)).toBe(false);
      seen.add(scenario.id);
      expect(state.submitAction(chosen(scenario).id)).toBe(true);
      expect(store.getState().submitAction(chosen(scenario).id)).toBe(false);
      if (index === 0) {
        expect(store.getState().replayScenario()).toBe(true);
        expect(store.getState().submitAction(chosen(scenario, 'mistaken').id)).toBe(true);
        expect(store.getState().results).toHaveLength(1);
        expect(store.getState().results[0].grade).toBe('preferred');
      }
      expect(await store.getState().nextScenario()).toBe(true);
    }
    expect(store.getState().results).toHaveLength(120);
    expect(store.getState().currentSession).toMatchObject({
      answered: 120,
      index: 120,
      completed: false,
    });
    store.getState().endSession();
    expect(store.getState().currentSession?.completed).toBe(true);
    expect(store.getState().sessions[0].decisions).toBe(120);
    store.getState().closeSession();
    expect(store.getState().currentSession).toBeNull();
    expect(store.getState().sessions).toHaveLength(1);
  }, 20_000);

  it.each([10, 20, 50] as const)(
    'finishes a %i-decision challenge exactly once',
    async (challengeLength) => {
      const store = createGeneratedStore({ generate, storage: memoryStorage() });
      await store
        .getState()
        .startSession('challenge', { challengeLength, category: 'pot-odds', street: 'flop' });
      for (let index = 0; index < challengeLength; index += 1) {
        store.getState().submitAction(chosen(store.getState().currentScenario!).id);
        await store.getState().nextScenario();
      }
      expect(store.getState().results).toHaveLength(challengeLength);
      expect(store.getState().currentSession).toMatchObject({
        answered: challengeLength,
        completed: true,
      });
      expect(await store.getState().nextScenario()).toBe(false);
      expect(store.getState().submitAction('anything')).toBe(false);
      expect(store.getState().sessions).toHaveLength(1);
    },
  );

  it('locks rapid starts/nexts and ignores a late cancelled response', async () => {
    let complete: ((value: Scenario) => void) | undefined;
    const requests: GenerationOptions[] = [];
    const pending = vi.fn((input: GenerationOptions) => {
      requests.push(input);
      return new Promise<Scenario>((resolve) => {
        complete = resolve;
      });
    });
    const store = createGeneratedStore({ generate: pending, storage: memoryStorage() });
    const first = store.getState().startSession();
    expect(await store.getState().startSession()).toBe(false);
    expect(await store.getState().nextScenario()).toBe(false);
    expect(store.getState().submitAction('fake')).toBe(false);
    complete!(generateScenario(requests[0]));
    expect(await first).toBe(true);
    store.getState().submitAction(chosen(store.getState().currentScenario!).id);
    const next = store.getState().nextScenario();
    expect(await store.getState().nextScenario()).toBe(false);
    store.getState().closeSession();
    complete!(generateScenario(requests[1]));
    expect(await next).toBe(false);
    expect(store.getState().currentSession).toBeNull();
    expect(store.getState().currentScenario).toBeNull();
  });

  it('keeps a failed request retryable with the same seed and no phantom result', async () => {
    const requests: GenerationOptions[] = [];
    const flaky = vi.fn(async (input: GenerationOptions) => {
      requests.push(input);
      if (requests.length === 1) throw new Error('Worker timed out. Retry to continue.');
      return generateScenario(input);
    });
    const store = createGeneratedStore({ generate: flaky, storage: memoryStorage() });
    expect(await store.getState().startSession()).toBe(false);
    expect(store.getState().error).toContain('Retry');
    expect(store.getState().busy).toBe(false);
    expect(store.getState().results).toHaveLength(0);
    expect(await store.getState().retryGeneration()).toBe(true);
    expect(requests[0].seed).toBe(requests[1].seed);
    expect(store.getState().error).toBeNull();
  });

  it('retries a reordered semantic duplicate with a derived seed before showing it', async () => {
    const first = generateScenario({
      seed: 'novelty-first',
      category: 'drawing-odds',
      street: 'flop',
    });
    const alternate = generateScenario({
      seed: 'novelty-alternate',
      category: 'drawing-odds',
      street: 'flop',
    });
    expect(generatedSituationFingerprint(first)).not.toBe(generatedSituationFingerprint(alternate));
    const requests: GenerationOptions[] = [];
    const repeatOnce = async (input: GenerationOptions) => {
      requests.push(input);
      const template = requests.length < 3 ? first : alternate;
      return {
        ...template,
        id: `scenario-${input.seed}`,
        heroCards: [...template.heroCards].reverse(),
        board: [...template.board].reverse(),
        generated: { ...template.generated!, seed: input.seed },
      };
    };
    const store = createGeneratedStore({ generate: repeatOnce, storage: memoryStorage() });
    await store.getState().startSession('endless');
    store.getState().submitAction(chosen(store.getState().currentScenario!).id);
    expect(await store.getState().nextScenario()).toBe(true);
    expect(requests).toHaveLength(3);
    expect(requests[2].seed).toBe(`${requests[1].seed}:fresh:1`);
    expect(store.getState().pendingRequest?.seed).toBe(requests[2].seed);
    expect(generatedSituationFingerprint(store.getState().currentScenario!)).toBe(
      generatedSituationFingerprint(alternate),
    );
    expect(store.getState().results).toHaveLength(1);
  });

  it('bounds duplicate retries and retains the last shown situation across close and reload', async () => {
    const template = generateScenario({
      seed: 'always-the-same',
      category: 'blind-defense',
      street: 'preflop',
    });
    const repeat = vi.fn(async (input: GenerationOptions) => ({
      ...template,
      id: `scenario-${input.seed}`,
      generated: { ...template.generated!, seed: input.seed },
    }));
    const storage = memoryStorage(),
      store = createGeneratedStore({ generate: repeat, storage });
    await store.getState().startSession();
    store.getState().closeSession();
    const restored = createGeneratedStore({ generate: repeat, storage });
    expect(restored.getState().lastSituation).toBe(generatedSituationFingerprint(template));
    expect(await restored.getState().startSession()).toBe(false);
    expect(repeat).toHaveBeenCalledTimes(2 + GENERATED_DUPLICATE_RETRIES);
    expect(restored.getState().error).toContain('fresh situation');
    expect(restored.getState().busy).toBe(false);
    expect(restored.getState().currentScenario).toBeNull();
    expect(restored.getState().results).toHaveLength(0);
  });
});

describe('filters, mathematical scoring, and weaknesses', () => {
  it('keeps category compatibility aligned with the actual engine', () => {
    for (const entry of scenarioCategories)
      expect(generatedCategoryStreets[entry.id]).toEqual(entry.streets);
    const store = createGeneratedStore({ generate, storage: memoryStorage() });
    store.getState().updatePreferences({ street: 'river', category: 'river-bluff-catching' });
    store.getState().updatePreferences({ street: 'flop' });
    expect(store.getState().preferences.category).toBe('all');
  });

  it('honors focused filters and keeps heuristic decisions separate from math accuracy', async () => {
    const store = createGeneratedStore({ generate, storage: memoryStorage() });
    await store.getState().startSession('focused', {
      street: 'preflop',
      category: 'blind-defense',
      profile: 'tight',
      difficulty: 'advanced',
    });
    let scenario = store.getState().currentScenario!;
    expect(scenario).toMatchObject({
      street: 'preflop',
      difficulty: 'advanced',
      generated: { category: 'blind-defense', profile: 'tight', scored: false },
    });
    store.getState().submitAction(chosen(scenario, 'mistaken').id);
    expect(selectGeneratedStatistics(store.getState().results)).toMatchObject({
      total: 1,
      scored: 0,
      heuristic: 1,
      accuracy: null,
    });
    await store.getState().startSession('focused', { street: 'flop', category: 'pot-odds' });
    scenario = store.getState().currentScenario!;
    expect(scenario.exercise).toBeDefined();
    store.getState().submitAction(chosen(scenario).id);
    expect(selectGeneratedStatistics(store.getState().results)).toMatchObject({
      total: 2,
      scored: 1,
      heuristic: 1,
      accuracy: 100,
    });
    expect(store.getState().results.every((item) => item.evLoss === undefined)).toBe(true);
  });

  it('stores only defensible, terminal river mathematical EV loss', async () => {
    const store = createGeneratedStore({ generate, storage: memoryStorage() });
    await store
      .getState()
      .startSession('focused', { street: 'river', category: 'river-bluff-catching' });
    const scenario = store.getState().currentScenario!,
      action = chosen(scenario, 'mistaken');
    store.getState().submitAction(action.id);
    const saved = store.getState().results[0];
    expect(saved.evLoss).toBeGreaterThanOrEqual(0);
    expect(saved.evLoss).toBeCloseTo(Math.abs(scenario.generated!.math!.callEv!), 8);
  });

  it('targets observed scored category error rates and respects the active street', async () => {
    const history = [
      result('p1', { grade: 'mistaken' }),
      result('p2'),
      result('d1', { category: 'drawing-odds', grade: 'mistaken' }),
      result('h1', {
        category: 'blind-defense',
        street: 'preflop',
        grade: 'mistaken',
        scored: false,
        source: { category: 'illustrative', label: 'Authored policy' },
      }),
    ];
    expect(generatedWeaknesses(history)[0]).toMatchObject({
      category: 'drawing-odds',
      errorRate: 1,
    });
    const store = createGeneratedStore({ generate, storage: memoryStorage() });
    store.setState({ results: history });
    await store.getState().startSession('weakness', { street: 'flop' });
    expect(store.getState().currentScenario?.generated?.category).toBe('drawing-odds');
    expect(generatedWeaknesses(history, 'river')).toEqual([]);
  });

  it('does not lock weakness practice to a category with no recorded mistakes', async () => {
    const requests: GenerationOptions[] = [];
    const store = createGeneratedStore({
      generate: async (input) => {
        requests.push(input);
        return generateScenario(input);
      },
      storage: memoryStorage(),
    });
    store.setState({ results: [result('correct-draw', { category: 'drawing-odds' })] });
    await store.getState().startSession('weakness', { street: 'flop' });
    expect(requests[0].category).toBeUndefined();
  });
});

describe('generated persistence', () => {
  it('resumes the same hand and first result after discarding forged saved cards and grading', async () => {
    const storage = memoryStorage(),
      first = createGeneratedStore({ generate, storage });
    await first
      .getState()
      .startSession('challenge', { category: 'pot-odds', street: 'flop', challengeLength: 20 });
    const scenario = first.getState().currentScenario!;
    first.getState().submitAction(chosen(scenario).id);
    const saved = JSON.parse(storage.getItem(GENERATED_STORAGE_KEY)!);
    saved.state.currentScenario.heroCards = [{ rank: 'X', suit: 'spades' }];
    saved.state.currentScenario.exercise.answers.forEach((answer: { grade: string }) => {
      answer.grade = 'mistaken';
    });
    saved.state.results[0].grade = 'mistaken';
    storage.setItem(GENERATED_STORAGE_KEY, JSON.stringify(saved));
    const restored = createGeneratedStore({ generate, storage });
    await vi.waitFor(() => expect(restored.getState().currentScenario).not.toBeNull());
    expect(restored.getState().currentScenario).toEqual(scenario);
    expect(restored.getState().results[0].grade).toBe('preferred');
    expect(restored.getState().currentSession).toMatchObject({ answered: 1, index: 0, limit: 20 });
    expect(restored.getState().submitAction(chosen(scenario).id)).toBe(false);
    restored.getState().replayScenario();
    restored.getState().submitAction(chosen(scenario, 'mistaken').id);
    expect(restored.getState().results).toHaveLength(1);
    expect(await restored.getState().nextScenario()).toBe(true);
  });

  it('resumes an unanswered pending hand and rejects inconsistent attempts', async () => {
    const storage = memoryStorage(),
      first = createGeneratedStore({ generate, storage });
    await first.getState().startSession('endless', { street: 'turn', category: 'drawing-odds' });
    const saved = JSON.parse(storage.getItem(GENERATED_STORAGE_KEY)!);
    const seed = first.getState().currentScenario!.generated!.seed;
    saved.state.currentScenario = null;
    storage.setItem(GENERATED_STORAGE_KEY, JSON.stringify(saved));
    const restored = createGeneratedStore({ generate, storage });
    await vi.waitFor(() => expect(restored.getState().currentScenario?.generated?.seed).toBe(seed));
    saved.state.currentSession.answered = 1;
    expect(sanitizeGeneratedState(saved.state).currentSession).toBeNull();
    expect(
      sanitizeGeneratedState({
        results: [result('x'), result('x'), result('fake', { scored: false })],
      }).results,
    ).toHaveLength(1);
  });

  it('discards an impossible saved action without leaving a phantom answered count', async () => {
    const storage = memoryStorage(),
      original = createGeneratedStore({ generate, storage });
    await original.getState().startSession('endless', { category: 'pot-odds', street: 'flop' });
    original.getState().submitAction(chosen(original.getState().currentScenario!).id);
    const saved = JSON.parse(storage.getItem(GENERATED_STORAGE_KEY)!);
    saved.state.results[0].actionId = 'impossible-action';
    storage.setItem(GENERATED_STORAGE_KEY, JSON.stringify(saved));
    const restored = createGeneratedStore({ generate, storage });
    await vi.waitFor(() => expect(restored.getState().currentScenario).not.toBeNull());
    expect(restored.getState().currentSession?.answered).toBe(0);
    expect(restored.getState().results).toHaveLength(0);
    expect(restored.getState().submitAction(chosen(restored.getState().currentScenario!).id)).toBe(
      true,
    );
    expect(restored.getState().currentSession?.answered).toBe(1);
  });

  it('rejects forged mathematical provenance for preflop heuristics and mismatched sources', () => {
    const spoofedPreflop = result('preflop-fake', {
      category: 'blind-defense',
      street: 'preflop',
      scored: true,
    });
    const spoofedMath = result('math-fake', {
      scored: false,
      source: { category: 'illustrative', label: 'Fake' },
    });
    const honestHeuristic = result('honest', {
      category: 'facing-three-bet',
      street: 'preflop',
      scored: false,
      source: { category: 'illustrative', label: 'Authored heuristic' },
    });
    expect(
      sanitizeGeneratedState({ results: [spoofedPreflop, spoofedMath, honestHeuristic] }).results,
    ).toEqual([honestHeuristic]);
  });

  it('requires exact retained current-session counts while allowing a full retention window', () => {
    const session = {
      id: 's',
      mode: 'endless',
      index: 5,
      answered: 5,
      limit: null,
      completed: true,
      startedAt: '2026-10-11T10:00:00.000Z',
    };
    expect(
      sanitizeGeneratedState({ currentSession: session, results: [result('only-one')] })
        .currentSession,
    ).toBeNull();
    const results = Array.from({ length: GENERATED_HISTORY_LIMIT }, (_, index) =>
      result(`retained-${index}`),
    );
    const retainedSession = {
      ...session,
      answered: GENERATED_HISTORY_LIMIT + 30,
      index: GENERATED_HISTORY_LIMIT + 30,
    };
    expect(
      sanitizeGeneratedState({ currentSession: retainedSession, results }).currentSession,
    ).toEqual(retainedSession);
    const interrupted = [
      ...results.slice(0, -1),
      result('other', { sessionId: 'another-session' }),
    ];
    expect(
      sanitizeGeneratedState({ currentSession: retainedSession, results: interrupted })
        .currentSession,
    ).toBeNull();
  });

  it('keeps training usable with denied/quota storage and exposes the failure', async () => {
    const denied = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const store = createGeneratedStore({ generate, storage: denied });
    await store.getState().startSession('endless', { category: 'pot-odds', street: 'flop' });
    await vi.waitFor(() => expect(store.getState().storageAvailable).toBe(false));
    expect(store.getState().submitAction(chosen(store.getState().currentScenario!).id)).toBe(true);
    expect(await store.getState().nextScenario()).toBe(true);
    expect(store.getState().results).toHaveLength(1);
  });

  it('ignores corrupt JSON and clears only generated progress, retaining preferences', async () => {
    const storage = memoryStorage();
    storage.setItem(GENERATED_STORAGE_KEY, '{invalid');
    storage.setItem('feltlab-training-v1', 'legacy-progress');
    const store = createGeneratedStore({ generate, storage });
    expect(store.getState().currentSession).toBeNull();
    await store.getState().startSession('focused', { street: 'flop', category: 'pot-odds' });
    store.getState().submitAction(chosen(store.getState().currentScenario!).id);
    store.getState().clearProgress();
    expect(store.getState().results).toEqual([]);
    expect(store.getState().preferences.street).toBe('flop');
    expect(storage.getItem('feltlab-training-v1')).toBe('legacy-progress');
  });
});

describe('generation worker lifecycle', () => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: { data: { scenario?: Scenario; error?: string } }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      FakeWorker.instances.push(this);
    }
  }

  it('uses the same reproducible engine when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const input: GenerationOptions = {
      seed: 'fallback-reproducible',
      category: 'pot-odds',
      street: 'turn',
    };
    expect(await generateScenarioAsync(input)).toEqual(generateScenario(input));
  });

  it('terminates a worker on successful completion and rejects mismatched seeds', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const input: GenerationOptions = {
      seed: 'worker-success',
      category: 'pot-odds',
      street: 'flop',
    };
    const promise = generateScenarioAsync(input),
      worker = FakeWorker.instances.at(-1)!;
    expect(worker.postMessage).toHaveBeenCalledWith(input);
    worker.onmessage!({ data: { scenario: generateScenario(input) } });
    expect((await promise).generated?.seed).toBe(input.seed);
    expect(worker.terminate).toHaveBeenCalledOnce();
    const mismatch = generateScenarioAsync(input),
      nextWorker = FakeWorker.instances.at(-1)!;
    const rejected = expect(mismatch).rejects.toThrow('Retry');
    nextWorker.onmessage!({ data: { scenario: generateScenario({ ...input, seed: 'wrong' }) } });
    await rejected;
    expect(nextWorker.terminate).toHaveBeenCalledOnce();
  });

  it('bounds a hung worker and terminates it when cancelled', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.useFakeTimers();
    const input: GenerationOptions = { seed: 'worker-timeout' };
    const pending = generateScenarioAsync(input),
      worker = FakeWorker.instances.at(-1)!;
    const timedOut = expect(pending).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS);
    await timedOut;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const controller = new AbortController(),
      cancelled = generateScenarioAsync(input, controller.signal);
    const aborted = expect(cancelled).rejects.toThrow('cancelled');
    controller.abort();
    await aborted;
    expect(FakeWorker.instances.at(-1)!.terminate).toHaveBeenCalledOnce();
  });
});
