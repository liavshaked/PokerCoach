# FeltLab architecture

FeltLab is a local-first React/TypeScript/Vite PWA. V3 adds complete 2-, 3- and 6-seat No-Limit Hold'em tables, event-driven replay, full-hand decision records and a personal notebook. The original curated and generated training modes remain intact. Core gameplay requires no account, paid API, Python server, language model or downloaded research agent.

## Separation of concerns

- `src/engine/game`: authoritative complete-hand rules, seeded dealing, individual/cumulative short-all-in reopening, refunds, side pots, showdown, serialization and event-prefix replay. Its `types.ts` defines V3 private/public state independently of preserved V2 scenario types.
- `src/engine/agents`: six authored opponent profiles, position/range/board features, legal sizing and bounded adaptation from public observations.
- `src/engine/analysis`: recorded pre-action information sets, eligible-pot odds, model-agreement scoring, qualitative review and coverage-aware hand aggregation.
- `src/features/table`: one-actor progression, stale-token guards, sessions, hero decisions, pause/resume, event persistence and saved full hands.
- `src/components/replay`: game-event prefixes projected into the shared table renderer, with timeline playback and street navigation. `src/features/practice/spot-replay.ts` adapts authoritative V2 spot history.
- `src/features/notebook`: saved Practice spots, full-hand review, notes, tags and review marks.
- `src/engine/providers`: dormant server-side contract for a future authorized analysis provider; no browser secrets or enabled paid transport.
- `src/types/poker.ts`: cards, positions, betting history, public/private state, scenario provenance, weighted combinations and generated exercise metadata.
- `src/engine/cards`: deck construction, unique-card assertions and card formatting.
- `src/engine/rules`: strict runtime shape validation and replay of the supported heads-up betting model. Amounts are BB; bets/raises are total street commitments, while calls/posts are chips added.
- `src/engine/equity`: browser-compatible MIT `pokersolver` wrapper, weighted-range validation, card removal and exact terminal river equity including ties.
- `src/engine/math`: independently tested call/fold EV, draw probability without replacement and pure-bluff break-even price.
- `src/engine/ranges`: explicit authored profile parameters, weighted heads-up preflop combination ranges and structural ranking. These are not solver policies.
- `src/engine/strategies`: public-state allowlist, curated opponent adapter, verified-frequency import/sampling boundary and a deliberately limited preflop range-policy interface.
- `src/engine/generation`: seeded PRNG, valid history builders, preflop range drills, finite weighted river models and flop/turn mathematics.
- `src/engine/evaluation`: common decision-option and coaching interface. Math answers and real poker actions remain separate types.
- `src/data/scenarios`: 16 preserved curated scenarios with a fault-isolated loader. Invalid entries are omitted with structured issues rather than crashing the entire pack.
- `src/features/practice`: original curated store plus generated-session store, worker/client boundary, persistence, recovery, cancellation and source-aware result recording.
- `src/components` and `src/app`: reusable presentation, responsive table/cards, navigation and coaching. React components do not derive poker grades or recalculate model strategy.

## Complete-hand engine

```ts
let hand = createHand({
  seed: 'session-42:hand-1',
  smallBlind: 0.5,
  bigBlind: 1,
  chipUnit: 0.5,
  players: [
    { id: 'hero', name: 'You', stack: 100 },
    { id: 'opponent', name: 'Opponent', stack: 100 },
  ],
});
const options = getLegalActions(hand);
hand = applyAction(hand, { type: 'call' });
const loaded = deserializeHand(serializeHand(hand));
```

Amounts are configured chips, with default blinds 0.5/1 and stacks of 100. Bets/raises specify **total street commitment**; calls specify additional chips. Every amount lies on `chipUnit`. Commitments and payouts are normalized, and split pots are divided in integer chip units. Odd chips go to tied winners clockwise beginning left of the button, separately for each pot.

The seeded deck is private engine state. Hole cards are dealt one per player per pass clockwise from the button; a burn precedes each community street. With two funded players, the button is the small blind and acts first preflop, and the big blind acts first postflop. On larger tables, preflop begins left of the big blind and postflop left of the button.

The engine tracks the last full raise and the wager level each player last acted on. A short all-in preserves the full-raise increment. Multiple short all-ins reopen a player's action only when the cumulative increase that player faces reaches that increment. Forced posts do not consume the big blind's option. Raises are unavailable when no live opponent can cover more than the existing wager.

Practice cash tables declare TDA-style full-wager reopening, including an earlier checker facing an opening all-in below the minimum bet. The known PokerKit 0.7.7 divergence on that edge is documented in `V3_EXTERNAL_TOOLS.md`; the independent oracle is finite evidence, not authority over every house-rule choice.

Unmatched chips are returned before the next street or settlement. Contribution layers create main and side pots: folded players contribute but cannot win. Each pot has independent winners, ties and payouts. Fold wins end without dealing future cards; matched all-ins run out the actual remaining board. The existing `pokersolver` wrapper supplies best-five showdown comparisons.

