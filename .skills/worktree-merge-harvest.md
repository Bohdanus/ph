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
fast-forward or a plain merge commit. Resolving a conflict in the main worktree
puts your resolution — an unreviewed, unattributed one — into a shared checkout
that other sessions are writing to.

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
`scripts/main-worktree-guard.mjs` runs first in `.husky/pre-commit` and refuses
a commit made from the main worktree. It does not stop the write — it runs after
the edit — so it converts "rogue commits nobody can attribute" into "a dirty
tree the next `git status` names". A landing never reaches it, because a
fast-forward fires no **blocking** hook and a merge fires `pre-merge-commit`
before it commits; the one override is `ALLOW_MAIN_COMMIT=1`, and only the exact
value `1`. A fast-forward does fire `post-merge`, which releases the board claims
this merge carried — that is the one hook a landing reaches, and it cannot block.
Everything else that changes a tracked file belongs in the branch's own worktree,
including a comment — and before you edit, `git rev-parse --show-toplevel` is the
only thing that distinguishes the worktree you are in from the one you believe you
are in.

---

## Step 1 — which worktrees are free, and which of them are landable

Regenerate. Never read the committed `WORKTREES.json`, and never hand-edit it —
it is a generated artifact and untracked, so an edit is lost on the next run.

```bash
cd /Users/bkalynovskyi/ph
node scripts/worktree-inventory.mjs --quiet
```

Add `--no-live-writers "<why>"` when you know every chat is gone — an editor
restart takes them all with it, and the recency heuristics keep reporting an owner
for thirty minutes afterwards. It is a declared hard state, recorded in
`ownership.suppressed` beside the signals it overrode.

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
  `dispose`, `in-use`, `keep`, `undecided`
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
- **`summary` / `note` / `issues`** — the curator's claim about the branch. The
  `claimedLanded` / `mergedIntoMain` pair is asserted to agree by a test, so a
  stale `landed: true` fails the suite rather than quietly contradicting git.

Then prove the branch is actually unlanded, because the file can be wrong:

```bash
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<name>
git cherry main <branch>          # patch-level absorption; a branch can be
                                  # unlanded by git log and already on main
git log --oneline main..<branch>  # what is genuinely not there
```

A branch that `git log` and `merge-tree` both call unmerged can still be on `main`
byte-identically. Report a branch unmerged without `git cherry` and you will
merge an empty change.

---

## Step 2 — what the branch was actually for

**Read the chats, not the commit subjects.** A commit subject is a summary of a
line of work; the requirement that forced the line is in the transcript, and it
is the only thing that tells you whether the branch is finished.

`WORKTREES.json` hands you the ids in one step:

```bash
cd /Users/bkalynovskyi/ph
node -e '
  const d = require("./WORKTREES.json");
  const w = d.worktrees.find((x) => x.name === process.argv[1]);
  console.log(JSON.stringify({
    summary: w.summary, note: w.note, mustNotPrune: w.mustNotPrune,
    status: w.status, action: w.action, ahead: w.ahead, dirty: w.dirty,
    writers: w.writeHistory.chats.map((c) => ({ id: c.id, title: c.title, calls: c.calls, last: c.lastAt })),
    shell: w.shellHistory.chatCount,
  }, null, 2));
' <name>
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
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<name>
git diff main...<branch> --stat
git diff main...<branch> -- <path>        # per file, actually read it
```

Then the sweep that a diff cannot give you, and the one that catches the defect
this repository keeps producing:

