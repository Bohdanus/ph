import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextEditOverlay } from '../TextEditOverlay.tsx';
import { insertPlainTextAtCaret, selectAllIn, textOffsetAt } from '../../../util/contenteditable-text.ts';
import { calculateNewRect } from '../../../util/rect.ts';

type Rect = { x1: number; y1: number; x2: number; y2: number };

type TextArgs = {
  align: 'left' | 'center' | 'right';
  bold: boolean;
  color: string;
  fontFamily: string;
  fontSize: number;
  italic: boolean;
  lineHeight: number;
  text?: string;
  rect: Rect | null;
  toolName: 'text';
  angle?: number;
  editingLayerId?: string;
  allCaps?: boolean;
  smallCaps?: boolean;
};

/**
 * A document-px box, and the ARIAL-free constants every geometry assertion reads.
 *
 * `PLACEHOLDER` is what a freshly placed draft arrives holding, so it is also what the seed
 * assertion and the select-all assertion expect to find in the element.
 */
const PLACEHOLDER = 'Lorem ipsum';
const RECT: Rect = { x1: 10, y1: 20, x2: 60, y2: 70 };
const SENTINEL_RECT: Rect = { x1: 1, y1: 2, x2: 3, y2: 4 };
const DOCUMENT_SIZE = { width: 100, height: 100 };

const h = vi.hoisted(() => ({
  setToolArgs: vi.fn(),
  consumeTextEditFocusRequest: vi.fn(),
  textEditFocusRequest: null as null | {
    id: number;
    target:
      { kind: 'select-all'; layerId: string } | { kind: 'point'; layerId: string; clientX: number; clientY: number };
  },
  dispatch: vi.fn(),
  commitDirtyTool: vi.fn(),
  toolName: 'text' as string,
  /**
   * ONE object, read by reference.
   *
   * `TextEditOverlay`'s `measure` is a `useCallback` over `totalSize`, and its `useLayoutEffect`
   * runs `measure` — so a mock that minted a fresh `{ width, height }` literal on every
   * `useStore()` call would hand back a new `measure` on every render, re-run the layout effect,
   * `setFit` a new object, and loop. The real store publishes `totalSize` out of a reducer, so it
   * is referentially stable; the mock has to be too, or it tests a store shape the app does not
   * have.
   */
  totalSize: { width: 100, height: 100 },
  containerRef: { current: null as HTMLDivElement | null },
  toolOverlayRef: { current: null as HTMLCanvasElement | null },
  layers: {} as Record<string, unknown>,
}));

let toolArgs: TextArgs;

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      get containerRef() {
        return h.containerRef;
      },
      get toolOverlayRef() {
        return h.toolOverlayRef;
      },
      get totalSize() {
        return h.totalSize;
      },
      get toolName() {
        return h.toolName;
      },
      get layers() {
        return h.layers;
      },
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
    get textEditFocusRequest() {
      return h.textEditFocusRequest;
    },
    get consumeTextEditFocusRequest() {
      return h.consumeTextEditFocusRequest;
    },
  }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    get commitDirtyTool() {
      return h.commitDirtyTool;
    },
  }),
}));

// The real module, with the one function the overlay routes every publish through replaced by a
// spy. `calculateNewRect` measures the draft on a canvas context that does not exist in jsdom, and
// more to the point: a test that let the real one run would be asserting the measurement, not the
// wiring. Mocking it is what makes the `rect` half of a publish falsifiable — the sentinel below is
// a value no real measurement would ever produce.
vi.mock('../../../util/rect.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../util/rect.ts')>('../../../util/rect.ts');
  return {
    ...actual,
    calculateNewRect: vi.fn(() => null),
  };
});

/**
 * The workspace container, with the size `containFit` divides by.
 *
 * jsdom reports all zeros for `getBoundingClientRect`, and `containFit` divides by its input, so an
 * unstubbed container collapses `scale` to 0 and every geometry assertion below would read `0px`
 * for the same reason — a geometry suite that cannot tell a correct mapping from a broken one. The
 * stub is therefore per-test and explicit about its size.
 */
type ClientViewport = {
  clientLeft?: number;
  clientTop?: number;
  clientWidth: number;
  clientHeight: number;
  offsetWidth?: number;
  offsetHeight?: number;
};

const containerOf = (
  width: number,
  height: number,
  client: ClientViewport = { clientWidth: width, clientHeight: height, offsetWidth: width, offsetHeight: height }
) => {
  const el = document.createElement('div');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperties(el, {
    clientLeft: { configurable: true, value: client.clientLeft ?? 0 },
    clientTop: { configurable: true, value: client.clientTop ?? 0 },
    clientWidth: { configurable: true, value: client.clientWidth },
    clientHeight: { configurable: true, value: client.clientHeight },
    offsetWidth: { configurable: true, value: client.offsetWidth ?? width },
    offsetHeight: { configurable: true, value: client.offsetHeight ?? height },
  });
  h.containerRef.current = el;
  return el;
};

class ControlledTextResizeObserver implements ResizeObserver {
  static instances: ControlledTextResizeObserver[] = [];

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ControlledTextResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  emit(entry: ResizeObserverEntry) {
    this.callback([entry], this);
  }
}

const makeTextArgs = (overrides: Partial<TextArgs> = {}): TextArgs => ({
  align: 'left',
  bold: false,
  color: '#000000',
  fontFamily: 'Arial',
  fontSize: 16,
  italic: false,
  lineHeight: 1.2,
  rect: RECT,
  toolName: 'text',
  ...overrides,
});

const renderOverlay = () => render(<TextEditOverlay />);

const overlay = () => screen.getByTestId('text-edit-overlay') as HTMLDivElement;

/**
 * A keydown the browser marked as part of an IME composition.
 *
 * `isComposing` is a readonly `KeyboardEvent` attribute in the DOM, so a test cannot set it through
 * the init dict the way a browser's IME host sets it — it is defined on the instance instead, which
 * is also the only way to be explicit that the flag is under the test's control.
 */
const composingKeydown = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'isComposing', { value: true, configurable: true });
  return event;
};

