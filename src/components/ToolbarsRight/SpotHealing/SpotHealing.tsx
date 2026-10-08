import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../../util/brush-engine.ts';
import type { ToolPatch } from '../../../contexts/tool-types.ts';
import type { SpotHealingToolArgs } from '../../../tools/spotHealing.ts';

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const CAPTION_CLASS = 'flex items-baseline justify-between gap-1';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

const SpotHealing: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const args = getToolArgs('spot-healing') as SpotHealingToolArgs | null;
  const pendingPatchRef = useRef<ToolPatch<'spot-healing'> | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    },
    []
  );

  if (!args) return null;

  const publishSlider = (patch: ToolPatch<'spot-healing'>) => {
    pendingPatchRef.current = patch;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      if (pendingPatchRef.current) patchToolArgs('spot-healing', pendingPatchRef.current);
      pendingPatchRef.current = null;
      rafIdRef.current = null;
    });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) =>
    publishSlider({ size: Number(event.target.value) });
  const handleHardnessChange = (event: ChangeEvent<HTMLInputElement>) =>
    publishSlider({ hardness: Number(event.target.value) });
  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) =>
    publishSlider({ opacity: Number(event.target.value) / 100 });

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="spot-healing-size">Size</label>
          <span className={VALUE_CLASS}>{Math.round(args.size)}px</span>
        </div>
        <input
          id="spot-healing-size"
          className={SLIDER_CLASS}
          max={BRUSH_SIZE_MAX}
          min={BRUSH_SIZE_MIN}
          step="1"
          type="range"
          value={args.size}
          onChange={handleSizeChange}
        />
      </div>
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="spot-healing-hardness">Hardness</label>
          <span className={VALUE_CLASS}>{Math.round(args.hardness)}%</span>
        </div>
        <input
          id="spot-healing-hardness"
          className={SLIDER_CLASS}
          max={BRUSH_HARDNESS_MAX}
          min={BRUSH_HARDNESS_MIN}
          step="1"
          type="range"
          value={args.hardness}
          onChange={handleHardnessChange}
        />
      </div>
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="spot-healing-opacity">Opacity</label>
          <span className={VALUE_CLASS}>{Math.round(args.opacity * 100)}%</span>
        </div>
        <input
          id="spot-healing-opacity"
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={Math.round(args.opacity * 100)}
          onChange={handleOpacityChange}
        />
      </div>
    </div>
  );
};

export default SpotHealing;
