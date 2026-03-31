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
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <label
          htmlFor="grayscale-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Grayscale
          <span className="font-bold text-gray-900 dark:text-gray-200">{grayscale}%</span>
        </label>
        <input
          id="grayscale-slider"
          type="range"
          min="0"
          max="100"
          value={grayscale}
          onChange={handleGrayscaleChange}
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="sepia-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Sepia
          <span className="font-bold text-gray-900 dark:text-gray-200">{sepia}%</span>
        </label>
        <input
          id="sepia-slider"
          type="range"
          min="0"
          max="100"
          value={sepia}
          onChange={handleSepiaChange}
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="saturation-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Saturation
          <span className="font-bold text-gray-900 dark:text-gray-200">{saturation}%</span>
        </label>
        <input
          id="saturation-slider"
          type="range"
          min={0}
          max={100}
          value={saturation}
          onChange={handleSaturationChange}
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex gap-2 items-center h-8 self-end mb-1">
        <UndoButton />
        <button
          onClick={mergeAllLayers}
          className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Merge all
        </button>
      </div>
    </div>
  );
};

export default Color;
