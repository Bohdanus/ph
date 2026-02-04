import React, { type ChangeEvent, useContext, useState } from 'react';
import type { DrawToolNoPoints, PenType } from '../../../tools/draw.ts';
import { savedDrawPerPen, savedLastSettings } from '../../../tools/settings.ts';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { isLightColor } from '../../../util/color.ts';

const Draw: React.FC = () => {
  const { containerRef, size: imageSize } = useContext(ImageContext);
  const [args, setArgs] = useState<DrawToolNoPoints>(savedLastSettings.draw as DrawToolNoPoints);
  const [brushScale, setBrushScale] = useState<number>(0);

  usePointerPosition({ ref: containerRef, imageSize, onResize: ({ scale }) => setBrushScale(scale) });

  const handleChange = (newArgs: DrawToolNoPoints) => {
    savedLastSettings.draw = newArgs;
    savedDrawPerPen[newArgs.penType] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
    };
    setArgs(newArgs);
  };

  const handleColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    const color = event.target.value;
    handleChange({ ...args, color });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const lineWidth = Number(event.target.value);
    handleChange({ ...args, lineWidth });
  };

  const handleAlphaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const alpha = Number(event.target.value);
    handleChange({ ...args, alpha });
  };

  const handlePenTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const penType = event.target.value as PenType;
    handleChange({ ...args, ...savedDrawPerPen[penType], penType });
  };

  const { alpha, color, lineWidth: brushSize, penType, lineDash } = args;

  const scaledBrushSize = brushSize * brushScale;
  const dash = lineDash ? lineDash[0] * brushScale : 0;
  const gap = lineDash ? lineDash[1] * brushScale : 0;

  const previewStyle: React.CSSProperties =
    penType === 'pen-dashed' && lineDash
      ? {
          border: `${scaledBrushSize}px solid transparent`,
          backgroundImage: `linear-gradient(transparent, transparent), repeating-linear-gradient(to right, ${color}, ${color} ${dash}px, transparent ${dash}px, transparent ${
            dash + gap
          }px), repeating-linear-gradient(to bottom, ${color}, ${color} ${dash}px, transparent ${dash}px, transparent ${
            dash + gap
          }px), repeating-linear-gradient(to left, ${color}, ${color} ${dash}px, transparent ${dash}px, transparent ${
            dash + gap
          }px), repeating-linear-gradient(to top, ${color}, ${color} ${dash}px, transparent ${dash}px, transparent ${
            dash + gap
          }px)`,
          backgroundSize: `100% 100%, 100% ${scaledBrushSize}px, ${scaledBrushSize}px 100%, 100% ${scaledBrushSize}px, ${scaledBrushSize}px 100%`,
          backgroundPosition: `0 0, 0 0, 100% 0, 100% 100%, 0 100%`,
          backgroundRepeat: 'no-repeat, repeat-x, repeat-y, repeat-x, repeat-y',
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box, border-box, border-box, border-box',
          borderRadius: '50%',
        }
      : {
          backgroundColor: color,
          borderRadius: '50%',
        };

  return (
    <div className="flex flex-col gap-4">
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
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="pen-type" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Pen Type
        </label>
        <select
          id="pen-type"
          value={penType}
          onChange={handlePenTypeChange}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="pen">Pen</option>
          <option value="pen-dashed">Dashed Pen</option>
          <option value="spray">Spray</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="size-slider"
          className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Brush Size
          <span className="font-bold text-gray-900 dark:text-gray-200">{brushSize}px</span>
        </label>
        <input
          id="size-slider"
          type="range"
          min="0.5"
          max="500"
          step="0.5"
          value={brushSize}
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
        className={`mt-4 flex items-center justify-center rounded border border-gray-200 dark:border-gray-700 ${
          isLightColor(color) ? 'checkerboard-dark' : 'checkerboard-light'
        }`}
        style={{ height: '224px', overflow: 'auto' }}
      >
        <div
          style={{
            flexShrink: 0,
            width: `${Math.round(scaledBrushSize)}px`,
            height: `${Math.round(scaledBrushSize)}px`,
            opacity: alpha,
            ...previewStyle,
          }}
        />
      </div>
    </div>
  );
};

export default Draw;
