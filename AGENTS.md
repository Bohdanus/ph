# AGENTS.md

Instructions for coding agents working in this repository. The product goal is a
powerful, Photoshop-inspired, production-grade photo editor.

## Use subagents as the default, not the fallback

**Launch as many subagents as the task warrants. There is no budget argument:
compute costs zero, while quality is essential.** A task that takes one context 40
sequential tool calls should be 8 subagents in parallel plus a 6-call synthesis.
Sequential tool calls are the defect, not the token count.

Delegate **first**, not after you get stuck. The moment a question fans out — every
caller of X, per-file audits, "does this test still pin the old behaviour", one
sweep per subsystem — it is parallel work, and doing it inline is the mistake.

### Model policy — the one rule that is not negotiable

1. **Never put a GPT model in a subagent unless there is genuinely no
   alternative.** They cost real money, by the token, on every call. "This one is
   hard" is not an alternative; that is the judgement you are delegating away.
2. **Cost roughly doubles past ~260k of context.** A context that grows to the
   cliff is twice as expensive as the same work spread over fresh ones. Keep the
   main turn lean, and push fan-out into subagents that each start at zero.
3. **Space Bunny Alpha is free and nearly as good as GPT Luna. Use it as much as
   possible** — on every subagent where it makes sense, which is nearly all of them.
4. **Other free models are useless.** Do not spend a turn sampling them.

```ts
task({
  subagent_type: 'explore', // or 'general'
  model: 'Space Bunny Alpha (new)',
  provider: 'kilo',
  variant: 'max',
  prompt: '...',
});
```

- Omitting those three fields inherits the current turn, which is already this model.
  Passing them explicitly is what keeps a subagent free when the main turn is not.
- Do not escalate to a paid model on your own for "hard" or "risky" work. Override
  only when the user named a model, and say so when you do.
- `agent_manager` (visible sessions, git worktrees) is a different tool: only when
  the user wants visible sessions or worktrees. `task` for everything else — it
  creates no sessions.

### Rules of delegation

- **Never two subagents on the same file.** Split by concern, not by convenience.
- **Self-contained briefs.** A subagent has a fresh context: give it the goal, your
  constraints, whether it may edit code, and exactly what its final message must
  contain. "Return file:line for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not
  verified. Have subagents report candidate results _and_ how they got them, then
  check the load-bearing ones yourself.
- **Keep judgement calls.** Architecture, scope, whether a deviation is acceptable:
  a subagent cannot weigh this file against the operator's intent. "Looks good to
  me" is not authorization.
- **Background for long work** (`background: true`), and wait for every result you
  depended on. Never answer while one is still running.

## Never open a browser window

The e2e suite is headless by default and must stay that way. A headed browser puts
a live, clickable window on the operator's screen for the whole run; their clicks,
keystrokes, mouse movement and focus changes reach the page as real input,
indistinguishable from the suite's own `page.mouse` / `page.keyboard` calls, so the
run fails for reasons that are not in the code and look exactly like real races.

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

`kilo.jsonc` denies most of these at the permission layer and
`e2e/global-setup.ts` refuses the rest, so the rule survives a model that has
forgotten it. Do not "fix" a failure by flipping the mode; a headed run fails a
disjoint set of tests, on a documented and reproducible set. If something only
reproduces visually, that is the operator's call — ask them to run
`npm run test:e2e:headed` themselves.

## Commands

```bash
npm run test            # vitest, jsdom - app unit tests
npm run test:e2e:unit   # vitest, node - unit tests for the e2e helpers
npm run test:e2e        # playwright, HEADLESS - starts the dev server itself
npm run tsc             # tsc -b - AUTHORITATIVE typecheck
npm run lint:check      # eslint + prettier --check
npm run build           # production bundle, and a real CI step
```

- **Run from the repo root** (`ph`), via the shell tool's `workdir`. A parent
  directory silently resolves the wrong package and the wrong tsconfig.
- **`npm run tsc` is the only trustworthy typecheck.** `tsc -b` covers
  `tsconfig.app/node/e2e.json`, so it also checks the Playwright specs and the test
  files. `npx tsc --noEmit` resolves the app tsconfig alone, which excludes tests —
  it exits 0 while the tests do not compile. Never gate on it.
- `npm run test` is `pool: 'vmThreads'`, `maxWorkers: 4`: a timing-sensitive test
  that only fails in a full run is usually the pool, not the code.
