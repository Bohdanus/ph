import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { burn, dodge, tonalAmount, tonalWeight, type DodgeBurnToolArgs, type TonalRange } from '../dodgeBurn.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { Size } from '../../contexts/general-types.ts';
import type { Rgba } from '../../util/pixels.ts';

const documentSize: Size = { width: 512, height: 512 };

/**
 * The global `OffscreenCanvas` stub in `src/test/setup.ts` exposes no handle on the
 * instances it makes and its `getImageData` always answers with a ZERO buffer, so
 * `expect(canvas).toBeTruthy()` is the only assertion available against a real filter and
 * every assertion about WHERE the filter put its result would be asserting nothing.
 *
 * This recorder is the pixel-capable replacement: it is still constructed with `new`, so
 * `vi.stubGlobal` can install it, but it keeps the instance list (so a test can prove which
 * canvas the processor returned) and the canvas's OWN pixels (so a test can read the result
 * the way a browser would, including "the source draw is still there" for the no-op paths).
 *
 * `createPixelCanvasContext` is the documented opt-in from `src/test/setup.ts`; the
 * two read-back methods are then replaced because the stock ones always answer with a zeroed
 * buffer, which is right for a test that needs *some* pixels and wrong for one that needs
 * the fixture. Everything else about the context is the stock mock.
 */
type MockCtx = CanvasRenderingContext2D;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  /** The canvas's own pixels, so a test can read back what a browser would display. */
  readonly pixels: Uint8ClampedArray;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);

    const ctx = createPixelCanvasContext(this);
    // `drawImage` is the only entry point a raster processor has into its output canvas, so
    // the source reaches the pixels here exactly the way it reaches them in a browser.
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.pixels.set(drawn.pixels.subarray(0, this.pixels.length));
    }) as unknown as MockCtx['drawImage']);
    // A COPY, because a real `getImageData` copies: the filter reads this buffer while it
    // writes its own, and an aliasing stub would have the two fight over the same bytes.
    vi.mocked(ctx.getImageData).mockImplementation(
      () =>
        ({
          data: new Uint8ClampedArray(this.pixels),
          width: this.width,
          height: this.height,
          colorSpace: 'srgb',
        }) as ImageData
    );
    vi.mocked(ctx.putImageData).mockImplementation(((image: ImageData, x: number, y: number) => {
      for (let row = 0; row < image.height; row++) {
        const from = row * image.width * 4;
        const to = (y + row) * this.width * 4 + x * 4;
        this.pixels.set(image.data.subarray(from, from + image.width * 4), to);
      }
    }) as unknown as MockCtx['putImageData']);

    this.ctx = ctx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

/** A document-size bitmap filled with `colour`. */
const fill = (colour: [number, number, number, number?]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
  const [r, g, b, a = 255] = colour;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return data;
};

/** The source `ImageBitmap`, carrying the pixels this recorder's `drawImage` copies in. */
const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: documentSize.width, height: documentSize.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const args = (overrides: Partial<DodgeBurnToolArgs> = {}): DodgeBurnToolArgs => ({
  exposure: 50,
  range: 'midtones',
  size: 50,
  hardness: 50,
  toolName: 'dodge',
  points: [{ x: 256, y: 256 }],
  ...overrides,
});

const pixelAt = (data: Uint8ClampedArray, x: number, y: number): Rgba => ({
  r: data[(y * documentSize.width + x) * 4],
  g: data[(y * documentSize.width + x) * 4 + 1],
  b: data[(y * documentSize.width + x) * 4 + 2],
  a: data[(y * documentSize.width + x) * 4 + 3],
});

const render = (processor: typeof dodge | typeof burn, data: Uint8ClampedArray, a: DodgeBurnToolArgs) => {
  const [canvas] = processor({ size: documentSize, bitmap: sourceBitmap(data), previousCanvas: undefined })(a);
  return canvas as unknown as RecordingOffscreenCanvas;
};

