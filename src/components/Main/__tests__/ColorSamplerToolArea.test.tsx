import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COLOR_SAMPLER_READBACK_UNAVAILABLE } from '../../../tools/color-sampler-readback.ts';
import { resetColorSamplersForTest, useColorSamplers } from '../../../tools/color-sampler-store.ts';
import { COLOR_SAMPLER_HIT_RADIUS, type ColorSampler } from '../../../tools/colorSampler.ts';
import { ColorSamplerToolArea } from '../ColorSamplerToolArea.tsx';

const h = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getLocalCoords: vi.fn<(event: unknown) => { x: number; y: number }>(() => ({ x: 0, y: 0 })),
  isPointerDownValid: vi.fn((_event: unknown) => true),
  trackedPointerId: { current: null as number | null },
  dimensions: { current: { offsetX: 0, offsetY: 0, scale: 1 } },
}));

/** The composited workspace canvas, sized to the document frame exactly as `drawLayersToCanvas` sizes it. */
const workspace = document.createElement('canvas');
workspace.width = 800;
workspace.height = 600;

/**
 * The overlay, with a backing store TWICE the frame — the way a device-pixel-ratio 2 canvas is. The
 * size is deliberately not the frame's: a clear driven off `totalSize` would then leave half the
 * pixels this tool drew, which is the under-clear-on-resize the component's own comment names.
 */
const overlay = document.createElement('canvas');
overlay.width = 1600;
overlay.height = 1200;

/** `#1a2b3c`, so a sampled colour cannot be confused with the black of a stub that read nothing. */
const COMPOSITED_RGB: [number, number, number] = [0x1a, 0x2b, 0x3c];

let composited = new Uint8ClampedArray(workspace.width * workspace.height * 4);

const fillCompositedOpaque = () => {
  for (let index = 0; index < composited.length; index += 4) {
    composited[index] = COMPOSITED_RGB[0];
    composited[index + 1] = COMPOSITED_RGB[1];
    composited[index + 2] = COMPOSITED_RGB[2];
    composited[index + 3] = 255;
  }
};

/** Honours the requested rectangle, so a read of the wrong window is observable rather than assumed. */
const readWindow = (x: number, y: number, width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4);
  for (let row = 0; row < height; row++) {
    const source = ((y + row) * workspace.width + x) * 4;
    data.set(composited.subarray(source, source + width * 4), row * width * 4);
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
};

const readbackStub = { getImageData: vi.fn(readWindow) };

/** One stroked path, in the order the tool area drew it: the geometry, the width and the colour. */
const strokes: { width: number; colour: string; segments: [number, number][] }[] = [];

/** The label's two halves, recorded separately because the outline is stroked before the face is filled. */
const outlines: { text: string; at: [number, number]; colour: string; font: string; baseline: string }[] = [];
const faces: { text: string; at: [number, number]; colour: string }[] = [];

const currentPath: [number, number][] = [];
const pathSoFar = (): [number, number][] => [...currentPath];

const ctx = {
  canvas: overlay,
  globalAlpha: 1,
  lineCap: 'butt' as CanvasLineCap,
  lineWidth: 1,
  strokeStyle: '',
  fillStyle: '',
  font: '10px sans-serif',
  textBaseline: 'alphabetic' as CanvasTextBaseline,
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(() => {
    currentPath.length = 0;
  }),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(() => {
    strokes.push({ width: ctx.lineWidth, colour: ctx.strokeStyle, segments: pathSoFar() });
  }),
  strokeText: vi.fn((text: string, x: number, y: number) => {
    outlines.push({ text, at: [x, y], colour: ctx.strokeStyle, font: ctx.font, baseline: ctx.textBaseline });
  }),
  fillText: vi.fn((text: string, x: number, y: number) => {
    faces.push({ text, at: [x, y], colour: ctx.fillStyle });
  }),
};

const originalGetContext = overlay.getContext.bind(overlay);
// The tool area is handed a context directly as a prop, so the canvas' own `getContext` is never
// called; the override exists so anything that DOES ask gets the recording stub rather than null.
overlay.getContext = ((contextId: string) =>
  contextId === '2d' ? (ctx as unknown as CanvasRenderingContext2D) : null) as unknown as typeof overlay.getContext;

