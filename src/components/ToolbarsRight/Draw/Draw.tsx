import React, { type ChangeEvent, useContext, useState } from 'react';
import type { DrawToolNoPoints } from '../../../tools/draw.ts';
import { savedDrawPerPen, savedLastSettings } from '../../../tools/settings.ts';
import { ImageContext } from '../../../contexts/ImageContext.tsx';

const Draw: React.FC = () => {
  const { interactionMode, zoomDataRef } = useContext(ImageContext);
  const [args, setArgs] = useState<DrawToolNoPoints>(savedLastSettings.draw as DrawToolNoPoints);

  const handleChange = (newArgs: DrawToolNoPoints) => {
    savedLastSettings.draw = newArgs;
    savedDrawPerPen[newArgs.penType] = { alpha: newArgs.alpha, color: newArgs.color, size: newArgs.size };
    setArgs(newArgs);
  };

  const handleColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    const color = event.target.value;
    handleChange({ ...args, color });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const size = Number(event.target.value);
    handleChange({ ...args, size });
  };

  const handleAlphaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const alpha = Number(event.target.value);
    handleChange({ ...args, alpha });
  };

  // const handlePenTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
  //   const penType = event.target.value as PenType;
  //   handleChange({ ...args, ...savedDrawPerPen[penType], penType });
  // };

  const { alpha, color, size, penType } = args;
  // const hasDefaultValues = points!.length === 0;

  return (
    <div className="flex flex-col gap-4" style={{ opacity: interactionMode === 'draw' ? 1 : 0.5 }}>
      <div className="flex flex-col gap-2">
        <label htmlFor="color-picker" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Color
        </label>
        <input
          id="color-picker"
          type="color"
          value={color}
          onChange={handleColorChange}
          className="h-10 w-full cursor-pointer rounded border border-gray-300 p-1 dark:border-gray-600 dark:bg-gray-700"
          disabled={penType === 'eraser'}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="size-slider"
          className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Brush Size
          <span className="font-bold text-gray-900 dark:text-gray-200">{size}px</span>
        </label>
        <input
          id="size-slider"
          type="range"
          min="1"
          max="400"
          value={size}
          onChange={handleSizeChange}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="alpha-slider"
          className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Opacity
          <span className="font-bold text-gray-900 dark:text-gray-200">{Math.round(alpha * 100)}%</span>
        </label>
        <input
          id="alpha-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          onChange={handleAlphaChange}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div
        className="mt-4 flex items-center justify-center rounded border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
        style={{ minHeight: '220px' }}
      >
        <div
          style={{
            // width: `${size * zoomData.zoom}px`,
            // height: `${size * zoomData.zoom}px`,
            backgroundColor: color,
            opacity: alpha,
            borderRadius: '50%',
          }}
        />
      </div>
    </div>
  );
};

export default Draw;
