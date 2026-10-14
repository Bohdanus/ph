/**
 * `replayHistory` refuses a malformed entry and returns it on `diagnostics`
 * rather than logging it (`ReplayDiagnostic`, pinned in
 * `history-replay.diagnostics.test.ts`). Somebody has to report it: `replayHistory`
 * runs on every undo, redo and history-panel click, so logging inside the
 * per-entry loop would print the same line forever, and refusing silently loses a
 * user edit with no trace — HANDOFF.md §98 makes the console the app's only error
 * channel. `resetHistoryTo` therefore reports the whole set once the replay it just
 * published succeeded.
 *
 * What is pinned here, in the order the change could regress:
 *
 *  1. a replay that refused nothing reports nothing — the reporting must not become a scrub
 *  2. a refused entry produces ONE line, naming its own code and passing its own
 *     error VALUE, so the stack survives into the one place it can be read
 *  3. several refusals produce several lines, each paired with ITS OWN diagnostic
 *  4. reporting is downstream of the dispatch: it neither replaces nor short-circuits
 *     the `APPLY_HISTORY_REPLAY` that recovers the replay
 *
 * The `replayHistory` mock here is an observation probe with one optional override,
 * matching `useHistory.test.tsx`'s: the wrapper delegates to the real implementation
 * and records `result.diagnostics` on the way out, and the override REPLACES that
 * array so the number of reported lines is chosen by the test rather than discovered.
 * Two identities make the replacement honest: a timeline that genuinely refuses
 * nothing is still replayed, so every reported line is attributable to the injected
 * array, and one test leaves the override `null` entirely so the wiring is proved
 * against a refusal `replayHistory` actually made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NEW_LAYER_ACTION, RENAME_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import { useHistory } from '../useHistory.ts';
import type { HistoryItem } from '../history-types.ts';
import type { ReplayDiagnostic } from '../history-replay.ts';
import type { LayersRecord } from '../layer-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { updateHistoryTimeline } from '../history-timeline.ts';
import { CanvasFilterUnsupportedError, overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';

const storeStateMock = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  history: [] as HistoryItem[],
  historyIndex: -1,
  layers: {} as LayersRecord,
  deletedLayers: {},
  activeLayerId: null as string | null,
  totalSize: { width: 128, height: 64 },
  documentFrame: null as DocumentFrame | null,
  selections: [] as unknown[],
  activeSelectionId: null as string | null,
  branchRevision: 0,
  hasUnsavedChanges: false,
  clearPreviewLayers: vi.fn(),
}));

const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, dispatchMock],
}));

/**
 * `injected` REPLACES the collected diagnostics rather than appending to them, so a
 * test cannot pass by reporting refusals the timeline happened to produce itself, and
 * `seen` records what each real replay collected, which is what makes the "nothing was
 * refused" claims checkable instead of assumed.
 */
const replayControl = vi.hoisted(() => ({
  injected: null as ReplayDiagnostic[] | null,
  seen: [] as ReplayDiagnostic[][],
}));

vi.mock('../history-replay.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../history-replay.ts')>();
  return {
    ...actual,
    replayHistory: (...args: Parameters<typeof actual.replayHistory>) => {
      const result = actual.replayHistory(...args);
      replayControl.seen.push(result.diagnostics);
      return replayControl.injected === null ? result : { ...result, diagnostics: replayControl.injected };
    },
  };
});

/** How many `console.error` calls existed when the last replay was published. */
let appliedWithErrorCalls = -1;

type ConsoleErrorSpy = ReturnType<typeof spyOnConsoleError>;

function spyOnConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

type DispatchedAction = {
  type: string;
  payload?: {
    updates?: Record<string, unknown>;
    timeline?: { entries: HistoryItem[]; cursor: number; branchRevision: number };
  };
};

function dispatchedActions(): DispatchedAction[] {
  return dispatchMock.mock.calls.map((call) => call[0] as DispatchedAction);
}

function dispatchedTypes(): string[] {
  return dispatchedActions().map((action) => action.type);
}

function createHistory(): HistoryItem[] {
  return [
    {
      id: 'h-1',
      layerId: 'layer-1',
      actionName: NEW_LAYER_ACTION,
      layerSource: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: true, size: { width: 128, height: 64 } },
    },
    { id: 'h-2', layerId: 'layer-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Layer 1' } },
  ] as HistoryItem[];
}

