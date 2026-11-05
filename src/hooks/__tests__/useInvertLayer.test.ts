import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInvertLayer } from '../useInvertLayer.ts';

const updateLayerByTool = vi.hoisted(() => vi.fn(async () => undefined));
const stageProcessorInput = vi.hoisted(() => vi.fn());
const getSelectionProcessorSnapshot = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
  layers: {} as Record<string, unknown>,
  activeLayerId: null as string | null,
  selections: [] as unknown[],
  activeSelectionId: null as string | null,
  previewLayers: { current: {} as Record<string, unknown> },
}));

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

vi.mock('../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ updateLayerByTool }),
}));

vi.mock('../../contexts/presentation-evaluator.ts', () => ({ stageProcessorInput }));

vi.mock('../../util/selection.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../util/selection.ts')>()),
  getSelectionProcessorSnapshot,
}));

const bitmap = { width: 10, height: 10 };
const selection = {
  id: 'sel-1',
  isActive: true,
  points: [],
  metadata: { featherRadius: 3, magneticLasso: { antiAlias: false } },
};

const run = async () => {
  const { result } = renderHook(() => useInvertLayer());
  await result.current.invertActiveLayer();
};

beforeEach(() => {
  vi.clearAllMocks();
  storeState.layers = { 'layer-1': { id: 'layer-1', bitmap } };
  storeState.activeLayerId = 'layer-1';
  storeState.selections = [];
  storeState.activeSelectionId = null;
  storeState.previewLayers.current = {};
});

describe('useInvertLayer', () => {
  it('inverts the whole active layer as one tool action when nothing is selected', async () => {
    await run();

    expect(stageProcessorInput).not.toHaveBeenCalled();
    expect(updateLayerByTool).toHaveBeenCalledExactlyOnceWith({ id: 'layer-1', toolArgs: { toolName: 'invert' } });
  });

  it('snapshots the active selection into the staged layer space with its feather and anti-alias', async () => {
    storeState.selections = [selection];
    storeState.activeSelectionId = 'sel-1';
    const bounds = { x: 5, y: 7, width: 10, height: 10 };
    const points = [[{ x: 0, y: 0 }]];
    stageProcessorInput.mockReturnValue({ bounds });
    getSelectionProcessorSnapshot.mockReturnValue({ points });

    await run();

    expect(getSelectionProcessorSnapshot).toHaveBeenCalledWith(selection, bounds);
    expect(updateLayerByTool).toHaveBeenCalledExactlyOnceWith({
      id: 'layer-1',
      toolArgs: { toolName: 'invert', selection: { points, featherRadius: 3, antiAlias: false } },
    });
  });

  it('refuses the bedrock layer, as every raster tool does', async () => {
    storeState.layers = { 'layer-1': { id: 'layer-1', bitmap, isBedrock: true } };

    await run();

    expect(updateLayerByTool).not.toHaveBeenCalled();
  });

  it("leaves another tool's uncommitted preview on the layer alone", async () => {
    storeState.previewLayers.current = { 'layer-1': { layer: {}, toolArgs: { toolName: 'levels' } } };

    await run();

    expect(updateLayerByTool).not.toHaveBeenCalled();
  });

  it.each([
    ['no active layer', () => (storeState.activeLayerId = null)],
    ['a layer with no pixels', () => (storeState.layers = { 'layer-1': { id: 'layer-1' } })],
  ])('does nothing with %s', async (_label, arrange) => {
    arrange();

    await run();

    expect(updateLayerByTool).not.toHaveBeenCalled();
  });

  it('records nothing when the layer cannot be staged for the selection mask', async () => {
    storeState.selections = [selection];
    storeState.activeSelectionId = 'sel-1';
    stageProcessorInput.mockImplementation(() => {
      throw new Error('too large');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await run();

    expect(updateLayerByTool).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
