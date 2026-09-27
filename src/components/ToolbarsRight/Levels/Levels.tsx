import React, { useEffect, useRef } from 'react';
import { type LevelsToolArgs } from '../../../tools/levels.ts';
import { defaultSettings } from '../../../tools/settings.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { SECONDARY_BUTTON } from '../buttonStyles.ts';

const Levels: React.FC<{}> = () => {
  const { tempUpdateLayer, cancelLayerPreview } = useLayers();
  const [{ activeLayerId }] = useStore();
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
        className={`${SECONDARY_BUTTON} w-full focus:ring-2 focus:ring-blue-500`}
        onClick={discardAdjustment}
        data-testid="undo-button-reset"
      >
        Reset
      </button>
    </div>
  );
};

export default Levels;
