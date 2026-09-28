import React, { type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import type { EraserMode, EraserToolArgs } from '../../../tools/eraser.ts';

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const DISABLED_SLIDER_CLASS =
  'h-1.5 w-28 cursor-not-allowed appearance-none rounded-lg bg-gray-200 opacity-50 dark:bg-gray-700';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';

/**
 * The Size cap is 500 and not Photoshop's 1000 because the stroke canvas is padded by the full
 * `lineWidth` on every side and committed as its own layer, so a 1000px tip would allocate a
 * 2000x2000 canvas for a dot.
 */
export const ERASER_SIZE_MAX = 500;
export const ERASER_SIZE_MIN = 1;

/** Photoshop's 1-100, shown because the control exists in Photoshop's bar, not because it works. */
const FLOW_MAX = 100;
const FLOW_DEFAULT = 100;

const Eraser: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();

  const args = getToolArgs('eraser');
  if (!args) return null;

  const { alpha, lineWidth, mode } = args as EraserToolArgs;

  const handleModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    patchToolArgs('eraser', { mode: event.target.value as EraserMode });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('eraser', { lineWidth: Number(event.target.value) });
  };

  // The slider is 0-100 because that is what the label reads, and `alpha` is 0-1, so the write
  // divides. (The legacy `draw` bar uses a 0-1 slider for the same field; both are correct, and
  // neither is right for the other.)
  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('eraser', { alpha: Number(event.target.value) / 100 });
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label htmlFor="eraser-mode" className={`${FIELD_CLASS} min-w-24`}>
        Mode
        <select className={SELECT_CLASS} id="eraser-mode" value={mode} onChange={handleModeChange}>
          {/* Photoshop's Brush eraser is a soft tip, which needs a stamped-dab engine: the painter
              issues one `stroke()` per stroke (`src/util/draw.ts`) and `stroke()` has no falloff.
              Rendered with Photoshop's real label, `disabled` on the option, so the bar is
              Photoshop-shaped without offering a mode that would silently render as Pencil. */}
          <option disabled value="brush">
            Brush
          </option>
          <option value="pencil">Pencil</option>
          <option value="block">Block</option>
        </select>
      </label>

      <label htmlFor="eraser-size" className={FIELD_CLASS}>
        Size <span className={VALUE_CLASS}>{lineWidth}px</span>
        <input
          className={SLIDER_CLASS}
          id="eraser-size"
          max={ERASER_SIZE_MAX}
          min={ERASER_SIZE_MIN}
          step="1"
          type="range"
          value={lineWidth}
          onChange={handleSizeChange}
        />
      </label>

      {/* Adobe removes Opacity from Block mode entirely, so the control is not rendered rather
          than rendered inert: a control that does nothing is worse than an absent one. */}
      {mode !== 'block' && (
        <label htmlFor="eraser-opacity" className={FIELD_CLASS}>
          Opacity <span className={VALUE_CLASS}>{Math.round(alpha * 100)}%</span>
          <input
            className={SLIDER_CLASS}
            id="eraser-opacity"
            max="100"
            min="0"
            step="1"
            type="range"
            value={Math.round(alpha * 100)}
            onChange={handleOpacityChange}
          />
        </label>
      )}

      <label className={`${FIELD_CLASS} min-w-24 opacity-60`} htmlFor="eraser-flow">
        Flow <span className={VALUE_CLASS}>{FLOW_DEFAULT}%</span>
        {/* Flow is a per-dab alpha ramp, and one `stroke()` cannot honour it. Rendered with
            Photoshop's real label and 1-100 range, `disabled` on the DOM node. */}
        <input
          className={DISABLED_SLIDER_CLASS}
          defaultValue={FLOW_DEFAULT}
          disabled
          id="eraser-flow"
          max={FLOW_MAX}
          min="1"
          step="1"
          type="range"
        />
      </label>
    </div>
  );
};

export default Eraser;
