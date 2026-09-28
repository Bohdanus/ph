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
5. **Double billing starts earlier on GPT Luna than on the other paid GPT models: past ~200k of context on Luna, past ~270k on GPT Sol and GPT Terra.** Keep the main turn lean; push fan-out into fresh contexts.
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
npm run board -- help   # the swarm board: who has what, and which files are taken

node scripts/worktree-inventory.mjs   # WORKTREES.json: what every worktree holds
```

## The swarm board

`npm run board -- <command>` is the LIVE coordination layer: who has claimed
what, which file two agents are about to edit, what one agent found that another
needs, and what nobody claimed because the worktree is gone. `npm run board --
help` is the full command list; `--json` works on every command except `watch`, `help` and `--version`.
`ready` is the queue an agent works from: it sorts by priority, and the FILES
column is the files the issue is _about_ (from its own create event) annotated
with who is currently in them. An imported issue holds none of them on purpose,
which is why it still shows its real files rather than nothing, and a filer's own
reservation is contention like any other and is shown as such.

**It is NOT the handoff documents.** `HANDOFF.md`, `TEST-FLAKES.md` and
`e2e/OPEN_PROBLEMS.md` stay the durable, reviewable record of what is known
about this codebase, written by hand and merged through a pull request. The
board answers the questions prose cannot: what is true _right now_, between
concurrent agents. `board import` copies the documents' items onto the board
once, keyed on their own numbering (`HANDOFF.md#12`), so re-running files only
what is new.

- **Where it lives:** `$(git rev-parse --git-common-dir)/agent-board/board.db`
  — the one path every worktree resolves to, so there is one board and no
  daemon, no server, and no per-worktree copy. `AGENT_BOARD_DIR` or `--dir`
  moves it; the tests use both. **It is machine-local and gitignored, exactly
  like `.kilo/`.** Nothing durable belongs only there.
- **You are your branch.** The default identity is the git branch, because one
  task is one worktree on one branch, and a branch is the same string across
  every command in that task. `--agent <id>` overrides it. The Kilo run id is
  recorded as metadata, not as identity: a subagent inherits it, so it cannot
  tell two agents apart. **Two limits worth knowing:** a branch that is RENAMED
  mid-task leaves the old claim under a name nothing can reach (`doctor` will
  not help — the worktree and its lease are both fine), and a detached HEAD is
  identified by commit, so advancing the commit splits one agent into two. If
  you are working outside a dedicated worktree — on `main`, or detached — pass
  `--agent` or set `AGENT_BOARD_AGENT`, or you and the next agent are the same
  agent as far as the board is concerned.
- **A claim is a lease, not a mutex.** `board claim ph-12` holds it for 45
  minutes; `board heartbeat ph-12` extends it. Past the lease the issue is
  offered again and the takeover is in the event log with both agents named.
  **`board status` reports; `board doctor` is the only command that releases an
  abandoned claim**, and it releases a claim whose worktree no longer exists even
  when the lease has not run out.
- **`board hold <path>` makes "never two agents on the same file" a refused
  write**, and the refusal names the holder. `board check <path>` exits 1 when
  somebody else holds it, so a shell can gate on it. `board claim --files a.ts
b.ts` takes both, and gives back **only the ones it took** if the claim is
  then refused — never a file that agent already held, and never with `--force`.
- **The fixer's claim is not its verification.** `board resolve` needs the live
  claim; `board close` refuses the agent that resolved the issue, exactly as
  this document's own handoff lifecycle requires. Exit code 5 is that refusal.
  **There is no `--verified-by`**, and that is the point: a flag naming somebody
  else is a name the caller supplies about an agent that is not in the room, and
  it made the whole rule one flag wide. A reviewer closes an issue by being the
  reviewer.
- **`board note` is how one agent addresses the swarm**; `board watch --follow`
  tails the same log. Every command appends to it, which is the replacement for
  N agents each writing their own account of the same work into a document
  nobody else can see until it is merged.
- **Exit codes are the interface:** 0 ok · 1 usage or error · 2 not found ·
  3 claimed or not claimable · 4 file held by another agent · 5 self-verification
  refused. An agent can branch on them; a human reading them learns why.

It is a command, not a gate. Nothing in `.husky/` calls it, and no commit may be
blocked on it.

### The board is cross-session, so a merge can announce itself

The database is global with **no session scoping at all** — `scripts/agent-board.mjs`
never mentions a session id, and identity is the git branch — so a `board note` from
one worktree is in the same log every other session's `board watch --follow` tails.
That is the whole reason the board can prevent a merge mess, and it is why these four
are not optional politeness:

