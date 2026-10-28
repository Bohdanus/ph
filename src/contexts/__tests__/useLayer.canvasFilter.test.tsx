import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import type { ToolArgs } from '../tool-types.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { TOOL_ACTION } from '../../util/constants.ts';

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

const BEDROCK_LAYER = {
  id: 'layer-1',
  name: 'Layer 1',
  isBedrock: true,
  tmpCanvas: null,
  bitmap: { width: 800, height: 600, close: vi.fn() } as unknown as ImageBitmap,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over' as GlobalCompositeOperation,
  order: 0,
  pos: { x: 0, y: 0, width: 800, height: 600 },
  presentationBounds: null,
  operations: [],
  source: undefined,
} as const;

function setupToolWithLayer(toolName: ToolArgs['toolName']) {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });
  act(() => {
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        totalSize: { width: 800, height: 600 },
        documentFrame: documentFrameFromSize({ width: 800, height: 600 }),
        hasImage: true,
        layers: { 'layer-1': { ...BEDROCK_LAYER, operations: [...BEDROCK_LAYER.operations] } },
        activeLayerId: 'layer-1',
      },
    });
  });
  act(() => {
    result.current.dispatch({ type: 'SET_TOOL_NAME', payload: toolName });
  });
  return result;
}

const FILTER_TOOL_ARGS = {
  blur: { toolName: 'blur', radius: 4 },
  color: { toolName: 'color', grayscale: 50, sepia: 0, saturation: 0 },
  levels: { toolName: 'levels', brightness: 10, contrast: 0 },
} as const satisfies Record<string, ToolArgs>;

const FILTER_TOOL_NAMES = ['blur', 'color', 'levels'] as const;

const toolHistoryCount = (store: { history: readonly unknown[] }, toolName: string): number =>
  store.history.filter((item) => (item as { args?: { toolName?: string } }).args?.toolName === toolName).length;

afterEach(() => {
  overrideCanvasFilterSupport(null);
});

