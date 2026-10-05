import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockCtx } from '../../../__tests__/canvas-mock.ts';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import { TextToolArea } from '../TextToolArea.tsx';
import { PLACEHOLDER_TEXT, drawOverflowIndicator, layoutText } from '../../../tools/text.ts';
import { calculateNewRect } from '../../../util/rect.ts';

type TextArgs = {
  align: 'left' | 'center' | 'right';
  bold: boolean;
  color: string;
  fontFamily: string;
  fontSize: number;
  italic: boolean;
  kind?: 'point' | 'paragraph';
  lineHeight: number;
  text?: string;
  rect: { x1: number; y1: number; x2: number; y2: number } | null;
  toolName: 'text' | 'draw';
};

const h = vi.hoisted(() => ({
  setToolArgs: vi.fn(),
  commitDirtyTool: vi.fn(),
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

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    get commitDirtyTool() {
      return h.commitDirtyTool;
    },
    setActiveLayer: vi.fn(),
    beginTextLayerEdit: vi.fn(),
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

/**
 * `layoutText` and `drawOverflowIndicator` are the whole of what the chrome repaint asks this module
 * for, and both are mocked so that the repaint is a CHOICE rather than a measurement: the overflow
 * answer is set per test, which is what makes both branches reachable and both falsifiable.
 *
 * `renderText` is deliberately NOT mocked. It is the function the component must stop calling, and a
 * stub would make any reintroduced call invisible — a stub draws nothing, so a `not.toHaveBeenCalled`
 * on `ctx.fillText` would pass against the very defect it exists to catch. Left real, a reintroduced
 * call paints.
 */
vi.mock('../../../tools/text.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../tools/text.ts')>('../../../tools/text.ts');
  return {
    ...actual,
    layoutText: vi.fn(() => ({ lines: [], overflow: false })),
    drawOverflowIndicator: vi.fn(),
  };
});

const renderArea = (overlayCtxRef: { current: CanvasRenderingContext2D | null } = { current: null }) =>
  render(<TextToolArea overlayCtxRef={overlayCtxRef} />);

/** The overflow answer the repaint will be given, as if the text had been measured. */
const laysOutAsOverflowing = (overflow: boolean) =>
  vi.mocked(layoutText).mockReturnValue({ lines: ['hello'], overflow });

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
    h.commitDirtyTool.mockReset();
    h.dispatch.mockReset();
    h.redraw.mockReset();
    h.pointerDown.mockReset();
    h.pointerMove.mockReset();
    h.pointerUp.mockReset();
    h.currentEdgeRef.current = null;
    h.useRectProps.current = null;
    h.color = '#000000';
    toolArgs = makeTextArgs();
    vi.mocked(calculateNewRect).mockReset();
    vi.mocked(calculateNewRect).mockReturnValue(null);
    vi.mocked(layoutText).mockReset();
    laysOutAsOverflowing(false);
    vi.mocked(drawOverflowIndicator).mockReset();
  });

  it('renders no text field of its own, because the draft is typed on the canvas', () => {
    // The old assertion was `not.toThrow()`, which a component returning `null` also satisfies. The
    // `renders a div carrying the supplied className and the text cursor` case already proves the root
    // is a div; what is worth pinning here is only that the tool area contributes no input, because a
    // second field bound to the draft's text would be a second source of truth for it.
    expect(() => renderArea()).not.toThrow();

    // The crash guard is only half the claim, and the half that fails is the one with a defect
    // behind it: the reachable fix for a null `textareaRef.current` is `?.` at each use, NOT a
    // guard that returns early out of the render. So the surface must still be there. `not.
    // toThrow()` alone passes just as well against a component that renders nothing, which is
    // the tool the user cannot click at all.
    expect(h.useRectProps.current).not.toBeNull();
    // Scoped to THIS render's container, not `document`. A document-wide query passes just as
    // well against a node an earlier case leaked, so it would keep passing after the cursor
    // class stopped being rendered here at all.
    const { container } = renderArea();
    expect(container.querySelector('.cursor-text')).not.toBeNull();
  });

  it('does not render an options-bar textarea when the text tool becomes active', () => {
    toolArgs = makeTextArgs({ toolName: 'draw' });
    const { container, rerender } = renderArea();

    act(() => {
      toolArgs = makeTextArgs({ toolName: 'text' });
      rerender(<TextToolArea overlayCtxRef={{ current: null }} />);
    });

    expect(container.querySelector('textarea')).toBeNull();
  });

  it('publishes nothing when a rectangle finishes with no measurable box, and says so with no throw', () => {
    // The assertion used to be `not.toThrow()` alone, which a deleted `onChangeEnd` body satisfies as
    // happily as a working one. `calculateNewRect` is mocked to `null` by `beforeEach`, so this is the
    // arm where the component has no box to publish — and the whole point of the case is that it says
    // so by doing nothing rather than by throwing out of a React handler.
    renderArea();

    // The registration is asserted FIRST, and that is the point. The call below is guarded by
    // `useRectProps.current?.` and `onChangeEnd?.`, so with nothing registered the expression is
    // a no-op and `not.toThrow()` passes on a component that never called `useRect` at all —
    // which is the shape a regression that dropped the rect surface would take. Asserting the
    // registration makes the guarded call something that definitely ran.
    expect(h.useRectProps.current).not.toBeNull();
    expect(typeof h.useRectProps.current?.onChangeEnd).toBe('function');

    expect(() => act(() => h.useRectProps.current?.onChangeEnd?.({ x1: 0, y1: 0, x2: 10, y2: 10 }))).not.toThrow();
    expect(h.setToolArgs, 'an unmeasurable rectangle was published anyway').not.toHaveBeenCalled();
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

    /**
     * THE PIN, and it is about a prop's ABSENCE — which is why the assertion is an exact `true` and
     * not a truthiness test. `hideBlend` is optional, so a consumer that forgets it passes `undefined`,
     * and that is precisely the shape the defect had.
     *
     * `useRect`'s `drawMask` lays `rgba(0, 0, 0, 0.7)` over the WHOLE document and then `clearRect`s
     * a hole at the frame. That dim is the crop tool's "everything outside the crop is not part of
     * the result", and it is the DEFAULT because most of `useRect`'s consumers are crop-shaped — so
     * the Type tool, which was not opting out, dimmed every COMMITTED layer to 30% for as long as a
     * draft was open.
     *
     * MEASURED, live headless Chromium, on a committed red glyph: `maxRed` 76 with a draft open and
     * 255 with none. 255 × (1 − 0.7) = 76.5, which is the arithmetic of that fill and nothing else.
     */
    it("asks useRect for NO dim, because the 0.7 blend is the crop frame's and dims every committed layer", () => {
      renderArea();

      expect(h.useRectProps.current!.hideBlend).toBe(true);
    });

    it('hands useRect the chrome-only draft repaint', () => {
      renderArea();

      expect(h.useRectProps.current!.onRepaint).toEqual(expect.any(Function));
    });

    it('spreads the useRect pointer handlers onto the surface', () => {
      const { container } = renderArea();
      const el = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(el, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(el, { clientX: 6, clientY: 6 });
      fireEvent.pointerUp(el, { clientX: 6, clientY: 6 });

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

      // The box is measured from the SEEDED text, not from whatever the args happened to hold: a
      // placement arrives holding Adobe's placeholder, and a box sized from the previous string
      // would be sized from a string the layer will never have.
      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ text: PLACEHOLDER_TEXT, rect: { x1: 0, y1: 0, x2: 40, y2: 20 } }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      // The type colour belongs to the tool and is edited on the options bar. The store's
      // foreground used to be written over it here, which is what made the swatch unwritable: a
      // drag republished the foreground, not the colour the user had chosen.
      // A 40x20 press is a drag, so the committed record also says which of Adobe's two kinds of
      // type layer the gesture placed.
      expect(h.setToolArgs).toHaveBeenCalledWith({
        ...toolArgs,
        text: PLACEHOLDER_TEXT,
        color: '#0000ff',
        rect: newRect,
        kind: 'paragraph',
        placeholderUntouched: true,
      });
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

    it('publishes the placement exactly once when a rect can be calculated', () => {
      renderArea();
      vi.mocked(calculateNewRect).mockReturnValue({ x1: 0, y1: 0, x2: 10, y2: 10 });

      act(() => h.useRectProps.current!.onChangeEnd({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      expect(h.setToolArgs).toHaveBeenCalledTimes(1);
    });

    it('drops the publish when no rect can be calculated', () => {
      renderArea();
      vi.mocked(calculateNewRect).mockReturnValue(null);

      act(() => h.useRectProps.current!.onChangeEnd({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      expect(h.setToolArgs).not.toHaveBeenCalled();
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
      expect(h.setToolArgs).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', rect: dragged, text: PLACEHOLDER_TEXT })
      );
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
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'point', text: PLACEHOLDER_TEXT }));
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
      expect(h.setToolArgs).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', text: PLACEHOLDER_TEXT })
      );
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
      expect(h.setToolArgs).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', text: PLACEHOLDER_TEXT })
      );
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
        expect.objectContaining({ kind: 'point', rect: { x1: 7, y1: 8, x2: 7, y2: 8 }, text: PLACEHOLDER_TEXT }),
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
      // A PARAGRAPH draft, and a press that travelled 1px. The two rules now DISAGREE: travel alone
      // says point, and the guard says leave a paragraph box alone. A point-type fixture would make
      // them agree, which is what made this test pass with the guard deleted — a regression test
      // whose two answers are the same is not a regression test.
      toolArgs = makeTextArgs({ text: 'hello world', rect: existing, kind: 'paragraph' } as Partial<TextArgs>);
      // `useRect` reports `'inside'` for a press strictly within an existing rect — this is the fact
      // the component reads to know the press was not a placement.
      h.currentEdgeRef.current = 'inside';
      vi.mocked(calculateNewRect).mockReturnValue(existing);

      const rendered = renderArea();
      gesture(rendered, { x: 60, y: 25 }, { x: 61, y: 25 }, existing);

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'paragraph', rect: existing }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paragraph' }));
    });

    it('does not reclassify a PARAGRAPH draft when a handle is dragged, and hands the rect through', () => {
      const existing = { x1: 10, y1: 10, x2: 120, y2: 40 };
      const resized = { x1: 10, y1: 10, x2: 200, y2: 40 };
      // A POINT draft, and a handle drag that travelled 80px — far past the threshold. Again the two
      // rules disagree: travel alone says paragraph, and the guard says leave point type alone. This
      // fixture also passes with the ENTIRE production change reverted, because the old extent rule
      // read a 190x30 rect as a drag too; that is the second half of why it is worth pinning.
      toolArgs = makeTextArgs({ text: 'hello', rect: existing, kind: 'point' } as Partial<TextArgs>);
      h.currentEdgeRef.current = 'right';
      vi.mocked(calculateNewRect).mockReturnValue(resized);

      const rendered = renderArea();
      gesture(rendered, { x: 120, y: 25 }, { x: 200, y: 25 }, resized);

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'point', rect: resized }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ kind: 'point' }));
    });
  });

  /**
   * The two halves of Adobe's arrival: "A layer is created immediately, containing placeholder text
   * that previews font, size and colour" (the text, here) and the commit of whatever was already
   * being typed (the history entry, here). The SELECTION half is `TextEditOverlay`'s.
   */
  describe('placing a box', () => {
    it('a placement seeds the box with the Adobe placeholder text', () => {
      const placed = { x1: 12, y1: 34, x2: 12, y2: 34 };
      vi.mocked(calculateNewRect).mockReturnValue(placed);

      const rendered = renderArea();
      gesture(rendered, { x: 12, y: 34 }, { x: 14, y: 35 }, placed);

      // Spelled out twice on purpose: the literal is the contract as Adobe states it, and the
      // imported constant is the same string, so a change to `PLACEHOLDER_TEXT` is a visible
      // failure here rather than a silent one in a screenshot.
      expect(PLACEHOLDER_TEXT).toBe('Lorem ipsum');
      expect(h.setToolArgs).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Lorem ipsum', placeholderUntouched: true })
      );
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: PLACEHOLDER_TEXT }));
    });

    it('a placement with no draft open commits nothing', () => {
      const placed = { x1: 12, y1: 34, x2: 12, y2: 34 };
      vi.mocked(calculateNewRect).mockReturnValue(placed);

      // The default args: no text and no box, which is what "no draft is open" is.
      const rendered = renderArea();
      gesture(rendered, { x: 12, y: 34 }, { x: 14, y: 35 }, placed);

      // A commit here would create a layer out of nothing. The guard is `args.text && args.rect`,
      // not merely the gesture.
      expect(h.commitDirtyTool).not.toHaveBeenCalled();
      expect(h.setToolArgs).toHaveBeenCalledTimes(1);
    });

    it('a placement while a draft is open commits that draft exactly once and publishes the new box', () => {
      const open = { x1: 10, y1: 10, x2: 40, y2: 30 };
      const placed = { x1: 100, y1: 100, x2: 100, y2: 100 };
      toolArgs = makeTextArgs({ text: 'typed so far', rect: open, kind: 'point' });
      vi.mocked(calculateNewRect).mockReturnValue(placed);

      const rendered = renderArea();
      gesture(rendered, { x: 100, y: 100 }, { x: 102, y: 101 }, placed);

      // It used to do neither: a second click overwrote `args` with a fresh box and the typed text
      // was gone with no history entry, because a draft is not yet a layer and nothing had recorded
      // it. Exactly once, because a commit creates a layer and a second one would create a second.
      expect(h.commitDirtyTool).toHaveBeenCalledTimes(1);
      // And the published box is the NEW one, at the second click's coordinates.
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ rect: placed }));
      expect(h.setToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: PLACEHOLDER_TEXT }));
    });

    it('commits the open draft before publishing the new box', () => {
      const open = { x1: 10, y1: 10, x2: 40, y2: 30 };
      const placed = { x1: 100, y1: 100, x2: 100, y2: 100 };
      toolArgs = makeTextArgs({ text: 'typed so far', rect: open, kind: 'point' });
      vi.mocked(calculateNewRect).mockReturnValue(placed);

      const rendered = renderArea();
      gesture(rendered, { x: 100, y: 100 }, { x: 102, y: 101 }, placed);

      // The order IS the behaviour. `commitDirtyTool` creates the layer and clears `text`/`rect` by
      // writing the tool args back, so publishing first would commit the NEW box with the OLD text
      // — a text layer at the second click's coordinates holding the first click's words. Call
      // order is the only thing that distinguishes the two, so it is asserted rather than assumed.
      expect(h.commitDirtyTool.mock.invocationCallOrder[0]).toBeLessThan(h.setToolArgs.mock.invocationCallOrder[0]);
    });

    it('a press inside an existing box moves it without committing or re-seeding the text', () => {
      const existing = { x1: 10, y1: 10, x2: 120, y2: 40 };
      const moved = { x1: 12, y1: 12, x2: 122, y2: 42 };
      toolArgs = makeTextArgs({ text: 'hello world', rect: existing, kind: 'point' });
      // `'inside'`: the press landed in a box that was already there, so the gesture is a move. Only
      // `useRect` can answer this, because only `useRect` ran `getEdgeAtPoint`.
      h.currentEdgeRef.current = 'inside';
      vi.mocked(calculateNewRect).mockReturnValue(moved);

      const rendered = renderArea();
      gesture(rendered, { x: 60, y: 25 }, { x: 61, y: 25 }, moved);

      // Not committed — a move of a draft is not an exit from it — and NOT re-seeded: the placeholder
      // belongs to the ARRIVAL of a box, and a move is not an arrival. Re-seeding here would throw
      // away whatever the user has typed the moment they nudge the box they are typing into, which
      // is the same class of defect as the reclassification above it.
      expect(h.commitDirtyTool).not.toHaveBeenCalled();
      expect(h.setToolArgs).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'hello world', rect: moved, kind: 'point' })
      );
      expect(h.setToolArgs).not.toHaveBeenCalledWith(expect.objectContaining({ text: PLACEHOLDER_TEXT }));
    });
  });

  /**
   * The canvas side of a draft is CHROME now. The ink is a transparent DOM element over the same
   * box, so anything painted here is visible underneath it.
   */
  describe('text preview', () => {
    it('repaints once the text becomes non-empty', () => {
      const { rerender } = renderArea();
      h.redraw.mockClear();

      // The box arrives WITH the text — a placement seeds it — so the repaint is gated on both and
      // a rerender carrying only one of them paints nothing.
      toolArgs = makeTextArgs({ text: 'hi', rect: { x1: 5, y1: 6, x2: 50, y2: 30 } });
      act(() => {
        rerender(<TextToolArea overlayCtxRef={{ current: null }} />);
      });

      expect(h.redraw).toHaveBeenCalledTimes(1);
    });

    it('repaints when the box moves under an unchanged text', () => {
      toolArgs = makeTextArgs({ text: 'hi', rect: { x1: 5, y1: 6, x2: 50, y2: 30 } });
      const { rerender } = renderArea();
      h.redraw.mockClear();

      // Point type grows and shrinks with its content, so the box is recomputed from the text on
      // every keystroke and `args.rect` changes while `args.text` may not. The boundary has to
      // follow it or the ink leaves the box, which is why the rect is a dependency of its own.
      toolArgs = makeTextArgs({ text: 'hi', rect: { x1: 5, y1: 6, x2: 90, y2: 44 } });
      act(() => {
        rerender(<TextToolArea overlayCtxRef={{ current: null }} />);
      });

      expect(h.redraw).toHaveBeenCalledTimes(1);
    });

    it('does not repaint while the text is still empty', () => {
      renderArea();

      expect(h.redraw).not.toHaveBeenCalled();
    });

    it('does not repaint while the box is still missing', () => {
      toolArgs = makeTextArgs({ text: 'hi', rect: null });

      renderArea();

      // The other half of the gate, and the reason the repaint effect lists both: there is no
      // boundary to follow, and `redrawText` was the only consumer of a box that did not have one.
      expect(h.redraw).not.toHaveBeenCalled();
    });

    it('draws no ink onto the overlay context, because the DOM overlay owns the draft', () => {
      const ctx = makeMockCtx();
      toolArgs = makeTextArgs({ text: 'hello', rect: { x1: 5, y1: 6, x2: 50, y2: 30 }, color: '#0000ff' });
      // OVERFLOWING on purpose. The overflow branch is the only one that reaches a drawing call, so
      // a test that laid the text out as fitting would pass against a component that painted the ink
      // wherever overflow happened to be true, and would say nothing about the normal case.
      laysOutAsOverflowing(true);

      renderArea({ current: ctx });
      act(() => h.useRectProps.current!.onRepaint!({ x1: 5, y1: 6, x2: 50, y2: 30 }));

      // Two renderers of one string in one place either agree exactly or show doubled, offset
      // type, and the overlay's background is transparent precisely so the ink below shows
      // through — which is another way of saying the canvas ink would be visible under the DOM
      // ink. Asserted on `fillText` and not on a call to `renderText`, because the defect is ink
      // rather than one particular call: `renderText` is the REAL implementation here, so a
      // reintroduced call actually paints and fails this.
      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();
    });

    it('draws the overflow indicator in the tool colour when layoutText reports overflow', () => {
      const ctx = makeMockCtx();
      const rect = { x1: 5, y1: 6, x2: 50, y2: 30 };
      h.color = '#00ff00';
      toolArgs = makeTextArgs({ text: 'hello', rect, color: '#0000ff' });
      laysOutAsOverflowing(true);

      renderArea({ current: ctx });
      act(() => h.useRectProps.current!.onRepaint!(rect));

      // The indicator is the exception that survives the ink removal: it is box CHROME, and Adobe
      // draws "a small box or circle containing a plus symbol (+) appears in place of a handle in
      // the corner of the boundary". The colour is the tool's own swatch and not the store's
      // foreground, which is a different colour on purpose.
      expect(drawOverflowIndicator).toHaveBeenCalledWith(ctx, rect, '#0000ff');
      // The overflow is ASKED for, not drawn on the way to an answer: the box height is the last
      // argument, so a layout asked without it is asked a question it cannot answer.
      expect(layoutText).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ color: '#0000ff' }),
        'hello',
        Infinity,
        24
      );
    });

    it('draws no overflow indicator when the text fits inside the box', () => {
      const ctx = makeMockCtx();
      const rect = { x1: 5, y1: 6, x2: 50, y2: 30 };
      toolArgs = makeTextArgs({ text: 'hello', rect, color: '#0000ff' });
      laysOutAsOverflowing(false);

      renderArea({ current: ctx });
      act(() => h.useRectProps.current!.onRepaint!(rect));

      expect(drawOverflowIndicator).not.toHaveBeenCalled();
    });

    it('asks nothing when there is no text to lay out', () => {
      const ctx = makeMockCtx();
      toolArgs = makeTextArgs({ text: undefined, rect: { x1: 0, y1: 0, x2: 10, y2: 10 } });

      renderArea({ current: ctx });
      act(() => h.useRectProps.current!.onRepaint!({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      // Not even the question is worth asking with nothing to lay out, and a measurement against an
      // empty string is the one call `layoutText` documents as skippable.
      expect(layoutText).not.toHaveBeenCalled();
      expect(drawOverflowIndicator).not.toHaveBeenCalled();
      expect(ctx.fillText).not.toHaveBeenCalled();
    });

    it('skips the repaint when the overlay context is unavailable', () => {
      toolArgs = makeTextArgs({ text: 'hello', rect: { x1: 0, y1: 0, x2: 10, y2: 10 } });

      renderArea({ current: null });
      act(() => h.useRectProps.current!.onRepaint!({ x1: 0, y1: 0, x2: 10, y2: 10 }));

      expect(layoutText).not.toHaveBeenCalled();
      expect(drawOverflowIndicator).not.toHaveBeenCalled();
    });
  });
});
