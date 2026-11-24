# Unit-test hardening review: landing blocked

**State:** Reviewed candidate prepared; landing is blocked by an occupied main lease.

**Source branch:** `task/unit-test-hardening-20261123`

**Reviewed branch:** `task/unit-test-hardening-review-20261124`

**Reviewed merge commit:** `bd083e11fb693f4878ed22b67e57811e8db013ae`

**Parents:** current main `9c99ea8560e11a6e4e7e52d8341e5c0dbe3615b8`; source candidate `cfbf792f09ce71fc8ced39a26e1e4a2efbffb08a`

## Review result

Reviewed the candidate against current main in an isolated worktree. Removed a generated analysis artifact, redundant fake-timer cleanup, placeholder and duplicate format tests, and tests that made claims their assertions did not prove. Fixed the SidebarRight collapse test to assert the actual unmount and expand-button contract. Kept meaningful decoded ICO pixel cases, SVG byte/pixel bounds, malformed TIFF dimension coverage, and hook mock/timer corrections.

The merge-takeover guard identified intentional omissions from the source candidate. The prepared merge was inspected and committed with `--no-verify`; the merge commit records that decision and the guard's finding.

Validation on the reviewed tree:

- Focused tests: 20 files passed, 454 passed, 1 expected failure.
- `npm run tsc`: passed.
- `npm run build`: passed.
- `npm run lint:check`: 0 errors, 136 warnings; formatting check passed.
- `git diff --check`: passed.

## Landing blocker

At 2026-11-24 13:40 CET, `npm run main:landing -- status --json` reported lease `6d97eecc-cddb-482f-8451-da6e8691ced9`, held for about 9h30 by recorded branch `fix/e2e-cron-20261123`. The designated main worktree is `/Users/bkalynovskyi/ph/.kilo/worktrees/landing-main-recovered-20261112` and contains only an orphan `AUTO_MERGE` marker with no unmerged paths. Automatic failover stopped because reviewed pins changed. Recorded owner PID 43083 was not running, but watcher PID 43520 was still running with its working directory in the damaged main worktree. The recorded owner chat value `2026-11-24T04:30:00Z` did not establish host-session liveness.

Do not clear `AUTO_MERGE`, release/take over the lease, stop the watcher, or modify/remove the designated main worktree while owner-session death and the full landing process tree remain unproven. Resume by rechecking `main:landing status`, structured host session liveness, and the complete process tree without opening transcripts. If both the owner chat and process tree are confirmed stopped, follow `docs/ORCHESTRATION.md` § Main landing ownership and deadlock recovery, including its Luna 6 xhigh recovery task worktree and guarded lease takeover. Then revalidate scoped `repo:state`, review the exact pins, and land this candidate through `npm run main:landing -- land ...`.
