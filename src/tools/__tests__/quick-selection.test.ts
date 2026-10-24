import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { makeMockImageData } from '../../__tests__/canvas-mock.ts';
import {
  QUICK_SELECTION_SOURCE_TOOL,
  appendQuickSelectionStrokeSeeds,
  createQuickSelectionAccumulator,
  createQuickSelectionPolygon,
  createQuickSelectionStrokeSeedSampler,
  growAlongStroke,
  isQuickSelectionMode,
  rasterizeSelectionMask,
  rasterizeSelectionState,
  sampleStrokeDabCenters,
  sampleStrokeSeeds,
  traceMaskBoundary,
  type QuickSelectionAccumulator,
} from '../quickSelection.ts';
import { floodFill } from '../../util/flood-fill.ts';
import { createSelectionAlphaMask, isPointInContours } from '../../util/selection.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { encodeRasterSelectionMask, MAX_VECTOR_SELECTION_BOUNDARY_EDGES } from '../../util/selection-mask.ts';

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
  it('spaces dab centres by arc length rather than by pointer sample', () => {
    // A 100px stroke with a 40px brush at 25% spacing is a 10px step, whatever rate the
    // pointer reported it at: one seed per 10px of travel, first and last included.
    const seeds = sampleStrokeDabCenters(
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

  it('keeps a click at the centre for a one-pixel tip and emits no seeds for an empty stroke', () => {
    expect(sampleStrokeSeeds([{ x: 7, y: 9 }], 1)).toEqual([{ x: 7, y: 9 }]);
    expect(sampleStrokeSeeds([], 40)).toEqual([]);
  });

  it('uses the brush diameter to sample more than its centre', () => {
    const seeds = sampleStrokeSeeds([{ x: 10, y: 10 }], 20);

    expect(seeds).toHaveLength(9);
    expect(seeds.every(({ x, y }) => Math.hypot(x - 10, y - 10) <= 10)).toBe(true);
    expect(seeds).toContainEqual({ x: 18, y: 10 });
    expect(seeds).toContainEqual({ x: 2, y: 10 });
  });

  it('keeps previously emitted dab seeds stable while the pointer moves', () => {
    const before = sampleStrokeSeeds(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      16,
      undefined,
      false
    );
    const after = sampleStrokeSeeds(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      16,
      undefined,
      false
    );
    const released = sampleStrokeSeeds(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      16,
      undefined,
      true
    );

    expect(after.slice(0, before.length)).toEqual(before);
    expect(
      sampleStrokeDabCenters(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        16,
        25,
        false
      )
    ).toEqual([{ x: 0, y: 0 }]);
    expect(
      sampleStrokeDabCenters(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        16,
        25,
        false
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(released.length).toBeGreaterThan(after.length);
  });

  it('produces the same seed pixels when the pointer path is sampled incrementally', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 9, y: 4 },
      { x: 12, y: 11 },
    ];
    const sampler = createQuickSelectionStrokeSeedSampler(16);
    const incremental = points.flatMap((point, index) =>
      appendQuickSelectionStrokeSeeds(sampler, point, index === points.length - 1)
    );

    expect(incremental).toEqual(sampleStrokeSeeds(points, 16));
  });

  it('returns only newly reached seed pixels on each pointer event', () => {
    const sampler = createQuickSelectionStrokeSeedSampler(20);
    const first = appendQuickSelectionStrokeSeeds(sampler, { x: 0, y: 0 });
    const second = appendQuickSelectionStrokeSeeds(sampler, { x: 5, y: 0 });
    const third = appendQuickSelectionStrokeSeeds(sampler, { x: 12, y: 0 }, true);
    const uniquePixels = new Set(
      [...first, ...second, ...third].map(({ x, y }) => `${Math.floor(x)},${Math.floor(y)}`)
    );

    expect(first).toHaveLength(9);
    expect(second.length).toBeGreaterThan(0);
    expect(third.length).toBeGreaterThan(0);
    expect(uniquePixels.size).toBe(first.length + second.length + third.length);
  });

  it('bounds per-stroke seed deduplication and safely re-emits uncached pixels', () => {
    const sampler = createQuickSelectionStrokeSeedSampler(1, 100);
    appendQuickSelectionStrokeSeeds(sampler, { x: 0, y: 0 }, true);
    appendQuickSelectionStrokeSeeds(sampler, { x: 5_000, y: 0 }, true);

    expect(sampler.emittedPixels.size).toBe(4_096);

    const retraced = appendQuickSelectionStrokeSeeds(sampler, { x: 0, y: 0 }, true);

    expect(sampler.emittedPixels.size).toBe(4_096);
    expect(retraced.some(({ x, y }) => Math.floor(x) === 4_096 && Math.floor(y) === 0)).toBe(true);
  });
});

