---
name: e2e-hardening-cron
description: >-
  Recurring E2E test hardening pass for the `ph` Photoshop clone. Investigates
  flaky or failing Playwright CI runs with attempt-level evidence, classifies
  failures using documented categories, applies the smallest reproduced fix with
  regression coverage, and lands verified changes to main. Uses bounded free
  read-only subagents to offload heavy research and avoids context explosion by
  persisting wave results before dispatching the next batch. Resumes hourly via a
  persistent cron so the run survives token limits and session loss.
---

# Recurring E2E Hardening

This skill is the **recurring, cron-scheduled** counterpart to `e2e-hardening-overnight`. It
applies the same investigation-and-fix discipline — read CI evidence, classify each failure,
diagnose with the current problem documents, apply the smallest reproduced fix, and land
through the pinned procedure — but instead of stopping after one bounded task it **keeps
going and resumes hourly on its own** so the suite stays hardened across unattended weeks.

The two things that make a multi-week run survive are the **persistent hourly cron** and the
**explicit rule that the run does not end until it is told to stop**. Every other detail is a
consequence of that longevity: free subagents do the heavy document and transcript reading so
the coordinator does not explode to 240k+ tokens, findings are persisted to `.kilo/plans/`
before each wave so a crash destroys nothing, and `main` is reconciled through a dedicated
landing worktree rather than the hardening tree.

The canonical document is this file in `.skills/`. Read `AGENTS.md`, `MODELS.md`,
`docs/TESTING.md`, `docs/E2E-MIRROR.md`, `docs/ORCHESTRATION.md`, `HANDOFF.md`,
`e2e/OPEN_PROBLEMS.md`, `TEST-FLAKES.md`, and `.skills/e2e-hardening-overnight.md` before the
first dispatch; they and the CI workflow are mutable and must be re-checked on every wake.

## Coordinator and Free-Model Boundary

The root run must be a session permitted by the current host policy to perform Git operations.
In Kilo, a **free session must not perform any Git operations**, including read-only Git
commands, worktree creation, commits, merges, resets, or disposal (AGENTS.md, MODELS.md). The
coordinator owns branch/worktree setup, repository inspection, tracked edits, validation,
review coordination, commit, landing and cleanup.

- **Coordinator**: operates from a task worktree, may launch eligible free read-only
  subagents, verifies their findings, and retains sole ownership of Git operations and tracked
  changes.
- **Free Kilo research subagents**: use the read-only `explore` role, receive bounded
  questions, the absolute worktree path, and an output shape (not a write destination). Deny
  `edit`, `bash`, and any separate filesystem write/patch or file-mutating MCP tools; Kilo
  permissions are tool-level, with no delete-only rule. They return findings in their task
  response and never edit, delete, run Git commands, spawn GPT agents, or decide whether a
  branch is safe to land or dispose. The coordinator writes notes and verifies source claims
  directly.
- For visible free Kilo research sessions, select the project `read-only-research` agent in
  `.kilo/agent/read-only-research.md`; it denies native edit, shell, delegation and common
  mutation-named MCP tools. Deny any connected file-mutating MCP tools not covered by those
  patterns; permissions are tool-level.

If the current root session is free, restrict it to read-only research and hand the run to an
authorized coordinator before any Git operation. If no coordinator is available, return a
concise blocked handoff and stop; do not create a second session/worktree just to evade the
host's permission boundary.

## Operating Rules

- All tracked edits live in one dedicated task worktree, e.g.
  `.kilo/worktrees/e2e-cron-YYYYMMDD`, on a branch with an allowed lowercase prefix such as
  `fix/e2e-cron-YYYYMMDD` (docs/ORCHESTRATION.md, "Worktrees"). `main` is not used for edits
  or conflict resolution; only the designated main worktree is used for the pinned final
  landing. Read `docs/ORCHESTRATION.md` § "Landing" before the first merge.
- **Resume scheduling**: create a persistent hourly cron with `cron_create`, using
  `cron: "0 * * * *"` and the resumer prompt below. The recurring cron stays armed if one
  invocation ends from network loss or token exhaustion; the next scheduled tick resumes the
  work when the session is available. Missed ticks are not replayed as a backlog. Do not
  substitute `schedule_wakeup`: it fires once and will not re-arm itself if the chat dies. If
  cron creation returns an actual error, report it and use the normal operator recovery path
  rather than silently switching to a one-shot wake.
