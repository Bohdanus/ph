import { describe, expect, it } from 'vitest';
import { planToolbarOverflow, type ToolbarRowMetrics, type ToolbarSlot } from '../toolbar-overflow.ts';

/**
 * The real tile metrics of this rail, so the numbers below are the ones the planner meets.
 * `h-11` is 2.75rem and `gap-1.5` is 0.375rem at the default 16px root.
 */
const TILE = 44;
const GAP = 6;
/** `mt-1.5 border-t pt-1.5` between two toolbar sections, minus the grid's own row gap. */
const SECTION_BREAK = 7;

/**
 * The shortest slot whose 80% budget can hold a row AND the three-dots tile: the tile
 * costs `GAP + TILE` exactly as a row does, and it is the last thing rendered, so a slot
 * below `50 / 0.8 = 62.5` cannot hold both. That band is handled on its own terms in the
 * degenerate test below, and the sweep starts at the first integer that clears it.
 */
const SHORTEST_FITTING_SLOT = 63;

const metrics = (availableHeight: number, overrides: Partial<ToolbarRowMetrics> = {}): ToolbarRowMetrics => ({
  availableHeight,
  tileHeight: TILE,
  rowGap: GAP,
  sectionBreakHeight: 0,
  ...overrides,
});

/** One group per row, the shape the one-column rail produces. */
const rows = (count: number): ToolbarSlot[] =>
  Array.from({ length: count }, (_unused, index) => ({ keys: [`s0-${index}`], sectionIndex: 0 }));

/** The height the plan will actually render, which the budget has to contain. */
const renderedHeight = (fittedThrough: number, overflowTile: boolean, sectionBreakHeight = 0): number => {
  // With no row accepted the three-dots tile stands alone, so the gap the fit charged it
  // ahead of time is not rendered.
  if (fittedThrough === 0) return overflowTile ? TILE : 0;
  return (
    fittedThrough * TILE + Math.max(0, fittedThrough - 1) * GAP + sectionBreakHeight + (overflowTile ? GAP + TILE : 0)
  );
};

