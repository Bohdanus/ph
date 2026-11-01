/**
 * Ordinary tool commits, undos and redos must preserve the workspace document size.
 * A crop intentionally changes that frame, and undo/redo must restore each respective
 * size; opening a document must use its imported dimensions. These are measured through
 * the real UI, so a re-allocation hidden by runtime `Layer` objects still fails here.
 *
 * Written as a reproduction first (`zzz-probe-`, logged, no assertions) and kept as a
 * regression test once it had caught the defect it was built for. The measurements
 * are the assertions now; the logs stay, because a trajectory is what a future
 * failure needs to be read against.
 */
import path from 'node:path';

import { expect, type Page } from '@playwright/test';

import { test } from './fixtures/extended-test';

import { type BoundingBox, documentToCanvasOffset, drawLine, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

type Size = { width: number; height: number };

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box');
  return box;
}

type DisplayMetrics = {
  canvasBox: BoundingBox;
  canvasStyle: { width: string; height: string; objectFit: string; objectPosition: string };
  fit: { scale: number; offsetX: number; offsetY: number; viewZoom: number; panX: number; panY: number };
  containerViewport: BoundingBox;
  documentRect: { x: number; y: number; width: number; height: number };
  page: { clientWidth: number; clientHeight: number; scrollWidth: number; scrollHeight: number };
};

type PublishedFit = {
  scale: number;
  offsetX: number;
  offsetY: number;
  outerWidth: number;
  outerHeight: number;
  documentWidth: number;
  documentHeight: number;
  rectX: number;
  rectY: number;
  viewZoom: number;
  panX: number;
  panY: number;
};

