import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import { freezeDurableDocument, type DurableDocument, type DurableOperation } from '../history-model.ts';
import { materializeLayer } from '../materialization.ts';
import type { DurableReplayLayer } from '../durable-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import {
  OPEN_DOCUMENT_ACTION,
  TOOL_ACTION,
  NEW_LAYER_ACTION,
  SHOW_LAYER_ACTION,
  HIDE_LAYER_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  REMOVE_ACTION,
  MERGE_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SELECTION_ACTION,
} from '../../util/constants.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';

const layerId = 'layer-1';
const layer2Id = 'layer-2';
const layer3Id = 'layer-3';
const mergedLayerId = 'layer-merged';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };
const layerPos = { x: 20, y: 30, width: 120, height: 80 };

function createOwnedBitmap(width = 10, height = 10) {
  const close = vi.fn();
  return { bitmap: { width, height, close } as unknown as ImageBitmap, close };
}

function createBaselineLayer(id = layerId, pos = { ...layerPos }): Layer {
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
    pos,
    presentationBounds: null,
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { ...pos },
    },
    operations: [],
  };
}

function blankLayerSource(pos: { x: number; y: number; width: number; height: number }, isBedrock: false = false) {
  return {
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    isBedrock,
    pos: { ...pos },
  };
}

function convert(registry: AssetRegistry | undefined, ...items: HistoryItem[]): DurableDocument {
  const result = legacyHistoryToDurable(
    [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: {
          layers: { [layerId]: createBaselineLayer() },
          size: initialSize,
          frame: baselineFrame,
        },
      },
      ...items,
    ],
    { documentId: 'test-ops', registry }
  );
  return result.document;
}

