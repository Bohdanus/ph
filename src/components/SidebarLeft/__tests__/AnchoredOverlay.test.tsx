import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import AnchoredOverlay from '../AnchoredOverlay.tsx';

/**
 * jsdom has no layout engine: every `getBoundingClientRect()` is a zeroed box and every
 * `offsetWidth`/`offsetHeight` is 0, so the placement arithmetic is invisible here unless
 * it is fed boxes. The stubs below are what make the flyout's flip and shift testable at
 * all — the clipping defect itself is only observable in a real browser and is pinned by
 * `e2e/sidebar-flyout.spec.ts`.
 */
type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

/**
 * The size the overlay wrapper reports. jsdom returns 0 for every `offsetWidth` and
 * `offsetHeight`, so the prototype getters below hand back this instead; the wrapper is
 * the element the component measures, and a test sets it before rendering.
 */
let measuredSize: Size = { width: 0, height: 0 };

const stubMeasuredSize = (): void => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => measuredSize.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => measuredSize.height,
  });
};

const setViewport = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  // `AnchoredOverlay` clamps against `documentElement.client*`, not `window.inner*`, so the
  // two have to be stubbed together. jsdom reports 0 for every `client*` box, which would
  // make the clamp collapse to the padding on every placement.
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
};

/**
 * Diverges the two viewport measures the way a classic scrollbar does: the layout box a
 * `position: fixed` overlay is placed against is narrower than the `window.inner*` box that
 * includes the scrollbar gutter.
 */
const setViewportWithScrollbar = (
  inner: { width: number; height: number },
  client: { width: number; height: number }
): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: inner.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: inner.height });
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: client.width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: client.height });
};

/** Re-reads the live box on every call, so a test can move the anchor between calls. */
const anchorBox = (element: HTMLElement, box: Box): void => {
  element.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    }) as DOMRect;
};

/** The anchor node the harness published, so a test can detach it. */
let publishedAnchor: HTMLElement | null = null;

/**
 * Reads it through a declared return type. `publishedAnchor` is only ever assigned from
 * inside a ref callback, which TypeScript's control-flow analysis treats as unreachable from
 * here, so a direct read narrows to `null` and every assertion on it is rejected.
 */
const readPublishedAnchor = (): HTMLElement | null => publishedAnchor;

/**
 * Renders an anchor sibling and an anchored overlay. The returned `anchor` is the same
 * object the anchor's `getBoundingClientRect` reads on every call, so a test can move the
 * anchor and fire one event rather than re-rendering. `element` is that anchor's node.
 */
const renderOverlay = ({
  anchor,
  overlaySize,
  gap,
  align,
  measureKey,
}: {
  anchor: Box;
  overlaySize: Size;
  gap?: number;
  align?: 'start' | 'center';
  measureKey?: string;
}): { anchor: Box; element: HTMLElement; rerender: () => void } => {
  // The anchor is resolved by the caller, through a callback ref in both real call sites,
  // so the harness holds it in state exactly as they do. The size is read by the prototype
  // getters during the overlay's layout effect, so it is set before the render that
  // triggers it rather than inside the component.
  measuredSize = overlaySize;
  publishedAnchor = null;

  const Anchored = () => {
    const [anchorElement, setAnchorElement] = useState<HTMLSpanElement | null>(null);

    return (
      <div>
        <span
          data-testid="anchor"
          ref={(node) => {
            if (node) anchorBox(node, anchor);
            publishedAnchor = node;
            setAnchorElement(node);
          }}
        />
        <AnchoredOverlay align={align} anchor={anchorElement} gap={gap} measureKey={measureKey}>
          <ul data-testid="overlay" role="menu" />
        </AnchoredOverlay>
      </div>
    );
  };

  const { rerender } = render(<Anchored />);

  return { anchor, element: readPublishedAnchor() as HTMLElement, rerender: () => rerender(<Anchored />) };
};

const overlay = (): HTMLElement => screen.getByTestId('overlay');

/** The wrapper is the element the component positions, so its inline style is the truth. */
const position = (): { top: number; left: number; position: string } => {
  const wrapper = overlay().parentElement as HTMLElement;
  return {
    top: Number.parseFloat(wrapper.style.top),
    left: Number.parseFloat(wrapper.style.left),
    position: wrapper.style.position,
  };
};

/** A left-hand rail tile: 56px wide, 44px tall, `left: 0`. */
const RAIL_TILE = { left: 0, top: 100, width: 56, height: 44 };

