/**
 * How many tool tiles the left rail can show before the rest collapse into the
 * three-dots tile.
 *
 * This module is deliberately pure: it takes a row of already-measured pixel
 * numbers and returns which rows survive. Everything DOM-shaped — measuring the
 * slot, reading the tile height, reading the grid's row gap — lives in
 * `toolbar-fit-store.ts`, behind the `useToolbarOverflow` hook in
 * `use-toolbar-overflow.ts`, so the arithmetic that decides what a user can reach
 * can be tested in jsdom against numbers chosen to make the boundary visible,
 * which is the only way a "does it fit" rule can be pinned at all.
 */

/**
 * The share of the rail's tool slot the tiles may occupy.
 *
 * **One.** It was `0.8`, on the stated grounds that "the remaining fifth is headroom, so the
 * rule does not flip on the last pixel of a window drag". The stability claim was true and the
 * arithmetic behind it was not, in a way that is worth writing down because the wrong version of
 * it is the obvious one.
 *
 * Rows are accepted WHOLE, so the count is a step function of the slot's height either way — that
 * part holds, and it is why the rail does not shimmer while a window is dragged. What the fraction
 * changed is the WIDTH OF THE STEPS, and by different amounts at different rows. A row inside a
 * section costs 50px — a 44px tile and the grid's 6px gap — so with a budget of `0.8 × A` the
 * count moved every `50 / 0.8 = 62.5`px of window and with a budget of `A` it moves every 50px: a
 * quarter more tolerance for a drag. A row that OPENS A SECTION costs 57px, because the boundary
 * adds its own 7px, and those steps went from `57 / 0.8 = 71.25` to 57. So of the fifteen gaps in
 * this rail's map, eleven were 12.5px stickier and four were 14.25px stickier.
 *
 * That is not what the trade was worth. 12.5px of tolerance is felt only as an absence of flicker,
 * while the price is visible and permanent, and it is the wrong trade for the SEQUENCE of a drag:
 * a wider band means the rail holds a stale count for longer as the window crosses each boundary,
 * and a stale count here is not a number, it is a tool the user cannot see.
 *
 * What the old budget actually cost, measured: on a 448px slot — an ordinary 1280x720 window — it
 * admitted six tool tiles where seven fit and left 97px of the slot empty. The rail now leaves 40,
 * which is the fraction of a row no whole row can use. The three-dots tile still appears at 720, and
 * it now lists the Brush group down instead of the Colors/Levels group down — one row further
 * down the map, and the group that was first to fold is no longer reachable by accident of depth.
 *
 * **THE HEADROOM THAT IS REAL IS THE FLOOR, not the fraction.** {@link planToolbarOverflow} floors
 * the budget, so a slot is never shorter than the pixels it was measured at, and a fractional
 * device pixel cannot push the grid one row past a boundary the arithmetic had accepted. That is a
 * whole pixel of slack at most, against the fifth of the rail the fraction was spending.
 *
 * The parameter is still here because it is the policy seam, and a caller that wants a rail to
 * leave room below its tiles can ask for it. Nothing in this repository does.
 */
export const TOOLBAR_HEIGHT_BUDGET = 1;

/**
 * One ROW of the tool grid, which is not the same thing as one tool group.
 *
 * In the one-column rail a row is a group, so `keys` holds exactly one. In the
 * two-column rail the grid auto-flows groups into pairs, so a row holds up to two
 * and collapsing one costs both — which is the point: they share the row, and
 * leaving one of them behind would leave a hole in the middle of the grid.
 */
export type ToolbarSlot = {
  /** The group keys occupying this row, in render order. */
  readonly keys: readonly string[];
  /**
   * Which `toolbarMap` section this row belongs to. Starting a new section costs
   * a separator on top of the row gap, and the two-column rail reports `0` for
   * every row because it interleaves the sections into one grid with no separator.
   */
  readonly sectionIndex: number;
};

/** Pixel numbers read off the committed layout. Every one of them comes from the DOM. */
export type ToolbarRowMetrics = {
  /** The height the tiles may occupy, in CSS px. */
  readonly availableHeight: number;
  /** One tile's height, in CSS px. */
  readonly tileHeight: number;
  /** The grid's row gap between two rows of the same section, in CSS px. */
  readonly rowGap: number;
  /** What a section boundary costs ON TOP OF `rowGap`, in CSS px. */
  readonly sectionBreakHeight: number;
};

export type ToolbarOverflowPlan = {
  /** The group keys that no longer get a tile, in render order. */
  readonly collapsedKeys: readonly string[];
  /** Whether the three-dots tile is rendered. It is rendered only when it has something to hold. */
  readonly showOverflowTile: boolean;
  /** The height every row would take with nothing collapsed, in CSS px. */
  readonly naturalHeight: number;
  /** The height the surviving rows were fitted to, in CSS px. */
  readonly budget: number;
  /** How many leading rows stay visible. */
  readonly fittedThrough: number;
};

/** The plan for "everything is visible", which is also the plan when nothing is measurable yet. */
const everythingVisible = (naturalHeight: number, budget: number, slotCount: number): ToolbarOverflowPlan => ({
  collapsedKeys: [],
  showOverflowTile: false,
  naturalHeight,
  budget,
  fittedThrough: slotCount,
});