describe('replayDurableDocument layer operation semantics (P1.8)', () => {
  it('create-layer makes a new layer visible at the tip and absent at prior cursors', () => {
    const registry = new AssetRegistry();
    convert(registry, {
      id: 'new-layer',
      actionName: NEW_LAYER_ACTION,
      layerId: layer2Id,
      layerSource: blankLayerSource(layerPos),
    });
    const document = convert(registry, {
      id: 'new-layer',
      actionName: NEW_LAYER_ACTION,
      layerId: layer2Id,
      layerSource: blankLayerSource(layerPos),
    });

    const atBaseline = replayDurableDocument(document, -1);
    expect(atBaseline.layers[layer2Id]).toBeUndefined();

    const atTip = replayDurableDocument(document);
    expect(atTip.layers[layer2Id]).toBeDefined();
    // The runtime rule's name and order, as one derivation: `createLayerSource`
    // numbers a new layer at `maxLayerOrder(layers) + 1` and puts that same number
    // in its name suffix, and the baseline's only layer sits at order 0. The
    // converter used to bind the bare kind at `Math.max(-1, ...orders) + 1`, so
    // this read `'Blank'` at order 0 for the very first layer of a document.
    expect(atTip.layers[layer2Id]?.snapshot.name).toBe('Blank 1');
    expect(atTip.layers[layer2Id]?.snapshot.order).toBe(1);
    expect(atTip.layers[layer2Id]?.operations).toHaveLength(0);
    expect(atTip.activeLayerId).toBe(layer2Id);

    void registry;
  });

  it('remove-layer drops the layer at the tip and retains it at prior cursors', () => {
    // The previous fixture converted a `REMOVE_ACTION` for a layer the baseline
    // never contained — `documentSource` below holds only `layer-1` — so the
    // delete was a silent no-op and the single assertion read a DIFFERENT,
    // surviving layer. The name promised a tip-versus-prior-cursor comparison
    // and delivered neither.
    //
    // The fixture is now a genuine create-then-remove, so the removal has
    // something to remove at the tip and something it reveals before it. The
    // shapes and the registry scope follow the create/remove pair below.
    //
    // This test replaces `remove-layer drops an existing layer when it was
    // created earlier`, which built the same document and asserted only two of
    // the reads below, at the tip, with no `activeLayerId` and no prior-cursor
    // comparison. Every assertion it made is a subset of the ones here, and it
    // never called `registry.shutdown()`.
    const registry = new AssetRegistry();
    try {
      const document = legacyHistoryToDurable(
        [
          {
            id: 'baseline',
            actionName: OPEN_DOCUMENT_ACTION,
            layerId,
            documentSource: {
              layers: { [layerId]: createBaselineLayer() },
              size: initialSize,
              frame: baselineFrame,
            },
          },
          {
            id: 'add-layer',
            actionName: NEW_LAYER_ACTION,
            layerId: layer2Id,
            layerSource: blankLayerSource(layerPos),
          },
          {
            id: 'remove-layer',
            actionName: REMOVE_ACTION,
            layerId: layer2Id,
          },
        ],
        { documentId: 'rm-tip-test', registry }
      ).document;

      // Cursor 0: the create has run, so the layer exists — and it is the active
      // one, because `create-layer` is what sets `activeLayerId` in the reducer.
      const atCreate = replayDurableDocument(document, 0);
      expect(atCreate.layers[layer2Id]).toBeDefined();
      expect(atCreate.activeLayerId).toBe(layer2Id);

      // Cursor 1, the tip: the remove has run, the layer is gone, and
      // `activeLayerId` fell back to the remaining layer rather than dangling.
      const atTip = replayDurableDocument(document, 1);
      expect(atTip.layers[layer2Id]).toBeUndefined();
      expect(atTip.layers[layerId]).toBeDefined();
      expect(atTip.activeLayerId).toBe(layerId);

      // Replaying BACK to cursor 0 brings the layer back, and it reads the same
      // as the forward read did. Note what this does and does not show: these
      // two comparisons are a purity check — `replayDurableDocument(document,
      // cursor)` returns the same value for the same inputs regardless of what
      // was replayed before it, which is what `replayDurableAtCursor` relies on
      // being called on every render. They cannot detect a wrong removal, which
      // the assertions above already pin; they only catch replay acquiring state
      // between calls.
      const backToCreate = replayDurableDocument(document, 0);
      expect(backToCreate.layers[layer2Id]).toBeDefined();
      expect(backToCreate).toEqual(atCreate);

      // And the tip still reads the same after the backward replay.
      expect(replayDurableDocument(document, 1)).toEqual(atTip);
    } finally {
      registry.shutdown();
    }
  });

  it('set-layer-properties (show/hide) toggles visibility in replay', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer() },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        { id: 'hide', actionName: HIDE_LAYER_ACTION, layerId },
        { id: 'show', actionName: SHOW_LAYER_ACTION, layerId },
      ],
      { documentId: 'vis-test', registry }
    ).document;

    const atHide = replayDurableDocument(document, 0);
    expect(atHide.layers[layerId]?.snapshot.visible).toBe(false);

    const atShow = replayDurableDocument(document, 1);
    expect(atShow.layers[layerId]?.snapshot.visible).toBe(true);

    void registry;
  });

  it('set-layer-properties (rename) changes the layer name in replay', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer() },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        { id: 'rename', actionName: RENAME_LAYER_ACTION, layerId, args: { name: 'Renamed' } },
      ],
      { documentId: 'rename-test', registry }
    ).document;

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.snapshot.name).toBe('Renamed');

    void registry;
  });

  it('reorder-layers changes layer order in the replay snapshot', () => {
    const registry = new AssetRegistry();
    const layer2 = createBaselineLayer(layer2Id);
    layer2.order = 1;
    const layer3 = createBaselineLayer(layer3Id);
    layer3.order = 2;

    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer(), [layer2Id]: layer2, [layer3Id]: layer3 },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: layer3Id,
          args: { layerToMoveId: layer3Id, afterWhichLayerId: layerId },
        },
      ],
      { documentId: 'reorder-test', registry }
    ).document;

    const replay = replayDurableDocument(document);
    // After moving layer-3 after layer-1: order should be [layer-1: 0, layer-3: 1, layer-2: 2]
    const orders = Object.values(replay.layers).sort((a, b) => a.snapshot.order - b.snapshot.order);
    expect(orders.map((l) => l.snapshot.id)).toEqual([layerId, layer3Id, layer2Id]);

    void registry;
  });

  it('reposition-layer applies move and resize independently', () => {
    const registry = new AssetRegistry();
    const move = { x: 100, y: 50 };
    const resize = { x: 10, y: 20, width: 300, height: 200 };

    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer() },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        { id: 'move', actionName: TOOL_ACTION, layerId, args: { toolName: 'reposition', move } },
        { id: 'resize', actionName: TOOL_ACTION, layerId, args: { toolName: 'reposition', resize } },
      ],
      { documentId: 'reposition-test', registry }
    ).document;

    const atMove = replayDurableDocument(document, 0);
    // reposition-layer updates the snapshot pos, not the operations array.
    expect(atMove.layers[layerId]?.snapshot.pos).toEqual({ x: 100, y: 50, width: 120, height: 80 });
    // No filter/affine/raster ops are present.
    expect(atMove.layers[layerId]?.operations).toHaveLength(0);

    const atResize = replayDurableDocument(document, 1);
    // After both move and resize, the snapshot reflects resize geometry.
    expect(atResize.layers[layerId]?.snapshot.pos).toEqual({ x: 10, y: 20, width: 300, height: 200 });

    void registry;
  });

  it('apply-affine-transform with negative scale (mirror) is retained and replayable', () => {
    const registry = new AssetRegistry();
    const mirrorTransform: TransformToolArgs = {
      toolName: 'transform',
      rotate: 0,
      mirrorH: true,
      mirrorV: false,
      skewX: 0,
      skewY: 0,
      trapezoid: 0,
      resizeX: 100,
      resizeY: 100,
    };

    const document = convert(registry, {
      id: 'mirror',
      actionName: TOOL_ACTION,
      layerId,
      args: mirrorTransform,
    });

    const replay = replayDurableDocument(document);
    const affineOp = replay.layers[layerId]?.operations.find(
      (op): op is Extract<typeof op, { kind: 'apply-affine-transform' }> => op.kind === 'apply-affine-transform'
    );
    expect(affineOp).toBeDefined();
    expect(affineOp!.transform.a).toBe(-1);
    expect(affineOp!.transform.d).toBe(1);

    void registry;
  });

  it('apply-affine-transform with rotation is retained and replayable', () => {
    const registry = new AssetRegistry();
    const rotateTransform: TransformToolArgs = {
      toolName: 'transform',
      rotate: 90,
      mirrorH: false,
      mirrorV: false,
      skewX: 0,
      skewY: 0,
      trapezoid: 0,
      resizeX: 100,
      resizeY: 100,
    };

    const document = convert(registry, {
      id: 'rotate',
      actionName: TOOL_ACTION,
      layerId,
      args: rotateTransform,
    });

    const replay = replayDurableDocument(document);
    const affineOp = replay.layers[layerId]?.operations.find(
      (op): op is Extract<typeof op, { kind: 'apply-affine-transform' }> => op.kind === 'apply-affine-transform'
    );
    expect(affineOp).toBeDefined();
    // 90° rotation: a=cos(90)≈0, b=sin(90)≈1, c=-sin(90)≈-1, d=cos(90)≈0
    expect(affineOp!.transform.a).toBeCloseTo(0, 5);
    expect(affineOp!.transform.b).toBeCloseTo(1, 5);
    expect(affineOp!.transform.c).toBeCloseTo(-1, 5);
    expect(affineOp!.transform.d).toBeCloseTo(0, 5);

    void registry;
  });

  it('set-selection updates the replay selections and active id', () => {
    const registry = new AssetRegistry();
    const selection = {
      id: 'sel-1',
      points: [{ x: 1, y: 2 }],
      isActive: true,
      pos: { x: 1, y: 2, width: 10, height: 12 },
    };

    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer() },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'selection',
          actionName: SELECTION_ACTION,
          layerId,
          args: {
            previousSelectionState: { selections: [], activeSelectionId: null },
            nextSelectionState: { selections: [selection], activeSelectionId: selection.id },
          },
        },
      ],
      { documentId: 'selection-test', registry }
    ).document;

    // Cursor -1 = before any history entry (baseline-only).
    const atBaseline = replayDurableDocument(document, -1);
    expect(atBaseline.selections.selections).toHaveLength(0);
    expect(atBaseline.selections.activeSelectionId).toBeNull();

    // Cursor 0 = after the selection action.
    const atSelection = replayDurableDocument(document, 0);
    expect(atSelection.selections.selections).toHaveLength(1);
    expect(atSelection.selections.activeSelectionId).toBe('sel-1');

    void registry;
  });

  it('set-document-frame changes the frame without rewriting layer pos', () => {
    const registry = new AssetRegistry();
    const croppedFrame = { x: 10, y: 20, width: 200, height: 150 };

    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer() },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'crop',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame, nextFrame: croppedFrame },
        },
      ],
      { documentId: 'frame-test', registry }
    ).document;

    const replay = replayDurableDocument(document);
    expect(replay.frame).toEqual(croppedFrame);
    expect(replay.layers[layerId]?.snapshot.pos).toEqual(layerPos);
    expect(replay.layers[layerId]?.snapshot.source).toEqual(document.baseline.layers[0]?.source);

    void registry;
  });

  it('merge-document replaces multiple layers with one at the tip', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer(), [layer2Id]: createBaselineLayer(layer2Id) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'merge-test', registry }
    ).document;

    // Build a merge operation directly on the document for precise control.
    const mergeOp: DurableOperation = Object.freeze({
      kind: 'merge-document',
      result: document.baseline.layers[0]!,
      removedLayerIds: Object.freeze([layer2Id]),
    });
    const merged = legacyHistoryToDurable(document, { documentId: 'merge-test2', registry }).document;
    const withMerge: DurableDocument = {
      ...merged,
      history: Object.freeze([
        ...merged.history,
        Object.freeze({ id: 'merge', schemaVersion: 1, enabled: true, operation: mergeOp }),
      ]),
      cursor: merged.history.length,
    };
    const frozen = freezeDurableDocument(withMerge);

    const replay = replayDurableDocument(frozen);
    expect(replay.layers[layer2Id]).toBeUndefined();
    expect(replay.layers[layerId]).toBeDefined();
    expect(replay.activeLayerId).toBe(layerId);

    registry.shutdown();
  });

  it('create-layer numbers the first layer of an empty document at 1, not 0', () => {
    // The `order` half only diverges on an EMPTY fold. Over a non-empty stack
    // both rules read `max + 1` — `Math.max(-1, ...orders) + 1` and
    // `maxLayerOrder(layers) + 1` cannot tell each other apart when there is an
    // order to fold — so the create-layer test above pins the number in the name
    // while leaving `order` itself unproved. This baseline carries no layers,
    // which is the case that separates them, and it is the first layer of every
    // document opened empty.
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: { layers: {}, size: initialSize, frame: baselineFrame },
        },
        { id: 'new-layer', actionName: NEW_LAYER_ACTION, layerId: layer2Id, layerSource: blankLayerSource(layerPos) },
      ],
      { documentId: 'empty-baseline-test', registry }
    ).document;

    const atTip = replayDurableDocument(document, 0);
    expect(atTip.layers[layer2Id]?.snapshot.order).toBe(1);
    expect(atTip.layers[layer2Id]?.snapshot.name).toBe('Blank 1');

    registry.shutdown();
  });

  it('merge-document names and places its result by the runtime rule, against the pre-merge stack', () => {
    // The merge arm derives the result layer from the layer set that is about to
    // be collapsed away, which is what `replayHistory`'s merge arm hands
    // `createLayer` — so a result folded against an empty set would number itself
    // off the wrong stack. Order 1 is the pre-merge maximum here, so the runtime
    // rule yields 2: an empty fold would have yielded 1, and the bare-kind
    // converter yielded the order but not the number in the name.
    const registry = new AssetRegistry();
    const top = createBaselineLayer(layer3Id);
    top.order = 1;

    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createBaselineLayer(), [layer2Id]: createBaselineLayer(layer2Id), [layer3Id]: top },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        { id: 'merge', actionName: MERGE_ACTION, layerId: mergedLayerId, layerSource: blankLayerSource(layerPos) },
      ],
      { documentId: 'merge-name-test', registry }
    ).document;

    const atMerge = replayDurableDocument(document, 0);
    expect(atMerge.layers[mergedLayerId]?.snapshot.name).toBe('Blank 2');
    expect(atMerge.layers[mergedLayerId]?.snapshot.order).toBe(2);
    // Only the result survives, and the removal set is every layer it replaced.
    expect(Object.keys(atMerge.layers)).toEqual([mergedLayerId]);

    registry.shutdown();
  });

  it('create-layer truncates a long image name through the runtime rule', () => {
    // `getNameFromSource` ellipsifies an image name before the order suffix is
    // appended. The converter used to bind the untruncated `source.name`, so the
    // shadow named a layer the document could never have named.
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(12, 8);
    const longName = 'x'.repeat(40);

    const document = convert(registry, {
      id: 'image-layer',
      actionName: NEW_LAYER_ACTION,
      layerId: layer2Id,
      layerSource: {
        kind: 'image',
        bitmap,
        name: longName,
        pos: { ...layerPos },
      },
    });

    const atTip = replayDurableDocument(document);
    expect(atTip.layers[layer2Id]?.snapshot.name).toBe(`${'x'.repeat(17)}... 1`);

    registry.shutdown();
    close();
  });
});

