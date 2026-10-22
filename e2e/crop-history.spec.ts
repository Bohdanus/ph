import { expect, type Page, test } from './fixtures/extended-test';
import path from 'node:path';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import type { BoundingBox } from './helpers/canvas-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { canvasBands, type CanvasBand, visibleCanvasBox, waitForBands } from './helpers/history-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import type { DrawToolArgs } from '../src/tools/draw.ts';
import type { ShapeToolArgs } from '../src/tools/shape.ts';
import type { Layer } from '../src/contexts/layer-types.ts';

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
 * - A crop commits a new document frame, SMALLER where the rect lies inside the document and
 *   LARGER where it leaves it, and either way it re-fits into the same unchanged element. So a
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
 * Integers, and that is unchanged: `sortRoundRect` rounds each edge once and `documentFrameSize`
 * ceils the extent, so a fractional edge would commit a width the arithmetic below does not
 * predict.
 *
 * Wholly inside the document, and that is a CHOICE now rather than a requirement.
 * `applyDocumentCrop` (`src/contexts/useLayer.ts`) normalises the gesture rect with
 * `sortRoundRect` (`src/util/rect.ts`), which sorts and rounds with NO clamp — the `trimRect` this
 * paragraph used to name is gone from the commit path — so an edge past the boundary no longer
 * makes the committed frame depend on a clamp: it commits the rectangle exactly, growing the
 * document. The three tests that use these four constants are the SHRINK case, and the first two
 * are built around a bar the crop keeps and a bar it discards, so their every claim is about the
 * frame moving INWARD. The growing rectangles therefore have their own constants below, which is
 * where an overhang belongs now, and no test in this file has to re-derive what one commits.
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

/**
 * The three rectangles that leave the document, in DOCUMENT pixels on the opening 800x600 one.
 *
 * Their own constants, and not `CROP_LEFT_X` and its three neighbours, because those are the
 * existing tests' rectangle and this file states in the comment above them that they are wholly
 * INSIDE the document: an out-of-bounds value among them would silently change what the three
 * committed crops commit, and the suite would still be green.
 *
 * Every edge here is an integer, for the reason the existing rectangle gives — `sortRoundRect`
 * rounds each edge once and `documentFrameSize` ceils the extent, so a fractional edge makes the
 * committed size a number the arithmetic below does not predict. The released page point is
 * `documentPoint(fit, …)` and is re-derived from the app's own fit, so the fraction the double
 * arithmetic introduces lands a millionth of a pixel from an integer rather than a half of one.
 */
const GROW_FROM = { x: 20, y: 20 };
/** Past the document's right edge (800) by 120 and its bottom edge (600) by 60. */
const GROW_TO = { x: 920, y: 660 };
/** The frame the rectangle above commits: 800 + 100 wide, 600 + 40 tall, origin unmoved. */
const GROW_WIDTH = GROW_TO.x - GROW_FROM.x;
const GROW_HEIGHT = GROW_TO.y - GROW_FROM.y;

/** Dragged UP AND LEFT, so the rectangle is inverted as dragged and `sortRect` has to sort it. */
const ORIGIN_FROM = { x: 700, y: 400 };
/** Past the document's left edge (0) by 24 and its top edge (0) by 40. */
const ORIGIN_TO = { x: -24, y: -40 };
/**
 * `ORIGIN_TO.x - ORIGIN_FROM.x` and the other way round, because the edges arrive the other way
 * round: 700 - (-24) = 724 and 400 - (-40) = 440.
 */
const ORIGIN_WIDTH = ORIGIN_FROM.x - ORIGIN_TO.x;
const ORIGIN_HEIGHT = ORIGIN_FROM.y - ORIGIN_TO.y;

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

async function openRasterFixture(page: Page, rootDir: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-open-button').click();
  await acceptDiscardPrompt(page);
  await (await chooser).setFiles(path.join(rootDir, 'fixtures/split-half-red-blue.png'));
}

async function readCanvasColor(page: Page, x: number, y: number) {
  return getWorkspaceCanvas(page).evaluate(
    (canvas, point) => {
      const context = (canvas as HTMLCanvasElement).getContext('2d');
      if (!context) throw new Error('document canvas has no 2D context');
      const pixel = context.getImageData(point.x, point.y, 1, 1).data;
      return { red: pixel[0], green: pixel[1], blue: pixel[2], alpha: pixel[3] };
    },
    { x, y }
  );
}

async function readCanvasRegion(page: Page, testId: string, x: number, y: number, width: number, height: number) {
  return page.getByTestId(testId).evaluate(
    (canvas, region) => {
      const context = (canvas as HTMLCanvasElement).getContext('2d');
      if (!context) throw new Error('Canvas has no 2D context');
      return Array.from(context.getImageData(region.x, region.y, region.width, region.height).data);
    },
    { x, y, width, height }
  );
}

/**
 * That a release really did leave the document, on the edge it claims to have left by.
 *
 * The one assertion an out-of-bounds drag cannot do without. Every other number below is
 * arithmetic on a page point, so nothing else in the test would notice if the letterbox had
 * shrunk and the drag had quietly become an ordinary inside crop — the committed size would
 * still be the size the arithmetic predicts for the rectangle that was dragged, and the test
 * would go on asserting growth it never performed. So the release is measured against the
 * document's own edge ON THE PAGE, which is where the two numbers have to be compared.
 */
function expectReleasePastDocumentEdge(fit: Fit, release: PagePoint, edge: string, what: string): void {
  const left = fit.rectX + fit.offsetX;
  const top = fit.rectY + fit.offsetY;
  const documentEdge = {
    left,
    right: left + fit.documentWidth * fit.scale,
    top,
    bottom: top + fit.documentHeight * fit.scale,
  }[edge];
  if (documentEdge === undefined) throw new Error(`no document edge is named ${edge}`);

  const onPage = edge === 'left' || edge === 'right' ? release.x : release.y;
  const message =
    `${what}: the release is at ${onPage.toFixed(2)} on the page and the document's ${edge} edge is at ` +
    `${documentEdge.toFixed(2)} there, so this drag does not leave the document on that edge and the test ` +
    `would be asserting growth it never performed. The app published scale ${fit.scale} at offsets ` +
    `(${fit.offsetX}, ${fit.offsetY}) for a ${fit.documentWidth}x${fit.documentHeight} document.`;

  if (edge === 'left' || edge === 'top') expect(onPage, message).toBeLessThan(documentEdge);
  else expect(onPage, message).toBeGreaterThan(documentEdge);
}

/**
 * That the harness can deliver the release at all, measured against the WINDOW.
 *
 * `useRect` takes pointer capture at the press (`src/hooks/usePointerPosition.ts:193`), and while
 * the capture is held the browser retargets the move and the release to the gesture surface
 * wherever the pointer is — so a page point outside the workspace CONTAINER is delivered, and
 * this file's three growing crops are built on that. A page point outside the WINDOW is a
 * different matter: it is not a point the harness can express, and a release that never arrives
 * leaves `toolArgs.rect` on the last move the tool did see, which commits a SMALLER frame and
 * reports here three steps later as a size the rectangle did not ask for. So the two numbers
 * that decide it are compared before the gesture, with both of them in the message.
 */
