import { useCallback, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useRightPanelVisibility } from '../../contexts/RightPanelVisibility.tsx';
import { DOCK_LABEL_MIN_WIDTH, usePanelLayout, type PanelId } from '../../contexts/PanelLayout.tsx';
import { edgePlacement } from '../../util/edge-placement.ts';
import { useDockDrag } from '../../hooks/useDockDrag.ts';
import LayersTab from './LayersTab.tsx';
import HistoryTab from './HistoryTab.tsx';
import PanelGroup from './PanelGroup.tsx';

/**
 * The right-hand dock: two panel groups you can resize, reorder, roll up and re-dock.
 *
 * ## Why the width lives on the element and not on the grid track
 *
 * This is the pre-existing arrangement and the reasoning has not changed, only the number
 * being applied. The shell's grid tracks are `auto` (see `App.tsx`), and "the panel therefore
 * has to live on the element, not on the track" is what makes the tablet collapse work at all:
 * `SidebarRight.tsx:14` returns a `display: none` aside when the panel is collapsed, and a
 * `display: none` item contributes nothing to an `auto` track but 250px of nothing to a fixed
 * one. Moving the width into state keeps that property and adds a number the user chooses.
 *
 * The number is applied unconditionally rather than desktop-only, because the tablet band
 * mirrors the desktop panel by definition — the previous `max-lg:w-[250px]` existed for exactly
 * that reason.
 *
 * ## Why the aside is not `overflow: hidden` any more
 *
 * The resize handle sits ON the dock's canvas-side edge, which is where Photoshop puts it and
 * the only place the pointer is unambiguously "on the divider". It is `absolute` with a
 * `left-0` or `right-0`, so it lies WITHIN the aside's padding box: an earlier version of this
 * comment claimed the handle sat half outside at `left: -4px`, which no rule in this file ever
 * did, and `overflow: hidden` would therefore not have clipped it. The e2e measurement says so
 * directly — the handle lands 1px inside the 1px border.
 *
 * The clipping moved inward anyway, to the column that genuinely needs it, and the reason is
 * not the handle. The dock-edge drop line is `position: fixed` and renders as a SIBLING of that
 * column; an `overflow: hidden` aside is not a containing block for it either, but it is one
 * step closer to becoming one, and the aside is the element most likely to acquire a transform
 * if the rail's re-dock ever animates. The panel groups keep exactly the clipping they had.
 *
 * ## The panel drag does two things
 *
 * One gesture, two destinations, because that is the gesture Photoshop has. Dragging a tab
 * vertically inside the column reorders it; dragging it at the opposite workspace edge moves
 * the whole dock to that edge. Adobe: "To dock a panel, drag it by it's tab to the edge of
 * another panel or panel group. Release the tab when a blue highlight appears" and "To create
 * a dock, move panels to the right edge of the workspace until a drop zone appears." Both drop
 * targets are drawn as a blue line before the release, never after.
 */

/**
 * Neither panel is useful below this, so the divider stops here rather than past it.
 *
 * `PanelLayout` expresses the same floor as `PANEL_MIN_RATIO`, a fraction. They are two
 * expressions of one constraint and they do not agree: the ratio is the PERSISTED clamp, so a
 * split that is reachable at a tall window is not necessarily reachable at a short one, where
 * the pixel floor below is the tighter of the two and wins. The persisted value is still in
 * bounds, so this is a felt asymmetry rather than a broken one — but the two constants are the
 * reason a divider can refuse a drag that a previous session accepted, and they are named for
 * what they are rather than unified because unifying them would make the persisted clamp depend
 * on the window the user happened to have.
 */
const PANEL_MIN_HEIGHT = 88;

/** How far out toward the opposite edge a tab has to travel before the dock will follow it. */
const RE_DOCK_ZONE = 0.25;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

const PANEL_TITLES: Record<PanelId, string> = { history: 'History', layers: 'Layers' };

