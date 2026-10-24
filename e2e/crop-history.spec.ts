import { expect, type Page, test } from './fixtures/extended-test';
import path from 'node:path';
import { getWorkspaceCanvas, loadImageData } from './helpers/canvas-helpers';
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
  readonly viewZoom: number;
  readonly viewPanX: number;
  readonly viewPanY: number;
  readonly viewRotation: number;
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
 * than runs inside the tool click. The workspace element persists across documents, so attribute
 * presence alone can accept a previous document's fit. Wait until the published document size and
 * viewport rect match the live canvas and container before using its geometry.
 */
async function readFit(page: Page): Promise<Fit> {
  const container = page.getByTestId('workspace-container');
  await expect(container).toHaveAttribute('data-fit-scale', /.+/);
  await expect
    .poll(
      () =>
        container.evaluate((node) => {
          if (!(node instanceof HTMLElement)) return false;
          const canvas = node.querySelector<HTMLCanvasElement>('[data-testid="workspace-canvas"]');
          if (!canvas) return false;
          const rect = node.getBoundingClientRect();
          const viewportX = rect.left + node.clientLeft;
          const viewportY = rect.top + node.clientTop;
          const viewportWidth = Math.max(
            0,
            node.clientWidth + rect.width - (node.offsetWidth > 0 ? node.offsetWidth : Math.round(rect.width))
          );
          const viewportHeight = Math.max(
            0,
            node.clientHeight + rect.height - (node.offsetHeight > 0 ? node.offsetHeight : Math.round(rect.height))
          );
          const devicePixelRatio = window.devicePixelRatio || 1;
          const read = (name: string) => {
            const raw = node.getAttribute(name);
            return raw === null ? Number.NaN : Number(raw);
          };
          return (
            read('data-fit-document-width') * devicePixelRatio === canvas.width &&
            read('data-fit-document-height') * devicePixelRatio === canvas.height &&
            read('data-fit-rect-x') === viewportX &&
            read('data-fit-rect-y') === viewportY &&
            read('data-fit-outer-width') === viewportWidth &&
            read('data-fit-outer-height') === viewportHeight
          );
        }),
      { message: 'the published fit matches the current canvas and workspace geometry' }
    )
    .toBe(true);
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
      viewZoom: read('data-view-effective-zoom'),
      viewPanX: read('data-view-pan-x'),
      viewPanY: read('data-view-pan-y'),
      viewRotation: read('data-view-rotation'),
    };
  });
}

async function readEffectiveDocumentScale(page: Page): Promise<number> {
  const fit = await readFit(page);
  return fit.scale * fit.viewZoom;
}

async function readEffectiveScaleErrorForFrame(
  page: Page,
  expectedFrame: { width: number; height: number },
  expectedScale: number
): Promise<number> {
  const fit = await readFit(page);
  if (fit.documentWidth !== expectedFrame.width || fit.documentHeight !== expectedFrame.height) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(fit.scale * fit.viewZoom - expectedScale);
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
  const centerX = fit.rectWidth / 2;
  const centerY = fit.rectHeight / 2;
  const relativeX = fit.offsetX + documentX * fit.scale - centerX;
  const relativeY = fit.offsetY + documentY * fit.scale - centerY;
  const angle = (fit.viewRotation * Math.PI) / 180;
  const rotatedX = relativeX * Math.cos(angle) - relativeY * Math.sin(angle);
  const rotatedY = relativeX * Math.sin(angle) + relativeY * Math.cos(angle);
  return {
    x: fit.rectX + centerX + fit.viewPanX + fit.viewZoom * rotatedX,
    y: fit.rectY + centerY + fit.viewPanY + fit.viewZoom * rotatedY,
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

/** Wait for the document raster itself to contain no dark ink, independent of crop guides over it. */
async function waitForNoInkOnWorkspaceCanvas(page: Page): Promise<void> {
  await expect
    .poll(() =>
      getWorkspaceCanvas(page).evaluate((canvas) => {
        const context = (canvas as HTMLCanvasElement).getContext('2d');
        if (!context) throw new Error('document canvas has no 2D context');
        const { width, height } = canvas as HTMLCanvasElement;
        const { data } = context.getImageData(0, 0, width, height);
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] > 0 && data[index] < 80 && data[index + 1] < 80 && data[index + 2] < 80) return false;
        }
        return true;
      })
    )
    .toBe(true);
}

