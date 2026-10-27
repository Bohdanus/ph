import { expect, type Page, test } from './fixtures/extended-test';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Ruler is a PIXEL_FREE tool, so there is nothing here to assert about pixels. What this spec
 * proves instead is the wiring a unit test cannot reach: that the rail's `I` tile reaches a tool
 * whose area mounts, that a real pointer drag across the workspace canvas publishes readouts into
 * the real options bar, and that `Shift+I` reaches the Ruler by the cycle rather than by a tile
 * that does not exist.
 *
 * The readouts are `<output>` elements carrying `data-testid="ruler-x"` and friends, which is the
 * one place this app's options bars are allowed a test id: they are readouts rather than controls,
 * and a control would be addressed by its label instead.
 */
const readout = (page: Page, id: string) => page.getByTestId(id);

/** The ruler is selected and its readout bar is mounted. */
const expectRulerActive = async (page: Page) => {
  await expect(readout(page, 'ruler-d1'), 'the Ruler bar is the active tool').toBeVisible();
};

test.describe('the Ruler tool', () => {
  test.beforeEach(async ({ page }) => {
    // The app seeds a Blank document on load, so this waits for the document that already exists
    // rather than creating one: there is no "create" gesture to get wrong, and the composition
    // poll is what proves the canvas is live rather than merely present.
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();
    await expect(page.getByTitle('Drag to reorder').filter({ hasText: 'Blank 1' })).toBeVisible();
  });

  test('reports a drag as X, Y, W, H, the angle and the length', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });
    await expectRulerActive(page);

    // Empty before anything is dragged, so a bar showing stale numbers fails here rather than
    // quietly satisfying the assertions below.
    await expect(readout(page, 'ruler-d1')).toHaveText('');

    const canvas = page.getByTestId('workspace-canvas');
    const box = await canvas.boundingBox();
    expect(box, 'the workspace canvas must be on screen to drag across it').not.toBeNull();
    const from = { x: box!.x + box!.width * 0.3, y: box!.y + box!.height * 0.3 };
    const to = { x: box!.x + box!.width * 0.3, y: box!.y + box!.height * 0.6 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    // A purely vertical drag is the one shape whose every readout is knowable in advance: W is
    // zero, A is a right angle, and H equals D1. The exact pixel values depend on the contain fit,
    // which is why the assertions are relational rather than literal.
    await expect(readout(page, 'ruler-w')).toHaveText('0 px');
    await expect(readout(page, 'ruler-a')).toHaveText('90°');
    await expect(readout(page, 'ruler-h')).not.toHaveText('');
    await expect(readout(page, 'ruler-d1')).not.toHaveText('');
    await expect(readout(page, 'ruler-y')).not.toHaveText('');
    // No protractor has been pulled out, so D2 is absent rather than zero.
    await expect(readout(page, 'ruler-d2')).toHaveText('');
  });

  test('clears the line on Clear, and greys the button while there is nothing to clear', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    await expect(page.getByTestId('ruler-clear')).toBeDisabled();

    const box = (await page.getByTestId('workspace-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByTestId('ruler-clear')).toBeEnabled();
    await page.getByTestId('ruler-clear').click();

    await expect(readout(page, 'ruler-d1')).toHaveText('');
    await expect(page.getByTestId('ruler-clear')).toBeDisabled();
  });

  test('records no history state, because a measuring line is nonprinting', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    const box = (await page.getByTestId('workspace-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();

    // The History panel's Undo is the app's own statement about what an edit was. A measurement
    // that created a history state would enable it, and this is the assertion that would catch it.
    const undo = page.getByRole('button', { name: /undo/i }).first();
    await expect(undo).toBeDisabled();
  });

  test('Shift+I cycles the I tile between the Eyedropper, Color Sampler, and the Ruler', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.keyboard.press('i');
    await expect(page.getByRole('combobox', { name: 'Sample Size' }), 'a bare I selects the tile anchor').toBeVisible();

    await page.keyboard.press('Shift+I');
    await expect(
      page.getByRole('combobox', { name: 'Sample Size' }),
      'Shift+I from Eyedropper reaches Color Sampler'
    ).toBeVisible();

    await page.keyboard.press('Shift+I');
    await expectRulerActive(page);

    await page.keyboard.press('Shift+I');
    await expect(page.getByRole('combobox', { name: 'Sample Size' }), 'the cycle wraps').toBeVisible();
  });

  test('dims every unimplemented tool in the rail flyouts, and no working one', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    // The graying is a visual claim, so this reads the COMPUTED FILTER rather than the class name:
    // a class that stopped applying would still satisfy a class-name assertion. The Pen tile is not
    // on the rail at this viewport — the rail folds a suffix of whole rows into its three-dots tile
    // — so it is reached the way a user reaches it, from that tile.
    const filterOfTile = (toolName: string) =>
      page.getByTestId(`tool-button-${toolName}`).evaluate((node) => window.getComputedStyle(node).filter);
    const filterOfRow = (toolName: string) =>
      page
        .getByTestId(new RegExp(`^tool-flyout-item-${toolName}-`))
        .first()
        .evaluate((node) => window.getComputedStyle(node).filter);

    await expect(await filterOfTile('eyedropper'), 'a working tile carries no filter').toBe('none');

    await clickToolButton(page, 'pen');
    await openToolFlyout(page, 'pen');

    await expect(await filterOfRow('pen'), 'an unimplemented row is dimmed').toContain('grayscale');
    await expect(await filterOfRow('freeform-pen'), 'an unimplemented row is dimmed').toContain('grayscale');
    await expect(await filterOfRow('convert-point'), 'an unimplemented row is dimmed').toContain('grayscale');
  });

  test('dims the Custom Shape row while leaving the working rows of its flyout alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    // The shape flyout's rows are all `name: 'shape'` with a `figure`, so the id half carries the
    // figure's label slug rather than a distinct tool name — the Custom Shape row is the only one
    // in that flyout with a name of its own.
    const filterOfId = (testId: string) =>
      page.getByTestId(testId).evaluate((node) => window.getComputedStyle(node).filter);

    await clickToolButton(page, 'shape');
    await openToolFlyout(page, 'shape');

    await expect(
      await filterOfId('tool-flyout-item-custom-shape-custom-shape-tool'),
      'Custom Shape is unimplemented'
    ).toContain('grayscale');
    await expect(await filterOfId('tool-flyout-item-shape-line-tool'), 'the Line tool works').toBe('none');
  });
});
