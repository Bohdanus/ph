import { useStore } from '../../contexts/StoreContext.tsx';
import LayersTab from './LayersTab.tsx';
import HistoryTab from './HistoryTab.tsx';

const SidebarRight = () => {
  const [{ hasImage, toolName }] = useStore();

  if (!toolName || !hasImage) {
    return (
      <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right]">
        <div className="p-3"></div>
      </aside>
    );
  }

  return (
    <aside className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right] flex flex-col h-full overflow-hidden">
      <div className="h-[20%] flex flex-col overflow-hidden border-b border-gray-300 dark:border-gray-600">
        <div className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          History
        </div>
        <div className="flex-1 overflow-y-auto">
          <HistoryTab />
        </div>
      </div>

      <div className="h-[80%] flex flex-col overflow-hidden">
        <div className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Layers
        </div>
        <div className="flex-1 overflow-y-auto">
          <LayersTab />
        </div>
      </div>
    </aside>
  );
};

export default SidebarRight;
