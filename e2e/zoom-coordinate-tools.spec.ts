import { expect, type Page, test } from './fixtures/extended-test';
import { getWorkspaceCanvas, loadImageData } from './helpers/canvas-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton, expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { waitForCommittedAnts } from './helpers/selection-ants';

type Point = { x: number; y: number };
type Raster = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
type ViewGeometry = {
  scale: number;
  offsetX: number;
  offsetY: number;
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
  viewZoom: number;
  viewPanX: number;
  viewPanY: number;
  viewRotation: number;
  documentWidth: number;
  documentHeight: number;
};

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
  await expect(getWorkspaceCanvas(page), 'the seeded document canvas must be visible').toBeVisible();
}

async function readViewGeometry(page: Page): Promise<ViewGeometry> {
  const workspace = page.getByTestId('workspace-container');
  await expect(workspace).toHaveAttribute('data-fit-scale', /.+/);
  return workspace.evaluate((node) => {
    const read = (name: string): number => {
      const raw = node.getAttribute(name);
      if (raw === null) throw new Error(`the app published no ${name}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} is not a number: ${raw}`);
      return value;
    };
    return {
      scale: read('data-fit-scale'),
      offsetX: read('data-fit-offset-x'),
      offsetY: read('data-fit-offset-y'),
      rectX: read('data-fit-rect-x'),
      rectY: read('data-fit-rect-y'),
      rectWidth: read('data-fit-outer-width'),
      rectHeight: read('data-fit-outer-height'),
      viewZoom: read('data-view-effective-zoom'),
      viewPanX: read('data-view-pan-x'),
      viewPanY: read('data-view-pan-y'),
      viewRotation: read('data-view-rotation'),
      documentWidth: read('data-fit-document-width'),
      documentHeight: read('data-fit-document-height'),
    };
  });
}

/** Map a known document point to the mouse position produced by the app's published view. */
function documentToPagePoint(view: ViewGeometry, point: Point): Point {
  const centerX = view.rectWidth / 2;
  const centerY = view.rectHeight / 2;
  const relativeX = view.offsetX + point.x * view.scale - centerX;
  const relativeY = view.offsetY + point.y * view.scale - centerY;
  const angle = (view.viewRotation * Math.PI) / 180;
  const rotatedX = relativeX * Math.cos(angle) - relativeY * Math.sin(angle);
  const rotatedY = relativeX * Math.sin(angle) + relativeY * Math.cos(angle);
  return {
    x: view.rectX + centerX + view.viewPanX + view.viewZoom * rotatedX,
    y: view.rectY + centerY + view.viewPanY + view.viewZoom * rotatedY,
  };
}

