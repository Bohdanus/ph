# History Migration Next Steps

This is the restart guide for the durable-history migration. `docs/HISTORY-MIGRATION.md` remains the
architecture map; this file records the live gates and the next bounded proof slice. The status
contract and subsequent renderer work have already landed on `main`; the checkpoint below records
the main drift and the new evidence from this continuation.

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
  entries but remain unpublished behind the `NEW_LAYER_ACTION` ownership gate. Other tool-source
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

A Shape Tool create is also characterized on that disabled-root route. Its durable conversion is
current, but the append presentation remains unpublished and the canvas uses legacy paint because
its typed vector source is outside the image/blank exception. The headless test compares the
transparent baseline, visible rectangle, PNG, and PSD composite/layer pixels against an independent
pixel oracle, then checks exact undo/redo; redo reports `ownership-unproven`. This pins the gate,
not vector eligibility.

## Current-main drift and new renderer evidence

At the 2026-11-07 checkpoint, local `main` is `30e32ccf6efba0536525ac66a8e71e04a97889ab`.
Since the history-export landing at `659ca8ede3be5c4f05aa0d250d63d6f394964315`, main advanced
through `df1d78387` and merge `30e32ccf6`; that delta adds the migration audit and updates this
restart guide, without changing history replay, compositor, renderer, export, or the crop fixture.
This candidate is rebased onto that local main. Commit `bd5f3d29f` adds the adapter diagnostics and
`8c842c4fe` removes the two-pixel allowances from the affected frame and tight-raster assertions.
Neither changes production admission or renderer behavior. This local rebase is not a remote update.
Before landing, recheck the live main SHA and tree, candidate ancestry, repository state, and
ownership; this task does not include a remote push.

The historical `7cf69dca` affine-parity commit is not an ancestor of current main. Its behavior has
evolved in the current compositor: `3ccccba0` introduced direct affine raster composition and
`6f9aaf53` extended that route to raster and vector sources with bitmap cleanup. The exact recovered
fractional mixed-source fixture now passes byte-identical composites at all three transitions in
the tested browser environment. It uses angles `37`, `0`, and `-17` with fractional frames
`{x:4.25,y:4.5,width:55.75,height:55.5}`,
`{x:5.125,y:6.25,width:53.5,height:51.875}`, and
`{x:6.75,y:6.125,width:49.875,height:49.5}`. The old first-transition mismatch at `(5, 26)` with
legacy red/alpha `188/122` and durable `190/121` is not reproduced for this recovered fixture. Mark
that observation resolved only for these inputs and this environment; the root cause, other frame
matrices, and cross-platform parity remain unproven.

The transformed-raster opacity/blend fixture uses opacity `0.58` and `multiply`. Its premultiplied
tight pixels, bounds, dimensions, opacity, and blend metadata match in the HTML and OffscreenCanvas
comparisons at the affine and fractional-frame cursors. On macOS, 12 straight-alpha readback bytes
differ by one at each cursor; the exact premultiplied comparison remains zero. Drawing the production
Invert processor's returned OffscreenCanvas into a fresh HTMLCanvas readback yields identical bytes
for legacy and durable inputs through both source canvas paths. This pins the downstream draw/read
boundary, not raw processor backing-store identity. The direct durable composite also matches the
legacy composite exactly. The committed E2E diagnostic now
measures runtime projection, the `durableExportRecords()`/`renderExportCanvas()` result, decoded PNG,
and PSD layer plus composite pixels at both cursors. The normal admission predicate refuses the
retained `apply-affine-transform` case at the affine cursor and the retained frame-transform case
after the fractional frame. Accordingly, the test requires that refusal and records the adapter
pixels for diagnosis; these manually invoked, refused adapter outputs are not selected for product
rendering or export. On local Chrome, those diagnostics show 42 differing channel bytes in runtime,
export-canvas, and decoded-PNG pixels at the affine cursor, with zero PSD composite or layer-byte
differences. After the fractional frame they show 46 differing bytes in runtime, export-canvas, and
decoded-PNG pixels, 8 in the PSD composite, 7 in the PSD background layer, and zero in the
foreground layer. The 42/46 results are now reproduced as adapter diagnostics, not as a confirmed
product-output defect. The test requires exact zero bytes on all surfaces if the records are
admitted. The earlier 146-byte isolated-layer comparison over transparency is not a valid blend-mode
oracle. Keep retained operations outside runtime and export admission; the current product path
continues to use legacy records. Hidden layers also force legacy PSD records, and export checks
actual materialized bounds before selecting durable records. This does not admit frame-changing
commits or alter logical history authority.

