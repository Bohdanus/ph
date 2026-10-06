import React, { type ChangeEvent, useEffect, useRef } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import {
  QUICK_SELECTION_MODES,
  QUICK_SELECTION_SIZE_MAX,
  QUICK_SELECTION_SIZE_MIN,
  QUICK_SELECTION_TOLERANCE_MAX,
  QUICK_SELECTION_TOLERANCE_MIN,
  isQuickSelectionMode,
} from '../../../tools/quickSelection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const LABEL_CLASS = 'text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';
const HINT_CLASS =
  'min-w-60 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300';

/**
 * The quick selection's options bar.
 *
 * Each slider's readout sits BESIDE its label rather than inside it. A readout inside the
 * `<label>` becomes part of the control's accessible name, so the name would read
 * "Tolerance 30%" and then "Tolerance 31%" and a locator written against "Tolerance"
 * would stop matching the moment the user dragged. Outside, the name is the label text
 * and only the label text.
 *
 * Sample All Layers is absent because `QuickSelectionToolArgs` has no field for it: the
 * stroke reads the document's composite canvas, and a control that could not change what
 * it reads would be a lie about the tool.
 */
const QuickSelection: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const { activeSelection, copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } =
    useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();

  const args = getToolArgs('quick-selection');

  // A range input fires `change` per animation frame of dragging, and each one patches
  // persisted tool settings, so the writes are coalesced into a frame. The pending patch
  // is merged rather than replaced because both sliders are live at once, and the
  // cancellation on unmount is what keeps a bar torn down mid-drag from publishing one.
  const pendingPatchRef = useRef<{ size?: number; tolerance?: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const schedulePatch = (patch: { size?: number; tolerance?: number }) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };

    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const pending = pendingPatchRef.current;
      pendingPatchRef.current = null;
      if (pending) {
        patchToolArgs('quick-selection', pending);
      }
    });
  };

  if (!args) return null;

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    schedulePatch({ size: Number(event.target.value) });
  };

  const handleToleranceChange = (event: ChangeEvent<HTMLInputElement>) => {
    schedulePatch({ tolerance: Number(event.target.value) });
  };

  const handleModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const mode = event.target.value;
    if (!isQuickSelectionMode(mode)) return;

    patchToolArgs('quick-selection', { mode });
  };

  const handleCopy = () => {
    if (!activeSelection) return;

    if (!copyActiveSelection(activeSelection)) {
      console.error('Failed to copy quick selection');
    }
  };

  // Only what the tool area does. Photoshop's Alt-drag brush-tip resize and Shift-drag circular
  // constraint are not implemented here, and a modifier named on screen that does nothing is a
  // defect of its own: the user presses Alt, expects the tip to change, and cannot tell it did not.
  const hint =
    args.mode === 'subtract'
      ? 'Drag over what to remove from the selection.'
      : 'Drag over an object to grow the selection along the stroke.';

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className="flex min-w-32 flex-col">
        <div className={`flex justify-between ${LABEL_CLASS}`}>
          <label htmlFor="quick-selection-size">Size</label>
          <span className={VALUE_CLASS}>{args.size}px</span>
        </div>
        <input
          id="quick-selection-size"
          className={SLIDER_CLASS}
          max={QUICK_SELECTION_SIZE_MAX}
          min={QUICK_SELECTION_SIZE_MIN}
          step="1"
          type="range"
          value={args.size}
          onChange={handleSizeChange}
        />
      </div>

      <div className="flex min-w-32 flex-col">
        <div className={`flex justify-between ${LABEL_CLASS}`}>
          <label htmlFor="quick-selection-tolerance">Tolerance</label>
          <span className={VALUE_CLASS}>{args.tolerance}%</span>
        </div>
        <input
          id="quick-selection-tolerance"
          className={SLIDER_CLASS}
          max={QUICK_SELECTION_TOLERANCE_MAX}
          min={QUICK_SELECTION_TOLERANCE_MIN}
          step="1"
          type="range"
          value={args.tolerance}
          onChange={handleToleranceChange}
        />
      </div>

      <label
        htmlFor="quick-selection-mode"
        className="flex flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300"
      >
        Mode
        <select id="quick-selection-mode" className={SELECT_CLASS} value={args.mode} onChange={handleModeChange}>
          {QUICK_SELECTION_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <button className={PRIMARY_BUTTON} disabled={!activeSelection} onClick={handleCopy}>
          Copy
        </button>
        <button className={PRIMARY_BUTTON} disabled={!hasSelectionClipboard} onClick={pasteSelectionClipboard}>
          Paste
        </button>
        <button className={SECONDARY_BUTTON} disabled={!activeSelection} onClick={clearSelections}>
          Deselect
        </button>
      </div>

      <div className={HINT_CLASS}>{hint}</div>
    </div>
  );
};

export default QuickSelection;
