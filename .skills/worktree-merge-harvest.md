---
name: worktree-merge-harvest
description: Land useful work from free worktrees onto main: establish ownership and net content, recover the requirement, review the candidate, sync it with current main, validate the final composition, and record whether work landed, was reimplemented, rejected, archived, or remains unresolved. Abandoned-worktree reclamation is the separate `stale-worktree-reclaim` skill.
---

# Worktree merge harvest

Land the work sitting on **free** worktrees of this repository onto `main`.

The opposite verb from `.skills/stale-worktree-reclaim.md`, and that document is
the place to go when the question is _can this be deleted_. This one is _can this
be landed_. The two share step 1's liveness half and nothing else; a harvest that
ends in `dispose` has answered the wrong question.

This document is the authoritative copy. `.kilo/skills/worktree-merge-harvest/SKILL.md`
is a loader that exists only because `.kilo/` is gitignored — if they disagree,
this file is right and the loader is a bug.

---

## Step 0 — the governing rule

**`main` is a landing, never a negotiation.**
Every other session in this repository commits into `main` while you work. A
harvest that stops to ask "is this right?" about `main`'s current shape has
started a second conversation, and the answer will be stale by the time it is
acted on. Bring the BRANCH to `main`, never the reverse: rebase or merge `main`
**into the branch**, in the branch's own worktree, and let `main` receive a
mechanical pinned merge commit prepared with `--no-commit --no-ff`. Every clean
merge in every worktree must use `--no-commit --no-ff` and then `git commit`,
because the direct merge hook cannot identify the incoming commit. Resolving a
conflict in the main worktree puts your resolution — an unreviewed, unattributed
one — into a shared checkout that other sessions are writing to.
Land one candidate at a time. Octopus merges record multiple incoming commits,
while the review pins identify one candidate; the helper and merge guard refuse
that shape before creating a commit.

The corollary that decides the whole sweep: **an `action: land` you did not
generate yourself is a claim about a moment.** `WORKTREES.json` is a snapshot
(`scripts/lib/worktree-inventory/assemble.mjs` — `buildInventory()` — stamps `generatedAt`), `main`
moves underneath it, and the `mergeConflict` answer in particular is the fastest
field in the file to go stale. Regenerate before you trust it, and re-read `dirty`
and `mergeConflict` before you act.

There is a second governing rule, and it decides how hard you try before you ask.
**Time and compute are effectively unlimited in this repository; the scarce
resources are autonomy and correctness.** Nothing in a harvest is to be
abandoned for being expensive, slow, or hard to establish. Escalating to the
operator is the last move on the board, not the first: it hands a decision to
somebody who cannot see the branch, the transcript, or the diff you can see, so
every question you ask instead of answering is one whose answer will be stale by
the time it is acted on.

**What makes the first rule enforceable is one layer down.**
`scripts/main-worktree-guard.mjs` runs from `.husky/pre-commit` and refuses
ordinary commits made from either the primary Git checkout or the designated
`main` branch worktree. The primary checkout remains protected when it has a task
branch checked out. A pinned landing is allowed only in the designated `main`
worktree: prepare it with `--no-commit --no-ff`, then use
`scripts/commit-reviewed-landing.mjs` with reviewed parent, tree, branch, and
chat pins. It commits a private index snapshot, and the guard compares `HEAD`, `MERGE_HEAD`,
and that staged tree. Direct self-committing merges are refused in every worktree; check for
`MERGE_HEAD` and abort only that refused attempt before retrying. Fast-forwards
also do not provide this check, so neither shape is a landing path. The pins are
an operator-supplied record of the reviewed candidate, not a cryptographic
approval token. The operator hotfix override remains `ALLOW_MAIN_COMMIT=1`, and
only the exact value `1`; an ordinary hotfix commit still needs its `Chat:` trailer.
The hook installer records the designated main worktree's private Git directory
and path in shared local Git config (`ph.mainWorktreeGitDir` and
`ph.mainWorktreePath`). The Git directory keeps the same checkout protected if
`HEAD` is detached or switched during a hook. If that private directory changes,
the saved path still protects a detached checkout there; it does not transfer
protection to a feature branch that reuses the path. A first install fails when
`main` is detached and no saved identity exists. A landing or hotfix still
requires `refs/heads/main` to be checked out.
A completed merge also fires `post-merge`, which
releases eligible board claims but cannot block the merge.
Everything else that changes a tracked file belongs in the branch's own worktree,
including a comment — and before you edit, `git rev-parse --show-toplevel` is the
only thing that distinguishes the worktree you are in from the one you believe you
are in.

---

## Step 1 — which worktrees are free, and which of them are landable

Regenerate. Never read the committed `WORKTREES.json`, and never hand-edit it —
it is a generated artifact and untracked, so an edit is lost on the next run.

```bash
cd <verified-task-worktree>
node scripts/worktree-inventory.mjs
npm run branches:orphan
```

