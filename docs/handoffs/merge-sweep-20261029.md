# Worktree harvest — blocked at landing gate

## Status

No candidate was merged or disposed. The landing checkout is not safe to use:
the `main` worktree is dirty and the fresh inventory maps three live Kilo shell
sessions to it, including the active WSL-preparation work. Its ref remains
`decafba0de2d18452df3b2e58a02836aadf0be16`. Do not clean, stage, or merge into
that checkout until its owner has finished and accounted for the existing changes.

The inventory was generated at `2026-10-29T21:23:01.902Z` against that `main`
ref. It reports 12 worktrees, no branch-only refs, two nominal `land` actions,
seven `at-risk` worktrees, one `in-use`, one `undecided`, and the current task
worktree. `npm run repo:state` reported no Git operation in progress.
`npm run branches:orphan` reported no orphan branches. The inventory script in
this task worktree failed with `spawn ENAMETOOLONG`; the hardened script in
`systemic-hardening` regenerated the snapshot at the repository root.

## Candidate findings

### `fix/e2e-input-guards`

- Commit: `3bda6a38b2b64297a3f64a849a59df1e7e62653f`
- Clean, one commit ahead of `main`, and no intervening `main` commits.
- Reviewed the four-file diff: non-finite color-sampling radii and page-scroll
  offsets are rejected; finite large radii are bounded by image dimensions.
- Validation in the candidate worktree: focused E2E helper tests passed
  (369 passed, 5 expected failures); `npm run tsc` passed.
- Ready for the pinned landing workflow once `main` is clean and no longer in use.

### `fix/activity-analyzer`

- Commit: `5733c66867f2a80610280ed653662b470be37fa9`
- The prior “Unmerged worktree review” transcript confirms this branch implements
  the user's Windows ActivitiesCache/VS Code usage request. The old inventory's
  `land` recommendation is superseded by direct validation:
  - `python -m unittest tests.test_intervals -v` fails during import because
    `tests/test_intervals.py` imports `Interval` from `app_usage.py`, where it is
    not defined. No tests run.
  - A synthetic in-memory database with one background hour and two overlapping
    foreground intervals produces a reported three-hour foreground total;
    the foreground interval union is 1.5 hours. `app_usage.py` counts all
    activity types and does not deduplicate intervals.
  - `explore_real_db.py` contains a user-specific database path and prints raw
    activity payloads, contrary to the request to redact payloads from ordinary
    output. It must not be landed as-is.
  - The tests exercise `app_usage.py`, not the separate `analyze_usage.py`
    implementation.
- Keep the branch preserved and unmerged until the tool is narrowed to the
  requested workflow, its foreground/timezone behavior is corrected, the
  exploratory script is removed or made safe, and the tests pass.

## Remaining worktrees

Preserve these unchanged; the fresh inventory classifies them `at-risk` because
they contain uncommitted work:

- `e2e-harden-origin-main`
- `landing-fix`
- `merge-origin-main-review`
- `origin-main-review`
- `prepare-wsl`
- `systemic-hardening`
- `text-toolbar-ux`

The pooled detached `mewing-perfume` worktree remains `undecided`. Do not discard
dirty payloads or apply its recovery patch wholesale. Re-audit each payload and
its owner before salvage or disposal.

## Resume conditions

1. Let the active WSL and other main-checkout sessions finish; preserve all
   existing dirty files. Verify `main` is clean and `repo:state` reports no
   operation before any landing.
2. Regenerate inventory and orphan reports. Re-review `e2e-input-guards` against
   the then-current `main`, rerun its gates, then use the pinned landing workflow
   in `docs/ORCHESTRATION.md` and `.skills/worktree-merge-harvest.md`.
3. Repair or explicitly defer the analyzer defects above; do not treat its
   inventory `land` label as approval.
4. Continue salvaging and cross-checking the remaining at-risk worktrees without
   deleting or overwriting uncommitted content.

## Follow-up audit (2026-10-29)

### Landing gate

