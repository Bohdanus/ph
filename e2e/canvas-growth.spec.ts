/**
 * The canvas must not grow. An ordinary tool commit, an undo, a redo, a crop and an
 * opened document each leave the workspace canvas backing store and the Footer's
 * `totalSize` readout exactly where they were — measured through the real UI, so a
 * re-allocation that only the runtime `Layer` objects would hide still fails here.
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

/** The canvas element's own backing store — the document's pixel dimensions. */
async function backingStore(page: Page): Promise<Size> {
  return await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
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
    }

    console.log(`[PW-PROBE-SUMMARY] ${JSON.stringify({ baseline, rows: rows.length })}`);
  });

  test('12 Draw commits never expand the workspace row', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await clickToolButton(page, 'draw');

    const baseline = await backingStore(page);
    const baselineBox = await canvasBox(page);
    const baselinePageHeight = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    const baselineRows = await page.getByTestId('layer-row').count();

    for (let i = 0; i < 12; i += 1) {
      const from = { x: 80 + (i % 4) * 180, y: 80 + Math.floor(i / 4) * 120 };
      const to = { x: from.x + 80, y: from.y + 12 };
      await dragInDocument(page, from, to);
      await expect(page.getByTestId('layer-row'), `Draw commit ${i + 1}`).toHaveCount(baselineRows + 1 + i);
      await expect.poll(() => backingStore(page), `backing store after Draw commit ${i + 1}`).toEqual(baseline);
      await expect.poll(() => canvasBox(page), `canvas box after Draw commit ${i + 1}`).toEqual(baselineBox);
      await expect
        .poll(
          () =>
            page.evaluate(() => ({
              clientHeight: document.documentElement.clientHeight,
              scrollHeight: document.documentElement.scrollHeight,
            })),
          `page geometry after Draw commit ${i + 1}`
        )
        .toEqual(baselinePageHeight);
    }
  });

  test('a crop, then more shape commits, then undo/redo', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    const baseline = await backingStore(page);
    console.log(`[PW-CROP] baseline backingStore=${JSON.stringify(baseline)}`);

    // The Crop tool commits with Enter (`src/components/Main/CropToolArea.tsx:53`); its bar
    // publishes `#aspect-ratio` (`src/components/ToolbarsRight/Crop/Crop.tsx:62`).
    await clickToolButton(page, 'crop');
    await expect(page.locator('#aspect-ratio')).toBeVisible();

    const box = await canvasBox(page);
    const start = documentToCanvasOffset(box, 120, 100);
    const end = documentToCanvasOffset(box, 520, 420);
    await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const afterCrop = await backingStore(page);
    const cropFooter = await footerDimensions(page);
    console.log(`[PW-CROP] after-crop backingStore=${JSON.stringify(afterCrop)} footer="${cropFooter}"`);

    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });
    const rowsBefore = await page.getByTestId('layer-row').count();

    for (let i = 0; i < 5; i += 1) {
      const from = { x: 20 + i * 60, y: 20 };
      const to = { x: from.x + 50, y: 70 };
      await dragInDocument(page, from, to);
      await expect(page.getByTestId('layer-row'), `post-crop commit ${i + 1}`).toHaveCount(rowsBefore + 1 + i);
      const size = await backingStore(page);
      console.log(
        `[PW-CROP] post-crop-commit-${i + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
    }

    const afterCommits = await backingStore(page);
    console.log(`[PW-CROP] after-commits backingStore=${JSON.stringify(afterCommits)}`);

    const rowsAfterCrop = rowsBefore + 5;
    for (let k = 0; k < 3; k += 1) {
      await page.keyboard.press('ControlOrMeta+z');
      const expectedRows = rowsAfterCrop - 1 - k;
      await expect(page.getByTestId('layer-row'), `crop-flow undo ${k + 1}`).toHaveCount(expectedRows);
      const size = await backingStore(page);
      console.log(
        `[PW-CROP] undo-${k + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
    }
    for (let k = 0; k < 3; k += 1) {
      await page.keyboard.press('ControlOrMeta+Shift+z');
      const expectedRows = rowsAfterCrop - 3 + 1 + k;
      await expect(page.getByTestId('layer-row'), `crop-flow redo ${k + 1}`).toHaveCount(expectedRows);
      const size = await backingStore(page);
      console.log(
        `[PW-CROP] redo-${k + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
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
    console.log(
      `[PW-OPEN] after-open backingStore=${JSON.stringify(baseline)} footer="${baselineFooter}" layerRows=${baselineRows}`
    );
    expect(baseline, 'the fixture is a 64x64 png').toEqual({ width: 64, height: 64 });

    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });

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
    }

    for (let k = 0; k < 5; k += 1) {
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.getByTestId('layer-row'), `opened-doc undo ${k + 1}`).toHaveCount(baselineRows + 4 - k);
      const size = await backingStore(page);
      console.log(
        `[PW-OPEN] undo-${k + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
      expect(size, `backing store moved after undo ${k + 1} on the opened document`).toEqual(baseline);
    }

    for (let k = 0; k < 5; k += 1) {
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(page.getByTestId('layer-row'), `opened-doc redo ${k + 1}`).toHaveCount(baselineRows + 1 + k);
      const size = await backingStore(page);
      console.log(
        `[PW-OPEN] redo-${k + 1} backingStore=${JSON.stringify(size)} footer="${await footerDimensions(page)}"`
      );
      expect(size, `backing store moved after redo ${k + 1} on the opened document`).toEqual(baseline);
    }
  });
});

