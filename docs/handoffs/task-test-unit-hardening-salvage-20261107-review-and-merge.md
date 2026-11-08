# Review and merge record: test unit hardening salvage

**Branch:** `task/test-unit-hardening-salvage-20261107`
**Base main:** `8cd115c427b79aafd99bfa1894a6761b466744a4`
**Sync commit:** `9deeed57cd889bb319bde7603155c390c0ac32e8`
**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**Status:** Candidate synced and validated; final candidate review and protected landing remain.

## Provenance and scope

The source branch `task/test-unit-hardening-20261029` accumulated unrelated commits, so this branch carries only the test and documentation changes selected for salvage. The candidate was synced to the current `main` tip with commit `9deeed57cd889bb319bde7603155c390c0ac32e8`. The other unit-test hardening candidate has since landed in `main` as `8cd115c427b79aafd99bfa1894a6761b466744a4`; the source-backed naming fix and history audit index entry are already present there.

The remaining candidate diff covers nine test files and four documentation files. During sync, the `agents-citations.test.mjs` overlap was resolved to retain the live §152 assertion and explicitly distinguish retired §§147–148. Its focused test passed. No production code changed.

## Review and validation

The refreshed full unit suite passed: 428 files, 12,480 passed, 227 expected failures, and 2 skipped. The E2E helper unit suite passed: 22 files, 1,565 passed, and 12 expected failures. Typecheck and production build passed. Lint and Prettier passed with 78 existing warnings and zero errors. The new unavailable-dimensions fit-scale test passed after adding an explicit assertion that its starting scale is 1.925.

Four completed, exact-zero OpenRouter reviews used `nvidia/nemotron-3-ultra-550b-a55b:free`. One identified the missing starting-scale oracle, which was added and passed its focused test. The other proposed test and documentation issues were checked against implementation, fixtures, and actual paths; they were not defects. One broader review request ended without complete output after a provider 429 and length-limited responses, so it is not counted as review evidence. A fresh review of the exact final candidate is still required before landing.

## Landing gate

Before merging into `main`, capture the final candidate SHA and tree, complete two independent read-only reviews of the exact diff, rerun the unit and E2E helper gates, regenerate the worktree inventory, verify ownership and ancestry, compare the prepared merge tree, and use the protected pinned-landing procedure. Do not land if either `main` or the candidate changes after review.
