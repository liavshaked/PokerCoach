# FeltLab architecture

FeltLab remains a browser-first React/TypeScript/Vite PWA. It has no account, paid API, server dependency or live solver. The original curated mode remains available alongside dynamically generated training.

## Separation of concerns

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

## Procedural contract

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

All dependencies and static training logic are local after the PWA assets have been loaded. Service-worker registration, manifest, Apple touch icon and safe-area presentation remain browser-compatible. No Python runtime, solver download or remote service is required to generate or evaluate a drill offline.

## Information boundaries and math

`PublicGameState` is built by an explicit allowlist. It contains board, positions, blinds, pot, stacks and public betting history; it excludes hero cards, coaching text, grades and answers. An opponent's private hand is a separate argument. Curated opponents store only scenario IDs and published actions.

River range construction uses the board and fixed profile parameters before conditioning on hero removal. It evaluates exactly 32 or 48 modeled weighted combinations before blockers, not all possible hands and not an equilibrium game tree. Preflop enumerates a full authored weighted range but uses a structural percentile rather than actual equity. These distinctions are described in `STRATEGY_ACCURACY.md` and remain visible in scenario source metadata.

## Verification

`poker.test.ts` preserves independent checks for original betting arithmetic, legal actions, card uniqueness, information boundaries and frequency validation. `generation.test.ts` validates 10,000 generated seeds, exact reproducibility, independent hand ranking, weighted equity and mathematics. `boundaries.test.ts` checks partial/all-invalid pack recovery and malformed policy inputs. Generated-session tests cover state progression and persistence separately from poker mathematics. Browser tests exercise complete flows and responsive geometry.

## Path to a complete simulator

The card, public/private state, betting history, evaluator and policy interfaces can be reused by a future full heads-up engine. That addition still needs validated deck/street lifecycle, full all-in semantics, pot settlement, dealer rotation and a stateful strategic policy. Current training scenarios end at one evaluated decision. No scripted sequence is presented as a completed poker hand.

A future verified strategy pack should carry stack/position/board/bet-tree assumptions, a traceable licensed source, reviewed numerical results and frequencies. Add a new evaluation implementation behind the existing scenario/provenance boundary; do not relabel current heuristics as verified strategy. Heavy simulations or offline solver integration should remain outside the rendering path and must preserve the private-information boundary.
