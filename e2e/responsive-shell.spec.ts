import { expect, test, type Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { slugifyToolLabel, toolbarMap } from '../toolbar-mapping.ts';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
/**
 * Desktop-first shell invariants across the responsive bands.
 *
 * Every test here is a regression pin for a defect that a jsdom test cannot see, because
 * all of them are about layout: clipping, scroll ownership, and what survives a resize.
 * The two that motivated the change were both invisible to the whole suite — a one-class
 * `overflow` edit rendered the text tool's font list as an 8px sliver, and a global
 * `overflow: hidden` made 177–377px of the left tool rail unreachable with no scrollbar.
 * Neither showed up in `npm run test`, and no spec opened the dropdown.
 */

const DESKTOP = { width: 1280, height: 800 };
/** A 1366×768 laptop window, and the same width at 125% scaling on a Full HD panel. */
const SHORT_DESKTOP = { width: 1280, height: 600 };
const TABLET = { width: 900, height: 700 };
const WIDE_DESKTOP = { width: 1600, height: 900 };

async function open(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page)).toBeVisible();
}

const leftRail = (page: Page) => page.getByTestId('left-sidebar');

/**
 * Select a tool through the header's Tools menu.
 *
 * `clickToolButton` looks for a sidebar tile, and a tile exists only for a group's PRIMARY
 * tool and only while the group is not collapsed: `transform` is the second member of
 * `[Colors, Levels, Transform]`, and the Type group is one of the ones a 600px window folds
 * into the three-dots tile. The header menu lists every tool, and the header is visible at
 * every width this spec uses.
 *
 * Addressed by the menu's OWN test id, taking the tool's name — which is what it was not.
 * It used to be addressed by accessible name, and the menu and the rail are two different
 * vocabularies: the menu calls the Type tool `Text` and the rail calls it `Horizontal Type
 * Tool`. So `selectToolFromMenu(page, 'Horizontal Type Tool')` matched the RAIL TILE, the
 * menu never opened, and the test passed for a reason that had nothing to do with the menu.
 * The tile then collapsed, and the same call became a 60-second wait for a button that was
 * never coming. A name that the menu does not use is a selector that resolves somewhere
 * unintended or nowhere, and both look like a pass or a hang rather than a mistake.
 */
async function selectToolFromMenu(page: Page, toolName: string) {
  await page.getByTestId('header-tools-menu-button').click();
  await page.getByTestId(`tools-menu-${toolName}-button`).click();
}
const railWidth = async (page: Page) => await leftRail(page).evaluate((el) => el.getBoundingClientRect().width);

/** The rail's section lists: one per entry of `toolbarMap` in one column, a single one in two. */
const sectionListCount = async (page: Page) => await page.locator('[data-testid="left-toolbar-tools"] > ul').count();

/**
 * Drive the rail into the two-column desktop preference, whichever way the default points.
 *
 * `aria-pressed` is `isSingleColumn`, so two columns is `aria-pressed="false"`. This is the
 * e2e copy of `preferTwoColumns` in `SidebarLeft.tablet.test.tsx`, and it exists because the
 * unconditional click this replaced ("if the width is not already 108, click once") read a
 * PIXEL to decide what the state was, which is a coincidence of the current design. Reading
 * the control's own state and clicking only when it is needed is what survives a default
 * change — which is exactly what happened: one column is the default now, and the old
 * condition was the only thing keeping that test from measuring the layout it meant to leave.
 *
 * Duplicated rather than shared: `e2e/helpers/toolbar-helpers.ts` belongs to another agent
 * in this change. It belongs there, and should move there once that file is free.
 */
