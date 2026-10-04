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
 * Where the two sweeps start, and why it is not zero.
 *
 * `94` is one row plus the three-dots tile's own row — `44 + 6 + 44` — and it is the smallest
 * budget that can hold the tile AND a tool row. Below it the plan is the lone three-dots
 * tile, which is a real and separately tested state (`the degenerate case` below) but is not
 * "a rail with rows in it", and the sweeps assert `one more row would have overflowed`,
 * which the lone-tile state cannot say.
 *
 * It was `63`, derived as `50 / 0.8` while the budget was a fraction of the slot. A
 * fraction-derived floor is the tell that the number below is not a property of the rail;
 * with the budget at 1 the same property is a whole number of the rail's own units.
 */
const SHORTEST_FITTING_SLOT = TILE + GAP + TILE;

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
    // Five rows of 44 with a 6px gap between them: 244px, and the budget is the slot. At
    // 244 the list lands EXACTLY on the budget and nothing is collapsed.
    const plan = planToolbarOverflow(rows(5), metrics(244));

    expect(plan.collapsedKeys).toEqual([]);
    expect(plan.showOverflowTile).toBe(false);
    expect(plan.naturalHeight).toBe(244);
    expect(plan.budget).toBe(244);
  });

  it('collapses the bottom rows at the first pixel that does not fit, and no earlier', () => {
    // One pixel less of slot: the budget is 243 against a 244px list, so the list no longer
    // fits and the tail has to move. This is the whole rule in one pair of cases.
    const plan = planToolbarOverflow(rows(5), metrics(243));

    expect(plan.naturalHeight).toBe(244);
    expect(plan.budget).toBe(243);
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
        `one more row would still have fitted at ${available}px`
      ).toBeGreaterThan(plan.budget);
    }
  });

  it('leaves no room for another tile behind the ones it shows', () => {
    // The operator's complaint about this rule, stated as a property over every height:
    // whatever the rail does not use, it cannot put a tile in.
    //
    // The budget used to be 80% of the slot, which made this false at almost every height —
    // the leftover was a fifth of the rail, four to six tiles on an ordinary window, and
    // the tools in it sat in the three-dots tile. So the leftover is now bounded by the
    // height of one row and its gap, which is the most a whole-row fit can leave behind.
    for (let available = TILE; available <= 900; available += 1) {
      const plan = planToolbarOverflow(rows(6), metrics(available));
      if (!plan.showOverflowTile || plan.fittedThrough >= 6) continue;

      const leftover = available - renderedHeight(plan.fittedThrough, plan.showOverflowTile);
      expect(leftover, `unused slot at ${available}px`).toBeLessThan(TILE + GAP);
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
    // Four rows are 201px with the separator, and the last two rows plus the three-dots tile
    // are 251. A budget of 200 keeps two rows and nothing more.
    const plan = planToolbarOverflow(slots, metrics(200, { sectionBreakHeight: SECTION_BREAK }));

    expect(plan.budget).toBe(200);
    expect(plan.fittedThrough).toBe(2);
    expect(plan.collapsedKeys).toEqual(['c', 'd']);
    expect(renderedHeight(2, true, 0)).toBeLessThanOrEqual(plan.budget);
  });

  it('can collapse exactly ONE row, when the last row is the first row of a new section', () => {
    // The counterexample to the tidy rule, found by review rather than by a failing test.
    //
    // "The tile is a full row, so a collapse always costs two" is right about the common case
    // and wrong in general. When the last row is also the FIRST row of a new section, the
    // separator sits between the row that would be kept and the row that would be dropped, so
    // the tile replaces the separator too — and the fit clears a band `sectionBreakHeight`
    // wide that it otherwise could not. Two fixtures had been hiding it: they put every row
    // in one section, and the real map's last section has three groups, so no band was ever
    // reachable from the data.
    const slots: ToolbarSlot[] = [
      { keys: ['a'], sectionIndex: 0 },
      { keys: ['b'], sectionIndex: 0 },
      { keys: ['c'], sectionIndex: 1 },
    ];
    const plan = planToolbarOverflow(slots, metrics(150, { sectionBreakHeight: SECTION_BREAK }));

    // Two rows plus the tile is 144 and fits; two rows plus the tile where the tile carries
    // no separator is 144, and three rows plus the tile is 201, which does not. A band, not a
    // point: one row collapses for every budget from 144 to 200, which is 57px wide where the
    // two-row band below it is 50 — exactly the separator.
    expect(plan.naturalHeight).toBe(TILE * 3 + GAP * 2 + SECTION_BREAK);
    expect(plan.fittedThrough).toBe(2);
    expect(plan.collapsedKeys).toEqual(['c']);
    expect(plan.showOverflowTile).toBe(true);
    // And just outside the band, two rows go, which is the common case.
    expect(planToolbarOverflow(slots, metrics(143, { sectionBreakHeight: SECTION_BREAK })).collapsedKeys).toEqual([
      'b',
      'c',
    ]);
    expect(planToolbarOverflow(slots, metrics(201, { sectionBreakHeight: SECTION_BREAK })).collapsedKeys).toEqual([]);
  });

  it('collapses BOTH groups of a two-column row, because they share the row', () => {
    // The two-column grid auto-flows groups into pairs. Collapsing one of a pair would
    // leave a hole in the middle of the grid, so a row is the unit and both go.
    const paired: ToolbarSlot[] = Array.from({ length: 5 }, (_unused, row) => ({
      keys: [`two-column-${row * 2}`, `two-column-${row * 2 + 1}`],
      sectionIndex: 0,
    }));

    // Five rows are 244px and a budget of 200 keeps three of them, with the tile standing
    // where the fourth would be. The three rendered are three tool rows plus the three-dots
    // tile, so the LAST TWO rows collapse — not one.
    //
    // That is not an accident of these numbers, it is what "the tile is a row" means. Keeping
    // `n - 1` tool rows and drawing the tile would cost exactly `n` rows, which is the height
    // of the full list, so a collapse that kept all but one row would have been a collapse
    // that could not have happened. A collapse always costs at least two rows, and the tile
    // is why. Which also means a two-column rail can never drop ONE group of a pair: the pair
    // is the row, and the row is the unit.
    const plan = planToolbarOverflow(paired, metrics(200));

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
      expect(heightOf(renderedRows + 1), `one more row would still have fitted at ${available}px`).toBeGreaterThan(
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

  it('fills the slot by default, and gives a caller that wants less room a way to ask', () => {
    // The default is 1, so the planner spends the whole slot. The fraction is still the
    // policy seam — a rail that deliberately wants a margin below its tiles can ask for one —
    // but nothing in this repository does, and the 0.8 this replaced bought no stability it
    // did not already have: rows are accepted whole, so the count steps either way.
    expect(planToolbarOverflow(rows(5), metrics(400)).showOverflowTile).toBe(false);
    expect(planToolbarOverflow(rows(5), metrics(400), 1).showOverflowTile).toBe(false);
    expect(planToolbarOverflow(rows(5), metrics(400), 0.5).showOverflowTile).toBe(true);
  });

  it('never plans against more than the slot it was measured at', () => {
    // The floor is the whole of the safety margin, and what it buys is exactness: the budget
    // is a whole number that is never larger than a fractional measurement, so a plan built
    // on it can never render past the slot. Row sums are whole pixels here, so the floor
    // rarely CHANGES a decision — what it makes exact is the budget the plan reports and the
    // `content <= available` comparison `e2e/toolbar-fit.spec.ts` sweeps, which under an
    // 80% budget had a fifth of the slot's slack to hide a separator inside.
    for (const available of [244, 243.6, 193.9, 448.25]) {
      const plan = planToolbarOverflow(rows(6), metrics(available));

      expect(plan.budget, `budget at ${available}px`).toBeLessThanOrEqual(available);
      expect(
        renderedHeight(plan.fittedThrough, plan.showOverflowTile),
        `rendered height at ${available}px`
      ).toBeLessThanOrEqual(plan.budget + 1e-9);
    }

    expect(planToolbarOverflow(rows(6), metrics(243.6)).budget).toBe(243);
    expect(planToolbarOverflow(rows(6), metrics(244)).budget).toBe(244);
  });
});
