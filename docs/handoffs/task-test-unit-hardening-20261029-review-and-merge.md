# Review and merge record: test unit hardening

**Branch:** `task/test-unit-hardening-20261029`
**Reviewed source:** `b218b555f156045f59af278c43036a71f82c11df`
**Synchronized with main:** `0ebf38535f7e683b0d04acd5e11e5a38e72f33f5`

## Scope

The branch adds unit-test coverage and fixes three documentation links. It changes no production implementation. The tests cover cropped document-coordinate round trips, malformed Kilo JSONL rejection, native range-input change events, disabled unsupported transforms, full legacy history fallback, bitmap-global cleanup, hidden affine-layer compositing, and fit-scale retention when document dimensions are temporarily unavailable.

## Independent review

Three read-only free-model reviews returned no findings: Kilo Laguna S 2.1, Kilo Cohere North Mini Code, and OpenRouter Laguna S 2.1. The reviewers received the full candidate diff and current implementation excerpts; the OpenRouter review also reported file-by-file coverage. Each route reported zero cost.

## Validation

- `npm test -- --reporter=dot --silent` — 401 files passed; 11,556 passed and 215 expected failures.
- `npm run test:e2e:unit -- --reporter=dot --silent` — 21 files passed; 1,537 passed and 13 expected failures.
- `npm run tsc` — passed.
- `npm run lint:check` — 0 errors and 64 warnings; Prettier check passed.
- `npm run build` — passed.

The known intermittent unit-suite issue documented in [TEST-FLAKES.md](../../TEST-FLAKES.md) §1 remains open; this passing run does not resolve it.

The local main landing is recorded by the pinned merge commit's `Branch:` and `Chat:` trailers.
