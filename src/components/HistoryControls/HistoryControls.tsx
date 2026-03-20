import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useHistory } from '../../contexts/useHistory.ts';

const HistoryControls = () => {
  const { isToolDirty, resetToLastSavedArgs } = useCurrentTool();
  const { canUndo, undo, canRedo, redo } = useHistory();

  const _canUndo = canUndo() || isToolDirty;

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
        className="flex h-8 w-8 items-center justify-center rounded bg-transparent text-white opacity-75 hover:bg-gray-700 hover:opacity-100 disabled:opacity-25 disabled:hover:bg-transparent"
        onClick={_undo}
        disabled={!_canUndo}
        aria-label="Undo"
        title="Undo"
      >
        ↩️
      </button>
      <button
        className="flex h-8 w-8 items-center justify-center rounded bg-transparent text-white opacity-75 hover:bg-gray-700 hover:opacity-100 disabled:opacity-25 disabled:hover:bg-transparent"
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