A later inventory was generated at `2026-10-29T22:04:02Z` against
`decafba0de2d18452df3b2e58a02836aadf0be16`. It reported 15 worktrees, two
ready-to-land candidates, one disposal candidate, eight at-risk worktrees,
three in-use worktrees, one undecided worktree, and no branch-only refs.
`npm run repo:state` subsequently refused because
`sync-origin-main-20261029` has an active merge of
`db0c4f666b2d10e7de74b839ba81d6d40bef227c`. Its index had staged changes and no
unresolved paths. The main checkout also has active sessions. Do not touch the
main ref or working tree, or interrupt the sync merge; re-run the inventory and
all landing gates after its owner completes.

The inventory refresh wrote the generated `WORKTREES.json` in the repository
root. No main source files, index, or refs were changed. Investigation output
files and the Python caches created by analyzer tests were removed.

### Candidate disposition

| Worktree                                                                 | Evidence                                                                                                                                                                                                                                                                                  | Disposition                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e-input-guards` at `3bda6a38b2b64297a3f64a849a59df1e7e62653f`         | Clean, one commit ahead of the old main. Two independent reviews found no issues; the focused helper suite (369 passed, 5 expected failures) and `npm run tsc` passed in the prior sweep.                                                                                                 | Best landing candidate after the origin/WSL landings: re-review against current main and rerun gates before the pinned merge.                                 |
| `prepare-wsl` at `cf4e188f991369a5f7447808b60a675779568fe5`              | Clean, reviewed, and the user is preparing its pinned landing. One reviewer noted the `0.0.0.0` fallback should warn that the development server may be reachable from trusted-network peers.                                                                                             | Leave to the user handling the landing; consider adding the network-access warning in a later task.                                                           |
| `task-wsl-files` at `7241b8ca4a6f67b5135625ee33fa715f45b15ab0`           | Clean duplicate WSL implementation. Independent reviews found unsafe `git checkout -- .` line-ending advice, private-key copying, a Windows-specific copy recipe, Ubuntu 22.04/package mismatch, Playwright-before-`npm ci`, and an unsafe broad CRLF conversion.                         | Do not land or replace `prepare-wsl` with this version. Preserve until the duplicate can be safely disposed or selectively salvaged after the active landing. |
| `activity-analyzer` at `5733c66867f2a80610280ed653662b470be37fa9`        | Analyzer tests fail at import; independent reviews found foreground/overlap/date/timezone defects, no VS Code filter, weak coverage of the actual analyzer, and scripts/tests that expose or read real local activity data.                                                               | Keep unmerged. Repair the feature and replace real-database tests with synthetic fixtures before reconsidering.                                               |
| `e2e-harden-origin-main` at `c9baa088e8d8c8132ac847f3b09245ffa904ff4e`   | No branch-only commit; eight dirty paths. Independent reviews found invalid scroll values silently fall back to wrong capture coordinates and the new overflow control does not exercise pixel comparison.                                                                                | Preserve dirty payload; do not land as-is.                                                                                                                    |
| `origin-main-review` at `e49fb6ec577a82516b38a0f901216bed62260636`       | Seven staged autosave files plus unstaged changes. Independent reviews found startup can overwrite crash recovery, declining a restore can still clear it, concurrent/newer edits can be missed, failed saves are not retried, and clear failures are swallowed.                          | Preserve and do not land until recovery/data-loss behavior is fixed and covered.                                                                              |
| `text-toolbar-ux` at `dd406e99835c9d53f4c0a2c1f9a4453509c76a38`          | 58 focused tests and `npm run tsc` pass, but independent reviews found existing-layer geometry can shift for nonzero document origins, failed locked-layer replacement clears the draft, empty existing text cannot be committed, and the Auto reset is excluded from keyboard tab order. | Preserve and do not land until the defects are fixed and the Type tool is re-reviewed.                                                                        |
| `systemic-hardening` at `ae7c46d78e3d8b8e28a506971ea5d65d2acd3bcf`       | Two independent static reviews found no issues in committed changes. Its dirty `scripts/install-git-hooks.js` path-normalization edit uses external `tr`; the focused main-guard suite failed 3 of 30 tests because the test dispatcher PATH has no `tr` (`27 passed, 3 failed`).         | Keep the dirty edit and branch preserved. Fix the portability failure and rerun focused tests before landing.                                                 |
| `landing-fix` at `c9baa088e8d8c8132ac847f3b09245ffa904ff4e`              | Staged snapshot changes 664 paths (540 modified, 106 deleted, 18 added), with roughly 97k deletions across source, E2E, scripts, and docs.                                                                                                                                                | Not a surgical toolbar change; do not land or reset its index. Preserve for owner triage.                                                                     |
| `merge-origin-main-review` at `71cfc5a8e70b6ef3f1c637c763f5339b55485b5a` | 890 tracked paths reported modified despite empty content diffs, plus untracked `fix-crlf.ps1`. The script recursively rewrites matching files.                                                                                                                                           | Do not run the script or alter this worktree. Establish ownership and explain the status/index state before salvage or disposal.                              |
| `mewing-perfume` at `1b0b55a80da7da17022deea87f8248abdcbc92d4`           | Detached, clean recovery snapshot. `RECOVERY.md` says its preserved 387 KB patch contains unreviewed older code and must not be applied wholesale to current main.                                                                                                                        | Preserve the snapshot; review only in a fresh worktree at the recorded source commit if that work is explicitly recovered.                                    |
| `land-wsl` at the current main commit                                    | Clean and already an ancestor of main; inventory marks it disposable.                                                                                                                                                                                                                     | Defer disposal until the active repository merge is complete and the disposal preflight is regenerated.                                                       |

No candidate was merged or disposed during this follow-up. The main blocker is
the active origin-sync merge, not a lack of review. Preserve every dirty or
unresolved payload above and resume from a fresh inventory once the landing
owner releases the main checkout.

## Cleanup check (2026-10-30)

The operator authorized disposal only for clearly superseded branches/worktrees
with strong evidence of no useful unique data and an age greater than four
hours. Main is clean at `6f5812e4d582fcaadb0ada5d240908e44d42a067`, and
`npm run repo:state` reports no Git operation in progress. Main sessions are
still reported in progress, so this check made no branch or worktree changes.

The canonical inventory was refreshed with the Windows-batching generator from
`systemic-hardening` because the current-main inventory command failed with
`spawn ENAMETOOLONG`. The generated schema-7 snapshot uses the current main SHA
and reports 18 worktrees, six at-risk, three in-use, one undecided, and two
disposal candidates; there are no branch-only refs. `npm run branches:orphan`
reported no orphan refs. `npm run swarm -- doctor --dry-run` found no stale
claims or locks.

Both disposal candidates are clean and demonstrably superseded, and both
disposal dry-runs pass:

| Worktree                                                                                                        | Supersession evidence                                                                                                                                              | Age evidence                                                                                                                                                                                                           | Decision                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `land-wsl` (`land/wsl`, tip `decafba0de2d18452df3b2e58a02836aadf0be16`)                                         | Its tip is an ancestor of current main; the branch contains no unique commit or worktree changes. Dry-run would anchor it before removing the worktree and branch. | Checkout created `2026-10-29 22:37:24`, last written `23:25:38`; both are under four hours before this cleanup check. Its old commit date alone does not establish that the checkout has been inactive for four hours. | Preserve until both the age threshold and a fresh disposal preflight pass. |
| `sync-origin-main-20261029` (`chore/sync-origin-main-20261029`, tip `ecb18176a213962ec631c76ac5ebbed89656f6e8`) | Its sync commit is an ancestor of current main; the worktree is clean. Dry-run would anchor it before removal.                                                     | Checkout created `2026-10-29 22:42:14`, last written `23:03:36`; both are under four hours before this cleanup check.                                                                                                  | Preserve until both the age threshold and a fresh disposal preflight pass. |

No worktree or branch was deleted. `land-wsl` contains ignored `node_modules/`;
the old sync checkout contains ignored `dist/` and `node_modules/`. The disposer
reported both clear, but ignored build/install output does not waive the
operator's four-hour age condition. Do not remove either checkout early.

The new `sync-origin-main-20261030` worktree is recent and is a distinct
unlanded sync candidate, so it is not a cleanup target. The fresh inventory
continues to identify `activity-analyzer` and `task-wsl-files` as nominally
landable, but the correctness/privacy and WSL safety reviews above still rule
out landing them as-is. Re-run the live-session overlay, inventory, repository
state, and disposal dry-run after the four-hour threshold before removing any
checkout.
