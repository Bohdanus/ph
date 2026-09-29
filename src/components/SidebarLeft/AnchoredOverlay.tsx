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
 * the anchor from a ref therefore measures one commit too early, and both of the ways to
 * paper over that are worse than the problem: asking for a second commit with a `setState`
 * in the effect costs a commit and is what `react-hooks/set-state-in-effect` rejects, and
 * moving the measurement to a passive effect costs a frame in which the overlay is
 * `visibility: hidden` — during which the flyout's `requestAnimationFrame` focus lands on
 * an element that cannot take focus, which is what the `sidebar-keyboard` e2e caught.
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
   * Which side of the anchor the overlay prefers, before it considers whether it fits.
   *
   * The rail can be re-docked to either edge (`PanelLayout.dockOnLeft`), so this cannot be
   * inferred from the anchor's own geometry: a flyout opened from a rail on the right edge
   * hangs off the anchor's LEFT, and reading "the trailing edge" off a right-hand rail puts it
   * off-screen. The caller knows which edge it is on, so it says.
   *
   * This is the PREFERRED side, not a constraint. The fit test below still flips to the other
   * edge when the preferred one cannot hold the whole overlay, which is the behaviour that has
   * always been here.
   */
  side?: 'left' | 'right';
  /**
   * Re-measures the overlay when this changes, and only then. The effect re-runs on its own
   * whenever the anchor or a placement option changes, so this is only needed by a caller
   * whose overlay keeps its identity while its CONTENT changes size — a tooltip whose label
   * changed under it. The flyout passes its group index; that key cannot change under a
   * live instance, because the overlay is rendered inside the open group's own tile and
   * switching groups unmounts it, so it is there to be explicit rather than load-bearing.
   */
  measureKey?: string;
};

type Position = { top: number; left: number };

/** Kept clear of the viewport edges so an overlay never sits flush against the screen edge. */
const VIEWPORT_PADDING = 8;

const clampToViewport = (value: number, size: number, extent: number, padding: number): number => {
  const maximum = Math.max(padding, extent - size - padding);
  return Math.min(Math.max(value, padding), maximum);
};

const AnchoredOverlay = ({
  anchor,
  children,
  gap = 8,
  align = 'start',
  side = 'right',
  viewportPadding = VIEWPORT_PADDING,
  measureKey,
}: AnchoredOverlayProps) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const reposition = useCallback(() => {
    const overlay = overlayRef.current;
    if (!anchor || !overlay) return;

    // A detached anchor measures as an all-zero box, and the clamp would then place the
    // overlay in the top-left corner at the viewport padding — a real, painted, clickable
    // menu attached to nothing. Nothing is rendered for a detached anchor (see the guard
    // below), so there is no position to place; measuring it would only write a value that
    // is never used. Skipping it is also the cheaper half: invalidating the position from
    // here would be a `setState` inside a layout effect, which is a cascading render to say
    // something the render can already derive.
    if (!anchor.isConnected) return;

    const anchorRect = anchor.getBoundingClientRect();
    const width = overlay.offsetWidth;
    const height = overlay.offsetHeight;
    // A `position: fixed` box is laid out against the viewport MINUS a classic
    // scrollbar, which `window.innerWidth` includes, so the right-edge clamp can overshoot
    // by the scrollbar's width. `documentElement.clientWidth` is the same box the
    // containing block actually is.
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    // The preferred side is whichever edge the caller's rail faces: a rail on the left opens to
    // the right, a rail on the right opens to the left. Fall back to the OTHER edge only when
    // the preferred one cannot hold the whole overlay; if neither fits, clamp the preferred
    // side rather than choosing, so a flyout stays attached to the tile it came from.
    const fitsTrailing = anchorRect.right + gap + width <= viewportWidth - viewportPadding;
    const fitsLeading = anchorRect.left - gap - width >= viewportPadding;
    const preferred = side === 'right' ? fitsTrailing : fitsLeading;
    const fallback = side === 'right' ? fitsLeading : fitsTrailing;
    const atPreferred = side === 'right' ? anchorRect.right + gap : anchorRect.left - gap - width;
    const atFallback = side === 'right' ? anchorRect.left - gap - width : anchorRect.right + gap;
    const unclampedLeft = preferred ? atPreferred : fallback ? atFallback : atPreferred;

    const unclampedTop = align === 'center' ? anchorRect.top + (anchorRect.height - height) / 2 : anchorRect.top;

    const left = clampToViewport(unclampedLeft, width, viewportWidth, viewportPadding);
    const top = clampToViewport(unclampedTop, height, viewportHeight, viewportPadding);

    // Keep the same object when nothing moved, so a measurement that agrees with the
    // current position does not re-render.
    setPosition((current) =>
      current !== null && current.top === top && current.left === left ? current : { top, left }
    );
  }, [align, anchor, gap, side, viewportPadding]);

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

  // A detached anchor is the same case as a missing one: there is nowhere to place an
  // overlay, so render nothing rather than a box on screen that belongs to nothing. The
  // check is derived from the anchor on every render rather than stored, so an anchor that
  // leaves and rejoins the document is picked up again with nothing to invalidate. The
  // `anchor === null` case is the unresolved one — the caller resolves the anchor through a
  // callback ref, so there is a commit in which it is not known yet.
  if (anchor === null || !anchor.isConnected) return null;

  const style: CSSProperties = {
    position: 'fixed',
    // Measured at 0,0 rather than off-screen: an unmeasured box is shrink-to-fit, and at
    // `left: -9999` it is measured against a viewport 9999px wider than the one it will
    // occupy, so a long label could report a width it never actually has. `visibility:
    // hidden` is what keeps it unseen, and it also means the unmeasured box cannot take a
    // pointer event.
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    visibility: position === null ? 'hidden' : undefined,
    // The wrapper is a positioning box, not a target. With `pointer-events: auto` it
    // shrink-wraps the child and, when two overlays overlap, whichever portal was appended
    // last swallows the other's pointer events: right-clicking a tile opens the flyout
    // immediately and the hover tooltip 250ms later, so the tooltip's box landed on top of
    // the first flyout item and the click reached neither. Children that need to be
    // clickable say so themselves — the flyout's `<ul>` does, the tooltip's span already
    // says `pointer-events-none`.
    pointerEvents: 'none',
    // The children carried `z-50`, which did nothing: neither is a positioned element nor
    // a flex or grid item. With the wrapper at `z-index: auto` the overlay would be
    // ordered among body's children by append time and lose to any neighbour with a
    // `z-index` of 1 or more. This is the stacking level the classes were asking for.
    zIndex: 50,
  };

  return createPortal(
    <div ref={overlayRef} style={style}>
      {children}
    </div>,
    document.body
  );
};

export default AnchoredOverlay;
