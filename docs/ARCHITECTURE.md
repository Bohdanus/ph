# Architecture

What this code is, and the handful of facts about it that are expensive to
rediscover.

Read [`FEATURES.md`](FEATURES.md) first if you want to know what the app does.
This page is about how.

## The one fact that costs newcomers the most

**`store.durableDocument` is a complete, correctly-typed, fully-populated
document that is not the truth.**

It has twelve operation kinds, a versioned schema, deep-frozen clones, an asset
registry with generation counters and a memoizing materialization cache. It is
rebuilt on every commit and every navigation. `durableDocument` itself is read at
exactly one place — `StoreContext.tsx`. Four comments across three files say so,
and a newcomer who reads `src/contexts/history-model.ts` first will conclude the
opposite.

`durableStatus` is a second thing and has its own readers: `DevStatusStrip` and
the crash screen display it, so "read at one place" is a claim about
`durableDocument`, not about the shadow as a whole.

The corollary is the one that bites: **`store.history` is the only thing that
rendering, export and undo read, and it stores args, never pixels.** Undo re-runs
the tool processors. It is not an inverse operation and it is not incremental.

Evidence, all four current:

- `src/contexts/StoreContext.tsx` — the doc comment on `StoreData`'s
  `durableDocument` field — _"Diagnostic shadow only; legacy history/runtime
  layers remain authoritative during cutover."_
- `src/contexts/StoreContext.tsx` — the doc comment on the `durableStatus` field
  beside it — _"A non-current sidecar must never be used as a replay or export
  input."_
- `src/contexts/useHistory.ts` — inside `resetHistoryTo()` — _"Navigation
  therefore replays the legacy runtime representation and lets StoreContext
  rebuild the sidecar."_
- `src/contexts/replay-coordinator.ts` — the `ReplayCoordinator` class JSDoc —
  _"No production path mounts a coordinator… and this module must not be imported
  by a navigation or rendering path while the legacy runtime stays
  authoritative."_

`src/contexts/materialization.ts` has one production importer,
`src/contexts/durable-compositor.ts`, and **that compositor is no longer isolated**:
`StoreContext.tsx`'s `publishDurableNavigationPresentation()` calls
`composeDurableDocument()` on the navigation path, so the durable document now
feeds a presentation cache. It does not feed logical state — the composition is
staged off-tree, every layer is checked by `durablePresentationIsRendererIdentical()`
against the legacy replay and a mismatch is declined, and the publication goes
through `PUBLISH_RUNTIME_PRESENTATION`, whose `layersDifferOnlyByPresentation()`
guard refuses any logical movement. `publishDurableNavigationPresentation()` also
returns early while any snapshot in the replay carries a `'legacy-tool'` source,
so the durable presentation is skipped outright for a document still holding a
legacy tool snapshot.
`src/contexts/replay-coordinator.ts` still has no importer outside `__tests__`.

The requirements and staged cutover sequence are owned by
[`HISTORY-MIGRATION.md`](HISTORY-MIGRATION.md). This page records the current
implementation boundary and does not duplicate the migration contract.

## The store

`src/contexts/StoreContext.tsx`, a `useReducer`. Its length moves with every
commit, so count it with `wc -l src/contexts/StoreContext.tsx` rather than
trusting a figure stored here.

- `reducer(state: StoreData, action: Action)`, wired by
  `useReducer(reducer, initialState)`.
- `Action` is a local union of **29** types, with `StoreDispatch` exported beside
  it. Count them with `sed -n '/^export type Action =$/,/CLEAR_SELECTIONS/p' src/contexts/StoreContext.tsx | grep -cE "^  \| (\{|ReorderLayersAction)"`.
- **`StoreAction`, not `Action`, is 31.** The union split into `Action` (public),
  `InternalAction` (`PUBLISH_RUNTIME_PRESENTATION`, `ADOPT_LAYER_BITMAPS`) and
  `StoreAction = Action | InternalAction`, with `PublicAction` an alias of
  `Action`; `StoreDispatch` dispatches `PublicAction`, so neither internal type is
  consumer-dispatchable.
