import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BurnToolArea } from '../BurnToolArea.tsx';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import type { DodgeBurnToolArgs } from '../../../tools/dodgeBurn.ts';
import { resetDocumentGestures } from '../../../hooks/document-gesture.ts';

const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const updateLayerByToolMock = vi.hoisted(() => vi.fn());
const cancelLayerPreviewMock = vi.hoisted(() => vi.fn());
const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false }, activePointer: null as number | null }));
const storeState = vi.hoisted(
  (): {
    documentFrame: { x: number; y: number; width: number; height: number } | null;
    layers: LayersRecord;
    activeLayerId: string | null;
  } => ({
    documentFrame: null,
    layers: {},
    activeLayerId: null,
  })
);
const toolState = vi.hoisted((): { toolArgs: DodgeBurnToolArgs | null } => ({ toolArgs: null }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 200, height: 120 },
      get layers() {
        return storeState.layers;
      },
      get activeLayerId() {
        return storeState.activeLayerId;
      },
      get documentFrame() {
        return storeState.documentFrame;
      },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: tempUpdateLayerMock,
    updateLayerByTool: updateLayerByToolMock,
    cancelLayerPreview: cancelLayerPreviewMock,
    createLayerFromTool: createLayerFromToolMock,
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ getToolArgs: (toolName: string) => (toolName === 'burn' ? toolState.toolArgs : null) }),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== null) return false;
      pointerState.activePointer = event.pointerId;
      pointerState.isMouseDown.current = true;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.activePointer !== null && pointerState.isMouseDown.current),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== event.pointerId) return false;
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;
      return true;
    }),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: pointerState.isMouseDown,
  }),
}));

const makeLayer = (id: string, overrides: Partial<Layer> = {}): Layer => ({
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
  pos: { x: 0, y: 0, width: 200, height: 120 },
  presentationBounds: null,
  operations: [],
  ...overrides,
});

const burnArgs = (): DodgeBurnToolArgs => ({
  toolName: 'burn',
  exposure: 30,
  range: 'highlights',
  size: 15,
  hardness: 0.25,
  points: [],
});

const renderArea = () => {
  const { container } = render(<BurnToolArea className="test-burn-area" overlayCtxRef={{ current: null }} />);
  return container.firstElementChild as HTMLDivElement;
};

const stroke = (toolArea: HTMLDivElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
};

const strokeCancel = (toolArea: HTMLDivElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerLeave(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(document, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
};

type ToolLayerCall = { id?: string; toolArgs: { points: { x: number; y: number }[] } };

describe('BurnToolArea', () => {
  beforeEach(() => {
    resetDocumentGestures();
    tempUpdateLayerMock.mockClear();
    updateLayerByToolMock.mockClear();
    cancelLayerPreviewMock.mockClear();
    createLayerFromToolMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.documentFrame = null;
    storeState.layers = { base: makeLayer('base') };
    storeState.activeLayerId = 'base';
    toolState.toolArgs = burnArgs();
  });

  it('writes nothing at all for a stroke over the bedrock layer', () => {
    storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
    storeState.activeLayerId = 'base';
    const toolArea = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(pointerState.activePointer).toBeNull();
  });

  it('previews every move and commits the stroke exactly once on a normal layer', () => {
    const toolArea = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    const [preview] = tempUpdateLayerMock.mock.calls[0] as [ToolLayerCall];
    expect(preview.id).toBe('base');
    expect(preview.toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    const [commit] = updateLayerByToolMock.mock.calls[0] as [ToolLayerCall];
    expect(commit.id).toBe('base');
    expect(commit.toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);
  });

  it('rebases a stroke through the PRESENTED origin of a transformed layer, not through pos', () => {
    storeState.layers = {
      base: makeLayer('base', {
        pos: { x: 10, y: 5, width: 200, height: 120 },
        operations: [
          {
            id: 'op-scale',
            kind: 'affine-transform',
            enabled: true,
            transform: { a: 2, b: 0, c: 0, d: 2, e: 5, f: 3 },
          },
        ],
      }),
    };
    const toolArea = renderArea();

    stroke(toolArea, [25, 18], [35, 28]);

    const [preview] = tempUpdateLayerMock.mock.calls[0] as [ToolLayerCall];
    expect(preview.toolArgs.points).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    const [commit] = updateLayerByToolMock.mock.calls[0] as [ToolLayerCall];
    expect(commit.toolArgs.points).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
  });

  it('leaves a disabled operation out of the rebased origin entirely', () => {
    storeState.layers = {
      base: makeLayer('base', {
        pos: { x: 10, y: 5, width: 200, height: 120 },
        operations: [
          {
            id: 'op-off',
            kind: 'affine-transform',
            enabled: false,
            transform: { a: 2, b: 0, c: 0, d: 2, e: 5, f: 3 },
          },
        ],
      }),
    };
    const toolArea = renderArea();

    stroke(toolArea, [25, 18], [35, 28]);

    const [commit] = updateLayerByToolMock.mock.calls[0] as [ToolLayerCall];
    expect(commit.toolArgs.points).toEqual([
      { x: 15, y: 13 },
      { x: 25, y: 23 },
    ]);
  });

  // === NEW TESTS FOR MISSING COVERAGE ===

  it('never calls createLayerFromTool (edits active layer, never creates layer)', () => {
    const toolArea = renderArea();
    stroke(toolArea, [20, 20], [100, 60]);
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
  });

  it('calls cancelLayerPreview on gesture cancel (pointerLeave)', () => {
    const toolArea = renderArea();
    strokeCancel(toolArea, [20, 20], [100, 60]);
    expect(cancelLayerPreviewMock).toHaveBeenCalledWith('base');
    // Commit should not be called on cancel
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('does nothing when tool args are null', () => {
    toolState.toolArgs = null;
    const toolArea = renderArea();
    stroke(toolArea, [20, 20], [100, 60]);
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(cancelLayerPreviewMock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active layer', () => {
    storeState.activeLayerId = null;
    const toolArea = renderArea();
    stroke(toolArea, [20, 20], [100, 60]);
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('does nothing when active layer is missing from layers', () => {
    storeState.activeLayerId = 'missing';
    storeState.layers = { base: makeLayer('base') };
    const toolArea = renderArea();
    stroke(toolArea, [20, 20], [100, 60]);
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('rebases points relative to layer pos when no documentFrame', () => {
    storeState.layers = {
      base: makeLayer('base', {
        pos: { x: 10, y: 5, width: 200, height: 120 },
      }),
    };
    const toolArea = renderArea();
    stroke(toolArea, [25, 18], [35, 28]);
    const [preview] = tempUpdateLayerMock.mock.calls[0] as [ToolLayerCall];
    expect(preview.toolArgs.points).toEqual([
      { x: 15, y: 13 },
      { x: 25, y: 23 },
    ]);
  });

  it('does not call createLayerFromTool (regression guard)', () => {
    const toolArea = renderArea();
    stroke(toolArea, [20, 20], [100, 60]);
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
  });
});
