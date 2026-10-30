---
name: stale-worktree-reclaim
description: Find worktrees abandoned by dead agents, prove the owning chat AND every one of its subagents are dead, check the live-session overlay first, detect duplicate and absorbed branches, and triage each one into delete, land, defer, or very-hard. Read-only until a case is classified.
---

# Stale worktree reclaim

A routine sweep for worktrees whose owning agent stopped working. The output is a **triage
decision per worktree**, and nothing else. It deletes nothing and merges nothing until a
worktree is classified.

The hard part is not finding stale worktrees — it is proving the agent is actually dead. A
quiet agent is not a dead agent, and a live agent's worktree that looks stale is the single
most expensive mistake available in this repository. `docs/ORCHESTRATION.md` is the authority
for this skill and for everything it defers to: the recovery procedure is its **"Unexpected
agent recovery"** section (_"Do not force-release a live lease merely because a network-lost
session is quiet"_), and `AGENTS.md` carries the gates. An earlier version of this document
cited a _Working with other agents_ section of `AGENTS.md` that no longer exists; if you find
a rule quoted here that you cannot locate in either file, treat it as a rule you do not know
rather than one that does not apply.

## The rule that governs everything below

**A chat counts as dead only when the chat AND every one of its subagents are dead.** A root
chat that stopped answering while a subagent is still writing is a **live** worktree.
Subagents are found with `session.parent_id`, and the walk is **transitive** — a subagent can
spawn its own subagent.

Worktree `chats.count` in `WORKTREES.json` is **not a complete ownership signal**: it counts
sessions by the directory they opened in, not every worktree they later used. A worktree may
therefore have `chats.count: 0` despite work done there; sessions opened in that worktree may
also be counted. Use `session.directory` to find sessions opened there, and use write/shell
history, the board and transcript search to cover the other cases.

**The liveness signals here are structurally blind, so `action` is not a verdict about
people.** The board is keyed on the git _branch_ and the sessions on the directory a chat
_opened_ in, which means an agent can be actively writing a worktree and leave no trace in
either — and `in-use` is itself derived from those signals. So `dispose` never means "nobody
is working here", and two byte-identical branches both read `at-risk` because `action` is
computed from ahead/behind and conflicts, so deleting one does not change the other's landing
situation. Read each record's `derivedLive`, `writeHistory.derivedChatIds`, `mustNotPrune`,
`prunable` and `board.agents[].live`. `ownership.liveWriterCount` and
`ownership.derivedLiveWorktrees` are fleet-level summaries, not per-record fields; use them to
cross-check the records, not to rank an individual worktree. `writeHistory.activeNow` reflects
suppression, so inspect `derivedChatIds` when an override is present. Treat the rest as a merge
hint.

**The board is keyed on the branch, and that is the trap this whole sweep exists to avoid.** A
chat that ran in the main checkout and then _drove into_ `.kilo/worktrees/<name>` to commit
its salvage has no board entry there at all — its `lastSeenMs` goes stale while the worktree
is minutes old. Step 4b, the live-session overlay, is therefore not a formality: it is the
step that decides the most worktrees, and it has to be re-run immediately before you act.

## 0 — The rules a landing runs inside

This sweep is read-only until a case is classified. Everything below binds the moment you
land something, and each rule exists because it has already cost real work here. `AGENTS.md`
and `docs/ORCHESTRATION.md` are the authorities; this is the short form.

- **Never resolve _or repair_ a merge conflict in the main worktree.** Bring `main` into the
  branch **in the branch's own worktree**, resolve there, run the gates there.
  `reset --hard` and `checkout --ours`/`--theirs` in `main` destroy another session's
  uncommitted work; `hash-object` and `update-index` write an index entry no later
  `git status` reconciles. After any interrupted merge, `git rev-parse -q --verify
MERGE_HEAD` before committing — an interrupted merge can leave `AUTO_MERGE` and `MERGE_MSG`
  behind with no `MERGE_HEAD`, and `git commit` then lands a single-parent commit that reads
  as a resolution.
- If `repo:state` reports only an orphan `AUTO_MERGE`, never edit `.git` or reset a dirty
  worktree to clear it. After proving the owner and descendants stopped, use the guarded
  recovery paths in `docs/ORCHESTRATION.md`; preserve-mode recovery requires the tracked
  worktree to match the marker and pins the dirty status before removing only the marker.
- **Stage only your own paths, and know which checkout you are in.**
  `git rev-parse --show-toplevel` before the first edit: the checkout path is not proof.
  **Never `git add -A` in a worktree** — the root is a different checkout at a different
  `HEAD`, so a file this branch never touched can be sitting there with the root's older
  content, and `-A` commits the reversion. Not one such revert is a conflict; this repository
  shipped seventeen, and a reviewer only catches the files their brief happened to mention, so
  compute the set difference from `docs/ORCHESTRATION.md` **before** the review.
- **Never `git stash`.** It is a shared unordered stack in the common git dir, and
  `git stash push` on a **clean** tree prints nothing, exits 0 and creates **no entry**, so
  the following `pop` takes somebody else's.
