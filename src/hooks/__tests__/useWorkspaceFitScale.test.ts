import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({
  store: {
    containerRef: { current: null as HTMLElement | null },
    totalSize: { width: 200, height: 100 },
  },
}));

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [store],
}));

import { useWorkspaceFitScale } from '../useWorkspaceFitScale.ts';

afterEach(() => {
  store.containerRef.current = null;
  store.totalSize = { width: 200, height: 100 };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useWorkspaceFitScale', () => {
  it('uses the same client viewport as pointer mapping when borders and scrollbars reduce it', () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () =>
      ({
        left: 50,
        top: 100,
        width: 415,
        height: 220,
        right: 465,
        bottom: 320,
        x: 50,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperties(element, {
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 2 },
      clientWidth: { configurable: true, value: 385 },
      clientHeight: { configurable: true, value: 200 },
      offsetWidth: { configurable: true, value: 415 },
      offsetHeight: { configurable: true, value: 220 },
    });
    store.containerRef.current = element;

    const { result } = renderHook(() => useWorkspaceFitScale());

    expect(result.current).toBe(1.925);
  });

  it('keeps the last valid fit scale while document dimensions are unavailable', () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () =>
      ({
        left: 50,
        top: 100,
        width: 415,
        height: 220,
        right: 465,
        bottom: 320,
        x: 50,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperties(element, {
      clientLeft: { configurable: true, value: 2 },
      clientTop: { configurable: true, value: 2 },
      clientWidth: { configurable: true, value: 385 },
      clientHeight: { configurable: true, value: 200 },
      offsetWidth: { configurable: true, value: 415 },
      offsetHeight: { configurable: true, value: 220 },
    });
    store.containerRef.current = element;

    const { result, rerender } = renderHook(() => useWorkspaceFitScale());
    const lastValidScale = result.current;

    store.totalSize = { width: 0, height: 100 };
    rerender();

    expect(result.current).toBe(lastValidScale);
  });
});
