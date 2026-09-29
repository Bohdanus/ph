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
  log with both agents named. `swarm status` reports; `swarm doctor` releases an
  abandoned claim, including one whose worktree no longer exists.
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
- **An unclaimed path looks free; claim or hold it before editing.** A held file is a
  queue, not a deadlock: do not edit it or wait on the lease. Note the file and change,
  hand it over, or work elsewhere and merge `main` in first.

### Unexpected agent recovery

Do not delete a dead agent's worktree or force-release its claim before preserving
its work. Inspect it first:

```bash
git -C <worktree> status --short
git -C <worktree> diff
git -C <worktree> log -1
```

Then preview stale claims and locks with `npm run swarm -- doctor --dry-run`.
`npm run swarm -- doctor` releases claims from missing worktrees, expired leases,
and expired file locks. If the worktree still exists but the session is confirmed
dead in Agent Manager/session state and no process is writing, release its claim with
`npm run swarm -- release <issue> --force --reason "agent died; worktree inspected"`.
Do not force-release a live lease merely because a network-lost session is quiet.

Keep the worktree while salvaging uncommitted changes; never use `git stash`.
After preservation or discard, remove only an accounted-for worktree and refresh
`WORKTREES.json` with `node scripts/worktree-inventory.mjs`. Put durable findings in
the handoff documents and use `swarm note` for the recovery event.

## Running commands

- **RUN FROM THE REPO ROOT** (`ph`), via the shell tool's `workdir`. A parent directory silently resolves the wrong package and the wrong tsconfig.
- **`npm run tsc` is the only trustworthy typecheck.** The root `npx tsc`/`npx tsc --noEmit`
  resolves the solution stub, checks zero files, and exits 0; never use it as a gate.
- `npm run test` is `pool: 'vmThreads'`, `maxWorkers: 4` — a timing-sensitive test that only fails in a full run is usually the pool, not the code.
- `npm run test:e2e` starts Vite on :5173 itself. Pass `--retries=1` for a trace; `trace: 'on-first-retry'` yields nothing at the local `retries: 0`.

## Worktrees and dev servers

- **Before editing tracked files:** run `git rev-parse --show-toplevel`. It must resolve
  under `.kilo/worktrees/`.
- **One task = one worktree and branch.** Create it before editing, use a lowercase
  prefix (`fix/`, `feat/`, `e2e/`, `cleanup/`, `audit/`), for example:
  `git worktree add -b fix/task .kilo/worktrees/task`. Keep `main` for reading and
  merging. Read-only work and changes explicitly requested on `main` are the only
  exceptions; doc-only changes are not.
- If already under `.kilo/worktrees/` (including an Agent Manager worktree), do not
  create or nest another worktree.
- Stage only your paths. Merge or rebase `main` into the branch, resolve conflicts and
  run gates there, then merge the clean branch into `main`. Never resolve conflicts or
  repair the index in `main`; abort and redo the operation in the worktree.
- Never use `git stash`; use a throwaway branch commit instead. After an interrupted
  merge, verify `git rev-parse -q --verify MERGE_HEAD` and
  `git rev-list --parents -n 1 HEAD` before committing.
- Re-read `git status` and `git diff` before staging; other sessions may change `main`.

Four traps that cost real debugging time:

