import React from 'react';
import type { CropToolArgs } from '../../../tools/crop.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

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
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex items-center gap-2">
        <label
          htmlFor="aspect-ratio"
          className="whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300"
        >
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
          className="rounded border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {aspectRatios.map((ratio) => (
            <option key={ratio.label} value={ratio.value ?? ''}>
              {ratio.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          className={PRIMARY_BUTTON}
          disabled={!rect}
          onClick={async () => {
            await updateLayerByTool({ toolArgs: args });
            onChange({ ...args, rect: null });
          }}
        >
          Apply
        </button>

        <button className={SECONDARY_BUTTON} disabled={!rect} onClick={() => onChange({ ...args, rect: null })}>
          Clear
        </button>
      </div>
    </div>
  );
};

export default Crop;