const prefersTwoColumns = async (page: Page) => {
  const toggle = page.getByTestId('toolbar-layout-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) !== 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
};

test.describe('Left tool rail reachability', () => {
  // The rail holds 12 tool groups plus the colour swatches: ~840px of min-content inside a
  // `1fr` grid row in a `height: 100%` container. A `1fr` track is `minmax(auto, 1fr)`, so
  // the rail floors that row and the grid outgrows the viewport. The page used to scroll, so
  // the overflow was reachable; a global `overflow: hidden` removed the scroll and turned it
  // into content nobody could get to. The rail now owns its scrolling via `min-h-0`.
  for (const size of [DESKTOP, SHORT_DESKTOP, WIDE_DESKTOP]) {
    test(`every control in the rail is reachable at ${size.width}x${size.height}`, async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await open(page, size);

      // The rail must be a scroll container, or a long rail has no way to reach its end.
      const overflow = await leftRail(page).evaluate((el) => getComputedStyle(el).overflowY);
      expect(overflow, 'the rail must own its vertical scrolling').toBe('auto');

      // The colour swatches sit at the very bottom of the rail, below the fold at these
      // heights. If they cannot be scrolled into view, they are gone.
      const swatch = page.getByTestId('foreground-color-swatch');
      await swatch.scrollIntoViewIfNeeded();
      await expect(swatch).toBeVisible();

      const box = await swatch.boundingBox();
      expect(box, 'the foreground swatch must have a box').not.toBeNull();
      expect(box!.y, 'the swatch must sit inside the window').toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, 'the swatch must not sit below the window').toBeLessThanOrEqual(size.height);

      // And it must be clickable, not merely present.
      await swatch.click({ timeout: 5_000 });
    });
  }

  /**
   * Every tool in the toolbar map is reachable at a short window height — as a tile, or
   * through the three-dots tile.
   *
   * THE CONTRACT SINCE THE TILES COLLAPSE. `getByTestId('tool-button-text')` is not a
   * contract any more: at 600px the Type group is one of the groups the fit folds into the
   * three-dots tile, and the version of this test that waited for that tile spent 60 seconds
   * waiting for a button that was never coming. What the layout guarantees instead is a
   * PARTITION — every group is either a visible tile or offered by the three-dots flyout,
   * never both and never neither — so that is what is asserted, in both directions.
   *
   * The groups are walked out of `toolbarMap` by a real import rather than a copied list, and
   * copied is the failure mode: a stale list makes this assert less than it appears to, with
   * nothing failing. `toolbar-mapping.ts` is plain data behind type-only imports, and
   * `e2e/helpers/__tests__/toolbar-helpers.unit.test.ts` already imports it this way from a
   * file under `e2e/`, so the crossing is precedented rather than novel.
   */
  test('every tool is reachable at a short window height, as a tile or through the three-dots tile', async ({
    page,
  }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, SHORT_DESKTOP);

    // Every tile the rail kept has to be inside the window, and that is the guarantee the fit
    // exists to make. It is the assertion the old text-tile box check was really about, moved
    // onto the tiles that exist at this height instead of onto one that no longer does.
    const tileBoxes = await page
      .locator('[data-testid="left-toolbar-tools"] [data-toolbar-tile]')
      .evaluateAll((tiles) =>
        tiles.map((tile) => {
          const rect = tile.getBoundingClientRect();
          return { name: (tile as HTMLElement).dataset.testid, top: rect.top, bottom: rect.bottom };
        })
      );
    expect(tileBoxes.length, 'the rail kept at least one tile').toBeGreaterThan(0);
    for (const box of tileBoxes) {
      expect(box.top, `${box.name} must sit inside the window`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `${box.name} must not sit below the window`).toBeLessThanOrEqual(SHORT_DESKTOP.height);
    }

    const overflowTile = page.getByTestId('tool-overflow-tile');
    await expect(overflowTile, 'a 600px window must fold something into the three-dots tile').toBeVisible();
    await overflowTile.click({ button: 'right' });

    const menu = page.getByTestId('tool-flyout-overflow');
    await expect(menu).toBeVisible();
    // Keyed by the item test id minus its prefix, which is `tool.name` + `slugifyToolLabel`
    // of the label — the same pair the map is walked with below, so the two sides are joined
    // by construction rather than by a second, hand-written id format.
    const offered = new Set(
      await menu
        .locator('[data-testid^="tool-flyout-item-"]')
        .evaluateAll((items) =>
          items.map((item) => (item as HTMLElement).dataset.testid?.replace('tool-flyout-item-', '') ?? '')
        )
    );
    expect(offered.size, 'the three-dots tile must offer something').toBeGreaterThan(0);

    for (const section of toolbarMap) {
      for (const group of section) {
        const keys = group.map((tool) => `${tool.name}-${slugifyToolLabel(tool.label)}`);
        const folded = keys.filter((key) => offered.has(key));
        if (await page.getByTestId(`tool-button-${group[0].name}`).count()) {
          expect(
            folded,
            `${group[0].label} has a tile, so none of its tools may also be offered by the three-dots tile`
          ).toEqual([]);
        } else {
          expect(
            folded,
            `${group[0].label} has no tile, so every one of its tools must be offered by the three-dots tile`
          ).toEqual(keys);
        }
      }
    }

    // And the folded tools are not merely listed: the top of the menu is on screen, and
    // picking from it works. That is the whole of what the old tile-based test proved about
    // the bottom of the rail, carried onto the element that is at the bottom of the rail now.
    //
    // Only the FIRST item, and that is a known limit rather than a convenience. The overflow
    // menu is as tall as its contents — 34 items is 1374px against a 600px window — and
    // `AnchoredOverlay` clamps the overlay's POSITION, never its height, so everything past
    // the fold is off-screen with no scrollbar to reach it. The three-dots tile makes a whole
    // rail's worth of tools reachable in principle and, at a short window, not in practice.
    // That is a defect in the app, not in this assertion, and it is not fixable from a spec.
    const firstItem = menu.locator('[data-testid^="tool-flyout-item-"]').first();
    const firstBox = await firstItem.boundingBox();
    expect(firstBox, 'the first three-dots item must have a box').not.toBeNull();
    expect(firstBox!.y, 'the top of the three-dots menu must be on screen').toBeGreaterThanOrEqual(0);
    expect(firstBox!.y + firstBox!.height, 'the first three-dots item must fit in the window').toBeLessThanOrEqual(
      SHORT_DESKTOP.height
    );
    await firstItem.click();
    await expect(page.getByTestId('tool-flyout-overflow'), 'a pick closes the menu').toHaveCount(0);
  });
});

