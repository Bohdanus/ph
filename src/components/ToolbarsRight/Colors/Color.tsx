import React, { useEffect, useRef } from 'react';
import { type ColorsToolArgs } from '../../../tools/colors.ts';
import { defaultSettings } from '../../../tools/settings.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { SECONDARY_BUTTON } from '../buttonStyles.ts';

const Color: React.FC<{}> = () => {
  const { tempUpdateLayer, cancelLayerPreview, mergeAllLayers } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const [{ activeLayerId, previewLayers }] = useStore();

  const args = toolArgs as ColorsToolArgs;
  const pendingUpdateRef = useRef<ColorsToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const mergePendingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const throttledOnChange = (newArgs: ColorsToolArgs) => {
    pendingUpdateRef.current = newArgs;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingUpdateRef.current !== null) {
          tempUpdateLayer({ toolArgs: pendingUpdateRef.current });
          setToolArgs(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
        rafIdRef.current = null;
      });
    }
  };

  const handleGrayscaleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const grayscale = Number(event.target.value);
    throttledOnChange({ ...args, grayscale });
  };

  const handleSepiaChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sepia = Number(event.target.value);
    throttledOnChange({ ...args, sepia });
  };

  const handleSaturationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const saturation = Number(event.target.value);
    throttledOnChange({ ...args, saturation });
  };

  /**
   * `mergeAllLayers` is async and every call runs `commitDirtyTool()` and dispatches
   * its own `COMMIT_DOCUMENT_EDIT`, so an unguarded handler lets a double click
   * commit the dirty tool twice and append two merge entries. The rejection was
   * also unhandled: the promise was returned straight to React's event plumbing.
   */
  const handleMergeAll = () => {
    if (mergePendingRef.current) return;
    mergePendingRef.current = true;

    void Promise.resolve(mergeAllLayers())
      .catch((error: unknown) => {
        console.error('Failed to merge all layers', error);
      })
      .finally(() => {
        mergePendingRef.current = false;
      });
  };

  /**
   * A live preview for the active layer is the only thing this panel's discard can
   * remove, so that preview is exactly what the button is gated on. `previewLayers`
   * is a mutable ref rather than state, which makes this a render-time read: it is
   * correct because every production path that fills or empties the map is followed
   * by a dispatch that re-renders the panel — the sliders' own write calls
   * `tempUpdateLayer` and then `setToolArgs` on the same frame, and both
   * `commitDirtyTool` and `mergeAllLayers` dispatch what they baked — and
   * `cancelLayerPreview` empties it only from the click handler below.
   */
  const hasLivePreview = Boolean(activeLayerId && previewLayers.current[activeLayerId]);

  /**
   * Discards the uncommitted colour adjustment, and only that.
   *
   * This used to be the shared `<UndoButton />`, which routed to document-level
   * `undo()` on its `else` branch. `isToolDirty` is never true in production —
   * nothing dispatches `SET_TOOL_DIRTY` with `true` — so every click replayed the
   * timeline one entry back and silently reverted the user's last committed edit.
   *
   * The baseline is `defaultSettings.color`, never the last-saved copy of the
   * colour settings: the slider write goes through `setToolArgs`, which calls
   * `saveLastSettings` on the same tick, so `lastSavedSettings.color` already holds
   * the value the user just dragged to. Cloning it back would restore the
   * unapplied value and the control would go on lying about it.
   *
   * `commitDirtyTool` bakes the preview into a real layer plus a `TOOL_ACTION`
   * entry — on tool switch, on export and in this panel's own "Merge all" — and by
   * then there is no preview left to cancel. Un-gated, a click there cleared
   * nothing while the three sliders dropped to 0 and the canvas kept the committed
   * adjustment, so the button is disabled unless `hasLivePreview`. Removing a
   * committed adjustment is a document operation, and that is `Cmd+Z`'s.
   */
  const discardAdjustment = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingUpdateRef.current = null;

    cancelLayerPreview?.();
    setToolArgs({ ...defaultSettings.color });
  };

  const { grayscale, sepia, saturation } = args;

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <label
          htmlFor="grayscale-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Grayscale
          <span className="font-bold text-gray-900 dark:text-gray-200">{grayscale}%</span>
        </label>
        <input
          id="grayscale-slider"
          type="range"
          min="0"
          max="100"
          value={grayscale}
          onChange={handleGrayscaleChange}
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="sepia-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Sepia
          <span className="font-bold text-gray-900 dark:text-gray-200">{sepia}%</span>
        </label>
        <input
          id="sepia-slider"
          type="range"
          min="0"
          max="100"
          value={sepia}
          onChange={handleSepiaChange}
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="saturation-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Saturation
          <span className="font-bold text-gray-900 dark:text-gray-200">{saturation}%</span>
        </label>
        <input
          id="saturation-slider"
          type="range"
          min="-100"
          max="100"
          value={saturation}
          onChange={handleSaturationChange}
          className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex gap-2 items-center h-8 self-end mb-1">
        <button
          className={`${SECONDARY_BUTTON} focus:ring-2 focus:ring-blue-500 disabled:opacity-50`}
          onClick={discardAdjustment}
          disabled={!hasLivePreview}
          data-testid="undo-button-reset"
        >
          Reset
        </button>
        <button onClick={handleMergeAll} className={SECONDARY_BUTTON}>
          Merge all
        </button>
      </div>
    </div>
  );
};

export default Color;
