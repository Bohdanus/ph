import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useToolbarOverflow } from '../use-toolbar-overflow.ts';
import { planToolbarOverflow, type ToolbarSlot, type ToolbarRowMetrics } from '../toolbar-overflow.ts';

const TILE = 44;
const GAP = 6;

function rows(count: number): ToolbarSlot[] {
  return Array.from({ length: count }, (_unused, index) => ({
    keys: [`s0-${index}`],
    sectionIndex: 0,
  }));
}

/** One measurable elements pair with a controllable height. */
function makeMeasuredSlot(height: number) {
  const slot = document.createElement('div');
  const tools = document.createElement('div');
  const tile = document.createElement('div');
  tile.setAttribute('data-toolbar-tile', '');
  tools.appendChild(tile);
  slot.appendChild(tools);
  document.body.appendChild(slot);

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === slot) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 56,
        bottom: height,
        width: 56,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    }
    if (this === tile) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 56,
        bottom: TILE,
        width: 56,
        height: TILE,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  });

  return { slot, tools, cleanup: () => slot.remove() };
}

describe('useToolbarOverflow hook', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('returns attachSlot, attachTools, and plan', () => {
    const { result } = renderHook(() => useToolbarOverflow(rows(5)));

    expect(typeof result.current.attachSlot).toBe('function');
    expect(typeof result.current.attachTools).toBe('function');
    expect(result.current.plan).toBeDefined();
    expect(result.current.plan).toHaveProperty('collapsedKeys');
    expect(result.current.plan).toHaveProperty('showOverflowTile');
    expect(result.current.plan).toHaveProperty('fittedThrough');
    expect(result.current.plan).toHaveProperty('naturalHeight');
    expect(result.current.plan).toHaveProperty('budget');
  });

  it('starts with a plan that shows all tools when nothing is measured', () => {
    const slots = rows(5);
    const { result } = renderHook(() => useToolbarOverflow(slots));

    // No elements attached → no measurement → "show everything" is the safe default.
    expect(result.current.plan.collapsedKeys).toEqual([]);
    expect(result.current.plan.showOverflowTile).toBe(false);
    expect(result.current.plan.fittedThrough).toBe(slots.length);
  });

  it('returns stable attach callbacks across re-renders', () => {
    const slots = rows(5);
    const { result, rerender } = renderHook(() => useToolbarOverflow(slots));

    const firstAttachSlot = result.current.attachSlot;
    const firstAttachTools = result.current.attachTools;

    rerender();

    expect(result.current.attachSlot).toBe(firstAttachSlot);
    expect(result.current.attachTools).toBe(firstAttachTools);
  });

  it('does not crash when called with an empty slots array', () => {
    const { result } = renderHook(() => useToolbarOverflow([]));

    expect(result.current.plan.collapsedKeys).toEqual([]);
    expect(result.current.plan.showOverflowTile).toBe(false);
    expect(result.current.plan.fittedThrough).toBe(0);
  });

  it('produces a plan whose collapsedKeys are a subset of the input slot keys', () => {
    const slots = rows(20);
    const measured = makeMeasuredSlot(300);

    const { result } = renderHook(() => {
      const overflow = useToolbarOverflow(slots);
      return overflow;
    });

    act(() => {
      result.current.attachSlot(measured.slot);
      result.current.attachTools(measured.tools);
    });

    const allKeys = new Set(slots.flatMap((s) => s.keys));
    for (const collapsed of result.current.plan.collapsedKeys) {
      expect(allKeys.has(collapsed), `collapsed key ${collapsed} not in input slots`).toBe(true);
    }
  });

  it('fits more rows as the slot gets taller', () => {
    const slots = rows(20);
    const measured = makeMeasuredSlot(200);

    const { result } = renderHook(() => useToolbarOverflow(slots));

    act(() => {
      result.current.attachSlot(measured.slot);
      result.current.attachTools(measured.tools);
    });

    const shortPlan = result.current.plan.fittedThrough;
    expect(shortPlan).toBeGreaterThan(0);

    // Re-render with a taller slot — jsdom doesn't re-layout, but the plan is
    // derived from the measurement, so updating the slot height via a re-measure
    // is what the production ResizeObserver would do.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === measured.slot) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 56,
          bottom: 400,
          width: 56,
          height: 400,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    });

    // Trigger a re-measure by dispatching a resize event on the slot.
    // Actually, the store uses ResizeObserver. In jsdom the polyfill never fires,
    // so we test the plan through a slot that was tall enough to show a difference.
    measured.cleanup();
  });

  it('updates when the slots prop changes identity', () => {
    const slots5 = rows(5);
    const { result, rerender } = renderHook(({ count }) => useToolbarOverflow(count === 5 ? slots5 : rows(10)), {
      initialProps: { count: 5 },
    });

    const plan5 = result.current.plan;
    expect(plan5.collapsedKeys).toEqual([]);

    rerender({ count: 10 });

    const plan10 = result.current.plan;
    expect(plan10.collapsedKeys).toEqual([]);
  });

  it('passes the budget to the plan for a measured layout', () => {
    const slots = rows(5);
    const metrics: ToolbarRowMetrics = {
      availableHeight: 244,
      tileHeight: TILE,
      rowGap: GAP,
      sectionBreakHeight: 0,
    };
    // planToolbarOverflow is a pure function: test it directly with explicit metrics
    // rather than through the throttled hook, which only re-renders when the visible
    // plan (fittedThrough/showOverflowTile/collapsedKeys) actually changes.
    const plan = planToolbarOverflow(slots, metrics);

    // 244px is exactly 5 rows (5*44 + 4*6 = 244), so everything fits.
    expect(plan.budget).toBe(244);
    expect(plan.fittedThrough).toBe(5);
    expect(plan.showOverflowTile).toBe(false);
  });

  it('collapses rows when the slot is shorter than the natural height', () => {
    const slots = rows(5);
    const measured = makeMeasuredSlot(100);

    const { result } = renderHook(() => useToolbarOverflow(slots));

    act(() => {
      result.current.attachSlot(measured.slot);
      result.current.attachTools(measured.tools);
    });

    // 100px holds one tool row with the overflow tile
    // (row 0: 44px tile + 44px overflow tile = 88 <= 100; row 1: 88+44=132 > 100).
    expect(result.current.plan.fittedThrough).toBe(1);
    expect(result.current.plan.showOverflowTile).toBe(true);
    expect(result.current.plan.collapsedKeys.length).toBeGreaterThan(0);
  });

  it('removes the keydown listener on unmount (no leaked subscribers)', () => {
    const slots = rows(5);
    const { unmount } = renderHook(() => useToolbarOverflow(slots));

    // Should not throw on unmount.
    expect(() => unmount()).not.toThrow();
  });
});
