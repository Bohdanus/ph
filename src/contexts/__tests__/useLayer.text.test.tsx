import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolArgs } from '../tool-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import type { Layer, ToolLayerSource } from '../layer-types.ts';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import { CurrentToolProvider, useCurrentTool } from '../useCurrentTool.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
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
  const mockCreateLayerSource = vi.fn((params: { source: unknown }): Layer => ({
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
    pos: { x: 0, y: 0, width: 100, height: 50 },
    operations: [],
    source: params.source as Layer['source'],
  }));
  return { ...actual, createLayerSource: mockCreateLayerSource as typeof actual.createLayerSource };
});

// `drawAllLayers` is stubbed so a REDRAW is observable as a call rather than as pixels: the two
// paths below restore a raster the store already holds, and neither dispatches anything, so no
// assertion on returned layers or history can tell a repaint from a canvas left showing the layer
// without one. `drawAllLayers` returns early unless the store has a mounted canvas, so the tests
// that care install one.
type DrawLayersToCanvas = (
  canvas: HTMLCanvasElement,
  layers: readonly Layer[],
  documentFrame: DocumentFrame,
  silentMissingLayerIds?: ReadonlySet<string>
) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
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

/**
 * A COMMITTED text layer, seeded rather than created.
 *
 * The `createLayerSource` stub is what makes a commit's own record unobservable: it stores the
 * source args it was handed, and the create arm's rect is the draft's while the replace arm's is
 * the MEASURED one, so no commit in this file produces the pair of records
 * `replaceLayerSource`'s unchanged-args arm is written for. Seeding writes both halves at once, and
 * the two paths under test here — the unchanged-args early return and the text-edit preview — are
 * both about a layer that already exists.
 */
function committedTextLayer(
  id: string,
  overrides: Partial<Layer> = {},
  args: TextToolArgs = makeTextArgs() as TextToolArgs
): Layer {
  const pos = { x: 0, y: 0, width: 100, height: 50 };
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...pos },
    operations: [],
    source: { kind: 'tool', args, pos: { ...pos } } as ToolLayerSource,
    ...overrides,
  };
}

function setupCommittedLayers(layers: Layer[]) {
  const canvas = document.createElement('canvas');
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });
  act(() => {
    // `drawAllLayers` is a no-op without a canvas, so the mount precedes the seed.
    result.current.store.canvasRef.current = canvas;
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers: Object.fromEntries(layers.map((layer) => [layer.id, layer])),
        activeLayerId: layers[0]?.id ?? null,
        totalSize: { width: 800, height: 600 },
        documentFrame: documentFrameFromSize({ width: 800, height: 600 }),
        hasImage: true,
      },
    });
  });
  return { result, canvas };
}