- **Claim before the first edit**, not after: `board claim <id> --files <paths you will
touch>`, or `board hold <path>` for a path with no issue. `board check <paths>` before
  you edit anything a brief, a handoff, or a sibling subagent names. Both exit 1 on a
  path somebody else holds, and the refusal names the holder.
- **Claim the merge, not just the files.** A branch that is about to land carries a
  hazard to every path in it, and no file claim expresses that. `board note` the branch
  and the paths _before_ you start resolving, so an agent holding one of them learns it
  before it edits rather than after.
- **A delivered note is a log write, not a delivery.** There is no recipient column, no
  wake and no activity notice: `note` is broadcast, and `comment <id>` needs an issue
  somebody filed. Put the fact where a running agent will meet it anyway — a claimed
  path it must `check`, and a `board note` naming its own files.
- **An empty board is not evidence that nobody is working.** A file nobody claimed
  reads as free, so claiming is what makes a second reader of the path find out.

- **RUN FROM THE REPO ROOT** (`ph`), via the shell tool's `workdir`. A parent directory silently resolves the wrong package and the wrong tsconfig.
- **`npm run tsc` IS THE ONLY TRUSTWORTHY TYPECHECK. NEVER GATE ON `npx tsc --noEmit`.** `tsc -b` covers `tsconfig.app/node/e2e.json`, so it also checks the Playwright specs and the test files. `npx tsc --noEmit` resolves the app tsconfig alone, which excludes tests: it exits 0 while the tests do not compile.
- **The bare `npx tsc` type-checks ZERO files and always exits 0.** The root `tsconfig.json` is a solution stub — `"files": []`, no `include`, three `references` — so `npx tsc --showConfig -p tsconfig.json` prints `{"compilerOptions": {}}` and the references. It is indistinguishable from a pass, and `.claude/settings.local.json` in the operator's ROOT checkout carries a `"allow": ["Bash(npx tsc:*)"]` wildcard that auto-approves exactly that command. That file is untracked and globally gitignored (`~/.config/git/ignore` has `**/.claude/settings.local.json`), so no worktree, `git status` or `git ls-files` can see it — its absence from your worktree is not its absence from the machine. Only `npm run tsc` (`tsc -b`) type-checks anything.
- `npm run test` is `pool: 'vmThreads'`, `maxWorkers: 4` — a timing-sensitive test that only fails in a full run is usually the pool, not the code.
- `npm run test:e2e` starts Vite on :5173 itself. Pass `--retries=1` for a trace; `trace: 'on-first-retry'` yields nothing at the local `retries: 0`.

## Worktrees and dev servers

**HARD RULE: 99% OF WORK IS DONE IN ITS OWN WORKTREE UNDER `.kilo/worktrees/`, ON ITS OWN BRANCH. THE MAIN WORKTREE IS FOR READING AND MERGING ONLY.**

- One task is one worktree and one branch, lowercase prefix (`fix/…`, `feat/…`, `e2e/…`, `cleanup/…`, `audit/…`). A second worktree for the same task is a fork you reconcile by hand.
- **Already compliant if the session you are running in IS a worktree** — an Agent Manager worktree session, or any checkout under `.kilo/worktrees/`. `git rev-parse --show-toplevel` before you assume you are on main; never nest a second worktree inside one.
- The 1%: a read-only investigation, an operator-requested one-line doc fix, a hotfix the operator asked for on main. None of those is a feature.
- **Never commit feature work in the main worktree**, and stage only your own paths everywhere. Do not edit in main and move the change to a worktree afterwards: that leaves an unreviewed diff in a shared checkout and a worktree that does not build.
- **THE MAIN WORKTREE IS A LANDING, NOT A NEGOTIATION.** A branch is merged into
  `main` only after `main` has already been merged or rebased **into the branch, in
  the branch's own worktree**, and the gates re-run there. The merge into `main` is
  then a fast-forward or a mechanical two-parent commit with nothing to decide.
  Merging a stale branch straight into `main` inverts that order and puts the
  conflicts in a shared checkout where every other session is committing: measured on
  one branch here, `git merge audit/stashed-docs` from the main worktree produced 7
  unmerged paths, and unwinding it needed `git merge --abort` plus a forced
  `git reset --hard` in a checkout two other sessions were writing to.
- **Never resolve a conflict in the main worktree**, and never repair one there with
  `reset --hard`, `checkout --ours`/`--theirs`, `hash-object`, or `update-index`. The
  first two destroy another session's uncommitted work; the last two write an index
  entry no later `git status` reconciles, so the next agent reads a clean index over a
  clobbered file. If a merge conflicts in `main`, `git merge --abort` and redo it in the
  worktree — that is a one-command recovery while the merge is uncommitted, and an
  archaeology project afterwards.