- **A worktree used to run no commit gate at all, silently.** `core.hooksPath` was `.husky/_` — a directory husky generates during `npm install` and keeps untracked — and git resolves a relative `core.hooksPath` against the root of the worktree it is running in. Every worktree made by `git worktree add` had no `.husky/_`, so git found no hook, ran nothing, and exited 0. The commit landed with no warning and nothing in its output to notice. 89 of 118 worktrees were in that state while 96 had a populated `node_modules`, so "just run npm install" was never the fix. `core.hooksPath` now points at `<common git dir>/hooks-gate`, which every worktree shares, and the tracked `.husky/pre-commit` is what runs. **If a hook ever stops firing, run `git config core.hooksPath` first and assume nothing.** Re-install with `npm install` (the `prepare` script).
- **A worktree on an older commit blocks with a specific message, not a mystery one.** Its `.husky/pre-commit` still sources husky's generated preamble, which only an install in _that_ worktree ever created. The dispatcher names the cause; bring the worktree up to date, or `git config --unset core.hooksPath`. It blocks rather than skipping on purpose: a gate that cannot run must not let a commit through.
- **`node_modules` is empty or missing in most worktrees.** Node walks up to the parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly what makes it misleading. Vite does **not** walk up: it serves only what `server.fs.allow` permits, so fonts, images and AVIF assets from the ancestor checkout 404 in a worktree and work in the root checkout. Run `npm ci` there before debugging an asset that will not load.
- **Every worktree's dev server wants :5173.** Locally `reuseExistingServer` is on, so `test:e2e` can attach to a server another worktree started and then test _that_ checkout. Use `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` in a worktree. "My change did nothing" in e2e is this, not a cache.

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

**`at-risk` also covers merged, clean worktrees protected by a curated finding.**
If `at-risk` and `mergedIntoMain` are both true, read the protecting entry's
`summary` and `note` before disposing of it.

**`mustNotPrune` vetoes `land` and `dispose`.** It records a human claim that the
worktree is not accounted for; every such entry must include a note explaining
what would be lost.

`readyToLand`, `disposalCandidates` and `atRisk` are named at the top of the
file so you do not have to filter the whole list to find them.

**`land` and `at-risk` are separate:** `land` is clean and mergeable; `at-risk`
requires preservation or human review.

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
`mergeConflict: null` with `mergeChecked: false` is the entire vocabulary. Treat
unknown as unknown and re-run the check yourself before acting on it.

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

`active` is never reported abandoned. `blocked` means a live machine is waiting
on a human, so answer it. `rejected-credits` is a caller bug caused by resolving
a paid model; there is no work to salvage. A missing worktree is `orphaned` and
belongs in the dead/unfinished views rather than being treated as finished.

### The READ audit: what the agents actually said, not what their shape implies

`WORKTREES.json` has computed `chats.byState` and observed `chats.read` views.
Never reconcile them: disagreement is the finding. `session.directory` is where
a chat opened, not necessarily where it worked; `board.agents` is the second
liveness signal; `in-use` uses either. An empty `chats.count`, empty
`board.agents`, or old timestamp means **unknown**, never "nobody worked there".
Treat `chats` as path history, not proof of work done there. Re-check read-derived
lists against the live tree before removing a worktree.

### The file is generated; the judgement is not

Anything git or the session database can answer is read fresh on every run.
Anything a human must decide lives in
`scripts/lib/worktree-inventory/curated.mjs` and survives regeneration. Curated
entries are not interchangeable: `polygon-marching-ants` has `mustNotPrune` and
a note but no `issues` or `landed`, while `ps-pixel-tools` has `issues` and a
claimed `landed` state. Read the source file rather than copying a prose example.

**When you create a worktree, add its entry in the same change.** A new
worktree with no curated entry still appears, with `summary: null` and
`summarySource: "none"`, and a test reads the real `git worktree list` and fails
on it — an undocumented worktree cannot be created quietly. An uncurated entry
is a worktree nobody has written down what it is for, which is how a
preservation branch gets mistaken for a disposable one.

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
- **Scrollbar tests cannot assert a painted scrollbar.** A gutter or edge screenshot can
  pass forever; assert `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight` on
  the outer wrappers instead. Write the overflowing-document control first. The full
  measurement lives in `e2e/no-document-overflow.spec.ts` and its `P2` handoff entry.
- **Left-rail geometry is a measured constant.** The canonical values live only in the
  header of `e2e/no-document-overflow.spec.ts`; they are font-metric dependent and not
  asserted, so do not copy them into another document.
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

