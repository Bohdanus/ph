import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import HistoryControls from '../HistoryControls/HistoryControls';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { MENU_ITEM_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useLayers } from '../../contexts/useLayer.ts';
import { flushSync } from 'react-dom';
import { hasPendingText } from '../../util/typeGuards.ts';
import type { ToolName } from '../../contexts/tool-types.ts';

const TOOL_MENU_ITEMS: Array<{ toolName: ToolName; label: string }> = [
  { toolName: 'reposition', label: 'Reposition' },
  { toolName: 'color', label: 'Colors' },
  { toolName: 'blur', label: 'Blur' },
  { toolName: 'levels', label: 'Levels' },
  { toolName: 'transform', label: 'Transform' },
  { toolName: 'crop', label: 'Crop' },
  { toolName: 'draw', label: 'Draw' },
  { toolName: 'shape', label: 'Shape' },
  { toolName: 'text', label: 'Text' },
  { toolName: 'polygonal-lasso', label: 'Polygonal Lasso' },
  { toolName: 'freehand-lasso', label: 'Freehand Lasso' },
  { toolName: 'feather-magnetic-lasso', label: 'Feather Magnetic Lasso' },
  { toolName: 'magic-wand', label: 'Magic Wand' },
  { toolName: 'rectangular-selection', label: 'Rectangular Selection' },
  { toolName: 'brush', label: 'Brush Tool' },
  { toolName: 'pencil', label: 'Pencil Tool' },
  { toolName: 'color-replacement', label: 'Color Replacement Tool' },
  { toolName: 'pen', label: 'Pen Tool' },
  { toolName: 'freeform-pen', label: 'Freeform Pen Tool' },
  { toolName: 'curvature-pen', label: 'Curvature Pen Tool' },
  { toolName: 'rectangle', label: 'Rectangle Tool' },
  { toolName: 'ellipse', label: 'Ellipse Tool' },
  { toolName: 'triangle', label: 'Triangle Tool' },
  { toolName: 'polygon', label: 'Polygon Tool' },
  { toolName: 'line', label: 'Line Tool' },
  { toolName: 'custom-shape', label: 'Custom Shape Tool' },
];

const DesktopHeader = () => {
  const [{ canvasRef, currentArgs, fileName, hasUnsavedChanges, totalSize, documentFrame, hasImage }] = useStore();
  const { commitDirtyTool } = useLayers();
  const { goToTool, setBlankImage, setImageFromUpload, handleImageSave } = useApp();
  const { openNewImageDialog, openLoadImageDialog, openSaveImageDialog } = useFile();

  const { theme, toggleTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileMenuRef = useRef<HTMLLIElement>(null);
  const toolsMenuRef = useRef<HTMLLIElement>(null);
  const editMenuRef = useRef<HTMLLIElement>(null);

  const handleToolSelection = (toolName: ToolName) => {
    goToTool(toolName);
    setOpenMenu(null);
  };

  const handleColors = () => handleToolSelection('color');

  const handleBlur = () => handleToolSelection('blur');

  const handleLevels = () => handleToolSelection('levels');

  const handleTransform = () => handleToolSelection('transform');

  const handleDraw = () => handleToolSelection('draw');

  const handleText = () => handleToolSelection('text');

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (openMenu === 'file' && fileMenuRef.current && !fileMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
      if (openMenu === 'tools' && toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
      if (openMenu === 'edit' && editMenuRef.current && !editMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    },
    [openMenu]
  );

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleClickOutside]);

  return (
    <header className="flex h-[50px] items-center bg-[#212529] px-3 max-md:hidden [grid-area:header] dark:bg-gray-950">
      <ul className="mr-auto flex list-none items-center p-0">
        <li className="relative" ref={fileMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
            data-testid="header-file-menu-button"
          >
            File
          </button>
          {openMenu === 'file' && (
            <ul className="absolute left-0 top-full z-10 m-0 min-w-[160px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800">
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    try {
                      if (
                        hasUnsavedChanges ||
                        confirm('All unsaved changes to current image will be lost. Continue?.')
                      ) {
                        const data = await openNewImageDialog();
                        if (data) setBlankImage(data);
                      }
                      setOpenMenu(null);
                    } catch (error) {
                      console.error('Unable to create document', error);
                      window.alert(
                        `Failed to create document: ${error instanceof Error ? error.message : String(error)}`
                      );
                    }
                  }}
                  data-testid="header-file-new-button"
                >
                  New
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    try {
                      if (
                        (hasUnsavedChanges || hasPendingText(currentArgs.current)) &&
                        !confirm('Discard unsaved changes and open another file?')
                      )
                        return;
                      const data = await openLoadImageDialog();
                      if (data) await setImageFromUpload(data);
                      setOpenMenu(null);
                    } catch (error) {
                      console.error('Unable to open document', error);
                      window.alert(
                        `Failed to open document: ${error instanceof Error ? error.message : String(error)}`
                      );
                    }
                  }}
                  data-testid="header-file-open-button"
                >
                  Open
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    try {
                      if (!hasImage || !canvasRef.current) return;
                      let exportLayers!: ReturnType<typeof commitDirtyTool>;
                      flushSync(() => {
                        exportLayers = commitDirtyTool();
                      });
                      const data = await openSaveImageDialog({
                        canvas: canvasRef.current,
                        fileName,
                        layers: exportLayers,
                        size: totalSize,
                        documentFrame,
                      });
                      if (data) handleImageSave(data);
                      setOpenMenu(null);
                    } catch (error) {
                      console.error('Unable to prepare document export', error);
                      window.alert(
                        `Failed to prepare export: ${error instanceof Error ? error.message : String(error)}`
                      );
                    }
                  }}
                  data-testid="header-file-save-button"
                >
                  Save
                </button>
              </li>
            </ul>
          )}
        </li>
        <li className="relative" ref={toolsMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => setOpenMenu(openMenu === 'tools' ? null : 'tools')}
            data-testid="header-tools-menu-button"
          >
            Tools
          </button>
          {openMenu === 'tools' && (
            <ul className="absolute left-0 top-full z-10 m-0 min-w-[200px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800">
              {TOOL_MENU_ITEMS.map(({ toolName, label }) => (
                <li key={toolName}>
                  <button
                    className={MENU_ITEM_BUTTON}
                    type="button"
                    onClick={() => handleToolSelection(toolName)}
                    data-testid={`tools-menu-${toolName}-button`}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
        <li className="relative" ref={editMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
            data-testid="header-edit-menu-button"
          >
            Edit
          </button>
          {openMenu === 'edit' && (
            <ul className="absolute left-0 top-full z-10 m-0 min-w-[160px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800">
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleColors}
                  data-testid="edit-menu-colors-button"
                >
                  Colors
                </button>
              </li>
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleBlur}
                  data-testid="edit-menu-blur-button"
                >
                  Blur
                </button>
              </li>
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleLevels}
                  data-testid="edit-menu-levels-button"
                >
                  Levels
                </button>
              </li>
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleTransform}
                  data-testid="edit-menu-transform-button"
                >
                  Transform
                </button>
              </li>
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleDraw}
                  data-testid="edit-menu-draw-button"
                >
                  Draw
                </button>
              </li>
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleText}
                  data-testid="edit-menu-text-button"
                >
                  Text
                </button>
              </li>
            </ul>
          )}
        </li>
      </ul>
      <div className="ml-auto flex items-center gap-4">
        <button
          className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          data-testid="theme-toggle-button"
        >
          {theme === 'light' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708" />
            </svg>
          )}
        </button>
        <HistoryControls />
      </div>
    </header>
  );
};

export default DesktopHeader;
