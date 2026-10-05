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

  /**
   * Both comparisons are STRICT (`distance < distanceThreshold`, `timeSinceLastClick <
   * timeThresholdMs`), and every case above sits in the interior: 56px against a 10px
   * threshold, 301ms against 300ms. The endpoints are what a caller can actually hit — a
   * 10px threshold with a stylus that reports an exact 10px of jitter, and a second click
   * that lands on the frame boundary — and a `<=` slipped in for either `<` would let a
   * double-click fire at exactly the limit with nothing else in the file noticing.
   */
  it('requires the distance to be strictly under the threshold, not equal to it', () => {
    const onDoubleClick = vi.fn();
    const { result } = renderHook(() => useDoubleClick(onDoubleClick, { timeThresholdMs: 10_000 }));
    const pointsRef = createPointsRef(3);

    // 6-8-10: exactly 10px, which is DEFAULT_DISTANCE_THRESHOLD.
    result.current.handleClick({ x: 0, y: 0 }, pointsRef);
    vi.advanceTimersByTime(100);
    expect(result.current.handleClick({ x: 6, y: 8 }, pointsRef)).toBe(false);

    // The next press re-anchors the measurement, so the following comparison is exact too.
    result.current.handleClick({ x: 0, y: 0 }, pointsRef);
    vi.advanceTimersByTime(100);
    expect(result.current.handleClick({ x: 0, y: 9.999 }, pointsRef)).toBe(true);

    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('requires the elapsed time to be strictly under the threshold, not equal to it', () => {
    const onDoubleClick = vi.fn();
    const pointsRef = createPointsRef(3);

    // Two hooks, one per edge, because re-anchoring with a click is NOT a neutral act:
    // a press 0ms after the previous one satisfies both halves of the rule, so it is
    // itself detected as the double click and CLEARS the anchor. One hook therefore
    // cannot measure both edges — this test used to share one, which made the 299ms
    // case unreachable: the re-anchor press consumed the detection, so the press after
    // it had a null anchor and returned false whatever the elapsed time.
    const atThreshold = renderHook(() => useDoubleClick(onDoubleClick));
    atThreshold.result.current.handleClick({ x: 10, y: 10 }, pointsRef);
    vi.advanceTimersByTime(300);
    expect(atThreshold.result.current.handleClick({ x: 11, y: 10 }, pointsRef)).toBe(false);

    // 299ms: the last instant that is still a double click.
    const underThreshold = renderHook(() => useDoubleClick(onDoubleClick));
    underThreshold.result.current.handleClick({ x: 10, y: 10 }, pointsRef);
    vi.advanceTimersByTime(299);
    expect(underThreshold.result.current.handleClick({ x: 11, y: 10 }, pointsRef)).toBe(true);

    // One detection, from the 299ms hook only: the at-threshold press is the refusal.
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('never fires on a non-finite coordinate', () => {
    const onDoubleClick = vi.fn();
    const { result } = renderHook(() => useDoubleClick(onDoubleClick));
    const pointsRef = createPointsRef(3);

    result.current.handleClick({ x: 10, y: 10 }, pointsRef);
    vi.advanceTimersByTime(100);

    // `Math.sqrt(NaN)` is NaN and every `<` against it is false, so a NaN read off a
    // pointer never registers. The stale anchor it leaves behind is measured by the next
    // case, which is the part that is not obviously safe.
    expect(result.current.handleClick({ x: Number.NaN, y: Number.NaN }, pointsRef)).toBe(false);
    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it('stays dead after a non-finite coordinate poisoned the anchor, rather than misfiring', () => {
    const onDoubleClick = vi.fn();
    const { result } = renderHook(() => useDoubleClick(onDoubleClick));
    const pointsRef = createPointsRef(3);

    result.current.handleClick({ x: 10, y: 10 }, pointsRef);
    vi.advanceTimersByTime(100);
    result.current.handleClick({ x: Number.NaN, y: 0 }, pointsRef);

    vi.advanceTimersByTime(100);
    expect(result.current.handleClick({ x: 11, y: 10 }, pointsRef)).toBe(false);

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