function cssPixel(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function publishedFit(page: Page): Promise<PublishedFit> {
  return await page.getByTestId('workspace-container').evaluate((node) => {
    const read = (name: string) => {
      const raw = node.getAttribute(name);
      if (raw === null) throw new Error(`The app has not published ${name}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`The app published invalid ${name}: ${raw}`);
      return value;
    };
    return {
      scale: read('data-fit-scale'),
      offsetX: read('data-fit-offset-x'),
      offsetY: read('data-fit-offset-y'),
      outerWidth: read('data-fit-outer-width'),
      outerHeight: read('data-fit-outer-height'),
      documentWidth: read('data-fit-document-width'),
      documentHeight: read('data-fit-document-height'),
      rectX: read('data-fit-rect-x'),
      rectY: read('data-fit-rect-y'),
      viewZoom: read('data-view-effective-zoom'),
      panX: read('data-view-pan-x'),
      panY: read('data-view-pan-y'),
    };
  });
}

/** The rendered document bounds plus the canvas layout and page geometry around it. */
async function displayMetrics(page: Page, documentSize: Size): Promise<DisplayMetrics> {
  const canvas = getWorkspaceCanvas(page);
  const container = page.getByTestId('workspace-container');
  const box = await canvasBox(page);
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
    throw new Error(`The workspace canvas has invalid bounds: ${JSON.stringify(box)}`);
  }
  const canvasStyle = await canvas.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      width: style.width,
      height: style.height,
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
    };
  });
  if (canvasStyle.objectFit !== 'contain') {
    throw new Error(`The workspace canvas uses unexpected object-fit: ${canvasStyle.objectFit}`);
  }
  if (canvasStyle.objectPosition !== '50% 50%') {
    throw new Error(`The workspace canvas uses unexpected object-position: ${canvasStyle.objectPosition}`);
  }

  const rotationAttribute = await page.getByTestId('workspace-container').getAttribute('data-view-rotation');
  if (rotationAttribute === null) throw new Error('The workspace container has no view-rotation measurement');
  const rotation = Number(rotationAttribute);
  if (!Number.isFinite(rotation) || rotation !== 0) {
    throw new Error(`The document bounds probe requires an unrotated view, got ${rotationAttribute}`);
  }

  const containerViewport = await container.evaluate((node) => {
    if (!(node instanceof HTMLElement)) throw new Error('The workspace container is not an HTML element');
    const rect = node.getBoundingClientRect();
    const borderWidth = node.offsetWidth > 0 ? node.offsetWidth : Math.round(rect.width);
    const borderHeight = node.offsetHeight > 0 ? node.offsetHeight : Math.round(rect.height);
    return {
      x: rect.left + node.clientLeft,
      y: rect.top + node.clientTop,
      width: Math.max(0, node.clientWidth + rect.width - borderWidth),
      height: Math.max(0, node.clientHeight + rect.height - borderHeight),
    };
  });
  const expectedFit = {
    documentWidth: documentSize.width,
    documentHeight: documentSize.height,
    rectX: containerViewport.x,
    rectY: containerViewport.y,
    outerWidth: containerViewport.width,
    outerHeight: containerViewport.height,
  };
  const fitSnapshot = async () => {
    const fit = await publishedFit(page);
    return {
      documentWidth: fit.documentWidth,
      documentHeight: fit.documentHeight,
      rectX: fit.rectX,
      rectY: fit.rectY,
      outerWidth: fit.outerWidth,
      outerHeight: fit.outerHeight,
    };
  };
  await expect.poll(fitSnapshot, 'the app-published fit matches the current document and canvas').toEqual(expectedFit);
  const fit = await publishedFit(page);
  if (fit.scale <= 0 || fit.viewZoom <= 0) {
    throw new Error(`The app published an invalid display scale: ${JSON.stringify(fit)}`);
  }
  const viewportCenterX = fit.rectX + fit.outerWidth / 2;
  const viewportCenterY = fit.rectY + fit.outerHeight / 2;
  const documentOriginX = fit.rectX + fit.offsetX;
  const documentOriginY = fit.rectY + fit.offsetY;
  // Main applies translate and scale around the workspace center; rotation is excluded above.
  const documentRect = {
    x: viewportCenterX + fit.panX + (documentOriginX - viewportCenterX) * fit.viewZoom,
    y: viewportCenterY + fit.panY + (documentOriginY - viewportCenterY) * fit.viewZoom,
    width: fit.documentWidth * fit.scale * fit.viewZoom,
    height: fit.documentHeight * fit.scale * fit.viewZoom,
  };
  const pageSize = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  return {
    canvasBox: {
      x: cssPixel(box.x),
      y: cssPixel(box.y),
      width: cssPixel(box.width),
      height: cssPixel(box.height),
    },
    canvasStyle,
    fit: {
      scale: cssPixel(fit.scale),
      offsetX: cssPixel(fit.offsetX),
      offsetY: cssPixel(fit.offsetY),
      viewZoom: cssPixel(fit.viewZoom),
      panX: cssPixel(fit.panX),
      panY: cssPixel(fit.panY),
    },
    containerViewport: {
      x: cssPixel(fit.rectX),
      y: cssPixel(fit.rectY),
      width: cssPixel(fit.outerWidth),
      height: cssPixel(fit.outerHeight),
    },
    documentRect: {
      x: cssPixel(documentRect.x),
      y: cssPixel(documentRect.y),
      width: cssPixel(documentRect.width),
      height: cssPixel(documentRect.height),
    },
    page: pageSize,
  };
}

/** The canvas element's own backing store — the document's pixel dimensions. */
async function backingStore(page: Page): Promise<Size> {
  return await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
}

async function readDocumentPixel(page: Page, point: { x: number; y: number }, documentSize: Size): Promise<number[]> {
  return await getWorkspaceCanvas(page).evaluate(
    (node, input) => {
      const canvas = node as HTMLCanvasElement;
      const probeWindow = window as typeof window & { __canvasGrowthPixelProbe?: HTMLCanvasElement };
      const samplingCanvas = (probeWindow.__canvasGrowthPixelProbe ??= document.createElement('canvas'));
      if (samplingCanvas.width !== canvas.width || samplingCanvas.height !== canvas.height) {
        samplingCanvas.width = canvas.width;
        samplingCanvas.height = canvas.height;
      }
      const context = samplingCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('The workspace canvas has no 2D context');

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, samplingCanvas.width, samplingCanvas.height);
      context.drawImage(canvas, 0, 0);
      const scale = canvas.width / input.documentSize.width;
      if (canvas.height !== input.documentSize.height * scale) {
        throw new Error(`Unexpected workspace backing scale ${scale}`);
      }
      const x = Math.round(input.point.x * scale);
      const y = Math.round(input.point.y * scale);
      return Array.from(context.getImageData(x, y, 1, 1).data);
    },
    { point, documentSize }
  );
}

async function expectDarkDocumentPixel(page: Page, point: { x: number; y: number }, documentSize: Size): Promise<void> {
  await expect
    .poll(async () => {
      const [red = 255, green = 255, blue = 255, alpha = 0] = await readDocumentPixel(page, point, documentSize);
      return alpha > 0 && Math.max(red, green, blue) < 80;
    })
    .toBe(true);
}

/** The Footer's `totalSize` readout, excluding the independent development status seam. */
async function footerDimensions(page: Page): Promise<string> {
  const text = await page.getByTestId('footer-dimensions').textContent();
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

async function dragInDocument(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  // `documentToCanvasOffset` defaults to the SEEDED 800x600 document, so any probe on a
  // document of another size has to pass that size or the gesture lands on the wrong pixels.
  documentSize: Size = { width: 800, height: 600 }
) {
  const box = await canvasBox(page);
  const start = documentToCanvasOffset(box, from.x, from.y, documentSize);
  const end = documentToCanvasOffset(box, to.x, to.y, documentSize);
  await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: 10 });
}

test.describe('document size across many tool commits', () => {
  test('10 rectangle commits, then 10 undos and 10 redos, never move the document size', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });

    const baseline = await backingStore(page);
    const baselineFooter = await footerDimensions(page);
    expect(baselineFooter).toContain(`${baseline.width} × ${baseline.height} px`);
    const baselineDisplay = await displayMetrics(page, baseline);
    // The app boots with one bedrock background layer, so the row count starts at 1 and
    // each shape commit adds one.
    const baselineRows = await page.getByTestId('layer-row').count();
    console.log(
      `[PW-PROBE] baseline backingStore=${JSON.stringify(baseline)} footer="${baselineFooter}" layerRows=${baselineRows}`
    );

    const rows: Array<{ step: string; backingStore: Size; footer: string; layerRows: number }> = [];

    for (let i = 0; i < 10; i += 1) {
      // A 5x2 grid that fits inside 800x600: max corner is (740, 490). A drag that leaves
      // the document is dropped by the app and would read as a failed commit.
      const from = { x: 20 + (i % 5) * 150, y: 20 + Math.floor(i / 5) * 270 };
      const to = { x: from.x + 120, y: from.y + 200 };
      await dragInDocument(page, from, to);
      // The commit is proved by the layer row count, NOT by dragShape's screenshot wait
      // (that clip sees the tool overlay, so it proves the drag and not the commit).
      const expectedRows = baselineRows + 1 + i;
      await expect(page.getByTestId('layer-row'), `commit ${i + 1} did not add a layer`).toHaveCount(expectedRows);
      const size = await backingStore(page);
      const footer = await footerDimensions(page);
      rows.push({ step: `commit-${i + 1}`, backingStore: size, footer, layerRows: expectedRows });
      console.log(
        `[PW-PROBE] commit-${i + 1} backingStore=${JSON.stringify(size)} footer="${footer}" rows=${expectedRows}`
      );
      expect(size, `backing store moved after commit ${i + 1}`).toEqual(baseline);
      expect(footer, `footer totalSize moved after commit ${i + 1}`).toBe(baselineFooter);
      await expect
        .poll(() => displayMetrics(page, baseline), `display geometry after commit ${i + 1}`)
        .toEqual(baselineDisplay);
    }

    for (let k = 0; k < 10; k += 1) {
      await page.keyboard.press('ControlOrMeta+z');
      const expectedRows = baselineRows + 9 - k;
      await expect(page.getByTestId('layer-row'), `undo ${k + 1} did not remove a layer`).toHaveCount(expectedRows);
      const size = await backingStore(page);
      const footer = await footerDimensions(page);
      console.log(
        `[PW-PROBE] undo-${k + 1} backingStore=${JSON.stringify(size)} footer="${footer}" rows=${expectedRows}`
      );
      expect(size, `backing store moved after undo ${k + 1}`).toEqual(baseline);
      expect(footer, `footer totalSize moved after undo ${k + 1}`).toBe(baselineFooter);
      await expect
        .poll(() => displayMetrics(page, baseline), `display geometry after undo ${k + 1}`)
        .toEqual(baselineDisplay);
    }

    for (let k = 0; k < 10; k += 1) {
      await page.keyboard.press('ControlOrMeta+Shift+z');
      const expectedRows = baselineRows + 1 + k;
      await expect(page.getByTestId('layer-row'), `redo ${k + 1} did not restore a layer`).toHaveCount(expectedRows);
      const size = await backingStore(page);
      const footer = await footerDimensions(page);
      console.log(
        `[PW-PROBE] redo-${k + 1} backingStore=${JSON.stringify(size)} footer="${footer}" rows=${expectedRows}`
      );
      expect(size, `backing store moved after redo ${k + 1}`).toEqual(baseline);
      expect(footer, `footer totalSize moved after redo ${k + 1}`).toBe(baselineFooter);
      await expect
        .poll(() => displayMetrics(page, baseline), `display geometry after redo ${k + 1}`)
        .toEqual(baselineDisplay);
    }

    console.log(`[PW-PROBE-SUMMARY] ${JSON.stringify({ baseline, rows: rows.length })}`);
  });

  test('12 Draw commits never expand the workspace row', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await clickToolButton(page, 'draw');

    const baseline = await backingStore(page);
    const baselineFooter = await footerDimensions(page);
    expect(baselineFooter).toContain(`${baseline.width} × ${baseline.height} px`);
    const baselineDisplay = await displayMetrics(page, baseline);
    const baselineRows = await page.getByTestId('layer-row').count();

    for (let i = 0; i < 12; i += 1) {
      const from = { x: 80 + (i % 4) * 180, y: 80 + Math.floor(i / 4) * 120 };
      const to = { x: from.x + 80, y: from.y + 12 };
      await dragInDocument(page, from, to);
      await expect(page.getByTestId('layer-row'), `Draw commit ${i + 1}`).toHaveCount(baselineRows + 1 + i);
      await expect.poll(() => backingStore(page), `backing store after Draw commit ${i + 1}`).toEqual(baseline);
      await expect.poll(() => footerDimensions(page), `Footer after Draw commit ${i + 1}`).toBe(baselineFooter);
      await expect
        .poll(() => displayMetrics(page, baseline), `display geometry after Draw commit ${i + 1}`)
        .toEqual(baselineDisplay);
    }
  });

  test('a crop, then more shape commits, then undo/redo', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });

    const baseline = await backingStore(page);
    const baselineFooter = await footerDimensions(page);
    expect(baselineFooter).toContain(`${baseline.width} × ${baseline.height} px`);
    const baselineDisplay = await displayMetrics(page, baseline);
    const baselineRows = await page.getByTestId('layer-row').count();
    console.log(
      `[PW-CROP] baseline backingStore=${JSON.stringify(baseline)} footer="${baselineFooter}" display=${JSON.stringify(baselineDisplay)}`
    );

    // The Crop tool commits with Enter (`src/components/Main/CropToolArea.tsx:53`); its bar
    // publishes `#aspect-ratio` (`src/components/ToolbarsRight/Crop/Crop.tsx:62`).
    await clickToolButton(page, 'crop');
    await expect(page.locator('#aspect-ratio')).toBeVisible();

    const box = await canvasBox(page);
    const start = documentToCanvasOffset(box, 120, 100);
    const end = documentToCanvasOffset(box, 520, 420);
    await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: 10 });
    await page.keyboard.press('Enter');
    await expect.poll(() => backingStore(page), 'the crop changes the document frame').not.toEqual(baseline);
    const afterCrop = await backingStore(page);
    expect(afterCrop.width).toBeGreaterThan(0);
    expect(afterCrop.height).toBeGreaterThan(0);
    expect(afterCrop.width).toBeLessThan(baseline.width);
    expect(afterCrop.height).toBeLessThan(baseline.height);

    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });
    const cropFooter = await footerDimensions(page);
    const cropDisplay = await displayMetrics(page, afterCrop);
    expect(cropFooter).toContain(`${afterCrop.width} × ${afterCrop.height} px`);
    expect(await page.getByTestId('layer-row').count()).toBe(baselineRows);
    console.log(
      `[PW-CROP] after-crop backingStore=${JSON.stringify(afterCrop)} footer="${cropFooter}" display=${JSON.stringify(cropDisplay)}`
    );

    for (let i = 0; i < 5; i += 1) {
      const from = { x: 20 + i * 60, y: 20 };
      const to = { x: from.x + 50, y: 70 };
      await dragInDocument(page, from, to);
      await expect(page.getByTestId('layer-row'), `post-crop commit ${i + 1}`).toHaveCount(baselineRows + 1 + i);
      const size = await backingStore(page);
      expect(size, `backing store moved after post-crop commit ${i + 1}`).toEqual(afterCrop);
      expect(await footerDimensions(page), `footer moved after post-crop commit ${i + 1}`).toBe(cropFooter);
      await expect
        .poll(() => displayMetrics(page, afterCrop), `display geometry after post-crop commit ${i + 1}`)
        .toEqual(cropDisplay);
    }

    for (let k = 0; k < 5; k += 1) {
      await page.keyboard.press('ControlOrMeta+z');
      const expectedRows = baselineRows + 4 - k;
      await expect(page.getByTestId('layer-row'), `crop-flow undo ${k + 1}`).toHaveCount(expectedRows);
      expect(await backingStore(page), `backing store moved after post-crop undo ${k + 1}`).toEqual(afterCrop);
      expect(await footerDimensions(page), `footer moved after post-crop undo ${k + 1}`).toBe(cropFooter);
      await expect
        .poll(() => displayMetrics(page, afterCrop), `display geometry after post-crop undo ${k + 1}`)
        .toEqual(cropDisplay);
    }

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('layer-row'), 'undoing the crop leaves the original layer stack').toHaveCount(
      baselineRows
    );
    await expect
      .poll(() => backingStore(page), 'undoing the crop restores the original document size')
      .toEqual(baseline);
    await expect
      .poll(() => footerDimensions(page), 'undoing the crop restores the original Footer size')
      .toBe(baselineFooter);
    await expect
      .poll(() => displayMetrics(page, baseline), 'undoing the crop restores the original display')
      .toEqual(baselineDisplay);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.getByTestId('layer-row'), 'redoing the crop preserves the original layer stack').toHaveCount(
      baselineRows
    );
    await expect
      .poll(() => backingStore(page), 'redoing the crop restores the cropped document size')
      .toEqual(afterCrop);
    await expect
      .poll(() => footerDimensions(page), 'redoing the crop restores the cropped Footer size')
      .toBe(cropFooter);
    await expect
      .poll(() => displayMetrics(page, afterCrop), 'redoing the crop restores the cropped display')
      .toEqual(cropDisplay);

    for (let k = 0; k < 5; k += 1) {
      await page.keyboard.press('ControlOrMeta+Shift+z');
      const expectedRows = baselineRows + 1 + k;
      await expect(page.getByTestId('layer-row'), `crop-flow redo ${k + 1}`).toHaveCount(expectedRows);
      expect(await backingStore(page), `backing store moved after post-crop redo ${k + 1}`).toEqual(afterCrop);
      expect(await footerDimensions(page), `footer moved after post-crop redo ${k + 1}`).toBe(cropFooter);
      await expect
        .poll(() => displayMetrics(page, afterCrop), `display geometry after post-crop redo ${k + 1}`)
        .toEqual(cropDisplay);
    }
  });
});