- **`git stash` is global, not per-worktree.** It lives in the common git dir, so
  `git stash pop` in one worktree can pop another agent's stash. Prefer a worktree over
  a stash; if you must stash, `git stash push -m "<branch>: <what>"` and read the pop
  output before you rely on it.

Five traps that cost real debugging time:

- **A worktree used to run no commit gate at all, silently.** `core.hooksPath` was `.husky/_` — a directory husky generates during `npm install` and keeps untracked — and git resolves a relative `core.hooksPath` against the root of the worktree it is running in. Every worktree made by `git worktree add` had no `.husky/_`, so git found no hook, ran nothing, and exited 0. The commit landed with no warning and nothing in its output to notice. 89 of 118 worktrees were in that state while 96 had a populated `node_modules`, so "just run npm install" was never the fix. `core.hooksPath` now points at `<common git dir>/hooks-gate`, which every worktree shares, and the tracked `.husky/pre-commit` is what runs. **If a hook ever stops firing, run `git config core.hooksPath` first and assume nothing.** Re-install with `npm install` (the `prepare` script).
- **A worktree on an older commit blocks with a specific message, not a mystery one.** Its `.husky/pre-commit` still sources husky's generated preamble, which only an install in _that_ worktree ever created. The dispatcher names the cause; bring the worktree up to date, or `git config --unset core.hooksPath`. It blocks rather than skipping on purpose: a gate that cannot run must not let a commit through.
- **`node_modules` is empty or missing in most worktrees.** Node walks up to the parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what makes it misleading. Vite does **not** walk up: it serves only what `server.fs.allow` permits, so fonts, images and AVIF assets from the ancestor checkout 404 in a worktree and work in the root checkout. Run `npm ci` there before debugging an asset that will not load.
- **Every worktree's dev server wants :5173.** Locally `reuseExistingServer` is on, so `test:e2e` can attach to a server another worktree started and then test _that_ checkout. Use `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` in a worktree. "My change did nothing" in e2e is this, not a cache.
- **The main worktree is not stable while you work.** Other sessions commit into it concurrently. Re-read `git status` / `git diff` before staging, and stage only your own paths.

## WORKTREES.json: the inventory of every worktree

`WORKTREES.json` at the repository root is a generated inventory of every
worktree: its branch, how far it has drifted from `main`, whether that branch
is already landed, what the working tree holds that no commit does, which
Kilo sessions ran there, and which of those are unfinished, blocked or dead.
**It is regenerated, never hand-edited**, and it is the first thing to read
before deleting a worktree or starting one that may already exist.

```bash
node scripts/worktree-inventory.mjs            # regenerate
node scripts/worktree-inventory.mjs --check    # exit 1 if stale, write nothing
node scripts/worktree-inventory.mjs --quiet    # totals only
```

**Read `recommendation` and `prunable`, never `ahead`/`behind` on their own.**
`prunable: true` means ALL of these hold: it is not the main worktree, the
branch is an ancestor of `main`, the working tree is clean, and no curated
finding protects it. `recommendation` is the decision — `prune`, `salvage`,
`review-residue`, `in-use`, or `keep` (the main checkout, which is never a
deletion candidate) — and `statusReasons` is why, in the generator's own words,
so you can check the reasoning rather than trust it.

### "0 commits ahead of main" is NOT evidence that a worktree is disposable

This is the single most expensive mistake available in this repository, and it
has already happened. A branch created from `main` and never committed to
reports **0 ahead**, is **an ancestor of main**, and can be holding **hours of
uncommitted work that exists on no ref at all**. `git status --porcelain` being
non-empty is the only check that sees it.

So the generator gives that shape its own status, `uncommitted-only`, and never
calls it prunable. `uncommitted-only` deliberately does **not** distinguish "a
branch that landed and was then edited" from "a branch that never committed" —
git cannot tell them apart, both report 0 ahead and an ancestor, and inventing
a distinction git cannot support would be a false reassurance. The curated
`mustNotPrune` flag in `scripts/lib/worktree-inventory/curated.mjs` is where a
human records the claim git cannot.

### `unfinished` and `dead` are separate, and they need different responses

`chats.unfinished` holds sessions that have stopped with work outstanding:
`active`, `abandoned-midflight` (a stale session whose last turn ended on a
tool call rather than a completed stop), `blocked` (waiting on a human answer —
go answer it), `died-at-birth` and `rejected-credits`. `chats.dead` holds the
subset that will never produce anything: `died-at-birth`, `rejected-credits`
and `orphaned` (the worktree directory no longer exists).

**`rejected-credits` is a caller bug, not a session problem.** It means a
launcher resolved a bare model name onto a paid GPT id and the subagent died at
zero tokens with `APIError: Add credits to continue`. There is nothing to
salvage and no work to redo — the fix is in the code that made the call, and it
is the model policy at the top of this document. Count these before blaming a
branch for making no progress.

