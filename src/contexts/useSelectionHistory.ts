import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { isEqual } from 'lodash-es';
import { useStore, type StoreData, type StoreDispatch } from './StoreContext.tsx';
import { SELECTION_ACTION } from '../util/constants.ts';
import { planHistoryAppend } from './history-append.ts';
import { documentFrameFromSize, type DocumentFrame } from './document-frame.ts';
import type { Selection } from './general-types.ts';
import type { SelectionSnapshot } from './history-model.ts';
import type { NewHistoryItem } from './history-types.ts';
import { createHistoryItem } from './history-utils.ts';

/**
 * Which raw selection action a gesture used to dispatch.
 *
 * `'create'` appends a new committed selection and activates it (the reducer's
 * `commitSelection`); `'move'` replaces the geometry of an already-committed
 * selection (the reducer's `updateCommittedSelection`).
 */
export type SelectionCommitMode = 'create' | 'move';

type SelectionCommitUpdate = {
  selections: Selection[];
  activeSelectionId: string | null;
};

/**
 * The post-state of a selection commit.
 *
 * Derived exactly as `StoreContext.tsx` derives it for the matching raw action:
 * `commitSelection` for `'create'` (`:261`) and `updateCommittedSelection` for
 * `'move'` (`:279`). The `isActive: true` / `lifecycle: 'committed'` /
 * `geometry ?? 'polygon'` defaults are the reducer's, so the recorded state is
 * the state the store actually holds rather than the gesture's raw payload.
 *
 * The coupling to those two arms is deliberate and one-directional. A gesture
 * routed here no longer dispatches the raw action, so the store's post-state is
 * whatever this function returns — and that is also precisely what the history
 * entry records as `nextSelectionState`. History and live state therefore
 * cannot disagree with each other, which is the property that matters.
 */
function committedSelectionUpdate(
  mode: SelectionCommitMode,
  selections: readonly Selection[],
  activeSelectionId: string | null,
  selection: Selection
): SelectionCommitUpdate {
  if (mode === 'create') {
    return {
      selections: [
        ...selections.map((current) => ({ ...current, isActive: false })),
        { ...selection, isActive: true, lifecycle: 'committed', geometry: selection.geometry ?? 'polygon' },
      ],
      activeSelectionId: selection.id,
    };
  }
  return {
    selections: selections.map((current) =>
      current.id === selection.id
        ? { ...selection, lifecycle: 'committed', geometry: selection.geometry ?? 'polygon' }
        : current
    ),
    // A move that does not claim activity leaves the active pointer where it
    // was rather than activating the dragged selection.
    activeSelectionId: selection.isActive ? selection.id : activeSelectionId,
  };
}

export type SelectionClearInput = Readonly<
  Pick<
    StoreData,
    'selections' | 'activeSelectionId' | 'selectionCleared' | 'history' | 'historyIndex' | 'branchRevision'
  > & {
    documentFrame: DocumentFrame;
    dispatch: StoreDispatch;
  }
>;

/**
 * Clear every selection as one undoable document edit, without being a hook.
 *
 * This is the writer `clearSelections` below is bound to, exported so a caller
 * outside a component render can run the same append. `goToTool`
 * (`hooks/useApp.ts`) is that caller: it is invoked from a click handler and a
 * keyboard shortcut through a plain function, so it cannot call
 * `useSelectionHistory()` — that hook's `useCallback` throws outside a render.
 * Calling the writer directly is what keeps a tool switch from drifting back
 * into an unconverted hand-rolled `SELECTION_ACTION`, which appended no
 * `durableEntry` and therefore forced a whole-timeline reconversion on every
 * tool switch.
 *
 * It takes the store fields it reads rather than the whole state, so a
 * `useCallback` caller keeps a dependency list it can account for.
 */