describe('AnchoredOverlay', () => {
  stubMeasuredSize();

  afterEach(() => {
    setViewport(1280, 720);
  });

  it('renders into the body, so no clipping ancestor sits between it and the viewport', () => {
    renderOverlay({ anchor: RAIL_TILE, overlaySize: { width: 200, height: 120 } });

    const wrapper = overlay().parentElement as HTMLElement;
    expect(wrapper.parentElement).toBe(document.body);
    expect(screen.getByTestId('anchor').contains(wrapper)).toBe(false);
    expect(position().position).toBe('fixed');
  });

  it('places the overlay beside the anchor trailing edge when it fits', () => {
    renderOverlay({ anchor: RAIL_TILE, overlaySize: { width: 200, height: 120 } });

    // 56 (anchor right) + 8 (default gap) = 64, lined up with the anchor top.
    expect(position()).toEqual({ position: 'fixed', left: 64, top: 100 });
  });

  it('flips to the leading edge when the trailing side cannot hold the whole overlay', () => {
    renderOverlay({
      anchor: { left: 1100, top: 100, width: 56, height: 44 },
      gap: 8,
      overlaySize: { width: 200, height: 120 },
    });

    // 1156 + 8 + 200 overflows 1280, so it goes to the anchor's other side instead.
    expect(position()).toEqual({ position: 'fixed', left: 892, top: 100 });
  });

  it('keeps the overlay on screen when the anchor is near the bottom', () => {
    renderOverlay({
      anchor: { left: 0, top: 640, width: 56, height: 44 },
      overlaySize: { width: 200, height: 120 },
    });

    // 640 + 120 overflows 720, so the overlay shifts up clear of the viewport bottom.
    expect(position()).toEqual({ position: 'fixed', left: 64, top: 592 });
  });

  it('centres the overlay on the anchor when asked to', () => {
    renderOverlay({
      align: 'center',
      anchor: { left: 0, top: 200, width: 56, height: 44 },
      overlaySize: { width: 200, height: 40 },
    });

    // 200 + (44 - 40) / 2 = 202.
    expect(position()).toEqual({ position: 'fixed', left: 64, top: 202 });
  });

  it('clamps into the viewport when neither side fits the overlay', () => {
    renderOverlay({
      anchor: { left: 640, top: 100, width: 56, height: 44 },
      overlaySize: { width: 900, height: 120 },
    });

    // 648 + 900 overflows 1280 and 640 - 8 - 900 does not fit either, so the trailing
    // placement is clamped into the viewport rather than a side being chosen.
    expect(position()).toEqual({ position: 'fixed', left: 372, top: 100 });
  });

  it('re-measures when the rail scrolls under it', () => {
    const { anchor } = renderOverlay({
      anchor: { ...RAIL_TILE, top: 500 },
      overlaySize: { width: 200, height: 120 },
    });
    expect(position().top).toBe(500);

    // The anchor is inside a scroll container, and `scroll` on an element does not bubble,
    // so this only lands through a capture-phase listener on the window.
    anchor.top = 300;
    act(() => {
      fireEvent.scroll(window);
    });

    expect(position().top).toBe(300);
  });

  it('does not let a scrollbar gutter push the overlay past the viewport edge', () => {
    // The two measures are unmistakably different here: `window.innerHeight` reports the
    // full window while the layout viewport — the containing block of a `position: fixed`
    // box — is 80px shorter once a classic scrollbar takes its gutter.
    setViewportWithScrollbar({ width: 1280, height: 720 }, { width: 1280, height: 640 });

    renderOverlay({
      // Low in the rail, so the vertical clamp is what places it. The horizontal axis cannot
      // be used to pin this: a left-rail tile sits at x 0-56, so the leading side always has
      // room and the left clamp never binds.
      anchor: { left: 0, top: 600, width: 56, height: 44 },
      overlaySize: { width: 200, height: 200 },
    });

    // 640 - 200 - 8 = 432 against the layout viewport. Against `innerHeight` it would be
    // 720 - 200 - 8 = 512, and the overlay's bottom 72px would sit under the scrollbar.
    expect(position().top).toBe(432);
  });

  it('stops rendering when its anchor leaves the document', () => {
    const { element, rerender } = renderOverlay({
      anchor: { ...RAIL_TILE, top: 500 },
      overlaySize: { width: 200, height: 120 },
    });
    expect(position().top).toBe(500);

    // A detached element's `getBoundingClientRect()` is an all-zero box, and the clamp would
    // then pin the overlay into the top-left corner at the viewport padding: a real, painted,
    // clickable menu attached to nothing. Rendering nothing is the honest answer.
    //
    // The commit is driven explicitly because that is the whole contract: the check is a
    // derivation React re-evaluates when it renders, not stored state something has to push.
    // A detach on its own changes no state — and the layout effect now skips the detached
    // anchor, so it no longer forces a render either, which is correct: there is no position
    // to update for an overlay that is not on screen.
    act(() => {
      element.remove();
    });
    expect(screen.queryByTestId('overlay')).not.toBeNull();

    rerender();

    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  it('is not a pointer target itself, so a sibling overlay cannot be swallowed', () => {
    renderOverlay({ anchor: RAIL_TILE, overlaySize: { width: 200, height: 120 } });

    const wrapper = overlay().parentElement as HTMLElement;
    // The wrapper shrink-wraps the child, so `auto` would make a box the size of the menu
    // that sits over whatever else is on screen. The tooltip portals after the flyout and
    // used to land on its first item.
    expect(wrapper.style.pointerEvents).toBe('none');
  });

  it('carries the stacking level the children were asking for', () => {
    renderOverlay({ anchor: RAIL_TILE, overlaySize: { width: 200, height: 120 } });

    const wrapper = overlay().parentElement as HTMLElement;
    expect(wrapper.style.zIndex).toBe('50');
  });
});
