/**
 * The document frame may be moved by exactly three things: a `documentSource` at
 * index 0, a bedrock layer source at index 0 — together these are how the opening
 * document establishes its size — and an explicit `SET_DOCUMENT_FRAME` (the crop).
 * Nothing else may touch it.
 *
 * This file is the net for the reported defect of committing a tool growing the
 * canvas. `replayHistory` used to treat ANY entry carrying a bedrock layer source
 * as a document-size authority, and `documentFrameFromSize` hard-codes `x: 0, y: 0`
 * (`document-frame.ts:5-7`), so an ordinary layer commit dragged a cropped document
 * back to the origin. The rule is now gated to `index === 0`
 * (`history-replay.ts:103`); the cases below are the shapes production can write.
 *
 * `history-replay.branches.test.ts` covers the same rule from the other side — which
 * sources DO reframe, and which do not resize. What is pinned here is the ORIGIN:
 * that a crop survives, and that only the opening entry may override the frame that
 * the store currently holds.
 */
import { describe, expect, it, vi } from 'vitest';

import { documentFrameEquals } from '@/contexts/document-frame.ts';
import type { HistoryItem } from '@/contexts/history-types.ts';
import { replayHistory, type HistoryReplayDependencies } from '@/contexts/history-replay.ts';
import type { ImageLayerSource, Layer, LayerSource } from '@/contexts/layer-types.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  TOOL_ACTION,
} from '@/util/constants.ts';

const initialSize = { width: 400, height: 300 };

function createTestLayer(id: string, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: 40, height: 30 },
    operations: [],
    ...overrides,
  };
}

function createDependencies() {
  return {
    createLayer: vi.fn((input: Parameters<HistoryReplayDependencies['createLayer']>[0]) =>
      createTestLayer(input.layerId, { pos: { x: 0, y: 0, width: 40, height: 30 }, source: input.source })
    ),
    applyRasterTool: vi.fn((layer: Layer) => ({ ...layer, name: 'rasterized' })),
  } satisfies HistoryReplayDependencies;
}

const blankSource: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: { x: 5, y: 6, width: 40, height: 30 },
};

