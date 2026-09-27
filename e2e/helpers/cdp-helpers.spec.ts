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
   * Pinned output contract of `captureCanvasScreenshot`: the CDP clip is expressed
   * in CSS pixels, and for the `clip.scale: 1` the helper sends, Chrome returns
   * `clip size x deviceScaleFactor` image pixels — one image pixel per device
   * pixel, so a 120x80 CSS clip decodes to 240x160 at devicePixelRatio 2 and to
   * 120x80 at 1x. Consumers must derive the scale from the decoded image size
   * rather than assume CSS resolution, so every size expectation in this file is
   * written as `css x IMAGE_PIXELS_PER_CSS_PIXEL`, read from the live device pixel
   * ratio, and the 1x and 2x blocks assert the same rule.
   */
  test.describe('captureCanvasScreenshot', () => {
    test('captures screenshot via CDP', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture');

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expect(imageData.width).toBe(box.width * IMAGE_PIXELS_PER_CSS_PIXEL);
      expect(imageData.height).toBe(box.height * IMAGE_PIXELS_PER_CSS_PIXEL);
    });

    test('captures screenshot with clip options', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 120, height: 80 };
      const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-clip', clip);

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expect(imageData.width).toBe(clip.width * IMAGE_PIXELS_PER_CSS_PIXEL);
      expect(imageData.height).toBe(clip.height * IMAGE_PIXELS_PER_CSS_PIXEL);
    });

    test('uses box coordinates when clip not provided', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = { x: CANVAS_LEFT + 60, y: CANVAS_TOP + 40, width: 100, height: 60 };
      const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-box');

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      // A partial box must not silently degrade to the full canvas or the viewport.
      expect(imageData.width).toBe(box.width * IMAGE_PIXELS_PER_CSS_PIXEL);
      expect(imageData.height).toBe(box.height * IMAGE_PIXELS_PER_CSS_PIXEL);
    });

    test('captures screenshot via CDP without explicit DPR scaling', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 150, height: 100 };
      const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-dpr', clip);

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);

      // Asserted as a ratio so the expectation survives any display: the helper
      // adds no DPR conversion of its own on top of the `scale: 1` it already
      // sends, and Chrome's own device-pixel rendering is the only multiplier.
      expect(imageData.width / clip.width).toBeCloseTo(IMAGE_PIXELS_PER_CSS_PIXEL, 5);
      expect(imageData.height / clip.height).toBeCloseTo(IMAGE_PIXELS_PER_CSS_PIXEL, 5);
    });

    test('captures the page background when the region lies outside the canvas', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = { x: 0, y: 0, width: 40, height: 60 };
      const clip = { x: 0, y: 0, width: 40, height: 60 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-off-canvas', clip);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_PAGE_BACKGROUND)).toBe(0);
    });

    test('honors a clip offset distinct from the box origin', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
      const clip = { x: CANVAS_LEFT + 20, y: CANVAS_TOP + 20, width: 100, height: 100 };
      const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-fields', clip);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expect(imageData.width).toBe(clip.width * IMAGE_PIXELS_PER_CSS_PIXEL);
      expect(imageData.height).toBe(clip.height * IMAGE_PIXELS_PER_CSS_PIXEL);
    });
  });

  /**
   * The default project runs at devicePixelRatio 1, where "device pixels" and
   * "CSS pixels" are indistinguishable, so the tests above cannot tell native
   * device-pixel rendering apart from a plain CSS-pixel capture. Forcing a 2x
   * display is the only way to pin that the output really is `css x
   * deviceScaleFactor` and that nothing else rescales it.
   */
  test.describe('captureCanvasScreenshot at devicePixelRatio 2', () => {
    test.use({ deviceScaleFactor: 2 });

    test('returns the clip region at twice the CSS pixel count', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 120, height: 80 };
      const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);

      expect(IMAGE_PIXELS_PER_CSS_PIXEL).toBe(2);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-2x-clip', clip);

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expect(imageData.width).toBe(clip.width * IMAGE_PIXELS_PER_CSS_PIXEL);
      expect(imageData.height).toBe(clip.height * IMAGE_PIXELS_PER_CSS_PIXEL);
    });

    test('returns the box region at twice the CSS pixel count', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-2x-box');

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expect(imageData.width).toBe(box.width * IMAGE_PIXELS_PER_CSS_PIXEL);
      expect(imageData.height).toBe(box.height * IMAGE_PIXELS_PER_CSS_PIXEL);
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
