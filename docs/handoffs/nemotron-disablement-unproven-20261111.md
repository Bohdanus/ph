# Nemotron disablement — unproven for landing

**Status:** Unproven; do not merge until two independent read-only reviews cover the synchronized candidate and landing preflight is clear.

**Branch:** `task/nemotron-quarantine-hardening-20261111`

**Worktree:** `/Users/bkalynovskyi/ph/.kilo/worktrees/nemotron-quarantine-hardening-20261111`

**Base:** `95533537f25a3dc28c204bf1772c880dd6359391`

**Implementation commit:** `fe245f0af272d2c5de3ed185b66d5760a32cda98`

**Implementation tree:** `a090a0721e0c37ff8d52de8f83a8e5e9e501ac16`

**Synchronized with main:** `85a71c35d0f897a828c1363f4d0ca286417b101c` in merge commit `ae3d8f8db`

## Candidate behavior

Nemotron IDs and catalog display names are filtered from the free-model pool. Direct Kilo and
OpenCode adapter calls reject Nemotron IDs, validation rejects them before network or quota checks,
and the subagent launcher requires an explicit live model/provider pair. The default quarantine
migration records the canonical `nvidia/nemotron-3-ultra-550b-a55b:free` route for 168 hours on Kilo,
OpenRouter, and OpenCode. The family-wide disable remains active after expiry.

The shared ignored quarantine file was migrated on 2026-11-11. Those three entries expire at
`2026-11-18T16:07:34.633Z` and do not change the tracked tree.

## Validation

- Focused free-model, validator, launcher, and quarantine suites: 341 passed, 1 skipped.
- `npm run lint`: passed with 77 warnings and no errors.
- `npm run tsc`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Remaining blockers

`docs/CODE-REVIEW.md` requires two independent read-only reviews for this cross-module quarantine
migration. Two paid reviewers returned no actionable findings on the pre-sync candidate
`80c3573399d5d4f286497ebc8e0063ae45dea6ab` (tree
`931971900b52fff4c3ff2092a5fd48d924f118a8`). Their reviews do not cover the synchronized candidate;
review the final diff before landing.

At the last preflight, `npm run repo:state` reported five other worktrees in `AUTO_MERGE`; the live
swarm check reported their claims as active. Do not inspect, repair, or clean those operations. The
designated main landing checkout itself reported no owner record or Git operation, but the full
repository preflight must be clear before landing.

## Resume

Obtain two independent read-only reviews of the exact synchronized candidate. After any review
fixes, rerun the focused suite and project gates and review the final candidate again. Recheck
`repo:state`, branch ownership, and `npm run main:landing -- status`; land only through the pinned
workflow in `docs/ORCHESTRATION.md` when all active worktree operations are resolved by their
owners. Then resume documented project hardening from the current handoff and problem list.
