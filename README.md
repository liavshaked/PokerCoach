# FeltLab V3

A local-first poker training app with complete no-limit Hold'em, distinct AI opponents, visual hand replay, a study notebook, and the preserved V2 practice room. No money, accounts, backend, or paid service is required.

## Run

Use Node.js **22.12+**. From this directory in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the URL printed by Vite. On macOS/Linux use `npm` instead of `npm.cmd`. Production:

```powershell
npm.cmd run build
npm.cmd run preview
```

## Play and study

- **AI poker table:** continuous 2-, 3-, and 6-player elimination games, default six seats and 100 BB. Configure fixed blinds, stack depth, difficulty, opponent profiles, and pace. Hands deal automatically after four seconds; pause, review, or deal now at any time between hands. Fast-forward plays opponents up to your next decision or the end of the hand. Stacks carry over without rebuys, eliminated seats stay out, and the last player with chips wins. If you bust, watch the remaining players finish.
- **Practice room:** preserved endless, focused, weakness, and 10/20/50-decision challenges, plus 16 original curated spots. Mathematical drills and supported generated spots continue offline in a worker.
- **Visual replay:** play/pause, speed, previous/next action, scrubbing, and street jumps. Reconstruct actual table state; future board cards and unrevealed opponents stay hidden. Practice spots replay their recorded history up to the decision.
- **Hand notebook:** save completed hands or practice spots; add notes, tags, and review marks; filter and replay them later.
- **Range explorer:** a keyboard-accessible 13×13 view of the existing authored heads-up open/three-bet models. Weights are range membership assumptions, not GTO action frequencies.
- **Progress:** completed-hand reviews, actual decision counts, supported model agreement and coverage, street comparisons, targeted practice, and the preserved mathematical drill history.

Feedback can appear instantly, after a hand, or at session review. Deferred sessions suppress analysis, hints, and scores in table/practice/progress/notebook views until review. Change timing in Settings or table setup. Practice spots contain one decision, so after-hand feedback appears after that decision. AI actions stop when the table page is not mounted. Opening a review or replay pauses the table; resume when ready. Recent hand reviews remain available while the next hand is in progress.

Keyboard shortcuts: F folds, C checks/calls, B bets, R raises, or 1–3 choose table actions at the selected size. Inputs and dialogs suppress action shortcuts. In practice, number keys choose an answer and Enter advances. The first attempt stays recorded when trying another line.

## Poker correctness and opponents

The native typed engine handles legal action order, heads-up button rules, multiway rounds, short all-ins and reopening, returned uncalled bets, side pots, ties, odd chips, fold wins, showdown, and chip conservation. Eliminations happen after settlement; going all-in does not itself eliminate a player. Heads-up rules take over when two funded seats remain. The final stack wins and standings persist through refresh. Real hands can end before showdown. Reopening uses a documented TDA-style full-wager house policy; one below-minimum opening all-in case differs from PokerKit (see the external-tools record). The authoritative event history supports reconstruction and local recovery.

Six operational profiles use public state and their own cards: **Balanced**, **Tight-aggressive**, **Loose-aggressive**, **Passive**, **Tricky**, and **Exploitative**. The calculated policy estimates showdown equity against assumed ranges, compares it with the eligible call price, and accounts for position, public aggression, multiple opponents, and stack-to-pot ratio. The exploitative profile uses observed public actions with minimum-sample safeguards. Beginner, intermediate, advanced, and expert change policy simplifications, not the legality of play. These remain authored stochastic policies with sampling uncertainty, not verified GTO opponents. See [Poker AI](docs/POKER_AI.md) for calculation assumptions and benchmark limits; the original 9,000-hand V3 benchmark describes the historical v1 policy.

## Analysis without invented certainty

Every hero action records its information set before acting, chosen action, street, legal options, source, assumptions, and confidence. Reviews lead with what you did well, what to work on, and why. Each decision explains the holding, available price, estimated chances, a concrete alternative, and a next-time takeaway. Practice-chip outcomes remain separate from decision quality; scoring details are expandable.

| Analysis                                                        | Meaning                                                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Full-hand model agreement                                       | Agreement with an authored reference policy in supported states; never a GTO or EV score     |
| Unsupported multiway postflop, all-in or out-of-model decisions | Qualitative guidance and applicable arithmetic, with no numeric strategy grade               |
| Pot odds                                                        | Exact immediate, contribution-cap-aware call price; not an estimate of winning equity        |
| V2 river drills                                                 | Exact enumeration and terminal call EV against the explicitly supplied finite weighted range |
| V2 math drills                                                  | Explicit pot-odds, direct-outs, and hypothetical bluff formulas                              |
| Curated/generated preflop coaching                              | Authored educational guidance, excluded from mathematical accuracy                           |

