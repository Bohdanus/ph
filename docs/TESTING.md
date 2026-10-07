# Testing, gates, and CI

Everything about running this repository's checks: the commands, the local and CI
gates, the traps, and the browser-window ban. `AGENTS.md` carries the rules that
apply to every task and a one-line pointer here; read this file when you are
running or changing a check.

## NEVER OPEN A BROWSER WINDOW

A headed browser takes over the operator's screen, and their input reaches the
page as real test input — so the run fails for reasons that are not in the code
and look exactly like real races. The e2e suite is headless and stays that way.

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

**DO NOT "FIX" A FAILURE BY FLIPPING THE MODE** — a headed run fails a disjoint
set of tests, on a documented and reproducible set. If something only reproduces
visually, that is the operator's call; ask them to run
`npm run test:e2e:headed` themselves.

`kilo.jsonc` denies most of these at the permission layer and
`e2e/global-setup.ts` refuses the rest, so the rule survives a model that has
forgotten it. Two rows have weaker coverage than the table implies:

- `--debug` is an **`ask`**, not a `deny`, at the permission layer, so approving
  the prompt is possible — and the `global-setup.ts` argv guard throws anyway, so
  the run still does not start headed. Layered, not open.
- `test.use({ headless: false })` **inside a single spec file is blocked by
  nothing.** `global-setup.ts` inspects the _project_ scope and names the per-spec
  hole explicitly. Read the table's last row as "do not do this", not as
  "something will stop you".

## Commands

```bash
npm run test            # vitest, jsdom - app unit tests
npm run test:e2e:unit   # vitest, node - unit tests for the e2e helpers
npm run test:e2e        # playwright, HEADLESS - starts its OWN server on a port it picks
npm run tsc             # tsc -b - AUTHORITATIVE typecheck
npm run lint:check      # eslint + prettier --check
npm run build           # production bundle, and a real CI step
```

`e2e/README.md` is the depth behind `test:e2e`, `test:e2e:unit`, and visual
baselines. This file is the gate contract; that one is the e2e suite's own
documentation.

**`npm run test:e2e` is a WRAPPER (`scripts/e2e-run.mjs`), not `playwright test`.**
It does two independent things, and telling them apart is the whole design.

**The guarantee: the run starts its own server.** It picks a port, verifies it is
still bindable immediately before starting, and exports it as `PLAYWRIGHT_PORT` so
the dev server, the `baseURL` the tests navigate to and the port Playwright probes
are one number belonging to that run. `playwright.config.ts` sets
`reuseExistingServer: false` as a literal, with no environment variable and no
field that can turn it on, and the server is started with `--strictPort`. The
outcome is binary: a run gets a server it started, or it is red. **There is no
third state in which the suite quietly tests another worktree's checkout** — the
failure `TEST-FLAKES.md` §10 is a whole mutation campaign about.
`PLAYWRIGHT_REUSE_EXISTING_SERVER` is refused outright, and `PLAYWRIGHT_BASE_URL`
is refused unless the run says `E2E_ALLOW_REMOTE=1`, which it logs.

**The optimisation: a queue, which is only a queue.** The run also takes the swarm
lock `e2e/.swarm-e2e-runner` so two agents rarely run e2e at once. **No run ever
refuses to start because of it** — a full queue, an unreachable board and a
malformed lease all produce a message and then a normal run, because the port
guarantee does not depend on any of it. Two runs at once is survivable: each has
its own port and its own output directory. Do not "fix" a slow run by making the
lock load-bearing; that is the change that put an unenforceable mechanism in front
of a merge gate once already. Board detail: [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).

Each run also writes to its own `test-results/runs/<run-id>/`, because Playwright
**deletes** `outputDir` at the start of every run, and records its port to
`.kilo/e2e-last-run.json` so a run that fails later is diagnosable. Every argument
after `--` is forwarded verbatim, after the `test` subcommand npm would otherwise
drop.

## Running commands

- **RUN FROM THE REPO ROOT** (`ph`), via the shell tool's `workdir`. A parent
  directory silently resolves the wrong package and the wrong tsconfig.
