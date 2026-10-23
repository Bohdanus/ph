import { type Page, expect, test } from './fixtures/extended-test';
import { getWorkspaceCanvas, loadImageData, type BoundingBox } from './helpers/canvas-helpers';
import { clickToolButton, expectToolSelected } from './helpers/toolbar-helpers';

type StrokeBounds = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const GESTURE_Y_OFFSET = 72;

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page), 'the seeded document canvas must be visible').toBeVisible();
}

async function workspaceBounds(page: Page): Promise<BoundingBox> {
  const box = await page.getByTestId('workspace-container').boundingBox();
  if (!box) throw new Error('workspace-container has no bounding box');
  return box;
}

async function actualMagnification(page: Page): Promise<number> {
  const workspace = page.getByTestId('workspace-container');
  const [documentWidth, documentHeight, viewScale, box] = await Promise.all([
    workspace.getAttribute('data-fit-document-width'),
    workspace.getAttribute('data-fit-document-height'),
    workspace.getAttribute('data-view-effective-zoom'),
    workspace.boundingBox(),
  ]);
  if (!documentWidth || !documentHeight || !viewScale || !box)
    throw new Error('workspace fit or view scale is missing');
  const fitScale = Math.min(box.width / Number(documentWidth), box.height / Number(documentHeight));
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  return Number(fitScale) * Number(viewScale) * devicePixelRatio;
}

async function workspaceFitScale(page: Page): Promise<number> {
  const workspace = page.getByTestId('workspace-container');
  const [documentWidth, documentHeight, box] = await Promise.all([
    workspace.getAttribute('data-fit-document-width'),
    workspace.getAttribute('data-fit-document-height'),
    workspace.boundingBox(),
  ]);
  if (!documentWidth || !documentHeight || !box) throw new Error('workspace fit geometry is missing');
  return Math.min(box.width / Number(documentWidth), box.height / Number(documentHeight));
}

async function captureWorkspace(page: Page, box: BoundingBox): Promise<Buffer> {
  return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
}

function drawGestureRegion(box: BoundingBox) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2 + GESTURE_Y_OFFSET;
  return { left: centerX - 100, top: centerY - 45, right: centerX + 100, bottom: centerY + 45 };
}

/** Measure pixels changed inside the expected horizontal gesture corridor, in CSS pixels. */
async function measureStrokeChange(
  before: Buffer,
  after: Buffer,
  box: BoundingBox
): Promise<{ bounds: StrokeBounds | null; changedPixelCount: number }> {
  const [previous, current] = await Promise.all([loadImageData(before), loadImageData(after)]);
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new Error(
      `Workspace captures changed size: ${previous.width}x${previous.height} -> ${current.width}x${current.height}`
    );
  }

  const scaleX = current.width / box.width;
  const scaleY = current.height / box.height;
  const centerX = current.width / 2;
  const centerY = current.height / 2 + GESTURE_Y_OFFSET * scaleY;
  const startX = centerX - 50 * scaleX;
  const endX = centerX + 50 * scaleX;
  let left = current.width;
  let right = -1;
  let top = current.height;
  let bottom = -1;
  let changedPixelCount = 0;

  const minX = Math.max(0, Math.floor(startX - 40 * scaleX));
  const maxX = Math.min(current.width - 1, Math.ceil(endX + 40 * scaleX));
  const minY = Math.max(0, Math.floor(centerY - 40 * scaleY));
  const maxY = Math.min(current.height - 1, Math.ceil(centerY + 40 * scaleY));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (y * current.width + x) * 4;
      const difference = Math.max(
        Math.abs(current.data[offset] - previous.data[offset]),
        Math.abs(current.data[offset + 1] - previous.data[offset + 1]),
        Math.abs(current.data[offset + 2] - previous.data[offset + 2])
      );
      if (difference < 24) continue;
      changedPixelCount++;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < 0 || bottom < 0) return { bounds: null, changedPixelCount };
  return {
    bounds: {
      left: left / scaleX,
      right: right / scaleX,
      top: top / scaleY,
      bottom: bottom / scaleY,
      width: (right - left + 1) / scaleX,
      height: (bottom - top + 1) / scaleY,
    },
    changedPixelCount,
  };
}

