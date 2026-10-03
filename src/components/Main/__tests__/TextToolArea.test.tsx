import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import { TextToolArea } from '../TextToolArea.tsx';
import { renderText } from '../../../tools/text.ts';
import { calculateNewRect } from '../../../util/rect.ts';

type TextArgs = {
  align: 'left' | 'center' | 'right';
  bold: boolean;
  color: string;
  fontFamily: string;
  fontSize: number;
  italic: boolean;
  lineHeight: number;
  text?: string;
  rect: { x1: number; y1: number; x2: number; y2: number } | null;
  toolName: 'text' | 'draw';
};

const h = vi.hoisted(() => ({
  setToolArgs: vi.fn(),
  dispatch: vi.fn(),
  color: '#000000',
  redraw: vi.fn(),
  pointerDown: vi.fn(),
  pointerMove: vi.fn(),
  pointerUp: vi.fn(),
  // `useRect`'s own record of what the current press hit: `null` for a press on empty canvas, and
  // `'inside'` or an edge name for a press on an existing box. The component reads it to decide
  // whether the gesture may change what KIND of box the draft is.
  currentEdgeRef: { current: null as string | null },
  useRectProps: { current: null as UseRectProps | null },
  textarea: { current: null as HTMLTextAreaElement | null },
  containerRef: { current: document.createElement('div') },
  toolOverlayRef: { current: document.createElement('canvas') },
}));

const makeTextArgs = (overrides: Partial<TextArgs> = {}): TextArgs => ({
  align: 'left',
  bold: false,
  color: '#000000',
  fontFamily: 'Arial',
  fontSize: 16,
  italic: false,
  lineHeight: 1.2,
  rect: null,
  toolName: 'text',
  ...overrides,
});

let toolArgs: TextArgs = makeTextArgs();

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      get containerRef() {
        return h.containerRef;
      },
      get textareaRef() {
        return h.textarea;
      },
      get toolOverlayRef() {
        return h.toolOverlayRef;
      },
      get color() {
        return h.color;
      },
      totalSize: { width: 100, height: 100 },
    },
    h.dispatch,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    get toolArgs() {
      return toolArgs;
    },
    get setToolArgs() {
      return h.setToolArgs;
    },
  }),
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: UseRectProps) => {
    h.useRectProps.current = props;
    return {
      pointerHandlers: {
        onPointerDown: h.pointerDown,
        onPointerMove: h.pointerMove,
        onPointerUp: h.pointerUp,
      },
      rectHandles: { redraw: h.redraw, clearSelection: vi.fn() },
      pointerState: { currentEdgeRef: h.currentEdgeRef },
    };
  },
}));

vi.mock('../../../util/rect.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../util/rect.ts')>('../../../util/rect.ts');
  return {
    ...actual,
    calculateNewRect: vi.fn(() => null),
  };
});

vi.mock('../../../tools/text.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../tools/text.ts')>('../../../tools/text.ts');
  return {
    ...actual,
    renderText: vi.fn(),
  };
});

const renderArea = (overlayCtxRef: { current: CanvasRenderingContext2D | null } = { current: null }) =>
  render(<TextToolArea overlayCtxRef={overlayCtxRef} />);

/**
 * A whole press-drag-release, followed by the `onChangeEnd` `useRect` would have called.
 *
 * The pointer events are fired for real rather than `onChangeEnd` being called directly, because
 * the two client positions ARE the input now: the component measures how far the POINTER travelled,
 * in CSS px, and the rect it is handed is only the box. Calling `onChangeEnd` with a rect alone
 * would test the old rule and pass for the wrong reason.
 */
