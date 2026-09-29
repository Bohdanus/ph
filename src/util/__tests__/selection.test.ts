import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  SELECTION_ANCHOR_HIT_RADIUS,
  SELECTION_ANCHOR_RADIUS,
  SelectionCanvasContextError,
  cloneBitmapToCanvas,
  copyCanvasToClipboard,
  copyFeatheredPolygonSelectionToCanvas,
  copyFeatheredPolygonToCanvas,
  copyPolygonSelectionToCanvas,
  copyPolygonToCanvas,
  copyRectSelectionToCanvas,
  copySelectionToCanvas,
  createCommittedPolygonSelection,
  createCommittedRectangleSelection,
  distanceBetweenPoints,
  drawClosedSelectionPath,
  drawSelectionOutline,
  findSelectionAnchorAtPoint,
  getActiveRectangularSelection,
  getActiveSelection,
  getSelectionAbsolutePoints,
  getSelectionAtPoint,
  getSelectionRect,
  hasSameSelectionGeometry,
  isPointInPolygon,
  moveSelectionAnchor,
  moveSelectionByDelta,
  normalizeRectangleSelectionRect,
  normalizeSelectionPoints,
  type SelectionCanvasSnapshot,
} from '../selection.ts';
import { makeMockCanvas, makeMockCtx, makeMockImageData, makeMockOffscreenCanvas } from '@/__tests__/canvas-mock.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { Point, Pos, RectXYSorted, Selection, Size } from '../../contexts/general-types.ts';
import type { DocumentFrame } from '../../contexts/document-frame.ts';

/** A shared-mock 2D context whose read-back and write-back entry points stay spyable. */
type RecordedCtx = ReturnType<typeof makeMockCtx> & { getImageData: Mock; putImageData: Mock };

const triangle = (offset = 0): Point[] => [
  { x: 2 + offset, y: 2 + offset },
  { x: 8 + offset, y: 2 + offset },
  { x: 8 + offset, y: 8 + offset },
];

/**
 * Per-construction pixel read-back behavior.
 *
 * `copyFeatheredPolygonSelectionToCanvas` builds two canvases (the destination, then
 * the mask), so seeding `['all-opaque', 'throw']` leaves the destination read-back
 * working while the mask read-back fails. That is the only ordering that survives the
 * unguarded `ctx.getImageData` at `src/util/selection.ts:549` and still reaches the
 * CPU rasterization fallback at `src/util/selection.ts:405`.
 */
type MaskReadBack = 'all-opaque' | 'left-half-opaque' | 'throw';

const readBacks: MaskReadBack[] = [];

/** Every `FakeOffscreenCanvas` built during the current test, in construction order. */
const constructed: FakeOffscreenCanvas[] = [];

const maskReadBack = (width: number, height: number, readBack: MaskReadBack): ImageData => {
  if (readBack === 'throw') throw new Error('simulated canvas read-back failure');

  const imageData = makeMockImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const opaque = readBack === 'all-opaque' || x < Math.floor(width / 2);
      imageData.data[(y * width + x) * 4 + 3] = opaque ? 255 : 0;
    }
  }

  return imageData;
};

/**
 * `createSelectionCanvas` picks `OffscreenCanvas` whenever the global exists and
 * production constructs it with `new`, so the shared `makeMockOffscreenCanvas` object
 * factory has to be wrapped in a constructor. The wrapper owns no context
 * implementation of its own: the context comes from the shared `makeMockCanvas`
 * factory and the pixels from the shared `makeMockImageData` factory. The only thing
 * it adds is the per-canvas `contexts` recorder the copy-path assertions read, plus
 * the pixel read-back that the global `src/test/setup.ts` stub deliberately omits.
 */
class FakeOffscreenCanvas {
  readonly contexts: RecordedCtx[] = [];
  private readonly ctx: RecordedCtx;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    const readBack = readBacks.shift() ?? 'all-opaque';
    this.ctx = makeMockCanvas(this.width, this.height, {
      getImageData: vi.fn(() => maskReadBack(this.width, this.height, readBack)),
    }).getContext('2d') as RecordedCtx;
    constructed.push(this);
  }

  getContext(): RecordedCtx {
    this.contexts.push(this.ctx);
    return this.ctx;
  }
}

/**
 * The destination canvas, which is always constructed before the mask canvas the
 * feathered path allocates second, so the first entry is the one a returned snapshot
 * points at.
 */
const firstConstructed = (): FakeOffscreenCanvas => {
  const canvas = constructed.at(0);
  if (!canvas) throw new Error('expected an OffscreenCanvas to have been constructed');
  return canvas;
};

/**
 * Drives the `document.createElement('canvas')` fallback of `createSelectionCanvas`
 * with pixel-capable contexts from `src/test/setup.ts`. The copy helpers build the
 * destination canvas first and the mask canvas second, so the queue decides which
 * context reads back, which one throws, and which one does not exist at all.
 */
const installPixelDomContexts = (behaviors: Array<MaskReadBack | 'no-context'>): RecordedCtx[] => {
  const contexts: RecordedCtx[] = [];
  vi.stubGlobal('OffscreenCanvas', undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
    const behavior = behaviors.shift() ?? 'all-opaque';
    if (behavior === 'no-context') return null;

    const ctx = {
      ...createPixelCanvasContext(this),
      getImageData: vi.fn(() => maskReadBack(this.width, this.height, behavior)),
    } as RecordedCtx;
    contexts.push(ctx);
    return ctx;
  });

  return contexts;
};

class ClipboardItemStub {
  readonly items: Record<string, Blob>;
  readonly types: string[];
  constructor(items: Record<string, Blob>) {
    this.items = items;
    this.types = Object.keys(items);
  }
}

const installOffscreenCanvas = () => {
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
};

const selection = (overrides: Partial<Selection> = {}): Selection => ({
  id: 'sel-1',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  isActive: true,
  pos: { x: 5, y: 5, width: 10, height: 10 },
  lifecycle: 'committed',
  geometry: 'polygon',
  sourceTool: 'polygonal-lasso',
  ...overrides,
});

