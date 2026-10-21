import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  clearRulerMeasurement,
  resetRulerMeasurementForTest,
  setRulerMeasurement,
  syncRulerFrameSize,
  useRulerMeasurement,
} from '../ruler-measurement-store.ts';
import type { RulerMeasurement } from '../ruler.ts';

const point = (x: number, y: number) => ({ x, y });

const MEASUREMENT: RulerMeasurement = {
  start: point(10, 20),
  end: point(110, 70),
  legEnd: point(100, 100),
};

describe('ruler measurement store: setRulerMeasurement', () => {
  beforeEach(() => {
    resetRulerMeasurementForTest();
  });

  it('stores a measurement and notifies listeners', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    expect(result.current).toBeNull();

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });

    rerender();
    expect(result.current).toEqual(MEASUREMENT);
  });

  it('does NOT notify listeners when the same measurement reference is set twice', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    const before = result.current;

    // Setting the same reference: the `current === measurement` guard returns early.
    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });

    expect(result.current).toBe(before);
  });

  it('updates when a different measurement reference is set', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    const other: RulerMeasurement = {
      start: point(0, 0),
      end: point(50, 50),
    };

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    act(() => {
      setRulerMeasurement(other);
    });
    rerender();
    expect(result.current).toBe(other);
  });

  it('can transition from a measurement to null via setRulerMeasurement(null)', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    act(() => {
      setRulerMeasurement(null);
    });
    rerender();
    expect(result.current).toBeNull();
  });

  it('can transition from null to a measurement', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    expect(result.current).toBeNull();

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);
  });
});

describe('ruler measurement store: clearRulerMeasurement', () => {
  beforeEach(() => {
    resetRulerMeasurementForTest();
  });

  it('clears a set measurement to null', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    act(() => {
      clearRulerMeasurement();
    });
    rerender();
    expect(result.current).toBeNull();
  });

  it('does not throw when clearing an already-null measurement', () => {
    expect(() => clearRulerMeasurement()).not.toThrow();
  });

  it('produces null that is indistinguishable from NO_MEASUREMENT', () => {
    const { result: nullResult } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    const { result: setResult } = renderHook(() => useRulerMeasurement());

    act(() => {
      clearRulerMeasurement();
    });

    // After clearing, a new subscriber sees null, same as the initial state.
    expect(nullResult.current).toBeNull();
    expect(setResult.current).toBeNull();
  });
});

describe('ruler measurement store: syncRulerFrameSize', () => {
  beforeEach(() => {
    resetRulerMeasurementForTest();
  });

  it('drops a measurement when the frame size changes', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    act(() => {
      syncRulerFrameSize({ width: 800, height: 600 });
    });
    rerender();
    expect(result.current).toBeNull();
  });

  it('does NOT drop a measurement when the frame size is unchanged', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    // Establish the frame size first so that a second call with the same size is a no-op.
    act(() => {
      syncRulerFrameSize({ width: 800, height: 600 });
    });

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    // Same frame size string → early return, no emit → measurement preserved.
    act(() => {
      syncRulerFrameSize({ width: 800, height: 600 });
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);
  });

  it('does NOT notify listeners when the frame size is unchanged', () => {
    // Same frame size string → early return, no emit(). This is the throttle path:
    // the tool area fires this on every paint, and it must not re-render subscribers
    // when the document frame is the same.
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    // Establish the frame size first so that a second call with the same size is a no-op.
    act(() => {
      syncRulerFrameSize({ width: 800, height: 600 });
    });

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    const afterSet = result.current;

    act(() => {
      syncRulerFrameSize({ width: 800, height: 600 });
    });
    rerender();

    // No change because the frame size was the same.
    expect(result.current).toBe(afterSet);
  });

  it('does NOT notify when frame size changes but no measurement is set', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    expect(result.current).toBeNull();

    act(() => {
      syncRulerFrameSize({ width: 1920, height: 1080 });
    });
    rerender();

    expect(result.current).toBeNull();
  });

  it('treats width and height as distinct dimensions', () => {
    const { result, rerender } = renderHook(() => useRulerMeasurement());

    // Establish a baseline so this changes width only.
    act(() => {
      syncRulerFrameSize({ width: 0, height: 0 });
    });

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    // Only width changes.
    act(() => {
      syncRulerFrameSize({ width: 100, height: 0 });
    });
    rerender();
    expect(result.current).toBeNull();
  });

  it('does not notify subscribers of frame changes before a measurement exists', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useRulerMeasurement();
    });
    const initialRenderCount = renderCount;

    act(() => {
      syncRulerFrameSize({ width: 0, height: 0 });
    });

    // The frame size changes, but no measurement exists to invalidate or publish.
    expect(renderCount).toBe(initialRenderCount);
    expect(result.current).toBeNull();
  });
});

describe('ruler measurement store: resetRulerMeasurementForTest', () => {
  it('clears all module state so tests start from a known baseline', () => {
    const { result } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
      syncRulerFrameSize({ width: 1920, height: 1080 });
    });

    resetRulerMeasurementForTest();

    expect(result.current).toBeNull();
  });

  it('restores the initial null state after setting a measurement', () => {
    resetRulerMeasurementForTest();

    const { result, rerender } = renderHook(() => useRulerMeasurement());
    expect(result.current).toBeNull();

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    rerender();
    expect(result.current).toBe(MEASUREMENT);

    resetRulerMeasurementForTest();
    rerender();
    expect(result.current).toBeNull();
  });
});

describe('ruler measurement store: useRulerMeasurement hook', () => {
  beforeEach(() => {
    resetRulerMeasurementForTest();
  });

  it('returns null initially', () => {
    const { result } = renderHook(() => useRulerMeasurement());
    expect(result.current).toBeNull();
  });

  it('re-renders with new value when setRulerMeasurement is called', () => {
    const { result } = renderHook(() => useRulerMeasurement());

    expect(result.current).toBeNull();

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });

    expect(result.current).toEqual(MEASUREMENT);
    expect(result.current).toBe(MEASUREMENT);
  });

  it('re-renders with null when clearRulerMeasurement is called', () => {
    const { result } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    expect(result.current).toEqual(MEASUREMENT);

    act(() => {
      clearRulerMeasurement();
    });

    expect(result.current).toBeNull();
  });

  it('reflects frame-size drops to the hook', () => {
    const { result } = renderHook(() => useRulerMeasurement());

    act(() => {
      setRulerMeasurement(MEASUREMENT);
    });
    expect(result.current).toEqual(MEASUREMENT);

    act(() => {
      syncRulerFrameSize({ width: 1024, height: 768 });
    });

    expect(result.current).toBeNull();
  });
});
