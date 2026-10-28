# History Migration Next Steps

This is the restart guide for the durable-history migration. `docs/HISTORY-MIGRATION.md` remains the
architecture map; this file records the live gates and the next bounded proof slice. The status
contract and subsequent renderer work have already landed on `main`, so the original migration
branch's landing instructions and validation counts are historical. The validation evidence below
is for this review closeout.

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
- A blocking enabled-entry diagnostic returns `partial` with no publishable document or cursor map.
  The converter may expose an exact prefix through `safePrefix`, whose assets use an independent
  owner and whose `release()` must be called by the diagnostic consumer. StoreContext releases it
  immediately and keeps partial state out of every exact projection path.
- Empty legacy timelines accept append cursor `0`; the append validator rejects only negative,
  non-integer, or out-of-range positions. The first crop/edit can therefore produce a `current`
  durable document without an opening baseline row.
- Legacy `HistoryItem[]` remains logical authority. Durable navigation is a staged presentation
  projection with legacy fallback, not a completed undo/redo authority cutover. Supported committed
  eligible append/reorder transitions also compose a durable presentation in the background, but keep
  the already-visible legacy selector active while composition runs so transient previews are not
  blocked. Source-backed imports/replacements and frame-changing commits remain legacy until their
  ownership or frame-parity gates are explicit.

## Loose Ends

1. **Authority cutover.** Legacy `HistoryItem[]` remains logical authority. Durable navigation is a
   staged presentation projection, and eligible committed append/reorder presentation composes in
   the background. Source-backed imports/replacements and frame-changing commits remain on the
   complete legacy path. Live previews also keep the complete legacy layer base until they clear;
   the preview tests pin that interleaving behavior but do not make preview a durable authority
   surface. Keep the existing identity, coverage, freshness, lease, fallback, and failure gates.
2. **Presentation parity.** Keep the byte-level durable/legacy parity gates. The browser differential
   covers two retained affine layer transforms across two successive non-quarter frame transforms
   with fractional origins and extents, including exact per-layer bounds and pixels at each tested
   affine or frame-transition cursor and a frame-only control. A styled, bold-italic serif paragraph also passes through a retained
   affine and a two-frame sequence with exact per-layer comparisons. A three-transition mixed-source
   frame sequence applies two sequential retained affines to an opaque blank, one retained affine to a
   45%-opacity blank, and one each to vector, paint, and point text, comparing exact per-layer bounds,
   bitmap dimensions, and pixels at all six affine cursors and after each frame transition. These
   fixtures close only their listed combinations: other transform combinations, angles, text
   styling/rotation variants, other blank opacity values, and exact fractional
   bounds across the wider source matrix remain open. An exploratory mixed-source fractional-frame
   variant passed per-layer checks but its first composite transition differed at canvas pixel
   (5, 26), with legacy red/alpha 188/122 and durable 190/121. Do not publish
   frame-changing commits durably until the full frame gate is explicit.
3. **Selection baseline.** `deriveSelectionBaseline()` must remain unbounded over the whole
   timeline. The selection undo tests are load-bearing tripwires.
4. **Status UI coverage.** Dev status, ErrorBoundary fallback, and structured diagnostics now
   accept `partial`; keep the exhaustive status record test when adding states.

## Recommended Sequence

Steps 3 and 4 are independent open gates. Their numbering organizes the work; it does not set a
priority or dependency. They may be pursued in either order or in parallel.

1. Keep `safePrefix` diagnostic-only and release its independent owner at every consumer boundary;
   never let `partial` satisfy an exact projection gate.
2. Preserve the now-tested refusal behavior: `resetHistoryTo.durable.test.tsx` proves a refused final
   durable draw restores the StoreProvider timeline. Keep preview rendering on the complete legacy
   layer base while append composition is pending or accepted, then reveal the durable base only
   after the preview clears; `useLayer.render.test.tsx` pins accepted and refused append cases, and
   `e2e/undo-redo.spec.ts` pins live Brush preview pixels while durable status is current.
3. Continue parity-only frame work. The raster fixture in `e2e/crop-history.spec.ts` covers two
   retained affine layer transforms and two successive non-quarter frame transforms with fractional
   origins and extents. It asserts exact per-layer bounds and pixels at each cursor and frame-only
   control, and byte-identical composites. A styled paragraph-text fixture covers its retained
   affine cursor plus a two-frame sequence with exact per-layer bounds and pixels. The mixed-source
   three-transition fixture applies two sequential retained affines to an opaque blank, one retained
   affine to a 45%-opacity blank, and one each to vector, paint, and point text, then checks exact
   per-layer pixels, bounds, and bitmap dimensions at all six affine cursors and after each frame
   transition. A fractional-frame probe of this mix preserved per-layer parity but found a one-pixel
   composite mismatch at the first transition; investigate it before broadening fractional coverage.
   These fixtures close only their listed combinations. Next cover the
   open angles, additional retained-affine combinations, other text styling/rotation, blank opacity
   variants, and exact fractional materialized bounds across the wider source matrix. Keep
   `SET_DOCUMENT_FRAME_ACTION` out of durable publication until that matrix is explicit; add
   cursor checks without changing publication, cursor, or lease ownership.
