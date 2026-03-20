import React from 'react';
import { useHistory } from '../../contexts/useHistory.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';

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
      className="w-full rounded border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
      disabled={!_canUndo}
      onClick={_undo}
    >
      {text ?? 'Reset'}
    </button>
  );
};

export default UndoButton;
