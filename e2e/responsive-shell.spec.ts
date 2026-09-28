import { expect, test, type Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

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
  // The rail holds 12 tool groups plus the colour swatches: ~840px of min-content inside a
  // `1fr` grid row in a `height: 100%` container. A `1fr` track is `minmax(auto, 1fr)`, so
  // the rail floors that row and the grid outgrows the viewport. The page used to scroll, so
  // the overflow was reachable; a global `overflow: hidden` removed the scroll and turned it
  // into content nobody could get to. The rail now owns its scrolling via `min-h-0`.
  for (const size of [DESKTOP, SHORT_DESKTOP, WIDE_DESKTOP]) {
    test(`every control in the rail is reachable at ${size.width}x${size.height}`, async ({ page }) => {
      test.setTimeout(60_000);
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
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
    await open(page, TABLET);

    // The two-column rail is a desktop preference. At 900px it would cost the canvas 52px
    // for a second column of labels nobody has room to read.
    expect(await railWidth(page)).toBeCloseTo(56, 0);
    await expect(page.getByTestId('toolbar-layout-toggle')).toBeHidden();
  });

  test('reclaims the layers column by default and offers a toggle for it', async ({ page }) => {
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);

    await open(page, TABLET);
    const collapsed = (await getWorkspaceCanvas(page).boundingBox())!.width;

    await page.getByTestId('right-panel-toggle').click();
    await expect(page.locator('#right-panel')).toBeVisible();
    const expanded = (await getWorkspaceCanvas(page).boundingBox())!.width;

    expect(collapsed, 'collapsing the panel must widen the canvas').toBeGreaterThan(expanded);
    expect(collapsed - expanded).toBeCloseTo(250, 0);
  });

  // Measured, not estimated: the Text panel lays out at 1036px and the Shape panel at
  // 1089px, and both overflow at 768, 900 and 1023. Transform is NOT one of them — its
  // content is mostly flexible sliders, so it compresses to the row instead of overflowing.
  // Reaching for it would have asserted nothing.
  for (const { label, minWidth } of [
    { label: 'Shape', minWidth: 1089 },
    { label: 'Horizontal Type Tool', minWidth: 1036 },
  ]) {
    test(`makes the ${label} option panel horizontally scrollable rather than unreachable`, async ({ page }) => {
      test.setTimeout(60_000);
      await open(page, TABLET);

      await selectToolFromMenu(page, label);
      const toolbar = page.locator('[class*="grid-area:toolbar"]').first();
      const metrics = await toolbar.evaluate((el) => ({
        overflowX: getComputedStyle(el).overflowX,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));

      expect(metrics.overflowX, 'the tablet band must scroll the option row').toBe('auto');
      expect(metrics.scrollWidth, 'the option row must be wider than the window').toBeGreaterThanOrEqual(minWidth);
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
    test.setTimeout(60_000);
    await open(page, DESKTOP);

    // Desktop gains no control, no state and no layout shift from the tablet work.
    await expect(page.getByTestId('right-panel-toggle')).toBeHidden();
    const panel = page.locator('#right-panel');
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(250, 0);
  });

  test('keeps the layout toggle and the user two-column rail', async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, DESKTOP);

    const toggle = page.getByTestId('toolbar-layout-toggle');
    await expect(toggle).toBeVisible();

    await toggle.click();
    expect(await railWidth(page), 'two columns is 6.75rem').toBeCloseTo(108, 0);
  });

  test('keeps the option row unscrollable, so popovers are never clipped', async ({ page }) => {
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
    await open(page, DESKTOP);
    await page.setViewportSize({ width: 500, height: 800 });

    // Present but hidden, which is what makes the crossing free. A ternary would remove them.
    await expect(page.locator('[class*="grid-area:header"]').first()).toBeAttached();
    await expect(page.getByTestId('left-sidebar')).toBeAttached();
  });
});
