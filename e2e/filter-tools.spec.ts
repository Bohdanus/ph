import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  DEFAULT_DOCUMENT_SIZE,
  DRAW_TOOL_STROKE_WIDTH,
  canvasOffsetToDocument,
  containFit,
  documentToCanvasOffset,
  drawLine,
  getWorkspaceCanvas,
  hasDarkPixels,
  loadImageData,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { SAMPLE_RADIUS, documentClipInBox, sampleDocumentPoint, sampleWindowCss } from './helpers/document-sampling';
import { type CanvasPixelPredicate, waitForCanvasPixels } from './helpers/canvas-redraw';
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
 * reasonable: measured on this canvas with the window below, 20 takes a point clear of the
 * stroke from 255 (untouched) to 218, and the reading only climbs with distance — 210 on
 * the line itself, 218 twelve units off it, 232 twenty-four units off — so a point further
 * out is a WEAKER reading here and not a stronger one. A radius of 0 is a documented no-op
 * and reads exactly 255.
 */
const BLUR_RADIUS = '20';
/**
 * Between the two observed values (255 untouched, 218 blurred) and clear of both. The
 * untouched side is 245 rather than 250 because 250 is `getColorAtPoint`'s own
 * near-white threshold, and a bound that shared a number with the sampler's internal
 * constant would stop meaning anything the moment either moved.
 */
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
 * How far the Colors re-read after committing is allowed to differ from the preview.
 *
 * Zero would be the honest number — the measured pair is byte-identical, 122/122/122 in
 * both — and it is not used, because two captures of the same canvas are not the same
 * capture and a difference of one or two in an anti-aliased composite is not a defect. A
 * blur of the wrong radius, a filter string that lost a clause, and a commit that dropped
 * the operation entirely all move the reading by tens, so a bound of 8 separates a
 * re-render from a re-render with something different about it, and a document-reverting
 * discard (which reads the white bedrock, 255) by two orders of magnitude more.
 */
const COMMITTED_CHANNEL_TOLERANCE = 8;

/**
 * Half the draw tool's pen width, in DOCUMENT pixels: `DRAW_TOOL_STROKE_WIDTH / 2`, which is
 * `10 / 2 = 5`.
 *
 * `DRAW_TOOL_STROKE_WIDTH` (`e2e/helpers/canvas-helpers.ts`) is the copy of
 * `savedDrawPerPen.pen.lineWidth` (`src/tools/settings.ts`) that the shared helpers own and
 * `document-mapping.unit.test.ts` pins at 10, so the pen width is stated once for the whole
 * suite rather than again here. The layer raster is document-sized, so the corner-to-corner
 * stroke the blur tests draw is ten document pixels wide — five either side of its centre
 * line. The blur is asserted at a point offset from that centre line, so the offset has to be
 * derived rather than chosen. The literal `OFF_THE_LINE = 12` this replaces stood in for two
 * things that are not constants: the stroke's own half-width, which moves with the draw tool's
 * pen setting, and how far back the sample window can see, which is the capture's half-extent
 * in document units. Raise the pen to 16 and the window reaches into the ink, `before.red`
 * reads a stroke/paper mixture instead of the paper, and the assertion that says "this point is
 * background" — `before.red > 245` — is decided by a number that means nothing.
 */
const STROKE_HALF_WIDTH = DRAW_TOOL_STROKE_WIDTH / 2;

/**
 * Clearance beyond the stroke's own half-width, in document units.
 *
 * Three, and a measurement is what pins it: with the capture `sampleWindowCss` builds, the
 * unblurred reading is 241 eight units off the centre line, 254 at ten and 255 from eleven
 * on, so eleven is the first offset whose window is clear of the ink and three carries the
 * derived sum past it. `STROKE_HALF_WIDTH + 8/2/0.9717 + 3 = 12.116` at this fit.
 */
const OFF_THE_LINE_CLEARANCE = 3;

/**
 * Every history row the History tab renders, which is the panel's own count of committed
 * states — the only way to say "exactly one entry" rather than "at least one".
 */
const historyRows = (page: Page) => page.getByTitle('Click to go back to this state');

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
 * different set of canvas offsets. The redraw wait re-measures, because a wait is about
 * where the canvas is now, not where the stroke is.
 */
