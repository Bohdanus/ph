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
  runs first in `.husky/pre-commit`. It is the floor under the rule, not the rule — it runs
  _after_ the edit, so the process above is what stops the write.
- **Every commit message carries the chat id, and so does every merge to `main`, which
  also names the branch it came from.** Two trailers, subject untouched, and no gate
  enforces either — resolve the id before the first commit:

  ```
  Add commit metadata rules to AGENTS.md

  Chat: ses_<chat id>
  Branch: docs/commit-attribution
  ```

  `Chat:` on every commit; `Branch:` on the merge into `main`. The id is also a board
  identity: `--agent ses_…` on `npm run swarm --` claims and locks as this chat
  ([`docs/ORCHESTRATION.md#the-swarm-board`](docs/ORCHESTRATION.md)).

  **There is no `kilo` CLI here.** The id is in the session store, keyed by a phrase you
  typed — `parent_id IS NULL` keeps subagents out, and match it WORD BY WORD with `%`:
  `instr` is literal, so a phrase you typed across a line break matches nothing and the
  query returns no row.

  ```bash
  sqlite3 -readonly ~/.local/share/kilo/kilo.db "SELECT s.id FROM session s
    JOIN message m ON m.session_id=s.id JOIN part p ON p.message_id=m.id
    WHERE s.parent_id IS NULL AND json_extract(p.data,'\$.type')='text'
      AND lower(json_extract(p.data,'\$.text')) LIKE '%a%phrase%you%typed%'
    ORDER BY s.time_updated DESC LIMIT 1;"
  ```

## Subagents INSTRUCTION

LAUNCH AS MANY SUBAGENTS AS THE TASK NEEDS. COMPUTE COSTS ZERO; QUALITY IS THE POINT.

Delegate **first**, not after you get stuck. Fan-out signals: every caller of X, per-file audits, "does this test still pin the old behaviour", one sweep per subsystem.

### Model policy

ALL GPT MODELS ARE PAID. EVERY OTHER MODEL IS FREE

1. A FREE SESSION MUST NEVER LAUNCH A GPT SUBAGENT. NO EXCEPTION
2. A GPT SESSION MAY LAUNCH GPT SUBAGENTS
3. ALWAYS PASS `provider` TOGETHER WITH `model`. "OpenAI" is CORRECT provider for GPT models, "kilo", is CORRECT provider for SpaceBunny.
4. `model: 'Space Bunny Alpha (retires Oct 5)', provider: 'kilo', variant: 'max'` — free, nearly as good as GPT Luna, the DEFAULT (the dated spelling is the one that resolves on this gateway).
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

- **NEVER MORE THAN 15 SUBAGENTS RUNNING AT ONCE, IN ANY COMBINATION** — `task` subagents plus Agent Manager sessions plus background processes you have running, and **this project fans out in waves of three**. Fan-out is good; a fan-out that saturates the host is not, and 16 is past that point on this machine. Queue the remainder and launch as results land, or split the concern further. The cap is on **simultaneously running**, not on total: a hundred subagents in waves of fifteen is fine.
- **A `task` subagent INHERITS YOUR WORKING DIRECTORY.** NEVER WORK on `main` worktree, unless allowed by operator. Create the worktree BEFORE the first fan-out, and put its absolute path in every brief: a subagent's cwd only affects relative `bash`, so the brief is what moves the work.
- **NEVER TWO SUBAGENTS ON THE SAME FILE.** Split by concern, not by convenience.
- **Self-contained briefs.** A subagent has a fresh context: give it the goal, your constraints, whether it may edit code, and exactly what its final message must contain. "Return file:line for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not verified. Have subagents report candidate results _and_ how they got them, then check the load-bearing ones yourself.
- **`subagent_type: 'explore'` CANNOT RUN ANY COMMAND.** Use `general` for any research that has to execute something; use `explore` only for reading and searching.
- **Keep judgement calls.** Architecture, scope, whether a deviation is acceptable: a subagent cannot weigh this file against the operator's intent. "Looks good to me" is not authorization.
- **Background for long work** (`background: true`), and wait for every result you depended on. NEVER answer while one is still running.
- **A long finding is a POINTER, not a shorter post.** `board_post` caps the FORMATTED message at **4096 bytes**; a rejection ends the STEP, not the turn. File the finding where a peer reads it uncapped — `npm run swarm -- new "<title>" --body "$(cat /abs/path/finding.md)"`, then post the issue id. `docs/ORCHESTRATION.md` has the measurements and the rest of the swarm text rules.

