Photoshop clone production-grade photo editor

## Worktree FIRST — no tracked edit happens outside one

**100% of work that changes a tracked file happens in its own worktree, on its own
branch. `main` is for reading and merging.** The exceptions are enumerated, none of
them a judgement call, in
[`docs/ORCHESTRATION.md#worktrees`](docs/ORCHESTRATION.md#worktrees).

```bash
git rev-parse --show-toplevel                        # FIRST. Every time. Non-negotiable.
# `git worktree list` puts the MAIN checkout first, and $MAIN is absolute: the new
# worktree lands under the main checkout and never nests inside the one you are in.
MAIN="$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)"
git worktree add -b <prefix>/<slug> "$MAIN/.kilo/worktrees/<slug>"
```

- **A commit from `main` is refused**, not warned about: `scripts/main-worktree-guard.mjs`
  runs first in `.husky/pre-commit`, and the refusal names this recipe. It is the floor
  under the rule rather than the rule: it runs after the edit, so a session that writes
  into `main` and never commits is not stopped by it. What stops the write is the process
  above.

The three traps that follow from having a worktree are in **Worktrees and dev servers**
below.

## Subagents INSTRUCTION

LAUNCH AS MANY SUBAGENTS AS THE TASK NEEDS. COMPUTE COSTS ZERO; QUALITY IS THE POINT.

Delegate **first**, not after you get stuck. Fan-out signals: every caller of X, per-file audits, "does this test still pin the old behaviour", one sweep per subsystem.

### Model policy

ALL GPT MODELS ARE PAID. EVERY OTHER MODEL IS FREE

1. A FREE SESSION MUST NEVER LAUNCH A GPT SUBAGENT. NO EXCEPTION
2. A GPT SESSION MAY LAUNCH GPT SUBAGENTS
3. ALWAYS PASS `provider` TOGETHER WITH `model`. "OpenAI" is CORRECT provider for GPT models, "kilo", is CORRECT provider for SpaceBunny.
4. `model: 'Space Bunny Alpha (retires Oct 5)', provider: 'kilo', variant: 'max'` — free, nearly as good as GPT Luna, the DEFAULT. Other free models are useless. The `kilo` provider also lists it as plain `Space Bunny Alpha`; the dated spelling is the one that resolves on this gateway.
5. Cost doubles past 200k of context FOR GPT Luna, and doubles above 270k of context for GPT Terra and Sol. Space Bunny does not have such restriction. IMPORTANT THAT GPT MODELS stay below threshold!
6. `agent_manager`: a managed session inherits the current turn's model, so a main turn on a paid model spawns paid worktrees unless `model` and `provider` are both set.
7. THE GATEWAY PRICES IN THE NAME, AND A CATALOG ENTRY IS NOT A FREE ENTRY. `(free)` is free; a bare name may be paid.
8. **NEVER OMIT `model` AND `provider`!**

```ts
task({
  subagent_type: 'explore', // or 'general'
  model: 'Space Bunny Alpha (retires Oct 5)',
  provider: 'kilo',
  variant: 'max',
  prompt: '...',
});
```

- `agent_manager` (visible sessions, git worktrees) is a different tool: only when the user wants visible sessions or worktrees. `task` for everything else — it creates no sessions.

### Rules of delegation

- **NEVER MORE THAN 15 SUBAGENTS RUNNING AT ONCE, IN ANY COMBINATION** — `task` subagents plus Agent Manager sessions plus background processes you have running. Fan-out is good; a fan-out that saturates the host is not, and 16 is past that point on this machine. Queue the remainder and launch as results land, or split the concern further. The cap is on **simultaneously running**, not on total: a hundred subagents in waves of fifteen is fine.
- **A `task` subagent INHERITS YOUR WORKING DIRECTORY.** NEVER WORK on `main` worktree, unless allowed by operator. Create the worktree BEFORE the first fan-out, and put its absolute path in every brief: a subagent's cwd only affects relative `bash`, so the brief is what moves the work.
- **NEVER TWO SUBAGENTS ON THE SAME FILE.** Split by concern, not by convenience.
- **Self-contained briefs.** A subagent has a fresh context: give it the goal, your constraints, whether it may edit code, and exactly what its final message must contain. "Return file:line for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not verified. Have subagents report candidate results _and_ how they got them, then check the load-bearing ones yourself.
- **`subagent_type: 'explore'` CANNOT RUN ANY COMMAND.**. Use `general` for any research that has to execute something; use `explore` only for reading and searching.
- **Keep judgement calls.** Architecture, scope, whether a deviation is acceptable: a subagent cannot weigh this file against the operator's intent. "Looks good to me" is not authorization.
- **Background for long work** (`background: true`), and wait for every result you depended on. NEVER answer while one is still running.
- **A long finding is a POINTER, not a shorter post.** `board_post` caps the FORMATTED message at **4096 bytes**, not the body at 4096 characters: the envelope costs 191–253 bytes and the counter is bytes, so the budget is **3800 ASCII characters**, or 1200 if any may be non-ASCII. A rejection ends the STEP, not the turn — 117 of 134 recovered, 17 turns died on it. File the finding where a peer reads it uncapped — `npm run swarm -- new "<title>" --body "$(cat /abs/path/finding.md)"`, then post the issue id. `docs/ORCHESTRATION.md` has the measurements and the rest of the swarm text rules.

## NEVER OPEN A BROWSER WINDOW

The e2e suite is headless by default and must stay that way.

| Blocked                         | Why                                                        |
| ------------------------------- | ---------------------------------------------------------- |
| `playwright test --headed`      | a visible window                                           |
| `playwright test --ui`          | opens the Playwright UI in the default browser, and blocks |
| `playwright test --debug`       | forces headed and opens the inspector                      |
| `playwright show-report`        | opens a window, and blocks until it is closed              |
| `playwright show-trace`         | opens a window, and blocks until it is closed              |
| `playwright codegen` / `open`   | opens a window                                             |
| `PLAYWRIGHT_ALLOW_HEADED=1`     | the human's opt-in, not yours                              |
| `test.use({ headless: false })` | a live window                                              |

`kilo.jsonc` denies most of these at the permission layer and `e2e/global-setup.ts` refuses the rest, so the rule survives a model that has forgotten it. **DO NOT "FIX" A FAILURE BY FLIPPING THE MODE** — a headed run fails a disjoint set of tests, on a documented and reproducible set.

### Looking at a live page is allowed, and does not need a window

ALWAYS use headless browser. `npm run probe:console` loads a page
headlessly and reports every console error, page error and failed request, deduplicated with
counts — which is how the nine invalid props on a `<div>` in `useRect` were found, on a suite
that could not see them. `--url`, `--viewport`, `--dsf` and `--allow` are its only
options; `headless` is hardcoded in the script and is not read from the environment.

Do not add a browser MCP server to get this. `permission.bash` globs match shell commands and
`global-setup.ts` only runs inside a Playwright process, so an `mcp_*_navigate_page` call is
neither and would reopen the window these two layers exist to close.

## Commands

```bash
npm run test            # vitest, jsdom - app unit tests
npm run test:e2e:unit   # vitest, node - unit tests for the e2e helpers
npm run test:e2e        # playwright, HEADLESS - starts the dev server itself
npm run tsc             # tsc -b - AUTHORITATIVE typecheck
npm run lint:check      # eslint + prettier --check
npm run build           # production bundle, and a real CI step
npm run probe:console   # playwright, HEADLESS - one page load, reports console + page errors
```

- **RUN FROM THE REPO ROOT** (`ph`), via the shell tool's `workdir`. A parent directory silently resolves the wrong package and the wrong tsconfig.
- **`npm run tsc` IS THE ONLY TRUSTWORTHY TYPECHECK. NEVER GATE ON `npx tsc --noEmit`.** `tsc -b` covers `tsconfig.app/node/e2e.json`, so it also checks the Playwright specs and the test files. `tsconfig.json` at the root is a solution stub — `"files": []` plus references — so `--noEmit` resolves ZERO input files and exits 0 whatever is broken. It does not fall back to the app tsconfig, and that tsconfig includes `src/**/__tests__` anyway.
- `npm run test` is `pool: 'vmThreads'`, `maxWorkers: 4` — a timing-sensitive test that only fails in a full run is usually the pool, not the code.
- `npm run test:e2e` starts Vite itself, on a port it picks. Pass `--retries=1` for a trace; `trace: 'on-first-retry'` yields nothing at the local `retries: 0`.

## Worktrees and dev servers

**A merge may not silently delete the other side's work.** `scripts/merge-takeover-guard.mjs`
runs from `pre-commit` (a conflicted merge being committed) and `pre-merge-commit` (a clean
merge that commits itself), and **refuses** the merge. It catches the shape `tsc` and `build`
cannot: a path the merge resolved by copying one whole side's content, which is a perfectly
good file and compiles. One merge here shipped 17 such reverts and 1,835 lines, none of them
a conflict. `docs/ORCHESTRATION.md` is the one home. Two limits: a **fast-forward fires no
hook at all** (safe by construction — the branch tip contains main as an ancestor), and
`--no-verify` bypasses it, as it bypasses every gate here.

The three traps that follow from having one, each a consequence of a second checkout of
the same repository:

- **`node_modules` is missing in most worktrees.** Node walks up to the parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what makes it misleading. Vite does **not** walk up: it serves only what `server.fs.allow` permits, so fonts, images and AVIF assets from the ancestor checkout 404 in a worktree and work in the root checkout. Run `npm ci` there before debugging an asset that will not load.
- **A run starts its own dev server, on a port of its own.** `scripts/e2e-run.mjs` picks a free port, so `test:e2e` never tests a checkout it did not start. Never set `PLAYWRIGHT_REUSE_EXISTING_SERVER`: `playwright.config.ts` hard-codes `reuseExistingServer: false` and the runner refuses that variable on TRUTHINESS, so even `=false` exits with an error. A bare `npx playwright test` skips the port picker and collides with whatever holds :5173 — use `npm run test:e2e`, or pass `PLAYWRIGHT_PORT=<free>`.
- **The main worktree is not stable while you work.** Other sessions commit into it concurrently. Re-read `git status` / `git diff` before staging, and stage only your own paths.
- **Never remove a worktree by hand.** `npm run dispose -- <name>` is the only path: it checks the inventory's `action`, the board's claims and locks, and the session database, then anchors the branch before it deletes. `git worktree remove --force` and `git branch -D` are denied or gated in `kilo.jsonc`, and there is no reason to defeat them. A refusal names the signal that produced it — an in-flight task is `in-use`, and only the operator may stop a writing chat.

## Test traps

- One setup file: **`src/test/setup.ts`** (jsdom, `OffscreenCanvas`, `createImageBitmap` polyfills). `src/__tests__/` holds `canvas-mock.ts` and shared `fixtures/`. Do not add a second setup file, or global mocks to a path expecting them to load.
- `useHistory` tests mock `useStore` directly, not via `renderHook` + `StoreProvider`: the provider pulls in the durable replay/materialization path, which does not survive the test environment.
- `ToolbarsRight` tests use hoisted `vi.hoisted()` mocks, so module hoisting keeps working. Match the shape.
- `e2e/**` is excluded from `npm run test`, and `**/__tests__/**` / `*.unit.test.ts` are excluded from Playwright. A Playwright spec in jsdom, or an e2e helper test in a browser, fails in a way that looks like a product bug.
- **A spec imports `test` from `./fixtures/extended-test`, never from `@playwright/test`.** That module re-exports everything Playwright does and adds two `auto` fixtures: `consolePolice`, which fails a test on any unaccepted console error or page error, and `pinnedTheme`, which seeds `localStorage.theme` so the suite's pixel oracles keep the light backdrop they are calibrated for under the app's dark default. `auto` is the load-bearing part — it is opt-out, not opt-in. `consolePolice` is not suppressible per test: a legitimately-expected message becomes an `ACCEPTED_CONSOLE_ERRORS` entry in `e2e/helpers/console-police.ts` carrying the reason it is expected. Adding a rule, a skip or a threshold to make that check pass is the same move as raising a gate threshold, and it is not done here.
- Spreading a hook's whole return onto a DOM element is how nine invalid props reached a `<div>` in this app for months. `useRect` now returns `pointerHandlers` / `rectHandles` / `pointerState` so that mistake is a type error.

## Gates

### Local

Four husky hooks, and only two of them wrap a `package.json` script. The other two — `pre-merge-commit` and `post-merge` — run `scripts/*.mjs` directly and are covered in **Worktrees and dev servers** above. The gated sequence is a command anyone can run by hand:

| Command               | Runs from           | Contents                                                       |
| --------------------- | ------------------- | -------------------------------------------------------------- |
| `npm run gate:commit` | `.husky/pre-commit` | `lint-staged --fail-on-changes --no-stash`, then `gate:verify` |
| `npm run gate:verify` | —                   | `tsc` -> `build`                                               |
| `npm run test:staged` | **NOWHERE**         | `vitest related` over the staged paths — a command, not a gate |
| `npm run gate:push`   | `.husky/pre-push`   | `test` — the full app suite, and nothing else                  |

**ONE gate runs on commit, and it runs no app test.** `gate:verify` asks "does the tree still build and typecheck" — and it PASSES a flipped numeric threshold, a renamed branch or a dropped case, the same class of change that has repeatedly needed its own worktree ("Fix 12 failing useHistory tests", "Fix 3 failing replay-coordinator tests", "Fix failing useApp.psd tests", "Fix failing useRect tests"). `test:staged` would ask the second question — "did this commit break a test covering the files in it", and only that — but **no hook invokes it**: `.husky/pre-commit` ends at `npm run gate:commit`, and the full suite is the push gate. Run it by hand when you want the scoped answer. [`docs/TESTING.md`](docs/TESTING.md#teststaged-is-a-command-not-a-gate) is the one home for why it was taken out and what it costs.

- `lint-staged` formats two groups: `*.{ts,tsx}` gets `eslint --fix` and `prettier --write`, everything else `prettier --write` only, because no ESLint config covers it. [`docs/TESTING.md`](TESTING.md#gates) carries the exact second glob and why `.js`, `.scss` and `.jsonc` are in it: `prettier --check .` matches all of them, and anything it matches but lint-staged does not is formatted by nobody at commit time and fails in CI instead.
- `--fail-on-changes` is why the hook is trustworthy: by default lint-staged re-adds whatever `--fix`/`--write` changed, so the commit ends up containing code that was never staged and never read. With the flag the fix stays in the working tree, the index is untouched, and the commit is blocked. `--no-stash` makes that clean — without it a blocked commit leaves a `WIP on <branch>` stash behind. Together: no index rewrite, no residue. Cost is one extra round trip per commit that touched an unformatted file; `npm run format` removes it. One residue does survive: `.git/lint-staged_unstaged.patch` after any blocked commit, and nothing removes it.
- `build` is in the commit hook because it is not redundant. `gate:verify`'s name predates its contents — it runs no lint and no app test, which is why it is a distinct row.
- **NOTHING LOCAL RUNS `lint:check` ANY MORE** (`gate:push` used to). Whole-repo `eslint . --cache` and `prettier --check .` are CI-only, so an already-committed unformatted file, a branch switch that changes lint rules, and a bad rebase are all caught by the `ci` job rather than locally. lint-staged covers the staged files, which is what the `.scss` gap needed.
- `gate:push` does **not** repeat `gate:commit`. It used to, reasoning that a push can follow `--no-verify`, a rebase or a cherry-pick — sound for `tsc`, but it re-ran 9s of deterministic checks to protect 7s of suite time and ran `test:e2e:unit` twice per push. A rebase that broke the build is caught by `ci` in about a minute.
- Measured, for judging a future change to this table: `build` 1.7s, `test:e2e:unit` 1.1s, `tsc -b` 5s, `gate:commit` end to end ~9s, `test:staged` 2.8s by hand, `test` 7-14s.

### CI (Node 24 from `.nvmrc`, which is also what `engines` requires)

**One workflow, three gating jobs.** `.github/workflows/ci.yml` is the only workflow file, and all three jobs run on every push and PR to `main` plus `workflow_dispatch`. None of them declares `needs:`, so they are three independent gates and a red one does not skip the others.

- `ci` — `lint:check` -> `npm audit --audit-level=high` -> `tsc` -> an assertion that every tracked `.ts`/`.tsx` is inside some project's `include` -> `test --coverage` -> `build`. Uploads `coverage/`. `lint:check` is its FIRST step, so an unformatted committed file fails the job before `tsc`, the suite and the build ever run.
- `e2e-unit` — `test:e2e:unit` -> `test:e2e:unit:coverage`, uploads `coverage-e2e/`. A separate job rather than a step in `ci`, so a break in the app pipeline cannot skip the only gate on the e2e helpers.
- `e2e` — the Playwright specs, headless. It used to be `continue-on-error`, justified by five failing specs that are now fixed, so it is a gate.

**One thing CI does NOT gate: dependency licences.** The `dependency-review` job and `.github/dependency-review-config.yml` are both gone. `npm audit --audit-level=high` in `ci` is the vulnerability half and it is real; the licence half is written down in `DEPENDENCIES.md` and nothing enforces it.

**DO NOT WEAKEN A GATE TO GET GREEN: no skips, no raised thresholds, no deleted assertions, no re-recorded visual baselines.** Each is either a real defect with a named fix, or a recording decision that belongs to the operator.

## Known failures and how to read one

On the default headless run **no e2e test fails**. The only skips are 3 declarations (`e2e/sidebar-flyout.spec.ts` right-click on single-tool groups, `e2e/viewport-drawing.spec.ts` line-under-cursor after resize, `e2e/export/photopea.spec.ts` the Photopea round trip). **Do not store the pass count here:** specs generate tests inside `for` loops, so the suite's size is known only by running it, and a stored number is wrong the day a test lands. `docs/TESTING.md` says so, and it is the home for that rule. Three defect groups used to fail and have since been fixed here — the CDP capture-size assertions, the keyboard flyout race, the `levels.spec.ts` canvas lookup. Their pin survives in `e2e/OPEN_PROBLEMS.md` rather than being deleted, because each explains a shape the suite must not drift back into. That pin is the whole of the allowed residue: it lives only as long as the tripwire does, and the fix that removes the tripwire removes the entry with it.

- The remaining `e2e/OPEN_PROBLEMS.md` entries are **latent** defects no current run trips. Read it before investigating a failure; a new failure is a new defect, not a known one.
- A **pin** is a unit test that asserts the current broken behaviour on purpose. It is a tripwire that FAILS the moment the defect is fixed, so a fix MUST remove the pin in the same change. The same rule governs the app's `expected-fail` tests: an expected failure is a declaration about current behaviour, not a skipped requirement.
- **DO NOT widen a threshold, add a skip, or re-record a visual baseline to make a test green.**
- Baselines are now genuinely compared: `visual-regression.spec.ts` re-records only under an explicit `--update-snapshots=all` — a bare `--update-snapshots` resolves to `changed` and does NOT re-record — so a green run means the pixels matched.
- Read a failure from disk, never from a viewer: `screenshot: 'only-on-failure'` puts a PNG in the failing test's `outputDir` under `test-results/`, and the `list` reporter on stdout is the pass/fail record (in CI it also writes `test-results/results.json`). A `trace.zip` needs the trace viewer, which is a window — ask the operator.

## Documentation

`docs/README.md` is the index — every tracked document, the one job it has, and which one wins. `docs/DOCUMENTATION.md` is the rule. Read it before adding a document or treating one as correct.

**The ladder: operator -> Adobe -> this repository -> judgement. Stop at the first that speaks.**

- **Anything about what Photoshop does** — an option, a modifier, a default, a menu, a shortcut — **Adobe's documentation is the source of truth.** Where this repo disagrees with Adobe, Adobe is right and this repo is wrong. Re-derive from Adobe, not from a document here.
- **Anything about this code** — reviewing, refactoring, improving — **the in-app documents are the source of truth.** The code is the last word on what it currently does; the docs are the word on what it must do. Where they disagree that is a finding, not a licence to reconcile it whichever way is cheaper.
- **If something cannot be done in a browser, say so in the docs**

**One fact, one home.** Link, do not restate. A duplicate is a defect — report it. Never edit `docs/TOOLS.md`: it is generated by `npm run docs:tools` and a test fails on drift.

## NO LINE NUMBERS IN PROSE — EVER

**`file.ext:‹line›` is BANNED in every tracked document.

**Cite the unit. There is always a name available.** The banned form is written
below with a `‹line›` placeholder rather than a real number, so this section obeys
the rule it states and the check reads it.

| Instead of                         | Write                                                     |
| ---------------------------------- | --------------------------------------------------------- |
| `` `history-adapter.ts:‹line›` ``  | `` `history-adapter.ts` — `durableLayerForSource()` ``    |
| `` `materialization.ts:‹lines›` `` | `` `materialization.ts` — `materializeDocument()` ``      |
| `` `reducer.ts:‹line›` ``          | `PUBLISH_RUNTIME_PRESENTATION`                            |
| `` `adapter.test.ts:‹line›` ``     | the `it('rejects an unknown source kind')` title          |
| `` `HANDOFF.md:‹lines›` ``         | `HANDOFF.md` — "the tombstone the lifecycle rule forbids" |

- **Code** — the declared identifier in call form (`` `materializeDocument()` ``), the
  string literal the program dispatches on (an action type, a source kind, a
  commit kind), or the `it('...')` title for a test. The file alone, when the claim
  is about the file as a whole.
- **Documents** — the heading or the quoted words. `HANDOFF.md` and
  `docs/DOCUMENTATION.md` carry numbered sections; `§N` is a real anchor and a
  line number is not.
- **A range names ONE enclosing unit, never two endpoints.** A claim too vague to
  name a unit has not been located yet — that is what a line number was hiding.

**The ONE exemption is quotation, in a fenced code block.** A finding whose
subject IS a drifted citation cannot be stated without one. Fences are stripped
before the check reads, so a fence is a claim about the form, not about the code —
and the prose on either side of it is still checked.

**This is enforced, not advised.** `scripts/__tests__/agents-citations.test.mjs`
reads every tracked markdown document and fails on `file.ext:‹line›` outside a
fence, so a document you add is covered the day it lands. The one thing not to do
is relax the check — not by skipping a document, not by an exemption entry, not by
a threshold. The format, and why a name is checkable while a number is not, is
[`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md#citations).

## Handoff documents

`HANDOFF.md`, `.kilo/plans/` and `e2e/OPEN_PROBLEMS.md` are strictly problem-focused and todo-oriented: **NO changelog, NO "work completed", NO status summaries.** Each entry is a validated issue with a problem statement, the affected files, and an actionable fix. Verify every claim against the working tree first, and cite the unit rather than the line: a stale line number sends the next session after a bug that does not exist. The lifecycle rule is in `docs/DOCUMENTATION.md`; it is one line: **fixed and verified deletes the entry.**

## Architecture status

The legacy `HistoryItem[]` path is the **PRODUCTION REPLAY AUTHORITY**: it writes history, replays through `history-replay.ts`, renders runtime `Layer` objects and exports from the runtime canvas and layers. Treat that as the state to read, not a fact to assume — the history work is in flight. Re-read the code and the plans before designing across the legacy/durable boundary.

The durable document is not only a shadow projection: it is mounted as a **navigation presentation cache**. On the `APPLY_HISTORY_REPLAY` path and nowhere else, `StoreContext.tsx` calls `publishDurableNavigationPresentation()`, which replays the durable document at the mapped cursor with `replayDurableAtCursor()`, composes it with `composeDurableDocument()`, and publishes the composed bitmaps into those legacy records' `tmpCanvas`. `layer-renderer.ts` — `getLayerBitmap()` reads `tmpCanvas` first, so on screen and in `renderExportCanvas()` those pixels are the durable ones. It stays subordinate to the legacy replay, and those guards are what makes it safe to design against: it returns early on a `legacy-tool` source, and per layer it accepts only what `durablePresentationIsRendererIdentical()` proves the renderer would not re-apply — no retained operations, matching bounds, a `raster` or `blank` source. A declined, stale or failed composition leaves the legacy presentation in place. `HANDOFF.md` §1 is the one home for this boundary and for what mounting render and export would still require.

The single-writer cutover's old blocker is GONE, not merely moved. It was gated on a canvas-promotion helper that no longer exists — there is no `HANDOFF.md` entry for that gate, live or retired, so this sentence carries no citation and invents none. What the reducer does establish, and all it establishes: TWO arms write the presentation cache. `PROMOTE_LAYER_PRESENTATIONS` re-checks `isSamePresentationCanvas` per record and rewrites only the affected records; `PUBLISH_RUNTIME_PRESENTATION` replaces `layers` wholesale. The guard that proves a publication moves no durable layer state is `layersDifferOnlyByPresentation`, and it is applied on the `PUBLISH_RUNTIME_PRESENTATION` path, NOT on the promotion path — so "a cache cannot be promoted outside reducer publication" was stronger than the code. Check the current reducer rather than re-deriving this from its predecessor.