- Model routing (read MODELS.md first): the free route is `Poolside: Laguna S 2.1 (free)`,
  provider `kilo`, variant `thinking`. Verify against the live catalog with
  `node scripts/free-model-pool.mjs --list` and the 200 req/hour ceiling (MODELS.md). For
  bounded single-model calls, use
  `node scripts/free-model-pool.mjs --prompt-file PATH --output-file PATH --max-tokens N` to
  keep large responses out of context. Never launch GPT (Luna/Terra/Sol) subagents from a free
  session. Always pass `model` and `provider` together so a named paid model does not fall
  back to the zero-token gateway. Before and after a large OpenRouter-backed fan-out, run
  `node scripts/free-model-pool.mjs --openrouter-quota`; its server-side daily counter is
  authoritative for this account and is separate from the Kilo per-IP hourly ceiling.
- **Quota-aware subagent protocol** (MODELS.md "Free Model Rotation" and "Token-Saving Research
  Protocol"): the current `swarm` CLI does not expose `tokens --json`, so do not treat that
  command or `swarm status` as budget telemetry. Refresh eligibility with
  `node scripts/free-model-pool.mjs --list`, use only exact zero-priced model/provider pairs,
  and never fall back silently to paid inference. If the host exposes separate budget data,
  follow its current policy; otherwise treat paid capacity as unknown and stop free launches
  when providers report throttling or exhaustion. Do not invent quota percentages or reset
  windows.
- Cap concurrent subagents at 15 (`concurrent_agent_cap`). Before each launch, check current
  running work; do not duplicate an in-flight task just to fill a quiet hour. On a rate limit,
  record the failed attempt and use a different eligible free model/provider only if the
  refreshed catalog and policy permit it. A resumed task retains its model; do not describe it
  as switching models. If free routes are exhausted, pause that research and continue with
  coordinator-owned verification or other ready work.
- Photoshop behavior, UX and non-trivial algorithms require Adobe or other primary-source
  research. Record source URLs, versions and unresolved claims in a research note or handoff.
- Every non-trivial implementation requires a fresh read-only code review per
  `docs/CODE-REVIEW.md` (verbatim brief, `file:line` finding
  format); cross-module, persistence/migration, architecture-boundary and broad-regression
  changes require two reviewers split by concern. Fix and re-review blocking findings. See
  also `docs/ORCHESTRATION.md#the-task-lifecycle`.
- Security vulnerability -> invoke the security-review process.
- Tests support confidence, not definition of done. Prefer existing focused tests; add the
  smallest necessary regression test only. No new E2E unless behavior is otherwise unvalidated.
  Never weaken gates or re-record baselines. See `docs/TESTING.md#gates` for commands and
  known failures.
- Run `npm run repo:state` before landing. For cleanup, also run
  `node scripts/worktree-inventory.mjs` and `npm run branches:orphan`; preview
  `npm run swarm -- doctor --dry-run` before any disposal (AGENTS.md). After landing, run
  `npm run tsc`, `npm run build`, and `npm run lint:check` in the designated main worktree to
  confirm the merge did not regress the build.
- **Never `git stash`** (AGENTS.md § "Coordination And Cleanup",
  `docs/ORCHESTRATION.md` § "Landing"): it is a shared unordered stack; `git stash` on a
  clean tree exits 0 with no entry, so the next `pop` takes somebody else's changes.
- Use `board_post` for material findings (live-owner claims, planted mutants, duplicate
  branches): the formatted message is capped at 4096 bytes / 3800 ASCII chars when no
  non-ASCII (AGENTS.md). Put longer evidence in a file and reference it from the board.
- Never open a browser. `npm run test:e2e` starts its own dev server; a headed run fails a
  disjoint set of tests, so "goes away headed" is re-routed, not fixed (AGENTS.md).

## Setup — the recurring launch

1. **Create the worktree.** Run `git worktree list --porcelain`, identify the `refs/heads/main`
   stanza explicitly (not `head -1`, which may select the current worktree), and create
   `.kilo/worktrees/e2e-cron-YYYYMMDD` on `fix/e2e-cron-YYYYMMDD` from clean current `main`.
   Verify the new checkout with `git rev-parse --show-toplevel` before any npm command or
   fan-out.
2. **Write the plan.** Create `.kilo/plans/e2e-cron-YYYYMMDD-plan.md` with the research agenda:
   the CI run/attempt to investigate, the `e2e/OPEN_PROBLEMS.md` and `TEST-FLAKES.md` entries
   to verify, and the priority order for the first week's work.
3. **Initialize the checkpoint.** Create
   `.kilo/plans/e2e-cron-YYYYMMDD-checkpoint.md` with each child task's exact ID, unique scope,
   initial prompt, model/provider, launch time, last host result, and next action, plus the
   last wake timestamp. On resume, consume delivered task results/notifications by exact ID
   and persist each result once; do not infer completion solely from database `time_updated`,
   which can change for bookkeeping reasons. Respect the current host API: Kilo's `task` tool
   supports starting a child and resuming a known task ID; it has no `list` or `status`
   operation. A new `task` call is work, not a poll. If a recorded child has no delivered
   result, keep it `pending/unknown` and do not relaunch its scope. Resume only that exact ID
   when the task host reports it resumable/failed, or when the operator directs a resume.
4. **Schedule the recurring hourly cron.** Call `cron_create` with `cron: "0 * * * *"` and
   the resumer prompt in § "The recurring prompts" below. Verify the cron task was created
   before starting the research fan-out.
5. **Fan out the first wave.** Launch bounded free read-only research using Kilo `explore`
   children or the completion runner. Pass the absolute worktree path, evidence scope, and
   concise JSON output shape in every brief. The coordinator writes summary files. Refresh
   the free model catalog per the quota-aware protocol above; for a large OpenRouter-backed
   wave, check the server-side daily counter.

## Context-Budget Discipline

**The core problem this skill solves:** a single agent reading every CI log, every spec, every
helpers file, and every relevant chat transcript explodes to 240k+ tokens in one turn. That is
not research depth — it is context bloat, and it makes the run cost-inefficient and fragile.

The discipline is three-fold:

1. **Free subagents carry the bytes.** The coordinator never reads a CI log, a full spec, or a
   chat transcript. It dispatches bounded Kilo `explore` children with one specific question
   each — "classify this test's failure from this attempt's log", "audit this one spec's
   coordinate handling against the document-space rule", "summarise what these three chat
   transcripts say about viewport-drawing flakiness" — and reads only the JSON result.
2. **Persist before dispatching.** Every wave's results are written to `.kilo/plans/` before
   the next wave launches, so a token wall destroys nothing and the next cron tick resumes
   from the last persisted state, not from reconstructing context.
3. **The coordinator keeps only the state machine.** The worktree, the checkpoint cursor, and
   the current fix-under-test are the only things the coordinator needs in context. Everything
   else is a file it points a subagent at.

## Tracking "new since last wake"

Each wake loads the checkpoint and checks the retained conversation for Task tool results or
completion notifications for the recorded child task IDs. Only results newly reported as
completed since the last wake are synthesized into
`.kilo/plans/e2e-cron-YYYYMMDD-findings.md`, then merged into the plan. Save the checkpoint
only after capturing each result and its evidence. Findings accumulate; resolved candidates
are marked `done` and not revisited without new evidence. Session-database timestamps are
supporting clues, not a task-completion cursor.

## The recurring prompts

These are prompt templates, not claims to reproduce a historical user message verbatim. Adapt the
initial template to the actual request, preserving its scope and constraints.

### Initial prompt template

> do rigorous recurring e2e hardening of the `ph` Photoshop clone. This is a long-running,
> hourly-resumed pass that hardens the Playwright suite against flaky/failing CI runs and
> open defects in `e2e/OPEN_PROBLEMS.md` / `TEST-FLAKES.md` / `HANDOFF.md`. Reconstruct and
> understand issues using `docs/E2E-HARDENING-PLAN.md`, chat transcripts, CI logs, and the
> codebase. Fan out bounded **free read-only** subagents (`explore` role, writes/shell/git
> denied) to do deep research: scan CI logs, read specs/helpers, audit coordinate handling,
> survey chat transcripts. Keep the coordinator's own context lean by persisting wave results
> to `.kilo/plans/` before each dispatch. Use the catalog entry `Poolside: Laguna S 2.1
(free)` (provider `kilo`, variant `thinking`) heavily for broad investigations when it
> appears in the refreshed free catalog; otherwise rotate to another verified zero-priced
> model/provider or pause when none is available. Resume hourly via `cron_create` with
> `cron: "0 * * * *"` and the resumer prompt below. Take most complex and prioritised issues
> first. This must keep running and resume hourly until told to stop. The context-budget
> discipline is critical: never read a full CI log or spec in the coordinator; always point a
> subagent at it and read only the structured result.

### Hourly Cron Resumer

Use as the `prompt` for `cron_create` with `cron: "0 * * * *"`:

> You are the coordinator of a recurring overnight E2E hardening session on the `ph`
> Photoshop clone project. Your job is to keep working autonomously until told to stop,
> resuming from the last persisted state.
>
> **Current state:** you are operating from the `e2e-cron-YYYYMMDD` worktree. The plan is
> at `.kilo/plans/e2e-cron-YYYYMMDD-plan.md`. The checkpoint cursor is at
> `.kilo/plans/e2e-cron-YYYYMMDD-checkpoint.md`.
>
> **Your hourly task:**
>
> 1. Review ALL subagent results completed since your last wake (compare against the
>    checkpoint cursor). Persist each result once; do not infer completion from database
>    timestamps.
> 2. Synthesize new findings into `.kilo/plans/e2e-cron-YYYYMMDD-findings.md` and merge
>    them into the plan.
> 3. Update the checkpoint cursor with all currently-known subagent session IDs.
> 4. Identify findings that translate to verified, safe fixes — implement them in the
>    worktree.
> 5. Launch NEW free research children only for uncovered areas needing investigation. Use
>    Kilo's read-only `explore` role with write/shell/Git tools denied. Refresh the free
>    catalog before each launch; for a large OpenRouter-backed wave, inspect the server
>    counter.
> 6. Re-run `npm run tsc` and targeted checks after every code change. For E2E changes, run
>    `npm run test:e2e:unit` (fast) and `npm run test:e2e -- e2e/<file>.spec.ts` (focused).
> 7. Do NOT stop. Do NOT declare "done." Continue investigating, verifying, and fixing until
>    explicitly told to stop.
>
> **Constraints:** you are the Git-capable coordinator operating in the verified task
> worktree. Free subagents use a read-only role with file-write, patch, shell, and Git tools
> denied. They return concise JSON results; you write any notes. You own repository
> inspection, edits, validation, commit, landing and cleanup. The source of truth is
> `e2e/OPEN_PROBLEMS.md`, `TEST-FLAKES.md`, `HANDOFF.md`, and `docs/E2E-HARDENING-PLAN.md`.
> Before each subagent launch, refresh the free model catalog; use only a verified free
> model/provider pair unless host policy and budget explicitly permit paid use. If free
> routes are exhausted, pause that research and continue with coordinator-owned work. Do not
> replace the cron with a one-shot wake.

If no subagent has completed since the last wake, do not duplicate work just to keep the fan-out
busy. Verify current candidates, continue safe coordinator-owned work, or wait for the next
authorized wake. Respect the concurrency cap and free-route availability.

## Phase 1 — Survey: Collect Evidence Without Reading It

1. If no CI run is identified yet, use free subagents to find the latest completed CI run on
   both the source repository and the mirror (`Bohdanus/ph`), extracting run ID, attempt, SHA,
   platform, shard, conclusion, and artifact availability. Record it in the plan.
2. For each failing or flaky test in the latest run, dispatch a free `explore` subagent with:
   the absolute worktree path, the CI artifact URL or downloaded log path, the exact test
   title, the SHA, platform, and shard. Ask it to return a JSON classification:

   ```json
   {
     "test": "e2e/<file>.spec.ts :: exact test title",
     "runId": "<run-id>",
     "attempt": "<n>",
     "platform": "<linux|macos|windows>",
     "classification": "regression | flaky | runner | infrastructure | baseline | unproven",
     "evidence": ["path or report artifact and observed fact"],
     "rootCause": null,
     "proposal": "smallest safe next step",
     "confidence": "high | medium | low"
   }
   ```

3. Also dispatch subagents to audit the current `e2e/OPEN_PROBLEMS.md`, `TEST-FLAKES.md`, and
   `HANDOFF.md` entries for E2E-relevant items: verify each cited condition still exists in
   the current tree, check whether the fix already landed on `main`, and classify each as
   `open`, `fixed-on-main` (retire it), `stale`, or `needs-evidence`.
4. Merge all survey results into `.kilo/plans/e2e-cron-YYYYMMDD-findings.md` and rank order
   per the priority below.

**Rank order:**

1. Data loss, corruption, security exposure, or hard user-visible failure; honor assigned
   severity.
2. Unblocks other documented work or removes a shared prerequisite.
3. Strong evidence and reproducible/provable cause over speculative symptoms.
4. Maximize user benefit relative to cost; favor small bounded fixes.
5. Unfinished features only when behavior is clearly documented.

## Phase 2 — Diagnose: Evidence Before Changes

For each candidate from Phase 1:

1. **Reproduce.** Confirm the failure against the current `main` baseline in the task
   worktree. A fix whose patch is already on `main` is retired, not re-done. Use
   `npm run test:e2e -- e2e/<file>.spec.ts` for local reproduction.
2. **Trace the root cause.** Use the current `e2e/OPEN_PROBLEMS.md` entries, `TEST-FLAKES.md`,
   the E2E plan, `playwright.config.ts`, the exact spec/helper, and `HANDOFF.md` for
   cross-cutting issues. Check `e2e/README.md` for fixture conventions and assertions.
3. **Research with evidence.** For Photoshop behavior, UX, or non-trivial algorithms, use
   live `websearch` before code; open and prefer current Adobe/primary sources. Free
   subagents can gather the Adobe documentation; the coordinator synthesizes.

**Good-enough-to-fix threshold (the Phase 1→2 gate):** a candidate is safe to attempt only
when all of these hold: (a) the cause is confirmed against the current `main` baseline, (b) the
fix touches a bounded set of files with no cross-module boundary change (cross-module requires
two reviewers per Operating Rules), (c) the task worktree has no unexplained `mustNotPrune`
veto on landing and `npm run swarm -- check <paths>` reports no file claim, and (d) the fix has
a clear, fast validation path (`npm run tsc` + targeted `vitest`, or the specific
`npm run lint:check` scope, or `npm run test:e2e:unit`). Candidates that fail this gate go to
Handoff, not to Solve.

## Phase 3 — Fix And Verify

1. **Find.** Read the problem entry plus minimal relevant code/docs in the worktree. Verify it
   is still open on the current `main` baseline; reproduce or confirm the cause.
2. **Solve.** High confidence → narrowest complete fix across affected surfaces. Update directly
   related docs/tests only as needed. Do not use `git stash`; keep work in the working tree.
3. **Scope check.** Confirm the change set is single-module or obtain explicit two-reviewer
   approval for cross-module/architecture-boundary changes. `npm run swarm -- check <paths>`
   must pass.
4. **Validate.** Smallest useful focused check:
   - For E2E helper changes: `npm run test:e2e:unit -- e2e/helpers/__tests__/<file>.unit.test.ts`
   - For E2E spec changes: `npm run test:e2e -- e2e/<file>.spec.ts`
   - For app unit test changes: `npm run test -- src/.../<file>.test.tsx`
   - For TS changes: `npm run tsc`
   - For linted surfaces: `npm run lint:check`
   - Broad or cross-platform E2E uses the mirror CLI from a clean, committed, non-`main`
     branch per `docs/E2E-MIRROR.md`.
5. **Review.** `git diff main...HEAD` for unintended behavior, stale references, missing
   surfaces, out-of-scope changes. Complex task -> a fresh read-only review subagent per
   `docs/CODE-REVIEW.md` (verbatim brief, `file:line` findings);
   cross-module/architecture-boundary changes -> two reviewers split by concern. Fix and
   re-review blocking findings.

**Never:**

- Add `test.skip`, `test.fail`, grep filters, weaker assertions, arbitrary tolerances, extra
  retries, or longer timeouts to make a run green.
- Re-record a baseline without the current documented process and explicit review.
- Treat a retry pass as clean; current CI fails on flaky retries.
- Assume OS labels prove CPU architecture or that platform-only proves environment cause.
- Run headed browsers, report UI, trace viewer, or browser tools.
- Let free subagents edit, commit, push, or merge.

## Phase 4 — Land

1. Run `npm run repo:state` and confirm the worktree and branch are clean and safe to land.
2. Sync current `main` into the candidate branch **in the branch's own worktree**, resolve
   conflicts there using the recovered requirement, rerun gates and review the final
   composition. Then follow `docs/ORCHESTRATION.md` § "Landing" from the designated main
   worktree only: require a clean checkout, prepare
   `git merge --no-commit --no-ff <full-reviewed-sha>`, pin both parents, the prepared result
   tree, branch and chat, and invoke `node scripts/commit-reviewed-landing.mjs`.
3. Resolve the host-native chat ID using `docs/CHAT-ID.md`; use `session:<id>` only for Kilo
   sessions, and never guess when the match is ambiguous. Stage only reviewed paths.
4. After landing, run `npm run tsc`, `npm run build`, and `npm run lint:check` in the
   designated main worktree to confirm the merge did not regress the build.
5. Remove only the matching verified problem entry from its proper home
   (`HANDOFF.md`, `e2e/OPEN_PROBLEMS.md`, or `TEST-FLAKES.md`); do not turn these documents
   into a changelog. For unresolved work, record the exact run/SHA, artifacts, verified facts,
   remaining uncertainty, and next diagnostic step in the correct problem document.

Land one candidate at a time. Never resolve or repair a merge in main; never use `git stash`,
`reset --hard`, `checkout --ours/--theirs`, `hash-object`, or `update-index` in the main
checkout. Before disposal, prove ownership, confirm descendant agents are dead, check the live
overlay, and preview `npm run swarm -- doctor --dry-run`.

## When the run stalls, keep it going

- **Free-model throttling / quota exhaustion**: record the failed task and provider. Per
  MODELS.md, try a different currently eligible free provider/model in a new bounded task only
  if the refreshed catalog supports it. Do not assume a resumed task changes its model and
  do not use paid fallback. If no free route is available, record the limit and continue
  coordinator-owned work or wait.
- **Token wall on a paid model**: keep research on eligible free routes.
- **Network loss / stopped chat**: the recurring hourly cron stays armed if an invocation ends
  unexpectedly; the next scheduled tick resumes when the session is available. Missed ticks are
  not replayed. Re-read the plan and findings and rederive repository state from the task
  worktree before resuming. See `docs/ORCHESTRATION.md` § "Unexpected agent recovery".
- **Subagent produced unusable output**: empty, wrong, or irrelevant results are a quality
  failure, not a transient error. Re-launch with the same brief to a different free model; if
  the retry also fails, escalate to Handoff with the evidence of both attempts. Do not
  fabricate a source.
- **Main drift during a fix**: between Solve and Land, `main` may advance. Sync current `main`
  into the candidate branch in its own worktree, resolve there, and rerun gates/review. Final
  landing still happens only in the designated main worktree.
- **False "done"**: the resumer prompt and the closing rule both forbid declaring the run
  finished; completion is landing the last reviewed fix or recording a durable
  `blocked`/`unproven`/`obsolete` handoff with evidence and a next action.

## Phase 5: Report

Per wake-up: what was fixed/landed, what remains open and why, the focused validation
performed (including failures and unavailable checks), and the resulting commits. No separate
status document — unresolved work stays in the canonical problem document
(`HANDOFF.md` / `e2e/OPEN_PROBLEMS.md` / `TEST-FLAKES.md`), with retired entries folded into
the deleted-number list.

## Source Of Truth

- Repository state and current task queue: `e2e/OPEN_PROBLEMS.md`, `TEST-FLAKES.md`,
  `HANDOFF.md`, and `docs/E2E-HARDENING-PLAN.md`.
- Runner matrix, artifacts, retry/failure behavior, and time budgets:
  `.github/workflows/ci.yml` and `playwright.config.ts`.
- Fixtures, headless restrictions, local commands, and assertions: `e2e/README.md`,
  `docs/TESTING.md`, and `AGENTS.md`.
- Mirror behavior and baseline promotion: `docs/E2E-MIRROR.md` and
  `.github/workflows/capture-linux-baselines.yml`.
- Provider limits, model names, concurrency, and agent permissions: `MODELS.md` and
  `AGENTS.md`.
- The one-off investigation variant: `.skills/e2e-hardening-overnight.md`.
- The general overnight-hardening pattern: `.skills/overnight-sweep.md`.
