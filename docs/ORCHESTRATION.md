# Orchestration: worktrees, the swarm board, and the worktree list

How concurrent agents stay out of each other's way. `AGENTS.md` keeps the
short form — create a worktree, one root agent per worktree, claim what you
touch — and this file is the detail behind it.

## Worktrees

**HARD RULE: 100% of work that changes a tracked file is done in its own
worktree under `.kilo/worktrees/`, on its own branch. The main worktree is for
reading and merging only.** There is no percentage carve-out and no "it's only a
comment" exception. The exceptions that remain are not a judgement call: a
read-only investigation that changes nothing, a single-line doc fix **the
operator explicitly asked for on `main`**, and a hotfix the operator asked for on
`main` by name.

- **Before editing tracked files, run `git rev-parse --show-toplevel`.** It is
  the only thing that distinguishes "I am in my worktree" from "I believe I am in
  my worktree". `main`'s checkout path is not proof — an Agent Manager worktree
  session, a `cd` in a previous tool call, or a session started in the root
  checkout and driven into a task worktree all leave you somewhere other than
  where you think.
- **One task = one worktree and one branch**, created **before** the first edit.
  Lowercase prefix (`fix/`, `feat/`, `e2e/`, `cleanup/`, `audit/`), for example:
  `git worktree add -b fix/task .kilo/worktrees/task`. A second worktree for the
  same task is a fork you reconcile by hand.
- **One writer per worktree; readers may share it.** A root-level agent is one a
  human started as a Kilo chat. Two of them never _write_ the same worktree, and
  one does not take over a worktree another is writing in. **Read-only agents may
  share a worktree freely** — inspecting, reviewing and auditing a worktree
  somebody else is working in is the common case and is safe. A reader must
  mutate nothing: no commit, `checkout`, `reset`, `npm install`, or worktree
  removal. Subagents are different again: a fan-out launched by one root agent
  works inside _that_ root's worktree and splits by file, which is the whole
  reason `task` exists.
  **The board cannot enforce this, and the reason matters.** Board identity is the
  git branch (`identity.mjs:43-47`), and `holdFiles` refuses only a _foreign_ lock,
  so two writers in one worktree are the same agent to the board: both holds are
  granted, and the file reads as uncontended. It is a discipline, not a lock.
  When two writers do collide in one worktree, neither sees it in the board — the
  symptom is a merge conflict or clobbered index, not a refusal.
- **Already compliant if the session you are running in IS a worktree** — an
  Agent Manager worktree session, or any checkout under `.kilo/worktrees/`. Never
  nest a second worktree inside one.
- **A doc-only change is not an exemption.** A comment correction, a stale
  citation, a new `AGENTS.md` paragraph, a regenerated `WORKTREES.json` — every
  one is a tracked-file change and takes a worktree.

### Landing

- **The main worktree is a landing, not a negotiation.** A branch merges into
  `main` only after `main` has already been merged or rebased **into the branch,
  in the branch's own worktree**, and the gates re-run there. The merge into
  `main` is then a fast-forward or a mechanical two-parent commit with nothing to
  decide. Merging a stale branch straight into `main` puts the conflicts in a
  shared checkout where every other session is committing.
- **Never resolve a conflict in the main worktree**, and never repair one there
  with `reset --hard`, `checkout --ours`/`--theirs`, `hash-object`, or
  `update-index`. The first two destroy another session's uncommitted work; the
  last two write an index entry no later `git status` reconciles. If a merge
  conflicts in `main`, `git merge --abort` and redo it in the worktree.
- **Never `git stash`.** It is a shared, unordered stack in the common git dir,
  so `git stash pop` in one worktree can pop another agent's stash — and the
  failure is silent in a way that is worse than a lost entry: `git stash push` on
  a CLEAN tree prints nothing, exits 0, and creates **no entry at all**, so the
  `pop` that follows takes `stash@{0}`, which is whoever pushed last. Use a
  worktree or a branch; if work must be set aside, `HUSKY=0 git commit` on a
  throwaway branch holds nothing but your own files. HANDOFF §69.
