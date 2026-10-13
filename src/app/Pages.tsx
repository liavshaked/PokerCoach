import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Layers3,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Spade,
  Trash2,
} from 'lucide-react';
import { BRAND } from '../lib/brand';
import { scenarios } from '../data/scenarios';
import type { Scenario } from '../types/poker';
import { useTrainingStore } from '../features/practice/store';
import { useGeneratedStore } from '../features/practice/generated-store';
import type { StreetFilter } from '../features/practice/store';
import { PlayingCard } from '../components/poker/PlayingCard';
import { Button, Dialog, EmptyState } from '../components/ui/primitives';
const gradeText = { preferred: 'Preferred', defensible: 'Defensible', mistaken: 'Mistaken' };
const streets: { value: StreetFilter; label: string }[] = [
  { value: 'all', label: 'Mixed streets' },
  { value: 'preflop', label: 'Preflop' },
  { value: 'flop', label: 'Flop' },
  { value: 'turn', label: 'Turn' },
  { value: 'river', label: 'River' },
];
export function ScenarioLibrary({
  onPractice,
  onSource,
  active,
}: {
  onPractice: (id: string) => void;
  onSource: () => void;
  active: boolean;
}) {
  const [search, setSearch] = useState('');
  const [street, setStreet] = useState<StreetFilter>('all');
  const [difficulty, setDifficulty] = useState('all');
  const [selected, setSelected] = useState<Scenario | null>(null);
  const filtered = scenarios.filter(
    (spot) =>
      (street === 'all' || spot.street === street) &&
      (difficulty === 'all' || spot.difficulty === difficulty) &&
      `${spot.title} ${spot.description} ${spot.tags.join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const results = useTrainingStore((state) => state.results);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow page-eyebrow">THE STUDY COLLECTION</div>
          <h1>
            A spot for every street<span>.</span>
          </h1>
          <p>Small situations. Big lessons. Choose what you want to work on.</p>
        </div>
        <span className="collection-count">
          <Layers3 size={16} />
          {scenarios.length} curated spots
        </span>
      </div>
      <div className="library-controls">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search scenarios"
            placeholder="Search spots, concepts, or tags…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="select-field">
          <SlidersHorizontal size={15} />
          <select
            aria-label="Filter difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value="all">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
      </div>
      <div className="library-streets">
        {streets.map((item) => (
          <button
            key={item.value}
            className={street === item.value ? 'selected' : ''}
            onClick={() => setStreet(item.value)}
            aria-pressed={street === item.value}
          >
            {item.value === 'all' ? 'All spots' : item.label}
            <span>
              {
                scenarios.filter((spot) => item.value === 'all' || spot.street === item.value)
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="library-grid">
        {filtered.map((spot, index) => {
          const last = results.filter((result) => result.scenarioId === spot.id).at(-1);
          return (
            <button className="scenario-tile" key={spot.id} onClick={() => setSelected(spot)}>
              <div className="tile-header">
                <span className={`street-tag street-${spot.street}`}>{spot.street}</span>
                <span className="tile-number">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <div className="tile-cards">
                {spot.heroCards.map((card, i) => (
                  <PlayingCard card={card} small key={i} />
                ))}
                <span className="tile-card-separator" />
                <span className="tile-board-label">
                  {spot.board.length
                    ? spot.board
                        .map(
                          (card) =>
                            `${card.rank}${{ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[card.suit]}`,
                        )
                        .join(' ')
                    : 'PRE-FLOP'}
                </span>
              </div>
              <h3>{spot.title}</h3>
              <p>{spot.description}</p>
              <div className="tile-footer">
                <span className="difficulty-tag">
                  <span className={`difficulty-dot difficulty-${spot.difficulty}`} />
                  {spot.difficulty}
                </span>
                {last ? (
                  <span className={`result-pill result-${last.grade}`}>
                    {gradeText[last.grade]}
                  </span>
                ) : (
                  <ArrowRight size={16} />
                )}
              </div>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <EmptyState icon={<Search size={24} />} title="No spots in this range.">
          Try a different street, level, or search term.
        </EmptyState>
      )}
      <div className="library-note">
        <ShieldCheck size={16} />
        <p>
          All spots are illustrative / heuristic. Carefully constructed; never presented as solver
          output.
        </p>
        <button className="text-button" onClick={onSource}>
          Our approach
          <ArrowRight size={13} />
        </button>
      </div>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.title ?? 'Scenario'}
        description={selected?.description ?? ''}
      >
        {selected && (
          <>
            <div className="scenario-preview-cards">
              {selected.heroCards.map((card, i) => (
                <PlayingCard card={card} key={i} />
              ))}
              <span>on</span>
              {selected.board.length ? (
                selected.board.map((card, i) => <PlayingCard card={card} small key={i} />)
              ) : (
                <span className="muted">an undealt board</span>
              )}
            </div>
            <div className="preview-meta">
              <span>{selected.street}</span>
              <span>{selected.difficulty}</span>
              <span>
                {selected.heroPosition} vs {selected.opponentPosition}
              </span>
            </div>
            <p className="dialog-copy">{selected.prompt}</p>
            <div className="tag-list">
              {selected.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            {active && (
              <p className="dialog-hint">
                Starting this spot wraps up your active session and keeps its recorded decisions.
              </p>
            )}
            <Button
              onClick={() => {
                onPractice(selected.id);
                setSelected(null);
              }}
            >
              Practice this spot
              <ArrowRight size={16} />
            </Button>
          </>
        )}
      </Dialog>
    </>
  );
}

export function SettingsPage({
  onSource,
  onInstall,
}: {
  onSource: () => void;
  onInstall: () => void;
}) {
  const { settings, updateSettings, clearProgress, results } = useTrainingStore();
  const [clearOpen, setClearOpen] = useState(false);
  const [name, setName] = useState(settings.displayName);
  const [saved, setSaved] = useState(false);
  function exportProgress() {
    const state = useTrainingStore.getState();
    const blob = new Blob(
      [
        JSON.stringify(
          {
            product: BRAND.name,
            version: 2,
            generated: {
              results: useGeneratedStore.getState().results,
              sessions: useGeneratedStore.getState().sessions,
              preferences: useGeneratedStore.getState().preferences,
            },
            exportedAt: new Date().toISOString(),
            results: state.results,
            sessions: state.sessions,
            settings: state.settings,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `feltlab-progress-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow page-eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>
            Your seat, your preferences<span>.</span>
          </h1>
          <p>A few small touches to make practice feel like yours.</p>
        </div>
      </div>
      <div className="settings-layout">
        <div>
          <section className="content-panel settings-panel">
            <h2>At the table</h2>
            <div className="setting-row">
              <div>
                <label htmlFor="display-name">Your display name</label>
                <p>Shown at your seat. Up to 24 characters.</p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  updateSettings({ displayName: name });
                  setName(name.trim() || 'You');
                  setSaved(true);
                }}
              >
                <input
                  id="display-name"
                  maxLength={24}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSaved(false);
                  }}
                />
                <Button type="submit" variant="secondary">
                  {saved ? 'Saved' : 'Save'}
                  {saved && <Check size={14} />}
                </Button>
              </form>
            </div>
            {[
              {
                key: 'animations' as const,
                title: 'Subtle table animations',
                description: 'Smooth card deals and transitions. Respects reduced motion.',
              },
              {
                key: 'keyboardShortcuts' as const,
                title: 'Keyboard shortcuts',
                description:
                  '1–4 for actions. F to fold, C to check or call. Enter for the next spot.',
              },
              {
                key: 'showHints' as const,
                title: 'Show learning hints',
                description: 'Reveal a conceptual nudge before you make a decision.',
              },
            ].map((setting) => (
              <div className="setting-row" key={setting.key}>
                <div>
                  <strong>{setting.title}</strong>
                  <p>{setting.description}</p>
                </div>
                <button
                  className={`switch ${settings[setting.key] ? 'switch-on' : ''}`}
                  role="switch"
                  aria-checked={settings[setting.key]}
                  aria-label={setting.title}
                  onClick={() => updateSettings({ [setting.key]: !settings[setting.key] })}
                >
                  <span />
                </button>
              </div>
            ))}
          </section>
          <section className="content-panel settings-panel">
            <h2>Your data</h2>
            <div className="setting-row">
              <div>
                <strong>Export your progress</strong>
                <p>Download a JSON copy of your decisions, sessions, and preferences.</p>
              </div>
              <Button variant="secondary" onClick={exportProgress}>
                <ArrowDownToLine size={15} />
                Export
              </Button>
            </div>
            <div className="setting-row">
              <div>
                <strong>Start with a clean slate</strong>
                <p>Remove local practice history. Your preferences stay.</p>
              </div>
              <Button variant="danger" onClick={() => setClearOpen(true)}>
                <Trash2 size={15} />
                Reset progress
              </Button>
            </div>
          </section>
        </div>
        <aside className="settings-about">
          <span className="brand-mark">
            <Spade size={22} fill="currentColor" />
          </span>
          <h3>Made for the work.</h3>
          <p>
            FeltLab is a focused heads-up decision trainer. No money, no accounts, just room to
            improve.
          </p>
          <button onClick={onSource}>
            <ShieldCheck size={16} />
            Strategy & transparency
            <ArrowRight size={14} />
          </button>
          <button onClick={onInstall}>
            <ArrowDownToLine size={16} />
            Install on your device
            <ArrowRight size={14} />
          </button>
          <a
            className="license-link"
            href="/licenses/pokersolver-2.1.4-MIT.txt"
            target="_blank"
            rel="noreferrer"
          >
            Hand evaluator ? MIT license
          </a>
          <span className="version-label">FeltLab {BRAND.version} · Volume 01</span>
        </aside>
      </div>
      <Dialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Reset your practice history?"
        description={`This removes ${results.length + useGeneratedStore.getState().results.length} recorded decisions and your session history from this browser. This cannot be undone. Export a copy first if you want to keep it.`}
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setClearOpen(false)}>
            Keep my progress
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              clearProgress();
              useGeneratedStore.getState().clearProgress();
              setClearOpen(false);
            }}
          >
            Reset progress
            <Trash2 size={15} />
          </Button>
        </div>
      </Dialog>
    </>
  );
}
