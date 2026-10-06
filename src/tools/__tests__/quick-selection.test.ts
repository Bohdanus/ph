import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { makeMockImageData } from '../../__tests__/canvas-mock.ts';
import {
  QUICK_SELECTION_SOURCE_TOOL,
  createQuickSelectionAccumulator,
  createQuickSelectionPolygon,
  growAlongStroke,
  isQuickSelectionMode,
  rasterizeSelectionMask,
  sampleStrokeSeeds,
  traceMaskBoundary,
  type QuickSelectionAccumulator,
} from '../quickSelection.ts';
import { floodFill } from '../../util/flood-fill.ts';
import { isPointInPolygon } from '../../util/selection.ts';
import type { Point } from '../../contexts/general-types.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext>;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this });
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const bitmap = createMockImageBitmap(40, 24);

const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 200, 255];

function setPixel(imageData: ImageData, x: number, y: number, color: [number, number, number, number]) {
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = color[0];
  imageData.data[index + 1] = color[1];
  imageData.data[index + 2] = color[2];
  imageData.data[index + 3] = color[3];
}

function fillRect(
  imageData: ImageData,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: [number, number, number, number]
) {
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      setPixel(imageData, x, y, color);
    }
  }
}

function solidImage(width: number, height: number, color: [number, number, number, number]): ImageData {
  return fillAll(makeMockImageData(width, height), color);
}

function fillAll(imageData: ImageData, color: [number, number, number, number]): ImageData {
  for (let index = 0; index < imageData.width * imageData.height; index++) {
    imageData.data[index * 4] = color[0];
    imageData.data[index * 4 + 1] = color[1];
    imageData.data[index * 4 + 2] = color[2];
    imageData.data[index * 4 + 3] = color[3];
  }

  return imageData;
}

function countSelected(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) {
    if (value === 1) count += 1;
  }

  return count;
}

function isSelected(mask: Uint8Array, width: number, x: number, y: number): boolean {
  return mask[y * width + x] === 1;
}

/** 12x4: a red block under the left end, a blue block under the right end, black between. */
function createTwoBlocks(): ImageData {
  const imageData = solidImage(12, 4, BLACK);
  fillRect(imageData, 0, 0, 3, 3, RED);
  fillRect(imageData, 8, 0, 11, 3, BLUE);

  return imageData;
}

/**
 * 12x1: red at 0..3, black at 4..7, red again at 8..11.
 *
 * The two runs are the SAME colour, so only connectivity separates them. A stroke over the
 * first must therefore select four pixels and not sixteen, which is what pins the grow to
 * a contiguous region rather than a global colour match.
 */
function createTwoSameColourBlocks(): ImageData {
  const imageData = solidImage(12, 1, BLACK);
  fillRect(imageData, 0, 0, 3, 0, RED);
  fillRect(imageData, 8, 0, 11, 0, RED);

  return imageData;
}

/**
 * 8x1: red at 0..2, one black pixel at 3, red again at 4..7.
 *
 * The two red runs are 4-disconnected, so a fill from either side stops at the black
 * pixel and the pointer crossing the gap is the "thin edge crossed too quickly" case: a
 * re-seeded fill's masks do not imply one another, and the only result that keeps both
 * runs is their union.
 */
function createSplitBlocks(): ImageData {
  const imageData = solidImage(8, 1, RED);
  setPixel(imageData, 3, 0, BLACK);

  return imageData;
}

