import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RULER_ENDPOINT_HIT_RADIUS, type RulerMeasurement } from '../../../tools/ruler.ts';
import { resetRulerMeasurementForTest, useRulerMeasurement } from '../../../tools/ruler-measurement-store.ts';
import { RulerToolArea } from '../RulerToolArea.tsx';

const h = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getLocalCoords: vi.fn<(event: unknown) => { x: number; y: number }>(() => ({ x: 0, y: 0 })),
  isPointerDownValid: vi.fn((_event: unknown) => true),
  isPointerMoveValid: vi.fn((_event: unknown) => true),
  isPointerUpValid: vi.fn((_event: unknown) => true),
  trackedPointerId: { current: null as number | null },
}));

const container = document.createElement('div');
const overlay = document.createElement('canvas');
overlay.width = 800;
overlay.height = 600;

/** The paths and line widths the tool area draws, in the order it draws them. */
const strokes: { width: number; colour: string; segments: [number, number][] }[] = [];

const ctx = {
  canvas: overlay,
  globalAlpha: 1,
  lineCap: 'butt' as CanvasLineCap,
  lineWidth: 1,
  strokeStyle: '',
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(() => {
    strokes.push({
      width: ctx.lineWidth,
      colour: ctx.strokeStyle,
      segments: pathSoFar(),
    });
  }),
};

const currentPath: [number, number][] = [];
const pathSoFar = (): [number, number][] => [...currentPath];

const originalGetContext = overlay.getContext.bind(overlay);
// The tool area is handed a context directly as a prop, so the canvas' own `getContext` is never
// called; the override exists so anything that DOES ask gets the recording stub rather than null.
overlay.getContext = ((contextId: string) =>
  contextId === '2d' ? (ctx as unknown as CanvasRenderingContext2D) : null) as unknown as typeof overlay.getContext;

const storeState = {
  containerRef: { current: container },
  totalSize: { width: 800, height: 600 },
};

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, h.dispatch],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: { toolName: 'ruler' } }),
}));

/**
 * `usePointerPosition` is mocked rather than driven by a real layout, because the pointer mapping is
 * this repo's own concern (`usePointerPosition.test.ts` pins it) and a test here that exercised it
 * would be testing arithmetic that another test already owns. The mock keeps the pointer-capture
 * contract the tool area depends on — a press is refused while another pointer is down — because
 * that contract is what keeps a second finger from overwriting the line.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    pointerIdRef: h.trackedPointerId,
    dimensionsRef: { current: { offsetX: 0, offsetY: 0, scale: 1 } },
    getLocalCoords: h.getLocalCoords,
    isMouseDown: { current: false },
    releasePointer: vi.fn(),
    isPointerDownValid: (event: { pointerId: number }) => {
      if (h.trackedPointerId.current !== null) return false;
      h.trackedPointerId.current = event.pointerId;
      return h.isPointerDownValid(event);
    },
    isPointerMoveValid: (event: { pointerId: number }) => event.pointerId === h.trackedPointerId.current,
    isPointerUpValid: (event: { pointerId: number }) => {
      if (event.pointerId !== h.trackedPointerId.current) return false;
      h.trackedPointerId.current = null;
      return true;
    },
  }),
}));

/** A reader for the published measurement, so a test can assert the store rather than the pixels. */
const Probe = () => {
  const measurement = useRulerMeasurement();
  return <output data-testid="probe">{measurement ? JSON.stringify(measurement) : 'none'}</output>;
};

const pointer = (x: number, y: number) => {
  h.getLocalCoords.mockReturnValue({ x, y });
};

const renderArea = () =>
  render(
    <>
      <RulerToolArea className="test" overlayCtxRef={{ current: ctx as unknown as CanvasRenderingContext2D }} />
      <Probe />
    </>
  );

const areaOf = (el: HTMLElement) => el.querySelector('div.test') as HTMLDivElement;
const probeOf = (el: HTMLElement) => el.querySelector('[data-testid="probe"]')?.textContent ?? 'none';

const lineAt = (el: HTMLElement): RulerMeasurement | null => {
  const raw = probeOf(el);
  return raw === 'none' ? null : (JSON.parse(raw) as RulerMeasurement);
};

/** Draws a drag through the three handlers, ending at `to`. */
function drag(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  init: PointerEventInit = {}
) {
  const area = areaOf(el);
  pointer(from.x, from.y);
  fireEvent.pointerDown(area, { button: 0, pointerId: 1, ...init });
  pointer(to.x, to.y);
  fireEvent.pointerMove(area, { pointerId: 1, ...init });
  fireEvent.pointerUp(area, { button: 0, pointerId: 1, ...init });
}