describe('materialization raster processor failure handling (P0.3 continuation)', () => {
  it('releases the source lease when a raster processor throws mid-execution', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(100, 100);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    // Mock a raster processor that throws using spyOn with mockRestore for clean isolation.
    const originalProcessor = toolProcessors.blur;
    const blurSpy = vi.spyOn(toolProcessors, 'blur', 'get').mockReturnValue({
      commit: 'layer-operation',
      replay: { kind: 'layer-operation', version: 1, deterministic: true, requiresRaster: false },
      imageProcessor: () => {
        throw new Error('processor crash');
      },
    });

    const layer: DurableReplayLayer = Object.freeze({
      snapshot: Object.freeze({
        id: 'layer-1',
        name: 'Layer',
        isBedrock: false,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over' as GlobalCompositeOperation,
        order: 0,
        pos: { x: 0, y: 0, width: 100, height: 100 },
        source: Object.freeze({
          kind: 'raster' as const,
          assetId,
          width: 100,
          height: 100,
          isBedrock: false,
        }),
      }),
      operations: Object.freeze([
        Object.freeze({
          kind: 'apply-raster-processor' as const,
          layerId: 'layer-1',
          processorId: 'blur',
          version: 1,
          args: Object.freeze({ toolName: 'blur', radius: 3 }),
        }),
      ]),
    });

    // The lease the producer takes and gives back. Spying is the only way to SEE it: the
    // fixture below is not the bitmap the registry owns (`registerBaseline` snapshots a
    // non-`ImageBitmap` source into its own immutable copy), so the `close` spy can never fire
    // however the lease is handled — which is why the `not.toHaveBeenCalled()` this replaces
    // passed whether the lease was released, leaked, or never taken.
    const resolve = vi.spyOn(registry, 'resolve');
    const retain = vi.spyOn(registry, 'retain');
    const release = vi.spyOn(registry, 'release');

    try {
      await expect(
        materializeLayer(layer, {
          documentId: 'document-a',
          baselineAssetGeneration: 0,
          operationSetRevision: 0,
          assetRegistry: registry,
        })
      ).rejects.toThrow(/processor crash/);

      // The lease WAS taken — `retain` is the positive observation that makes the release below
      // a statement about a real obligation rather than about a lease that never existed.
      expect(resolve).toHaveBeenCalledWith(assetId, undefined);
      expect(retain).toHaveBeenCalledWith(assetId);
      // ...and it was given back exactly once, in the producer's `finally` (materialization.ts:293),
      // so a throw mid-processor cannot leave the baseline retained forever.
      expect(release).toHaveBeenCalledWith(assetId);
      expect(retain.mock.calls.length).toBe(release.mock.calls.length);

      // The bitmap should still be alive — the source lease was released
      // but the baseline document is still alive.
      expect(close).not.toHaveBeenCalled();
      expect(registry.getRecord(assetId)).toBeDefined();
    } finally {
      blurSpy.mockRestore();
      void originalProcessor;
    }

    registry.shutdown();

    // The control that makes the survival assertion above non-vacuous: this same observation
    // DOES see the asset go away once the baseline is disposed.
    expect(registry.getRecord(assetId)).toBeUndefined();
  });

  it('materialization rejects a zero-width raster source due to degenerate affine bounds', async () => {
    // Limitation: materialization computes affine bounds from pos width/height.
    // A zero-size layer produces degenerate bounds (width <= 0) that getAffineBounds
    // rejects. This should ideally clamp or be handled at the source, but currently
    // surfaces as a throw rather than a controlled result.
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(0, 0);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    const layer: DurableReplayLayer = Object.freeze({
      snapshot: Object.freeze({
        id: 'layer-1',
        name: 'ZeroSizeLayer',
        isBedrock: false,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over' as GlobalCompositeOperation,
        order: 0,
        pos: { x: 0, y: 0, width: 0, height: 0 },
        source: Object.freeze({
          kind: 'raster' as const,
          assetId,
          width: 0,
          height: 0,
          isBedrock: false,
        }),
      }),
      operations: Object.freeze([]),
    });

    await expect(
      materializeLayer(layer, {
        documentId: 'document-a',
        baselineAssetGeneration: 0,
        operationSetRevision: 0,
        assetRegistry: registry,
      })
    ).rejects.toThrow();

    // The bitmap survives because the baseline document is still alive.
    registry.shutdown();
  });
});
