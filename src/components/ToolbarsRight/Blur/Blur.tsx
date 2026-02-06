import React, { useRef, useCallback, useContext } from 'react';

import UndoButton from '../../Common/UndoButton.tsx';
import { type BlurToolArgs, blur } from '../../../tools/blur.ts';
import { ImageContext } from '../../../contexts/ImageContext.tsx';

interface BlurToolbarProps {
  onChange: (args: BlurToolArgs) => void;
}

const Blur: React.FC<BlurToolbarProps> = ({ onChange }) => {
  const { getBitmap, canvasRef, canvasCtxRef, toolArgs } = useContext(ImageContext);
  const args = toolArgs as BlurToolArgs;
  const pendingUpdateRef = useRef<BlurToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const throttledOnChange = useCallback(
    (newArgs: BlurToolArgs) => {
      pendingUpdateRef.current = newArgs;

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingUpdateRef.current !== null) {
            blur({ bitmap: getBitmap()!, canvas: canvasRef.current!, ctx: canvasCtxRef.current })(
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

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ radius: Number(event.target.value) });
  };
  const { radius } = args;
  const hasDefaultValues = radius === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label htmlFor="blur-slider" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Blur Radius
        </label>
        <input
          id="blur-slider"
          type="range"
          min="0"
          max="100"
          value={radius}
          onChange={handleChange}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          Radius: <b className="text-gray-900 dark:text-gray-200">{radius}px</b>
        </span>
      </div>

      <UndoButton disabled={hasDefaultValues} text="Undo Blur" />
    </div>
  );
};

export default Blur;