async function measureChangedPixelsInRegion(
  before: Buffer,
  after: Buffer,
  box: BoundingBox,
  region: { left: number; top: number; right: number; bottom: number }
): Promise<{ changedPixelCount: number; bounds: StrokeBounds | null }> {
  const [previous, current] = await Promise.all([loadImageData(before), loadImageData(after)]);
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new Error(
      `Workspace captures changed size: ${previous.width}x${previous.height} -> ${current.width}x${current.height}`
    );
  }

  const scaleX = current.width / box.width;
  const scaleY = current.height / box.height;
  const minX = Math.max(0, Math.floor((region.left - box.x) * scaleX));
  const maxX = Math.min(current.width - 1, Math.ceil((region.right - box.x) * scaleX));
  const minY = Math.max(0, Math.floor((region.top - box.y) * scaleY));
  const maxY = Math.min(current.height - 1, Math.ceil((region.bottom - box.y) * scaleY));
  let left = current.width;
  let right = -1;
  let top = current.height;
  let bottom = -1;
  let changedPixelCount = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (y * current.width + x) * 4;
      const difference = Math.max(
        Math.abs(current.data[offset] - previous.data[offset]),
        Math.abs(current.data[offset + 1] - previous.data[offset + 1]),
        Math.abs(current.data[offset + 2] - previous.data[offset + 2])
      );
      if (difference < 24) continue;
      changedPixelCount++;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < 0 || bottom < 0) return { changedPixelCount, bounds: null };
  return {
    changedPixelCount,
    bounds: {
      left: box.x + left / scaleX,
      right: box.x + right / scaleX,
      top: box.y + top / scaleY,
      bottom: box.y + bottom / scaleY,
      width: (right - left + 1) / scaleX,
      height: (bottom - top + 1) / scaleY,
    },
  };
}

async function countMaskDisagreements(
  baseline: Buffer,
  first: Buffer,
  second: Buffer,
  box: BoundingBox,
  region: { left: number; top: number; right: number; bottom: number }
): Promise<{ disagreements: number; changedPixels: number }> {
  const [base, firstImage, secondImage] = await Promise.all([
    loadImageData(baseline),
    loadImageData(first),
    loadImageData(second),
  ]);
  if (
    base.width !== firstImage.width ||
    base.width !== secondImage.width ||
    base.height !== firstImage.height ||
    base.height !== secondImage.height
  ) {
    throw new Error('Workspace captures changed size while comparing pixel masks');
  }

  const scaleX = base.width / box.width;
  const scaleY = base.height / box.height;
  const minX = Math.max(0, Math.floor((region.left - box.x) * scaleX));
  const maxX = Math.min(base.width - 1, Math.ceil((region.right - box.x) * scaleX));
  const minY = Math.max(0, Math.floor((region.top - box.y) * scaleY));
  const maxY = Math.min(base.height - 1, Math.ceil((region.bottom - box.y) * scaleY));
  let disagreements = 0;
  let changedPixels = 0;

  const changedAt = (image: typeof firstImage, offset: number) =>
    Math.max(
      Math.abs(image.data[offset] - base.data[offset]),
      Math.abs(image.data[offset + 1] - base.data[offset + 1]),
      Math.abs(image.data[offset + 2] - base.data[offset + 2])
    ) >= 24;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (y * base.width + x) * 4;
      const firstChanged = changedAt(firstImage, offset);
      const secondChanged = changedAt(secondImage, offset);
      if (firstChanged || secondChanged) changedPixels++;
      if (firstChanged !== secondChanged) disagreements++;
    }
  }

  return { disagreements, changedPixels };
}

async function expectMatchingPixelMasks(
  baseline: Buffer,
  first: Buffer,
  second: Buffer,
  box: BoundingBox,
  region: { left: number; top: number; right: number; bottom: number },
  description: string
): Promise<void> {
  const { disagreements, changedPixels } = await countMaskDisagreements(baseline, first, second, box, region);
  expect(
    disagreements,
    `${description}; differing mask pixels=${disagreements}, changed pixels=${changedPixels}`
  ).toBeLessThanOrEqual(Math.max(8, Math.ceil(changedPixels * 0.06)));
}

