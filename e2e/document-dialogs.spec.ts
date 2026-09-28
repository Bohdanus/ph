import { expect, type Page, test } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';

/**
 * A4 at 300 dpi, which is the default DPI, through the arithmetic in
 * `computePixelsFromPreset`: 210mm / 25.4 * 300 = 2480.3, 297mm / 25.4 * 300 = 3507.9,
 * each rounded. The preset is stated in millimetres on purpose — it is the only branch of
 * that function with a unit conversion in it, so a wrong constant fails here rather than
 * passing as a round number.
 */
const A4_AT_300_DPI = { width: '2480', height: '3508' };

const dimensionsReadout = (page: Page) => page.locator('footer');

const fileMenu = (page: Page) => page.getByTestId('header-file-menu-button');
const newItem = (page: Page) => page.getByTestId('header-file-new-button');
const saveItem = (page: Page) => page.getByTestId('header-file-save-button');

/**
 * Opens one of the File menu's items. The menu is a toggle, so a menu left open by an
 * earlier step would make the button click CLOSE it and the item would never appear —
 * which is why the closed state is asserted rather than assumed.
 */
async function openFileItem(page: Page, item: ReturnType<typeof newItem>): Promise<void> {
  await expect(item, 'the File menu is closed before it is opened').toHaveCount(0);
  await fileMenu(page).click();
  await expect(item).toBeVisible();
  await item.click();
}

async function openNewImageDialog(page: Page): Promise<void> {
  await openFileItem(page, newItem(page));
  await expect(page.getByTestId('new-image-dialog')).toBeVisible();
}

