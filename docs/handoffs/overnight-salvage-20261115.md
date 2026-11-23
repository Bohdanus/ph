# Overnight salvage handoff — 2026-11-15

## Verified state at handoff refresh

At this handoff refresh on 2026-11-16, direct `git ls-remote origin refs/heads/main` and the designated local main worktree both resolved to `cdea3215fe973888b2dc868f7e6cf14abd0243c8`. The status refresh merge's first parent is `6421c936bf5f80e0b6bdd2c1df207167e4cb7fc5`, its second parent is `a05bcf457d2161818a12bfe0edd84612f687b5c2`, and its tree is `51a8433f80142a67e7c4df7abe3a2525e36a73a6`.

Pinned landing commit `6421c936bf5f80e0b6bdd2c1df207167e4cb7fc5` merges `audit/salvage-overnight-20261115` at `8571ee531c24a297a49d6b5bcb3be03760de9686` into prior main `6c0feebc3f3a4fb4ae83d9c158b7fe8734f0ba1a`. Its tree is `e5906050cd81c77d6f34ac134fa4623b6afb4ff1`. The merge message includes `Branch: audit/salvage-overnight-20261115` and `Chat: 01a1d75d-5f67-7a90-9378-e07cf74634d4`.

After the docs-only handoff refresh landed, `npm run tsc`, `npm run build`, and `npm run lint:check` passed; lint reported existing warnings but no errors. `git push origin main` passed the full pre-push gate and moved `origin/main` to `cdea3215`. The designated main worktree was clean and its landing lease was free.

The landed candidate retains the expanded crop-rotation cursor regression tests, Windows-safe `pathToFileURL` CLI entrypoints, the direct orphan-branches CLI test, and related scanner inventory updates. It keeps current main's 0.2 cursor artwork scale and tenth-degree pointer-derived angle instead of the superseded 0.05/whole-degree branch implementation.

Pre-landing validation on the final candidate tree passed `npm run tsc`, `npm run build`, and `npm run lint:check` (existing ESLint warnings). Full Vitest passed: 449 files, 13,261 passed, 203 expected failures, 22 skipped. The focused crop/cursor suite passed 174 tests with 2 expected failures; the targeted headless crop E2E passed; orphan-branches and test-write-boundaries passed 15 tests. Post-landing typecheck, build, and lint checks also passed, and the pre-push full gate succeeded.

The preceding sweep recorded 22 completed tool-free Kilo Nemotron 3 Ultra completions at `$0`; a separate Kilo request timed out after 12 minutes and was not counted as a review. Four more completions in this continuation resolved to the exact free Kilo Nemotron route, each at zero reported cost with no OpenRouter requests. One broad review reversed the unified-diff direction when describing Windows entrypoints; that claim was rejected after checking the source, and no model claim was applied without manual verification.

## Landing status and remaining operation

The default `npm run repo:state` still reports an unrelated merge operation in `continue-salvage-20261115`. The scoped `npm run repo:state -- --for-landing audit/salvage-overnight-20261115` check exits successfully and reports that operation as unrelated, preserved, and non-blocking. This is the documented landing scope; the earlier instruction not to land or push while it remained open is superseded by the completed pinned landing above.

A fresh read found `continue-salvage-20261115` still has `MERGE_HEAD=45fcf273f2321991ab2955db1c71442b81383adb`, 14 changed paths, and no unmerged paths. The source branch HEAD trailer is `Chat: ses_e3f8d0570ffe0q3jajCxt28dtz`; the merge target trailer is `Chat: 01a18993-03cd-7e00-9188-f51dcff8532d`. The global inventory live-shell set includes the source HEAD chat ID but does not conclusively map that shell to this worktree. Ownership is therefore unproven. Do not commit, abort, resolve, or transplant its in-progress work until owner and process liveness are established through the host's structured metadata; no transcript was read.