const changedPixels = (before: Uint8ClampedArray, after: Uint8ClampedArray): { x: number; y: number }[] => {
  const changed: { x: number; y: number }[] = [];
  for (let y = 0; y < documentSize.height; y++) {
    for (let x = 0; x < documentSize.width; x++) {
      const beforeIndex = (y * documentSize.width + x) * 4;
      const afterIndex = beforeIndex;
      if (
        before[beforeIndex] !== after[afterIndex] ||
        before[beforeIndex + 1] !== after[afterIndex + 1] ||
        before[beforeIndex + 2] !== after[afterIndex + 2] ||
        before[beforeIndex + 3] !== after[afterIndex + 3]
      ) {
        changed.push({ x, y });
      }
    }
  }
  return changed;
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dodge and burn are distinct exports', () => {
  it('are two different processor functions', () => {
    expect(dodge).not.toBe(burn);
    expect(typeof dodge).toBe('function');
    expect(typeof burn).toBe('function');
  });

  it('both are two-stage curried processors', () => {
    expect(dodge.length).toBe(1);
    expect(burn.length).toBe(1);
    const innerDodge = dodge({ size: documentSize, bitmap: sourceBitmap(fill([128, 128, 128])) });
    const innerBurn = burn({ size: documentSize, bitmap: sourceBitmap(fill([128, 128, 128])) });
    expect(innerDodge.length).toBe(1);
    expect(innerBurn.length).toBe(1);
  });
});

describe('tonalWeight (pure function)', () => {
  it('returns 1 for shadows when luma is 0', () => {
    // shadows: level < 128, weight = ((128 - level) / 128)^2
    // At luma 0: ((128 - 0) / 128)^2 = 1
    expect(tonalWeight(0, 'shadows')).toBe(1);
  });

  it('returns 0 for shadows when luma >= 128 (TONAL_SPLIT)', () => {
    expect(tonalWeight(128, 'shadows')).toBe(0);
    expect(tonalWeight(200, 'shadows')).toBe(0);
  });

  it('returns ~0.984 for midtones at luma 127, and 1 at luma 128', () => {
    // midtones: level <= 128 -> (level / 128)^2, level > 128 -> ((255 - level) / 127)^2
    // At 127: (127/128)^2 = 0.9844...
    expect(tonalWeight(127, 'midtones')).toBeCloseTo((127 / 128) ** 2);
    // At 128: (128/128)^2 = 1
    expect(tonalWeight(128, 'midtones')).toBe(1);
  });

  it('returns 0 for highlights when luma <= 128', () => {
    expect(tonalWeight(0, 'highlights')).toBe(0);
    expect(tonalWeight(127, 'highlights')).toBe(0);
    expect(tonalWeight(128, 'highlights')).toBe(0);
  });

  it('returns 1 for highlights when luma is 255', () => {
    // highlights: level > 128 -> ((level - 128) / 127)^2
    // At 255: ((255 - 128) / 127)^2 = 1
    expect(tonalWeight(255, 'highlights')).toBe(1);
  });

  it('returns 0 for an invalid range string', () => {
    expect(tonalWeight(100, 'invalid' as TonalRange)).toBe(0);
  });

  it('returns 0 for non-finite luma', () => {
    expect(tonalWeight(NaN, 'midtones')).toBe(0);
    expect(tonalWeight(Infinity, 'midtones')).toBe(0);
  });
});

