import React, { useRef } from 'react';

import UndoButton from '../../Common/UndoButton.tsx';
import { type BlurToolArgs } from '../../../tools/blur.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';

const Blur: React.FC<{}> = () => {
  const { tempUpdateLayer } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as BlurToolArgs;
  const { radius } = args;

  const pendingUpdateRef = useRef<BlurToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const throttledOnChange = (newArgs: BlurToolArgs) => {
    pendingUpdateRef.current = newArgs;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingUpdateRef.current !== null) {
          tempUpdateLayer({ toolName: 'blur', toolArgs: pendingUpdateRef.current });
          setToolArgs(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
        rafIdRef.current = null;
      });
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ radius: Number(event.target.value) });
  };

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <label
          htmlFor="blur-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Blur Radius
          <span className="font-bold text-gray-900 dark:text-gray-200">{radius}px</span>
        </label>
        <input
          id="blur-slider"
          type="range"
          min="0"
          max="100"
          value={radius}
          onChange={handleChange}
          className="h-1.5 w-48 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <UndoButton text="Undo Blur" />
    </div>
  );
};

export default Blur;
