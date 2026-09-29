import { expect, test, type Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

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
 * `clickToolButton` looks for a sidebar tile, but a tile only exists for a group's PRIMARY
 * tool: `transform` is the second member of `[Colors, Levels, Transform]`
 * (`toolbar-mapping.ts`), so it lives in a flyout until the rail is switched to two columns
 * — and the two-column toggle is hidden in the tablet band. The header menu lists every
 * tool, and the header is visible at every width this spec uses.
 */
async function selectToolFromMenu(page: Page, label: string) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
}
const railWidth = async (page: Page) => await leftRail(page).evaluate((el) => el.getBoundingClientRect().width);

test.describe('Left tool rail reachability', () => {
  // The rail's content is a fixed height per layout and the available height is
  // `viewportHeight - 137` — the shell's three `auto` grid rows — so it overflows below a
  // threshold rather than never, and two of the overflowing sizes are ordinary iPads rather
  // than only very short desktop windows. The numbers, and the font metrics they depend on,
  // are recorded once in the header of `e2e/no-document-overflow.spec.ts`.
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

  test('the last tool group in the rail is reachable at a short window height', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, SHORT_DESKTOP);

    // The Text tool sits well down the rail; at 600px it is below the fold.
    const textTool = page.getByTestId('tool-button-text');
    await textTool.scrollIntoViewIfNeeded();
    await expect(textTool).toBeVisible();

    const box = await textTool.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(SHORT_DESKTOP.height);
    await textTool.click({ timeout: 5_000 });
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
    expect(await railWidth(page)).toBeCloseTo(56, 0);
    await expect(page.getByTestId('toolbar-layout-toggle')).toBeHidden();
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
  for (const label of ['Shape', 'Horizontal Type Tool']) {
    test(`makes the ${label} option panel horizontally scrollable rather than unreachable`, async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await open(page, TABLET);

      await selectToolFromMenu(page, label);
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

  test('keeps the layout toggle and the user two-column rail', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    const toggle = page.getByTestId('toolbar-layout-toggle');
    await expect(toggle).toBeVisible();

    // Driven both ways from the default two columns, so a toggle whose handler did nothing
    // fails here: only the clicks can reach the one-column rail and come back.
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await railWidth(page), 'two columns is 6.75rem').toBeCloseTo(108, 0);

    await toggle.click();
    await expect(toggle, 'the toggle must reach the one-column rail').toHaveAttribute('aria-pressed', 'true');
    expect(await railWidth(page), 'one column is 3.5rem').toBeCloseTo(56, 0);

    await toggle.click();
    await expect(toggle, 'the toggle must reach the two-column rail again').toHaveAttribute('aria-pressed', 'false');
    expect(await railWidth(page), 'two columns is 6.75rem').toBeCloseTo(108, 0);
  });

  test('keeps the option row unscrollable, so popovers are never clipped', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, DESKTOP);

    await selectToolFromMenu(page, 'Transform');
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
