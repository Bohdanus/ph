---
name: overnight-sweep
description: Autonomous, cron-driven overnight hardening of the `ph` Photoshop clone against the open defects in `HANDOFF.md` and friends. Uses a dedicated task worktree, hourly cron wake-ups, and a fan-out of free-model subagents to research and fix; commits and merges are delegated to a paid coordinator session because the free orchestrator may not perform Git operations. Does not stop until told to stop.
---

# Overnight Project Hardening

This skill captures the recurring **overnight-hardening** pattern: a long-running, cron-driven,
subagent-orchestrated pass that hardens the project against the open defects recorded in
`HANDOFF.md`, `e2e/OPEN_PROBLEMS.md` and related docs, then lands the verified fixes to `main`.
It is the pattern the operator invokes with "do rigorous overnight hardening of the project" and
that resumes itself on an hourly cron so the run survives token limits and session loss.

The two things that make the run survive a whole night are the **hourly cron wake-up** and the
**explicit rule that the run does not end until it is told to stop**. Every other detail is a
consequence of that longevity: subagents are used pervasively to spend free-model tokens instead
of yours, `main` is reconciled through a dedicated landing worktree rather than the hardening
tree, and each fix is landed and its `HANDOFF.md` entry retired before the next is started.

## Orchestrator Tier — the free/paid boundary

The overnight-hardening orchestrator is **always a free session** — the catalog entry
`Poolside: Laguna S 2.1 (free)`, provider `kilo`, variant `thinking` (see `MODELS.md`). Free
sessions may research, solve fixes in a worktree, and run tests — but **may not commit, merge, or
perform Git operations** (AGENTS.md, MODELS.md). The run therefore separates orchestrator actions
from coordinator actions:

- **Orchestrator (free)**: executes Phases 1 and 2 (Find, Solve, Validate, Review), writes commit
  patch files with `Chat:` trailers, and signals the coordinator for each verified fix.
- **Coordinator (paid Luna or operator)**: receives each patch, commits it in a landing worktree,
  runs `docs/ORCHESTRATION.md` § "Landing" to land `main`, and disposes the worktree.

This resolves the contradiction between the cron prompt's "never commit unless asked" and Phase 2's
commit step: the cron prompt correctly forbids the free orchestrator from committing, and the
commit/merge is delegated to a paid coordinator. A paid Luna subagent is reserved only for
hard-product or architecture bifurcations, and only when the orchestrator session itself is paid —
the overnight run is free, so it does not launch paid Luna subagents directly.

## Operating Rules

- All tracked edits live in a single dedicated task worktree, e.g.
  `.kilo/worktrees/overnight/hardening-YYYYMMDD`. `main` is never written to directly; a pinned
  landing worktree receives everything that crosses to `main`. Read `docs/ORCHESTRATION.md` §
  "Landing" before the first merge.
- The run survives by **cron, not by staying awake**. Schedule an hourly cron using the
  `cron_create` tool — exactly one of `cron`, `when`, or `delay`, plus the `prompt` argument
  (a bare schedule expression is not a valid call) — that resumes the session with the resumer
  prompt template below. The prompt must end with "Do NOT stop. Continue until explicitly told to
  stop." — the single most important failure a hardening run faces is the model declaring itself
  done mid-overnight.
  - **Constraint — `avoid_cron_setup`**: cron setup has hung twice in this project
    (corrections.md). If `cron_create` fails or hangs, fall back to `schedule_wakeup` with a
    2-hour delay that re-arms itself, and record the failure in the plan. Do not retry
    `cron_create` within the same wake.
- Model routing (read `MODELS.md` first): the free route is `Poolside: Laguna S 2.1 (free)`,
  provider `kilo`, variant `thinking`. Verify against the live catalog with
  `node scripts/free-model-pool.mjs --list` and the 200 req/hour ceiling (MODELS.md). For bounded
  single-model calls, use
  `node scripts/free-model-pool.mjs --prompt-file PATH --output-file PATH --max-tokens N` to keep
  large responses out of context. Never launch GPT (Luna/Terra/Sol) subagents from a free session.
  Always pass `model` and `provider` together so a named paid model does not fall back to the
  zero-token gateway.
