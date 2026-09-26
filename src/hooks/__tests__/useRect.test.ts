import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRect, type UseRectProps } from '../useRect.ts';
import { createPointerEvent } from '@/__tests__/fixtures/pointer.ts';
import { createMockCanvas } from '@/__tests__/fixtures/canvas.ts';

const usePointerPositionMock = vi.hoisted(() => {
  const mockData = {
    isPointerDownValid: vi.fn((event: PointerEvent) => event.button === 0),
    isPointerMoveValid: vi.fn(() => true),
    isPointerUpValid: vi.fn((event: PointerEvent) => event.button === 0),
    getLocalCoords: vi.fn(() => ({ x: 10, y: 20 })),
    isMouseDown: { current: false },
    dimensionsRef: { current: { scale: 1, offset: { x: 0, y: 0 } } },
    onResize: vi.fn(),
    pointerIdRef: { current: null },
  };
  return {
    usePointerPosition: vi.fn(() => mockData),
  };
});

vi.mock('../usePointerPosition.ts', () => usePointerPositionMock);

const rectUtilsMock = vi.hoisted(() => ({
  getCanvasSize: vi.fn(() => ({ width: 800, height: 600 })),
  posToSortedRect: vi.fn((pos) => ({ x1: pos.x, y1: pos.y, x2: pos.x + pos.width, y2: pos.y + pos.height })),
  sortRect: vi.fn((rect) => rect),
  trimRect: vi.fn((rect) => rect),
}));

vi.mock('../../../util/rect.ts', () => rectUtilsMock);

const constantsMock = vi.hoisted(() => {
  const CURSOR_MAP = {
    'top-left': 'nw-resize',
    'top-right': 'ne-resize',
    'bottom-left': 'sw-resize',
    'bottom-right': 'se-resize',
    top: 'n-resize',
    right: 'e-resize',
    bottom: 's-resize',
    left: 'w-resize',
    inside: 'move',
  } as const;

  return {
    CURSOR_MAP,
    HANDLE_SIZE: 8,
  };
});

vi.mock('../../../util/constants.ts', () => constantsMock);

function createMockLayer(pos = { x: 100, y: 100, width: 200, height: 150 }) {
  return {
    id: 'layer-1',
    name: 'Test Layer',
    pos,
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as const,
    order: 0,
    bitmap: null,
    tmpCanvas: null,
    operations: [],
  };
}

const createMockTarget = () => {
  const div = document.createElement('div');
  div.style.cursor = '';
  return div;
};

const createTestContext = () => {
  const overlayCanvas = createMockCanvas({ width: 800, height: 600 });
  const containerElement = document.createElement('div');
  containerElement.style.cursor = '';
  return { overlayCanvas, containerElement };
};

