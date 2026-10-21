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
import { textLayerEditTarget } from '../text-layer-edit.ts';
import { NEW_LAYER_ACTION, REPLACE_LAYER_SOURCE_ACTION } from '../../util/constants.ts';
import { createLayerSource } from '../layer-utils.ts';

// The cross-hook idempotency boundary is the DRAFT, not a hook-local guard: the
// text tool clears `text` and `rect` synchronously on Apply, and `commitDirtyTool`
// short-circuits on the cleared draft. The layer factory is stubbed so both commit
// paths can be counted without rasterising anything.
//
// The counter is hoisted so `beforeEach` can rewind it. A `let` inside the factory lives
// in a closure no mock API can reach — `clearAllMocks` clears call history, not a plain
// variable — so the ids grew monotonically for the whole file and every test's first layer
// was named after how many tests ran before it.
const mockLayerId = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../layer-utils.ts', async (importActual) => {
  const actual = await importActual<typeof import('../layer-utils.ts')>();
  const mockCreateLayerSource = vi.fn((params: { source: unknown }): Layer => {
    const sourcePos = (params.source as { pos?: Layer['pos'] } | null)?.pos;
    return {
      id: `mock-layer-${++mockLayerId.counter}`,
      name: 'Mock',
      isBedrock: false,
      tmpCanvas: null,
      bitmap: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: sourcePos ? { ...sourcePos } : { x: 0, y: 0, width: 100, height: 50 },
      presentationBounds: null,
      operations: [],
      source: params.source as Layer['source'],
    };
  });
  return { ...actual, createLayerSource: mockCreateLayerSource as typeof actual.createLayerSource };
});

