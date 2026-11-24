# Unit-test hardening review: landing blocked

**State:** Candidate reviewed and gated; protected landing remains blocked by an occupied main lease.

**Source branch:** `task/unit-test-hardening-20261123` at `cfbf792f09ce71fc8ced39a26e1e4a2efbffb08a`

**Candidate branch:** `task/unit-test-hardening-origin-sync-20261124`

**Origin-sync merge commit:** `396310927464a8415345d87da9e841cacde8dd91`

**Origin-synced tree before this documentation-only handoff refresh:** `eefe1b43df8dea8143bd55d2711a3de8125317d0`

**Fetched and merged `origin/main`:** `29bca7ca3315cda52cde050a03db8debb553e8de`

## Review and validation

The source branch was reviewed against local main. The refined merge `bd083e11fb693f4878ed22b67e57811e8db013ae` omits placeholder, duplicate, misleading, and generated-artifact tests while retaining meaningful codec, pixel, malformed-input, hook, and timer coverage. The final candidate also validates host-native chat IDs before landing, updates integration fixtures for that contract, asserts the SVG byte boundary and pixel-area limit, and drains fake timers before switching to real timers.

An exact-free OpenRouter Nemotron review of the integration patch found two regressions: removing the SVG structure assertion and hard-coding the pixel-ceiling dimensions. Both were corrected. The SVG structure assertion is restored, and the non-square over-limit case is derived from `MAX_CREATABLE_DOCUMENT_PIXELS`.

Validation on the origin-synced code tree, before this documentation-only handoff refresh:

- `npm test -- --reporter=json`: 2,448 suites passed; 14,254 tests passed, 20 pending, 0 failed.
- `npm run tsc`: passed.
- `npm run build`: passed.
- `npm run lint:check`: 0 errors, 136 warnings; Prettier check passed.
- Focused landing guard: 122 tests passed.
- Focused history pixel parity: 40 passed, 4 expected failures.
- `git diff --check`: passed.
- `npm run repo:state -- --for-landing task/unit-test-hardening-origin-sync-20261124`: landing scope clear; unrelated worktree findings remain untouched.
- `npm run swarm -- doctor --dry-run`: no stale holdings.

## Main landing blocker

`main:landing status --json` reports lease `6d97eecc-cddb-482f-8451-da6e8691ced9` on `/Users/bkalynovskyi/ph/.kilo/worktrees/landing-main-recovered-20261112`. That checkout is clean except for an orphan `AUTO_MERGE` marker and has no unmerged paths. Automatic failover stopped because main moved after the lease's candidate pins were reviewed.

The owner record names branch `fix/e2e-cron-20261123`, but its chat ID is the timestamp `2026-11-24T04:30:00Z`, which cannot identify a host session. Recorded owner PID 43083 is absent and child PID is null. Detached watcher PID 43520 remains alive with its working directory in the occupied checkout. The owner chat and full process tree therefore are not proven stopped.

The occupied checkout, its `AUTO_MERGE` marker, watcher, and lease have not been modified. Do not create a competing `main` checkout or take over the lease until structured host liveness and the full holder process tree satisfy `docs/ORCHESTRATION.md` § Main landing ownership and deadlock recovery. Then use the guarded takeover and create the replacement main worktree through the documented playbook. Recompute and review the pins against current main before landing.
