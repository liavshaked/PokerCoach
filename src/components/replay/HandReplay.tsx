import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { TableView, type TableViewState } from '../poker/TableView';

export interface ReplayFrame {
  state: TableViewState;
  label: string;
  street: string;
  actor?: number;
  eventIndex: number;
}
export function HandReplay({
  frames,
  initialIndex = 0,
  onClose,
  title = 'Read the whole hand',
}: {
  frames: ReplayFrame[];
  initialIndex?: number;
  onClose?: () => void;
  title?: string;
}) {
  const [index, setIndex] = useState(Math.min(initialIndex, frames.length - 1));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing || index >= frames.length - 1) return;
    const timer = setTimeout(
      () => setIndex((value) => Math.min(value + 1, frames.length - 1)),
      1100 / speed,
    );
    return () => clearTimeout(timer);
  }, [playing, index, frames.length, speed]);
  if (!frames.length) return <p>No recorded actions yet.</p>;
  const frame = frames[Math.max(0, Math.min(index, frames.length - 1))];
  const jump = (value: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(value, frames.length - 1)));
  };
  const streets = frames.flatMap((item, i) =>
    i === 0 || item.street !== frames[i - 1].street ? [{ street: item.street, index: i }] : [],
  );
  return (
    <section className="hand-replay" aria-label="Visual hand replay">
      <div className="replay-heading">
        <div>
          <span className="eyebrow">THE HAND, FRAME BY FRAME</span>
          <h2>{title}</h2>
        </div>
        {onClose && (
          <button className="button button-secondary" onClick={onClose}>
            Return to decision
          </button>
        )}
      </div>
      <TableView state={frame.state} highlightSeat={frame.actor} replay />
      <div className="replay-caption" aria-live="polite">
        <span>
          {String(index + 1).padStart(2, '0')} / {frames.length}
        </span>
        <strong>{frame.label}</strong>
      </div>
      <div className="replay-streets" aria-label="Jump to street">
        {streets.map((item) => (
          <button
            key={item.index}
            className={frame.street === item.street ? 'selected' : ''}
            onClick={() => jump(item.index)}
          >
            {item.street}
          </button>
        ))}
      </div>
      <label className="replay-scrubber">
        Action timeline
        <input
          aria-label="Action timeline"
          type="range"
          min={0}
          max={frames.length - 1}
          value={index}
          onChange={(event) => jump(Number(event.target.value))}
        />
      </label>
      <div className="replay-controls">
        <button aria-label="First action" onClick={() => jump(0)} disabled={index === 0}>
          <SkipBack size={18} />
        </button>
        <button aria-label="Previous action" onClick={() => jump(index - 1)} disabled={index === 0}>
          <ChevronLeft size={21} />
        </button>
        <button
          className="replay-play"
          aria-label={playing && index < frames.length - 1 ? 'Pause replay' : 'Play replay'}
          onClick={() => {
            if (index === frames.length - 1) setIndex(0);
            setPlaying((value) => !value || index === frames.length - 1);
          }}
        >
          {playing && index < frames.length - 1 ? <Pause size={19} /> : <Play size={19} />}
        </button>
        <button
          aria-label="Next action"
          onClick={() => jump(index + 1)}
          disabled={index === frames.length - 1}
        >
          <ChevronRight size={21} />
        </button>
        <button
          aria-label="Last action"
          onClick={() => jump(frames.length - 1)}
          disabled={index === frames.length - 1}
        >
          <SkipForward size={18} />
        </button>
        <label>
          Speed
          <select
            aria-label="Replay speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>
      <details className="replay-event-list">
        <summary>All recorded actions</summary>
        <ol>
          {frames.map((item, i) => (
            <li key={i}>
              <button aria-current={i === index ? 'step' : undefined} onClick={() => jump(i)}>
                <span>{i + 1}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
