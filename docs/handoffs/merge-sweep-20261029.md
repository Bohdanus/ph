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

At the time of this inventory, `sync-origin-main-20261030` was recent and a
distinct unlanded sync candidate. A later read-only check at `2026-10-30
00:54 +01:00` found that its merge had landed on main as
`4a72d30d981965950bbad6a47ad70f98d6589f7d`. `npm run repo:state` reports no
operation in progress. Its worktree was created at `00:40:06` and last written
at `00:42:38`, so it is newly superseded but far below the four-hour age gate;
preserve it.

The inventory at the time continued to identify `activity-analyzer` and
`task-wsl-files` as nominally landable, but the correctness/privacy and WSL
safety reviews above still rule out landing them as-is. Re-run the live-session
overlay, inventory, repository state, and disposal dry-run after the four-hour
threshold before removing any checkout.

## Cleanup recheck (2026-10-30 02:03 +01:00)

The current-main inventory command again failed with `spawn ENAMETOOLONG`.
Running the Windows-hardened inventory generator from `systemic-hardening`
wrote the canonical root inventory at `2026-10-30T01:02:57.578Z`, against main
`4a72d30d981965950bbad6a47ad70f98d6589f7d`. It reports 20 worktrees, three
disposal candidates, four ready-to-land, seven at-risk, four in-use, two
undecided, and no branch-only refs. `npm run repo:state` is clean across all 20
worktrees; `npm run branches:orphan` found none; `npm run swarm -- doctor
--dry-run` found no stale claims or locks. The live-session overlay still shows
the main-checkout sessions; there are no sessions opened in the three landed
disposal candidates.

| Worktree                                                        | Supersession evidence                                                                                                         | Current age / payload                                                                                                       | Decision                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `land-wsl` (`land/wsl`)                                         | Tip `decafba0de2d18452df3b2e58a02836aadf0be16` is an ancestor of main; clean, with no unique commit. Disposal dry-run passes. | Created `2026-10-29 22:37:24`; last written `23:25:38`; ignored `node_modules/`. At 02:03 it is about 3h26 old.             | Preserve until older than four hours; earliest threshold is 02:37:24, then rerun the gates and dry-run. |
| `sync-origin-main-20261029` (`chore/sync-origin-main-20261029`) | Tip `ecb18176a213962ec631c76ac5ebbed89656f6e8` is an ancestor of main; clean, with no unique commit. Disposal dry-run passes. | Created `2026-10-29 22:42:14`; last written `23:03:36`; ignored `dist/` and `node_modules/`. At 02:03 it is about 3h21 old. | Preserve until older than four hours; earliest threshold is 02:42:14, then rerun the gates and dry-run. |
| `sync-origin-main-20261030` (`chore/sync-origin-main-20261030`) | Tip `b0e3e5a416e44210bb3bc5061a671c9040c7a161` is an ancestor of main; clean, with no unique commit. Disposal dry-run passes. | Created `2026-10-30 00:40:06`; last written `00:42:38`; ignored `dist/` and `node_modules/`. At 02:03 it is about 1h23 old. | Preserve until older than four hours; earliest threshold is 04:40:06, then rerun the gates and dry-run. |

No worktree or branch was removed. The fresh inventory initially observed
`fix-push-gate-text-toolbar-20261030` as a disposal candidate, but a subsequent
direct status check found it dirty and the next inventory correctly classified
it `at-risk`. It is based on the main tip but has three modified tracked files:
`docs/TOOLS.md`, `src/components/ToolbarsRight/Text/__tests__/Text.test.tsx`,
and `src/tools/descriptions/type-crop.ts`. Its directory was created at
`01:58:51` and last written at `02:02:14`; preserve these recent changes and do
not run disposal against it.

This cleanup session also created the clean helper worktree
`cleanup-merge-sweep-20261030-0157` on branch
`chore/cleanup-merge-sweep-20261030-0157`, based on current main. It is
currently `in-use` by this session and was created at `01:58:23`; do not remove
it while the session is active. Once ownership ends and the age gate is met,
handle it only through the normal inventory and disposer workflow.

## Completed cleanup (2026-10-30 02:47 +01:00)

After both creation-age thresholds passed, the guarded disposer removed the
two clean, landed checkouts. It anchored each tip before deleting its branch:

- `land-wsl` / `land/wsl`: `decafba0de2d18452df3b2e58a02836aadf0be16` is
  retained at `refs/keep/disposed/land-wsl`.
- `sync-origin-main-20261029` /
  `chore/sync-origin-main-20261029`:
  `ecb18176a213962ec631c76ac5ebbed89656f6e8` is retained at
  `refs/keep/disposed/chore-sync-origin-main-20261029`.

