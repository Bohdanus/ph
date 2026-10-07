# Overnight Loose-Ends Sweep

Use this skill for an autonomous, token-conscious pass over documented defects and
unfinished work. Fix high-priority, well-evidenced problems first; land verified
work; record uncertain problems as actionable handoffs and continue to the next
candidate. This is a single top-level job: do not start parallel top-level agents.

## Operating rules

- Follow [`AGENTS.md`](../AGENTS.md) and [`docs/ORCHESTRATION.md`](../docs/ORCHESTRATION.md)
  for worktrees, commits, and landing. Create the task worktree before edits or
  project commands.
- Keep one coordinator and one task worktree for this run. Work through findings
  serially; do not launch a broad swarm or delegate the sweep.
- This skill is usually run by GPT Luna Low. When a specific hard question needs
  stronger reasoning, use one narrowly scoped GPT Luna High/Xhigh subagent for
  that question, using the supported model/provider pair. Do not use an agent to
  repeat a complete scan.
- A complex implementation must get a focused, read-only code-review subagent
  review before landing. Complexity includes cross-module behavior, persistence
  or data migration, architecture boundaries, and changes with broad regression
  risk. Give the reviewer the exact diff and the contract to check; resolve
  material findings before merge. For a small, local fix, self-review the diff.
- If a candidate appears to be an exploitable security vulnerability, invoke the
  security-review process before reviewing it directly.
- Do not run the worktree inventory as routine overhead. It is a lengthy report,
  not a per-task definition of done. Run `npm run repo:state` before landing, and
  use inventory only when its procedure specifically requires it (for example,
  worktree disposal).
- Tests support confidence; they are not the job's definition of done. Prefer
  existing focused tests and write only the smallest necessary regression test.
  Avoid new E2E tests and E2E runs unless the behavior cannot be validated
  adequately another way. Never weaken a gate to make the sweep pass.

## Phase 1: Find and rank candidates

Read the open-work sources selectively: `HANDOFF.md`, `TEST-FLAKES.md`,
`e2e/OPEN_PROBLEMS.md`, and any directly relevant product or architecture
documents. Search the code only to validate likely candidates; do not perform an
unbounded repository audit. Check each candidate against the current tree and
mark resolved, landed, stale, duplicate, or already-owned work as inapplicable
rather than attempting it.

Choose the best actionable issue, not mechanically the first heading. Rank in
this order:

1. Prevent data loss, corruption, security exposure, or a hard user-visible
   failure; honor any severity already assigned by the repository.
2. Prefer a fix that unblocks other documented work or removes a shared
   prerequisite.
3. Prefer strong evidence and a reproducible or directly provable cause over
   speculative symptoms.
4. Among comparable issues, maximize expected user benefit and confidence
   relative to implementation and validation cost; favor a small, bounded fix.
5. Consider unfinished features after higher-priority defects, and only when
   their desired behavior is documented clearly enough to implement.

Before editing, identify the exact behavior, evidence, affected surfaces,
existing tests, and relevant gate. If two issues are close, choose the one with
the greater unblock value and clearer verification path. Do not spend tokens
building a formal scoring spreadsheet.

## Phase 2: Work in a loop

For each selected issue:

1. Read the owning problem entry and the smallest set of relevant code and
   documentation. Verify that the issue is still open and reproduce or otherwise
   confirm its cause.
2. If confidence is high, make the narrowest complete fix across all affected
   surfaces. Update directly related documentation and tests only as needed.
3. Validate the requirement itself with the smallest useful focused check.
   Consult `docs/TESTING.md` for the correct command and existing known failures.
   Run the repository's required commit gates; do not run broad or E2E suites by
   default.
4. Review the diff for unintended behavior, stale references, missing surfaces,
   and changes outside the selected issue. For a complex task, obtain the
   required focused code review.
5. Commit a verified coherent fix with the required `Chat` trailer. Remove or
   retire the problem entry in the same change when it is fixed, following that
   document's rules.
6. If evidence, intended behavior, or validation is insufficient, do not wire a
   speculative fix. Write a concise, evidence-backed, actionable handoff with
   affected files and the specific decision or experiment needed. Commit and
   land that handoff, then continue to the next candidate.

Repeat until there are no remaining high-value, confidently actionable
candidates, the available run window is exhausted, or a repository gate blocks
safe progress. A blocked or uncertain item is not a reason to abandon unrelated
ready work. Do not repeatedly revisit a rejected candidate without new evidence.

## Phase 3: Land and report

Land verified fixes and valid handoffs to `main` using the repository's landing
procedure; each merge must identify its source branch with the required `Branch`
trailer. Before landing, check `npm run repo:state`, re-read `main` status and the
diff, and stage only this task's paths. Never resolve a conflict in `main`.

In the final response, briefly report what was fixed and landed, what remains
open and why, focused validation performed (including failures or unavailable
checks), and the resulting commit. Do not create a separate status document;
keep unresolved work in its canonical problem document.
