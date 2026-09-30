import React, { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import type { FeatherMagneticLassoToolArgs } from '../../../tools/featherMagneticLasso.ts';
import {
  MAGNETIC_LASSO_FREQUENCY_MAX,
  MAGNETIC_LASSO_FREQUENCY_MIN,
  MAGNETIC_LASSO_FREQUENCY_STEP,
} from '../../../tools/featherMagneticLasso.ts';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const SLIDER_CLASS = 'h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const INFO_TOOLTIP_ID = 'feather-magnetic-lasso-settings-tooltip';
const INFO_TOOLTIP_WIDTH = 384;

/**
 * How long the info tooltip stays mounted after focus or hover leaves, so a pointer
 * can cross the gap between the button and the menu without losing it.
 *
 * Exported because the delay is behaviour with a value, and the test that covers it
 * used to hard-code its own copy of that value. It was 200 in the test against 120
 * here, and a `grep` could not tell which was the real one: a stale constant in a
 * test is invisible until production changes. `eslint.config.js` sets
 * `allowConstantExport: true` for exactly this, so a constant exported beside its
 * component costs nothing.
 */
export const INFO_TOOLTIP_CLOSE_DELAY_MS = 120;

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
      'The rate at which the lasso sets fastening points while you move, between 0 and 100. Higher values anchor the selection border in place more quickly, and lower values let it follow a detailed edge further before fixing a point.',
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
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const { activeSelection, copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } =
    useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();
  const [isCopying, setIsCopying] = useState(false);
  const [isInfoHovered, setIsInfoHovered] = useState(false);
  const [isInfoPinned, setIsInfoPinned] = useState(false);
  const [infoTooltipPos, setInfoTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const closeInfoTooltipTimerRef = useRef<number | null>(null);

  const args = getToolArgs('feather-magnetic-lasso');
  const isInfoOpen = isInfoHovered || isInfoPinned;

  const clearInfoCloseTimer = useCallback(() => {
    if (closeInfoTooltipTimerRef.current === null) return;

    window.clearTimeout(closeInfoTooltipTimerRef.current);
    closeInfoTooltipTimerRef.current = null;
  }, []);

  const showInfoTooltip = useCallback(() => {
    clearInfoCloseTimer();
    setIsInfoHovered(true);
  }, [clearInfoCloseTimer]);

  const hideInfoTooltipSoon = useCallback(() => {
    clearInfoCloseTimer();
    closeInfoTooltipTimerRef.current = window.setTimeout(() => {
      setIsInfoHovered(false);
      closeInfoTooltipTimerRef.current = null;
    }, INFO_TOOLTIP_CLOSE_DELAY_MS);
  }, [clearInfoCloseTimer]);

  const updateInfoTooltipPosition = useCallback(() => {
    const button = infoButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const padding = 8;
    const estimatedHeight = 330;
    const maxLeft = Math.max(padding, window.innerWidth - INFO_TOOLTIP_WIDTH - padding);
    const preferredLeft = rect.left + rect.width / 2 - INFO_TOOLTIP_WIDTH / 2;
    const left = Math.min(maxLeft, Math.max(padding, preferredLeft));
    const preferredTop = rect.bottom + padding;
    const top =
      preferredTop + estimatedHeight > window.innerHeight
        ? Math.max(padding, rect.top - estimatedHeight - padding)
        : preferredTop;

    setInfoTooltipPos({ left, top });
  }, []);

  useEffect(() => {
    if (!isInfoOpen) return;

    updateInfoTooltipPosition();
    window.addEventListener('resize', updateInfoTooltipPosition);
    window.addEventListener('scroll', updateInfoTooltipPosition, true);

    return () => {
      window.removeEventListener('resize', updateInfoTooltipPosition);
      window.removeEventListener('scroll', updateInfoTooltipPosition, true);
    };
  }, [isInfoOpen, updateInfoTooltipPosition]);

  useEffect(() => {
    return () => clearInfoCloseTimer();
  }, [clearInfoCloseTimer]);

  if (!args) return null;

  const hasActiveSelection = !!activeSelection && activeSelection.geometry !== 'rectangle';

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
    if (!activeSelection || activeSelection.geometry === 'rectangle') return;

    try {
      setIsCopying(true);
      copyActiveSelection(activeSelection);
    } catch (error) {
      console.error('Error copying feathered magnetic selection:', error);
    } finally {
      setIsCopying(false);
    }
  };

  const handlePasteSelection = () => {
    pasteSelectionClipboard();
  };

  const handleClear = () => {
    clearSelections();
  };

  const handleInfoButtonClick = () => {
    clearInfoCloseTimer();
    updateInfoTooltipPosition();
    setIsInfoHovered(true);
    setIsInfoPinned((isPinned) => !isPinned);
  };

  const infoTooltip =
    isInfoOpen && infoTooltipPos
      ? createPortal(
          <div
            id={INFO_TOOLTIP_ID}
            role="tooltip"
            className="fixed z-[9999] max-h-[calc(100vh-16px)] w-96 overflow-y-auto rounded-lg border border-gray-300 bg-white p-3 text-left text-[11px] leading-snug text-gray-700 shadow-xl dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
            style={{ left: infoTooltipPos.left, top: infoTooltipPos.top }}
            onMouseEnter={showInfoTooltip}
            onMouseLeave={hideInfoTooltipSoon}
          >
            <div className="mb-2 font-bold text-gray-900 dark:text-white">Feather Magnetic Lasso settings</div>
            <div className="mb-2 text-[10px] text-gray-500 dark:text-gray-400">
              The magnetic path samples the final merged canvas and snaps to gradient edges; copy output uses a
              feathered alpha mask.
            </div>
            <dl className="grid gap-1.5">
              {SETTING_HELP.map((item) => (
                <div key={item.label} className="grid grid-cols-[72px_1fr] gap-2">
                  <dt className="font-semibold text-gray-900 dark:text-white">{item.label}</dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div className="flex h-full flex-row items-center gap-4 overflow-x-auto">
        <div className="flex min-w-56 items-start gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          <div>
            <div>Click to start → Move along edge → Click anchors → double-click closes</div>
            <div className="mt-1 text-[9px] opacity-75">
              Alt disables magnet • Backspace removes anchor • Esc cancels
            </div>
          </div>
          <div className="relative ml-auto shrink-0">
            <button
              ref={infoButtonRef}
              type="button"
              aria-label="Feather Magnetic Lasso settings information"
              aria-describedby={isInfoOpen ? INFO_TOOLTIP_ID : undefined}
              aria-expanded={isInfoOpen}
              className="grid h-5 w-5 place-items-center rounded-full border border-blue-300 bg-white text-[11px] font-bold text-blue-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300"
              onClick={handleInfoButtonClick}
              onFocus={showInfoTooltip}
              onBlur={hideInfoTooltipSoon}
              onMouseEnter={showInfoTooltip}
              onMouseLeave={hideInfoTooltipSoon}
            >
              i
            </button>
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
          Frequency <span className="font-bold text-gray-900 dark:text-gray-200">{args.frequency}</span>
          <input
            className={SLIDER_CLASS}
            max={MAGNETIC_LASSO_FREQUENCY_MAX}
            min={MAGNETIC_LASSO_FREQUENCY_MIN}
            step={MAGNETIC_LASSO_FREQUENCY_STEP}
            type="range"
            value={args.frequency}
            onChange={handleFrequencyChange}
          />
        </label>

        <label className="flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300">
          Snap{' '}
          <span className="font-bold text-gray-900 dark:text-gray-200">{Math.round(args.snapStrength * 100)}%</span>
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
          <button className={PRIMARY_BUTTON} disabled={!hasSelectionClipboard} onClick={handlePasteSelection}>
            Paste
          </button>
          <button className={SECONDARY_BUTTON} disabled={!hasActiveSelection} onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>
      {infoTooltip}
    </>
  );
};

export default FeatherMagneticLasso;
