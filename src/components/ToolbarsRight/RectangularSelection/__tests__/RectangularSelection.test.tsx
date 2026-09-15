import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../../../contexts/general-types.ts';
import RectangularSelection from '../RectangularSelection.tsx';
import { copyRectToClipboard } from '../../../../util/clipboard.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const storeState = vi.hoisted(
  (): { selections: Selection[]; activeSelectionId: string | null } => ({ selections: [], activeSelectionId: null })
);

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      totalSize: { width: 800, height: 600 },
      selections: storeState.selections,
      activeSelectionId: storeState.activeSelectionId,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../../util/clipboard.ts', () => ({
  copyRectToClipboard: vi.fn(),
}));

describe('RectangularSelection toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    vi.mocked(copyRectToClipboard).mockReset();
    vi.mocked(copyRectToClipboard).mockResolvedValue(true);
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
        id: 'selection-1',
        geometry: 'rectangle',
        sourceTool: 'rectangular-selection',
        lifecycle: 'committed',
        isActive: true,
        pos: { x: 10, y: 20, width: 30, height: 40 },
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 40 },
          { x: 0, y: 40 },
        ],
      },
    ];
  });

  it('copies the active committed rectangular selection from store state', async () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(copyRectToClipboard).toHaveBeenCalledWith({
        sourceCanvas,
        rect: { x1: 10, y1: 20, x2: 40, y2: 60 },
        imageSize: { width: 800, height: 600 },
      });
    });
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'MARK_SELECTION_COPIED',
      payload: { id: 'selection-1' },
    });
  });

  it('clears committed selections through the explicit selection clear action', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'CLEAR_SELECTIONS' });
  });
});