describe('normalizeSelectionPoints', () => {
  it('returns null for fewer than three points', () => {
    expect(normalizeSelectionPoints([])).toBeNull();
    expect(normalizeSelectionPoints([{ x: 0, y: 0 }])).toBeNull();
    expect(normalizeSelectionPoints(triangle().slice(0, 2))).toBeNull();
  });

  it('translates points so the bounding box origin becomes zero and reports the source pos', () => {
    const result = normalizeSelectionPoints(triangle(20));

    expect(result).not.toBeNull();
    expect(result!.pos).toEqual({ x: 21, y: 21, width: 8, height: 8 });
    expect(result!.points).toEqual([
      { x: 1, y: 1 },
      { x: 7, y: 1 },
      { x: 7, y: 7 },
    ]);
  });

  it('keeps the pos and the normalized points mutually consistent', () => {
    const result = normalizeSelectionPoints(triangle(20))!;

    expect(result.points.map((point) => ({ x: point.x + result.pos.x, y: point.y + result.pos.y }))).toEqual(
      triangle(20)
    );
  });

  it('defaults the bounding line width to 1 so the pos covers the stroke', () => {
    const result = normalizeSelectionPoints([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);

    expect(result!.pos).toEqual({ x: -1, y: -1, width: 6, height: 6 });
  });

  it('keeps negative coordinates intact rather than clamping them', () => {
    const result = normalizeSelectionPoints([
      { x: -10, y: -5 },
      { x: -4, y: -5 },
      { x: -4, y: 1 },
    ]);

    expect(result!.pos).toEqual({ x: -11, y: -6, width: 8, height: 8 });
    expect(result!.points[0]).toEqual({ x: 1, y: 1 });
  });
});

describe('createCommittedPolygonSelection', () => {
  it('creates an active committed polygon selection carrying the source tool and metadata', () => {
    const created = createCommittedPolygonSelection({
      id: 'lasso-1',
      points: triangle(),
      sourceTool: 'freehand-lasso',
      metadata: { movedAtVersion: 3 },
    });

    expect(created).toMatchObject({
      id: 'lasso-1',
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'freehand-lasso',
      metadata: { movedAtVersion: 3 },
    });
  });

  it('returns null when the polygon is degenerate', () => {
    expect(
      createCommittedPolygonSelection({
        id: 'x',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        sourceTool: 'polygonal-lasso',
      })
    ).toBeNull();
  });
});

describe('rectangle selection normalization', () => {
  const imageSize: Size = { width: 100, height: 100 };

  it('sorts and trims the rect and derives corner points', () => {
    const result = normalizeRectangleSelectionRect({ x1: 40, y1: 40, x2: 10, y2: 10 }, imageSize);

    expect(result).toEqual({
      pos: { x: 10, y: 10, width: 30, height: 30 },
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
        { x: 0, y: 30 },
      ],
    });
  });

  it('returns null for a rect that collapses to zero width or height', () => {
    expect(normalizeRectangleSelectionRect({ x1: 10, y1: 10, x2: 10, y2: 50 }, imageSize)).toBeNull();
    expect(normalizeRectangleSelectionRect({ x1: 10, y1: 10, x2: 50, y2: 10 }, imageSize)).toBeNull();
  });

  it('trims a rect that extends past the image bounds', () => {
    const result = normalizeRectangleSelectionRect({ x1: -20, y1: -20, x2: 300, y2: 300 }, imageSize);

    expect(result!.pos).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('creates a committed rectangle selection', () => {
    const created = createCommittedRectangleSelection({
      id: 'rect-1',
      rect: { x1: 0, y1: 0, x2: 20, y2: 10 },
      imageSize,
    });

    expect(created).toMatchObject({
      id: 'rect-1',
      isActive: true,
      lifecycle: 'committed',
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
    });
  });

  it('returns null when the rect has no area after trimming', () => {
    expect(
      createCommittedRectangleSelection({ id: 'rect-2', rect: { x1: 5, y1: 5, x2: 5, y2: 5 }, imageSize })
    ).toBeNull();
  });

  it('derives the sorted rect from the selection pos', () => {
    const rect: RectXYSorted = getSelectionRect(selection({ pos: { x: 2, y: 3, width: 4, height: 5 } }));
    expect(rect).toEqual({ x1: 2, y1: 3, x2: 6, y2: 8 });
  });
});

describe('active selection lookup', () => {
  const polygon = selection({ id: 'a' });
  const rect = selection({ id: 'b', geometry: 'rectangle', sourceTool: 'rectangular-selection' });

  it('prefers the explicitly requested id', () => {
    expect(getActiveSelection([polygon, rect], 'b')?.id).toBe('b');
  });

  it('falls back to the first active selection when the id is unknown or null', () => {
    expect(getActiveSelection([polygon, rect], 'missing')?.id).toBe('a');
    expect(getActiveSelection([polygon, rect], null)?.id).toBe('a');
  });

  it('never returns an inactive selection when no id is requested', () => {
    const inactive = selection({ id: 'c', isActive: false });
    expect(getActiveSelection([inactive], null)).toBeNull();
  });

  it.fails('does not return an inactive selection even when its id is explicitly requested', () => {
    const inactive = selection({ id: 'c', isActive: false });
    expect(getActiveSelection([inactive], 'c')).toBeNull();
  });

  it('returns null when there are no selections', () => {
    expect(getActiveSelection([], 'a')).toBeNull();
  });

  it('filters to rectangular geometry only', () => {
    expect(getActiveRectangularSelection([polygon, rect], 'b')?.id).toBe('b');
    expect(getActiveRectangularSelection([polygon, rect], 'a')).toBeNull();
  });
});

describe('getSelectionAbsolutePoints', () => {
  it('offsets normalized points by the selection pos', () => {
    expect(getSelectionAbsolutePoints(selection())).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
    ]);
  });

  it('returns an empty array for a selection with no points', () => {
    expect(getSelectionAbsolutePoints(selection({ points: [] }))).toEqual([]);
  });
});

