import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDecisionOptions } from '../../engine/evaluation';
import { generateScenario } from '../../engine/generation';
import type { Scenario } from '../../types/poker';
import { useSpotNotebook, type SavedSpot } from './spot-notebook';

const STORAGE_KEY = 'feltlab-notebook-v3';

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

function scenario(seed = 'notebook-fixture'): Scenario {
  return generateScenario({ seed, street: 'preflop', category: 'blind-defense' });
}

function save(spot = scenario()): SavedSpot {
  useSpotNotebook.getState().save(spot, getDecisionOptions(spot)[0].id);
  return useSpotNotebook.getState().spots[0];
}

function storeEntries(spots: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: { spots } }));
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  useSpotNotebook.setState({ spots: [], storageAvailable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saved practice spots', () => {
  it('saves an independent valid scenario snapshot and rejects invalid cards or actions', () => {
    const original = scenario();
    const entry = save(original);
    expect(entry.scenario).toEqual(original);
    expect(entry.scenario).not.toBe(original);
    expect(entry.actionId).toBe(getDecisionOptions(original)[0].id);
    expect(entry.id).toBe(`spot-${original.id}`);
    expect(Number.isFinite(Date.parse(entry.savedAt))).toBe(true);
    original.heroCards[0].rank = original.heroCards[0].rank === 'A' ? 'K' : 'A';
    original.tags.push('Edited after saving');
    expect(entry.scenario.heroCards).not.toEqual(original.heroCards);
    expect(entry.scenario.tags).not.toContain('Edited after saving');

    const invalid = scenario('bad-cards');
    invalid.heroCards[1] = { ...invalid.heroCards[0] };
    useSpotNotebook.getState().save(invalid, getDecisionOptions(invalid)[0].id);
    useSpotNotebook.getState().save(scenario('bad-action'), 'not-an-option');
    useSpotNotebook.getState().save(null as unknown as Scenario, 'not-an-option');
    expect(useSpotNotebook.getState().spots).toHaveLength(1);
  });

  it('accepts mathematical answer IDs without substituting poker actions', () => {
    const math = generateScenario({ seed: 'notebook-math', street: 'flop', category: 'pot-odds' });
    expect(math.exercise?.answers.length).toBeGreaterThan(1);
    const answer = math.exercise!.answers[1];
    useSpotNotebook.getState().save(math, answer.id);
    expect(useSpotNotebook.getState().spots[0].actionId).toBe(answer.id);
    expect(useSpotNotebook.getState().spots[0].scenario.exercise).toEqual(math.exercise);
  });

  it('keeps the original action, metadata and timestamp when the same spot is saved again', () => {
    const spot = scenario();
    const options = getDecisionOptions(spot);
    expect(options.length).toBeGreaterThan(1);
    const entry = save(spot);
    useSpotNotebook.getState().update(entry.id, {
      notes: 'Remember the original price.',
      tags: ['Price'],
      marked: false,
      reviewedAt: '2026-10-13T12:00:00.000Z',
    });
    const first = structuredClone(useSpotNotebook.getState().spots[0]);
    useSpotNotebook.getState().save(structuredClone(spot), options[1].id);
    expect(useSpotNotebook.getState().spots).toEqual([first]);
    expect(useSpotNotebook.getState().spots[0].actionId).toBe(options[0].id);
  });

  it('retains the newest 30 unique spots and does not reorder an existing entry on duplicate save', () => {
    const inputs = Array.from({ length: 35 }, (_, index) => scenario(`notebook-limit-${index}`));
    inputs.forEach((spot) => save(spot));
    expect(useSpotNotebook.getState().spots.map((entry) => entry.scenario.id)).toEqual(
      inputs
        .slice(5)
        .reverse()
        .map((spot) => spot.id),
    );
    const ids = useSpotNotebook.getState().spots.map((entry) => entry.id);
    save(inputs[5]);
    expect(useSpotNotebook.getState().spots.map((entry) => entry.id)).toEqual(ids);
  });

  it('bounds editable metadata while preserving the scenario and first choice', () => {
    const entry = save();
    const original = structuredClone(entry.scenario);
    useSpotNotebook.getState().update(entry.id, {
      notes: 'n'.repeat(3500),
      tags: Array.from({ length: 10 }, () => 't'.repeat(40)),
      marked: true,
      reviewedAt: 'not-a-date',
    });
    const edited = useSpotNotebook.getState().spots[0];
    expect(edited.notes).toHaveLength(3000);
    expect(edited.tags).toHaveLength(8);
    expect(edited.tags.every((tag) => tag.length === 32)).toBe(true);
    expect(edited.reviewedAt).toBeUndefined();
    expect(edited.marked).toBe(true);
    expect(edited.scenario).toEqual(original);
    expect(edited.actionId).toBe(entry.actionId);
    useSpotNotebook.getState().update('unknown-entry', { notes: 'Wrong hand' });
    expect(useSpotNotebook.getState().spots[0]).toEqual(edited);
  });

  it('round-trips saved choices and edits without persisting actions or transient flags', async () => {
    const entry = save();
    useSpotNotebook
      .getState()
      .update(entry.id, { notes: 'Revisit later', tags: ['Defense'], marked: true });
    const expected = structuredClone(useSpotNotebook.getState().spots);
    const encoded = localStorage.getItem(STORAGE_KEY)!;
    const persisted = JSON.parse(encoded);
    expect(persisted.version).toBe(1);
    expect(Object.keys(persisted.state)).toEqual(['spots']);
    useSpotNotebook.setState({ spots: [] });
    localStorage.setItem(STORAGE_KEY, encoded);
    await useSpotNotebook.persist.rehydrate();
    expect(useSpotNotebook.getState().spots).toEqual(expected);
    expect(typeof useSpotNotebook.getState().save).toBe('function');
  });

  it('removes invalid persisted records while retaining a valid neighbor and sanitizing metadata', async () => {
    const valid = structuredClone(save());
    const badCards = structuredClone(valid);
    badCards.id = 'bad-cards';
    badCards.scenario.heroCards[1] = { ...badCards.scenario.heroCards[0] };
    storeEntries([
      null,
      {},
      badCards,
      { ...valid, id: 'bad-action', actionId: 'missing-action' },
      { ...valid, id: 'bad-date', savedAt: 'tomorrow' },
      { ...valid, notes: 42, tags: [null, 'safe', false], marked: 'yes', reviewedAt: 'invalid' },
      valid,
    ]);
    await useSpotNotebook.persist.rehydrate();
    expect(useSpotNotebook.getState().spots).toHaveLength(1);
    expect(useSpotNotebook.getState().spots[0]).toMatchObject({
      id: valid.id,
      actionId: valid.actionId,
      notes: '',
      tags: ['safe'],
      marked: false,
    });
    expect(useSpotNotebook.getState().spots[0].reviewedAt).toBeUndefined();
  });

  it('does not restore duplicate copies of a scenario under forged saved-entry IDs', async () => {
    const valid = structuredClone(save());
    const options = getDecisionOptions(valid.scenario);
    storeEntries([valid, { ...valid, id: 'forged-second-copy', actionId: options[1].id }]);
    await useSpotNotebook.persist.rehydrate();
    expect(useSpotNotebook.getState().spots).toEqual([valid]);
  });

  it('survives malformed storage and quota failures without losing in-memory saved work', async () => {
    const entry = structuredClone(save());
    localStorage.setItem(STORAGE_KEY, '{truncated-json');
    await expect(Promise.resolve(useSpotNotebook.persist.rehydrate())).resolves.toBeUndefined();
    expect(useSpotNotebook.getState().spots).toEqual([entry]);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    const second = scenario('quota-save');
    expect(() => save(second)).not.toThrow();
    await Promise.resolve();
    expect(useSpotNotebook.getState().storageAvailable).toBe(false);
    expect(useSpotNotebook.getState().spots.map((spot) => spot.scenario.id)).toEqual([
      second.id,
      entry.scenario.id,
    ]);
  });

  it('removes only the selected notebook entry and clears persisted notebook records on reset', () => {
    const first = save(scenario('remove-first'));
    const second = save(scenario('remove-second'));
    useSpotNotebook.getState().remove(first.id);
    expect(useSpotNotebook.getState().spots).toEqual([second]);
    useSpotNotebook.getState().clear();
    expect(useSpotNotebook.getState().spots).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.spots).toEqual([]);
  });
});