async function dragDocumentPoints(page: Page, from: Point, to: Point, steps = 18): Promise<void> {
  const view = await readViewGeometry(page);
  const start = documentToPagePoint(view, from);
  const end = documentToPagePoint(view, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
}

async function readCanvasRaster(page: Page, testId: string): Promise<Raster> {
  const base64 = await page
    .getByTestId(testId)
    .evaluate((node) => (node as HTMLCanvasElement).toDataURL('image/png').split(',')[1]);
  return loadImageData(Buffer.from(base64, 'base64'));
}

function documentPixel(raster: Raster, view: ViewGeometry, point: Point): [number, number, number, number] {
  const x = Math.min(raster.width - 1, Math.max(0, Math.round((point.x * raster.width) / view.documentWidth)));
  const y = Math.min(raster.height - 1, Math.max(0, Math.round((point.y * raster.height) / view.documentHeight)));
  const offset = (y * raster.width + x) * 4;
  return [raster.data[offset]!, raster.data[offset + 1]!, raster.data[offset + 2]!, raster.data[offset + 3]!];
}

function expectDarkPixel(pixel: readonly number[], message: string): void {
  expect(pixel[3], `${message}: pixel alpha`).toBeGreaterThan(0);
  expect(Math.max(pixel[0], pixel[1], pixel[2]), `${message}: pixel brightness`).toBeLessThan(100);
}

function expectRedPixel(pixel: readonly number[], message: string): void {
  expect(pixel[3], `${message}: pixel alpha`).toBeGreaterThan(0);
  expect(pixel[0], `${message}: red channel`).toBeGreaterThan(180);
  expect(pixel[1], `${message}: green channel`).toBeLessThan(100);
  expect(pixel[2], `${message}: blue channel`).toBeLessThan(100);
}

function expectWhitePixel(pixel: readonly number[], message: string): void {
  expect(pixel[3], `${message}: pixel alpha`).toBeGreaterThan(0);
  expect(Math.min(pixel[0], pixel[1], pixel[2]), `${message}: composite brightness`).toBeGreaterThan(235);
}

async function zoomAndRotate(page: Page): Promise<string> {
  await clickToolButton(page, 'zoom');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.locator('label[for="view-zoom-slider"]')).toHaveText('Zoom 100%');
  const hundredPercentView = await readViewGeometry(page);
  const physicalMagnification =
    hundredPercentView.scale * hundredPercentView.viewZoom * (await page.evaluate(() => window.devicePixelRatio));
  expect(
    physicalMagnification,
    'at 100% on a 2x display one document pixel maps to one physical monitor pixel'
  ).toBeCloseTo(1, 2);

  const slider = page.locator('#view-zoom-slider');
  const target = await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    const workspace = document.querySelector('[data-testid="workspace-container"]');
    const width = Number(workspace?.getAttribute('data-fit-document-width'));
    const height = Number(workspace?.getAttribute('data-fit-document-height'));
    const minimumZoom = width > 0 && height > 0 ? 1 / Math.max(1, Math.min(width, height)) : 0.1;
    const rect = input.getBoundingClientRect();
    const thumbWidth = 16;
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const progress = (position: number) => (position - min) / (max - min);
    const targetPosition = min + (max - min) * (Math.log(2 / minimumZoom) / Math.log(32 / minimumZoom));
    const positionToX = (position: number) =>
      rect.left + thumbWidth / 2 + progress(position) * (rect.width - thumbWidth);
    return {
      startX: positionToX(value),
      endX: positionToX(targetPosition),
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.move(target.startX, target.y);
  await page.mouse.down();
  await page.mouse.move(target.endX, target.y, { steps: 28 });
  await page.mouse.up();
  await expect(page.locator('label[for="view-zoom-slider"]')).toHaveText('Zoom 200%');

  const workspace = page.getByTestId('workspace-container');
  await page.keyboard.press('r');
  const box = await workspace.boundingBox();
  if (!box) throw new Error('workspace-container has no bounding box');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x - 18, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 9, center.y + 4, { steps: 7 });
  await page.mouse.up();
  await expect(workspace).not.toHaveAttribute('data-view-rotation', '0');
  return (await workspace.getAttribute('data-view-zoom')) ?? '';
}

async function readSelectionBounds(
  page: Page,
  view: ViewGeometry
): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
  const raster = await readCanvasRaster(page, 'selection-ants-canvas');
  let left = raster.width;
  let top = raster.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const offset = (y * raster.width + x) * 4;
      if (raster.data[offset + 3] === 0) continue;
      const isAnt =
        (raster.data[offset]! < 64 && raster.data[offset + 1]! < 64 && raster.data[offset + 2]! < 64) ||
        (raster.data[offset]! > 192 && raster.data[offset + 1]! > 192 && raster.data[offset + 2]! > 192);
      if (!isAnt) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0 || bottom < 0) return null;
  return {
    left: (left * view.documentWidth) / raster.width,
    top: (top * view.documentHeight) / raster.height,
    right: (right * view.documentWidth) / raster.width,
    bottom: (bottom * view.documentHeight) / raster.height,
  };
}

