# History Migration Next Steps

This is the restart guide for the durable-history migration after the status-contract hardening
landed on `fix/history-migration-20261014`. It is deliberately problem-focused rather than a
chronological changelog.

## Current Contract

- `DurableConversionStatus` is `current | partial | unavailable`.
- `partial` means the converter saw an entry-level error diagnostic. It is diagnostic-only:
  `convertLegacyHistorySafely()` returns no durable document and no cursor map.
- `unavailable` is reserved for conversion exceptions or infrastructure failures.
- `stale` remains the StoreContext runtime-divergence state.
- `normalizeDurableProjection()`, navigation, export, reorder, append, history-panel projection,
  and tool hydration admit only `current` durable state.
- Non-reconverting reducer transitions preserve every non-current status; they cannot turn `partial`
  or `unavailable` into `stale`.
- `layer transparency` remains a legacy diagnostic label but is no longer a legal `ActionType`:
  there is no writer, durable translator, or replay arm for it.
- A duplicate history id is classified against legacy replay: state-changing enabled duplicates
  produce an error diagnostic and `partial` status, while idempotent/absent-layer duplicates and
  disabled duplicates remain warning-only because they do not change the legacy snapshot.
- `convertLegacyHistorySafely()` requires `documentId` for legacy arrays so successful asset
  conversions cannot create an unreachable random registry owner; durable-document pass-through
  still derives its identity from the document.
- Empty legacy timelines accept append cursor `0`; the append validator rejects only negative,
  non-integer, or out-of-range positions. The first crop/edit can therefore produce a `current`
  durable document without an opening baseline row.
- Legacy `HistoryItem[]` remains logical authority. Durable navigation is a staged presentation
  projection with legacy fallback, not a completed undo/redo authority cutover.

## Loose Ends

1. **Partial asset ownership.** Before retaining any prefix document or cursor mapping, determine
   whether omitted assets are still needed by legacy replay or in-flight materialization. If they
   are, add an independent owner/lease; if not, prove that and test disposal. Do not commit a
   partial document under the normal document owner without this proof.
2. **Safe prefix boundary.** Choose between exact prefix-only retention and a re-seed/replay rule
   for the suffix. A cleanly translated suffix is not safe merely because one entry was skipped.
3. **Authority cutover.** Prove append, preview, unsupported-source fallback, export, and
   history-panel behavior independently before removing legacy logical replay.
4. **Presentation parity.** Keep the byte-level durable/legacy parity gates and add a forced
   durable-publication browser seam before expanding durable authority.
5. **Selection baseline.** `deriveSelectionBaseline()` must remain unbounded over the whole
   timeline. The selection undo tests are load-bearing tripwires.
6. **Status UI coverage.** Dev status, ErrorBoundary fallback, and structured diagnostics now
   accept `partial`; keep the exhaustive status record test when adding states.
7. **Navigation atomicity.** `resetHistoryTo()` still advances logical history before staged
   presentation acceptance. A failed late draw can leave a cursor/frame that the user did not see;
   add an acceptance boundary before making durable replay logical authority.

## Recommended Sequence

1. Add a pure prefix-boundary result to the adapter without changing publication authority.
2. Design and test independent asset ownership for a retained prefix; include redo and disposal.
3. Store partial metadata separately from `durableDocument`, or keep it diagnostic-only until the
   ownership proof is complete. Never let `partial` satisfy an exact projection gate.
4. Promote one additional presentation surface at a time behind identity, coverage, freshness,
   lease, and legacy-fallback gates.
5. Only after those gates pass, decide whether durable replay can become logical undo/redo
   authority. Retire boundary tests for deleted coordination modules only in the same architectural
   change that replaces their contract.

## Investigation Lessons

- Reconcile every agent report against current source. Several audit claims about dead materializer
  paths, missing blend-mode handling, and append asset reconciliation were stale in this tree.
- A rejected conversion must not publish a cursor map derived from a stale suffix. Withholding the
  map is safer than claiming a partial timeline is exact.
- A type union change requires tracing reducers, export/navigation gates, diagnostics UI, fixtures,
  and exhaustive tests. The `partial` addition touched all of those surfaces.
- Duplicate-id handling must distinguish resolver-only skips from omitted edits. Keeping the fold
  advanced preserves legacy suffix derivation, but an enabled omitted operation cannot remain
  `current` merely because the raw converter can continue.
- Operations without a canonical snapshot no-op proof are conservatively treated as state-changing
  when duplicated. That may withhold a durable shadow, but it cannot publish a false-current render;
  add operation-specific proofs before relaxing the gate.
- Do not implement a full durable authority cutover as a cleanup of legacy code. It is an
  architectural migration requiring independent parity and ownership evidence.

## Validation Evidence

- History and boundary matrix: 32 test files, 945 tests passing.
- Focused status/navigation checks: 11 tests passing after the final coverage addition.
- `npm run tsc` passing.
- `npm run build` passing.
- Independent read-only reviews found no blocking issues.
- Full `npm run test` reached 8,993 passing tests with one unrelated pre-existing
  `scripts/__tests__/worktree-inventory.test.mjs` transcript-count failure.
- Full headless E2E reached 489 passing, 11 failing, and 2 skipped. The three crop-history
  undo failures reproduce on committed `main`; the other eight failures are unrelated UI/tool
  failures. Do not attribute these baseline failures to this migration branch.

The implementation commits are ready to land after `main` is merged into this branch and the
post-merge gates are rerun. Shared `main` must only receive the reviewed branch after that step.
