import { createHash } from 'node:crypto';
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
type ViewAttributes = {
  zoom: string;
  effectiveZoom: string;
  panX: string;
  panY: string;
  rotation: string;
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

async function readViewAttributes(page: Page): Promise<ViewAttributes> {
  const workspace = page.getByTestId('workspace-container');
  return workspace.evaluate((node) => {
    const read = (name: string): string => {
      const value = node.getAttribute(name);
      if (value === null) throw new Error(`the app published no ${name}`);
      return value;
    };
    return {
      zoom: read('data-view-zoom'),
      effectiveZoom: read('data-view-effective-zoom'),
      panX: read('data-view-pan-x'),
      panY: read('data-view-pan-y'),
      rotation: read('data-view-rotation'),
    };
  });
}

async function expectViewAttributes(page: Page, expected: ViewAttributes, historyStep: string): Promise<void> {
  const workspace = page.getByTestId('workspace-container');
  await expect(workspace, `${historyStep} preserves slider zoom`).toHaveAttribute('data-view-zoom', expected.zoom);
  await expect(workspace, `${historyStep} preserves effective view zoom`).toHaveAttribute(
    'data-view-effective-zoom',
    expected.effectiveZoom
  );
  await expect(workspace, `${historyStep} preserves horizontal pan`).toHaveAttribute('data-view-pan-x', expected.panX);
  await expect(workspace, `${historyStep} preserves vertical pan`).toHaveAttribute('data-view-pan-y', expected.panY);
  await expect(workspace, `${historyStep} preserves rotation`).toHaveAttribute('data-view-rotation', expected.rotation);
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

async function setTextToolColor(page: Page, color: string): Promise<void> {
  await page.evaluate((nextColor) => {
    const input = document.querySelector<HTMLInputElement>('#text-color');
    if (!input) throw new Error('the Text toolbar color input is missing');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('the native input value setter is missing');
    setter.call(input, nextColor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
  await expect(page.locator('#text-color')).toHaveValue(color);
}

function documentPixel(raster: Raster, view: ViewGeometry, point: Point): [number, number, number, number] {
  const x = Math.min(raster.width - 1, Math.max(0, Math.round((point.x * raster.width) / view.documentWidth)));
  const y = Math.min(raster.height - 1, Math.max(0, Math.round((point.y * raster.height) / view.documentHeight)));
  const offset = (y * raster.width + x) * 4;
  return [raster.data[offset]!, raster.data[offset + 1]!, raster.data[offset + 2]!, raster.data[offset + 3]!];
}

function rasterSignature(raster: Raster): string {
  return createHash('sha256')
    .update(`${raster.width}x${raster.height}:`)
    .update(Buffer.from(raster.data))
    .digest('hex');
}

function rasterRegionSignature(
  raster: Raster,
  region: { x: number; y: number; width: number; height: number }
): string {
  if (
    !Number.isInteger(region.x) ||
    !Number.isInteger(region.y) ||
    !Number.isInteger(region.width) ||
    !Number.isInteger(region.height) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > raster.width ||
    region.y + region.height > raster.height
  ) {
    throw new Error(`raster region is out of bounds: ${JSON.stringify(region)} in ${raster.width}x${raster.height}`);
  }

  const rowBytes = region.width * 4;
  const pixels = new Uint8Array(rowBytes * region.height);
  for (let row = 0; row < region.height; row += 1) {
    const start = ((region.y + row) * raster.width + region.x) * 4;
    pixels.set(raster.data.subarray(start, start + rowBytes), row * rowBytes);
  }
  return createHash('sha256').update(`${region.width}x${region.height}:`).update(Buffer.from(pixels)).digest('hex');
}

function countRedPixels(raster: Raster): number {
  let count = 0;
  for (let offset = 0; offset < raster.data.length; offset += 4) {
    if (
      raster.data[offset + 3]! > 0 &&
      raster.data[offset]! > 100 &&
      raster.data[offset + 1]! < 100 &&
      raster.data[offset + 2]! < 100
    ) {
      count += 1;
    }
  }
  return count;
}

function darkPixelBounds(
  raster: Raster,
  view: ViewGeometry
): { left: number; top: number; right: number; bottom: number } | null {
  let left = raster.width;
  let top = raster.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const offset = (y * raster.width + x) * 4;
      if (raster.data[offset + 3]! < 128) continue;
      if (Math.max(raster.data[offset]!, raster.data[offset + 1]!, raster.data[offset + 2]!) >= 80) continue;
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
    right: ((right + 1) * view.documentWidth) / raster.width,
    bottom: ((bottom + 1) * view.documentHeight) / raster.height,
  };
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

function expectBluePixel(pixel: readonly number[], message: string): void {
  expect(pixel[3], `${message}: pixel alpha`).toBeGreaterThan(0);
  expect(pixel[0], `${message}: red channel`).toBeLessThan(100);
  expect(pixel[1], `${message}: green channel`).toBeLessThan(100);
  expect(pixel[2], `${message}: blue channel`).toBeGreaterThan(180);
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

  test('Move translates the selected layer by document pixels under zoom and rotation and replays exactly', async ({
    page,
  }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await page.locator('#size-slider').fill('24');
    await page.locator('#alpha-slider').fill('1');
    const lineFrom = { x: 280, y: 360 };
    const lineTo = { x: 520, y: 360 };
    await dragDocumentPoints(page, lineFrom, lineTo);
    await page.mouse.up();

    const fitView = await readViewGeometry(page);
    const originalRaster = await readCanvasRaster(page, 'workspace-canvas');
    const originalSignature = rasterSignature(originalRaster);
    const originalBounds = darkPixelBounds(originalRaster, fitView);
    expect(originalBounds, 'the seed draw creates a non-bedrock layer to move').not.toBeNull();

    const zoomState = await zoomAndRotate(page);
    await clickToolButton(page, 'reposition');
    await expectToolSelected(page, 'reposition');
    const moveBy = { x: 60, y: 50 };
    await dragDocumentPoints(
      page,
      { x: (lineFrom.x + lineTo.x) / 2, y: lineFrom.y },
      { x: (lineFrom.x + lineTo.x) / 2 + moveBy.x, y: lineFrom.y + moveBy.y },
      16
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    const previewView = await readViewGeometry(page);
    const previewRaster = await readCanvasRaster(page, 'workspace-canvas');
    const previewSignature = rasterSignature(previewRaster);
    const previewBounds = darkPixelBounds(previewRaster, previewView);
    expect(previewBounds, 'Move preview renders the translated layer while the gesture is active').not.toBeNull();
    expect(
      Math.abs(previewBounds!.left - originalBounds!.left - moveBy.x),
      'preview left edge follows the document drag'
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(previewBounds!.top - originalBounds!.top - moveBy.y),
      'preview top edge follows the document drag'
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(previewBounds!.right - originalBounds!.right - moveBy.x),
      'preview right edge follows the document drag'
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(previewBounds!.bottom - originalBounds!.bottom - moveBy.y),
      'preview bottom edge follows the document drag'
    ).toBeLessThanOrEqual(2);

    await page.mouse.up();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(previewSignature);
    const movedRaster = await readCanvasRaster(page, 'workspace-canvas');
    const movedSignature = rasterSignature(movedRaster);
    const movedView = await readViewAttributes(page);
    const movedBounds = darkPixelBounds(movedRaster, previewView);
    expect(movedBounds, 'the committed moved layer remains visible').not.toBeNull();
    expect(
      Math.abs(movedBounds!.left - originalBounds!.left - moveBy.x),
      'the committed left edge follows the document drag'
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(movedBounds!.top - originalBounds!.top - moveBy.y),
      'the committed top edge follows the document drag'
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(movedBounds!.right - originalBounds!.right - moveBy.x),
      'the committed right edge moves by the same document delta'
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(movedBounds!.bottom - originalBounds!.bottom - moveBy.y),
      'the committed bottom edge moves by the same document delta'
    ).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-zoom', zoomState);

    await page.getByTestId('undo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(originalSignature);
    await expectViewAttributes(page, movedView, 'Move undo');
    await page.getByTestId('redo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(movedSignature);
    await expectViewAttributes(page, movedView, 'Move redo');
  });

  test('Gradient preview and commit use document-space endpoints and undo/redo reproduce the same pixels', async ({
    page,
  }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await page.locator('#size-slider').fill('24');
    await page.locator('#alpha-slider').fill('1');
    await dragDocumentPoints(page, { x: 160, y: 300 }, { x: 640, y: 300 });
    await page.mouse.up();
    const seedRaster = await readCanvasRaster(page, 'workspace-canvas');
    const seedSignature = rasterSignature(seedRaster);

    const zoomState = await zoomAndRotate(page);
    await clickToolButton(page, 'gradient');
    await expectToolSelected(page, 'gradient');
    await page.locator('#gradient-color-a').fill('#0000ff');
    await page.locator('#gradient-color-b').fill('#ff0000');
    await expect(page.locator('#gradient-color-a')).toHaveValue('#0000ff');
    await expect(page.locator('#gradient-color-b')).toHaveValue('#ff0000');

    const from = { x: 240, y: 300 };
    const to = { x: 560, y: 300 };
    await dragDocumentPoints(page, from, to, 20);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    const previewView = await readViewGeometry(page);
    const previewRaster = await readCanvasRaster(page, 'workspace-canvas');
    const previewSignature = rasterSignature(previewRaster);
    expectBluePixel(documentPixel(previewRaster, previewView, from), 'the live gradient starts at Colour A');
    expectRedPixel(documentPixel(previewRaster, previewView, to), 'the live gradient ends at Colour B');
    const midpoint = documentPixel(previewRaster, previewView, { x: 400, y: 300 });
    expect(midpoint[0], 'the gradient midpoint contains red').toBeGreaterThan(80);
    expect(midpoint[1], 'the gradient midpoint does not introduce green').toBeLessThan(100);
    expect(midpoint[2], 'the gradient midpoint contains blue').toBeGreaterThan(80);

    await page.mouse.up();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .not.toBe(seedSignature);
    const committedRaster = await readCanvasRaster(page, 'workspace-canvas');
    const committedSignature = rasterSignature(committedRaster);
    const committedView = await readViewAttributes(page);
    expect(committedSignature, 'preview and committed gradient have identical document pixels').toBe(previewSignature);
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-zoom', zoomState);

    await page.getByTestId('undo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(seedSignature);
    await expectViewAttributes(page, committedView, 'Gradient undo');
    await page.getByTestId('redo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(committedSignature);
    await expectViewAttributes(page, committedView, 'Gradient redo');
  });

  test('Text placement and Crop guide, frame, and replay stay aligned at DPR 2 after zoom, pan, and rotation', async ({
    page,
  }) => {
    await openWorkspace(page);
    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    const workspace = page.getByTestId('workspace-container');
    const openingView = await readViewGeometry(page);
    const openingRaster = await readCanvasRaster(page, 'workspace-canvas');
    const openingSignature = rasterSignature(openingRaster);
    const rasterScaleX = openingRaster.width / openingView.documentWidth;
    const rasterScaleY = openingRaster.height / openingView.documentHeight;
    expect(rasterScaleX, 'the Retina raster doubles logical document width').toBeCloseTo(devicePixelRatio, 2);
    expect(rasterScaleY, 'the Retina raster doubles logical document height').toBeCloseTo(devicePixelRatio, 2);

    await zoomAndRotate(page);
    const workspaceBox = await workspace.boundingBox();
    expect(workspaceBox, 'the workspace can be panned while zoomed').not.toBeNull();
    if (!workspaceBox) return;
    const viewCenter = { x: workspaceBox.x + workspaceBox.width / 2, y: workspaceBox.y + workspaceBox.height / 2 };
    await clickToolButton(page, 'hand');
    await page.mouse.move(viewCenter.x - 18, viewCenter.y - 12);
    await page.mouse.down();
    await page.mouse.move(viewCenter.x + 22, viewCenter.y + 16, { steps: 8 });
    await page.mouse.up();
    await expect(workspace).not.toHaveAttribute('data-view-pan-x', '0');

    await clickToolButton(page, 'text');
    await setTextToolColor(page, '#ff0000');
    const textView = await readViewGeometry(page);
    expect(textView.viewRotation, 'Text is placed in the rotated view').not.toBe(0);
    expect(textView.viewPanX, 'Text is placed in the panned view').not.toBe(0);
    const textAnchor = documentToPagePoint(textView, {
      x: textView.documentWidth / 2,
      y: textView.documentHeight / 2,
    });
    const textOverlay = page.getByTestId('text-edit-overlay');
    await page.mouse.click(textAnchor.x, textAnchor.y);
    await expect(textOverlay, 'the zoomed Text click opens the point-text editor').toBeVisible();
    const textBox = await textOverlay.boundingBox();
    expect(textBox, 'the Type editor has screen-space geometry').not.toBeNull();
    expect(Math.abs(textBox!.x + textBox!.width / 2 - textAnchor.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(textBox!.y + textBox!.height / 2 - textAnchor.y)).toBeLessThanOrEqual(3);
    await textOverlay.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('HI DPI');
    await expect(textOverlay).toHaveText('HI DPI');

    const documentTransform = await page.locator('.zoom-container').evaluate((element) => {
      const style = getComputedStyle(element);
      return { transform: style.transform, origin: style.transformOrigin };
    });
    const textTransform = await page.getByTestId('text-edit-view-transform').evaluate((element) => {
      const style = getComputedStyle(element);
      return { transform: style.transform, origin: style.transformOrigin };
    });
    expect(textTransform, 'Text editing shares the transformed document view').toEqual(documentTransform);

    await clickToolButton(page, 'crop');
    await expect(textOverlay, 'switching to Crop commits the Text draft').toHaveCount(0);
    const layers = page.getByTitle('Drag to reorder');
    await expect(layers, 'the committed Text is a single editable layer').toHaveCount(2);
    const textRaster = await readCanvasRaster(page, 'workspace-canvas');
    const textSignature = rasterSignature(textRaster);
    const textRedPixels = countRedPixels(textRaster);
    expect(textRedPixels, 'the point-text commit writes visible red pixels').toBeGreaterThan(20);

    const cropView = await readViewGeometry(page);
    const cropRect = {
      left: Math.round(cropView.documentWidth * 0.28),
      top: Math.round(cropView.documentHeight * 0.25),
      right: Math.round(cropView.documentWidth * 0.72),
      bottom: Math.round(cropView.documentHeight * 0.75),
    };
    const cropCorners = [
      documentToPagePoint(cropView, { x: cropRect.left, y: cropRect.top }),
      documentToPagePoint(cropView, { x: cropRect.right, y: cropRect.top }),
      documentToPagePoint(cropView, { x: cropRect.left, y: cropRect.bottom }),
      documentToPagePoint(cropView, { x: cropRect.right, y: cropRect.bottom }),
    ];
    const expectedGuide = {
      left: Math.min(...cropCorners.map(({ x }) => x)),
      top: Math.min(...cropCorners.map(({ y }) => y)),
      right: Math.max(...cropCorners.map(({ x }) => x)),
      bottom: Math.max(...cropCorners.map(({ y }) => y)),
    };
    await dragDocumentPoints(
      page,
      { x: cropRect.left, y: cropRect.top },
      { x: cropRect.right, y: cropRect.bottom },
      20
    );
    await page.mouse.up();
    const guideBox = await page.getByTestId('crop-composition-guide').boundingBox();
    expect(guideBox, 'Crop shows its transformed guide after the drag').not.toBeNull();
    expect(Math.abs(guideBox!.x - expectedGuide.left)).toBeLessThanOrEqual(3);
    expect(Math.abs(guideBox!.y - expectedGuide.top)).toBeLessThanOrEqual(3);
    expect(Math.abs(guideBox!.x + guideBox!.width - expectedGuide.right)).toBeLessThanOrEqual(3);
    expect(Math.abs(guideBox!.y + guideBox!.height - expectedGuide.bottom)).toBeLessThanOrEqual(3);

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const cropWidth = cropRect.right - cropRect.left;
    const cropHeight = cropRect.bottom - cropRect.top;
    await expect.poll(async () => (await readViewGeometry(page)).documentWidth).toBe(cropWidth);
    const croppedView = await readViewGeometry(page);
    expect(croppedView.documentWidth, 'Crop commits the document-space width').toBe(cropWidth);
    expect(croppedView.documentHeight, 'Crop commits the document-space height').toBe(cropHeight);
    expect(
      Math.abs(croppedView.scale * croppedView.viewZoom - cropView.scale * cropView.viewZoom),
      'cropping preserves the zoomed document-pixel scale'
    ).toBeLessThan(0.000001);
    const croppedRaster = await readCanvasRaster(page, 'workspace-canvas');
    const croppedSignature = rasterSignature(croppedRaster);
    expect(croppedRaster.width, 'the crop raster keeps the Retina width').toBe(Math.round(cropWidth * rasterScaleX));
    expect(croppedRaster.height, 'the crop raster keeps the Retina height').toBe(Math.round(cropHeight * rasterScaleY));
    const expectedCropPixels = rasterRegionSignature(textRaster, {
      x: Math.round(cropRect.left * rasterScaleX),
      y: Math.round(cropRect.top * rasterScaleY),
      width: croppedRaster.width,
      height: croppedRaster.height,
    });
    expect(croppedSignature, 'Crop preserves every Text pixel at the shifted high-DPI frame origin').toBe(
      expectedCropPixels
    );
    expect(countRedPixels(croppedRaster), 'the crop keeps all committed text pixels').toBe(textRedPixels);

    const replayView = await readViewAttributes(page);
    const replayMagnification = croppedView.scale * croppedView.viewZoom;
    const expectReplayView = async (historyStep: string) => {
      await expect(workspace, `${historyStep} preserves slider zoom`).toHaveAttribute(
        'data-view-zoom',
        replayView.zoom
      );
      await expect(workspace, `${historyStep} preserves horizontal pan`).toHaveAttribute(
        'data-view-pan-x',
        replayView.panX
      );
      await expect(workspace, `${historyStep} preserves vertical pan`).toHaveAttribute(
        'data-view-pan-y',
        replayView.panY
      );
      await expect(workspace, `${historyStep} preserves rotation`).toHaveAttribute(
        'data-view-rotation',
        replayView.rotation
      );
      const currentView = await readViewGeometry(page);
      expect(
        Math.abs(currentView.scale * currentView.viewZoom - replayMagnification),
        `${historyStep} preserves the effective document magnification across frame-size changes`
      ).toBeLessThan(0.000001);
    };

    await page.getByTestId('undo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(textSignature);
    await expectReplayView('Crop undo');
    await expect.poll(async () => (await readViewGeometry(page)).documentWidth).toBe(openingView.documentWidth);
    const undoCropView = await readViewGeometry(page);
    expect(undoCropView.documentWidth).toBe(openingView.documentWidth);
    expect(undoCropView.documentHeight).toBe(openingView.documentHeight);

    await page.getByTestId('undo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(openingSignature);
    await expect(layers, 'Text undo removes the single committed text layer').toHaveCount(1);
    await expectReplayView('Text undo');

    await page.getByTestId('redo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(textSignature);
    await expect(layers).toHaveCount(2);
    await expectReplayView('Text redo');
    await page.getByTestId('redo-button').click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(croppedSignature);
    await expectReplayView('Crop redo');
    await expect.poll(async () => (await readViewGeometry(page)).documentWidth).toBe(cropWidth);
    const redoCropView = await readViewGeometry(page);
    expect(redoCropView.documentWidth).toBe(cropWidth);
    expect(redoCropView.documentHeight).toBe(cropHeight);

    await clickToolButton(page, 'text');
    const reenteredPoint = documentToPagePoint(redoCropView, {
      x: textView.documentWidth / 2 - cropRect.left,
      y: textView.documentHeight / 2 - cropRect.top,
    });
    await page.mouse.click(reenteredPoint.x, reenteredPoint.y);
    await expect(textOverlay, 'the cropped Type source remains editable after redo').toHaveText('HI DPI');
    await expect(layers, 're-entering Text does not duplicate its source layer').toHaveCount(2);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => rasterSignature(await readCanvasRaster(page, 'workspace-canvas')))
      .toBe(croppedSignature);
  });
});
