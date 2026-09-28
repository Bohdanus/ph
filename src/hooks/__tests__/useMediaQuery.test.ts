import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_MEDIA_QUERY, TABLET_MEDIA_QUERY, useIsMobileViewport, useIsTabletViewport } from '../useMediaQuery.ts';
import { setViewportWidth } from '../../test/setup.ts';

const DESKTOP_WIDTH = 1280;
const TABLET_WIDTH = 900;

describe('media query constants', () => {
  // The two must be the same boundary the stylesheet compiles. Tailwind's `max-md:` is
  // `(width < 48rem)` unless `--breakpoint-md` is pinned to px, and a rem media feature
  // resolves against the user's default font size — so a rem here and a px there drift
  // apart at any non-default font size and leave a band where CSS hides the desktop chrome
  // while the JS still mounted it.
  it('expresses the mobile boundary in px, matching the pinned Tailwind breakpoint', () => {
    expect(MOBILE_MEDIA_QUERY).toBe('(width < 768px)');
    expect(MOBILE_MEDIA_QUERY).not.toMatch(/rem/);
  });

  it('expresses the tablet band as the complement of mobile below lg', () => {
    expect(TABLET_MEDIA_QUERY).toBe('(width >= 768px) and (width < 1024px)');
  });

  it('partitions every viewport width into exactly one band', () => {
    // Boundaries inclusive of their edge: 767 is mobile, 768 is tablet, 1023 is tablet,
    // 1024 is neither. A gap or an overlap here is the half-state defect.
    const bands: Array<[number, 'mobile' | 'tablet' | 'desktop']> = [
      [320, 'mobile'],
      [767, 'mobile'],
      [768, 'tablet'],
      [900, 'tablet'],
      [1023, 'tablet'],
      [1024, 'desktop'],
      [1280, 'desktop'],
    ];

    for (const [width, expected] of bands) {
      setViewportWidth(width);
      const actual = evaluateBand(width);
      expect({ width, actual }).toEqual({ width, actual: expected });
    }
  });
});

/** The real hook, evaluated through the setup file's query evaluator. */
function evaluateBand(width: number): 'mobile' | 'tablet' | 'desktop' {
  setViewportWidth(width);
  if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return 'mobile';
  if (window.matchMedia(TABLET_MEDIA_QUERY).matches) return 'tablet';
  return 'desktop';
}

describe('useMediaQuery', () => {
  afterEach(() => {
    setViewportWidth(DESKTOP_WIDTH, 800);
    vi.restoreAllMocks();
  });

  it('reads the viewport synchronously so the first committed tree is already correct', () => {
    setViewportWidth(400);
    const { result } = renderHook(() => useIsMobileViewport());
    // No `act`, no flush: the answer is available on the first render. A hook that
    // resolved the query in an effect would answer false here, paint the desktop shell on
    // a phone for one frame, and then swap it.
    expect(result.current).toBe(true);
  });

  it('re-renders only when the answer flips, not on every resize frame', () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);

    let renderCount = 0;
    const counted = renderHook(() => {
      renderCount += 1;
      return useIsMobileViewport();
    });

    // Ten widths inside the desktop band produce no answer change, so the hook must not
    // re-render. A `resize` listener over `innerWidth` re-renders on every one of these.
    for (const width of [1279, 1278, 1277, 1270, 1260, 1250, 1240, 1230, 1220, 1210]) {
      act(() => setViewportWidth(width));
    }
    expect(counted.result.current).toBe(false);

    // Exactly one crossing is one re-render.
    const before = renderCount;
    act(() => setViewportWidth(700));
    expect(counted.result.current).toBe(true);
    expect(renderCount).toBe(before + 1);

    // And back again is one more, not ten.
    const afterCrossing = renderCount;
    for (const width of [800, 900, 1000, 1100, 1200]) {
      act(() => setViewportWidth(width));
    }
    expect(renderCount).toBe(afterCrossing + 1);
    expect(result.current).toBe(false);
  });

  it('moves across both boundaries with exactly one render each', () => {
    setViewportWidth(DESKTOP_WIDTH);
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useIsTabletViewport();
    });
    expect(result.current).toBe(false);

    act(() => setViewportWidth(TABLET_WIDTH));
    expect(result.current).toBe(true);
    act(() => setViewportWidth(400));
    expect(result.current).toBe(false);
    act(() => setViewportWidth(TABLET_WIDTH));
    expect(result.current).toBe(true);

    // 1 initial + 3 crossings.
    expect(renderCount).toBe(4);
  });

  it('removes its change listener on unmount', () => {
    setViewportWidth(TABLET_WIDTH);
    const removeEventListener = vi.fn();
    const original = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const list = original.call(window, query);
      return { ...list, removeEventListener } as unknown as MediaQueryList;
    });

    const { unmount } = renderHook(() => useIsTabletViewport());
    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('treats an absent matchMedia as desktop, never as mobile', () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the primitive to model a non-browser host
    delete window.matchMedia;

    try {
      const { result } = renderHook(() => useIsMobileViewport());
      expect(result.current).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('does not throw when a host only implements the legacy addListener form', () => {
    const original = window.matchMedia;
    const removeListener = vi.fn();
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const list = original.call(window, query);
      return {
        ...list,
        addEventListener: undefined,
        addListener: vi.fn(),
        removeListener,
      } as unknown as MediaQueryList;
    });

    const { unmount, result } = renderHook(() => useIsTabletViewport());
    expect(result.current).toBe(false);
    unmount();
    expect(removeListener).toHaveBeenCalledWith(expect.any(Function));
  });
});