The first report covers worktree-backed branches; the second covers branch-only refs. Classify
every orphan before ending the harvest. Use `--no-live-writers "<why>"` only when evidence shows
that every writer is gone and the inventory's recency heuristic alone is stale. An editor restart
may be that evidence only after confirming the writers are gone. The override is a declared hard
state, recorded in `ownership.suppressed`; it does not clear `derivedLive`, session or board
ownership, or make an active worktree safe to use.

Record each action's `generatedAt`, `mainHead`, exact `absolutePath`, branch and HEAD, ownership
evidence, staged/unstaged/untracked state, and nested-worktree state. These are snapshot facts;
regenerate after acting and use the post-action inventory to report what remains.

Read the top-level answers before the table:

| Field                       | What it means for a harvest                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `readyToLand`               | names only. The fastest-decaying answer in the file; regenerate and confirm before acting                                                   |
| `atRisk`                    | `action: at-risk` — needs a human. Not a harvest target; see the Never list                                                                 |
| `goneWorktrees`             | **deleted** worktrees and who wrote in them. Nothing to land — the work is on a ref or gone. Listed so a harvest does not go looking for it |
| `ownership.liveWriterCount` | chats with activity inside the liveness window. **Non-zero means the sweep is not safe to run unattended**                                  |
| `totals.inUse`              | worktrees with a live writer. Leave them alone                                                                                              |

Per worktree, the fields that decide:

- **`action`** — `land` is the target. The values are `land`, `at-risk`,
  `dispose`, `legacy`, `in-use`, `keep`, `undecided`
  (`ACTION` in `scripts/lib/worktree-inventory/classify.mjs`).
- **`writeHistory.chatCount`** — who wrote a file here, **ever**. This is the
  freedom check that `chats` cannot do. `chats` is keyed on
  `session.directory`, which is where a chat OPENED
  (`auditChats()` in `scripts/lib/worktree-inventory/chats.mjs`): a main-checkout chat that
  drove into a worktree is booked against main for its whole life, and the
  worktree reads as untouched. `writeHistory` is derived from the write calls
  themselves, so it catches that case. **`writeHistory.chatCount === 0` on a
  branch with commits means the work landed under another chat's name, or by a
  shell — read `shellHistory` before concluding nobody was here.**
- **`writeHistory.activeNow` / `ownership.derivedLiveWorktrees`** — somebody is
  in there right now. Not a harvest target.
- **`mustNotPrune`** — a human claim that something unaccounted-for is in that
  directory. It is a **veto on merging**, not only on pruning
  (`classify()` in `scripts/lib/worktree-inventory/classify.mjs`): a clean
  `mergeConflict: false` does not outrank it. Read the `note` before merging, not
  after. `curatedFor()` is in `scripts/lib/worktree-inventory/curated.mjs`.
- **`dirty` / `untracked`** — uncommitted work is on NO ref. It is the first
  thing to be lost and the last thing git can find. A worktree with
  `dirty > 0` needs its contents committed or saved **before** the merge, not
  after. **`uncommitted-only` is derived, and it is never prunable.** A branch at
  0 ahead of `main`, already on it, with a dirty tree is that status whatever the
  curated table says, and `worktree-inventory.test.mjs` re-derives the set from
  the live worktrees to keep it that way. **Never put a count in a summary**:
  `dirty`, `untracked`, `ahead`, `behind` and `commitsAheadTruncated` are already
  on every record, and prose arithmetic goes stale the moment `main` moves.
- **`mergeConflict` / `mergeConflictFiles`** — and remember `mergeChecked: false`
  means _no answer_, never "clean" (`classify()` in `classify.mjs`).
- **`mergeResultMatchesBase`** — `true` means the conflict-free merge adds no tree
  content, `false` means it adds content, and `null`/unchecked is not an answer.
  This is a point-in-time result against `mainHead`; regenerate if `main` moves.
- **`summary` / `note` / `issues`** — the curator's claim about the branch. The
  `claimedLanded` / `mergedIntoMain` pair is asserted to agree by a test, so a
  stale `landed: true` fails the suite rather than quietly contradicting git.

Then prove the branch is actually unlanded, because the file can be wrong. Use the
`mainHead` from that inventory snapshot, and regenerate if `main` moves:

```bash
WORKTREE="<absolutePath-from-the-fresh-inventory>"
MAIN_SHA="<mainHead-from-the-fresh-inventory>"
BRANCH="<branch-ref>"
git -C "$WORKTREE" rev-parse --show-toplevel
git cherry "$MAIN_SHA" "$BRANCH"        # patch-level absorption
git log --oneline "$MAIN_SHA..$BRANCH"  # commits reachable only from the branch
MERGE_TREE=$(git -C "$WORKTREE" merge-tree --write-tree "$MAIN_SHA" "$BRANCH")
MAIN_TREE=$(git -C "$WORKTREE" rev-parse "$MAIN_SHA^{tree}")
```

Compare `MERGE_TREE` with `MAIN_TREE`. An equal tree means there is no content to land even if
`git log` or `git cherry` reports unique commits. A conflict, invalid result, or unknown
`mergeResultMatchesBase` is not a clean answer; stop and investigate.

---

## Step 2 — what the branch was actually for

