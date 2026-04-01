import React, { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { savedArgsPerFigure } from '../../../tools/settings.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { type FigureType, shape, type ShapeToolArgs } from '../../../tools/shape.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

const Shape: React.FC<{}> = () => {
  const [{ containerRef, color, backgroundColor, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const previewRef = useRef<HTMLCanvasElement | null>(null);

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

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const lineWidth = Number(event.target.value);
    handleChange({ ...args, lineWidth });
  };

  const handleFillToggle = () => {
    const hasFill = !args.hasFill;
    handleChange({ ...args, hasFill });
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

  const handleAlphaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const alpha = Number(event.target.value);
    handleChange({ ...args, alpha });
  };

  const { alpha, hasFill, lineWidth, figure, lineDash } = args;

  useEffect(() => {
    if (!previewRef.current || !brushScale) return;

    const canvas = previewRef.current;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low'; // For better performance and sharpness
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaledWidth = PREVIEW_WIDTH / brushScale;
    const scaledHeight = PREVIEW_HEIGHT / brushScale;

    const margin = ((figure === 'circle' ? 24 : 2.5) + Math.sqrt(lineWidth)) / brushScale;

    let start, end;
    if (figure === 'square') {
      start = { x: scaledWidth / 4 + margin, y: margin };
      end = { x: (scaledWidth * 3) / 4 - margin, y: scaledHeight - margin };
    } else {
      start = { x: margin, y: margin };
      end = { x: scaledWidth - margin, y: scaledHeight - margin };
    }
    const previewArgs = { ...args, color, start, end };

    const [toolCanvas] = shape({ size: { width: scaledWidth, height: scaledHeight } })(previewArgs);

    // Draw the toolCanvas into previewCanvas with scaling and centering
    ctx.drawImage(toolCanvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  }, [args, brushScale]);

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
