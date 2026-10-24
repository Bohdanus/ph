# Orchestration: worktrees, the swarm board, and the worktree list

How concurrent agents stay out of each other's way. `AGENTS.md` keeps the
short form — create a worktree, one root agent per worktree, claim what you
touch — and this file is the detail behind it.

This document's `task`, `agent_manager`, and Kilo database instructions describe
Kilo Code. Codex uses different delegation tools and configuration; see
[`CODEX-ORCHESTRATION.md`](CODEX-ORCHESTRATION.md) for Codex-specific workflows.

## Find the trap you are in

This file is over a thousand lines and **97 of 3,244 sessions — 3.0% — have ever opened it
with a real read**, so reading it front to back is not a strategy and arriving at the right
section by scrolling is not either. Start from the symptom. Every row is a trap that has
actually cost time in this repository, and the right-hand column is the paragraph that will
save you the next one.

| You are                                                             | Go to                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| about to commit in the main checkout                                | [The rule is enforced at the commit, not by the reader](#the-rule-is-enforced-at-the-commit-not-by-the-reader) |
| about to `git add -A`, or the index holds changes you did not stage | [Worktrees](#worktrees), the two staging bullets                                                               |
| about to remove a worktree or a branch                              | [Removal goes through one program](#removal-goes-through-one-program)                                          |
| being refused by `npm run dispose`                                  | [Removal goes through one program](#removal-goes-through-one-program)                                          |
| landing a branch, or resolving a merge                              | [Worktrees](#worktrees), the `merge-takeover-guard` limits                                                     |
| holding a file lock, or losing one                                  | [Resource locking and releasing](#resource-locking-and-releasing)                                              |
| putting work on the board                                           | [The swarm board](#the-swarm-board)                                                                            |
| refused by `swarm resolve` or `swarm close`                         | [The swarm board](#the-swarm-board), the sequence table                                                        |
| wondering which model or provider a subagent ran on                 | [Which provider did a subagent run on?](#which-provider-did-a-subagent-run-on)                                 |
| inheriting a stalled or dead session's work                         | [Unexpected agent recovery](#unexpected-agent-recovery)                                                        |
| Git reports broken `.git` or worktree metadata                      | [Recovering Git metadata](#recovering-git-metadata)                                                            |
| reading a worktree list                                             | [The list of worktrees: `WORKTREES.json`](#the-list-of-worktrees-worktreesjson)                                |
| starting a Photoshop or algorithmic change                          | [Research before implementation](#research-before-implementation)                                              |
| running an overnight task to completion                             | [The task lifecycle](#the-task-lifecycle)                                                                      |
| finding a branch with no worktree                                   | [Branches nobody holds](#branches-nobody-holds)                                                                |
| delegating from Codex                                               | [`CODEX-ORCHESTRATION.md`](CODEX-ORCHESTRATION.md)                                                             |

**Most of the rules below were written after the incident that motivated them**, so
"documented but still violated" is usually the wrong diagnosis — the rule did not exist yet.
The two that were genuine compliance failures against auto-injected `AGENTS.md` both needed
programs rather than paragraphs, and both are described where they live: a `release --force`
that dropped the caller's own locks, and a weakened assertion.

## The task lifecycle

Normal: `researching -> implementing -> reviewing -> syncing -> gated -> landed -> released`.
Exceptions: `blocked`, `unproven`, `obsolete`; each records evidence and a next action. “Done”
means released or explicitly handed off, never merely “the chat stopped”. Record branch, worktree,
commit, validation, and next action at each phase in the task note or swarm log.

### Research before implementation

For Photoshop behavior, UX, or non-trivial algorithms, use live `websearch` before code. Open and
prefer current Adobe/primary sources, verify load-bearing claims with two sources when possible,
and record URL, version, claim status (`sourced`, `inferred`, `override`, `Unverified`) in the
research note or handoff. Resolve source conflicts by version; local code describes this app, not
Photoshop. See [`docs/TOOLS-RESEARCH-BRIEF.md`](TOOLS-RESEARCH-BRIEF.md).

Every brief names **Goal, Owner, Worktree, Paths, Dependencies, Proof,** and **Handoff**. Reviewers
receive the contract and diff, not the writer’s rationale; they never edit. Two independent
reviewers are required for cross-module, persistence, migration, or high-risk changes.

### Autonomous and overnight runs

- Create and verify the worktree before fan-out; claim files before editing. One writer owns each
  file and a reviewer is read-only.
- Work in acceptance slices and record commit, validation, and remaining risk. A running command,
  old inventory, or last chat message is not a checkpoint.
- Stop only with a validated review-ready commit or an evidence-backed handoff. Crashed dirty work
  is preserved before releasing claims, merging, or removing anything.
- Sync `main` into the branch, rerun gates, and land only from a clean current checkout. Recheck
  diff, status, `repo:state`, liveness, and `git cherry` immediately before landing/disposal.

### Tool limits

`main-worktree-guard` is post-write; worktrees must exist before fan-out. Swarm leases renew on
swarm commands, not during long waits. Inventory omits branch-only refs; `branches:orphan` reports
but does not decide them. Prepare every clean merge in any worktree with
`git merge --no-commit --no-ff <sha>`, then record it with `git commit`; the direct
self-committing merge hook cannot identify the incoming commit and refuses it. On `main`, also
set the reviewed parent and tree pins. Pins are operator-supplied review evidence, not a
cryptographic approval token. Fast-forwards and `git merge --squash -X ours` bypass the blocking
hooks.

## Worktrees

### Source repository and compute mirror

`drguz69/lightshopy.com` is the private source of truth; `Bohdanus/ph` is
currently a private compute-only mirror. `origin` is not a reliable role name
and may point to the mirror. Configure named `upstream` and `mirror` remotes as described in
[`FREE-REMOTE-COMPUTE.md`](FREE-REMOTE-COMPUTE.md), then always use an explicit
remote for `git push` and `--repo drguz69/lightshopy.com` for source `gh pr`
commands. Review content before publishing to the mirror. Mirror CI is
diagnostic evidence, not a replacement for source-repository landing checks.

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
  `git worktree add -b fix/task "$MAIN/.kilo/worktrees/task"`, where `$MAIN` is the main
  checkout's absolute path as [`../AGENTS.md`](../AGENTS.md) under **Worktree FIRST** derives it.
  Use the absolute path — a relative one nests the worktree inside whichever checkout you are
  standing in. A second worktree for the same task is a fork you reconcile by hand.
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
  git branch (the `agentId` derivation in `resolveIdentity()`, `identity.mjs`), and `holdFiles`
  refuses only a _foreign_ lock,
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

`scripts/main-worktree-guard.mjs` runs from `.husky/pre-commit` and refuses to
record an ordinary commit made from either the primary Git checkout or the
designated `main` worktree. The primary checkout stays protected even if it has a
task branch checked out; pinned landings are allowed only in the designated
`main` worktree. It names the worktree recipe and the
one override, so a refusal is a redirect rather than an obstacle: an agent that
meets a bare "no" commits anyway, from the same checkout, on a branch nobody made.
It is a program rather than another paragraph for the two reasons above — a
permission cannot see the working directory, and Kilo has no lifecycle hook that
could veto a write before it happens. The commit is the last moment the damage is
still free to undo, and the one moment git itself guarantees to run code in.
Ordering is load-bearing: it runs before `gate:commit` because that gate is
lint-staged plus `tsc -b` plus a build, and lint-staged rewrites staged files with
`--fix` before the commit is ever called illegitimate.

The hook installer records the designated main worktree's private Git directory
and root path in shared local Git config (`ph.mainWorktreeGitDir` and
`ph.mainWorktreePath`). It also stores a random identity marker in that private
Git directory. The matching marker keeps the same checkout protected if its
`HEAD` is detached or switched during a hook, while a new worktree does not
inherit protection if Git reuses the old path-derived admin directory. If the
private directory changes, the saved path still protects a detached checkout
there; it does not transfer protection to a feature branch that reuses the path.
A hook install while `main` is checked out seeds an identity marker for older
registrations that recorded only the path and private Git directory. A first
install fails when `main` is detached and no saved identity exists. The path
also lets an older linked worktree run the designated checkout's current final
message guard while its own hook file is missing, but only while the saved path
still has the recorded private directory and matching marker; a reused path
cannot supply that guard. Pinned landings and the hotfix override still require
`refs/heads/main` to be checked out. The final `commit-msg` gate requires exactly
one non-empty `Chat:` trailer on every commit after `prepare-commit-msg` has had
a chance to edit the message.

What it does **not** do is stop the write. It runs after the edit, so a session
that writes into `main` and never commits is not stopped by it. It converts "71
rogue commits nobody can attribute" into "a dirty tree the next `git status`
names" — the write side is the process rule above, and the guard is the floor
under it.

A separate merge-hook rule applies in every worktree: prepare clean merges with
`git merge --no-commit --no-ff <full-sha>` and record them with `git commit`.
The `pre-merge-commit` hook unconditionally refuses direct self-committing merges;
prepare them with `--no-commit` so the next hook can inspect `MERGE_HEAD`. Feature merges may omit the five
landing pins; a merge into `main` requires them. If a direct merge is refused,
check whether Git left `MERGE_HEAD` and abort only that exact attempt before
retrying through the documented prepared-merge flow. Commit a main landing with
`node scripts/commit-reviewed-landing.mjs` so Git reads the reviewed private
index snapshot after its hooks run. Land one candidate at a time; octopus merges
are refused because their multiple incoming commits cannot be checked against a
single candidate SHA.

The shared `pre-commit` dispatcher records the merge parent and index tree in the
worktree's private Git directory after the worktree's own checks and lint-staged
rewrites finish. The final message guard checks that record after
`prepare-commit-msg`, so a hook that removes both `MERGE_HEAD` and `MERGE_MSG`
cannot turn a prepared feature merge into an ordinary commit. It also requires
the final index tree to match the tree pre-commit approved; a message hook cannot
stage a different merge resolution after the takeover check. After an aborted
merge, the next pre-commit clears the record only when the index has returned to
the original `HEAD` tree and no `AUTO_MERGE` marker remains; otherwise, restore
or inspect that worktree before committing. A leftover `MERGE_MSG` alone does
not block an ordinary commit after a clean abort.
The merge record begins when the `pre-commit` dispatcher runs. If an operator
runs `git merge --quit` before that first snapshot, Git removes the merge state
while leaving the staged result; the guard cannot recover the discarded parent
from the later ordinary commit. `post-merge` does not run for `--no-commit`, so
it cannot close this pre-snapshot gap. Treat `--quit` as abandoning the prepared
merge and reset or restore the index before making another commit. After the
first snapshot, marker removal is detected and the commit is refused.

Three things stay allowed, each deliberately:

- **A pinned landing.** Prepare a clean merge in `main` with
  `git merge --no-commit --no-ff <reviewed-sha>`, then commit from the reviewed
  private index snapshot with `node scripts/commit-reviewed-landing.mjs`.
  `pre-commit` verifies `HEAD`, the actual `MERGE_HEAD`, the staged tree, and
  reviewed snapshot marker before allowing the commit. `commit-msg` repeats the
  snapshot checks and verifies the final message after `prepare-commit-msg` has
  run. The `pre-merge-commit` hook refuses direct self-committing merges on every
  supported Git version; a fast-forward invokes no
  blocking hook, so neither path is a landing procedure. The merge still invokes
  the non-blocking `post-merge` hook after it is recorded.
- **An operator hotfix the operator asked for on `main` by name** —
  `ALLOW_MAIN_COMMIT=1`, and only the exact value `1`, because a truthiness test
  would read `ALLOW_MAIN_COMMIT=0` as permission and turn a spelling that looks
  like a denial into a bypass. The commit still requires its `Chat:` trailer.
- **A repository the guard cannot place.** Detection fails open and policy fails
  closed, because they are different questions: a git that will not answer is a
  broken environment, not a decision, and blocking there would trade a real gate
  for a phantom one.

### Landing

- **The main worktree is a landing, not a negotiation.** A branch merges into
  `main` only after `main` has already been merged or rebased **into the branch,
  in the branch's own worktree**, and the gates re-run there. The merge into
  `main` is then a mechanical two-parent commit with nothing to decide, prepared
  with `--no-commit --no-ff` so its actual `MERGE_HEAD` can be checked. Merging a
  stale branch straight into `main` puts the conflicts in a
  shared checkout where every other session is committing.
- **A harvest must pin both merge parents, its tree, source branch, and chat.** Before review
  and gates, record the exact `main` SHA, candidate SHA/tree, source branch, and chat ID. Prepare
  the final non-fast-forward landing with `git merge --no-commit --no-ff <full-reviewed-sha>`,
  then pass `KILO_EXPECTED_MAIN_SHA`, `KILO_EXPECTED_INCOMING_SHA`, `KILO_EXPECTED_TREE_SHA`,
  `KILO_EXPECTED_BRANCH`, and `KILO_EXPECTED_CHAT_ID` to
  `node scripts/commit-reviewed-landing.mjs` as shown in
  `.skills/worktree-merge-harvest.md` §Step 6. The helper requires exactly matching `Branch:`
  and `Chat:` trailers, verifies that the source branch still resolves to the reviewed incoming
  SHA, and creates a mode-restricted workflow marker for its private index snapshot. The marker
  helps detect accidental alternate-index use; a same-user caller can deliberately construct
  it, so it is not an authentication boundary. In the project main
  worktree, `main-worktree-guard.mjs` and `merge-takeover-guard.mjs` compare the pins with
  `HEAD`, Git's actual `MERGE_HEAD`, the staged result tree, and that marker before creating the
  merge commit. The `commit-msg` hook checks the final `Branch:` and `Chat:` trailers after
  `prepare-commit-msg`, which can rewrite the message after `pre-commit`. The pins bind the
  prepared operation to the reviewed record; they do not
  authenticate who supplied them. Reflog text is caller-controlled and is not used to identify
  the incoming side.
  A board claim coordinates paths but is not a main-ref lock. Fast-forward and
  squash merges bypass this blocking check and are not the harvest landing path.
- **The landing checkout must be clean before the merge starts.** Run `git status --short` and
  `git diff --cached --stat`; any path you do not own is a hard stop.
  Do not stage, stash, reset, abort, or resolve another session's work to make the
  landing appear clean. Wait for its owner; do not create a second checkout to
  update the same `main` branch ref.
- **Refresh shared hook dispatchers when a candidate adds a hook.** After preparing a
  conflict-free merge that adds the tracked hook file, run `node scripts/install-git-hooks.js`
  from the candidate worktree and verify its dispatcher exists in the common Git directory,
  before creating the landing commit. If a non-main linked worktree has not synced the tracked
  hook yet, the shared dispatcher still requires exactly one non-empty `Chat:` trailer; it
  skips only the main landing checks. It fails closed on `main`.
- **Never resolve a conflict in the main worktree**, and never repair one there
  with `reset --hard`, `checkout --ours`/`--theirs`, `hash-object`, or
  `update-index`. The first two destroy another session's uncommitted work; the
  last two write an index entry no later `git status` reconciles. If a merge
  conflicts in `main`, `git merge --abort` and redo it in the worktree.
- **Do not use `git merge --squash -X ours` or equivalent history-dropping merges.**
  Fast-forwards and this squash shape bypass the takeover hooks; the latter can
  produce no commit or `MERGE_HEAD`, so there is no event for the guard to inspect.
  Use the normal reviewed merge path, or stop and compare both sides explicitly
  in the branch worktree before choosing a non-standard history shape.
- **Never `git stash`.** It is a shared, unordered stack in the common git dir,
  so `git stash pop` in one worktree can pop another agent's stash — and the
  failure is silent in a way that is worse than a lost entry: `git stash push` on
  a CLEAN tree prints nothing, exits 0, and creates **no entry at all**, so the
  `pop` that follows takes `stash@{0}`, which is whoever pushed last. Use a
  worktree or a branch; if work must be set aside, `HUSKY=0 git commit` on a
  throwaway branch holds nothing but your own files.
- **Stage only your own paths, everywhere.** The main worktree is not stable
  while you work — other sessions commit into it concurrently. Re-read `git
status` and `git diff` before staging.
- **An index that was ALREADY foreign is the harder half, and nothing here or in
  `AGENTS.md` covered it.** The two bullets above are about your own `git add`. This
  is about arriving at a staged tree you did not stage. `git diff --cached` is the only
  evidence that exists — there is no "who staged this" and no way to ask. Four sessions hit
  exactly this between 2026-09-29 and 2026-10-01: _"the index now has both my changes and the
  other session's changes staged"_, _"The index was staged by something else — my last check
  showed unstaged"_, and twelve files went ` M` → `M ` between two consecutive `git status`
  calls in one of them. **All four probed `.git/index.lock` and all four found nothing**,
  because an in-flight commit holds it only for the seconds it takes and a finished one leaves
  no trace at all. So the repository cannot distinguish the two states, and the procedure is
  the whole of the answer:
  1. **`git diff --cached --stat` before every `git add`**, not after. Once your own paths are
     staged, an intruder is indistinguishable from your own work.
  2. **Never `git add -A` in a checkout other sessions use.** Name your paths.
  3. **A `git commit -a` is worse**, because it sweeps the whole working tree rather than the
     index and gives you no pause in which to look.
  4. If `git status` shows a staged path you do not recognise, **leave it staged**, commit only
     your paths with `git commit -- <paths>`, and report it. Unstaging somebody else's staged
     work destroys the only copy of their intent that exists.
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
  **Now enforced, not merely written down.** `scripts/merge-takeover-guard.mjs` runs from
  `pre-commit` (when `MERGE_HEAD` is set, for a conflicted merge being completed or a clean
  merge prepared with `--no-commit`). The `pre-merge-commit` hook unconditionally refuses
  direct clean merges, regardless of `MERGE_HEAD` timing. A detected takeover is refused
  rather than reported. A reviewer only catches the files its brief happened to mention;
  this catches paths where the merge copied one side's content or silently discarded a
  whole-file change. Three
  shapes, none of which produces a conflict marker: the result is the pre-divergence
  content (the `-A` case above), it is the incoming side's file verbatim
  (`checkout --theirs <path>`, or `git merge -X theirs`), or it is THIS side's version of
  a path having dropped the incoming side's content (`git merge -X ours`,
  `git merge -s ours`, or `git checkout --ours <path>` on one path of a conflicted merge).
  The third was a hole rather than a decision: it is the one shape whose result is HEAD's
  own file, so the guard's scan set — paths the merge moved relative to HEAD — was empty by
  construction and `git merge -s ours` reported `clean — 0 path(s) moved by the merge`
  while deleting the branch's commit. `docs/DOCUMENTATION.md`'s one-home rule is why the
  asymmetry survived: `-X theirs` was documented and its inverse was simply never written
  down, so there was nothing to contradict. The incoming-side scan also checks whole-file
  deletions in both directions: it reports an ignored branch deletion, and it reports a
  deletion that removes distinct HEAD content unless resolve-undo records an explicit
  modify/delete choice.

  It finds that shape through a second scan over **the paths the INCOMING side changed**,
  not the paths HEAD changed, and that distinction is load-bearing: `-s ours` applies
  nothing at all, so a branch's added files vanish too, and a scan over HEAD's changes
  finds only the contested subset and reports the rest of a dropped commit as clean.

  Content changes in all three shapes are measured by asking whether a line the losing side
  committed is **absent** from the result, not by counting a diff. Whole-file deletions have
  no lines on the deleted side, so their missing path is counted once. A conflict resolved by
  staging one whole side's blob is still detected; a custom resolution whose blob matches
  neither side is outside this detector. `--numstat` bills a
  moved line as one deletion plus one insertion, so a result that is a superset in content
  but not in line order reads as a loss; measuring content is what makes "this side's
  version won" mean that something was actually dropped. A resolution that is neither
  side's blob is deliberately NOT reported — see the boundary note in the script.

  `git merge -s ours <ref>` is the standard git idiom for recording that a branch was merged
  without taking any of its content. It is legitimate and deliberate, and it is refused here
  like any other silent discard; `git merge --no-verify <ref>` is how an operator says they
  meant it.

  **Its limits, because a gate that claims more than it has is the failure it replaces:**
  git runs no **gating** hook for a **fast-forward**, so that landing shape is uncovered — safe
  by construction, since the branch tip contains main as an ancestor, but uncovered. The
  non-blocking `post-merge` hook still runs and releases only eligible merged worktrees;
  dirty worktrees remain held and are reported. `--no-verify` bypasses the gating hooks,
  but not `post-merge`.

  **Seven original shapes it used to pass, found by adversarial review and measured, not
  reasoned about.** Each was reproduced against the guard as it stood: a real merge in a
  throwaway repository, driven through `findTakeovers` with the real index. All seven
  destroyed committed work and reported success. The historical replay for those seven
  fixes covered every merge on `main` at that time: the same 36 merges were refused before
  and after, with the same kinds and paths. That count predates the whole-file deletion
  checks below and is not a current replay total.

  | Shape                                              | What it destroyed                                   | How it slipped through                                                                                                                                                                                           |
  | -------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | add/add resolved by `-X theirs`                    | main's whole committed file, **no conflict marker** | the shape asked for a base blob, which an add/add has none of, before it would look                                                                                                                              |
  | a modify/delete resolution                         | nothing — it **crashed**                            | the losing side was HEAD's, and HEAD had deleted the path; `main()` catches `GuardError` only, so the hook exited 1 with a stack trace and no verdict                                                            |
  | an added **empty** file under `-s ours`            | the file                                            | it has no non-blank lines, so "no lines lost" answered for a file that no longer existed                                                                                                                         |
  | an added **gitlink** under `-s ours`               | the submodule pointer                               | the gitlink measure read `losing.oid !== resultBlob.oid` behind a `resultBlob &&`, so an absent entry answered zero                                                                                              |
  | a commit that is only **indentation**              | the whole commit                                    | lines were trimmed before comparing, and `npm run format` produces exactly this commit                                                                                                                           |
  | `-s ours` whose result then had a **mode bit** set | the branch's rewrite                                | `headWon()` was documented as exactly `!moved.has(path)`; a mode-only difference makes a path "move" while HEAD's content still won, and three successive proxies for "already judged" each failed to exclude it |
  | suspect blobs past the **batch buffer**            | six large assets                                    | `maxBuffer` was 256 MiB, `execFileSync` threw `ENOBUFS`, and the `catch` returned an empty map — so every measure returned 0. **Fail-open, on the path where the loss is largest**                               |

  Two of these are worth reading twice, because they are different in kind. The crash is the
  worst _failure mode_ in the file: the most common conflict resolution in git produced a stack
  trace and an exit 1 with no verdict, which is precisely the pressure that ends in
  `--no-verify`. And the batch buffer is the worst _silently passing_ one, in a repository
  whose subject matter is images — an unread blob measures as no loss, so the largest possible
  silent pass was also the most likely one. Both now refuse, and the second raises rather than
  returning an empty map: an unread blob must never be a zero.

  **A later adversarial pass found a whole-file deletion gap in both directions.** If the
  incoming side deleted a path, `-s ours` could silently preserve HEAD's file and discard the
  committed deletion. Conversely, a result that applied that deletion could erase HEAD's
  distinct post-base edit. The guard counts the first as one lost incoming path and the
  second as one lost HEAD path; resolve-undo evidence preserves the existing exception for
  an explicit modify/delete choice.

  **One shape it still cannot see, and it is not a merge defect.** `git merge --squash -X ours`
  produces a staged tree identical to HEAD's, so `git commit` answers "nothing to commit", there
  is no commit, there is no `MERGE_HEAD`, and neither hook fires — the branch's payload
  disappears with no event to hang a check on. Plain `--squash` is fine and does not need the
  guard: it stages the real merge result. The fix belongs in a `pre-push` check, where a
  branch's own diff against `main` has two sides to compare.

  **It only sees a merge that is being COMMITTED.** A merge or rebase that stops on a
  conflict runs no hook at all, so an operation left open is invisible to it — which is how
  `integration/sweep-land` sat for a day holding a resolved, compiling, silently-reverting
  merge that this guard would have refused the moment anyone ran `git commit`. `npm run
repo:state` is what reports an operation in progress, and it separates the two states that
  share one `action`: unmerged paths mean git still holds every side and nothing has been
  decided, while **none** mean a resolution is staged in no commit, which `git merge --abort`
  discards. Nothing else in the tree can see that state, which is why it is a command and not
  a field.

  **A hand edit to a file git merged CLEANLY, which is a shape with no conflict marker in it
  anywhere.** Counting `remerge CONFLICT` lines does not measure hand-written merge work, and
  the gap is not small: on the history `findHandResolutions` in
  `scripts/merge-takeover-guard.mjs` was measured over, more paths were hand-edited on a merge
  git had already resolved cleanly than were resolved as conflicts. That function's JSDoc holds
  the rules, the figures, and how to re-derive them; the figures move as `main` grows, so they
  are not held here. What it enforces, in three lines:

  - a path changed after a **clean** merge is **reported** with the count of lines git's merged
    result had and the staged result does not. Refusing those would train every agent to reach
    for `--no-verify`, which is how the three whole-file shapes above were nearly lost once.
  - a **test** file that git's merge produced and the result does not contain is **refused**,
    UNLESS a side's own commit had already deleted it, which includes every `modify/delete`
    conflict — deleting the file there is git's own recommendation and was reviewed where it was
    written. A path that was renamed is reported as a rename, because rename detection on hides
    the erasure and rename detection off refuses a legitimate rename.
  - a merge run with `-X`/`-s` **cannot be detected and cannot cause the refusal**: git records
    a merge's result in its reflog action, not the invocation, so no hook can read the flag; a
    strategy option resolves a hunk and never removes a path, so its cost is report lines.

  The `comm -13` recipe that used to live here is **retired and was wrong twice over**: it
  reported hundreds of innocent paths when run at the only moment it could act (before the
  merge, `main..HEAD` measures the un-merged tree), and it missed the recorded 17-file
  incident, because a file the branch never _changed_ is invisible to a check built on what
  the branch touched. Run the guard, not the recipe.

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
  # Run from an already verified task worktree under .kilo/worktrees.
  git worktree list --porcelain
  TASK_WORKTREE="$(git rev-parse --show-toplevel)"
  MAIN="<absolute path paired with branch refs/heads/main>"
  BASE_SHA="$(git -C "$MAIN" rev-parse refs/heads/main)"
  VERIFY_NAME="verify-main-$(date +%Y%m%d-%H%M%S)-$$"
  VERIFY="${TASK_WORKTREE%/*}/$VERIFY_NAME"
  test -d "${TASK_WORKTREE%/*}"
  git -C "$TASK_WORKTREE" worktree add -b "$VERIFY_NAME" "$VERIFY" "$BASE_SHA"
  VERIFY_SHA="$(git -C "$VERIFY" rev-parse HEAD)"
  test "$VERIFY_SHA" = "$BASE_SHA"
  (cd "$VERIFY" && npm ci && npm run tsc && npm run build && npm run test -- "<same failing suite>")
  test "$(git -C "$MAIN" rev-parse refs/heads/main)" = "$BASE_SHA"
  ```
  # After testing, run each fresh preflight from TASK_WORKTREE; inspect, do not suppress errors.
  (cd "$TASK_WORKTREE" && npm run repo:state)
  (cd "$TASK_WORKTREE" && node scripts/worktree-inventory.mjs)
  (cd "$TASK_WORKTREE" && npm run branches:orphan)
  (cd "$TASK_WORKTREE" && npm run swarm -- status)
  (cd "$TASK_WORKTREE" && npm run swarm -- doctor --dry-run)
  (cd "$TASK_WORKTREE" && npm run dispose -- "$VERIFY_NAME" --dry-run)
  (cd "$TASK_WORKTREE" && npm run dispose -- "$VERIFY_NAME")
  ```
  This checks a recorded committed-main snapshot; if `main` moved during the run, repeat from its
  new SHA before calling the result current. The scratch branch and worktree are named and live
  under `.kilo/worktrees`, not `/tmp`. Do not remove them manually. Before actual disposal, prove
  the owning root and every transitive child session are finished, inspect the target's live
  overlay and curated entry, and confirm its Git operation state is clear. An unrelated
  in-progress worktree must remain untouched; an operation or live owner in `VERIFY` is a stop.
  A refusal caused by the current session's `derived-live-writer` signal is expected: leave the
  worktree in place and record cleanup as pending. Never use a detached worktree, a broad
  `verify-*` cleanup, `git worktree remove --force`, or `--no-live-writers` without independent
  evidence that all writers are gone.
  ```
- **After any interrupted or abandoned merge**, run `git rev-parse -q --verify
 MERGE_HEAD` and `git rev-list --parents -n 1 HEAD` before committing. An
  interrupted merge can leave `AUTO_MERGE` and `MERGE_MSG` with no `MERGE_HEAD`,
  and `git commit` then lands a single-parent commit that reads as a resolution.
- **Whenever a `git pull` (or `git fetch` + `git merge`) brings new commits into
  the main worktree, record the incoming commits in `docs/INCOMING_COMMITS.md`.**
  Each entry must include: the date, the source remote/branch, the commit SHAs
  (short and full), the commit subjects, and the author. This document is the
  audit trail for what landed on `main` from outside. The file is tracked and
  committed alongside the merge. Example entry format:
  ```
  ## 2026-10-10 — origin/main (fetch + merge)
  - a1b2c3d (a1b2c3d4e5f6...) "Fix: handle empty selection in crop tool" — Author Name
  - f6e5d4c (f6e5d4c3b2a1...) "feat: add new levels adjustment" — Author Name
  ```
  If the pull is a fast-forward, the same recording applies — the commits that
  moved `main` forward are still incoming from the remote.

### Four traps that cost real debugging time

- **A worktree used to run no commit gate at all, silently.** `core.hooksPath`
  was `.husky/_` — a directory husky generates during `npm install` and keeps
  untracked — and git resolves a relative `core.hooksPath` against the root of
  the worktree it is running in. Every worktree made by `git worktree add` had no
  `.husky/_`, so git found no hook, ran nothing, and exited 0.
  `core.hooksPath` now points at `<common git dir>/hooks-gate`, which every
  worktree shares, and the tracked `.husky/<hook>` entry points are what run. **If a hook
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
    `lock.agent_id !== who` (in `holdFiles` and `lockFile`, both in `db.mjs`), so a branch never
    conflicts with itself: with branch
    identity, two runs in one worktree both "acquire" and the second one's `unlock` releases the
    row the first still believes it holds. Every board call therefore passes
    `--agent e2e-run/<branch>/<pid>`, and `swarm status` shows that while a suite runs — the
    branch says which checkout, the pid says which process.
  - **The wrapper renews on a timer, and so does the board.** `renewOwnLocks` extends a run's own
    sentinel for as long as its worktree is on disk, so a live holder keeps its slot without this
    wrapper asking; the timer here is belt and braces, at a third of the lease and never more than
    every few minutes, and a renewal that fails is a _message_. Nothing renews a DEAD run's lock,
    because nothing is running that identity. A lost queue costs a concurrent run, not correctness:
    both runs have their own ports.
  - **Nothing here can fail a run.** Queue full, board unreachable, malformed lease: each logs and
    the run proceeds. Two earlier versions broke that: one exited 4 when it could not have the
    lock, which made an unenforceable mechanism into a hard block on a merge gate, and one threw
    from the lock's constructor for a bad lease — before the run had decided it wanted a lock at
    all, so `CI=true` with a typo in `E2E_LOCK_LEASE` died with no suite. The lock is now built
    only on the path that uses it, and a bad lease is reported and replaced.
  - **A holder this wrapper did not create is never reclaimed.** The reclaim unlocks AS the holder
    it is reclaiming, so a wrong liveness answer releases a real agent's slot. Board identity is
    the sanitized branch and `sanitize` preserves `/` (it is in `sanitize()`'s allowed-character
    class, `scripts/lib/agent-board/identity.mjs`),
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

## What git is doing right now

A worktree that is mid-merge, mid-rebase or mid-bisect keeps that state in its own
git directory — `.git/worktrees/<name>/` for a linked worktree, `.git/` for the
primary. **No commit records it, no branch name carries it, and `git status` in the
main checkout cannot see it.** `MERGE-INTEGRITY-AUDIT.md` calls this the whole
hazard class in one place, and it is right: on 2026-10-04 a worktree in this
repository held an eight-path unresolved merge for hours, and the only reason
anybody knew was that a person ran the audit's `find` by hand.

`npm run repo:state` reports it. It is `scripts/repo-state-gate.mjs`, and it reads
git's own markers — `MERGE_HEAD`, `SQUASH_MSG`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`,
`BISECT_LOG`, `rebase-merge/`, `rebase-apply/` — plus
`git diff --name-only --diff-filter=U`, which is what separates an unmerged index
entry from an ordinary edit. `git ls-files -u` separates them too and returns the same
paths; `-U` was chosen because its output is already one path per record.
`--json` prints the same findings for a caller that wants them as data.

**It exits non-zero when it could not look, not only when it found something.** A
roster it could not read, or a worktree it could not describe, is reported as
unreadable rather than as clean. `npm run dispose` refuses on exactly those inputs, and
a report that answered them with exit 0 would be the surface a person trusts more.

**Run it before you believe the repository is quiet.** It exits non-zero when
anything is in progress, and it is the check to run before a sweep, before a landing,
and before you conclude that a worktree is finished.

**It is advisory and is wired into no hook, on purpose.** It costs two git spawns per
worktree, so it scales with the fleet — measured in seconds on a fleet of this
repository's size. That is right for a command a person runs and wrong for a hook, and the
decisive reason is behavioural: a hook would block every push in the repository
because _some other_ worktree is mid-merge, and a gate that punishes the whole swarm
for one session's state gets `--no-verify`'d, after which it protects nothing.

**It reports WHAT is in progress and never WHOSE it is.** git does not record that
either, so `WORKTREES.json` carries a chat-recency signal for it. Establish the owner
before you intervene: the worktree measured above was live, and an abort would have
destroyed a session's in-flight work.

**`MERGE_HEAD` with an index that no longer has unmerged paths is the dangerous
shape, and the report warns about it by name.** Every conflict resolved, nothing
committed. `git commit` lands an unattended resolution; `git merge --abort` throws the
resolution away. Both are one command away, and neither is distinguishable from the
index alone. Decide in that worktree, from inside it — never from the main checkout.

**`npm run dispose` refuses a worktree with an operation in progress**, because
removing the worktree deletes the state files and there is no reflog entry and
nothing for `git fsck` to recover. It also refuses when it could not read that state,
and when no state was supplied for it at all: an absent signal is not a clear
worktree. The refusal names the command that would discard the work, and it carries
the board claims, locks, agents and sessions `preflight` already holds — because the
operator's first question about a discard command is whether anybody is standing
there.

**A worktree whose directory is gone still counts.** Its git directory usually
survives, and that is where a mid-merge `MERGE_HEAD` lives; `git worktree prune`
deletes it. Both `repo:state` and `dispose` find that directory by matching the
administrative directories' own `gitdir` files rather than by deriving a name from the
worktree path, because git sanitises the name it uses — a leading `.` becomes `-`. So
when `dispose` refuses with `prunable`, **run `npm run repo:state` before pruning.**
The refusal used to say there was "nothing to salvage and no state to verify" and then
recommend the command that destroys it.

**Where there is no command to run, the report says so instead of naming one.**
`git merge --squash` writes no `MERGE_HEAD` and git cannot abandon a squash at all, so
its remedy is nothing rather than a plausible-looking command that fatals.

## The list of worktrees: `WORKTREES.json`

`WORKTREES.json` at the canonical checkout root is a generated inventory of every
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
There is exactly one canonical location for `WORKTREES.json`: the non-bare
checkout that has `refs/heads/main` registered, resolved via the shared module
`scripts/lib/worktree-inventory/location.mjs` by both the generator
(`worktree-inventory.mjs`) and the disposer (`dispose-worktree.mjs`). When
`main` is a linked worktree the file lives there; when `main` is the primary
checkout it lives at that checkout's root. The repository storage root is a
separate path taken from the first entry in Git's worktree roster (or the bare
repository entry when it is bare); this keeps orphan containment anchored to
the primary checkout even when `main` is linked under `.kilo/worktrees/`, and
works when Git metadata lives outside the checkout or in a submodule. Neither
reader nor writer falls back to a
worktree-local or `cwd`-relative copy: a stale task-local `WORKTREES.json`
is the single most dangerous state in this system, because it authorises a
disposal against a snapshot the generator has never seen. If no `main` worktree
is registered, the primary worktree entry supplies the repository-root fallback.
If that roster is unreadable or a registered `main` path is invalid,
inventory-path resolution fails closed. The disposer refuses a missing canonical
file; the generator writes it there, while `--check` refuses if it is absent.

Unregistered directories receive an additional fail-closed rule: the disposer
may inspect their ownership and contents, but it does not recursively remove
them, even when the preflight is clear. Node's portable path-based removal can
delete a replacement directory if the repository root or target is swapped
after validation. Registered worktrees continue to be removed through Git's
worktree command.

The consequence worth knowing: **a fresh clone has no inventory**, because
nothing regenerates it for you. Generate one before you read a worktree list, and
treat any `WORKTREES.json` you find as a claim about a moment rather than a
shared source of truth.

```bash
node scripts/worktree-inventory.mjs            # regenerate
node scripts/worktree-inventory.mjs --check    # exit 1 if stale OR absent, write nothing
node scripts/worktree-inventory.mjs --quiet    # totals only
```

There is no separate `inventory:verify` npm command. `--check` only verifies whether the
generated snapshot is fresh; it does not replace a live ownership or disposal audit. For current
worktree state, regenerate the inventory and run `npm run repo:state` for any worktree whose Git
operation state matters. For branch-only refs, also run `npm run branches:orphan`. A failed or
unreadable report is not a clean result and must remain a recovery case.

## Branches nobody holds

`WORKTREES.json` omits branches whose worktree is gone, so every harvest also runs
`npm run branches:orphan`. The report is read-only. Classify every row as **recover**, **retire**,
or **defer** before ending the sweep. Run `git cherry main <branch>` before calling one unmerged;
search by feature, changed paths, and commit subject. No owner is `unproven`, not abandoned.

**Read `action` first.** Every record carries one value, and it is the whole
answer — which of the six things it is:

| `action`    | meaning                                                                                         | do this           |
| ----------- | ----------------------------------------------------------------------------------------------- | ----------------- |
| `land`      | clean tree, commits ahead of `main`, merges clean                                               | merge it          |
| `at-risk`   | work on no ref, the merge needs a human, or git says disposable and a curated finding disagrees | save it           |
| `dispose`   | clean, unprotected, and on `main` or proven to merge to the exact `main` tree                   | delete it         |
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

A clean non-ancestor branch can also have **no net tree change to land**. The inventory records
`mergeResultMatchesBase: true` only when `git merge-tree --write-tree <mainHead> <branch>` succeeds
without conflicts and returns the exact tree object recorded for `mainHead`. This is a separate
proof from patch-ID absorption: the branch may contain unique historical commits, but merging its
tip produces the current base tree byte-for-byte. When the tree is clean and no curated or live
protection applies, classify it `dispose`, not `land`. The disposer requires the inventory's
`mainHead` to still match, anchors the branch tip under `refs/keep/disposed/` before removal, and
uses guarded `git branch -D` only for that verified non-ancestor case. It rechecks `main` before
removal and before deleting the branch; if `main` moves, it keeps the worktree or recovery branch.
Do not infer this verdict from an empty path diff, `git cherry`, or a conflict-free merge alone.

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

### Removal goes through one program

`dispose` in the table above is not advice. **`scripts/dispose-worktree.mjs` is
the only sanctioned way to remove a worktree and its branch**, and it is a
program rather than a paragraph for the reason `main-worktree-guard.mjs` is: the
agent that needs the rule is mid-task, holding a list of paths, and will not
re-read this file before the destructive command.

It refuses, and says which signal refused, unless all of these hold:

- the inventory's wall-clock `generatedAt` and evaluation time `ownership.asOf` are
  **not in the future and no more than 15 minutes old**, and it calls this
  worktree `action: "dispose"` — or `action: "legacy"`, which permits removing
  the worktree while keeping the branch. `--keep-branch` explicitly allows an
  operator to remove a freshly inventoried `action: "at-risk"` worktree
  while retaining its branch;
- it is not the base branch, even when the repository uses a bare primary
  worktree and checks out the base branch in a linked worktree;
- **no board claim, no board file lock and no live board agent** names it;
- **no Kilo session** has it as its `directory` inside the live window;
- its **working tree is clean** — re-read now, not taken from the inventory
  snapshot, because a verdict generated at 23:38 acted on at 00:44 is the case
  this exists for;
- it holds **no gitignored content that no command rebuilds**. `git status`
  honours `.gitignore`, so a tree holding only a `.env` reports itself clean and
  `git worktree remove` deletes it unconditionally. Build and dependency output
  is exempt by an explicit list — `node_modules/`, `dist/`, `coverage/`,
  `tsconfig.tsbuildinfo` and the rest, each carrying the command that rebuilds it
  — because a real worktree here carries a handful of ignored entries once
  whole directories are collapsed (53 before `--directory`, 66 worktrees and 290
  entries across the repository) and a rule with no
  exceptions refuses every worktree. **The list is the exception; an ignored path
  it does not name counts as work.** `.serena/`, `playwright/.auth`, `*.local`
  and `*.log` are deliberately absent from it.

Any one of those refuses on its own. `in-use` from two independent sources is the
one that matters: `session.directory` records where a chat was **opened**, so its
absence is never evidence of abandonment, and the board's `agents` table is what
covers a chat that was opened in `main` and driven into a task worktree.

**The refusal you will actually hit is about you.** Two of those conditions name no
actor, they name the **caller**: `collectOwnership()` keys every signal on the worktree's
absolute path and never calls `resolveIdentity` — verified, zero references in the program —
so there is no "unless the holder is me" anywhere. Liveness is recency-only over recorded
writes, so the chat that wrote in a worktree is its own live writer for the whole window.
**Run `npm run dispose` on a worktree you have been working in and it refuses itself**, with
text addressed to somebody else: _"only the operator may stop a writing chat"_, _"Held locks
are released by the agent that took them, not taken from it"_, or a `derived-live-writer`
finding naming the chats that wrote inside the live window — which includes yours.

**There is no generic escape from inside the agent.** No `--force` exists — the CLI rejects the flag.
`--keep-branch` is narrower: it only accepts a freshly inventoried `at-risk`
action, archives tracked and untracked edits, clears them only after the
archive succeeds, and keeps the branch ref. It does not override `mustNotPrune`,
unreadable worktree state, ignored content, active ownership or in-progress operations.
`undecided` is never eligible. `--max-age-minutes` is ceiling-clamped to the same 15 minutes the
inventory-freshness check imposes. These options do not change ownership policy: board and session
claims still require the operator to resolve ownership before removal. Measured over the program's own refusal line: **24 sessions on 2026-10-01
and 2026-10-02, 35 to date.** Read it as a statement about the operator, not about the
worktree: the verdict is right — you _were_ writing there — and the remedy belongs to whoever
can stop your session. The half that is wrong is that an agent cannot release its own recorded
ownership, which is a gap in the program and is filed as one.

**A signal that could not be read is not an empty signal.** A `git status` that
fails refuses as `dirty-tree-unreadable` rather than leaving the counts at zero,
a board database that is present but unreadable refuses, and a bare name that
is the basename of two worktrees refuses rather than disposing the first match —
git guarantees two worktrees cannot share a _path_, which is not the same thing.
Each of those three was a direction where a failed lookup produced the same
value as a clean answer.

### `derived-live-writer` can refuse the session that is asking

**The refusal most likely to be hit by a reader who did nothing wrong.** `dispose` refuses
`derived-live-writer` when the record's `derivedLive` is true or `writeHistory.derivedChatIds` is
non-empty. `derivedLive` is an **or** of four arms, and only three of them are records of a call
inside the directory:

| arm         | what it actually is                                                   | window                     | names a chat?      |
| ----------- | --------------------------------------------------------------------- | -------------------------- | ------------------ |
| `writeLive` | the write calls inside the worktree                                   | `LIVE_WINDOW_MS`, 30 min   | **yes**            |
| `ioLive`    | recent `shellHistory` **and `readHistory`** — a reader counts         | `RECENT_IO_WINDOW_MS`, 4 h | no                 |
| `chatLive`  | `session.directory` plus `time_updated` — a chat that only _messaged_ | `LIVE_WINDOW_MS`           | no                 |
| `liveAgent` | a board row, not a call history                                       | the board's own            | prints an agent id |

So "a chat ran the gates in there" is only one of the ways in, and the wide arm counts **reads**. A
session arm makes it worse than it looks: `writes.mjs` argues in its own header that attributing a
call to a worktree by the session's directory is wrong in both directions, and this arm then does
exactly that. `classify()` deliberately keeps `derivedLive` beside the suppressed `live` rather than
letting `--no-live-writers` erase its own evidence, and `dispose` reads `derivedLive`, so **the
documented suppression flag does not clear this refusal.**

The refusal message names a chat only when `derivedChatIds` is non-empty — the write arm. **Every
other arm prints "a chat"**, so an anonymous refusal is the normal case, not a sign of something
else.

The ordinary shape of a harvest is: gate the branch inside its worktree, land it, and find the
worktree you just gated cannot be disposed. **Treat that as the tool working, not a flag to find.**
The same `io` signal is the one that caught a worktree with agents editing it an hour earlier
carrying `action: "dispose"` and `prunable: true` with every git fact correct. Land the work, leave
the directory, and **say in the report that the removal is pending** — a harvest that reports its
landing and silently leaves the directory is indistinguishable from one that forgot.

**There is no supported flag that clears this refusal.** `--no-live-writers` suppresses one
inventory signal but deliberately does not erase `derivedLive`, and changing clocks or lease data
to make a worktree appear dead is not recovery. Leave the landed directory in place, record that
removal is pending, and let the owner or a later sweep establish the complete death evidence.

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

`chats.unfinished` holds **six** states (`UNFINISHED_STATES` in `chats.mjs`): `active`,
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
- **`check` answers TWO questions, and reading only the first is how three agents
  end up in one file.** `free` means no live **LOCK**. It does not mean nobody's
  business. The line then names **every open issue that references the path**,
  including the ones that reserve nothing — an issue imported from a handoff
  document, or filed with `--files` by an agent whose lease has since run out.
  Read both halves; `held by <agent>` is exit 1, and an issue that is open, claimed
  or deferred is not.
- **A reference NEVER moves that exit code, and that is deliberate rather than
  incidental.** A gate that failed on every file any handoff document has ever
  mentioned would fail on nearly every path in the repository and train every
  agent to pass `--force`. Whether a reference should ever block is the operator's
  call, not a side effect of a query.
- **`issue_files` is the index that makes that answerable, and it is durable.**
  It is written by `new` and by `holdFiles` whether or not a lease is taken, and
  rebuilt from the event log by the v2 → v3 migration, so a board on disk gains
  it without re-importing (the import is idempotent by `origin` and would file
  nothing). Before it, only an issue that reserved **nothing** kept its files solely
  inside an event's `data` JSON; an issue that took a lease was queryable, through
  `issue_locks`, by the agent who held it.
- **`swarm list --files` asks about the PATH, not about the caller.** It used to
  join `file_locks` and require the row to belong to whoever ran it, so the one
  command an agent runs before opening a file could only answer "which of my own
  locks is on this path" — and returned an empty set for every unlocked file,
  which is indistinguishable from a file nobody cares about.
- **The fixer's claim is not its verification.** `swarm resolve` needs the live
  claim; `swarm close` refuses the agent that resolved the issue. Exit code 5 is
  that refusal, **and exit 5 is only that refusal** — one `code: 5` in the program.
  **There is no `--verified-by`**, and that is the point: a flag
  naming somebody else is a name the caller supplies about an agent that is not in
  the room. A reviewer closes an issue by being the reviewer.
- **The sequence is `claim → resolve → close`, and each refusal names the step you
  skipped.** The order is documented nowhere else and the error text is the only
  interface, so it costs three turns to learn:

  | You ran                               | It says                                                                            | Exit |
  | ------------------------------------- | ---------------------------------------------------------------------------------- | ---- |
  | `resolve` with no claim               | `<id> is not claimed; claim it before resolving`                                   | 3    |
  | `resolve` on a peer's claim           | `<id> is claimed by <agent>; only the claim holder resolves it`                    | 3    |
  | `close` on an unresolved issue        | `<id> is open; only a resolved issue can be closed`                                | 3    |
  | `close` as the agent that resolved it | `<agent> resolved <id> and cannot also verify it; verification is somebody else's` | 5    |

  **The one that surprises is the third**: closing an issue nobody claimed reports
  `is open`, not a claiming error, because `closeIssue` checks the status before it checks the
  resolver. Exit 3 there means "not in the right state", never "somebody else has it" — reading
  3 as a contention signal sends you looking for a rival agent that does not exist. Note also
  that `resolve` takes a `--force` that `close` does not, so a claim that cannot be resolved
  can be taken but an issue nobody else will verify cannot be closed by you at all — and
  **typing `swarm close <id> --force` is not an error**: `parseArgs` keeps an unknown bare
  flag as `true` rather than rejecting it, so it is silently ignored and you get the same
  refusal, which reads as the flag having been considered and rejected.

- **`--force` on a release hands back locks, and it hands back YOURS.** `release
--force` skips exactly one guard — `claim.agent_id !== who` — and the claim's file
  locks go with it, because they are released **by issue pairing rather than by actor**: every
  `issue_locks` row for that issue is dropped, and a lock is freed whenever no other issue
  that is not yet closed still pairs that same `(path, agent_id)`. One identity can therefore
  release locks another identity acquired, and nothing checks who owns the pairing. Recorded
  shape, in one minute in one shell: five paths taken as `main`, then
  `AGENT_BOARD_AGENT=fix/… release` refused with `is claimed by main, not by fix/…`, and
  `release --force` dropped the five locks the same session had taken twenty-three seconds
  earlier. **Set `AGENT_BOARD_AGENT` once in the shell's environment**, not per command, so
  every invocation in it is the same agent — `resolveIdentity` reads the variable _before_ the
  branch, and the only time-varying terms in that chain (`KILO_RUN_ID`, `process.pid`) are
  unreachable inside a checkout that has one. `--force` on `unlock` is the same trade on files,
  with no pairing table to soften it.
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
- **A bare `swarm watch` is a TAIL of the last 200 events, and it says so on a
  `#` line. It used to be the first 200 events of the log, and that cost two
  agents a session.** It read from seq 0, printed one page, and stopped: on a
  576-event board it showed the first seventeen hours and nothing after, so
  every `note` just written was absent from the output. An agent grepping the
  log for its own note text got nothing, concluded the note had not landed, and
  carried on — it had. The same report blamed ANSI colour, and **the output has
  no ESC byte in it anywhere**: `swarm watch | grep -c $'\x1b'` answers 0, so
  "it is coloured" is a diagnosis with nothing behind it and chasing it is the
  second way this wastes a session. `--since 0` now reads forward to the end of
  the log rather than stopping at 200, which is the other half: without it, a
  deliberate full read silently lost everything past the first page. A test
  drives both halves in `scripts/__tests__/agent-board.test.mjs` — a board with
  211 events, a note at the end, and an assertion that the first event is
  _not_ in the bare output.
- **Exit codes are the interface:** 0 ok · 1 usage or error · 2 not found · 3
  claimed or not claimable · 4 file held by another agent · 5 self-verification
  refused.

It is a command, not a gate, and no commit may be blocked on it. Exactly one thing
calls it: `.husky/post-merge` runs `scripts/merge-release.mjs`, which releases the
claims and locks of eligible worktrees the merge put on `main`, while reporting
merged worktrees blocked by dirty state or other release conditions — non-blocking,
because the merge is already recorded by the time a post-merge hook runs. Nothing else in
`.husky/` reads the board, and nothing runs it on worktree creation or on a chat
stopping.

### Resource locking and releasing

The board at `.git/agent-board/board.db` tracks three resources: issue claims
(`claims`), file locks (`file_locks`) and agent presence (`agents`). All are keyed
on `agent_id`, which is the **git branch** — `resolveIdentity` prefers
`AGENT_BOARD_AGENT`, then the branch, and nothing in this repository ever sets
that variable. Two sessions on one branch are one agent to the board and cannot
deny each other a file.

**Liveness is recency only.** `agents.last_pid` and `session_id` are written and
never read — the one process-level signal the schema carries is consulted nowhere.

**The two readers disagree about a malformed timestamp, and the board side is the
dangerous one.** `board.mjs:isLive` treats one as **live**; `liveLocks`
(`db.mjs`) treats it as **free**, because `NaN > at` is false — so the
inventory can show a file held while `swarm check` calls it free. Unreachable
today, since every writer goes through `msFromNow`, but a resource's safety rests
on an invariant the code does not hold. Claims fail the other way: `doctor` tests
`Date.parse(lease_until) <= at`, also false for `NaN`, so a malformed lease is
neither live nor reclaimable and `swarm health` reports an expired count
`swarm doctor` cannot reduce.

A **claim** renews itself while its worktree exists, and `autoSweep` renews
before it sweeps. The limit of that ordering: `doctor` also reclaims on **expiry**,
and renewal only fires when a `swarm` command runs, so it protects an agent that
ran one inside the last half-lease — a long `npm run test` loses the claim to a
peer's next command. Renewal and release must read the **same** row, and now do:
both use the worktree in the claim, not the caller's. Because identity is the
branch, two agents on one branch in different worktrees share an `agent_id`, and
when renewal asked about the caller while `doctor` asked about the row, a live
agent extended a dead colleague's lease and released it in one invocation.

**A file lock renews exactly as a claim does, and its residual limit is much narrower than
"it does not renew".** `renewOwnLocks` extends the caller's own `file_locks` rows and
`autoSweep` calls it before it sweeps, on every command except `doctor` — `help` and
`--version` return before the board is even built. Four things are worth knowing, because each
is a way to hold a lock and lose it:

- **Your own rows only.** The `WHERE` clause names your `agent_id`. A lock cannot be kept
  alive by a peer, and `acquired_at` is deliberately left alone so the log records when the
  lock was taken rather than when it was last touched.
- **A worktree path must resolve.** `renewOwnLocks` bails when `identity.worktree` is falsy.
  **That is not the `main`-checkout or detached case**, which is what this section claimed for
  years: `resolveIdentity` fills the field from `git rev-parse --show-toplevel`, which succeeds
  in every checkout. `main` renews, and a detached HEAD renews under the identity
  `detached@<short-sha>`. The only caller that gets no renewal is a `swarm` command run
  **outside any git repository at all**. Measured 2026-10-03 across four working directories —
  and the wrong version was copied out of a source comment into this file as fact before anyone
  checked it against the function.
- **Renewal fires only when a `swarm` command runs**, and only for a row already inside the
  half-lease threshold. That threshold is what makes it safe to reason about: a lock is never
  extended before it is half gone, so a stale row cannot be kept alive by a command that has
  nothing to do with the file.
- **The sweep is no longer the hazard it was.** `doctor` releases each expired row through
  `releaseFiles([finding.path], { agent: finding.agent, reason: 'swept' })` — with **no
  `force`** — so the `agent_id !== who` guard still applies and a live holder on the same path
  is not swept out from under itself. The key is `(path, agent_id)`, so two live rows on one
  path are schema-legal, and `doctor` iterates every live row rather than the first.

What is left is the same limit a claim has: an agent that stops running `swarm` for a
half-lease loses its locks, and the fix is an activity signal rather than a longer TTL.
Renewing on worktree presence alone would be the wrong fix — a lock means _an agent is in this
file_, not _this branch owns this directory_. The log shows the pressure this replaced, and the
pressure is the striking number: **1,179 `lock.hold` against 18,992 `lock.deny`** in the live
board's 22,103 events, with 11 renewals. Sixteen denies per held file.

Hand-driven release is careful: `releaseClaim` walks the `issue_locks` pairing
table so a file another live issue needs survives. The board is currently clean —
zero unreleased claims, zero unreleased locks — but that is agents releasing their
own work, not a sweep that could not have leaked.

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
  **no recipient in the room**, and the strings it refuses with are `Board recipient is
not a participant in this board` and `Board messages cannot be sent to yourself`. A reader
  grepping for a documented response shape finds neither, and neither string exists anywhere in
  this repository, because the program is not here — `board_post` is Kilo's built-in, not
  `npm run swarm`. Treat either refusal as the answer: nothing was delivered.
- **The cap is on the FORMATTED message, in BYTES — and "under 4096 characters" is
  the rule that was failing.** `board_post` enforces two limits over two
  different counters. Its argument schema refuses a `body` over 4096 **UTF-16
  units**; `BoardStore.post` then measures `Buffer.byteLength` of
  `JSON.stringify({id, timestamp, from, to, type, body, reply_to})` against
  **4096 bytes**. The envelope costs 191–253 bytes depending on the session ids
  and whether the post is a reply, so a 4090-character body clears the schema and
  is refused a moment later with `Formatted board message exceeds 4096 bytes` —
  37 recorded posts died exactly there, having been written to a limit that did
  not exist. Non-ASCII dies twice over: 1000 emoji are 2000 units and 4000 bytes.
  **A body has about 3840 bytes: 3800 ASCII characters, or 1200 characters if any
  of them may be non-ASCII.** Both figures are measured against the worst
  envelope, reply included.
- **It ends the STEP, not the turn, and the difference is 13%.** Of 134 recorded
  rejections, 117 continued in the same turn — nearly all by retrying shorter —
  and 17 ended it for good: 13 subagents, 9 of those sessions never speaking
  again. The claim that a rejection ends the whole turn stood in this file and in
  `AGENTS.md`, and it was false. An overclaim in the direction that tells an
  agent the failure is unrecoverable is worth as much as the missing number was.
- **So a long finding is a POINTER, and the pointer has a channel with no cap.**
  An issue body is not an event and is not capped (the next subsection says by
  what), the board database lives in the git common directory, so one command
  hands a peer a document of any length from any worktree:

  ```sh
  npm run swarm -- new "short title" --body "$(cat /abs/path/finding.md)"
  ```

  `swarm show <id>` prints that body, so the peer needs no second command. Then
  `board_post` the issue id plus one clause on what it says. Do not compress the
  finding to fit: the repo board refuses rather than truncating for the same
  reason, so a document belongs in a body and a log line stays a log line.

- **An unclaimed path looks free; claim or hold it before editing.** A held file is
  a queue, not a deadlock: do not edit it or wait on the lease. Note the file and
  change, hand it over, or work elsewhere and merge `main` in first.

### A note is a pointer, and every word of it is stored

Three ways prose used to arrive shorter than it was typed, all of them silent, and
all of them now refusals. The shape they share is the reason the board cannot be
used to hold a finding: **a note is a log line, so it is capped, and a cap that
truncates is a lie about what was said.** The repository already wrote this down
for titles — `truncate()` exists because `slice(0, 70)` with no ellipsis produced
a title that read as a finished sentence.

- **`--note`, `--reason` and `--body` take prose, so they take every following
  bare token.** `claim ph-1 --note fixed the thing` used to record `fixed` and
  discard the rest, exit 0, leaving a claim note that read as a complete sentence.
  A quoted value still works, and a later flag still ends the prose.
- **A `--` inside an UNQUOTED note is refused, not split.** `note before --flag
after` used to store `before` and answer `noted — event #12`. Quote the message,
  or end the command with a bare `--` — which is why that is the one documented
  form to type flags first: everything after a `--` is literal, so a `--dir` typed
  after it becomes part of the note.
- **A message over 4096 characters is refused, with the limit and the way out
  named.** `MAX_MESSAGE_CHARS` in `scripts/lib/agent-board/db.mjs` guards
  `addEvent`, the single point every text-carrying event passes through, so a new
  command cannot add a path around it. An issue BODY is not an event and is not
  capped: a body is a document an issue points at, not a log line.

Every one of these refusals was a silent loss first, and each has a test that
fails if the refusal is softened — including the tempting ones, like letting a
trailing `--json` be exempt, which guards nothing and hides
`note x --json trailing words`.

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

## Which provider did a subagent run on?

`AGENTS.md`'s model policy is a pair — a model name and a provider ID — and the
session database records both sides in different places. The call you sent is in
the caller's `part` rows; the model the child ended up on is in `session.model`,
which holds a JSON object, not a bare string:
`{"id":"gpt-6-astra-fast","providerID":"openai","variant":""}`. Two queries, and
they answer different questions.

**The call you sent.** No join, so it cannot lie:

```sh
sqlite3 ~/.local/share/kilo/kilo.db "SELECT coalesce(json_extract(data,'$.state.input.model'),'(none)') AS model, coalesce(json_extract(data,'$.state.input.provider'),'(none)') AS provider, count(*) AS calls FROM part WHERE json_extract(data,'$.tool')='task' GROUP BY 1,2 ORDER BY calls DESC"
```

**The child each call actually spawned.** `part.data`'s output carries the child's
own id in `<task id="ses_…">`, and that is the only attribution that is exact. Read
the resolved model id out as well as the provider: `'kilo'` is the gateway, and the
gateway also serves paid GPTs, so `providerID` alone cannot tell the free case from
the expensive one.

```sh
sqlite3 ~/.local/share/kilo/kilo.db <<'SQL'
WITH calls AS (
  SELECT coalesce(json_extract(data, '$.state.input.model'), '(none)') AS model,
         coalesce(json_extract(data, '$.state.input.provider'), '(none)') AS provider,
         substr(json_extract(data, '$.state.output'),
                instr(json_extract(data, '$.state.output'), '<task id="') + 10) AS tail
  FROM part
  WHERE json_extract(data, '$.tool') = 'task'
    AND json_extract(data, '$.state.output') LIKE '%<task id="ses_%'
)
SELECT calls.model, calls.provider,
       coalesce(json_extract(c.model, '$.providerID'), '(gone)') AS landed_on,
       coalesce(json_extract(c.model, '$.id'), '(gone)')         AS resolved,
       count(*) AS children
FROM calls
LEFT JOIN session c ON c.id = substr(calls.tail, 1, instr(calls.tail, '"') - 1)
GROUP BY 1, 2, 3, 4
ORDER BY children DESC;
SQL
```

Every id in `session` is currently 30 characters, so a hardcoded `substr(…, 30)`
happens to match. Read to the closing quote anyway: a width that is one character
off matches **nothing and raises nothing** — 28 matches 0 of 1,730 children that 30
matches — which reads as "no rows" rather than as a bug. The width is an
undocumented format, and the end-of-tail form costs nothing.

Six ways to get an answer that looks right and is not:

- **`part.session_id` is the CALLER, not the child.** Joining `session.parent_id`
  to it credits every child to every `task` call in the parent's session, so a
  "the correct pair still landed elsewhere" finding appears out of nothing. It is
- **`task` is not exposed to a subagent, so "a subagent launches subagents" is not
  a thing that happens here.** A `task` part sitting in a session that is itself a
  child is a `task` call made _by that child_, recorded against it — and every one
  of them fails: **242** such calls, 240 with `Model tried to call unavailable tool
'task'` and 2 aborted, against a session tree of **518 roots and 2,713 children and
  zero grandchildren**. **Write the fan-out as your own calls.** A brief that delegates
  the delegation is unexecutable, and the agent that wrote it reports back as though it
  had run. The failures are not spread evenly — **82 of them landed on 2026-10-03
  alone** — so this is a live cost, not a historical footnote.
- **`session.model` is the session's CURRENT model.** A child switched later is
  counted at its latest model, not the one it was launched on. Worse, a name the
  provider does not carry can resolve onto a different family entirely:
  `'Google: Gemini 2.5 Flash'` on `kilo` produced a child on
  `cohere/north-mini-code:free`, and `'Cohere: North Mini Code (free)'` + `'kilo'`
  produced one on `google/gemini-2.5-flash`.
- **Do not filter on `state.status = 'completed'`.** The calls that cost money are
  the ones that died — `Add credits to continue, or switch to a free model` is a
  `status = 'error'` row, and a completed-only filter hides every one of them. All
  4 such rows are `error`; there is no `completed` row among them.
- **Do not read `providerID` as a cost.** `providerID = 'kilo'` covers both
  `stealth/space-bunny-alpha` and `~openai/gpt-luna-latest`, `openai/gpt-6-sol`,
  `poolside/laguna-s-2.1` and `nvidia/nemotron-3-super-120b-a12b` without its
  `:free` suffix. Read the resolved id too.
- **Do not read a successful launch as a correct pair.** An off-catalog pair can
  complete on a model nobody named.
- **A `GROUP BY` over `session` alone answers neither question.** It cannot see
  what any call asked for — `session` records no provider, and `session_input`
  records only `prompt`, `delivery` and two sequence numbers — and it mixes in the
  main session and every Agent Manager worktree: 409 of 2,188 sessions have no
  parent.

**Omitting `model` and `provider` inherits the caller's own turn model — measured,
not assumed.** Of the joinable children of calls that passed neither field, 331 of
381 resolved to the caller's current model, including 32 that landed on `openai`
GPTs; every one of those 32 had a caller already on `openai`. The remainder spread
over the gateway's free models. So the hazard of omitting both is not "a provider
nobody chose" — it is "whatever this turn is running on", which is free only if
this turn is. **The provider is inherited separately**: **144** of the children of calls that
passed neither field reached the same `stealth/space-bunny-alpha` through `openrouter` instead
of `kilo`, where 118 reached it correctly. That is `subagent_model` in
`~/.config/kilo/kilo.jsonc` winning the provider while the model stayed put. **Measured
2026-10-03 over the whole store, and it is a floor** — it counts one resolved model id, and
`session.model` records only a session's _current_ model, so a child switched since launch is
counted at its latest one. Reproduce it by adding `WHERE model IS NULL AND provider IS NULL` to
the join above and grouping on the child's `providerID`.

**The calls that cost money are the ones the join above cannot reach — and the
children exist.** A launch that fails on credits emits no `<task id="ses_…">`, so
it is invisible there, yet the child session was still created and its resolved id
is recorded in `session.model`. The error text carries the handle that finds it:

```sh
sqlite3 -readonly ~/.local/share/kilo/kilo.db "SELECT datetime(time_created/1000,'unixepoch'), json_extract(data,'$.state.input.model'), coalesce(json_extract(data,'$.state.input.provider'),'(none)'), json_extract(data,'$.state.error') FROM part WHERE json_extract(data,'$.tool')='task' AND (json_extract(data,'$.state.error') LIKE '%Add credits%' OR json_extract(data,'$.state.error') LIKE '%free-models-per-day%') ORDER BY time_created"
```

**Match both strings, and do not truncate the error.** The two failure modes have different
texts — `Add credits to continue, or switch to a free model` and
`Rate limit exceeded: free-models-per-day-stealth.` — and a query filtering only one of them
measures **4 rows out of 44** while the class it is meant to size is eleven times that. The
truncation is the same mistake one step later: the instruction below is to take the
`task_id="ses_…"` out of the row, and `substr(…, 1, 60)` cuts the handle off before you can
reach it, so the recipe could not be followed with the recipe. Return the whole error and read
the tail. (Extract it at `instr(e,'task_id="')+9`: offsetting on `'task_id="ses_'` and adding
10 silently drops the `ses_` prefix and matches none of the 44.)

…then take the `task_id="ses_…"` out of that row and read `session.model` for it. Measured
2026-10-03: **44 rows, 4 of them `Add credits` and 40 `free-models-per-day`** — the dominant
class is the one a single-string filter misses. **All 44 resolve to a live child session**,
across 43 distinct ids, which is the half the join above cannot reach and the reason this
recipe is worth having; **all 44 are `cost = 0`, 36 at `tokens_input = 0`**, and the eight that
spent tokens are subagents that had already run and hit the limit on a later launch. Read
across the `Add credits` four and both failure modes are visible in one pass: a name the
provider does not
carry (`GPT Luna Latest` on `kilo` — it is `openrouter`'s, and the child resolved
to `~openai/gpt-luna-latest`), and a name it carries but must not serve
(`OpenAI: GPT-6 Sol (new)` on `kilo` — resolved `openai/gpt-6-sol`, paid).

**An off-catalog pair does not have to fail, and that is the dangerous case.**
`'Space Bunny Alpha'` + `'kilo'` is a pair the catalog does not have, and it
completed 90 times out of 90 — resolved to `stealth/space-bunny-alpha`, which is
the model behind the `(new)` name. The resolver fuzzy-matches a name it does not
carry onto whatever fits, so a successful launch proves nothing about what ran. It
fuzzy-matches across families, not merely across spellings: the child of
`'Space Bunny Alpha (new|kilo'` — a truncated name that has no catalog entry at
all — also resolved to `stealth/space-bunny-alpha`. The same leniency is how
`GPT Luna Latest` + `kilo` reached `~openai/gpt-luna-latest`. **`session.model` is
the only record of what actually ran**, which is why a fleet audit reads the
resolved id and never the outcome.

**And an in-catalog pair is not a free pair.** Two calls from the SAME session,
15 seconds apart, differing only in the name's `(free)` marker. Both children were
created; what differs is how far each got:

| call sent                                      | child's resolved id                      | child's tokens (in/out) |
| ---------------------------------------------- | ---------------------------------------- | ----------------------- |
| `'NVIDIA: Nemotron 3 Super'` + `'kilo'`        | `nvidia/nemotron-3-super-120b-a12b`      | 0 / 0                   |
| `'NVIDIA: Nemotron 3 Super (free)'` + `'kilo'` | `nvidia/nemotron-3-super-120b-a12b:free` | 1,485,176 / 63,088      |

Both names are in the catalog on `'kilo'`, and the base id is the same model family
in both rows — only the `:free` suffix differs. The bare one was rejected at
billing with `Add credits to continue` and consumed nothing. The `(free)` one was
not: it ran 1.5M input tokens, and although that call itself later ended
`Upstream idle timeout exceeded`, the error class changed, which is the point —
it got past the credit check. **The gateway marks price in the name — `(free)` in
the catalog, `:free` on the resolved id — and catalog membership says nothing about
it.** `OpenAI: GPT-5 Pro ($$$$)` is the same marker for the expensive end.
Reproduce with:

```sh
sqlite3 -readonly ~/.local/share/kilo/kilo.db "SELECT datetime(time_created/1000,'unixepoch'), json_extract(data,'$.state.input.model'), coalesce(json_extract(data,'$.state.input.provider'),'(none)'), substr(coalesce(json_extract(data,'$.state.error'),'(ok)'),1,45) FROM part WHERE json_extract(data,'$.tool')='task' AND json_extract(data,'$.state.input.model') LIKE '%Nemotron%' ORDER BY time_created"
```

**A model name and a provider are a PAIR, and the catalog decides the pair.** Check
it rather than remember it — `agent_manager_models` takes a query and answers with
each model's providers, and a model with no entry for the provider you want simply
has no such pair:

```sh
# 'Space Bunny Alpha (new)' is on kilo; 'Space Bunny Alpha' (no "(new)") is on openrouter;
# 'GPT Luna Latest' is openrouter-only while 'OpenAI: GPT Luna Latest' is the kilo entry.
```

That asymmetry is the whole hazard. A GPT whose gateway spelling is
`OpenAI: …` and whose openrouter spelling is bare is one typo away from a paid
call that fails on credits, and no rule that only inspects `provider` can see it.

## GPT token budget, held live: `swarm tokens`

`swarm tokens` is the swarm's read on "how much GPT did this repository consume
in the last 5 hours, and how much of the window's budget is left". It holds
that reading in the board's `token_window` table so an operator or agent can
consult it before spending another paid GPT call. Polling is a manual command;
this repository does not schedule it automatically.

**It does NOT query an account balance endpoint.** OpenAI's documented remaining
token signal is in per-request rate-limit headers, not the 5-hour account window.
The local Kilo `message` table does record assistant-message token totals, model
IDs, provider IDs and timestamps. `swarm tokens --poll` sums those message totals
for GPT models on the OpenAI provider or Kilo's OpenAI-backed model IDs inside the look-back. It does not sum
session lifetime counters, which cannot be apportioned to a window. The total is
still a rough estimate against the operator-configured budget, not an invoice or
an authoritative account balance.

A reading's `status` says what it could see, and is the signal itself:

- `ok` — message usage read, budget set, `remaining = budget − consumed` (clamped to 0).
- `incomplete` — a matching in-window GPT message has no final usage; remaining is
  unknown so the router fails closed.
- `no-budget` — session DB read, no budget configured (`KILO_TOKEN_WINDOW_BUDGET` unset
  and no `--budget`); the reading holds consumed-only usage.
- `no-session-db` — the session database is absent (e.g. a machine with no Kilo
  history); consumed and remaining are unknown, not zero.
- `invalid-window` — the requested look-back is outside the supported 0–72 hour range.
- `invalid-budget` / `invalid-time` — the budget or pinned poll time is not a valid safe integer.
- `error` — the read failed; the error is captured in `detail` for diagnosis.

`reset_at` is an estimate: oldest matching message time plus the look-back width,
which approximates when the first usage rolls out. It is not the provider's reset
boundary; `detail.resetAtEstimated` marks it. Readings older than 90 minutes are
stale. `--json` includes `routingPolicy`: no/uncertain readings fail closed to
recommends free models; at 20% or less remaining, a reset estimate over 60 minutes
away (or unknown) recommends free models and blocks Terra/Sol unless the operator
explicitly overrides for that subtask and acknowledges the budget risk. Free
models remain preferred otherwise. A non-five-hour look-back is not used for
five-hour routing decisions.

**Record a reading** manually or from an operator-managed cadence (never via
cron, per the project's cron constraint):

```bash
npm run tokens:poll                       # uses KILO_TOKEN_WINDOW_BUDGET
npm run tokens:poll -- --budget 20000000  # explicit window ceiling, in tokens
npm run tokens:poll -- --window 2         # a narrower usage sample; routing stays unknown
```

**Read what the swarm holds:**

```bash
npm run swarm -- tokens                   # all held readings, newest first
npm run swarm -- tokens --json            # machine-readable
npm run swarm -- tokens --provider gpt    # filter
npm run swarm -- tokens --prune           # drop readings older than the window
```

`--prune` keeps the table bounded to one look-back window; `tokens --poll` prunes
before it records. The five-hour default is shared by the poller and both CLIs;
the 72-hour maximum matches the session-database safety bound. Nothing in a
reading is a secret: no provider API key is read or stored by this machinery.

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

## Recovering Git metadata

The `.git` entry at a checkout root may be a directory in the main worktree or a
small `gitdir:` file in a linked worktree. A linked worktree's private admin data
and the common repository metadata are coupled; deleting or rebuilding either
by hand can make every checkout unusable. Never delete or edit `.git`, `gitdir`,
or `commondir` as a recovery technique, and do not set `GIT_DIR`,
`GIT_COMMON_DIR`, or `GIT_WORK_TREE` to guess which repository a command should use.

First stop writers and preserve the repository directory, all worktree
directories, and uncommitted files in an independent, coherent backup or
filesystem snapshot. Include the common Git directory, each checkout's `.git`
entry, worktree admin directories, indexes, refs, and dirty files. Do not snapshot
while a writer is active. A remote push or `git bundle` preserves committed refs
and objects, not dirty files or the worktree registry. Keep the backup untouched.

This is a narrow exception to the normal worktree bootstrap rule in `AGENTS.md`:
if metadata damage makes `git worktree list` unreliable or prevents creating a
task branch, do not try to create one yet. Start with filesystem-only inspection
of `.git` entries and their referenced paths. Once the backup is complete, use
only read-only Git diagnostics from a checkout that still resolves the shared
repository, or from a known-good clone. Set `GIT_OPTIONAL_LOCKS=0` for status
inspection so Git does not refresh optional index data. Record which checkout
and common directory each command resolved. If no checkout resolves the shared
repository, stop and recover from the independent backup or known-good clone.

After the repository is identified, resume the usual task-branch bootstrap as
soon as `git worktree list` is trustworthy. Do not mutate metadata until the
affected checkout and matching admin directory have been compared with the
backup. If the specific repair documented by Git is required before a task
branch can be created, perform only that repair, then immediately list the
worktrees again and create and verify the task branch before ordinary work.

```sh
pwd
git rev-parse --show-toplevel
git rev-parse --git-dir --git-common-dir
GIT_OPTIONAL_LOCKS=0 git --no-optional-locks status --short --branch
git worktree list --porcelain -z
```

Compare the affected checkout path and its existing admin entry with the backup.
Use `git worktree repair` only for a case covered by the Git manual and after
that comparison. Run it from the documented location: with no path argument in
the moved main worktree when the main checkout moved; in the moved linked
worktree when one linked checkout moved; with every new linked-worktree path
from any worktree when several linked checkouts moved; or from main with every
new linked path when both main and linked worktrees moved. Read-only diagnostics
do not modify the main checkout. `git worktree repair` is the sole metadata
mutation allowed in main during recovery; it does not allow file edits or merge
resolution there.
`repair` can restore broken or outdated linking files when the matching
`worktrees/<id>` admin directory exists; it cannot reconstruct a missing common
Git directory or missing admin directory. If either is missing or cannot be
accounted for, stop and restore from the backup or a known-good clone. Do not
construct `.git` metadata by hand. After recovery, run `npm run repo:state` from
a verified task worktree.

Do not run `git worktree prune`, `git worktree remove`, or `git worktree move`
during recovery. They alter the registry or its evidence. After recovery, verify
refs, objects, worktree mappings, and every preserved dirty file before resuming
writers.

The Kilo shell-permission patterns for `rm`, `unlink`, and `git worktree repair`
are a speed bump only: they inspect command text and are not a filesystem
boundary. Scripts, aliases, or an unrecognized spelling can bypass them.

For primary references, see the [Git worktree manual](https://git-scm.com/docs/git-worktree),
which documents `repair`, and the [Git repository layout
manual](https://git-scm.com/docs/gitrepository-layout), which describes private
`worktrees/<id>` admin directories and their `commondir` relationship.
