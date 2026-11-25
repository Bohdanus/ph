import { expect, test } from './fixtures/extended-test';
import { drawLineFromDocument, getWorkspaceCanvas, readWorkspaceDocumentSize } from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { expectNoDiscardPrompt } from './helpers/discard-prompt';
import {
  CHANGED_CHANNEL_THRESHOLD_GENERAL,
  INTEGRATION_TEST_TIMEOUT_MS,
  exportFormats,
  fillSaveDialog,
  openSaveDialog,
  prepareExportDownloadDirectory,
  submitSaveDialogForDownload,
  verifyExportPixelsInBrowser,
} from './export/helpers';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PHOTO_SIZE = { width: 960, height: 640 };
const CROP_START = { x: 48, y: 32 };
const CROP_END = { x: 912, y: 608 };
const CROPPED_SIZE = { width: CROP_END.x - CROP_START.x, height: CROP_END.y - CROP_START.y };

async function readCanvasDataUrl(page: Parameters<typeof getWorkspaceCanvas>[0]): Promise<string> {
  return getWorkspaceCanvas(page).evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
}

async function canvasMatches(page: Parameters<typeof getWorkspaceCanvas>[0], expected: string): Promise<boolean> {
  return (await readCanvasDataUrl(page)) === expected;
}

test.describe('Entry-level photo workflow', () => {
  test('import a photograph, crop and spot-heal it, undo and redo, then export PNG', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);
    const downloadDirectory = await prepareExportDownloadDirectory(testInfo);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-open-button').click();
    await expectNoDiscardPrompt(page);
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(testInfo.config.rootDir, 'fixtures/landscape-photo.jpg'));
    await expect.poll(() => readWorkspaceDocumentSize(page, 'real-photo import')).toEqual(PHOTO_SIZE);

    await clickToolButton(page, 'crop');
    await expect(page.locator('.cursor-crop'), 'the crop gesture surface should open').toBeVisible();
    const cropBox = await getWorkspaceCanvas(page).boundingBox();
    if (!cropBox) throw new Error('Canvas not found after selecting the Crop tool');
    await drawLineFromDocument(
      page,
      cropBox,
      CROP_START.x,
      CROP_START.y,
      CROP_END.x,
      CROP_END.y,
      { steps: 16 },
      PHOTO_SIZE
    );
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => readWorkspaceDocumentSize(page, 'real-photo crop')).toEqual(CROPPED_SIZE);

    const croppedCanvas = await readCanvasDataUrl(page);
    await clickToolButton(page, 'spot-healing');
    const healingArea = page.getByTestId('spot-healing-tool-area');
    await expect(healingArea, 'the imported bedrock image is protected until converted').toHaveClass(
      /cursor-not-allowed/
    );

    const convertBackground = page.getByTestId('layers-convert-background-button');
    await expect(convertBackground, 'the imported background needs conversion before raster retouch').toBeVisible();
    await convertBackground.click();
    await expect(convertBackground).toHaveCount(0);
    await expect(healingArea, 'converting the image should enable raster retouch').toHaveClass(/cursor-crosshair/);
    await expect
      .poll(() => canvasMatches(page, croppedCanvas), 'conversion should preserve the cropped pixels')
      .toBe(true);

    await expect(page.locator('#spot-healing-size')).toBeVisible();
    const healingBox = await getWorkspaceCanvas(page).boundingBox();
    if (!healingBox) throw new Error('Canvas not found after selecting Spot Healing');

    // This short stroke crosses the bright yellow patch in the upper-right foliage of the
    // committed photo. The goal is to exercise the supported retouch path without asserting
    // that this simple proximity-sampling tool meets a general photo-quality standard.
    await drawLineFromDocument(page, healingBox, 818, 209, 830, 215, { steps: 5 }, CROPPED_SIZE);
    const undo = page.getByTestId('undo-button');
    const redo = page.getByTestId('redo-button');
    await expect(undo, 'Spot Healing should commit an undoable image change').toBeEnabled();
    await expect.poll(async () => !(await canvasMatches(page, croppedCanvas))).toBe(true);
    const healedCanvas = await readCanvasDataUrl(page);

    await undo.click();
    await expect
      .poll(() => canvasMatches(page, croppedCanvas), 'Undo should restore the cropped photo exactly')
      .toBe(true);
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect
      .poll(() => canvasMatches(page, healedCanvas), 'Redo should restore the retouched photo exactly')
      .toBe(true);

    const pngFormat = exportFormats.find((format) => format.extension === '.png')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'beginner-photo-retouch', pngFormat.label);
    const download = await submitSaveDialogForDownload(page, pngFormat);
    const pngTarget = path.join(downloadDirectory, path.basename(download.suggestedFilename()));
    await download.saveAs(pngTarget);

    const png = await readFile(pngTarget);
    await verifyExportPixelsInBrowser(page, pngFormat, png, healedCanvas, CHANGED_CHANNEL_THRESHOLD_GENERAL, testInfo);
    const metadata = await sharp(png).metadata();
    expect(metadata.width).toBe(CROPPED_SIZE.width);
    expect(metadata.height).toBe(CROPPED_SIZE.height);
  });
});
