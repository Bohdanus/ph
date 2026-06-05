import React from 'react';
import { type SelectionMode, type SelectionToolArgs } from '../../../tools/selection.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';

const PolygonalLasso: React.FC<{}> = () => {
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as SelectionToolArgs;
  const { mode } = args;
  const isFill = mode === 'fill';

  const handleFillToggle = () => {
    const newMode: SelectionMode = isFill ? 'outline' : 'fill';
    setToolArgs({ ...args, mode: newMode } as SelectionToolArgs);
  };

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mode</span>
        <button
          onClick={handleFillToggle}
          className={`px-3 py-1 rounded border text-sm transition-colors ${
            isFill
              ? 'bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:border-blue-700'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
          }`}
        >
          {isFill ? 'Fill' : 'Outline'}
        </button>
      </div>

      <div className="text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 max-w-xs">
        <div>Click points • Double-click to finish</div>
        <div className="text-[9px] mt-1 opacity-75">just nice line !</div>
      </div>
    </div>
  );
};

export default PolygonalLasso;