The inventory was regenerated after each disposal. The final snapshot at
`2026-10-30T01:46:38.113Z` is based on main
`b44373895654b097cb5693abecb85b47638e56df` and reports 18 worktrees, one
disposal candidate, five ready-to-land, six at-risk, four in-use, and two
undecided. `npm run repo:state` is clean across all 18 worktrees;
`npm run branches:orphan` found none; `npm run swarm -- doctor --dry-run`
found no stale claims or locks. The main-checkout sync session remains active;
this cleanup changed no main files or ref.

Preserve `sync-origin-main-20261030`: its tip is contained in main, it is clean,
and its disposal dry-run passes, but it was created at `00:40:06`, so at
`02:47` it is only about 2h07 old. Its earliest four-hour threshold is
`04:40:06`; regenerate inventory and repeat every gate then.

The recent `fix-push-gate-text-toolbar-20261030` worktree is classified
`in-use` with `derivedLive: true`; its untracked
`landed-main-for-push.bundle` and recent activity at `02:42:53` are preserved.
Do not treat its tip being contained in main as permission to discard that
payload.

The dirty `test-scan` worktree is also preserved. Its staged additions
`TEST-AUDIT-RESULTS.md` and `audit-findings.json` contain the results of a
parallel test-suite audit; the audit is unique, uncommitted material even
though its branch has no commits ahead of main. The checkout was created at
`2026-10-29 23:13:08` and last written at `00:51:36`; its four-hour mark is
`03:13:08`, but it is not a disposal candidate while these reports remain
unreviewed or unsalvaged.

The detached `e2e-hardening-plan` worktree is `undecided` and not a cleanup
target. Although its `HEAD` is an ancestor of main and tracked status is clean,
it contains ignored `.kilo/plans/e2e-hardening-plan.md`, a substantial final
discovery plan with open test defects and evidence. The inventory reports its
status as unreadable, and the disposer does not accept `undecided`; preserve
the plan rather than treating clean tracked status as evidence of no useful
data. It was created at `2026-10-29 23:12:47`, but its age does not change this
decision.

## Latest disposal recheck (2026-10-30 04:42 +01:00)

After the 2026-10-30 origin-sync checkout passed four hours, the guarded
disposer removed it and anchored
`b0e3e5a416e44210bb3bc5061a671c9040c7a161` at
`refs/keep/disposed/chore-sync-origin-main-20261030`. The final inventory after
that removal reports 17 worktrees, five ready-to-land, seven at-risk, two
in-use, two undecided, and one disposal candidate. `repo:state` is clean;
`branches:orphan` found none; `swarm doctor --dry-run` found no stale claims or
locks. The three disposal anchors for this sweep were verified, and the three
corresponding worktree paths are absent.

The remaining disposal candidate is `fix-push-gate-text-toolbar-20261030`,
branch `fix/push-gate-text-toolbar-20261030`, tip
`6cad1f8bada2e65d30ef47c16b43b04fc225f24b`. The latest inventory classifies
it clean, landed, and not live; its dry-run passes. This supersedes the
earlier-in-this-sweep observation of a live untracked bundle, which is no
longer present. However, the checkout was created at `2026-10-30 01:58:51`,
so at 04:42 it is only about 2h44 old. Preserve it until after `05:58:51`, then
regenerate inventory and repeat the complete ownership, repository-state, and
disposal preflight.

The helper worktree `cleanup-merge-sweep-20261030-0157` is still `in-use` by
this session. It is clean and based on an older main tip, but must not be
removed while this chat is active. Reassess it through the normal disposer
workflow after this session ends.

## Follow-up landing and cleanup (2026-10-30 05:33 +01:00)

The WSL setup was landed on `main` as `2dddc8ef5e64a66f8c7d486b9e7a98b3c40a4229`.
Its parents are `b44373895654b097cb5693abecb85b47638e56df` and
`b794880adede10e52677ed163f0500b56d1d730b`; its tree is
`133391e4fb1a0c8956333268cac97f1243ba945a`. The setup guide warns that binding
Vite to `0.0.0.0` can expose the development server to reachable local-network
devices. In the synced candidate, `npm run tsc`, `npm run build`, and `bash -n`
against the committed setup-script blob passed. The full `npm run test` run
reported 15 failed files and 57 failed tests (11,508 passed, 215 expected
failures, 18 skipped); failures include Windows/POSIX path, symlink, shell-shim,
and timeout assumptions. No clean-main baseline was run, so these failures are
not attributed to the WSL change.

