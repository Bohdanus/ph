Photoshop clone production-grade photo editor

## Subagents INSTRUCTION

LAUNCH AS MANY SUBAGENTS AS THE TASK NEEDS. COMPUTE COSTS ZERO; QUALITY IS THE POINT.

Delegate **first**, not after you get stuck. Fan-out signals: every caller of X, per-file audits, "does this test still pin the old behaviour", one sweep per subsystem.

### Model policy

ALL GPT MODELS ARE PAID. EVERY OTHER MODEL IS FREE

1. A FREE SESSION MUST NEVER LAUNCH A GPT SUBAGENT. NO EXCEPTION
2. A GPT SESSION MAY LAUNCH GPT SUBAGENTS
3. ALWAYS PASS `provider` TOGETHER WITH `model`. "OpenAI" is correct provider for GPT models, "Kilo", is the ONLY right way for SpaceBunny.
4. `model: 'Space Bunny Alpha (new)', provider: 'kilo', variant: 'max'` — free, nearly as good as GPT Luna, the DEFAULT. Other free models are useless.
5. Cost doubles past 200k of context FOR GPT Luna, and doubles above 270k of context for GPT Terra and Sol. Space Bunny does not have such restriction. IMPORTANT THAT GPT MODELS stay below threshold!
6. `agent_manager`: a managed session inherits the current turn's model, so a main turn on a paid model spawns paid worktrees unless `model` and `provider` are both set.

```ts
task({
  subagent_type: 'explore', // or 'general'
  model: 'Space Bunny Alpha (new)',
  provider: 'kilo',
  variant: 'max',
  prompt: '...',
});
```

- Omitting those three fields inherits the current turn's model.
- `agent_manager` (visible sessions, git worktrees) is a different tool: only when the user wants visible sessions or worktrees. `task` for everything else — it creates no sessions.
- Audit before spawning a fleet, not after: `sqlite3 ~/.local/share/kilo/kilo.db "SELECT id, model, parent_id, title FROM session WHERE json_extract(data,'\$.model') …"`. On 2026-09-28 a free orchestrator (`ses_f1b1bccb…`) sent two subagents with a bare model name, the resolver fell through to the Kilo Gateway onto `~openai/gpt-luna-latest`, and both died in under a second on `APIError: Add credits to continue, or switch to a free model` at zero tokens — rule 1 breached by an agent that was itself free.

### Rules of delegation

- **NEVER TWO SUBAGENTS ON THE SAME FILE.** Split by concern, not by convenience.
- **Self-contained briefs.** A subagent has a fresh context: give it the goal, your constraints, whether it may edit code, and exactly what its final message must contain. "Return file:line for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not verified. Have subagents report candidate results _and_ how they got them, then check the load-bearing ones yourself.
- **Keep judgement calls.** Architecture, scope, whether a deviation is acceptable: a subagent cannot weigh this file against the operator's intent. "Looks good to me" is not authorization.
- **Background for long work** (`background: true`), and wait for every result you depended on. NEVER answer while one is still running.

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

`kilo.jsonc` denies most of these at the permission layer and `e2e/global-setup.ts` refuses the rest, so the rule survives a model that has forgotten it. **DO NOT "FIX" A FAILURE BY FLIPPING THE MODE** — a headed run fails a disjoint set of tests, on a documented and reproducible set. If something only reproduces visually, that is the operator's call; ask them to run `npm run test:e2e:headed` themselves.

## Commands

```bash
npm run test            # vitest, jsdom - app unit tests
npm run test:e2e:unit   # vitest, node - unit tests for the e2e helpers
npm run test:e2e        # playwright, HEADLESS - starts the dev server itself
npm run tsc             # tsc -b - AUTHORITATIVE typecheck
npm run lint:check      # eslint + prettier --check
npm run build           # production bundle, and a real CI step
```

- **RUN FROM THE REPO ROOT** (`ph`), via the shell tool's `workdir`. A parent directory silently resolves the wrong package and the wrong tsconfig.
- **`npm run tsc` IS THE ONLY TRUSTWORTHY TYPECHECK. NEVER GATE ON `npx tsc --noEmit`.** `tsc -b` covers `tsconfig.app/node/e2e.json`, so it also checks the Playwright specs and the test files. `npx tsc --noEmit` resolves the app tsconfig alone, which excludes tests: it exits 0 while the tests do not compile.
- `npm run test` is `pool: 'vmThreads'`, `maxWorkers: 4` — a timing-sensitive test that only fails in a full run is usually the pool, not the code.
- `npm run test:e2e` starts Vite itself, on a port it picks. Pass `--retries=1` for a trace; `trace: 'on-first-retry'` yields nothing at the local `retries: 0`.

