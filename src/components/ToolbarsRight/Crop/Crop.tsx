import React, { useContext } from 'react';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import type { TransformToolType } from '../../../tools/transform.ts';
import type { CropToolType } from '../../../tools/crop.ts';

interface TransformToolbarProps {
  args: CropToolType;
  onChange: (args: TransformToolType) => void;
}

const Crop: React.FC<TransformToolbarProps> = () => {
  const { crop, setCrop, updateLastHistoryItem, cropAspectRatio, setCropAspectRatio } = useContext(ImageContext);

  const aspectRatios = [
    { label: 'Free', value: null },
    { label: 'Square (1:1)', value: 1 },
    { label: '3:4', value: 3 / 4 },
    { label: '4:3', value: 4 / 3 },
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="aspect-ratio" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Aspect Ratio
        </label>
        <select
          id="aspect-ratio"
          value={cropAspectRatio ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            setCropAspectRatio(val === '' ? null : Number(val));
          }}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {aspectRatios.map((ratio) => (
            <option key={ratio.label} value={ratio.value ?? ''}>
              {ratio.label}
            </option>
          ))}
        </select>
      </div>

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
