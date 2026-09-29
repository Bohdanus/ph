# AGENTS.md

Production-grade photo editor built as a Photoshop clone: the same tools, names
and muscle memory, not a lookalike with app-specific extras. The detail lives in
linked files; this file is the rules that apply to every task.

| File                                                   | Read it when                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| [`docs/TESTING.md`](docs/TESTING.md)                   | any check: `tsc`, `test`, `lint`, `e2e`, build, CI                  |
| [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md)       | other agents: worktrees, the board, the worktree list, a dead agent |
| [`docs/PHOTOSHOP-UX.md`](docs/PHOTOSHOP-UX.md)         | the Tools rail, tool names, Photoshop fidelity                      |
| [`docs/TOOLS-TOO-HARD.md`](docs/TOOLS-TOO-HARD.md)     | a Photoshop capability this browser cannot do, before estimating it |
| [`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md)           | finishing non-trivial work: launching the review subagent           |
| `HANDOFF.md`, `TEST-FLAKES.md`, `e2e/OPEN-PROBLEMS.md` | filing or checking a known defect                                   |

Skills are loaded from `.kilo/skills/`, gitignored, so the durable copy of every skill is the
tracked document it points at. There is no registry: the loader's `description` is the only
discovery mechanism, and a skill nobody can find is a skill nobody reads.

| Skill                     | Tracked document                                                           | Read it when                                                     |
| ------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `hard-merge`              | [`.skills/hard-merge.md`](.skills/hard-merge.md)                           | two branches implemented overlapping features and one has landed |
| `photoshop-tool-creation` | [`.skills/photoshop-tool-creation.md`](.skills/photoshop-tool-creation.md) | adding or changing a tool or its options bar                     |

## Subagents: THE DEFAULT, NOT THE FALLBACK

**LAUNCH AS MANY SUBAGENTS AS THE TASK WARRANTS. COMPUTE COSTS ZERO; QUALITY IS
THE POINT.** 40 sequential tool calls in one context = 8 parallel subagents + a
6-call synthesis. Sequential calls are the defect, not the token count. Delegate
**first**, not after you get stuck.

### Model policy

**ALL GPT MODELS ARE PAID. EVERY OTHER MODEL IS FREE. THAT IS THE WHOLE RULE.**

1. **A FREE SESSION MUST NEVER LAUNCH A PAID SUBAGENT.** A subagent may be weaker
   than its parent, never more expensive. A **PAID** session may spawn paid
   subagents on the turn's own model; a _different_ paid model still needs the
   user to name it in that request.
2. **ALWAYS PASS `provider` WITH `model`.** A bare name is matched leniently and
   can resolve to another provider's; with no `provider` it falls back to the Kilo
   Gateway, which returns a GPT model under a `~` id. **A `~` id is paid.**
3. The default: `'Space Bunny Alpha (new)'` / `kilo` / `max`. Other free models
   are useless; do not spend a turn sampling them.
4. **Double billing starts earlier on Luna** — ~200k there, ~270k on Sol and
   Terra. Keep the main turn lean; push fan-out into fresh contexts.
5. `agent_manager` inherits the turn's model too, so a paid turn spawns paid
   worktrees unless `model` and `provider` are both set.

Omitting those fields inherits the current model, which is what keeps a subagent
free when the main turn is not. **Never escalate to a paid model on your own**;
override only when the user named a GPT model, and say so when you do. `task` for
everything else; `agent_manager` only for visible sessions and worktrees. Audit
before spawning a fleet:
`sqlite3 ~/.local/share/kilo/kilo.db "SELECT json_extract(model,'\$.id') m, json_extract(model,'\$.providerID') p, count(*) FROM session GROUP BY 1,2 ORDER BY 3 DESC"`
(`session.model` is a TEXT column holding JSON; there is no `data` column).

### Rules of delegation

- **NEVER TWO SUBAGENTS ON THE SAME FILE.** Split by concern, not convenience.
- **Self-contained briefs.** A fresh context needs the goal, your constraints,
  whether it may edit, and what its final message must contain. "Return file:line
  for every match" beats "investigate the caching layer".
- **Ask for evidence.** A claim without `file:line` or command output is not
  verified. Re-check the load-bearing ones yourself.
- **Keep judgement calls.** Architecture, scope, whether a deviation is
  acceptable — a subagent cannot weigh this file against the operator's intent.
- **Background for long work**; wait for every result you depended on. NEVER
  answer while one is still running.

## ALWAYS launch a code review subagent after non-trivial work

**NON-TRIVIAL WORK IS NOT DONE UNTIL A REVIEWER SUBAGENT HAS READ THE DIFF.** Not
"self-reviewed", not "the gates are green", not "I re-read it twice". Launch it
**before** the merge, while a finding still costs one edit instead of a revert.

1. **Use the review prompt.** [`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md) carries
   the `code-reviewer` agent's prompt and its permissions — read it, and put that
   prompt in the brief verbatim. Never write a review brief from memory: the tracked
   copy exists because the original lives in gitignored `.kilo/`.
