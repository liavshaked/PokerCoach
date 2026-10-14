# V4 roadmap from the delivered V3 foundation

This is a development roadmap, not a claim that the deferred features already work. It describes the current code and concrete acceptance gates for future work.

## Delivered foundation

| Area              | Current implementation                                                                                                                         | Practical limit                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Full-hand play    | Seeded no-limit Hold'em at 2-, 3- and 6-seat tables; legal betting, all-ins, side pots, refunds, showdown, button rotation and optional rebuys | Cash-style virtual chips, no rake/antes/tournament schedule; no multiplayer server                 |
| Rules evidence    | Deterministic edge tests, a 10,000-hand simulation test, event replay and an executed 600-hand independent PokerKit comparison                 | Finite evidence, not a mathematical correctness proof                                              |
| Opponents         | Authored policies with position/action/stack context, six profiles, difficulty settings and bounded adaptation to public observations          | No solver equilibrium guarantee, trained professional model or verified population strategy        |
| Decision review   | Hero action snapshots, model/heuristic coaching, immediate eligible-pot price, source, assumptions and confidence                              | Full-hand strategic EV is unavailable; uncertain multiway postflop/all-in choices stay qualitative |
| Scoring           | Confidence/importance-weighted model agreement with count/importance coverage requirements                                                     | Agreement with authored weights is not GTO accuracy, exploitability, or expected profit            |
| Replay            | Real event-prefix reconstruction, visual table, transport controls, street jumps and decision links                                            | Original line only; no editable branches                                                           |
| Notebook/progress | Local saved hands/spots, notes/tags/marks, replay, retained complete-hand counts and street-focused review                                     | Bounded retention and device-local storage; no synchronization                                     |
| Practice          | Preserved curated exercises plus seeded endless/focused/challenge/weakness drills and mathematical exercises                                   | Scenario models retain their declared scope; a one-decision drill is not a full game               |
| Range explorer    | Interactive 13×13 authored heads-up range-membership matrix with model assumptions                                                             | Heads-up 100bb, no rake; membership weights are not action frequencies or six-player charts        |
| External tools    | Browser `pokersolver`, development-only PokerKit oracle and dormant authorized-server analysis types                                           | No live solver, paid API, external AI or remote scoring enabled                                    |

See [hand replay](HAND_REPLAY.md), [external tools](V3_EXTERNAL_TOOLS.md) and the engine/store source for the current boundaries. The first V4 milestone should preserve V2 exercises and V3 complete-hand regression coverage.

## 1. Expand independent rules and persistence coverage

Extend the PokerKit fixture bridge to explicit odd-chip ties, partially funded blinds, busted seats, cumulative short raises and long multi-hand sequences. Keep independent action legality and final settlement comparisons; investigate discrepancies instead of assuming either engine is always right. Add stable exported regression fixtures for every discovered defect.

Measure restore time and storage size across notebook limits. Add versioned migrations before changing the event schema. Consider IndexedDB only if measured localStorage cost justifies it. Any quota failure must preserve playable in-memory state and expose backup/recovery. Cloud synchronization requires conflict handling, authentication, deletion and a deliberate data-retention design.

## 2. Make policy quality measurable

The seeded paired-seat benchmark harness is a starting point. Expand to multiple held-out baselines, player counts, effective depths, styles and long adaptation windows. Publish sample counts, uncertainty, action distributions and failure cases. Small samples or success against one authored opponent must not support “expert,” profitable, or unexploitable strength claims.

Keep opponent inputs limited to public history and that opponent's own cards. Future trained policies need explicit observation/action encodings, licensed weights, reproducible training configuration, inference budgets and information-leakage tests. OpenSpiel/RLCard are offline research candidates, not ready-made replacements for the current browser opponents.

## 3. Improve analysis without inventing precision

Separate factual mathematics from range-dependent estimates in every result. Add validated weighted-range inference and uncertainty before expanding numerical coverage. Use exact terminal equity where feasible and seeded, bounded Monte Carlo with reported error where it is necessary. Card removal, ties, side-pot eligibility, future action and rake assumptions must be explicit.

Introduce independently validated offline solver packs only for precisely matching game definitions. Every pack needs the source revision/license, input ranges, stack/position/board/betting tree, convergence evidence, exploitability convention, validation fixtures and checksum. Unsupported inputs must remain unavailable instead of borrowing a nearby policy. True heads-up, three-player and six-player preflop datasets require separate provenance and permissions.

Keep model agreement, mathematical correctness, solver coverage and chip results separate in progress. Future weakness recommendations should use minimum sample sizes, recency and uncertainty; the current street disagreement counts are review suggestions rather than a diagnosed strategic leak.

## 4. Add what-if branches safely

Branch from a validated decision prefix. Give each branch a distinct identity/seed and a visible comparison to the original action. Preserve the original log, outcome, notes and first-attempt statistics. Bots must act from the branch's public history, without access to the original hidden future. Allow freezing the original runout only as an explicitly labeled retrospective experiment, not an unbiased EV estimate.

Acceptance should cover branch replay, legal actions, state independence, private-card boundaries, reproducibility and zero changes to original progress. Side-by-side tables and outcome distributions become useful only after those guarantees exist.

## 5. Grow the notebook and range tools

Add validated import adapters for selected poker-room histories and PHH; reject unsupported variants, malformed amounts, missing state and ambiguous identities. Parser output must still pass the rules boundary. Provide a redacted sharing format separate from full local backup, since current full-hand JSON contains private cards and deterministic initialization.

Expand the range explorer only when licensed, traceable action-frequency data exists for the exact selected format. Add blocker-aware combination inspection, weighted-range editing and supported postflop views. Current authored membership weights must remain clearly distinguishable from solved opening/calling/raising frequencies.

## 6. Optional authorized services

The dormant `GtoWizardScoreServerAdapter` requires a separately authorized backend, provider-approved history serialization, server-only credentials, upload consent, spending limits, bounded requests and validated results before it can be enabled. Confirm contract rights and costs; preserve local operation when it is disabled or fails. GTO Wizard's separate benchmarking API must not become a strategy-extraction or coaching endpoint.

LLM explanations are also deferred. If added, they should paraphrase structured, validated analysis with source-aware uncertainty rather than calculate poker rules, invent frequencies or assign unsupported scores. They must not be required to play or review a local hand.

## Release gates

Preserve deterministic rules, privacy and storage tests; rerun meaningful independent fixtures after rules changes. Test complete play → report → replay → save → reload flows on desktop and small screens, including keyboard controls, reduced motion, slow devices, offline service-worker updates and storage failure. Publish measured evidence and remaining limits alongside each newly enabled capability.
