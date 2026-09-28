import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A popover anchored to an element, rendered into `document.body`.
 *
 * ## Why a portal
 *
 * The left rail is a scroll container. `e2087bf` gave the rail
 * `overflow-y-auto` so its min-content height could no longer floor the grid row it
 * lives in, and because CSS computes `overflow-x` to `auto` whenever `overflow-y` is
 * not `visible`, that one change made the rail clip on BOTH axes. Everything the rail
 * positions outside its own 56px — the tool flyout and the tool tooltip — stopped being
 * painted, while its layout box and its DOM node stayed exactly where they were. Nothing
 * in jsdom could see it, and Playwright's `toBeVisible()` does not test clipping, so the
 * whole flyout became invisible with every test still green.
 *
 * An absolutely positioned descendant is clipped by any ancestor with a non-visible
 * overflow that sits between it and its containing block, and the containing block here
 * is the tool tile inside the rail. No combination of `overflow` values on the rail can
 * change that: `overflow: clip` still clips, it only declines to scroll. Portalling to
 * the body moves the containing block to the initial containing block, where no ancestor
 * overflow applies — the same reason `FontSelect.tsx` portals its font list.
 *
 * ## Why the anchor is a prop and not a ref
 *
 * Both anchors are the overlay's PARENT — the tool tile, and the tooltip's wrapper span —
 * and React attaches a parent's ref after its child's layout effects. An overlay reading
 * the anchor from a ref therefore measures one commit too early, and neither of the two
 * available workarounds is free: a `setState` to force a second pass is exactly what
 * `react-hooks/set-state-in-effect` rejects, and measuring in a passive effect costs a
 * frame in which the overlay is `visibility: hidden`, during which the flyout's
 * `requestAnimationFrame` focus lands on an element that cannot take focus.
 *
 * So the caller resolves the anchor through a callback ref and passes the element in. The
 * state update from a ref callback is flushed before the browser paints, so the overlay
 * mounts already knowing its anchor and is placed by a layout effect, with no frame spent
 * hidden and nothing to re-enter. Nothing is rendered until the anchor exists.
 *
 * ## Why it is measured instead of positioned with classes
 *
 * In the body there is no positioned ancestor to hang `top-0 left-full` off, so the
 * overlay's own size is needed to place it. The effect re-measures on scroll and resize,
 * because the anchor is inside a scroll container that moves independently of the page.
 *
 * The overlay is a wrapper element rather than the child itself, because the child's box
 * has to be measured to position it and a `ref` cannot be threaded through
 * `cloneElement` without the compiler rules treating it as a ref read during render.
 */
type AnchoredOverlayProps = {
  /**
   * The anchor element, or `null` while the caller has not resolved it yet. Nothing is
   * rendered in that case: an overlay placed against a missing anchor has nowhere to go.
   */
  anchor: HTMLElement | null;
  /** What the overlay renders. */
  children: ReactNode;
  /** Space between the anchor edge and the overlay, in px. */
  gap?: number;
  /** Which vertical alignment of the anchor the overlay follows. */
  align?: 'start' | 'center';
  /** Margin kept clear against every viewport edge, in px. */
  viewportPadding?: number;
  /**
   * Re-measures the overlay when this changes, and only then. A caller that replaces the
   * content behind a reused instance — a flyout that switches to a different group — has
   * no ref to reattach and would otherwise keep the previous size.
   */
  measureKey?: string;
};

type Position = { top: number; left: number };

/** Kept clear of the viewport edges so an overlay never sits flush against the screen edge. */
const VIEWPORT_PADDING = 8;

/** Where an unmeasured overlay waits: outside every viewport, and invisible while there. */
const OFFSCREEN = -9999;

const clampToViewport = (value: number, size: number, extent: number, padding: number): number => {
  const maximum = Math.max(padding, extent - size - padding);
  return Math.min(Math.max(value, padding), maximum);
};

const AnchoredOverlay = ({
  anchor,
  children,
  gap = 8,
  align = 'start',
  viewportPadding = VIEWPORT_PADDING,
  measureKey,
}: AnchoredOverlayProps) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const reposition = useCallback(() => {
    const overlay = overlayRef.current;
    if (!anchor || !overlay) return;

    const anchorRect = anchor.getBoundingClientRect();
    const width = overlay.offsetWidth;
    const height = overlay.offsetHeight;
    const { innerWidth, innerHeight } = window;

    // Preferred side is the anchor's trailing edge, which for a left-hand rail is the
    // right. Flip to the leading edge only when the trailing one cannot hold the whole
    // overlay; if neither side fits, clamp the preferred side rather than choosing.
    const fitsTrailing = anchorRect.right + gap + width <= innerWidth - viewportPadding;
    const fitsLeading = anchorRect.left - gap - width >= viewportPadding;
    const unclampedLeft = fitsTrailing
      ? anchorRect.right + gap
      : fitsLeading
        ? anchorRect.left - gap - width
        : anchorRect.right + gap;

    const unclampedTop = align === 'center' ? anchorRect.top + (anchorRect.height - height) / 2 : anchorRect.top;

    const left = clampToViewport(unclampedLeft, width, innerWidth, viewportPadding);
    const top = clampToViewport(unclampedTop, height, innerHeight, viewportPadding);

    // Keep the same object when nothing moved, so a measurement that agrees with the
    // current position does not re-render.
    setPosition((current) =>
      current !== null && current.top === top && current.left === left ? current : { top, left }
    );
  }, [align, anchor, gap, viewportPadding]);

  useLayoutEffect(() => {
    reposition();
  }, [measureKey, reposition]);

  useEffect(() => {
    window.addEventListener('resize', reposition);
    // Capture phase: the anchor scrolls inside the rail, and `scroll` on an element does
    // not bubble, so a listener on the window would never hear the rail scrolling.
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [reposition]);

  if (anchor === null) return null;

  const style: CSSProperties = {
    position: 'fixed',
    top: position?.top ?? OFFSCREEN,
    left: position?.left ?? OFFSCREEN,
    visibility: position === null ? 'hidden' : undefined,
  };

  return createPortal(
    <div ref={overlayRef} style={style}>
      {children}
    </div>,
    document.body
  );
};

export default AnchoredOverlay;