`nextHand` preserves stacks and rotates the button. The generic engine retains an optional zero-stack-only rebuy mode, but AI table sessions always disable it, including legacy saves. Zero-stack seats sit out; dealing/positions use funded seats while original table geometry remains. After settlement the store records eliminations, continues if the hero is out, and declares the sole funded seat the winner. Simultaneous eliminations rank larger entering stacks ahead of smaller ones; equal stacks tie. Fixed blinds continue with no hand limit or artificial winner cutoff.

## Events, replay and private state

The authority is a sequence of `hand-started`, `blind-posted`, private `hole-cards-dealt`, validated `action`, `uncalled-returned`, `board-dealt` and `hand-settled` events. Event objects and arrays are frozen. Actions return new state without changing earlier state. Serialization stores version 3 and events rather than trusting a snapshot. Import reduces them through the same rules, rejecting unknown events, invalid blind/deal order, fabricated payments, illegal sizes and incorrect settlement.

`replayHand(events, eventCount)` reduces an exclusive prefix: count 1 is hand-start; the full count reconstructs final state. Replay adds no events beyond that prefix. The adapter projects each prefix into shared `TableViewState`, supplying historical board, stacks, wagers, folds, dealer and actor. `HandReplay` provides stepping, playback, scrubbing, street jumps and speed controls.

Practice replay directly folds authoritative V2 action history, inserting board-deal frames at recorded street boundaries. It uses the same amount convention and only the applicable board prefix. Known hero cards remain visible, opponent cards stay unknown and replay returns to the unanswered decision. Single-decision histories remain V2 data; they are not relabeled as fully dealt V3 hands.

Full `GameState` is private simulation/persistence state. Explicit projections cross application boundaries:

- `getPublicState` allows public seats, balances, visible board and sanitized events; it excludes seed, deck, private initialization, burns and unrevealed hands.
- `getAgentView(state, playerId)` adds only that player's own cards and legal actions.
- `getPublicView(state, viewerSeat)` additionally reveals the UI viewer's own hand. Agents never consume this viewer projection.
- Other live hands appear only after the actual showdown event. Folded hands remain unknown; uncontested outcomes do not reveal opponents.
- Public dealing events omit private cards. Replay receives no future actions, board cards or coaching answers.

Offline simulation retains private cards locally, so a determined user can inspect browser memory. App and agent interfaces nevertheless obey poker information sets. External secrets are never browser configuration.

## Policies, decisions and scoring

Policies support balanced, tight-aggressive, loose-aggressive, passive, tricky and exploitative profiles. They consume only `AgentView`, legal windows and observed public actions. The calculated policy samples hidden holdings from assumed public-action-conditioned ranges and unseen runouts, then compares estimated showdown equity with eligible-pot call price. Position, realization discounts, stack-to-pot ratio, multiway pressure, board texture and sizing affect authored action distributions. The simulation evaluator is independently compared with the existing showdown evaluator. Samples never use the true unseen deck or opponents' hands. Difficulty changes documented simplifications; it does not establish professional or superhuman strength.

The table store advances one actor at a time. Hand ID, event count and actor form a token rejecting duplicate/stale submissions and duplicate deals. Fast-forward repeats legal bot steps only until a hero decision or hand completion, with a 300-action guard. UI timers cancel when state, pause, dialogs or session changes. A completed hand automatically deals after four seconds; reviews and replay pause both bot progression and dealing. Hero records contain the **pre-action information set**, chosen action and event index. Refresh reconstructs decisions from validated prefixes instead of trusting saved grades. Shared current/recent/saved histories are analyzed once per hydration. Elimination metadata and the winner recover from authoritative balances and retained histories; an all-in player is not out until settlement.

Analysis separates mathematical prices, model agreement and qualitative commentary. Eligible-pot odds exclude side pots the hero cannot win. Optional exact river analysis enumerates a specified finite weighted range. Full-hand numeric evaluation compares choices with an identified authored policy and does not fabricate solver EV. All-in/side-pot valuation, uncertain multi-way postflop states and unsupported stack depths remain unscored.

An overall model-agreement number requires at least 75% count and importance coverage, with no high-importance unscored decision. Supported decisions use confidence × importance weights. Chip results never determine the score. Feedback timing gates instant, hand-end and session-end review; `STRATEGY_SCORING.md` documents the exact rule.

The external-analysis contract is dormant and belongs to a separately authorized server. No paid transport, credentials or invented solver results are enabled. Research decisions are in `V3_EXTERNAL_TOOLS.md`.

## Preserved V2 procedural contract

```ts
const scenario = generateScenario({
  seed: 'session-id:decision-index',
  street: 'river', // optional
  category: 'river-bluff-catching', // optional
  profile: 'balanced', // optional; baseline model
  difficulty: 'intermediate', // optional
});
```

`generateScenario` returns an ordinary `Scenario` plus `generated` metadata (version, seed, category, profile, assumptions, evaluation provenance, mathematical values and optional exact weighted range). Math exercises add `exercise.question` and `exercise.answers`. `getDecisionOptions(scenario)` supplies the appropriate controls, and `evaluateDecision` returns unified coaching without treating quiz answers as betting actions.

