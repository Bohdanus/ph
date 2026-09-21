import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import type { Selection } from '../../../contexts/general-types.ts';
import { RectangularSelectionToolArea } from '../RectangularSelectionToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted((): { selections: Selection[]; activeSelectionId: string | null } => ({
  selections: [],
  activeSelectionId: null,
}));
const useRectProps = vi.hoisted((): { current: UseRectProps | null } => ({ current: null }));
const useRectPointerDownMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      toolOverlayRef: { current: document.createElement('canvas') },
      totalSize: { width: 800, height: 600 },
      selections: storeState.selections,
      activeSelectionId: storeState.activeSelectionId,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: UseRectProps) => {
    useRectProps.current = props;

    return {
      onPointerDown: useRectPointerDownMock,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };
  },
}));

describe('RectangularSelectionToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    useRectPointerDownMock.mockReset();
    useRectPointerDownMock.mockReturnValue(false);
    storeState.selections = [];
    storeState.activeSelectionId = null;
    useRectProps.current = null;
  });

  it('commits a normalized rectangular selection when drawing completes', () => {
    const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 20, clientY: 10 });
    act(() => {
      useRectProps.current!.onChangeEnd({ x1: 20, y1: 10, x2: 100, y2: 60 });
    });

    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'rectangular-selection' },
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          geometry: 'rectangle',
          lifecycle: 'committed',
          sourceTool: 'rectangular-selection',
          isActive: true,
          pos: { x: 20, y: 10, width: 80, height: 50 },
          points: [
            { x: 0, y: 0 },
            { x: 80, y: 0 },
            { x: 80, y: 50 },
            { x: 0, y: 50 },
          ],
        }),
      })
    );
  });

  it('hydrates the rectangular overlay from the active committed rectangle selection', () => {
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

    render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);

    expect(useRectProps.current!.initialRect).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
  });

  it('updates an active committed rectangle instead of storing moved geometry in tool args', () => {
    useRectPointerDownMock.mockReturnValue(true);
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
        id: 'selection-1',
        geometry: 'rectangle',
        sourceTool: 'rectangular-selection',
        lifecycle: 'committed',
        isActive: true,
        metadata: { copiedAtVersion: 2 },
        pos: { x: 10, y: 20, width: 30, height: 40 },
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 40 },
          { x: 0, y: 40 },
        ],
      },
    ];

    const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 15, clientY: 25 });
    act(() => {
      useRectProps.current!.onChangeEnd({ x1: 20, y1: 30, x2: 50, y2: 70 });
    });

    expect(dispatchMock).not.toHaveBeenCalledWith({
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'rectangular-selection' },
    });
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'MOVE_SELECTION',
      payload: expect.objectContaining({
        id: 'selection-1',
        geometry: 'rectangle',
        pos: { x: 20, y: 30, width: 30, height: 40 },
        metadata: { copiedAtVersion: 2, movedAtVersion: 1 },
      }),
    });
  });
});