describe('tonalAmount (pure function)', () => {
  it('is zero when coverage is zero', () => {
    expect(tonalAmount(128, 'midtones', 50, 0)).toBe(0);
  });

  it('is zero when exposure is zero', () => {
    expect(tonalAmount(128, 'midtones', 0, 1)).toBe(0);
  });

  it('is positive for dodge (positive exposure)', () => {
    expect(tonalAmount(128, 'midtones', 50, 1)).toBeGreaterThan(0);
  });

  it('is positive for burn (exposure is always positive, sign is in processor)', () => {
    // tonalAmount itself doesn't know about dodge vs burn, it just computes the magnitude
    // The sign is applied in shiftPaintedChannels
    expect(tonalAmount(128, 'midtones', 50, 1)).toBeGreaterThan(0);
  });

  it('scales linearly with coverage', () => {
    const half = tonalAmount(128, 'midtones', 50, 0.5);
    const full = tonalAmount(128, 'midtones', 50, 1);
    expect(full).toBe(2 * half);
  });

  it('scales with tonalWeight (band weight)', () => {
    const shadows = tonalAmount(0, 'shadows', 50, 1); // weight = 1
    const midtones = tonalAmount(128, 'midtones', 50, 1); // weight = 1
    // Both have weight 1 at their peaks, so amounts should be equal
    expect(shadows).toBe(midtones);
  });

  it('handles NaN coverage by returning 0', () => {
    expect(tonalAmount(128, 'midtones', 50, NaN)).toBe(0);
  });

  it('handles negative coverage by returning 0', () => {
    expect(tonalAmount(128, 'midtones', 50, -1)).toBe(0);
  });

  it('handles infinite coverage by returning 0', () => {
    expect(tonalAmount(128, 'midtones', 50, Infinity)).toBe(0);
  });

  it('handles infinite exposure by clamping to max', () => {
    expect(tonalAmount(128, 'midtones', Infinity, 1)).toBeGreaterThan(0);
  });

  it('returns 0 when band weight is 0 (wrong range for luma)', () => {
    expect(tonalAmount(0, 'highlights', 50, 1)).toBe(0); // highlights weight at luma 0 is 0
    expect(tonalAmount(255, 'shadows', 50, 1)).toBe(0); // shadows weight at luma 255 is 0
  });
});

describe('dodge processor', () => {
  it('brightens a single pixel under the brush', () => {
    const canvas = render(dodge, fill([100, 100, 100]), args({ exposure: 100, range: 'midtones', size: 10 }));
    const p = pixelAt(canvas.pixels, 256, 256);
    expect(p.r).toBeGreaterThan(100);
    expect(p.g).toBeGreaterThan(100);
    expect(p.b).toBeGreaterThan(100);
  });

  it('leaves a pixel outside the brush untouched', () => {
    const canvas = render(dodge, fill([100, 100, 100]), args({ exposure: 100, range: 'midtones', size: 10 }));
    const p = pixelAt(canvas.pixels, 0, 0);
    expect(p.r).toBe(100);
    expect(p.g).toBe(100);
    expect(p.b).toBe(100);
  });

  it('does nothing on a fully transparent pixel (no colour to dodge)', () => {
    const data = fill([100, 100, 100, 0]);
    const canvas = render(dodge, data, args({ exposure: 100, range: 'midtones', size: 10 }));
    const p = pixelAt(canvas.pixels, 256, 256);
    expect(p.a).toBe(0);
    expect(p.r).toBe(100);
    expect(p.g).toBe(100);
    expect(p.b).toBe(100);
  });

  it('preserves alpha when brightening', () => {
    const data = fill([100, 100, 100, 128]);
    const canvas = render(dodge, data, args({ exposure: 100, range: 'midtones', size: 10 }));
    const p = pixelAt(canvas.pixels, 256, 256);
    expect(p.a).toBe(128);
  });

  it('applies dodge incrementally over previousCanvas', () => {
    // First pass
    const canvas1 = render(dodge, fill([100, 100, 100]), args({ exposure: 50, range: 'midtones', size: 10 }));
    // Second pass using previousCanvas as source
    const canvas2 = render(dodge, canvas1.pixels, args({ exposure: 50, range: 'midtones', size: 10 }));
    // The centre pixel should be brighter after two passes
    expect(pixelAt(canvas2.pixels, 256, 256).r).toBeGreaterThan(pixelAt(canvas1.pixels, 256, 256).r);
  });

  it('uses buildStrokeCoverage internally (integration check)', () => {
    // The processor calls buildStrokeCoverage; if it didn't, the brush would be a single dot
    // rather than a soft circle. A hard brush with hardness=0 would be 1px; we use hardness=50
    // and size=50 so we expect a circular footprint.
    const canvas = render(
      dodge,
      fill([100, 100, 100]),
      args({ exposure: 100, range: 'midtones', size: 50, hardness: 50 })
    );
    const changed = changedPixels(fill([100, 100, 100]), canvas.pixels);
    // With size=50 and hardness=50, we expect a circular region of changed pixels
    expect(changed.length).toBeGreaterThan(1);
    // The footprint should be roughly circular (not a square)
    const center = { x: 256, y: 256 };
    const maxDist = Math.max(...changed.map((p) => Math.hypot(p.x - center.x, p.y - center.y)));
    expect(maxDist).toBeGreaterThan(20); // size=50 -> radius ~25
    expect(maxDist).toBeLessThan(35);
  });
});