**Read the chats, not the commit subjects.** A commit subject is a summary of a
line of work; the requirement that forced the line is in the transcript, and it
is the only thing that tells you whether the branch is finished.

`WORKTREES.json` hands you the ids in one step:

```bash
cd "<verified-task-worktree>"
node -e '
  const d = require("./WORKTREES.json");
  const w = d.worktrees.find((x) => x.name === process.argv[1]);
  console.log(JSON.stringify({
    summary: w.summary, note: w.note, mustNotPrune: w.mustNotPrune,
    status: w.status, action: w.action, ahead: w.ahead, dirty: w.dirty,
    writers: w.writeHistory.chats.map((c) => ({ id: c.id, title: c.title, calls: c.calls, last: c.lastAt })),
    shell: w.shellHistory.chatCount,
  }, null, 2));
' "<worktree-name>"
```

Then read the transcript with the history tools, in this order:

1. `kilo_local_recall` with `mode: "read"` and the session id. It returns the
   full conversation, which is where the requirement is stated.
2. `kilo_local_recall` with `mode: "search"` on the branch name, to find the
   subagents — a subagent's findings are frequently the only record of why a
   design is shaped the way it is.
3. `sqlite3 ~/.local/share/kilo/kilo.db "SELECT id, parent_id, title, time_updated FROM session WHERE directory = '<abs worktree path>' ORDER BY time_updated DESC LIMIT 20"`
   for the family walk, when the recorded ids look thin.

**The recorded ids are a starting point, not the boundary of the search.** Both
`writeHistory` and `chats` are derivations — one from the tools that wrote, one
from the directory a chat _opened_ in — and the requirement was often stated in a
chat neither recorded: the operator's turn in a main-checkout session, a sibling
task on the same files, a subagent's brief. So when the recorded ids do not
produce the requirement, search the whole project's session history:
`kilo_local_recall` with `mode: "search"` on the **file names, the tool names and
the phrases in the diff** — not only on the branch name, which is the one query
the inventory has already answered. Read the ids it returns with `mode: "read"`;
that is the follow-up, not the search. **An empty result is a fact about your
query, never evidence that nobody ever asked for it** — and the searches that came
back empty belong in the harvest record, because the next sweep will repeat them.

What to extract, and why each matters:

- **The original ask.** The first user turn in the root chat. Landing a branch
  that solved a superseded problem is worse than not landing it.
- **Anything the chat explicitly deferred.** A commit whose message says
  "follow-up" and whose follow-up was never done is a partial landing, and it
  must be landed AS a partial landing — with the remainder in `HANDOFF.md`, not
  quietly dropped.
- **Decisions already made and reversed.** A chat that tried an approach, rejected
  it, and implemented the opposite leaves both in the transcript. Landing only the
  final state without knowing the rejected attempt is how a future agent
  re-litigates a settled question.
- **Whether the chat thinks it finished.** A chat that ended on a tool call
  (`chats.unfinished`, state `abandoned-midflight`) stopped mid-flight, and its
  worktree is exactly the case this skill exists for.

`readState` from `chat-audit` is a second, independent view of the same sessions.
Never reconcile it with your own reading: **disagreement is the finding.** A
computed "finished" beside a read "struggling" is the case to investigate, and
collapsing the two hides it.

---

## Step 3 — what the branch actually does

Read the diff. Not the stat — the diff. A harvest that lands on the strength of a
commit log has not read the code it is about to put on `main`.

```bash
WORKTREE="<absolutePath-from-the-fresh-inventory>"
MAIN_SHA="<mainHead-from-the-fresh-inventory>"
BRANCH="<branch-ref>"
git -C "$WORKTREE" diff "$MAIN_SHA...$BRANCH" --stat
git -C "$WORKTREE" diff "$MAIN_SHA...$BRANCH" -- "<path>" # per file, actually read it
```

Then the sweep that a diff cannot give you, and the one that catches the defect
this repository keeps producing:

```bash
# What main changed in the same files, since the branch forked.
git -C "$WORKTREE" diff "$BRANCH...$MAIN_SHA" --stat
```

A branch that edited a file which also moved on `main` is a branch whose
behaviour after the merge is the _composition_ of two changes neither author
tested. Compute that set-difference, and read every file in it. Silent reverts
live there: a merge that resolves cleanly and drops one side's change has no
conflict marker, a green `tsc`, and a passing suite.

If the intersection is non-empty and the two changes touch the same behaviour,
**stop and escalate.** This is a `hard-merge` situation — see
`.skills/hard-merge.md`, which arbitrates every conflict against Photoshop and
the web platform rather than against the hunk, and recovers requirements from
history rather than from the branch name. Do not pick a winner by diff size.

**Escalating is the last resort, and the effort that precedes it is not optional.**
A hard problem is an instruction to dig, not to ask. If the requirement is still
unclear after step 2, spend the next hour on it: more transcripts, the sibling
sessions that touched the same files, the branch's own earlier commits, the
handoff documents. Only when that is genuinely exhausted — and only when what
remains is a decision about **intent** rather than a fact you could have found —
does the question belong to the operator. Escalating something you could have read
is the same failure as landing a branch you did not read.