- **Claim before you touch anything, and claim the merge.** `npm run swarm -- claim <id>
--files <paths>` or `-- hold <path>`, and `-- check <paths>` before you edit anything a brief
  or a sibling names; `claim` and `hold` exit 4, `check` exits 1, and both name the holder. A
  refused hold names the holder — take their lock, never `--force` it. A held file is a queue,
  not a deadlock. **An unclaimed path looks free.** Claim **the merge**, not just the files:
  a branch about to land carries a hazard to every path in it, and no file claim expresses
  that. A sweep agent may not take over a write chat occupying a feature — only the operator
  may stop the writing chat.
- **A subagent you launch inherits your working directory.** Create the worktree before any
  fan-out and put its **absolute** path in every brief; a subagent's cwd only affects relative
  `bash`, while its `edit` and `write` take absolute paths, so the brief is what moves the
  work. Pass `model` **and** `provider` together — a free session that names a GPT model
  without a provider gets it resolved onto the gateway and dies at zero tokens.
- **Never open a browser window and never weaken a gate.** `npm run test:e2e` starts its own
  dev server on its own port, and a headed run fails a disjoint set of tests, so a failure
  that "goes away headed" is re-routed, not fixed. No skips, no raised thresholds, no deleted
  assertions, no re-recorded baselines.

## When a case will not classify, research it harder before you write it up

**An owner you cannot find is a research problem, not a result.** The two strings
`WORKTREES.json` carries are a starting point, not the search. Run `kilo_local_recall` in
`search` mode on the **feature** the branch names — its commit subjects, the paths in its
diff, the words the operator used — because a chat that ran in `main` and drove in here is
invisible to a query built from the worktree's own name. Read the candidates with
`mode: "read"`; that is the follow-up, not the search.

**When the chats still cannot answer it, go outside the repository.** Web search the problem
the branch names and read the official Adobe Photoshop documentation for the behaviour it was
implementing. How a feature is _supposed_ to work is frequently documented upstream, and
"what was this branch for" collapses into "what does Photoshop do here" faster than another
session query will. An external answer you can cite beats an internal guess.

**A branch far behind `main` whose conflicts outnumber its own commits is often cheaper to
write again than to reconcile** — the hunks you would spend the turn resolving are code `main`
has since rewritten anyway. Reimplement from the recovered requirement, on `main`, in a fresh
worktree under a new branch. What must never happen is a branch sitting in `VERY HARD` across
a dozen sweeps with nobody having asked whether the feature still deserves to exist.

**Time and compute are not the constraint here; autonomy and correctness are.** Escalating to
the operator is a **last resort**, and it is reached only once the wider chat search, the
family walk in step 4, the live overlay in step 4b and the external documentation have all
genuinely come up empty — and only for what remains a **policy or an authorisation** rather
than a fact you could have looked up. A question with no search log behind it is a judgement
call wearing a question's clothes, and the operator cannot tell the two apart. The two-hour
board-observation value in §2 is the default **stale-candidate threshold**, not proof that a chat
or worktree is dead. At two hours without a valid board observation, begin the full family and live
overlay checks; do not delete or land from age alone. Unknown signals never count as dead.

## 1 — Git facts

```bash
node scripts/worktree-inventory.mjs          # regenerate, then read it
```

`WORKTREES.json` is **untracked and gitignored** on purpose, so a fresh clone has none and
there is no commit step: regenerate it whenever you add or remove a worktree, and never
`git add -f` it. **Read `action` first**, and treat it as a point-in-time answer:

| `action`    | meaning                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `land`      | clean tree, commits ahead of `main`, merges clean — land it                                                                 |
| `at-risk`   | work on no ref, the merge needs a human, or a curated finding disagrees                                                     |
| `dispose`   | clean, and the classifier proves the branch's work is already represented by the base — dispose it with its recovery anchor |
| `legacy`    | a curated `legacy: true`: clean, and nobody will work on it again — drop the worktree, keep the branch                      |
| `in-use`    | an agent or session is active there — leave it alone                                                                        |
| `keep`      | the main checkout — never a candidate                                                                                       |
| `undecided` | cannot be told from what is known — do not remove it                                                                        |

## 2 — Rank by staleness

Rank on each worktree record's `derivedLive`, not the board alone. It combines session,
write, recent shell-I/O and board signals; unlike `writeHistory.activeNow`, it preserves the
pre-suppression evidence when an inventory liveness override is set. `ownership.liveWriterCount`
is a fleet-wide total, not a per-worktree field. `ownership.derivedLiveWorktrees` is a
fleet-level list; use `w.derivedLive` when iterating `j.worktrees`. Board identity is the git
branch and every worktree is branch-keyed, so the board is useful where it has a row and silent
where it does not:

```bash
node -e "
const j=require('./WORKTREES.json');
const now=Date.now();
const rows=j.worktrees
  .filter(w=>!w.isPrimary)
  .map(w=>{
    const board=(w.board&&w.board.agents)||[];
    const seen=board.map(a=>a.lastSeenMs).filter(Number.isFinite);
    return {name:w.name,branch:w.branch,action:w.action,prunable:w.prunable,
            dirty:w.dirty,untracked:w.untracked,ahead:w.ahead,
            mustNotPrune:!!w.mustNotPrune,
            derivedLive:!!w.derivedLive,
            writers:((w.writeHistory&&w.writeHistory.derivedChatIds)||[]).length,
            ageH:seen.length?+((now-Math.max(...seen))/3600000).toFixed(1):null};
  })
   .filter(w=>!w.derivedLive && (w.ageH===null || w.ageH>=2))
  .sort((a,b)=>a.ageH===null?(b.ageH===null?a.name.localeCompare(b.name):1):
              b.ageH===null?-1:b.ageH-a.ageH);
for(const w of rows)
  console.log([w.name,w.action,'prunable='+w.prunable,'dirty='+w.dirty,
    'untracked='+w.untracked,'ahead='+w.ahead,'mustNotPrune='+w.mustNotPrune,
    'derivedLive='+w.derivedLive,'derivedWriters='+w.writers,
    'boardAgeH='+(w.ageH??'none')].join(' | '));
"
```

