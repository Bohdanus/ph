import { useState, useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext';
import { useTheme } from '../../contexts/ThemeContext';
import HistoryControls from '../HistoryControls/HistoryControls';

const MobileMenu = () => {
  const { startEmptyTool, openLoadImageDialog, openSaveImageDialog } = useContext(ImageContext);
  const { theme, toggleTheme } = useTheme();
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleSection = (sectionId: string) => {
    setOpenSection(openSection === sectionId ? null : sectionId);
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const handleColors = () => {
    startEmptyTool('colors');
    closeMenu();
  };

  const handleBlur = () => {
    startEmptyTool('blur');
    closeMenu();
  };

  const handleLevels = () => {
    startEmptyTool('levels');
    closeMenu();
  };

  const handleTransform = () => {
    startEmptyTool('transform');
    closeMenu();
  };

  const handleDraw = () => {
    startEmptyTool('draw');
    closeMenu();
  };

  const handleText = () => {
    startEmptyTool('text');
    closeMenu();
  };

  const handleOpenClick = () => {
    closeMenu();
    openLoadImageDialog();
  };

  const handleSaveClick = () => {
    closeMenu();
    openSaveImageDialog();
  };

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[1030] flex h-[50px] items-center justify-between bg-[#212529] px-2 md:hidden dark:bg-gray-950">
        <div className="flex items-center">
          <button
            className="bg-transparent border-0 p-2 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={toggleMenu}
            aria-label="Toggle navigation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
              <path
                fillRule="evenodd"
                d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"
              />
            </svg>
          </button>
          <button
            className="bg-transparent p-2 text-white opacity-75 hover:opacity-100"
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
        </div>
        <HistoryControls />
      </div>

      {/* Backdrop */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[1040] bg-black bg-opacity-50 transition-opacity" onClick={closeMenu} />
      )}

      {/* Offcanvas Sidebar */}
      <div
        className={`fixed top-0 left-0 z-[1045] h-full w-[300px] max-w-full transform bg-white transition-transform duration-300 ease-in-out dark:bg-gray-800 ${
          isMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between bg-[#212529] px-4 py-3 text-white dark:bg-gray-950">
          <h5 className="m-0 text-xl font-medium">Logo</h5>
          <button
            type="button"
            className="box-content h-4 w-4 rounded-none border-none p-1 text-white opacity-50 hover:opacity-100 focus:outline-none"
            onClick={closeMenu}
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M.293.293a1 1 0 0 1 1.414 0L8 6.586 14.293.293a1 1 0 1 1 1.414 1.414L9.414 8l6.293 6.293a1 1 0 0 1-1.414 1.414L8 9.414l-6.293 6.293a1 1 0 0 1-1.414-1.414L6.586 8 .293 1.707a1 1 0 0 1 0-1.414z" />
            </svg>
          </button>
        </div>
        <div className="flex-grow overflow-y-auto">
          <div className="flex flex-col">
            {/* File Section */}
            <div className="border-b border-gray-200 dark:border-gray-700">
              <button
                className="flex w-full items-center justify-between bg-[#e1e1e1] px-4 py-3 text-left font-medium text-black dark:bg-gray-700 dark:text-gray-200"
                type="button"
                onClick={() => toggleSection('file')}
              >
                File
                <svg
                  className={`h-4 w-4 transform transition-transform ${openSection === 'file' ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {openSection === 'file' && (
                <ul className="m-0 list-none p-0 bg-transparent">
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleOpenClick}
                    >
                      Open
                    </button>
                  </li>
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleSaveClick}
                    >
                      Save
                    </button>
                  </li>
                </ul>
              )}
            </div>

            {/* Edit Section */}
            <div className="border-b border-gray-200 dark:border-gray-700">
              <button
                className="flex w-full items-center justify-between bg-[#e1e1e1] px-4 py-3 text-left font-medium text-black dark:bg-gray-700 dark:text-gray-200"
                type="button"
                onClick={() => toggleSection('edit')}
              >
                Edit
                <svg
                  className={`h-4 w-4 transform transition-transform ${openSection === 'edit' ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {openSection === 'edit' && (
                <ul className="m-0 list-none p-0 bg-transparent">
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleColors}
                    >
                      Colors
                    </button>
                  </li>
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleBlur}
                    >
                      Blur
                    </button>
                  </li>
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleLevels}
                    >
                      Levels
                    </button>
                  </li>
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleTransform}
                    >
                      Transform
                    </button>
                  </li>
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleDraw}
                    >
                      Draw
                    </button>
                  </li>
                  <li className="border-0">
                    <button
                      className="block w-full px-8 py-3 text-left text-gray-800 no-underline hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                      onClick={handleText}
                    >
                      Text
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
          <hr className="my-4 border-gray-300 dark:border-gray-700" />
        </div>
      </div>
    </>
  );
};

export default MobileMenu;
