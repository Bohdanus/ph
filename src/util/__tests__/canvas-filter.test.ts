import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CanvasFilterUnsupportedError,
  isCanvasFilterSupported,
  overrideCanvasFilterSupport,
  requireCanvasFilter,
  supportsCanvasFilter,
} from '../canvas-filter.ts';
import { createMockCanvasContext } from '../../test/setup.ts';

const asOffscreenCtx = (ctx: unknown) => ctx as OffscreenCanvasRenderingContext2D;

/**
 * Safari up to 17.6: the property exists, the assignment is accepted, and the read-back still
 * reports the default. `ctx.filter` being a data property on the harness mock is exactly what
 * makes this shape worth a test rather than a comment — it is the shape the probe must reject.
 */
const safariStyleContext = () => ({
  get filter(): string {
    return 'none';
  },
  set filter(_value: string) {},
});

afterEach(() => {
  // Unstub FIRST: `overrideCanvasFilterSupport(null)` re-probes the live environment, so
  // probing while a stubbed `OffscreenCanvas` is still installed would leave the module
  // reading `false` for the next test.
  vi.unstubAllGlobals();
  overrideCanvasFilterSupport(null);
});

describe('supportsCanvasFilter verifies the value round-trips', () => {
  it('returns true for the harness context while support is enabled', () => {
    expect(supportsCanvasFilter(asOffscreenCtx(createMockCanvasContext({ width: 4, height: 4 })))).toBe(true);
  });

  it('returns false for a Safari-style context that discards the write', () => {
    expect(supportsCanvasFilter(asOffscreenCtx(safariStyleContext()))).toBe(false);
  });

  it('restores the previous filter value it replaced', () => {
    const ctx = createMockCanvasContext({ width: 4, height: 4 });
    ctx.filter = 'blur(2px)';

    supportsCanvasFilter(asOffscreenCtx(ctx));

    expect(ctx.filter).toBe('blur(2px)');
  });

  it('is what the module-load probe used, so the default follows the environment', () => {
    // Main's harness mock makes `ctx.filter` a readable data property, so the module-load probe
    // finds support in jsdom. That is the whole reason no existing test turns red on this landing.
    expect(isCanvasFilterSupported()).toBe(true);

    overrideCanvasFilterSupport(false);
    expect(isCanvasFilterSupported()).toBe(false);

    overrideCanvasFilterSupport(null);
    expect(isCanvasFilterSupported()).toBe(true);
  });
});

/**
 * The three early returns inside `detectCanvasFilterSupport` are reached only through
 * `overrideCanvasFilterSupport(null)`, and in the jsdom harness none of them fires: the
 * setup file installs an `OffscreenCanvas` whose `getContext` returns a context with a
 * writable `filter`. Every arm is therefore untested, and each is the difference between
 * "this browser cannot do it" and "this module threw while importing".
 *
 * `stubGlobal` rather than a plain assignment so the harness value is restored afterwards;
 * `afterEach` calls `overrideCanvasFilterSupport(null)`, which re-probes the environment,
 * so a leaked global would turn the NEXT test red rather than this one.
 */
describe('the environment probe reports absence rather than throwing', () => {
  it('reports unsupported when there is no OffscreenCanvas at all', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);

    overrideCanvasFilterSupport(null);

    expect(isCanvasFilterSupported()).toBe(false);
  });

  it('reports unsupported when a 2d context cannot be obtained', () => {
    // `getContext` returning null is a real browser outcome (context loss, or a context
    // type the platform will not give), and the guard is what keeps it from reaching the
    // probe, where `ctx.filter` on null would throw inside the try and be swallowed into
    // the same answer by accident rather than by design.
    class NullContextCanvas {
      getContext(): null {
        return null;
      }
    }
    vi.stubGlobal('OffscreenCanvas', NullContextCanvas);

    overrideCanvasFilterSupport(null);

    expect(isCanvasFilterSupported()).toBe(false);
  });

  it('reports unsupported when constructing the probe canvas throws', () => {
    class ThrowingCanvas {
      constructor() {
        throw new Error('allocation refused');
      }
    }
    vi.stubGlobal('OffscreenCanvas', ThrowingCanvas);

    expect(() => overrideCanvasFilterSupport(null)).not.toThrow();
    expect(isCanvasFilterSupported()).toBe(false);
  });

  it('restores the previous answer once the real environment is back', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    overrideCanvasFilterSupport(null);
    expect(isCanvasFilterSupported()).toBe(false);

    vi.unstubAllGlobals();
    overrideCanvasFilterSupport(null);

    expect(isCanvasFilterSupported()).toBe(true);
  });
});

describe('requireCanvasFilter refuses loudly', () => {
  it('throws naming the label when support is absent', () => {
    overrideCanvasFilterSupport(false);

    expect(() => requireCanvasFilter('Layer filter tool "blur"')).toThrow(/Layer filter tool "blur"/);
    expect(() => requireCanvasFilter('Layer filter tool "blur"')).toThrow(/CanvasRenderingContext2D\.filter/);
  });

  it('says why it refused instead of applying nothing', () => {
    overrideCanvasFilterSupport(false);

    expect(() => requireCanvasFilter('blur')).toThrow(/refused rather than applied as a no-op/);
  });

  it('carries the label and the error name for a caller that discriminates on it', () => {
    overrideCanvasFilterSupport(false);

    const error = (() => {
      try {
        requireCanvasFilter('levels');
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(CanvasFilterUnsupportedError);
    expect(error).toBeInstanceOf(Error);
    expect((error as CanvasFilterUnsupportedError).label).toBe('levels');
    expect((error as CanvasFilterUnsupportedError).name).toBe('CanvasFilterUnsupportedError');
  });

  it('does not throw when support is present', () => {
    overrideCanvasFilterSupport(true);

    expect(() => requireCanvasFilter('Layer filter tool "blur"')).not.toThrow();
  });
});
