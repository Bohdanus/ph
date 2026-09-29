import { expect, test, type Page } from '@playwright/test';
import { getWorkspaceCanvas, hasDarkPixels, loadImageData, waitForCanvasPixels } from './helpers/canvas-helpers';
import {
  clickToolButton,
  openToolFlyout,
  openToolFlyoutViaKeyboard,
  selectFromFlyout,
  verifyPrimaryTool,
  openToolFlyoutViaRightClick,
  verifyHoverDoesNotOpenFlyout,
} from './helpers/toolbar-helpers';

/**
 * The box the shape test drags, in CSS pixels, centred on the canvas.
 *
 * A fixed size rather than a fraction of the canvas, because the app contains the document
 * in the viewport (`usePointerPosition`'s `ContainDimensions`): the image is letterboxed and
 * centred, so the canvas centre is inside the image at every viewport size, while a
 * percentage of the canvas can reach past the image's edge on a very wide one.
 */
const SHAPE_DRAG_WIDTH = 160;
const SHAPE_DRAG_HEIGHT = 120;

/** Half-width of a square patch sampled at a point, in CSS pixels. */
const SAMPLE_HALF_SIZE = 4;

/** `SidebarLeft.tsx`'s long-press threshold; the press below waits comfortably past it. */
const LONG_PRESS_SETTLE_MS = 400;

/** `ToolTooltip.tsx`'s hover threshold, plus slack. */
const TOOLTIP_SETTLE_MS = 400;

/**
 * Long-presses a tile with REAL mouse input.
 *
 * `openToolFlyout` dispatches `pointerdown`/`pointerup` straight at the element, which
 * never goes through hit testing, so it cannot observe whether the thing that opened is
 * actually on screen. The regression these tests cover was invisible to every test that
 * used it: the flyout was laid out and in the DOM, and the canvas was painted over the
 * place it would have appeared.
 */
const longPressWithMouse = async (page: Page, toolName: string): Promise<void> => {
  const button = page.getByTestId(`tool-button-${toolName}`);
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  if (!box) throw new Error(`longPressWithMouse: no box for tool-button-${toolName}`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
  await page.mouse.up();
  // Move off the tile so the hover tooltip goes away before anything is probed. Both
  // overlays are portalled next to the same anchor, and hovering the tile starts the
  // tooltip's 250ms timer before the 300ms press opens the flyout, so the tooltip is on
  // screen for most of the time a flyout is. The tooltip is `pointer-events-none`, so it
  // cannot now intercept a click — but a test that leaves it there is reading the
  // geometry of two overlapping overlays when it means to read one.
  await page.mouse.move(0, 0);
};

/**
 * Reads the geometry of every flyout item in one round trip, because the two failures
 * worth distinguishing are different: an item can be inside the viewport and still not be
 * painted (clipped by an ancestor), or it can be laid out off the bottom of the screen
 * (anchored to a tile near the end of a long rail).
 */
const readFlyoutGeometry = async (
  page: Page
): Promise<{ itemCount: number; offscreen: string[]; unpainted: string[] }> =>
  page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    if (!menu) return { itemCount: 0, offscreen: [], unpainted: [] };

    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    const offscreen: string[] = [];
    const unpainted: string[] = [];

    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const label = item.getAttribute('aria-label') ?? item.textContent ?? 'unknown';

      if (rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
        offscreen.push(
          `${label} (${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)})`
        );
      }

      // `elementFromPoint` resolves through clipping: it returns whatever is actually
      // painted at that coordinate. A flyout clipped by the rail's scroll container
      // resolves to the canvas underneath it, not to the item.
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!hit || (hit !== item && !item.contains(hit))) {
        unpainted.push(`${label} (hit ${hit?.tagName ?? 'nothing'})`);
      }
    }

    return { itemCount: items.length, offscreen, unpainted };
  });

