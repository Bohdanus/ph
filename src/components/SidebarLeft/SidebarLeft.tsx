import { type ChangeEvent, type RefObject, useRef } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { TOOLBAR_MENU_BUTTON_ACTIVE, TOOLBAR_MENU_BUTTON_INACTIVE } from '../ToolbarsRight/buttonStyles.ts';

const SidebarLeft = () => {
  const [{ hasImage, toolName, color, backgroundColor }, dispatch] = useStore();
  const { goToTool } = useApp();

  const colorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const colorSquareRef = useRef<HTMLDivElement>(null);
  const bgColorSquareRef = useRef<HTMLDivElement>(null);

  const handleMove = () => {
    goToTool('reposition');
  };

  const handleColors = () => {
    goToTool('color');
  };

  const handleBlur = () => {
    goToTool('blur');
  };

  const handleLevels = () => {
    goToTool('levels');
  };

  const handleTransform = () => {
    goToTool('transform');
  };

  const handleCrop = () => {
    goToTool('crop');
  };

  const handleDraw = () => {
    goToTool('draw');
  };

  const handleShapes = () => {
    goToTool('shape');
  };

  const handleText = () => {
    goToTool('text');
  };

  const handleColorClick = (e: React.MouseEvent<HTMLDivElement>, inputRef: RefObject<HTMLInputElement | null>) => {
    if (!inputRef.current) return;

    const parentRect = e.currentTarget.parentElement!.getBoundingClientRect();
    const squareRect = e.currentTarget.getBoundingClientRect();
    const offsetX = squareRect.left - parentRect.left;
    const offsetY = squareRect.top - parentRect.top;
    inputRef.current.style.left = `${offsetX}px`;
    inputRef.current.style.top = `${offsetY + 5}px`;
    inputRef.current.click();
  };

  const handleColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_COLOR', payload: e.target.value });
  };

  const handleBgColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_BACKGROUND_COLOR', payload: e.target.value });
  };

  const handleSwapColors = () => {
    dispatch({ type: 'SET_COLOR', payload: backgroundColor });
    dispatch({ type: 'SET_BACKGROUND_COLOR', payload: color });
  };

  if (!hasImage) return;

  return (
    <aside className="bg-gray-100 dark:bg-gray-800 dark:border-r dark:border-gray-700 max-md:hidden [grid-area:left]">
      <div className="p-3">
        <ul className="flex flex-col list-none p-0">
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'reposition' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleMove}
            >
              Select & Move
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'color' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleColors}
            >
              Colors
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'blur' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleBlur}
            >
              Blur
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'levels' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleLevels}
            >
              Levels
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'transform' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleTransform}
            >
              Transform
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'crop' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleCrop}
            >
              Crop
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'draw' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleDraw}
            >
              Draw
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'shape' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleShapes}
            >
              Shapes
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'text' ? TOOLBAR_MENU_BUTTON_ACTIVE : TOOLBAR_MENU_BUTTON_INACTIVE
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleText}
            >
              Text
            </button>
          </li>
        </ul>
        <hr className="my-3 border-gray-300 dark:border-gray-700" />

        <div className="flex flex-col items-center mt-4">
          <div className="relative w-14 h-14">
            <div
              className="absolute top-4 left-4 w-8 h-8 cursor-pointer rounded border border-gray-400 dark:border-gray-500 shadow-sm"
              style={{ backgroundColor }}
              onClick={(e) => handleColorClick(e, bgColorInputRef)}
              title="Background Color"
              ref={bgColorSquareRef}
            />
            <div
              className="absolute top-0 left-0 w-8 h-8 cursor-pointer rounded border border-gray-400 dark:border-gray-500 shadow-md"
              style={{ backgroundColor: color }}
              onClick={(e) => handleColorClick(e, colorInputRef)}
              title="Foreground Color"
              ref={colorSquareRef}
            />

            <input
              type="color"
              ref={colorInputRef}
              className="absolute opacity-0 pointer-events-none"
              value={color}
              onChange={handleColorChange}
            />
            <input
              type="color"
              ref={bgColorInputRef}
              className="absolute opacity-0 pointer-events-none"
              value={backgroundColor}
              onChange={handleBgColorChange}
            />
          </div>

          <button
            onClick={handleSwapColors}
            className="mt-1 text-[8px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 uppercase font-bold"
            title="Swap Colors"
          >
            ⇅ Swap
          </button>
        </div>

        <hr className="my-3 border-gray-300 dark:border-gray-700" />
        {/*<Zoom />*/}
      </div>
    </aside>
  );
};

export default SidebarLeft;