- **Stage only your own paths, everywhere.** The main worktree is not stable
  while you work — other sessions commit into it concurrently. Re-read `git
status` and `git diff` before staging.
- **After any interrupted or abandoned merge**, run `git rev-parse -q --verify
MERGE_HEAD` and `git rev-list --parents -n 1 HEAD` before committing. An
  interrupted merge can leave `AUTO_MERGE` and `MERGE_MSG` with no `MERGE_HEAD`,
  and `git commit` then lands a single-parent commit that reads as a resolution.

### Four traps that cost real debugging time

- **A worktree used to run no commit gate at all, silently.** `core.hooksPath`
  was `.husky/_` — a directory husky generates during `npm install` and keeps
  untracked — and git resolves a relative `core.hooksPath` against the root of
  the worktree it is running in. Every worktree made by `git worktree add` had no
  `.husky/_`, so git found no hook, ran nothing, and exited 0.
  `core.hooksPath` now points at `<common git dir>/hooks-gate`, which every
  worktree shares, and the tracked `.husky/pre-commit` is what runs. **If a hook
  ever stops firing, run `git config core.hooksPath` first and assume nothing.**
  Re-install with `npm install` (the `prepare` script).
- **A worktree on an older commit blocks with a specific message, not a mystery
  one.** Its `.husky/pre-commit` still sources husky's generated preamble, which
  only an install in _that_ worktree ever created. Bring the worktree up to date,
  or `git config --unset core.hooksPath`. It blocks rather than skipping on
  purpose: a gate that cannot run must not let a commit through.
- **`node_modules` is empty or missing in most worktrees.** Node walks up to the
  parent checkout, so `tsc` and `vitest` mostly work anyway — which is exactly
  what makes it misleading. Vite does **not** walk up, so fonts, images and AVIF
  assets from the ancestor checkout 404 in a worktree. Run `npm ci` there before
  debugging an asset that will not load.
- **Every worktree's dev server wants :5173.** Locally `reuseExistingServer` is
  on, so `test:e2e` can attach to a server another worktree started and then test
  _that_ checkout. Use `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` in a worktree.

## The list of worktrees: `WORKTREES.json`

`WORKTREES.json` at the repository root is a generated inventory of every
worktree: its branch, how far it has drifted from `main`, whether that branch is
already landed, what the working tree holds that no commit does, which Kilo
sessions ran there, and which of those are unfinished, blocked or dead. **It is
regenerated, never hand-edited**, and it is the first thing to read before
deleting a worktree or starting one that may already exist. The list does not
belong in prose; regenerate it.

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
Re-read `dirty` and `mergeConflict` before acting on a `land` you did not generate
yourself — and note that a worktree with **no liveness signal at all**
(`chats.count` 0 and `board.agents` empty) is the one most likely to have changed
since, because nothing here can see that somebody walked away from it.

**`at-risk` also covers merged, clean worktrees protected by a curated finding.**
If `at-risk` and `mergedIntoMain` are both true, read the protecting entry's
`summary` and `note` before disposing of it. **`land` and `at-risk` are separate:**
`land` is clean and mergeable; `at-risk` requires preservation or human review.

**`mustNotPrune` vetoes `land` and `dispose`.** It records a human claim that the
worktree is not accounted for; every such entry must include a note explaining
what would be lost. Anything a human must decide lives in
`scripts/lib/worktree-inventory/curated.mjs` and survives regeneration. Curated
entries are not interchangeable: `polygon-marching-ants` has `mustNotPrune` and a
note but no `issues` or `landed`, while `ps-pixel-tools` has `issues` and a claimed
`landed` state. Read the source file rather than copying a prose example.
**When you create a worktree, add its entry in the same change** — an uncurated
worktree is one nobody has written down what it is for, which is how a preservation
branch gets mistaken for a disposable one.

