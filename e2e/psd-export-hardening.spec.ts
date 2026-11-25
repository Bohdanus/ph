import { expect, test, type Page, type TestInfo } from './fixtures/extended-test';
import {
  getWorkspaceCanvas,
  drawLineFromDocument,
  waitForCanvasRedraw,
  viewportClip,
  readWorkspaceDocumentSize,
  documentToCanvasOffset,
} from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { expectNoDiscardPrompt } from './helpers/discard-prompt';
import {
  openSaveDialog,
  fillSaveDialog,
  submitSaveDialogForDownload,
  exportFormats,
  prepareExportDownloadDirectory,
  verifyExportContainer,
} from './export/helpers';
import { INTEGRATION_TEST_TIMEOUT_MS } from './export/helpers';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readPsd, initializeCanvas, writePsdBuffer } from 'ag-psd';

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
 * PSD Export Hardening Tests
 *
 * These tests focus on verifying the PSD export produces files that:
 * 1. Are valid PSD files per the Adobe specification
 * 2. Preserve all layer properties (names, order, opacity, blend modes, visibility)
 * 3. Contain correct pixel data in each layer and the composite
 * 4. Have proper channel data (RGB + alpha)
 * 5. Can be round-tripped through ag-psd write/read
 * 6. Handle edge cases: empty layers, large documents, various blend modes
 */

const PSD_TEST_WIDTH = 800;
const PSD_TEST_HEIGHT = 600;

async function setupPsdTest(page: Page, testInfo: TestInfo) {
  const downloadDirectory = await prepareExportDownloadDirectory(testInfo);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  const documentSize = await readWorkspaceDocumentSize(page, 'setupPsdTest');
  expect(documentSize.width).toBe(PSD_TEST_WIDTH);
  expect(documentSize.height).toBe(PSD_TEST_HEIGHT);

  return { box, documentSize, downloadDirectory };
}

async function drawStroke(
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
  await drawLineFromDocument(page, box, start.x, start.y, end.x, end.y, { steps }, documentSize);

  const startCanvas = documentToCanvasOffset(box, start.x, start.y, documentSize);
  const endCanvas = documentToCanvasOffset(box, end.x, end.y, documentSize);
  await waitForCanvasRedraw(page, box, {
    clip: viewportClip({
      x: box.x + Math.floor(Math.min(startCanvas.x, endCanvas.x)) - 20,
      y: box.y + Math.floor(Math.min(startCanvas.y, endCanvas.y)) - 20,
      width: Math.ceil(Math.abs(endCanvas.x - startCanvas.x)) + 40,
      height: Math.ceil(Math.abs(endCanvas.y - startCanvas.y)) + 40,
    }),
  });
}

async function exportPsd(
  page: Page,
  downloadDirectory: string,
  filename: string,
  options: { expectDrawing?: boolean } = {}
): Promise<string> {
  const sourceDataUrl = await getWorkspaceCanvas(page).evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL('image/png')
  );
  const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;
  await openSaveDialog(page);
  await fillSaveDialog(page, filename, psdFormat.label);
  const download = await submitSaveDialogForDownload(page, psdFormat);
  const target = path.join(downloadDirectory, path.basename(download.suggestedFilename()));
  await download.saveAs(target);
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
  if (options.expectDrawing !== false) await verifyExportContainer(psdFormat, await readFile(target), sourceDataUrl);
  return target;
}

function verifyPsdBasics(psd: any, expectedWidth: number, expectedHeight: number, expectedLayerCount: number) {
  expect(psd.width).toBe(expectedWidth);
  expect(psd.height).toBe(expectedHeight);
  expect(psd.colorMode).toBe(3); // RGB
  expect(psd.bitsPerChannel).toBe(8);
  expect(psd.channels).toBe(3);
  expect(psd.children!.length).toBe(expectedLayerCount);
  expect(psd.imageData).toBeDefined();
  expect(psd.imageData!.width).toBe(expectedWidth);
  expect(psd.imageData!.height).toBe(expectedHeight);
}

function verifyLayerPixels(layer: any, layerName: string) {
  expect(layer.imageData, `Layer "${layerName}" must have imageData`).toBeDefined();
  expect(layer.imageData!.width).toBeGreaterThan(0);
  expect(layer.imageData!.height).toBeGreaterThan(0);
  const { data } = layer.imageData!;
  expect(data.length).toBe(layer.imageData!.width * layer.imageData!.height * 4);

  // Verify layer has non-zero pixel data
  let hasNonZero = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0 || data[i + 3] > 0) {
      hasNonZero = true;
      break;
    }
  }
  expect(hasNonZero).toBe(true);
}

