import React, { type ChangeEvent, useContext } from 'react';
import type { TextToolArgs } from '../../../tools/text.ts';
import { ImageContext, type UpdateHistoryFn } from '../../../contexts/ImageContext.tsx';

interface TextToolbarProps {
  args: TextToolArgs;
  onChange: (params: UpdateHistoryFn) => void;
}

const Text: React.FC<TextToolbarProps> = ({ args, onChange }) => {
  const { textareaRef } = useContext(ImageContext);

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    onChange({ args: { ...args, text }, dryRun: true });
  };

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fontSize = Number(event.target.value);
    onChange({ args: { ...args, fontSize }, dryRun: true });
  };

  const handleFontFamilyChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const fontFamily = event.target.value;
    onChange({ args: { ...args, fontFamily }, dryRun: true });
  };

  const handleColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    const color = event.target.value;
    onChange({ args: { ...args, color }, dryRun: true });
  };

  const handleAlignChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const align = event.target.value as 'left' | 'center' | 'right';
    onChange({ args: { ...args, align }, dryRun: true });
  };

  const toggleBold = () => {
    onChange({ args: { ...args, bold: !args.bold }, dryRun: true });
  };

  const toggleItalic = () => {
    onChange({ args: { ...args, italic: !args.italic }, dryRun: true });
  };

  const applyText = () => {
    onChange({ args: { ...args } });
  };

  const { text, fontSize, fontFamily, color, align, bold, italic, rect } = args;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
        <p className="mb-1 font-semibold">How to use:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>Click on the canvas to set text position</li>
          <li>Start typing (you can also use text input below)</li>
          <li>Press Enter for new line</li>
          <li>Press Escape to cancel</li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="text-input" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Text
        </label>
        <textarea
          ref={textareaRef}
          id="text-input"
          value={text}
          onChange={handleTextChange}
          placeholder="Enter text here..."
          rows={3}
          className="w-full rounded border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-300 dark:bg-white dark:text-gray-900 dark:placeholder-gray-500"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="font-size-slider"
          className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300"
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
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="font-family-select" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Font Family
        </label>
        <select
          id="font-family-select"
          value={fontFamily}
          onChange={handleFontFamilyChange}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="Arial">Arial</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Verdana">Verdana</option>
          <option value="Georgia">Georgia</option>
          <option value="Palatino">Palatino</option>
          <option value="Garamond">Garamond</option>
          <option value="Comic Sans MS">Comic Sans MS</option>
          <option value="Impact">Impact</option>
          <option value="Trebuchet MS">Trebuchet MS</option>
          <option value="Tahoma">Tahoma</option>
          <option value="Brush Script MT">Brush Script MT</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="text-color-picker" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Color
        </label>
        <input
          id="text-color-picker"
          type="color"
          value={color}
          onChange={handleColorChange}
          className="h-10 w-full cursor-pointer rounded border border-gray-300 p-1 dark:border-gray-600 dark:bg-gray-700"
        />
      </div>

      <div className="flex gap-2">
        <button
          className={`flex flex-1 items-center justify-center rounded border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            bold
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
          }`}
          onClick={toggleBold}
        >
          <strong>Bold</strong>
        </button>
        <button
          className={`flex flex-1 items-center justify-center rounded border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            italic
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
          }`}
          onClick={toggleItalic}
        >
          <em>Italic</em>
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="align-select" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Alignment
        </label>
        <select
          id="align-select"
          value={align}
          onChange={handleAlignChange}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <hr className="my-2 border-gray-300 dark:border-gray-700" />

      <button
        className="w-full rounded bg-blue-600 px-4 py-2 font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!(text && rect)}
        onClick={applyText}
      >
        Apply
      </button>
    </div>
  );
};

export default Text;
