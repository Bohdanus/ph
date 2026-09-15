import React, { type ChangeEvent, useState } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import type { FeatherMagneticLassoToolArgs } from '../../../tools/featherMagneticLasso.ts';
import {
  copyCanvasToClipboard,
  copyFeatheredPolygonToCanvas,
  getActiveSelection,
  getSelectionAbsolutePoints,
} from '../../../util/selection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const SLIDER_CLASS = 'h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

const SETTING_HELP = [
  {
    label: 'Feather',
    description:
      'Softens the final selection edge by the selected radius. Higher values create a wider transparent falloff when copying.',
  },
  {
    label: 'Width',
    description:
      'Search radius around the cursor where the magnetic lasso looks for strong image edges on the final merged canvas.',
  },
  {
    label: 'Contrast',
    description:
      'Minimum edge strength needed before the path snaps. Raise it for high-contrast objects; lower it for subtle edges.',
  },
  {
    label: 'Frequency',
    description:
      'Distance between automatic fastening points while moving. Lower values add more anchors and track detailed edges more tightly.',
  },
  {
    label: 'Snap',
    description:
      'How strongly the cursor is pulled toward detected edges. Set lower values when the edge detector over-snaps.',
  },
  {
    label: 'Smooth',
    description:
      'Simplifies the finished path to remove jitter. Higher values reduce point count but can round fine details.',
  },
  {
    label: 'Anti-alias',
    description: 'Adds sub-pixel smoothing to the copied mask edge so hard selections do not look jagged.',
  },
  {
    label: 'Preview feather',
    description: 'Shows a translucent wide outline while drawing to indicate the approximate feather falloff area.',
  },
] as const;

