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

Worktree `chats.count` in `WORKTREES.json` is **not** a usable staleness signal, and it is
worse than "mostly zero": sessions record the directory a chat _opened_ in, not the worktree it
worked in, so the inventory resolves the main checkout and leaves `chats.count` at 0 for
**every** worktree it reports. Use `session.directory` in the Kilo database directly.

**The liveness signals here are structurally blind, so `action` is not a verdict about
people.** The board is keyed on the git _branch_ and the sessions on the directory a chat
_opened_ in, which means an agent can be actively writing a worktree and leave no trace in
either — and `in-use` is itself derived from those signals. So `dispose` never means "nobody
is working here", and two byte-identical branches both read `at-risk` because `action` is
computed from ahead/behind and conflicts, so deleting one does not change the other's landing
situation. Read `mustNotPrune`, `prunable`, `ownership.liveWriterCount`,
`ownership.derivedLiveWorktrees`, `writeHistory.activeNow` and `board.agents[].live`; treat
the rest as a merge hint. (`derivedLiveWorktrees` is nested under `ownership`, not top level.)

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
call wearing a question's clothes, and the operator cannot tell the two apart. **No wall-clock
number appears in this document**, because every one of them goes stale: the staleness
threshold is the operator's to set, and everything below is written so that changing it is a
one-line edit rather than a re-derivation.

## 1 — Git facts

```bash
node scripts/worktree-inventory.mjs          # regenerate, then read it
```

`WORKTREES.json` is **untracked and gitignored** on purpose, so a fresh clone has none and
there is no commit step: regenerate it whenever you add or remove a worktree, and never
`git add -f` it. **Read `action` first**, and treat it as a point-in-time answer:

| `action`    | meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `land`      | clean tree, commits ahead of `main`, merges clean — land it             |
| `at-risk`   | work on no ref, the merge needs a human, or a curated finding disagrees |
| `dispose`   | on `main`, clean, nothing protects it — delete it                       |
| `in-use`    | an agent or session is active there — leave it alone                    |
| `keep`      | the main checkout — never a candidate                                   |
| `undecided` | cannot be told from what is known — do not remove it                    |

## 2 — Rank by staleness

Rank on the **derived** signals, not on the board alone: `writeHistory.activeNow` and
`ownership.derivedLiveWorktrees` catch what `board.agents[].lastSeenMs` cannot, which is an
agent that never registered on that branch at all. Board identity is the git branch and every
worktree is branch-keyed, so the board is a good signal _where it exists_ and silent where it
does not:

```bash
node -e "
const j=require('./WORKTREES.json');
const now=Date.now(), H=4*3600*1000;
const rows=j.worktrees
  .filter(w=>!w.isPrimary)
  .map(w=>{
    const board=(w.board&&w.board.agents)||[];
    const seen=board.map(a=>a.lastSeenMs||0);
    return {name:w.name,branch:w.branch,action:w.action,prunable:w.prunable,
            dirty:w.dirty,untracked:w.untracked,ahead:w.ahead,
            mustNotPrune:!!w.mustNotPrune,
            live:board.some(a=>a.live),
            writers:(w.ownership&&w.ownership.liveWriterCount)||0,
            ageH:seen.length?+((now-Math.max(...seen))/3600000).toFixed(1):null};
  })
  .filter(w=>!w.live && (w.ageH===null || w.ageH>=4))
  .sort((a,b)=>(b.ageH??1e9)-(a.ageH??1e9));
for(const w of rows)
  console.log([w.name,w.action,'prunable='+w.prunable,'dirty='+w.dirty,
    'untracked='+w.untracked,'ahead='+w.ahead,'mustNotPrune='+w.mustNotPrune,
    'liveWriters='+w.writers,
    'boardAgeH='+(w.ageH??'none')].join(' | '));
"
```

**Four hours with no board agent and no session activity is the operator's staleness
threshold**, and it is a parameter rather than a law: below it the worktree is merely quiet —
stop and re-check later. `boardAgeH=none` means no board agent has ever touched that branch.
That is **unknown, not stale** — the age has to come from the session query in step 3, and the
worktree is only a candidate once that says so too. Expect it to be common, and expect a live
main-checkout agent to be one of the reasons.

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

`session.path` holds the **empty string**, not NULL — `WHERE path IS NULL` matches nothing and
`WHERE path = ''` matches everything, so a query written from the wrong assumption looks like a
column that does not exist. Do not use it either way; `session.directory` is the link that
works.

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
  UNION ALL SELECT s.parent_id FROM session s JOIN up ON s.id=up.id
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

**The live database cannot catch the second mistake.** It currently holds subagents at depth 1
and **no grandchildren at all**, so the one-generation form returns the same rows as the
correct one and will keep passing until an agent spawns a subagent of a subagent — which is
exactly what the rule above says happens. Test any change to this query against a synthetic
nested tree, never against the live database alone.

Note also that `session.time_updated` is in milliseconds, so it must be divided by 1000 before
it becomes an age.

