# History Migration

This document owns the durable-history migration requirements, sequencing, and
decision record. It is the implementation contract for the migration; current
code facts remain in [`ARCHITECTURE.md`](ARCHITECTURE.md), and open defects
remain in [`../HANDOFF.md`](../HANDOFF.md).

## Authority

The legacy `HistoryItem[]` timeline remains the logical authority. Navigation
now stages a durable-composed presentation cache into those legacy layers;
render, export, and logical undo/redo remain legacy-authoritative. `durableDocument`
is still a shadow projection for logical state. The migration is not complete
until one replay/materialization authority feeds undo, redo, navigation, render,
and export without a second logical state writer.

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
than create a replacement layer and leave the old one behind. The current
durable operation union has no source-rewrite operation: `create-layer` and
`merge-document` carry complete layer snapshots, while the other operations can
change properties, position, order, filters, affine transforms, raster
processors, frame, or selection only. `DurableLayerPropertyPatch` deliberately
omits `source`.

The migration therefore needs one source-edit operation (name and exact payload
to be decided) plus matching legacy production consumption, durable replay,
source rehydration into the relevant options bar, and undo/redo parity. A new
operation is not useful while durable state remains render-only shadow; the
operation and its visible consumer must land together.

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

The earlier proposal for a thirteenth durable operation was an automatic
`rasterize-layer` escape hatch and is superseded. The durable operation count
was corrected to eleven in the finalisation audit. This document's authorized
source-edit operation is a different requirement: it preserves editable text
and shape sources and is not a rasterization path.

### RQ-4: one replay authority

The final state has one logical replay authority. Runtime rendering, export,
undo, redo, navigation, and history-panel state must agree. During migration,
legacy-versus-durable differential checks are allowed; shipping two authorities
is not.

The retired coordination gate forbids production imports of
`replay-coordinator.ts` and `replay-checkpoints.ts`. A separate plain assertion
allows exactly one production importer for `materialization.ts`,
`durable-compositor.ts`. The compositor is mounted for navigation presentation
only; the remaining surfaces stay fail-closed until their differential and
ownership gates pass.

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

The first implementation slice deliberately supports a lone bedrock layer by
preserving its name through the existing `merge-document` contract. It refuses
to flatten a multi-layer stack; atomic multi-layer Background conversion remains
a separate source-replacement requirement.

## Sequencing

1. Record the operator rulings below and make the requirements document part of
   the tracked architecture map.
2. Close the current migration boundary defects and keep every currently
   appendable durable operation replayable without changing production
   authority. The runtime retained-operation boundary, supported raster append
   path, and navigation presentation mount are closed; remaining work is the
   render/export surfaces and final authority transfer.
3. Verify source-edit history and source rehydration together for text and
   shape correction. Keep independent legacy/durable parity for creation, edit,
   undo, redo, and navigation.
4. Preserve the explicit bedrock conversion UX and its history operation while
   keeping merge/flatten explicit and separate from a tool gesture.
5. Measure replay and build the cooperative, manually accepted slow-replay path
   only after the empty-history and transactional-baseline invariants are safe.
6. Extend the durable materialization/compositor boundary to render and export.
   Stage successfully before publication and delete the old authority only
   after the differential and failure-contract gates pass.

## Operator rulings

Recorded 2026-10-03 from the operator's direct answers. These are architecture
decisions, not Photoshop overrides, and are intentionally not encoded in
`OVERRIDES.md`:

- **Source edit:** authorized one typed durable source-edit operation for
  lossless text and shape post-editing. Its legacy consumer, durable replay,
  and options-bar rehydration must land as one behavior slice.
- **Authority gate:** durable materialization is the eventual single production
  authority. Legacy replay remains the logical authority during differential
  parity; navigation presentation is the first mounted surface, while retired
  coordination modules stay fail-closed.
- **Bedrock UX:** use an explicit Photoshop-faithful Layer-from-Background or
  equivalent conversion action. Keep the bedrock refusal, do not auto-flatten,
  and do not silently relax the gate.
- **Replay budget:** make the budget configurable, measure replay cooperatively,
  and require explicit user acceptance before any raster baseline is created.
  No automatic rasterization is permitted.

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
