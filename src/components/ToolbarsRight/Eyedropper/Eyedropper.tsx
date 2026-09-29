import React from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { EYEDROPPER_SAMPLE_SIZE_OPTIONS, type EyedropperSampleSize } from '../../../tools/eyedropper.ts';

const FIELD_CLASS = 'flex min-w-32 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';

const Eyedropper: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();

  const args = getToolArgs('eyedropper');
  if (!args) return null;

  const handleSampleSizeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    patchToolArgs('eyedropper', { sampleSize: Number(event.target.value) as EyedropperSampleSize });
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label className={`${FIELD_CLASS} min-w-36`} htmlFor="eyedropper-sample-size">
        Sample Size
        <select
          className={SELECT_CLASS}
          id="eyedropper-sample-size"
          value={args.sampleSize}
          onChange={handleSampleSizeChange}
        >
          {EYEDROPPER_SAMPLE_SIZE_OPTIONS.map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};

export default Eyedropper;