describe('growAlongStroke union', () => {
  it('keeps the coarse preview within its pixel budget when odd dimensions round up', () => {
    const accumulator = createQuickSelectionAccumulator({ width: 1001, height: 999 });

    expect(accumulator.preview.scale).toBe(3);
    expect(accumulator.preview.width * accumulator.preview.height).toBeLessThanOrEqual(250_000);
  });

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

  it('uses the brush tip footprint to reach regions away from its centre', () => {
    const imageData = solidImage(21, 1, BLACK);
    fillRect(imageData, 0, 0, 4, 0, RED);
    fillRect(imageData, 16, 0, 20, 0, BLUE);
    const small = createQuickSelectionAccumulator({ width: 21, height: 1 });
    const large = createQuickSelectionAccumulator({ width: 21, height: 1 });

    growAlongStroke(small, imageData, sampleStrokeSeeds([{ x: 10, y: 0 }], 1), { tolerance: 0, mode: 'add' });
    growAlongStroke(large, imageData, sampleStrokeSeeds([{ x: 10, y: 0 }], 20), { tolerance: 0, mode: 'add' });

    expect(isSelected(small.mask, 21, 2, 0)).toBe(false);
    expect(isSelected(small.mask, 21, 18, 0)).toBe(false);
    expect(isSelected(large.mask, 21, 2, 0)).toBe(true);
    expect(isSelected(large.mask, 21, 18, 0)).toBe(true);
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

  it('reuses a prior fill when a later pointer batch repeats the exact seed pixel', () => {
    const imageData = createTwoSameColourBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 1 });

    const first = growAlongStroke(accumulator, imageData, [{ x: 1, y: 0 }], { tolerance: 0, mode: 'add' });
    const second = growAlongStroke(accumulator, imageData, [{ x: 1, y: 0 }], { tolerance: 0, mode: 'add' });

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(accumulator.floodFillWorkspace?.generation).toBe(1);
    expect(countSelected(accumulator.mask)).toBe(4);
  });

  it('grows a full equal-color region when a new Add stroke starts inside its base selection', () => {
    const imageData = solidImage(8, 1, RED);
    const accumulator = createQuickSelectionAccumulator(
      { width: 8, height: 1 },
      Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0])
    );

    growAlongStroke(accumulator, imageData, [{ x: 0, y: 0 }], { tolerance: 0, mode: 'add' });

    expect(Array.from(accumulator.mask)).toEqual(new Array(8).fill(1));
    expect(accumulator.selectedPixelCount).toBe(8);
  });

  it('normalizes nonzero base mask bytes to binary pixels', () => {
    const accumulator = createQuickSelectionAccumulator({ width: 2, height: 1 }, Uint8Array.from([255, 0]));

    expect(Array.from(accumulator.mask)).toEqual([1, 0]);
    expect(accumulator.selectedPixelCount).toBe(1);
  });

  it('updates coarse preview coverage incrementally without changing the exact selection mask', () => {
    const imageData = solidImage(4, 1, BLACK);
    setPixel(imageData, 0, 0, RED);
    setPixel(imageData, 1, 0, BLUE);
    const accumulator = createQuickSelectionAccumulator({ width: 4, height: 1 }, Uint8Array.from([1, 1, 0, 0]), 2);

    expect(accumulator.preview.scale).toBe(2);
    expect(Array.from(accumulator.preview.mask)).toEqual([1, 0]);

    growAlongStroke(accumulator, imageData, [{ x: 0, y: 0 }], { tolerance: 0, mode: 'subtract' });

    expect(Array.from(accumulator.mask)).toEqual([0, 1, 0, 0]);
    expect(Array.from(accumulator.preview.mask)).toEqual([1, 0]);

    growAlongStroke(accumulator, imageData, [{ x: 1, y: 0 }], { tolerance: 0, mode: 'subtract' });

    expect(Array.from(accumulator.mask)).toEqual([0, 0, 0, 0]);
    expect(Array.from(accumulator.preview.mask)).toEqual([0, 0]);
  });

  it('stops sampling once an Add fill covers the complete image', () => {
    const imageData = solidImage(4, 1, RED);
    const accumulator = createQuickSelectionAccumulator({ width: 4, height: 1 });

    growAlongStroke(
      accumulator,
      imageData,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      {
        tolerance: 0,
        mode: 'add',
      }
    );

    expect(accumulator.selectedPixelCount).toBe(4);
    expect(accumulator.floodFillWorkspace?.generation).toBe(1);
  });

  it('continues a gradient from later seeds already covered by the current selection', () => {
    const gradient = solidImage(8, 1, [0, 0, 100, 255]);
    for (let x = 1; x < gradient.width; x += 1) setPixel(gradient, x, 0, [0, 0, 100 + x * 5, 255]);
    const accumulator = createQuickSelectionAccumulator({ width: 8, height: 1 });
    const first = sampleStrokeSeeds([{ x: 0, y: 0 }], 1);
    const extended = sampleStrokeSeeds(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      1
    );

    growAlongStroke(accumulator, gradient, first, { tolerance: 1, mode: 'add' });
    growAlongStroke(accumulator, gradient, extended, { tolerance: 1, mode: 'add' });

    expect(isSelected(accumulator.mask, 8, 1, 0)).toBe(true);
    expect(isSelected(accumulator.mask, 8, 2, 0)).toBe(true);
    expect(isSelected(accumulator.mask, 8, 3, 0)).toBe(false);
  });

  it('reuses full-frame flood-fill scratch buffers across distinct seeds', () => {
    const imageData = createTwoBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 });

    growAlongStroke(accumulator, imageData, [{ x: 1, y: 1 }], { tolerance: 0, mode: 'add' });
    const workspace = accumulator.floodFillWorkspace;
    growAlongStroke(
      accumulator,
      imageData,
      [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
      ],
      { tolerance: 0, mode: 'add' }
    );

    expect(accumulator.floodFillWorkspace).toBe(workspace);
    expect(workspace?.visited).toHaveLength(48);
    expect(workspace?.queue).toHaveLength(48);
    expect(countSelected(accumulator.mask)).toBe(32);
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
      [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 1, y: 3 },
      ],
    ]);
    expect(traced.pixelCount).toBe(1);
    expect(traced.bounds).toEqual({ x: 1, y: 2, width: 1, height: 1 });
    expect(traced.hasHoles).toBe(false);
  });

  it('emits one vertex per unit edge, so an NxN block traces to 4N points', () => {
    // The trace works on pixel CORNERS, which is what makes the polygon cover the mask's
    // pixels exactly rather than straddling their centres.
    const traced = traceMaskBoundary(rectMask(5, 5, [{ left: 0, top: 0, right: 4, bottom: 4 }]), 5, 5)!;

    expect(traced.points).toHaveLength(1);
    expect(traced.points[0]).toHaveLength(20);
    expect(traced.pixelCount).toBe(25);
    expect(traced.loopCount).toBe(1);
    expect(traced.hasHoles).toBe(false);
  });

  it('retains every disjoint region and bounds all of their contours', () => {
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
    expect(traced.bounds).toEqual({ x: 0, y: 0, width: 8, height: 4 });
    expect(traced.points.map((contour) => contour.length).sort((a, b) => a - b)).toEqual([8, 16]);
  });

  it('flags an enclosed hole and retains both boundary contours', () => {
    // A 5x5 block with its middle pixel removed. The outer contour and the hole contour
    // are both carried so the committed compound path can exclude the missing pixel.
    const withHole = rectMask(5, 5, [{ left: 0, top: 0, right: 4, bottom: 4 }]);
    withHole[2 * 5 + 2] = 0;

    const traced = traceMaskBoundary(withHole, 5, 5)!;

    expect(traced.pixelCount).toBe(24);
    expect(traced.hasHoles).toBe(true);
    expect(traced.loopCount).toBe(2);
    expect(traced.points.map((contour) => contour.length)).toEqual([20, 4]);
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
    expect(isPointInContours({ x: 3.5, y: 2.5 }, polygon.points)).toBe(true);
    expect(isPointInContours({ x: 1.5, y: 0.5 }, polygon.points)).toBe(false);
  });

  it('pixelCount equals countSelected for a single pixel', () => {
    const mask = rectMask(3, 3, [{ left: 1, top: 1, right: 1, bottom: 1 }]);
    const traced = traceMaskBoundary(mask, 3, 3)!;
    expect(traced.pixelCount).toBe(countSelected(mask));
  });

  it('pixelCount equals countSelected for an NxN block', () => {
    const mask = rectMask(5, 5, [{ left: 0, top: 0, right: 4, bottom: 4 }]);
    const traced = traceMaskBoundary(mask, 5, 5)!;
    expect(traced.pixelCount).toBe(countSelected(mask));
  });

  it('pixelCount equals countSelected for disjoint regions', () => {
    const mask = rectMask(8, 4, [
      { left: 0, top: 0, right: 1, bottom: 1 },
      { left: 4, top: 0, right: 7, bottom: 3 },
    ]);
    const traced = traceMaskBoundary(mask, 8, 4)!;
    expect(traced.pixelCount).toBe(countSelected(mask));
  });

  it('pixelCount equals countSelected for an L-shaped region', () => {
    const mask = rectMask(5, 5, [
      { left: 0, top: 0, right: 4, bottom: 1 },
      { left: 0, top: 0, right: 1, bottom: 4 },
    ]);
    const traced = traceMaskBoundary(mask, 5, 5)!;
    expect(traced.pixelCount).toBe(countSelected(mask));
  });

  it('pixelCount equals countSelected for a mask with a hole', () => {
    const mask = rectMask(5, 5, [{ left: 0, top: 0, right: 4, bottom: 4 }]);
    mask[2 * 5 + 2] = 0;
    const traced = traceMaskBoundary(mask, 5, 5)!;
    expect(traced.pixelCount).toBe(countSelected(mask));
  });

  it('pixelCount is consistent with countSelected: an empty mask yields null and zero selected', () => {
    const mask = rectMask(5, 5, []);
    const traced = traceMaskBoundary(mask, 5, 5);
    expect(traced).toBeNull();
    expect(countSelected(mask)).toBe(0);
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

  it('quantizes a fractional packed-mask position to binary membership for a Quick Selection edit', () => {
    const rasterMask = encodeRasterSelectionMask(Uint8Array.of(1), 1, 1, { x: 0, y: 0, width: 1, height: 1 })!;
    const selection: Selection = {
      id: 'fractional-raster-selection',
      isActive: true,
      geometry: 'polygon',
      lifecycle: 'committed',
      sourceTool: 'quick-selection',
      pos: { x: 0.5, y: 0.5, width: 1, height: 1 },
      points: [],
      rasterMask,
    };

    // The general pixel-coverage path preserves area coverage, but Quick Selection's
    // accumulator is one bit per pixel and samples at destination pixel centres.
    expect([...rasterizeSelectionState(selection, { width: 2, height: 2 }, { x: 0, y: 0 })]).toEqual([1, 0, 0, 0]);
    expect([
      ...createSelectionAlphaMask(
        { points: [], rasterMask: { ...rasterMask, x: 0.5, y: 0.5 } },
        { width: 2, height: 2 }
      ),
    ]).toEqual([64, 64, 64, 64]);
  });
});

