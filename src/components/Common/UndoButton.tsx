import React, { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';

interface UndoButtonProps {
  disabled: boolean;
  text?: string;
}

const UndoButton: React.FC<UndoButtonProps> = ({ disabled, text }) => {
  const { undo } = useContext(ImageContext);

  return (
    <button
      className="w-full rounded border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
      disabled={disabled}
      onClick={undo}
    >
      {text ?? 'Reset'}
    </button>
  );
};

export default UndoButton;
