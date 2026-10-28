# History Migration

This document owns the durable-history migration requirements, sequencing, and
decision record. It is the implementation contract for the migration; current
code facts remain in [`ARCHITECTURE.md`](ARCHITECTURE.md), and open defects
remain in [`../HANDOFF.md`](../HANDOFF.md).

## Authority

The legacy `HistoryItem[]` timeline remains the logical authority. Navigation and
eligible committed append/reorder transitions stage a complete durable render
projection beside the legacy logical layers; `renderSelector` holds the
pending/durable/legacy canvas authority, while export consumes its own guarded
durable projection. Logical undo/redo remains legacy-authoritative. Append and
reorder keep the already-visible legacy selector active while composition runs,
so transient previews do not wait behind durable publication. `durableDocument`
is a mounted presentation projection as well as the durable state model. The
migration is not complete until one replay/materialization authority feeds undo,
redo, navigation, render, export and history-panel state without a second logical
state writer.

The durable model is not disposable scaffolding. Its action log, typed layer
sources, asset registry, immutable operation cloning, and append boundary are
the target architecture. The safe path is to complete and prove it before
changing production authority, not to keep two renderers indefinitely.

## Requirements

### RQ-1: actions, not bitmap snapshots

History entries must carry replayable tool arguments and references to external
raster assets, not a new bitmap for every edit. This is already true for normal
tool commits through `createHistoryItem()` and `ToolArgs`. It is not yet true for
all document-source carriers: the legacy `documentSource`, image layer sources,
and merge arguments can retain raster payloads. Imported and intentionally
rasterized pixels must be owned by the document-scoped asset registry and
addressed by identity; they must not be duplicated into the timeline.

### RQ-2: lossless correction

Editing an existing text or shape layer must edit its source arguments rather
than create a replacement layer and leave the old one behind.
`DurableLayerPropertyPatch` still deliberately omits `source`, so the
capability needs its own operation: `create-layer` and `merge-document` carry
complete layer snapshots, while the property, position, order, filter, affine,
raster-processor, frame, document-transform and selection operations change
something other than a layer's arguments.

**The authorized operation has landed and is named.** `replace-layer-source`
carries a `layerId`, an `EditableDurableLayerSource` and the layer's `pos`, and
`source` and `pos` travel together deliberately: a source edit re-measures the
layer box, so a legacy entry that moved both must produce ONE operation or the
legacy-to-durable cursor map grows by two for one edit. `DurableOperation` holds
thirteen kinds. The operation is derived by `deriveReplaceLayerSourceEntry()`
(`history-adapter.ts`), reached from `legacyHistoryToDurable`, planned at the
append boundary (`history-append.ts`), replayed by the `'replace-layer-source'`
case in `durable-replay.ts`, and deep-frozen by `cloneOperation`
(`history-model.ts`). Its retained operations deliberately survive a source
rewrite, so a live filter or transform is not dropped when the text is retyped.

**What the requirement still owes.** `CurrentToolProvider` now rehydrates matching
text and vector source arguments from the durable navigation document while
protecting pending text and active gestures; saved settings remain the fallback
for unsupported sources. The affine-resampling divergence found by the pixel differential
is fixed; the remaining differential obligations are listed under Sequencing.
Nested `args.enabled` remains action payload rather than a history gate; this
legacy-compatible behavior is pinned by `history-adapter.branches.test.ts`.

### RQ-3: bounded replay with explicit permission

Replay cost must be measured. When replay exceeds a user-facing budget, the app
may offer a choice, but it must never rasterize automatically. Acceptance must
be explicit and transactional: publish a safe raster baseline first, preserve
the visible document on failure, release old assets only after publication, and
make the resulting history state undo-safe. The empty-history case must not
leave a History-panel row whose disabled action blanks the document.

The budget is a user setting, not an architecture constant. The repository has
no recorded override for this requirement; agents must not invent one or write
`OVERRIDES.md`.

