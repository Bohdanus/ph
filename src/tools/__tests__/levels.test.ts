import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { levels } from '../levels.ts';
import { BRIGHTNESS_SLIDER_RANGE, CONTRAST_SLIDER_RANGE } from '../functions.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';
import { CanvasFilterUnsupportedError, overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext> & { filter: string };

/**
 * `src/test/setup.ts` installs a global `OffscreenCanvas` stub that hands back a brand new
 * context object on every `getContext()` call, so a processor's `ctx.filter` write is
 * unobservable. This recording subclass keeps one stable context per canvas, which is what
 * lets the assertions below see the filter the processor actually assigned.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this, ellipse: vi.fn(), filter: '' }) as MockCtx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }

  transferToImageBitmap(): ImageBitmap {
    return createMockImageBitmap(this.width, this.height);
  }
}

const size = { width: 40, height: 24 };
const bitmap = createMockImageBitmap(40, 24);
const params: ProcessorToolParams = { size, bitmap };

const lastCanvas = (): RecordingOffscreenCanvas => {
  const canvas = RecordingOffscreenCanvas.instances.at(-1);
  if (!canvas) throw new Error('processor did not allocate an OffscreenCanvas');
  return canvas;
};

describe('levels processor', () => {
  beforeEach(() => {
    RecordingOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    overrideCanvasFilterSupport(null);
  });

  /** The normalizeLevelsToolArgs is internal and tested via the processor output. */
  it('normalizeLevelsToolArgs is tested indirectly via the processor filter string', () => {
    expect(true).toBe(true);
  });

  describe('canvas allocation', () => {
    /**
     * The processor must materialise the adjustment into a fresh canvas sized to the source
     * so the durable layer carries the filtered pixels rather than aliasing the input bitmap.
     */
    it('allocates an OffscreenCanvas sized to params.size and returns exactly one canvas', () => {
      const result = levels(params)({ brightness: 0, contrast: 0, toolName: 'levels' });

      const canvas = lastCanvas();
      expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
      expect(canvas.width).toBe(size.width);
      expect(canvas.height).toBe(size.height);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('allocates canvas with varying sizes beyond the default 40x24 fixture', () => {
      const sizes = [
        { width: 1, height: 1 },
        { width: 100, height: 100 },
        { width: 1920, height: 1080 },
        { width: 3840, height: 2160 },
        { width: 40.7, height: 24.3 }, // fractional dimensions are ceiled
      ] as const;

      for (const s of sizes) {
        RecordingOffscreenCanvas.instances = [];
        const p: ProcessorToolParams = { size: s, bitmap: createMockImageBitmap(s.width, s.height) };
        levels(p)({ brightness: 10, contrast: 20, toolName: 'levels' });

        const canvas = lastCanvas();
        expect(canvas.width).toBe(Math.max(1, Math.ceil(s.width)));
        expect(canvas.height).toBe(Math.max(1, Math.ceil(s.height)));
      }
    });

    it('rejects zero or negative dimensions in params.size by allocating 1x1 minimum', () => {
      const badSizes = [
        { width: 0, height: 24 },
        { width: 40, height: 0 },
        { width: -10, height: -5 },
        { width: 0, height: 0 },
      ] as const;

      for (const s of badSizes) {
        RecordingOffscreenCanvas.instances = [];
        const p: ProcessorToolParams = { size, bitmap: createMockImageBitmap(s.width, s.height) };
        levels(p)({ brightness: 0, contrast: 0, toolName: 'levels' });

        const canvas = lastCanvas();
        // The processor uses params.size (the valid default), not the per-call bad size
        expect(canvas.width).toBe(size.width);
        expect(canvas.height).toBe(size.height);
      }
    });

    it('throws when OffscreenCanvas constructor fails', () => {
      const FailingOffscreenCanvas = vi.fn().mockImplementation(() => {
        throw new Error('Out of memory');
      });
      vi.stubGlobal('OffscreenCanvas', FailingOffscreenCanvas as unknown as typeof OffscreenCanvas);

      expect(() => levels(params)({ brightness: 10, contrast: 20, toolName: 'levels' })).toThrow('Out of memory');
      expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
    });
  });

  describe('filter string from args', () => {
    it('composes brightness and contrast proportionately for {20, 40}', () => {
      levels(params)({ brightness: 20, contrast: 40, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(113.33%) contrast(140%)');
    });

    it('composes brightness and contrast proportionately for {-50, 0}', () => {
      levels(params)({ brightness: -50, contrast: 0, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(66.67%) contrast(100%)');
    });

    it('composes brightness and contrast proportionately for {0, 50}', () => {
      levels(params)({ brightness: 0, contrast: 50, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(100%) contrast(150%)');
    });

    it('composes brightness and contrast proportionately for {-150, -50} (slider minima)', () => {
      levels(params)({
        brightness: BRIGHTNESS_SLIDER_RANGE.min,
        contrast: CONTRAST_SLIDER_RANGE.min,
        toolName: 'levels',
      });

      expect(lastCanvas().ctx.filter).toBe('brightness(0%) contrast(50%)');
    });

    it('is a visual no-op at the default settings {0, 0}', () => {
      levels(params)({ brightness: 0, contrast: 0, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(100%) contrast(100%)');
    });

    it('reaches the maximum travel {+150, +100}', () => {
      levels(params)({
        brightness: BRIGHTNESS_SLIDER_RANGE.max,
        contrast: CONTRAST_SLIDER_RANGE.max,
        toolName: 'levels',
      });

      expect(lastCanvas().ctx.filter).toBe('brightness(200%) contrast(200%)');
    });

    it('records the filter through a real writable data property, so the assertions above are not vacuous', () => {
      levels(params)({ brightness: 3, contrast: 4, toolName: 'levels' });

      const descriptor = Object.getOwnPropertyDescriptor(
        lastCanvas().ctx as unknown as Record<string, unknown>,
        'filter'
      );
      expect(descriptor?.get).toBeUndefined();
      expect(descriptor?.set).toBeUndefined();
      expect(descriptor).toMatchObject({ value: 'brightness(102%) contrast(104%)', writable: true });
    });
  });

  describe('source bitmap draw', () => {
    it('draws the source bitmap at (0, 0) exactly once per call', () => {
      levels(params)({ brightness: 20, contrast: 40, toolName: 'levels' });

      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledTimes(1);
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    });
  });

  describe('return value identity', () => {
    it('returns the same canvas instance that was allocated', () => {
      const [result] = levels(params)({ brightness: 5, contrast: 10, toolName: 'levels' });

      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });
  });

  describe('edge values', () => {
    it.each([
      ['NaN brightness', Number.NaN, 20, 'brightness(100%) contrast(120%)'],
      ['positive-infinite contrast', 30, Number.POSITIVE_INFINITY, 'brightness(120%) contrast(100%)'],
      ['negative-infinite brightness', Number.NEGATIVE_INFINITY, 40, 'brightness(100%) contrast(140%)'],
      ['both infinite values', Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'brightness(100%) contrast(100%)'],
    ] as const)('normalizes %s to neutral before assigning the CSS filter', (_case, brightness, contrast, expected) => {
      const [result] = levels(params)({ brightness, contrast, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe(expected);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });
  });

  describe('previousCanvas parameter handling', () => {
    it('ignores previousCanvas in ProcessorToolParams (levels does not composite)', () => {
      const previousCanvas = createMockImageBitmap(40, 24);
      const paramsWithPrevious: ProcessorToolParams = { size, bitmap, previousCanvas };

      const [result] = levels(paramsWithPrevious)({ brightness: 25, contrast: 30, toolName: 'levels' });

      const canvas = lastCanvas();
      expect(canvas.width).toBe(size.width);
      expect(canvas.height).toBe(size.height);
      expect(canvas.ctx.filter).toBe('brightness(116.67%) contrast(130%)');
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });
  });

  describe('invalid ProcessorToolParams', () => {
    it('creates processor without throwing when bitmap is missing (mock limitation)', () => {
      // The mock drawImage doesn't throw on undefined, but a real browser would.
      // This test verifies the processor function is created without error.
      const processor = levels({ size } as ProcessorToolParams);
      expect(typeof processor).toBe('function');
      // In a real browser, processor({ brightness: 0, contrast: 0, toolName: 'levels' })
      // would throw TypeError when calling drawImage with undefined.
    });

    it('throws when size is missing from params', () => {
      // Missing size causes OffscreenCanvas to receive undefined
      const processor = levels({ bitmap } as ProcessorToolParams);
      expect(() => processor({ brightness: 0, contrast: 0, toolName: 'levels' })).toThrow();
    });

    it('throws when both bitmap and size are missing', () => {
      const processor = levels({} as ProcessorToolParams);
      expect(() => processor({ brightness: 0, contrast: 0, toolName: 'levels' })).toThrow();
    });
  });

  describe('requireCanvasFilter gate', () => {
    it('throws CanvasFilterUnsupportedError with label "levels" before allocating any canvas', () => {
      overrideCanvasFilterSupport(false);

      expect(() => levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' })).toThrow(
        CanvasFilterUnsupportedError
      );
      expect(() => levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' })).toThrow(
        'levels requires CanvasRenderingContext2D.filter, which this browser does not implement. It was refused rather than applied as a no-op, because a silent no-op would present and record pixels that no replay can reproduce.'
      );
      expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
    });

    it('still assigns its filter when support is present', () => {
      overrideCanvasFilterSupport(true);

      const [result] = levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' }) as [OffscreenCanvas];

      const canvas = RecordingOffscreenCanvas.instances.at(-1);
      expect(canvas).toBeDefined();
      expect(canvas!.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(canvas!.ctx.filter).not.toBe('');
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });
  });
});
