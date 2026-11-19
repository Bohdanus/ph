# Linux snapshot CI branch salvage review

**Decision (2026-11-15):** Salvage the cross-platform baseline capture capability by rebuilding it on current main as an artifact-only workflow. Do not merge or cherry-pick the October branch.

## What was missing

The historical branch `task/linux-snapshot-ci-20261024` at `871cfa71affcbc0c0dda26989220318f6939a93b` has no snapshot files missing from current main: all seven Linux and seven Windows baseline blobs match. Current main also has the macOS baseline tree. Current `capture-linux-baselines.yml` can capture and promote Linux snapshots, but there is no capture path for Windows or macOS; the regular CI jobs verify those committed baselines without producing replacements.

The old branch's `capture-linux-baselines.yml` contains the useful idea: select Ubuntu, Windows, or macOS, map each runner to its native snapshot directory, verify the export tests, and upload the result. Its implementation is stale: mutable action tags, no mirror/default-branch guard, no exact workflow-revision checkout, and no exact seven-file/PNG validation. Reusing that file would carry those gaps forward.

## Salvaged capability

`.github/workflows/capture-platform-export-baselines.yml` adds a manual `all|linux|windows|macos` capture path for `Bohdanus/ph`. The workflow definition must run from trusted mirror `main`; optional `source_sha` selects a full source commit already available in the mirror, defaulting to the workflow's main revision. It uses SHA-pinned actions and read-only repository permissions, maps OS names to the existing snapshot directories, runs capture and verification, checks for exactly seven regular PNGs, and uploads artifacts with both source and workflow SHA/run provenance. The workflow cannot commit or promote files. The existing guarded Linux promotion workflow is unchanged.

Contract tests cover the mirror/ref guard, action pins, OS-to-snapshot mapping, allowlist and PNG signature checks, artifact-only behavior, and the two-run Playwright timeout budget on all three operating systems. The manual workflow is available on the mirror after the reviewed source main is synced there.

A separate pointer test from the old branch combined nonzero client borders, scrollbar-shrunken dimensions, fit geometry, and `getLocalCoords`. Main already covered fractional client metrics and scrollbar-driven resize recomputation, but not that combined mapping path. The missing integration case is reimplemented in `src/hooks/__tests__/usePointerPosition.test.ts`; the old helper and duplicate coverage were not transplanted.

## Rejected changes from the old branch

The other old branch changes are already superseded or are unsafe to transplant. Current main contains the cross-platform E2E matrix, focused runs, richer crop/history diagnostics, and the robust pointer-capture cleanup. The old branch's pointer implementation is weaker. Its changes to screenshot thresholds and color filters loosen assertions without reproducing the old CI failures. Its coverage-floor reduction and smaller flood-fill sample count weaken unrelated gates. The mirror run `40140807034` failed on Linux/Windows E2E and audit; it does not establish that the later branch tip was green.

## Worktree disposition

The original `task/linux-snapshot-ci-20261024` ref has no registered worktree and remains historical evidence. The separate review worktree `linux-snapshot-salvage-review-20261114` is clean and already merged into current main. A fresh inventory marks it `action=dispose`, `prunable=true`, and `mergedIntoMain=true`; it has no Kilo write history, claims, locks, or live board agents.

Disposal remains blocked by the fail-closed Codex ownership check. The current-tip Chat trailer resolves to an 18-session family: 17 rollouts are complete, while the root is unproven because an `item_completed` `CommandExecution` event follows its `task_complete` marker in the same turn. The command is marked completed, but the Codex family parser does not treat this event as terminal bookkeeping. Manual checks found no family activity for more than a day and no matching live process or open file; they do not change the parser's unproven result. A fresh `npm run dispose -- --dry-run --codex-owner-audit-complete linux-snapshot-salvage-review-20261114` refused for that exact reason and changed nothing.

Do not bypass the ownership refusal or delete the checkout. Preserve `.serena/`, `.kilo/plans/`, and the original worktree contents until the Codex completion evidence is resolved and a fresh disposal dry-run passes. Before retrying, regenerate inventory and repeat the repository-state, board, session-family, process, and open-file checks. `repo:state` currently also reports six unrelated `AUTO_MERGE` markers; do not repair another worktree's operation.