describe('a refused ctx.filter tool leaves no history state and no operation', () => {
  it.each(FILTER_TOOL_NAMES)('%s records no history entry and appends no operation', (toolName) => {
    overrideCanvasFilterSupport(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer(toolName);
    const historyBefore = result.current.store.history.length;

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'layer-1', toolArgs: FILTER_TOOL_ARGS[toolName] });
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.history).toHaveLength(historyBefore);
    expect(result.current.store.layers['layer-1'].operations).toHaveLength(0);
    expect(toolHistoryCount(result.current.store, toolName)).toBe(0);
    errorSpy.mockRestore();
  });

  it.each(FILTER_TOOL_NAMES)('%s reports the refusal through console.error', (toolName) => {
    overrideCanvasFilterSupport(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer(toolName);

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'layer-1', toolArgs: FILTER_TOOL_ARGS[toolName] });
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/CanvasRenderingContext2D\.filter/) })
    );
    errorSpy.mockRestore();
  });

  it.each(FILTER_TOOL_NAMES)('%s records exactly one history entry when support is present', (toolName) => {
    overrideCanvasFilterSupport(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer(toolName);
    const historyBefore = result.current.store.history.length;

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'layer-1', toolArgs: FILTER_TOOL_ARGS[toolName] });
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.history.length).toBe(historyBefore + 1);
    expect(toolHistoryCount(result.current.store, toolName)).toBe(1);
    expect(result.current.store.layers['layer-1'].operations).toHaveLength(1);
    expect(result.current.store.history.at(-1)).toMatchObject({ actionName: TOOL_ACTION });
    errorSpy.mockRestore();
  });

  it('a preview that no longer renders still blocks the history entry', () => {
    overrideCanvasFilterSupport(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('blur');
    const historyBefore = result.current.store.history.length;

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'layer-1', toolArgs: FILTER_TOOL_ARGS.blur });
    });

    overrideCanvasFilterSupport(false);
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.history).toHaveLength(historyBefore);
    expect(toolHistoryCount(result.current.store, 'blur')).toBe(0);
    errorSpy.mockRestore();
  });

  it('updateLayerByTool records nothing for a refused tool', async () => {
    overrideCanvasFilterSupport(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('blur');
    const historyBefore = result.current.store.history.length;

    await act(async () => {
      await result.current.layers.updateLayerByTool({ id: 'layer-1', toolArgs: FILTER_TOOL_ARGS.blur });
    });

    expect(result.current.store.history).toHaveLength(historyBefore);
    expect(result.current.store.layers['layer-1'].operations).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it('updateLayerByTool records exactly one entry for a permitted tool', async () => {
    overrideCanvasFilterSupport(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('levels');
    const historyBefore = result.current.store.history.length;

    await act(async () => {
      await result.current.layers.updateLayerByTool({ id: 'layer-1', toolArgs: FILTER_TOOL_ARGS.levels });
    });

    expect(toolHistoryCount(result.current.store, 'levels')).toBe(1);
    expect(result.current.store.history.length).toBe(historyBefore + 1);
    errorSpy.mockRestore();
  });

  it('normalizes non-finite Levels args in a live preview before committing the operation', () => {
    overrideCanvasFilterSupport(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('levels');
    let previewed = false;

    act(() => {
      previewed = result.current.layers.tempUpdateLayer({
        id: 'layer-1',
        toolArgs: { toolName: 'levels', brightness: Number.NaN, contrast: 40 },
      });
      result.current.layers.commitDirtyTool();
    });

    const layer = result.current.store.layers['layer-1'];
    const operation = layer.operations[0];
    expect(previewed).toBe(true);
    if (!operation || operation.kind === 'affine-transform') throw new Error('expected a Levels filter operation');
    expect(operation.args).toEqual({ toolName: 'levels', brightness: 0, contrast: 40 });
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: TOOL_ACTION,
      args: { toolName: 'levels', brightness: 0, contrast: 40 },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('normalizes non-finite Levels args before retaining the layer operation and history item', async () => {
    overrideCanvasFilterSupport(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('levels');

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'layer-1',
        toolArgs: { toolName: 'levels', brightness: Number.NaN, contrast: 40 },
      });
    });

    const layer = result.current.store.layers['layer-1'];
    const operation = layer.operations[0];
    if (!operation || operation.kind === 'affine-transform') throw new Error('expected a Levels filter operation');
    expect(operation.args).toEqual({ toolName: 'levels', brightness: 0, contrast: 40 });
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: TOOL_ACTION,
      args: { toolName: 'levels', brightness: 0, contrast: 40 },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('clamps grayscale/sepia and preserves finite saturation before committing the operation', () => {
    overrideCanvasFilterSupport(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('color');
    let previewed = false;

    act(() => {
      previewed = result.current.layers.tempUpdateLayer({
        id: 'layer-1',
        toolArgs: { toolName: 'color', grayscale: -30, sepia: 400, saturation: 200 },
      });
      result.current.layers.commitDirtyTool();
    });

    const layer = result.current.store.layers['layer-1'];
    const operation = layer.operations[0];
    expect(previewed).toBe(true);
    if (!operation || operation.kind === 'affine-transform') throw new Error('expected a Colors filter operation');
    expect(operation.args).toEqual({ toolName: 'color', grayscale: 0, sepia: 100, saturation: 200 });
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: TOOL_ACTION,
      args: { toolName: 'color', grayscale: 0, sepia: 100, saturation: 200 },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('normalizes invalid Colors args before updateLayerByTool history', async () => {
    overrideCanvasFilterSupport(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('color');

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'layer-1',
        toolArgs: {
          toolName: 'color',
          grayscale: -30,
          sepia: Number.POSITIVE_INFINITY,
          saturation: Number.NaN,
        },
      });
    });

    const layer = result.current.store.layers['layer-1'];
    const operation = layer.operations[0];
    if (!operation || operation.kind === 'affine-transform') throw new Error('expected a Colors filter operation');
    expect(operation.args).toEqual({ toolName: 'color', grayscale: 0, sepia: 0, saturation: 0 });
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: TOOL_ACTION,
      args: { toolName: 'color', grayscale: 0, sepia: 0, saturation: 0 },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a non-filter tool is unaffected by an absent filter support', async () => {
    overrideCanvasFilterSupport(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupToolWithLayer('reposition');

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'layer-1',
        toolArgs: { toolName: 'reposition', move: { x: 12, y: 34 } } as unknown as ToolArgs,
      });
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.layers['layer-1'].pos).toEqual({ x: 12, y: 34, width: 800, height: 600 });
    errorSpy.mockRestore();
  });
});