2. **Read-only.** `edit: deny`, `mcp: deny`. The reviewer reports findings, it does
   not fix them. A reviewer that edits is no longer a review.
3. **Self-contained brief**: worktree, branch, files in play, the diff range against
   `main`, and the required output — one `file:line` per finding, each with the
   concrete failure it causes.
4. **Several reviewers, split by file.** Never two reviewers on the same file; the
   rule above holds for reviews too.
5. **Re-run the load-bearing claims yourself.** A review you did not re-check is a
   review you did not perform, and a subagent is not an authority.
6. **A finding sends the task back.** Fix, re-review, then merge. "Reviewed,
   nothing found" is only a claim while the findings that were weighed are on the
   record.

The reviewer reads code; it does not run the gates.
[`docs/TESTING.md`](docs/TESTING.md) is the floor under a review, never a
substitute for one.

## NEVER OPEN A BROWSER WINDOW

**A headed browser takes over the operator's screen and their input reaches the
page as real test input, so a headed run fails for reasons that are not in the
code.** Never pass `--headed`, `--ui`, `--debug`, `show-report`, `show-trace`,
`codegen` or `PLAYWRIGHT_ALLOW_HEADED=1`, and never "fix" a failure by flipping
the mode. If it only reproduces visually, ask the operator to run
`npm run test:e2e:headed`. Table and the two holes in enforcement:
[`docs/TESTING.md`](docs/TESTING.md).

## Typecheck

`npx tsc` type-checks **zero files** and exits 0 — `node_modules/.bin/tsc` is a
guard that refuses it. `npm run tsc` (`tsc -b`) is the real typecheck.

## Working with other agents

Detail in [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).

- **Every change to a tracked file happens in its own worktree under
  `.kilo/worktrees/`, on its own branch**; `main` is for reading and merging. Run
  `git rev-parse --show-toplevel` before the first edit and create it first —
  `git worktree add -b fix/task .kilo/worktrees/task`, lowercase prefix. One task,
  one worktree, one branch; never nest inside one you are already in. Exceptions:
  read-only work, and changes the operator asked for on `main` — **a doc-only
  change is not an exception.** Never edit in `main` and move it later.
- **One writer per worktree; readers may share it.** Two root-level agents (chats
  a human started) never _write_ the same worktree, and one does not take over one
  another is writing in. Read-only agents may share freely — inspect, review,
  audit — but must mutate nothing: no commit, checkout, reset, install or worktree
  removal. Subagents of one root agent share its worktree and split by file. The
  board cannot enforce this: identity is the branch.
- **Claim what you touch before the first edit:** `npm run swarm -- claim <id>
--files <paths>`, or `npm run swarm -- hold <path>`, and `npm run swarm -- check
<paths>` before editing anything a brief or a sibling names. A refused hold
  names the holder — take their lock first, never `--force` it. `npm run swarm --
note` a branch you are about to land, before you start resolving it.
- **Merge order:** `main` into the branch **in the worktree**, resolve and run
  gates there, then merge the clean branch into `main`. Never resolve a conflict
  or repair the index in `main`. Never `git stash` — a shared unordered stack.
