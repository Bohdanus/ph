import { type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import AnchoredOverlay from './AnchoredOverlay.tsx';
import ToolTooltip from './ToolTooltip.tsx';
import { toolIcons } from './toolIcons.tsx';
import { slugifyToolLabel, toolbarMap, type ToolbarTool, type ToolbarToolGroup } from '../../../toolbar-mapping.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { descriptionKeyFor } from '../../tools/descriptions/tooltips.ts';
import { useIsMobileViewport, useIsTabletViewport } from '../../hooks/useMediaQuery.ts';
import { usePanelLayout } from '../../contexts/PanelLayout.tsx';
import { useDockDrag } from '../../hooks/useDockDrag.ts';

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

/** How far toward the opposite edge the rail has to travel before the dock will swap with it. */
const RE_DOCK_ZONE = 0.25;

/**
 * The grip that drags the rail to the other edge.
 *
 * Photoshop's Tools panel has no such control of its own — you drag the panel itself, by its
 * grab area. This rail has no title bar to grab, and inventing one would put a row of chrome
 * above the tools that Photoshop does not have. So the grip goes in the row that already exists
 * for the one/two-column toggle, which is the same place the user already goes to change the
 * rail's shape, and the row keeps its height either way.
 */
const RailGripIcon = () => (
  <span aria-hidden="true" className="flex flex-col gap-[2px]">
    <span className="flex gap-[2px]">
      <span className="h-[2px] w-[10px] rounded-full bg-current" />
      <span className="h-[2px] w-[10px] rounded-full bg-current" />
    </span>
    <span className="flex gap-[2px]">
      <span className="h-[2px] w-[10px] rounded-full bg-current" />
      <span className="h-[2px] w-[10px] rounded-full bg-current" />
    </span>
  </span>
);

const toolbarGroups = toolbarMap.flat();

const SidebarLeft = () => {
  const [{ hasImage, toolName, color, backgroundColor }, dispatch] = useStore();
  const { goToTool } = useApp();
  const { toolArgs, patchToolArgs } = useCurrentTool();
  const { dockOnLeft, setDockOnLeft } = usePanelLayout();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [primaryTools, setPrimaryTools] = useState<Record<string, ToolbarTool>>({});
  // Two columns is the default. `overflow-y-auto` on the `<aside>` is what stops the toolbar
  // from dictating the canvas: a scroll container's automatic minimum size is zero, so the
  // rail's content cannot become the grid row floor and drag the `h-full` canvas up. With
  // the row bounded the canvas keeps the same height in both layouts, so the choice is only
  // about the rail's own width — and about how much it scrolls. Two columns needs a shorter
  // window than one column to stop scrolling, not a taller one, which is the opposite of the
  // intuition that halving the width makes the rail taller. The measured heights, the
  // thresholds they imply, and the font metrics they depend on are recorded once, in the
  // header of `e2e/no-document-overflow.spec.ts`.
  const [isSingleColumn, setIsSingleColumn] = useState(false);
  const isTablet = useIsTabletViewport();
  const isMobile = useIsMobileViewport();
  const longPressFlyoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressLongPressRef = useRef(false);
  const longPressOpenedRef = useRef(false);
  const ignoreNextClickRef = useRef(false);

  const colorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  const colorSquareRef = useRef<HTMLDivElement>(null);
  const bgColorSquareRef = useRef<HTMLDivElement>(null);
  const toolGroupRefs = useRef<Record<string, HTMLLIElement | null>>({});
  /**
   * The rail itself, for horizontal overlay placement. The tiles sit on a 108px grid inside a
   * narrower content box, so a second-column tile can start PAST the rail's own right edge;
   * hanging a flyout off such a tile puts it back over the rail's first column. The rail is
   * what an overlay has to get clear of, and this is how Photoshop hangs a tool flyout too.
   */
  const [railElement, setRailElement] = useState<HTMLElement | null>(null);
  // The tile a flyout is anchored to. Only the OPEN tile publishes one, and only for
  // itself, so a flyout that switches groups can never be measured against the tile it
  // replaced. Keyed by group because the anchor is published by a ref callback, which
  // React re-invokes on every commit — the updater returns the same object when nothing
  // changed, which is what stops that from re-rendering forever.
  const [flyoutAnchor, setFlyoutAnchor] = useState<{ groupIndex: string; element: HTMLLIElement } | null>(null);

  // Both breakpoints are watched, and for DIFFERENT reasons — a shared one would be wrong
  // about whichever boundary it did not describe.
  //
  // Across `lg` the group keys change, from `two-column-N` above it to `N-M` below, because
  // the tablet layout is one column. A crossing therefore leaves `openGroup` matching nothing
  // and the flyout vanishes unclosed — then matches again on the way back and reopens by
  // itself, with nothing the user did to open it.
  //
  // Across `md` the keys do NOT change: `isSingleColumnMode` is `isTablet || isSingleColumn`
  // and knows nothing of `isMobile`, so at 767px the rail is still the two-column layout with
  // the same keys. What changes is that the rail stops being rendered — it is `display: none`
  // and the portal escapes that, so nothing about the menu's own placement stops it. Its
  // anchor's box is zeroed by the hiding, which the clamp turns into the viewport's top-left
  // corner, leaving a menu painted and clickable over a mobile shell with no tile under it.
  //
  // Adjusted during render rather than in an effect, because this state is derived from
  // props, which is what React's own guidance says to handle this way. `set-state-in-effect`
  // rejects the effect form, and an effect would also leave a commit in which the stale group
  // is still open.
  const railLayout = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
  const [lastRailLayout, setLastRailLayout] = useState(railLayout);
  if (lastRailLayout !== railLayout) {
    setLastRailLayout(railLayout);
    setOpenGroup(null);
    setFlyoutAnchor(null);
  }

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
  /**
   * `restoreFocus` is for the closes a KEYBOARD performed, and only those. The menu lives in
   * `document.body`, so unmounting it takes the focused element with it: measured in Chrome,
   * Escape and Tab both dropped focus where no user asked to be — `document.body`, or the
   * document's first tabbable, 16 tab stops before the rail. A menu pattern has to hand focus
   * back to the button that opened it.
   *
   * It is deliberately not done on the closes a POINTER performed, including the one that
   * matters most. An outside click or a click on the tile has already put focus where the
   * user asked for it, and a mouse pick of a flyout item has focused that item; taking it back
   * to the tile would undo their click, and focusing the tile arms `ToolTooltip`'s 250ms focus
   * timer, so a tooltip would appear over a selection the mouse user never asked to see. The
   * keyboard's own Enter path restores focus from its keydown instead, where the gesture is
   * known to be the keyboard's.
   */
  const closeFlyout = useCallback(
    (restoreFocus = false) => {
      if (restoreFocus) {
        flyoutAnchor?.element.querySelector<HTMLButtonElement>('button')?.focus();
      }
      setOpenGroup(null);
      setFlyoutAnchor(null);
    },
    [flyoutAnchor]
  );

  // Re-docking the rail. "You can dock the Tools panel to either the right or left sides of
  // the application window" (teachucomp; the CC-era Adobe book says the same by its title bar).
  // The drop target is a blue line at the edge being thrown at, drawn before the release, which
  // is the affordance Adobe documents for every panel move.
  //
  // `overlaySide` is the same fact as `dockOnLeft` seen from the rail: a rail on the right edge
  // opens its flyout to the left, because "the anchor's trailing edge" is off-screen there.
  const overlaySide: 'left' | 'right' = dockOnLeft ? 'left' : 'right';
  const [reDockTarget, setReDockTarget] = useState<'left' | 'right' | null>(null);
  const reDockOriginXRef = useRef(0);
  const reDockTargetRef = useRef<'left' | 'right' | null>(null);

  const onRailDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      reDockOriginXRef.current = event.clientX;
      setReDockTarget(null);
      // A rail that moves with a flyout open takes the portal's anchor with it, and the
      // overlay re-measures against a tile that is no longer where the user aimed.
      closeFlyout();
    },
    [closeFlyout]
  );

  // The current target is ALSO held in a ref, because the commit below reads it. A
  // `setReDockTarget` updater is the wrong place to put a side effect: React may call it more
  // than once for the same update, and a `setDockOnLeft` inside one commits the workspace move
  // an unpredictable number of times — or, in the case that was actually observed, not at all,
  // because the updater's return value is the only thing React is guaranteed to use.
  const onRailDrag = useCallback(
    ({ dx }: { dx: number }) => {
      const viewportWidth = document.documentElement.clientWidth;
      const pointerX = reDockOriginXRef.current + dx;
      // Toward the edge the rail is NOT on. A rail in the left column swaps by going RIGHT,
      // which is the mirror of the dock's own test in `SidebarRight` — that one is a dock in
      // the right column swapping by going LEFT. Reading either as "the low edge" is how this
      // shipped inverted once and passed a unit test written to match it: a rail dragged left
      // would have reported a drop target for the edge it was already against.
      const wantsSwap = dockOnLeft
        ? pointerX < viewportWidth * RE_DOCK_ZONE
        : pointerX > viewportWidth * (1 - RE_DOCK_ZONE);
      const target = wantsSwap ? (dockOnLeft ? 'left' : 'right') : null;
      reDockTargetRef.current = target;
      setReDockTarget(target);
    },
    [dockOnLeft]
  );

  // Honouring the cancel is the point of having one: the rail moves to the OPPOSITE edge, and a
  // user who presses Escape has said something. Committing anyway is the one result Escape must
  // never produce.
  const onRailDragEnd = useCallback(
    (cancelled: boolean) => {
      const target = reDockTargetRef.current;
      reDockTargetRef.current = null;
      setReDockTarget(null);
      // The rail and the dock SWAP, so the flag is the rail's destination INVERTED: a rail
      // going right puts the dock on the left, which is what `dockOnLeft` means. Mapping it
      // straight through (`target === 'left'`) sends the rail to the edge it was thrown away
      // from, and two inversions cancelling each other is exactly how this was wrong once.
      if (target !== null && !cancelled) setDockOnLeft(target === 'right');
    },
    [setDockOnLeft]
  );

  const railDrag = useDockDrag({ onStart: onRailDragStart, onMove: onRailDrag, onEnd: onRailDragEnd });

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
        closeFlyout(true);
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
          side={overlaySide}
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
          <AnchoredOverlay
            align="start"
            anchor={flyoutAnchor.element}
            measureKey={groupIndex}
            side={overlaySide}
            xAnchor={railElement}
          >
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
                  closeFlyout(true);
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
                  // The trigger is read BEFORE the click, because that click closes the flyout
                  // and clears the anchor this would otherwise be read from. The item that
                  // chose the tool does not restore focus itself: a mouse pick reaches the
                  // same `onClick`, and taking focus back to the tile there would arm
                  // `ToolTooltip`'s 250ms focus timer, so a tooltip would paint over a
                  // selection the mouse user never asked to see.
                  const trigger = flyoutAnchor?.element.querySelector<HTMLButtonElement>('button') ?? null;
                  document.activeElement.click();
                  // Choosing a tool is the menu's primary action, and the unmount takes the
                  // focused item with it: measured in Chrome, without this the user lands on
                  // `document.body`, 16 tab stops from the rail they were choosing from.
                  trigger?.focus();
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
                        // No focus restore: a click here may be a mouse pick, which has
                        // already put focus where the user aimed. The keyboard's Enter path
                        // restores it above, from the keydown, where the gesture is known.
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
      // `scrollbar-none` is main's, and the border is now CONDITIONAL because the rail can sit
      // on either edge: `overflow-y: auto` computes `overflow-x` to `auto` and the border
      // always sits outside the content box, so the border belongs on whichever side faces the
      // canvas — and the grid area follows from the same fact.
      className={`scrollbar-none max-md:hidden min-h-0 overflow-y-auto overscroll-contain bg-gray-100 dark:bg-gray-800 ${
        dockOnLeft
          ? 'border-l border-gray-300 dark:border-gray-700 [grid-area:right]'
          : 'border-r border-gray-300 dark:border-gray-700 [grid-area:left]'
      }`}
      data-testid="left-sidebar"
      ref={setRailElement}
      style={{ width: toolbarWidth }}
    >
      {/* The drop target for a rail re-dock, drawn before the release. `position: fixed` puts
          its containing block at the viewport, so the rail's `overflow-y: auto` does not clip
          it — the same reason the flyout has to be portalled but this does not, and the
          difference is absolute vs fixed. Rendered as a second child of the `<aside>` rather
          than a sibling in the grid, so the shell's region list stays what it has always been. */}
      {reDockTarget !== null && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-y-0 z-[60] w-1 bg-blue-500 ${reDockTarget === 'left' ? 'left-0' : 'right-0'}`}
          data-testid="rail-drop-line"
        />
      )}
      {/* `min-h-full`, not `h-full`: the aside now scrolls, and `h-full` on a child of a
          scroll container resolves against the container's own height, which would leave
          the colour swatches unpainted at the bottom of a long rail.

          `scrollbar-none` is why the rail can be a scroll container and show no scrollbar.
          The rail's content is a fixed 612px in two columns and 1014px in one, against an
          available height of `viewportHeight - 137` (the shell's three `auto` rows), so it
          genuinely overflows below 749px and 1151px respectively — measured, not estimated.
          Two of those are ordinary iPad sizes (810×1080 portrait, 1133×744 landscape), so
          "it only happens in a very short window" is not true. The scroll stays reachable
          by wheel, trackpad and touch; only the chrome is gone, because `overflow: hidden`
          would strand the colour swatches entirely.

          It also overflows HORIZONTALLY by 1px, because `overflow-y: auto` computes
          `overflow-x` to `auto` and the `border-r` sits outside the content box. That one
          paints nothing today only because `scrollbar-width: none` is axis-agnostic. It is
          not asserted anywhere and would become a scrollbar the day anyone narrows the
          suppression, so do not narrow it to a vertical-only rule. */}
      <div className="flex min-h-full flex-col items-center px-3 py-4">
        <div className="mb-2 flex w-full items-center justify-between px-1">
          {!isTablet && (
            <button
              {...railDrag.handleProps}
              aria-label="Drag the toolbar to the other side"
              className="cursor-grab rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 active:cursor-grabbing dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              title="Drag to the other side"
              type="button"
              data-testid="rail-re-dock-handle"
            >
              <RailGripIcon />
            </button>
          )}
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