**Two hours without a board observation makes a worktree eligible for stale-candidate triage**;
it does not prove death. Below two hours, leave it quiet and re-check later. `boardAgeH=none` means
there is no valid board timestamp; it is **unknown, not stale**, and the script sorts it after known
ages. The session/family checks in steps 3–4 and the live overlay in step 4b are still required
before classification or action. The inventory's 30-minute live-session and two-hour recent-I/O
signals are separate safety vetoes. `derivedLive` excludes worktrees with
recent signals, but absence of a signal never proves an owner is dead.

**`derivedLive` is not a complete session-family walk.** In the current inventory,
`chats.mjs` summarizes top-level sessions only; `session-db-snapshot.mjs` and
`writes.mjs` include recent child rows/calls and follow their parent chain upward,
but do not enumerate every descendant from a quiet root. The classifier also does
not use `readHistory` as a live signal. A recent read-only child can therefore be
present in `readHistory` while `derivedLive` remains false: `chats.mjs` excludes it
from `chatSummary`, and `classify.mjs` does not consume `readHistory` for liveness.
An active child can be present in the snapshot through recent parts but absent
from `chatSummary`, which includes top-level sessions only. If the family is
missing from the available session and part rows, that absence is unknown, not
evidence of death. Treat
`derivedLive: false`, `chats.count: 0`, and `action: dispose` as triage hints only.
The full recursive family query in §4 and the overlay in §4b are mandatory before
any action. If a child task has no delivered terminal result, or a family member
cannot be found/verified, classify the case as **unproven** and do not dispose or
land it. Kilo's internal `task` API has no list/status operation, so do not infer a
missing child result from session timestamps or launch a replacement task to poll.

`prunable: true` is the strict disposal test and is already `false` whenever `mustNotPrune` is
set, so a protected worktree never reaches a deletion.

**`mustNotPrune` vetoes landing as well as deleting**, and the second half is the one that
loses work. It records a human claim that something in the directory is unaccounted for, and a
merge recommendation is as much a claim about the contents as a prune recommendation is — so a
branch reading `action: land` with `mustNotPrune: true` is a contradiction, not a clean merge.
Read the entry's `note` **before** case (b), not after, and treat an unexplained flag as a
stop rather than a formality to clear.

## 3 — Find the exact chat that owned the worktree

`session.directory` is the authoritative link. This is the query the sweep depends on:

```bash
DB="${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
WT=/Users/bkalynovskyi/ph/.kilo/worktrees/<name>

sqlite3 -readonly "$DB" "
SELECT id,
       CASE WHEN parent_id IS NULL OR parent_id='' THEN 'root' ELSE 'subagent' END AS kind,
       datetime(time_updated/1000,'unixepoch') AS updated,
       (SELECT count(*) FROM session c WHERE c.parent_id = session.id) AS children,
       substr(title,1,60) AS title
FROM session
WHERE directory = '$WT'
ORDER BY time_updated DESC;"
```

Do not use `session.path` as the worktree link. In the inspected local database it was usually
the empty string (and never NULL in the sampled table); that observation is database-specific,
not a schema invariant. `session.directory` is the field to query, and an exact match finds
sessions opened in that worktree only.

### When that returns nothing, search by what the branch DID

**An empty result is the common case, not an edge case.** A chat that ran in the main checkout
and _drove into_ a task worktree leaves no session with that directory, which is exactly the
trap `docs/ORCHESTRATION.md` warns about. Search **wide**, in this order, because each step
catches what the previous one misses:

```
kilo_local_recall(mode="search", query="<worktree-name> <branch-name>")   # the easy case
kilo_local_recall(mode="search", query="<the feature, in the operator's words>")
kilo_local_recall(mode="search", query="<a file path the branch's diff touches>")
kilo_local_recall(mode="search", query="<a commit subject from the branch>")
```

A task brief often spells out `WORKTREE: /Users/.../<name>` plus the branch, which is what
makes the first query unambiguous — but a chat that asked for the feature and stopped, or a
subagent that researched it, shares no word with the branch name and is exactly where the
requirement usually lives. **An empty result is a fact about your query, never evidence that
nobody ever asked**, and the searches that came back empty belong in the report.

**A search hit is a lead, not a proof.** Confirm the owner before trusting its age: read the
session with `mode: "read"` and quote the line naming the worktree. Owner-from-a-search-hit
alone is how a live worktree gets misfiled as dead.

**Some owners are genuinely unfindable**, and that is a result, not a gap to paper over:
`fix/unit-tests` and `ps-integration` have no `directory` row at all, and name searches return
only reviewers of them. Their death is **unproven**, so they are case (d) — whatever value they
hold. Say so by name in the report; the operator decides, not the sweep.

## 4 — Prove the chat is dead, subagents included

Once you have a session id, walk **both** directions: up to the root chat that owns it, and
down to every subagent it spawned. The owning chat is very often itself a subagent of a root
that ran somewhere else entirely.

