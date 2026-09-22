import React, { type ChangeEvent, useEffect, useState } from 'react';
import { type LassoToolArgs, type PolygonSelectionToolSettings } from '../../../tools/polygonSelection.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';

const Lasso: React.FC<{}> = () => {
  const [{ color }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const { activeSelection, copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } =
    useSelectionClipboard();
  const [isCopying, setIsCopying] = useState(false);

  const args = toolArgs as LassoToolArgs;

  useEffect(() => {
    if (args.color === color) return;
    setToolArgs({ ...args, color } as LassoToolArgs);
  }, [args, color, setToolArgs]);

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

  const handleCopySelection = async () => {
    try {
      if (!activeSelection || activeSelection.geometry === 'rectangle') {
        alert('No active selection to copy');
        return;
      }

      setIsCopying(true);
      if (!copyActiveSelection(activeSelection)) {
        alert('Failed to copy selection');
      }
    } catch (error) {
      console.error('Error copying selection:', error);
      alert('Failed to copy selection');
    } finally {
      setIsCopying(false);
    }
  };

  const handlePasteSelection = () => {
    pasteSelectionClipboard();
  };

  const { alpha, lineWidth, fill } = args;
  const hasActiveSelection = !!activeSelection && activeSelection.geometry !== 'rectangle';

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

      <button
        onClick={handleCopySelection}
        disabled={isCopying || !hasActiveSelection}
        className={`px-3 py-1 rounded border text-sm transition-colors ${
          !hasActiveSelection || isCopying
            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700'
            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 active:bg-gray-100 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600'
        }`}
        title={!hasActiveSelection ? 'No active selection to copy' : 'Copy selection inside this app'}
      >
        {isCopying ? 'Copying...' : 'Copy'}
      </button>

      <button
        onClick={handlePasteSelection}
        disabled={!hasSelectionClipboard}
        className={`px-3 py-1 rounded border text-sm transition-colors ${
          !hasSelectionClipboard
            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700'
            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 active:bg-gray-100 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600'
        }`}
        title={!hasSelectionClipboard ? 'No in-app copied selection to paste' : 'Paste copied selection as a new layer'}
      >
        Paste
      </button>

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
        <div className="text-[9px] mt-1 opacity-75">Backspace removes anchor • Enter finishes • Esc cancels</div>
      </div>
    </div>
  );
};

export default Lasso;
