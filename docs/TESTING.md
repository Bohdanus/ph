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
npm run test            # vitest, jsdom - the app tests under src/ AND scripts/__tests/
npm run test:e2e:unit   # vitest, node - unit tests for the e2e helpers
npm run test:e2e        # playwright, HEADLESS - starts its OWN server on a port it picks
npm run tsc             # tsc -b - AUTHORITATIVE typecheck
npm run lint:check      # eslint + prettier --check
npm run build           # production bundle, and a real CI step
```

`npm run test` collects two trees: the app tests under `src/`, and the Node-script tests
under `scripts/__tests/` and `scripts/lib/citations/__tests__` — the latter run under the
root jsdom project on purpose, for the reason under **Test traps**. `e2e/**` is excluded
from it. The `--coverage` variant CI runs keeps that exclusion and drops `src/**`'s own
test and fixture files as well, and the e2e helpers get their own report from
`vitest.e2e.config.ts`.

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
`HUSKY=0 git commit` is the escape hatch.

- `.husky/pre-commit` runs `npm run gate:commit`; `.husky/pre-push` runs
  `npm run gate:push`. Keep the gate line last in each of those two; `pre-commit`'s
  first two steps are guards.

- **`scripts/__tests__/gates-wiring.test.mjs` asserts the wiring this section
  describes.** Every hook tracked in `.husky/` is in the `HOOKS` array of
  `scripts/install-git-hooks.js` and installed into `<common-git-dir>/hooks-gate/`, so a
  hook that reads as protection is one git will actually run; the `pre-push` hook runs a
  script `package.json` defines, carries `set -e`, and neither `|| true` nor `exit 0`;
  and the inventory suite it runs reaches nothing on this machine. **That last rule is an
  invariant over STATEMENTS, not a list of call spellings:** comments come out, whitespace
  is normalised, the source is split on `;`, and every statement mentioning `process.cwd()`
  must also mention `dbPath` or match `resolve(process.cwd(), '<path>')`. Both admitted
  shapes are asserted to still exist, so the rule cannot be satisfied by deleting every
  read, and the two retired reads `liveWorktreeFacts` and `liveInventory` are asserted
  absent. It says nothing about `process.env.HOME`, and a read off that would pass it. The
  second invariant, over the same comment-stripped source, is a TOKEN COUNT: the word
  `timeout` may appear exactly once in the inventory suite, and that once must be the
  file-level `vi.setConfig({ testTimeout:` — so no per-test budget returns in any syntax,
  whether a trailing argument, an options object or a computed key.
  **`.github/workflows/` is read as a DIRECTORY, not by the path `ci.yml`**, and the
  job, `continue-on-error` and script-existence checks run over every file in it: a second
  workflow carrying `continue-on-error: true` is a gate that opted out of gating, in a
  directory whose whole job is to notice that. `ci.yml` declares `ci`, `e2e-unit` and
  `e2e`, triggers on push and pull request to `main` plus `workflow_dispatch`, and keeps
  `permissions: contents: read` with `persist-credentials: false`. Script existence alone
  is not enough for the `ci` job, because `npm run test -- some-one-file` names a script
  that exists and runs something much smaller, so the steps named `Test`, `Build`,
  `Type-check` and `Lint` are each asserted to run `npm run test -- --coverage`,
  `npm run build`, `npm run tsc` and `npm run lint:check`. A change to any of that is a
  test failure rather than something only a reviewer would notice.

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
- **No local gate reads this machine's worktrees, and `inventory:verify` is the report
  that asks about them.** It is `scripts/worktree-inventory-live.mjs`, it is wired into no
  hook and into no CI job, and it is a REPORT: which worktrees exist right now is a fact
  about the machine, and a gate that answered it was once red because the main checkout
  held one modified file. `scripts/__tests__/worktree-inventory.test.mjs` builds a
  synthetic fleet and asserts the rules over it, **once per `describe` block**, in a
  `beforeAll`/`afterAll` pair through its `sharedFleet()` helper. The fleet is
  **TEN `git worktree list` entries**: the primary checkout the fixture's own `git init`
  creates, plus nine `git worktree add` calls — seven named shapes, one worktree named
  after the first `landed: true` key in the curated table so the "agrees with git about
  every `landed: true` claim" test has a member to check, and one registered outside the
  checkout, which is the only member that is not `inRepo`. One of the nine is registered
  and then has its directory removed, so it is filtered out before any fact is read and
  `git worktree list` is left reporting a registration whose path is gone. Not once per
  test: the first version rebuilt it per test, and the full-suite run then spent its time
  in git spawns, thirty-odd per test with four workers at a time, which was enough to push
  the slowest of them past the file's own 15s budget and turn three passing tests into
  three timeouts. One build per block is safe because the fleet is immutable — no test in
  those blocks writes to a worktree, and `buildInventory` and `classify` take plain records
  and return new ones — and the getter throws rather than handing back whatever the
  previous block left behind. So the rules are still asserted, non-vacuously, and the
  answer no longer depends on you. Run `npm run inventory:verify` before a sweep or a
  landing.

- **`inventory:verify` exits non-zero on a finding AND on a check that could not run.**
  The findings are four: a worktree that holds the only copy of some work and would be
  reported as disposable; a curated `mustNotPrune` flag on such a worktree, which is a
  claim the generator now derives for itself; a curated `landed: true` claim git
  contradicts; and a recorded session id that is not a real top-level session inside the
  committed audit's own window. The checks that could not run are three: a worktree
  holding work on no ref that could not be classified at all, because git named no tip or
  the head is detached and nothing below ever examined it; facts git could not be read for
  at all, which print as `UNREADABLE`; and the session audit itself, which on a machine
  with no session store is a fact about the machine and is reported as such rather than as
  a pass. A checkout with no resolvable base ref — or one too SHALLOW for ancestry to mean
  anything — stops the report before any of that: it prints one line beginning
  `UNREADABLE: ` and RETURNS, with no summary line at all, because every ahead/behind
  answer beneath it would be null. So the clean report means **every check ran and found
  nothing**, never "no check found anything": the output prints a
  `could not be classified:` count and a `NOT CLASSIFIED` section, and otherwise its last
  line is one of two forms. Zero prints
  `OK - no rule violated. 3 worktree(s) hold work on no ref and every one is protected; that is the tool working, not a clean bill of health for the machine.`
  — the sentence verbatim, with the run's own count where the `3` stands. Non-zero prints
  `FINDINGS - see above.`, or
  `INCOMPLETE - no finding, but the session audit could not run, so this is not a clean report.`
  when the audit is the check that could not run. Read the exit line; nothing runs it for
  you.

- **The generator resolves its base ref and refuses rather than guessing.**
  `scripts/worktree-inventory.mjs` no longer defaults `base` to the literal `'main'`. It
  calls `resolveBaseRef(root)` **before** `collectWorktrees(root, { base })` and refuses
  when the answer is `null`, so an unresolvable base can never reach the collector:
  `collectWorktrees` rejects `null` as well as `undefined`, which is the check that had
  been `=== undefined` and let a `null` through to write a null `ahead`/`behind` and an
  empty name-collision list for every worktree. `resolveBaseRef(root)` tries
  `refs/heads/main`, `origin/main` and `refs/remotes/origin/main` in that order and
  returns the first that resolves to a commit, and a checkout with none of them is
  refused by a thrown error naming all three rather than compared against a name that
  resolves to nothing — which is what an `actions/checkout` on a `pull_request` produces,
  and what a clone of any repository whose default branch has another name produces.
  `--base <ref>` still wins, and the refusal names the flag. **Two details the candidates
  list alone does not carry.** A SHALLOW repository answers `null` for every candidate,
  because `rev-parse --verify` passes on a `--depth 1` clone's `origin/main` and every
  answer built on it would be confidently wrong. And `rev-parse --verify` does **not**
  reject an ambiguous name: with a branch `main` and a lightweight tag `main` it exits 0,
  resolves the tag, and warns on stderr where nothing reads it — what keeps the answer
  right is the fully qualified first candidate, not the probe, and `^{commit}` is there
  only to reject a tree and a blob. Any note saying the probe is false for a missing ref
  **and** an ambiguous one is wrong about the second half.

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

- `ci`: `npm run lint:check`, `npm run tsc`, the assertion that every tracked
  TypeScript file is in a project, `npm run test -- --coverage`, `npm run build`, then
  `npm audit --audit-level=high` as the **last GATE** — not the last STEP: the app
  coverage upload after it is `always()`, so it runs whatever the audit does, and burying
  a registry-dependent gate behind an `if-no-files-found: error` upload would add a second
  way for it not to run. The audit is still a gate and still high severity; it is ordered
  after the code gates because `npm audit` asks a registry about advisories published
  since the lockfile was written, so ordered second a new transitive advisory anywhere in
  the tree could turn `main` red with no code change **and** abort every gate behind it.
- `e2e-unit`: e2e helper tests, then the coverage run.
- `e2e`: headless Playwright, and a blocking gate. No job or step in
  `.github/workflows/ci.yml` carries `continue-on-error`, which is what
  `scripts/__tests__/gates-wiring.test.mjs` asserts.
- **Dependency licences are not a gate.** The allow/deny list and the high-severity
  threshold are in `DEPENDENCIES.md`, enforced by nothing; `npm audit
--audit-level=high` in `ci` is the vulnerability half and it does run.

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
  declaration.** Two need an external service or a manual gesture; the third is
  `e2e/viewport-drawing.spec.ts`, skipped on the operator's decision of 2026-09-29
  because it is intermittently red — 1 run in 4, with the failing case moving
  between cases — and a suite that is randomly red trains agents to ignore the
  gate. **It is a gate decision, not a fix and not a waiver:** the defect is still
  open in `TEST-FLAKES.md` §12 with its exact remaining verification, and a skip is
  not permission to loosen the assertion, raise the bound or add retries.
- Read failures from `test-results/`; `trace.zip` needs a window, so ask the
  operator.
