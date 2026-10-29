import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { initializeCanvas, readPsd } from 'ag-psd';
import { expect, test, type Page } from './fixtures/extended-test';
import { documentToCanvasOffset, drawLine, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { getRedoButton, getUndoButton } from './helpers/history-helpers';
import { openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
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

async function expectedShapePixels(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const expected = document.createElement('canvas');
    expected.width = 800;
    expected.height = 600;
    const context = expected.getContext('2d');
    if (!context) throw new Error('Missing expected shape context');
    context.strokeStyle = '#000000';
    context.lineWidth = 5;
    context.strokeRect(140, 120, 160, 130);
    return expected.toDataURL();
  });
  return sharp(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer();
}

function cropPixels(pixels: Buffer, canvasWidth: number, left: number, top: number, width: number, height: number) {
  const cropped = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = ((top + row) * canvasWidth + left) * 4;
    cropped.set(pixels.subarray(sourceOffset, sourceOffset + width * 4), row * width * 4);
  }
  return cropped;
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

async function readWorkspacePixels(page: Page) {
  const dataUrl = await getWorkspaceCanvas(page).evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  return await sharp(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function openTabletSaveDialog(page: Page) {
  await page.getByTestId('mobile-menu-button').tap();
  await page.getByTestId('mobile-menu-save-button').tap();
  await expect(page.getByTestId('save-dialog')).toBeVisible();
}

async function drawRectangle(page: Page) {
  await openToolFlyout(page, 'shape');
  await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });
  const canvas = getWorkspaceCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The workspace canvas has no box for a Shape Tool drag');
  const start = documentToCanvasOffset(box, 140, 120);
  const end = documentToCanvasOffset(box, 300, 250);
  await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: 10 });
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

