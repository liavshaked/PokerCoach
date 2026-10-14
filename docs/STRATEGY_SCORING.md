# Full-hand strategy analysis and scoring

Every hero action is recorded before it is applied: street, position, own cards, current board, public players/stacks/contributions, legal actions, prior public events, chosen canonical action/size and event index. `src/engine/analysis` produces a deterministic explanation from that information set. The completed hand keeps those decisions and their provenance independently of the eventual chip result.

## Evidence actually supplied

- **Mathematical support:** calling price and currently eligible-pot threshold. This is not actual hand equity.
- **Estimated showdown share:** 128 deterministic Monte Carlo completions against authored ranges weighted by public action history. Own cards and the currently visible board remove impossible cards. This estimate informs decisions; it is not the known opponent equity.
- **Model-based action assessment:** agreement with the balanced/advanced `feltlab-calculated-policy-v2` reference, which uses the estimated share, exact calling price, position, effective stack, board features and public aggression.
- **Qualitative coaching:** all-in/side-pot decisions, multi-way postflop and unsupported stack depths still receive situation-specific reasoning, with no action score/grade.
- **Solver-backed full-game scoring:** not supplied. The app does not invent EV loss, solver frequencies or universal GTO accuracy.

The V2 mathematical drills and finite-range river analyses remain distinct. The optional `evaluateSpecifiedRiverRange` provider integrates the existing exact `pokersolver` showdown enumeration and card-removal logic. Its EV is conditional on the explicitly supplied weighted heads-up river range, a terminal call and no rake/future bets. It is not automatically treated as the actual opponent range in a full hand.

## Reviews that explain the decision

The report opens with **What you did well** and **What to work on**, each linked to actual decisions. It highlights the choice carrying the largest pot/price importance weight. This is an educational priority, not a claim that this decision lost the most EV. A good model fit is highlighted only when the decision is in scoring scope; unsupported situations become review questions rather than invented mistakes or praise.

Each decision explains:

1. The exact own cards, visible board, position, pot and chips behind before acting.
2. Why the chosen action fits or deserves reconsideration under the training model.
3. For a call, the amount paid, eligible pot after calling, break-even price, estimated showdown share, and future-betting caveat. A terminal all-in call explicitly has no later payment from the hero.
4. A concrete legal reference line, including additional chips risked and the stack remaining. A raise amount is always a street total, never confused with chips newly added or with BB.
5. A next-hand takeaway about position, range, price, sizing or future risk.

Draw language does not promise clean outs or guaranteed wins. Value-bet language distinguishes current showdown share from the stronger range likely to continue against a bet. No unmeasured fold frequency or expected-profit figure is invented. Table reports count players dealt into the hand, excluding seats already eliminated; surviving heads-up positions receive heads-up explanations even when the original table had six seats.

The score, coverage, source, full assumptions and sampling details are available in collapsed sections. The approximate 95% Monte Carlo sampling margin is `1.96 × standard error`; it describes sampling noise only. Uncertainty about the authored opponent ranges is additional and unmeasured. Coaching and estimated-share fields are optional for older records; normal persistence recovery reconstructs analysis from the authoritative pre-action snapshot.

## Exact pot odds and side-pot eligibility

Let `c` be the legal call amount and let `h` be the hero's total contribution before calling. The hero can only access contributions up to `h+c` per player. The currently eligible pot is therefore:

```text
P_eligible = sum over players min(player.totalCommitted, h + c)
required equity = c / (P_eligible + c)
```

This includes folded-player dead money below the cap and excludes inaccessible higher side pots. If no cap excludes money, it reduces to `call / (current pot + call)`. Future calls/bets, equity realization, rake and range uncertainty are not included. A displayed threshold never asserts that the holding actually has that equity.

## A narrow, explicit model score

Numeric action scores are offered only with 40–200 BB starting depth, no currently all-in player, all-in call or chosen all-in raise/bet, and either a 2–6-player preflop decision or heads-up postflop. Eliminated zero-chip seats do not count toward the scope. This is a training-policy scope, not a proof that those states are solved. Other decisions remain unscored, even if the model suggests an educational line. Elimination-table decisions are evaluated for chip play; tournament payout value and ICM are not modeled.

The reference policy assigns an authored weight to each available action family and selects a legal reference size. For chosen action weight `w` and highest weight `w_max`:

```text
model agreement = 100 × w / w_max
```

For a bet/raise, multiply by `min(chosen additional risk, reference additional risk) / max(those risks)`, where additional risk is the street-total size minus already committed street chips. Scores round to an integer. A legal action outside the reference family receives no weight. These rules transparently measure **agreement with one model**, not expected profit or optimality.

The model combines computed, range-conditional showdown estimates with authored preflop/holding features and realization adjustments. These adjustments and action weights are not solver strategy frequencies. Bands are ≥80 preferred, 40–79 defensible, and <40 a model choice to review; the language is conditional on this reference. Multi-way postflop and all-in spots have no numerical grade. Model confidence is medium, qualitative confidence low. Better numerical inputs do not validate the policy as optimal or expert-level.

## Aggregating the complete hand

Decision importance is a transparent training weight:

```text
importance = 1 + min(3, call / (8 × BB) + current pot / (30 × BB))
confidence weight = 0.55 preflop, 0.40 supported heads-up postflop
hand agreement = weighted mean of scored decisions, using importance × confidence
```

Importance is a pedagogical stake/price proxy, not EV or measured regret. The hand shows a number only when:

1. At least 75% of decisions are scored.
2. At least 75% of total decision-importance weight is scored.
3. No unscored decision has importance ≥3.

Otherwise the overall score is absent and the report presents qualitative review and coverage. A street receives a number only if every decision on that street is scored. Zero decisions or zero credible coverage never receives a default 100. The report identifies contributed decisions, per-street coverage, model-preferred choices, model disagreements and the most important recorded choice. Unsupported EV loss stays `null`; it is omitted from the UI.

## Outcome, spoilers and reproducibility

Chip profit and win/showdown status come directly from engine settlement. Neither appears in the scoring function. A profitable bluff or lost value hand therefore does not retroactively alter decision quality.

Instant feedback may reveal the completed action's analysis. Full-hand feedback waits for settlement, including wins through folds. Session review waits until that session ends; report/notebook entry points share that suppression rule. Newly saved hands receive neutral, empty tags rather than generated coaching concepts. Analysis never needs unrevealed opponent cards or future board events. Stored decision metadata is validated against actual hero-action events during refresh; views and assessments are reconstructed from the exact preceding event prefix. If timestamp metadata is lost, the actual action still recovers and its timestamp is explicitly unknown.

Tests cover capped pot odds, exact finite-range river EV, unsupported/multi-way scope, zero/partial coverage, important unscored decisions, draw/price explanations, additional-risk sizing, heads-up position after eliminations, terminal-call wording, hidden-card/future-deck independence, deterministic policy provenance and outcome-independent aggregation. Improving future scores requires a validated state-matched solver/range provider, not relabeling these weights as GTO data.
