# Tablet touch and E2E hardening — landing pending

## Status

The candidate contains the tablet touch and runner hardening plus all 134 commits present on the
designated local `main`.

Full mirror run [42127071730](https://github.com/Bohdanus/ph/actions/runs/42127071730) on commit
`5e7870656da32422884721b591a5ec1460e39d7b` had a transient Windows `/@react-refresh` startup failure
and a strict styled-text tight-bitmap mismatch on macOS. The next full run
[42131494282](https://github.com/Bohdanus/ph/actions/runs/42131494282) passed CI checks, E2E unit,
Linux shard 2, Windows shard 2, and macOS shard 2. Linux shard 1 and Windows shard 1 failed the same
frame-edge alpha comparison; macOS shard 1 failed the styled-text comparison and had one retried
layer-reorder failure.

Focused macOS run [42135143691](https://github.com/Bohdanus/ph/actions/runs/42135143691) captured the
styled-text samples: expected and materialized alpha bytes and 5×5 neighborhoods were identical.
The seven raw blue-channel differences (169/170 at alpha 170; 178/179 at alpha 10) map to identical
premultiplied channel bytes. The candidate now compares tight bitmap values exactly in premultiplied
space, keeps alpha exact, and uses a separate partial-alpha boundary classifier for frame comparisons.
Run the focused crop-history spec on Linux and Windows, then rerun the full mirror and inspect all
platform artifacts.

## Candidate

Branch: `task/e2e-hardening-next-20261105`

The E2E changes add tablet touch reachability coverage at 744×1133 and harden crop-history parity.
Mixed-source tight raster checks retain the two-pixel internal-alpha-gradient allowance. Styled-text
tight rasters compare exactly in premultiplied channel space with exact alpha; frame comparisons keep
their own partial-alpha boundary rule. Materialized bounds and final composites remain exact.

## Current validation

- The prior candidate passed the full unit suite: 413 files, 12,086 passed and 207 expected failures.
- The prior candidate passed the E2E unit suite: 22 files, 1,563 passed and 12 expected failures.
- Current crop-history changes passed local typecheck, lint/format, and focused tests for the retained
  raster and styled-text transforms. The layer-reorder test also passed three local repetitions. The
  focused mirror exposed the macOS readback details above; the premultiplied comparison still needs
  focused Linux, Windows, and macOS mirror validation.

The designated local `main` is `3a2975be3271cb977e0d208e272b30ab7bb7ccae`; it contains 134 commits beyond source `origin/main` `332eb0fc5cf91efcf110dae1c0b349246cb3959b`. The user authorized including all 134 commits.

## Landing gate

Run `npm run test:e2e:mirror -- --full` after the latest candidate commit is pushed, then inspect the exact run SHA and all platform artifacts. Before merging into the designated `main`, require `repo:state` to be clear, confirm the main worktree is clean, refresh the worktree inventory and orphan report, and use the pinned reviewed-landing procedure with `Branch: task/e2e-hardening-next-20261105` and the native `Chat:` trailer.
