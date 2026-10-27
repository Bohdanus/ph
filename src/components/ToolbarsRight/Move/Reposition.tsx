import React, { useRef } from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { SECONDARY_BUTTON } from '../buttonStyles.ts';

const Reposition: React.FC<{}> = () => {
  const [{ layers, activeLayerId }] = useStore();
  const { mergeAllLayers } = useLayers();
  const mergePendingRef = useRef(false);

  const activeName = activeLayerId ? layers[activeLayerId]?.name : null;

  /**
   * `mergeAllLayers` is async and every call runs `commitDirtyTool()` and dispatches its own
   * `COMMIT_DOCUMENT_EDIT`, so handing it to `onClick` raw let a double click commit the dirty
   * tool twice and append two merge entries, and returned the promise straight to React's event
   * plumbing, which left a rejection unhandled. The Colors bar already carries this guard
   * (`Colors/Color.tsx`); the two buttons call the same function and must carry the same one.
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

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <div className="text-[10px] text-gray-600 dark:text-gray-300">Active layer</div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
          {activeName ?? 'None'}
        </div>
      </div>

      <button onClick={handleMergeAll} className={SECONDARY_BUTTON}>
        Merge all
      </button>

      <div
        className="text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800"
        data-testid="reposition-hint-text"
      >
        Drag or resize on canvas
      </div>
    </div>
  );
};

export default Reposition;
