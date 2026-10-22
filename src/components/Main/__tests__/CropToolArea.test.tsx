import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import { CropToolArea } from '../CropToolArea.tsx';
import { SET_DOCUMENT_FRAME_ACTION } from '../../../util/constants.ts';
import { drawLayersToCanvas } from '../../../contexts/layer-renderer.ts';

const setToolArgsMock = vi.hoisted(() => vi.fn());
const applyDocumentCropMock = vi.hoisted(() => vi.fn(() => true));
const devicePixelRatioState = vi.hoisted(() => ({ current: 1 }));
const storeState = vi.hoisted(
  (): {
    totalSize: { width: number; height: number };
    viewState: { panX: number; panY: number; zoom: number; fitScaleCompensation: number; rotation: number };
    documentFrame: { x: number; y: number; width: number; height: number };
    layers: Record<string, never>;
    history: Array<{ actionName: string; disabled?: boolean; args?: unknown }>;
    historyIndex: number;
  } => ({
    totalSize: { width: 800, height: 600 },
    viewState: { panX: 0, panY: 0, zoom: 1, fitScaleCompensation: 1, rotation: 0 },
    documentFrame: { x: 0, y: 0, width: 800, height: 600 },
    layers: {},
    history: [],
    historyIndex: 0,
  })
);

const useRectProps = vi.hoisted((): { current: UseRectProps | null } => ({ current: null }));

const pointerHandlers = vi.hoisted(() => ({
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onPointerCancel: vi.fn(),
}));

const pointerDownState = vi.hoisted(() => ({ current: false }));
const rectRedrawMock = vi.hoisted(() => vi.fn());

const createGuideContext = () => ({
  clearRect: vi.fn(),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  setLineDash: vi.fn(),
  stroke: vi.fn(),
});

const overlayCtxRef = { current: null as CanvasRenderingContext2D | null };

/**
 * The contain fit `useRect`'s painter reads, in the ref it reads it from.
 *
 * A 1000x800 container around an 800x600 frame, so `offsetX`/`offsetY` are 100 and the frame
 * occupies (100, 100) - (900, 700) in CSS px while the pieces this component builds are in canvas
 * px — the frame's own space, which is what `CropToolArea`'s helper is written in. A scale of 1
 * keeps the two the same number, so a test can say where a piece belongs without doing arithmetic
 * first; the fit itself is asserted separately.
 */
const fitRef = vi.hoisted((): { current: Record<string, number> } => ({
  current: {
    innerWidth: 800,
    innerHeight: 600,
    outerWidth: 1000,
    outerHeight: 800,
    offsetX: 100,
    offsetY: 100,
    scale: 1,
  },
}));

const toolArgsState = vi.hoisted(
  (): {
    toolArgs: {
      toolName: 'crop';
      rect: { x1: number; y1: number; x2: number; y2: number } | null;
      preRatioRect: { x1: number; y1: number; x2: number; y2: number } | null;
      aspectRatio: number | null;
      angle?: number;
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
      canvasRef: { current: document.createElement('canvas') },
      ...storeState,
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
  MAX_DOCUMENT_FRAME_AREA: 16_777_216,
  MAX_DOCUMENT_FRAME_SIDE: 4096,
  useLayers: () => ({ applyDocumentCrop: applyDocumentCropMock }),
}));

vi.mock('../../../contexts/layer-renderer.ts', () => ({
  drawLayersToCanvas: vi.fn((): boolean => false),
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  ROTATE_HANDLE_OFFSET: 12,
  computeOverlayColor: vi.fn(() => 'rgba(255, 255, 255, 0.8)'),
  drawCropOverlay: vi.fn(),
  useRect: (props: UseRectProps) => {
    useRectProps.current = props;
    return {
      pointerHandlers: {
        onPointerDown: pointerHandlers.onPointerDown,
        onPointerMove: pointerHandlers.onPointerMove,
        onPointerUp: pointerHandlers.onPointerUp,
        onPointerCancel: pointerHandlers.onPointerCancel,
      },
      rectHandles: { redraw: rectRedrawMock },
      pointerState: { dimensionsRef: fitRef, isMouseDown: pointerDownState },
    };
  },
}));