```bash
# What main changed in the same files, since the branch forked.
git diff <branch>...main --stat
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

### Claim the merge before you touch it

`npm run swarm -- claim <id> --files <paths you will touch>` or `npm run swarm
-- hold <path>`, and `npm run swarm -- check <paths>` before you edit anything a
brief or a sibling subagent names; `claim` and `hold` exit 4, `check` exits 1, and
both name the holder. **Claim the merge, not just the files** — a branch about to
land carries a hazard to every path in it, and no file claim expresses that — and
`npm run swarm -- note` the branch and its paths _before_ you start resolving. A
held file is a queue, not a deadlock: do not edit it and do not wait on the lease.
An unclaimed path looks free.

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

- **How many:** two. One is a sample, not a check. Two reviewers who disagree on
  something is the most valuable outcome of this step, and one reviewer who
  agrees with the author is worth very little.
- **Independence means:** a fresh context that has not read the implementing
  chat's reasoning. Give the reviewer the diff, the requirement from step 2, and
  the platform contract — **not** the author's justification. A reviewer told
  "this is needed because of X" stops looking for X.
- **Model, per `AGENTS.md`:** pass `model` AND `provider` together. Omitting them
  inherits this session's model, which on a free orchestrator has resolved onto a
  paid GPT id and killed the subagent at zero tokens with `Add credits to
continue`. Two rules ride with that: **a free session must never launch a GPT
  subagent**, so the free default is
  `model: 'Space Bunny Alpha (retires Oct 5)', provider: 'kilo', variant: 'max'`; and
  `agent_manager` inherits the current turn's model unless both fields are set, so
  a main turn on a paid model silently spawns paid worktrees. The subagent also
  **inherits the working directory** — so launch reviews with the branch's absolute
  worktree path in the brief, and never from the main checkout, or the review's own
  notes land in `main`.
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

  ```bash
  git worktree add --detach /tmp/verify-main main
  ln -s "$PWD/node_modules" /tmp/verify-main/node_modules
  (cd /tmp/verify-main && npx vitest run <suite>)
  git worktree remove --force /tmp/verify-main
  ```

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
cd /Users/bkalynovskyi/ph/.kilo/worktrees/<name>

# 1. Save anything on no ref BEFORE the merge. This is the only copy.
git status --short
git add -- <each path git status named>
git commit -m "wip(salvage): <what the uncommitted work is>"

# 2. Bring main to the branch. NEVER the reverse.
git fetch origin main 2>/dev/null || true
git merge main        # resolve HERE, in this worktree, reviewed

# 3. Did the merge silently revert anything? It is checked for you, not by you reading.
#    scripts/merge-takeover-guard.mjs runs from pre-commit and pre-merge-commit and refuses
#    the merge. The one home for the mechanism and its limits is docs/ORCHESTRATION.md;
#    the `comm -13` recipe that used to be here is retired because it missed this shape.

# 4. Re-verify after the merge. Composition is where silent reverts live.
npm run tsc && npm run build && npm run test

# 5. Land it.
cd /Users/bkalynovskyi/ph
git merge --ff-only <branch> 2>/dev/null || git merge <branch>
```

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
- **`git merge --ff-only` first** because it is the cheap case and it fails
  loudly when it is not possible. Fall back to a real merge only then.
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

Then, and only once the merge is on `main`:

```bash
node scripts/worktree-inventory.mjs          # a fresh verdict: disposal reads it
npm run dispose -- <name> --dry-run          # says which signal refuses, if any
npm run dispose -- <name>
```

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
one home for the mechanism, and `HANDOFF.md` §224 is the one home for the flag that _would_ clear it,
which a sweep must not reach for.

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
- **Resolve anything in the main worktree.** See step 0. Never _repair_ one there
  either: `reset --hard` and `checkout --ours`/`--theirs` destroy another
  session's uncommitted work, and `hash-object` and `update-index` write an index
  entry no later `git status` reconciles. If a merge conflicts in `main`,
  `git merge --abort` and redo it in the worktree. After any interrupted or
  abandoned merge, run `git rev-parse -q --verify MERGE_HEAD` and
  `git rev-list --parents -n 1 HEAD` before committing — an interrupted merge can
  leave `AUTO_MERGE` and `MERGE_MSG` behind with no `MERGE_HEAD`, and `git commit`
  then lands a single-parent commit that reads as a resolution.
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
- `mergeConflict` is computed by `git merge-tree`
  (`mergeConflict()` in `scripts/lib/worktree-inventory/git.mjs`) and reported raw, but there is no
  check anywhere that the checked merge equals the merge that will actually
  happen after step 6's `git merge main`. Two different merges, two different
  answers, and the second one is the one that ships.
