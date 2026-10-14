# Overnight Loose-Ends Sweep

Autonomous, token-conscious pass over documented defects and unfinished work. Fix high-priority, well-evidenced problems first; land verified work; record uncertain problems as actionable handoffs and continue.

## Operating Rules

- Use one worktree per task. Work serially.
- Photoshop behavior, UX, and non-trivial algorithms require live web research before implementation. Prefer current Adobe sources, verify load-bearing claims with two opened sources when possible, and record URLs, versions, and unresolved claims in the relevant research note or handoff.
- Every non-trivial implementation requires a fresh read-only code-review subagent before landing. Cross-module behavior, persistence/migration, architecture boundaries, and broad regression risk require two reviewers split by concern. Fix and re-review blocking findings.
- Security vulnerability → invoke security-review process.
- Do not run worktree inventory routinely. Run `npm run repo:state` before landing.
- Tests support confidence; not definition of done. Prefer existing focused tests; smallest necessary regression test only. No new E2E unless behavior unvalidated otherwise. Never weaken gates.
- A run is complete only when the reviewed branch is landed and released, or when a durable handoff records `blocked`, `unproven`, or `obsolete` with evidence and a next action. A stopped chat is not completion.

## Phase 1: Find and Rank Candidates

Read selectively: `HANDOFF.md`, `TEST-FLAKES.md`, `e2e/OPEN_PROBLEMS.md`, relevant product/architecture docs. Search code only to validate candidates; no unbounded audit. Mark resolved/landed/stale/duplicate/owned as inapplicable.

Rank order:

1. Prevent data loss, corruption, security exposure, hard user-visible failure; honor assigned severity.
2. Unblocks other documented work or removes shared prerequisite.
3. Strong evidence and reproducible/provable cause over speculative symptoms.
4. Maximize user benefit and confidence relative to cost; favor small bounded fix.
5. Unfinished features after higher-priority defects, only when behavior is clearly documented.

Before editing: identify exact behavior, evidence, affected surfaces, existing tests, relevant gate. If two issues close, choose greater unblock value and clearer verification.

## Phase 2: Loop — Find → Solve → Merge → Repeat

For each selected issue:

1. **Find**: Read problem entry + minimal relevant code/docs. Verify still open; reproduce/confirm cause.
2. **Solve**: High confidence → narrowest complete fix across affected surfaces. Update directly related docs/tests only as needed.
3. **Validate**: Smallest useful focused check. Consult `docs/TESTING.md` for commands/known failures. Run required commit gates; no broad/E2E suites by default.
4. **Review**: Diff for unintended behavior, stale refs, missing surfaces, changes outside issue. Complex task → required focused code review.
5. **Commit**: Verified coherent fix with `Chat` trailer. Remove/retire problem entry per document rules.
6. **Handoff** (if insufficient evidence): No speculative fix. Write concise, evidence-backed, actionable handoff with affected files and specific decision/experiment needed. Commit and land handoff.
7. **Merge**: Land to `main` per landing procedure with `Branch` trailer. Before merge: check `npm run repo:state`, re-read `main` status and diff, stage only this task's paths. Never resolve conflict in `main`.

Repeat until no high-value actionable candidates, run window exhausted, or gate blocks safe progress. Blocked/uncertain item ≠ abandon unrelated ready work. Do not revisit rejected candidate without new evidence.

## Phase 3: Report

Final report: what fixed/landed, what remains open and why, focused validation performed (including failures/unavailable checks), resulting commits. No separate status document; keep unresolved work in canonical problem document.
