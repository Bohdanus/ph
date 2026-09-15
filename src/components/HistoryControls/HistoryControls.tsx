import { useHistory } from '../../contexts/useHistory.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { TRANSPARENT_DARK_ICON_BUTTON } from '../ToolbarsRight/buttonStyles.ts';

const HistoryControls = () => {
  const { canUndo, undo, canRedo, redo } = useHistory();
  const { isToolDirty, resetToLastSavedArgs } = useCurrentTool();

  function _undo() {
    if (isToolDirty) {
      resetToLastSavedArgs();
    } else {
      undo();
    }
  }

  return (
    <div className="flex gap-1">
      <button
        className={TRANSPARENT_DARK_ICON_BUTTON}
        onClick={_undo}
        disabled={!canUndo() && !isToolDirty}
        aria-label="Undo"
        title="Undo"
      >
        ↩️
      </button>
      <button
        className={TRANSPARENT_DARK_ICON_BUTTON}
        onClick={redo}
        disabled={!canRedo()}
        aria-label="Redo"
        title="Redo"
      >
        ↪️
      </button>
    </div>
  );
};

export default HistoryControls;