**When the diff does not explain itself, the reference implementation does, and it
is one search away.** This repository is a Photoshop clone, so the authoritative
answer to what a transform selection should do when a modifier is held is Adobe's
own documentation — not the commit message, and not your recollection. Web search
the feature's **industry best practice** (what Krita, Affinity, GIMP and the
platform HIG do) alongside Adobe's page for the feature, and gather the platform
contract the same way step 4 does: as an input you hand a reviewer _instead of_ the
author's justification. A branch that contradicts the documented platform behaviour
is a finding, not a merge conflict, and it is far cheaper to find here than after it
has landed.

---

## Step 4 — independent review

### Claim the paths before you touch them

`npm run swarm -- claim <id> --files <paths you will touch>` or `npm run swarm
-- hold <path>`, and `npm run swarm -- check <paths>` before editing; `claim` and
`hold` exit 4, `check` exits 1, and both name the holder. Before syncing or landing,
`npm run swarm -- note` the candidate branch and paths. File claims coordinate
writers; they are **not** a lock on `refs/heads/main` and do not serialize main
landings. A held file is a queue, not a deadlock: do not edit it and do not wait on
the lease. An unclaimed path looks free, not safe.

Identity here is the git branch, so **the board cannot enforce one writer per
worktree**: two writers in one worktree are the same agent to the board, both holds
are granted, and the collision surfaces as a conflict or a clobbered index rather
than a refusal. It is a discipline. Your step-4 reviewers are read-only agents and
may share a worktree freely — inspecting somebody else's worktree is the common case
— but a reader mutates nothing: no commit, `checkout`, `reset`, `npm install`, no
worktree removal.

One trap while you are here: Kilo's built-in `board_read` is **not** this board. It
carries messages between one session and the task children it spawned, so outside a
fan-out it reports `messages: []` truthfully, and `board_post` usually returns
`total: 0, active: 0`. **Neither response is evidence that nobody is working.** The
board is `npm run swarm`, its name must not be reverted to `board`, and it is a
command and not a gate: nothing in `.husky/` calls it and no commit may be blocked
on it.

Review the diff **before** merging, and make the reviewers genuinely independent
of the chat that wrote it.

- **How many:** follow `AGENTS.md` and `docs/CODE-REVIEW.md`: one fresh read-only
  review for non-trivial changes, two independent reviewers for cross-module or
  high-risk changes. A stale review does not cover a changed candidate tree.
- **Independence means:** a fresh context that has not read the implementing
  chat's reasoning. Give the reviewer the diff, the requirement from step 2, and
  the platform contract — **not** the author's justification. A reviewer told
  "this is needed because of X" stops looking for X.
- **Model and permissions:** follow current `AGENTS.md` and `MODELS.md`; do not
  copy a provider/model from an old transcript. Reviewers are read-only and receive
  the branch's absolute worktree path. They review the pinned candidate SHA, not a
  moving branch name, and do not use the main checkout as their working directory.
- **Tell them what to return:** `file:line` for every finding, with the evidence
  they got it from. A claim without a line number is not a review, it is an
  opinion. Ask for candidate results _and_ how they obtained them.
- **What to ask for, in this order of value:** (a) does it do what step 2 said it
  was for, including the parts nobody committed; (b) what did it break that the
  diff does not show — silent revert candidates from step 3, a gate that now
  passes something it should not; (c) is the test coverage real, or does it assert
  nothing (a test that cannot fail is worse than no test, because it reads as
  coverage); (d) platform fidelity, for anything user-visible.

**When reviewers disagree:** do not average them, and do not let the louder one
win. Take the specific, reproducible claim — a `file:line` with a failure you can
reproduce — over the general one, and reproduce it yourself before acting. If both
claims survive reproduction, that is a decision about intent, and intent belongs
to the operator: write the question into a file and say so in your final message,
rather than deciding it silently in a commit.

**Act on the findings before merging, not after.** A review finding fixed after
the merge is a change on `main` that no worktree owns and no branch explains.

---

## Step 5 — pass the gate

Run from the **branch's own worktree**, and note that most worktrees have no
local `node_modules`. Node walks up to the ancestor checkout, so `tsc` and
`vitest` work anyway — which is exactly what makes it misleading. Vite does
**not** walk up: fonts, images and AVIF assets 404 in a worktree and work in the
root checkout. If an asset will not load, `npm ci` in the worktree before
debugging the code.

```bash
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<name>
npm ci                    # only if an asset failed to load
npm run tsc               # the ONLY trustworthy typecheck
npm run build
npm run test              # pool: 'vmThreads', maxWorkers: 4
npm run test:e2e          # headless; starts its own dev server on its own port
```

- **`npm run tsc` is not `npx tsc --noEmit`.** `tsc -b` covers
  `tsconfig.app/node/e2e.json` and therefore the specs and test files. The
  `--noEmit` form resolves the root solution stub and type-checks ZERO files; it does
  not fall back to the app config, and `tsconfig.app.json` has no `exclude`, so it
  pulls `src/**/__tests__` in anyway.
