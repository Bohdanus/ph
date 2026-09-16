import React from 'react';
import { useHistory } from '../../contexts/useHistory.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';

interface UndoButtonProps {
  text?: string;
}

const UndoButton: React.FC<UndoButtonProps> = ({ text }) => {
  const { isToolDirty, resetToLastSavedArgs } = useCurrentTool();
  const { canUndo, undo } = useHistory();

  const _canUndo = canUndo() || isToolDirty;

  function _undo() {
    if (isToolDirty) {
      resetToLastSavedArgs();
    } else {
      undo();
    }
  }

  return (
    <button
      className={`${SECONDARY_BUTTON} w-full focus:ring-2 focus:ring-blue-500`}
      disabled={!_canUndo}
      onClick={_undo}
      data-testid="undo-button-reset"
    >
      {text ?? 'Reset'}
    </button>
  );
};

export default UndoButton;