The earlier proposal for an automatic `rasterize-layer` escape hatch — one more
durable operation, whichever number it would have taken — is superseded.
`DurableOperation` now holds thirteen kinds: eleven from the finalisation audit,
the authorized `replace-layer-source`, and `transform-document` for atomic rotated
crop replay. The source-edit operation preserves editable text and shape sources;
the document transform stays behind the frame-presentation gate until its browser
pixel parity is proven. Count the union in `history-model.ts`, not from this
sentence.
The count is also derived by `history-model.reachability.test.ts`'s
`it('declares exactly the kinds the DurableOperation union declares')`, rather
than by a hand-written list that could miss a newly added kind.

### RQ-4: one replay authority

The final state has one logical replay authority. Runtime rendering, export,
undo, redo, navigation, and history-panel state must agree. During migration,
legacy-versus-durable differential checks are allowed; shipping two authorities
is not.

The retired coordination gate forbids production imports of `replay-budget.ts`,
`replay-coordinator.ts` and `replay-checkpoints.ts` by name.
`replay-coordinator.ts` and `replay-checkpoints.ts` were deleted as dead code —
nothing imported them outside `__tests__` — and the gate keeps both names rather
than dropping them with the files, so reintroducing either is reported rather
than silently absorbed. Production materialization has one runtime consumer,
`durable-compositor.ts`; `durable-render-projection.ts` imports only the
`MaterializedLayer` type. `StoreContext.boundary-gates.test.ts` pins both
source-level import sites. The compositor is mounted for navigation presentation
and its `tmpCanvas` is already consumed by render and export. The remaining
cutover surfaces stay legacy-authoritative until their differential and ownership
gates pass.

### RQ-5: Photoshop fidelity follows the precedence ladder

Adobe documentation decides Photoshop behaviour. Repository docs decide this
code's current and required behaviour. A deviation requires an operator-written
entry in `docs/OVERRIDES.md`; difficulty, uncertainty, and an agent's proposed
fallback are not overrides.

## Tool reachability consequence

Burn, Sponge, Dodge, Smudge, Clone Stamp, Gradient, Eraser, and Fill still
refuse a bedrock layer through their tool-area enabled predicates and
`usePaintStroke()`'s disabled path. New and opened documents start with one
bedrock layer, and the desktop Layers panel now exposes an explicit conversion
action for a lone bedrock record. Their pixel kernels and generic durable
`apply-raster-processor` representation are not the blocker.

The implemented product path is Photoshop's editable-layer conversion model:
`convertBedrockLayer()` records a deliberate conversion through the existing
history boundary, and the existing non-bedrock gate continues to protect the
backing image. Do not auto-merge from a refused pointer gesture.
`mergeAllLayers()` remains a separate explicit Flatten-like command. Relaxing
the bedrock gate or requiring flatten before every tonal edit would be a product
deviation and cannot be implemented without an operator decision.

The first implementation slice deliberately supports a lone bedrock layer. It
reuses the existing `NEW_LAYER_ACTION` boundary rather than Flatten: naming the
bedrock layer's own id makes `replayHistory`'s create arm replace the record
instead of adding a second one, so the panel keeps its row, `activeLayerId`
stays valid, and an undo rebuilds the backing layer from the document's first
entry. The durable shadow derives the same `create-layer` operation from the same
entry. `pos` is copied verbatim and the document frame is never touched, which is
what preserves the pixels.

It refuses to flatten a multi-layer stack, and `convertBedrockLayer()` names why
in its own doc comment: both layer constructors place a created layer at
`maxOrder + 1`, so converting under any other layer would stack an opaque copy of
the whole frame on top of it and do so identically on every replay. Atomic
multi-layer Background conversion is therefore a separate requirement, and it is
sharper than "a source-replacement requirement": `replace-layer-source` admits
only `EditableDurableLayerSource`, so it deliberately cannot carry the raster a
Background conversion needs. Widening the action needs a raster-admitting
variant or an equivalent atomic history action.

## Sequencing

1. Record the operator rulings below and make the requirements document part of
   the tracked architecture map.
2. Keep every currently appendable durable operation replayable without changing
   production authority. The runtime retained-operation boundary, the supported
   raster append path and the navigation presentation mount are closed, and the
   §87-§89 append-boundary defects are fixed. The reproduced source-backed create
   after moving the same layer to the bottom twice is covered by
   `StoreContext.durable-append.test.tsx`. The regression checks the sparse
   orders, created name and order, and durable-document equality against full
   legacy conversion. This closes that reproduction only; it is not proof of
   durable authority for unrelated operation shapes.