**Copy the id in full.** These are 30 characters, they are easy to truncate by eye, and a
truncated id matches zero rows — which the rule below reads as _every row is older than the
threshold_, that is, DEAD. A worked example that returns nothing teaches the exact error the
walk exists to prevent.

```bash
DB="${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
SID=ses_...

sqlite3 -readonly "$DB" "
WITH RECURSIVE up(id) AS (
  SELECT '$SID'
  UNION SELECT s.parent_id FROM session s JOIN up ON s.id=up.id
         WHERE s.parent_id IS NOT NULL AND s.parent_id!=''
),
down(id) AS (
  SELECT id FROM up
  UNION SELECT s.id FROM session s JOIN down d ON s.parent_id=d.id
)
SELECT (s.id='$SID') AS is_start,
       CASE WHEN s.parent_id IS NULL OR s.parent_id='' THEN 'root' ELSE 'subagent' END AS kind,
       ROUND((strftime('%s','now')-s.time_updated/1000)/3600.0, 2) AS age_h,
       substr(s.title,1,50) AS title, substr(s.id,1,24) AS id
FROM session s JOIN down ON down.id=s.id
ORDER BY s.time_updated DESC;"
```

Three properties of that `down` leg are load-bearing, and two plausible-looking alternatives
each break one of them. On a synthetic tree `ROOT→{A,B,ORPHAN}; A→GRAND; GRAND→GREAT`, seeded
at `B`, the whole family is six sessions and this is the only form that returns all six:

| `down` leg                                          | result                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `SELECT '$SID' UNION ALL … JOIN down` (the old one) | 1 row — the seed alone; siblings' subtrees missing                                  |
| `SELECT id FROM up UNION ALL … JOIN up`             | 5 rows, 4 unique — finds siblings, **drops grandchildren**, and duplicates the seed |
| `SELECT id FROM up UNION … JOIN down` (this one)    | 6 rows, 6 unique — the complete family                                              |

So: the downward leg must be seeded from **every ancestor** (`FROM up`) or a sibling's subtree
is invisible; it must then recurse against **itself** (`JOIN down`) or a grandchild is
invisible; and it must be `UNION`, not `UNION ALL`, or a session that is both an ancestor and
someone's child appears twice in the death-evidence table.

**A live database sample without grandchildren cannot catch the second mistake.** A
one-generation query can appear correct until an agent spawns a subagent of a subagent — which
is exactly what the rule above says happens. Test any change to this query against a synthetic
nested tree, never against the live database alone.

Note also that `session.time_updated` is in milliseconds, so it must be divided by 1000 before
it becomes an age.

**`time_updated` is a bookkeeping field, not a conversation, and the two come apart.** It is
bumped by compaction, archiving, a title change, a token recount and other writes that are not
a message. A chat whose last _words_ were yesterday can therefore read as minutes old, which
can invert the stale check. In one historical sweep, a root read 3.4 hours old — inside the
then-four-hour threshold — while its newest non-synthetic text part was 21 hours old, and it was
the writer of 22 stale candidates. Under the current two-hour rule, that row is an initial stale
candidate; the complete family walk and live overlay still decide whether it is actually dead.

So whenever a row lands **just inside** the threshold and is therefore deciding a case, confirm
it against what the session actually said before believing it:

```bash
DB="${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
sqlite3 -readonly "$DB" "
SELECT datetime(s.time_updated/1000,'unixepoch') AS row_says,
       datetime(MAX(CASE
         WHEN coalesce(json_extract(p.data,'$.synthetic'),0)=0 THEN p.time_created
       END)/1000,'unixepoch') AS last_real_part,
       ROUND((strftime('%s','now')-MAX(CASE
         WHEN coalesce(json_extract(p.data,'$.synthetic'),0)=0 THEN p.time_created
       END)/1000)/3600.0,2) AS last_real_part_age_h,
       CAST((s.time_updated-MAX(CASE
         WHEN coalesce(json_extract(p.data,'$.synthetic'),0)=0 THEN p.time_created
       END))/60000 AS INT) AS row_part_gap_min
FROM session s LEFT JOIN part p
  ON p.session_id = s.id
WHERE s.id = '<sid>'
GROUP BY s.id;"
```

A large `row_part_gap_min` suggests a bookkeeping update, but **the gap does not prove the
session dead**. Compare `last_real_part_age_h` with the same operator threshold used for the
family walk, and inspect recent tool activity, worktree write/shell history and the overlay.
Count all non-synthetic parts, not only text: a tool call/result can be recent activity even when
the session has not emitted new words. Synthetic harness prompts must not refresh the activity
timestamp. A missing real-part timestamp is unknown, not dead.

A worktree is **DEAD** only when every row in the complete family has verified real activity
older than the operator threshold. `time_updated` supplies the first-pass age; when it may have
been advanced by bookkeeping, use the non-synthetic part check and inspect other recent activity.
One recent or unresolved member anywhere in the family — root or subagent, up or down, a
sibling's grandchild included — means the worktree is potentially **LIVE**. Leave it alone until
the evidence resolves; unknown is not dead.

The `UNION` in both recursive legs deduplicates session IDs, so a self-parent or parent cycle
does not recurse forever. If a candidate session row is missing or its ID cannot be established,
the family cannot be proven from this query; use transcript/board evidence or classify death as
unproven. A root session with `parent_id` empty is normal: the downward leg still discovers its
children through their `parent_id` values.