async function expectDeliverableRelease(page: Page, fit: Fit, release: PagePoint, what: string): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('the page has no viewport');
  const message =
    `${what}: the release lands on page (${release.x.toFixed(2)}, ${release.y.toFixed(2)}) and the window ` +
    `is the rectangle [0, 0] ${viewport.width}x${viewport.height}, so a point outside it is not a page point ` +
    `the harness can hand to page.mouse. The workspace container is [${fit.rectX}, ${fit.rectY}] ` +
    `${fit.rectWidth}x${fit.rectHeight}, so the gesture surface — an \`absolute inset-0\` over that container — ` +
    `is reachable from the capture rather than from the pointer, and only the window is the real bound.`;

  expect(release.x, message).toBeGreaterThanOrEqual(0);
  expect(release.x, message).toBeLessThanOrEqual(viewport.width);
  expect(release.y, message).toBeGreaterThanOrEqual(0);
  expect(release.y, message).toBeLessThanOrEqual(viewport.height);
}

/**
 * The half of the same precondition the LETTERBOX holds on its own, measured against the
 * container rather than the window.
 *
 * Only the vertical axis, and only because of the arithmetic of a contain fit: `scale` is
 * `min(outerWidth / imageWidth, outerHeight / imageHeight)`, so the document touches the
 * container on whichever axis is the limiting one and the offset is 0 there. At this window the
 * workspace is 1294x1063 — narrower than the opening document's 4:3 — so the fit is WIDTH
 * limited, `data-fit-offset-x` is 0, and a reach past the left or right edge cannot be inside the
 * container at any viewport this layout can produce. The vertical axis is the one with letterbox,
 * so the bottom and top reaches below are asserted inside the container rather than merely inside
 * the window, which is the stronger of the two claims and the one that keeps holding if the panels
 * or the window change.
 */