## NEVER OPEN A BROWSER WINDOW

The e2e suite is headless by default and must stay that way. The banned list, and why each
row is banned, is [`docs/TESTING.md`](docs/TESTING.md#never-open-a-browser-window) — **read
it before typing any `playwright` subcommand.** `kilo.jsonc` denies most of them at the
permission layer and `e2e/global-setup.ts` refuses the rest, so the rule survives a model
that has forgotten it. The one escape, `npm run test:e2e:headed`, is the operator's.
**DO NOT "FIX" A FAILURE BY FLIPPING THE MODE** — a headed run fails a disjoint set of
tests, on a documented and reproducible set.

### Looking at a live page is allowed, and does not need a window

ALWAYS use headless browser. `npm run probe:console` loads a page
headlessly and reports every console error, page error and failed request, deduplicated with
counts. `--url`, `--viewport`, `--dsf`, `--allow` and `--out` are its only options;
`headless` is hardcoded in the script and is not read from the environment.

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
- **`npm run tsc` IS THE ONLY TRUSTWORTHY TYPECHECK. NEVER GATE ON `npx tsc --noEmit`.** `tsc -b` covers `tsconfig.app/node/e2e.json`, so it also checks the Playwright specs and the test files. `tsconfig.json` at the root is a solution stub — `"files": []` plus references — so `--noEmit` resolves ZERO input files and exits 0 whatever is broken. Gating on it produces a green tree nothing can catch. The pool, the ports, and the per-command traps are [`docs/TESTING.md`](docs/TESTING.md#running-commands).

## Worktrees and dev servers

**A merge may not silently delete the other side's work.** `scripts/merge-takeover-guard.mjs`
runs from `pre-commit` (a conflicted merge being committed) and `pre-merge-commit` (a clean
merge that commits itself), and **refuses** the merge. It catches the shape `tsc` and `build`
cannot: a path the merge resolved by copying one whole side's content, which is a perfectly
good file and compiles. Three limits, all of them real: a **fast-forward fires no hook at
all**; `--no-verify` bypasses it, as it bypasses every gate here; and **it only sees a merge
that is being committed** — a merge or rebase left open on a conflict runs nothing, and no
hook or script reports an operation in progress. [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md)
— §Landing is the one home, with the incident that proves the third limit.

The four traps that follow from having a second checkout of the same repository:

- **`node_modules` is missing in most worktrees.** Node walks up to the parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what makes it misleading. Vite does **not** walk up, so fonts, images and AVIF assets from the ancestor checkout 404 in a worktree and work in the root checkout. Run `npm ci` there before debugging an asset that will not load.
- **A run starts its own dev server, on a port of its own.** Never set `PLAYWRIGHT_REUSE_EXISTING_SERVER`, and never run bare `npx playwright test`: both collide with whatever holds the default port. Use `npm run test:e2e`.
- **The main worktree is not stable while you work.** Other sessions commit into it concurrently. Re-read `git status` / `git diff` before staging, and stage only your own paths.
- **Never remove a worktree by hand.** `npm run dispose -- <name>` is the only path: it checks the inventory's `action`, the board's claims and locks, and the session database, then anchors the branch before it deletes. A refusal names the signal that produced it — an in-flight task is `in-use`, and only the operator may stop a writing chat.

## Test traps

- App-test traps — the single setup file, the `useHistory` mock shape, what each runner
  ignores — are [`docs/TESTING.md`](docs/TESTING.md#test-traps). Read them before adding a
  test: a Playwright spec in jsdom, or an e2e helper test in a browser, fails in a way that
  looks like a product bug.
- **A spec imports `test` from `./fixtures/extended-test`, never from `@playwright/test`.** That module adds two `auto` fixtures: `consolePolice`, which fails a test on any unaccepted console error or page error, and `pinnedTheme`, which seeds `localStorage.theme` so the pixel oracles keep the light backdrop they are calibrated for. `auto` is the load-bearing part — it is opt-out, not opt-in. `consolePolice` is not suppressible per test: a legitimately-expected message becomes an `ACCEPTED_CONSOLE_ERRORS` entry in `e2e/helpers/console-police.ts` carrying the reason. Adding a rule, a skip or a threshold to make that check pass is the same move as raising a gate threshold, and it is not done here.
- Spreading a hook's whole return onto a DOM element is how nine invalid props reached a `<div>` in this app for months. `useRect` now returns `pointerHandlers` / `rectHandles` / `pointerState` so that mistake is a type error.

## Gates

### Local

Four husky hooks, and only two of them wrap a `package.json` script. The other two — `pre-merge-commit` (the takeover guard) and `post-merge` (`scripts/merge-release.mjs`, which releases the board's claims and locks and exits 0, so it cannot block a merge) — run `scripts/*.mjs` directly and are covered in **Worktrees and dev servers** above. They are dispatched from `<common-dir>/.git/hooks-gate/`, not from `.husky/_`, because the latter exists only where `npm install` ran; that dispatcher honours `HUSKY=0` as a full escape. The gated sequence is a command anyone can run by hand:

| Command               | Runs from           | Contents                                                       |
| --------------------- | ------------------- | -------------------------------------------------------------- |
| `npm run gate:commit` | `.husky/pre-commit` | `lint-staged --fail-on-changes --no-stash`, then `gate:verify` |
| `npm run gate:verify` | —                   | `tsc` -> `build`                                               |
| `npm run test:staged` | **NOWHERE**         | `vitest related` over the staged paths — a command, not a gate |
| `npm run gate:push`   | `.husky/pre-push`   | `test` — the full app suite, and nothing else                  |

**ONE gate runs on commit, and it runs no app test.** `gate:verify` asks only "does the tree still build and typecheck" — and it PASSES a flipped numeric threshold, a renamed branch or a dropped case, the same class of change that has repeatedly needed its own worktree. `test:staged` would ask the second question — "did this commit break a test covering the files in it", and only that — but **no hook invokes it**: `.husky/pre-commit` ends at `npm run gate:commit`, and the full suite is the push gate. Run it by hand when you want the scoped answer. [`docs/TESTING.md`](docs/TESTING.md#teststaged-is-a-command-not-a-gate) is the one home for why it was taken out and what it costs.

- Nothing local runs `lint:check`, and nothing local re-runs `gate:commit` on push: whole-repo `eslint` / `prettier --check` and a rebase that broke the build are `ci`'s job, about a minute later. lint-staged covers the staged files.
- Measured, for judging a future change to this table: `build` 1.7s, `test:e2e:unit` 1.1s, `tsc -b` 5s, `gate:commit` end to end ~9s, `test:staged` 2.8s by hand, `test` 7-14s.

### CI (Node 24 from `.nvmrc`, which is also what `engines` requires)

**One workflow, three gating jobs.** `.github/workflows/ci.yml` is the only workflow file, and all three jobs run on every push and PR to `main` plus `workflow_dispatch`. None of them declares `needs:`, so they are three independent gates and a red one does not skip the others. `ci` — `lint:check` -> `npm audit --audit-level=high` -> `tsc` -> an assertion that every tracked `.ts`/`.tsx` is inside some project's `include` -> `test --coverage` -> `build`. `lint:check` is its FIRST step, so an unformatted committed file fails the job before `tsc`, the suite and the build ever run. `e2e-unit` and `e2e` are separate jobs rather than steps, so a break in the app pipeline cannot skip either. What CI still does NOT gate — dependency licences — is written down in `DEPENDENCIES.md` and nothing enforces it.

**DO NOT WEAKEN A GATE TO GET GREEN: no skips, no raised thresholds, no deleted assertions, no re-recorded visual baselines.** Each is either a real defect with a named fix, or a recording decision that belongs to the operator.

## Known failures and how to read one

On the default headless run **no e2e test fails**. The only skips are 3 declarations (`e2e/sidebar-flyout.spec.ts` right-click on single-tool groups, `e2e/viewport-drawing.spec.ts` line-under-cursor after resize, `e2e/export/photopea.spec.ts` the Photopea round trip).

- The remaining `e2e/OPEN_PROBLEMS.md` entries are **latent** defects no current run trips. Read it before investigating a failure; a new failure is a new defect, not a known one.
- A **pin** is a unit test that asserts the current broken behaviour on purpose. It is a tripwire that FAILS the moment the defect is fixed, so a fix MUST remove the pin in the same change. The same rule governs the app's `it.fails(...)` tests: an expected failure is a declaration about current behaviour, not a skipped requirement.
- **DO NOT widen a threshold, add a skip, or re-record a visual baseline to make a test green.** Baselines re-record only under an explicit `--update-snapshots=all`, so a green run means the pixels matched.
- Read a failure from disk, never from a viewer: `screenshot: 'only-on-failure'` puts a PNG in the failing test's `outputDir` under `test-results/`, and a run through the wrapper writes its machine-readable record under `test-results/runs/<run-id>/` and prints that path. A trace needs the trace viewer, which is a window — ask the operator.

## Documentation

`docs/README.md` is the index — every tracked document, the one job it has, and which one wins. `docs/DOCUMENTATION.md` is the rule. Read it before adding a document or treating one as correct.

**The ladder: operator -> Adobe -> this repository -> judgement. Stop at the first that speaks.**

- **Anything about what Photoshop does** — an option, a modifier, a default, a menu, a shortcut — **Adobe's documentation is the source of truth.** Where this repo disagrees with Adobe, Adobe is right and this repo is wrong. Re-derive from Adobe, not from a document here.
- **Anything about this code** — reviewing, refactoring, improving — **the in-app documents are the source of truth.** The code is the last word on what it currently does; the docs are the word on what it must do. Where they disagree that is a finding, not a licence to reconcile it whichever way is cheaper.
- **If something cannot be done in a browser, say so in the docs**

**One fact, one home.** Link, do not restate. A duplicate is a defect — report it. Never edit `docs/TOOLS.md`: it is generated by `npm run docs:tools` and a test fails on drift.

## NO LINE NUMBERS IN PROSE — EVER

**Cite the unit. There is always a name available:** the declared identifier in call form, the
string literal the program dispatches on, the `it('...')` title for a test, the file alone —
or, for a document, its heading, its quoted words, or a `§N` anchor. **A range names ONE
enclosing unit, never two endpoints:** a claim too vague to name a unit has not been located
yet, and that is what a line number was hiding. The banned form, written with a `‹line›`
placeholder rather than a real number so this section obeys the rule it states:

```
history-adapter.ts:1234              ->  history-adapter.ts — `durableLayerForSource()`
materialization.ts:12-40            ->  materialization.ts — `materializeDocument()`
StoreContext.tsx:900                 ->  StoreContext.tsx — `PUBLISH_RUNTIME_PRESENTATION`
history-utils.test.ts:77             ->  the `it('keeps an unknown layer source kind…')` title
HANDOFF.md:410-418                   ->  HANDOFF.md — "the tombstone the lifecycle rule forbids"
```

**The ONE exemption is quotation, in a fenced code block** — the example above, and any
finding whose subject IS a drifted citation. Fences are stripped before the check reads, so
the prose on either side of one is still checked.

**This is enforced, not advised, and the scope is uneven.** `scripts/__tests__/agents-citations.test.mjs`
reads every tracked markdown document for the retired-symbol leg, but the `file.ext:‹line›`
ban is gated against `AGENTS.md`, `docs/DOCUMENTATION.md` and `docs/README.md` only, and the
call-form and `§N` legs read `AGENTS.md` alone. Do not relax it — not by skipping a document,
not by an exemption entry, not by a threshold. The format, and why a name is checkable while a
number is not, is [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md#citations).

## Handoff documents

`HANDOFF.md`, `.kilo/plans/` and `e2e/OPEN_PROBLEMS.md` are strictly problem-focused and todo-oriented: **NO changelog, NO "work completed", NO status summaries.** Each entry is a validated issue with a problem statement, the affected files, and an actionable fix. Verify every claim against the working tree first, and cite the unit rather than the line: a stale line number sends the next session after a bug that does not exist. The lifecycle rule is in `docs/DOCUMENTATION.md`; it is one line: **fixed and verified deletes the entry.**

## Architecture status

The legacy `HistoryItem[]` path is the **PRODUCTION REPLAY AUTHORITY**. The durable document
is mounted as a **navigation presentation cache only** — it is subordinate to the legacy
replay, and render, export and logical replay stay legacy-authoritative. Treat that as the
state to read, not a fact to assume: re-read the code, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
— §"The presentation cache" and §"The legacy timeline — the production authority", and
[`HANDOFF.md`](HANDOFF.md) §1, before designing across the legacy/durable boundary.
