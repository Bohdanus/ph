import { useContext } from 'react';

import { ImageContext } from '../../contexts/ImageContext.tsx';
import Zoom from '../Zoom/Zoom.tsx';

const SidebarLeft = () => {
  const { originalImage, startEmptyTool, toolName } = useContext(ImageContext);

  const handleColors = () => {
    startEmptyTool('colors');
  };

  const handleBlur = () => {
    startEmptyTool('blur');
  };

  const handleLevels = () => {
    startEmptyTool('levels');
  };

  const handleTransform = () => {
    startEmptyTool('transform');
  };

  const handleCrop = () => {
    startEmptyTool('crop');
  };

  const handleDraw = () => {
    startEmptyTool('draw');
  };

  const handleText = () => {
    startEmptyTool('text');
  };

  return (
    <aside className="bg-gray-100 dark:bg-gray-800 dark:border-r dark:border-gray-700 max-md:hidden [grid-area:left]">
      <div className="p-3">
        <h5 className="mb-3 text-lg font-bold dark:text-gray-200">Toolbox</h5>
        <ul className="flex flex-col list-none p-0">
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'colors'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!originalImage}
              onClick={handleColors}
            >
              Colors
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'blur'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!originalImage}
              onClick={handleBlur}
            >
              Blur
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'levels'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!originalImage}
              onClick={handleLevels}
            >
              Levels
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'transform'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!originalImage}
              onClick={handleTransform}
            >
              Transform
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'crop'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!originalImage}
              onClick={handleCrop}
            >
              Crop
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'draw'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!originalImage}
              onClick={handleDraw}
            >
              Draw
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'text'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!originalImage}
              onClick={handleText}
            >
              Text
            </button>
          </li>
        </ul>

        <hr className="my-3 border-gray-300 dark:border-gray-700" />
        <Zoom />
      </div>
    </aside>
  );
};

export default SidebarLeft;
