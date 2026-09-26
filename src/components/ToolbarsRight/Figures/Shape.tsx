import React, { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { savedArgsPerFigure } from '../../../tools/settings.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { shape, type ShapeLineCap, type ShapeToolArgs, type ShapeToolMode } from '../../../tools/shape.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

const figureLabel = (figure: ShapeToolArgs['figure']) => {
  if (figure === 'oval') return 'Ellipse Tool';
  if (figure === 'triangle') return 'Triangle Tool';
  if (figure === 'polygon') return 'Polygon Tool';
  if (figure === 'line') return 'Line Tool';
  return 'Rectangle Tool';
};

const Shape: React.FC = () => {
  const [{ containerRef, color, backgroundColor, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const args = toolArgs as ShapeToolArgs;
  const [brushScale, setBrushScale] = useState<number>(0);
  const savedLineDashRef = useRef<ShapeToolArgs['lineDash']>(args.lineDash);

  usePointerPosition({ ref: containerRef, imageSize: totalSize, onResize: ({ scale }) => setBrushScale(scale) });

  useEffect(() => {
    if (args.toolName !== 'shape' || (args.color === color && args.backgroundColor === backgroundColor)) return;
    setToolArgs({ ...args, color, backgroundColor });
  }, [args, backgroundColor, color, setToolArgs]);

  const handleChange = (newArgs: ShapeToolArgs) => {
    savedArgsPerFigure[newArgs.figure] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
      lineCap: newArgs.lineCap,
      cornerRadius: newArgs.cornerRadius,
      toolMode: newArgs.toolMode,
    };
    setToolArgs(newArgs);
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const lineWidth = Number(event.target.value);
    handleChange({ ...args, lineWidth });
  };

  const handleFillToggle = () => {
    const hasFill = !args.hasFill;
    handleChange({ ...args, hasFill });
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

  const handleAlphaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const alpha = Number(event.target.value);
    handleChange({ ...args, alpha });
  };

  const handleModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    handleChange({ ...args, toolMode: event.target.value as ShapeToolMode });
  };

  const handleRadiusChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleChange({ ...args, cornerRadius: Number(event.target.value) });
  };

  const handleCapChange = (event: ChangeEvent<HTMLSelectElement>) => {
    handleChange({ ...args, lineCap: event.target.value as ShapeLineCap });
  };

  const { alpha, hasFill, lineWidth, figure, lineDash, cornerRadius = 0, lineCap = 'butt', toolMode = 'shape' } = args;

  useEffect(() => {
    if (!previewRef.current || !brushScale) return;

    const canvas = previewRef.current;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low'; // For better performance and sharpness
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaledWidth = PREVIEW_WIDTH / brushScale;
    const scaledHeight = PREVIEW_HEIGHT / brushScale;

    // Always the unconstrained base shape: Circle and Square are Shift-drag
    // outcomes, not separate tools, so the preview must not imply otherwise.
    const margin = (2.5 + Math.sqrt(lineWidth)) / brushScale;
    const start = { x: margin, y: margin };
    const end = { x: scaledWidth - margin, y: scaledHeight - margin };
    const previewArgs = { ...args, color, start, end };

    const [toolCanvas] = shape({ size: { width: scaledWidth, height: scaledHeight } })(previewArgs);

    // Draw the toolCanvas into previewCanvas with scaling and centering
    ctx.drawImage(toolCanvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  }, [args, brushScale, color, figure, lineWidth]);

  return (
    <div className="flex flex-row flex-wrap items-center gap-4 h-full">
      <label className="flex flex-col gap-1 text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Tool mode
        <select
          aria-label="Tool mode"
          value={toolMode}
          onChange={handleModeChange}
          className="h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800"
        >
          <option value="shape">Shape</option>
          <option value="path">Path</option>
          <option value="pixels">Pixels</option>
        </select>
      </label>
      <div className="flex items-center gap-2" aria-label="Current shape">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{figureLabel(figure)}</span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Choose a shape from the left toolbar</span>
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="thickness-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Thickness
          <span className="font-bold text-gray-900 dark:text-gray-200">{lineWidth}px</span>
        </label>
        <input
          id="thickness-slider"
          type="range"
          min="0.5"
          max="500"
          step="0.5"
          value={lineWidth}
          onChange={handleSizeChange}
          className="h-1.5 w-38 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      {figure === 'rectangle' && (
        <div className="flex flex-col">
          <label
            htmlFor="corner-radius-slider"
            className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
          >
            Radius <span className="font-bold text-gray-900 dark:text-gray-200">{cornerRadius}px</span>
          </label>
          <input
            id="corner-radius-slider"
            aria-label="Radius"
            type="range"
            min="0"
            max="250"
            value={cornerRadius}
            onChange={handleRadiusChange}
            className="h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
        </div>
      )}

      {figure === 'line' && (
        <label className="flex flex-col gap-1 text-[10px] font-medium text-gray-700 dark:text-gray-300">
          Cap
          <select
            aria-label="Line cap"
            value={lineCap}
            onChange={handleCapChange}
            className="h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="butt">Butt</option>
            <option value="round">Round</option>
            <option value="square">Square</option>
          </select>
        </label>
      )}

      <div className="flex flex-col">
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

      <div className="flex flex-col">
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
      </div>

      {lineDash && (
        <>
          <div className="flex flex-col ml-[-13px]">
            <label
              htmlFor="dash-slider"
              className="flex justify-between mb-2 text-[10px] font-medium text-gray-700 dark:text-gray-300"
            >
              Dash
              <span className="font-bold text-gray-900 dark:text-gray-200">{lineDash[0]}px</span>
            </label>
            <input
              id="dash-slider"
              type="range"
              min="1"
              max="100"
              value={lineDash[0]}
              onChange={handleDashChange}
              title={`Dash: ${lineDash[0]}px`}
              className="h-1 w-17 mb-1 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>

          <div className="flex flex-col ml-[-15px]">
            <label
              htmlFor="gap-slider"
              className="flex justify-between mb-2 text-[10px] font-medium text-gray-700 dark:text-gray-300"
            >
              Gap
              <span className="font-bold text-gray-900 dark:text-gray-200">{lineDash[1]}px</span>
            </label>
            <input
              id="gap-slider"
              type="range"
              min="1"
              max="100"
              value={lineDash[1]}
              onChange={handleGapChange}
              title={`Gap: ${lineDash[1]}px`}
              className="h-1 w-17 mb-1 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>
        </>
      )}

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
          className="h-1.5 w-30 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div
        className={`flex h-12 w-24 items-center justify-center flex-shrink-0 ${
          isLightColor(color) ? 'chessboard-dark' : 'chessboard-light'
        }`}
      >
        <canvas ref={previewRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
      </div>
    </div>
  );
};

export default Shape;