- `npm run test:e2e` starts Vite on :5173 itself. Pass `--retries=1` for a trace;
  `trace: 'on-first-retry'` yields nothing at the local `retries: 0`.

## Worktrees and dev servers

One git worktree per task, all under `.kilo/worktrees/`. Three traps that cost real
debugging time:

- **`node_modules` is empty or missing in most worktrees.** Node walks up to the
  parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what
  makes it misleading. Vite does **not** walk up: it serves only what
  `server.fs.allow` permits, so fonts, images and AVIF assets from the ancestor
  checkout 404 in a worktree and work in the root checkout. Run `npm ci` there
  before debugging an asset that will not load.
- **Every worktree's dev server wants :5173.** Locally `reuseExistingServer` is on,
  so `test:e2e` can attach to a server another worktree started and then test
  _that_ checkout. Use `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` in a worktree. "My
  change did nothing" in e2e is this, not a cache.
- **The main worktree is not stable while you work.** Other sessions commit into it
  concurrently. Re-read `git status` / `git diff` before staging, and stage only
  your own paths.

## Test traps

- One setup file: **`src/test/setup.ts`** (jsdom, `OffscreenCanvas`,
  `createImageBitmap` polyfills). `src/__tests__/` holds `canvas-mock.ts` and
  shared `fixtures/`. Do not add a second setup file, or global mocks to a path
  expecting them to load.
- `useHistory` tests mock `useStore` directly, not via `renderHook` +
  `StoreProvider`: the provider pulls in the durable replay/materialization path,
  which does not survive the test environment.
- `ToolbarsRight` tests use hoisted `vi.hoisted()` mocks, so module hoisting keeps
  working. Match the shape.
- `e2e/**` is excluded from `npm run test`, and `**/__tests__/**` /
  `*.unit.test.ts` are excluded from Playwright. A Playwright spec in jsdom, or an
  e2e helper test in a browser, fails in a way that looks like a product bug.

## Gates

### Local gates

Two husky hooks, and both delegate to a script in `package.json` so the sequence a
developer is gated by is a command anyone can run by hand:

| Command               | Runs from           | Contents                                                       |
| --------------------- | ------------------- | -------------------------------------------------------------- |
| `npm run gate:commit` | `.husky/pre-commit` | `lint-staged --fail-on-changes --no-stash`, then `gate:verify` |
| `npm run gate:verify` | —                   | `tsc` -> `build` -> `test:e2e:unit`                            |
| `npm run test:staged` | `.husky/pre-commit` | `vitest related` over the staged paths, after `gate:commit`    |
| `npm run gate:push`   | `.husky/pre-push`   | `test` — the full app suite, and nothing else                  |

