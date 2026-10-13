import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Lightbulb,
  RotateCcw,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { Scenario } from '../../types/poker';
import { evaluateDecision } from '../../engine/evaluation';
import { bb } from '../poker/PlayingCard';
import { Button, Tip } from '../ui/primitives';

const gradeLabels = {
  preferred: 'Preferred decision',
  defensible: 'Defensible decision',
  mistaken: 'Room to improve',
};
const streetLabels = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

export function CoachingPanel({
  scenario,
  selectedActionId,
  active,
  showHints,
  onNext,
  onReplay,
  onSource,
  last,
  busy = false,
}: {
  scenario: Scenario;
  selectedActionId: string | null;
  active: boolean;
  showHints: boolean;
  onNext: () => void;
  onReplay: () => void;
  onSource: () => void;
  last: boolean;
  busy?: boolean;
}) {
  const [hintOpen, setHintOpen] = useState(false);
  const feedback = selectedActionId ? evaluateDecision(scenario, selectedActionId) : null;
  return (
    <aside
      className={`coaching-panel ${feedback ? 'has-feedback' : ''}`}
      aria-label="Scenario context and coaching"
    >
      <div className="panel-topline">
        <span className="eyebrow">{feedback ? 'THE REVIEW' : 'THE SPOT'}</span>
        <BookOpen size={16} />
      </div>
      <div className="spot-tags">
        <span className={`street-tag street-${scenario.street}`}>
          {streetLabels[scenario.street]}
        </span>
        <span className="difficulty-tag">
          <span className={`difficulty-dot difficulty-${scenario.difficulty}`} />
          {scenario.difficulty}
        </span>
      </div>
      <h2>{scenario.title}</h2>
      <p className="scenario-description">{scenario.description}</p>
      <button className="source-label" onClick={onSource}>
        <span className="tiny-dot" />
        {scenario.source.category === 'mathematical-model'
          ? 'Mathematical model'
          : 'Illustrative / heuristic'}{' '}
        <CircleHelp size={12} />
      </button>
      {scenario.generated && <ModelAssumptions scenario={scenario} />}
      {feedback ? (
        <div className="feedback-content" key={selectedActionId} aria-live="polite">
          <div className={`decision-grade grade-${feedback.grade}`}>
            <span className="grade-icon">
              {feedback.grade === 'mistaken' ? <X size={17} /> : <Check size={17} />}
            </span>
            <div>
              <span>{gradeLabels[feedback.grade]}</span>
              <strong>You chose {feedback.chosenAction.label.toLowerCase()}</strong>
            </div>
          </div>
          <div className="recommended">
            <span className="eyebrow">PREFERRED IN THIS SPOT</span>
            <strong>
              {feedback.recommendedActions.map((action) => action.label).join(' or ')}
            </strong>
          </div>
          <p className="feedback-explanation">{feedback.explanation}</p>
          {scenario.generated?.math && <ModelNumbers scenario={scenario} />}
          {feedback.potOdds !== null && (
            <div className="pot-odds-box">
              <div>
                <span>Break-even equity</span>
                <Tip text="Pot odds set an equity threshold. They do not tell us your hand’s actual equity.">
                  <button className="help-button" aria-label="What are pot odds?">
                    <CircleHelp size={13} />
                  </button>
                </Tip>
                <strong>{(feedback.potOdds * 100).toFixed(1)}%</strong>
              </div>
              <p>
                {bb(scenario.toCall)} to call ÷ ({bb(scenario.currentPot)} + {bb(scenario.toCall)})
              </p>
              <small>Before future betting and equity realization.</small>
            </div>
          )}
          <div className="principle-box">
            <Lightbulb size={17} />
            <div>
              <span className="eyebrow">TAKE THIS WITH YOU</span>
              <p>{feedback.principle}</p>
            </div>
          </div>
          <details className="deep-dive">
            <summary>
              Go a little deeper <ChevronDown size={14} />
            </summary>
            <p>{feedback.reasoning}</p>
            <p>{feedback.deepDive}</p>
          </details>
          <Button className="next-button" onClick={onNext} disabled={busy}>
            {busy ? 'Preparing hand…' : last ? 'Finish session' : 'Next spot'}
            <ArrowRight size={17} />
          </Button>
          <button className="text-button replay-link" onClick={onReplay}>
            <RotateCcw size={13} />
            Try another line
          </button>
          <p className="replay-note">Replays keep your first attempt in progress.</p>
        </div>
      ) : (
        <>
          <div className="history-section">
            <h3>
              How we got here <span>BB</span>
            </h3>
            <div className="history-list">
              {scenario.history.map((action, index) => {
                const newStreet =
                  index === 0 || action.street !== scenario.history[index - 1].street;
                const label =
                  action.kind === 'raise'
                    ? 'raises to'
                    : action.kind === 'bet'
                      ? 'bets'
                      : action.kind === 'call'
                        ? 'calls'
                        : action.kind === 'check'
                          ? 'checks'
                          : action.kind === 'fold'
                            ? 'folds'
                            : 'posts blind';
                return (
                  <div key={index}>
                    {newStreet && (
                      <span className="history-street">{streetLabels[action.street]}</span>
                    )}
                    <div className="history-row">
                      <span
                        className={`history-marker ${action.actor === 'hero' ? 'marker-hero' : ''}`}
                      />
                      <span className="history-actor">
                        {action.actor === 'hero' ? 'You' : 'Opponent'}
                      </span>
                      <span>
                        {label}
                        {action.amount ? (
                          <>
                            {' '}
                            <strong>{action.amount}</strong>
                          </>
                        ) : (
                          ''
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="decision-prompt">
            <span className="eyebrow">{active ? 'YOUR DECISION' : 'READY WHEN YOU ARE'}</span>
            <p>
              {active
                ? scenario.prompt
                : 'One spot. One decision. A little more understanding every hand.'}
            </p>
          </div>
          {active && (
            <div className="hint-box">
              <button onClick={() => setHintOpen(!hintOpen)} aria-expanded={hintOpen || showHints}>
                <Lightbulb size={15} />A nudge, if you need it
                <ChevronDown size={14} />
              </button>
              {(hintOpen || showHints) && <p>{scenario.hint}</p>}
            </div>
          )}
          {!active && (
            <div className="session-promise">
              <Check size={14} />
              <span>Thoughtful feedback after every decision</span>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function ModelAssumptions({ scenario }: { scenario: Scenario }) {
  const [open, setOpen] = useState(false);
  const metadata = scenario.generated!;
  const range = metadata.range;
  const total = range?.reduce((sum, combo) => sum + combo.weight, 0) ?? 0;
  const suits = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
  return (
    <details className="model-assumptions" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        Model & opponent range <ChevronDown size={14} />
      </summary>
      {open && (
        <>
          <p>
            {metadata.scored
              ? 'Scored against the explicit mathematical model.'
              : 'Educational model. Excluded from mathematical scores.'}
          </p>
          <ul>
            {metadata.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {range && (
            <>
              <p>
                {range.length} explicit weighted combinations.{' '}
                {metadata.category === 'river-bluff-catching'
                  ? 'Weights below are before hero removal; blocked hands contribute no equity weight. Remaining weights are renormalized for equity.'
                  : 'Known hero cards have already been removed. Weights describe authored range membership, not action frequencies.'}
              </p>
              <div className="range-combos">
                {range.map((combo, index) => (
                  <span key={index}>
                    {combo.cards.map((card) => `${card.rank}${suits[card.suit]}`).join(' ')}
                    <small>{total ? ((combo.weight / total) * 100).toFixed(1) : 0}%</small>
                  </span>
                ))}
              </div>
            </>
          )}
          <p className="seed-label">Reproduce: {metadata.seed}</p>
        </>
      )}
    </details>
  );
}

function ModelNumbers({ scenario }: { scenario: Scenario }) {
  const math = scenario.generated!.math!;
  const values: [string, string][] = [];
  if (math.equity !== undefined)
    values.push(['Showdown equity', `${(math.equity * 100).toFixed(2)}%`]);
  if (math.tieProbability !== undefined)
    values.push(['Tie probability', `${(math.tieProbability * 100).toFixed(2)}%`]);
  if (math.callEv !== undefined)
    values.push(['Call EV', `${math.callEv >= 0 ? '+' : ''}${math.callEv.toFixed(2)} BB`]);
  if (math.foldEv !== undefined) values.push(['Fold EV', `${math.foldEv.toFixed(2)} BB`]);
  if (math.outs !== undefined) values.push(['Outs to target', String(math.outs)]);
  if (math.drawProbability !== undefined)
    values.push(['Draw probability', `${(math.drawProbability * 100).toFixed(2)}%`]);
  if (math.bluffBreakEven !== undefined)
    values.push(['Break-even folds', `${(math.bluffBreakEven * 100).toFixed(2)}%`]);
  if (math.rangeCombos !== undefined) values.push(['Legal range combos', String(math.rangeCombos)]);
  return values.length ? (
    <div className="model-numbers">
      <dl>
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>Exact for this stated model. No rake; river calls end at showdown.</p>
    </div>
  ) : null;
}
