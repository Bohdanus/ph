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

/**
 * Renders the body inside its own `overflow-y: auto` box and gives it the id the tab's
 * `aria-controls` points at. The caller passes the panel's CONTENT, not a wrapper: a wrapper
 * here would be a second scroll container, and the tab would name an element that is not the one
 * holding anything.
 */
const HEADER_CLASS =
  'px-3 py-1 bg-gray-200 dark:bg-gray-700 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300';

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
  /**
   * The header's `title` deliberately avoids the phrase "Drag to reorder", which is the
   * `title` on a LAYER row inside `LayersTab` and is a locator used verbatim by five e2e specs
   * and three unit tests. `page.getByTitle` matches on substring, so a panel tab whose tooltip
   * said the same words resolves to the panel header first, and every one of those locators
   * silently starts pointing at the wrong element.
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
  /** Space activates on keyup, so the held state has to survive from the keydown. */
  const spaceHeldRef = useRef(false);

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
      {/* The header is a ROW, not a single control, because `headerAction` is a real button.
          A button nested inside an element carrying `role="button"` is invalid ARIA, and it
          was not only invalid: the tab's own `onKeyDown` handled Enter and Space, `preventDefault`
          suppressed the inner button's synthesized click, and focusing "Collapse panels to
          icons" and pressing Enter rolled the panel up instead. Stopping propagation for
          pointer and double-click was not enough, because the key never went near those. */}
      <div
        className={`${HEADER_CLASS} flex shrink-0 items-center border-blue-500 ${
          isHandleDragging ? 'bg-blue-200 dark:bg-blue-700' : ''
        }`}
        data-testid={`panel-header-row-${id}`}
        data-dragging={isDragging || undefined}
      >
        <div
          {...handleProps}
          // Only while the body exists. Rolled up, the id below names nothing, and
          // `aria-expanded="false"` beside a reference to a missing element is the pair this
          // control's own accessibility rule calls dishonest: an assistive technology is told
          // the control governs a region it cannot find. The honest rolled-up pair is
          // `aria-expanded="false"` and no `aria-controls` at all, so the attribute is gated on
          // the SAME expression that renders the body further down and the two cannot drift.
          aria-controls={isRolledUp ? undefined : `panel-body-${id}`}
          aria-expanded={!isRolledUp}
          className="flex min-w-0 flex-1 cursor-grab select-none items-center self-stretch active:cursor-grabbing"
          onDoubleClick={() => {
            // A double-click is a click twice. The first click has to be allowed through, so the
            // roll-up waits for the second and only then checks that no drag happened.
            if (movedRef.current) return;
            onToggleRolledUp();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onToggleRolledUp();
            } else if (event.key === ' ') {
              // `preventDefault` here is what stops the page scrolling under the keypress, and
              // it is why Space activates on KEYUP: the ARIA button pattern pairs the two, and
              // activating on keydown fires while the key is still down, so a user who changes
              // their mind cannot take it back.
              event.preventDefault();
              spaceHeldRef.current = true;
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' && spaceHeldRef.current) {
              event.preventDefault();
              spaceHeldRef.current = false;
              onToggleRolledUp();
            }
          }}
          role="button"
          tabIndex={0}
          // The testid names the CONTROL, not the row around it, because that is what a test
          // drags and double-clicks.
          title={`${title} panel — drag this tab to move it, double-click to roll it up`}
          data-testid={`panel-header-${id}`}
        >
          <span className="truncate">{title}</span>
        </div>
        {headerAction}
      </div>
      {/* The id `aria-controls` names goes on the element that actually holds the body, not on an
          empty `display: contents` placeholder beside it — a control that announces what it
          controls has to control something, and a placeholder is nothing. The body is rendered
          here rather than passed in so the id and the element cannot drift apart. */}
      {!isRolledUp && (
        <div className="min-h-0 flex-1 overflow-y-auto" id={`panel-body-${id}`}>
          {children}
        </div>
      )}
    </div>
  );
};

export default PanelGroup;
