import { expect, test, type Page } from './fixtures/extended-test';
import {
  drawLine,
  getDarkPixelBounds,
  getWorkspaceCanvas,
  workspaceDocumentPixelMask,
  viewportClip,
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { toleranceFor } from './helpers/viewport-tolerance';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';
import { HIDPI_PIXEL_COMPARISON_TEST_TIMEOUT_MS } from './helpers/timeouts';

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
    // Read the page property directly to prove the `test.use` override above took effect.
    // The screenshot helper separately pins how that context scale affects captured pixels;
    // this assertion only verifies the device emulation setting itself.
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
      clip: viewportClip({ x: start.x - 20, y: start.y - 20, width: end.x - start.x + 40, height: 40 }),
    });

    // `imageBoundsToCss` derives the scale from the decoded image against the element's CSS
    // box, never from `devicePixelRatio`, so a 2x capture is read the same way as a 1x one
    // (see e2e/helpers/screenshot-scale.ts).
    const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'dpr-2-line');
    const bounds = await getDarkPixelBounds(
      screenshot,
      await workspaceDocumentPixelMask(
        page,
        box,
        viewportClip({ x: box.x, y: box.y, width: box.width, height: box.height })
      )
    );
    if (!bounds) throw new Error('line not found on screenshot');
    const line = imageBoundsToCss({ width: bounds.imageWidth, height: bounds.imageHeight }, box, bounds);

    expect(Math.abs(line.left - start.x), 'line start far from cursor').toBeLessThan(toleranceFor(box));
    expect(Math.abs(line.right - end.x), 'line end far from cursor').toBeLessThan(toleranceFor(box));
    expect(Math.abs((line.top + line.bottom) / 2 - start.y), 'line shifted in Y').toBeLessThan(toleranceFor(box));
  });

  test('committing a Draw stroke preserves the live HiDPI preview pixels', async ({ page }) => {
    // The assertion compares both full-size backing stores at every device pixel.
    test.setTimeout(HIDPI_PIXEL_COMPARISON_TEST_TIMEOUT_MS);
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);

    const workspace = getWorkspaceCanvas(page);
    const box = await workspace.boundingBox();
    if (!box) throw new Error('canvas not found');
    const initialCursor = await workspace.getAttribute('data-presentation-paint-cursor');

    await clickToolButton(page, 'draw');
    const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
    const end = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.63 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const workspaceCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="workspace-canvas"]');
      const overlayCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="tool-overlay-canvas"]');
      if (!workspaceCanvas || !overlayCanvas) throw new Error('Workspace canvas stack is incomplete');
      if (workspaceCanvas.width !== overlayCanvas.width || workspaceCanvas.height !== overlayCanvas.height) {
        throw new Error('Workspace and tool overlay backing stores differ');
      }

      const snapshot = document.createElement('canvas');
      snapshot.width = workspaceCanvas.width;
      snapshot.height = workspaceCanvas.height;
      const context = snapshot.getContext('2d');
      if (!context) throw new Error('Could not create the Draw preview snapshot');
      context.drawImage(workspaceCanvas, 0, 0);
      context.drawImage(overlayCanvas, 0, 0);
      (window as Window & { __drawPreviewPixels?: Uint8ClampedArray }).__drawPreviewPixels = context.getImageData(
        0,
        0,
        snapshot.width,
        snapshot.height
      ).data;
    });

    await page.mouse.up();
    await expect.poll(() => workspace.getAttribute('data-presentation-paint-cursor')).not.toBe(initialCursor);

    const comparison = await page.evaluate(() => {
      const preview = (window as Window & { __drawPreviewPixels?: Uint8ClampedArray }).__drawPreviewPixels;
      const workspaceCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="workspace-canvas"]');
      const overlayCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="tool-overlay-canvas"]');
      if (!preview || !workspaceCanvas || !overlayCanvas) throw new Error('Draw pixel comparison inputs are missing');
      const context = workspaceCanvas.getContext('2d');
      if (!context) throw new Error('Workspace canvas has no 2D context');
      const committed = context.getImageData(0, 0, workspaceCanvas.width, workspaceCanvas.height).data;
      let differingPixels = 0;
      let maxChannelDelta = 0;
      let left = workspaceCanvas.width;
      let top = workspaceCanvas.height;
      let right = -1;
      let bottom = -1;
      for (let offset = 0; offset < committed.length; offset += 4) {
        let differs = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(committed[offset + channel]! - preview[offset + channel]!);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          if (delta !== 0) differs = true;
        }
        if (differs) {
          differingPixels += 1;
          const pixel = offset / 4;
          const x = pixel % workspaceCanvas.width;
          const y = Math.floor(pixel / workspaceCanvas.width);
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      return {
        differingPixels,
        maxChannelDelta,
        bounds: differingPixels === 0 ? null : { left, top, right, bottom },
        presentationSource: workspaceCanvas.dataset.presentationPaintSource,
      };
    });

    expect(
      comparison,
      'commit should render the same device pixels as the live preview; presentation source: ' +
        comparison.presentationSource
    ).toMatchObject({
      differingPixels: 0,
      maxChannelDelta: 0,
      bounds: null,
    });
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
