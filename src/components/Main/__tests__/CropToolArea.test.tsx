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
      pointerState: { dimensionsRef: fitRef },
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

    it('opts out of the paint clamp, so the overhang stays on the overlay', () => {
      // Crop is the only consumer whose frame is a window onto a canvas that extends past the
      // image. Every other consumer wants the clamp, and passes this prop alone.
      render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      expect(useRectProps.current!.allowOutsideCanvas).toBe(true);
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

    it('renders nothing while the box is inside the document', () => {
      toolArgsState.toolArgs.rect = { x1: 100, y1: 100, x2: 400, y2: 300 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).toBeNull();
    });

    it('renders the overhang once the box leaves the document', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect(container.querySelector('[data-testid="crop-overhang-overlay"]')).not.toBeNull();
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

      const handles = readPieces(container).filter((piece) => piece.kind === 'handle');
      // Three, not four: the top-left handle at (700, 500) lies wholly inside the document, so the
      // canvas already paints it and a fourth element would be the same 12x12 square drawn twice.
      expect(handles).toHaveLength(3);
      for (const handle of handles) {
        expect(overlaps(handle, DOCUMENT)).toBe(false);
        // `HANDLE_SIZE` over the fit, so the same square at scale 1 and a square that still reads
        // as 12 CSS px at any other.
        expect(handle.width).toBe(12);
        expect(handle.height).toBe(12);
      }
    });

    it('paints the outside handles solid, in the canvas colour, and out of the hit path', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const handle = container.querySelector<HTMLElement>('[data-testid="crop-overhang-handle"]');
      // `drawMask` fills the handles; only the outline is dashed.
      expect(handle?.style.backgroundImage).toBe('');
      expect(handle?.style.backgroundColor).toBe('rgb(0, 123, 255)');
      // `getEdgeAtPoint` is the only thing that may answer "which edge is under the pointer".
      expect(handle?.className).toContain('pointer-events-none');
    });

    it('draws no handle for a box that fits the document, even one flush with its edges', () => {
      // A box exactly the size of the document has all four handles STRADDLING its corners, so each
      // one is a quarter outside — and this deliberately leaves those quarters to the canvas rather
      // than completing them here. The gate is "does the box leave the document", and completing a
      // clipped handle would change the default crop screen that has always been the default.
      toolArgsState.toolArgs.rect = { x1: 0, y1: 0, x2: 800, y2: 600 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      expect(container.querySelectorAll('[data-testid="crop-overhang-handle"]')).toHaveLength(0);
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

    it('paints the letterbox dark and the frame in the same colour the canvas strokes', () => {
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const dim = container.querySelector<HTMLElement>('[data-testid="crop-overhang-dim"]');
      expect(dim?.style.backgroundColor).toBe('rgba(0, 0, 0, 0.7)');

      // jsdom serialises the hex the painter passes into its `rgb()` form.
      const outline = container.querySelector<HTMLElement>('[data-testid="crop-overhang-outline"]');
      expect(outline?.style.backgroundImage).toContain('rgb(0, 123, 255)');
    });

    it('places the overhang with the contain fit the pointer divides by', () => {
      // The one thing that must not be re-derived: this transform is the fit `getLocalCoords` and
      // `drawMask` used, so the pieces below it land where the canvas put the document.
      toolArgsState.toolArgs.rect = { x1: 700, y1: 500, x2: 900, y2: 700 };
      const { container } = render(<CropToolArea className="test" overlayCtxRef={overlayCtxRef} />);

      repaint(toolArgsState.toolArgs.rect);

      const layer = container.querySelector<HTMLElement>('[data-testid="crop-overhang-overlay"]')
        ?.firstElementChild as HTMLElement;
      expect(layer.style.transform).toBe('translate(100px, 100px) scale(1)');
      expect(layer.style.width).toBe('800px');
      expect(layer.style.height).toBe('600px');
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
