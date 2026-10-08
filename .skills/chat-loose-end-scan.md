---
name: chat-loose-end-scan
description: Find loose ends in recent top-level Kilo chats — chats that died on a network loss, a token wall or a tool error, and reviews whose findings nobody answered. Follows later chats that name an earlier chat to see whether the thread continued, then checks current main for whether the issue is actually closed. Read-only and time-windowed, default the last 4 hours. Use when asked what we left open, what died, which findings were never addressed, or to sweep chats for unfinished work before a landing.
---

# Chat loose-end scan

A loose end is a thread that named something concrete and then stopped without a
closing move. It shows up in this repo in three shapes:

1. **A dead chat.** The transcript stops mid-action — a tool call that never
   resolved, a model call that hit a credit or context wall, a turn that ended on
   an error. The work described up to that point is real; nobody finished it.
2. **An unanswered review.** A reviewer chat reported findings, ranked them, and
   the response either never came or never touched them. Reviewer findings that
   the same chat fixed on the spot are not loose ends.
3. **A named promise.** "Next I'd do X", "worth filing", "let me write that up",
   a plan that stops at phase 2 of 4. Same shape as a dead chat: a concrete claim
   with no closing move.

The hard part is not finding them. It is throwing away the ones that are already
closed, and there are three separate ways something is closed: the chat itself
finished it, a **later chat picked the thread up**, or **current main already has
the fix**. Missing the second one is the expensive mistake — a dead chat that a
later chat references by id is usually a thread that continued and got handled,
and reporting it as an open defect sends someone to redo finished work.

## Read-only contract

This scan **changes nothing**. Not the repository, not the database, not a
worktree, not a branch.

- Open the session database `mode=ro` and set `PRAGMA query_only=ON`.
- No `INSERT`/`UPDATE`/`DELETE`/`VACUUM`/migrate/repair. Not even to fix a row.
- Read-only git only: `git log`, `git show`, `git grep`, `git ls-files`,
  `git rev-parse`. Never checkout, reset, stash, branch, merge, or commit.
- Never resume, prompt, or message a session — including the ones you are
  reporting on. `kilo --session` and `agent_manager` **action:prompt** are out.
- The only files you may create are the scan's own working files and the findings
  doc. Put scratch outside the repo (the temp dir); put the doc in `.kilo/plans`.

`.kilo/` is gitignored, so writing the findings doc there needs no worktree and
no commit. Anything you write to a tracked path does.

## The window

Default **now → 4 hours back**. Keep it there unless the operator names a
different span; a wider window is not more thorough, it is more stale, because
every hour of extra history raises the chance that main has moved past the
finding and you will report a closed issue as open.

```bash
cd /path/to/repo
python3 .kilo/skills/chat-loose-end-scan/scan.py --hours 4 --root "$PWD"
```

Useful flags: `--start 2026-10-05T08:00:00Z` overrides `--hours`; `--batches 6
--batch-dir /tmp/x` writes char-balanced batch files for subagent fan-out;
`--emit-markdown .kilo/plans/<ts>-chat-loose-ends.md` writes the doc skeleton;
`--out /tmp/x/bundle.json` keeps the whole bundle. `--now-grace` (default 180s)
is how long a chat counts as still running.

## Pass A — read the chats, find what was left open

`scan.py` gives you the last 3 assistant messages of every top-level chat in the
window, plus a dead-chat verdict. It does not decide what is a loose end; you do.

Top-level only (`parent_id IS NULL`). Subagent chatter has its own transcripts and
its findings were already reported upward by whoever spawned it.

For each chat, in the tail, pull out every **concrete claim with no closing move**:

- a defect named with a file and a line, never fixed
- a review finding, still unaddressed at the end of the chat
- a "next step", "worth doing", "should", "would be better to"
- a plan that stops mid-phase
- work described as in progress when the transcript stops

Skip: status reports, pure questions, praise, taste-level polish with no defect
behind it, and anything the same chat resolved before it ended.

Rank by severity × confidence × cheapness, and prefer a defect with a mechanism
(silent failure, wrong pixel, missing gate, a test that cannot fail) over a
missing test over a doc line.

## Pass B — follow the later chats

For each candidate, ask whether **any other chat in the window continues it**. A
continuation is a later chat that names the earlier one:

- **by session id** — `ses_…` appears in its text. Strongest signal; an agent
  handing off or a successor picking up.
- **by exact title** — the title appears verbatim. Also strong.
- **by branch or worktree name** — worth grepping by hand; the script does not
  do it, and a branch name is how most continuations actually happen here.

`scan.py` computes id and exact-title edges and puts them in `referenced_by`.
Titles shorter than 8 characters are skipped as too collision-prone to be
evidence — and a great many are `New session - <timestamp>`, which match each
other's shape without meaning anything. When a chat has forward references, read
the referencing chat's tail. Usually the issue was handled there and the verdict
becomes CLOSED-BY-LATER-CHAT.

A candidate with no forward reference is **not** thereby open. It is merely
uncontinued. Pass C decides it.

