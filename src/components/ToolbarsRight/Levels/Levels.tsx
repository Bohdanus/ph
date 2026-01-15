import React from 'react';
import { defaultSettings } from '../../../tools/settings.ts';
import { isEqual } from 'lodash-es';
import UndoButton from '../../Common/UndoButton.tsx';

interface LevelsToolbarProps {
  args: { brightness?: number; contrast?: number };
  onChange: (args: { brightness: number; contrast: number }) => void;
}

const Levels: React.FC<LevelsToolbarProps> = ({ args, onChange }) => {
  const handleBrightnessChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const brightness = Number(event.target.value);
    // @ts-expect-error: mess with polymorphic args
    onChange({ ...args, brightness });
  };

  const handleContrastChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const contrast = Number(event.target.value);
    // @ts-expect-error: mess with polymorphic args
    onChange({ ...args, contrast });
  };

  const { brightness, contrast } = args;
  const hasDefaultValues = isEqual(args, defaultSettings.levels);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="brightness-slider" className="text-sm font-medium text-gray-700">
          Brightness
        </label>
        <div className="flex items-center gap-2">
          <input
            id="brightness-slider"
            type="range"
            min={-100}
            max={100}
            value={brightness}
            onChange={handleBrightnessChange}
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200"
          />
          <span className="min-w-[40px] text-right text-sm">
            <b className="text-gray-900">{brightness}%</b>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contrast-slider" className="text-sm font-medium text-gray-700">
          Contrast
        </label>
        <div className="flex items-center gap-2">
          <input
            id="contrast-slider"
            type="range"
            min={-100}
            max={100}
            value={contrast}
            onChange={handleContrastChange}
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200"
          />
          <span className="min-w-[40px] text-right text-sm">
            <b className="text-gray-900">{contrast}%</b>
          </span>
        </div>
      </div>

      <UndoButton disabled={hasDefaultValues} />
    </div>
  );
};

export default Levels;
