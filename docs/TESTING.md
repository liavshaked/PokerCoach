# V3 validation record

Validated locally on **2026-10-13**, Windows, Node 22.18.0, installed Microsoft Edge through Playwright. The physical-device checks listed below remain outstanding.

## Executed checks

| Check                                  | Result and scope                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm.cmd test`                         | **194 passed, 1 intentionally gated benchmark skipped**, across 13 files. The substantial benchmark was also executed separately.                                  |
| `npm.cmd run lint`                     | ESLint, React hooks, TypeScript and accessibility rules pass.                                                                                                      |
| `npm.cmd run format:check`             | Prettier passes for project sources and documentation; generated/downloaded artifacts are excluded.                                                                |
| `npm.cmd run build`                    | TypeScript project build and Vite production/PWA build pass. Application and UI framework chunks are split; all chunks stay below Vite's 500 kB warning threshold. |
| `npm.cmd run test:e2e`                 | **11 browser flows:** six preserved V2 flows and five V3 flows, described below.                                                                                   |
| `npm.cmd run test:pwa`                 | **1 production offline flow passes**, including previously unvisited V3 lazy routes.                                                                               |
| PokerKit 0.7.7 independent oracle      | **600 completed hands / 6,294 decisions / 600 PHH round trips**, 200 hands per 2/3/6-seat format.                                                                  |
| Substantial local policy benchmark     | **9,000 completed heads-up hands**, nine cases × 500 paired-seat blocks × two hands. Recorded means and approximate 95% intervals; no verified strength ranking.   |
| Candidate `poker-engine-ts` evaluation | 17 upstream tests and two additional integration probes passed; browser bundle succeeded. Candidate deferred rather than adopted.                                  |

Commands are run from the repository root. The normal suite intentionally skips the costly full benchmark unless its explicit environment flag is set; see [Poker AI](POKER_AI.md). The complete benchmark artifact is [V3_AI_BENCHMARK.json](V3_AI_BENCHMARK.json). PokerKit setup/reproduction and candidate scope are in [V3 external tools](V3_EXTERNAL_TOOLS.md).

## Complete-game rules evidence

`src/engine/game/game.test.ts` plays **10,000 complete seeded hands**, cycling among heads-up, three players and six players with adversarial legal action sampling. It asserts termination, chip conservation, nonnegative stacks, unique cards, legal bounds, exact serialized replay and stable settlement. A separate grid sweep checks fractional/integer chip units and small stacks. There is no fixed user-facing hand limit.

Explicit regressions cover:

- Heads-up button/small-blind rules, preflop and postflop order, and 3/6-seat order.
- Full minimum raises, chip denomination, out-of-turn rejection and legal all-ins.
- Short all-ins, cumulative reopening, each actor's own reopening threshold and a prior check facing an incomplete opening wager.
- Dry side pots: no raise when no opponent can cover the current wager.
- Multiple contribution caps, folded-player eligibility, uncalled refunds, tied pots and odd-chip assignment clockwise from the button.
- Wins by folds without an invented runout, complete showdown, button rotation and busted-seat sit-outs.
- Frozen original histories, exact event-prefix reconstruction, malformed event/order/result rejection and complete-state import boundaries.
- Private-card/future-deck/seed exclusion from public and policy views. Opaque hand IDs and an independent policy RNG prevent leaking a deck seed indirectly.

The Python oracle replays real exported engine hands through **PokerKit**, independently compares actor order, street, stack changes, call cost and min/max raise eligibility, then checks final stacks and PHH reconstruction. This comparison found a dry-side-pot raising bug during development; that issue is fixed and has a deterministic regression. A separate targeted probe identifies a known convention difference: after checking and facing a below-minimum opening all-in, FeltLab follows the documented TDA-style full-wager reopening policy, while PokerKit permits a raise. This case is documented with primary rule sources in V3_EXTERNAL_TOOLS.md and is not claimed as a passing differential match. The main 600-hand corpus still passes. Passing finite tests is evidence, not a proof of all possible poker states.

## Policies, analysis and persistence

Policy tests check legal decisions across formats, coherent distribution differences, public information isolation, independent RNG input, deterministic resumed actions, and minimum-sample bounds for observed-opponent adaptation. Policy quality is measured separately from rules correctness. The full benchmark's wide intervals and single reference opponent do not establish professional strength, exploitability or an expert/advanced ordering.

Analysis tests cover eligible-pot arithmetic, declared supported-state boundaries, qualitative unsupported choices, importance/confidence weighting, incomplete coverage, important unscored decisions, outcome independence, and disclosure of model assumptions. No full-hand solver EV loss is asserted.

Table-store tests cover accepted hero actions, one-action tokens, stale/double-action rejection, 2/3/6-seat completion, next hands, refresh, completed records, saved notes, retention, lifetime counters, corruption recovery and feedback gates. Decisions recovered from valid action events but missing timestamp metadata use `createdAt: null`, not a fabricated historical time.

Notebook tests cover valid saved scenarios and math answers, immutable first saved choices, duplicate rejection, canonical scenario identity, newest-30 retention, metadata bounds, persistence round trips, malformed entries, quota-failure survival, and removal/reset. Full-hand history is independent of notebook deletion.

The original V2 tests remain: at least **10,000 seeded scenarios**, deterministic generators, validation, independent hand-evaluator comparisons, exact finite weighted river equity, mathematical drills, worker timeouts/cancellation, first-attempt semantics, storage failure and legacy state preservation.

## Browser flows and screenshots

The eleven browser flows exercise:

1. 100 fresh generated decisions, reload during play, summary, progress and restart.
2. Supported focus filters, preference persistence and mobile math answers.
3. Preserved practice geometry, mobile analysis sheets, navigation and landscape layouts.
4. Ten-decision challenge, alternative line without replacing first-attempt history, refresh and completion.
5. Library filters, keyboard actions, name/animation settings, JSON export and confirmed reset.
6. Practice landing/layout checks.
7. Visual practice-history replay and saving the original choice after trying an alternative.
8. Complete 2/3/6-player play, next hand, reload, review/replay, notebook notes/tags/marks and filtering.
9. Deferred feedback across table, notebook, progress and practice until session review.
10. Six-seat layout at 320/390/768/1024/1440 widths, card-symbol and seat/board geometry, mobile replay and 169-cell range explorer.
11. Actual mobile betting controls at 390×844, 320×740 and 375×667, verifying the hero is above the action dock and legal all-in presets work.

The PWA test serves the production build, validates manifest/icons and service-worker control, disconnects networking, reloads an active practice decision and generates another. While still offline it loads the previously unvisited AI table, finishes/saves a heads-up hand, then opens notebook and range explorer. Lazy code is included in the production precache.

Screenshots are written under ignored `test-results/`; failure traces are retained. Desktop/table, small-phone betting, mobile replay and range screenshots were visually inspected. Initial inspection exposed a mobile sticky action dock covering hero cards: the live table was compacted, mobile bet presets moved into a native selector, and small-height regressions were added. Automated non-overlap checks complement screenshot inspection; they do not establish subjective design quality.

Playwright owns test servers it starts and uses `reuseExistingServer`. Local preview servers started for manual checks must be stopped after review. Playwright cleans its output directory between runs; optional downloaded environments belong under ignored `.research/`, not its output directory.

## Remaining release checks

- Physical iPhone Safari and installed PWA: safe areas, keyboard zoom, browser bars, rotation and touch behavior.
- Long-session responsiveness and storage latency on lower-end phones at the full retention limits.
- Broader independent-oracle corpora for rare combinations of odd chips, busted seats and reopening rules.
- Multiple held-out opponents, multiway formats and longer adaptation windows for meaningful policy comparisons.
- Real solver convergence, licensed strategy datasets and exact state matching before enabling solver-derived analysis.

What If branches, import/sync, external paid analysis, research-trained policies and LLM explanations are deferred and are not represented by passing placeholders.