- **`npm run test:e2e` only where the change is observable in a browser.** A
  change to a script or a stylesheet does not need a seven-minute suite; a change
  to a tool, a panel, or anything with pixels does. Say which you ran and why.
- **Never open a browser window.** Not `--headed`, not `--ui`, not `--debug`, not
  `PLAYWRIGHT_ALLOW_HEADED`, not `show-report`/`show-trace`/`codegen`. A headed run
  fails a _disjoint_ set of tests, so a failure that "goes away headed" is not
  fixed, it is re-routed. A failure that only reproduces visually is the
  **operator's** call: report it and stop.
- **Read a failure from disk.** `screenshot: 'only-on-failure'` puts a PNG in the
  failing test's `outputDir` under `test-results/`. The `list` reporter on stdout
  is the pass/fail record. A trace needs the trace viewer, which is a window.
- **A failure here may not be this branch's fault.** Check whether the same test
  fails on `main` before attributing it. A pre-existing red that this branch did
  not cause is a finding to report, not a reason to block the harvest — and never
  a reason to fix it inside this branch, which would land an unrelated change
  under this branch's name. **Check the _committed_ state of `main`, not the working
  tree you are looking at**: the main worktree is shared and is routinely holding
  another agent's half-written change, so a red test there is often a WIP rather
  than a broken `main`.

  Use the **clean committed-main baseline** recipe in `docs/ORCHESTRATION.md`.
  It creates a named scratch branch under `.kilo/worktrees`, records the exact
  main SHA, uses project `npm run` gates, and routes disposal through
  `npm run dispose`. Never use a detached worktree or `git worktree remove --force`.

  A path you did not touch is not yours to stage, and its type error is not yours
  to resolve.

**Never weaken a gate to get green.** No skips, no raised thresholds, no deleted
assertions, no re-recorded visual baselines. Each is either a real defect with a
named fix, or a recording decision that belongs to the operator. A gate that
passes because it was loosened is a gate that has stopped answering.

If a test pins behaviour that is genuinely obsolete, the fix is to change the
product and the pin **in the same change**, and to say so in the commit. If the
pin asserts something still true, it stays.

---

## Step 6 — land, delete, record

Only here, and only for branches that came through steps 1–5.

```bash
TASK_WORKTREE="<absolute path of this coordinator's task worktree>"
WORKTREE="<absolutePath from the fresh inventory>"
MAIN="<path paired with branch refs/heads/main in git worktree list --porcelain>"
BRANCH="<source branch name>"
CHAT_PHRASE="<distinctive phrase copied verbatim from the current user request>"
# Resolve CHAT_ID with the current host's instructions in docs/CHAT-ID.md.
# Use session:id only when this conversation is running in Kilo.
CHAT_ID="<verified native session ID>"
test -n "$CHAT_ID"

# If the candidate has local edits, inspect every staged, unstaged and untracked path first.
# Save only paths proven to belong to this harvest, on this branch, before merging main.
git -C "$WORKTREE" status --short

# Pin the local main ref and bring that exact commit into the candidate worktree.
BASE_MAIN_SHA=$(git -C "$MAIN" rev-parse refs/heads/main)
SYNC_MESSAGE=$(printf 'Sync main into %s for harvest\n\nChat: %s' "$BRANCH" "$CHAT_ID")
git -C "$WORKTREE" merge --no-commit --no-ff "$BASE_MAIN_SHA"
# If this merge conflicted, resolve and inspect the resolution only in this candidate worktree.
git -C "$WORKTREE" commit -m "$SYNC_MESSAGE"

# After the sync merge is resolved and committed, pin the exact candidate tree for review and gates.
REVIEWED_MAIN_SHA="$BASE_MAIN_SHA"
REVIEWED_CANDIDATE_SHA=$(git -C "$WORKTREE" rev-parse HEAD)
REVIEWED_TREE=$(git -C "$WORKTREE" rev-parse 'HEAD^{tree}')
git -C "$WORKTREE" status --short
```

Follow `docs/CHAT-ID.md` for the current host. Verify the selected session is this current
conversation. Copy a phrase from the current user's request, not a branch name or generic project
phrase; if the ID does not identify this chat, stop rather than recording a sibling session's
trailer.

Run steps 3–5 on `REVIEWED_CANDIDATE_SHA` and `REVIEWED_TREE`, after the main sync. A sync that
changes the tree is a new composition and gets a new review and full gate run. After reviewers and
gates finish, prove nothing moved:

```bash
test "$(git -C "$WORKTREE" rev-parse HEAD)" = "$REVIEWED_CANDIDATE_SHA"
test "$(git -C "$WORKTREE" rev-parse 'HEAD^{tree}')" = "$REVIEWED_TREE"
test -z "$(git -C "$WORKTREE" status --porcelain)"
test "$(git -C "$MAIN" rev-parse refs/heads/main)" = "$REVIEWED_MAIN_SHA"
git -C "$WORKTREE" merge-base --is-ancestor "$REVIEWED_MAIN_SHA" "$REVIEWED_CANDIDATE_SHA"
MERGE_TREE=$(git -C "$MAIN" merge-tree --write-tree "$REVIEWED_MAIN_SHA" "$REVIEWED_CANDIDATE_SHA")
MAIN_TREE=$(git -C "$MAIN" rev-parse "$REVIEWED_MAIN_SHA^{tree}")
test "$MERGE_TREE" = "$REVIEWED_TREE"
test "$MAIN_TREE" != "$MERGE_TREE"
```

