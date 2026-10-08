import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three option-bar thumbnails — Paint, Draw and Shape — all set a backing store of exactly
 * `96 x 48` from hardcoded constants and laid out at exactly `96 x 48` CSS px, so the bitmap the
 * browser upscales on a 2x display is 96 px wide no matter what. They are also the only canvases in
 * the app whose bitmap is resampled rather than merely scaled, which is why they read as the softest
 * thing on screen.
 *
 * What must NOT change is the apparent size. `brushScale` is the workspace contain fit, so the
 * thumbnail is a miniature of the stroke at the size it will actually have on the canvas; a dpr
 * factor belongs in the RASTER, not in the on-screen geometry.
 */

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

/**
 * Async-aware on purpose. The bodies below `await` their render, and a plain `try/finally` would
 * restore the original ratio the moment the promise was CREATED — so the component under test would
 * mount at dpr 1 no matter what the caller set, and every assertion at 2 would quietly be a test of
 * the 1x path. Awaiting the body before restoring is what makes the override real.
 */
async function withDpr<T>(value: number, body: () => T | Promise<T>): Promise<T> {
  const original = window.devicePixelRatio;
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
  try {
    return await body();
  } finally {
    Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
  }
}

/** One shared probe: the canvas a thumbnail renders, and the args it renders with. */
const drawMock = vi.hoisted(() => ({ size: null as { width: number; height: number } | null, args: null as any }));
vi.mock('../../../tools/draw.ts', () => ({
  draw:
    ({ size }: { size: { width: number; height: number } }) =>
    (args: any) => {
      drawMock.size = size;
      drawMock.args = args;
      return [document.createElement('canvas')];
    },
}));

vi.mock('../../../tools/shape.ts', () => ({
  // The Sides and Star Ratio constants and normalizers are named by the Shape bar at module
  // scope, so a mock that omits them fails the whole file at import rather than one
  // assertion: the named import resolves to undefined and the JSX below never renders.
  //
  // The keys have to exist; the LOGIC must not. A previous version of this mock
  // re-implemented the normalizer's bounds, which is a third copy of the same three
  // constants in the repo — and replacing the body with `() => 999` left all 13 tests
  // passing, because nothing in this file types into the field. A copy that is dead
  // today and divergent tomorrow is worse than no copy, so these are inert.
  DEFAULT_POLYGON_SIDES: 5,
  MIN_POLYGON_SIDES: 3,
  MAX_POLYGON_SIDES: 100,
  polygonSides: () => 5,
  DEFAULT_STAR_RATIO: 50,
  MIN_STAR_RATIO: 1,
  MAX_STAR_RATIO: 99,
  starRatio: () => 50,
  shape:
    ({ size }: { size: { width: number; height: number } }) =>
    (args: any) => {
      drawMock.size = size;
      drawMock.args = args;
      return [document.createElement('canvas')];
    },
}));

/**
 * Both spellings the three bars use. `Paint` calls `getToolArgs(toolName)`; `Draw` and `Shape`
 * read `toolArgs` off the hook and cast it. A mock carrying only one of the two renders two of the
 * three bars with `args === undefined`, which is not a state any of them has a path through.
 */
const TOOL_ARGS = {
  color: '#000000',
  lineWidth: 10,
  penType: 'pen',
  toolName: 'brush',
  alpha: 1,
  lineDash: [10, 10],
  smoothing: 0,
  pointShape: 'round',
  pointCount: 3,
  figure: 'rectangle',
  shapeMode: 'fill',
  lineCap: 'round',
  lineJoin: 'round',
  cornerRadius: 0,
  sides: 3,
} as const;

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: TOOL_ARGS,
    getToolArgs: () => TOOL_ARGS,
    patchToolArgs: vi.fn(),
    setToolArgs: vi.fn(),
  }),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      color: '#000000',
      containerRef: { current: null },
      totalSize: { width: 100, height: 100 },
    },
  ],
}));

// `usePointerPosition` normally hands the contain fit back through `onResize`; the preview effect
// returns early until it has one, so the stub has to supply a non-zero scale or nothing draws.
vi.mock('../../../hooks/usePointerPosition.ts', async () => {
  // The real hook raises `onResize` from an effect, and it has to stay that way: calling it during
  // render would setState during render and React would stop with "too many re-renders".
  const { useLayoutEffect } = await import('react');
  return {
    usePointerPosition: ({ onResize }: { onResize?: (d: { scale: number }) => void }) => {
      useLayoutEffect(() => onResize?.({ scale: 1 }), [onResize]);
      return { getLocalCoords: () => ({ x: 0, y: 0 }) };
    },
  };
});

