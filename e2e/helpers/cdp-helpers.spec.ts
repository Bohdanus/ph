import { test, expect } from '@playwright/test';
import { captureCanvasScreenshot, getDevicePixelRatio } from './cdp-helpers';
import { loadImageData, screenshotBoundsToCss, type ImageDataResult } from './canvas-helpers';

/** CSS geometry of the red canvas inside the synthetic page. */
const CANVAS_LEFT = 40;
const CANVAS_TOP = 60;
const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 160;

const EXPECTED_CANVAS_RED = { red: 255, green: 0, blue: 0 };
const EXPECTED_PAGE_BACKGROUND = { red: 0, green: 0, blue: 255 };
/**
 * Screenshots travel through a PNG encoder and (on some platforms) a display
 * color profile, so a solid fill is only exact to within a few units per channel.
 * The tolerance stays far below the 255 separation between the two colors used
 * here, so it never lets a genuinely wrong region pass.
 */
const COLOR_TOLERANCE = 12;

/**
 * A page whose only red pixels live inside a canvas at a known, non-zero CSS
 * offset; everything else is a distinctly different solid color. Probing a clip
 * that lands on the canvas and a clip that lands off it proves the capture is
 * spatially located, which a bare "bytes were returned" check cannot.
 */
const RED_CANVAS_PAGE = `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; padding: 0; background: rgb(0, 0, 255); }
      #test-canvas {
        position: absolute;
        left: ${CANVAS_LEFT}px;
        top: ${CANVAS_TOP}px;
        display: block;
      }
    </style>
  </head>
  <body>
    <canvas id="test-canvas" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}"></canvas>
    <script>
      const ctx = document.getElementById('test-canvas').getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, ${CANVAS_WIDTH}, ${CANVAS_HEIGHT});
    </script>
  </body>
</html>`;

const FULL_CANVAS_BOX = { x: CANVAS_LEFT, y: CANVAS_TOP, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

function countPixelsDifferingFrom(
  imageData: ImageDataResult,
  expected: { red: number; green: number; blue: number }
): number {
  let differing = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    const delta = Math.max(
      Math.abs(imageData.data[index] - expected.red),
      Math.abs(imageData.data[index + 1] - expected.green),
      Math.abs(imageData.data[index + 2] - expected.blue)
    );
    if (delta > COLOR_TOLERANCE) differing++;
  }
  return differing;
}

function countTransparentPixels(imageData: ImageDataResult): number {
  let transparent = 0;
  for (let index = 3; index < imageData.data.length; index += 4) {
    if (imageData.data[index] === 0) transparent++;
  }
  return transparent;
}

async function decodeScreenshot(screenshot: Buffer): Promise<ImageDataResult> {
  const imageData = await loadImageData(screenshot);
  expect(imageData.width).toBeGreaterThan(0);
  expect(imageData.height).toBeGreaterThan(0);
  expect(countTransparentPixels(imageData)).toBe(0);
  return imageData;
}

/**
 * Asserts the capture is a faithful image of `rect`, expressed in CSS pixels.
 *
 * It deliberately does **not** assert the absolute capture scale, and it must not:
 * `Page.captureScreenshot` returns native device pixels, and on this HiDPI host that
 * scale is a function of the browser mode rather than of the emulated
 * `deviceScaleFactor`. Measured, a 240x160 CSS clip decodes to 480x320 while
 * `window.devicePixelRatio` reports 1; sweeping the project-level `deviceScaleFactor`
 * over 1, 2 and 3 produced the same 480. So the old
 * `imageWidth === rect.width * devicePixelRatio` failed in one mode and passed in the
 * other for byte-identical code, and no amount of DPR bookkeeping fixes it.
 *
 * Deriving the scale from the decoded image instead would be tautological, so this
 * asserts the properties that are true in every mode and that consumers depend on:
 * the capture is exactly the requested rect, at one integral scale shared by both
 * axes. A clipped, padded, full-canvas or anisotropic capture all fail it. The
 * absolute scale is then genuinely unconstrained, which is correct — downstream,
 * `screenshotBoundsToCss` and `screenshot-scale.ts` derive it from the decoded
 * dimensions, so it is an input rather than a promise.
 */
