import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { modeledPreflopRange, opponentProfiles } from '../../engine/ranges';
import type { OpponentProfileId } from '../../types/poker';

const ranks = 'AKQJT98765432'.split('');
export default function RangeExplorer() {
  const [profile, setProfile] = useState<OpponentProfileId>('balanced');
  const [context, setContext] = useState<'open' | 'three-bet'>('open');
  const [selected, setSelected] = useState('AKs');
  const matrix = useMemo(() => {
    const range = modeledPreflopRange(profile, context);
    return ranks.flatMap((row, r) =>
      ranks.map((column, c) => {
        const label = r === c ? `${row}${column}` : r < c ? `${row}${column}s` : `${column}${row}o`;
        const combos = range.filter((combo) => {
          const [a, b] = combo.cards;
          return r === c
            ? a.rank === row && b.rank === row
            : ((a.rank === row && b.rank === column) || (a.rank === column && b.rank === row)) &&
                (r < c ? a.suit === b.suit : a.suit !== b.suit);
        });
        const possible = r === c ? 6 : r < c ? 4 : 12;
        return {
          label,
          row: r,
          col: c,
          combos: combos.length,
          possible,
          weight: combos.reduce((sum, combo) => sum + combo.weight, 0) / possible,
        };
      }),
    );
  }, [profile, context]);
  const hand = matrix.find((item) => item.label === selected)!;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow page-eyebrow">SEE THE WHOLE RANGE</span>
          <h1>
            The range explorer<span>.</span>
          </h1>
          <p>Inspect the authored range behind your heads-up practice.</p>
        </div>
        <span className="provenance-badge">Educational model</span>
      </div>
      <div className="range-layout">
        <section className="content-panel range-panel">
          <div className="range-filters">
            <label>
              Opponent model
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value as OpponentProfileId)}
              >
                {opponentProfiles.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Previous action
              <select
                value={context}
                onChange={(e) => setContext(e.target.value as 'open' | 'three-bet')}
              >
                <option value="open">BTN opens · hero in BB</option>
                <option value="three-bet">BB three-bets · hero on BTN</option>
              </select>
            </label>
          </div>
          <div className="range-matrix" role="group" aria-label="13 by 13 starting hand matrix">
            {matrix.map((cell, index) => (
              <button
                key={cell.label}
                tabIndex={selected === cell.label ? 0 : -1}
                className={`range-cell ${selected === cell.label ? 'range-cell-selected' : ''} weight-${cell.weight === 0 ? 'none' : cell.weight < 0.4 ? 'light' : cell.weight < 0.8 ? 'medium' : 'strong'}`}
                aria-label={`${cell.label}: ${(cell.weight * 100).toFixed(0)} percent modeled membership weight`}
                aria-pressed={selected === cell.label}
                onClick={() => setSelected(cell.label)}
                onKeyDown={(event) => {
                  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -13, ArrowDown: 13 }[
                    event.key
                  ];
                  if (offset !== undefined) {
                    event.preventDefault();
                    const next = (index + offset + 169) % 169;
                    setSelected(matrix[next].label);
                    (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
                  }
                }}
              >
                {cell.label}
              </button>
            ))}
          </div>
          <div className="range-legend">
            <span>
              <i className="weight-strong" />
              High membership
            </span>
            <span>
              <i className="weight-medium" />
              Partial membership
            </span>
            <span>
              <i className="weight-none" />
              Outside model
            </span>
          </div>
          <label className="range-hand-select">
            Inspect a hand
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {matrix.map((item) => (
                <option key={item.label}>{item.label}</option>
              ))}
            </select>
          </label>
        </section>
        <aside className="content-panel range-inspector">
          <span className="eyebrow">INSIDE THE MODEL</span>
          <h2>{hand.label}</h2>
          <strong>{(hand.weight * 100).toFixed(0)}% membership weight</strong>
          <p>
            {hand.combos} of {hand.possible} suit combinations included before card removal.
          </p>
          <div className="range-assumptions">
            <ShieldCheck size={19} />
            <div>
              <strong>Heads-up · 100 BB · no rake</strong>
              <p>
                Only this configuration is supported. This matrix shows weighted range membership,
                not raise/call/fold frequencies or a validated chart.
              </p>
            </div>
          </div>
          <p>{opponentProfiles.find((item) => item.id === profile)?.description}</p>
          <p>
            Pairs sit on the diagonal. Suited hands are above it; offsuit hands are below. Weights
            come from hand structure and profile parameters, not a solver. No chart is silently
            carried into six-player games.
          </p>
          <a href="#practice" className="button button-secondary">
            Back to practice
          </a>
        </aside>
      </div>
    </>
  );
}
