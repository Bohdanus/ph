import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockCanvas, createMockImageBitmap } from '@/__tests__/fixtures/canvas.ts';
import type { Selection, SelectionClipboard } from '../general-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { useSelectionClipboard } from '../useSelectionClipboard.ts';

const dispatchMock = vi.hoisted(() => vi.fn());

type CreateLayerInput = { bitmap: unknown; name: string; pos: { x: number; y: number; width: number; height: number } };

const createLayerFromBitmapMock = vi.hoisted(() => vi.fn(async () => undefined));

const storeState = vi.hoisted(
  (): {
    activeSelectionId: string | null;
    canvasRef: { current: unknown };
    documentFrame: DocumentFrame | undefined;
    layers: Record<string, { name: string }> | undefined;
    selectionClipboard: SelectionClipboard | null;
    selections: Selection[];
    totalSize: { width: number; height: number };
  } => ({
    activeSelectionId: null,
    canvasRef: { current: null },
    documentFrame: undefined,
    layers: undefined,
    selectionClipboard: null,
    selections: [],
    totalSize: { width: 100, height: 100 },
  })
);

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: storeState.activeSelectionId,
      canvasRef: storeState.canvasRef,
      documentFrame: storeState.documentFrame,
      layers: storeState.layers,
      selectionClipboard: storeState.selectionClipboard,
      selections: storeState.selections,
      totalSize: storeState.totalSize,
    },
    dispatchMock,
  ],
}));

vi.mock('../useLayer.ts', () => ({
  useLayers: () => ({
    createLayerFromBitmap: createLayerFromBitmapMock,
  }),
}));

// `useStore` is mocked, so the hook needs no provider and can be driven straight
// through `renderHook`.
function renderProbe() {
  return renderHook(() => useSelectionClipboard()).result.current;
}

function createLayerInputs(): CreateLayerInput[] {
  return (createLayerFromBitmapMock.mock.calls as unknown as [CreateLayerInput][]).map(([input]) => input);
}

function polygonSelection(overrides: Partial<Selection> = {}): Selection {
  return {
    id: 'selection-1',
    isActive: true,
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool: 'freehand-lasso',
    points: [
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 0, y: 40 },
      ],
    ],
    pos: { x: 10, y: 20, width: 30, height: 40 },
    ...overrides,
  };
}

beforeEach(() => {
  dispatchMock.mockClear();
  createLayerFromBitmapMock.mockClear();
  createLayerFromBitmapMock.mockImplementation(async () => undefined);
  storeState.activeSelectionId = null;
  storeState.canvasRef = { current: createMockCanvas({ width: 100, height: 100 }) };
  storeState.documentFrame = undefined;
  storeState.layers = undefined;
  storeState.selectionClipboard = null;
  storeState.selections = [polygonSelection()];
  storeState.totalSize = { width: 100, height: 100 };
});

