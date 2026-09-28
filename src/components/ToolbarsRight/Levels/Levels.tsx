import React, { useRef } from 'react';
import UndoButton from '../../Common/UndoButton.tsx';
import { type LevelsToolArgs } from '../../../tools/levels.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';

const Levels: React.FC<{}> = () => {
  const { tempUpdateLayer } = useLayers();
  const [{ activeLayerId }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as LevelsToolArgs;
  const pendingUpdateRef = useRef<LevelsToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const throttledOnChange = (newArgs: Partial<LevelsToolArgs>) => {
    pendingUpdateRef.current = { ...(pendingUpdateRef.current ?? args), ...newArgs };

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        const pending = pendingUpdateRef.current;
        if (pending !== null && activeLayerId !== null) {
          tempUpdateLayer({ id: activeLayerId, toolArgs: pending });
          setToolArgs(pending);
        }
        pendingUpdateRef.current = null;
        rafIdRef.current = null;
      });
    }
  };

  const handleBrightnessChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const brightness = Number(event.target.value);
    throttledOnChange({ brightness });
  };

  const handleContrastChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const contrast = Number(event.target.value);
    throttledOnChange({ contrast });
  };

  const { brightness, contrast } = args;

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <label
          htmlFor="brightness-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Brightness
          <span className="font-bold text-gray-900 dark:text-gray-200">{brightness}%</span>
        </label>
        <input
          id="brightness-slider"
          type="range"
          min={-100}
          max={100}
          value={brightness}
          onChange={handleBrightnessChange}
          className="h-1.5 w-48 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>
      <div className="flex flex-col">
        <label
          htmlFor="contrast-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Contrast
          <span className="font-bold text-gray-900 dark:text-gray-200">{contrast}%</span>
        </label>
        <input
          id="contrast-slider"
          type="range"
          min={-100}
          max={100}
          value={contrast}
          onChange={handleContrastChange}
          className="h-1.5 w-48 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <UndoButton />
    </div>
  );
};

export default Levels;
