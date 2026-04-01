import React from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { SECONDARY_BUTTON } from '../buttonStyles.ts';

const Reposition: React.FC<{}> = () => {
  const [{ layers, activeLayerId }] = useStore();
  const { mergeAllLayers } = useLayers();

  const activeName = activeLayerId ? layers[activeLayerId]?.name : null;

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex flex-col">
        <div className="text-[10px] text-gray-600 dark:text-gray-300">Active layer</div>
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
          {activeName ?? 'None'}
        </div>
      </div>

      <button
        onClick={mergeAllLayers}
        className={SECONDARY_BUTTON}
      >
        Merge all
      </button>

      <div className="text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
        Drag or resize on canvas
      </div>
    </div>
  );
};

export default Reposition;
