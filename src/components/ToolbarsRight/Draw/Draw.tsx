import React, { type ChangeEvent, useContext, useState } from 'react';
import type { DrawToolSettings, PenType } from '../../../tools/draw.ts';
import { savedDrawPerPen } from '../../../tools/settings.ts';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { isLightColor } from '../../../util/color.ts';

interface DrawToolbarProps {
  onChange: (args: DrawToolSettings) => void;
}

const Draw: React.FC<DrawToolbarProps> = ({ onChange }) => {
  const { containerRef, size: imageSize, toolArgs } = useContext(ImageContext);
  const args = toolArgs as DrawToolSettings;
  const [brushScale, setBrushScale] = useState<number>(0);

  usePointerPosition({ ref: containerRef, imageSize, onResize: ({ scale }) => setBrushScale(scale) });

  const handleChange = (newArgs: DrawToolSettings) => {
    savedDrawPerPen[newArgs.penType] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
    };
    onChange(newArgs);
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

  const handleDashChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    const gap = args.lineDash?.[1] ?? 10;
    handleChange({ ...args, lineDash: [value, gap] });
  };

  const handleGapChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    const dash = args.lineDash?.[0] ?? 10;
    handleChange({ ...args, lineDash: [dash, value] });
  };

  const handlePenTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const penType = event.target.value as PenType;
    handleChange({ ...args, ...savedDrawPerPen[penType], penType });
  };

  const { alpha, color, lineWidth: brushSize, penType, lineDash } = args;

  const scaledBrushSize = brushSize * brushScale + (penType === 'pen-dashed' ? 1 : 0);
  const dash = lineDash ? lineDash[0] * brushScale : 0;
  const gap = lineDash ? lineDash[1] * brushScale : 0;

  let previewStyle: React.CSSProperties = {};

  if (penType === 'pen-dashed' && lineDash) {
    previewStyle = {
      background: `repeating-linear-gradient(
        to right,
        ${color} 0px, ${color} ${dash + scaledBrushSize}px, transparent ${dash + scaledBrushSize}px, transparent ${dash + scaledBrushSize + gap}px)`,
    };
  } else {
    previewStyle = {
      background: color,
    };
  }

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

      {penType === 'pen-dashed' && lineDash && (
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="dash-size"
              className="flex justify-between text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              Dash
              <span className="font-bold text-gray-900 dark:text-gray-200">{lineDash[0]}px</span>
            </label>
            <input
              id="dash-size"
              type="range"
              min="1"
              max="100"
              value={lineDash[0]}
              onChange={handleDashChange}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="gap-size"
              className="flex justify-between text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              Gap
              <span className="font-bold text-gray-900 dark:text-gray-200">{lineDash[1]}px</span>
            </label>
            <input
              id="gap-size"
              type="range"
              min="1"
              max="100"
              value={lineDash[1]}
              onChange={handleGapChange}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>
        </div>
      )}

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
            width: penType === 'pen-dashed' ? '77%' : `${Math.round(scaledBrushSize)}px`,
            height: `${Math.round(scaledBrushSize)}px`,
            opacity: alpha,
            borderRadius: penType === 'pen-dashed' ? Math.round(scaledBrushSize) : '50%',
            ...previewStyle,
          }}
        />
      </div>
    </div>
  );
};

export default Draw;
