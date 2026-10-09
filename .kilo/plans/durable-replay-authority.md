# Durable Replay Authority Cutover

`ANCHOR` `main` @ `c43a7c24`. Re-derive symbols before implementation; this
plan is a sequence of contracts, not a promise that the current line layout
still exists.

## Problem

HANDOFF Item 1 is still open. `HistoryItem[]` and `replayHistory()` remain the
production logical authority for undo, redo, runtime layers and export inputs.
`durableDocument` is current and replayable, but its materialization is mounted
only as a guarded navigation presentation cache. The migration must reach one
normal durable authority without exposing mixed durable/legacy presentation,
losing editable source arguments, or closing a bitmap still reachable by a
fallback path.

The active decisions are recorded in
[`docs/HISTORY-MIGRATION.md`](../../docs/HISTORY-MIGRATION.md) under
**Operator rulings**. They supersede any implementation choice in this plan
that would preserve a second normal authority or silently rasterize an
unsupported source.

## Invariants

- A surface switches only after its durable-versus-legacy differential is green
  for every supported layer family and cursor.
- A failed or stale durable publication leaves the last valid visible document
  intact, including its dimensions.
- A delayed publication record is ignored once the durable sidecar is stale or
  unavailable; it cannot resurrect a durable status after a document mutation.
- A document is published either from durable materialization or from the
  legacy compatibility fallback, never a mixture of the two.
- Durable asset and presentation leases remain live until publication is
  complete and are released only after the replacement is reachable.
- Options-bar rehydration is document state, not a settings write, and cannot
  overwrite a live preview transaction.
- The legacy replay path remains isolated as a compatibility fallback until all
  reachable legacy sources have durable adapters; it is not used as a second
  normal state writer.

## Slices

### A. Contract and authority seam

Own the durable entry provenance, browser seam, and refusal taxonomy before
changing a production consumer.

Production files:

- `src/contexts/history-model.ts`
- `src/contexts/history-adapter.ts`
- `src/contexts/history-append.ts`
- `src/contexts/durable-compositor.ts`
- `src/contexts/StoreContext.tsx`
- `src/components/DevStatusStrip/DevStatusStrip.tsx`

Work:

- Add stable action provenance or display metadata to durable entries, including
  clone, freeze, refreeze, append and validation paths.
- Preserve the legacy-to-durable cursor mapping when entries are omitted by
  conversion, so a panel row never points at an unrelated durable operation.
- Expose durable cursor and published durable-layer ids beside the existing
  development status seam. Keep this diagnostic-only and dev-gated.
- Make whole-document materialization refusal explicit at the compositor/store
  boundary. A refused visible layer must decline the complete durable
  publication. Keep `materializeDocument()`'s per-layer omission contract
  unchanged for existing callers; the compositor owns the all-or-nothing
  coverage check.
- Require the durable and legacy presentations to have the same visible layer
  id set before taking any detached materialization leases. Extra legacy layers
  are a refusal, not a reason to publish a partial durable cache.
- Record the effective durable cursor, stable durable layer ids, and either
  `durable` or `legacy-fallback` with a narrow refusal reason through the
  dev-only status seam.

Acceptance:

- Existing durable schema and asset reachability tests remain green, or the
  schema/version change is explicit and migration-tested.
- The browser seam distinguishes published durable composition from declined
  fallback without asserting pixel colours.
- No runtime consumer changes authority in this slice.

### B. History-panel state

Own the panel's title, enabled state, current cursor and fallback behavior.

Production files:

- `src/contexts/useHistory.ts`
- `src/components/SidebarRight/HistoryTab.tsx`
- `src/components/Mobile/MobileLayersDrawer.tsx`

Work:

- Derive the durable title from the preserved provenance/metadata while keeping
  current wording from `getHistoryItemTitle()`.
- Use durable entry enabled state and cursor only when the durable document is
  current and covers the timeline; otherwise render the legacy compatibility
  state without mixing row data from both models.
- Keep history navigation and disable/enable actions routed through the one
  staged publication boundary.

Acceptance:

- Every supported history scenario has identical row order, title, enabled
  state, and current-row state on both sides.
- A conversion omission or unavailable durable document selects the complete
  legacy panel state, not a partially durable panel.

### C. Options-bar rehydration

Own document-backed tool arguments after navigation without disturbing a live
gesture.

Production files:

- `src/contexts/useCurrentTool.tsx`
- `src/contexts/StoreContext.tsx`
- `src/components/ToolbarsRight/**` only where a bar has a tool-specific source
  normalization requirement

Work:

- Add one helper that reads the durable active-layer source for the active tool
  and returns normalized editable arguments.
- Mark hydrated values as document-backed without persisting them. Text hydration
  removes committed content and layer-local geometry but retains `text: ''` and
  `rect: null` so the text toolbar cannot reopen an edit overlay.
- Hydrate on a durable cursor/active-layer change, not on every slider update.
- Skip hydration while `previewLayers` or a pending text/shape edit owns the
  document gesture.
- Use saved settings only when the source is absent, unsupported or belongs to
  another tool, and do not persist a hydration result as a new setting.
- Suppress the Shape toolbar's foreground/background mirror while values are
  document-backed; a user edit clears that provenance before persisting.

Acceptance:

- Undo/redo and history-panel navigation show the arguments stored by the
  durable source.