A session that is `active` is **never** reported as abandoned: recency is
checked before the shape of the last turn, because a live machine's most recent
turn always ends in a tool call, and treating that as stuck would cry wolf on
every running agent. A `blocked` session is a live machine **waiting on a
human** — go answer it.

`blocked` is detected indirectly, from the runtime's own report that a managed
session is waiting on a question. The signal is weak, so it is kept visible:
`blockedOn` carries the question id and the reason names the evidence, rather
than a flat `blocked` with nothing behind it.

### `session.directory` is where a chat was OPENED, not where it is working

**The only liveness signal that is not `session.directory` is the board's own
`agents` record, and it is there because of this.** A session started in the
main checkout and then driven into a task worktree keeps the main checkout as
its `directory` for its whole life: measured on this repository, an agent
working exclusively in `.kilo/worktrees/worktree-inventory` had **zero**
sessions attributed to that path, and its worktree read `prunable` while it was
being actively used. So `in-use` is set by **either** signal — a session
inside the 30-minute window, or a board agent seen in that worktree inside it —
and `board.agents` is on every record so you can see which one fired.

The consequence for reading the file: `chats` is a view of _chat history per
worktree path_, which is not the same as _work done in a worktree_. Treat a
zero `chats.count` as "no chat was ever opened there", never as "nobody worked
there".

### The file is generated; the judgement is not

Anything git or the session database can answer is read fresh on every run.
Anything a human had to look at and decide lives in
`scripts/lib/worktree-inventory/curated.mjs` and survives regeneration:

```js
'polygon-marching-ants': {
  summary: 'Polygon-selection marching ants: the ants component, the hook, …',
  issues: [{ ref: 'HANDOFF.md#48', title: 'eraser is hard-edged' }],
  mustNotPrune: true,   // blocks prunable even when git says it is clean
  landed: true,         // a CLAIM, asserted against git by a test
  note: 'the tip is an old main commit, so git reports 0 ahead; the work is on no ref',
},
```

**When you create a worktree, add its entry in the same change.** A new
worktree with no curated entry still appears, with `summary: null` and
`summarySource: "none"`, and a test reads the real `git worktree list` and fails
on it — an undocumented worktree cannot be created quietly. An uncurated entry
is a worktree nobody has written down what it is for, which is how a
preservation branch gets mistaken for a disposable one.

`mustNotPrune` is a tripwire, not a suggestion: it makes the generator refuse
to call a worktree prunable even when git reports it landed and clean, and it
exists for the case that has already cost real work here. A test requires every
`mustNotPrune` entry to carry a `note` saying what would be lost, because a
flag with no explanation is unfalsifiable.

`landed: true` is a curator's **claim**, printed next to git's answer as
`claimedLanded` against `mergedIntoMain`. A test re-derives it from
`git merge-base --is-ancestor` and fails when the two disagree: an earlier
version asserted `landed` for a worktree git reported as holding uncommitted
work, and nothing noticed.

**Never put a count in a summary.** "32 paths uncommitted" and "12 commits
behind" were both wrong within hours, in a file whose whole purpose is to be
trusted, and no test can catch a wrong number in prose. `dirty`, `untracked`,
`ahead`, `behind` and `commitsAheadTruncated` are already on every record —
describe WHAT a worktree holds and leave the arithmetic to the generator.

**Regenerate and commit `WORKTREES.json` in the same change that adds or
removes a worktree.** A stale inventory is worse than none: a reader cannot
tell which parts are true. `--check` exists for a script or a hook that wants
to fail on a stale file, and it names the per-worktree fields that drifted
(`status`, `recommendation`, `prunable`, `ahead`, `behind`, `dirty`, …) rather
than only reporting that something changed.

## Test traps

