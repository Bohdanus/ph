import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  canvasOffsetToDocument,
  documentToCanvasOffset,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  hasDarkPixels,
  loadImageData,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
/**
 * A muted violet rather than a pure primary: `saturate(0)` and a non-zero saturation are
 * only distinguishable on a pixel with grey in it, because a fully saturated colour has
 * nowhere to go in either direction. It is also lighter than the dark-pixel threshold, so
 * the waits for it use `hasPaintedPixel` rather than `hasDarkPixels`.
 */
const VIOLET = '#8060a0';

/** Canvas-relative geometry of the stroke the Colors tests adjust. */
const STROKE_ROW = 150;
const STROKE_START_X = 100;
const STROKE_END_X = 400;
const SAMPLE_X = 250;

const DOCUMENT_WIDTH = 800;
const DOCUMENT_HEIGHT = 600;

/**
 * The blur's radius is in DOCUMENT pixels, because `ctx.filter` runs over the layer's own
 * raster. 20 is chosen from what the filter actually does rather than from what looks
 * reasonable: measured on this canvas, 20 takes a point 12 document units off the stroke
 * from 255 (untouched) to 218, while 60 takes the same point to 240 — a wider blur spreads
 * the same energy thinner, so a bigger radius is a WEAKER reading here and not a stronger
 * one. A radius of 0 is a documented no-op and reads exactly 255.
 */
const BLUR_RADIUS = '20';
/** How far off the stroke the blur has to show, in document units. */
const OFF_THE_LINE = 12;
/** Between the two observed values (255 untouched, 218 blurred) and clear of both. */
const UNTOUCHED_RED = 245;
const BLURRED_RED = 240;
/**
 * The violet reads red 128, green 96, blue 160, so `red - blue` starts at **−32** and a
 * 50% grayscale leaves it negative. `sepia` is the only thing in this test that can make
 * the difference positive, so this threshold needs no knowledge of the exact filter
 * coefficients — only that the sign flips.
 */
const SEPIA_RED_OVER_BLUE = 20;

/**
 * The half-width of the square the sample window averages, in capture pixels. 3 is a 7x7
 * average: wide enough to absorb a capture's resampling, narrow enough that a 20px shape
 * stroke still has a solid interior in it.
 */
const SAMPLE_RADIUS = 3;

const hasPaintedPixel: CanvasPixelPredicate = async (screenshot) => {
  const { width, height, data } = await loadImageData(screenshot);
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const index = (y * width + x) * 4;
      if (data[index + 3] !== 0 && (data[index] < 240 || data[index + 1] < 240 || data[index + 2] < 240)) return true;
    }
  }
  return false;
};

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so the gesture cannot be placed');
  return box;
}

/**
 * The three helpers above — `canvasBox`, `hasPaintedPixel`, `sampleDocumentPoint` — are
 * deliberately local rather than added to `e2e/helpers/`: nothing in the shared module
 * changes, so no existing spec's behaviour can move underneath a commit that is only
 * adding coverage. `shape-tools.spec.ts` carries byte-identical copies; if one of them is
 * promoted into the shared module, all three go together, because two same-named helpers
 * that differ by a sampling radius is the trap this comment exists to prevent.
 *
 * A 17px window centred on a DOCUMENT point, read from a live screenshot of the page.
 *
 * Every coordinate in this file is named in document space and converted here, because
 * `drawLine` takes box-relative offsets and applies no contain scale: an offset computed in
 * one space and asserted in the other is off by the letterbox margin, which is exactly the
 * arithmetic `e2e/OPEN_PROBLEMS.md` records going wrong.
 */
