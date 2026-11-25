import { expect, test } from './fixtures/extended-test';
import { getColorAtPoint, getWorkspaceCanvas, loadImageData } from './helpers/canvas-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { hasNoCommittedAnts, waitForCommittedAnts } from './helpers/selection-ants';
import { clickToolButton, expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

type CanvasBox = { x: number; y: number; width: number; height: number };
type CanvasPoint = { x: number; y: number };

const pointOnCanvas = (box: CanvasBox, x: number, y: number): CanvasPoint => ({
  x: box.x + box.width * x,
  y: box.y + box.height * y,
});

async function screenshotCanvas(page: Parameters<typeof getWorkspaceCanvas>[0], box: CanvasBox) {
  const screenshot = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    scale: 'css',
  });
  return loadImageData(screenshot);
}

async function sampleScreenshot(image: Awaited<ReturnType<typeof loadImageData>>, x: number, y: number) {
  return getColorAtPoint(image, Math.floor(x * image.width), Math.floor(y * image.height), 0);
}

async function readWorkspacePixel(canvas: ReturnType<typeof getWorkspaceCanvas>, x: number, y: number) {
  return canvas.evaluate(
    (element, point) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('The workspace surface is not a canvas');
      const context = element.getContext('2d');
      if (!context) throw new Error('The workspace canvas has no 2D context');
      const pixelX = Math.min(element.width - 1, Math.max(0, Math.floor(element.width * point.x)));
      const pixelY = Math.min(element.height - 1, Math.max(0, Math.floor(element.height * point.y)));
      const { data } = context.getImageData(pixelX, pixelY, 1, 1);
      return { red: data[0], green: data[1], blue: data[2], alpha: data[3] };
    },
    { x, y }
  );
}

async function selectBrushOrPencil(
  page: Parameters<typeof getWorkspaceCanvas>[0],
  toolName: 'brush' | 'pencil'
): Promise<void> {
  if (toolName === 'brush') {
    await clickToolButton(page, 'brush');
  } else {
    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'pencil', label: 'Pencil Tool' });
  }
  await expectToolSelected(page, toolName);
}

