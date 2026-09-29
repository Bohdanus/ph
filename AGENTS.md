# AGENTS.md

Photoshop-inspired, production-grade photo editor. Instructions for coding agents.

**The detail lives in linked files.** Read the root file for the rules that apply
to every task; open the linked file when the task is that kind of work.

| File                                                   | Read it when                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`docs/TESTING.md`](docs/TESTING.md)                   | running or changing any check: `tsc`, `test`, `lint`, `e2e`, build, CI                                 |
| [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md)       | working alongside other agents: worktrees, the swarm board, the worktree list, recovering a dead agent |
| [`docs/PHOTOSHOP-UX.md`](docs/PHOTOSHOP-UX.md)         | touching the Tools rail, tool names, or panel behaviour                                                |
| `HANDOFF.md`, `TEST-FLAKES.md`, `e2e/OPEN_PROBLEMS.md` | filing or checking a known defect — see "Handoff documents"                                            |

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
- Audit before spawning a fleet, not after: `sqlite3 ~/.local/share/kilo/kilo.db "SELECT json_extract(model,'\$.id') m, json_extract(model,'\$.providerID') p, count(*) FROM session GROUP BY 1,2 ORDER BY 3 DESC"` — `session.model` is a TEXT column holding JSON; there is no `data` column on `session`.

### Rules of delegation

- **NEVER TWO SUBAGENTS ON THE SAME FILE.** Split by concern, not by convenience.
- **Self-contained briefs.** A subagent has a fresh context: give it the goal, your constraints, whether it may edit code, and exactly what its final message must contain. "Return file:line for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not verified. Have subagents report candidate results _and_ how they got them, then check the load-bearing ones yourself.
- **Keep judgement calls.** Architecture, scope, whether a deviation is acceptable: a subagent cannot weigh this file against the operator's intent. "Looks good to me" is not authorization.
- **Background for long work** (`background: true`), and wait for every result you depended on. NEVER answer while one is still running.

## NEVER OPEN A BROWSER WINDOW

<<<<<<< HEAD
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

**Two rows have weaker coverage than the table implies, and the difference matters
only when an operator is looking at a prompt.**

- `--debug` is an **`ask`**, not a `deny`, at the permission layer (`kilo.jsonc`), so
  approving the prompt is possible — and the `global-setup.ts` argv guard throws
  anyway, so the run still does not start headed. Layered, not open.
- `test.use({ headless: false })` **inside a single spec file is blocked by nothing.**
  `global-setup.ts` inspects the _project_ scope and names the per-spec hole
  explicitly: the specs import `test` straight from `@playwright/test`, so no shared
  fixture layer can see it. Read the table's last row as "do not do this", not as
  "something will stop you".

## Commands

```bash
npm run test            # vitest, jsdom - app unit tests
npm run test:e2e:unit   # vitest, node - unit tests for the e2e helpers
npm run test:e2e        # playwright, HEADLESS - starts the dev server itself
npm run tsc             # tsc -b - AUTHORITATIVE typecheck
npm run lint:check      # eslint + prettier --check
npm run build           # production bundle, and a real CI step
npm run swarm             # the swarm board, live state: who holds what right now
npm run swarm -- help     # the full command list
npm run swarm -- ready    # the work queue an agent picks from
npm run swarm -- watch    # the event log; --follow to tail it
npm run swarm -- health   # is this board being USED, or only carried?

node scripts/worktree-inventory.mjs   # WORKTREES.json: what every worktree holds
```

## The swarm board

It is called **`swarm`**, and that name is load-bearing. It used to be `board`,
which is the same word Kilo's built-in tool uses for something else entirely, and
the collision cost a real session. **Do not rename it back to `board`, and do not
add `board` as an alias** — an alias passes every behavioural test and restores
the exact confusion this name exists to prevent. `scripts/__tests__/agent-board.test.mjs`
pins the script name, and the file on disk keeps its name because `agent-board.mjs`
is not a word anything else claims.

`npm run swarm` with no command prints the live state and names itself. Use it
as the first call in a fresh session: it settles what the tool is, and it is the
only invocation that answers that question.

**There are two boards and they are not the same thing.** Kilo ships a built-in
tool called `board_read`, and it is empty _on purpose_: it carries messages
between one session and the task children it spawned, so outside a fan-out it
reports `messages: []` truthfully and knows nothing about this repository. The
swarm board is one SQLite file that every worktree of this repo shares, and it
is essentially never empty. **A `board_read` result is not evidence that nobody
is working** — it is evidence that no subagent posted. This has already cost a
session: one asked what the agents were doing, was told the board was empty, and
was holding 196 events. Renaming removed the trap; the note in `swarm --help` and
in the no-argument output is the receipt, not the fix.

**`ready` ranks in four steps, and the order is the contract.** Priority first,
because it is the one signal the filer stated on purpose. Then live before
imported: a `HANDOFF.md#31` row is prose the durable record already owns, while
a peer finding is the only thing on this board that exists _because_ two agents
were working at once. Then startable before contended, since an issue another
agent is already inside its files cannot be picked up. Then oldest first. The
first two are the load-bearing ones: with fifty-four imported rows sharing a
single `normal` band, the old tie-break was file order, so `ready` returned the
import and buried the live work at the bottom of a fifty-row page. Every run
prints `N live · M imported from the handoff documents · K startable now`, and
`--live` drops the imports entirely.

- **`ready` is not a page of the import.** The limit is applied _after_ ranking.
  Slicing first is how a fifty-row queue ends up showing the same fifty rows
  forever, with the live work never on the page at all.
- **The summary line is a human format, and it is not unconditional.** A run that
  finds nothing ready prints `nothing ready: everything open is claimed, blocked, or
closed` and **no counts at all** — the summary is the other branch of the same
  ternary (`agent-board.mjs:492-496`) — and `--json` emits `liveCount` /
  `importedCount` / `startableCount` as fields rather than prose. The third segment
  also carries the suffix `— nobody else is in the files`, so match on the numbers,
  not the sentence.
- **`startable` means "live AND inside nobody else's files", and the zero case does
  not say which half failed.** On a board with no live issues at all it still prints
  `none startable now: every live issue is inside a file another agent holds`, which
  is a cause it has not checked. Read the `N live` number before believing the
  sentence attached to `K`.
- **Filing an issue with `--files` TAKES those files for the filer.** So a test
  or a script that files `--files src/x.ts` and then has _another_ agent hold
  `src/x.ts` has a refused hold and no contention at all, and a filer's own lock
  is deliberately not contention. Take the other agent's lock FIRST.