const storeState = {
  canvasRef: { current: workspace },
  containerRef: { current: document.createElement('div') },
  totalSize: { width: 800, height: 600 },
  renderSelector: { source: 'legacy' as 'legacy' | 'pending' | 'durable' },
};

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, h.dispatch],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: { toolName: 'color-sampler', sampleSize: 1 } }),
}));

/**
 * `usePointerPosition` is mocked rather than driven by a real layout, for `RulerToolArea`'s reason: the
 * pointer mapping is this repo's own concern and a test here that exercised it would be testing
 * arithmetic another test already owns. The mock keeps the pointer-capture contract the tool area
 * depends on — a press is refused while another pointer is down — because that contract is what keeps
 * a second finger from placing a sampler over the first one's work.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    pointerIdRef: h.trackedPointerId,
    dimensionsRef: h.dimensions,
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

/** A reader for the published samplers, so a test asserts the store rather than the pixels. */
const Probe = () => {
  const samplers = useColorSamplers();
  return <output data-testid="probe">{JSON.stringify(samplers)}</output>;
};

const pointer = (x: number, y: number) => {
  h.getLocalCoords.mockReturnValue({ x, y });
};

const renderArea = () =>
  render(
    <>
      <ColorSamplerToolArea className="test" overlayCtxRef={{ current: ctx as unknown as CanvasRenderingContext2D }} />
      <Probe />
    </>
  );

const areaOf = (el: HTMLElement) => el.querySelector('div.test') as HTMLDivElement;
const probeOf = (el: HTMLElement) => el.querySelector('[data-testid="probe"]')?.textContent ?? '[]';

const samplersAt = (el: HTMLElement): ColorSampler[] => JSON.parse(probeOf(el)) as ColorSampler[];

/** Adobe's first gesture: "Click where you want to place a sampler." */
const click = (el: HTMLElement, at: { x: number; y: number }, init: PointerEventInit = {}) => {
  const area = areaOf(el);
  pointer(at.x, at.y);
  fireEvent.pointerDown(area, { button: 0, pointerId: 1, ...init });
  fireEvent.pointerUp(area, { button: 0, pointerId: 1, ...init });
};

/** Draws a gesture through the three handlers, ending at `to`. */
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

