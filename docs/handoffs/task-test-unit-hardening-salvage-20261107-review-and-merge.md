# Review and merge record: test unit hardening salvage

**Branch:** `task/test-unit-hardening-salvage-20261107`
**Base main:** `b877c79ae49d45f9bd8dbf5bebf84415cc218799`
**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**Status:** Validation passes; final free review and pinned landing are in progress.

## Provenance and scope

The source branch `task/test-unit-hardening-20261029` accumulated unrelated commits and is not the landing candidate. The 2026-11-07 inventory reported 19 branch-only commits, 370 main-only commits, and conflicts in nine files. `git cherry` confirmed the two source commits above were not patch-absorbed by `main`. The candidate started on `3a1d4ad37fa35fca88979803fe3d3be1d42054e1`, synced through `b5df9dbc272e208dc04768259228e13abdad33fb`, `659ca8ede3be5c4f05aa0d250d63d6f394964315`, and `30e32ccf6efba0536525ac66a8e71e04a97889ab`, then synced to current main `b877c79ae49d45f9bd8dbf5bebf84415cc218799` in commit `935b6f00ea0cb2241b70668230970650fb2c19c0`. The merge tree was `b64553fb389287135183c4eb84365d30f63ab8e7` before the remaining test and documentation fixes.

The candidate salvages only the two source commits and their test/documentation changes. It omits unrelated E2E specs, model-pool implementation, and other source-branch work. Current-main follow-up fixes add the missing docs index row for `HISTORY-MIGRATION-AUDIT-20261107.md` and correct the source-backed presentation test fixture so its names follow the production `deriveLayerNameAndOrder()` contract.

## Review and validation

The earlier full unit run exposed two source-backed presentation failures. The renderer parity gate correctly rejected the test fixture: durable conversion derived `Image 1` / `Blank 1` for order 1, while the fixture used other names. Updating the fixture to derive its name prefix from the source kind and suffix from the layer order made all 11 tests in that file pass without changing production behavior. A later full run found the current-main audit document was missing from `docs/README.md`; adding its system-table entry fixed the documentation-index failure.

On the current synchronized candidate, the full unit suite passes: 421 files, 12,240 passed, 207 expected failures, and 2 skipped. The E2E helper unit suite passes: 22 files, 1,565 passed, and 12 expected failures. Typecheck and production build pass. Lint and Prettier pass with 78 existing warnings and zero errors. The docs-index suite passes: 10 tests.

Two independent full-diff Kilo reviews of earlier source candidate `05056df26a9b749936a2eab496a0ef811bf0f5ce` returned no actionable findings. Focused reviews caught a missing redo-side fallback row; that assertion was strengthened and verified. The current final-synchronized diff still requires a fresh review before landing. MODELS.md prefers exact-free NVIDIA Nemotron 3 Ultra through Kilo and allows OpenRouter as the next free route. Groq is not allowed for deep code review.

## Landing gate

The latest `npm run repo:state` reported clean. Before merging into `main`, capture the exact candidate SHA and tree, complete independent read-only reviews of the final diff with verified exact-free model/provider routes, confirm the full unit and E2E helper gates remain green, regenerate the worktree inventory, verify ownership and ancestry, compare the exact merge tree, and use the protected pinned-landing procedure. Do not merge a reviewed range if either main or the candidate changes afterward.
