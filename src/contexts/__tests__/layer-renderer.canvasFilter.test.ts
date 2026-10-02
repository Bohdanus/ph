import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawLayersToCanvas, drawLayerSource } from '../layer-renderer.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createLayerOperation } from '../layer-utils.ts';
import type { Layer, LayerOperationArgs } from '../layer-types.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import { makeMockCtx } from '../../__tests__/canvas-mock.ts';

const FRAME = documentFrameFromSize({ width: 64, height: 64 });

const FILTER_TOOL_NAMES = ['blur', 'color', 'levels'] as const;

const filterArgs = (toolName: (typeof FILTER_TOOL_NAMES)[number]): LayerOperationArgs =>
  ({
    blur: { toolName: 'blur', radius: 3 },
    color: { toolName: 'color', grayscale: 50, sepia: 0, saturation: 0 },
    levels: { toolName: 'levels', brightness: 10, contrast: 0 },
  })[toolName] as unknown as LayerOperationArgs;

const makeLayer = (id: string, operations: Layer['operations']): Layer =>
  ({
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: 64, height: 64, close: vi.fn() } as unknown as ImageBitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: 64, height: 64 },
    operations,
    source: undefined,
  }) as unknown as Layer;

const renderLayers = (layers: readonly Layer[]): boolean => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  return drawLayersToCanvas(canvas, layers, FRAME);
};

afterEach(() => {
  overrideCanvasFilterSupport(null);
});

describe('drawLayerSource refuses a filter the destination engine cannot apply', () => {
  it.each(FILTER_TOOL_NAMES)('throws a named CanvasFilterUnsupportedError for %s', (toolName) => {
    overrideCanvasFilterSupport(false);
    const ctx = makeMockCtx();
    const layer = makeLayer('layer-1', [createLayerOperation(filterArgs(toolName))]);

    expect(() => drawLayerSource(ctx as unknown as CanvasRenderingContext2D, layer)).toThrow(
      /CanvasRenderingContext2D\.filter/
    );
    // The refusal precedes the assignment: an unfiltered drawImage would present pixels no replay
    // reproduces, which is the failure the error message names. `''` is the mock's seeded value,
    // never a filter string.
    expect(ctx.filter).toBe('');
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it.each(FILTER_TOOL_NAMES)('names the tool, not the composed CSS string, for %s', (toolName) => {
    overrideCanvasFilterSupport(false);
    const ctx = makeMockCtx();
    const layer = makeLayer('layer-1', [createLayerOperation(filterArgs(toolName))]);

    expect(() => drawLayerSource(ctx as unknown as CanvasRenderingContext2D, layer)).toThrow(
      new RegExp(`Layer filter tool "${toolName}"`)
    );
  });

  it.each(FILTER_TOOL_NAMES)('draws normally for %s when support is present', (toolName) => {
    overrideCanvasFilterSupport(true);
    const ctx = makeMockCtx();
    const layer = makeLayer('layer-1', [createLayerOperation(filterArgs(toolName))]);

    expect(drawLayerSource(ctx as unknown as CanvasRenderingContext2D, layer)).toBe(true);
  });

  it('a layer with no filter operation is unaffected', () => {
    overrideCanvasFilterSupport(false);
    const ctx = makeMockCtx();

    expect(drawLayerSource(ctx as unknown as CanvasRenderingContext2D, makeLayer('layer-1', []))).toBe(true);
  });

  it('a disabled filter operation is unaffected', () => {
    overrideCanvasFilterSupport(false);
    const ctx = makeMockCtx();
    const operation = { ...createLayerOperation(filterArgs('blur')), enabled: false };

    // The disabled operation contributes nothing to the composed filter, so it is `'none'` — a value
    // every engine honours — and the refusal never fires for it.
    expect(drawLayerSource(ctx as unknown as CanvasRenderingContext2D, makeLayer('layer-1', [operation]))).toBe(true);
    expect(ctx.filter).toBe('none');
  });
});

describe('drawLayersToCanvas isolates an unhonorable filter to its own layer', () => {
  it.each(FILTER_TOOL_NAMES)('still publishes the document when one %s layer is refused', (toolName) => {
    overrideCanvasFilterSupport(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const published = renderLayers([
      makeLayer('plain', []),
      makeLayer('filtered', [createLayerOperation(filterArgs(toolName))]),
      makeLayer('after', []),
    ]);

    expect(published).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      'skipped layer whose filter this browser cannot apply',
      'filtered',
      expect.objectContaining({ message: expect.stringMatching(/CanvasRenderingContext2D\.filter/) })
    );
    errorSpy.mockRestore();
  });

  it('does not touch the target canvas for a non-filter failure', () => {
    overrideCanvasFilterSupport(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(renderLayers([makeLayer('plain', [])])).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
