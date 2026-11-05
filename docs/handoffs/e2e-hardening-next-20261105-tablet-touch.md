# Tablet bottom-bar touch E2E hardening — landing pending

## Status

The reviewed candidate is pushed to the source branch and CI mirror. `repo:state` is clear, but landing is still unsafe: the designated local `main` contains 134 commits not present on source `origin/main`. Keep the candidate isolated until the main owner provides a safe landing base that preserves those commits without importing them into the core repository.

## Candidate

Branch: `task/e2e-hardening-next-20261105`

Reviewed code commit: `20fb8e557829c5f53c54d175063654f4ca6df271`, based on source `origin/main` `332eb0fc5cf91efcf110dae1c0b349246cb3959b`.

The branch adds tablet touch reachability coverage at the supported 744×1133 viewport, corrects the related open-problem note, and makes `e2e-run` wrapper tests use a deterministic injected allocator. The real production allocator remains covered by a socket-binding test. Retry logging now reports retries rather than total attempts.

## Evidence

- Focused runner tests: 57 passed.
- Full unit suite: 409 files passed; 11,887 passed and 215 expected failures.
- `npm run lint:check`: passed with 65 existing warnings and no errors; formatting passed.
- `npm run tsc`: passed.
- Source branch push passed its full pre-push suite.
- Linux mirror run [42118840674](https://github.com/Bohdanus/ph/actions/runs/42118840674) completed successfully for exact source SHA `20fb8e557829c5f53c54d175063654f4ca6df271`; 12 Playwright tests passed. The report artifact marks `horizontal touch swipes reach the Layers tile` passed on retry 0 with no errors.

## Landing gate

`npm run repo:state` reports no active worktree operations. The designated local `main` is `3a2975be3271cb977e0d208e272b30ab7bb7ccae`; source `origin/main` is `332eb0fc5cf91efcf110dae1c0b349246cb3959b`; `origin/main...main` is `0 134`. Do not push or merge from this local `main`, because it would include 134 commits outside this candidate.

Resume when the owner establishes a designated landing base that excludes those 134 commits from the source main update. Refresh the candidate against the latest source main, rerun required gates, and use the pinned two-parent landing with `Branch: task/e2e-hardening-next-20261105` and the native `Chat:` trailer.
