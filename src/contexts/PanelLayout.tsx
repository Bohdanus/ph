import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The Photoshop panel workspace, as far as this shell can express it.
 *
 * ## What Photoshop actually does, and what this models
 *
 * The behaviours below are the documented ones, not inventions. The sources are Adobe's own
 * help pages; where a rule is transcribed from a sibling Adobe application rather than read
 * off a Photoshop page, the comment says so.
 *
 *  - **A dock column is resized from its canvas-side edge.** "To change the width of a dock,
 *    position the pointer on the left edge of the dock until it becomes a double-headed
 *    arrow, and then drag to the left to widen the dock, or to the right to narrow it."
 *    (Adobe Photoshop CC Classroom in a Book, "Resizing panels".) The divider resizes the
 *    WHOLE column, never a single panel inside it.
 *
 *  - **Collapsing a dock to icons is a width, not a button.** "To show only the icons, adjust
 *    the dock width until the labels disappear. Widen the dock to display the labels again."
 *    (https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html)
 *    So the width drag and the collapse are ONE axis, and that is why `dockWidth` below is a
 *    first-class piece of state rather than something derived from a boolean. `isCollapsed`
 *    exists only so the double-arrow can reach the same visual state without discarding the
 *    width the user had chosen.
 *
 *  - **The divider between two stacked groups resizes both.** "When you position the pointer
 *    over dividers between panel groups, resize icons appear. When you drag these icons, all
 *    groups that share the divider are resized. For example, suppose that your workspace
 *    contains three panel groups stacked vertically. If you drag the divider between the
 *    bottom two groups, they are resized, but the topmost group does not change."
 *    (https://helpx.adobe.com/bridge/desktop/workspaces-and-panels/adjust-panels.html — Bridge,
 *    Premiere and After Effects document this with the same wording on the same paneling
 *    engine. Photoshop's own page does not state it, so it is transcribed, not quoted.) With
 *    exactly two groups sharing the divider that is the whole column, which is why
 *    `splitRatio` is a fraction of the column rather than a pixel height per panel.
 *
 *  - **Panels move by their tab, and the drop target is drawn as a blue line.** "To dock a
 *    panel, drag it by it's tab to the edge of another panel or panel group. Release the tab
 *    when a blue highlight appears." (dock-undock-panels) "Drag a panel on to a blue zone to
 *    dock it." (move-panels) So `panelOrder` is the panel's identity moving between slots,
 *    and the insertion affordance is drawn rather than implied.
 *
 *  - **Double-clicking a tab rolls its group up to the tab bar**, and clicking again restores
 *    it. (Adobe Photoshop CC Classroom in a Book; Lesa Snider describes it as rolling "up like
 *    a window shade".) That is `rolledUp`.
 *
 *  - **The Tools panel is draggable to either side, and cannot be resized.** "The Tools panel
 *    appears at the left side of the application window, by default. However, you can dock the
 *    Tools panel to either the right or left sides of the application window or let it float
 *    over the document window area. Unlike most panels in Photoshop, however, you cannot dock
 *    the Tools panel at the bottom of the Photoshop application window or group it with other
 *    panels in panel tab groups." (teachucomp; the CC-era Adobe book states the same rule:
 *    "You cannot resize the Tools panel or options bar.") So `dockOnLeft` is draggable and the
 *    rail's WIDTH deliberately is not — the rail keeps its 108px/56px column layouts, which is
 *    exactly Photoshop's model.
 *
 *  - **Layout persists per workspace.** "In Photoshop, workspaces display your last arrangement
 *    of panels" (restore-workspaces), and a workspace "remembers the size and position of
 *    panels" (CS4 manual). Hence `localStorage` here, with `resetWorkspace` standing in for
 *    `Window > Workspace > Reset`.
 *
 * ## Deliberately NOT modelled
 *
 *  - **Floating panels.** Adobe documents them ("dragging a panel out of its dock creates a
 *    floating panel that you can position anywhere in the workspace",
 *    https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/stack-floating-panels.html)
 *    and a clone that cannot float is a clone that cannot get a panel out of the way. It needs
 *    its own window layer, z-order and off-viewport persistence, so it is a separate piece of
 *    work rather than a flag here.
 *  - **`Tab` / `Shift+Tab`.** "Press Tab to hide all panels... Press Shift + Tab to hide all
 *    panels except the Tools panel and Options bar." (hide-show-panels) This app already binds
 *    Tab to leave an open flyout (`SidebarLeft.tsx`), and a global hide is a different feature
 *    from a drag one.
 *  - **Panel tab GROUPS** (Layers/Channels/Paths as one tabbed group). That is a second axis of
 *    the same drag, and the group model only pays off once a third panel exists.
 *
 * ## Why the split is a fraction and not a pixel height
 *
 * The pre-existing default is `h-[20%]` over `h-[80%]`, and a surprising amount of the e2e
 * suite is calibrated to the letterbox that results — `e2e/text-tool.spec.ts` and
 * `e2e/document-dialogs.spec.ts` both reason about a 922px canvas and the document's position
 * inside it. A pixel height would make the default split drift with the viewport and silently
 * invalidate that calibration. A fraction is also the better behaviour: a user who drags the
 * divider to 40% at one window size keeps roughly 40% when they resize the window, instead of
 * being left with a 200px History panel in a 1200px-tall one.
 */

/** The two panels in the dock. History and Layers are the only two the shell ships. */
export type PanelId = 'history' | 'layers';

/** Top-to-bottom. History first is the pre-existing order, and stays the default. */
export type PanelOrder = readonly PanelId[];

/**
 * Adobe publishes no minimum dock width; the constraint is real but content-driven ("Some
 * panels have a minimum width, which can affect the whole group" — Adobe community, confirming
 * a floor exists without stating a number). These are this app's own floors, chosen to match
 * what its two panels can usefully show, and they are recorded here because nothing upstream
 * does.
 */
export const DOCK_MIN_WIDTH = 40;
export const DOCK_MAX_WIDTH = 640;

/**
 * Below this the dock shows icons only. This is the width axis of Photoshop's three-state
 * collapse: at or above it an icon and a label fit, below it only the icon does.
 */
export const DOCK_LABEL_MIN_WIDTH = 56;

/** Neither panel is useful below this, so the divider stops here rather than past it. */
export const PANEL_MIN_RATIO = 0.12;

/** The pre-existing width. Every default below is chosen so the first render is unchanged. */
export const DEFAULT_DOCK_WIDTH = 250;

/** The pre-existing `h-[20%]` over `h-[80%]`. */
export const DEFAULT_SPLIT_RATIO = 0.2;

interface LayoutState {
  dockWidth: number;
  splitRatio: number;
  panelOrder: PanelOrder;
  rolledUp: Record<PanelId, boolean>;
  dockOnLeft: boolean;
  isCollapsed: boolean;
}

const DEFAULT_STATE: LayoutState = {
  dockWidth: DEFAULT_DOCK_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
  panelOrder: ['history', 'layers'],
  rolledUp: { history: false, layers: false },
  dockOnLeft: false,
  isCollapsed: false,
};

export interface PanelLayout extends LayoutState {
  /** Width the dock occupies. The minimum while collapsed to icons. */
  effectiveDockWidth: number;
  /**
   * Whether the dock is showing icons only. Always equal to `isCollapsed`, because
   * `setDockWidth` is the only path to a narrow dock and it collapses rather than storing a
   * sub-label width.
   */
  isIconOnly: boolean;
  /**
   * Commits a divider drag or an icon-strip click.
   *
   * Narrowing past `DOCK_LABEL_MIN_WIDTH` COLLAPSES rather than storing the narrow width, which
   * is Photoshop's rule rather than a convenience: "To show only the icons, adjust the dock
   * width until the labels disappear. Widen the dock to display the labels again."
   * (collapse-expand-icons) The width the user had chosen is kept in `dockWidth` and comes back
   * when they widen, so dragging the divider down to the icon strip and back is lossless —
   * and that is the same single mechanism the double-arrow uses, which is why there is one
   * boolean and not two paths to an icon strip.
   */
  setDockWidth: (width: number) => void;
  /**
   * Records the width to restore when the column comes back, WITHOUT expanding it.
   *
   * Separate from `setDockWidth` because a divider drag that narrows past a label passes
   * through every width on the way down, and `setDockWidth` stores each one that is still wide
   * enough for a label. Without this, the last of those — a few pixels above the floor — is
   * what comes back when the user widens again, so dragging a 250px dock down to the icon
   * strip and back leaves a 69px dock. `setDockWidth` cannot express "remember this, stay
   * collapsed", because its whole contract is that a wide width means an open column.
   */
  rememberDockWidth: (width: number) => void;
  setSplitRatio: (ratio: number) => void;
  setPanelOrder: (order: PanelOrder) => void;
  /** Rolls a panel's group up to its tab bar, or back down. A double-click on the tab. */
  setRolledUp: (id: PanelId, rolledUp: boolean) => void;
  setDockOnLeft: (onLeft: boolean) => void;
  /** The dock's double-arrow. Collapsing preserves the width the user had chosen. */
  toggleCollapsed: () => void;
  /** `Window > Workspace > Reset`. Returns every field to `DEFAULT_STATE`. */
  resetWorkspace: () => void;
}

/**
 * The value a consumer sees with no provider above it: the opening layout, and setters that do
 * nothing.
 *
 * This follows `RightPanelVisibility`, the other shell-state context these same two components
 * consume, and for the same reason. Both are mounted side by side in `App.tsx`, so a component
 * that reads either is a component the app renders with both; the only way to reach this value
 * is a test rendering the component on its own, and a component that throws there is a
 * component whose every isolated test has to grow a provider it is not otherwise about. A
 * no-op setter keeps that component renderable and honest: it reads the opening layout, which
 * is a true statement about an app with no workspace, and a drag that goes nowhere.
 */
const noProviderValue: PanelLayout = {
  ...DEFAULT_STATE,
  effectiveDockWidth: DEFAULT_STATE.dockWidth,
  isIconOnly: false,
  setDockWidth: () => {},
  rememberDockWidth: () => {},
  setSplitRatio: () => {},
  setPanelOrder: () => {},
  setRolledUp: () => {},
  setDockOnLeft: () => {},
  toggleCollapsed: () => {},
  resetWorkspace: () => {},
};

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

const clampDockWidth = (width: number) => clamp(width, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH);

/**
 * Read a persisted layout, treating anything unrecognised as absent.
 *
 * `ThemeContext` stores a bare string and can guard it with two equality checks. This stores a
 * record, so the equivalent guard is per-field, and a half-valid record is the case that
 * matters: a value that parses but is out of range would otherwise survive a reload and put
 * the dock at a width the user cannot drag back out of. Every field is therefore re-clamped
 * here rather than trusted, and the whole record is discarded if its shape is wrong.
 */
const readStoredLayout = (): Partial<LayoutState> => {
  const raw = localStorage.getItem('panelLayout');
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const record = parsed as Record<string, unknown>;
  const stored: Partial<LayoutState> = {};

  if (typeof record.dockWidth === 'number' && Number.isFinite(record.dockWidth)) {
    stored.dockWidth = clampDockWidth(record.dockWidth);
  }
  if (typeof record.splitRatio === 'number' && Number.isFinite(record.splitRatio)) {
    stored.splitRatio = clamp(record.splitRatio, PANEL_MIN_RATIO, 1 - PANEL_MIN_RATIO);
  }
  if (
    Array.isArray(record.panelOrder) &&
    record.panelOrder.length === 2 &&
    record.panelOrder.includes('history') &&
    record.panelOrder.includes('layers')
  ) {
    stored.panelOrder = record.panelOrder as PanelOrder;
  }
  if (typeof record.rolledUp === 'object' && record.rolledUp !== null) {
    const rolled = record.rolledUp as Record<string, unknown>;
    stored.rolledUp = { history: rolled.history === true, layers: rolled.layers === true };
  }
  if (typeof record.dockOnLeft === 'boolean') {
    stored.dockOnLeft = record.dockOnLeft;
  }
  if (typeof record.isCollapsed === 'boolean') {
    stored.isCollapsed = record.isCollapsed;
  }

  return stored;
};

const PanelLayoutContext = createContext<PanelLayout>(noProviderValue);

export function PanelLayoutProvider({ children }: { children: ReactNode }) {
  // Read once, not per field: five lazy initialisers would each parse the same string.
  const [state, setState] = useState<LayoutState>(() => ({ ...DEFAULT_STATE, ...readStoredLayout() }));

  // One write, one key, in its own effect — the `ThemeContext` idiom (`ThemeContext.tsx:28`).
  // A bare lowercase noun, no namespace, matching the only other persisted key in the app.
  useEffect(() => {
    localStorage.setItem('panelLayout', JSON.stringify(state));
  }, [state]);

  const setDockWidth = useCallback((width: number) => {
    setState((current) => {
      if (width < DOCK_LABEL_MIN_WIDTH) return { ...current, isCollapsed: true };
      return { ...current, dockWidth: clampDockWidth(width), isCollapsed: false };
    });
  }, []);

  // The ratio is a fraction, so both ends are the same clamp: a divider dragged to the very top
  // gives the top panel everything, which is the same as giving the bottom panel nothing.
  const rememberDockWidth = useCallback((width: number) => {
    setState((current) => ({ ...current, dockWidth: clampDockWidth(width) }));
  }, []);

  const setSplitRatio = useCallback((ratio: number) => {
    setState((current) => ({ ...current, splitRatio: clamp(ratio, PANEL_MIN_RATIO, 1 - PANEL_MIN_RATIO) }));
  }, []);

  const setPanelOrder = useCallback((order: PanelOrder) => {
    setState((current) => ({ ...current, panelOrder: order }));
  }, []);

  const setRolledUp = useCallback((id: PanelId, isRolledUp: boolean) => {
    setState((current) => ({ ...current, rolledUp: { ...current.rolledUp, [id]: isRolledUp } }));
  }, []);

  const setDockOnLeft = useCallback((onLeft: boolean) => {
    setState((current) => ({ ...current, dockOnLeft: onLeft }));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setState((current) => ({ ...current, isCollapsed: !current.isCollapsed }));
  }, []);

  const resetWorkspace = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  const value = useMemo<PanelLayout>(
    () => ({
      ...state,
      effectiveDockWidth: state.isCollapsed ? DOCK_MIN_WIDTH : state.dockWidth,
      isIconOnly: state.isCollapsed,
      setDockWidth,
      rememberDockWidth,
      setSplitRatio,
      setPanelOrder,
      setRolledUp,
      setDockOnLeft,
      toggleCollapsed,
      resetWorkspace,
    }),
    [
      state,
      setDockWidth,
      rememberDockWidth,
      setSplitRatio,
      setPanelOrder,
      setRolledUp,
      setDockOnLeft,
      toggleCollapsed,
      resetWorkspace,
    ]
  );

  return <PanelLayoutContext.Provider value={value}>{children}</PanelLayoutContext.Provider>;
}

export function usePanelLayout(): PanelLayout {
  return useContext(PanelLayoutContext);
}