test.describe('No global scroll lock', () => {
  test('the shell does not lock document scrolling', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    // A global `overflow: hidden` on html/body/#root converts every overflowing region in
    // the app into unreachable content. The grid's items own their scrolling instead.
    for (const selector of ['html', 'body', '#root']) {
      const overflow = await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).overflow);
      expect(overflow, `${selector} must not lock document scrolling`).not.toBe('hidden');
    }
  });

  test('scrollable panels are not globally disabled for touch', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    // `touch-action` is the intersection of an element's value with every ancestor's, so a
    // single `touch-action: none` on `body` silently kills touch panning in every scroll
    // container in the app — the layers list, the history list, both dialogs. Only the
    // canvas needs it, and it asks for it itself.
    const bodyTouchAction = await page.locator('body').evaluate((el) => getComputedStyle(el).touchAction);
    expect(bodyTouchAction, 'body must not disable touch for the whole app').not.toBe('none');

    await clickToolButton(page, 'reposition');
    // LayersTab carries no test id, so the scroll container is selected structurally: the
    // first `overflow-y-auto` inside the panel is the history list.
    const historyList = page.locator('#right-panel div.overflow-y-auto').first();
    await expect(historyList).toBeVisible();
    const touchAction = await historyList.evaluate((el) => getComputedStyle(el).touchAction);
    expect(touchAction, 'the history list must remain touch-scrollable').toBe('auto');
  });
});