**`time_updated` is a bookkeeping field, not a conversation, and the two come apart.** It is
bumped by compaction, archiving, a title change, a token recount and other writes that are not
a message. A chat whose last _words_ were yesterday can therefore read as minutes old, which
inverts the rule below: the walk says LIVE, the sweep leaves the worktree alone, and a dozen
cases get classified `unproven` for no reason. It happened on a sweep where one root read
3.4 hours old — inside the threshold, so **not** dead by the operator's own rule — while its
newest non-synthetic text part was 21 hours old, and it was the writer of 22 of the stale
candidates.

So whenever a row lands **just inside** the threshold and is therefore deciding a case, confirm
it against what the session actually said before believing it:

```bash
DB="${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
sqlite3 -readonly "$DB" "
SELECT datetime(s.time_updated/1000,'unixepoch')  AS row_says,
       datetime(MAX(p.time_created)/1000,'unixepoch') AS last_spoke,
       CAST((s.time_updated - MAX(p.time_created))/60000 AS INT) AS gap_min
FROM session s LEFT JOIN part p
  ON p.session_id = s.id
 AND json_extract(p.data,'\$.type') = 'text'
 AND coalesce(json_extract(p.data,'\$.synthetic'),0) = 0
WHERE s.id = '<sid>'
GROUP BY s.id;"
```

A gap measured in **hours** is a bookkeeping bump and the session is dead; a gap measured in
**seconds or minutes** is real activity and the session is live. `synthetic` matters — the
empty prompts a harness injects are not the session speaking, and counting one is how a dead
chat manufactures a fresh timestamp.

A worktree is **DEAD** only when every row above is older than the threshold. One live row
anywhere in the family — root or subagent, up or down, a sibling's grandchild included — means
the worktree is **LIVE**. Leave it and move on.

A `parent_id` cycle or a self-parent makes this walk loop forever; the `up` leg has no guard.
There are none today, and a hang here is loud rather than silent, but if a query ever spins,
that is the first thing to look for.

A session with no `parent_id` and no discoverable parent cannot have its subagents enumerated
from the database, so its death is **unproven** unless `kilo_local_recall` and the board both
agree. Unproven is a skip, not a merge.

## 4b — The live overlay: a main-checkout agent can be driving a worktree right now

**Run this before the family walk, and expect it to be the step that decides the most
worktrees.** The board is keyed on the git **branch**, so a chat that ran in the main checkout
and then _drove into_ `.kilo/worktrees/<name>` to commit its salvage has no board entry there
at all. Its `lastSeenMs` is stale while the worktree is minutes old.

```bash
DB="${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
sqlite3 -readonly "$DB" "
SELECT s.id, s.title,
       ROUND((strftime('%s','now')-s.time_updated/1000)/60.0) AS min_ago,
       (SELECT count(*) FROM session c WHERE c.parent_id=s.id) AS kids
FROM session s
WHERE (s.parent_id IS NULL OR s.parent_id='')
  AND (strftime('%s','now')-s.time_updated/1000) < 14400
ORDER BY s.time_updated DESC;"
```

That is the live set, and **their subagents are live too** — a root that has gone quiet above
the threshold while a wide fan-out is still mid-flight is a live worktree owner. For each live
root, `kilo_local_recall(mode="search", query="<worktree-name>")`, the branch name, and the
feature; if a live session names the worktree, it is LIVE unless you can read the hit and show
it is only a read-only inventory row.

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

## 5 — Confirm with the board before writing anything

```bash
npm run swarm -- status
npm run swarm -- doctor --dry-run
```

The board is a SQLite file in the common git dir and is normally readable through the CLI; if
the raw path is not, say so in the report and lean on the session database plus recall. **Do
not silently report a clean board** — a board you could not read and a board that is empty mean
opposite things, and only one of them is good news.

A quiet agent is not a dead agent. **Preserve before reclaiming**: `git -C "$WT" status` and
`git -C "$WT" diff` first, then `doctor --dry-run`, then `doctor`. Force-release only a
session confirmed dead — never a network-lost one.

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
integration branch, so the two are alternative routes to one body of work. The e2e shard
branches `e2e/document-dialogs`, `e2e/harness-handoff`, `e2e/paint-tools` and
`e2e/selection-gestures` are each patch-id-contained in `integration/e2e-campaign-validate`,
so landing both routes is double work and landing neither drops recorded defects.

`git cherry <candidate> <shard>` answers this in one line: **empty output means the shard is
fully contained**, a `+` line means that patch is not in the candidate. Compare only the
shard's patches that `main` does not have — the candidate's own history is large, and diffing
it wholesale will tell you nothing:

```bash
git cherry integration/e2e-campaign-validate e2e/harness-handoff   # empty = contained
git cherry main e2e/harness-hand-off                              # '+ …'   = not on main
```

To see the patches themselves, restrict both sides to what is unique against `main` before
comparing patch-ids. Note what `git cherry` proves: **patch-id** absorption, not tree identity.
A branch can be patch-absorbed and still differ from `main` in its tree.

