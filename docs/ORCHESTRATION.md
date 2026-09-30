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
- **A `task` subagent inherits the caller's working directory, so the worktree has
  to exist before the fan-out and not after it.** `task` creates no session and no
  worktree, and `agent_manager`'s `mode: 'local'` deliberately runs in the caller's
  directory too. A root chat that fans out from `main` is therefore running N
  writers in `main`, and no `kilo.jsonc` permission can prevent it: tool
  permissions match a path glob and have no term for the working directory, so
  `src/foo.ts` is the same pattern in `main` and in `.kilo/worktrees/task`.
  Measured 2026-09-30 against the session database: **1398 `task` subagents ran
  with the main checkout as their directory in seven days**, and 22 Agent Manager
  `mode: 'local'` sessions were editing it in parallel. **Put the worktree path in
  the brief**, because a subagent's cwd only affects relative `bash` — its `edit`
  and `write` calls take absolute paths, so a brief that names the worktree is the
  thing that actually moves the work, and a brief that does not is a fan-out into
  whichever checkout the root chat happens to sit in.
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
  citation, a new `AGENTS.md` paragraph — every one is a tracked-file change and
  takes a worktree. Regenerating `WORKTREES.json` is the one exception, because
  it is untracked.

### The rule is enforced at the commit, not by the reader

`scripts/main-worktree-guard.mjs` runs first in `.husky/pre-commit` and refuses to
record a commit made from the main worktree. It names the worktree recipe and the
one override, so a refusal is a redirect rather than an obstacle: an agent that
meets a bare "no" commits anyway, from the same checkout, on a branch nobody made.
It is a program rather than another paragraph for the two reasons above — a
permission cannot see the working directory, and Kilo has no lifecycle hook that
could veto a write before it happens. The commit is the last moment the damage is
still free to undo, and the one moment git itself guarantees to run code in.
Ordering is load-bearing: it runs before `gate:commit` because that gate is
lint-staged plus `tsc -b` plus a build, and lint-staged rewrites staged files with
`--fix` before the commit is ever called illegitimate.

What it does **not** do is stop the write. It runs after the edit, so a session
that writes into `main` and never commits is not stopped by it. It converts "71
rogue commits nobody can attribute" into "a dirty tree the next `git status`
names" — the write side is the process rule above, and the guard is the floor
under it.

Three things stay allowed, each deliberately:

- **A landing.** `git merge` into `main` runs `pre-merge-commit`, and a
  fast-forward runs no hook at all, so the documented landing flow never reaches
  this file.
- **An operator hotfix the operator asked for on `main` by name** —
  `ALLOW_MAIN_COMMIT=1`, and only the exact value `1`, because a truthiness test
  would read `ALLOW_MAIN_COMMIT=0` as permission and turn a spelling that looks
  like a denial into a bypass.
- **A repository the guard cannot place.** Detection fails open and policy fails
  closed, because they are different questions: a git that will not answer is a
  broken environment, not a decision, and blocking there would trade a real gate
  for a phantom one.

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
- **`git add -A` in a worktree is not a neutral staging step when the root
  checkout is dirty.** The root is a _different checkout_ of a _different HEAD_,
  so a file the branch never touched can be sitting in the worktree's working
  tree with the root's older content, and `-A` commits it as a deliberate
  reverting of whatever main has since done to that file. A merge of
  `feature/polygon-marching-ants` shipped 17 such reverts — `AGENTS.md`,
  `docs/CODE-REVIEW.md`, and every file main had gained in the e2e-own-server
  work, 1,835 lines — and **not one of them was a conflict**, so the merge was
  clean and the revert was invisible in the diff. The tell is a file that gained
  or lost lines for no reason the branch explains.
  **The check, by computation rather than by reading the merge diff:**
  ```sh
  comm -13 \
    <(git diff --name-only "$(git merge-base main HEAD)"..<branch-tip> | sort) \
    <(git diff --name-only main..HEAD | sort)
  ```
  Anything that set difference is main content the merge had no business
  touching. The legitimate exception is the files the merge deliberately edits;
  anything else gets restored from main with `git checkout main -- <path>` before
  the merge lands. Run it _before_ the review, because a reviewer only catches
  the files its brief happened to mention.
