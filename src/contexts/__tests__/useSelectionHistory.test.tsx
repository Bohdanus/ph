import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectionHistory } from '../useSelectionHistory.ts';
import type { ClearedSelectionState, Selection } from '../general-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryItem } from '../history-types.ts';
import type { DurableHistoryEntry } from '../history-model.ts';
import type { AppendBoundaryInput, AppendBoundaryResult } from '../history-append.ts';
import { SELECTION_ACTION } from '../../util/constants.ts';

/**
 * The narrow shape of the one action this writer emits.
 *
 * `StoreContext.tsx` does not export its `Action` union, so the assertions are
 * made against the documented `COMMIT_DOCUMENT_EDIT` payload instead of an
 * untyped dispatch spy. `updates` stays `Record<string, unknown>` and is read
 * field by field, which is what the reducer spreads into the store.
 */
type CommittedSelectionEdit = Readonly<{
  type: string;
  payload: {
    updates: Record<string, unknown>;
    historyItem: HistoryItem;
    durableEntry?: DurableHistoryEntry | null;
  };
}>;

const size = { width: 128, height: 64 };
const frame: DocumentFrame = { x: 0, y: 0, ...size };

const storeStateMock = vi.hoisted(() => ({
  selections: [] as Selection[],
  activeSelectionId: null as string | null,
  selectionCleared: null as ClearedSelectionState | null,
  totalSize: { width: 128, height: 64 },
  documentFrame: null as DocumentFrame | null,
  history: [] as HistoryItem[],
  historyIndex: 0,
  branchRevision: 0,
}));

const dispatchMock = vi.hoisted(() => vi.fn<(action: CommittedSelectionEdit) => void>());

// Mocked directly rather than through `renderHook` + `StoreProvider`: the
// provider pulls in the durable replay/materialization path, which does not
// survive the test environment, and the writer's contract is the action it
// emits.
vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, dispatchMock],
}));

/**
 * The append planner is the shadow projection, and its failure is what the
 * fallback branch exists for. Every call is recorded so the tests can compare
 * the id the writer minted against the id that reached the store.
 */
const appendControl = vi.hoisted(() => ({
  failure: null as unknown,
  calls: [] as Array<{ id: string | null; result: AppendBoundaryResult | null }>,
}));

vi.mock('../history-append.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../history-append.ts')>();
  return {
    ...actual,
    planHistoryAppend: (input: AppendBoundaryInput) => {
      if (appendControl.failure !== null) {
        appendControl.calls.push({ id: input.id ?? null, result: null });
        throw appendControl.failure;
      }
      const result = actual.planHistoryAppend(input);
      appendControl.calls.push({ id: input.id ?? null, result });
      return result;
    },
  };
});

function makeSelection(id: string, overrides: Partial<Selection> = {}): Selection {
  return {
    id,
    points: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
    ],
    isActive: true,
    pos: { x: 0, y: 0, width: 8, height: 6 },
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool: 'rectangular-selection',
    metadata: { featherRadius: 2 },
    ...overrides,
  };
}

/** A raw gesture payload: no `lifecycle`, no `geometry`, not yet active. */
function makeGesturePayload(id: string, overrides: Partial<Selection> = {}): Selection {
  const committed = makeSelection(id);
  return {
    id: committed.id,
    points: committed.points,
    pos: committed.pos,
    sourceTool: committed.sourceTool,
    metadata: committed.metadata,
    isActive: false,
    ...overrides,
  };
}

function seed(selections: Selection[], activeSelectionId: string | null) {
  storeStateMock.selections = selections;
  storeStateMock.activeSelectionId = activeSelectionId;
  storeStateMock.selectionCleared = null;
  storeStateMock.history = [];
  storeStateMock.historyIndex = 0;
  storeStateMock.branchRevision = 0;
  storeStateMock.documentFrame = frame;
  storeStateMock.totalSize = size;
}

/**
 * The writer is a `useCallback` pair, so it is rendered rather than called as
 * a plain function. The store is mocked, so no provider is involved.
 */
function mountWriter() {
  return renderHook(() => useSelectionHistory()).result.current;
}

function onlyDispatch(): CommittedSelectionEdit {
  expect(dispatchMock).toHaveBeenCalledTimes(1);
  return dispatchMock.mock.calls[0][0];
}

function selectionArgs(historyItem: HistoryItem): { previous: unknown; next: unknown } {
  const args = historyItem.args as { previousSelectionState?: unknown; nextSelectionState?: unknown };
  return { previous: args.previousSelectionState, next: args.nextSelectionState };
}

beforeEach(() => {
  dispatchMock.mockClear();
  appendControl.calls = [];
  appendControl.failure = null;
  seed([], null);
});