- **The reducer's 29 arms are not the `Action` 29.** `ADOPT_LAYER_BITMAPS` is
  deliberately arm-less — the dispatcher registers it and returns without
  forwarding, in its own `dispatchAction()` branch. `SET_ORIGINAL_IMAGE` falls
  through to the reducer's `default: return state`. `PUBLISH_RUNTIME_PRESENTATION`
  is the offset the other way: it is an `InternalAction` and it does have an arm.
  `sed -n '/^function reducer(/,/^}/p' src/contexts/StoreContext.tsx | grep -cE "^    case '"` is
  the arm count.
- **The dispatcher is not the reducer.** `dispatchAction()` intercepts seven
  types, computes `latestStateRef.current = reducer(currentState, action)` _before_
  dispatching, and only then calls `rawDispatch`: `PROMOTE_LAYER_PRESENTATIONS`,
  `ADOPT_LAYER_BITMAPS`, `PUBLISH_RUNTIME_PRESENTATION`, `REORDER_LAYERS`,
  `COMMIT_DOCUMENT_EDIT`, `APPLY_HISTORY_REPLAY`, `REPLACE_DOCUMENT`.

`StoreData` has 35 top-level fields: seven refs, four imperative
handles, five file/image fields, one tool field, three layer fields, five selection
fields, eight history fields and two colours. The seven refs are the five
`RefObject`s the type's `// refs` block opens with plus `currentArgs` and
`previewLayers`, which are ref objects too — the two a five-ref count drops. Re-derive with
`sed -n '/^export type StoreData = {/,/^};/p' src/contexts/StoreContext.tsx | grep -cE '^  [a-zA-Z]+[?]?:'`.
Tool _args_ are deliberately not in
it — only `toolName`.

Surrounding it, `src/App.tsx`'s provider tree nests seven providers: `File`,
`Theme`, `Store`, `KeyboardEvents`, `CurrentTool`, `PanelLayout`,
`RightPanelVisibility`. `CurrentTool` holds live tool args outside the reducer,
because options bars change at pointer rate and re-rendering the whole tree on
every slider tick is not acceptable. `src/contexts/ImageContext.tsx` is 18 lines,
entirely commented out.

## The pipeline, one gesture

Traced through Smudge, a `usePaintStroke` consumer:

1. **Down.** `usePaintStroke.ts` — `handlePointerDown()` — gates on
   `isPointerDownValid`, maps through `toDocumentPoint()` and seeds the gesture
   array.
2. **Move.** `usePaintStroke.ts` — `handlePointerMove()` — appends and calls
   `onMove(gesture)`: the live array, deliberately not a copy, which the `onMove`
   callback's own JSDoc states. `SmudgeToolArea.tsx`'s `onMove` callback rebases
   document→layer-local and merges into the current args.
3. **Preview.** `src/contexts/useLayer.ts` — `tempUpdateLayer()` — commented
   _"THE ONE place a tool's pixels or geometry reach a layer"_. It looks
   the processor up (`findToolProcessor`) and runs the curried
   `imageProcessor({bitmap, size})(toolArgs)`. The result is stored in
   `previewLayersRef`, **not** in state.
4. **Render.** `drawAllLayers()` merges previews over layers and calls
   `drawLayersToCanvas()`.
5. **Up.** `usePaintStroke.ts` — `handlePointerUp()` — copies the gesture,
   because it is about to become history args, and commits that copy.
6. **Commit.** `useLayer.ts` — `updateLayerByTool()`. Gating order matters: the
   processor, then the layer, then **`isLayerLocked`**, above every branch,
   so a locked layer cannot get a history state with no pixel change, then the
   commit kind. It re-runs the same processor over the same args — by calling
   `tempUpdateLayer()` again — idempotent, not incremental — normalises the args
   with `normalizeCommittedToolArgs()`, and dispatches
   `COMMIT_DOCUMENT_EDIT` with a history item built by
   `src/contexts/history-utils.ts`'s `createHistoryItem()`, which deep-clones args
   and freezes them.