4. Establish source-backed import/replacement ownership and parity as the other independent gate.
   Keep the unsupported-source refusal explicit, and do not treat either gate's passing differential
   as authority to promote that surface.
5. Only after every surface has explicit identity, coverage, freshness, lease, preview, and fallback
   proofs, decide whether durable replay can become logical undo/redo authority. Retire boundary
   tests for deleted coordination modules only in the same architectural change that replaces their
   contract.

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
- Conditional follow-up from `HANDOFF.md` §94, not an immediate gate: durable replay applies a frame
  operation's `next` and does not read stored `previous`. If a replay consumer starts reading
  `previous`, track the last durable-reachable frame separately and update the named diagnostics
  tests; do not remove the deliberate fold advance in `legacyHistoryToDurable()`.
- Operations without a canonical snapshot no-op proof are conservatively treated as state-changing
  when duplicated. That may withhold a durable shadow, but it cannot publish a false-current render;
  add operation-specific proofs before relaxing the gate.
- Do not implement a full durable authority cutover as a cleanup of legacy code. It is an
  architectural migration requiring independent parity and ownership evidence.
- Open-source editor history designs are comparative patterns, not Photoshop requirements or an
  ordering decision for this migration. [GIMP's image undo code](https://github.com/GNOME/gimp/blob/master/app/core/gimpimage-undo.c)
  transfers entries between separate undo and redo stacks and groups weak operations.
  [Krita's undo-store interface](https://raw.githubusercontent.com/KDE/krita/master/libs/command/kis_undo_store.h)
  separates command storage from adapter behavior, including
  [strokes whose command has already executed](https://raw.githubusercontent.com/KDE/krita/master/libs/image/kis_post_execution_undo_adapter.h).
  [darktable's pixelpipe guide](https://github.com/darktable-org/darktable/blob/master/dev-doc/pixelpipe_architecture.md)
  describes rebuilding module state by replaying history through its cursor. These examples support
  keeping timeline state, command execution, and preview presentation explicit, but do not define
  this app's gates.

## Validation Evidence

- The original `fix/history-migration-20261014` validation counts are not current-main evidence and
  are omitted here.
- `npm run tsc` passed after the review follow-up.
- `npm run lint:check` passed; it reported 64 warnings outside the changed files.
- The targeted headless E2E `a retained layer transform matches legacy before and after a later frame
transform` passed in run `2026-10-26T18-52-14-027Z-4251` after adding the frame-control assertion.
- No durable publication or logical authority behavior changed in this branch. A passing parity
  test closes only the fixture's listed cursors and inputs; it does not close the general frame or
  source-ownership gates.

## Review Findings and Dispositions

- Cross-system Kilo, Codex, and Copilot history scans found no additional migration step or ordering
  decision. The relevant Kilo history confirms preview and refused-draw evidence is test coverage;
  it does not change logical authority. Keep the frame matrix and source-ownership gate independent.
- Review coverage: Luna 6 read-only review and follow-up, plus three focused review passes using
  `poolside/laguna-s-2.1:free` through Kilo's completion-only fallback. This Codex host has no
  verified free tool-using subagent route, so those three passes were not tool-using subagents.
- A review found the parity checks could pass if both renderers dropped the affine transform. The
  fixture now compares each renderer against the untransformed baseline at the transform cursor and
  checks that each final render differs from its frame-only control.
- Luna's re-review found that the control's durable frame was not asserted before comparing pixels.
  The fixture now requires the control's durable frame to match the transformed case's legacy frame.
- Review noted that numbering the frame and source-ownership gates implied an order despite the docs
  saying they were independent. Steps 3 and 4 below are now explicitly unordered and may proceed in
  either order or in parallel.
- Luna's final follow-up found no remaining actionable issues in the fixture or updated sequence.
- Reports that composite release was missing or that replay cursors were offset did not reproduce
  when checked against the shared `finally` block and inclusive `replayHistory` cursor loop.
- Exact fractional bounds across the wider frame and source matrix remain unproven. The mixed-source
  fixture pins exact bounds for its listed integer-origin frame cases; a fractional-frame probe keeps
  per-layer bounds and pixels exact but differs in its first composite transition by one pixel. The
  raster and styled paragraph-text fixtures cover fractional frame origins and extents.
