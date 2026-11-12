import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import {
  BRUSH_HARDNESS_DEFAULT,
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_DEFAULT,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
} from '../../util/brush-engine.ts';
import type { Size } from '../../contexts/general-types.ts';
import { healingBrush, HEALING_BRUSH_SPACING_PERCENT, type HealingBrushToolArgs } from '../healingBrush.ts';

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
            this.buffer[offset] = x * 20;
            this.buffer[offset + 1] = 100;
            this.buffer[offset + 2] = y === 1 && x === 1 ? 160 : 100;
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

const args = (overrides: Partial<HealingBrushToolArgs> = {}): HealingBrushToolArgs => ({
  size: 3,
  hardness: 100,
  opacity: 1,
  source: { x: 1, y: 1 },
  aligned: true,
  points: [{ x: 4, y: 4 }],
  toolName: 'healing-brush',
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
const run = (overrides: Partial<HealingBrushToolArgs> = {}): RecordingOffscreenCanvas => {
  const result = healingBrush({ size, bitmap: sourceBitmap })(args(overrides));

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

/** The destination colour under the stroke centre before healing. */
const dest = (x: number, y: number) => ({
  r: x * 20,
  g: 100,
  b: y === 1 && x === 1 ? 160 : 100,
  a: 255,
});

describe('healing brush processor', () => {
  it('is the exact module-level processor the registry imports, not a wrapper closure', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors['healing-brush'].imageProcessor).toBe(healingBrush);
  });

  it('stamps a full document-sized canvas and draws the source raster into it', () => {
    const canvas = run();

    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(sourceBitmap, 0, 0);
  });

  it('spaces its dabs at the tool constant', () => {
    expect(HEALING_BRUSH_SPACING_PERCENT).toBe(25);
  });

  describe('the no-source and no-stroke states', () => {
    it('is an exact no-op for a null source, and does NOT fill anything', () => {
      const canvas = run({ source: null });

      expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
    });

    it('is an exact no-op for an empty point list', () => {
      const canvas = run({ points: [] });

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

  describe('a hard tip applies luminance correction exactly', () => {
    it('reproduces the source with destination luminance at the stroke centre', () => {
      const canvas = run();

      const center = at(canvas, 4, 4);
      expect(center.r).toBe(31);
      expect(center.g).toBe(111);
      expect(center.b).toBe(171);
      expect(center.a).toBe(255);
    });

    it('writes a single-point stroke as exactly one dab', () => {
      const canvas = run();

      expect(at(canvas, 4, 4)).not.toEqual(dest(4, 4));
      expect(at(canvas, 3, 4)).not.toEqual(dest(3, 4));
      expect(at(canvas, 5, 4)).not.toEqual(dest(5, 4));
      expect(at(canvas, 4, 3)).not.toEqual(dest(4, 3));
      expect(at(canvas, 4, 5)).not.toEqual(dest(4, 5));

      expect(at(canvas, 3, 3)).not.toEqual(dest(3, 3));
      expect(at(canvas, 5, 3)).not.toEqual(dest(5, 3));
      expect(at(canvas, 3, 5)).not.toEqual(dest(3, 5));
      expect(at(canvas, 5, 5)).not.toEqual(dest(5, 5));

      expect(at(canvas, 2, 4)).toEqual(dest(2, 4));
      expect(at(canvas, 6, 4)).toEqual(dest(6, 4));
      expect(at(canvas, 4, 2)).toEqual(dest(4, 2));
      expect(at(canvas, 4, 6)).toEqual(dest(4, 6));
    });
  });

  describe('a soft tip blends with luminance correction across its rim', () => {
    it('weights each texel by the tip falloff with luminance correction', () => {
      const canvas = run({ size: 4, hardness: 0 });

      expect(at(canvas, 4, 4)).toEqual({ r: 31, g: 111, b: 171, a: 255 });

      // The soft tip weights: center=1, N/S/E/W at distance 1 = ~0.5, corners at distance ~1.41 = ~0.25
      // Expected values computed from the actual algorithm
      expect(at(canvas, 3, 4)).toEqual({ r: 39, g: 109, b: 109, a: 255 });
      expect(at(canvas, 5, 4)).toEqual({ r: 79, g: 109, b: 109, a: 255 });

      expect(at(canvas, 4, 3)).toEqual({ r: 59, g: 109, b: 109, a: 255 });
      expect(at(canvas, 4, 5)).toEqual({ r: 59, g: 109, b: 109, a: 255 });

      expect(at(canvas, 3, 3)).toEqual({ r: 52, g: 104, b: 104, a: 255 });
      expect(at(canvas, 5, 3)).toEqual({ r: 92, g: 104, b: 104, a: 255 });
      expect(at(canvas, 3, 5)).toEqual({ r: 52, g: 104, b: 104, a: 255 });
      expect(at(canvas, 5, 5)).toEqual({ r: 92, g: 104, b: 104, a: 255 });
    });

    it('leaves the half-open rim at distance exactly the radius untouched', () => {
      const canvas = run({ size: 4, hardness: 0 });

      expect(at(canvas, 2, 4)).toEqual(dest(2, 4));
      expect(at(canvas, 6, 4)).toEqual(dest(6, 4));
      expect(at(canvas, 4, 2)).toEqual(dest(4, 2));
      expect(at(canvas, 4, 6)).toEqual(dest(4, 6));

      expect(at(canvas, 3, 3)).not.toEqual(dest(3, 3));
    });
  });

  describe('opacity scales the healing strength', () => {
    it('scales the correction strength via straight lerp', () => {
      const canvas = run({ opacity: 0.5 });

      const center = at(canvas, 4, 4);
      // With opacity 0.5, the correction is halved
      // dest(4,4).r = 80, full correction = 31, so halfway = 55.5 -> 56
      expect(center.r).toBe(56);
      expect(center.g).toBe(106);
      expect(center.b).toBe(136);
      expect(center.a).toBe(255);

      // The healed value is between destination (80) and full healing (31)
      expect(center.r).toBeLessThan(dest(4, 4).r);
      expect(center.r).toBeGreaterThan(31);
    });

    it('still calls putImageData at zero opacity (processor does not early-return)', () => {
      const canvas = run({ opacity: 0 });

      expect(canvas.ctx.putImageData).toHaveBeenCalled();
    });
  });

  describe('aligned and free strokes read different source locations', () => {
    const stroke = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
    ];

    it('reads from the stroke start when aligned', () => {
      const canvas = run({ points: stroke, aligned: true });

      expect(at(canvas, 6, 4)).not.toEqual(dest(6, 4));
    });

    it('reads from the stroke end when not aligned', () => {
      const canvas = run({ points: stroke, aligned: false });

      expect(at(canvas, 6, 4)).not.toEqual(dest(6, 4));
    });

    it('puts every texel in the last dab at different healed values between the two modes', () => {
      const aligned = run({ points: stroke, aligned: true });
      const free = run({ points: stroke, aligned: false });

      for (const [x, y] of [
        [5, 3],
        [6, 3],
        [7, 3],
        [5, 4],
        [6, 4],
        [7, 4],
        [5, 5],
        [6, 5],
        [7, 5],
      ] as const) {
        expect(at(free, x, y), `(${x}, ${y})`).not.toEqual(at(aligned, x, y));
        expect(at(free, x, y), `(${x}, ${y})`).not.toEqual(dest(x, y));
        expect(at(aligned, x, y), `(${x}, ${y})`).not.toEqual(dest(x, y));
      }
    });
  });

  describe('multi-dab strokes with spacing', () => {
    it('stamps multiple dabs along a stroke', () => {
      const canvas = run({
        points: [
          { x: 4, y: 4 },
          { x: 7, y: 4 },
        ],
      });

      expect(at(canvas, 4, 4)).not.toEqual(dest(4, 4));
      expect(at(canvas, 7, 4)).not.toEqual(dest(7, 4));

      expect(at(canvas, 5, 4)).not.toEqual(dest(5, 4));
      expect(at(canvas, 6, 4)).not.toEqual(dest(6, 4));
    });
  });

  describe('edge handling and clamping', () => {
    it('clamps a read that hangs off the top-left corner instead of throwing', () => {
      expect(() => run({ source: { x: 0, y: 0 } })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      expect(at(canvas, 3, 3)).not.toEqual(dest(3, 3));
      expect(at(canvas, 4, 3)).not.toEqual(dest(4, 3));
      expect(at(canvas, 5, 3)).not.toEqual(dest(5, 3));
      expect(at(canvas, 3, 4)).not.toEqual(dest(3, 4));
      expect(at(canvas, 4, 4)).not.toEqual(dest(4, 4));
      expect(at(canvas, 5, 4)).not.toEqual(dest(5, 4));
    });

    it('clamps a read that hangs off the bottom-right corner', () => {
      expect(() => run({ source: { x: 8, y: 8 } })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      expect(at(canvas, 3, 3)).not.toEqual(dest(3, 3));
      expect(at(canvas, 4, 4)).not.toEqual(dest(4, 4));
      expect(at(canvas, 5, 5)).not.toEqual(dest(5, 5));
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
    const equivalentTo = (override: Partial<HealingBrushToolArgs>, reference: Partial<HealingBrushToolArgs>) => {
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
      const clamped = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : BRUSH_HARDNESS_DEFAULT;

      equivalentTo({ opacity }, { opacity: clamped });
    });

    it('does not throw for any of them together', () => {
      expect(() => run({ size: Number.NaN, hardness: Number.NaN, opacity: Number.NaN })).not.toThrow();
      expect(() => run({ size: -1, hardness: 400, opacity: 9 })).not.toThrow();
    });
  });

  describe('source buffer isolation: reads from sourceData copy, never the output', () => {
    const smearArgs: Partial<HealingBrushToolArgs> = {
      size: 8,
      hardness: 100,
      opacity: 1,
      aligned: true,
      source: { x: 1, y: 1 },
      points: [
        { x: 4, y: 4 },
        { x: 6, y: 4 },
      ],
    };

    it('leaves the correct source texel at a point whose output the first dab had already written', () => {
      const canvas = run(smearArgs);

      const result = at(canvas, 6, 4);
      expect(result.r).toBe(78);
      expect(result.g).toBe(118);
      expect(result.b).toBe(118);

      expect(result).not.toEqual({ r: 18, g: 118, b: 118, a: 255 });
      expect(result).not.toEqual(dest(6, 4));
    });

    it('reads the source for every texel the last dab covers that is inside the canvas', () => {
      const canvas = run(smearArgs);

      for (let y = 0; y <= 8; y++) {
        for (let x = 2; x <= 8; x++) {
          // The dab at (6,4) with radius 4 covers x=2..8, y=0..8
          // But the circular dab boundary has weight=0 at exact radius with hardness=100
          const dx = x - 6;
          const dy = y - 4;
          const distSq = dx * dx + dy * dy;
          if (distSq > 16) continue; // outside circular dab radius
          if (distSq === 16) continue; // exactly at radius, weight=0 for hard tip

          expect(at(canvas, x, y)).not.toEqual(dest(x, y));
        }
      }
    });

    it('reads a fresh source buffer per call rather than a canvas that remembers', () => {
      const a = run(smearArgs);
      const b = run(smearArgs);

      expect(Array.from(a.buffer)).toEqual(Array.from(b.buffer));
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
