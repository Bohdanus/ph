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
  shape:
    ({ size }: { size: { width: number; height: number } }) =>
    (args: any) => {
      drawMock.size = size;
      drawMock.args = args;
      return [document.createElement('canvas')];
    },
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => ({
      color: '#000000',
      lineWidth: 10,
      penType: 'pen',
      toolName: 'brush',
      alpha: 1,
      lineDash: [10, 10],
      smoothing: 0,
      pointShape: 'round',
      pointCount: 3,
    }),
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
  // The probe below stands in for all three bars: they render the same 96x48 preview through the
  // same two lines, so pinning the store size and the render scale here pins all three.
  async function renderProbe() {
    const { createPaintToolbar } = await import('../Paint/Paint.tsx');
    const PaintBar = createPaintToolbar('brush');
    return render(<PaintBar />);
  }

  it('keeps a 1:1 store at dpr 1, which is the behaviour that already worked', async () => {
    await withDpr(1, async () => {
      const { container } = await renderProbe();
      await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

      expect(previewCanvas(container).width).toBe(PREVIEW_WIDTH);
      expect(previewCanvas(container).height).toBe(PREVIEW_HEIGHT);
    });
  });

  it('multiplies the backing store by the ratio at dpr 2', async () => {
    await withDpr(2, async () => {
      const { container } = await renderProbe();
      await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

      expect(previewCanvas(container).width).toBe(PREVIEW_WIDTH * 2);
      expect(previewCanvas(container).height).toBe(PREVIEW_HEIGHT * 2);
    });
  });

  it('pins the CSS box with a class, so a larger store does not enlarge the control', async () => {
    await withDpr(2, async () => {
      const { container } = await renderProbe();
      await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

      // `h-12 w-24` is 48px x 96px — PREVIEW_HEIGHT x PREVIEW_WIDTH. Without it the element would
      // take its intrinsic size, which is now the DEVICE size, and the control would double.
      expect(previewCanvas(container).className).toContain('h-12');
      expect(previewCanvas(container).className).toContain('w-24');
    });
  });

  it('renders the stroke at device resolution rather than upscaling a 1x raster', async () => {
    await withDpr(2, async () => {
      await renderProbe();
      await vi.waitFor(() => expect(drawMock.size).not.toBeNull());

      // The render target is the DEVICE size, so `drawImage` is 1:1. Had the geometry been left at
      // 1x and only the destination grown, the stroke would have been a doubled bitmap — the same
      // softness the change exists to remove.
      expect(drawMock.size).toEqual({ width: PREVIEW_WIDTH * 2, height: PREVIEW_HEIGHT * 2 });
    });
  });

  it('scales the stroke width with the store, so the preview is the same apparent weight', async () => {
    await withDpr(2, async () => {
      await renderProbe();
      await vi.waitFor(() => expect(drawMock.args).not.toBeNull());

      // 10 document px at dpr 1, 20 device px at dpr 2 — the same weight on screen.
      expect(drawMock.args.lineWidth).toBe(20);
    });
  });
});
