import { type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { FILL_TOLERANCE_MAX, type FillToolArgs, type FillToolName } from '../../../tools/fill.ts';
import type { ToolbarRightComponent } from '../types.ts';

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const CHECKBOX_CLASS = 'h-3.5 w-3.5 cursor-pointer accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Builds the Photoshop fill options bar for one tool.
 *
 * A factory, not one component reading `toolArgs.toolName`, for the reason
 * `toolsMap` gives every placeholder a fresh closure: the identity is what
 * `ToolbarHorizontal`'s `key={toolName}` remount and the per-tool `toolboxComponent` contracts are
 * written against, and it keeps each tool's bar explicit at the call site.
 *
 * `Anti-aliased` ships disabled on purpose. The flood fill's test is a hard threshold
 * (`createFloodFillMask`), so an anti-aliased edge needs coverage, not a boolean mask. It renders
 * with Photoshop's real label and its real checked state, `disabled` on the DOM node, so an e2e
 * assertion can prove it is not offered as though it worked.
 */
export const createFillToolbar =
  (toolName: FillToolName): ToolbarRightComponent =>
  () => {
    const { getToolArgs, patchToolArgs } = useCurrentTool();

    const args = getToolArgs(toolName);
    if (!args) return null;

    const { alpha, contiguous, tolerance } = args as FillToolArgs;

    const handleToleranceChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { tolerance: Number(event.target.value) });
    };

    const handleContiguousChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { contiguous: event.target.checked });
    };

    // The slider is 0-100 because that is what the label reads, and `alpha` is 0-1, so the write
    // divides. (The legacy `draw` bar uses a 0-1 slider for the same field.)
    const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
      patchToolArgs(toolName, { alpha: Number(event.target.value) / 100 });
    };

    return (
      <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
        <label htmlFor={`${toolName}-tolerance`} className={FIELD_CLASS}>
          Tolerance <span className={VALUE_CLASS}>{tolerance}</span>
          {/* `max` is FILL_TOLERANCE_MAX (255), Adobe's scale for both of these tools, and NOT the
              Magic Wand's 100. The value is unitless, so the max is the only thing that states the
              scale, which is why it is the shared constant rather than a literal here. */}
          <input
            id={`${toolName}-tolerance`}
            className={SLIDER_CLASS}
            max={FILL_TOLERANCE_MAX}
            min="0"
            step="1"
            type="range"
            value={tolerance}
            onChange={handleToleranceChange}
          />
        </label>

        <label htmlFor={`${toolName}-contiguous`} className={`${FIELD_CLASS} min-w-24`}>
          Contiguous
          <input
            checked={contiguous}
            className={CHECKBOX_CLASS}
            id={`${toolName}-contiguous`}
            type="checkbox"
            onChange={handleContiguousChange}
          />
        </label>

        <label htmlFor={`${toolName}-anti-aliased`} className={`${FIELD_CLASS} min-w-24 opacity-60`}>
          Anti-aliased
          <input checked className={CHECKBOX_CLASS} disabled id={`${toolName}-anti-aliased`} type="checkbox" />
        </label>

        <label htmlFor={`${toolName}-opacity`} className={FIELD_CLASS}>
          Opacity <span className={VALUE_CLASS}>{Math.round(alpha * 100)}%</span>
          <input
            id={`${toolName}-opacity`}
            className={SLIDER_CLASS}
            max="100"
            min="0"
            step="1"
            type="range"
            value={Math.round(alpha * 100)}
            onChange={handleOpacityChange}
          />
        </label>
      </div>
    );
  };

export default createFillToolbar('magic-eraser');