/** Every pixel between `from` and `to` inclusive, as a stroke. */
function strokePoints(from: Point, to: Point): Point[] {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  const points: Point[] = [];
  for (let step = 0; step <= steps; step++) {
    points.push({
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
  }

  return points;
}

/**
 * A stroke sampled at one seed per pixel: at a diameter of 1 and a spacing of 100% the
 * arc-length step is exactly 1px, so the tests that care about WHICH seeds were used are
 * never testing the sampler.
 */
const grow = (
  accumulator: QuickSelectionAccumulator,
  imageData: ImageData,
  points: Point[],
  options: { tolerance: number; mode: 'add' | 'subtract' }
) => growAlongStroke(accumulator, imageData, sampleStrokeSeeds(points, 1, 100), options);

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `src/tools/quickSelection.ts` publishes the quick selection arg contract and the region
 * growing the tool area commits from. The processor is a pass-through like every other
 * selection tool's, so what is worth pinning is the union — the part a re-seeded fill
 * cannot give for free — and the mask-to-polygon trace it feeds.
 */
describe('quickSelection type contract', () => {
  it('declares settings as exactly the arg fields, stamped with its own tool name', () => {
    const settings = defaultSettings['quick-selection'];

    expect(Object.keys(settings).sort()).toEqual(['alpha', 'mode', 'size', 'tolerance', 'toolName']);
    expect(settings.toolName).toBe('quick-selection');
  });

  it('registers as a selection pass-through whose processor hands the source bitmap straight back', () => {
    const result = toolProcessors['quick-selection'].imageProcessor({ size: { width: 40, height: 24 }, bitmap })(
      defaultSettings['quick-selection'] as never
    );

    expect(toolProcessors['quick-selection'].commit).toBe('selection');
    expect(toolProcessors['quick-selection'].creator).toBeUndefined();
    expect(result[0]).toBe(bitmap);
    expect(RecordingOffscreenCanvas.instances).toEqual([]);
  });

  it('keeps the seeded mode inside the union the options bar can render', () => {
    expect(isQuickSelectionMode(defaultSettings['quick-selection'].mode)).toBe(true);
    expect(isQuickSelectionMode('add')).toBe(true);
    expect(isQuickSelectionMode('subtract')).toBe(true);
    expect(isQuickSelectionMode('intersect')).toBe(false);
  });
});

describe('sampleStrokeSeeds', () => {
  it('spaces seeds by arc length rather than by pointer sample', () => {
    // A 100px stroke with a 40px brush at 25% spacing is a 10px step, whatever rate the
    // pointer reported it at: one seed per 10px of travel, first and last included.
    const seeds = sampleStrokeSeeds(
      [
        { x: 0, y: 0 },
        { x: 37, y: 0 },
        { x: 100, y: 0 },
      ],
      40
    );

    expect(seeds).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 40, y: 0 },
      { x: 50, y: 0 },
      { x: 60, y: 0 },
      { x: 70, y: 0 },
      { x: 80, y: 0 },
      { x: 90, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it('leaves a click with exactly one seed and an empty stroke with none', () => {
    expect(sampleStrokeSeeds([{ x: 7, y: 9 }], 40)).toEqual([{ x: 7, y: 9 }]);
    expect(sampleStrokeSeeds([], 40)).toEqual([]);
  });
});

describe('growAlongStroke union', () => {
  it('selects the near block and not the far one', () => {
    // The two blocks are the same colour and only connectivity separates them, so a grow
    // that ignored the seed's region — a global colour sweep — would take both.
    const imageData = createTwoSameColourBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 1 });

    grow(accumulator, imageData, strokePoints({ x: 1, y: 0 }, { x: 3, y: 0 }), { tolerance: 0, mode: 'add' });

    expect(countSelected(accumulator.mask)).toBe(4);
    expect(isSelected(accumulator.mask, 12, 1, 0)).toBe(true);
    expect(isSelected(accumulator.mask, 12, 10, 0)).toBe(false);
  });

  it('unions the regions of seeds the pointer crossed between, which is the re-seeding bug', () => {
    const imageData = createSplitBlocks();

    const near = floodFill(imageData, { x: 1, y: 0 }, { tolerance: 0, contiguous: true })!;
    const far = floodFill(imageData, { x: 5, y: 0 }, { tolerance: 0, contiguous: true })!;

    // Neither fill reaches the other run, so neither mask contains the other's pixels:
    // this is the property that makes the union load-bearing rather than a nicety. The
    // black gap is in neither, which is what pins the two runs as separate regions.
    expect(near.pixelCount).toBe(3);
    expect(far.pixelCount).toBe(4);
    expect(isSelected(near.mask, 8, 5, 0)).toBe(false);
    expect(isSelected(far.mask, 8, 1, 0)).toBe(false);

    const accumulator = createQuickSelectionAccumulator({ width: 8, height: 1 });
    grow(accumulator, imageData, strokePoints({ x: 1, y: 0 }, { x: 5, y: 0 }), { tolerance: 0, mode: 'add' });

    // Eight, not seven: the stroke's own seed on the black pixel grows that pixel — every
    // pixel is within tolerance of itself — so the union is seven red plus the one black
    // the pointer crossed. Taking the last seed's mask, or the largest single one, would
    // report 4 here and lose a whole run.
    expect(countSelected(accumulator.mask)).toBe(8);
    expect(isSelected(accumulator.mask, 8, 1, 0)).toBe(true);
    expect(isSelected(accumulator.mask, 8, 5, 0)).toBe(true);
  });

  it('only grows the seeds a resumed pass has not seen', () => {
    // The accumulator resumes from `grownSeeds`, which is only sound because appending to
    // the stroke cannot move the arc-length positions of the dabs already emitted. A second
    // call over the same seeds must therefore grow nothing, or the tool pays for a
    // whole-image fill per pointer move.
    const imageData = createTwoSameColourBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 1 });
    const stroke = strokePoints({ x: 1, y: 0 }, { x: 3, y: 0 });

    const first = grow(accumulator, imageData, stroke, { tolerance: 0, mode: 'add' });
    const second = grow(accumulator, imageData, stroke, { tolerance: 0, mode: 'add' });

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(countSelected(accumulator.mask)).toBe(4);
  });

  it('removes rather than adds in subtract mode', () => {
    const imageData = createTwoBlocks();
    const base = rasterizeSelectionMask(
      [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 4 },
        { x: 0, y: 4 },
      ],
      { width: 12, height: 4 }
    );
    expect(countSelected(base)).toBe(48);

    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 }, base);
    grow(accumulator, imageData, strokePoints({ x: 1, y: 1 }, { x: 2, y: 1 }), { tolerance: 30, mode: 'subtract' });

    // The red block went and the blue block the stroke never crossed stayed. The black
    // between them was in the base mask, so it stayed too: subtract removes the region the
    // stroke grew, it does not replace the selection with it.
    expect(countSelected(accumulator.mask)).toBe(32);
    expect(isSelected(accumulator.mask, 12, 1, 1)).toBe(false);
    expect(isSelected(accumulator.mask, 12, 10, 1)).toBe(true);
  });

  it('selects nothing when subtracting with nothing selected', () => {
    const imageData = createTwoBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 });

    grow(accumulator, imageData, strokePoints({ x: 1, y: 1 }, { x: 3, y: 1 }), { tolerance: 30, mode: 'subtract' });

    expect(countSelected(accumulator.mask)).toBe(0);
    expect(createQuickSelectionPolygon(accumulator.mask, 12, 4)).toBeNull();
  });

  it('grows nothing at all for a stroke that never touches the image', () => {
    const imageData = createTwoBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 });

    const grown = grow(
      accumulator,
      imageData,
      [
        { x: -40, y: -40 },
        { x: -10, y: -10 },
        { x: -1, y: -1 },
      ],
      { tolerance: 30, mode: 'add' }
    );

    expect(grown).toBe(0);
    expect(countSelected(accumulator.mask)).toBe(0);
    expect(createQuickSelectionPolygon(accumulator.mask, 12, 4)).toBeNull();
  });

  it('ignores a buffer that no longer matches the mask', () => {
    // A resize between two pointer moves leaves the stroke sampling against a differently
    // sized buffer, and growing into the mask from it would index a region the mask does
    // not describe.
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 });
    const grown = grow(accumulator, solidImage(20, 20, RED), strokePoints({ x: 1, y: 1 }, { x: 2, y: 1 }), {
      tolerance: 30,
      mode: 'add',
    });

    expect(grown).toBe(0);
    expect(countSelected(accumulator.mask)).toBe(0);
  });
});