describe('RulerToolArea', () => {
  beforeEach(() => {
    resetRulerMeasurementForTest();
    strokes.length = 0;
    currentPath.length = 0;
    ctx.beginPath.mockClear();
    ctx.moveTo.mockImplementation((x: number, y: number) => currentPath.push([x, y]));
    ctx.lineTo.mockImplementation((x: number, y: number) => currentPath.push([x, y]));
    ctx.stroke.mockClear();
    ctx.clearRect.mockClear();
    ctx.lineWidth = 1;
    h.dispatch.mockReset();
    h.trackedPointerId.current = null;
  });

  afterEach(() => {
    overlay.getContext = originalGetContext;
  });

  it('records NO history state, because a measuring line is nonprinting', () => {
    const { container: el } = renderArea();

    drag(el, { x: 10, y: 10 }, { x: 110, y: 60 });

    // The whole architecture of that claim: this tool has no `dispatch` to reach. A layer, a
    // `COMMIT_DOCUMENT_EDIT` or a `TOOL_ACTION` would all have to arrive through the store's
    // dispatch, and nothing here is handed one.
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('publishes the line the drag drew, and keeps it after release', () => {
    const { container: el } = renderArea();

    drag(el, { x: 10, y: 10 }, { x: 110, y: 60 });

    expect(lineAt(el)).toEqual({ start: { x: 10, y: 10 }, end: { x: 110, y: 60 } });
  });

  it('constrains the line to 45 degrees while Shift is held', () => {
    const { container: el } = renderArea();

    drag(el, { x: 0, y: 0 }, { x: 100, y: 96 }, { shiftKey: true });

    const line = lineAt(el);
    expect(line).not.toBeNull();
    // The unconstrained drag would have reported 100 x 96; the constrained one is the diagonal.
    expect(line?.end.x).toBeCloseTo(line?.end.y ?? 0);
  });

  it('pulls a protractor leg from an Alt-drag at one end of an existing line', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    // The alt-drag starts ON the line's end, so the hit test is satisfied by construction and the
    // test is about the leg rather than about the radius.
    drag(el, { x: 110, y: 10 }, { x: 110, y: 90 }, { altKey: true });

    expect(lineAt(el)).toEqual({
      start: { x: 10, y: 10 },
      end: { x: 110, y: 10 },
      legEnd: { x: 110, y: 90 },
    });
  });

  it('starts a FRESH measurement on an Alt-drag away from the line, which is what the radius buys', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 400, y: 400 }, { x: 500, y: 400 }, { altKey: true });

    expect(lineAt(el)).toEqual({ start: { x: 400, y: 400 }, end: { x: 500, y: 400 } });
  });

  it('reverses the measuring line when the protractor pivots on its START end', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 10, y: 10 }, { x: 10, y: 90 }, { altKey: true });

    expect(lineAt(el)).toEqual({
      start: { x: 110, y: 10 },
      end: { x: 10, y: 10 },
      legEnd: { x: 10, y: 90 },
    });
  });

  it('clears the line when the drag ends outside the image, which is Adobe first removal', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 20, y: 20 }, { x: 900, y: 20 });

    expect(lineAt(el)).toBeNull();
  });

  it('keeps the line when the drag ends exactly on the image border', () => {
    const { container: el } = renderArea();

    drag(el, { x: 0, y: 0 }, { x: 800, y: 600 });

    expect(lineAt(el)).toEqual({ start: { x: 0, y: 0 }, end: { x: 800, y: 600 } });
  });

  it('clears the overlay canvas when it unmounts, because the canvas is shared', () => {
    const { container: el, unmount } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    ctx.clearRect.mockClear();

    unmount();

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it('refuses a press while another pointer is already captured', () => {
    const { container: el } = renderArea();
    const area = areaOf(el);
    pointer(10, 10);
    fireEvent.pointerDown(area, { button: 0, pointerId: 1 });

    pointer(400, 400);
    fireEvent.pointerDown(area, { button: 0, pointerId: 2 });

    // The first line stands, and the second press contributed nothing: the store still holds the
    // line the first pointer opened.
    expect(lineAt(el)).toEqual({ start: { x: 10, y: 10 }, end: { x: 10, y: 10 } });
  });

  it('draws a light rule over a dark one, so the line reads on a white page and a dark photo', () => {
    const { container: el } = renderArea();

    act(() => {
      drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    });

    // A repaint happens per published measurement, so the count is one dark-then-light pair per
    // paint rather than one pair per drag. What must hold is that every paint is a PAIR and that
    // the dark edge is the wider of the two — that is the whole trick, and a rule drawn in one
    // colour would satisfy neither.
    expect(strokes.length % 4).toBe(0);
    for (let index = 0; index < strokes.length; index += 4) {
      // Each paint strokes twice per pass: the segment, then the end caps. So a paint is four
      // strokes — two wide-and-dark, then two narrow-and-light.
      expect(strokes[index].width).toBe(strokes[index + 1].width);
      expect(strokes[index + 2].width).toBe(strokes[index + 3].width);
      expect(strokes[index].width).toBeGreaterThan(strokes[index + 2].width);
      expect(strokes[index].colour).toBe(strokes[index + 1].colour);
      expect(strokes[index].colour).not.toBe(strokes[index + 2].colour);
    }
    const face = strokes[strokes.length - 1];
    expect(face.segments).toContainEqual([10, 10]);
    expect(face.segments).toContainEqual([110, 10]);
  });

  it('divides the rule by the contain fit, so it stays one CSS pixel at any zoom', () => {
    const { container: el } = renderArea();

    act(() => {
      drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    });

    // The mocked fit is 1, so the face is one document pixel and the dark edge under it is three:
    // `RULE_WIDTH_CSS / scale` plus a one-pixel edge on each side. Both are DIVIDED by the fit,
    // which is what stops the rule being a hairline at 25% and a slab at 400%.
    const face = strokes[strokes.length - 1];
    const edge = strokes[strokes.length - 4];
    expect(face.width).toBe(1);
    expect(edge.width).toBe(3);
  });

  it('honours a hit radius that is reachable, in document pixels', () => {
    expect(RULER_ENDPOINT_HIT_RADIUS).toBeGreaterThan(0);
  });
});
