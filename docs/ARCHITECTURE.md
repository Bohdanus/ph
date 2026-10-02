# Architecture

What this code is, and the handful of facts about it that are expensive to
rediscover.

Read [`FEATURES.md`](FEATURES.md) first if you want to know what the app does.
This page is about how.

## The one fact that costs newcomers the most

**`store.durableDocument` is a complete, correctly-typed, fully-populated
document that is not the truth.**

It has eleven operation kinds, a versioned schema, deep-frozen clones, an asset
registry with generation counters and a memoizing materialization cache. It is
rebuilt on every commit and every navigation. It is read at exactly one place.
Four separate files say so in comments, and a newcomer who reads
`src/contexts/history-model.ts` first will conclude the opposite.

The corollary is the one that bites: **`store.history` is the only thing that
rendering, export and undo read, and it stores args, never pixels.** Undo re-runs
the tool processors. It is not an inverse operation and it is not incremental.

Evidence, all four current:

- `src/contexts/StoreContext.tsx:131` — _"Diagnostic shadow only; legacy
  history/runtime layers remain authoritative during cutover."_
- `src/contexts/StoreContext.tsx:133` — _"A non-current sidecar must never be
  used as a replay or export input."_
- `src/contexts/useHistory.ts:75-77` — _"Navigation therefore replays the legacy
  runtime representation and lets StoreContext rebuild the sidecar."_
- `src/contexts/replay-coordinator.ts:62-65` — _"No production path mounts a
  coordinator… and this module must not be imported by a navigation or rendering
  path while the legacy runtime stays authoritative."_

`src/contexts/materialization.ts` and `src/contexts/replay-coordinator.ts` have no
importer outside `__tests__/`.

## The store

`src/contexts/StoreContext.tsx`, 1186 lines, a `useReducer`.

- `reducer(state: StoreData, action: Action)` at `:459`, wired at `:784`.
- `Action` is a local union of **31** types (`:186-279`), with
  `StoreDispatch` exported at `:281`.
- **29 reducer arms, not 31.** `ADOPT_LAYER_BITMAPS` is deliberately arm-less — the
  dispatcher registers it and returns without forwarding (`:199-215`). `SET_ORIGINAL_IMAGE`
  falls through to `default: return state` (`:654`).
- **The dispatcher is not the reducer.** `dispatch` at `:800` intercepts seven
  types, computes `latestStateRef.current = reducer(currentState, action)` _before_
  dispatching, and only then calls `rawDispatch`: `PROMOTE_LAYER_PRESENTATIONS`,
  `ADOPT_LAYER_BITMAPS`, `PUBLISH_RUNTIME_PRESENTATION`, `REORDER_LAYERS`,
  `COMMIT_DOCUMENT_EDIT`, `APPLY_HISTORY_REPLAY`, `REPLACE_DOCUMENT`.

`StoreData` has 33 top-level fields (`:82-144`): five refs, four imperative
handles, five file/image fields, one tool field, three layer fields, five selection
fields, eight history fields and two colours. Tool _args_ are deliberately not in
it — only `toolName` (`:111`).

Surrounding it, `src/App.tsx:129-148` nests seven providers: `File`, `Theme`,
`Store`, `KeyboardEvents`, `CurrentTool`, `PanelLayout`, `RightPanelVisibility`.
`CurrentTool` holds live tool args outside the reducer, because options bars
change at pointer rate and re-rendering the whole tree on every slider tick is not
acceptable. `src/contexts/ImageContext.tsx` is 18 lines, entirely commented out.

## The pipeline, one gesture

Traced through Smudge, a `usePaintStroke` consumer:

1. **Down.** `usePaintStroke.ts:176` gates on `isPointerDownValid` (`:178`), maps
   to a document point (`:166-167`, `:180`), seeds the gesture array.
2. **Move.** `:197` appends and calls `onMove(gesture)` (`:204`) — the live array,
   deliberately not a copy (`:53-54`). `SmudgeToolArea.tsx:84-99` rebases
   document→layer-local and merges into the current args.
3. **Preview.** `src/contexts/useLayer.ts:525` `tempUpdateLayer` — commented
   _"THE ONE place a tool's pixels or geometry reach a layer"_ (`:531`). It looks
   the processor up (`findToolProcessor`, `:538`) and runs the curried
   `imageProcessor({bitmap, size})(toolArgs)` (`:603-605`). The result is stored in
   `previewLayersRef`, **not** in state.
4. **Render.** `drawAllLayers()` merges previews over layers (`:634-639`) and calls
   `drawLayersToCanvas` (`:641`).
5. **Up.** `usePaintStroke.ts:216` copies the gesture (`:234`) — because it is
   about to become history args — and commits (`:237`).