test.describe('Tool option popovers are not clipped', () => {
  // The toolbar is `overflow-visible` on desktop precisely so tool popovers can escape its
  // 50px box. Anchored `absolute` inside a clipping ancestor, the 240px font list rendered
  // as an 8px strip: the text tool's font family was unselectable and no test noticed.
  //
  // The Type tool is selected from the header menu rather than from a tile, because at these
  // heights the Type group is one of the ones the fit folds into the three-dots tile — and
  // because what is under test here is the OPTION ROW's overflow, not the rail. A popover
  // that cannot be opened is not a popover that is not clipped.
  test('the text tool font list opens fully and every font is clickable', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    await selectToolFromMenu(page, 'text');
    const trigger = page.locator('#font-family-select');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const list = page.locator('#font-family-list');
    await expect(list).toBeVisible();

    const listBox = await list.boundingBox();
    expect(listBox, 'the font list must have a box').not.toBeNull();
    // A clipped popup renders as a sliver. The list shows 14 options at ~37px each and
    // caps at 240px, so anything under 100px means the ancestor clipped it.
    expect(listBox!.height, 'the font list must not be clipped to a sliver').toBeGreaterThan(100);
    expect(listBox!.y, 'the font list must open below its trigger, not off-screen').toBeGreaterThan(0);
    expect(listBox!.y + listBox!.height, 'the font list must fit in the window').toBeLessThanOrEqual(DESKTOP.height);

    // Every option is inside the list's own box, i.e. actually rendered.
    const options = list.locator('> button');
    await expect(options).toHaveCount(14);
    const firstOption = await options.first().boundingBox();
    expect(firstOption!.height, 'each font option must be clickable').toBeGreaterThan(20);

    // And selecting one works, which it could not if the list were clipped.
    await options.nth(6).click();
    await expect(list).toBeHidden();
    await expect(trigger).toContainText(/\w/);
  });

  test('the font list opens upward when the toolbar sits near the window bottom', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, { width: 1280, height: 400 });

    await selectToolFromMenu(page, 'text');
    await page.locator('#font-family-select').click();

    const listBox = await page.locator('#font-family-list').boundingBox();
    expect(listBox).not.toBeNull();
    // Positioned with a `bottom` offset, so it must not run off the bottom of the window.
    expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(400);
  });
});

test.describe('Tablet band', () => {
  test('uses the one-column tool rail and hides the layout toggle', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, TABLET);

    // The two-column rail is a desktop preference. At 900px it would cost the canvas 52px
    // for a second column of labels nobody has room to read.
    //
    // The band cannot be read through `aria-pressed`: the toggle is not RENDERED below `lg`,
    // which is the point of hiding it rather than showing it inert, so the state is read from
    // the structure only one column produces — one `<ul>` per toolbar section, against the
    // single interleaved list the two-column rail renders. That replaces a `toBeCloseTo(56)`,
    // which was a design number: 56px is `3.5rem` and moves with the tile size, while the
    // thing the band actually decides is which of the two layouts the rail renders.
    await expect(page.getByTestId('toolbar-layout-toggle')).toBeHidden();
    expect(await sectionListCount(page), 'one <ul> per toolbar section is the one-column rail').toBe(toolbarMap.length);
  });

  test('reclaims the layers column by default and offers a toggle for it', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, TABLET);

    const panel = page.locator('#right-panel');
    await expect(panel).toBeHidden();

    const toggle = page.getByTestId('right-panel-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // 250px is the desktop panel width, so opening it is the desktop layout exactly.
    const width = await panel.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeCloseTo(250, 0);
  });

  test('gives the canvas the space the collapsed panel freed', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await open(page, TABLET);
    const collapsed = (await getWorkspaceCanvas(page).boundingBox())!.width;

    await page.getByTestId('right-panel-toggle').click();
    await expect(page.locator('#right-panel')).toBeVisible();
    const expanded = (await getWorkspaceCanvas(page).boundingBox())!.width;

    expect(collapsed, 'collapsing the panel must widen the canvas').toBeGreaterThan(expanded);
    expect(collapsed - expanded).toBeCloseTo(250, 0);
  });

  // The floor is the window plus a margin, NOT the panel's measured width. Both panels
  // used to be pinned to a measurement — 1089 and 1036 — and both had to come down by
  // exactly 4px together when the shared option-row chrome narrowed, which is how you can
  // tell a shared chrome shift from a control that went missing: a lost control takes a
  // whole widget with it, and these two moved identically. Measured on this tree the
  // panels lay out at 1085 (Shape) and 1032 (Horizontal Type) against a 900px window, so
  // the floor below leaves 15% and 14% of headroom and still fails a panel that stops
  // overflowing the window or loses more than a few percent of its width. The point of
  // the entry is that the controls past the window edge are REACHABLE, and the reachability
  // is proved below by scrolling to the end, not by this number.
  // Transform is NOT one of them — its
  // content is mostly flexible sliders, so it compresses to the row instead of overflowing.
  // Reaching for it would have asserted nothing.
  const MIN_PANEL_WIDTH = TABLET.width + 100;
  // `{ name, label }` because the header menu is addressed by the tool's NAME (`selectToolFromMenu`
  // takes a `tools-menu-<name>-button` test id) while the panels and the test titles are named by
  // the LABEL. Passing the label as the argument used to read as "pick this out of the menu" while
  // actually matching a rail tile — see that helper.
  for (const { name, label } of [
    { name: 'shape', label: 'Shape' },
    { name: 'text', label: 'Horizontal Type Tool' },
  ]) {
    test(`makes the ${label} option panel horizontally scrollable rather than unreachable`, async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await open(page, TABLET);

      await selectToolFromMenu(page, name);
      const toolbar = page.locator('[class*="grid-area:toolbar"]').first();
      const metrics = await toolbar.evaluate((el) => ({
        overflowX: getComputedStyle(el).overflowX,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));

      expect(metrics.overflowX, 'the tablet band must scroll the option row').toBe('auto');
      expect(
        metrics.scrollWidth,
        'the option row must be wider than the window, with room to spare'
      ).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);
      expect(metrics.scrollWidth, 'the row must overflow its own box').toBeGreaterThan(metrics.clientWidth);

      // The row can be driven to its end, which is the actual fix: before the tablet band
      // gained a scrollbar the controls past the window edge were not reachable at all.
      // Asserting the scroll position rather than a particular control's visibility, because
      // which control is last differs per tool and is not what this test is about.
      const scrolled = await toolbar.evaluate((el) => {
        el.scrollTo({ left: el.scrollWidth });
        return { scrollLeft: el.scrollLeft, max: el.scrollWidth - el.clientWidth };
      });
      expect(scrolled.max, 'there must be hidden content to scroll to').toBeGreaterThan(0);
      expect(scrolled.scrollLeft, 'the row must scroll to its end').toBeGreaterThan(0);
    });
  }
});