- A live preview survives an unrelated store publication and is not replaced by
  stale durable values.
- Unsupported `legacy-tool` documents retain the existing legacy behavior.

### D. Durable presentation projection

Own the single projection from durable replay plus materialization into the
layer presentation consumed by runtime and export.

Production files:

- `src/contexts/materialization.ts`
- `src/contexts/durable-presentation.ts`
- `src/contexts/durable-compositor.ts`
- `src/contexts/layer-types.ts`
- `src/contexts/presentation-evaluator.ts`
- `src/contexts/layer-renderer.ts`
- `src/contexts/StoreContext.tsx`

Work:

- Reuse the shared presentation evaluator for bounds, affine composition,
  filters, vector scaling and frame translation; do not reintroduce arithmetic
  in a second renderer.
- Produce a durable layer projection containing durable snapshot metadata,
  materialized bitmap and materialized bounds. Keep retained operations empty
  once the presentation is baked.
- Hidden layers carry durable metadata and snapshot bounds but no bitmap or
  lease; visible-layer coverage remains all-or-nothing before publication.
- Stage the complete projection before publication, verify document identity,
  cursor, branch revision and layer coverage, then publish once.
- Carry baked pixels through an explicit disposable layer presentation field;
  preserve logical source and operations, and make the renderer bypass those
  operations only while that field is present. Never replace an editable source
  with an image merely to avoid double application.
- Track every published bitmap through the existing document presentation scope
  and release declined, stale and departed leases after publication decisions.

Acceptance:

- Runtime composition is byte-identical to legacy replay for every supported
  parity scenario and cursor, with no mixed layer publication.
- A forced bounds mismatch, stale cursor, missing layer or materialization error
  declines the whole durable composition and preserves the visible canvas.

### E. Undo/redo and runtime authority

Own navigation as a durable replay operation while retaining the compatibility
fallback for unsupported documents.

Production files:

- `src/contexts/useHistory.ts`
- `src/contexts/history-replay.ts` until fallback removal
- `src/contexts/StoreContext.tsx`
- `src/contexts/useLayer.ts`

Work:

- Replace the normal navigation path's legacy replay with durable replay,
  materialization and staged publication.
- Keep the legacy replay path behind one explicit fallback decision for
  unavailable durable documents or `legacy-tool` sources.
- Preserve preview clearing order: clear only after a successful publication;
  failed navigation must leave the draft and visible document intact.
- Ensure history append, branch truncation, disabled entries and cursor mapping
  use one durable timeline decision.

Acceptance:

- Undo, redo, history-panel navigation and disabled-entry toggles agree on
  layers, selections, frame, active layer and cursor.
- Empty-history and baseline behavior are explicit and do not blank the panel or
  document.
- Failure paths publish no partial transition and emit one attributable
  diagnostic.

### F. Export authority

Own raster and PSD export together from the durable projection.

Production files:

- `src/contexts/export-canvas.ts`
- `src/contexts/psd-utils.ts`
- `src/contexts/useFile.tsx`

Work:

- Move the durable-side record construction currently represented by
  `durableExportRecords()` into a production adapter shared by both formats.
- Source position from materialized bounds and all layer metadata from the
  durable replay snapshot; do not read those fields from legacy layers.
- Keep PSD flattened at export, preserving current layer order, visibility,
  opacity, blend mode, lock metadata and frame origin.
- On unavailable or unsupported durable state, use the complete legacy export
  input or fail before encoding; never combine durable and legacy layer records.

Acceptance:

- Raster and PSD outputs match the independent durable-versus-legacy differential
  for every supported layer family and cursor.
- A durable bounds/order/frame mutation turns the differential red.
- Export failure leaves the staged save dialog and document state intact.

### G. Authority retirement

Remove the legacy path only after Slices A-F are independently landed and all
gates pass. Retain a narrowly named compatibility fallback while unsupported
durable sources remain reachable; do not delete `history-replay.ts` merely
because the normal path no longer calls it.

## Gates

- `npm run tsc` passes after every production slice.
- Durable operation provenance is frozen, cloned and validated without aliasing.
- The history-panel differential covers titles, enabled flags and current state.
- The browser seam proves both durable publication and whole-document fallback.
- Runtime and export parity use independent durable records and exact byte
  comparison; jsdom-only filter/text limitations remain explicit pins.
- Lease tests prove stale, declined, replaced and document-disposed bitmaps are
  released exactly once.
- `npm run build` passes before each slice is merged.
- `npm run test:e2e` passes for the authority seam and navigation fallback.
- Tests are confidence work, not the definition of done; production contracts,
  ownership and failure behavior are reviewed independently.

## Test delegation

For each implementation slice, delegate focused unit-test files to Poolside
Laguna subagents after the production contract is fixed. Keep one test file per
agent, never let two agents edit the same file, and cap Laguna concurrency at
four sessions. Discard tests that encode a legacy
authority, compare two paths fed the same wrong input, or weaken a gate. The
coordinator owns integration, differential review and all Git operations.

## Landing and rollback

Each slice lands in its own branch and commit. The commit that changes a
production authority must include its differential and failure contract; do not
stage a later slice's tests as proof for an earlier one. If a gate fails, keep
the durable seam and diagnostics but leave the affected consumer on the complete
legacy fallback. Never repair a failure by weakening a differential, adding a
skip, or publishing a partial durable document.