Immediately before the landing, run the fresh gates from the coordinator worktree and inspect every
reported operation, claim, and owner. Leave unrelated operations untouched; an operation or dirty
state in `MAIN` or `WORKTREE` is a stop. Re-read the main worktree status and ref:

```bash
(cd "$TASK_WORKTREE" && npm run repo:state)
(cd "$TASK_WORKTREE" && node scripts/worktree-inventory.mjs)
(cd "$TASK_WORKTREE" && npm run branches:orphan)
(cd "$TASK_WORKTREE" && npm run swarm -- status)
(cd "$TASK_WORKTREE" && npm run swarm -- doctor --dry-run)
git -C "$MAIN" status --short
test -z "$(git -C "$MAIN" status --porcelain)"
test "$(git -C "$MAIN" rev-parse HEAD)" = "$REVIEWED_MAIN_SHA"
MERGE_MESSAGE=$(printf 'Merge %s into main\n\nBranch: %s\nChat: %s' "$BRANCH" "$BRANCH" "$CHAT_ID")
git -C "$MAIN" merge --no-commit --no-ff "$REVIEWED_CANDIDATE_SHA"
```

If the merge reports a conflict or `git status` shows unmerged paths, abort this exact merge and
resync in the candidate worktree. Never resolve it in `main`. Continue only when the prepared
merge has no unmerged paths and its actual `MERGE_HEAD` is `REVIEWED_CANDIDATE_SHA`.

If the candidate adds or changes a Git hook, refresh the shared dispatchers from the candidate
worktree now, after the clean merge has made the hook file available in `MAIN` and before the
landing commit. Verify the new dispatcher exists. If a non-main linked worktree has not synced
the tracked hook yet, the shared dispatcher runs the designated main checkout's current final
guard with that linked worktree as its Git context. The shared pre-commit entry records pending
merge identity so `prepare-commit-msg` cannot erase Git's merge markers and skip the final
takeover check, and the final index tree must still match the one approved by pre-commit.

```bash
(cd "$WORKTREE" && node scripts/install-git-hooks.js)
test -x "$(git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir)/hooks-gate/commit-msg"
```

Then commit the prepared result:

```bash
(
  cd "$MAIN"
  KILO_EXPECTED_MAIN_SHA="$REVIEWED_MAIN_SHA" \
  KILO_EXPECTED_INCOMING_SHA="$REVIEWED_CANDIDATE_SHA" \
  KILO_EXPECTED_TREE_SHA="$REVIEWED_TREE" \
  KILO_EXPECTED_BRANCH="$BRANCH" \
  KILO_EXPECTED_CHAT_ID="$CHAT_ID" \
    node scripts/commit-reviewed-landing.mjs -m "$MERGE_MESSAGE"
)
```

The `--no-commit` merge leaves `MERGE_HEAD` available to `pre-commit`. The landing script snapshots
the prepared index so another process staging files in the shared main worktree cannot change the
commit tree after the final hook check. It also writes a private workflow marker for that
snapshot. The marker helps catch accidental alternate-index use; it is not an authentication
boundary against a same-user caller deliberately constructing the environment and marker.
The main-worktree guard allows that commit only when `HEAD`, `MERGE_HEAD`, the snapshot tree,
marker, source branch, and chat ID match the reviewed record. The helper requires exactly one
matching `Branch:` and `Chat:` trailer and verifies that the source branch still points at the
reviewed candidate SHA. The `commit-msg` hook repeats the snapshot checks and checks the final
message after `prepare-commit-msg` has run. Then `scripts/merge-takeover-guard.mjs` checks the
prepared tree for lost work. If the merge conflicts,
do not resolve it in `main`; abort the operation this command started and resync in the candidate
worktree. The pre-merge hook refuses every direct self-committing merge, without relying on
`GIT_REFLOG_ACTION` or Git-version-specific `MERGE_HEAD` timing. Do not substitute a branch name,
fast-forward, squash, `--no-verify`, or the old `--ff-only || git merge` fallback.

After the merge, verify the recorded parents, tree and trailers:

```bash
git -C "$MAIN" rev-parse HEAD^1
git -C "$MAIN" rev-parse HEAD^2
git -C "$MAIN" rev-parse 'HEAD^{tree}'
git -C "$MAIN" show -s --format=%B HEAD
```

The first parent must be `REVIEWED_MAIN_SHA`, the second `REVIEWED_CANDIDATE_SHA`, and the tree
must equal `REVIEWED_TREE`; the message must contain both `Branch: $BRANCH` and `Chat: $CHAT_ID`.
If the merge or guard refuses, inspect `repo:state`. Abort only an operation this command started,
whose `MERGE_HEAD` is the pinned candidate and which has no manual resolution; if ownership or
state is unclear, stop and leave it untouched. Never resolve a conflict in `main`.

