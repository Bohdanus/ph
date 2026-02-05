import React, { type ChangeEvent, useContext, useRef, useState } from 'react';
import { savedArgsPerFigure, savedLastSettings } from '../../../tools/settings.ts';
import { ImageContext } from '../../../contexts/ImageContext.tsx';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import type { FigureType, ShapeToolType } from '../../../tools/shape.ts';
import { isLightColor } from '../../../util/color.ts';

const Shapes: React.FC = () => {
  const { containerRef, size: imageSize } = useContext(ImageContext);
  const [args, setArgs] = useState<ShapeToolType>(savedLastSettings.shape as ShapeToolType);
  const [brushScale, setBrushScale] = useState<number>(0);
  const savedFillColorRef = useRef(args.fillColor);
  const savedLineDashRef = useRef(args.lineDash);

  usePointerPosition({ ref: containerRef, imageSize, onResize: ({ scale }) => setBrushScale(scale) });

  const handleChange = (newArgs: ShapeToolType) => {
    savedLastSettings.shape = newArgs;
    savedArgsPerFigure[newArgs.figure] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
    };
    setArgs(newArgs);
  };

  const handleColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    const lineColor = event.target.value;
    handleChange({ ...args, lineColor });
  };

  const handleFillColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fillColor = event.target.value;
    handleChange({ ...args, fillColor });
  };

  const handleFillToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const fill = event.target.checked;
    if (args.fillColor !== null) {
      savedFillColorRef.current = args.fillColor;
    }
    handleChange({ ...args, fillColor: fill ? (savedFillColorRef.current ?? '#000000') : null });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const lineWidth = Number(event.target.value);
    handleChange({ ...args, lineWidth });
  };

  const handleAlphaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const alpha = Number(event.target.value);
    handleChange({ ...args, alpha });
  };

  const handleFigureChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const figure = event.target.value as FigureType;
    handleChange({ ...args, figure });
  };

  const handleDashToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const isDashed = event.target.checked;
    if (args.lineDash) {
      savedLineDashRef.current = args.lineDash;
    }
    handleChange({ ...args, lineDash: isDashed ? (savedLineDashRef.current ?? [10, 10]) : null });
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

  const { alpha, lineColor, fillColor, lineWidth, figure, lineDash } = args;

  const scaledLineWidth = lineWidth * brushScale;
  const dash = lineDash ? lineDash[0] * brushScale : 0;
  const gap = lineDash ? lineDash[1] * brushScale : 0;

  let borderStyle: React.CSSProperties = {};
  let fillStyle: React.CSSProperties = {};

  if (lineDash) {
    if (figure === 'circle' || figure === 'oval') {
      borderStyle = {
        border: `${scaledLineWidth}px solid transparent`,
        backgroundImage: `repeating-conic-gradient(from 0deg, ${lineColor} 0deg, ${
          (dash / (Math.PI * 100)) * 360
        }deg, transparent ${(dash / (Math.PI * 100)) * 360}deg, transparent ${
          ((dash + gap) / (Math.PI * 100)) * 360
        }deg)`,
        backgroundSize: '100% 100%',
        backgroundPosition: '0 0',
        backgroundRepeat: 'repeat',
        backgroundOrigin: 'border-box',
        backgroundClip: 'border-box',
      };
    } else {
      borderStyle = {
        border: `${scaledLineWidth}px solid transparent`,
        backgroundImage: `repeating-linear-gradient(to right, ${lineColor}, ${lineColor} ${dash}px, transparent ${dash}px, transparent ${
          dash + gap
        }px), repeating-linear-gradient(to bottom, ${lineColor}, ${lineColor} ${dash}px, transparent ${dash}px, transparent ${
          dash + gap
        }px), repeating-linear-gradient(to left, ${lineColor}, ${lineColor} ${dash}px, transparent ${dash}px, transparent ${
          dash + gap
        }px), repeating-linear-gradient(to top, ${lineColor}, ${lineColor} ${dash}px, transparent ${dash}px, transparent ${
          dash + gap
        }px)`,
        backgroundSize: `100% ${scaledLineWidth}px, ${scaledLineWidth}px 100%, 100% ${scaledLineWidth}px, ${scaledLineWidth}px 100%`,
        backgroundPosition: `0 0, 100% 0, 100% 100%, 0 100%`,
        backgroundRepeat: 'repeat-x, repeat-y, repeat-x, repeat-y',
        backgroundOrigin: 'border-box, border-box, border-box, border-box',
        backgroundClip: 'border-box, border-box, border-box, border-box',
      };
    }
  } else {
    borderStyle = {
      border: `${scaledLineWidth}px solid ${lineColor}`,
    };
  }

  fillStyle = {
    backgroundImage: `repeating-linear-gradient(45deg, ${fillColor ?? 'transparent'} 0px, ${
      fillColor ?? 'transparent'
    } 10px, transparent 10px, transparent 20px)`,
    backgroundSize: '100% 100%',
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="figure-type" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          <b>Figure Type</b>
        </label>
        <select
          id="figure-type"
          value={figure}
          onChange={handleFigureChange}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="line">Line</option>
          <option value="rectangle">Rectangle</option>
          <option value="square">Square</option>
          <option value="circle">Circle</option>
          <option value="oval">Oval</option>
        </select>
      </div>

      <hr className="border-gray-300 dark:border-gray-700" />

      <div className="flex flex-col gap-2">
        <label htmlFor="color-picker" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Line Color
        </label>
        <input
          id="color-picker"
          type="color"
          value={lineColor}
          onChange={handleColorChange}
          className="h-10 w-full cursor-pointer rounded border border-gray-300 p-1 dark:border-gray-600 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="size-slider"
          className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Line Thickness
          <span className="font-bold text-gray-900 dark:text-gray-200">{lineWidth}px</span>
        </label>
        <input
          id="size-slider"
          type="range"
          min="0.5"
          max="500"
          step="0.5"
          value={lineWidth}
          onChange={handleSizeChange}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <hr className="border-gray-300 dark:border-gray-700" />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <input
            id="dash-toggle"
            type="checkbox"
            checked={!!lineDash}
            onChange={handleDashToggle}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="dash-toggle" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Dashed Line
          </label>
        </div>
        {lineDash && (
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
      </div>

      <hr className="my-1 border-gray-300 dark:border-gray-700" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            id="fill"
            type="checkbox"
            checked={fillColor !== null}
            onChange={handleFillToggle}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="fill" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Fill
          </label>
        </div>
        {fillColor && (
          <div className="flex gap-4">
            <input
              id="fill-color-picker"
              type="color"
              value={fillColor}
              onChange={handleFillColorChange}
              className="h-10 w-full cursor-pointer rounded border border-gray-300 p-1 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700"
            />
          </div>
        )}
      </div>

      <hr className="my-1 border-gray-300 dark:border-gray-700" />

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
          isLightColor(lineColor) ? 'checkerboard-dark' : 'checkerboard-light'
        }`}
        style={{ height: '224px', overflow: 'auto' }}
      >
        <div
          style={{
            boxSizing: 'border-box',
            flexShrink: 0,
            width: `${figure === 'line' ? '80%' : '40%'}`,
            height: `${figure === 'line' ? `${Math.round(scaledLineWidth)}px` : '40%'}`,
            opacity: alpha,
            borderRadius: figure === 'circle' || figure === 'oval' ? '50%' : '0',
            ...borderStyle,
          }}
        >
          {figure !== 'line' && (
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: figure === 'circle' || figure === 'oval' ? '50%' : '0',
                ...fillStyle,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Shapes;
