import { useHistory } from '../contexts/useHistory.ts';
import { isDocumentGestureOpen } from './document-gesture.ts';

/**
 * `useHistory`'s four entry points with the document-gesture gate already applied.
 *
 * WHY A HOOK AND NOT A `useHistory` CHANGE. `useHistory` is a context value: it cannot read a
 * pointer claim without every consumer re-rendering per gesture, which `document-gesture.ts`
 * rules out by design. The gate therefore has to live in whoever calls `undo`/`redo`, and there
 * are now three such callers — `AppKeyboardShortcuts`, the header's two undo/redo buttons, and
 * the `Edit ▸ Undo` / `Edit ▸ Step Forward` menu rows. A gate copied three times is a gate that
 * will be copied without it once, and the failure it prevents is silent history corruption, not
 * a thrown error: see `document-gesture.ts` for why `undo` inside an open gesture truncates the
 * redo tail with no other symptom. One gate, one place to argue about it.
 *
 * WHAT IT DOES NOT DO. It does not gate `canUndo`/`canRedo`, because `disabled` is advisory —
 * `HistoryControls` says so on its own `disabled` expression — and a `disabled` attribute driven
 * by a mid-gesture render would go stale the moment the pointer lifts. The refusal is the
 * handler, read at click time.
 */
export const useHistoryCommands = () => {
  const { canUndo, undo, canRedo, redo } = useHistory();

  return {
    canUndo,
    canRedo,
    undo: () => {
      if (isDocumentGestureOpen()) return;
      undo();
    },
    redo: () => {
      if (isDocumentGestureOpen()) return;
      redo();
    },
  };
};
