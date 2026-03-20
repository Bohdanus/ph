import React, { useRef } from 'react';
import UndoButton from '../../Common/UndoButton.tsx';
import { type ColorsToolArgs } from '../../../tools/colors.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';

const Color: React.FC<{}> = () => {
  const { tempUpdateLayer, mergeAllLayers } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as ColorsToolArgs;
  const pendingUpdateRef = useRef<ColorsToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const throttledOnChange = (newArgs: ColorsToolArgs) => {
    pendingUpdateRef.current = newArgs;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingUpdateRef.current !== null) {
          tempUpdateLayer({ toolName: 'color', toolArgs: pendingUpdateRef.current });
          setToolArgs(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
        rafIdRef.current = null;
      });
    }
  };

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

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-900/30">
        <p className="text-xs text-blue-700 dark:text-blue-300">Tool will be applied to selected layer only</p>
      </div>

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

      <UndoButton />

      <button
        onClick={mergeAllLayers}
        className="mt-2 w-full rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Merge all layers
      </button>
    </div>
  );
};

export default Color;