## Worktrees and dev servers

One git worktree per task, all under `.kilo/worktrees/`. Three traps that cost real debugging time:

- **`node_modules` is empty or missing in most worktrees.** Node walks up to the parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what makes it misleading. Vite does **not** walk up: it serves only what `server.fs.allow` permits, so fonts, images and AVIF assets from the ancestor checkout 404 in a worktree and work in the root checkout. Run `npm ci` there before debugging an asset that will not load.
- **A run starts its own dev server, on a port of its own.** `scripts/e2e-run.mjs` picks a free port, so `test:e2e` never tests a checkout it did not start. Never set `PLAYWRIGHT_REUSE_EXISTING_SERVER`: `playwright.config.ts` hard-codes `reuseExistingServer: false` and the runner refuses that variable on TRUTHINESS, so even `=false` exits with an error. A bare `npx playwright test` skips the port picker and collides with whatever holds :5173 — use `npm run test:e2e`, or pass `PLAYWRIGHT_PORT=<free>`.
- **The main worktree is not stable while you work.** Other sessions commit into it concurrently. Re-read `git status` / `git diff` before staging, and stage only your own paths.

## Test traps

- One setup file: **`src/test/setup.ts`** (jsdom, `OffscreenCanvas`, `createImageBitmap` polyfills). `src/__tests__/` holds `canvas-mock.ts` and shared `fixtures/`. Do not add a second setup file, or global mocks to a path expecting them to load.
- `useHistory` tests mock `useStore` directly, not via `renderHook` + `StoreProvider`: the provider pulls in the durable replay/materialization path, which does not survive the test environment.
- `ToolbarsRight` tests use hoisted `vi.hoisted()` mocks, so module hoisting keeps working. Match the shape.
- `e2e/**` is excluded from `npm run test`, and `**/__tests__/**` / `*.unit.test.ts` are excluded from Playwright. A Playwright spec in jsdom, or an e2e helper test in a browser, fails in a way that looks like a product bug.

## Gates

### Local

Two husky hooks, both delegating to a script in `package.json`, so the gated sequence is a command anyone can run by hand:

| Command               | Runs from           | Contents                                                       |
| --------------------- | ------------------- | -------------------------------------------------------------- |
| `npm run gate:commit` | `.husky/pre-commit` | `lint-staged --fail-on-changes --no-stash`, then `gate:verify` |
| `npm run gate:verify` | —                   | `tsc` -> `build` -> `test:e2e:unit`                            |
| `npm run test:staged` | `.husky/pre-commit` | `vitest related` over the staged paths, after `gate:commit`    |
| `npm run gate:push`   | `.husky/pre-push`   | `test` — the full app suite, and nothing else                  |

The commit hook is two gates because they answer different questions. `gate:verify` asks "does the tree still build and typecheck". `test:staged` asks "did this commit break a test covering the files in it" — and only that. Both `tsc` and `build` PASS a flipped numeric threshold, a renamed branch or a dropped case, so without the second gate such a change commits cleanly and dies in CI: the same class of fix that has repeatedly needed its own worktree ("Fix 12 failing useHistory tests", "Fix 3 failing replay-coordinator tests", "Fix failing useApp.psd tests", "Fix failing useRect tests").