/**
 * Decide which rows of the tool grid survive at this height.
 *
 * The collapse is a **suffix**, never a hole: the rows that do not fit are the bottom
 * ones, and the three-dots tile takes the row where they begin. That is where Photoshop
 * puts it — the tile that holds the tools which are not shown sits below the tools that
 * are, above the colour swatches — and it is also the only arrangement that keeps the top
 * of the list stable while the window is being dragged, which is the only time this runs
 * at any speed.
 *
 * The three-dots tile is a full row, and that is what makes the answer simple: the plan
 * renders exactly as many rows as the budget holds, and the LAST of them is the tile
 * rather than a tool. Reserving the tile's row rather than appending it after the fit is
 * what buys that; deciding the fit first and then adding the tile is the bug this ordering
 * exists to prevent, because a tile added to a full budget is one row past it.
 *
 * The consequence is usually that a collapse costs TWO rows rather than one: keeping `n - 1`
 * tool rows and drawing the tile would cost exactly the `n` rows of the full list, which is
 * the height the budget has already rejected. **"Usually", though — a one-row collapse is
 * reachable, and it is reachable exactly when the last row is the first row of a new
 * section.** The separator sits between the row that would be kept and the row that would be
 * dropped, so the tile replaces the separator as well as the row, and the fit clears a band
 * as wide as `sectionBreakHeight` that it otherwise could not. Two test fixtures happened to
 * hide this — they put every row in one section, and the last section of the real map has
 * three groups — so it was held by two accidents rather than by the arithmetic. It matters
 * because the two-column half-row argument rests on it: a two-column rail cannot drop one
 * group of a pair, because the pair is the row, and that is still true whatever the
 * separator does.
 */
export const planToolbarOverflow = (
  slots: readonly ToolbarSlot[],
  metrics: ToolbarRowMetrics,
  budgetFraction: number = TOOLBAR_HEIGHT_BUDGET
): ToolbarOverflowPlan => {
  // Nothing measurable means nothing may be hidden. A rail that has not been laid
  // out yet — first paint, or a jsdom render with no geometry — must show every tool
  // rather than guess, and the rail's own scrolling is still there as the backstop.
  if (slots.length === 0) return everythingVisible(0, 0, 0);
  if (metrics.tileHeight <= 0 || metrics.availableHeight <= 0) return everythingVisible(0, 0, slots.length);

  const { tileHeight, rowGap, sectionBreakHeight, availableHeight } = metrics;
  // FLOORED, and that is the whole of the safety margin. `availableHeight` is a measured
  // `getBoundingClientRect` height, so it can be fractional, and a budget of exactly that
  // fraction compares a sum of whole rows against a number the grid will then lay out
  // against the same fraction — which is sound arithmetic and one device pixel away from a
  // scrollbar. Flooring spends at most one pixel and cannot move a row boundary that is not
  // already a pixel away, which is why it replaces the fifth the fraction used to spend.
  const budget = Math.floor(availableHeight * budgetFraction);

  /** The space that goes ABOVE row `index`, which is what makes the total more than rows x height. */
  const gapAbove = (index: number): number => {
    if (index === 0) return 0;
    return rowGap + (slots[index].sectionIndex === slots[index - 1].sectionIndex ? 0 : sectionBreakHeight);
  };

  let naturalHeight = 0;
  for (let index = 0; index < slots.length; index += 1) {
    naturalHeight += gapAbove(index) + tileHeight;
  }

  if (naturalHeight <= budget) return everythingVisible(naturalHeight, budget, slots.length);

  let height = 0;
  let fittedThrough = 0;
  for (let index = 0; index < slots.length; index += 1) {
    const withRow = height + gapAbove(index) + tileHeight;
    // The three-dots tile is a trailing row of the SAME grid, so it always costs a plain
    // row gap. The gap is charged unconditionally, including when this is the first row
    // being considered: accepting a first row puts the tile SECOND, and a check that
    // assumed the tile was the first row validated a total one gap shorter than the one
    // that gets rendered. That cost exactly one row of overflow at a single boundary and
    // nothing anywhere else, which is the shape of bug a single boundary test misses and
    // a sweep over every height cannot.
    const withOverflowTile = withRow + rowGap + tileHeight;
    if (withOverflowTile > budget) break;
    height = withRow;
    fittedThrough = index + 1;
  }

  const collapsedKeys = slots.slice(fittedThrough).flatMap((slot) => slot.keys);
  return {
    collapsedKeys,
    // With no row accepted the tile stands alone, so the gap the fit charged it is not
    // rendered — a lone tile is `tileHeight` and nothing more.
    //
    // WHICH SECTION it stands alone in is therefore load-bearing, and it is `SidebarLeft`'s
    // job to put it in section 0: a `<ul>` for any section after the first carries
    // `mt-1.5 border-t pt-1.5`, which is 13px of chrome for a separator with nothing above it.
    // The fallback to the last section was 13px of unaccounted height in the one state where
    // the slot is too short to hold anything at all.
    showOverflowTile: collapsedKeys.length > 0,
    naturalHeight,
    budget,
    fittedThrough,
  };
};
