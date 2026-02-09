import { useState, useContext, useRef, useEffect } from 'react';
import { ImageContext } from '../../contexts/ImageContext.tsx';
import { toolsMap } from '../../tools/toolsMap.ts';

type TabType = 'Tool' | 'History' | 'Layers';

const SidebarRight = () => {
  const { originalImage, toolName, setToolArgs, historyLength, goToHistoryIndex, getHistory } =
    useContext(ImageContext);
  const [activeTab, setActiveTab] = useState<TabType>('Tool');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const tooltipCanvasRef = useRef<HTMLCanvasElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  // Render bitmap to canvas when hovering
  useEffect(() => {
    if (hoveredIndex !== null && tooltipCanvasRef.current) {
      const history = getHistory();
      const historyItem = history[hoveredIndex];

      if (historyItem?.bitmap) {
        const canvas = tooltipCanvasRef.current;
        canvas.width = historyItem.bitmap.width;
        canvas.height = historyItem.bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(historyItem.bitmap, 0, 0);
        }

        // Calculate tooltip position based on hovered button
        if (historyButtonRef.current) {
          const rect = historyButtonRef.current.getBoundingClientRect();
          setTooltipPos({
            top: rect.top,
            left: rect.right + 10,
          });
        }
      }
    }
  }, [hoveredIndex, getHistory]);

  if (!toolName || !originalImage) {
    // todo UNDERSTAND THIS
    return (
      <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right]">
        <div className="p-3"></div>
      </aside>
    );
  }

  const Component = toolsMap[toolName].toolboxComponent;
  const tabs: TabType[] = ['Tool', 'History', 'Layers'];

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
            </li>
          </ul>
        )}
        {activeTab === 'History' && (
          <>
            <div className="flex flex-col gap-2">
              {getHistory().map((historyItem, index) => (
                <button
                  ref={hoveredIndex === index ? historyButtonRef : null}
                  key={index}
                  style={{
                    opacity: index >= historyLength ? 0.3 : 1,
                  }}
                  onClick={() => goToHistoryIndex(index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => {
                    setHoveredIndex(null);
                    setTooltipPos(null);
                  }}
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
            {hoveredIndex !== null && tooltipPos && getHistory()[hoveredIndex]?.bitmap && (
              <div
                className="fixed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-lg p-2 z-50"
                style={{
                  top: `${tooltipPos.top}px`,
                  left: `${tooltipPos.left}px`,
                }}
              >
                <canvas
                  ref={tooltipCanvasRef}
                  className="border border-gray-200 dark:border-gray-700 rounded"
                  style={{ maxWidth: '200px', maxHeight: '200px', display: 'block' }}
                />
              </div>
            )}
          </>
        )}
        {activeTab === 'Layers' && <div>Layers content</div>}
      </div>
    </aside>
  );
};

export default SidebarRight;