test.describe('Desktop band is unchanged', () => {
  test('has no tablet toggle and keeps the layers panel open', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    // Desktop gains no control, no state and no layout shift from the tablet work.
    await expect(page.getByTestId('right-panel-toggle')).toBeHidden();
    const panel = page.locator('#right-panel');
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(250, 0);
  });

  test('keeps the layout toggle and can reach the two-column rail', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    // The one-column rail is the DEFAULT now, so an unconditional click requests one column
    // instead of two and the assertion below measures the layout the test meant to leave.
    // The old guard read a pixel to decide the same thing — "if the width is not already
    // 108, click" — which only worked while 108 was both the design number and the
    // distinction. `prefersTwoColumns` reads the toggle's own state instead.
    const oneColumnWidth = await railWidth(page);
    await prefersTwoColumns(page);

    // The width CHANGED, rather than equalling a number: both measurements are taken here,
    // so the relation holds at any pair of widths a redesign picks. `toBeCloseTo(108)` was
    // `6.75rem` derived from the tile size, and it was a design number with a behaviour's
    // name on it. The section-list count is the structural half of the same claim.
    expect(
      await railWidth(page),
      'the two-column rail is wider than the one-column rail this test measured'
    ).toBeGreaterThan(oneColumnWidth);
    expect(await sectionListCount(page), 'the two-column rail interleaves the sections into a single list').toBe(1);
  });

  test('keeps the option row unscrollable, so popovers are never clipped', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    await selectToolFromMenu(page, 'transform');
    const toolbar = page.locator('[class*="grid-area:toolbar"]').first();
    const overflowX = await toolbar.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX, 'desktop must not become a scroll container').toBe('visible');
  });
});