Every generated output is validated before leaving the engine. Unsupported category/street/profile combinations throw useful errors. There is no silent substitution of a fake solved hand. IDs include version, seed and resolved options. `generationOptions(scenario)` reconstructs the options needed to reproduce the same scenario; changes to the generator require a deliberate version change.

Category compatibility is explicit: blind defense and three-bet response are preflop; drawing odds is flop/turn; river bluff catching and pure-bluff mathematics are river; pot odds supports every street. Difficulty changes the generated task: beginner preflop favors structurally clear hands, advanced favors middle-strength holdings; postflop histories and bet fractions become more involved; math answers become closer together, and advanced flop draw drills use a two-card horizon. This is authored task complexity, not empirically calibrated learner difficulty or solver precision.

## Responsive runtime and persistence

Generation runs in a dedicated Web Worker in browsers. The client enforces a timeout and terminates completed or cancelled workers; environments without Worker support use the same engine through a lazy import. The generated store guards duplicate submissions and in-flight transitions, records compact source-aware results and limits retained history. Fresh generation requests are seeded and replayable.

Generated progress has a separate versioned storage key from original curated progress. Runtime validation sanitizes preferences, results and session metadata. A resumed current scenario is regenerated from its safe generation parameters, so saved answer fields are not trusted as the grading authority. Failed generation becomes an explicit recoverable UI state.

V3 preserves `feltlab-training-v1` and `feltlab-generated-v2`. Tables use `feltlab-table-v3` (version 3), retaining validated events, compact decision metadata, observations and sessions, with 60 recent and 100 saved full hands. `feltlab-notebook-v3` separately retains 30 Practice spots. Sanitizers deduplicate records, replay imports and recompute analysis. Storage failure retains the in-memory game and surfaces export; paused hands resume after reload.

`TableView` is the neutral presentation contract shared by live tables and both replay adapters. Named seating grid areas support distinct desktop and compact-phone geometry. UI renders supplied state and does not implement betting or grades.

All dependencies and static training logic are local after the PWA assets have been loaded. Service-worker registration, manifest, Apple touch icon and safe-area presentation remain browser-compatible. No Python runtime, solver download or remote service is required to generate or evaluate a drill offline.

## Information boundaries and math

The preserved V2 `PublicGameState` is built by an explicit allowlist. It contains board, positions, blinds, pot, stacks and public betting history; it excludes hero cards, coaching text, grades and answers. Private cards are a separate argument. Curated opponents store only IDs and published actions. The V3 public projection is a separate type with the equivalent boundary described above.

River range construction uses the board and fixed profile parameters before conditioning on hero removal. It evaluates exactly 32 or 48 modeled weighted combinations before blockers, not all possible hands and not an equilibrium game tree. Preflop enumerates a full authored weighted range but uses a structural percentile rather than actual equity. These distinctions are described in `STRATEGY_ACCURACY.md` and remain visible in scenario source metadata.

## Verification

`poker.test.ts` preserves independent checks for original betting arithmetic, legal actions, card uniqueness, information boundaries and frequency validation. `generation.test.ts` validates 10,000 generated seeds, exact reproducibility, independent hand ranking, weighted equity and mathematics. `boundaries.test.ts` checks partial/all-invalid pack recovery and malformed policy inputs. Generated-session tests cover state progression and persistence separately from poker mathematics. Browser tests exercise complete flows and responsive geometry.

The complete-hand suite runs another 10,000 seeded hands across 2/3/6 seats, checking conservation, uniqueness, termination, legal actions and exact serialized replay for every hand. Explicit cases cover full/short/cumulative raises, dry and multiple side pots, split/odd chips, folds/refunds, immutable events, malformed imports and busted-seat rotation. Replay tests compare V2 frames to independent betting replay and V3 frames to actual event prefixes, including reload/spoiler safety. Policy, analysis and store suites cover information sets, scoring coverage, pot eligibility and stale tokens.

PokerKit 0.7.7 is a **development-time independent oracle** in an isolated Python environment. `scripts/export-pokerkit-fixtures.mjs` exports native complete hands; `scripts/validate-pokerkit.py` checks actors, streets, calls, raise windows, intermediate stacks, settlement and PHH roundtrip. The recorded run validated 600 hands and 6,294 decisions, 200 per format. Python is not required to run FeltLab. Commands/evidence are in `TESTING.md`.

## Integration decisions and future extensions

The evaluated `poker-engine-ts` candidate passed focused upstream tests, custom package-fit probes and browser bundling. It was deferred as runtime authority because private-dealing/checkpoint APIs and table-format configuration require a substantial adapter. Native event rules, the existing evaluator and independent PokerKit verification were selected; this is not a claim that candidate core rules failed. Single-decision Practice remains separate from the complete simulator.

A future verified strategy pack should carry stack/position/board/bet-tree assumptions, a traceable licensed source, reviewed numerical results and frequencies. Add a new evaluation implementation behind the existing scenario/provenance boundary; do not relabel current heuristics as verified strategy. Heavy simulations or offline solver integration should remain outside the rendering path and must preserve the private-information boundary.
