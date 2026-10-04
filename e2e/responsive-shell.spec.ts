import { expect, test, type Page } from './fixtures/extended-test';
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
 * `overflow: hidden` made the bottom of the left tool rail unreachable with no scrollbar.
 * Neither showed up in `npm run test`, and no spec opened the dropdown.
 */

const DESKTOP = { width: 1280, height: 800 };
/**
 * A short desktop window: 600px, which is not a device size and does not need to be one.
 *
 * It is the height the rail's reachability has to be proven at because it is where the
 * three-dots tile stops being the exception. At 1280 wide the budget is the whole tools slot —
 * 528px at an 800px window, which keeps nine of the fifteen tool tiles, and 328px here, which
 * keeps five — so by 600 the tile holds the other TEN groups, the Type group among them.
 * The rail and the tile are both on screen at 800 too; at 600 the tile is where most of the
 * rail went, and that is the state the tests below are about.
 */
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
 * Selects the transform tool through `Edit ▸ Free Transform`.
 *
 * `header-edit-menu-button` opens the menu and `Free Transform` is the item in it. Its options
 * bar is the subject of the test that calls this, so the same reason it lives on a header
 * command rather than a rail tile — the panel is not a Tools-panel surface — is why this is not
 * `clickToolButton`.
 */
async function selectFreeTransform(page: Page) {
  await page.getByTestId('header-edit-menu-button').click();
  await page.getByTestId('edit-menu-free-transform-button').click();
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
  // The rail does NOT simply overflow when its tools are taller than the window: the fit
  // collapses the rows that do not fit into the three-dots tile, so it stays within its row at
  // every height a person can reach, and the heights at which even that is impossible are
  // DISCOVERED by a descend-and-bisect search in `e2e/no-document-overflow.spec.ts` rather than
  // named here — a number for them moves every time the rail's chrome changes height, or every
  // time the fit's budget does, which is what happened when the budget stopped reserving a
  // fifth of the slot. There are two of those bands, not one: the height at which the fit gives
  // up on every tool row, and the lower one at which the slot itself has to scroll. The content
  // heights and the font metrics they depend on are recorded once in that file's header.
  //
  // `overflow-y-auto` is what bounds the grid row: a `1fr` track is `minmax(auto, 1fr)`,
  // and a scroll container's automatic minimum size is already zero, so the rail no longer
  // dictates the row's height. The page itself is pinned to be exactly viewport-sized at
  // every size in that spec's matrix.
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
   * contract any more: at 600px the rail keeps five of its fifteen tool tiles and the Type
   * group — the fourteenth — is one of the ten the fit folds into the three-dots tile, and
   * the version of this test that waited for that tile spent 60 seconds waiting for a button
   * that was never coming. What the layout guarantees instead is a PARTITION — every group is
   * either a visible tile or offered by the three-dots flyout, never both and never neither —
   * so that is what is asserted, in both directions.
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
    // onto the tiles that exist at this height instead of onto one that no longer does. There
    // are five of them here — the first five groups, through the Eyedropper — and the count is
    // not asserted: a budget or tile change moves it, and a loop over whatever the rail kept is
    // the claim that survives that.
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

    // And the tile is not decoration at this height: ten of the fifteen groups are in it.
    const overflowTile = page.getByTestId('tool-overflow-tile');
    await expect(overflowTile, 'a 600px window must fold ten of fifteen groups into the three-dots tile').toBeVisible();
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

    // And the folded tools are not merely listed: the top of the menu is on screen, the far end
    // of the list is reachable inside the menu, and picking from it works. That is the whole of
    // what the old tile-based test proved about the bottom of the rail, carried onto the element
    // that is at the bottom of the rail now.
    //
    // **THE MENU IS A SCROLL CONTAINER, NOT A CLIPPED ONE**, and that is the claim the rest of
    // this block earns. At 600px the ten folded groups are 29 items at a 24.5px pitch — the row
    // height `SidebarLeft.tsx:828` documents for every flyout — so the overlay opens at y=8, clamps
    // itself to `max-height: 584px` and scrolls its own overflow, and the last item ends at
    // y≈721, well off a 600px window, and is reached by scrolling the menu rather than
    // being lost. It used to be described here as 34 items standing 1374px tall with nothing to
    // scroll, which was stale twice over: the ten folded groups are 29 tools (a four-tile rail
    // would have made it 30, so 34 was never either), and the height belonged to an overlay that
    // was never clamped. That description named the far end of the list a defect in the app, and
    // on the measured behaviour it is not one — which is why it is worth pinning, not repeating.
    //
    // The PICK below is still made from the first item, deliberately. It is the item this test
    // has already proven to be on screen, and "a pick from the menu works" is the claim; the far
    // end's reachability is the containment check's, and is asserted as a measurement rather
    // than by clicking down there.
    const firstItem = menu.locator('[data-testid^="tool-flyout-item-"]').first();
    const firstBox = await firstItem.boundingBox();
    expect(firstBox, 'the first three-dots item must have a box').not.toBeNull();
    expect(firstBox!.y, 'the top of the three-dots menu must be on screen').toBeGreaterThanOrEqual(0);
    expect(firstBox!.y + firstBox!.height, 'the first three-dots item must fit in the window').toBeLessThanOrEqual(
      SHORT_DESKTOP.height
    );

    // The same shape as the slot's containment check in `e2e/no-document-overflow.spec.ts`, and
    // for the same reason: `scrollIntoViewIfNeeded` would be the STIMULUS and not the evidence,
    // so the scroll is driven and the scroll position read back, and the item's rect is compared
    // against the menu's CLIENT box — the client box so the comparison survives a runner that
    // draws classic scrollbars, which is the runner that file exists for.
    const lastItemGeometry = () =>
      menu.evaluate((el) => {
        const items = [...el.querySelectorAll<HTMLElement>('[data-testid^="tool-flyout-item-"]')];
        const item = items[items.length - 1];
        if (!item) return null;
        const box = el.getBoundingClientRect();
        const itemBox = item.getBoundingClientRect();
        return {
          scrollTop: el.scrollTop,
          clientTop: box.top + el.clientTop,
          clientBottom: box.top + el.clientTop + el.clientHeight,
          itemTop: itemBox.top,
          itemBottom: itemBox.bottom,
        };
      });

    // Non-vacuity for the containment check: the last item has to hang below the menu's own
    // scrollport before anything scrolls, or the check below is true on the way in and proves
    // nothing about the menu being able to reach it.
    const unscrolled = await lastItemGeometry();
    expect(unscrolled, 'the three-dots menu must have a last item to be measured at all').not.toBeNull();
    expect(
      unscrolled!.itemBottom,
      'the last three-dots item must hang below the menu before anything scrolls, or the containment check below is true on the way in'
    ).toBeGreaterThan(unscrolled!.clientBottom);

    await menu.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    const scrolled = await lastItemGeometry();
    expect(
      scrolled!.scrollTop,
      'and the MENU must be what moved it, or the item only came into view because the call put it there'
    ).toBeGreaterThan(unscrolled!.scrollTop);
    expect(
      scrolled!.itemTop,
      'the last of the folded tools must land inside the menu own vertical scrollport, not merely on screen somewhere'
    ).toBeGreaterThanOrEqual(scrolled!.clientTop);
    expect(
      scrolled!.itemBottom,
      'and inside it at the bottom, or the menu is clipping the far end of its own list'
    ).toBeLessThanOrEqual(scrolled!.clientBottom);
    expect(
      scrolled!.clientTop,
      'and the menu must still be on screen at its far end, or scrolling it reached the item by leaving the window'
    ).toBeGreaterThanOrEqual(0);

    await firstItem.click();
    await expect(page.getByTestId('tool-flyout-overflow'), 'a pick closes the menu').toHaveCount(0);
  });
});