**"merges cleanly" is VERIFIED, not assumed.** `mergeConflict` comes from
`git merge-tree --write-tree`, which performs the merge in a scratch object store
and touches no working tree, index or ref. `mergeConflictFiles` names the files
that collide. It is `null` — never `false` — when the merge could not be
attempted, because an unknown is not a licence to land. **`mergeChecked: false`
means _no answer_, and does not say which of the two reasons applied; treat
unknown as unknown and re-run the check yourself before acting on it.**
`prunable: true` remains the strict disposal test: not the main worktree, the
branch is an ancestor of `main`, the tree is clean, and no curated finding
protects it.

### "0 commits ahead of main" is NOT evidence that a worktree is disposable

This is the single most expensive mistake available in this repository. A branch
created from `main` and never committed to reports **0 ahead**, is **an ancestor
of main**, and can be holding **uncommitted work that exists on no ref at all**.
`git status --porcelain` being non-empty is the only check that sees it. The
generator gives that shape its own status, `uncommitted-only`, and never calls it
prunable.

### What the chat columns do and do not tell you

`WORKTREES.json` has computed `chats.byState` and observed `chats.read` views.
Never reconcile them: disagreement is the finding. `session.directory` is where a
chat opened, not necessarily where it worked; `board.agents` is the second
liveness signal and `in-use` uses either. **An empty `chats.count`, empty
`board.agents`, or old timestamp means unknown, never "nobody worked there".**
Re-check read-derived lists against the live tree before removing a worktree.
`active` is never reported abandoned; `blocked` means a live machine is waiting on
a human, so answer it; `rejected-credits` is a caller bug, not work to redo.

**Never put a count in a summary.** `dirty`, `untracked`, `ahead`, `behind` and
`commitsAheadTruncated` are already on every record — describe WHAT a worktree
holds and leave the arithmetic to the generator. **Regenerate and commit
`WORKTREES.json` in the same change that adds or removes a worktree**; a stale
inventory is worse than none, and `--check` names the per-worktree fields that
drifted.

## The swarm board

It is called **`swarm`**, and that name is load-bearing. It used to be `board`,
which is the same word Kilo's built-in tool uses for something else entirely, and
the collision cost a real session. **Do not rename it back to `board`, and do not
add `board` as an alias** — an alias passes every behavioural test and restores the
exact confusion this name exists to prevent.

```bash
npm run swarm             # live state: who holds what right now
npm run swarm -- help     # the full command list
npm run swarm -- ready    # the work queue an agent picks from
npm run swarm -- watch    # the event log; --follow to tail it
npm run swarm -- health   # is this board being USED, or only carried?
npm run swarm -- doctor   # release claims from dead worktrees and expired leases
```

**There are two boards and they are not the same thing.** Kilo ships a built-in
tool called `board_read`, and it is empty _on purpose_: it carries messages
between one session and the task children it spawned, so outside a fan-out it
reports `messages: []` truthfully and knows nothing about this repository. The
swarm board is one SQLite file that every worktree of this repo shares, and it
is essentially never empty. **A `board_read` result is not evidence that nobody is
working** — it is evidence that no subagent posted.

**It is NOT the handoff documents.** `HANDOFF.md`, `TEST-FLAKES.md` and
`e2e/OPEN_PROBLEMS.md` stay the durable, reviewable record of what is known about
this codebase, written by hand and merged through a pull request. The board
answers the questions prose cannot: what is true _right now_, between concurrent
agents. `swarm import` copies the documents' items onto the board once, keyed on
their own numbering, so re-running files only what is new.

- **Where it lives:** `$(git rev-parse --git-common-dir)/agent-board/board.db` —
  the one path every worktree resolves to. `AGENT_BOARD_DIR` or `--dir` moves it.
  **It is machine-local and gitignored, exactly like `.kilo/`.** Nothing durable
  belongs only there.