async function sampleDocumentPoint(
  page: Page,
  documentX: number,
  documentY: number
): Promise<{ red: number; green: number; blue: number } | null> {
  // The box is measured here, on every sample, rather than captured once by the caller. A
  // box measured before a tool switch goes stale the moment the new options bar changes the
  // height of the toolbar, and every point in the document then maps to the wrong pixel —
  // the defect `e2e/OPEN_PROBLEMS.md` records. Re-measuring costs one DOM read next to a
  // screenshot, so there is no reason to hold a stale copy.
  const box = await canvasBox(page);
  const offset = documentToCanvasOffset(box, documentX, documentY);
  const half = 8;
  const screenshot = await page.screenshot({
    clip: { x: box.x + offset.x - half, y: box.y + offset.y - half, width: half * 2 + 1, height: half * 2 + 1 },
  });
  return getColorAtPoint(screenshot, half, half, SAMPLE_RADIUS);
}

const channelSpread = (c: { red: number; green: number; blue: number }): number =>
  Math.max(c.red, c.green, c.blue) - Math.min(c.red, c.green, c.blue);

/** A drag given in document coordinates, performed at the box's own scale. */
async function dragAcrossDocument(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  // Measured here rather than taken from the caller: a box captured before a tool switch is
  // stale the moment the new options bar changes the height of the toolbar, and the drag
  // then lands somewhere other than the two document points it names.
  const box = await canvasBox(page);
  const start = documentToCanvasOffset(box, from.x, from.y);
  const end = documentToCanvasOffset(box, to.x, to.y);
  await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: 10 });
}

/**
 * Draws the stroke and RETURNS the box it drew with. The box has to be the one the gesture
 * used, not one measured later: the sample point is derived by converting a box-relative
 * offset out into document space, and a box measured after a tool switch describes a
 * different set of canvas offsets. The clip waits re-measure, because a clip is about where
 * the canvas is now, not where the stroke is.
 */
async function drawVioletStroke(page: Page): Promise<BoundingBox> {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, VIOLET, true);
  const box = await canvasBox(page);
  await drawLine(page, box, STROKE_START_X, STROKE_ROW, STROKE_END_X, STROKE_ROW);
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasPaintedPixel, { description: 'the stroke' });
  return box;
}

/**
 * Puts a full-document layer on the stack and returns the point on its stroke, because both
 * the gradient and the blur need a layer bigger than one gesture.
 *
 * The gradient refuses to run on the bedrock layer (`GradientToolArea` gates on
 * `!isBedrock`) and paints into the active layer's own bounds, and the blur can only pull
 * colour out of a stroke that has somewhere inside ITS OWN LAYER to spread it — a short
 * stroke's layer is padded by one pixel past the stroke, so blurring it can only lighten the
 * stroke's own edge against the transparent surround. A corner-to-corner stroke's bounding
 * box is the whole document, which is the only cheap way to get that room.
 */
async function drawCornerToCornerStroke(page: Page): Promise<{ onLine: { x: number; y: number } }> {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, '#000000', true);
  await dragAcrossDocument(page, { x: 0, y: 0 }, { x: DOCUMENT_WIDTH, y: DOCUMENT_HEIGHT });
  // Measured after the tool is chosen, for the clip only: the drag itself measures its own.
  const box = await canvasBox(page);
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasDarkPixels, { description: 'the base stroke' });
  return { onLine: { x: DOCUMENT_WIDTH / 2, y: DOCUMENT_HEIGHT / 2 } };
}

/**
 * A document point `OFF_THE_LINE` away from the corner-to-corner stroke, perpendicular to
 * it. The stroke runs along (0.8, 0.6), so (0.6, -0.8) is the unit normal and the point is
 * `OFF_THE_LINE` document units above the line — which is the only place the blur can be
 * observed at all, because the composite there is the layer over the white bedrock.
 */
function besideTheLine(onLine: { x: number; y: number }): { x: number; y: number } {
  const nx = 0.6;
  const ny = -0.8;
  return { x: onLine.x + nx * OFF_THE_LINE, y: onLine.y + ny * OFF_THE_LINE };
}