- **`npm run tsc` IS THE ONLY TRUSTWORTHY TYPECHECK. NEVER GATE ON `npx tsc --noEmit`.** `tsc -b` covers `tsconfig.app/node/e2e.json`, so it also checks the Playwright specs and the test files. `npx tsc --noEmit` at the root resolves the **solution stub** and type-checks **zero files**, for the reason in the next bullet — it is not a narrower project, it is an empty one.
- **The bare `npx tsc` type-checks ZERO files and always exits 0.** The root `tsconfig.json` is a solution stub — `"files": []`, no `include`, three `references` — so `npx tsc --showConfig -p tsconfig.json` prints `{"compilerOptions": {}}` and the references. It is indistinguishable from a pass, and `.claude/settings.local.json` in the operator's ROOT checkout carries a `"allow": ["Bash(npx tsc:*)"]` wildcard that auto-approves exactly that command. That file is untracked and globally gitignored (`~/.config/git/ignore` has `**/.claude/settings.local.json`), so no worktree, `git status` or `git ls-files` can see it — its absence from your worktree is not its absence from the machine. Only `npm run tsc` (`tsc -b`) type-checks anything.
  - **It is the stub, not a missing `exclude`, that makes the stub empty.** `tsconfig.app.json` has **no** `exclude` and its `include` is `["src", "toolbar-mapping.ts"]`, so the app project pulls in its test files rather than hiding them. Any future note explaining the trap as "the app tsconfig excludes tests" is wrong on both clauses.
  - **THE SILENCE COMES FROM `references`, NOT FROM ANY SETTING.** Measured on the repo's own TypeScript: a config written `"files": []`, `"include": []`, or `"composite": true` **with no `references`** is not silent at all — plain `tsc` exits 2 with TS18002/TS18003 ("the files list is empty", "no inputs were found"). Add a non-empty `references` and the same config goes quiet: plain `tsc` exits 0 on zero files, while `tsc -b` works. Empty `references: []` stays loud, because it is not a solution root. So nothing inside that combination can be adjusted to fail one mode and not the other, and the stub is not fixable by tuning. An earlier version of this bullet claimed those shapes were each silent; a review showed all of them exit 2, and the mechanism is the references array.
  - **A DIFFERENT SHAPE WOULD PARTLY WORK, and is not adopted.** Make the root own `src` and turn the two satellite projects `composite`, and bare `tsc` does catch app errors. It is still wrong to gate on: a root that owns `src` cannot see `e2e/` (measured — adding `"e2e"` to its `include` is what brings those files in), so it would be a **partial** check reading as a whole one. Both the command (`tsc -b`) and the interception below close that case too.
- **`node_modules/.bin/tsc` IS A GUARD, NOT THE COMPILER.** `npm install` links `scripts/tsc-guard.mjs` there, so `npx tsc`, a bare `tsc` on an npm script's PATH, and `./node_modules/.bin/tsc` all hit it. It **refuses any invocation that is not build mode** (with a short whitelist of flags that print, and a refusal for `--noCheck`, which is a build that checks nothing), exits 1, and names `npm run tsc` and `npx tsc -b <project>` instead. Build mode takes a project as its argument, so the narrow check is never lost — that is what makes an unconditional refusal honest rather than merely strict. `kilo.jsonc` denies `npx tsc` at the permission layer for the same reason, and re-allows the two build-mode spellings; the guard is the layer that also covers the other spellings.
  - **The shim is bypassed by invoking the compiler file directly.** `node node_modules/typescript/bin/tsc` runs the unguarded compiler against the empty root solution, so it is not a typecheck. Use `npm run tsc`.
  - **If `npx tsc` ever exits 0 again, the guard is missing, not the rule.** npm relinks bins with `force: true` from inside `reify`, and only `install` and `ci` re-run `prepare` afterwards, so a reifying command can silently restore the plain npm symlink. `npm rebuild` is the one measured end to end; `update`, `dedupe`, `prune` and `audit fix` share that code path but were NOT each observed to clobber (an audit found `dedupe` and `prune` did not), so treat the list as the risk surface rather than as observations. That cannot be prevented inside `node_modules`, so it is made LOUD instead: `scripts/__tests__/tsc-guard.test.mjs` resolves the same link npm would and fails when it is the wrong file. **Run `npm install` to repair; do not "fix" the failing test.**
