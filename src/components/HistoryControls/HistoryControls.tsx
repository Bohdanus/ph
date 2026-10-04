import { useHistoryCommands } from '../../hooks/useHistoryCommands.ts';
import { TRANSPARENT_DARK_ICON_BUTTON } from '../ToolbarsRight/buttonStyles.ts';

const HistoryControls = () => {
  // The gesture gate and the comment explaining it moved to `useHistoryCommands`, because
  // `DesktopHeader`'s `Edit ▸ Undo` / `Edit ▸ Step Forward` rows now need the same two
  // guarded commands and a third copy of that guard is a third chance to leave it out.
  const { canUndo, undo, canRedo, redo } = useHistoryCommands();

  // The keyboard refuses document-mutating shortcuts while a pointer gesture
  // owns the document (`useKeyboardEvents.tsx:134`), and these two buttons
  // dispatch the same replay with no such gate. Inside a gesture's window the
  // replay is destructive: `undo`/`redo` replays `selections` from the SAME
  // `history` array, so `history.length` never moves and the pending commit's
  // `entries.slice(0, cursor + 1)` truncates the redo tail with no other
  // symptom. A single pointer cannot do it — the pointer is captured by the tool
  // area — so the window is reachable only by a second pointer.
  //
  // That gate is `useHistoryCommands`, which refuses both directions; the rest
  // of the reasoning moved there with it. There is deliberately no
  // `isDocumentGestureOpen()` in the `disabled` expression either, and that is
  // `useHistoryCommands`'s rule as much as this component's: the claim is a
  // module-level slot with no re-render, so a render-time read is stale in both
  // directions — it cannot see a gesture that opened after the last render, and
  // a button disabled by a mid-gesture render would stay disabled after the
  // release. `disabled` is advisory anyway — this handler is the guarantee, and
  // it reads the slot at click time.

  return (
    <div className="flex gap-1" data-testid="history-controls">
      <button
        className={TRANSPARENT_DARK_ICON_BUTTON}
        onClick={undo}
        disabled={!canUndo()}
        aria-label="Undo"
        title="Undo"
        data-testid="undo-button"
      >
        ↩️
      </button>
      <button
        className={TRANSPARENT_DARK_ICON_BUTTON}
        onClick={redo}
        disabled={!canRedo()}
        aria-label="Redo"
        title="Redo"
        data-testid="redo-button"
      >
        ↪️
      </button>
    </div>
  );
};

export default HistoryControls;