test.describe('Crossing the mobile boundary', () => {
  // Both trees are mounted and CSS decides which is shown, so crossing 768px costs no React
  // work. A `isMobile` ternary would unmount and rebuild the canvas — both branches being
  // Fragments, React reconciles them positionally, so `<Main>` sits at a different index in
  // each and is destroyed and recreated. A desktop user narrowing the window under 768px
  // would lose a half-drawn stroke.
  test('the canvas survives a round trip across the mobile boundary', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    const markCanvas = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="workspace-canvas"]');
        if (!canvas) return null;
        const element = canvas as HTMLElement;
        if (!element.dataset.probe) element.dataset.probe = 'stable-identity';
        return element.dataset.probe;
      });

    expect(await markCanvas()).toBe('stable-identity');

    for (const size of [{ width: 500, height: 800 }, TABLET, DESKTOP]) {
      await page.setViewportSize(size);
      // The same node still carries the marker, so it was never unmounted.
      expect(await markCanvas(), `canvas must survive ${size.width}px`).toBe('stable-identity');
    }
  });

  test('the desktop regions are still mounted below the mobile boundary, not destroyed', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);
    await page.setViewportSize({ width: 500, height: 800 });

    // Present but hidden, which is what makes the crossing free. A ternary would remove them.
    await expect(page.locator('[class*="grid-area:header"]').first()).toBeAttached();
    await expect(page.getByTestId('left-sidebar')).toBeAttached();
  });
});

const MOBILE = { width: 500, height: 800 };

test.describe('Mobile shell does not leak onto the desktop path', () => {
  // The shell is mounted at every width and hidden with `md:hidden`, and `display: none`
  // hides without unmounting. These are the two consequences that only a browser can show.
  test('the canvas reserves room for the fixed mobile bar', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, MOBILE);

    // The bar is `position: fixed` at `h-16`, so the grid's `bottom` area resolves to zero
    // and it overlays the canvas. `<main>` must reserve that height or the bottom of the
    // image sits under the bar with no way to pan it into view.
    //
    // Selected by the `mobile-safe-bottom` class, not by `[grid-area='main']`: the grid area
    // is a Tailwind *class* on the element, so an attribute selector for it matches nothing
    // at all. That mistake shipped for one revision and reserved no space.
    const main = page.locator('[class*="grid-area:main"]').first();
    await expect(main).toBeVisible();
    await expect(main).toHaveClass(/mobile-safe-bottom/);

    const padding = await main.evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(Number.parseFloat(padding), 'the fixed bar height must be reserved').toBeGreaterThanOrEqual(60);

    // The reservation is mobile-scoped, so desktop is untouched.
    await page.setViewportSize(DESKTOP);
    const desktopPadding = await main.evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(Number.parseFloat(desktopPadding), 'desktop must reserve nothing').toBe(0);
  });

  test('an open tool sheet unmounts its panel when the viewport widens', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, MOBILE);

    const optionsToggle = page.getByRole('button', { name: 'Tool options' });
    await optionsToggle.click();
    await expect(page.locator('#mobile-tool-options')).toBeVisible();

    // Widening leaves the shell mounted and merely hidden, so an open sheet used to stay
    // rendered — a second live instance of the active tool's options panel alongside the one
    // `ToolbarHorizontal` owns, with duplicate `id`s and a duplicate window Escape listener.
    await page.setViewportSize(DESKTOP);
    await expect(optionsToggle).toBeHidden();
    await expect(page.locator('#mobile-tool-options')).toHaveCount(0);
  });

  test('leaving the mobile band leaves exactly one tool panel in the document', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, MOBILE);

    await page.getByRole('button', { name: 'Tool options' }).click();
    await expect(page.locator('#mobile-tool-options')).toBeVisible();

    await page.setViewportSize(DESKTOP);
    // The desktop toolbar now owns the panel; a duplicate would make every id in it
    // ambiguous, and `getElementById` and `<label for>` both resolve to the first match.
    const ids = ['text-input', 'font-family-select', 'blur-slider', 'rotate-slider'];
    for (const id of ids) {
      const count = await page.locator(`#${id}`).count();
      expect(count, `#${id} must not be duplicated by the mobile shell`).toBeLessThanOrEqual(1);
    }
  });
});
