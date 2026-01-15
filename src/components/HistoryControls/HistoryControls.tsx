import { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';

const HistoryControls = () => {
  const { undo, redo, canUndo, canRedo } = useContext(ImageContext);

  return (
    <div className="flex gap-1">
      <button
        className="flex h-8 w-8 items-center justify-center rounded bg-transparent text-white opacity-75 hover:bg-gray-700 hover:opacity-100 disabled:opacity-25 disabled:hover:bg-transparent"
        onClick={undo}
        disabled={!canUndo()}
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
