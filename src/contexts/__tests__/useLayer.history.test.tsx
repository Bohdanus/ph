import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import type { Layer } from '../layer-types.ts';
import { TOOL_ACTION } from '../../util/constants.ts';

const layer: Layer = {
  id: 'layer-1',
  name: 'Image',
  isBedrock: false,
  tmpCanvas: null,
  bitmap: { width: 40, height: 20 } as ImageBitmap,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order: 0,
  pos: { x: 0, y: 0, width: 40, height: 20 },
  operations: [],
};

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

describe('useLayers retained history commits', () => {
  it('commits a previewed blur as one retained operation and one history entry', () => {
    const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });
    act(() => {
      result.current.dispatch({
        type: 'BATCH_UPDATES',
        payload: { layers: { [layer.id]: layer }, activeLayerId: layer.id, hasImage: true },
      });
    });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: layer.id,
        toolArgs: { toolName: 'blur', radius: 12 },
      });
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.layers[layer.id].bitmap).toBe(layer.bitmap);
    expect(result.current.store.layers[layer.id].operations).toEqual([
      { id: expect.any(String), args: { toolName: 'blur', radius: 12 }, enabled: true },
    ]);
    expect(result.current.store.history).toMatchObject([
      { actionName: TOOL_ACTION, layerId: layer.id, args: { toolName: 'blur', radius: 12 } },
    ]);
  });
});