7. **Publish.** `StoreContext.tsx`'s `dispatchAction()` appends to the timeline,
   decides the durable append, rebuilds the durable shadow and projects the
   published timeline. Presentation caches are promoted by
   `promoteLayerPresentation()`, through `PROMOTE_LAYER_PRESENTATIONS`.

The args object is `ToolArgs`, a `toolName`-discriminated union — the
`ToolArgsByName` map and the `ToolArgs` union it is indexed into, in
`src/contexts/tool-types.ts`. **This is why commits are pure functions of
their args**: the durable replay has nothing else to replay from.

**Not every tool takes this path.** The Eraser — the example its own JSDoc cites —
rolls its own handlers with rAF coalescing and Shift-click line semantics
(`src/components/Main/EraserToolArea.tsx` — `handlePointerDown()` and its move and
up siblings) rather than using `usePaintStroke`. Both converge on the same two
writers in `useLayer.ts`.

## The layer model

`src/contexts/layer-types.ts`, quoted in the source. Three source kinds (`blank`,
`image`, `tool`), two operation kinds (`filter`, `affine-transform`), and a
`Layer` with `bitmap` and `tmpCanvas` as the two raster slots.

The pixel payload is `BitmapSource`, declared in
`src/contexts/general-types.ts`: `ImageBitmap | HTMLCanvasElement |
HTMLImageElement | OffscreenCanvas`. Not
`ImageData`, which appears only as transport inside `psd-utils.ts` and the
pixel-loop tools.

**Operations are the canonical editable form; rendered bitmaps are disposable
materializations** — the source says so in the comment above
`FilterLayerOperation`. That is the
non-destructive mechanism: re-running a tool appends an operation rather than
destroying pixels.

One subtlety: `kind` is **optional** on `FilterLayerOperation`, so
`LayerOperation` is nominally two discriminants but is actually one plus a
structural test — `layer-renderer.ts`'s `enabledFilterOperations()` branches on
`'args' in operation`. The
optional discriminant is a compatibility hole for documents written before
operations were discriminated; the guard is what decides.

## Rendering

`src/contexts/layer-renderer.ts`, eleven functions of which four are exported —
`getLayerFilter()`, `drawLayerSource()`, `drawLayer()` and `drawLayersToCanvas()` —
counted with `grep -cE '^(export )?function ' src/contexts/layer-renderer.ts`. The
file's length moves with every commit, so count it with
`wc -l src/contexts/layer-renderer.ts` rather than trusting a figure stored here.

**Stage, then publish.** `drawLayersToCanvas()` draws every layer into a
freshly created `document.createElement('canvas')` and only then
resizes the visible canvas, clears it and blits the staging result. A
source or processor that throws leaves the visible canvas exactly as it was —
`restoreVisibleCanvas()` is what puts it back. Callers act on the boolean:
`useHistory.ts`'s `resetHistoryTo()` throws rather
than dispatching a transition whose pixels were never produced.

Per layer: `ctx.globalAlpha = layer.opacity` and then
`ctx.globalCompositeOperation = layer.blendMode`, both inside `drawLayer()`, then
`ctx.filter = getLayerFilter(layer.operations)` before the draw, the string itself
built by `getLayerFilter()`. Affine composes first,
then the filter stack, inside `drawLayerSource()`.

**`mix-blend-mode` appears nowhere in `src/`.** Blend modes are canvas2D composite
operators only, with Photoshop's names mapped by the `blendModes` table in
`psd-utils.ts`.