const FeatherMagneticLasso: React.FC<{}> = () => {
  const [{ canvasRef, totalSize, selections, activeSelectionId }, dispatch] = useStore();
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const [isCopying, setIsCopying] = useState(false);

  const args = getToolArgs('feather-magnetic-lasso');
  if (!args) return null;

  const activeSelection = getActiveSelection(selections, activeSelectionId);
  const hasActiveSelection = !!activeSelection;

  const patchNumber = (patch: Partial<FeatherMagneticLassoToolArgs>) => {
    patchToolArgs('feather-magnetic-lasso', patch);
  };

  const handleFeatherRadiusChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchNumber({ featherRadius: Number(event.target.value) });
  };

  const handleMagneticWidthChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchNumber({ magneticWidth: Number(event.target.value) });
  };

  const handleEdgeContrastChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchNumber({ edgeContrast: Number(event.target.value) });
  };

  const handleFrequencyChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchNumber({ frequency: Number(event.target.value) });
  };

  const handleSnapStrengthChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchNumber({ snapStrength: Number(event.target.value) });
  };

  const handleSmoothingChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchNumber({ smoothing: Number(event.target.value) });
  };

  const handleAntiAliasChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('feather-magnetic-lasso', { antiAlias: event.target.checked });
  };

  const handlePreviewFeatherChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('feather-magnetic-lasso', { previewFeather: event.target.checked });
  };

  const handleCopySelection = async () => {
    if (!activeSelection || !canvasRef.current) return;

    try {
      setIsCopying(true);
      const selectionCanvas = copyFeatheredPolygonToCanvas(
        canvasRef.current,
        getSelectionAbsolutePoints(activeSelection),
        {
          antiAlias: args.antiAlias,
          featherRadius: activeSelection.metadata?.featherRadius ?? args.featherRadius,
          imageSize: totalSize,
        }
      );

      await copyCanvasToClipboard(selectionCanvas);
      dispatch({ type: 'MARK_SELECTION_COPIED', payload: { id: activeSelection.id } });
    } catch (error) {
      console.error('Error copying feathered magnetic selection:', error);
      alert('Failed to copy feathered selection to clipboard');
    } finally {
      setIsCopying(false);
    }
  };

  const handleClear = () => {
    dispatch({ type: 'CLEAR_SELECTIONS' });
  };

  return (
    <div className="flex h-full flex-row items-center gap-4 overflow-x-auto">
      <div className="flex min-w-56 items-start gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
        <div>
          <div>Click to start → Move along edge → Click anchors → double-click closes</div>
          <div className="mt-1 text-[9px] opacity-75">Alt disables magnet • Backspace removes anchor • Esc cancels</div>
        </div>
        <div className="group relative ml-auto shrink-0">
          <button
            type="button"
            aria-label="Feather Magnetic Lasso settings information"
            className="grid h-5 w-5 place-items-center rounded-full border border-blue-300 bg-white text-[11px] font-bold text-blue-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300"
          >
            i
          </button>
          <div
            role="tooltip"
            className="invisible absolute left-1/2 top-7 z-50 w-96 -translate-x-1/2 rounded-lg border border-gray-300 bg-white p-3 text-left text-[11px] leading-snug text-gray-700 opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
          >
            <div className="mb-2 font-bold text-gray-900 dark:text-white">Feather Magnetic Lasso settings</div>
            <div className="mb-2 text-[10px] text-gray-500 dark:text-gray-400">
              The magnetic path samples the final merged canvas and snaps to gradient edges; copy output uses a feathered
              alpha mask.
            </div>
            <dl className="grid gap-1.5">
              {SETTING_HELP.map((item) => (
                <div key={item.label} className="grid grid-cols-[72px_1fr] gap-2">
                  <dt className="font-semibold text-gray-900 dark:text-white">{item.label}</dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      <label className="flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Feather <span className="font-bold text-gray-900 dark:text-gray-200">{args.featherRadius}px</span>
        <input
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={args.featherRadius}
          onChange={handleFeatherRadiusChange}
        />
      </label>

      <label className="flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Width <span className="font-bold text-gray-900 dark:text-gray-200">{args.magneticWidth}px</span>
        <input
          className={SLIDER_CLASS}
          max="64"
          min="1"
          step="1"
          type="range"
          value={args.magneticWidth}
          onChange={handleMagneticWidthChange}
        />
      </label>

      <label className="flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Contrast <span className="font-bold text-gray-900 dark:text-gray-200">{args.edgeContrast}%</span>
        <input
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={args.edgeContrast}
          onChange={handleEdgeContrastChange}
        />
      </label>

      <label className="flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Frequency <span className="font-bold text-gray-900 dark:text-gray-200">{args.frequency}px</span>
        <input
          className={SLIDER_CLASS}
          max="120"
          min="8"
          step="1"
          type="range"
          value={args.frequency}
          onChange={handleFrequencyChange}
        />
      </label>

      <label className="flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Snap <span className="font-bold text-gray-900 dark:text-gray-200">{Math.round(args.snapStrength * 100)}%</span>
        <input
          className={SLIDER_CLASS}
          max="1"
          min="0"
          step="0.01"
          type="range"
          value={args.snapStrength}
          onChange={handleSnapStrengthChange}
        />
      </label>

      <label className="flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Smooth <span className="font-bold text-gray-900 dark:text-gray-200">{args.smoothing}px</span>
        <input
          className={SLIDER_CLASS}
          max="10"
          min="0"
          step="0.5"
          type="range"
          value={args.smoothing}
          onChange={handleSmoothingChange}
        />
      </label>

      <label className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-gray-700 dark:text-gray-300">
        <input checked={args.antiAlias} type="checkbox" onChange={handleAntiAliasChange} />
        Anti-alias
      </label>

      <label className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-gray-700 dark:text-gray-300">
        <input checked={args.previewFeather} type="checkbox" onChange={handlePreviewFeatherChange} />
        Preview feather
      </label>

      <div className="flex gap-2">
        <button className={PRIMARY_BUTTON} disabled={!hasActiveSelection || isCopying} onClick={handleCopySelection}>
          {isCopying ? 'Copying...' : 'Copy'}
        </button>
        <button className={SECONDARY_BUTTON} disabled={!hasActiveSelection} onClick={handleClear}>
          Clear
        </button>
      </div>
    </div>
  );
};

export default FeatherMagneticLasso;