- One setup file: **`src/test/setup.ts`** (jsdom, `OffscreenCanvas`, `createImageBitmap` polyfills). `src/__tests__/` holds `canvas-mock.ts` and shared `fixtures/`. Do not add a second setup file, or global mocks to a path expecting them to load.
- `useHistory` tests mock `useStore` directly, not via `renderHook` + `StoreProvider`: the provider pulls in the durable replay/materialization path, which does not survive the test environment.
- `ToolbarsRight` tests use hoisted `vi.hoisted()` mocks, so module hoisting keeps working. Match the shape.
- `e2e/**` is excluded from `npm run test`, and `**/__tests__/**` / `*.unit.test.ts` are excluded from Playwright. A Playwright spec in jsdom, or an e2e helper test in a browser, fails in a way that looks like a product bug.
- **`toBeVisible()` does not test clipping, and jsdom cannot test layout at all.** The
  left rail is `overflow-y-auto`, which makes CSS compute `overflow-x: auto` too, so the
  rail clips on BOTH axes and paints nothing of what a child positions outside its own
  56px. A flyout or tooltip laid out there stayed in the DOM, with a non-empty box, at the
  right coordinates, and was invisible — and every assertion available at the time passed:
  `toBeVisible()` only checks for a box and a `visibility` value, and
  `openToolFlyout` dispatches `pointerdown` straight at the element, which never goes
  through hit testing. Pin placement with `elementFromPoint` at the element's centre, from
  REAL `page.mouse` input, and pin the arithmetic separately in jsdom by stubbing
  `getBoundingClientRect` and `offsetWidth`/`offsetHeight`:
  `e2e/sidebar-flyout.spec.ts` and `AnchoredOverlay.test.tsx`. A popover that must escape
  a scroll container goes through `SidebarLeft/AnchoredOverlay.tsx`, which portals to
  `document.body` — `overflow: clip` still clips, so no value on the rail can fix it.
- **`scripts/__tests__/*.test.mjs` runs under the root jsdom project and must stay
  environment-agnostic.** The swarm board is a Node script whose only dependency
  is the built-in `node:sqlite`, and it is tested there deliberately: a test file
  for a Node script in a second Vitest project would be a second project to keep
  in step. `node:sqlite` does work under `pool: 'vmThreads'`, and
  `scripts/__tests__/agent-board.test.mjs` asserts exactly that, so a pool change
  fails as a named test rather than as an unrelated import error.

## Gates

### Local

Two hooks, each a one-line wrapper over a `package.json` script, so the hook and the command a developer or CI can run by hand cannot drift:

On the default headless run **no e2e test fails**: 194 pass, 2 are skipped by
declaration (196 total). Measured on `feat/tool-descriptions` merged with `main` at
`f7757cf`, 2026-09-28. **The absolute count is not the point and it will go stale again —
the contract is that the number of failures is zero**, and a run that reports any is a
defect or an infrastructure failure, never a known-failing test. Note what a failure of
the second kind looks like: the Vite dev server dying mid-run turns every subsequent
spec into `ERR_CONNECTION_REFUSED` and reports a wall of red that is not one failure but
zero. Re-run on a fresh `PLAYWRIGHT_PORT` before believing a large red count.

Three defect groups used to fail here and have since been fixed in this repository —
the CDP capture-size assertions, the keyboard flyout race, and the `levels.spec.ts`
canvas lookup. Each explains a shape the suite must not drift back into, and that
shape is now held by a tripwire in the test code rather than by a paragraph in a doc:
the fix removed the entry and pinned the replacement contract in the same change.

| hook                | script        | runs                                                                              |
| ------------------- | ------------- | --------------------------------------------------------------------------------- |
| `.husky/pre-commit` | `gate:commit` | `lint-staged --fail-on-changes --no-stash`, then `gate:verify` (`tsc` -> `build`) |
| `.husky/pre-push`   | `gate:push`   | `npm run test` — the full app suite                                               |

Both are reached through a shared entry point in the common git dir, not through husky; see "Worktrees and dev servers". `HUSKY=0 git commit` is the escape hatch.

- **The commit gate and these docs carry NO wall-clock numbers.** Every cost figure written into a hook comment or a doc in this repo has gone stale, and one of them — "the app suite is likely minutes" — was never measured at all and was the stated reason for a design decision that then shipped. Measure before you design; do not leave a number behind.
- `test:e2e:unit` is **not** an e2e run — `vitest --config vitest.e2e.config.ts`, node environment, no browser — and it is **not in the commit gate**. It is the only coverage of the e2e helper functions, because `vitest.config.ts` excludes `e2e/**`, and that coverage is not optional: the `e2e-unit` CI job runs it as its own blocking step, and a separate blocking job so a break in the app pipeline cannot remove the only gate on `e2e/`. Run it by hand when you touch anything under `e2e/`, the way `test:e2e` is run when a change is user-visible. `test:e2e:unit:coverage` re-runs it under `--coverage` and is CI-only.
- **The commit gate runs no app unit test, and that is deliberate.** `npm run test` is the whole-tree check: run it on demand, and `gate:push` runs it for you. The scoped fan-out that used to sit in the gate is a command now — see below. Accepted cost: a test that was already failing before the commit started is caught at push, in CI, or when someone runs `npm run test` — and this repo's worktrees are full of commits that needed exactly that catch.
- `*.{ts,tsx}` uses ESLint + Prettier; `*.{js,jsx,mjs,cjs,scss,css,jsonc,yml,yaml,md,json}` uses Prettier only. **Do not add ESLint for the latter group**: no config covers it, and doing so breaks Markdown/SCSS commits. `scripts/*.js` is in that second group.
- **`lint:check` lints `git ls-files`, not `.`.** `scripts/lint-tracked.js` is the only place the two extension lists live, and they are the same rule on both sides: `lint:check` covers every tracked file of those types, `.husky/pre-commit` covers the staged subset. A filesystem-scoped command took `.kilo/`'s 121 worktrees, `dist/`, and generated e2e output as input, and needed a hand-maintained `.prettierignore` to stop `npm run format` rewriting them — that file is gone because nothing it listed is tracked. The tracked images, `src/components/SidebarLeft/snippet.txt`, `index.html` and the dotfiles are **not** linted, deliberately; the globs in the script are where that decision is written down. **Legacy files being outside the linted set is not a problem to solve.**
- `--fail-on-changes --no-stash` leaves formatter fixes unstaged and blocks the commit; never allow hooks to rewrite the index. `--no-stash` is not optional: without it lint-staged keeps its backup stash every time it declines to revert, so each blocked commit leaves a `WIP on <branch>` entry behind.
- `build` is not redundant with `tsc`: `vite build` strips types without checking them, and it alone catches Sass, wasm, PostCSS, and import resolution. **No `lint:check` in any local gate**: locally, `lint-staged` covers the staged subset and nothing more, so a file already committed unformatted, a rule-changing branch switch, or a bad rebase surface in `ci` rather than at commit time.
- No coverage and no Playwright, at any local gate.

