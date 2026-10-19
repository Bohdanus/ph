import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentDevicePixelRatio, useDevicePixelRatio } from '../useDevicePixelRatio.ts';

function withDpr<T>(value: number, body: () => T): T {
  const original = window.devicePixelRatio;
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
  try {
    return body();
  } finally {
    Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
  }
}

function createMatchMediaMock() {
  const listeners = new Set<() => void>();
  const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
    () =>
      ({
        matches: true,
        media: '',
        onchange: null,
        addEventListener: (_t: string, l: () => void) => listeners.add(l),
        removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
  return { listeners, matchMedia };
}

describe('currentDevicePixelRatio', () => {
  it('reads the ratio the compositor uses', () => {
    withDpr(2, () => expect(currentDevicePixelRatio()).toBe(2));
  });

  /**
   * A backing store of zero is not a small canvas, it is a 300x150 one: the HTML spec replaces a
   * zero or negative dimension with the default. So a 0 or NaN ratio has to fall back to 1, which
   * reproduces a 1:1 canvas rather than a surprise-sized one.
   */
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back to 1 for %s', (bad) => {
    withDpr(bad, () => expect(currentDevicePixelRatio()).toBe(1));
  });

  it('reports 1 when there is no window', () => {
    expect(currentDevicePixelRatio()).toBeGreaterThan(0);
  });
});

describe('useDevicePixelRatio', () => {
  afterEach(() => vi.restoreAllMocks());

  it('re-renders with a new ratio when the window moves to a display with a different one', () => {
    // The `(resolution: Ndppx)` query captured at mount stops matching the moment the ratio moves,
    // so a hook that only listened to that one would fire once and never again. The test drives the
    // notification and then changes the value the next listener would be re-subscribed against.
    const listeners = new Set<() => void>();
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      () =>
        ({
          matches: true,
          media: '',
          onchange: null,
          addEventListener: (_t: string, l: () => void) => listeners.add(l),
          removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList
    );

    withDpr(1, () => {
      const { result } = renderHook(() => useDevicePixelRatio());
      expect(result.current).toBe(1);
      const queriesAtMount = matchMedia.mock.calls.length;

      Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
      // Snapshot first: `onChange` re-subscribes itself onto the same Set, and `Set.forEach`
      // visits entries added during iteration, so iterating the live Set would re-enter forever.
      act(() => {
        [...listeners].forEach((l) => l());
      });

      expect(result.current).toBe(2);
      // A second query was opened against the NEW ratio; without the re-subscribe the next change
      // would be invisible.
      expect(matchMedia.mock.calls.length).toBe(queriesAtMount + 1);
      expect(matchMedia.mock.calls.at(-1)?.[0]).toBe('(resolution: 2dppx)');
    });
  });
});

describe('useDevicePixelRatio edge cases', () => {
  afterEach(() => vi.restoreAllMocks());

  it('falls back to 1 at mount when devicePixelRatio is NaN', () => {
    createMatchMediaMock();
    withDpr(Number.NaN, () => {
      const { result } = renderHook(() => useDevicePixelRatio());
      expect(result.current).toBe(1);
    });
  });

  it('falls back to 1 at mount when devicePixelRatio is zero', () => {
    createMatchMediaMock();
    withDpr(0, () => {
      const { result } = renderHook(() => useDevicePixelRatio());
      expect(result.current).toBe(1);
    });
  });

  it('tracks a move through a non-finite ratio back to a finite one', () => {
    const { listeners, matchMedia } = createMatchMediaMock();
    withDpr(2, () => {
      const { result } = renderHook(() => useDevicePixelRatio());
      expect(result.current).toBe(2);
      const queriesAtMount = matchMedia.mock.calls.length;

      Object.defineProperty(window, 'devicePixelRatio', { value: Number.NaN, configurable: true });
      act(() => {
        [...listeners].forEach((l) => l());
      });
      expect(result.current).toBe(1);

      Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
      act(() => {
        [...listeners].forEach((l) => l());
      });
      expect(result.current).toBe(3);
      expect(matchMedia.mock.calls.length).toBe(queriesAtMount + 2);
    });
  });

  it.fails('updates when a plain resize event fires', () => {
    createMatchMediaMock();
    withDpr(1, () => {
      const { result } = renderHook(() => useDevicePixelRatio());
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(result.current).toBe(2);
    });
  });

  it.fails('re-subscribes with a finite resolution query after a non-finite change', () => {
    const { listeners, matchMedia } = createMatchMediaMock();
    withDpr(1, () => {
      renderHook(() => useDevicePixelRatio());
      Object.defineProperty(window, 'devicePixelRatio', { value: Number.NaN, configurable: true });
      act(() => {
        [...listeners].forEach((l) => l());
      });
      const lastQuery = matchMedia.mock.calls.at(-1)?.[0];
      expect(lastQuery).toBe('(resolution: 1dppx)');
    });
  });
});
