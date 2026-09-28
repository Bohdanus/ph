# AGENTS.md

Photoshop-inspired, production-grade photo editor. Instructions for coding agents.

## Subagents: THE DEFAULT, NOT THE FALLBACK

**LAUNCH AS MANY SUBAGENTS AS THE TASK WARRANTS. COMPUTE COSTS ZERO; QUALITY IS THE POINT.** 40 sequential tool calls in one context = 8 parallel subagents + a 6-call synthesis. Sequential tool calls are the defect, not the token count.

Delegate **first**, not after you get stuck. Fan-out signals: every caller of X, per-file audits, "does this test still pin the old behaviour", one sweep per subsystem.

### Model policy

**ALL GPT MODELS ARE PAID. EVERY OTHER MODEL IS FREE. THAT IS THE WHOLE RULE.**

1. **A FREE SESSION MUST NEVER LAUNCH A PAID SUBAGENT. NO EXCEPTION.** Cost is monotone downwards: a subagent may be weaker than its parent, never more expensive. A `model` that resolves to a GPT model is a bug in your call, not a judgement call. If no free model fits, use the best free one and say in the report that the task deserved a stronger model.
2. **A PAID SESSION MAY LAUNCH PAID SUBAGENTS** on the model the turn is already on — already authorised. Escaping to a _different_ paid model still needs the user to name it in that request. Rule 1 is the other direction.
3. **ALWAYS PASS `provider` TOGETHER WITH `model`.** A bare name is matched leniently (case, punctuation, word order ignored) and can resolve to a different provider's model; with no `provider` it falls back to the **Kilo Gateway**, which returns a GPT model under a `~`-prefixed id — `~openai/gpt-luna-latest` is a gateway substitution, not the `openai` model of that name. **A `~` id is a GPT model, so it is paid.**
4. `model: 'Space Bunny Alpha (new)', provider: 'kilo', variant: 'max'` — free, nearly as good as GPT Luna, the default for nearly every subagent. Other free models are useless; do not spend a turn sampling them.
5. Cost roughly doubles past ~260k of context. Keep the main turn lean; push fan-out into fresh contexts.
6. `agent_manager` too: a managed session inherits the current turn's model, so a main turn on a paid model spawns paid worktrees unless `model` and `provider` are both set.

```ts
task({
  subagent_type: 'explore', // or 'general'
  model: 'Space Bunny Alpha (new)',
  provider: 'kilo',
  variant: 'max',
  prompt: '...',
});
```

- Omitting those three fields inherits the current turn's model. Passing them explicitly is what keeps a subagent free when the main turn is not.
- **DO NOT ESCALATE TO A PAID MODEL ON YOUR OWN** for "hard" or "risky" work. Override only when the user named a GPT model in that request, and say so when you do.
- `agent_manager` (visible sessions, git worktrees) is a different tool: only when the user wants visible sessions or worktrees. `task` for everything else — it creates no sessions.
- Audit before spawning a fleet, not after: `sqlite3 ~/.local/share/kilo/kilo.db "SELECT json_extract(model,'\$.id') m, json_extract(model,'\$.providerID') p, count(*) FROM session GROUP BY 1,2 ORDER BY 3 DESC"` — `session.model` is a TEXT column holding JSON; there is no `data` column on `session`. On 2026-09-28 a free orchestrator (`ses_f1b1bccb…`) sent two subagents with a bare model name, the resolver fell through to the Kilo Gateway onto `~openai/gpt-luna-latest`, and both died in under a second on `APIError: Add credits to continue, or switch to a free model` at zero tokens — rule 1 breached by an agent that was itself free.

### Rules of delegation

- **NEVER TWO SUBAGENTS ON THE SAME FILE.** Split by concern, not by convenience.
- **Self-contained briefs.** A subagent has a fresh context: give it the goal, your constraints, whether it may edit code, and exactly what its final message must contain. "Return file:line for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not verified. Have subagents report candidate results _and_ how they got them, then check the load-bearing ones yourself.
- **Keep judgement calls.** Architecture, scope, whether a deviation is acceptable: a subagent cannot weigh this file against the operator's intent. "Looks good to me" is not authorization.
- **Background for long work** (`background: true`), and wait for every result you depended on. NEVER answer while one is still running.

## NEVER OPEN A BROWSER WINDOW

The e2e suite is headless by default and must stay that way. A headed browser puts a live, clickable window on the operator's screen for the whole run; their clicks, keystrokes, mouse movement and focus changes reach the page as real input, indistinguishable from the suite's own `page.mouse` / `page.keyboard` calls, so the run fails for reasons that are not in the code and look exactly like real races.

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
- `npm run test:e2e` starts Vite on :5173 itself. Pass `--retries=1` for a trace; `trace: 'on-first-retry'` yields nothing at the local `retries: 0`.

