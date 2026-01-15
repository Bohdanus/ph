import { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';
import { toolsMap } from '../../tools/toolsMap.ts';

const SidebarRight = () => {
  const { originalImage, toolName, toolArgs, updateLastHistoryItem } = useContext(ImageContext);
  if (!toolName || !toolArgs || !originalImage) {
    // todo UNDERSTAND THIS
    return (
      <aside className="bg-gray-100 max-md:hidden [grid-area:right]">
        <div className="p-3"></div>
      </aside>
    );
  }

  const args = { ...toolArgs };
  const Component = toolsMap[toolName].toolboxComponent;

  return (
    <aside className="bg-gray-100 max-md:hidden [grid-area:right]">
      <div className="p-3">
        <ul className="flex flex-col list-none p-0">
          <li className="mb-2">
            <Component args={args} onChange={updateLastHistoryItem} />
          </li>
        </ul>
      </div>
    </aside>
  );
};

export default SidebarRight;