// The planning-failure assertions spy on `console.error`, so the spy is undone
// after every test rather than left installed over the ones that follow.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSelectionHistory no-op guard', () => {
  it('dispatches nothing for a clear that would not change the selection state', () => {
    seed([], null);

    mountWriter().clearSelections();

    // `COMMIT_DOCUMENT_EDIT` always flags unsaved changes, so a history entry
    // for an unchanged state would also mark a clean document dirty.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(appendControl.calls).toHaveLength(0);
  });

  it('dispatches nothing for a clear that would only bump the repaint marker', () => {
    seed([], null);
    storeStateMock.selectionCleared = { status: 'cleared', version: 4 };

    mountWriter().clearSelections();

    // The guard is on the selection state, not on the marker: bumping it alone
    // is still an edit, so this branch skips the dispatch entirely.
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('dispatches exactly one edit for a clear that does change the selection state', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);

    mountWriter().clearSelections();

    const action = onlyDispatch();
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    expect(action.payload.updates).toMatchObject({
      selections: [],
      activeSelectionId: null,
      selectionDraft: { status: 'idle' },
      selectionCleared: { status: 'cleared', version: 1 },
    });
    expect(action.payload.historyItem).toMatchObject({ actionName: SELECTION_ACTION, layerId: 'selection' });
    expect(selectionArgs(action.payload.historyItem)).toEqual({
      previous: { selections: [existing], activeSelectionId: existing.id },
      next: { selections: [], activeSelectionId: null },
    });
  });

  it('dispatches nothing for a move that lands on the state the store already holds', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);

    // Value-equal but a different object: a drag that ends where it started.
    // The guard is a deep comparison because a move rebuilds points/pos/metadata.
    mountWriter().commitSelection(makeSelection('existing'), 'move');

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(appendControl.calls).toHaveLength(0);
  });

  it('dispatches one edit when the same move changes only the geometry', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);

    mountWriter().commitSelection(makeSelection('existing', { pos: { x: 4, y: 4, width: 8, height: 6 } }), 'move');

    const action = onlyDispatch();
    expect(action.payload.updates.selections).toEqual([
      makeSelection('existing', { pos: { x: 4, y: 4, width: 8, height: 6 } }),
    ]);
  });
});