- **You are your branch.** The default identity is the git branch, because one
  task is one worktree on one branch, and a branch is the same string across every
  command in that task. `--agent <id>` overrides it. A branch that is RENAMED
  mid-task leaves the old claim under a name nothing can reach (`doctor` will not
  help — the worktree and its lease are both fine), and a detached HEAD is
  identified by commit, so advancing the commit splits one agent into two. Working
  outside a dedicated worktree — on `main`, or detached — pass `--agent` or set
  `AGENT_BOARD_AGENT`, or you and the next agent are the same agent to the board.
- **A claim lives while your worktree does — there is no heartbeat to forget.**
  `swarm claim ph-12` holds it for 45 minutes, and every later command renews it
  automatically, because your worktree is still on disk. `swarm heartbeat` still
  exists and is still correct — it is the only thing that can renew for an agent
  with **no worktree** (working on `main`, or detached).
- **A claim whose worktree is gone is released by the next command from anybody.**
  The board renews your own claim **first** and sweeps **second**, and that order
  is the entire safety argument: renewing first means a working agent's lease is
  never what gets swept, so the sweep can only reclaim a claim whose worktree has
  vanished — which is exactly when reclaiming it is right. Running `doctor` itself
  on every open would hand a 45-minute timer the power to strip a lock off an
  agent mid-edit.
- **`swarm doctor` is EXEMPT from that sweep, and has to be.** It is the explicit,
  authoritative one, and the exemption is what keeps `swarm doctor --dry-run`
  meaningful: it is the command that answers _what is stale right now_, and a loop
  reads it.
- **Past the lease the issue is offered again**, and the takeover is in the event
  log with both agents named. `swarm status` reports; `swarm doctor` releases an
  abandoned claim, including one whose worktree no longer exists.
- **`swarm health` answers "is this thing being used, or only carried?"** It is
  the traffic mix, the locks, live vs expired claims, reclaims so far, live vs
  imported issues, and live findings idle for over six hours.
- **The traffic mix is in TWO UNITS, and adding them is a mistake.** `lock.hold` is
  **one event per command**, `lock.release` is **one event per file**. Read
  `activity.perCommand` and `activity.perFile` as two measures, never as two halves
  of one number, and take the lock count from the `file_locks` table, which is the
  only one of the three that counts the same thing twice. `health`'s `sweeps` is
  _reclaims made_, and reads 0 on a healthy board. **This is a file-lock manager,
  and the issue tracker is the part nobody uses.** Read that before building more
  of the issue tracker.
- **`swarm hold <path>` makes "never two agents on the same file" a refused
  write**, and the refusal names the holder. `swarm check <path>` exits 1 when
  somebody else holds it, so a shell can gate on it. `swarm claim --files a.ts b.ts`
  takes both, and gives back **only the ones it took** if the claim is then
  refused.
- **The fixer's claim is not its verification.** `swarm resolve` needs the live
  claim; `swarm close` refuses the agent that resolved the issue. Exit code 5 is
  that refusal. **There is no `--verified-by`**, and that is the point: a flag
  naming somebody else is a name the caller supplies about an agent that is not in
  the room. A reviewer closes an issue by being the reviewer.
- **`--agent <id>` is unauthenticated, and it DEFEATS the self-close check.** The
  guard compares the string you pass, not who you are, so `swarm close <id>
--agent somebody-else` closes an issue you resolved yourself. **Use `--agent`
  only to speak for a branch you actually are**, and never to close anything.
- **`swarm note` is how one agent addresses the swarm**; `swarm watch --follow`
  tails the same log. Every command appends to it, which is the replacement for N
  agents each writing their own account of the same work into a document nobody
  else can see until it is merged.
- **Exit codes are the interface:** 0 ok · 1 usage or error · 2 not found · 3
  claimed or not claimable · 4 file held by another agent · 5 self-verification
  refused.

