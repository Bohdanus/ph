# Linux snapshot CI branch salvage review

**Decision:** obsolete. Do not transplant code or snapshots from this branch. Preserve its ref as historical evidence; no branch deletion or worktree disposal was attempted.

**Branch reviewed:** `task/linux-snapshot-ci-20261024` at `871cfa71affcbc0c0dda26989220318f6939a93b`.
**Refreshed comparison (2026-11-14):** source `origin/main` is `93947f7244dade4e1972ae894828710ccb31fccd`; `mirror/main` is `108cc5d6477487ece41d89f9d85b5650d2144c6b`. The old branch is 1,269 commits behind and 9 ahead, with 8 patch-unique non-merge commits. No registered worktree holds it.

## Snapshots and workflows

The original request was to add Linux export snapshots because the Linux snapshot directory was missing. All seven Linux PNG blobs and all seven Windows PNG blobs on the old branch exactly match their corresponding files on current source `origin/main`; there is no snapshot delta to salvage.

Current `ci.yml` runs the Linux, Windows, and macOS E2E matrix and validates mirror dispatches against the exact source SHA. `focused-e2e.yml` validates its mirror dispatch, tested SHA, and requested spec. `capture-linux-baselines.yml` validates the exact source SHA and seven-file allowlist, uploads capture artifacts, and has a separate, explicitly requested promotion job. These workflows supersede the old branch's CI and capture machinery.

## Tests and implementation

Every old `crop-history.spec.ts` test title (27) and `selection-gestures.spec.ts` title (8) is present on current main, which has 31 and 11 respectively. Both versions have seven Levels test titles. No unique E2E test title from the old branch is missing on current main.

The old pointer hook inlined client-viewport geometry. Current `usePointerPosition` uses `src/util/client-viewport.ts::readClientViewportRect` and unwinds a failed pointer-capture request; the old hook leaves the pointer claimed if capture throws.

The old Levels tests pin exact pixels with a different `#960000` stroke at 0.8 opacity. Current main uses a `#cc0000` stroke at 0.9 opacity and allows measured one-channel screenshot/DPR ranges. The old exact values are incompatible with the current fixture and have no current cross-platform proof, so they are not safe to transplant.

The old branch's own `fc02c0f` commit lowers app coverage floors from 90/85/80/85 to 30/30/30/30, removes the explicit source include and `reportOnFailure`, and reduces the flood-fill performance sample count from five to three. Current main retains the higher floors and explicit include. These changes are not acceptable cross-platform accommodations.

Correction to the earlier review: the old branch did not delete the later tests for foreign `pointercancel`, Clone Stamp Flow continuation, or over-budget fill allocation. Those cases are absent at the branches' common ancestor and present on current main, so they were added later; do not attribute their absence to the old branch.

## Pipeline evidence

Mirror CI run [40140807034](https://github.com/Bohdanus/ph/actions/runs/40140807034) tested `fc02c0f` and failed overall. The E2E helper job and both macOS E2E shards passed; the audit job and Linux/Windows E2E shards failed. Linux shard 1 reported eight crop-history failures, and shard 2 reported an undo-redo raster mismatch. This run does not prove the later old-branch tip is green.

The current export visual-regression test keeps its 100-pixel tripwire and prints the browser version on failure. The old branch does not pin a browser revision and does not resolve browser-version drift.

## Disposition

Preserve `task/linux-snapshot-ci-20261024` as historical evidence. Do not cherry-pick or merge it, and do not re-record its snapshots. Revisit only if a new requirement identifies behavior absent from current main and that behavior is validated against the current cross-platform workflow.