- **"Contended" and "claimed" are different axes, and both are filters.** `ready`
  drops a claimed issue entirely (`db.mjs:897`); `contended` means a _live lock held
  by an agent other than the one running `ready`_, on a path in the issue's file
  list (`agent-board.mjs:402-411`). An issue can be unclaimed and still contended,
  and the reverse.
- **Provenance is read off the origin grammar** (`isImportedOrigin` in
  `db.mjs`): `<file>.md#<number-or-slug>`. A live finding has no origin, or a
  free-text one (`main: 2026-09-28`). The pattern tolerates a path prefix on
  purpose — a stricter one would read `e2e/OPEN_PROBLEMS.md#p2-…` as live,
  which is the one answer that promotes a mirror to the head of the queue.

**It is NOT the handoff documents.** `HANDOFF.md`, `TEST-FLAKES.md` and
`e2e/OPEN_PROBLEMS.md` stay the durable, reviewable record of what is known
about this codebase, written by hand and merged through a pull request. The
board answers the questions prose cannot: what is true _right now_, between
concurrent agents. `swarm import` copies the documents' items onto the board
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
- **A claim lives while your worktree does — there is no heartbeat to forget.**
  `swarm claim ph-12` holds it for 45 minutes, and every later command you run
  **renews it automatically, because your worktree is still on disk**. That is the
  whole mechanism, and it is deliberately not `swarm heartbeat`: over 308 events
  `claim.renew` fired **once**, and four of five unreleased claims ended up
  expired while their holders were almost certainly still working. A heartbeat
  nobody sends is not a liveness signal, it is a countdown that always runs out.
  `swarm heartbeat` still exists and is still correct — it is the only thing that
  can renew for an agent with **no worktree** (working on `main`, or detached),
  which is the one case that has no evidence of life and so keeps the old manual
  contract.
- **A claim whose worktree is gone is released by the next command from anybody.**
  The board renews your own claim **first** and sweeps **second**, and that order
  is the entire safety argument: renewing first means a working agent's lease is
  never what gets swept, so the sweep can only reclaim a claim whose worktree has
  vanished — which is exactly when reclaiming it is right. Running `doctor`
  itself on every open would hand a 45-minute timer the power to strip a lock off
  an agent mid-edit.
- **`swarm doctor` is EXEMPT from that sweep, and has to be.** It is the explicit,
  authoritative one, and the exemption is what keeps `swarm doctor --dry-run`
  meaningful: it is the command that answers _what is stale right now_, and a loop
  reads it. If the sweep ran first, the real one would already have happened and
  `--dry-run` would report nothing, truthfully and uselessly.
- **A sweep writes a `doctor.run` event only when it actually released
  something.** The sweep runs on every command, so an event per invocation turned
  a six-event board into one that was two-thirds sweep noise, and `health`
  inflated the very number it was reporting. `health`'s `sweeps` is therefore
  _reclaims made_, and reads 0 on a healthy board.
- **Past the lease the issue is offered again**, and the takeover is in the event
  log with both agents named. `swarm status` reports; `swarm doctor` is still the
  command that releases an abandoned claim, and it releases a claim whose
  worktree no longer exists even when the lease has not run out.
- **`swarm health` answers "is this thing being used, or only carried?"** It is
  the traffic mix, the locks, live vs expired claims, reclaims so far, live vs
  imported issues, and live findings idle for over six hours. It exists because
  this question was previously answered by hand-writing SQL against the schema,
  which means the next agent answers it differently or not at all.
- **The traffic mix is in TWO UNITS, and adding them is a mistake that shipped
  a wrong number into this paragraph.** `lock.hold` is **one event per command**
  (its message reads `14 file(s)`), `lock.release` is **one event per file**, and
  a good share of holds took no files at all (`filed about 2 file(s), no locks
taken` — the filer was refused). An earlier version of `health` summed them and
  reported that 66% of all traffic was file locks, of which 66% was
  `lock.release`. Both halves were artifacts of the encoding: measured one unit at
  a time, `lock.hold` is the top per-command activity and `lock.release` is the
  top per-file one, and the sum said more about the schema than about the agents.
  `health` now splits by unit — **read `activity.perCommand` and
  `activity.perFile` as two measures, never as two halves of one number** — and
  takes the lock count from the `file_locks` table, which is the only one of the
  three that counts the same thing twice. The conclusion that survived the
  correction: **this is a file-lock manager, and the issue tracker is the part
  nobody uses.** Read that before building more of the issue tracker.
- **`swarm hold <path>` makes "never two agents on the same file" a refused
  write**, and the refusal names the holder. `swarm check <path>` exits 1 when
  somebody else holds it, so a shell can gate on it. `swarm claim --files a.ts
b.ts` takes both, and gives back **only the ones it took** if the claim is
  then refused — never a file that agent already held, and never with `--force`.
- **The fixer's claim is not its verification.** `swarm resolve` needs the live
  claim; `swarm close` refuses the agent that resolved the issue, exactly as
  this document's own handoff lifecycle requires. Exit code 5 is that refusal.
  **There is no `--verified-by`**, and that is the point: a flag naming somebody
  else is a name the caller supplies about an agent that is not in the room, and
  it made the whole rule one flag wide. A reviewer closes an issue by being the
  reviewer.
- **`--agent <id>` is unauthenticated, and it DEFEATS the self-close check.**
  The guard compares the string you pass, not who you are, so `swarm close <id>
--agent somebody-else` closes an issue you resolved yourself. This is the same
  defect `--verified-by` was removed for — a caller-supplied name about an agent
  that is not in the room — and it is the one remaining hole in the rule above.
  **Use `--agent` only to speak for a branch you actually are**, and never to
  close anything. Verified: `close` as the resolving agent exits 5; the same
  `close` with a different `--agent` exits 0. The operator owns the decision on
  whether to close this, so it is filed, not fixed.
- **`swarm note` is how one agent addresses the swarm**; `swarm watch --follow`
  tails the same log. Every command appends to it, which is the replacement for
  N agents each writing their own account of the same work into a document
  nobody else can see until it is merged.
- **Exit codes are the interface:** 0 ok · 1 usage or error · 2 not found ·
  3 claimed or not claimable · 4 file held by another agent · 5 self-verification
  refused. An agent can branch on them; a human reading them learns why.

It is a command, not a gate. Nothing in `.husky/` calls it, and no commit may be
blocked on it.

### The swarm board is cross-session, so a merge can announce itself