/** 14px square glyphs, so an icon strip at the 40px minimum is not dominated by one. */
const HistoryGlyph = () => (
  <svg
    aria-hidden="true"
    className="h-3.5 w-3.5"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </svg>
);

const LayersGlyph = () => (
  <svg
    aria-hidden="true"
    className="h-3.5 w-3.5"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M8 1.5 14.5 5 8 8.5 1.5 5 8 1.5Z" />
    <path d="M1.5 8 8 11.5 14.5 8" />
    <path d="M1.5 11 8 14.5 14.5 11" />
  </svg>
);

const PANEL_GLYPHS: Record<PanelId, () => React.JSX.Element> = {
  history: HistoryGlyph,
  layers: LayersGlyph,
};

const SidebarRight = () => {
  const [{ hasImage, toolName }] = useStore();
  const { isOpen } = useRightPanelVisibility();
  const layout = usePanelLayout();

  const dockRef = useRef<HTMLElement | null>(null);

  /** Panel whose tab is being dragged, plus where that drag would currently land. */
  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const [edgeTarget, setEdgeTarget] = useState<'left' | 'right' | null>(null);
  const dragOriginXRef = useRef(0);
  // The same three, for the commit to read. See `onPanelDragEnd`.
  const draggingPanelRef = useRef<PanelId | null>(null);
  const insertionIndexRef = useRef<number | null>(null);
  const edgeTargetRef = useRef<'left' | 'right' | null>(null);

  /** Where the column was and how tall when a divider drag began, so deltas convert to a ratio. */
  const splitterStartRef = useRef<{ ratio: number; height: number } | null>(null);
  const dockWidthStartRef = useRef(0);
  /** The width the last move asked for, which is what tells a collapse from a resize. */
  const lastColumnWidthRef = useRef(0);
  /** The width a collapse must restore: the remembered one, not the on-screen one. */
  const rememberedWidthRef = useRef(0);

  // Measured from the WIDTH ON SCREEN, not the remembered one. The handle is rendered on the
  // collapsed 40px strip too, and `dockWidth` is the width to come BACK to (250, say) while
  // `effectiveDockWidth` is the 40 it currently occupies. Measuring from the remembered width
  // meant one pixel of movement opened a 250px dock and overwrote the 250 with 251 — a 211px
  // jump, and the user's width gone. Cancelling such a drag had the same defect: Escape called
  // `setDockWidth(250)`, which UN-collapses, so it changed the value rather than restoring it.
  const onColumnResizeStart = useCallback(() => {
    dockWidthStartRef.current = layout.effectiveDockWidth;
    // The width to come BACK TO, which is not the width on screen once the dock is collapsed.
    // Recording only the effective one and feeding it to `rememberDockWidth` at the end meant a
    // bare click on the collapsed strip's handle — a press with no movement, which starts a
    // gesture because nothing here has a movement threshold — remembered 40 and clamped it to
    // the label floor, so the dock opened at 56px instead of the 250 the user had chosen.
    rememberedWidthRef.current = layout.dockWidth;
  }, [layout.dockWidth, layout.effectiveDockWidth]);

  const onColumnResize = useCallback(
    ({ dx }: { dx: number }) => {
      // The dock sits to the canvas's right by default, so dragging the divider LEFT widens it.
      // When the dock is on the left edge the divider is on its other side and the sign flips.
      const delta = layout.dockSide === 'left' ? dx : -dx;
      const next = dockWidthStartRef.current + delta;
      lastColumnWidthRef.current = next;
      layout.setDockWidth(next);
    },
    [layout]
  );

  const onSplitterStart = useCallback(() => {
    splitterStartRef.current = {
      ratio: layout.splitRatio,
      height: dockRef.current?.getBoundingClientRect().height ?? 0,
    };
  }, [layout.splitRatio]);

  const onSplitterDrag = useCallback(
    ({ dy }: { dy: number }) => {
      const start = splitterStartRef.current;
      // A zero-height dock cannot be divided, and dividing by it would write Infinity into the
      // ratio. The clamp below would absorb it, but the arithmetic is better not to happen.
      if (start === null || start.height <= 0) return;
      const floor = Math.min(0.5, PANEL_MIN_HEIGHT / start.height);
      const next = start.ratio - dy / start.height;
      layout.setSplitRatio(clamp(next, floor, 1 - floor));
    },
    [layout]
  );

  const onPanelDragStart = useCallback(
    (id: PanelId) => (event: React.PointerEvent<HTMLElement>) => {
      draggingPanelRef.current = id;
      setDraggingPanel(id);
      dragOriginXRef.current = event.clientX;
      // `null` until the pointer has actually MOVED. Setting it on the press showed a blue
      // drop line on a bare click, which promises a drop target for a gesture that is not
      // happening and is not going to.
      insertionIndexRef.current = null;
      setInsertionIndex(null);
      edgeTargetRef.current = null;
      setEdgeTarget(null);
    },
    []
  );

  const onPanelDrag = useCallback(
    (id: PanelId) =>
      ({ dx, dy }: { dx: number; dy: number }) => {
        const order = layout.panelOrder;
        const index = order.indexOf(id);
        const dock = dockRef.current;
        const height = dock?.getBoundingClientRect().height ?? 0;

        // The edge test comes first and wins: past the threshold the dock is being thrown at the
        // other side of the window, and a reorder indicator on top of that would be a lie about
        // what the drop will do.
        const pointerX = dragOriginXRef.current + dx;
        const viewportWidth = document.documentElement.clientWidth;
        const wantsLeft =
          layout.dockSide === 'left'
            ? pointerX > viewportWidth * (1 - RE_DOCK_ZONE)
            : pointerX < viewportWidth * RE_DOCK_ZONE;
        if (wantsLeft) {
          edgeTargetRef.current = layout.dockSide === 'left' ? 'right' : 'left';
          setEdgeTarget(edgeTargetRef.current);
          insertionIndexRef.current = null;
          setInsertionIndex(null);
          return;
        }
        edgeTargetRef.current = null;
        setEdgeTarget(null);

        if (height <= 0) return;
        // Past the middle of the column is the other slot. A threshold rather than a live
        // measurement of the neighbour, because the neighbour is what is being swapped with and
        // it moves as the swap is previewed.
        const midpoint = index === 0 ? height / 2 : -height / 2;
        const next = dy > midpoint ? 1 : dy < midpoint ? 0 : index;
        insertionIndexRef.current = next;
        setInsertionIndex(next);
      },
    [layout.dockSide, layout.panelOrder]
  );

  // `cancelled` is honoured for BOTH destinations, and it is not optional bookkeeping. A panel
  // drag previews its outcome continuously, so the state it is about to write is already on
  // screen; committing it on an Escape would commit something the user just took back.
  const onPanelDragEnd = useCallback(
    (cancelled: boolean) => {
      if (cancelled) {
        draggingPanelRef.current = null;
        insertionIndexRef.current = null;
        edgeTargetRef.current = null;
        setDraggingPanel(null);
        setInsertionIndex(null);
        setEdgeTarget(null);
        dragOriginXRef.current = 0;
        return;
      }
      // Read through refs, for the reason `SidebarLeft` gives at length: the hook refreshes
      // its callback ref in a PASSIVE effect, and a `pointerup` that arrives before that effect
      // flushes would commit the previous gesture's target — a silently dropped re-dock, or a
      // reorder into the wrong slot. The outcome is previewed continuously on screen, so the
      // commit is reading which preview is showing, and the preview is state.
      if (edgeTargetRef.current !== null) {
        // The dock's own destination, mapped straight through. It used to be inverted, because
        // one shared flag said which of the TWO columns was on the left rather than where the
        // dock was, so throwing the dock at an edge had to write the rail's position to say so.
        // `setDockSide` writes the dock's edge, so nothing is inverted here.
        layout.setDockSide(edgeTargetRef.current);
      } else if (draggingPanelRef.current !== null && insertionIndexRef.current !== null) {
        const order = [...layout.panelOrder];
        const from = order.indexOf(draggingPanelRef.current);
        // `splice` on a copy, because `PanelOrder` is a readonly tuple: the state is the order,
        // and a caller that could mutate it in place would make every comparison of it suspect.
        if (from !== -1 && from !== insertionIndexRef.current) {
          const [moved] = order.splice(from, 1);
          order.splice(insertionIndexRef.current, 0, moved);
          layout.setPanelOrder(order);
        }
      }
      draggingPanelRef.current = null;
      insertionIndexRef.current = null;
      edgeTargetRef.current = null;
      setDraggingPanel(null);
      setInsertionIndex(null);
      setEdgeTarget(null);
      dragOriginXRef.current = 0;
    },
    [layout]
  );

  // A resize is written continuously, so a cancelled one has to be rolled back to where the
  // divider started — otherwise Escape leaves the column wherever the last pointermove put it,
  // which is the one outcome a cancel exists to prevent.
  const columnDrag = useDockDrag({
    onStart: onColumnResizeStart,
    onMove: onColumnResize,
    onEnd: (cancelled) => {
      if (cancelled) {
        // Below the floor means "put it back collapsed", and `setDockWidth` is what knows how.
        // Passing the starting width back through it is the only way to restore the collapsed
        // state rather than to expand past it.
        layout.setDockWidth(dockWidthStartRef.current);
        return;
      }
      // Narrowing past a label collapsed the column, and the width to come back to is the one
      // the DRAG started from. `setDockWidth` stores every width above the threshold on the way
      // down, so without this the last thing it stored is whatever sat a few pixels above the
      // label floor — dragging a 250px dock down to the icon strip and back would then leave a
      // 69px dock rather than the 250px one the user had.
      if (lastColumnWidthRef.current < DOCK_LABEL_MIN_WIDTH) {
        layout.rememberDockWidth(rememberedWidthRef.current);
      }
    },
  });
  const splitterDrag = useDockDrag({
    onStart: onSplitterStart,
    onMove: onSplitterDrag,
    onEnd: (cancelled) => {
      if (cancelled && splitterStartRef.current !== null) layout.setSplitRatio(splitterStartRef.current.ratio);
    },
  });

  // `hidden` rather than a conditional return, so the column collapses to zero in the tablet band
  // while `Main` keeps its place. Always true on desktop: there `isCollapsible` is false and
  // `isOpen` is unconditionally true, so this is a no-op.
  //
  // The placement classes ride along on this collapsed strip and on the spacer below, and the
  // honest reason is thin: a `display: none` element generates no box, so it contributes nothing
  // to its `auto` track WHETHER OR NOT it carries `grid-column-start`. Dropping them would
  // change nothing measurable today. They are kept because the branch is a stand-in for the real
  // panel and the two should not differ in the one property that decides which edge the column
  // lives on — but the earlier version of this comment claimed the track would fail to collapse
  // without them, and that is not true.
  if (!isOpen) {
    const dockPlacement = edgePlacement(layout.dockSide, 'full');
    return <aside id="right-panel" className={`hidden ${dockPlacement}`} />;
  }

  if (!toolName || !hasImage) {
    const dockPlacement = edgePlacement(layout.dockSide, 'full');
    return (
      <aside
        id="right-panel"
        className={`relative bg-gray-100 dark:bg-gray-800 dark:border-gray-700 max-md:hidden ${
          layout.dockSide === 'left' ? 'border-r border-gray-300' : 'border-l border-gray-300'
        } ${dockPlacement}`}
        style={{ width: layout.effectiveDockWidth }}
      >
        <div className="p-3"></div>
      </aside>
    );
  }

  // The divider is on the dock's CANVAS side, which is the side the canvas is on. With the
  // dock in the right column that is its left edge, and with the dock on the left it is its
  // right one. Inverted, the handle lands on the dock's outer edge — against the window
  // border, where it is unreachable and reads as a resize grip for nothing.
  const handleSideClass = layout.dockSide === 'left' ? 'right-0 border-r-2' : 'left-0 border-l-2';

  const dockPlacement = edgePlacement(layout.dockSide, layout.dockSide === layout.toolsSide ? 'bottom' : 'full');

  const renderPanel = (id: PanelId, index: number) => {
    const isRolledUp = layout.rolledUp[id];
    const share = index === 0 ? layout.splitRatio : 1 - layout.splitRatio;
    return (
      <PanelGroup
        className={index === 0 ? 'border-b border-gray-300 dark:border-gray-600' : ''}
        id={id}
        isDragging={draggingPanel === id}
        isRolledUp={isRolledUp}
        key={id}
        onDrag={onPanelDrag(id)}
        onDragEnd={onPanelDragEnd}
        onDragStart={onPanelDragStart(id)}
        onToggleRolledUp={() => layout.setRolledUp(id, !isRolledUp)}
        // A rolled-up group takes only its tab bar; an expanded one takes its ratio of the
        // column. `flex-basis: 0` with a growing factor is what makes 0.2/0.8 land on exactly
        // the `h-[20%]`/`h-[80%]` this replaces, at every column height.
        style={isRolledUp ? { flex: '0 0 auto' } : { flex: `${share} 1 0%`, minHeight: PANEL_MIN_HEIGHT }}
        title={PANEL_TITLES[id]}
        headerAction={
          index === 0 && !isRolledUp ? (
            <button
              aria-label={layout.isCollapsed ? 'Expand panels' : 'Collapse panels to icons'}
              aria-pressed={layout.isCollapsed}
              className="ml-2 rounded px-1 text-sm leading-none text-gray-600 transition-colors hover:bg-gray-300 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-gray-100"
              onClick={layout.toggleCollapsed}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              title={layout.isCollapsed ? 'Expand panels' : 'Collapse panels to icons'}
              type="button"
              data-testid="dock-collapse-toggle"
            >
              {layout.isCollapsed ? '»' : '«'}
            </button>
          ) : null
        }
      >
        {id === 'history' ? <HistoryTab /> : <LayersTab />}
      </PanelGroup>
    );
  };

  return (
    <aside
      id="right-panel"
      // Two `complementary` landmarks with no names is a screen reader announcing two
      // indistinguishable regions, so both sides name theirs. `SidebarLeft` names the rail.
      aria-label="History and Layers panels"
      ref={dockRef}
      // The width lives on the element, not the grid track: the tablet collapse is a
      // `display: none` item, and only an `auto` track collapses to nothing for one. See the
      // note above, and `App.tsx` for the `auto` tracks.
      style={{ width: layout.effectiveDockWidth }}
      className={`relative flex min-h-0 flex-col bg-gray-100 dark:bg-gray-800 dark:border-gray-700 max-md:hidden ${
        layout.dockSide === 'left' ? 'border-r border-gray-300' : 'border-l border-gray-300'
      } ${dockPlacement} ${
        // The seam between two panel groups in one column. A dock is "a collection of panels
        // grouped together vertically", so a rail sharing this edge sits ABOVE it, and without a
        // rule the two read as one continuous panel rather than as the two groups they are.
        layout.dockSide === layout.toolsSide ? 'border-t border-gray-300 dark:border-gray-700' : ''
      }`}
    >
      {/* The dock's canvas-side edge, WITHIN the column rather than straddling it: `left-0` on an
          8px box puts it 1px inside the aside's 1px border, which is where the e2e measures it
          and where the pointer is unambiguously on the divider. `z-20` keeps it above the panel
          rows; the panel drag's blue line is a fixed overlay at `z-[60]` and outranks both. */}
      <div
        {...columnDrag.handleProps}
        aria-hidden="true"
        className={`absolute top-0 z-20 h-full w-2 cursor-col-resize touch-none ${handleSideClass} ${
          columnDrag.isDragging ? 'border-blue-500' : 'border-transparent'
        }`}
        data-testid="dock-resize-handle"
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {layout.isIconOnly ? (
          /* "Select a single panel icon to expand only that panel."
             (https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/collapse-expand-icons.html)
             Expanding one panel therefore rolls the OTHER one up, rather than restoring the
             two-panel split the user had collapsed away. */
          <div className="flex flex-col" data-testid="dock-icon-strip">
            {/* The double-arrow lives at the dock's top-right in the expanded state, which is
                where this app puts it in the top panel's header. In the icon strip the header it
                was nested in no longer exists, so it comes along — an icon strip with no way out
                is a one-way trip. */}
            <button
              aria-label="Expand panels"
              className="flex h-9 shrink-0 items-center justify-center text-gray-600 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400 dark:text-gray-400 dark:hover:bg-gray-700"
              onClick={() => layout.setDockWidth(layout.dockWidth)}
              title="Expand panels"
              type="button"
              data-testid="dock-icon-expand"
            >
              <span aria-hidden="true" className="text-sm leading-none">
                »
              </span>
            </button>
            {layout.panelOrder.map((id) => {
              const Glyph = PANEL_GLYPHS[id];
              return (
                <button
                  aria-label={`Expand ${PANEL_TITLES[id]}`}
                  className="flex h-9 shrink-0 items-center justify-center text-gray-600 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400 dark:text-gray-400 dark:hover:bg-gray-700"
                  key={id}
                  onClick={() => {
                    layout.setDockWidth(layout.dockWidth);
                    for (const other of layout.panelOrder) layout.setRolledUp(other, other !== id);
                    // One `setRolledUp` per panel, so this is two functional updates and two
                    // renders for one click. They compose because each reads the previous state
                    // through its updater, which is the only reason it is correct rather than
                    // merely working.
                  }}
                  title={PANEL_TITLES[id]}
                  type="button"
                  data-testid={`dock-icon-${id}`}
                >
                  <Glyph />
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {renderPanel(layout.panelOrder[0], 0)}

            {/* The divider between the two groups. "When you drag these icons, all groups that share
                the divider are resized" — with two groups, that is the whole column. */}
            <div
              {...splitterDrag.handleProps}
              aria-hidden="true"
              className={`h-1.5 shrink-0 cursor-row-resize touch-none border-y border-gray-300 bg-gray-200 hover:bg-blue-200 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-blue-700 ${
                splitterDrag.isDragging ? 'bg-blue-300 dark:bg-blue-600' : ''
              }`}
              data-testid="dock-splitter"
            />

            {renderPanel(layout.panelOrder[1], 1)}
          </>
        )}

        {/* The drop target for a tab drag, drawn before the release. A blue line at the column
            edge is Photoshop's "blue line" docking zone, as distinct from the blue outline that
            means "join this group as another tab". */}
        {insertionIndex !== null && edgeTarget === null && !layout.isIconOnly && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-blue-500 ${
              insertionIndex === 0 ? 'top-0' : 'bottom-0'
            }`}
            data-testid="panel-drop-line"
          />
        )}
      </div>

      {/* Moving the dock to the other edge. "To create a dock, move panels to the right edge of
          the workspace until a drop zone appears." Fixed, so it paints against the viewport the
          way the drop zone does rather than against this column. */}
      {edgeTarget !== null && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-y-0 z-[60] w-1 bg-blue-500 ${
            edgeTarget === 'left' ? 'left-0' : 'right-0'
          }`}
          data-testid="dock-edge-line"
        />
      )}
    </aside>
  );
};

export default SidebarRight;
