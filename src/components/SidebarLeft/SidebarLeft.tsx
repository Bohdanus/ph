import { type ChangeEvent, type RefObject, useRef } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import type { ToolName } from '../../contexts/tool-types.ts';
import { toolIcons } from './toolIcons.tsx';

type SidebarTool = {
  label: string;
  name: ToolName;
  shortcut?: string;
};

const SIDEBAR_TOOLS = [
  { label: 'Select & Move', name: 'reposition', shortcut: 'V' },
  { label: 'Rectangular Selection', name: 'rectangular-selection', shortcut: 'M' },
  { label: 'Freehand Lasso', name: 'freehand-lasso', shortcut: 'L' },
  { label: 'Polygonal Lasso', name: 'polygonal-lasso' },
  { label: 'Feather Magnetic Lasso', name: 'feather-magnetic-lasso', shortcut: 'Shift+L' },
  { label: 'Magic Wand', name: 'magic-wand', shortcut: 'W' },
  { label: 'Crop', name: 'crop', shortcut: 'C' },
  { label: 'Draw', name: 'draw', shortcut: 'B' },
  { label: 'Shapes', name: 'shape', shortcut: 'U' },
  { label: 'Text', name: 'text', shortcut: 'T' },
  { label: 'Colors', name: 'color' },
  { label: 'Blur', name: 'blur' },
  { label: 'Levels', name: 'levels' },
  { label: 'Transform', name: 'transform' },
] satisfies SidebarTool[];

const TOOL_BUTTON_BASE_CLASS =
  'group relative flex h-11 w-11 items-center justify-center rounded-md border text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-200 dark:focus:ring-offset-gray-800';

const TOOL_BUTTON_ACTIVE_CLASS =
  'border-blue-500 bg-blue-100 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.45)] text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-100';

const TOOL_BUTTON_INACTIVE_CLASS =
  'border-gray-300 bg-gray-200/80 hover:border-gray-400 hover:bg-white dark:border-gray-700 dark:bg-gray-900/60 dark:hover:border-gray-500 dark:hover:bg-gray-700';

const SidebarLeft = () => {
  const [{ hasImage, toolName, color, backgroundColor }, dispatch] = useStore();
  const { goToTool } = useApp();

  const colorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const colorSquareRef = useRef<HTMLDivElement>(null);
  const bgColorSquareRef = useRef<HTMLDivElement>(null);

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
    <aside className="max-md:hidden border-r border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800 [grid-area:left]">
      <div className="flex h-full flex-col items-center px-3 py-4">
        <ul className="grid list-none grid-cols-2 gap-1.5 rounded-lg border border-gray-300 bg-gray-200/70 p-1.5 shadow-inner dark:border-gray-700 dark:bg-gray-950/35">
          {SIDEBAR_TOOLS.map(({ label, name, shortcut }) => {
            const Icon = toolIcons[name];
            const isSelected = toolName === name;
            const title = shortcut ? `${label} (${shortcut})` : label;

            return (
              <li key={name}>
                <button
                  aria-label={title}
                  aria-pressed={isSelected}
                  className={`${TOOL_BUTTON_BASE_CLASS} ${isSelected ? TOOL_BUTTON_ACTIVE_CLASS : TOOL_BUTTON_INACTIVE_CLASS}`}
                  disabled={!hasImage}
                  onClick={() => goToTool(name)}
                  title={title}
                  type="button"
                >
                  <Icon title={label} />
                  <span className="sr-only">{title}</span>
                </button>
              </li>
            );
          })}
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