function expectCompositeMatchesDisjointNormalLayers(psd: any, expectedLayerNames: string[]) {
  const layers = psd.children ?? [];
  expect(layers.map((layer: any) => layer.name)).toEqual(expectedLayerNames);
  const background = layers[0];
  expect(background.name).toBe('Blank 1');
  expect(background.left).toBe(0);
  expect(background.top).toBe(0);
  expect(background.right).toBe(psd.width);
  expect(background.bottom).toBe(psd.height);
  expect(background.opacity).toBe(1);
  expect(background.hidden).toBe(false);
  expect(background.clipping).toBe(false);
  expect(background.blendMode).toBe('normal');
  expect(background.imageData, 'Blank 1 must have a decoded raster').toBeDefined();
  expect(background.imageData!.width).toBe(psd.width);
  expect(background.imageData!.height).toBe(psd.height);
  const backgroundData = background.imageData!.data;
  let backgroundIsOpaqueWhite = true;
  for (let offset = 0; offset < backgroundData.length; offset += 4) {
    if (
      backgroundData[offset] !== 255 ||
      backgroundData[offset + 1] !== 255 ||
      backgroundData[offset + 2] !== 255 ||
      backgroundData[offset + 3] !== 255
    ) {
      backgroundIsOpaqueWhite = false;
      break;
    }
  }
  expect(backgroundIsOpaqueWhite, 'Blank 1 must be an opaque white layer in this fixture').toBe(true);

  for (let left = 1; left < layers.length; left++) {
    for (let right = left + 1; right < layers.length; right++) {
      const first = layers[left];
      const second = layers[right];
      const boundsOverlap =
        first.left < second.right &&
        first.right > second.left &&
        first.top < second.bottom &&
        first.bottom > second.top;
      expect(boundsOverlap, `Draw layers "${first.name}" and "${second.name}" must not overlap`).toBe(false);
    }
  }

  const expected = {
    width: psd.width,
    height: psd.height,
    data: new Uint8ClampedArray(psd.width * psd.height * 4),
  };

  for (const layer of layers) {
    expect(layer.imageData, `Layer "${layer.name}" must have imageData`).toBeDefined();
    expect(layer.blendMode, `Layer "${layer.name}" must use normal blending for this oracle`).toBe('normal');
    expect(layer.hidden, `Layer "${layer.name}" must be visible for this oracle`).toBe(false);
    expect(layer.clipping, `Layer "${layer.name}" must not be clipped for this oracle`).toBe(false);

    const { data, width, height } = layer.imageData!;
    expect(width).toBe(layer.right - layer.left);
    expect(height).toBe(layer.bottom - layer.top);
    expect(data.length).toBe(width * height * 4);
    expect(layer.opacity, `Layer "${layer.name}" must preserve full layer opacity`).toBe(1);
    const layerOpacity = layer.opacity;

    // This fixture has one opaque white background and disjoint normal-blend paint layers, so
    // at most one partially transparent paint pixel is composited over the background.
    for (let layerY = 0; layerY < height; layerY++) {
      const documentY = layer.top + layerY;
      if (documentY < 0 || documentY >= psd.height) continue;

      for (let layerX = 0; layerX < width; layerX++) {
        const documentX = layer.left + layerX;
        if (documentX < 0 || documentX >= psd.width) continue;

        const sourceOffset = (layerY * width + layerX) * 4;
        const targetOffset = (documentY * psd.width + documentX) * 4;
        const sourceAlpha = (data[sourceOffset + 3] / 255) * layerOpacity;
        if (sourceAlpha === 0) continue;

        const targetAlpha = expected.data[targetOffset + 3] / 255;
        const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
        for (let channel = 0; channel < 3; channel++) {
          expected.data[targetOffset + channel] = Math.round(
            (data[sourceOffset + channel] * sourceAlpha +
              expected.data[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)) /
              outputAlpha
          );
        }
        expected.data[targetOffset + 3] = Math.round(outputAlpha * 255);
      }
    }
  }

  expectImageDataExactlyEqual(psd.imageData, expected, 'PSD composite reconstructed from its layers');
}

function layerPixelAtDocumentPoint(layer: any, x: number, y: number, label: string) {
  expect(x, `${label}: document x must be inside the layer bounds`).toBeGreaterThanOrEqual(layer.left);
  expect(x, `${label}: document x must be inside the layer bounds`).toBeLessThan(layer.right);
  expect(y, `${label}: document y must be inside the layer bounds`).toBeGreaterThanOrEqual(layer.top);
  expect(y, `${label}: document y must be inside the layer bounds`).toBeLessThan(layer.bottom);
  const localX = x - layer.left;
  const localY = y - layer.top;
  const offset = (localY * layer.imageData.width + localX) * 4;
  return Array.from(layer.imageData.data.slice(offset, offset + 4)) as [number, number, number, number];
}

function expectLayerPixelColor(
  layer: any,
  layerName: string,
  x: number,
  y: number,
  expectedRgb: [number, number, number]
) {
  expect(layer, `Layer "${layerName}" must exist`).toBeDefined();
  const pixel = layerPixelAtDocumentPoint(layer, x, y, `Layer "${layerName}" pixel at (${x},${y})`);
  expect(pixel.slice(0, 3), `Layer "${layerName}" RGB at (${x},${y})`).toEqual(expectedRgb);
  expect(pixel[3], `Layer "${layerName}" alpha at (${x},${y})`).toBeGreaterThan(0);
}