describe('growAlongStroke tolerance', () => {
  it('excludes a near neighbour at tolerance 0 and includes it at 100', () => {
    // Two pixels 24 apart on the blue channel, so identical at tolerance 0 and 24 apart
    // against a bound of 100% * 510.
    const gradient = solidImage(2, 1, BLUE);
    setPixel(gradient, 1, 0, [0, 0, 224, 255]);

    const strict = createQuickSelectionAccumulator({ width: 2, height: 1 });
    growAlongStroke(strict, gradient, [{ x: 0, y: 0 }], { tolerance: 0, mode: 'add' });
    expect(countSelected(strict.mask)).toBe(1);
    expect(isSelected(strict.mask, 2, 1, 0)).toBe(false);

    const loose = createQuickSelectionAccumulator({ width: 2, height: 1 });
    growAlongStroke(loose, gradient, [{ x: 0, y: 0 }], { tolerance: 100, mode: 'add' });
    expect(countSelected(loose.mask)).toBe(2);
  });

  it('takes a brush far larger than the image without hanging', () => {
    // A 500px brush on a 4x4 image: the arc-length step is 125px, so a 4.2px stroke emits
    // two seeds, and each fill is bounded by the 16-pixel image rather than by the brush.
    const imageData = solidImage(4, 4, [10, 10, 10, 255]);
    const accumulator = createQuickSelectionAccumulator({ width: 4, height: 4 });

    growAlongStroke(accumulator, imageData, sampleStrokeSeeds(strokePoints({ x: 0, y: 0 }, { x: 3, y: 3 }), 500), {
      tolerance: 50,
      mode: 'add',
    });

    expect(countSelected(accumulator.mask)).toBe(16);
  });
});

