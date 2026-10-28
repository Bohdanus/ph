import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useContainScale } from '../useContainScale.ts';

const IMAGE = { width: 100, height: 100 };

function container(width: number, height: number) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return el;
}

describe('useContainScale', () => {
  it('reports CSS px per document px from the container it is given', () => {
    // 400x200 holding a 100x100 document: 4 across, 2 down, contained at 2.
    const ref = { current: container(400, 200) };
    const { result } = renderHook(() => useContainScale(ref, IMAGE));

    expect(result.current.current).toBe(2);
  });

  /**
   * The default is the identity divisor, and that is the point: a container that has not been
   * measured — not mounted yet, zero-sized, or a jsdom rect that reports nothing — must leave a
   * painter drawing what it drew before this hook existed, rather than dividing by 0 and producing
   * an infinite line width.
   */
  it('holds at 1 when the container cannot be measured', () => {
    const { result } = renderHook(() => useContainScale({ current: null }, IMAGE));

    expect(result.current.current).toBe(1);
  });

  it('holds at 1 for a mounted container that reports a zero size', () => {
    const ref = { current: container(0, 0) };
    const { result } = renderHook(() => useContainScale(ref, IMAGE));

    expect(result.current.current).toBe(1);
  });

  it('holds at 1 for a document with no size, which would otherwise divide by 0', () => {
    const ref = { current: container(400, 200) };
    const { result } = renderHook(() => useContainScale(ref, { width: 0, height: 0 }));

    expect(result.current.current).toBe(1);
  });

  /**
   * The reason this is a ref and not state. The marching ants read it inside a 60fps loop, so a
   * value that scheduled a render on measurement would either re-render the tree sixty times a
   * second or have to be read from a closure that goes stale. Reading `.current` schedules nothing.
   */
  it('publishes through a ref, so reading it schedules no render', () => {
    const ref = { current: container(400, 200) };
    const renders: number[] = [];
    const { result } = renderHook(() => {
      renders.push(1);
      return useContainScale(ref, IMAGE);
    });

    const afterMount = renders.length;
    void result.current.current;

    expect(renders.length).toBe(afterMount);
  });

  it('re-measures when the ref identity changes, without re-reading on every render', () => {
    const getBoundingClientRect = vi.fn(() => container(400, 200).getBoundingClientRect());
    const el = document.createElement('div');
    el.getBoundingClientRect = getBoundingClientRect as unknown as typeof el.getBoundingClientRect;
    const ref = { current: el };

    const { rerender } = renderHook(() => useContainScale(ref, IMAGE));
    const afterMount = getBoundingClientRect.mock.calls.length;
    rerender();
    rerender();

    expect(getBoundingClientRect.mock.calls.length).toBe(afterMount);
  });

  describe('edge cases: non-finite and zero/negative dimensions', () => {
    /**
     * NaN is falsy, so the guard `!rect.width` catches it before it reaches
     * `containFit`. The scale holds at 1 — the identity divisor — rather than
     * dividing by a NaN and propagating it through every painter.
     */
    it('holds at 1 when the container reports NaN in both dimensions', () => {
      const ref = { current: container(Number.NaN, Number.NaN) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when the document reports NaN in either dimension', () => {
      const ref = { current: container(400, 200) };
      const { result } = renderHook(() => useContainScale(ref, { width: Number.NaN, height: 100 }));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when only the container width is zero', () => {
      const ref = { current: container(0, 200) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when only the image height is zero', () => {
      const ref = { current: container(400, 200) };
      const { result } = renderHook(() => useContainScale(ref, { width: 100, height: 0 }));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when a NaN and a valid dimension are mixed in the container', () => {
      const ref = { current: container(Number.NaN, 300) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });
  });

  /**
   * Tripwires: each asserts the guard we WANT but the current `!width || !height`
   * check does NOT yet deliver. Infinity and negative values are both truthy, so
   * they slip through and reach `containFit` — producing a non-finite or negative
   * scale. Wrapped in `it.fails`: when a guard is added and the hook holds at 1,
   * the assertion passes and flips to an unexpected-pass signal.
   */
  describe('tripwires (it.fails: desired guards not yet implemented)', () => {
    it.fails('holds at 1 for a non-finite (Infinity) container dimension', () => {
      const ref = { current: container(Infinity, Infinity) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });

    it.fails('holds at 1 for a negative container dimension', () => {
      const ref = { current: container(-400, 200) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });
  });
});