for (const toolName of ['brush', 'pencil'] as const) {
  test(`${toolName} paints only inside the active selection and remains undoable`, async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The workspace canvas has no visible bounds');

    await clickToolButton(page, 'rectangular-selection');
    const selectionStart = pointOnCanvas(box, 0.3, 0.3);
    const selectionEnd = pointOnCanvas(box, 0.7, 0.7);
    await page.mouse.move(selectionStart.x, selectionStart.y);
    await page.mouse.down();
    await page.mouse.move(selectionEnd.x, selectionEnd.y, { steps: 12 });
    await page.mouse.up();
    await waitForCommittedAnts(page, 'the paint-constraining selection');

    await selectBrushOrPencil(page, toolName);
    await expect(page.getByTestId('selection-ants-canvas')).toBeVisible();
    await setForegroundColor(page, '#cc0000');

    const baselineCanvasInside = await readWorkspacePixel(canvas, 0.5, 0.5);
    const baselineCanvasLeft = await readWorkspacePixel(canvas, 0.15, 0.5);
    const baselineCanvasRight = await readWorkspacePixel(canvas, 0.85, 0.5);
    const baselinePreview = await screenshotCanvas(page, box);
    const baselineInside = await sampleScreenshot(baselinePreview, 0.5, 0.5);
    const baselineLeft = await sampleScreenshot(baselinePreview, 0.15, 0.5);
    const baselineRight = await sampleScreenshot(baselinePreview, 0.85, 0.5);

    const strokeStart = pointOnCanvas(box, 0.1, 0.5);
    const strokeEnd = pointOnCanvas(box, 0.9, 0.5);
    await page.mouse.move(strokeStart.x, strokeStart.y);
    await page.mouse.down();
    await page.mouse.move(strokeEnd.x, strokeEnd.y, { steps: 16 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        })
    );

    const preview = await screenshotCanvas(page, box);
    const previewInside = await sampleScreenshot(preview, 0.5, 0.5);
    const previewLeft = await sampleScreenshot(preview, 0.15, 0.5);
    const previewRight = await sampleScreenshot(preview, 0.85, 0.5);
    expect(previewInside?.green ?? 255, 'the live red stroke appears inside the selection').toBeLessThan(
      (baselineInside?.green ?? 255) - 60
    );
    expect(previewLeft, 'the live preview does not paint left of the selection').toEqual(baselineLeft);
    expect(previewRight, 'the live preview does not paint right of the selection').toEqual(baselineRight);

    await page.mouse.up();
    await expect
      .poll(async () => {
        const pixel = await readWorkspacePixel(canvas, 0.5, 0.5);
        return pixel.red > 120 && pixel.green < 100;
      }, 'the committed paint layer becomes visible at the selection center')
      .toBe(true);
    const committedInside = await readWorkspacePixel(canvas, 0.5, 0.5);
    const committedProfile = await Promise.all(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((x) => readWorkspacePixel(canvas, x, 0.5))
    );
    expect(
      committedInside.red,
      `the committed stroke changes pixels inside the selection; profile=${JSON.stringify(committedProfile)}`
    ).toBeGreaterThan(120);
    expect(
      committedInside.green,
      `the committed stroke uses the chosen foreground; profile=${JSON.stringify(committedProfile)}`
    ).toBeLessThan(100);
    const committedVisual = await screenshotCanvas(page, box);
    expect(
      await sampleScreenshot(committedVisual, 0.5, 0.5),
      'the visible pixels inside the selection match across pointer-up'
    ).toEqual(previewInside);

    expect(await readWorkspacePixel(canvas, 0.15, 0.5), 'the committed stroke leaves the left side untouched').toEqual(
      baselineCanvasLeft
    );
    expect(await readWorkspacePixel(canvas, 0.85, 0.5), 'the committed stroke leaves the right side untouched').toEqual(
      baselineCanvasRight
    );

    // Deselect is itself undoable, so undo it before checking that the stroke history entry
    // preserves the selection snapshot it was painted against.
    await page.keyboard.press('Control+d');
    await expect.poll(() => hasNoCommittedAnts(page)).toBe(true);
    await page.getByTestId('undo-button').click();
    await expect(page.getByTestId('selection-ants-canvas')).toBeVisible();
    await expect.poll(() => readWorkspacePixel(canvas, 0.5, 0.5)).toEqual(committedInside);
    await page.getByTestId('undo-button').click();
    await expect.poll(() => readWorkspacePixel(canvas, 0.5, 0.5)).toEqual(baselineCanvasInside);
    await expect(page.getByTestId('selection-ants-canvas')).toBeVisible();
    await page.getByTestId('redo-button').click();
    await expect.poll(() => readWorkspacePixel(canvas, 0.5, 0.5)).toEqual(committedInside);
    await expect(page.getByTestId('selection-ants-canvas')).toBeVisible();
    await page.getByTestId('redo-button').click();
    await expect.poll(() => hasNoCommittedAnts(page)).toBe(true);
  });
}

for (const toolName of ['brush', 'pencil'] as const) {
  test(`${toolName} does not add history for a stroke outside the selection`, async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The workspace canvas has no visible bounds');

    await clickToolButton(page, 'rectangular-selection');
    const selectionStart = pointOnCanvas(box, 0.5, 0.3);
    const selectionEnd = pointOnCanvas(box, 0.75, 0.7);
    await page.mouse.move(selectionStart.x, selectionStart.y);
    await page.mouse.down();
    await page.mouse.move(selectionEnd.x, selectionEnd.y, { steps: 8 });
    await page.mouse.up();
    await waitForCommittedAnts(page, 'the paint-constraining selection');

    await selectBrushOrPencil(page, toolName);
    await setForegroundColor(page, '#cc0000');
    const baseline = await readWorkspacePixel(canvas, 0.2, 0.5);
    const strokeStart = pointOnCanvas(box, 0.08, 0.5);
    const strokeEnd = pointOnCanvas(box, 0.32, 0.5);
    await page.mouse.move(strokeStart.x, strokeStart.y);
    await page.mouse.down();
    await page.mouse.move(strokeEnd.x, strokeEnd.y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => readWorkspacePixel(canvas, 0.2, 0.5)).toEqual(baseline);
    await expect(page.getByTestId('selection-ants-canvas')).toBeVisible();
    await page.getByTestId('undo-button').click();
    await expect.poll(() => hasNoCommittedAnts(page)).toBe(true);
  });
}