vi.mock('../../../hooks/useDevicePixelRatio.ts', () => ({
  useDevicePixelRatio: () => devicePixelRatioState.current,
}));

describe('CropToolArea', () => {
  beforeEach(() => {
    useRectProps.current = null;
    setToolArgsMock.mockClear();
    vi.mocked(drawLayersToCanvas).mockReset();
    vi.mocked(drawLayersToCanvas).mockReturnValue(false);
    applyDocumentCropMock.mockClear();
    applyDocumentCropMock.mockReturnValue(true);
    devicePixelRatioState.current = 1;
    pointerHandlers.onPointerDown.mockClear();
    pointerHandlers.onPointerMove.mockClear();
    pointerHandlers.onPointerUp.mockClear();
    pointerHandlers.onPointerCancel.mockClear();
    rectRedrawMock.mockClear();
    toolArgsState.toolArgs = {
      toolName: 'crop',
      rect: null,
      preRatioRect: null,
      aspectRatio: null,
    };
    storeState.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
    storeState.totalSize = { width: 800, height: 600 };
    storeState.layers = {};
    storeState.history = [];
    storeState.historyIndex = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('redraws the rotated crop overlay after the shared canvas backing store changes DPR', async () => {
      toolArgsState.toolArgs.angle = 24;
      const { rerender } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      devicePixelRatioState.current = 2;
      rerender(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      await act(async () => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      });

      expect(rectRedrawMock).toHaveBeenCalledTimes(1);
    });

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

    it('routes pointer cancellation through the crop gesture handler', () => {
      const { container } = render(<CropToolArea className="test-crop" overlayCtxRef={overlayCtxRef} />);
      const element = container.firstElementChild as HTMLDivElement;
      fireEvent.pointerCancel(element);
      expect(pointerHandlers.onPointerCancel).toHaveBeenCalledTimes(1);
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

    it('seeds the current document bounds when re-entering crop after a frame edit', () => {
      storeState.history = [{ actionName: SET_DOCUMENT_FRAME_ACTION }];
      storeState.historyIndex = 0;

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      const fullFrame = { x1: 0, y1: 0, x2: 800, y2: 600 };
      expect(useRectProps.current!.initialRect).toEqual(fullFrame);
      expect(setToolArgsMock).not.toHaveBeenCalled();
    });

    it('keeps the first crop entry free for drawing a new crop rectangle', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.initialRect).toBeNull();
      expect(setToolArgsMock).not.toHaveBeenCalled();
    });

    it('does not seed a recrop box from a frame edit that has been undone', () => {
      storeState.history = [{ actionName: SET_DOCUMENT_FRAME_ACTION }];
      storeState.historyIndex = -1;

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.initialRect).toBeNull();
    });

    it('opts out of the paint clamp, so the overhang stays on the overlay', () => {
      // Crop is the only consumer whose frame is a window onto a canvas that extends past the
      // image. Every other consumer wants the clamp, and passes this prop alone.
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.allowOutsideCanvas).toBe(true);
    });

    it('uses one overflow-safe border, handle, and guide renderer for unrotated crops', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.hideBlend).toBe(true);
      expect(useRectProps.current!.externalOverlay).toBe(true);
      expect(useRectProps.current!.incrementalOverlay).toBe(false);
      expect(useRectProps.current!.hideBorder).toBe(true);
      expect(useRectProps.current!.hideHandles).toBe(true);
      expect(useRectProps.current!.hideRotationHandle).toBe(true);
      expect(useRectProps.current!.overlayType).toBeUndefined();
    });

    it('keeps rotated guides on the incremental painter with a cached color sampler', () => {
      toolArgsState.toolArgs.angle = 15;
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.externalOverlay).toBe(false);
      expect(useRectProps.current!.incrementalOverlay).toBe(true);
      expect(useRectProps.current!.overlayColorForRect).toEqual(expect.any(Function));
      expect(useRectProps.current!.overlayType).toBe('ruleOfThirds');
    });

    it('opts into the Shift square and the Option from-centre fresh-drag modifiers', () => {
      // Adobe's crop rows: Shift constrains the proportions of a new box, Option draws it outward
      // from its centre, and the two together do both. `useRect` asks per consumer because the Move
      // and text tools deliberately constrain nothing, so a crop that passed neither had no
      // from-centre drag at all and no square — its Shift row was aspirational.
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.constrainToSquare).toBe(true);
      expect(useRectProps.current!.fromCentre).toBe(true);
    });

    it('provides an onChangeEnd callback', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.onChangeEnd).toEqual(expect.any(Function));
    });

    it('provides an onRepaint callback, which is where the overhang overlay gets its geometry', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.onRepaint).toEqual(expect.any(Function));
    });
  });

  describe('retained-pixel preview', () => {
    it('keeps the last preview pixels when recomposition fails', () => {
      storeState.documentFrame = { x: 80, y: 100, width: 800, height: 600 };
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: 0, width: 800, height: 600 },
            nextFrame: storeState.documentFrame,
          },
        },
      ];
      storeState.historyIndex = 0;
      const context = createGuideContext();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: 0, x2: 800, y2: 600 });
      });

      expect(drawLayersToCanvas).toHaveBeenCalledTimes(1);
      expect(context.clearRect).not.toHaveBeenCalled();
    });

    it('keeps the last successful preview geometry when a larger frame fails to recompose', () => {
      const firstFrame = { x: 80, y: 100, width: 800, height: 600 };
      storeState.documentFrame = firstFrame;
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: 0, width: 800, height: 600 },
            nextFrame: firstFrame,
          },
        },
      ];
      storeState.historyIndex = 0;
      vi.mocked(drawLayersToCanvas).mockReturnValue(true);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createGuideContext() as never);
      const { container, rerender } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: 0, x2: 800, y2: 600 });
      });
      const preview = container.querySelector('[data-testid="crop-retained-pixels-preview"]') as HTMLCanvasElement;
      const previewGeometry = () => ({
        left: preview.style.left,
        top: preview.style.top,
        width: preview.style.width,
        height: preview.style.height,
      });
      expect(previewGeometry()).toEqual({ left: '-80px', top: '-100px', width: '880px', height: '700px' });

      const nextFrame = { x: 100, y: 120, width: 820, height: 620 };
      storeState.documentFrame = nextFrame;
      storeState.totalSize = { width: 820, height: 620 };
      storeState.history = [
        ...storeState.history,
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: { previousFrame: firstFrame, nextFrame },
        },
      ];
      storeState.historyIndex = 1;
      vi.mocked(drawLayersToCanvas).mockReturnValue(false);
      rerender(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(vi.mocked(drawLayersToCanvas).mock.calls.at(-1)?.[2]).toEqual({ x: 0, y: 0, width: 920, height: 740 });
      expect(previewGeometry()).toEqual({ left: '-100px', top: '-120px', width: '880px', height: '700px' });
    });

    it('restores newly exposed retained pixels from the uncut source when a smaller frame fails to recompose', () => {
      const firstFrame = { x: 80, y: 100, width: 800, height: 600 };
      storeState.documentFrame = firstFrame;
      storeState.totalSize = { width: 800, height: 600 };
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: 0, width: 800, height: 600 },
            nextFrame: firstFrame,
          },
        },
      ];
      storeState.historyIndex = 0;
      const context = createGuideContext();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
      vi.mocked(drawLayersToCanvas).mockReturnValue(true);
      const { container, rerender } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: 0, x2: 800, y2: 600 });
      });

      const preview = container.querySelector('[data-testid="crop-retained-pixels-preview"]') as HTMLCanvasElement;
      const sourceCanvas = vi.mocked(drawLayersToCanvas).mock.calls[0]?.[0];
      expect(sourceCanvas).toBeInstanceOf(HTMLCanvasElement);
      expect(sourceCanvas).not.toBe(preview);
      expect(context.drawImage).toHaveBeenCalledTimes(1);
      expect(context.clearRect).toHaveBeenLastCalledWith(80, 100, 800, 600);

      const smallerFrame = { x: 100, y: 120, width: 780, height: 580 };
      storeState.documentFrame = smallerFrame;
      storeState.totalSize = { width: 780, height: 580 };
      storeState.history = [
        ...storeState.history,
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: { previousFrame: firstFrame, nextFrame: smallerFrame },
        },
      ];
      storeState.historyIndex = 1;
      vi.mocked(drawLayersToCanvas).mockReturnValue(false);
      rerender(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(vi.mocked(drawLayersToCanvas).mock.calls.at(-1)?.[0]).toBe(sourceCanvas);
      expect(context.drawImage).toHaveBeenCalledTimes(2);
      expect(context.drawImage.mock.calls.at(-1)?.[0]).toBe(sourceCanvas);
      expect(context.clearRect).toHaveBeenLastCalledWith(100, 120, 780, 580);
      expect({
        left: preview.style.left,
        top: preview.style.top,
        width: preview.style.width,
        height: preview.style.height,
      }).toEqual({
        left: '-100px',
        top: '-120px',
        width: '880px',
        height: '700px',
      });
    });

    it('releases the retained source backing store when the crop no longer has hidden pixels', () => {
      const frame = { x: 80, y: 100, width: 800, height: 600 };
      storeState.documentFrame = frame;
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: 0, width: 800, height: 600 },
            nextFrame: frame,
          },
        },
      ];
      storeState.historyIndex = 0;
      vi.mocked(drawLayersToCanvas).mockReturnValue(true);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createGuideContext() as never);
      const { rerender } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: 0, x2: 800, y2: 600 });
      });
      const sourceCanvas = vi.mocked(drawLayersToCanvas).mock.calls[0]?.[0];
      if (!sourceCanvas) throw new Error('retained-pixel source canvas was not created');
      expect(sourceCanvas.width).toBeGreaterThan(1);

      storeState.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
      storeState.totalSize = { width: 800, height: 600 };
      storeState.history = [];
      storeState.historyIndex = -1;
      rerender(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(sourceCanvas.width).toBe(1);
      expect(sourceCanvas.height).toBe(1);
      expect(sourceCanvas.hasAttribute('data-hidpi-ratio')).toBe(false);
    });

    it('keeps the preview frame stable while the pending crop is resized', () => {
      storeState.documentFrame = { x: 80, y: 100, width: 800, height: 600 };
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: 0, width: 800, height: 600 },
            nextFrame: storeState.documentFrame,
          },
        },
      ];
      storeState.historyIndex = 0;
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createGuideContext() as never);

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: 0, x2: 800, y2: 600 });
      });

      expect(drawLayersToCanvas).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement),
        [],
        { x: 0, y: 0, width: 880, height: 700 },
        undefined,
        expect.any(Number)
      );

      act(() => {
        useRectProps.current!.onRepaint?.({ x1: -200, y1: -160, x2: 1000, y2: 900 });
      });

      expect(drawLayersToCanvas).toHaveBeenCalledTimes(1);
    });

    it('does not compose a retained-pixel preview for rotated crops', () => {
      toolArgsState.toolArgs.angle = 12;
      storeState.documentFrame = { x: 80, y: 100, width: 800, height: 600 };
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: 0, width: 800, height: 600 },
            nextFrame: storeState.documentFrame,
          },
        },
      ];
      storeState.historyIndex = 0;
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createGuideContext() as never);

      const { queryByTestId } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: -20, x2: 800, y2: 300 });
      });

      expect(queryByTestId('crop-retained-pixels-preview')).toBeNull();
      expect(drawLayersToCanvas).not.toHaveBeenCalled();
    });

    it('caps the recovery preview backing store at high pixel counts and high DPR', () => {
      devicePixelRatioState.current = 2;
      storeState.documentFrame = { x: 0, y: 0, width: 4096, height: 4095 };
      storeState.totalSize = { width: 4096, height: 4095 };
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: -1, width: 4096, height: 4096 },
            nextFrame: storeState.documentFrame,
          },
        },
      ];
      storeState.historyIndex = 0;
      const context = createGuideContext();
      vi.mocked(drawLayersToCanvas).mockReturnValue(true);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: -1, x2: 4096, y2: 4095 });
      });

      expect(drawLayersToCanvas).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement),
        [],
        { x: 0, y: -1, width: 4096, height: 4096 },
        undefined,
        expect.any(Number)
      );
      const backingScale = vi.mocked(drawLayersToCanvas).mock.calls[0]?.[4];
      if (backingScale === undefined) throw new Error('retained-pixel renderer was not called');
      const backingPixels = Math.round(4096 * backingScale) ** 2;
      expect(backingPixels).toBeLessThanOrEqual(Math.floor(16_777_216 / 5));
      expect(context.setTransform).toHaveBeenCalledWith(backingScale, 0, 0, backingScale, 0, 0);
    });

    it('keeps the rounded backing dimensions within budget for asymmetric frames', () => {
      devicePixelRatioState.current = 2;
      storeState.documentFrame = { x: 0, y: 0, width: 259, height: 4071 };
      storeState.totalSize = { width: 259, height: 4071 };
      storeState.history = [
        {
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: {
            previousFrame: { x: 0, y: -1, width: 259, height: 4072 },
            nextFrame: storeState.documentFrame,
          },
        },
      ];
      storeState.historyIndex = 0;
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createGuideContext() as never);

      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      act(() => {
        useRectProps.current!.onRepaint?.({ x1: 0, y1: -1, x2: 259, y2: 4071 });
      });

      expect(drawLayersToCanvas).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement),
        [],
        { x: 0, y: -1, width: 259, height: 4072 },
        undefined,
        expect.any(Number)
      );
      const backingScale = vi.mocked(drawLayersToCanvas).mock.calls[0]?.[4];
      if (backingScale === undefined) throw new Error('retained-pixel renderer was not called');
      const backingPixels = Math.round(259 * backingScale) * Math.round(4072 * backingScale);
      expect(backingScale).toBeLessThan(2);
      expect(backingPixels).toBeLessThanOrEqual(Math.floor(16_777_216 / 5));
      expect(backingPixels * 5).toBeLessThanOrEqual(16_777_216);
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

    it('sets rect to null when the rect has zero width', () => {
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

    it('sets rect to null when the rect has zero height', () => {
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

    it('sets rect to null when the rect lies entirely on one edge of its own extent', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      act(() => {
        useRectProps.current!.onChangeEnd!({ x1: 400, y1: 300, x2: 400, y2: 300 });
      });

      expect(setToolArgsMock).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'crop', rect: null }));
    });

    it('keeps a rect that overhangs the far edge of the document', () => {
      // The test this replaces asked `trimRect` whether the rect FIT, and a rect past the far edge
      // of an 800x600 document was clamped against that edge to a zero-width line. It has 200px of
      // real extent, and it is exactly the shape the canvas-growing crop is made of.
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      const newRect = { x1: 900, y1: 500, x2: 1100, y2: 700 };

      act(() => {
        useRectProps.current!.onChangeEnd!(newRect);
      });

      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'crop', rect: newRect, preRatioRect: null })
      );
    });

    it('keeps a rect that overhangs the origin corner', () => {
      // The mirror of the case above, and the one a clamp flattens hardest: every edge is negative,
      // so a clamp against `[0, size]` collapses the whole 200x150 rect onto the origin.
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      const newRect = { x1: -300, y1: -200, x2: -100, y2: -50 };

      act(() => {
        useRectProps.current!.onChangeEnd!(newRect);
      });

      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'crop', rect: newRect, preRatioRect: null })
      );
    });

    it('keeps a rect that overhangs one side while the others stay inside', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      const newRect = { x1: 100, y1: 100, x2: 1000, y2: 400 };

      act(() => {
        useRectProps.current!.onChangeEnd!(newRect);
      });

      expect(setToolArgsMock).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'crop', rect: newRect, preRatioRect: null })
      );
    });

    it('preserves the original rect argument (not the trimmed version) when valid', () => {
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      const newRect = { x1: 700, y1: 500, x2: 900, y2: 700 };

      act(() => {
        useRectProps.current!.onChangeEnd!(newRect);
      });

      // the emptiness test asks whether the rect is degenerate; the raw `newRect` is what is
      // published either way, so the overhang survives all the way into the tool args
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

  describe('overhang overlay', () => {
    /**
     * The document frame and one box, both in CANVAS px — the coordinate system the pieces are
     * written in, before the layer transform carries them onto the workspace. The fit never enters
     * into it, which is what keeps the geometry assertions free of arithmetic.
     */
    const DOCUMENT = { left: 0, top: 0, right: 800, bottom: 600 };
    const BOX_OVERHANGING_RIGHT = { left: 700, top: 100, right: 1000, bottom: 300 };
    const EPSILON = 0.001;

    type Piece = { kind: 'dim' | 'outline' | 'handle'; left: number; top: number; width: number; height: number };

    const readPieces = (root: HTMLElement): Piece[] =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          '[data-testid="crop-overhang-dim"], [data-testid="crop-overhang-outline"], [data-testid="crop-overhang-handle"]'
        )
      ).map((node) => ({
        kind: node.dataset.testid!.replace('crop-overhang-', '') as Piece['kind'],
        left: Number.parseFloat(node.style.left),
        top: Number.parseFloat(node.style.top),
        width: Number.parseFloat(node.style.width),
        height: Number.parseFloat(node.style.height),
      }));

    const overlaps = (piece: Piece, other: typeof DOCUMENT) =>
      piece.left < other.right - EPSILON &&
      piece.left + piece.width > other.left + EPSILON &&
      piece.top < other.bottom - EPSILON &&
      piece.top + piece.height > other.top + EPSILON;

    /** Publish a rect the way `useRect`'s painter does, from inside its own repaint. */
    const repaint = (rect: { x1: number; y1: number; x2: number; y2: number }) => {
      act(() => {
        useRectProps.current!.onRepaint!(rect);
      });
    };

    it('renders nothing until the painter reports a frame', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).toBeNull();
    });

    it('uses the same crop chrome renderer while the box is inside the document', () => {
      toolArgsState.toolArgs.rect = { x1: 100, y1: 100, x2: 400, y2: 300 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="crop-selection-outline"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="crop-composition-guide"]')).not.toBeNull();
    });

    it('dims the in-frame pixels outside the crop with four local overlay bands', () => {
      toolArgsState.toolArgs.rect = { x1: 100, y1: 100, x2: 400, y2: 300 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);
      repaint(toolArgsState.toolArgs.rect);

      const bands = [...container.querySelectorAll('[data-testid="crop-frame-dim"]')].map((node) => {
        const element = node as HTMLDivElement;
        return {
          x: Number.parseFloat(element.style.left),
          y: Number.parseFloat(element.style.top),
          width: Number.parseFloat(element.style.width),
          height: Number.parseFloat(element.style.height),
          color: element.style.backgroundColor,
        };
      });
      expect(bands).toHaveLength(4);
      expect(bands).toEqual(
        expect.arrayContaining([
          { x: 0, y: 0, width: 800, height: 100, color: 'rgba(0, 0, 0, 0.7)' },
          { x: 0, y: 300, width: 800, height: 300, color: 'rgba(0, 0, 0, 0.7)' },
          { x: 0, y: 100, width: 100, height: 200, color: 'rgba(0, 0, 0, 0.7)' },
          { x: 400, y: 100, width: 400, height: 200, color: 'rgba(0, 0, 0, 0.7)' },
        ])
      );
    });

    it('renders the overhang once the box leaves the document', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).not.toBeNull();
    });

    it('suppresses axis-aligned overhang guides for a rotated crop', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      toolArgsState.toolArgs.angle = 15;
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).toBeNull();
    });

    it('renders the overhang on a single side, and shades only around it', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 100, x2: 1000, y2: 300 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const pieces = readPieces(container);
      // The right edge is out, and the pieces are in CANVAS px, so `right` is the frame's own
      // width rather than anything the fit produced.
      expect(pieces.some((piece) => piece.left >= DOCUMENT.right - EPSILON)).toBe(true);
      // The box's own overhang is a window onto the canvas, not a dimmed part of it.
      for (const piece of pieces.filter((candidate) => candidate.kind === 'dim')) {
        expect(overlaps(piece, BOX_OVERHANGING_RIGHT)).toBe(false);
      }
    });

    it('draws the corner handles that fall outside the document, and no others', () => {
      // The dead end this closes: the box overhangs to the right and the bottom, so three of the
      // four corner handles are (at least partly) off the document, where the tool overlay's backing
      // store clips them away. They were still hit-tested and still found by `getEdgeAtPoint`; there
      // was simply nothing drawn where the user had to click.
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const handles = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="crop-selection-handle"]'));
      expect(handles).toHaveLength(4);
      for (const handle of handles) {
        expect(handle.style.width).toBe('12px');
        expect(handle.style.height).toBe('12px');
      }
    });

    it('paints all crop handles solid, in the crop colour, and out of the hit path', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const handle = container.querySelector<HTMLElement>('[data-testid="crop-selection-handle"]');
      expect(handle?.style.backgroundColor).toBe('rgb(0, 123, 255)');
      // `getEdgeAtPoint` is the only thing that may answer "which edge is under the pointer".
      expect(handle?.className).toContain('pointer-events-none');
    });

    it('keeps all four handles visible for a box flush with the document edges', () => {
      toolArgsState.toolArgs.rect = { x1: 0, y1: 0, x2: 800, y2: 600 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect(container.querySelectorAll('[data-testid="crop-selection-handle"]')).toHaveLength(4);
    });

    it('draws nothing over the document, which the canvas already dims', () => {
      // The canvas fills the whole document with the dim and clears the box. A piece overlapping the
      // document would stack a second `rgba(0, 0, 0, 0.7)` there and render the frame at 0.91.
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const pieces = readPieces(container);
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces) {
        expect(overlaps(piece, DOCUMENT)).toBe(false);
      }
    });

    it('paints the letterbox dark and uses one SVG crop outline across the frame edge', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const dim = container.querySelector<HTMLElement>('[data-testid="crop-overhang-dim"]');
      expect(dim?.style.backgroundColor).toBe('rgba(0, 0, 0, 0.7)');

      const outline = container.querySelector<SVGElement>('[data-testid="crop-selection-outline"] rect');
      expect(outline?.getAttribute('stroke')).toBe('#007bff');
      expect(outline?.getAttribute('stroke-dasharray')).toBe('5 5');
    });

    it('places the overhang with the contain fit the pointer divides by', () => {
      // The fit plane and view plane mirror the two transforms the canvas receives: contain fit
      // inside the document, then pan/zoom/rotation around the workspace viewport.
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const overlay = container.querySelector<HTMLElement>('[data-testid="crop-overhang-overlay"]');
      expect(overlay?.style.transform).toBe('');
      const viewPlane = overlay?.firstElementChild as HTMLElement;
      expect(viewPlane.style.transform).toBe('translate(0px, 0px) scale(1) rotate(0deg)');
      const fitPlane = viewPlane.firstElementChild as HTMLElement;
      expect(fitPlane.style.transform).toBe('translate(100px, 100px) scale(1)');
      expect(fitPlane.style.width).toBe('800px');
      expect(fitPlane.style.height).toBe('600px');
    });

    it('keeps the overlay out of the gesture path', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const overlay = container.querySelector<HTMLElement>('[data-testid="crop-overhang-overlay"]');
      expect(overlay?.className).toContain('pointer-events-none');
    });

    it('stops rendering the overhang once the crop is cleared', () => {
      // `drawMask` returns before `onRepaint` when there is no rect left to paint, so the published
      // rect is the only thing that can retire the last frame.
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container, rerender } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);
      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).not.toBeNull();

      toolArgsState.toolArgs.rect = null;
      rerender(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).toBeNull();
    });

    it('leaves the gesture div itself untouched', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test-crop" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect((container.firstElementChild as HTMLElement).className).toBe('test-crop cursor-crop');
      expect(pointerHandlers.onPointerDown).not.toHaveBeenCalled();
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
