import { afterEach, describe, expect, it } from 'vitest';

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
