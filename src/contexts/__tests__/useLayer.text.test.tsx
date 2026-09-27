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

// The cross-hook idempotency boundary is the DRAFT, not a hook-local guard: the
// text tool clears `text` and `rect` synchronously on Apply, and `commitDirtyTool`
// short-circuits on the cleared draft. The layer factory is stubbed so both commit
// paths can be counted without rasterising anything.
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

describe('useLayers text commit idempotency boundary', () => {
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

    // Path 1 (Apply button) would call createLayerFromTool, but the draft it
    // reads was cleared synchronously, so it short-circuits. Simulate the Apply
    // path by calling commitDirtyTool again — it sees the cleared draft.
    act(() => {
      result.current.layers.commitDirtyTool();
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
    // Simulate onChange clearing the ref (as applyText does in Text.tsx).
    act(() => {
      result.current.store.currentArgs.current = { ...args, text: '', rect: null } as ToolArgs;
    });

    // Path 2: a deferred commit runs afterwards — the draft is already cleared,
    // so it must short-circuit without creating a second layer.
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

  it('repeats the same text verbatim as a new layer, because only the cleared draft suppresses a commit', () => {
    const result = setupTextTool();
    const args = makeTextArgs();

    act(() => {
      result.current.store.currentArgs.current = args;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // The first commit cleared `text` but left the rect in place. Re-arming the
    // exact same args is a new commit, not a duplicate: the boundary is the
    // draft state, not a hook-local comparison against the last committed args.
    act(() => {
      result.current.store.currentArgs.current = args;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.store.layers)).toHaveLength(2);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(2);
  });

  it('commits nothing while the draft rect is cleared even if the text survives', () => {
    const result = setupTextTool();

    act(() => {
      result.current.store.currentArgs.current = {
        ...makeTextArgs(),
        rect: null,
      } as ToolArgs;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    expect(vi.mocked(createLayerSource)).not.toHaveBeenCalled();
    expect(Object.keys(result.current.store.layers)).toHaveLength(0);
    expect(result.current.store.history).toEqual([]);
  });

  it('leaves the text tool draft alone when the tool is not text', () => {
    const result = setupTextTool();
    const args = makeTextArgs();

    act(() => {
      result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'shape' });
    });
    act(() => {
      result.current.store.currentArgs.current = args;
    });

    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // The text branch is keyed on the active tool, so switching away leaves the
    // shared draft completely untouched.
    expect(vi.mocked(createLayerSource)).not.toHaveBeenCalled();
    expect(result.current.store.currentArgs.current).toBe(args);
    expect(result.current.store.history).toEqual([]);
  });
});
