import React, { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { draw, type DrawToolArgs, type DrawToolSettings, type PenType } from '../../../tools/draw.ts';
import { savedDrawPerPen } from '../../../tools/settings.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import type { Point } from '../../../contexts/general-types.ts';

const PREVIEW_SIZE = 46;

const Draw: React.FC<{}> = () => {
  const [{ color, containerRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const [brushScale, setBrushScale] = useState<number>(0);
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const args = toolArgs as DrawToolSettings;

  usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
    onResize: ({ scale }) => {
      setBrushScale(scale);
    },
  });

  useEffect(() => {
    setToolArgs({ ...args, color });
  }, [color]);

  const handleChange = (newArgs: DrawToolSettings) => {
    savedDrawPerPen[newArgs.penType] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
    };
    setToolArgs(newArgs as DrawToolArgs);
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

  const { alpha, lineWidth: brushSize, penType, lineDash } = args;

  useEffect(() => {
    if (previewRef.current && brushScale) {
      const canvas = previewRef.current;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low'; // For better performance and sharpness
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const size = { width: PREVIEW_SIZE / brushScale, height: PREVIEW_SIZE / brushScale };

      const arcPoints: Point[] = [];
      const radius = size.width / 3;
      const centerX = size.width / 2.3;
      const centerY = size.height / 2.3;

      // Generate points for a quarter-circle arc from 0 to 90 degrees
      for (let angle = -1 / 2; angle <= Math.PI / 2 + 1; angle += Math.PI / 24) {
        const x = centerX + Math.cos(angle) * radius + 1;
        const y = centerY + Math.sin(angle) * radius;
        arcPoints.push({ x, y });
      }

      const previewArgs = { ...args, color, points: arcPoints };

      // Draw the toolCanvas into previewCanvas with scaling and centering
      const [toolCanvas] = draw({ size })(previewArgs);

      const scaledWidth = toolCanvas.width * brushScale;
      const scaledHeight = toolCanvas.height * brushScale;

      const offsetX = (canvas.width - scaledWidth) / 2;
      const offsetY = (canvas.height - scaledHeight) / 2;

      ctx.drawImage(toolCanvas, 0, 0, toolCanvas.width, toolCanvas.height, offsetX, offsetY, scaledWidth, scaledHeight);
    }
  }, [args, brushScale]);

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex items-center gap-2">
        <label htmlFor="pen-type" className="whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300">
          Pen Type
        </label>
        <select
          id="pen-type"
          value={penType}
          onChange={handlePenTypeChange}
          className="rounded border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="pen">Pen</option>
          <option value="pen-dashed">Dashed Pen</option>
          <option value="spray">Spray</option>
        </select>
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="size-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Size
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
          className="h-1.5 w-40 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      {penType === 'pen-dashed' && lineDash && (
        <div className="flex gap-4 items-center">
          <div className="flex flex-col">
            <label
              htmlFor="dash-size"
              className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
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
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>

          <div className="flex flex-col">
            <label
              htmlFor="gap-size"
              className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
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
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>
        </div>
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
        className={`flex h-12 w-12 items-center justify-center rounded border border-gray-300 dark:border-gray-600 flex-shrink-0 ${
          isLightColor(color) ? 'chessboard-dark' : 'chessboard-light'
        }`}
      >
        <canvas ref={previewRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
      </div>
    </div>
  );
};

export default Draw;