- `test:staged` is a 2.8s scoped run where the full suite is 7-14s, and it is unconditionally safe in Vitest 5: no matching staged path reports `No test files found` and exits 0, and a staged path outside `src/` (`.md`, an `e2e/**` helper, a binary asset) also exits 0 without running the whole suite. It therefore needs no `--passWithNoTests` and no guard. What it does **not** give you is completeness: a file with no test importing it passes, which is why the full suite still runs at push.
- A **merge commit** is index-vs-`HEAD`, so `git diff --cached` reports every file the merge brings in rather than what was staged: 120 merged `src` paths measure 9.8s and 81 test files, making the hook ~19s instead of ~12s. Slower, never a false pass. The selection derives from Vite's module graph, so it is not stable across environments (a staged `package.json` selects all 180 test files in a warm checkout, none in a fresh install). Do not rely on a staged non-`src` file dragging in its dependents.
- The staged list is read with `-z` and passed through `xargs -0` **ON PURPOSE**. An unquoted `$(git diff --cached --name-only)` word-splits and glob-expands, and the failure is SILENT: a path expanding to nothing makes vitest report `No test files found` and exit 0, so the gate appears to pass while testing nothing. The shell form works today only by accident of the current tree (no tracked name contains a space or glob metacharacter); `src/components/[id]/`-style paths are the plausible next break. Empty input is a true no-op — BSD `xargs` does not invoke the command at all — so a docs-only commit costs 0.04s.
- `lint-staged` formats two groups. `*.{ts,tsx}` gets `eslint --fix` and `prettier --write`; `*.{js,scss,jsonc,yml,yaml,md,json}` gets `prettier --write` only, because no ESLint config covers those. The second group deliberately includes `.js`, `.scss` and `.jsonc`: `prettier --check .` matches all of them, and anything it matches but lint-staged does not is formatted by nobody at commit time and fails in CI instead.
- `--fail-on-changes` is why the hook is trustworthy: by default lint-staged re-adds whatever `--fix`/`--write` changed, so the commit ends up containing code that was never staged and never read. With the flag the fix stays in the working tree, the index is untouched, and the commit is blocked. `--no-stash` makes that clean — without it a blocked commit leaves a `WIP on <branch>` stash behind. Together: no index rewrite, no residue. Cost is one extra round trip per commit that touched an unformatted file; `npm run format` removes it. One residue does survive: `.git/lint-staged_unstaged.patch` after any blocked commit, and nothing removes it.
- `build` is in the commit hook because it is not redundant with `tsc`: `vite build` runs Babel and esbuild, which strip types without checking them, so it catches Sass, wasm resolution, PostCSS and import resolution that `tsc` cannot, while `tsc` catches types the bundle never sees. `gate:verify`'s name predates its contents — it runs no lint and no app test, which is why it is a distinct row.
- **NOTHING LOCAL RUNS `lint:check` ANY MORE** (`gate:push` used to). Whole-repo `eslint . --cache` and `prettier --check .` are CI-only, so an already-committed unformatted file, a branch switch that changes lint rules, and a bad rebase are all caught by the `ci` job rather than locally. lint-staged covers the staged files, which is what the `.scss` gap needed.
- `gate:push` does **not** repeat `gate:commit`. It used to, reasoning that a push can follow `--no-verify`, a rebase or a cherry-pick — sound for `tsc`, but it re-ran 9s of deterministic checks to protect 7s of suite time and ran `test:e2e:unit` twice per push. A rebase that broke the build is caught by `ci` in about a minute.
- Measured, for judging a future change to this table: `build` 1.7s, `test:e2e:unit` 1.1s, `test:staged` 2.8s, `tsc -b` 5s, `gate:commit` end to end ~9s, `test:staged` adding ~3s, `test` 7-14s.

### CI (Node 24 from `.nvmrc`, which is also what `engines` requires)

Four gating jobs on every push and PR to `main`, plus `workflow_dispatch`:

- `ci` — `lint:check` -> `npm audit --audit-level=high` -> `tsc` -> an assertion that every tracked `.ts`/`.tsx` is inside some project's `include` -> `test --coverage` -> `build`. Uploads `coverage/`.
- `e2e-unit` — `test:e2e:unit` -> `test:e2e:unit:coverage`, uploads `coverage-e2e/`. Separate from `ci` so a break in the app pipeline cannot skip the only gate on `e2e/`.
- `e2e` — the Playwright specs. It used to be `continue-on-error`, justified by five failing specs that are now fixed; the job was reporting a state the suite no longer had, so it is a gate. What it does not rest on: the CDP capture assertions are mode- and host-independent by construction, so the disjoint per-mode failing sets that justified `continue-on-error` are empty by design, not by observation.
- `dependency-review` — pull requests only. Enforces `.github/dependency-review-config.yml`: denies GPL-3.0-only and AGPL-3.0-only, fails on a high-severity advisory, allowlists MIT, Apache-2.0, BSD-2/3-Clause, ISC, MPL-2.0, CC0-1.0, Unlicense, WTFPL, Zlib, CC-BY-4.0 and CC-BY-SA-4.0. That list was written when nothing read the file, so no dependency has ever been checked against it; tightening it is a policy call, not a cleanup.

