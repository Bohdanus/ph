import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolArgs } from '../tool-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import type { Layer } from '../layer-types.ts';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import { NEW_LAYER_ACTION } from '../../util/constants.ts';
import { createLayerSource } from '../layer-utils.ts';

// Isolate the double-commit guard from canvas rasterisation: the fix lives in
// createLayerFromTool's idempotency check, so we stub the layer factory and
// assert that both commit paths yield exactly one layer.
vi.mock('../layer-utils.ts', async (importActual) => {
  const actual = await importActual<typeof import('../layer-utils.ts')>();
  let counter = 0;
  const mockCreateLayerSource = vi.fn((params: { source: unknown }): Layer => ({
    id: `mock-layer-${++counter}`,
    name: 'Mock',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: 100, height: 50 },
    operations: [],
    source: params.source as Layer['source'],
  }));
  return { ...actual, createLayerSource: mockCreateLayerSource as typeof actual.createLayerSource };
});

function makeTextArgs(overrides: Partial<ToolArgs> = {}): ToolArgs {
  return {
    toolName: 'text',
    text: 'Hello',
    fontSize: 64,
    lineHeight: 1.1,
    rect: { x1: 0, y1: 0, x2: 100, y2: 50 },
    bold: false,
    italic: false,
    fontFamily: 'Arial',
    color: '#000000',
    align: 'left',
    ...overrides,
  } as ToolArgs;
}

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

function setupTextTool() {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });
  act(() => {
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        totalSize: { width: 800, height: 600 },
        documentFrame: documentFrameFromSize({ width: 800, height: 600 }),
        hasImage: true,
      },
    });
  });
  act(() => {
    result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'text' });
  });
  return result;
}

describe('useLayers text double-commit deduplication', () => {
  beforeEach(() => {
    vi.mocked(createLayerSource).mockClear();
  });

  it('creates only one layer when Apply fires after commitDirtyTool on the same args', () => {
    const result = setupTextTool();
    const args = makeTextArgs();

    // Simulate dirty text args sitting in the shared ref (user typed text).
    act(() => {
      result.current.store.currentArgs.current = args;
    });

    // Path 2 (deferred commit, e.g. on tool switch / export) commits first and
    // clears only the imperative ref — React toolArgs stay stale.
    act(() => {
      result.current.layers.commitDirtyTool();
    });
    expect((result.current.store.currentArgs.current as TextToolArgs).text).toBe('');

    // Path 1 (Apply button) still sees the same args object via its stale React
    // closure and calls createLayerFromTool — must not create a second layer.
    act(() => {
      result.current.layers.createLayerFromTool({ args });
    });

    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
  });

  it('creates only one layer when commitDirtyTool fires after a direct Apply commit', () => {
    const result = setupTextTool();
    const args = makeTextArgs();

    act(() => {
      result.current.store.currentArgs.current = args;
    });

    // Path 1: Apply commits directly (and clears the ref via onChange).
    act(() => {
      result.current.layers.createLayerFromTool({ args });
    });

    // Path 2: a deferred commit runs afterwards — ref is already cleared, so it
    // must short-circuit without creating a second layer.
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
  });

  it('creates distinct layers for distinct text args', () => {
    const result = setupTextTool();
    const argsA = makeTextArgs();
    const argsB = makeTextArgs({ text: 'World', rect: { x1: 0, y1: 0, x2: 200, y2: 60 } });

    act(() => {
      result.current.store.currentArgs.current = argsA;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    act(() => {
      result.current.store.currentArgs.current = argsB;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.store.layers)).toHaveLength(2);
  });
});