The commit hook is two gates, not one, because they answer different questions.
`gate:verify` asks "does the tree still build and typecheck". `test:staged` asks
"did this commit break a test that covers the files in it" — and only that. Both
`tsc` and `build` pass a change that flips a numeric threshold, renames a branch,
or drops a case, so without the second gate such a change commits cleanly and is
caught in CI, which is the same class of fix that has repeatedly needed its own
worktree ("Fix 12 failing useHistory tests", "Fix 3 failing replay-coordinator
tests", "Fix failing useApp.psd tests", "Fix failing useRect tests").

`test:staged` is a 2.8s scoped run where the full suite is 7-14s, and it is
unconditionally safe in Vitest 5: with no matching staged path it reports
`No test files found` and exits 0, and a staged path outside `src/` — a `.md`
file, an `e2e/**` helper, a binary asset — also exits 0 without running the whole
suite. It therefore needs no `--passWithNoTests` and no guard. What it does **not**
give you is completeness: a file with no test importing it passes it, which is why
the full suite still runs at push.

One input widens it by design: a **merge commit** is index-vs-`HEAD`, so
`git diff --cached` reports every file the merge brings in rather than what the
operator staged. 120 merged `src` paths measure 9.8s and 81 test files, so a large
merge makes the commit hook ~19s instead of ~12s. Slower, never a false pass. The
opposite holds too: the selection is derived from Vite's module graph, so a staged
file that many modules depend on legitimately widens it, and that set is not stable
across environments — a staged `package.json` selects all 180 test files in a warm
checkout and none at all in a freshly installed one. Do not rely on a staged
non-`src` file dragging in its dependents; the full suite at push is what covers
that case.

The staged list is read with `-z` and passed through `xargs -0` on purpose. An
unquoted `$(git diff --cached --name-only)` word-splits and glob-expands, and the
failure is silent rather than loud: a path that expands to nothing makes vitest
report `No test files found` and exit 0, so the gate appears to pass while testing
nothing. No tracked filename today contains a space or a glob metacharacter, so
the shell form works by accident of the current tree, and `src/components/[id]/`
style paths are a plausible next addition. Empty input is a true no-op: BSD
`xargs` does not invoke the command at all, so a docs-only commit costs 0.04s.

Measured costs, for judging a future change to this table: `build` 1.7s,
`test:e2e:unit` 1.1s, `test:staged` 2.8s, `tsc -b` 5s, `gate:commit` end to end
~9s, `test:staged` adding ~3s, `test` 7-14s. `build` is in the commit hook
because it is not redundant with `tsc`: `vite build` runs Babel and esbuild,
which strip types without checking them, so it catches Sass, wasm resolution,
PostCSS and import resolution that `tsc` cannot, and `tsc` catches types the
bundle never sees. `gate:verify`'s name predates its contents — it runs no lint
and no app test, which is why it is a distinct row above rather than the whole
gate.

`lint-staged` formats two groups. `*.{ts,tsx}` gets `eslint --fix` and
`prettier --write`; `*.{js,scss,jsonc,yml,yaml,md,json}` gets `prettier --write`
only, because no ESLint config covers those and adding it would break every commit
touching a `.md` or `.scss` file. The second group deliberately includes `.js`,
`.scss` and `.jsonc`: `prettier --check .` matches all of them, and anything it
matches but lint-staged does not is formatted by nobody at commit time and fails
in CI instead.

Nothing local runs `lint:check` any more. `gate:push` used to, and dropping it
means a whole-repo `eslint . --cache` and a whole-repo `prettier --check .` are
CI-only, so a file already committed unformatted, a branch switch that changes
lint rules, and a bad rebase are all caught by the `ci` job rather than locally.
lint-staged covers the staged files, which is what the `.scss` gap needed, so the
trade is a loss of whole-tree coverage and nothing else.

`--fail-on-changes` is the reason the commit hook is trustworthy. By default
lint-staged re-adds whatever `eslint --fix` and `prettier --write` changed, so the
commit ends up containing code that was never staged and never read. With the flag
the fix is left in the working tree, the index is not touched, and the commit is
blocked so the change can be read and staged deliberately. `--no-stash` is what
makes that clean: without it lint-staged keeps its backup stash when it declines to
revert, so a blocked commit leaves a `WIP on <branch>` entry behind. The two flags
together produce no index rewrite and no residue. The cost is one extra round trip
per commit that touched an unformatted file; `npm run format` removes it. One
residue does survive and is not in the working tree: lint-staged writes
`.git/lint-staged_unstaged.patch` when it declines to stage, and nothing removes
it, so it is a stale file in the gitdir after any blocked commit.

`gate:push` does not repeat `gate:commit`. It used to, on the reasoning that a push
can follow a `git commit --no-verify`, a rebase, or a cherry-pick — that reasoning
is sound for `tsc` and does not survive contact with the cost: it re-ran 9s of
deterministic checks to protect 7s of suite time, and `test:e2e:unit` ran twice per
push. A rebase that broke the build is caught by the `ci` job in about a minute.

### CI gates

CI (Node 24 from `.nvmrc`, which is also what `engines` requires) has four gating
jobs on every push and pull request to `main`, plus `workflow_dispatch`:

- `ci` — `lint:check` -> `npm audit --audit-level=high` -> `tsc` -> an assertion
  that every tracked `.ts`/`.tsx` is inside some project's `include` -> `test
--coverage` -> `build`. Uploads `coverage/`.
- `e2e-unit` — `test:e2e:unit` -> `test:e2e:unit:coverage`, uploading
  `coverage-e2e/`. Separate from `ci` so a break in the app pipeline cannot skip the
  only gate on `e2e/`.
- `e2e` — the Playwright specs. It used to be `continue-on-error`, justified by five
  failing specs that are now fixed; the job was reporting a state the suite no longer
  had, so it is a gate. What it does not rest on: the CDP capture assertions are mode-
  and host-independent by construction, so the disjoint per-mode failing sets that
  justified `continue-on-error` are empty by design, not by observation.
- `dependency-review` — pull requests only. Enforces
  `.github/dependency-review-config.yml`, which denies GPL-3.0-only and
  AGPL-3.0-only, fails on a high-severity advisory, and allowlists MIT, Apache-2.0,
  BSD-2/3-Clause, ISC, MPL-2.0, CC0-1.0, Unlicense, WTFPL, Zlib, CC-BY-4.0 and
  CC-BY-SA-4.0. That list was written when nothing read the file, so no dependency
  has ever been checked against it; tightening it is a policy call, not a cleanup.

Do not weaken a gate to get green: no skips, no raised thresholds, no deleted
assertions, no re-recorded visual baselines.

## Known failures and how to read one

On the default headless run **no e2e test fails**: 97 pass, 2 are skipped by
declaration. That is stable across repeated full runs. Three defect groups used to
fail here and have since been fixed in this repository — the CDP capture-size
assertions, the keyboard flyout race, and the `levels.spec.ts` canvas lookup. Their
pin survives in `e2e/OPEN_PROBLEMS.md` rather than being deleted, because each
explains a shape the suite must not drift back into. That pin is the whole of the
allowed residue: it lives only as long as the tripwire does, and the fix that
removes the tripwire removes the entry with it.

The remaining `e2e/OPEN_PROBLEMS.md` entries are **latent** defects that no current
run trips. Read it before investigating a failure; if a test does fail, the answer is
almost certainly in there, and a new failure is a new defect rather than a known one.

Pins still apply to both suites. Several entries are **pinned** by a unit test that
asserts the current broken behaviour on purpose — a pin is a tripwire that fails the
moment the defect is fixed, so a fix must remove the pin in the same change. The same
rule governs the app's `expected-fail` tests: an expected failure is a declaration
about current behaviour, not a skipped requirement.

Do not widen a threshold, add a skip, or re-record a visual baseline to make a test
green — each is either a real defect with a named fix or a recording decision that
belongs to the operator. The one thing to know about the baselines is that they are
now genuinely compared: `visual-regression.spec.ts` re-records only under an explicit
`--update-snapshots`, so a green run means the pixels matched.

Read a failure from disk, never from a viewer: `screenshot: 'only-on-failure'` puts
a PNG in the failing test's `outputDir` under `test-results/`, and the `list`
reporter on stdout is the pass/fail record (in CI it also writes
`test-results/results.json`). A `trace.zip` needs the trace viewer, which is a
window, so ask the operator.

## Handoff documents

`HANDOFF.md`, `.kilo/plans/` and `e2e/OPEN_PROBLEMS.md` are strictly
problem-focused and todo-oriented: no changelog, no "work completed", no status
summaries. Each entry is a validated issue with a problem statement, the
affected files, and an actionable fix. Verify every claim against the working
tree first — stale line numbers send the next session after a bug that does not
exist.

### Writing is the default, not a favour

**Leave a handoff doc, or edit the existing one, whenever you find a validated
issue, a strong recommendation, or a finding worth preserving.** The strongest
case by far is a confirmed defect: you investigated, it is real, and nobody else
knows. Not finding anything is the only reason to leave the doc alone — a
session that found a real problem and wrote nothing down still lost it. Do not
ask permission to write one.

**Handoff docs are maintained like source: they ship with the code.** The
handoff edit belongs in the same commit as the work that produced the finding.
A stale entry is not neutral — the next session spends a full investigation on a
bug that is already gone, and a missing entry loses the only record of a real
one.

### Lifecycle: entries die, they never get reworded

- **Fixed and verified deletes the entry.** When a fix lands and another
  subagent, a review, or a test confirms it, the issue MUST be removed from the
  handoff. The same change that fixes an issue removes it.
- **Never rewrite an open problem into a closed one.** Turning "issue X" into
  "issue X fixed in abc123" is not maintenance — it is a new entry wearing the
  old one's name. Delete it.
- **A trail of fixed issues is pollution.** Every retained "fixed" note is
  prose the next session reads instead of a problem it can act on, and it buries
  the problems still open. The residue a fix may leave is a tripwire in the test
  code, not a paragraph in the doc.
- **Unverified is not closed.** A fix that landed without a check leaves the
  entry alive: tighten it to say exactly what still needs verifying, and let
  that verification delete it.

## Architecture status

The legacy `HistoryItem[]` path is the production replay authority: it writes
history, replays through `history-replay.ts`, renders runtime `Layer` objects and
exports from the runtime canvas and layers. The durable document is still a shadow
projection, not the authority for rendering. Treat that as the state to read, not a
fact to assume — the history work is in flight. Re-read the code and the plans
before designing across the legacy/durable boundary, and do not start a
single-writer cutover while `saveLayerCanvas()` can still promote cached canvases
outside reducer publication.
