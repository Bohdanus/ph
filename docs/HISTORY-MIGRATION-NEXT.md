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

At the 2026-11-07 checkpoint, local `main` is `b5df9dbc`; `origin/main` and `mirror/main` remain
at `e24fc2ad`. Since `3a1d4ad3`, local main advanced through the stale-sweep documentation merge;
the only change in that delta is removal of one obsolete note from `docs/FREE-COMPUTE.md`. The
broader `e24fc2ad` to `b5df9dbc` drift includes toolbar-fit files, free-compute policy docs, a
selection-tool description, and removal of an unrelated resolved handoff entry and stale local-model
note. None of these commits changes history replay, compositor, renderer, export, or the
crop-history fixture. This candidate has been rebased onto local `main` at `b5df9dbc`; its current
merge base is that exact commit. The local rebase is not a remote update. Before landing, recheck the
live main SHA and tree, candidate ancestry, repository state, and ownership; this task does not
include a remote push.

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

The transformed-raster opacity/blend fixture uses opacity `0.58` and `multiply`. Its raw tight
bitmap bytes, premultiplied tight pixels, bounds, dimensions, opacity, and blend metadata match in
the HTML and OffscreenCanvas comparisons at the affine and fractional-frame cursors. The direct
durable composite also matches the legacy composite exactly. A temporary diagnostic observed 42
differing channel bytes at the affine cursor and 46 after the fractional frame in the runtime
projection and durable export path over the opaque backdrop, but those paths are not yet asserted by
a committed fixture; treat the counts as exploratory until that test is added. The earlier 146-byte
isolated-layer comparison over transparency is not a valid blend-mode oracle. Retained operations
therefore remain outside the renderer parity gate. The export candidate uses the same conservative
eligibility check and keeps legacy records for any unsupported source, retained operation, metadata
mismatch, missing or extra legacy layer, or changed bounds. The compositor materializes visible layers only,
so any hidden layer forces PSD export to keep legacy records; after composition, actual materialized
bounds are checked before durable records are selected. This does not admit frame-changing commits
or alter logical history authority.

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
   mismatch or the wider frame matrix. The transformed raster with opacity `0.58` and `multiply`
   retains exact raw materialized pixels and metadata, and its direct durable composite is exact,
   but the runtime projection and durable export path differ from legacy over the opaque backdrop.
   Keep retained operations out of both gates until the next proof slice establishes exact parity
   through runtime projection, PNG, and PSD. Do not promote `SET_DOCUMENT_FRAME_ACTION` to durable
   publication.
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
3. Continue parity-only work with the transformed raster opacity/blend discrepancy as the next
   bounded slice. At the affine cursor and after the fractional frame, compare legacy rendering,
   `projectDurableRender()`, `renderExportCanvas()` using `durableExportRecords()`, and PSD layer plus
   composite pixels over the same opaque backdrop. Keep separate assertions for raw source pixels,
   tight bitmap bounds/dimensions, alpha and premultiplication, opacity/blend metadata, and the
   composed output; do not use a transparent multiply result as the oracle. Pin the temporary 42/46
   byte observation by asserting those production paths, or correct the measured result if the
   differential does not reproduce. Require exact byte equality with no tolerance. Trace any
   difference to materialization, retained-affine composition, or the standard layer/export renderer
   before changing production code. Preserve bitmap leases and release assertions. The current
   fallback must continue selecting legacy records for retained operations, hidden PSD layers, and
   replay/legacy layer sets or materialized bounds that do not match the legacy record.

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

## Validation Evidence

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

The immediate implementation target is transformed-raster opacity/blend output parity and the
legacy export fallback described above. After exact PNG, PSD, and runtime proof for that fixture,
continue the broader fractional-frame matrix and source-backed import/replacement ownership as
separate gates. Only after every presentation surface has explicit identity, coverage, freshness,
lease, preview, and fallback proofs should durable replay be considered for logical undo/redo
authority. The current `HistoryItem[]` and `replayHistory()` authority remains unchanged.
