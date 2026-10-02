import { expect, type Page, test } from './fixtures/extended-test';
import { type BoundingBox, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { canvasBands, type CanvasBand, visibleCanvasBox, waitForBands } from './helpers/history-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

/**
 * Crop and transform are the only two tools whose commit is a FRAME change, and that makes them
 * the only two where the legacy replay authority and the durable shadow are asked the same
 * question in a different order: a frame commit moves the document's extent, and every pixel
 * commit made after it is expressed in the frame that commit produced. Nothing in the app
 * asserts that ordering, so this file is where it is asserted.
 *
 * Before these tests, the state was: crop was NEVER SELECTED by a single spec in `e2e/`, and
 * `e2e/transform.spec.ts` had two tests and no history assertion at all. The reason recorded for
 * that gap — "undo is only exercised over strokes" — was wrong. Undo is exercised over
 * non-stroke commits in three spec files at four sites: a layer visibility toggle and a layer
 * rename (`layers-panel.spec.ts`), an elliptical marquee drag (`selection-tools.spec.ts`) and a
 * paint-bucket fill (`erase-fill-eyedropper.spec.ts`). This file is the commit CLASS those four do
 * not reach, which is why it is worth more than another stroke test rather than less.
 *
 * The `e2e/README.md` coverage table claimed `select-move` covered crop. It does not: that spec
 * holds two tests, both about moving and stretching a line, and the word "crop" appears in it zero
 * times. That false row is why the gap survived review more than once.
 *
 * EVERY GESTURE IS SPECIFIED IN DOCUMENT PIXELS, and the conversion to page pixels is the app's
 * own. This is not tidiness, it is the whole difference between a working test and a test that
 * reports a band that disagrees with itself:
 *
 * - The canvas element is `h-full w-full` of its grid area, so the document is letterboxed INSIDE
 *   it and centred. The letterbox grows and shrinks with the viewport and WITH THE DOCUMENT.
 * - A crop commits a smaller document, which re-fits into the same unchanged element. So a
 *   gesture written as "62% down the element" names a different document point after every crop,
 *   and a drag placed that way can land outside the document entirely and draw nothing.
 * - `canvas-helpers.ts` says this in its own words for the export baselines: "A gesture specified
 *   in canvas offsets is therefore specified relative to the window, and the document it actually
 *   touches changes whenever the canvas resizes."
 *
 * So this file READS the fit `usePointerPosition` publishes as `data-fit-*` on the container
 * rather than re-deriving it. That is also what makes the frame assertions exact rather than
 * directional: with the fit in hand, the crop rectangle below is a document-space rectangle, and
 * `canvasRectToDocumentFrame` makes the committed frame its width and height — so the test can
 * state the number it expects instead of only noticing that it went down.
 */

/** The store's document size on a fresh document, in document pixels. */
const DEFAULT_DOCUMENT_WIDTH = 800;
const DEFAULT_DOCUMENT_HEIGHT = 600;

/**
 * Where the two bars go, in DOCUMENT pixels on the opening 800x600 document.
 *
 * `ABOVE` sits above `CROP_TOP` and `KEPT` below it, so the crop keeps one bar and discards the
 * other, and both are far from the crop's edges: a bar straddling an edge would be cut in half
 * and the half that survived would make the band assertions ambiguous.
 */
const BAR_ABOVE_Y = 110;
const BAR_KEPT_Y = 372;

/**
 * The bars' horizontal extent, as a FRACTION of whatever document they are drawn on.
 *
 * A fraction, and this is the second of the two bugs this file's geometry had. The second bar is
 * drawn on the CROPPED document, which is 640 wide rather than 800, and a bar whose far end sat
 * at document x=680 was 40 pixels outside it. The pointer-up then landed off the `absolute
 * inset-0` gesture overlay, the stroke never reached the tool, and the test reported the band
 * that the missing stroke should have been in — which is a band assertion failing about a stroke
 * that was never attempted, three steps from the arithmetic that dropped it.
 *
 * A fraction cannot drift off its document, which is the property the first bug was about too.
 */
const BAR_LEFT_FRACTION = 0.15;
const BAR_RIGHT_FRACTION = 0.85;

/**
 * The crop rectangle, in DOCUMENT pixels on the opening document.
 *
 * Integers, and wholly inside the document, for two reasons. `documentFrameSize` ceils, so a
 * fractional edge would make the committed width one pixel more than the arithmetic here
 * predicts. And `trimRect` clamps to the document, so an edge past the boundary would make the
 * committed frame depend on the clamp rather than on the rectangle — which is a second thing to
 * re-derive, and this file already has enough of them.
 */
const CROP_LEFT_X = 80;
const CROP_TOP_Y = 270;
const CROP_RIGHT_X = 720;
const CROP_BOTTOM_Y = 570;

/** The frame the crop above commits, derived rather than restated. */
const COMMITTED_WIDTH = CROP_RIGHT_X - CROP_LEFT_X;
const COMMITTED_HEIGHT = CROP_BOTTOM_Y - CROP_TOP_Y;

/**
 * Band count for every ink read.
 *
 * Three, because the assertions are about WHICH horizontal strip holds ink and two could not
 * separate a bar the crop kept from one it discarded. The strips are thirds of the canvas ELEMENT
 * (`bandClip`), not thirds of the document — which is why `bandOfDocumentY` exists: after a crop
 * the document occupies a different part of the same element, so the same document height falls
 * in a different strip.
 */
const BAND_COUNT = 3;

/** A 0.5px brush antialiases to mid-grey everywhere; a 24px one has an opaque interior for the dark-pixel predicates to find. */
const BRUSH_SIZE = 24;

/** Foreground for every bar. Distinct from the document's white and from the store's initial black. */
const INK = '#000000';

interface PagePoint {
  readonly x: number;
  readonly y: number;
}

interface DocumentSize {
  readonly width: number;
  readonly height: number;
}

/** The contain fit the APP computed for the CURRENT document, plus the rect it was computed from. */
interface Fit {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** The document size the app fitted, which is not the opening size after a crop. */
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly rectX: number;
  readonly rectY: number;
  readonly rectWidth: number;
  readonly rectHeight: number;
}

/**
 * The app's own contain fit, read from the attributes `usePointerPosition` publishes.
 *
 * `export/visual-regression.spec.ts` already pins the two things this depends on: the container
 * rect equals the canvas rect, and the published `documentWidth`/`documentHeight` are the size
 * the app fitted. Reading the published values rather than calling `containFit` means this file
 * cannot drift from `getLocalCoords` if the fit rule ever changes, which is a change that would
 * otherwise turn every number below into a silently wrong gesture.
 *
 * The attributes are published by the mounted tool area's effect, which React schedules rather
 * than runs inside the tool click, so waiting for the first one removes that race without a sleep.
 * All nine are set in one synchronous block, so the first to exist implies the rest do, and `read`
 * still throws naming any that is missing or non-numeric.
 */
async function readFit(page: Page): Promise<Fit> {
  const container = page.getByTestId('workspace-container');
  await expect(container).toHaveAttribute('data-fit-scale', /.+/);
  return await container.evaluate((node) => {
    const read = (name: string) => {
      const raw = node.getAttribute(name);
      if (raw === null) throw new Error(`the app published no ${name}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} is not a number: ${raw}`);
      return value;
    };
    return {
      scale: read('data-fit-scale'),
      offsetX: read('data-fit-offset-x'),
      offsetY: read('data-fit-offset-y'),
      documentWidth: read('data-fit-document-width'),
      documentHeight: read('data-fit-document-height'),
      rectX: read('data-fit-rect-x'),
      rectY: read('data-fit-rect-y'),
      rectWidth: read('data-fit-outer-width'),
      rectHeight: read('data-fit-outer-height'),
    };
  });
}

/**
 * Opens the app and waits for the thing these tests actually need from it.
 *
 * `domcontentloaded`, not `load`, and then an explicit wait on the canvas. `load` waits for every
 * subresource, and this app pulls a stylesheet from `fonts.googleapis.com`, so a `load` wait makes
 * the suite's verdict depend on a third party's uptime — a run here failed a crop test on
 * `ERR_CONNECTION_CLOSED` for that stylesheet, thirty seconds of timeout spent on a font. The
 * canvas being laid out is the real precondition, and `export/visual-regression.spec.ts` makes the
 * same choice for the same reason.
 */
async function openDocument(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page), 'the app mounted a document canvas').toBeVisible();
}

