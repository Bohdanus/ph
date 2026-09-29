import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useDockDrag } from '../../hooks/useDockDrag.ts';
import type { PanelId } from '../../contexts/PanelLayout.tsx';

/**
 * One panel group in the dock: a tab bar you drag by, and a body.
 *
 * ## The drag
 *
 * "Choose a panel by selecting its tab. Drag the panel by its tab to a new location. When you
 * move panels, blue drop zones show where you can place them." (https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html)
 *
 * So the drag starts on the header and nowhere else. The body stays completely inert to it:
 * clicking a swatch, a slider or a layer row has to reach that control, and a drag recogniser
 * on the body would eat every one of them.
 *
 * The drag is reported to the dock in deltas rather than resolved here, because "which slot is
 * the pointer over" is a question about the dock's geometry, not this panel's, and the dock is
 * what draws the blue insertion line.
 *
 * ## The roll-up
 *
 * "To collapse a panel group so that only the dock header bar and tabs are visible,
 * double-click a panel tab or panel title bar. Double-click again to restore it to the
 * expanded view." (Adobe Photoshop CC Classroom in a Book.) That is a double-click, not a
 * button, and it is on the same header as the drag — which is why the handler is here and not
 * in the dock.
 *
 * A double-click that ends a drag must not also roll the panel up, so the roll-up is suppressed
 * when the gesture moved. Adobe does not document this case because its panels are not
 * resizable; here the same header is both a drag handle and a control, and a 3px twitch is a
 * click, not a drag.
 */

const HEADER_CLASS =
  'px-3 py-1 bg-gray-200 dark:bg-gray-700 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400';

export interface PanelGroupProps {
  id: PanelId;
  title: string;
  /** Rolled up to the tab bar by a double-click on the header. */
  isRolledUp: boolean;
  onToggleRolledUp: () => void;
  /** A reorder or re-dock drag is in flight on THIS panel. */
  isDragging: boolean;
  /**
   * `flex` shorthand for the group's own box, so the dock can hand out shares of the column
   * by ratio and the rolled-up panel can take its natural height. See `SidebarRight.tsx`.
   */
  style?: CSSProperties;
  className?: string;
  /**
   * Reports a header drag. `delta` is measured from the gesture's start, which is what the dock
   * turns into a slot index or an edge drop; the pointer-down event carries the start `clientX`,
   * which is the dock's only way to know which way the panel is being thrown.
   */
  onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  onDrag: (delta: { dx: number; dy: number }) => void;
  /**
   * `cancelled` is true for an Escape, a lost pointer, or a non-primary button. The dock has to
   * honour it: a gesture the user called off must not commit a reorder, and the flag is only
   * reported by `useDockDrag`, so dropping it here loses the ability to tell the two apart.
   */
  onDragEnd: (cancelled: boolean) => void;
  /** Rendered at the trailing edge of the header. The dock's collapse double-arrow lives here. */
  headerAction?: ReactNode;
  children: ReactNode;
}

const MOVE_THRESHOLD_PX = 3;

const PanelGroup = ({
  id,
  title,
  isRolledUp,
  onToggleRolledUp,
  isDragging,
  style,
  className = '',
  onDragStart,
  onDrag,
  onDragEnd,
  headerAction,
  children,
}: PanelGroupProps) => {
  const movedRef = useRef(false);

  const { handleProps, isDragging: isHandleDragging } = useDockDrag({
    onStart: (event) => {
      movedRef.current = false;
      onDragStart(event);
    },
    onMove: (delta) => {
      if (!movedRef.current && Math.abs(delta.dy) > MOVE_THRESHOLD_PX) movedRef.current = true;
      onDrag(delta);
    },
    onEnd: (cancelled) => {
      onDragEnd(cancelled);
    },
  });

  return (
    <div className={`flex flex-col overflow-hidden ${className}`} style={style} data-testid={`panel-group-${id}`}>
      <div
        {...handleProps}
        aria-expanded={!isRolledUp}
        className={`${HEADER_CLASS} flex shrink-0 cursor-grab select-none items-center justify-between border-blue-500 active:cursor-grabbing ${
          isHandleDragging ? 'bg-blue-200 dark:bg-blue-700' : ''
        }`}
        onDoubleClick={() => {
          // A double-click is a click twice. The first click has to be allowed through, so the
          // roll-up waits for the second and only then checks that no drag happened.
          if (movedRef.current) return;
          onToggleRolledUp();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggleRolledUp();
          }
        }}
        role="button"
        tabIndex={0}
        title={`${title} — drag to reorder, double-click to ${isRolledUp ? 'expand' : 'collapse'}`}
        data-testid={`panel-header-${id}`}
        data-dragging={isDragging || undefined}
      >
        <span className="truncate">{title}</span>
        {headerAction}
      </div>
      {!isRolledUp && children}
    </div>
  );
};

export default PanelGroup;
