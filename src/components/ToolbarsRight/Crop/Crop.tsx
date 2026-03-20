import React from 'react';
import type { CropToolArgs } from '../../../tools/crop.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';

const aspectRatios = [
  { label: 'Free', value: null },
  { label: 'Square (1:1)', value: 1 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const Crop: React.FC<{}> = () => {
  const { updateLayerByTool } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as CropToolArgs;
  const { aspectRatio, rect } = args;

  const onChange = setToolArgs;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="aspect-ratio" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Aspect Ratio
        </label>
        <select
          id="aspect-ratio"
          value={aspectRatio ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            const newAspectRatio = val === '' ? null : Number(val);
            onChange({ ...args, aspectRatio: newAspectRatio });
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
        disabled={!rect}
        onClick={() => {
          // const fullArgs: FullArgs = { toolName: 'crop', args, rect: sortedRectToRect(rect!) };
          updateLayerByTool({ toolName: 'crop', toolArgs: args });
          onChange({ ...args, rect: null });
        }}
      >
        Apply Crop
      </button>

      <button
        className="w-full rounded border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        disabled={!rect}
        onClick={() => onChange({ ...args, rect: null })}
      >
        Clear Crop
      </button>
    </div>
  );
};

export default Crop;