### `test:staged` is a command, not a gate

`npm run test:staged` runs the tests that transitively import the staged paths. It is **deliberately not in the commit gate**, and `npm run test` is the whole-tree check: run it on demand, and `gate:push` runs it for you.

It was in the gate and was taken out, because its cost is a function of a file's fan-in across the test suite rather than of the change. Measured, the selection was about 5% of the suite for a hook, a util or a component; 44% for `src/contexts/StoreContext.tsx`; 64% for `src/util/draw.ts`; and 100% for `src/test/setup.ts` or `vitest.config.ts`, at which point it costs about as much as the full suite and can cost more, because the module-graph build is a second whole-tree pass. Proportions are the stable fact and absolute counts go stale every time a test file lands, which is why only those are recorded here.

It is worth knowing for what it is good: cost tracks blast radius, and so does risk, so the expensive case is the one that genuinely needs the widest net. What it cannot do is see a test that was **already** failing before the commit started, which is exactly the state this repository's history is full of, and what it cannot do is find a coverage gap. Two limits to hold in mind when you run it: a staged path that no test imports selects 0 files and exits 0 (usually correct — nothing covers it, so nothing can fail), and the pipeline must stay NUL-safe, `git diff --cached --name-only -z | xargs -0`, because an unquoted `$(...)` word-splits and globs into a silent pass.

### CI

- `ci`: lint, high-severity audit, typecheck, TS-project coverage assertion, coverage tests, build.
- `e2e-unit`: e2e helper tests and coverage.
- `e2e`: headless Playwright.
- **Dependency licences are not a gate.** The allow/deny list and the high-severity threshold are in `DEPENDENCIES.md`, enforced by nothing; `npm audit --audit-level=high` in `ci` is the vulnerability half and it does run.

**DO NOT WEAKEN A GATE TO GET GREEN: no skips, raised thresholds, deleted assertions, or re-recorded baselines.** Fix the defect or leave the recording decision to the operator.

## Definition of Done

**A TASK IS NOT DONE UNTIL THE WORK IS MERGED INTO `main` AFTER A THOROUGH CODE REVIEW. NOT "IMPLEMENTED", "COMMITTED", "PUSHED", "PR OPEN", OR "THE TESTS PASS".**

1. **Isolated**, in its own worktree on its own branch.
2. **Green locally**: `lint:check`, `tsc`, `build`, `test`; `test:e2e` when the change is user-visible, `test:e2e:unit` when it touches an e2e helper. "It was already failing" is a fact to report, not a reason to stop.
3. **Covered** by a test that fails without the change. A fix that cannot be pinned by a test is a fix that comes back.
4. **Documented**: handoff docs updated, and any new gate, test trap, or architecture boundary written down where the next agent looks.
5. **Reviewed by someone else**, thoroughly: the diff, the surrounding code, the tests, and its own load-bearing claim re-run. Not the author. A finding sends the task back.
6. **Merged into `main`**: `main` first merged or rebased into the branch **in the
   worktree**, conflicts resolved there, gates re-run there, and only then the merge
   into `main` — which has nothing left to decide. Pushed, `main` green afterwards.
7. **Reported as done**: what changed, what validation ran, what the review said.

