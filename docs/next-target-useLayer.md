# Next Tier 1 Target: `src/contexts/useLayer.ts` — Test Plan

> **Superseded.** Recovered from `stash@{0}` on 2026-09-28. This plan is obsolete:
> every Priority A-F area is now covered by six `useLayer.*` test files that did not
> exist when it was written, and its Priority A "THE RACE" is not a real race — it
> was never one. It did walk past two production defects, both now fixed. See
> **`AUDIT-STASHED-DOCS.md`**. Kept as the historical record of what was stashed;
> do not work from it.

> **Priority:** High — 27.69% statement / 18.05% branch coverage. Central layer CRUD with the text-tool double-commit race.
> **Source lines:** 604
> **Estimated effort:** 2–3 focused test files
> **Constraint:** Do not modify production source files.

---

## 1. Why This Matters

`useLayer.ts` is the **central layer management module** — it exposes `createLayerFromTool`, `createBlankLayer`, `createLayerFromBitmap`, `updateLayerByTool`, `commitDirtyTool`, `removeLayer`, `toggleVisibility`, `moveLayerAfter`, `applyDocumentCrop`, and `mergeAllLayers` via a single hook on top of `useStore`.

The handoff (HANDOFF.md §3.1) documents an **active double-commit race condition** in the text tool where two separate code paths (`Text.tsx:81-86` direct commit and `useLayer.ts:277-288` deferred commit) can each create a layer from the same tool args:

1. `Text.tsx` calls `createLayerFromTool({ args: toolArgs })` — Path 1
2. `commitDirtyTool()` (called from `createBlankLayer`, `createLayerFromBitmap`, or `updateLayerByTool`) reads `currentArgsRef.current` which may still hold stale text args — Path 2

`commitDirtyTool` is called at the start of `createBlankLayer` (line 142) and `createLayerFromBitmap` (line 160) when `!replaceDocument`, and again inside `updateLayerByTool` (line 260) with `deferDispatch = true`. The text-specific branch (lines 281-288) calls `createLayerFromTool` again, creating the duplicate.

There is no deduplication mechanism — each `createLayerFromTool` call dispatches `NEW_LAYER_ACTION` independently, and `createLayerFromTool` at line 187 has `commitDirtyTool()` commented out ("causes infinite recursion").

---

## 2. Coverage Gap Breakdown

### Currently Covered (~28%)

- Basic export wiring and dispatch pattern

### Uncovered Paths (250+ statements)

