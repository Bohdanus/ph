import { test, expect } from '../fixtures/extended-test';
import { captureCanvasScreenshot } from './cdp-helpers';
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

const ZERO_SIZE_CANVAS_PAGE = `<!doctype html>
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
    <canvas id="test-canvas" width="0" height="0"></canvas>
  </body>
</html>`;

/**
 * A canvas with a CSS scale transform applied: `getBoundingClientRect` reports
 * the post-transform visual size, while the canvas's backing store (`width` /
 * `height` attributes) stays at the native resolution. This is the case the
 * viewport-vs-page conversion must handle correctly — `boundingBox()` returns the
 * transformed rect, not the intrinsic pixel count.
 */
const TRANSFORMED_CANVAS_PAGE = `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; padding: 0; background: rgb(0, 0, 255); }
      #test-canvas {
        position: absolute;
        left: ${CANVAS_LEFT}px;
        top: ${CANVAS_TOP}px;
        transform: scale(2);
        transform-origin: top left;
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

function expectPixelNear(
  imageData: ImageDataResult,
  x: number,
  y: number,
  expected: { red: number; green: number; blue: number }
): void {
  const offset = (y * imageData.width + x) * 4;
  const delta = Math.max(
    Math.abs(imageData.data[offset] - expected.red),
    Math.abs(imageData.data[offset + 1] - expected.green),
    Math.abs(imageData.data[offset + 2] - expected.blue)
  );
  expect(delta, `pixel (${x},${y}) should match ${JSON.stringify(expected)}`).toBeLessThanOrEqual(COLOR_TOLERANCE);
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
 * The scale is the Playwright context's device scale and is intentionally checked
 * through the captured pixels rather than assumed from the host. A reference capture
 * of the same rect pins tests that also need to detect an added rescaling step.
 */
function expectFaithfulCaptureOf(imageData: ImageDataResult, rect: { width: number; height: number }): void {
  const scaleX = imageData.width / rect.width;
  const scaleY = imageData.height / rect.height;

  expect(Number.isInteger(scaleX)).toBe(true);
  expect(scaleY).toBe(scaleX);
  expect(scaleX).toBeGreaterThanOrEqual(1);
}

test.describe('Canvas screenshot helper', () => {
  /**
   * Output contract of `captureCanvasScreenshot`: the viewport-relative clip is
   * expressed in CSS pixels and the result is a faithful image of exactly that rect
   * at Playwright's device scale.
   *
   * What every test below does pin is the part that is ours: the capture preserves the
   * requested rect's aspect at one integral scale shared by both axes, and the two that can
   * additionally say anything about its EXTENT pin that against a reference capture of the
   * same rect. The colour assertions carry the spatial guarantee, since the fixture paints
   * the canvas red against a blue page — a capture that strayed outside the canvas would not
   * be all red.
   */
  test.describe('captureCanvasScreenshot', () => {
    test('captures the requested screenshot region', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture');

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, box);
    });

    test('captures the requested clip options', async ({ page }, testInfo) => {
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
      // A partial box must not silently degrade to the full canvas or the viewport, and
      // the guard this replaces compared a number with itself: `imageData.width < 240 *
      // (imageData.width / 100)` is `w < 2.4w`, which is true for every `w` a capture can
      // have, so it could not fail. What replaced it is a comparison of two DECODED sizes.
      //
      // The claim is worth stating precisely, because at THIS call site it is not the one
      // that needs saying. This box is 100x60 and the canvas is 240x160, so a
      // full-canvas capture answers 2.4s x 2.667s and `expectFaithfulCaptureOf` already
      // rejects it on both the integral and the equal-axes check. What no call site gets
      // from that helper is the EXTENT: it divides the decoded size by the requested rect
      // and is satisfied by any rect standing to the request in a uniform integral ratio,
      // which is why the 120x80 clip in `expectFaithfulCaptureOf`'s own docblock needs a
      // separate argument. Playwright's `page.screenshot({ clip, scale: 'device' })` of the
      // SAME rect at the same native device scale is the reference that closes that gap for
      // the proportional case as well as this one.
      const reference = await decodeScreenshot(await page.screenshot({ clip: box, scale: 'device', type: 'png' }));
      expect(imageData.width, 'a capture that took the whole canvas instead of the box').toBe(reference.width);
      expect(imageData.height, 'a capture that took the whole canvas instead of the box').toBe(reference.height);
    });

    test('captures the requested clip at device scale', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 150, height: 100 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-dpr', clip);

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);

      const imageData = await decodeScreenshot(screenshot);
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      // The helper requests Playwright's device scale directly and adds no second
      // scaling step after the browser captures the clip.
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
     * The capture's spatial bounds must AGREE WITH THE PAGE'S OWN layout, not just
     * with the constants the test fed in. This mirrors the "agrees with the app's own
     * contain fit" pattern in `visual-regression.spec.ts` (which reads the app's
     * `data-fit-*` attributes and asserts them equal to an independent `containFit()`
     * result): the test cross-checks the capture against an INDEPENDENT reading from
     * the browser's layout engine, rather than checking the capture for internal
     * consistency alone.
     *
     * This is a spatial-correctness tripwire: if the helper ever passes the viewport
     * clip incorrectly, the captured region will not land where `getBoundingClientRect`
     * says the canvas is, and the pixel colour at the captured origin will be wrong.
     * The page-side read is the independent oracle the comparison is checked against.
     *
     * The read uses `getBoundingClientRect` from inside the page rather than a test
     * constant. The synthetic page is static, so a direct read is sufficient here.
     */
    test('captured region agrees with the page layout geometry', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 100, height: 80 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-spatial', box);
      const imageData = await decodeScreenshot(screenshot);

      // The PAGE's OWN layout: `getBoundingClientRect` checks the capture against
      // the layout it was taken from, not against the test constants. If the canvas
      // rendered at a different offset than CANVAS_LEFT/CANVAS_TOP, this surfaces it.
      const canvasRect = await page.evaluate(() => {
        const canvas = document.getElementById('test-canvas');
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      });

      expect(canvasRect, 'the canvas element was not present in the page').not.toBeNull();

      expect(canvasRect!.left).toBeCloseTo(CANVAS_LEFT, 1);
      expect(canvasRect!.top).toBeCloseTo(CANVAS_TOP, 1);
      expect(canvasRect!.width).toBeCloseTo(CANVAS_WIDTH, 1);
      expect(canvasRect!.height).toBeCloseTo(CANVAS_HEIGHT, 1);

      // The capture region (100x80) is a sub-rect of the 240x160 canvas. If the clip
      // were shifted from viewport space, the capture would land on the blue page
      // background instead of the red canvas — the colour check catches that, and the
      // spatial check above confirms the canvas is where the capture expects it.
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
      expectFaithfulCaptureOf(imageData, box);

      // Cross-check a known sub-region against hardcoded proportional CSS coordinates.
      // This is an independent oracle rather than a full-image round trip, so a shared
      // inverse bug in the conversion helpers cannot make the assertion pass.
      const reconstructed = screenshotBoundsToCss(
        {
          left: imageData.width * 0.25,
          top: imageData.height * 0.25,
          right: imageData.width * 0.75 - 1,
          bottom: imageData.height * 0.75 - 1,
          imageWidth: imageData.width,
          imageHeight: imageData.height,
        },
        box
      );
      expect(reconstructed.left, 'the sub-region CSS origin must be one quarter into the box').toBeCloseTo(
        box.x + box.width * 0.25,
        1
      );
      expect(reconstructed.top, 'the sub-region CSS origin must be one quarter into the box').toBeCloseTo(
        box.y + box.height * 0.25,
        1
      );
      expect(reconstructed.right, 'the sub-region CSS edge must be three quarters into the box').toBeCloseTo(
        box.x + box.width * 0.75 - box.width / imageData.width,
        1
      );
      expect(reconstructed.bottom, 'the sub-region CSS edge must be three quarters into the box').toBeCloseTo(
        box.y + box.height * 0.75 - box.height / imageData.height,
        1
      );
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
     * Playwright's own `page.screenshot({ scale: 'device' })` is the reference. Comparing
     * sizes catches any rescaling the helper might add after that device-scale capture.
     */
    test('adds no rescaling of its own, matching Playwright device-scale capture', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT, y: CANVAS_TOP, width: 120, height: 80 };

      const helperCapture = await decodeScreenshot(
        await captureCanvasScreenshot(page, box, testInfo, 'test-capture-vs-playwright', clip)
      );
      const playwrightCapture = await decodeScreenshot(await page.screenshot({ clip, scale: 'device', type: 'png' }));

      expect(helperCapture.width).toBe(playwrightCapture.width);
      expect(helperCapture.height).toBe(playwrightCapture.height);
    });

    test('preserves viewport geometry during screenshot capture', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      const before = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }));

      await captureCanvasScreenshot(page, FULL_CANVAS_BOX, testInfo, 'test-capture-geometry');

      const after = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }));
      expect(after).toEqual(before);
    });

    test('captures a visible viewport clip at a non-zero document scroll', async ({ page }, testInfo) => {
      const documentTop = 650;
      const scrollTop = 500;
      await page.setContent(RED_CANVAS_PAGE);
      await page.addStyleTag({
        content: `html, body { height: 1500px; } #test-canvas { top: ${documentTop}px; }`,
      });
      await page.evaluate((y) => window.scrollTo(0, y), scrollTop);
      await page.evaluate(() => {
        const canvas = document.getElementById('test-canvas') as HTMLCanvasElement | null;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) throw new Error('the scrolled capture canvas is unavailable');
        const halfWidth = canvas.width / 2;
        const halfHeight = canvas.height / 2;
        context.fillStyle = '#ff0000';
        context.fillRect(0, 0, halfWidth, halfHeight);
        context.fillStyle = '#00ff00';
        context.fillRect(halfWidth, 0, halfWidth, halfHeight);
        context.fillStyle = '#ffff00';
        context.fillRect(0, halfHeight, halfWidth, halfHeight);
        context.fillStyle = '#00ffff';
        context.fillRect(halfWidth, halfHeight, halfWidth, halfHeight);
      });

      const box = await page.locator('#test-canvas').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBe(documentTop - scrollTop);

      const screenshot = await captureCanvasScreenshot(page, box!, testInfo, 'test-capture-scrolled');
      const imageData = await decodeScreenshot(screenshot);

      expectFaithfulCaptureOf(imageData, box!);
      const splitX = Math.floor(imageData.width / 2);
      const splitY = Math.floor(imageData.height / 2);
      expectPixelNear(imageData, splitX - 1, splitY - 1, EXPECTED_CANVAS_RED);
      expectPixelNear(imageData, splitX, splitY - 1, { red: 0, green: 255, blue: 0 });
      expectPixelNear(imageData, splitX - 1, splitY, { red: 255, green: 255, blue: 0 });
      expectPixelNear(imageData, splitX, splitY, { red: 0, green: 255, blue: 255 });
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollTop);
    });

    test('rejects a viewport clip that would be partially cut off by scrolling', async ({ page }, testInfo) => {
      await page.setContent(`<!doctype html>
        <style>html, body { margin: 0; height: 1500px; background: blue; } canvas { position: absolute; top: 100px; left: 40px; }</style>
        <canvas width="240" height="160"></canvas>`);
      await page.evaluate(() => window.scrollTo(0, 150));
      const box = await page.locator('canvas').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBe(-50);

      await expect(captureCanvasScreenshot(page, box!, testInfo, 'offscreen-capture')).rejects.toThrow(
        'extends outside the current viewport'
      );
    });

    /**
     * P2 — viewport vs page coordinate mismatch at the zero-size boundary.
     *
     * A canvas with zero intrinsic dimensions reports a zero-area
     * `getBoundingClientRect`. Playwright rejects a zero-area screenshot clip; this
     * pins the boundary so the helper has a named assertion for that error path.
     */
    test('rejects a capture request for a zero-size canvas', async ({ page }, testInfo) => {
      await page.setContent(ZERO_SIZE_CANVAS_PAGE);

      const rect = await page.evaluate(() => {
        const canvas = document.getElementById('test-canvas');
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      expect(rect).not.toBeNull();
      expect(rect!.width).toBe(0);
      expect(rect!.height).toBe(0);

      await expect(
        captureCanvasScreenshot(page, { x: rect!.x, y: rect!.y, width: 0, height: 0 }, testInfo, 'test-capture-zero')
      ).rejects.toThrow();
    });

    /**
     * A canvas with a CSS `transform: scale(2)` visually occupies twice its
     * attribute width/height. `getBoundingClientRect` returns the post-transform
     * rect (480x320) while the backing store stays 240x160. This pins that the
     * capture region matches the TRANSFORMED rect — the page layout, not the
     * attribute — and that the viewport-relative clip still lands on the visible
     * transformed element.
     */
    test('captures the visually scaled bounds of a CSS-transformed canvas', async ({ page }, testInfo) => {
      await page.setContent(TRANSFORMED_CANVAS_PAGE);

      const rect = await page.evaluate(() => {
        const canvas = document.getElementById('test-canvas');
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      expect(rect).not.toBeNull();
      // The transform doubles the visual size from the 240x160 backing store.
      expect(rect!.width).toBe(CANVAS_WIDTH * 2);
      expect(rect!.height).toBe(CANVAS_HEIGHT * 2);

      const screenshot = await captureCanvasScreenshot(
        page,
        { x: rect!.x, y: rect!.y, width: CANVAS_WIDTH * 2, height: CANVAS_HEIGHT * 2 },
        testInfo,
        'test-capture-transformed'
      );

      const imageData = await decodeScreenshot(screenshot);
      // The capture is a faithful image of the 480x320 (CSS-transformed) rect and all
      // pixels are red — if the clip were taken against the backing store size (240x160)
      // instead of the transformed rect, the capture would be half the expected extent.
      expectFaithfulCaptureOf(imageData, { width: CANVAS_WIDTH * 2, height: CANVAS_HEIGHT * 2 });
      expect(countPixelsDifferingFrom(imageData, EXPECTED_CANVAS_RED)).toBe(0);
    });
  });

  /**
   * Force the emulated deviceScaleFactor to 2 so this path verifies the requested clip
   * at high DPI, not only at the project's default scale. The helper explicitly asks
   * Playwright for device-scale pixels, and the pixel bounds must map back to CSS with
   * the measured scale.
   */
  test.describe('captureCanvasScreenshot at an emulated deviceScaleFactor of 2', () => {
    test.use({ deviceScaleFactor: 2 });

    test('reports the emulated ratio, so the override provably applied', async ({ page }) => {
      await page.setContent(RED_CANVAS_PAGE);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    });

    test('preserves a fractional clip at device scale', async ({ page }, testInfo) => {
      await page.setContent(RED_CANVAS_PAGE);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
      const box = FULL_CANVAS_BOX;
      const clip = { x: CANVAS_LEFT - 0.25, y: CANVAS_TOP - 0.25, width: 120.5, height: 80.5 };

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-2x-fractional', clip);
      const actual = await decodeScreenshot(screenshot);
      const reference = await decodeScreenshot(await page.screenshot({ clip, scale: 'device', type: 'png' }));

      // Fractional CSS extents rasterize to integer device-pixel dimensions on each axis;
      // compare the exact decoded capture to Playwright's direct result instead of assuming
      // one scalar pixel ratio survives independent per-axis rounding.
      expect(actual.width).toBe(reference.width);
      expect(actual.height).toBe(reference.height);
      expect(Buffer.from(actual.data)).toEqual(Buffer.from(reference.data));
      expectPixelNear(actual, Math.floor(actual.width / 2), Math.floor(actual.height / 2), EXPECTED_CANVAS_RED);
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
      expect(imageData.width).toBe(clip.width * 2);
      expect(imageData.height).toBe(clip.height * 2);
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

      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, 'test-capture-2x-css', clip);
      const imageData = await decodeScreenshot(screenshot);

      // select-move.spec.ts, viewport-drawing.spec.ts and text-tool.spec.ts feed these
      // pixel bounds straight into screenshotBoundsToCss, so whatever scale the capture
      // comes back at, that conversion has to reconstruct the CSS rect of the clip.
      //
      // The property asserted is the ROUND TRIP, against literals rather than against
      // the function's own formula. An expectation written as
      // `clip.x + (imageData.width - 1) * (clip.width / imageData.width)` is the
      // implementation restated, and it holds for every image whatsoever — a capture of
      // the wrong region, at the wrong scale, or anisotropically all satisfy it, which
      // is why this block was four assertions that could not fail. These are computed
      // from the clip's constants instead, so a wrong answer is a wrong number.
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
      // The first covered pixel is the clip's own origin, and the last covered pixel's
      // CENTRE is one image pixel short of the clip's far edge. `imageBoundsToCss`
      // documents that convention (and the one-pixel under-report it implies) rather
      // than rounding it away, so the far edge is asserted with a scale-sized tolerance
      // instead of being faked.
      const scale = imageData.width / clip.width;
      expect(cssRect.left, 'the first covered pixel must map to the clip origin').toBeCloseTo(clip.x, 5);
      expect(cssRect.top, 'the first covered row must map to the clip origin').toBeCloseTo(clip.y, 5);
      expect(cssRect.right, 'the far edge must be within one image pixel of the clip edge').toBeCloseTo(
        clip.x + clip.width,
        -1
      );
      expect(cssRect.bottom, 'the far edge must be within one image pixel of the clip edge').toBeCloseTo(
        clip.y + clip.height,
        -1
      );
      // And the scale is a real one: integral, shared by both axes, and at least 1. This
      // is the part `expectFaithfulCaptureOf` already pins, restated here only because
      // the round trip above is only meaningful if the capture had a single scale.
      expect(scale, 'the capture scale must be integral').toBe(Math.trunc(scale));
      expect(imageData.height / clip.height, 'both axes must share one scale').toBeCloseTo(scale, 5);
      expect(scale, 'the capture must cover at least one CSS pixel per image pixel').toBeGreaterThanOrEqual(1);
    });
  });
});