function makeTextArgs(overrides: Partial<ToolArgs> = {}): ToolArgs {
  return {
    toolName: 'text',
    text: 'Hello',
    angle: 0,
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

function editArgsForExistingLayer(layer: Layer): TextToolArgs {
  const target = textLayerEditTarget(layer, documentFrameFromSize({ width: 800, height: 600 }));
  if (!target) throw new Error('existing layer could not be entered as text');
  return target.args;
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
    // Rewind the id factory so the first layer of every test is `mock-layer-1`. A `let` inside the
    // factory lives in a closure no mock API can reach, so without this the ids grow monotonically
    // for the whole file and a test's ids are named after how many tests ran before it. The
    // exact-id assertion in the fourth test of this describe is what makes the rewind load-bearing.
    mockLayerId.counter = 0;
  });

  it('discards only an untouched placeholder, not user text with the same words', () => {
    const result = setupTextTool();
    const placeholder = makeTextArgs({ text: 'Lorem ipsum', placeholderUntouched: true }) as TextToolArgs;
    act(() => {
      result.current.store.currentArgs.current = placeholder;
      result.current.layers.commitDirtyTool();
    });
    expect(vi.mocked(createLayerSource)).not.toHaveBeenCalled();

    act(() => {
      result.current.store.currentArgs.current = { ...placeholder, placeholderUntouched: false };
      result.current.layers.commitDirtyTool();
    });
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
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

  it('keeps a committed layer angle through re-entry but clears the next draft angle', () => {
    const result = setupTextTool();
    const args = makeTextArgs({ angle: 37, fontSize: 48, tracking: 120, color: '#123456' });

    act(() => {
      result.current.store.currentArgs.current = args;
      result.current.layers.commitDirtyTool();
    });

    const layer = Object.values(result.current.store.layers)[0];
    expect(layer?.source).toMatchObject({ kind: 'tool', args: { angle: 37, fontSize: 48, tracking: 120 } });
    expect(result.current.store.currentArgs.current).toMatchObject({
      text: '',
      rect: null,
      angle: 0,
      fontSize: 48,
      tracking: 120,
      color: '#123456',
    });

    if (!layer) throw new Error('the committed text layer is missing');
    act(() => result.current.layers.beginTextLayerEdit(layer.id));
    const editingArgs = editArgsForExistingLayer(layer);
    expect(editingArgs.angle).toBe(37);

    act(() => {
      result.current.store.currentArgs.current = { ...editingArgs, text: 'Edited' };
      result.current.layers.commitDirtyTool();
    });

    const replacedLayer = Object.values(result.current.store.layers)[0];
    expect(replacedLayer?.source).toMatchObject({ kind: 'tool', args: { angle: 37, text: 'Edited' } });
    expect(result.current.store.currentArgs.current).toMatchObject({ text: '', rect: null, angle: 0 });
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

  it('keeps the raster the replacement rendered, or the layer stops drawing', () => {
    // The one thing the rest of this file's mock cannot see, which is exactly why the defect
    // survived it: `createLayerSource` is stubbed to hand back `tmpCanvas: null`, so a
    // `replaceLayerSource` that also stored `null` looked identical to one that kept what the
    // creator rendered. `getLayerBitmap` re-runs a creator ONLY for the vector tools and a `text`
    // source is excluded, so a text layer with neither `tmpCanvas` nor `bitmap` is declined by
    // `drawLayerSource`, reported as "skipped layer without bitmap", and missing from the export.
    const raster = new OffscreenCanvas(100, 50);
    const result = setupTextTool();
    const args = makeTextArgs();

    act(() => {
      result.current.store.currentArgs.current = args;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });
    // Armed AFTER the create arm, so the single call it replaces is the replace arm's.
    vi.mocked(createLayerSource).mockImplementationOnce((params: { source: unknown }): Layer => ({
      id: 'mock-layer-raster',
      name: 'Mock',
      isBedrock: false,
      tmpCanvas: raster,
      bitmap: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: { x: 0, y: 0, width: 100, height: 50 },
      presentationBounds: null,
      operations: [],
      source: params.source as Layer['source'],
    }));
    act(() => {
      result.current.store.currentArgs.current = makeTextArgs({ text: 'World' });
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    const layer = Object.values(result.current.store.layers)[0];
    expect(layer?.tmpCanvas, 'the replacement dropped the raster its creator had already rendered').toBe(raster);
  });

  it('replaces the selected text layer for distinct text args', () => {
    const result = setupTextTool();
    const argsA = makeTextArgs();
    const argsB = makeTextArgs({ text: 'World', angle: 29, rect: { x1: 0, y1: 0, x2: 200, y2: 60 } });

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

    // TWICE, not once: the create arm renders the new layer and the replace arm renders the
    // replacement. The count was 1 while `replaceLayerSource` stored `tmpCanvas: null`, which is the
    // same defect the raster test above names — a text layer with no raster draws nothing.
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(Object.values(result.current.store.layers).map((layer) => layer.id)).toEqual(['mock-layer-1']);
    expect(Object.values(result.current.store.layers)[0]?.source).toMatchObject({
      kind: 'tool',
      args: { ...argsB, rect: { ...(argsB as TextToolArgs).rect, y2: 80.4 } },
    });
    expect(result.current.store.currentArgs.current).toMatchObject({
      angle: 0,
      fontSize: (argsB as TextToolArgs).fontSize,
    });
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(1);
  });

  it('replaces the selected text layer when the same text is applied again', () => {
    const result = setupTextTool();
    const args = makeTextArgs();

    act(() => {
      result.current.store.currentArgs.current = args;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // The first commit selected the created layer. Re-arming the exact same args edits that
    // selected source instead of leaving a duplicate layer behind.
    act(() => {
      result.current.store.currentArgs.current = args;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // Two renders for the reason the test above gives: one for the create, one for the replacement.
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(1);
  });

  it('commits an empty existing text edit through one replacement with its original geometry', () => {
    const result = setupTextTool();
    const originalArgs = makeTextArgs({ rect: { x1: 100, y1: 50, x2: 200, y2: 100 } });

    act(() => {
      result.current.store.currentArgs.current = originalArgs;
      result.current.layers.commitDirtyTool();
    });
    const originalLayer = result.current.store.layers['mock-layer-1'];
    act(() => result.current.layers.beginTextLayerEdit(originalLayer.id));

    const editingArgs = editArgsForExistingLayer(originalLayer);
    const emptiedArgs = { ...editingArgs, text: '' };
    act(() => {
      result.current.store.currentArgs.current = emptiedArgs;
      result.current.layers.commitDirtyTool();
    });

    const committedLayer = result.current.store.layers[originalLayer.id];
    const originalSource = originalLayer.source;
    if (originalSource?.kind !== 'tool' || originalSource.args.toolName !== 'text') {
      throw new Error('created source was not a text layer');
    }
    const originalRect = originalSource.args.rect;
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.store.layers)).toEqual([originalLayer.id]);
    expect(committedLayer?.source).toMatchObject({
      kind: 'tool',
      args: { text: '', rect: originalRect },
    });
    expect(committedLayer?.pos).toEqual(originalLayer.pos);
    expect(committedLayer?.pos.width).toBeGreaterThan(0);
    expect(committedLayer?.pos.height).toBeGreaterThan(0);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(1);
    expect(result.current.store.currentArgs.current).toMatchObject({ text: '', rect: null });
    expect(result.current.store.currentArgs.current).not.toHaveProperty('editingLayerId');
    expect(result.current.store.previewLayers.current).not.toHaveProperty(originalLayer.id);

    act(() => result.current.layers.commitDirtyTool());
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(result.current.store.layers[originalLayer.id]?.source).toMatchObject({
      kind: 'tool',
      args: { text: '' },
    });
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(1);
  });

  it('closes a new empty text draft without creating an empty layer', () => {
    const result = setupTextTool();
    const emptyDraft = makeTextArgs({ text: '' });

    act(() => {
      result.current.store.currentArgs.current = emptyDraft;
      result.current.layers.commitDirtyTool();
    });

    expect(vi.mocked(createLayerSource)).not.toHaveBeenCalled();
    expect(result.current.store.layers).toEqual({});
    expect(result.current.store.history).toEqual([]);
    expect(result.current.store.currentArgs.current).toMatchObject({ text: '', rect: null });
  });

  it('preserves an empty edit preview and draft when replacement rendering fails', () => {
    const result = setupTextTool();
    const originalArgs = makeTextArgs({ rect: { x1: 100, y1: 50, x2: 200, y2: 100 } });
    act(() => {
      result.current.store.currentArgs.current = originalArgs;
      result.current.layers.commitDirtyTool();
    });
    const originalLayer = result.current.store.layers['mock-layer-1'];
    act(() => result.current.layers.beginTextLayerEdit(originalLayer.id));

    const editingArgs = editArgsForExistingLayer(originalLayer);
    const emptiedArgs = { ...editingArgs, text: '' };
    result.current.store.currentArgs.current = emptiedArgs;
    vi.mocked(createLayerSource).mockImplementationOnce(() => {
      throw new Error('render failed');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    let committed: ReturnType<typeof result.current.layers.commitDirtyTool> = null;
    try {
      act(() => {
        committed = result.current.layers.commitDirtyTool();
      });
    } finally {
      error.mockRestore();
    }

    expect(committed).toBeNull();
    expect(result.current.store.currentArgs.current).toBe(emptiedArgs);
    expect(result.current.store.layers[originalLayer.id]?.source).toEqual(originalLayer.source);
    expect(result.current.store.previewLayers.current[originalLayer.id]?.layer.source).toEqual(originalLayer.source);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(0);
  });

  it('refuses an empty replacement with invalid committed geometry and preserves the edit', () => {
    const result = setupTextTool();
    const originalArgs = makeTextArgs();
    act(() => {
      result.current.store.currentArgs.current = originalArgs;
      result.current.layers.commitDirtyTool();
    });
    const originalLayer = result.current.store.layers['mock-layer-1'];
    const originalSource = originalLayer.source;
    if (originalSource?.kind !== 'tool' || originalSource.args.toolName !== 'text') {
      throw new Error('created source was not a text layer');
    }
    const invalidRect = { x1: 0, y1: 0, x2: 0, y2: 50 };
    result.current.store.layers[originalLayer.id] = {
      ...originalLayer,
      source: { ...originalSource, args: { ...originalSource.args, rect: invalidRect } },
    };
    const emptiedArgs = makeTextArgs({ text: '', editingLayerId: originalLayer.id });
    result.current.store.currentArgs.current = emptiedArgs;

    let committed: ReturnType<typeof result.current.layers.commitDirtyTool> = null;
    act(() => {
      committed = result.current.layers.commitDirtyTool();
    });

    expect(committed).toBeNull();
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
    expect(result.current.store.currentArgs.current).toBe(emptiedArgs);
    expect(result.current.store.layers[originalLayer.id]?.source).toMatchObject({
      kind: 'tool',
      args: { text: 'Hello', rect: invalidRect },
    });
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(0);
  });

  it('preserves the active preview and refuses a duplicate when replacement rendering fails', () => {
    const result = setupTextTool();
    const originalArgs = makeTextArgs();
    act(() => {
      result.current.store.currentArgs.current = originalArgs;
      result.current.layers.commitDirtyTool();
    });
    const originalLayer = result.current.store.layers['mock-layer-1'];
    act(() => result.current.layers.beginTextLayerEdit(originalLayer.id));

    const editedArgs = makeTextArgs({ text: 'Updated', editingLayerId: originalLayer.id });
    result.current.store.currentArgs.current = editedArgs;
    vi.mocked(createLayerSource).mockImplementationOnce(() => {
      throw new Error('render failed');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    let committed: ReturnType<typeof result.current.layers.commitDirtyTool> = null;
    try {
      act(() => {
        committed = result.current.layers.commitDirtyTool();
      });
    } finally {
      error.mockRestore();
    }

    expect(committed).toBeNull();
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.store.layers)).toEqual([originalLayer.id]);
    expect(result.current.store.layers[originalLayer.id]?.source).toEqual(originalLayer.source);
    expect(result.current.store.previewLayers.current[originalLayer.id]?.layer.source).toEqual(originalLayer.source);
    expect(result.current.store.currentArgs.current).toBe(editedArgs);
    expect(result.current.store.history.filter((item) => item.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
    expect(result.current.store.history.filter((item) => item.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(
      0
    );
  });

  it('clears a stale explicit text edit target without creating a duplicate layer', () => {
    const result = setupTextTool();
    const originalArgs = makeTextArgs();
    act(() => {
      result.current.store.currentArgs.current = originalArgs;
      result.current.layers.commitDirtyTool();
    });
    const before = vi.mocked(createLayerSource).mock.calls.length;
    const editedArgs = makeTextArgs({ text: 'Updated', editingLayerId: 'missing-layer' });
    act(() => result.current.layers.beginTextLayerEdit('mock-layer-1'));
    const stalePreview = result.current.store.previewLayers.current['mock-layer-1'];
    if (!stalePreview) throw new Error('no preview for existing text layer');
    delete result.current.store.previewLayers.current['mock-layer-1'];
    result.current.store.previewLayers.current['missing-layer'] = stalePreview;
    result.current.store.currentArgs.current = editedArgs;
    expect(Object.keys(result.current.store.previewLayers.current)).toEqual(['missing-layer']);

    let committed: ReturnType<typeof result.current.layers.commitDirtyTool> = null;
    act(() => {
      committed = result.current.layers.commitDirtyTool();
    });

    expect(committed).toEqual(result.current.store.layers);
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(before);
    expect(Object.keys(result.current.store.layers)).toEqual(['mock-layer-1']);
    expect(result.current.store.currentArgs.current).toMatchObject({ text: '', rect: null });
    expect(result.current.store.currentArgs.current).not.toHaveProperty('editingLayerId');
    expect(result.current.store.previewLayers.current).not.toHaveProperty('missing-layer');
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
    // Same rewind as the suite above, for the same reason.
    mockLayerId.counter = 0;
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
