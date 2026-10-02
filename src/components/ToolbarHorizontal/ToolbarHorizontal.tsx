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
    // live one. The tablet band cannot: its widest panel (Transform) does not fit in
    // 768–1023px, and its controls at the far end are off-screen with no way to reach
    // them. `max-lg:overflow-x-auto` gives that band a horizontal scrollbar and leaves
    // desktop byte-identical.
    //
    // The "~1036px" an earlier version of this comment quoted for Transform was never a
    // measurement of the transform bar at all: 1036 is the RAIL's height threshold, the
    // height below which it folds two tiles (`e2e/toolbar-fit.spec.ts:258-261`). Transform's
    // own `min-content` is 548px, measured, and fits every band that shows this strip — so
    // the bar is not what needs the tablet scrollbar. Height is the axis that has bitten
    // here: the strip is a fixed `h-[50px]`, so a panel column taller than 50px paints over
    // the header and the workspace rather than scrolling, which is the defect commit
    // c424469a removed from the transform bar's right-hand column.
    //
    // Scrolling in the tablet band does clip vertically, which is why the font list is
    // portalled to `document.body` — see `src/components/ToolbarsRight/Text/FontSelect.tsx`.
    // `role="region"` + a name, because this strip is a direct child of the app grid and
    // therefore outside every landmark. axe's `region` rule is right about that: a
    // screen-reader user bypassing to the toolbar found nothing to land on. A landmark is
    // the honest fix — `role="toolbar"` satisfies nothing here, being a widget role.
    <div
      role="region"
      aria-label={`${toolName} tool options`}
      className={`${TOOLBAR_BASE_CLASS} flex items-center px-4 overflow-visible max-lg:overflow-x-auto`}
    >
      <div className="flex-1 min-w-fit flex items-center max-lg:min-w-max">
        <ToolComponent key={toolName} />
      </div>
    </div>
  );
};

export default ToolbarHorizontal;