- **A red `tsc` in the main worktree may be someone else's work in progress, not
  a broken `main`.** The main worktree is shared, so it is routinely holding an
  agent's half-written change: tests that import a symbol their branch has not
  written yet will fail `tsc` while `main` itself is perfectly green. That state
  blocks every commit made from the main worktree, because the commit hook runs
  `gate:verify` there — and the tempting "fix" is to commit the broken files.
  **Do not.** Read `git status --porcelain` first: a path you have not touched is
  not yours to stage, and its type error is not yours to resolve. Check whether
  the _committed_ state is green instead, in a throwaway worktree, and report the
  block:
  ```sh
  git worktree add --detach /tmp/verify-main main
  ln -s "$PWD/node_modules" /tmp/verify-main/node_modules
  (cd /tmp/verify-main && npx tsc -b && npx vitest run <suite>)
  git worktree remove --force /tmp/verify-main
  ```
  This happened on the commit that followed the fix above, and the same `git add
-A` also tried to sweep a third agent's in-flight tests into the commit — which
  is the previous bullet, one hour later, in the same worktree.
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
- **Every worktree's dev server wants :5173, and that used to be the reason e2e lied.** A bare
  `npx playwright test` in a worktree attached to whichever server got to :5173 first — another
  checkout — and passed for the wrong reason; `TEST-FLAKES.md` §10 is a mutation campaign that
  reported seven mutations green that way. **That is closed structurally now, and not by a lock:**
  `npm run test:e2e` runs `scripts/e2e-run.mjs`, which starts the run's **own** server on a port
  it picks, and `playwright.config.ts` sets `reuseExistingServer: false` as a literal with no
  environment variable and no field that can turn it on. A run either gets a server it started or
  it is red. `PLAYWRIGHT_REUSE_EXISTING_SERVER` is refused outright; `PLAYWRIGHT_BASE_URL` is
  refused unless the run says `E2E_ALLOW_REMOTE=1`, which it logs.
- **The e2e queue is `e2e/.swarm-e2e-runner`, and it is advisory — never a gate.** The run takes it
  so two agents rarely run e2e at once, and gives it back when it ends, including when the suite
  fails. It is a **virtual** path: it never exists on disk, so an agent editing `e2e/*.spec.ts`
  holds those files separately and does not collide with it.
  - **The holder is a RUN, not a branch.** Board identity is the branch and the conflict test is
    `lock.agent_id !== who` (`db.mjs:1130`), so a branch never conflicts with itself: with branch
    identity, two runs in one worktree both "acquire" and the second one's `unlock` releases the
    row the first still believes it holds. Every board call therefore passes
    `--agent e2e-run/<branch>/<pid>`, and `swarm status` shows that while a suite runs — the
    branch says which checkout, the pid says which process.
  - **A file lock is never renewed by the board** (`renewOwnClaims` touches only `claims`), so the
    wrapper renews on a timer, at a third of the lease and never more than every few minutes, and
    a renewal that fails is a _message_. A lost queue costs a concurrent run, not correctness: both
    runs have their own ports.
  - **Nothing here can fail a run.** Queue full, board unreachable, malformed lease: each logs and
    the run proceeds. Two earlier versions broke that: one exited 4 when it could not have the
    lock, which made an unenforceable mechanism into a hard block on a merge gate, and one threw
    from the lock's constructor for a bad lease — before the run had decided it wanted a lock at
    all, so `CI=true` with a typo in `E2E_LOCK_LEASE` died with no suite. The lock is now built
    only on the path that uses it, and a bad lease is reported and replaced.
  - **A holder this wrapper did not create is never reclaimed.** The reclaim unlocks AS the holder
    it is reclaiming, so a wrong liveness answer releases a real agent's slot. Board identity is
    the sanitized branch and `sanitize` preserves `/` (`scripts/lib/agent-board/identity.mjs:28`),
    so a holder on `fix/1234` — or anyone who passed `--agent 2026` — has an identity whose last
    segment parses as a pid. Only `e2e-run/<…>/<digits>` is probed. `E2E_SKIP_LOCK=1` (or `--no-lock`)
    skips the queue, and `E2E_LOCK_TIMEOUT`, `E2E_LOCK_POLL` and `E2E_LOCK_LEASE` tune the wait.
    **If a change ever makes an e2e run refuse to start because of this lock, the guarantee has
    been moved somewhere it cannot be kept.**
  - Each run also writes to `test-results/runs/<run-id>/` — Playwright deletes `outputDir` at the
    start of every run — and records the port it used to `.kilo/e2e-last-run.json`, so a run that
    fails an hour later is diagnosable from the port that served it. The HTML report is
    deliberately NOT isolated: the report-viewer npm script resolves `playwright-report`, and a
    per-run folder would leave it with nothing to open.

## The list of worktrees: `WORKTREES.json`

`WORKTREES.json` at the repository root is a generated inventory of every
worktree: its branch, how far it has drifted from `main`, whether that branch is
already landed, what the working tree holds that no commit does, which Kilo
sessions ran there, and which of those are unfinished, blocked or dead. **It is
regenerated, never hand-edited**, and it is the first thing to read before
deleting a worktree or starting one that may already exist. The list does not
belong in prose; regenerate it.