describe('createQuickSelectionPolygon', () => {
  it('carries every contour through so an enclosed hole remains unselected', () => {
    const ring = new Uint8Array(25);
    for (let index = 0; index < 25; index++) {
      if (index !== 2 * 5 + 2) ring[index] = 1;
    }

    const polygon = createQuickSelectionPolygon(ring, 5, 5)!;

    expect(polygon.hasHoles).toBe(true);
    expect(polygon.points.map((contour) => contour.length)).toEqual([20, 4]);
    expect(isPointInContours({ x: 2.5, y: 2.5 }, polygon.points)).toBe(false);
  });

  it('records its own source tool without attaching polygon anchors to the pixel boundary', () => {
    expect(QUICK_SELECTION_SOURCE_TOOL).toBe('quick-selection');
  });

  it('keeps a dense mask exact without materializing its contours and can rasterize it as an active base', () => {
    const size = 192;
    const mask = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if ((x + y) % 2 === 0) mask[y * size + x] = 1;
      }
    }

    const polygon = createQuickSelectionPolygon(mask, size, size)!;
    const selection: Selection = {
      id: 'fragmented-selection',
      points: polygon.points,
      rasterMask: polygon.rasterMask,
      isActive: true,
      pos: polygon.bounds,
      sourceTool: QUICK_SELECTION_SOURCE_TOOL,
    };

    expect(polygon.points).toEqual([]);
    expect(polygon.boundaryEdgeCount).toBe(MAX_VECTOR_SELECTION_BOUNDARY_EDGES + 1);
    expect(rasterizeSelectionState(selection, { width: size, height: size }, { x: 0, y: 0 })).toEqual(mask);
  });
});