function expectImageDataExactlyEqual(actual: any, expected: any, description: string) {
  expect(actual, `${description}: actual imageData must exist`).toBeDefined();
  expect(expected, `${description}: expected imageData must exist`).toBeDefined();
  expect(actual.width, `${description}: width`).toBe(expected.width);
  expect(actual.height, `${description}: height`).toBe(expected.height);
  expect(actual.data.length, `${description}: RGBA byte length`).toBe(expected.data.length);

  let differentBytes = 0;
  let maximumChannelDifference = 0;
  let firstDifference = -1;
  for (let index = 0; index < actual.data.length; index++) {
    const difference = Math.abs(actual.data[index] - expected.data[index]);
    if (difference === 0) continue;
    differentBytes++;
    maximumChannelDifference = Math.max(maximumChannelDifference, difference);
    if (firstDifference === -1) firstDifference = index;
  }
  expect(
    differentBytes,
    differentBytes === 0
      ? description
      : `${description}: ${differentBytes}/${actual.data.length} RGBA bytes differ (max channel delta ${maximumChannelDifference}; first byte ${firstDifference}: ${actual.data[firstDifference]} vs ${expected.data[firstDifference]})`
  ).toBe(0);
}

function verifyCompositePixels(psd: any) {
  expect(psd.imageData).toBeDefined();
  const { data, width, height } = psd.imageData!;
  expect(data.length).toBe(width * height * 4);
  expect(width).toBe(psd.width);
  expect(height).toBe(psd.height);

  // Verify composite has content
  let hasNonZero = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0 || data[i + 3] > 0) {
      hasNonZero = true;
      break;
    }
  }
  expect(hasNonZero).toBe(true);
}

test.describe('PSD Export Hardening: Core Structure', () => {
  test('PSD file header matches Adobe specification', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 });

    const psdPath = await exportPsd(page, downloadDirectory, 'header-test');
    const file = await readFile(psdPath);

    // Verify raw header bytes
    expect(file.length).toBeGreaterThan(26);
    const signature = file.subarray(0, 4).toString('latin1');
    expect(signature).toBe('8BPS');
    expect(file.readUInt16BE(4)).toBe(1); // version
    expect(file.readUInt16BE(12)).toBe(3); // channels (RGB)
    expect(file.readUInt32BE(14)).toBe(PSD_TEST_HEIGHT);
    expect(file.readUInt32BE(18)).toBe(PSD_TEST_WIDTH);
    expect(file.readUInt16BE(22)).toBe(8); // depth
    expect(file.readUInt16BE(24)).toBe(3); // color mode RGB
  });

  test('PSD layer and mask section exists and has correct structure', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#102010', { x: 200, y: 200 }, { x: 600, y: 200 });

    const psdPath = await exportPsd(page, downloadDirectory, 'layer-mask-section-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    verifyPsdBasics(psd, PSD_TEST_WIDTH, PSD_TEST_HEIGHT, 2);

    // Verify all layers have proper structure
    for (const layer of psd.children!) {
      expect(layer.top).toBeDefined();
      expect(layer.left).toBeDefined();
      expect(layer.bottom).toBeDefined();
      expect(layer.right).toBeDefined();
      expect(layer.blendMode).toBeDefined();
      expect(typeof layer.opacity).toBe('number');
      expect(typeof layer.hidden).toBe('boolean');
      expect(typeof layer.clipping).toBe('boolean');
      verifyLayerPixels(layer, layer.name ?? 'unknown');
    }
  });

  test('PSD color mode data section is correct for RGB', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#101020', { x: 300, y: 300 }, { x: 500, y: 300 });

    const psdPath = await exportPsd(page, downloadDirectory, 'color-mode-test');
    const file = await readFile(psdPath);

    // Color mode data section for RGB should be 4 bytes (length = 0)
    const colorModeDataLength = file.readUInt32BE(26);
    expect(colorModeDataLength).toBe(0);
  });
});