| Function                | Lines   | Key Uncovered Logic                                                                                                                                                                                |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_addLayer`             | 103-139 | `REPLACE_DOCUMENT` vs `COMMIT_DOCUMENT_EDIT` branching; `newDocument` parameter handling; `createHistoryItem` integration                                                                          |
| `createBlankLayer`      | 141-157 | `commitDirtyTool` call, `replaceDocument = true/false` paths, source creation, history item construction                                                                                           |
| `createLayerFromBitmap` | 159-183 | Bedrock vs non-bedrock size computation, replaceDocument flow                                                                                                                                      |
| `createLayerFromTool`   | 185-226 | `pos` present vs absent path; `rect`-based coordinate transform (`canvasToDocumentPos`, `reduceRect`, `sortedRectToPos`); `clearOverlay` call                                                      |
| `updateLayerByTool`     | 228-274 | `flattenRequired` path (mergeAllLayers), `normalizeCommittedToolArgs`, deferred dispatch, `commitDirtyTool(true)`                                                                                  |
| `commitDirtyTool`       | 277-339 | **Text special case (281-288)** — the double-commit race path; `deferDispatch` behavior; `pendingToolEdits` dispatch loop; preview layer finalization; `saveLayerCanvas` calls                     |
| `removeLayer`           | 341-372 | Next-active-layer computation, deleted layers tracking, overlay clearing                                                                                                                           |
| `updateLayer`           | 374-390 | Layer patching, dispatch, `drawAllLayers` call                                                                                                                                                     |
| `moveLayerAfter`        | 392-410 | `reorderLayers` integration, dispatch, `drawAllLayers` call                                                                                                                                        |
| `tempUpdateLayer`       | 419-497 | **All branches**: trapezoid transform path (429-454), layer-operation commit (456-465), geometry commit (467-475), image processor path (477-497), `processor.commit` switching, position patching |
| `cancelLayerPreview`    | 499-502 | Preview deletion, `drawAllLayers` call                                                                                                                                                             |
| `drawAllLayers`         | 504-526 | Empty vs non-empty preview layers, `resizeCanvas`, `drawLayer` loop, visibility skip, error handling                                                                                               |
| `applyDocumentCrop`     | 528-547 | `trimRect`/`sortRect`/`isValidDocumentFrame` validation, dispatch with `SET_DOCUMENT_FRAME_ACTION`                                                                                                 |
| `mergeAllLayers`        | 549-581 | `createImageBitmap`, `MERGE_ACTION` dispatch                                                                                                                                                       |

---

## 3. Test Strategy

### 3.1 Mock Architecture

The hook depends on `useStore()` which returns `[state, dispatch]`. The test should mock `StoreContext.tsx` to provide controllable state and assert on `dispatch` calls.

```tsx
const mockDispatch = vi.fn();
const storeState = vi.hoisted({
  layers: {},
  activeLayerId: null,
  totalSize: { width: 800, height: 600 },
  documentFrame: null,
  toolName: 'draw',
  currentArgs: { current: {} },
  previewLayers: { current: {} },
  // ...etc
});

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [storeState, mockDispatch],
}));
```

The hook also imports several dependencies that should be mocked:

- `layer-utils.ts` — `createLayerOperation`, `createAffineLayerOperation`, `createLayerSource`, `getSortedLayersArray`, `reorderLayers`, `saveLayerCanvas`
- `layer-renderer.ts` — `drawLayer`
- `canvas.ts` → `util/canvas.ts` — `resizeCanvas`
- `toolProcessors.ts` — `toolProcessors`, `CreatorToolParams`, `ProcessorToolParams`
- `util/rect.ts` — `reduceRect`, `sortRect`, `sortedRectToPos`, `trimRect`
- `util/constants.ts` — action types
- `history-utils.ts` — `createHistoryItem`
- `document-frame.ts` — frame utilities

### 3.2 Priority Test Areas

#### Priority A: `commitDirtyTool` Text Special Case (lines 277-288) — THE RACE

```
Given: toolName === 'text', currentArgsRef.current has { text: 'hello', rect: {...}, toolName: 'text' }
When:  commitDirtyTool() is called
Then:  createLayerFromTool({ args }) is called once
And:   currentArgsRef.current is cleared ({ ...args, text: '' })
And:   returned layers includes the new layer
```

**Edge cases:**

- `currentArgsRef.current` has text but no rect → should return `layers` unchanged (early return at line 283)
- `currentArgsRef.current` has rect but no text → should return `layers` unchanged
- Non-text tool (e.g., 'draw') → should skip text special case, enter the generic path (lines 290-338)

#### Priority B: `createLayerFromTool` Coordinate Transform (lines 185-226)

Two sub-paths:

1. **`pos` absent (line 192)**: extracts `args.rect`, converts via `sortedRectToPos` + `canvasToDocumentPos`, computes worldRect + `reduceRect`, builds source with adjusted `rect` and `pos`
2. **`pos` present (line 207)**: directly converts `pos` via `canvasToDocumentPos`, clones args

Both call `clearOverlay()` and return the `newLayer`.

**Edge case:** args without `rect` when `pos` is absent → throws `'Missing rect in args'` (line 194)

#### Priority C: `tempUpdateLayer` Branch Matrix (lines 419-497)

Four distinct paths based on `toolArgs`:

1. **Transform with trapezoid (429-454):** calls `isTrapezoidOnlyTransform`, may `createAffineLayerOperation`
2. **Transform without trapezoid (438-454):** calls `transformToolArgsToAffine`, `createAffineLayerOperation`, sets preview layer
3. **`processor.commit === 'layer-operation'` (456-465):** calls `createLayerOperation`, sets preview layer
4. **`processor.commit === 'geometry'` (467-475):** applies `move`/`resize` position patch
5. **Default (477-497):** calls `processor.imageProcessor`, sets `tmpCanvas`, may set `source: undefined` for raster

**Key branches within default path:**

- `processor.commit === 'raster'` or (isTransformArgs && trapezoid !== 0) → strips source
- `positionPatch` present vs absent
- `layer.tmpCanvas ?? layer.bitmap` for bitmap source

**Error guards:**

- Layer not found (line 424) → returns early
- `!bitmap && !processor.creator` → console.error, returns (line 478-481)

#### Priority D: `_addLayer` Dispatch Branching (lines 103-139)

- `newDocument` present → `REPLACE_DOCUMENT` with `documentId: uuidv4()`
- `newDocument` absent → `COMMIT_DOCUMENT_EDIT` with `historyItem`

#### Priority E: `commitDirtyTool` Generic Path (lines 290-339)

- `previewLayersRef.current` non-empty → iterates, builds `committedLayers`, collects `pendingToolEdits`
- `hasPreviewLayers` false → returns `committedLayers` (clone of layers) unchanged
- `hasPreviewLayers && !deferDispatch` → dispatches `UPDATE_LAYERS` or `COMMIT_DOCUMENT_EDIT` per pending edit
- `hasPreviewLayers && deferDispatch` → no dispatch

#### Priority F: `updateLayerByTool` Async Paths (lines 228-274)

- `processor.commit === 'document-operation'` → early return (line 232)
- `processor.flattenRequired` → calls `mergeAllLayers`, applies image processor, dispatches
- Default → `tempUpdateLayer` + `commitDirtyTool(true)` + `normalizeCommittedToolArgs` + dispatch

### 3.3 Secondary Test Areas

#### `removeLayer` (341-372)

- Active layer removed → next active = last sorted remaining layer
- Active layer removed and no remaining layers → `nextActiveLayerId = null`
- Non-active layer removed → `activeLayerId` unchanged
- Overlay clearing on `toolOverlayRef`

#### `moveLayerAfter` (392-410)

- `reorderLayers` called with correct params
- Dispatch with `REORDER_ACTION`
- `drawAllLayers` called

#### `toggleVisibility` (414-417)

- Toggles `visible` property
- Dispatches with `SHOW_LAYER_ACTION` or `HIDE_LAYER_ACTION`

#### `applyDocumentCrop` (528-547)

- `trimRect`/`sortRect` produce zero-size rect → returns `false`
- `isValidDocumentFrame` returns false → returns `false`
- `documentFrameEquals` (current equals new) → returns `false`
- Normal case → dispatches `SET_DOCUMENT_FRAME_ACTION`

#### `mergeAllLayers` (549-581)

- `createImageBitmap` called on `canvasRef.current`
- Returns `null` if no canvas
- Dispatch with `MERGE_ACTION`

---

## 4. Test File Structure

### File 1: `src/contexts/__tests__/useLayer.commit.test.ts`

- `commitDirtyTool` text path (lines 277-288)
- `commitDirtyTool` generic path (lines 290-339)
- `commitDirtyTool` with `deferDispatch = true` vs `false`
- `createLayerFromTool` with and without `pos`
- `createLayerFromTool` missing rect error

### File 2: `src/contexts/__tests__/useLayer.tempUpdate.test.ts`

- `tempUpdateLayer` transform+trapezoid path
- `tempUpdateLayer` transform without trapezoid path
- `tempUpdateLayer` layer-operation path
- `tempUpdateLayer` geometry path
- `tempUpdateLayer` default image-processor path (with/without positionPatch, with/without source stripping)
- Error guards (missing layer, no bitmap)
- `cancelLayerPreview`

### File 3: `src/contexts/__tests__/useLayer.crud.test.ts`

- `createBlankLayer` with/without replaceDocument
- `createLayerFromBitmap` bedrock vs non-bedrock, replaceDocument
- `_addLayer` REPLACE_DOCUMENT vs COMMIT_DOCUMENT_EDIT
- `removeLayer` (active/non-active, next-active computation)
- `updateLayer` (dispatch + drawAllLayers)
- `moveLayerAfter` (reorder + dispatch + drawAllLayers)
- `toggleVisibility` (show/hide dispatch)
- `applyDocumentCrop` (valid, zero-size, same frame, invalid frame)
- `mergeAllLayers` (with/without canvas)
- `updateLayerByTool` (document-operation early return, flattenRequired path, default path)

---

## 5. Constraints & Project Memory

Key constraints that affect testing:

- **`async_replay_revision_guard`**: Every async history replay result must be rejected if document/branch revision is stale. `updateLayerByTool` is async; ensure tests don't assert on stale revisions after async resolution.
- **`materialization_operation_order`**: Materialization must evaluate raster boundaries, affine transforms, and filters in original operation order. The `tempUpdateLayer` transform path calls `transformToolArgsToAffine` + `createAffineLayerOperation` which feeds into materialization.
- **`durable_asset_reachability_cache_deduplication`**: Tests should not hold references to dispatched layers longer than needed.
- **`legacy_durable_cursor_mapping`**: Cursor lookup must not fall back to durable history tip — not directly relevant here since `useLayer.ts` is the runtime path.

## 6. Testing Patterns (from Established Files)

Follow patterns from existing passing test files:

- **`history-append.test.ts`**: Uses `vi.fn()` for injected collaborators, asserts on the decision shape a refusal returns
- **`ShapeToolArea.test.tsx`**: Mocks `useStore`, uses `vi.useFakeTimers()` for RAF-related async
- **`usePointerPosition.test.ts`**: `renderHook` pattern for hook-only testing and direct pointer-state assertions
- **`useCurrentTool.test.tsx`**: `renderHook` with `CurrentToolProvider` wrapper, `lastSavedSettings` reset in `beforeEach`

Key mocking patterns:

- Use `vi.hoisted()` for state shared between mock and test
- Mock at the module level with `vi.mock(path, () => ({ ... }))`
- Reset mock state in `beforeEach`, restore in `afterEach`
- Use `vi.useFakeTimers()` for async/RAF tests, `vi.useRealTimers()` in cleanup

## 7. References

| Location                                           | Purpose                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/contexts/useLayer.ts`                         | Full source (604 lines)                                                                                                  |
| `src/contexts/__tests__/useLayer.history.test.tsx` | Existing partial test file (29.47% coverage of useLayer.ts) — must be checked for conflicts                              |
| `src/contexts/layer-utils.ts`                      | `createLayerSource`, `createLayerOperation`, `createAffineLayerOperation`                                                |
| `src/tools/toolProcessors.ts`                      | `toolProcessors` table — `commit` field values ('layer-operation', 'geometry', 'raster', 'source', 'document-operation') |
| `src/contexts/affine-transform.ts`                 | `isTrapezoidOnlyTransform`, `transformToolArgsToAffine`, `isIdentityAffineTransform`                                     |
| `src/contexts/document-frame.ts`                   | `canvasToDocumentPos`, `documentFrameFromSize`, `canvasRectToDocumentFrame`                                              |
| `src/util/rect.ts`                                 | `trimRect`, `sortRect`, `reduceRect`, `sortedRectToPos`                                                                  |
