# Review and merge record: test unit hardening salvage

**Branch:** `task/test-unit-hardening-salvage-20261107`
**Base main:** `b5df9dbc272e208dc04768259228e13abdad33fb`
**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**Status:** Validation passes; pinned landing is blocked by two active repository-wide merge operations.

## Provenance and scope

The source branch `task/test-unit-hardening-20261029` has since accumulated unrelated commits and is not the landing candidate. The 2026-11-07 worktree inventory reported 19 branch-only commits, 370 main-only commits, and merge conflicts in nine files. `git cherry` confirmed the two source commits above are not patch-absorbed by `main`. The candidate began on `3a1d4ad37fa35fca88979803fe3d3be1d42054e1`; when `main` advanced to `b5df9dbc272e208dc04768259228e13abdad33fb`, it was synchronized cleanly before final validation. This branch salvages only those two commits; no E2E specs, model-pool implementation, or unrelated docs work from the source branch are included.

Current `main` already contains the bitmap test's global-stub cleanup, so that source hunk adds no net change and is omitted. The remaining tests cover cropped document mapping, malformed Kilo JSONL output, slider change events, disabled mixed-transform continuation, complete history-panel fallback rows, hidden affine compositing, and retained fit scale when dimensions are unavailable. Documentation changes repair links and index this handoff.

## Review and validation

The complete unit suite passes on the synchronized candidate: 421 files, 12,231 passed, 207 expected failures, and 2 skipped. The E2E helper unit suite passes: 22 files, 1,565 passed, and 12 expected failures. Typecheck, lint, and production build pass; lint reports 78 warnings and zero errors. The citation test classifies HANDOFF section 148 as retired, matching its deleted-number heading.

Two independent full-diff Kilo reviews of source candidate `05056df26a9b749936a2eab496a0ef811bf0f5ce` returned no actionable findings. Focused reviews found that the history-panel fallback test did not exercise a redo-side row; that assertion was strengthened in the reviewed candidate to use a one-entry safe prefix and preserve the later row. Root verification confirmed the cursor-map expectation includes the helper's prepended baseline row. Main later advanced to `b5df9dbc272e208dc04768259228e13abdad33fb`; the merge into this branch changed none of the reviewed source paths. Post-sync model review attempts ended in Kilo 429s or incomplete OpenRouter responses and are not counted as review evidence. The final source diff remains the reviewed diff; the handoff base-SHA correction was checked against the live refs.

## Landing gate

The last three live `npm run repo:state` checks refused landing because `free-models-merge-recovery-20261107` and `stale-work-followup-20261107` have active `MERGE_HEAD` operations in their own worktrees. Those operations were left untouched. Re-run repository state, ownership, inventory, ancestry, and merge-tree checks after their owners finish. If `main` advances again, sync this branch and repeat review and validation against the final candidate.