/**
 * Found structurally rather than by a test id, so pinning the backing store does not require adding
 * a test-only attribute to three production canvases.
 */
function previewCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('the bar rendered no preview canvas');
  return canvas;
}

beforeEach(() => {
  drawMock.size = null;
  drawMock.args = null;
});

afterEach(() => vi.clearAllMocks());

describe('option-bar thumbnail resolution', () => {
  /**
   * All THREE bars, not one probe standing in for three.
   *
   * An earlier version of this file rendered `Paint` only, on the argument that the three render
   * "the same 96x48 preview through the same two lines". That is an argument, not a pin, and it
   * does not survive a per-file mutation: dropping `dpr` from `Draw.tsx`'s raster or from
   * `Shape.tsx`'s leaves every assertion here green, because neither component is ever mounted.
   * `Draw` and `Shape` are separate implementations with separately-spelled expressions, so each
   * is rendered and each is asserted.
   */
  const BARS = [
    { name: 'Paint', load: async () => (await import('../Paint/Paint.tsx')).createPaintToolbar('brush') },
    { name: 'Draw', load: async () => (await import('../Draw/Draw.tsx')).default },
    { name: 'Shape', load: async () => (await import('../Figures/Shape.tsx')).default },
  ] as const;

  it.each(BARS)('$name keeps a 1:1 store at dpr 1, which is the behaviour that already worked', async ({ load }) => {
    await withDpr(1, async () => {
      const Bar = await load();
      const { container } = render(<Bar />);
      await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

      expect(previewCanvas(container).width).toBe(PREVIEW_WIDTH);
      expect(previewCanvas(container).height).toBe(PREVIEW_HEIGHT);
    });
  });

  it.each(BARS)('$name multiplies the backing store by the ratio at dpr 2', async ({ load }) => {
    await withDpr(2, async () => {
      const Bar = await load();
      const { container } = render(<Bar />);
      await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

      expect(previewCanvas(container).width).toBe(PREVIEW_WIDTH * 2);
      expect(previewCanvas(container).height).toBe(PREVIEW_HEIGHT * 2);
    });
  });

  it.each(BARS)(
    '$name pins the CSS box with a class, so a larger store does not enlarge the control',
    async ({ load }) => {
      await withDpr(2, async () => {
        const Bar = await load();
        const { container } = render(<Bar />);
        await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

        // `h-12 w-24` is 48px x 96px — PREVIEW_HEIGHT x PREVIEW_WIDTH. Without it the element would
        // take its intrinsic size, which is now the DEVICE size, and the control would double.
        expect(previewCanvas(container).className).toContain('h-12');
        expect(previewCanvas(container).className).toContain('w-24');
      });
    }
  );

  it.each(BARS)('$name renders the stroke at device resolution rather than upscaling a 1x raster', async ({ load }) => {
    await withDpr(2, async () => {
      const Bar = await load();
      await render(<Bar />);
      await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

      // The render target is the DEVICE size, so `drawImage` is 1:1. Had the geometry been left at
      // 1x and only the destination grown, the stroke would have been a doubled bitmap — the same
      // softness the change exists to remove.
      expect(drawMock.size).toEqual({ width: PREVIEW_WIDTH * 2, height: PREVIEW_HEIGHT * 2 });
    });
  });

  it('scales the stroke width with the store, so the preview is the same apparent weight', async () => {
    // Only `Paint` and `Draw` read a width off the tool args, and only `Paint`'s is the one the
    // brush settings reach. `Shape` sizes its stroke from the figure's own settings, so there is
    // no `args.lineWidth` for it to multiply.
    await withDpr(2, async () => {
      const { createPaintToolbar } = await import('../Paint/Paint.tsx');
      const Bar = createPaintToolbar('brush');
      render(<Bar />);
      await vi.waitFor(() => expect(drawMock.args).not.toBeNull());

      // 10 document px at dpr 1, 20 device px at dpr 2 — the same weight on screen.
      expect(drawMock.args.lineWidth).toBe(20);
    });
  });
});