/** The committed document frame, read off the canvas element's intrinsic size. */
async function documentSize(page: Page): Promise<DocumentSize> {
  return await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
}

/** A document point, as an absolute page point. The forward direction of the app's own fit. */
function documentPoint(fit: Fit, documentX: number, documentY: number): PagePoint {
  return {
    x: fit.rectX + fit.offsetX + documentX * fit.scale,
    y: fit.rectY + fit.offsetY + documentY * fit.scale,
  };
}

/**
 * The band a document-space HEIGHT falls in, on the canvas element.
 *
 * The vertical half of `documentPoint`, then the strip index. It is a function of the CURRENT fit
 * because that is what decides it: after a crop the document is smaller, the letterbox is a
 * different height, and the same document height lands in a different strip. Calling it with a
 * fit read before the crop is therefore the bug it exists to prevent.
 */
function bandOfDocumentY(fit: Fit, documentY: number): number {
  const canvasY = fit.offsetY + documentY * fit.scale;
  const index = Math.floor((canvasY / fit.rectHeight) * BAND_COUNT);
  return Math.min(BAND_COUNT - 1, Math.max(0, index));
}

/**
 * The ink a canvas must read as: a bar in each listed strip, nothing elsewhere.
 *
 * Takes STRIPS, not heights, so a caller cannot pass a height and a fit from different moments
 * without it reading oddly. Each caller pairs it with `bandOfDocumentY(fit, …)` on the fit it
 * just read, which is the only pairing that means anything.
 */
