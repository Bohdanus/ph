import React, { useEffect, useRef } from 'react';

import { type BlurToolArgs } from '../../../tools/blur.ts';
import { defaultSettings } from '../../../tools/settings.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { SECONDARY_BUTTON } from '../buttonStyles.ts';

const Blur: React.FC<{}> = () => {
  const { tempUpdateLayer, cancelLayerPreview } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const [{ activeLayerId, previewLayers }] = useStore();

  const args = toolArgs as BlurToolArgs;
  const { radius } = args;

  const pendingUpdateRef = useRef<BlurToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const throttledOnChange = (newArgs: BlurToolArgs) => {
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

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ radius: Number(event.target.value), toolName: 'blur' });
  };

  /**
   * A live preview for the active layer is the only thing this panel's discard can
   * remove, so that preview is exactly what the button is gated on. `previewLayers`
   * is a mutable ref rather than state, which makes this a render-time read: it is
   * correct because every production path that fills or empties the map is followed
   * by a dispatch that re-renders the panel — the slider's own write calls
   * `tempUpdateLayer` and then `setToolArgs` on the same frame, and `commitDirtyTool`
   * dispatches the entry it baked — and `cancelLayerPreview` empties it only from
   * the click handler below.
   */
  const hasLivePreview = Boolean(activeLayerId && previewLayers.current[activeLayerId]);

  /**
   * Discards the uncommitted radius, and only that.
   *
   * This used to be the shared `<UndoButton text="Undo Blur" />`, which routed to
   * document-level `undo()` on its `else` branch. `isToolDirty` is never true in
   * production — nothing dispatches `SET_TOOL_DIRTY` with `true` — so every click
   * replayed the timeline one entry back and silently reverted the user's last
   * committed edit while the slider kept showing the unapplied radius.
   *
   * The baseline is `defaultSettings.blur`, not `resetToLastSavedArgs()`: the
   * slider write goes through `setToolArgs`, which calls `saveLastSettings` on the
   * same tick and overwrites `lastSavedSettings.blur` with the value the user just
   * dragged to. A reset cloned from there restores the unapplied value and the
   * control goes on lying about it.
   *
   * `commitDirtyTool` bakes the preview into a real layer plus a `TOOL_ACTION`
   * entry — on tool switch, on export and in `mergeAllLayers` — and by then there
   * is no preview left to cancel. Un-gated, a click there cleared nothing while
   * the slider dropped to 0 and the canvas kept the committed blur, so the button
   * is disabled unless `hasLivePreview`. Removing a committed blur is a document
   * operation, and that is `Cmd+Z`'s, not this panel's.
   */
  const discardAdjustment = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingUpdateRef.current = null;

    cancelLayerPreview?.();
    setToolArgs({ ...defaultSettings.blur });
  };

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <label
          htmlFor="blur-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Blur Radius
          <span className="font-bold text-gray-900 dark:text-gray-200">{radius}px</span>
        </label>
        <input
          id="blur-slider"
          type="range"
          min="0"
          max="100"
          value={radius}
          onChange={handleChange}
          className="h-1.5 w-48 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <button
        className={`${SECONDARY_BUTTON} w-full focus:ring-2 focus:ring-blue-500 disabled:opacity-50`}
        onClick={discardAdjustment}
        disabled={!hasLivePreview}
        data-testid="undo-button-reset"
      >
        Undo Blur
      </button>
    </div>
  );
};

export default Blur;