const readTooltipGeometry = async (
  page: Page
): Promise<{ missing: boolean; offscreen: boolean; unpainted: boolean; text: string }> =>
  page.evaluate(() => {
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    // Reported separately from the geometry: a tooltip that never appeared is a different
    // failure from one that appeared in the wrong place, and folding the two into
    // "offscreen" reports the first as the second.
    if (!tooltip) return { missing: true, offscreen: false, unpainted: false, text: '' };

    const rect = tooltip.getBoundingClientRect();

    // The tooltip is `pointer-events-none`, so it is skipped by hit testing even when it
    // is painted, and `elementFromPoint` would always report whatever is beneath it. The
    // element has to be made hit-testable for the probe to mean anything.
    const previous = tooltip.style.pointerEvents;
    tooltip.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    tooltip.style.pointerEvents = previous;

    return {
      missing: false,
      offscreen: rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight,
      unpainted: !hit || (hit !== tooltip && !tooltip.contains(hit)),
      text: tooltip.textContent ?? '',
    };
  });

/** Fails with the names of the offending items rather than a bare `offscreen: [...]`. */
const expectEveryItemPainted = (geometry: Awaited<ReturnType<typeof readFlyoutGeometry>>): void => {
  expect(geometry.itemCount).toBeGreaterThan(0);
  expect(geometry.offscreen, 'flyout items laid out outside the viewport').toEqual([]);
  expect(geometry.unpainted, 'flyout items whose centre is not painted (clipped by an ancestor)').toEqual([]);
};