- **A green gate is the floor, not the review.** `gate:commit` and `gate:push` are mechanical, and a review that was not performed is not a review that found nothing.
- **Never weaken a gate to reach "done"** — no skipped tests, raised thresholds, deleted assertions, or re-recorded baselines.
- **A blocked merge is not done.** Operator decision pending, a defect the operator wants kept, a conflict that needs judgement: say so and name what is outstanding. Reporting "done" with an unmerged branch is the failure mode this section exists to prevent.
- Only step 6 writes to `main` (plus a hotfix the operator asked for on main).

## E2E failures

- Read `e2e/OPEN_PROBLEMS.md` first. A new failure is a new defect.
- A pin/`expected-fail` is a tripwire for broken behavior; remove it in the same change that fixes the defect.
- Visual baselines re-record only with `--update-snapshots`; green means pixels matched.
- Read failures from `test-results/`; `trace.zip` needs a window, so ask the operator.

## Handoff documents

`HANDOFF.md`, `TEST-FLAKES.md`, and `e2e/OPEN_PROBLEMS.md`: validated, actionable problems only. **NO changelog, completion notes, or status summaries.** Verify against the tree.

- **Route by scope.** `HANDOFF.md` is for history/replay and document-state defects. `TEST-FLAKES.md` is for test-infrastructure defects — flakiness, the pool, the runner, the gates themselves. `e2e/OPEN_PROBLEMS.md` is for Playwright. Do not file a gate or pool defect in `HANDOFF.md`; it is scoped, and a cross-scope entry is the one nobody reads.
- **Nothing durable goes in `.kilo/`.** It is gitignored (`.gitignore:34`), so a finding recorded there dies with the machine and with the worktree. `HANDOFF.md` used to name `.kilo/plans/` as a handoff location; that was wrong, and it is why `TEST-FLAKES.md` exists.
- **Growing a file silently invalidates every `file.ts:NNN` in the handoffs that points into it.** The citations are load-bearing: an agent follows one, lands in a similar-looking function, and patches the wrong thing — §54's asset-transaction pointer once landed in the middle of `operationForTool`. A `grep` sweep does not catch it, because the text at the stale line still looks plausible. On a diff that inserts lines into a cited file, re-derive each citation from the prose's claim, not from the old number: **if your diff adds or removes lines above a cited line, every citation below it moved.** Measured on one branch: adding ~112 lines to `StoreContext.tsx` left 38 of 39 line-numbered citations into it and `history-adapter.ts` wrong, with exactly one still resolving. A correction applied from an audit is as load-bearing as the original and needs the same check.
- **The board is not a handoff location either.** Its database is machine-local
  for the same reason. Close an issue there, and delete the entry here.

**WRITE OR UPDATE THE HANDOFF WITHOUT ASKING** for every validated issue, strong recommendation, or durable finding. Ship it with the work.

### Lifecycle: entries die, they never get reworded

- **Verified fix: DELETE the entry.** Verification is another agent, review, or test, not the fixer's claim.
- **Never rewrite an open problem as closed.** Keep unverified work as the exact remaining verification; keep only test tripwires after a fix.

## Architecture status

`HistoryItem[]` is the **PRODUCTION REPLAY AUTHORITY**: history, `history-replay.ts`, runtime `Layer`s, and export. The durable document is shadow-only. Re-read code and plans before crossing the boundary. **DO NOT start single-writer cutover while `saveLayerCanvas()` promotes cached canvases outside reducer publication.**

## The toolbar is a Photoshop clone — HARD REQUIREMENT

**The Tools rail must be an exact clone of Adobe Photoshop's Tools panel. A tool that Photoshop
does not have must be deleted and replaced by the Photoshop tool it stands in for.** This is a
product requirement, not a preference, and it is not subject to local judgement.

The bar is not a "Photoshop-inspired" surface with room for app-specific extras. A user switching
from Photoshop must find the same tool in the same group, under the same name, at the same spot,
reachable by the same letter. Anything this app invents breaks the muscle memory the whole
product is borrowing.

Concretely, and all of these are currently violations on `main`:

- **No invented tools.** `draw` ("Draw Tool") is the only tool the app declares that Photoshop has
  no counterpart for. It is a freehand-annotation layer tool. Photoshop's nearest is the Brush, and
  the app already has a Brush. **It is to be deleted**, not relabelled.
- **Adjustments are not tools.** `color` (labelled "Colors"), `levels` ("Levels") and `transform`
  ("Transform") are `Image ▸ Adjustments` and `Edit ▸ Transform` commands, and Photoshop's Tools
  panel contains no such entries. Photoshop's name for `color` is "Black and White", which is not a
  tool either. These three are to leave the rail and become menu commands. They have **no
  replacement tool** — Photoshop puts nothing there.
