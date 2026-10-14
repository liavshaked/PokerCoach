import { useState } from 'react';
import { Bookmark, Play, Search, Star, Trash2 } from 'lucide-react';
import { useTableStore } from '../table/store';
import { canRevealHandRecord, type SavedFullHand } from '../table/types';
import { useSpotNotebook, type SavedSpot } from './spot-notebook';
import { HandReplay, type ReplayFrame } from '../../components/replay/HandReplay';
import { gameReplayFrames } from '../../components/replay/game-replay';
import { spotReplayFrames } from '../practice/spot-replay';
import { HandReport } from '../../components/feedback/HandReport';
import { CoachingPanel } from '../../components/feedback/CoachingPanel';
import { Button, Dialog, EmptyState } from '../../components/ui/primitives';

export default function NotebookPage({ deferSpots = false }: { deferSpots?: boolean }) {
  const table = useTableStore();
  const notebook = useSpotNotebook();
  const [search, setSearch] = useState('');
  const [marked, setMarked] = useState(false);
  const [street, setStreet] = useState('all');
  const [selected, setSelected] = useState<{ type: 'hand' | 'spot'; id: string } | null>(null);
  const [replay, setReplay] = useState<{ frames: ReplayFrame[]; index: number } | null>(null);
  const [remove, setRemove] = useState<{ type: 'hand' | 'spot'; id: string } | null>(null);
  const matches = (
    item: { notes: string; tags: string[]; marked: boolean },
    title: string,
    streets: string[],
  ) =>
    (!marked || item.marked) &&
    (street === 'all' || streets.includes(street)) &&
    `${title} ${item.notes} ${item.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase());
  const hands = table.savedHands.filter((item) =>
    matches(
      canRevealHandRecord(table.config, item, table.session) ? item : { ...item, tags: [] },
      `Hand ${item.state.handNumber} ${item.state.players.length} players`,
      item.decisions.map((decision) => decision.view.table.street),
    ),
  );
  const spots = notebook.spots.filter((item) =>
    matches(deferSpots ? { ...item, tags: [] } : item, item.scenario.title, [item.scenario.street]),
  );
  const hand =
    selected?.type === 'hand'
      ? table.savedHands.find((item) => item.id === selected.id)
      : undefined;
  const spot =
    selected?.type === 'spot' ? notebook.spots.find((item) => item.id === selected.id) : undefined;
  const entry = hand ?? spot;
  const edit = (changes: Partial<Pick<SavedSpot, 'notes' | 'tags' | 'marked'>>) => {
    if (hand) table.updateSavedHand(hand.id, changes);
    if (spot) notebook.update(spot.id, changes);
  };
  const openHandReplay = (record: SavedFullHand, index = 0) => {
    setSelected(null);
    setReplay({ frames: gameReplayFrames(record.state), index });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow page-eyebrow">YOUR STUDY NOTEBOOK</span>
          <h1>
            Keep the lesson<span>.</span>
          </h1>
          <p>Save a hand. Find the turning point. Come back with a clearer read.</p>
        </div>
        <span className="collection-count">
          <Bookmark size={16} />
          {table.savedHands.length + notebook.spots.length} saved
        </span>
      </div>
      <div className="notebook-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search saved hands"
            placeholder="Search hands, notes, or tags"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter saved street"
          value={street}
          onChange={(e) => setStreet(e.target.value)}
        >
          {['all', 'preflop', 'flop', 'turn', 'river'].map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? 'Every street' : value}
            </option>
          ))}
        </select>
        <button
          className={`button button-secondary ${marked ? 'selected' : ''}`}
          aria-pressed={marked}
          onClick={() => setMarked(!marked)}
        >
          <Star size={15} />
          Marked for review
        </button>
      </div>
      <div className="notebook-grid">
        {hands.map((item) => (
          <article className="notebook-card" key={item.id}>
            <span className="eyebrow">FULL HAND · {item.state.players.length} PLAYERS</span>
            <h2>Hand {item.state.handNumber}</h2>
            <p>
              {item.decisions.length} hero decisions ·{' '}
              {item.state.result?.reason === 'showdown' ? 'Showdown' : 'Won without showdown'}
            </p>
            <p>{item.notes || 'What would you want to remember next time?'}</p>
            <div className="tag-list">
              {canRevealHandRecord(table.config, item, table.session) &&
                item.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <div className="notebook-card-actions">
              <Button
                variant="secondary"
                onClick={() => setSelected({ type: 'hand', id: item.id })}
              >
                Review & notes
              </Button>
              <button
                className="icon-button"
                aria-label={`Replay saved hand ${item.state.handNumber}`}
                onClick={() => openHandReplay(item)}
              >
                <Play size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={`Mark hand ${item.state.handNumber} for review`}
                aria-pressed={item.marked}
                onClick={() => table.updateSavedHand(item.id, { marked: !item.marked })}
              >
                <Star size={17} fill={item.marked ? 'currentColor' : 'none'} />
              </button>
            </div>
          </article>
        ))}
        {spots.map((item) => (
          <article className="notebook-card" key={item.id}>
            <span className="eyebrow">PRACTICE SPOT · {item.scenario.street}</span>
            <h2>{item.scenario.title}</h2>
            <p>{item.notes || item.scenario.description}</p>
            <div className="tag-list">
              {!deferSpots && item.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <div className="notebook-card-actions">
              <Button
                variant="secondary"
                onClick={() => setSelected({ type: 'spot', id: item.id })}
              >
                Review & notes
              </Button>
              <button
                className="icon-button"
                aria-label={`Replay ${item.scenario.title}`}
                onClick={() => setReplay({ frames: spotReplayFrames(item.scenario), index: 0 })}
              >
                <Play size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={`Mark ${item.scenario.title} for review`}
                aria-pressed={item.marked}
                onClick={() => notebook.update(item.id, { marked: !item.marked })}
              >
                <Star size={17} fill={item.marked ? 'currentColor' : 'none'} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {hands.length + spots.length === 0 && (
        <EmptyState
          icon={<Bookmark size={25} />}
          title={
            search || marked || street !== 'all'
              ? 'No matching hands.'
              : 'Your next lesson belongs here.'
          }
          action={
            <a className="button button-primary" href="#table">
              Go to the table
            </a>
          }
        >
          Save a completed hand from its report, or save a decision from the practice room.
        </EmptyState>
      )}
      <p className="panel-description">
        Stored on this device: up to 100 full hands and 30 practice spots. Notes and tags save as
        you type. Export a copy in Settings.
      </p>
      <Dialog
        className="replay-dialog"
        open={Boolean(entry)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={spot?.scenario.title ?? `Hand ${hand?.state.handNumber ?? ''}`}
        description="Your original decisions and a space for your own thinking."
      >
        {entry && (
          <>
            <div className="notebook-editor">
              <label>
                Your notes
                <textarea
                  aria-label="Hand notes"
                  maxLength={3000}
                  value={entry.notes}
                  onChange={(e) => edit({ notes: e.target.value })}
                  placeholder="What changed your decision? What would you try next time?"
                />
              </label>
              {((hand && canRevealHandRecord(table.config, hand, table.session)) ||
                (spot && !deferSpots)) && (
                <label>
                  Tags, separated by commas
                  <input
                    aria-label="Hand tags"
                    maxLength={264}
                    key={entry.id}
                    defaultValue={entry.tags.join(', ')}
                    onChange={(e) =>
                      edit({
                        tags: e.target.value
                          .split(',')
                          .slice(0, 8)
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              )}
              <label className="checkbox-setting">
                <input
                  type="checkbox"
                  checked={entry.marked}
                  onChange={(e) => edit({ marked: e.target.checked })}
                />
                Mark for another review
              </label>
              <Button
                variant="danger"
                onClick={() => {
                  setRemove(selected);
                  setSelected(null);
                }}
              >
                <Trash2 size={15} />
                Remove from notebook
              </Button>
            </div>
            {hand && (
              <HandReport
                record={hand}
                reveal={canRevealHandRecord(table.config, hand, table.session)}
                onReplay={(index) => openHandReplay(hand, index)}
              />
            )}
            {spot &&
              (deferSpots ? (
                <p className="feedback-pending">
                  Finish your practice session to unlock saved-spot analysis.
                </p>
              ) : (
                <CoachingPanel
                  scenario={spot.scenario}
                  selectedActionId={spot.actionId}
                  active
                  showHints={false}
                  onNext={() => setSelected(null)}
                  onReplay={() => {
                    setSelected(null);
                    setReplay({ frames: spotReplayFrames(spot.scenario), index: 0 });
                  }}
                  onSource={() => {
                    window.location.hash = 'settings';
                    setSelected(null);
                  }}
                  last={false}
                  busy={false}
                />
              ))}
          </>
        )}
      </Dialog>
      <Dialog
        className="replay-dialog"
        open={Boolean(replay)}
        onOpenChange={(open) => {
          if (!open) setReplay(null);
        }}
        title="Notebook replay"
        description="A visual record of the hand as it happened."
      >
        {replay && <HandReplay frames={replay.frames} initialIndex={replay.index} />}
      </Dialog>
      <Dialog
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title="Remove this saved hand?"
        description="Its notebook notes and tags will be removed. Your training history stays."
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRemove(null)}>
            Keep hand
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (remove?.type === 'hand') table.removeSavedHand(remove.id);
              if (remove?.type === 'spot') notebook.remove(remove.id);
              setRemove(null);
            }}
          >
            Remove hand
          </Button>
        </div>
      </Dialog>
    </>
  );
}