export function appendSelectionClear({
  selections,
  activeSelectionId,
  selectionCleared,
  history,
  historyIndex,
  branchRevision,
  documentFrame,
  dispatch,
}: SelectionClearInput): void {
  // The store always carries an array, so this only normalises a state shape
  // that cannot occur in production. It keeps the guard — and therefore this
  // writer — total, so a malformed snapshot is a no-op instead of an exception
  // thrown out of a click handler ahead of the fallback below.
  const existing = Array.isArray(selections) ? selections : [];
  if (existing.length === 0 && !activeSelectionId) return;

  // Captured before any dispatch, so the durable `before` baseline is the state
  // the user actually had, never a value read back after the store moved.
  const previousSelectionState: SelectionSnapshot = { selections: existing, activeSelectionId };
  const nextSelectionState: SelectionSnapshot = { selections: [], activeSelectionId: null };

  const item: NewHistoryItem = {
    actionName: SELECTION_ACTION,
    layerId: 'selection',
    args: { previousSelectionState, nextSelectionState },
  };
  // One id for both paths, so the planned entry and the fallback entry are the
  // same history entry rather than two candidates that differ only by identity.
  const id = uuidv4();
  const updates = {
    selections: [] as Selection[],
    activeSelectionId: null,
    selectionDraft: { status: 'idle' as const },
    selectionCleared: { status: 'cleared' as const, version: (selectionCleared?.version ?? 0) + 1 },
  };

  try {
    const { entry, durableEntry } = planHistoryAppend({
      item,
      id,
      timeline: { entries: history, cursor: historyIndex, branchRevision },
      currentFrame: documentFrame,
      // Passed explicitly: `planHistoryAppend` otherwise defaults the durable
      // `before` to an empty snapshot, which would be a wrong baseline rather
      // than a harmless one, because the item does carry a previous state.
      currentSelections: previousSelectionState,
    });
    dispatch({ type: 'COMMIT_DOCUMENT_EDIT', payload: { updates, historyItem: entry, durableEntry } });
  } catch {
    // The plan never published, so nothing was appended and nothing was
    // cleared. Re-dispatch the same edit with no durable plan rather than
    // letting a shadow-projection failure reject a valid deselect; the store
    // rebuilds durable state from the legacy timeline instead.
    dispatch({ type: 'COMMIT_DOCUMENT_EDIT', payload: { updates, historyItem: createHistoryItem(item, id) } });
  }
}

/**
 * The single writer for selection history.
 *
 * Selection used to be written outside history entirely: the Clear and Deselect
 * controls dispatched the raw `CLEAR_SELECTIONS` reducer action, which changed
 * the visible selection without appending anything. That made a deselect
 * unrecoverable — no history entry, so neither undo nor redo could restore or
 * repeat it, and the legacy timeline could never be converted into a durable
 * document that reflects it.
 *
 * This hook routes the Clear/Deselect controls through the same single-writer
 * append boundary every other document edit already uses, so a deselect becomes
 * one `COMMIT_DOCUMENT_EDIT` carrying both the history item and the resulting
 * selection state. Two properties are load-bearing:
 *
 * 1. **One dispatch, one transition.** The history append and the visible
 *    selection change ride on the same action, so they cannot disagree. Two
 *    dispatches would leave a window in which history has already been appended
 *    but the selection has not been cleared, or the reverse.
 * 2. **The durable plan is optional, the edit is not.** The append boundary is a
 *    shadow projection, not the render authority, so a plan that throws must not
 *    cost the user their deselect. The fallback below re-dispatches the identical
 *    action with no `durableEntry`, which leaves the durable state to the store's
 *    whole-timeline reconversion — the same path a pre-existing action takes.
 *
 * Scope note: every gesture that ends in a committed selection is routed here —
 * the Clear/Deselect controls, the magic wand, the rectangle, and the polygon and
 * feathered magnetic lasso. The tool switch in `goToTool` is routed through
 * `appendSelectionClear` rather than through this hook, because `useApp` is
 * called outside a component render.
 */
