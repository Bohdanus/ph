import React, { useEffect, useRef } from 'react';
import { type LevelsToolArgs } from '../../../tools/levels.ts';
import { defaultSettings } from '../../../tools/settings.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { SECONDARY_BUTTON } from '../buttonStyles.ts';

const Levels: React.FC<{}> = () => {
  const { tempUpdateLayer, cancelLayerPreview } = useLayers();
  const [{ activeLayerId, previewLayers }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as LevelsToolArgs;
  const pendingUpdateRef = useRef<LevelsToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const throttledOnChange = (newArgs: LevelsToolArgs) => {
    pendingUpdateRef.current = newArgs;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingUpdateRef.current !== null) {
          tempUpdateLayer({ id: activeLayerId!, toolArgs: pendingUpdateRef.current });
          setToolArgs(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
        rafIdRef.current = null;
      });
    }
  };

  const handleBrightnessChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const brightness = Number(event.target.value);
    throttledOnChange({ ...args, brightness });
  };

  const handleContrastChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const contrast = Number(event.target.value);
    throttledOnChange({ ...args, contrast });
  };

  /**
   * A live preview for the active layer is the only thing this panel's discard can
   * remove, so that preview is exactly what the button is gated on. `previewLayers`
   * is a mutable ref rather than state, which makes this a render-time read: it is
   * correct because every production path that fills or empties the map is followed
   * by a dispatch that re-renders the panel — the sliders' own write calls
   * `tempUpdateLayer` and then `setToolArgs` on the same frame, and `commitDirtyTool`
   * dispatches the entry it baked — and `cancelLayerPreview` empties it only from
   * the click handler below.
   */
  const hasLivePreview = Boolean(activeLayerId && previewLayers.current[activeLayerId]);

  /**
   * Discards the uncommitted levels adjustment, and only that.
   *
   * This used to be the shared `<UndoButton />`, which routed to document-level
   * `undo()` on its `else` branch. `isToolDirty` is never true in production —
   * nothing dispatches `SET_TOOL_DIRTY` with `true` — so every click replayed the
   * timeline one entry back and silently reverted the user's last committed edit.
   *
   * The baseline is `defaultSettings.levels`, not `resetToLastSavedArgs()`: the
   * slider write goes through `setToolArgs`, which calls `saveLastSettings` on the
   * same tick and overwrites `lastSavedSettings.levels` with the value the user just
   * dragged to. A reset cloned from there restores the unapplied value and the
   * control goes on lying about it.
   *
   * `commitDirtyTool` bakes the preview into a real layer plus a `TOOL_ACTION`
   * entry — on tool switch, on export and in `mergeAllLayers` — and by then there
   * is no preview left to cancel. Un-gated, a click there cleared nothing while
   * the two sliders dropped to 0 and the canvas kept the committed adjustment, so
   * the button is disabled unless `hasLivePreview`. Removing a committed adjustment
   * is a document operation, and that is `Cmd+Z`'s.
   */
  const discardAdjustment = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingUpdateRef.current = null;

    cancelLayerPreview?.();
    setToolArgs({ ...defaultSettings.levels });
  };

  const { brightness, contrast } = args;

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <label
          htmlFor="brightness-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Brightness
          <span className="font-bold text-gray-900 dark:text-gray-200">{brightness}%</span>
        </label>
        <input
          id="brightness-slider"
          type="range"
          min={-100}
          max={100}
          value={brightness}
          onChange={handleBrightnessChange}
          className="h-1.5 w-48 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>
      <div className="flex flex-col">
        <label
          htmlFor="contrast-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Contrast
          <span className="font-bold text-gray-900 dark:text-gray-200">{contrast}%</span>
        </label>
        <input
          id="contrast-slider"
          type="range"
          min={-100}
          max={100}
          value={contrast}
          onChange={handleContrastChange}
          className="h-1.5 w-48 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <button
        className={`${SECONDARY_BUTTON} w-full focus:ring-2 focus:ring-blue-500 disabled:opacity-50`}
        onClick={discardAdjustment}
        disabled={!hasLivePreview}
        data-testid="undo-button-reset"
      >
        Reset
      </button>
    </div>
  );
};

export default Levels;
