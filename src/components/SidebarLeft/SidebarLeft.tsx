import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';

const SidebarLeft = () => {
  const [{ hasImage, toolName }] = useStore();
  const { goToTool } = useApp();

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

  return (
    <aside className="bg-gray-100 dark:bg-gray-800 dark:border-r dark:border-gray-700 max-md:hidden [grid-area:left]">
      <div className="p-3">
        <h5 className="mb-3 text-lg font-bold dark:text-gray-200">Toolbox</h5>
        <ul className="flex flex-col list-none p-0">
          <li className="mb-1">
            <button
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                toolName === 'reposition'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'color'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'blur'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'levels'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'transform'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'crop'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'draw'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'shape'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
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
                toolName === 'text'
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-gray-700'
              } disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent dark:disabled:text-gray-600`}
              disabled={!hasImage}
              onClick={handleText}
            >
              Text
            </button>
          </li>
        </ul>

        <hr className="my-3 border-gray-300 dark:border-gray-700" />
        {/*<Zoom />*/}
      </div>
    </aside>
  );
};

export default SidebarLeft;