The last reviewed application diff, measured against main at `6421c936` before this docs-only refresh, includes potential prunable-main/common-Git-directory validation changes across worktree inventory, disposal, hook installation, and the main-worktree guard. Two independent Nemotron reviews found the fail-closed behavior coherent; the adversarial review also identified missing positive-path and Windows normalization tests to add before any landing. The same diff removes the landed orphan-branches CLI test, deletes substantial cursor coverage, restores the smaller 0.05 cursor and 45-degree bucketing, and changes entrypoint guards back from `pathToFileURL` to string construction. The docs-only refresh changed no application files. Do not transplant the whole diff. Once the source owner finishes, reassess only the lifecycle files against then-current main, add the missing tests, obtain fresh independent reviews, and validate the final composition before landing.

The overnight-sweep procedure requires persistent hourly `cron_create`, and this Codex host exposes neither that scheduler nor Kilo `agent_manager`. No recurring overnight run is armed; the repository handoff and branches preserve the state for a later run.

## Worktree and branch disposition

The fresh inventory after the status refresh on 2026-11-16 recorded 21 registered worktrees and 43 branch-only refs (31 ancestors and 12 unmatched patches). It showed no ready-to-land worktrees, 13 clean landed disposal candidates, three at-risk worktrees, two in-use worktrees, and two undecided worktrees. `npm run branches:orphan` still reports the same 12 unmatched local refs; their ref-by-ref dispositions are recorded in [`merge-harvest-all-worktrees-20261114.md`](merge-harvest-all-worktrees-20261114.md). No worktree, branch, or dangling metadata directory was removed.

`audit-harvest-all-20261114` retains seven staged paths. Its current staged diff against main removes newer process-settlement and test coverage; no change was selected for transplant. `systemic-hardening-disposition-20261115` has seven tracked paths whose working contents match current main exactly, plus untracked `REVIEW_RESULTS.json`; it adds no unique tracked source delta. Preserve both worktrees and their local artifacts.

`continue-salvage-20261115` is described above. Also preserve the dirty/detached primary `ph` and `main-sync-` snapshots, external pooled `swift-piper`, and 31 `.kilo/worktrees` directories with missing Git admin records. No metadata repair, pruning, moving, or disposal was attempted.

The ref-by-ref dispositions are:

| Ref                                                                                            | Evidence and disposition                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/audit/pipeline-continuation-20261111`                                                  | Current `windows-platform-tests` workflow and `e2e-timeout-contract` tests cover the Windows script and E2E helper changes.                                                                                                                                                             |
| `origin/fix/dispose-worktree-main-ref-20261028`                                                | `git cherry` reports seven patch-equivalent commits and no new patch.                                                                                                                                                                                                                   |
| `origin/fix/inventory-root-align-20261022`                                                     | Current `scripts/lib/worktree-inventory/location.mjs` supplies the shared canonical resolver to inventory and disposal code.                                                                                                                                                            |
| `origin/fix/self-efficacy-ux-20261017`                                                         | Current `FirstUseTour` has the tour, focus, ARIA, and highlight behavior with tests.                                                                                                                                                                                                    |
| `origin/reconcile/skills-20261025`                                                             | Its older document moves/deletions are superseded by the current skills index and runtime loaders; no missing source content was identified.                                                                                                                                            |
| `origin/task/commit-free-docs-cleanup`                                                         | The 76-file snapshot deletes AutoSave and WSL material and rewrites current docs. Its quota wording conflicts with `MODELS.md`; do not cherry-pick it wholesale.                                                                                                                        |
| `origin/task/e2e-hardening-fresh-20261109` and `origin/test/e2e-committed-text-proof-20261110` | Their older text geometry, screenshot clipping, localhost normalization, and alpha checks are covered by newer current tests, including crop/alpha diagnostics and the text width oracle.                                                                                               |
| `origin/task/e2e-hardening-next-20261105`                                                      | Its crop parity, reorder waits, platform discovery, duplicate Red Eye assertion, and tablet touch changes are superseded by current crop, E2E runner, platform, and tablet reachability coverage.                                                                                       |
| `origin/task/small-caps-reopen-20261106`                                                       | Its older `TextToolArea`/`useLayer` behavior removes current retry and failure handling; current implementation and tests are more complete.                                                                                                                                            |
| `origin/task/stale-work-followup-20261107`                                                     | Current selection-history tests and the `127.0.0.1` E2E server guard cover its undo and loopback changes.                                                                                                                                                                               |
| `origin/task/toolbar-first-paint-fit-salvage-20261106`                                         | Current `toolbar-fit-store.ts`, `SidebarLeft.tsx`, and tests cover first-paint fit.                                                                                                                                                                                                     |
| `origin/test/magic-wand-loop-evidence`                                                         | Current tests cover closed-loop selection, blank-document selection, and deselection more fully.                                                                                                                                                                                        |
| `wsl-mirror/main`                                                                              | Five `git cherry` patches are unmatched, but content comparison found no safe unique delta: current main has stronger Bedrock/pixel tests and inventory checks; its SQL `char(92)` difference is equivalent; the remaining snapshot drops current search safety, behavior, or coverage. |

There is no registered `shape-rotation-handle` worktree. `feat/shape-rotation-handle` is an ancestor branch ref listed in the existing harvest handoff, not an omitted checkout. The older handoff also records that the binary cursor image was not selected and SVG is the current implementation; its scale note is superseded by current `origin/main`.

## Runtime note

The 31 dangling directories have `.git` pointers to missing admin records; the archived patches are not a coherent metadata backup. Follow [Recovering Git metadata](../ORCHESTRATION.md#recovering-git-metadata) before any recovery attempt. Do not repair, prune, move, or remove those directories during this salvage.

The WSL Git binary cannot resolve this Windows checkout's absolute linked-worktree Git directory, and WSL has no native Node installation. Repository work and validation therefore used Git for Windows and Windows Node; do not describe it as Linux-native validation. The active host also provides no persistent scheduler or Kilo agent-manager interface, as noted above.

## Follow-up snapshot — 2026-11-16

This snapshot supersedes the earlier landing and operation status above. The designated local `main` worktree and `origin/main` both resolved to `eec3fec13f015b4ede428fcc55e9993e52edf5ba` (tree `2b8d6efadced1d45b64d480d4fa23db627bd9889`). This commit landed `task/salvage-landable-20261116`; it contains sync candidate `b5a59025228f8d1b2f12b8acadbb36fc16240122`, which merged local landing `6b55a220` with the then-current remote `98fb5b72`. The prior `MERGE_HEAD` in `continue-salvage-20261115` is resolved; its clean source tip `d7695563` is an ancestor of current `main`. `repo:state` is clean and the landing lease is free.

Immediately before this handoff-only update, the continuation candidate was `task/salvage-continuation-20261116` at `f03797163c91a03c5a9f7cc06a28457837c76129` (tree `40f50757bbf008010387c607e89ca4627fec1363`), based on current `main`. Its only code changes beyond `main` are a 60-second bounded timeout for synchronous Git probes in `main-landing.mjs` and a 15-second test budget for the 12MP sharpen buffer/index correctness test. Both focused tests passed. The commit gate passed; the subsequent full push gate completed without failure output. An earlier full-gate attempt exposed the resource-sensitive timeouts that these adjustments address.

No additional source changes were selected from the preserved dirty snapshots. `audit-harvest-all-20261114` still has a staged patch that removes newer test coverage. The seven tracked working files in `systemic-hardening-disposition-20261115` match current `main` exactly; its untracked `REVIEW_RESULTS.json` remains preserved. The detached primary `ph` checkout remains dirty with unfinished chats, and its untracked `ORCHESTRATION_ISSUES_AND_BUGS.md`, `check-db.mjs`, and cursor image remain untouched. The issue report was not copied into the tracked tree because its claims mix fixed behavior, documented design limits, and unverified risks. No worktree or branch was disposed.

## WSL stale-worktree continuation - 2026-11-21

### Current source and integration

A fresh WSL fetch and git ls-remote origin refs/heads/main both resolved to
e31679a888261612e5efabe7bb3ce8d822a51479. The WSL salvage task branch was already
based on that commit. npm run repo:state now reports no operation in progress across
the 32 registered worktrees; the designated main worktree remains at older commit
61fe07d1 and its landing lease was free at the last check.

The dirty task/wsl-board-lock-salvage-20261119 worktree is preserved unchanged because
its owner could not be conclusively identified. Its complete staged and unstaged patch
was copied to the current task branch. The stale prepared merge in
fix/orchestration-rigorous-final-20261116 was cleared only after its exact staged
result was saved, no unresolved paths or unstaged changes remained, no process using
that worktree was found, and the branch-side work was shown to be represented in the
carried patch. Its six source commits and clean worktree remain preserved.

The integrated lock patch reports live foreign locks when claim release or reopen
retains them, prevents forced release of a live foreign lock, and makes doctor
report only retained locks still present after the entire sweep. A regression covers
the case where a later stale-lock pass clears a lock that the earlier claim pass
temporarily retained. The focused agent-board and merge-release suites pass 222 tests.
Three tool-free Kilo Nemotron 3 Ultra completion reviews ran at zero reported cost;
they were review completions, not subagents, and multiple claims were rejected after
source checks. Kilo task dispatch is unavailable in this Codex host and OpenRouter
preflight returned HTTP 401, so no OpenRouter completion or Kilo subagent is claimed.

### Ref and patch dispositions

- task/review-next-salvage-20261104: the exact-pixel getImageData/putImageData
  implementation is present on current origin/main; the dirty source difference
  removes two comments. Its docs/INCOMING_COMMITS.md ledger is obsolete and was
  deliberately removed by current main commit b657d3c7a. No pixel or ledger content
  was transplanted.
- Bedrock conversion tests and the source-flag assertion from commits 8b12fa488 and
  66e21c3a4 exist in current main's evolved test file. The retained-pixel patch
  from 8d1e7026f is also represented by current materialization code. Patch-ID
  differences here do not indicate missing behavior.
- The inventory batching safeguard from 68826b23e is present in current main with
  stricter handling for an individually overlong path. The old shared Kilo DB-path
  resolver was not ported: the WSL session database was unavailable, and the old
  resolver did not establish a working Windows AppData path from this WSL environment.
- task/wsl-files is obsolete against current main, which already owns
  docs/WSL-SETUP.md and scripts/wsl-setup.sh. The older branch copy regresses
  current setup guidance and compares the installed Node major to the full .nvmrc
  version string; its npm run prepare failure is also ignored.
- task/salvage-stale-worktrees-20261104 and its related old synchronization refs
  contain obsolete blocker reports and copies of changes already represented in
  current source. They were not merged wholesale.
- wsl/systemic-hardening-review still has patch-unique Windows process, shell
  argument, and executable-resolution changes. Its own prior review explicitly
  requires focused Windows validation. It remains preserved and unlanded; do not
  merge it directly into the WSL salvage candidate without that review.
- fix/activity-analyzer adds a personal Windows activity-cache analyzer with a
  machine-specific database path. It remains excluded from the product branch.
- The broken e2e-hardening- worktree metadata and all other source worktrees were
  left in place; no prune, disposal, or metadata repair was attempted.

### Remaining release state

The candidate contains the reviewed lock-safety changes, test and documentation
corrections for the supported Quick Selection modifiers, updated write-boundary
counts for the added temporary-directory cleanup, and this disposition update.
The first full-suite runs surfaced stale Quick Selection assertions and the new
cleanup callsites; those checks now match the current behavior and resource use.
The flood-fill scaling test passed alone (49 tests); its one failure in the default
four-worker full suite was a timing ratio under load. The full push gate passed with
CI=true, using the project's configured two-worker CI mode, without relaxing the
assertion. This section records pre-landing validation; establish final landing and push status from the verified main Git history and origin/main.
The preserved Windows-specific branch is explicitly unproven pending its platform
review; it is not a reason to merge stale snapshots or discard its source worktree.

## Follow-up - 2026-11-23

### Current remote and route work

The WSL task branch started at GitHub origin/main `87e63a5f1c1abec8df61795645e2c7ea4d435bc0`. At the last read, the GitHub remote and designated WSL main worktree matched that commit; the landing lease was free and `repo:state` reported no in-progress operation. This follow-up records pre-landing status; verify the final landing and push from Git history.

The branch adds exact provider/model selection to the free-completion runner, explicit failures for missing OpenRouter/Groq configuration, and WSL Kilo instructions. The pinned runner result reported the exact Kilo route nvidia/nemotron-3-ultra-550b-a55b:free, non-empty text, finishReason stop, cost 0, and request counters kilo 1 / openrouter 0. Seven read-only Kilo/Nemotron reviews in this continuation each reported finishReason stop, cost 0, and kilo 1 / openrouter 0; these were completions, not subagents. Findings were checked against current source. The exact changed-code review returned no concrete issue.

### Refreshed salvage findings

- The dirty `wsl-board-lock-salvage-20261119` worktree remains untouched. Its claim/reopen/doctor/merge-release behavior and regression tests are present on current origin/main. Its remaining timeout-only changes have no measured failure or latency evidence; they were not transplanted.
- The separate WSL clone at /home/dev/src/ph-salvage-20261031-b tracks the Windows local main at 17cd7d04898ae30c1977554af87446bc4c57e814, not GitHub origin. Its staged Bedrock test is older than the current origin test: it omits the temporary-canvas fallback case and the dedicated source-level isBedrock assertion; its dedicated test checks converted.isBedrock, which is already covered by the conversion test, while current origin asserts converted.source.isBedrock. It was not transplanted.
- Windows local main is stale relative to GitHub origin (92 commits only on GitHub, 2 only on the Windows mirror). Its unique OpenRouter comparison-table commit `ccea6dbc4` contains uncited benchmark and availability claims that conflict with the current canonical route ranking. It was not merged; keep the mirror and commit for a source-backed review.
- The Git registry lists /home/dev/src/ph/.kilo/worktrees/e2e-hardening- at HEAD 61fe07d1 as prunable because its checkout path is missing. A separate, unregistered directory /home/dev/src/ph/.kilo/worktrees/e2e-hardening-20261117-1850 is present; its .git file points to the absent /home/dev/src/ph.git/worktrees/e2e-hardening- admin path. It contains the 387,576-byte tool-inventory-cron-20261019.patch; its recovery note says the mixed merge-result patch is older and not to be applied wholesale. git apply --check --reverse fails against current origin, so the patch is not a clean reverse delta and its residual unique work remains unproven. No repair, move, prune, or disposal was attempted. Recovery requires a quiescent coherent backup and comparison under Recovering Git metadata.
- The generated WSL WORKTREES.json snapshot at 2026-11-23T13:16:37Z reported sessions=0 from /home/dev/.local/share/kilo/kilo.db; the WSL environment had no USERPROFILE or XDG_DATA_HOME. The Windows Kilo database exists at /mnt/c/Users/2025/.local/share/kilo/kilo.db (7,208,398,848 bytes), but a WSL Node DatabaseSync open with readOnly=true and PRAGMA query_only=ON returns ERR_SQLITE_ERROR: disk I/O error. The zero-session snapshot therefore does not establish Kilo-owner liveness. Do not infer that owners or descendants are dead from it.
- The older WSL inventory safeguards, exact-pixel materialization, and evolved Bedrock coverage are represented in current origin/main. The a933722cc handoff correction is obsolete because its problematic entry is absent from current HANDOFF.md. Windows-only hardening and the personal activity-cache analyzer remain outside this product landing.

No stale worktree was removed, reset, repaired, moved, or pruned. The dirty candidates ownership is not fully proven, and the broken metadata recovery prerequisites are unmet. Re-run a host-aware inventory after a supported Kilo database reader is available; do not treat the current zero-session result as clearance.