function expectVerticalReachInsideContainer(fit: Fit, release: PagePoint, what: string): void {
  const containerBottom = fit.rectY + fit.rectHeight;
  expect(
    release.y,
    `${what}: the release is at y=${release.y.toFixed(2)} and the workspace container's bottom edge is at ` +
      `y=${containerBottom} (${fit.rectY} + ${fit.rectHeight}). The fit published offsetY=${fit.offsetY} at ` +
      `scale ${fit.scale}, so the letterbox below the document holds ` +
      `${(fit.offsetY / fit.scale).toFixed(1)} document px of reach; a reach past that leaves the gesture ` +
      `surface's own box and depends on the pointer capture alone.`
  ).toBeLessThanOrEqual(containerBottom);
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

type CropParityFrame = Readonly<{ x: number; y: number; width: number; height: number }>;

type CropParityLayerFixture =
  | Readonly<{
      kind: 'raster';
      id: string;
      order: number;
      pos: Readonly<{ x: number; y: number; width: number; height: number }>;
      fills: readonly Readonly<{ x: number; y: number; width: number; height: number; color: string }>[];
    }>
  | Readonly<{
      kind: 'blank';
      id: string;
      order: number;
      pos: Readonly<{ x: number; y: number; width: number; height: number }>;
      color: string;
      opacity: number;
    }>
  | Readonly<{
      kind: 'text';
      id: string;
      order: number;
      pos: Readonly<{ x: number; y: number; width: number; height: number }>;
      textArgs: Readonly<{
        toolName: 'text';
        align: 'left' | 'center' | 'right';
        bold: boolean;
        color: string;
        fontFamily: string;
        fontSize: number;
        italic: boolean;
        lineHeight: number;
        text: string;
        rect: Readonly<{ x1: number; y1: number; x2: number; y2: number }>;
        kind: 'point' | 'paragraph';
      }>;
    }>
  | Readonly<{
      kind: 'vector';
      id: string;
      order: number;
      pos: Readonly<{ x: number; y: number; width: number; height: number }>;
      args: ShapeToolArgs;
    }>
  | Readonly<{
      kind: 'paint';
      id: string;
      order: number;
      pos: Readonly<{ x: number; y: number; width: number; height: number }>;
      args: DrawToolArgs;
    }>;

type CropParityTransition = Readonly<{
  angleDegrees: number;
  nextFrame: CropParityFrame;
}>;

type CropParityFixture = Readonly<{
  caseName: string;
  documentId: string;
  transitions: readonly CropParityTransition[];
  layers: readonly CropParityLayerFixture[];
}>;

async function compareCropRenderers(page: Page, caseFixture: CropParityFixture) {
  return page.evaluate(async (fixture) => {
    const load = (specifier: string) => import(/* @vite-ignore */ new URL(specifier, location.origin).href);
    const [
      { AssetRegistry },
      { composeDurableDocument },
      { isIdentityAffineTransform, rotationAffineAroundPoint },
      { legacyHistoryToDurable },
      { drawLayersToCanvas },
      { replayHistory },
      { replayDurableAtCursor },
      { OPEN_DOCUMENT_ACTION, SET_DOCUMENT_FRAME_ACTION },
      { findToolProcessor },
    ] = await Promise.all([
      load('/src/contexts/asset-registry.ts'),
      load('/src/contexts/durable-compositor.ts'),
      load('/src/contexts/affine-transform.ts'),
      load('/src/contexts/history-adapter.ts'),
      load('/src/contexts/layer-renderer.ts'),
      load('/src/contexts/history-replay.ts'),
      load('/src/contexts/durable-replay.ts'),
      load('/src/util/constants.ts'),
      load('/src/tools/toolProcessors.ts'),
    ]);

    const baseFrame = { x: 0, y: 0, width: 64, height: 64 };
    const layers = fixture.layers.map((layerFixture) => {
      const createSourceCanvas = () => {
        const canvas = document.createElement('canvas');
        canvas.width = layerFixture.pos.width;
        canvas.height = layerFixture.pos.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error(`A 2D context is required for ${layerFixture.id}`);
        return { canvas, context };
      };
      let runtimeSource:
        | Readonly<{ bitmap: HTMLCanvasElement | OffscreenCanvas; source: Readonly<Record<string, unknown>> }>
        | Readonly<{ bitmap: null; source: Readonly<Record<string, unknown>> }>;
      switch (layerFixture.kind) {
        case 'raster': {
          const { canvas: sourceCanvas, context: sourceContext } = createSourceCanvas();
          for (const fill of layerFixture.fills) {
            sourceContext.fillStyle = fill.color;
            sourceContext.fillRect(fill.x, fill.y, fill.width, fill.height);
          }
          runtimeSource = {
            bitmap: sourceCanvas,
            source: {
              kind: 'image',
              bitmap: sourceCanvas,
              name: `${layerFixture.id}.png`,
              isBedrock: false,
              pos: layerFixture.pos,
            },
          };
          break;
        }
        case 'blank': {
          const { canvas: sourceCanvas, context: sourceContext } = createSourceCanvas();
          sourceContext.globalAlpha = layerFixture.opacity;
          sourceContext.fillStyle = layerFixture.color;
          sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
          runtimeSource = {
            bitmap: sourceCanvas,
            source: {
              kind: 'blank',
              color: layerFixture.color,
              opacity: layerFixture.opacity,
              isBedrock: false,
              pos: layerFixture.pos,
            },
          };
          break;
        }
        case 'text':
          runtimeSource = {
            bitmap: null,
            source: { kind: 'tool', args: layerFixture.textArgs, isBedrock: false, pos: layerFixture.pos },
          };
          break;
        case 'vector':
          runtimeSource = {
            bitmap: null,
            source: { kind: 'tool', args: layerFixture.args, isBedrock: false, pos: layerFixture.pos },
          };
          break;
        case 'paint': {
          const processor = findToolProcessor(layerFixture.args.toolName);
          if (!processor?.creator) throw new Error(`Paint source ${layerFixture.id} is not a deterministic creator`);
          const [bitmap] = processor.imageProcessor({ size: layerFixture.pos })(layerFixture.args);
          if (!bitmap) throw new Error(`Paint source ${layerFixture.id} produced no raster`);
          runtimeSource = {
            bitmap,
            source: { kind: 'tool', args: layerFixture.args, isBedrock: false, pos: layerFixture.pos },
          };
          break;
        }
      }
      return {
        id: layerFixture.id,
        name: layerFixture.id,
        isBedrock: false,
        tmpCanvas: null,
        bitmap: runtimeSource.bitmap,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over',
        order: layerFixture.order,
        pos: layerFixture.pos,
        presentationBounds: null,
        source: runtimeSource.source,
        operations: [],
      };
    });
    if (fixture.transitions.length === 0) throw new Error(`No frame transitions were supplied for ${fixture.caseName}`);
    const transitions = fixture.transitions.map((transition, index) => {
      const frameCenter = {
        x: transition.nextFrame.x + transition.nextFrame.width / 2,
        y: transition.nextFrame.y + transition.nextFrame.height / 2,
      };
      const candidate = rotationAffineAroundPoint((-transition.angleDegrees * Math.PI) / 180, frameCenter);
      const transform = isIdentityAffineTransform(candidate) ? undefined : candidate;
      return {
        id: `frame-transition-${index + 1}`,
        previousFrame: index === 0 ? baseFrame : fixture.transitions[index - 1]!.nextFrame,
        nextFrame: transition.nextFrame,
        angleDegrees: transition.angleDegrees,
        transform,
      };
    });

    const registry = new AssetRegistry();
    try {
      const history = [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: layers[0]?.id,
          documentSource: {
            layers: Object.fromEntries(layers.map((layer) => [layer.id, layer])),
            size: { width: 64, height: 64 },
            frame: baseFrame,
          },
        },
        ...transitions.map(({ id, previousFrame, nextFrame, transform }) => ({
          id,
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame, nextFrame, ...(transform ? { transform } : {}) },
        })),
      ];
      const converted = legacyHistoryToDurable(history, {
        documentId: fixture.documentId,
        registry,
        initialSize: { width: 64, height: 64 },
        initialFrame: baseFrame,
      });
      if (converted.diagnostics.length > 0) {
        throw new Error(`Durable crop conversion failed: ${JSON.stringify(converted.diagnostics)}`);
      }
      const transitionResults = [];
      let finalLegacyPixels: number[] = [];
      let finalDurablePixels: number[] = [];
      let finalMaterializedBounds: Record<string, unknown> = {};
      for (const [index, transition] of transitions.entries()) {
        const legacyReplay = replayHistory(
          history,
          index + 1,
          { width: 64, height: 64 },
          {
            createLayer: () => {
              throw new Error('Unexpected layer creation in a frame-only crop differential');
            },
            applyRasterTool: (layer: unknown) => layer,
          },
          baseFrame
        );
        if (legacyReplay.diagnostics.length > 0) {
          throw new Error(`Legacy crop replay failed: ${JSON.stringify(legacyReplay.diagnostics)}`);
        }
        const frame = legacyReplay.documentFrame;
        if (
          frame.x !== transition.nextFrame.x ||
          frame.y !== transition.nextFrame.y ||
          frame.width !== transition.nextFrame.width ||
          frame.height !== transition.nextFrame.height
        ) {
          throw new Error(`Legacy frame transition ${index + 1} did not reach its requested frame`);
        }
        const legacySurface = document.createElement('canvas');
        const legacyLayers = (Object.values(legacyReplay.layers) as Layer[]).sort(
          (left, right) => left.order - right.order
        );
        if (!drawLayersToCanvas(legacySurface, legacyLayers, frame)) {
          throw new Error(`Legacy composition was refused for ${fixture.caseName} at transition ${index + 1}`);
        }
        const legacyContext = legacySurface.getContext('2d');
        if (!legacyContext) throw new Error('Legacy crop composition produced no 2D context');
        const legacyPixels = Array.from(legacyContext.getImageData(0, 0, frame.width, frame.height).data);

        const cursor = converted.legacyCursorToDurableCursor[index + 1];
        if (typeof cursor !== 'number')
          throw new Error(`Frame transition ${index + 1} did not map to a durable cursor`);
        const replay = replayDurableAtCursor(converted.document, cursor);
        const composite = await composeDurableDocument(replay, {
          documentId: fixture.documentId,
          baselineAssetGeneration: registry.getDocumentGeneration(fixture.documentId),
          operationSetRevision: converted.document.durableRevision,
          assetRegistry: registry,
        });
        try {
          const durableSurface = document.createElement('canvas');
          durableSurface.width = frame.width;
          durableSurface.height = frame.height;
          const durableContext = durableSurface.getContext('2d');
          if (!durableContext) throw new Error('Durable crop composition produced no 2D context');
          durableContext.drawImage(composite.bitmap as CanvasImageSource, 0, 0);
          const durablePixels = Array.from(durableContext.getImageData(0, 0, frame.width, frame.height).data);
          let differingBytes = 0;
          for (let byte = 0; byte < Math.max(legacyPixels.length, durablePixels.length); byte += 1) {
            if (legacyPixels[byte] !== durablePixels[byte]) differingBytes += 1;
          }
          const materializedBounds = Object.fromEntries(
            fixture.layers.map(({ id }) => {
              const layer = composite.layers[id];
              if (!layer) throw new Error(`Durable crop did not materialize ${id} at transition ${index + 1}`);
              return [id, layer.bounds];
            })
          );
          transitionResults.push({
            index: index + 1,
            angleDegrees: transition.angleDegrees,
            frame,
            durableFrame: composite.frame,
            legacyByteLength: legacyPixels.length,
            durableByteLength: durablePixels.length,
            differingBytes,
            materializedBounds,
          });
          if (index === transitions.length - 1) {
            finalLegacyPixels = legacyPixels;
            finalDurablePixels = durablePixels;
            finalMaterializedBounds = materializedBounds;
          }
        } finally {
          composite.release();
        }
      }

      const hasOpaqueRgb = (pixels: number[], rgb: readonly [number, number, number]): boolean => {
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index] === rgb[0] &&
            pixels[index + 1] === rgb[1] &&
            pixels[index + 2] === rgb[2] &&
            (pixels[index + 3] ?? 0) > 0
          ) {
            return true;
          }
        }
        return false;
      };
      const colors = [
        ...new Set(
          fixture.layers.flatMap((layer) => {
            switch (layer.kind) {
              case 'raster':
                return layer.fills.map((fill) => fill.color);
              case 'blank':
                return [layer.color];
              case 'text':
                return [layer.textArgs.color];
              case 'vector':
              case 'paint':
                return [layer.args.color];
            }
          })
        ),
      ];
      const colorPresence = Object.fromEntries(
        colors.map((color) => {
          const normalized = color.replace('#', '');
          const rgb: readonly [number, number, number] = [
            Number.parseInt(normalized.slice(0, 2), 16),
            Number.parseInt(normalized.slice(2, 4), 16),
            Number.parseInt(normalized.slice(4, 6), 16),
          ];
          return [
            color,
            {
              legacy: hasOpaqueRgb(finalLegacyPixels, rgb),
              durable: hasOpaqueRgb(finalDurablePixels, rgb),
            },
          ];
        })
      );
      const finalTransition = transitionResults.at(-1);
      if (!finalTransition) throw new Error(`No frame transition was composed for ${fixture.caseName}`);
      return {
        caseName: fixture.caseName,
        legacyPixels: finalLegacyPixels,
        durablePixels: finalDurablePixels,
        differingBytes: finalTransition.differingBytes,
        colorPresence,
        materializedBounds: finalMaterializedBounds,
        transitionResults,
      };
    } finally {
      registry.shutdown();
    }
  }, caseFixture);
}

