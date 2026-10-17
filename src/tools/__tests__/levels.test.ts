import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { levels } from '../levels.ts';
import { BRIGHTNESS_SLIDER_RANGE, CONTRAST_SLIDER_RANGE } from '../functions.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';
import { CanvasFilterUnsupportedError, overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext> & { filter: string };

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

  it('allocates a canvas sized to the source and returns it', () => {
    const result = levels(params)({ brightness: 0, contrast: 0, toolName: 'levels' });

    const canvas = lastCanvas();
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    expect(result).toEqual([canvas]);
  });

  it.each([
    [20, 40, 'brightness(113.33%) contrast(140%)'],
    [-50, 0, 'brightness(66.67%) contrast(100%)'],
    [0, 50, 'brightness(100%) contrast(150%)'],
    [BRIGHTNESS_SLIDER_RANGE.min, CONTRAST_SLIDER_RANGE.min, 'brightness(0%) contrast(50%)'],
    [0, 0, 'brightness(100%) contrast(100%)'],
    [BRIGHTNESS_SLIDER_RANGE.max, CONTRAST_SLIDER_RANGE.max, 'brightness(200%) contrast(200%)'],
  ])('composes brightness=%s and contrast=%s into the expected CSS filter', (brightness, contrast, expected) => {
    levels(params)({ brightness, contrast, toolName: 'levels' });

    expect(lastCanvas().ctx.filter).toBe(expected);
  });

  it('draws the source bitmap once at the origin', () => {
    levels(params)({ brightness: 20, contrast: 40, toolName: 'levels' });

    expect(lastCanvas().ctx.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0);
  });

  it('returns the exact canvas instance it allocated', () => {
    const [result] = levels(params)({ brightness: 5, contrast: 10, toolName: 'levels' });

    expect(result).toBe(lastCanvas());
  });

  it('records the filter through a writable data property', () => {
    levels(params)({ brightness: 3, contrast: 4, toolName: 'levels' });

    const descriptor = Object.getOwnPropertyDescriptor(
      lastCanvas().ctx as unknown as Record<string, unknown>,
      'filter'
    );
    expect(descriptor).toMatchObject({ value: 'brightness(102%) contrast(104%)', writable: true });
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.set).toBeUndefined();
  });

  it.each([
    [Number.NaN, Number.NaN, 'brightness(NaN%) contrast(NaN%)'],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 'brightness(Infinity%) contrast(Infinity%)'],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, 'brightness(-Infinity%) contrast(-Infinity%)'],
  ])('preserves non-finite values for the current known behavior', (brightness, contrast, expected) => {
    expect(() => levels(params)({ brightness, contrast, toolName: 'levels' })).not.toThrow();

    expect(lastCanvas().ctx.filter).toBe(expected);
  });

  it.fails('sanitizes non-finite brightness and contrast before CSS filter emission', () => {
    levels(params)({ brightness: Number.NaN, contrast: Number.NaN, toolName: 'levels' });

    expect(lastCanvas().ctx.filter).not.toContain('NaN');
  });

  it('refuses to allocate when canvas filter support is unavailable', () => {
    overrideCanvasFilterSupport(false);

    expect(() => levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' })).toThrow(
      CanvasFilterUnsupportedError
    );
    expect(() => levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' })).toThrow(
      /^levels requires CanvasRenderingContext2D\.filter/
    );
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });

  it('assigns the filter when support is present', () => {
    overrideCanvasFilterSupport(true);

    const [result] = levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' });
    const canvas = lastCanvas();

    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.ctx.filter).not.toBe('');
    expect(result).toBe(canvas);
  });
});
