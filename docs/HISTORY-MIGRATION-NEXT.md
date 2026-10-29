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
  blocked. Image/blank layer creates can request that presentation after asset finalization only if
  the preceding active cursor prefix passes the existing ownership and frame gates; their own
  navigation cursor remains on the legacy fallback. Shape Tool creates convert to typed vector
  entries, but remain unpublished behind the `NEW_LAYER_ACTION` ownership gate. Other tool-source
  creates, later source-backed edits, source replacements, merge and frame-changing commits retain
  their gates.

The default active UI prefix remains gated: `App.tsx` boots a blank document through
`setBlankImage()`, and `useLayer.ts` stores its initial blank layer as a `NEW_LAYER_ACTION` that the
ownership gate treats as unproven. Imported-raster baselines are gated as well. A narrow alternate
route is now verified in headless UI tests: disable the default blank History row, then either paste
a deterministic raster or add a transparent blank layer from the tablet Layers drawer. Both
appends paint from the durable cursor and preserve exact empty/composite/layer pixels in the canvas,
PNG, and PSD. Undo/redo keeps exact canvas pixels; redo uses the complete `ownership-unproven`
legacy fallback while the root stays disabled. This proves only the user-disabled-root prefix. The
default active prefix, imported-raster starts, later source-backed edits, and frame-changing commits
remain gated. Do not broaden the exception to bypass the active-prefix gate.

A Shape Tool create is now characterized on the same disabled-root route. Its durable conversion is
`current`, but its append presentation stays `unpublished` and the canvas records a successful legacy
paint because the vector source is outside the image/blank exception. The test checks the exact
transparent baseline, visible shape pixels, PNG/PSD composite and layer pixels, and exact undo/redo;
redo reports `ownership-unproven`. This is a gate test, not evidence that vector creation is eligible.

## Loose Ends

1. **Authority cutover.** Legacy `HistoryItem[]` remains logical authority. Durable navigation is a
   staged presentation projection, and eligible committed append/reorder presentation composes in
   the background. An image/blank layer create may request composition after asset finalization only
   if the prior active prefix passes the ownership and frame gates; its own navigation cursor and
   later appends still use the complete legacy fallback. A typed vector Shape Tool create remains
   unpublished and legacy-painted under its current ownership gate. Other source-backed commits and
   frame-changing commits remain on the complete legacy path.
   The image/blank exception is reachable only after disabling the default blank History row, as
   the raster-paste and tablet blank-layer tests now prove. The default active new-document prefix
   and imported-raster starts remain gated; keep those paths unproven until their baseline ownership
   is resolved explicitly. The vector test does not establish an ownership exception or authorize
   publication.
   Live previews also keep the complete legacy layer base until they clear;
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
4. Keep the image/blank create exception scoped to the current append. It may request background
   composition after asset finalization only when the preceding active cursor prefix passes the
   ownership and frame gates. The create's own navigation cursor and later appends remain on the
   current legacy fallback until the broader source-ownership proof is explicit. The typed vector
   Shape Tool create is characterized but remains unpublished; any eligibility change needs a
   separate source-ownership and whole-document parity proof. Continue import/replacement ownership
   and parity as the other independent gate; keep unsupported-source refusal explicit and do not use
   either gate's differential to promote broader surfaces.
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

## Current continuation plan

The source of truth for this migration's implementation slices and acceptance gates is
[the durable history continuation plan](../.kilo/plans/history-migration-continuation-20261027.md).
The `976a201e` sync and `3ccccba0` main pin above describe the 2026-10-28 checkpoint. Slice 1
landed on `main` on 2026-10-29 as `f723394b`, after the full unit suite, source-backed E2E,
typecheck, build, lint and read-only reviews passed. The latest plan checkpoint records its exact
parents/tree and the History-panel proof based on that landed pin. The headless E2E now proves one
bounded route: disable the default blank `NEW_LAYER_ACTION` row, then paste one supported raster
through the UI and publish its append cursor with durable presentation. It checks the empty
transparent state, exact composite and layer pixels, PNG and PSD output, then exact undo/redo pixels
while the root stays disabled. A DEV-only canvas marker is written after the renderer succeeds, so
the E2E confirms the durable and legacy repaint sources before reading their pixels. Redo correctly
takes the legacy fallback with `ownership-unproven`. This does not widen production eligibility or finish history migration;
`HistoryItem[]` and `replayHistory()` remain authoritative. Recheck live worktree ownership before
selecting Slice 2A or one Slice 2B family, as recorded in the plan.

The tablet blank-layer case extends the same disabled-root route through the mobile Layers drawer.
It requires a successful durable paint at cursor 1, exact transparent canvas/PNG pixels, exact PSD
composite and blank-layer pixels/bounds, then exact undo/redo pixels with the root still disabled.
The existing raster case covers deterministic clipboard paste on the same prefix. Both check the
DEV-only paint source/cursor after renderer completion; redo remains the complete
`ownership-unproven` legacy fallback. These tests demonstrate only this reachable prefix and do not
change any production publication gate.

The latest history-migration landing on actual local `main` remains `730339e5983d42f52fe102d83d8bfd286137a6c5`, with first
parent `ce1aedec0ddc619ea92414444377f1b243bc29b9`, second parent
`080144c22157c446b75eca7d15dabce661af10ec`, and tree
`df24312c10849921d6b6ce6704dba9ccf66aed76`. The history task worktree fast-forwarded to that main
pin. `repo:state` was clean, the landing preserved the pinned tree, and the source-backed history E2E
passed all five tests.

The latest actual local `refs/heads/main` pin observed is `e87c05ff72ff895112cefdc88c9d70ca836670a1`
in `/Users/bkalynovskyi/ph/.kilo/worktrees/main-clean-20261028`; it was clean, seven commits ahead
of `origin/main`, and `repo:state` found no operation in progress. Task merge
`6d1f96eb55a00e76ccf0f575493c494433fecfe1` synced it into the history branch with a `Chat:` trailer.

The committed `ph-14` code candidate `6d1f96eb55a00e76ccf0f575493c494433fecfe1` (tree
`c6507faee604647d8aa9f7c30127dcd0d97d4f6d`) is characterization-only and does not change
production eligibility. The planner and StoreContext tests previously passed 38 tests across two
files, and the post-sync local focused E2E passed all five source-backed history cases. Full mirror
run `40885682904` tested that exact code candidate: dispatch validation, audit, E2E helper tests,
CI checks, and the skip baseline passed; all six browser shards failed on the existing crop/frame,
Small Caps, and durable-presentation suites described in the live checkpoint of
[`history-migration-continuation-20261027.md`](../.kilo/plans/history-migration-continuation-20261027.md).
All five source-backed history E2Es passed on Linux, macOS, and Windows. Artifacts are under
`test-results/remote-e2e/40885682904-1-25185df88db5435b8ca9c04747ab7c34/`.

The `ph-14` claim and eight path locks remain on the task branch. The full browser gate blocks
landing; the latest actual main is clean, but no landing merge is prepared. Do not change the
unowned failing suites or widen production eligibility without a fresh ownership check and explicit
handoff. After those failures are resolved, refresh actual main, sync any newer pin into the task
branch, rerun the full exact-candidate gate, and then follow the pinned landing procedure. Leave
vector publication, frame parity, source replacement/import ownership, authority cutover, and
replay-budget work explicitly unproven for the next slice.
