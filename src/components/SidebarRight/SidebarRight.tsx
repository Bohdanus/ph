import { useStore } from '../../contexts/StoreContext.tsx';
import { useRightPanelVisibility } from '../../contexts/RightPanelVisibility.tsx';
import LayersTab from './LayersTab.tsx';
import HistoryTab from './HistoryTab.tsx';

const SidebarRight = () => {
  const [{ hasImage, toolName }] = useStore();
  const { isOpen } = useRightPanelVisibility();

  // `hidden` rather than a conditional return, so the panel's grid area collapses to zero
  // in the tablet band while `Main` keeps its place. Always true on desktop: there
  // `isCollapsible` is false and `isOpen` is unconditionally true, so this is a no-op.
  if (!isOpen) {
    return <aside id="right-panel" className="hidden" />;
  }

  if (!toolName || !hasImage) {
    return (
      <aside
        id="right-panel"
        className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden max-lg:w-[250px] [grid-area:right]"
      >
        <div className="p-3"></div>
      </aside>
    );
  }

  return (
    <aside
      id="right-panel"
      // `max-lg:w-[250px]` gives the tablet band the desktop panel width while the grid
      // track stays `auto`, which is what makes the collapse work: a `display: none` item
      // contributes nothing to an `auto` track and the full 250px to a fixed one. The width
      // therefore has to live on the element, not on the track. Without it the tablet panel
      // sized itself to its layer names — 162px here — so opening it on a tablet gave a
      // different panel than the desktop one it is meant to mirror.
      className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden max-lg:w-[250px] [grid-area:right] flex flex-col h-full overflow-hidden"
    >
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
