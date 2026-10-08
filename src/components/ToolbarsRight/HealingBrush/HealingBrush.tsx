import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../../util/brush-engine.ts';
import type { ToolPatch } from '../../../contexts/tool-types.ts';
import type { HealingBrushToolArgs } from '../../../tools/healingBrush.ts';

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const CAPTION_CLASS = 'flex items-baseline justify-between gap-1';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

const HealingBrush: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const args = getToolArgs('healing-brush') as HealingBrushToolArgs | null;
  const pendingPatchRef = useRef<ToolPatch<'healing-brush'> | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    },
    []
  );

  if (!args) return null;
  const publishSlider = (patch: ToolPatch<'healing-brush'>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      if (pendingPatchRef.current) patchToolArgs('healing-brush', pendingPatchRef.current);
      pendingPatchRef.current = null;
      rafIdRef.current = null;
    });
  };

  const size = (event: ChangeEvent<HTMLInputElement>) => publishSlider({ size: Number(event.target.value) });
  const hardness = (event: ChangeEvent<HTMLInputElement>) => publishSlider({ hardness: Number(event.target.value) });
  const opacity = (event: ChangeEvent<HTMLInputElement>) =>
    publishSlider({ opacity: Number(event.target.value) / 100 });

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="healing-brush-size">Size</label>
          <span className={VALUE_CLASS}>{Math.round(args.size)}px</span>
        </div>
        <input
          id="healing-brush-size"
          className={SLIDER_CLASS}
          max={BRUSH_SIZE_MAX}
          min={BRUSH_SIZE_MIN}
          type="range"
          value={args.size}
          onChange={size}
        />
      </div>
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="healing-brush-hardness">Hardness</label>
          <span className={VALUE_CLASS}>{Math.round(args.hardness)}%</span>
        </div>
        <input
          id="healing-brush-hardness"
          className={SLIDER_CLASS}
          max={BRUSH_HARDNESS_MAX}
          min={BRUSH_HARDNESS_MIN}
          type="range"
          value={args.hardness}
          onChange={hardness}
        />
      </div>
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="healing-brush-opacity">Opacity</label>
          <span className={VALUE_CLASS}>{Math.round(args.opacity * 100)}%</span>
        </div>
        <input
          id="healing-brush-opacity"
          className={SLIDER_CLASS}
          max="100"
          min="0"
          type="range"
          value={Math.round(args.opacity * 100)}
          onChange={opacity}
        />
      </div>
      <button type="button" onClick={() => patchToolArgs('healing-brush', { aligned: !args.aligned })}>
        {args.aligned ? 'Aligned' : 'Non-Aligned'}
      </button>
    </div>
  );
};

export default HealingBrush;