test.describe('PSD Export Hardening: Layer Properties Preservation', () => {
  test('Selected blend modes are preserved in export', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    // Use the actual blend mode values from LAYER_BLEND_MODES (with hyphens)
    // Test a subset to avoid canvas overflow and ensure combobox accessibility
    const blendModes = ['multiply', 'screen', 'overlay', 'color'];
    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    // Draw base layer
    await drawStroke(page, box, documentSize, '#202020', { x: 50, y: 50 }, { x: 750, y: 550 }, 30);

    // Draw one layer per blend mode
    for (let i = 0; i < blendModes.length; i++) {
      const y = 100 + i * 80;
      await drawStroke(page, box, documentSize, '#201010', { x: 200, y }, { x: 600, y });
    }

    const layerRows = page.getByTitle('Drag to reorder');
    const layerNames = await layerRows.allTextContents();

    // Set blend modes on each drawn layer (skip background)
    // layerNames is top-to-bottom: draw 6, draw 5, draw 4, draw 3, draw 2, Blank 1
    // We want to set blend modes on draw 6 through draw 3 (indices 0-3)
    const layerRow = (name: string) => layerRows.filter({ hasText: name });
    for (let i = 0; i < blendModes.length; i++) {
      const layerName = layerNames[i];
      // Select the layer first
      await layerRow(layerName).click();
      const blendModeSelect = page.getByRole('combobox', { name: new RegExp(`Blend mode for ${layerName}`) });
      await expect(blendModeSelect).toBeVisible({ timeout: 15000 });
      await blendModeSelect.selectOption(blendModes[i]);
    }

    const psdPath = await exportPsd(page, downloadDirectory, 'blend-modes-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Verify blend modes preserved (layers are in bottom-to-top order in psd.children)
    const drawnLayers = psd.children!.filter((l: any) => l.name.startsWith('draw '));
    // There are 5 drawn layers: base (draw 2) + 4 blend mode layers (draw 3-6)
    expect(drawnLayers.length).toBe(blendModes.length + 1);

    // The blend modes were set on the top 4 layers (draw 6, 5, 4, 3 in panel order)
    // In PSD bottom-to-top order: draw 2 (base), draw 3, draw 4, draw 5, draw 6
    // The custom blend modes are on draw 3-6 (indices 1-4 in drawnLayers)
    // blendModes were set panel top-to-bottom: draw 6=multiply, draw 5=screen, draw 4=overlay, draw 3=color
    // So in PSD order (bottom-to-top): draw 3=color, draw 4=overlay, draw 5=screen, draw 6=multiply
    expect(drawnLayers[1].blendMode).toBe(blendModes[3]); // draw 3 = color
    expect(drawnLayers[2].blendMode).toBe(blendModes[2]); // draw 4 = overlay
    expect(drawnLayers[3].blendMode).toBe(blendModes[1]); // draw 5 = screen
    expect(drawnLayers[4].blendMode).toBe(blendModes[0]); // draw 6 = multiply
  });

  test('Layer opacity values preserved precisely', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    // Draw multiple layers
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 });
    await drawStroke(page, box, documentSize, '#102010', { x: 100, y: 200 }, { x: 700, y: 200 });
    await drawStroke(page, box, documentSize, '#101020', { x: 100, y: 300 }, { x: 700, y: 300 });
    await drawStroke(page, box, documentSize, '#202008', { x: 100, y: 400 }, { x: 700, y: 400 });

    const layerRows = page.getByTitle('Drag to reorder');
    const layerNames = await layerRows.allTextContents();
    const layerRow = (name: string) => layerRows.filter({ hasText: name });

    // Set specific opacity values on each drawn layer (top to bottom, skip background)
    const opacities = [0.25, 0.5, 0.75, 1.0];
    for (let i = 0; i < Math.min(opacities.length, layerNames.length - 1); i++) {
      // Select the layer first
      await layerRow(layerNames[i]).click();
      // Open layer properties
      await page.locator('details > summary').click();
      const opacitySlider = page.getByRole('slider', { name: 'Layer opacity' });
      await expect(opacitySlider).toBeVisible({ timeout: 10000 });
      await opacitySlider.fill(String(Math.round(opacities[i] * 100)));
      await opacitySlider.press('Tab');
      await expect(opacitySlider).toHaveValue(String(Math.round(opacities[i] * 100)));
    }

    const psdPath = await exportPsd(page, downloadDirectory, 'opacity-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    const drawnLayers = psd.children!.filter((l: any) => l.name.startsWith('draw '));
    // psd.children is bottom-to-top, so drawnLayers is [draw 2, draw 3, draw 4, draw 5]
    // Opacities were set top-to-bottom: draw 5=0.25, draw 4=0.5, draw 3=0.75, draw 2=1.0
    // So verify in reverse order
    const expectedOpacities = [...opacities].reverse(); // [1.0, 0.75, 0.5, 0.25]
    for (let i = 0; i < Math.min(expectedOpacities.length, drawnLayers.length); i++) {
      expect(drawnLayers[i].opacity).toBeCloseTo(expectedOpacities[i], 2);
    }
  });

  test('Layer visibility (hidden/shown) preserved', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 });
    await drawStroke(page, box, documentSize, '#102010', { x: 100, y: 200 }, { x: 700, y: 200 });
    await drawStroke(page, box, documentSize, '#101020', { x: 100, y: 300 }, { x: 700, y: 300 });

    const layerRows = page.getByTitle('Drag to reorder');
    const layerNames = await layerRows.allTextContents();

    // Hide middle layer
    const middleLayer = layerNames[1];
    const visibilityButton = page
      .getByTitle('Drag to reorder')
      .filter({ hasText: middleLayer })
      .getByRole('button', { name: /^(Hide|Show) layer$/ });
    await visibilityButton.click();
    await expect(visibilityButton).toHaveAccessibleName('Show layer');

    const psdPath = await exportPsd(page, downloadDirectory, 'visibility-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    const middlePsdLayer = psd.children!.find((l: any) => l.name === middleLayer);
    expect(middlePsdLayer).toBeDefined();
    expect(middlePsdLayer!.hidden).toBe(true);

    // Other layers should be visible
    for (const layer of psd.children!) {
      if (layer.name && layer.name !== middleLayer && layer.name !== 'Blank 1') {
        expect(layer.hidden).toBe(false);
      }
    }
  });

  test('Layer order preserved exactly', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    // Draw in specific order: red, green, blue, yellow
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 }); // bottom
    await drawStroke(page, box, documentSize, '#102010', { x: 100, y: 200 }, { x: 700, y: 200 });
    await drawStroke(page, box, documentSize, '#101020', { x: 100, y: 300 }, { x: 700, y: 300 });
    await drawStroke(page, box, documentSize, '#202008', { x: 100, y: 400 }, { x: 700, y: 400 }); // top

    // Verify layer panel shows correct order (top to bottom: yellow, blue, green, red, Blank 1)
    const layerRows = page.getByTitle('Drag to reorder');
    const layerNames = await layerRows.allTextContents();
    expect(layerNames[0]).toBe('draw 5'); // yellow (top)
    expect(layerNames[1]).toBe('draw 4'); // blue
    expect(layerNames[2]).toBe('draw 3'); // green
    expect(layerNames[3]).toBe('draw 2'); // red
    expect(layerNames[4]).toBe('Blank 1'); // background

    const psdPath = await exportPsd(page, downloadDirectory, 'order-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Order in PSD children is bottom to top (ag-psd returns bottom-to-top)
    const psdLayerNames = psd.children!.map((l: any) => l.name);
    expect(psdLayerNames[0]).toBe('Blank 1'); // background (bottom)
    expect(psdLayerNames[1]).toBe('draw 2'); // red
    expect(psdLayerNames[2]).toBe('draw 3'); // green
    expect(psdLayerNames[3]).toBe('draw 4'); // blue
    expect(psdLayerNames[4]).toBe('draw 5'); // yellow (top)
  });
});

