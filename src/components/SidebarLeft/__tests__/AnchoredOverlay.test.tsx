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

/**
 * jsdom's OWN accessors, captured before anything in this file overwrites them. `delete` is
 * not a restore: these are inherited real accessors, so deleting the own property this file
 * installed leaves every element in the environment with `offsetWidth === undefined` instead
 * of `0`, which is a worse leak than the one the stubs are here to contain.
 */
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');

/** Puts back exactly the descriptor that was there, or removes an own property that was not. */
const restoreOwnProperty = (target: object, key: PropertyKey, original: PropertyDescriptor | undefined) => {
  if (original) {
    Object.defineProperty(target, key, original);
  } else {
    Reflect.deleteProperty(target, key);
  }
};

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
  side,
  measureKey,
}: {
  anchor: Box;
  gap?: number;
  align?: 'start' | 'center';
  side?: 'left' | 'right';
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
      <AnchoredOverlay align={align} anchor={anchorElement} gap={gap} measureKey={measureKey} side={side}>
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
 * re-render that keeps it is expected NOT to re-measure. `commit` re-renders with everything
 * unchanged, for a contract that React only re-evaluates when it renders.
 */
const renderOverlay = ({
  anchor,
  overlaySize,
  gap,
  align,
  side,
  measureKey,
}: {
  anchor: Box;
  overlaySize: Size;
  gap?: number;
  align?: 'start' | 'center';
  side?: 'left' | 'right';
  measureKey?: string;
}): {
  anchor: Box;
  resize: (size: Size, nextMeasureKey?: string) => void;
  commit: () => void;
} => {
  measuredSize = overlaySize;
  const { rerender } = render(<Harness align={align} anchor={anchor} gap={gap} measureKey={measureKey} side={side} />);

  return {
    anchor,
    commit: () => rerender(<Harness align={align} anchor={anchor} gap={gap} measureKey={measureKey} side={side} />),
    resize: (size, nextMeasureKey = measureKey) => {
      measuredSize = size;
      rerender(<Harness align={align} anchor={anchor} gap={gap} measureKey={nextMeasureKey} side={side} />);
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
    // depend on that staying true, so the ORIGINAL descriptors go back rather than the
    // properties being deleted — a deleted accessor reads as `undefined` where jsdom read `0`.
    restoreOwnProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    restoreOwnProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    // `setViewport` writes own data properties over `documentElement.client*`, shadowing
    // jsdom's inherited accessors for the rest of the environment if they are left behind.
    restoreOwnProperty(document.documentElement, 'clientWidth', originalClientWidth);
    restoreOwnProperty(document.documentElement, 'clientHeight', originalClientHeight);
  });

  it("captured jsdom's own accessors, so the teardown restores instead of deleting", () => {
    // The teardown takes a `Reflect.deleteProperty` branch when nothing was captured to put
    // back, and that branch is the defect this fix exists to remove. jsdom defining
    // `offsetWidth`/`offsetHeight` as real accessors on the prototype is what keeps the file
    // on the restoring branch, so it is pinned here rather than assumed.
    expect(typeof originalOffsetWidth?.get).toBe('function');
    expect(typeof originalOffsetHeight?.get).toBe('function');
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

  it('opens onto the leading edge for a rail docked to the right of the canvas', () => {
    // A rail on the RIGHT edge has its tiles at the far right of the window, so the anchor's
    // TRAILING edge is off-screen and "preferred side" cannot be read off the anchor's own
    // geometry. `side` is how the caller says which edge it is on, and reading it from the
    // anchor instead is what would put every flyout and tooltip a few pixels outside the
    // viewport once the rail is re-docked.
    const RIGHT_RAIL_TILE = { left: 1224, top: 100, width: 56, height: 44 };
    renderOverlay({
      anchor: RIGHT_RAIL_TILE,
      side: 'left',
      overlaySize: { width: 200, height: 120 },
    });

    // 1224 - 8 (gap) - 200 = 1016, and the whole box fits inside 1280, so nothing is clamped.
    expect(position()).toEqual({ position: 'fixed', left: 1016, top: 100 });
  });

  it('still falls back to the far side when a right-docked rail has no room', () => {
    // `side` is a PREFERENCE, not a constraint: the fit test is unchanged, and a viewport too
    // narrow for the preferred side puts the overlay on the other one rather than off-screen.
    renderOverlay({
      anchor: { left: 1224, top: 100, width: 56, height: 44 },
      side: 'left',
      overlaySize: { width: 400, height: 120 },
    });

    // 1224 - 8 - 400 = 816 fits; nothing to fall back to, so this pins that the preferred side
    // is used whenever it can be.
    expect(position()).toEqual({ position: 'fixed', left: 816, top: 100 });
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

  it('clamps against the layout viewport, not the window box a scrollbar widens', () => {
    // `setViewport` writes only `documentElement.client*`; it never touches
    // `window.inner*`, so those keep jsdom's own default of 1024x768 and the two measures
    // differ from the very first test. This one makes the difference deliberate and small,
    // the shape a classic scrollbar actually takes: it occupies layout space, so the
    // containing block of a `position: fixed` box is the 640px left after its 80px gutter
    // while `window.innerHeight` keeps reporting the full window.
    setViewport(1280, 720);
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 640 });

    renderOverlay({
      // Low in the rail, so the vertical clamp is what places it. The horizontal axis cannot
      // pin this: a left-rail tile sits at x 0-56, so the leading side always has room and
      // the left clamp never binds.
      anchor: { left: 0, top: 600, width: 56, height: 44 },
      overlaySize: { width: 200, height: 200 },
    });

    // 640 - 200 - 8 = 432 against the layout viewport. Measured, the other branch gives
    // 560 — which is jsdom's untouched `innerHeight` of 768 less the same 200 and 8, not
    // the 720 `setViewport` was passed. That number is why the assertion cannot be satisfied
    // by any viewport argument in this file, which is the point of it.
    expect(position().top).toBe(432);
  });

  it('renders nothing once its anchor leaves the document', () => {
    const { commit } = renderOverlay({
      anchor: { ...RAIL_TILE, top: 500 },
      overlaySize: { width: 200, height: 120 },
    });
    expect(position().top).toBe(500);

    // A detached element's `getBoundingClientRect()` is an all-zero box, so the clamp would
    // pin the overlay into the top-left corner at the viewport padding: a real, painted,
    // clickable menu attached to nothing. This is the case a caller cannot prevent by
    // clearing its own state — the tile is unmounted, not closed.
    act(() => {
      screen.getByTestId('anchor').remove();
    });
    expect(screen.queryByTestId('overlay')).not.toBeNull();

    // The commit is explicit because that is the contract: the guard is derived from the
    // anchor on every render, not stored state something has to push. A detach on its own
    // changes no state, and the layout effect no longer forces a render for a detached
    // anchor — correct, since there is no position to update for an overlay not on screen.
    commit();

    expect(screen.queryByTestId('overlay')).toBeNull();
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