describe('useSelectionClipboard copy guards', () => {
  it('reports failure without dispatching when the requested selection is null', () => {
    const api = renderProbe();

    expect(api.copyActiveSelection(null)).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('falls back to the active selection when the argument is omitted', () => {
    const api = renderProbe();

    // `copyActiveSelection` has a default parameter, so an omitted argument is
    // the active selection rather than a missing selection.
    expect(api.copyActiveSelection()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: expect.objectContaining({ sourceSelectionId: 'selection-1' }),
    });
  });

  it('reports failure without dispatching when no selection is active at all', () => {
    storeState.selections = [];
    storeState.activeSelectionId = null;
    const api = renderProbe();

    expect(api.hasActiveSelection).toBe(false);
    expect(api.copyActiveSelection()).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('reports failure without dispatching when the selection cannot be snapshotted', () => {
    // A degenerate polygon (fewer than three points) has no copyable region.
    storeState.selections = [
      polygonSelection({
        points: [
          [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
        ],
      }),
    ];
    const api = renderProbe();

    expect(api.copyActiveSelection()).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('reports failure without dispatching when no canvas is mounted', () => {
    storeState.canvasRef = { current: null };
    const api = renderProbe();

    expect(api.copyActiveSelection()).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('copies an explicitly passed selection even when a different one is active', () => {
    storeState.selections = [
      polygonSelection(),
      polygonSelection({ id: 'selection-2', pos: { x: 0, y: 0, width: 10, height: 10 } }),
    ];
    storeState.activeSelectionId = 'selection-1';
    const api = renderProbe();

    expect(api.copyActiveSelection(storeState.selections[1]!)).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: expect.objectContaining({ sourceSelectionId: 'selection-2' }),
    });
    // The passed selection is the one marked as copied, not the active one.
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'MARK_SELECTION_COPIED', payload: { id: 'selection-2' } });
    expect(dispatchMock).not.toHaveBeenCalledWith({ type: 'MARK_SELECTION_COPIED', payload: { id: 'selection-1' } });
  });

  it('preserves the cropped document lower-right edge in both copy paths', async () => {
    storeState.documentFrame = { x: 10, y: 20, width: 90, height: 80 };
    storeState.totalSize = { width: 90, height: 80 };
    storeState.selections = [
      polygonSelection({
        points: [
          [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 5 },
            { x: 0, y: 5 },
          ],
        ],
        pos: { x: 95, y: 95, width: 5, height: 5 },
      }),
    ];
    const api = renderProbe();

    expect(api.copyActiveSelection()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: expect.objectContaining({ pos: { x: 95, y: 95, width: 5, height: 5 } }),
    });

    dispatchMock.mockClear();
    await expect(api.layerViaCopy()).resolves.toBe(true);
    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pos: { x: 95, y: 95, width: 5, height: 5 } })
    );
  });

  it('does not truncate a canvas-space selection reaching the canvas backing store edge when document size is smaller', async () => {
    // Canvas backing store: 200x200, document: 100x100, frame offset: (50, 50)
    // Selection in document space at right/bottom edge: pos { x: 90, y: 90, width: 10, height: 10 }
    // In canvas space: pos { x: 40, y: 40, width: 10, height: 10 } (subtracting frame origin)
    // But the selection extends to canvas x: 50, y: 50 which is within the 200x200 canvas
    // The old code would clamp to totalSize (100x100) in canvas space, truncating at 100
    // The fix uses canvasRef.current.width/height (200x200) as the clamp bound
    storeState.documentFrame = { x: 50, y: 50, width: 100, height: 100 };
    storeState.totalSize = { width: 100, height: 100 };
    storeState.canvasRef = { current: createMockCanvas({ width: 200, height: 200 }) };
    storeState.selections = [
      polygonSelection({
        points: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        ],
        pos: { x: 90, y: 90, width: 10, height: 10 },
      }),
    ];
    const api = renderProbe();

    expect(api.copyActiveSelection()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: expect.objectContaining({ pos: { x: 90, y: 90, width: 10, height: 10 } }),
    });

    dispatchMock.mockClear();
    await expect(api.layerViaCopy()).resolves.toBe(true);
    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pos: { x: 90, y: 90, width: 10, height: 10 } })
    );
  });
});

