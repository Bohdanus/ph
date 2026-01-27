import React, { useContext } from 'react';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import type { TransformToolType } from '../../../tools/transform.ts';
import type { CropToolType } from '../../../tools/crop.ts';

interface TransformToolbarProps {
  args: CropToolType;
  onChange: (args: TransformToolType) => void;
}

const Crop: React.FC<TransformToolbarProps> = () => {
  const { crop, setCrop, updateLastHistoryItem } = useContext(ImageContext);

  return (
    <div className="flex flex-col gap-4">
      <button
        className="w-full rounded bg-blue-600 px-4 py-2 font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!crop}
        onClick={() => {
          updateLastHistoryItem({
            args: crop!,
            forceNewItem: true,
          });
          setCrop(null);
        }}
      >
        Apply Crop
      </button>

      <button
        className="w-full rounded border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        disabled={!crop}
        onClick={() => setCrop(null)}
      >
        Clear Crop
      </button>
    </div>
  );
};

export default Crop;