A full-hand number requires at least **75% decision-count coverage and 75% importance coverage**, with no unsupported major decision. Supported decisions are weighted by confidence × decision importance. Insufficient coverage displays **unavailable**. Numerical strategy EV loss and solver frequencies are not invented. No solver-backed strategy pack is shipped. See [Strategy scoring](docs/STRATEGY_SCORING.md).

## Tools actually integrated

- **pokersolver 2.1.4 (MIT):** existing runtime hand evaluator, now used for complete-hand showdown settlement. Its exact [license notice](public/licenses/pokersolver-2.1.4-MIT.txt) remains shipped and linked in Settings.
- **PokerKit 0.7.7 (MIT):** optional development oracle with a pinned wheel hash. A runnable independent pipeline validates legal actions, actor order, stacks and settlement, and exports/reloads PHH histories. It is not downloaded or run in the browser.
- **Native event engine and typed policy/analysis boundaries:** keep local play independent of external services. A types-only, server-side GTO Wizard Score adapter contract is prepared but inactive.

The `poker-engine-ts` candidate was executed and browser-bundled, then deferred after evaluating the seat/replay adapter requirements. OpenSpiel, RLCard, Free GTO, Noam Brown's river solver, official GTO Wizard products, and additional candidates were researched using primary sources. No protected data was scraped, no unlicensed solver output copied, and no paid API enabled. [V3 external tools](docs/V3_EXTERNAL_TOOLS.md) records exact decisions, limitations, licenses, and the PokerKit commands.

## Persistence and recovery

V1/V2 keys (`feltlab-training-v1`, `feltlab-generated-v2`) are preserved. V3 adds `feltlab-table-v3` for reconstructed live/history state and `feltlab-notebook-v3` for saved spots. Loading validates authoritative histories and rebuilds analysis. Invalid records are discarded independently rather than trusted.

Retention is bounded: 60 recent complete hands, 100 saved full hands, 30 saved spots, 2,000 generated attempts, and 200 generated session summaries. Lifetime activity counters survive recent-hand retention; coaching trends use retained records and label this scope. Save important hands before they leave recent history; a full hand notebook refuses further saves instead of silently replacing entries. Saved spots retain the newest 30. Notes stay local. Settings exports a JSON copy of all histories, notes and preferences. Import and cross-device sync remain future work. Reset requires confirmation and removes history/notebook entries while retaining preferences.

Full or blocked browser storage produces a visible notice and play continues in memory. Clearing site data removes local history. A V2 source checkpoint was created before this upgrade at `checkpoints/feltlab-v2-before-v3.zip` (ignored by Git); the earlier V1 checkpoint remains.

## Validation

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:pwa
```

The unit suite includes **10,000 complete seeded hands across 2/3/6-player formats**, every-hand exact history reconstruction, chip conservation, betting edge cases, private-card boundaries, and the preserved 10,000 generated-scenario suite. The independent PokerKit pipeline covers **600 complete hands, 6,294 decisions, and 600 PHH round trips**. It caught a dry-side-pot raising defect during development; the fix has a regression test. These finite checks provide evidence, not a mathematical proof of all poker states.

Browser tests exercise complete play, continuing hands, replay, saved notes, refresh, deferred feedback, ranges, the preserved 100-decision endless flow, mobile geometry, and offline operation. See [Testing](docs/TESTING.md) for final run results and limits. Artifacts are generated under ignored `test-results/`. Playwright uses installed Microsoft Edge; change `channel` in the configs and install Chromium if needed. Test servers are started automatically. Build before running the PWA suite.

## PWA and iPhone

Fonts, card assets, worker and application bundles are local. The production app has a manifest, standard/maskable icons, Apple touch icon, safe-area styles, reduced-motion handling, and offline caching after its first online load. Development mode does not offer production caching. Updates show an explicit refresh prompt.

Host `dist/` over HTTPS, then on iPhone Safari use **Share → Add to Home Screen**. A computer's localhost URL is not reachable from your phone. Physical iPhone Safari, notch/browser toolbar behavior, and installed-device checks remain a release check; desktop emulation does not establish device-specific correctness.

## Documentation and next work

- [Architecture](docs/ARCHITECTURE.md)
- [Poker AI and benchmark](docs/POKER_AI.md)
- [Scoring method and coverage](docs/STRATEGY_SCORING.md)
- [Visual hand replay](docs/HAND_REPLAY.md)
- [External tools and licensing](docs/V3_EXTERNAL_TOOLS.md)
- [Testing](docs/TESTING.md)
- [V4 roadmap](docs/V4_ROADMAP.md)

What If branches, a validated solver pack, paid remote analysis, LLM commentary, accounts/sync, arbitrary hand-history import, and research-trained agents are not implemented. The highest-value next step is a small reproducible heads-up river solver pack with independent convergence checks and strict state matching, while preserving honest unsupported states.
