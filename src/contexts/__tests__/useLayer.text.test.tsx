import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolArgs } from '../tool-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import type { Layer } from '../layer-types.ts';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import { CurrentToolProvider, useCurrentTool } from '../useCurrentTool.tsx';
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

function useSharedDraftHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers(), tool: useCurrentTool() };
}

function withCurrentTool({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <CurrentToolProvider>{children}</CurrentToolProvider>
    </StoreProvider>
  );
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

function setupSharedDraft() {
  const { result } = renderHook(useSharedDraftHarness, { wrapper: withCurrentTool });
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
  // Arm the draft the way `Text.tsx` types it, through the one setter that owns
  // the draft, so the commit below has a draft every reader can see.
  act(() => {
    result.current.tool.setToolArgs(makeTextArgs());
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

  it('leaves the shared draft in the one cleared state the Apply button produces', () => {
    const result = setupTextTool();
    const args = makeTextArgs();

    act(() => {
      result.current.store.currentArgs.current = args;
    });

    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // `Text.tsx` clears `text` AND `rect` before it commits, and the Apply button's
    // disabled condition is `!text || !rect`: a draft that survives either field is
    // still an applicable draft to every reader of this state, so both commit paths
    // have to leave the same cleared shape behind.
    const draft = result.current.store.currentArgs.current as TextToolArgs;
    expect(draft.text).toBe('');
    expect(draft.rect).toBeNull();
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

    // The first commit cleared the draft, and re-arming the exact same args is a new
    // commit, not a duplicate: the boundary is the draft state, not a hook-local
    // comparison against the last committed args.
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

describe('useLayers text commit publishes the cleared draft', () => {
  beforeEach(() => {
    vi.mocked(createLayerSource).mockClear();
  });

  it('clears the draft the Apply button reads when commitDirtyTool commits it', () => {
    const result = setupSharedDraft();

    expect(result.current.tool.getToolArgs('text')).toMatchObject({ text: 'Hello' });

    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // `Text.tsx:86` clears through `setToolArgs`, and its Apply button is disabled on
    // `!text || !rect` of the React args. A commit that only cleared the imperative ref
    // would leave those args armed with text that is already on the canvas.
    const draft = result.current.tool.getToolArgs('text');
    expect(draft).toMatchObject({ text: '', rect: null });
    expect(draft).toBe(result.current.store.currentArgs.current);
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
  });

  it('creates no second layer when the tool is switched away and back after a commit', () => {
    const result = setupSharedDraft();

    act(() => {
      result.current.layers.commitDirtyTool();
    });
    act(() => {
      result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'shape' });
    });
    act(() => {
      result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'text' });
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // Coming back to the tool republishes its `toolState.args` (useCurrentTool.tsx:51).
    // A draft the commit left behind there is a second commit of the same text, not a
    // restored draft the user never asked for.
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
  });

  it('leaves nothing for Apply to commit after commitDirtyTool already committed it', () => {
    const result = setupSharedDraft();

    act(() => {
      result.current.layers.commitDirtyTool();
    });

    const draft = result.current.tool.getToolArgs('text')!;
    if (draft.text && draft.rect) {
      act(() => {
        result.current.layers.createLayerFromTool({ args: draft });
      });
    }

    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
  });
});