## Loose Ends

1. **Authority cutover.** Legacy `HistoryItem[]` remains logical authority. Durable navigation is a
   staged presentation projection, and eligible committed append/reorder presentation composes in
   the background. A new image/blank layer create may request composition after asset finalization
   only if the prior active prefix passes the ownership and frame gates; its own navigation cursor
   and later appends still use the complete legacy fallback. Other source-backed commits and
   frame-changing commits remain on the complete legacy path. A typed vector Shape Tool create is
   characterized but remains unpublished; it does not widen the image/blank exception.
   The image/blank exception is reachable only after disabling the default blank History row, as
   the raster-paste and tablet blank-layer tests now prove. The default active new-document prefix
   and imported-raster starts remain gated; keep those paths unproven until their baseline ownership
   is resolved explicitly.
   Live previews also keep the complete legacy layer base until they clear;
   the preview tests pin that interleaving behavior but do not make preview a durable authority
   surface. Keep the existing identity, coverage, freshness, lease, fallback, and failure gates.
2. **Presentation parity.** Keep runtime and export byte-parity admission conservative. The recovered
   fractional mixed-source fixture passes exact per-layer checks and exact composites at its three
   transitions; it closes only those inputs and does not establish the cause of the older `(5, 26)`
   mismatch or the wider frame matrix. The opacity `0.58`/`multiply` fixture has exact premultiplied
   materialization and direct-composite results. macOS straight-alpha readback differences remain
   diagnostic; the production Invert processor's returned raster also matches after a fresh-canvas
   readback. The fixture adds local-Chrome diagnostics for the refused runtime/export adapters, PNG,
   and PSD. The measured 42/46 runtime/export/PNG differences and the fractional-frame PSD
   differences are not product-path failures because admission refuses those records and the app
   retains legacy rendering/export. The root cause remains unknown. Keep the
   gate closed and isolate the first differing intermediate surface before changing production code.
   The diagnostic fixture records differing-pixel document coordinates, RGBA/alpha, aggregate bounds,
   source/backdrop samples, and exact runtime/export/PNG/PSD surface bounds. Its opacity-only and
   multiply-only controls run at both the affine cursor and fractional frame. The [Linux mirror run
   for commit `0535f48d`](https://github.com/Bohdanus/ph/actions/runs/42987298464) reproduces refused
   adapter differences: runtime/export/PNG differ by 118 channel bytes (91 pixels, maximum delta 1)
   at the affine cursor and 86 bytes (69 pixels, maximum delta 1) after the fractional frame. PSD is
   exact at the affine cursor; after the fractional frame its composite differs by 51 bytes across
   15 pixels, the background layer by 39 bytes across 15 pixels, and the foreground layer is exact.
   The measured layer bounds agree. At the reported source/backdrop samples, raw source and backdrop
   values agree; tight-bitmap premultiplied pixels and the fresh-canvas Invert result are exact. The
   raw frame surfaces differ only at alpha-boundary pixels (101 bytes/91 pixels at the affine cursor,
   94 bytes/82 pixels after the fractional frame). The current candidate adds diagnostic counts and
   samples for these frame surfaces after premultiplication, for both HTMLCanvas and OffscreenCanvas
   readbacks; those new values have not yet been collected in a mirror run. Use the attached
   `framePremultipliedDifferingBytes` and `offscreenFramePremultipliedDifferingBytes` with their
   samples to check whether the raw differences persist after premultiplication. A zero result would
   support straight-alpha readback variation for these surfaces and inputs; nonzero differences need
   coordinate and boundary analysis. Keep the gate closed and test the
   transparent-backdrop and direct frame-surface-copy versus tight-bitmap-placement controls.
   Check operation order and intermediate alpha/premultiplication around
   `drawEvaluatedPresentation()` and `renderExportCanvas()`; `durable-compositor.ts` explicitly
   disables image smoothing on its composition path, so smoothing is not an established explanation.
   Investigate the fractional PSD discrepancy separately by comparing legacy and durable background
   raster bytes before encoding at identical integer bounds, then check layer placement relative to
   the fractional frame and decoded layer versus composite pixels. Require exact zero at runtime,
   PNG, and PSD before considering an admission change; keep `SET_DOCUMENT_FRAME_ACTION` out of
   durable publication.
3. **Selection baseline.** `deriveSelectionBaseline()` must remain unbounded over the whole
   timeline. The selection undo tests are load-bearing tripwires.
4. **Status UI coverage.** Dev status, ErrorBoundary fallback, and structured diagnostics now
   accept `partial`; keep the exhaustive status record test when adding states.

## Recommended Sequence

The immediate parity slice is step 3: prove the transformed raster through runtime projection,
PNG, and PSD. Source-backed ownership in step 4 remains an independent open gate; the numbering does
not impose a dependency between them.

1. Keep `safePrefix` diagnostic-only and release its independent owner at every consumer boundary;
   never let `partial` satisfy an exact projection gate.
2. Preserve the now-tested refusal behavior: `resetHistoryTo.durable.test.tsx` proves a refused final
   durable draw restores the StoreProvider timeline. Keep preview rendering on the complete legacy
   layer base while append composition is pending or accepted, then reveal the durable base only
   after the preview clears; `useLayer.render.test.tsx` pins accepted and refused append cases, and
   `e2e/undo-redo.spec.ts` pins live Brush preview pixels while durable status is current.
3. Continue parity-only work with the transformed raster opacity/blend fixture. Exact premultiplied
   materialization, downstream Invert readback, and direct-composite assertions pass locally;
   straight-alpha source readback differences remain diagnostic because they map to identical
   premultiplied pixels. The Invert check pins a fresh-canvas consumer readback, not raw OffscreenCanvas
   backing-store identity. Adapter measurements are intentionally diagnostic because the normal gate
   refuses retained operations.
   Run the mirror fixture with the new premultiplied frame diagnostics and use its
   document-coordinate pixel samples, source/backdrop RGBA, exact bounds, and
   opacity-only/multiply-only controls at both cursors to identify the first meaningful divergence.
   Compare the direct original-source draw, materialized bitmap at matching frame-grid coordinates,
   and projected-record draw. Hold canvas type, transform, clipping, layer order, and destination
   constant; next compare an opaque versus transparent backdrop and a direct frame-surface copy versus
   tight-bitmap placement, changing one condition at a time. Inspect intermediate
   alpha/premultiplication and operation
   order; preserve the explicit `imageSmoothingEnabled = false` setting rather than attributing the
   result to filtering without evidence. For PSD, isolate the legacy and durable background-layer
   bytes before encoding at `savePsd()`'s equal integer bounds, inspect `left`/`top`/width/height
   against the fractional frame, then compare PSD layer and composite pixels separately using the
   same quantized opacity. Do not use PNG as the PSD pixel oracle. Keep separate exact
   assertions for source pixels, materialized premultiplied pixels/bounds/dimensions,
   opacity/blend metadata, runtime pixels, PNG pixels, PSD layer pixels, and PSD composite pixels.
   Require zero differing bytes
   without tolerance before proposing any admission change. Preserve bitmap lease and stale-completion
   release assertions. The current product path must continue selecting legacy records for retained
   operations, hidden PSD layers, and replay/legacy layer sets or materialized bounds that do not
   match the legacy record.

   Do not change production rendering until these comparisons identify the first divergent boundary.
   If the evidence shows direct source drawing is required, consider a narrowly scoped durable
   presentation record that retains a leased immutable source and its affine operations while
   keeping the materialized bitmap for layer and export consumers. That design would need explicit
   source identity and generation, full visible-layer coverage, cancellation and stale-result
   rejection, one-time release on replacement or failure, and whole-document legacy fallback when
   any source cannot be resolved. Prove runtime, PNG, PSD layer, and PSD composite pixels
   independently with exact equality before considering admission. Do not allocate a full-document
   bitmap per layer.

   Once that slice is exact, broaden the fractional frame matrix across open angles, additional
   retained-affine combinations, text styling/rotation, blank opacity variants, and fractional
   materialized bounds for each source family. Keep `SET_DOCUMENT_FRAME_ACTION` out of durable
   publication until that matrix is explicit; add cursor checks without changing publication, cursor,
   or lease ownership. Frame parity and source-backed import/replacement ownership remain independent
   gates.

4. Keep the image/blank create exception scoped to the current append. It may request background
   composition after asset finalization only when the preceding active cursor prefix passes the
   ownership and frame gates. The create's own navigation cursor and later appends remain on the
   current legacy fallback until the broader source-ownership proof is explicit. Preserve the shared
   bitmap lifetime proofs in `src/contexts/__tests__/layer-presentation.test.ts` and
   `src/contexts/__tests__/StoreContext.retirement.test.tsx`: a cross-document bitmap remains live
   until its last owner releases it, and same-id replacement retires against the replacement record.
   Continue source-backed import/replacement ownership and parity as the other independent gate; keep
   unsupported-source refusal explicit and do not use either gate's differential to promote broader
   surfaces.
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
  Other primary-source implementations differ on redo-tail and failure ordering:
  [miniPaint's action state](https://github.com/viliusle/miniPaint/blob/master/src/js/core/base-state.js)
  executes a new action before pruning redo, while
  [Pinta's document history](https://github.com/PintaProject/Pinta/blob/master/Pinta.Core/Classes/DocumentHistory.cs)
  prunes before appending; [LazPaint's image history](https://github.com/bgrabitmap/lazpaint/blob/master/lazpaint/image/uimage.pas)
  clears its history when replay fails, whereas
  [Pikado's snapshot history](https://github.com/koneb71/pikado/blob/main/src/core/history.js)
  advances its cursor before restoring a snapshot. These differences are implementation analogies,
  not Photoshop requirements or a contract for this migration. Keep the repository's branch,
  replay-failure, rollback, and ownership tests as the authority for local behavior.

## Prior Validation Evidence

Implementation commit `04f95264ed20aef5168e602409b9fd253120e4ed` (tree
`8fff8d49d892febd6fabe55f128d9dd7fa33a10e4`) was validated on the local macOS checkout after
rebasing onto `main` at `b5df9dbc272e208dc04768259228e13abdad33fb`.

- Focused durable export/projection unit tests: 4 files, 68 passed.
- `npm run test:e2e:unit`: 22 files, 1,564 passed and 12 expected failures.
- Focused Chrome E2E: 2 passed (recovered fractional frame transitions and affine raster opacity/blend),
  run `2026-11-07T02-06-40-691Z-35133`.
- `npm run tsc`, `npm run build`, `npm run lint:check`, and `git diff --check` passed. Lint reported
  78 warnings and no errors; the changed implementation and E2E files pass focused ESLint checks.
- No Linux or Windows mirror run was performed. Local browser results do not prove cross-platform or
  Photoshop pixel parity, and the wider frame matrix remains open.

## Continuation Validation — 2026-11-07

This continuation was rebased onto local `main` at `30e32ccf6efba0536525ac66a8e71e04a97889ab`.
`bd5f3d29f` adds refused-adapter diagnostics; `8c842c4fe` changes the frame and tight-raster
alpha-boundary allowances to exact zero. No production source file changed.

- Focused Chrome E2E in `e2e/crop-history.spec.ts` for retained affine/frame parity and opacity/blend
  adapter diagnostics: 2 passed, run `2026-11-07T09-54-49-011Z-42015`. The adapter diagnostic
  reproduced 42 runtime/export/PNG channel differences at the affine cursor and 46 after the
  fractional frame; PSD had 0 composite/layer differences at the affine cursor, then 8 composite, 7
  background-layer, and 0 foreground-layer differences after the fractional frame. The admission
  predicate refused both cursors.
- Full `npm run test:e2e -- e2e/crop-history.spec.ts`: 19 passed, 11 failed, run
  `2026-11-07T09-49-22-961Z-26277`. The failures are toolbar-helper interactions outside the changed
  parity assertions: seven expected `tool-overflow-tile` controls were hidden, and four clicks timed
  out waiting for `tool-button-draw` or `tool-button-text`. The strict retained-layer and opacity/blend
  tests passed in the separate focused run. A full run of the same spec at base `30e32ccf6`
  reproduced the same 19 passed, 11 failed, and the same 11 failing test titles, run
  `2026-11-07T10-08-37-864Z-2500`. This confirms those toolbar-helper failures predate this candidate;
  the full spec is still not green and should be tracked separately, but they are not regressions from
  the exact-parity test changes.
- `npm run tsc`, `npm run build`, and `npm run lint:check` passed. Lint reported 78 warnings and no
  errors; Prettier formatting passed. No Linux/Windows mirror or independent Photoshop oracle was
  run. These are local macOS/Chrome results only.

## Review Findings and Dispositions

The post-sync implementation review covered commit `04f95264ed20aef5168e602409b9fd253120e4ed`
and tree `8fff8d49d892febd6fabe55f128d9dd7fa33a10e4`, based on local main `b5df9dbc`:

- The prior Luna 6 review found that export checked replay layers individually but did not require an
  exact replay/legacy layer set. This was fixed before the reviewed commit: export now falls back when
  either set has a missing or extra layer, with PNG and PSD regression cases. Luna's fresh post-sync
  follow-up found no further actionable issue and confirmed the bounds and hidden-layer PSD fallbacks.
- Four complete exact-zero OpenRouter completions reviewed the immediately preceding source tree
  `78a91e0d7721914167750a6cfecf5c82d0d4271e`: Nemotron 3 Ultra checked export admission; Liquid LFM
  2.5 checked export and E2E/docs; Cohere North Mini Code checked runtime/export freshness and
  resource release. Rebase changed no history, export, renderer, or E2E source files; the imported
  main delta only removed a stale note from `docs/FREE-COMPUTE.md`. All four returned
  `finish_reason=stop` and reported `$0` cost. A separate post-sync free attempt ended with empty or
  length-limited output and is excluded from review evidence.
- The free reviews proposed possible hidden-layer loss, a bounds-test mismatch, and composite leak or
  double-release paths. Source and tests show these are blocked: PSD with hidden replay layers uses
  legacy records, replay/legacy visibility and metadata mismatches refuse admission, the bounds test
  starts with matching legacy/materialized bounds before changing the composite, and the save handler
  releases composites in `finally` with idempotent release guards. The E2E/docs review restated the
  intentionally open runtime/export and wider frame-matrix proof; those remain explicit next steps.
- Codex had no Kilo CLI or verifiable free subagent launcher in this session, so the free reviews used
  the repository's tool-free completion runner rather than tool-using Kilo subagents. Incomplete model
  responses were not review evidence.
- A prior Luna 6 docs review correctly caught that the 42/46-byte runtime/export observations were
  presented too strongly while they were still exploratory. The current E2E diagnostic now
  reproduces those counts only by manually invoking adapters that production admission refuses; the
  docs distinguish those diagnostics from the live legacy-fallback product path. The root cause is
  still unknown, and the detailed runtime/PNG/PSD isolation sequence below remains open.

The actionable export layer-set finding is resolved. Keep the transformed-raster runtime/PNG/PSD
parity proof, broader frame matrix, and source-backed ownership as independent remaining gates.

## Chat-history reconciliation

The local Kilo, Codex, and Copilot history scan found no additional migration step or authority-order
decision. Codex's exact prompt and controlled experiment records distinguish an earlier one-alpha
materialization discrepancy at `(36, 26)`—addressed by shared frame-surface reuse—from the later
mixed-source composite observation at `(5, 26)`. The verified-free Kilo Nemotron search did not
establish that later case's root cause; focused Kilo SQLite results corroborate that the earlier
`(36, 26)` result is a different issue. Copilot Chronicle contained no usable exact transcript for
this case; the candidate session had 23 local turns marked failed, so that scan is not evidence that
no discussion occurred. The current implementation work therefore verifies the recovered
fractional fixture directly and keeps the opacity/blend export gap as the next bounded proof.

## Current continuation plan

The implementation slices and acceptance gates remain governed by the
[durable-history continuation plan](../.kilo/plans/history-migration-continuation-20261027.md).
The current-state audit and its resolved/open findings are recorded in
[History Migration Audit — 2026-11-07](HISTORY-MIGRATION-AUDIT-20261107.md).

The source audit originally recorded local `main` at
`659ca8ede3be5c4f05aa0d250d63d6f394964315`, which merges the prior main pin
`b5df9dbc272e208dc04768259228e13abdad33fb` and candidate
`e9debc96e8620c3494632aee74fad8753157b582`. Main subsequently advanced to
`30e32ccf6efba0536525ac66a8e71e04a97889ab` through documentation-only audit updates. The local
candidate is rebased on that current main and includes the exact-assertion and adapter-diagnostic
follow-ups described above. Validation recorded below is for the current candidate; no Linux or
Windows mirror was run, and the wider parity matrix remains open.

The immediate implementation target is to isolate the transformed-raster adapter differences while
retaining the legacy fallback. Only after exact runtime, PNG, PSD layer, and PSD composite proof on
the currently refused fixture should a separate reviewed change consider admission. Then continue
the broader fractional-frame matrix and source-backed import/replacement ownership as separate gates.
Only after every presentation surface has explicit identity, coverage, freshness, lease, preview,
and fallback proofs should durable replay be considered for logical undo/redo authority. The current
`HistoryItem[]` and `replayHistory()` authority remains unchanged.