`ctx.filter` is assigned in **four** places: `drawEvaluatedPresentation()` in
`presentation-evaluator.ts`, and the three processors `blur()` in `tools/blur.ts`,
`colors()` in `tools/colors.ts`, `levels()` in `tools/levels.ts`.
`grep -rn "ctx.filter *=" src/` returns those four plus
`supportsCanvasFilter()` in `canvas-filter.ts`, which writes a filter and reads it
back to detect support and then restores what it read — a probe, not an
application. `materialization.ts` assigns none: `materializeLayer()` builds
presentation descriptors, delegates the draw, and calls `requireCanvasFilter()` on a
`requiresCanvasFilter` processor on the way. **Every one of the four is behind a
capability check** — `requireCanvasFilter()` is the first statement of each
processor, and `requireLayerFilterSupport()` runs in `drawLayerSource()` before it
delegates the draw — so an engine that ignores the write raises
`CanvasFilterUnsupportedError` rather than applying the filter as a silent no-op, and
`drawLayersToCanvas()` catches that per layer and skips it.

**The renderer holds no assignment of its own.** `drawLayerSource()` builds a
`PresentationOperation[]`, evaluates it with `evaluatePresentationForDraw()`, calls
`requireLayerFilterSupport()`, and hands the result to `drawEvaluatedPresentation()`,
which owns the `ctx.filter` write. A claim that `layer-renderer.ts` assigns
`ctx.filter` no longer resolves: `grep -n "ctx.filter" src/contexts/layer-renderer.ts`
returns exactly **one** line, and it is the guard's comment, not the guard —
`requireLayerFilterSupport()` delegates to `requireCanvasFilter()` and never names
`ctx.filter` in its body.

### The presentation cache

`src/contexts/layer-presentation.ts`. Two caches per layer: `tmpCanvas` for a
pending preview, `bitmap` for a promoted one. Promotion replaces the mutable
canvas with an immutable `ImageBitmap` — `materializePresentationBitmap()`, applied
by the reducer's `PROMOTE_LAYER_PRESENTATIONS` arm in `StoreContext.tsx`.

`DocumentPresentationScope` owns them, and is **provider-scoped rather than
document-scoped** — the rationale is the comment above the `useMemo` that builds
one `presentationScope` in `StoreContext.tsx`. It closes only
the bitmaps it created — `closePresentationBitmap()` — releases on document teardown
— `DocumentPresentationScope.releaseDocument()` — and
retires unreferenced ones against a liveness thunk —
`DocumentPresentationScope.retireUnreferenced()`.

The guard that makes a promotion safe is `layersDifferOnlyByPresentation()`
over `PRESENTATION_FIELDS = ['bitmap', 'tmpCanvas']`: a
publication that also moves logical state is refused and `console.error`'d, with the
offending ids from `divergentLayerIds()`, by the dispatcher's
`PUBLISH_RUNTIME_PRESENTATION` branch in `StoreContext.tsx`.

## Two history systems

### The legacy timeline — the production authority

`HistoryItem[]` plus `historyIndex`. Two exported types, `NewHistoryItem` and the
`HistoryItem` that extends it with an `id` and a `disabled` flag
(`src/contexts/history-types.ts`): an `actionName` from the **13** members of
`ActionType` in `src/util/constants.ts` (a fourteenth, `UPDATE_LAYER_ACTION`, is
commented out of the union and must stay that way), a
`layerId`, optional `layerSource`, optional `documentSource`, and `args` — **the
tool's args, never pixels.**

Undo is **a full replay from index zero**:
`src/contexts/history-replay.ts`'s `replayHistory()` walks
`for (let index = 0; index <= targetIndex; index += 1)`
from an empty accumulator, re-running each entry's processor through the
`applyRasterTool` dependency that `useHistory.ts`'s `resetHistoryTo()` injects.
`undo()` is `resetHistoryTo(historyIndex - 1)`;
`redo()` is `+1`; `toggleDisabled()` flips one entry and replays the same cursor.

The timeline is unbounded and strictly linear — `branchRevision` is a monotonic
counter, not a branch, and `updateHistoryTimeline()` in
`src/contexts/history-timeline.ts` is its only writer.