describe('ColorSamplerToolArea', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetColorSamplersForTest();
    workspace.width = 800;
    workspace.height = 600;
    workspace.removeAttribute('data-hidpi-ratio');
    composited = new Uint8ClampedArray(workspace.width * workspace.height * 4);
    fillCompositedOpaque();
    strokes.length = 0;
    outlines.length = 0;
    faces.length = 0;
    currentPath.length = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '';
    ctx.fillStyle = '';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.moveTo.mockImplementation((x: number, y: number) => void currentPath.push([x, y]));
    ctx.lineTo.mockImplementation((x: number, y: number) => void currentPath.push([x, y]));
    ctx.clearRect.mockClear();
    readbackStub.getImageData.mockClear();
    // Opt-in pixel read-back: the context `createMockCanvasContext` installs globally has no
    // `getImageData` by design, which is exactly the branch the refusal test below has to be able to
    // turn OFF deliberately.
    getContextSpy = vi
      .spyOn(workspace, 'getContext')
      .mockReturnValue(readbackStub as unknown as CanvasRenderingContext2D);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.dispatch.mockReset();
    h.getLocalCoords.mockReturnValue({ x: 0, y: 0 });
    h.isPointerDownValid.mockReturnValue(true);
    h.trackedPointerId.current = null;
    h.dimensions.current.scale = 1;
    storeState.renderSelector.source = 'legacy';
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    getContextSpy.mockRestore();
    overlay.getContext = originalGetContext;
  });

  it('records NO history state, because a color sampler is nonprinting', () => {
    const { container: el } = renderArea();

    // All four of Adobe's gestures, so the claim below is about a tool that was actually used rather
    // than one that did nothing: "Click where you want to place a sampler", "drag the sampler to the
    // new location", "drag the sampler out of the document window", and the scissors Alt-click.
    click(el, { x: 120, y: 80 });
    expect(samplersAt(el)).toHaveLength(1);
    drag(el, { x: 120, y: 80 }, { x: 300, y: 300 });
    drag(el, { x: 300, y: 300 }, { x: 900, y: 300 });
    expect(samplersAt(el)).toEqual([]);
    click(el, { x: 400, y: 400 });
    click(el, { x: 400, y: 400 }, { altKey: true });
    expect(samplersAt(el)).toEqual([]);

    // The whole architecture of that claim: this tool has no `dispatch` to reach. A layer, a
    // `COMMIT_DOCUMENT_EDIT` or a `TOOL_ACTION` would all have to arrive through the store's dispatch,
    // and nothing here is handed one.
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('places one sampler carrying the colour the composited canvas reports at the clicked pixel', () => {
    const { container: el } = renderArea();

    click(el, { x: 120, y: 80 });

    // `#1a2b3c` is what the composited workspace canvas holds, and it is the composited canvas rather
    // than the active layer because that is the pixel the user clicked. A sampler that reported
    // `#000000` would be reporting the absence of a read, not a colour.
    expect(samplersAt(el)).toEqual([{ id: 1, point: { x: 120, y: 80 }, color: '#1a2b3c' }]);
    expect(readbackStub.getImageData).toHaveBeenCalledWith(120, 80, 1, 1);
  });

  it('samples one logical document pixel from a DPR-scaled composite canvas', () => {
    workspace.width = 1600;
    workspace.height = 1200;
    workspace.setAttribute('data-hidpi-ratio', '2');
    composited = new Uint8ClampedArray(workspace.width * workspace.height * 4);
    for (let y = 0; y < workspace.height; y++) {
      for (let x = 0; x < workspace.width; x++) {
        const value = Math.floor((x + 0.5) / 2) < 120 ? 0 : 255;
        const offset = (y * workspace.width + x) * 4;
        composited[offset] = value;
        composited[offset + 1] = value;
        composited[offset + 2] = value;
        composited[offset + 3] = 255;
      }
    }
    const { container: el } = renderArea();

    click(el, { x: 120, y: 80 });

    expect(samplersAt(el)).toEqual([{ id: 1, point: { x: 120, y: 80 }, color: '#ffffff' }]);
    expect(readbackStub.getImageData).toHaveBeenCalledWith(241, 161, 1, 1);
  });

  it('does not read the previous canvas while a history presentation is pending', () => {
    storeState.renderSelector.source = 'pending';
    const { container: el } = renderArea();

    click(el, { x: 120, y: 80 });

    expect(samplersAt(el)).toEqual([]);
    expect(getContextSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('refuses loudly and places nothing when the composited canvas cannot be read back', () => {
    // The reduced-canvas branch is reachable and the refusal has to NAME itself: a sampler with no
    // colour is a tool that looks broken, so the quiet nothing below is reserved for a pixel that
    // genuinely has no colour.
    getContextSpy.mockReturnValue({} as CanvasRenderingContext2D);
    const { container: el } = renderArea();

    click(el, { x: 120, y: 80 });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      COLOR_SAMPLER_READBACK_UNAVAILABLE,
      'the color sampler cannot read the composited canvas'
    );
    expect(COLOR_SAMPLER_READBACK_UNAVAILABLE).toBe('color-sampler-readback-unavailable');
    expect(samplersAt(el)).toEqual([]);
  });

  it('places nothing and logs nothing on a fully transparent pixel', () => {
    // The two failure kinds are deliberately not merged. Adobe shows a crossed-out swatch for a
    // transparent pixel and changes nothing, so this is a quiet nothing — and it stays quiet, because
    // a user clicking empty canvas is not an error to shout about.
    composited[(80 * 800 + 120) * 4 + 3] = 0;
    const { container: el } = renderArea();

    click(el, { x: 120, y: 80 });

    // BOTH halves, or the test would pass for the loud refusal of the row above: no sampler, and no
    // complaint either.
    expect(samplersAt(el)).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('refuses at four and changes nothing, rather than replacing the oldest sampler', () => {
    const { container: el } = renderArea();
    const points = [
      { x: 50, y: 50 },
      { x: 200, y: 50 },
      { x: 350, y: 50 },
      { x: 500, y: 50 },
    ];
    for (const at of points) click(el, at);

    click(el, { x: 650, y: 50 });

    // The refusal rather than a silent replacement is a DECISION with a source: Adobe says "up to four"
    // and publishes no rule for a fifth press, so the app changes nothing and says so. A regression to
    // "replace the oldest" would still hold four samplers — it would fail on the first one, whose id
    // would have become 5, and on the fifth being the point that was clicked.
    expect(samplersAt(el)).toEqual(points.map((point, index) => ({ id: index + 1, point, color: '#1a2b3c' })));
    expect(consoleErrorSpy).toHaveBeenCalledWith('color-sampler-cap-reached', 'the color sampler holds 4 samples');
  });

  it('starts a MOVE for a press inside the eight pixel hit radius rather than a second sampler', () => {
    const { container: el } = renderArea();
    click(el, { x: 200, y: 200 });

    drag(el, { x: 204, y: 200 }, { x: 300, y: 320 });

    // The press is four document pixels from the marker, inside `COLOR_SAMPLER_HIT_RADIUS`. This is
    // what proves the hit test is consulted at all: without it the drag would have placed a second
    // sampler and left the first where it was.
    expect(COLOR_SAMPLER_HIT_RADIUS).toBe(8);
    expect(samplersAt(el)).toEqual([{ id: 1, point: { x: 300, y: 320 }, color: '#1a2b3c' }]);
  });

  it('places a SECOND sampler for a press beyond the eight pixel hit radius', () => {
    const { container: el } = renderArea();
    click(el, { x: 200, y: 200 });

    // One pixel further out than the radius reaches, and the radius is inclusive, so this is the
    // nearest point that must NOT grab the marker.
    click(el, { x: 200 + COLOR_SAMPLER_HIT_RADIUS + 1, y: 200 });

    expect(samplersAt(el)).toEqual([
      { id: 1, point: { x: 200, y: 200 }, color: '#1a2b3c' },
      { id: 2, point: { x: 209, y: 200 }, color: '#1a2b3c' },
    ]);
  });

  it('deletes the sampler when a drag is released outside the document frame', () => {
    const { container: el } = renderArea();
    click(el, { x: 200, y: 200 });

    // Adobe: "To delete a color sampler, drag the sampler out of the document window."
    // <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
    drag(el, { x: 200, y: 200 }, { x: 900, y: 200 });

    expect(samplersAt(el)).toEqual([]);
  });

  it.each([
    ['right', { x: 800, y: 200 }],
    ['bottom', { x: 200, y: 600 }],
  ] as const)('deletes a sampler released on the exclusive %s frame edge', (_edge, releasePoint) => {
    const { container: el } = renderArea();
    click(el, { x: 0, y: 0 });

    // Pixel coordinates cover [0,width) × [0,height); the far edge names no pixel.
    drag(el, { x: 0, y: 0 }, releasePoint);

    expect(samplersAt(el)).toEqual([]);
  });

  it('deletes the sampler an Alt-click lands on, and treats an Alt-click on empty canvas as a placement', () => {
    const { container: el } = renderArea();
    click(el, { x: 200, y: 200 });

    // Adobe: "hold down Alt (Windows) or Option (Mac OS) until the pointer becomes a scissors and click
    // the sampler." <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
    click(el, { x: 200, y: 200 }, { altKey: true });
    expect(samplersAt(el)).toEqual([]);

    // The negative half: the gesture is about a SAMPLER, not about the modifier. An Alt-click on empty
    // canvas is an ordinary placement, and it deletes nothing — the sampler 200 pixels away is still
    // there afterwards, which is what a blanket "Alt deletes" implementation would take away.
    click(el, { x: 200, y: 200 });
    click(el, { x: 500, y: 300 }, { altKey: true });
    expect(samplersAt(el)).toEqual([
      { id: 1, point: { x: 200, y: 200 }, color: '#1a2b3c' },
      { id: 2, point: { x: 500, y: 300 }, color: '#1a2b3c' },
    ]);
  });

  it('draws each marker as a dark-then-light crosshair with its own number beside it', () => {
    const { container: el } = renderArea();
    click(el, { x: 120, y: 80 });
    click(el, { x: 400, y: 300 });

    // A repaint happens per published list, so what must hold is the LAST paint: two markers, each a
    // PAIR of strokes, dark then light. The two-tone trick is the whole of the readability argument —
    // a marker drawn in one colour would satisfy neither half of it.
    const paint = strokes.slice(-4);
    expect(paint).toHaveLength(4);
    expect(paint[0].width).toBeGreaterThan(paint[1].width);
    expect(paint[2].width).toBeGreaterThan(paint[3].width);
    expect(paint[0].width).toBe(paint[2].width);
    expect(paint[1].width).toBe(paint[3].width);
    expect(paint[0].colour).toBe('#1a1a1a');
    expect(paint[1].colour).toBe('#ffffff');
    expect(paint[0].colour).not.toBe(paint[1].colour);

    // The crosshair itself: a seven-CSS-pixel arm on each of four sides, centred on the sampler. The
    // exact geometry is asserted rather than "something was drawn", because a marker whose arms were
    // not centred would sit beside its pixel instead of on it.
    expect(paint[1].segments).toEqual([
      [113, 80],
      [127, 80],
      [120, 73],
      [120, 87],
    ]);
    expect(paint[3].segments).toEqual([
      [393, 300],
      [407, 300],
      [400, 293],
      [400, 307],
    ]);

    // The number beside the glyph is the half of the marker Adobe's sources agree on — "#1", "#2" —
    // and it must count PLACEMENT order rather than the array's length or a constant. Both samplers
    // are therefore labelled with their own id, outlined dark and filled light.
    expect(outlines.slice(-2).map(({ text }) => text)).toEqual(['1', '2']);
    expect(faces.slice(-2).map(({ text }) => text)).toEqual(['1', '2']);
    expect(outlines.slice(-2).map(({ colour }) => colour)).toEqual(['#1a1a1a', '#1a1a1a']);
    expect(faces.slice(-2).map(({ colour }) => colour)).toEqual(['#ffffff', '#ffffff']);
    expect(outlines.slice(-2).map(({ at }) => at)).toEqual([
      [130, 80],
      [410, 300],
    ]);
    expect(faces.slice(-2).map(({ at }) => at)).toEqual(outlines.slice(-2).map(({ at }) => at));
  });

  it('divides the marker arm and line widths by the contain fit, so it stays seven CSS pixels at any zoom', () => {
    // The overlay canvas is 1:1 with the document and `object-contain` does the fitting, so the marker
    // is drawn in DOCUMENT pixels and has to be divided by the fit: at `lineWidth: 1` it would be a
    // hairline at 100% and a slab at 400%. The fit is read at paint time, so it is set before the
    // render rather than after it.
    h.dimensions.current.scale = 2;
    const { container: el } = renderArea();

    click(el, { x: 200, y: 300 });

    const paint = strokes.slice(-2);
    expect(paint).toHaveLength(2);
    // `MARKER_ARM_CSS / scale` and `1 / scale` are exact halves, so these are whole values rather
    // than "it changed": a marker drawn at 400% is still seven CSS pixels of arm.
    expect(paint[0].width).toBe(1.5);
    expect(paint[1].width).toBe(0.5);
    expect(paint[1].segments).toEqual([
      [196.5, 300],
      [203.5, 300],
      [200, 296.5],
      [200, 303.5],
    ]);

    // The division is selective and the distinction is the reason: the label's OFFSET moves with the
    // marker, but its text size does not, because a shrunken number is unreadable at 25%.
    expect(outlines.slice(-1).map(({ at }) => at)).toEqual([[205, 300]]);
    expect(outlines.slice(-1).map(({ font }) => font)).toEqual(['12px sans-serif']);
    expect(outlines.slice(-1).map(({ baseline }) => baseline)).toEqual(['middle']);
  });

  it('clears the overlay canvas when it unmounts, because the canvas is shared', () => {
    const { container: el, unmount } = renderArea();
    click(el, { x: 120, y: 80 });
    ctx.clearRect.mockClear();

    unmount();

    // The CANVAS' own size and not the frame's: they differ here, so a clear driven off `totalSize`
    // would be caught rather than coincidentally equal.
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
  });

  it('refuses a press while another pointer is already captured', () => {
    const { container: el } = renderArea();
    const area = areaOf(el);

    pointer(100, 100);
    fireEvent.pointerDown(area, { button: 0, pointerId: 1 });
    pointer(400, 400);
    fireEvent.pointerDown(area, { button: 0, pointerId: 2 });

    // The first sampler stands, and the second press contributed nothing: the store still holds the
    // sampler the first pointer opened, and no third point.
    expect(samplersAt(el)).toEqual([{ id: 1, point: { x: 100, y: 100 }, color: '#1a2b3c' }]);
  });
});
