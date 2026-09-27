import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import { useSelectionHistory } from '../useSelectionHistory.ts';
import type { ClearedSelectionState, Selection, SelectionDraftState } from '../general-types.ts';

/**
 * `committedSelectionUpdate` in `useSelectionHistory.ts` is a hand-written copy
 * of the reducer's own `commitSelection` / `updateCommittedSelection`
 * derivation, because a gesture routed through the writer no longer dispatches
 * the raw action. The writer tests in `useSelectionHistory.test.tsx` pin the
 * copied derivation field by field; this file pins the claim that makes the
 * copy worth keeping, by executing the reducer arms and comparing.
 *
 * The real `StoreProvider` is used here — nothing is mocked — so both sides
 * produce their post-state through the same reducer.
 */

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

type SelectionPostState = Readonly<{
  selections: Selection[];
  activeSelectionId: string | null;
  selectionDraft: SelectionDraftState;
  selectionCleared: ClearedSelectionState | null;
}>;

function useWriterHarness() {
  const store = useStore();
  return { store: store[0], dispatch: store[1], commitSelection: useSelectionHistory().commitSelection };
}

type Seed = Readonly<{ selections: Selection[]; active: string | null }>;
type CommitSelection = ReturnType<typeof useWriterHarness>['commitSelection'];

/** The writer's post-state, taken from the store its own dispatch produced. */
function writerPostState(seed: Seed, commit: (commitSelection: CommitSelection) => void): SelectionPostState {
  const { result } = renderHook(useWriterHarness, { wrapper: StoreProvider });
  seedStore(result.current.dispatch, seed);
  act(() => {
    commit(result.current.commitSelection);
  });
  return pick(result.current.store);
}

/** The reducer's own post-state for a raw action, on an identically seeded store. */
function reducerPostState(action: { type: string; payload: Selection }, seed: Seed): SelectionPostState {
  const { result } = renderHook(() => useStore(), { wrapper: StoreProvider });
  seedStore(result.current[1], seed);
  act(() => {
    result.current[1](action as Parameters<StoreDispatch>[0]);
  });
  return pick(result.current[0]);
}

function seedStore(dispatch: StoreDispatch, seed: Seed) {
  act(() => {
    // `CLEAR_SELECTIONS` leaves a pending repaint marker behind, so the
    // comparison covers whether each arm retires it or preserves it.
    dispatch({ type: 'CLEAR_SELECTIONS' });
    dispatch({ type: 'SET_SELECTIONS', payload: seed.selections });
    dispatch({ type: 'SET_ACTIVE_SELECTION', payload: seed.active });
  });
}

function pick(store: StoreData): SelectionPostState {
  return {
    selections: store.selections,
    activeSelectionId: store.activeSelectionId,
    selectionDraft: store.selectionDraft,
    selectionCleared: store.selectionCleared,
  };
}

describe('committedSelectionUpdate against the reducer arms', () => {
  it('matches the reducer commitSelection post-state for a create', () => {
    const existing = makeSelection('existing');
    const drawn = makeGesturePayload('drawn', {
      points: [{ x: 1, y: 2 }],
      pos: { x: 1, y: 2, width: 10, height: 12 },
      metadata: { featherRadius: 7, movedAtVersion: 1 },
    });
    const seed: Seed = { selections: [existing], active: existing.id };

    const fromWriter = writerPostState(seed, (commitSelection) => {
      commitSelection(drawn, 'create');
    });

    expect(fromWriter).toEqual(reducerPostState({ type: 'COMMIT_SELECTION', payload: drawn }, seed));
    // Spelled out as well, so a shared drift cannot hide behind one comparison.
    expect(fromWriter.selections).toEqual([
      { ...existing, isActive: false },
      { ...drawn, isActive: true, lifecycle: 'committed', geometry: 'polygon' },
    ]);
    expect(fromWriter.activeSelectionId).toBe(drawn.id);
  });

  it('matches the reducer updateCommittedSelection post-state for a move', () => {
    const dragged = makeSelection('dragged');
    const active = makeSelection('active');
    const moved = makeGesturePayload('dragged', {
      pos: { x: 20, y: 24, width: 8, height: 6 },
      points: [{ x: 20, y: 24 }],
      metadata: { featherRadius: 5, movedAtVersion: 2 },
    });
    // The moved selection is not the active one, so the active-pointer rule is
    // observable on both sides rather than collapsing to the same value.
    const seed: Seed = { selections: [dragged, active], active: active.id };

    const fromWriter = writerPostState(seed, (commitSelection) => {
      commitSelection(moved, 'move');
    });

    expect(fromWriter).toEqual(reducerPostState({ type: 'MOVE_SELECTION', payload: moved }, seed));
    // Replaced, not appended, and `isActive` is not forced the way a create
    // forces it.
    expect(fromWriter.selections).toHaveLength(2);
    expect(fromWriter.selections[0]).toEqual({
      ...moved,
      isActive: false,
      lifecycle: 'committed',
      geometry: 'polygon',
    });
    expect(fromWriter.selections[1]).toEqual(active);
    expect(fromWriter.activeSelectionId).toBe(active.id);
    // The pending marker survives a move on both sides.
    expect(fromWriter.selectionCleared).toEqual({ status: 'cleared', version: 1 });
  });

  it('matches the reducer updateCommittedSelection post-state for a move that arrives active', () => {
    const dragged = makeSelection('dragged');
    const active = makeSelection('active');
    const moved = makeSelection('dragged', { isActive: true, pos: { x: 3, y: 3, width: 8, height: 6 } });
    const seed: Seed = { selections: [dragged, active], active: active.id };

    const fromWriter = writerPostState(seed, (commitSelection) => {
      commitSelection(moved, 'move');
    });

    expect(fromWriter).toEqual(reducerPostState({ type: 'MOVE_SELECTION', payload: moved }, seed));
    expect(fromWriter.activeSelectionId).toBe(dragged.id);
  });

  it('skips the append for an unchanged selection, so the document stays clean', () => {
    const existing = makeSelection('existing');
    const { result } = renderHook(useWriterHarness, { wrapper: StoreProvider });
    seedStore(result.current.dispatch, { selections: [existing], active: existing.id });
    const seeded = result.current.store;

    act(() => {
      // Value-equal payload: the drag ended where it started.
      result.current.commitSelection(makeSelection('existing'), 'move');
    });

    expect(result.current.store.selections).toEqual(seeded.selections);
    expect(result.current.store.hasUnsavedChanges).toBe(false);

    act(() => {
      result.current.commitSelection(makeGesturePayload('drawn'), 'create');
    });

    // The edit it skipped is the one that would have dirtied the document, so
    // the guard is load-bearing rather than cosmetic.
    expect(result.current.store.hasUnsavedChanges).toBe(true);
  });
});
