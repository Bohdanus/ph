import { expect, test, type Page, type TestInfo } from './fixtures/extended-test';
import {
  getWorkspaceCanvas,
  drawLineFromDocument,
  waitForCanvasRedraw,
  viewportClip,
  readWorkspaceDocumentSize,
  documentToCanvasOffset,
  measureInk,
  type ImageDataResult,
} from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import {
  CHANGED_CHANNEL_THRESHOLD_GENERAL,
  INTEGRATION_TEST_TIMEOUT_MS,
  exportFormats,
  fillSaveDialog,
  openSaveDialog,
  prepareExportDownloadDirectory,
  submitSaveDialogForDownload,
  verifyExportContainer,
  verifyExportPixelsInBrowser,
} from './export/helpers';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readPsd, initializeCanvas, type PixelData } from 'ag-psd';
import sharp from 'sharp';

// Helper to convert ag-psd PixelData to canvas-helpers ImageDataResult
function toImageDataResult(pixelData: PixelData): ImageDataResult {
  return {
    width: pixelData.width,
    height: pixelData.height,
    data: new Uint8ClampedArray(pixelData.data),
  };
}

// Initialize PSD canvas for ag-psd (needed for reading layer image data)
let psdCanvasInitialised = false;
function initializePsdCanvas(): void {
  if (psdCanvasInitialised) return;
  initializeCanvas(
    ((width: number, height: number) => ({ width, height }) as unknown as HTMLCanvasElement) as (
      width: number,
      height: number
    ) => HTMLCanvasElement,
    (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb' as const,
    })
  );
  psdCanvasInitialised = true;
}

/**
 * Typical junior/intermediate Photoshop photo editing workflow test.
 *
 * This test simulates a realistic photo editing workflow that a beginner-to-intermediate
 * user would perform, covering:
 * 1. New document creation with specific dimensions
 * 2. Drawing/painting with the editor's brush tool
 * 3. Layer management (creating, hiding, opacity, and blend modes)
 * 4. Apply the real Desaturate adjustment and verify grayscale pixels
 * 5. Manage layer visibility and blend modes
 * 7. Export as PSD with full layer structure verification
 * 8. Export as JPEG/PNG for web
 *
 * The test uses the app's tools and verifies results through pixel sampling and PSD structure analysis.
 */

const WORKFLOW_DOCUMENT_WIDTH = 800;
const WORKFLOW_DOCUMENT_HEIGHT = 600;

const WORKFLOW_TIMEOUT_MS = 120_000;

async function setupWorkflowDocument(page: Page, testInfo: TestInfo) {
  const downloadDirectory = await prepareExportDownloadDirectory(testInfo);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  const documentSize = await readWorkspaceDocumentSize(page, 'setupWorkflowDocument');
  expect(documentSize.width).toBe(WORKFLOW_DOCUMENT_WIDTH);
  expect(documentSize.height).toBe(WORKFLOW_DOCUMENT_HEIGHT);

  return { box, documentSize, downloadDirectory };
}

async function drawWorkflowStroke(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  documentSize: { width: number; height: number },
  color: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  steps = 15
) {
  await clickToolButton(page, 'draw');
  // waitForCanvasRedraw detects dark pixels, so use distinct dark colors here.
  await setForegroundColor(page, color, true);

  const startCanvas = documentToCanvasOffset(box, start.x, start.y, documentSize);
  const endCanvas = documentToCanvasOffset(box, end.x, end.y, documentSize);

  await drawLineFromDocument(page, box, start.x, start.y, end.x, end.y, { steps }, documentSize);

  await waitForCanvasRedraw(page, box, {
    clip: viewportClip({
      x: box.x + Math.floor(Math.min(startCanvas.x, endCanvas.x)) - 20,
      y: box.y + Math.floor(Math.min(startCanvas.y, endCanvas.y)) - 20,
      width: Math.ceil(Math.abs(endCanvas.x - startCanvas.x)) + 40,
      height: Math.ceil(Math.abs(endCanvas.y - startCanvas.y)) + 40,
    }),
  });
}

async function sampleCanvasAtPoint(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  documentX: number,
  documentY: number,
  documentSize: { width: number; height: number }
): Promise<{ red: number; green: number; blue: number; alpha: number } | null> {
  const canvasPoint = documentToCanvasOffset(box, documentX, documentY, documentSize);
  const clip = viewportClip({
    x: box.x + canvasPoint.x - 2,
    y: box.y + canvasPoint.y - 2,
    width: 5,
    height: 5,
  });
  const screenshot = await page.screenshot({ clip, type: 'png', scale: 'device' });
  const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width ?? 5;
  const height = info.height ?? 5;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const index = (cy * width + cx) * 4;
  return {
    red: data[index],
    green: data[index + 1],
    blue: data[index + 2],
    alpha: data[index + 3],
  };
}

