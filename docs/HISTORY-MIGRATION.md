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
   This operation-level source-edit support does not prove the product-reachable
   `commitDirtyTool` producer's typed text edit at the StoreContext append/navigation boundary or
   its source lifetime. That producer integration and lifecycle proof remains open; the
   `REPLACE_LAYER_SOURCE_ACTION` path stays gated as `ownership-unproven` until a separate reviewed
   slice proves those behaviors.
4. Preserve the explicit bedrock conversion UX and its history operation while
   keeping merge/flatten explicit and separate from a tool gesture.
5. Measure replay and build the cooperative, manually accepted slow-replay path
   only after the empty-history and transactional-baseline invariants are safe.
6. Keep the staged durable projection as the authority for runtime presentation
   and both raster/PSD export paths only after each surface has an explicit parity
   proof. Identity, coverage, freshness and failure fallback are guarded; adapter
   parity is established only for the currently admitted no-operation layer cases.
   Supported committed eligible append/reorder presentation now composes in the background with
   legacy as the immediate selector. Image/blank layer creates also request background presentation
   after asset finalization. A Shape Tool create converts to a typed vector entry, but its
   presentation remains behind the `NEW_LAYER_ACTION` ownership gate. Other tool-source creates,
   source replacements, merge and frame-changing commits retain their independent ownership or
   frame-parity gates. A
   rotated crop is one `SET_DOCUMENT_FRAME_ACTION` with a `transform-document` durable
   operation, and legacy plus durable logical replay both transform every extant layer.
   `e2e/crop-history.spec.ts` proves the real raster result and one-step undo/redo, but
   publication intentionally remains legacy. Direct browser differentials now prove byte-identical
   legacy/durable composition for a 90-degree single-raster crop (exact `0,0,64,64` materialized
   bounds), a non-quarter 37-degree crop with two differently positioned raster layers, Arial point
   text, serif paragraph text, non-centered right-aligned monospace point text, blank, vector-shape,
   and Draw paint sources. A three-transition mixed-source case checks the durable cursor after each
   transition against the matching legacy frame: 37-degree transform, frame-only transition, then
   -17-degree transform.
   The text cases exercise left, center and right alignment; the rotated fixtures use non-zero frame
   origins. Exact quarter-turn matrices prevent floating trigonometric residue from expanding the
   pixel grid. The retained two-layer affine/frame sequence pins exact materialized bounds and
   requires exact frame and tight-bitmap equality, including alpha-boundary pixels. A
   transparent/one-alpha pair also needs adjacent samples of that same color in both neighborhoods;
   composites remain byte-identical.
   The three-transition
   mixed-source fixture pins exact bounds and checks per-layer frame and tight bitmaps exactly in
   premultiplied space. The styled-text fixture also compares tight bitmaps exactly after
   premultiplying readback color channels; alpha, frame pixels, and composites remain byte-identical.
   Premultiplication preserves the exact color values used in compositing while avoiding false
   differences from unpremultiplied canvas readback rounding.
   The mixed-source fixture also checks bitmap dimensions and
   pixels for its blank, vector, paint, and point-text layers at each affine cursor and after each
   transition. It applies two sequential retained affines to an opaque blank, one affine to a 45%-
   opacity blank, and one each to the other layers, checking per-layer bounds and dimensions at all
   nine changed cursors. The other source-only cases assert byte-identical composites and
   materialized-layer presence. The
   mixed-source integer fixture uses integer frame origins and extents. A recovered fractional
   variant now checks the exact three-transition sequence at angles 37, 0 and -17 with fractional
   origins and extents; its per-layer bounds/pixels and composites pass byte-for-byte in the tested
   browser environment. The earlier first-transition observation at `(5, 26)` (legacy red/alpha
   `188/122`, durable `190/121`) is not reproduced for this fixture. Treat only that observation as
   resolved for these exact inputs; no root cause or broader/cross-platform frame proof has been
   established. The
   retained-affine fixtures below separately pin exact per-layer bounds for their listed raster and
   styled-text combinations.
   A separate 23-degree crop fixture uses a fractional frame and two positioned raster layers. It
   passed exact legacy/durable composite, materialized-bounds, and HTMLCanvas/OffscreenCanvas layer
   pixel checks for that input. It adds one frame-matrix datapoint only; it does not exercise runtime,
   PNG, PSD, or export parity and does not close the wider frame gate. The run and exact fixture are
   recorded in [`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md).
   A separate transformed-raster fixture uses opacity `0.58` and `multiply`. Its premultiplied tight
   pixels, bounds, dimensions, opacity and blend metadata match in HTML and OffscreenCanvas
   materialization at the affine and fractional-frame cursors, and the direct durable composite
   matches legacy exactly. macOS returns 12 one-channel differences in straight-alpha readback at
   both cursors, while premultiplied pixels remain byte-identical. Drawing the production Invert
   processor's returned OffscreenCanvas into a fresh HTMLCanvas readback yields identical bytes for
   legacy and durable inputs through both source canvas paths. This pins the downstream draw/read
   boundary, not raw processor backing-store identity. The test keeps raw source samples as
   diagnostics and gates exact premultiplied pixels and readback output.
   The diagnostic fixture also inspects runtime projection,
   `durableExportRecords()`/`renderExportCanvas()`, decoded PNG, and PSD layer plus composite pixels.
   The normal admission predicate refuses the retained affine and fractional-frame cases, so these
   adapter outputs are recorded only as diagnostics and do not represent the product's selected
   render/export path. An earlier local Chrome run of the refused adapters reported runtime,
   export-canvas, and decoded-PNG differences of 42 channel bytes at the affine cursor and 46 after
   the fractional frame. The latest run-specific measurements and direct `drawImage` reproduction
   are in [`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md#direct-drawimage-reproduction--2026-11-14):
   runtime/export/PNG are 42 bytes at both cursors; fractional-frame PSD composite is 13 bytes and
   the background layer is 11 bytes across 4 pixels. PSD has zero composite/layer differences in the
   earlier run at the affine cursor; after that run's fractional frame, its composite differs by 8
   bytes, the background layer by 7, and the foreground layer by zero. The test requires the refusal
   reason and would require exact zero on every surface
   if admission were allowed. These results do not establish a product-output defect; the root cause
   remains unproven. A captured single `drawImage` call exactly reproduces the legacy source's
   8-byte/3-pixel difference when backing height changes from 46 to 47, with zero direct-replay error
   against `drawLayerSource()`. The browser's underlying backing-height effect remains unexplained;
   the restart guide records the transparent/source-bound, source-overload, all-edge, and right-edge-
   only controls. In the 64×64 diagnostic, right-only extension matches all-edge and original-source
   replay while differing from transparent padding; the 89×89 control remains exact. These results
   do not identify a browser mechanism or explain the fractional-frame PSD difference. The earlier
   146-byte isolated-layer comparison over transparency is not a valid blend-mode oracle. Retained operations stay outside runtime and export admission. The export
   preflight shares the runtime's exact layer-set and conservative source/operation/metadata/bounds
   checks, blocks durable PSD export when any hidden layer lacks materialized pixels, and checks
   actual materialized bounds before selecting durable records. Unsupported, transformed, or
   otherwise unproven cases keep legacy records. This changes neither logical history authority nor
   the closed frame-publication gate.
   Current platform-specific frame-surface measurements, the diagnostic-only alpha-neighborhood
   classifier, the opaque-backdrop control, the PSD pre-encode comparison, and the same-backing clip
   experiment are recorded in [`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md). They remain
   refused-adapter diagnostics; do not combine Mac and Linux counts or use the classifier to relax
   exact gates.
   These fixtures close only their listed cases, not the frame gate: other angles and source/tool
   variants, additional text styling/rotation combinations, other frame sequences and other
   retained-affine operation combinations still need parity proof. The blank pair and 45%-opacity case
   close only those tested settings. Previews and unsupported documents
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
   and exact tight per-layer pixels, including alpha-boundary pixels, at both affine cursors, both
   frame cursors, and a frame-only control. A separate styled
   paragraph-text fixture checks its affine cursor and two frame cursors against exact per-layer
   bounds and pixels. Both fixtures also require byte-identical composites, and their frame-only
   controls pass with zero differing bytes. These listed cases do not close the frame gate. Do not
   add frame-changing commits to durable publication from these cases alone. Continue across the
   remaining angles, retained-affine combinations, source/tool variants, text styling/rotation,
   frame sequences and exact fractional materialized bounds across the wider source matrix. Establish
   ownership and parity for source-backed imports/replacements as a separate, unordered gate; it may
   proceed before, after, or in parallel with the broader frame matrix. Keep the unsupported-source
   fallback explicit.

   The image/blank create slice is separately scoped to background publication for the current
   `NEW_LAYER_ACTION`: it is permitted only after asset reconciliation and only when the preceding
   active cursor prefix passes the ownership and frame gates. The create cursor itself still uses the
   full legacy navigation fallback. `StoreContext.source-backed-presentation.test.tsx` pins stale,
   incomplete, and failed finalization behavior; `e2e/source-backed-history.spec.ts` proves a
   product-reachable disabled-root path for raster paste and transparent blank creation with exact
   canvas/PNG/PSD pixels and legacy undo/redo fallback. The default active root remains gated.
   A Shape Tool `NEW_LAYER_ACTION` converts to a typed vector entry, but its presentation remains
   unpublished: planner and StoreContext tests prove conversion is current without invoking the
   compositor. The desktop E2E uses the real Shape Tool from the disabled opening row, observes a
   new `shape` history row and legacy-only presentation, and compares the full canvas, PNG, PSD
   composite, and PSD layer crop to an independent rectangle pixel oracle through undo/redo. That
   browser test does not inspect its `HistoryItem` payload; source emission and typed conversion are
   separate evidence. This is a characterization boundary only; it does not authorize vector-source
   publication or change logical history authority.

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

## Continuation checkpoint — 2026-11-22 00:55 UTC

This is the current continuation record. A prior inspection during this
continuation found uncommitted changes in the PH-93 worktree to
`docs/HISTORY-MIGRATION-NEXT.md`, `HANDOFF.md`, and the continuation plan; this
task branch does not include those edits. Recheck that worktree after a safe
owner handoff before refreshing its restart guidance; preserve this checkpoint
in the meantime.

### Verified source state

- The designated local `main` was clean at `3b168574e6f7e33a62347fe80e0271cde00c3807`.
  The current task branch was created from that tree. The one startup remote
  reconciliation recorded `origin/main` at
  `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; `main...origin/main` was `24 2`
  (24 commits only on local `main`, two only on `origin/main`). Do not interpret
  the tracked remote ref as proof that those two remote-only commits are in
  this checkout. No second fetch was performed during this continuation.
  A read-only local-ref check at 00:55 UTC found the same clean main SHA, the
  same `origin/main` tracking SHA, and the same 24/2 divergence; the task
  branch's merge base remains that local main SHA. This check did not fetch or
  query the live remote.
- Since history insertion-anchor landing `7892d4f82cda40d37ae3421ae30483d725a03c51`,
  local `main` advanced through the paint-docs landing to the tree above. Its
  13-file delta was paint documentation, selection/tooling, and landing-test
  work; it contains no durable-history implementation change. History
  insertion-anchor evidence remains in the ancestry.
- The earlier cross-chat reconciliation of Kilo, Codex, and Copilot is recorded
  in the 2026-11-21 23:31 UTC checkpoint in `docs/HISTORY-MIGRATION-NEXT.md`.
  That was a local-history search with documented store and timestamp limits;
  no new broad transcript scan was made for this continuation. The GIMP, Krita,
  and Aseprite research and its scope limits remain in the prior migration
  record. Treat those searches as evidence with stated limits, not as proof
  that no other session or implementation exists.
- The authority contract remains unchanged: legacy `HistoryItem[]` and
  `replayHistory()` own logical navigation. Durable replay/materialization is
  still staged presentation behind its existing source, ownership, frame,
  failure, and export gates. No admission, authority, publication, or export
  gate was opened by this checkpoint.
- PH-71 is closed. PH-93 remains open. At the 00:55 UTC board check, its claim
  and file locks were absent; the inventory generated at 2026-11-21 23:51 UTC
  marked its worktree `in-use` based on a then-recent board heartbeat. The
  inventory snapshot is now stale, and neither it nor the absent claim/locks
  proves the owner chat and full process tree are dead. Do not inspect or alter its dirty files,
  duplicate its scope, or reclaim the worktree without an explicit owner
  handoff or the documented owner-and-process-death recovery proof. The
  default `repo:state` also reports unrelated worktree-operation markers;
  preserve them and use the source-scoped landing check for this task.

### Proof added in this continuation

Issue `ph-108` adds one browser differential in `e2e/crop-history.spec.ts`: an
asymmetric vector triangle with a retained vertical-mirror-only affine, followed
by a +90-degree document-frame transition to a non-zero fractional frame. An
untransformed control uses the same source and frame. A second control keeps the
vertical mirror and fractional frame but uses a 0-degree frame transition. The
test requires both legacy and durable pixels to differ from the untransformed
control and from the same-mirror no-rotation control, so both the mirror and
quarter-turn effects must be observable. It also asserts exact legacy/durable
composite parity for the transformed case and both controls, frame equality,
materialized bounds and bitmap dimensions, and exact per-layer frame bytes
plus tight premultiplied pixels at the affine and frame cursors. The focused test passed as
`a vector triangle keeps exact parity through a vertical mirror and fractional
quarter-turn frame` (`1 passed`, 9.7 seconds, run
`2026-11-22T00-51-10-210Z-39556`, 2026-11-22 00:51 UTC).

This is app-internal legacy-versus-durable parity, not an independent Photoshop
pixel oracle and not export, source ownership, publication, or authority-cutover
evidence. Existing component tests for quarter-turn frame changes and vertical
mirrors did not cover their combination with a vector source and fractional
frame bounds; the new case closes only that matrix cell for internal parity and
observable transform effects. `npm run tsc`, `npm run lint:check`, and
`npm run build` passed on the task branch at 00:51 UTC. Lint reported zero
errors and 127 warnings. No `src/` production code changed; this slice changes
one E2E spec and this migration document.

Three cost-free Nemotron responses were checked against the source and current
tests. One made the blanket claim that neither quarter-turn nor vertical-mirror
coverage existed; that was false because component cases already existed. The
specific combined vector, vertical-mirror-only, and fractional quarter-turn
cell was absent. A second response identified that combined cell as useful and
correctly warned that legacy-versus-durable parity is not a Photoshop oracle.
A third response contained only a pseudo tool-call and was rejected as
incomplete. The model outputs are review leads only; source inspection and the
passing browser test are the evidence. The scheduled Terra review occurred at
00:45 UTC; its finding and correction are recorded below.

Luna and Nemotron's earlier read-only source reviews reviewed assertions, not
browser execution. Source inspection verified that
`CropParityLayerFixture` dispatches `kind: 'vector'` to a typed tool source with
no bitmap, and `compareCropRenderers` returns the final transition's legacy and
durable pixels; the test compares those arrays directly. Nemotron's concerns
about lacking a correctness oracle are valid limitations and are stated above.
Its other review points either describe assertions already present or do not
apply because the target frame is an explicit input to this differential, not
an output predicted by an independent geometry oracle. Luna suggested calling
the no-transform control “untransformed”; the fixture and checkpoint now use
that wording. Nemotron's later documentation reviews flagged ambiguous
coverage, ownership-snapshot, source-change, and remote-refresh wording. Those
claims are now narrowed to the specific matrix cell, dated inventory and board
snapshots, the absence of `src/` changes, and a distinct future continuation.
The scheduled Terra review at 00:45 UTC found a real test gap: the original
control changed the mirror but kept the same +90-degree frame transition, so
the test did not require the quarter-turn itself to affect pixels. The fixture
now adds a same-mirror, same-frame 0-degree control and asserts that both
history paths differ from it; the browser run at 00:51 UTC above passed after
that fix. Terra also caught stale restart guidance, updated below. The bounded
differential still has no independent Photoshop pixel oracle.

Post-fix Luna and Nemotron reviews confirmed that the new control isolates the
frame rotation. Luna caught the stale Terra due-time note, which is removed
from the ordered steps below. Nemotron also questioned whether the identity
control's parity was explicit; its transition already asserts zero differing
bytes, and the test now additionally compares its legacy and durable arrays
directly. A final full-diff Nemotron review at 00:53 UTC returned non-empty text
with `finish_reason=stop`, `cost=0`, and no remaining concrete defect. The other
review concerns did not identify a reproducible defect; the three same-page
renders use deterministic fixtures, and no independent Photoshop correctness
claim is made.

### Ordered next steps

1. Keep PH-93 untouched until its owner explicitly hands off the dirty work or
   the documented recovery procedure proves the owner chat and full process
   tree are dead. Then independently review its source, tests, exact runtime
   identity/lifetime claims, and resulting authority gates before reconciling
   its docs.
2. The 00:45 UTC Terra review found the missing quarter-turn control and stale
   restart step; both are now corrected. Luna and Nemotron completed read-only
   re-reviews, and focused E2E, typecheck, lint, and build pass on the current
   candidate. Keep it unchanged unless a new concrete issue is reproduced.
   Schedule the next Terra review no earlier than 03:45 UTC.
3. After this candidate lands, continue with a distinct uncovered history
   proof cell from the broader
   source × affine × frame matrix. Keep exact per-layer bounds and pixels, and
   identify an independent Photoshop or other primary-source oracle wherever
   making a product-parity claim. Do not convert browser differential parity
   into a Photoshop-correctness claim.
4. Do not fetch again during this continuation or push. At the beginning of a
   distinct future continuation, refresh and reconcile remote drift once
   before writing more code. For this candidate, retain the recorded
   two-commit `origin/main` drift. Before local landing, sync the task branch
   with the current local `main`, inspect the exact candidate, pass the scoped
   `repo:state -- --for-landing task/history-migration-continuation-20261121`
   and path-ownership gates, and land only through the pinned owner-tracked
   wrapper. Recheck local `main`, `origin/main`, parent/tree pins, and status
   afterward.
5. Once PH-93 releases them, reconcile this checkpoint into
   `docs/HISTORY-MIGRATION-NEXT.md`, `HANDOFF.md`, and the continuation plan;
   remove only stale problem entries whose fixes are verified. Keep the
   ordered remaining gates and explicit unresolved risks in those docs, not
   only in chat.

## Continuation checkpoint — 2026-11-22 11:19 UTC

This checkpoint supersedes the previous checkpoint's ordered next steps. It
records the raster/affine/quarter-turn proof and corrects the paint-path
diagnosis after a test-only baseline probe.

### Branch, main, and ownership snapshot

- The candidate branch is `task/history-migration-raster-quarter-turn-20261122`.
  It was created at `99988eed4d187defe59ed2f38aeb1e64a3581099` and fast-forwarded
  twice as `main` advanced during this continuation; it now matches local
  `main` at `18d4daf2c55376d6bac12bbe5c3b3360ac65e62b`. It currently contains
  the raster matrix E2E change and this documentation checkpoint as uncommitted
  work; it has no production `src/` changes.
- The additional local-main delta from `99988eed` changes feature documentation,
  touch navigation, view-menu shortcuts, and tablet-input handoff wording. It
  does not change `e2e/crop-history.spec.ts` or the durable renderer, so it does
  not resolve the paint diagnostic or raster matrix gap. The focused E2E,
  typecheck, and lint checks below were rerun after the latest fast-forward.
- The local `refs/remotes/origin/main` remains
  `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; current local `main` is 38 commits
  ahead and 2 behind, with merge base
  `e31679a888261612e5efabe7bb3ce8d822a51479`. The startup fetch for this
  continuation already happened; there was no second fetch and no push.
- The separate `task/origin-main-sync-20261122` worktree remains at
  `beae809ad8f2db01debe940bda79c2740a750e24` with `MERGE_HEAD` at the recorded
  `origin/main` tip. It has no unmerged entries but retains extensive staged,
  unstaged, and untracked work. Preserve it as a separate, unreviewed merge;
  it is not this candidate and must not be committed or landed wholesale.
- At 11:14 UTC, the read-only board snapshot showed no active path lock on
  `docs/HISTORY-MIGRATION.md`, `docs/HISTORY-MIGRATION-NEXT.md`, `HANDOFF.md`, or
  `e2e/crop-history.spec.ts`; `npm run swarm -- doctor --dry-run` reported no
  expired or missing-worktree holdings. The PH-93 issue is still open although
  its claim row is released. Its worktree remains dirty in the migration
  handoff and plan files, with no owner handoff or owner/process-death proof.
  Keep that typed text-source work untouched until the documented ownership
  gate is satisfied.

### Corrected paint-renderer finding

The earlier diagnosis that located the 135-byte difference at the retained
paint affine is superseded. The corrected test-only probe on baseline
`99988eed4d187defe59ed2f38aeb1e64a3581099`, run
`2026-11-22T10-40-48-646Z-46908`, captured both the first paint cursor and the
later affine cursor:

- At `cursor=blank-affine`, the paint layer has no affine operation. Its source
  bitmap is 23×25 at `{x:36,y:20,width:23,height:25}`. Legacy HTML versus
  Offscreen output differs by 135 channel bytes across 69 pixels; durable HTML
  versus Offscreen output is exact. Directly drawing the same identity
  evaluation is exact on both contexts. Comparing that evaluation with legacy
  `drawLayer()` differs by 135 bytes on HTML and is exact on Offscreen.
- The legacy Draw shortcut is eligible at this cursor because the operation
  list is empty and can draw tool arguments directly with `drawLine()`. This
  narrows the observation to the no-affine legacy Draw path's destination
  backend. It does not establish a specific Canvas sampling cause or Photoshop
  behavior.
- At the later retained-affine cursor, direct evaluation matches both
  destination contexts exactly. The retained affine is therefore not the
  demonstrated cause of the first-cursor mismatch.

Keep the existing exact zero-difference gate. Do not change production
rendering or describe the result as Photoshop parity without a primary-source
behavior contract and an independent correctness oracle.

### Raster affine plus quarter-turn proof

The new test, `two raster layers keep exact rendered parity through a
foreground affine and fractional quarter-turn frame`, fills the matrix cell
proposed in the earlier history-review chats. It uses two asymmetric raster
layers, a retained foreground affine (19-degree rotation, vertical mirror,
skew, and non-uniform resize), and a +90-degree frame transition to
`{x:4,y:4,width:55.75,height:55.5}`. Two controls independently remove the
affine or replace the quarter-turn with a 0-degree transition. The main result
must differ from each control in both renderers.

The test requires exact legacy/durable composite bytes, exact transition frame,
exact materialized layer bounds and bitmap dimensions, exact HTML and Offscreen
per-layer frame bytes, and exact premultiplied tight-bitmap pixels at the affine
and transition cursors. A free Nemotron review suggested checking the recorded
affine arrays directly; the test now requires exact legacy/durable matrix-array
equality and the expected affine count. The quarter-turn result has two
foreground affine entries (the retained layer transform and the frame
rotation); the no-affine quarter-turn and affine/zero-rotation controls each
have one. The reviewer also warned about exact fractional-frame assertions;
source inspection confirmed the helper passes `nextFrame` as explicit history
input and verifies the replayed frame against those exact values, so exact
equality is the intended gate and no float tolerance was added. The first
matrix-count attempt expected one entry after the quarter-turn and failed with
two; the count was corrected to include the document-frame affine. The final
focused run on the first fast-forwarded `4229aa831` tree,
`2026-11-22T11-32-30-994Z-12103`, passed after the matrix assertion was added.
`main` then advanced to `18d4daf2c` with a tablet-input handoff change; the
candidate was fast-forwarded again. The final focused run on `18d4daf2c`,
`2026-11-22T11-35-04-370Z-16488`, passed. On this final candidate,
`npm run tsc` passed and `npm run lint:check` passed with 0 errors and 127
existing warnings; Prettier passed. The earlier
`2026-11-22T11-19-42-277Z-88813` run passed before the matrix assertion was
added.

A separate exploratory strict comparison at the affine cursor observed 10
one-channel differences in unassociated RGBA tight-bitmap readback, each with
an observed delta of 1. The premultiplied tight comparison and both destination
frame-byte comparisons were exact. The test records raw tight bytes as
diagnostics but does not assert unassociated-byte identity. This is internal
rendered-parity evidence; it does not prove source bitmap, encoded export, or
Photoshop pixel equality.

### Cross-chat and open-source editor research

The incremental local history scan since 10:19 UTC found three matching Kilo
sessions, all unrelated to history migration; it found no Codex matches. The
read-only Copilot Chronicle query of the current stable VS Code profile found
no matching `/ph` session. This was a local-only scan capped at 500 sessions
per Kilo/Codex source and did not include remote or synced sessions, other VS
Code profiles, or other stores.

A bounded primary-source scan of GIMP, Pinta, and MyPaint found useful renderer
architecture references, not a Photoshop oracle. GIMP's developer FAQ
describes GEGL as a graph of image operations with region-based evaluation and
caching. Pinta's project notes describe a canvas-widget rewrite and a later
performance fix; its renderer discussion records nearest-neighbor sampling for
zoomed-in canvas display. MyPaint's canvas renderer aligns the transformed
origin to a screen pixel for sharp display. These sources reinforce that
viewport display policy and document/image transforms are distinct contracts;
they do not explain this app's measured delta or decide Photoshop behavior.
References: [GIMP developer FAQ](https://gimp-web-devel-f10491.pages.gitlab.gnome.org/faq/),
[Pinta changelog](https://github.com/PintaProject/Pinta/blob/master/CHANGELOG.md),
[Pinta canvas-renderer discussion](https://github.com/PintaProject/Pinta/discussions/596),
and [MyPaint canvas renderer](https://github.com/mypaint/mypaint/blob/master/gui/tileddrawwidget.py).

### Ordered next steps

1. Capture and inspect the exact 10 unassociated tight-bitmap byte samples,
   including alpha and premultiplied values, then trace whether any downstream
   renderer or export consumes those raw values. Keep the raw bitmap and export
   gates closed until their contract is proven; do not add a tolerance.
2. Isolate the no-affine direct Draw shortcut across HTML and Offscreen
   destinations with a bounded source-level/browser experiment. Research
   Photoshop behavior from Adobe or another primary source before making a
   product claim. The open-source references above are architecture comparisons
   only.
3. Keep the passing raster × affine × quarter-turn controls. Choose the next
   matrix cell from current exact coverage rather than adding arbitrary cases;
   retain separate composite, per-layer, export, source-lifecycle, and
   authority-cutover gates. `HistoryItem[]` and `replayHistory()` remain logical
   authority while durable replay is staged presentation/export.
4. Do not take over PH-93's typed text-source work until its owner hands it off
   or the documented process-liveness procedure proves the complete owner tree
   has stopped. Re-review runtime ownership, failure, canvas, PNG, and PSD
   evidence before changing admission or authority gates.
5. Resolve the separate origin merge only after the full staged/unstaged tree
   and path ownership are reviewed. For this candidate, recheck current main,
   `main:landing` occupancy, scoped `repo:state -- --for-landing`, path locks,
   and pins immediately before using the owner-tracked landing wrapper. Verify
   both parents, tree, local main, `origin/main`, and status afterward. Do not
   fetch again or push during this continuation.
6. No additional Terra subagent is scheduled or authorized by this checkpoint.
   Use only verified free, read-only reviews for the remaining bounded checks.
   Once PH-93 safely releases its docs, reconcile the durable next-step record
   into `docs/HISTORY-MIGRATION-NEXT.md`, `HANDOFF.md`, and the continuation
   plan; keep the currently verified sequence here until then.

## Follow-up checkpoint — 2026-11-22 12:16 UTC

This follow-up supersedes the 11:19 checkpoint's ordered next steps. It adds a
quarter-turn matrix case, corrects a downstream Invert diagnostic that compared
different legacy input rasters, and records the current cross-chat evidence.

### Corrected affine-raster and Invert evidence

The focused test, `two raster layers keep exact rendered parity through a
foreground affine and fractional quarter-turn frame`, now records the raw tight
bitmap samples, verifies exact premultiplied tight pixels and frame bytes, and
passes each parity-equivalent legacy raster through the production `invert`
processor. It reads both the processor's returned OffscreenCanvas and the later
HTML canvas readback, and requires exact byte equality at both stages for the
HTML and Offscreen legacy input rasters.

The 2026-11-22 11:57 UTC diagnostic run reported three output-byte differences
at the affine cursor. That comparison was invalid: the tight-pixel parity
baseline is `legacyHybridTightPixels`, while the Invert probe used
`legacyTightSurfaces` directly. Those two legacy inputs differ by 14 bytes at
the foreground affine cursor (HTML and Offscreen). The probe now builds its
legacy HTML and Offscreen inputs from the same hybrid arrays used by the tight
bitmap comparison. The corrected focused run,
`2026-11-22T12-03-51-756Z-653`, passed on `18d4daf2c` and recorded zero output
differences through Invert at every tested cursor in both input renderers.
The extra HTML readback was also exact. The assertions were strengthened to
gate those exact processor-output and readback results; the subsequent strict
focused run, `2026-11-22T12-09-43-596Z-77829`, passed. The earlier three-byte
report is superseded; it is not evidence of a durable-materialization
mismatch.

| Foreground stage                       | Hybrid legacy vs durable raw bytes | Bounded legacy surface vs hybrid, HTML / Offscreen | Invert output, HTML / Offscreen |
| -------------------------------------- | ---------------------------------: | -------------------------------------------------: | ------------------------------: |
| Retained affine cursor                 |                                 10 |                                            14 / 14 |                           0 / 0 |
| Affine plus 90-degree frame transition |                                  0 |                                              0 / 0 |                           0 / 0 |
| No-affine quarter-turn control         |                                  0 |                                              0 / 0 |                           0 / 0 |
| Affine, no-rotation cursor             |                                 10 |                                            14 / 14 |                           0 / 0 |
| Affine, zero-degree frame transition   |                                  0 |                                              4 / 4 |                           0 / 0 |

The 10 unassociated-byte differences at each affine cursor are one-channel
deltas of 1. Each sample has equal calculated premultiplied RGBA on the legacy
and durable sides, using `round(RGB * alpha / 255)` for each color channel:

- Local `(12,2)`, document `(21,17)`, green:
  `[136,43,225,60]` → `[136,42,225,60]`; premultiplied `[32,10,53,60]` on both.
- Local `(22,5)`, document `(31,20)`, green:
  `[138,43,226,96]` → `[138,42,226,96]`; premultiplied `[52,16,85,96]` on both.
- Local `(25,6)`, document `(34,21)`, green:
  `[137,43,226,132]` → `[137,42,226,132]`; premultiplied `[71,22,117,132]` on both.
- Local `(11,22)`, document `(20,37)`, green:
  `[255,212,0,132]` → `[255,213,0,132]`; premultiplied `[132,110,0,132]` on both.
- Local `(14,23)`, document `(23,38)`, green:
  `[255,213,0,96]` → `[255,212,0,96]`; premultiplied `[96,80,0,96]` on both.
- Local `(33,23)`, document `(42,38)`, red and green:
  `[43,213,128,6]` → `[42,212,128,6]`; premultiplied `[1,5,3,6]` on both.
- Local `(32,25)`, document `(41,40)`, green:
  `[26,196,125,120]` → `[26,195,125,120]`; premultiplied `[12,92,59,120]` on both.
- Local `(24,26)`, document `(33,41)`, green:
  `[26,196,123,60]` → `[26,195,123,60]`; premultiplied `[6,46,29,60]` on both.
- Local `(25,26)`, document `(34,41)`, red:
  `[25,194,126,130]` → `[26,194,126,130]`; premultiplied `[13,99,64,130]` on both.

This establishes exact output for this Invert path from the parity-equivalent
rasters; it does not establish exactness for other processors, source
lifecycles, PNG/PSD export, or Photoshop. Keep raw-byte identity and export
gates separate, and do not add a tolerance.

The final strict focused E2E,
`2026-11-22T12-15-37-658Z-57767`, and `npm run tsc` passed.
`npm run lint:check` passed with 0 errors and 127 existing warnings; Prettier
passed. The authorized Luna 6 read-only review found no concrete issues and did
not run tests. It does not establish Photoshop, export, source-lifecycle, or
authority-cutover parity. Independent free read-only reviews remain pending at
this checkpoint.

### Cross-chat correction and ownership

The 11:19 checkpoint's local-chat note missed a related free Kilo session,
`Crop history byte parity failure`. Its read-only prompt examined the separate
`origin-main-sync` worktree at `beae809ad8f2db01debe940bda79c2740a750e24`, with
`origin/main` merged in the index and `MERGE_HEAD` still active. It reported 88
paint channel differences at `blank-affine`, including a green/alpha sample
`135/215` versus `136/191`, and suggested comparing a source-sized Offscreen
render before frame mapping. The model also proposed rerouting
`resolveLayerSourceBitmap()` through `setupDrawCtx()` and `drawLine()`; that is
an unverified hypothesis, not a fix.

The current `18d4daf2c` source probe independently locates 135 differing bytes
across 69 pixels at the no-affine legacy Draw fast path on HTML, with exact
Offscreen output and exact direct evaluation on both contexts. The 88-byte
report is from a separate worktree/fixture state and must not be conflated with
the current probe. Preserve the origin-sync worktree and its active merge; do
not harvest or repair it without its owner and the documented ownership gate.

The recent local Codex scan found no separate durable-history migration
session. It did find another Codex chat requesting a seven-day Nemotron
quarantine. At 12:15 UTC the quarantine state visible from this candidate still
did not contain that route, so no free-model review call has been made from
this candidate. Recheck the shared quarantine and free-model catalog before
review; do not launch Terra or rely on Nemotron until this cross-chat route
request is reconciled. The current stable Copilot Chronicle query found no
`/ph` history/replay match. These scans were local and did not cover remote or
synced sessions, other VS Code profiles, or other stores.

### Ordered next steps

1. Resolve the shared free-model route state from the parallel Codex
   quarantine request, then obtain independent free, read-only reviews of the
   exact candidate diff. Do not use paid Terra. A reviewer cannot inspect this
   checkout; provide the complete diff and source excerpts, verify its route,
   completion status, and zero reported cost, and reproduce every useful claim.
2. Continue the paint-path investigation by comparing, at source dimensions,
   the stored draw-processor bitmap, the legacy direct `drawLine()` result, and
   the `preferCachedSource` result before any document-frame blit. Record HTML
   and Offscreen bytes separately. Reconcile the current 135-byte observation
   with the independent 88-byte report; keep the proposed resolver change
   unimplemented until this experiment identifies the failing boundary.
3. Keep the raster affine/quarter-turn test's exact frame, matrix, bounds,
   composite, premultiplied-pixel, and Invert output assertions. Keep
   unassociated raw bytes and untested downstream processors diagnostic until
   the relevant source and export contracts are proven. Choose the next matrix
   cell from known coverage and keep PNG/PSD and source-lifecycle evidence
   separate.
4. Preserve `HistoryItem[]` and `replayHistory()` as logical authority.
   Durable replay remains staged presentation/export; do not widen publication,
   source admission, or authority cutover based on this raster test.
5. Leave PH-93 typed text-source work and the separate origin-sync merge alone
   until ownership is handed off or the documented liveness procedure proves
   the full owner tree stopped.
6. Before landing this candidate, rerun lint and the required scoped ownership,
   path-lock, main-landing, and pin checks. Land only through the owner-tracked
   wrapper, then verify both parents, tree, local `main`, `origin/main`, and
   status. Do not fetch again or push.

## Continuation checkpoint — 2026-11-22 16:45 UTC

This checkpoint supersedes the 12:16 checkpoint's diagnosis and ordered steps.
It records a producer-valid mixed-source fixture, the remaining exact composite
failure, the current local-main drift, and the old branch/chat reconciliation.

### Candidate and main drift

The candidate is `task/history-migration-raster-quarter-turn-20261122` in
`.kilo/worktrees/history-migration-raster-quarter-turn-20261122`. It was
at `18d4daf2c55376d6bac12bbe5c3b3360ac65e62b` in the 11:19 checkpoint, then
fast-forwarded to `5c970cdf0bf4f6c9de4a800ef688868821bf8a57` and most recently
to local `main=abdc35647385f83cf69b18f2a01f4b6f71118f94`. The candidate reflog
records those transitions at 13:37 UTC and 16:17 UTC, respectively; this
reconciles the earlier 18d4 snapshot with 5c970 as the immediate predecessor
to the latest sync. The designated main worktree was clean at the latest pin.
The two commits added since 5c970 are
`44f552fd6` and merge `abdc35647`; the scoped path diff changes only
`e2e/OPEN_PROBLEMS.md` among migration paths, adding the mirror run's newer
failure evidence. No history implementation or crop-history spec changed in
that drift. The exact E2E problem entry below incorporates the new local result.

The last fetched `origin/main` tracking pin remains
`e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; it was not fetched again. The
current local comparison is 44 commits ahead and 2 behind, with merge base
`e31679a888261612e5efabe7bb3ce8d822a51479`. These are local tracking-ref
measurements, not a fresh remote check. `repo:state -- --for-landing
task/history-migration-raster-quarter-turn-20261122` exited 0 with 12
unrelated findings preserved. The candidate has no production `src/` changes.

### Corrected Draw fixture and remaining composite delta

The original Draw test source was not producer-valid: its stroke points and
stored `pos` did not match the bounds computed by `DrawToolArea`. The candidate
uses `pos={x:36,y:20,width:23,height:25}` and localized points `(5,5)` to
`(18,20)`, derived from the producer's outward bounds. It also compares each
materialized layer on fresh frame surfaces. This corrects the test input and
removes the prior shared-surface artifact from per-layer comparisons; it does
not erase the older mirror observations or prove composite parity.

On the candidate tree based on `abdc356`, run
`2026-11-22T16-41-21-236Z-49094` failed the exact mixed-source composite
assertion at `integer frame fixture retained affine blank-affine`: 8 channel
bytes differed across 6 pixels, with a maximum channel delta of 255. The
samples `(x,y,channel,legacy→durable)` were `(28,7,a,79→76)`,
`(34,8,a,70→69)`, `(39,9,g,255→0)`, `(39,9,a,3→0)`,
`(26,16,g,255→0)`, `(26,16,a,3→0)`, `(31,17,a,70→69)`, and
`(37,18,a,79→76)`. The corrected source bitmaps and fresh
HTML/Offscreen per-layer frame comparisons were exact in the instrumented
diagnostic. The earlier checkpoint reported that the independent affine-raster plus fractional
quarter-turn matrix case passed on the same candidate in run
`2026-11-22T16-41-42-652Z-49716`; no artifact for that run is present in this worktree, so retain
it only as an unverified historical report and do not use it as current proof.

On this candidate, `npm run tsc` passed. `npm run lint:check` exited 0 with 127
warnings and no errors; Prettier reported all four changed files formatted.
No full E2E suite or production build was run.

The bounded diagnostic `2026-11-22T16-08-23-700Z-97050` narrows the first
composite-prefix difference to accumulation of the paint source. Actual legacy
HTML output matched a manual direct draw exactly; routing that same source
through the cached bitmap path reproduced the 8-byte difference. A cached
materialization matched the manual materialized output, and direct-versus-cached
rendering on a fresh destination surface was exact. This points to the legacy
direct `drawLine()` route versus cached `drawImage()` under accumulated context;
it does not establish the Canvas implementation as the root cause. The
temporary instrumentation used for that run has been removed. Do not change
production rendering from this diagnostic alone.

The 18:21 UTC checkpoint below supersedes the 16:08 manual-path comparison as
root-cause evidence. Its hand-built direct surface did not equal the production
legacy compositor, so preserve the 16:08 run only as a failed diagnostic
attempt.

The product still uses `HistoryItem[]` and `replayHistory()` as logical
authority. Durable replay remains staged; source admission, PNG/PSD export
authority, and undo/redo cutover remain closed. This diagnostic mismatch is not
evidence of a user-visible regression while legacy presentation is authoritative.
Keep exact-zero assertions and investigate the first differing stage without a
tolerance.

### Old branch and cross-chat reconciliation

The local mirror refs are `task/crop-history-cross-platform-20261029` at
`97b80395b` and `task/overnight-crop-history-20261030` at `ac3487d94`; the
remote was not re-queried in this turn. The first branch tip is not an ancestor
of current main. Kilo's 2026-10-30 audit, session
`ses_e71e39819ffe59ps2H2bfyk2Zk`, records crop-history-cross-platform work among
the branches landed and the overnight branch as remaining unmerged. Source
history confirms the native-drag prevention handler is present in main through
`6f9aaf535`, and it matches the handler in the old branch. The old ref's full
tip is not therefore proven merged: its crop-history spec is roughly 6.8k lines
shorter than current main and its `CropToolArea` also differs in unrelated
behavior.

The overnight branch remains checked out clean at `ac3487d94`. The dry-run
swarm doctor reports no stale or missing-worktree holdings; that does not prove
the owner process has stopped. Both trees contain the direct-affine source
helpers. The exact residual renderer differences include an old `drawImage`
frame-overlap copy where main uses `getImageData`/`putImageData`; the old
compositor omits the final post-conversion currentness assertion, owned-bitmap
cleanup in the catch path, and the produced-bitmap invariant check. The old
tree also removes three `toOwnedBitmap` tests for canvas input, fallback, and
error propagation. Its crop-history E2E file declares 29 tests versus 34 in
current main, but their bodies and case coverage have not been audited one by
one. Do not merge or reclaim that live branch based on its name or old chat
claims. The scoped
`repo:state -- --for-landing task/overnight-crop-history-20261030` exited 0
with 13 unrelated findings; this is not an ownership or code-review result.

The Kilo audit's child review `ses_e711bf0c7ffePCowoCsnkl0KpU` did not produce
a completed final assessment. One free Nemotron review treated the crop
branch's current non-ancestry as disproving the historical “landed” report and
missed that both trees contain the direct-affine helpers. The current handler
behavior is present through `6f9aaf535`, while whether the whole old tip was
merged and later rewritten cannot be established from the current DAG. Exact
`git show`, `git blame`, and source comparison corrected the review's scope.
Keep free-model results as leads. The Luna 6 review recorded in the 12:16
checkpoint covered that earlier candidate only, not the current diff; no Luna
review was launched in this free-only continuation.
The local Codex state index returned no dedicated thread matching either old
branch name; exact-name hits in rollout files are branch references, not proof
of another implementation. The current stable Copilot Chronicle store returned
no exact branch-name hit, and its earlier 19-session project scan found no
`/ph` session. Remote or synced histories, other VS Code profiles, and other
stores were not searched.

### Comparative editor research

A free Nemotron 3 Ultra request through Kilo fetched five primary project sources
and returned non-empty text with `finish_reason=stop`, one Kilo request, no
OpenRouter request, and reported cost zero. GIMP's GEGL documentation describes
a graph of image operations and tiled buffers; Krita documents time-based undo
grouping and separately describes snapshots that discard the undo stack when
switched; MyPaint documents tiled canvas storage and a temporary transformed
render buffer; Pinta's changelog records canvas-widget performance work. These
are architecture and product comparisons only. They do not define Photoshop
behavior, explain this browser Canvas difference, or set this app's migration
contract. References: [GIMP GEGL architecture](https://developer.gimp.org/resource/writing-a-filter/architecture-install/),
[Krita undo history](https://docs.krita.org/en/reference_manual/dockers/undo_history.html),
[Krita snapshots](https://docs.krita.org/en/reference_manual/dockers/snapshot_docker.html),
[MyPaint canvas](https://www.mypaint.app/en/docs/backend/canvas/), and
[Pinta changelog](https://github.com/PintaProject/Pinta/blob/master/CHANGELOG.md).
This expands the earlier 11:19 three-editor survey (GIMP, Pinta, and MyPaint)
with Krita undo and snapshot references; the added source set does not change
the architecture-only conclusion.

### Ordered next steps

1. Isolate the 8-byte composite difference in a minimal deterministic test at
   the paint-layer accumulation boundary. Compare direct `drawLine()` and
   cached `drawImage()` paths on the same accumulated target; retain HTML and
   Offscreen results separately and keep exact-zero assertions.
2. Review the captured exact samples and context state against the candidate
   source and test helper. Change production rendering only after the differing
   stage and intended behavior are established; consult Photoshop or another
   primary source before making a product-behavior claim.
3. Keep the passing raster/affine/fractional-quarter-turn case and all exact
   bounds, matrix, frame, and per-layer gates. Run this matrix on Linux,
   Windows, and macOS after the mixed-source failure is resolved; do not reuse
   the old 88-byte run as a pass or add a tolerance.
4. Preserve legacy logical authority. After the raster discrepancy is closed,
   continue the typed text-source lifecycle slice in `HANDOFF.md` §1 only after
   its owner handoff or documented full-tree liveness proof; prove integration,
   failure, navigation, canvas, PNG, and PSD behavior before changing
   `ownership-unproven`.
5. Before any landing, rerun the focused proof and required typecheck, lint,
   scoped ownership, path-lock, landing occupancy, and pinned-tree checks. Do
   not land this candidate while its exact composite assertion remains red.
   Do not fetch again or push during this continuation.

## Continuation checkpoint — 2026-11-22 18:21 UTC

### Corrected accumulated Draw-path comparison

Focused run `2026-11-22T18-02-05-055Z-51088` on candidate `abdc356` still fails exact retained-affine
composite parity at `blank-affine`: 8 channel bytes across 6 pixels and a maximum channel delta of 255. The eight `legacy→durable` samples are `(28,7,a,79→76)`, `(34,8,a,70→69)`,
`(39,9,g,255→0)`, `(39,9,a,3→0)`, `(26,16,g,255→0)`, `(26,16,a,3→0)`, `(31,17,a,70→69)`, and
`(37,18,a,79→76)`.

The corrected test-only probe invokes production `drawLayersToCanvas()` separately for identical
visible-layer prefixes. Its only A/B change is whether the eligible Draw layer is rendered directly
from tool arguments or through the existing cached bitmap. The first three prefixes (`blank`,
`blank-semi`, `vector`) have zero differing bytes. The first difference is after `paint`; the
`text` prefix retains the same difference. The direct final output equals the real legacy output
exactly. The cached final output equals the durable composite exactly. This replaces the earlier
hand-built direct renderer comparison, whose output differed from actual legacy and therefore could
not establish path parity.

Execution reaches the composite assertion only after `assertMixedLayerParity()` passes for all
layers at each retained-affine cursor. That includes HTML and Offscreen frame output and the
premultiplied tight-bitmap check for paint. The fixture's Draw alpha is 1, layer opacity defaults to
1, blend mode is source-over, and its source and layer dimensions both equal 23×25. Direct rendering
is eligible because no enabled operation, temporary canvas, baked presentation, block stamp, spray,
eraser, or non-source-over blend is present. Thus the standalone layer pixels agree; the observed
delta appears only when the layer is added over the rendered lower-layer prefix. This localizes the
compatibility discrepancy to the direct-versus-cached accumulation path, without identifying the
exact Canvas arithmetic or asserting a Canvas defect.

### Existing contract and external references

Commit `89e348237c` (`Fix Draw HiDPI commit rendering`) added the direct Draw source branch and the
E2E check that committing a Draw stroke preserves live HiDPI preview pixels. Preserve that app-level
contract during migration unless a separately reviewed renderer change proves both preview and
commit behavior. Adobe's [Brush/Pencil documentation](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)
describes paint opacity within a stroke; Adobe's [layer opacity and blending documentation](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/set-layer-opacity-and-blending-modes.html)
describes layer opacity and blending against underlying pixels. Neither page supplies an exact
browser-canvas byte oracle for this fixture. Open-source GIMP, Krita, MyPaint, and Pinta research
remains architecture-only.

### Free history scan and review limits

The free chat search covered up to 500 recent Kilo and Codex sessions per source from the `/ph`
workspace since 2026-11-15. It found no newer independent migration implementation or next-step
plan. A Kilo E2E review corroborated the producer-valid Draw fixture; current source checks reject its
unrelated Invert concern for the quarter-turn fixture. A Kilo documentation review flagged candidate
pin and editor-count differences, but the 16:45 checkpoint already reconciles the candidate reflog
(`18d4daf2c` → `5c970cdf0` → `abdc356`) and describes the Krita addition as an expansion. The local
Codex index is complete; the latest matching threads are the active migration thread and an unrelated
tools-hardening thread. The older migration plan remains useful for scope, not current implementation
evidence. The current stable Copilot Chronicle has 19 local sessions and no `/ph` match; other
profiles and synced/remote stores remain outside this scan. Nemotron reviews agreed on the controlled
direct-versus-cached boundary, but one incorrectly claimed layer opacity was below 1 and that Adobe
docs decided the renderer choice. The fixture and documentation disprove those claims. A Kilo
review's standalone-bitmap suggestion is already covered by the passing per-layer assertions; all
model output remains a lead until source-verified.

### Next step

Reduce the case to one backdrop and one eligible Draw layer; compare both paths over transparent,
opaque, and semitransparent backdrops on HTML and Offscreen surfaces, recording RGBA at the six known
coordinates. Trace whether the first difference occurs while creating the standalone paint bitmap
or only when partial coverage is composited onto an existing destination. Preserve the current
`check-dpr` preview/commit contract and all exact parity gates. Do not change production rendering or
authority/export cutover until this reduced case and the required renderer contract are reviewed.

## Continuation checkpoint — 2026-11-22 19:53 UTC

This checkpoint supersedes the 18:21 checkpoint's next experiment. The synthetic backdrop controls,
original-layer subset reducer, exact pixel-copy control, and a focused hidden-clip probe have now
run. No production renderer or migration authority change is supported by the results.

### Candidate and exact-gate status

Candidate `task/history-migration-raster-quarter-turn-20261122` and the clean designated local
`main` worktree are both at `abdc35647385f83cf69b18f2a01f4b6f71118f94`. The last fetched local
`origin/main` tracking pin remains `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; no second fetch or
push occurred. Issue `ph-111` owns the test-only paths. The changes remain limited to the migration
docs, `e2e/OPEN_PROBLEMS.md`, and `e2e/crop-history.spec.ts`; there are no production `src/` edits or
landed changes.

Focused run `2026-11-22T19-50-41-900Z-5926` fails the exact assertion in
`multi-step frame transitions retain byte parity across text, vector, blank, and paint sources` at
the first retained-affine `blank-affine` cursor. It reports 8 channel bytes across 6 pixels and a
maximum delta of 255. The measurements match run `2026-11-22T19-21-37-747Z-59946`; exact equality
is still required.

### Reduced backdrop and context evidence

The 18:21 checkpoint's proposed transparent/opaque/semitransparent controls and backdrop reduction
are complete. All synthetic controls compare direct and cached Draw paths exactly. Of the seven
non-empty subsets of the original lower layers, only subsets containing `blank` reproduce the
8-byte/6-pixel result; the `blank` subset alone is sufficient. The `blank-semi` and `vector` subsets
remain exact. `blank` is a green `#00ff00` source at opacity 1, size 10×10, with retained affine
`blank-affine`; it is not a transparent blank. The six changed pixels surround its transformed
edges and lie outside the paint layer bounds. Direct rendering raises green alpha by 1–3 at four
existing green samples and writes `[0,255,0,3]` at two transparent samples; cached rendering leaves
all six backdrop samples unchanged.

The actual accumulated backdrop RGBA round-trips exactly through a fresh Offscreen surface using
`putImageData`. Direct and cached rendering are exact on that copied surface; the 8-byte delta
remains on the original surface after the affine blank layer. The legacy direct output still equals
the actual legacy composite, and the cached output equals the durable composite. HTML and Offscreen
prefix comparisons report the same difference. These facts isolate a direct-versus-cached
accumulation discrepancy tied to the transformed blank backdrop. They do not establish the first
Canvas operation that causes it or why the direct path changes pixels outside the paint bounds.

The existing context-state probe sees identity transform, alpha 1, source-over, filter `none`,
smoothing enabled, default stroke/fill, line width 1, butt cap, miter join, and no dash after both
paths. The historical after-layer sentinel reset pixels with `putImageData`, then used a full-frame
fill whose reported coverage was all 4,096 pixels. That shows no residual clip restricted the later
fill; it does not test whether the temporary clip restricted the stroke during that call. Its old
output field was `clipSentinelAfterLayerDraw`; the helper is not in the current test. It cannot prove
absence of every internal canvas or backing-store difference. No browser defect, Photoshop output,
user-visible defect, or root cause is claimed. The exact composite gate remains blocked; legacy
replay and presentation authority remain unchanged.

### Chat reconciliation

The 18:33 Kilo free review requested frame-origin confirmation; the current `DocumentFrame` is
`{x:0,y:0,width:64,height:64}`, so sample and document coordinates match. The 18:47 reduction
suggestion is now covered by synthetic controls, all original lower-layer subsets, and the actual
RGBA pixel-copy control. The 18:55 Kilo review called the green affine source transparent and
presented blending order as a causal finding. Both claims are rejected: the fixture source and
subset tests contradict the former, and none of the measurements identify the latter's mechanism.
Treat all model output as a lead.

The previous Copilot search inspected only the stable Chronicle store and was not a complete scan of
VS Code Agent-host history. This checkpoint also queried the Agent-host registry and its 47 `/ph`
parent-session databases (2026-10-06 through 2026-11-20); four contained local turns matching
history/crop terms. The Oct 30 `Project review and merge tasks` session exposes older history and
crop review requests, but its 23 stored child turns all have failed status (upstream 502, unsupported
model, or quota errors), leaving no completed review output to reconcile. The Nov 20 `Review Kilo
Chat Sweep` session has no migration-related turn. The registry search found no newer completed
Copilot migration review; other VS Code profiles and synced/remote stores were not scanned.

### Ordered next steps

1. Keep the exact composite assertion blocked, with no tolerance, fixture workaround, or production
   edit. Do not repeat the already completed synthetic backdrop or layer-subset reductions.
2. If continuing this diagnosis, reduce the stack to the affine green `blank` and producer-valid
   Draw layer. Add a test-only direct/cached call trace covering clip, translation, Draw context
   setup, path construction/stroke, bitmap selection, evaluated draw, and `drawImage`. Avoid
   `getImageData` between production calls and retain an uninstrumented exact-parity control because
   pixel readback/copy changes the outcome. Stop with the mismatch blocked if this does not isolate
   the first responsible stage.
3. Only propose a compatibility change after the first differing write and intended renderer
   contract are supported by current source and a primary source. Keep `check-dpr`, exact per-layer,
   export, source/frame admission, PNG/PSD authority, and undo/redo cutover gates closed.
4. After exact parity is green, run the focused matrix on Linux, Windows, and macOS. Then continue the
   typed text-source lifecycle slice in `HANDOFF.md` §1 after its owner handoff or documented full
   process-tree liveness proof, preserving its identity/lease, failure, navigation, canvas, PNG, and
   PSD requirements.
5. Do not land this candidate while its exact composite assertion is red. The detailed restart
   order is in [`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md).

## Continuation checkpoint — 2026-11-22 20:33 UTC

The 19:53 checkpoint's proposed call trace has now run. It did not locate a cause, so the mixed-source
composite remains blocked and no production renderer, history authority, or export change is
supported. The latest reconciliation, full run evidence, chat/Git research, scope limits, and ordered
restart steps are in [`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md).

Focused run `2026-11-22T20-20-54-431Z-48893` still reports 8 differing channel bytes across 6 pixels
at the retained-affine green `blank-affine` cursor. Instrumented direct/cached output each matches
its uninstrumented control. The selected direct Draw calls target clip/destination
`[36,59) × [20,45)`; all differing samples have `y=7..18`, below its `y=20` start. The
bounded trace does not identify the first differing write or distinguish an output/backing-path
issue from a fixture/oracle issue. Do not infer a browser defect, Photoshop result, or user-visible
regression, and do not repeat the same trace or prior backdrop/subset/pixel-copy controls.

Keep exact byte equality and legacy presentation authority. Resume this diagnosis only with new
evidence that can distinguish the backing/output path from the fixture/oracle. Do not land while the
exact assertion is red. After parity is green, follow the documented cross-platform gate and then the
typed text-source lifecycle slice only after its owner handoff or full process-tree liveness proof.

## Continuation checkpoint — 2026-11-22 22:33 UTC

The added equal-backdrop accumulation-path control now runs on both HTML canvas and OffscreenCanvas.
Local focused Chrome run `2026-11-22T21-33-15-841Z-97111` still fails exact mixed-source composite
parity by 8 bytes across 6 pixels at the retained-affine blank cursor; the exact assertion is
unchanged. Sequential and separately composed affine backdrops read back identically, and the
sequential direct/cached outputs reproduce their production baselines. Comparing final full-frame
readbacks after adding each paint-route variant, the separate-backdrop/direct result differs from
the sequential-backdrop/direct result by 8/6, while cached-route readbacks remain unchanged. All differing samples have `y=7..18`, below the recorded rectangles' `y=20` start; although
`x=36..39` overlaps the rectangle's horizontal span, none intersects its 2D bounds. This does not
show that the Draw stroke wrote them. Direct full stack still matches
legacy exactly and cached full stack still matches durable exactly.

The measured path sensitivity does not identify a first differing write, establish the expected
Canvas or Photoshop output, or prove a browser or user-visible defect. A free review's claimed
context-state leak was checked against source and rejected: `drawLayer()` brackets every source draw
with `save()`/`restore()`, and the direct Draw branch has its own bracket. Other review claims of an
established production defect or of all Canvas mechanisms having been falsified are unsupported.
Keep legacy authority and the exact composite gate unchanged. The gate is green only at zero
differing bytes across all tested transition cursors; after local parity, require the focused Linux,
Windows, and macOS matrix before advancing. Per-layer, export, PNG/PSD, and authority cutover remain
separate gates. A bounded primary-source check of GIMP and Krita is recorded in
[`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md). Those editors use documented graph/buffer
and paint-device/projection architectures, but their sources do not define Photoshop-compatible
semantics or resolve this Canvas byte difference; they provide context, not an oracle. The latest
cross-chat scope, review dispositions, current refs, and ordered restart plan are in
[`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md).

## Continuation checkpoint — 2026-11-23 01:10 UTC

Candidate `task/history-migration-raster-quarter-turn-20261122` contains test-only code commit
`81bef88`; the current documentation update is committed separately after it. The focused Chrome
run `2026-11-23T00-27-50-020Z-14186` passes the raster × affine ×
fractional quarter-turn case and still fails the exact mixed-source composite by 8 bytes across 6
pixels at the retained-affine `blank-affine` cursor. The new direct/cached prefix diagnostic first
differs when the paint layer is added, and its complete direct and cached outputs match the legacy
and durable outputs respectively. This localizes the fixture's path-dependent difference but does
not identify the first internal Canvas write or establish Photoshop behavior. The unchanged exact
gate stays red; no production renderer, export, admission, or authority change is supported.

The latest refs, test measurements, local Kilo/Codex/Copilot history delta, review dispositions, and
ordered next steps are recorded in
[`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md#latest-continuation-reconciliation--2026-11-23-0110-utc).

## Documentation audit update — 2026-11-23 01:34 UTC

The 01:10 pixel and ref checkpoint remains unchanged. A follow-up documentation review clarified
that the required mirror check runs the full `e2e/crop-history.spec.ts` spec once per platform, and
that the future mirror wrapper's remote refresh/push is separate from the current hold on source
sync. Four exact-free Kilo reviews completed; one wording issue was fixed, two apparent issues were
rejected after checking complete files and relative link resolution, and the final audit found none.
The local zero-tolerance composite gate remains red, so no mirror run, test rerun, main merge, or
production change is recorded. A broad `repo:state --json` audit also saw foreign in-progress
operations; none were touched, and that repository-wide result is not a landing decision. See the
current owner/lock state, review dispositions, and chat-scan evidence in
[`HISTORY-MIGRATION-NEXT.md`](HISTORY-MIGRATION-NEXT.md#latest-continuation-reconciliation--2026-11-23-0110-utc).
