---
name: overnight-sweep
description: Autonomous overnight hardening of the `ph` Photoshop clone against open defects in `HANDOFF.md` and related records. A Git-capable coordinator owns a dedicated task worktree and repository operations, with bounded read-only free-model research and hourly resumptions. Does not stop until told to stop.
---

# Overnight Project Hardening

This skill captures the recurring **overnight-hardening** pattern: a long-running, scheduled,
subagent-orchestrated pass that hardens the project against the open defects recorded in
`HANDOFF.md`, `e2e/OPEN_PROBLEMS.md` and related docs, then lands the verified fixes to `main`.
It adapts the operator's recurring request for rigorous overnight hardening and resumes hourly
while authorized so the run can recover from token limits and session loss.

The two things that make the run survive a whole night are the **persistent hourly cron** and the
**explicit rule that the run does not end until it is told to stop**. Every other detail is a
consequence of that longevity: subagents are used pervasively to spend free-model tokens instead
of yours, `main` is reconciled through a dedicated landing worktree rather than the hardening
tree, and each fix is landed and its `HANDOFF.md` entry retired before the next is started.

## Coordinator and Free-Model Boundary

The root run must be a session permitted by the current host policy to perform Git operations.
In Kilo, a free session **must not perform any Git operations**, including read-only Git commands,
worktree creation, commits, merges, resets, or disposal (AGENTS.md, MODELS.md). The coordinator
owns branch/worktree setup, repository inspection, tracked edits, validation, review coordination,
commit, landing and cleanup. Do not start the full run in a Kilo free session and then expect it to
execute the Git-dependent phases below.

- **Coordinator**: operates from a task worktree, may launch eligible free read-only subagents,
  verifies their findings, and retains sole ownership of Git operations and tracked changes.
- **Free Kilo research subagents**: use the read-only `explore` role, receive bounded questions,
  the absolute worktree path, and an output shape (not a write destination). Deny `edit`, `bash`,
  and any separate write/patch tools; Kilo permissions are tool-level, with no delete-only rule.
  They return findings in their task response and never edit, delete, run Git commands, spawn GPT
  agents, or decide whether a branch is safe to land or dispose. The coordinator writes notes and
  verifies source claims directly.
- For visible free Kilo research sessions, select the project `read-only-research` agent in
  `.kilo/agent/read-only-research.md`; it denies native edit, shell, delegation and common
  mutation-named MCP tools. Deny any connected file-mutating MCP tools not covered by those
  patterns; permissions are tool-level.

If the current root session is free, restrict it to read-only research and hand the run to an
authorized coordinator before any Git operation. If no coordinator is available, return a concise
blocked handoff and stop; do not create a second session/worktree just to evade the host's
permission boundary. Use the exact current free model/provider pair from the live
catalog for children; a paid Luna reviewer is considered only when the coordinator's budget policy
allows it and no suitable free reviewer can do the bounded task.

## Operating Rules

- All tracked edits live in one dedicated task worktree, e.g.
  `.kilo/worktrees/overnight-hardening-YYYYMMDD`, on a branch with an allowed lowercase prefix
  such as `fix/overnight-hardening-YYYYMMDD` (docs/ORCHESTRATION.md, "Worktrees"). `main` is not
  used for edits or conflict resolution; only the designated main worktree is used for the pinned
  final landing. Read `docs/ORCHESTRATION.md` § "Landing" before the first merge.
- **Resume scheduling**: create a persistent hourly cron with `cron_create`, using
  `cron: "0 * * * *"` and the resumer prompt below. The recurring cron stays armed if one
  invocation ends from network loss or token exhaustion; the next scheduled tick resumes the
  work when the session is available. Missed ticks are not replayed as a backlog. Do not substitute
  `schedule_wakeup`: it fires once and will not re-arm itself if the chat
  dies. If cron creation returns an actual error, report it and use the normal operator recovery
  path rather than silently switching to a one-shot wake.
- Model routing (read `MODELS.md` first): the free route is `Poolside: Laguna S 2.1 (free)`,
  provider `kilo`, variant `thinking`. Verify against the live catalog with
  `node scripts/free-model-pool.mjs --list` and the 200 req/hour ceiling (MODELS.md). For bounded
  single-model calls, use
  `node scripts/free-model-pool.mjs --prompt-file PATH --output-file PATH --max-tokens N` to keep
  large responses out of context. The runner uses the authenticated Kilo Code CLI, discovers it
  from `PATH` or the editor extension, and gives it a tool-denied profile; do not replace it with
  direct Kilo Gateway HTTP inference. Inference can take five minutes, separately from catalog and
  quota checks. Never launch GPT (Luna/Terra/Sol) subagents from a free session.
  Always pass `model` and `provider` together so a named paid model does not fall back to the
  zero-token gateway. Before and after a large OpenRouter-backed fan-out, run
  `node scripts/free-model-pool.mjs --openrouter-quota`; its server-side daily counter is
  authoritative for this account and is separate from the Kilo per-IP hourly ceiling.