describe('useSelectionHistory durable-plan fallback', () => {
  it('re-dispatches the commit without a durable entry, keeping the same history item id', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);
    const drawn = makeGesturePayload('drawn');
    const failure = new Error('shadow projection failed');
    appendControl.failure = failure;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mountWriter().commitSelection(drawn, 'create');

    // One id for both paths: the fallback entry is the same history entry, not
    // a second candidate that differs only by identity.
    expect(appendControl.calls).toHaveLength(1);
    const action = onlyDispatch();
    expect(action.payload.historyItem.id).toBe(appendControl.calls[0].id);
    expect(action.payload).not.toHaveProperty('durableEntry');
    // The gesture's selection still lands; only the shadow plan is missing.
    expect(action.payload.updates.selections).toEqual([
      { ...existing, isActive: false },
      { ...drawn, isActive: true, lifecycle: 'committed', geometry: 'polygon' },
    ]);
    expect(selectionArgs(action.payload.historyItem).next).toEqual({
      selections: [
        { ...existing, isActive: false },
        { ...drawn, isActive: true, lifecycle: 'committed', geometry: 'polygon' },
      ],
      activeSelectionId: drawn.id,
    });
    // The thrown error itself reaches the console. A bare `catch {}` cannot
    // report this: the fallback edit is byte-identical to the one a writer that
    // never planned would emit, so without the bound error a planning failure is
    // indistinguishable from no planning at all.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Unable to plan durable history for a selection commit', failure);
  });

  it('re-dispatches the clear without a durable entry, keeping the same history item id', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);
    const failure = new Error('shadow projection failed');
    appendControl.failure = failure;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mountWriter().clearSelections();

    expect(appendControl.calls).toHaveLength(1);
    const action = onlyDispatch();
    expect(action.payload.historyItem.id).toBe(appendControl.calls[0].id);
    expect(action.payload).not.toHaveProperty('durableEntry');
    // The deselect lands: an empty selection set and no active selection.
    expect(action.payload.updates).toMatchObject({ selections: [], activeSelectionId: null });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Unable to plan durable history for a selection clear', failure);
  });

  it('reports a planning failure on a move exactly as it does on a create, and commits the moved geometry', () => {
    const dragged = makeSelection('dragged');
    const active = makeSelection('active');
    seed([dragged, active], active.id);
    const moved = makeGesturePayload('dragged', {
      pos: { x: 9, y: 9, width: 8, height: 6 },
      points: [{ x: 9, y: 9 }],
      metadata: { featherRadius: 1, movedAtVersion: 3 },
    });
    const failure = new Error('shadow projection failed');
    appendControl.failure = failure;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mountWriter().commitSelection(moved, 'move');

    // Both modes of `commitSelection` share one fallback branch, so the
    // diagnostic and the surviving edit are asserted for each of them rather
    // than inferred from the create path.
    const action = onlyDispatch();
    expect(action.payload).not.toHaveProperty('durableEntry');
    expect(action.payload.historyItem.id).toBe(appendControl.calls[0].id);
    expect(action.payload.updates.selections).toEqual([
      { ...moved, isActive: false, lifecycle: 'committed', geometry: 'polygon' },
      active,
    ]);
    expect(action.payload.updates.activeSelectionId).toBe(active.id);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Unable to plan durable history for a selection commit', failure);
  });

  it('publishes the planned durable entry under the same history item id when the plan succeeds', () => {
    seed([], null);
    const drawn = makeGesturePayload('drawn');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mountWriter().commitSelection(drawn, 'create');

    const action = onlyDispatch();
    const planned = appendControl.calls[0].result;
    expect(planned).not.toBeNull();
    // The contrast that gives the fallback assertions their meaning: the same
    // writer, same id, with a durable plan attached when one is available — and
    // nothing on the console, because nothing failed.
    expect(action.payload.durableEntry).toEqual(planned?.durableEntry);
    expect(action.payload.historyItem.id).toBe(appendControl.calls[0].id);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('useSelectionHistory committed selection state', () => {
  it('appends and activates on create, retiring activity on the existing selections', () => {
    const first = makeSelection('first');
    const second = makeSelection('second');
    seed([first, second], second.id);
    const drawn = makeGesturePayload('drawn', {
      points: [{ x: 1, y: 2 }],
      pos: { x: 1, y: 2, width: 10, height: 12 },
      metadata: { featherRadius: 7, movedAtVersion: 1 },
    });

    mountWriter().commitSelection(drawn, 'create');

    const { updates } = onlyDispatch().payload;
    // Field by field against the reducer's own `commitSelection` post-state.
    expect(updates.selections).toEqual([
      { ...first, isActive: false },
      { ...second, isActive: false },
      {
        ...drawn,
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        pos: { x: 1, y: 2, width: 10, height: 12 },
        points: [{ x: 1, y: 2 }],
        metadata: { featherRadius: 7, movedAtVersion: 1 },
      },
    ]);
    expect(updates.activeSelectionId).toBe(drawn.id);
    expect(updates.selectionDraft).toEqual({ status: 'idle' });
    // A create retires a pending "cleared" repaint marker, as the reducer does.
    expect(updates.selectionCleared).toBeNull();
  });

  it('keeps an explicit geometry on create instead of defaulting it away', () => {
    seed([], null);
    const drawn = makeGesturePayload('drawn', { geometry: 'rectangle' });

    mountWriter().commitSelection(drawn, 'create');

    const [committed] = onlyDispatch().payload.updates.selections as Selection[];
    expect(committed.geometry).toBe('rectangle');
  });

  it('replaces the existing selection on move without forcing activity', () => {
    // The moved selection is deliberately NOT the active one, so both halves of
    // the rule are observable: a move that does not claim activity must leave
    // the pointer on the other selection rather than on the one it dragged.
    const dragged = makeSelection('dragged');
    const active = makeSelection('active');
    seed([dragged, active], active.id);
    const moved = makeGesturePayload('dragged', {
      pos: { x: 20, y: 24, width: 8, height: 6 },
      points: [{ x: 20, y: 24 }],
      metadata: { featherRadius: 5, movedAtVersion: 2 },
    });

    mountWriter().commitSelection(moved, 'move');

    const { updates } = onlyDispatch().payload;
    const selections = updates.selections as Selection[];
    // Replaced, not appended: same count, same ids, same order.
    expect(selections).toHaveLength(2);
    expect(selections[0]).toEqual({
      ...moved,
      isActive: false,
      lifecycle: 'committed',
      geometry: 'polygon',
      pos: { x: 20, y: 24, width: 8, height: 6 },
      points: [{ x: 20, y: 24 }],
      metadata: { featherRadius: 5, movedAtVersion: 2 },
    });
    expect(selections[1]).toEqual(active);
    // `isActive` is NOT forced to true the way `'create'` forces it, and the
    // active pointer stays on the selection that had it.
    expect(selections[0].isActive).toBe(false);
    expect(updates.activeSelectionId).toBe(active.id);
    expect(updates.selectionDraft).toEqual({ status: 'idle' });
    // A move omits the marker entirely so the store keeps the current one,
    // exactly as the reducer's `updateCommittedSelection` does.
    expect(updates).not.toHaveProperty('selectionCleared');
  });

  it('claims the active pointer on a move that arrives active', () => {
    const dragged = makeSelection('dragged');
    const active = makeSelection('active');
    seed([dragged, active], active.id);
    const moved = makeSelection('dragged', { isActive: true, pos: { x: 3, y: 3, width: 8, height: 6 } });

    mountWriter().commitSelection(moved, 'move');

    const { updates } = onlyDispatch().payload;
    expect(updates.activeSelectionId).toBe(dragged.id);
    expect(updates.selections).toEqual([moved, active]);
  });

  it('records the post-state it publishes, so history and live state cannot disagree', () => {
    seed([], null);
    const drawn = makeGesturePayload('drawn');

    mountWriter().commitSelection(drawn, 'create');

    const { updates, historyItem } = onlyDispatch().payload;
    const { next } = selectionArgs(historyItem);
    expect(next).toEqual({ selections: updates.selections, activeSelectionId: updates.activeSelectionId });
  });
});