**It is UNTRACKED and gitignored, and that is a hard rule, not a convenience.**
Everything in it describes the machine that generated it — session ids, chat
ids, absolute worktree paths, swarm claims, a `generatedAt` timestamp — so a
tracked copy was a diff nobody could review and a conflict two agents could not
resolve: two regenerations five minutes apart collide, and neither side means
anything. `/WORKTREES.json` in `.gitignore` is enforced by
`worktree-inventory.test.mjs`, which fails if the file is tracked or if the rule
is deleted. **Do not commit it and do not re-add it**; a regeneration is
`node scripts/worktree-inventory.mjs` and nothing else. The generator, the
curated table and every finding stay tracked — only the output does not.

The consequence worth knowing: **a fresh clone has no inventory**, because
nothing regenerates it for you. Generate one before you read a worktree list, and
treat any `WORKTREES.json` you find as a claim about a moment rather than a
shared source of truth.

```bash
node scripts/worktree-inventory.mjs            # regenerate
node scripts/worktree-inventory.mjs --check    # exit 1 if stale OR absent, write nothing
node scripts/worktree-inventory.mjs --quiet    # totals only
```

**Read `action` first.** Every record carries one value, and it is the whole
answer — which of the six things it is:

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
worktree is not accounted for, and it is for a claim git cannot make about a
**clean** tree. Every such entry must include a note explaining what would be
lost. A merge recommendation is as much a claim about the contents as a prune
recommendation is, so a `land` entry carrying `mustNotPrune: true` is impossible
by construction.

**Do not flag a worktree for holding work on no ref — that case is derived.** A
branch at 0 ahead of main, already on it, with a dirty working tree is reported
`uncommitted-only` and is never prunable whatever the curated table says, and
`worktree-inventory.test.mjs` re-derives the set from the live worktrees and
asserts the generator's verdict on it. A flag on such an entry protected nothing
and went stale on its own: the moment its owner committed, the claim was false and
the list had to be re-derived by hand. Anything a human must decide lives in
`scripts/lib/worktree-inventory/curated.mjs` and survives regeneration. Curated
entries are not interchangeable: `tsc-guard` has a `note` but no `issues` and no
`landed`, while `paint-easy` carries an `issues` ref and a claimed `landed` state.
Read the source file rather than copying a prose example. **When
you create a worktree, add its entry in the same change** — an uncurated
worktree is one nobody has written down what it is for, which is how a
preservation branch gets mistaken for a disposable one.

`readyToLand`, `disposalCandidates`, `atRisk`, `readUnfinished`, `workOnNoRef` and
`readLostWorktree` are named at the top of the file so you do not have to filter
the whole list to find them, and `node scripts/worktree-inventory.mjs` prints the
first two before the evidence. `readLostWorktree` matters most of those: it is
the only list that names a session whose worktree was **deleted**, which no
computed signal can produce, and it cannot be derived from the worktree record it
used to live on — the loop that fills it only visits worktrees that still exist,
so it was structurally always false.

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

`WORKTREES.json` has computed `chats.byState` and observed `chats.read` views;
the observed one comes from `scripts/lib/worktree-inventory/chat-audit.data.json`,
where each record carries a `readState` (`struggling`, `blocked`, `abandoned`,
`failed`, `unknown`, `finished`), a `readRisk`, and a `note` — conclusions about
sessions, never their contents, so the file cannot leak what was said. Never
reconcile the two views: disagreement is the finding. `session.directory` is where
a chat opened, not necessarily where it worked; `board.agents` is the second
liveness signal and `in-use` uses either. **An empty `chats.count`, empty
`board.agents`, or old timestamp means unknown, never "nobody worked there".**
Re-check read-derived lists against the live tree before removing a worktree: a
read-derived count is a claim about a moment, which is why `workOnNoRef` carries
`stillOnNoRef`.

`chats.unfinished` holds **six** states (`chats.mjs:57-64`): `active`,
`abandoned-midflight` (a stale session whose last turn ended on a tool call),
`blocked` (waiting on a human answer), `died-at-birth`, `rejected-credits` and
`orphaned` (the worktree directory no longer exists). `chats.dead` holds the
subset that will never produce anything: `died-at-birth`, `rejected-credits` and
`orphaned`. **Count `rejected-credits` before blaming a branch for making no
progress** — it means a launcher resolved a bare model name onto a paid GPT id
and the subagent died at zero tokens, so the fix is in the caller and there is
nothing to salvage or redo. `active` is never reported abandoned: recency is
checked before the shape of the last turn, because a live machine's most recent
turn always ends in a tool call.

