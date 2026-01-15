import { useContext, useEffect, useState } from 'react';

import { ImageContext, type InteractionMode } from '../../contexts/ImageContext.tsx';
import Zoom from '../Zoom/Zoom.tsx';

const SidebarLeft = () => {
  const { originalImage, startEmptyTool, toolName, interactionMode, setInteractionMode } = useContext(ImageContext);
  const [prevInteractionMode, setPrevInteractionMode] = useState<InteractionMode>(interactionMode);

  useEffect(() => {
    setPrevInteractionMode(interactionMode);
  }, [toolName]);

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

  const handleDraw = () => {
    startEmptyTool('draw');
  };

  return (
    <aside className="bg-gray-100 max-md:hidden [grid-area:left]">
      <div className="p-3">
        <h5 className="mb-3 text-lg font-bold">Toolbox</h5>
        <ul className="flex flex-col list-none p-0">
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'colors' ? 'bg-blue-600 text-white' : 'text-blue-600 hover:bg-blue-50'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent`}
              disabled={!originalImage}
              onClick={handleColors}
            >
              Colors
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'blur' ? 'bg-blue-600 text-white' : 'text-blue-600 hover:bg-blue-50'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent`}
              disabled={!originalImage}
              onClick={handleBlur}
            >
              Blur
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'levels' ? 'bg-blue-600 text-white' : 'text-blue-600 hover:bg-blue-50'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent`}
              disabled={!originalImage}
              onClick={handleLevels}
            >
              Levels
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'transform' || toolName === 'crop'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent`}
              disabled={!originalImage}
              onClick={handleTransform}
            >
              Crop & Transform
            </button>
          </li>
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'draw' ? 'bg-blue-600 text-white' : 'text-blue-600 hover:bg-blue-50'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent`}
              disabled={!originalImage}
              onClick={handleDraw}
            >
              Draw
            </button>
          </li>
        </ul>

        <hr className="my-3 border-gray-300" />
        <Zoom />
      </div>
    </aside>
  );
};

export default SidebarLeft;