async function readCanvasDataUrl(page: Page): Promise<string> {
  return getWorkspaceCanvas(page).evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
}

function expectCompositePixelsExactlyEqual(actual: any, expected: any, description: string) {
  expect(actual, `${description}: actual composite must exist`).toBeDefined();
  expect(expected, `${description}: expected composite must exist`).toBeDefined();
  expect(actual.width, `${description}: width`).toBe(expected.width);
  expect(actual.height, `${description}: height`).toBe(expected.height);
  expect(actual.data.length, `${description}: RGBA byte length`).toBe(expected.data.length);

  const firstDifferingByte = actual.data.findIndex((value: number, index: number) => value !== expected.data[index]);
  expect(
    firstDifferingByte,
    firstDifferingByte === -1
      ? description
      : `${description}: RGBA byte ${firstDifferingByte} differs (${actual.data[firstDifferingByte]} vs ${expected.data[firstDifferingByte]})`
  ).toBe(-1);
}

async function verifyLayerStructureInPsd(psdPath: string, expectedLayers: Array<{ name: string; hasPixels: boolean }>) {
  initializePsdCanvas();
  const file = await readFile(psdPath);
  const psd = readPsd(new Uint8Array(file), {
    useImageData: true,
    skipCompositeImageData: false,
  });

  expect(psd.width).toBe(WORKFLOW_DOCUMENT_WIDTH);
  expect(psd.height).toBe(WORKFLOW_DOCUMENT_HEIGHT);
  expect(psd.colorMode).toBe(3); // RGB
  expect(psd.bitsPerChannel).toBe(8);

  const layers = psd.children ?? [];
  expect(layers.map((layer) => layer.name ?? null)).toEqual(expectedLayers.map((layer) => layer.name));

  for (const [index, expected] of expectedLayers.entries()) {
    const layer = layers[index];

    if (expected.hasPixels) {
      expect(layer!.imageData, `Layer "${expected.name}" should have pixel data`).toBeDefined();
      expect(layer!.imageData!.width).toBeGreaterThan(0);
      expect(layer!.imageData!.height).toBeGreaterThan(0);
    }
  }

  // Verify composite image exists
  expect(psd.imageData, 'PSD must have composite image data').toBeDefined();
  expect(psd.imageData!.width).toBe(WORKFLOW_DOCUMENT_WIDTH);
  expect(psd.imageData!.height).toBe(WORKFLOW_DOCUMENT_HEIGHT);

  return psd;
}