6. **Commit.** `useLayer.ts:323` `updateLayerByTool`. Gating order matters: the
   processor, then the layer, then **`isLayerLocked`** (`:334`, above every branch,
   so a locked layer cannot get a history state with no pixel change), then the
   commit kind. It re-runs the same processor over the same args (`:346`) —
   idempotent, not incremental — normalises the args (`:349`), and dispatches
   `COMMIT_DOCUMENT_EDIT` with a history item built by
   `src/contexts/history-utils.ts:81`, which deep-clones args and freezes them.
7. **Publish.** The dispatcher appends to the timeline, decides the durable
   append, rebuilds the durable shadow and projects the published timeline
   (`StoreContext.tsx:948-1019`). Presentation caches are promoted through
   `PROMOTE_LAYER_PRESENTATIONS` (`:1113-1140`).

The args object is `ToolArgs`, a `toolName`-discriminated union
(`src/contexts/tool-types.ts:28-85`). **This is why commits are pure functions of
their args**: the durable replay has nothing else to replay from.

**Not every tool takes this path.** The Eraser — the example its own JSDoc cites —
rolls its own handlers with rAF coalescing and Shift-click line semantics
(`src/components/Main/EraserToolArea.tsx:117-215`) rather than using
`usePaintStroke`. Both converge on the same two writers in `useLayer.ts`.

## The layer model

`src/contexts/layer-types.ts`, quoted in the source. Three source kinds (`blank`,
`image`, `tool`), two operation kinds (`filter`, `affine-transform`), and a
`Layer` with `bitmap` and `tmpCanvas` as the two raster slots.

The pixel payload is `BitmapSource` (`src/contexts/general-types.ts:72`):
`ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas`. Not
`ImageData`, which appears only as transport inside `psd-utils.ts` and the
pixel-loop tools.

**Operations are the canonical editable form; rendered bitmaps are disposable
materializations** — the source says so at `layer-types.ts:30`. That is the
non-destructive mechanism: re-running a tool appends an operation rather than
destroying pixels.

One subtlety: `kind` is **optional** on `FilterLayerOperation` (`:36`), so
`LayerOperation` is nominally two discriminants but is actually one plus a
structural test — `layer-renderer.ts:26` branches on `'args' in operation`. The
optional discriminant is a compatibility hole for documents written before
operations were discriminated; the guard is what decides.

## Rendering

`src/contexts/layer-renderer.ts`, 146 lines, eight functions, four of them
exported.

**Stage, then publish.** `drawLayersToCanvas` (`:113`) draws every layer into a
freshly created `document.createElement('canvas')` (`:120-128`) and only then
resizes the visible canvas, clears it and blits the staging result (`:136-141`). A
source or processor that throws leaves the visible canvas exactly as it was
(`:108-112`). Callers act on the boolean: `useHistory.ts:112-114` throws rather
than dispatching a transition whose pixels were never produced.

Per layer: `ctx.globalAlpha = layer.opacity` (`:100`),
`ctx.globalCompositeOperation = layer.blendMode` (`:101`), then `ctx.filter =
getLayerFilter(layer.operations)` (`:77`) before the draw. Affine composes first,
then the filter stack (`:83-86`).

**`mix-blend-mode` appears nowhere in `src/`.** Blend modes are canvas2D composite
operators only, with Photoshop's names mapped in `psd-utils.ts:16-33`.

`ctx.filter` is set in five places: `layer-renderer.ts:77`, `materialization.ts:247`,
and the three processors `tools/blur.ts:11`, `tools/colors.ts:12`,
`tools/levels.ts:12`. **It is set with no capability check**, which `HANDOFF.md`
§130 records as a live defect: on a browser without `ctx.filter`, a blur becomes a
silent no-op that history then records as pixels.

### The presentation cache

`src/contexts/layer-presentation.ts`. Two caches per layer: `tmpCanvas` for a
pending preview, `bitmap` for a promoted one. Promotion replaces the mutable
canvas with an immutable `ImageBitmap`
(`materializePresentationBitmap`, `:53-63`; reducer at
`StoreContext.tsx:526`).

`DocumentPresentationScope` (`:134`) owns them, and is **provider-scoped rather than
document-scoped** — the rationale is at `StoreContext.tsx:786-791`. It closes only
the bitmaps it created (`:41-43`), releases on document teardown (`:185`), and
retires unreferenced ones against a liveness thunk (`:165-172`).

The guard that makes a promotion safe is `layersDifferOnlyByPresentation`
(`:96-112`) over `PRESENTATION_FIELDS = ['bitmap', 'tmpCanvas']` (`:70`): a
publication that also moves logical state is refused and `console.error`'d with the
offending ids (`StoreContext.tsx:848-872`).

