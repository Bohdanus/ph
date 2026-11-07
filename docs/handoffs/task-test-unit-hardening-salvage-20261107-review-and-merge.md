# Review and merge record: test unit hardening salvage

**Branch:** `task/test-unit-hardening-salvage-20261107`
**Base main:** `b5df9dbc272e208dc04768259228e13abdad33fb`
**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**Status:** Validation passes; independent review and the final repository-state check remain before landing.

## Provenance and scope

The source branch `task/test-unit-hardening-20261029` has since accumulated unrelated commits and is not the landing candidate. The 2026-11-07 worktree inventory reported 19 branch-only commits, 370 main-only commits, and merge conflicts in nine files. `git cherry` confirmed the two source commits above are not patch-absorbed by `main`. The candidate began on `3a1d4ad37fa35fca88979803fe3d3be1d42054e1`; when `main` advanced to `b5df9dbc272e208dc04768259228e13abdad33fb`, it was synchronized cleanly before final validation. This branch salvages only those two commits; no E2E specs, model-pool implementation, or unrelated docs work from the source branch are included.

Current `main` already contains the bitmap test's global-stub cleanup, so that source hunk adds no net change and is omitted. The remaining tests cover cropped document mapping, malformed Kilo JSONL output, slider change events, disabled mixed-transform continuation, complete history-panel fallback rows, hidden affine compositing, and retained fit scale when dimensions are unavailable. Documentation changes repair links and index this handoff.

## Review and validation

The complete unit suite passes: 421 files, 12,231 passed, 207 expected failures, and 2 skipped. The E2E helper unit suite passes: 22 files, 1,565 passed, and 12 expected failures. Typecheck, lint, and production build pass. The citation test was also corrected to classify HANDOFF section 148 as retired, matching the current deleted-number heading; its focused test passes.

Independent read-only review of the committed candidate and the final repository-state check remain pending. The older source branch's review and test counts are not treated as evidence for this candidate.

## Landing gate

The final live `npm run repo:state` check was clean before this main synchronization. Re-run repository state, ownership, inventory, ancestry, and merge-tree checks immediately before pinned landing. If `main` advances again, sync this branch and repeat review and validation against the final candidate.