async function drawVioletStroke(page: Page): Promise<BoundingBox> {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, VIOLET, true);
  const box = await canvasBox(page);
  await drawLine(page, box, STROKE_START_X, STROKE_ROW, STROKE_END_X, STROKE_ROW);
  await waitForCanvasPixels(page, documentClipInBox(box), hasPaintedPixel, { description: 'the stroke' });
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
  // Measured after the tool is chosen, for the wait only: the drag itself measures its own.
  const box = await canvasBox(page);
  await waitForCanvasPixels(page, documentClipInBox(box), hasDarkPixels, { description: 'the base stroke' });
  return { onLine: { x: DOCUMENT_WIDTH / 2, y: DOCUMENT_HEIGHT / 2 } };
}

/**
 * A document point clear of the corner-to-corner stroke, perpendicular to it.
 *
 * The stroke runs along (0.8, 0.6), so (0.6, −0.8) is the unit normal and the point is
 * `OFF_THE_LINE` document units above the line — which is the only place the blur can be
 * observed at all, because the composite there is the layer over the white bedrock.
 *
 * `OFF_THE_LINE` is DERIVED, and the box is measured here rather than taken from the caller
 * because the derivation needs the live fit: the sample window is a rectangle in CSS page
 * pixels, so its half-extent is `windowCss / 2 / scale` DOCUMENT units, and a point offset
 * by less than the half-width plus that is reading the stroke's own anti-aliased edge. At
 * the suite's 974x583 box that is `5 + 4.116 + 3 = 12.116` document units, and the
 * measurement confirms the window is clear there: 255 unblurred, 218 blurred at radius 20.
 */
async function besideTheLine(page: Page, onLine: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page);
  const { scale } = containFit(box, DEFAULT_DOCUMENT_SIZE);
  const windowRadius = sampleWindowCss(SAMPLE_RADIUS) / 2 / scale;
  const distance = STROKE_HALF_WIDTH + windowRadius + OFF_THE_LINE_CLEARANCE;
  const nx = 0.6;
  const ny = -0.8;
  return { x: onLine.x + nx * distance, y: onLine.y + ny * distance };
}

/**
 * Reads a point after an adjustment has been COMMITTED and requires it to be the colour it
 * was before — as a live preview, or as an untouched document.
 *
 * Used for two claims that nothing else in this file can make. For the COMMITTED one:
 * `commitDirtyTool` (`src/hooks/useApp.ts:167-169`) bakes the preview into a real layer plus
 * a history entry on the next tool switch, and the layer then renders through a path that
 * re-derives the filter string from the committed args — `layer-renderer.ts`
 * `filterForOperation` for the runtime replay, `materialization.ts` `filterForOperation` for
 * the durable one. Both are independent of the renderer the preview used, and a mutation
 * confined to either is invisible to a test that never leaves the preview. For the
 * UNTOUCHED one: a panel's discard that reverted the whole document would leave every other
 * assertion in the blur test satisfied while destroying the user's committed work. So: the
 * same document point, the same capture, the same window, after the event.
 */
