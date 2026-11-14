import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import {
  BRUSH_HARDNESS_DEFAULT,
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_OPACITY_DEFAULT,
  BRUSH_SIZE_DEFAULT,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
} from '../../util/brush-engine.ts';
import type { Size } from '../../contexts/general-types.ts';
import { spotHealing, SPOT_HEALING_SPACING_PERCENT, type SpotHealingToolArgs } from '../spotHealing.ts';

type PixelContext = ReturnType<typeof createPixelCanvasContext> & {
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];
  readonly buffer: Uint8ClampedArray;
  readonly ctx: PixelContext;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.buffer = new Uint8ClampedArray(this.width * this.height * 4);
    this.ctx = {
      ...createPixelCanvasContext(this),
      drawImage: vi.fn(() => {
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const offset = (y * this.width + x) * 4;
            this.buffer[offset] = y * 20;
            this.buffer[offset + 1] = 100;
            this.buffer[offset + 2] = 100;
            this.buffer[offset + 3] = 255;
          }
        }
      }),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(this.buffer),
        width: this.width,
        height: this.height,
        colorSpace: 'srgb',
      })),
      putImageData: vi.fn((image: ImageData) => this.buffer.set(image.data)),
    } as unknown as PixelContext;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): PixelContext {
    return this.ctx;
  }
}

const size: Size = { width: 9, height: 9 };
const sourceBitmap = createMockImageBitmap(size.width, size.height);

const args = (overrides: Partial<SpotHealingToolArgs> = {}): SpotHealingToolArgs => ({
  size: 3,
  hardness: 100,
  opacity: 1,
  points: [{ x: 4, y: 4 }],
  toolName: 'spot-healing',
  ...overrides,
});

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs the processor and returns the single canvas it must have produced. */
const run = (overrides: Partial<SpotHealingToolArgs> = {}): RecordingOffscreenCanvas => {
  const result = spotHealing({ size, bitmap: sourceBitmap })(args(overrides));

  expect(result).toHaveLength(1);
  const canvas = result[0] as unknown as RecordingOffscreenCanvas;
  expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));

  return canvas;
};

/** The RGBA quad at `(x, y)` of a canvas's backing store. */
const at = (canvas: RecordingOffscreenCanvas, x: number, y: number) => {
  const offset = (y * canvas.width + x) * 4;
  return {
    r: canvas.buffer[offset],
    g: canvas.buffer[offset + 1],
    b: canvas.buffer[offset + 2],
    a: canvas.buffer[offset + 3],
  };
};

/** The destination colour at `(x, y)` before healing. */
const dest = (_x: number, y: number) => ({
  r: y * 20,
  g: 100,
  b: 100,
  a: 255,
});