test.describe('Document dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    // The File menu guards New and Open behind a `confirm()` whenever the document has
    // unsaved changes, which a blank document already does. One handler per test, not per
    // dialog: two handlers on one page both fire for the same dialog and the second one
    // throws "already handled".
    page.on('dialog', (dialog) => void dialog.accept());
  });

  test.describe('New Image', () => {
    test('a metric preset computes its pixel size from the DPI field', async ({ page }) => {
      await openNewImageDialog(page);

      await page.getByTestId('new-image-preset-select').selectOption('a4');
      // The DPI field only exists for a preset measured in something other than pixels,
      // which is itself part of the contract: a Custom document has no DPI to change.
      await expect(page.getByTestId('new-image-dpi-input')).toHaveValue('300');
      await expect(page.getByTestId('new-image-width-input')).toHaveValue(A4_AT_300_DPI.width);
      await expect(page.getByTestId('new-image-height-input')).toHaveValue(A4_AT_300_DPI.height);

      // Doubling the DPI must double the pixel size, or the field is decorative.
      await page.getByTestId('new-image-dpi-input').fill('600');
      await expect(page.getByTestId('new-image-width-input')).toHaveValue('4961');
      await expect(page.getByTestId('new-image-height-input')).toHaveValue('7016');
    });

    test('an imperial preset uses inches, and Custom has no DPI field at all', async ({ page }) => {
      await openNewImageDialog(page);

      await page.getByTestId('new-image-preset-select').selectOption('photo-4x6');
      await expect(page.getByTestId('new-image-width-input')).toHaveValue('1200');
      await expect(page.getByTestId('new-image-height-input')).toHaveValue('1800');

      await page.getByTestId('new-image-preset-select').selectOption('custom');
      await expect(page.getByTestId('new-image-dpi-input'), 'a pixel document has no DPI').toHaveCount(0);
      // Custom is where the fields are free, and picking a preset then editing one of them
      // has to put the dialog back on Custom rather than leave a preset label over a
      // width the preset never asked for.
      await page.getByTestId('new-image-preset-select').selectOption('a5');
      await page.getByTestId('new-image-width-input').fill('500');
      await expect(page.getByTestId('new-image-preset-select')).toHaveValue('custom');
    });

    test('a width outside the accepted range is refused by the browser, not by a message', async ({ page }) => {
      await openNewImageDialog(page);
      const width = page.getByTestId('new-image-width-input');
      const submit = page.getByTestId('new-image-dialog-submit-button');

      // The WIDTH FIELD clamps nothing itself: `min`, `max` and `required` on the input are
      // the whole of its validation, and only a browser enforces those. The dialog does
      // clamp elsewhere — the preset and DPI paths both go through
      // `Math.min(10000, Math.max(1, w))` — but neither is on this path, which is why
      // typing past the bound is refused rather than quietly capped. This has to be a
      // browser test: jsdom exposes `validity`, so the property assertions here would pass
      // under jsdom, but it does not BLOCK a form submit the way a browser does, and the
      // refusal is the thing being pinned.
      await width.fill('0');
      await submit.click();
      await expect(page.getByTestId('new-image-dialog'), 'the dialog stays open').toBeVisible();
      await expect(width, 'the browser, not the app, is what refuses the value').toHaveJSProperty(
        'validity.rangeUnderflow',
        true
      );

      await width.fill('10001');
      await submit.click();
      await expect(page.getByTestId('new-image-dialog')).toBeVisible();
      await expect(width).toHaveJSProperty('validity.rangeOverflow', true);

      await width.fill('');
      await submit.click();
      await expect(page.getByTestId('new-image-dialog')).toBeVisible();
      // Clearing the field does not leave it empty: `parseInt('') || 0` puts a literal 0
      // back into a controlled input, so `required` can never be the rule that fires and
      // `min` is the whole of the lower bound.
      await expect(width).toHaveValue('0');
      await expect(width).toHaveJSProperty('validity.rangeUnderflow', true);
      await expect(width, 'the field is never empty, so `required` never fires').not.toHaveJSProperty(
        'validity.valueMissing',
        true
      );

      // A legal size goes through, which is what makes the two refusals above refusals
      // rather than a dialog that simply never submits.
      await width.fill('640');
      await page.getByTestId('new-image-height-input').fill('480');
      await submit.click();
      await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
      await expect(dimensionsReadout(page)).toContainText('Dimensions: 640 × 480 px');
    });

    test('the footer readout follows the document the dialog created', async ({ page }) => {
      await expect(dimensionsReadout(page), 'the blank document already has a size').toContainText(
        'Dimensions: 800 × 600 px'
      );

      await openNewImageDialog(page);
      await page.getByTestId('new-image-preset-select').selectOption('a4');
      await page.getByTestId('new-image-dialog-submit-button').click();

      await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
      await expect(dimensionsReadout(page)).toContainText(
        `Dimensions: ${A4_AT_300_DPI.width} × ${A4_AT_300_DPI.height} px`
      );
    });

    test('Cancel and Escape close the dialog without creating a document', async ({ page }) => {
      await openNewImageDialog(page);
      await page.getByTestId('new-image-width-input').fill('123');
      await page.getByTestId('new-image-dialog-cancel-button').click();
      await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
      await expect(dimensionsReadout(page), 'the original document is untouched').toContainText('800 × 600');

      await openNewImageDialog(page);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
      await expect(dimensionsReadout(page)).toContainText('800 × 600');
      // Nothing was created, so the timeline is still the one the blank document had.
      await expect(page.getByTestId('undo-button')).toBeDisabled();
    });
  });

  test.describe('Save File As', () => {
    async function openSaveDialog(page: Page): Promise<void> {
      await openFileItem(page, saveItem(page));
      await expect(page.getByTestId('save-dialog')).toBeVisible();
    }

    test('Save is refused while the filename is blank, and offered again once it is not', async ({ page }) => {
      await openSaveDialog(page);
      const filename = page.getByTestId('save-dialog-filename-input');
      const submit = page.getByTestId('save-dialog-submit-button');

      await filename.fill('');
      await expect(submit).toBeDisabled();
      // Whitespace is not a filename either, and `!fileName.trim()` is the whole test.
      await filename.fill('   ');
      await expect(submit, 'whitespace only is still blank').toBeDisabled();

      await filename.fill('shot');
      await expect(submit).toBeEnabled();
    });

    test('only JPEG offers a quality control, and only PSD carries the layer caveat', async ({ page }) => {
      await openSaveDialog(page);
      const format = page.getByTestId('save-dialog-format-select');
      const quality = page.getByTestId('save-dialog-jpeg-quality');
      const caveat = page.getByText(/Photoshop groups, editable text, masks/);

      await expect(quality, 'PNG is lossless and has nothing to configure').toHaveCount(0);
      await expect(caveat).toHaveCount(0);

      await format.selectOption('image/jpeg');
      await expect(quality).toBeVisible();
      await expect(caveat).toHaveCount(0);

      await format.selectOption('psd');
      await expect(quality, 'PSD is not JPEG').toHaveCount(0);
      await expect(caveat).toBeVisible();
    });

    test('Escape and Cancel both close the dialog, and the backdrop does too', async ({ page }) => {
      await openSaveDialog(page);
      await page.getByTestId('save-dialog-cancel-button').click();
      await expect(page.getByTestId('save-dialog')).toHaveCount(0);

      await openSaveDialog(page);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('save-dialog')).toHaveCount(0);

      await openSaveDialog(page);
      await page.getByTestId('save-dialog-backdrop').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('save-dialog')).toHaveCount(0);
    });
  });

  test('the theme toggle switches the whole document between light and dark', async ({ page }) => {
    const root = page.locator('html');
    const toggle = page.getByTestId('theme-toggle-button');

    // Playwright's default colour scheme is light, and the app seeds from
    // `prefers-color-scheme` when localStorage holds nothing, so the starting class is
    // deterministic without being written down twice.
    await expect(root).toHaveClass(/\blight\b/);

    await toggle.click();
    await expect(root).toHaveClass(/\bdark\b/);
    await expect(root).not.toHaveClass(/\blight\b/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

    // The choice survives a reload, which is the only part of it a single click cannot show.
    await page.reload();
    await expect(root).toHaveClass(/\bdark\b/);

    await page.getByTestId('theme-toggle-button').click();
    await expect(root).toHaveClass(/\blight\b/);
    await expect(root).not.toHaveClass(/\bdark\b/);
  });
});
