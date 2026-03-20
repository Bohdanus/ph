import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import HistoryControls from '../HistoryControls/HistoryControls';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';

const DesktopHeader = () => {
  const [{ canvasRef, fileName, hasUnsavedChanges }] = useStore();
  const { goToTool, setBlankImage, setImageFromUpload, handleImageSave } = useApp();
  const { openNewImageDialog, openLoadImageDialog, openSaveImageDialog } = useFile();

  const { theme, toggleTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const fileMenuRef = useRef<HTMLLIElement>(null);
  const editMenuRef = useRef<HTMLLIElement>(null);

  const handleColors = () => {
    goToTool('color');
    setOpenMenu(null);
  };

  const handleBlur = () => {
    goToTool('blur');
    setOpenMenu(null);
  };

  const handleLevels = () => {
    goToTool('levels');
    setOpenMenu(null);
  };

  const handleTransform = () => {
    goToTool('transform');
    setOpenMenu(null);
  };

  const handleDraw = () => {
    goToTool('draw');
    setOpenMenu(null);
  };

  const handleText = () => {
    goToTool('text');
    setOpenMenu(null);
  };

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (openMenu === 'file' && fileMenuRef.current && !fileMenuRef.current.contains(event.target as Node)) {
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
      <a className="mr-4 text-xl text-white no-underline" href="#">
        Logo
      </a>
      <ul className="mr-auto flex list-none items-center p-0">
        <li className="relative" ref={fileMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
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
                    if (hasUnsavedChanges || confirm('All unsaved changes to current image will be lost. Continue?.')) {
                      const data = await openNewImageDialog();
                      data && setBlankImage(data);
                      setOpenMenu(null);
                    }
                  }}
                >
                  New
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    const data = await openLoadImageDialog();
                    data && setImageFromUpload(data);
                    setOpenMenu(null);
                  }}
                >
                  Open
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    const data = await openSaveImageDialog({ canvas: canvasRef.current!, fileName });
                    data && handleImageSave(data);
                    setOpenMenu(null);
                  }}
                >
                  Save
                </button>
              </li>
            </ul>
          )}
        </li>
        <li className="relative" ref={editMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
          >
            Edit
          </button>
          {openMenu === 'edit' && (
            <ul className="absolute left-0 top-full z-10 m-0 min-w-[160px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800">
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={handleColors}
                >
                  Colors
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={handleBlur}
                >
                  Blur
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={handleLevels}
                >
                  Levels
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={handleTransform}
                >
                  Transform
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={handleDraw}
                >
                  Draw
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={handleText}
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
