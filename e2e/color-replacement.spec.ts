import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  canvasRedrawClip,
  drawLine,
  getWorkspaceCanvas,
  loadImageData,
  getColorAtPoint,
  LINE_START_X,
  LINE_END_X,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels, type CanvasPixelPredicate } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { openToolFlyout, selectFromFlyout, expectToolSelected } from './helpers/toolbar-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';
import { cssPointToImage } from './helpers/screenshot-scale';

/**
 * The Color Replacement Tool, with dedicated e2e coverage.
 *
 * Photoshop's Color Replacement: click to sample a colour, then drag across the pixels to
 * replace. The tool substitutes the replacement colour while preserving the source pixel's luminance
 * (`replaceColorPreservingLuminance`), so shading is retained.
 *
 * Zero e2e coverage existed beyond an incidental check in `keyboard-shortcuts.spec.ts`.
 */

const PIXEL_POLL_TIMEOUT_MS = 15_000;
const PIXEL_POLL_INTERVAL_MS = 100;
const pollOptions = { timeout: PIXEL_POLL_TIMEOUT_MS, intervals: [PIXEL_POLL_INTERVAL_MS] };

const STROKE_Y = 150;
const SAMPLE_X = 250;
const DRAG_START_X = 220;
const DRAG_END_X = 280;
const UNTOUCHED_X = 170;

/** Matches any red pixel: red channel must exceed both green and blue significantly. */
const hasRedPixel: CanvasPixelPredicate = async (screenshot) => {
  const { data } = await loadImageData(screenshot);
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    if (r > g + 80 && r > b + 80) return true;
  }
  return false;
};

async function getCanvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('workspace canvas has no bounding box');
  return box;
}

