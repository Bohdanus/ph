import { expect, test, type Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';
import { toolbarMap, type ToolbarTool } from '../toolbar-mapping.ts';

/**
 * The fit's own contract, measured in a browser: the rendered grid really does fit inside 80%
 * of the space it has, in BOTH layouts.
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
 * jsdom cannot catch any of that: `getBoundingClientRect` is zero for every box there and
 * `getComputedStyle().rowGap` is empty, so the whole pipeline reads "unmeasurable" and the planner
 * correctly shows everything. A rule about height needs a browser.
 *
 * The other half is the two-column rail, where a collapse once produced a three-dots tile holding
 * an empty group: no `aria-haspopup`, no menu on right-click, and a `TypeError` on a plain click
 * (`tool.figure` off `undefined`). Every spec here and in `toolbar-overflow.spec.ts` runs at the
 * default one column, so nothing caught it. `both layouts collapse and stay reachable` is the
 * tripwire.
 */

const ALL_TOOLS: readonly ToolbarTool[] = toolbarMap.flat(2);
const ALL_GROUPS: readonly { name: string; tools: readonly ToolbarTool[] }[] = toolbarMap.flatMap((section) =>
  section.map((group) => ({ name: group[0].name, tools: group }))
);

/**
 * Window heights spanning "everything fits" to "almost nothing fits".
 *
 * The ends matter as much as the middle. 1400 is the only sampled height where nothing collapses,
 * and 420/400 are past the point where the budget cannot hold even the three-dots tile's row — see
 * `the degenerate band` below.
 */
const HEIGHTS = [1400, 1370, 1350, 1280, 1150, 1100, 900, 720, 600, 500, 420, 400] as const;

type Measured = {
  slotHeight: number;
  toolsChrome: number;
  available: number;
  budget: number;
  contentHeight: number;
  /** Content minus the budget. Positive means the rail broke its own rule. */
  over: number;
  tileHeight: number;
  rowGap: number;
  sectionBreakHeight: number;
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
    return {
      slotHeight: slot.getBoundingClientRect().height,
      toolsChrome,
      available,
      budget: available * 0.8,
      contentHeight,
      over: contentHeight - available * 0.8,
      tileHeight: tools.querySelector<HTMLElement>('[data-toolbar-tile]')?.getBoundingClientRect().height ?? 0,
      rowGap,
      sectionBreakHeight,
      tileCount: tools.querySelectorAll('[data-toolbar-tile]').length,
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
  `slot=${m.slotHeight.toFixed(0)} avail=${m.available.toFixed(0)} budget=${m.budget.toFixed(1)} ` +
  `content=${m.contentHeight.toFixed(0)} over=${m.over.toFixed(1)} tile=${m.tileHeight} gap=${m.rowGap} ` +
  `sep=${m.sectionBreakHeight} tiles=${m.tileCount} overflow=${m.hasOverflowTile ? 'Y' : 'n'}`;

test.describe('Toolbar fit', () => {
  test('the rendered grid fits inside 80% of its slot, at every window height', async ({ page }) => {
    test.setTimeout(PAINT_TOOLS_TEST_TIMEOUT_MS);
    const degenerate: string[] = [];
    const rows: string[] = [];

    for (const height of HEIGHTS) {
      await open(page, height);
      // The fit is driven by a ResizeObserver, so the grid settles a frame after load.
      await expect.poll(async () => (await measure(page))?.slotHeight ?? -1, { timeout: 5000 }).toBeGreaterThan(0);
      const m = await measure(page);
      if (m === null) throw new Error(`H=${height}: the rail did not render`);

      // THE DEGENERATE BAND. Below a budget of one tile the rule cannot be honoured, and the
      // plan says so out loud: it renders the three-dots tile alone, one row past the budget,
      // and the slot scrolls so the tile is still reachable. A rail with no reachable tool is
      // worse than a rail one row over, and the alternative is named in
      // `toolbar-overflow.test.ts` too. Asserted as its own state rather than skipped, so the
      // boundary is a checked claim instead of a hole in a sweep.
      if (m.budget < m.tileHeight) {
        degenerate.push(`H=${height} (budget ${m.budget.toFixed(1)} < tile ${m.tileHeight})`);
        expect(m.hasOverflowTile, `H=${height}: the one reachable tile must be the three-dots tile`).toBe(true);
        continue;
      }

      expect(m.over, `H=${height} the grid overflowed its own budget — ${row(m)}`).toBeLessThanOrEqual(0);
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

    // Printed so the next agent can re-derive the figures in AGENTS.md without re-measuring.
    console.log(`TOOLBAR FIT (one column)\n${rows.join('\n')}\ndegenerate: ${degenerate.join(', ') || 'none'}`);
    expect(degenerate.length, 'the degenerate band is a narrow edge, not most of the sweep').toBeLessThanOrEqual(3);
  });

  test('both layouts collapse and stay reachable', async ({ page }) => {
    // The two-column rail is the one the whole suite missed: `toolbarSlots` minted
    // `two-column-N` keys there while the three-dots flyout asked about `section-group` keys,
    // so a collapse matched nothing and the tile came out holding an empty group.
    for (const twoColumns of [false, true]) {
      for (const height of [1400, 900, 720, 500]) {
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
