import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import AnchoredOverlay from './AnchoredOverlay.tsx';
import ToolTooltip from './ToolTooltip.tsx';
import { toolIcons } from './toolIcons.tsx';
import { slugifyToolLabel, toolbarMap, type ToolbarTool, type ToolbarToolGroup } from '../../../toolbar-mapping.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { descriptionKeyFor } from '../../tools/descriptions/tooltips.ts';
import { useIsTabletViewport } from '../../hooks/useMediaQuery.ts';

const TOOL_BUTTON_BASE_CLASS =
  'group relative flex h-11 w-11 items-center justify-center rounded-md border text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-200 dark:focus:ring-offset-gray-800';

const TOOL_BUTTON_ACTIVE_CLASS =
  'border-blue-500 bg-blue-100 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.45)] text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-100';

const TOOL_BUTTON_INACTIVE_CLASS =
  'border-gray-300 bg-gray-200/80 hover:border-gray-400 hover:bg-white dark:border-gray-700 dark:bg-gray-900/60 dark:hover:border-gray-500 dark:hover:bg-gray-700';

const LayoutIcon = ({ singleColumn }: { singleColumn: boolean }) => (
  <span aria-hidden="true" className="flex items-center justify-center text-lg leading-none font-black tracking-tight">
    <span>{singleColumn ? '«' : '»'}</span>
  </span>
);

const toolbarGroups = toolbarMap.flat();