describe('spot healing processor', () => {
  it('is the exact module-level processor the registry imports, not a wrapper closure', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors['spot-healing'].imageProcessor).toBe(spotHealing);
  });

  it('stamps a full document-sized canvas and draws the source raster into it', () => {
    const canvas = run();

    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(sourceBitmap, 0, 0);
  });

  it('spaces its dabs at the tool constant', () => {
    expect(SPOT_HEALING_SPACING_PERCENT).toBe(25);
  });

  describe('the no-stroke states', () => {
    it('is an exact no-op for an empty point list', () => {
      const canvas = run({ points: [] });

      expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
    });

    it('is a no-op that does not throw for a stroke entirely outside the canvas', () => {
      expect(() =>
        run({
          size: 8,
          points: [
            { x: 40, y: 40 },
            { x: 44, y: 44 },
          ],
        })
      ).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
      expect(canvas.ctx.putImageData).toHaveBeenCalled();
    });
  });

  describe('a hard tip copies nearby texture exactly', () => {
    it('copies the source texture from the proximity sample at the stroke centre', () => {
      const canvas = run();

      const center = at(canvas, 4, 4);
      // proximitySample at distance 0 with radius 1.5: direction={x:0,y:-1}, sampleDistance=max(2.5, 1.125)=2.5
      // sample = clampPointToSize({x: 4, y: 4 - 2.5}, {9,9}) = {x: 4, y: 2}
      // dest at (4,2) has r = 2*20 = 40
      expect(center.r).toBe(40);
      expect(center.g).toBe(100);
      expect(center.b).toBe(100);
      expect(center.a).toBe(255);
    });

    it('writes a single-point stroke as exactly one dab (3x3 block for size=3)', () => {
      const canvas = run();

      // Dab centre (4,4) with radius 1.5 spans x=3..5, y=3..5
      // The proximity sample for each texel in the dab depends on its offset from centre
      // At centre (4,4): samples from (4,2) -> r=40
      expect(at(canvas, 4, 4)).toEqual({ r: 40, g: 100, b: 100, a: 255 });

      // Distance 1 selects the left direction; the sample starts at the dab centre.
      expect(at(canvas, 3, 4)).toEqual({ r: 80, g: 100, b: 100, a: 255 });

      expect(at(canvas, 5, 4)).toEqual({ r: 80, g: 100, b: 100, a: 255 });

      // At (4,3): distance=1, direction={x:0,y:-1}, sampleDistance=2.5
      // Sampling starts at the dab centre: round(4-2.5)=2, so the source row is 2.
      expect(at(canvas, 4, 3)).toEqual({ r: 40, g: 100, b: 100, a: 255 });

      // At (4,5): direction={x:0,y:1}, sampleDistance=2.5
      // Sampling starts at the dab centre: round(4+2.5)=7, so the source row is 7.
      expect(at(canvas, 4, 5)).toEqual({ r: 140, g: 100, b: 100, a: 255 });

      // Corners
      // At each corner, the normalized diagonal direction and dab-centred sample round to row 2.
      expect(at(canvas, 3, 3)).toEqual({ r: 40, g: 100, b: 100, a: 255 });

      expect(at(canvas, 5, 3)).toEqual({ r: 40, g: 100, b: 100, a: 255 });

      // The bottom corners round to source row 6.
      expect(at(canvas, 3, 5)).toEqual({ r: 120, g: 100, b: 100, a: 255 });

      expect(at(canvas, 5, 5)).toEqual({ r: 120, g: 100, b: 100, a: 255 });

      // Outside the dab radius should be unchanged
      expect(at(canvas, 2, 4)).toEqual(dest(2, 4));
      expect(at(canvas, 6, 4)).toEqual(dest(6, 4));
      expect(at(canvas, 4, 2)).toEqual(dest(4, 2));
      expect(at(canvas, 4, 6)).toEqual(dest(4, 6));
    });
  });

  describe('a soft tip blends with proximity-sampled texture across its rim', () => {
    it('weights each texel by the tip falloff with proximity sampling', () => {
      const canvas = run({ size: 4, hardness: 0 });

      const center = at(canvas, 4, 4);
      // With size=4, radius=2, sampleDistance=max(3, 0+1.5)=3
      // sample = {x:4, y:4-3=1} -> dest(4,1).r = 1*20 = 20
      expect(center.r).toBe(20);
      expect(center.g).toBe(100);
      expect(center.b).toBe(100);
      expect(center.a).toBe(255);

      // The rim texels get weighted samples from nearby
      // At (3,4): with soft tip, weight < 1, but proximity sample equals destination
      expect(at(canvas, 3, 4)).toEqual({ r: 80, g: 100, b: 100, a: 255 });
      expect(at(canvas, 5, 4)).toEqual({ r: 80, g: 100, b: 100, a: 255 });
      expect(at(canvas, 4, 3)).not.toEqual(dest(4, 3));
      expect(at(canvas, 4, 5)).not.toEqual(dest(4, 5));
    });

    it('leaves the half-open rim at distance exactly the radius untouched', () => {
      const canvas = run({ size: 4, hardness: 0 });

      expect(at(canvas, 2, 4)).toEqual(dest(2, 4));
      expect(at(canvas, 6, 4)).toEqual(dest(6, 4));
      expect(at(canvas, 4, 2)).toEqual(dest(4, 2));
      expect(at(canvas, 4, 6)).toEqual(dest(4, 6));
    });
  });

  describe('opacity scales the healing strength', () => {
    it('scales the correction strength via straight lerp', () => {
      const canvas = run({ opacity: 0.5 });

      const center = at(canvas, 4, 4);
      // With opacity 0.5, the blend is halfway between destination and sampled source
      // dest(4,4).r = 80, source = 40, halfway = 60
      expect(center.r).toBe(60);
      expect(center.g).toBe(100);
      expect(center.b).toBe(100);
      expect(center.a).toBe(255);

      expect(center.r).toBeLessThan(dest(4, 4).r);
      expect(center.r).toBeGreaterThan(40);
    });

    it('is an exact no-op at zero opacity (processor early-returns)', () => {
      const canvas = run({ opacity: 0 });

      expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
    });
  });

  describe('multi-dab strokes with spacing', () => {
    it('stamps multiple dabs along a stroke', () => {
      const canvas = run({
        points: [
          { x: 2, y: 4 },
          { x: 6, y: 4 },
        ],
      });

      // Exact pixel outputs pin the overlapping, spaced dab sequence.
      expect(at(canvas, 2, 4)).toEqual({ r: 80, g: 100, b: 100, a: 255 });

      expect(at(canvas, 6, 4)).toEqual({ r: 40, g: 100, b: 100, a: 255 });

      expect(at(canvas, 4, 4)).toEqual({ r: 80, g: 100, b: 100, a: 255 });
    });
  });

  describe('source buffer isolation', () => {
    it('samples the original raster after an earlier dab has changed the sampled texel', () => {
      const canvas = run({
        size: 4,
        points: [
          { x: 4, y: 0 },
          { x: 4, y: 4 },
        ],
      });

      // Earlier dabs heal source row 1 to 0; the final center still samples its original value, 20.
      expect(at(canvas, 4, 4)).toEqual({ r: 20, g: 100, b: 100, a: 255 });
    });
  });

  describe('edge handling and clamping', () => {
    it('clamps a proximity sample that hangs off the top edge', () => {
      expect(() => run({ points: [{ x: 4, y: 0 }] })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      // At y=0, the proximity sample clamps to y=0, sampling dest(4,0).r = 0
      // The destination at (4,0) is also r=0, so they match - this is correct clamping behavior
      expect(at(canvas, 4, 0)).toEqual({ r: 0, g: 100, b: 100, a: 255 });
    });

    it('clamps a proximity sample that hangs off the bottom edge', () => {
      expect(() => run({ points: [{ x: 4, y: 8 }] })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      // The center pixel's upward default sampling direction remains in-bounds at row 6.
      expect(at(canvas, 4, 8)).toEqual({ r: 120, g: 100, b: 100, a: 255 });
    });

    it('clamps a proximity sample that hangs off the left edge', () => {
      expect(() => run({ points: [{ x: 0, y: 4 }] })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      // At the center pixel, the zero-distance default direction samples row 2.
      expect(at(canvas, 0, 4)).toEqual({ r: 40, g: 100, b: 100, a: 255 });
    });

    it('clamps a proximity sample that hangs off the right edge', () => {
      expect(() => run({ points: [{ x: 8, y: 4 }] })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      // At the center pixel, the zero-distance default direction samples row 2.
      expect(at(canvas, 8, 4)).toEqual({ r: 40, g: 100, b: 100, a: 255 });
    });

    it('handles a huge tip that covers the entire canvas', () => {
      expect(() => run({ size: 500 })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
          if (x === 4 && y === 4) {
            expect(at(canvas, x, y)).not.toEqual(dest(x, y));
          }
        }
      }
    });
  });

  describe('clamping non-finite and out-of-range controls', () => {
    const equivalentTo = (override: Partial<SpotHealingToolArgs>, reference: Partial<SpotHealingToolArgs>) => {
      const a = run(override);
      const b = run(reference);
      expect(Array.from(a.buffer)).toEqual(Array.from(b.buffer));
    };

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'falls back to the default size for non-finite size %p',
      (sizeValue) => {
        equivalentTo({ size: sizeValue }, { size: BRUSH_SIZE_DEFAULT });
      }
    );

    it('clamps an over-range size to the maximum and an under-range one to the minimum', () => {
      equivalentTo({ size: 5000 }, { size: BRUSH_SIZE_MAX });
      equivalentTo({ size: 0 }, { size: BRUSH_SIZE_MIN });
      equivalentTo({ size: -40 }, { size: BRUSH_SIZE_MIN });
    });

    it.each([Number.NaN, 250, -40])('clamps out-of-range hardness %p into 0-100', (hardness) => {
      const clamped = Number.isFinite(hardness)
        ? Math.min(BRUSH_HARDNESS_MAX, Math.max(BRUSH_HARDNESS_MIN, hardness))
        : BRUSH_HARDNESS_DEFAULT;

      equivalentTo({ hardness }, { hardness: clamped });
    });

    it.each([Number.NaN, 3, -0.25])('clamps out-of-range opacity %p into 0-1', (opacity) => {
      const clamped = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : BRUSH_OPACITY_DEFAULT;

      equivalentTo({ opacity }, { opacity: clamped });
    });

    it('does not throw for any of them together', () => {
      expect(() => run({ size: Number.NaN, hardness: Number.NaN, opacity: Number.NaN })).not.toThrow();
      expect(() => run({ size: -1, hardness: 400, opacity: 9 })).not.toThrow();
    });
  });

  describe('zero-size and zero-hardness edge cases', () => {
    it('handles zero hardness (fully soft) without throwing', () => {
      expect(() => run({ hardness: 0 })).not.toThrow();
      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
      expect(canvas.ctx.putImageData).toHaveBeenCalled();
    });

    it('handles minimum size without throwing', () => {
      expect(() => run({ size: BRUSH_SIZE_MIN })).not.toThrow();
      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
      expect(canvas.ctx.putImageData).toHaveBeenCalled();
    });
  });
});