After the four-hour threshold and fresh disposal gates, the guarded disposer
removed the `prepare-wsl` and `task-wsl-files` worktrees. It retained
`prep/wsl` at `refs/keep/disposed/prep-wsl`; `task/wsl-files` was removed with
`--keep-branch` because its sole unmatched commit is a reviewed unsafe duplicate
of the landed WSL setup. The branch remains preserved as
`7241b8ca4a6f67b5135625ee33fa715f45b15ab0` and must not be treated as merged.
The superseded `fix-push-gate-text-toolbar-20261030` worktree was also removed
through the disposer; its tip is retained at
`refs/keep/disposed/fix-push-gate-text-toolbar-20261030`, and its branch was
left intact after safe deletion was refused.

The post-disposal inventory at `2026-10-30T05:33:35.998Z` is based on clean
main `2dddc8ef5e64a66f8c7d486b9e7a98b3c40a4229` and reports 14 worktrees: two
ready-to-land, one disposal candidate, seven at-risk, two in-use, and two
undecided. `repo:state` reports no operation in progress; the orphan report
shows the preserved unmatched `task/wsl-files` patch and two ancestor branches;
the swarm doctor reports no stale claims or locks. `fix/e2e-input-guards`
remains in-use because the board still reports a live agent. Although its prior
review and focused tests passed, do not sync, test, or land it until a fresh
inventory confirms the live signal has expired. `fix/activity-analyzer` remains
unsafe to land for the correctness and privacy defects recorded above.

Preserve the dirty worktrees and the two undecided worktrees from the inventory.
In particular, do not dispose the active cleanup worktree or infer that a
branch-only unmatched patch is expendable merely because its checkout is gone.

## E2E input guards landed (2026-10-30 06:42 +01:00)

The board's live signal for `fix/e2e-input-guards` expired. A fresh review
against main `2dddc8ef5e64a66f8c7d486b9e7a98b3c40a4229` confirmed the four-file
patch rejects non-finite color-sampling radii and page-scroll offsets, bounds
large finite radii to the image, and covers fractional-radius sampling. Its
synced candidate was `7f1501bb01cc4d830b04857e94dcbd4545b899e8`, tree
`b24f7c4f59db050af4e10ae65132eaec09e062e9`; the focused E2E helper tests passed
(369 passed, 5 expected failures) and `npm run tsc` passed.

The candidate was pinned into main as
`7c5585771b342768a23c24c24e58d91d0e00199c`, with first parent
`2dddc8ef5e64a66f8c7d486b9e7a98b3c40a4229`, second parent the reviewed
candidate, and tree `b24f7c4f59db050af4e10ae65132eaec09e062e9`. Main is clean.
The branch tip is now an ancestor of main and the checkout is clean, but the
sync wrote to the worktree at `2026-10-30 06:37 +01:00`. Preserve it until the
four-hour inactivity threshold has passed, then regenerate inventory and run
the full disposal preflight; do not treat its older checkout creation time as
proof that the recent activity is stale.

## Continued salvage sweep (2026-10-30 09:54 +01:00)

### Archived dirty snapshots

Six inactive dirty snapshots passed fresh inventory, repository-state, swarm,
ownership, ignored-content, and per-worktree `--keep-branch --dry-run` checks.
Their branches were retained and tracked/untracked edits were archived under
`.git/worktree-salvage/`:

- `e2e-harden-origin-main` / `e2e/harden-origin-main`: `tracked.patch` (18,306
  bytes, SHA-256 `0434A1C24BDC3C5647EF9DBBD6F847C1F58C154398A81FB20183135E9F7E72EA`)
  and `untracked.tar` (14,848 bytes; viewport helper and test).
- `landing-fix` / `fix/landing-text-toolbar`: `tracked.patch` (7,471,945 bytes,
  664 file diffs; SHA-256
  `0D9F076445B16E0AE27282D868513711FC1956A8A1E064C2EE802BDF3AE02B92`).
- `origin-main-review` / `fix/origin-main-review`: `tracked.patch` (67,131
  bytes, 10 files; SHA-256
  `EA5151D497BC5A0502F0F797AEC7DE964A90E3DB18CD6EFD270FD1F4A0285316`).
  `git apply --stat` parses as 1,579 insertions and 46 deletions. Keep
  unmerged; earlier review found autosave recovery/data-loss hazards.
- `test-scan` / `audit/test-scan`: `tracked.patch` (94,211 bytes, both audit
  reports; SHA-256
  `439DA29495E5B410737240617F6129F081BDFDD40B72FC615C761299E9EC2BBD`).