## Worktrees and dev servers

One git worktree per task, all under `.kilo/worktrees/`. Three traps that cost real debugging time:

- **`node_modules` is empty or missing in most worktrees.** Node walks up to the parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what makes it misleading. Vite does **not** walk up: it serves only what `server.fs.allow` permits, so fonts, images and AVIF assets from the ancestor checkout 404 in a worktree and work in the root checkout. Run `npm ci` there before debugging an asset that will not load.
- **Every worktree's dev server wants :5173.** Locally `reuseExistingServer` is on, so `test:e2e` can attach to a server another worktree started and then test _that_ checkout. Use `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` in a worktree. "My change did nothing" in e2e is this, not a cache.
- **The main worktree is not stable while you work.** Other sessions commit into it concurrently. Re-read `git status` / `git diff` before staging, and stage only your own paths.

## Test traps

- One setup file: **`src/test/setup.ts`** (jsdom, `OffscreenCanvas`, `createImageBitmap` polyfills). `src/__tests__/` holds `canvas-mock.ts` and shared `fixtures/`. Do not add a second setup file, or global mocks to a path expecting them to load.
- `useHistory` tests mock `useStore` directly, not via `renderHook` + `StoreProvider`: the provider pulls in the durable replay/materialization path, which does not survive the test environment.
- `ToolbarsRight` tests use hoisted `vi.hoisted()` mocks, so module hoisting keeps working. Match the shape.
- `e2e/**` is excluded from `npm run test`, and `**/__tests__/**` / `*.unit.test.ts` are excluded from Playwright. A Playwright spec in jsdom, or an e2e helper test in a browser, fails in a way that looks like a product bug.

## Gates

### Local

`gate:commit`: `lint-staged --fail-on-changes --no-stash`, then `gate:verify` (`tsc` -> `build` -> `test:e2e:unit`). `test:staged` then runs related tests. `gate:push` runs the full app suite.

- `gate:verify` proves types/build; `test:staged` catches behavior that those pass. `test:staged` needs no guard, but is incomplete: an unimported file passes it; `gate:push` covers that.
- Keep the staged-path pipeline NUL-safe: `git diff --cached --name-only -z | xargs -0`. Unquoted command substitution can word-split/glob-expand into a silent `No test files found` pass.
- `*.{ts,tsx}` uses ESLint + Prettier; `*.{js,scss,jsonc,yml,yaml,md,json}` uses Prettier only. **Do not add ESLint for the latter group**: no config covers it, and doing so breaks Markdown/SCSS commits.
- `--fail-on-changes --no-stash` leaves formatter fixes unstaged and blocks the commit; never allow hooks to rewrite the index.
- `build` is not redundant with `tsc`: it catches Sass, wasm, PostCSS, and import resolution. **NO LOCAL `lint:check`**; whole-tree linting is CI-only.

### CI

- `ci`: lint, high-severity audit, typecheck, TS-project coverage assertion, coverage tests, build.
- `e2e-unit`: e2e helper tests and coverage.
- `e2e`: headless Playwright.
- `dependency-review` (PRs): policy in `.github/dependency-review-config.yml`.

**DO NOT WEAKEN A GATE TO GET GREEN: no skips, raised thresholds, deleted assertions, or re-recorded baselines.** Fix the defect or leave the recording decision to the operator.

## E2E failures

- Read `e2e/OPEN_PROBLEMS.md` first. A new failure is a new defect.
- A pin/`expected-fail` is a tripwire for broken behavior; remove it in the same change that fixes the defect.
- Visual baselines re-record only with `--update-snapshots`; green means pixels matched.
- Read failures from `test-results/`; `trace.zip` needs a window, so ask the operator.

## Handoff documents

`HANDOFF.md`, `.kilo/plans/`, and `e2e/OPEN_PROBLEMS.md`: validated, actionable problems only. **NO changelog, completion notes, or status summaries.** Verify against the tree.

**WRITE OR UPDATE THE HANDOFF WITHOUT ASKING** for every validated issue, strong recommendation, or durable finding. Ship it with the work.

### Lifecycle: entries die, they never get reworded

- **Verified fix: DELETE the entry.** Verification is another agent, review, or test, not the fixer's claim.
- **Never rewrite an open problem as closed.** Keep unverified work as the exact remaining verification; keep only test tripwires after a fix.

## Architecture status

`HistoryItem[]` is the **PRODUCTION REPLAY AUTHORITY**: history, `history-replay.ts`, runtime `Layer`s, and export. The durable document is shadow-only. Re-read code and plans before crossing the boundary. **DO NOT start single-writer cutover while `saveLayerCanvas()` promotes cached canvases outside reducer publication.**