- `npm run test` is `pool: 'vmThreads'`, `maxWorkers: 4` — a timing-sensitive
  test that only fails in a full run is usually the pool, not the code.
- `npm run test:e2e` is a WRAPPER (`scripts/e2e-run.mjs`), not `playwright test`:
  it starts its **own** dev server on a port it picks, makes attaching to any other
  server impossible, writes the run's output to its own directory, records its
  port, and forwards every argument after `--` verbatim. It also takes a swarm lock
  as an advisory queue — see "The Commands" section above for the guarantee and the
  queue, and why the second must never be allowed to block a run. Pass
  `--retries=1` for a trace; `trace: 'on-first-retry'` yields nothing at the local
  `retries: 0`. **A user-visible change still runs the full suite before it
  merges.** See `e2e/README.md` and the header of `scripts/e2e-run.mjs`.

## Test traps

- One setup file: **`src/test/setup.ts`** (jsdom, `OffscreenCanvas`,
  `createImageBitmap` polyfills). `src/__tests__/` holds `canvas-mock.ts` and
  shared `fixtures/`. Do not add a second setup file, or global mocks to a path
  expecting them to load.
- `useHistory` tests mock `useStore` directly, not via `renderHook` +
  `StoreProvider`: the provider pulls in the durable replay/materialization
  path, which does not survive the test environment.
- `ToolbarsRight` tests use hoisted `vi.hoisted()` mocks, so module hoisting keeps
  working. Match the shape.
- `e2e/**` is excluded from `npm run test`, and Playwright's `testIgnore` is
  `['**/__tests__/**', '**/*.unit.spec.ts', '**/*.unit.test.ts']` — three
  patterns, not two. A Playwright spec in jsdom, or an e2e helper test in a
  browser, fails in a way that looks like a product bug.
- **`toBeVisible()` does not test clipping, and jsdom cannot test layout at all.**
  The left rail is `overflow-y-auto`, which makes CSS compute `overflow-x: auto`
  too, so the rail clips on BOTH axes and paints nothing of what a child positions
  outside its own 56px. A flyout or tooltip laid out there stayed in the DOM, with
  a non-empty box, at the right coordinates, and was invisible — and every
  assertion available at the time passed: `toBeVisible()` only checks for a box and
  a `visibility` value, and `openToolFlyout` dispatches `pointerdown` straight at
  the element, which never goes through hit testing. Pin placement with
  `elementFromPoint` at the element's centre, from REAL `page.mouse` input, and
  pin the arithmetic separately in jsdom by stubbing `getBoundingClientRect` and
  `offsetWidth`/`offsetHeight`: `e2e/sidebar-flyout.spec.ts` and
  `AnchoredOverlay.test.tsx`. A popover that must escape a scroll container goes
  through `SidebarLeft/AnchoredOverlay.tsx`, which portals to `document.body` —
  `overflow: clip` still clips, so no value on the rail can fix it.
- **Scrollbar tests cannot assert a painted scrollbar.** A gutter or edge
  screenshot can pass forever; assert `scrollWidth <= clientWidth` and
  `scrollHeight <= clientHeight` on the outer wrappers instead. Write the
  overflowing-document control first. The full measurement lives in
  `e2e/no-document-overflow.spec.ts` and its `P2` handoff entry.
- **Left-rail geometry is a measured constant.** The canonical values live only in
  the header of `e2e/no-document-overflow.spec.ts`; they are font-metric dependent
  and not asserted, so do not copy them into another document. The rail is a scroll
  container with `scrollbar-none`, pinned on both halves. **`min-h-0` on the rail
  is redundant** with `overflow-y-auto` — a scroll container's automatic minimum
  size is zero, and deleting the class leaves every viewport case green (measured,
  not argued) — and it is kept as the explicit form of an otherwise implicit
  contract.