describe('drawClosedSelectionPath', () => {
  it('strokes a closed path through every point', () => {
    const ctx = makeMockCtx();
    drawClosedSelectionPath(ctx, triangle());

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(2, 2);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 8, 2);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 8, 8);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('draws nothing for fewer than two points', () => {
    const ctx = makeMockCtx();
    drawClosedSelectionPath(ctx, []);
    drawClosedSelectionPath(ctx, [{ x: 1, y: 1 }]);

    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

/** The drawing state a real `save()` pushes and a real `restore()` puts back. */
type OverlayState = {
  alpha: number;
  strokeStyle: CanvasRenderingContext2D['strokeStyle'];
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  lineWidth: number;
  lineDash: number[];
};

/**
 * Installs a REAL state stack on a `makeMockCtx()` context.
 *
 * `makeMockCtx`'s `save` and `restore` are bare `vi.fn()` spies that neither push nor pop
 * anything (`src/__tests__/canvas-mock.ts:22-23`), so a context built from it cannot state
 * what `CanvasRenderingContext2D` states: that the `restore()` closing
 * `drawSelectionOutline` gives the caller back the `globalAlpha` it had. Every method stays a
 * `vi.fn()`, so call counts and `invocationCallOrder` still read off it. The stack covers all
 * five members the outline writes, not just the one the assertions below read: a stack that
 * restored only the member under test would be the same mock-shaped lie, one field narrower.
 * The line dash rides along by pairing `setLineDash` with a `getLineDash` reading the same
 * list, because the shared mock's answers `[]` every time.
 */
function withStateStack(ctx: CanvasRenderingContext2D) {
  let lineDash: number[] = [];
  const stack: OverlayState[] = [];

  ctx.setLineDash = vi.fn((segments: number[]) => {
    lineDash = segments.slice();
  });
  ctx.getLineDash = vi.fn(() => lineDash.slice());
  ctx.save = vi.fn(() => {
    stack.push({
      alpha: ctx.globalAlpha,
      strokeStyle: ctx.strokeStyle,
      fillStyle: ctx.fillStyle,
      lineWidth: ctx.lineWidth,
      lineDash,
    });
  });
  ctx.restore = vi.fn(() => {
    const state = stack.pop();
    if (!state) return;

    ctx.globalAlpha = state.alpha;
    ctx.strokeStyle = state.strokeStyle;
    ctx.fillStyle = state.fillStyle;
    ctx.lineWidth = state.lineWidth;
    lineDash = state.lineDash;
  });

  return ctx;
}

describe('drawSelectionOutline', () => {
  it('draws the dashed path and one anchor per vertex for interactive tools', () => {
    const ctx = makeMockCtx();
    drawSelectionOutline(ctx, selection());

    expect(ctx.setLineDash).toHaveBeenNthCalledWith(1, [6, 4]);
    expect(ctx.setLineDash).toHaveBeenNthCalledWith(2, []);
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(ctx.arc).toHaveBeenCalledWith(5, 5, SELECTION_ANCHOR_RADIUS, 0, Math.PI * 2);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it.each(['freehand-lasso', 'magic-wand'] as const)('omits anchors for %s', (sourceTool) => {
    const ctx = makeMockCtx();
    drawSelectionOutline(ctx, selection({ sourceTool }));

    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.setLineDash).toHaveBeenCalledTimes(1);
  });

  it('resets globalAlpha to 1 before it strokes, inside a bracket that hands the caller its own back', () => {
    // The reset is `resetOverlayAlpha` at `src/util/selection.ts:156` — `ctx.globalAlpha = 1` and
    // nothing else (`src/util/canvas.ts:8-10`). The PRECONDITION is the load-bearing half of this
    // test: `makeMockCtx` initialises `globalAlpha` to 1 (`src/__tests__/canvas-mock.ts:52`), so
    // asserting 1 on a fresh context would pass whether or not the reset existed.
    //
    // The context carries a real state stack, so both halves of the contract are read off the one
    // call: the alpha DURING the draw, and the alpha the caller is left holding.
    const ctx = withStateStack(makeMockCtx());
    ctx.globalAlpha = 0.25;
    let alphaAtStroke: number | undefined;
    ctx.stroke = vi.fn(() => {
      alphaAtStroke = ctx.globalAlpha;
    });

    drawSelectionOutline(ctx, selection());

    // A reset placed after the path was stroked would leave the outline painted at 0.25 while
    // still reading back as 1, so the value has to be sampled during the draw.
    expect(alphaAtStroke).toBe(1);
    // …and what the context is left holding is the CALLER's 0.25, not 1. The reset is inside
    // the bracket, so the `restore()` at `selection.ts:175` undoes it on the way out; a 1 here
    // would be a reset that outlived the bracket that was supposed to contain it.
    expect(ctx.globalAlpha).toBe(0.25);

    // The `save()` is the half `expect(ctx.restore).toHaveBeenCalledTimes(1)` cannot see, and the
    // half the contamination it exists to contain is made of: the tool overlay is ONE 2D context
    // for the whole session and every tool area is handed the same object
    // (`selection.ts:151-155`), so without the `save()` at `:150` the `restore()` at `:175` pops
    // an empty stack and `strokeStyle`, `fillStyle`, `lineWidth`, the dash and the alpha all
    // stay written for the next tool to draw on.
    expect(ctx.save).toHaveBeenCalledTimes(1);
    // The ORDER carries the other half. A `resetOverlayAlpha(ctx)` hoisted ABOVE the `save()`
    // makes all three calls in exactly this order and leaks the alpha just the same, so the call
    // sequence alone cannot separate "reset inside the bracket" from "reset in front of it" —
    // only the state read back above can.
    expect(vi.mocked(ctx.save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ctx.stroke).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(ctx.stroke).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ctx.restore).mock.invocationCallOrder[0]
    );
  });

  it.each(['freehand-lasso', 'magic-wand'] as const)(
    'resets globalAlpha on the anchor-less %s path too',
    (sourceTool) => {
      // These two skip the anchor loop, which is where an early return could have skipped the
      // reset: the per-caller resets this retired were added one tool at a time and were
      // missing the magic wand's, which is the whole reason the reset moved inside the function.
      const ctx = withStateStack(makeMockCtx());
      ctx.globalAlpha = 0.25;
      let alphaAtStroke: number | undefined;
      ctx.stroke = vi.fn(() => {
        alphaAtStroke = ctx.globalAlpha;
      });

      drawSelectionOutline(ctx, selection({ sourceTool }));

      expect(alphaAtStroke).toBe(1);
      // The anchored path and this one share the bracket, so they share the post-condition: the
      // caller gets its own 0.25 back, and the reset leaves with the bracket.
      expect(ctx.globalAlpha).toBe(0.25);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    }
  );

  it('skips inactive selections entirely', () => {
    const ctx = makeMockCtx();
    drawSelectionOutline(ctx, selection({ isActive: false }));

    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('skips degenerate selections with fewer than three points', () => {
    const ctx = makeMockCtx();
    drawSelectionOutline(ctx, selection({ points: [{ x: 0, y: 0 }] }));

    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('converts document points to canvas coordinates when a frame is supplied', () => {
    const ctx = makeMockCtx();
    const frame: DocumentFrame = { x: 100, y: 50, width: 500, height: 400 };
    drawSelectionOutline(ctx, selection(), frame);

    expect(ctx.moveTo).toHaveBeenCalledWith(-95, -45);
    expect(ctx.arc).toHaveBeenCalledWith(-95, -45, SELECTION_ANCHOR_RADIUS, 0, Math.PI * 2);
  });
});

describe('distanceBetweenPoints', () => {
  it('measures the euclidean distance', () => {
    expect(distanceBetweenPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('is zero for identical points and independent of direction', () => {
    expect(distanceBetweenPoints({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
    expect(distanceBetweenPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(
      distanceBetweenPoints({ x: 3, y: 4 }, { x: 0, y: 0 })
    );
  });
});

describe('findSelectionAnchorAtPoint', () => {
  it('returns the index of the anchor within the hit radius', () => {
    const found = findSelectionAnchorAtPoint(selection(), { x: 5 + SELECTION_ANCHOR_HIT_RADIUS, y: 5 });
    expect(found).toBe(0);
  });

  it('returns null when no anchor is within the hit radius', () => {
    expect(findSelectionAnchorAtPoint(selection(), { x: 5, y: 5 + SELECTION_ANCHOR_HIT_RADIUS + 1 })).toBeNull();
  });

  it('returns the first matching anchor when two are inside the radius', () => {
    const tiny = selection({
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ],
      pos: { x: 0, y: 0, width: 2, height: 2 },
    });
    expect(findSelectionAnchorAtPoint(tiny, { x: 1, y: 0 })).toBe(0);
  });

  it.each(['freehand-lasso', 'magic-wand'] as const)('never reports anchors for %s', (sourceTool) => {
    expect(findSelectionAnchorAtPoint(selection({ sourceTool }), { x: 5, y: 5 })).toBeNull();
  });
});

describe('isPointInPolygon', () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('detects interior and exterior points', () => {
    expect(isPointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(isPointInPolygon({ x: -1, y: -1 }, square)).toBe(false);
  });

  it('treats a point on the right edge as outside and the left edge as inside', () => {
    expect(isPointInPolygon({ x: 10, y: 5 }, square)).toBe(false);
    expect(isPointInPolygon({ x: 0, y: 5 }, square)).toBe(true);
  });

  it('applies the same half-open rule on the vertical axis: top edge inside, bottom edge outside', () => {
    // `pi.y > point.y !== pj.y > point.y` (`src/util/selection.ts:202`) is the vertical straddle
    // term, a separate branch of the same predicate from the horizontal comparison above. The
    // horizontal half-open rule was pinned without it, so nothing asserted this half at all.
    expect(isPointInPolygon({ x: 5, y: 0 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 5, y: 10 }, square)).toBe(false);
  });

  it('puts the corners the two axes disagree about on the same side each time', () => {
    // (0,0) is inside on both readings and (10,10) outside on both, which is the pair an axis
    // swap in the straddle term flips. The other two corners are outside, so all four are pinned:
    // a square whose corners were {true, false, false, true} diagonally would be wrong too.
    expect(isPointInPolygon({ x: 0, y: 0 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 10, y: 10 }, square)).toBe(false);
    expect(isPointInPolygon({ x: 10, y: 0 }, square)).toBe(false);
    expect(isPointInPolygon({ x: 0, y: 10 }, square)).toBe(false);
  });

  it('returns false for polygons with fewer than three vertices', () => {
    expect(isPointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(isPointInPolygon({ x: 0, y: 0 }, square.slice(0, 2))).toBe(false);
  });

  it('handles a concave polygon (L shape)', () => {
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(isPointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    expect(isPointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false);
  });
});

describe('getSelectionAtPoint', () => {
  it('returns the topmost active selection containing the point', () => {
    const bottom = selection({ id: 'bottom', pos: { x: 0, y: 0, width: 20, height: 20 } });
    const top = selection({ id: 'top', pos: { x: 0, y: 0, width: 20, height: 20 } });
    expect(getSelectionAtPoint([bottom, top], { x: 5, y: 5 })?.id).toBe('top');
  });

  it('skips inactive selections even when they contain the point', () => {
    const inactive = selection({ id: 'inactive', isActive: false });
    expect(getSelectionAtPoint([inactive], { x: 5, y: 5 })).toBeNull();
  });

  it('returns null when the point is outside every selection', () => {
    expect(getSelectionAtPoint([selection()], { x: 500, y: 500 })).toBeNull();
  });
});

describe('moveSelectionAnchor', () => {
  it('renormalizes a polygon and bumps movedAtVersion', () => {
    const moved = moveSelectionAnchor(selection({ metadata: { movedAtVersion: 2 } }), 1, { x: 20, y: 12 });

    expect(moved.pos).toEqual({ x: 4, y: 4, width: 17, height: 12 });
    expect(moved.points).toEqual([
      { x: 1, y: 1 },
      { x: 16, y: 8 },
      { x: 11, y: 11 },
    ]);
    expect(moved.metadata?.movedAtVersion).toBe(3);
  });

  it('starts movedAtVersion at 1 when it was previously undefined', () => {
    const moved = moveSelectionAnchor(selection(), 0, { x: 6, y: 6 });
    expect(moved.metadata?.movedAtVersion).toBe(1);
  });

  it('rebuilds corner points for rectangle geometry and keeps the id', () => {
    const rect = selection({
      id: 'rect-move',
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
      pos: { x: 5, y: 5, width: 10, height: 10 },
    });
    const moved = moveSelectionAnchor(rect, 2, { x: 30, y: 9 });

    expect(moved.id).toBe('rect-move');
    expect(moved.pos).toEqual({ x: 5, y: 5, width: 25, height: 4 });
    expect(moved.points).toEqual([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it('mirrors a rectangle anchor dragged past the opposite corner instead of rejecting the drag', () => {
    // The polygon arm bails out of a degenerate drag at `src/util/selection.ts:252`
    // (`if (!normalized) return selection;`); the rectangle arm at `:232-248` has no counterpart,
    // so the drag is accepted and the box is re-derived from min/max by `pointsBoundingPos`
    // (`src/util/draw.ts:6-27`, called with `lineWidth: 0`).
    //
    // The consequence is that the anchor is NOT where it was dropped. The box grows to contain
    // the drop point, but index 0 is rebuilt as its top-left, so the corner the user is holding
    // has ended up at the opposite corner of a larger rectangle. Whether that mirroring is
    // desirable is the owner's call, not a defect; the point of the pin is that today nothing
    // stated it, so it could change silently.
    const rect = selection({
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
      pos: { x: 5, y: 5, width: 10, height: 10 },
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      metadata: { movedAtVersion: 4 },
    });

    const moved = moveSelectionAnchor(rect, 0, { x: 25, y: 25 });

    expect(moved.pos).toEqual({ x: 5, y: 5, width: 20, height: 20 });
    expect(moved.points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]);
    expect(moved.metadata?.movedAtVersion).toBe(5);
    // Index 0 is the top-left of the rebuilt box, not the (25, 25) the drag was dropped at.
    expect(getSelectionAbsolutePoints(moved)[0]).toEqual({ x: 5, y: 5 });
  });

  it('keeps an already-collapsed rectangle collapsed, and never yields a negative extent', () => {
    // `pointsBoundingPos` returns `maxX - minX`, which a min/max pair cannot make negative, so a
    // drag along a collapsed axis holds that axis at exactly zero while the other one tracks.
    //
    // The starting selection is already collapsed, and that is the only reachable way in: three
    // corners of a non-degenerate rectangle are never collinear and never share a coordinate, so
    // moving the fourth can neither flatten the box nor collapse it. `normalizeRectangleSelectionRect`
    // refuses to build a collapsed rectangle in the first place (`src/util/selection.ts:62`), which
    // is what makes this state a pin on `moveSelectionAnchor` rather than on construction.
    const collapsed = selection({
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
      pos: { x: 5, y: 5, width: 0, height: 10 },
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 0, y: 10 },
      ],
    });

    const moved = moveSelectionAnchor(collapsed, 0, { x: 5, y: 3 });

    expect(moved.pos).toEqual({ x: 5, y: 3, width: 0, height: 12 });
    expect(moved.points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 12 },
      { x: 0, y: 12 },
    ]);
    // A drag that leaves the shape degenerate still counts as a move, so the writers' own
    // `hasSameSelectionGeometry` guard is what suppresses the commit, not the version counter.
    expect(moved.metadata?.movedAtVersion).toBe(1);
  });

  it('returns the original selection unchanged for an out-of-range anchor index', () => {
    const original = selection();
    expect(moveSelectionAnchor(original, 99, { x: 0, y: 0 })).toBe(original);
    expect(moveSelectionAnchor(original, -1, { x: 0, y: 0 })).toBe(original);
  });

  it('returns the original selection when the remaining points can no longer form a polygon', () => {
    const single = selection({ points: [{ x: 0, y: 0 }] });
    expect(moveSelectionAnchor(single, 0, { x: 9, y: 9 })).toBe(single);
  });

  it('does not mutate the input selection', () => {
    const original = selection();
    const before = structuredClone(original);
    moveSelectionAnchor(original, 1, { x: 99, y: 99 });
    expect(original).toEqual(before);
  });
});

describe('moveSelectionByDelta', () => {
  it('offsets the pos and bumps movedAtVersion while keeping points relative', () => {
    const moved = moveSelectionByDelta(selection({ metadata: { copiedAtVersion: 4, movedAtVersion: 1 } }), {
      x: -3,
      y: 7,
    });

    expect(moved.pos).toEqual({ x: 2, y: 12, width: 10, height: 10 });
    expect(moved.points).toEqual(selection().points);
    expect(moved.metadata).toEqual({ copiedAtVersion: 4, movedAtVersion: 2 });
  });
});

describe('canvas snapshot helpers', () => {
  const imageSize: Size = { width: 100, height: 100 };

  beforeEach(() => {
    readBacks.length = 0;
    constructed.length = 0;
    installOffscreenCanvas();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clones a bitmap into a same-size canvas via a single drawImage at the origin', () => {
    const source = makeMockOffscreenCanvas(40, 20);
    const result = cloneBitmapToCanvas(source);
    const destination = firstConstructed();

    expect(result).toBe(destination);
    expect(result).toBeInstanceOf(FakeOffscreenCanvas);
    expect(destination.width).toBe(40);
    expect(destination.height).toBe(20);
    expect(destination.contexts[0].drawImage).toHaveBeenCalledWith(source, 0, 0);
  });

  it('falls back to an HTMLCanvasElement when OffscreenCanvas is unavailable', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const result = cloneBitmapToCanvas(makeMockCanvas(12.2, 5.1));

    expect(result).toBeInstanceOf(HTMLCanvasElement);
    expect(result.width).toBe(13);
    expect(result.height).toBe(6);
  });

  describe('copyPolygonSelectionToCanvas', () => {
    it('clips to the polygon and reports the untrimmed polygon bounds', () => {
      const result = copyPolygonSelectionToCanvas(makeMockCanvas(40, 40), triangle());

      expect(result!.pos).toEqual({ x: 2, y: 2, width: 6, height: 6 });
      expect(result!.bitmap.width).toBe(6);
      expect(result!.bitmap.height).toBe(6);

      const ctx = firstConstructed().contexts[0];
      expect(ctx.save).toHaveBeenCalledTimes(1);
      expect(ctx.restore).toHaveBeenCalledTimes(1);
      expect(ctx.clip).toHaveBeenCalledTimes(1);
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
      expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -2, -2);
    });

    it('clamps the bounds to the supplied image size', () => {
      const result = copyPolygonSelectionToCanvas(
        makeMockCanvas(100, 100),
        [
          { x: 95, y: 95 },
          { x: 120, y: 95 },
          { x: 120, y: 120 },
        ],
        { imageSize }
      );

      expect(result!.pos).toEqual({ x: 95, y: 95, width: 5, height: 5 });
      expect(result!.bitmap.width).toBe(5);
    });

    it('returns null for a degenerate polygon', () => {
      expect(
        copyPolygonSelectionToCanvas(makeMockCanvas(10, 10), [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ])
      ).toBeNull();
    });

    it('returns null when clamping collapses the polygon outside the image', () => {
      const result = copyPolygonSelectionToCanvas(
        makeMockCanvas(10, 10),
        [
          { x: -20, y: -20 },
          { x: -10, y: -20 },
          { x: -10, y: -10 },
        ],
        { imageSize }
      );

      expect(result).toBeNull();
    });

    it('never touches a 2D context for an empty point list', () => {
      const fallback = copyPolygonToCanvas(makeMockCanvas(10, 10), []);

      expect(fallback.width).toBe(1);
      expect(fallback.height).toBe(1);
      expect(firstConstructed().contexts).toHaveLength(0);
    });

    it('copyPolygonToCanvas returns the same bitmap as the snapshot variant', () => {
      const source = makeMockCanvas(40, 40);
      const bitmap = copyPolygonToCanvas(source, triangle());
      const snapshot = copyPolygonSelectionToCanvas(source, triangle());

      expect(bitmap.width).toBe(snapshot!.bitmap.width);
      expect(bitmap.height).toBe(snapshot!.bitmap.height);
    });
  });

  describe('copyRectSelectionToCanvas', () => {
    it('copies the trimmed rect into a canvas of the trimmed size', () => {
      const source = makeMockCanvas(100, 100);
      const result = copyRectSelectionToCanvas(source, { x1: 10, y1: 20, x2: 40, y2: 60 }, imageSize);

      expect(result!.pos).toEqual({ x: 10, y: 20, width: 30, height: 40 });
      expect(result!.bitmap.width).toBe(30);
      expect(result!.bitmap.height).toBe(40);
      expect(firstConstructed().contexts[0].drawImage).toHaveBeenCalledWith(source, 10, 20, 30, 40, 0, 0, 30, 40);
    });

    it('trims a rect that overflows the image before copying', () => {
      const result = copyRectSelectionToCanvas(
        makeMockCanvas(50, 50),
        { x1: -10, y1: -10, x2: 90, y2: 90 },
        { width: 50, height: 50 }
      );

      expect(result!.pos).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    });

    it('returns null for a zero-area rect', () => {
      expect(copyRectSelectionToCanvas(makeMockCanvas(10, 10), { x1: 5, y1: 5, x2: 5, y2: 5 }, imageSize)).toBeNull();
    });
  });

  describe('copyFeatheredPolygonSelectionToCanvas', () => {
    it('pads the bounds by one pixel for anti-aliasing and writes the feathered alpha channel', () => {
      const source = makeMockCanvas(40, 40);
      const result = copyFeatheredPolygonSelectionToCanvas(source, triangle(), { featherRadius: 0 });

      expect(result!.pos).toEqual({ x: 1, y: 1, width: 8, height: 8 });
      expect(result!.bitmap.width).toBe(8);

      const ctx = firstConstructed().contexts[0];
      expect(ctx.drawImage).toHaveBeenCalledWith(source, 1, 1, 8, 8, 0, 0, 8, 8);
      expect(ctx.putImageData).toHaveBeenCalledTimes(1);

      const written = ctx.putImageData.mock.calls[0][0] as ImageData;
      expect(written.width).toBe(8);
      expect(written.data.length).toBe(8 * 8 * 4);
    });

    it('uses only the feather radius for padding when anti-aliasing is disabled', () => {
      const result = copyFeatheredPolygonSelectionToCanvas(makeMockCanvas(40, 40), triangle(), {
        antiAlias: false,
        featherRadius: 3,
      });

      expect(result!.pos).toEqual({ x: -1, y: -1, width: 12, height: 12 });
    });

    it('expands padding to the larger of the anti-alias pixel and the feather radius', () => {
      const result = copyFeatheredPolygonSelectionToCanvas(makeMockCanvas(40, 40), triangle(), {
        featherRadius: 5.2,
      });

      expect(result!.pos).toEqual({ x: -4, y: -4, width: 18, height: 18 });
    });

    it('clamps the padded bounds to the image size', () => {
      const result = copyFeatheredPolygonSelectionToCanvas(
        makeMockCanvas(20, 20),
        [
          { x: 2, y: 2 },
          { x: 18, y: 2 },
          { x: 18, y: 18 },
        ],
        { featherRadius: 4, imageSize: { width: 20, height: 20 } }
      );

      expect(result!.pos).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    });

    it('returns null for a degenerate polygon', () => {
      expect(copyFeatheredPolygonSelectionToCanvas(makeMockCanvas(10, 10), [{ x: 0, y: 0 }])).toBeNull();
    });

    it('falls back to a 1x1 canvas through the bitmap-only wrapper', () => {
      const bitmap = copyFeatheredPolygonToCanvas(makeMockCanvas(10, 10), []);

      expect(bitmap.width).toBe(1);
      expect(bitmap.height).toBe(1);
    });

    it('derives the feather mask from the canvas read-back alpha channel', () => {
      readBacks.push('all-opaque', 'left-half-opaque');
      copyFeatheredPolygonSelectionToCanvas(
        makeMockCanvas(20, 20),
        [
          { x: 2, y: 2 },
          { x: 17, y: 2 },
          { x: 17, y: 17 },
        ],
        { featherRadius: 0, imageSize: { width: 20, height: 20 } }
      );

      const ctx = firstConstructed().contexts[0];
      const written = ctx.putImageData.mock.calls[0][0] as ImageData;
      const alphaAt = (x: number, y: number) => written.data[(y * written.width + x) * 4 + 3];

      expect(alphaAt(1, 1)).toBe(255);
      expect(alphaAt(9, 1)).toBe(0);
      expect(alphaAt(1, 9)).toBe(255);
    });

    it('rasterizes the mask on the CPU when canvas read-back throws', () => {
      readBacks.push('all-opaque', 'throw');
      const result = copyFeatheredPolygonSelectionToCanvas(
        makeMockCanvas(20, 20),
        [
          { x: 4, y: 4 },
          { x: 14, y: 4 },
          { x: 14, y: 14 },
        ],
        { featherRadius: 0, imageSize: { width: 20, height: 20 } }
      );

      expect(result!.pos).toEqual({ x: 3, y: 3, width: 12, height: 12 });

      const ctx = firstConstructed().contexts[0];
      const written = ctx.putImageData.mock.calls[0][0] as ImageData;
      const alphaAt = (x: number, y: number) => written.data[(y * written.width + x) * 4 + 3];

      // The padded canvas origin is (3,3), so the triangle occupies (1,1)-(11,11) in it
      // and its interior is the region above the (1,1)-(11,11) diagonal.
      expect(alphaAt(8, 3)).toBeGreaterThan(0);
      expect(alphaAt(3, 8)).toBe(0);
      expect(alphaAt(0, 0)).toBe(0);
    });

    it('returns null when the padded bounds collapse against the image size', () => {
      // The origin is clamped to zero and the far edge to the image size, but the
      // origin itself is only clamped from below, so a polygon entirely outside the
      // image produces a negative extent and no destination canvas at all.
      const result = copyFeatheredPolygonSelectionToCanvas(
        makeMockCanvas(20, 20),
        [
          { x: 50, y: 50 },
          { x: 60, y: 50 },
          { x: 60, y: 60 },
        ],
        { featherRadius: 2, imageSize: { width: 10, height: 10 } }
      );

      expect(result).toBeNull();
      // No destination canvas is allocated at all, so nothing is ever drawn.
      expect(constructed).toHaveLength(0);
    });
  });

  describe('copySelectionToCanvas dispatch', () => {
    const dispatchImageSize: Size = { width: 100, height: 100 };

    it('returns null when there is no source canvas', () => {
      expect(copySelectionToCanvas(null, selection(), imageSize)).toBeNull();
      expect(copySelectionToCanvas(undefined, selection(), imageSize)).toBeNull();
    });

    it('routes rectangle geometry through the rect copier using the selection pos', () => {
      const result = copySelectionToCanvas(
        makeMockCanvas(100, 100),
        selection({
          geometry: 'rectangle',
          sourceTool: 'rectangular-selection',
          pos: { x: 4, y: 6, width: 12, height: 8 },
        }),
        dispatchImageSize
      );

      expect(result!.pos).toEqual({ x: 4, y: 6, width: 12, height: 8 });
    });

    it('routes feather-magnetic-lasso through the feathered copier and forwards its options', () => {
      const result = copySelectionToCanvas(
        makeMockCanvas(100, 100),
        selection({
          sourceTool: 'feather-magnetic-lasso',
          metadata: {
            featherRadius: 4,
            magneticLasso: {
              width: 18,
              contrast: 30,
              frequency: 40,
              snapStrength: 0.85,
              smoothing: 1.5,
              antiAlias: false,
              pathPointCount: 3,
            },
          },
        }),
        dispatchImageSize
      );

      // antiAlias: false => no 1px pad, featherRadius 4 => 4px pad around the polygon
      expect(result!.pos).toEqual({ x: 1, y: 1, width: 18, height: 18 });
    });

    it('defaults feather options when the magnetic lasso metadata is absent', () => {
      const result = copySelectionToCanvas(
        makeMockCanvas(100, 100),
        selection({ sourceTool: 'feather-magnetic-lasso' }),
        dispatchImageSize
      );

      // antiAlias defaults to true, featherRadius defaults to 0 => 1px pad
      expect(result!.pos).toEqual({ x: 4, y: 4, width: 12, height: 12 });
    });

    it('routes every other tool through the plain polygon copier', () => {
      const result = copySelectionToCanvas(
        makeMockCanvas(100, 100),
        selection({ sourceTool: 'magic-wand' }),
        dispatchImageSize
      );

      expect(result!.pos).toEqual({ x: 5, y: 5, width: 10, height: 10 });
    });

    it('returns null for a selection whose polygon cannot be rasterized', () => {
      expect(
        copySelectionToCanvas(
          makeMockCanvas(100, 100),
          selection({ sourceTool: 'polygonal-lasso', points: [] }),
          dispatchImageSize
        )
      ).toBeNull();
    });
  });
});

describe('mask rasterization on the HTMLCanvasElement fallback path', () => {
  const imageSize: Size = { width: 20, height: 20 };
  const triangleIn20: Point[] = [
    { x: 4, y: 4 },
    { x: 14, y: 4 },
    { x: 14, y: 14 },
  ];

  const copyWithDomContexts = (contexts: RecordedCtx[]) => {
    const result = copyFeatheredPolygonSelectionToCanvas(makeMockCanvas(20, 20), triangleIn20, {
      featherRadius: 0,
      imageSize,
    });

    expect(result!.pos).toEqual({ x: 3, y: 3, width: 12, height: 12 });
    expect(contexts[0].putImageData).toHaveBeenCalledTimes(1);

    const written = contexts[0].putImageData.mock.calls[0][0] as ImageData;
    return (x: number, y: number) => written.data[(y * written.width + x) * 4 + 3];
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('takes the GPU read-back branch when both canvases read back', () => {
    const alphaAt = copyWithDomContexts(installPixelDomContexts(['all-opaque', 'left-half-opaque']));

    // The mask canvas reads back opaque only on its left half, so the right half of
    // the top row is cleared even though the destination canvas was fully opaque.
    // A CPU-rasterized mask would have kept those pixels, so this pins the branch.
    expect(alphaAt(1, 1)).toBe(255);
    expect(alphaAt(9, 1)).toBe(0);
  });

  it('takes the CPU fallback when only the mask read-back throws', () => {
    const alphaAt = copyWithDomContexts(installPixelDomContexts(['all-opaque', 'throw']));

    // The mask now comes from the polygon rather than from the canvas, so the whole
    // region above the (1,1)-(11,11) diagonal survives.
    expect(alphaAt(8, 3)).toBe(255);
    expect(alphaAt(3, 8)).toBe(0);
    expect(alphaAt(0, 0)).toBe(0);
  });

  it('rasterizes the mask on the CPU when the mask canvas has no 2D context at all', () => {
    const contexts = installPixelDomContexts(['all-opaque', 'no-context']);
    const alphaAt = copyWithDomContexts(contexts);

    expect(contexts).toHaveLength(1);
    expect(alphaAt(8, 3)).toBe(255);
    expect(alphaAt(3, 8)).toBe(0);
  });
});

describe('null 2D context handling', () => {
  const imageSize: Size = { width: 100, height: 100 };

  const installNullContext = () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  };

  /** The last error handed to `console.error`, typed as the named failure it must be. */
  const loggedContextError = (spy: Mock): SelectionCanvasContextError =>
    spy.mock.calls.at(-1)?.[0] as SelectionCanvasContextError;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cloneBitmapToCanvas throws a named context error that names the operation', () => {
    installNullContext();
    const source = makeMockCanvas(4, 4);

    // The return type is a `ClipboardCanvas`, so there is no in-band failure channel.
    // Both production callers catch, log and return false, so the throw is recoverable —
    // but it must be the named error, not a TypeError from inside `drawImage`.
    expect(() => cloneBitmapToCanvas(source)).toThrow(SelectionCanvasContextError);
    expect(() => cloneBitmapToCanvas(source)).not.toThrow(TypeError);
    expect(() => cloneBitmapToCanvas(source)).toThrow(
      /cloneBitmapToCanvas: the 4x4 selection canvas returned no 2D context/
    );
  });

  it('copyPolygonSelectionToCanvas returns no snapshot and logs the operation instead of throwing', () => {
    installNullContext();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = makeMockCanvas(40, 40);
    let result: SelectionCanvasSnapshot | null = null;

    expect(() => {
      result = copyPolygonSelectionToCanvas(source, triangle());
    }).not.toThrow(TypeError);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loggedContextError(errorSpy)).toBeInstanceOf(SelectionCanvasContextError);
    expect(loggedContextError(errorSpy).operation).toBe('copyPolygonSelectionToCanvas');
  });

  it('copyFeatheredPolygonSelectionToCanvas returns no snapshot and logs the operation instead of throwing', () => {
    installNullContext();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = makeMockCanvas(40, 40);
    let result: SelectionCanvasSnapshot | null = null;

    expect(() => {
      result = copyFeatheredPolygonSelectionToCanvas(source, triangle());
    }).not.toThrow(TypeError);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loggedContextError(errorSpy)).toBeInstanceOf(SelectionCanvasContextError);
    expect(loggedContextError(errorSpy).operation).toBe('copyFeatheredPolygonSelectionToCanvas');
  });

  it('copyRectSelectionToCanvas returns no snapshot and logs the operation instead of throwing', () => {
    installNullContext();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = makeMockCanvas(100, 100);
    let result: SelectionCanvasSnapshot | null = null;

    expect(() => {
      result = copyRectSelectionToCanvas(source, { x1: 0, y1: 0, x2: 10, y2: 10 }, imageSize);
    }).not.toThrow(TypeError);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loggedContextError(errorSpy)).toBeInstanceOf(SelectionCanvasContextError);
    expect(loggedContextError(errorSpy).operation).toBe('copyRectSelectionToCanvas');
  });

  it('copySelectionToCanvas reports the failure in band for every geometry the dispatch can reach', () => {
    installNullContext();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = makeMockCanvas(100, 100);

    // `copySelection` in src/contexts/useSelectionClipboard.ts turns a null snapshot into
    // `false`, which the selection toolbars render as a failure message. A throw here
    // would escape past that channel into a React event handler instead.
    const results = [
      copySelectionToCanvas(
        source,
        selection({ geometry: 'rectangle', sourceTool: 'rectangular-selection' }),
        imageSize
      ),
      copySelectionToCanvas(source, selection({ sourceTool: 'feather-magnetic-lasso' }), imageSize),
      copySelectionToCanvas(source, selection({ sourceTool: 'magic-wand' }), imageSize),
    ];

    expect(results).toEqual([null, null, null]);
    expect(errorSpy.mock.calls.map(([error]) => (error as SelectionCanvasContextError).operation)).toEqual([
      'copyRectSelectionToCanvas',
      'copyFeatheredPolygonSelectionToCanvas',
      'copyPolygonSelectionToCanvas',
    ]);
  });

  it('the bitmap-only wrappers throw the named error rather than degrading to an empty 1x1 canvas', () => {
    installNullContext();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A `ClipboardCanvas` return has no in-band failure channel, and every consumer of
    // one commits it as a layer's `tmpCanvas` -- `tempUpdateLayer`, the `kind: 'tool'`
    // arm of `createLayerSource` and `applyRasterTool` all take it unchecked, and
    // `layer-renderer.ts` rejects only zero dimensions. A blank 1x1 fallback would
    // therefore be committed as a permanently transparent layer instead of failing.
    expect(() => copyPolygonToCanvas(makeMockCanvas(40, 40), triangle())).toThrow(SelectionCanvasContextError);
    expect(() => copyPolygonToCanvas(makeMockCanvas(40, 40), triangle())).not.toThrow(TypeError);
    expect(() => copyPolygonToCanvas(makeMockCanvas(40, 40), triangle())).toThrow(
      /copyPolygonToCanvas: the 6x6 selection canvas returned no 2D context/
    );
    expect(() => copyFeatheredPolygonToCanvas(makeMockCanvas(40, 40), triangle())).toThrow(SelectionCanvasContextError);
    expect(() => copyFeatheredPolygonToCanvas(makeMockCanvas(40, 40), triangle())).not.toThrow(TypeError);
    expect(() => copyFeatheredPolygonToCanvas(makeMockCanvas(40, 40), triangle())).toThrow(
      /copyFeatheredPolygonToCanvas: the 8x8 selection canvas returned no 2D context/
    );

    // The underlying snapshot functions still report the same failure in band, so the
    // cause stays readable on the path whose consumers do test for null.
    expect(errorSpy.mock.calls.map(([error]) => (error as SelectionCanvasContextError).operation)).toEqual([
      'copyPolygonSelectionToCanvas',
      'copyPolygonSelectionToCanvas',
      'copyPolygonSelectionToCanvas',
      'copyFeatheredPolygonSelectionToCanvas',
      'copyFeatheredPolygonSelectionToCanvas',
      'copyFeatheredPolygonSelectionToCanvas',
    ]);
  });

  it('still returns the empty 1x1 canvas for a degenerate polygon, which is a state and not a failure', () => {
    installNullContext();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Every lasso tool seeds `points: []` and a click commits the tool, so the wrappers
    // must keep handing back a canvas when there is genuinely nothing to copy. This is
    // the one case where the placeholder is the answer rather than a silent failure.
    const polygon = copyPolygonToCanvas(makeMockCanvas(40, 40), []);
    const feathered = copyFeatheredPolygonToCanvas(makeMockCanvas(40, 40), []);

    expect([polygon.width, polygon.height]).toEqual([1, 1]);
    expect([feathered.width, feathered.height]).toEqual([1, 1]);
  });
});

describe('copyCanvasToClipboard', () => {
  const pngBlob = () => new Blob(['png'], { type: 'image/png' });
  let write: ReturnType<typeof vi.fn>;

  const offscreenWithBlob = (size: number) => {
    const canvas = makeMockOffscreenCanvas(size, size);
    vi.mocked(canvas.convertToBlob).mockResolvedValue(pngBlob());
    return canvas;
  };

  beforeEach(() => {
    write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', ClipboardItemStub);
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
  });

  it('serializes an OffscreenCanvas with convertToBlob and writes a single clipboard item', async () => {
    const canvas = offscreenWithBlob(4);
    await copyCanvasToClipboard(canvas);

    expect(canvas.convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
    expect(write).toHaveBeenCalledTimes(1);

    const [items] = write.mock.calls[0] as [ClipboardItemStub[]];
    expect(items).toHaveLength(1);
    expect(items[0].types).toEqual(['image/png']);
  });

  it('serializes an HTMLCanvasElement with toBlob and preserves the blob type as the item mime', async () => {
    const blob = pngBlob();
    const toBlob = vi.fn((callback: Parameters<HTMLCanvasElement['toBlob']>[0]) => callback(blob));
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = toBlob;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      await copyCanvasToClipboard(canvas);

      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
      const [items] = write.mock.calls[0] as [ClipboardItemStub[]];
      expect(items[0].items['image/png']).toBe(blob);
    } finally {
      HTMLCanvasElement.prototype.toBlob = original;
    }
  });

  it('rejects when toBlob yields a null blob', async () => {
    const toBlob = vi.fn((callback: Parameters<HTMLCanvasElement['toBlob']>[0]) => callback(null));
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = toBlob;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const canvas = document.createElement('canvas');
      await expect(copyCanvasToClipboard(canvas)).rejects.toThrow('Failed to serialize canvas');
      expect(write).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      HTMLCanvasElement.prototype.toBlob = original;
    }
  });

  it('rethrows the original error when the clipboard write rejects', async () => {
    const denial = new Error('clipboard denied');
    write.mockRejectedValue(denial);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(copyCanvasToClipboard(offscreenWithBlob(1))).rejects.toBe(denial);
    expect(errorSpy).toHaveBeenCalledWith('Failed to copy to clipboard:', denial);
  });

  it('surfaces a missing navigator.clipboard instead of throwing a TypeError', async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(copyCanvasToClipboard(offscreenWithBlob(1))).rejects.toThrow(TypeError);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('selection geometry helpers used by the copy path', () => {
  it('keeps pos and points consistent for a selection built from points', () => {
    const created = createCommittedPolygonSelection({
      id: 'consistency',
      points: triangle(1),
      sourceTool: 'polygonal-lasso',
    })!;

    const pos: Pos = created.pos;
    expect(pos).toEqual({ x: 2, y: 2, width: 8, height: 8 });
    expect(getSelectionAbsolutePoints(created)).toEqual(triangle(1));
  });
});

describe('moveSelectionByDelta metadata defaults', () => {
  it('starts movedAtVersion at 1 when the selection carries no metadata at all', () => {
    const moved = moveSelectionByDelta(selection({ metadata: undefined }), { x: 1, y: 1 });

    expect(moved.metadata).toEqual({ movedAtVersion: 1 });
    expect(moved.pos).toEqual({ x: 6, y: 6, width: 10, height: 10 });
  });

  it('preserves unrelated metadata keys while bumping the version', () => {
    const moved = moveSelectionByDelta(selection({ metadata: { featherRadius: 8 } }), { x: 0, y: 0 });

    expect(moved.metadata).toEqual({ featherRadius: 8, movedAtVersion: 1 });
  });
});

describe('hasSameSelectionGeometry', () => {
  it('reports a zero-delta move as the same geometry even though the builders bumped metadata', () => {
    const base = selection({ metadata: { movedAtVersion: 4 } });

    // The property the drag commit depends on: the move builders bump
    // `movedAtVersion` on every call, so a deep comparison — and therefore the
    // selection writers' own deep-equal guard — cannot tell this from a real move.
    expect(moveSelectionByDelta(base, { x: 0, y: 0 })).not.toEqual(base);
    expect(hasSameSelectionGeometry(base, moveSelectionByDelta(base, { x: 0, y: 0 }))).toBe(true);
  });

  it('reports an anchor dragged back onto itself as the same geometry', () => {
    // Built through the committing constructor, because re-normalization is only
    // a fixed point for a selection that is already in normalized form — which is
    // what every committed polygon in production is, and what the hand-built
    // `selection()` fixture above is not.
    const base = createCommittedPolygonSelection({
      id: 'sel-1',
      points: triangle(),
      sourceTool: 'polygonal-lasso',
    })!;
    const [firstAnchor] = getSelectionAbsolutePoints(base);

    expect(moveSelectionAnchor(base, 0, firstAnchor)).not.toEqual(base);
    expect(hasSameSelectionGeometry(base, moveSelectionAnchor(base, 0, firstAnchor))).toBe(true);
    // A genuinely reshaped anchor is still reported as a change, which is the
    // property the commit gate must not lose.
    expect(hasSameSelectionGeometry(base, moveSelectionAnchor(base, 0, { x: 0, y: 40 }))).toBe(false);
  });

  it('is true for one object compared with itself', () => {
    const base = selection();

    expect(hasSameSelectionGeometry(base, base)).toBe(true);
  });

  it.each([
    ['a moved pos', { pos: { x: 6, y: 5, width: 10, height: 10 } }],
    ['a resized pos', { pos: { x: 5, y: 5, width: 11, height: 10 } }],
    [
      'a moved anchor',
      {
        points: [
          { x: 1, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ],
    [
      'a different point count',
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ],
    [
      'a moved point',
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 1 },
          { x: 10, y: 10 },
        ],
      },
    ],
  ])('is false for %s', (_label, overrides) => {
    expect(hasSameSelectionGeometry(selection(), selection(overrides as Partial<Selection>))).toBe(false);
  });
});
