# Tablet bottom-bar touch E2E hardening — blocked at landing

## Status

The reviewed code is ready, but the pinned landing to `drguz69/lightshopy.com` is blocked by repository state and unavailable GitHub API access. The feature branch is pushed; [open a pull request](https://github.com/drguz69/lightshopy.com/pull/new/task/e2e-hardening-next-20261105).

## Candidate

Implementation commit `3f6d5abbdf44b358e51ff74efa8c9961e5cd561c` is based directly on source `origin/main` `332eb0fc5cf91efcf110dae1c0b349246cb3959b`. It adds a Chromium touch-swipe E2E at the supported 744×1133 tablet viewport and corrects the stale mobile/HiDPI note. The fresh read-only review found no test-validity issue; it caught the documentation mismatch, which was fixed.

## Evidence

- Local mobile-shell E2E, E2E unit suite, typecheck, lint, formatting, and the source pre-push gate passed.
- Mirror run [42108381418](https://github.com/Bohdanus/ph/actions/runs/42108381418) ran the exact implementation commit on Linux: 12 expected, 0 skipped, 0 unexpected, 0 flaky. Its Playwright artifact records `horizontal touch swipes reach the Layers tile` as passed with no retry.

## Landing blockers

- `npm run repo:state` refuses while `/Users/bkalynovskyi/ph` has an in-progress `AUTO_MERGE` on `audit/stale-harvest-followup-20261103` and unrelated dirty files. Only that worktree's owner can finish or recover it.
- The designated local `main` worktree is at `58ec4f34`; source `origin/main` is `332eb0fc`. The local branch has 122 unique commits and source `origin/main` has 3 unique commits. Landing from local `main` would import unrelated history, so do not reset or merge this divergence as part of this task.
- The active GitHub CLI account, `Bohdanus`, cannot resolve the private source repository through the API. SSH access did permit pushing the candidate branch, but the current CLI identity cannot create a PR.

## Resume conditions

Wait for the in-progress merge to be resolved by its owner. Establish a safe designated `main` landing state aligned with the core repository while preserving the local-only commits. Then refresh the candidate against current source `main`, rerun its gates, and use the documented pinned two-parent landing with `Branch: task/e2e-hardening-next-20261105` and the native `Chat:` trailer.
