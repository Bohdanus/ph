---
name: hard-merge
description: Merge two branches that independently implemented overlapping features - recover the real requirements from the chat history, arbitrate every conflict against Photoshop and the web platform instead of against the hunk, ask the human in a file rather than in chat, and prove the merge lost nothing. Use when asked to merge, reconcile, resolve conflicts, or combine two branches or agents in this repo.
---

# Hard merge

Two agents implemented overlapping features at the same time, in separate branches. One landed.
The second has to be merged — and the conflict count is not the hard part. The hard part is that
**neither side was wrong**, each is the better answer to a different half of a requirement neither
of them ever wrote down, and `git checkout --ours` is a coin flip dressed as a decision.

**`AGENTS.md` is the authority, and it is already in context.** This document restates a rule from
it only where the failure mode needed naming, and in those places it defers rather than
redefines: the worktree rule, the gates, the headed-browser refusal and the handoff lifecycle are
`AGENTS.md`'s, and nothing here changes them. **Where the two disagree, `AGENTS.md` wins and this
document is wrong** — including on the two points where this file takes a position `AGENTS.md`
leaves open: the questions file's home, and the five sweeps.

Every `file:line` here was read against `main` at `766b0268` on 2026-09-29. **Re-verify before you
rely on one**, and name a symbol as well as a line wherever you can: a stale citation sends the
next session after a bug that does not exist. Every commit cited is real and in this repository —
`git show <sha>` prints the merge body it is quoted from.

## When to use this

- Two root agents (chats a human started) worked overlapping features in separate branches, and one
  landed first.
- A branch is behind `main` by enough that `git merge` reports content conflicts in source, not
  only in generated files.
- You are the second of two agents and the other one is already on `main`.
- A reviewer says "resolve the conflicts" and you cannot tell, from the diff, which side is right.

