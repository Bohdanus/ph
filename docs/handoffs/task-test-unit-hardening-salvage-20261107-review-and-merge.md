# Unit-test hardening review and landing

**Branch:** `task/test-unit-hardening-salvage-20261107`

**Reviewed main base:** `d0e5750ce12d19172e048a2318a217387c3d9bd2`

**Sync commit:** `97bcd96d66052faa5d9ba8078a56d75834d848ea`

**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**State:** Synced with current main, reviewed, and all required local gates pass. Protected landing is blocked by a separate live worktree operation.

## Scope and provenance

The source branch `task/test-unit-hardening-20261029` accumulated unrelated commits, so this branch carries only the selected test and documentation changes. The source-backed naming fix and history audit index entry were already on main before this sync.

The candidate adds assertions across unit and E2E-helper tests and updates the related documentation index. It changes no production code. Review strengthened the TouchSlider callback test to capture the selected value synchronously before React restores the controlled input value.

## Sync resolution and verification

Current main deleted `docs/INCOMING_COMMITS.md` in `b657d3c7a` when it retired that ledger. The sync preserves the deletion and the current documentation index. The citations test retains an explicit `§148` assertion. The write-boundary manifest now records the 17 temporary-directory setups and cleanups present in the merged Kilo test file.

Sixteen scoped review requests completed through the exact-zero OpenRouter Nemotron 3 Ultra route. The coordinator checked reported issues against the candidate source; false positives about mapping axes, disabled-history diagnostics, cleanup, section diagnostics, and test isolation were rejected. The TouchSlider event-value gap was reproduced and fixed, and its focused test passes.

On the synced candidate after that fix:

- `npm test -- --reporter=dot --silent=true`: 442 files passed; 12,816 passed, 229 expected failures, 13 skipped.
- `npm run test:e2e:unit -- --reporter=dot --silent=true`: 22 files passed; 1,585 passed, 12 expected failures.
- `npm run tsc`: passed.
- `npm run lint:check`: passed with 77 warnings and no errors.
- `npm run build`: passed.

## Landing blocker

`npm run repo:state` still refuses landing because `/Users/bkalynovskyi/ph/.kilo/worktrees/e2e-hardening-20261110` has an orphan `AUTO_MERGE` marker and six uncommitted E2E spec changes. The inventory generated at `2026-11-10T15:13:06Z` classifies that worktree as in use and derived live from I/O activity. Its owner is not proven stopped. Do not recover, reset, or otherwise alter it. Rerun `repo:state`, regenerate the inventory, and land only through the pinned procedure in `docs/ORCHESTRATION.md` after the operation is resolved.
