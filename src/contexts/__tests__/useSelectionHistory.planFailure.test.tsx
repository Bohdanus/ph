import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { useSelectionHistory } from '../useSelectionHistory.ts';
import type { ClearedSelectionState, Selection } from '../general-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryItem } from '../history-types.ts';
import type { DurableHistoryEntry } from '../history-model.ts';
import type { AppendBoundaryInput, AppendBoundaryResult } from '../history-append.ts';
import { SELECTION_ACTION } from '../../util/constants.ts';

/**
 * The reporting half of the durable-plan fallback, for BOTH writers.
 *
 * `useSelectionHistory.ts` wraps `planHistoryAppend` in a `try`/`catch` in two
 * places: `appendSelectionClear` (the writer `clearSelections` is bound to, and
 * the one `goToTool` calls from outside a render) and `commitSelection`. Both
 * recover the same way — re-dispatch the edit with no `durableEntry` — and
 * `useSelectionHistory.test.tsx` already pins that recovery. What is pinned
 * here is the other half: each catch REPORTS the error it swallowed.
 *
 * `HANDOFF.md` §98 makes the console the app's only error channel, so a silent
 * catch here is a lost edit the user can never learn about. Deleting either
 * `console.error(error)` is a behaviour change, not a cleanup, and these tests
 * are the tripwire for it: each writer has its own assertion, so removing one
 * line fails one test and removing both fails two.
 *
 * Mocking style, store seed, and the `appendControl` failure switch are the ones
 * `useSelectionHistory.test.tsx` already established, deliberately repeated
 * rather than shared: this file must fail on the writer's behaviour, not on an
 * import from a sibling test that a future edit could move.
 */

/**
 * The narrow shape of the one action these writers emit.
 *
 * `StoreContext.tsx` does not export its `Action` union, so the assertions are
 * made against the documented `COMMIT_DOCUMENT_EDIT` payload instead of an
 * untyped dispatch spy — the same contract, and the same spelling, the writer
 * tests use.
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
 * fallback branch exists for. Every call is recorded so the tests can prove the
 * failure was actually provoked, and can compare the id the writer minted
 * against the id that reached the store.
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

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  // Installed for every test, including the ones that assert nothing was
  // reported, so a stray line is a failing assertion rather than output noise.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  dispatchMock.mockClear();
  appendControl.calls = [];
  appendControl.failure = null;
  seed([], null);
});

afterEach(() => {
  // The real console is the app's only error channel, so a suite that restores
  // it deliberately is easier to reason about than one that leaves it stubbed.
  consoleError.mockRestore();
});

describe('useSelectionHistory durable-plan failure is reported', () => {
  it('reports the thrown plan error object itself when a clear cannot be planned', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);
    const failure = new Error('shadow projection failed');
    appendControl.failure = failure;

    mountWriter().clearSelections();

    // The failure was really provoked, rather than the assertion passing on a
    // plan that happened to succeed.
    expect(appendControl.calls).toHaveLength(1);
    // Exactly one call, carrying the error and nothing else: a message prefix
    // would be a second argument, and `console.error(\`...\`, error)` is a
    // different report than this one.
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(failure);
    // The `toBe` states the requirement in its own terms instead of leaving it
    // to the matcher's treatment of `Error`: identity, asserted as identity.
    // Verified by mutation rather than assumed — rewrapping
    // (`new Error(String(error))`) is rejected by BOTH assertions under Vitest
    // 5, so the matcher is stricter here than the comment it replaced claimed,
    // and this line is the belt to that braces.
    expect(consoleError.mock.calls[0][0]).toBe(failure);
    // What the identity buys: the stack the user can report, not a message.
    expect((consoleError.mock.calls[0][0] as Error).stack).toBe(failure.stack);
  });

  it('reports the thrown plan error object itself when a commit cannot be planned', () => {
    seed([], null);
    const drawn = makeGesturePayload('drawn');
    const failure = new Error('shadow projection failed');
    appendControl.failure = failure;

    mountWriter().commitSelection(drawn, 'create');

    expect(appendControl.calls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(failure);
    // Same identity requirement as the clear, on the OTHER writer. The two catch
    // blocks are copies of one another, and a copy is exactly the thing that
    // drifts: the first test cannot fail if only this line is deleted.
    expect(consoleError.mock.calls[0][0]).toBe(failure);
    expect((consoleError.mock.calls[0][0] as Error).stack).toBe(failure.stack);
  });

  it('reports a non-Error throw by value rather than reaching through it', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);
    // `catch (error)` binds `unknown`, so a writer that assumes `Error` and
    // reports `error.message` would report `undefined` here — a report that
    // looks present to a call-count assertion and says nothing to a reader.
    const failure = 'plan boundary is unavailable';
    appendControl.failure = failure;

    mountWriter().clearSelections();

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(consoleError.mock.calls[0][0]).toBe(failure);
  });

  it('reports nothing when the plan succeeds', () => {
    seed([], null);

    mountWriter().commitSelection(makeGesturePayload('drawn'), 'create');

    // The control for the three above: the report belongs to the catch, so a
    // writer that hoisted it onto the success path would be caught here even
    // though every other assertion in this file still passed.
    expect(appendControl.calls).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('useSelectionHistory durable-plan recovery is unchanged', () => {
  it('still lands the clear without a durable entry', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);
    appendControl.failure = new Error('shadow projection failed');

    mountWriter().clearSelections();

    // Reporting must not have cost the edit. The store rebuilds durable state
    // from the legacy timeline instead, which is why `durableEntry` is absent
    // rather than null.
    const action = onlyDispatch();
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    expect(action.payload).not.toHaveProperty('durableEntry');
    // One id for both paths: the recovered entry is the same history entry, not
    // a second candidate that differs only by identity.
    expect(action.payload.historyItem.id).toBe(appendControl.calls[0].id);
    expect(action.payload.historyItem).toMatchObject({ actionName: SELECTION_ACTION, layerId: 'selection' });
    // And the deselect itself still reaches the document.
    expect(action.payload.updates).toMatchObject({
      selections: [],
      activeSelectionId: null,
      selectionCleared: { status: 'cleared', version: 1 },
    });
  });

  it('still lands the commit without a durable entry', () => {
    const existing = makeSelection('existing');
    seed([existing], existing.id);
    const drawn = makeGesturePayload('drawn');
    appendControl.failure = new Error('shadow projection failed');

    mountWriter().commitSelection(drawn, 'create');

    const action = onlyDispatch();
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    expect(action.payload).not.toHaveProperty('durableEntry');
    expect(action.payload.historyItem.id).toBe(appendControl.calls[0].id);
    expect(action.payload.historyItem).toMatchObject({ actionName: SELECTION_ACTION, layerId: 'selection' });
    // The selection the user just drew still lands, committed and activated.
    expect(action.payload.updates.selections).toEqual([
      { ...existing, isActive: false },
      { ...drawn, isActive: true, lifecycle: 'committed', geometry: 'polygon' },
    ]);
    expect(action.payload.updates.activeSelectionId).toBe(drawn.id);
  });
});
