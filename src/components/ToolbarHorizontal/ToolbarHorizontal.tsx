import { toolsMap } from '../../tools/toolsMap.ts';
import { useStore } from '../../contexts/StoreContext.tsx';

const ToolbarHorizontal = () => {
  const [{ hasImage, toolName }] = useStore();

  if (!toolName || !hasImage) {
    return (
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 h-[50px] [grid-area:toolbar] max-md:hidden"></div>
    );
  }

  const ToolComponent = toolsMap[toolName]?.toolboxComponent;

  if (!ToolComponent) {
    return (
      <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 h-[50px] [grid-area:toolbar] max-md:hidden flex items-center px-4 overflow-visible">
        <span className="text-xs text-amber-700 dark:text-amber-300">TODO: unregistered tool placeholder</span>
      </div>
    );
  }

  return (
    <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 h-[50px] [grid-area:toolbar] max-md:hidden flex items-center px-4 overflow-visible">
      <ToolComponent key={toolName} />
    </div>
  );
};

export default ToolbarHorizontal;