- **`scripts/__tests__/*.test.mjs` runs under the root jsdom project and must stay
  environment-agnostic.** The swarm board is a Node script whose only dependency
  is the built-in `node:sqlite`, and it is tested there deliberately: a test file
  for a Node script in a second Vitest project would be a second project to keep
  in step. `node:sqlite` does work under `pool: 'vmThreads'`, and
  `scripts/__tests__/agent-board.test.mjs` opens a `DatabaseSync(':memory:')`,
  writes and reads a row. That is a **behavioural** probe, not a config assertion:
  it never reads `vitest.config.ts`, so it fails when a pool or environment change
  takes the binding away, and passes silently through one that keeps it. Scope the
  claim to the binding, not to the pool.

## Gates

### Local

Two of the four hooks wrap a `package.json` script — `pre-commit` ends at
`npm run gate:commit`, and `pre-push` at `npm run gate:push`. The other two run
`scripts/*.mjs` directly — `pre-merge-commit` at `merge-takeover-guard.mjs`, `post-merge` at
`merge-release.mjs` — and [`AGENTS.md`](../AGENTS.md) under **Worktrees and dev servers** is
where the takeover guard is documented.

The default headless e2e run must have **zero failures**; known failures are not
allowed. Produce counts from the suite rather than storing them here. If a dead
Vite server causes a wall of `ERR_CONNECTION_REFUSED`, rerun on a fresh
`PLAYWRIGHT_PORT` before treating the output as test failures.
Hooks use a shared common-git entry rather than a per-worktree husky directory;
`HUSKY=0` disables the hooks and bypasses these gates; do not use it to get around
a failing check.

- `.husky/pre-commit` runs `npm run gate:commit`; `.husky/pre-push` runs
  `npm run gate:push`. Keep the gate line last in each of those two; `pre-commit`'s
  first two steps are guards.

- The commit and push gates buffer successful subprocess output. Lint, typecheck, build,
  and unit-test output is replayed on failure, so a successful hook stays silent without
  hiding diagnostics from a failed check.

- `test:e2e:unit` is a Node Vitest suite for e2e helpers, not a browser run or
  commit-gate step. It is the blocking `e2e-unit` CI job; run it when touching
  `e2e/`.
- **The commit gate runs no app unit test, and that is deliberate.** `npm run test` is the whole-tree check: run it on demand, and `gate:push` runs it for you. The scoped fan-out that used to sit in the gate is a command now — see below. Accepted cost: a test that was already failing before the commit started is caught at push, in CI, or when someone runs `npm run test` — and this repo's worktrees are full of commits that needed exactly that catch.
- `*.{ts,tsx}` uses ESLint + Prettier;
  `*.{js,jsx,mjs,cjs,scss,css,jsonc,yml,yaml,md,json}` uses Prettier only. **Do
  not add ESLint for the latter group**: no config covers it, and doing so breaks
  Markdown/SCSS commits. `scripts/*.js` is in that second group.
- **`lint:check` lints `git ls-files`, not `.`.** `scripts/lint-tracked.js` is the
  only place the two extension lists live, and they are the same rule on both
  sides: `lint:check` covers every tracked file of those types, `.husky/pre-commit`
  covers the staged subset. A filesystem-scoped command took `.kilo/`'s worktrees,
  `dist/`, and generated e2e output as input, and needed a hand-maintained
  `.prettierignore` to stop `npm run format` rewriting them — that file is gone
  because nothing it listed is tracked. The tracked images,
  `src/components/SidebarLeft/snippet.txt` (the only tracked `.txt`) and
  `index.html` are **not** linted, deliberately. **"The dotfiles are not linted" is
  not quite true and should not be repeated:** it means dotfiles with no linted
  extension — `.gitattributes`, `.gitignore`, `.nvmrc`, `.prettierrc` — while
  tracked Markdown dotfiles are linted because they match `*.md`. The globs in
  the script are where that decision is written down.
  **Legacy files being outside the linted set is not a problem to solve.**
- `--fail-on-changes --no-stash` leaves formatter fixes unstaged and blocks the
  commit; never allow hooks to rewrite the index. `--no-stash` is not optional:
  without it lint-staged keeps its backup stash every time it declines to revert,
  so each blocked commit leaves a `WIP on <branch>` entry behind.