3. The source-edit durable slice is in: `replace-layer-source` is derived,
   planned, replayed and cloned. Logical replay parity, history-panel parity, the
   browser authority seam, options-bar rehydration, and the pixel/export
   differential now exist alongside it. The production `durableExportRecords()`
   adapter is exercised by the cursor matrix, and FileProvider coverage proves
   raster/PSD routing, refusal fallback, stale fallback, and exactly-once release.
   Unsupported-source fallback is now pinned at the StoreContext publication seam.
   The browser seam's raster/blank forced durable-publication case is pinned by
   `e2e/undo-redo.spec.ts`, and nested `args.enabled` parity is pinned by
   `history-adapter.branches.test.ts`; vector and broader text pixel gaps remain proof gaps,
   not permission to weaken the authority gate.
4. Preserve the explicit bedrock conversion UX and its history operation while
   keeping merge/flatten explicit and separate from a tool gesture.
5. Measure replay and build the cooperative, manually accepted slow-replay path
   only after the empty-history and transactional-baseline invariants are safe.
6. Keep the staged durable projection as the authority for supported runtime
   presentation and both raster/PSD export paths. Ownership checks, production
   adapter parity, and atomic failure fallback are closed; supported committed
   eligible append/reorder presentation now composes in the background with legacy
   as the immediate selector; source-backed imports/replacements and frame-changing
   commits remain legacy until their ownership or frame-parity gates are explicit. A
   rotated crop is one `SET_DOCUMENT_FRAME_ACTION` with a `transform-document` durable
   operation, and legacy plus durable logical replay both transform every extant layer.
   `e2e/crop-history.spec.ts` proves the real raster result and one-step undo/redo, but
   publication intentionally remains legacy. Direct browser differentials now prove byte-identical
   legacy/durable composition for a 90-degree single-raster crop (exact `0,0,64,64` materialized
   bounds), a non-quarter 37-degree crop with two differently positioned raster layers, Arial point
   text, serif paragraph text, non-centered right-aligned monospace point text, blank, vector-shape,
   and Draw paint sources. A three-transition mixed-source case checks each durable cursor against
   the matching legacy frame: 37-degree transform, frame-only transition, then -17-degree transform.
   The text cases exercise left, center and right alignment; the rotated fixtures use non-zero frame
   origins. Exact quarter-turn matrices prevent floating trigonometric residue from expanding the
   pixel grid. Within this source/tool matrix, only the 90-degree fixture pins exact materialized
   bounds; the other cases assert byte-identical pixels and materialized-layer presence. The
   retained-affine fixtures below separately pin exact per-layer bounds for their listed raster and
   styled-text combinations.
   These fixtures close only their listed cases, not the frame gate: other angles and source/tool
   variants, additional text styling/rotation combinations, other frame sequences and the full
   retained-affine operation surface still need parity proof. Previews and unsupported documents
   still use the complete legacy compatibility path.
   Unsupported-source fallback is pinned by the StoreContext publication seam. Preview safety is
   also pinned at the renderer boundary: while a preview is live, `drawAllLayers` receives the
   complete legacy layer base; accepted append publication reveals the durable base only after the
   preview clears, and a stale/refused append keeps the complete legacy base. The refused-final-draw
   rollback is covered through the real StoreProvider by `resetHistoryTo.durable.test.tsx`, while
   `e2e/undo-redo.spec.ts` checks live Brush preview pixels on a current durable document and pixel
   preservation at commit. These close the preview-interleaving and timeline-compensation proofs;
   previews remain a legacy presentation surface and these tests do not authorize a logical
   authority cutover.

   The retained-affine/frame proof now covers two transformed raster layers across two successive
   non-quarter frame transforms with fractional origins and extents, checking exact per-layer bounds
   and pixels at both affine cursors, both frame cursors, and a frame-only control. A separate styled
   paragraph-text fixture checks its affine cursor and two frame cursors against exact per-layer
   bounds and pixels. Both fixtures also require byte-identical composites, and their frame-only
   controls pass with zero differing bytes. These listed cases do not close the frame gate. Do not
   add frame-changing commits to durable publication from these cases alone. Continue across the
   remaining angles, retained-affine combinations, source/tool variants, text styling/rotation,
   frame sequences and exact fractional materialized bounds across the wider source matrix. Establish ownership and parity
   for source-backed imports/replacements as a separate, unordered gate; it may proceed before,
   after, or in parallel with the broader frame matrix. Keep the unsupported-source fallback
   explicit.

   Adobe distinguishes a layer transform, which leaves other layers in place, from image rotation,
   which reorients every layer at once ([rotate a layer](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/transform-manipulate-layers/rotate-a-layer.html),
   [rotate or flip entire images](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/rotate-or-flip-entire-images.html)).
   The browser differential checks this app's two history operations against each other; it is not
   an independent pixel oracle for Photoshop.