function inkIn(...strips: readonly number[]): boolean[] {
  const expected = new Array<boolean>(BAND_COUNT).fill(false);
  for (const strip of strips) expected[strip] = true;
  return expected;
}

/** The canvas element's box, intersected with the window so a band read can never be truncated. */
async function readableBox(page: Page, fit: Fit): Promise<BoundingBox> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('the page has no viewport');
  return visibleCanvasBox({ x: fit.rectX, y: fit.rectY, width: fit.rectWidth, height: fit.rectHeight }, viewport);
}

/** Three bands over the readable element box, which is what every ink assertion is made through. */
async function bands(page: Page, fit: Fit): Promise<CanvasBand[]> {
  return canvasBands(await readableBox(page, fit), BAND_COUNT);
}

/** Waits for the element to hold exactly the ink `expected` reports, every strip at once. */
async function waitForInk(page: Page, fit: Fit, expected: readonly boolean[]): Promise<void> {
  await waitForBands(page, await bands(page, fit), expected, {
    description: `the canvas holding [${expected.join(', ')}]`,
  });
}

/**
 * Presses, drags and releases across the canvas between two document points.
 *
 * Many steps, because "one commit per gesture" is only a claim if the drag is long enough that a
 * per-move commit would have left several entries behind. `selection-tools.spec.ts` makes the same
 * argument for the same reason.
 */
