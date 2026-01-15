import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext';
import HistoryControls from '../HistoryControls/HistoryControls';

const DesktopHeader = () => {
  const { startEmptyTool, openLoadImageDialog, openSaveImageDialog } = useContext(ImageContext);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const fileMenuRef = useRef<HTMLLIElement>(null);
  const editMenuRef = useRef<HTMLLIElement>(null);

  const handleColors = () => {
    startEmptyTool('colors');
    setOpenMenu(null);
  };

  const handleBlur = () => {
    startEmptyTool('blur');
    setOpenMenu(null);
  };

  const handleLevels = () => {
    startEmptyTool('levels');
    setOpenMenu(null);
  };

  const handleTransform = () => {
    startEmptyTool('transform');
    setOpenMenu(null);
  };

  const handleDraw = () => {
    startEmptyTool('draw');
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
    <header className="flex h-[50px] items-center bg-[#212529] px-3 max-md:hidden [grid-area:header]">
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
            <ul className="absolute left-0 top-full z-10 m-0 min-w-[160px] list-none rounded bg-white py-2 shadow-lg">
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100"
                  type="button"
                  onClick={() => {
                    openLoadImageDialog();
                    setOpenMenu(null);
                  }}
                >
                  Open
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100"
                  type="button"
                  onClick={() => {
                    openSaveImageDialog();
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
            <ul className="absolute left-0 top-full z-10 m-0 min-w-[160px] list-none rounded bg-white py-2 shadow-lg">
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100"
                  type="button"
                  onClick={handleColors}
                >
                  Colors
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100"
                  type="button"
                  onClick={handleBlur}
                >
                  Blur
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100"
                  type="button"
                  onClick={handleLevels}
                >
                  Levels
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100"
                  type="button"
                  onClick={handleTransform}
                >
                  Transform
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100"
                  type="button"
                  onClick={handleDraw}
                >
                  Draw
                </button>
              </li>
            </ul>
          )}
        </li>
      </ul>
      <div className="ml-auto flex items-center">
        <HistoryControls />
      </div>
    </header>
  );
};

export default DesktopHeader;
