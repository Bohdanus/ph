import { expect, type Page, test } from './fixtures/extended-test';
import {
  drawLine,
  getWorkspaceCanvas,
  loadImageData,
  type ImageDataResult,
  type BoundingBox,
} from './helpers/canvas-helpers';
import { canvasRedrawClip, waitForCanvasPixels, type CanvasPixelPredicate } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Red Eye Correction Tool, with dedicated e2e coverage.
 *
 * ## Why this spec exists
 *
 * Zero e2e coverage existed for this tool. The red-eye processor (`src/tools/redEye.ts`)
 * performs a connected red-region search seeded from the click and replaces only red-dominant
 * pixels, darkening green/blue toward zero while collapsing red toward `max(green, blue)`.
 * Photoshop ships this as a click-only correction: the commit is a bare pointer-down with no drag.
 *
 * ## Why the fixture is red on a white field
 *
 * The correction fires only when `isRedEyePixel` returns true — `red >= 40 && red - max(green, blue) >= 24`.
 * A pure red `(255,0,0)` is the strongest case; a tinted red `rgb(200, 80, 32)` exercises the `darkenAmount`
 * scale because its corrected channels depend on it. The white canvas background proves non-red
 * pixels are preserved.
 */

const TINTED_RED_HEX = '#c85020';
const TINTED_RED: { r: number; g: number; b: number } = { r: 200, g: 80, b: 32 };

const PIXEL_POLL_TIMEOUT_MS = 15_000;
const PIXEL_POLL_INTERVAL_MS = 100;
const pollOptions = { timeout: PIXEL_POLL_TIMEOUT_MS, intervals: [PIXEL_POLL_INTERVAL_MS] };

async function getCanvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('workspace canvas has no bounding box');
  return box;
}

async function setRedEyeOption(page: Page, name: 'pupil-size' | 'darken-amount', value: string): Promise<void> {
  const slider = page.locator(`#red-eye-${name}`);
  await expect(slider).toBeVisible();
  await slider.fill(value);
  await expect(slider).toHaveValue(value);
}

/** Matches the app's `isRedEyePixel`: `red >= 40 && red - max(green, blue) >= 24`. */
const isRedEyePixel: CanvasPixelPredicate = async (screenshot) => {
  const { data } = await loadImageData(screenshot);
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    if (r >= 40 && r - Math.max(g, b) >= 24) return true;
  }
  return false;
};

/**
 * The red-eye correction only affects a small radius around the click. This predicate reads
 * the specific probe pixel and checks that its red channel was pulled down toward black,
 * which is the visible signature of `correctRedEyePixels`.
 */
async function pixelMovedTowardBlack(
  screenshot: Buffer,
  clip: { x: number; y: number; width: number; height: number },
  box: BoundingBox,
  docX: number,
  docY: number,
  beforeR: number
): Promise<boolean> {
  const image = await loadImageData(screenshot);
  const point = {
    x: (image.width * (box.x + docX - clip.x)) / clip.width,
    y: (image.height * (box.y + docY - clip.y)) / clip.height,
  };
  if (point.x < 0 || point.x >= image.width || point.y < 0 || point.y >= image.height) return false;
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  const index = (py * image.width + px) * 4;
  const r = image.data[index];
  return r < beforeR;
}

async function readPixelFromImage(
  image: ImageDataResult,
  clip: { x: number; y: number; width: number; height: number },
  box: BoundingBox,
  docX: number,
  docY: number
): Promise<{ r: number; g: number; b: number } | null> {
  const point = {
    x: (image.width * (box.x + docX - clip.x)) / clip.width,
    y: (image.height * (box.y + docY - clip.y)) / clip.height,
  };
  if (point.x < 0 || point.x >= image.width || point.y < 0 || point.y >= image.height) return null;
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  const index = (py * image.width + px) * 4;
  return { r: image.data[index], g: image.data[index + 1], b: image.data[index + 2] };
}