test.describe('No global scroll lock', () => {
  test('the shell does not lock document scrolling', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    // A global `overflow` on html/body/#root that does not scroll converts every
    // overflowing region in the app into unreachable content. The grid's items own their
    // scrolling instead. Allowlist rather than a denylist of `hidden`, because `clip`
    // reaches the same permanently-unreachable state and only declines to offer a
    // scrollbar — the grid items that own scrolling are `auto`, which is on the list.
    //
    // The two LONGSHANDS, not the `overflow` shorthand: the shorthand serializes BOTH of
    // them, so `overflow-x: hidden; overflow-y: visible` comes back as the two-token
    // string `"hidden auto"`. That string is in no allowlist, so the test would go red on a
    // document that scrolls vertically perfectly well — and the message would then name
    // the horizontal lock on an element whose only fault is the one axis. Reading them
    // separately says which axis is locked and nothing more.
    //
    // `scroll` is deliberately NOT on the list: it is a global lock too, in the form this
    // pin exists to catch — a scrollbar on the document at every width, whether or not
    // anything overflows. `overlay` cannot appear at all: Chrome computes it to `auto`.
    const mayOwnScrolling = ['visible', 'auto'];
    for (const selector of ['html', 'body', '#root']) {
      const overflow = await page
        .locator(selector)
        .first()
        .evaluate((el) => ({ x: getComputedStyle(el).overflowX, y: getComputedStyle(el).overflowY }));
      expect(
        mayOwnScrolling.includes(overflow.x),
        `${selector} must not lock horizontal document scrolling, and overflow-x is "${overflow.x}"`
      ).toBe(true);
      expect(
        mayOwnScrolling.includes(overflow.y),
        `${selector} must not lock vertical document scrolling, and overflow-y is "${overflow.y}"`
      ).toBe(true);
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
  // The Type tool is selected through the RAIL rather than from a header menu, because at these
  // heights the Type group — the fourteenth of fifteen — is one of the groups the fit folds into
  // the three-dots tile: an 800px window keeps nine tiles, a 400px window keeps one, and neither
  // reaches the fifteenth. `clickToolButton` follows that fold rather than needing a second
  // route around it, which is also what Photoshop offers: the Tools panel and its overflow, and
  // nothing else. And because what is under test here is the OPTION ROW's overflow, not the
  // rail. A popover that cannot be opened is not a popover that is not clipped.
  test('the text tool font list opens fully and every font is clickable', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    await clickToolButton(page, 'text');
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

    await clickToolButton(page, 'text');
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
  // `{ name, label }` because `clickToolButton` is addressed by the tool's NAME while the panels
  // and the test titles are named by the LABEL, and the two vocabularies do not agree: the rail
  // calls the Type tool `Horizontal Type Tool` and the registry calls it `text`.
  for (const { name, label } of [
    { name: 'shape', label: 'Shape' },
    { name: 'text', label: 'Horizontal Type Tool' },
  ]) {
    test(`makes the ${label} option panel horizontally scrollable rather than unreachable`, async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await open(page, TABLET);

      await clickToolButton(page, name);
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

    await selectFreeTransform(page);
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

    // The node is held here, not in the DOM: a marker attribute is re-stamped on whatever
    // the selector resolves to next, so a canvas destroyed and rebuilt reads the same.
    // `elementHandle()` THROWS rather than returning null — on no match it waits out the
    // timeout, and on several it raises a strict-mode violation. Its throw is the
    // diagnosis, so there is nothing here for a null check to add.
    const canvas = await getWorkspaceCanvas(page).elementHandle();

    for (const size of [{ width: 500, height: 800 }, TABLET, DESKTOP]) {
      await page.setViewportSize(size);
      expect(await canvas!.evaluate((el) => el.isConnected), `canvas must survive ${size.width}px`).toBe(true);
      const current = await getWorkspaceCanvas(page).elementHandle();
      expect(
        await canvas!.evaluate((el, node) => el === node, current),
        `the canvas at ${size.width}px must be the same node, not a rebuilt one`
      ).toBe(true);
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

    // The Type tool, and it is load-bearing rather than incidental: the panel at risk is the
    // ACTIVE tool's panel, and the app boots on Draw (`DEFAULT_TOOL`), whose ids are
    // `pen-type`/`size-slider`. With Draw selected, every id below counted ZERO — the sheet was
    // duplicating a panel nobody was naming — and `toBeLessThanOrEqual(1)` accepts zero, so the
    // whole assertion was passing vacuously. Selecting Type puts the two ids that DO belong to
    // the active panel in the document, which is what makes the count below a measurement.
    //
    // Selected at the DESKTOP width and then narrowed back, because both the desktop header
    // and the rail are `max-md:hidden`: at MOBILE there is no tile to click, and the header's
    // `Tools` menu — which used to be the other way in — is gone, since Photoshop reaches its
    // tool set through the Tools panel rather than a menu. The tool selection is state, not
    // layout, so it survives the crossing in both directions — which is the property the
    // crossing is supposed to preserve.
    await page.setViewportSize(DESKTOP);
    await clickToolButton(page, 'text');
    await expect(page.locator('#font-family-select'), 'the desktop toolbar owns the Type panel').toHaveCount(1);

    await page.setViewportSize(MOBILE);
    await page.getByRole('button', { name: 'Tool options' }).click();
    await expect(page.locator('#mobile-tool-options')).toBeVisible();
    // The duplication itself, asserted while it is still true. `MobileToolSheet` renders the
    // active tool's real `ToolComponent` alongside `ToolbarHorizontal`'s, so this is two live
    // instances — and saying so makes the post-resize count a claim about a state that existed
    // rather than a number that was always zero.
    await expect(page.locator('#font-family-select'), 'the open sheet renders a second copy').toHaveCount(2);

    await page.setViewportSize(DESKTOP);
    // The desktop toolbar now owns the panel; a duplicate would make every id in it
    // ambiguous, and `getElementById` and `<label for>` both resolve to the first match.
    //
    // `font-size-input` replaced `text-input`, which the Type bar no longer renders at all: the
    // tool has no text field, the draft is typed into a `div[contenteditable]` on the canvas that
    // does not exist until a placement, and the old id would have counted zero exactly like
    // `blur-slider` and `rotate-slider` do — a second vacuous entry rather than a check. The
    // font-size field is always mounted on the Type bar with or without a draft, which is what
    // this test needs: a control that cannot be narrowed to "exists only once you have typed".
    // `blur-slider` and `rotate-slider` are Blur's and Transform's and are kept as the
    // cross-bar sample they were — neither is mounted under Type, so neither is what the claim
    // rests on.
    const ids = ['font-size-input', 'font-family-select', 'blur-slider', 'rotate-slider'];
    for (const id of ids) {
      // POLLED, not read once. `AppContainer` closes the mobile surfaces by adjusting state during
      // render off a media-query change, so the duplicate survives until that change is delivered;
      // a bare `count()` immediately after `setViewportSize` raced it and saw two. Polling keeps the
      // assertion identical — still "at most one" — and waits for the state the claim is about
      // instead of for the resize.
      await expect
        .poll(async () => page.locator(`#${id}`).count(), {
          message: `#${id} must not be duplicated by the mobile shell`,
        })
        .toBeLessThanOrEqual(1);
    }
    // The two Type ids are in the document, so the bound above is a bound rather than a
    // tautology: a resize that unmounted the panel entirely would have been caught by `toBe(1)`.
    await expect(page.locator('#font-family-select'), 'the panel survived the crossing').toHaveCount(1);
    await expect(page.locator('#font-size-input'), 'the panel survived the crossing').toHaveCount(1);
  });
});