async function expectCommittedColour(
  page: Page,
  point: { x: number; y: number },
  expected: { red: number; green: number; blue: number },
  what: string
): Promise<void> {
  // Polled rather than read once, because a tool switch re-renders the committed layer
  // asynchronously and a single screenshot can land on the pre-repaint frame.
  let committed: { red: number; green: number; blue: number } | null = null;
  await expect
    .poll(
      async () => {
        const read = await sampleDocumentPoint(page, point.x, point.y);
        if (read) committed = read;
        return read;
      },
      { message: `${what} must still be there after the commit` }
    )
    .not.toBeNull();
  for (const channel of ['red', 'green', 'blue'] as const) {
    expect(
      Math.abs(committed![channel] - expected[channel]),
      `${what}: the ${channel} channel was ${expected[channel]} and reads ${committed![channel]} after the commit`
    ).toBeLessThanOrEqual(COMMITTED_CHANNEL_TOLERANCE);
  }
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

      // `ignoreNearWhite` ON, and this is the assertion that makes the rest of the test
      // mean something. The document behind the layer is white, so a point the stroke has
      // been removed from samples NOTHING rather than a white average: `null` is the answer
      // for an erased stroke, and it is a failure. Without the option the same read returns
      // (255, 255, 255) — and white satisfies both halves of a greyscale claim at once,
      // because its channel spread is 0 and it is a non-null object. That is the shape of a
      // test that passes on a layer the adjustment made invisible.
      const original = await sampleDocumentPoint(page, sample.x, sample.y, { ignoreNearWhite: true });
      expect(original, 'the stroke must be on the canvas to be adjusted').not.toBeNull();
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
      // channel spread is 58 apart on the raw violet and 0 on its greyscale, so this is false
      // before the fill and true after — the same shape as the sibling `adjustments.spec.ts`
      // polls `isNot(hasRedPixels)`. A `null` read is `Infinity`, not 0, so an erased stroke
      // keeps the poll waiting rather than satisfying it.
      const greyscaleSpread = async () => {
        const read = await sampleDocumentPoint(page, sample.x, sample.y, { ignoreNearWhite: true });
        return read ? channelSpread(read) : Number.POSITIVE_INFINITY;
      };
      await expect
        .poll(greyscaleSpread, { message: 'the greyscale preview must reach the pixels' })
        .toBeLessThanOrEqual(12);
      const greyed = await sampleDocumentPoint(page, sample.x, sample.y, { ignoreNearWhite: true });
      // `not.toBeNull()` rather than `toBeTruthy()`: the non-null read IS the survival
      // check, and `toBeTruthy()` is satisfied by the very white this option now refuses.
      expect(greyed, 'the greyscaled stroke must still be on the canvas').not.toBeNull();
      // `grayscale(100%)` is a greyscale, so the three channels have to converge. The raw
      // violet is (141, 112, 170) — 58 apart at the widest, and the assertion is a fifth of
      // it. White, which is also spread-0, was refused three lines up.
      expect(channelSpread(greyed!), `expected a grey pixel, read ${JSON.stringify(greyed)}`).toBeLessThanOrEqual(12);

      // Discard is scoped to the uncommitted preview: the committed stroke is still there
      // when the preview is dropped, and the panel does NOT reach the document timeline.
      await reset.click();
      await expect(reset, 'there is no preview left to discard').toBeDisabled();
      await expect(grayscale, 'the sliders return to their defaults').toHaveAccessibleName('Grayscale 0%');
      // The same keying for the discard: the greyed stroke already satisfies `hasPaintedPixel`,
      // so waiting for "something painted" returns before the preview has been dropped, and
      // the read below would be reading the greyscale it is meant to prove is gone. A `null`
      // read is 0 here rather than `Infinity`, because an erased stroke is precisely what
      // this poll has to reject.
      const restoredSpread = async () => {
        const read = await sampleDocumentPoint(page, sample.x, sample.y, { ignoreNearWhite: true });
        return read ? channelSpread(read) : 0;
      };
      await expect
        .poll(restoredSpread, { message: 'discarding the preview must put the colour back' })
        .toBeGreaterThan(12);
      const restored = await sampleDocumentPoint(page, sample.x, sample.y, { ignoreNearWhite: true });
      expect(restored, 'the restored stroke must be on the canvas').not.toBeNull();
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

    test('grayscale and sepia are separate controls, and the composite survives the commit', async ({ page }) => {
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
      // BELOW blue (141 vs 170) and a 50% grayscale does not change the sign, so the
      // difference is the quantity to poll: a threshold on any single channel passes before
      // sepia has touched a pixel, because the raw violet's green is already 112.
      const redMinusBlue = async () => {
        const toned = await sampleDocumentPoint(page, sample.x, sample.y, { ignoreNearWhite: true });
        return toned ? toned.red - toned.blue : Number.NEGATIVE_INFINITY;
      };
      await expect
        .poll(redMinusBlue, { message: 'the sepia stop must reach the pixels' })
        .toBeGreaterThan(SEPIA_RED_OVER_BLUE);
      const toned = await sampleDocumentPoint(page, sample.x, sample.y, { ignoreNearWhite: true });
      expect(toned, 'the toned stroke must still be on the canvas').not.toBeNull();
      expect(toned!.red, 'a sepia pixel is warm, so red leads').toBeGreaterThan(toned!.blue);

      // ...and the composite is a COMMITTED property, not a preview one. Switching tools is
      // what runs `commitDirtyTool`, and the layer it bakes renders through a different
      // filter derivation than the live preview did. Measured on this canvas the two are
      // byte-identical, 156/142/116 in both, so the claim is exact.
      await clickToolButton(page, 'draw');
      await expect(historyRows(page), 'the two controls became one committed entry').toHaveCount(3);
      await expectCommittedColour(page, sample, toned!, 'the grayscale + sepia composite');
    });
  });

  test.describe('Blur', () => {
    test('a radius of zero is an exact no-op, and a radius carries colour off the stroke', async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const { onLine } = await drawCornerToCornerStroke(page);
      const beside = await besideTheLine(page, onLine);

      await openToolFlyout(page, 'blur');
      await selectFromFlyout(page, { toolName: 'blur', label: 'Blur Tool' });
      const radius = page.getByRole('slider', { name: /^Blur Radius/ });
      await expect(radius).toBeVisible();

      // No `ignoreNearWhite` here, and the reason is the mirror of the Colors test's: this
      // point is BACKGROUND before the blur, so the claim being made is that it reads white
      // and the option that refuses white pixels would return `null` and delete the reading.
      const before = await sampleDocumentPoint(page, beside.x, beside.y);
      expect(before, 'the sample point must exist on the canvas').not.toBeNull();
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

      // ...and back up, so the committed reading below is a blurred one. The round trip is
      // also its own assertion: the same radius applied twice has to produce the same
      // colour, which a preview whose state accumulated between the two would not.
      await radius.fill(BLUR_RADIUS);
      await expect
        .poll(async () => (await sampleDocumentPoint(page, beside.x, beside.y))?.red ?? 0, {
          message: 'the second application of the radius must land on the same value',
        })
        .toBeLessThan(BLURRED_RED);
      const blurred = await sampleDocumentPoint(page, beside.x, beside.y);
      expect(blurred, 'the blurred layer must still be sampled').not.toBeNull();

      await clickToolButton(page, 'draw');
      await expect(historyRows(page), 'the stroke and the blur are two committed entries').toHaveCount(3);
      await expectCommittedColour(page, beside, blurred!, 'the blurred sample point');
    });

    test('the reset control discards the preview and only the preview', async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const { onLine } = await drawCornerToCornerStroke(page);
      const beside = await besideTheLine(page, onLine);

      // The two readings Reset is judged against, taken before the panel ever opens. `onLine`
      // is the load-bearing one: `beside` is 180 document units clear of nothing, and it
      // reads 255 both with and without the stroke, so a Reset that reverted the WHOLE
      // DOCUMENT would leave every assertion below satisfied while destroying the user's
      // committed work. That is not hypothetical — `Blur.tsx:64-68` records the panel's
      // discard having been the shared `<UndoButton />`, which routed to the document
      // timeline's `undo()`, so every click replayed one entry back.
      const beforeOnLine = await sampleDocumentPoint(page, onLine.x, onLine.y, { ignoreNearWhite: true });
      expect(beforeOnLine, 'the stroke itself must be on the canvas to be preserved').not.toBeNull();
      expect(beforeOnLine!.red, 'it is the ink, not the paper, before anything is adjusted').toBeLessThan(
        UNTOUCHED_RED
      );

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

      // THE POINT OF THE TEST, and the only post-reset read that can see a document-level
      // revert: a point ON the stroke, compared against the pre-adjustment colour of that
      // same point. Measured 28 before and 28 after; a document-level undo reads the white
      // bedrock there instead, which is 227 away on a tolerance of 8.
      await expectCommittedColour(page, onLine, beforeOnLine!, 'the stroke under the discarded preview');
    });
  });

  test.describe('Gradient', () => {
    test('a short drag clamps to its two stops and fills the whole layer', async ({ page }, testInfo) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await drawCornerToCornerStroke(page);

      await clickToolButton(page, 'gradient');
      const box = await canvasBox(page);
      // A 100px drag across an 800px document. The projection clamps to [0, 1], so the fill
      // covers the whole layer: the first stop behind the start, the second past the end. A
      // drag as wide as the document would hide exactly that, which is why it is short.
      //
      // The second stop is set to a colour the BEDROCK cannot imitate. The default is
      // `#ffffff` and the bedrock is white, so every "the second stop reached the far end"
      // reading at document (700, 300) or (500, 300) is satisfied on the very first frame,
      // before the gradient exists — and a gradient that stopped at the drag instead of
      // clamping would leave the layer transparent there, the white bedrock would show
      // through, and the test would be green on a fill that stops at its own end point.
      // `#00ff00` is a different colour from the first stop's black AND from white, and its
      // channels are asserted individually, so neither a bedrock read nor a
      // repaint-in-the-wrong-channel can satisfy it. The sibling test below uses `#ff0000`
      // for the same reason on the same two coordinates.
      await page.locator('#gradient-color-b').fill('#00ff00');
      await expect(page.locator('#gradient-color-b')).toHaveValue('#00ff00');
      await dragAcrossDocument(page, { x: 400, y: 300 }, { x: 500, y: 300 });

      // Polled on `green - max(red, blue)`, which is 255 at the stop and 0 on the white
      // bedrock, so the poll cannot be answered by the untouched background. A `null` read is
      // 0 for the same reason.
      await expect
        .poll(
          async () => {
            const far = await sampleDocumentPoint(page, 700, 300);
            return far ? far.green - Math.max(far.red, far.blue) : 0;
          },
          { message: 'the gradient must paint past its own drag, clamped to the second stop' }
        )
        .toBeGreaterThan(200);

      const behind = await sampleDocumentPoint(page, 100, 300);
      expect(behind, 'behind the drag must hold the first stop').not.toBeNull();
      expect(behind!.red, `expected black behind the start, read ${JSON.stringify(behind)}`).toBeLessThan(40);
      expect(behind!.green, 'and it is black, so green is not the second stop either').toBeLessThan(40);
      const start = await sampleDocumentPoint(page, 400, 300);
      expect(start, 'the drag start must be a point on the canvas').not.toBeNull();
      expect(start!.red, 'the drag start is the first stop exactly').toBeLessThan(40);
      expect(start!.green, 'and the second stop has not reached it').toBeLessThan(40);
      const end = await sampleDocumentPoint(page, 500, 300);
      expect(end, 'the drag end must be a point on the canvas').not.toBeNull();
      expect(end!.green, 'the drag end is the second stop exactly').toBeGreaterThan(220);
      expect(end!.red, 'and it is the second stop, not a red one and not the paper').toBeLessThan(40);
      expect(end!.blue, 'and not a blue one either').toBeLessThan(40);
      const far = await sampleDocumentPoint(page, 700, 300);
      expect(far, 'the far end of the layer must be a point on the canvas').not.toBeNull();
      expect(far!.green, 'past the drag the fill is still the second stop').toBeGreaterThan(220);
      expect(far!.red, 'not the white bedrock showing through an unpainted layer').toBeLessThan(40);
      expect(far!.blue, 'not the white bedrock showing through an unpainted layer').toBeLessThan(40);
      // The clamp is a projection, so the second stop holds to the layer's own edge rather
      // than fading back out: 600 is between the drag's end and the far corner, and it reads
      // the stop at full strength.
      const farMid = await sampleDocumentPoint(page, 600, 300);
      expect(farMid!.green, 'the clamped fill holds the stop across the layer').toBeGreaterThan(220);
      expect(farMid!.red).toBeLessThan(40);

      await takeLineScreenshot(page, box, 'gradient-linear', testInfo);
      // The commit itself, through the history panel's own count: "the document entry plus
      // the stroke plus the gradient" is three. `toBeEnabled()` on the undo control would
      // have answered "at least one entry", which is true for one and for fifty — so the
      // message it carried ("exactly one entry") was a claim the assertion could not make.
      await clickToolButton(page, 'draw');
      await expect(historyRows(page), 'the document entry, the stroke and the gradient are three').toHaveCount(3);
      await expectCommittedColour(page, { x: 700, y: 300 }, far!, 'the clamped far end of the gradient');
      await expectCommittedColour(page, { x: 500, y: 300 }, end!, 'the drag end of the gradient');
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
      expect(far, 'the far end of the layer must be a point on the canvas').not.toBeNull();
      expect(far!.red, `expected a red stop past the end, read ${JSON.stringify(far)}`).toBeGreaterThan(200);
      expect(far!.blue, 'a red stop is not white').toBeLessThan(80);

      // The first stop is untouched by the second, which is what makes them two stops.
      const behind = await sampleDocumentPoint(page, 100, 300);
      expect(behind, 'behind the drag must hold the first stop').not.toBeNull();
      expect(behind!.red, 'behind the drag is still the first stop').toBeLessThan(40);
      expect(behind!.green, 'and it is still black').toBeLessThan(40);
    });
  });
});