- **Quota-aware subagent protocol** (MODELS.md "Quota-Aware Subagents"): before every subagent
  launch, inspect the newest `npm run swarm -- tokens --json` reading. If it is missing, stale
  (>90 min), incomplete, unbudgeted, or otherwise uncertain, fail closed and prefer a free model.
  "Low allowance" means 20% or less of the five-hour budget remains; "reset is near" means the
  next expiry is ≤60 minutes away. When allowance is low and reset is not near (>60 min away or
  unknown), use free subagents by default and do not launch Luna/Terra/Sol without an explicit
  operator override.
- Cap concurrent subagents at 15 (`concurrent_agent_cap`). Free models are slow and
  rate-limited; when a subagent fails with a temporary model-usage limit, preserve its `task_id`
  and retry with a different eligible free provider/model on the next hourly checkpoint per
  `MODELS.md` — do not switch to a paid model as a retry fallback.
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
- Run `npm run repo:state`, `node scripts/worktree-inventory.mjs`, and `npm run branches:orphan`
  before landing (AGENTS.md). After landing, run `npm run tsc`, `npm run build`, and
  `npm run lint:check` on `main` to confirm the merge did not regress the build.
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

1. `git worktree list --porcelain` → pick the `refs/heads/main` worktree → create
   `.kilo/worktrees/overnight/hardening-YYYYMMDD` from clean `main`.
2. Write `.kilo/plans/overnight-hardening-YYYYMMDD-plan.md` with the research agenda and the
   HANDOFF.md entry clusters to verify.
3. Initialize a checkpoint cursor at
   `.kilo/plans/overnight-hardening-YYYYMMDD-checkpoint.md` recording the `time_updated` of every
   subagent session launched in this wake (the orchestrator uses this to determine which subagent
   results are new since the last wake).
4. Schedule the hourly cron (template below). The cron is what keeps the session alive; without it,
   a token wall or a stopped chat ends the run.
5. Fan out the first wave of free-model subagents (read-only research: HANDOFF entries, doc/test
   drift, Adobe sources, recent chat loose ends). Pass the absolute worktree path in every brief.
   Before each launch, inspect `npm run swarm -- tokens --json` per the quota-aware protocol.

## Tracking "new since last wake"

Each hourly wake updates the checkpoint cursor file. The orchestrator reads it to learn which
subagent session IDs (and their `time_updated` or completion status) were already known. Any
subagent that completed after the checkpoint timestamp is "new since last wake" and gets
synthesized into `.kilo/plans/overnight-hardening-findings.md`, which is merged back into the plan
at the start of each wake. Findings are accumulated cumulatively; resolved candidates are marked
`done` in the plan and never revisited without new evidence.

## The recurring prompts

These are the two prompts the run reuses. Keep them verbatim; they are part of what makes the
pattern robust.

### Initial prompt (the operator's request)

> do rigorous overnight hardening of the project. Reconstruct and understand issues in great
> detail using docs, code, chat transcripts. Fan out many free subagents to do deep research:
> scan large amounts of docs, code, transcripts, do websearch, etc. Use the catalog entry
> `Poolside: Laguna S 2.1 (free)` (provider `kilo`, variant `thinking`) heavily for broad
> investigations. Take most complex and prioritised issues first. This must be long running
> overnight autonomous session. Most likely points of failure: (1) llm decides task is done while
> it should keep going; (2) tokens for the free model might end temporarily; (3) other unknown
> error. Mitigate execution stops by setting up cron that wakes the chat every hour with a high
> quality rigorous demanding prompt, using `cron_create` with `0 * * * *` and a `prompt` argument.
> If `cron_create` hangs or fails (constraint: `avoid_cron_setup`), fall back to
> `schedule_wakeup` with a 2-hour delay that re-arms itself.

### Hourly cron wake-up (the resumer)

Scheduled via `cron_create` with `cron: "0 * * * *"` and `prompt`:

