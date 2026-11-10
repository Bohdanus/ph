# Unit-test hardening review and landing

**Branch:** `task/test-unit-hardening-salvage-20261107`

**Reviewed main base:** `d0e5750ce12d19172e048a2318a217387c3d9bd2`

**Sync commit:** `97bcd96d66052faa5d9ba8078a56d75834d848ea`

**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**State:** Synced with current main. Fresh review and full gates are pending; protected landing is blocked by a separate live worktree operation.

## Scope and provenance

The source branch `task/test-unit-hardening-20261029` accumulated unrelated commits, so this branch carries only the selected test and documentation changes. The source-backed naming fix and history audit index entry were already on main before this sync.

The candidate adds assertions across unit and E2E-helper tests and updates the related documentation index. It changes no production code in its original test-hardening diff.

## Sync resolution and verification

Current main deleted `docs/INCOMING_COMMITS.md` in `b657d3c7a` when it retired that ledger. The sync preserves the deletion and the current documentation index. The citations test retains an explicit `§148` assertion. The write-boundary manifest now records the 17 temporary-directory setups and cleanups present in the merged Kilo test file.

The focused sync suite passed: `agents-citations.test.mjs`, `test-write-boundaries.test.mjs`, and `docs-index.test.mjs`, 42 tests total. The earlier full-suite results were on main `8cd115c4` and do not validate this synced tree. Fresh independent reviews, the full unit suite, E2E-helper suite, typecheck, lint, and build still need to run on the pinned post-sync candidate.

## Landing blocker

`npm run repo:state` reports an orphan `AUTO_MERGE` marker in `e2e-hardening-20261110`, whose worktree has uncommitted E2E spec changes. The latest inventory classifies it as live from recent I/O activity. Do not recover, reset, or otherwise alter that worktree. Rerun `repo:state` and regenerate the inventory after its owner finishes; land only through the pinned procedure in `docs/ORCHESTRATION.md`.
