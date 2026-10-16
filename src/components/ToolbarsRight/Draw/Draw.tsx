import React, { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { draw, type DrawToolArgs, type DrawToolSettings, type PenType } from '../../../tools/draw.ts';
import { savedDrawPerPen } from '../../../tools/settings.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { useDevicePixelRatio } from '../../../hooks/useDevicePixelRatio.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import type { Point } from '../../../contexts/general-types.ts';
import {
  AIRBRUSH_INTERVAL_MS,
  PAINT_FLOW_DEFAULT,
  PAINT_FLOW_MAX,
  PAINT_FLOW_MIN,
} from '../../../util/brush-airbrush.ts';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

const Draw: React.FC<{}> = () => {
  const [{ color, containerRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const [brushScale, setBrushScale] = useState<number>(0);
  const dpr = useDevicePixelRatio();
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const args = toolArgs as DrawToolArgs;

  usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
    onResize: ({ scale }) => {
      setBrushScale(scale);
    },
  });

  useEffect(() => {
    if (args.color !== color) {
      setToolArgs({ ...args, color });
    }
  }, [args, color, setToolArgs]);

  const handleChange = (newArgs: DrawToolSettings) => {
    savedDrawPerPen[newArgs.penType] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
      ...(newArgs.penType === 'spray' ? { flow: newArgs.flow ?? PAINT_FLOW_DEFAULT } : {}),
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

  const handleFlowChange = (event: ChangeEvent<HTMLInputElement>) => {
    const flow = Number(event.target.value);
    handleChange({ ...args, flow });
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
    const preset = savedDrawPerPen[penType];
    const nextArgs = { ...args };
    delete nextArgs.flow;
    delete nextArgs.pointTimes;
    // Only the dashed pen carries a dash pattern. Its own preset declares one, but `pen` and
    // `spray` declare none, so the leading `...args` spread would otherwise hand the active
    // pen's dash to the next one — and `handleChange` would then bake that dash into the new
    // pen's own record, so it survives the next tool switch too.
    handleChange({
      ...nextArgs,
      ...preset,
      ...(penType === 'spray' ? { flow: preset.flow ?? PAINT_FLOW_DEFAULT } : {}),
      lineDash: penType === 'pen-dashed' ? (preset.lineDash ?? null) : null,
      penType,
    });
  };

  const { alpha, lineWidth: brushSize, penType, lineDash } = args;

  useEffect(() => {
    if (!previewRef.current || !brushScale) return;

    const canvas = previewRef.current;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low'; // For better performance and sharpness
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // `brushScale` is the workspace contain fit (CSS px per document px), so the thumbnail is a
    // miniature of the stroke at the size it will actually have on the canvas. `dpr` multiplies
    // every length below: the raster is rendered at DEVICE resolution and then drawn 1:1 into a
    // dpr-sized backing store. Drawing it scaled instead would put back exactly the softness this
    // removes, because the source would be a low-resolution bitmap blown up.
    const scaledWidth = (PREVIEW_WIDTH * dpr) / brushScale;
    const scaledHeight = (PREVIEW_HEIGHT * dpr) / brushScale;

    const arcPoints: Point[] = [];
    const radius = (PREVIEW_HEIGHT / 2.2 / brushScale) * dpr; // Adjust radius based on brush scale
    const centerX = (PREVIEW_WIDTH / 2.1 / brushScale) * dpr;
    const centerY = (PREVIEW_HEIGHT / 2.4 / brushScale) * dpr;

    // Generate points for an arc from 0 to 90 degrees
    for (let angle = -1 / 2; angle <= Math.PI / 2 + 1.2; angle += Math.PI / 2) {
      const x = centerX + 2 * Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      arcPoints.push({ x, y });
    }

    const previewArgs = {
      ...args,
      color,
      points: arcPoints,
      lineWidth: args.lineWidth * dpr,
      ...(penType === 'spray' ? { pointTimes: arcPoints.map((_, index) => index * AIRBRUSH_INTERVAL_MS) } : {}),
    };

    // Draw the toolCanvas into previewCanvas with scaling and centering
    const [toolCanvas] = draw({ size: { width: scaledWidth, height: scaledHeight } })(previewArgs);

    // 1:1, because `scaledWidth`/`scaledHeight` were already multiplied by `dpr` above.
    ctx.drawImage(toolCanvas, 0, 0, PREVIEW_WIDTH * dpr, PREVIEW_HEIGHT * dpr);
  }, [args, brushScale, color, dpr, penType]);

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

      {penType === 'spray' && (
        <div className="flex flex-col">
          <label
            htmlFor="flow-slider"
            className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
          >
            Flow
            <span className="font-bold text-gray-900 dark:text-gray-200">
              {Math.round(args.flow ?? PAINT_FLOW_DEFAULT)}%
            </span>
          </label>
          <input
            id="flow-slider"
            type="range"
            min={PAINT_FLOW_MIN}
            max={PAINT_FLOW_MAX}
            step="1"
            value={args.flow ?? PAINT_FLOW_DEFAULT}
            onChange={handleFlowChange}
            className="h-1.5 w-30 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
        </div>
      )}

      <div
        className={`flex h-12 w-24 items-center justify-center flex-shrink-0 ${
          isLightColor(color) ? 'chessboard-dark' : 'chessboard-light'
        }`}
      >
        <canvas ref={previewRef} width={PREVIEW_WIDTH * dpr} height={PREVIEW_HEIGHT * dpr} className="h-12 w-24" />
      </div>
    </div>
  );
};

export default Draw;