- **Re-read `git status` and `git log --oneline -10` immediately before staging,
  every time.** Other sessions commit into `main` concurrently, and `git add -A`
  in the main checkout will stage their work under your commit message.
- **`git add -A` in a worktree is not a neutral staging step either, and this is
  the more expensive of the two.** The root is a _different checkout_ of a
  _different HEAD_, so a file the branch never touched can be sitting in this
  worktree's tree holding main's older content, and `-A` commits it as a deliberate
  reverting of whatever `main` has since done to that file. One merge shipped **17
  such reverts** and not one of them was a conflict, so the merge was clean and the
  revert was invisible in the diff. Step 3 of the block above computes the set;
  run it **before** step 4, because a reviewer only catches the files its brief
  happened to mention.
- **The board is not a main-ref lock.** The SHA and tree assertions in the pre-commit hooks
  protect this documented `--no-ff` landing path. Do not describe a file claim
  or board note as serializing `refs/heads/main`.
- **A conflict resolution is new code.** It has been reviewed by nobody. Re-read
  every hunk you resolved, and run step 5 again — the gates cannot see a wrong
  resolution that typechecks.
- **Resolving a conflict is not always the cheaper path, and it is often the
  wrong one.** A branch that forked from `main` several weeks ago and now conflicts
  in ten files is not ten decisions; it is a design that has been overtaken. With
  the requirements in hand from step 2, price both options honestly: reimplement
  the feature on top of today's `main`, where you can read every current file
  before writing a line, versus composing two sets of changes neither author ever
  tested together. When the branch is far behind and the feature is bounded,
  reimplementation is frequently correct — and it yields a merge with none of your
  hunks in it, so the composition risk step 3 warns about never arises. **The old
  branch is not evidence the work was wasted; it is the specification.** Reimplement
  from the recovered requirements, and let the branch die with the requirement
  recorded in `HANDOFF.md`. This is a `hard-merge` decision, so it goes through
  `.skills/hard-merge.md` like any other.

Then, and only once the merge is on `main`, re-check ownership and cleanup from the
coordinator's verified task worktree:

```bash
(cd "$TASK_WORKTREE" && npm run repo:state)
(cd "$TASK_WORKTREE" && node scripts/worktree-inventory.mjs)
(cd "$TASK_WORKTREE" && npm run branches:orphan)
(cd "$TASK_WORKTREE" && npm run swarm -- doctor --dry-run)
(cd "$TASK_WORKTREE" && npm run dispose -- "<worktree-name>" --dry-run)
(cd "$TASK_WORKTREE" && npm run dispose -- "<worktree-name>")
```

Before actual disposal, verify the exact target path and branch from the fresh inventory; read its
curated entry; prove the owning root and every transitive child session are finished; and confirm
the live board/session overlay has no owner or lock for the target. A repo-state operation in the
target, an unreadable signal, an unknown descendant, or a live overlay means leave it. Classify
unrelated operations on their own worktrees and never touch them. `dispose --dry-run` must name the
same target and allow removal before the non-dry-run command. The active harvester may itself make
disposal fail as `derived-live-writer`; that refusal is expected, not a reason to suppress the
signal. Leave the landed worktree in place and record cleanup as pending.

**That is the only sanctioned removal path**, and the reason is in the header of
`scripts/dispose-worktree.mjs` and in `docs/ORCHESTRATION.md` under "Removal
goes through one program": on 2026-10-01 a harvest-adjacent sweep ran a
hard-coded list of
`git worktree remove` and `git branch -D` and destroyed a live chat's worktree,
because a fourteen-hour-old merge commit carried that branch's _name_ in its
subject and the sweep read that as proof the work was already landed.

`dispose-worktree.mjs` checks the generated `action`, the board's claims and file
locks, and the session database, then anchors the branch at
`refs/keep/disposed/<name>` and salvages uncommitted work before removing
anything. It has no `--force`, and `kilo.jsonc` denies
`git worktree remove --force` against a `kilo/` path and puts `git branch -D`
behind a prompt.

If it refuses, the refusal names the signal that produced it. `in-use` means a
chat is in there: **only the operator may stop a writing chat**, so report it and
move on. A dirty tree means commit it or carry it as a patch. `git branch -d`
refusing is likewise a finding, not an obstacle — and `dispose` already uses `-d`,
so a branch it kept is anchored and recoverable.

**Expect `derived-live-writer`, and do not expect it to name you.** Step 5 ran the gates in that
worktree, so the refusal is about you or about nobody in particular — only the write arm names a
chat, and only for thirty minutes. `--no-live-writers` does not clear it.
`docs/ORCHESTRATION.md` — §"`derived-live-writer` can refuse the session that is asking" — is the
one home for the mechanism. There is no supported flag that clears this refusal; leave the landed
directory in place, record that removal is pending, and establish complete death evidence before
retrying disposal.

