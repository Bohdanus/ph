import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import { FeatherMagneticLassoToolArea } from '../FeatherMagneticLassoToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted((): { selections: Selection[] } => ({ selections: [] }));
const shortcutHandlers = vi.hoisted(() => new Map<string, () => void>());

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: any) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

vi.mock('../../../hooks/useKeyboardEvents.tsx', () => ({
  useKeyDownShortcut: (shortcut: { key: string; onKeyDown: () => void }) => {
    shortcutHandlers.set(shortcut.key, shortcut.onKeyDown);
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: document.createElement('canvas') },
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      totalSize: { width: 200, height: 120 },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: {
      antiAlias: true,
      edgeContrast: 100,
      featherRadius: 8,
      frequency: 1000,
      magneticWidth: 10,
      previewFeather: true,
      smoothing: 0,
      snapStrength: 1,
      toolName: 'feather-magnetic-lasso',
    },
  }),
}));

describe('FeatherMagneticLassoToolArea', () => {
  let rafCallbacks: FrameRequestCallback[] = [];
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    dispatchMock.mockClear();
    shortcutHandlers.clear();
    storeState.selections = [];
    rafCallbacks = [];
  });

  afterEach(() => {
    requestAnimationFrameSpy?.mockRestore();
    cancelAnimationFrameSpy?.mockRestore();
    requestAnimationFrameSpy = null;
    cancelAnimationFrameSpy = null;
  });

  function installManualRaf() {
    requestAnimationFrameSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    cancelAnimationFrameSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      rafCallbacks[id - 1] = () => undefined;
    });
  }

  const createMockContext = () =>
    ({
      canvas: { width: 200, height: 120 },
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
    }) as unknown as CanvasRenderingContext2D;

  it('commits a feathered magnetic lasso selection with metadata on Enter', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
    shortcutHandlers.get('Enter')?.();

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'feather-magnetic-lasso' },
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          geometry: 'polygon',
          lifecycle: 'committed',
          metadata: expect.objectContaining({
            featherRadius: 8,
            magneticLasso: expect.objectContaining({
              antiAlias: true,
              contrast: 100,
              width: 10,
            }),
          }),
          sourceTool: 'feather-magnetic-lasso',
        }),
      })
    );
  });

  it('removes the previous anchor with Backspace before finishing', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 10 });
    shortcutHandlers.get('Backspace')?.();
    shortcutHandlers.get('Enter')?.();

    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMIT_SELECTION' }));
  });

  it('cancels the current draft with Escape', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    shortcutHandlers.get('Escape')?.();

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
  });

  it('throttles magnetic pointer-move preview work to one requestAnimationFrame', () => {
    installManualRaf();

    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    vi.mocked(mockCtx.lineTo).mockClear();

    fireEvent.pointerMove(toolArea, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 10 });

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(mockCtx.lineTo).not.toHaveBeenCalled();

    rafCallbacks[0](performance.now());

    expect(mockCtx.lineTo).toHaveBeenCalledWith(40, 10);

    fireEvent.pointerMove(toolArea, { clientX: 50, clientY: 10 });

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
  });
});
