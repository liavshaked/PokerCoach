# Poker engine and strategy research

Reviewed on **2026-10-11** against the primary repositories and package sources below. This is a source and integration review, not an independent certification of any solver. A README's accuracy, speed, or test-count claim is not a FeltLab measurement. No external solver was executed during this review.

## Integration decisions

| Component                       | Decision                                              | Reason                                                                                                                             |
| ------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pokersolver@2.1.4`             | Integrated for browser hand evaluation                | Explicit MIT grant, no runtime dependencies, browser-compatible source, straightforward best-five-card comparisons.                |
| PokerKit                        | Deferred; useful independent offline validator        | Strong rules/state API, but a Python runtime would complicate this frontend PWA.                                                   |
| Poker Practice                  | Deferred; no charts or application code imported      | Range provenance is unresolved and its advertised formats are 6/8/9-handed, not true heads-up.                                     |
| Free GTO                        | Deferred                                              | Research candidate for isolated river packs; licensing evidence and independent solver validation remain incomplete.               |
| Noam Brown's River Poker Solver | Deferred; preferred offline solver research candidate | MIT Python/C++ implementation with bounded river subgame inputs; needs a reproducible validation/export pipeline.                  |
| `poker-evaluator`               | Rejected for browser runtime                          | Node filesystem dependency and an external lookup-table asset do not fit the PWA.                                                  |
| `phe`                           | Deferred alternative                                  | MIT, no runtime dependencies; table-based evaluator requires additional provenance/size review.                                    |
| TexasSolver                     | Deferred for optional offline research only           | AGPL-3.0 and upstream commercial-license statements require a deliberate compliance decision. No code, binaries, or data imported. |

## PokerKit

**Purpose:** poker state transitions, legal actions, settlement, hand evaluation, and simulation across variants. It does not supply a strong opponent policy.

**License verified:** MIT, copyright Universal, Open, Free, and Transparent Computer Poker Research Group. Read the actual [LICENSE](https://github.com/uoftcprg/pokerkit/blob/b2fcc75c05ac43b210dd7e5ea71c0bd2f82ac3d6/LICENSE).

**Verified:** the [repository](https://github.com/uoftcprg/pokerkit/tree/b2fcc75c05ac43b210dd7e5ea71c0bd2f82ac3d6) documents Python 3.11+, configurable no-limit Hold'em state creation, explicit deals/actions, and examples including multiple runouts. These are API capabilities, not evidence that FeltLab already uses them.

**Compatibility and advantages:** suitable for an offline differential test oracle for legal betting, chip conservation, all-ins, and showdown results. Its separation of rules from player policy matches FeltLab's intended architecture.

**Limits and decision:** **deferred**. Embedding Python or requiring a backend solely for this library would increase deployment and offline complexity. A future development-only adapter should pin a version and compare generated histories with independent fixtures; it is not installed or executed in this stage.

## Poker Practice

**Purpose:** range parsing, weighted preflop chart presentation, and chart-based practice.

**License evidence:** the [package](https://github.com/jensbaagaard/poker-practice/blob/449993f78d995c77b72d0bcac418a8507dd6f783/package.json) and README declare MIT. The inspected tree contains no standalone license grant. The declaration does not establish rights in third-party data.

**Verified:** its [data documentation](https://github.com/jensbaagaard/poker-practice/blob/449993f78d995c77b72d0bcac418a8507dd6f783/data/openSourcePokerData/README.md) describes ranges extracted from Poker Trainer's bundled JavaScript. It documents per-action hand frequencies, conditioning later-node frequencies on earlier reach, and 6/8/9-seat position mappings. No original data-owner redistribution grant or independent solve report was verified.

**Compatibility and advantages:** JSON chart records and explicit sizing profiles are useful architectural references. The [application README](https://github.com/jensbaagaard/poker-practice/blob/449993f78d995c77b72d0bcac418a8507dd6f783/README.md) describes cash 100bb and tournament sets, with full-hand scripts generated using TexasSolver.

**Limits and decision:** **deferred**. Do not copy the ranges until original provenance and redistribution rights are established. A multiway table that reaches a two-player flop is not a two-player preflop game. None of these charts establishes a heads-up SB/button policy, and none was imported.

## Free GTO

**Purpose:** browser postflop CFR research using explicit hand combinations, restricted betting trees, and a worker.

**License evidence:** [README](https://github.com/Robot7620/free-gto/blob/095ca4895a5dd4d1ac181fc499ac9d86f1eb8620/README.md) declares MIT. The inspected recursive tree has no LICENSE/NOTICE file, and package metadata has no license field. Obtain the complete applicable notice before code reuse.

**Verified:** the source tree includes a vector CFR implementation, worker protocol, showdown tables, reference best-response tests, and separate benchmark sweeps. Documentation limits the default tree to half-pot, pot, and all-in with a raise cap; preflop and multiway solving are excluded.

**Compatibility and advantages:** its TypeScript and Web Worker architecture could suit an isolated browser analysis experiment. River solving avoids its future-card abstraction.

**Limits:** the [research log](https://github.com/Robot7620/free-gto/blob/095ca4895a5dd4d1ac181fc499ac9d86f1eb8620/TODO.md) records a corrected best-response calculation that previously allowed knowledge of future cards, substantial remaining turn/flop abstraction error, and expensive exploitability passes. Reported measurements are upstream results, not independently reproduced here. In-tree exploitability also does not measure responses using excluded bet sizes. iPhone performance was not measured.

**Decision:** **deferred**. Require license confirmation, tiny-game reference tests, blocker-aware best responses, reproducible convergence curves, and real-device budgets before generating scored strategy packs. No code or solved output was imported.

## River Poker Solver — Noam Brown

**Purpose:** no-limit Hold'em river subgames using CFR variants, with Python reference and C++ implementations.

**License verified:** [MIT](https://github.com/noambrown/poker_solver/blob/6a10442877ffc8fd28af93e16e279b9bbdd97b2a/LICENSE), copyright 2025 Noam Brown.

**Verified:** the [repository](https://github.com/noambrown/poker_solver/tree/6a10442877ffc8fd28af93e16e279b9bbdd97b2a) documents Kuhn/Leduc validation commands, river exploitability commands, and a JSON input format with board, weighted holdings, pot, stack, sizing arrays, all-in inclusion, and raise limits. The inspected repository snapshot has a short commit history; its author's name is not an independent accuracy test.

**Compatibility and advantages:** appropriate for a development-time strategy-pack pipeline. JSON packs could retain the exact tree and inputs while avoiding live mobile solving.

**Limits and decision:** **deferred**, preferred for further offline investigation. This review did not compile it, run convergence studies, validate rake handling, or reproduce a solver result. Before importing a pack, record source revision, license, complete game definition, input ranges, convergence criterion, exploitability convention, validation evidence, and output checksum. River packs do not solve preflop or arbitrary postflop situations.

## JavaScript evaluator choice

### `poker-evaluator@2.1.1`

**Purpose:** table-driven hand ranking plus Monte Carlo odds helpers. [npm](https://www.npmjs.com/package/poker-evaluator?activeTab=dependencies) currently points to the Sukhmai repository; similarly named forks are not interchangeable.

**License evidence:** [package metadata](https://github.com/Sukhmai/poker-evaluator/blob/b7a6505a4b84798299fb13fae3287181d1a6909b/package.json) declares ISC. A full independent provenance audit of the bundled Two Plus Two table was not completed.

**Verified:** [source](https://github.com/Sukhmai/poker-evaluator/blob/b7a6505a4b84798299fb13fae3287181d1a6909b/src/poker-evaluator.ts) imports Node `fs`/`path` and synchronously loads `data/HandRanks.dat`. The package includes TypeScript and Node types as runtime dependencies. Its odds helper uses unseeded Monte Carlo; its speed claims were not benchmarked here. The last inspected upstream commit is dated 2025-08-18.

**Advantages:** numeric comparable rank and high-throughput lookup architecture.

**Limits and decision:** **rejected for browser runtime**. Filesystem access and the table-delivery requirement add unnecessary complexity for bounded river ranges. No code or lookup table was imported.

### `pokersolver@2.1.4` — selected

**Purpose:** evaluate the best standard poker hand from five to seven cards and compare winners, including ties. It is a hand evaluator, despite its package name; it does not solve betting strategy.

**License verified:** explicit [MIT license](https://github.com/goldfire/pokersolver/blob/f6dff13e898a2190f70e5f4f8d7c1bc7089f7968/LICENSE.md), copyright 2016 James Simpson and GoldFire Studios, Inc. Preserve the complete installed license in distributed notices.

**Verified:** [package metadata](https://github.com/goldfire/pokersolver/blob/f6dff13e898a2190f70e5f4f8d7c1bc7089f7968/package.json) identifies version 2.1.4, a single JavaScript entry, and no runtime dependencies. [Source](https://github.com/goldfire/pokersolver/blob/f6dff13e898a2190f70e5f4f8d7c1bc7089f7968/pokersolver.js) includes browser/CommonJS exports without filesystem loading. Upstream [standard-hand fixtures](https://github.com/goldfire/pokersolver/blob/f6dff13e898a2190f70e5f4f8d7c1bc7089f7968/test/standard.js) cover wheels, kickers, full houses, best-five selection, duplicates, and ties; these were inspected, not run as the upstream suite. The last inspected upstream commit is dated 2021-09-12, so maintenance is slow.

**Compatibility and advantages:** small, dependency-free implementation suitable for Vite. Use `Hand.solve(cards, 'standard')` and comparison/winner APIs. `.rank` represents hand category only; it cannot decide same-category kicker outcomes. Node ESM cannot detect its dynamically assigned named exports: use the CommonJS default import, then obtain `Hand`. A local smoke check verified that a six-high straight beats a wheel and `.compare()` returns a positive value for the losing hand.

**Limits:** validate card syntax and uniqueness at FeltLab's boundary. Retain independent golden fixtures and cross-checks for ranking behavior. Do not use library branding as proof of correctness, and benchmark any large all-runout enumeration before putting it on the interaction path.

**Decision:** **integrated**; the application wrapper and its tests are the record of implemented behavior. No external strategy frequencies accompany this package.

**Installed artifact audit:** version 2.1.4 has no runtime dependencies and its JavaScript entry is 60,454 bytes before bundling. The exact license was copied, byte-for-byte, to [`public/licenses/pokersolver-2.1.4-MIT.txt`](../public/licenses/pokersolver-2.1.4-MIT.txt), which Vite includes in distribution assets. SHA-256 checksums:

```text
pokersolver.js  db2ef5504b5fcd4f273bf76e7ef6898ed24663d7621e830badbf4cf61cf9779d
LICENSE.md     85334cc6a2ac314233434921007d6a6446e2c894e94990f16accfa8b30a5fe8d
```

### `phe@0.6.0`

**Purpose:** numeric five/seven-card ranking with generated evaluator tables.

**License verified:** [MIT](https://github.com/thlorenz/phe/blob/6cfea3703b050fda8dfc8d934ceeb4d3df331d6d/LICENSE), copyright 2017 Thorsten Lorenz. [Metadata](https://github.com/thlorenz/phe/blob/6cfea3703b050fda8dfc8d934ceeb4d3df331d6d/package.json) lists no runtime dependencies; [API source](https://github.com/thlorenz/phe/blob/6cfea3703b050fda8dfc8d934ceeb4d3df331d6d/phe.js) imports local evaluator modules and returns numeric scores where lower is better. The last inspected upstream commit is dated 2018-03-22.

**Advantages:** convenient comparable rank, potentially useful for high-volume enumeration.

**Limits and decision:** **deferred**. CommonJS can be bundled, but complete table provenance, browser output size, comparative correctness, and performance were not verified. Adding a second runtime evaluator is unnecessary for current bounded ranges.

## TexasSolver

**Purpose:** native C++ Hold'em/short-deck postflop solving with GUI/console interfaces and JSON strategy export.

**License verified:** the repository includes [GNU AGPL version 3](https://github.com/bupticybee/TexasSolver/blob/bb53f8cbfff4841da2d75bd060d0ab269c3d5881/LICENSE). The [README](https://github.com/bupticybee/TexasSolver/blob/bb53f8cbfff4841da2d75bd060d0ab269c3d5881/README.md) additionally discusses commercial licensing. Those statements are recorded, not interpreted here as replacing the license text or as permission to bypass its conditions.

**Verified:** documentation lists desktop platforms, native build/runtime requirements, and JSON output. Its comparative performance and accuracy claims were not reproduced.

**Compatibility and advantages:** a possible separate offline research executable; no reason to place it inside this frontend PWA.

**Limits and decision:** **deferred**. FeltLab does not embed, distribute, host, execute, or copy TexasSolver. Any future use needs a documented licensing/compliance decision for the chosen deployment and input data. Solver output is not automatically cleared for redistribution merely because it is JSON. Third-party data packs generated with it need their own provenance review.

## Preflop data conclusion and acceptance gate

No **true two-player, 100bb no-limit Hold'em** preflop strategy pack with verified original provenance, redistribution rights, full sizing/rake assumptions, and independent solve evidence was established in this review. This is a finding about the reviewed candidates, not a claim that no such data exists anywhere.

FeltLab must not relabel 6-max BTN openings or folded-to-SB ranges as heads-up policies. Locally authored educational ranges may be used only with an explicit authored-policy label; their action frequencies are modeling assumptions, not solver measurements. Accurate arithmetic against an assumed range establishes a conditional mathematical result, not equilibrium play.

A future imported strategy pack must carry:

1. Original author/source, immutable revision, license text, attribution, and data redistribution grant.
2. Player count, positions and action order, starting stacks, blinds/antes, rake and cap, previous actions, and available bet/raise sizes.
3. Whether frequencies are conditional on reaching the node; legal combination weights and card-removal semantics.
4. Solver/version, complete tree/ranges, convergence settings, precise exploitability definition, and reproducible reference results.
5. Validation of frequency sums, mixed-action grading, reach consistency, chip accounting, and compatible suit transformations.

Until that gate is met, generated terminal river call/fold EV and mathematical drills provide checkable training under their displayed assumptions. Flop/turn drawing odds do not establish a full best-action policy or solver EV loss.
