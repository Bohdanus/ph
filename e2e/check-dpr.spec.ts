import { expect, test, type Page } from './fixtures/extended-test';
import { drawLine, getDarkPixelBounds, getWorkspaceCanvas, waitForCanvasRedraw } from './helpers/canvas-helpers';
import { toleranceFor } from './helpers/viewport-tolerance';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';

const BACKING_STORE_TEST_IDS = [
  'workspace-canvas',
  'tool-overlay-canvas',
  'rect-overlay-canvas',
  'selection-ants-canvas',
] as const;

async function expectCanvasBackingStoresMatchDocument(page: Page, expectedDpr: number): Promise<void> {
  const workspace = page.getByTestId('workspace-container');
  const widthAttribute = 'data-fit-document-width';
  const heightAttribute = 'data-fit-document-height';

  await expect(workspace).toHaveAttribute(widthAttribute, /^\d+$/);
  await expect(workspace).toHaveAttribute(heightAttribute, /^\d+$/);

  const documentWidth = await workspace.getAttribute(widthAttribute);
  const documentHeight = await workspace.getAttribute(heightAttribute);
  if (documentWidth === null || documentHeight === null) {
    throw new Error('workspace document dimensions were not published');
  }
  expect(Number(documentWidth), 'document width').toBeGreaterThan(0);
  expect(Number(documentHeight), 'document height').toBeGreaterThan(0);

  const expectedWidth = String(Number(documentWidth) * expectedDpr);
  const expectedHeight = String(Number(documentHeight) * expectedDpr);

  for (const testId of BACKING_STORE_TEST_IDS) {
    const canvas = page.getByTestId(testId);
    await expect(canvas, `${testId} backing-store width`).toHaveAttribute('width', expectedWidth);
    await expect(canvas, `${testId} backing-store height`).toHaveAttribute('height', expectedHeight);
  }
}

test.describe('Device pixel ratio', () => {
  // The project default is an emulated `deviceScaleFactor` of 1, so a test that merely reads
  // `window.devicePixelRatio` cannot tell a 1x run from a 2x one - which is why the file
  // used to hold `expect(dpr).toBeGreaterThanOrEqual(1)`, an assertion no page this suite
  // can load can fail. For POINTER MAPPING the app reads layout pixels only and never consults
  // `devicePixelRatio` (pinned at the unit level in
  // `src/hooks/__tests__/usePointerPosition.test.ts:856-869`), so drawing still needs to be
  // checked at ratio 2.
  //
  // "for POINTER MAPPING" is load-bearing, and it was written here to stop the sentence from
  // being read as "the app never touches a device-pixel count". It stopped being true when the
  // three option-bar thumbnails began multiplying their backing store by the ratio
  // (`src/hooks/useDevicePixelRatio.ts`). This spec also pins backing-store dimensions directly:
  // `imageBoundsToCss` remains scale-agnostic by construction, so screenshot mapping alone cannot
  // detect that regression. The lack of a dedicated HiDPI project is recorded in
  // `e2e/OPEN_PROBLEMS.md`.
  test.use({ deviceScaleFactor: 2 });

  test('canvas backing stores match document pixels and drawing maps CSS pixels at ratio 2', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    // The precondition, and the reason the rest of this test is not vacuous: if the override
    // above were ever dropped, the page would report 1, every assertion below would still
    // pass, and the file would be the permanently-green test it was.
    // Read off the page directly rather than through a helper. `getDevicePixelRatio` was
    // deleted from `cdp-helpers.ts` as a dead export that re-invited the strategy this
    // file's own history shows is wrong: CDP captures at Chrome's surface scale, so the
    // emulated ratio is not the capture scale and asserting against it once made this test
    // red in one mode and green in another. What IS worth asserting here is the
    // EMULATED ratio, because that is the `test.use` above — and the page property is the
    // only place that can confirm the override applied. `cdp-helpers.spec.ts`'s 2x block
    // reads it the same way.
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(dpr).toBe(2);
    await expectCanvasBackingStoresMatchDocument(page, dpr);

    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.35 };
    const end = { x: box.x + box.width * 0.65, y: start.y };

    await clickToolButton(page, 'draw');
    await drawLine(page, box, start.x - box.x, start.y - box.y, end.x - box.x, end.y - box.y, { steps: 20 });
    // This line sits outside the shared redraw clip, so it samples its own band.
    await waitForCanvasRedraw(page, box, {
      clip: { x: start.x - 20, y: start.y - 20, width: end.x - start.x + 40, height: 40 },
    });

    // `imageBoundsToCss` derives the scale from the decoded image against the element's CSS
    // box, never from `devicePixelRatio`, so a 2x capture is read the same way as a 1x one
    // (see e2e/helpers/screenshot-scale.ts).
    const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'dpr-2-line');
    const bounds = await getDarkPixelBounds(screenshot);
    if (!bounds) throw new Error('line not found on screenshot');
    const line = imageBoundsToCss({ width: bounds.imageWidth, height: bounds.imageHeight }, box, bounds);

    expect(Math.abs(line.left - start.x), 'line start far from cursor').toBeLessThan(toleranceFor(box));
    expect(Math.abs(line.right - end.x), 'line end far from cursor').toBeLessThan(toleranceFor(box));
    expect(Math.abs((line.top + line.bottom) / 2 - start.y), 'line shifted in Y').toBeLessThan(toleranceFor(box));
  });
});

test.describe('Canvas backing store at 1x', () => {
  test.use({ deviceScaleFactor: 1 });

  test('all canvas backing stores stay at document resolution', async ({ page }) => {
    await page.goto('/');
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(dpr).toBe(1);
    await expectCanvasBackingStoresMatchDocument(page, dpr);
  });
});
