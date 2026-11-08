# Review and merge record: test unit hardening salvage

**Branch:** `task/test-unit-hardening-salvage-20261107`
**Base main:** `8cd115c427b79aafd99bfa1894a6761b466744a4`
**Sync commit:** `9deeed57cd889bb319bde7603155c390c0ac32e8`
**Source commits:** `6badc372ea1e21bc0482bc63c56047e2dddd826f`, `b218b555f156045f59af278c43036a71f82c11df`
**Status:** Candidate synced, reviewed, and validated; protected landing requires clear repository state.

## Provenance and scope

The source branch `task/test-unit-hardening-20261029` accumulated unrelated commits, so this branch carries only the test and documentation changes selected for salvage. The other unit-test hardening candidate has since landed in `main` as `8cd115c427b79aafd99bfa1894a6761b466744a4`; the source-backed naming fix and history audit index entry are already present there.

The remaining candidate diff covers nine test files and four documentation files. During sync, the `agents-citations.test.mjs` overlap was resolved to retain the live §152 assertion and explicitly distinguish retired §§147–148. Its focused test passed. No production code changed.

## Review and validation

The final full unit run passed: 428 files, 12,480 passed, 227 expected failures, and 2 skipped. `npm run test:e2e:unit -- --reporter=dot --silent=true` passed 22 files, 1,565 tests, and 12 expected failures. `npm run tsc`, `npm run lint:check`, and `npm run build` passed; lint reported 78 warnings and zero errors, and Prettier passed. `npm test -- scripts/__tests__/docs-index.test.mjs --reporter=dot --silent=true` passed 10 tests.

Completed exact-zero OpenRouter reviews used `nvidia/nemotron-3-ultra-550b-a55b:free`. They identified a missing valid-scale oracle and recovery check, a fixed-length history-row expectation, and stale handoff counts; each was corrected and verified. Concerns about cursor mapping, event targets, centered contain-fit math, and same-directory documentation links were checked against source and tests and were not defects. Length-limited completions and provider 429 responses were excluded as review evidence.

## Landing gate

At the latest repository-wide preflight, `npm run repo:state` found an independent active merge in `stale-work-followup-20261107` with unresolved paths `e2e/global-setup.ts`, `e2e/history-panel.spec.ts`, and `scripts/e2e-run.mjs`. Preserve that worktree and rerun `repo:state` before landing; do not prepare or commit a main merge while that operation remains active. Once clear, recapture the candidate SHA/tree, verify the exact diff and ancestry, regenerate the worktree inventory, compare the prepared merge tree, and use the protected pinned-landing procedure.