async function setColourReplacementOption(page: Page, name: string, value: string): Promise<void> {
  const slider = page.locator(`#color-replacement-${name}`);
  await expect(slider).toBeVisible();
  await slider.fill(value);
  await expect(slider).toHaveValue(value);
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function readPixel(
  screenshot: Buffer,
  clip: { x: number; y: number; width: number; height: number },
  box: BoundingBox,
  docX: number,
  docY: number
): Promise<{ r: number; g: number; b: number } | null> {
  const image = await loadImageData(screenshot);
  const point = cssPointToImage(
    image,
    { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
    {
      x: box.x + docX,
      y: box.y + docY,
    }
  );
  const color = await getColorAtPoint(image, Math.round(point.x), Math.round(point.y), 0);
  if (color === null) return null;
  return { r: color.red, g: color.green, b: color.blue };
}

async function setupColorReplacement(page: Page): Promise<BoundingBox> {
  await openToolFlyout(page, 'brush');
  await selectFromFlyout(page, { toolName: 'color-replacement', label: 'Color Replacement Tool' });
  await expectToolSelected(page, 'color-replacement');
  await page.locator('#color-replacement-limits').selectOption('discontinuous');
  const size = page.getByRole('slider', { name: /^Size/ });
  await size.fill('30');
  await expect(size).toHaveValue('30');
  return await getCanvasBox(page);
}

test.describe('Color Replacement tool', () => {
  test.describe.configure({ timeout: PAINT_TOOLS_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('samples a source with a click and replaces the dragged segment with the foreground color', async ({ page }) => {
    const box = await getCanvasBox(page);

    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'brush', label: 'Brush Tool' });
    const brushSize = page.getByRole('slider', { name: /^Size/ });
    await brushSize.fill('30');
    await expect(brushSize).toHaveValue('30');
    await setForegroundColor(page, '#ff0000', true);

    await drawLine(page, box, LINE_START_X, STROKE_Y, LINE_END_X, STROKE_Y, { steps: 16 });

    const sourceClip = canvasRedrawClip(box);
    await waitForCanvasPixels(
      page,
      sourceClip,
      async (screenshot) => {
        const pixel = await readPixel(screenshot, sourceClip, box, SAMPLE_X, STROKE_Y);
        return pixel !== null && pixel.r > 220 && pixel.g < 40 && pixel.b < 40;
      },
      { description: 'the red source stroke' }
    );

    const replacementBox = await setupColorReplacement(page);
    await setForegroundColor(page, '#00ff00', true);

    const replacementClip = canvasRedrawClip(replacementBox);
    await page.mouse.click(replacementBox.x + SAMPLE_X, replacementBox.y + STROKE_Y);
    await expect(page.getByText('Sampled rgb(')).toBeVisible();

    await drawLine(page, replacementBox, DRAG_START_X, STROKE_Y, DRAG_END_X, STROKE_Y, { steps: 12 });

    await expect
      .poll(
        async () => {
          const screenshot = await page.screenshot({ clip: replacementClip });
          const replaced = await readPixel(screenshot, replacementClip, replacementBox, SAMPLE_X, STROKE_Y);
          const untouched = await readPixel(screenshot, replacementClip, replacementBox, UNTOUCHED_X, STROKE_Y);
          if (replaced === null || untouched === null) return false;
          return (
            replaced.g > replaced.r + 40 && replaced.b < 40 && untouched.r > 220 && untouched.g < 40 && untouched.b < 40
          );
        },
        { ...pollOptions, message: 'only the dragged red segment is replaced with green' }
      )
      .toBe(true);
  });

  test('preserves luminance of the source pixels', async ({ page }) => {
    const box = await getCanvasBox(page);

    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'brush', label: 'Brush Tool' });
    const brushSize = page.getByRole('slider', { name: /^Size/ });
    await brushSize.fill('30');
    await expect(brushSize).toHaveValue('30');

    await setForegroundColor(page, '#808080', true);
    await drawLine(page, box, LINE_START_X, STROKE_Y, LINE_END_X, STROKE_Y, { steps: 16 });

    const clip = canvasRedrawClip(box);
    await waitForCanvasPixels(
      page,
      clip,
      async (screenshot) => {
        const pixel = await readPixel(screenshot, clip, box, SAMPLE_X, STROKE_Y);
        return pixel !== null && pixel.r > 120 && pixel.g > 120 && pixel.b > 120;
      },
      { description: 'the grey source stroke' }
    );

    const beforeImage = await page.screenshot({ clip });
    const beforePixel = await readPixel(beforeImage, clip, box, SAMPLE_X, STROKE_Y);
    expect(beforePixel, 'should have a grey pixel at the probe').not.toBeNull();
    const beforeLuma = luma(beforePixel!.r, beforePixel!.g, beforePixel!.b);

    const replacementBox = await setupColorReplacement(page);
    const replacementClip = canvasRedrawClip(replacementBox);
    await setForegroundColor(page, '#5078c8', true);

    await page.mouse.click(replacementBox.x + SAMPLE_X, replacementBox.y + STROKE_Y);
    await expect(page.getByText('Sampled rgb(')).toBeVisible();

    await setColourReplacementOption(page, 'tolerance', '80');

    await drawLine(page, replacementBox, DRAG_START_X, STROKE_Y, DRAG_END_X, STROKE_Y, { steps: 12 });

    await expect
      .poll(
        async () => {
          const after = await page.screenshot({ clip: replacementClip });
          const pixel = await readPixel(after, replacementClip, replacementBox, SAMPLE_X, STROKE_Y);
          if (pixel === null) return false;
          if (pixel.b < pixel.r || pixel.b < pixel.g) return false;
          const afterLuma = luma(pixel.r, pixel.g, pixel.b);
          return Math.abs(afterLuma - beforeLuma) < 2.0;
        },
        { ...pollOptions, message: 'the replacement must preserve luminance within ~2 luma units' }
      )
      .toBe(true);
  });

  test('tolerance controls which nearby colors are replaced', async ({ page }) => {
    const box = await getCanvasBox(page);
    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'brush', label: 'Brush Tool' });
    const brushSize = page.getByRole('slider', { name: /^Size/ });
    await brushSize.fill('30');
    await expect(brushSize).toHaveValue('30');
    await setForegroundColor(page, '#ff0000', true);
    await drawLine(page, box, LINE_START_X, STROKE_Y, LINE_END_X, STROKE_Y, { steps: 16 });

    const sourceClip = canvasRedrawClip(box);
    await waitForCanvasPixels(page, sourceClip, hasRedPixel, { description: 'the red source layer is drawn' });

    const replacementBox = await setupColorReplacement(page);
    const clip = canvasRedrawClip(replacementBox);

    // Recolour one part of the same active layer, creating a near-red target without asking
    // the tool to sample across Draw's per-stroke layer boundary.
    await setForegroundColor(page, '#ff3333', true);
    await page.mouse.click(replacementBox.x + SAMPLE_X, replacementBox.y + STROKE_Y);
    await expect(page.getByText('Sampled rgb(255, 0, 0)')).toBeVisible();
    await setColourReplacementOption(page, 'tolerance', '100');
    await drawLine(page, replacementBox, DRAG_START_X, STROKE_Y, DRAG_END_X, STROKE_Y, { steps: 12 });

    const tintImage = await page.screenshot({ clip });
    const tinted = await readPixel(tintImage, clip, replacementBox, SAMPLE_X, STROKE_Y);
    expect(tinted, 'the replacement should create a distinct near-red pixel').not.toBeNull();
    expect(tinted!.g).toBeGreaterThan(0);

    await setForegroundColor(page, '#00ff00', true);
    await page.mouse.click(replacementBox.x + UNTOUCHED_X, replacementBox.y + STROKE_Y);
    await expect(page.getByText('Sampled rgb(255, 0, 0)')).toBeVisible();

    await setColourReplacementOption(page, 'tolerance', '0');
    const lowToleranceBox = await getCanvasBox(page);
    await drawLine(page, lowToleranceBox, DRAG_START_X, STROKE_Y, DRAG_END_X, STROKE_Y, { steps: 12 });
    const afterLow = await page.screenshot({ clip });
    const lowPixel = await readPixel(afterLow, clip, replacementBox, SAMPLE_X, STROKE_Y);
    expect(lowPixel, 'zero tolerance should leave a different near-red pixel unchanged').toEqual(tinted);

    await setColourReplacementOption(page, 'tolerance', '100');
    const highToleranceBox = await getCanvasBox(page);
    await drawLine(page, highToleranceBox, DRAG_START_X, STROKE_Y, DRAG_END_X, STROKE_Y, { steps: 12 });
    const afterHigh = await page.screenshot({ clip });
    const highPixel = await readPixel(afterHigh, clip, replacementBox, SAMPLE_X, STROKE_Y);
    expect(highPixel, 'maximum tolerance should reach the near-red pixel').not.toEqual(tinted);
  });
});