test.describe('Zoomed pointer tools', () => {
  test.use({ deviceScaleFactor: 2 });

  test('shape preview, shape commit, and elliptical marquee keep document coordinates through zoom and rotation', async ({
    page,
  }) => {
    await openWorkspace(page);
    const zoomState = await zoomAndRotate(page);

    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });
    await expectToolSelected(page, 'shape');
    await setForegroundColor(page, '#000000', true);
    await page.locator('#thickness-slider').fill('16');

    const shapeFrom = { x: 280, y: 220 };
    const shapeTo = { x: 500, y: 360 };
    const shapeProbe = { x: 390, y: 220 };
    await dragDocumentPoints(page, shapeFrom, shapeTo);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    const shapeView = await readViewGeometry(page);
    const preview = await readCanvasRaster(page, 'tool-overlay-canvas');
    expectDarkPixel(
      documentPixel(preview, shapeView, shapeProbe),
      'the uncommitted shape preview must follow the projected document-space drag'
    );

    await page.mouse.up();
    await expect(page.getByTestId('undo-button')).toBeEnabled();
    const committed = await readCanvasRaster(page, 'workspace-canvas');
    expectDarkPixel(
      documentPixel(committed, shapeView, shapeProbe),
      'the committed shape edge must stay at the same document coordinate as its preview'
    );
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-zoom', zoomState);

    await openToolFlyout(page, 'rectangular-selection');
    await selectFromFlyout(page, { toolName: 'elliptical-selection', label: 'Elliptical Marquee Tool' });
    const selectionFrom = { x: 300, y: 250 };
    const selectionTo = { x: 470, y: 370 };
    await dragDocumentPoints(page, selectionFrom, selectionTo);
    await page.mouse.up();
    await waitForCommittedAnts(page, 'the zoomed elliptical marquee border');

    const selectionView = await readViewGeometry(page);
    const bounds = await readSelectionBounds(page, selectionView);
    expect(bounds, 'the committed selection canvas must contain the marquee border').not.toBeNull();
    expect(Math.abs(bounds!.left - selectionFrom.x), 'marquee left edge in document pixels').toBeLessThanOrEqual(3);
    expect(Math.abs(bounds!.top - selectionFrom.y), 'marquee top edge in document pixels').toBeLessThanOrEqual(3);
    expect(Math.abs(bounds!.right - selectionTo.x), 'marquee right edge in document pixels').toBeLessThanOrEqual(3);
    expect(Math.abs(bounds!.bottom - selectionTo.y), 'marquee bottom edge in document pixels').toBeLessThanOrEqual(3);

    await page.getByTestId('undo-button').click();
    await expect.poll(() => readSelectionBounds(page, selectionView)).toBeNull();
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-zoom', zoomState);
    await page.getByTestId('redo-button').click();
    await waitForCommittedAnts(page, 'the zoomed elliptical marquee after redo');
    const redoneBounds = await readSelectionBounds(page, selectionView);
    expect(redoneBounds, 'redo restores the marquee in document coordinates').toEqual(bounds);
  });

  test('eyedropper clicks and eraser strokes address the intended pixels after zoom and rotation', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');
    await setForegroundColor(page, '#ff0000', true);
    await page.locator('#size-slider').fill('24');
    await page.locator('#alpha-slider').fill('1');

    const lineFrom = { x: 300, y: 400 };
    const lineTo = { x: 500, y: 400 };
    await dragDocumentPoints(page, lineFrom, lineTo);
    await page.mouse.up();
    const fitView = await readViewGeometry(page);
    await expect
      .poll(async () => {
        const raster = await readCanvasRaster(page, 'workspace-canvas');
        return documentPixel(raster, fitView, { x: 400, y: 400 })[0];
      })
      .toBeGreaterThan(180);
    expectRedPixel(
      documentPixel(await readCanvasRaster(page, 'workspace-canvas'), fitView, { x: 400, y: 400 }),
      'the seed stroke is red at its document-space midpoint'
    );

    const zoomState = await zoomAndRotate(page);
    await clickToolButton(page, 'eyedropper');
    await expectToolSelected(page, 'eyedropper');
    const eyedropperView = await readViewGeometry(page);
    const sample = documentToPagePoint(eyedropperView, { x: 400, y: 400 });
    await page.mouse.click(sample.x, sample.y);
    await expect(page.getByTestId('foreground-color-input')).toHaveValue('#ff0000');

    await clickToolButton(page, 'eraser');
    await expectToolSelected(page, 'eraser');
    await page.getByRole('slider', { name: /^Size/ }).fill('48');
    const eraserFrom = { x: 380, y: 400 };
    const eraserTo = { x: 420, y: 400 };
    await dragDocumentPoints(page, eraserFrom, eraserTo, 10);
    const eraserView = await readViewGeometry(page);
    await expect
      .poll(async () => {
        const raster = await readCanvasRaster(page, 'workspace-canvas');
        return Math.min(...documentPixel(raster, eraserView, { x: 400, y: 400 }).slice(0, 3));
      })
      .toBeGreaterThan(235);
    expectWhitePixel(
      documentPixel(await readCanvasRaster(page, 'workspace-canvas'), eraserView, { x: 400, y: 400 }),
      'the erased layer reveals the white bedrock at the document-space midpoint'
    );
    await page.mouse.up();

    await expect
      .poll(async () => {
        const raster = await readCanvasRaster(page, 'workspace-canvas');
        return Math.min(...documentPixel(raster, eraserView, { x: 400, y: 400 }).slice(0, 3));
      })
      .toBeGreaterThan(235);
    await page.getByTestId('undo-button').click();
    await expect
      .poll(async () => {
        const raster = await readCanvasRaster(page, 'workspace-canvas');
        return documentPixel(raster, eraserView, { x: 400, y: 400 })[0];
      })
      .toBeGreaterThan(180);
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-zoom', zoomState);
  });
});