/**
 * A `paste` carrying BOTH flavours.
 *
 * jsdom implements neither `ClipboardEvent` nor `DataTransfer`, so a real one cannot be constructed
 * here; `clipboardData` is defined on the event the way the browser would supply it, and `getData`
 * RECORDS the flavours asked for so "publishes `text/plain` only" is an assertion about which
 * flavour was requested rather than about what happened to come back.
 */
const richPaste = () => {
  const requested: string[] = [];
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: ['text/html', 'text/plain'],
      getData: (type: string) => {
        requested.push(type);
        return type === 'text/plain' ? 'pasted' : '<b>pasted</b>';
      },
    },
  });
  return { event, requested };
};

/** A host element that is really in the document, for the exported helpers to be tested against. */
const hostInDocument = (text: string) => {
  const el = document.createElement('div');
  el.dataset.helperHost = 'true';
  el.textContent = text;
  document.body.appendChild(el);
  return el;
};

/**
 * A COLLAPSED caret at `offset` inside the overlay's own text, which is what a browser leaves behind
 * after a keystroke.
 *
 * A `Range` on the text node rather than on the element: a container-level offset is a different
 * position to the one Chromium reports, and `startOffset` on the element would read `childNodes.length`
 * — the end of everything — for a caret the user has moved into the middle of a line.
 */
const placeCaret = (el: HTMLElement, offset: number) => {
  const node = el.firstChild;
  const selection = window.getSelection();
  if (!node || !selection) throw new Error(`placeCaret: ${el.id} holds no text node, or jsdom published no Selection`);
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

/**
 * What `window.getSelection()` says, read once per assertion cluster.
 *
 * `collapsed` and `string` are read together because either alone is satisfiable by a broken
 * selection: `string` is `''` for a collapsed caret AND for a selection anchored on an element with
 * nothing selected, and `collapsed` is `true` for the caret a `focus()` alone leaves behind.
 */
interface SelectionReading {
  rangeCount: number;
  string: string;
  collapsed: boolean;
  startOffset: number | null;
  endOffset: number | null;
}

const readSelection = (): SelectionReading => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { rangeCount: selection?.rangeCount ?? 0, string: '', collapsed: true, startOffset: null, endOffset: null };
  }
  const range = selection.getRangeAt(0);
  return {
    rangeCount: selection.rangeCount,
    string: selection.toString(),
    collapsed: selection.isCollapsed,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
  };
};