describe('burn processor', () => {
  it('darkens a single pixel under the brush', () => {
    const canvas = render(
      burn,
      fill([100, 100, 100]),
      args({ exposure: 100, range: 'midtones', size: 10, toolName: 'burn' })
    );
    const p = pixelAt(canvas.pixels, 256, 256);
    expect(p.r).toBeLessThan(100);
    expect(p.g).toBeLessThan(100);
    expect(p.b).toBeLessThan(100);
  });

  it('leaves a pixel outside the brush untouched', () => {
    const canvas = render(
      burn,
      fill([100, 100, 100]),
      args({ exposure: 100, range: 'midtones', size: 10, toolName: 'burn' })
    );
    const p = pixelAt(canvas.pixels, 0, 0);
    expect(p.r).toBe(100);
    expect(p.g).toBe(100);
    expect(p.b).toBe(100);
  });

  it('does nothing on a fully transparent pixel (no colour to burn)', () => {
    const data = fill([100, 100, 100, 0]);
    const canvas = render(burn, data, args({ exposure: 100, range: 'midtones', size: 10, toolName: 'burn' }));
    const p = pixelAt(canvas.pixels, 256, 256);
    expect(p.a).toBe(0);
    expect(p.r).toBe(100);
    expect(p.g).toBe(100);
    expect(p.b).toBe(100);
  });

  it('preserves alpha when darkening', () => {
    const data = fill([100, 100, 100, 128]);
    const canvas = render(burn, data, args({ exposure: 100, range: 'midtones', size: 10, toolName: 'burn' }));
    const p = pixelAt(canvas.pixels, 256, 256);
    expect(p.a).toBe(128);
  });

  it('applies burn incrementally over previousCanvas', () => {
    // First pass
    const canvas1 = render(
      burn,
      fill([100, 100, 100]),
      args({ exposure: 50, range: 'midtones', size: 10, toolName: 'burn' })
    );
    // Second pass using previousCanvas as source
    const canvas2 = render(burn, canvas1.pixels, args({ exposure: 50, range: 'midtones', size: 10, toolName: 'burn' }));
    // The centre pixel should be darker after two passes
    expect(pixelAt(canvas2.pixels, 256, 256).r).toBeLessThan(pixelAt(canvas1.pixels, 256, 256).r);
  });
});

