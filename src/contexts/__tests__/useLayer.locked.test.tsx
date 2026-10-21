import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { defaultSettings } from '../../tools/settings.ts';
import type { ToolArgs } from '../tool-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import { LOCK_LAYER_ACTION } from '../../util/constants.ts';

/**
 * Imported and panel-locked layers share the same full-lock guard. It must cover every raster tool
 * at the common mutation boundary rather than relying on individual tool areas to refuse writes.
 */

const drawLayersToCanvas = vi.hoisted(() => vi.fn(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

const size = { width: 800, height: 600 };

/**
 * The global `OffscreenCanvas` stub in `src/test/setup.ts` has no `getImageData`, and every
 * stamping raster tool needs one — `tempUpdateLayer` catches the resulting `TypeError` and
 * returns, which would make the UNLOCKED control below fail for a reason that has nothing to do
 * with the lock. This is the documented pixel-capable opt-in from the same file.
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

function makeLayer(id: string, order: number, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: 40, height: 20 } as ImageBitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos: { x: 0, y: 0, width: 40, height: 20 },
    presentationBounds: null,
    operations: [],
    ...overrides,
  };
}

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

function setup(layers: LayersRecord) {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });

  act(() => {
    result.current.store.canvasRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers,
        activeLayerId: Object.keys(layers)[0] ?? null,
        totalSize: { ...size },
        documentFrame: documentFrameFromSize(size),
        hasImage: true,
      },
    });
  });

  return { result };
}

const eraserArgs = (): ToolArgs =>
  ({
    ...defaultSettings.eraser,
    toolName: 'eraser',
    points: [
      { x: 4, y: 4 },
      { x: 30, y: 16 },
    ],
  }) as unknown as ToolArgs;

const previewIds = (result: { current: ReturnType<typeof useLayerHarness> }) =>
  Object.keys(result.current.store.previewLayers.current);

const historyLength = (result: { current: ReturnType<typeof useLayerHarness> }) => result.current.store.history.length;

beforeEach(() => {
  drawLayersToCanvas.mockClear();
  vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a locked layer refuses the raster commit path', () => {
  it('refuses in-place source replacement for locked text layers', () => {
    const source = {
      kind: 'tool' as const,
      args: { toolName: 'text', text: 'Original' } as ToolArgs,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    };
    const locked = setup({ text: makeLayer('text', 0, { locked: true, source }) });

    const replaced = locked.result.current.layers.replaceLayerSource('text', {
      kind: 'tool',
      args: { toolName: 'text', text: 'Replacement' } as ToolArgs,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    });

    expect(replaced).toBeNull();
    expect(locked.result.current.store.layers.text?.source).toEqual(source);
    expect(historyLength(locked.result)).toBe(0);
  });

  it('does not start a preview edit for a locked text layer', () => {
    const source = {
      kind: 'tool' as const,
      args: { toolName: 'text', text: 'Original' } as ToolArgs,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    };
    const locked = setup({ text: makeLayer('text', 0, { locked: true, source }) });

    act(() => locked.result.current.layers.beginTextLayerEdit('text'));

    expect(previewIds(locked.result)).toEqual([]);
  });

  it('refuses Lock All while a text edit is active', () => {
    const editing = setup({ photo: makeLayer('photo', 0) });
    act(() => {
      editing.result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'text' });
      editing.result.current.store.currentArgs.current = {
        toolName: 'text',
        text: 'Draft',
        rect: { x1: 2, y1: 2, x2: 30, y2: 18 },
      } as ToolArgs;
    });

    act(() => editing.result.current.layers.updateLayer('photo', { locked: true }, LOCK_LAYER_ACTION));

    expect(editing.result.current.store.layers.photo?.locked).toBe(false);
    expect(historyLength(editing.result)).toBe(0);
  });

  it('keeps the text layer being edited when a remove action is requested', () => {
    const source = {
      kind: 'tool' as const,
      args: { toolName: 'text', text: 'Original' } as ToolArgs,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    };
    const editing = setup({ text: makeLayer('text', 0, { source }) });
    act(() => {
      editing.result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'text' });
      editing.result.current.store.currentArgs.current = {
        toolName: 'text',
        text: 'Draft',
        rect: { x1: 2, y1: 2, x2: 30, y2: 18 },
        editingLayerId: 'text',
      } as ToolArgs;
    });

    act(() => editing.result.current.layers.removeLayer('text'));

    expect(editing.result.current.store.layers.text).toBeDefined();
    expect(editing.result.current.store.layers.text?.source).toEqual(source);
    expect(historyLength(editing.result)).toBe(0);
  });

  it('writes no live pixels for it, where the same stroke on an unlocked layer does', () => {
    const locked = setup({ photo: makeLayer('photo', 0, { locked: true }) });
    act(() => locked.result.current.layers.tempUpdateLayer({ id: 'photo', toolArgs: eraserArgs() }));
    expect(previewIds(locked.result)).toEqual([]);

    const unlocked = setup({ photo: makeLayer('photo', 0) });
    act(() => unlocked.result.current.layers.tempUpdateLayer({ id: 'photo', toolArgs: eraserArgs() }));
    // The control. Without it, "nothing happened" would be satisfied by a broken processor.
    expect(previewIds(unlocked.result)).toEqual(['photo']);
  });

  it('appends no history entry for it, so undo cannot appear to do nothing', async () => {
    const locked = setup({ photo: makeLayer('photo', 0, { locked: true }) });
    const before = historyLength(locked.result);

    await act(async () => {
      await locked.result.current.layers.updateLayerByTool({ id: 'photo', toolArgs: eraserArgs() });
    });

    // A history entry with no pixel change behind it is the failure this guard exists to prevent:
    // the user presses undo, nothing moves, and the layer comes back looking broken.
    expect(historyLength(locked.result)).toBe(before);
    expect(previewIds(locked.result)).toEqual([]);

    const unlocked = setup({ photo: makeLayer('photo', 0) });
    const unlockedBefore = historyLength(unlocked.result);
    await act(async () => {
      await unlocked.result.current.layers.updateLayerByTool({ id: 'photo', toolArgs: eraserArgs() });
    });
    expect(historyLength(unlocked.result)).toBeGreaterThan(unlockedBefore);
  });

  it('refuses every raster tool, because the guard is the path and not a per-tool check', async () => {
    // The scope claim: `commit: 'raster'` is one branch of `tempUpdateLayer`, so a check placed in
    // a tool area would cover that tool only. A representative sample from the other families —
    // the tonal pair and the clone stamp — is what makes that a fact about the path.
    for (const toolName of ['dodge', 'burn', 'clone-stamp'] as const) {
      const locked = setup({ photo: makeLayer('photo', 0, { locked: true }) });
      const before = historyLength(locked.result);
      const toolArgs = {
        ...defaultSettings[toolName],
        toolName,
        points: [{ x: 4, y: 4 }],
      } as unknown as ToolArgs;

      act(() => locked.result.current.layers.tempUpdateLayer({ id: 'photo', toolArgs }));
      await act(async () => {
        await locked.result.current.layers.updateLayerByTool({ id: 'photo', toolArgs });
      });

      expect(previewIds(locked.result)).toEqual([]);
      expect(historyLength(locked.result)).toBe(before);
    }
  });

  it('leaves a layer that is merely invisible and transparent-layer-free alone', () => {
    // The negative arm. `locked` defaults to false on every construction path, so a guard that
    // tested truthiness of some other field would take this layer down with it.
    const layer = makeLayer('photo', 0, { visible: false, opacity: 0.5 });
    const { result } = setup({ photo: layer });

    act(() => result.current.layers.tempUpdateLayer({ id: 'photo', toolArgs: eraserArgs() }));

    expect(previewIds(result)).toEqual(['photo']);
  });
});