describe('useSelectionClipboard layerViaCopy', () => {
  it('reports failure without creating a layer when no selection is active', async () => {
    storeState.selections = [];
    storeState.activeSelectionId = null;
    const api = renderProbe();

    await expect(api.layerViaCopy()).resolves.toBe(false);
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('reports failure without creating a layer when the active selection cannot be snapshotted', async () => {
    storeState.canvasRef = { current: null };
    const api = renderProbe();

    await expect(api.layerViaCopy()).resolves.toBe(false);
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('creates one new layer from an independent clone of the snapshot, without touching the clipboard', async () => {
    const api = renderProbe();

    await expect(api.layerViaCopy()).resolves.toBe(true);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(createLayerFromBitmapMock).toHaveBeenCalledOnce();
    const input = createLayerInputs()[0]!;
    // The layer is named from the existing layer stack, and its position is the
    // snapshot bounds translated back into document space.
    expect(input.name).toBe('Layer 1');
    expect(input.pos).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(input.bitmap).toBeInstanceOf(OffscreenCanvas);
  });

  it('lands the copied layer on the selection in document space, unshifted by the frame origin', async () => {
    // `layerViaCopy` converts the selection into canvas space at
    // `useSelectionClipboard.ts:92`, snapshots it there, and converts the snapshot's
    // bounds back at `:100` — so the round trip is the identity on position and the
    // layer must land exactly where the selection is, whatever the frame origin is.
    // `createLayerFromBitmap` reads `pos` as document space: `layer-renderer.ts:115`
    // hands `evaluation` to `drawEvaluatedPresentation` with `{ kind: 'document',
    // frame }`, and `presentation-evaluator.ts:277` subtracts the frame there.
    storeState.documentFrame = { x: 10, y: 20, width: 90, height: 80 };
    storeState.totalSize = { width: 90, height: 80 };
    const api = renderProbe();

    await expect(api.layerViaCopy()).resolves.toBe(true);

    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pos: { x: 10, y: 20, width: 30, height: 40 } })
    );
  });

  it('numbers the copied layer from the existing layer names', async () => {
    storeState.layers = { a: { name: 'Background' }, b: { name: 'Layer 3' } };
    const api = renderProbe();

    await expect(api.layerViaCopy()).resolves.toBe(true);

    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Layer 4' }));
  });

  it('falls back to the first selection flagged active when no id points at one', async () => {
    storeState.selections = [polygonSelection({ id: 'first', isActive: false }), polygonSelection({ id: 'second' })];
    storeState.activeSelectionId = null;
    const api = renderProbe();

    expect(api.activeSelection?.id).toBe('second');
    await expect(api.layerViaCopy()).resolves.toBe(true);
    expect(createLayerFromBitmapMock).toHaveBeenCalledOnce();
  });

  it('reports failure and logs when the layer creation rejects', async () => {
    // The restore has to run whatever the assertions do: this file has no `afterEach` and the
    // global `clearMocks` does not restore a spy, so a red assertion above would leave
    // `console.error` swallowed for every test below. Same shape as `FreehandLasso.test.tsx:226-239`.
    const failure = new Error('layer creation failed');
    createLayerFromBitmapMock.mockRejectedValueOnce(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const api = renderProbe();

      await expect(api.layerViaCopy()).resolves.toBe(false);

      expect(createLayerFromBitmapMock).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        'Unable to create a layer from the active selection',
        failure
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('prefers the explicitly active id over an earlier selection flagged active', async () => {
    storeState.selections = [polygonSelection({ id: 'flagged' }), polygonSelection({ id: 'pointed-at' })];
    storeState.activeSelectionId = 'pointed-at';
    const api = renderProbe();

    expect(api.activeSelection?.id).toBe('pointed-at');
  });
});

describe('useSelectionClipboard clipboard presence flags', () => {
  it('reports the clipboard presence from the store and flips when it is set', () => {
    storeState.selectionClipboard = {
      bitmap: createMockImageBitmap(4, 4),
      copiedAt: 1,
      name: 'Selection copy',
      pos: { x: 0, y: 0, width: 4, height: 4 },
      sourceSelectionId: 'selection-1',
    };
    const api = renderProbe();

    expect(api.hasSelectionClipboard).toBe(true);
    expect(api.selectionClipboard?.name).toBe('Selection copy');
  });

  it('reports no clipboard for the initial empty store', () => {
    const api = renderProbe();

    expect(api.hasSelectionClipboard).toBe(false);
    expect(api.selectionClipboard).toBeNull();
  });
});
