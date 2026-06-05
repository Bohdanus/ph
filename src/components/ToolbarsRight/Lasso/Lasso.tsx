import React, { type ChangeEvent, useEffect } from 'react';
import { type LassoToolArgs, type PolygonSelectionToolSettings } from '../../../tools/polygonSelection.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';

const Lasso: React.FC<{}> = () => {
  const [{ color }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as LassoToolArgs;

  useEffect(() => {
    setToolArgs({ ...args, color } as LassoToolArgs);
  }, [color]);

  const handleChange = (newArgs: PolygonSelectionToolSettings) => {
    setToolArgs({ ...newArgs, toolName: 'polygonal-lasso' } as LassoToolArgs);
  };

  const handleLineWidthChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleChange({ ...args, lineWidth: Number(event.target.value) });
  };

  const handleAlphaChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleChange({ ...args, alpha: Number(event.target.value) });
  };

  const handleFillToggle = () => {
    handleChange({ ...args, fill: !args.fill });
  };

  const { alpha, lineWidth, fill } = args;

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mode</span>
        <button
          onClick={handleFillToggle}
          className={`px-3 py-1 rounded border text-sm transition-colors ${
            fill
              ? 'bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:border-blue-700'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
          }`}
        >
          {fill ? 'Fill' : 'Outline'}
        </button>
      </div>

      {!fill && (
        <div className="flex flex-col">
          <label
            htmlFor="lasso-line-width"
            className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
          >
            Size
            <span className="font-bold text-gray-900 dark:text-gray-200">{lineWidth}px</span>
          </label>
          <input
            id="lasso-line-width"
            type="range"
            min="1"
            max="100"
            step="1"
            value={lineWidth}
            onChange={handleLineWidthChange}
            className="h-1.5 w-32 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
        </div>
      )}

      <div className="flex flex-col">
        <label
          htmlFor="lasso-alpha"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Opacity
          <span className="font-bold text-gray-900 dark:text-gray-200">{Math.round(alpha * 100)}%</span>
        </label>
        <input
          id="lasso-alpha"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          onChange={handleAlphaChange}
          className="h-1.5 w-30 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 max-w-xs">
        <div>Click points • Right-click to finish</div>
        <div className="text-[9px] mt-1 opacity-75">Double-click first point to close • Shift+drag for freehand</div>
      </div>
    </div>
  );
};

export default Lasso;