describe('non-finite input handling', () => {
  it('createQuickSelectionAccumulator with NaN dimensions yields an empty mask', () => {
    const acc = createQuickSelectionAccumulator({ width: NaN, height: NaN });
    expect(acc.width).toBe(0);
    expect(acc.height).toBe(0);
    expect(acc.mask.length).toBe(0);
  });

  it('createQuickSelectionAccumulator with Infinity dimensions yields an empty mask', () => {
    const acc = createQuickSelectionAccumulator({ width: Infinity, height: Infinity });
    expect(acc.width).toBe(0);
    expect(acc.height).toBe(0);
    expect(acc.mask.length).toBe(0);
  });

  it('createQuickSelectionAccumulator with negative dimensions yields an empty mask', () => {
    const acc = createQuickSelectionAccumulator({ width: -10, height: -10 });
    expect(acc.width).toBe(0);
    expect(acc.height).toBe(0);
    expect(acc.mask.length).toBe(0);
  });

  it('growAlongStroke with NaN seed coordinates grows nothing', () => {
    const imageData = createTwoBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 });
    const grown = growAlongStroke(accumulator, imageData, [{ x: NaN, y: NaN }], {
      tolerance: 30,
      mode: 'add',
    });
    expect(grown).toBe(0);
    expect(countSelected(accumulator.mask)).toBe(0);
  });

  it('growAlongStroke with Infinity seed coordinates grows nothing', () => {
    const imageData = createTwoBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 });
    const grown = growAlongStroke(accumulator, imageData, [{ x: Infinity, y: Infinity }], {
      tolerance: 30,
      mode: 'add',
    });
    expect(grown).toBe(0);
    expect(countSelected(accumulator.mask)).toBe(0);
  });

  it('growAlongStroke skips non-finite seeds but grows from valid ones', () => {
    const imageData = createTwoBlocks();
    const accumulator = createQuickSelectionAccumulator({ width: 12, height: 4 });
    const grown = growAlongStroke(
      accumulator,
      imageData,
      [
        { x: NaN, y: NaN },
        { x: 1, y: 1 },
        { x: Infinity, y: Infinity },
      ],
      { tolerance: 30, mode: 'add' }
    );
    expect(grown).toBe(1);
    expect(countSelected(accumulator.mask)).toBe(16);
  });

  it('traceMaskBoundary with non-finite dimensions returns null', () => {
    expect(traceMaskBoundary(new Uint8Array(0), NaN, NaN)).toBeNull();
    expect(traceMaskBoundary(new Uint8Array(0), Infinity, Infinity)).toBeNull();
    expect(traceMaskBoundary(new Uint8Array(0), -5, -5)).toBeNull();
  });

  it('rasterizeSelectionMask with non-finite size yields an empty mask', () => {
    const result = rasterizeSelectionMask([], { width: NaN, height: NaN });
    expect(result.length).toBe(0);
  });
});