export const useSelectionHistory = () => {
  const [
    {
      selections,
      activeSelectionId,
      selectionCleared,
      totalSize,
      documentFrame: currentFrame,
      history,
      historyIndex,
      branchRevision = 0,
    },
    dispatch,
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);

  /**
   * Clear every selection as one undoable document edit.
   *
   * Returns without dispatching when there is nothing to clear. An already-empty
   * document has no selection state to move, so a history entry for it would
   * describe a change that did not happen — and because `COMMIT_DOCUMENT_EDIT`
   * always flags unsaved changes, it would also mark the document dirty. The
   * guard is on the selection state itself, not on the `selectionCleared` repaint
   * marker: bumping that marker on a no-op would still be an edit, so the
   * no-op branch skips the dispatch entirely rather than dispatching a
   * marker-only bump.
   */
  const clearSelections = useCallback(
    () =>
      appendSelectionClear({
        selections,
        activeSelectionId,
        selectionCleared,
        history,
        historyIndex,
        branchRevision,
        documentFrame,
        dispatch,
      }),
    [activeSelectionId, dispatch, documentFrame, history, historyIndex, branchRevision, selectionCleared, selections]
  );

  /**
   * Commit a drawn or moved selection as one undoable document edit.
   *
   * This is the creation counterpart of `clearSelections`, and it exists for the
   * same reason plus one. Selection creation used to write no history at all, so
   * a drawn selection survived only as the `previousSelectionState` of whatever
   * cleared it later — which is why the selection baseline lookup in
   * `history-replay.ts` has to scan the whole timeline. Recording creation
   * itself is what eventually lets that lookup be bounded.
   *
   * `mode` selects which post-state the edit describes: `'create'` appends and
   * activates, `'move'` replaces the geometry of an existing selection. Both
   * routes through the single `COMMIT_DOCUMENT_EDIT` append, so the caller must
   * invoke this **once per completed gesture**. A drag dispatches nothing per
   * pointer move — the live rectangle is canvas overlay, not store state — so
   * the commit belongs at gesture end and nowhere else.
   */
  const commitSelection = useCallback(
    (selection: Selection, mode: SelectionCommitMode) => {
      // Same normalisation as `clearSelections`: the store always carries an
      // array, so this only keeps the guard total against a malformed snapshot.
      const existing = Array.isArray(selections) ? selections : [];
      const next = committedSelectionUpdate(mode, existing, activeSelectionId, selection);

      // Guarded on the resulting selection state, for the same reason
      // `clearSelections` is: an entry for an unchanged state would describe a
      // change that did not happen, and `COMMIT_DOCUMENT_EDIT` always flags
      // unsaved changes, so it would also mark the document dirty. Deep
      // compared, because a selection is compared by value — a move rebuilds
      // `points`, `pos` and `metadata`, so an identity check would never fire.
      if (next.activeSelectionId === activeSelectionId && isEqual(next.selections, existing)) return;

      // Captured before any dispatch, so the durable `before` baseline is the
      // state the user actually had, never a value read back after the store
      // moved. `next` is the state this very dispatch publishes, so the same
      // object is both the visible change and the recorded one.
      const previousSelectionState: SelectionSnapshot = { selections: existing, activeSelectionId };
      const nextSelectionState: SelectionSnapshot = {
        selections: next.selections,
        activeSelectionId: next.activeSelectionId,
      };

      const item: NewHistoryItem = {
        actionName: SELECTION_ACTION,
        layerId: 'selection',
        args: { previousSelectionState, nextSelectionState },
      };
      // One id for both paths, so the planned entry and the fallback entry are
      // the same history entry rather than two candidates that differ only by
      // identity.
      const id = uuidv4();
      const updates = {
        selections: next.selections,
        activeSelectionId: next.activeSelectionId,
        selectionDraft: { status: 'idle' as const },
        // A create retires a pending "cleared" repaint marker, exactly as
        // `commitSelection` does. A move omits the field entirely so the store
        // keeps the current marker, exactly as `updateCommittedSelection` does.
        ...(mode === 'create' ? { selectionCleared: null } : {}),
      };

      try {
        const { entry, durableEntry } = planHistoryAppend({
          item,
          id,
          timeline: { entries: history, cursor: historyIndex, branchRevision },
          currentFrame: documentFrame,
          // Passed explicitly: `planHistoryAppend` otherwise defaults the
          // durable `before` to an empty snapshot, which for a creation is not a
          // harmless default — the entry does carry a real previous state.
          currentSelections: previousSelectionState,
        });
        dispatch({ type: 'COMMIT_DOCUMENT_EDIT', payload: { updates, historyItem: entry, durableEntry } });
      } catch {
        // The plan never published, so nothing was appended and the gesture's
        // selection did not land. Re-dispatch the same edit with no durable plan
        // rather than letting a shadow-projection failure reject a valid
        // selection; the store rebuilds durable state from the legacy timeline.
        dispatch({ type: 'COMMIT_DOCUMENT_EDIT', payload: { updates, historyItem: createHistoryItem(item, id) } });
      }
    },
    [activeSelectionId, dispatch, documentFrame, history, historyIndex, branchRevision, selections]
  );

  return { clearSelections, commitSelection };
};