test.describe('Crop history', () => {
  // Tall enough to hold the whole canvas box, so no band read is clipped by the fold. The
  // intersection in `readableBox` already makes a truncation unrepresentable; the window removes
  // the reason to want it in the first place, which is the same reasoning `transform.spec.ts`
  // gives for its own viewport, for a different reason.
  test.use({ viewport: { width: 1600, height: 1200 } });

  test('the crop overlay selector exposes six guides and O cycles the active guide', async ({ page }) => {
    await openDocument(page);
    await openCropTool(page);

    const overlaySelect = page.locator('#crop-overlay');
    await expect(overlaySelect, 'the crop overlay selector is visible').toBeVisible();
    expect(await overlaySelect.locator('option').allTextContents()).toEqual([
      'Rule of Thirds',
      'Grid',
      'Diagonal',
      'Triangle',
      'Golden Ratio',
      'Golden Spiral',
    ]);
    await expect(overlaySelect, 'Rule of Thirds is the default guide').toHaveValue('ruleOfThirds');

    await page.keyboard.press('o');
    await expect(overlaySelect, 'O advances to Grid').toHaveValue('grid');

    await overlaySelect.selectOption('goldenSpiral');
    await overlaySelect.evaluate((element) => (element as HTMLSelectElement).blur());
    await page.keyboard.press('o');
    await expect(overlaySelect, 'O wraps after Golden Spiral').toHaveValue('ruleOfThirds');
  });

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
    // committed, rather than as a band that disagrees about where the ink is. `sortRoundRect`
    // rounds each edge once and `documentFrameSize` ceils the extent, this rectangle is integral,
    // and the commit normalises the rect with NO clamp, so the committed frame is the rectangle's
    // own size with nothing left over for the arithmetic to be wrong about.
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
    await expect.poll(() => documentSize(page), 'one undo must put the whole frame back').toEqual(opening);
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
    const afterBarBand = await drawBar(page, croppedFit, keptAfterCrop);
    const afterBar = await documentSize(page);
    expect(afterBar, 'a stroke on a cropped document must not move the frame again').toEqual({
      width: COMMITTED_WIDTH,
      height: COMMITTED_HEIGHT,
    });
    await waitForInk(page, croppedFit, inkIn(afterBarBand));

    // One undo removes the visible post-crop stroke without changing the frame.
    await page.getByTestId('undo-button').click();
    const afterUndo = await documentSize(page);
    expect(afterUndo, 'the crop must survive an undo of the bar drawn after it').toEqual({
      width: COMMITTED_WIDTH,
      height: COMMITTED_HEIGHT,
    });
    await waitForInk(page, croppedFit, inkIn());
    await expect(
      page.getByTestId('undo-button'),
      'the crop entry is still below this undo, so the frame commit was not the one taken'
    ).toBeEnabled();

    // AND ONE MORE UNDO PUTS THE DISCARDED BAR BACK, which is the half that makes the assertion
    // above about ORDER rather than about a stuck cursor. A crop that had destroyed the pixels
    // would leave the canvas clean here too, and no assertion above would have noticed.
    await page.getByTestId('undo-button').click();
    await expect.poll(() => documentSize(page), 'undoing the crop restores the opening frame').toEqual(opening);
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

  /**
   * The three crops below GROW the document, and they are in their own describe because the
   * geometry that makes a growth reachable is a property of the WINDOW rather than of the tool.
   *
   * A crop release has to leave the document to grow it, and the only place on screen that lies
   * outside the document is the contain fit's letterbox — the band between the document and the
   * edge of the element that holds it. `scale` is `min(outerWidth / imageWidth, outerHeight /
   * imageHeight)`, so that band is non-empty on the axis that is NOT limiting and exactly zero on
   * the one that is: the document always touches the container on one pair of edges. At 1600x1200
   * the workspace is 1294x1063, which is narrower than the opening document's 4:3, so the fit is
   * width limited, `data-fit-offset-x` is 0, and the only letterbox is above and below — 46.25 CSS
   * px, which is 28.6 DOCUMENT px. That is enough to reach past an edge but not enough to reach
   * far, and it is a measurement rather than a constant: the panel widths and the options bar
   * decide it, and the options bar changes with the tool.
   *
   * So this window is taller, and every fit is re-read immediately before the gesture that uses
   * it (`openCropTool` reads one per crop, which is also what `e2e/OPEN_PROBLEMS.md`'s P2 entry
   * about a cached canvas box requires). At 1600x1400 the workspace is 1294x1263 and the
   * letterbox is 146.25 CSS px — 90.4 document px, measured with the crop tool's own options bar
   * up — which is what the bottom and top reaches below are asserted against.
   *
   * The HORIZONTAL reach is the half no window in this layout can letterbox, and it is reached
   * through the pointer capture instead: `useRect` captures at the press, so the release is
   * delivered to the gesture surface from outside the container. `expectDeliverableRelease`
   * asserts what that does depend on — that the point is inside the window — before the drag,
   * so a layout change that pushed it off the window fails as a precondition naming both numbers
   * rather than as a committed size the rectangle never asked for.
   */
  test.describe('with letterbox to release into', () => {
    test.use({ viewport: { width: 1600, height: 1400 } });

    test('re-cropping after layer edits previews and recovers retained pixels without scaling', async ({ page }) => {
      await openDocument(page);
      const openingFit = await readFit(page);
      const recoverableBarY = CROP_TOP_Y - 20;
      await drawBar(page, openingFit, recoverableBarY);
      await waitForInk(page, openingFit, inkIn(bandOfDocumentY(openingFit, recoverableBarY)));
      const sourcePixels = await readCanvasRegion(page, 'workspace-canvas', 350, recoverableBarY - 6, 100, 12);
      await commitCrop(page);
      expect(await documentSize(page)).toEqual({ width: COMMITTED_WIDTH, height: COMMITTED_HEIGHT });

      // A pixel edit after cropping, followed by visibility history, must not discard retained
      // source pixels outside the frame or break the next crop's layer-stack preview.
      const croppedFit = await readFit(page);
      const editedBand = await drawBar(page, croppedFit, 100);
      await waitForInk(page, croppedFit, inkIn(editedBand));
      await page.getByTestId('panel-header-layers').click();
      const layer = page.getByTestId('layer-row').first();
      await layer.getByRole('button', { name: 'Hide layer' }).click();
      await layer.getByRole('button', { name: 'Show layer' }).click();

      // Crop stays active after Apply; leave it and re-enter to exercise Photoshop's crop-box
      // recovery rather than merely reusing the first pending gesture.
      await clickToolButton(page, 'move');
      const recropFit = await openCropTool(page);
      const topEdge = documentPoint(recropFit, recropFit.documentWidth / 2, 0);
      const expandedTop = documentPoint(recropFit, recropFit.documentWidth / 2, -30);
      await page.mouse.move(topEdge.x, topEdge.y);
      await page.mouse.down();
      await page.mouse.move(expandedTop.x, expandedTop.y, { steps: 10 });

      const preview = page.getByTestId('crop-retained-pixels-preview');
      await expect(preview, 'the crop preview renders previously hidden layer pixels before release').toBeVisible();
      const previewPixels = await readCanvasRegion(page, 'crop-retained-pixels-preview', 270, 4, 100, 12);
      expect(previewPixels, 'the recovered pixels remain identical before applying the expanded frame').toEqual(
        sourcePixels
      );
      await page.mouse.up();

      await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: COMMITTED_WIDTH, height: COMMITTED_HEIGHT + 30 });
      const recoveredPixels = await readCanvasRegion(page, 'workspace-canvas', 270, 4, 100, 12);
      expect(recoveredPixels, 'the committed crop restores the original raster region without resampling').toEqual(
        sourcePixels
      );
    });

    test('a rotated recrop commits retained pixels outside the prior frame', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1800, height: 1400 });
      await openDocument(page);
      await openRasterFixture(page, testInfo.config.rootDir);
      await expect.poll(() => documentSize(page)).toEqual({ width: 64, height: 64 });
      await expect.poll(() => readCanvasColor(page, 3, 20)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });

      const openingFit = await openCropTool(page);
      await dragOnCanvas(page, openingFit, { x: 4, y: 4 }, { x: 60, y: 60 });
      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: 56, height: 56 });

      await clickToolButton(page, 'move');
      const croppedFit = await openCropTool(page);
      await dragOnCanvas(page, croppedFit, { x: 0, y: 0 }, { x: -3, y: 0 });
      const preview = page.getByTestId('crop-retained-pixels-preview');
      await expect(preview).toBeVisible();
      await expect
        .poll(() => readCanvasRegion(page, 'crop-retained-pixels-preview', 2, 16, 1, 1))
        .toEqual([255, 0, 0, 255]);

      const surface = page.locator('.cursor-crop');
      const rotationHandle = documentPoint(croppedFit, -3.2, 0.2);
      const rotatedCorner = documentPoint(croppedFit, 54.3, -1.7);
      await page.mouse.move(rotationHandle.x, rotationHandle.y);
      await expect(surface, 'the expanded corner still exposes the rotation handle').toHaveCSS(
        'cursor',
        /url.*ew-resize/
      );
      await page.mouse.down();
      await page.mouse.move(rotatedCorner.x, rotatedCorner.y, { steps: 12 });
      await page.mouse.up();
      await expect(surface, 'the recrop can be rotated after expanding its bounds').toHaveAttribute(
        'data-rotation',
        /8[5-9]|9[0-5]/
      );
      await expect(page.getByTestId('crop-retained-pixels-preview')).toHaveCount(0);

      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: 59, height: 56 });
      await expect.poll(() => readCanvasColor(page, 18, 55)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });
    });

    test('a crop released past the right and bottom edges commits a LARGER frame, not a clamped one', async ({
      page,
    }) => {
      await openDocument(page);
      const opening = await documentSize(page);

      const fit = await openCropTool(page);
      expect(
        { width: fit.documentWidth, height: fit.documentHeight },
        'the app fitted the opening document, so every coordinate below is an opening-document one'
      ).toEqual(opening);

      // The preconditions, before the gesture. Each names the two numbers it compares, because the
      // alternative is a size assertion three steps later reporting a drag that never happened.
      const release = documentPoint(fit, GROW_TO.x, GROW_TO.y);
      expectReleasePastDocumentEdge(fit, release, 'right', 'the growth release');
      expectReleasePastDocumentEdge(fit, release, 'bottom', 'the growth release');
      expectVerticalReachInsideContainer(fit, release, 'the growth release');
      await expectDeliverableRelease(page, fit, release, 'the growth release');

      await dragOnCanvas(page, fit, GROW_FROM, GROW_TO);
      await applyCrop(page);

      // SURFACE ONE: the committed canvas ELEMENT's own backing store, the same read the three
      // tests above use. The width is `GROW_TO.x - GROW_FROM.x` and the height is
      // `GROW_TO.y - GROW_FROM.y`, so 920 - 20 = 900 and 660 - 20 = 640 — the rectangle as
      // dragged, with no clamp in it, which is the whole difference from the three tests above:
      // `trimRect` would have stopped both far edges at the document's own 800 and 600.
      const grown = await documentSize(page);
      expect(grown, 'the crop commits the dragged rectangle unclamped: 920 - 20 wide, 660 - 20 tall').toEqual({
        width: GROW_WIDTH,
        height: GROW_HEIGHT,
      });
      // The same fact in the units the requirement is phrased in, so the assertion above cannot be
      // satisfied by a frame that merely MOVED: a clamped crop would report 800 - 20 and
      // 600 - 20, which is smaller on both axes and fails here first.
      expect(
        { wider: grown.width - opening.width, taller: grown.height - opening.height },
        'the committed frame is LARGER than the opening one by exactly what the rectangle asked for'
      ).toEqual({ wider: 100, taller: 40 });

      // SURFACE TWO: `data-fit-document-width`/`height`, the size the app's own POINTER MAPPING is
      // fitting, read through `usePointerPosition`'s publish rather than off the canvas. It is a
      // separate read because the first one does not name what resized: `e2e/OPEN_PROBLEMS.md`
      // (P2, `e2e/document-dialogs.spec.ts`) records that `useApp` resizes that same canvas
      // element at two sites and `layer-renderer.ts` at a third, so a backing-store read alone
      // proves the READ and not which resize site ran. This one starts from `totalSize` on the far
      // side of the commit, through a hook that resizes nothing.
      const container = page.getByTestId('workspace-container');
      await expect(
        container,
        'the pointer mapping must be fitting the GROWN document, not the one the drag started from'
      ).toHaveAttribute('data-fit-document-width', String(GROW_WIDTH));
      await expect(container, 'and on its height, which is the axis the bottom reach moved').toHaveAttribute(
        'data-fit-document-height',
        String(GROW_HEIGHT)
      );
    });

    test('a crop released past the left and top edges commits a frame with a NEGATIVE origin', async ({ page }) => {
      await openDocument(page);
      const opening = await documentSize(page);

      const fit = await openCropTool(page);
      expect(
        { width: fit.documentWidth, height: fit.documentHeight },
        'the app fitted the opening document, so every coordinate below is an opening-document one'
      ).toEqual(opening);

      const release = documentPoint(fit, ORIGIN_TO.x, ORIGIN_TO.y);
      expectReleasePastDocumentEdge(fit, release, 'left', 'the negative-origin release');
      expectReleasePastDocumentEdge(fit, release, 'top', 'the negative-origin release');
      expectVerticalReachInsideContainer(fit, release, 'the negative-origin release');
      await expectDeliverableRelease(page, fit, release, 'the negative-origin release');

      // Dragged UP AND LEFT from inside, so the rectangle arrives inverted and `sortRect` is what
      // makes it a rectangle at all: the committed edges are ORIGIN_TO's, and the extent runs back
      // to ORIGIN_FROM's.
      await dragOnCanvas(page, fit, ORIGIN_FROM, ORIGIN_TO);
      await applyCrop(page);

      // 700 - (-24) = 724 and 400 - (-40) = 440. The size is also the proof of the ORIGIN, which
      // the canvas cannot report: a frame at x = 0 spanning the same far edges would have
      // committed 700, and one at y = 0 would have committed 400, so neither of the two readings a
      // non-negative origin can produce equals the number asserted here.
      const committed = await documentSize(page);
      expect(
        committed,
        'the crop commits 700 - (-24) wide and 400 - (-40) tall, so the origin is negative on both axes'
      ).toEqual({ width: ORIGIN_WIDTH, height: ORIGIN_HEIGHT });

      // The second surface, as above: the document the app is fitting, which is a different read
      // from the canvas element's backing store and is what says the STORE took the frame rather
      // than only the canvas being repainted at a new size.
      const container = page.getByTestId('workspace-container');
      await expect(
        container,
        'the pointer mapping must be fitting the NEGATIVE-ORIGIN document, not the opening one'
      ).toHaveAttribute('data-fit-document-width', String(ORIGIN_WIDTH));
      await expect(container, 'and on its height, which is the axis the top reach moved').toHaveAttribute(
        'data-fit-document-height',
        String(ORIGIN_HEIGHT)
      );
    });

    test('an extending crop is ONE history entry, and one undo puts the opening frame back', async ({ page }) => {
      await openDocument(page);
      const opening = await documentSize(page);
      expect(opening, 'a fresh document is the store default').toEqual({
        width: DEFAULT_DOCUMENT_WIDTH,
        height: DEFAULT_DOCUMENT_HEIGHT,
      });

      const fit = await openCropTool(page);
      const release = documentPoint(fit, GROW_TO.x, GROW_TO.y);
      expectReleasePastDocumentEdge(fit, release, 'right', 'the undo growth release');
      expectReleasePastDocumentEdge(fit, release, 'bottom', 'the undo growth release');
      expectVerticalReachInsideContainer(fit, release, 'the undo growth release');
      await expectDeliverableRelease(page, fit, release, 'the undo growth release');

      await dragOnCanvas(page, fit, GROW_FROM, GROW_TO);
      await applyCrop(page);
      expect(
        await documentSize(page),
        'the extending crop committed the grown frame, so the undo below has something to take back'
      ).toEqual({ width: GROW_WIDTH, height: GROW_HEIGHT });

      // ONE UNDO, and the SIZE is the assertion — to the opening frame exactly, not to something
      // that merely shrank. A growth written as a frame commit plus a fill would be two entries,
      // and one undo would leave the larger frame behind and fail on this line.
      await page.getByTestId('undo-button').click();
      await expect
        .poll(
          () => documentSize(page),
          'one undo must put the whole opening frame back, band included, not merely shrink it'
        )
        .toEqual(opening);
      const container = page.getByTestId('workspace-container');
      await expect(container, 'and the app is fitting the opening document again, on the width').toHaveAttribute(
        'data-fit-document-width',
        String(opening.width)
      );
      await expect(container, 'and on the height').toHaveAttribute('data-fit-document-height', String(opening.height));

      // AND THE GROWTH WAS ONE ENTRY, which on THIS document the disabled state is the proof of —
      // and which is the form the first test in this file cannot use for the reason its own
      // comment gives: that document also carries a stroke below its crop, so one undo lands on
      // the stroke and leaves undo enabled. Nothing is below this crop but the document's own
      // opening entry, so one undo reaches the start of the timeline, which is the state
      // `Escape abandons a pending crop` above pins on a fresh document: the entry is on the
      // timeline, and there is nothing before it to undo.
      await expect(
        page.getByTestId('undo-button'),
        'the timeline is the opening entry and this one crop, so one undo reaching the start is the ' +
          'growth being a single entry rather than a frame commit plus a fill'
      ).toBeDisabled();
    });

    test('the crop corner exposes a rotation cursor and dragging it rotates the pending box', async ({ page }) => {
      await openDocument(page);
      const fit = await openCropTool(page);
      await dragOnCanvas(page, fit, { x: CROP_LEFT_X, y: CROP_TOP_Y }, { x: CROP_RIGHT_X, y: CROP_BOTTOM_Y });

      const surface = page.locator('.cursor-crop');
      const corner = documentPoint(fit, CROP_LEFT_X - 10, CROP_TOP_Y - 10);
      await page.mouse.move(corner.x, corner.y);
      await expect(surface, 'the rotation hotspot uses the rotate cursor').toHaveCSS('cursor', /url.*ew-resize/);

      await page.mouse.down();
      const rotatedCorner = documentPoint(fit, CROP_RIGHT_X - 160, CROP_TOP_Y - 180);
      await page.mouse.move(rotatedCorner.x, rotatedCorner.y, { steps: 12 });
      await page.mouse.up();

      await expect(surface, 'the pending crop keeps the rotated angle').toHaveAttribute(
        'data-rotation',
        /8[5-9]|9[0-5]/
      );
    });

    test('a rotated crop transforms pixels in one history step and redo reproduces them exactly', async ({
      page,
    }, testInfo) => {
      await openDocument(page);
      await openRasterFixture(page, testInfo.config.rootDir);
      await expect.poll(() => documentSize(page)).toEqual({ width: 64, height: 64 });
      await expect.poll(() => readCanvasColor(page, 16, 32)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });
      await expect.poll(() => readCanvasColor(page, 48, 32)).toEqual({ red: 0, green: 0, blue: 255, alpha: 255 });
      const originalPixels = await getWorkspaceCanvas(page).screenshot();

      const cropFit = await openCropTool(page);
      await dragOnCanvas(page, cropFit, { x: 16, y: 16 }, { x: 48, y: 48 });
      const surface = page.locator('.cursor-crop');
      const rotationHandle = documentPoint(cropFit, 15.5, 15.5);
      await page.mouse.move(rotationHandle.x, rotationHandle.y);
      await page.mouse.down();
      const rotatedCorner = documentPoint(cropFit, 48.5, 15.5);
      await page.mouse.move(rotatedCorner.x, rotatedCorner.y, { steps: 12 });
      await page.mouse.up();
      await expect(surface, 'the pending crop has a nonzero rotation').toHaveAttribute(
        'data-rotation',
        /8[5-9]|9[0-5]/
      );

      await applyCrop(page);
      await expect
        .poll(() => documentSize(page), 'rotated crop commits the requested frame')
        .toEqual({
          width: 32,
          height: 32,
        });
      await expect(page.getByTestId('dev-status-strip')).toHaveAttribute('data-presentation-status', 'unpublished');
      await expect.poll(() => readCanvasColor(page, 16, 8)).toEqual({ red: 0, green: 0, blue: 255, alpha: 255 });
      await expect.poll(() => readCanvasColor(page, 16, 24)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });
      const committedPixels = await getWorkspaceCanvas(page).screenshot();

      await page.getByTestId('undo-button').click();
      await expect
        .poll(() => documentSize(page), 'one undo restores the frame and pixels before crop')
        .toEqual({
          width: 64,
          height: 64,
        });
      await expect(page.getByTestId('dev-status-strip')).toHaveAttribute('data-presentation-status', 'durable');
      await expect.poll(() => readCanvasColor(page, 16, 32)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });
      await expect.poll(() => readCanvasColor(page, 48, 32)).toEqual({ red: 0, green: 0, blue: 255, alpha: 255 });
      expect((await getWorkspaceCanvas(page).screenshot()).equals(originalPixels)).toBe(true);

      await page.getByTestId('redo-button').click();
      await expect
        .poll(() => documentSize(page), 'one redo reapplies the complete rotated crop')
        .toEqual({
          width: 32,
          height: 32,
        });
      await expect(page.getByTestId('dev-status-strip')).toHaveAttribute('data-presentation-status', 'legacy-fallback');
      await expect.poll(() => readCanvasColor(page, 16, 8)).toEqual({ red: 0, green: 0, blue: 255, alpha: 255 });
      await expect.poll(() => readCanvasColor(page, 16, 24)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });
      const redonePixels = await getWorkspaceCanvas(page).screenshot();
      expect(redonePixels.equals(committedPixels), 'redo must reproduce the rotated-crop pixels exactly').toBe(true);
    });

    test('durable materialization matches legacy pixels for a quarter-turn crop without an extra edge pixel', async ({
      page,
    }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: 'quarter-turn crop',
        documentId: 'quarter-turn-crop-pixel-parity',
        transitions: [{ angleDegrees: 90, nextFrame: { x: 16, y: 16, width: 32, height: 32 } }],
        layers: [
          {
            kind: 'raster',
            id: 'quarter-turn-crop-layer',
            order: 0,
            pos: { x: 0, y: 0, width: 64, height: 64 },
            fills: [
              { x: 0, y: 0, width: 32, height: 64, color: '#ff0000' },
              { x: 32, y: 0, width: 32, height: 64, color: '#0000ff' },
            ],
          },
        ],
      });

      expect(result.colorPresence['#ff0000']?.legacy, 'legacy crop must contain fixture red pixels').toBe(true);
      expect(result.colorPresence['#0000ff']?.legacy, 'legacy crop must contain fixture blue pixels').toBe(true);
      expect(result.colorPresence['#ff0000']?.durable, 'durable crop must contain fixture red pixels').toBe(true);
      expect(result.colorPresence['#0000ff']?.durable, 'durable crop must contain fixture blue pixels').toBe(true);
      expect(result.differingBytes, 'durable and legacy crop rasters must be byte-identical').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(result.materializedBounds['quarter-turn-crop-layer']).toEqual({ x: 0, y: 0, width: 64, height: 64 });
      expect(result.transitionResults).toHaveLength(1);
    });

    test('a 37-degree crop matches legacy pixels for multiple positioned layers', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: '37-degree two-layer crop',
        documentId: 'arbitrary-multilayer-crop-parity',
        transitions: [{ angleDegrees: 37, nextFrame: { x: 12, y: 10, width: 40, height: 44 } }],
        layers: [
          {
            kind: 'raster',
            id: 'background',
            order: 0,
            pos: { x: 0, y: 0, width: 64, height: 64 },
            fills: [
              { x: 0, y: 0, width: 32, height: 64, color: '#ff0000' },
              { x: 32, y: 0, width: 32, height: 64, color: '#0000ff' },
            ],
          },
          {
            kind: 'raster',
            id: 'center-patch',
            order: 1,
            pos: { x: 24, y: 24, width: 16, height: 16 },
            fills: [
              { x: 0, y: 0, width: 8, height: 16, color: '#ffff00' },
              { x: 8, y: 0, width: 8, height: 16, color: '#00ff00' },
            ],
          },
        ],
      });

      for (const [color, presence] of Object.entries(result.colorPresence)) {
        expect(presence.legacy, `legacy crop should contain ${color}`).toBe(true);
        expect(presence.durable, `durable crop should contain ${color}`).toBe(true);
      }
      expect(result.differingBytes, '37-degree multi-layer rasters must match byte-for-byte').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(Object.keys(result.materializedBounds).sort()).toEqual(['background', 'center-patch']);
      expect(result.transitionResults).toHaveLength(1);
    });

    test('a 37-degree crop preserves a committed text source across renderers', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: '37-degree text-source crop',
        documentId: 'text-source-crop-pixel-parity',
        transitions: [{ angleDegrees: 37, nextFrame: { x: 8, y: 8, width: 48, height: 48 } }],
        layers: [
          {
            kind: 'text',
            id: 'text-layer',
            order: 0,
            pos: { x: 24, y: 24, width: 16, height: 16 },
            textArgs: {
              toolName: 'text',
              align: 'left',
              bold: false,
              color: '#ff00ff',
              fontFamily: 'Arial',
              fontSize: 12,
              italic: false,
              lineHeight: 1.2,
              text: 'I',
              rect: { x1: 0, y1: 0, x2: 16, y2: 16 },
              kind: 'point',
            },
          },
        ],
      });

      expect(result.colorPresence['#ff00ff']?.legacy, 'legacy crop must contain text-source pixels').toBe(true);
      expect(result.colorPresence['#ff00ff']?.durable, 'durable crop must contain text-source pixels').toBe(true);
      expect(result.differingBytes, 'text-source crop rasters must match byte-for-byte').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(Object.keys(result.materializedBounds)).toEqual(['text-layer']);
      expect(result.transitionResults).toHaveLength(1);
    });

    test('paragraph text with a serif font and centered alignment matches legacy pixels', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: 'paragraph serif text crop',
        documentId: 'paragraph-serif-crop-pixel-parity',
        transitions: [{ angleDegrees: 37, nextFrame: { x: 8, y: 8, width: 48, height: 48 } }],
        layers: [
          {
            kind: 'text',
            id: 'paragraph-serif',
            order: 0,
            pos: { x: 8, y: 16, width: 42, height: 24 },
            textArgs: {
              toolName: 'text',
              align: 'center',
              bold: false,
              color: '#00ccff',
              fontFamily: 'serif',
              fontSize: 11,
              italic: false,
              lineHeight: 1.2,
              text: 'Crop\nparity',
              rect: { x1: 0, y1: 0, x2: 42, y2: 24 },
              kind: 'paragraph',
            },
          },
        ],
      });

      expect(result.colorPresence['#00ccff']?.legacy, 'legacy crop must contain paragraph text pixels').toBe(true);
      expect(result.colorPresence['#00ccff']?.durable, 'durable crop must contain paragraph text pixels').toBe(true);
      expect(result.differingBytes, 'paragraph text crop rasters must match byte-for-byte').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(result.materializedBounds['paragraph-serif']).toBeDefined();
    });

    test('a non-centered right-aligned monospace text layer matches legacy pixels', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: 'non-centered monospace text crop',
        documentId: 'non-centered-monospace-crop-pixel-parity',
        transitions: [{ angleDegrees: -23, nextFrame: { x: 8, y: 8, width: 48, height: 48 } }],
        layers: [
          {
            kind: 'text',
            id: 'offset-monospace',
            order: 0,
            pos: { x: 5, y: 36, width: 46, height: 18 },
            textArgs: {
              toolName: 'text',
              align: 'right',
              bold: false,
              color: '#ff8800',
              fontFamily: 'monospace',
              fontSize: 10,
              italic: false,
              lineHeight: 1.2,
              text: 'RIGHT',
              rect: { x1: 0, y1: 0, x2: 46, y2: 18 },
              kind: 'point',
            },
          },
        ],
      });

      expect(result.colorPresence['#ff8800']?.legacy, 'legacy crop must contain offset text pixels').toBe(true);
      expect(result.colorPresence['#ff8800']?.durable, 'durable crop must contain offset text pixels').toBe(true);
      expect(result.differingBytes, 'offset text crop rasters must match byte-for-byte').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(result.materializedBounds['offset-monospace']).toBeDefined();
    });

    test('a blank source matches legacy pixels through a rotated crop', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: 'blank-source crop',
        documentId: 'blank-source-crop-pixel-parity',
        transitions: [{ angleDegrees: 37, nextFrame: { x: 8, y: 8, width: 48, height: 48 } }],
        layers: [
          {
            kind: 'blank',
            id: 'blank-source',
            order: 0,
            pos: { x: 20, y: 12, width: 18, height: 20 },
            color: '#00ff00',
            opacity: 1,
          },
        ],
      });

      expect(result.colorPresence['#00ff00']?.legacy, 'legacy crop must contain blank-source pixels').toBe(true);
      expect(result.colorPresence['#00ff00']?.durable, 'durable crop must contain blank-source pixels').toBe(true);
      expect(result.differingBytes, 'blank-source crop rasters must match byte-for-byte').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
    });

    test('a vector source matches legacy pixels through a rotated crop', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: 'vector-source crop',
        documentId: 'vector-source-crop-pixel-parity',
        transitions: [{ angleDegrees: 37, nextFrame: { x: 8, y: 8, width: 48, height: 48 } }],
        layers: [
          {
            kind: 'vector',
            id: 'vector-source',
            order: 0,
            pos: { x: 16, y: 18, width: 24, height: 18 },
            args: {
              toolName: 'shape',
              alpha: 1,
              color: '#00ffff',
              backgroundColor: null,
              hasFill: true,
              figure: 'rectangle',
              lineWidth: 1,
              toolMode: 'shape',
              start: { x: 2, y: 2 },
              end: { x: 22, y: 16 },
            },
          },
        ],
      });

      expect(result.colorPresence['#00ffff']?.legacy, 'legacy crop must contain vector-source pixels').toBe(true);
      expect(result.colorPresence['#00ffff']?.durable, 'durable crop must contain vector-source pixels').toBe(true);
      expect(result.differingBytes, 'vector-source crop rasters must match byte-for-byte').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
    });

    test('a paint source matches legacy pixels through a rotated crop', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: 'paint-source crop',
        documentId: 'paint-source-crop-pixel-parity',
        transitions: [{ angleDegrees: 37, nextFrame: { x: 8, y: 8, width: 48, height: 48 } }],
        layers: [
          {
            kind: 'paint',
            id: 'paint-source',
            order: 0,
            pos: { x: 16, y: 28, width: 32, height: 24 },
            args: {
              toolName: 'draw',
              alpha: 1,
              color: '#ff8800',
              penType: 'pen',
              lineWidth: 5,
              points: [
                { x: 2, y: 3 },
                { x: 28, y: 18 },
              ],
            },
          },
        ],
      });

      expect(result.colorPresence['#ff8800']?.legacy, 'legacy crop must contain paint-source pixels').toBe(true);
      expect(result.colorPresence['#ff8800']?.durable, 'durable crop must contain paint-source pixels').toBe(true);
      expect(result.differingBytes, 'paint-source crop rasters must match byte-for-byte').toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
    });

    test('multi-step frame transitions retain byte parity across text, vector, blank, and paint sources', async ({
      page,
    }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: 'multi-step mixed-source crop',
        documentId: 'multi-step-mixed-source-crop-pixel-parity',
        transitions: [
          { angleDegrees: 37, nextFrame: { x: 4, y: 4, width: 56, height: 56 } },
          { angleDegrees: 0, nextFrame: { x: 5, y: 6, width: 54, height: 52 } },
          { angleDegrees: -17, nextFrame: { x: 7, y: 6, width: 50, height: 50 } },
        ],
        layers: [
          {
            kind: 'blank',
            id: 'blank',
            order: 0,
            pos: { x: 28, y: 8, width: 10, height: 10 },
            color: '#00ff00',
            opacity: 1,
          },
          {
            kind: 'vector',
            id: 'vector',
            order: 1,
            pos: { x: 14, y: 18, width: 14, height: 14 },
            args: {
              toolName: 'shape',
              alpha: 1,
              color: '#00ffff',
              backgroundColor: null,
              hasFill: true,
              figure: 'rectangle',
              lineWidth: 1,
              toolMode: 'shape',
              start: { x: 1, y: 1 },
              end: { x: 13, y: 13 },
            },
          },
          {
            kind: 'paint',
            id: 'paint',
            order: 2,
            pos: { x: 40, y: 24, width: 16, height: 18 },
            args: {
              toolName: 'draw',
              alpha: 1,
              color: '#ff8800',
              penType: 'pen',
              lineWidth: 5,
              points: [
                { x: 1, y: 1 },
                { x: 14, y: 16 },
              ],
            },
          },
          {
            kind: 'text',
            id: 'text',
            order: 3,
            pos: { x: 18, y: 38, width: 28, height: 18 },
            textArgs: {
              toolName: 'text',
              align: 'left',
              bold: false,
              color: '#ff00ff',
              fontFamily: 'serif',
              fontSize: 10,
              italic: false,
              lineHeight: 1.2,
              text: 'frame',
              rect: { x1: 0, y1: 0, x2: 28, y2: 18 },
              kind: 'point',
            },
          },
        ],
      });

      expect(result.transitionResults).toHaveLength(3);
      for (const transition of result.transitionResults) {
        expect(transition.durableFrame).toEqual(transition.frame);
        expect(transition.legacyByteLength).toBe(transition.frame.width * transition.frame.height * 4);
        expect(transition.durableByteLength).toBe(transition.legacyByteLength);
        expect(transition.differingBytes, `frame transition ${transition.index} must match byte-for-byte`).toBe(0);
      }
      for (const [color, presence] of Object.entries(result.colorPresence)) {
        expect(presence.legacy, `legacy mixed-source crop should contain ${color}`).toBe(true);
        expect(presence.durable, `durable mixed-source crop should contain ${color}`).toBe(true);
      }
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(Object.keys(result.materializedBounds).sort()).toEqual(['blank', 'paint', 'text', 'vector']);
    });
  });
});
