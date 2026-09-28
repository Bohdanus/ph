import React, { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { draw, type DrawToolArgs } from '../../../tools/draw.ts';
import {
  CUSTOM_PRESET_LABEL,
  PAINT_BLEND_MODES,
  PAINT_PRESETS,
  PAINT_SIZE_MAX,
  PAINT_SIZE_MIN,
  clampPaintSize,
  isPaintBlendMode,
  matchPaintPreset,
} from '../../../tools/brush.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import type { Point } from '../../../contexts/general-types.ts';
import type { ToolbarRightComponent } from '../types.ts';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';

/** The two paint tools the Photoshop options bar is built for. */
export type PaintBarToolName = 'brush' | 'pencil';

const toPercent = (alpha: number): number => Math.round(alpha * 100);

/**
 * Builds the Photoshop paint options bar for one tool.
 *
 * Each tool gets its own component identity rather than a shared one reading
 * `toolArgs.toolName`, for the same reason `toolsMap` gives every placeholder a
 * fresh closure: the identity is what `ToolbarHorizontal`'s `key={toolName}` remount
 * and the `toolboxComponent` contracts are written against, and it keeps the tool a
 * bar belongs to explicit at the call site instead of inferred at render time.
 */
export const createPaintToolbar = (toolName: PaintBarToolName): ToolbarRightComponent => {
  const PaintToolbar: React.FC<{}> = () => {
    const [{ color, containerRef, totalSize }] = useStore();
    const { getToolArgs, patchToolArgs, setToolArgs } = useCurrentTool();
    const [brushScale, setBrushScale] = useState<number>(0);
    const previewRef = useRef<HTMLCanvasElement | null>(null);

    const args = getToolArgs(toolName);

    usePointerPosition({
      ref: containerRef,
      imageSize: totalSize,
      onResize: ({ scale }) => {
        setBrushScale(scale);
      },
    });

    // The store's foreground colour is what a paint stroke should use. Without this
    // the brush and pencil are frozen on their `#000000` default, because
    // `src/util/settings.ts` persists their args verbatim and nothing else carries
    // the colour across. `Draw/Draw.tsx:29-33` does the same for the legacy pen.
    useEffect(() => {
      if (!args || args.color === color) return;
      setToolArgs({ ...args, color });
    }, [args, color, setToolArgs]);

    useEffect(() => {
      if (!args || !previewRef.current || !brushScale) return;

      const canvas = previewRef.current;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const radius = PREVIEW_HEIGHT / 2.2 / brushScale;
      const centerX = PREVIEW_WIDTH / 2.1 / brushScale;
      const centerY = PREVIEW_HEIGHT / 2.4 / brushScale;

      // A three-point arc, so the Smoothing control has an interior sample to act
      // on: a straight two-point stroke is already its own smoothing.
      const arcPoints: Point[] = [];
      for (let angle = -1 / 2; angle <= Math.PI / 2 + 1.2; angle += Math.PI / 2) {
        arcPoints.push({
          x: centerX + 2 * Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }

      // The preview goes through the same `draw` the stroke is committed with, so
      // what the bar shows is what the canvas gets. `toolName` is `'draw'` because
      // that is the only renderer; brush and pencil both force `penType` at
      // `src/tools/toolProcessors.ts:169,182`.
      const previewArgs: DrawToolArgs = { ...args, penType: 'pen', toolName: 'draw', color, points: arcPoints };
      const [toolCanvas] = draw({
        size: { width: PREVIEW_WIDTH / brushScale, height: PREVIEW_HEIGHT / brushScale },
      })(previewArgs);

      ctx.drawImage(toolCanvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    }, [args, brushScale, color]);

    if (!args) return null;

    const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { lineWidth: clampPaintSize(Number(event.target.value)) });
    };

    const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { alpha: Number(event.target.value) / 100 });
    };

    const handleSmoothingChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { smoothing: Number(event.target.value) });
    };

    const handleBlendModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
      const blendMode = event.target.value;
      if (!isPaintBlendMode(blendMode)) return;
      patchToolArgs(toolName, { blendMode });
    };

    const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
      const preset = PAINT_PRESETS[toolName].find((entry) => entry.label === event.target.value);
      if (!preset) return;

      patchToolArgs(toolName, {
        lineWidth: preset.lineWidth,
        alpha: preset.alpha,
        smoothing: preset.smoothing,
        blendMode: preset.blendMode,
      });
    };

    return (
      <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
        <label htmlFor={`${toolName}-preset`} className={FIELD_CLASS}>
          Brush Preset
          <select
            id={`${toolName}-preset`}
            className={SELECT_CLASS}
            value={matchPaintPreset(PAINT_PRESETS[toolName], args)}
            onChange={handlePresetChange}
          >
            <option value="">{CUSTOM_PRESET_LABEL}</option>
            {PAINT_PRESETS[toolName].map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor={`${toolName}-size`} className={FIELD_CLASS}>
          Size <span className={VALUE_CLASS}>{Math.round(args.lineWidth)}px</span>
          <input
            id={`${toolName}-size`}
            className={SLIDER_CLASS}
            max={PAINT_SIZE_MAX}
            min={PAINT_SIZE_MIN}
            step="1"
            type="range"
            value={args.lineWidth}
            onChange={handleSizeChange}
          />
        </label>

        <label htmlFor={`${toolName}-mode`} className={FIELD_CLASS}>
          Mode
          <select
            id={`${toolName}-mode`}
            className={SELECT_CLASS}
            value={args.blendMode}
            onChange={handleBlendModeChange}
          >
            {PAINT_BLEND_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor={`${toolName}-opacity`} className={FIELD_CLASS}>
          Opacity <span className={VALUE_CLASS}>{toPercent(args.alpha)}%</span>
          <input
            id={`${toolName}-opacity`}
            className={SLIDER_CLASS}
            max="100"
            min="0"
            step="1"
            type="range"
            value={toPercent(args.alpha)}
            onChange={handleOpacityChange}
          />
        </label>

        <label htmlFor={`${toolName}-smoothing`} className={FIELD_CLASS}>
          Smoothing <span className={VALUE_CLASS}>{Math.round(args.smoothing)}%</span>
          <input
            id={`${toolName}-smoothing`}
            className={SLIDER_CLASS}
            max="100"
            min="0"
            step="1"
            type="range"
            value={args.smoothing}
            onChange={handleSmoothingChange}
          />
        </label>

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

  PaintToolbar.displayName = `PaintToolbar(${toolName})`;
  return PaintToolbar;
};

export default createPaintToolbar('brush');