## 4b — The live overlay: a main-checkout agent can be driving a worktree right now

**Run this before the family walk, and expect it to be the step that decides the most
worktrees.** The board is keyed on the git **branch**, so a chat that ran in the main checkout
and then _drove into_ `.kilo/worktrees/<name>` to commit its salvage has no board entry there
at all. Its `lastSeenMs` is stale while the worktree is minutes old.

```bash
DB="${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
sqlite3 -readonly "$DB" "
SELECT s.id, s.parent_id, s.title,
       ROUND((strftime('%s','now')-s.time_updated/1000)/60.0) AS min_ago,
       (SELECT count(*) FROM session c WHERE c.parent_id=s.id) AS kids
FROM session s
WHERE (strftime('%s','now')-s.time_updated/1000) < 14400
ORDER BY s.time_updated DESC;"
```

Keep this four-hour session lookback broader than the two-hour board-age threshold. It is an
evidence-gathering window for recent root and child activity, not the time after which a worktree
becomes a stale candidate. Do not shorten it when changing the board-age threshold.

This is a **recent-session candidate list, not a live verdict**: `time_updated` can be advanced
by bookkeeping, and a recent child can be active while its root row is old. Query all sessions,
not just roots, so recent subagents are visible. For each recent row, walk to its root and search
that session/family for the worktree name, branch and feature. If a session names the worktree,
treat it as potentially live unless you can verify the reference is only read-only. Confirm
session recency against real, non-synthetic part activity before deciding that a bookkeeping-only
update is the explanation.

**Re-run this list immediately before you act.** A live owner can appear _during_ the sweep,
and it will not look like one: a branch the sweep had just classified as unproven-dead gained
a root session claiming it while the sweep was still writing its report. The classification
that saved that branch was made minutes before its owner showed up. **Every liveness fact in
this document is a fact about when you ran the query.**

**`main` moves under a sweep too, and it does not announce itself.** The rule above protects a
_worktree_ from a late owner; nothing protects your _facts about a branch_ from another agent
landing the very work you are triaging. On a sweep, `main` advanced by a dozen commits
mid-flight and one of them was `Merge branch 'main' into fix/guard-ours-hole` — the branch
under review went from `ahead=1 cherryPlus=1 behind=9 dirty=4` to `ahead=0 cherryPlus=0
behind=1 clean` while the subagent was still reading it, because a live agent landed it. Every
downstream verdict (`unmerged-work`, `at-risk`, `salvage`, the conflict count, the own-file
list) was stale the moment it was computed, and a triage that trusted it would have re-landed
work that was already on `main`.

So treat `ahead`, `behind`, `cherry`, `action` and every conflict count as per-instant facts
too, and **re-derive them in the same breath as the liveness re-run**:

```bash
git rev-parse main            # the tip you measured against
git log --oneline -1 main     # and when it landed
```

If `main` has moved since the inventory was generated, **regenerate it and re-read the
classification** before acting on anything you decided earlier. A worktree that was `at-risk`
when you started may be `dispose` now, and one you were about to land may have landed an hour
ago. When two agents are sweeping at once this is not a rare race — it is the normal state, and
the second-arriving sweep is the one that has to notice.

## 5 — Inspect board state without triggering the sweeper

```bash
node scripts/worktree-inventory.mjs
npm run swarm -- doctor --dry-run
```

The inventory reads the common-dir board and session database and writes only the generated
`WORKTREES.json`; it does not renew or release board rows. `doctor --dry-run` reports expired
claims and locks without running the sweeper, but the CLI still updates the caller's own
`agents.last_seen` row. Use the inventory as the primary snapshot and report if either database
is unavailable — an unreadable board and an empty board mean opposite things.

**Do not use `npm run swarm -- status` as a read-only check during a sweep.** In the current
`scripts/agent-board.mjs`, every board-backed command except `doctor` runs `autoSweep()` first
(`help` and `--version` return before board setup). That renews the
caller's own rows and then releases expired claims and locks globally; it can erase the very
expired-row evidence a subsequent `doctor --dry-run` was meant to show. `note`, `check`, and
`release` also enter this path. Consult the implementation and `docs/ORCHESTRATION.md` before
running any board command with that side effect.

A quiet agent is not a dead agent, and an expired lease is not proof that the session family is
dead. **Preserve before reclaiming**: inspect `git -C "$WT" status` and `git -C "$WT" diff`,
inspect the full parent/child session family and live overlay, then map every finding from
`doctor --dry-run` to its owner. Do not run plain `npm run swarm -- doctor` unless every expired
claim/lock it will release has been verified dead or belongs to a worktree proven gone; it is a
global release pass, not a targeted check. Prefer the targeted release procedure in
`docs/ORCHESTRATION.md` after preserving the worktree. Never release a live or network-lost
session merely because its lease expired.

## 6 — Find the duplicate before you land anything

**Two branches can hold the same salvaged work**, and a sweep that lands both double-applies it
while a sweep that lands neither loses it. Check first; it is one command.

```bash
# byte-identical trees among branches not on main
git for-each-ref --format='%(refname:short)' refs/heads | while read -r br; do
  git merge-base --is-ancestor "$br" main 2>/dev/null || echo "$br $(git rev-parse "$br^{tree}")"
done | sort -k2 | awk '{t[$2]=t[$2]" "$1; n[$2]++} END {for(k in n) if(n[k]>1) print n[k], t[k]}'
```

