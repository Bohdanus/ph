import React, { type ChangeEvent } from 'react';
import { calculateNewRect } from '../../../util/rect.ts';
import type { TextToolArgs } from '../../../tools/text.ts';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import FontSelect from './FontSelect.tsx';
import { useApp } from '../../../hooks/useApp.ts';

const Text: React.FC<{}> = () => {
  const [{ canvasRef, textareaRef, totalSize }] = useStore();
  const { createLayerFromTool } = useLayers();
  const { clearOverlay } = useApp();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as TextToolArgs;
  const { text, fontSize, lineHeight, rect, bold, italic, fontFamily, align } = args;

  const onChange = setToolArgs;

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const textValue = event.target.value;
    const newArgs = { ...args, text: textValue };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fontSize = Number(event.target.value);
    const newArgs = { ...args, fontSize };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleLineHeightChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newLineHeight = Number(event.target.value);
    const newArgs = { ...args, lineHeight: newLineHeight };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleFontFamilyChange = (fontFamily: string) => {
    const newArgs = { ...args, fontFamily };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleAlignChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const align = event.target.value as 'left' | 'center' | 'right';
    const newArgs = { ...args, align };
    onChange(newArgs);
  };

  const toggleBold = () => {
    const newArgs = { ...args, bold: !bold };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const toggleItalic = () => {
    const newArgs = { ...args, italic: !italic };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const applyText = () => {
    if (text && rect) {
      createLayerFromTool({ toolName: 'text', args });
      clearOverlay();
    }
  };

  const clear = () => {
    onChange({ ...args, text: '', rect: null });
  };

  // useEffect(() => {
  //   // TOFO this wont work when savoing the image
  //   return applyText;
  // }, []);

  return (
    <div className="flex flex-row items-center gap-4 h-full">
      <div className="flex flex-col">
        <label htmlFor="text-input" className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
          Text
        </label>
        <textarea
          ref={textareaRef}
          id="text-input"
          value={text}
          onChange={handleTextChange}
          placeholder="Enter text..."
          rows={1}
          className="rounded border border-gray-400 bg-white px-2 py-0.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-300 dark:bg-white dark:text-gray-900 w-32"
        />
      </div>

      <div className="flex flex-col">
        <label htmlFor="font-family-select" className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
          Font
        </label>
        <div className="w-32 h-6 flex items-center">
          <FontSelect value={fontFamily} onChange={handleFontFamilyChange} />
        </div>
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="font-size-slider"
          className="flex justify-between text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Size
          <span className="font-bold text-gray-900 dark:text-gray-200">{fontSize}px</span>
        </label>
        <input
          id="font-size-slider"
          type="range"
          min="8"
          max="500"
          value={fontSize}
          onChange={handleFontSizeChange}
          className="h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="line-height-slider"
          className="flex justify-between text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          L.Height
          <span className="font-bold text-gray-900 dark:text-gray-200">{lineHeight.toFixed(1)}</span>
        </label>
        <input
          id="line-height-slider"
          type="range"
          min="0.5"
          max="2.25"
          step="0.05"
          value={lineHeight}
          onChange={handleLineHeightChange}
          className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label htmlFor="align-select" className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
          Align
        </label>
        <select
          id="align-select"
          value={align}
          onChange={handleAlignChange}
          className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <div className="flex gap-1 h-6 self-end mb-1">
        <button
          className={`w-6 flex items-center justify-center rounded border text-xs transition-colors focus:outline-none ${
            bold
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'
          }`}
          onClick={toggleBold}
          title="Bold"
        >
          B
        </button>
        <button
          className={`w-6 flex items-center justify-center rounded border text-xs transition-colors focus:outline-none ${
            italic
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'
          }`}
          onClick={toggleItalic}
          title="Italic"
        >
          I
        </button>
      </div>

      <div className="flex gap-2 h-8 self-end mb-1 ml-2">
        <button
          className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none disabled:opacity-50"
          disabled={!text || !rect}
          onClick={applyText}
        >
          Apply
        </button>
        <button
          className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          disabled={!text || !rect}
          onClick={clear}
        >
          Clear
        </button>
      </div>
    </div>
  );
};

export default Text;
