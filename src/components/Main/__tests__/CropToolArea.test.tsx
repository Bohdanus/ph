import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import { CropToolArea } from '../CropToolArea.tsx';

const setToolArgsMock = vi.hoisted(() => vi.fn());
const applyDocumentCropMock = vi.hoisted(() => vi.fn(() => true));

const useRectProps = vi.hoisted((): { current: UseRectProps | null } => ({ current: null }));

const pointerHandlers = vi.hoisted(() => ({
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
}));

const overlayCtxRef = { current: null as CanvasRenderingContext2D | null };

const toolArgsState = vi.hoisted(
  (): {
    toolArgs: {
      toolName: 'crop';
      rect: { x1: number; y1: number; x2: number; y2: number } | null;
      preRatioRect: { x1: number; y1: number; x2: number; y2: number } | null;
      aspectRatio: number | null;
    };
  } => ({
    toolArgs: {
      toolName: 'crop',
      rect: null,
      preRatioRect: null,
      aspectRatio: null,
    },
  })
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      toolOverlayRef: { current: document.createElement('canvas') },
      totalSize: { width: 800, height: 600 },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolArgsState.toolArgs,
    setToolArgs: setToolArgsMock,
  }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ applyDocumentCrop: applyDocumentCropMock }),
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: UseRectProps) => {
    useRectProps.current = props;
    return {
      pointerHandlers: {
        onPointerDown: pointerHandlers.onPointerDown,
        onPointerMove: pointerHandlers.onPointerMove,
        onPointerUp: pointerHandlers.onPointerUp,
      },
      rectHandles: { redraw: vi.fn(), clearSelection: vi.fn() },
      pointerState: {},
    };
  },
}));

