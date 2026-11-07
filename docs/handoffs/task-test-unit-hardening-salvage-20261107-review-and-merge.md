# Review and merge record: test unit hardening salvage

**Branch:** `task/test-unit-hardening-salvage-20261107`
**Base main:** `30e32ccf6efba0536525ac66a8e71e04a97889ab`
**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**Status:** Not landed. The full unit suite has two failures reproduced on current `main`; fresh review of the final synchronized diff is unavailable on the approved free routes.

## Provenance and scope

The source branch `task/test-unit-hardening-20261029` has since accumulated unrelated commits and is not the landing candidate. The 2026-11-07 worktree inventory reported 19 branch-only commits, 370 main-only commits, and merge conflicts in nine files. `git cherry` confirmed the two source commits above are not patch-absorbed by `main`. The candidate began on `3a1d4ad37fa35fca88979803fe3d3be1d42054e1`, was synchronized to `b5df9dbc272e208dc04768259228e13abdad33fb`, then to `659ca8ede3be5c4f05aa0d250d63d6f394964315` in merge commit `e25ac745be466b84a3895f9b2d74e376d387923a`, and finally to current `main` at `30e32ccf6efba0536525ac66a8e71e04a97889ab` in merge commit `188040cf4e62a463c015541aaff875973da3a5ba`. The latest predicted merge tree and prepared index both matched `1774992859693fa53e29c4c1c1c40e554bcfebdd`. This branch salvages only those two commits; no E2E specs, model-pool implementation, or unrelated docs work from the source branch is included.

Current `main` already contains the bitmap test's global-stub cleanup, so that source hunk adds no net change and is omitted. The remaining tests cover cropped document mapping, malformed Kilo JSONL output, slider change events, disabled mixed-transform continuation, complete history-panel fallback rows, hidden affine compositing, and retained fit scale when dimensions are unavailable. Documentation changes repair links and index this handoff.

## Review and validation

The full unit suite on the synchronized candidate had 420/421 files pass: 12,238 passed, 2 failed, 207 expected failures, and 2 skipped. Both failures are in `StoreContext.source-backed-presentation.test.tsx`, which is unchanged by this candidate. The same two assertions fail on current `main`; the focused test there reports 2 failed and 9 passed. The latest main commit changes only two history-migration documentation files, so its source and test tree is unchanged from the base where the full suite was run. The E2E helper unit suite passes: 22 files, 1,565 passed, and 12 expected failures. Typecheck, lint, and production build pass; lint reports 78 warnings and zero errors. The citation test classifies HANDOFF section 148 as retired, matching its deleted-number heading.

Two independent full-diff Kilo reviews of source candidate `05056df26a9b749936a2eab496a0ef811bf0f5ce` returned no actionable findings. Focused reviews found that the history-panel fallback test did not exercise a redo-side row; that assertion was strengthened in the reviewed candidate to use a one-entry safe prefix and preserve the later row. Root verification confirmed the cursor-map expectation includes the helper's prepended baseline row. Synchronizing from `b5df` through current main changed none of the 13 candidate diff paths, so the reviewed test changes are unchanged. Fresh review attempts after the prior sync ended in Kilo 429s or incomplete/429 OpenRouter responses; they are not review evidence. MODELS.md disallows using Groq for deep code review.

## Landing gate

The prepared merge in the designated `main` worktree completed as `30e32ccf`, and `npm run repo:state` reported clean. The candidate is synchronized to that exact SHA with a verified merge tree. Landing still needs a fresh free review of the final synchronized diff when an allowed provider is available and a green full-suite result, or resolution of the two base failures in their owning change. Then regenerate the worktree inventory and rerun repository state, ownership, ancestry, exact merge-tree, and protected pinned-landing checks.