The default headless e2e run must have **zero failures**; known failures are not
allowed. Produce counts from the suite rather than storing them here. If a dead
Vite server causes a wall of `ERR_CONNECTION_REFUSED`, rerun on a fresh
`PLAYWRIGHT_PORT` before treating the output as test failures.
Hooks use a shared common-git entry rather than a per-worktree husky directory;
`HUSKY=0 git commit` is the escape hatch.

- `.husky/pre-commit` runs `npm run gate:commit`; `.husky/pre-push` runs
  `npm run gate:push`. Keep each hook as a one-line wrapper over its package script.

- `test:e2e:unit` is a Node Vitest suite for e2e helpers, not a browser run or commit-gate step. It is the blocking `e2e-unit` CI job; run it when touching `e2e/`.
- The commit gate runs no app unit tests. Run `npm run test` on demand; `gate:push` runs the full suite.
- `*.{ts,tsx}` uses ESLint + Prettier; `*.{js,jsx,mjs,cjs,scss,css,jsonc,yml,yaml,md,json}` uses Prettier only. **Do not add ESLint for the latter group**: no config covers it, and doing so breaks Markdown/SCSS commits. `scripts/*.js` is in that second group.
- **`lint:check` lints `git ls-files`, not `.`.** Its extension lists live in
  `scripts/lint-tracked.js`; tracked images, `snippet.txt`, and `index.html` are
  deliberately excluded. Legacy files outside the linted set are not a problem.
- `--fail-on-changes --no-stash` leaves formatter fixes unstaged and blocks the commit; never allow hooks to rewrite the index. `--no-stash` is not optional: without it lint-staged keeps its backup stash every time it declines to revert, so each blocked commit leaves a `WIP on <branch>` entry behind.
- `build` is not redundant with `tsc`: `vite build` strips types without checking them, and it alone catches Sass, wasm, PostCSS, and import resolution. **No `lint:check` in any local gate**: locally, `lint-staged` covers the staged subset and nothing more, so a file already committed unformatted, a rule-changing branch switch, or a bad rebase surface in `ci` rather than at commit time.
- No coverage and no Playwright, at any local gate.

### `test:staged` is a command, not a gate

`npm run test:staged` runs the tests that transitively import the staged paths. It is
**deliberately not in the commit gate**; `npm run test` is the whole-tree check.

It cannot replace `npm run test`, catch a test that was already failing, or find
coverage gaps. A staged path with no importing test selects zero files and exits
zero. Keep the pipeline NUL-safe: `git diff --cached --name-only -z | xargs -0`.

### CI

- `ci`: lint, high-severity audit, typecheck, TS-project coverage assertion, coverage tests, build.
- `e2e-unit`: e2e helper tests and coverage.
- `e2e`: headless Playwright.
- **Dependency licences are not a gate.** The allow/deny list and the high-severity threshold are in `DEPENDENCIES.md`, enforced by nothing; `npm audit --audit-level=high` in `ci` is the vulnerability half and it does run.

**DO NOT WEAKEN A GATE TO GET GREEN: no skips, raised thresholds, deleted assertions, or re-recorded baselines.** Fix the defect or leave the recording decision to the operator.

## Definition of Done

**A TASK IS NOT DONE UNTIL THE WORK IS MERGED INTO `main` AFTER A THOROUGH CODE REVIEW. NOT "IMPLEMENTED", "COMMITTED", "PUSHED", "PR OPEN", OR "THE TESTS PASS".**

1. **Isolated**, according to the worktree policy above.
2. **Green locally**: `lint:check`, `tsc`, `build`, `test`; `test:e2e` when the change is user-visible, `test:e2e:unit` when it touches an e2e helper. "It was already failing" is a fact to report, not a reason to stop.
3. **Covered** by a test that fails without the change. A fix that cannot be pinned by a test is a fix that comes back.
4. **Documented**: handoff docs updated, and any new gate, test trap, or architecture boundary written down where the next agent looks.
5. **Reviewed by someone else**, thoroughly: the diff, the surrounding code, the tests, and its own load-bearing claim re-run. Not the author. A finding sends the task back.
6. **Merged into `main`** after review and passing gates.
7. **Reported as done**: what changed, what validation ran, what the review said.