test.describe('PSD Export Hardening: Pixel Data Integrity', () => {
  test('Each layer contains correct pixel data for its content', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    // Draw distinct lines at known positions (color doesn't matter for pixel data verification)
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 });
    await drawStroke(page, box, documentSize, '#102010', { x: 200, y: 200 }, { x: 200, y: 400 });
    await drawStroke(page, box, documentSize, '#101020', { x: 300, y: 300 }, { x: 500, y: 300 });

    const psdPath = await exportPsd(page, downloadDirectory, 'pixel-data-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Verify each drawn layer has pixel data
    for (const layer of psd.children!) {
      if (layer.name?.startsWith('draw ')) {
        verifyLayerPixels(layer, layer.name ?? 'unknown');
        // Verify layer has non-transparent pixels (alpha > 0)
        const { data } = layer.imageData!;
        let hasOpaque = false;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) {
            hasOpaque = true;
            break;
          }
        }
        expect(hasOpaque).toBe(true);
      }
    }
    expectLayerPixelColor(
      psd.children!.find((layer: any) => layer.name === 'draw 2'),
      'draw 2',
      400,
      100,
      [32, 16, 16]
    );
    expectLayerPixelColor(
      psd.children!.find((layer: any) => layer.name === 'draw 3'),
      'draw 3',
      200,
      300,
      [16, 32, 16]
    );
    expectLayerPixelColor(
      psd.children!.find((layer: any) => layer.name === 'draw 4'),
      'draw 4',
      400,
      300,
      [16, 16, 32]
    );
  });

  test('Composite image is correct flattened representation', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    // Draw non-overlapping shapes
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 300, y: 100 });
    await drawStroke(page, box, documentSize, '#102010', { x: 400, y: 200 }, { x: 600, y: 200 });
    await drawStroke(page, box, documentSize, '#101020', { x: 100, y: 300 }, { x: 300, y: 300 });

    const psdPath = await exportPsd(page, downloadDirectory, 'composite-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    verifyCompositePixels(psd);
    expectCompositeMatchesDisjointNormalLayers(psd, ['Blank 1', 'draw 2', 'draw 3', 'draw 4']);
    expectLayerPixelColor(
      psd.children!.find((layer) => layer.name === 'draw 2'),
      'draw 2',
      200,
      100,
      [32, 16, 16]
    );
    expectLayerPixelColor(
      psd.children!.find((layer) => layer.name === 'draw 3'),
      'draw 3',
      500,
      200,
      [16, 32, 16]
    );
    expectLayerPixelColor(
      psd.children!.find((layer) => layer.name === 'draw 4'),
      'draw 4',
      200,
      300,
      [16, 16, 32]
    );
  });

  test('Alpha channel data is correct', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    await drawStroke(page, box, documentSize, '#201010', { x: 200, y: 200 }, { x: 600, y: 400 });

    const psdPath = await exportPsd(page, downloadDirectory, 'alpha-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    expectCompositeMatchesDisjointNormalLayers(psd, ['Blank 1', 'draw 2']);

    const { data, width, height } = psd.imageData!;
    expect(width).toBe(psd.width);
    expect(height).toBe(psd.height);
    let compositeIsOpaque = true;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) {
        compositeIsOpaque = false;
        break;
      }
    }
    expect(compositeIsOpaque, 'the opaque white Blank 1 must make the PSD composite opaque').toBe(true);

    const paint = psd.children![1];
    const paintData = paint.imageData!.data;
    let hasTransparentPixels = false;
    let hasPaintedPixels = false;
    let hasPartialAlpha = false;
    for (let i = 3; i < paintData.length; i += 4) {
      if (paintData[i] === 0) hasTransparentPixels = true;
      else hasPaintedPixels = true;
      if (paintData[i] > 0 && paintData[i] < 255) hasPartialAlpha = true;
    }
    expect(hasTransparentPixels, 'the paint layer must retain transparency outside the stroke').toBe(true);
    expect(hasPaintedPixels, 'the paint layer must contain the stroke').toBe(true);
    expect(hasPartialAlpha, 'the paint layer must retain antialiased or translucent edge pixels').toBe(true);

    const strokeCenter = layerPixelAtDocumentPoint(paint, 400, 300, 'stroke center');
    expect(strokeCenter.slice(0, 3)).toEqual([32, 16, 16]);
    expect(strokeCenter[3], 'the stroke center must preserve its nonzero alpha').toBeGreaterThan(0);
    const transparentPoint = layerPixelAtDocumentPoint(paint, 200, 390, 'point away from stroke');
    expect(transparentPoint[3]).toBe(0);
  });
});

