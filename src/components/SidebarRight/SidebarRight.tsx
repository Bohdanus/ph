import { useState } from 'react';
import { toolsMap } from '../../tools/toolsMap.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import LayersTab from './LayersTab.tsx';
import HistoryTab from './HistoryTab.tsx';

type TabType = 'Tool' | 'History' | 'Layers';

const SidebarRight = () => {
  const [{ hasImage, toolName }] = useStore();

  const [activeTab, setActiveTab] = useState<TabType>('Tool');

  if (!toolName || !hasImage) {
    return (
      <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right]">
        <div className="p-3"></div>
      </aside>
    );
  }

  const ToolComponent = toolsMap[toolName].toolboxComponent;
  const tabs: TabType[] = ['Tool', 'History', 'Layers'];

  return (
    <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right] flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-gray-300 dark:border-gray-600 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-3 flex-1 overflow-hidden min-h-0">
        {activeTab === 'Tool' && (
          <ul className="flex flex-col list-none p-0 h-full overflow-y-auto">
            <li className="mb-2">
              <ToolComponent key={toolName} />
            </li>
          </ul>
        )}

        {activeTab === 'History' && <HistoryTab />}

        {activeTab === 'Layers' && <LayersTab />}
      </div>
    </aside>
  );
};

export default SidebarRight;
