import { describe, expect, it } from 'vitest';
import { containFit } from '../contain-fit.ts';

describe('containFit', () => {
  it('is the smaller of the two axis ratios', () => {
    // A 400x200 box holding a 100x100 document: 4 across, 2 down, contained at 2.
    const fit = containFit({ width: 400, height: 200 }, { width: 100, height: 100 });

    expect(fit.scale).toBe(2);
    expect(fit.innerWidth).toBe(200);
    expect(fit.innerHeight).toBe(200);
  });

  it('centres the letterbox on the slack axis and pins the other', () => {
    const fit = containFit({ width: 400, height: 200 }, { width: 100, height: 100 });

    // Width slack is 400 - 200 = 200, split either side; height is exact, so there is no gap.
    expect(fit.offsetX).toBe(100);
    expect(fit.offsetY).toBe(0);
  });

  it('reports the container it measured, not the image', () => {
    const fit = containFit({ width: 640, height: 480 }, { width: 800, height: 600 });

    expect(fit.outerWidth).toBe(640);
    expect(fit.outerHeight).toBe(480);
  });

  /**
   * The whole reason this is a shared function rather than arithmetic inlined at each site.
   *
   * `clientX` and `getBoundingClientRect().width` are both CSS px, so the ratio between them is
   * DPR-invariant and a `devicePixelRatio` factor must never appear here. If one were introduced,
   * `getLocalCoords` would return a document point `dpr` times too large and every stroke would
   * land off-target. The app-level twin of this pin lives in
   * `hooks/__tests__/usePointerPosition.test.ts` ("devicePixelRatio independence").
   */
  it('is a function of layout pixels only — no devicePixelRatio anywhere in the result', () => {
    const original = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    try {
      const fit = containFit({ width: 400, height: 200 }, { width: 100, height: 100 });
      expect(fit.scale).toBe(2);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
    }
  });

  /**
   * A container with no size yet yields a scale of exactly 0, because that is what the arithmetic
   * says. It is NOT defended against here on purpose — this function is the shared arithmetic, and
   * every caller divides by what it returns, so the guard belongs with the caller that owns the
   * measurement rather than being baked in where a reader would not look for it. The guard is
   * pinned in `hooks/__tests__/useContainScale.test.ts`, which is where a 0 would actually reach a
   * painter.
   */
  it('reports a zero scale for a degenerate container rather than inventing one', () => {
    const fit = containFit({ width: 0, height: 0 }, { width: 100, height: 100 });

    expect(fit.scale).toBe(0);
  });

  /**
   * `Math.min` is what keeps a DOWNSCALE correct, and it is the direction every existing case
   * here misses: the other tests all upscale, where `max` and `min` disagree in a way the
   * numbers already expose. Downscale 800x600 into 600x300 and the two ratios are 0.75
   * across and 0.5 down, so `min` gives 0.5 and `max` gives 0.75 — which would report a
   * scale that overflows the container on the width axis and a negative letterbox.
   */
  it('takes the smaller ratio when the document is LARGER than the container', () => {
    const fit = containFit({ width: 600, height: 300 }, { width: 800, height: 600 });

    // 600 / 800 = 0.75 across, 300 / 600 = 0.5 down; contained means the smaller.
    expect(fit.scale).toBe(0.5);
    // The document fits exactly on the constrained axis and is letterboxed on the other.
    expect(fit.innerWidth).toBe(400);
    expect(fit.innerHeight).toBe(300);
    expect(fit.offsetX).toBe(100);
    expect(fit.offsetY).toBe(0);
  });

  it('letterboxes on the height axis instead when the container is the narrow one', () => {
    // The mirror of the case above, so `min` has to pick between two cases rather than one.
    const fit = containFit({ width: 600, height: 1200 }, { width: 400, height: 600 });

    // 600 / 400 = 1.5 across, 1200 / 600 = 2 down; contained means the smaller.
    expect(fit.scale).toBe(1.5);
    expect(fit.innerWidth).toBe(600);
    expect(fit.innerHeight).toBe(900);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(150);
  });

  /**
   * Offsets are half the SLACK, so they are never negative and never exceed half the
   * container. Asserting the sign across a grid is the exact oracle for the subtraction
   * order: `(inner - outer) / 2` would still produce plausible-looking magnitudes and would
   * pass every existing assertion in this file, which checks no negative case at all.
   */
  it('never reports a negative offset on either axis', () => {
    for (let outerWidth = 1; outerWidth <= 9; outerWidth++) {
      for (let outerHeight = 1; outerHeight <= 9; outerHeight++) {
        for (const [imageWidth, imageHeight] of [
          [1, 1],
          [3, 7],
          [7, 3],
          [16, 9],
        ]) {
          const fit = containFit(
            { width: outerWidth, height: outerHeight },
            { width: imageWidth, height: imageHeight }
          );

          expect(fit.offsetX, `${outerWidth}x${outerHeight} <- ${imageWidth}x${imageHeight}`).toBeGreaterThanOrEqual(0);
          expect(fit.offsetY, `${outerWidth}x${outerHeight} <- ${imageWidth}x${imageHeight}`).toBeGreaterThanOrEqual(0);
          expect(fit.innerWidth).toBeLessThanOrEqual(outerWidth);
          expect(fit.innerHeight).toBeLessThanOrEqual(outerHeight);
        }
      }
    }
  });

  /**
   * A zero-WIDTH document makes the width ratio `Infinity`, and `Math.min` is the only
   * reason the result stays finite. `max` would return `Infinity` for the scale, and every
   * caller divides by it.
   *
   * The inner width is `0 * 2 = 0` rather than NaN, so the whole result is a degenerate
   * but well-formed letterbox — the degenerate case the zero-container test above covers on
   * the other axis, and the only input shape where the two ratios are not both finite.
   */
  it('keeps the scale finite when one document axis is zero, because min ignores Infinity', () => {
    const fit = containFit({ width: 400, height: 200 }, { width: 0, height: 100 });

    // 400 / 0 is Infinity; 200 / 100 is 2; min is 2.
    expect(fit.scale).toBe(2);
    expect(fit.innerWidth).toBe(0);
    expect(fit.innerHeight).toBe(200);
    expect(fit.offsetX).toBe(200);
    expect(fit.offsetY).toBe(0);
  });
});
