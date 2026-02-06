import { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';
import { toolsMap } from '../../tools/toolsMap.ts';

const SidebarRight = () => {
  const { originalImage, toolName, setToolArgs } = useContext(ImageContext);
  if (!toolName || !originalImage) {
    // todo UNDERSTAND THIS
    return (
      <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right]">
        <div className="p-3"></div>
      </aside>
    );
  }

  const Component = toolsMap[toolName].toolboxComponent;

  return (
    <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right]">
      <div className="p-3">
        <ul className="flex flex-col list-none p-0">
          <li className="mb-2">
            <Component key={toolName} onChange={setToolArgs} />
          </li>
        </ul>
      </div>
    </aside>
  );
};

export default SidebarRight;
