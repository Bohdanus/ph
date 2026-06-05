import { useState, useContext, useRef, useEffect } from 'react';
import { useFloating, offset, flip, shift, arrow } from '@floating-ui/react';
import { ImageContext } from '../../contexts/ImageContext.tsx';
import { useState } from 'react';
import { toolsMap } from '../../tools/toolsMap.ts';
import { useStore } from '../../contexts/StoreContext.tsx';

type TabType = 'Tool' | 'History' | 'Layers';

const SidebarRight = () => {
  const { originalImage, toolName, setToolArgs, historyLength, goToHistoryIndex, history } = useContext(ImageContext);
  const [{ hasImage, toolName }] = useStore();

  const [activeTab, setActiveTab] = useState<TabType>('Tool');

  if (!toolName || !originalImage) {
    // todo UNDERSTAND THIS
    if (!toolName || !hasImage) {
      return (
        <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right]">
          <div className="p-3"></div>
        </aside>
      );
    }

    const Component = toolsMap[toolName].toolboxComponent;
    const tabs: TabType[] = ['Tool', 'History', 'Layers'];
    const tabs: TabType[] = ['Tool', 'Layers'];

    return (
      <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right]">
        <div className="flex border-b border-gray-300 dark:border-gray-600">
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
        <div className="p-3">
          {activeTab === 'Tool' && (
            <ul className="flex flex-col list-none p-0">
              <li className="mb-2">
                <Component key={toolName} onChange={setToolArgs} />
                <Component key={toolName} />
              </li>
            </ul>
          )}
          {activeTab === 'History' && (
            <>
              <div className="flex flex-col gap-2">
                {history.map((historyItem, index) => (
                  <button
                    key={index}
                    style={{
                      opacity: index >= historyLength ? 0.3 : 1,
                    }}
                    onClick={() => goToHistoryIndex(index)}
                    className={`px-3 py-2 text-sm text-left rounded transition-colors ${
                      index === historyLength - 1
                        ? 'bg-blue-500 text-white font-medium'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {index + 1}. {index === 0 ? 'init' : historyItem.toolName}
                  </button>
                ))}
              </div>
            </>
          )}
          {activeTab === 'Layers' && <div>Layers content</div>}
        </div>
      </aside>
    );
  };

  export default SidebarRight;