## Operator rulings

Recorded 2026-10-03 from the operator's direct answers. These are architecture
decisions, not Photoshop overrides, and are intentionally not encoded in
`OVERRIDES.md`:

- **Source edit:** authorized one typed durable source-edit operation for
  lossless text and shape post-editing. Its legacy consumer, durable replay,
  and options-bar rehydration must land as one behavior slice.
- **Authority gate:** durable materialization is the eventual single production
  authority. The transfer is staged surface by surface: each surface must pass
  its differential, ownership, and failure gates before its legacy reads are
  removed. During parity, legacy replay is an explicit compatibility fallback,
  not a second normal authority, and a publication must never mix durable and
  legacy presentation for one document.
- **Bedrock UX:** use an explicit Photoshop-faithful Layer-from-Background or
  equivalent conversion action. Keep the bedrock refusal, do not auto-flatten,
  and do not silently relax the gate.
- **Replay budget:** make the budget configurable, measure replay cooperatively,
  and require explicit user acceptance before any raster baseline is created.
  No automatic rasterization is permitted.

Recorded 2026-10-08 from the operator's direct answers. These decisions extend
the authority gate above and are architecture decisions, not Photoshop
overrides; they are intentionally not encoded in `OVERRIDES.md`:

- **History-panel identity:** durable history must preserve the exact labels the
  panel uses today. Durable entries therefore need stable action provenance or
  display metadata; deriving labels from `DurableOperation.kind` alone is not
  accepted because it collapses rename, show, hide, opacity and other distinct
  actions into one property operation.
- **Materialization failure:** if one layer cannot be durably materialized, the
  whole durable publication is declined. The document keeps its last valid
  presentation, and no mixed durable/legacy composition is exposed.
- **Unsupported sources:** a document containing a `legacy-tool` source remains
  on the legacy compatibility path until that source has an explicit durable
  adapter. It must not be rasterized merely to bypass the authority boundary.
- **Options-bar hydration:** after durable navigation, the active layer's
  durable source arguments win when they match the active tool. Saved settings
  are fallback for a new or unsupported source, and an active preview gesture
  must never be overwritten by rehydration.
- **Export authority:** raster and PSD export transfer together through the
  durable materialized-layer projection. PSD remains the current flattened
  layer export, not a new editable-operation serializer.

## Provenance

The five-requirement decomposition comes from the latest architect synthesis
(`ses_f01bd6881ffeOsE9q6awvQNKZP`, 2026-10-03) and its cited operator history
requirements. The bedrock/tool finding comes from the burn and Sponge analysis
(`ses_efe746247ffenRtikzH1fKtUF0`, 2026-10-03), which verified the same
reachability gate across the tonal and raster family. Earlier Sponge planning
(`ses_f042cf2f8ffekDCIE3I4bf4tOk`, 2026-10-02) established that the kernels and
existing generic replay shape work on editable layers; later review corrected
its proposed panel scope and rejected an agent-authored override.

The chronological audit also records the original action-log intent
(`ses_f36a81896ffe3iD9IjJoVnPlS4`, 2026-09-22), the migration gate map and its
later corrections (`ses_f0e4972affferCVQgMzXvsM3bq`, 2026-09-30, and
`ses_f08dac9d0ffecDCBGi4vT4mOre`, 2026-10-01), and the explicit replay-budget
correction (`ses_f0242cc9bffeG7iokG7agnCnMY`, 2026-10-02). Those earlier records
are historical provenance; the operator rulings above are the active contract.