Same tree is not the same as _safely_ deletable. Before dropping one, prove the survivor will
still exist: `git branch --contains <sha>`, `git for-each-ref --contains <sha>`, `git worktree
list`, and `git status --porcelain` on **both** worktrees including `--ignored`. A salvage
commit is frequently the _only_ ref in the repository holding the content, so "nothing else
contains it" is the expected answer, not a warning.

The subtler case is **containment**: a shard branch can be fully subsumed by a larger
integration branch, so the two are alternative routes to one body of work. Verify the exact refs
in the current repository; historical branch names and hand-written notes are leads, not
current evidence.

`git cherry <candidate> <shard>` answers this in one line: **empty output means the shard is
fully contained**, a `+` line means that patch is not in the candidate. Compare only the
shard's patches that `main` does not have — the candidate's own history is large, and diffing
it wholesale will tell you nothing:

```bash
git cherry <integration-branch> <shard-branch>   # empty = patch-id-contained
git cherry main <shard-branch>                  # '+' = patch not found on main
```

To see the patches themselves, restrict both sides to what is unique against `main` before
comparing patch-ids. Note what `git cherry` proves: **patch-id** absorption, not tree identity.
A branch can be patch-absorbed and still differ from `main` in its tree.

**Salvage commits can carry test mutants.** `wip(salvage)` preserves whatever was in the working
tree, including deliberate damage. `merge-tree` cannot tell whether the branch's code is
correct. Before any salvage branch is landable, read the hunks that touch `src/`, not only the
test files; inspect the relevant function and compare its behavior with current `main`. Historical
branch names and line numbers may no longer resolve after cleanup.

## 7 — Classify and act

Run these cases **in order**, and classify the worktree before touching it.
`(b-quarter)` sits between `(b)` and `(c)`: it is a judgement about the future, so
it is a decision rather than something git reports.

### (a) Clean ancestor — safe to dispose

This is the strict ancestry case. All three must hold: `git status --porcelain` is empty,
`ahead === 0`, and `mergedIntoMain === true` (or the branch was never edited at all).

```bash
git -C "$WT" status --porcelain      # must print nothing
git rev-list --count main.."$BRANCH" # must be 0
git merge-base --is-ancestor "$BRANCH" main && echo on-main
```

This is not the only inventory-supported disposal case. `classify.mjs` also reports a clean
branch `LANDED` when every comparable non-merge commit is patch-id absorbed, or when a verified
conflict-free merge produces exactly the base tree. Those cases can have `ahead > 0` and
`mergedIntoMain: false`.

### (a-bis) Patch-absorbed or net-no-op — follow the inventory

Do not equate patch-id absorption with tree equality or a no-op merge. They are different proofs.
The current classifier accepts complete patch absorption for **disposal**, not for landing: it
requires a clean tree, no `mustNotPrune` finding, and the current inventory's `action: dispose`.
For a non-ancestor patch-absorbed branch, `npm run dispose -- <name> --dry-run` must show that it
will anchor the exact tip under `refs/keep/disposed/` before using guarded `git branch -D`. That
anchor preserves the branch tip for recovery even though patch IDs do not prove byte-identical
trees. The disposal program also rechecks live ownership, claims/locks and other preflight gates.

For a net-no-op merge, the disposal proof is tied to the inventory's recorded `mainHead`; if
`main` moved, regenerate and reclassify. Never use `git cherry` alone to authorize deletion or a
merge, never bypass an `action`, `prunable`, `mustNotPrune` or dispose refusal, and never infer
that a patch-absorbed branch is tree-identical. If the current inventory does not say `dispose`
or the dry run refuses, stop and report the evidence.

Delete the worktree **and** its branch, then regenerate the inventory — through
the one program that will do it:

```bash
npm run dispose -- <name> --dry-run     # names the signal that refuses, if any
npm run dispose -- <name>
node scripts/worktree-inventory.mjs      # the verdict you acted on is now stale
```

**Never hand-write the list.** `dispose-worktree.mjs` re-reads the generated
`action`, the board's claims and file locks, and the session database, and it
anchors the branch at `refs/keep/disposed/<name>` before it deletes anything. A
triage that classifies worktrees correctly and then deletes them from its own
list has thrown the classification away, which is exactly what happened on
2026-10-01: a sweep read a merge commit whose subject carried a branch's _name_
and disposed of a worktree a live chat was using (the full account is in the
header of `scripts/dispose-worktree.mjs`). The
cleanliness probe it ran first — `git status --porcelain` — reads the same for an
abandoned worktree and a busy one, so it could not have caught that.

**A refusal you expected is a finding, not an obstacle — and it may not name you.** Only the
write arm of `derived-live-writer` names a chat; every other arm prints "a chat". Report it and move
on. `docs/ORCHESTRATION.md` — §"`derived-live-writer` can refuse the session that is asking" — is
the one home for the mechanism, and the Never list's entry against reaching for the removal command
by hand is what you do instead. **Do not fold it into "skipped"**: a pending removal is a claim
about a directory that outlives the session.

