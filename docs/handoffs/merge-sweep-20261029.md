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