describe('planToolbarOverflow', () => {
  it('leaves every tool visible while the whole list fits inside the budget', () => {
    // Five rows of 44 with a 6px gap between them: 244px. 305 * 0.8 = 244, so the list
    // lands EXACTLY on the budget and nothing is collapsed.
    const plan = planToolbarOverflow(rows(5), metrics(305));

    expect(plan.collapsedKeys).toEqual([]);
    expect(plan.showOverflowTile).toBe(false);
    expect(plan.naturalHeight).toBe(244);
    expect(plan.budget).toBe(244);
  });

  it('collapses the bottom rows at the first pixel that does not fit, and no earlier', () => {
    // One pixel less of slot: the budget is 243.2 against a 244px list, so the list no
    // longer fits and the tail has to move. This is the whole rule in one pair of cases.
    const plan = planToolbarOverflow(rows(5), metrics(304));

    expect(plan.naturalHeight).toBe(244);
    expect(plan.budget).toBeCloseTo(243.2, 5);
    // Three rows stay: three rows plus the reserved three-dots tile is 194px, inside the
    // budget, where four rows plus the tile would be 244 and would not.
    expect(plan.fittedThrough).toBe(3);
    expect(plan.collapsedKeys).toEqual(['s0-3', 's0-4']);
    expect(plan.showOverflowTile).toBe(true);
  });

  it('never renders the tiles AND the three-dots tile past the budget, and never wastes the space it has', () => {
    // The tile is not free. Reserving its row is the difference between a plan that fits
    // and one that overflows by exactly one tile, and the invariant is swept across every
    // slot height rather than reasoned about once — the sweep is where a rounding mistake
    // in the fit shows up as a single boundary nobody thought to test.
    for (let available = SHORTEST_FITTING_SLOT; available <= 400; available += 1) {
      const plan = planToolbarOverflow(rows(6), metrics(available));

      expect(
        renderedHeight(plan.fittedThrough, plan.showOverflowTile),
        `rendered height at ${available}px of slot`
      ).toBeLessThanOrEqual(plan.budget + 1e-9);

      if (!plan.showOverflowTile || plan.fittedThrough >= 6) continue;
      // And it is not short-changed: one more visible row would have overflowed.
      expect(
        renderedHeight(plan.fittedThrough + 1, true),
        `one more row would still have fit at ${available}px`
      ).toBeGreaterThan(plan.budget);
    }
  });

  it('keeps the three-dots tile reachable when the slot is too short for anything else', () => {
    // A slot too short for two rows. The alternative to a reachable overflow tile is a
    // rail with no tiles at all, which is the one outcome that must never happen — so the
    // tile is rendered and the slot's own `overflow-y-auto` keeps it scrollable rather
    // than clipped. That is a deliberate one-row overflow, and it is named here rather
    // than left for a reader of the sweep to discover as a violation.
    const plan = planToolbarOverflow(rows(5), metrics(40));

    expect(plan.fittedThrough).toBe(0);
    expect(plan.showOverflowTile).toBe(true);
    expect(plan.collapsedKeys).toHaveLength(5);
    expect(renderedHeight(0, true), 'one tile is one row past a budget that cannot hold one').toBeGreaterThan(
      plan.budget
    );
  });

  it('charges a section separator once, at the section boundary', () => {
    // Two sections of two rows. There are THREE gaps between four rows, and only the one
    // that crosses the boundary carries a separator on top — the first row carries nothing
    // at all, so charging it would push a plan into collapsing for height that does not exist.
    const slots: ToolbarSlot[] = [
      { keys: ['a'], sectionIndex: 0 },
      { keys: ['b'], sectionIndex: 0 },
      { keys: ['c'], sectionIndex: 1 },
      { keys: ['d'], sectionIndex: 1 },
    ];

    expect(planToolbarOverflow(slots, metrics(999)).naturalHeight).toBe(TILE * 4 + GAP * 3);
    expect(planToolbarOverflow(slots, metrics(999, { sectionBreakHeight: SECTION_BREAK })).naturalHeight).toBe(
      TILE * 4 + GAP * 3 + SECTION_BREAK
    );
  });

  it('drops the rows past the last one the budget can hold, separator included', () => {
    const slots: ToolbarSlot[] = [
      { keys: ['a'], sectionIndex: 0 },
      { keys: ['b'], sectionIndex: 0 },
      { keys: ['c'], sectionIndex: 1 },
      { keys: ['d'], sectionIndex: 1 },
    ];
    // A budget of 180 sits above two rows plus the tile (144) and below three (201).
    const plan = planToolbarOverflow(slots, metrics(225, { sectionBreakHeight: SECTION_BREAK }));

    expect(plan.budget).toBe(180);
    expect(plan.fittedThrough).toBe(2);
    expect(plan.collapsedKeys).toEqual(['c', 'd']);
    expect(renderedHeight(2, true, 0)).toBeLessThanOrEqual(plan.budget);
  });

  it('collapses BOTH groups of a two-column row, because they share the row', () => {
    // The two-column grid auto-flows groups into pairs. Collapsing one of a pair would
    // leave a hole in the middle of the grid, so a row is the unit and both go.
    const paired: ToolbarSlot[] = Array.from({ length: 5 }, (_unused, row) => ({
      keys: [`two-column-${row * 2}`, `two-column-${row * 2 + 1}`],
      sectionIndex: 0,
    }));

    // 250 * 0.8 = 200: four rows fit (194), five do not (244). The four rendered are three
    // tool rows plus the three-dots tile, so the LAST TWO rows collapse — not one.
    //
    // That is not an accident of these numbers, it is what "the tile is a row" means. Keeping
    // `n - 1` tool rows and drawing the tile would cost exactly `n` rows, which is the height
    // of the full list, so a collapse that kept all but one row would have been a collapse
    // that could not have happened. A collapse always costs at least two rows, and the tile
    // is why. Which also means a two-column rail can never drop ONE group of a pair: the pair
    // is the row, and the row is the unit.
    const plan = planToolbarOverflow(paired, metrics(250));

    expect(plan.fittedThrough).toBe(3);
    expect(plan.collapsedKeys).toEqual(['two-column-6', 'two-column-7', 'two-column-8', 'two-column-9']);
    expect(plan.showOverflowTile).toBe(true);
  });

  it('renders exactly as many rows as the budget holds, counting the three-dots tile as one', () => {
    // Stated as a property over the whole range rather than as one case, because it is the
    // shape of the answer: the tile replaces the last row rather than being added to it.
    for (let available = SHORTEST_FITTING_SLOT; available <= 320; available += 1) {
      const plan = planToolbarOverflow(rows(6), metrics(available));
      const renderedRows = plan.fittedThrough + (plan.showOverflowTile ? 1 : 0);
      const heightOf = (count: number) => count * TILE + Math.max(0, count - 1) * GAP;

      expect(heightOf(renderedRows), `rendered rows at ${available}px of slot`).toBeLessThanOrEqual(plan.budget + 1e-9);
      if (renderedRows >= 6) continue;
      expect(heightOf(renderedRows + 1), `one more row would still have fit at ${available}px`).toBeGreaterThan(
        plan.budget
      );
    }
  });

  it('shows every tool when nothing has been measured yet', () => {
    // First paint, or any render with no layout. Guessing here would hide tools on the
    // screen the user looks at first, so an unmeasured rail is a full rail.
    for (const unmeasured of [
      metrics(0),
      metrics(800, { tileHeight: 0 }),
      metrics(0, { tileHeight: 0, rowGap: 0, sectionBreakHeight: 0 }),
    ]) {
      const plan = planToolbarOverflow(rows(5), unmeasured);
      expect(plan.collapsedKeys).toEqual([]);
      expect(plan.showOverflowTile).toBe(false);
    }
  });

  it('shows every tool when there are no tools', () => {
    const plan = planToolbarOverflow([], metrics(800));
    expect(plan.collapsedKeys).toEqual([]);
    expect(plan.showOverflowTile).toBe(false);
    expect(plan.fittedThrough).toBe(0);
  });

  it('honours a budget other than 80%', () => {
    // The fraction is a policy knob, and the caller has to be able to move it without the
    // planner growing a second code path.
    expect(planToolbarOverflow(rows(5), metrics(400), 1).showOverflowTile).toBe(false);
    expect(planToolbarOverflow(rows(5), metrics(400), 0.5).showOverflowTile).toBe(true);
  });
});