### The durable document — the shadow

Typed in `src/contexts/history-model.ts`: twelve operation kinds
(`create-layer`, `remove-layer`, `set-layer-properties`, `reposition-layer`,
`reorder-layers`, `apply-filter`, `apply-affine-transform`,
`apply-raster-processor`, `set-document-frame`, `replace-layer-source`,
`merge-document`, `set-selection`), wrapped in a versioned entry, deep-frozen on
every write by `freezeDurableDocument()`, one operation at a time by
`cloneOperation()`. `replace-layer-source` is the lossless source-edit kind:
`history-adapter.ts` emits it, `durable-replay.ts` replays it, and
`history-append.ts`'s `replaceLayerSourceProblem()` refuses any shape that is not
the canonical one.

The boundary is `history-adapter.ts`: `legacyHistoryToDurable()` in,
`DurableDocument` (also in `history-model.ts`) out, with a whitelist —
`LAYER_PROPERTY_BY_ACTION`, `deriveSetSelectionEntry()`,
`operationForTool()`. An unsupported tool throws
`UnsupportedHistoryFeatureError` from `operationForTool()` rather than fabricating
a no-op, and one
`severity: 'error'` diagnostic voids the whole document, which
`convertLegacyHistorySafely()` does.

Rasters are named, not embedded. A durable raster is `{ assetId, width, height }` —
the `'raster'` arm of `DurableLayerSource` — and an `AssetId` is
_"only meaningful through the runtime asset registry"_, which is the JSDoc on
`AssetId` itself. `AssetRegistry` is both an
ownership ledger and a memoizing LRU of derived materializations —
`AssetRegistry.materialize()`, capped at 64 MiB / 64 entries by
`DEFAULT_MAX_CACHE_BYTES` and `DEFAULT_MAX_CACHE_ENTRIES`. Durable rasters
are registered with `ownership: 'borrow'` — by `registerRaster()` — so the
shadow can never close a bitmap the legacy path still owns.

**Production callers, exhaustively:** `convertLegacyHistorySafely` from
`StoreContext.tsx`'s `buildDurableDocument()`; `decideDurableAppend` from
`dispatchAction()`'s `REORDER_LAYERS` and `COMMIT_DOCUMENT_EDIT` branches;
`replayDurableDocument` from **two** sites, not one — `durableLayersAtCursor()`,
which feeds `sourceBackedEntryContext()` the shadow's own layer order, and that
same `REORDER_LAYERS` branch, where the order is read a second time and compared
as a sequence against the reorder being planned. `publishDurableNavigationPresentation()`
adds a third durable read, through `replayDurableAtCursor()`. `materializeDocument` has one
production caller, `composeDurableDocument()` in `durable-compositor.ts`;
`materializeLayer` is reached only from inside `materializeDocument()` and has no
importer of its own; `ReplayCoordinator` has none.

## The tool registry

Two registries with different key sets, which is easy to misread as one:

- **`src/tools/toolsMap.ts`** — **44** entries, and **exactly one per `ToolName`**:
  `ToolName` is `keyof ToolArgsByName`, which has **44** members, and the two key
  sets are **identical** — only the declaration order differs. Prove the equality by
  `diff`-ing two sorted key lists:
  `awk '/^export type ToolArgsByName = \{/,/^\};/' src/contexts/tool-types.ts | grep -oE "^  '?[a-zA-Z][a-zA-Z0-9-]*'?:" | tr -d " ':" | sort`
  against the same pipeline over
  `awk '/^export const toolsMap: ToolsMap = \{/,/^\};/' src/tools/toolsMap.ts`.
  **A `[a-zA-Z]+` pattern undercounts**, because it drops the **19** hyphenated keys
  (`polygonal-lasso`, `feather-magnetic-lasso`, `color-replacement`,
  `add-anchor-point`, `custom-shape` and fifteen more) — 44 − 19 = 25, which is how a
  44-entry map came to be documented as 25 members and as "not one per `ToolName`".
  Each entry spreads its processor and adds an `icon` and a `toolboxComponent`. The
  whole-tool map therefore includes the `eyedropper` entry, which has _only_ icon and
  component, and **seven** `placeholderTool` entries — the six-key `pen` group
  (`pen`, `freeform-pen`, `curvature-pen`, `add-anchor-point`,
  `delete-anchor-point`, `convert-point`) plus `custom-shape`, which uses its own
  `custom-shape` group. Count them with
  `awk '/^export const toolsMap: ToolsMap = \{/,/^\};/' src/tools/toolsMap.ts | grep -cE "^  '?[a-zA-Z-]+'?:"`;
  the quoted keys are why the `-` is required in that character class.
