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

  describe('requireCanvasFilter gate', () => {
    it('throws CanvasFilterUnsupportedError with label "levels" before allocating any canvas', () => {
      overrideCanvasFilterSupport(false);

      expect(() => levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' })).toThrow(
        CanvasFilterUnsupportedError
      );
      expect(() => levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' })).toThrow(
        /^levels requires CanvasRenderingContext2D\.filter/
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