test.describe('PSD Export Hardening: Edge Cases', () => {
  test('Empty layer (no strokes) exports correctly', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { downloadDirectory } = await setupPsdTest(page, testInfo);

    // Don't draw anything - just export blank document
    const psdPath = await exportPsd(page, downloadDirectory, 'empty-test', { expectDrawing: false });
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    verifyPsdBasics(psd, PSD_TEST_WIDTH, PSD_TEST_HEIGHT, 1);
    expect(psd.children!.length).toBe(1);
    expect(psd.children![0].name).toBe('Blank 1');

    // Blank layer should have image data (white/transparent)
    verifyLayerPixels(psd.children![0], 'Blank 1');
    verifyCompositePixels(psd);
  });

  test('Layer with zero opacity still exports pixel data', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    await drawStroke(page, box, documentSize, '#201010', { x: 200, y: 200 }, { x: 600, y: 400 });

    const layerRows = page.getByTitle('Drag to reorder');
    const layerNames = await layerRows.allTextContents();
    const topLayer = layerNames[0];

    // Set opacity to 0
    await page.locator('details > summary').click();
    const opacitySlider = page.getByRole('slider', { name: 'Layer opacity' });
    await opacitySlider.fill('0');
    await opacitySlider.press('Tab');
    await expect(opacitySlider).toHaveValue('0');

    const psdPath = await exportPsd(page, downloadDirectory, 'zero-opacity-test', { expectDrawing: false });
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    const zeroOpacityLayer = psd.children!.find((l: any) => l.name === topLayer);
    expect(zeroOpacityLayer).toBeDefined();
    expect(zeroOpacityLayer!.opacity).toBe(0);
    verifyLayerPixels(zeroOpacityLayer!, topLayer);
  });

  test('Large 2000 by 1500 document exports correctly', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    // Create larger document
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await expectNoDiscardPrompt(page);
    await page.getByTestId('new-image-width-input').fill('2000');
    await page.getByTestId('new-image-height-input').fill('1500');
    await page.getByTestId('new-image-dialog-submit-button').click();

    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const documentSize = await readWorkspaceDocumentSize(page, 'large-doc-test');
    expect(documentSize.width).toBe(2000);
    expect(documentSize.height).toBe(1500);

    const downloadDirectory = await prepareExportDownloadDirectory(testInfo);

    // Draw content
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 1900, y: 100 });
    await drawStroke(page, box, documentSize, '#102010', { x: 100, y: 750 }, { x: 1900, y: 750 });
    const sourceDataUrl = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));

    const psdPath = await exportPsd(page, downloadDirectory, 'large-doc-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });
    await verifyExportContainer(
      exportFormats.find((f) => f.extension === '.psd')!,
      file,
      sourceDataUrl
    );

    expect(psd.width).toBe(2000);
    expect(psd.height).toBe(1500);
    expect(psd.children!.length).toBeGreaterThanOrEqual(3);
    expect(psd.imageData!.width).toBe(2000);
    expect(psd.imageData!.height).toBe(1500);
    verifyCompositePixels(psd);
  });

  test('Multiple exports in sequence produce consistent results', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    await drawStroke(page, box, documentSize, '#201008', { x: 150, y: 150 }, { x: 650, y: 450 });

    // Export twice
    const psdPath1 = await exportPsd(page, downloadDirectory, 'consistency-test-1');
    const psdPath2 = await exportPsd(page, downloadDirectory, 'consistency-test-2');

    const file1 = await readFile(psdPath1);
    const file2 = await readFile(psdPath2);

    initializePsdCanvas();
    const psd1 = readPsd(new Uint8Array(file1), { useImageData: true, skipCompositeImageData: false });
    const psd2 = readPsd(new Uint8Array(file2), { useImageData: true, skipCompositeImageData: false });

    // Structure should be identical
    expect(psd2.width).toBe(psd1.width);
    expect(psd2.height).toBe(psd1.height);
    expect(psd2.children!.length).toBe(psd1.children!.length);
    expectImageDataExactlyEqual(psd2.imageData, psd1.imageData, 'Repeated exports of an unchanged document');

    for (let i = 0; i < psd1.children!.length; i++) {
      const l1 = psd1.children![i];
      const l2 = psd2.children![i];
      expect(l2.name).toBe(l1.name ?? '');
      expect(l2.blendMode).toBe(l1.blendMode);
      expect(l2.opacity!).toBeCloseTo(l1.opacity!, 5);
      expect(l2.hidden).toBe(l1.hidden);
      expect(l2.top!).toBe(l1.top!);
      expect(l2.left!).toBe(l1.left!);
      expect(l2.bottom!).toBe(l1.bottom!);
      expect(l2.right!).toBe(l1.right!);
    }

    // Pixel data should be equivalent (allowing for encoding differences)
    const { data: d1 } = psd1.imageData!;
    const { data: d2 } = psd2.imageData!;
    expect(d2.length).toBe(d1.length);

    // Compare pixel values - should be very close
    let diffCount = 0;
    for (let i = 0; i < d1.length; i++) {
      if (Math.abs(d1[i] - d2[i]) > 1) diffCount++;
    }
    // Allow small differences due to encoding
    expect(diffCount / d1.length).toBeLessThan(0.01);
  });
});