function drawnLayers(callIndex = 0): readonly Layer[] {
  return drawLayersToCanvas.mock.calls[callIndex][1];
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

  it('replaces the layer named by editingLayerId even when the draft starts at another origin', () => {
    // Mutation killed: reducing the replace arm's guard to the origin test alone —
    // `if (pos.x === activeLayer.pos.x && pos.y === activeLayer.pos.y)` with `requestedLayerId`
    // dropped from it. Every test above it re-arms a draft at the SAME origin, so the origin test
    // is satisfied and the mutation is invisible; `editingLayerId` is the explicit in-place signal
    // and it is the only thing that survives a re-entry the user drags out to a new box.
    const result = setupTextTool();

    act(() => {
      result.current.store.currentArgs.current = makeTextArgs();
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });
    expect(Object.keys(result.current.store.layers)).toEqual(['mock-layer-1']);

    act(() => {
      result.current.store.currentArgs.current = {
        ...makeTextArgs({ text: 'World', rect: { x1: 300, y1: 200, x2: 400, y2: 250 } }),
        editingLayerId: 'mock-layer-1',
      } as ToolArgs;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // ONE layer, and its SOURCE carries the box the re-entered editor measured. `layer.pos` is
    // not readable here — the `createLayerSource` stub hands back its own fixed `pos`, so the
    // committed position is read off the source the commit built. A create arm instead stacks a
    // second text layer over the first, and the re-entry's own text is duplicated.
    expect(Object.keys(result.current.store.layers)).toEqual(['mock-layer-1']);
    const layer = Object.values(result.current.store.layers)[0];
    expect(layer?.source).toMatchObject({
      kind: 'tool',
      pos: { x: 300, y: 200 },
      args: { text: 'World', rect: { x1: 0, y1: 0 } },
    });
    const storedRect = (layer?.source as (ToolLayerSource & { args: TextToolArgs }) | undefined)?.args.rect;
    // LAYER-LOCAL again, which is what the measured origin at (300, 200) reduces to — the extent
    // is the box's own, so the only thing a wrong origin changes here is the pair of zeros.
    expect(storedRect && storedRect.x2 - storedRect.x1).toBe(100);
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(2);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(1);
    // The named layer kept its identity and its new text, and the re-entry marker never reaches
    // the persisted source — it is what the next commit reads to decide this is still an edit.
    expect(layer?.id).toBe('mock-layer-1');
    expect(layer?.source).toMatchObject({ kind: 'tool', args: { text: 'World' } });
    expect((layer?.source as ToolLayerSource | undefined)?.args).not.toHaveProperty('editingLayerId');
  });

  it('commits nothing while the draft rect is cleared even if the text survives', () => {
    const result = setupTextTool();

    // The POSITIVE this negative is measured against. Without a commit that does create a layer,
    // every assertion below also holds for a `commitDirtyTool` that does nothing at all, which is
    // why the pair of them proves the guard rather than the absence of the store.
    act(() => {
      result.current.store.currentArgs.current = makeTextArgs();
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });
    expect(Object.keys(result.current.store.layers)).toEqual(['mock-layer-1']);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);

    const clearedRectDraft = { ...makeTextArgs({ text: 'Survivor' }), rect: null } as ToolArgs;
    act(() => {
      result.current.store.currentArgs.current = clearedRectDraft;
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // Unchanged by the refused commit, in every observable: one render, one layer, one history
    // entry, and not even the draft rewritten — a commit that rewrote the draft would also
    // disarm the Apply button the user is looking at.
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.current.store.layers)).toEqual(['mock-layer-1']);
    expect(result.current.store.history).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === REPLACE_LAYER_SOURCE_ACTION)).toHaveLength(0);
    expect(result.current.store.currentArgs.current).toBe(clearedRectDraft);
  });

  it('leaves the text tool draft alone when the tool is not text', () => {
    const result = setupTextTool();

    // The POSITIVE this negative is measured against, for the reason the test above gives: an
    // empty store satisfies "nothing was committed" whether the commit path works or not.
    act(() => {
      result.current.store.currentArgs.current = makeTextArgs();
    });
    act(() => {
      result.current.layers.commitDirtyTool();
    });
    expect(Object.keys(result.current.store.layers)).toEqual(['mock-layer-1']);

    const shapeDraft = makeTextArgs();
    act(() => {
      result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'shape' });
    });
    act(() => {
      result.current.store.currentArgs.current = shapeDraft;
    });

    act(() => {
      result.current.layers.commitDirtyTool();
    });

    // The text branch is keyed on the active tool, so switching away leaves the
    // shared draft completely untouched — measured against the layer and the history
    // entry the text tool itself produced a moment earlier.
    expect(vi.mocked(createLayerSource)).toHaveBeenCalledTimes(1);
    expect(result.current.store.currentArgs.current).toBe(shapeDraft);
    expect(Object.keys(result.current.store.layers)).toEqual(['mock-layer-1']);
    expect(result.current.store.history).toHaveLength(1);
    expect(result.current.store.history.filter((h) => h.actionName === NEW_LAYER_ACTION)).toHaveLength(1);
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

