import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RULER_ENDPOINT_HIT_RADIUS, type RulerMeasurement } from '../../../tools/ruler.ts';
import { resetRulerMeasurementForTest, useRulerMeasurement } from '../../../tools/ruler-measurement-store.ts';
import { RulerToolArea, drawRulerRule } from '../RulerToolArea.tsx';

const h = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getLocalCoords: vi.fn<(event: unknown) => { x: number; y: number }>(() => ({ x: 0, y: 0 })),
  isPointerDownValid: vi.fn((_event: unknown) => true),
  isPointerMoveValid: vi.fn((_event: unknown) => true),
  isPointerUpValid: vi.fn((_event: unknown) => true),
  trackedPointerId: { current: null as number | null },
  releasePointer: vi.fn(),
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
  // The device-pixel snap is a `translate`, and this stub records no transform — the offset itself is
  // asserted by the `drawRulerRule` tests below through a stub that captures it.
  translate: vi.fn(),
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
  // Present because the tool area READS it, not because the mock needed it: the measurement store
  // keys the line on the document as well as the frame, and a mock that omitted the field would have
  // let a store keyed on size alone pass every test here.
  documentId: 'doc-1',
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
    releasePointer: h.releasePointer,
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
    h.releasePointer.mockReset();
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

  it('names the START end as the protractor vertex without redefining X and Y', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 10, y: 10 }, { x: 10, y: 90 }, { altKey: true });

    // `start` stays the point the line was DRAWN from, which is what X and Y report. The first
    // version of this pivoted by swapping `start` and `end`, which is shorter and redefines two of
    // the seven readouts the instant the protractor is pulled from the near end: the bar reported
    // the far end's coordinates as "the starting location" while W and H stayed put, so the meaning
    // of the pair silently swapped under the pointer mid-gesture.
    expect(lineAt(el)).toEqual({
      start: { x: 10, y: 10 },
      end: { x: 110, y: 10 },
      legEnd: { x: 10, y: 90 },
      legAt: 'start',
    });
  });

  it('clears the line when the drag ends outside the image, which is Adobe first removal', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 20, y: 20 }, { x: 900, y: 20 });

    expect(lineAt(el)).toBeNull();
  });

  it('MOVES the whole line when the drag starts on its body', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    // Pressed halfway along the line, clear of both ends, which is Adobe's "To move the line, place
    // the pointer on the line away from either endpoint and drag the line."
    drag(el, { x: 60, y: 10 }, { x: 60, y: 70 });

    // A MOVE, so the angle and the length are the line's own rather than the pointer's.
    expect(lineAt(el)).toEqual({ start: { x: 10, y: 70 }, end: { x: 110, y: 70 } });
  });

  it('RESIZES the line when the drag starts on an endpoint, and leaves the other end put', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 110, y: 10 }, { x: 110, y: 90 });

    expect(lineAt(el)).toEqual({ start: { x: 10, y: 10 }, end: { x: 110, y: 90 } });
  });

  it('constrains a RESIZE about the end that is standing still', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 110, y: 10 }, { x: 116, y: 100 }, { shiftKey: true });

    const line = lineAt(el);
    expect(line?.start).toEqual({ x: 10, y: 10 });
    // Snapped about `start`, so the dragged end lands ON the 45° ray through it — which for a ray
    // from (10, 10) is the line `x === y`. Constraining about the press point instead would put the
    // end on a 45° ray through (110, 10) and swing the far end that was meant to stand still.
    expect(line?.end.x).toBeCloseTo(line?.end.y ?? 0);
  });

  it('measures afresh when the press is clear of the line, which is what leaves MOVE reachable', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 400, y: 400 }, { x: 500, y: 400 });

    expect(lineAt(el)).toEqual({ start: { x: 400, y: 400 }, end: { x: 500, y: 400 } });
  });

  it('carries a protractor leg through a MOVE, rather than leaving it behind', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    drag(el, { x: 110, y: 10 }, { x: 110, y: 90 }, { altKey: true });

    drag(el, { x: 60, y: 10 }, { x: 60, y: 30 });

    // The whole figure translates by the pointer's delta: a leg abandoned at the old vertex would
    // report an angle the user never asked for.
    expect(lineAt(el)).toEqual({
      start: { x: 10, y: 30 },
      end: { x: 110, y: 30 },
      legEnd: { x: 110, y: 110 },
    });
  });

  it('carries a protractor leg through a RESIZE of the vertex end', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    drag(el, { x: 110, y: 10 }, { x: 110, y: 90 }, { altKey: true });

    drag(el, { x: 110, y: 10 }, { x: 210, y: 10 });

    expect(lineAt(el)).toEqual({
      start: { x: 10, y: 10 },
      end: { x: 210, y: 10 },
      legEnd: { x: 210, y: 90 },
    });
  });

  it('leaves a protractor leg alone when the RESIZE drags the end the leg does NOT hang off', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    drag(el, { x: 110, y: 10 }, { x: 110, y: 90 }, { altKey: true });

    drag(el, { x: 10, y: 10 }, { x: 10, y: 60 });

    // The vertex is `end` and it has not moved, so A and D2 are the leg's own and only W and H grow.
    expect(lineAt(el)).toEqual({
      start: { x: 10, y: 60 },
      end: { x: 110, y: 10 },
      legEnd: { x: 110, y: 90 },
    });
  });

  it('treats a press that never moved as a CLICK and leaves the line alone', () => {
    const { container: el } = renderArea();
    drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });

    drag(el, { x: 400, y: 400 }, { x: 400, y: 400 });

    // A click is not one of Adobe's four gestures. Publishing the collapsed line instead would both
    // report a 0 px measurement and hand the pointer's NEXT drag to that line's endpoint, so the line
    // the user was trying to draw would be moved rather than replaced.
    expect(lineAt(el)).toEqual({ start: { x: 10, y: 10 }, end: { x: 110, y: 10 } });
  });

  it('reports no measurement at all after a click on an empty canvas', () => {
    const { container: el } = renderArea();

    drag(el, { x: 400, y: 400 }, { x: 400, y: 400 });

    expect(lineAt(el)).toBeNull();
  });

  it('starts nothing when the press is on the pasteboard, and gives the pointer back', () => {
    const { container: el } = renderArea();

    // The area is the whole workspace, so the press is accepted here unless it is refused. Left
    // accepted, a drag from outside the image inwards publishes a line whose `start` is off-frame
    // and the bar reports a negative X or Y — a measurement of a point the user cannot see.
    drag(el, { x: 900, y: 500 }, { x: 400, y: 300 });

    expect(lineAt(el)).toBeNull();
    expect(h.releasePointer, 'a refused press must not leave the pointer claimed').toHaveBeenCalled();
  });

  it('releases the pointer AND the draft on a cancel, because a cancel is not a release', () => {
    const { container: el } = renderArea();
    const area = areaOf(el);

    pointer(10, 10);
    fireEvent.pointerDown(area, { button: 0, pointerId: 1 });
    pointer(110, 60);
    fireEvent.pointerMove(area, { pointerId: 1 });

    // A browser-taken pointer — a touch pan, a zoom gesture — produces this and no `pointerup`. The
    // hook documents that a gesture ending any other way leaves its claim set, which makes every
    // later press fail its first-pointer-wins check; the draft is the other half, because the next
    // `pointermove` reusing a mouse pointer id would republish the abandoned line.
    fireEvent.pointerCancel(area, { pointerId: 1 });

    expect(h.releasePointer).toHaveBeenCalled();

    h.getLocalCoords.mockReturnValue({ x: 300, y: 300 });
    fireEvent.pointerMove(area, { pointerId: 1 });
    expect(lineAt(el), 'the abandoned draft must not keep publishing').not.toEqual({
      start: { x: 10, y: 10 },
      end: { x: 300, y: 300 },
    });

    // And the area still answers the next press, which is the failure a leaked claim produces.
    const { container: el2 } = renderArea();
    drag(el2, { x: 10, y: 10 }, { x: 110, y: 60 });
    expect(lineAt(el2)).toEqual({ start: { x: 10, y: 10 }, end: { x: 110, y: 60 } });
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

  it('draws a BLACK rule inside a light casing, which is what makes it read as Photoshop’s', () => {
    const { container: el } = renderArea();

    act(() => {
      drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    });

    // A repaint happens per published measurement, so the count is one pair per paint rather than one
    // pair per drag. What must hold is that every paint is a PAIR and that the casing is the WIDER of
    // the two — that is the whole trick, and a rule drawn in one colour would satisfy neither.
    expect(strokes.length % 4).toBe(0);
    for (let index = 0; index < strokes.length; index += 4) {
      // Each paint strokes twice per pass: the segment, then the end caps. So a paint is four
      // strokes — two wide-and-light, then two narrow-and-black.
      expect(strokes[index].width).toBe(strokes[index + 1].width);
      expect(strokes[index + 2].width).toBe(strokes[index + 3].width);
      expect(strokes[index].width).toBeGreaterThan(strokes[index + 2].width);
      expect(strokes[index].colour).toBe(strokes[index + 1].colour);
      expect(strokes[index].colour).not.toBe(strokes[index + 2].colour);
    }

    // The CORE is black and the casing is white. This ordering is the visible defect the previous
    // version had — a light core inside a dark casing drew a translucent GREY line over a white page
    // instead of the crisp black line Photoshop draws, and the screenshot is what showed it.
    const casing = strokes[strokes.length - 4];
    const core = strokes[strokes.length - 1];
    expect(core.colour).toBe('#000000');
    expect(casing.colour).toBe('#ffffff');

    expect(core.segments).toContainEqual([10, 10]);
    expect(core.segments).toContainEqual([110, 10]);
  });

  it('snaps the rule by half a DEVICE pixel, which is what stops it being a grey hairline', () => {
    strokes.length = 0;
    ctx.translate.mockClear();

    act(() => {
      drawRulerRule(ctx as unknown as CanvasRenderingContext2D, { start: { x: 10, y: 10 }, end: { x: 110, y: 10 } }, 1);
    });

    // A stroke is centred on its path, so a one-CSS-px rule on a whole coordinate straddles two device
    // rows and each takes half the coverage — which is the grey line in the screenshot. Half a device
    // pixel centres it on one row.
    expect(ctx.translate).toHaveBeenCalledWith(0.5, 0.5);
  });

  it('scales BOTH the snap and the width by the fit, because the canvas carries no transform', () => {
    strokes.length = 0;
    ctx.translate.mockClear();

    act(() => {
      drawRulerRule(
        ctx as unknown as CanvasRenderingContext2D,
        { start: { x: 10, y: 10 }, end: { x: 110, y: 10 } },
        0.5
      );
    });

    // Its backing store is document-sized and CSS scales it, so one BACKING pixel is `scale` device
    // pixels. Half a device pixel is therefore half a backing pixel divided by the fit — a naive `0.5`
    // would snap to half a BACKING pixel, which is a quarter of a device pixel at this fit and lands
    // nowhere near the grid.
    expect(ctx.translate).toHaveBeenCalledWith(1, 1);
    // And the rule is still one CSS px, which at this fit is two backing px.
    expect(strokes[strokes.length - 1].width).toBeCloseTo(2);
  });

  it('divides the rule by the contain fit, so it stays one CSS pixel at any zoom', () => {
    const { container: el } = renderArea();

    act(() => {
      drag(el, { x: 10, y: 10 }, { x: 110, y: 10 });
    });

    // The mocked fit is 1, so the core is one backing pixel and the white casing under it is five:
    // `RULE_WIDTH_CSS / scale` plus `CASING_EXTRA_CSS` on each side. Both are DIVIDED by the fit,
    // which is what stops the rule being a hairline at 25% and a slab at 400%.
    const core = strokes[strokes.length - 1];
    const casing = strokes[strokes.length - 4];
    expect(core.width).toBe(1);
    expect(casing.width).toBe(5);
  });

  it('honours a hit radius that is reachable, in document pixels', () => {
    expect(RULER_ENDPOINT_HIT_RADIUS).toBeGreaterThan(0);
  });
});
