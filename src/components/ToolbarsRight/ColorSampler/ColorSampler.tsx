import React from 'react';

import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import {
  COLOR_SAMPLER_SAMPLE_SIZE_OPTIONS,
  type ColorSamplerToolArgs,
  samplerReadout,
} from '../../../tools/colorSampler.ts';
import type { EyedropperSampleSize } from '../../../tools/eyedropper.ts';
import { clearColorSamplers, useColorSamplers } from '../../../tools/color-sampler-store.ts';

const BAR_CLASS = 'flex h-full flex-row items-center gap-4 overflow-x-auto';
const FIELD_CLASS = 'flex min-w-32 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';
const READOUT_CLASS = 'flex flex-row items-baseline gap-2 text-[10px] font-medium text-gray-700 dark:text-gray-300';
const SWATCH_CLASS = 'h-7 w-7 self-end rounded border border-gray-300 dark:border-gray-600';
const VALUE_CLASS =
  'rounded border border-gray-300 bg-white px-2 py-1 text-xs tabular-nums dark:border-gray-600 dark:bg-gray-800';
const CLEAR_CLASS =
  'h-7 self-end rounded border border-gray-300 px-3 text-xs dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700';

/**
 * The Color Sampler's options bar: one control, then one readout per placed sampler.
 *
 * **Two controls on Adobe's own page, and only two.** Adobe names `Sample Size` for this tool — "if
 * necessary, choose a sample size in the options bar" — and `Clear`, which is named on the same page:
 * "To delete all color samplers, click Clear in the options bar."
 * <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
 *
 * **Deliberately absent, and each absence is a decision rather than an oversight.**
 *
 * The layer-source dropdown (`Sample`: All Layers, Current Layer, Current & Below, the No
 * Adjustments variants) is Adobe's for the EYEDROPPER, on the Eyedropper's own page. No Adobe source
 * places it on the Color Sampler's bar, and the app cannot honour it anyway: it needs a composite
 * read of a chosen stack, and the app reads the composited workspace canvas only. The Eyedropper's
 * bar already records that as a control with no widget and a loud refusal; the Color Sampler does
 * not repeat the row.
 *
 * The colour-model switcher is likewise not rendered. Adobe documents its FUNCTION — "To change the
 * color space in which a color sampler displays values, move the pointer onto the color sampler icon
 * in the Info panel" — and puts it in the Info panel, which this app does not have. What the app
 * shows instead is stated in `colorSampler.ts`: RGB and hex, both direct readings of the sampled
 * pixel, with no invented Lab, XYZ or CMYK.
 *
 * **The readouts live here because the app has no Info panel**, which is the Ruler's arrangement and
 * Adobe names both surfaces for its measurements.
 */
const ColorSampler: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const samplers = useColorSamplers();

  // The bar belongs to the tool, so it reads as absent for any other one rather than reporting this
  // tool's samples under a different tool's name.
  const args = getToolArgs('color-sampler') as ColorSamplerToolArgs | undefined;
  if (!args) return null;

  const handleSampleSizeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    patchToolArgs('color-sampler', { sampleSize: Number(event.target.value) as EyedropperSampleSize });
  };

  return (
    <div className={BAR_CLASS}>
      <label className={`${FIELD_CLASS} min-w-36`} htmlFor="color-sampler-sample-size">
        Sample Size
        <select
          className={SELECT_CLASS}
          id="color-sampler-sample-size"
          value={args.sampleSize}
          onChange={handleSampleSizeChange}
        >
          {COLOR_SAMPLER_SAMPLE_SIZE_OPTIONS.map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {/* One readout per sampler, in placement order. The swatch is the colour itself and the three
          numbers are its channels, which is the same information twice by design: Photoshop's marker
          carries the number and its readout carries the values, and the swatch is what makes a row
          legible at a glance the way Photoshop's crossed-out/transparent case is legible. */}
      {samplers.map((sampler) => {
        const readout = samplerReadout(sampler);
        return (
          <div className="flex flex-row items-end gap-2" key={sampler.id}>
            <span
              className={SWATCH_CLASS}
              style={{ backgroundColor: readout.hex }}
              data-testid={`color-sampler-swatch-${sampler.id}`}
              aria-hidden="true"
            />
            <span className={READOUT_CLASS}>
              <output className={VALUE_CLASS} data-testid={`color-sampler-${sampler.id}`}>
                {readout.red}, {readout.green}, {readout.blue}
              </output>
              <output className={VALUE_CLASS} data-testid={`color-sampler-hex-${sampler.id}`}>
                {readout.hex}
              </output>
            </span>
          </div>
        );
      })}

      <button
        type="button"
        id="color-sampler-clear"
        className={CLEAR_CLASS}
        onClick={clearColorSamplers}
        disabled={samplers.length === 0}
        data-testid="color-sampler-clear"
      >
        Clear
      </button>
    </div>
  );
};

export default ColorSampler;