describe('CropToolArea', () => {
  beforeEach(() => {
    useRectProps.current = null;
    setToolArgsMock.mockClear();
    applyDocumentCropMock.mockClear();
    applyDocumentCropMock.mockReturnValue(true);
    pointerHandlers.onPointerDown.mockClear();
    pointerHandlers.onPointerMove.mockClear();
    pointerHandlers.onPointerUp.mockClear();
    toolArgsState.toolArgs = {
      toolName: 'crop',
      rect: null,
      preRatioRect: null,
      aspectRatio: null,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders a div with the provided className and cursor-crop class', () => {
      const { container } = render(<CropToolArea className="my-crop" overlayCtxRef={overlayCtxRef} />);
      const el = container.firstElementChild as HTMLDivElement;
      expect(el).not.toBeNull();
      expect(el.className).toBe('my-crop cursor-crop');
    });

    it('renders a div without crashing and spreads useRect pointer events', () => {
      const { container } = render(<CropToolArea className="test-crop" overlayCtxRef={overlayCtxRef} />);
      const el = container.firstElementChild as HTMLDivElement;
      expect(el).not.toBeNull();
      expect(el.tagName).toBe('DIV');

      fireEvent.pointerDown(el, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(el, { clientX: 6, clientY: 6 });
      fireEvent.pointerUp(el, { button: 0, clientX: 6, clientY: 6 });

      expect(pointerHandlers.onPointerDown).toHaveBeenCalledTimes(1);
      expect(pointerHandlers.onPointerMove).toHaveBeenCalledTimes(1);
      expect(pointerHandlers.onPointerUp).toHaveBeenCalledTimes(1);
    });
  });

  describe('useRect prop passing', () => {
    it('passes totalSize as imageSize and the tool rect as initialRect', () => {
      toolArgsState.toolArgs.rect = { x1: 10, y1: 20, x2: 100, y2: 200 };

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current).not.toBeNull();
      expect(useRectProps.current!.imageSize).toEqual({ width: 800, height: 600 });
      expect(useRectProps.current!.initialRect).toEqual({ x1: 10, y1: 20, x2: 100, y2: 200 });
    });

    it('passes aspectRatio from tool args', () => {
      toolArgsState.toolArgs.aspectRatio = 16 / 9;

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.aspectRatio).toBeCloseTo(16 / 9);
    });

    it('passes null aspectRatio when not set', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.aspectRatio).toBeNull();
    });

    it('provides an onChangeEnd callback', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.onChangeEnd).toEqual(expect.any(Function));
    });
  });

  describe('onChangeEnd', () => {
    it('sets the rect in tool args for a valid non-zero rectangle', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      act(() => {
        useRectProps.current!.onChangeEnd!({ x1: 10, y1: 20, x2: 100, y2: 200 });
      });

      expect(setToolArgsMock).toHaveBeenCalledTimes(1);
      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'crop',
          rect: { x1: 10, y1: 20, x2: 100, y2: 200 },
        })
      );
    });

    it('sets rect to null when trimRect produces zero width', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      act(() => {
        useRectProps.current!.onChangeEnd!({ x1: 10, y1: 20, x2: 10, y2: 200 });
      });

      expect(setToolArgsMock).toHaveBeenCalledTimes(1);
      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'crop',
          rect: null,
        })
      );
    });

    it('sets rect to null when trimRect produces zero height', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      act(() => {
        useRectProps.current!.onChangeEnd!({ x1: 10, y1: 20, x2: 100, y2: 20 });
      });

      expect(setToolArgsMock).toHaveBeenCalledTimes(1);
      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'crop',
          rect: null,
        })
      );
    });

    it('preserves the original rect argument (not the trimmed version) when valid', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      const newRect = { x1: 700, y1: 500, x2: 900, y2: 700 };

      act(() => {
        useRectProps.current!.onChangeEnd!(newRect);
      });

      // trimRect trims to image bounds but the callback receives the raw newRect
      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'crop',
          rect: newRect,
        })
      );
    });

    it('passes through aspectRatio and other args when setting rect', () => {
      toolArgsState.toolArgs.aspectRatio = 1;
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      act(() => {
        useRectProps.current!.onChangeEnd!({ x1: 10, y1: 10, x2: 50, y2: 50 });
      });

      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'crop',
          aspectRatio: 1,
          rect: { x1: 10, y1: 10, x2: 50, y2: 50 },
        })
      );
    });

    it('clears the pre-ratio rect when it publishes the committed rect', () => {
      // §41: a drag while a ratio is set refits the rect, so the framing the user drew before
      // choosing that ratio is no longer what the next `Free`/`Original` should restore. `Crop.tsx`
      // clears it on its own writes; this writer has to as well, or the stale framing survives into
      // the next ratio change.
      toolArgsState.toolArgs.preRatioRect = { x1: 5, y1: 6, x2: 200, y2: 150 };
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      act(() => {
        useRectProps.current!.onChangeEnd!({ x1: 10, y1: 20, x2: 100, y2: 200 });
      });

      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'crop',
          rect: { x1: 10, y1: 20, x2: 100, y2: 200 },
          preRatioRect: null,
        })
      );
    });

    it('clears the pre-ratio rect on the path that publishes no rect', () => {
      toolArgsState.toolArgs.preRatioRect = { x1: 5, y1: 6, x2: 200, y2: 150 };
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      act(() => {
        useRectProps.current!.onChangeEnd!({ x1: 10, y1: 10, x2: 10, y2: 200 });
      });

      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'crop', rect: null, preRatioRect: null })
      );
    });
  });

  describe('Enter and Escape', () => {
    const DRAWN = { x1: 10, y1: 20, x2: 100, y2: 200 };

    const pressKey = (key: string) => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    };

    it('commits the drawn crop on Enter, exactly as the panel Apply does', () => {
      toolArgsState.toolArgs.rect = DRAWN;
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      pressKey('Enter');

      expect(applyDocumentCropMock).toHaveBeenCalledExactlyOnceWith(DRAWN);
      expect(setToolArgsMock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ toolName: 'crop', rect: null, preRatioRect: null })
      );
    });

    it('clears the drawn crop on Escape without touching the document', () => {
      toolArgsState.toolArgs.rect = DRAWN;
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      pressKey('Escape');

      expect(applyDocumentCropMock).not.toHaveBeenCalled();
      expect(setToolArgsMock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ toolName: 'crop', rect: null, preRatioRect: null })
      );
    });

    it('does nothing on Enter with no crop drawn', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      pressKey('Enter');

      expect(applyDocumentCropMock).not.toHaveBeenCalled();
      expect(setToolArgsMock).not.toHaveBeenCalled();
    });

    it('keeps the crop on Enter when the document refuses the frame', () => {
      // `applyDocumentCrop` returns false for a zero-area rect and for a no-op frame, and the
      // panel's Apply drops the rect only on true. Enter has to make the same decision or the
      // drawing the user is looking at would vanish without anything happening to the document.
      applyDocumentCropMock.mockReturnValue(false);
      toolArgsState.toolArgs.rect = DRAWN;
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      pressKey('Enter');

      expect(applyDocumentCropMock).toHaveBeenCalledExactlyOnceWith(DRAWN);
      expect(setToolArgsMock).not.toHaveBeenCalled();
    });

    it('ignores keys that are neither Enter nor Escape', () => {
      toolArgsState.toolArgs.rect = DRAWN;
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      for (const key of ['a', ' ', 'Backspace', 'Tab']) pressKey(key);

      expect(applyDocumentCropMock).not.toHaveBeenCalled();
      expect(setToolArgsMock).not.toHaveBeenCalled();
    });

    it('stops listening once the crop surface unmounts', () => {
      toolArgsState.toolArgs.rect = DRAWN;
      const { unmount } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      unmount();
      pressKey('Enter');

      expect(applyDocumentCropMock).not.toHaveBeenCalled();
    });
  });
});