describe('contour mask round trips', () => {
  const rectMask = (
    width: number,
    height: number,
    rects: { left: number; top: number; right: number; bottom: number }[]
  ): Uint8Array => {
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

  it('round-trips a mask with a hole back to the same pixels', () => {
    // Every boundary loop is serialized and rasterized with the same even-odd rule.
    const mask = rectMask(5, 5, [{ left: 0, top: 0, right: 4, bottom: 4 }]);
    mask[2 * 5 + 2] = 0;

    const traced = traceMaskBoundary(mask, 5, 5)!;
    const rasterized = rasterizeSelectionMask(traced.points, { width: 5, height: 5 });

    expect(Array.from(rasterized)).toEqual(Array.from(mask));
  });

  it('round-trips a nested island inside a hole back to the same pixels', () => {
    const mask = rectMask(7, 7, [{ left: 0, top: 0, right: 6, bottom: 6 }]);
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) mask[y * 7 + x] = 0;
    }
    mask[3 * 7 + 3] = 1;

    const traced = traceMaskBoundary(mask, 7, 7)!;
    const rasterized = rasterizeSelectionMask(traced.points, { width: 7, height: 7 });

    expect(traced.loopCount).toBe(3);
    expect(traced.hasHoles).toBe(true);
    expect(Array.from(rasterized)).toEqual(Array.from(mask));
  });

  it('round-trips a multi-region mask back to the same pixels', () => {
    // Every disjoint contour is retained instead of reducing the mask to its largest region.
    const mask = rectMask(8, 4, [
      { left: 0, top: 0, right: 1, bottom: 1 },
      { left: 4, top: 0, right: 7, bottom: 3 },
    ]);

    const traced = traceMaskBoundary(mask, 8, 4)!;
    const rasterized = rasterizeSelectionMask(traced.points, { width: 8, height: 4 });

    expect(Array.from(rasterized)).toEqual(Array.from(mask));
  });

  it('round-trips two 4-connected regions that touch only at a corner', () => {
    const mask = rectMask(4, 4, [
      { left: 0, top: 0, right: 1, bottom: 1 },
      { left: 2, top: 2, right: 2, bottom: 2 },
    ]);

    const traced = traceMaskBoundary(mask, 4, 4)!;
    const rasterized = rasterizeSelectionMask(traced.points, { width: 4, height: 4 });

    expect(traced.points).toHaveLength(2);
    expect(Array.from(rasterized)).toEqual(Array.from(mask));
  });
});
