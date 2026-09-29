import { expect, test, type Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { slugifyToolLabel, toolbarMap, type ToolbarTool } from '../toolbar-mapping.ts';

/**
 * The rail's overflow rule, end to end.
 *
 * The rail measures the slot its tiles live in, and when the tiles would take more than 80%
 * of it, the rows that do not fit move into a three-dots tile. This file pins the four
 * claims that rule makes, in a browser, because every one of them is a LAYOUT claim and
 * jsdom measures nothing:
 *
 * 1. the rule fires on height, and only on height;
 * 2. what it collapses is a SUFFIX — the top of the rail is the most-used end and must not move;
 * 3. every tool stays reachable, from exactly one place, including the tools nested inside a
 *    collapsed group;
 * 4. the three-dots tile is a grouped tile like any other, so it opens the same four ways.
 *
 * Plus the one that was a real defect while this file was being written: the three-dots menu
 * is as tall as its contents, and a `position: fixed` overlay clamps its position and never
 * its size, so a thirty-item menu in a 600px window ran off the bottom of the screen with no
 * scrollbar and nothing in the DOM to say so. The tail of the list — including the Type tool
 * and every shape tool — was unreachable, which defeats the entire point of a tile whose only
 * job is to keep tools reachable. Two agents found it independently; `reaches its LAST tool`
 * is the test that would have caught it.
 */

/**
 * A window tall enough that the whole rail fits, and a short one.
 *
 * TALL is much taller than a desktop window on purpose, and the number is derived rather than
 * picked. One column is sixteen rows of a 44px tile with a 6px gap and four section
 * separators, which is about 846px of tiles, and the budget is 80% of whatever the slot is —
 * so the window has to be about 1250px tall before nothing collapses at all. A 900px window
 * is a perfectly ordinary laptop and it DOES collapse; the first version of this constant
 * said otherwise and the test failed on its own first assertion. Which is the useful thing
 * to know: there is no desktop window at which a one-column rail shows all sixteen groups.
 */
const TALL = { width: 1280, height: 1400 };
const SHORT = { width: 1280, height: 600 };

const overflowTile = (page: Page) => page.getByTestId('tool-overflow-tile');
const toolsMenu = (page: Page) => page.getByTestId('tool-flyout-overflow');

/** The item test id the component mints for a tool: `tool-flyout-item-<name>-<slugified label>`. */
const itemTestId = (tool: ToolbarTool) => `tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}`;

/**
 * Every tool on the map, walked out of the map rather than copied.
 *
 * A hand-written list of tool names is the most expensive kind of test data in this repo
 * (`AGENTS.md`, "What this costs"): it goes stale silently, and a stale one lets a
 * reachability test pass without checking anything. The map is the source of truth, and the
 * specs import it — precedent at `e2e/helpers/__tests__/toolbar-helpers.unit.test.ts`.
 */
const ALL_TOOLS: readonly ToolbarTool[] = toolbarMap.flat(2);
const ALL_GROUPS: readonly { name: string; tools: readonly ToolbarTool[] }[] = toolbarMap.flatMap((section) =>
  section.map((group) => ({ name: group[0].name, tools: group }))
);

/** Open a canvas. The rail only exists with a document open, so every test needs one. */
async function open(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await expect(page.getByTestId('left-toolbar-tools')).toBeVisible();
}

/**
 * The three-dots flyout, opened the way a user opens it.
 *
 * A right click, because it reaches the same `openFlyout` as a sustained press in one event
 * and leaves no timer running across an assertion. The long-press and keyboard paths are this
 * spec's `opens the three-dots tile by keyboard` and the race spec's own sweep.
 */
async function openOverflowFlyout(page: Page) {
  await overflowTile(page).click({ button: 'right' });
  await expect(toolsMenu(page)).toBeVisible();
}

test.describe('Left tool rail overflow', () => {
  test('a rail tall enough for everything has no three-dots tile', async ({ page }) => {
    await open(page, TALL);

    // A tile with nothing to hold is noise, so it is not rendered at all rather than
    // rendered disabled: a permanent dead affordance trains people to look past it.
    await expect(overflowTile(page)).toHaveCount(0);
    await expect(page.locator('[data-testid^="tool-button-"]')).toHaveCount(toolbarMap.flat().length);
  });

  test('a short rail collapses a SUFFIX of the rows, and keeps the top', async ({ page }) => {
    await open(page, TALL);
    const before = await page
      .locator('[data-testid^="tool-button-"]')
      .evaluateAll((tiles) => tiles.map((tile) => (tile as HTMLElement).dataset.testid?.replace('tool-button-', '')));

    await page.setViewportSize(SHORT);
    await expect(overflowTile(page)).toBeVisible();

    const after = await page
      .locator('[data-testid^="tool-button-"]')
      .evaluateAll((tiles) => tiles.map((tile) => (tile as HTMLElement).dataset.testid?.replace('tool-button-', '')));

    // A PREFIX, and a strictly shorter one. The top of a tool rail is the most-used end, and
    // a collapse that dropped from the middle would move tools out from under a cursor that
    // was already on its way to one of them. `slice` is doing the real work here: it says the
    // survivors are the first N in order, which a set comparison would not.
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before.length);
    expect(after).toEqual(before.slice(0, after.length));
  });

  test('every tool is reachable from exactly one of a tile or the three-dots tile', async ({ page }) => {
    // THE contract. The collapse moves tools; it never removes them, and it never offers one
    // twice — a tool with two ways in is a tool whose identity is ambiguous.
    //
    // Asserted per GROUP rather than per tool, because a group is the unit the rail hides but
    // a tool is the unit the user reaches for: a collapsed group contributes ALL of its tools
    // to the three-dots menu, nested ones included. A flyout listing one entry per collapsed
    // group would put the Pencil out of reach for as long as the window is short — the defect
    // the two-column rail exists to avoid, reintroduced by the tile.
    for (const size of [TALL, SHORT, { width: 1024, height: 500 }, { width: 900, height: 640 }]) {
      await open(page, size);
      const hasOverflowTile = (await overflowTile(page).count()) > 0;
      if (hasOverflowTile) await openOverflowFlyout(page);

      // Counted in TOOLS, not in tiles, and the difference is the whole trap: a tile is a
      // group, so sixteen tiles are forty tools, and adding sixteen to the menu's entries and
      // calling the result a reachability count is a comparison between two different units.
      let toolsOnTiles = 0;
      for (const group of ALL_GROUPS) {
        const hasTile = (await page.getByTestId(`tool-button-${group.name}`).count()) > 0;
        if (hasTile) toolsOnTiles += group.tools.length;
        for (const tool of group.tools) {
          const inMenu = hasOverflowTile ? (await page.getByTestId(itemTestId(tool)).count()) > 0 : false;
          expect(
            hasTile !== inMenu,
            `${tool.name} at ${size.width}x${size.height}: tile=${hasTile} three-dots=${inMenu}, and a tool must be in exactly one`
          ).toBe(true);
        }
      }

      // And the arithmetic, which is the same claim as a count rather than as a partition:
      // every tool in the map is accounted for by a tile or by the three-dots menu.
      const inMenu = hasOverflowTile ? await toolsMenu(page).locator('[role="menuitemradio"]').count() : 0;
      expect(toolsOnTiles + inMenu, `tools accounted for at ${size.width}x${size.height}`).toBe(ALL_TOOLS.length);
      if (hasOverflowTile) await page.keyboard.press('Escape');
    }
  });

  test('the three-dots menu fits the window and scrolls, and reaches its LAST tool', async ({ page }) => {
    // The defect. `AnchoredOverlay` clamps the overlay's POSITION and never its size, so a
    // menu as tall as its contents in a `position: fixed` wrapper starts at the viewport's top
    // padding and runs off the bottom — with no ancestor to scroll and nothing in the DOM to
    // report it. At this size the menu holds about thirty tools, so roughly two thirds of
    // them were unreachable, the Type tool and every shape tool among them.
    await open(page, SHORT);
    await openOverflowFlyout(page);

    const menu = toolsMenu(page);
    const measures = await menu.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      height: el.getBoundingClientRect().height,
    }));
    const viewportHeight = await page.evaluate(() => document.documentElement.clientHeight);

    // The bound is doing real work — if the menu fitted, the rest of this test would pass for
    // free, and the control is what stops that.
    expect(
      measures.scrollHeight,
      'the menu must actually overflow its bound, or this test proves nothing'
    ).toBeGreaterThan(measures.clientHeight);
    expect(measures.height, 'a menu taller than the window is the bug').toBeLessThanOrEqual(viewportHeight);

    // And the last item — the one the old layout put furthest off-screen — is reachable.
    const last = ALL_TOOLS[ALL_TOOLS.length - 1];
    const lastItem = page.getByTestId(itemTestId(last));
    await lastItem.scrollIntoViewIfNeeded();
    await expect(lastItem, `the last tool in the three-dots menu must be reachable`).toBeVisible();
    const box = await lastItem.boundingBox();
    expect(box, 'the last item must be inside the window once scrolled to').not.toBeNull();
    expect(box!.y + box!.height, 'and must not hang off the bottom edge').toBeLessThanOrEqual(viewportHeight);
  });

  test('growing the window back restores the tiles and removes the three-dots tile', async ({ page }) => {
    await open(page, SHORT);
    await expect(overflowTile(page)).toBeVisible();

    await page.setViewportSize(TALL);

    await expect(overflowTile(page)).toHaveCount(0);
    await expect(page.locator('[data-testid^="tool-button-"]')).toHaveCount(toolbarMap.flat().length);
  });

  test('the rail no longer makes the page scroll', async ({ page }) => {
    // What the whole feature buys. A one-column rail used to be as tall as the whole tool
    // list, and that min-content height became the grid row's floor — which dragged the
    // `h-full` canvas up and made the PAGE outgrow a 720px viewport, so a short window
    // scrolled the editor instead of fitting it.
    await open(page, { width: 1280, height: 720 });

    const overflow = await page.evaluate(() => ({
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      railScrollable: (() => {
        const rail = document.querySelector('[data-testid="left-sidebar"]');
        return rail !== null && rail.scrollHeight > rail.clientHeight + 1;
      })(),
    }));

    expect(overflow.scrollHeight, 'the document must fit the window').toBeLessThanOrEqual(overflow.clientHeight);
    // The rail keeps `overflow-y-auto` as a backstop, and this is the assertion that says the
    // backstop is not being used: if the fit ever stopped working, the tiles would overflow
    // the slot and this would go true before anything visibly broke.
    expect(overflow.railScrollable, 'the rail fits its own height; nothing in it scrolls').toBe(false);
  });

  test('an open flyout closes when the window shrinks past its tile', async ({ page }) => {
    // A group from the BOTTOM of the rail, not a convenient one near the top. The collapse is
    // a SUFFIX, so the top of the rail is the last thing to go: a test that opened the Marquee
    // flyout and then shrank the window was asserting against a tile that never moves, and the
    // menu it then asserted had closed was still open for a reason that had nothing to do with
    // the rule.
    //
    // The LAST group with a flyout, found by walking the map backwards, so a group that moves
    // or gains a tool stays the one under test. A group needs more than one tool to have a
    // flyout at all — on a single-tool tile `contextMenu` is a no-op and the menu never opens.
    let section = 0;
    let indexInSection = 0;
    let openable: { name: string; tools: readonly ToolbarTool[] } | undefined;
    for (let s = toolbarMap.length - 1; s >= 0 && !openable; s -= 1) {
      const groups = toolbarMap[s];
      for (let g = groups.length - 1; g >= 0; g -= 1) {
        if (groups[g].length > 1) {
          openable = { name: groups[g][0].name, tools: groups[g] };
          section = s;
          indexInSection = g;
          break;
        }
      }
    }
    expect(openable, 'the rail must end in a group that has a flyout to open').toBeDefined();

    await open(page, TALL);
    const tile = page.getByTestId(`tool-button-${openable!.name}`);
    await expect(tile).toBeVisible();
    await tile.click({ button: 'right' });
    await expect(page.getByTestId(`tool-flyout-${section}-${indexInSection}`)).toBeVisible();

    await page.setViewportSize(SHORT);

    // The tile unmounted with its menu. The thing this guards is a moment LATER: with
    // `openGroup` still naming a group that is no longer rendered, the flyout would reopen
    // by itself the moment the window grew back, with nothing the user did to open it.
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expect(page.getByTestId(`tool-button-${openable!.name}`)).toHaveCount(0);

    await page.setViewportSize(TALL);
    await expect(page.locator('[role="menu"]'), 'the flyout must not reopen by itself').toHaveCount(0);
  });

  test('opens the three-dots tile by keyboard, like any other grouped tile', async ({ page }) => {
    // The three-dots tile holds a flyout, so it owes the same keyboard contract every other
    // grouped tile does: ArrowDown from the tile opens the menu and focuses its first item.
    // It is a tile rather than a special control specifically so that contract is inherited
    // instead of reimplemented, and this is the test that says the inheritance held.
    await open(page, SHORT);

    await overflowTile(page).focus();
    await page.keyboard.press('ArrowDown');

    await expect(toolsMenu(page)).toBeVisible();
    // The FIRST item of the menu it opened, by DOM order, rather than a name: which tool is
    // first depends on how much fits, so naming it would pin the viewport as well as the
    // behaviour. Comparing against the menu's own first item says what the contract is.
    const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    const firstItemTestId = await toolsMenu(page).locator('[role="menuitemradio"]').first().getAttribute('data-testid');
    expect(focusedTestId, 'ArrowDown focuses the first item of the menu it opened').toBe(firstItemTestId);
    expect(focusedTestId, 'and the focused element is a menu item, not the tile').toMatch(/^tool-flyout-item-/);
  });
});
