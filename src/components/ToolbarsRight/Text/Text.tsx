import React, { type ChangeEvent, useEffect } from 'react';
import { calculateNewRect } from '../../../util/rect.ts';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { isTextToolArgs } from '../../../util/typeGuards.ts';
import FontSelect from './FontSelect.tsx';
import { PRIMARY_BUTTON, SECONDARY_BUTTON, TOGGLE_BUTTON_ACTIVE, TOGGLE_BUTTON_INACTIVE } from '../buttonStyles.ts';

const Text: React.FC<{}> = () => {
  const [{ canvasRef, color, currentArgs: currentArgsRef, textareaRef, totalSize }] = useStore();
  const { createLayerFromTool } = useLayers();
  const { toolArgs, setToolArgs: onChange } = useCurrentTool();

  useEffect(() => {
    if (isTextToolArgs(toolArgs)) {
      onChange({ ...toolArgs, color });
    }
  }, [color, toolArgs, onChange]);

  if (!isTextToolArgs(toolArgs)) {
    return null;
  }

  const {
    text = '',
    fontSize = 64,
    lineHeight = 1.1,
    rect = null,
    bold = false,
    italic = false,
    fontFamily = 'Arial',
    align = 'left',
  } = toolArgs;

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const textValue = event.target.value;
    const newArgs = { ...toolArgs, text: textValue };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fontSizeValue = Number(event.target.value);
    const newArgs = { ...toolArgs, fontSize: fontSizeValue };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleLineHeightChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newLineHeight = Number(event.target.value);
    const newArgs = { ...toolArgs, lineHeight: newLineHeight };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleFontFamilyChange = (fontFamilyValue: string) => {
    const newArgs = { ...toolArgs, fontFamily: fontFamilyValue };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const handleAlignChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const alignValue = event.target.value as 'left' | 'center' | 'right';
    const newArgs = { ...toolArgs, align: alignValue };
    onChange(newArgs);
  };

  const toggleBold = () => {
    const newArgs = { ...toolArgs, bold: !bold };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const toggleItalic = () => {
    const newArgs = { ...toolArgs, italic: !italic };
    const newRect = calculateNewRect(newArgs, canvasRef, totalSize);
    onChange({ ...newArgs, rect: newRect });
  };

  const applyText = () => {
    if (text && rect) {
      createLayerFromTool({ args: toolArgs });
      // This ref is intentionally mutated as part of the tool lifecycle, not during render.
      // eslint-disable-next-line react-compiler/react-compiler
      currentArgsRef.current = { ...toolArgs, text: '', rect: null };
      onChange({ ...toolArgs, text: '', rect: null });
    }
  };

  const clear = () => {
    onChange({ ...toolArgs, text: '', rect: null });
  };

  return (
    <div className="flex flex-row items-center gap-4 h-full">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <label htmlFor="text-input" className="text-[10px] mr-[-3px] font-medium text-gray-700 dark:text-gray-300">
            Text
          </label>
          <textarea
            ref={textareaRef}
            id="text-input"
            value={text}
            onChange={handleTextChange}
            placeholder="Enter text..."
            rows={2}
            className="rounded border border-gray-400 bg-white px-1 py-0.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-300 dark:bg-white dark:text-gray-900 w-52"
          />
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <label
            htmlFor="font-family-select"
            className="text-[10px] mr-[-3px] font-medium text-gray-700 dark:text-gray-300"
          >
            Font
          </label>
          <div className="w-32 flex items-center">
            <FontSelect value={fontFamily} onChange={handleFontFamilyChange} />
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="font-size-slider"
          className="flex mb-2 justify-between text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Font Size
          <span className="font-bold text-gray-900 dark:text-gray-200">{fontSize}px</span>
        </label>
        <input
          id="font-size-slider"
          type="range"
          min="8"
          max="500"
          value={fontSize}
          onChange={handleFontSizeChange}
          className="h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="line-height-slider"
          className="flex mb-2 justify-between text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Line Height
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
          className="h-1.5 w-21 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <label
            htmlFor="align-select"
            className="text-[10px] ml-2 mr-[-3px] font-medium text-gray-700 dark:text-gray-300"
          >
            Align
          </label>
          <select
            id="align-select"
            value={align}
            onChange={handleAlignChange}
            className="rounded border border-gray-300 bg-white px-1 h-9 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className={`w-9 h-9 flex items-center justify-center rounded border text-[20px] transition-colors focus:outline-none ${
            bold ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={toggleBold}
          title="Bold"
        >
          B
        </button>
        <button
          className={`w-9 h-9 flex items-center justify-center rounded border text-[20px] transition-colors focus:outline-none ${
            italic ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={toggleItalic}
          title="Italic"
        >
          I
        </button>
      </div>

      <div className="flex gap-2 ml-2">
        <button className={PRIMARY_BUTTON} disabled={!text || !rect} onClick={applyText}>
          Apply
        </button>
        <button className={SECONDARY_BUTTON} disabled={!text || !rect} onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
};

export default Text;
