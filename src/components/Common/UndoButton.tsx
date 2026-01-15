import React, { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';

interface UndoButtonProps {
  disabled: boolean;
  text?: string;
}

const UndoButton: React.FC<UndoButtonProps> = ({ disabled, text }) => {
  const { resetArgs } = useContext(ImageContext);

  return (
    <button
      className="mt-2 rounded bg-gray-600 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={resetArgs}
    >
      {text ?? 'Reset'}
    </button>
  );
};

export default UndoButton;