describe('useLayers restores a committed text layer to the canvas', () => {
  beforeEach(() => {
    // `clearMocks` already rewinds this, so the rewind is here to be explicit about what the two
    // call-count assertions below depend on: exactly one repaint, produced by the arm under test.
    drawLayersToCanvas.mockClear();
  });

  it('redraws the layer after the unchanged-args early return, so its raster is not left off the canvas', () => {
    // Mutation killed: deleting the `drawAllLayers();` inside `replaceLayerSource`'s unchanged-args
    // early return. That arm deletes the layer's preview and returns the layer it was handed, so
    // without the redraw the composited canvas keeps showing a document WITHOUT the raster the
    // editor's contenteditable overlay was standing in for, and nothing repaints it: `Main`'s redraw
    // effect is keyed on `layers`, which this arm does not change. MEASURED on the Esc-to-commit
    // path — re-enter a text layer, press Esc without editing, and the type is gone while the store
    // still holds it. Asserted as a repaint, not as the returned layer: the returned layer is
    // identical with and without the mutation.
    const raster = new OffscreenCanvas(100, 50);
    const args = makeTextArgs() as TextToolArgs;
    const layer = committedTextLayer('committed', { tmpCanvas: raster }, args);
    const { result, canvas } = setupCommittedLayers([layer]);

    // A holder rather than a `let`, because a variable assigned only inside `act` is narrowed to
    // `never` at the assertion and the return value becomes untypeable.
    const outcome: { returned: Layer | null } = { returned: null };
    act(() => {
      // Byte-identical args and the same origin: the arm this test is about, reached without a
      // commit, so nothing about the draft or the measurement can move it off the early return.
      outcome.returned = result.current.layers.replaceLayerSource('committed', {
        kind: 'tool',
        args,
        pos: { x: 0, y: 0, width: 100, height: 50 },
      });
    });

    expect(drawLayersToCanvas).toHaveBeenCalledTimes(1);
    expect(drawLayersToCanvas.mock.calls[0][0]).toBe(canvas);
    expect(drawnLayers().map((drawn) => drawn.id)).toEqual(['committed']);
    // The repaint is the layer WITH its raster, which is the whole of what the early return owes
    // the canvas: the store was already correct, and only the pixels were missing.
    expect(drawnLayers()[0]?.tmpCanvas).toBe(raster);
    expect(outcome.returned?.id).toBe('committed');
    // Still the early return: no render, no dispatch, no history entry for a no-op commit.
    expect(vi.mocked(createLayerSource)).not.toHaveBeenCalled();
    expect(Object.values(result.current.store.layers)).toEqual([layer]);
    expect(result.current.store.history).toEqual([]);
  });

  it('keeps exactly one text-edit preview, so entering a second layer cannot blank the first', () => {
    // Mutation killed: deleting the loop in `beginTextLayerEdit` that deletes every other id from
    // the preview map. The text arm of `commitDirtyTool` returns in all four of its branches before
    // the map is cleared, so the earlier layer's preview survived: its raster is nulled, nothing
    // re-renders a `text` source, and the silent-missing set suppresses the usual report — the first
    // layer's type disappeared from the canvas and stayed gone across any number of tool switches
    // while the export still contained it.
    const first = committedTextLayer('first', { tmpCanvas: new OffscreenCanvas(100, 50) });
    const second = committedTextLayer('second', { tmpCanvas: new OffscreenCanvas(100, 50), order: 1 });
    const { result } = setupCommittedLayers([first, second]);

    act(() => {
      result.current.layers.beginTextLayerEdit('first');
    });

    // One preview, and it withholds only the runtime raster: the contenteditable overlay is the
    // sole visible representation while the source is being edited.
    expect(Object.keys(result.current.store.previewLayers.current)).toEqual(['first']);
    expect(result.current.store.previewLayers.current.first?.layer.tmpCanvas).toBeNull();

    act(() => {
      result.current.layers.beginTextLayerEdit('second');
    });

    // ONE edit at a time. The earlier layer keeps its committed record and its raster — only its
    // preview marker is gone, so it draws again the moment the overlay closes.
    expect(Object.keys(result.current.store.previewLayers.current)).toEqual(['second']);
    expect(result.current.store.previewLayers.current.second?.layer.bitmap).toBeNull();
    expect(result.current.store.layers.first?.tmpCanvas).toBe(first.tmpCanvas);
    // The repaint names only the entered layer as the one whose raster is expected to be missing,
    // so the renderer's silent-missing report cannot describe either.
    const published = drawLayersToCanvas.mock.calls.at(-1)![3]!;
    expect([...published]).toEqual(['second']);
    expect(drawnLayers(drawLayersToCanvas.mock.calls.length - 1).map((drawn) => drawn.id)).toEqual(['first', 'second']);
  });
});