const SidebarLeft = () => {
  const [{ hasImage, toolName, color, backgroundColor }, dispatch] = useStore();
  const { goToTool } = useApp();
  const { toolArgs, patchToolArgs } = useCurrentTool();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [primaryTools, setPrimaryTools] = useState<Record<string, ToolbarTool>>({});
  // Two columns is the default. `min-h-0 overflow-y-auto` on the `<aside>` is what actually
  // stops the toolbar from dictating the canvas: the aside's min-content height would otherwise
  // become the grid row floor and drag the `h-full` canvas up (main's responsive work added that,
  // and the page no longer outgrows a 720px viewport as a result). With the row bounded, the
  // canvas keeps the same height in both layouts, so a single column only means the toolbar
  // itself scrolls — which it now can, and which two columns mostly avoids.
  const [isSingleColumn, setIsSingleColumn] = useState(false);
  const isTablet = useIsTabletViewport();
  const longPressFlyoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressLongPressRef = useRef(false);
  const longPressOpenedRef = useRef(false);
  const ignoreNextClickRef = useRef(false);

  const colorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const colorSquareRef = useRef<HTMLDivElement>(null);
  const bgColorSquareRef = useRef<HTMLDivElement>(null);
  const toolGroupRefs = useRef<Record<string, HTMLLIElement | null>>({});
  // The tile a flyout is anchored to. Only the OPEN tile publishes one, and only for
  // itself, so a flyout that switches groups can never be measured against the tile it
  // replaced. Keyed by group because the anchor is published by a ref callback, which
  // React re-invokes on every commit — the updater returns the same object when nothing
  // changed, which is what stops that from re-rendering forever.
  const [flyoutAnchor, setFlyoutAnchor] = useState<{ groupIndex: string; element: HTMLLIElement } | null>(null);

  const handleColorClick = (e: React.MouseEvent<HTMLDivElement>, inputRef: RefObject<HTMLInputElement | null>) => {
    if (!inputRef.current) return;

    const parentRect = e.currentTarget.parentElement!.getBoundingClientRect();
    const squareRect = e.currentTarget.getBoundingClientRect();
    const offsetX = squareRect.left - parentRect.left;
    const offsetY = squareRect.top - parentRect.top;
    inputRef.current.style.left = `${offsetX}px`;
    inputRef.current.style.top = `${offsetY + 5}px`;
    inputRef.current.click();
  };

  const handleColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_COLOR', payload: e.target.value });
  };

  const handleBgColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch({ type: 'SET_BACKGROUND_COLOR', payload: e.target.value });
  };

  const handleSwapColors = () => {
    dispatch({ type: 'SET_COLOR', payload: backgroundColor });
    dispatch({ type: 'SET_BACKGROUND_COLOR', payload: color });
  };

  const clearLongPressFlyout = () => {
    if (longPressFlyoutTimeoutRef.current !== null) {
      clearTimeout(longPressFlyoutTimeoutRef.current);
      longPressFlyoutTimeoutRef.current = null;
    }
  };

  const openFlyout = (groupIndex: string) => {
    clearLongPressFlyout();
    suppressLongPressRef.current = false;
    longPressOpenedRef.current = true;
    setOpenGroup(groupIndex);
  };

  /**
   * The one way a flyout closes. The anchor goes with it: it is the element the overlay
   * measures, published by the open tile's ref callback, and nothing else ever clears it.
   * Left behind, it survives a tile that unmounts — crossing the `lg` breakpoint replaces
   * the two-column keys with the one-column ones, so the guard below can match a group
   * whose tile is detached, and the overlay would measure a detached box.
   */
  const closeFlyout = useCallback(() => {
    setOpenGroup(null);
    setFlyoutAnchor(null);
  }, []);

  const scheduleFlyoutOpen = (groupIndex: string) => {
    clearLongPressFlyout();
    longPressOpenedRef.current = false;
    longPressFlyoutTimeoutRef.current = setTimeout(() => {
      if (suppressLongPressRef.current) return;
      openFlyout(groupIndex);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (longPressFlyoutTimeoutRef.current !== null) clearTimeout(longPressFlyoutTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (openGroup === null) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeFlyout();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [openGroup, closeFlyout]);

  useEffect(() => {
    if (openGroup === null) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      // The flyout is portalled into `document.body` to escape the rail's scroll
      // container, so it is no longer inside the `<li>` that holds the tile. Without this
      // second test every click on a flyout item reads as a click outside the group, and
      // the menu closes under the item that was just chosen. The attribute is matched
      // rather than a ref to the `<ul>` held here, because the click target can be the
      // `<ul>` or anything inside it — a `<kbd>`, a label span, an icon — and only the DOM
      // knows which of those belongs to which group.
      const clickedFlyout = event.target instanceof Element ? event.target.closest('[data-toolbar-flyout]') : null;
      if (toolGroupRefs.current[openGroup]?.contains(event.target)) return;
      if (clickedFlyout?.getAttribute('data-toolbar-flyout') === openGroup) return;
      closeFlyout();
    };

    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [openGroup, closeFlyout]);

  const getToolIcon = (tool: ToolbarTool) => {
    if (tool.figure) {
      const shapeIcon =
        toolIcons[
          `shape-${tool.figure}` as 'shape-rectangle' | 'shape-oval' | 'shape-line' | 'shape-triangle' | 'shape-polygon'
        ];
      if (shapeIcon) return shapeIcon;
    }
    return toolIcons[tool.name];
  };

  const isToolSelected = (tool: ToolbarTool) =>
    tool.name === toolName && (!tool.figure || (toolArgs.toolName === 'shape' && toolArgs.figure === tool.figure));

  const selectTool = (tool: ToolbarTool) => {
    if (tool.figure) patchToolArgs('shape', { figure: tool.figure });
    goToTool(tool.name);
  };

  const renderToolGroup = (group: ToolbarToolGroup, groupIndex: string) => {
    const hasFlyout = group.length > 1;
    // Photoshop-style contract for grouped tools:
    // - the first item in a flyout group is the default tool for that top-level tile.
    // - a normal click on the tile must behave like "select the default tool" and never open the submenu.
    // - the submenu is a secondary affordance that only appears after a sustained pointer press.
    // - once open, the submenu closes on outside click, on clicking the tile again, or on choosing a submenu item.
    // - hover is intentionally not used to drive open/close state, because hover would make the menu flicker and
    //   feel like a transient visual state rather than a deliberate selection action.
    // This is why the group button uses the default tool as its visible identity, while the flyout remains a
    // long-press-only submenu instead of a hover-driven popover.
    const primaryTool = primaryTools[groupIndex] ?? group[0];
    const Icon = getToolIcon(primaryTool);
    const isOpen = openGroup === groupIndex;

    return (
      <li
        className="group relative"
        key={`${groupIndex}-${group.map(({ label }) => slugifyToolLabel(label)).join('-')}`}
        ref={(element) => {
          toolGroupRefs.current[groupIndex] = element;
          if (element === null || !isOpen) return;
          setFlyoutAnchor((current) =>
            current?.groupIndex === groupIndex && current.element === element ? current : { groupIndex, element }
          );
        }}
      >
        <ToolTooltip
          label={primaryTool.label}
          shortcut={primaryTool.shortcut}
          toolName={descriptionKeyFor(primaryTool.name, primaryTool.figure)}
        >
          <button
            aria-expanded={hasFlyout ? isOpen : undefined}
            aria-haspopup={hasFlyout ? 'menu' : undefined}
            aria-label={primaryTool.label}
            aria-pressed={group.some((tool) => tool.name === toolName)}
            className={`${TOOL_BUTTON_BASE_CLASS} ${group.some((tool) => tool.name === toolName) ? TOOL_BUTTON_ACTIVE_CLASS : TOOL_BUTTON_INACTIVE_CLASS}`}
            onClick={() => {
              if (hasFlyout && ignoreNextClickRef.current) {
                ignoreNextClickRef.current = false;
                return;
              }

              suppressLongPressRef.current = true;
              clearLongPressFlyout();

              if (hasFlyout) {
                if (isOpen) {
                  closeFlyout();
                  return;
                }
                selectTool(primaryTool);
                return;
              }

              selectTool(primaryTool);
            }}
            onContextMenu={(event) => {
              if (!hasFlyout) return;
              event.preventDefault();
              openFlyout(groupIndex);
            }}
            onKeyDown={(event) => {
              if (!hasFlyout) return;
              // A long press leaves focus on the tile, so Tab from there is the common way
              // out of a flyout opened by mouse. The menu's own handler covers the case
              // where focus is already inside it.
              if (event.key === 'Tab') {
                if (isOpen) closeFlyout();
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openFlyout(groupIndex);
                requestAnimationFrame(() => {
                  const menu = document.querySelector<HTMLUListElement>(`[data-testid="tool-flyout-${groupIndex}"]`);
                  const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
                  if (items.length === 0) return;
                  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                  const nextIndex = event.key === 'ArrowUp' ? items.length - 1 : currentIndex >= 0 ? currentIndex : 0;
                  items[nextIndex]?.focus();
                });
              }
            }}
            onPointerDown={(event) => {
              if (!hasFlyout || event.button !== 0) return;
              suppressLongPressRef.current = false;
              ignoreNextClickRef.current = false;
              longPressOpenedRef.current = false;
              scheduleFlyoutOpen(groupIndex);
            }}
            onPointerLeave={() => {
              suppressLongPressRef.current = false;
              longPressOpenedRef.current = false;
              clearLongPressFlyout();
            }}
            onPointerUp={() => {
              suppressLongPressRef.current = false;
              if (hasFlyout && longPressOpenedRef.current) {
                ignoreNextClickRef.current = true;
              }
              longPressOpenedRef.current = false;
              clearLongPressFlyout();
            }}
            onPointerCancel={() => {
              suppressLongPressRef.current = false;
              longPressOpenedRef.current = false;
              clearLongPressFlyout();
            }}
            type="button"
            data-testid={`tool-button-${primaryTool.name}`}
          >
            <Icon title={primaryTool.label} />
            {hasFlyout && (
              <span
                aria-hidden="true"
                className="absolute bottom-0.5 right-0.5 h-0 w-0 border-b-[5px] border-l-[5px] border-b-current border-l-transparent opacity-70"
              />
            )}
          </button>
        </ToolTooltip>

        {hasFlyout && isOpen && flyoutAnchor?.groupIndex === groupIndex && (
          <AnchoredOverlay align="start" anchor={flyoutAnchor.element} measureKey={groupIndex}>
            <ul
              aria-label={group.some((tool) => tool.figure) ? 'Shape tools' : `${primaryTool.label} tools`}
              className="pointer-events-auto min-w-48 list-none rounded-lg border border-gray-300 bg-gray-100 p-1.5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
              data-toolbar-flyout={groupIndex}
              onKeyDown={(event) => {
                // Tab leaves the menu rather than walking it. The overlay lives in
                // `document.body`, so the items are no longer in the tile's focus ring and
                // Tab is the only key that can move focus out of the menu — which is also
                // what a `role="menu"` is supposed to do. Closing here stops the menu
                // outliving the focus that opened it.
                if (event.key === 'Tab') {
                  closeFlyout();
                  return;
                }

                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
                );
                if (items.length === 0) return;

                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const nextIndex =
                    currentIndex === -1
                      ? 0
                      : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                  items[nextIndex]?.focus();
                }

                if (event.key === 'Enter' && document.activeElement instanceof HTMLButtonElement) {
                  event.preventDefault();
                  document.activeElement.click();
                }
              }}
              role="menu"
              data-testid={`tool-flyout-${groupIndex}`}
            >
              {group.map((tool: ToolbarTool) => {
                const FlyoutIcon = getToolIcon(tool);
                const isSelected = isToolSelected(tool);

                return (
                  <li key={`${tool.name}-${slugifyToolLabel(tool.label)}`} role="none">
                    <button
                      aria-checked={isSelected}
                      aria-label={tool.label}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100'
                          : 'text-gray-700 hover:bg-white dark:text-gray-200 dark:hover:bg-gray-700'
                      }`}
                      onClick={() => {
                        setPrimaryTools((current) => ({ ...current, [groupIndex]: tool }));
                        selectTool(tool);
                        closeFlyout();
                      }}
                      role="menuitemradio"
                      type="button"
                      data-testid={`tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}`}
                    >
                      <FlyoutIcon title={tool.label} />
                      <span className="flex-1 whitespace-nowrap">{tool.label}</span>
                      {tool.shortcut && <kbd className="text-[10px] opacity-65">{tool.shortcut}</kbd>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </AnchoredOverlay>
        )}
      </li>
    );
  };

  if (!hasImage) return;

  // The tablet band has no room for a 108px two-column rail: at 768px that plus the layers
  // panel leaves the canvas 410px. The two-column choice is a desktop preference, so below
  // `lg` the rail is forced to one column and the toggle is hidden rather than shown
  // inert. This is the one place a media query has to reach the DOM rather than a class,
  // because the two modes are different markup (one `<ul>` per section, versus a single
  // two-column `<ul>`) and not a restyle of the same tree.
  const isSingleColumnMode = isTablet || isSingleColumn;
  const toolbarWidth = isSingleColumnMode ? '3.5rem' : '6.75rem';

  return (
    <aside
      className="max-md:hidden min-h-0 overflow-y-auto overscroll-contain border-r border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800 [grid-area:left]"
      data-testid="left-sidebar"
      style={{ width: toolbarWidth }}
    >
      {/* `min-h-full`, not `h-full`: the aside now scrolls, and `h-full` on a child of a
          scroll container resolves against the container's own height, which would leave
          the colour swatches unpainted at the bottom of a long rail. */}
      <div className="flex min-h-full flex-col items-center px-3 py-4">
        <div className="mb-2 flex w-full justify-end px-1">
          {!isTablet && (
            <button
              aria-label={isSingleColumn ? 'Use two-column toolbar' : 'Use one-column toolbar'}
              aria-pressed={isSingleColumn}
              className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              onClick={() => {
                setIsSingleColumn((current) => !current);
                closeFlyout();
              }}
              title={isSingleColumn ? 'Use two columns' : 'Use one column'}
              type="button"
              data-testid="toolbar-layout-toggle"
            >
              <LayoutIcon singleColumn={isSingleColumn} />
            </button>
          )}
        </div>
        <div
          className={`rounded-lg border border-gray-300 bg-gray-200/70 p-1.5 shadow-inner dark:border-gray-700 dark:bg-gray-950/35 ${
            isSingleColumnMode ? 'w-14' : 'w-[6.75rem]'
          }`}
          data-testid="left-toolbar-tools"
        >
          {isSingleColumnMode ? (
            toolbarMap.map((section, sectionIndex) => (
              <ul
                className={`grid list-none grid-cols-1 gap-1.5 ${sectionIndex > 0 ? 'mt-1.5 border-t border-gray-300 pt-1.5 dark:border-gray-700' : ''}`}
                key={`toolbar-section-${sectionIndex}`}
              >
                {section.map((group, groupIndex) => renderToolGroup(group, `${sectionIndex}-${groupIndex}`))}
              </ul>
            ))
          ) : (
            <ul className="grid list-none grid-cols-2 gap-1.5">
              {toolbarGroups.map((group, groupIndex) => renderToolGroup(group, `two-column-${groupIndex}`))}
            </ul>
          )}
        </div>
        <hr className="my-3 border-gray-300 dark:border-gray-700" />

        <div className="flex flex-col items-center mt-4">
          <div className="relative w-14 h-14" data-testid="color-pickers">
            <div
              className="absolute top-4 left-4 w-8 h-8 cursor-pointer rounded border border-gray-400 dark:border-gray-500 shadow-sm"
              style={{ backgroundColor }}
              onClick={(e) => handleColorClick(e, bgColorInputRef)}
              title="Background Color"
              ref={bgColorSquareRef}
              data-testid="background-color-swatch"
            />
            <div
              className="absolute top-0 left-0 w-8 h-8 cursor-pointer rounded border border-gray-400 dark:border-gray-500 shadow-md"
              style={{ backgroundColor: color }}
              onClick={(e) => handleColorClick(e, colorInputRef)}
              title="Foreground Color"
              ref={colorSquareRef}
              data-testid="foreground-color-swatch"
            />

            <input
              type="color"
              ref={colorInputRef}
              className="absolute opacity-0 pointer-events-none"
              value={color}
              onChange={handleColorChange}
              data-testid="foreground-color-input"
            />
            <input
              type="color"
              ref={bgColorInputRef}
              className="absolute opacity-0 pointer-events-none"
              value={backgroundColor}
              onChange={handleBgColorChange}
              data-testid="background-color-input"
            />
          </div>

          <button
            onClick={handleSwapColors}
            className="mt-1 text-[8px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 uppercase font-bold"
            title="Swap Colors"
            data-testid="swap-colors-button"
          >
            ⇅ Swap
          </button>
        </div>

        <hr className="my-3 border-gray-300 dark:border-gray-700" />
        {/*<Zoom />*/}
      </div>
    </aside>
  );
};

export default SidebarLeft;