async function beginGesture(page: Page, box: BoundingBox): Promise<void> {
  const y = box.y + box.height / 2 + GESTURE_Y_OFFSET;
  await page.mouse.move(box.x + box.width / 2 - 50, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, y, { steps: 24 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

async function dragZoomSliderTo(page: Page, targetZoom: number): Promise<void> {
  const slider = page.locator('#view-zoom-slider');
  const target = await slider.evaluate((element, zoom) => {
    const input = element as HTMLInputElement;
    const rect = input.getBoundingClientRect();
    const thumbWidth = 16;
    const minPosition = Number(input.min);
    const maxPosition = Number(input.max);
    const currentPosition = Number(input.value);
    const targetProgress = Math.log(zoom / 0.1) / Math.log(32 / 0.1);
    const positionToX = (position: number) =>
      rect.left + thumbWidth / 2 + ((position - minPosition) / (maxPosition - minPosition)) * (rect.width - thumbWidth);
    return {
      startX: positionToX(currentPosition),
      targetX: positionToX(minPosition + targetProgress * (maxPosition - minPosition)),
      y: rect.top + rect.height / 2,
    };
  }, targetZoom);
  await page.mouse.move(target.startX, target.y);
  await page.mouse.down();
  await page.mouse.move(target.targetX, target.y, { steps: 32 });
  await page.mouse.up();
}

function expectGestureBounds(bounds: StrokeBounds | null, box: BoundingBox): asserts bounds is StrokeBounds {
  expect(bounds, 'the draw preview or committed stroke must change pixels').not.toBeNull();
  if (!bounds) return;
  const expectedY = box.height / 2 + GESTURE_Y_OFFSET;
  expect(bounds.left, 'the stroke must begin at the mouse gesture').toBeLessThanOrEqual(box.width / 2 - 47);
  expect(bounds.right, 'the stroke must reach the mouse gesture end').toBeGreaterThanOrEqual(box.width / 2 + 47);
  expect(
    Math.abs((bounds.top + bounds.bottom) / 2 - expectedY),
    'the stroke must remain centered on the mouse path'
  ).toBeLessThan(3);
}

test.describe('Zoom tool', () => {
  test.use({ deviceScaleFactor: 2 });

  test('keeps a long slider fixed while a pointer drag crosses 100%', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'zoom');
    const slider = page.locator('#view-zoom-slider');
    const label = page.locator('label[for="view-zoom-slider"]');
    const sliderBox = await slider.boundingBox();
    expect(sliderBox, 'the zoom slider must be measurable').not.toBeNull();
    expect(sliderBox!.width, 'the zoom slider must provide a long drag target').toBeGreaterThanOrEqual(300);

    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#view-zoom-slider');
      if (!input) throw new Error('zoom slider is missing');
      document.documentElement.dataset.zoomSamples = '[]';
      input.addEventListener('input', () => {
        const value = Number(input.value);
        requestAnimationFrame(() => {
          const rect = input.getBoundingClientRect();
          const samples = JSON.parse(document.documentElement.dataset.zoomSamples ?? '[]') as Array<{
            value: number;
            x: number;
            width: number;
            label: string;
          }>;
          samples.push({
            value,
            x: rect.x,
            width: rect.width,
            label: input.labels?.[0]?.textContent?.trim() ?? '',
          });
          document.documentElement.dataset.zoomSamples = JSON.stringify(samples);
        });
      });
    });

    await page.getByRole('button', { name: '100%', exact: true }).click();
    await expect(label).toHaveText('Zoom 100%');
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(1, 2);

    await dragZoomSliderTo(page, 0.99);
    await expect(label).toHaveText('Zoom 99%');
    await page.evaluate(() => {
      document.documentElement.dataset.zoomSamples = '[]';
    });

    const start = await slider.evaluate((input) => {
      const rect = input.getBoundingClientRect();
      const thumbWidth = 16;
      const range = input as HTMLInputElement;
      const min = Number(range.min);
      const max = Number(range.max);
      const progress = (Number(range.value) - min) / (max - min);
      return {
        x: rect.left + thumbWidth / 2 + progress * (rect.width - thumbWidth),
        y: rect.top + rect.height / 2,
        sliderX: rect.x,
        sliderWidth: rect.width,
      };
    });

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 2, start.y, { steps: 24 });
    await page.mouse.up();
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(1.01);

    const samples = await page.evaluate(
      () =>
        JSON.parse(document.documentElement.dataset.zoomSamples ?? '[]') as Array<{
          value: number;
          x: number;
          width: number;
          label: string;
        }>
    );
    expect(samples.length, 'the drag must deliver multiple slider updates').toBeGreaterThan(2);
    expect(
      samples.some((sample) => sample.label === 'Zoom 100%'),
      'the drag must pass through the 100% readout'
    ).toBe(true);
    expect(samples.at(-1)!.label).not.toBe('Zoom 99%');
    for (let index = 1; index < samples.length; index++) {
      expect(samples[index].value, 'slider progress must not reverse during the drag').toBeGreaterThanOrEqual(
        samples[index - 1].value
      );
      expect(samples[index].x, 'the slider track must not shift under the pointer').toBeCloseTo(start.sliderX, 1);
      expect(samples[index].width, 'the slider track width must remain fixed').toBeCloseTo(start.sliderWidth, 1);
    }
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  });

  test('Zoom Tool gestures share the slider absolute magnification limit', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'zoom');
    await dragZoomSliderTo(page, 31.9);
    await expect.poll(() => actualMagnification(page)).toBeLessThanOrEqual(32);

    const zoomArea = page.getByTestId('zoom-tool-area');
    const area = await zoomArea.boundingBox();
    expect(area, 'the Zoom Tool must own the workspace gesture surface').not.toBeNull();
    const startX = area!.x + area!.width / 2;
    const startY = area!.y + area!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 32, startY, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => actualMagnification(page)).toBeCloseTo(32, 2);
    await expect(page.locator('label[for="view-zoom-slider"]')).toHaveText('Zoom 3200%');
  });

  test('keeps physical magnification stable when the workspace is resized', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'zoom');
    await page.getByRole('button', { name: '100%', exact: true }).click();
    await expect(page.locator('label[for="view-zoom-slider"]')).toHaveText('Zoom 100%');
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(1, 2);

    const initialFitScale = await workspaceFitScale(page);
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(() => workspaceFitScale(page)).not.toBeCloseTo(initialFitScale, 2);
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(1, 2);
    await expect(page.locator('label[for="view-zoom-slider"]')).toHaveText('Zoom 100%');
  });

  test('Fit On Screen follows the new workspace size after a resize', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'zoom');
    const initialFitScale = await workspaceFitScale(page);

    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(() => workspaceFitScale(page)).not.toBeCloseTo(initialFitScale, 2);
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-effective-zoom', '1');

    const [fitScale, devicePixelRatio] = await Promise.all([
      workspaceFitScale(page),
      page.evaluate(() => window.devicePixelRatio),
    ]);
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(fitScale * devicePixelRatio, 2);
  });

  test('keeps an active Zoom Tool drag continuous when the workspace is resized', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'zoom');
    await page.getByRole('button', { name: '100%', exact: true }).click();
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(1, 2);

    const area = await page.getByTestId('zoom-tool-area').boundingBox();
    expect(area, 'the Zoom Tool must own the workspace gesture surface').not.toBeNull();
    const startX = area!.x + area!.width / 2;
    const startY = area!.y + area!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 32, startY, { steps: 8 });
    const magnificationAfterFirstMove = Math.pow(2, 32 / 160);
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(magnificationAfterFirstMove, 2);

    const previousFitScale = await workspaceFitScale(page);
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(() => workspaceFitScale(page)).not.toBeCloseTo(previousFitScale, 2);
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(magnificationAfterFirstMove, 2);

    await page.mouse.move(startX + 64, startY, { steps: 8 });
    const expectedMagnification = Math.pow(2, 64 / 160);
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(expectedMagnification, 2);
    await page.mouse.up();
  });

  test('draw preview follows the mouse after zoom and undo/redo replays the same stroke', async ({ page }) => {
    await openWorkspace(page);
    const box = await workspaceBounds(page);
    const undo = page.getByTestId('undo-button');
    const redo = page.getByTestId('redo-button');

    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');
    const fitBaseline = await captureWorkspace(page, box);
    await beginGesture(page, box);
    const fitPreview = await captureWorkspace(page, box);
    const fitPreviewBounds = (await measureStrokeChange(fitBaseline, fitPreview, box)).bounds;
    expectGestureBounds(fitPreviewBounds, box);
    await page.mouse.up();
    await expect(undo).toBeEnabled();
    const fitCommitted = await captureWorkspace(page, box);
    const fitCommittedBounds = (await measureStrokeChange(fitBaseline, fitCommitted, box)).bounds;
    expectGestureBounds(fitCommittedBounds, box);
    await expectMatchingPixelMasks(
      fitBaseline,
      fitPreview,
      fitCommitted,
      box,
      drawGestureRegion(box),
      'the fit-scale preview and committed draw stroke must match changed-pixel coverage within raster tolerance'
    );
    await expect(redo).toBeDisabled();

    await undo.click();
    await expect(redo).toBeEnabled();
    const fitUndone = await captureWorkspace(page, box);
    expect((await measureStrokeChange(fitBaseline, fitUndone, box)).changedPixelCount).toBeLessThanOrEqual(4);

    await clickToolButton(page, 'zoom');
    await dragZoomSliderTo(page, 2);
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(2, 1);
    const zoomedState = await page.getByTestId('workspace-container').getAttribute('data-view-zoom');
    if (!zoomedState) throw new Error('workspace zoom state is missing after slider zoom');
    const fitScale = await workspaceFitScale(page);
    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    expect(fitScale, 'the pointer tools and zoom control must share a measured image fit').toBeGreaterThan(0);
    await expect(undo).toBeDisabled();

    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');
    const zoomBaseline = await captureWorkspace(page, box);
    await beginGesture(page, box);
    const zoomPreview = await captureWorkspace(page, box);
    const zoomPreviewBounds = (await measureStrokeChange(zoomBaseline, zoomPreview, box)).bounds;
    expectGestureBounds(zoomPreviewBounds, box);
    const previewScaleRatio = zoomPreviewBounds!.height / fitPreviewBounds!.height;
    const expectedPreviewScaleRatio = 2 / (devicePixelRatio * fitScale);
    expect(previewScaleRatio, 'the preview must scale to the requested absolute magnification').toBeGreaterThan(
      expectedPreviewScaleRatio * 0.8
    );
    expect(previewScaleRatio, 'the preview must scale to the requested absolute magnification').toBeLessThan(
      expectedPreviewScaleRatio * 1.2
    );

    await page.mouse.up();
    await expect(undo).toBeEnabled();
    const zoomCommitted = await captureWorkspace(page, box);
    const zoomCommittedBounds = (await measureStrokeChange(zoomBaseline, zoomCommitted, box)).bounds;
    expectGestureBounds(zoomCommittedBounds, box);
    await expectMatchingPixelMasks(
      zoomBaseline,
      zoomPreview,
      zoomCommitted,
      box,
      drawGestureRegion(box),
      'the zoomed preview and committed draw stroke must match changed-pixel coverage within raster tolerance'
    );
    expect(Math.abs(zoomCommittedBounds!.left - zoomPreviewBounds!.left)).toBeLessThanOrEqual(3);
    expect(Math.abs(zoomCommittedBounds!.right - zoomPreviewBounds!.right)).toBeLessThanOrEqual(3);
    expect(Math.abs(zoomCommittedBounds!.top - zoomPreviewBounds!.top)).toBeLessThanOrEqual(3);
    expect(Math.abs(zoomCommittedBounds!.bottom - zoomPreviewBounds!.bottom)).toBeLessThanOrEqual(3);

    await undo.click();
    await expect(redo).toBeEnabled();
    const zoomUndone = await captureWorkspace(page, box);
    expect((await measureStrokeChange(zoomBaseline, zoomUndone, box)).changedPixelCount).toBeLessThanOrEqual(4);
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-zoom', zoomedState);

    await redo.click();
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();
    const zoomRedone = await captureWorkspace(page, box);
    const zoomRedoneBounds = (await measureStrokeChange(zoomBaseline, zoomRedone, box)).bounds;
    expectGestureBounds(zoomRedoneBounds, box);
    await expectMatchingPixelMasks(
      zoomBaseline,
      zoomCommitted,
      zoomRedone,
      box,
      drawGestureRegion(box),
      'redo must restore the committed changed-pixel mask within raster tolerance'
    );
    expect(Math.abs(zoomRedoneBounds!.left - zoomCommittedBounds!.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(zoomRedoneBounds!.right - zoomCommittedBounds!.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(zoomRedoneBounds!.top - zoomCommittedBounds!.top)).toBeLessThanOrEqual(2);
    expect(Math.abs(zoomRedoneBounds!.bottom - zoomCommittedBounds!.bottom)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('workspace-container')).toHaveAttribute('data-view-zoom', zoomedState);
  });

  test('text placement follows a click after slider zoom and replays at that view', async ({ page }) => {
    await openWorkspace(page);
    const box = await workspaceBounds(page);
    const workspace = page.getByTestId('workspace-container');
    await clickToolButton(page, 'zoom');
    await dragZoomSliderTo(page, 2);
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(2, 1);
    const zoomedState = await workspace.getAttribute('data-view-zoom');
    if (!zoomedState) throw new Error('workspace zoom state is missing after slider zoom');

    await clickToolButton(page, 'text');
    await expectToolSelected(page, 'text');
    const anchor = { x: box.x + box.width / 2 + 83, y: box.y + box.height / 2 + 47 };
    const textBaseline = await captureWorkspace(page, box);
    await page.mouse.click(anchor.x, anchor.y);

    const textOverlay = page.getByTestId('text-edit-overlay');
    await expect(textOverlay, 'zoomed text placement must open its editor at the click').toBeVisible();
    const overlayBox = await textOverlay.boundingBox();
    expect(overlayBox, 'the text editor must have screen-space geometry').not.toBeNull();
    expect(
      Math.abs(overlayBox!.x + overlayBox!.width / 2 - anchor.x),
      'point text must stay centered on the click'
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(overlayBox!.y + overlayBox!.height / 2 - anchor.y),
      'point text must stay centered on the click'
    ).toBeLessThanOrEqual(3);

    const layerRows = page.getByTitle('Drag to reorder');
    const initialLayerCount = await layerRows.count();
    await textOverlay.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Zoomed');
    await expect(textOverlay, 'the typed content must remain in the editor before commit').toHaveText('Zoomed');
    const typedOverlayBox = await textOverlay.boundingBox();
    expect(typedOverlayBox, 'the typed text editor must retain screen-space geometry').not.toBeNull();
    expect(
      Math.abs(typedOverlayBox!.x + typedOverlayBox!.width / 2 - anchor.x),
      'typing must preserve the point-text click anchor horizontally'
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(typedOverlayBox!.y + typedOverlayBox!.height / 2 - anchor.y),
      'typing must preserve the point-text click anchor vertically'
    ).toBeLessThanOrEqual(3);
    await page.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(textOverlay).toHaveCount(0);
    await expect(layerRows).toHaveCount(initialLayerCount + 1);
    await expect(page.getByTestId('undo-button')).toBeEnabled();
    const textCommitted = await captureWorkspace(page, box);
    const textRegion = {
      left: typedOverlayBox!.x - 3,
      top: typedOverlayBox!.y - 3,
      right: typedOverlayBox!.x + typedOverlayBox!.width + 3,
      bottom: typedOverlayBox!.y + typedOverlayBox!.height + 3,
    };
    const committedText = await measureChangedPixelsInRegion(textBaseline, textCommitted, box, textRegion);
    expect(
      committedText.changedPixelCount,
      'committed text must change pixels inside its editor bounds'
    ).toBeGreaterThan(10);
    expect(committedText.bounds, 'committed text pixels must be measurable').not.toBeNull();
    expect(
      Math.abs((committedText.bounds!.left + committedText.bounds!.right) / 2 - anchor.x),
      'committed text ink must remain near the requested click horizontally'
    ).toBeLessThan(20);
    expect(
      Math.abs((committedText.bounds!.top + committedText.bounds!.bottom) / 2 - anchor.y),
      'committed text ink must remain near the requested click vertically'
    ).toBeLessThan(20);

    await page.getByTestId('undo-button').click();
    await expect(layerRows).toHaveCount(initialLayerCount);
    await expect(page.getByTestId('redo-button')).toBeEnabled();
    await expect(page.getByTestId('undo-button')).toBeDisabled();
    await expect(workspace).toHaveAttribute('data-view-zoom', zoomedState);
    const textUndone = await captureWorkspace(page, box);
    expect(
      (await measureChangedPixelsInRegion(textBaseline, textUndone, box, textRegion)).changedPixelCount,
      'undo must remove the committed text pixels'
    ).toBeLessThanOrEqual(4);

    await page.getByTestId('redo-button').click();
    await expect(layerRows).toHaveCount(initialLayerCount + 1);
    await expect(page.getByTestId('redo-button')).toBeDisabled();
    await expect(workspace).toHaveAttribute('data-view-zoom', zoomedState);
    const textRedone = await captureWorkspace(page, box);
    const redoneText = await measureChangedPixelsInRegion(textBaseline, textRedone, box, textRegion);
    expect(redoneText.changedPixelCount, 'redo must restore committed text pixels').toBeGreaterThan(10);
    await expectMatchingPixelMasks(
      textBaseline,
      textCommitted,
      textRedone,
      box,
      textRegion,
      'redo must replay the zoomed text pixels'
    );
  });
});
