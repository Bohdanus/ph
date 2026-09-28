import { toolsMap } from '../../tools/toolsMap.ts';
import { useStore } from '../../contexts/StoreContext.tsx';

const TOOLBAR_BASE_CLASS =
  'bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 h-[50px] [grid-area:toolbar] max-md:hidden';

const ToolbarHorizontal = () => {
  const [{ hasImage, toolName }] = useStore();

  if (!toolName || !hasImage) {
    return <div className={TOOLBAR_BASE_CLASS}></div>;
  }

  const ToolComponent = toolsMap[toolName]?.toolboxComponent;

  if (!ToolComponent) {
    return (
      <div className={`${TOOLBAR_BASE_CLASS} flex items-center px-4 overflow-visible`}>
        <span className="text-xs text-amber-700 dark:text-amber-300">TODO: unregistered tool placeholder</span>
      </div>
    );
  }

  return (
    // `overflow-visible` from 1024px up, and only there.
    //
    // The toolbar has to stay `overflow-visible` on desktop because tool option panels
    // render popovers that must escape this 50px box — the text tool's font list is the
    // live one. The tablet band cannot: its widest panel (Transform, ~1036px of buttons and
    // sliders) does not fit in 768–1023px, and the Apply/Clear controls at the far end are
    // simply off-screen with no way to reach them. `max-lg:overflow-x-auto` gives that band
    // a horizontal scrollbar and leaves desktop byte-identical.
    //
    // Scrolling in the tablet band does clip vertically, which is why the font list is
    // portalled to `document.body` — see `src/components/ToolbarsRight/Text/FontSelect.tsx`.
    <div className={`${TOOLBAR_BASE_CLASS} flex items-center px-4 overflow-visible max-lg:overflow-x-auto`}>
      <div className="min-w-fit flex items-center max-lg:min-w-max">
        <ToolComponent key={toolName} />
      </div>
    </div>
  );
};

export default ToolbarHorizontal;