/** A `layer-operation` tool, so a replay of it really reaches the refusal gate. */
function toolEntry(id: string, args: object): HistoryItem {
  return { id, layerId: 'layer-1', actionName: TOOL_ACTION, args } as unknown as HistoryItem;
}

const blurEntry = (id = 'tool-blur'): HistoryItem => toolEntry(id, { toolName: 'blur', radius: 3 });

function resetStoreState(history: HistoryItem[]) {
  Object.assign(storeStateMock, {
    canvasRef: { current: document.createElement('canvas') },
    history,
    historyIndex: history.length - 1,
    layers: {},
    deletedLayers: {},
    activeLayerId: null,
    totalSize: { width: 128, height: 64 },
    documentFrame: null,
    selections: [],
    activeSelectionId: null,
    branchRevision: 0,
    hasUnsavedChanges: false,
  });
}

function createDispatch(errorSpy?: ConsoleErrorSpy) {
  return vi.fn((action: DispatchedAction) => {
    if (action.type === 'APPLY_HISTORY_REPLAY') {
      appliedWithErrorCalls = errorSpy ? errorSpy.mock.calls.length : 0;
      const payload = action.payload as {
        updates: Record<string, unknown>;
        timeline: { entries: HistoryItem[]; cursor: number; branchRevision: number };
      };
      Object.assign(storeStateMock, payload.updates, {
        history: [...payload.timeline.entries],
        historyIndex: payload.timeline.cursor,
        branchRevision: payload.timeline.branchRevision,
        hasUnsavedChanges: true,
      });
    } else if (action.type === 'COMMIT_DOCUMENT_EDIT') {
      const payload = action.payload as { updates: Record<string, unknown>; historyItem: HistoryItem };
      const timeline = updateHistoryTimeline(
        {
          entries: storeStateMock.history,
          cursor: storeStateMock.historyIndex,
          branchRevision: storeStateMock.branchRevision,
        },
        { type: 'append', entry: payload.historyItem }
      );
      Object.assign(storeStateMock, payload.updates, {
        history: [...timeline.entries],
        historyIndex: timeline.cursor,
        branchRevision: timeline.branchRevision,
        hasUnsavedChanges: true,
      });
    }
  });
}

function setup(history = createHistory()) {
  resetStoreState(history);
  const errorSpy = spyOnConsoleError();
  dispatchMock.mockImplementation(createDispatch(errorSpy));
  return { state: storeStateMock, errorSpy };
}

beforeEach(() => {
  replayControl.injected = null;
  replayControl.seen.length = 0;
  appliedWithErrorCalls = -1;
});

afterEach(() => {
  // Restores the real detection, so the override cannot leak into another file.
  overrideCanvasFilterSupport(null);
  // Restores `console.error` and everything else spied on. `src/test/setup.ts`
  // reinstalls the global canvas context stub in its own `beforeEach`, which runs
  // before this file's hooks, so nothing here is left stubbed for the next test.
  vi.restoreAllMocks();
});

