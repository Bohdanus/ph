# Nemotron disablement — unproven for landing

**Status:** Unproven; do not merge until two independent read-only reviews are complete and landing preflight is clear.

**Branch:** `task/nemotron-quarantine-hardening-20261111`

**Worktree:** `/Users/bkalynovskyi/ph/.kilo/worktrees/nemotron-quarantine-hardening-20261111`

**Base:** `95533537f25a3dc28c204bf1772c880dd6359391`

**Implementation commit:** `fe245f0af272d2c5de3ed185b66d5760a32cda98`

**Implementation tree:** `a090a0721e0c37ff8d52de8f83a8e5e9e501ac16`

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
migration. No complete review response was obtained. The latest exact-zero attempts returned two
OpenRouter HTTP 429 errors and one empty completion with `finish_reason=length`; earlier attempted
free routes also failed or were denied by their read-only profile. No incomplete response is review
evidence, and no paid reviewer was used.

`npm run repo:state` currently reports five other worktrees in `AUTO_MERGE`; the live swarm check
reports their claims as active. Do not inspect, repair, or clean those operations. The designated
main landing checkout itself reports no owner record or Git operation, but the full repository
preflight must be clear before landing.

## Resume

Obtain two independent read-only reviews of the exact candidate. After any review fixes, rerun the
focused suite and project gates and review the final candidate again. Recheck `repo:state`, branch
ownership, and `npm run main:landing -- status`; sync and land only through the pinned landing
workflow in `docs/ORCHESTRATION.md` when all active worktree operations are resolved by their
owners.