The database is global and **nothing in it is scoped to a session**: identity is the
git branch, and the `agents` table's `session_id` column records only the first Kilo
run to touch a branch and is never read back (`db.mjs:132`, written from
`KILO_RUN_ID` at `:611`/`:624`, referenced by no query). So a `swarm note` from one
worktree is in the same log every other session's `swarm watch --follow` tails. That
is the whole reason the board can prevent a merge mess, and it is why these six are
not optional politeness:

- **Claim before the first edit**, not after: `swarm claim <id> --files <paths you will
touch>`, or `swarm hold <path>` for a path with no issue. `swarm check <paths>` before
  you edit anything a brief, a handoff, or a sibling subagent names. Both exit 1 on a
  path somebody else holds, and the refusal names the holder.
- **Claim the merge, not just the files.** A branch that is about to land carries a
  hazard to every path in it, and no file claim expresses that. `swarm note` the branch
  and the paths _before_ you start resolving, so an agent holding one of them learns it
  before it edits rather than after.
- **A delivered note is a log write, not a delivery.** There is no recipient column, no
  wake and no activity notice: `note` is broadcast, and `comment <id>` needs an issue
  somebody filed. Put the fact where a running agent will meet it anyway — a claimed
  path it must `check`, and a `swarm note` naming its own files.
- **`board_post` is a different channel and it is not a substitute.** It reaches the
  sessions a fan-out spawned, so a post about work in a worktree usually has **no
  recipient in the room** and returns `total: 0, active: 0` with an explicit warning
  that nothing was delivered. Treat that response as the answer, not as a queued
  message. Anything durable goes in a `swarm note`, a claimed path, or a handoff; a
  `board_post` is for the children of your own run.
- **An empty board is not evidence that nobody is working.** A file nobody claimed
  reads as free, so claiming is what makes a second reader of the path find out.
- **A held file is a queue, not a deadlock.** When `swarm check` refuses a path you
  need, the file belongs to somebody. Do not edit it, and do not wait on the lease
  either — a 45-minute lease is not a work plan. Ask in a `swarm note` **naming the
  file and the change**, hand it over for the duration, or do the work somewhere
  else and merge `main` in first. What you must not do is edit a held file: the
  refusal names the holder precisely so a second reader finds out, and editing
  anyway makes the hold a lie.

## Running commands

- **RUN FROM THE REPO ROOT** (`ph`), via the shell tool's `workdir`. A parent directory silently resolves the wrong package and the wrong tsconfig.
- **`npm run tsc` IS THE ONLY TRUSTWORTHY TYPECHECK. NEVER GATE ON `npx tsc --noEmit`.** `tsc -b` covers `tsconfig.app/node/e2e.json`, so it also checks the Playwright specs and the test files. `npx tsc --noEmit` at the root resolves the **solution stub** and type-checks **zero files**, for the reason in the next bullet — it is not a narrower project, it is an empty one.
- **The bare `npx tsc` type-checks ZERO files and always exits 0.** The root `tsconfig.json` is a solution stub — `"files": []`, no `include`, three `references` — so `npx tsc --showConfig -p tsconfig.json` prints `{"compilerOptions": {}}` and the references. It is indistinguishable from a pass, and `.claude/settings.local.json` in the operator's ROOT checkout carries a `"allow": ["Bash(npx tsc:*)"]` wildcard that auto-approves exactly that command. That file is untracked and globally gitignored (`~/.config/git/ignore` has `**/.claude/settings.local.json`), so no worktree, `git status` or `git ls-files` can see it — its absence from your worktree is not its absence from the machine. Only `npm run tsc` (`tsc -b`) type-checks anything.
  - **It is the stub, not a missing `exclude`, that makes the stub empty.** `tsconfig.app.json` has **no** `exclude` and its `include` is `["src", "toolbar-mapping.ts"]`, so the app project pulls in its test files rather than hiding them. Any future note explaining the trap as "the app tsconfig excludes tests" is wrong on both clauses.
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
- **`git stash` is a shared, unordered stack, and it is not to be used here.** It lives in the
  common git dir, so `git stash pop` in one worktree can pop another agent's stash — and the
  failure is **silent in a way that is worse than a lost entry**: `git stash push` on a CLEAN tree
  prints nothing, exits 0, and creates **no entry at all**. The `pop` that follows is therefore
  not paired with the `push` that would have made it safe; it takes `stash@{0}`, which is
  whoever pushed last. Measured here: a `stash push -u -m "<label>"` on a clean main worktree was
  a no-op, and the next `stash pop` pulled `fix/flyout-longpress-race`'s entry into the **shared
  main checkout** and left it merge-conflicted. The work was not lost — the file was already
  committed, and a conflicted `pop` does not drop the entry — but the recovery is one `reset
--hard` **only** because `git status --porcelain` showed exactly one conflicted path. That
  check is the entire margin; a dirty shared worktree makes this unrecoverable, which is why
  `AGENTS.md` also forbids repairing a conflict in `main`. **Use a worktree or a branch.** If a
  worktree genuinely must be set aside, `git stash push` is the wrong tool: `HUSKY=0 git commit`
  on a throwaway branch is one command and holds nothing but your own files. HANDOFF §69.

Five traps that cost real debugging time:

- **A worktree used to run no commit gate at all, silently.** `core.hooksPath` was `.husky/_` — a directory husky generates during `npm install` and keeps untracked — and git resolves a relative `core.hooksPath` against the root of the worktree it is running in. Every worktree made by `git worktree add` had no `.husky/_`, so git found no hook, ran nothing, and exited 0. The commit landed with no warning and nothing in its output to notice. 89 of 118 worktrees were in that state while 96 had a populated `node_modules`, so "just run npm install" was never the fix. `core.hooksPath` now points at `<common git dir>/hooks-gate`, which every worktree shares, and the tracked `.husky/pre-commit` is what runs. **If a hook ever stops firing, run `git config core.hooksPath` first and assume nothing.** Re-install with `npm install` (the `prepare` script).
- **A worktree on an older commit blocks with a specific message, not a mystery one.** Its `.husky/pre-commit` still sources husky's generated preamble, which only an install in _that_ worktree ever created. The dispatcher names the cause; bring the worktree up to date, or `git config --unset core.hooksPath`. It blocks rather than skipping on purpose: a gate that cannot run must not let a commit through.
- **`node_modules` is empty or missing in most worktrees.** Node walks up to the parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what makes it misleading. Vite does **not** walk up: it serves only what `server.fs.allow` permits, so fonts, images and AVIF assets from the ancestor checkout 404 in a worktree and work in the root checkout. Run `npm ci` there before debugging an asset that will not load.
- **Every worktree's dev server wants :5173.** Locally `reuseExistingServer` is on, so `test:e2e` can attach to a server another worktree started and then test _that_ checkout. Use `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` in a worktree. "My change did nothing" in e2e is this, not a cache.
- **An interrupted merge can leave `AUTO_MERGE` and `MERGE_MSG` with no `MERGE_HEAD`, and
  `git commit` then lands a single-parent commit that reads as a resolution.** Observed in a
  worktree mid-rebase: 24 unmerged index stages, no `MERGE_HEAD`, so the next `git commit`
  would have produced a commit with one parent and lost the other forever — and it would have
  looked correct in `git log`. After ANY interrupted or abandoned merge, run
  `git rev-parse -q --verify MERGE_HEAD` and `git rev-list --parents -n 1 HEAD` before
  committing. The first says whether a merge is still open; the second says whether the commit
  you are about to trust is the one you think it is.
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