> You are a professional orchestrator running an overnight hardening session on the `ph`
> Photoshop clone project. Your job is to keep working autonomously until told to stop.
>
> Current state: you are operating from the `overnight/hardening-YYYYMMDD` worktree. The plan is
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
> 5. Launch NEW subagents for uncovered areas needing investigation (before each: inspect
>    `npm run swarm -- tokens --json`; fail closed on stale/incomplete readings).
> 6. Re-run `npm run tsc` and targeted `vitest` after every code change.
> 7. Do NOT stop. Do NOT declare "done." Continue investigating, verifying, and fixing until
>    explicitly told to stop.
>
> Constraints: you are a FREE orchestrator session — you may NOT commit or merge. All edits go in
> the worktree. For each verified fix, write a commit patch file and landing notes, then signal the
> coordinator session for the commit/merge. HANDOFF.md is the source of truth; re-derive repo/main
> state before acting (`git rev-parse main`, `git log --oneline -1 main`).

If no subagent has completed since the last wake, launch a fresh batch rather than idling — the
run is allowed to spend a quiet hour spinning up more research so the next wake has work to
consume.

## Phase 1: Find and Rank Candidates

Read selectively: `HANDOFF.md` (the source of truth), `e2e/OPEN_PROBLEMS.md`, `TEST-FLAKES.md`,
`docs/FEATURES.md`, `docs/ARCHITECTURE.md`. Search code only to validate candidates, never to
audit the whole tree. Mark resolved, landed, stale, duplicate and owned entries as inapplicable —
including entries whose fix already landed on `main` since the plan was written (re-check
`git merge-base main <worktree>` after each wake; `main` does not stop for the run).

Rank order:

1. Data loss, corruption, security exposure, or hard user-visible failure; honor assigned severity.
2. Unblocks other documented work or removes a shared prerequisite.
3. Strong evidence and reproducible/provable cause over speculative symptoms.
4. Maximize user benefit relative to cost; favor small bounded fixes.
5. Unfinished features only when behavior is clearly documented.

**Good-enough-to-fix threshold (the Phase 1→2 gate):** a candidate is safe to attempt only when
all of these hold: (a) the cause is confirmed against the current `main` baseline,
(b) the fix touches a bounded set of files with no cross-module boundary change (cross-module
requires two reviewers per Operating Rules), (c) no `mustNotPrune` or file-lock claim protects the
affected paths (check with `npm run swarm -- check <paths>`), and (d) the fix has a clear, fast
validation path (`npm run tsc` + targeted `vitest`, or the specific `npm run lint:check` scope).
Candidates that fail this gate go to Handoff, not to Solve. `HANDOFF.md` entries whose fix is
already on `main` by `git cherry main <branch>` patch-id absorption are retired, not re-done.

## Phase 2: Loop — Find → Solve → Scope → Review → Commit → Merge → Dispose → Repeat

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
6. **Commit patch**: the orchestrator is a free session that cannot commit, so write the commit
   patch to `.kilo/plans/overnight-hardening-<sha>-patch.mjs` with the `Chat: <native-session-id>`
   trailer (resolve the chat ID via `npm run --silent session:id -- "distinctive phrase"` per
   `docs/CHAT-ID.md`). Pass the patch and the reviewed SHA to the coordinator for the actual
   commit in a landing worktree.
7. **Handoff** (insufficient evidence, or candidate failed the good-enough-to-fix threshold): no
   speculative fix. Write a concise, evidence-backed handoff naming affected files and the exact
   decision/experiment needed. Write the handoff patch file and signal the coordinator.
8. **Merge**: the coordinator lands to `main` per `docs/ORCHESTRATION.md` § "Landing", with a
   `Branch:` trailer. Before merge: `npm run repo:state`, `node scripts/worktree-inventory.mjs`,
   `npm run branches:orphan`, re-read `main`'s status and diff, stage only this task's paths. When
   `main` has advanced beyond a clean re-base, land **in a separate, `main`-based landing
   worktree** using the hard-merge procedure (§ "Hard-merge procedure") — never merge `main` into
   the hardening tree and never resolve a conflict in the main checkout.
9. **Dispose**: after landing, `npm run dispose -- <name> --dry-run`, then
   `npm run dispose -- <name>` (only after proving ownership, confirming descendant subagents are
   dead, and checking the live overlay), then regenerate inventory with
   `node scripts/worktree-inventory.mjs`.
