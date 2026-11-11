# Nemotron disablement — unproven for landing

**Status:** Two independent reviews passed on the synchronized candidate; landing is blocked until repository preflight is clear.

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
migration. Two paid reviewers reviewed the synchronized candidate `d3fc78c7f289bf3000fa8c92b2f11be1be08618c`
(tree `6b7cf23306594785d1449200c373354f95c824cb`) against current `main` and returned no actionable
findings in their assigned scopes. The focused suite and project gates were rerun on this candidate.

At the last preflight, `npm run repo:state` reported five other worktrees in `AUTO_MERGE`; the live
swarm check reported their claims as active. They are `e2e-hardening-20261110`,
`free-model-pool-final-landing-20261110`, and the three `stateless-ghs-redaction` worktrees. Do not
inspect, repair, or clean those operations. The designated main landing checkout itself reported no
owner record or Git operation, but the full repository preflight must be clear before landing.

## Resume

Recheck `repo:state`, branch ownership, and `npm run main:landing -- status` after the live worktree
owners resolve their operations. If `main` advances, sync and review the new candidate before using
the pinned landing workflow in `docs/ORCHESTRATION.md`. After this change lands, resume documented
project hardening from the current handoff and problem list.
