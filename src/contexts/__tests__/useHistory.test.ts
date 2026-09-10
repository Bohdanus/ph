import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NEW_LAYER_ACTION, RENAME_LAYER_ACTION } from '../../util/constants.ts';
import { useHistory } from '../useHistory.ts';
import type { HistoryItem } from '../history-types.ts';

const useStoreMock = vi.fn();

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => useStoreMock(),
}));

type TestStoreShape = {
  canvasRef: { current: HTMLCanvasElement | null };
  history: HistoryItem[];
  historyIndex: number;
  layers: object;
  deletedLayers: object;
};

function createStoreState(history: HistoryItem[]): TestStoreShape {
  const drawCtx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };

  return {
    canvasRef: {
      current: {
        getContext: vi.fn(() => drawCtx),
      } as unknown as HTMLCanvasElement,
    },
    history,
    historyIndex: history.length - 1,
    layers: {},
    deletedLayers: {},
  };
}

function createLayerSource(isBedrock = true) {
  return {
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    isBedrock,
    size: { width: 128, height: 64 },
  };
}

function createHistory(sourceIn: 'layerSource' | 'args'): HistoryItem[] {
  const source = createLayerSource();
  const firstItemBase = {
    id: 'h-1',
    layerId: 'layer-1',
    actionName: NEW_LAYER_ACTION,
    imagePromise: Promise.resolve(null),
  };

  const firstItem =
    sourceIn === 'layerSource' ? { ...firstItemBase, layerSource: source } : { ...firstItemBase, args: source };

  return [
    firstItem,
    {
      id: 'h-2',
      layerId: 'layer-1',
      actionName: RENAME_LAYER_ACTION,
      args: { name: 'Layer 1' },
      imagePromise: Promise.resolve(null),
    },
  ] as HistoryItem[];
}

describe('useHistory undo replay', () => {
  beforeAll(() => {
    class MockOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return {
          fillStyle: '#ffffff',
          globalAlpha: 1,
          fillRect: vi.fn(),
        };
      }
    }

    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (bitmap: unknown) => bitmap)
    );
  });

  beforeEach(() => {
    useStoreMock.mockReset();
  });

  it('undoes history when NEW_LAYER source is stored in layerSource', () => {
    const dispatch = vi.fn();
    const storeState = createStoreState(createHistory('layerSource'));
    useStoreMock.mockReturnValue([storeState, dispatch]);

    const { undo } = useHistory();

    expect(() => undo()).not.toThrow();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BATCH_UPDATES',
      })
    );
  });

  it('keeps compatibility with history where NEW_LAYER source is stored in args', () => {
    const dispatch = vi.fn();
    const storeState = createStoreState(createHistory('args'));

    useStoreMock.mockReturnValue([storeState, dispatch]);

    const { undo } = useHistory();

    expect(() => undo()).not.toThrow();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BATCH_UPDATES',
      })
    );
  });
});