It is a command, not a gate. Nothing in `.husky/` calls it, and no commit may be
blocked on it.

### The board is cross-session, so a merge can announce itself

The database is global and **nothing in it is scoped to a session**: identity is
the git branch, and the `agents` table's `session_id` column records only the
first Kilo run to touch a branch and is never read back. So a `swarm note` from
one worktree is in the same log every other session's `swarm watch --follow`
tails. That is why these are not optional politeness:

- **Claim before the first edit**, not after: `swarm claim <id> --files <paths you
will touch>`, or `swarm hold <path>` for a path with no issue. `swarm check
<paths>` before you edit anything a brief, a handoff, or a sibling subagent
  names. Both exit 1 on a path somebody else holds, and the refusal names the
  holder.
- **Claim the merge, not just the files.** A branch that is about to land carries
  a hazard to every path in it, and no file claim expresses that. `swarm note` the
  branch and the paths _before_ you start resolving.
- **A delivered note is a log write, not a delivery.** There is no recipient
  column, no wake and no activity notice: `note` is broadcast, and `comment <id>`
  needs an issue somebody filed. Put the fact where a running agent will meet it
  anyway — a claimed path it must `check`, and a `swarm note` naming its own files.
- **`board_post` is a different channel and it is not a substitute.** It reaches
  the sessions a fan-out spawned, so a post about work in a worktree usually has
  **no recipient in the room** and returns `total: 0, active: 0` with an explicit
  warning that nothing was delivered. Treat that response as the answer.
- **An unclaimed path looks free; claim or hold it before editing.** A held file is
  a queue, not a deadlock: do not edit it or wait on the lease. Note the file and
  change, hand it over, or work elsewhere and merge `main` in first.

### `ready` ranks in four steps, and the order is the contract

Priority first, because it is the one signal the filer stated on purpose. Then
live before imported: a `HANDOFF.md#31` row is prose the durable record already
owns, while a peer finding is the only thing on this board that exists _because_
two agents were working at once. Then startable before contended, since an issue
another agent is already inside its files cannot be picked up. Then oldest first.
Every run prints `N live · M imported from the handoff documents · K startable
now`, and `--live` drops the imports entirely.

- **`ready` is not a page of the import.** The limit is applied _after_ ranking.
- **The summary line is a human format, and it is not unconditional.** A run that
  finds nothing ready prints `nothing ready: everything open is claimed, blocked,
or closed` and **no counts at all**; `--json` emits `liveCount` / `importedCount`
  / `startableCount` as fields rather than prose. Match on the numbers, not the
  sentence.
- **`startable` means "live AND inside nobody else's files", and the zero case
  does not say which half failed.** Read the `N live` number before believing the
  sentence attached to `K`.
- **Filing an issue with `--files` TAKES those files for the filer.** A filer's own
  lock is deliberately not contention. Take the other agent's lock FIRST.
- **"Contended" and "claimed" are different axes, and both are filters.** `ready`
  drops a claimed issue entirely; `contended` means a _live lock held by an agent
  other than the one running `ready`_, on a path in the issue's file list. An issue
  can be unclaimed and still contended, and the reverse.
- **Provenance is read off the origin grammar**: `<file>.md#<number-or-slug>`. A
  live finding has no origin, or a free-text one. The pattern tolerates a path
  prefix on purpose — a stricter one would read `e2e/OPEN_PROBLEMS.md#p2-…` as
  live, which is the one answer that promotes a mirror to the head of the queue.

## Unexpected agent recovery

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
dead in Agent Manager/session state and no process is writing, release its claim
with `npm run swarm -- release <issue> --force --reason "agent died; worktree
inspected"`. Do not force-release a live lease merely because a network-lost
session is quiet.

Keep the worktree while salvaging uncommitted changes; never use `git stash`.
After preservation or discard, remove only an accounted-for worktree and refresh
`WORKTREES.json`. Put durable findings in the handoff documents and use `swarm
note` for the recovery event.
