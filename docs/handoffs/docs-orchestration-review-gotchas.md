# Review: orchestration and code-review guidance

**Branch:** `docs/orchestration-review-gotchas-20261102`
**Original request:** Analyze Kilo and Codex chats for typical orchestration gotchas and improve the orchestration and code-review documentation.

## Changes reviewed

- `docs/CODE-REVIEW.md` requires immutable base and candidate SHAs for reviews and limits reviewer fan-out to independent coverage.
- `docs/ORCHESTRATION.md` keeps a user-requested audit, review, or summary in the root when the evidence fits one direct read or a single continuous trace.
- Synced latest `main` into the candidate without conflicts. The sync included no changes to either reviewed document.

## Review outcome

The changes make the review scope reproducible and discourage redundant delegation without removing required independent reviews for cross-module, persistence, migration, or high-risk implementation work. The wording is consistent with the project’s documented review contract. No actionable issues found.

## Verification

- Candidate diff reviewed against the synced `main`.
- Documentation formatting and relevant documentation tests: pending final validation.
