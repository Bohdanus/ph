# Linux snapshot CI branch salvage review

**Decision:** obsolete. Do not cherry-pick code or re-record snapshots from this branch. Keep its ref for historical evidence; no worktree disposal or branch deletion was attempted.

**Branch reviewed:** `task/linux-snapshot-ci-20261024` at `871cfa71affcbc0c0dda26989220318f6939a93b`.
**Initial review base:** designated local `main` at `422f28a67f784eab8ecdb0232b3503df52d80d2f`; `origin/main` and `mirror/main` were both `108cc5d6477487ece41d89f9d85b5650d2144c6b`.
**Fresh follow-up refs:** `origin/main` advanced to `d0aa7bbf4037c2c98ebea80c9eef3aebb75b38e2`; `mirror/main` remains at `108cc5d`. Relative to fresh `origin/main`, the historical branch is 9 commits ahead and 1238 behind, with 8 patch-unique commits. The inventory has no worktree holding it. No old-branch commit was transplanted.

## Original problem and current state

The original task was to add Linux export snapshots because the visual-regression test failed when the Linux snapshot directory was missing. All seven Linux PNGs on the old branch have the same blob IDs as the seven current Linux PNGs on `origin/main`; there is no snapshot delta to salvage.

Current `capture-linux-baselines.yml` captures Linux, Windows, and macOS artifacts from a manual dispatch without committing them. Current `focused-e2e.yml` validates the trusted mirror dispatch and exact tested source SHA, validates the requested spec, and uses pinned Actions. The old branch's capture/focused-run machinery is superseded; automated baseline write-back is outside the original request and has no current requirement.

## Test and implementation review

The old branch's viewport helper is superseded by `src/util/client-viewport.ts::readClientViewportRect`, with focused coverage for borders, scrollbars, RTL layout, fractional dimensions, and missing client metrics. Current `usePointerPosition` also unwinds failed pointer capture; the old version calls capture without that recovery.

Current E2E coverage has crop HiDPI and exact-raster checks, bounds rejection, premultiplied-alpha diagnostics, and viewport capture hardening. The old Levels spec permits adjacent measured channel values where current tests use a deterministic fixture and exact output values.

The branch also weakens unrelated gates and removes behavioral tests. Its `vitest.config.ts` drops app coverage floors from lines 90%, functions 85%, branches 80%, statements 85% to 30% across all four metrics; it removes the explicit source include list and `reportOnFailure`. It deletes tests for a foreign `pointercancel` preserving the owning paint stroke, Clone Stamp Flow and aligned-source continuation, and flood-fill rejecting over-budget images before reading or allocating a mask. It reduces flood-fill performance samples from five to three. These are regressions, not acceptable cross-platform accommodations.

## Pipeline evidence and remaining issue

The latest accessible full mirror run before the fresh source tip was `43600920926`, successful on `108cc5d6477487ece41d89f9d85b5650d2144c6b`. It does not verify `origin/main` at `d0aa7bbf`. The source repository's Actions API returned HTTP 404 to this session, so source-run evidence was unavailable. The mirror's current default-branch workflow files are unchanged since `108cc5d`; an exact-SHA mirror run can validate the candidate tree against that workflow, but cannot establish source Actions status.

`e2e/OPEN_PROBLEMS.md` still tracks Chrome Stable drift as P2 because CI does not pin the browser revision. The old branch records Chrome versions but does not pin them or resolve this risk. Keep the 100-pixel comparison budget as a tripwire; do not widen it to mask drift.

## Disposition

Preserve `task/linux-snapshot-ci-20261024` as history. If automated baseline promotion becomes a requirement, scope and review it as a new policy change against current `main`; do not revive this branch.
