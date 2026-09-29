import { type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import {
  COLOR_REPLACEMENT_SMOOTHNESS_MAX,
  COLOR_REPLACEMENT_TOLERANCE_MAX,
  type ColorReplacementLimits,
  type ColorReplacementSampling,
  type ColorReplacementToolArgs,
} from '../../../tools/colorReplacement.ts';
import type { ToolbarRightComponent } from '../types.ts';

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const SELECT_CLASS =
  'rounded border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const DISABLED_CLASS = 'opacity-50';

const LIMITS_OPTIONS: readonly { value: ColorReplacementLimits; label: string }[] = [
  { value: 'contiguous', label: 'Contiguous' },
  { value: 'discontinuous', label: 'Discontinuous' },
];

const SAMPLING_OPTIONS: readonly { value: ColorReplacementSampling; label: string }[] = [
  { value: 'current-layer', label: 'Current Layer' },
  { value: 'all-layers', label: 'All Layers' },
];

/**
 * The Color Replacement Tool's options bar, and the first one in this tree that replaces a
 * `PlaceholderTool` card for a tool whose processor reads pixels.
 *
 * The four controls Photoshop names for this tool and the placeholder card used to name in prose
 * (`toolbarPlaceholderConfig.ts:4`) are all here and all live: `Tolerance`, `Limits`, `Sampling`
 * and `Smoothness`. `Size` and `Opacity` are the brush's own two, and the foreground is the
 * replacement, shown as a readout the same way `PaintBucket.tsx:50` shows the fill colour.
 *
 * **Nothing here writes a colour.** The sampled source colour is the tool area's business and the
 * replacement colour is the store's, read at the gesture by `ColorReplacementToolArea`; a control
 * that mirrored either into the args would be writing through `patchToolArgs` on every render and
 * would fight the sibling branch fixing the same class of bug for brush and pencil. The swatch
 * below is a readout of the sample the click already took, and the one to its right is the
 * foreground, both recomputed from live state so the bar is a snapshot of a live value.
 *
 * `All Layers` renders DISABLED, which is this repo's rule for a Photoshop control with no
 * substrate: the tool area has the ACTIVE layer's pixels and `commit: 'raster'` writes back to the
 * active layer, so a composite read of every visible layer is not performed. It carries its real
 * value behind the `disabled`, so turning it on is a rendering change and not a schema change —
 * the precedent `Eyedropper.tsx:37-43` sets for `Sample All Layers`.
 */
const ColorReplacement: ToolbarRightComponent = () => {
  const [{ color }] = useStore();
  const { getToolArgs, patchToolArgs } = useCurrentTool();

  // Both hooks run before the early return, so neither is conditional, and this component identity
  // is mounted as a toolbox for this tool only.
  const args = getToolArgs('color-replacement');
  if (!args) return null;

  const { alpha, lineWidth, limits, sampling, smoothness, sampleColor, tolerance } = args as ColorReplacementToolArgs;

  const handleToleranceChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('color-replacement', { tolerance: Number(event.target.value) });
  };

  const handleSmoothnessChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('color-replacement', { smoothness: Number(event.target.value) });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('color-replacement', { lineWidth: Number(event.target.value) });
  };

  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('color-replacement', { alpha: Number(event.target.value) / 100 });
  };

  const handleLimitsChange = (event: ChangeEvent<HTMLSelectElement>) => {
    patchToolArgs('color-replacement', { limits: event.target.value as ColorReplacementLimits });
  };

  const sampleLabel = sampleColor
    ? `rgb(${sampleColor.r}, ${sampleColor.g}, ${sampleColor.b})`
    : 'click the canvas to choose';

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label className={`${FIELD_CLASS} min-w-32 ${DISABLED_CLASS}`} htmlFor="color-replacement-sampling">
        Sampling
        {/* Uncontrolled and disabled on purpose: no read path can change it, so a controlled
            `value` with no writer would only be a read-only-field warning. `disabled`, not
            absent, so a test can prove it is not offered as though it worked. */}
        <select className={SELECT_CLASS} defaultValue={sampling} disabled id="color-replacement-sampling">
          {SAMPLING_OPTIONS.map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className={`${FIELD_CLASS} min-w-32`} htmlFor="color-replacement-limits">
        Limits
        <select className={SELECT_CLASS} id="color-replacement-limits" onChange={handleLimitsChange} value={limits}>
          {LIMITS_OPTIONS.map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className={FIELD_CLASS} htmlFor="color-replacement-tolerance">
        Tolerance <span className={VALUE_CLASS}>{tolerance}</span>
        {/* `max` is 100: this tool's scale, not the fills' 255. The value is unitless, so the max is
            the only thing that states the scale, which is why it is the shared constant. */}
        <input
          className={SLIDER_CLASS}
          id="color-replacement-tolerance"
          max={COLOR_REPLACEMENT_TOLERANCE_MAX}
          min="0"
          onChange={handleToleranceChange}
          step="1"
          type="range"
          value={tolerance}
        />
      </label>

      <label className={FIELD_CLASS} htmlFor="color-replacement-smoothness">
        Smoothness <span className={VALUE_CLASS}>{smoothness}</span>
        {/* 0-50, not 0-100: Photoshop's Smoothness (Anti-aliased on older builds) is a half-scale
            control and the bar is where that fact is written down. */}
        <input
          className={SLIDER_CLASS}
          id="color-replacement-smoothness"
          max={COLOR_REPLACEMENT_SMOOTHNESS_MAX}
          min="0"
          onChange={handleSmoothnessChange}
          step="1"
          type="range"
          value={smoothness}
        />
      </label>

      <label className={FIELD_CLASS} htmlFor="color-replacement-size">
        Size <span className={VALUE_CLASS}>{Math.round(lineWidth)}px</span>
        <input
          className={SLIDER_CLASS}
          id="color-replacement-size"
          max="200"
          min="1"
          onChange={handleSizeChange}
          step="1"
          type="range"
          value={Math.round(lineWidth)}
        />
      </label>

      <label className={FIELD_CLASS} htmlFor="color-replacement-opacity">
        Opacity <span className={VALUE_CLASS}>{Math.round(alpha * 100)}%</span>
        <input
          className={SLIDER_CLASS}
          id="color-replacement-opacity"
          max="100"
          min="0"
          onChange={handleOpacityChange}
          step="1"
          type="range"
          value={Math.round(alpha * 100)}
        />
      </label>

      <div className={`${FIELD_CLASS} min-w-40 ${DISABLED_CLASS}`}>
        {/* A readout, not a control: `rgb(...)` is the sampled colour and the hex is the live
            foreground, the two things the user is choosing between. */}
        <span className={VALUE_CLASS}>Sampled {sampleLabel}</span>
        <span>
          Replace with <span className={VALUE_CLASS}>{color.toUpperCase()}</span>
        </span>
      </div>
    </div>
  );
};

export default ColorReplacement;