10. **Post-landing**: in the landing worktree, run `npm run tsc`, `npm run build`, and
    `npm run lint:check` to confirm `main` was not regressed by the merge.

### Hard-merge procedure (when `main` advanced beyond a clean re-base)

1. Create a fresh `main`-based task worktree: `git worktree add`.
2. Stage only the candidate's paths into that worktree's index.
3. Resolve each conflict by the recovered requirement (the problem entry / chat history), never
   by accepting either side wholesale.
4. `git merge --no-commit --no-ff <full-reviewed-sha>` with env vars
   `KILO_EXPECTED_MAIN_SHA`, `KILO_EXPECTED_INCOMING_SHA`, `KILO_EXPECTED_TREE_SHA`,
   `KILO_EXPECTED_BRANCH`, `KILO_EXPECTED_CHAT_ID` passed to
   `node scripts/commit-reviewed-landing.mjs` (docs/ORCHESTRATION.md § "Landing").
5. Fast-forwards and octopus merges are refused (worktree-merge-harvest Skill, Step 0); land one
   candidate at a time.
6. Never resolve or repair a conflict in `main`; never use `git stash`, `reset --hard`,
   `checkout --ours/--theirs`, `hash-object`, or `update-index` in the main checkout.

Repeat until no high-value actionable candidates remain, the run window is exhausted, or a gate
blocks safe progress. A blocked/uncertain item does **not** abandon unrelated ready work, and a
blocked item is re-checked after every `main` advance (it may have landed meanwhile). Do not
revisit a rejected candidate without new evidence.

## Landing — `main` moves under the run

The hardening tree is cut once and ages; `main` does not. Treat `ahead`, `behind`, conflicts and
ownership as per-instant facts and re-derive them in the same breath as the liveness re-check:
`git rev-parse main` and `git log --oneline -1 main` before the first merge each wake. When the
gap is larger than a clean re-base, stop merging the old tree and **replant the pending delta onto
a fresh `main`-based task worktree**, resolving each overlap by the recovered requirement rather
than by accepting either side wholesale.

## When the run stalls, keep it going

- **Free-model throttling / quota exhaustion**: preserve the failing subagent's `task_id` and
  retry with a different eligible free provider/model on the next hourly checkpoint
  (MODELS.md). Do not switch to a paid model as a fallback. If no free model is available, idle
  research this wake and record the exhaustion in the plan.
- **Token wall on a paid model**: the run continues on free models; a paid Luna reviewer is
  re-invoked only when the orchestrator session is paid and the decision is irreplaceable
  (MODELS.md). The overnight run is free, so this sub-case does not arise for the orchestrator
  itself.
- **Network loss / stopped chat**: the hourly cron (`cron_create`, or `schedule_wakeup` fallback
  per `avoid_cron_setup`) reopens the session, re-reads the plan and findings and resumes from the
  last committed delta. See `docs/ORCHESTRATION.md` § "Unexpected agent recovery".
- **Subagent produced unusable output**: empty, wrong, or irrelevant results are a quality failure,
  not a transient error. Re-launch with the same brief to a different free model; if the retry
  also fails, escalate to Handoff with the evidence of both attempts. Do not fabricate a source.
- **Main drift during a fix**: between Solve and Merge, `main` may advance. Re-derive
  `git rev-parse main` immediately before Merge; if the gap is larger than a clean re-base, use
  the hard-merge procedure in a fresh `main`-based landing worktree (never resolve in main).
- **False "done"**: the cron prompt and the closing rule both forbid declaring the run finished;
  completion is landing the last reviewed fix or recording a durable `blocked`/`unproven`/
  `obsolete` handoff with evidence and a next action.

## Phase 3: Report

Per wake-up (and at the end): what was fixed/landed, what remains open and why, the focused
validation performed (including failures and unavailable checks), and the resulting commits. No
separate status document — unresolved work stays in the canonical problem document (`HANDOFF.md`
/ `e2e/OPEN_PROBLEMS.md`), with retired entries folded into the deleted-number list.