### Who wrote here, who read it, and who is writing now

`chats` is keyed on `session.directory` and is windowed, so it answers "who was
in this directory recently" and nothing more. The call history answers different
questions, and it is derived from the `part` table instead: the tool, the path it
named, and the time it happened
(`scripts/lib/worktree-inventory/writes.mjs`). It is in **three separate
structures, because they have three different lifetimes**:

| Field          | Tools                                           | Permanent?                     |
| -------------- | ----------------------------------------------- | ------------------------------ |
| `writeHistory` | `edit`, `write`, `apply_patch`, `notebook_edit` | **yes** — this is who built it |
| `readHistory`  | `read`, `grep`, `glob`, `semantic_search`       | **no** — releasable            |
| `shellHistory` | `bash`, `background_process`                    | no — the size of the gap below |

Reading a worktree is interest, not authorship: reviewers, explorers and
debugging agents all read directories they never touched, and a reader list that
only grows stops answering "who is looking at this" while still claiming to.
Keeping readers out of `writeHistory` is what makes the release possible — a
release that preserved writers by filtering a _merged_ list would have to remember
which entries were which, forever. Two lists need no memory.

**Releasing readers is a watermark, not an event.** `--release-reads` (optionally
`=<iso>`) sets `ownership.readsReleasedBefore`; a reader is emitted only when its
last read is newer than that mark. The mark is read back from the existing file
and combined with `Math.max`, so it only ever moves forward — a release cannot
silently undo itself on the next regeneration, and it keeps no record of which
entries it removed. Writers live in a different structure that nothing filters, so
a release cannot reach them. On a run with `--release-reads=2026-09-29` on this
repository: 407 readers became 139, and the 206 writers were unchanged.

**A write is a stronger ownership claim than a message**, so
`writeHistory.derivedChatIds` feeds the `in-use` verdict alongside the session and
board signals. A chat that edited files here twenty minutes ago owns the
directory even if it has been quiet since.

**The write count is not complete, and the file says so.** A shell changes files
with `sed -i`, a heredoc or `>`, and none of that appears in any tool's
arguments — 61,795 commands ran with a workdir inside a worktree on this
repository. `shellHistory.writeCapableCalls` is the size of that gap, not a count
of writes. Likewise `readHistory.unlocatedCalls`: 4% of greps and 66% of globs
record no path because they defaulted to the working directory, and they are
counted rather than dropped. Calls that belong to no known worktree are counted
**per kind** in `dataSources.calls`; a single mixed counter made the write total
meaningless the moment a second kind existed. There is deliberately no `sessions`
field — an earlier version reported every session on the machine, including the
ones that never wrote, under a key that said `writes`.

**A deleted worktree keeps its writers.** The registry loses a removed worktree,
but the `.kilo/worktrees/<name>/` segment survives in the recorded path, so its
history is reported under `goneWorktrees` at the top level rather than being filed
under the main checkout — which is what a prefix match does, because the main
checkout contains every worktree. It has to be a top-level list: the per-worktree
loop only visits worktrees that still exist.

**`ownership` at the top of the document is the liveness answer, and it carries
its own provenance.** `liveWriterCount` of zero is ambiguous between "nobody is
writing" and "every writer is dead", so `suppressed` and `reason` say which.
Generate with `--no-live-writers "<why>"` to declare a hard state — an editor
restart takes every chat with it, and the recency heuristics keep reporting an
owner for half an hour afterwards. The override is auditable rather than silent:
per worktree, `live` is the claim, `derivedLive` is what the signals said, and
`derivedChatIds` names the chats that were overridden. **No `project_id` filter is
applied when reading the session table**, deliberately: scoping to one project
dropped 30 sessions that had made 774 completed writes into this checkout, and a
writer that is absent is the one failure the structure cannot have.

**`landed: true` is a curator's claim**, printed next to git's answer as
`claimedLanded` against `mergedIntoMain`. A test re-derives it from
`git merge-base --is-ancestor` and fails when the two disagree.

**Never put a count in a summary.** `dirty`, `untracked`, `ahead`, `behind` and
`commitsAheadTruncated` are already on every record — describe WHAT a worktree
holds and leave the arithmetic to the generator. **Regenerate `WORKTREES.json`
when you add or remove a worktree**; a stale inventory is worse than none, and
`--check` names the per-worktree fields that drifted. There is no commit step —
the file is untracked — and that is the one thing `--check` no longer does for
you: it can no longer catch a collaborator's regeneration, because there is no
shared file left for a collaborator to regenerate.

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

