import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { defaultSettings } from '../../tools/settings.ts';
import type { ToolArgs } from '../tool-types.ts';

/**
 * The invariant this file exists to pin: **a tool commit must not move the document's size or
 * frame.**
 *
 * Why this needs a test when the code looks like it already guarantees it. `projectPublishedTimeline`
 * (`StoreContext.tsx:342-370`) recomputes `totalSize` from `updates.documentFrame` and from nothing
 * else, so a commit payload without those two keys cannot move the document. That is a one-line
 * reading of the reducer, and it is exactly the kind of reading that stops being true the first time
 * someone adds a tool whose commit legitimately wants a new canvas.
 *
 * It already happened once, and it cost the operator a bug report they filed three times. A bedrock
 * source that `history-replay.ts` honoured at ANY index let a commit resize the document on the next
 * replay. The merged repair gates that branch on `index === 0`
 * (`history-replay.ts:90,104`), which stops the replay symptom but is a positional guard: the two
 * defects the plan records alongside it are open, and a payload that carried a frame at all would
 * bypass the question. This test is the cheap half of keeping that closed — it asserts the property
 * at the state the operator sees, where a new tool author will actually meet it.
 *
 * **What this file deliberately does NOT assert, and why that is a decision.** It says nothing about
 * whether a crop *may* grow the document. Adobe's crop can: dragging the crop box past the image edge
 * extends the canvas and the `Fill` control decides what fills it, which the repo records verbatim at
 * `src/tools/descriptions/type-crop.ts:230,302` and marks `status: 'missing'` at `:231`. `trimRect`
 * clamps every edge into the document (`src/util/rect.ts:36-50`), so the app cannot do that today and
 * `docs/OVERRIDES.md` is empty — so by `AGENTS.md` the code is the defect and the decision is the
 * operator's. Pinning the clamp would make implementing `Fill` — or `Image > Canvas Size`, which does
 * not exist yet and is a legitimate future command — fail a test for doing the right thing. That
 * deviation is recorded as a `HANDOFF.md` finding instead. The clamp itself is already pinned harder
 * than anything this file could say, at `src/util/__tests__/rect.test.ts:41-65`, and crop-to-frame is
 * covered at `src/contexts/__tests__/useLayer.lifecycle.test.tsx:702-730`.
 */

const drawLayersToCanvas = vi.hoisted(() => vi.fn(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

const SIZE = { width: 800, height: 600 };

/**
 * The global `OffscreenCanvas` stub in `src/test/setup.ts` has no `getImageData`, and every
 * stamping raster tool needs one — `tempUpdateLayer` catches the resulting `TypeError` and returns
 * without committing. Without this opt-in the raster case below would pass because the commit never
 * happened, which is the one failure mode a test like this cannot have. This is the same documented
 * pixel-capable stub `useLayer.locked.test.tsx` uses.
 */
class PixelOffscreenCanvas {
  width: number;
  height: number;
  readonly ctx: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createPixelCanvasContext(this);
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }
}

beforeEach(() => {
  drawLayersToCanvas.mockClear();
  vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function useHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

type Harness = { current: ReturnType<typeof useHarness> };

function seedDocument(result: Harness) {
  act(() => {
    result.current.store.canvasRef.current = document.createElement('canvas');
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
  });
  act(() => {
    result.current.layers.createBlankLayer({ color: '#ffffff', opacity: 1, size: { ...SIZE }, isBedrock: true }, true);
  });
}

const shapeArgs = (offset: number): ToolArgs =>
  ({
    ...defaultSettings.shape,
    toolName: 'shape',
    figure: 'rectangle',
    color: '#000000',
    backgroundColor: null,
    rect: { x1: 10 + offset, y1: 10 + offset, x2: 70 + offset, y2: 60 + offset },
  }) as unknown as ToolArgs;

describe('a tool commit never carries the document size', () => {
  it('createLayerFromTool dispatches layers and nothing that can resize the document', () => {
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seedDocument(result);

    const before = { ...result.current.store.totalSize };
    const frameBefore = { ...(result.current.store.documentFrame ?? documentFrameFromSize(SIZE)) };
    const historyBefore = result.current.store.history.length;

    act(() => {
      result.current.layers.createLayerFromTool({ args: shapeArgs(0) });
    });

    // The state assertions: what the operator would see.
    expect(result.current.store.totalSize).toEqual(before);
    expect(result.current.store.documentFrame).toEqual(frameBefore);
    // The history assertion: the commit happened, so the above cannot pass by doing nothing.
    expect(result.current.store.history.length).toBe(historyBefore + 1);
  });

  it('updateLayerByTool — the writer every pixel tool funnels through — leaves the size alone', async () => {
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seedDocument(result);

    act(() => {
      result.current.layers.createLayerFromTool({ args: shapeArgs(0) });
    });

    const activeLayerId = result.current.store.activeLayerId as string;
    const before = { ...result.current.store.totalSize };
    const frameBefore = { ...(result.current.store.documentFrame ?? documentFrameFromSize(SIZE)) };
    const historyBefore = result.current.store.history.length;

    await act(async () => {
      result.current.layers.updateLayerByTool({
        id: activeLayerId,
        toolArgs: {
          ...defaultSettings.eraser,
          toolName: 'eraser',
          points: [
            { x: 4, y: 4 },
            { x: 30, y: 16 },
          ],
        } as unknown as ToolArgs,
      });
    });

    // The commit is PROVED, or the two assertions below pass for the wrong reason. This is the
    // control that a `TempUpdateLayer`-swallows-its-error regression cannot survive.
    expect(result.current.store.history.length, 'the raster commit did not happen').toBe(historyBefore + 1);
    expect(result.current.store.totalSize).toEqual(before);
    expect(result.current.store.documentFrame).toEqual(frameBefore);
  });

  it('twenty consecutive shape commits never move it', () => {
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seedDocument(result);

    const before = { ...result.current.store.totalSize };

    for (let i = 0; i < 20; i += 1) {
      act(() => {
        result.current.layers.createLayerFromTool({ args: shapeArgs(i) });
      });
      expect(result.current.store.totalSize, `totalSize moved after commit ${i + 1}`).toEqual(before);
    }

    expect(result.current.store.history.length).toBe(21);
  });

  it('the crop DOES move the size, so the cases above are not green for the wrong reason', () => {
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seedDocument(result);

    // The control. Without it, "no commit moves the size" would be satisfied by a build in which
    // the size could not move at all — and these three cases would be green for the wrong reason.
    // `applyDocumentCrop` is the only production writer that carries a frame, so it is the only
    // control that proves the suite can see a frame land at all.
    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 100, y1: 80, x2: 500, y2: 400 });
    });

    expect(result.current.store.totalSize).toEqual({ width: 400, height: 320 });
    expect(result.current.store.documentFrame).toEqual({ x: 100, y: 80, width: 400, height: 320 });
  });
});