test('a Shape Tool create remains ownership-gated with exact pixels and exports', async ({ page }) => {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const historyRows = page.getByTitle('Click to go back to this state');
  await expect(historyRows).toHaveCount(1);
  const openingRow = historyRows.last();
  await expect(openingRow).toContainText('new layer');
  await openingRow.getByTitle('Disable history item').click();
  await expect(openingRow.getByTitle('Enable history item')).toBeVisible();

  const transparentPixels = Buffer.alloc(800 * 600 * 4);
  await expect.poll(async () => (await readWorkspacePixels(page)).data.equals(transparentPixels)).toBe(true);
  const empty = await readWorkspacePixels(page);
  expect({ width: empty.info.width, height: empty.info.height, channels: empty.info.channels }).toEqual({
    width: 800,
    height: 600,
    channels: 4,
  });
  expect(empty.data.equals(transparentPixels), 'the disabled opening row leaves a transparent document').toBe(true);

  const historyCountBeforeShape = await historyRows.count();
  const expectedShape = await expectedShapePixels(page);
  await drawRectangle(page);
  const expectedCursor = historyCountBeforeShape;
  await expect(historyRows.first().getByTitle('Current state')).toBeVisible();
  await expect(historyRows.first()).toContainText('shape');
  await expect(historyRows).toHaveCount(historyCountBeforeShape + 1);
  await expect(openingRow.getByTitle('Enable history item')).toBeVisible();

  const strip = page.getByTestId('dev-status-strip');
  await expect(strip).toHaveAttribute('data-status', 'current');
  await expect(strip).toHaveAttribute('data-presentation-status', 'unpublished');
  await expect(canvas).toHaveAttribute('data-presentation-paint-source', 'legacy');
  await expect(canvas).toHaveAttribute('data-presentation-paint-cursor', String(expectedCursor));
  const shape = await readWorkspacePixels(page);
  expect({ width: shape.info.width, height: shape.info.height, channels: shape.info.channels }).toEqual({
    width: 800,
    height: 600,
    channels: 4,
  });
  expect(shape.data.equals(transparentPixels), 'the committed rectangle changes the document pixels').toBe(false);
  expect(shape.data.equals(expectedShape), 'the entire visible document matches an independent rectangle oracle').toBe(
    true
  );
  const pixelAt = (x: number, y: number) => Buffer.from(shape.data.subarray((y * 800 + x) * 4, (y * 800 + x) * 4 + 4));
  const opaqueBlack = Buffer.from([0, 0, 0, 255]);
  const transparentPixel = Buffer.from([0, 0, 0, 0]);
  expect(pixelAt(220, 120), 'the top edge has its expected opaque black stroke').toEqual(opaqueBlack);
  expect(pixelAt(300, 185), 'the right edge has its expected opaque black stroke').toEqual(opaqueBlack);
  expect(pixelAt(220, 250), 'the bottom edge has its expected opaque black stroke').toEqual(opaqueBlack);
  expect(pixelAt(140, 185), 'the left edge has its expected opaque black stroke').toEqual(opaqueBlack);
  expect(pixelAt(220, 180), 'the rectangle remains unfilled').toEqual(transparentPixel);
  expect(pixelAt(40, 40), 'pixels outside the rectangle remain transparent').toEqual(transparentPixel);

  await openSaveDialog(page);
  await fillSaveDialog(page, 'vector-create-legacy-gate', 'Photoshop PSD (layers)');
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
  expect(
    Buffer.from(psd.imageData.data).equals(expectedShape),
    'PSD composite pixels must match the independent rectangle oracle'
  ).toBe(true);
  const vectorLayer = psd.children![0];
  if (!vectorLayer.imageData) throw new Error('Missing rasterized PSD vector layer pixels');
  const left = vectorLayer.left ?? 0;
  const top = vectorLayer.top ?? 0;
  const { width, height, data } = vectorLayer.imageData;
  const shapeBounds = { left: 136, top: 116, width: 168, height: 138 };
  expect({ left, top, width, height }).toEqual(shapeBounds);
  const expectedShapeLayerPixels = cropPixels(
    expectedShape,
    800,
    shapeBounds.left,
    shapeBounds.top,
    shapeBounds.width,
    shapeBounds.height
  );
  expect(
    Buffer.from(data).equals(expectedShapeLayerPixels),
    'PSD layer pixels must match the independent rectangle oracle crop'
  ).toBe(true);

  await openSaveDialog(page);
  await fillSaveDialog(page, 'vector-create-legacy-gate', 'PNG');
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
  expect(png.data.equals(expectedShape), 'PNG pixels must match the independent rectangle oracle').toBe(true);

  await getUndoButton(page).click();
  await expect.poll(async () => (await readWorkspacePixels(page)).data.equals(transparentPixels)).toBe(true);
  await getRedoButton(page).click();
  await expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
  await expect(strip).toHaveAttribute('data-durable-fallback-reason', 'ownership-unproven');
  await expect(canvas).toHaveAttribute('data-presentation-paint-source', 'legacy');
  await expect(canvas).toHaveAttribute('data-presentation-paint-cursor', String(expectedCursor));
  await expect.poll(async () => (await readWorkspacePixels(page)).data.equals(expectedShape)).toBe(true);
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

test.describe('tablet blank-layer source-backed history', () => {
  test.use({ viewport: { width: 744, height: 1133 }, deviceScaleFactor: 2, hasTouch: true });

  test('a blank-layer append paints and exports exactly after disabling the default blank row', async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();

    const drawer = page.getByTestId('mobile-layers-drawer');
    await page.getByTestId('mobile-layers-toggle-button').tap();
    await expect(drawer).toBeVisible();
    await page.getByTestId('mobile-tab-history').tap();

    const historyList = page.getByRole('list', { name: 'History' });
    const historyRows = historyList.getByRole('listitem');
    await expect(historyRows).toHaveCount(1);
    const rootRow = historyRows.last();
    await expect(rootRow).toContainText('new layer');
    await rootRow.getByRole('button', { name: 'Disable history step' }).tap();
    await expect(rootRow.getByRole('button', { name: 'Enable history step' })).toBeVisible();
    await expect(rootRow.getByText('Current', { exact: true })).toBeVisible();

    const emptyCanvas = await readWorkspacePixels(page);
    const expectedEmptyCanvas = Buffer.alloc(emptyCanvas.info.width * emptyCanvas.info.height * 4);
    expect(emptyCanvas.data.equals(expectedEmptyCanvas), 'the disabled blank root must leave an empty canvas').toBe(
      true
    );

    await page.getByTestId('mobile-tab-layers').tap();
    await page.getByTestId('mobile-add-layer-button').tap();
    await expect(page.getByRole('button', { name: 'Hide Blank 1' })).toBeVisible();
    await expect(canvas).toHaveAttribute('data-presentation-paint-source', 'durable');
    await expect(canvas).toHaveAttribute('data-presentation-paint-cursor', '1');

    await page.getByTestId('mobile-tab-history').tap();
    await expect(historyRows).toHaveCount(2);
    const blankRow = historyRows.first();
    await expect(blankRow.getByText('Current', { exact: true })).toBeVisible();
    await expect(rootRow.getByRole('button', { name: 'Enable history step' })).toBeVisible();

    const blankCanvas = await readWorkspacePixels(page);
    expect({ width: blankCanvas.info.width, height: blankCanvas.info.height }).toEqual({
      width: emptyCanvas.info.width,
      height: emptyCanvas.info.height,
    });
    expect(blankCanvas.data.equals(expectedEmptyCanvas), 'the durable blank layer must remain transparent').toBe(true);
    const blankDataUrl = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());

    await page.getByRole('button', { name: 'Close layers drawer' }).tap();
    await expect(drawer).toBeHidden();
    await openTabletSaveDialog(page);
    await fillSaveDialog(page, 'tablet-blank-source-backed', 'Photoshop PSD (layers)');
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
    const expectedDocumentPixels = Buffer.alloc(800 * 600 * 4);
    expect(Buffer.from(psd.imageData.data).equals(expectedDocumentPixels)).toBe(true);
    const blankLayer = psd.children![0];
    expect(blankLayer.name).toBe('Blank 1');
    expect({ left: blankLayer.left, top: blankLayer.top }).toEqual({ left: 0, top: 0 });
    expect(blankLayer.imageData).toMatchObject({ width: 800, height: 600 });
    if (!blankLayer.imageData) throw new Error('Missing PSD blank-layer pixels');
    expect(Buffer.from(blankLayer.imageData.data).equals(expectedDocumentPixels)).toBe(true);

    await openTabletSaveDialog(page);
    await fillSaveDialog(page, 'tablet-blank-source-backed', 'PNG');
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
    expect(png.data.equals(expectedDocumentPixels)).toBe(true);

    await page.getByTestId('mobile-undo-button').tap();
    await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(blankDataUrl);

    await page.getByTestId('mobile-layers-toggle-button').tap();
    await expect(drawer).toBeVisible();
    await page.getByTestId('mobile-tab-history').tap();
    await expect(rootRow.getByText('Current', { exact: true })).toBeVisible();
    await expect(blankRow.getByText('Current', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close layers drawer' }).tap();

    await page.getByTestId('mobile-redo-button').tap();
    await expect(canvas).toHaveAttribute('data-presentation-paint-source', 'legacy');
    await expect(canvas).toHaveAttribute('data-presentation-paint-cursor', '1');
    await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).toBe(blankDataUrl);

    await page.getByTestId('mobile-layers-toggle-button').tap();
    await expect(drawer).toBeVisible();
    await page.getByTestId('mobile-tab-history').tap();
    await expect(blankRow.getByText('Current', { exact: true })).toBeVisible();
    await expect(rootRow.getByRole('button', { name: 'Enable history step' })).toBeVisible();
  });
});