**0 commits ahead of `main` is not evidence a worktree is disposable.** It is the single most
expensive mistake available here: such a branch can hold uncommitted work that exists on no ref
at all. `git status --porcelain` being non-empty is the only check that sees it, and the
generator gives that shape its own status, `uncommitted-only`, which is never prunable whatever
`curated.mjs` says — and the suite re-derives that set from the live worktrees so it stays
true.

### (b) Easy merge — at least try a dry run

```bash
git merge-tree --write-tree --name-only main "$BRANCH"; echo "exit=$?"
```

This performs the merge in a scratch object store and touches **no** working tree, index or
ref. Exit `0` is clean; exit `1` prints the conflicting paths.

**Roughly a handful of files means easy. Dozens means hard — go to (c).** That is a judgement
about effort, not a rule you can automate, and the count moves as `main` moves: the same branch
can merge cleanly this hour and conflict in a dozen files after someone lands. Re-derive the
number for the branch in front of you rather than trusting a figure recorded here, and treat a
_decrease_ as a reason to re-read the diff rather than as evidence the branch got simpler.

For an easy merge, land it properly: merge `main` into the branch **in the worktree**, run the
gates there, land into `main`, and re-run the gates on `main`. Orchestrate every step —
conflicts, an independent review of the resolution, and the gates. See "Landing" in
`docs/ORCHESTRATION.md`, and remember to check `mustNotPrune` before you start.

**"Easy" is a file count, not a safety verdict, and both failure directions are real.** A
small conflict set can still carry a `wip(salvage)` snapshot of dozens of never-reviewed
files, and a one-file conflict can pin a hard-coded constant that `main` has since replaced with
a derivation — the export oracle is the case in this repository: a branch that merges into
`e2e/helpers/canvas-helpers.ts` cleanly while reintroducing the literal that main's own
`containFit` was written to eliminate. **Ask what a hard-coded number in the branch is doing
that `main` now computes.** The gate for case (b) is that the _content_ is right, not that the
merge is mechanical.

### (b-bis) Duplicate — drop one, keep the other

Prove the two branches hold identical content, then delete exactly one:

```bash
git rev-parse "$KEEP^{tree}" "$DROP^{tree}"            # equal trees
git diff --stat "$KEEP" "$DROP"                       # must be empty
git log main.."$KEEP" --no-merges --format='%s'        # same commit list
git branch --contains <drop-sha>                      # only the dropped ref
```

Delete the worktree **and** its branch together with `npm run dispose -- <name>`
— one call per half, never a loop over a list you wrote — and confirm the
survivor is untouched afterwards. Deleting the _other_ one, or both, destroys the
only ref holding the content — a salvage commit is frequently the sole holder,
with no tag and no remote-tracking ref. **Never delete both halves of a duplicate
pair**, and note that `dispose` anchors whatever it removes at
`refs/keep/disposed/<name>`, so a half you deleted by mistake is one `git branch`
away.

### (b-quarter) Legacy — keep the branch, drop the worktree

**A stale branch nobody will work on again, kept for the small chance it matters.**
Set it by hand; nothing derives it, because "nobody will need this" is a judgement
about the future and no git fact can produce one. Add `legacy: true` and a `note`
saying which branch, why it is kept, and what would make it worth revisiting, to
its entry in `scripts/lib/worktree-inventory/curated.mjs`. Then:

```bash
npm run dispose -- <name> --dry-run     # says the branch will be KEPT
npm run dispose -- <name>
node scripts/worktree-inventory.mjs
```

The worktree goes; the branch stays, reachable with `git branch <name>`. Git holds
a branch with no worktree, so this costs one ref and saves a checkout, its
`node_modules` and its `dist/`.

**Do not use it for a branch holding uncommitted work.** `legacy` authorises
deleting a directory, and uncommitted changes exist in no commit and no ref, so
`classify` ignores the flag on a dirty worktree and reports `at-risk`. That is the
right answer and it is not a bug to work around — save the work first, or leave the
entry off. A `legacy` claim is also refused when `mustNotPrune` is set: one says
the work is not accounted for, the other says it is and will never be used, and the
first wins.

**It is not `at-risk`, and that is why it exists.** `at-risk` reads as "a human
must act before anything can be lost", so a branch nobody intends to act on filed
there sits on the list a sweep reads first, forever. `legacy` also suppresses a
clean merge verdict — it says do not merge it either.

**Two things it will not do for you.** It does not keep the worktree, and it does
not make the branch worth landing later. A branch kept this way has to be _chosen_
again by a human reading the note, which is the point: the 1% chance is only worth
paying for if someone can recognise it when it comes up.

### (c) Hard merge — mark it, move on, come back last

The agent doing the sweep **must** mark the branch before moving on, but only after checking the
global board-sweep side effect described in §5. `swarm note` is a non-`doctor` command and runs
`autoSweep()`; if any expired claim/lock still has an unverified owner, do not invoke it. Record
the deferred note in the report and resume after the holder is verified.

```bash
npm run swarm -- note "problematic merge: <branch> has N conflicting files; deferred to the hard-merge pass"
```

Do **not** attempt a deep merge while easy worktrees remain — a hard merge consumes the whole
turn and strands the easy wins.

Only when **no easy worktree is left** does the sweep return for these. Then treat one branch
at a time, and do it thoroughly: read the whole diff, understand the requirements behind it,
deep-dive the conflict, run the gates, and get an independent review of the resolution. **Or
reimplement it** — see the ladder above; reimplementation is a first-class answer here, not a
failure, and the recovered requirement is the specification.

