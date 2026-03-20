// src/components/SidebarRight/HistoryTab.tsx
import { useStore } from '../../contexts/StoreContext.tsx';
import { useHistory } from '../../contexts/useHistory.ts';
import { useState, useRef } from 'react';
import PreviewTooltip from '../PreviewTooltip/BmpPreviewTooltip.tsx';
import { EyeIcon } from '../Icons/EyeIcon.tsx';

export default function HistoryTab() {
  const [{ history, historyIndex }] = useStore();
  const { resetHistoryTo, toggleDisabled } = useHistory();

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const listItemRefs = useRef<Record<number, HTMLLIElement | null>>({});
  //
  // // TODO: Add the preview capability similar to the layers list. Currently there is no data to display in the preview, so leave todo instead
  // const bitmapPromise = Promise.resolve(null as any);

  const sortedHistory = [...history].reverse();

  return (
    <div className="flex flex-col gap-2 h-full">
      <PreviewTooltip
        open={hoveredIndex !== null}
        hoveredElement={hoveredIndex !== null ? listItemRefs.current[hoveredIndex] : null}
        bitmapPromise={hoveredIndex !== null ? history[hoveredIndex].imagePromise : Promise.resolve(null)}
        placement="left"
      />

      {history.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No history yet.</div>
      ) : (
        <ul className="flex flex-col list-none p-0 gap-1 overflow-y-auto min-h-0">
          {sortedHistory.map((item) => {
            const originalIndex = history.indexOf(item);
            const isActive = originalIndex <= historyIndex;
            const isCurrent = originalIndex === historyIndex;

            return (
              <li
                key={item.id}
                ref={(el) => {
                  listItemRefs.current[originalIndex] = el;
                }}
                onClick={() => resetHistoryTo(originalIndex)}
                onMouseEnter={() => setHoveredIndex(originalIndex)}
                onMouseLeave={() => setHoveredIndex(null)}
                className={[
                  'flex items-center gap-2 rounded px-2 py-0 select-none cursor-pointer',
                  'border border-transparent cursor-pointer',
                  'hover:bg-white/70 dark:hover:bg-gray-700/40',
                  isCurrent ? 'bg-white dark:bg-gray-700/60 border-gray-200 dark:border-gray-600' : 'bg-transparent',
                  item.disabled ? 'opacity-45' : !isActive ? 'opacity-50' : 'opacity-100',
                ].join(' ')}
                style={{
                  paddingTop: '1px',
                  paddingBottom: '1px',
                }}
                title="Click to go back to this state"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDisabled(item.id);
                  }}
                  className={[
                    'h-6 w-6 grid place-items-center rounded border',
                    !item.disabled
                      ? 'border-gray-300 text-gray-700 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200'
                      : 'border-gray-300 text-gray-400 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500',
                    'hover:border-gray-400 dark:hover:border-gray-500',
                  ].join(' ')}
                  title={!item.disabled ? 'Disable history item' : 'Enable history item'}
                >
                  <EyeIcon open={!item.disabled} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate flex items-center gap-2">
                    <span className="capitalize">{item.toolName}</span>
                    {isCurrent && (
                      <span className="ml-1" title="Current state">
                        👈
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
