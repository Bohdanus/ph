import { expect, test, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';
import { toolbarMap, type ToolbarTool } from '../toolbar-mapping.ts';

/**
 * The fit's own contract, measured in a browser: the rendered grid fits the space it has, and
 * what it leaves behind is too short to hold another tile.
 *
 * This file exists because the first version of the fit did not honour its own rule and nothing
 * could see it. The section separator was measured from a `<ul>`'s border-box `top`, which puts
 * the separator's own `padding-top` and `border-top` INSIDE the box — so the measurement returned
 * the margin alone, which here is exactly the 6px row gap, the `between > 0` guard discarded it,
 * and `sectionBreakHeight` was 0 in every reachable state. The planner charged 6px per boundary
 * where the DOM costs 13. The 16-row rail was modelled as 794px and measured 822px, the rendered
 * content exceeded `0.8 x slot` at six of seventeen window heights (by up to 20.8px), and no test
 * failed — the 20% headroom is a margin, not a slack, and a rule stated as a bound has to be
 * measured against.
 *
 * **THE RULE IS NOW "FILL THE SLOT", and the second assertion is the one that says so.** The
 * budget was 80% of the slot, on the stated grounds that the remaining fifth was headroom against
 * a window drag. Rows are accepted whole, so the tile count is a step function of the height
 * either way: the fraction moved the steps, it never widened them, and what it bought was a fifth
 * of the rail left empty with tools the user is looking for sitting one row further down inside
 * the three-dots tile. So `free < one row plus its gap` is asserted at EVERY height, and it is the
 * assertion that fails under the old rule — at every single one of them, which is what a
 * systematic waste looks like from the outside.
 *
 * jsdom cannot catch any of that: `getBoundingClientRect` is zero for every box there and
 * `getComputedStyle().rowGap` is empty, so the whole pipeline reads "unmeasurable" and the planner
 * correctly shows everything. A rule about height needs a browser.
 *
 * The other half is the two-column rail, where a collapse once produced a three-dots tile holding
 * an empty group: no `aria-haspopup`, no menu on right-click, and a `TypeError` on a plain click
 * (`tool.figure` off `undefined`). Every spec here and in `toolbar-overflow.spec.ts` used to run at
 * a height where the default one column collapsed, so nothing caught it. `both layouts collapse and
 * stay reachable` is the tripwire.
 */

const ALL_TOOLS: readonly ToolbarTool[] = toolbarMap.flat(2);
const ALL_GROUPS: readonly { name: string; tools: readonly ToolbarTool[] }[] = toolbarMap.flatMap((section) =>
  section.map((group) => ({ name: group[0].name, tools: group }))
);

/**
 * What a section boundary costs on top of a row gap, which bounds how much of the slot a
 * filled rail can leave behind.
 *
 * `mt-1.5 border-t pt-1.5` at the default 16px root is 6 + 1 + 6 = 13, and the row that does
 * not fit is a section's FIRST row whenever the leftover is this big rather than half of it —
 * which is why the maximality bound below is a row, a gap AND this, and not a row and a gap.
 * It is a constant here for the same reason `44` and `6` are asserted as literals further
 * down: it is the rail's class strings, and the sweep pins that the DOM agrees with it by
 * measuring the separator as 7 (`13 - 6`) at the heights where one is visible.
 */
const SECTION_SEPARATOR_COST = 13;

/**
 * Window heights spanning "everything fits" to "almost nothing fits".
 *
 * The ends matter as much as the middle. 1400 is the only sampled height where nothing collapses
 * in one column, and 420/400 are past the point where the budget cannot hold a tool row and the
 * three-dots tile's row — see `the degenerate band` below.
 *
 * `705` and `709` are here because they are the band where the old fit accepted a row it had
 * charged no separator for — the defect `HANDOFF.md` recorded as §97 and deleted once fixed — and
 * neither of them was in this list, so the file's own `over <= 0` assertion could not see the
 * defect it was written for. A list of heights that misses a seven-pixel band is a list, not a
 * sweep.
 *
 * `340` and `360` are at the bottom, because the degenerate band is a band and a sweep whose
 * lowest entry stops one row above it has never entered it: below 365 no tool tile fits at all and
 * the three-dots tile is the whole rail. A height list that cannot reach the state the file has a
 * branch for is a list with an unreachable branch in it.
 *
 * `1093` and `1094` are the other such pair, on the other side: 822px of tiles in a slot that is
 * the window height minus 272px of chrome, so nothing collapses from 1094 and the fit is already
 * two tiles short at 1093. Bracketing it with 1100 and 1000 leaves the exact edge unpinned, and this
 * is the tightest point in the rail's whole range — at 1094 the six-item Shape flyout has 17px of
 * window left below it.
 */
const HEIGHTS = [
  1400, 1370, 1350, 1280, 1150, 1100, 1094, 1093, 1000, 900, 800, 720, 709, 705, 700, 600, 500, 420, 400, 360, 340,
] as const;

type Measured = {
  slotHeight: number;
  toolsChrome: number;
  available: number;
  /** The app's budget, derived here from the same slot rather than read from the app. */
  budget: number;
  contentHeight: number;
  /** Content minus the available height. Positive means the rail broke its own rule. */
  over: number;
  /** The available height the grid did NOT use. */
  free: number;
  tileHeight: number;
  rowGap: number;
  sectionBreakHeight: number;
  /** Tool tiles only — the three-dots tile is counted separately. */
  toolCount: number;
  tileCount: number;
  hasOverflowTile: boolean;
  isSingleColumn: boolean;
};

const measure = (page: Page): Promise<Measured | null> =>
  page.evaluate((): Measured | null => {
    const slot = document.querySelector('[data-testid="left-toolbar-slot"]') as HTMLElement | null;
    const tools = document.querySelector('[data-testid="left-toolbar-tools"]') as HTMLElement | null;
    if (!slot || !tools) return null;
    const style = getComputedStyle(tools);
    const len = (v: string) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toolsChrome =
      len(style.paddingTop) + len(style.paddingBottom) + len(style.borderTopWidth) + len(style.borderBottomWidth);
    const available = slot.getBoundingClientRect().height - toolsChrome;

    const lists = [...tools.querySelectorAll<HTMLElement>(':scope > ul')];
    const nonEmpty = lists.filter((list) => list.childElementCount > 0);
    const firstTile = nonEmpty[0]?.querySelector<HTMLElement>('[data-toolbar-tile]') ?? null;
    const lastList = nonEmpty[nonEmpty.length - 1] ?? null;
    // From the top of the first visible tile to the bottom of the last non-empty list: the grid
    // as the user sees it, including every section separator between them.
    const contentHeight =
      firstTile && lastList ? lastList.getBoundingClientRect().bottom - firstTile.getBoundingClientRect().top : 0;

    // The separator the same way the app measures it: the distance from the previous list's
    // bottom to this section's FIRST TILE, minus the row gap. Read independently here so the
    // assertion is not the app agreeing with itself.
    const rowGap = lists.length > 0 ? len(getComputedStyle(lists[0]).rowGap) : 0;
    let sectionBreakHeight = 0;
    for (let i = 1; i < lists.length; i += 1) {
      const tile = lists[i].firstElementChild as HTMLElement | null;
      let previous = i - 1;
      while (previous >= 0 && lists[previous].childElementCount === 0) previous -= 1;
      if (!tile || previous < 0) continue;
      const between = tile.getBoundingClientRect().top - lists[previous].getBoundingClientRect().bottom - rowGap;
      if (between > 0) {
        sectionBreakHeight = between;
        break;
      }
    }

    const firstToggle = document.querySelector('[data-testid="toolbar-layout-toggle"]');
    const tiles = [...tools.querySelectorAll<HTMLElement>('[data-toolbar-tile]')];
    return {
      slotHeight: slot.getBoundingClientRect().height,
      toolsChrome,
      available,
      // The app FLOORS this, and the floor is reproduced here rather than trusted, so the
      // comparison is against a number this file derived from the DOM on its own.
      budget: Math.floor(available),
      contentHeight,
      over: contentHeight - available,
      free: available - contentHeight,
      tileHeight: tiles[0]?.getBoundingClientRect().height ?? 0,
      rowGap,
      sectionBreakHeight,
      toolCount: tiles.filter((tile) => tile.dataset.testid?.startsWith('tool-button-')).length,
      tileCount: tiles.length,
      hasOverflowTile: tools.querySelector('[data-testid="tool-overflow-tile"]') !== null,
      isSingleColumn: firstToggle === null || firstToggle.getAttribute('aria-pressed') === 'true',
    };
  });

async function open(page: Page, height: number) {
  await page.setViewportSize({ width: 1280, height });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await expect(page.getByTestId('left-toolbar-tools')).toBeVisible();
}

/** Wait for the fit to have re-measured, which a `ResizeObserver` does a frame after layout. */
const settled = async (page: Page): Promise<Measured> => {
  await expect
    .poll(async () => (await measure(page))?.slotHeight ?? -1, { timeout: 5000, message: 'the rail never measured' })
    .toBeGreaterThan(0);
  const m = await measure(page);
  if (m === null) throw new Error('the rail did not render');
  return m;
};

const prefersTwoColumns = async (page: Page) => {
  const toggle = page.getByTestId('toolbar-layout-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) !== 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Polled, because the fit re-measures through a ResizeObserver and the layout is a frame
  // behind the click. A one-shot read fails on a window that is about to be correct.
  await expect.poll(async () => await page.locator('[data-toolbar-tile]').first().isVisible()).toBe(true);
};

const row = (m: Measured) =>
  `slot=${m.slotHeight.toFixed(0)} avail=${m.available.toFixed(0)} budget=${m.budget.toFixed(0)} ` +
  `content=${m.contentHeight.toFixed(0)} over=${m.over.toFixed(1)} free=${m.free.toFixed(0)} tile=${m.tileHeight} gap=${m.rowGap} ` +
  `sep=${m.sectionBreakHeight} tools=${m.toolCount}/${ALL_GROUPS.length} overflow=${m.hasOverflowTile ? 'Y' : 'n'}`;

test.describe('Toolbar fit', () => {
  test('the rendered grid fits its slot, and leaves less than a row behind, at every window height', async ({
    page,
  }) => {
    test.setTimeout(PAINT_TOOLS_TEST_TIMEOUT_MS);
    const degenerate: string[] = [];
    const rows: string[] = [];

    for (const height of HEIGHTS) {
      await open(page, height);
      const m = await settled(page);

      // THE DEGENERATE BAND, found STRUCTURALLY rather than by re-deriving the fit's own
      // arithmetic. The old test recognised it as `budget < tile`, which is not the same
      // condition: the plan gives up on tool rows once the budget cannot hold a row AND the
      // three-dots tile's row, so the band is `tile + gap + tile` wide and the old test
      // under-reported it at every height in it. `one tool tile and the three-dots tile` is the
      // state itself, with no arithmetic in it that could drift.
      if (m.hasOverflowTile && m.toolCount === 0) {
        degenerate.push(`H=${height} (slot ${m.slotHeight.toFixed(0)} holds one tile of ${m.tileHeight})`);
        expect(m.hasOverflowTile, `H=${height}: the one reachable tile must be the three-dots tile`).toBe(true);
        continue;
      }

      expect(m.over, `H=${height} the grid overflowed its own budget — ${row(m)}`).toBeLessThanOrEqual(0);
      // AND IT IS NOT SHORT-CHANGED. Whatever the rail does not use, it cannot put a tile in:
      // under the old 80% budget this failed at every height on this list. Guarded on a collapse
      // being in play, because once every group has a tile the leftover is not waste — there
      // is nothing left to put in it, and a rail that padded itself out would be lying.
      if (m.toolCount < ALL_GROUPS.length) {
        expect(
          m.free,
          `H=${height} left ${m.free.toFixed(0)}px of the slot empty, which is more than a row — ${row(m)}`
        ).toBeLessThan(m.tileHeight + m.rowGap + SECTION_SEPARATOR_COST);
      }
      rows.push(`H=${String(height).padStart(4)} ${row(m)}`);
    }

    // Non-vacuity, and the reason the numbers in AGENTS.md are trustworthy. If the measurement
    // pipeline read nothing, `rowGap` and `sectionBreakHeight` would both be 0 and every
    // `over` would be ≤ 0 for the wrong reason — which is exactly how the separator bug
    // survived: the rule was unenforced and the shortfall hid inside the 20% headroom.
    const any = rows.find((line) => line.includes('H=1400')) ?? rows[0];
    expect(any, 'the sweep measured something').toBeDefined();
    expect(any, 'the tile height is read from the DOM, not from a constant').toContain('tile=44');
    expect(any, 'the row gap is read from computed style').toContain('gap=6');
    // The separator is the one the bug zeroed out. It is `mt-1.5 border-t pt-1.5` (13px) minus
    // the 6px gap, so 7 is the only correct reading; 0 is the bug this file exists to catch.
    expect(any, 'the section separator is measured, not silently zero').toContain('sep=7');
    // And the tall end must really show everything, or the sweep never tested the full grid.
    expect(any, 'H=1400 is the height at which nothing collapses').toContain('overflow=n');
    expect(any, 'and it shows every group').toContain(`tools=${ALL_GROUPS.length}/${ALL_GROUPS.length}`);
    // The edge itself, to the pixel, because everything above it depends on where it is.
    expect(
      rows.find((line) => line.startsWith('H=1094')),
      '1094 is where the rail stops folding'
    ).toContain('overflow=n');
    expect(
      rows.find((line) => line.startsWith('H=1093')),
      'and 1093 is already two tiles short'
    ).toContain(`tools=${ALL_GROUPS.length - 2}/${ALL_GROUPS.length}`);

    // Printed so the next agent can re-derive the figures in this file without re-measuring.
    console.log(`TOOLBAR FIT (one column)\n${rows.join('\n')}\ndegenerate: ${degenerate.join(', ') || 'none'}`);
    expect(degenerate.length, 'the degenerate band is a narrow edge, not most of the sweep').toBeLessThanOrEqual(3);
  });

  test('the count follows the window, and only the count that fits is ever shown', async ({ page }) => {
    // THE RESIZE PATH, on one loaded page rather than on seventeen reloads, because the claim
    // is about a window being dragged: every step below is a `setViewportSize` on a live rail,
    // which is the only way the `ResizeObserver` path is the thing under test.
    //
    // Two properties, and the second is the load-bearing one:
    //
    //  1. the count never decreases as the window grows. A collapse that dropped from the middle
    //     would move tools out from under a cursor already on its way to one of them, and the
    //     fit is only allowed to take a SUFFIX;
    //  2. the count is MAXIMAL at every height — the rendered grid leaves less than a row of
    //     the slot empty. This is the property a window drag could not have had before: the
    //     count was recomputed on every frame and settled, after the drag, on the right answer,
    //     so a per-height assertion is what says the fit was right WHILE the user was dragging
    //     rather than only afterwards.
    test.setTimeout(PAINT_TOOLS_TEST_TIMEOUT_MS);
    await open(page, 1400);

    const steps: { height: number; tools: number; free: number }[] = [];
    let previousTools = ALL_GROUPS.length;

    for (let height = 1400; height >= 340; height -= 20) {
      await page.setViewportSize({ width: 1280, height });
      // Polled on the property itself rather than on a fixed delay: a settle that waits for
      // "some measurement" would accept the previous height's answer, and one that waits for a
      // frame is a race on a loaded CI machine. Under the old rule this poll never becomes true.
      await expect
        .poll(
          async () => {
            const m = await measure(page);
            if (m === null || m.over > 0) return false;
            // A rail showing every group has nothing left to fill the slot with, so the
            // maximality claim only applies while a collapse is in play.
            return m.toolCount >= ALL_GROUPS.length || m.free < m.tileHeight + m.rowGap + SECTION_SEPARATOR_COST;
          },
          { timeout: 3000, message: `H=${height}: the rail never filled its slot` }
        )
        .toBe(true);

      const m = await measure(page);
      if (m === null) throw new Error(`H=${height}: the rail did not render`);
      expect(m.toolCount, `H=${height} lost a tile while the window was still shrinking`).toBeLessThanOrEqual(
        previousTools
      );
      previousTools = m.toolCount;
      steps.push({ height, tools: m.toolCount, free: m.free });
    }

    // And the far end really is a degenerate rail, so the sweep covered the whole range rather
    // than thirty heights of the same state.
    const counts = steps.map((step) => step.tools);
    expect(counts[0], 'the tallest window in the sweep shows every group').toBe(ALL_GROUPS.length);
    expect(counts[counts.length - 1], 'the shortest shows no tool tile at all, only the three-dots').toBe(0);
    // The sweep spans the WHOLE range, which is what makes the two properties above evidence
    // about a drag rather than about one height: a rail that pinned its count would satisfy
    // both of them at every step.
    //
    // Sixteen of the seventeen counts, and the one that never appears is fifteen — which is
    // GEOMETRY rather than an accident of this sweep. Fifteen tiles plus the three-dots tile
    // IS the full sixteen-row grid, 822px, which is the same height at which the fit shows all
    // sixteen and no tile at all. There is no budget in between, so no window produces fifteen.
    expect(new Set(counts).size, `the count took ${new Set(counts).size} values: ${counts.join(',')}`).toBe(
      ALL_GROUPS.length
    );
    expect(counts.includes(ALL_GROUPS.length - 1), 'and 15 is unreachable, not merely unsampled').toBe(false);
    // And no 20px of window moves it by more than one tile. Row boundaries are 50px apart, so a
    // step that dropped two would mean the fit had decided something other than geometry — which
    // is what a separator that reads 0 on one layout and 7 on the next does, and that was exactly
    // the §97 defect, with a 7px band to hide in.
    //
    // There is exactly one legal exception, the one above: the step off "everything" goes to
    // fourteen, because fifteen plus the three-dots tile is the full grid and so no budget
    // produces fifteen at all. Every other step is one boundary or none.
    const skips = steps.flatMap((step, index) => {
      if (index === 0) return [];
      const drop = counts[index - 1] - counts[index];
      if (drop <= 1) return [];
      const documented =
        drop === 2 && counts[index - 1] === ALL_GROUPS.length && counts[index] === ALL_GROUPS.length - 2;
      return documented ? [] : [`H=${step.height}: ${counts[index - 1]} -> ${counts[index]}`];
    });
    expect(skips, `a 20px step dropped more than one tile — ${counts.join(',')}`).toEqual([]);
  });

  test('both layouts collapse and stay reachable', async ({ page }) => {
    // The two-column rail is the one the whole suite missed: `toolbarSlots` minted
    // `two-column-N` keys there while the three-dots flyout asked about `section-group` keys,
    // so a collapse matched nothing and the tile came out holding an empty group.
    //
    // The heights are the ones where each layout actually folds something, which changed when
    // the budget stopped being 80%: a two-column grid is 394px of tiles and fits whole from a
    // 700px window up, so 720 and 900 are a no-collapse control here and 600 and 500 are not.
    for (const twoColumns of [false, true]) {
      for (const height of [1400, 900, 720, 600, 500]) {
        await open(page, height);
        if (twoColumns) await prefersTwoColumns(page);
        else {
          const toggle = page.getByTestId('toolbar-layout-toggle');
          if ((await toggle.count()) && (await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
        }
        const label = `${twoColumns ? 'two' : 'one'}-col H=${height}`;

        // A collapse has to have happened for the rest to mean anything, and one of the two
        // layouts at one height is the only place all sixteen groups fit.
        const hasOverflowTile = (await page.getByTestId('tool-overflow-tile').count()) > 0;

        // REACHABILITY, per tool: a tile or the three-dots entry, never neither, never both.
        //
        // The menu stays OPEN for the partition. It was closed before this loop in the first
        // version, and `getByTestId` on a menu item in an unmounted overlay counts zero without
        // failing — so every collapsed tool read as "in neither" and the test failed on a rail
        // that was entirely correct. A locator that reports absence is only evidence of absence
        // when the thing it names is on the page.
        if (hasOverflowTile) {
          await page.getByTestId('tool-overflow-tile').click({ button: 'right' });
          await expect(page.getByTestId('tool-flyout-overflow')).toBeVisible();
          // The empty-group bug showed up here: no `aria-haspopup`, no menu, and a TypeError on
          // a plain click. Both are asserted, because both were real.
          await expect(
            page.getByTestId('tool-overflow-tile'),
            `${label}: the tile must advertise a flyout`
          ).toHaveAttribute('aria-haspopup', 'menu');
          await expect
            .poll(
              async () => await page.getByTestId('tool-flyout-overflow').locator('[role="menuitemradio"]').count(),
              { message: `${label}: the three-dots menu must list the collapsed tools` }
            )
            .toBeGreaterThan(0);

          for (const group of ALL_GROUPS) {
            const hasTile = (await page.getByTestId(`tool-button-${group.name}`).count()) > 0;
            for (const tool of group.tools) {
              const inMenu = (await page.getByTestId(`tool-flyout-item-${tool.name}-${slug(tool)}`).count()) > 0;
              expect(hasTile !== inMenu, `${label}: ${tool.name} tile=${hasTile} three-dots=${inMenu}`).toBe(true);
            }
          }

          const inMenu = await page.getByTestId('tool-flyout-overflow').locator('[role="menuitemradio"]').count();
          let toolsOnTiles = 0;
          for (const group of ALL_GROUPS) {
            if ((await page.getByTestId(`tool-button-${group.name}`).count()) > 0) toolsOnTiles += group.tools.length;
          }
          expect(toolsOnTiles + inMenu, `${label}: tools accounted for`).toBe(ALL_TOOLS.length);
          await page.keyboard.press('Escape');
        } else {
          // Nothing collapsed, so every group has a tile of its own and every tool is reachable
          // through it. Still asserted, because "no collapse" must not become "no tiles".
          for (const group of ALL_GROUPS) {
            expect(
              await page.getByTestId(`tool-button-${group.name}`).count(),
              `${label}: ${group.name} must have a tile when nothing collapsed`
            ).toBe(1);
          }
        }

        expect(
          await page.locator('[data-testid^="tool-button-"]').count(),
          `${label}: a rail with no tile at all is not a layout`
        ).toBeGreaterThan(0);

        // And the crash the two-column bug produced: a plain click on a tile holding an empty
        // group read `tool.figure` off `undefined`. An uncaught page error is the only witness.
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(String(error)));
        if (hasOverflowTile) await page.getByTestId('tool-overflow-tile').click();
        expect(pageErrors, `${label}: clicking the three-dots tile must not throw`).toEqual([]);
      }
    }
  });
});

/** The app's slug rule, restated: a label becomes a run of non-alphanumerics as one dash. */
const slug = (tool: ToolbarTool) => tool.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