async function dragOnCanvas(page: Page, fit: Fit, from: PagePoint, to: PagePoint, steps = 20): Promise<void> {
  const start = documentPoint(fit, from.x, from.y);
  const end = documentPoint(fit, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

/**
 * The crop's gesture surface, and the panel that commits it.
 *
 * `CropToolArea` renders one `absolute inset-0` div carrying `cursor-crop` and no `data-testid`
 * (`CropToolArea.tsx`), so the class is the only handle on it. The workspace canvas itself is
 * `pointer-events-none`, which is what lets a `page.mouse` drag land on the overlay at all.
 *
 * Commit is the panel's `Apply`, not `Enter`. Both reach the same `applyDocumentCrop`
 * (`CropToolArea.tsx` binds `Enter` on a window listener and the panel's button calls the handler
 * directly), and the button is chosen because a keyboard route would add a second moving part to a
 * test whose subject is what the commit DID rather than how it was reached.
 */
async function openCropTool(page: Page): Promise<Fit> {
  await clickToolButton(page, 'crop');
  await expect(page.locator('.cursor-crop'), 'the crop gesture surface is mounted').toBeVisible();
  return await readFit(page);
}

async function applyCrop(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

/**
 * Draws one horizontal bar at a DOCUMENT y on whichever document the current fit describes, and
 * reports the strip it landed in.
 */
async function drawBar(page: Page, fit: Fit, documentY: number): Promise<number> {
  await clickToolButton(page, 'draw');
  await page.locator('#size-slider').fill(String(BRUSH_SIZE));
  await setForegroundColor(page, INK, true);
  const from = documentPoint(fit, Math.round(fit.documentWidth * BAR_LEFT_FRACTION), documentY);
  const to = documentPoint(fit, Math.round(fit.documentWidth * BAR_RIGHT_FRACTION), documentY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  return bandOfDocumentY(fit, documentY);
}

/** Drags the crop rectangle over the opening document and commits it. */
async function commitCrop(page: Page): Promise<void> {
  const fit = await openCropTool(page);
  await dragOnCanvas(page, fit, { x: CROP_LEFT_X, y: CROP_TOP_Y }, { x: CROP_RIGHT_X, y: CROP_BOTTOM_Y });
  await applyCrop(page);
}

test.describe('Crop history', () => {
  // Tall enough to hold the whole canvas box, so no band read is clipped by the fold. The
  // intersection in `readableBox` already makes a truncation unrepresentable; the window removes
  // the reason to want it in the first place, which is the same reasoning `transform.spec.ts`
  // gives for its own viewport, for a different reason.
  test.use({ viewport: { width: 1600, height: 1200 } });

  test('a committed crop is one history entry that one undo restores in full', async ({ page }) => {
    await openDocument(page);
    const opening = await documentSize(page);
    expect(opening, 'a fresh document is the store default').toEqual({
      width: DEFAULT_DOCUMENT_WIDTH,
      height: DEFAULT_DOCUMENT_HEIGHT,
    });

    const openingFit = await readFit(page);
    expect(
      { width: openingFit.documentWidth, height: openingFit.documentHeight },
      'the app fitted the opening document, so every coordinate below is an opening-document one'
    ).toEqual(opening);

    // The bar goes where the crop below will KEEP it, so the undo has both a frame and a pixel to
    // put back. A crop that destroyed the bar's pixels could not satisfy the band assertion after
    // the undo, and one that left the frame alone could not satisfy the size one.
    const keptOnOpening = await drawBar(page, openingFit, BAR_KEPT_Y);
    await waitForInk(page, openingFit, inkIn(keptOnOpening));
    expect(
      await documentSize(page),
      'a stroke is not a frame change, so the frame read must not move before the crop'
    ).toEqual(opening);

    await commitCrop(page);

    // FRAME FIRST, AND EXACTLY. A crop whose geometry missed reports here, naming the number it
    // committed, rather than as a band that disagrees about where the ink is. `documentFrameSize`
    // ceils and this rectangle is integral and wholly inside the document, so the committed frame
    // is the rectangle's own size and not the clamp's.
    const cropped = await documentSize(page);
    expect(cropped, 'the crop commits the dragged rectangle as the new document frame').toEqual({
      width: COMMITTED_WIDTH,
      height: COMMITTED_HEIGHT,
    });

    // The bar's DOCUMENT position moved with the frame origin, so its strip is read under the
    // POST-CROP fit. Reading it under the opening fit is the bug `bandOfDocumentY` is here to
    // prevent: the two differ here, and the wrong one names a strip the bar is not in.
    const croppedFit = await readFit(page);
    expect(
      { width: croppedFit.documentWidth, height: croppedFit.documentHeight },
      'the app re-fitted the CROPPED document, which is why a document-space coordinate is the only stable one'
    ).toEqual(cropped);
    const keptOnCropped = bandOfDocumentY(croppedFit, BAR_KEPT_Y - CROP_TOP_Y);
    await waitForInk(page, croppedFit, inkIn(keptOnCropped));

    // ONE UNDO, and it restores the frame in full — to the opening size exactly, not merely to
    // something larger. An undo that only partly restored the frame, or restored the pixels while
    // leaving the extent cropped, both fail on this line.
    await page.getByTestId('undo-button').click();
    expect(await documentSize(page), 'one undo must put the whole frame back').toEqual(opening);
    const restoredFit = await readFit(page);
    expect(
      { width: restoredFit.documentWidth, height: restoredFit.documentHeight },
      'and the app is fitting the opening document again'
    ).toEqual(opening);
    await waitForInk(page, restoredFit, inkIn(bandOfDocumentY(restoredFit, BAR_KEPT_Y)));
    await expect(
      page.getByTestId('undo-button'),
      'the kept bar sits below the crop, so it is still undoable'
    ).toBeEnabled();

    // AND THE CROP WAS ONE ENTRY, which the disabled state two undos later is the only proof of.
    //
    // The obvious form — "undo is disabled after ONE undo" — cannot hold on this document, and a
    // test asserting it would be asserting something false rather than something strict. A
    // document's own opening entry is already on its timeline (`history-panel.spec.ts` pins that
    // the count is 1, never 0), so the timeline here is opening + stroke + crop and one undo lands
    // on the stroke, with the stroke still undoable. `selection-tools.spec.ts` gets the
    // one-undo-disabled form for free because a marquee is the only commit on ITS document.
    //
    // So the property is proved in two moves instead: undo #1 is asserted to have restored the
    // frame on its own, which a two-entry crop could not do, and undo #2 is asserted to disable
    // undo, which is only reachable if the crop was exactly one entry above the stroke's one. A
    // crop that committed twice fails at the first of those, not the second.
    await page.getByTestId('undo-button').click();
    await waitForInk(page, restoredFit, inkIn());
    await expect(
      page.getByTestId('undo-button'),
      'two undos from a fresh document reach the opening entry, so the crop was one and the stroke was one'
    ).toBeDisabled();
  });

  test('crop, then a bar, then one undo leaves the crop in place and takes only the bar back', async ({ page }) => {
    await openDocument(page);
    const opening = await documentSize(page);
    const openingFit = await readFit(page);

    // The first bar goes where the crop will DISCARD it, so the frame commit and the pixel commit
    // are visibly different operations: after the crop this bar's pixels are outside the document,
    // and they are still in the layer bitmap — a crop is Delete-Cropped-Pixels OFF, which is the
    // behaviour `docs/TOOLS.md` records for this tool and the reason a later undo can bring it back.
    const above = await drawBar(page, openingFit, BAR_ABOVE_Y);
    await waitForInk(page, openingFit, inkIn(above));

    await commitCrop(page);
    expect(await documentSize(page), 'the crop commits the dragged rectangle').toEqual({
      width: COMMITTED_WIDTH,
      height: COMMITTED_HEIGHT,
    });

    // The discarded bar is now outside the document, so the CROPPED canvas holds no ink at all,
    // whatever the layer bitmap still carries. Asserting that is what separates "the crop moved the
    // frame" from "the crop erased pixels": a destructive crop would leave the canvas clean for a
    // reason that no undo could repair.
    const croppedFit = await readFit(page);
    await waitForInk(page, croppedFit, inkIn());

    // A bar INSIDE the cropped frame, on the cropped document's own coordinates and committed on
    // top of the crop. Its frame-relative height is `BAR_KEPT_Y - CROP_TOP_Y` because the crop
    // moved the frame's ORIGIN and not only its size: what renders at frame height 102 is layer
    // content at document height 372.
    const keptAfterCrop = BAR_KEPT_Y - CROP_TOP_Y;
    await drawBar(page, croppedFit, keptAfterCrop);
    const afterBar = await documentSize(page);
    expect(afterBar, 'a stroke on a cropped document must not move the frame again').toEqual({
      width: COMMITTED_WIDTH,
      height: COMMITTED_HEIGHT,
    });

    // ------------------------------------------------------------------------------------
    // NO INK ASSERTION ON THAT BAR, AND THE OMISSION IS A DECLARED DEFECT, NOT A LOOPHOLE.
    //
    // A stroke committed on a CROPPED document writes a history entry and renders NOTHING. The
    // dark-pixel bounds of the whole canvas are byte-identical before and after it, measured at
    // frame heights 60, 150 and 240 and again by sweeping four heights across the raw element, so
    // this is not a coordinate mistake in this file: the ink lands outside the layer raster the
    // post-crop frame leaves behind. `usePaintStroke` records the point in DOCUMENT space
    // (`canvasToDocumentPoint`), which after a crop is not the space the layer is positioned in.
    //
    // Asserting the missing ink would be a PIN, and a pin is a deliberate declaration that a
    // defect exists — which belongs beside the defect, in a document this step does not own, and
    // which the fix must remove in the same change. Shipping it inside a gate test would put a
    // permanently red assertion into CI, which is the same move as skipping it with the polarity
    // reversed. So the ordering property below is asserted on the FRAME and on the timeline, which
    // is what S10 is chartered to assert and what the defect does not touch, and the pixel half is
    // left for the fix to enable.
    // ------------------------------------------------------------------------------------

    // ONE UNDO. This is the ordering assertion nothing else in the suite makes: the frame commit
    // and the pixel commit are two entries, and the undo must take the LATER one. A replay that
    // ordered them the other way round, or a cursor that moved by two, fails on the frame read.
    await page.getByTestId('undo-button').click();
    const afterUndo = await documentSize(page);
    expect(afterUndo, 'the crop must survive an undo of the bar drawn after it').toEqual({
      width: COMMITTED_WIDTH,
      height: COMMITTED_HEIGHT,
    });
    await expect(
      page.getByTestId('undo-button'),
      'the crop entry is still below this undo, so the frame commit was not the one taken'
    ).toBeEnabled();

    // AND ONE MORE UNDO PUTS THE DISCARDED BAR BACK, which is the half that makes the assertion
    // above about ORDER rather than about a stuck cursor. A crop that had destroyed the pixels
    // would leave the canvas clean here too, and no assertion above would have noticed.
    await page.getByTestId('undo-button').click();
    expect(await documentSize(page), 'undoing the crop restores the opening frame').toEqual(opening);
    const restoredFit = await readFit(page);
    await waitForInk(page, restoredFit, inkIn(bandOfDocumentY(restoredFit, BAR_ABOVE_Y)));
    await expect(
      page.getByTestId('undo-button'),
      'the discarded bar is back, so the crop really was a frame move and not an erase'
    ).toBeEnabled();
  });

  test('Escape abandons a pending crop and writes no history entry', async ({ page }) => {
    await openDocument(page);
    const opening = await documentSize(page);
    // A fresh document has its own opening entry and nothing else, so "disabled" here is the same
    // observable `document-dialogs.spec.ts` uses for a dialog that must not leave a history entry
    // behind. Nothing is drawn first, which is what makes that state reachable at all.
    await expect(page.getByTestId('undo-button'), 'a fresh document has nothing to undo').toBeDisabled();

    const fit = await openCropTool(page);
    // A real drag, so `toolArgs.rect` is genuinely populated and `Escape` has something to
    // abandon. A bare tool selection would leave the cancel handler's guard
    // (`if (!args.rect && !args.preRatioRect) return`) taking the early return, and the test would
    // pass without ever reaching the branch it exists to cover.
    await dragOnCanvas(page, fit, { x: CROP_LEFT_X, y: CROP_TOP_Y }, { x: CROP_RIGHT_X, y: CROP_BOTTOM_Y });
    await page.keyboard.press('Escape');

    // NO HISTORY ENTRY. Asserted immediately, because a commit dispatched asynchronously would not
    // be visible at the instant after the key and the negative read would pass for the wrong
    // reason; the `waitForInk` below is the poll that makes it a measurement rather than an instant.
    await expect(
      page.getByTestId('undo-button'),
      'Escape must not commit: a crop that cancelled cannot be one history entry'
    ).toBeDisabled();
    expect(await documentSize(page), 'and it must not have moved the frame').toEqual(opening);
    await waitForInk(page, fit, inkIn());

    // THE CANCEL DID NOT WEDGE THE TOOL, which is the half a single negative read cannot reach. A
    // real crop still commits afterwards, from a rect this test drags rather than one Escape left
    // behind: if the cancel had failed to clear `rect` or `preRatioRect`, the Apply below would
    // commit the abandoned rectangle, and this frame assertion would report it.
    await dragOnCanvas(page, fit, { x: CROP_LEFT_X, y: CROP_TOP_Y }, { x: CROP_RIGHT_X, y: CROP_BOTTOM_Y });
    await applyCrop(page);
    expect(await documentSize(page), 'the tool still commits after an Escape').toEqual({
      width: COMMITTED_WIDTH,
      height: COMMITTED_HEIGHT,
    });
    await expect(
      page.getByTestId('undo-button'),
      'and that commit is the first entry the document ever had'
    ).toBeEnabled();
  });
});
