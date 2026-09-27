import React from 'react';
import type { CropToolArgs } from '../../../tools/crop.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const aspectRatios = [
  { label: 'Free', value: null },
  { label: 'Square (1:1)', value: 1 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const Crop: React.FC<{}> = () => {
  const { applyDocumentCrop } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as CropToolArgs;
  const { aspectRatio, rect } = args;

  const onChange = setToolArgs;

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
            const newAspectRatio = val === '' ? null : Number(val);
            onChange({
              ...args,
              aspectRatio: newAspectRatio,
              rect: newAspectRatio && rect ? refitRectToAspect(rect, newAspectRatio) : rect,
            });
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

      <div className="flex gap-2">
        <button
          className={PRIMARY_BUTTON}
          disabled={!rect}
          onClick={() => {
            if (rect && applyDocumentCrop(rect)) onChange({ ...args, rect: null });
          }}
        >
          Apply
        </button>

        <button className={SECONDARY_BUTTON} disabled={!rect} onClick={() => onChange({ ...args, rect: null })}>
          Clear
        </button>
      </div>
    </div>
  );
};

// A ratio change only reshapes the overlay's private `startRectRef`, so without publishing the
// refit here `Apply` would hand the pre-ratio rect to `applyDocumentCrop` and the document would
// be cropped to a region the user never saw. This is a pixel-exact mirror of the private
// `adjustWidthRatio` in `useRect.ts` that the overlay refits with; the two must not drift.
function refitRectToAspect(rect: NonNullable<CropToolArgs['rect']>, aspectRatio: number) {
  const height = Math.abs(rect.y2 - rect.y1);
  const currentWidth = Math.abs(rect.x2 - rect.x1);
  const wantedWidth = height / aspectRatio;
  const diff = (wantedWidth - currentWidth) / 2;
  return rect.x1 < rect.x2
    ? { ...rect, x1: rect.x1 - diff, x2: rect.x2 + diff }
    : { ...rect, x1: rect.x1 + diff, x2: rect.x2 - diff };
}

export default Crop;