test.describe('Photoshop Junior/Intermediate Photo Editing Workflow', () => {
  test('Complete workflow: new document, draw, layers, adjustments, export PSD and JPEG', async ({
    page,
  }, testInfo) => {
    test.setTimeout(WORKFLOW_TIMEOUT_MS);

    // ========================================================================
    // STEP 1: New Document Creation
    // ========================================================================
    const { box, documentSize, downloadDirectory } = await setupWorkflowDocument(page, testInfo);

    // ========================================================================
    // STEP 2: Basic Drawing (simulating brushwork on background)
    // ========================================================================
    // Draw a base layer - simulating a sky gradient with blue
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#081018', // dark blue
      { x: 100, y: 100 },
      { x: 700, y: 500 },
      20
    );

    // Draw ground - green
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#081C08', // forest green
      { x: 100, y: 400 },
      { x: 700, y: 400 },
      20
    );

    // ========================================================================
    // STEP 3: Layer Management - Create new layers for different elements
    // ========================================================================
    // The draw tool automatically creates new layers for each stroke.
    // Verify we have the background layer plus our drawn layers.

    const layerRows = page.getByTitle('Drag to reorder');
    await expect(layerRows).toHaveCount(3); // Blank 1 + 2 drawn layers

    // ========================================================================
    // STEP 4: Inspect the layer stack and identify its active paint layer.
    // ========================================================================
    const layerRow = (name: string) => layerRows.filter({ hasText: name });

    // Get initial order
    const initialOrder = await layerRows.allTextContents();
    expect(initialOrder[0]).toMatch(/draw \d+/); // Topmost drawn layer

    // ========================================================================
    // STEP 5: Adjust opacity on the active paint layer.
    // ========================================================================
    // Open layer properties and set opacity on the top layer
    const topLayerName = initialOrder[0];
    const overlapX = 550;
    const overlapY = 400;
    const fullOpacity = await sampleCanvasAtPoint(page, box, overlapX, overlapY, documentSize);
    expect(fullOpacity).not.toBeNull();
    await page.locator('details > summary').click();
    const opacitySlider = page.getByRole('slider', { name: 'Layer opacity' });
    await expect(opacitySlider).toBeVisible();
    await opacitySlider.fill('50');
    await opacitySlider.press('Tab');
    await expect(opacitySlider).toHaveValue('50');

    // Verify opacity changes the actual pixel at the crossing of the two strokes.
    const withOpacity = await sampleCanvasAtPoint(page, box, overlapX, overlapY, documentSize);
    expect(withOpacity).not.toBeNull();
    expect(withOpacity).not.toEqual(fullOpacity);

    // ========================================================================
    // STEP 6: Apply a blend mode to the active paint layer.
    // ========================================================================
    const blendModeSelect = page.getByRole('combobox', { name: new RegExp(`Blend mode for ${topLayerName}`) });
    await expect(blendModeSelect).toBeVisible();
    await blendModeSelect.selectOption('multiply');

    // Verify blend mode effect
    const withBlendMode = await sampleCanvasAtPoint(page, box, overlapX, overlapY, documentSize);
    expect(withBlendMode).not.toBeNull();
    expect(withBlendMode).not.toEqual(withOpacity);

    // ========================================================================
    // STEP 7: Toggle the active paint layer visibility.
    // ========================================================================
    const visibilityButton = layerRow(topLayerName).getByRole('button', { name: /^(Hide|Show) layer$/ });
    await visibilityButton.click();
    await expect(visibilityButton).toHaveAccessibleName('Show layer');

    const hiddenSample = await sampleCanvasAtPoint(page, box, overlapX, overlapY, documentSize);
    expect(hiddenSample).not.toBeNull();
    expect(hiddenSample).not.toEqual(withBlendMode);

    // Show again
    await visibilityButton.click();
    await expect(visibilityButton).toHaveAccessibleName('Hide layer');
    expect(await sampleCanvasAtPoint(page, box, overlapX, overlapY, documentSize)).toEqual(withBlendMode);

    // ========================================================================
    // STEP 8: Add more drawing on a new layer (simulating retouching layer)
    // ========================================================================
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#202020', // neutral highlight
      { x: 200, y: 150 },
      { x: 300, y: 150 },
      10
    );

    // ========================================================================
    // STEP 9: Add a separate accent stroke on a new layer.
    // ========================================================================
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#200808', // muted red accent
      { x: 500, y: 200 },
      { x: 600, y: 300 },
      15
    );

    // ========================================================================
    // STEP 10: Apply the actual Desaturate adjustment to the active accent layer.
    // ========================================================================
    const colorSampleBeforeDesaturate = await sampleCanvasAtPoint(page, box, 550, 250, documentSize);
    expect(colorSampleBeforeDesaturate).not.toBeNull();
    const chromaBeforeDesaturate =
      Math.max(
        colorSampleBeforeDesaturate!.red,
        colorSampleBeforeDesaturate!.green,
        colorSampleBeforeDesaturate!.blue
      ) -
      Math.min(colorSampleBeforeDesaturate!.red, colorSampleBeforeDesaturate!.green, colorSampleBeforeDesaturate!.blue);
    expect(chromaBeforeDesaturate).toBeGreaterThan(20);
    await page.getByTestId('header-image-menu-button').click();
    await page.getByTestId('image-menu-adjustments-button').click();
    await page.getByTestId('image-menu-adjustments-desaturate-button').click();
    const grayscale = page.getByRole('slider', { name: /Grayscale/ });
    await expect(grayscale).toBeVisible();
    await grayscale.press('End');
    await expect(grayscale).toHaveValue('100');
    const adjustedCanvas = getWorkspaceCanvas(page);
    await expect(adjustedCanvas).toBeVisible();
    const adjustedBox = await adjustedCanvas.boundingBox();
    expect(adjustedBox, 'The canvas should remain visible after opening adjustments').not.toBeNull();
    await waitForCanvasRedraw(page, adjustedBox!);
    const grayscaleSample = await sampleCanvasAtPoint(page, adjustedBox!, 550, 250, documentSize);
    expect(grayscaleSample).not.toBeNull();
    const chromaAfterDesaturate =
      Math.max(grayscaleSample!.red, grayscaleSample!.green, grayscaleSample!.blue) -
      Math.min(grayscaleSample!.red, grayscaleSample!.green, grayscaleSample!.blue);
    expect(chromaAfterDesaturate).toBe(0);
    expect(grayscaleSample!.red).toBeLessThan(250);

    // ========================================================================
    // STEP 11: Export as PSD with full layer structure verification
    // ========================================================================
    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'workflow-complete', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    const psdFile = await readFile(psdTarget);
    expect(psdFile.byteLength).toBeGreaterThan(1000);
    const sourceDataUrl = await readCanvasDataUrl(page);
    await verifyExportContainer(psdFormat, psdFile, sourceDataUrl);

    // Deep PSD structure verification
    const psd = await verifyLayerStructureInPsd(psdTarget, [
      { name: 'Blank 1', hasPixels: true },
      { name: 'draw 2', hasPixels: true }, // sky
      { name: 'draw 3', hasPixels: true }, // ground
      { name: 'draw 4', hasPixels: true }, // highlights
      { name: 'draw 5', hasPixels: true }, // coral accent
    ]);

    // Verify layer count matches expectation (background + drawn layers)
    expect(psd.children!.length).toBe(5);

    // Verify each layer has proper bounds
    for (const layer of psd.children!) {
      expect(layer.top!).toBeLessThanOrEqual(layer.bottom!);
      expect(layer.left!).toBeLessThanOrEqual(layer.right!);
      expect(layer.blendMode).toBeDefined();
      expect(layer.opacity).toBeGreaterThanOrEqual(0);
      expect(layer.opacity).toBeLessThanOrEqual(1);
    }

    // Verify composite image carries the drawing
    const composite = psd.imageData!;
    const compositeInk = await measureInk(toImageDataResult(composite));
    expect(compositeInk).not.toBeNull();
    expect(compositeInk!.pixelCount).toBeGreaterThan(100);

    // ========================================================================
    // STEP 11: Export as JPEG for web
    // ========================================================================
    const jpegFormat = exportFormats.find((f) => f.extension === '.jpeg')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'workflow-web', jpegFormat.label);
    const jpegDownload = await submitSaveDialogForDownload(page, jpegFormat);

    const jpegTarget = path.join(downloadDirectory, path.basename(jpegDownload.suggestedFilename()));
    await jpegDownload.saveAs(jpegTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    const jpegFile = await readFile(jpegTarget);
    expect(jpegFile.byteLength).toBeGreaterThan(1000);
    await verifyExportPixelsInBrowser(
      page,
      jpegFormat,
      jpegFile,
      sourceDataUrl,
      CHANGED_CHANNEL_THRESHOLD_GENERAL,
      testInfo
    );

    // Verify JPEG can be decoded and has content
    const jpegMeta = await sharp(jpegFile).metadata();
    expect(jpegMeta.width).toBe(WORKFLOW_DOCUMENT_WIDTH);
    expect(jpegMeta.height).toBe(WORKFLOW_DOCUMENT_HEIGHT);

    const jpegInk = await measureInk(jpegFile);
    expect(jpegInk).not.toBeNull();
    expect(jpegInk!.pixelCount).toBeGreaterThan(100);

    // ========================================================================
    // STEP 12: Export as PNG (lossless)
    // ========================================================================
    const pngFormat = exportFormats.find((f) => f.extension === '.png')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'workflow-archive', pngFormat.label);
    const pngDownload = await submitSaveDialogForDownload(page, pngFormat);

    const pngTarget = path.join(downloadDirectory, path.basename(pngDownload.suggestedFilename()));
    await pngDownload.saveAs(pngTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    const pngFile = await readFile(pngTarget);
    expect(pngFile.byteLength).toBeGreaterThan(1000);
    await verifyExportPixelsInBrowser(
      page,
      pngFormat,
      pngFile,
      sourceDataUrl,
      CHANGED_CHANNEL_THRESHOLD_GENERAL,
      testInfo
    );

    const pngMeta = await sharp(pngFile).metadata();
    expect(pngMeta.width).toBe(WORKFLOW_DOCUMENT_WIDTH);
    expect(pngMeta.height).toBe(WORKFLOW_DOCUMENT_HEIGHT);

    const pngInk = await measureInk(pngFile);
    expect(pngInk).not.toBeNull();
    expect(pngInk!.pixelCount).toBeGreaterThan(100);
  });

  test('Workflow isolates content by toggling layer visibility', async ({ page }, testInfo) => {
    test.setTimeout(WORKFLOW_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupWorkflowDocument(page, testInfo);

    // Draw base layer
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#202020', // dark base
      { x: 50, y: 50 },
      { x: 750, y: 550 },
      30
    );

    // Draw subject on second layer
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#202008', // muted yellow subject
      { x: 300, y: 200 },
      { x: 500, y: 400 },
      20
    );

    // Draw foreground element on third layer
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#200808', // muted red foreground
      { x: 200, y: 300 },
      { x: 400, y: 300 },
      15
    );

    const layerRows = page.getByTitle('Drag to reorder');
    await expect(layerRows).toHaveCount(4); // Blank 1 + 3 layers

    // This verifies layer visibility, not a pixel selection tool.
    const layerRow = (name: string) => layerRows.filter({ hasText: name });
    const visibilityButton = (name: string) => layerRow(name).getByRole('button', { name: /^(Hide|Show) layer$/ });
    const hideBgButton = visibilityButton('draw 2');
    await expect(hideBgButton).toBeVisible();
    await hideBgButton.click();
    await expect(hideBgButton).toHaveAccessibleName('Show layer');

    // Export PSD - should only have visible layers in composite
    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'workflow-selection', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);
    await verifyExportContainer(psdFormat, await readFile(psdTarget), await readCanvasDataUrl(page));

    // Verify PSD structure - all layers present but composite reflects visibility
    const psd = await verifyLayerStructureInPsd(psdTarget, [
      { name: 'Blank 1', hasPixels: true },
      { name: 'draw 2', hasPixels: true },
      { name: 'draw 3', hasPixels: true },
      { name: 'draw 4', hasPixels: true },
    ]);

    // The composite should show the drawing (layers 3 and 4 visible, layer 2 hidden)
    const composite = psd.imageData!;
    const compositeInk = await measureInk(toImageDataResult(composite));
    expect(compositeInk).not.toBeNull();
    expect(compositeInk!.pixelCount).toBeGreaterThan(50);
  });

  test('Workflow combines layer opacity and blend mode controls', async ({ page }, testInfo) => {
    test.setTimeout(WORKFLOW_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupWorkflowDocument(page, testInfo);

    // Base image
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#202020', // mid-gray base
      { x: 100, y: 100 },
      { x: 700, y: 500 },
      25
    );

    // "Brightness/Contrast" simulation - white overlay at 30% opacity
    await drawWorkflowStroke(page, box, documentSize, '#202020', { x: 150, y: 150 }, { x: 650, y: 450 }, 20);
    // Open layer properties for the top layer (active after drawing)
    await page.locator('details > summary').click();
    const opacitySlider1 = page.getByRole('slider', { name: 'Layer opacity' });
    await expect(opacitySlider1).toBeVisible({ timeout: 10000 });
    await opacitySlider1.fill('30');
    await opacitySlider1.press('Tab');

    // "Hue/Saturation" simulation - colored overlay with color blend mode
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#201010', // muted red tint
      { x: 200, y: 200 },
      { x: 600, y: 400 },
      20
    );
    // New layer is now active, open its properties
    await page.locator('details > summary').click();
    const blendModeSelect2 = page.getByRole('combobox', { name: /^Blend mode for/ });
    await expect(blendModeSelect2).toBeVisible({ timeout: 10000 });
    await blendModeSelect2.selectOption('color');

    // "Levels" simulation - dark overlay with multiply and 40% opacity
    await drawWorkflowStroke(
      page,
      box,
      documentSize,
      '#202020', // dark
      { x: 250, y: 250 },
      { x: 550, y: 350 },
      20
    );
    // New layer is now active, open its properties
    await page.locator('details > summary').click();
    const blendModeSelect3 = page.getByRole('combobox', { name: /^Blend mode for/ });
    await expect(blendModeSelect3).toBeVisible({ timeout: 10000 });
    await blendModeSelect3.selectOption('multiply');
    const opacitySlider3 = page.getByRole('slider', { name: 'Layer opacity' });
    await expect(opacitySlider3).toBeVisible({ timeout: 10000 });
    await opacitySlider3.fill('40');
    await opacitySlider3.press('Tab');

    // Export and verify PSD preserves all styled paint layers
    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'workflow-adjustments', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);
    await verifyExportContainer(psdFormat, await readFile(psdTarget), await readCanvasDataUrl(page));

    const psd = await verifyLayerStructureInPsd(psdTarget, [
      { name: 'Blank 1', hasPixels: true },
      { name: 'draw 2', hasPixels: true },
      { name: 'draw 3', hasPixels: true },
      { name: 'draw 4', hasPixels: true },
      { name: 'draw 5', hasPixels: true },
    ]);

    // Verify blend modes preserved
    const layers = psd.children!;
    // ag-psd returns layers bottom-to-top: Blank 1, draw 2, draw 3, draw 4, draw 5
    const colorLayer = layers.find((l) => l.name === 'draw 4'); // red tint with color blend
    expect(colorLayer).toBeDefined();
    expect(colorLayer!.blendMode).toBe('color');

    const multiplyLayer = layers.find((l) => l.name === 'draw 5'); // dark overlay with multiply
    expect(multiplyLayer).toBeDefined();
    expect(multiplyLayer!.blendMode).toBe('multiply');
    expect(multiplyLayer!.opacity).toBeCloseTo(0.4, 2);

    // Verify composite
    const composite = psd.imageData!;
    const compositeInk = await measureInk(toImageDataResult(composite));
    expect(compositeInk).not.toBeNull();
    expect(compositeInk!.pixelCount).toBeGreaterThan(100);
  });
});