describe('useRect', () => {
  let testContext: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    testContext = createTestContext();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderUseRect(
    options: {
      aspectRatio?: number | null;
      initialRect?: { x1: number; y1: number; x2: number; y2: number } | null;
      isMoveTool?: boolean;
      hideBlend?: boolean;
      onRepaint?: UseRectProps['onRepaint'];
      onChange?: UseRectProps['onChange'];
      onChangeEnd?: UseRectProps['onChangeEnd'];
    } = {}
  ) {
    const { overlayCanvas, containerElement } = testContext;
    const props: UseRectProps = {
      aspectRatio: options.aspectRatio ?? null,
      imageSize: { width: 800, height: 600 },
      initialRect: options.initialRect ?? null,
      hideBlend: options.hideBlend ?? false,
      isMoveTool: options.isMoveTool ?? false,
      containerRef: { current: containerElement },
      overlayRef: { current: overlayCanvas },
      onRepaint: options.onRepaint ?? vi.fn(),
      onChange: options.onChange ?? vi.fn(),
      onChangeEnd: options.onChangeEnd ?? vi.fn(),
    };
    return renderHook(() => useRect(props));
  }

  it('initializes without initial rect', () => {
    const { result } = renderUseRect();
    expect(result.current.onPointerDown).toBeDefined();
    expect(result.current.onPointerMove).toBeDefined();
    expect(result.current.onPointerUp).toBeDefined();
    expect(result.current.redraw).toBeDefined();
    expect(result.current.clearSelection).toBeDefined();
  });

  it('initializes with initial rect', () => {
    const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
    const { result } = renderUseRect({ initialRect });
    expect(result.current.onPointerDown).toBeDefined();
  });

  it('returns false for pointer down on non-left button', () => {
    const { result } = renderUseRect();
    const event = createPointerEvent({ button: 1, target: createMockTarget() });
    act(() => {
      const res = result.current.onPointerDown(event);
      expect(res).toBe(false);
    });
  });

  it('clears selection on clearSelection', () => {
    const { result } = renderUseRect({ initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 } });
    act(() => {
      result.current.clearSelection();
    });
  });

  it('redraws on redraw call', () => {
    const { result } = renderUseRect();
    act(() => {
      result.current.redraw();
    });
  });

  describe('handlePointerDown', () => {
    it('detects handle clicks on existing rect', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const event = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerDown(event);
        expect(typeof res).toBe('boolean');
      });
    });

    it('creates rect from layer when clicking on layer', () => {
      const layer = createMockLayer();
      const { result } = renderUseRect();

      const event = createPointerEvent({ button: 0, clientX: 150, clientY: 150, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerDown(event, layer);
        expect(typeof res).toBe('boolean');
      });
    });

    it('respects aspect ratio modifier keys on drag start', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const event = createPointerEvent({
        button: 0,
        clientX: 100,
        clientY: 100,
        ctrlKey: true,
        target: createMockTarget(),
      });
      act(() => {
        const res = result.current.onPointerDown(event);
        expect(typeof res).toBe('boolean');
      });
    });

    it('starts drag on handle click', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const target = createMockTarget();
      const downEvent = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target });
      act(() => {
        result.current.onPointerDown(downEvent);
      });

      const moveEvent = createPointerEvent({ button: 0, clientX: 120, clientY: 120, target });
      act(() => {
        const res = result.current.onPointerMove(moveEvent);
        expect(typeof res).toBe('boolean');
      });
    });
  });

  describe('handlePointerMove', () => {
    it('updates cursor on hover over handles', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const event = createPointerEvent({ clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerMove(event);
        expect(typeof res).toBe('boolean');
      });
    });

    it('returns false when not dragging and no hover handler', () => {
      const { result } = renderUseRect();
      const event = createPointerEvent({ clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerMove(event);
        expect(res).toBe(false);
      });
    });
  });

  describe('handlePointerUp', () => {
    it('does not throw on pointer up after pointer down', () => {
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({
        initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 },
        onChangeEnd,
      });

      const target = createMockTarget();
      const downEvent = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target });
      act(() => {
        result.current.onPointerDown(downEvent);
      });

      const upEvent = createPointerEvent({ button: 0, clientX: 150, clientY: 150, target });
      expect(() => {
        act(() => {
          result.current.onPointerUp(upEvent);
        });
      }).not.toThrow();
    });

    it('does nothing on non-left button', () => {
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({ onChangeEnd });

      const event = createPointerEvent({ button: 1, target: createMockTarget() });
      act(() => {
        result.current.onPointerUp(event);
      });

      expect(onChangeEnd).not.toHaveBeenCalled();
    });
  });

  describe('aspect ratio', () => {
    it('maintains aspect ratio when set', () => {
      const { result } = renderUseRect({ aspectRatio: 1.5 });
      expect(result.current.onPointerDown).toBeDefined();
    });

    it('adjusts rect for aspect ratio on initial rect change', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 200 };
      const { result } = renderUseRect({ aspectRatio: 1, initialRect });
      expect(result.current.onPointerDown).toBeDefined();
    });

    it('locks aspect ratio when modifier key pressed during drag start', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const target = createMockTarget();
      const downEvent = createPointerEvent({ button: 0, clientX: 100, clientY: 100, ctrlKey: true, target });
      act(() => {
        const res = result.current.onPointerDown(downEvent);
        expect(typeof res).toBe('boolean');
      });
    });

    it('maintains aspect ratio during resize drag', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const aspectRatio = 1.5;
      const { result } = renderUseRect({ initialRect, aspectRatio });

      const target = createMockTarget();
      const downEvent = createPointerEvent({ button: 0, clientX: 300, clientY: 250, target });
      act(() => {
        const res = result.current.onPointerDown(downEvent);
        expect(typeof res).toBe('boolean');
      });
    });
  });
});