## Pass C — infer from current main

Never conclude from the transcript. `main` moves while you work, and a six-hour-old
chat recommending a fix is a fix someone may have shipped in the meantime.

For each surviving candidate, against current `main` — re-read
`git rev-parse HEAD` at the start, because it will move under you:

1. **Is it still absent?** Grep and read the named code. `git log --oneline
--since=<window start> -- <path>` shows whether it landed after the chat.
2. **Is the problem still real?** Read the current implementation. Do not trust
   the old claim; a chat can describe a bug that a later commit removed by
   accident or design.
3. **Is the fix still the right one?** Check types, imports, existing helpers,
   and the decisions recorded in `AGENTS.md` and `docs/`. A recommendation that
   now contradicts a recorded decision is worse than useless — it will be argued.
4. **Is it already tracked?** If a live entry in `HANDOFF.md`, `.kilo/plans/`, or
   `e2e/OPEN_PROBLEMS.md` covers it, say so on the finding. Still a real defect,
   but not new work, and presenting tracked work as a discovery is how a sweep
   loses the operator's trust.

Verdict, one of: `OPEN`, `CLOSED-BY-MAIN`, `CLOSED-BY-LATER-CHAT`, `UNVERIFIED`.

`UNVERIFIED` means nobody read the code. It must never read like `OPEN`.

## Fan out, but stay under the cap

One analyst reading 30 tails will skim. Chunk by **characters**, not by chat
count — chat tails range from 200 to 9000 chars.

```bash
python3 .kilo/skills/chat-loose-end-scan/scan.py --hours 4 --root "$PWD" \
  --batches 6 --batch-dir /tmp/loose/b --out /tmp/loose/bundle.json
```

Then one `task` per batch, at most 6 at a time, each analyst read-only in the repo
and writing only its own report file. Give each one: the batch path, the
read-only contract, the three passes, and an instruction to record **rejections
with reasons**. The rejections are how you audit the sweep — a scan that reports
30 findings and zero rejections has been credulous.

Check `board_read` before you integrate; other sessions may have landed a fix
while the analysts ran.

## The findings doc

Write it to `.kilo/plans/<epoch-ms>-chat-loose-ends-<slug>.md`. Read
`.kilo/plans/` first and match the naming already there.

**Keep it loose.** It is read once by a machine and once by a human in a hurry,
so do not build a taxonomy, a table of eleven columns, or a scoring rubric. One
`##` block per loose end, prose, worst first. `--emit-markdown` writes the
header and a candidate list; the blocks are yours.

Every block needs: which chat, whether that chat died and on what, the verbatim
claim, whether a later chat continued it, what current main shows with
`file.ext:LINE` evidence, and the verdict as the last line. Ordering carries the
severity argument better than a column does.

`HANDOFF.md` is the wrong home for this. That document is problem-focused and
todo-oriented, entries there need a validated problem and an actionable fix, and
this scan produces a snapshot, not committed obligations.

## Pitfalls, each one paid for

**Timestamp comparison.** `time_updated` is integer milliseconds, but
`strftime('%s', …)` returns **text**, and in SQLite a number always sorts before
text — so `time_updated/1000 >= strftime('%s', …)` is silently false and returns
zero rows forever. Compare against `datetime(time_updated/1000,'unixepoch')`, or
convert the bound to integer epoch. This looks exactly like "the window is empty".

**Unbounded text search.** `instr()` over every row of `part` takes minutes. Always
filter by `session_id IN (…)` first; the same query is ~0.04s bounded.

**Directory matching.** `directory LIKE '/repo/%'` misses the main checkout,
because its directory is `/repo` with no trailing slash. Match
`directory = :root OR directory LIKE :rootlike`.

**Live looks dead.** A chat that is still running also ends on a `running` tool
part. Without a grace window the scan always flags the session doing the scan.

**The premise can be wrong.** The chat's own framing — "I fixed X", "the branch
landed" — is frequently false. In one sweep, a recommendation to delete a handoff
entry was premised on a fix that had **never landed**, which both kept a live
defect record alive and understated its blast radius from two sites to five. Read
the code; check the commit with `git log`.

**Already closed by a different mechanism.** A devious comparator, a threshold, an
ink-ratio check can be fixed by something other than what the chat proposed. The
recommendation is then moot while the defect is genuinely gone. Absence of the
proposed fix is not presence of the defect.

**Recommendation is not always right even when the defect is real.** In one sweep
a review demanded a bedrock guard on a one-shot filter; implementing it would have
disabled Levels, Blur and Colors on a Background layer, because Photoshop applies
filters to Background layers. Verify the fix, not just the finding.

**Repeated session titles.** `New session - <ISO timestamp>` titles collide by
shape. Never treat a title match on one of those as evidence.

**`HANDOFF.md` can assert the opposite of the truth.** One live entry claimed a
guard was "complete against the document's actual contents" while two call sites
bypassed it entirely. A tracked entry is a claim by a previous scan, not a fact.