test.describe('Red Eye tool', () => {
  test.describe.configure({ timeout: PAINT_TOOLS_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('corrects a pure red region on click and leaves non-red pixels untouched', async ({ page }) => {
    const box = await getCanvasBox(page);

    await clickToolButton(page, 'draw');
    const size = page.getByRole('slider', { name: /^Size/ });
    await size.fill('40');
    await expect(size).toHaveValue('40');

    await setForegroundColor(page, '#ff0000', true);

    const redClip = canvasRedrawClip(box);
    // A local white patch inside the same capture bounds and beyond the red stroke.
    const neutralClip = {
      x: redClip.x + redClip.width - 60,
      y: redClip.y + 40,
      width: 20,
      height: 20,
    };
    const strokeY = 150;
    const probeX = 240;

    await drawLine(page, box, 200, strokeY, 280, strokeY, { steps: 16 });

    await waitForCanvasPixels(page, redClip, isRedEyePixel, { description: 'the red band is drawn' });

    // Capture the probe pixel before correction so we can assert it was pulled toward black.
    const beforeImage = await loadImageData(await page.screenshot({ clip: redClip }));
    const probePixel = await readPixelFromImage(beforeImage, redClip, box, probeX, strokeY);
    expect(probePixel).not.toBeNull();

    // Capture the neutral area before the red-eye click to verify it is untouched.
    const neutralBefore = await page.screenshot({ clip: neutralClip });

    await clickToolButton(page, 'red-eye');
    await expect(page.locator('#red-eye-pupil-size')).toBeVisible();
    await expect(page.locator('#red-eye-darken-amount')).toBeVisible();

    await page.mouse.click(box.x + probeX, box.y + strokeY);

    await expect
      .poll(
        async () => {
          const after = await page.screenshot({ clip: redClip });
          return await pixelMovedTowardBlack(after, redClip, box, probeX, strokeY, probePixel!.r);
        },
        { ...pollOptions, message: 'the probe pixel red channel should drop after correction' }
      )
      .toBe(true);

    const afterGrey = await page.screenshot({ clip: neutralClip });
    expect(afterGrey.equals(neutralBefore), 'non-red pixels must remain untouched').toBe(true);
  });

  test('darken amount affects the correction on tinted red', async ({ page }) => {
    const box = await getCanvasBox(page);

    await clickToolButton(page, 'draw');
    const size = page.getByRole('slider', { name: /^Size/ });
    await size.fill('40');
    await expect(size).toHaveValue('40');
    await setForegroundColor(page, TINTED_RED_HEX, true);

    const clip = canvasRedrawClip(box);
    const probeX = 240;
    const probeY = 150;

    // Draw a tinted-red stroke. The draw tool creates a new layer per stroke, so both
    // probes land on the same layer that the red-eye tool will read.
    await drawLine(page, box, 200, probeY, 280, probeY, { steps: 16 });

    // The draw tool blends with the white background (~90% opacity), so the tinted red
    // pixel is lighter than the input. Match with a tolerance range instead of an exact value.
    await waitForCanvasPixels(
      page,
      clip,
      async (screenshot) => {
        const pixel = await readPixelFromImage(await loadImageData(screenshot), clip, box, probeX, probeY);
        return (
          pixel !== null && pixel.r >= TINTED_RED.r - 30 && pixel.g >= TINTED_RED.g - 30 && pixel.b >= TINTED_RED.b - 30
        );
      },
      { description: 'the tinted red band is drawn' }
    );

    const beforeImage = await loadImageData(await page.screenshot({ clip }));
    const beforeProbePixel = await readPixelFromImage(beforeImage, clip, box, probeX, probeY);
    expect(beforeProbePixel, 'should have a red-dominant pixel at the probe').not.toBeNull();

    await clickToolButton(page, 'red-eye');

    // A larger-than-default pupil radius keeps the seed region connected while the assertion
    // below isolates the visible darken-amount effect.
    await setRedEyeOption(page, 'pupil-size', '75');
    await setRedEyeOption(page, 'darken-amount', '50');

    await page.mouse.click(box.x + probeX, box.y + probeY);

    await expect
      .poll(
        async () => {
          const after = await loadImageData(await page.screenshot({ clip }));
          const pixel = await readPixelFromImage(after, clip, box, probeX, probeY);
          return pixel !== null && pixel.r < beforeProbePixel!.r;
        },
        { ...pollOptions, message: 'darkenAmount 50 must reduce the red channel' }
      )
      .toBe(true);

    const afterImage = await loadImageData(await page.screenshot({ clip }));
    const afterPixel = await readPixelFromImage(afterImage, clip, box, probeX, probeY);
    expect(afterPixel, 'pixel should have changed').not.toBeNull();
    // The red channel always collapses to max(g, b); darkenAmount scales the green/blue
    // channels, so a non-zero green drop confirms darkenAmount took effect.
    const greenDrop = beforeProbePixel!.g - afterPixel!.g;
    expect(greenDrop, 'a non-zero green drop means darkenAmount took effect').toBeGreaterThan(0);
  });

  test('does not modify non-red pixels when clicked on a grey area', async ({ page }) => {
    const box = await getCanvasBox(page);

    await clickToolButton(page, 'draw');
    const size = page.getByRole('slider', { name: /^Size/ });
    await size.fill('30');
    await expect(size).toHaveValue('30');
    await setForegroundColor(page, '#808080', true);

    const clip = canvasRedrawClip(box);
    const strokeY = 150;
    await drawLine(page, box, 200, strokeY, 280, strokeY, { steps: 12 });

    // The draw tool blends grey with the white background (~90% opacity), so drawn
    // grey lands around ~140 on each channel — lighter than pure #808080 but still
    // well below pure white, which is the non-red signal we assert on.
    await waitForCanvasPixels(
      page,
      clip,
      async (screenshot) => {
        const pixel = await readPixelFromImage(await loadImageData(screenshot), clip, box, 240, strokeY);
        return pixel !== null && pixel.r < 200 && pixel.g < 200 && pixel.b < 200;
      },
      { description: 'the grey band is drawn' }
    );

    const before = await page.screenshot({ clip });

    await clickToolButton(page, 'red-eye');

    await page.mouse.click(box.x + 240, box.y + strokeY);

    await expect
      .poll(async () => (await page.screenshot({ clip })).equals(before), {
        ...pollOptions,
        message: 'non-red pixels must be byte-identical after a red-eye click',
      })
      .toBe(true);
  });
});