- **`src/tools/toolProcessors.ts`** — **43** entries, `PixelToolName` derived by
  `Exclude` from `PIXEL_FREE_TOOLS`, both declared in `toolProcessors.ts`, which
  is how a tool that needs
  no raster stays out of this registry — `PIXEL_FREE_TOOLS` is `['eyedropper']`, the
  one member, which is why the two registries differ by exactly one. Each entry is
  curried: `(params) => (args) => pixels`, where `params` carries the layer's
  raster and size and `args` the stroke — the shape `ToolProcessorDefinition.imageProcessor` declares.
  `commit` is one of eight kinds, `ToolCommitKind`, and `replay` is a typed
  descriptor naming a durable operation.

`toolbar-mapping.ts` (repository root) maps toolbar tiles to tools. Each **nested
array is one flyout tile**, which `toolbarMap`'s JSDoc states, and the first item
in a group is that tile's default — `SidebarLeft.tsx`'s `renderToolGroup()` states
the same rule as its own contract, and in `toolbar-mapping.ts` the default is the
entry carrying the tile's `shortcut`; the two-column rail
is derived from that same order. Selecting a tile that carries a `figure`
patches the shape tool's args before switching —
`SidebarLeft.tsx`'s `selectTool()`. The flyout opens on a
250 ms sustained press — `FLYOUT_LONG_PRESS_MS` — and not on hover, deliberately,
which `renderToolGroup()`'s contract comment states in as many words.

## Options bars

One directory per tool under `src/components/ToolbarsRight/`, mounted by
`ToolbarHorizontal()` in `ToolbarHorizontal/ToolbarHorizontal.tsx` from
`toolsMap[toolName]?.toolboxComponent`. The
component contract takes **no props** — `ToolbarRightComponent`, in
`ToolbarsRight/types.ts` — it reads the
live args from `useCurrentTool()`, the `CurrentToolContextState` declared in
`src/contexts/useCurrentTool.tsx`, which
is why it re-renders at slider rate without touching the store.

Settings persist through `saveLastSettings()`, called from `_setToolArgs()` in
`src/contexts/useCurrentTool.tsx`,
into a **module-level singleton** — `lastSavedSettings`, in
`src/tools/settings.ts` — seeded from
`defaultSettings`, with per-tool geometry stripped and an
`exhaustiveness` trap at the end of the other `saveLastSettings()`, in
`src/util/settings.ts`.

**Two comments in the tree contradict that and are wrong**:
the clamp JSDoc above `amount` and `radius` in
`ToolbarsRight/Sharpen/Sharpen.tsx`, and the one above `tip` in
`ToolbarsRight/Smudge/Smudge.tsx`,
both state that settings round-trip through `localStorage`. Grepping `localStorage`
across `src/` returns two keys — `theme` and `panelLayout`. **Tool settings do not
survive a reload.** Recorded in `HANDOFF.md`.

## Selection

A selection is a polygon point list with a bounding box, which is the `Selection`
type in `src/contexts/general-types.ts`, and it is stored in the store as
`selections` plus `activeSelectionId`. Readers are ants, hit-testing
(`isPointInPolygon()`, in `src/util/selection.ts`) and geometry
(`getSelectionRect()`, in the same module).

