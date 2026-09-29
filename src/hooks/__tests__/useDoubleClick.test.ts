import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useDoubleClick } from '../useDoubleClick';
import type { Point } from '../../contexts/general-types';

describe('useDoubleClick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createPointsRef = (count: number) =>
    ({
      current: Array.from({ length: count }, (_, i) => ({ x: i, y: i })),
    }) as React.RefObject<Point[]>;

  const createNullPointsRef = () =>
    ({
      current: null,
    }) as unknown as React.RefObject<Point[]>;

  it('detects a valid double click', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick));

    const pointsRef = createPointsRef(3);

    expect(result.current.handleClick({ x: 10, y: 10 }, pointsRef)).toBe(false);

    vi.advanceTimersByTime(100);

    expect(result.current.handleClick({ x: 12, y: 11 }, pointsRef)).toBe(true);

    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('does not detect a double click when there are not enough points', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick));

    const pointsRef = createPointsRef(2);

    result.current.handleClick({ x: 10, y: 10 }, pointsRef);

    vi.advanceTimersByTime(100);

    expect(result.current.handleClick({ x: 11, y: 11 }, pointsRef)).toBe(false);

    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('does not detect a double click when the points ref is null', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick));

    const pointsRef = createNullPointsRef();

    expect(result.current.handleClick({ x: 10, y: 10 }, pointsRef)).toBe(false);

    vi.advanceTimersByTime(100);

    expect(result.current.handleClick({ x: 12, y: 11 }, pointsRef)).toBe(false);

    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('detects a double click only above minPointsForDetection, not at it', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick, { minPointsForDetection: 3 }));

    const atThreshold = createPointsRef(3);

    expect(result.current.handleClick({ x: 10, y: 10 }, atThreshold)).toBe(false);

    vi.advanceTimersByTime(100);

    expect(result.current.handleClick({ x: 11, y: 11 }, atThreshold)).toBe(false);

    expect(onDoubleClick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);

    expect(result.current.handleClick({ x: 12, y: 12 }, createPointsRef(4))).toBe(true);

    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('does not detect a double click when clicks are too far apart', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick));

    const pointsRef = createPointsRef(3);

    result.current.handleClick({ x: 10, y: 10 }, pointsRef);

    vi.advanceTimersByTime(100);

    expect(result.current.handleClick({ x: 50, y: 50 }, pointsRef)).toBe(false);

    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('does not detect a double click after the time threshold', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick));

    const pointsRef = createPointsRef(3);

    result.current.handleClick({ x: 10, y: 10 }, pointsRef);

    vi.advanceTimersByTime(301);

    expect(result.current.handleClick({ x: 11, y: 11 }, pointsRef)).toBe(false);

    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('resets internal state after a successful double click', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick));

    const pointsRef = createPointsRef(3);

    result.current.handleClick({ x: 10, y: 10 }, pointsRef);

    vi.advanceTimersByTime(100);

    expect(result.current.handleClick({ x: 11, y: 11 }, pointsRef)).toBe(true);

    vi.advanceTimersByTime(100);

    // Would incorrectly fire again if state wasn't reset.
    expect(result.current.handleClick({ x: 12, y: 12 }, pointsRef)).toBe(false);

    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('reset() clears click history', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() => useDoubleClick(onDoubleClick));

    const pointsRef = createPointsRef(3);

    result.current.handleClick({ x: 10, y: 10 }, pointsRef);

    act(() => {
      result.current.reset();
    });

    vi.advanceTimersByTime(100);

    expect(result.current.handleClick({ x: 11, y: 11 }, pointsRef)).toBe(false);

    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('uses custom thresholds', () => {
    const onDoubleClick = vi.fn();

    const { result } = renderHook(() =>
      useDoubleClick(onDoubleClick, {
        distanceThreshold: 100,
        timeThresholdMs: 1000,
      })
    );

    const pointsRef = createPointsRef(3);

    result.current.handleClick({ x: 0, y: 0 }, pointsRef);

    vi.advanceTimersByTime(900);

    expect(result.current.handleClick({ x: 70, y: 70 }, pointsRef)).toBe(true);

    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });
});