test.describe('Photoshop Workflow: PSD Export Hardening', () => {
  test('PSD export preserves layer order, names, opacity, blend modes, and visibility', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupWorkflowDocument(page, testInfo);

    // Create a known layer stack
    await drawWorkflowStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 }); // draw 2 - muted red
    await drawWorkflowStroke(page, box, documentSize, '#102010', { x: 100, y: 200 }, { x: 700, y: 200 }); // draw 3 - muted green
    await drawWorkflowStroke(page, box, documentSize, '#101020', { x: 100, y: 300 }, { x: 700, y: 300 }); // draw 4 - muted blue
    await drawWorkflowStroke(page, box, documentSize, '#202008', { x: 100, y: 400 }, { x: 700, y: 400 }); // draw 5 - muted yellow

    const layerRows = page.getByTitle('Drag to reorder');
    await expect(layerRows).toHaveCount(5); // Blank 1 + 4 layers

    // Set specific properties on each layer
    const layerRow = (name: string) => layerRows.filter({ hasText: name });
    const layerNames = await layerRows.allTextContents();

    // Layer 1 (top): yellow - 75% opacity, screen blend (already active)
    await page.locator('details > summary').click();
    let opacitySlider = page.getByRole('slider', { name: 'Layer opacity' });
    await expect(opacitySlider).toBeVisible({ timeout: 10000 });
    await opacitySlider.fill('75');
    await opacitySlider.press('Tab');
    let blendModeSelect = page.getByRole('combobox', { name: new RegExp(`Blend mode for ${layerNames[0]}`) });
    await blendModeSelect.selectOption('screen');

    // Hide layer 2 (blue) - click visibility button on that row
    await layerRow(layerNames[1])
      .getByRole('button', { name: /^(Hide|Show) layer$/ })
      .click();

    // Layer 3 (green): select it first, then set 50% opacity, multiply
    await layerRow(layerNames[2]).click();
    await page.locator('details > summary').click();
    opacitySlider = page.getByRole('slider', { name: 'Layer opacity' });
    await expect(opacitySlider).toBeVisible({ timeout: 10000 });
    await opacitySlider.fill('50');
    await opacitySlider.press('Tab');
    blendModeSelect = page.getByRole('combobox', { name: new RegExp(`Blend mode for ${layerNames[2]}`) });
    await blendModeSelect.selectOption('multiply');

    // Layer 4 (red, bottom): normal, 100% (default) - no action needed

    // Export PSD
    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'layer-properties-test', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    // Deep verification
    initializePsdCanvas();
    const file = await readFile(psdTarget);
    await verifyExportContainer(psdFormat, file, await readCanvasDataUrl(page));
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Verify document properties
    expect(psd.width).toBe(WORKFLOW_DOCUMENT_WIDTH);
    expect(psd.height).toBe(WORKFLOW_DOCUMENT_HEIGHT);
    expect(psd.colorMode).toBe(3);
    expect(psd.bitsPerChannel).toBe(8);

    // Verify layer count
    const layers = psd.children ?? [];
    expect(layers.length).toBe(5);

    // Verify layer order (ag-psd returns bottom-to-top: Blank 1, draw 2, draw 3, draw 4, draw 5)
    expect(layers[0].name).toBe('Blank 1'); // background (bottom)
    expect(layers[1].name).toBe('draw 2'); // red
    expect(layers[2].name).toBe('draw 3'); // green
    expect(layers[3].name).toBe('draw 4'); // blue
    expect(layers[4].name).toBe('draw 5'); // yellow (top)

    // Verify layer properties (using correct indices for bottom-to-top order)
    // Yellow layer (top, index 4): screen blend, 75% opacity
    expect(layers[4].blendMode).toBe('screen');
    expect(layers[4].opacity).toBeCloseTo(0.75, 2);
    expect(layers[4].hidden).toBe(false);

    // Blue layer (index 3): hidden
    expect(layers[3].hidden).toBe(true);

    // Green layer (index 2): multiply blend, 50% opacity
    expect(layers[2].blendMode).toBe('multiply');
    expect(layers[2].opacity).toBeCloseTo(0.5, 2);
    expect(layers[2].hidden).toBe(false);

    // Red layer (index 1): normal, 100%
    expect(layers[1].blendMode).toBe('normal');
    expect(layers[1].opacity).toBeCloseTo(1.0, 2);
    expect(layers[1].hidden).toBe(false);

    // Background (index 0): normal, 100%
    expect(layers[0].blendMode).toBe('normal');
    expect(layers[0].opacity).toBeCloseTo(1.0, 2);

    // Verify all layers have pixel data
    for (const layer of layers) {
      expect(layer.imageData).toBeDefined();
      expect(layer.imageData!.width).toBeGreaterThan(0);
      expect(layer.imageData!.height).toBeGreaterThan(0);
    }

    // Verify composite exists and has content
    expect(psd.imageData).toBeDefined();
    expect(psd.imageData!.width).toBe(WORKFLOW_DOCUMENT_WIDTH);
    expect(psd.imageData!.height).toBe(WORKFLOW_DOCUMENT_HEIGHT);

    const compositeInk = await measureInk(toImageDataResult(psd.imageData!));
    expect(compositeInk).not.toBeNull();
    expect(compositeInk!.pixelCount).toBeGreaterThan(100);
  });

  test('PSD export with channel data verification', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupWorkflowDocument(page, testInfo);

    // Draw with distinct colors to verify channel separation
    await drawWorkflowStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 400, y: 100 }); // muted red
    await drawWorkflowStroke(page, box, documentSize, '#102010', { x: 100, y: 200 }, { x: 400, y: 200 }); // muted green
    await drawWorkflowStroke(page, box, documentSize, '#101020', { x: 100, y: 300 }, { x: 400, y: 300 }); // muted blue

    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'channel-test', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    // Verify using ag-psd raw data to check channel structure
    initializePsdCanvas();
    const file = await readFile(psdTarget);
    await verifyExportContainer(psdFormat, file, await readCanvasDataUrl(page));
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    expect(psd.channels).toBe(3); // RGB

    // Verify each layer has proper channel data
    for (const layer of psd.children!) {
      expect(layer.imageData).toBeDefined();
      const { data, width, height } = layer.imageData!;
      expect(data.length).toBe(width * height * 4); // RGBA

      // Verify non-zero pixel data exists (skip background layer which may be transparent)
      if (layer.name === 'Blank 1') continue;

      let hasNonZero = false;
      for (let i = 0; i < data.length; i += 4) {
        // Check RGB or alpha (some layers might be transparent but have alpha)
        if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0 || data[i + 3] > 0) {
          hasNonZero = true;
          break;
        }
      }
      expect(hasNonZero).toBe(true);
    }

    // Verify composite channel data
    const { data: compData, width: compWidth, height: compHeight } = psd.imageData!;
    expect(compData.length).toBe(compWidth * compHeight * 4);
    expect(compWidth).toBe(WORKFLOW_DOCUMENT_WIDTH);
    expect(compHeight).toBe(WORKFLOW_DOCUMENT_HEIGHT);
  });

  test('PSD export round-trip: write and read back preserves structure', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupWorkflowDocument(page, testInfo);

    // Create a document with multiple layers
    await drawWorkflowStroke(page, box, documentSize, '#201008', { x: 150, y: 150 }, { x: 650, y: 150 });
    await drawWorkflowStroke(page, box, documentSize, '#100820', { x: 150, y: 300 }, { x: 650, y: 300 });
    await drawWorkflowStroke(page, box, documentSize, '#102010', { x: 150, y: 450 }, { x: 650, y: 450 });

    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'roundtrip-test', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    // Read back the PSD
    initializePsdCanvas();
    const file = await readFile(psdTarget);
    await verifyExportContainer(psdFormat, file, await readCanvasDataUrl(page));
    const psd1 = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Write it back using ag-psd
    const { writePsdBuffer } = await import('ag-psd');
    const roundTripBuffer = writePsdBuffer(psd1);

    // Read the round-tripped version
    const psd2 = readPsd(new Uint8Array(roundTripBuffer), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Verify structure preserved
    expect(psd2.width).toBe(psd1.width);
    expect(psd2.height).toBe(psd1.height);
    expect(psd2.colorMode).toBe(psd1.colorMode);
    expect(psd2.bitsPerChannel).toBe(psd1.bitsPerChannel);
    expect(psd2.children!.length).toBe(psd1.children!.length);
    expectCompositePixelsExactlyEqual(psd2.imageData, psd1.imageData, 'ag-psd PSD read/write round-trip');

    for (let i = 0; i < psd1.children!.length; i++) {
      const l1 = psd1.children![i];
      const l2 = psd2.children![i];
      expect(l2.name).toBe(l1.name ?? '');
      expect(l2.blendMode).toBe(l1.blendMode);
      expect(l2.opacity!).toBeCloseTo(l1.opacity!, 2);
      expect(l2.hidden).toBe(l1.hidden);
      expect(l2.top!).toBe(l1.top!);
      expect(l2.left!).toBe(l1.left!);
      expect(l2.bottom!).toBe(l1.bottom!);
      expect(l2.right!).toBe(l1.right!);
    }

    // Composite should be preserved
    expect(psd2.imageData).toBeDefined();
    expect(psd2.imageData!.width).toBe(psd1.imageData!.width);
    expect(psd2.imageData!.height).toBe(psd1.imageData!.height);
  });

  test('PSD export with large document dimensions', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    // Create a new document with custom size
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await acceptDiscardPrompt(page);
    await page.getByTestId('new-image-width-input').fill('1600');
    await page.getByTestId('new-image-height-input').fill('1200');
    await page.getByTestId('new-image-dialog-submit-button').click();

    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const documentSize = await readWorkspaceDocumentSize(page, 'large-doc-test');
    expect(documentSize.width).toBe(1600);
    expect(documentSize.height).toBe(1200);

    // Draw content using drawWorkflowStroke which properly calculates clips
    await drawWorkflowStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 1500, y: 100 }, 20);
    await drawWorkflowStroke(page, box, documentSize, '#102010', { x: 100, y: 600 }, { x: 1500, y: 600 }, 20);

    // Export PSD
    const downloadDirectory = await prepareExportDownloadDirectory(testInfo);
    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'large-doc-test', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    // Verify large document PSD
    initializePsdCanvas();
    const file = await readFile(psdTarget);
    await verifyExportContainer(psdFormat, file, await readCanvasDataUrl(page));
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    expect(psd.width).toBe(1600);
    expect(psd.height).toBe(1200);
    expect(psd.children!.length).toBe(3); // Blank 1 + 2 strokes
    expect(psd.imageData!.width).toBe(1600);
    expect(psd.imageData!.height).toBe(1200);

    const compositeInk = await measureInk(toImageDataResult(psd.imageData!));
    expect(compositeInk).not.toBeNull();
    expect(compositeInk!.pixelCount).toBeGreaterThan(200);
  });

  test('PSD export: verify layer bounds and clipping', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupWorkflowDocument(page, testInfo);

    // Draw a small element in the center
    await drawWorkflowStroke(page, box, documentSize, '#201010', { x: 350, y: 250 }, { x: 450, y: 350 });

    const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
    await openSaveDialog(page);
    await fillSaveDialog(page, 'bounds-test', psdFormat.label);
    const psdDownload = await submitSaveDialogForDownload(page, psdFormat);

    const psdTarget = path.join(downloadDirectory, path.basename(psdDownload.suggestedFilename()));
    await psdDownload.saveAs(psdTarget);
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    initializePsdCanvas();
    const file = await readFile(psdTarget);
    await verifyExportContainer(psdFormat, file, await readCanvasDataUrl(page));
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    const layers = psd.children ?? [];
    const drawLayer = layers.find((l) => l.name === 'draw 2');
    expect(drawLayer).toBeDefined();
    if (!drawLayer) return;

    const layerLeft = drawLayer.left!;
    const layerTop = drawLayer.top!;
    const layerRight = drawLayer.right!;
    const layerBottom = drawLayer.bottom!;

    // Layer bounds should contain the drawn area
    // The stroke goes from (350,250) to (450,350) with 10px width
    // So bounds should be approximately that region
    expect(layerLeft).toBeLessThanOrEqual(360);
    expect(layerTop).toBeLessThanOrEqual(260);
    expect(layerRight).toBeGreaterThanOrEqual(440);
    expect(layerBottom).toBeGreaterThanOrEqual(340);

    // Bounds should be within document
    expect(layerLeft).toBeGreaterThanOrEqual(0);
    expect(layerTop).toBeGreaterThanOrEqual(0);
    expect(layerRight).toBeLessThanOrEqual(WORKFLOW_DOCUMENT_WIDTH);
    expect(layerBottom).toBeLessThanOrEqual(WORKFLOW_DOCUMENT_HEIGHT);

    // Layer dimensions should be reasonable
    const layerWidth = layerRight - layerLeft;
    const layerHeight = layerBottom - layerTop;
    expect(layerWidth).toBeGreaterThan(50);
    expect(layerWidth).toBeLessThan(200);
    expect(layerHeight).toBeGreaterThan(50);
    expect(layerHeight).toBeLessThan(200);
  });
});