**Read `action` first.** Every record carries one value, and it is the whole
answer — which of the three things is it:

| `action`    | meaning                                                                                         | do this           |
| ----------- | ----------------------------------------------------------------------------------------------- | ----------------- |
| `land`      | clean tree, commits ahead of `main`, merges clean                                               | merge it          |
| `at-risk`   | work on no ref, the merge needs a human, or git says disposable and a curated finding disagrees | save it           |
| `dispose`   | on `main`, clean, nothing protects it                                                           | delete it         |
| `in-use`    | an agent or a session is active there                                                           | leave it          |
| `keep`      | the main checkout                                                                               | never a candidate |
| `undecided` | cannot be told from what is known                                                               | do not remove     |

**`land` is a point-in-time answer, not a licence.** It is true against the
`mainHead` and the tree state recorded in this file, and is only as fresh as
`generatedAt`. `main` moves, and a branch that merged cleanly stops doing so.
Re-read `dirty` and `mergeConflict` before acting on a `land` you did not
generate yourself — and note that a worktree with **no liveness signal at all**
(`chats.count` 0 and `board.agents` empty) is the one most likely to have
changed since, because nothing here can see that somebody walked away from it.
That happened to a `land` entry within minutes of it being written.

**`at-risk` has a third source the table's one-liner used to leave out, and it is
the one that reads as nonsense.** A worktree git reports as **already merged and
clean**, which a curated finding protects, is `at-risk` (`classify.mjs:262-264`,
`REVIEW_RESIDUE`): "git says this is disposable, but a curated finding says
otherwise." That is neither work on no ref nor a merge needing a human — the
branch is _on_ `main` — so the table's "save it" reads as nonsense against it. If
`at-risk` and `mergedIntoMain` are both true, the live question is which curated
entry is protecting it, and the answer is in `summary` and `note`.

**`mustNotPrune` vetoes `land` as well as `dispose`.** It is a human claim that
something here is not accounted for, and a merge recommendation is as much a
claim about the contents as a prune recommendation is. A `land` entry carrying
`mustNotPrune: true` is impossible by construction; if you see one, the flag is
stale and belongs retracted in the same change that noticed it.

`readyToLand`, `disposalCandidates` and `atRisk` are named at the top of the
file so you do not have to filter the whole list to find them, and
`node scripts/worktree-inventory.mjs` prints the first two before the
evidence.

**`land` and `at-risk` were one bucket, and that was the defect.** Every
unmerged branch used to report `salvage`, so "a clean branch one commit ahead
that merges cleanly" was indistinguishable from "a branch whose only work sits
in a working tree on no ref at all". They call for **opposite** actions — go
and merge, versus go and save — so they are separate values now.

**"merges cleanly" is VERIFIED, not assumed.** `mergeConflict` comes from
`git merge-tree --write-tree`, which performs the merge in a scratch object
store and touches no working tree, index or ref, so it is safe to run across
every worktree. `mergeConflictFiles` names the files that collide. It is
`null` — never `false` — when the merge could not be attempted, because an
unknown is not a licence to land. `mergeConflictFiles` names the collisions,
because "this branch conflicts" sends somebody to investigate and "it conflicts
in these files" is the work. Roughly three quarters of the clean unmerged
branches here conflict, which is not a fact you can guess from
`ahead`/`behind`.

**`mergeChecked` means "we have an answer", not "the check ran".** It is
`mergeState !== 'unknown'` (`classify.mjs:313`), and `mergeVerdict` returns
`'unknown'` for **both** reasons a `mergeConflict` can be `null` — the check was
skipped, because the branch is already on `main` or detached (`git.mjs:266`), and
the check ran and could not be answered (`git.mjs:231`). So `mergeChecked: false`
means _no answer_, and the field does **not** tell you which of the two happened;
`mergeConflict: null` with `mergeChecked: false` is the entire vocabulary. Measured
on the generated file, every `null` record is `mergeChecked: false` — there is no
combination that separates the two cases. An earlier version of this document
claimed the opposite, and so did the comment in `assemble.mjs`. Treat unknown as
unknown and re-run the check yourself before acting on it.

`prunable: true` remains the strict disposal test: it is not the main worktree,
the branch is an ancestor of `main`, the working tree is clean, and no curated
finding protects it. `dispose` is derived from the same decision, so the two
cannot disagree.

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

`chats.unfinished` holds **six** states (`chats.mjs:57-64`): `active`,
`abandoned-midflight` (a stale session whose last turn ended on a
tool call rather than a completed stop), `blocked` (waiting on a human answer —
go answer it), `died-at-birth`, `rejected-credits` and `orphaned` (the worktree
directory no longer exists). `chats.dead` holds the
subset that will never produce anything: `died-at-birth`, `rejected-credits`
and `orphaned`. `orphaned` is in both lists and `finished` is in neither; a
session that is neither unfinished nor dead is `finished`. An earlier version of
this paragraph listed only five and dropped `orphaned` from `unfinished`, which is
invisible on a board whose only live states happen to be `active` and
`abandoned-midflight` — so the omission survives every casual read.

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

### The READ audit: what the agents actually said, not what their shape implies

Everything above is **computed**: it reads `step-finish` reasons, tool-error
counts, and "Add credits" strings out of the session database. It is cheap,
necessary, and it cannot answer the only question you have — _is the work
finished_ — because two agents with identical shape can have merged a branch and
written a plan. It also cannot see the failure that matters most here: an agent
that reported "Done" for a branch that was never merged, which git then reports
as clean, landed, and prunable.

