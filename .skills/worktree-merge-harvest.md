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
that three other sessions are writing to.

The corollary that decides the whole sweep: **an `action: land` you did not
generate yourself is a claim about a moment.** `WORKTREES.json` is a snapshot
(`scripts/lib/worktree-inventory/assemble.mjs:293` stamps `generatedAt`), `main`
moves underneath it, and the `mergeConflict` answer in particular is the fastest
field in the file to go stale. Regenerate before you trust it, and re-read
`dirty` and `mergeConflict` before you act.

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
  (`scripts/lib/worktree-inventory/classify.mjs:79-92`).
- **`writeHistory.chatCount`** — who wrote a file here, **ever**. This is the
  freedom check that `chats` cannot do. `chats` is keyed on
  `session.directory`, which is where a chat OPENED
  (`scripts/lib/worktree-inventory/chats.mjs:365-367`): a main-checkout chat that
  drove into a worktree is booked against main for its whole life, and the
  worktree reads as untouched. `writeHistory` is derived from the write calls
  themselves, so it catches that case. **`writeHistory.chatCount === 0` on a
  branch with commits means the work landed under another chat's name, or by a
  shell — read `shellHistory` before concluding nobody was here.**
- **`writeHistory.activeNow` / `ownership.derivedLiveWorktrees`** — somebody is
  in there right now. Not a harvest target.
- **`mustNotPrune`** — a human claim that something unaccounted-for is in that
  directory. It is a **veto on merging**, not only on pruning
  (`scripts/lib/worktree-inventory/classify.mjs:277-283`): a clean
  `mergeConflict: false` does not outrank it. Read the `note` before merging, not
  after. `curatedFor` is at `scripts/lib/worktree-inventory/curated.mjs:1064`.
- **`dirty` / `untracked`** — uncommitted work is on NO ref. It is the first
  thing to be lost and the last thing git can find. A worktree with
  `dirty > 0` needs its contents committed or saved **before** the merge, not
  after.
- **`mergeConflict` / `mergeConflictFiles`** — and remember `mergeChecked: false`
  means _no answer_, never "clean" (`classify.mjs:266-272`).
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

---

## Step 4 — independent review

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
continue`. The subagent also **inherits the working directory** — so launch
  reviews with the branch's absolute worktree path in the brief, and never from
  the main checkout, or the review's own notes land in `main`.
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
  `--noEmit` form resolves the app config alone, excludes tests, and exits 0
  while the tests do not compile.
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
  under this branch's name.

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
git add -A && git commit -m "wip(salvage): <what the uncommitted work is>"

# 2. Bring main to the branch. NEVER the reverse.
git fetch origin main 2>/dev/null || true
git merge main        # resolve HERE, in this worktree, reviewed

# 3. Re-verify after the merge. Composition is where silent reverts live.
npm run tsc && npm run build && npm run test

# 4. Land it.
cd /Users/bkalynovskyi/ph
git merge --ff-only <branch> 2>/dev/null || git merge <branch>
```

- **Re-read `git status` and `git log --oneline -10` immediately before staging,
  every time.** Other sessions commit into `main` concurrently, and `git add -A`
  in the main checkout will stage their work under your commit message.
- **`git merge --ff-only` first** because it is the cheap case and it fails
  loudly when it is not possible. Fall back to a real merge only then.
- **A conflict resolution is new code.** It has been reviewed by nobody. Re-read
  every hunk you resolved, and run step 5 again — the gates cannot see a wrong
  resolution that typechecks.

Then, and only once the merge is on `main`:

```bash
git worktree remove .kilo/worktrees/<name>
git branch -d <branch>          # -d, not -D: refuses while unmerged
```

`git branch -d` refusing is a finding, not an obstacle. `-D` on a branch the
inventory called unlanded is how uncommitted work is destroyed.

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
- **Resolve anything in the main worktree.** See step 0.
- **Hand-edit `WORKTREES.json`.** It is generated and untracked; the edit is lost
  on the next run, and a hand-edited `prunable: true` is a licence to delete.
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
  directory; 1,398 of them wrote into `main` in seven days. Create the worktree
  first and put its absolute path in the brief.
- **Let a review finding be fixed after the merge.** Then it is a change on `main`
  that no worktree owns.

## Open questions

- The inventory's `readyToLand` is regenerated per run and decays as `main` moves.
  Nothing in the tool yet pins _which_ run a decision was taken from, so a stale
  `land` has to be caught by regenerating. A `landedAt` stamp on the decision
  would close it.
- `mergeConflict` is computed by `git merge-tree`
  (`scripts/lib/worktree-inventory/git.mjs:198`) and reported raw, but there is no
  check anywhere that the checked merge equals the merge that will actually
  happen after step 6's `git merge main`. Two different merges, two different
  answers, and the second one is the one that ships.
