# Nemotron disablement — landing handoff

**Status:** Current-main sync is prepared. Both independent paid reviews passed, and the focused tests and project gates pass. Ready for pinned landing after the final ownership and pin preflight.

**Branch:** `task/nemotron-quarantine-hardening-20261111`

**Worktree:** `/Users/bkalynovskyi/ph/.kilo/worktrees/nemotron-quarantine-hardening-20261111`

**Current main parent:** `7d431550c3f9571943dee3042989db2050759cf6`

**Implementation commit:** `fe245f0af272d2c5de3ed185b66d5760a32cda98`

## Candidate behavior

Nemotron IDs and catalog display names are filtered from the free-model pool. Direct Kilo and
OpenCode adapter calls reject Nemotron IDs, validation rejects them before network or quota checks,
and the subagent launcher requires an explicit live model/provider pair. The default quarantine
migration records the canonical `nvidia/nemotron-3-ultra-550b-a55b:free` route for 168 hours on Kilo,
OpenRouter, and OpenCode. The family-wide disable remains active after expiry.

The shared ignored quarantine file was migrated on 2026-11-11. Those three entries expire at
`2026-11-18T16:07:34.633Z` and do not change the tracked tree.

## Validation

After syncing current main and resolving its catalog-test overlap while preserving the isolated
empty-quarantine fixture:

- Free-model-pool and test-write-boundary suites: 117 passed, 1 skipped.
- `npm run lint`: passed with 77 warnings and no errors.
- `npm run tsc`: passed.
- `npm run build`: passed.
- `git diff --cached --check`: passed.
- The boundary audit's current source counts are 29 `mkdtemp`/`rm` patterns in
  `free-model-pool.test.mjs` and 9 in `free-model-quarantine.test.mjs`.

## Review and landing state

Two paid Luna reviewers checked the refreshed candidate against the current main parent and
returned no actionable findings. The quarantine review verified that this handoff no longer cites
an earlier tree for its review or gate evidence, and confirmed the focused test result and resource
boundary counts above.

`npm run main:landing -- status` reports the designated main checkout free. The scoped
`repo:state --for-landing task/nemotron-quarantine-hardening-20261111` reports this landing scope
clear. Five unrelated worktrees have active `AUTO_MERGE` operations; the scoped gate classifies
them as unrelated. Preserve them and do not inspect, repair, or clean them.

## Next action

Both final reviews have passed. Finish and commit the prepared sync merge in this worktree with the
required `Chat:` trailer. Recheck source ownership, `repo:state --for-landing`, main landing status,
and `git cherry`, then land using the pinned workflow in `docs/ORCHESTRATION.md` against current
main. Verify the resulting main parents, tree, and clean status. Continue project hardening from
the unresolved entries in `HANDOFF.md` and `e2e/OPEN_PROBLEMS.md`.
