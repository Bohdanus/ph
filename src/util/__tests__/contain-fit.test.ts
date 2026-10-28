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

  describe('non-finite dimensions', () => {
    /**
     * `containFit` is the shared arithmetic, so it propagates NaN rather than
     * short-circuiting. `Math.min` yields NaN when either operand is NaN, and the
     * field multiplies flow that NaN through every derived value. A tripwire below
     * pins that it does not throw on this input.
     */
    it('propagates a NaN from the outer width into every derived field', () => {
      const fit = containFit({ width: Number.NaN, height: 200 }, { width: 100, height: 100 });

      expect(fit.scale).toBeNaN();
      expect(fit.innerWidth).toBeNaN();
      expect(fit.innerHeight).toBeNaN();
      expect(fit.offsetX).toBeNaN();
      expect(fit.offsetY).toBeNaN();
      expect(fit.outerWidth).toBe(Number.NaN);
    });

    it('propagates a NaN from the image width into every derived field', () => {
      const fit = containFit({ width: 400, height: 200 }, { width: Number.NaN, height: 100 });

      expect(fit.scale).toBeNaN();
      expect(fit.innerWidth).toBeNaN();
      expect(fit.innerHeight).toBeNaN();
      expect(fit.offsetX).toBeNaN();
      expect(fit.offsetY).toBeNaN();
    });

    it('lets an infinite outer height leave a finite scale but send the offset to infinity', () => {
      // scaleX = 400/100 = 4, scaleY = Infinity, scale = Math.min(4, Infinity) = 4,
      // the image-anchored value. The letterbox gap on the infinite axis is itself
      // infinite, so offsetY is Infinity while every other field stays finite.
      const fit = containFit({ width: 400, height: Infinity }, { width: 100, height: 100 });

      expect(fit.scale).toBe(4);
      expect(fit.innerWidth).toBe(400);
      expect(fit.innerHeight).toBe(400);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(Infinity);
      expect(fit.outerHeight).toBe(Infinity);
    });

    it('collapses to a zero scale when the image is infinite on both axes', () => {
      // outer.width / Infinity = 0 on both axes, so scale = 0; then Infinity * 0 is NaN,
      // so the inner geometry is NaN even though the scale pin is clean.
      const fit = containFit({ width: 400, height: 200 }, { width: Infinity, height: Infinity });

      expect(fit.scale).toBe(0);
      expect(fit.innerWidth).toBeNaN();
      expect(fit.innerHeight).toBeNaN();
      expect(fit.offsetX).toBeNaN();
      expect(fit.offsetY).toBeNaN();
    });

    it('collapses to a zero scale when the image is infinite on one axis', () => {
      // scaleX = 400/Infinity = 0, scaleY = 200/100 = 2, scale = Math.min(0, 2) = 0;
      // innerWidth = Infinity * 0 = NaN while innerHeight = 100 * 0 = 0.
      const fit = containFit({ width: 400, height: 200 }, { width: Infinity, height: 100 });

      expect(fit.scale).toBe(0);
      expect(fit.innerWidth).toBeNaN();
      expect(fit.innerHeight).toBe(0);
      expect(fit.offsetX).toBeNaN();
      expect(fit.offsetY).toBe(100);
    });
  });

  describe('zero and negative dimensions', () => {
    /**
     * Mirrors the zero-container pin above: a zero image dimension is not refused
     * here. 400/0 is Infinity, so a zero-width image pins the scale at Infinity
     * even though the image has no width to draw. Again, no throw.
     */
    it('lets a zero-width image be bounded by its finite counterpart axis', () => {
      // scaleX = 400/0 = Infinity, scaleY = 200/100 = 2, scale = Math.min(Infinity, 2) = 2.
      // The zero axis is not the limiting one, so the scale stays finite; the inner
      // width collapses to 0 instead of going NaN (that only happens when the scale
      // itself is Infinity, see the zero-image case below). Nothing throws.
      const fit = containFit({ width: 400, height: 200 }, { width: 0, height: 100 });

      expect(fit.scale).toBe(2);
      expect(fit.innerWidth).toBe(0);
      expect(fit.innerHeight).toBe(200);
      expect(fit.offsetX).toBe(200);
      expect(fit.offsetY).toBe(0);
    });

    it('pins the scale at Infinity for a zero image', () => {
      const fit = containFit({ width: 400, height: 200 }, { width: 0, height: 0 });

      expect(fit.scale).toBe(Infinity);
      expect(fit.innerWidth).toBeNaN();
      expect(fit.innerHeight).toBeNaN();
      expect(fit.offsetX).toBeNaN();
      expect(fit.offsetY).toBeNaN();
    });

    it('runs the arithmetic unchanged through a negative image width', () => {
      // scaleX = 400/-100 = -4, scaleY = 2, scale = -4; the function does not clamp or
      // flip the sign, so a negative image width produces a negative scale and a
      // negative inner height. Nothing throws.
      const fit = containFit({ width: 400, height: 200 }, { width: -100, height: 100 });

      expect(fit.scale).toBe(-4);
      expect(fit.innerWidth).toBe(400);
      expect(fit.innerHeight).toBe(-400);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(300);
    });

    it('runs the arithmetic unchanged through a negative outer width', () => {
      // scaleX = -400/100 = -4, scaleY = 2, scale = -4; the container is reported as-is.
      const fit = containFit({ width: -400, height: 200 }, { width: 100, height: 100 });

      expect(fit.scale).toBe(-4);
      expect(fit.outerWidth).toBe(-400);
      expect(fit.innerWidth).toBe(-400);
      expect(fit.innerHeight).toBe(-400);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(300);
    });
  });

  describe('aspect ratio edge cases', () => {
    it('fits a same-aspect-ratio image with no letterbox on either axis', () => {
      // Image and container share the 2:1 ratio, so the two axis ratios are equal and
      // both axes are pinned — offsets are exact zero.
      const fit = containFit({ width: 400, height: 200 }, { width: 200, height: 100 });

      expect(fit.scale).toBe(2);
      expect(fit.innerWidth).toBe(400);
      expect(fit.innerHeight).toBe(200);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(0);
    });

    it('downscales a same-aspect-ratio image with no letterbox', () => {
      const fit = containFit({ width: 200, height: 100 }, { width: 400, height: 200 });

      expect(fit.scale).toBe(0.5);
      expect(fit.innerWidth).toBe(200);
      expect(fit.innerHeight).toBe(100);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(0);
    });

    it('letterboxes a wide image on the slack (vertical) axis', () => {
      // scaleX = 400/1000 = 0.4, scaleY = 2, scale = 0.4 (width-pinned); height has slack.
      const fit = containFit({ width: 400, height: 200 }, { width: 1000, height: 100 });

      expect(fit.scale).toBe(0.4);
      expect(fit.innerWidth).toBe(400);
      expect(fit.innerHeight).toBe(40);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(80);
    });

    it('letterboxes a tall image on the slack (horizontal) axis', () => {
      // scaleX = 4, scaleY = 200/1000 = 0.2, scale = 0.2 (height-pinned); width has slack.
      const fit = containFit({ width: 400, height: 200 }, { width: 100, height: 1000 });

      expect(fit.scale).toBe(0.2);
      expect(fit.innerWidth).toBe(20);
      expect(fit.innerHeight).toBe(200);
      expect(fit.offsetX).toBe(190);
      expect(fit.offsetY).toBe(0);
    });

    it('upscales a point image to fill a square container', () => {
      // A 1x1 image has no aspect ratio to speak of, so the two axis ratios are equal
      // and the scale pins both: 100x100 inner, exact fit, no letterbox.
      const fit = containFit({ width: 100, height: 100 }, { width: 1, height: 1 });

      expect(fit.scale).toBe(100);
      expect(fit.innerWidth).toBe(100);
      expect(fit.innerHeight).toBe(100);
      expect(fit.offsetX).toBe(0);
      expect(fit.offsetY).toBe(0);
    });

    it('treats a single-point image against a 4:3 container as height-pinned', () => {
      // scaleX = 400/1 = 400, scaleY = 300/1 = 300, scale = Math.min(400, 300) = 300;
      // width has slack.
      const fit = containFit({ width: 400, height: 300 }, { width: 1, height: 1 });

      expect(fit.scale).toBe(300);
      expect(fit.innerWidth).toBe(300);
      expect(fit.innerHeight).toBe(300);
      expect(fit.offsetX).toBe(50);
      expect(fit.offsetY).toBe(0);
    });
  });

  /**
   * Tripwires: assert that `containFit` does NOT guard against bad input by throwing.
   * These are `it.fails` because the function is deliberately the shared arithmetic —
   * the guards live at the callers that own the measurement (see the note on the zero-
   * container test above and `hooks/__tests__/useContainScale.test.ts`). If any of
   * these starts throwing, the tripwire goes from "expected failure" to "unexpected
   * pass" and fails the suite, which is the regression signal.
   */
  it.fails('throws on a non-finite outer dimension', () => {
    expect(() => containFit({ width: Number.NaN, height: 200 }, { width: 100, height: 100 })).toThrow();
  });

  it.fails('throws on a non-finite image dimension', () => {
    expect(() => containFit({ width: 400, height: 200 }, { width: Infinity, height: 100 })).toThrow();
  });

  it.fails('throws on a zero image dimension', () => {
    expect(() => containFit({ width: 400, height: 200 }, { width: 0, height: 100 })).toThrow();
  });

  it.fails('throws on a negative image dimension', () => {
    expect(() => containFit({ width: 400, height: 200 }, { width: -100, height: 100 })).toThrow();
  });

  it.fails('throws on a negative outer dimension', () => {
    expect(() => containFit({ width: -400, height: 200 }, { width: 100, height: 100 })).toThrow();
  });

  it.fails('clamps a non-finite or zero scale to a usable value', () => {
    // Documented above: no clamping is performed here. A NaN/Infinity/zero scale is
    // returned verbatim and only defended downstream.
    const nanScale = containFit({ width: 400, height: 200 }, { width: Number.NaN, height: 100 });
    const zeroScale = containFit({ width: 0, height: 200 }, { width: 100, height: 100 });
    const infScale = containFit({ width: 400, height: 200 }, { width: 0, height: 100 });

    expect(nanScale.scale).not.toBeNaN();
    expect(zeroScale.scale).toBeGreaterThan(0);
    expect(infScale.scale).toBeLessThan(Infinity);
  });
});