describe('tonal range targeting', () => {
  // Helper to create a vertical gradient that reaches exactly 0 and 255
  const verticalGradient = (): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let y = 0; y < documentSize.height; y++) {
      // Use (y / (height-1)) to reach exactly 255 at the bottom
      const luma = documentSize.height > 1 ? Math.round((y / (documentSize.height - 1)) * 255) : 0;
      for (let x = 0; x < documentSize.width; x++) {
        const index = (y * documentSize.width + x) * 4;
        data[index] = luma;
        data[index + 1] = luma;
        data[index + 2] = luma;
        data[index + 3] = 255;
      }
    }
    return data;
  };

  it('dodge on shadows only affects dark pixels', () => {
    const data = verticalGradient();
    // Brush at top (shadows, luma=0)
    const canvas = render(dodge, data, args({ exposure: 100, range: 'shadows', size: 30, points: [{ x: 256, y: 0 }] }));
    // Top (shadows) should be brightened, bottom (highlights) unchanged
    expect(pixelAt(canvas.pixels, 256, 0).r).toBeGreaterThan(0);
    expect(pixelAt(canvas.pixels, 256, documentSize.height - 1).r).toBe(255);
  });

  it('dodge on highlights only affects bright pixels', () => {
    const data = verticalGradient();
    // Brush at bottom (highlights, luma=255)
    const canvas = render(
      dodge,
      data,
      args({ exposure: 100, range: 'highlights', size: 30, points: [{ x: 256, y: documentSize.height - 1 }] })
    );
    // Bottom (highlights) already at 255, should stay 255; top (shadows) unchanged
    expect(pixelAt(canvas.pixels, 256, documentSize.height - 1).r).toBe(255);
    expect(pixelAt(canvas.pixels, 256, 0).r).toBe(0);
  });

  it('burn on shadows only affects dark pixels', () => {
    const data = verticalGradient();
    // Brush at top (shadows, luma=0) - already at 0, burn does nothing
    const canvas = render(
      burn,
      data,
      args({ exposure: 100, range: 'shadows', size: 30, points: [{ x: 256, y: 0 }], toolName: 'burn' })
    );
    // Top (shadows) at 0 stays 0; bottom unchanged
    expect(pixelAt(canvas.pixels, 256, 0).r).toBe(0);
    expect(pixelAt(canvas.pixels, 256, documentSize.height - 1).r).toBe(255);
  });

  it('burn on highlights only affects bright pixels', () => {
    const data = verticalGradient();
    // Brush at bottom (highlights, luma=255)
    const canvas = render(
      burn,
      data,
      args({
        exposure: 100,
        range: 'highlights',
        size: 30,
        points: [{ x: 256, y: documentSize.height - 1 }],
        toolName: 'burn',
      })
    );
    // Bottom (highlights) should be darkened; top (shadows) unchanged
    expect(pixelAt(canvas.pixels, 256, documentSize.height - 1).r).toBeLessThan(255);
    expect(pixelAt(canvas.pixels, 256, 0).r).toBe(0);
  });

  it('midtones affects the middle range', () => {
    const data = verticalGradient();
    // Brush at middle (midtones, luma~128)
    const canvas = render(
      dodge,
      data,
      args({
        exposure: 100,
        range: 'midtones',
        size: 30,
        points: [{ x: 256, y: Math.round((documentSize.height - 1) / 2) }],
      })
    );
    // Middle should be brightened, ends unchanged
    expect(pixelAt(canvas.pixels, 256, Math.round((documentSize.height - 1) / 2)).r).toBeGreaterThan(127);
    expect(pixelAt(canvas.pixels, 256, 0).r).toBe(0);
    expect(pixelAt(canvas.pixels, 256, documentSize.height - 1).r).toBe(255);
  });
});

describe('tipSettings clamping', () => {
  it('clamps size to valid range', () => {
    expect(() => render(dodge, fill([100, 100, 100]), args({ size: -10 }))).not.toThrow();
    expect(() => render(dodge, fill([100, 100, 100]), args({ size: 5000 }))).not.toThrow();
    expect(() => render(dodge, fill([100, 100, 100]), args({ size: NaN }))).not.toThrow();
    expect(() => render(dodge, fill([100, 100, 100]), args({ size: Infinity }))).not.toThrow();
  });

  it('clamps hardness to 0..100', () => {
    expect(() => render(dodge, fill([100, 100, 100]), args({ hardness: -5 }))).not.toThrow();
    expect(() => render(dodge, fill([100, 100, 100]), args({ hardness: 150 }))).not.toThrow();
  });

  it('clamps exposure to valid range', () => {
    expect(() => render(dodge, fill([100, 100, 100]), args({ exposure: -500 }))).not.toThrow();
    expect(() => render(dodge, fill([100, 100, 100]), args({ exposure: 500 }))).not.toThrow();
  });

  it('settles non-finite tip settings on safe defaults', () => {
    const canvas = render(dodge, fill([100, 100, 100]), args({ size: NaN, hardness: NaN }));
    // Should not crash, should produce a valid canvas
    expect(canvas.width).toBe(documentSize.width);
    expect(canvas.height).toBe(documentSize.height);
  });
});

