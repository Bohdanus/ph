import { useHistory } from '../../contexts/useHistory.ts';
import { TRANSPARENT_DARK_ICON_BUTTON } from '../ToolbarsRight/buttonStyles.ts';

const HistoryControls = () => {
  const { canUndo, undo, canRedo, redo } = useHistory();

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