There is no `swarm` binary: every command is `npm run swarm -- <command>`. The rest
of this file names subcommands bare for readability.

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
  `npm run swarm -- claim ph-12` holds it for 45 minutes, and every later command
  renews it automatically, because your worktree is still on disk. `swarm
heartbeat` still exists and is still correct — it is the only thing that can
  renew for an agent with **no worktree** (working on `main`, or detached).
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
  guard compares the string you pass, not who you are, so `npm run swarm -- close
<id> --agent somebody-else` closes an issue you resolved yourself. **Use `--agent`
  only to speak for a branch you actually are**, and never to close anything.
  Verified: `close` as the resolving agent exits 5; the same `close` with a
  different `--agent` exits 0. **The operator owns the decision on whether to
  close this, so it is filed, not fixed.**
- **`npm run swarm -- note` is how one agent addresses the swarm**; `npm run swarm
-- watch --follow` tails the same log. Every command appends to it, which is the
  replacement for N agents each writing their own account of the same work into a
  document nobody else can see until it is merged.
- **Exit codes are the interface:** 0 ok · 1 usage or error · 2 not found · 3
  claimed or not claimable · 4 file held by another agent · 5 self-verification
  refused.

It is a command, not a gate. Nothing in `.husky/` calls it, and no commit may be
blocked on it.

### Resource locking and releasing

The board at `.git/agent-board/board.db` tracks three resources: issue claims
(`claims`), file locks (`file_locks`) and agent presence (`agents`). All three are
keyed on `agent_id`, and `agent_id` is the **git branch** — `resolveIdentity`
prefers `AGENT_BOARD_AGENT`, then the branch, and nothing in this repository ever
sets that variable. Two sessions on one branch are the same agent to the board and
cannot deny each other a file.

**Liveness is recency only.** `agents.last_pid` and `session_id` are written and
never read — the one process-level signal the schema carries is consulted nowhere.
A timestamp that will not parse reads as **live**, on both the write side and in
`worktree-inventory/board.mjs:isLive`, because showing a lapsed claim beats hiding
a live one.

A **claim** renews itself: `renewOwnClaims` extends leases while the worktree
exists, and `autoSweep` renews before it sweeps, so a working agent's lease is
never the thing reclaimed. Renewal and release read the **same** row — both the
worktree in the claim itself, not the caller's. That is not a detail: identity is
the branch, so two agents on one branch in different worktrees share an
`agent_id`, and when renewal asked about the caller's worktree while `doctor`
asked about the row's, a live agent extended a dead colleague's lease and released
it in the same invocation. A claim recorded before a worktree was known still
renews, or the scoping would turn it into a countdown.

**A file lock has no renewal at all.** Every write to `file_locks` is an acquire,
a release, or the expiry sweep, so a lock is a hard `DEFAULT_LEASE_MS` (45 min)
TTL regardless of activity, and `doctor` — which runs on every command — strips an
expired one whether or not its holder is working. An agent holding a file longer
than that loses it silently and the next agent is granted it: the contention the
board exists to prevent, arriving by timeout rather than by decision. The log
shows the pressure, 456 `lock.hold` against 832 `lock.deny`. Renewing on worktree
presence is the obvious fix and the wrong one — a lock means _an agent is in this
file_, not _this branch owns this directory_, and worktree presence outlives the
session by days. Closing it needs an activity signal, not a longer timer.

Nothing is double-released: `releaseClaim` walks the `issue_locks` pairing table
so a file another live issue needs survives, and `ON CONFLICT(path, agent_id)`
makes re-acquiring your own lock extend it. The board is currently clean — zero
unreleased claims, zero unreleased locks — but that is agents releasing their own
work, not a sweep that could not have leaked.

### The board is cross-session, so a merge can announce itself

The database is global and **nothing in it is scoped to a session**: identity is
the git branch, and the `agents` table's `session_id` column records only the
first Kilo run to touch a branch and is never read back. So a `swarm note` from
one worktree is in the same log every other session's `swarm watch --follow`
tails. That is why these are not optional politeness:

- **Claim before the first edit**, not after: `npm run swarm -- claim <id> --files
<paths you will touch>`, or `npm run swarm -- hold <path>` for a path with no
  issue. Run `npm run swarm -- check <paths>` before you edit anything a brief, a
  handoff, or a sibling subagent names. `check` exits 1 on a path somebody else
  holds, and `claim`/`hold` exit 4; both name the holder.
- **Claim the merge, not just the files.** A branch that is about to land carries
  a hazard to every path in it, and no file claim expresses that. `npm run swarm
-- note` the branch and the paths _before_ you start resolving.
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
