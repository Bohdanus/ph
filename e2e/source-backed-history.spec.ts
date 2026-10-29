import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { initializeCanvas, readPsd } from 'ag-psd';
import { expect, test, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { getRedoButton, getUndoButton } from './helpers/history-helpers';
import { fillSaveDialog, openSaveDialog, submitSaveDialogForDownload } from './export/helpers';

function expectedPixels(background: 'white' | 'transparent' = 'white') {
  const expected = Buffer.alloc(800 * 600 * 4, background === 'white' ? 255 : 0);
  for (let y = 288; y < 312; y += 1) {
    for (let x = 384; x < 416; x += 1) {
      const offset = (y * 800 + x) * 4;
      expected[offset] = x < 400 ? 255 : 0;
      expected[offset + 1] = 0;
      expected[offset + 2] = x < 400 ? 0 : 255;
      expected[offset + 3] = 255;
    }
  }
  return expected;
}

function expectedLayerPixels() {
  const expected = Buffer.alloc(32 * 24 * 4, 255);
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const offset = (y * 32 + x) * 4;
      expected[offset] = x < 16 ? 255 : 0;
      expected[offset + 1] = 0;
      expected[offset + 2] = x < 16 ? 0 : 255;
    }
  }
  return expected;
}

async function pasteDeterministicRaster(page: Page) {
  // Supply a deterministic system clipboard without changing the host clipboard.
  await page.evaluate(async () => {
    const source = document.createElement('canvas');
    source.width = 32;
    source.height = 24;
    const context = source.getContext('2d');
    if (!context) throw new Error('Missing source context');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 16, 24);
    context.fillStyle = '#0000ff';
    context.fillRect(16, 0, 16, 24);
    const blob = await new Promise<Blob>((resolve, reject) => {
      source.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('Missing clipboard PNG'));
      }, 'image/png');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [{ types: ['image/png'], getType: async () => blob }] },
    });
  });
  await page.keyboard.press('ControlOrMeta+v');
}

