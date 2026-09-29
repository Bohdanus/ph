import { expect, test } from '@playwright/test';
import { drawLine, getDarkPixelBounds, getWorkspaceCanvas, waitForCanvasRedraw } from './helpers/canvas-helpers';
import { captureCanvasScreenshot, getDevicePixelRatio } from './helpers/cdp-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';

/** How far, in CSS pixels, the drawn stroke may sit from the point it was drawn at. */
const CSS_POSITION_TOLERANCE = 25;

test.describe('Device pixel ratio', () => {
  // The project default is an emulated `deviceScaleFactor` of 1, so a test that merely reads
  // `window.devicePixelRatio` cannot tell a 1x run from a 2x one - which is why the file
  // used to hold `expect(dpr).toBeGreaterThanOrEqual(1)`, an assertion no page this suite
  // can load can fail. The app reads layout pixels only and never consults
  // `devicePixelRatio` (pinned at the unit level in
  // `src/hooks/__tests__/usePointerPosition.test.ts:777`), so the only app behaviour worth
  // asserting here is that drawing still lands under the cursor when the ratio is 2.
  test.use({ deviceScaleFactor: 2 });

  test('canvas drawing maps CSS pixels, not device pixels, at an emulated ratio of 2', async ({ page }, testInfo) => {
    await page.goto('/');
    // The precondition, and the reason the rest of this test is not vacuous: if the override
    // above were ever dropped, the page would report 1, every assertion below would still
    // pass, and the file would be the permanently-green test it was.
    expect(await getDevicePixelRatio(page)).toBe(2);

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

    expect(Math.abs(line.left - start.x), 'line start far from cursor').toBeLessThan(CSS_POSITION_TOLERANCE);
    expect(Math.abs(line.right - end.x), 'line end far from cursor').toBeLessThan(CSS_POSITION_TOLERANCE);
    expect(Math.abs((line.top + line.bottom) / 2 - start.y), 'line shifted in Y').toBeLessThan(CSS_POSITION_TOLERANCE);
  });
});