test('the selection rasterizer keeps selected pixels at the active backing scale', async ({ page }) => {
  await page.goto('/');
  const pixels = await page.evaluate(async () => {
    const loadDrawModule = new Function('return import("/src/tools/draw.ts")') as () => Promise<{
      drawPaintWithSelection: (...args: never[]) => [OffscreenCanvas];
    }>;
    const { drawPaintWithSelection } = await loadDrawModule();
    const [canvas] = drawPaintWithSelection(
      { size: { width: 100, height: 40 }, backingScale: window.devicePixelRatio } as never,
      {
        alpha: 1,
        color: '#cc0000',
        penType: 'pen',
        lineWidth: 8,
        points: [
          { x: 5, y: 20 },
          { x: 95, y: 20 },
        ],
        toolName: 'draw',
      } as never,
      {
        points: [
          [
            { x: 30, y: 5 },
            { x: 70, y: 5 },
            { x: 70, y: 35 },
            { x: 30, y: 35 },
          ],
        ],
        featherRadius: 0,
        antiAlias: false,
      } as never
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The selection rasterizer did not return a readable canvas');
    const sample = (x: number) => {
      const { data } = context.getImageData(x * window.devicePixelRatio, 20 * window.devicePixelRatio, 1, 1);
      return { red: data[0], green: data[1], alpha: data[3] };
    };
    return { dpr: window.devicePixelRatio, outsideLeft: sample(20), inside: sample(50), outsideRight: sample(80) };
  });

  expect(pixels.outsideLeft.alpha).toBe(0);
  expect(pixels.inside).toMatchObject({ red: 204, green: 0, alpha: 255 });
  expect(pixels.outsideRight.alpha).toBe(0);
});

test('feathered selection edges keep matching preview and committed paint coverage', async ({ page }) => {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The workspace canvas has no visible bounds');

  await openToolFlyout(page, 'freehand-lasso');
  await selectFromFlyout(page, { toolName: 'polygonal-lasso', label: 'Polygonal Lasso Tool' });
  const feather = page.locator('#polygonal-lasso-feather');
  await feather.fill('16');
  await expect(feather).toHaveValue('16');
  for (const [x, y] of [
    [0.35, 0.3],
    [0.65, 0.3],
    [0.65, 0.7],
    [0.35, 0.7],
  ]) {
    const point = pointOnCanvas(box, x, y);
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.press('Enter');
  await waitForCommittedAnts(page, 'the feathered paint-constraining selection');

  await clickToolButton(page, 'brush');
  await setForegroundColor(page, '#cc0000');
  const baseline = await screenshotCanvas(page, box);
  const strokeStart = pointOnCanvas(box, 0.2, 0.5);
  const strokeEnd = pointOnCanvas(box, 0.8, 0.5);
  await page.mouse.move(strokeStart.x, strokeStart.y);
  await page.mouse.down();
  await page.mouse.move(strokeEnd.x, strokeEnd.y, { steps: 16 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      })
  );

  const preview = await screenshotCanvas(page, box);
  const previewInside = await sampleScreenshot(preview, 0.5, 0.5);
  const edgeFractions = Array.from({ length: 41 }, (_, index) => 0.33 + index * 0.001);
  const edgeSamples = await Promise.all(
    edgeFractions.map(async (x) => ({
      x,
      baseline: await sampleScreenshot(baseline, x, 0.5),
      preview: await sampleScreenshot(preview, x, 0.5),
    }))
  );
  const featheredEdge = edgeSamples.find(
    ({ x, baseline: before, preview: after }) =>
      before &&
      after &&
      Math.abs(x - 0.35) > 0.006 &&
      (after.green ?? 255) < (before.green ?? 255) - 10 &&
      (after.green ?? 255) > (previewInside?.green ?? 0) + 10
  );
  expect(
    featheredEdge,
    'the selection feather produces partial edge coverage instead of a hard threshold'
  ).toBeDefined();

  // Compare a device-pixel row covering both soft edges and the 256px preview-tile seams.
  // The tool overlay is raw stroke coverage; composite it over the unchanged document pixels
  // and compare that result with the committed document raster after pointer-up.
  const previewScanline = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLCanvasElement>('[data-testid="workspace-canvas"]');
    const overlay = document.querySelector<HTMLCanvasElement>('[data-testid="tool-overlay-canvas"]');
    const workspaceContext = workspace?.getContext('2d');
    const overlayContext = overlay?.getContext('2d');
    if (!workspace || !overlay || !workspaceContext || !overlayContext) {
      throw new Error('Could not read the workspace and paint overlay canvases');
    }
    if (workspace.width !== overlay.width || workspace.height !== overlay.height) {
      throw new Error('The workspace and paint overlay backing sizes do not match');
    }
    const startX = Math.floor(workspace.width * 0.25);
    const endX = Math.ceil(workspace.width * 0.75);
    const y = Math.floor(workspace.height * 0.5);
    const width = endX - startX;
    const baselineBytes = workspaceContext.getImageData(startX, y, width, 1).data;
    const previewBytes = overlayContext.getImageData(startX, y, width, 1).data;
    return {
      dpr: window.devicePixelRatio,
      startX,
      y,
      width,
      baseline: Array.from(baselineBytes),
      preview: Array.from(previewBytes),
    };
  });
  expect(
    previewScanline.preview.some((value, index) => index % 4 === 3 && value > 0 && value < 255),
    'the raw preview row contains partial feather coverage at the active backing scale'
  ).toBe(true);

  await page.mouse.up();
  await expect
    .poll(async () => (await readWorkspacePixel(canvas, 0.5, 0.5)).green < 100, {
      message: 'the committed feathered paint becomes visible at the selection center',
    })
    .toBe(true);
  const committed = await screenshotCanvas(page, box);
  const committedEdge = await sampleScreenshot(committed, featheredEdge!.x, 0.5);
  expect(committedEdge, 'the feathered edge remains inside the canvas after commit').toBeDefined();
  // Preview and commit composite through separate canvas surfaces. Their integer channel
  // rounding can differ by one level at a soft mask edge even when coverage is equivalent.
  const maxEdgeChannelDelta = Math.max(
    Math.abs((committedEdge?.red ?? 0) - (featheredEdge!.preview?.red ?? 0)),
    Math.abs((committedEdge?.green ?? 0) - (featheredEdge!.preview?.green ?? 0)),
    Math.abs((committedEdge?.blue ?? 0) - (featheredEdge!.preview?.blue ?? 0))
  );
  expect(
    maxEdgeChannelDelta,
    `feathered edge pixels match across pointer-up at x=${featheredEdge!.x}`
  ).toBeLessThanOrEqual(1);
  expect(await sampleScreenshot(committed, 0.5, 0.5)).toEqual(previewInside);

  const committedScanline = await page.evaluate(({ startX, y, width }) => {
    const workspace = document.querySelector<HTMLCanvasElement>('[data-testid="workspace-canvas"]');
    const context = workspace?.getContext('2d');
    if (!context) throw new Error('Could not read the committed workspace canvas');
    return Array.from(context.getImageData(startX, y, width, 1).data);
  }, previewScanline);
  let maxScanlineDelta = 0;
  let worstPixelX = previewScanline.startX;
  for (let pixel = 0; pixel < previewScanline.width; pixel += 1) {
    const offset = pixel * 4;
    const sourceAlpha = previewScanline.preview[offset + 3]! / 255;
    const baselineAlpha = previewScanline.baseline[offset + 3]! / 255;
    const outputAlpha = sourceAlpha + baselineAlpha * (1 - sourceAlpha);
    const expected = [0, 1, 2].map((channel) =>
      outputAlpha === 0
        ? 0
        : Math.round(
            (previewScanline.preview[offset + channel]! * sourceAlpha +
              previewScanline.baseline[offset + channel]! * baselineAlpha * (1 - sourceAlpha)) /
              outputAlpha
          )
    );
    expected.push(Math.round(outputAlpha * 255));
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(expected[channel]! - committedScanline[offset + channel]!);
      if (delta > maxScanlineDelta) {
        maxScanlineDelta = delta;
        worstPixelX = previewScanline.startX + pixel;
      }
    }
  }
  expect(
    maxScanlineDelta,
    `the full feathered preview row matches committed device pixels at DPR ${previewScanline.dpr}; ` +
      `largest difference ${maxScanlineDelta} at backing pixel x=${worstPixelX}`
  ).toBeLessThanOrEqual(1);
});