- **A blocked merge is not done.** Operator decision pending, a defect the operator wants kept, a conflict that needs judgement: say so and name what is outstanding. Reporting "done" with an unmerged branch is the failure mode this section exists to prevent.

## E2E failures

- Read `e2e/OPEN_PROBLEMS.md` first. A new failure is a new defect.
- A pin/`expected-fail` is a tripwire for broken behavior; remove it in the same change that fixes the defect.
- Visual baselines re-record only with `npm run test:e2e:update-baselines`; `=all` is
  load-bearing because bare `--update-snapshots` resolves to inert `changed`. Green means
  pixels matched.
- The 100-pixel budget in `visual-regression.spec.ts` is a tripwire, not a tolerance. Do not
  widen `threshold` or `maxDiffPixels` to make a red go green — the argument for the numbers and
  for NOT pinning a Chrome version in CI is written out at that call site.
- `npm run test:e2e:clean` deletes the per-test output directories under `test-results/` and
  keeps `test-results/results.json`, so a run's machine-readable result survives it.
- Read failures from `test-results/`; `trace.zip` needs a window, so ask the operator.

## Handoff documents

`HANDOFF.md`, `TEST-FLAKES.md`, and `e2e/OPEN_PROBLEMS.md`: validated, actionable problems only. **NO changelog, completion notes, or status summaries.** Verify against the tree.

- **Route by scope.** `HANDOFF.md` is for history/replay and document-state defects. `TEST-FLAKES.md` is for test-infrastructure defects — flakiness, the pool, the runner, the gates themselves. `e2e/OPEN_PROBLEMS.md` is for Playwright. Do not file a gate or pool defect in `HANDOFF.md`; it is scoped, and a cross-scope entry is the one nobody reads.
- **Nothing durable goes in `.kilo/` or the swarm database.** Both are machine-local;
  findings belong in the scoped handoff documents. Close the swarm entry when its
  verified finding is deleted from the handoff.
- **Line-numbered handoff citations move with the file.** If a diff adds or removes
  lines above `file.ts:NNN`, re-derive every citation below it from the prose's claim.

**WRITE OR UPDATE THE HANDOFF WITHOUT ASKING** for every validated issue, strong recommendation, or durable finding. Ship it with the work.

### Lifecycle: entries die, they never get reworded

- **Verified fix: DELETE the entry.** Verification is another agent, review, or test, not the fixer's claim.
- **Never rewrite an open problem as closed.** Keep unverified work as the exact remaining verification; keep only test tripwires after a fix.

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
  - **The placeholder roster is seven, not eight.** Re-derive it with
    `grep -c "placeholderTool(" src/tools/toolsMap.ts` and the `placeholderNames`
    membership in `tool-processors.test.ts`.

**Tool specification:** `docs/TOOLS.md` is generated from
`src/tools/descriptions/*.ts` and `.notes.md`. Membership is Adobe-confirmed;
group order and separator placement are not. Keep that confidence split when
changing `toolbar-mapping.ts`.

**A tool named by a panel's title is not a tool.** Adobe's Clone Source is `Window ▸ Clone Source`,
a panel, not a Tools-panel entry. That is how it got into the list in the first place.

**Not tools, and not to be implemented as tools:** the foreground/background swatches, "Edit in Quick
Mask Mode", the three screen-mode toggles, the `…` Edit Toolbar caret, the toolbar grip, and the
Extra Tools container.

Add a tool only after updating every hand-written registry list, including
`dispatchTable`, `icons`, and `toolIcons.test.tsx`; see HANDOFF §68 for the
blast radius. Count the lists yourself rather than trusting a stale count here.