This is the gate working: the same signal caught a worktree with agents editing it an hour earlier
reading `action: "dispose"` with every git fact correct. Do not reach for the removal command by
hand. **Land the work, leave the directory, and say in the report that the removal is pending** — a
harvest that reports its landing and silently leaves the worktree behind is indistinguishable from
one that forgot.

**Record the outcome.** `.skills/stale-worktree-reclaim.md` and this file both
exist because a harvest that lands silently teaches the next agent nothing. Put
it in the place that ships:

- A **validated defect** you found while reviewing goes in `HANDOFF.md` — problem
  statement, affected files, actionable fix, and nothing else. No changelog, no
  "work completed", no status summaries.
- A **finding about a branch you did not land** goes in the same file. The next
  harvest will hit it.
- **Verified and fixed means DELETE the entry.** Never rewrite an open problem
  into a closed one; a trail of fixed issues is prose the next session reads
  instead of the problems still open.
- A **recording decision** — a re-recorded baseline, a deliberately waived
  threshold — is the operator's, in writing, not yours.

If a worktree turned out to be **not** landable, do not delete it. Leave it, and
say why. `at-risk` is a real verdict and the file already carries it; a harvest
that disposes of something it could not land has become a reclaim run that
skipped its own safety steps.

---

## Never

- **`git stash`.** The stash is a shared, unordered stack in the common git dir.
  `git stash push` on a CLEAN tree exits 0, prints nothing, and creates NO entry —
  so the `git stash pop` that follows is unpaired, and it pops a _different_
  session's work. This has destroyed work in this repository.
- **Resolve anything in the main worktree.** See step 0. Never reset, check out
  conflict sides, or resolve a merge there: those operations can destroy another
  session's uncommitted work or record an unreviewed resolution. The sole
  metadata-recovery exception is `git worktree repair` when the Git manual
  requires running it from main. Follow [Recovering Git metadata](../docs/ORCHESTRATION.md#recovering-git-metadata): stop writers, take and compare an independent
  backup, and run only the documented repair after confirming the affected paths
  and admin directories. It may repair worktree links; it is never a merge or a
  working-tree-content fix. If a merge conflicts in `main`, `git merge --abort`
  and redo it in the worktree. After any interrupted or abandoned merge, run
  `git rev-parse -q --verify MERGE_HEAD` and `git rev-list --parents -n 1 HEAD`
  before committing — an interrupted merge can leave `AUTO_MERGE` and
  `MERGE_MSG` behind with no `MERGE_HEAD`, and `git commit` then lands a
  single-parent commit that reads as a resolution.
- **Hand-edit `WORKTREES.json`.** It is generated and untracked; the edit is lost
  on the next run, and a hand-edited `prunable: true` is a licence to delete.
- **`git add -A` in a worktree whose root checkout is dirty.** This is the more
  expensive of the two `-A` traps and the one that ships reverts: 17 of them, none
  a conflict. Stage the paths `git status` named. `scripts/merge-takeover-guard.mjs` checks this for
  you and refuses the merge; the recipe that used to sit here is retired, see
  `docs/ORCHESTRATION.md`.
- **`git add -A` in the main checkout.** Stage only your own paths, after
  re-reading `git status`.
- **Land a branch without bringing `main` into it first.** A merge that skips this
  is a merge whose result nobody composed or tested.
- **`git branch -D`.** Use `-d`. It refuses while the branch is unmerged, and that
  refusal is the last thing standing between a bad harvest and lost work.
- **Report a branch unmerged without `git cherry`.** `git log` and `merge-tree`
  both call unmerged work that is already byte-identically on `main`.
- **Accept a curated note about a branch you have not read.** `curated.mjs` is a
  human claim, and its own header records a retracted `landed: true`.
- **Reconcile the computed and read chat states.** Disagreement is the finding.
- **Weaken a gate.** See step 5.
- **Open a browser window.** See step 5.
- **Fan out from the main checkout.** A `task` subagent inherits the working
  directory; 1,398 of them ran with `main` as their working directory in seven days.
  Create the worktree first and put its absolute path in the brief.
- **Let a review finding be fixed after the merge.** Then it is a change on `main`
  that no worktree owns.

## Open questions

- The inventory's `readyToLand` is regenerated per run and decays as `main` moves.
  Nothing in the tool yet pins _which_ run a decision was taken from, so a stale
  `land` has to be caught by regenerating. A `landedAt` stamp on the decision
  would close it.
- Step 6 pins the reviewed main and candidate SHAs and compares the precomputed merge tree with
  the candidate tree; `main-worktree-guard` and `merge-takeover-guard` require and recheck both
  parents and the tree from `pre-commit` after a `--no-commit --no-ff` merge prepared in the main
  worktree and committed from a private index snapshot. Direct
  self-committing merges are refused unconditionally by `pre-merge-commit`. Fast-forwards bypass
  the blocking hook, and squash strategies do not create a merge
  commit for it to inspect; neither is the harvest landing path. This is not a global lock on
  arbitrary Git ref plumbing, so do not claim protection outside the documented guarded workflow.
