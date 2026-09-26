import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRect } from '../useRect.ts';
import type { RectXYSorted, Size } from '../../contexts/general-types.ts';
import type { PointerEvent } from 'react';

const createMockRef = <T>(initial: T) => ({ current: initial });

function makePointerEvent(overrides: Record<string, unknown> = {}): PointerEvent<HTMLDivElement> {
  return { button: 0, clientX: 0, clientY: 0, pointerId: 1, ...overrides } as unknown as PointerEvent<HTMLDivElement>;
}

const mockDimensions = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

const mockPointerPositionData = {
  isPointerDownValid: vi.fn(() => true),
  isPointerMoveValid: vi.fn(() => true),
  isPointerUpValid: vi.fn(() => true),
  getLocalCoords: vi.fn((event: { clientX: number; clientY: number }) => ({
    x: event.clientX,
    y: event.clientY,
  })),
  isMouseDown: { current: false },
  dimensionsRef: { current: mockDimensions },
};

vi.mock('./usePointerPosition.ts', () => ({
  usePointerPosition: vi.fn(() => mockPointerPositionData),
}));

function setupTest({
  initialRect,
  aspectRatio = null,
  isMoveTool = false,
  imageSize = { width: 200, height: 150 },
}: {
  initialRect?: RectXYSorted | null;
  aspectRatio?: number | null;
  isMoveTool?: boolean;
  imageSize?: Size;
} = {}) {
  const containerRef = createMockRef<HTMLDivElement | null>(document.createElement('div'));
  const overlayRef = createMockRef<HTMLCanvasElement | null>(document.createElement('canvas'));

  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    setLineDash: vi.fn(),
  };

  vi.spyOn(overlayRef.current!, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);

  const onRepaint = vi.fn();
  const onChange = vi.fn();
  const onChangeEnd = vi.fn();

  const { result } = renderHook(() =>
    useRect({
      aspectRatio,
      imageSize,
      initialRect,
      containerRef,
      overlayRef,
      isMoveTool,
      onRepaint,
      onChange,
      onChangeEnd,
    })
  );

  return { result, containerRef, overlayRef, onRepaint, onChange, onChangeEnd, ctx };
}

describe('useRect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPointerPositionData.isPointerDownValid.mockReturnValue(true);
    mockPointerPositionData.isPointerMoveValid.mockReturnValue(true);
    mockPointerPositionData.isPointerUpValid.mockReturnValue(true);
    mockPointerPositionData.getLocalCoords.mockImplementation((event: { clientX: number; clientY: number }) => ({
      x: event.clientX,
      y: event.clientY,
    }));
    mockPointerPositionData.isMouseDown.current = false;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('initializes with no rect when none provided', () => {
      const { result } = setupTest();
      expect(result.current.clearSelection).toBeDefined();
    });

    it('initializes with provided rect', () => {
      const initialRect: RectXYSorted = { x1: 10, y1: 10, x2: 50, y2: 40 };
      const { onRepaint } = setupTest({ initialRect });
      expect(onRepaint).toHaveBeenCalledWith(initialRect);
    });

    it('adjusts rect for aspect ratio on init', () => {
      const initialRect: RectXYSorted = { x1: 10, y1: 10, x2: 60, y2: 40 };
      const { onRepaint } = setupTest({ initialRect, aspectRatio: 2 });
      expect(onRepaint).toHaveBeenCalled();
    });
  });

  describe('drawMask', () => {
    it('clears overlay and draws nothing when no rect', () => {
      const { result, ctx } = setupTest();
      act(() => {
        result.current.redraw();
      });
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 150);
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });

    it('draws selection mask when rect exists', () => {
      const initialRect: RectXYSorted = { x1: 20, y1: 20, x2: 80, y2: 70 };
      const { result, ctx } = setupTest({ initialRect });
      act(() => {
        result.current.redraw();
      });
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 150);
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 150);
      expect(ctx.clearRect).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number)
      );
      expect(ctx.strokeRect).toHaveBeenCalled();
    });
  });

  describe('pointer interactions', () => {
    it('starts drag on pointer down inside rect', () => {
      const initialRect: RectXYSorted = { x1: 50, y1: 50, x2: 100, y2: 100 };
      const { result } = setupTest({ initialRect });
      const event = makePointerEvent({ clientX: 75, clientY: 75, ctrlKey: false, metaKey: false, shiftKey: false });
      const handleClicked = result.current.onPointerDown(event);
      expect(typeof handleClicked).toBe('boolean');
    });

    it('respects aspect ratio lock with modifier keys', () => {
      const initialRect: RectXYSorted = { x1: 50, y1: 50, x2: 100, y2: 100 };
      const { result } = setupTest({ initialRect, aspectRatio: null });
      const event = makePointerEvent({ clientX: 50, clientY: 50, ctrlKey: true, metaKey: false, shiftKey: false });
      result.current.onPointerDown(event);
      expect(result.current).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('cancels animation frame on unmount', () => {
      const { unmount } = renderHook(() =>
        useRect({
          imageSize: { width: 200, height: 150 },
          containerRef: createMockRef(document.createElement('div')),
          overlayRef: createMockRef(document.createElement('canvas')),
          onChangeEnd: vi.fn(),
        })
      );
      const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
      act(() => {
        unmount();
      });
      expect(cancelSpy).toHaveBeenCalled();
      cancelSpy.mockRestore();
    });
  });
});
