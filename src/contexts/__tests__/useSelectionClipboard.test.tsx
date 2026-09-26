import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCanvas, createMockImageBitmap } from '@/__tests__/fixtures/canvas.ts';
import type { Selection, SelectionClipboard } from '../general-types.ts';
import { useSelectionClipboard } from '../useSelectionClipboard.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const createLayerFromBitmapMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(
  (): {
    activeSelectionId: string | null;
    selectionClipboard: SelectionClipboard | null;
    selections: Selection[];
    totalSize: { width: number; height: number };
  } => ({
    activeSelectionId: null,
    selectionClipboard: null,
    selections: [],
    totalSize: { width: 100, height: 100 },
  })
);

const sourceCanvas = createMockCanvas({ width: 100, height: 100 });

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: storeState.activeSelectionId,
      canvasRef: { current: sourceCanvas },
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

const ClipboardProbe = () => {
  const { copyActiveSelection, pasteSelectionClipboard } = useSelectionClipboard();

  return (
    <div>
      <button onClick={() => copyActiveSelection()}>Copy</button>
      <button onClick={() => pasteSelectionClipboard()}>Paste</button>
    </div>
  );
};

function createLassoSelection(): Selection {
  return {
    geometry: 'polygon',
    id: 'selection-1',
    isActive: true,
    lifecycle: 'committed',
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
      { x: 0, y: 40 },
    ],
    pos: { x: 10, y: 20, width: 30, height: 40 },
    sourceTool: 'freehand-lasso',
  };
}

describe('useSelectionClipboard', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    createLayerFromBitmapMock.mockClear();
    storeState.activeSelectionId = 'selection-1';
    storeState.selectionClipboard = null;
    storeState.selections = [createLassoSelection()];
    storeState.totalSize = { width: 100, height: 100 };
  });

  it('copies the active lasso selection from the merged visible canvas into the in-app clipboard', () => {
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: expect.objectContaining({
        name: 'Selection copy',
        pos: { x: 10, y: 20, width: 30, height: 40 },
        sourceSelectionId: 'selection-1',
        sourceTool: 'freehand-lasso',
      }),
    });
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'MARK_SELECTION_COPIED', payload: { id: 'selection-1' } });
  });

  it('pastes the in-app clipboard bitmap as an independent new layer at the copied selection position', () => {
    const clipboardBitmap = createMockImageBitmap(30, 40);
    storeState.selectionClipboard = {
      bitmap: clipboardBitmap,
      copiedAt: 123,
      name: 'Selection copy',
      pos: { x: 10, y: 20, width: 30, height: 40 },
      sourceSelectionId: 'selection-1',
      sourceTool: 'freehand-lasso',
    };

    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

    expect(createLayerFromBitmapMock).toHaveBeenCalledWith({
      bitmap: expect.any(OffscreenCanvas),
      name: 'Layer 1',
      pos: { x: 35, y: 30, width: 30, height: 40 },
    });
    expect(createLayerFromBitmapMock.mock.calls[0][0].bitmap).not.toBe(clipboardBitmap);
  });
});
