import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Scenario } from '../../types/poker';
import { validateScenario } from '../../engine/rules';
import { getDecisionOptions } from '../../engine/evaluation';

export interface SavedSpot {
  id: string;
  scenario: Scenario;
  actionId: string;
  notes: string;
  tags: string[];
  marked: boolean;
  savedAt: string;
  reviewedAt?: string;
}
interface Notebook {
  spots: SavedSpot[];
  storageAvailable: boolean;
  save: (scenario: Scenario, actionId: string) => void;
  update: (
    id: string,
    updates: Partial<Pick<SavedSpot, 'notes' | 'tags' | 'marked' | 'reviewedAt'>>,
  ) => void;
  remove: (id: string) => void;
  clear: () => void;
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';
function clean(value: unknown): SavedSpot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 30).flatMap((item) => {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      seen.has(item.id) ||
      !validateScenario(item.scenario).valid ||
      typeof item.actionId !== 'string' ||
      typeof item.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.savedAt))
    )
      return [];
    const scenario = item.scenario as Scenario;
    if (item.id !== `spot-${scenario.id}`) return [];
    if (!getDecisionOptions(scenario).some((action) => action.id === item.actionId)) return [];
    seen.add(item.id);
    return [
      {
        id: item.id,
        scenario,
        actionId: item.actionId,
        savedAt: item.savedAt,
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 3000) : '',
        tags: Array.isArray(item.tags)
          ? item.tags
              .filter((tag): tag is string => typeof tag === 'string')
              .slice(0, 8)
              .map((tag) => tag.slice(0, 32))
          : [],
        marked: item.marked === true,
        reviewedAt:
          typeof item.reviewedAt === 'string' && Number.isFinite(Date.parse(item.reviewedAt))
            ? item.reviewedAt
            : undefined,
      },
    ];
  });
}
export const useSpotNotebook = create<Notebook>()(
  persist(
    (set, get) => ({
      spots: [],
      storageAvailable: true,
      save(scenario, actionId) {
        if (
          !validateScenario(scenario).valid ||
          !getDecisionOptions(scenario).some((action) => action.id === actionId)
        )
          return;
        const existing = get().spots.find((item) => item.scenario.id === scenario.id);
        if (existing) return;
        set({
          spots: [
            {
              id: `spot-${scenario.id}`,
              scenario: structuredClone(scenario),
              actionId,
              notes: '',
              tags: [...scenario.tags].slice(0, 8),
              marked: true,
              savedAt: new Date().toISOString(),
            },
            ...get().spots,
          ].slice(0, 30),
        });
      },
      update(id, updates) {
        set({
          spots: clean(
            get().spots.map((item) => (item.id === id ? { ...item, ...updates } : item)),
          ),
        });
      },
      remove(id) {
        set({ spots: get().spots.filter((item) => item.id !== id) });
      },
      clear() {
        set({ spots: [] });
      },
    }),
    {
      name: 'feltlab-notebook-v3',
      version: 1,
      partialize: ({ spots }) => ({ spots }),
      storage: createJSONStorage(() => ({
        getItem(name) {
          try {
            return localStorage.getItem(name);
          } catch {
            queueMicrotask(() => {
              if (useSpotNotebook.getState().storageAvailable)
                useSpotNotebook.setState({ storageAvailable: false });
            });
            return null;
          }
        },
        setItem(name, value) {
          try {
            localStorage.setItem(name, value);
          } catch {
            queueMicrotask(() => {
              if (useSpotNotebook.getState().storageAvailable)
                useSpotNotebook.setState({ storageAvailable: false });
            });
          }
        },
        removeItem(name) {
          try {
            localStorage.removeItem(name);
          } catch {
            /* Data remains in memory. */
          }
        },
      })),
      merge: (saved, current) => ({ ...current, spots: clean(record(saved) ? saved.spots : []) }),
    },
  ),
);