**Salvage commits carry test mutants.** `wip(salvage)` preserves whatever was in the working
tree, including deliberate damage. The branch `e2e/ws-3-layers-levels` reads
`return 'brightness(1.05)'` under the comment `// MUTATION: args ignored` in its
`src/contexts/layer-renderer.ts`, where main calls `buildLevelsFilter(args)` — committed, and
invisible to `merge-tree`. **Cite the function, not the line**: once the mutant is stripped the
line number dangles and sends the next reader looking for damage that is gone. Before any
salvage branch is landable, read the hunks that touch `src/`, not only the test files.

## 7 — Classify and act

Run these cases **in order**, and classify the worktree before touching it.

### (a) Clean tree — safe to delete

All three must hold: `git status --porcelain` is empty, `ahead === 0`, and `mergedIntoMain ===
true` (or the branch was never edited at all).

```bash
git -C "$WT" status --porcelain      # must print nothing
git rev-list --count main.."$BRANCH" # must be 0
git merge-base --is-ancestor "$BRANCH" main && echo on-main
```

**The third test is git-ancestor-only, and that leaves a shape nothing can ever delete.**
`classify.mjs` derives `LANDED` from `mergedIntoBase` alone — it consults no patch-absorption
signal — and `prunable` requires that too. So a branch whose every commit is **already on main
by patch-id**, but which is **not** a git ancestor because main re-landed the same content with
different surrounding context, is `unmerged-work` forever; if its merge conflicts, which it
usually will, it is `at-risk` forever; and `npm run dispose` refuses it on every sweep, naming
the action as the reason. Three were sitting in exactly that state while their owner families
were proven dead and their working trees clean. There is no sweep-time workaround, and there
should not be: the fix is a status in `classify.mjs`, not a bypass.

Until that status exists, **recognise the shape and report it rather than working around it**:

```bash
git cherry main "$BRANCH" | grep -c '^+'   # 0 => every patch is already on main
```

**Empty `git cherry` does NOT mean the merge is a no-op, and must not be used to justify a
deletion.** It proves patch-id absorption, not tree identity, and when main re-landed the same
change the three-way merge still conflicts — verified on all three stuck branches, where
`merge-tree` reports a conflict on every one. The test that does answer the question is content
equality on the branch's **own** touched paths:

```bash
mb=$(git merge-base main "$BRANCH")
for p in $(git diff --name-only "$mb".."$BRANCH"); do
  printf '%s %s\n' "$p" "$([ "$(git rev-parse "$BRANCH:$p" 2>/dev/null)" \
                       = "$(git rev-parse "main:$p" 2>/dev/null)" ] && echo same || echo DIFFERS)"
done
```

All `same` means landing changes nothing and the branch is genuinely absorbed. Any `DIFFERS`
means main holds the same _intent_ reworded, which is a **different** case: the branch has
nothing to contribute and nothing at risk, so it is clutter rather than work — but proving that
is a review, not an arithmetic fact, and it is what case (b) is for.

A zero-own-path branch (`git diff --name-only "$mb".."$BRANCH"` prints nothing) is the same
answer by construction, and `ahead > 0` does not contradict it: two commits that add and then
revert leave a tip tree byte-identical to the merge-base while `git cherry` still counts an
unabsorbed patch. Compare the **trees**, never the commit count.

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

**A refusal naming YOU is a finding, not an obstacle — and `--no-live-writers` does
not clear it.** `dispose` refuses `derived-live-writer` when the record's `derivedLive` is
true or `writeHistory.derivedChatIds` is non-empty, and both come from what a chat did
_inside_ the worktree. So the sweep that ran the gates in there, committed there, or merely
read there is the chat the refusal is about, and the suppression flag does not reach it: it
suppresses the verdict without erasing the evidence, on purpose. Report it and move on.
`docs/ORCHESTRATION.md` — §"`derived-live-writer` can refuse the session that is asking" — is
the one home; the Never list's entry against reaching for `git worktree remove` is what you do
instead. **Do not fold it into "skipped"**: a pending removal is a claim about a directory
that outlives the session.

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

### (c) Hard merge — mark it, move on, come back last

The agent doing the sweep **must** mark the branch before moving on:

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
- Report a branch as unmerged without checking `git cherry main <branch>`. `git cherry` proves
  patch-level absorption, which `git log` and `merge-tree` both miss: branches that read as
  unlanded work by every other signal can be fully absorbed. Re-derive the pairs yourself,
  because a branch that gets deleted takes its half of the citation with it.
- Count a branch's value by its commit count. A branch can be several commits of real fixes and
  a branch one commit of scratch.
- Release another agent's claim or file lock before `doctor` says it is expired.
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

**Post the material findings to the board** (`npm run swarm -- note`) when a truncated sweep
would otherwise mislead: a live owner, a planted mutant, a duplicate pair, or a branch already
absorbed. Those change other agents' decisions and outlive this session.

**Leave `main` clean — and note that a regenerated `WORKTREES.json` is not a footprint.** The
file is untracked, so there is nothing to commit and nothing to restore; `git status` cannot
even list it. Regenerate it whenever you add or remove a worktree and **never restore a stale
copy from `git`**: there is nothing there to restore from, and a stale inventory is worse than
none.