**DO NOT WEAKEN A GATE TO GET GREEN: no skips, no raised thresholds, no deleted assertions, no re-recorded visual baselines.** Each is either a real defect with a named fix, or a recording decision that belongs to the operator.

## Known failures and how to read one

On the default headless run **no e2e test fails**: 97 pass, 2 are skipped by declaration. Stable across repeated full runs. Three defect groups used to fail and have since been fixed here — the CDP capture-size assertions, the keyboard flyout race, the `levels.spec.ts` canvas lookup. Their pin survives in `e2e/OPEN_PROBLEMS.md` rather than being deleted, because each explains a shape the suite must not drift back into. That pin is the whole of the allowed residue: it lives only as long as the tripwire does, and the fix that removes the tripwire removes the entry with it.

- The remaining `e2e/OPEN_PROBLEMS.md` entries are **latent** defects no current run trips. Read it before investigating a failure; a new failure is a new defect, not a known one.
- A **pin** is a unit test that asserts the current broken behaviour on purpose. It is a tripwire that FAILS the moment the defect is fixed, so a fix MUST remove the pin in the same change. The same rule governs the app's `expected-fail` tests: an expected failure is a declaration about current behaviour, not a skipped requirement.
- **DO NOT widen a threshold, add a skip, or re-record a visual baseline to make a test green.**
- Baselines are now genuinely compared: `visual-regression.spec.ts` re-records only under an explicit `--update-snapshots`, so a green run means the pixels matched.
- Read a failure from disk, never from a viewer: `screenshot: 'only-on-failure'` puts a PNG in the failing test's `outputDir` under `test-results/`, and the `list` reporter on stdout is the pass/fail record (in CI it also writes `test-results/results.json`). A `trace.zip` needs the trace viewer, which is a window — ask the operator.

## Handoff documents

`HANDOFF.md`, `.kilo/plans/` and `e2e/OPEN_PROBLEMS.md` are strictly problem-focused and todo-oriented: **NO changelog, NO "work completed", NO status summaries.** Each entry is a validated issue with a problem statement, the affected files, and an actionable fix. Verify every claim against the working tree first — stale line numbers send the next session after a bug that does not exist.

### Writing is the default, not a favour

**LEAVE A HANDOFF DOC, OR EDIT THE EXISTING ONE, WHENEVER YOU FIND A validated ISSUE, a strong recommendation, or a finding worth preserving. DO NOT ASK PERMISSION.** The strongest case by far is a confirmed defect: you investigated, it is real, and nobody else knows. Not finding anything is the only reason to leave the doc alone.

**Handoff docs are maintained like source: THEY SHIP WITH THE CODE.** The edit belongs in the same commit as the work that produced the finding. A stale entry is not neutral — the next session spends a full investigation on a bug that is already gone, and a missing entry loses the only record of a real one.

### Lifecycle: entries die, they never get reworded

- **Fixed and verified DELETES the entry.** The same change that fixes an issue removes it.
- **NEVER rewrite an open problem into a closed one.** "issue X fixed in abc123" is a new entry wearing the old one's name. Delete it.
- **A trail of fixed issues is pollution.** Retained "fixed" notes are prose the next session reads instead of a problem it can act on, and they bury the problems still open. The only residue a fix may leave is a tripwire in the test code, not a paragraph in the doc.
- **Unverified is not closed.** A fix that landed without a check leaves the entry alive: tighten it to say exactly what still needs verifying, and let that verification delete it.

## Architecture status

The legacy `HistoryItem[]` path is the **PRODUCTION REPLAY AUTHORITY**: it writes history, replays through `history-replay.ts`, renders runtime `Layer` objects and exports from the runtime canvas and layers. The durable document is still a shadow projection, NOT the authority for rendering. Treat that as the state to read, not a fact to assume — the history work is in flight. Re-read the code and the plans before designing across the legacy/durable boundary. **DO NOT start a single-writer cutover while `saveLayerCanvas()` can still promote cached canvases outside reducer publication.**
