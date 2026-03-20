import React from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';

const Reposition: React.FC<{}> = () => {
  const [{ layers, activeLayerId }] = useStore();
  const { mergeAllLayers } = useLayers();

  const activeName = activeLayerId ? layers[activeLayerId]?.name : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
        <p className="mb-1 font-semibold">How to use:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>Select a layer on the canvas to move or resize it</li>
          <li>You can drag or resize</li>
        </ul>
      </div>

      <div className="rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
        <div className="text-gray-600 dark:text-gray-300">Active layer</div>
        <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{activeName ?? 'No layer selected'}</div>
        {!activeName && <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Select a layer to move</div>}
      </div>

      <button
        onClick={mergeAllLayers}
        className="mt-2 w-full rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Merge all layers
      </button>
    </div>
  );
};

export default Reposition;