So `scripts/lib/worktree-inventory/chat-audit.data.json` records what reading
the transcripts found, for every top-level session in the window. Each record
carries a `readState` (`struggling`, `blocked`, `abandoned`, `failed`,
`unknown`, `finished`), a `readRisk`, and a `note` naming what the agent
actually delivered and where its own summary overstates it.

**Both views ship, and they are deliberately not reconciled.** `chats.byState`
is computed and live; `chats.read` is observed and dated. Where a computed
`finished` sits next to a read `struggling`, that disagreement **is the finding**
— reconciling them would require trusting one over the other in exactly the case
that matters. `readUnfinished` and `workOnNoRef` are the two lists, named at the
top of the file, and `node scripts/worktree-inventory.mjs` prints them before
anything else.

**`dataSources.readAudit.asOf` is load-bearing, and it is derived.** It comes
from the extraction artefact's mtime, never typed by hand: a hand-typed one was
wrong on the first attempt — local time written with a `Z` suffix, which put the
stamp 91 minutes in the **future**, so every `now - asOf` computed a negative
age and concluded the audit was fresh. A test asserts `asOf <= now`.

**Every read-derived list is re-checked against the live tree, because a
read-derived count is a claim about a moment.** `workOnNoRef` carries
`stillOnNoRef`, and all four of its entries were `false` by the time the file
was generated: each had committed within the hour. A test drives it. Without
that, the list printed "on no ref" beside a `dirty=0` record for the same
worktree, in the same document.

**`readLostWorktree` is a top-level list and has to be.** The finding no
computed signal can produce is a session that produced work whose worktree was
then deleted. It was previously a field on the worktree record, where it was
**structurally always false** — the loop that fills it only visits worktrees
that still exist, so every one of the seventeen was unreachable and two of the
three lost-work findings appeared in no output at all.

**The audit records conclusions about sessions, never their contents.** No
transcript body, no tool arguments, no code — a test asserts the record's exact
key set — so the file cannot leak what was said and cannot grow without bound.

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
zero `chats.count` as "no chat was opened there", never as "nobody worked
there". It is also **windowed** — the query filters `time_updated >=` a cutoff
(`chats.mjs:109`) at `--window-hours`, 24 by default
(`worktree-inventory.mjs:57`) — so the precise reading is "no top-level session
opened at that path inside the window", and a worktree worked on last week scores
the same zero.

### The file is generated; the judgement is not

Anything git or the session database can answer is read fresh on every run.
Anything a human had to look at and decide lives in
`scripts/lib/worktree-inventory/curated.mjs` and survives regeneration:

```js
// scripts/lib/worktree-inventory/curated.mjs — these two are verbatim, and the
// difference between them is the whole reason to read both.
'polygon-marching-ants': {
  summary: 'Polygon-selection marching ants: the ants component, …',
  mustNotPrune: true,   // blocks prunable even when git says it is clean
  note: 'git reports this as merged and 0 ahead because the branch sits on an
          old main commit. The work exists on no ref.',
},                      // note: no `issues`, and NO `landed`
'ps-pixel-tools': {
  summary: 'Eraser, Magic Eraser, Paint Bucket and Clone Stamp as four tool
            areas plus toolbars, with their tools and tests. …',
  issues: [{ ref: 'HANDOFF.md#48', title: 'eraser is hard-edged; …' }],
  mustNotPrune: true,
  landed: true,         // a CLAIM, asserted against git by a test
  note: 'Reported as merged for the same reason as polygon-marching-ants: …',
},
```

