import { useHistory } from '../../contexts/useHistory.ts';
import { isDocumentGestureOpen } from '../../hooks/document-gesture.ts';
import { TRANSPARENT_DARK_ICON_BUTTON } from '../ToolbarsRight/buttonStyles.ts';

const HistoryControls = () => {
  const { canUndo, undo, canRedo, redo } = useHistory();

  // The keyboard refuses document-mutating shortcuts while a pointer gesture
  // owns the document (`useKeyboardEvents.tsx:134`), and these two buttons
  // dispatch the same replay with no such gate. Inside a gesture's window the
  // replay is destructive: `undo`/`redo` replays `selections` from the SAME
  // `history` array, so `history.length` never moves and the pending commit's
  // `entries.slice(0, cursor + 1)` truncates the redo tail with no other
  // symptom. A single pointer cannot do it — the pointer is captured by the tool
  // area — so the window is reachable only by a second pointer.
  //
  // The refusal is here, at the input layer, and deliberately NOT in the
  // `APPLY_HISTORY_REPLAY` dispatcher arm: a writer-side guard is the wrong
  // layer, because no dispatch should happen at all. The `historyLength`
  // comparison an earlier attempt used cannot work for the same reason the
  // keyboard's own comment gives — replaying `selections` does not change
  // `history.length` — and where it did fire it discarded the selection entry
  // and made it permanently unrecoverable.
  //
  // There is deliberately no `isDocumentGestureOpen()` in the `disabled`
  // expression either. The claim is a module-level slot with no re-render, so a
  // render-time read is stale in both directions: it cannot see a gesture that
  // opened after the last render, and a button disabled by a mid-gesture
  // render would stay disabled after the release. `disabled` is advisory
  // anyway — this handler is the guarantee, and it reads the slot at click time.
  const handleUndo = () => {
    if (isDocumentGestureOpen()) return;
    undo();
  };

  const handleRedo = () => {
    if (isDocumentGestureOpen()) return;
    redo();
  };

  return (
    <div className="flex gap-1" data-testid="history-controls">
      <button
        className={TRANSPARENT_DARK_ICON_BUTTON}
        onClick={handleUndo}
        disabled={!canUndo()}
        aria-label="Undo"
        title="Undo"
        data-testid="undo-button"
      >
        ↩️
      </button>
      <button
        className={TRANSPARENT_DARK_ICON_BUTTON}
        onClick={handleRedo}
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