/**
 * The mobile shell is where the ONE production mid-document bedrock layer is written:
 * `MobileLayersDrawer.tsx:173` calls `createBlankLayer({ ..., size: totalSize, isBedrock: true })`
 * with NO `replaceDocument`, which is exactly the history shape the replay bedrock branch
 * reacts to.
 */
test.describe('a mobile blank-layer commit, then undo/redo', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('adding blank layers mid-document never moves the document size', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    const baseline = await backingStore(page);
    const baselineRows = await page.getByTestId('layer-row').count();
    console.log(`[PW-MOBILE] baseline backingStore=${JSON.stringify(baseline)} layerRows=${baselineRows}`);

    await page.getByTestId('mobile-layers-toggle-button').click();
    await expect(page.getByTestId('mobile-layers-drawer')).toBeVisible();

    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId('mobile-add-layer-button').click();
      await expect(page.getByTestId('layer-row'), `blank layer ${i + 1}`).toHaveCount(baselineRows + 1 + i);
      const size = await backingStore(page);
      console.log(`[PW-MOBILE] blank-layer-${i + 1} backingStore=${JSON.stringify(size)}`);
      expect(size, `backing store moved after blank layer ${i + 1}`).toEqual(baseline);
    }

    // The drawer is a modal dialog whose backdrop covers the header, so it is dismissed with
    // its own Close control (`MobileLayersDrawer.tsx:161`) rather than by clicking through it.
    await page.getByRole('button', { name: 'Close layers drawer' }).click();
    await expect(page.getByTestId('mobile-layers-drawer')).toBeHidden();

    for (let k = 0; k < 3; k += 1) {
      await page.getByTestId('mobile-undo-button').click();
      const expectedRows = baselineRows + 2 - k;
      await expect(page.getByTestId('layer-row'), `mobile undo ${k + 1}`).toHaveCount(expectedRows);
      const size = await backingStore(page);
      console.log(`[PW-MOBILE] undo-${k + 1} backingStore=${JSON.stringify(size)} rows=${expectedRows}`);
      expect(size, `backing store moved after mobile undo ${k + 1}`).toEqual(baseline);
    }

    for (let k = 0; k < 3; k += 1) {
      await page.getByTestId('mobile-redo-button').click();
      const expectedRows = baselineRows + 1 + k;
      await expect(page.getByTestId('layer-row'), `mobile redo ${k + 1}`).toHaveCount(expectedRows);
      const size = await backingStore(page);
      console.log(`[PW-MOBILE] redo-${k + 1} backingStore=${JSON.stringify(size)} rows=${expectedRows}`);
      expect(size, `backing store moved after mobile redo ${k + 1}`).toEqual(baseline);
    }
  });
});
