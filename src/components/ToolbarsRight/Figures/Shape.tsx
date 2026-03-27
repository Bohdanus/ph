import React, { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { savedArgsPerFigure } from '../../../tools/settings.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import type { FigureType, ShapeToolArgs } from '../../../tools/shape.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';

const Shape: React.FC<{}> = () => {
  const [{ containerRef, color, backgroundColor, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as ShapeToolArgs;
  const [brushScale, setBrushScale] = useState<number>(0);
  const savedLineDashRef = useRef(args.lineDash);

  usePointerPosition({ ref: containerRef, imageSize: totalSize, onResize: ({ scale }) => setBrushScale(scale) });

  useEffect(() => {
    setToolArgs({ ...args, color, backgroundColor });
  }, [color, backgroundColor]);

  const handleChange = (newArgs: ShapeToolArgs) => {
    savedArgsPerFigure[newArgs.figure] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
    };
    setToolArgs(newArgs);
  };

  const handleFillToggle = () => {
    const hasFill = !!args.hasFill;
    handleChange({ ...args, hasFill });
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
    const lineDash = isDashed ? (savedLineDashRef.current ?? [10, 10]) : null;
    handleChange({ ...args, lineDash });
  };

  const handleDashChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    const gap = args.lineDash?.[1] ?? 10;
    const newArgs = { ...args, lineDash: [value, gap] };
    handleChange(newArgs);
  };

  const handleGapChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    const dash = args.lineDash?.[0] ?? 10;
    const newArgs = { ...args, lineDash: [dash, value] };
    handleChange(newArgs);
  };

  const { alpha, hasFill, lineWidth, figure, lineDash } = args;
  const lineColor = color;

  const scaledLineWidth = lineWidth * brushScale;
  const dash = lineDash ? lineDash[0] * brushScale : 0;
  const gap = lineDash ? lineDash[1] * brushScale : 0;

  const chessClass = isLightColor(lineColor) ? 'chessboard-dark' : 'chessboard-light';
  let borderStyle: React.CSSProperties = {};

  if (figure === 'line') {
    if (lineDash) {
      borderStyle = {
        backgroundColor: lineColor,
      };
    } else {
      borderStyle = {
        background: lineColor,
      };
    }
  } else if (lineDash) {
    if (figure === 'circle' || figure === 'oval') {
      borderStyle = {
        border: `${scaledLineWidth}px solid transparent`,
        backgroundImage: `repeating-conic-gradient(from 0deg, ${lineColor} 0deg, ${
          (dash / (Math.PI * 66)) * 360
        }deg, transparent ${(dash / (Math.PI * 100)) * 360}deg, transparent ${
          ((dash + gap) / (Math.PI * 66)) * 360
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

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex items-center gap-2">
        <label htmlFor="figure-type" className="whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300">
          Figure
        </label>
        <select
          id="figure-type"
          value={figure}
          onChange={handleFigureChange}
          className="rounded border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="line">Line</option>
          <option value="rectangle">Rectangle</option>
          <option value="square">Square</option>
          <option value="circle">Circle</option>
          <option value="oval">Oval</option>
        </select>
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="size-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Thickness
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
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            id="filled-toggle"
            type="checkbox"
            checked={hasFill}
            onChange={handleFillToggle}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="filled-toggle" className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
            Filled
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            id="dash-toggle"
            type="checkbox"
            checked={!!lineDash}
            onChange={handleDashToggle}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="dash-toggle" className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
            Dashed
          </label>
        </div>
        {lineDash && (
          <div className="flex gap-2">
            <input
              type="range"
              min="1"
              max="100"
              value={lineDash[0]}
              onChange={handleDashChange}
              title={`Dash: ${lineDash[0]}px`}
              className="h-1 w-12 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
            <input
              type="range"
              min="1"
              max="100"
              value={lineDash[1]}
              onChange={handleGapChange}
              title={`Gap: ${lineDash[1]}px`}
              className="h-1 w-12 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="alpha-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
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
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div
        className={`flex h-8 w-8 items-center justify-center rounded border border-gray-300 dark:border-gray-600 flex-shrink-0 ${chessClass}`}
      >
        <div
          style={{
            position: 'relative',
            width: '24px',
            height: '24px',
          }}
        >
          <div
            style={{
              boxSizing: 'border-box',
              position: 'absolute',
              inset: 0,
              opacity: alpha,
              borderRadius: figure === 'circle' || figure === 'oval' ? '50%' : '0',
              ...borderStyle,
              borderWidth: `${Math.min(8, Math.max(1, scaledLineWidth / 5))}px`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default Shape;