**Those two entries are not interchangeable, and the sample that used to sit here
made them look like one shape.** The earlier version showed `polygon-marching-ants`
carrying `issues` **and** `landed: true`, which is wrong in both directions: it has
neither, and copying it produces a `landed: true` that the test below fails
immediately, because that worktree is not on `main`. `issues` and `landed` belong
to `ps-pixel-tools`. Read the file, do not work from a sample in prose.

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
- `e2e/**` is excluded from `npm run test`, and Playwright's `testIgnore` is `['**/__tests__/**', '**/*.unit.spec.ts', '**/*.unit.test.ts']` — three patterns, not two. A Playwright spec in jsdom, or an e2e helper test in a browser, fails in a way that looks like a product bug.
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
- **`AnchoredOverlay` clamps a flyout's POSITION and never its SIZE, and the wrapper is
  `position: fixed`, so an overlay taller than the window has no scrollbar and no
  reachable tail.** The portal is what makes an overlay escape ancestor clipping; it is
  also what removes the ancestor a tall one would have scrolled inside. `clampToViewport`
  resolves a too-tall overlay to the viewport padding, so the overlay starts at the top
  edge and runs off the bottom, and `toBeVisible()` is true of every item in it. This is
  the same shape as the row above — a thing that is in the DOM, has a box, and cannot be
  reached — and the two halves are one component, so read them together.
  The rail's three-dots menu hit it: it holds every tool the rail could not fit, about
  thirty of them, which is roughly 1374px of menu, and at 1280x720 two thirds of the
  Type and shape tools were below the fold with nothing in the DOM to say so. **Any
  flyout that can hold more than a viewport's worth of items needs a viewport bound and
  its own scroll** — `max-h-[calc(100vh-1rem)] overflow-y-auto overscroll-contain` on the
  menu. And because a browser here paints zero-width OVERLAY scrollbars, a test cannot
  assert a thumb: assert `scrollHeight > clientHeight` as the non-vacuity control, then
  `scrollIntoViewIfNeeded()` the LAST item and assert it is inside the window.
  `e2e/toolbar-overflow.spec.ts` is the worked example.
- **A rail that is a grid item sized by its CONTENT has no height for `flex-1` to divide.**
  The left rail's column is `h-full` for that reason, and it is load-bearing rather than
  cosmetic: the tiles' fit measures the slot, so a slot sized by the tiles would measure
  its own output, agree with it, and never collapse anything. `min-h-full` was correct
  while the rail scrolled and stopped being correct the moment the tiles were fitted
  instead. The same reasoning is why the fit reads `left-toolbar-slot` and never
  `innerHeight` or the rail's own box: that is what lets the panel be dragged off the
  edge and resized later without touching the rule. `SidebarLeft.overflow.test.tsx`
  asserts the window-independence rather than promising it.
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

Two hooks, each a one-line wrapper over a `package.json` script, so the hook and the command a developer or CI can run by hand cannot drift:

On the default headless e2e run **no test fails**, and two are `test.skip` by
declaration because they need an external service or a manual gesture. That is
the whole contract, and it is a contract about the number of _failures_, not
about any particular total: an earlier version of this line carried "194 pass,
2 skipped (196 total), measured at `f7757cf`" and it was already ~40
declarations stale within the day, so the count is gone rather than refreshed.
A run that reports any failure is a defect or an infrastructure failure, never a
known-failing test. If you need a number, produce it rather than reading one
here: `ls e2e/*.spec.ts e2e/export/*.spec.ts e2e/helpers/*.spec.ts | wc -l` is
the number of spec files Playwright collects, and `grep -c 'test('` over the
same set is the number of cases. Note what a failure of the second kind looks
like: the Vite dev server dying mid-run turns every subsequent spec into
`ERR_CONNECTION_REFUSED` and reports a wall of red that is not one failure but
zero. Re-run on a fresh `PLAYWRIGHT_PORT` before believing a large red count.
Three defect groups used to fail here and have since been fixed in this repository —
the CDP capture-size assertions, the keyboard flyout race, and the `levels.spec.ts`
canvas lookup. Each explains a shape the suite must not drift back into, and that
shape is now held by a tripwire in the test code rather than by a paragraph in a doc:
the fix removed the entry and pinned the replacement contract in the same change.
Both are reached through a shared entry point in the common git dir, not through husky; see "Worktrees and dev servers". `HUSKY=0 git commit` is the escape hatch.

- **The commit gate and these docs carry NO wall-clock numbers.** Every cost figure written into a hook comment or a doc in this repo has gone stale, and one of them — "the app suite is likely minutes" — was never measured at all and was the stated reason for a design decision that then shipped. Measure before you design; do not leave a number behind.
- `test:e2e:unit` is **not** an e2e run — `vitest --run --config vitest.e2e.config.ts`, node environment, no browser — and it is **not in the commit gate**. (The `--run` matters: the doc used to quote the command without it, and a copy of that string gets a watch-mode run rather than a one-shot.) It is the only coverage of the e2e helper functions, because `vitest.config.ts` excludes `e2e/**`, and that coverage is not optional: the `e2e-unit` CI job runs it as its own blocking step, and a separate blocking job so a break in the app pipeline cannot remove the only gate on `e2e/`. Run it by hand when you touch anything under `e2e/`, the way `test:e2e` is run when a change is user-visible. `test:e2e:unit:coverage` re-runs it under `--coverage` and is CI-only.
- **The commit gate runs no app unit test, and that is deliberate.** `npm run test` is the whole-tree check: run it on demand, and `gate:push` runs it for you. The scoped fan-out that used to sit in the gate is a command now — see below. Accepted cost: a test that was already failing before the commit started is caught at push, in CI, or when someone runs `npm run test` — and this repo's worktrees are full of commits that needed exactly that catch.
- `*.{ts,tsx}` uses ESLint + Prettier; `*.{js,jsx,mjs,cjs,scss,css,jsonc,yml,yaml,md,json}` uses Prettier only. **Do not add ESLint for the latter group**: no config covers it, and doing so breaks Markdown/SCSS commits. `scripts/*.js` is in that second group.
- **`lint:check` lints `git ls-files`, not `.`.** `scripts/lint-tracked.js` is the only place the two extension lists live, and they are the same rule on both sides: `lint:check` covers every tracked file of those types, `.husky/pre-commit` covers the staged subset. A filesystem-scoped command took `.kilo/`'s worktrees, `dist/`, and generated e2e output as input, and needed a hand-maintained `.prettierignore` to stop `npm run format` rewriting them — that file is gone because nothing it listed is tracked. The tracked images, `src/components/SidebarLeft/snippet.txt` (the only tracked `.txt`) and `index.html` are **not** linted, deliberately. **"The dotfiles are not linted" is not quite true and should not be repeated:** it means dotfiles with no linted extension — `.gitattributes`, `.gitignore`, `.nvmrc`, `.prettierrc` — while `.copilot-instructions.md` is a dotfile that _is_ linted, because it matches `*.md`. The globs in the script are where that decision is written down. **Legacy files being outside the linted set is not a problem to solve.**
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
=======

**A headed browser takes over the operator's screen and their input reaches the page as real test input, so a headed run fails for reasons that are not in the code. `test:e2e` is headless and stays that way** — never pass `--headed`, `--ui`, `--debug`, `show-report`, `show-trace`, `codegen`, or `PLAYWRIGHT_ALLOW_HEADED=1`, and do not "fix" a failure by flipping the mode. If something only reproduces visually, ask the operator to run `npm run test:e2e:headed` themselves. Blocked-command table and the two holes in enforcement: [`docs/TESTING.md`](docs/TESTING.md).

## Working with other agents

Orchestration detail — the board's commands, leases, `doctor`, and the worktree
inventory — is in [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md). What applies
to every task:

- **Every change to a tracked file happens in its own worktree under
  `.kilo/worktrees/`, on its own branch.** `main` is for reading and merging.
  Before the first edit, `git rev-parse --show-toplevel` must resolve under
  `.kilo/worktrees/`. Create it first, e.g.
  `git worktree add -b fix/task .kilo/worktrees/task`. Read-only work, and changes
  the operator explicitly asked for on `main`, are the only exceptions — a
  doc-only change is not one. If you are already in a worktree, do not nest
  another.
- **One writer per worktree; readers may share it.** A root-level agent is one a
  human started as a Kilo chat. Two of them never _write_ the same worktree, and
  one does not take over a worktree another is writing in. **Read-only agents may
  share a worktree freely** — inspecting, reviewing and auditing are the common
  case and are safe; a reader must still mutate nothing: no commit, checkout,
  reset, install, or worktree removal. Subagents of one root agent share that
  agent's worktree and must split by file. The board cannot enforce any of this —
  identity is the branch, so two agents in one worktree are the same agent to it.
- **Claim what you touch before the first edit:** `npm run swarm -- claim <id>
--files <paths>`, or `swarm hold <path>` with no issue. A refused hold names the
  holder; take their lock first, never `--force` it. Announce a branch you are
  about to land with `swarm note` before you start resolving it.
- **Merge order:** `main` into the branch **in the worktree**, resolve and run
  gates there, then merge the clean branch into `main`. Never resolve conflicts or
  repair the index in `main`. Never `git stash` — it is a shared unordered stack.
- **A quiet agent is not a dead agent.** If a session died, preserve its worktree
  before reclaiming anything: inspect with `git status`/`git diff`/`git log -1`,
  preview with `npm run swarm -- doctor --dry-run`, then `npm run swarm -- doctor`.
  Force-release only a session confirmed dead, and never because a network-lost
  one stopped talking.
- **The list of worktrees is not written down anywhere by hand.** Run
  `node scripts/worktree-inventory.mjs` to regenerate `WORKTREES.json`, and read
  it before deleting a worktree. `0 commits ahead of main` is **not** evidence a
  worktree is disposable — it can hold uncommitted work that exists on no ref.

## Architecture status

`PaintToolName` is `'brush' | 'pencil'` and that narrowing is load-bearing, not
tidiness. A tool that SUBSTITUTES pixels cannot share a processor, an args type or
an options bar with one that STAMPS them: sharing the union is exactly what let a
forced `'spray'` `penType` masquerade as a tool setting, and a tool that has left
the paint panel must not be widened back into it to accommodate a new bar. The
corollary for persistence is `HANDOFF.md` 70 — a group that persists one key may
not absorb a tool that has more than one.

`HistoryItem[]` is the **PRODUCTION REPLAY AUTHORITY**: history,
`history-replay.ts`, runtime `Layer`s, and export. The durable document is
shadow-only. Re-read code and plans before crossing the boundary. **DO NOT start
single-writer cutover while `saveLayerCanvas()` promotes cached canvases outside
reducer publication.**

> > > > > > > main

## Definition of Done

**A TASK IS NOT DONE UNTIL THE WORK IS MERGED INTO `main` AFTER A THOROUGH CODE REVIEW. NOT "IMPLEMENTED", "COMMITTED", "PUSHED", "PR OPEN", OR "THE TESTS PASS".**

1. **Isolated**, in its own worktree on its own branch.
2. **Green locally**: `lint:check`, `tsc`, `build`, `test`; `test:e2e` when the change is user-visible, `test:e2e:unit` when it touches an e2e helper. See [`docs/TESTING.md`](docs/TESTING.md). "It was already failing" is a fact to report, not a reason to stop.
3. **Covered** by a test that fails without the change. A fix that cannot be pinned by a test is a fix that comes back.
4. **Documented**: handoff docs updated, and any new gate, test trap, or architecture boundary written down where the next agent looks.
5. **Reviewed by someone else**, thoroughly: the diff, the surrounding code, the tests, and its own load-bearing claim re-run. Not the author. A finding sends the task back.
6. **Merged into `main`** after review and passing gates.
7. **Reported as done**: what changed, what validation ran, what the review said.

- **A blocked merge is not done.** Operator decision pending, a defect the operator wants kept, a conflict that needs judgement: say so and name what is outstanding. Reporting "done" with an unmerged branch is the failure mode this section exists to prevent.

## Handoff documents

`HANDOFF.md`, `TEST-FLAKES.md`, and `e2e/OPEN_PROBLEMS.md`: validated, actionable problems only. **NO changelog, completion notes, or status summaries.** Verify against the tree.

- **Route by scope.** `HANDOFF.md` is for history/replay and document-state defects. `TEST-FLAKES.md` is for test-infrastructure defects — flakiness, the pool, the runner, the gates themselves. `e2e/OPEN_PROBLEMS.md` is for Playwright. Do not file a gate or pool defect in `HANDOFF.md`; it is scoped, and a cross-scope entry is the one nobody reads.
- **Nothing durable goes in `.kilo/` or the swarm database.** Both are machine-local; findings belong in the scoped handoff documents. Close the swarm entry when its verified finding is deleted from the handoff.
- **Line-numbered handoff citations move with the file.** If a diff adds or removes lines above `file.ts:NNN`, re-derive every citation below it from the prose's claim.

**WRITE OR UPDATE THE HANDOFF WITHOUT ASKING** for every validated issue, strong recommendation, or durable finding. Ship it with the work.

### Lifecycle: entries die, they never get reworded

- **Verified fix: DELETE the entry.** Verification is another agent, review, or test, not the fixer's claim.
- **Never rewrite an open problem as closed.** Keep unverified work as the exact remaining verification; keep only test tripwires after a fix.
  <<<<<<< HEAD

## Architecture status

`PaintToolName` is `'brush' | 'pencil'` and that narrowing is load-bearing, not tidiness. A
tool that SUBSTITUTES pixels cannot share a processor, an args type or an options bar with one
that STAMPS them: sharing the union is exactly what let a forced `'spray'` `penType` masquerade
as a tool setting, and a tool that has left the paint panel must not be widened back into it
to accommodate a new bar. The corollary for persistence is `HANDOFF.md` 70 — a group that
persists one key may not absorb a tool that has more than one.

`HistoryItem[]` is the **PRODUCTION REPLAY AUTHORITY**: history, `history-replay.ts`, runtime `Layer`s, and export. The durable document is shadow-only. Re-read code and plans before crossing the boundary. **DO NOT start single-writer cutover while `saveLayerCanvas()` promotes cached canvases outside reducer publication.**

## The toolbar is a Photoshop clone — HARD REQUIREMENT

**The Tools rail must be an exact clone of Adobe Photoshop's Tools panel. A tool that Photoshop
does not have must be deleted and replaced by the Photoshop tool it stands in for.** This is a
product requirement, not a preference, and it is not subject to local judgement.

The bar is not a "Photoshop-inspired" surface with room for app-specific extras. A user switching
from Photoshop must find the same tool in the same group, under the same name, at the same spot,
reachable by the same letter. Anything this app invents breaks the muscle memory the whole
product is borrowing.

Concretely, and all of these are currently violations on `main`. The rail's groups, flyouts
and rendered labels are all defined in **`toolbar-mapping.ts` at the repository root** — not
under `src/components/` — so that is the first file to read.

- **No invented tools.** `draw` ("Draw Tool") is the clearest case, and it is **one of five**
  tool ids the app declares that Photoshop has no counterpart for: `draw`, `color`, `levels`,
  `transform` and `shape`, which are the five bullets that follow. Do not scope the work to
  `draw` and declare the requirement met. `draw` itself is a freehand-annotation layer tool;
  Photoshop's nearest is the Brush, and the app already has a Brush. **It is to be deleted**,
  not relabelled.
- **Adjustments are not tools.** `color` (labelled "Colors"), `levels` ("Levels") and `transform`
  ("Transform") are `Image ▸ Adjustments` and `Edit ▸ Transform` commands, and Photoshop's Tools
  panel contains no such entries. Photoshop's name for `color` is "Black and White", which is not a
  tool either. These three are to leave the rail and become menu commands. They have **no
  replacement tool** — Photoshop puts nothing there. `toolbar-mapping.ts` already exports
  `extraTools = ['color', 'levels', 'transform']`, so the extraction is half-staged: the flag
  exists, the rail entries do not.
- **No pseudo-tool.** `shape` is a grouping container carrying a `figure`, and Adobe has no tool
  by that name. It is not uniquely undisplayed, which is the trap in deleting it: `rectangle`,
  `ellipse`, `triangle`, `polygon` and `line` are **also** registry ids the rail never names, so
  "the one `ToolName` the rail never displays" points at the wrong target. `shape` is the only
  id the flyout routes every figure through. Photoshop's shapes are Rectangle, Ellipse, Triangle,
  Polygon, Line, Star and Custom Shape as **seven separate entries in one flyout**; the flyout
  has **six** today (`toolbar-mapping.ts:108-115`) and `Star` is the missing one.
- **Names are Adobe's, spelled Adobe's.** "Move Tool", "Rectangular Marquee Tool", "Ellipse Tool"
  (not "Ellipse"). The registry identifier is free — `reposition` for the Move tool is
  acceptable — but the **rendered label is not**. The first three are already exact on `main`;
  the only labels that do not end in `" Tool"` are the three this section already flags
  (`Colors`, `Levels`, `Transform`). "Content-Aware Move tool" is hyphenated in Adobe's tables
  but **no such tool exists in the app yet**, so there is nothing to rename — when it lands,
  render it that way.
- **A tool the app cannot actually do still belongs in the rail**, rendering Photoshop's real
  options bar, because that is the contract. **Seven** tools currently render a `PlaceholderTool`
  chip bar instead — the six Pen-family tools and Custom Shape. Photoshop's grouping and
  naming are the specification; the stub bar is the debt.
  - **Color Replacement is NOT on that list and must not be put back on it.** It left the
    roster: `toolsMap.ts:117-121` wires the real `ColorReplacement.tsx`,
    `toolbarPlaceholderConfig.ts:13-16` records the removal, and
    `tool-processors.test.ts:592-615` and `:617-635` assert the real bar. An earlier version
    of this document listed it and said "eight"; the two counts are `grep -c "placeholderTool("
src/tools/toolsMap.ts` and the membership of `placeholderNames` in the same test, and both
    answer seven.

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

**…and the one that looks like the list above but is not: the rail's THREE-DOTS TILE.** The `…`
Edit Toolbar caret and the Extra Tools container are not _tools_, which is why they are on that
list — but the tile this app renders for them is load-bearing and must not be deleted as "the Edit
Toolbar caret". Photoshop's own answer to a Tools panel taller than the window is that tile, and
this app reproduces it: when the tiles would take more than 80% of the vertical space the rail has,
the rows that do not fit move into a three-dots tile whose long-press or right-click flyout lists
**every tool of every collapsed group**, nested ones included, because a group is the unit the rail
hides and a tool is the unit the user reaches for. Omitting a collapsed group is the same defect
as omitting a tool from the panel. It is also the only thing keeping those tools reachable, so it
carries tests on both sides: `e2e/toolbar-overflow.spec.ts` asserts that at four viewport sizes
every tool is in exactly one of a tile or that flyout — nothing unreachable, nothing offered twice.

**One column is the DEFAULT, and no ordinary desktop window shows all of it.** Sixteen groups of a
44px tile is 822px of grid — 16 tiles, 15 row gaps at 6px, and 4 section separators at 7px on top
of the gap — and the budget is 80% of whatever the slot has left, so the window has to be about
**1400px tall** before nothing collapses at all (measured: at 1400 the slot is 1059 and nothing
collapses; at 1370 the slot is 1029 and a collapse already happened). The rail also spends 341px
of chrome above and below that grid — 137px of shell outside the rail and 204px inside it — which
is the other reason the threshold is where it is. Measured with:

```
PLAYWRIGHT_PORT=5251 npm run test:e2e -- e2e/measure-fit.spec.ts --reporter=list
```

That is what two columns is for, and it is why one column is Photoshop's default and the chevron
is the override. Do not read "everything fits" as something an ordinary laptop height satisfies,
and do not pin a viewport number to mean it: the rule is on the slot, and
`SidebarLeft.overflow.test.tsx` asserts that a different window at the same slot height changes
nothing.

**The default TOOL is the Draw tool, which the collapse puts in the three-dots tile at every
realistic window, so the three-dots tile is the only lit tile on load.** `DEFAULT_TOOL` is `draw`
(`src/util/constants.ts:17`) and `draw` is the seventeenth group — the last row, so the first the
collapse takes. Photoshop's default is Move, which has a tile. This is faithful to Photoshop's own
behaviour when the current tool is one of the hidden ones, and it is not a defect, but it is
surprising enough to look like one, and it makes `aria-pressed` on the three-dots tile a poor
discriminator for "did selecting this change anything" — it reads `true` before and after a switch
whenever both tools are in the same collapsed set. A spec asserting a tool got selected must
discriminate on that tool's own options-bar control, not on the tile lighting up; that is why
`keyboard-shortcuts.spec.ts` grew one control per row. `draw` is also on the list above for
deletion, which resolves it either way.

**Naming traps in the source material, so nobody "fixes" them later:** Adobe's tables say
"Elliptical Marquee tool" and "Ellipse tool" — two different words for two different tools. Adobe's
painting table prints "Gradient tools" in the plural, which conflicts with the singular everywhere
else; that one is a genuine Adobe-side inconsistency. "Content-Aware Move tool" is hyphenated.

**What this costs.** See HANDOFF §68 for the file-by-file blast radius and the tests that pin tool
names. The hand-copied tool lists in tests are the expensive part: the registry holds **41**
`ToolName`s, and `tool-processors.test.ts` carries **sixteen** hand-written name lists — two of
them exhaustive at 41 entries each (`dispatchTable`, `icons`), the rest ranging from 40 down to 2,
and **none of length 10**. An earlier version of this line said "four separate 41-name and 10-name
lists", which understated the work about fourfold. `toolIcons.test.tsx` carries a 46-name union by
hand (46 = the 41 tool ids plus 5 `shape-*` figure icons), byte-identical to `ToolIconName` in
`SidebarLeft/types.ts`; keep it that way. Add a tool and every one of them has to change. Count the
lists before estimating an edit, and do not trust a number written here — every one has gone stale.
=======

> > > > > > > main