test.describe('an opened image, then committed tools, then undo/redo', () => {
  test('a 64x64 opened document survives shape commits and navigation', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-open-button').click();
    // The app seeds a document on boot, so File > Open is gated behind the app's own
    // discard prompt, and the answer has to land before the picker opens: the menu item
    // reaches `openLoadImageDialog` only once the guard resolves. This test's baseline is
    // the OPENED 64x64 document, so a declined guard would leave the poll below measuring
    // the seeded 800x600 — which is why the prompt is waited for rather than tolerated.
    await acceptDiscardPrompt(page);
    const fileChooser = await chooser;
    await fileChooser.setFiles(path.join(testInfo.config.rootDir, 'fixtures/split-half-red-blue.png'));

    // The import is committed asynchronously, so the size is POLLED rather than read once:
    // a single read taken right after setFiles still sees the seeded 800x600.
    await expect
      .poll(() => backingStore(page), 'the opened 64x64 document replaces the seeded one')
      .toEqual({ width: 64, height: 64 });
    await expect(page.getByTestId('layer-row')).toHaveCount(1);
    const baselineRows = await page.getByTestId('layer-row').count();
    const baseline = await backingStore(page);
    const baselineFooter = await footerDimensions(page);
    expect(baselineFooter).toContain(`${baseline.width} × ${baseline.height} px`);
    console.log(
      `[PW-OPEN] after-open backingStore=${JSON.stringify(baseline)} footer="${baselineFooter}" layerRows=${baselineRows}`
    );
    expect(baseline, 'the fixture is a 64x64 png').toEqual({ width: 64, height: 64 });

    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });
    const baselineDisplay = await displayMetrics(page, baseline);
    expect(await backingStore(page)).toEqual(baseline);
    expect(await footerDimensions(page)).toBe(baselineFooter);

    for (let i = 0; i < 5; i += 1) {
      const from = { x: 3 + i * 11, y: 3 };
      const to = { x: from.x + 9, y: 13 };
      await dragInDocument(page, from, to, baseline);
      await expect(page.getByTestId('layer-row'), `opened-doc commit ${i + 1}`).toHaveCount(baselineRows + 1 + i);
      const size = await backingStore(page);
      console.log(
        `[PW-OPEN] commit-${i + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
      expect(size, `backing store moved after commit ${i + 1} on the opened document`).toEqual(baseline);
      expect(await footerDimensions(page), `footer moved after commit ${i + 1} on the opened document`).toBe(
        baselineFooter
      );
      await expect
        .poll(() => displayMetrics(page, baseline), `display geometry after opened-doc commit ${i + 1}`)
        .toEqual(baselineDisplay);
    }

    for (let k = 0; k < 5; k += 1) {
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.getByTestId('layer-row'), `opened-doc undo ${k + 1}`).toHaveCount(baselineRows + 4 - k);
      const size = await backingStore(page);
      console.log(
        `[PW-OPEN] undo-${k + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
      expect(size, `backing store moved after undo ${k + 1} on the opened document`).toEqual(baseline);
      expect(await footerDimensions(page), `footer moved after undo ${k + 1} on the opened document`).toBe(
        baselineFooter
      );
      await expect
        .poll(() => displayMetrics(page, baseline), `display geometry after opened-doc undo ${k + 1}`)
        .toEqual(baselineDisplay);
    }

    for (let k = 0; k < 5; k += 1) {
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(page.getByTestId('layer-row'), `opened-doc redo ${k + 1}`).toHaveCount(baselineRows + 1 + k);
      const size = await backingStore(page);
      console.log(
        `[PW-OPEN] redo-${k + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
      expect(size, `backing store moved after redo ${k + 1} on the opened document`).toEqual(baseline);
      expect(await footerDimensions(page), `footer moved after redo ${k + 1} on the opened document`).toBe(
        baselineFooter
      );
      await expect
        .poll(() => displayMetrics(page, baseline), `display geometry after opened-doc redo ${k + 1}`)
        .toEqual(baselineDisplay);
    }
  });
});

test.describe('tablet transparent blank-layer pixels', () => {
  test.use({ viewport: { width: 744, height: 1133 }, deviceScaleFactor: 2, hasTouch: true });

  test('adding transparent layers preserves existing pixels through undo and redo', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    const documentSize = { width: 800, height: 600 };
    const baseline = await backingStore(page);
    const baseRows = await page.getByTestId('layer-row').count();
    await page.getByTestId('mobile-bottom-bar').getByRole('button', { name: 'Draw Tool' }).tap();
    await dragInDocument(page, { x: 280, y: 300 }, { x: 520, y: 300 }, documentSize);
    await page.mouse.move(0, 0);
    const rowsWithStroke = baseRows + 1;
    await expect(page.getByTestId('layer-row'), 'the reference stroke is committed first').toHaveCount(rowsWithStroke);

    const samplePoint = { x: 400, y: 300 };
    await expectDarkDocumentPixel(page, samplePoint, documentSize);
    const referencePixel = await readDocumentPixel(page, samplePoint, documentSize);
    expect(referencePixel[3]).toBe(255);
    expect(Math.max(referencePixel[0], referencePixel[1], referencePixel[2])).toBeLessThan(80);

    await page.getByTestId('mobile-layers-toggle-button').tap();
    await expect(page.getByTestId('mobile-layers-drawer')).toBeVisible();

    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId('mobile-add-layer-button').tap();
      await expect(page.getByTestId('layer-row'), `transparent layer ${i + 1}`).toHaveCount(rowsWithStroke + 1 + i);
      await page.getByRole('button', { name: 'Close layers drawer' }).tap();
      await expect(page.getByTestId('mobile-layers-drawer')).toBeHidden();
      await expect.poll(() => readDocumentPixel(page, samplePoint, documentSize)).toEqual(referencePixel);
      const size = await backingStore(page);
      expect(size, `backing store moved after transparent layer ${i + 1}`).toEqual(baseline);

      if (i < 2) {
        await page.getByTestId('mobile-layers-toggle-button').tap();
        await expect(page.getByTestId('mobile-layers-drawer')).toBeVisible();
      }
    }

    for (let k = 0; k < 3; k += 1) {
      await page.getByTestId('mobile-undo-button').tap();
      const expectedRows = rowsWithStroke + 2 - k;
      await expect(page.getByTestId('layer-row'), `tablet undo ${k + 1}`).toHaveCount(expectedRows);
      await expect.poll(() => readDocumentPixel(page, samplePoint, documentSize)).toEqual(referencePixel);
      const size = await backingStore(page);
      expect(size, `backing store moved after tablet undo ${k + 1}`).toEqual(baseline);
    }

    for (let k = 0; k < 3; k += 1) {
      await page.getByTestId('mobile-redo-button').tap();
      const expectedRows = rowsWithStroke + 1 + k;
      await expect(page.getByTestId('layer-row'), `tablet redo ${k + 1}`).toHaveCount(expectedRows);
      await expect.poll(() => readDocumentPixel(page, samplePoint, documentSize)).toEqual(referencePixel);
      const size = await backingStore(page);
      expect(size, `backing store moved after tablet redo ${k + 1}`).toEqual(baseline);
    }
  });
});
