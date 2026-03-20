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

  const throttledOnChange = (newArgs: LevelsToolArgs) => {
    pendingUpdateRef.current = newArgs;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingUpdateRef.current !== null) {
          tempUpdateLayer({ id: activeLayerId!, toolName: 'levels', toolArgs: pendingUpdateRef.current });
          setToolArgs(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
        rafIdRef.current = null;
      });
    }
  };

  const handleBrightnessChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const brightness = Number(event.target.value);
    throttledOnChange({ ...args, brightness });
  };

  const handleContrastChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const contrast = Number(event.target.value);
    throttledOnChange({ ...args, contrast });
  };

  const { brightness, contrast } = args;

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

      <UndoButton />
    </div>
  );
};

export default Levels;