test.describe('PSD Export Hardening: Round-trip Compatibility', () => {
  test('Exported PSD can be read and written back by ag-psd', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 });
    await drawStroke(page, box, documentSize, '#102010', { x: 100, y: 300 }, { x: 700, y: 300 });

    const psdPath = await exportPsd(page, downloadDirectory, 'roundtrip-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd1 = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Write back
    const roundTripBuffer = writePsdBuffer(psd1);

    // Read again
    const psd2 = readPsd(new Uint8Array(roundTripBuffer), {
      useImageData: true,
      skipCompositeImageData: false,
    });

    // Verify all properties preserved
    expect(psd2.width).toBe(psd1.width);
    expect(psd2.height).toBe(psd1.height);
    expect(psd2.colorMode).toBe(psd1.colorMode);
    expect(psd2.bitsPerChannel).toBe(psd1.bitsPerChannel);
    expect(psd2.channels).toBe(psd1.channels);
    expect(psd2.children!.length).toBe(psd1.children!.length);
    expectImageDataExactlyEqual(psd2.imageData, psd1.imageData, 'ag-psd PSD read/write round-trip');

    for (let i = 0; i < psd1.children!.length; i++) {
      const l1 = psd1.children![i];
      const l2 = psd2.children![i];
      expect(l2.name).toBe(l1.name ?? '');
      expect(l2.blendMode).toBe(l1.blendMode);
      expect(l2.opacity!).toBeCloseTo(l1.opacity!, 5);
      expect(l2.hidden).toBe(l1.hidden);
      expect(l2.clipping).toBe(l1.clipping);
      expect(l2.top!).toBe(l1.top!);
      expect(l2.left!).toBe(l1.left!);
      expect(l2.bottom!).toBe(l1.bottom!);
      expect(l2.right!).toBe(l1.right!);
    }

    // Composite preserved
    expect(psd2.imageData).toBeDefined();
    expect(psd2.imageData!.width).toBe(psd1.imageData!.width);
    expect(psd2.imageData!.height).toBe(psd1.imageData!.height);
  });

  test('Selected blend modes survive an ag-psd round-trip', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    // Use the actual blend mode values from LAYER_BLEND_MODES (with hyphens)
    // Test a subset to avoid canvas overflow
    const blendModes = [
      'source-over',
      'darken',
      'multiply',
      'color-burn',
      'lighten',
      'screen',
      'color-dodge',
      'overlay',
    ];

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    await drawStroke(page, box, documentSize, '#202020', { x: 50, y: 50 }, { x: 750, y: 550 }, 30);

    for (let i = 0; i < blendModes.length; i++) {
      const y = 100 + i * 40;
      await drawStroke(page, box, documentSize, '#201010', { x: 100, y }, { x: 700, y });
    }

    const layerRows = page.getByTitle('Drag to reorder');
    const layerNames = await layerRows.allTextContents();
    const layerRow = (name: string) => layerRows.filter({ hasText: name });

    for (let i = 0; i < blendModes.length; i++) {
      await layerRow(layerNames[i]).click();
      const blendModeSelect = page.getByRole('combobox', { name: new RegExp(`Blend mode for ${layerNames[i]}`) });
      await expect(blendModeSelect).toBeVisible({ timeout: 15000 });
      await blendModeSelect.selectOption(blendModes[i]);
    }

    const psdPath = await exportPsd(page, downloadDirectory, 'all-blend-modes-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd1 = readPsd(new Uint8Array(file), { useImageData: true, skipCompositeImageData: false });
    const roundTripBuffer = writePsdBuffer(psd1);
    const psd2 = readPsd(new Uint8Array(roundTripBuffer), { useImageData: true, skipCompositeImageData: false });

    const drawnLayers2 = psd2.children!.filter((l: any) => l.name.startsWith('draw '));
    // There are 9 drawn layers: base (draw 2) + 8 blend mode layers (draw 3-10)
    expect(drawnLayers2.length).toBe(blendModes.length + 1);

    // Map blend mode values to PSD keys (what ag-psd reads)
    const blendModeToPsdKey: Record<string, string> = {
      'source-over': 'normal',
      darken: 'darken',
      multiply: 'multiply',
      'color-burn': 'color burn',
      lighten: 'lighten',
      screen: 'screen',
      'color-dodge': 'color dodge',
      overlay: 'overlay',
      'soft-light': 'soft light',
      'hard-light': 'hard light',
      difference: 'difference',
      exclusion: 'exclusion',
      hue: 'hue',
      saturation: 'saturation',
      color: 'color',
      luminosity: 'luminosity',
    };

    const expectedPsdKeys = blendModes.map((m) => blendModeToPsdKey[m]);

    // The blend modes were set on the top 8 layers (draw 10 through draw 3 in panel order)
    // In PSD bottom-to-top order: draw 2 (base), draw 3, draw 4, ..., draw 10
    // The custom blend modes are on draw 3-10 (indices 1-8 in drawnLayers2)
    // blendModes were set panel top-to-bottom: draw 10=overlay, draw 9=color-dodge, draw 8=screen, draw 7=lighten, draw 6=color-burn, draw 5=multiply, draw 4=darken, draw 3=source-over
    // So in PSD order (bottom-to-top): draw 3=source-over, draw 4=darken, draw 5=multiply, draw 6=color-burn, draw 7=lighten, draw 8=screen, draw 9=color-dodge, draw 10=overlay
    expect(drawnLayers2[1].blendMode).toBe(expectedPsdKeys[7]); // draw 3 = source-over -> normal
    expect(drawnLayers2[2].blendMode).toBe(expectedPsdKeys[6]); // draw 4 = darken -> darken
    expect(drawnLayers2[3].blendMode).toBe(expectedPsdKeys[5]); // draw 5 = multiply -> multiply
    expect(drawnLayers2[4].blendMode).toBe(expectedPsdKeys[4]); // draw 6 = color-burn -> color burn
    expect(drawnLayers2[5].blendMode).toBe(expectedPsdKeys[3]); // draw 7 = lighten -> lighten
    expect(drawnLayers2[6].blendMode).toBe(expectedPsdKeys[2]); // draw 8 = screen -> screen
    expect(drawnLayers2[7].blendMode).toBe(expectedPsdKeys[1]); // draw 9 = color-dodge -> color dodge
    expect(drawnLayers2[8].blendMode).toBe(expectedPsdKeys[0]); // draw 10 = overlay -> overlay
  });
});

