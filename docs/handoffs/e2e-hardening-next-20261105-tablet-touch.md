# Tablet touch and E2E hardening — landing pending

## Status

The candidate contains the tablet touch and runner hardening plus all 134 commits present on the
designated local `main`.

Full mirror run [42127071730](https://github.com/Bohdanus/ph/actions/runs/42127071730) on commit
`5e7870656da32422884721b591a5ec1460e39d7b` failed on two shards. Both Linux shards, macOS shard 2,
and Windows shard 1 passed. Windows shard 2 had one startup failure loading Vite's `/@react-refresh`
module; its retry passed, but `failOnFlakyTests` correctly failed the job. macOS shard 1 found seven
differing channel bytes in the styled-text tight bitmap while frame and composite pixels remained
byte-identical. The current candidate applies the bounded alpha-gradient rule to that styled-text
comparison. Run the full mirror again on the updated candidate and investigate the Windows startup
failure if it recurs.

## Candidate

Branch: `task/e2e-hardening-next-20261105`

The E2E changes add tablet touch reachability coverage at 744×1133 and tighten the
crop-history per-layer alpha-edge classifier. Its two-pixel exception applies only
when the changed pixel has fractional alpha and neighbors with both lower and higher
alpha values. The styled-text fixture uses the same rule; exact materialized bounds,
frame pixels, and composite pixels remain required.

## Current validation

- The prior candidate passed the full unit suite: 413 files, 12,086 passed and 207 expected failures.
- The current change passed the focused styled-text E2E locally and the E2E unit suite: 22 files,
  1,563 passed and 12 expected failures.
- The current change passed typecheck and production build. Lint passed with 73 warnings and no errors; formatting passed.

The designated local `main` is `3a2975be3271cb977e0d208e272b30ab7bb7ccae`; it contains 134 commits beyond source `origin/main` `332eb0fc5cf91efcf110dae1c0b349246cb3959b`. The user authorized including all 134 commits.

## Landing gate

Run `npm run test:e2e:mirror -- --full` after the latest candidate commit is pushed, then inspect the exact run SHA and all platform artifacts. Before merging into the designated `main`, require `repo:state` to be clear, confirm the main worktree is clean, refresh the worktree inventory and orphan report, and use the pinned reviewed-landing procedure with `Branch: task/e2e-hardening-next-20261105` and the native `Chat:` trailer.
