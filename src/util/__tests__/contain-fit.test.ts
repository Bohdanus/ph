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
});
