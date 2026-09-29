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
      redraw: h.redraw,
      onPointerDown: h.pointerDown,
      onPointerMove: h.pointerMove,
      onPointerUp: h.pointerUp,
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

describe('TextToolArea', () => {
  beforeEach(() => {
    h.setToolArgs.mockReset();
    h.dispatch.mockReset();
    h.redraw.mockReset();
    h.pointerDown.mockReset();
    h.pointerMove.mockReset();
    h.pointerUp.mockReset();
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

      renderArea();
      act(() => h.useRectProps.current!.onChangeEnd({ x1: 0, y1: 0, x2: 40, y2: 20 }));

      expect(calculateNewRect).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'hi', rect: { x1: 0, y1: 0, x2: 40, y2: 20 } }),
        h.toolOverlayRef,
        { width: 100, height: 100 }
      );
      // The type colour belongs to the tool and is edited on the options bar. The store's
      // foreground used to be written over it here, which is what made the swatch unwritable: a
      // drag republished the foreground, not the colour the user had chosen.
      expect(h.setToolArgs).toHaveBeenCalledWith({ ...toolArgs, color: '#0000ff', rect: newRect });
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
      expect(renderText).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ text: 'hello', color: '#0000ff', rect: { x1: 5, y1: 6, x2: 50, y2: 30 } })
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