test.describe('PSD Export Hardening: Format Compliance', () => {
  test('PSD signature and version are correct', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 200, y: 100 });

    const psdPath = await exportPsd(page, downloadDirectory, 'signature-test');
    const file = await readFile(psdPath);

    // Check signature
    expect(file.subarray(0, 4).toString('latin1')).toBe('8BPS');
    // Check version
    expect(file.readUInt16BE(4)).toBe(1);
    // Check reserved bytes are zero
    for (let i = 6; i < 12; i++) {
      expect(file[i]).toBe(0);
    }
  });

  test('PSD channel count is 3 for RGB', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 200, y: 100 });

    const psdPath = await exportPsd(page, downloadDirectory, 'channels-test');
    const file = await readFile(psdPath);

    expect(file.readUInt16BE(12)).toBe(3);
  });

  test('PSD depth is 8 bits per channel', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 200, y: 100 });

    const psdPath = await exportPsd(page, downloadDirectory, 'depth-test');
    const file = await readFile(psdPath);

    expect(file.readUInt16BE(22)).toBe(8);
  });

  test('PSD color mode is 3 (RGB)', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 200, y: 100 });

    const psdPath = await exportPsd(page, downloadDirectory, 'color-mode-test');
    const file = await readFile(psdPath);

    expect(file.readUInt16BE(24)).toBe(3);
  });

  test('PSD layer count includes background and all drawn layers', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);

    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 200, y: 100 });
    await drawStroke(page, box, documentSize, '#102010', { x: 100, y: 200 }, { x: 200, y: 200 });
    await drawStroke(page, box, documentSize, '#101020', { x: 100, y: 300 }, { x: 200, y: 300 });

    const psdPath = await exportPsd(page, downloadDirectory, 'layer-count-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), { useImageData: true, skipCompositeImageData: false });

    // Background + 3 drawn layers
    expect(psd.children!.length).toBe(4);
  });

  test('PSD layer records have valid channel data lengths', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { box, documentSize, downloadDirectory } = await setupPsdTest(page, testInfo);
    await drawStroke(page, box, documentSize, '#201010', { x: 100, y: 100 }, { x: 700, y: 100 });

    const psdPath = await exportPsd(page, downloadDirectory, 'channel-lengths-test');
    const file = await readFile(psdPath);

    initializePsdCanvas();
    const psd = readPsd(new Uint8Array(file), { useImageData: true, skipCompositeImageData: false });

    for (const layer of psd.children!) {
      expect(layer.imageData).toBeDefined();
      const { data, width, height } = layer.imageData!;
      // Each layer should have RGBA data
      expect(data.length).toBe(width * height * 4);
      // Channel data should not be all zeros for drawn layers
      if (layer.name?.startsWith('draw ')) {
        let nonZero = false;
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== 0) {
            nonZero = true;
            break;
          }
        }
        expect(nonZero).toBe(true);
      }
    }
  });
});