test.describe('SidebarLeft - Flyout Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  test('long-press opens flyout for grouped tools', async ({ page }) => {
    // Brush tool is in a group (brush, pencil, color-replacement)
    await openToolFlyout(page, 'brush');

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    await expect(flyout).toContainText('Brush Tool');
    await expect(flyout).toContainText('Pencil Tool');
    await expect(flyout).toContainText('Color Replacement Tool');
  });

  test('short click selects primary tool without opening flyout', async ({ page }) => {
    await clickToolButton(page, 'brush');

    // Flyout should not be visible
    await expect(page.getByRole('menu')).toBeHidden();

    // Verify primary tool is still brush
    await verifyPrimaryTool(page, 'brush', 'Brush Tool');
  });

  test('right-click opens flyout for grouped tools', async ({ page }) => {
    await openToolFlyoutViaRightClick(page, 'brush');

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    await expect(flyout).toContainText('Brush Tool');
  });

  test.skip('right-click does not open flyout for single-tool groups', async ({ page }) => {
    // Draw is a single tool (no group)
    // SKIPPED: Business value unclear - right-click on single-tool groups is not a user-facing feature.
    // The test checks that right-click doesn't open a flyout, but there's no requirement or user story
    // for this behavior. Introduced in dd774cd merge without clear rationale.
    // FLAKINESS: Browser native context menu interferes with right-click detection.
    // Right-click events are consumed by browser before reaching app logic in some environments.
    // This makes the test unreliable across CI/browser configurations.
    // Re-enable if a specific UX requirement for right-click handling on single tools emerges.
    const drawButton = page.getByTestId('tool-button-draw');
    await expect(drawButton).toBeVisible();

    await drawButton.click({ button: 'right' });

    // Flyout should not appear
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('hover does not open flyout', async ({ page }) => {
    await verifyHoverDoesNotOpenFlyout(page, 'brush');
  });

  test('selecting from flyout updates primary tool', async ({ page }) => {
    // Open brush flyout and select Pencil
    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'pencil', label: 'Pencil Tool' });

    // Verify primary tool is now Pencil
    await verifyPrimaryTool(page, 'pencil', 'Pencil Tool');

    // Clicking the button should select pencil again
    await clickToolButton(page, 'pencil');
    await verifyPrimaryTool(page, 'pencil', 'Pencil Tool');
  });

  test('selecting shape from flyout updates primary and patches figure', async ({ page }) => {
    // Open shape flyout (grouped under 'shape' tool)
    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Ellipse Tool' });

    // Verify primary tool shows Ellipse
    await verifyPrimaryTool(page, 'shape', 'Ellipse Tool');

    // Half of the claim is the figure, not the tile: `selectTool` calls
    // `patchToolArgs('shape', { figure })` as well as switching tools. The Shape options panel
    // prints the figure it was handed, so a patch that never landed shows up here as
    // "Rectangle Tool" - the default in `defaultSettings` - instead of "Ellipse Tool".
    await expect(page.getByLabel('Current shape')).toContainText('Ellipse Tool');

    // And the figure creator path, which is what the patch exists for: drag a box and look
    // at what the app commits. A shape is an outline by default, so a rectangle paints the
    // corners of the drag box and an oval curves away from them - the corner of the box sits
    // ~24px clear of the oval's stroke for this drag size, against dead on the rectangle's.
    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    const left = box.x + box.width / 2 - SHAPE_DRAG_WIDTH / 2;
    const top = box.y + box.height / 2 - SHAPE_DRAG_HEIGHT / 2;
    const right = left + SHAPE_DRAG_WIDTH;
    const bottom = top + SHAPE_DRAG_HEIGHT;
    const patch = (centreX: number, centreY: number) => ({
      x: centreX - SAMPLE_HALF_SIZE,
      y: centreY - SAMPLE_HALF_SIZE,
      width: SAMPLE_HALF_SIZE * 2,
      height: SAMPLE_HALF_SIZE * 2,
    });

    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();

    // Positive control first: the midpoint of the bottom edge is the one point an ellipse
    // inscribed in the drag box is guaranteed to touch, so a shape really was committed
    // there. Without it the corner assertions below would also pass on a canvas nothing was
    // ever drawn on.
    await waitForCanvasPixels(page, patch((left + right) / 2, bottom), hasDarkPixels, {
      description: 'the shape outline',
    });

    for (const [label, cornerX, cornerY] of [
      ['top left', left, top],
      ['top right', right, top],
      ['bottom left', left, bottom],
      ['bottom right', right, bottom],
    ] as const) {
      const corner = await loadImageData(await page.screenshot({ clip: patch(cornerX, cornerY) }));
      // `page.screenshot` truncates a clip at the viewport edge SILENTLY and returns a
      // shorter image. This app lays the canvas out taller than the 720px default viewport,
      // so a sample point that drifts past the fold would decode to a small or empty strip -
      // which reads as "no dark pixels here" and turns this negative assertion into a false
      // pass. The size is therefore asserted before the pixels are read.
      expect(`${corner.width}x${corner.height}`, `shape ${label} corner capture, clipped at the viewport edge`).toBe(
        `${SAMPLE_HALF_SIZE * 2}x${SAMPLE_HALF_SIZE * 2}`
      );
      expect(await hasDarkPixels(corner), `shape ${label} corner`).toBe(false);
    }
  });

  test('flyout closes on outside click', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    // Click on body (outside flyout)
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('flyout closes on Escape key', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('flyout closes when clicking active grouped tile again', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    // Click the brush button again
    await clickToolButton(page, 'brush');

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('long-press on different grouped tile switches flyout', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu', { name: 'Brush Tool tools' })).toBeVisible();

    // Long-press on shape tool
    await openToolFlyout(page, 'shape');

    // Brush flyout should be closed, shape flyout open
    await expect(page.getByRole('menu', { name: 'Brush Tool tools' })).toBeHidden();
    await expect(page.getByRole('menu', { name: 'Shape tools' })).toBeVisible();
  });

  test('all lasso tools present in flyout', async ({ page }) => {
    await openToolFlyout(page, 'freehand-lasso');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Lasso Tool');
    await expect(flyout).toContainText('Polygonal Lasso Tool');
    await expect(flyout).toContainText('Magnetic Lasso Tool');
  });

  test('all pen tools present in flyout', async ({ page }) => {
    await openToolFlyout(page, 'pen');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Pen Tool');
    await expect(flyout).toContainText('Freeform Pen Tool');
    await expect(flyout).toContainText('Curvature Pen Tool');
    await expect(flyout).toContainText('Add Anchor Point Tool');
    await expect(flyout).toContainText('Delete Anchor Point Tool');
    await expect(flyout).toContainText('Convert Point Tool');
  });

  test('all colors tools present in flyout', async ({ page }) => {
    await openToolFlyout(page, 'color');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Colors');
    await expect(flyout).toContainText('Levels');
    await expect(flyout).toContainText('Transform');
  });

  test('pending long-press cancels on pointer leave', async ({ page }) => {
    const brushButton = page.getByTestId('tool-button-brush');
    await expect(brushButton).toBeVisible();

    await brushButton.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0); // Move away
    await page.mouse.up();

    await expect(page.getByRole('menu')).toBeHidden();

    // Control, and the reason the negative assertion above is worth anything: the same
    // long-press must still open a flyout. It used to sleep 400ms first and hope that was
    // longer than the app's delay, which is a vacuous pass the moment the delay is raised -
    // the assertion would then be taken before the cancelled timer could ever have fired.
    // `openToolFlyout` polls for the menu instead, so a broken long-press fails here rather
    // than passing as "the flyout stayed closed".
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  // The rail is `overflow-y-auto`, which makes it clip horizontally as well, so the flyout
  // and the tooltip used to be laid out outside it and painted nowhere. `toBeVisible()`
  // cannot see that — it only checks for a non-empty box — which is why every assertion
  // below goes through `elementFromPoint`.
  test('a long-pressed flyout is painted, not clipped by the rail', async ({ page }) => {
    await longPressWithMouse(page, 'brush');

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    expectEveryItemPainted(await readFlyoutGeometry(page));
  });

  test('a long-pressed flyout is anchored so the whole menu fits on screen', async ({ page }) => {
    // `shape` is the last group in the two-column default, and its six-item menu is 254px:
    // anchored to the tile's top edge it would run to 761 in a 720px window. Nothing else
    // in the default layout comes near the fold, which is why this is the group to probe —
    // `brush`, the group the other tests use, sits mid-rail and would pass with or without
    // the vertical clamp.
    await longPressWithMouse(page, 'shape');

    await expect(page.getByRole('menu')).toBeVisible();
    const geometry = await readFlyoutGeometry(page);
    expect(geometry.itemCount).toBeGreaterThan(1);
    expect(geometry.offscreen, 'flyout items laid out outside the viewport').toEqual([]);
    expect(geometry.unpainted, 'flyout items whose centre is not painted (clipped by an ancestor)').toEqual([]);
  });

  test('clicking the menu itself keeps it open, though the menu is no longer inside the tile', async ({ page }) => {
    // The flyout is portalled, so the outside-click handler can no longer ask
    // `group.contains(target)`: a click on the menu's own padding reads as a click on an
    // element outside the tile, and the menu would close under the pointer. It matches
    // `data-toolbar-flyout` instead, which is what this pins.
    await longPressWithMouse(page, 'shape');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    if (!box) throw new Error('no box for the flyout');

    // `p-1.5` of padding inside the menu's border, which is not inside any item.
    await page.mouse.click(box.x + 2, box.y + 2);

    await expect(menu).toBeVisible();
  });

  test('a right-clicked flyout is painted too', async ({ page }) => {
    await openToolFlyoutViaRightClick(page, 'brush');

    await expect(page.getByRole('menu')).toBeVisible();
    expectEveryItemPainted(await readFlyoutGeometry(page));
  });

  test('a right-clicked flyout still takes clicks once the hover tooltip has appeared', async ({ page }) => {
    // A right-click opens the flyout at once and the hover tooltip 250ms later, so the
    // tooltip is the overlay portalled last. When the portal wrapper was a hit target, its
    // shrink-wrapped box sat over the first flyout item, `locator.click()` timed out on it,
    // and the outside-click handler read the click as outside the group — the menu closed
    // with nothing selected.
    await openToolFlyoutViaRightClick(page, 'shape');
    await page.getByTestId('tool-button-shape').hover();
    // Well past `ToolTooltip`'s 250ms threshold, so the tooltip is definitely on screen.
    await page.waitForTimeout(600);
    await expect(page.getByRole('tooltip')).toBeVisible();

    await page.getByTestId('tool-flyout-item-shape-ellipse-tool').click();

    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.getByTestId('tool-button-shape')).toHaveAttribute('aria-label', 'Ellipse Tool');
  });

  test('Tab closes an open flyout, with focus on the tile or inside the menu', async ({ page }) => {
    const brushButton = page.getByTestId('tool-button-brush');
    await expect(brushButton).toBeVisible();

    // Focus is set explicitly rather than left to the browser as a side effect of
    // mousedown: this test is about what Tab does from each of the two places focus can
    // be, so it has to be in one of them rather than usually in one of them.
    await brushButton.focus();
    await longPressWithMouse(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(brushButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toBeHidden();

    // ArrowDown is what moves focus into the menu; from there Tab leaves it.
    await brushButton.press('ArrowDown');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitemradio').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('crossing the tablet boundary closes the flyout instead of reopening it', async ({ page }) => {
    // The two layouts number the same groups differently, so a stale `openGroup` matches
    // nothing at the boundary and matches again on the way back — the menu reappearing with
    // nothing the user did to open it. This is the one way the anchor can be left detached:
    // the open tile is not closed, it is unmounted.
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.setViewportSize({ width: 900, height: 720 });
    await expect(page.getByRole('menu')).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByTestId('left-sidebar')).toBeVisible();
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('crossing into mobile closes the flyout, which the rail hiding cannot do on its own', async ({ page }) => {
    // Below `md` the rail is `display: none` rather than restyled, and the portal escapes
    // that — so nothing about the menu's own placement stops it. Its anchor's box is zeroed
    // by the hiding, which the clamp turns into the viewport's top-left corner, leaving a
    // menu painted and clickable over a mobile shell with no tile under it.
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.setViewportSize({ width: 600, height: 720 });

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('Escape hands focus back to the tile that opened the menu', async ({ page }) => {
    // Opened from the KEYBOARD and with focus moved into the menu, deliberately. A long press
    // with a real mouse leaves focus on the tile already, so a test set up that way would
    // pass with or without the restore and would be measuring nothing. The menu is portalled
    // into `document.body`, so unmounting it takes the focused item with it: measured without
    // the restore, focus landed on `document.body` and the next Tab restarted at the
    // document's first tabbable — 16 tab stops before the rail.
    const brushButton = page.getByTestId('tool-button-brush');
    await expect(brushButton).toBeVisible();
    await openToolFlyoutViaKeyboard(page, 'brush');
    await expect(page.getByRole('menuitemradio').first()).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('menu')).toBeHidden();
    await expect(brushButton).toBeFocused();
  });

  test('picking an item with the mouse does not move focus back to the tile', async ({ page }) => {
    // The restore is for the KEYBOARD's close. A mouse pick has already focused the item the
    // user clicked, and taking focus back to the tile would arm ToolTooltip's 250ms focus
    // timer — so a tooltip would paint over a selection the mouse user never asked to see.
    await openToolFlyoutViaRightClick(page, 'shape');
    const item = page.getByTestId('tool-flyout-item-shape-ellipse-tool');
    await item.click();

    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.getByRole('tooltip')).toBeHidden();
    await expect(page.getByTestId('tool-button-shape')).not.toBeFocused();
  });

  test('a hovered tool tooltip is painted, not clipped by the rail', async ({ page }) => {
    const button = page.getByTestId('tool-button-brush');
    await expect(button).toBeVisible();
    const box =
      (await button.boundingBox()) ??
      (() => {
        throw new Error('no box for tool-button-brush');
      })();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(TOOLTIP_SETTLE_MS);

    const geometry = await readTooltipGeometry(page);
    expect(geometry.missing, 'no tooltip appeared within its hover threshold').toBe(false);
    expect(geometry.text).toContain('Brush Tool');
    expect(geometry.offscreen, 'tooltip laid out outside the viewport').toBe(false);
    expect(geometry.unpainted, 'tooltip is laid out but not painted (clipped by an ancestor)').toBe(false);
  });
});
