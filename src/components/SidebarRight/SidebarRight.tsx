import '../SidebarLeft/Sidebar.scss';
import { useContext } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';
import { toolsMap } from '../../tools/toolsMap.ts';

const SidebarRight = () => {
  const { originalImage, toolName, toolArgs, updateLastHistoryItem } = useContext(ImageContext);
  if (!toolName || !toolArgs || !originalImage) {
    // todo UNDERSTAND THIS
    return (
      <aside className="sidebar sidebar-right d-none d-md-block">
        <div className="p-3"></div>
      </aside>
    );
  }

  const args = { ...toolArgs };
  const Component = toolsMap[toolName].toolboxComponent;

  return (
    <aside className="sidebar sidebar-right d-none d-md-block">
      <div className="p-3">
        <ul className="nav flex-column">
          <li className="nav-item">
            <Component args={args} onChange={updateLastHistoryItem} />
          </li>
        </ul>
      </div>
    </aside>
  );
};

export default SidebarRight;