describe('traceMaskBoundary', () => {
  const rectMask = (
    width: number,
    height: number,
    rects: { left: number; top: number; right: number; bottom: number }[]
  ) => {
    const mask = new Uint8Array(width * height);
    for (const { left, top, right, bottom } of rects) {
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          mask[y * width + x] = 1;
        }
      }
    }

    return mask;
  };

  it('traces a single pixel to the pixel square that covers it', () => {
    const traced = traceMaskBoundary(rectMask(3, 3, [{ left: 1, top: 2, right: 1, bottom: 2 }]), 3, 3)!;

    expect(traced.points).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ]);
    expect(traced.pixelCount).toBe(1);
    expect(traced.bounds).toEqual({ x: 1, y: 2, width: 1, height: 1 });
    expect(traced.hasHoles).toBe(false);
  });

  it('emits one vertex per unit edge, so an NxN block traces to 4N points', () => {
    // The trace works on pixel CORNERS, which is what makes the polygon cover the mask's
    // pixels exactly rather than straddling their centres.
    const traced = traceMaskBoundary(rectMask(5, 5, [{ left: 0, top: 0, right: 4, bottom: 4 }]), 5, 5)!;

    expect(traced.points).toHaveLength(20);
    expect(traced.pixelCount).toBe(25);
    expect(traced.loopCount).toBe(1);
    expect(traced.hasHoles).toBe(false);
  });

  it('reports the largest of several disjoint regions', () => {
    const traced = traceMaskBoundary(
      rectMask(8, 4, [
        { left: 0, top: 0, right: 1, bottom: 1 },
        { left: 4, top: 0, right: 7, bottom: 3 },
      ]),
      8,
      4
    )!;

    expect(traced.pixelCount).toBe(4 + 16);
    expect(traced.loopCount).toBe(2);
    expect(traced.hasHoles).toBe(false);
    expect(traced.bounds).toEqual({ x: 4, y: 0, width: 4, height: 4 });
    expect(traced.points).toHaveLength(16);
  });

  it('flags an enclosed hole instead of folding it into the outer contour', () => {
    // A 5x5 block with its middle pixel removed. The outer contour covers 25 squares, the
    // hole one, and a `Selection` is one point path — so this is the case the flag exists
    // to refuse.
    const withHole = rectMask(5, 5, [{ left: 0, top: 0, right: 4, bottom: 4 }]);
    withHole[2 * 5 + 2] = 0;

    const traced = traceMaskBoundary(withHole, 5, 5)!;

    expect(traced.pixelCount).toBe(24);
    expect(traced.hasHoles).toBe(true);
    expect(traced.loopCount).toBe(2);
    expect(traced.points).toHaveLength(20);
  });

  it('returns nothing for an empty mask, and refuses a mask that does not fit its size', () => {
    expect(traceMaskBoundary(new Uint8Array(9), 3, 3)).toBeNull();
    expect(traceMaskBoundary(new Uint8Array(4), 3, 3)).toBeNull();
    expect(traceMaskBoundary(new Uint8Array(0), 0, 0)).toBeNull();
  });

  it('traces a grown region back to the pixels the mask reports', () => {
    // The round trip the tool area depends on: grow, trace, rasterize again, and the
    // pixels are the same. A boundary convention off by a pixel — testing pixel corners as
    // pixel centres, say — fails here.
    const imageData = solidImage(8, 6, BLACK);
    fillRect(imageData, 2, 1, 5, 4, RED);

    const accumulator = createQuickSelectionAccumulator({ width: 8, height: 6 });
    growAlongStroke(accumulator, imageData, [{ x: 3, y: 2 }], { tolerance: 0, mode: 'add' });

    const polygon = createQuickSelectionPolygon(accumulator.mask, 8, 6)!;
    const rasterized = rasterizeSelectionMask(polygon.points, { width: 8, height: 6 });

    expect(countSelected(rasterized)).toBe(16);
    expect(Array.from(rasterized)).toEqual(Array.from(accumulator.mask));
    expect(isPointInPolygon({ x: 3.5, y: 2.5 }, polygon.points)).toBe(true);
    expect(isPointInPolygon({ x: 1.5, y: 0.5 }, polygon.points)).toBe(false);
  });
});

