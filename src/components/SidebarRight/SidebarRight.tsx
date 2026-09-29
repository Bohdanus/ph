import { useCallback, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useRightPanelVisibility } from '../../contexts/RightPanelVisibility.tsx';
import { usePanelLayout, type PanelId } from '../../contexts/PanelLayout.tsx';
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
 * The resize handle has to sit ON the canvas-side edge, half outside the column, which is where
 * Photoshop puts it and the only place the pointer is unambiguously "on the divider". An
 * absolutely positioned child at `left: -4px` is clipped by any `overflow` other than
 * `visible` on the aside, so the clipping moved inward to the column that actually needs it.
 * The panel groups keep exactly the clipping they had; only the aside's own box is now
 * overflow-visible, and nothing inside it is positioned against the aside.
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

/** Neither panel is useful below this, so the divider stops here rather than past it. */
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

  /** Where the column was and how tall when a divider drag began, so deltas convert to a ratio. */
  const splitterStartRef = useRef<{ ratio: number; height: number } | null>(null);
  const dockWidthStartRef = useRef(0);

  const onColumnResizeStart = useCallback(() => {
    dockWidthStartRef.current = layout.dockWidth;
  }, [layout.dockWidth]);

  const onColumnResize = useCallback(
    ({ dx }: { dx: number }) => {
      // The dock sits to the canvas's right by default, so dragging the divider LEFT widens it.
      // When the dock is on the left edge the divider is on its other side and the sign flips.
      const delta = layout.dockOnLeft ? dx : -dx;
      layout.setDockWidth(dockWidthStartRef.current + delta);
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
      setDraggingPanel(id);
      dragOriginXRef.current = event.clientX;
      setInsertionIndex(layout.panelOrder.indexOf(id));
      setEdgeTarget(null);
    },
    [layout.panelOrder]
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
        const wantsLeft = layout.dockOnLeft
          ? pointerX > viewportWidth * (1 - RE_DOCK_ZONE)
          : pointerX < viewportWidth * RE_DOCK_ZONE;
        if (wantsLeft) {
          setEdgeTarget(layout.dockOnLeft ? 'right' : 'left');
          setInsertionIndex(null);
          return;
        }
        setEdgeTarget(null);

        if (height <= 0) return;
        // Past the middle of the column is the other slot. A threshold rather than a live
        // measurement of the neighbour, because the neighbour is what is being swapped with and
        // it moves as the swap is previewed.
        const midpoint = index === 0 ? height / 2 : -height / 2;
        setInsertionIndex(dy > midpoint ? 1 : dy < midpoint ? 0 : index);
      },
    [layout.dockOnLeft, layout.panelOrder]
  );

  // `cancelled` is honoured for BOTH destinations, and it is not optional bookkeeping. A panel
  // drag previews its outcome continuously, so the state it is about to write is already on
  // screen; committing it on an Escape would commit something the user just took back.
  const onPanelDragEnd = useCallback(
    (cancelled: boolean) => {
      if (cancelled) {
        setDraggingPanel(null);
        setInsertionIndex(null);
        setEdgeTarget(null);
        dragOriginXRef.current = 0;
        return;
      }
      if (edgeTarget !== null) {
        layout.setDockOnLeft(edgeTarget === 'left');
      } else if (draggingPanel !== null && insertionIndex !== null) {
        const order = [...layout.panelOrder];
        const from = order.indexOf(draggingPanel);
        // `splice` on a copy, because `PanelOrder` is a readonly tuple: the state is the order,
        // and a caller that could mutate it in place would make every comparison of it suspect.
        if (from !== -1 && from !== insertionIndex) {
          const [moved] = order.splice(from, 1);
          order.splice(insertionIndex, 0, moved);
          layout.setPanelOrder(order);
        }
      }
      setDraggingPanel(null);
      setInsertionIndex(null);
      setEdgeTarget(null);
      dragOriginXRef.current = 0;
    },
    [draggingPanel, edgeTarget, insertionIndex, layout]
  );

  // A resize is written continuously, so a cancelled one has to be rolled back to where the
  // divider started — otherwise Escape leaves the column wherever the last pointermove put it,
  // which is the one outcome a cancel exists to prevent.
  const columnDrag = useDockDrag({
    onStart: onColumnResizeStart,
    onMove: onColumnResize,
    onEnd: (cancelled) => {
      if (cancelled) layout.setDockWidth(dockWidthStartRef.current);
    },
  });
  const splitterDrag = useDockDrag({
    onStart: onSplitterStart,
    onMove: onSplitterDrag,
    onEnd: (cancelled) => {
      if (cancelled && splitterStartRef.current !== null) layout.setSplitRatio(splitterStartRef.current.ratio);
    },
  });

  // `hidden` rather than a conditional return, so the panel's grid area collapses to zero
  // in the tablet band while `Main` keeps its place. Always true on desktop: there
  // `isCollapsible` is false and `isOpen` is unconditionally true, so this is a no-op.
  if (!isOpen) {
    return <aside id="right-panel" className="hidden" />;
  }

  if (!toolName || !hasImage) {
    return (
      <aside
        id="right-panel"
        className="bg-gray-100 dark:bg-gray-800 dark:border-l dark:border-gray-700 max-md:hidden [grid-area:right] relative"
        style={{ width: layout.effectiveDockWidth }}
      >
        <div className="p-3"></div>
      </aside>
    );
  }

  const collapsedClass = layout.dockOnLeft ? 'left-0 border-l-2' : 'right-0 border-r-2';

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
          index === 0 ? (
            <button
              aria-label={layout.isCollapsed ? 'Expand panels' : 'Collapse panels to icons'}
              aria-pressed={layout.isCollapsed}
              className="ml-2 rounded px-1 text-sm leading-none text-gray-500 transition-colors hover:bg-gray-300 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-gray-100"
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
        <div className="min-h-0 flex-1 overflow-y-auto">{id === 'history' ? <HistoryTab /> : <LayersTab />}</div>
      </PanelGroup>
    );
  };

  return (
    <aside
      id="right-panel"
      ref={dockRef}
      // The width lives on the element, not the grid track: the tablet collapse is a
      // `display: none` item, and only an `auto` track collapses to nothing for one. See the
      // note above, and `App.tsx` for the `auto` tracks.
      style={{ width: layout.effectiveDockWidth }}
      className={`relative flex h-full flex-col bg-gray-100 dark:bg-gray-800 dark:border-gray-700 max-md:hidden ${
        layout.dockOnLeft ? 'border-r border-gray-300 [grid-area:left]' : 'border-l border-gray-300 [grid-area:right]'
      }`}
    >
      {/* The dock's canvas-side edge. Half outside the column, so it is the divider Photoshop
          describes, and so the pointer is unambiguously on it. `z-20` keeps it above the panel
          rows; the panel drag's blue line is a fixed overlay at `z-[60]` and outranks both. */}
      <div
        {...columnDrag.handleProps}
        aria-label="Resize the panel dock"
        className={`absolute top-0 z-20 h-full w-2 cursor-col-resize touch-none ${collapsedClass} ${
          columnDrag.isDragging ? 'border-blue-500' : 'border-transparent'
        }`}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
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
              data-testid="dock-collapse-toggle"
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
              aria-label="Resize the History and Layers panels"
              className={`h-1.5 shrink-0 cursor-row-resize touch-none border-y border-gray-300 bg-gray-200 hover:bg-blue-200 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-blue-700 ${
                splitterDrag.isDragging ? 'bg-blue-300 dark:bg-blue-600' : ''
              }`}
              role="separator"
              aria-orientation="horizontal"
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
