import { expect, test } from './fixtures/extended-test';
import { drawLine, getDarkPixelBounds, getWorkspaceCanvas, waitForCanvasRedraw } from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';

/** How far, in CSS pixels, the drawn stroke may sit from the point it was drawn at. */
const CSS_POSITION_TOLERANCE = 25;

test.describe('Device pixel ratio', () => {
  // The project default is an emulated `deviceScaleFactor` of 1, so a test that merely reads
  // `window.devicePixelRatio` cannot tell a 1x run from a 2x one - which is why the file
  // used to hold `expect(dpr).toBeGreaterThanOrEqual(1)`, an assertion no page this suite
  // can load can fail. For POINTER MAPPING the app reads layout pixels only and never consults
  // `devicePixelRatio` (pinned at the unit level in
  // `src/hooks/__tests__/usePointerPosition.test.ts:856-869`), so the only app behaviour worth
  // asserting here is that drawing still lands under the cursor when the ratio is 2.
  //
  // "for POINTER MAPPING" is load-bearing, and it was written here to stop the sentence from
  // being read as "the app never touches a device-pixel count". It stopped being true when the
  // three option-bar thumbnails began multiplying their backing store by the ratio
  // (`src/hooks/useDevicePixelRatio.ts`). This spec is still the right shape for what it covers,
  // and it still CANNOT detect a change to a backing store: `imageBoundsToCss` is scale-agnostic
  // by construction, so this file passes identically at a 1x, 2x or 8x store. The gap that leaves
  // is recorded in `e2e/OPEN_PROBLEMS.md` under "no mobile or HiDPI project".
  test.use({ deviceScaleFactor: 2 });

  test('canvas drawing maps CSS pixels, not device pixels, at an emulated ratio of 2', async ({ page }, testInfo) => {
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
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);

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