- **A quiet agent is not a dead agent.** Preserve before reclaiming: `git -C
<worktree> status` / `diff` / `log -1`, then `npm run swarm -- doctor --dry-run`,
  then `npm run swarm -- doctor`. Force-release only a session confirmed dead,
  never a network-lost one.
- **The worktree list is generated, never written by hand.** Run
  `node scripts/worktree-inventory.mjs` and read `WORKTREES.json` before deleting
  a worktree. **0 commits ahead of `main` is not evidence one is disposable** — it
  can hold uncommitted work on no ref.

## Architecture status

`PaintToolName` is `'brush' | 'pencil'` and that narrowing is load-bearing: a tool
that SUBSTITUTES pixels cannot share a processor, args type or options bar with
one that STAMPS them — sharing is what let a forced `'spray'` `penType` masquerade
as a tool setting, and a tool that left the paint panel must not be widened back
for a new bar. Corollary (`HANDOFF.md` 70): a group that persists one key may not
absorb a tool that has more than one.

`HistoryItem[]` is the **PRODUCTION REPLAY AUTHORITY** — history,
`history-replay.ts`, runtime `Layer`s, export. The durable document is
shadow-only. **DO NOT start single-writer cutover while `saveLayerCanvas()`
promotes cached canvases outside reducer publication.**

## Definition of Done

**NOT DONE UNTIL MERGED INTO `main` AFTER A THOROUGH CODE REVIEW. NOT
"IMPLEMENTED", "COMMITTED", "PUSHED", "PR OPEN", OR "THE TESTS PASS".**

1. **Isolated**, in its own worktree on its own branch.
2. **Green locally** — the commands and gates are
   [`docs/TESTING.md`](docs/TESTING.md). "Already failing" is a fact to report,
   not a reason to stop.
3. **Covered** by a test that fails without the change.
4. **Documented**: handoff updated, plus any new gate, test trap or architecture
   boundary where the next agent looks.
5. **Reviewed by someone else** — a code review subagent on the prompt in
   [`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md): the diff, the surrounding code, the
   tests, and its own load-bearing claim re-run. A finding sends the task back.
6. **Merged into `main`** after review and passing gates. Pushed, `main` green.
7. **Reported as done**: what changed, what validation ran, what the review said.

- **A green gate is the floor, not the review** — `gate:commit`/`gate:push` are
  mechanical, and a review not performed is not a review that found nothing.
- **Only step 6 writes to `main`** (plus an operator-requested hotfix on `main`).
- **A blocked merge is not done.** Say what is outstanding.

## Handoff documents

`HANDOFF.md`, `TEST-FLAKES.md`, `e2e/OPEN_PROBLEMS.md`: validated, actionable
problems only — **no changelog or status summaries**, verified against the tree.
**Write the handoff WITHOUT ASKING** for every validated issue; ship it with the
work.

- **Route by scope.** `HANDOFF.md` for history/replay and document state;
  `TEST-FLAKES.md` for test infrastructure (flakiness, the pool, the runner, the
  gates); `e2e/OPEN_PROBLEMS.md` for Playwright. A cross-scope entry is the one
  nobody reads.
- **Nothing durable goes in `.kilo/` or the swarm database** — both are
  machine-local. Close the swarm entry when its finding leaves the handoff.
- **Line-numbered citations move with the file.** Growing a file **silently**
  invalidates every `file.ts:NNN` pointing into it; re-derive each from the prose's
  claim. **A `grep` sweep does not catch it** — the text at the stale line still
  looks plausible — and a correction from an audit needs the same check.
- **No wall-clock numbers in this repo's gates, hooks or docs.** Every cost figure
  has gone stale; one was never measured at all and drove a shipped decision.
  Measure before you design; leave no number behind.

### Lifecycle: entries die, they never get reworded

- **Verified fix: DELETE the entry.** Verification is another agent, review or
  test — not the fixer's claim.
- **Never rewrite an open problem as closed.** Keep unverified work as the exact
  remaining verification; keep only test tripwires after a fix.
