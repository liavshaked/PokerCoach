# V3 external tools: decisions and verification

Reviewed **2026-10-13** using the primary repositories, installed artifacts, and official API documents linked below. Repository activity dates identify the inspected snapshots; they do not guarantee future maintenance. Upstream claims about strength, speed, and exploitability are not FeltLab measurements.

## What is actually integrated

| Tool                                              | V3 status                                        | Practical use                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pokersolver@2.1.4`                               | Existing browser dependency, retained            | Best-five showdown ranking and bounded equity calculations. MIT; exact distributed notice is in `public/licenses/`. It does not solve betting strategy.                               |
| `pokerkit==0.7.7`                                 | **Integrated as an optional development oracle** | Replays actual FeltLab complete hands independently, compares legal decisions and final stacks, and round-trips Poker Hand History notation. No Python backend or browser dependency. |
| `poker-engine-ts@0.1.3`                           | Downloaded, tested, deferred as runtime          | Useful event-sourcing candidate; the required integration would need dealing/checkpoint and three-seat adaptations. Native FeltLab rules were cross-checked against PokerKit instead. |
| GTO Wizard Score                                  | **Disabled; server contract only**               | A typed future boundary exists in `src/engine/providers/external-analysis.ts`. No HTTP implementation, credentials, subscription, uploads, scores, or enabled UI.                     |
| OpenSpiel / RLCard / Free GTO / Noam Brown solver | Research only                                    | Potential offline experiments and validated strategy packs. None supplies the current bots or grades.                                                                                 |

The [V2 research record](POKER_ENGINE_RESEARCH.md) retains the evaluator/table audit and earlier preflop-data findings. Its former “PokerKit deferred” decision is superseded by the development integration below. No independently verified, redistribution-cleared strategy dataset for the exact heads-up/three-/six-player 100bb games was added. Model feedback therefore must not be presented as solver GTO accuracy.

## PokerKit: independent complete-hand validation

**Source/license:** [PokerKit](https://github.com/uoftcprg/pokerkit/tree/abf795299eaac41183495a0956ce7136ce38ed64), MIT ([license](https://github.com/uoftcprg/pokerkit/blob/abf795299eaac41183495a0956ce7136ce38ed64/LICENSE)). The inspected repository commit is dated 2026-10-12. The installed release is [PyPI 0.7.7](https://pypi.org/project/pokerkit/0.7.7/), requiring Python 3.11+. Its wheel has no additional runtime requirements. The actual installed MIT notice names the Universal, Open, Free, and Transparent Computer Poker Research Group, 2023–2026.

The [documented API](https://pokerkit.readthedocs.io/en/stable/) supplies configurable betting/state transitions, card evaluation, equity tools, settlement and [PHH notation](https://pokerkit.readthedocs.io/en/stable/notation.html). It is a rules library, not a trained opponent or strategy solver. Python hosting would add deployment and offline complexity, so FeltLab uses it only during development. Local compute is the cost; no paid service is involved.

**Implemented:** `scripts/export-pokerkit-fixtures.mjs` loads the real TypeScript engine through Vite, plays deterministic hands, and exports integer chip units. `scripts/validate-pokerkit.py` independently checks actor order, street, stacks, call cost, raise permission, minimum/maximum raise, every selected action, terminal chip settlement, and chip conservation. It serializes each PokerKit hand to PHH and independently replays that serialization. Seat mapping explicitly handles the heads-up button/small-blind reversal. Fixtures contain private cards because they are local test artifacts, not public gameplay projections.

**Measured result:** **600 complete hands / 6,294 decisions passed**, with 200 hands at each of 2, 3 and 6 seats. All 600 PHH round trips passed. The generated corpus varies buttons, stacks, bet sizes, calls, folds and all-ins. This oracle found and helped fix a real dry-side-pot issue: a player could previously be offered a raise even when every other player's total remaining capacity was below the existing wager. The engine now has an explicit regression for that case.

This is differential evidence over a finite corpus, not a proof of every poker rule. PokerKit is itself software; disagreements must be investigated rather than automatically copying its behavior. The application has separate deterministic edge-case and simulation tests. This script checks rules/showdowns, not opponent quality, policy exploitability, rake, tournaments, or solver accuracy. Current fixtures model cash NLHE with no rake or ante and one board.

### Known oracle divergence: incomplete opening all-in after a check

An additional isolated regression falls outside the passing 600-hand corpus. On a flop with a 1 BB minimum wager, the small blind checks, the big blind bets its last 0.5 BB and the button calls. FeltLab permits the earlier checker to fold or call; PokerKit 0.7.7 reports that this player may also raise. This discrepancy was reproduced against the final engine and pinned wheel, rather than inferred from documentation.

FeltLab explicitly uses **TDA-style full-wager reopening** for its practice cash tables. [Current Poker TDA Rule 49A](https://www.pokertda.com/view-poker-tda-rules/) requires an already-acted player to face a full bet/raise before reopening, and the [TDA's specific checked-then-short-opening example](https://www.pokertda.com/forum/index.php?topic=663.0) explains the same closure. This is a declared house-rule policy; TDA is a tournament rules authority, rather than a universal cash-room mandate.

Inspection of the installed PokerKit `State` implementation explains the observed difference: its prior completion/raise amount begins at zero on a new street, so the first positive opening all-in clears the prior-actor set even when below the street minimum. FeltLab preserves the 1 BB full-wager threshold. The targeted native test keeps this behavior explicit. The independent oracle remains useful, but is not the authority for this known reopening edge; its 600-hand pass must not be described as covering every house-rule interpretation.

Run from the repository root (Windows PowerShell):

```powershell
python -m venv .research/pokerkit-venv
./.research/pokerkit-venv/Scripts/python.exe -m pip install --require-hashes --only-binary=:all: -r scripts/requirements-pokerkit.txt
node scripts/export-pokerkit-fixtures.mjs 600 .research/pokerkit-fixtures.json
./.research/pokerkit-venv/Scripts/python.exe scripts/validate-pokerkit.py .research/pokerkit-fixtures.json
```

On macOS/Linux use `python3` and `.research/pokerkit-venv/bin/python`. The requirement pins the release and both official artifact hashes; the tested Windows interpreter was Python 3.13.14. The exporter accepts 1–10,000 hands and an optional destination path. The validator accepts that path and optional `--phh-directory .research/phh`. The environment, fixtures and retained PHH artifacts belong under ignored `.research/`: Playwright cleans `test-results/` before browser runs and would remove an environment placed there. `npm install`, the PWA and production builds require no Python.

## poker-engine-ts: tested candidate, deferred adapter

**Source/license:** [revision 6aa64b8](https://github.com/Ge-limin/poker-engine-ts/tree/6aa64b86c1c47fdf215281ad04c1fcffefabf71b), package 0.1.3, MIT, copyright 2026 Limin Ge. Its inspected history had one commit, dated 2026-07-05. This is a young, pre-1.0 package, not evidence of incorrect rules.

The source provides a TypeScript reducer/event architecture, session management, projections, timeline operations, side-pot settlement, personas and bot policies. Core ESM/type declarations and the small `@noble/hashes` dependency are compatible with a browser bundling approach. Its public session configuration uses maximum seat counts **2, 6 or 9**: three active players require an adapted six-seat table. This distinction matters for positions and replay.

**Actually executed in the downloaded candidate:** 17 focused upstream tests passed, covering heads-up sessions, short-all-in reopening, community distribution and settlement conservation:

```text
npx vitest run src/__tests__/short-all-in-reopen.test.ts src/__tests__/batch-s2-heads-up-session.test.ts src/__tests__/settlement-conservation.property.test.ts src/session/__tests__/community-distribution.test.ts
```

Two additional FeltLab integration probes passed: three occupied seats in a six-seat configuration, and the distinction between the dealt active snapshot and the original replay checkpoint. Initial session creation does not itself deal private cards. The dealing helper changes the active snapshot outside the event history, requiring a matching initial-checkpoint update for reconstruction; another convenience helper repairs that checkpoint. These are adaptation requirements, not a claim that the library cannot replay hands. An actual esbuild browser/ESM bundle of the candidate core passed and produced 208.2 kB of unminified output. Bot source was inspected, but no professional-strength or exploitability benchmark was reproduced.

**Decision:** defer runtime adoption. Supporting the exact contiguous 2/3/6-seat product and preserving authoritative initial dealing/replay would require a maintained adapter. FeltLab instead keeps a narrow native state/event API, the existing external evaluator, and the independent PokerKit oracle. No upstream implementation was copied into the native engine. Candidate tests are useful evidence, not a complete certification. The code is free; integration, regression testing and future upgrade maintenance are the practical costs.

## OpenSpiel

**Source/license:** [revision 4840189](https://github.com/google-deepmind/open_spiel/tree/48401890ee9857e611678302371378175a8e4c6b), inspected commit 2026-08-31; [Apache-2.0](https://github.com/google-deepmind/open_spiel/blob/48401890ee9857e611678302371378175a8e4c6b/LICENSE). Its [algorithm inventory](https://github.com/google-deepmind/open_spiel/blob/48401890ee9857e611678302371378175a8e4c6b/docs/algorithms.md) includes CFR variants, best-response tools and learning algorithms. This is a C++/Python research framework, not an installable strong six-player Hold'em policy.

The [Universal Poker header](https://github.com/google-deepmind/open_spiel/blob/48401890ee9857e611678302371378175a8e4c6b/open_spiel/games/universal_poker/universal_poker.h) exposes multiple betting abstractions and an optional ACPC dependency; it explicitly cautions that this game has not had extensive review/testing by the OpenSpiel team. Bundled third-party code needs its own notice audit before redistribution.

**Decision:** offline research candidate for reproducible Kuhn/Leduc experiments and small-policy best-response evaluation. Not installed or benchmarked for V3; no policy imported. Native dependencies, abstraction design, training time and compute are substantial integration costs even though the code is free. Six-player policy quality cannot be inferred from success on a small two-player zero-sum game.

## RLCard

**Source/license:** [revision d7d0a95](https://github.com/datamllab/rlcard/tree/d7d0a957baf4cc7225a50522adb0164bf130a9d0), inspected commit 2024-06-26; [MIT](https://github.com/datamllab/rlcard/blob/d7d0a957baf4cc7225a50522adb0164bf130a9d0/LICENSE.md). It provides Python card-game learning environments. Training libraries and compute are additional costs; no paid API is needed.

**Actual source check:** the [no-limit round](https://github.com/datamllab/rlcard/blob/d7d0a957baf4cc7225a50522adb0164bf130a9d0/rlcard/games/nolimitholdem/round.py) defines five abstract actions: fold, check/call, half-pot, pot and all-in. It cannot directly represent arbitrary legal bet sizes. The [game](https://github.com/datamllab/rlcard/blob/d7d0a957baf4cc7225a50522adb0164bf130a9d0/rlcard/games/nolimitholdem/game.py) defaults to two players; configurable player-count fields do not independently establish correct production 2/3/6-seat rules. The [model registry](https://github.com/datamllab/rlcard/blob/d7d0a957baf4cc7225a50522adb0164bf130a9d0/rlcard/models/__init__.py) registers a pretrained Leduc CFR model and several rule agents, not a verified strong six-player no-limit model.

**Decision:** defer to offline learning experiments. No RLCard runtime, pretrained weights or strategy outputs were imported. A future experiment needs an explicit action mapping, private-information boundary, reproducible training seed, held-out opponents and uncertainty estimates. A research example must remain labeled as such.

## Free GTO and Noam Brown's river solver

**Free GTO:** [revision 095ca48](https://github.com/Robot7620/free-gto/tree/095ca4895a5dd4d1ac181fc499ac9d86f1eb8620), inspected commit 2026-09-24. Browser TypeScript/worker CFR research with a restricted heads-up postflop tree; not preflop or multiway solving. [README](https://github.com/Robot7620/free-gto/blob/095ca4895a5dd4d1ac181fc499ac9d86f1eb8620/README.md) declares MIT, but the inspected tree lacks a complete standalone license grant/notice. The [research log](https://github.com/Robot7620/free-gto/blob/095ca4895a5dd4d1ac181fc499ac9d86f1eb8620/TODO.md) records a corrected future-card best-response error and remaining abstraction/performance limits. **Deferred:** no code or output copied, no solve independently reproduced. Obtain the applicable notice and validate blocker-aware best responses/convergence before any reuse. Mobile solve cost remains unmeasured.

**Noam Brown:** [revision 6a10442](https://github.com/noambrown/poker_solver/tree/6a10442877ffc8fd28af93e16e279b9bbdd97b2a), inspected commit 2026-01-05; explicit [MIT](https://github.com/noambrown/poker_solver/blob/6a10442877ffc8fd28af93e16e279b9bbdd97b2a/LICENSE), copyright 2025 Noam Brown. Python reference/C++ river-subgame tooling with configurable ranges, board, pot, stacks and sizing tree. **Preferred offline solver experiment, deferred:** no executable or solved pack used in V3. Reproduce its small-game checks and convergence first, then export immutable packs with revision, full assumptions, range provenance, tolerance, exploitability convention and checksum. CPU/runtime and validation work are the cost. A bounded river result cannot grade an arbitrary full hand or six-player preflop decision.

## GTO Wizard: distinguish two different products

### Official Score API

The [official developer portal](https://developers.gtowizard.com/) and [Business v4 OpenAPI specification](https://developers.gtowizard.com/openapi/business/v4.json) document an authorized scoring workflow: create a task, obtain signed upload URLs, upload histories, complete the upload, then poll and retrieve hand results. Access requires a representative-enabled application and server-side OAuth credentials. No credentials were requested or used here.

The specification includes NLHE cash and other declared content types, per-player/table scope, rejected/unsolved outcomes, quotas and billable units. Table scope may charge separately for each shown seat. Only one task per application runs at a time. Monetary rates require a contract; no verified public price is recorded. FeltLab's simulator JSON is **not assumed to be an accepted poker-room history format**. Provider-approved serialization/import and completed-hand mapping must be confirmed before implementation. Provider scores/EV losses must retain their source and units, including null/unsolved outcomes.

**Prepared boundary:** `src/engine/providers/external-analysis.ts` describes a future server adapter and completed-hand uploads. It contains types only and has no enabled implementation. Activation needs explicit commercial authorization, approved formats, server credential storage, spend/rate controls, validated responses and user consent for uploads. Local play/analysis remain fully functional without it.

### Benchmarking API and leaderboard

The separate [Benchmarking API terms](https://gtowizard.com/benchmark/terms), last updated 2026-02-21, authorize autonomous-agent performance benchmarking. They prohibit strategy extraction, using benchmark data to train/fine-tune/calibrate third-party AI or solvers, and human assistance during active hands. They also permit public publication of agent performance/hand histories. That API is **not used as a coaching backend, strategy dataset source, or substitute Score subscription**. No agent was connected and no leaderboard result is claimed. Any later authorized bot benchmark must remain isolated from player coaching and data ingestion.

## Additional practical candidates

**`@poker-apprentice/hand-history-parser`:** [repository](https://github.com/poker-apprentice/hand-history-parser), [MIT license](https://github.com/poker-apprentice/hand-history-parser/blob/main/LICENSE), inspected package 6.6.0. TypeScript/JavaScript room-history parsing is more appropriate than hand-written string splitting for a future importer. The documented supported networks are Bodog/Bovada/Ignition, not every poker room. ANTLR and other dependencies need bundle/notice review; parsed input still needs legal-state validation. **Deferred**, because V3 generates its own histories. Not installed, executed or treated as proof that GTO Wizard accepts its output.

**`rs-poker`:** [repository](https://github.com/elliottneilclark/rs-poker), [Apache-2.0 license](https://github.com/elliottneilclark/rs-poker/blob/master/LICENSE), [inspected Cargo metadata](https://github.com/elliottneilclark/rs-poker/blob/master/Cargo.toml) version 5.1.0. Rust hand evaluation, simulation and agent-arena tooling could provide a future compiled offline benchmark/reference. The current default feature set includes arena, serialization, Omaha and open hand history support. **Deferred:** no Rust/WASM build or performance/strength claim was verified; a frontend adapter/build toolchain is additional work. It is not automatically a better browser fit than the evaluator already tested here.

Neither candidate is installed merely to increase the integration count. The useful V3 additions are the independent PokerKit test pipeline and a concrete, permission-aware external analysis boundary.