- **No pseudo-tool.** `shape` is a grouping container carrying a `figure`; it is the one `ToolName`
  the rail never displays, and Adobe has no tool by that name. Photoshop's shapes are Rectangle,
  Ellipse, Triangle, Polygon, Line, Star and Custom Shape as **seven separate entries in one flyout**,
  not five figures behind a tool that does not exist.
- **Names are Adobe's, spelled Adobe's.** "Move Tool", "Rectangular Marquee Tool", "Ellipse Tool"
  (not "Ellipse"), "Content-Aware Move tool" (hyphenated). The registry identifier is free —
  `reposition` for the Move tool is acceptable — but the **rendered label is not**.
- **A tool the app cannot actually do still belongs in the rail**, rendering Photoshop's real
  options bar, because that is the contract. Eight tools currently render a `PlaceholderTool` chip
  bar instead (all six Pen-family tools, Custom Shape, Color Replacement). Photoshop's grouping and
  naming are the specification; the stub bar is the debt.

**Verified inventory, 2026-09-28.** Adobe's current release is Photoshop 2026, version 27.x. Adobe
publishes **no page that enumerates the Tools panel top-to-bottom**; they publish five topical
overview tables (selection, retouch, painting, drawing, navigation-and-measuring) plus a Customize
toolbar page that explains the grouping mechanism without ever listing the default groups. The
group order below is therefore **reconstructed from two independent third-party 2026 toolbar
diagrams, cross-checked against Adobe for membership**. Membership is Adobe-confirmed; **order and
separator placement are not.** Treat the order as a good hypothesis, not as fact, and prefer a
grouping a user can recognise over a grouping a source asserts.

Adobe-confirmed tool names, by the overview table each comes from:

| Adobe table                 | Tools                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection (upd. 2026-02-23) | Move, Rectangular Marquee, Elliptical Marquee, Single Row Marquee, Single Column Marquee, Lasso, Polygonal Lasso, Magnetic Lasso, Object Selection, Quick Selection, Magic Wand                                                                                                                                                                                            |
| Retouch (upd. 2026-02-23)   | Spot Healing Brush, Healing Brush, Patch, Red Eye, Eraser, Background Eraser, Magic Eraser, Blur, Sharpen, Smudge, Dodge, Burn, Sponge                                                                                                                                                                                                                                     |
| Painting (upd. 2025-10-27)  | Brush, Pencil, Color Replacement, Mixer Brush, History Brush, Art History Brush, Gradient, Paint Bucket, Eyedropper, Color Sampler, Clone Stamp, Pattern Stamp                                                                                                                                                                                                             |
| Drawing (upd. 2025-10-27)   | Pen, Freeform Pen, Curvature Pen, Add Anchor Point, Delete Anchor Point, Convert Point, Rectangle, Ellipse, Triangle, Polygon, Star, Line, Custom Shape                                                                                                                                                                                                                    |
| Type                        | Horizontal Type, Vertical Type, Vertical Type Mask, Horizontal Type Mask                                                                                                                                                                                                                                                                                                   |
| Unverified family           | Adobe's navigation-and-measuring overview (upd. 2026-02-23) exists but only one line was retrievable: "Ruler tool Measures distances, locations, and angles." Hand, Rotate View, Zoom, Frame, Slice, Perspective Crop, Slice Select, Path Selection and Direct Selection are **not Adobe-table-confirmed** and are listed from the shortcut PDF and individual tool pages. |

**Four 2026 candidates that are NOT Adobe-confirmed and must not ship as tools:** Adjustment Brush
(two third-party diagrams, zero Adobe pages), Clone Source tool (one diagram's icon numbering has
a gap where it would sit, the name was never printed), Selection Brush (Adobe documents it for
Photoshop on the web, not the desktop panel), and Generate Image (a real feature, but its placement
in the panel footer is unconfirmed).

**Not tools, and not to be implemented as tools:** the foreground/background swatches, "Edit in Quick
Mask Mode", the three screen-mode toggles, the `…` Edit Toolbar caret, the toolbar grip, and the
Extra Tools container.

**Naming traps in the source material, so nobody "fixes" them later:** Adobe's tables say
"Elliptical Marquee tool" and "Ellipse tool" — two different words for two different tools. Adobe's
painting table prints "Gradient tools" in the plural, which conflicts with the singular everywhere
else; that one is a genuine Adobe-side inconsistency. "Content-Aware Move tool" is hyphenated.

**What this costs.** See HANDOFF §68 for the file-by-file blast radius and the tests that pin tool
names. The hand-copied tool lists in tests are the expensive part: `tool-processors.test.ts` alone
carries four separate 41-name and 10-name lists, and `toolIcons.test.tsx` carries a 46-name union
by hand. Add a tool and every one of them has to change.