- **Quota-aware subagent protocol** (MODELS.md "Free Model Rotation" and "Token-Saving Research
  Protocol"): the current `swarm` CLI does not expose `tokens --json`, so do not treat that
  command or `swarm status` as budget telemetry. Refresh eligibility with
  `node scripts/free-model-pool.mjs --list`, use only exact zero-priced model/provider pairs, and
  never fall back silently to paid inference. If the host exposes separate budget data, follow its
  current policy; otherwise treat paid capacity as unknown and stop free launches when providers
  report throttling or exhaustion. Do not invent quota percentages or reset windows.
- Cap concurrent subagents at 15 (`concurrent_agent_cap`). Before each launch, check current
  running work; do not duplicate an in-flight task just to fill a quiet hour. On a rate limit,
  record the failed attempt and use a different eligible free model/provider only if the refreshed
  catalog and policy permit it. A resumed task retains its model; do not describe it as switching
  models. If free routes are exhausted, pause that research and continue with coordinator-owned
  verification or other ready work.
- Photoshop behavior, UX and non-trivial algorithms require Adobe or other primary-source
  research. Record source URLs, versions and unresolved claims in a research note or handoff.
- Every non-trivial implementation requires a fresh read-only code review per
  `docs/CODE-REVIEW.md` § "Review a subagent change" (verbatim brief, `file:line` finding format);
  cross-module, persistence/migration, architecture-boundary and broad-regression changes require
  two reviewers split by concern. Fix and re-review blocking findings. See also
  `docs/ORCHESTRATION.md#the-task-lifecycle`.
- Security vulnerability → invoke the security-review process.
- Tests support confidence, not definition of done. Prefer existing focused tests; add the
  smallest necessary regression test only. No new E2E unless behavior is otherwise unvalidated.
  Never weaken gates or re-record baselines. See `docs/TESTING.md#gates` for commands and known
  failures.
- Run `npm run repo:state` before landing. For cleanup, also run
  `node scripts/worktree-inventory.mjs` and `npm run branches:orphan`; preview
  `npm run swarm -- doctor --dry-run` before any disposal (AGENTS.md). After landing, run
  `npm run tsc`, `npm run build`, and `npm run lint:check` in the designated main worktree to
  confirm the merge did not regress the build.
- **Never `git stash`** (AGENTS.md § "Coordination And Cleanup",
  `docs/ORCHESTRATION.md` § "Landing"): it is a shared unordered stack; `git stash` on a
  clean tree exits 0 with no entry, so the next `pop` takes somebody else's changes.
- Use `board_post` for material findings (live-owner claims, planted mutants, duplicate
  branches): the formatted message is capped at 4096 bytes / 3800 ASCII chars when no non-ASCII
  (AGENTS.md). Put longer evidence in a file and reference it from the board.
- Never open a browser. `npm run test:e2e` starts its own dev server; a headed run fails a
  disjoint set of tests, so "goes away headed" is re-routed, not fixed (AGENTS.md).

## Setup — the recurring launch

Every overnight-hardening session follows the same shape:

1. `git worktree list --porcelain` → identify the designated `refs/heads/main` worktree → create
   `.kilo/worktrees/overnight-hardening-YYYYMMDD` on
   `fix/overnight-hardening-YYYYMMDD` from current clean `main`. Verify the new checkout before
   any npm command or fan-out.
2. Write `.kilo/plans/overnight-hardening-YYYYMMDD-plan.md` with the research agenda and the
   HANDOFF.md entry clusters to verify.
3. Initialize `.kilo/plans/overnight-hardening-YYYYMMDD-checkpoint.md` with each child task's
   exact ID, unique scope, initial prompt, model/provider, launch time, last host result, and next
   action, plus the last wake timestamp. On resume, consume delivered task results/notifications
   by exact ID and persist each result once; do not infer completion solely from database
   `time_updated`, which can change for bookkeeping reasons.

   **Respect the current host API.** Kilo's internal `task` tool supports starting a child and
   resuming a known task ID; it has no `list` or `status` operation. A new `task` call is work,
   not a poll. If a recorded child has no delivered result, keep it `pending/unknown` and do not
   relaunch its scope. Resume only that exact ID when the task host explicitly reports it
   resumable/failed, or when the operator directs a resume. For visible Agent Manager sessions,
   use `agent_manager list` and target the returned session ID; do not pass an internal task ID
   to Agent Manager. If the host exposes no state query, record that uncertainty and leave the
   child pending for the existing recurring wake; do not create an extra wakeup or launch a
   duplicate task to guess from timestamps.

4. Schedule the recurring hourly cron with `cron: "0 * * * *"` and the resumer prompt below.
   Verify the cron task was created before starting the research fan-out.
5. Fan out the first wave of free-model research using read-only Kilo `explore` children or the
   tool-free completion runner. Pass the absolute worktree path, evidence scope, and concise output
   shape in every brief. The coordinator writes any summary files. Refresh the free model catalog
   per the quota-aware protocol; for a large OpenRouter-backed wave, check the server-side daily
   counter as above.

## Tracking "new since last wake"

Each wake loads the checkpoint and checks the retained conversation for Task tool results or
completion notifications for the recorded child task IDs. Only results newly reported as completed
since the last wake are synthesized into
`.kilo/plans/overnight-hardening-findings.md`, then merged into the plan. Save the checkpoint only
after capturing each result and its evidence. Findings accumulate; resolved candidates are marked
`done` and not revisited without new evidence. Session-database timestamps are supporting clues,
not a task-completion cursor.

## The recurring prompts

These are prompt templates, not claims to reproduce a historical user message verbatim. Adapt the
initial template to the actual request, preserving its scope and constraints.

### Initial prompt template

> do rigorous overnight hardening of the project. Reconstruct and understand issues in great
> detail using docs, code, chat transcripts. Fan out bounded free read-only subagents to do deep research:
> scan large amounts of docs, code, transcripts, do websearch, etc. Use the catalog entry
> `Poolside: Laguna S 2.1 (free)` (provider `kilo`, variant `thinking`) heavily for broad
> investigations when they appear in the refreshed free catalog; otherwise rotate to another
> verified zero-priced model/provider or pause when none is available. Take most complex and
> prioritised issues first. This must be long running
> overnight autonomous session. Most likely points of failure: (1) llm decides task is done while
> it should keep going; (2) free-model capacity might become temporarily unavailable; (3) other unknown
> error. Mitigate execution stops with a persistent hourly cron created by `cron_create` using
> `cron: "0 * * * *"` and the resumer prompt. The recurring cron stays armed across network or
> token failures; the next scheduled tick resumes when the session is available. Missed ticks are
> not replayed as a backlog. Do not replace it with a one-shot wake that requires re-arming.

### Hourly Cron Resumer

Use as the `prompt` for `cron_create` with `cron: "0 * * * *"`:

> You are a professional orchestrator running an overnight hardening session on the `ph`
> Photoshop clone project. Your job is to keep working autonomously until told to stop.
>
> Current state: you are operating from the `overnight-hardening-YYYYMMDD` worktree. The plan is
> at `.kilo/plans/overnight-hardening-YYYYMMDD-plan.md`. The checkpoint cursor is at
> `.kilo/plans/overnight-hardening-YYYYMMDD-checkpoint.md`. Subagents have been launched to
> research HANDOFF.md entries, code/doc drift, test coverage, and Adobe documentation.
>
> Your hourly task:
>
> 1. Review ALL subagent results completed since your last wake (compare against the checkpoint
>    cursor).
> 2. Synthesize findings into `.kilo/plans/overnight-hardening-findings.md` and merge new
>    findings back into the plan.
> 3. Update the checkpoint cursor with all currently-known subagent session IDs.
> 4. Identify findings that translate to verified, safe fixes — implement them in the worktree.
> 5. Launch NEW free research children only for uncovered areas needing investigation. Use Kilo's
>    read-only `explore` role with write/shell tools denied, or use the completion runner. Refresh
>    the free catalog before each; for large OpenRouter-backed fan-outs, inspect the server counter.
> 6. Re-run `npm run tsc` and targeted `vitest` after every code change.
> 7. Do NOT stop. Do NOT declare "done." Continue investigating, verifying, and fixing until
>    explicitly told to stop.
>
> Constraints: you are the Git-capable coordinator operating in the verified task worktree. Free
> Kilo free subagents use a read-only role with file-write, patch, shell, and Git tools denied.
> They return concise results; you write any notes. You own repository inspection, edits,
> validation, commit, landing and cleanup. `HANDOFF.md` is the source of truth. Before each
> subagent launch, refresh the free model catalog; use only a verified free model/provider pair
> unless host policy and budget explicitly permit paid use. Stop if free routes are exhausted. Do
> Use the already-armed hourly cron for recovery. Do not replace it with a one-shot wake.

If no subagent has completed since the last wake, do not duplicate work just to keep the fan-out
busy. Verify current candidates, continue safe coordinator-owned work, or wait for the next
authorized wake. Respect the concurrency cap and free-route availability.

## Phase 1: Find and Rank Candidates

Read selectively: `HANDOFF.md` (the source of truth), `e2e/OPEN_PROBLEMS.md`, `TEST-FLAKES.md`,
`docs/FEATURES.md`, `docs/ARCHITECTURE.md`. Search code only to validate candidates, never to
audit the whole tree. Mark resolved, landed, stale, duplicate and owned entries as inapplicable —
including entries whose fix already landed on `main` since the plan was written (re-check
the current main SHA and `git cherry main <task-branch>` after each wake; `main` does not stop for
the run and inventory/branch facts are point-in-time evidence).

Rank order:

1. Data loss, corruption, security exposure, or hard user-visible failure; honor assigned severity.
2. Unblocks other documented work or removes a shared prerequisite.
3. Strong evidence and reproducible/provable cause over speculative symptoms.
4. Maximize user benefit relative to cost; favor small bounded fixes.
5. Unfinished features only when behavior is clearly documented.

**Good-enough-to-fix threshold (the Phase 1→2 gate):** a candidate is safe to attempt only when
all of these hold: (a) the cause is confirmed against the current `main` baseline,
(b) the fix touches a bounded set of files with no cross-module boundary change (cross-module
requires two reviewers per Operating Rules), (c) the coordinator's task worktree has no
unexplained `mustNotPrune` veto on landing and `npm run swarm -- check <paths>` reports no file
claim, and (d) the fix has a clear, fast
validation path (`npm run tsc` + targeted `vitest`, or the specific `npm run lint:check` scope).
Candidates that fail this gate go to Handoff, not to Solve. `HANDOFF.md` entries whose fix is
already on `main` by `git cherry main <branch>` patch-id absorption are retired, not re-done.

## Phase 2: Coordinator Loop — Find → Solve → Scope → Validate → Review → Commit → Land → Repeat

For each selected issue:

1. **Find**: read the problem entry plus minimal relevant code/docs. Verify it is still open on
   the current `main` baseline; reproduce or confirm the cause. A fix whose patch is already on
   `main` is retired, not re-done. Re-check `git rev-parse main` and `git log --oneline -1 main`.
2. **Solve**: high confidence → narrowest complete fix across affected surfaces. Update directly
   related docs/tests only as needed. Do not use `git stash`; keep work in the working tree.
3. **Scope check**: confirm the change set is single-module or obtain explicit two-reviewer
   approval for cross-module/architecture-boundary changes. `npm run swarm -- check <paths>` must
   pass.
4. **Validate**: smallest useful focused check (`npm run tsc` for a TS change; the targeted
   `vitest` file for a test fix; `npm run lint:check` for a linted surface). Consult
   `docs/TESTING.md#gates` for commands and known failures. No broad or E2E suites by default.
5. **Review**: `git diff main...HEAD` for unintended behavior, stale references, missing surfaces,
   out-of-scope changes. Complex task → a fresh read-only review subagent per `docs/CODE-REVIEW.md`
   § "Review a subagent change" (verbatim brief, `file:line` findings); cross-module/architecture
   boundary changes → two reviewers split by concern. Fix and re-review blocking findings.
6. **Commit**: update any verified-fixed `HANDOFF.md` entry per that document's retirement rules.
   Resolve the current host's chat ID using `docs/CHAT-ID.md`, stage only the reviewed paths, and
   commit in the task worktree with exactly one valid `Chat:` trailer. Do not create a `.mjs` file
   as a stand-in for a commit or rely on ignored `.kilo/plans/` content as a handoff artifact. A
   free research child does not commit.
7. **Handoff** (insufficient evidence, or candidate failed the good-enough-to-fix threshold): no
   speculative fix. The coordinator writes a concise, evidence-backed handoff to the canonical
   problem document or a durable tracked plan, naming affected files and the exact next experiment.
8. **Land**: sync current `main` into the candidate branch in the candidate worktree, resolve any
   conflicts there using the recovered requirement, rerun gates and review the final composition.
   Then follow `docs/ORCHESTRATION.md` § "Landing" from the designated main worktree only: require
   a clean checkout, prepare `git merge --no-commit --no-ff <full-reviewed-sha>`, pin both parents,
   the prepared result tree, branch and chat, and invoke `node scripts/commit-reviewed-landing.mjs`.
   Do not land from an arbitrary fresh task worktree or resolve conflicts in main.
9. **Post-landing**: in the designated main worktree, run `npm run tsc`, `npm run build`, and
   `npm run lint:check` to confirm the merge did not regress the build.
10. **Cleanup**: only after `repo:state`, status inspection, relevant handoff review, fresh
    inventory, `branches:orphan`, descendant/session liveness and live-overlay review, and
    `npm run swarm -- doctor --dry-run`, run `npm run dispose -- <name> --dry-run`. Inspect its
    result, then use `npm run dispose -- <name>` only if ownership is proven and no live writer or
    veto remains. If the current session is still a live writer, defer disposal; do not suppress
    or bypass the guard. Regenerate inventory after any worktree removal.

### Hard-merge procedure (when `main` advanced or conflicts exist)

1. Follow `.skills/worktree-merge-harvest.md` and `docs/ORCHESTRATION.md` § "Landing". Merge or
   rebase current `main` into the candidate **in the candidate's own worktree**, resolve conflicts
   there against the recovered requirement, then rerun the required gates and independent review.
2. The final landing is a mechanical pinned merge in the **designated main worktree** only. Use
   `commit-reviewed-landing.mjs` there with the exact main SHA, incoming SHA, prepared result tree,
   source branch and chat ID as documented. It refuses invocation from an arbitrary task worktree.
3. Land one candidate at a time. Never resolve or repair a conflict in main; never use `git stash`,
   `reset --hard`, `checkout --ours/--theirs`, `hash-object`, or `update-index` in the main checkout.

Repeat until no high-value actionable candidates remain, the run window is exhausted, or a gate
blocks safe progress. A blocked/uncertain item does **not** abandon unrelated ready work, and a
blocked item is re-checked after every `main` advance (it may have landed meanwhile). Do not
revisit a rejected candidate without new evidence.

## Landing — `main` moves under the run

The hardening tree is cut once and ages; `main` does not. Treat `ahead`, `behind`, conflicts and
ownership as per-instant facts. Before landing, sync current `main` into the candidate worktree and
rederive the diff, gates and review there. Resolve conflicts only in that candidate worktree. The
final pinned merge is then prepared and committed from the designated main worktree, never from a
second checkout of the `main` ref.

## When the run stalls, keep it going

- **Free-model throttling / quota exhaustion**: record the failed task and provider. Per MODELS.md,
  try a different currently eligible free provider/model in a new bounded task only if the refreshed
  catalog supports it. Do not assume a resumed task changes its model and do not use paid fallback.
  If no free route is available, record the limit and continue coordinator-owned work or wait.
- **Token wall on a paid model**: keep research on eligible free routes. Consider a paid Luna
  reviewer only when the current quota policy permits it, no suitable free reviewer is available,
  and the coordinator records why the paid review is necessary (MODELS.md).
- **Network loss / stopped chat**: the recurring hourly cron stays armed if an invocation ends
  unexpectedly; the next scheduled tick resumes when the session is available. Missed ticks are
  not replayed. Re-read the plan and findings and rederive repository state from the task worktree
  before resuming. See `docs/ORCHESTRATION.md` § "Unexpected agent recovery".
- **Subagent produced unusable output**: empty, wrong, or irrelevant results are a quality failure,
  not a transient error. Re-launch with the same brief to a different free model; if the retry
  also fails, escalate to Handoff with the evidence of both attempts. Do not fabricate a source.
- **Main drift during a fix**: between Solve and Land, `main` may advance. Sync current `main`
  into the candidate branch in its own worktree, resolve there, and rerun gates/review. Final
  landing still happens only in the designated main worktree; never create a second checkout of
  the `main` ref or resolve a conflict there.
- **False "done"**: the resumer prompt and the closing rule both forbid declaring the run finished;
  completion is landing the last reviewed fix or recording a durable `blocked`/`unproven`/
  `obsolete` handoff with evidence and a next action.

## Phase 3: Report

Per wake-up (and at the end): what was fixed/landed, what remains open and why, the focused
validation performed (including failures and unavailable checks), and the resulting commits. No
separate status document — unresolved work stays in the canonical problem document (`HANDOFF.md`
/ `e2e/OPEN_PROBLEMS.md`), with retired entries folded into the deleted-number list.