## Two history systems

### The legacy timeline — the production authority

`HistoryItem[]` plus `historyIndex`. Two exported types, `NewHistoryItem` and the
`HistoryItem` that extends it with an `id` and a `disabled` flag
(`src/contexts/history-types.ts:12-25`): an `actionName` from 12 constants, a
`layerId`, optional `layerSource`, optional `documentSource`, and `args` — **the
tool's args, never pixels.**

Undo is **a full replay from index zero**:
`for (let index = 0; index <= targetIndex; index += 1)`
(`src/contexts/history-replay.ts:72`), from an empty accumulator (`:66-70`),
re-running each entry's processor through injected dependencies
(`useHistory.ts:86-103`). `undo` is `resetHistoryTo(historyIndex - 1)` (`:52`);
`redo` is `+1` (`:61`); `toggleDisabled` flips one entry and replays the same cursor
(`:157`).

The timeline is unbounded and strictly linear — `branchRevision` is a monotonic
counter, not a branch (`src/contexts/history-timeline.ts:28-32`).

### The durable document — the shadow

Typed in `src/contexts/history-model.ts`: eleven operation kinds
(`create-layer`, `remove-layer`, `set-layer-properties`, `reposition-layer`,
`reorder-layers`, `apply-filter`, `apply-affine-transform`,
`apply-raster-processor`, `set-document-frame`, `merge-document`,
`set-selection`), wrapped in a versioned entry, deep-frozen on
every write (`freezeDurableDocument` `:306`, `cloneOperation` `:254`).

The boundary is `history-adapter.ts`: `legacyHistoryToDurable` (`:568`) in,
`DurableDocument` (`history-model.ts:138-146`) out, with a whitelist —
`LAYER_PROPERTY_BY_ACTION` (`:376`), `deriveSetSelectionEntry` (`:342`),
`operationForTool` (`:473-551`). An unsupported tool throws
`UnsupportedHistoryFeatureError` (`:550`) rather than fabricating a no-op, and one
`severity: 'error'` diagnostic voids the whole document
(`convertLegacyHistorySafely` `:856-889`).

Rasters are named, not embedded. A durable raster is `{ assetId, width, height }`
(`history-model.ts:21-28`), and an `AssetId` is _"only meaningful through the
runtime asset registry"_ (`history-model.ts:6-7`). `AssetRegistry` is both an
ownership ledger and a memoizing LRU of derived materializations
(`asset-registry.ts:296-366`, capped at 64 MiB / 64 entries, `:70-71`). Durable rasters
are registered with `ownership: 'borrow'` (`history-adapter.ts:138-142`), so the
shadow can never close a bitmap the legacy path still owns.

**Production callers, exhaustively:** `convertLegacyHistorySafely` from
`StoreContext.tsx:666`; `decideDurableAppend` from `:907` and `:962`;
`replayDurableDocument` from `:892` — once, and only to read the shadow's layer
order as a reorder gate. `materializeLayer`, `materializeDocument` and
`ReplayCoordinator` have none.

## The tool registry

Two registries with different key sets, which is easy to misread as one:

- **`src/tools/toolsMap.ts`** — 41 entries, one per `ToolName`. Each spreads its
  processor and adds an `icon` and a `toolboxComponent`. This is the whole-tool
  map, including `eyedropper`, which has _only_ icon and component (`:125-127`),
  and the six pen-family `placeholderTool` entries (`:128-153`).
- **`src/tools/toolProcessors.ts`** — 40 entries, `PixelToolName` derived by
  `Exclude` from `PIXEL_FREE_TOOLS` (`:88`, `:91`), which is how a tool that needs
  no raster stays out of this registry. Each entry is curried: `(params) => (args) =>
pixels`, where `params` carries the layer's raster and size and `args` the stroke
  (`:58-68`). `commit` is one of eight kinds (`:48-56`) and `replay` is a typed
  descriptor naming a durable operation.

`toolbar-mapping.ts` (repository root) maps toolbar tiles to tools. Each **nested
array is one flyout tile** (`:33`), and the first item in a group is that tile's
default (`SidebarLeft.tsx:588`, `toolbar-mapping.ts:69-70`); the two-column rail
is derived from that order (`:35`). Selecting a tile that carries a `figure`
patches the shape tool's args before switching
(`src/components/SidebarLeft/SidebarLeft.tsx:580-583`). The flyout opens on a
250 ms sustained press (`SidebarLeft.tsx:101`) and not on hover, deliberately
(`:587-595`).

## Options bars

