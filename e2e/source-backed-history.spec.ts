import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { initializeCanvas, readPsd } from 'ag-psd';
import { expect, test } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { getRedoButton, getUndoButton } from './helpers/history-helpers';
import { fillSaveDialog, openSaveDialog, submitSaveDialogForDownload } from './export/helpers';

function expectedPixels() {
  const expected = Buffer.alloc(800 * 600 * 4, 255);
  for (let y = 288; y < 312; y += 1) {
    for (let x = 384; x < 416; x += 1) {
      const offset = (y * 800 + x) * 4;
      expected[offset] = x < 400 ? 255 : 0;
      expected[offset + 1] = 0;
      expected[offset + 2] = x < 400 ? 0 : 255;
    }
  }
  return expected;
}

test('a pasted raster publishes durably and survives undo, redo, and exact PNG/PSD export', async ({ page }) => {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const baseline = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const rows = page.getByTestId('layer-row');
  await expect(rows).toHaveCount(1);

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
  await expect(rows).toHaveCount(2);
  const strip = page.getByTestId('dev-status-strip');
  await expect(strip).toHaveAttribute('data-presentation-status', 'durable');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
  const createdIds = await strip.getAttribute('data-durable-layer-ids');
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
  const expectedLayer = Buffer.alloc(32 * 24 * 4, 255);
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const offset = (y * 32 + x) * 4;
      expectedLayer[offset] = x < 16 ? 255 : 0;
      expectedLayer[offset + 1] = 0;
      expectedLayer[offset + 2] = x < 16 ? 0 : 255;
    }
  }
  expect(Buffer.from(pastedLayer.imageData.data).equals(expectedLayer), 'PSD layer pixels must remain exact').toBe(
    true
  );

  await getUndoButton(page).click();
  await expect(rows).toHaveCount(1);
  await expect(strip).toHaveAttribute('data-presentation-status', 'durable');
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(baseline);
  await getRedoButton(page).click();
  await expect(rows).toHaveCount(2);
  await expect(strip).toHaveAttribute('data-presentation-status', 'durable');
  await expect(strip).toHaveAttribute('data-durable-layer-ids', createdIds!);
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

test('Background conversion publishes the raster create before navigation', async ({ page }) => {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const before = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await page.getByTestId('layers-convert-background-button').click();
  const strip = page.getByTestId('dev-status-strip');
  await expect(strip).toHaveAttribute('data-presentation-status', 'durable');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
  await expect(page.getByTitle('Click to go back to this state')).toHaveCount(2);
  expect(await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(before);
});
