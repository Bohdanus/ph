# Tablet touch and E2E hardening — landing pending

## Status

The candidate contains the tablet touch and runner hardening plus all 134 commits present on the designated local `main`. The combined tree passes the full unit suite, E2E unit suite, typecheck, lint and format checks, and production build. A fresh full Linux, Windows, and macOS mirror run on this exact tree remains the cross-platform landing gate.

The previous full mirror run used the pre-merge candidate and failed on Linux and Windows. Its results do not describe this combined tree. Do not land based on that stale run.

## Candidate

Branch: `task/e2e-hardening-next-20261105`

The E2E changes add tablet touch reachability coverage at 744×1133, tighten the crop-history per-layer alpha-edge classifier while preserving exact bounds and byte-identical composite checks, and keep the documented parity rule aligned with the test.

## Current validation

- Full unit suite: 413 files passed; 12,086 passed and 207 expected failures.
- E2E unit suite: 22 files passed; 1,563 passed and 12 expected failures.
- `npm run tsc` and `npm run build`: passed.
- `npm run lint:check`: passed with 73 warnings and no errors; formatting passed.
- Focused documentation and test-write-boundary guards: 42 tests passed.

The designated local `main` is `3a2975be3271cb977e0d208e272b30ab7bb7ccae`; it contains 134 commits beyond source `origin/main` `332eb0fc5cf91efcf110dae1c0b349246cb3959b`. The user authorized including all 134 commits.

## Landing gate

Run `npm run test:e2e:mirror -- --full` after the candidate merge commit is pushed, then inspect the exact run SHA and all platform artifacts. Before merging into the designated `main`, require `repo:state` to be clear, confirm the main worktree is clean, refresh the worktree inventory and orphan report, and use the pinned reviewed-landing procedure with `Branch: task/e2e-hardening-next-20261105` and the native `Chat:` trailer.