describe('TextEditOverlay', () => {
  beforeEach(() => {
    h.setToolArgs.mockReset();
    h.consumeTextEditFocusRequest.mockReset();
    h.textEditFocusRequest = null;
    h.dispatch.mockReset();
    h.commitDirtyTool.mockReset();
    h.toolName = 'text';
    h.toolOverlayRef.current = document.createElement('canvas');
    h.layers = {};
    containerOf(200, 200);
    toolArgs = makeTextArgs({ text: PLACEHOLDER });
    vi.mocked(calculateNewRect).mockReset();
    vi.mocked(calculateNewRect).mockReturnValue(SENTINEL_RECT);
  });

  afterEach(() => {
    // The helper hosts are appended to `document.body` directly, which RTL's `cleanup` does not own.
    for (const el of document.querySelectorAll('[data-helper-host]')) el.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    ControlledTextResizeObserver.instances = [];
  });

  describe('edit mode is derived, so nothing renders unless the args already say the user is typing', () => {
    it('renders nothing at all when the active tool is not the text tool, even with a text and a rect', () => {
      h.toolName = 'draw';

      const { container } = renderOverlay();

      expect(container.firstElementChild).toBeNull();
      expect(screen.queryByTestId('text-edit-overlay')).toBeNull();
    });

    it('keeps the editor mounted when the user deletes every character', () => {
      toolArgs = makeTextArgs({ text: '', rect: RECT });

      const { container } = renderOverlay();

      expect(container.firstElementChild).toBe(overlay());
      expect(overlay().textContent).toBe('');
    });

    it('renders nothing for text arguments with no rect, which is the second half of hasPendingText', () => {
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: null });

      const { container } = renderOverlay();

      expect(container.firstElementChild).toBeNull();
    });
  });

  describe('the element itself', () => {
    it("triple-click selects the visual line instead of Chromium's paragraph default", () => {
      toolArgs = makeTextArgs({ text: 'Alpha beta\nGamma delta' });
      const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: Range) {
          const offset = textOffsetAt(overlay(), this.startContainer, this.startOffset) ?? 0;
          const top = offset >= 11 ? 20 : 0;
          return {
            x: 0,
            y: top,
            left: 0,
            right: 5,
            top,
            bottom: top + 10,
            width: 5,
            height: 10,
            toJSON: () => ({}),
          } as DOMRect;
        },
      });

      try {
        renderOverlay();
        const cancelled = fireEvent.click(overlay(), { detail: 3, clientY: 25 });

        expect(cancelled).toBe(false);
        expect(readSelection()).toMatchObject({ string: 'Gamma delta', collapsed: false });
      } finally {
        if (original) Object.defineProperty(Range.prototype, 'getBoundingClientRect', original);
        else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
      }
    });

    it('quadruple-click selects the hard-break paragraph containing the click', () => {
      toolArgs = makeTextArgs({ text: 'Alpha beta\nGamma delta\nLast line' });
      const original = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint');
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: () => ({ offsetNode: overlay().firstChild!, offset: 13 }),
      });

      try {
        renderOverlay();
        const cancelled = fireEvent.click(overlay(), { detail: 4, clientX: 40, clientY: 25 });

        expect(cancelled).toBe(false);
        expect(readSelection()).toMatchObject({ string: 'Gamma delta', collapsed: false });
      } finally {
        if (original) Object.defineProperty(document, 'caretPositionFromPoint', original);
        else Reflect.deleteProperty(document, 'caretPositionFromPoint');
      }
    });

    it('renders a contenteditable textbox carrying the test id and aria-multiline for a draft that has both halves', () => {
      const { container } = renderOverlay();
      const el = overlay();

      expect(container.firstElementChild).toBe(el);
      expect(el.getAttribute('contenteditable')).toBe('true');
      expect(el.id).toBe('text-edit-overlay');
      expect(el.getAttribute('data-testid')).toBe('text-edit-overlay');
      // `aria-multiline` is what tells assistive technology that `Enter` inside this box is a line
      // break rather than an activation, which is exactly the Adobe split the key handler implements.
      expect(el.getAttribute('aria-multiline')).toBe('true');
    });

    it('keeps the Small Caps caret editable while the Canvas preview owns the visible glyphs', () => {
      toolArgs = makeTextArgs({ text: 'Wave', smallCaps: true });

      renderOverlay();
      const el = overlay();

      expect(el.style.color).toBe('transparent');
      expect(el.style.webkitTextFillColor).toBe('transparent');
      expect(el.style.caretColor).toBe('rgb(0, 0, 0)');
      expect(el.style.fontVariantCaps).toBe('small-caps');
      expect(el.style.textDecorationLine).toBe('none');
    });

    it('leaves the ink unclipped: overflow is visible, because a first line under the font ascent reaches above the box top', () => {
      // A line box whose leading is under the font's own ascent has NEGATIVE half-leading, so the
      // content box moves down and the first line's ink rises above the box's top edge. Clipping it
      // would show less type than Photoshop shows, and Adobe's paragraph box is allowed to overflow
      // anyway — that is what the overflow icon reports.
      renderOverlay();

      expect(overlay().style.overflow).toBe('visible');
    });
  });

  describe('geometry — the overlay sits over the type box in screen px', () => {
    it('lays the overlay over the type box at twice the document size for a 200x200 container around a 100x100 document', () => {
      // `containFit` on 200x200 against a 100x100 document is `scale` 2 with no letterbox gap, so
      // every number below is the rect's own document px doubled and nothing else.
      containerOf(200, 200);
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: RECT });

      renderOverlay();
      const el = overlay();

      expect(el.style.left).toBe('20px');
      expect(el.style.top).toBe('40px');
      expect(el.style.width).toBe('100px');
      expect(el.style.height).toBe('100px');
    });

    it('adds the letterbox gap to the top, so a vertically letterboxed document still lands over its own type box', () => {
      // 100x200 around a 100x100 document: `scale` is 1 (the width is the binding dimension),
      // `offsetX` 0 and `offsetY` (200 - 100) / 2 = 50. Dropping the `offsetY` term from `top` is
      // the mistake this case exists to catch, and it is invisible in the case above where the gap
      // is zero — the overlay would sit 50px too high and the user would click 50px above the glyphs
      // they can see.
      containerOf(100, 200);
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: RECT });

      renderOverlay();
      const el = overlay();

      expect(el.style.left).toBe('10px');
      expect(el.style.top).toBe('70px');
      expect(el.style.width).toBe('50px');
      expect(el.style.height).toBe('50px');
    });

    it('adds the letterbox gap to the LEFT too, on the only container that can prove it', () => {
      // 200x100 around a 100x100 document: the same `scale` 1, and now `offsetX` (200 - 100) / 2 =
      // 50 with `offsetY` 0. It has to be THIS pairing, and the reason is worth recording: the two
      // cases above are 200x200 and 100x200, and both of them leave `offsetX` at exactly zero, so a
      // `left` of `rect.x1 * scale` with the whole letterbox term deleted out of it leaves all
      // twenty-odd cases in this file GREEN. `offsetY` was pinned by the vertical container; the
      // horizontal one was not pinned by anything, which is a hole rather than a style preference —
      // `test:staged` and any unit-only gate runs this file and no e2e.
      containerOf(200, 100);
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: RECT });

      renderOverlay();
      const el = overlay();

      expect(el.style.left).toBe('60px');
      expect(el.style.top).toBe('20px');
      expect(el.style.width).toBe('50px');
      expect(el.style.height).toBe('50px');
      // The letterbox ISOLATED from the rect, which is the assertion that cannot be satisfied by a
      // `left` that happens to come out right for the wrong reason: with `scale` 1 the two
      // `left - rect.x1` is exactly the term under test, and a deleted `offsetX` reads 0.
      expect(parseFloat(el.style.left) - RECT.x1, 'the horizontal letterbox did not reach `left`').toBe(50);
    });

    it('measures the text overlay against the visible client viewport when a scrollbar reduces it', () => {
      containerOf(200, 200, {
        clientLeft: 2,
        clientTop: 2,
        clientWidth: 160,
        clientHeight: 180,
        offsetWidth: 200,
        offsetHeight: 200,
      });
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: RECT });

      renderOverlay();
      const el = overlay();

      // The client fit is 160x180 around the 100x100 document: scale 1.6 and a 10px vertical gap.
      expect(el.style.left).toBe('16px');
      expect(el.style.top).toBe('42px');
      expect(el.style.width).toBe('80px');
      expect(el.style.height).toBe('80px');
    });

    it('re-measures client fit after the scrollbar changes without a border-box resize', () => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControlledTextResizeObserver);
      const container = containerOf(200, 200);
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: RECT });

      renderOverlay();
      const el = overlay();
      expect(el.style.width).toBe('100px');

      Object.defineProperties(container, {
        clientWidth: { configurable: true, value: 160 },
        clientHeight: { configurable: true, value: 180 },
      });
      const observer = ControlledTextResizeObserver.instances[0];
      expect(observer).toBeDefined();
      if (!observer) return;

      act(() => {
        observer.emit({
          target: container,
          contentRect: { width: 160, height: 180 } as DOMRectReadOnly,
          contentBoxSize: [{ inlineSize: 160, blockSize: 180 }],
          borderBoxSize: [{ inlineSize: 200, blockSize: 200 }],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry);
        vi.advanceTimersByTime(32);
      });

      expect(overlay().style.left).toBe('16px');
      expect(overlay().style.top).toBe('42px');
      expect(overlay().style.width).toBe('80px');
      expect(overlay().style.height).toBe('80px');
    });
  });

  describe('affine transform — the overlay mirrors a transformed layer', () => {
    it('applies no CSS transform when the layer has no affine and no text angle', () => {
      containerOf(200, 200);
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: RECT });

      renderOverlay();
      const el = overlay();

      expect(el.style.transform).toBe('');
      expect(el.style.transformOrigin).toBe('center center');
    });

    it('applies a CSS matrix for a layer with a 2x scale affine op, scaling e/f by fit scale', () => {
      // Container 200x200 against a 100x100 document = `scale` 2, gap 0.
      containerOf(200, 200);
      const scale2xAffine = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
      const sourceRect = { x1: 0, y1: 0, x2: 100, y2: 50 };
      h.layers = {
        'text-layer': {
          id: 'text-layer',
          pos: { x: 10, y: 20, width: 100, height: 50 },
          source: {
            kind: 'tool' as const,
            args: { toolName: 'text' as const, rect: sourceRect },
            pos: { x: 10, y: 20, width: 100, height: 50 },
          },
          operations: [{ id: 'affine-1', kind: 'affine-transform' as const, transform: scale2xAffine, enabled: true }],
        },
      };
      toolArgs = makeTextArgs({
        text: PLACEHOLDER,
        rect: { x1: 10, y1: 20, x2: 110, y2: 70 },
        editingLayerId: 'text-layer',
      });

      renderOverlay();
      const el = overlay();

      // The affine's e/f (10, 20) × fit scale 2 = (20, 40). The linear part is dimensionless.
      expect(el.style.transform).toBe('matrix(2,0,0,2,20,40)');
      expect(el.style.transformOrigin).toBe('0 0');
    });

    it('applies only rotate(angle) when there is no affine op', () => {
      containerOf(200, 200);
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: RECT, angle: 45 });

      renderOverlay();
      const el = overlay();

      expect(el.style.transform).toBe('rotate(45deg)');
      expect(el.style.transformOrigin).toBe('center center');
    });

    it('composes angle rotation under the affine matrix into a single CSS matrix', () => {
      containerOf(200, 200);
      const scale2xAffine = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
      const sourceRect = { x1: 0, y1: 0, x2: 100, y2: 50 };
      h.layers = {
        'text-layer': {
          id: 'text-layer',
          pos: { x: 10, y: 20, width: 100, height: 50 },
          source: {
            kind: 'tool' as const,
            args: { toolName: 'text' as const, rect: sourceRect, angle: 90 },
            pos: { x: 10, y: 20, width: 100, height: 50 },
          },
          operations: [{ id: 'affine-1', kind: 'affine-transform' as const, transform: scale2xAffine, enabled: true }],
        },
      };
      toolArgs = makeTextArgs({
        text: PLACEHOLDER,
        rect: { x1: 10, y1: 20, x2: 110, y2: 70 },
        angle: 90,
        editingLayerId: 'text-layer',
      });

      renderOverlay();
      const el = overlay();

      // 90° rotation around rect centre (35, 45) gives {a:0,b:1,c:-1,d:0,...}.
      // Composed under scale-2: multiplyAffineTransforms(scale2x, rotate90)
      // = {a:0, b:2, c:-2, d:0, e:...}. e/f scaled by 2 for fit.
      expect(el.style.transformOrigin).toBe('0 0');
      const matrixMatch = el.style.transform.match(/matrix\(([^)]+)\)/);
      expect(matrixMatch).not.toBeNull();
      const vals = matrixMatch![1].split(',').map(Number);
      // Rotating the local rect around (50,25) then applying scale/translation produces e/f
      // (160,-30); the fit scale doubles those translations in CSS pixels.
      expect(vals[0]).toBeCloseTo(0, 5);
      expect(vals[1]).toBeCloseTo(2, 5);
      expect(vals[2]).toBeCloseTo(-2, 5);
      expect(vals[3]).toBeCloseTo(0, 5);
      expect(vals[4]).toBeCloseTo(320, 5);
      expect(vals[5]).toBeCloseTo(-60, 5);
    });

    it('pivots text angle around the current edit rect rather than the original source rect', () => {
      containerOf(200, 200);
      const scale2xAffine = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
      const sourceRect = { x1: 0, y1: 0, x2: 100, y2: 50 };
      h.layers = {
        'text-layer': {
          id: 'text-layer',
          pos: { x: 10, y: 20, width: 100, height: 50 },
          source: {
            kind: 'tool' as const,
            args: { toolName: 'text' as const, rect: sourceRect, angle: 90 },
            pos: { x: 10, y: 20, width: 100, height: 50 },
          },
          operations: [{ id: 'affine-1', kind: 'affine-transform' as const, transform: scale2xAffine, enabled: true }],
        },
      };
      // The current text grew after re-entry: the edit rect is 200x80 in canvas space, while the
      // retained source rect is still 100x50 in layer-local space.
      toolArgs = makeTextArgs({
        text: 'a much longer edit',
        rect: { x1: 10, y1: 20, x2: 210, y2: 100 },
        angle: 90,
        editingLayerId: 'text-layer',
      });

      renderOverlay();
      const match = overlay().style.transform.match(/matrix\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const values = match![1].split(',').map(Number);

      // Current local rect center (100,40) -> rotated translation (140,-60), then scale-2 affine
      // and 2x contain-fit produce e/f of (580,-200). The old source rect center would yield (320,-60).
      expect(values[0]).toBeCloseTo(0, 5);
      expect(values[1]).toBeCloseTo(2, 5);
      expect(values[2]).toBeCloseTo(-2, 5);
      expect(values[3]).toBeCloseTo(0, 5);
      expect(values[4]).toBeCloseTo(580, 5);
      expect(values[5]).toBeCloseTo(-200, 5);
    });

    it('conjugates the affine translation to a nonzero text-box origin', () => {
      containerOf(200, 200);
      const scale2xAffine = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
      h.layers = {
        'text-layer': {
          id: 'text-layer',
          pos: { x: 10, y: 20, width: 150, height: 80 },
          source: {
            kind: 'tool' as const,
            args: { toolName: 'text' as const, rect: { x1: 20, y1: 10, x2: 120, y2: 60 } },
            pos: { x: 10, y: 20, width: 150, height: 80 },
          },
          operations: [{ id: 'affine-1', kind: 'affine-transform' as const, transform: scale2xAffine, enabled: true }],
        },
      };
      toolArgs = makeTextArgs({
        text: PLACEHOLDER,
        rect: { x1: 30, y1: 30, x2: 130, y2: 80 },
        editingLayerId: 'text-layer',
      });

      renderOverlay();

      expect(overlay().style.transform).toBe('matrix(2,0,0,2,60,60)');
      expect(overlay().style.transformOrigin).toBe('0 0');
    });
  });

  describe('entry', () => {
    it('places the caret at the browser hit-test position for a canvas re-entry request', () => {
      toolArgs = makeTextArgs({ text: 'alpha beta', rect: RECT, editingLayerId: 'text-1' });
      h.textEditFocusRequest = {
        id: 1,
        target: { kind: 'point', layerId: 'text-1', clientX: 43, clientY: 57 },
      };
      const original = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint');
      const caretPositionFromPoint = vi.fn(() => ({ offsetNode: overlay().firstChild!, offset: 6 }));
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: caretPositionFromPoint,
      });

      try {
        renderOverlay();

        expect(caretPositionFromPoint).toHaveBeenCalledWith(43, 57);
        expect(readSelection()).toMatchObject({ string: '', collapsed: true, startOffset: 6, endOffset: 6 });
        expect(document.activeElement).toBe(overlay());
        expect(h.consumeTextEditFocusRequest).toHaveBeenCalledWith(1);
      } finally {
        if (original) Object.defineProperty(document, 'caretPositionFromPoint', original);
        else Reflect.deleteProperty(document, 'caretPositionFromPoint');
      }
    });

    it('selects all on an explicit layer-panel request even when the text is unchanged', () => {
      toolArgs = makeTextArgs({ text: 'same text', rect: RECT, editingLayerId: 'text-1' });
      const { rerender } = renderOverlay();
      const el = overlay();
      placeCaret(el, 2);
      h.textEditFocusRequest = { id: 1, target: { kind: 'select-all', layerId: 'text-1' } };

      rerender(<TextEditOverlay />);

      expect(readSelection()).toMatchObject({ string: 'same text', collapsed: false });
      expect(document.activeElement).toBe(el);
      expect(h.consumeTextEditFocusRequest).toHaveBeenCalledWith(1);
    });

    it('consumes but ignores a focus request for a different editing layer', () => {
      toolArgs = makeTextArgs({ text: 'same text', rect: RECT, editingLayerId: 'text-1' });
      const { rerender } = renderOverlay();
      const el = overlay();
      placeCaret(el, 2);
      h.textEditFocusRequest = { id: 1, target: { kind: 'select-all', layerId: 'text-2' } };

      rerender(<TextEditOverlay />);

      expect(readSelection()).toMatchObject({ string: '', collapsed: true, startOffset: 2, endOffset: 2 });
      expect(h.consumeTextEditFocusRequest).toHaveBeenCalledWith(1);
    });

    it('seeds the element with the draft text and focuses it on entry', () => {
      renderOverlay();
      const el = overlay();

      expect(el.textContent).toBe(PLACEHOLDER);
      // jsdom really moves focus for a `contenteditable` element, so `activeElement` is the
      // observation rather than a spy on `focus()` — and it is the stronger claim, because a spy
      // would also pass if the element refused the focus.
      expect(document.activeElement).toBe(el);
    });

    it('selects the whole seeded text on entry, so the first keystroke replaces the placeholder', () => {
      renderOverlay();
      const selection = window.getSelection();

      expect(selection!.rangeCount).toBe(1);
      expect(selection!.toString()).toBe(PLACEHOLDER);
      // The boundaries, not just the string: jsdom's own focus handling leaves a CARET at offset 0
      // on an editable element, whose `toString()` is `''`, so this assertion cannot be satisfied by
      // the focus call alone.
      const range = selection!.getRangeAt(0);
      expect(range.startContainer).toBe(overlay());
      expect(range.endContainer).toBe(overlay());
      expect(range.endOffset).toBe(overlay().childNodes.length);
    });
  });

  describe('re-entry — the model moved while the element stayed mounted', () => {
    it('re-seeds, focuses and selects when the model text changes while the element stays mounted', () => {
      // THE MECHANISM, and the reason both entry cases above miss it: they are FIRST renders, where
      // seeding is indistinguishable from any other way the element could have got its text. This is
      // the case a commit-then-place gesture produces, and it is the one the overlay's own comment
      // names — an undo, or any future path that re-seeds a draft. The trigger is DISAGREEMENT
      // between the element and `args.text`, never a "have I entered" flag, so the second entry is
      // the only one that can prove the trigger is the disagreement.
      const SECOND = 'Dolor sit amet';
      const { rerender } = renderOverlay();
      const el = overlay();
      expect(el.textContent).toBe(PLACEHOLDER);
      expect(readSelection().string, 'the first entry did not select, so nothing here is a re-seed').toBe(PLACEHOLDER);

      // The focus is TAKEN AWAY first, and the reason is that the re-entry calls `focus()`: with the
      // element already focused, `focus()` is a no-op and an assertion on `activeElement` afterwards
      // would pass against a re-entry that never focused at all. The component's own reclaim does not
      // paper over this — it listens on `focusin`, and a `blur()` fires `focusout`.
      el.blur();
      expect(
        document.activeElement,
        'the setup did not leave the focus elsewhere, so `focus()` proves nothing'
      ).not.toBe(el);

      toolArgs = makeTextArgs({ text: SECOND, rect: SENTINEL_RECT });
      rerender(<TextEditOverlay />);

      // The SAME element, which is what makes this the case: nothing unmounted and remounted, so the
      // seed cannot have come from the mount and could only have come from the effect.
      expect(overlay()).toBe(el);
      expect(el.textContent, 'the element did not re-seed to the new model text').toBe(SECOND);
      expect(document.activeElement, 'the re-entry did not focus the element').toBe(el);

      // And SELECTED, not merely seeded: the seed is only half of the entry, and without the other
      // half the first keystroke would INSERT into 'Dolor sit amet' rather than replace it. The
      // boundaries are read the way the entry case above reads them — `selectNodeContents` selects
      // the host's CHILDREN, so `endOffset` is the child count and not a character count, and the
      // string is what says which characters are inside it.
      const selection = readSelection();
      expect(selection.rangeCount).toBe(1);
      expect(selection.string, 'the re-seed did not select the new text').toBe(SECOND);
      expect(selection.collapsed, 'the re-entry left a collapsed selection, so typing would insert').toBe(false);
      const range = window.getSelection()!.getRangeAt(0);
      expect(range.startContainer).toBe(el);
      expect(range.endContainer).toBe(el);
      expect(range.endOffset).toBe(el.childNodes.length);
    });

    it('does NOT re-seed when the model text is unchanged', () => {
      // THE FALSIFIABLE HALF, and the one that keeps the case above honest. A re-entry that fired on
      // every render would pass the case above and break a style control: dragging the Font Size box
      // republishes the args with a re-measured rect and the SAME string, and a re-seed there would
      // throw the caret to the end of the line on every drag frame.
      const { rerender } = renderOverlay();
      const el = overlay();
      const seeded = el.firstChild;
      expect(seeded).not.toBeNull();

      const caretIndex = 4;
      placeCaret(el, caretIndex);
      expect(readSelection().collapsed).toBe(true);

      // A DIFFERENT rect and the SAME text — the exact shape of a style control's publish. The rect
      // has to really move, or the rerender is indistinguishable from a no-op and the whole case is
      // vacuous: at `scale` 2 the box goes from `20px` to `2px`.
      toolArgs = makeTextArgs({ text: PLACEHOLDER, rect: SENTINEL_RECT });
      rerender(<TextEditOverlay />);
      expect(el.style.left, 'the rerender did not change the box, so it proved nothing').toBe('2px');

      // IDENTITY, which is the claim a `textContent` assertion cannot make: rewriting `textContent`
      // replaces the text node with a new one, so an unchanged `firstChild` is proof that nothing
      // wrote to the element rather than proof that it wrote the same string back.
      expect(el.firstChild, 'the element was rewritten with the same string').toBe(seeded);
      expect(el.textContent).toBe(PLACEHOLDER);

      // And the CARET the user placed, which is the harm. A re-seed here would select the whole
      // string, so the collapse is the observation; the offset pins it to the character the user
      // chose rather than to the ends the re-seed would have produced.
      const selection = readSelection();
      expect(selection.collapsed, 'a re-seed selected the whole string and threw the caret away').toBe(true);
      expect(selection.string).toBe('');
      expect(selection.startOffset).toBe(caretIndex);
    });

    it('does NOT re-seed while the user is typing, which would throw the caret to the end', () => {
      // The ordinary case, and the one the guard's second reason exists for: the effect runs on EVERY
      // `args.text` change INCLUDING the ones this component publishes itself, so every keystroke
      // reaches it. A rewrite on each one would move the caret to the end of the line and make
      // typing impossible from the second character onward.
      const TYPED = 'Alpha beta gamma';
      const caretIndex = 5;
      const { rerender } = renderOverlay();
      const el = overlay();

      // What the BROWSER does to a `contenteditable` is put the typed characters into the element.
      // `handleInput` reads `host.textContent` rather than an event payload, so writing the element's
      // text and firing the real handler IS the simulation — the same two lines the input cases
      // above use, and for the same reason.
      el.textContent = TYPED;
      fireEvent.input(el);
      const published = h.setToolArgs.mock.calls[0][0] as TextArgs;
      expect(published.text, 'the keystroke did not reach the model, so nothing was published to echo back').toBe(
        TYPED
      );

      // The caret the user has moved SINCE, in the middle of the string — so "thrown to the end" and
      // "thrown to the start" are both distinguishable from where it was.
      placeCaret(el, caretIndex);
      const typed = el.firstChild;

      // The store round trip, which `setToolArgs` performs in the app and the mock cannot: what the
      // component published becomes `args.text`, so the effect re-runs with the element and the model
      // IN AGREEMENT. That agreement is the only thing that keeps the caret.
      toolArgs = published;
      rerender(<TextEditOverlay />);

      expect(el.textContent, 'the element did not keep what was typed').toBe(TYPED);
      expect(el.firstChild, 'typing re-seeded the element and threw the caret to the end').toBe(typed);
      const selection = readSelection();
      expect(selection.collapsed, 'a re-seed selected the whole string while the user was typing').toBe(true);
      expect(selection.string).toBe('');
      expect(selection.startOffset).toBe(caretIndex);
    });
  });

  describe('the focus reclaim', () => {
    it('takes the focus back when it falls to the document body', () => {
      // The reason the listener exists, and the defect it prevents: `useRect`'s `absolute inset-0`
      // surface is a plain `div`, so a `mousedown` on it moves focus to `document.body` — and from
      // there `useKeyboardEvents`' `isEditableTarget` guard stops covering the document, so the NEXT
      // LETTER runs the single-character tool shortcuts. MEASURED by the component's own comment: a
      // draft open, one corner drag, then typing `Beta` gave a committed layer and a switched tool.
      renderOverlay();
      const el = overlay();
      expect(document.activeElement).toBe(el);

      el.blur();
      expect(document.activeElement, 'jsdom did not drop focus to the body, so nothing was reclaimed').toBe(
        document.body
      );

      // What the browser fires when focus lands on the fallback, bubbling up to the `document` the
      // listener is on. Dispatched rather than provoked because jsdom's `blur()` fires `focusout` and
      // no `focusin`, so there is nothing here to observe without one.
      fireEvent.focusIn(document.body);

      expect(document.activeElement, 'the overlay did not take the focus back from the body').toBe(el);
    });

    it('leaves the focus alone when it moved somewhere the user aimed', () => {
      // THE HALF THAT MAKES THE CASE ABOVE SAFE. Focus that moved to the options bar, a panel or any
      // other surface is the user doing something deliberate, and Adobe lets the type edit continue
      // across all of them — so a reclaim that took the focus back from those would be the bug
      // rather than the fix, and the case above alone would be satisfied by it. The two cases differ
      // in exactly one thing: where the focus went.
      renderOverlay();
      const el = overlay();
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.helperHost = 'true';
      document.body.appendChild(button);
      button.focus();
      expect(document.activeElement, 'jsdom would not focus the button, so nothing was at stake').toBe(button);

      fireEvent.focusIn(button);

      expect(document.activeElement, 'the overlay stole the focus back from a control the user aimed at').toBe(button);
      expect(document.activeElement).not.toBe(el);
    });
  });

  describe('input', () => {
    it('publishes the typed text through setToolArgs with the rect calculateNewRect returned', () => {
      renderOverlay();
      const el = overlay();

      el.textContent = 'typed';
      fireEvent.input(el);

      // The SENTINEL is the falsifiable half: it is a rect no real measurement produces, so this
      // fails unless the published `rect` is literally the value `calculateNewRect` returned rather
      // than the incoming one.
      expect(vi.mocked(calculateNewRect)).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'typed', rect: RECT }),
        h.toolOverlayRef,
        DOCUMENT_SIZE
      );
      expect(h.setToolArgs).toHaveBeenCalledTimes(1);
      expect(h.setToolArgs).toHaveBeenCalledWith({ ...toolArgs, text: 'typed', rect: SENTINEL_RECT });
    });

    it('flattens an IME child element away on input and publishes textContent with no markup', () => {
      renderOverlay();
      const el = overlay();

      // What an IME leaves behind: the text node has become a `<span>`, and the model reads
      // `textContent` — so keeping the element would make the ink on screen and the ink in the layer
      // two different strings.
      el.innerHTML = '<span>ab</span><span>cd</span>';
      fireEvent.input(el);

      const published = h.setToolArgs.mock.calls[0][0] as TextArgs;
      expect(published.text).toBe('abcd');
      expect(published.text).not.toContain('<');
      expect(el.children.length).toBe(0);
      expect(el.innerHTML).toBe('abcd');
    });

    it('does not flatten or publish while an IME composition is active', () => {
      renderOverlay();
      const el = overlay();
      el.innerHTML = '<span>候</span>';

      fireEvent.input(el, { isComposing: true });

      expect(h.setToolArgs).not.toHaveBeenCalled();
      expect(el.innerHTML).toBe('<span>候</span>');
    });

    it('ignores a mouse-moved caret instead of rewriting the text from the cached offset', () => {
      // The cache exists to repair Chromium's caret after a hard break, and it is only ever correct
      // for a caret the user moved with the KEYBOARD. A click inside the box moves the caret without
      // a key event, so before `selectionchange` was observed the next keystroke reconciled against
      // the previous keystroke's offset: MEASURED, typing `X` after clicking between `c` and `d` in
      // `abcdef` appended the character instead of inserting it, and typing over a double-click
      // selection brought the selected characters back.
      //
      // The model holds `abcdef` because the reconcile branch's whole premise is that the element and
      // `args.text` agree; a model still holding the placeholder would make every rewrite correct.
      toolArgs = makeTextArgs({ text: 'abcdef' });
      renderOverlay();
      const el = overlay();
      placeCaret(el, 6);
      // The stale cache has to EXIST for this to be a test: a keyup is what a real keystroke leaves
      // behind, and it is the only writer that can make the cached offset disagree with the caret.
      fireEvent.keyUp(el, { key: 'f' });
      h.setToolArgs.mockClear();

      placeCaret(el, 3);
      document.dispatchEvent(new Event('selectionchange'));
      el.textContent = 'abcXdef';
      fireEvent.input(el, { inputType: 'insertText', data: 'X' });

      expect(el.textContent, 'the reconcile branch overwrote a click-positioned insert').toBe('abcXdef');
    });

    it('leaves a non-collapsed selection to the browser rather than reconciling against the cache', () => {
      toolArgs = makeTextArgs({ text: 'abcdef' });
      renderOverlay();
      const el = overlay();
      placeCaret(el, 6);
      fireEvent.keyUp(el, { key: 'f' });
      const node = el.firstChild as Text;
      const range = document.createRange();
      range.setStart(node, 2);
      range.setEnd(node, 4);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      // A double-click word select in the browser ends with `selectionchange`, which is what clears
      // the cache — `readCaretOffset` returns null for a non-collapsed selection, so the reconcile
      // branch is skipped and the browser's own replace-selection result stands.
      document.dispatchEvent(new Event('selectionchange'));
      h.setToolArgs.mockClear();

      el.textContent = 'abXef';
      fireEvent.input(el, { inputType: 'insertText', data: 'X' });

      expect(el.textContent, 'a replaced selection was resurrected from the cached offset').toBe('abXef');
    });
  });

  describe("keydown — Enter breaks the line and the other three commit, which is Adobe's split", () => {
    it('extends the selection by one word with Command+Shift+ArrowRight on macOS', () => {
      toolArgs = makeTextArgs({ text: 'Alpha beta' });
      renderOverlay();
      const el = overlay();
      placeCaret(el, 0);

      const notCancelled = fireEvent.keyDown(el, { key: 'ArrowRight', metaKey: true, shiftKey: true });

      expect(notCancelled).toBe(false);
      expect(readSelection().string).toBe('Alpha');
    });

    it('extends the selection by one word with Control+Shift+ArrowLeft on Windows/Linux', () => {
      toolArgs = makeTextArgs({ text: 'Alpha beta' });
      renderOverlay();
      const el = overlay();
      placeCaret(el, 'Alpha beta'.length);

      fireEvent.keyDown(el, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });

      expect(readSelection().string).toBe('beta');
    });

    it('extends a reverse selection through its anchor and continues forward', () => {
      toolArgs = makeTextArgs({ text: 'Alpha beta' });
      renderOverlay();
      const el = overlay();
      const node = el.firstChild as Text;
      const selection = window.getSelection()!;
      selection.setBaseAndExtent(node, 5, node, 0);

      fireEvent.keyDown(el, { key: 'ArrowRight', metaKey: true, shiftKey: true });
      expect(selection.isCollapsed).toBe(true);
      expect(selection.anchorOffset).toBe(5);
      expect(selection.focusOffset).toBe(5);

      fireEvent.keyDown(el, { key: 'ArrowRight', metaKey: true, shiftKey: true });
      expect(selection.toString()).toBe(' beta');
      expect(selection.anchorOffset).toBe(5);
      expect(selection.focusOffset).toBe(10);
    });

    it('inserts a single newline at the caret for a bare Enter, and does not commit', () => {
      renderOverlay();
      const el = overlay();

      // The bare Enter IS the line break, so it must reach the model as one `\n` and must not have
      // committed. `fireEvent` returns false when the handler called `preventDefault`, which is the
      // other half of the claim: a bare Enter must not also fall through to the browser's own
      // contenteditable behaviour, which would insert a `<div>`.
      const notCancelled = fireEvent.keyDown(el, { key: 'Enter' });

      expect(notCancelled).toBe(false);
      expect(h.commitDirtyTool).not.toHaveBeenCalled();
      expect(h.setToolArgs).toHaveBeenCalledTimes(1);
      expect(h.setToolArgs).toHaveBeenCalledWith({ ...toolArgs, text: '\n', rect: SENTINEL_RECT });
      expect(el.textContent).toBe('\n');
      expect(el.children.length).toBe(0);
    });

    it('commits for the keypad Enter, which reports code NumpadEnter and carries no modifier', () => {
      // "Press the Enter key on the numeric keypad"
      // (https://helpx.adobe.com/photoshop/using/creating-type.html). `code` is the only thing that
      // separates it from the main `Enter` that inserts a break, so the code is the whole test.
      renderOverlay();
      const el = overlay();

      fireEvent.keyDown(el, { key: 'Enter', code: 'NumpadEnter' });

      expect(h.commitDirtyTool).toHaveBeenCalledTimes(1);
      expect(h.setToolArgs).not.toHaveBeenCalled();
    });

    it('commits for Command+Enter', () => {
      // "Press Ctrl+Enter (Windows) or Command+Return (Mac OS)" — the same Adobe page.
      renderOverlay();
      const el = overlay();

      fireEvent.keyDown(el, { key: 'Enter', metaKey: true });

      expect(h.commitDirtyTool).toHaveBeenCalledTimes(1);
      expect(h.setToolArgs).not.toHaveBeenCalled();
    });

    it('commits for Control+Enter', () => {
      renderOverlay();
      const el = overlay();

      fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true });

      expect(h.commitDirtyTool).toHaveBeenCalledTimes(1);
      expect(h.setToolArgs).not.toHaveBeenCalled();
    });

    it("commits on Escape, which is Adobe's shipped default to commit and NOT a cancel", () => {
      // "Note that the Esc key is set to commit text by default. You can change this to cancel the
      // changes by going to Edit > Preferences > Type … Then uncheck Use Esc key to commit text"
      // (https://helpx.adobe.com/photoshop/using/editing-text.html). There is no preferences store
      // here, so the default IS the behaviour — and this case is the one that would fail first if
      // the folklore reading were implemented instead.
      renderOverlay();
      const el = overlay();

      const notCancelled = fireEvent.keyDown(el, { key: 'Escape' });

      expect(notCancelled).toBe(false);
      expect(h.commitDirtyTool).toHaveBeenCalledTimes(1);
      expect(h.setToolArgs).not.toHaveBeenCalled();
    });

    it('does nothing at all for a keydown the browser marked isComposing', () => {
      renderOverlay();
      const el = overlay();

      // The IME owns every key for the length of the composition. Committing out from under it
      // drops the candidate the user was still choosing, and a bare Enter must not insert a break
      // into the middle of one. `fireEvent` returning true proves `preventDefault` was NOT called
      // either, so the handler really did nothing.
      const results = [
        fireEvent(el, composingKeydown({ key: 'Enter' })),
        fireEvent(el, composingKeydown({ key: 'Escape' })),
        fireEvent(el, composingKeydown({ key: 'Enter', metaKey: true })),
      ];

      expect(results).toEqual([true, true, true]);
      expect(h.commitDirtyTool).not.toHaveBeenCalled();
      expect(h.setToolArgs).not.toHaveBeenCalled();
    });
  });

  it('selects all text on the fifth click in the editor', () => {
    toolArgs = makeTextArgs({ text: 'Alpha beta' });
    renderOverlay();
    const el = overlay();
    placeCaret(el, 2);

    fireEvent.click(el, { detail: 5 });

    expect(readSelection().string).toBe('Alpha beta');
    expect(readSelection().collapsed).toBe(false);
  });

  describe('paste', () => {
    it("publishes text/plain only, refusing the clipboard's rich flavour, and prevents the default", () => {
      renderOverlay();
      const el = overlay();
      const { event, requested } = richPaste();

      fireEvent(el, event);

      // `text/plain` is the whole contract: a type layer here has one font, one size and one colour
      // for every character, so honouring `text/html` would produce ink the layer cannot represent —
      // and it would then be silently flattened on the next `input` anyway.
      expect(requested).toEqual(['text/plain']);
      expect(event.defaultPrevented).toBe(true);
      expect(h.setToolArgs).toHaveBeenCalledTimes(1);
      expect(h.setToolArgs).toHaveBeenCalledWith({ ...toolArgs, text: 'pasted', rect: SENTINEL_RECT });
      expect(el.textContent).toBe('pasted');
      expect(el.children.length).toBe(0);
    });
  });

  describe('the exported DOM helpers, tested against a real element in the document', () => {
    it('insertPlainTextAtCaret appends when there is no selection to insert at', () => {
      const host = hostInDocument('hello world');
      window.getSelection()!.removeAllRanges();

      expect(insertPlainTextAtCaret(host, '!')).toBe('hello world!');
      expect(host.textContent).toBe('hello world!');
    });

    it('keeps the caret after repeated newline insertions at the end of a line', () => {
      const host = hostInDocument('I');
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(host);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      insertPlainTextAtCaret(host, '\n');
      insertPlainTextAtCaret(host, 'I');
      insertPlainTextAtCaret(host, '\n');
      insertPlainTextAtCaret(host, 'I');

      expect(host.textContent).toBe('I\nI\nI');
      expect(selection.anchorOffset).toBe(host.textContent?.length);
    });

    it('selectAllIn selects every character of the host', () => {
      const host = hostInDocument('hello world');

      selectAllIn(host);

      const selection = window.getSelection()!;
      expect(selection.rangeCount).toBe(1);
      expect(selection.toString()).toBe('hello world');
    });
  });
});