- `text-toolbar-ux` / `fix/text-toolbar-ux`: `tracked.patch` (26,715 bytes,
  four files; SHA-256
  `189BDC826205E6FA4FA9ED738919CB140BC2A8651FD5232A640D9C3DCDEE0528`) and
  `untracked.tar` (6,656 bytes containing `docs/PS-TYPE-TOOLBAR-UX.md`).
  Keep unmerged pending fixes to the previously reviewed UX defects.

`merge-origin-main-review` did not fully dispose. Its tracked diff was empty;
`untracked.tar` (2,048 bytes, SHA-256
`05255E647ABC7D4EDAD62E6D0E33F41E2382C8DD51A6E4ABF5A62C5D9FCD7BB5`)
preserves `fix-crlf.ps1`. Removal reported `Filename too long`; Git no longer
registers it, but the unregistered directory remains with tracked files also
present on `main` and 101 test-result files (~8.4 MB). Do not run the script or
manually remove this directory. The `test-scan` removal also left an
unregistered directory containing only a `node_modules` junction to main.
The disposer disables recursive removal of unregistered directories; preserve
both residuals pending a reviewed cleanup path.

### Current blockers and next eligibility

- `systemic-hardening` is in use and must not be changed or disposed. Its
  branch has 13 unique commits, four dirty files, and merge-tree conflicts in
  `scripts/free-model-pool.mjs` and
  `src/components/ToolbarsRight/Text/__tests__/Text.test.tsx`. `npm run tsc`
  passed. The focused run had 4 failures (three hook tests could not find
  `tr` in the restricted test PATH; one newline-path fixture failed on
  Windows), 186 passed, and 2 skipped. Do not land the branch wholesale.
- `activity-analyzer` is not safe to land: tests fail at import, foreground
  overlap is double-counted, and its real-database exploration prints raw
  activity payloads. Preserve it for repair rather than trusting the
  inventory's `land` label.
- Preserve the detached `e2e-hardening-plan` (24,507-byte ignored plan) and
  pooled `mewing-perfume` (387,576-byte recovery patch documented in
  `RECOVERY.md`).
- The clean landed `e2e-input-guards` and `merge-sweep-20261029-2220` checkouts
  remain inside the four-hour inactivity window. Their last writes were
  06:37:28 and 06:46:29 local time; do not dispose before 10:37:28 and
  10:46:29 respectively. Regenerate inventory and rerun every disposal gate
  immediately before either removal.

The latest inventory is based on clean `main` at
`589a60b2448b27f6cdf83546459488a55ae35dae`. It reports 8 registered worktrees:
3 in use, 2 undecided, 2 clean landed disposal candidates, and the unsafe
analyzer candidate; no at-risk worktree remains. `repo:state` is clean, the
orphan-branch report is empty, and `swarm doctor --dry-run` reports no stale
claims or locks. Main remains in use; no landing was attempted.

## Age-gated cleanup completed (2026-10-30 10:52 +01:00)

- Removed `e2e-input-guards` only after more than four hours since its last
  commit (`7f1501bb01cc4d830b04857e94dcbd4545b899e8`). The fresh inventory
  classified it as clean, landed, unprotected, and not live; the guarded
  dry-run passed. Its commit is anchored at
  `refs/keep/disposed/fix-e2e-input-guards`; the worktree and branch were
  removed.
- Removed `merge-sweep-20261029-2220` under the same checks, after more than
  four hours since its last commit (`95207d48e7174332f7cf09ce405cdb73a8debd69`).
  Its commit is anchored at
  `refs/keep/disposed/audit-merge-sweep-20261029-2220`; the worktree and branch
  were removed.
- Regenerated the inventory after both removals. It reports 6 worktrees, no
  disposal candidates, 1 at-risk worktree, 2 in-use, 2 undecided, and
  `activity-analyzer` as ready to land. Do not treat that analyzer label as
  approval: its import-failing tests, overlapping-interval double counting,
  and raw activity-payload output still block landing.
- Preserve `systemic-hardening` (13 commits ahead, 39 behind, four dirty files),
  detached `e2e-hardening-plan`, pooled `mewing-perfume`, and the unique
  `task/wsl-files` branch-only patch. No additional worktree was safe to land
  or remove.
- Main remained clean at
  `589a60b2448b27f6cdf83546459488a55ae35dae`, equal to `origin/main`; no
  landing was attempted. Post-cleanup `repo:state` was clean, the orphan-branch
  report was empty, swarm status showed no claims or locks, and
  `swarm doctor --dry-run` found no stale signals.
