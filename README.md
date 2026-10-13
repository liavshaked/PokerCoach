# FeltLab V2

A responsive, local-first heads-up poker decision trainer with endless procedural practice. There is no money, account, backend, or paid API.

## Run

Use Node.js **22.12+**. From this directory in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the URL Vite prints. Use `npm` instead of `npm.cmd` on macOS/Linux. A production build is served with:

```powershell
npm.cmd run build
npm.cmd run preview
```

## What you can practice

- **Endless:** fresh seeded hands until you choose to finish.
- **Focused:** supported streets and concepts, opponent profiles, and difficulty.
- **Challenge:** 10, 20, or 50 decisions with a source-aware review.
- **Weakness:** targets the highest observed mathematical concept error rate from your saved first attempts.
- **Spot library:** the original 16 curated scenarios remain available individually.

Choose a mode, optionally customize, then select **Start Training**. On phones, the table has persistent action controls and a separate analysis sheet. On desktop, analysis sits alongside the table. Number keys choose answers; Enter advances. Replays reveal feedback while preserving the first recorded attempt.

## Strategy, honestly

| Training family       | Evaluation                                                                                               | Scored?                         |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------- |
| River call/fold       | Exact weighted equity and incremental EV against a displayed finite range; no rake, calling ends betting | Yes, under that model           |
| Pot odds              | `call / (current pot + call)`                                                                            | Yes                             |
| Draw probabilities    | Exact chance to hit a specified set of direct outs in one or two cards                                   | Yes; this is not winning equity |
| Bluff mathematics     | Hypothetical zero-equity bluff break-even threshold                                                      | Yes                             |
| Generated preflop     | Authored heads-up weighted ranges and structural hand-strength heuristics                                | Educational guidance only       |
| Original curated pack | Explicit illustrative judgments                                                                          | Educational guidance only       |

**No verified solver pack or verified heads-up range chart is shipped.** Mathematical accuracy measures answers within stated assumptions; it is not a GTO score. There are no invented solver EV losses or strategy frequencies. River EV loss is only reported where the terminal model supports the calculation.

Profiles are **Baseline model** (default), **Tight**, **Aggressive**, and **Recreational**. They define consistent range assumptions. They are not full-hand poker bots. Full heads-up gameplay is deferred pending a complete, separately validated game state machine and policy.

## Generation and architecture

React, TypeScript, Vite, Radix, Motion, Zustand, and a PWA service worker power the app. Assets and fonts are local. The engine is separated into cards, mathematics, weighted ranges, equity, betting rules, and seeded scenario generation.

A seed plus street/category/profile/difficulty reproduces a scenario. Generators construct legal histories, derive pots and stacks from those histories, and validate every scenario before returning it. Card uniqueness, street lengths, turn order, minimum raises, and stack accounting are checked. The river model builds a finite range from public board information, then removes hero-blocked combinations when calculating equity. It does not select opponent weights by peeking at hero cards.

Expensive generation runs in a cancellable **Web Worker** with a bounded timeout. The UI reports failures and offers a same-seed retry. Browser reload rebuilds the current scenario from its seed rather than trusting saved answer data.

The integrated hand evaluator is **`pokersolver@2.1.4`**, MIT licensed, with no runtime dependencies. Its exact notice is preserved at [`public/licenses/pokersolver-2.1.4-MIT.txt`](public/licenses/pokersolver-2.1.4-MIT.txt) and linked in Settings. Integration is covered by known-hand, tie, blocker, weighted-equity, and independent reference tests. Research decisions for PokerKit, Poker Practice, Free GTO, Noam Brown’s solver, poker-evaluator, and TexasSolver are documented below.

- [Architecture](docs/ARCHITECTURE.md)
- [Poker engine research and licensing](docs/POKER_ENGINE_RESEARCH.md)
- [Strategy accuracy and limits](docs/STRATEGY_ACCURACY.md)
- [Next milestones](docs/NEXT_STEPS.md)

## Progress and recovery

Legacy progress remains in `feltlab-training-v1`. Generated training uses a separate versioned `feltlab-generated-v2` entry, so the upgrade preserves existing history and preferences. The app validates saved records, deduplicates attempts, reconstructs the active generated scenario, and excludes heuristic decisions from math accuracy. Progress shows streets, concepts, opponent models, observed trends, session summaries, and missed categories.

The latest **2,000 generated attempts** and **200 generated session summaries** are retained to bound browser storage. Long-running sessions continue beyond these limits; older detailed attempts eventually leave the retained window. Settings exports a JSON backup of both histories and preferences. Import and cross-device synchronization are not implemented. Reset removes histories while retaining preferences. Blocked or full storage produces a visible notice and practice continues in memory. Clearing browser/site data removes local history.

A V1 source checkpoint was saved before V2 implementation in `checkpoints/feltlab-v1-before-v2.zip` (ignored by Git). It excludes dependencies, build output, and user IDE settings.

## Validation

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:pwa
```

Unit tests include at least **10,000 seeded generated scenarios**, deterministic regeneration, independent seven-card hand comparison, poker mathematics, legal betting histories, corruption handling, worker cancellation/timeouts, and session persistence. Browser tests exercise a **100-decision endless session**, replay, reload, focus filters, challenge completion, library, settings, exports, and navigation.

Responsive browser checks and screenshots cover **320, 360, 375, 390, 430, 768, 1024, and 1440px**, plus landscape. Geometry checks detect card-symbol intersections and horizontal overflow; screenshots are also inspected visually. Artifacts and failure traces go to `test-results/`.

Playwright configurations use installed **Microsoft Edge** (`channel: 'msedge'`). To use Playwright-managed Chromium, remove the `channel` property in both Playwright configs and run `npx.cmd playwright install chromium`. Tests start their servers automatically. Build before `test:pwa`.

## PWA and iPhone

The production app includes a standalone manifest, standard and maskable icons, an Apple touch icon, safe-area styles, reduced-motion support, and cached worker/evaluator bundles. Load it online once and allow service-worker installation before using offline practice. Development mode does not provide production caching. Updates show an explicit refresh prompt.

Host `dist/` over **HTTPS**. On iPhone Safari, choose **Share → Add to Home Screen**. A computer’s localhost URL is not reachable from your phone, and an ordinary HTTP LAN URL is insufficient for installation/offline behavior. No App Store deployment is needed.

Automated browser layouts and offline operation are tested locally. Physical iPhone Safari, actual notch/toolbar behavior, and installed-device testing remain a release check; desktop browser emulation does not prove those device-specific behaviors.
