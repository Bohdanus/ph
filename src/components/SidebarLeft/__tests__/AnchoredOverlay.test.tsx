import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
  // A `position: fixed` box is laid out against `documentElement.clientWidth`, not
  // `window.innerWidth`, and jsdom computes neither. The component reads the former.
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
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

/**
 * The anchor is resolved by the caller, through a callback ref in both real call sites, so
 * the harness holds it in state exactly as they do. The size is read by the prototype
 * getters during the overlay's layout effect, so it is set before the render that triggers
 * it rather than inside the component.
 */
const Harness = ({
  anchor,
  gap,
  align,
  measureKey,
}: {
  anchor: Box;
  gap?: number;
  align?: 'start' | 'center';
  measureKey?: string;
}) => {
  const [anchorElement, setAnchorElement] = useState<HTMLSpanElement | null>(null);

  return (
    <div>
      <span
        data-testid="anchor"
        ref={(node) => {
          if (node) anchorBox(node, anchor);
          setAnchorElement(node);
        }}
      />
      <AnchoredOverlay align={align} anchor={anchorElement} gap={gap} measureKey={measureKey}>
        <ul data-testid="overlay" role="menu" />
      </AnchoredOverlay>
    </div>
  );
};

/**
 * Renders an anchor and an anchored overlay. The returned `anchor` is the object the
 * anchor's `getBoundingClientRect` reads on every call, so a test can move the anchor and
 * fire one event rather than re-rendering. `resize` re-renders with new content and, by
 * default, a new `measureKey` — the key is how a caller says its content changed, so a
 * re-render that keeps it is expected NOT to re-measure.
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
}): { anchor: Box; resize: (size: Size, nextMeasureKey?: string) => void } => {
  measuredSize = overlaySize;
  const { rerender } = render(<Harness align={align} anchor={anchor} gap={gap} measureKey={measureKey} />);

  return {
    anchor,
    resize: (size, nextMeasureKey = measureKey) => {
      measuredSize = size;
      rerender(<Harness align={align} anchor={anchor} gap={gap} measureKey={nextMeasureKey} />);
    },
  };
};

const overlay = (): HTMLElement => screen.getByTestId('overlay');

/** The wrapper is the element the component positions, so its inline style is the truth. */
const wrapper = (): HTMLElement => overlay().parentElement as HTMLElement;

const position = (): { top: number; left: number; position: string } => {
  const { top, left, position: placement } = wrapper().style;
  return { top: Number.parseFloat(top), left: Number.parseFloat(left), position: placement };
};

/** A left-hand rail tile: 56px wide, 44px tall, `left: 0`. */
const RAIL_TILE = { left: 0, top: 100, width: 56, height: 44 };

describe('AnchoredOverlay', () => {
  stubMeasuredSize();

  beforeEach(() => {
    setViewport(1280, 720);
  });

  afterAll(() => {
    // The stubs are installed on the prototype and would otherwise outlive the file.
    // `isolate: true` is what keeps them out of other test files today; nothing here should
    // depend on that staying true.
    delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  });

  it('renders into the body, so no clipping ancestor sits between it and the viewport', () => {
    renderOverlay({ anchor: RAIL_TILE, overlaySize: { width: 200, height: 120 } });

    expect(wrapper().parentElement).toBe(document.body);
    expect(screen.getByTestId('anchor').contains(wrapper())).toBe(false);
    expect(position().position).toBe('fixed');
  });

  it('keeps the wrapper out of hit testing, so two overlapping overlays cannot shadow each other', () => {
    renderOverlay({ anchor: RAIL_TILE, overlaySize: { width: 200, height: 120 } });

    // Shrink-wrapped to its child, a wrapper with `pointer-events: auto` covers the whole
    // overlay, and the overlay portalled last is the one on top. Right-clicking a tile
    // opens the flyout before the 250ms hover tooltip, so the tooltip's box landed on the
    // first flyout item and swallowed its clicks. Children opt back in themselves.
    expect(wrapper().style.pointerEvents).toBe('none');
    expect(wrapper().style.zIndex).toBe('50');
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

    // 704 (696 + 8) + 900 overflows 1280 and 640 - 8 - 900 does not fit either, so the
    // trailing placement is clamped into the viewport rather than a side being chosen.
    expect(position()).toEqual({ position: 'fixed', left: 372, top: 100 });
  });

  it('re-measures when the caller says the content changed size', () => {
    const { resize } = renderOverlay({
      anchor: RAIL_TILE,
      overlaySize: { width: 200, height: 120 },
      measureKey: 'shape-1',
    });
    expect(position()).toEqual({ position: 'fixed', left: 64, top: 100 });

    // Same anchor, bigger content, new key. Without the key the effect would not re-run —
    // `reposition`'s inputs have not changed, only the element's size has — and the
    // overlay would keep a placement computed for the old size.
    resize({ width: 1300, height: 700 }, 'shape-2');

    // 64 + 1300 overflows 1280 and 0 - 8 - 1300 does not fit either, so the trailing
    // placement is clamped; 100 + 700 overflows 720, so the top is clamped too.
    expect(position()).toEqual({ position: 'fixed', left: 8, top: 12 });
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

  it('re-measures when the window resizes under it', () => {
    renderOverlay({
      anchor: { left: 1100, top: 100, width: 56, height: 44 },
      overlaySize: { width: 200, height: 120 },
    });

    // 1156 + 8 + 200 overflows 1280, so the overlay is on the anchor's leading edge.
    expect(position()).toEqual({ position: 'fixed', left: 892, top: 100 });

    // A wider window is a wider viewport to clamp against, and the same overlay now fits
    // on the trailing side. Without the resize listener it would sit on the wrong side
    // until something else happened to re-measure it.
    setViewport(1600, 720);
    act(() => {
      fireEvent.resize(window);
    });

    expect(position()).toEqual({ position: 'fixed', left: 1164, top: 100 });
  });

  it('renders nothing while the anchor is unresolved', () => {
    // The caller resolves the anchor from a callback ref, so there is a commit in which
    // the overlay's anchor is not known. Rendering it anyway would place it against
    // nothing — and a flyout placed against nothing is an open menu nobody can see.
    render(
      <AnchoredOverlay anchor={null}>
        <ul data-testid="overlay" role="menu" />
      </AnchoredOverlay>
    );

    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });
});