Not for: a fast-forward, a rebase of a clean branch, a mechanical `git rerere` replay (which this
repository does not use — [Phase 0](#phase-0--decide-the-tool)), or the ordinary
`main`-into-branch merge that only conflicts in generated output.

## The shape of the task

| Phase                                                         | What it decides                                               | Gate before moving on                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [0](#phase-0--decide-the-tool)                                | merge, rebase, a third design, or a declared reimplementation | `range-diff` output pasted, and the tool choice written with its evidence                     |
| [1](#phase-1--recover-the-requirements-from-the-chat-history) | what each branch was actually _for_                           | every requirement traced to a quoted human turn, an Adobe citation, or an `AGENTS.md` rule    |
| [2](#phase-2--fill-the-ledger-from-the-source-of-truth)       | the disputed requirements, arbitrated                         | every open question is classified: answered, defaulted, or filed                              |
| [3](#phase-3--map-the-overlap-surface)                        | the real conflict set                                         | candidates separated from conflicts, by the merge commit itself                               |
| [4](#phase-4--classify-every-conflict)                        | what kind of clash each one is                                | every conflicted hunk carries a class from the taxonomy                                       |
| [5](#phase-5--ask-the-human-in-a-file)                        | the questions only a person can answer                        | no blocking question is left in chat, and every one carries the searches that came back empty |
| [6](#phase-6--resolve-in-the-order-that-loses-nothing)        | the merged tree                                               | no whole file taken with `--ours` or `--theirs`                                               |
| [7](#phase-7--prove-the-merge-lost-nothing)                   | the silent-merge invariants                                   | all five sweeps pass: marker, count, duplicate-key, citation, re-anchor                       |
| [8](#phase-8--the-gates)                                      | that the tree is correct                                      | `tsc`, `build`, `lint:check`, `test`, `test:e2e:unit`, `test:e2e`                             |
| [9](#phase-9--the-resolution-record)                          | the durable record of the merge                               | the merge body names every judgement call, using this repository's own vocabulary             |

Then: [the conflict taxonomy](#appendix-a--the-conflict-taxonomy) ·
[the decision vocabulary](#appendix-b--the-decision-vocabulary) ·
[the questions file](#appendix-c--the-questions-file) ·
[feasibility classes](#appendix-d--the-web-platform-feasibility-classes) ·
[the trap list](#appendix-e--the-trap-list) ·
[what to distrust](#appendix-f--what-to-distrust-in-this-document).

## The non-negotiables

These are the ones that change outcomes. Each is expanded where it is used.

1. **Union is the default. A side is taken only with a named reason.** Two agents each found
   something the other did not. "Taking a side" is the failure mode, not the shortcut.
   → [Phase 6](#phase-6--resolve-in-the-order-that-loses-nothing)
2. **A clean merge is not a correct one.** git's three-way merge has lost a whole `HANDOFF.md`
   section in this repository while reporting success. Diff the _semantic invariants_, not the
   conflict markers. → [Phase 7](#phase-7--prove-the-merge-lost-nothing)
3. **A test whose premise the merge removed is corrected, never deleted.** It is rewritten against
   what is now true, not against a number that happens to hold.
   → [Phase 6](#6-corrected-rather-than-deleted)
4. **Re-derive a citation from the sentence, never shift the number.** Every merge moves line
   numbers in every file it touches, and a `grep` sweep does not catch it — the text at the stale
   line still reads plausibly. → [Phase 7](#74-the-citation-sweep)
5. **A generated file is regenerated, never hand-merged.** This repository's standing case,
   `WORKTREES.json`, is now untracked: the rule was followed far enough to delete the conflict
   instead of documenting it. For any generated file that is still tracked, a hand-merge preserves
   a document no run of the generator would ever produce.
6. **Never resolve in `main`. Never `git stash`.** Both are `AGENTS.md`, and both are stated here
   only because the second one has a failure mode that is silent.
7. **An agent may propose a resolution. It may never be the judge of one.** On a benchmark of real
   React-family merge conflicts, accepting both sides scored **48/86**; the best frontier model
   scored **36/86**. Textual concatenation of the two branches beat every model at preserving both
   branches' behaviour. → [Phase 7](#74-the-citation-sweep)
8. **A blocking question is a file, not a chat message.**
   → [Phase 5](#phase-5--ask-the-human-in-a-file)
9. **Escalating is the last resort, and it is never the first move.** Time and compute are almost
   unlimited here; the two things that are not are autonomy and correctness, so a question routed to
   the operator is a question the research had not finished. Re-read the transcripts, search chats
   past the ids you were handed, go to Adobe and to industry practice, and only then file the
   question — with the searches that came back empty written into it.
   → [Phase 5](#phase-5--ask-the-human-in-a-file)
10. **Reimplementing is a first-class answer, not a failure.** Two implementations of one
    requirement that have drifted apart are sometimes cheaper to replace than to arbitrate, and a
    clean merge of two half-understood implementations is a seam with a green `tsc` on it.
    → [Phase 6](#5-a-third-design-when-neither-side-is-right)

## How to read this document

Read the phase you are in. Each phase opens by naming the source of truth it defers to — a
`file:line`, a real commit, a quoted human turn — so a claim can be checked rather than believed.

The phases are ordered by **destroyability**, not by chronology. Phase 1 and Phase 2 change nothing
and are the two that prevent every expensive mistake; Phase 6 is the only one that writes.

---

## Before any phase — where this merge runs

`docs/ORCHESTRATION.md` is the authority for everything in this section, and this skill restates
only what a merge makes sharper. The rest of this document claims `AGENTS.md` carries the
worktree rule and the gates; it does carry them, but a merge is the case where carrying them in
your head is not enough, because a merge has a landing and a fan-out and neither is visible from
inside a diff.

**Check where you are before anything else: `git rev-parse --show-toplevel`.** A merge resolved in
the main worktree puts an unreviewed resolution into a checkout three other sessions are committing
into, so the merge runs in the branch's own worktree, `main` is merged **into the branch** first,
and the commit that lands on `main` is a fast-forward or a mechanical two-parent commit with nothing
left to decide. `scripts/main-worktree-guard.mjs` refuses a commit made from the main worktree —
it runs first in `.husky/pre-commit`, ahead of `gate:commit`, and a landing never reaches it
because `git merge` runs `pre-merge-commit` and a fast-forward runs no hook at all. It does not
stop the write, only the commit.

**Every subagent this skill sends out inherits your working directory.** The worktree exists before
the fan-out and its **absolute path is in the brief** — a subagent's cwd only affects relative
`bash`, so the brief is the thing that moves the work. Pass `model` **and** `provider` together, per
`AGENTS.md`'s model policy; a fan-out launched with a bare model name resolves onto whatever the
launching turn is using, and on a free orchestrator that has killed subagents at zero tokens. **This
skill's delegation splits by file, never by hunk**, and never puts two writers on one file — and the
board cannot see that collision at all, because its identity is the git branch and `holdFiles`
refuses only a _foreign_ lock, so it surfaces as a clobbered index rather than a refusal. **Claim
the merge, not just the files:** a branch about to land carries a hazard to every path in it, and no
file claim expresses that.

**Two traps that belong to the landing rather than to the resolution.** Never `git add -A` in a
worktree whose root checkout is dirty: the root is a different checkout of a different `HEAD`, so
`-A` commits a deliberate reverting of whatever `main` has since done to those files, with **no
conflict marker** — this repository shipped 17 such reverts and not one of them was a conflict. Run
the `comm -13` set difference in `docs/ORCHESTRATION.md` **before** the review, because a reviewer
only catches the files its brief happened to mention. And a red `tsc` in the main worktree may be
another session's half-written change rather than a broken `main`; check the _committed_ state in a
throwaway worktree before you touch a path you have not touched.

**The gates and the board.** `npm run test:e2e` starts its own server on a port it picks, and
`npm run test:e2e:raw` from a worktree attaches to whatever holds `:5173`. The cross-session channel
is `npm run swarm`, **not** Kilo's `board_read`/`board_post`: `board_read` reports `messages: []`
outside a fan-out on purpose, `board_post` about a worktree usually returns `total: 0, active: 0`
because it only reaches the sessions a fan-out spawned, and **a `board_read` that returns nothing
is not evidence that nobody is working.**

---

## Phase 0 — decide the tool

**A hard merge is not a merge until `range-diff` says it is.** Two branches that took different
routes to the same intent rebase and cherry-pick cleanly. Two branches that did _different_ work
in the same files cannot, and a merge is the only honest tool.

```bash
git range-diff <base>..<branch-a> <base>..<branch-b>
```

Read the correspondence column. In the real incident, `git range-diff` between the two branch tips
returned **every line `-` / `>`: zero pairs** — four panel commits against nine toolbar commits,
not one corresponding commit. That single output is the diagnosis — these were not two versions of
one change, they were two different changes to the same files — and it predicts a large conflict
count before a single file is opened. (The branches are merged now, so this exact invocation is no
longer reproducible; re-run it on the next incident and keep the output.)

| `range-diff` says     | Do this                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| Mostly `=` pairs      | **Rebase or cherry-pick.** Stop reading this document; you do not have a hard merge. |
| Mixed `=` and `-`/`>` | Merge, but cherry-pick the corresponding commits first so the merge is small.        |
| All `-` / `>`         | **Merge, and expect conflict.** Continue.                                            |

**Then record the base, because every later command needs it and it is per-merge, not global:**

```bash
git merge-base <a> <b>                 # the shared ancestor
git log --format='%h %P %s' -3 <a>     # parents: first = the side, second = main
```

Two traps here, both of which cost real time in this repository:

- **A branch tip is not always a merge's first parent — it depends which way the merge went.** A
  branch landing on `main` with `--no-ff` has `main` as `^1`; a branch merging `main` into itself
  has the branch as `^1`. **The two merges in this incident have opposite orientations**
  (`1eb275a1` is branch-into-`main`, `e473a45f` is `main`-into-branch), so any blanket "always take
  `^2`" rule picks the wrong one of them. Read the merge's subject line. →
  [Appendix E](#appendix-e--the-trap-list)
- **The base is per-merge.** A branch that has already merged `main` has a _different_ merge-base
  against a newer `main` than the one its own in-branch merge used.

**This repository does not use `git rerere`, and must not turn it on.** Verified: `rerere.enabled`
is unset in every scope, and no `.git/rr-cache` exists. The reason is a shared-path hazard, and it
is the same class as `git stash`:

```bash
git rev-parse --git-path rr-cache   # resolves to the SAME path in every worktree
```

`rr-cache` is the one state path that does **not** fork per worktree — `HEAD`, `index`, `MERGE_HEAD`
and `logs/HEAD` all do, and the `rr-cache` path resolves identically from each of them while `HEAD`
resolves differently. With ~60 worktrees sharing one common git dir, a resolution recorded by one
agent becomes an autofill candidate for every other, and `git rerere clear` (which
`rebase --abort` and `am --abort` run for you) wipes the shared cache for all of them. If you want
rerere, scope it to the one invocation: `git -c rerere.enabled=true merge main`, or point
`GIT_RR_CACHE` at a per-worktree path. **Treat a pre-existing shared `rr-cache` as a reason to stop
and re-resolve by hand.**

**Gate.** The `range-diff` output is in the working notes, the base sha is recorded, and the tool
choice is written down with the evidence that forced it. Everything downstream assumes a merge.

---

## Phase 1 — recover the requirements from the chat history

**This is the phase that makes the merge correct, and it is the one agents skip.** A conflict is
not a question about code. It is a question about a requirement that was never written down, and
the only place that requirement exists is the operator's own words in a chat transcript.

**A hard merge is where effort is nearly free and the requirement is not.** Phases 1 and 2 change
no file and gate every expensive mistake after them, so a requirement you failed to recover is the
one input nothing downstream can buy back: six gates over a tree built on a guessed requirement
prove nothing about the product. **When the requirement is hard to recover, spend more effort
recovering it — the effort is not the cost, the wrong merge is.** Re-read the transcript, widen
the search past the ids you were handed, and put the ledger's own question back to the tree; each
of those is cheap next to a resolution that answers a requirement neither branch was ever asked.
**"I could not find it" is a finding to report, never a reason to stop looking** — and the negative
result, together with the searches that produced it, belongs in the ledger whether or not it
settles the row.

The requirements for this repository are in four places, in this order of authority:

| Rank | Source                                                        | Why it ranks there                                                                                               |
| ---- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | **The operator's own turns, quoted verbatim**                 | A human's instruction outranks both branches' reasoning, and both branches reasoned from their own reading of it |
| 2    | `AGENTS.md`, `docs/PHOTOSHOP-UX.md`, `docs/TOOLS-TOO-HARD.md` | `AGENTS.md` is the stated authority; the other two are the Photoshop contract in written form                    |
| 3    | Adobe's own documentation, quoted                             | This app is a clone, so Adobe is correct by definition                                                           |
| 4    | Your own recollection of what the agent was asked             | **The lowest rank, and it is not a small gap.** Recall is lossy in exactly the places that matter                |

**Read the transcripts before you read the diffs.** Reading the diff first anchors you on the
implementation, and every requirement you derive afterwards is contaminated by the two candidates
you are supposed to be arbitrating between.

### Where the transcripts are

Kilo sessions live in `~/.local/share/kilo/kilo.db` (get it with `kilo db path`). The schema is
`session` → `message` → `part`, with the text in `part.data` as JSON at `$.text` and the role at
`message.data` `$.role`. `session.parent_id` is NULL for a root session and set for a subagent, so
you can tell the two apart. The read-only query, with the two guards that matter:

```sql
SELECT s.id, s.title, s.directory,
       datetime(s.time_created/1000,'unixepoch') AS created,
       json_extract(m.data,'$.role')             AS role,
       json_extract(p.data,'$.text')             AS text
FROM session AS s
JOIN message AS m ON m.session_id = s.id
JOIN part    AS p ON p.message_id  = m.id
WHERE json_valid(p.data)
  AND json_extract(p.data,'$.type') = 'text'
  AND coalesce(json_extract(p.data,'$.synthetic'),0) = 0
  AND coalesce(json_extract(p.data,'$.ignored'),0)   = 0
  AND s.id = '<SESSION_ID>'
ORDER BY m.time_created, p.time_created;
```

`sqlite3 -readonly` on every one of these. The `synthetic` guard is what separates a real human turn
from a system-injected one; without it you will quote a generated message back as a requirement.
Never write an export file. `.kilo/skills/chat-history-query/SKILL.md` has the legacy JSON and
Copilot paths if the store has moved.

### Find the right sessions

You need **both** root sessions, and you need to know which is which — the one that landed and the
one that did not:

```sql
SELECT id, title, parent_id, datetime(time_updated/1000,'unixepoch') AS updated
FROM session
WHERE parent_id IS NULL
  AND lower(title) LIKE '%<feature words>%'
ORDER BY time_updated DESC;
```

In the incident this returned two roots, both in `/Users/bkalynovskyi/ph`, both on the same day:
one had landed, one had not. Nine and six subagent children respectively, all finished. A search by
title alone is not enough — **title matches are routing, not evidence**, and the second branch's
title frequently does not contain the word the first branch's does.

### Search beyond the ids you were handed

The two root sessions are the **floor, not the ceiling**. A branch's requirement is frequently
stated in a chat that never touched the branch: a session that asked for the feature and stopped, a
subagent that researched it, a session whose title shares no word with the branch. So search the
**whole project's** session history, not the ids an inventory, a worktree name or a commit subject
hands you:

- **`kilo_local_recall` with `mode: "search"`**, on feature nouns, commit subjects, file paths and
  the operator's own phrasing. It ranks user-authored and whole-phrase matches highest, and it
  reaches archived and child sessions that the `session` query above does not name. `mode: "read"`
  with a returned id is the follow-up, not the search — reading two transcripts is not a search.
- **The `lower(title) LIKE` query above** as the second pass, because a title search misses a
  session that did the work under another name.
- **A family walk** when the ids you found look thin: `WHERE directory = '<abs worktree path>'`.
  `session.directory` is where a chat _opened_, so a main-checkout chat that drove into a worktree
  is booked against main for its whole life; that is a reason to walk the family, not a reason to
  conclude nobody was there.

A session that is not "about this merge" can still be the only statement of the requirement this
merge is arbitrating — and a requirement recovered from the wrong chat is a requirement whose
citation nobody can check, which is the failure mode every other rank rule in the table above
exists to prevent.

### Extract, do not summarise

For each session, extract **every human turn, verbatim**, and tag each one:

| Tag                  | Meaning                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| **hard requirement** | "must", a number, a prohibition. Not negotiable in review                        |
| **preference**       | a lean, revisable, with no number attached                                       |
| **correction**       | the operator narrowing or overturning something the agent already did            |
| **question**         | something the operator asked the agent to answer                                 |
| **scope fence**      | a hard requirement that explicitly forbids a next step ("but dont implement it") |

Verbatim is not a stylistic preference. In the incident, a 150-character human turn contained four
separate hard requirements and a 245-character turn contained a correction of the agent's _method_,
and both were collapsed by any summary. The scope fences are the highest-value thing in the whole
transcript: one agent was told "the left panel must be movable in future — get ready to this (but
dont implement it)" while a second agent was, in that same hour, being told to make exactly that
happen. Neither message mentions the other, and a summary loses the "but dont implement it" — which
is the entire content of the instruction.

### Also record, because the merge body will need them

- **Overturns.** Every time the operator reversed a proposal, quote both sides. These are the
  decisions the merge must not silently reopen.
- **Gates the operator predicted.** One turn began "caution: changing toolbar with may break e2e
  tests (fix them and make them less fragile…)". That is a _requirement about the tests_, stated
  before any code existed, and it belongs in the ledger.
- **Cost constraints.** If the operator said anything about budget, tokens, or not wasting effort,
  quote it exactly and treat it as a hard requirement. In the incident there was none, which is
  itself a finding: it means the token axis in [Phase 2](#the-token-axis) is yours to weigh
  against the repo's own rules and not the operator's words.
- **Anything about how to ask a question.** If the operator told you where hard questions go, that
  outranks [Phase 5](#phase-5--ask-the-human-in-a-file).

### Build the ledger

One row per requirement. **No requirement enters the ledger without a source.** An inferred
requirement is a guess wearing a table row, and it will be treated with the authority of the
operator's own sentence.

| #   | Requirement                                                        | Source                                     | Rank             | Disputed? | Where it is implemented (branch A / branch B / neither) |
| --- | ------------------------------------------------------------------ | ------------------------------------------ | ---------------- | --------- | ------------------------------------------------------- |
| R1  | <verbatim or a one-line restatement that preserves the constraint> | `<session id>` turn 2, 2026-09-29 08:14:50 | hard requirement | yes       | A: `file:line` · B: `file:line`                         |

**Gate.** Every row has a source and a rank. Every row that touches both branches is marked
disputed. Any requirement you found yourself rather than read is written as _"inferred — not
sourced"_ and is treated as a question, not a fact. You have not read a single line of either
diff.

---

## Phase 2 — fill the ledger from the source of truth

Phase 1 recovers what each branch was _told_. Phase 2 answers what it _should be_, for every
disputed row the transcripts did not settle. Three axes, in this order.

### The Photoshop axis

**This app is a clone, not a lookalike.** `docs/PHOTOSHOP-UX.md` states the product requirement
directly: a tool Photoshop does not have must be deleted and replaced by the Photoshop tool it
stands in for, and where this app and Adobe disagree, Adobe is correct by definition. So when two
implementations disagree about a Photoshop behaviour, the dispute is settled by finding out what
Photoshop does — not by preferring the newer branch.

The arbitration question for any disputed behaviour is always the same four:

1. **Does Adobe document it?** Fetch the page. `helpx.adobe.com` returns HTTP 403 to a direct
   fetch, so read it through a search engine's live crawl and quote the page text; treat a
   search-index excerpt as `ADOBE-DOC` at MEDIUM-HIGH, not HIGH, and say which one you have.
2. **If Adobe is silent, is the behaviour observed?** Label it `OBSERVATION`, not `ADOBE-DOC`.
3. **Is there a counter-source?** One repo is enough to know: a code comment asserting "Adobe's
   Tools panel is draggable between edges and explicitly NOT resizable" is **half verified against
   an explicit Adobe sentence** ("You cannot resize the Tools panel or options bar") and **half
   inferred** (Adobe documents undock and re-dock by drop zone; it never enumerates left, right,
   top and bottom for the Tools panel specifically). Carry that split forward — it decides different
   things for the drag and the resize.
4. **If nobody can settle it, it is a question for a human.** Not a judgement call. →
   [Phase 5](#phase-5--ask-the-human-in-a-file)

**Search before you rule, and record what you could not find.** The most valuable output of this
phase is frequently negative, and the negative result is the finding. In the incident:

- **"Does the Tools panel collapse when the rail is too tall?"** Adobe's own `Customize toolbar`
  page enumerates every documented control — drag and drop to reorganise, Move less frequently
  used tools to Extra Tools, Toggle, Clear Tools, Save/Load Preset, Restore Defaults — and
  **no height or overflow control is in the list.** That absence, from a complete enumeration, is
  the evidence. Photoshop's documented answer to a too-tall rail is a _manual_ one/two-column
  toggle and a persistent Extra Tools surface — a preference, not a reactive mechanism.
- **"Is a three-dots tile a Photoshop affordance?"** **No source was found for one, and "no source
  found" is the defensible form of that answer.** What the sources that _do_ exist say, in the
  lineage this app copies:

  | source                        | what it offers for tool overflow                                                                                                                    |
  | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Adobe, _Customize toolbar_    | a **complete enumerated control list** — drag to reorganise, Extra Tools, Toggle, Clear Tools, presets. **No height or overflow control is in it.** |
  | Krita, _Settings_ docs        | a small chevron appears when the items do not fit; click it and the rest expand                                                                     |
  | Affinity Photo, vendor forum  | a `>>` double chevron at the end of an overflowing toolbar                                                                                          |
  | GIMP, _Tools_ docs            | a corner triangle, and **right-click** the group to list its tools                                                                                  |
  | Carbon / Material / Apple HIG | a kebab is an **action** menu; a disclosure triangle is _"show more of a list"_                                                                     |

  Every one of those is a chevron, a group-list, or a preference surface. **A tile that lists tools
  is a disclosure case wearing a kebab glyph**, and the one documented Photoshop remedy for a
  too-tall rail is a _manual_ one/two-column toggle plus a persistent Extra Tools surface — a
  preference, not a reactive mechanism.

  **Do not restate this as "N applications were surveyed and none does X."** That is a survey
  claim: it has no method, it has no date, and it goes stale silently. The table above is
  checkable — every row names a document you can open — and a bare count is not. `AGENTS.md`'s
  rule about unsourced numbers is the same rule about cost figures, and it applies to a count that
  drove a shipped design decision.

- **"Does Photoshop document a minimum width for the collapse-to-icons threshold?"** No. Adobe
  documents the _mechanism_ — "adjust the width of the dock until the text disappears" — and never
  gives a number, and the behaviour is continuous rather than stepped. **Any pixel constant in a
  clone of that rule is unsourced.** Say so in the handoff rather than shipping a number that
  looks like a fact.

**The three labels every claim carries:** `ADOBE-DOC` (Adobe states it) / `OBSERVATION` (detailed
third-party description) / `UNSOURCED`. Never drop the third to tidy an argument. A requirement
you cannot source becomes a question; a requirement you cannot source _and_ cannot ask becomes a
named handoff item, in writing, with the search you ran.

**A stalled arbitration is a research deficit, and every move that breaks one is read-only.** When
the sources above came back empty, do more searching — do not conclude faster, and do not reach for
a question, because a question is the one move that ends the search. `websearch` the feature's
**industry best practice** (what Krita, Affinity, GIMP and the platform HIG do — one openable
document per row, never a bare count) and re-read **Adobe's own page for the feature** rather than
a general page that mentions it in passing. Then re-read the ledger's own question: a requirement
stated once and never re-read reads as a settled one, and a settled row is what a merge inherits
silently. Rank a search-index excerpt as `OBSERVATION` and say which one you have, exactly as
above — a clean negative from a complete enumeration is the strongest evidence this phase produces,
and a re-search that finds nothing new is still worth the ledger line that says you looked twice.

### The web-platform axis

Some Photoshop behaviour is not reachable in a browser at all, and knowing which is what stops an
agent from spending a week on a wall. Classify every disputed implementation against four classes —
**A** natively supported · **B** achievable with effort · **C** achievable with a real caveat ·
**D** not possible in a browser — and every class needs a source, not a hunch.

The four that decide most disputes in this repository, with the reason each is what it is:

| Photoshop capability                           | Class | Because                                                                                                                                                                        |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Draggable, resizable panel docks               | **A** | `setPointerCapture`, `getCoalescedEvents()` and `pointercancel` are all Baseline; Escape-cancel is a document listener.                                                        |
| An OS-native detached window holding a panel   | **D** | A page never owns a window. `Window.moveTo` refuses anything not created by `Window.open`, and a popup keeps its own chrome.                                                   |
| A live caret inside rotated or scaled text     | **D** | A non-`none` `transform` creates a stacking context and a containing block; the caret, selection rectangles and IME candidate window are all user-agent-drawn in layout space. |
| Programmatic image **read** from the clipboard | **C** | Needs transient user activation _and_ a permission: Chromium prompts, and Firefox and Safari do not support `clipboard-read` at all.                                           |
| Pressure-tablet input                          | **C** | `PointerEvent.pressure` and `tiltX`/`tiltY` ship; real hardware generally needs WebHID or WebUSB, which are Chromium-only.                                                     |

**Class A is not class A for a clone.** "A dock is resizable" is a platform fact; "the Tools panel
is _not_ resizable" is a **product** decision taken because Adobe says so, and a merge that
confuses the two will "fix" a deliberate fidelity choice as though it were a bug. `src/contexts/PanelLayout.tsx`
carries the citation in its own header for exactly this reason. Keep the two apart in the ledger.

**`docs/TOOLS-TOO-HARD.md` is this repository's existing record of the class-D and class-C
verdicts**, complete with Adobe citations, and it is scoped to the Tools rail. Read it before
researching a rail or panel question from scratch; the answer is often already written down there.
`docs/TOOLS-TOO-HARD.md:1-19` states the policy it records: a capability listed there is a decision,
not a backlog item, and it is deleted when the capability lands.

### The token axis

**Time and compute are almost unlimited here; the two things that are not are autonomy and
correctness.** `AGENTS.md` states it as "COMPUTE COSTS ZERO; QUALITY IS THE POINT", and a hard
merge is where that is most load-bearing: the task spends a whole context on research to get one
resolution right, and a cheap wrong merge costs a day of arbitration to unpick. So the axis below
**ranks what to run first — it is not a licence to stop.** Everything else is a judgement call, and
the repo already encodes the judgement: research fan-out is free and is the _preferred_ shape,
because a subagent runs in a fresh context and a long main turn is what costs. `AGENTS.md` states
the substitution in call counts rather than tokens, deliberately — "40 sequential tool calls in one
context = 8 parallel subagents + a 6-call synthesis. Sequential calls are the defect, not the token
count."

A previous form of this paragraph made a paid model's budget the hard requirement. **That is not
this repository's rule**, and an agent reading it as one rations the transcripts — the single most
expensive corner in the document to cut, because a requirement recovered cheaply is a requirement
recovered wrongly.

Rank the work by **what the cost is a function of**, never by a figure, because `AGENTS.md` forbids
unsourced numbers in this repository's gates and docs and this document does not get an exemption:

1. **Context breadth × turn count.** Every token read is re-paid on every later turn of the same
   session. Loading `StoreContext.tsx`, `useApp.ts` or `TEXT_TOOL_REQUIREMENTS.md` end to end is
   the expensive shape. This is why Phase 1 hands you a ledger instead of a pile of transcripts:
   the synthesis happens once, in a small context.
2. **Whole-tree verification runs.** A commit's suite share is a function of its fan-in, not of
   its size: `test:staged` on a hook or a component selects a small fraction of the suite, while on
   a test-setup or a vitest config it selects _the whole suite_ — at which point it costs more than
   the full run, because the module-graph build is a second whole-tree pass. `docs/TESTING.md`
   records the measured proportions and deliberately records **no absolute counts**, because a
   count goes stale the moment a test file lands. Read the proportion from there; do not copy a
   number from a doc that has none.
3. **E2E, twice over** — the run _and_ the reasoning. A headed run is not merely expensive, it is
   unreliable evidence, which makes its tokens doubly expensive. Never pass `--headed`.
4. **Rewrites of a central file.** Three costs stack — the rewrite, the suite it invalidates, and
   the review diff — and a rewrite silently invalidates every line-numbered citation into it. The
   citation sweep in [Phase 7](#74-the-citation-sweep) is a direct consequence.
5. **A targeted `grep` against a named path.** The cheapest useful unit, and the one every
   citation in this document was produced by.

**What this means for a hard merge, concretely.** Phases 1 and 2 are the cheap half and they are
where the correctness comes from — that is the whole reason to spend a day in the transcripts before
opening a diff. Phase 6 is the expensive half and it is _not_ delegable, because arbitration is
exactly the judgement `AGENTS.md` reserves: "a subagent cannot weigh this file against the operator's
intent." Delegate the per-file evidence gathering ([Phase 3](#phase-3--map-the-overlap-surface))
and the post-merge sweeps ([Phase 7](#phase-7--prove-the-merge-lost-nothing)); keep the decisions.

**Gate.** Every disputed ledger row is answered, defaulted under
[Phase 5](#the-default-if-unanswered), or filed as a question. Any row still carrying a name you
cannot source is _not_ answered — write it down as a question.

---

## Phase 3 — map the overlap surface

Now, and only now, open the diffs. The first thing to compute is **not** the conflict list — it is
the candidate set, and the two are not the same size.

### Preview without touching anything

```bash
git -c merge.conflictStyle=zdiff3 merge-tree --write-tree <main> <branch>
```

This runs the real three-way merge in a scratch object store. It touches **no working tree, no
index and no ref** — the property that matters, and the one this repository's own inventory script
depends on (`scripts/lib/worktree-inventory/git.mjs:198`). It is not object-store-neutral: the
tree it prints is written to the object store as unreachable loose objects. That is the same
trade the repo already made, and the claim it makes is the one that counts.

Two things to know about the output:

- **Read the conflict list from `^CONFLICT` on stdout, never from the exit code.** A non-zero exit
  also means an unresolvable ref. "No conflicts" is a licence to land, so a wrong licence is how a
  branch breaks `main`; a failed run must degrade to **unknown**, never to clean. This is the
  repo's own rule, and it is stated twice — the JSDoc at
  `scripts/lib/worktree-inventory/git.mjs:194-197` ("`null` is NOT `false`: an unknown answer must
  not be reported as a clean merge, because 'no conflicts' is a licence to land and a wrong licence
  is how a branch breaks main") and the `return { conflict: null, … }` at `:226-231`. The `^CONFLICT`
  match itself is at `:214`.
- **Use `zdiff3`, and know why.** Plain `merge` style shows two sides and nothing between, so you
  cannot tell a line that was _added by them_ from one that was _in the base and deleted by us_.
  `diff3` shows the base but **always** shows it, and git has no way to omit an empty one, so on a
  hunk where the base is large and both sides rewrote it you get hundreds of lines of base between
  the two answers. `zdiff3` emits the base section **only when the base is non-empty for that hunk**,
  which is what keeps a "both sides added the same thing" hunk compact instead of carrying a blank
  base block through every conflict.

  The real `AGENTS.md` conflict in the incident has **two** blocks and a **large base in both**, so
  `zdiff3` does not collapse it — it shows you the base, and that is the point:

  | block | ours | base | theirs |
  | ----- | ---- | ---- | ------ |
  | 1     | 701  | 675  | 56     |
  | 2     | 152  | 110  | 0      |

  Block 2 is the case `zdiff3` exists for in the other direction: `theirs=0` means that side added
  nothing, so what you are actually choosing between is a 152-line `ours` and a 110-line base — and
  the base is what tells you whether `ours` deleted something. Reproduce the table with
  `git -c merge.conflictStyle=zdiff3 merge-tree --write-tree <ours> <theirs>` and count the regions
  of the resulting blob.

  There is no `git merge --zdiff3` flag on git 2.50.1 — use the `-c` override, or
  `git checkout --conflict=zdiff3 -- <path>` on a conflict already in the worktree.

### Separate candidates from conflicts

The intersection of the two branches' changed files is the **candidate** set. The files git
actually refused are the **conflict** set. They differ, and in the incident the ratio was **14
candidates → 8 real conflicts**: six files both branches touched and git merged cleanly anyway.
Budget for the eight.

```bash
git diff --name-only <base>..<a> | sort > /tmp/a.txt
git diff --name-only <base>..<b> | sort > /tmp/b.txt
comm -12 /tmp/a.txt /tmp/b.txt          # candidates
```

### Grade severity from the merge, not from the conflict markers

`git show --remerge-diff <merge>` re-runs the merge and shows what the resolution changed. Use it
in preference to `git show --cc`, and understand why:

> **`--cc` does not grade severity; it only reports resolutions that differ from _both_ parents.**
> On the real incident merge it named **9** files where `--remerge-diff` named **11** — and the two
> it missed (`e2e/document-dialogs.spec.ts`, `e2e/text-tool.spec.ts`) were genuine conflicts whose
> resolution happened to coincide with one side, which is exactly the resolution `--cc` cannot
> see. It also named a file git had merged cleanly. So `--cc` under-reports _and_ over-reports at
> once, and you cannot tell which is which from its output.

That is the reason to prefer `--remerge-diff`: it grades severity itself, emitting a
`remerge CONFLICT` line per file git actually refused (8 of the 11 here), so a file that a driver
merges cleanly is visibly different from a file a human had to decide.

**A caution about counting them.** `git show --cc` emits a `diff --cc` header, not `diff --git`,
so `grep -c '^diff --git'` against a combined diff returns **0** and reads as "clean" when the
merge is not. Count `^diff --cc` for a combined diff and `^diff --git` for a remerge diff, and
prefer the `remerge CONFLICT` count over both.

Rank by `remerge CONFLICT`, then by the size of the remerge diff, then by fan-in. The top of that
list is where the ledger decides things and the bottom is where a union is obviously right.

**Gate.** The candidate set, the conflict set, and the severity ranking are written down, and the
one file with the largest remerge diff is named. That file is the centre of the merge and the
ledger is built around it.

---

## Phase 4 — classify every conflict

A conflict has a _kind_, and the kind determines the action. Guessing the action from the shape of
the diff is how a union becomes a silent loss. The taxonomy is in
[Appendix A](#appendix-a--the-conflict-taxonomy); the ten rows below are the ones that appeared
in the incident that produced this document, each with its real instance. **The numbering skips
10** because class 10 exists only in Appendix A (a structural union git found by itself) and the
skip is what stops a reader hunting for a row that is not in this table. Class 11 is not a
conflict at all, and that is the point of it.

| Class                                                   | What it looks like                                                                            | The action                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **1 — a test asserts a premise the other side removed** | The test still passes on its own branch and cannot pass here                                  | **Correct, do not delete.** Rewrite against the new truth and say what it was standing in for |
| **2 — opposing product decisions on one literal**       | `useState(false)` vs `useState(true)`, two different documented defaults                      | Resolve against the ledger. A human instruction beats both branches                           |
| **3 — both sides rewrote the same explanatory comment** | The code merged; the prose above it did not                                                   | Write the comment that is true of the merged code                                             |
| **4 — a duplicated numbered section**                   | Two `## 79.` headings, one from each branch, both real                                        | **Main keeps its number. The incoming branch renumbers** to `max + 1` and both survive        |
| **5 — a duplicated key added in two places**            | Same object key, different definitions, **no textual conflict at all**                        | Neither side is right. Re-derive the entry from the tree                                      |
| **6 — a helper whose signature diverged**               | `leftOf(): number` on one side, `boxOf(): {left,top}` on the other, and callers diverged too  | One shape, and its callers move with it                                                       |
| **7 — the same import, added twice**                    | Both sides added the identical import line                                                    | Union. The trivial case — and see the warning in class 11                                     |
| **8 — a document was split on `main`**                  | `AGENTS.md` became a thin root plus three `docs/` files while the branch edited the long form | Take `main`'s split and **port** the edit to where the content now lives                      |
| **9 — a generated file**                                | any snapshot, any lockfile                                                                    | **Regenerate. Never hand-merge.**                                                             |
| **10 — a structural union git found by itself**         | Both sides' entries landed in one table and git reported no conflict                          | Still run the sweeps — see class 11 — then leave it alone                                     |
| **11 — no conflict, and something is still wrong**      | git reported success, and a duplicate key or a whole entry vanished                           | Only the [Phase 7](#phase-7--prove-the-merge-lost-nothing) sweeps find this                   |

Class 11 is the one that ends careers. In the incident, one merge committed a file that still
contained live conflict markers, **git reported it as resolved**, and the markers survived three
further commits — one of them a merge — before `ef85d3ab` repaired them. Neither `--remerge-diff`,
nor `--cc`, nor the existence of the merge commit catches that. A grep does, and it is a required
gate in [Phase 7](#71-the-marker-sweep).

**Class 5 is the one that loses data quietly.** Both branches added the key `'toolbar-overflow'` to
the curated table, at different line numbers, with different summaries. The merge base has no such
key at all. JavaScript object literals resolve a duplicate key last-wins, so **git merged it
cleanly and silently kept one, deleting the other.** There is no conflict marker, no exit code, and
no test that fires. A key appearing on both sides of an object literal, a map, a registry, a
`switch`, or a barrel file is a class-5 candidate whether or not git said anything.

**Class 2 is the only one where a branch can be right for a reason that is not in the code.** In
the incident, one branch's operator had said "must start with one column by default" out loud, in
that branch's own chat, and the other branch's two-column default was the shipped Photoshop
default. The merge body that resolved it is the model for the whole phase:

> Overturned from main: the two-column default, which this branch's operator instructed the other
> way, and with it main's reason — a one-column rail is taller and therefore scrolled, which is the
> axis this branch removed. **The reason is answered in the comment rather than overruled.**

That last clause is the whole of it. A reason you do not answer stays in the tree as an
unanswered argument, and the next agent reads it as a live position.

**Gate.** Every conflicted file and every class-5 candidate carries a class, and every class-2
instance has a ledger row. Any conflicted hunk you cannot classify is escalated to
[Phase 5](#phase-5--ask-the-human-in-a-file) rather than guessed at.

---

## Phase 5 — ask the human in a file

**A hard question is a document, not a chat message.** Chat is for the _pointer_: the final message
may name the one question that gates the next step, and it must not contain the question.

**Escalation is the last resort, and only once Phases 1 and 2 have genuinely been exhausted.** By
the time you are here you have read the transcripts, searched the whole project's session history
rather than the ids you were handed, arbitrated against Adobe and the industry, and re-read the
ledger's own question — and you still cannot answer it. **Write that exhaustion down**, in the
question's own context block, as the searches you ran and what each one did **not** find. A
question with no search log behind it is a judgement call wearing a question's clothes, and the
operator cannot tell the two apart, which makes the judgement call the more expensive of the two.

What survives that is a **policy or an authorisation** — not a defect, not a number, and not
anything the tree can answer, because if the tree could answer it, this is not Phase 5.

The reason is not politeness. A question dropped into a live chat is a random interrupt: it arrives
with no context, the reader must reconstruct the decision from a transcript, and it is lost when
the session ends. A question file inverts that — the context arrives _with_ the question, at the
reader's chosen time, and the interrupt is paid once instead of per-respondent.

### This repository has three dead question files

Read this before writing a fourth. Each of these is a real artifact in the tree right now, each
holds real questions, and **none has ever been answered**, because in every one the questions have
no place for an answer:

- **A review dossier with ten decisions**, each with a fenced evidence block, a `| option | cost |`
  table, and a closing "Needs from operator:" line. Ten for ten, the ask is the _last_ line and
  there is no slot above it.
- **A migration plan's "Decisions Needed From the Human Owner"** — eight questions, currently
  live, one of them still open with a red `it.fails` pinning it, and the plan's own audit records
  that **no answer to any of the eight is recorded anywhere in the repository.**
- **A feature plan with an "Open Questions" section.** One of its two questions is answered inside
  its own body — the text says "This is compatible" — and nothing noticed, because the format
  invites no answer.

What they all share: a question with no **answer slot**, no **status**, no **default if
unanswered**, and no **owner**. And all three live under `.kilo/`, which `AGENTS.md` says is
gitignored and machine-local, so a file a human has to go and find in a scratch directory is a file
that does not get edited.

### The three states, and why "open" is not one of the only two

An unanswered question is not a pending question. It is an **assumption on the record, attributed
to the agent that made it.** That is the third state, and without it a question that sits open
through three sessions becomes a decision nobody made:

| State        | Meaning                                         | What the agent does                                                                               |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Open**     | Asked, no answer, deadline not passed           | Keep working on everything that is not gated by it                                                |
| **Resolved** | Answered by the operator, recorded in place     | Move the row to `## Resolved` and record the consequence                                          |
| **Assumed**  | The deadline passed; the agent took the default | Move the row to `## Assumed`, name the agent and the date, and say the decision can be overturned |

**Never guess silently. Never guess _at all_ without recording it.** Those are two different
behaviours and the distinction is the protocol. A blocking question _with_ a default becomes a
time-boxed question: at the deadline the agent takes the default and files the assumption. A
blocking question _without_ a default stops that unit of work and commits nothing — and **stopping
is the correct outcome, not a failure.** It is the correct outcome for **that unit of work**, and
only after every other unit is exhausted: a merge that halts with forty conflicts unresolved because
one row is open has confused _blocked_ with _finished_, which is a different failure from the one
this rule exists to prevent — and the one it makes invisible. The precedent in this repository says
so in as many words: "The fix agent declined to guess and committed nothing. That is the correct
outcome, not a failure."

### The format

The full shape, with every element justified, is in
[Appendix C](#appendix-c--the-questions-file). The four that make it work:

- **Each question gets an id that cannot collide across worktrees** — `Q-YYMMDD-NNN`, date
  anchored. Two agents in two worktrees asking questions about the same file must not produce one
  id, and a merge must be able to sort them.
- **Every option says what it does, not what it is called.** A bare "A / B / C" table hands the
  burden of interpretation to the reader — Kleppmann's whole argument, from a 2007 essay, is that
  the meaning of a button's label depends on the question it sits in, and that this places the
  cognitive load on the person deciding. Each option carries a "buys" and a "costs" column.
- **`## Resolved` and `## Assumed` are named sections, and the question is moved, never deleted.**
  A resolved decision is still relevant to know it _was_ the decision; deleting it is how the same
  question gets asked again in a month.
- **Partition the file by who may write which field.** The operator writes the `Answer:` line and
  nothing else; the agent writes `Evidence`, `Options`, `Default` — **and performs the move** into
  `## Resolved` or `## Assumed` once the answer is there. The operator never relocates a row,
  because relocating one is an edit to fields the agent owns and the two would then race on the
  same lines. The agent never writes the answer. This split is the only element that makes
  concurrent edits safe without a lock, and it matters because a single file written by N
  concurrent agents can otherwise race on its own counts. The corollary the template must honour:
  **a section the operator is told to fill must contain only fields the operator owns**, so the
  `## Resolved` row's `Consequence recorded` / `Implemented in` / `Verified by` lines are written
  by the agent in a follow-up, and are blank in the template with a note saying so.

### The default if unanswered

Every blocking question carries one. Naming a default **does not make the question optional** — it
converts a blocking question into a time-boxed one, which is the only way to keep making progress
while it is open. The trigger is the `Needed by:` **condition**, checked against the tree and not
against a calendar: "before the rail arithmetic is written", not "by Friday". When the condition
is met and no answer is there, the agent takes the default, moves the row to `## Assumed`, and
records which agent did it. A question with no default stops that unit of work and commits
nothing — and that is the "blindly accept / blindly change" trap, because a person meeting a
decision they cannot explain has exactly two options, both bad.

### What must not go in the questions file

- **Defects and findings.** A defect has a demanded mechanical fix and belongs in
  `HANDOFF.md`, `TEST-FLAKES.md` or `e2e/OPEN_PROBLEMS.md`, routed by scope. A question is a
  _choice_. The existing dossier that got this right says so in its own preamble: "Items a person
  has to choose, because the choice is a policy or an authorisation rather than a defect. Every
  other finding in this review set is technical and has a demanded fix."
- **Effort estimates.** `AGENTS.md` is explicit, and this repository has shipped a decision off an
  unmeasured number before.
- **Anything the tree can answer.** This is the most common real failure. If the repository can
  answer it, it is not a question.
- **Anything durable in `.kilo/`.** A file the human must go find in a scratch directory will not
  be edited. That is why all three dead question files are dead.

**Gate.** No blocking question is left in chat. Every open question is in the file with a deadline
and a default; every resolved one is in `## Resolved` with its consequence; every default that has
been taken is in `## Assumed` with the agent named.

---

## Phase 6 — resolve, in the order that loses nothing

Resolve in this order. Each step is strictly more expensive than the one before it, and the point
of the ordering is that you only pay for a re-derivation when a union has genuinely failed.

### 1. Union — the default

> **Resolved by union, not by picking a side** — `b187ff00`

> The one conflict is a union, not a choice. Both sides kept: … They assert different failures -
> main's catches a clipped or off-screen item, the campaign's catches a shape whose ink landed
> somewhere other than the dragged box - and **dropping either loses a real regression.** — `f8e38337`

That second quote is the test. **Two tests of "the same thing" from two branches are different
tripwires until proven otherwise, and you prove it by what each one _fails on_, not by what they
are called.** A union is refused only when a rejection names the mechanism by which the dropped
side is redundant or wrong — never "X was dropped."

The corpus's best rejection is in `e9c6eb89`, and it is worth reading in full because it is a
union that deliberately _is not_ complete:

> All 28 of main's `it()` titles are present unchanged, and all 12 guard titles are present. The
> two `it()`s this branch inherited from the merge base … are **NOT kept**: main moved that pair
> into its own `canvas stub re-installation` describe, where a module-scoped
> `stubBeforeDestruction` makes the observer unfilterable and the assertions are strict supersets.
> **Keeping ours beside main's would reinstate the `-t`-vulnerable weaker pair main removed.**

Three things in four sentences: what is kept, what is not, the mechanism, and the _consequence of
keeping it anyway_. That is the bar for a rejection.

**When a union creates a name collision, rename yours.** `68efc478`: "Two name shadows the union
created were resolved by renaming OUR locals, so main's test code survives byte-identical." The
other side's file stays untouched, so its authorship and its review survive with it.

### 2. Graft, do not duplicate

When two tests share a title and one has an assertion the other cannot see, take **the
assertion**, not the test. `68efc478`: "One assertion was **grafted rather than kept as a second
test**: 'Cancel and Escape close the dialog' is identical in title on both sides, and theirs adds
exactly one thing ours cannot see, that no history entry was created." (The commit's own quotation
marks are double; single are used here only to nest the quote.)

The same shape applies to prose. When `main` moved the content out from under your edit, take
`main`'s split and **port** the edit to the new home with its own reasoning intact — that is the
doc-split equivalent of the union rule, and it is what `08bd4d16` did.

### 3. Re-derivation, when the union would keep a wrong answer

The sharpest passage in the whole corpus, and the one that decides whether you are merging or
re-deriving:

> **Neither side's pointer is right** — ours lands one of two, main's lands none of four, and the
> sentence actually names three fields, so the citation is `307,315,317`. **A union here would have
> kept our wrong one, so this is a re-derivation, not a merge.** — `272ec662`

The trigger is precise: **the merge's own resolution invalidated both sides.** Inserting two lines
into a file invalidates every citation into it below the insertion point, so taking either side's
numbers and calling it done leaves the file wrong either way. Re-derive from the sentence, against
the merged tree, and verify each one resolves to the same source line.

Re-derivation is also the answer for class 5 (a duplicated key in a map or object literal) and for
class 6 (a diverged helper signature). Neither has a union — the merged thing does not exist yet.

### 4. Regenerate, for anything generated

> `WORKTREES.json`: **regenerated rather than hand-picked. It is generated, never hand-edited, and
> a textual merge of two snapshots of 70 moving worktrees is meaningless.** — `ce59ba0d`

Four merges in this repository say this with these words — `ce59ba0d`, `9e190fbf`, `ceb6a01d`
and `08bd4d16` — and Appendix A lists them. It is not a judgement call. A hand-merged generated
file preserves a document no run of the generator would ever produce, and the next `--check` fails
on it.

`WORKTREES.json` is the historical instance of that rule and no longer a live one: it stopped
being committed, and an untracked file cannot reach a merge conflict at all. Read it as the
worked example of a rule that still binds every generated file you do track.

### 5. A third design, when neither side is right

Sometimes the answer is neither side, and saying so in the merge body is mandatory. The marker
phrases from the corpus:

- "**Neither side alone is right.**"
- "the merge surfaced" — for a latent gap the merge made visible
- "**fixed rather than papered over**"
- "**re-anchored to the real …**" — when git matched your hunk to a line that merely _looks_ like
  the target. `ec7a07e7` is the model: "Git matched the branch's hunk to main's new
  `takeSelectionDrag` instead — both end in `selectionDragRef.current = null` — so a textual
  resolution left the gate unhooked at the one place every gesture end passes through." **A hunk
  that textually matches a line is not the same hunk. Verify the hook lands on the semantic site.**
- "corrected to … rather than the writer that exists now" — when the merge changed a documented
  invariant, not just a line

**If you cannot name one of these, say that it was a plain A-or-B and say why that was honest.**
A merge body that reads as a synthesis when it was a coin flip is the thing this whole phase exists
to prevent.

**And one option sits above all of these, and it is a design decision rather than a resolution:
reimplement.** Two agents implemented one requirement at the same time and collided, and sometimes
the cheapest correct answer is to keep **neither** and write the feature once — from the
requirement you recovered in [Phase 1](#phase-1--recover-the-requirements-from-the-chat-history)
rather than from either diff. **It is a first-class option, not a last resort, and it is decided in
[Phase 0](#phase-0--decide-the-tool) beside the tool**, because choosing it changes the tool: you
are no longer merging two branches, you are replacing one, and `range-diff` is what tells you which
commits of the loser are `=` with `main` and can be dropped outright instead of resolved. Name it
in the merge body as **"reimplemented from the recovered requirement rather than resolved"**, say
which side's behaviour it reproduces and which it deliberately does not, and run **every** Phase 7
sweep over the result — a rewrite loses exactly what a merge loses, silently, and it loses more of
it, because nothing in it is a conflict.

This is not a re-derivation. A re-derivation recomputes a claim inside a file that survives; a
reimplementation replaces the file. **A clean merge of two half-understood implementations is not a
merge** — it is a seam with a green `tsc` on it.

### 6. Corrected rather than deleted

The rule for tests, stated once and completely:

> Two of main's tests asserted a premise this branch removes, and both are updated against **what
> is now true rather than against a number that happens to hold**: `SidebarLeft.workspace.test.tsx`
> read the default instead of pinning it, since its real claim is that the toggle reaches the other
> width and back; and `no-document-overflow.spec.ts` was measuring the rail overflowing, which it
> no longer does — the scroll container MOVED to the tools slot, so `scrollbar-none` moved with it
> rather than sitting on an element that cannot overflow. — `e473a45f`

A test whose premise was removed is not a test to delete and not a test to weaken. **Rewrite it to
assert the thing it was actually standing in for, and name that thing in the merge body.** The
sharpest instance in the corpus is a test that asserted a tool's _name_ to prove it was selected,
replaced with a control-id assertion plus an assertion that no placeholder card is on the active
bar — "which fails if the tool is ever re-wired, since a title match would still pass."

**Corollary: a deleted test is real coverage until someone proves otherwise.** `24bb437e` is a
merge whose **subject line is the whole finding** — `merge: the deleted negative was real coverage,
and the sibling placement cannot hold it` — and it carries no body at all, which is the one shape
worth noticing: when the entire conclusion fits in a subject, the subject is the record. And a
pre-existing red test in a shared file is **reported, not fixed** — "a wrong fix to the shared
importer is worse than a visible red test" — with the distinguishing phrase being "inherited, not
introduced," and the same command output quoted on `main` to prove it.

### The forbidden four

These produce a green tree and a wrong product, which is worse than a red one:

| Forbidden                                           | Because                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `git checkout --ours` / `--theirs` on a file        | It is a coin flip dressed as a decision, and it is invisible in the merge body unless you write it there                                       |
| Re-recording a baseline to hide an arithmetic error | The number stops being an oracle. "Re-recording replaces a committed oracle, so it is an operator decision"                                    |
| Widening a tolerance so a gate goes green           | Identical failure, opposite direction. `e2e/OPEN_PROBLEMS.md` already records a tolerance that was _derived_ — and the derivation is the point |
| Deleting an assertion to make a conflict go away    | Union, graft, or correct. There is no fourth option                                                                                            |

**Gate.** No whole file was taken with `--ours` or `--theirs`. Every resolution is a union, a
graft, a re-derivation, a regeneration, a named third design, or a **declared reimplementation**,
and every rejection names its mechanism.

---

## Phase 7 — prove the merge lost nothing

**A clean merge is not a correct one.** git's three-way merge has silently dropped a whole
`HANDOFF.md` section in this repository while reporting success, and the merge that reproduced the
bug is the one that quotes the rule about it. **Five sweeps**, all mechanical, all required — and
all five are gates, not advice.

### 7.1 The marker sweep

**The merge was flagged `remerge CONFLICT: Merge conflict in AGENTS.md`, the commit landed, and the
committed file still carried live markers.** It carried **six** of them: an unindented
`<<<<<<< HEAD` at :57, `=======` at :759 and :1001, **an indented `<<<<<<<` at :848**, and two
space-separated `> > > > > > > main` label lines at :818 and :1003. They passed through three
further commits — one of them a merge — before `ef85d3ab` ("docs(agents): repair a committed
conflict in AGENTS.md, and shorten it") removed them.

```bash
# search the MERGED TREE, not the working tree — a merge is judged on what it
# committed, and the working tree may already have been repaired since.
git grep -nIE '^[[:space:]]*(<{7}|={7}|>([[:space:]]*>){6,})' <merge> -- \
  $(git diff --name-only --diff-filter=ACMR <merge>^1 <merge>)
# exit 0 = markers present (the merge is not finished) · exit 1 = clean
```

**Four things about that sweep are load-bearing, and all four were got wrong the first time.**

**Search the merge's own tree, not the working tree.** `git grep <commit> -- <paths>` reads what the
merge committed. A plain `xargs grep` reads the checkout, where those markers have since been
repaired — so the retrospective version of the sweep silently reports a broken merge as clean. For a
gate run _during_ the merge the two agree; for the audit you run afterwards, only the tree is right.

**Require seven of the marker character, and allow leading whitespace.** The obvious version —
anchored, no whitespace, `>` uncounted — finds only **3 of the 6** markers in that commit, because
`:848` is indented and `:818`/`:1003` are the space-separated `diff3` label form
`> > > > > > > main`, not `>>>>>>> main`. The same uncounted `>` also matches **every markdown
blockquote**: it fires 79 times in `.skills/photoshop-tool-creation.md` and 7 times in
`HANDOFF.md` on ordinary `>` quote lines. A sweep like that reports a clean merge as broken, and an
agent who sees it fire on `AGENTS.md` learns to ignore it — strictly worse than not sweeping.

**Never end it in `|| echo "clean"`.** `xargs` exits **123** when _any_ of its batches exits 1, so a
pipeline over a dozen-plus files ends non-zero even when one of them matched — and the `||` prints
`clean` **on the line below the marker it just printed.** Use one `git grep` and read its exit code
(0 = found, 1 = clean), as above.

**Prove the sweep is quiet before you trust it to be loud.** Run it on a tree you know is clean:

```bash
PAT='^[[:space:]]*(<{7}|={7}|>([[:space:]]*>){6,})'
git grep -nIE "$PAT" <some-clean-commit> -- HANDOFF.md AGENTS.md docs/TESTING.md; echo $?   # must be 1
printf '%s\n' '> a blockquote' '|---|---|' '======' | grep -cE "$PAT"                       # must be 0
```

On this repository's own documents — `HANDOFF.md`, `AGENTS.md`, `docs/ORCHESTRATION.md`,
`docs/TESTING.md`, `docs/PHOTOSHOP-UX.md`, `e2e/OPEN_PROBLEMS.md` and both existing `.skills/`
documents — the corrected pattern matches **0**; the uncorrected one matches 92 (79 in
`.skills/photoshop-tool-creation.md`, 7 in `HANDOFF.md`, the rest in this file). A sweep whose
failure mode is "always fires" looks identical to a working one on the failure case alone.

Gate over the merge's changed files. **A merge with live markers in it is not a resolution.** If
this exits 0, the merge is not finished, regardless of its status or its gates.

### 7.2 The count sweep

**Before** you resolve, enumerate both sides' heading sets against the base. Not after — before,
because after is when it is too late to know what was lost.

> Both regions were appends, **which is the shape that dropped an entry last time**, so **both
> sides' heading sets were enumerated against the base BEFORE resolving**:
>
> ```
> base   34 sections, max 67
> ours   41 sections, max 74   (+68..74)
> theirs 36 sections, max 69   (+68, 69)
> ```
>
> **43 sections were expected after the union; the merge as git produced it would have delivered
> fewer.** — `b42843ee`

Do the same for the documents this repository maintains: the `## N.` headings in `HANDOFF.md` and
`TEST-FLAKES.md`, the `## P<severity> —` headings in `e2e/OPEN_PROBLEMS.md`, the exported symbols
of any touched module, and the keys of any map or object literal that both branches touched. **A
count mismatch after resolution is a silently dropped entry, not a flaky test** — and the handoff
importer's own test fails on a duplicate section number for exactly this reason, so run it.

```bash
# 7.2 — enumerate BOTH sides against the base BEFORE resolving, then compare to the merge
for f in HANDOFF.md TEST-FLAKES.md; do
  printf '%-16s base=%-4s ours=%-4s theirs=%-4s merged=%-4s\n' "$f" \
    "$(git show <base>:$f  | grep -cE '^## [0-9]+\.')" \
    "$(git show <ours>:$f  | grep -cE '^## [0-9]+\.')" \
    "$(git show <theirs>:$f | grep -cE '^## [0-9]+\.')" \
    "$(git show <merge>:$f | grep -cE '^## [0-9]+\.')"
done
npx vitest run scripts/__tests__/handoff-import.test.mjs   # one item per numbered heading
```

`merged` must be `ours + theirs − base` minus the duplicates you deliberately collapsed, and **a
shortfall is a dropped entry, not rounding**. The unnumbered `## P<severity> —` headings in
`e2e/OPEN_PROBLEMS.md` are in discovery order, so there is no number to renumber and no count to
hold — that is why its conflicts are tractable text and not arithmetic.

**The renumbering rule, from a real collision.** Two branches independently wrote `## 79.`:

> Main's 79 is a selection-drag defect and **keeps its number**; this branch's panel-workspace
> section is **renumbered to 83**. — `5e01a612`

Main keeps the number because it is already published — something else cites it. The newcomer takes
`max + 1` of the merged result. **Never split the difference, never renumber `main`.** And a
renumbering is a **cross-reference rewrite**, not a heading edit: this repository cross-references
its own sections by `§N` in prose, so sweep for the old number in all three handoff documents
before you commit.

**Letter suffixes are forbidden and load-bearing.** A `## 15a.` heading is live in `HANDOFF.md`
right now and is unreachable: the board importer's number pattern does not match it, so it opens
no item _and_ closes the previous item's body mid-sentence. A fix for it was written and reverted
because it introduced an origin shape that collides with the board's own namespace. **Half-finished
is worse than filed.**

### 7.3 The duplicate-key sweep

Class 5 has no marker and no count anomaly — one key is present, the other is simply gone. Sweep
for it explicitly: any key both branches added to the same object literal, map, registry, `switch`
or barrel file. In the incident both branches added `'toolbar-overflow'` to the curated table at
different line numbers with different summaries, and JavaScript's last-wins object semantics meant
git merged it cleanly and kept one. **This is the only sweep that finds it**, which is why it is a
gate rather than a note:

```bash
# 7.3 — keys each side ADDED relative to the base, then the intersection:
#       a key in both lists is a class-5 duplicate, and git will not flag it.
keys() { git show "$1:$2" | grep -oE "^[[:space:]]*'?[A-Za-z_][A-Za-z0-9_-]*'?[[:space:]]*:" \
           | tr -d " '" | sort -u; }
FILE=scripts/lib/worktree-inventory/curated.mjs; BASE=<base>; OURS=<ours>; THEIRS=<theirs>
comm -12 \
  <(comm -13 <(keys $BASE "$FILE") <(keys $OURS  "$FILE")) \
  <(comm -13 <(keys $BASE "$FILE") <(keys $THEIRS "$FILE"))     # -> toolbar-overflow:
```

That intersection is the class-5 detector, and for this incident it prints exactly one key:
`toolbar-overflow:`. Note the shape of the command — comparing each side against the **base** and
then intersecting, not intersecting the two sides directly. Intersecting the sides directly lists
every key they share by descent, which for a curated table is most of the file and tells you
nothing. Then confirm the merged tree holds **one** entry and that it is the one you meant:

```bash
grep -c "'toolbar-overflow':" scripts/lib/worktree-inventory/curated.mjs   # must be 1
```

Run it for every literal both branches edited — a `Record`/`Map`, a reducer's action map, a
`switch`'s case list, and any barrel or re-export file. `git` will report none of these as
conflicts.

### 7.4 The citation sweep

**Every merge changes line numbers in every file it touches, and no sweep catches it** — the text
at the stale line still reads plausibly, which is precisely why `grep` does not find it. A fix that
touches a cited file invalidates that file's citations, _including the fix's own_.

```bash
sed -n '<line>p' <path>     # read the line and its neighbours against the claim
```

A citation that resolves to a blank line, an import, a closing brace or a neighbouring function is
wrong even though the file and the number both exist. **If a cited symbol has moved, the fix is the
citation, not the code.** The repo has paid for this twice: rotating a citation to a _declaration_
looked correct and pointed at the wrong read; and on one branch, inserting lines into a central
context file left nearly every citation below the insertion point wrong.

**Re-derive from the sentence. Never shift the number.**

### 7.5 Re-anchor, do not trust the textual match

After a union, a hook that git matched to a line that merely _looks_ like the target is the single
most dangerous silent failure. Verify that every gate, effect and event handler lands on the
**semantic** site, not the string-matching one. `ec7a07e7` is the worked example and it shipped a
real bug this way.

**Gate.** The marker sweep is clean, the counts match the enumerated union, the duplicate-key sweep
is clean, every citation resolves to the line its sentence claims, and every re-anchored hook has
been checked against its semantic site.

### What the merge is _not_ allowed to be judged by

**An agent may propose a resolution. It may never be the judge of one.** The evidence is
unambiguous and it is the reason this skill exists:

- On **86 real merge conflicts extracted from production React-family code**, scored by executing
  2,540 hidden holdout tests that verify both branches' behaviour was preserved: **accept-both
  scored 48/86. The best one-shot model scored 36/86.** Naive concatenation of both sides beat
  every frontier model. The benchmark's own conclusion is that the task "likely needs iterative
  repair, execution feedback, or a stronger merge-specific agent loop." — MergeConflictBench,
  <https://github.com/Create-Inc/merge-conflict-bench>
- Across 7,938 conflict hunks from 1,439 repositories, **the best models correctly resolve less
  than 60% of merge conflicts** — and the authors' own risk accounting is the line to remember: a
  model "should be penalized for incorrect merge resolutions, which are worse for the programmer
  than leaving the conflict in place." — Merge-Bench, arXiv:2605.25890
- A calibrated judge on real Java conflicts "accepted 4 of the 5 resolutions that fail the
  deterministic structural check", which is the finding that **structural correctness must never be
  delegated to an agent.** — arXiv:2607.27674

So: an agent may read both sides and propose a resolution; that proposal is **unverified** until
both a deterministic check (`npm run tsc`, `npm run build`) and a behavioural test
(`npm run test`, `npm run test:e2e`) pass. The one thing a merge must never accept is a resolution
nobody ran.

The field's own support for the mechanism underneath this: structured merge tooling reduces
**false conflicts** without reducing **missed** ones (Appel et al., PACMPL 2016,
doi:10.1145/3133883 — "We find no evidence that semistructured merge leads to fewer false
negatives"), and **no tool merges TypeScript/TSX at the level of a React component tree**, which is
why this document is procedural rather than a tooling recommendation.

And the word for what the gates then establish is **plausible**, not correct: if the tests pass, the
merge might still be wrong, because tests do not execute every path. The field's standard
evaluation runs each merge's test suite and says so in the same breath — "our measured number of
incorrect merges understates the problem of incorrect merges." Write _plausible_ in the merge body
and you will never have to defend it.

---

## Phase 8 — the gates

From the repo root, in the worktree, **after** the merge is resolved and the sweeps are clean.
`docs/TESTING.md` is the authority; this is the merge-specific order and the merge-specific traps.

```bash
npm run tsc            # tsc -b. NEVER `npx tsc --noEmit` — the root tsconfig is a solution
                       # stub with "files": [] and type-checks ZERO files, always exiting 0.
npm run build          # not redundant with tsc: it catches Sass, wasm, PostCSS, asset resolution
npm run lint:check     # ESLint + Prettier over `git ls-files`
npm run test           # the app suite
npm run test:e2e:unit  # the e2e helper suite — run this whenever you touched e2e/
npm run test:e2e       # the locked wrapper. NEVER `npm run test:e2e:raw` from a worktree.
```

**`npm run test:e2e` is a queue, not a gate.** It takes a swarm lock, allocates a free port per run
and writes to its own output directory. **Nothing about the lock can fail a run**: queue full,
board unreachable, malformed lease, wait expired — each logs and the suite proceeds, because a lost
queue costs a concurrent run rather than correctness and both runs have their own ports. An earlier
version exited 4 when it could not have the lock, which turned an unenforceable mechanism into a
hard block on a merge gate; do not reintroduce one. `swarm check` exits **1** for a busy path, and
that is a different question from the one the queue answers, so do not read one as the other. A
bare `npx playwright test` from a worktree is the shape that reported seven product mutations green
against another checkout's code; it is `npm run test:e2e:raw` and it belongs to CI, where one job
owns one checkout.

**Gate output is part of the merge record.** Every failure gets a file, a count and a mechanism,
including the ones that are not yours. A pre-existing red test in a shared file is **reported, not
fixed**, distinguished with the phrase "inherited, not introduced" and the same command output
quoted on `main` to prove it.

---

## Phase 9 — the resolution record

**The merge commit body is the durable artifact.** Nothing else in this repository records why a
resolution was what it was, and the corpus is unusually good: of the last 200 merge commits on
`main`, **63 carry a body that is not just git's `Conflicts:` trailer** (the measurement, which you
should re-derive rather than trust):

```bash
git log main --merges -200 --format='%H' | while read -r s; do
  b=$(git log -1 --format=%b "$s" | grep -v '^#' | sed '/^$/d' | tr -d '\n')
  [ -n "$b" ] && echo x
done | wc -l
```

The body length tracks **how many judgement calls you made**, not the size of the diff.

The shape, from the three real ones:

> **What collided** → **why one side is right, in a subordinate clause** → **an explicit Kept /
> Overturned list, naming the symbol or the file** → **tests updated against the new premise rather
> than against a number that happens to hold** → **where the measured evidence now lives** →
> **the gates, with per-failure attribution**.

The load-bearing sentence form, which is why every merge body in the corpus reads the way it does:

> **Resolved rather than overridden, because main's panel work is right about the thing this branch
> was careful about.** — `e473a45f`

You are not allowed to write "kept ours" or "took theirs" without the reason clause. A reason you
do not answer stays in the tree as an unanswered argument, and the next agent reads it as a live
position.

Use this repository's own vocabulary, listed in
[Appendix B](#appendix-b--the-decision-vocabulary). Do not invent synonyms: a reader searching the
history for "re-derived" must find every re-derivation, and a reader searching for "silent" must
find every silent loss.

**A reviewer's finding sends the merge back.** A resolution is not finished because the gates are
green. Someone else reads the diff, the surrounding code, the tests, and re-runs the load-bearing
claim; a finding sends the task back. In the incident that review is what caught the three real
defects the branch had shipped with — a two-column collapse that produced a dead, crashing tile, a
section separator measured from a border box so it read as zero, and a three-dots menu taller than
the window with no way to scroll it — and the last of those got an e2e spec precisely because
jsdom cannot see it.

**Then land it.** Merge the clean branch into `main`. If a merge in `main` conflicts,
`git merge --abort` and redo it in the worktree. After any interrupted or abandoned merge, run
`git rev-parse -q --verify MERGE_HEAD` and `git rev-list --parents -n 1 HEAD` before committing: an
interrupted merge can leave `AUTO_MERGE` with no `MERGE_HEAD`, and `git commit` then lands a
single-parent commit that reads as a resolution.

---

## Appendix A — the conflict taxonomy

Every class below is real, in this repository, with its instance. The first ten came from the
incident that produced this document; the rest from the wider merge corpus.

### The ten that decide the merge

| #   | Class                                                              | Real instance                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A test asserts a premise the other side removed**                | `SidebarLeft.workspace.test.tsx` pinned `width:'108px'`; the other branch made one column the default. Resolved by reading the declared units off `style` rather than through `toHaveStyle`, which normalises `3.5rem` to `56px`. |
| 2   | **Opposing product decisions on one literal**                      | `useState(false)` vs `useState(true)`. Resolved against the operator's spoken instruction to the branch that had it.                                                                                                              |
| 3   | **Both sides rewrote the same explanatory comment**                | The `h-full` / `min-h-full` block in `SidebarLeft.tsx`; also `responsive-shell.spec.ts`, `text-tool.spec.ts`, `document-dialogs.spec.ts` — prose collisions above unchanged code.                                                 |
| 4   | **A duplicated numbered section**                                  | Two `## 79.` in `HANDOFF.md`, independently authored, both real. Main keeps 79; the branch renumbers to 83.                                                                                                                       |
| 5   | **A duplicated key added in two places, with no textual conflict** | `'toolbar-overflow'` in `curated.mjs`, present on `main` at `curated.mjs:947` and on the branch at a different line. The base has zero occurrences of the key. JS object-literal last-wins: git merged it cleanly and kept one.   |
| 6   | **A helper whose signature diverged**                              | `leftOf(): number` vs `boxOf(): {left, top}`, and the call sites diverged with it.                                                                                                                                                |
| 7   | **The same import, added twice**                                   | `SidebarLeft.tsx` and `SidebarLeft.flyout-hardening.test.tsx`. The trivial union — **and the most common shape, so do not let its triviality set your expectation for the rest.**                                                 |
| 8   | **A document was split on `main`**                                 | `main` split `AGENTS.md` into a thin root plus `docs/ORCHESTRATION.md`, `docs/TESTING.md` and `docs/PHOTOSHOP-UX.md`; the branch edited the long form. Ported the edit to its new home.                                           |
| 9   | **A generated file**                                               | `WORKTREES.json`, five merges deep. Regenerated, never resolved.                                                                                                                                                                  |
| 10  | **A structural union, no conflict at all**                         | The curated table gained entries from each branch. A union that git found by itself — still verify it, see class 11.                                                                                                              |

### Class 11 — the one that is not a conflict

`git reported this merge as resolved, and the committed file still contained live conflict markers.*
**Six** of them, in `AGENTS.md`: an unindented `<<<<<<< HEAD`at :57,`=======`at :759 and :1001,
**an indented`<<<<<<<`at :848**, and two space-separated`> > > > > > > main`label lines at :818
and :1003. They passed through three further commits before`ef85d3ab`repaired them. Neither`--remerge-diff`, nor `--cc`, nor the existence of a merge commit catches that. **A grep over the
merge's changed files does** — and it must allow leading whitespace _and_ require seven of the
marker character, or it finds 3 of these 6 while firing on every markdown blockquote in the
repository. → [Phase 7](#71-the-marker-sweep)

### The full resolution-pattern set

Each of these is a real merge in this repository, and each is a rule about a specific failure. The
proving sentence is quoted so a claim can be checked against `git show <sha>`.

| Pattern                                             | The rule                                                                                              | Proof                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Union, never a side**                             | The default. A conflict means two agents each found something.                                        | `b187ff00` "Resolved by union, not by picking a side"                                  |
| **Resolved rather than overridden, because …**      | When you keep the other side, name _what they were right about_, in a subordinate clause.             | `e473a45f`                                                                             |
| **Kept from main / Overturned from main**           | A paired two-line format. An operator instruction outranks both branches' reasoning.                  | `e473a45f`                                                                             |
| **Renumbered, never split**                         | On a duplicate section number: the incumbent keeps it, the newcomer takes `max + 1`, both survive.    | `5e01a612`                                                                             |
| **A re-derivation, not a merge**                    | When the merge's own resolution invalidated both sides' line numbers, a union keeps a wrong one.      | `272ec662`                                                                             |
| **Corrected rather than deleted**                   | A test whose premise was removed is rewritten against what is now true.                               | `f7c242c1`, `e473a45f`                                                                 |
| **Grafted, not duplicated**                         | Two tests share a title; one has an assertion the other cannot see. Take the assertion.               | `68efc478`                                                                             |
| **Folded in**                                       | A whole block superseded by the other side: its assertions are folded into the survivor.              | `52e000d7`                                                                             |
| **Ported**                                          | `main` moved the content; take its split and port your edit, reasoning intact.                        | `08bd4d16`                                                                             |
| **Transplanted**                                    | A safety net from one side attached to the other side's mechanism.                                    | `e3e55060`                                                                             |
| **Regenerated, never hand-merged**                  | Any generated artifact is regenerated by its generator. Not a judgement call.                         | `ce59ba0d`, `b187ff00`, `ceb6a01d`, `9e190fbf`                                         |
| **Re-anchored to the real …**                       | A hunk that textually matches a line is not the same hunk. Verify the semantic site.                  | `ec7a07e7`                                                                             |
| **Neither side alone is right**                     | The phrase family that marks a synthesised third design.                                              | `ec7a07e7`                                                                             |
| **Fixed rather than papered over**                  | A latent gap the merge surfaced is fixed, not smoothed.                                               | `e3e55060`                                                                             |
| **In main's favour / resolved from ours**           | A one-word decision is allowed when the mechanism is stated in the same sentence.                     | `b7bfcc9d` ("resolved in favour of main's version"), `68efc478` ("resolved from ours") |
| **A clean merge is not a correct one**              | Check the semantic invariants, not the markers.                                                       | `HANDOFF.md` §71, quoted inside the merge that reproduced it                           |
| **SILENTLY LOST / merged textually and silently**   | The names for the two ways git loses without telling you.                                             | `68efc478`, `7c9963aa`                                                                 |
| **Inherited, not introduced**                       | A pre-existing red test in a shared file is reported, not fixed.                                      | `b42843ee`                                                                             |
| **Reported rather than fixed here**                 | Same, in the words. A wrong fix to shared infrastructure is worse than a visible red test.            | `b42843ee`                                                                             |
| **Nothing was re-recorded or weakened to get here** | The sentence that closes a gate paragraph.                                                            | `f7c242c1`                                                                             |
| **One copy, not two**                               | When the same entry exists on both sides after renumbering, it is one entry.                          | `b42843ee`                                                                             |
| **byte-identical**                                  | A union collision is resolved by renaming _yours_, so the other side's code is untouched.             | `68efc478`                                                                             |
| **a merge, not a rebase**                           | A branch that already holds a merge replays its whole graph under `rebase`.                           | `e3e55060`                                                                             |
| **revert my workaround**                            | When the merge supplies the real fix, a branch-local workaround is a liability.                       | `10ff94d1`                                                                             |
| **withdrawn / retracted**                           | A claim that is false is retracted, and "a flag whose stated reason is false is worse than no entry." | `4f3dec7b`, `b187ff00`                                                                 |

---

## Appendix B — the decision vocabulary

Use these words, exactly. A reader searching the history for "re-derived" must find every
re-derivation; a reader searching for "silent" must find every silent loss. Each is a real usage.

| Term                                                                      | Means                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **union** / "a union, not a choice" / "take both sides"                   | Both sides kept, and the merge body says why dropping either loses something |
| **Kept from main** / **Overturned from main**                             | The paired two-line form for a resolution that is not a union                |
| **Resolved rather than overridden, because …**                            | You kept the other side, and you name what they were right about             |
| **resolved from ours** / **resolved to ours** / **in main's favour**      | A one-sided resolution, with the mechanism in the same sentence              |
| **renumbered to N** / **keeps its number**                                | The section-collision rule                                                   |
| **re-derived** (citations)                                                | Recomputed against the merged tree from the sentence that makes the claim    |
| **a re-derivation, not a merge**                                          | A union would have kept a wrong answer, so the claim was recomputed          |
| **corrected rather than deleted**                                         | A test was rewritten against the new truth                                   |
| **grafted**                                                               | One assertion taken rather than a second whole test                          |
| **folded in**                                                             | A superseded block's assertions merged into the survivor                     |
| **ported**                                                                | An edit moved to where the content now lives                                 |
| **transplanted**                                                          | A safety net attached to the other side's mechanism                          |
| **re-anchored to the real …**                                             | Moved to the semantic site rather than the textually matching one            |
| **regenerated rather than hand-merged** / **regenerated, never resolved** | A generated artifact, out of scope for textual resolution                    |
| **premise**                                                               | The assumption a test was standing in for, which the merge removed           |
| **inherited, not introduced**                                             | A failure that is not yours, with `main`'s output quoted to prove it         |
| **reported rather than fixed here**                                       | See above, in the words                                                      |
| **superset / strictly stronger**                                          | The mechanism that made a rejection legitimate                               |
| **genuinely unpinned**                                                    | A baseline that was never actually pinned, so its "passing" meant nothing    |
| **collateral**                                                            | Something the merge removed as a side effect, named as such                  |
| **a clean merge is not a correct one**                                    | The check you owe the merge                                                  |
| **SILENTLY LOST** / **merged textually and silently**                     | The two names for git losing without telling you                             |
| **One copy, not two**                                                     | The post-renumbering duplicate check                                         |
| **Nothing was re-recorded or weakened to get here**                       | The gate-paragraph closer                                                    |

---

## Appendix C — the questions file

**The format, with the reason for every element.** Read
[Phase 5](#phase-5--ask-the-human-in-a-file) for when to write one and what it must not contain.

**Where it lives.** Tracked, at the root of the worktree that owns it, merged to `main` like any
other artifact. **Not under `.kilo/`** — that path is gitignored and machine-local, and all three
dead question files in this repository are dead for exactly that reason. Per worktree, not shared:
one writer per worktree is the rule, and a single file written by N concurrent agents can race on
its own counts. If your question has to cross worktrees, it crosses by merge.

```markdown
<!-- questions-file: 1.0.0 -->
<!-- worktree: .kilo/worktrees/fix-x   branch: fix/x   base: <sha>   created: 2026-09-29 -->
<!-- authority: the human. This file is the ONLY place a blocking question is answered. -->

# Open questions — <branch>

<One paragraph: what this branch is trying to do, and that anything not answered here was
answered by assumption rather than by asking.>

**You write one line: `Answer:`. Do not move the row, do not delete a question, and do not edit
`Evidence`, `Options` or `Default` — the agent owns those and will move the row to `## Resolved`
once your answer is there, so the decision log stays complete.**

---

## Open

### Q-260929-001 — <the decision in one short noun phrase>

**Asked by:** <agent> · **Priority:** blocking | non-blocking · **Needed by:** <the condition,
not a date — e.g. "before the rail arithmetic is written">

**Question.** <One sentence, in the `facing` slot of a Y-statement: the non-functional requirement
at stake. A question, never a refactor prescription. Answerable without interpretation.>

**Context.** <Value-neutral: the forces in tension, described as facts and not argued.>

**Evidence.**
```

<file:line and command output. Fenced. No prose inside.>

```

**Options.**
| # | option | buys (`to achieve`) | costs (`accepting that`) |
|---|--------|----------------------|--------------------------|
| A | <named> | | |
| B | <named> | | |
| C | <not now — and why> | | |

**Default if unanswered.** <The option letter, and what the agent does.> The agent takes this
without asking at the deadline. Naming the default does not make the question optional.

**Answer:** <!-- operator: replace this line -->
**Answered on:** · **Answered by:** · **Supersedes:** · **Superseded by:**

---

## Resolved

### Q-260927-004 — <title>
**Answered:** <date> · **By:** <human> · **Answer:** <option letter and words>
<!-- the three lines below are the AGENT's, filled in after the move, not by the operator -->
**Consequence recorded:** <the one line that must now be true in the tree, and where>
**Implemented in:** <sha> · **Verified by:** <who — never the fixer>

---

## Assumed

### Q-260929-004 — <title>
**Assumed on:** <date> · **Assumed by:** <agent> · **Default applied:** <option letter>
**Ratify or overturn by editing this section.**
```

**Why each element is there:**

| Element                                  | Why                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `## Open` / `## Resolved` / `## Assumed` | An unanswered question is an **assumption on the record**, not a pending item. Without the third state, a question open through three sessions becomes a decision nobody made.                                                                                                  |
| `Q-YYMMDD-NNN`                           | Date-anchored, so two agents in two worktrees cannot collide and a merge can sort them                                                                                                                                                                                          |
| Fenced evidence + a base sha             | The handoff documents' own rule: line-numbered citations move with the file and a `grep` sweep does not catch it                                                                                                                                                                |
| `\| option \| buys \| costs \|`          | A question with no enumerated alternatives has not been researched; a question with options and no consequences hands the analysis back to the reader                                                                                                                           |
| A third row naming the rejected option   | "alternatives not chosen (not to be forgotten!)" — the reader must see what is deliberately not being done                                                                                                                                                                      |
| `Default if unanswered`                  | Converts a blocking question into a time-boxed one, which is the only way to keep progressing while it is open                                                                                                                                                                  |
| `Needed by` as a **condition**           | A date is a record; a condition is what tells the agent when to stop waiting. It is the **trigger** for the `## Assumed` transition, which is why the template has no separate `deadline:` field                                                                                |
| Answer slot, moved never deleted         | It is still relevant to know a decision _was_ made. Deleting it is how the same question is asked again next month                                                                                                                                                              |
| `Verified by:` never the fixer           | The handoff lifecycle's own rule, applied to decisions                                                                                                                                                                                                                          |
| **The field partition**                  | The operator writes the `Answer:` line only; the agent writes every other field **and performs the move** between sections. This is the only element that makes concurrent edits safe without a lock — and it is why the `## Resolved` template's agent-owned lines ship blank. |

**The two questions-worth rule.** Fewer than two options with known consequences is not a
question, it is a note. Fewer than two _real_ options — where "neither implementation is right;
re-derive it" is a legal answer — is a false dichotomy, and it is the specific failure a hard
merge falls into, because the temptation is always to offer the two branches and nothing else.
**The third row is not optional.**

**The three tests, applied before you send it.** Try to answer _"it didn't"_ inside the question's
own response format; if you cannot, the premise is embedded rather than tested. Strip every
adjective and adverb and read what is left; if the stripped version is a materially different
question, the removed words were leading. Count the options that favour the outcome you want
against those that do not; if there is no "neither" category and one is substantively plausible,
you have built a dilemma.

**Use the strong words only where a wrong reading causes harm** — the deadline, the default, and
the "what must not be done while blocked." RFC 2119 §6 is explicit that imperatives "MUST only be
used where it is actually required to interop or to limit behavior which has potential for causing
harm," and a `MUST` on a cosmetic preference trains the reader to ignore the strong words for the
places they matter.

---

## Appendix D — the web-platform feasibility classes

Every classification needs a source. The four classes: **A** natively supported · **B** achievable
with effort · **C** achievable with a real caveat · **D** not possible in a browser.

| Capability                                              | Class                          | Source and the reason                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pointer capture, coalesced events, `pointercancel`      | **A**                          | Baseline. `pointercancel` is the platform's own "I took this gesture back" signal, and it is observable                                                                         |
| One/two-column tools-rail toggle                        | **A**                          | Pure CSS grid. The fidelity question is what Photoshop does, not what the platform allows                                                                                       |
| Drag-and-drop _in_ from the OS                          | **A**                          | `DataTransfer`, `getAsFileSystemHandle()`                                                                                                                                       |
| Dragging _out_ of the browser as a file                 | **C**                          | A Chromium-only, **single-file**, URL-encoded drag type. It encodes a URL, not bytes, and one file per drag                                                                     |
| `KeyboardEvent.keydown` for bare-letter tool shortcuts  | **A**                          | Fires for all keys; they are not user-agent-reserved                                                                                                                            |
| Capturing the browser's or the OS's reserved keys       | **D**                          | Keyboard Lock is scoped to fullscreen and is browser-limited; the intent is games and remote-desktop                                                                            |
| Programmatic clipboard **read**                         | **C**                          | Needs transient activation _and_ a permission. Firefox and Safari do not support `clipboard-read` at all                                                                        |
| An OS-native window holding a floating panel            | **D**                          | `Window.moveTo` refuses any window not created by `Window.open`; a popup keeps its own chrome                                                                                   |
| Native title-bar control                                | **C**                          | Window Controls Overlay only, requires an installed PWA, and the buttons overlay your content and swallow clicks                                                                |
| A native application menu bar detached from the browser | **D**                          | No spec surface. The manifest `display` member has no menu value, and the HTML `<menu>` element was removed                                                                     |
| A live caret in rotated, skewed or scaled text          | **D**                          | A non-`none` `transform` creates a stacking context and a containing block; the caret and IME window are UA-drawn                                                               |
| Selectable anti-aliasing on canvas                      | **D**                          | The 2D context exposes no AA selector; it sits below `fillText`. So are OpenType features and variable-font axes                                                                |
| Enumerating installed fonts                             | **D**                          | Local Font Access is Chromium-only and permission-gated, and absent elsewhere. _Using_ a named font is **A**                                                                    |
| Canvas at 8000×8000                                     | **A** dimension / **C** memory | 8000 ≤ 8192, inside the **guaranteed** WebGPU texture floor. Memory is the real ceiling: one RGBA8 layer of that size is 256 MB, and the model is one canvas per layer per call |
| Full-bitmap undo at that size                           | **D**                          | Storage quotas are per-origin, best-effort, and eviction is silent. A **command log over replayable ops is B**                                                                  |
| Colour management / soft proofing                       | **C**, ICC round-trip **D**    | There is no ICC profile attachment to a canvas or a bitmap. This is a missing colour-science engine, not an API gap                                                             |

**Two things this repository has already paid for, both recorded in the code:**

- **`touch-action` is never actually set.** It appears in production `src/` only inside a comment.
  On a touch device the browser may claim the gesture as a pan or zoom before the app sees it, and
  `pointercancel` then arrives with no way to distinguish user intent. The drag self-cancels, which
  is safe, and never completes, which is the bug.
- **Every `OffscreenCanvas` processor runs on the main thread.** `new Worker` has zero occurrences
  in production `src/`. The work is structurally off the critical path already and not in threads —
  which is precisely the difference between class **B** and class **C** here.

**And the one that is a product decision wearing a platform costume:** the tools rail is _not_
resizable, and that is fidelity, not a platform limit. Adobe says "You cannot resize the Tools
panel or options bar." Keep the two apart, or a merge will "fix" a deliberate fidelity choice as
though it were a defect.

---

## Appendix E — the trap list

Schema: a bold claim shaped like a symptom, then what you will actually observe, then the defence,
then the mechanical check. **`Verified:` is omitted, and the entry marked `[unverified by me]`,
where the check was not actually run** — the same honesty convention the tool-creation skill uses.

1. **A branch tip is not always a merge's first parent — it depends which way the merge went.**
   Symptom: you take `git log -1 <merge>^1` believing it is `main` and it is the branch, or the
   reverse, and every preview built on it silently previews the wrong pair. **The two merges in
   this very incident have opposite orientations**, which is why no blanket rule works:

   | merge      | what it did                                        | `^1`                | `^2`                |
   | ---------- | -------------------------------------------------- | ------------------- | ------------------- |
   | `1eb275a1` | branch **into** `main` (a `--no-ff` landing merge) | `ae4052b2` — `main` | `02f0c4de` — branch |
   | `e473a45f` | `main` **into** the branch                         | `89d9a6e6` — branch | `55e17620` — `main` |

   Defence: **read the merge's own subject line** and take the parent that matches its direction, or
   use the branch ref directly. Then verify the tip you chose with
   `git merge-base --is-ancestor <tip> main` — for a tip that is still branch-only it must return
   **false**, and the failure mode to watch for is it returning **true** for a commit you believed
   was only on the branch.

2. **`--cc` does not grade severity, and counting it wrong reads as "clean".** Symptom: a merge
   with 8 real conflicts appears to report nothing, or appears to report a different set than git
   actually refused. `--cc` shows only hunks differing from _both_ parents, so a resolution that
   coincides with one side is invisible to it — on the incident merge it named 9 files where
   `--remerge-diff` named 11, missing two genuine conflicts and including one git merged cleanly.
   Worse, a combined diff uses the `diff --cc` header, so `grep -c '^diff --git'` returns **0** and
   looks like a pass. Defence: `git show --remerge-diff <merge>` and count `^remerge CONFLICT`
   (8 here, against `--remerge-diff`'s 11 files and `--cc`'s 9). Verified with the counts above.

3. **A merge can commit live conflict markers, and git will call it resolved.** Symptom: a merge
   flagged as a conflict lands with `<<<<<<<` still in the file, and it survives further merges.
   Defence: the grep in [Phase 7](#71-the-marker-sweep), over the merge's changed files, as a gate
   before anything else. **Prove it is quiet on a clean file first** — a sweep written as
   `'^[[:space:]]*(<{7}|={7}|>)'` finds only 3 of the 6 markers in `e473a45f:AGENTS.md` and fires
   83 times across this repository's own documents on ordinary blockquotes and table rules.

4. **`rr-cache` is shared across every worktree in this repository.** Symptom: a resolution you
   never made appears in a worktree you have never been in. Defence: never set `rerere.enabled`
   repo-wide here; scope it per invocation or point `GIT_RR_CACHE` at a per-worktree path. Check by
   running `git rev-parse --git-path rr-cache` from two different worktrees — the path **resolves
   to the same place** while `--git-path HEAD` does not. (The command's _output_ is not literally
   identical: the main checkout prints a relative path and a linked worktree an absolute one.
   Compare the resolved paths, not the strings.) Verified.

5. **`merge-tree` exits non-zero for reasons that are not conflicts.** Symptom: a branch reported
   as "conflicts" when the real answer is "could not be determined", and a branch reported as
   clean because the ref did not resolve. Defence: match `^CONFLICT` on stdout (the test is at
   `scripts/lib/worktree-inventory/git.mjs:214`), and degrade a failed run to **unknown**, never to
   clean — the rule the file's own JSDoc states at `git.mjs:194-197` and implements at `:231` and `:233`.

6. **An expired lease makes a file look free while the agent working in it is not.** Symptom: a
   `swarm check` returns `free` for a path another agent is actively rewriting, because its
   45-minute lease lapsed and was swept. Defence: an unclaimed path looks free — claim or hold it
   before editing, and treat "free" as "not currently locked", never as "nobody is here". See
   `docs/ORCHESTRATION.md:596-606`.

7. **The board cannot see two writers in one worktree, and cannot see two agents on one _feature_
   in two worktrees.** Symptom: two agents pick overlapping work and neither sees the other.
   Board identity is the git branch, and the lock test is foreign-vs-self by agent id, so it can
   only arbitrate on **paths** — and only across agents that are not the same branch. There is no
   feature axis at all. Defence: a `swarm note` naming the feature at the start, checked against
   the log before planning, and never a `grep`-filtered `swarm watch` — the filter is what hid
   the second agent's note in the incident.

8. **Renumbering a handoff section is a cross-reference rewrite.** Symptom: the section number is
   right and every `§N` reference to it in prose now points at the wrong entry. Defence: sweep all
   three handoff documents for the old number. The handoff importer's own test fails on a duplicate
   number, which makes it a tripwire for the count sweep.

9. **A letter-suffixed handoff heading is live, unreachable, and corrupts its parent.** Symptom:
   `## 15a.` opens no board item _and_ closes item 15's body mid-sentence, because the importer's
   number pattern does not match a suffix; a suffixed _retirement_ retires the parent. Defence:
   never write one. A fix for the existing instance was written and reverted because it introduced
   an origin shape colliding with the board's own namespace — **half-finished is worse than filed.**

10. **A test can pass on both branches and still be the thing that breaks.** Symptom: a unit or
    e2e spec that cannot fail — a vacuous locator, an assertion that a self-answering line already
    satisfies. Defence: prove each test red without its fix, and in this repository that proof
    must survive the dev server's transform (Vite strips type annotations, and esbuild rewrites
    numeric literals — so a type-level mutation never reaches the browser). **Confirm the mutation
    is actually in the served module before believing a green mutation result.**

11. **An e2e run attached to the wrong checkout reports everything green.** Symptom: a mutation
    campaign that "passes" and measured nothing. Defence: `npm run test:e2e`, the locked wrapper,
    never `npm run test:e2e:raw` from a worktree.

12. **A generated file in conflict is regenerated, never resolved.** Symptom: a 7,000-line
    hand-merge that no generator would produce and `--check` immediately rejects. Defence:
    `node scripts/worktree-inventory.mjs`. This repository's own instance of the trap is now
    unreachable, because `WORKTREES.json` is untracked, so the rule is stated for the generated
    files that are still tracked.

13. **An interrupted merge can leave `AUTO_MERGE` with no `MERGE_HEAD`.** Symptom: `git commit`
    lands a single-parent commit that reads as a resolution. Defence: `git rev-parse -q --verify
MERGE_HEAD` and `git rev-list --parents -n 1 HEAD` after any interrupted or abandoned merge.

14. **`.kilo/` is gitignored, so a worktree has no plan documents and no skills.** Symptom: the
    research corpus, this document, and every plan directory appear not to exist. Defence: read
    the corpus from the **main** checkout, not from the worktree. Verified: `git check-ignore -v
.kilo` names `.gitignore` and `git ls-files .kilo` returns nothing. Re-run the `check-ignore`
    form rather than copying the line number out of this sentence: `.gitignore` is one of the files
    in that worktree's stale-`HEAD` diff, and its line numbers move every time a rule is added.

15. **`helpx.adobe.com` returns HTTP 403 to a direct fetch.** Symptom: an arbitration step that
    concludes "Adobe does not document this" because the page could not be loaded. Defence: read
    the page through a search engine's live crawl, quote the page text, and label the result
    `ADOBE-DOC` at MEDIUM-HIGH rather than HIGH — a search-index excerpt is not a page you rendered.

---

## Appendix F — what to distrust in this document

**A `file:line` is a claim about a _file_, and a file can move its own content around without
changing one line of the thing it points at.** `AGENTS.md` was restructured and every citation into
it became wrong while the code it described stayed byte-identical. Re-derive each citation from the
sentence that makes the claim, and name a section beside every line — **a heading survives an
insertion above it; a line number does not.** A re-verification pass is required after _any_ change
to a cited document, not only to the code it points into.

**A count is the same defect wearing a different hat.** If a count is load-bearing, derive it in
the same sentence that uses it. Three files in this repository state a line count for
`.skills/photoshop-tool-creation.md` and **all three are wrong** — its own gitignored loader says
4,819, `docs/TOOLS-RESEARCH-BRIEF.md:103` says 4,371, and an earlier form of this paragraph said
4,395; `wc -l .skills/photoshop-tool-creation.md` is the only one of the four that can be right.
That is not a slip in a citation; it is a stale number that reads plausibly, which is the exact
failure mode this appendix is about. **Verify any count you copy from here, including this one** —
and note that the paragraph making that demand was itself carrying a wrong count, which is the
strongest possible argument for deriving rather than copying.

**Tooling behaviour is the least stable thing here.** A flag that exists in git 2.50.1 may not
exist in the next one, and a script's behaviour can change without a commit. Mark such a claim
`[unverified by me]` rather than deleting it — unverified means unverified, and it is not a claim
that the claim is false. Specifically re-verify: the `zdiff3` chain (there is no `git merge
--zdiff3` flag on 2.50.1; use `-c merge.conflictStyle=zdiff3` or `git checkout --conflict=zdiff3`),
and every `npm run` script name in [Phase 8](#phase-8--the-gates) — `package.json` is the
authority and it changes.

**Two things in this document are inferences from a shared framework, and are labelled as such.**
The panel-divider resize rule and the accent-key maximise behaviour are documented by Adobe for
the shared Application Framework but **not on a Photoshop page** — Photoshop's own `learn-the-basics`
set has no equivalent page. The framework is the same and the widgets are the same, so the
behaviour is very likely identical, but that is an inference and it is marked MEDIUM-HIGH for
exactly that reason. Do not harden it into a HIGH in a merge body.

**And the one that governs all of them:** where this document and `AGENTS.md` disagree, `AGENTS.md`
wins and this document is wrong. It is deliberately not the authority on anything `AGENTS.md`
already states.
