import {
  type ChangeEvent,
  type ComponentType,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import AnchoredOverlay from './AnchoredOverlay.tsx';
import ToolTooltip from './ToolTooltip.tsx';
import { toolIcons } from './toolIcons.tsx';
import { slugifyToolLabel, toolbarMap, type ToolbarTool, type ToolbarToolGroup } from '../../../toolbar-mapping.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { descriptionKeyFor } from '../../tools/descriptions/tooltips.ts';
import { useIsMobileViewport, useIsTabletViewport } from '../../hooks/useMediaQuery.ts';
import { useToolbarOverflow } from './use-toolbar-overflow.ts';
import type { ToolbarSlot } from './toolbar-overflow.ts';

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

/**
 * The three-dots tile: Photoshop's slot for the tools the rail is not showing.
 *
 * Photoshop calls it the Edit Toolbar tile and puts it below the tools, above the colour
 * swatches; click-and-hold or right-click opens the flyout, which lists the Extra Tools
 * alongside the Edit Toolbar command. This app has no Edit Toolbar command, so the flyout
 * is nothing but the tools themselves — which is the whole point of it, and the reason
 * its contents are every TOOL of a collapsed group rather than one entry per collapsed
 * GROUP: a group is the unit the rail hides, but the nested tool is the unit the user
 * reaches for, and hiding a six-entry group behind a single entry would make the Pencil
 * unreachable for as long as the window is short.
 */
const MoreToolsIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="h-6 w-6 fill-none stroke-current"
    strokeWidth={2.5}
    strokeLinecap="round"
  >
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

const MORE_TOOLS_LABEL = 'More Tools';

/**
 * The three-dots tile's test id, and it is NOT `tool-button-<name>`.
 *
 * A tool tile's id is the tool, because that is what every spec and every helper selects
 * on. The three-dots tile has no tool, so minting one would have `getByTestId('tool-button-…')`
 * match a tile that selects something else — the same conflation that made the tile's
 * `primaryTool` a liability in the first place. A name of its own also lets a helper ask
 * "is this tool on the rail, or only in the overflow" without a regex over ids.
 */
const OVERFLOW_TILE_TESTID = 'tool-overflow-tile';

/** The group key in the one-column rail, which is the one the toolbar map's order reads as. */
const oneColumnGroupKey = (sectionIndex: number, groupIndex: number): string => `${sectionIndex}-${groupIndex}`;

/** The group key in the two-column rail, prefixed so the two layouts cannot collide. */
const twoColumnGroupKey = (groupIndex: number): string => `two-column-${groupIndex}`;

/** The three-dots tile's own key. Not a number, so no `sectionIndex-groupIndex` can be it. */
const OVERFLOW_GROUP_KEY = 'overflow';

/**
 * The three-dots tile's identity, module-level.
 *
 * Module-level because a fresh object per render is a fresh `Icon` component type, which
 * React unmounts and remounts on every commit — the tile would lose its flyout anchor, and
 * `hasFlyout`'s corner marker would be re-evaluated against a new component type, on a
 * render that has no reason to touch either.
 */
const OVERFLOW_IDENTITY: ToolGroupIdentity = { label: MORE_TOOLS_LABEL, Icon: MoreToolsIcon };

const toolbarGroups = toolbarMap.flat();

/**
 * What a tile draws, when the tile is not one specific tool.
 *
 * The three-dots tile is the only user: it stands for whichever tools did not fit, so its
 * icon and its name are the tile's own rather than a tool's. Left to itself `renderToolGroup`
 * would take the first member of its list as the tile's identity, which for the overflow
 * tile is whichever tool happened to be collapsed first.
 */
type ToolGroupIdentity = {
  label: string;
  Icon: ComponentType;
};

/**
 * One `<li>` of the tool grid, which is either a group or the three-dots tile.
 *
 * Modelled as an entry in the SAME list the groups are, rather than as a separate element
 * placed after them, for one reason that is about the code rather than the screen: the
 * `react-hooks/refs` rule reports a call to `renderToolGroup` made directly in the render
 * path — it reaches refs through the tile's `ref` callback and its press handlers — and
 * treats a call inside a `.map` callback as the library's business rather than the
 * component's. Every group tile is mapped, and a three-dots tile rendered as a sibling
 * expression is not, so expressing the tile as an entry keeps one code path for every tile
 * and satisfies the rule without a suppression.
 */
type ToolbarEntry = { kind: 'group'; group: ToolbarToolGroup; key: string } | { kind: 'overflow' };

const SidebarLeft = () => {
  const [{ hasImage, toolName, color, backgroundColor }, dispatch] = useStore();
  const { goToTool } = useApp();
  const { toolArgs, patchToolArgs } = useCurrentTool();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [primaryTools, setPrimaryTools] = useState<Record<string, ToolbarTool>>({});
  // One column is the DEFAULT, because that is Photoshop's default: the double-chevron at the
  // top of the Tools panel switches to two columns to save vertical room, which is only
  // coherent if one column is where you start. It is also the layout that makes overflow
  // possible, which is what the three-dots tile below is for.
  //
  // `min-h-0 overflow-y-auto` on the `<aside>` is what stops the toolbar from dictating the
  // canvas: the aside's min-content height would otherwise become the grid row floor and drag
  // the `h-full` canvas up (main's responsive work added that, and the page no longer outgrows a
  // 720px viewport as a result). The rail still owns a scrollbar as a backstop, but the tiles
  // themselves are fitted to the space they have rather than being cut off, so in practice
  // nothing in the rail scrolls any more.
  const [isSingleColumn, setIsSingleColumn] = useState(true);
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

  // The tablet band has no room for a 108px two-column rail: at 768px that plus the layers
  // panel leaves the canvas 410px. The two-column choice is a desktop preference, so below
  // `lg` the rail is forced to one column and the toggle is hidden rather than shown
  // inert. This is the one place a media query has to reach the DOM rather than a class,
  // because the two modes are different markup (one `<ul>` per section, versus a single
  // two-column `<ul>`) and not a restyle of the same tree.
  const isSingleColumnMode = isTablet || isSingleColumn;

  // The overflow machinery, above the `hasImage` early return for the ordinary reason: a
  // hook called after a conditional return is called a different number of times once the
  // document appears, and the first image to load would then be a hook-order violation
  // rather than a render.

  /**
   * The tool grid as a list of ROWS, which is the unit that actually occupies height.
   *
   * A row is a group in the one-column rail and a PAIR of groups in the two-column rail,
   * because that grid auto-flows into two columns: two groups share a row there, so a
   * collapse that hid one of them would leave a hole in the middle of the grid. The
   * two-column rows all report section `0` because that grid interleaves the sections into
   * one list with no separators between them, and a separator charged to a row that has
   * none is height the fit would never give back.
   */
  const toolbarSlots = useMemo<ToolbarSlot[]>(() => {
    if (isSingleColumnMode) {
      return toolbarMap.flatMap((section, sectionIndex) =>
        section.map((_group, groupIndex) => ({
          keys: [oneColumnGroupKey(sectionIndex, groupIndex)],
          sectionIndex,
        }))
      );
    }
    const rows: { keys: string[]; sectionIndex: number }[] = [];
    toolbarGroups.forEach((_group, groupIndex) => {
      const key = twoColumnGroupKey(groupIndex);
      const last = rows[rows.length - 1];
      if (last !== undefined && last.keys.length < 2) last.keys.push(key);
      else rows.push({ keys: [key], sectionIndex: 0 });
    });
    return rows;
  }, [isSingleColumnMode]);

  const { attachSlot, attachTools, plan: overflowPlan } = useToolbarOverflow(toolbarSlots);
  const collapsedGroups = useMemo(() => new Set(overflowPlan.collapsedKeys), [overflowPlan]);

  /**
   * Every TOOL of every collapsed group, which is what the three-dots flyout lists.
   *
   * A group is the unit the rail hides, and a tool is the unit the user reaches for, so the
   * flyout lists tools: collapsing the six-entry brush group behind one "Brush Tool" entry
   * would put the Pencil out of reach for as long as the window is short, which is the
   * defect the two-column rail was invented to avoid and the three-dots tile must not
   * reintroduce. Each tool belongs to exactly one group, so nothing here is already a tile.
   */
  const overflowTools = useMemo(() => {
    const tools: ToolbarTool[] = [];
    toolbarMap.forEach((section, sectionIndex) => {
      section.forEach((group, groupIndex) => {
        if (!collapsedGroups.has(oneColumnGroupKey(sectionIndex, groupIndex))) return;
        tools.push(...group);
      });
    });
    return tools;
  }, [collapsedGroups]);

  // A collapse that swallows the open group's tile unmounts the tile, and with it the
  // flyout. `openGroup` would keep naming a group that is no longer rendered, and the moment
  // the window grew back the tile would mount with `isOpen` already true — the flyout
  // reopening itself with nothing the user did to open it. The same defect the `lg`
  // crossing above has, reached a third way, and fixed the same way: derived from the state
  // that changed, adjusted during render.
  if (openGroup !== null && collapsedGroups.has(openGroup)) {
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

  const renderToolGroup = (group: ToolbarToolGroup, groupIndex: string, identity?: ToolGroupIdentity) => {
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
    //
    // The three-dots tile is the one caller that passes an `identity`, and it is the case the
    // rule above cannot describe: it stands for no tool, so "the first item is the default"
    // has nothing to select. Its identity is the tile's own and it is never rewritten by a
    // pick from its flyout — `identity` present is the signal for both, because a tile that
    // has a fixed icon must not start wearing a tool's icon after the first choice.
    const primaryTool = identity === undefined ? (primaryTools[groupIndex] ?? group[0]) : group[0];
    const Icon = identity?.Icon ?? getToolIcon(primaryTool);
    const tileLabel = identity?.label ?? primaryTool.label;
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
          label={tileLabel}
          shortcut={identity === undefined ? primaryTool.shortcut : undefined}
          toolName={identity === undefined ? descriptionKeyFor(primaryTool.name, primaryTool.figure) : null}
        >
          <button
            aria-expanded={hasFlyout ? isOpen : undefined}
            aria-haspopup={hasFlyout ? 'menu' : undefined}
            aria-label={tileLabel}
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
            data-testid={identity === undefined ? `tool-button-${primaryTool.name}` : OVERFLOW_TILE_TESTID}
            // Read by the fit measurement, which is why every tile carries it and not only
            // the tool tiles: a rail whose first section has collapsed away must still be
            // able to report a tile height, and the three-dots tile is then the only one left.
            data-toolbar-tile=""
          >
            <Icon title={tileLabel} />
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
              aria-label={
                identity !== undefined
                  ? 'More tools'
                  : group.some((tool) => tool.figure)
                    ? 'Shape tools'
                    : `${primaryTool.label} tools`
              }
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
                        // The three-dots tile is excluded: its identity is the tile's, so a
                        // pick must not promote anything to be its icon. Every other tile
                        // keeps the promotion, which is what makes a chosen nested tool
                        // survive the next collapse into the three-dots tile and expand back.
                        if (identity === undefined) {
                          setPrimaryTools((current) => ({ ...current, [groupIndex]: tool }));
                        }
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

  const toolbarWidth = isSingleColumnMode ? '3.5rem' : '6.75rem';

  /**
   * The one-column rail, one `<ul>` per section, minus whatever collapsed, with the
   * three-dots tile as the last entry of the section that holds the last visible row.
   *
   * The tile goes INSIDE that section's grid rather than in a grid of its own, so the space
   * it occupies is exactly the row gap plus one tile that the fit reserved for it. A tile in
   * its own grid would also carry the tools box's per-child border and padding, and the fit
   * would be wrong by however much that is.
   *
   * A section that loses every one of its groups still renders its `<ul>`, empty. That is
   * not tidiness: an empty `<ul>` occupies zero height, so the distance from the section
   * before it to the section after it is unchanged, and that distance is how the fit
   * measures a separator. Dropping the element instead would move every later section up
   * and the measurement would read a separator that is not there. It is given no separator
   * classes of its own, so it costs no pixels and draws no stray hairline.
   */
  const singleColumnSections: { sectionIndex: number; entries: ToolbarEntry[] }[] = toolbarMap.map(
    (section, sectionIndex) => ({
      sectionIndex,
      entries: section
        .map((group, groupIndex) => ({ group, key: oneColumnGroupKey(sectionIndex, groupIndex) }))
        .filter(({ key }) => !collapsedGroups.has(key))
        .map(({ group, key }): ToolbarEntry => ({ kind: 'group', group, key })),
    })
  );
  if (overflowPlan.showOverflowTile && isSingleColumnMode) {
    // The last visible ROW, then the SECTION it belongs to. Rows and sections are different
    // axes — one column has one row per group, so row 12 is in section 4 — and using one for
    // the other is how the tile ends up pushed off the end of the array.
    const lastVisibleRow = toolbarSlots[overflowPlan.fittedThrough - 1];
    const target = lastVisibleRow?.sectionIndex ?? singleColumnSections.length - 1;
    singleColumnSections[target].entries.push({ kind: 'overflow' });
  }

  /**
   * The two-column rail, one grid, minus whatever collapsed, with the tile last for the
   * same reason. Filtering rather than slicing is what keeps a collapsed group from leaving
   * a hole in the middle of the grid — though the fit never produces a half-collapsed row,
   * so in practice the two agree.
   */
  const twoColumnEntries: ToolbarEntry[] = [
    ...toolbarGroups
      .map((group, groupIndex) => ({ kind: 'group' as const, group, key: twoColumnGroupKey(groupIndex) }))
      .filter((entry) => !collapsedGroups.has(entry.key)),
    ...(overflowPlan.showOverflowTile ? [{ kind: 'overflow' as const }] : []),
  ];

  return (
    <aside
      className="max-md:hidden min-h-0 overflow-y-auto overscroll-contain border-r border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800 [grid-area:left]"
      data-testid="left-sidebar"
      style={{ width: toolbarWidth }}
    >
      {/* `h-full`, and that is the change that makes the fit possible. A flex column sized
          by its CONTENT has no height for `flex-1` to divide: the tools slot would be handed
          whatever the tools happened to need, so the fit would measure its own output and
          agree with it. Giving the column the rail's own height makes the slot the leftover
          after the chrome, which is a number nothing inside the slot can influence.

          THE ONE ASSUMPTION A MOVABLE PANEL WOULD CHANGE, and the seam for it. This says the
          rail is a grid cell that fills its row, which is true of a docked rail and false of
          a panel the user has dragged off the left edge. Everything the overflow rule does
          is already written against `left-toolbar-slot` — its height, and nothing else — and
          never against `innerHeight` or the rail's own box, so a floating panel with a height
          of its own needs exactly one change: the column stops being `h-full` and the slot
          stops being `flex-1`, and gets that height instead. Nothing in `toolbar-overflow.ts`
          or `use-toolbar-fit.ts` moves, and `SidebarLeft.overflow.test.tsx` already asserts
          the property that makes this true — a different window at the same slot height does
          not change the fit.

          The rail keeps `overflow-y-auto`, but the tiles are now fitted to the slot rather
          than cut off, so nothing in it scrolls: the one case the scrollbar still answers is
          a window so short that the colour swatches alone do not fit, which no layout of
          this rail can serve anyway. */}
      <div className="flex h-full flex-col items-center px-3 py-4">
        <div className="mb-2 flex w-full shrink-0 justify-end px-1">
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
          // `overflow-y-auto`, not `overflow-hidden`, and the difference is the difference
          // between a tile that is somewhere else and a tile that is gone. The fit already
          // keeps the tiles inside the slot — it reserves a row for the three-dots tile and
          // then fills no more than the 80% budget — so this scrollbar never appears. It is
          // here so that IF the arithmetic is ever wrong, the tools it misjudged are still
          // reachable by scrolling rather than clipped out of existence. A rail that could
          // hide a tool is a worse failure than a rail that scrolls.
          className="flex min-h-0 w-full flex-1 justify-center overflow-y-auto"
          data-testid="left-toolbar-slot"
          ref={attachSlot}
        >
          <div
            className={`rounded-lg border border-gray-300 bg-gray-200/70 p-1.5 shadow-inner dark:border-gray-700 dark:bg-gray-950/35 ${
              isSingleColumnMode ? 'w-14' : 'w-[6.75rem]'
            }`}
            data-testid="left-toolbar-tools"
            ref={attachTools}
          >
            {isSingleColumnMode ? (
              singleColumnSections.map(({ sectionIndex, entries }) => (
                <ul
                  className={`grid list-none grid-cols-1 gap-1.5 ${entries.length > 0 && sectionIndex > 0 ? 'mt-1.5 border-t border-gray-300 pt-1.5 dark:border-gray-700' : ''}`}
                  key={`toolbar-section-${sectionIndex}`}
                >
                  {entries.map((entry) =>
                    entry.kind === 'overflow'
                      ? renderToolGroup(overflowTools, OVERFLOW_GROUP_KEY, OVERFLOW_IDENTITY)
                      : renderToolGroup(entry.group, entry.key)
                  )}
                </ul>
              ))
            ) : (
              <ul className="grid list-none grid-cols-2 gap-1.5">
                {twoColumnEntries.map((entry) =>
                  entry.kind === 'overflow'
                    ? renderToolGroup(overflowTools, OVERFLOW_GROUP_KEY, OVERFLOW_IDENTITY)
                    : renderToolGroup(entry.group, entry.key)
                )}
              </ul>
            )}
          </div>
        </div>
        <hr className="my-3 shrink-0 border-gray-300 dark:border-gray-700" />

        <div className="flex shrink-0 flex-col items-center mt-4">
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

        <hr className="my-3 shrink-0 border-gray-300 dark:border-gray-700" />
        {/*<Zoom />*/}
      </div>
    </aside>
  );
};

export default SidebarLeft;