- `build` is not redundant with `tsc`: `vite build` strips types without checking
  them, and it alone catches Sass, wasm, PostCSS, and import resolution. **No
  `lint:check` in any local gate**: locally, `lint-staged` covers the staged
  subset and nothing more, so a file already committed unformatted, a
  rule-changing branch switch, or a bad rebase surface in `ci` rather than at
  commit time.
- No coverage and no Playwright, at any local gate.

### `test:staged` is a command, not a gate

`npm run test:staged` runs the tests that transitively import the staged paths. It
is **deliberately not in the commit gate**; `npm run test` is the whole-tree check.

It was in the gate and was taken out, because its cost is a function of a file's
fan-in across the test suite rather than of the change. Measured, the selection
was about 5% of the suite for a hook, a util or a component; 44% for
`src/contexts/StoreContext.tsx`; 64% for `src/util/draw.ts`; and 100% for
`src/test/setup.ts` or `vitest.config.ts`, at which point it costs about as much
as the full suite and can cost more, because the module-graph build is a second
whole-tree pass. Proportions are the stable fact and absolute counts go stale
every time a test file lands, which is why only those are recorded here.

It is worth knowing for what it is good: cost tracks blast radius, and so does
risk, so the expensive case is the one that genuinely needs the widest net. What
it cannot do is see a test that was **already** failing before the commit started,
which is exactly the state this repository's history is full of, and what it
cannot do is find a coverage gap. Two limits to hold in mind when you run it: a
staged path that no test imports selects 0 files and exits 0 (usually correct —
nothing covers it, so nothing can fail), and the pipeline must stay NUL-safe,
`git diff --cached --name-only --diff-filter=ACMR -z | xargs -0`, because an
unquoted `$(...)` word-splits and globs into a silent pass.

### CI

- `ci`: lint, high-severity audit, typecheck, TS-project coverage assertion,
  coverage tests, build.
- `e2e-unit`: e2e helper tests and coverage.
- `e2e`: headless Playwright. CI retries each failed test up to twice (three total
  attempts); local runs use zero retries. `failOnFlakyTests` makes a test that passes
  only after a retry fail the job, so investigate it as a defect rather than treating
  it as a pass.
- **Dependency licences are not checked by CI.** `npm audit --audit-level=high`
  checks vulnerability advisories, not licence terms. The README records this
  limitation and the expectation to review dependency licences.

**DO NOT WEAKEN A GATE TO GET GREEN: no skips, raised thresholds, deleted
assertions, or re-recorded baselines.** Fix the defect or leave the recording
decision to the operator.

## E2E failures

- Read `e2e/OPEN_PROBLEMS.md` first. A new failure is a new defect.
- A pin/`expected-fail` is a tripwire for broken behavior; remove it in the same
  change that fixes the defect.
- Visual baselines re-record only with `npm run test:e2e:update-baselines`; `=all`
  is load-bearing because bare `--update-snapshots` resolves to inert `changed`.
  Green means pixels matched.
- The 100-pixel budget in `visual-regression.spec.ts` is a tripwire, not a
  tolerance. Do not widen `threshold` or `maxDiffPixels` to make a red go green —
  the argument for the numbers and for NOT pinning a Chrome version in CI is
  written out at that call site.
- `npm run test:e2e:clean` deletes the per-test output directories under
  `test-results/` and `playwright-report/`, and keeps `test-results/results.json`,
  so a run's machine-readable result survives it. A run through the wrapper writes
  under `test-results/runs/<run-id>/` and prints that path before the suite starts.
- **The default headless run has zero failures, and three tests are `test.skip` by
  declaration.** The Photopea round-trip needs an external service; the single-tool
  right-click case is recorded under "Known-skip tests" in
  `e2e/OPEN_PROBLEMS.md`; and `e2e/viewport-drawing.spec.ts` is skipped by the
  operator's decision of 2026-09-29 because of intermittent capture drift. Its
  frequency is unknown: `TEST-FLAKES.md` §12 explicitly says the observations have
  not been reconciled into a rate. The skip is a gate decision, not a fix or waiver;
  do not loosen the assertion or add retries.
- Read failures from `test-results/`. Do not open `trace.zip` in a trace viewer,
  because that opens a browser window; ask the operator to inspect it if needed.
