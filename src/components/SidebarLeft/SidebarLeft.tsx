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
import { usePanelLayout } from '../../contexts/PanelLayout.tsx';
import { useDockDrag } from '../../hooks/useDockDrag.ts';
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

/**
 * The hold a grouped tile needs before its flyout opens, in milliseconds.
 *
 * Exported rather than inlined at the `setTimeout` because three suites and the Playwright
 * helper had each grown their own copy of the number, which is how `300` came to sit beside a
 * `350` that was only ever compatible by the accident of `300 + 50`. A threshold that is
 * duplicated is a threshold that is changed in one place, and the other place is then either
 * too early (a test that opens a flyout the app has not opened yet) or too late (a wait that
 * outlives the behaviour it is waiting for). One constant, imported by everything that has to
 * agree about it. The Playwright helper still carries a literal, because the `e2e` TypeScript
 * project does not compile `src/`, and its comment says where the authority is.
 *
 * Not the three-dots tile's path, which opens on `pointerdown` with no hold at all — see
 * `onPointerDown` in `renderToolGroup`.
 */
export const FLYOUT_LONG_PRESS_MS = 250;

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

/** How far toward the opposite edge the rail has to travel before the dock will swap with it. */
const RE_DOCK_ZONE = 0.25;

/**
 * The grip that drags the rail to the other edge.
 *
 * Adobe's Photoshop training material describes exactly this control: "the Tool bar can be
 * relocated and even 'docked' to the panels on the right side of the screen. Simply drag it by
 * the grabber handle — when you see the solid blue line next to your panels on the right,
 * release the cursor to 'dock' the panel." (Adobe, Photoshop training: re-locating the tool
 * bar.) So the grip is not an invention, and an earlier version of this comment saying
 * Photoshop has no such control was simply wrong.
 *
 * What the app lacks is the TITLE BAR the gesture starts from — a rail of forty tool tiles with
 * no panel header to drag. Inventing one would put a row of chrome above the tools, which is a
 * different rail from Photoshop's. So the grip goes in the row that already exists for the
 * one/two-column toggle: that is where a user already goes to change the rail's shape, the row
 * keeps its height either way, and the blue drop line is the one the quote describes.
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
  const { dockOnLeft, setDockOnLeft } = usePanelLayout();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [primaryTools, setPrimaryTools] = useState<Record<string, ToolbarTool>>({});
  // ONE column is the default, and that is Photoshop's default: "Tools by default are in a
  // single column" — the double-chevron at the top of the Tools panel switches to two columns
  // to save vertical room, which is only coherent if one column is where you start. It is also
  // the layout that makes overflow possible, which is what the three-dots tile is for.
  //
  // This REVERSES main's default, and the reason main gave for two columns is now gone rather
  // than overridden: main picked it because a one-column rail was taller than the window and
  // therefore scrolled. The rail no longer scrolls — the tiles are fitted to the space they
  // have and the rest move into the three-dots tile — so the axis main was trading along no
  // longer exists, and one column costs height only where the three-dots tile makes up for
  // it. The measured heights and thresholds are in `e2e/toolbar-fit.spec.ts`, which prints
  // them on every run.
  //
  // `min-h-0 overflow-y-auto` on the `<aside>` is still what stops the toolbar from dictating
  // the canvas: a scroll container's automatic minimum size is zero, so the rail's content
  // cannot become the grid row floor and drag the `h-full` canvas up. The scrollbar survives
  // as a backstop for a rail whose chrome alone is taller than the window.
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
  /**
   * The rail itself, for horizontal overlay placement: a flyout opens off its ANCHOR's
   * trailing edge, and on the two-column rail that anchor can be a tile in the LEFT-hand
   * column, whose trailing edge is nowhere near the panel's. The rail is what an overlay has
   * to get clear of, and this is how Photoshop hangs a tool flyout too.
   *
   * An earlier version of this comment claimed the tiles sit on a 108px grid inside a
   * NARROWER content box, so a second-column tile starts past the rail's own right edge and
   * the rail has to be measured to find out. The claim was false in both layouts — the tools
   * box is exactly as wide as the rail, and a second-column tile starts well INSIDE it — but
   * the mechanism it justified is real, and this is the reason: a tile is not the rail, and
   * which tile the flyout happens to hang off is not a thing the overlay may assume.
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
   * The key a group is rendered and looked up under, in whichever layout is active.
   *
   * ONE function, because the two callers disagreed and the disagreement was invisible until
   * a layout other than the default was exercised. `toolbarSlots` built two-column keys while
   * `overflowTools` asked about one-column keys, so in the two-column rail the collapse
   * matched nothing: the three-dots tile came out holding an empty list, `hasFlyout` was
   * false, and a plain click on it read `tool.figure` off `undefined` and threw. Every e2e
   * spec runs at the default one column, so nothing caught it.
   *
   * The two-column key is the group's index in the FLATTENED list, because that grid
   * interleaves the sections and a section-and-group pair has no meaning there. So the flat
   * offsets are computed once rather than re-derived at every lookup.
   */
  const groupKey = useMemo(() => {
    if (isSingleColumnMode) return oneColumnGroupKey;
    // Offset of the first group of each section, so a (section, group) pair maps to its flat
    // index in one addition. `toolbarMap` is the source of the lengths, so this cannot drift
    // from the grid the two-column branch actually renders.
    const sectionOffsets: number[] = [];
    toolbarMap.reduce((offset, section) => {
      sectionOffsets.push(offset);
      return offset + section.length;
    }, 0);
    return (sectionIndex: number, groupIndex: number) => twoColumnGroupKey(sectionOffsets[sectionIndex] + groupIndex);
  }, [isSingleColumnMode]);

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
        section.map((_group, groupIndex) => ({ keys: [groupKey(sectionIndex, groupIndex)], sectionIndex }))
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
  }, [isSingleColumnMode, groupKey]);

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
   *
   * Keyed through {@link groupKey}, which is what makes it correct in both layouts.
   */
  const overflowTools = useMemo(() => {
    const tools: ToolbarTool[] = [];
    toolbarMap.forEach((section, sectionIndex) => {
      section.forEach((group, groupIndex) => {
        if (!collapsedGroups.has(groupKey(sectionIndex, groupIndex))) return;
        tools.push(...group);
      });
    });
    return tools;
  }, [collapsedGroups, groupKey]);

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
  /** Whether the last press turned into a drag, so its synthesised click is not also a swap. */
  const railDragMovedRef = useRef(false);

  const onRailDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      reDockOriginXRef.current = event.clientX;
      railDragMovedRef.current = false;
      reDockTargetRef.current = null;
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
      // 3px, the same threshold `PanelGroup` uses for its own drag. Below it the press is a
      // click, and a click here is a swap, so the flag has to be set before the drop target is
      // or a twitch at the origin reads as a completed re-dock.
      if (Math.abs(dx) > 3) railDragMovedRef.current = true;
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
    }, FLYOUT_LONG_PRESS_MS);
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
          side={overlaySide}
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
                // A tile with an `identity` selects nothing, ever. Its press has already opened
                // the menu, so the only way to arrive here is a click with no press behind it —
                // a KEYBOARD activation, or a click the browser synthesised after a press that
                // was already consumed. Both mean "open the menu", never "pick a tool": the
                // three-dots tile has no default tool, and `group[0]` standing in for one is
                // the same liability its `identity` exists to remove.
                if (identity !== undefined) {
                  openFlyout(groupIndex);
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
              // The three-dots tile opens on PRESS, with no hold, and the click that follows
              // must select nothing. It is the one tile that stands for no tool, so there is no
              // "default tool" a plain click could honestly mean — and a hold on the one tile
              // whose entire job is to be the way IN to the hidden tools makes the way in feel
              // broken, because the tile the user is reaching for is the one that does not
              // answer. Photoshop's own `…` opens on press for the same reason.
              //
              // `ignoreNextClickRef` is set here as well as by `onPointerUp`, because the
              // pointer can be released outside the button (a press that slides off) and the
              // click then never fires while a tool has still been selected. `openFlyout` sets
              // `longPressOpenedRef`, so the ordinary `onPointerUp` path would normally cover
              // it; setting it up front is what makes "selects nothing" a property of the
              // PRESS rather than of the release.
              if (identity !== undefined) {
                clearLongPressFlyout();
                ignoreNextClickRef.current = true;
                if (isOpen) closeFlyout();
                else openFlyout(groupIndex);
                return;
              }
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
          <AnchoredOverlay
            align="start"
            anchor={flyoutAnchor.element}
            measureKey={groupIndex}
            side={overlaySide}
            xAnchor={railElement}
          >
            <ul
              aria-label={
                identity !== undefined
                  ? 'More tools'
                  : group.some((tool) => tool.figure)
                    ? 'Shape tools'
                    : `${primaryTool.label} tools`
              }
              /**
               * Bounded to the viewport, and scrolling within it, because the three-dots tile
               * can hold thirty-odd tools and a menu that tall cannot be reached.
               *
               * `AnchoredOverlay` clamps the overlay's POSITION and never its size: with a
               * 1374px menu in a 720px window the clamp resolves to the viewport padding, the
               * menu starts at the top edge and runs off the bottom, and because the overlay
               * is `position: fixed` in the body there is no ancestor to scroll — so every
               * tool past the first dozen or so was off-screen and unreachable, with no
               * scrollbar and nothing in the DOM to say so. That defeats the entire point of
               * a tile whose job is to keep the tools that do not fit reachable.
               *
               * The bound is a viewport unit rather than a pixel constant so it needs no
               * measurement and no re-render: the menu shrinks on its own when the window
               * does. `max-h` rather than `h` because a short menu must not be padded out to
               * fill the window.
               *
               * DENSITY, in the same comment because the next person will otherwise ask why
               * this is smaller than the rail's tiles. A flyout row is 24.5px, where the
               * rail's tile is 44px — and the operator asked for the flyout at Photoshop's
               * density, which is the compact one, the tile being the comfortable one. At
               * tile density the menu put three tools in the space two belong in.
               *
               * WHAT IS MEASURED AND WHAT IS CHOSEN, because they are not the same claim: in
               * Chrome at 1280x900 this is a 24.5px row and an 80px three-item menu, measured,
               * where it was a 40px row and 134px. The numbers are DESIGN values, not
               * measurements — and no document in this repo records Photoshop's own flyout row
               * height, so nothing here should be read as one; the target was the operator's
               * instruction and this is the density it produced.
               *
               * AND THE HEIGHT IS NOT THE ICON'S TO SET, which is the part that is easy to get
               * wrong twice. A row's height is `max(icon, label line box) + padding`, and
               * Tailwind's preflight puts `line-height: 1.5` on `html`, so an 11px label's
               * line box is 16.5px — half a pixel TALLER than the 16px icon. Forcing the icon
               * to `0` leaves the row at 24.5px. What the override actually buys is the other
               * direction: without it the icon is 28px and the row is 36px, so the row's height
               * is set by whichever of the two is larger, and the override lowers the ceiling
               * rather than the floor.
               *
               * `min-w-36` so a two-tool menu is not a sliver, which it needs because the
               * labels are `whitespace-nowrap` and cannot wrap to fit. It cannot outgrow the
               * viewport either: the rail is `max-md:hidden`, so the narrowest window that can
               * show a flyout at all is 768px. The width above that minimum is content-sized —
               * the longest label plus its icon, gaps and shortcut.
               */
              className="pointer-events-auto max-h-[calc(100vh-1rem)] min-w-36 list-none overflow-y-auto overscroll-contain rounded-lg border border-gray-300 bg-gray-100 p-0.5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
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
                      // `[&_svg]:!h-4 [&_svg]:!w-4` is what keeps the row off tile density.
                      // The icons are sized by `IconShell`, which is fixed at `h-7 w-7` with no
                      // prop, because a RAIL tile is 44px and its icon has to fill it — so the
                      // menu cannot ask the icon for a smaller one and has to override it from
                      // here. Left at 28px it becomes the LARGER of the row's two height terms
                      // and the row is 36px; at 16px the LABEL's line box is what sets the
                      // 24.5px. The override lowers the row's ceiling, not its floor.
                      //
                      // The `!` is NOT what makes the override win, and the comment this
                      // replaces said it was. It does not need to: `.[&_svg]:!h-4 svg` is
                      // specificity (0,1,1) against `.h-7`'s (0,1,0), so it wins on
                      // specificity alone inside `@layer utilities` whatever order the two are
                      // emitted in — both orders were compiled, and the descendant selector
                      // wins either way. It is kept deliberately, as a tripwire against a
                      // future single-class rule landing at the same specificity, and a test
                      // pins it, so dropping it reads as the change it is rather than tidying.
                      //
                      // It reaches one icon by accident worth recording: `MoreToolsIcon` is
                      // the only rail icon that bypasses `IconShell` (24px,
                      // `overflow: hidden`). It is never a row child — rows take
                      // `getToolIcon(tool)` — so it is untouched today, and it is the one thing
                      // that would break if a row ever rendered an `identity.Icon`.
                      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[11px] transition-colors [&_svg]:!h-4 [&_svg]:!w-4 ${
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
                      {tool.shortcut && <kbd className="text-[9px] opacity-65">{tool.shortcut}</kbd>}
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
      // The other `complementary` landmark. Unnamed, a screen reader announces two
      // indistinguishable regions, and one of them holds every tool in the app.
      aria-label="Tools"
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
      {/* `h-full`, and that is the change that makes the fit possible. A flex column sized by
          its CONTENT has no height for `flex-1` to divide: the tools slot would be handed
          whatever the tools happened to need, so the fit would measure its own output and
          agree with it, and nothing would ever collapse. Giving the column the rail's own
          height makes the slot the leftover after the chrome, which is a number nothing inside
          the slot can influence.

          This reverses main's `min-h-full` deliberately, and main's reason for it is answered
          rather than overruled. `min-h-full` was right while the rail SCROLLED: `h-full` on a
          child of a scroll container resolves against the container's own height, which left
          the colour swatches unpainted at the bottom of a long rail. The rail no longer scrolls
          — the tiles are fitted to the space they have and the rest move into the three-dots
          tile — so there is no long rail left to paint the bottom of. `scrollbar-none` and
          `overflow-y-auto` both survive on the `<aside>` as the backstop they are now: a rail
          whose chrome alone is taller than the window, which is the only case the scrollbar can
          still answer.

          THE SEAM FOR A PANEL WITH A HEIGHT OF ITS OWN, which the panel workspace on main has
          not reached because Adobe's Tools panel cannot be resized ("You cannot resize the
          Tools panel or options bar") and is only draggable between edges. Everything the
          overflow rule does is written against `left-toolbar-slot` — its height, and nothing
          else — and never against `innerHeight` or the rail's own box, so giving the rail a
          height of its own needs exactly this one change: the column stops being `h-full` and
          the slot stops being `flex-1`, and takes that height instead. Nothing in
          `toolbar-overflow.ts` or `toolbar-fit-store.ts` moves, and
          `SidebarLeft.overflow.test.tsx` asserts the property that makes it so — a different
          window at the same slot height does not change the fit. */}
      {/* No `px-*` on this column, and the omission is arithmetic rather than taste. The tools
          box below is as WIDE as the rail (`w-14` against a `3.5rem` aside, `w-[6.75rem]`
          against `6.75rem`) and the slot centres it, so its x-position is
          `(rail − border − itemWidth) / 2` — negative half a pixel, i.e. flush to both edges.
          The padding therefore had nothing to pad: it moved no box horizontally and only
          squeezed the header row's two buttons into 23px of content. It was 12px of
          appearance and zero of geometry.

          `py-2` rather than the `py-4` this replaced, because the vertical padding is the
          part that is real: 16px of nothing above the header and 16px below the bottom
          cluster is 32px of window the rail was spending on air. That is tool budget, and the
          fit sees it directly: the slot is `flex-1`, so every pixel of column padding lands
          in `slot.getBoundingClientRect().height`, which is the first term of
          `availableHeight` (`toolbar-fit-store.ts`). The tools box's own chrome is the part
          the fit subtracts separately, and this change takes 14px off THAT one as well. */}
      <div className="flex h-full flex-col items-center py-2">
        <div className="mb-1 flex w-full shrink-0 items-center justify-between">
          {!isTablet && (
            <button
              {...railDrag.handleProps}
              aria-label="Move the toolbar to the other side"
              className="cursor-grab rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 active:cursor-grabbing dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              // The keyboard path, and the reason this is a `<button>` at all rather than a
              // decorative `<div>`. Dragging needs a pointer; this control is announced, sits in
              // the tab order, and is next to a sibling that works on click — so a button with no
              // activation is a promise it does not keep. It was dead for a MOUSE user too, not
              // only a keyboard one: `onRailDragEnd` only commits once the pointer has moved, so a
              // plain click on the grip did nothing.
              //
              // `railDragMovedRef` keeps a drag from also counting as a click. A `<button>`
              // synthesises a click from any pointerdown+pointerup on it, including one that
              // travelled to the opposite edge, so without this a completed drag swapped on the
              // release and then swapped again on the click — landing the rail where it started.
              onClick={() => {
                if (railDragMovedRef.current) {
                  railDragMovedRef.current = false;
                  return;
                }
                setDockOnLeft(!dockOnLeft);
              }}
              title="Drag to the other side, or press Enter"
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
          // `overflow-y-auto`, not `overflow-hidden`, and the difference is the difference
          // between a tile that is somewhere else and a tile that is gone. The fit already
          // keeps the tiles inside the slot — it reserves a row for the three-dots tile and
          // then fills no more than the 80% budget — so this scrollbar never appears. It is
          // here so that IF the arithmetic is ever wrong, the tools it misjudged are still
          // reachable by scrolling rather than clipped out of existence. A rail that could
          // hide a tool is a worse failure than a rail that scrolls.
          //
          // `scrollbar-none` is main's, and it MOVED with the scroll container rather than
          // staying put on the `<aside>`. The aside is no longer the thing that scrolls: with
          // the tiles fitted, the rail fits its row and `e2e/no-document-overflow.spec.ts`
          // measures its overflow at 0, so a suppression left on the aside would be suppressing
          // nothing while the element that can actually overflow paints a bar. The slot is
          // narrow — 56px — and the degenerate band is where it goes, so the window is small,
          // but "the last tile is unreachable" is not a trade worth a pixel-wide bar.
          className="scrollbar-none flex min-h-0 w-full flex-1 justify-center overflow-y-auto"
          data-testid="left-toolbar-slot"
          ref={attachSlot}
        >
          {/* Width and nothing else. This used to be a framed panel of its own — a second,
              lighter fill, a rounded border and an inset shadow, 6px of padding inside it —
              and the rail read as a small card floating in a wider panel, which is the one
              thing the real rail never is: its tools sit directly on the panel, and the panel
              is ONE surface with a single fill. The box survives only as the element the fit
              measures, because `attachTools` needs a box to read `toolsChrome` from and
              `data-testid="left-toolbar-tools"` is what specs and helpers select on.

              Dropping the padding and the border is not a loss to the overflow fit, it is a
              gain: `toolsChrome` is read from computed style rather than hardcoded
              (`toolbar-fit-store.ts`), so 14px of chrome leaves the measurement and becomes
              14px of tile budget. The width stays put on purpose — the box being exactly the
              rail's width is what keeps its content flush to both edges, and both
              `w-14`/`w-[6.75rem]` track the aside's own `toolbarWidth`. */}
          <div
            className={isSingleColumnMode ? 'w-14' : 'w-[6.75rem]'}
            data-testid="left-toolbar-tools"
            ref={attachTools}
          >
            {isSingleColumnMode ? (
              singleColumnSections.map(({ sectionIndex, entries }) => (
                <ul
                  // `justify-items-center` because the box gave up its padding and a 44px tile
                  // no longer fills what is left of the track. The grid's tracks are sized by
                  // free space (`repeat(n, minmax(0, 1fr))`), not by the item, so the track
                  // got WIDER while the tile stayed 44px — without this the tile would sit
                  // hard against the left edge of the panel.
                  //
                  // What it does move, stated because it is not nothing: `justify-items:
                  // center` switches the `<li>` from `stretch` to fit-content, so the `<li>`
                  // narrows to the tile and each tile shifts right by the slack (6px in one
                  // column, 3.5px in two). Nothing measures any of that — the fit reads only
                  // `availableHeight`, `tileHeight`, `rowGap` and `sectionBreakHeight`, all
                  // vertical, and a flyout is anchored to the RAIL's rect, not to a tile's —
                  // but the tool tooltip hangs off the tile's own trailing edge, so it moves
                  // with the tile. Centred is the placement the real rail uses.
                  className={`grid list-none grid-cols-1 justify-items-center gap-1.5 ${entries.length > 0 && sectionIndex > 0 ? 'mt-1.5 border-t border-gray-300 pt-1.5 dark:border-gray-700' : ''}`}
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
              <ul className="grid list-none grid-cols-2 justify-items-center gap-1.5">
                {twoColumnEntries.map((entry) =>
                  entry.kind === 'overflow'
                    ? renderToolGroup(overflowTools, OVERFLOW_GROUP_KEY, OVERFLOW_IDENTITY)
                    : renderToolGroup(entry.group, entry.key)
                )}
              </ul>
            )}
          </div>
        </div>
        {/* One rule, not two, and 8px of margin instead of 12. The rail carries a single
            divider: it separates the tools from the colour cluster, which is the only
            boundary in the rail that is a boundary. The second `<hr>` this replaces stood
            between the colour cluster and NOTHING — the commented-out Zoom control that
            followed it was deleted with it, so nothing renders below the cluster at all — so
            it spent 24px of margin (`my-3` is 12px a side) and a 1px hairline painting a rule
            across the bottom of the panel for no division at all. */}
        <hr className="my-2 shrink-0 border-gray-300 dark:border-gray-700" />

        <div className="flex shrink-0 flex-col items-center">
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
      </div>
    </aside>
  );
};

export default SidebarLeft;