**If it fails review or a gate, mark it VERY HARD and skip it** — do not keep retrying it in
later sweeps:

```bash
npm run swarm -- note "VERY HARD: <branch> — <what failed>. Skip in future sweeps."
```

### (d) Skip

Any branch already marked VERY HARD, anything with an active board agent, and anything whose
death cannot be proven. Skipping is a correct outcome — say so explicitly in the report rather
than silently dropping it.

## Never

- `git stash`. A shared unordered stack in the common git dir; `stash push` on a **clean** tree
  prints nothing, exits 0 and creates **no entry**, so the following `pop` takes somebody
  else's.
- Resolve a conflict in the main worktree, or repair one there with `reset --hard`,
  `checkout --ours/--theirs`, `hash-object` or `update-index`.
- `git add -A` in a worktree whose root checkout is dirty. Stage the paths `git status` named,
  and compute the set difference from `docs/ORCHESTRATION.md` before the review.
- Hand-edit `WORKTREES.json`. It is **untracked and gitignored**, so the edit is lost on the
  next run, a hand-edited `prunable: true` is a licence to delete, and `git add -f` it makes the
  inventory suite red. Regenerate with `node scripts/worktree-inventory.mjs`.
- Delete a worktree without reading its `curated.mjs` entry first — a `mustNotPrune` finding
  there records work that git cannot see, and it vetoes landing as well as deletion.
- Trust a `curated.mjs` note about another branch. These notes go stale silently: three once
  said "superseded by `integration/e2e-campaign-final`" (a branch that no longer exists) and two
  described work as "uncommitted, on no ref" hours after a live agent had salvage-committed it.
  Re-derive the claim against the tree; the note is a lead.
- Grep a path you have not confirmed. **Verify a path with `git ls-tree <ref> <dir>/` before a
  grep on it**, and read blobs with `git cat-file -p <blob>` when `git show <ref>:<path>` refuses
  the path. The defects file here is `e2e/OPEN_PROBLEMS.md`, with an **underscore**; the
  hyphenated spelling does not exist, and a grep that returns nothing reads exactly like "main
  has no such defect". An earlier version of this bullet asserted the opposite — it named the
  nonexistent spelling as the real one, in the very sentence about not trusting an unconfirmed
  path, so the lesson is stronger than the rule: **confirm the path, and expect your memory of
  it to be the thing that is wrong.**
- Do not call a branch unmerged without checking patch equivalence (`git cherry main <branch>`
  or the fresh inventory's `patchEquivalence`). `git cherry` proves patch-level absorption, not
  tree equality or a merge no-op; merge commits may be unclassifiable by patch ID. Re-derive
  current refs yourself because branches and their evidence can disappear during cleanup.
- Count a branch's value by its commit count. A branch can be several commits of real fixes and
  a branch one commit of scratch.
- Release another agent's claim or file lock before `doctor` says it is expired, or treat expiry
  alone as proof that the session family is dead; see §5.
- Run `npm run swarm -- status` or another board-backed non-`doctor` command as an early “read”: the CLI
  invokes `autoSweep()` first and can release expired claims/locks across the board. Use the
  generated inventory and `swarm doctor --dry-run` first, and resolve every expired holder before
  using a command that sweeps.
- Run plain `npm run swarm -- doctor` as a routine triage command. It releases every expired
  board claim/lock, not only the worktree currently under review; lease expiry alone is not the
  full session-family death proof required by this procedure.
- Route around a `dispose` refusal. Every refusal names the signal that produced
  it, and the one you are most likely to hit is **you** — see case (a). The gate
  is the only thing standing between a sweep and the 2026-10-01 incident, and a
  refusal you argued with is a refusal that taught its reader to discount the
  next one.

## Report

Per worktree: name, branch, age, dead-chat evidence (session ids and their state), the
classified case, and the action taken or the reason it was skipped. State any worktree whose
death could **not** be proven — an unproven death is the finding, not a footnote.

**Lead with the live count.** The number that matters is **how many candidates were live**,
because that is the work the sweep did _not_ do and no summary of cases communicates it. Then
state what the sweep actually changed, and if that is "nothing", say so first.

Three sections, and each needs a name in it:

1. **Live** — every worktree a live session owns, and which live session. A later reader must
   be able to tell the difference between "quiet" and "claimed".
2. **Acted on** — what was deleted, merged or landed, with the evidence that made it safe. If
   a decision needs the operator, put it here as a question with the two options and the cost
   of each, and with the searches that came back empty.
3. **Unproven** — every branch whose death could not be established, whatever its value. Never
   fold these into "skipped".

**Post material findings to the board** (`npm run swarm -- note`) when a truncated sweep would
otherwise mislead: a live owner, a planted mutant, a duplicate pair, or a branch already
absorbed. Those change other agents' decisions and outlive this session. Because `note` invokes
`autoSweep()`, first resolve every expired claim/lock from `doctor --dry-run`; if any remains
uncertain, do not risk releasing it just to post a note — put the exact note in the report and
mark it unposted.

**Leave `main` clean — and note that a regenerated `WORKTREES.json` is not a footprint.** The
file is untracked, so there is nothing to commit and nothing to restore; `git status` cannot
even list it. Regenerate it whenever you add or remove a worktree and **never restore a stale
copy from `git`**: there is nothing there to restore from, and a stale inventory is worse than
none.