describe('rasterizeSelectionMask', () => {
  it('is empty for a path that encloses nothing', () => {
    expect(countSelected(rasterizeSelectionMask([], { width: 4, height: 4 }))).toBe(0);
    expect(
      countSelected(
        rasterizeSelectionMask(
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          { width: 4, height: 4 }
        )
      )
    ).toBe(0);
  });

  it('clips a path that runs off the canvas to the canvas', () => {
    const mask = rasterizeSelectionMask(
      [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
      { width: 4, height: 4 }
    );

    expect(countSelected(mask)).toBe(16);
  });
});

describe('createQuickSelectionPolygon', () => {
  it('carries the hole flag through to the caller that has to refuse the commit', () => {
    const ring = new Uint8Array(25);
    for (let index = 0; index < 25; index++) {
      if (index !== 2 * 5 + 2) ring[index] = 1;
    }

    const polygon = createQuickSelectionPolygon(ring, 5, 5)!;

    expect(polygon.hasHoles).toBe(true);
    expect(polygon.points).toHaveLength(20);
    // The outer contour of the ring is the whole square, so it covers the hole: committing
    // it would select 25 pixels for a mask that reports 24. That is the over-selection the
    // flag is refusing, stated as a fact about the geometry rather than as a policy.
    expect(isPointInPolygon({ x: 2.5, y: 2.5 }, polygon.points)).toBe(true);
  });

  it('borrows the magic wand as its source tool, which is the value that draws no anchors', () => {
    // `SelectionSourceTool` has no `'quick-selection'` member, and the borrowed value is
    // also the behaviourally right one: a traced staircase boundary must not carry a white
    // anchor dot per step.
    expect(QUICK_SELECTION_SOURCE_TOOL).toBe('magic-wand');
  });
});
