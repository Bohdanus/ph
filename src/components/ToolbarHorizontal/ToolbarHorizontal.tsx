import { toolsMap } from '../../tools/toolsMap.ts';
import { useStore } from '../../contexts/StoreContext.tsx';

const ToolbarHorizontal = () => {
  const [{ hasImage, toolName }] = useStore();

  if (!toolName || !hasImage) {
    return (
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 h-[50px] [grid-area:toolbar] max-md:hidden"></div>
    );
  }

  const ToolComponent = toolsMap[toolName].toolboxComponent;

  return (
    <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 h-[50px] [grid-area:toolbar] max-md:hidden flex items-center px-4 overflow-x-auto">
      <ToolComponent key={toolName} />
    </div>
  );
};

export default ToolbarHorizontal;