function expectFaithfulCaptureOf(imageData: ImageDataResult, rect: { width: number; height: number }): void {
  const scaleX = imageData.width / rect.width;
  const scaleY = imageData.height / rect.height;

  expect(Number.isInteger(scaleX)).toBe(true);
  expect(scaleY).toBe(scaleX);
  expect(scaleX).toBeGreaterThanOrEqual(1);
}

test.describe('CDP Helpers', () => {
  test.describe('getDevicePixelRatio', () => {
    test('returns devicePixelRatio from window', async ({ page }) => {
      await page.setContent('<div>test</div>');
      const dpr = await getDevicePixelRatio(page);
      expect(dpr).toBeGreaterThanOrEqual(1);
    });

    test('returns 1 when devicePixelRatio is not available', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'devicePixelRatio', { value: undefined, configurable: true });
      });
      await page.setContent('<div>test</div>');
      const dpr = await getDevicePixelRatio(page);
      expect(dpr).toBe(1);
    });
  });

  /**
   * Output contract of `captureCanvasScreenshot`: the CDP clip is expressed in CSS
   * pixels and the result is a faithful image of exactly that rect, at whatever device
   * scale Chrome captured at. The scale itself is not asserted — it is a property of
   * the browser and the host, not of this helper, and it differs between headed and
   * headless on a HiDPI machine. See `expectFaithfulCaptureOf` for the measurement.
   *
   * What every test below does pin is the part that is ours: the capture covers the
   * requested rect and nothing else, at one integral scale on both axes. The colour
   * assertions carry the spatial guarantee, since the fixture paints the canvas red
   * against a blue page — a capture that strayed outside the canvas would not be all
   * red.
   */
  test.describe('captureCanvasScreenshot', () => {
    test('captures screenshot via CDP', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture');

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, box);
    });

    test('captures screenshot with clip options', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 120, height: 80 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-clip', clip);

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, clip);
    });

    test('uses box coordinates when clip not provided', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = { x: CANVAS_LEFT + 60, y: CANVAS_TOP + 40, width: 100, height: 60 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-box');

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, box);
      // A partial box must not silently degrade to the full canvas or the viewport.
      // `expectFaithfulCaptureOf` cannot see that on its own — a 120x80 clip and the
      // 240x160 canvas share a scale of 2 — so compare against the canvas directly.
      // The box is strictly smaller than the canvas, so at any common scale the box
      // capture must be strictly smaller too.
      const scale = imageData.width / box.width;
      expect(imageData.width).toBeLessThan(FULL_CANVAS_BOX.width * scale);
      expect(imageData.height).toBeLessThan(FULL_CANVAS_BOX.height * scale);
    });

    test('captures screenshot via CDP without explicit DPR scaling', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 150, height: 100 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-dpr', clip);

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      // The helper adds no DPR conversion of its own on top of the `scale: 1` it
      // already sends; Chrome's own device-pixel rendering is the only multiplier.
      expectFaithfulCaptureOf(imageData, clip);
    });

    test('captures the page background when the region lies outside the canvas', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = { x: 0, y: 0, width: 40, height: 60 };
      const clip = { x: 0, y: 0, width: 40, height: 60 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-off-canvas', clip);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_PAGE_BACKGROUND)).toBe(0);
      expectFaithfulCaptureOf(imageData, clip);
    });

    test('honors a clip offset distinct from the box origin', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
      const clip = { x: CANVAS_LEFT + 20, y: CANVAS_TOP + 20, width: 100, height: 100 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-fields', clip);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, clip);
    });

    /**
     * The last of the three properties, and the one `expectFaithfulCaptureOf` cannot
     * see: that the helper adds no rescaling of its own.
     *
     * A uniform extra multiplier is invisible to a self-referential check — an integral
     * 2x on a 1x capture is still integral, still equal on both axes, and still
     * correctly inverted by `screenshotBoundsToCss`, so it survives on purpose. But
     * doubling the resolution is a real change to the helper's output, so it is pinned
     * here against a reference rather than against a constant.
     *
     * Playwright's own `page.screenshot({ scale: 'device' })` is that reference: it
     * captures the same surface at the same native device scale. Comparing the two
     * sizes pins the helper's `scale: 1` without naming the absolute scale, so the
     * assertion holds on a 1x host, a 2x host, headed and headless alike.
     */
    test('adds no rescaling of its own, matching Playwright device-scale capture', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 120, height: 80 };

      const cdpCapture = await decodeScreenshot(
        await captureCanvasScreenshot(page, box, testInfo, 'test-capture-vs-playwright', clip)
      );
      const playwrightCapture = await decodeScreenshot(await page.screenshot({ clip, scale: 'device', type: 'png' }));

      expect(cdpCapture.width).toBe(playwrightCapture.width);
      expect(cdpCapture.height).toBe(playwrightCapture.height);
    });
  });

  /**
   * The default project runs at an emulated `deviceScaleFactor` of 1, so nothing
   * above can tell a 1x host apart from a 2x one. This block forces the emulation to
   * 2 to prove the suite does not silently depend on the default — the helper still
   * returns a faithful capture, and the scale-agnostic conversion in
   * `screenshotBoundsToCss` still reconstructs the clip rect exactly.
   *
   * It deliberately does not assert a capture scale of 2. The emulated ratio is a
   * Playwright setting applied to `window.devicePixelRatio`; what CDP captures at is
   * Chrome's surface scale. Measured on this host the two diverge (a 240x160 CSS clip
   * decodes to 480x320 at an emulated ratio of 1, and unchanged at 1, 2 and 3), so
   * asserting `emulated x` here is what kept this block red in exactly the modes it
   * was meant to protect.
   */
  test.describe('captureCanvasScreenshot at an emulated deviceScaleFactor of 2', () => {
    test.use({ deviceScaleFactor: 2 });

    test('reports the emulated ratio, so the override provably applied', async ({ page }) => {
      await page.setContent(RED_CANVAS_PAGE);
      expect(await getDevicePixelRatio(page)).toBe(2);
    });

    test('returns the clip region at one integral scale', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 120, height: 80 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-2x-clip', clip);

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, clip);
    });

    test('returns the box region at one integral scale', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-2x-box');

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, box);
    });

    test('maps captured pixel bounds back onto the clip CSS rect at any scale', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 120, height: 80 };

      expect(await getDevicePixelRatio(page)).toBe(2);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-2x-css', clip);
      const imageData = await decodeScreenshot(screenshot);

      // select-move.spec.ts and viewport-drawing.spec.ts feed these pixel bounds
      // straight into screenshotBoundsToCss. Whatever scale the capture comes back
      // at, that conversion has to reconstruct the CSS rect of the clip; this pins
      // both ends of the contract against a real 2x capture.
      const cssRect = screenshotBoundsToCss(
        {
          left: 0,
          top: 0,
          right: imageData.width - 1,
          bottom: imageData.height - 1,
          imageWidth: imageData.width,
          imageHeight: imageData.height,
        },
        clip
      );
      expect(cssRect.left).toBeCloseTo(clip.x, 5);
      expect(cssRect.top).toBeCloseTo(clip.y, 5);
      expect(cssRect.right).toBeCloseTo(clip.x + (imageData.width - 1) * (clip.width / imageData.width), 5);
      expect(cssRect.bottom).toBeCloseTo(clip.y + (imageData.height - 1) * (clip.height / imageData.height), 5);
    });
  });
});
