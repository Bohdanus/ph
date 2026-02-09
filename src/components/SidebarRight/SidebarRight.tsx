import { useState, useContext, useRef, useEffect } from 'react';
import { useFloating, offset, flip, shift, arrow } from '@floating-ui/react';
import { ImageContext } from '../../contexts/ImageContext.tsx';
import { toolsMap } from '../../tools/toolsMap.ts';

type TabType = 'Tool' | 'History' | 'Layers';

const SidebarRight = () => {
  const { originalImage, toolName, setToolArgs, historyLength, goToHistoryIndex, history } = useContext(ImageContext);
  const [activeTab, setActiveTab] = useState<TabType>('Tool');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const tooltipCanvasRef = useRef<HTMLCanvasElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Floating UI setup for tooltip positioning relative to button
  const { floatingStyles, refs, middlewareData } = useFloating({
    placement: 'left',
    middleware: [offset(10), arrow({ element: arrowRef }), flip(), shift({ padding: 8 })],
  });

  // Update floating position when hovered button changes
  useEffect(() => {
    if (hoveredIndex !== null && buttonRefs.current[hoveredIndex]) {
      refs.setReference(buttonRefs.current[hoveredIndex]);
    }
  }, [hoveredIndex, refs]);

  // Render bitmap to canvas when hovering
  useEffect(() => {
    if (hoveredIndex !== null && tooltipCanvasRef.current) {
      const historyItem = history[hoveredIndex];

      if (historyItem?.bitmap) {
        const canvas = tooltipCanvasRef.current;
        canvas.width = historyItem.bitmap.width;
        canvas.height = historyItem.bitmap.height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(historyItem.bitmap, 0, 0);
        }
      }
    }
  }, [hoveredIndex, history]);

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
              {history.map((historyItem, index) => (
                <button
                  ref={(el) => {
                    buttonRefs.current[index] = el;
                  }}
                  key={index}
                  style={{
                    opacity: index >= historyLength ? 0.3 : 1,
                  }}
                  onClick={() => goToHistoryIndex(index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => {
                    setHoveredIndex(null);
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
            {hoveredIndex !== null && history[hoveredIndex]?.bitmap && (
              <div
                ref={refs.setFloating}
                className="fixed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-lg p-2 z-50"
                style={floatingStyles}
              >
                <div
                  ref={arrowRef}
                  className="absolute bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
                  style={{
                    width: 12,
                    height: 12,
                    transform: 'rotate(-45deg)',
                    right: -6,
                    top: middlewareData.arrow?.y ?? 0,
                    borderRight: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
                    borderBottom: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
                    color: 'inherit',
                    // boxShadow: '1px 1px 1px color-mix(in srgb, currentColor 5%, transparent)',
                  }}
                />
                <canvas
                  ref={tooltipCanvasRef}
                  className="border border-gray-200 dark:border-gray-700 rounded relative z-10"
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
