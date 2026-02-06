import React, { useContext, useRef, useCallback } from 'react';
import { defaultSettings } from '../../../tools/settings.ts';
import { isEqual } from 'lodash-es';
import UndoButton from '../../Common/UndoButton.tsx';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import { type LevelsToolArgs, levels } from '../../../tools/levels.ts';

interface LevelsToolbarProps {
  onChange: (args: LevelsToolArgs) => void;
}

const Levels: React.FC<LevelsToolbarProps> = ({ onChange }) => {
  const { getBitmap, canvasRef, canvasCtxRef, toolArgs } = useContext(ImageContext);
  const args = toolArgs as LevelsToolArgs;
  const pendingUpdateRef = useRef<LevelsToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const throttledOnChange = useCallback(
    (newArgs: LevelsToolArgs) => {
      pendingUpdateRef.current = newArgs;

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingUpdateRef.current !== null) {
            levels({ bitmap: getBitmap()!, canvas: canvasRef.current!, ctx: canvasCtxRef.current })(
              pendingUpdateRef.current
            );
            onChange(pendingUpdateRef.current);
            pendingUpdateRef.current = null;
          }
          rafIdRef.current = null;
        });
      }
    },
    [onChange, getBitmap, canvasRef, canvasCtxRef]
  );

  const handleBrightnessChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const brightness = Number(event.target.value);
    throttledOnChange({ ...args, brightness });
  };

  const handleContrastChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const contrast = Number(event.target.value);
    throttledOnChange({ ...args, contrast });
  };

  const { brightness, contrast } = args;
  const hasDefaultValues = isEqual(args, defaultSettings.levels);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="brightness-slider" className="text-sm font-medium text-gray-700 dark:text-gray-300">
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
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span className="min-w-[40px] text-right text-sm dark:text-gray-400">
            <b className="text-gray-900 dark:text-gray-200">{brightness}%</b>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contrast-slider" className="text-sm font-medium text-gray-700 dark:text-gray-300">
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
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span className="min-w-[40px] text-right text-sm dark:text-gray-400">
            <b className="text-gray-900 dark:text-gray-200">{contrast}%</b>
          </span>
        </div>
      </div>

      <UndoButton disabled={hasDefaultValues} />
    </div>
  );
};

export default Levels;
