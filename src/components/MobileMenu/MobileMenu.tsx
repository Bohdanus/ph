import { useState, useContext } from 'react';

import { ImageContext } from '../../contexts/ImageContext';
import HistoryControls from '../HistoryControls/HistoryControls';

const MobileMenu = () => {
  const { startEmptyTool, openLoadImageDialog, openSaveImageDialog } = useContext(ImageContext);
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
      <div className="fixed top-0 left-0 right-0 z-[1030] flex h-[50px] items-center justify-between bg-[#212529] px-2 md:hidden">
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
        <HistoryControls />
      </div>

      {/* Backdrop */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[1040] bg-black bg-opacity-50 transition-opacity" onClick={closeMenu} />
      )}

      {/* Offcanvas Sidebar */}
      <div
        className={`fixed top-0 left-0 z-[1045] h-full w-[300px] max-w-full transform bg-white transition-transform duration-300 ease-in-out ${
          isMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between bg-[#212529] px-4 py-3 text-white">
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
            <div className="border-b border-gray-200">
              <button
                className="flex w-full items-center justify-between bg-[#e1e1e1] px-4 py-3 text-left font-medium text-black"
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
                    <a
                      className="block w-full px-8 py-3 text-gray-800 no-underline hover:bg-gray-100"
                      href="#"
                      onClick={handleOpenClick}
                    >
                      Open
                    </a>
                  </li>
                  <li className="border-0">
                    <a
                      className="block w-full px-8 py-3 text-gray-800 no-underline hover:bg-gray-100"
                      href="#"
                      onClick={handleSaveClick}
                    >
                      Save
                    </a>
                  </li>
                </ul>
              )}
            </div>

            {/* Edit Section */}
            <div className="border-b border-gray-200">
              <button
                className="flex w-full items-center justify-between bg-[#e1e1e1] px-4 py-3 text-left font-medium text-black"
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
                    <a
                      className="block w-full px-8 py-3 text-gray-800 no-underline hover:bg-gray-100"
                      href="#"
                      onClick={handleColors}
                    >
                      Colors
                    </a>
                  </li>
                  <li className="border-0">
                    <a
                      className="block w-full px-8 py-3 text-gray-800 no-underline hover:bg-gray-100"
                      href="#"
                      onClick={handleBlur}
                    >
                      Blur
                    </a>
                  </li>
                  <li className="border-0">
                    <a
                      className="block w-full px-8 py-3 text-gray-800 no-underline hover:bg-gray-100"
                      href="#"
                      onClick={handleLevels}
                    >
                      Levels
                    </a>
                  </li>
                  <li className="border-0">
                    <a
                      className="block w-full px-8 py-3 text-gray-800 no-underline hover:bg-gray-100"
                      href="#"
                      onClick={handleTransform}
                    >
                      Transform
                    </a>
                  </li>
                  <li className="border-0">
                    <a
                      className="block w-full px-8 py-3 text-gray-800 no-underline hover:bg-gray-100"
                      href="#"
                      onClick={handleDraw}
                    >
                      Draw
                    </a>
                  </li>
                </ul>
              )}
            </div>
          </div>
          <hr className="my-4 border-gray-300" />
        </div>
      </div>
    </>
  );
};

export default MobileMenu;
