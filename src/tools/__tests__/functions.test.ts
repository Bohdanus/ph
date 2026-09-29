import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildColorsFilter, buildLevelsFilter, expAdjustment, writeImageToCanvas } from '../functions.ts';

/**
 * These are the load-bearing literals of the whole filter contract. All four emission
 * sites — `colors.ts`, `levels.ts`, `layer-renderer.ts` (preview) and `materialization.ts`
 * (durable) — build their strings from these two functions, so pinning the strings here
 * pins all four at once. The defect this replaced was four independent copies of the same
 * template drifting apart; a site that stopped routing through here would fail its own
 * file's literal expectation instead of silently disagreeing with the other three.
 */
describe('buildColorsFilter', () => {
  it('emits the neutral as a 100% saturate, so the default args are a visual no-op', () => {
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: 0 })).toBe('grayscale(0%) sepia(0%) saturate(100%)');
  });

  it('desaturates: -100 emits saturate(0%), a genuinely grey image', () => {
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: -100 })).toBe(
      'grayscale(0%) sepia(0%) saturate(0%)'
    );
  });

  it('keeps the % on grayscale and sepia, the two arms that were already correct', () => {
    expect(buildColorsFilter({ grayscale: 30, sepia: 80, saturation: 0 })).toBe(
      'grayscale(30%) sepia(80%) saturate(100%)'
    );
  });
});

describe('buildLevelsFilter', () => {
  it('emits the neutral as brightness(100%) contrast(100%)', () => {
    expect(buildLevelsFilter({ brightness: 0, contrast: 0 })).toBe('brightness(100%) contrast(100%)');
  });

  it('reaches black: -100 brightness emits brightness(0%)', () => {
    expect(buildLevelsFilter({ brightness: -100, contrast: 0 })).toBe('brightness(0%) contrast(100%)');
  });

  it('drops contrast to its mid-grey 0% floor at -100', () => {
    expect(buildLevelsFilter({ brightness: 0, contrast: -100 })).toBe('brightness(100%) contrast(0%)');
  });
});

describe('expAdjustment', () => {
  it('anchors the neutral at exactly 1, so a zero adjustment is a visual no-op', () => {
    // The default Colors and Levels args are all zero (`settings.ts:37-38`). If zero did
    // not map to a factor of exactly 1, every freshly opened document would open
    // colour-shifted.
    expect(expAdjustment(0)).toBe(1);
    expect(expAdjustment(0, 2.1)).toBe(1);
    expect(expAdjustment(0, 1.9)).toBe(1);
    expect(expAdjustment(0, 2.2)).toBe(1);
  });

  it('reaches exactly 0 at the -100 end, so brightness can reach black and saturation can desaturate', () => {
    // `Math.exp` is strictly positive, so the un-re-anchored `exp(k * val / 100)` bottoms
    // out at `exp(-k)` — about 15% brightness at k=1.9, a dark grey that never reaches
    // black. These are exact zeros, not approximations of one.
    expect(expAdjustment(-100, 1.9)).toBe(0);
    expect(expAdjustment(-100, 2.1)).toBe(0);
    expect(expAdjustment(-100, 2.2)).toBe(0);
  });

  it('rises above 1 across the positive travel', () => {
    expect(expAdjustment(50, 2.1)).toBeGreaterThan(1);
    expect(expAdjustment(100, 2.1)).toBeGreaterThan(expAdjustment(50, 2.1));
  });

  it('is strictly increasing over the whole -100..100 travel, for every exponent in use', () => {
    for (const k of [1.9, 2.1, 2.2]) {
      for (let val = -100; val < 100; val += 1) {
        expect(expAdjustment(val + 1, k)).toBeGreaterThan(expAdjustment(val, k));
      }
    }
  });

  it('keeps the three exponents distinct, so the adjustments do not share one curve', () => {
    expect(expAdjustment(50, 2.1)).not.toBe(expAdjustment(50, 1.9));
    expect(expAdjustment(50, 1.9)).not.toBe(expAdjustment(50, 2.2));
  });

  it('propagates a non-finite input rather than silently sanitising it', () => {
    // Pin: nothing clamps here. The `it.fails` sanitiser declarations in
    // image-processors.test.ts assert that a non-finite adjustment survives all the way
    // into the composed CSS filter string, so this must stay `NaN`.
    expect(expAdjustment(Number.NaN, 1.9)).toBeNaN();
  });
});

describe('writeImageToCanvas', () => {
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    const ctxObj = { canvas: null as HTMLCanvasElement | null, drawImage: vi.fn() };
    mockCtx = ctxObj as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      ctxObj.canvas = this;
      return mockCtx;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets canvas dimensions and draws the image', () => {
    const canvas = document.createElement('canvas');
    const image = { width: 200, height: 150 } as unknown as HTMLImageElement;
    const result = writeImageToCanvas(image, canvas);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(image, 0, 0);
    expect(result).toBe(mockCtx);
  });

  it('invokes the resize callback with image dimensions', () => {
    const canvas = document.createElement('canvas');
    const callback = vi.fn();
    const image = { width: 300, height: 200 } as unknown as HTMLImageElement;

    writeImageToCanvas(image, canvas, callback);

    expect(callback).toHaveBeenCalledWith(300, 200);
  });

  it('does not throw when callback is omitted', () => {
    const canvas = document.createElement('canvas');
    const image = { width: 10, height: 10 } as unknown as HTMLImageElement;
    expect(() => writeImageToCanvas(image, canvas)).not.toThrow();
  });
});