describe('useHistory reports the history entries a replay refused', () => {
  it('reports nothing for a replay that refused nothing', () => {
    const { state, errorSpy } = setup([...createHistory(), blurEntry()]);

    useHistory().resetHistoryTo(2);

    // The blur really was replayed, so silence here means "nothing was refused"
    // rather than "nothing was replayed". This replay also PUBLISHED to a mounted
    // canvas, which the no-canvas case in `useHistory.test.tsx` cannot show.
    expect(state.layers['layer-1'].operations).toHaveLength(1);
    expect(replayControl.injected).toBeNull();
    expect(replayControl.seen).toEqual([[]]);
    expect(dispatchedTypes()).toEqual(['APPLY_HISTORY_REPLAY']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reports one line per diagnostic, naming its own code and passing its own error value', () => {
    const affineError = new Error('Affine transform produced degenerate bounds');
    const filterError = new CanvasFilterUnsupportedError('levels');
    replayControl.injected = [
      { historyId: 'tool-transform', actionName: TOOL_ACTION, code: 'invalid-affine-transform', error: affineError },
      { historyId: 'tool-levels', actionName: TOOL_ACTION, code: 'canvas-filter-unsupported', error: filterError },
    ];
    const { errorSpy } = setup();

    useHistory().undo();

    // The timeline really replayed cleanly, so each line below is attributable to
    // one diagnostic rather than to a second refusal discovered on the way.
    expect(replayControl.seen).toEqual([[]]);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    // Two arguments, in that order: the message identifies the code, and the error
    // VALUE rides in second so the stack reaches the console rather than a
    // template literal. `String(error)`, a rewrapped Error or a `{ message }` copy
    // would satisfy a `toEqual` on the message and flatten the stack out of the
    // only channel there is for it.
    expect(errorSpy.mock.calls[0]).toHaveLength(2);
    expect(errorSpy.mock.calls[1]).toHaveLength(2);
    expect(errorSpy.mock.calls[0]![0]).toEqual(expect.stringContaining('invalid-affine-transform'));
    expect(errorSpy.mock.calls[1]![0]).toEqual(expect.stringContaining('canvas-filter-unsupported'));
    expect(errorSpy.mock.calls[0]![1]).toBe(affineError);
    expect(errorSpy.mock.calls[1]![1]).toBe(filterError);
    expect(errorSpy.mock.calls[0]![1]).toBeInstanceOf(Error);
  });

  it('still publishes the replay, and reports only after the dispatch that recovered it', () => {
    replayControl.injected = [
      { historyId: 'h-1', actionName: NEW_LAYER_ACTION, code: 'invalid-affine-transform', error: new Error('refused') },
    ];
    const { state, errorSpy } = setup();

    useHistory().resetHistoryTo(1);

    // Reporting is downstream of a successful dispatch, never its precondition: a
    // loop placed before it, or one that replaced it, leaves this non-zero or the
    // action list below empty.
    expect(appliedWithErrorCalls).toBe(0);
    expect(dispatchedTypes()).toEqual(['APPLY_HISTORY_REPLAY']);
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_DURABLE_STATUS' }));
    expect(state.layers['layer-1']).toMatchObject({ id: 'layer-1', name: 'Layer 1', visible: true });
    expect(state.historyIndex).toBe(1);
    // The recovered replay is the whole edit: a skip is not a failure of the replay.
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal replayHistory really made, carrying the Error it caught', () => {
    overrideCanvasFilterSupport(false);
    const { state, errorSpy } = setup([...createHistory(), blurEntry()]);

    useHistory().resetHistoryTo(2);

    // Nothing was overridden on this path: the engine reports no canvas filter, so
    // `replayHistory` refused the blur itself. Without this the two tests above
    // would only prove that the loop reads whatever array it is handed.
    expect(replayControl.injected).toBeNull();
    expect(replayControl.seen[0]).toHaveLength(1);
    expect(replayControl.seen[0]![0]!.code).toBe('canvas-filter-unsupported');
    expect(replayControl.seen[0]![0]!.historyId).toBe('tool-blur');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toHaveLength(2);
    expect(errorSpy.mock.calls[0]![0]).toContain('canvas-filter-unsupported');
    expect(errorSpy.mock.calls[0]![1]).toBe(replayControl.seen[0]![0]!.error);
    expect(errorSpy.mock.calls[0]![1]).toBeInstanceOf(CanvasFilterUnsupportedError);
    // The refused edit is still refused, and the rest of the replay still applied.
    expect(state.layers['layer-1'].operations).toEqual([]);
    expect(state.layers['layer-1']).toMatchObject({ id: 'layer-1', name: 'Layer 1' });
    expect(dispatchedTypes()).toEqual(['APPLY_HISTORY_REPLAY']);
  });

  it('reports on every navigation, through every entry point', () => {
    const refused = new Error('refused');
    replayControl.injected = [
      { historyId: 'h-2', actionName: TOOL_ACTION, code: 'invalid-affine-transform', error: refused },
    ];
    const { errorSpy } = setup();

    useHistory().undo();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![1]).toBe(refused);

    errorSpy.mockClear();
    useHistory().redo();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![1]).toBe(refused);

    errorSpy.mockClear();
    useHistory().toggleDisabled('h-1');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![1]).toBe(refused);

    // One line per REPLAY, not one per diagnostic and not one per session: the
    // report belongs to the navigation the user just performed.
    expect(replayControl.seen).toHaveLength(3);
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('History replay is unavailable'),
      expect.anything()
    );
  });
});
