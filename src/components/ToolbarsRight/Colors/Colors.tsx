import React, { useMemo, useEffect } from 'react';
import { defaultSettings } from '../../../tools/settings.ts';
import { isEqual, throttle } from 'lodash-es';
import { THROTTLE_TIME } from '../../../constants';
import UndoButton from '../../Common/UndoButton.tsx';

interface ColorsToolbarProps {
  args: { grayscale?: number; sepia?: number; saturation?: number };
  onChange: (args: { grayscale: number; sepia: number; saturation: number }) => void;
}

const Colors: React.FC<ColorsToolbarProps> = ({ args, onChange }) => {
  const throttledOnChange = useMemo(() => throttle(onChange, THROTTLE_TIME), [onChange]);

  useEffect(() => {
    return () => {
      throttledOnChange.cancel();
    };
  }, [throttledOnChange]);

  const handleGrayscaleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const grayscale = Number(event.target.value);
    // @ts-expect-error: mess with polymorphic args
    throttledOnChange({ ...args, grayscale });
  };

  const handleSepiaChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sepia = Number(event.target.value);
    // @ts-expect-error: mess with polymorphic args
    throttledOnChange({ ...args, sepia });
  };

  const handleSaturationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const saturation = Number(event.target.value);
    // @ts-expect-error: mess with polymorphic args
    throttledOnChange({ ...args, saturation });
  };

  const { grayscale, sepia, saturation } = args;
  const hasDefaultValues = isEqual(args, defaultSettings.colors);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="grayscale-slider" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Grayscale
        </label>
        <div className="flex items-center gap-2">
          <input
            id="grayscale-slider"
            type="range"
            min="0"
            max="100"
            value={grayscale}
            onChange={handleGrayscaleChange}
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span className="min-w-[40px] text-right text-sm dark:text-gray-400">
            <b className="text-gray-900 dark:text-gray-200">{grayscale}%</b>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="sepia-slider" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Sepia
        </label>
        <div className="flex items-center gap-2">
          <input
            id="sepia-slider"
            type="range"
            min="0"
            max="100"
            value={sepia}
            onChange={handleSepiaChange}
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span className="min-w-[40px] text-right text-sm dark:text-gray-400">
            <b className="text-gray-900 dark:text-gray-200">{sepia}%</b>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="saturation-slider" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Saturation
        </label>
        <div className="flex items-center gap-2">
          <input
            id="saturation-slider"
            type="range"
            min={0}
            max={100}
            value={saturation}
            onChange={handleSaturationChange}
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span className="min-w-[40px] text-right text-sm dark:text-gray-400">
            <b className="text-gray-900 dark:text-gray-200">{saturation}%</b>
          </span>
        </div>
      </div>

      <UndoButton disabled={hasDefaultValues} />
    </div>
  );
};

export default Colors;