test('a pasted raster preserves exact pixels behind the source-backed cursor gate', async ({ page }) => {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const baseline = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const rows = page.getByTestId('layer-row');
  await expect(rows).toHaveCount(1);

  await pasteDeterministicRaster(page);
  await expect(rows).toHaveCount(2);
  const strip = page.getByTestId('dev-status-strip');
  await expect(strip).toHaveAttribute('data-status', 'current');
  await expect(strip).toHaveAttribute('data-presentation-status', 'unpublished');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
  const pasted = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  expect(pasted).not.toEqual(baseline);

  await openSaveDialog(page);
  await fillSaveDialog(page, 'pasted-raster', 'Photoshop PSD (layers)');
  const psdDownload = await submitSaveDialogForDownload(page, {
    label: 'PSD',
    extension: '.psd',
    verification: 'container',
  });
  const psdPath = await psdDownload.path();
  if (!psdPath) throw new Error('Missing downloaded PSD');
  initializeCanvas(
    () => {
      throw new Error('PSD decoding must use ImageData');
    },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' })
  );
  const psd = readPsd(new Uint8Array(await readFile(psdPath)), { useImageData: true });
  expect({ width: psd.width, height: psd.height }).toEqual({ width: 800, height: 600 });
  expect(psd.children).toHaveLength(2);
  if (!psd.imageData) throw new Error('Missing PSD composite');
  expect(Buffer.from(psd.imageData.data).equals(expectedPixels()), 'PSD composite pixels must match the source').toBe(
    true
  );
  const pastedLayer = psd.children!.find((layer) => layer.left === 384 && layer.top === 288);
  expect(pastedLayer?.imageData).toMatchObject({ width: 32, height: 24 });
  if (!pastedLayer?.imageData) throw new Error('Missing pasted PSD layer pixels');
  expect(
    Buffer.from(pastedLayer.imageData.data).equals(expectedLayerPixels()),
    'PSD layer pixels must remain exact'
  ).toBe(true);

  await getUndoButton(page).click();
  await expect(rows).toHaveCount(1);
  await expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', 'ownership-unproven');
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(baseline);
  await getRedoButton(page).click();
  await expect(rows).toHaveCount(2);
  await expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', 'ownership-unproven');
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(pasted);

  await openSaveDialog(page);
  await fillSaveDialog(page, 'pasted-raster', 'PNG');
  const download = await submitSaveDialogForDownload(page, {
    label: 'PNG',
    extension: '.png',
    verification: 'browser-pixels',
  });
  const filePath = await download.path();
  if (!filePath) throw new Error('Missing downloaded PNG');
  const { data, info } = await sharp(await readFile(filePath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect({ width: info.width, height: info.height, channels: info.channels }).toEqual({
    width: 800,
    height: 600,
    channels: 4,
  });
  expect(data.equals(expectedPixels()), 'PNG must contain the exact independently specified document pixels').toBe(
    true
  );
});

test('disabling the default blank history row allows one durable create at its append cursor', async ({ page }) => {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const rows = page.getByTitle('Click to go back to this state');
  await expect(rows).toHaveCount(1);
  const openingRow = rows.last();
  await expect(openingRow).toContainText('new layer');
  await expect(openingRow.getByTitle('Current state')).toBeVisible();

  await openingRow.getByTitle('Disable history item').click();
  await expect(openingRow.getByTitle('Enable history item')).toBeVisible();
  await expect(openingRow.getByTitle('Current state')).toBeVisible();
  await expect(rows).toHaveCount(1);

  const expectedEmptyPixels = Buffer.alloc(800 * 600 * 4);
  await expect
    .poll(async () => {
      const dataUrl = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
      const pixels = await sharp(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
        .ensureAlpha()
        .raw()
        .toBuffer();
      return pixels.equals(expectedEmptyPixels);
    })
    .toBe(true);
  const emptyStateDataUrl = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const emptyStatePixels = await sharp(Buffer.from(emptyStateDataUrl.split(',')[1]!, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect({
    width: emptyStatePixels.info.width,
    height: emptyStatePixels.info.height,
    channels: emptyStatePixels.info.channels,
  }).toEqual({
    width: 800,
    height: 600,
    channels: 4,
  });
  expect(
    emptyStatePixels.data.equals(expectedEmptyPixels),
    'disabling the blank root must leave an exact transparent document'
  ).toBe(true);

  const strip = page.getByTestId('dev-status-strip');
  await expect(strip).toHaveAttribute('data-status', 'current');
  await pasteDeterministicRaster(page);
  await expect(rows).toHaveCount(2);
  const pastedRow = rows.first();
  await expect(pastedRow.getByTitle('Current state')).toBeVisible();
  await expect(openingRow.getByTitle('Enable history item')).toBeVisible();
  await expect(strip).toHaveAttribute('data-status', 'current');
  await expect(strip).toHaveAttribute('data-presentation-status', 'durable');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
  await expect(canvas).toHaveAttribute('data-presentation-paint-source', 'durable');
  await expect(canvas).toHaveAttribute('data-presentation-paint-cursor', '1');

  const pastedDataUrl = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const pastedPixels = await sharp(Buffer.from(pastedDataUrl.split(',')[1]!, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect({
    width: pastedPixels.info.width,
    height: pastedPixels.info.height,
    channels: pastedPixels.info.channels,
  }).toEqual({
    width: 800,
    height: 600,
    channels: 4,
  });
  expect(
    pastedPixels.data.equals(expectedPixels('transparent')),
    'durable canvas pixels must match the transparent document'
  ).toBe(true);

  await openSaveDialog(page);
  await fillSaveDialog(page, 'pasted-raster-empty-bedrock', 'Photoshop PSD (layers)');
  const psdDownload = await submitSaveDialogForDownload(page, {
    label: 'PSD',
    extension: '.psd',
    verification: 'container',
  });
  const psdPath = await psdDownload.path();
  if (!psdPath) throw new Error('Missing downloaded PSD');
  initializeCanvas(
    () => {
      throw new Error('PSD decoding must use ImageData');
    },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' })
  );
  const psd = readPsd(new Uint8Array(await readFile(psdPath)), { useImageData: true });
  expect({ width: psd.width, height: psd.height }).toEqual({ width: 800, height: 600 });
  expect(psd.children).toHaveLength(1);
  if (!psd.imageData) throw new Error('Missing PSD composite');
  expect(Buffer.from(psd.imageData.data).equals(expectedPixels('transparent'))).toBe(true);
  const pastedLayer = psd.children![0];
  expect({ left: pastedLayer.left, top: pastedLayer.top }).toEqual({ left: 384, top: 288 });
  expect(pastedLayer.imageData).toMatchObject({ width: 32, height: 24 });
  if (!pastedLayer.imageData) throw new Error('Missing pasted PSD layer pixels');
  expect(Buffer.from(pastedLayer.imageData.data).equals(expectedLayerPixels())).toBe(true);

  await openSaveDialog(page);
  await fillSaveDialog(page, 'pasted-raster-empty-bedrock', 'PNG');
  const pngDownload = await submitSaveDialogForDownload(page, {
    label: 'PNG',
    extension: '.png',
    verification: 'browser-pixels',
  });
  const pngPath = await pngDownload.path();
  if (!pngPath) throw new Error('Missing downloaded PNG');
  const png = await sharp(await readFile(pngPath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect({ width: png.info.width, height: png.info.height, channels: png.info.channels }).toEqual({
    width: 800,
    height: 600,
    channels: 4,
  });
  expect(png.data.equals(expectedPixels('transparent'))).toBe(true);

  await getUndoButton(page).click();
  await expect(rows).toHaveCount(2);
  await expect(openingRow.getByTitle('Enable history item')).toBeVisible();
  await expect(openingRow.getByTitle('Current state')).toBeVisible();
  await expect(pastedRow.getByTitle('Current state')).toHaveCount(0);
  await expect(getRedoButton(page)).toBeEnabled();
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(emptyStateDataUrl);
  await getRedoButton(page).click();
  await expect(rows).toHaveCount(2);
  await expect(openingRow.getByTitle('Enable history item')).toBeVisible();
  await expect(rows.first().getByTitle('Current state')).toBeVisible();
  await expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', 'ownership-unproven');
  await expect(canvas).toHaveAttribute('data-presentation-paint-source', 'legacy');
  await expect(canvas).toHaveAttribute('data-presentation-paint-cursor', '1');
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(pastedDataUrl);
});

test('Background conversion retains exact pixels behind the source-backed cursor gate', async ({ page }) => {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const before = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.getByTestId('layers-convert-background-button').click();
  const strip = page.getByTestId('dev-status-strip');
  await expect(strip).toHaveAttribute('data-status', 'current');
  await expect(strip).toHaveAttribute('data-presentation-status', 'unpublished');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
  await expect(page.getByTitle('Click to go back to this state')).toHaveCount(2);
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(before);
  await getUndoButton(page).click();
  await expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', 'ownership-unproven');
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(before);
  await getRedoButton(page).click();
  await expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', 'ownership-unproven');
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(before);
});