describe('zero-size and edge cases', () => {
  it('returns early for zero-width document', () => {
    const size: Size = { width: 0, height: 10 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 0, height: 10, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = dodge({ size, bitmap: bmp })(args());
    // The processor floors width to 0 but OffscreenCanvas constructor uses Math.max(1, ...)
    // so the canvas will be 1x10, not 0x10
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(10);
  });

  it('returns early for zero-height document', () => {
    const size: Size = { width: 10, height: 0 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 10, height: 0, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = dodge({ size, bitmap: bmp })(args());
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(1);
  });

  it('returns early when getImageData/putImageData are not functions', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends RecordingOffscreenCanvas {
        constructor(width: number, height: number) {
          super(width, height);
          this.ctx.getImageData = undefined as unknown as MockCtx['getImageData'];
          this.ctx.putImageData = undefined as unknown as MockCtx['putImageData'];
        }
      } as unknown as typeof OffscreenCanvas
    );

    const data = fill([100, 100, 100]);
    const [canvas] = dodge({ size: documentSize, bitmap: sourceBitmap(data) })(args());
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.width).toBe(documentSize.width);
    expect(recCanvas.height).toBe(documentSize.height);
    // Source should be drawn but no processing occurs
    expect(pixelAt(recCanvas.pixels, 256, 256)).toEqual({ r: 100, g: 100, b: 100, a: 255 });

    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  it('handles non-square documents', () => {
    const size: Size = { width: 800, height: 600 };
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = { width: size.width, height: size.height, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = dodge({ size, bitmap: bmp })(args({ size: 50 }));
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });
});

describe('dodge/burn symmetry', () => {
  it('dodge with exposure X and burn with exposure X on same luma have equal magnitude', () => {
    const data = fill([128, 128, 128]);
    const dodgeCanvas = render(dodge, data, args({ exposure: 50, range: 'midtones', size: 10 }));
    const burnCanvas = render(burn, data, args({ exposure: 50, range: 'midtones', size: 10, toolName: 'burn' }));
    const dodgePixel = pixelAt(dodgeCanvas.pixels, 256, 256);
    const burnPixel = pixelAt(burnCanvas.pixels, 256, 256);
    // dodge brightens by amount, burn darkens by same amount
    expect(dodgePixel.r - 128).toBe(128 - burnPixel.r);
  });

  it('dodge and burn are not involutive (applying both does not return to original)', () => {
    const data = fill([100, 100, 100]);
    const dodgeCanvas = render(dodge, data, args({ exposure: 100, range: 'midtones', size: 10 }));
    const burnCanvas = render(
      burn,
      dodgeCanvas.pixels,
      args({ exposure: 100, range: 'midtones', size: 10, toolName: 'burn' })
    );
    // A 100% dodge followed by 100% burn does not return to original due to different curves
    expect(Math.abs(pixelAt(burnCanvas.pixels, 256, 256).r - 100)).toBeGreaterThan(0);
  });
});

describe('EXPOSURE_GAIN constant behavior', () => {
  it('EXPOSURE_GAIN is 1 and affects the final amount', () => {
    // The constant is not exported, but we can verify its effect:
    // tonalAmount scales exposure by EXPOSURE_GAIN (which is 1)
    // So exposure 50 gives amount proportional to 50, not 50/100 or 50*2
    const data = fill([100, 100, 100]);
    const canvas = render(dodge, data, args({ exposure: 50, range: 'midtones', size: 10 }));
    expect(pixelAt(canvas.pixels, 256, 256).r).toBeGreaterThan(100);
    expect(pixelAt(canvas.pixels, 256, 256).r).toBeLessThan(255);
  });
});

describe('UPPER_HALF asymmetry (127 vs 128)', () => {
  it('luma 127 is in lower half for shadows/midtones boundary', () => {
    expect(tonalWeight(127, 'shadows')).toBeGreaterThan(0);
    expect(tonalWeight(127, 'midtones')).toBeCloseTo((127 / 128) ** 2);
  });

  it('luma 128 is in upper half for midtones/highlights boundary', () => {
    expect(tonalWeight(128, 'shadows')).toBe(0);
    expect(tonalWeight(128, 'midtones')).toBe(1);
    expect(tonalWeight(128, 'highlights')).toBe(0);
  });

  it('luma 129 begins highlights weight', () => {
    expect(tonalWeight(129, 'highlights')).toBeGreaterThan(0);
    expect(tonalWeight(129, 'highlights')).toBeCloseTo(((129 - 128) / 127) ** 2);
  });
});