One directory per tool under `src/components/ToolbarsRight/`, mounted by
`ToolbarHorizontal/ToolbarHorizontal.tsx:14` from
`toolsMap[toolName]?.toolboxComponent`. The
component contract takes **no props** (`ToolbarsRight/types.ts:3`) — it reads the
live args from `useCurrentTool()` (`src/contexts/useCurrentTool.tsx:11-16`), which
is why it re-renders at slider rate without touching the store.

Settings persist through `saveLastSettings` (`src/contexts/useCurrentTool.tsx:62`)
into a **module-level singleton** (`src/tools/settings.ts:343`), seeded from
`defaultSettings` (`:51-314`), with per-tool geometry stripped and an
`exhaustiveness` trap at the end (`src/util/settings.ts:152-153`).

**Two comments in the tree contradict that and are wrong**:
`ToolbarsRight/Sharpen/Sharpen.tsx:112` and `ToolbarsRight/Smudge/Smudge.tsx:114`
both state that settings round-trip through `localStorage`. Grepping `localStorage`
across `src/` returns two keys — `theme` and `panelLayout`. **Tool settings do not
survive a reload.** Recorded in `HANDOFF.md`.

## Selection

A selection is a polygon point list with a bounding box
(`src/contexts/general-types.ts:61-70`), stored in the store as `selections` plus
`activeSelectionId`. Readers are ants, hit-testing
(`isPointInPolygon`, `src/util/selection.ts:294`) and geometry
(`getSelectionRect`, `src/util/selection.ts:107`).

An alpha mask exists but is **derived on demand**, and one production path reaches
it: `copySelectionToCanvas` → `copyFeatheredPolygonSelectionToCanvas`
(`src/util/selection.ts:762-822`) for clipboard and copy-to-layer. Feather is a parameter of
that copy.

`src/contexts/selection-baseline.ts` owns one rule: the baseline a selection
history entry restores to. `deriveSelectionBaseline` (`:56`) scans the **unbounded**
timeline, and must. A selection is created by a gesture that writes no history
entry, so bounding the search at the replay target makes undoing a tool-switch
deselect a silent no-op. The module's JSDoc (`:46-55`) says it; the reasoning is
in project memory under `selection_baseline_helper`.

## File I/O

The async shape is **promise-resolver refs over a hidden `<input type=file>`**, not
a callback API (`src/contexts/useFile.tsx:53-55`, `:101-107`), with a `cancel`
listener resolving `null`.

Decoding is sniff-then-dynamic-import. `loadDocumentFile`
(`src/contexts/image-load-save-utils.ts:68`) reads the first 64 bytes (`:69`) and
dispatches per format; the fallback is `FileReader.readAsDataURL` plus
`new Image()` (`:113-136`). PSD is `ag-psd` (`psd-utils.ts:70`, typed at
`psd-utils.ts:1`), dispatched behind the sniff branch at `:70` and decoded
`ImageData` → canvas (`psd-utils.ts:140-145`).

`createImageBitmap` appears in six places. Four are the **immutability
boundary** rather than the decode path — `useLayer.ts:80`, `useApp.ts:24`,
`layer-presentation.ts:53`, `asset-registry.ts:226` — and two are
materializations: `useLayer.ts:679` in `mergeAllLayers`, and
`materialization.ts:178`. Synchronous paths use
`OffscreenCanvas.transferToImageBitmap()` instead
(`asset-registry.ts:94-107`).

**There is no worker.** `ImageBitmapTransfer` and `Transferable` have zero
occurrences in `src/`. `OffscreenCanvas` is used for working surfaces only, never
off the main thread.

Saving branches once for PSD in `useFile.tsx:120-123`, then
`saveImageToDisk` uses `canvas.toBlob` for PNG/JPEG/WebP
(`image-load-save-utils.ts:203`) and a dynamic-import `switch` for the six
hand-written encoders (`:147-178`).

## Layer ownership, and where the coordinates change

Four coordinate spaces, and mixing them is the most common source of defects in
this codebase:

| Space       | What it is                                                                            |
| ----------- | ------------------------------------------------------------------------------------- |
| client      | Pointer event coordinates on screen                                                   |
| local       | Client coordinates divided by the contain-fit scale (`usePointerPosition.ts:227-230`) |
| document    | Local plus the `DocumentFrame` offset — the space a tool's args are stored in         |
| layer-local | Document minus the layer's own `pos` (`src/util/layer-space.ts`)                      |

A layer's raster is layer-local; a tool's args are document-space. The conversion
between them is `documentPointsToLayerLocal`.

This is the codebase's most reliable defect class, and also the one with the
largest false-positive rate: `HANDOFF.md` §132 investigated exactly this and
concluded the three conversions in the shape path were already correct. It
derives the arithmetic; it is not pinned by a test. Read the conversion at both
call sites before assuming the other one is wrong.