test.describe('Adjustment tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test.describe('Colors', () => {
    test('grayscale reaches the pixels, and Reset puts them back', async ({ page }, testInfo) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const drawBox = await drawVioletStroke(page);
      // The stroke was placed in box-relative offsets, so the point to sample has to be
      // converted OUT of that space rather than into it.
      const sample = canvasOffsetToDocument(drawBox, SAMPLE_X, STROKE_ROW);

      const original = await sampleDocumentPoint(page, sample.x, sample.y);
      expect(original, 'the stroke must be on the canvas to be adjusted').toBeTruthy();
      expect(channelSpread(original!), 'the unadjusted stroke is not grey').toBeGreaterThan(12);

      await openToolFlyout(page, 'color');
      await selectFromFlyout(page, { toolName: 'color', label: 'Colors' });
      const grayscale = page.locator('#grayscale-slider');
      const reset = page.getByTestId('undo-button-reset');

      // Nothing is previewed until a control moves, and the discard control is gated on the
      // preview rather than on there being a committed adjustment to discard.
      await expect(reset).toBeDisabled();

      // Not 0: 0 is this control's seeded default, and a controlled input set to the value
      // it already holds fires no store update, so no preview is created and the whole
      // half of the contract under test would be skipped without saying so.
      await grayscale.fill('100');
      await expect(grayscale, 'the store took the value, not just the input').toHaveAccessibleName('Grayscale 100%');
      await expect(reset, 'moving a control is what creates the preview to discard').toBeEnabled();
      // The poll keys on the STATE the assertion below reads, not on the stroke's existence:
      // `hasPaintedPixel` is true of the violet stroke that is already there, so waiting for
      // "something painted" returns on the first frame and the read races the repaint. The
      // channel spread is 64 apart on the raw violet and 0 on its greyscale, so this is false
      // before the fill and true after — the same shape as the sibling `adjustments.spec.ts`
      // polls `isNot(hasRedPixels)`.
      const greyscaleSpread = async () => {
        const read = await sampleDocumentPoint(page, sample.x, sample.y);
        return read ? channelSpread(read) : Number.POSITIVE_INFINITY;
      };
      await expect
        .poll(greyscaleSpread, { message: 'the greyscale preview must reach the pixels' })
        .toBeLessThanOrEqual(12);
      const greyed = await sampleDocumentPoint(page, sample.x, sample.y);
      expect(greyed, 'the greyscaled stroke must still be on the canvas').toBeTruthy();
      // `grayscale(100%)` is a greyscale, so the three channels have to converge. The raw
      // violet is (128, 96, 160) — 64 apart at the widest, and the assertion is a fifth of it.
      expect(channelSpread(greyed!), `expected a grey pixel, read ${JSON.stringify(greyed)}`).toBeLessThanOrEqual(12);

      // Discard is scoped to the uncommitted preview: the committed stroke is still there
      // when the preview is dropped, and the panel does NOT reach the document timeline.
      await reset.click();
      await expect(reset, 'there is no preview left to discard').toBeDisabled();
      await expect(grayscale, 'the sliders return to their defaults').toHaveAccessibleName('Grayscale 0%');
      // The same keying for the discard: the greyed stroke already satisfies `hasPaintedPixel`,
      // so waiting for "something painted" returns before the preview has been dropped, and
      // the read below would be reading the greyscale it is meant to prove is gone.
      const restoredSpread = async () => {
        const read = await sampleDocumentPoint(page, sample.x, sample.y);
        return read ? channelSpread(read) : 0;
      };
      await expect
        .poll(restoredSpread, { message: 'discarding the preview must put the colour back' })
        .toBeGreaterThan(12);
      const restored = await sampleDocumentPoint(page, sample.x, sample.y);
      expect(channelSpread(restored!), 'discarding the preview did not put the pixels back').toBeGreaterThan(12);
      // The same colour, not merely some colour: the panel restored the committed stroke
      // rather than repainting an approximation of it.
      for (const channel of ['red', 'green', 'blue'] as const) {
        expect(Math.abs(restored![channel] - original![channel]), `${channel} came back changed`).toBeLessThanOrEqual(
          12
        );
      }
      await takeLineScreenshot(page, await canvasBox(page), 'colors-restored', testInfo);
    });

    test('grayscale and sepia are separate controls and neither moves the other', async ({ page }) => {
      const drawBox = await drawVioletStroke(page);
      const sample = canvasOffsetToDocument(drawBox, SAMPLE_X, STROKE_ROW);

      await openToolFlyout(page, 'color');
      await selectFromFlyout(page, { toolName: 'color', label: 'Colors' });
      const grayscale = page.locator('#grayscale-slider');
      const sepia = page.locator('#sepia-slider');
      await expect(grayscale).toHaveValue('0');
      await expect(sepia).toHaveValue('0');

      // Each control is waited on through its ACCESSIBLE NAME rather than its value: the
      // name is the label's own readout, which comes from the store, so waiting on it is
      // waiting for the store to have taken the value before the next control is touched.
      // `Color.tsx` writes through a requestAnimationFrame from a render-time closure, so
      // two fills back to back race and the second one can be built on the first one's args.
      await grayscale.fill('50');
      await expect(grayscale).toHaveAccessibleName('Grayscale 50%');
      await sepia.fill('100');
      await expect(sepia).toHaveAccessibleName('Sepia 100%');
      await expect(grayscale, 'the two controls carry independent state').toHaveAccessibleName('Grayscale 50%');

      // `sepia()` is a warm matrix, so it pushes red above blue. The violet starts with red
      // BELOW blue (128 vs 160) and a 50% grayscale does not change the sign, so the
      // difference is the quantity to poll: a threshold on any single channel passes before
      // sepia has touched a pixel, because the raw violet's green is already 96.
      const redMinusBlue = async () => {
        const toned = await sampleDocumentPoint(page, sample.x, sample.y);
        return toned ? toned.red - toned.blue : -999;
      };
      await expect
        .poll(redMinusBlue, { message: 'the sepia stop must reach the pixels' })
        .toBeGreaterThan(SEPIA_RED_OVER_BLUE);
      const toned = await sampleDocumentPoint(page, sample.x, sample.y);
      expect(toned!.red, 'a sepia pixel is warm, so red leads').toBeGreaterThan(toned!.blue);
    });
  });

  test.describe('Blur', () => {
    test('a radius of zero is an exact no-op, and a radius carries colour off the stroke', async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const { onLine } = await drawCornerToCornerStroke(page);
      const beside = besideTheLine(onLine);

      await openToolFlyout(page, 'blur');
      await selectFromFlyout(page, { toolName: 'blur', label: 'Blur Tool' });
      const radius = page.getByRole('slider', { name: /^Blur Radius/ });
      await expect(radius).toBeVisible();

      const before = await sampleDocumentPoint(page, beside.x, beside.y);
      expect(before, 'the sample point must exist on the canvas').toBeTruthy();
      expect(before!.red, 'it is the layer over the white bedrock to begin with').toBeGreaterThan(UNTOUCHED_RED);

      await radius.fill(BLUR_RADIUS);
      await expect(radius).toHaveValue(BLUR_RADIUS);
      // The filter runs over the whole layer, so the stroke's own colour arrives at a point
      // that was background a moment ago. A fixed sleep here would race the repaint; the
      // poll is the wait.
      await expect
        .poll(async () => (await sampleDocumentPoint(page, beside.x, beside.y))?.red ?? 255, {
          message: 'the blur must carry colour off the stroke into its own layer',
        })
        .toBeLessThan(BLURRED_RED);

      // Zero has to be a ROUND TRIP to be tested at all. It is also this control's seeded
      // default, and a controlled input set to the value it already holds fires no store
      // update — so `fill('0')` on a cold panel changes nothing and the assertion would be
      // comparing the pre-blur pixels with themselves. Going up first and back down is the
      // only shape in which "a radius of zero is a no-op" can fail.
      await radius.fill('0');
      await expect(radius).toHaveValue('0');
      await expect
        .poll(async () => (await sampleDocumentPoint(page, beside.x, beside.y))?.red ?? 0, {
          message: 'a radius of zero must put every pixel back exactly where it was',
        })
        .toBeGreaterThan(UNTOUCHED_RED);
    });

    test('the reset control discards the preview and only the preview', async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const { onLine } = await drawCornerToCornerStroke(page);
      const beside = besideTheLine(onLine);

      await openToolFlyout(page, 'blur');
      await selectFromFlyout(page, { toolName: 'blur', label: 'Blur Tool' });
      const radius = page.getByRole('slider', { name: /^Blur Radius/ });
      const reset = page.getByTestId('undo-button-reset');
      await expect(reset).toBeDisabled();

      await radius.fill(BLUR_RADIUS);
      await expect(reset).toBeEnabled();
      await expect
        .poll(async () => (await sampleDocumentPoint(page, beside.x, beside.y))?.red ?? 255)
        .toBeLessThan(BLURRED_RED);

      await reset.click();
      await expect(reset).toBeDisabled();
      await expect(radius, 'the slider returns to its own default').toHaveValue('0');
      await expect
        .poll(async () => (await sampleDocumentPoint(page, beside.x, beside.y))?.red ?? 0)
        .toBeGreaterThan(UNTOUCHED_RED);
    });
  });

  test.describe('Gradient', () => {
    test('a short drag clamps to its two stops and fills the whole layer', async ({ page }, testInfo) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await drawCornerToCornerStroke(page);

      await clickToolButton(page, 'gradient');
      const box = await canvasBox(page);
      // A 100px drag across an 800px document. The projection clamps to [0, 1], so the fill
      // covers the whole layer: black behind the start, white past the end. A drag as wide
      // as the document would hide exactly that, which is why it is short.
      await dragAcrossDocument(page, { x: 400, y: 300 }, { x: 500, y: 300 });

      await expect
        .poll(async () => (await sampleDocumentPoint(page, 700, 300))?.red ?? 0, {
          message: 'the gradient must paint past its own drag, clamped to the second stop',
        })
        .toBeGreaterThan(220);
      const behind = await sampleDocumentPoint(page, 100, 300);
      expect(behind, 'behind the drag must hold the first stop').toBeTruthy();
      expect(behind!.red, `expected black behind the start, read ${JSON.stringify(behind)}`).toBeLessThan(40);
      const start = await sampleDocumentPoint(page, 400, 300);
      expect(start!.red, 'the drag start is the first stop exactly').toBeLessThan(40);
      const end = await sampleDocumentPoint(page, 500, 300);
      expect(end!.red, 'the drag end is the second stop exactly').toBeGreaterThan(220);
      expect(end!.green, 'and it is white, not a tinted grey').toBeGreaterThan(220);

      await takeLineScreenshot(page, box, 'gradient-linear', testInfo);
      await expect(page.getByTestId('undo-button'), 'the drag committed exactly one entry').toBeEnabled();
    });

    test('the second stop colour reaches the far end of the drag', async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await drawCornerToCornerStroke(page);

      await clickToolButton(page, 'gradient');
      await page.locator('#gradient-color-b').fill('#ff0000');
      await expect(page.locator('#gradient-color-b')).toHaveValue('#ff0000');

      await dragAcrossDocument(page, { x: 400, y: 300 }, { x: 500, y: 300 });

      await expect
        .poll(
          async () => {
            const far = await sampleDocumentPoint(page, 700, 300);
            return far ? far.green : 255;
          },
          { message: 'the second stop must reach the pixels beyond the drag' }
        )
        .toBeLessThan(80);
      const far = await sampleDocumentPoint(page, 700, 300);
      expect(far!.red, `expected a red stop past the end, read ${JSON.stringify(far)}`).toBeGreaterThan(200);
      expect(far!.blue, 'a red stop is not white').toBeLessThan(80);

      // The first stop is untouched by the second, which is what makes them two stops.
      const behind = await sampleDocumentPoint(page, 100, 300);
      expect(behind!.red, 'behind the drag is still the first stop').toBeLessThan(40);
      expect(behind!.green, 'and it is still black').toBeLessThan(40);
    });
  });
});
