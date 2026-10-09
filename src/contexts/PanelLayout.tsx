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
 *  - **This clone keeps its two panels pinned to the right edge.** Adobe documents movable and
 *    floating panels, but the product requirement for this editor explicitly retires that
 *    interaction. The panel column remains docked; only its width and shared vertical divider
 *    are draggable.
 *
 *  - **Double-clicking a tab rolls its group up to the tab bar**, and clicking again restores
 *    it. (Adobe Photoshop CC Classroom in a Book; Lesa Snider describes it as rolling "up like
 *    a window shade".) That is `rolledUp`.
 *
 *  - **The Tools rail is pinned to the left edge in this clone.** Adobe documents relocation,
 *    but the current product requirement retires that feature. The rail keeps its 108px/56px
 *    column layouts and cannot be moved or resized.
 *
 *    The sentence this bullet used to quote — "you can dock the Tools panel to either the right
 *    or left sides of the application window or let it float over the document window area" — is
 *    NOT on any Adobe page reachable today. It is widely reproduced on third-party sites, and
 *    quoting it as Adobe's would be a citation this repository cannot re-derive. The panel rule
 *    above says the same thing about the Tools panel and IS verifiable, so that is what is cited.
 *
 *  - **The Tools panel and the panel dock are INDEPENDENT, and each has its own edge.**
 *    `toolsSide` and `dockSide` are two separate facts for a reason that is Adobe's rather than
 *    this app's: "A dock is a collection of panels grouped together vertically" and "To dock a
 *    panel, drag it by it's tab to the edge of another panel or panel group."
 *    (…/learn-the-basics/dock-undock-panels.html) Docking is ADDITIVE — a panel dropped on a
 *    column JOINS that column — so dropping the Tools panel on an edge that already has a dock
 *    puts the two in ONE column as two panel groups, and leaves the other edge alone.
 *
 *    One shared boolean could not express that, and the shape it forced is the bug this replaces:
 *    with a single `dockOnLeft` the rail claimed `[grid-area:left]` exactly when the dock claimed
 *    `[grid-area:right]`, so the two were pinned to OPPOSITE edges and every re-dock of either one
 *    teleported the other. Adobe documents no such exchange, and it is worth being precise about
 *    why: the "you cannot group it with other panels in panel tab groups" half of the old rule is
 *    about TAB GROUPS, and a column of panel groups is precisely not a tab group, so sharing a
 *    column stays legal.
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
 *    work rather than a flag here. `toolsSide` deliberately has no third value: a Tools panel
 *    that could FLOAT is a different state from one docked to either edge, and a `PanelSide`
 *    with a `'floating'` member would let a drag commit a state with no rendering for it.
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

/**
 * Which edge of the window a column sits against.
 *
 * A `'left' | 'right'` rather than a boolean, and two of them rather than one, for the reason the
 * header gives: the Tools rail and the panel dock are separate Adobe-documented subjects with
 * separate edges, and a boolean named after the dock reads as a property OF the dock while
 * silently steering the rail. Naming both facts makes the independence impossible to misread.
 */
export type PanelSide = 'left' | 'right';

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
  /** Compatibility field; the shipped rail is always left-docked. */
  toolsSide: PanelSide;
  /** Compatibility field; the shipped panel dock is always right-docked. */
  dockSide: PanelSide;
  isCollapsed: boolean;
}

const DEFAULT_STATE: LayoutState = {
  dockWidth: DEFAULT_DOCK_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
  panelOrder: ['history', 'layers'],
  rolledUp: { history: false, layers: false },
  toolsSide: 'left',
  dockSide: 'right',
  isCollapsed: false,
};

export interface PanelLayout extends LayoutState {
  /** Width the dock occupies. The minimum while collapsed to icons. */
  effectiveDockWidth: number;
  /**
   * Whether the dock is showing icons only. Always equal to `isCollapsed`.
   *
   * `setDockWidth` and `readStoredLayout` are the only two paths to a sub-label width, and
   * both collapse rather than store one — which is what makes this identity hold, and is why
   * the read path has to collapse too. It once did not, and a stored 45px width became a dock
   * with no way out of the icon strip.
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
  /**
   * Compatibility no-op. Rail relocation is retired.
   */
  setToolsSide: (side: PanelSide) => void;
  /**
   * Compatibility no-op. Panel relocation is retired.
   */
  setDockSide: (side: PanelSide) => void;
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
  setToolsSide: () => {},
  setDockSide: () => {},
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
  let raw: string | null;
  try {
    // `getItem` THROWS, not returns, when storage is blocked by policy or the page is in a
    // sandboxed iframe with no allow-same-origin. The function's contract is "anything
    // unrecognised is treated as absent", and a throw during a `useState` initialiser takes the
    // whole app down rather than degrading to the default layout.
    raw = localStorage.getItem('panelLayout');
  } catch {
    return {};
  }
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