describe('replayHistory document frame invariance', () => {
  it('keeps a cropped frame when a bedrock new layer is committed after the crop', () => {
    const dependencies = createDependencies();
    // The origin is non-zero on purpose. The bedrock source below carries the current
    // document size, so a reframe reproduces the cropped EXTENT exactly; the origin is
    // the only part it destroys, and a zero-origin baseline would hide that.
    const croppedFrame = { x: 10, y: 20, width: 200, height: 150 };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: {
          layers: { 'layer-1': createTestLayer('layer-1') },
          size: initialSize,
          frame: croppedFrame,
        },
      },
      {
        id: 'bedrock',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        // Exactly what `MobileLayersDrawer.tsx:173` appends when the user presses
        // "New Layer" in the mobile drawer: `createBlankLayer({ color, opacity, size:
        // totalSize, isBedrock: true })` with NO second argument, so `replaceDocument`
        // defaults to false (`useLayer.ts:229`) and `_addLayer` takes the
        // `COMMIT_DOCUMENT_EDIT` branch (`useLayer.ts:219-225`) with the bedrock blank
        // source as its `layerSource` (`useLayer.ts:237-241`). That is the only
        // production writer that appends a bedrock source at an index above 0 — the
        // other `createBlankLayer` caller passes `true` (`useApp.ts:79`).
        layerSource: {
          kind: 'blank',
          color: '#ffffff',
          opacity: 1,
          isBedrock: true,
          size: { width: croppedFrame.width, height: croppedFrame.height },
        } satisfies LayerSource,
      },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    // Fails against the pre-fix code, which re-ran the bedrock assignment on every
    // index and so produced `{ x: 0, y: 0, width: 200, height: 150 }`.
    expect(result.documentFrame).toEqual(croppedFrame);
    expect(result.totalSize).toEqual({ width: 200, height: 150 });
    // Refusing to resize is not refusing the edit: the layer the user asked for is
    // still there.
    expect(Object.keys(result.layers)).toContain('layer-bedrock');
  });

  it('keeps a cropped document when the crop is followed by a bedrock add, as on mobile', () => {
    // The same rule as the case above with the crop in the position production puts
    // it. `useApp.ts:124` writes the opening `documentSource` frame as
    // `documentFrameFromSize(size)`, so a real timeline reaches the moved origin
    // through a `SET_DOCUMENT_FRAME` entry, not through the baseline — which is why
    // this ordering is the one a user can actually hit.
    const dependencies = createDependencies();
    const openingFrame = { x: 0, y: 0, width: 800, height: 600 };
    const croppedFrame = { x: 120, y: 90, width: 600, height: 400 };
    const history: HistoryItem[] = [
      {
        id: 'open',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: {
          layers: { 'layer-1': createTestLayer('layer-1') },
          size: openingFrame,
          frame: openingFrame,
        },
      },
      {
        id: 'crop',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        layerId: 'document',
        args: { previousFrame: openingFrame, nextFrame: croppedFrame },
      },
      {
        id: 'bedrock',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        // `size: totalSize` is the store's document size, and the store derives that
        // from the frame (`StoreContext.tsx:357`), so it is the cropped extent.
        layerSource: {
          kind: 'blank',
          color: '#ffffff',
          opacity: 1,
          isBedrock: true,
          size: { width: croppedFrame.width, height: croppedFrame.height },
        } satisfies LayerSource,
      },
    ];

    const result = replayHistory(history, 2, initialSize, dependencies);

    // Fails against the pre-fix code with `{ x: 0, y: 0, width: 600, height: 400 }`:
    // the crop's origin is dropped, so the document jumps by the crop offset.
    expect(result.documentFrame).toEqual(croppedFrame);
    expect(result.totalSize).toEqual({ width: 600, height: 400 });
  });

  it('holds the frame across every commit in a timeline and moves it only at the crop', () => {
    const dependencies = createDependencies();
    // A non-zero origin is what gives this test the power to fail at all: a reframe is
    // built by `documentFrameFromSize`, which hard-codes `x: 0, y: 0`
    // (`document-frame.ts:5-7`), so against a zero-origin baseline an accidental
    // reframe would be indistinguishable from holding the frame.
    const openingFrame = { x: 12, y: 34, width: 260, height: 190 };
    const croppedFrame = { x: 40, y: 60, width: 200, height: 150 };
    // `mergeAllLayers` writes the flattened raster as a NON-bedrock image source in
    // `args` (`useLayer.ts:680-702`), so a merge is a layer edit and not a document
    // size authority. A bedrock merge source would be a shape production cannot write.
    const mergeSource = {
      kind: 'image',
      bitmap: new OffscreenCanvas(8, 6),
      name: 'Merged Layer',
      pos: { ...openingFrame },
      isBedrock: false,
    } satisfies ImageLayerSource;
    const selection = {
      id: 'sel-1',
      points: [{ x: 1, y: 1 }],
      isActive: true,
      pos: { x: 1, y: 1, width: 5, height: 5 },
    };
    const commits: HistoryItem[] = [
      // A raster tool commit: `updateLayerByTool` writes the args alone
      // (`useLayer.ts:351-361`), so the entry carries no source at all.
      { id: 'raster', actionName: TOOL_ACTION, layerId: 'layer-base', args: { toolName: 'brush' } },
      // A geometry tool commit, which is what a moved figure writes.
      {
        id: 'geometry',
        actionName: TOOL_ACTION,
        layerId: 'layer-base',
        args: { toolName: 'reposition', resize: { x: 2, y: 3, width: 38, height: 28 } },
      },
      // A non-bedrock new layer. The paste and layer-via-copy paths append exactly
      // this shape mid-history (`useSelectionClipboard.ts:76-80`), so a layer added
      // by a user gesture is in the timeline the user is in.
      {
        id: 'paste',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-pasted',
        layerSource: {
          kind: 'image',
          bitmap: new OffscreenCanvas(40, 30),
          name: 'Layer 2',
          pos: { x: 5, y: 6, width: 40, height: 30 },
        } satisfies ImageLayerSource,
      },
      { id: 'merge', actionName: MERGE_ACTION, layerId: 'layer-merged', args: mergeSource },
      // A reorder names the moved layer, not the document (`StoreContext.tsx:372-378`).
      {
        id: 'reorder',
        actionName: REORDER_ACTION,
        layerId: 'layer-merged',
        args: { layerToMoveId: 'layer-merged', afterWhichLayerId: null },
      },
      {
        id: 'selection',
        actionName: SELECTION_ACTION,
        layerId: 'selection',
        args: {
          previousSelectionState: { selections: [], activeSelectionId: null },
          nextSelectionState: { selections: [selection], activeSelectionId: selection.id },
        },
      },
      { id: 'rename', actionName: RENAME_LAYER_ACTION, layerId: 'layer-merged', args: { name: 'Renamed' } },
      // A hide is a layer-property patch, so it carries `visible` in its args
      // (`useLayer.ts:479-497`).
      { id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-merged', args: { visible: false } },
      { id: 'remove', actionName: REMOVE_ACTION, layerId: 'layer-merged', args: {} },
    ];
    const crop: HistoryItem = {
      id: 'crop',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      layerId: 'document',
      args: { previousFrame: openingFrame, nextFrame: croppedFrame },
    };
    const history: HistoryItem[] = [
      {
        id: 'open',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-base',
        documentSource: {
          layers: { 'layer-base': createTestLayer('layer-base') },
          size: initialSize,
          frame: openingFrame,
        },
      },
      ...commits,
      crop,
    ];
    const cropIndex = history.length - 1;

    const frames = history.map((_, index) => replayHistory(history, index, initialSize, dependencies).documentFrame);

    // "The frame moved at exactly one index, and it is the crop" is the assertion,
    // rather than one expectation per action. A list of per-action checks would go on
    // passing if some other action moved the frame as well, as long as the crop's own
    // check still held.
    const movedAt = frames.flatMap((frame, index) =>
      index > 0 && !documentFrameEquals(frame, frames[index - 1]) ? [index] : []
    );
    expect(movedAt).toEqual([cropIndex]);
    expect(frames).toEqual([...Array.from({ length: cropIndex }, () => openingFrame), croppedFrame]);
    expect(replayHistory(history, 0, initialSize, dependencies).totalSize).toEqual({ width: 260, height: 190 });
    expect(replayHistory(history, cropIndex, initialSize, dependencies).totalSize).toEqual({
      width: 200,
      height: 150,
    });
  });

  it('lets only the initial entry override the current frame, not an identical bedrock entry at index 1', () => {
    // `File > New` calls `createBlankLayer(params, true)` (`useApp.ts:79`), so
    // `_addLayer` replaces the document and writes a SINGLE history entry whose only
    // entry is a bedrock `NEW_LAYER` at index 0 (`useLayer.ts:192-214`). Legacy replay
    // overrides the store's current frame there on purpose, so undoing back to the
    // opening restores the document that was opened.
    // `history-replay.branches.test.ts:216` already pins that override. What it does
    // not pin is the boundary: the same entry one index later is an ordinary layer
    // add, and it must leave the frame the baseline established alone.
    const dependencies = createDependencies();
    const baselineFrame = { x: 1, y: 2, width: 300, height: 200 };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: {
          layers: { 'layer-1': createTestLayer('layer-1') },
          size: initialSize,
          frame: baselineFrame,
        },
      },
      {
        id: 'bedrock',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        layerSource: {
          kind: 'blank',
          color: '#000000',
          opacity: 1,
          isBedrock: true,
          size: { width: 800, height: 600 },
        } satisfies LayerSource,
      },
    ];

    // `initialFrame` is the store's CURRENT frame, the size the document is at now.
    const result = replayHistory(history, 1, initialSize, dependencies, { x: 0, y: 0, width: 400, height: 300 });

    // Fails against the pre-fix code with `{ x: 0, y: 0, width: 800, height: 600 }`,
    // the same override the opening entry is entitled to.
    expect(result.documentFrame).toEqual(baselineFrame);
    expect(result.totalSize).toEqual({ width: 300, height: 200 });
    expect(Object.keys(result.layers)).toContain('layer-bedrock');
  });

  it('refuses a document source carried mid-history', () => {
    // Unreachable in production today, and deliberately pinned as a parity repair: the
    // only writer of a `documentSource` is `REPLACE_DOCUMENT` with `history: [entry]`
    // (`useApp.ts:116-144`, `useLayer.ts:192-214`), so an entry always lands at index
    // 0. Carried mid-history it would replace the layer record and resize the canvas
    // from anywhere in the timeline, the same class of defect as the mid-history
    // bedrock source, and the durable converter already refuses it as
    // `document-replacement` (`history-adapter.ts:641`). Replay refuses it too
    // (`history-replay.ts:89`).
    // `history-replay.branches.test.ts:76` still pins the pre-refusal behaviour and is
    // being re-pointed separately; this is the replacement.
    const dependencies = createDependencies();
    const replacementFrame = { x: 7, y: 8, width: 640, height: 480 };
    const history: HistoryItem[] = [
      // The source of this entry is not what the case is about; it stands in for
      // whatever created the document's first layer.
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      {
        id: 'replace',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-9',
        documentSource: {
          layers: { 'layer-9': createTestLayer('layer-9', { order: 4 }) },
          size: { width: 640, height: 480 },
          frame: replacementFrame,
        },
      },
    ];

    // A non-zero origin on the current frame, so a replacement that resets the origin
    // cannot hide behind an identical extent.
    const result = replayHistory(history, 1, initialSize, dependencies, { x: 4, y: 5, width: 300, height: 200 });

    expect(result.documentFrame).toEqual({ x: 4, y: 5, width: 300, height: 200 });
    expect(result.totalSize).toEqual({ width: 300, height: 200 });
    // Refusing the replacement is not clearing the document: the index-0 layer stands.
    expect(Object.keys(result.layers)).toEqual(['layer-1']);
    expect(result.layers['layer-9']).toBeUndefined();
  });
});