const gesture = (
  rendered: { container: HTMLElement },
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: { x1: number; y1: number; x2: number; y2: number }
) => {
  // The tool area's own element, not RTL's wrapper: the handlers are spread onto the div the
  // component renders, and firing at the wrapper would never reach them.
  const area = rendered.container.firstElementChild as HTMLElement;
  fireEvent.pointerDown(area, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(area, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(area, { button: 0, clientX: to.x, clientY: to.y });
  act(() => h.useRectProps.current!.onChangeEnd(rect));
};

describe('TextToolArea', () => {
  beforeEach(() => {
    h.setToolArgs.mockReset();
    h.dispatch.mockReset();
    h.redraw.mockReset();
    h.pointerDown.mockReset();
    h.pointerMove.mockReset();
    h.pointerUp.mockReset();
    h.currentEdgeRef.current = null;
    h.useRectProps.current = null;
    h.textarea = { current: null };
    h.color = '#000000';
    toolArgs = makeTextArgs();
    vi.mocked(calculateNewRect).mockReset();
    vi.mocked(calculateNewRect).mockReturnValue(null);
    vi.mocked(renderText).mockReset();
  });

  it('does not crash when the textarea ref is not attached yet', () => {
    expect(() => renderArea()).not.toThrow();
  });

  it('focuses the textarea after text arguments become active', () => {
    toolArgs = makeTextArgs({ toolName: 'draw' });
    const { rerender } = renderArea();
    const textarea = document.createElement('textarea');
    const focus = vi.spyOn(textarea, 'focus');
    h.textarea.current = textarea;

    act(() => {
      toolArgs = makeTextArgs({ toolName: 'text' });
      rerender(<TextToolArea overlayCtxRef={{ current: null }} />);
    });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not crash when a rectangle finishes while the textarea is unavailable', () => {
    renderArea();

    expect(() => act(() => h.useRectProps.current?.onChangeEnd?.({ x1: 0, y1: 0, x2: 10, y2: 10 }))).not.toThrow();
  });

  it('renders a div carrying the supplied className and the text cursor', () => {
    const { container } = render(<TextToolArea className="my-text" overlayCtxRef={{ current: null }} />);
    const el = container.firstElementChild as HTMLElement;

    expect(el).toBeInTheDocument();
    expect(el.className).toBe('my-text cursor-text');
  });

  describe('useRect wiring', () => {
    it('passes the document size, container, tool overlay and text rect to useRect', () => {
      toolArgs = makeTextArgs({ rect: { x1: 10, y1: 20, x2: 90, y2: 60 } });

      renderArea();

      expect(h.useRectProps.current).toMatchObject({
        imageSize: { width: 100, height: 100 },
        containerRef: h.containerRef,
        overlayRef: h.toolOverlayRef,
        initialRect: { x1: 10, y1: 20, x2: 90, y2: 60 },
      });
    });

    it('repaints through redrawText on every rect repaint', () => {
      renderArea();

      expect(h.useRectProps.current!.onRepaint).toEqual(expect.any(Function));
    });

    it('spreads the useRect pointer handlers onto the surface', () => {
      const { container } = renderArea();
      const el = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(el, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(el, { clientX: 6, clientY: 6 });
      fireEvent.pointerUp(el, { button: 0, clientX: 6, clientY: 6 });

      expect(h.pointerDown).toHaveBeenCalledTimes(1);
      expect(h.pointerMove).toHaveBeenCalledTimes(1);
      expect(h.pointerUp).toHaveBeenCalledTimes(1);
    });
  });

  describe('onChangeEnd', () => {
    it('commits the recalculated rect and leaves the tool its own colour', () => {
      h.color = '#ff0000';
      toolArgs = makeTextArgs({ text: 'hi', rect: { x1: 0, y1: 0, x2: 40, y2: 20 }, color: '#0000ff' });
      const newRect = { x1: 0, y1: 0, x2: 55, y2: 20 };
      vi.mocked(calculateNewRect).mockReturnValue(newRect);

      const rendered = renderArea();
      // A real 40x20 drag rather than a bare `onChangeEnd`, because the classification reads the
      // pointer's travel and a rect alone no longer decides it.
      gesture(rendered, { x: 0, y: 0 }, { x: 40, y: 20 }, { x1: 0, y1: 0, x2: 40, y2: 20 });

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'hi', rect: { x1: 0, y1: 0, x2: 40, y2: 20 } }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      // The type colour belongs to the tool and is edited on the options bar. The store's
      // foreground used to be written over it here, which is what made the swatch unwritable: a
      // drag republished the foreground, not the colour the user had chosen.
      // A 40x20 press is a drag, so the committed record also says which of Adobe's two kinds of
      // type layer the gesture placed.
      expect(h.setToolArgs).toHaveBeenCalledWith({ ...toolArgs, color: '#0000ff', rect: newRect, kind: 'paragraph' });
    });

    it('does not republish the args when only the store foreground changed', () => {
      h.color = '#ff0000';
      toolArgs = makeTextArgs({ text: 'hi', rect: { x1: 0, y1: 0, x2: 40, y2: 20 }, color: '#0000ff' });
      vi.mocked(calculateNewRect).mockReturnValue({ x1: 0, y1: 0, x2: 55, y2: 20 });
      const { rerender } = renderArea();

      h.color = '#00ff00';
      act(() => {
        rerender(<TextToolArea overlayCtxRef={{ current: null }} />);
      });

      expect(h.setToolArgs).not.toHaveBeenCalled();
    });

    it('focuses the textarea after a successful change end', () => {
      renderArea();
      const textarea = document.createElement('textarea');
      const focus = vi.spyOn(textarea, 'focus');
      h.textarea.current = textarea;
      vi.mocked(calculateNewRect).mockReturnValue({ x1: 0, y1: 0, x2: 10, y2: 10 });

      act(() => h.useRectProps.current!.onChangeEnd({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      expect(h.setToolArgs).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('drops the commit and the focus when no rect can be calculated', () => {
      renderArea();
      const textarea = document.createElement('textarea');
      const focus = vi.spyOn(textarea, 'focus');
      h.textarea.current = textarea;
      vi.mocked(calculateNewRect).mockReturnValue(null);

      act(() => h.useRectProps.current!.onChangeEnd({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      expect(h.setToolArgs).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    });

    it('commits a drag as a paragraph box, with the dragged rect handed over unchanged', () => {
      const dragged = { x1: 10, y1: 20, x2: 90, y2: 60 };
      toolArgs = makeTextArgs({ text: 'hi', rect: dragged });
      vi.mocked(calculateNewRect).mockReturnValue(dragged);

      const rendered = renderArea();
      gesture(rendered, { x: 100, y: 100 }, { x: 260, y: 200 }, dragged);

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', rect: dragged }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paragraph', rect: dragged }));
    });

    it('commits a click as a point box, collapsing the rect onto the press origin', () => {
      const clicked = { x1: 12, y1: 34, x2: 12, y2: 34 };
      toolArgs = makeTextArgs({ text: 'hi', rect: clicked });
      vi.mocked(calculateNewRect).mockReturnValue(clicked);

      const rendered = renderArea();
      gesture(rendered, { x: 12, y: 34 }, { x: 14, y: 35 }, clicked);

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'point', rect: { x1: 12, y1: 34, x2: 12, y2: 34 } }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'point' }));
    });

    it('treats a 4px-wide, 1px-tall press as a drag: crossing the threshold on ONE axis is enough', () => {
      const dragged = { x1: 5, y1: 5, x2: 9, y2: 6 };
      toolArgs = makeTextArgs({ text: 'hi', rect: dragged });
      vi.mocked(calculateNewRect).mockReturnValue(dragged);

      const rendered = renderArea();
      gesture(rendered, { x: 20, y: 20 }, { x: 24, y: 21 }, dragged);

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', rect: dragged }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paragraph' }));
    });

    it('treats a 200px-wide, 3px-tall press as a drag too: a height inside the threshold decides nothing alone', () => {
      const dragged = { x1: 0, y1: 10, x2: 200, y2: 13 };
      toolArgs = makeTextArgs({ text: 'hi', rect: dragged });
      vi.mocked(calculateNewRect).mockReturnValue(dragged);

      const rendered = renderArea();
      gesture(rendered, { x: 0, y: 10 }, { x: 200, y: 13 }, dragged);

      // The click test is the AND of two per-axis verdicts, so the negation is their OR: 3px of
      // travel on y is not a click, and the 200px on x carries the drag on its own. The rect is
      // handed over as dragged, which is what a collapsed point box would not be.
      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', rect: dragged }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paragraph' }));
    });

    it('treats a press exactly at the threshold, 3px by 3px, as a click', () => {
      const rect = { x1: 7, y1: 8, x2: 10, y2: 11 };
      toolArgs = makeTextArgs({ text: 'hi', rect });
      vi.mocked(calculateNewRect).mockReturnValue({ x1: 7, y1: 8, x2: 7, y2: 8 });

      const rendered = renderArea();
      gesture(rendered, { x: 30, y: 40 }, { x: 33, y: 43 }, rect);

      // `<=` and not `<`: the threshold is the largest press still counted as a click on BOTH
      // axes, so a 4px travel is the first that is not.
      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'point', rect: { x1: 7, y1: 8, x2: 7, y2: 8 } }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'point' }));
    });

    // THE REGRESSION. The threshold was read off the rect `useRect` handed back, and for a press
    // inside an existing draft that rect is the DRAFT — so a box holding any text was always wider
    // and taller than 3px and every such press was classified as a drag. Placing a point draft,
    // typing into it, and clicking inside it "to say where the box is" silently turned it into a
    // paragraph box, and `calculateNewRect` re-wrapped the text at the new width inside a frame
    // that never moved. No threshold value fixes this: the quantity being measured was the box,
    // not the gesture.
    it('does NOT reclassify a draft when the press lands inside it', () => {
      const existing = { x1: 10, y1: 10, x2: 120, y2: 40 };
      toolArgs = makeTextArgs({ text: 'hello world', rect: existing, kind: 'point' } as Partial<TextArgs>);
      // `useRect` reports `'inside'` for a press strictly within an existing rect — this is the
      // fact the component reads to know the press was not a placement.
      h.currentEdgeRef.current = 'inside';
      vi.mocked(calculateNewRect).mockReturnValue(existing);

      const rendered = renderArea();
      // A press that barely moves: the pointer travelled 1px, so by travel alone this is a click.
      gesture(rendered, { x: 60, y: 25 }, { x: 61, y: 25 }, existing);

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'point', rect: existing }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'point' }));
    });

    it('does not reclassify a PARAGRAPH draft when a handle is dragged, and hands the rect through', () => {
      const existing = { x1: 10, y1: 10, x2: 120, y2: 40 };
      const resized = { x1: 10, y1: 10, x2: 200, y2: 40 };
      toolArgs = makeTextArgs({ text: 'hello', rect: existing, kind: 'paragraph' } as Partial<TextArgs>);
      h.currentEdgeRef.current = 'right';
      vi.mocked(calculateNewRect).mockReturnValue(resized);

      const rendered = renderArea();
      // The pointer travels 80px — far past the threshold — but this is a RESIZE of a box that
      // already exists, so it must not also turn point type into paragraph type.
      gesture(rendered, { x: 120, y: 25 }, { x: 200, y: 25 }, resized);

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', rect: resized }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paragraph' }));
    });
  });

  describe('text preview', () => {
    it('repaints once the text becomes non-empty', () => {
      const { rerender } = renderArea();
      h.redraw.mockClear();

      toolArgs = makeTextArgs({ text: 'hi' });
      act(() => {
        rerender(<TextToolArea overlayCtxRef={{ current: null }} />);
      });

      expect(h.redraw).toHaveBeenCalledTimes(1);
    });

    it('does not repaint while the text is still empty', () => {
      renderArea();

      expect(h.redraw).not.toHaveBeenCalled();
    });

    it('renders the text onto the overlay context in the tool colour', () => {
      const ctx = document.createElement('canvas').getContext('2d');
      h.color = '#00ff00';
      toolArgs = makeTextArgs({ text: 'hello', rect: { x1: 5, y1: 6, x2: 50, y2: 30 }, color: '#0000ff' });

      renderArea({ current: ctx });
      act(() => h.useRectProps.current!.onRepaint!({ x1: 5, y1: 6, x2: 50, y2: 30 }));

      // The preview the user reads on the canvas is the colour the bar will commit, not the
      // foreground: the two used to disagree the moment the bar's own choice was made.
      // The third argument is the overflow indicator, which is the one thing this overlay asks
      // for that the committed layer's canvas must never have baked into it.
      expect(renderText).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ text: 'hello', color: '#0000ff', rect: { x1: 5, y1: 6, x2: 50, y2: 30 } }),
        { overflowIndicator: true }
      );
    });

    it('skips the text render when there is nothing to draw', () => {
      const ctx = document.createElement('canvas').getContext('2d');
      toolArgs = makeTextArgs({ text: undefined });

      renderArea({ current: ctx });
      act(() => h.useRectProps.current!.onRepaint!({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      expect(renderText).not.toHaveBeenCalled();
    });

    it('skips the text render when the overlay context is unavailable', () => {
      toolArgs = makeTextArgs({ text: 'hello' });

      renderArea({ current: null });
      act(() => h.useRectProps.current!.onRepaint!({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      expect(renderText).not.toHaveBeenCalled();
    });
  });
});
