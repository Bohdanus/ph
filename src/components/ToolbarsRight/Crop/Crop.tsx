import React, { useState } from 'react';
import {
  CROP_OVERLAYS,
  GRID_DIVISIONS_DEFAULT,
  GRID_DIVISIONS_MAX,
  GRID_DIVISIONS_MIN,
  type CropToolArgs,
  type CropOverlayType,
  type CropOverlayVisibility,
} from '../../../tools/crop.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';
import { refitRectWidthToAspect } from '../../../util/rect-aspect.ts';

const aspectRatios = [
  { label: 'Free', value: null },
  { label: 'Square (1:1)', value: 1 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const overlayLabels: Record<CropOverlayType, string> = {
  ruleOfThirds: 'Rule of Thirds',
  grid: 'Grid',
  diagonal: 'Diagonal',
  triangle: 'Triangle',
  goldenRatio: 'Golden Ratio',
  goldenSpiral: 'Golden Spiral',
};

const Crop: React.FC<{}> = () => {
  const { applyDocumentCrop } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as CropToolArgs;
  const {
    aspectRatio,
    rect,
    preRatioRect,
    overlayType = 'ruleOfThirds',
    overlayOrientation = 0,
    overlayVisibility = 'always',
    gridDivisions = GRID_DIVISIONS_DEFAULT,
    angle,
  } = args;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const orientationValue =
    typeof overlayOrientation === 'number' ? overlayOrientation : overlayOrientation === 'flipped' ? 1 : 0;
  const orientationCount = overlayType === 'triangle' ? 4 : 8;
  const clearDraft = () =>
    args.angle === undefined
      ? { ...args, rect: null, preRatioRect: null }
      : { ...args, angle: 0, rect: null, preRatioRect: null };

  const onChange = setToolArgs;

  /**
   * A ratio change publishes the refitted rect, because the store has to hold what the user is
   * shown — `Apply` hands the published `rect` and `angle` to `applyDocumentCrop`, and refitting only
   * the overlay's private ref would crop the document to a region the user never saw.
   *
   * Publishing it is a REGRESSION-CAUSED loss, and this is the way back: the pre-ratio rect was
   * never stored anywhere, so `Free`/`Original` had nothing to restore and left the rect 16:9
   * shaped. `preRatioRect` records it on the args the store holds — panel state would go stale the
   * moment the user drags a new rect with the ratio still set — and the first ratio choice wins, so
   * cycling through several presets still returns the user's original framing and not the last
   * intermediate fit.
   */
  const onRatioChange = (newAspectRatio: number | null) => {
    if (!newAspectRatio) {
      onChange({ ...args, aspectRatio: newAspectRatio, rect: preRatioRect ?? rect, preRatioRect: null });
      return;
    }

    onChange({
      ...args,
      aspectRatio: newAspectRatio,
      rect: rect ? { ...rect, ...refitRectWidthToAspect(rect, newAspectRatio) } : rect,
      preRatioRect: preRatioRect ?? rect ?? null,
    });
  };

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex items-center gap-2">
        <label
          htmlFor="aspect-ratio"
          className="whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Aspect Ratio
        </label>
        <select
          id="aspect-ratio"
          value={aspectRatio ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onRatioChange(val === '' ? null : Number(val));
          }}
          className="rounded border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {aspectRatios.map((ratio) => (
            <option key={ratio.label} value={ratio.value ?? ''}>
              {ratio.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label
          htmlFor="crop-overlay"
          className="whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Overlay
        </label>
        <select
          id="crop-overlay"
          value={overlayType}
          onChange={(event) =>
            onChange({ ...args, overlayType: event.target.value as CropOverlayType, overlayOrientation: 0 })
          }
          className="rounded border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {CROP_OVERLAYS.map((type) => (
            <option key={type} value={type}>
              {overlayLabels[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label="Crop settings"
          aria-expanded={settingsOpen}
          className={SECONDARY_BUTTON}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          Settings
        </button>
        {settingsOpen && (
          <div
            role="menu"
            aria-label="Crop settings menu"
            className="absolute left-0 top-full z-50 mt-1 flex min-w-64 flex-col gap-3 rounded border border-gray-300 bg-white p-3 text-sm shadow-lg dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <label className="flex items-center justify-between gap-3" htmlFor="crop-overlay-visibility">
              <span>Overlay visibility</span>
              <select
                id="crop-overlay-visibility"
                value={overlayVisibility}
                onChange={(event) =>
                  onChange({ ...args, overlayVisibility: event.target.value as CropOverlayVisibility })
                }
                className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
              >
                <option value="always">Always Show</option>
                <option value="auto">Auto Show</option>
                <option value="never">Never Show</option>
              </select>
            </label>

            {(overlayType === 'triangle' || overlayType === 'goldenSpiral') && (
              <label className="flex items-center justify-between gap-3" htmlFor="crop-overlay-orientation">
                <span>Orientation</span>
                <select
                  id="crop-overlay-orientation"
                  value={orientationValue}
                  onChange={(event) => onChange({ ...args, overlayOrientation: Number(event.target.value) })}
                  className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
                >
                  {Array.from({ length: orientationCount }, (_, index) => (
                    <option key={index} value={index}>
                      {index + 1} of {orientationCount}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex items-center justify-between gap-3" htmlFor="crop-grid-divisions">
              <span>Grid divisions</span>
              <input
                id="crop-grid-divisions"
                type="number"
                min={GRID_DIVISIONS_MIN}
                max={GRID_DIVISIONS_MAX}
                step={1}
                value={gridDivisions}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value))
                    onChange({
                      ...args,
                      gridDivisions: Math.max(GRID_DIVISIONS_MIN, Math.min(GRID_DIVISIONS_MAX, Math.round(value))),
                    });
                }}
                className="w-16 rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
              />
            </label>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          className={PRIMARY_BUTTON}
          disabled={!rect}
          onClick={() => {
            if (rect && (angle === undefined ? applyDocumentCrop(rect) : applyDocumentCrop(rect, angle))) {
              onChange(clearDraft());
            }
          }}
        >
          Apply
        </button>

        <button className={SECONDARY_BUTTON} disabled={!rect} onClick={() => onChange(clearDraft())}>
          Clear
        </button>
      </div>
    </div>
  );
};

// A ratio change only reshapes the overlay's private `startRectRef`, so without publishing the
// refit here `Apply` would hand the pre-ratio rect to `applyDocumentCrop` and the document would
// be cropped to a region the user never saw. The refit itself is `refitRectWidthToAspect`, the one
// implementation shared with `useRect`: this panel used to carry a byte-equal private copy of the
// hook's `adjustWidthRatio`, and the only thing keeping the two in step was a comment, so a
// one-sided edit (including flipping the axis to fit the height) left both suites green.
export default Crop;
