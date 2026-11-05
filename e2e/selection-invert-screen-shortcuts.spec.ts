import { expect, type Page, test } from './fixtures/extended-test';
import { getSelectionBounds, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { sampleDocumentPoint } from './helpers/document-sampling';
import { hasNoCommittedAnts, waitForCommittedAnts } from './helpers/selection-ants';
import { openToolFlyoutViaRightClick, selectFromFlyout, verifyPrimaryTool } from './helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * `Ctrl+A`, `Ctrl+D`, `Ctrl+I`, `Tab` and `F` through the real keyboard layer.
 *
 * Control rather than `Meta`, for the reason `keyboard-shortcuts.spec.ts` gives: `mod` matches
 * either, and a headless Chrome on macOS may swallow a `Meta` chord before the page sees it.
 *
 * Invert refuses the bedrock layer, so the fixture is `Ctrl+A` then `Ctrl+J`: a full-document
 * copy of the white backing image on a layer of its own, which Invert turns black.
 */
const MOD = 'Control';

/** Well inside the 800x600 document, so the sample never reaches the letterbox. */
const SAMPLE_X = 400;
const SAMPLE_Y = 300;

async function expectDocumentLevel(page: Page, level: number, message: string) {
  await expect
    .poll(
      async () => {
        const colour = await sampleDocumentPoint(page, SAMPLE_X, SAMPLE_Y);
        return colour ? [colour.red, colour.green, colour.blue] : null;
      },
      { message }
    )
    .toEqual([level, level, level]);
}

test.describe('Selection, Invert and screen-mode shortcuts', () => {
  test.describe.configure({ timeout: DEFAULT_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('Ctrl+A selects the document, Ctrl+I inverts the active layer, Ctrl+Z restores it, Ctrl+D deselects', async ({
    page,
  }) => {
    // The ants are drawn only while a selection tool is active (`Main.tsx` — `selectionToolActive`),
    // and the default tool is not one, so the Rectangular Marquee is picked first to make the
    // selection observable.
    await page.keyboard.press('m');
    await page.keyboard.press(`${MOD}+a`);
    await waitForCommittedAnts(page, 'Ctrl+A commits a selection around the whole document');

    await page.keyboard.press(`${MOD}+j`);
    await expect(page.getByTestId('layer-row'), 'Ctrl+J copies the selection to a new layer').toHaveCount(2);
    await expectDocumentLevel(page, 255, 'the copied layer is the white backing image');

    await page.keyboard.press(`${MOD}+i`);
    await expectDocumentLevel(page, 0, 'Ctrl+I inverts the white layer to black');

    await page.keyboard.press(`${MOD}+z`);
    await expectDocumentLevel(page, 255, 'Ctrl+Z undoes the inversion as one step');

    await page.keyboard.press(`${MOD}+d`);
    await expect.poll(() => hasNoCommittedAnts(page), { message: 'Ctrl+D clears the selection' }).toBe(true);
  });

  test('Tab hides and restores the toolbar, options bar and panels, keeping the menu and status bar', async ({
    page,
  }) => {
    const toolbar = page.getByTestId('left-sidebar');
    const options = page.locator('[data-chrome="options"]');
    const panels = page.locator('#right-panel');
    const header = page.locator('[data-chrome="header"]');
    const footer = page.locator('[data-chrome="footer"]');

    await page.keyboard.press('Tab');
    await expect(toolbar).toBeHidden();
    await expect(options).toBeHidden();
    await expect(panels).toBeHidden();
    await expect(header).toBeVisible();
    await expect(footer).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(toolbar).toBeVisible();
    await expect(options).toBeVisible();
    await expect(panels).toBeVisible();
  });

  test('Tab still toggles the panels after a click on the Hand tool surface', async ({ page }) => {
    await page.keyboard.press('h');
    const surface = page.getByTestId('hand-tool-area');
    const box = await surface.boundingBox();
    if (!box) throw new Error('the Hand tool surface has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await page.keyboard.press('Tab');
    await expect(page.getByTestId('left-sidebar')).toBeHidden();
  });

  test('F twice reaches Full Screen, which hides every region, and a third F restores them', async ({ page }) => {
    const regions = ['header', 'options', 'tools', 'panels', 'footer'].map((name) =>
      page.locator(`[data-chrome="${name}"]`)
    );

    await page.keyboard.press('f');
    await page.keyboard.press('f');
    for (const region of regions) await expect(region).toBeHidden();
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    await page.keyboard.press('f');
    for (const region of regions) await expect(region).toBeVisible();
  });

  test('F enters Full Screen Mode With Menu Bar, which hides only the status bar, and Shift+F returns', async ({
    page,
  }) => {
    const footer = page.locator('[data-chrome="footer"]');

    await page.keyboard.press('f');
    await expect(footer).toBeHidden();
    await expect(page.getByTestId('left-sidebar')).toBeVisible();
    await expect(page.locator('[data-chrome="header"]')).toBeVisible();

    await page.keyboard.press('Shift+F');
    await expect(footer).toBeVisible();
  });

  test('Escape cancels a polygonal lasso draft before leaving Full Screen', async ({ page }) => {
    await openToolFlyoutViaRightClick(page, 'freehand-lasso');
    await selectFromFlyout(page, { toolName: 'polygonal-lasso', label: 'Polygonal Lasso Tool' });
    await verifyPrimaryTool(page, 'polygonal-lasso', 'Polygonal Lasso Tool');

    await page.keyboard.press('f');
    await page.keyboard.press('f');

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('the workspace canvas has no box');
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    const points = [
      { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 },
      { x: box.x + box.width * 0.6, y: box.y + box.height * 0.36 },
      { x: box.x + box.width * 0.36, y: box.y + box.height * 0.64 },
    ];
    for (const point of points) await page.mouse.click(point.x, point.y);

    const readDraft = async () => getSelectionBounds(await page.screenshot({ clip }));
    await expect.poll(readDraft, { message: 'the polygonal lasso draft is visible' }).not.toBeNull();

    await page.keyboard.press('Escape');
    for (const name of ['header', 'options', 'tools', 'panels', 'footer']) {
      await expect(page.locator(`[data-chrome="${name}"]`)).toBeHidden();
    }
    await expect.poll(readDraft, { message: 'Escape removed the polygonal lasso draft' }).toBeNull();

    // A live three-point draft would commit on Enter. Its absence proves the first Escape
    // cancelled the tool draft while leaving Full Screen active.
    await page.keyboard.press('Enter');
    await expect.poll(() => hasNoCommittedAnts(page), { message: 'Escape left no selection to commit' }).toBe(true);

    await page.keyboard.press('Escape');
    for (const name of ['header', 'options', 'tools', 'panels', 'footer']) {
      await expect(page.locator(`[data-chrome="${name}"]`)).toBeVisible();
    }
  });
});