An alpha mask exists but is **derived on demand**, and one production path reaches
it: `copySelectionToCanvas()` → `copyFeatheredPolygonSelectionToCanvas()`, both in
`src/util/selection.ts`, for clipboard and copy-to-layer. Feather is a parameter of
that copy.

`src/contexts/selection-baseline.ts` owns one rule: the baseline a selection
history entry restores to. `deriveSelectionBaseline()` scans the **unbounded**
timeline, and must. A selection is created by a gesture that writes no history
entry, so bounding the search at the replay target makes undoing a tool-switch
deselect a silent no-op. Its own JSDoc says so; the reasoning is
in project memory under `selection_baseline_helper`.

## File I/O

The async shape is **promise-resolver refs over a hidden `<input type=file>`**, not
a callback API — the three resolver refs `FileProvider` holds, and
`openLoadImageDialog()`, in `src/contexts/useFile.tsx` — with a `cancel`
listener resolving `null`.

Decoding is sniff-then-dynamic-import. `loadDocumentFile()`,
in `src/contexts/image-load-save-utils.ts`, reads the first 64 bytes as its
`signature` and dispatches per format; the fallback is `loadImageFile()`'s
`FileReader.readAsDataURL` plus
`new Image()`. PSD is `ag-psd` — `loadPsd()` in `psd-utils.ts` imports it
dynamically, and its types come from that module's
`import type … from 'ag-psd'` — dispatched behind `loadDocumentFile()`'s PSD sniff
branch, and decoded
`ImageData` → canvas by `psd-utils.ts`'s recursive `visit()` layer reader.

`createImageBitmap` appears in **seven** production call sites. Four are the
**immutability boundary** rather than the decode path — `immutableRaster()` in `useLayer.ts`,
`immutableRaster()` in `useApp.ts`,
`materializePresentationBitmap()` in `layer-presentation.ts`,
`AssetRegistry.registerBaselineAsync()` in `asset-registry.ts` — and three are
materializations: `mergeAllLayers()` in `useLayer.ts` (through its `mergeLayers()`
helper), and a `toOwnedBitmap()` in **each** of `materialization.ts` and
`durable-compositor.ts`. That pair is a verbatim private duplicate — the same
signature and the same `globalThis.createImageBitmap(canvas)` body — and neither is
exported. Synchronous paths use
`OffscreenCanvas.transferToImageBitmap()` instead —
`immutableRasterCopy()`, in `asset-registry.ts`.

**There is no worker.** `ImageBitmapTransfer` and `Transferable` have zero
occurrences in `src/`. `OffscreenCanvas` is used for working surfaces only, never
off the main thread.

Saving branches once for PSD in `useFile.tsx`'s `handleImageSave()`, then
`saveImageToDisk()`, in `src/contexts/image-load-save-utils.ts`, uses
`canvas.toBlob` for PNG/JPEG/WebP
and a dynamic-import `switch` for the six
hand-written encoders, which the same function reaches through
`resolveImageFormat()`.

## Layer ownership, and where the coordinates change

Four coordinate spaces, and mixing them is the most common source of defects in
this codebase:

| Space       | What it is                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- |
| client      | Pointer event coordinates on screen                                                                 |
| local       | Client coordinates divided by the contain-fit scale (`getLocalCoords()` in `usePointerPosition.ts`) |
| document    | Local plus the `DocumentFrame` offset — the space a tool's args are stored in                       |
| layer-local | Document minus the layer's own `pos` (`src/util/layer-space.ts`)                                    |

A layer's raster is layer-local; a tool's args are document-space. The conversion
between them is `documentPointsToLayerLocal`.

This is the codebase's most reliable defect class, and also the one with the
largest false-positive rate: `HANDOFF.md` §132 investigated exactly this and
concluded the three conversions in the shape path were already correct. It
derives the arithmetic; it is not pinned by a test. Read the conversion at both
call sites before assuming the other one is wrong.
