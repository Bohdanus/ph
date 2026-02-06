import React, { useRef, useCallback, useContext } from 'react';
import { defaultSettings } from '../../../tools/settings.ts';
import { isEqual } from 'lodash-es';
import UndoButton from '../../Common/UndoButton.tsx';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import { type ColorsToolArgs, colors } from '../../../tools/colors.ts';

interface ColorsToolbarProps {
  onChange: (args: ColorsToolArgs) => void;
}

const Colors: React.FC<ColorsToolbarProps> = ({ onChange }) => {
  const { getBitmap, canvasRef, canvasCtxRef, toolArgs } = useContext(ImageContext);
  const args = toolArgs as ColorsToolArgs;
  const pendingUpdateRef = useRef<ColorsToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const throttledOnChange = useCallback(
    (newArgs: ColorsToolArgs) => {
      pendingUpdateRef.current = newArgs;

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingUpdateRef.current !== null) {
            colors({ bitmap: getBitmap()!, canvas: canvasRef.current!, ctx: canvasCtxRef.current })(
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

  const handleGrayscaleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const grayscale = Number(event.target.value);
    throttledOnChange({ ...args, grayscale });
  };

  const handleSepiaChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sepia = Number(event.target.value);
    throttledOnChange({ ...args, sepia });
  };

  const handleSaturationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const saturation = Number(event.target.value);
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
