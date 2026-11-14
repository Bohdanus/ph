# Linux snapshot CI branch salvage review

**Status:** Obsolete; no code or baseline artifacts should be salvaged.

**Branch reviewed:** `task/linux-snapshot-ci-20261024` at `871cfa71affcbc0c0dda26989220318f6939a93b`.
**Review base:** local `main` at `422f28a67f784eab8ecdb0232b3503df52d80d2f`.
**Remote refs at review:** fetched `origin/main` and `mirror/main` both at `108cc5d6477487ece41d89f9d85b5650d2144c6b`.
**Branch state:** 9 commits ahead, 1212 behind, 8 patch-unique commits, and 20 reported merge conflicts. The fresh inventory has no worktree holding this branch. Its branch ref is preserved for historical reference; no branch deletion or worktree disposal was attempted.

## Original problem and resolution

The original task was to add Linux export visual-regression snapshots because the test fails when `export-baselines/linux/` is missing. Git tree comparisons of the branch's Linux snapshot directory against local `main`, `origin/main`, and `mirror/main` showed no differences. Per-format blob IDs also match between the Linux and Windows snapshot files on local `main`. The historical workflow records that the committed Linux PNGs match its uploaded Linux artifact.

Current `capture-linux-baselines.yml` captures Linux, Windows, and macOS artifacts from a manual dispatch without pushing commits. Current `focused-e2e.yml` validates the trusted mirror dispatch and exact tested source SHA, validates the requested spec, and uses pinned Actions. The old branch's capture and focused-run machinery does not fill a current need; automated baseline write-back is outside this task and has no identified current requirement.

## Test and implementation review

No independently valuable addition was identified in the branch's Linux snapshot, workflow, pointer, E2E, and CI-gate changes. The old branch's local viewport helper is superseded by `src/util/client-viewport.ts::readClientViewportRect`, with focused coverage for borders, scrollbars, RTL layout, fractional dimensions, and missing client metrics. Current `usePointerPosition` also unwinds failed pointer capture; the old version calls capture without that recovery.

Current E2E tests have since gained crop HiDPI and exact-raster checks, bounds rejection, premultiplied-alpha diagnostics, and viewport capture hardening. The old Levels spec permits adjacent measured channel values where current main uses a deterministic fixture and exact output values.

The old branch also weakens unrelated test gates and removes behavioral tests. Its `vitest.config.ts` drops the app coverage floors from lines 90%, functions 85%, branches 80%, statements 85% to 30% across all four metrics; it also removes the explicit source include list and `reportOnFailure`. It deletes current tests for a foreign `pointercancel` preserving the owning paint stroke, Clone Stamp Flow and aligned-source continuation, and flood-fill rejecting over-budget images before reading or allocating a mask. It reduces the flood-fill performance sample count from five to three. These are regressions, not acceptable cross-platform accommodations. Do not replace the current tests or gates with the old versions.

## Remaining pipeline status

`e2e/OPEN_PROBLEMS.md` still tracks Chrome Stable drift as P2 because CI does not pin the browser revision. The old branch records Chrome versions but does not pin them or resolve this risk. Keep the 100-pixel comparison budget as a tripwire; do not widen it to mask drift.

The latest full mirror CI run observed during review, `43600920926`, passed on `108cc5d`. Local `main` is four commits ahead of both fetched remotes; that run does not verify those four commits. Verify the current local tip separately before reporting its entire CI pipeline green.

## Decision

Do not merge or cherry-pick `task/linux-snapshot-ci-20261024`, and do not re-record its snapshots. Preserve the historical branch ref. If a future automated baseline-promotion request arises, assess it as a new scoped policy change against current `main`.
