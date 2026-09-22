import { type ChangeEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import ToolTooltip from './ToolTooltip.tsx';
import { toolIcons } from './toolIcons.tsx';
import { toolbarMap, type ToolbarTool, type ToolbarToolGroup } from '../../../toolbar-mapping.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';

const TOOL_BUTTON_BASE_CLASS =
  'group relative flex h-11 w-11 items-center justify-center rounded-md border text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-200 dark:focus:ring-offset-gray-800';

const TOOL_BUTTON_ACTIVE_CLASS =
  'border-blue-500 bg-blue-100 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.45)] text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-100';

const TOOL_BUTTON_INACTIVE_CLASS =
  'border-gray-300 bg-gray-200/80 hover:border-gray-400 hover:bg-white dark:border-gray-700 dark:bg-gray-900/60 dark:hover:border-gray-500 dark:hover:bg-gray-700';

const slugify = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

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
  const [isSingleColumn, setIsSingleColumn] = useState(true);
  const longPressFlyoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressLongPressRef = useRef(false);
  const longPressOpenedRef = useRef(false);
  const ignoreNextClickRef = useRef(false);

  const colorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const colorSquareRef = useRef<HTMLDivElement>(null);
  const bgColorSquareRef = useRef<HTMLDivElement>(null);
  const toolGroupRefs = useRef<Record<string, HTMLLIElement | null>>({});

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
        setOpenGroup(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [openGroup]);

  useEffect(() => {
    if (openGroup === null) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const group = toolGroupRefs.current[openGroup];
      if (group && event.target instanceof Node && !group.contains(event.target)) setOpenGroup(null);
    };

    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [openGroup]);

  const getToolIcon = (tool: ToolbarTool) => {
    if (tool.figure) {
      const shapeIcon =
        toolIcons[
          `shape-${tool.figure}` as
            | 'shape-rectangle'
            | 'shape-oval'
            | 'shape-square'
            | 'shape-circle'
            | 'shape-line'
            | 'shape-triangle'
            | 'shape-polygon'
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
        key={`${groupIndex}-${group.map(({ label }) => slugify(label)).join('-')}`}
        ref={(element) => {
          toolGroupRefs.current[groupIndex] = element;
        }}
      >
        <ToolTooltip label={primaryTool.label} shortcut={primaryTool.shortcut}>
          <button
            aria-expanded={hasFlyout ? isOpen : undefined}
            aria-haspopup={hasFlyout ? 'menu' : undefined}
            aria-label={primaryTool.label}
            aria-pressed={group.some((tool) => tool.name === toolName)}
            className={`${TOOL_BUTTON_BASE_CLASS} ${group.some((tool) => tool.name === toolName) ? TOOL_BUTTON_ACTIVE_CLASS : TOOL_BUTTON_INACTIVE_CLASS}`}
            disabled={!hasImage}
            onClick={() => {
              if (hasFlyout && ignoreNextClickRef.current) {
                ignoreNextClickRef.current = false;
                return;
              }

              suppressLongPressRef.current = true;
              clearLongPressFlyout();

              if (hasFlyout) {
                if (isOpen) {
                  setOpenGroup(null);
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

        {hasFlyout && isOpen && (
          <ul
            aria-label={group.some((tool) => tool.figure) ? 'Shape tools' : `${primaryTool.label} tools`}
            className="absolute left-full top-0 z-50 ml-2 min-w-48 list-none rounded-lg border border-gray-300 bg-gray-100 p-1.5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
            onKeyDown={(event) => {
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
                <li key={`${tool.name}-${slugify(tool.label)}`} role="none">
                  <button
                    aria-checked={isSelected}
                    aria-label={tool.label}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100'
                        : 'text-gray-700 hover:bg-white dark:text-gray-200 dark:hover:bg-gray-700'
                    }`}
                    disabled={!hasImage}
                    onClick={() => {
                      setPrimaryTools((current) => ({ ...current, [groupIndex]: tool }));
                      selectTool(tool);
                      setOpenGroup(null);
                    }}
                    role="menuitemradio"
                    type="button"
                    data-testid={`tool-flyout-item-${tool.name}-${slugify(tool.label)}`}
                  >
                    <FlyoutIcon title={tool.label} />
                    <span className="flex-1 whitespace-nowrap">{tool.label}</span>
                    {tool.shortcut && <kbd className="text-[10px] opacity-65">{tool.shortcut}</kbd>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  if (!hasImage) return;

  const toolbarWidth = isSingleColumn ? '3.5rem' : '6.75rem';

  return (
    <aside
      className="max-md:hidden border-r border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800 [grid-area:left]"
      data-testid="left-sidebar"
      style={{ width: toolbarWidth }}
    >
      <div className="flex h-full flex-col items-center px-3 py-4">
        <div className="mb-2 flex w-full justify-end px-1">
          <button
            aria-label={isSingleColumn ? 'Use two-column toolbar' : 'Use one-column toolbar'}
            aria-pressed={isSingleColumn}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            onClick={() => {
              setIsSingleColumn((current) => !current);
              setOpenGroup(null);
            }}
            title={isSingleColumn ? 'Use two columns' : 'Use one column'}
            type="button"
            data-testid="toolbar-layout-toggle"
          >
            <LayoutIcon singleColumn={isSingleColumn} />
          </button>
        </div>
        <div
          className={`rounded-lg border border-gray-300 bg-gray-200/70 p-1.5 shadow-inner dark:border-gray-700 dark:bg-gray-950/35 ${
            isSingleColumn ? 'w-14' : 'w-[6.75rem]'
          }`}
          data-testid="left-toolbar-tools"
        >
          {isSingleColumn ? (
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