async function readCropGuidePathCoordinates(page: Page): Promise<number[]> {
  return page
    .getByTestId('crop-composition-guide')
    .locator('path')
    .getAttribute('d')
    .then((pathData) => {
      if (!pathData) throw new Error('the crop composition guide has no path');
      return (pathData.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    });
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
  const left = documentPoint(fit, 0, 0).x;
  const top = documentPoint(fit, 0, 0).y;
  const documentEdge = {
    left,
    right: documentPoint(fit, fit.documentWidth, 0).x,
    top,
    bottom: documentPoint(fit, 0, fit.documentHeight).y,
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
  await expectDeliverablePagePoint(page, fit, release, what);
}

async function expectDeliverablePagePoint(page: Page, fit: Fit, point: PagePoint, what: string): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('the page has no viewport');
  const message =
    `${what}: the pointer lands on page (${point.x.toFixed(2)}, ${point.y.toFixed(2)}) and the window ` +
    `is the rectangle [0, 0] ${viewport.width}x${viewport.height}, so a point outside it is not a page point ` +
    `the harness can hand to page.mouse. The workspace container is [${fit.rectX}, ${fit.rectY}] ` +
    `${fit.rectWidth}x${fit.rectHeight}, so the gesture surface — an \`absolute inset-0\` over that container — ` +
    `is reachable from the capture rather than from the pointer, and only the window is the real bound.`;

  expect(point.x, message).toBeGreaterThanOrEqual(0);
  expect(point.x, message).toBeLessThanOrEqual(viewport.width);
  expect(point.y, message).toBeGreaterThanOrEqual(0);
  expect(point.y, message).toBeLessThanOrEqual(viewport.height);
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

/** Drag the logarithmic zoom control to an absolute image-pixel magnification. */
async function setZoomMagnification(page: Page, magnification: number): Promise<void> {
  await clickToolButton(page, 'zoom');
  const slider = page.locator('#view-zoom-slider');
  const target = await slider.evaluate((element, targetMagnification) => {
    const input = element as HTMLInputElement;
    const workspace = document.querySelector<HTMLElement>('[data-testid="workspace-container"]');
    const width = Number(workspace?.getAttribute('data-fit-document-width'));
    const height = Number(workspace?.getAttribute('data-fit-document-height'));
    const minimumMagnification = width > 0 && height > 0 ? 1 / Math.max(1, Math.min(width, height)) : 0.1;
    const rect = input.getBoundingClientRect();
    const thumbWidth = 16;
    const minimumPosition = Number(input.min);
    const maximumPosition = Number(input.max);
    const currentPosition = Number(input.value);
    const targetProgress = Math.log(targetMagnification / minimumMagnification) / Math.log(32 / minimumMagnification);
    const positionToX = (position: number) =>
      rect.left +
      thumbWidth / 2 +
      ((position - minimumPosition) / (maximumPosition - minimumPosition)) * (rect.width - thumbWidth);
    return {
      startX: positionToX(currentPosition),
      targetX: positionToX(minimumPosition + targetProgress * (maximumPosition - minimumPosition)),
      y: rect.top + rect.height / 2,
    };
  }, magnification);

  await page.mouse.move(target.startX, target.y);
  await page.mouse.down();
  await page.mouse.move(target.targetX, target.y, { steps: 32 });
  await page.mouse.up();
  await expect.poll(() => readEffectiveDocumentScale(page)).toBeCloseTo(magnification, 1);
}

/** Set the Type bar's own color input, then verify the browser accepted it. */
async function setTextToolColor(page: Page, hex: string): Promise<void> {
  await page.evaluate((color) => {
    const input = document.querySelector<HTMLInputElement>('#text-color');
    if (!input) throw new Error('the Text toolbar color input is missing');
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('the native input value setter is missing');
    descriptor.set.call(input, color);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
  await expect(page.locator('#text-color')).toHaveValue(hex);
}

/** Decode the document canvas without repeated Canvas2D getImageData readbacks. */
async function readWorkspaceRaster(page: Page): Promise<Awaited<ReturnType<typeof loadImageData>>> {
  const pngBase64 = await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const png = canvas.toDataURL('image/png');
    const comma = png.indexOf(',');
    if (comma < 0) throw new Error('document canvas did not produce a PNG data URL');
    return png.slice(comma + 1);
  });
  return await loadImageData(Buffer.from(pngBase64, 'base64'));
}

/** Count opaque red pixels in the committed document raster, not the DOM text preview. */
async function countRedWorkspacePixels(page: Page): Promise<number> {
  const { data } = await readWorkspaceRaster(page);
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (
      (data[index + 3] ?? 0) > 0 &&
      (data[index] ?? 0) > 100 &&
      (data[index + 1] ?? 0) < 100 &&
      (data[index + 2] ?? 0) < 100
    ) {
      count++;
    }
  }
  return count;
}

/** A stable whole-raster fingerprint for text edit undo/redo within the same cropped frame. */
async function workspaceRasterSignature(page: Page): Promise<string> {
  const { width, height, data } = await readWorkspaceRaster(page);
  let hash = 2_166_136_261;
  for (const byte of data) hash = Math.imul(hash ^ byte, 16_777_619) >>> 0;
  return `${width}x${height}:${hash}`;
}

type WorkspaceRaster = Awaited<ReturnType<typeof loadImageData>>;
type RasterRegion = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Compare exact document pixels after normalizing a crop's changed frame origin. */
function expectRasterRegionToEqual(
  expected: WorkspaceRaster,
  expectedRegion: RasterRegion,
  actual: WorkspaceRaster,
  assertionMessage: string
): void {
  expect(expectedRegion.x, `${assertionMessage}: source x is an integer`).toBe(Math.trunc(expectedRegion.x));
  expect(expectedRegion.y, `${assertionMessage}: source y is an integer`).toBe(Math.trunc(expectedRegion.y));
  expect(expectedRegion.width, `${assertionMessage}: width is an integer`).toBe(Math.trunc(expectedRegion.width));
  expect(expectedRegion.height, `${assertionMessage}: height is an integer`).toBe(Math.trunc(expectedRegion.height));
  expect(expectedRegion.x, `${assertionMessage}: source x is inside the original frame`).toBeGreaterThanOrEqual(0);
  expect(expectedRegion.y, `${assertionMessage}: source y is inside the original frame`).toBeGreaterThanOrEqual(0);
  expect(
    expectedRegion.x + expectedRegion.width,
    `${assertionMessage}: source region fits horizontally`
  ).toBeLessThanOrEqual(expected.width);
  expect(
    expectedRegion.y + expectedRegion.height,
    `${assertionMessage}: source region fits vertically`
  ).toBeLessThanOrEqual(expected.height);
  expect(actual.width, `${assertionMessage}: normalized raster width`).toBe(expectedRegion.width);
  expect(actual.height, `${assertionMessage}: normalized raster height`).toBe(expectedRegion.height);

  let firstMismatch: string | null = null;
  for (let y = 0; y < expectedRegion.height && firstMismatch === null; y++) {
    for (let x = 0; x < expectedRegion.width; x++) {
      const sourceOffset = ((expectedRegion.y + y) * expected.width + expectedRegion.x + x) * 4;
      const actualOffset = (y * actual.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const sourceValue = expected.data[sourceOffset + channel];
        const actualValue = actual.data[actualOffset + channel];
        if (sourceValue !== actualValue) {
          firstMismatch = `pixel (${x}, ${y}) channel ${channel}: expected ${sourceValue}, received ${actualValue}`;
          break;
        }
      }
      if (firstMismatch !== null) break;
    }
  }
  expect(firstMismatch, assertionMessage).toBeNull();
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
          const differenceSamples: {
            x: number;
            y: number;
            channel: 'red' | 'green' | 'blue' | 'alpha';
            legacy: number | null;
            durable: number | null;
          }[] = [];
          const channelNames = ['red', 'green', 'blue', 'alpha'] as const;
          for (let byte = 0; byte < Math.max(legacyPixels.length, durablePixels.length); byte += 1) {
            if (legacyPixels[byte] === durablePixels[byte]) continue;
            differingBytes += 1;
            if (differenceSamples.length < 8) {
              const pixel = Math.floor(byte / 4);
              differenceSamples.push({
                x: pixel % frame.width,
                y: Math.floor(pixel / frame.width),
                channel: channelNames[byte % 4]!,
                legacy: legacyPixels[byte] ?? null,
                durable: durablePixels[byte] ?? null,
              });
            }
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
            differenceSamples,
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
        parityDetails: transitionResults
          .filter(({ differingBytes }) => differingBytes > 0)
          .map(
            ({ index, differingBytes, differenceSamples }) =>
              `transition ${index}: ${differingBytes} differing bytes; ${JSON.stringify(differenceSamples)}`
          )
          .join('; '),
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
    const openingEffectiveScale = await readEffectiveDocumentScale(page);
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
    await expect
      .poll(() => readEffectiveScaleErrorForFrame(page, cropped, openingEffectiveScale))
      .toBeLessThan(0.000001);

    // The bar's DOCUMENT position moved with the frame origin, so its strip is read under the
    // POST-CROP fit. Reading it under the opening fit is the bug `bandOfDocumentY` is here to
    // prevent: the two differ here, and the wrong one names a strip the bar is not in.
    const croppedFit = await readFit(page);
    expect(
      { width: croppedFit.documentWidth, height: croppedFit.documentHeight },
      'contain fit follows the new frame dimensions while fit-scale compensation preserves screen-space pixel scale'
    ).toEqual(cropped);
    const keptOnCropped = bandOfDocumentY(croppedFit, BAR_KEPT_Y - CROP_TOP_Y);
    await waitForInk(page, croppedFit, inkIn(keptOnCropped));

    // ONE UNDO, and it restores the frame in full — to the opening size exactly, not merely to
    // something larger. An undo that only partly restored the frame, or restored the pixels while
    // leaving the extent cropped, both fail on this line.
    await page.getByTestId('undo-button').click();
    await expect.poll(() => documentSize(page), 'one undo must put the whole frame back').toEqual(opening);
    await expect
      .poll(() => readEffectiveScaleErrorForFrame(page, opening, openingEffectiveScale))
      .toBeLessThan(0.000001);
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

    // Redo and undo exercise the same frame transition through history. Neither transition should
    // change apparent document-pixel size even though contain fit is recomputed for each frame.
    await page.getByTestId('redo-button').click();
    await expect.poll(() => documentSize(page), 'redo reapplies the cropped frame').toEqual(cropped);
    await expect
      .poll(() => readEffectiveScaleErrorForFrame(page, cropped, openingEffectiveScale))
      .toBeLessThan(0.000001);
    await page.getByTestId('undo-button').click();
    await expect.poll(() => documentSize(page), 'undo restores the opening frame again').toEqual(opening);
    await expect
      .poll(() => readEffectiveScaleErrorForFrame(page, opening, openingEffectiveScale))
      .toBeLessThan(0.000001);

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
    await waitForNoInkOnWorkspaceCanvas(page);
    await expect(
      page.getByTestId('undo-button'),
      'two undos from a fresh document reach the opening entry, so the crop was one and the stroke was one'
    ).toBeDisabled();
  });

  test('zoomed text commits before crop and crop/text history replays keep the transformed view', async ({ page }) => {
    await openDocument(page);
    const opening = await documentSize(page);
    const openingRaster = await readWorkspaceRaster(page);
    const openingRedPixels = await countRedWorkspacePixels(page);
    expect(openingRedPixels, 'the new document starts without red text ink').toBe(0);

    await setZoomMagnification(page, 2);
    const workspace = page.getByTestId('workspace-container');
    const workspaceBox = await workspace.boundingBox();
    expect(workspaceBox, 'the workspace has a measurable view surface').not.toBeNull();
    if (!workspaceBox) return;
    const viewCenter = { x: workspaceBox.x + workspaceBox.width / 2, y: workspaceBox.y + workspaceBox.height / 2 };

    // Keep zoom active while adding both a pan and a view rotation. The later Text and Crop
    // gestures are named in document pixels, then projected through the view that the app
    // publishes; a test that uses raw canvas percentages would silently name different pixels.
    await clickToolButton(page, 'hand');
    await page.mouse.move(viewCenter.x - 20, viewCenter.y - 10);
    await page.mouse.down();
    await page.mouse.move(viewCenter.x + 12, viewCenter.y + 8, { steps: 5 });
    await page.mouse.up();
    await expect(workspace).not.toHaveAttribute('data-view-pan-x', '0');

    await page.keyboard.press('r');
    await expect(page.getByRole('button', { name: 'Reset View', exact: true })).toBeVisible();
    await page.mouse.move(viewCenter.x - 16, viewCenter.y);
    await page.mouse.down();
    await page.mouse.move(viewCenter.x + 8, viewCenter.y, { steps: 6 });
    await page.mouse.up();
    await expect(workspace).not.toHaveAttribute('data-view-rotation', '0');

    await clickToolButton(page, 'text');
    await setTextToolColor(page, '#ff0000');
    const textFit = await readFit(page);
    const textAnchor = documentPoint(textFit, opening.width / 2, opening.height / 2);
    const textOverlay = page.getByTestId('text-edit-overlay');
    await page.mouse.click(textAnchor.x, textAnchor.y);
    await expect(textOverlay, 'the zoomed Text click opens an editor').toBeVisible();
    const placedTextBox = await textOverlay.boundingBox();
    expect(placedTextBox, 'the zoomed Text editor has screen-space geometry').not.toBeNull();
    expect(Math.abs(placedTextBox!.x + placedTextBox!.width / 2 - textAnchor.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(placedTextBox!.y + placedTextBox!.height / 2 - textAnchor.y)).toBeLessThanOrEqual(3);
    await textOverlay.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('ZOOM');
    await expect(textOverlay).toHaveText('ZOOM');

    const documentViewStyle = await page.locator('.zoom-container').evaluate((element) => {
      const computed = getComputedStyle(element);
      return { transform: computed.transform, transformOrigin: computed.transformOrigin };
    });
    const textViewStyle = await page.getByTestId('text-edit-view-transform').evaluate((element) => {
      const computed = getComputedStyle(element);
      return { transform: computed.transform, transformOrigin: computed.transformOrigin };
    });
    expect(textViewStyle, 'the Type editor and document share zoom, pan, and rotation').toEqual(documentViewStyle);

    // Switching tools must commit the draft before Crop can create its own history entry.
    await clickToolButton(page, 'crop');
    await expect(textOverlay, 'leaving Text commits and closes the draft editor').toHaveCount(0);
    const layers = page.getByTitle('Drag to reorder');
    await expect(layers, 'the text draft became one editable layer').toHaveCount(2);
    await expect(page.getByTestId('undo-button'), 'text commit is the first edit').toBeEnabled();
    await expect.poll(() => countRedWorkspacePixels(page)).toBeGreaterThan(20);
    const committedTextPixels = await countRedWorkspacePixels(page);
    const committedTextRaster = await readWorkspaceRaster(page);
    expect(committedTextRaster.width, 'the text commit keeps the original raster width').toBe(openingRaster.width);
    expect(committedTextRaster.height, 'the text commit keeps the original raster height').toBe(openingRaster.height);
    const magnificationBeforeCrop = await readEffectiveDocumentScale(page);

    const cropFit = await readFit(page);
    expect(cropFit.viewPanX).not.toBe(0);
    expect(cropFit.viewRotation).not.toBe(0);
    const cropRect = { left: 270, top: 220, right: 530, bottom: 380 };
    await dragOnCanvas(page, cropFit, { x: cropRect.left, y: cropRect.top }, { x: cropRect.right, y: cropRect.bottom });

    // The crop guide is a DOM/SVG preview transformed by the same view matrix as the canvas.
    // Check all four projected corners so translation, zoom, rotation, and crop coordinates each
    // have to agree; checking only the stored frame would miss a misaligned visible guide.
    const pageCorners = [
      documentPoint(cropFit, cropRect.left, cropRect.top),
      documentPoint(cropFit, cropRect.right, cropRect.top),
      documentPoint(cropFit, cropRect.left, cropRect.bottom),
      documentPoint(cropFit, cropRect.right, cropRect.bottom),
    ];
    const expectedGuide = {
      left: Math.min(...pageCorners.map(({ x }) => x)),
      top: Math.min(...pageCorners.map(({ y }) => y)),
      right: Math.max(...pageCorners.map(({ x }) => x)),
      bottom: Math.max(...pageCorners.map(({ y }) => y)),
    };
    const guideBox = await page.getByTestId('crop-composition-guide').boundingBox();
    expect(guideBox, 'the zoomed crop guide has screen-space geometry').not.toBeNull();
    expect(Math.abs(guideBox!.x - expectedGuide.left)).toBeLessThanOrEqual(3);
    expect(Math.abs(guideBox!.y - expectedGuide.top)).toBeLessThanOrEqual(3);
    expect(Math.abs(guideBox!.x + guideBox!.width - expectedGuide.right)).toBeLessThanOrEqual(3);
    expect(Math.abs(guideBox!.y + guideBox!.height - expectedGuide.bottom)).toBeLessThanOrEqual(3);

    await applyCrop(page);
    const cropped = { width: cropRect.right - cropRect.left, height: cropRect.bottom - cropRect.top };
    await expect.poll(() => documentSize(page), 'Apply commits the exact document-space rectangle').toEqual(cropped);
    await expect
      .poll(async () => Math.abs((await readEffectiveDocumentScale(page)) - magnificationBeforeCrop))
      .toBeLessThan(0.000001);
    await expect
      .poll(() => countRedWorkspacePixels(page), 'cropping around the text preserves its committed ink')
      .toBe(committedTextPixels);
    const croppedTextRaster = await readWorkspaceRaster(page);
    expectRasterRegionToEqual(
      committedTextRaster,
      { x: cropRect.left, y: cropRect.top, width: cropped.width, height: cropped.height },
      croppedTextRaster,
      'crop preserves every committed point-text pixel at its shifted frame origin'
    );

    const replayView = {
      panX: await workspace.getAttribute('data-view-pan-x'),
      panY: await workspace.getAttribute('data-view-pan-y'),
      rotation: await workspace.getAttribute('data-view-rotation'),
    };
    expect(replayView.panX, 'the transformed view has a horizontal pan').not.toBeNull();
    expect(replayView.panY, 'the transformed view has a vertical pan').not.toBeNull();
    expect(replayView.rotation, 'the transformed view has a rotation').not.toBeNull();
    const expectReplayView = async (historyStep: string) => {
      await expect(workspace, `${historyStep} preserves horizontal pan`).toHaveAttribute(
        'data-view-pan-x',
        replayView.panX!
      );
      await expect(workspace, `${historyStep} preserves vertical pan`).toHaveAttribute(
        'data-view-pan-y',
        replayView.panY!
      );
      await expect(workspace, `${historyStep} preserves canvas rotation`).toHaveAttribute(
        'data-view-rotation',
        replayView.rotation!
      );
    };

    // Text then crop are two ordered history entries. Undoing crop retains the text and its
    // magnification; undoing text removes only that layer. Redo must reproduce the same raster at
    // each frame without recording zoom, pan, or view rotation in the document timeline.
    await page.getByTestId('undo-button').click();
    await expect.poll(() => documentSize(page), 'one undo restores the full document frame').toEqual(opening);
    await expectReplayView('crop undo');
    await expect(layers).toHaveCount(2);
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(committedTextPixels);
    expectRasterRegionToEqual(
      committedTextRaster,
      { x: 0, y: 0, width: opening.width, height: opening.height },
      await readWorkspaceRaster(page),
      'crop undo restores the exact full-frame point-text raster'
    );
    await expect
      .poll(async () => Math.abs((await readEffectiveDocumentScale(page)) - magnificationBeforeCrop))
      .toBeLessThan(0.000001);

    await page.getByTestId('undo-button').click();
    await expect(layers, 'the next undo removes the text entry, not the view state').toHaveCount(1);
    await expectReplayView('text undo');
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(openingRedPixels);
    expectRasterRegionToEqual(
      openingRaster,
      { x: 0, y: 0, width: opening.width, height: opening.height },
      await readWorkspaceRaster(page),
      'text undo restores the exact opening raster'
    );
    await expect(workspace).not.toHaveAttribute('data-view-pan-x', '0');
    await expect(workspace).not.toHaveAttribute('data-view-rotation', '0');

    await page.getByTestId('redo-button').click();
    await expect(layers).toHaveCount(2);
    await expectReplayView('text redo');
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(committedTextPixels);
    expectRasterRegionToEqual(
      committedTextRaster,
      { x: 0, y: 0, width: opening.width, height: opening.height },
      await readWorkspaceRaster(page),
      'text redo reproduces the exact committed point-text raster'
    );
    await page.getByTestId('redo-button').click();
    await expect.poll(() => documentSize(page), 'redo restores the cropped frame').toEqual(cropped);
    await expectReplayView('crop redo');
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(committedTextPixels);
    expectRasterRegionToEqual(
      committedTextRaster,
      { x: cropRect.left, y: cropRect.top, width: cropped.width, height: cropped.height },
      await readWorkspaceRaster(page),
      'crop redo reproduces the exact cropped point-text raster'
    );
    await expect
      .poll(async () => Math.abs((await readEffectiveDocumentScale(page)) - magnificationBeforeCrop))
      .toBeLessThan(0.000001);

    // The crop shifted the document origin. Re-entering Type at the correspondingly shifted
    // point must find the original vector-backed text layer, not place a second layer elsewhere.
    await clickToolButton(page, 'text');
    const croppedFit = await readFit(page);
    const croppedTextAnchor = documentPoint(
      croppedFit,
      opening.width / 2 - cropRect.left,
      opening.height / 2 - cropRect.top
    );
    await page.mouse.click(croppedTextAnchor.x, croppedTextAnchor.y);
    await expect(textOverlay, 'the cropped text remains editable after redo').toHaveText('ZOOM');
    const reenteredTextBox = await textOverlay.boundingBox();
    expect(reenteredTextBox, 're-entered text has screen-space geometry').not.toBeNull();
    expect(croppedTextAnchor.x).toBeGreaterThanOrEqual(reenteredTextBox!.x - 2);
    expect(croppedTextAnchor.x).toBeLessThanOrEqual(reenteredTextBox!.x + reenteredTextBox!.width + 2);
    expect(croppedTextAnchor.y).toBeGreaterThanOrEqual(reenteredTextBox!.y - 2);
    expect(croppedTextAnchor.y).toBeLessThanOrEqual(reenteredTextBox!.y + reenteredTextBox!.height + 2);
    await expect(layers, 'editing the cropped source must not duplicate its layer').toHaveCount(2);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(textOverlay).toHaveCount(0);
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(committedTextPixels);
    expectRasterRegionToEqual(
      croppedTextRaster,
      { x: 0, y: 0, width: cropped.width, height: cropped.height },
      await readWorkspaceRaster(page),
      'cancelling a re-entered text edit leaves the cropped raster unchanged'
    );
  });

  test('paragraph Type keeps its edited source through a zoomed crop and text undo/redo', async ({ page }) => {
    await openDocument(page);
    const opening = await documentSize(page);
    expect(opening).toEqual({ width: DEFAULT_DOCUMENT_WIDTH, height: DEFAULT_DOCUMENT_HEIGHT });
    await setZoomMagnification(page, 2);
    await clickToolButton(page, 'text');
    await setTextToolColor(page, '#ff0000');
    await page.locator('#font-size-input').fill('48');
    await expect(page.locator('#font-size-input')).toHaveValue('48');

    const textFit = await readFit(page);
    await dragOnCanvas(page, textFit, { x: 250, y: 220 }, { x: 550, y: 400 }, 14);
    const textOverlay = page.getByTestId('text-edit-overlay');
    await expect(textOverlay, 'the zoomed drag creates a paragraph editor').toBeVisible();
    await expect(textOverlay).toHaveAttribute('data-text-kind', 'paragraph');
    await textOverlay.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('PARAGRAPH TYPE');
    await expect(textOverlay).toHaveText('PARAGRAPH TYPE');

    // As above, selecting Crop commits the active Type source first. The crop leaves room around
    // the entire paragraph box, so pixel comparison below distinguishes coordinate drift from an
    // intentional crop of glyphs at the frame edge.
    await clickToolButton(page, 'crop');
    await expect(textOverlay).toHaveCount(0);
    const layers = page.getByTitle('Drag to reorder');
    await expect(layers).toHaveCount(2);
    await expect.poll(() => countRedWorkspacePixels(page)).toBeGreaterThan(20);
    const originalTextPixels = await countRedWorkspacePixels(page);
    const originalTextRaster = await readWorkspaceRaster(page);
    const originalMagnification = await readEffectiveDocumentScale(page);

    const cropRect = { left: 220, top: 180, right: 580, bottom: 420 };
    const cropFit = await readFit(page);
    await dragOnCanvas(page, cropFit, { x: cropRect.left, y: cropRect.top }, { x: cropRect.right, y: cropRect.bottom });
    await applyCrop(page);
    const cropped = { width: cropRect.right - cropRect.left, height: cropRect.bottom - cropRect.top };
    await expect.poll(() => documentSize(page)).toEqual(cropped);
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(originalTextPixels);
    const croppedOriginalTextRaster = await readWorkspaceRaster(page);
    expectRasterRegionToEqual(
      originalTextRaster,
      { x: cropRect.left, y: cropRect.top, width: cropped.width, height: cropped.height },
      croppedOriginalTextRaster,
      'crop preserves every committed paragraph-text pixel at its shifted frame origin'
    );
    await expect
      .poll(async () => Math.abs((await readEffectiveDocumentScale(page)) - originalMagnification))
      .toBeLessThan(0.000001);
    const originalTextSignature = await workspaceRasterSignature(page);

    // The old text box is now [30,40]-[330,220] in the cropped document. Click inside its first
    // line after the frame and fit have changed, then edit through the original source layer.
    await clickToolButton(page, 'text');
    const croppedFit = await readFit(page);
    const textHit = documentPoint(croppedFit, 60, 65);
    await page.mouse.click(textHit.x, textHit.y);
    await expect(textOverlay, 'the cropped paragraph remains editable under zoom').toHaveText('PARAGRAPH TYPE');
    await expect(textOverlay).toHaveAttribute('data-text-kind', 'paragraph');
    const editBox = await textOverlay.boundingBox();
    expect(editBox, 'the cropped paragraph editor has screen-space geometry').not.toBeNull();
    expect(textHit.x).toBeGreaterThanOrEqual(editBox!.x - 2);
    expect(textHit.x).toBeLessThanOrEqual(editBox!.x + editBox!.width + 2);
    expect(textHit.y).toBeGreaterThanOrEqual(editBox!.y - 2);
    expect(textHit.y).toBeLessThanOrEqual(editBox!.y + editBox!.height + 2);

    await textOverlay.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('AFTER CROP');
    await expect(textOverlay).toHaveText('AFTER CROP');
    await page.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(textOverlay).toHaveCount(0);
    await expect(layers, 'editing changes the source in place, not by adding another layer').toHaveCount(2);
    await expect.poll(() => countRedWorkspacePixels(page)).toBeGreaterThan(20);
    const editedTextPixels = await countRedWorkspacePixels(page);
    const editedTextRaster = await readWorkspaceRaster(page);
    const editedTextSignature = await workspaceRasterSignature(page);
    expect(editedTextSignature, 'the committed replacement produces a different text raster').not.toBe(
      originalTextSignature
    );

    await clickToolButton(page, 'zoom');
    await page.getByTestId('undo-button').click();
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(originalTextPixels);
    await expect.poll(() => workspaceRasterSignature(page)).toBe(originalTextSignature);
    expectRasterRegionToEqual(
      croppedOriginalTextRaster,
      { x: 0, y: 0, width: cropped.width, height: cropped.height },
      await readWorkspaceRaster(page),
      'text undo restores every pixel of the cropped original paragraph'
    );
    await expect.poll(() => documentSize(page)).toEqual(cropped);
    await expect
      .poll(async () => Math.abs((await readEffectiveDocumentScale(page)) - originalMagnification))
      .toBeLessThan(0.000001);

    await clickToolButton(page, 'text');
    const undoFit = await readFit(page);
    const undoHit = documentPoint(undoFit, 60, 65);
    await page.mouse.click(undoHit.x, undoHit.y);
    await expect(textOverlay).toHaveText('PARAGRAPH TYPE');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByTestId('redo-button').click();
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(editedTextPixels);
    await expect.poll(() => workspaceRasterSignature(page)).toBe(editedTextSignature);
    expectRasterRegionToEqual(
      editedTextRaster,
      { x: 0, y: 0, width: cropped.width, height: cropped.height },
      await readWorkspaceRaster(page),
      'text redo reproduces every pixel of the edited cropped paragraph'
    );
    await clickToolButton(page, 'text');
    const redoFit = await readFit(page);
    const redoHit = documentPoint(redoFit, 60, 65);
    await page.mouse.click(redoHit.x, redoHit.y);
    await expect(textOverlay).toHaveText('AFTER CROP');
    await expect(layers, 'redo keeps the same editable text layer').toHaveCount(2);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => countRedWorkspacePixels(page)).toBe(editedTextPixels);
    expect(await documentSize(page), 'text edit replay does not change the crop frame').toEqual(cropped);
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
    await waitForNoInkOnWorkspaceCanvas(page);

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
      const openingEffectiveScale = await readEffectiveDocumentScale(page);
      const recoverableBarY = CROP_TOP_Y - 20;
      await drawBar(page, openingFit, recoverableBarY);
      await waitForInk(page, openingFit, inkIn(bandOfDocumentY(openingFit, recoverableBarY)));
      const sourcePixels = await readCanvasRegion(page, 'workspace-canvas', 350, recoverableBarY - 6, 100, 12);
      await commitCrop(page);
      expect(await documentSize(page)).toEqual({ width: COMMITTED_WIDTH, height: COMMITTED_HEIGHT });
      await expect
        .poll(async () => Math.abs((await readEffectiveDocumentScale(page)) - openingEffectiveScale))
        .toBeLessThan(0.000001);

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
      const previewPixels = await readCanvasRegion(page, 'crop-retained-pixels-preview', 350, 244, 100, 12);
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
      await expect
        .poll(async () => Math.abs((await readEffectiveDocumentScale(page)) - openingEffectiveScale))
        .toBeLessThan(0.000001);
    });

    test('reselecting Crop shows retained pixels under the dim and widening restores the original raster', async ({
      page,
    }, testInfo) => {
      await openDocument(page);
      await openRasterFixture(page, testInfo.config.rootDir);
      await expect.poll(() => documentSize(page)).toEqual({ width: 64, height: 64 });
      const originalPixels = await readCanvasRegion(page, 'workspace-canvas', 0, 0, 64, 64);
      expect(await readCanvasColor(page, 1, 20)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });
      let retainedRedSourcePixelCount = 0;
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const index = (y * 64 + x) * 4;
          if (originalPixels[index] === 255 && originalPixels[index + 1] === 0 && originalPixels[index + 2] === 0)
            retainedRedSourcePixelCount += 1;
        }
      }
      expect(
        retainedRedSourcePixelCount,
        'the known retained left margin contains a broad red source region'
      ).toBeGreaterThan(128);

      const initialFit = await openCropTool(page);
      await dragOnCanvas(page, initialFit, { x: 4, y: 4 }, { x: 60, y: 60 });
      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: 56, height: 56 });

      // Selecting Crop again must reveal the retained source immediately, before a handle moves.
      await clickToolButton(page, 'move');
      const recropFit = await openCropTool(page);
      const preview = page.getByTestId('crop-retained-pixels-preview');
      await expect(preview, 're-entering Crop exposes the original off-frame pixels').toBeVisible();
      expect(await readCanvasRegion(page, 'crop-retained-pixels-preview', 1, 20, 1, 1)).toEqual([255, 0, 0, 255]);
      const retainedOutsideFrame = await readCanvasRegion(page, 'crop-retained-pixels-preview', 0, 0, 64, 64);
      const currentFramePixels = await readCanvasRegion(page, 'workspace-canvas', 0, 0, 56, 56);
      const recoveredOpeningFrame: number[] = [];
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          // The preview canvas intentionally clears the currently visible 56×56 frame to avoid
          // drawing semi-transparent layers twice. Reconstruct the whole opening image from that
          // current frame and the retained pixels around it.
          const inCurrentFrame = x >= 4 && x < 60 && y >= 4 && y < 60;
          const source = inCurrentFrame ? currentFramePixels : retainedOutsideFrame;
          const offset = inCurrentFrame ? ((y - 4) * 56 + (x - 4)) * 4 : (y * 64 + x) * 4;
          recoveredOpeningFrame.push(...source.slice(offset, offset + 4));
        }
      }
      expect(
        recoveredOpeningFrame,
        'the current frame and retained preview together reproduce every original raster pixel'
      ).toEqual(originalPixels);
      await testInfo.attach('crop-reentry-retained-pixels-under-dim', {
        body: await page.screenshot({ scale: 'css' }),
        contentType: 'image/png',
      });

      // Read a screenshot of the actual retained red margin, using the dim layer's measured DOM
      // bounds instead of a hand-reconstructed page coordinate. This catches a good canvas buffer
      // hidden beneath a missing or misplaced blend in the rendered UI.
      const retainedDims = page.getByTestId('crop-retained-pixels-dim');
      const workspaceBounds = await getWorkspaceCanvas(page).boundingBox();
      if (!workspaceBounds) throw new Error('the workspace canvas has no visible bounds');
      const dimCount = await retainedDims.count();
      const dimBounds = await Promise.all(
        Array.from({ length: dimCount }, (_, index) => retainedDims.nth(index).boundingBox())
      );
      const redRetainedMargin = dimBounds.find(
        (bounds) =>
          bounds &&
          bounds.height > bounds.width * 4 &&
          bounds.x + bounds.width / 2 < workspaceBounds.x + workspaceBounds.width / 2
      );
      if (!redRetainedMargin) throw new Error('the retained red margin has no rendered dim layer');
      const clip = {
        x: Math.floor(redRetainedMargin.x),
        y: Math.floor(redRetainedMargin.y),
        width: Math.ceil(redRetainedMargin.x + redRetainedMargin.width) - Math.floor(redRetainedMargin.x),
        height: Math.ceil(redRetainedMargin.y + redRetainedMargin.height) - Math.floor(redRetainedMargin.y),
      };
      const rendered = await loadImageData(await page.screenshot({ clip, scale: 'css' }));
      let blendedRedPixelCount = 0;
      for (let index = 0; index < rendered.data.length; index += 4) {
        const [red, green, blue] = rendered.data.slice(index, index + 3);
        if (red > 60 && red < 95 && green < 10 && blue < 10) blendedRedPixelCount += 1;
      }
      expect(
        blendedRedPixelCount,
        'a meaningful part of the known retained red margin is visible through the crop selection’s 70% black blend'
      ).toBeGreaterThan(rendered.width * rendered.height * 0.5);

      // Grow all four crop edges back to the original image bounds, then prove the full raster is
      // byte-identical to what was on the canvas before the first crop.
      await dragOnCanvas(page, recropFit, { x: 0, y: 28 }, { x: -4, y: 28 });
      await dragOnCanvas(page, recropFit, { x: 56, y: 28 }, { x: 60, y: 28 });
      await dragOnCanvas(page, recropFit, { x: 28, y: 0 }, { x: 28, y: -4 });
      await dragOnCanvas(page, recropFit, { x: 28, y: 56 }, { x: 28, y: 60 });
      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: 64, height: 64 });
      await expect.poll(() => readCanvasRegion(page, 'workspace-canvas', 0, 0, 64, 64)).toEqual(originalPixels);
      await testInfo.attach('crop-reentry-restored-original-raster', {
        body: await page.screenshot({ scale: 'css' }),
        contentType: 'image/png',
      });
    });

    test('resizing a re-entered crop updates its full-frame grid and keeps the preview allocation fixed', async ({
      page,
    }, testInfo) => {
      await openDocument(page);
      await openRasterFixture(page, testInfo.config.rootDir);
      await expect.poll(() => documentSize(page)).toEqual({ width: 64, height: 64 });

      const openingFit = await openCropTool(page);
      await dragOnCanvas(page, openingFit, { x: 4, y: 4 }, { x: 60, y: 60 });
      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: 56, height: 56 });

      await clickToolButton(page, 'move');
      const fit = await openCropTool(page);
      const workspaceCanvas = getWorkspaceCanvas(page);
      const workspaceBoundsAtEntry = await workspaceCanvas.boundingBox();
      if (!workspaceBoundsAtEntry) throw new Error('the workspace canvas has no visible bounds');
      const documentPixelsAtEntry = await readCanvasRegion(page, 'workspace-canvas', 0, 0, 56, 56);
      const expectDocumentStationary = async (phase: string) => {
        expect(
          await readCanvasRegion(page, 'workspace-canvas', 0, 0, 56, 56),
          `${phase}: resizing or moving the crop box must leave document pixels unchanged`
        ).toEqual(documentPixelsAtEntry);
        const bounds = await workspaceCanvas.boundingBox();
        if (!bounds) throw new Error(`${phase}: the workspace canvas lost its visible bounds`);
        expect(bounds.x, `${phase}: the workspace canvas must not move horizontally`).toBeCloseTo(
          workspaceBoundsAtEntry.x,
          5
        );
        expect(bounds.y, `${phase}: the workspace canvas must not move vertically`).toBeCloseTo(
          workspaceBoundsAtEntry.y,
          5
        );
        expect(bounds.width, `${phase}: the workspace canvas must not resize horizontally`).toBeCloseTo(
          workspaceBoundsAtEntry.width,
          5
        );
        expect(bounds.height, `${phase}: the workspace canvas must not resize vertically`).toBeCloseTo(
          workspaceBoundsAtEntry.height,
          5
        );
      };
      const preview = page.getByTestId('crop-retained-pixels-preview');
      const previewBacking = await preview.evaluate((canvas) => ({
        width: (canvas as HTMLCanvasElement).width,
        height: (canvas as HTMLCanvasElement).height,
      }));
      const cropOutline = page.getByTestId('crop-selection-outline');
      const guide = page.getByTestId('crop-composition-guide');
      const rotationHandle = page.getByTestId('crop-rotation-handle');
      await expect(cropOutline).toBeVisible();
      await expect(guide).toBeVisible();
      await expect(
        rotationHandle,
        'the full-frame rotation grip stays visible beyond the old frame edge'
      ).toBeVisible();
      const openingGuidePath = guide.locator('path');
      expect(await openingGuidePath.getAttribute('stroke')).toMatch(/^rgba?\(/);
      expect(Number(await openingGuidePath.getAttribute('stroke-width'))).toBeGreaterThan(0);

      // Widen both dimensions of the full-frame crop. Use the center of each edge so the gesture
      // cannot be classified as the nearby rotation hot zone at an exact corner coordinate.
      const resizedFrameSize = 60;
      const rightPress = documentPoint(fit, fit.documentWidth, fit.documentHeight / 2);
      const resizedRight = documentPoint(fit, resizedFrameSize, 28);
      await expectDeliverablePagePoint(page, fit, rightPress, 'the right-edge press point');
      await expectDeliverableRelease(page, fit, resizedRight, 'the right-edge resize point');
      await dragOnCanvas(
        page,
        fit,
        { x: fit.documentWidth, y: fit.documentHeight / 2 },
        { x: resizedFrameSize, y: 28 }
      );
      const bottomEdge = documentPoint(fit, 40, fit.documentHeight);
      const intermediateBottom = documentPoint(fit, 40, 58);
      const resizedBottom = documentPoint(fit, 40, resizedFrameSize);
      await expectDeliverablePagePoint(page, fit, bottomEdge, 'the bottom-edge press point');
      await expectDeliverableRelease(page, fit, resizedBottom, 'the bottom-edge resize point');
      await page.mouse.move(bottomEdge.x, bottomEdge.y);
      await page.mouse.down();
      await page.mouse.move(intermediateBottom.x, intermediateBottom.y);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );
      await expectDocumentStationary('during re-entered crop resize');
      const intermediateScreenshot = await page.screenshot({ scale: 'css' });
      const intermediatePixels = await loadImageData(intermediateScreenshot);
      const intermediateGuideBounds = await guide.boundingBox();
      if (!intermediateGuideBounds) throw new Error('the resized grid did not repaint within two animation frames');
      expect(intermediateGuideBounds.width).toBeCloseTo(resizedFrameSize * fit.scale * fit.viewZoom, 0);
      expect(intermediateGuideBounds.height).toBeCloseTo(58 * fit.scale * fit.viewZoom, 0);
      const intermediateGuideCoordinates = await readCropGuidePathCoordinates(page);
      expect(intermediateGuideCoordinates[3]).toBeCloseTo(58, 5);
      expect(intermediateGuideCoordinates[7]).toBeCloseTo(58, 5);
      expect(intermediateGuideCoordinates[10]).toBeCloseTo(resizedFrameSize, 5);
      expect(intermediateGuideCoordinates[14]).toBeCloseTo(resizedFrameSize, 5);
      const pixelContrastNear = (pixels: Awaited<ReturnType<typeof loadImageData>>, x: number, y: number) => {
        const pixelAt = (px: number, py: number) => {
          const left = Math.floor(px);
          const top = Math.floor(py);
          const index = (top * pixels.width + left) * 4;
          return [...pixels.data.slice(index, index + 3)];
        };
        let maxContrast = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sample = pixelAt(x + offsetX, y + offsetY);
            const neighbor = pixelAt(x + offsetX + 3, y + offsetY);
            maxContrast = Math.max(
              maxContrast,
              sample.reduce((total, value, index) => total + Math.abs(value - neighbor[index]), 0)
            );
          }
        }
        return maxContrast;
      };
      const countBluePixels = (
        pixels: Awaited<ReturnType<typeof loadImageData>>,
        bounds: { x: number; y: number; width: number; height: number }
      ) => {
        let count = 0;
        const left = Math.max(0, Math.floor(bounds.x));
        const top = Math.max(0, Math.floor(bounds.y));
        const right = Math.min(pixels.width, Math.ceil(bounds.x + bounds.width));
        const bottom = Math.min(pixels.height, Math.ceil(bounds.y + bounds.height));
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const index = (y * pixels.width + x) * 4;
            const [red, green, blue] = pixels.data.slice(index, index + 3);
            // Pure-blue canvas pixels have a zero green channel; a visible #007bff
            // stroke contributes green even at antialiased edges.
            if (red < 100 && green > 0 && blue > 150) count += 1;
          }
        }
        return count;
      };
      expect(
        pixelContrastNear(
          intermediatePixels,
          intermediateGuideBounds.x + intermediateGuideBounds.width / 3,
          intermediateGuideBounds.y + intermediateGuideBounds.height / 2
        ),
        'the intermediate-size thirds guide is painted within two animation frames'
      ).toBeGreaterThan(30);
      expect(
        countBluePixels(intermediatePixels, {
          x: intermediateGuideBounds.x + intermediateGuideBounds.width * 0.2,
          y: intermediateGuideBounds.y - 2,
          width: intermediateGuideBounds.width * 0.6,
          height: 6,
        }),
        'the intermediate-size crop border is painted within two animation frames'
      ).toBeGreaterThan(3);
      expect(
        countBluePixels(intermediatePixels, {
          x: intermediateGuideBounds.x + intermediateGuideBounds.width * 0.2,
          y: intermediateGuideBounds.y + intermediateGuideBounds.height - 4,
          width: intermediateGuideBounds.width * 0.6,
          height: 6,
        }),
        'the moved bottom crop border is painted within two animation frames'
      ).toBeGreaterThan(3);
      expect(
        countBluePixels(intermediatePixels, {
          x: intermediateGuideBounds.x + intermediateGuideBounds.width - 4,
          y: intermediateGuideBounds.y + intermediateGuideBounds.height * 0.2,
          width: 6,
          height: intermediateGuideBounds.height * 0.6,
        }),
        'the moved right crop border is painted within two animation frames'
      ).toBeGreaterThan(3);
      await testInfo.attach('crop-reentry-intermediate-resize-grid-and-outline', {
        body: intermediateScreenshot,
        contentType: 'image/png',
      });

      await page.mouse.move(resizedBottom.x, resizedBottom.y, { steps: 10 });
      await page.mouse.up();
      await expectDocumentStationary('after re-entered crop resize');

      const expectedGuideWidth = resizedFrameSize * fit.scale * fit.viewZoom;
      const expectedGuideHeight = resizedFrameSize * fit.scale * fit.viewZoom;
      await expect.poll(async () => (await guide.boundingBox())?.width ?? 0).toBeCloseTo(expectedGuideWidth, 0);
      await expect.poll(async () => (await guide.boundingBox())?.height ?? 0).toBeCloseTo(expectedGuideHeight, 0);
      await expect
        .poll(async () => {
          const box = await cropOutline.boundingBox();
          return box ? Math.abs(box.width - expectedGuideWidth) : Number.POSITIVE_INFINITY;
        })
        .toBeLessThan(3);
      await expect
        .poll(async () => {
          const box = await cropOutline.boundingBox();
          return box ? Math.abs(box.height - expectedGuideHeight) : Number.POSITIVE_INFINITY;
        })
        .toBeLessThan(3);
      const frameOrigin = documentPoint(fit, 0, 0);
      await expect
        .poll(async () => {
          const box = await guide.boundingBox();
          return box
            ? Math.max(Math.abs(box.x - frameOrigin.x), Math.abs(box.y - frameOrigin.y))
            : Number.POSITIVE_INFINITY;
        })
        .toBeLessThan(3);
      await expect
        .poll(async () => {
          const box = await cropOutline.boundingBox();
          return box
            ? Math.max(Math.abs(box.x - frameOrigin.x + fit.viewZoom), Math.abs(box.y - frameOrigin.y + fit.viewZoom))
            : Number.POSITIVE_INFINITY;
        })
        .toBeLessThan(3);
      const guideCoordinates = await readCropGuidePathCoordinates(page);
      expect(guideCoordinates).toHaveLength(16);
      expect(guideCoordinates[0]).toBeCloseTo(resizedFrameSize / 3, 5);
      expect(guideCoordinates[2]).toBeCloseTo(resizedFrameSize / 3, 5);
      expect(guideCoordinates[4]).toBeCloseTo((2 * resizedFrameSize) / 3, 5);
      expect(guideCoordinates[6]).toBeCloseTo((2 * resizedFrameSize) / 3, 5);
      expect(guideCoordinates[9]).toBeCloseTo(resizedFrameSize / 3, 5);
      expect(guideCoordinates[11]).toBeCloseTo(resizedFrameSize / 3, 5);
      expect(guideCoordinates[13]).toBeCloseTo((2 * resizedFrameSize) / 3, 5);
      expect(guideCoordinates[15]).toBeCloseTo((2 * resizedFrameSize) / 3, 5);
      expect(guideCoordinates[0]).not.toBeCloseTo(fit.documentWidth / 3, 2);
      expect(guideCoordinates[9]).not.toBeCloseTo(fit.documentHeight / 3, 2);
      expect(guideCoordinates[3]).toBeCloseTo(resizedFrameSize, 5);
      expect(guideCoordinates[7]).toBeCloseTo(resizedFrameSize, 5);
      expect(guideCoordinates[10]).toBeCloseTo(resizedFrameSize, 5);
      expect(guideCoordinates[14]).toBeCloseTo(resizedFrameSize, 5);
      expect(
        await preview.evaluate((canvas) => ({
          width: (canvas as HTMLCanvasElement).width,
          height: (canvas as HTMLCanvasElement).height,
        })),
        'resizing the crop keeps the retained-pixel preview backing size stable'
      ).toEqual(previewBacking);

      const resizedOutlineRect = cropOutline.locator('rect');
      expect(await resizedOutlineRect.getAttribute('stroke')).toBe('#007bff');
      expect(Number(await resizedOutlineRect.getAttribute('stroke-width'))).toBeGreaterThan(0);
      expect(await resizedOutlineRect.getAttribute('stroke-dasharray')).toMatch(/\d/);
      await expect(rotationHandle, 'the rotation grip stays visible and aligned after resize').toBeVisible();
      expect(Number(await rotationHandle.locator('path').getAttribute('stroke-width'))).toBe(1);

      const screenshot = await page.screenshot({ scale: 'css' });
      const screenshotPixels = await loadImageData(screenshot);
      const guideBounds = await guide.boundingBox();
      if (!guideBounds) throw new Error('the resized crop guide has no screen bounds');
      const guideContrast = pixelContrastNear(
        screenshotPixels,
        guideBounds.x + guideBounds.width / 3,
        guideBounds.y + guideBounds.height / 2
      );
      expect(guideContrast, 'the resized thirds line is visible in the screenshot').toBeGreaterThan(30);

      expect(
        countBluePixels(screenshotPixels, {
          x: guideBounds.x + guideBounds.width * 0.2,
          y: guideBounds.y - 2,
          width: guideBounds.width * 0.6,
          height: 6,
        }),
        'the resized screenshot contains the crop outline dash pixels'
      ).toBeGreaterThan(3);
      const rotationHandleBounds = await rotationHandle.boundingBox();
      if (!rotationHandleBounds) throw new Error('the crop rotation grip has no screen bounds');
      expect(
        countBluePixels(screenshotPixels, {
          x: rotationHandleBounds.x - 1,
          y: rotationHandleBounds.y - 1,
          width: rotationHandleBounds.width + 2,
          height: rotationHandleBounds.height + 2,
        }),
        'the resized screenshot contains the visible rotation-grip pixels'
      ).toBeGreaterThan(2);
      const topLeftHandle = page.locator('[data-testid="crop-selection-handle"][data-corner="top-left"]');
      const topLeftHandleBounds = await topLeftHandle.boundingBox();
      if (!topLeftHandleBounds) throw new Error('the resized crop corner handle has no screen bounds');
      expect(
        countBluePixels(screenshotPixels, topLeftHandleBounds),
        'the resized screenshot contains the rendered crop corner-handle pixels'
      ).toBeGreaterThan(2);

      await expect(topLeftHandle).toHaveCSS('background-color', 'rgb(0, 123, 255)');

      const bottomRightHandle = page.locator('[data-testid="crop-selection-handle"][data-corner="bottom-right"]');
      const bottomRightHandleBounds = await bottomRightHandle.boundingBox();
      if (!bottomRightHandleBounds) throw new Error('the moved bottom-right crop handle has no screen bounds');
      const movedCorner = documentPoint(fit, resizedFrameSize, resizedFrameSize);
      expect(bottomRightHandleBounds.x + bottomRightHandleBounds.width / 2).toBeCloseTo(movedCorner.x, 0);
      expect(bottomRightHandleBounds.y + bottomRightHandleBounds.height / 2).toBeCloseTo(movedCorner.y, 0);
      expect(
        countBluePixels(screenshotPixels, bottomRightHandleBounds),
        'the resized screenshot contains the moved bottom-right crop handle'
      ).toBeGreaterThan(2);

      await testInfo.attach('crop-reentry-live-resize-grid-and-outline', {
        body: screenshot,
        contentType: 'image/png',
      });

      // Dragging inside moves the pending crop box. The document itself and its workspace
      // placement remain fixed until Apply; only the crop chrome and pending bounds move.
      const guideBeforeMove = await guide.boundingBox();
      if (!guideBeforeMove) throw new Error('the crop guide has no visible bounds before moving the crop box');
      const moveOffset = { x: 2, y: 3 };
      const moveStart = documentPoint(fit, resizedFrameSize / 2, resizedFrameSize / 2);
      const moveEnd = documentPoint(fit, resizedFrameSize / 2 + moveOffset.x, resizedFrameSize / 2 + moveOffset.y);
      await page.mouse.move(moveStart.x, moveStart.y);
      await page.mouse.down();
      await page.mouse.move(moveEnd.x, moveEnd.y, { steps: 10 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );
      await expectDocumentStationary('during interior move of the re-entered crop box');
      const movedGuideOrigin = documentPoint(fit, moveOffset.x, moveOffset.y);
      await expect
        .poll(async () => {
          const bounds = await guide.boundingBox();
          return bounds
            ? Math.max(Math.abs(bounds.x - movedGuideOrigin.x), Math.abs(bounds.y - movedGuideOrigin.y))
            : Infinity;
        })
        .toBeLessThan(3);
      await page.mouse.up();
      await expectDocumentStationary('after moving the re-entered crop box');
      await expect.poll(async () => (await guide.boundingBox())?.width ?? 0).toBeCloseTo(guideBeforeMove.width, 0);
      await expect.poll(async () => (await guide.boundingBox())?.height ?? 0).toBeCloseTo(guideBeforeMove.height, 0);
      await testInfo.attach('crop-reentry-moved-box-stationary-document', {
        body: await page.screenshot({ scale: 'css' }),
        contentType: 'image/png',
      });
    });

    test('canceling a re-entered crop resize restores its frame and accepts the next drag', async ({ page }) => {
      await openDocument(page);
      await openRasterFixture(page, test.info().config.rootDir);
      await expect.poll(() => documentSize(page)).toEqual({ width: 64, height: 64 });
      const openingFit = await openCropTool(page);
      await dragOnCanvas(page, openingFit, { x: 4, y: 4 }, { x: 60, y: 60 });
      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: 56, height: 56 });

      await clickToolButton(page, 'move');
      const fit = await openCropTool(page);
      const surface = page.locator('.cursor-crop');
      const guide = page.getByTestId('crop-composition-guide');
      await surface.evaluate((element) => {
        element.addEventListener(
          'pointerdown',
          (event) => {
            (window as Window & { __cropPointerId?: number }).__cropPointerId = (event as PointerEvent).pointerId;
          },
          { capture: true, once: true }
        );
      });

      const rightEdge = documentPoint(fit, fit.documentWidth, fit.documentHeight / 2);
      const widenedRight = documentPoint(fit, 60, fit.documentHeight / 2);
      await page.mouse.move(rightEdge.x, rightEdge.y);
      await page.mouse.down();
      await page.mouse.move(widenedRight.x, widenedRight.y, { steps: 5 });
      const pointerId = await page.evaluate(() => (window as Window & { __cropPointerId?: number }).__cropPointerId);
      if (pointerId === undefined) throw new Error('the active crop pointer ID was not captured');
      await page.evaluate((id) => {
        const element = document.querySelector('.cursor-crop');
        if (!element) throw new Error('the crop gesture surface disappeared');
        element.dispatchEvent(
          new PointerEvent('pointercancel', { pointerId: id, pointerType: 'mouse', bubbles: true, cancelable: true })
        );
      }, pointerId);
      await page.mouse.up();

      const expectedOpeningWidth = fit.documentWidth * fit.scale * fit.viewZoom;
      await expect
        .poll(async () => (await guide.boundingBox())?.width ?? 0, 'pointercancel restores the crop box')
        .toBeCloseTo(expectedOpeningWidth, 0);

      const nextRight = documentPoint(fit, 58, fit.documentHeight / 2);
      await dragOnCanvas(page, fit, { x: fit.documentWidth, y: fit.documentHeight / 2 }, { x: 58, y: 28 });
      await expect
        .poll(async () => (await guide.boundingBox())?.width ?? 0, 'the next edge drag is accepted')
        .toBeCloseTo(58 * fit.scale * fit.viewZoom, 0);
      await expectDeliverablePagePoint(page, fit, nextRight, 'the following resize remains on the workspace');
    });

    test('a recrop resize and move keep the crop frame aligned with the zoomed canvas', async ({ page }) => {
      await openDocument(page);
      await commitCrop(page);
      const croppedFit = await readFit(page);
      await drawBar(page, croppedFit, 100);

      // Re-entering crop after both a frame change and a pixel edit is the reported path. The
      // previous crop deliberately leaves a non-unit view zoom compensation so the canvas has a
      // transformed view when the crop box grows outside its current frame.
      await clickToolButton(page, 'move');
      const fit = await openCropTool(page);
      const topEdge = documentPoint(fit, fit.documentWidth / 2, 0);
      const extendedTop = documentPoint(fit, fit.documentWidth / 2, -40);
      await page.mouse.move(topEdge.x, topEdge.y);
      await page.mouse.down();
      await page.mouse.move(extendedTop.x, extendedTop.y, { steps: 12 });
      await page.mouse.up();

      const readTopOutlineCenter = async () => {
        const bounds = await page.getByTestId('crop-selection-outline').boundingBox();
        if (!bounds) throw new Error('the crop outline was not rendered');
        return { x: bounds.x + bounds.width / 2, y: bounds.y + fit.viewZoom };
      };
      const expectedTop = documentPoint(fit, fit.documentWidth / 2, -40);
      await expect
        .poll(async () => {
          const actual = await readTopOutlineCenter();
          return Math.max(Math.abs(actual.x - expectedTop.x), Math.abs(actual.y - expectedTop.y));
        })
        .toBeLessThan(2);

      // Move the whole crop rectangle after resizing it. Its top edge should move by the same
      // document-space delta while the underlying document remains in place.
      const moveFrom = documentPoint(fit, fit.documentWidth / 2, 120);
      const moveTo = documentPoint(fit, fit.documentWidth / 2 + 30, 145);
      await page.mouse.move(moveFrom.x, moveFrom.y);
      await page.mouse.down();
      await page.mouse.move(moveTo.x, moveTo.y, { steps: 12 });
      await page.mouse.up();

      const movedTop = documentPoint(fit, fit.documentWidth / 2 + 30, -15);
      await expect
        .poll(async () => {
          const actual = await readTopOutlineCenter();
          return Math.max(Math.abs(actual.x - movedTop.x), Math.abs(actual.y - movedTop.y));
        })
        .toBeLessThan(2);

      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: COMMITTED_WIDTH, height: COMMITTED_HEIGHT + 40 });
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

    test('the visible top rotation grip rotates a re-entered crop instead of starting a new crop', async ({ page }) => {
      await openDocument(page);
      const openingFit = await openCropTool(page);
      await dragOnCanvas(page, openingFit, { x: CROP_LEFT_X, y: CROP_TOP_Y }, { x: CROP_RIGHT_X, y: CROP_BOTTOM_Y });
      await applyCrop(page);
      await expect.poll(() => documentSize(page)).toEqual({ width: COMMITTED_WIDTH, height: COMMITTED_HEIGHT });

      await clickToolButton(page, 'move');
      const fit = await openCropTool(page);

      const surface = page.locator('.cursor-crop');
      const gripPoint = documentPoint(fit, fit.documentWidth / 2, -12);
      await page.mouse.move(gripPoint.x, gripPoint.y);
      await expect(surface, 'the rendered midpoint grip advertises rotation').toHaveCSS('cursor', /url.*ew-resize/);
      const rotatedPoint = documentPoint(
        fit,
        fit.documentWidth / 2 + fit.documentHeight / 2 + 12,
        fit.documentHeight / 2
      );
      await expectDeliverablePagePoint(page, fit, gripPoint, 'the visible rotation-grip press point');
      await expectDeliverablePagePoint(page, fit, rotatedPoint, 'the visible rotation-grip drag point');
      await page.mouse.down();
      await page.mouse.move(rotatedPoint.x, rotatedPoint.y, { steps: 12 });
      await page.mouse.up();

      await expect.poll(async () => Number(await surface.getAttribute('data-rotation'))).not.toBe(0);
      await expect(surface).toHaveAttribute('data-rotation', /8[5-9]|9[0-5]/);
    });

    test('a rotated crop transforms pixels in one history step and redo reproduces them exactly', async ({
      page,
    }, testInfo) => {
      await openDocument(page);
      await openRasterFixture(page, testInfo.config.rootDir);
      await expect.poll(() => documentSize(page)).toEqual({ width: 64, height: 64 });
      await expect.poll(() => readCanvasColor(page, 16, 32)).toEqual({ red: 255, green: 0, blue: 0, alpha: 255 });
      await expect.poll(() => readCanvasColor(page, 48, 32)).toEqual({ red: 0, green: 0, blue: 255, alpha: 255 });
      const originalPixels = await readCanvasRegion(page, 'workspace-canvas', 0, 0, 64, 64);

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
      const committedPixels = await readCanvasRegion(page, 'workspace-canvas', 0, 0, 32, 32);

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
      await expect.poll(() => readCanvasRegion(page, 'workspace-canvas', 0, 0, 64, 64)).toEqual(originalPixels);

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
      await expect
        .poll(() => readCanvasRegion(page, 'workspace-canvas', 0, 0, 32, 32), {
          message: 'redo must reproduce the rotated-crop raster exactly',
        })
        .toEqual(committedPixels);
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
      expect(
        result.differingBytes,
        `durable and legacy crop rasters must be byte-identical; ${result.parityDetails}`
      ).toBe(0);
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
      expect(
        result.differingBytes,
        `37-degree multi-layer rasters must match byte-for-byte; ${result.parityDetails}`
      ).toBe(0);
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
      expect(result.differingBytes, `text-source crop rasters must match byte-for-byte; ${result.parityDetails}`).toBe(
        0
      );
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
      expect(
        result.differingBytes,
        `paragraph text crop rasters must match byte-for-byte; ${result.parityDetails}`
      ).toBe(0);
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
      expect(result.differingBytes, `offset text crop rasters must match byte-for-byte; ${result.parityDetails}`).toBe(
        0
      );
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
      expect(result.differingBytes, `blank-source crop rasters must match byte-for-byte; ${result.parityDetails}`).toBe(
        0
      );
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
      expect(
        result.differingBytes,
        `vector-source crop rasters must match byte-for-byte; ${result.parityDetails}`
      ).toBe(0);
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
      expect(result.differingBytes, `paint-source crop rasters must match byte-for-byte; ${result.parityDetails}`).toBe(
        0
      );
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
        expect(
          transition.differingBytes,
          `frame transition ${transition.index} must match byte-for-byte; ${JSON.stringify(
            transition.differenceSamples
          )}`
        ).toBe(0);
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