  // The width and the collapse are ONE invariant, and this has to enforce it rather than only
  // clamping each field. A stored `dockWidth` below `DOCK_LABEL_MIN_WIDTH` is a one-way door:
  // the only way out of the icon strip is `setDockWidth(layout.dockWidth)`, which re-collapses
  // on a width that is still under the floor, and the double-arrow that would otherwise widen it
  // is not rendered while collapsed. A hand-edited, stale or cross-version value was enough to
  // reach it, and `Window > Workspace > Reset Essentials` was the only escape.
  //
  // So: collapse on read, exactly as `setDockWidth` does on write, and let the remembered width
  // be the one that will fit again. The second pass is what keeps the dock recoverable — a
  // collapsed 45px dock restores to the label floor, not to 45.
  if (typeof record.dockWidth === 'number' && Number.isFinite(record.dockWidth)) {
    const width = clampDockWidth(record.dockWidth);
    if (width < DOCK_LABEL_MIN_WIDTH) {
      stored.dockWidth = DOCK_LABEL_MIN_WIDTH;
      stored.isCollapsed = true;
    } else {
      stored.dockWidth = width;
    }
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
  // Assigned ONLY when the read recognised a side. An unconditional assignment would put an
  // OWN property holding `undefined` into the result, and the provider seeds state with
  // `{ ...DEFAULT_STATE, ...readStoredLayout() }` — a spread copies own enumerable properties
  // whatever their value, so `toolsSide: undefined` would overwrite the default rather than defer
  // to it. That contradicts this function's own contract ("anything unrecognised is treated as
  // absent") and it is not reachable only from a corrupt record: `{}`, or a record holding
  // nothing but a dock width, both read as absent for every side.
  //
  // It is user-visible rather than a type-level nuisance. `SidebarLeft` branches on
  // `toolsSide === 'left'`, `undefined` is not `'left'`, so such a workspace rendered the tools
  // rail on the RIGHT — and the write effect then `JSON.stringify`ed the `undefined` away, so the
  // record lost both keys and every later load re-derived the same `undefined`. The rail could
  // not get back to the left edge except through a reset.
  // Older workspaces may contain side preferences, but relocation is retired and must not be
  // restored. Normalize both edges to the fixed shell positions.
  stored.toolsSide = 'left';
  stored.dockSide = 'right';
  // Migration from the single shared `dockOnLeft` this replaces, and it has to be a MIGRATION
  // rather than a discard. That one flag did not say which column was where so much as which of
  // the two was where — a stored `true` rendered the rail right and the dock left, and a stored
  // `false` the other way round. Discarding it would silently snap every workspace that had ever
  // been re-docked back to the default arrangement on the next reload, which is the user's layout
  // being replaced by a guess. So a record with no new field and a boolean reads as the pair it
  // used to mean, and the workspace the user had survives the rename intact.
  //
  // Per field rather than all-or-nothing: a record written by a build that had both fields can
  // only be whole, but a hand-edited or partially-written one should not lose a valid side
  // because its sibling was missing.
  // Read LAST, and only when the width did not already decide it. A record that says
  // `isCollapsed: false` beside a 45px width is not a dock that opens — it is a 45px column
  // with both panel groups and their labels, no icon strip, and a control that says
  // "Collapse panels to icons" on a dock already below the floor.
  if (typeof record.isCollapsed === 'boolean' && stored.isCollapsed === undefined) {
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
    try {
      localStorage.setItem('panelLayout', JSON.stringify(state));
    } catch {
      // A blocked or full store means the layout does not survive a reload. That is a
      // degraded feature, not a broken app, and throwing here would take the app down for it.
    }
  }, [state]);

  const setDockWidth = useCallback((width: number) => {
    setState((current) => {
      if (width < DOCK_LABEL_MIN_WIDTH) return { ...current, isCollapsed: true };
      return { ...current, dockWidth: clampDockWidth(width), isCollapsed: false };
    });
  }, []);

  // The ratio is a fraction, so both ends are the same clamp: a divider dragged to the very top
  // gives the top panel everything, which is the same as giving the bottom panel nothing.
  // Clamped to the LABEL floor and no lower. This is a second writer of `dockWidth`, and the
  // one-way door above is a property of `dockWidth` being below the floor with `isCollapsed`
  // false — so a writer that could put it there would reopen the door `setDockWidth` closes.
  const rememberDockWidth = useCallback((width: number) => {
    setState((current) => ({ ...current, dockWidth: Math.max(clampDockWidth(width), DOCK_LABEL_MIN_WIDTH) }));
  }, []);

  // The ratio is a fraction, so both ends are the same clamp: a divider dragged to the very top
  // gives the top panel everything, which is the same as giving the bottom panel nothing. The
  // `PANEL_MIN_RATIO` bound is what actually stops it reaching either end.
  const setSplitRatio = useCallback((ratio: number) => {
    setState((current) => ({ ...current, splitRatio: clamp(ratio, PANEL_MIN_RATIO, 1 - PANEL_MIN_RATIO) }));
  }, []);

  const setPanelOrder = useCallback((order: PanelOrder) => {
    setState((current) => ({ ...current, panelOrder: order }));
  }, []);

  const setRolledUp = useCallback((id: PanelId, isRolledUp: boolean) => {
    setState((current) => ({ ...current, rolledUp: { ...current.rolledUp, [id]: isRolledUp } }));
  }, []);

  // Each writes ONE field and reads no other, which is the property that makes the two subjects
  // independent. They used to share a field, which is why moving one had to invert it to move the
  // other, and why the inversion was easy to get backwards: `SidebarLeft.tsx` carries the note
  // about the two inversions cancelling. With one field each there is nothing to invert.
  const setToolsSide = useCallback(() => {
    // Kept for old consumers; the rail is pinned to the left edge.
  }, []);

  const setDockSide = useCallback(() => {
    // Kept for old consumers; the panel dock is pinned to the right edge.
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
      setToolsSide,
      setDockSide,
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
      setToolsSide,
      setDockSide,
      toggleCollapsed,
      resetWorkspace,
    ]
  );

  return <PanelLayoutContext.Provider value={value}>{children}</PanelLayoutContext.Provider>;
}

export function usePanelLayout(): PanelLayout {
  return useContext(PanelLayoutContext);
}
