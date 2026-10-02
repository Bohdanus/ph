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
});
