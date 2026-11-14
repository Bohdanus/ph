import { expect, type Page, type TestInfo, test } from './fixtures/extended-test';
import { initializeCanvas, readPsd } from 'ag-psd';
import path from 'node:path';
import sharp from 'sharp';
import { getWorkspaceCanvas, loadImageData, viewportClip } from './helpers/canvas-helpers';
import type { BoundingBox } from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { canvasBands, type CanvasBand, visibleCanvasBox, waitForBands } from './helpers/history-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { documentFrameSize as getDocumentFrameSize } from '../src/contexts/document-frame.ts';
import type { BitmapSource } from '../src/contexts/general-types.ts';
import type { DrawToolArgs } from '../src/tools/draw.ts';
import type { ShapeToolArgs } from '../src/tools/shape.ts';
import type { TransformToolArgs } from '../src/tools/transform.ts';
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

type PixelDifference = {
  readonly differingBytes: number;
  readonly differingPixels: number;
  readonly maxChannelDelta: number;
  readonly differingSamples: readonly {
    readonly x: number;
    readonly y: number;
    readonly channel: 'r' | 'g' | 'b' | 'a';
    readonly legacy: number | null;
    readonly durable: number | null;
  }[];
};

function pixelDifferenceSummary(result: PixelDifference): string {
  return `differingPixels=${result.differingPixels}, maxChannelDelta=${result.maxChannelDelta}, samples=${JSON.stringify(result.differingSamples)}`;
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
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly viewZoom: number;
  readonly viewPanX: number;
  readonly viewPanY: number;
  readonly viewRotation: number;
}

/**
 * The app's own contain fit, read from the attributes `usePointerPosition` publishes.
 *
 * `export/visual-regression.spec.ts` already pins the two things this depends on: the container's
 * client viewport equals the canvas CSS box, and the published `documentWidth`/`documentHeight`
 * are the size the app fitted. Reading the published values rather than calling `containFit` means this file
 * cannot drift from `getLocalCoords` if the fit rule ever changes, which is a change that would
 * otherwise turn every number below into a silently wrong gesture.
 *
 * The attributes are published by the mounted tool area's effect, which React schedules rather
 * than runs inside the tool click. A populated scale can still be left over from the PREVIOUS
 * document or container size, so wait until the published document and viewport geometry match
 * the live canvas before using the fit. `read` then names any missing or non-numeric field.
 */
async function readFit(page: Page): Promise<Fit> {
  const container = page.getByTestId('workspace-container');
  await expect
    .poll(() =>
      container.evaluate((node) => {
        if (!(node instanceof HTMLElement)) return false;
        const canvas = node.querySelector<HTMLCanvasElement>('[data-testid="workspace-canvas"]');
        if (!canvas) return false;
        const rect = node.getBoundingClientRect();
        const clientRect = {
          left: rect.left + node.clientLeft,
          top: rect.top + node.clientTop,
          width: Math.max(0, node.clientWidth + rect.width - (node.offsetWidth || Math.round(rect.width))),
          height: Math.max(0, node.clientHeight + rect.height - (node.offsetHeight || Math.round(rect.height))),
        };
        const backingScale = Number(canvas.getAttribute('data-hidpi-ratio') ?? 1);
        const documentWidth = Number(node.getAttribute('data-fit-document-width'));
        const documentHeight = Number(node.getAttribute('data-fit-document-height'));
        return (
          Number.isFinite(backingScale) &&
          backingScale > 0 &&
          Number.isFinite(documentWidth) &&
          Number.isFinite(documentHeight) &&
          canvas.width === Math.round(documentWidth * backingScale) &&
          canvas.height === Math.round(documentHeight * backingScale) &&
          node.getAttribute('data-fit-rect-x') === String(clientRect.left) &&
          node.getAttribute('data-fit-rect-y') === String(clientRect.top) &&
          node.getAttribute('data-fit-outer-width') === String(clientRect.width) &&
          node.getAttribute('data-fit-outer-height') === String(clientRect.height)
        );
      })
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
      scrollLeft: Number.isFinite(node.scrollLeft) ? node.scrollLeft : 0,
      scrollTop: Number.isFinite(node.scrollTop) ? node.scrollTop : 0,
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

/** The committed document frame, recovered from the visible canvas's backing pixels. */
async function documentSize(page: Page): Promise<DocumentSize> {
  return await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const ratioAttribute = canvas.getAttribute('data-hidpi-ratio');
    const backingScale = ratioAttribute === null ? 1 : Number(ratioAttribute);
    if (!Number.isFinite(backingScale) || backingScale <= 0) {
      throw new Error(`the workspace canvas has an invalid backing scale: ${ratioAttribute}`);
    }
    const width = Math.round(canvas.width / backingScale);
    const height = Math.round(canvas.height / backingScale);
    if (canvas.width !== Math.round(width * backingScale) || canvas.height !== Math.round(height * backingScale)) {
      throw new Error(
        `workspace canvas backing size ${canvas.width}x${canvas.height} does not encode an integer document frame at ${backingScale}x`
      );
    }
    return { width, height };
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
    x: fit.rectX + centerX + fit.viewPanX + fit.viewZoom * rotatedX - fit.scrollLeft,
    y: fit.rectY + centerY + fit.viewPanY + fit.viewZoom * rotatedY - fit.scrollTop,
  };
}

/**
 * Find a point just outside a real crop corner that the app identifies as its rotation hotspot,
 * then rotate 90 degrees clockwise around the visible box center. The DOM corner is rendered from
 * rounded document coordinates while the pointer hook hit-tests the fractional selection rect,
 * so a fixed CSS offset can land just inside a corner on one scale and outside the hot zone on
 * another.
 */
async function cropRotationGesturePoints(page: Page): Promise<{ start: PagePoint; end: PagePoint }> {
  const corner = page.locator('[data-testid="crop-selection-handle"][data-corner="top-left"]');
  const outline = page.getByTestId('crop-selection-outline');
  const surface = page.locator('.cursor-crop');
  await expect(corner, 'the top-left crop handle is rendered').toBeVisible();
  const cornerBounds = await corner.boundingBox();
  const outlineBounds = await outline.boundingBox();
  if (!cornerBounds || !outlineBounds) throw new Error('the crop rotation gesture has no visible bounds');

  const cornerX = cornerBounds.x + cornerBounds.width / 2;
  const cornerY = cornerBounds.y + cornerBounds.height / 2;
  const offsets = [4, 8, 12, 16, 20];
  const candidates = offsets
    .flatMap((offsetX) =>
      offsets
        .filter((offsetY) => Math.hypot(offsetX, offsetY) <= 23)
        .map((offsetY) => ({ offsetX, offsetY, distance: Math.hypot(offsetX, offsetY) }))
    )
    .sort((left, right) => left.distance - right.distance);
  let start: PagePoint | null = null;
  for (const candidate of candidates) {
    const point = { x: cornerX - candidate.offsetX, y: cornerY - candidate.offsetY };
    await page.mouse.move(point.x, point.y);
    const cursor = await surface.evaluate((element) => getComputedStyle(element).cursor);
    if (/url.*data:image\/svg\+xml/.test(cursor)) {
      start = point;
      break;
    }
  }
  if (!start) {
    throw new Error('No point outside the visible crop edge exposed the rotation cursor');
  }

  const center = {
    x: outlineBounds.x + outlineBounds.width / 2,
    y: outlineBounds.y + outlineBounds.height / 2,
  };
  const dx = start.x - center.x;
  const dy = start.y - center.y;
  return { start, end: { x: center.x - dy, y: center.y + dx } };
}

async function installCropInputProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const events: Array<Record<string, unknown>> = [];
    const windowWithProbe = window as Window & { __cropInputEvents?: Array<Record<string, unknown>> };
    windowWithProbe.__cropInputEvents = events;
    const describe = (target: EventTarget | null): unknown => {
      if (!(target instanceof Element)) return target instanceof Document ? '#document' : null;
      return {
        tag: target.tagName.toLowerCase(),
        id: target.id || null,
        className: String(target.className),
        draggable: target instanceof HTMLElement ? target.draggable : null,
        connected: target.isConnected,
      };
    };
    const record = (event: Event, phase: string) => {
      const pointer = event instanceof PointerEvent ? event : null;
      const surface = document.querySelector('.cursor-crop');
      events.push({
        phase,
        type: event.type,
        isTrusted: event.isTrusted,
        cancelable: event.cancelable,
        defaultPrevented: event.defaultPrevented,
        pointerType: pointer?.pointerType ?? null,
        pointerId: pointer?.pointerId ?? null,
        button: pointer?.button ?? null,
        buttons: pointer?.buttons ?? null,
        clientX: pointer?.clientX ?? null,
        clientY: pointer?.clientY ?? null,
        target: describe(event.target),
        currentSurface: describe(surface),
        composedPath: event
          .composedPath()
          .slice(0, 6)
          .map((target) => describe(target as EventTarget)),
        hasCapture: pointer ? (surface?.hasPointerCapture(pointer.pointerId) ?? false) : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    };
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
      'dragstart',
      'selectstart',
    ]) {
      document.addEventListener(type, (event) => record(event, 'capture'), true);
    }
    document.addEventListener('dragstart', (event) => record(event, 'bubble'));
    const dispatchEvent = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (event: Event): boolean {
      if (event.type === 'pointercancel') {
        events.push({
          phase: 'dispatch',
          isTrusted: event.isTrusted,
          target: describe(this),
          stack: new Error().stack,
        });
      }
      return dispatchEvent.call(this, event);
    };
  });
}

async function attachCropInputProbe(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const events = await page.evaluate(
    () => (window as Window & { __cropInputEvents?: Array<Record<string, unknown>> }).__cropInputEvents ?? []
  );
  await testInfo.attach(name, {
    body: JSON.stringify(events, null, 2),
    contentType: 'application/json',
  });
}

/**
 * The band a document-space HEIGHT falls in, on the workspace container.
 *
 * Use the app-published fit and the complete document-to-page transform, then measure that page
 * point against the same container box the screenshot bands cover. Crop commits can change the
 * contain scale and its compensation; using the raw contain offset alone drops the active view
 * zoom and can assign a visible stroke to the wrong screen band.
 */
function bandOfDocumentY(fit: Fit, documentY: number): number {
  const pagePoint = documentPoint(fit, fit.documentWidth / 2, documentY);
  const canvasY = pagePoint.y - fit.rectY;
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
  const [red, green, blue, alpha] = await readCanvasRegion(page, 'workspace-canvas', x, y, 1, 1);
  return { red, green, blue, alpha };
}

async function readCanvasRegion(page: Page, testId: string, x: number, y: number, width: number, height: number) {
  return page.getByTestId(testId).evaluate(
    (node, region) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas has no 2D context');
      const ratioAttribute = canvas.getAttribute('data-hidpi-ratio');
      let scaleX = ratioAttribute === null ? 1 : Number(ratioAttribute);
      let scaleY = scaleX;
      let logicalWidth = canvas.width;
      let logicalHeight = canvas.height;
      if (ratioAttribute !== null) {
        logicalWidth = Math.round(canvas.width / scaleX);
        logicalHeight = Math.round(canvas.height / scaleY);
        if (
          canvas.width !== Math.round(logicalWidth * scaleX) ||
          canvas.height !== Math.round(logicalHeight * scaleY)
        ) {
          throw new Error(`Canvas backing size does not match its declared ${scaleX}x scale`);
        }
      }
      if (ratioAttribute === null && canvas.dataset.testid === 'crop-retained-pixels-preview') {
        const style = getComputedStyle(canvas);
        const previewWidth = Number.parseFloat(style.width);
        const previewHeight = Number.parseFloat(style.height);
        if (
          !Number.isFinite(previewWidth) ||
          previewWidth <= 0 ||
          !Number.isFinite(previewHeight) ||
          previewHeight <= 0
        ) {
          throw new Error(`Canvas preview has invalid logical dimensions: ${style.width}x${style.height}`);
        }
        logicalWidth = previewWidth;
        logicalHeight = previewHeight;
        scaleX = canvas.width / logicalWidth;
        scaleY = canvas.height / logicalHeight;
      }
      if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) {
        throw new Error(`Canvas has an invalid backing scale: ${scaleX}x${scaleY}`);
      }
      if (
        ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
        region.x < 0 ||
        region.y < 0 ||
        region.width <= 0 ||
        region.height <= 0 ||
        region.x + region.width > logicalWidth ||
        region.y + region.height > logicalHeight
      ) {
        throw new RangeError(
          `Canvas region ${region.x},${region.y} ${region.width}x${region.height} is outside its ${logicalWidth}x${logicalHeight} logical pixels`
        );
      }

      const result = new Uint8ClampedArray(region.width * region.height * 4);
      const firstX = Math.floor((region.x + 0.5) * scaleX);
      const lastX = Math.floor((region.x + region.width - 0.5) * scaleX);
      const firstY = Math.floor((region.y + 0.5) * scaleY);
      const lastY = Math.floor((region.y + region.height - 0.5) * scaleY);
      const sourceLeft = Math.max(0, firstX);
      const sourceTop = Math.max(0, firstY);
      const sourceRight = Math.min(canvas.width - 1, lastX);
      const sourceBottom = Math.min(canvas.height - 1, lastY);
      if (sourceRight < sourceLeft || sourceBottom < sourceTop) return Array.from(result);

      const source = context.getImageData(
        sourceLeft,
        sourceTop,
        sourceRight - sourceLeft + 1,
        sourceBottom - sourceTop + 1
      );
      for (let row = 0; row < region.height; row += 1) {
        const sourceY = Math.min(canvas.height - 1, Math.floor((region.y + row + 0.5) * scaleY));
        for (let column = 0; column < region.width; column += 1) {
          const sourceX = Math.min(canvas.width - 1, Math.floor((region.x + column + 0.5) * scaleX));
          const sourceOffset = ((sourceY - sourceTop) * source.width + (sourceX - sourceLeft)) * 4;
          const targetOffset = (row * region.width + column) * 4;
          result[targetOffset] = source.data[sourceOffset]!;
          result[targetOffset + 1] = source.data[sourceOffset + 1]!;
          result[targetOffset + 2] = source.data[sourceOffset + 2]!;
          result[targetOffset + 3] = source.data[sourceOffset + 3]!;
        }
      }
      return Array.from(result);
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
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  await expect
    .poll(async () => (await readEffectiveDocumentScale(page)) * devicePixelRatio)
    .toBeCloseTo(magnification, 1);
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

/** Read the document canvas on its logical pixel grid, independent of its HiDPI backing size. */
async function readWorkspaceRaster(page: Page): Promise<Awaited<ReturnType<typeof loadImageData>>> {
  const pngBase64 = await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const ratioAttribute = canvas.getAttribute('data-hidpi-ratio');
    const backingScale = ratioAttribute === null ? 1 : Number(ratioAttribute);
    if (!Number.isFinite(backingScale) || backingScale <= 0) {
      throw new Error(`the workspace canvas has an invalid backing scale: ${ratioAttribute}`);
    }
    const width = Math.round(canvas.width / backingScale);
    const height = Math.round(canvas.height / backingScale);
    if (canvas.width !== Math.round(width * backingScale) || canvas.height !== Math.round(height * backingScale)) {
      throw new Error(
        `workspace canvas backing size ${canvas.width}x${canvas.height} does not encode an integer document frame at ${backingScale}x`
      );
    }
    const sourceContext = canvas.getContext('2d');
    if (!sourceContext) throw new Error('document canvas has no 2D context');
    const source = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
    const logicalCanvas = document.createElement('canvas');
    logicalCanvas.width = width;
    logicalCanvas.height = height;
    const logicalContext = logicalCanvas.getContext('2d');
    if (!logicalContext) throw new Error('logical document canvas has no 2D context');
    const logical = logicalContext.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(canvas.height - 1, Math.floor((y + 0.5) * backingScale));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(canvas.width - 1, Math.floor((x + 0.5) * backingScale));
        const sourceOffset = (sourceY * canvas.width + sourceX) * 4;
        const targetOffset = (y * width + x) * 4;
        logical.data[targetOffset] = source.data[sourceOffset]!;
        logical.data[targetOffset + 1] = source.data[sourceOffset + 1]!;
        logical.data[targetOffset + 2] = source.data[sourceOffset + 2]!;
        logical.data[targetOffset + 3] = source.data[sourceOffset + 3]!;
      }
    }
    logicalContext.putImageData(logical, 0, 0);
    const png = logicalCanvas.toDataURL('image/png');
    const comma = png.indexOf(',');
    if (comma < 0) throw new Error('logical document canvas did not produce a PNG data URL');
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

type CropParityLayerFixture = Readonly<{
  layerOpacity?: number;
  blendMode?: GlobalCompositeOperation;
}> &
  (
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
      }>
  );

type CropParityTransition = Readonly<{
  angleDegrees: number;
  nextFrame: CropParityFrame;
}>;

type CropParityLayerTransform = Readonly<{
  id: string;
  layerId: string;
  args: TransformToolArgs;
}>;

type CropParityFixture = Readonly<{
  caseName: string;
  documentId: string;
  transitions: readonly CropParityTransition[];
  layerTransforms?: readonly CropParityLayerTransform[];
  materializedLayerIds?: readonly string[];
  verifyProjectedOutputs?: boolean;
  captureRuntimePixels?: boolean;
  verifyDownstreamInvertParity?: boolean;
  diagnoseOpaqueBackdrop?: boolean;
  layers: readonly CropParityLayerFixture[];
}>;

type CropParityFramePixelSample = Readonly<
  PixelDifference['differingSamples'][number] & { documentX: number; documentY: number }
>;

type CropParityFrameChannel = 'r' | 'g' | 'b' | 'a';

type CropParityRgba = readonly [number, number, number, number];

type CropParityAlphaNeighborhood = readonly (number | null)[];

type CropParityOpaqueBackdropSample = Readonly<{
  x: number;
  y: number;
  documentX: number;
  documentY: number;
  legacyRgba: CropParityRgba;
  durableRgba: CropParityRgba;
  differingChannels: readonly CropParityFrameChannel[];
}>;

type CropParityOpaqueBackdropSurfaceComparison = Readonly<{
  differingBytes: number;
  differingPixels: number;
  differingBytesByChannel: Readonly<Record<CropParityFrameChannel, number>>;
  differingSamples: readonly CropParityOpaqueBackdropSample[];
}>;

type CropParityOpaqueBackdropComparison = Readonly<{
  backdropColor: '#5070a0';
  offscreenAvailable: boolean;
  html: CropParityOpaqueBackdropSurfaceComparison;
  offscreen: CropParityOpaqueBackdropSurfaceComparison | null;
}>;

type CropParityPremultipliedFramePixelSample = Readonly<{
  x: number;
  y: number;
  documentX: number;
  documentY: number;
  legacyRgba: CropParityRgba;
  durableRgba: CropParityRgba;
  legacyPremultipliedRgba: CropParityRgba;
  durablePremultipliedRgba: CropParityRgba;
  differingChannels: readonly CropParityFrameChannel[];
  legacyAlphaBoundary: boolean;
  durableAlphaBoundary: boolean;
  alphaBoundaryDifference: boolean;
  legacyAlphaNeighborhood: CropParityAlphaNeighborhood;
  durableAlphaNeighborhood: CropParityAlphaNeighborhood;
}>;

type CropParityTightPixelSample = Readonly<
  CropParityFramePixelSample & {
    legacyPremultiplied: number | null;
    durablePremultiplied: number | null;
    expectedAlpha: number | null;
    materializedAlpha: number | null;
    expectedAlphaNeighborhood: readonly (number | null)[];
    materializedAlphaNeighborhood: readonly (number | null)[];
  }
>;

type CropParityAffineTransform = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;

type CropParityLayerComparison = Readonly<{
  layerId: string;
  stage: string;
  positions: Readonly<{
    legacy: Readonly<{ x: number; y: number; width: number; height: number }>;
    durable: Readonly<{ x: number; y: number; width: number; height: number }>;
  }>;
  compositing: Readonly<{
    legacyOpacity: number;
    durableOpacity: number;
    legacyBlendMode: GlobalCompositeOperation;
    durableBlendMode: GlobalCompositeOperation;
  }>;
  affineTransforms: Readonly<{
    legacy: readonly CropParityAffineTransform[];
    durable: readonly CropParityAffineTransform[];
  }>;
  expectedBounds: CropParityFrame;
  materializedBounds: CropParityFrame;
  bitmapSize: Readonly<{ width: number; height: number }>;
  frameDifferingBytes: number;
  framePremultipliedDifferingBytes: number;
  framePremultipliedDifferingPixels: number;
  framePremultipliedDifferingBytesByChannel: Readonly<Record<CropParityFrameChannel, number>>;
  framePremultipliedAlphaBoundaryDifferingPixels: number;
  framePremultipliedNonBoundaryDifferingPixels: number;
  framePremultipliedDifferingSamples: readonly CropParityPremultipliedFramePixelSample[];
  offscreenFrameDifferingBytes: number;
  offscreenFramePremultipliedDifferingBytes: number;
  offscreenFramePremultipliedDifferingPixels: number;
  offscreenFramePremultipliedDifferingBytesByChannel: Readonly<Record<CropParityFrameChannel, number>>;
  offscreenFramePremultipliedAlphaBoundaryDifferingPixels: number;
  offscreenFramePremultipliedNonBoundaryDifferingPixels: number;
  offscreenFramePremultipliedDifferingSamples: readonly CropParityPremultipliedFramePixelSample[];
  opaqueBackdropComparison: CropParityOpaqueBackdropComparison | null;
  frameDifferingPixels: number;
  frameNonEdgeDifferingPixels: number;
  offscreenFrameDifferingPixels: number;
  offscreenFrameNonEdgeDifferingPixels: number;
  frameDifferingSamples: readonly CropParityFramePixelSample[];
  offscreenFrameDifferingSamples: readonly CropParityFramePixelSample[];
  tightBitmapRawDifferingBytes: number;
  tightBitmapRawDifferingSamples: readonly CropParityFramePixelSample[];
  offscreenTightBitmapRawDifferingBytes: number;
  offscreenTightBitmapRawDifferingSamples: readonly CropParityFramePixelSample[];
  tightBitmapPremultipliedDifferingBytes: number;
  downstreamInvertReadbackDifferingBytes: number | null;
  downstreamInvertReadbackDifferingSamples: readonly CropParityFramePixelSample[];
  offscreenDownstreamInvertReadbackDifferingBytes: number | null;
  offscreenDownstreamInvertReadbackDifferingSamples: readonly CropParityFramePixelSample[];
  tightBitmapDifferingPixels: number;
  tightBitmapNonEdgeDifferingPixels: number;
  offscreenTightBitmapPremultipliedDifferingBytes: number;
  offscreenTightBitmapDifferingPixels: number;
  offscreenTightBitmapNonEdgeDifferingPixels: number;
  tightBitmapDifferingSamples: readonly CropParityTightPixelSample[];
  offscreenTightBitmapDifferingSamples: readonly CropParityTightPixelSample[];
}>;

function expectTightBitmapPremultipliedParity(comparison: CropParityLayerComparison, context: string): void {
  const label = `${context} ${comparison.layerId} premultiplied tight bitmap at ${comparison.stage}`;
  expect(
    comparison.tightBitmapPremultipliedDifferingBytes,
    `${label} differs; ${JSON.stringify(comparison.tightBitmapDifferingSamples)}`
  ).toBe(0);

  const offscreenLabel = `${context} ${comparison.layerId} OffscreenCanvas premultiplied tight bitmap at ${comparison.stage}`;
  expect(
    comparison.offscreenTightBitmapPremultipliedDifferingBytes,
    `${offscreenLabel} differs; ${JSON.stringify(comparison.offscreenTightBitmapDifferingSamples)}`
  ).toBe(0);
}

async function compareCropRenderers(page: Page, caseFixture: CropParityFixture) {
  return page.evaluate(async (fixture) => {
    const load = (specifier: string) => import(/* @vite-ignore */ new URL(specifier, location.origin).href);
    const [
      { AssetRegistry },
      { composeDurableDocument },
      { durableLayerPresentationMismatch, projectDurableRender },
      { durableExportRecords, renderExportCanvas },
      { savePsd },
      { getLayerPresentationBounds, isIdentityAffineTransform, rotationAffineAroundPoint },
      { documentFrameSize },
      { legacyHistoryToDurable },
      { drawLayer, drawLayerSource, drawLayersToCanvas },
      { evaluatePresentation, retainedPresentationOperations },
      { replayHistory },
      { replayDurableAtCursor },
      { OPEN_DOCUMENT_ACTION, SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION },
      { findToolProcessor },
    ] = await Promise.all([
      load('/src/contexts/asset-registry.ts'),
      load('/src/contexts/durable-compositor.ts'),
      load('/src/contexts/durable-render-projection.ts'),
      load('/src/contexts/export-canvas.ts'),
      load('/src/contexts/psd-utils.ts'),
      load('/src/contexts/affine-transform.ts'),
      load('/src/contexts/document-frame.ts'),
      load('/src/contexts/history-adapter.ts'),
      load('/src/contexts/layer-renderer.ts'),
      load('/src/contexts/presentation-evaluator.ts'),
      load('/src/contexts/history-replay.ts'),
      load('/src/contexts/durable-replay.ts'),
      load('/src/util/constants.ts'),
      load('/src/tools/toolProcessors.ts'),
    ]);

    const baseFrame = { x: 0, y: 0, width: 64, height: 64 };
    if (fixture.transitions.length === 0) throw new Error(`No frame transitions were supplied for ${fixture.caseName}`);
    const layerTransforms = fixture.layerTransforms ?? [];
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
    const diagnosticBitmapSourceSurfaces = new WeakMap<object, HTMLCanvasElement>();
    const registry = new AssetRegistry();
    const layerResults = await Promise.allSettled(
      fixture.layers.map(async (layerFixture) => {
        const createSourceCanvas = () => {
          const canvas = document.createElement('canvas');
          canvas.width = layerFixture.pos.width;
          canvas.height = layerFixture.pos.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error(`A 2D context is required for ${layerFixture.id}`);
          return { canvas, context };
        };
        let runtimeSource:
          | Readonly<{
              bitmap: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
              source: Readonly<Record<string, unknown>>;
            }>
          | Readonly<{ bitmap: null; source: Readonly<Record<string, unknown>> }>;
        switch (layerFixture.kind) {
          case 'raster': {
            const { canvas: sourceCanvas, context: sourceContext } = createSourceCanvas();
            for (const fill of layerFixture.fills) {
              sourceContext.fillStyle = fill.color;
              sourceContext.fillRect(fill.x, fill.y, fill.width, fill.height);
            }
            const bitmap = await createImageBitmap(sourceCanvas);
            diagnosticBitmapSourceSurfaces.set(bitmap, sourceCanvas);
            registry.registerBaseline(fixture.documentId, bitmap);
            runtimeSource = {
              bitmap,
              source: {
                kind: 'image',
                bitmap,
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
          opacity: layerFixture.layerOpacity ?? 1,
          locked: false,
          blendMode: layerFixture.blendMode ?? 'source-over',
          order: layerFixture.order,
          pos: layerFixture.pos,
          presentationBounds: null,
          source: runtimeSource.source,
          operations: [],
        };
      })
    );
    const rejectedLayer = layerResults.find((result) => result.status === 'rejected');
    if (rejectedLayer?.status === 'rejected') {
      registry.shutdown();
      throw rejectedLayer.reason;
    }
    const layers = layerResults.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    let untransformedBaselinePixels: number[] | null = null;
    try {
      if (layerTransforms.length > 0) {
        const baselineSurface = document.createElement('canvas');
        const baselineLayers = (layers as unknown as Layer[]).slice().sort((left, right) => left.order - right.order);
        if (!drawLayersToCanvas(baselineSurface, baselineLayers, baseFrame)) {
          throw new Error(`Untransformed baseline composition was refused for ${fixture.caseName}`);
        }
        const baselineContext = baselineSurface.getContext('2d');
        if (!baselineContext) throw new Error(`Untransformed baseline produced no 2D context for ${fixture.caseName}`);
        untransformedBaselinePixels = Array.from(
          baselineContext.getImageData(0, 0, baseFrame.width, baseFrame.height).data
        );
      }
    } catch (error) {
      registry.shutdown();
      throw error;
    }
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
        ...layerTransforms.map(({ id, layerId, args }) => ({
          id,
          actionName: TOOL_ACTION,
          layerId,
          args,
        })),
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
      const compareAtCursor = async (legacyIndex: number, stage: string) => {
        const legacyReplay = replayHistory(
          history,
          legacyIndex,
          { width: 64, height: 64 },
          {
            createLayer: () => {
              throw new Error('Unexpected layer creation in a crop differential');
            },
            applyRasterTool: (layer: unknown) => layer,
          },
          baseFrame
        );
        if (legacyReplay.diagnostics.length > 0) {
          throw new Error(`Legacy replay failed at ${stage}: ${JSON.stringify(legacyReplay.diagnostics)}`);
        }
        const frame = legacyReplay.documentFrame;
        const frameSize = documentFrameSize(frame);
        const legacySurface = document.createElement('canvas');
        const legacyLayers = (Object.values(legacyReplay.layers) as Layer[]).sort(
          (left, right) => left.order - right.order
        );
        if (!drawLayersToCanvas(legacySurface, legacyLayers, frame)) {
          throw new Error(`Legacy composition was refused for ${fixture.caseName} at ${stage}`);
        }
        const legacyContext = legacySurface.getContext('2d');
        if (!legacyContext) throw new Error(`Legacy composition produced no 2D context at ${stage}`);
        const legacyPixels = Array.from(legacyContext.getImageData(0, 0, frameSize.width, frameSize.height).data);
        const differsFromUntransformed = (pixels: number[]) =>
          untransformedBaselinePixels !== null &&
          (pixels.length !== untransformedBaselinePixels.length ||
            pixels.some((pixel, index) => pixel !== untransformedBaselinePixels[index]));

        const cursor = converted.legacyCursorToDurableCursor[legacyIndex];
        if (typeof cursor !== 'number') throw new Error(`${stage} did not map to a durable cursor`);
        const replay = replayDurableAtCursor(converted.document, cursor);
        const composite = await composeDurableDocument(replay, {
          documentId: fixture.documentId,
          baselineAssetGeneration: registry.getDocumentGeneration(fixture.documentId),
          operationSetRevision: converted.document.durableRevision,
          assetRegistry: registry,
        });
        try {
          const durableSurface = document.createElement('canvas');
          durableSurface.width = frameSize.width;
          durableSurface.height = frameSize.height;
          const durableContext = durableSurface.getContext('2d');
          if (!durableContext) throw new Error(`Durable composition produced no 2D context at ${stage}`);
          durableContext.drawImage(composite.bitmap as CanvasImageSource, 0, 0);
          const durablePixels = Array.from(durableContext.getImageData(0, 0, frameSize.width, frameSize.height).data);
          let differingBytes = 0;
          let differingPixels = 0;
          let lastDifferingPixel = -1;
          let maxChannelDelta = 0;
          const differingSamples: PixelDifference['differingSamples'][number][] = [];
          const channels = ['r', 'g', 'b', 'a'] as const;
          for (let byte = 0; byte < Math.max(legacyPixels.length, durablePixels.length); byte += 1) {
            const legacy = legacyPixels[byte] ?? null;
            const durable = durablePixels[byte] ?? null;
            if (legacy === durable) continue;
            differingBytes += 1;
            const pixel = Math.floor(byte / 4);
            if (pixel !== lastDifferingPixel) {
              differingPixels += 1;
              lastDifferingPixel = pixel;
            }
            maxChannelDelta = Math.max(
              maxChannelDelta,
              legacy === null || durable === null ? 255 : Math.abs(legacy - durable)
            );
            if (differingSamples.length < 8) {
              differingSamples.push({
                x: pixel % frameSize.width,
                y: Math.floor(pixel / frameSize.width),
                channel: channels[byte % 4],
                legacy,
                durable,
              });
            }
          }
          const materializedBounds = Object.fromEntries(
            fixture.layers.map(({ id }) => {
              const layer = composite.layers[id];
              if (!layer) throw new Error(`Durable composition did not materialize ${id} at ${stage}`);
              return [id, layer.bounds];
            })
          );
          const frameComparisonSurfaces =
            (fixture.materializedLayerIds?.length ?? 0) > 0
              ? (() => {
                  const legacyFrameSurface = document.createElement('canvas');
                  legacyFrameSurface.width = frameSize.width;
                  legacyFrameSurface.height = frameSize.height;
                  const legacyFrameContext = legacyFrameSurface.getContext('2d');
                  const durableFrameSurface = document.createElement('canvas');
                  durableFrameSurface.width = frameSize.width;
                  durableFrameSurface.height = frameSize.height;
                  const durableFrameContext = durableFrameSurface.getContext('2d');
                  if (!legacyFrameContext || !durableFrameContext) {
                    throw new Error(`Unable to create reusable frame comparison surfaces at ${stage}`);
                  }
                  const legacyOffscreenSurface =
                    typeof OffscreenCanvas === 'undefined'
                      ? legacyFrameSurface
                      : new OffscreenCanvas(frameSize.width, frameSize.height);
                  const durableOffscreenSurface =
                    typeof OffscreenCanvas === 'undefined'
                      ? durableFrameSurface
                      : new OffscreenCanvas(frameSize.width, frameSize.height);
                  const legacyOffscreenContext = legacyOffscreenSurface.getContext('2d');
                  const durableOffscreenContext = durableOffscreenSurface.getContext('2d');
                  if (!legacyOffscreenContext || !durableOffscreenContext) {
                    throw new Error(`Unable to create OffscreenCanvas comparison surfaces at ${stage}`);
                  }
                  return {
                    legacyContext: legacyFrameContext,
                    durableContext: durableFrameContext,
                    legacyOffscreenContext,
                    durableOffscreenContext,
                  };
                })()
              : null;
          const materializedLayerComparisons = (fixture.materializedLayerIds ?? []).map((layerId) => {
            const legacyLayer = legacyReplay.layers[layerId];
            const materializedLayer = composite.layers[layerId];
            const durableLayer = replay.layers[layerId];
            if (!legacyLayer || !materializedLayer || !durableLayer) {
              throw new Error(`Missing ${layerId} layer for materialized parity at ${stage}`);
            }

            const evaluation = evaluatePresentation({
              position: legacyLayer.pos,
              sourceSize: { width: legacyLayer.pos.width, height: legacyLayer.pos.height },
              operations: retainedPresentationOperations(legacyLayer),
              mode: 'layer-bounds',
            });
            const expectedBounds = {
              x: frame.x + Math.floor(evaluation.bounds.x - frame.x),
              y: frame.y + Math.floor(evaluation.bounds.y - frame.y),
              width:
                Math.ceil(evaluation.bounds.x + evaluation.bounds.width - frame.x) -
                Math.floor(evaluation.bounds.x - frame.x),
              height:
                Math.ceil(evaluation.bounds.y + evaluation.bounds.height - frame.y) -
                Math.floor(evaluation.bounds.y - frame.y),
            };
            if (!frameComparisonSurfaces) throw new Error(`Missing frame comparison surfaces at ${stage}`);
            const {
              legacyContext: legacyFrameContext,
              durableContext: durableFrameContext,
              legacyOffscreenContext,
              durableOffscreenContext,
            } = frameComparisonSurfaces;
            for (const context of [
              legacyFrameContext,
              durableFrameContext,
              legacyOffscreenContext,
              durableOffscreenContext,
            ]) {
              context.setTransform(1, 0, 0, 1, 0, 0);
              context.globalAlpha = 1;
              context.globalCompositeOperation = 'source-over';
              context.imageSmoothingEnabled = false;
              context.clearRect(0, 0, frameSize.width, frameSize.height);
            }
            if (!drawLayer(legacyFrameContext, legacyLayer, frame)) {
              throw new Error(`Legacy renderer refused ${layerId} frame comparison at ${stage}`);
            }
            if (
              legacyOffscreenContext !== legacyFrameContext &&
              !drawLayer(legacyOffscreenContext, legacyLayer, frame)
            ) {
              throw new Error(`Legacy renderer refused ${layerId} OffscreenCanvas comparison at ${stage}`);
            }
            durableFrameContext.globalAlpha = materializedLayer.opacity;
            durableFrameContext.globalCompositeOperation = materializedLayer.blendMode;
            durableFrameContext.drawImage(
              materializedLayer.bitmap as CanvasImageSource,
              materializedLayer.bounds.x - frame.x,
              materializedLayer.bounds.y - frame.y,
              materializedLayer.bounds.width,
              materializedLayer.bounds.height
            );
            if (durableOffscreenContext !== durableFrameContext) {
              durableOffscreenContext.globalAlpha = materializedLayer.opacity;
              durableOffscreenContext.globalCompositeOperation = materializedLayer.blendMode;
              durableOffscreenContext.drawImage(
                materializedLayer.bitmap as CanvasImageSource,
                materializedLayer.bounds.x - frame.x,
                materializedLayer.bounds.y - frame.y,
                materializedLayer.bounds.width,
                materializedLayer.bounds.height
              );
            }
            const legacyFramePixels = legacyFrameContext.getImageData(0, 0, frameSize.width, frameSize.height).data;
            const durableFramePixels = durableFrameContext.getImageData(0, 0, frameSize.width, frameSize.height).data;
            const legacyOffscreenPixels = legacyOffscreenContext.getImageData(
              0,
              0,
              frameSize.width,
              frameSize.height
            ).data;
            const durableOffscreenPixels = durableOffscreenContext.getImageData(
              0,
              0,
              frameSize.width,
              frameSize.height
            ).data;
            const frameChannels = ['r', 'g', 'b', 'a'] as const;
            const createComparisonSurfaces = (label: string, width: number, height: number) => {
              const htmlSurface = document.createElement('canvas');
              htmlSurface.width = width;
              htmlSurface.height = height;
              const htmlContext = htmlSurface.getContext('2d');
              const offscreenSurface =
                typeof OffscreenCanvas === 'undefined' ? htmlSurface : new OffscreenCanvas(width, height);
              const offscreenContext = offscreenSurface.getContext('2d');
              if (!htmlContext || !offscreenContext) {
                throw new Error(`Unable to create ${label} pixel comparison surfaces at ${stage}`);
              }
              return { htmlContext, offscreenContext };
            };
            const legacyTightSurfaces = createComparisonSurfaces(
              'legacy tight bitmap',
              expectedBounds.width,
              expectedBounds.height
            );
            const durableTightSurfaces = createComparisonSurfaces(
              'durable tight bitmap',
              expectedBounds.width,
              expectedBounds.height
            );
            const legacyRawFrameSurfaces = createComparisonSurfaces(
              'legacy raw frame',
              frameSize.width,
              frameSize.height
            );
            for (const context of [
              legacyTightSurfaces.htmlContext,
              legacyTightSurfaces.offscreenContext,
              durableTightSurfaces.htmlContext,
              durableTightSurfaces.offscreenContext,
            ]) {
              context.setTransform(1, 0, 0, 1, 0, 0);
              context.globalAlpha = 1;
              context.globalCompositeOperation = 'source-over';
              context.imageSmoothingEnabled = false;
              context.clearRect(0, 0, expectedBounds.width, expectedBounds.height);
            }
            const legacyPixelLayer = { ...legacyLayer, opacity: 1, blendMode: 'source-over' };
            for (const context of [legacyRawFrameSurfaces.htmlContext, legacyRawFrameSurfaces.offscreenContext]) {
              context.setTransform(1, 0, 0, 1, 0, 0);
              context.globalAlpha = 1;
              context.globalCompositeOperation = 'source-over';
              context.imageSmoothingEnabled = false;
              context.clearRect(0, 0, frameSize.width, frameSize.height);
            }
            if (!drawLayer(legacyRawFrameSurfaces.htmlContext, legacyPixelLayer, frame)) {
              throw new Error(`Legacy renderer refused ${layerId} raw frame comparison at ${stage}`);
            }
            if (legacyRawFrameSurfaces.offscreenContext !== legacyRawFrameSurfaces.htmlContext) {
              if (
                !drawLayer(legacyRawFrameSurfaces.offscreenContext as CanvasRenderingContext2D, legacyPixelLayer, frame)
              ) {
                throw new Error(`Legacy renderer refused ${layerId} OffscreenCanvas raw frame comparison at ${stage}`);
              }
            }
            if (!drawLayer(legacyTightSurfaces.htmlContext, legacyPixelLayer, expectedBounds)) {
              throw new Error(`Legacy renderer refused ${layerId} tight bitmap comparison at ${stage}`);
            }
            if (legacyTightSurfaces.offscreenContext !== legacyTightSurfaces.htmlContext) {
              if (
                !drawLayer(
                  legacyTightSurfaces.offscreenContext as CanvasRenderingContext2D,
                  legacyPixelLayer,
                  expectedBounds
                )
              ) {
                throw new Error(`Legacy renderer refused ${layerId} OffscreenCanvas tight comparison at ${stage}`);
              }
            }
            durableTightSurfaces.htmlContext.drawImage(materializedLayer.bitmap as CanvasImageSource, 0, 0);
            if (durableTightSurfaces.offscreenContext !== durableTightSurfaces.htmlContext) {
              durableTightSurfaces.offscreenContext.drawImage(materializedLayer.bitmap as CanvasImageSource, 0, 0);
            }
            const isFrameAlphaBoundaryPixel = (
              pixels: Uint8ClampedArray,
              pixel: number,
              width: number,
              height: number
            ) => {
              if (pixel < 0 || pixel >= width * height) return false;
              const x = pixel % width;
              const y = Math.floor(pixel / width);
              const alphaAt = (sampleX: number, sampleY: number) => pixels[(sampleY * width + sampleX) * 4 + 3] ?? 0;
              const alpha = alphaAt(x, y);
              if (alpha === 0 || alpha === 255) return false;
              for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                  if (offsetX === 0 && offsetY === 0) continue;
                  const neighborX = x + offsetX;
                  const neighborY = y + offsetY;
                  if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) continue;
                  if (alpha !== alphaAt(neighborX, neighborY)) return true;
                }
              }
              return false;
            };
            const isFrameAlphaBoundaryDifference = (
              expected: Uint8ClampedArray,
              materialized: Uint8ClampedArray,
              pixel: number,
              width: number,
              height: number
            ) =>
              isFrameAlphaBoundaryPixel(expected, pixel, width, height) ||
              isFrameAlphaBoundaryPixel(materialized, pixel, width, height);
            const hasAdjacentAlphaColor = (
              pixels: Uint8ClampedArray,
              pixel: number,
              width: number,
              height: number,
              color: readonly [number, number, number]
            ) => {
              const x = pixel % width;
              const y = Math.floor(pixel / width);
              for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                  if (offsetX === 0 && offsetY === 0) continue;
                  const neighborX = x + offsetX;
                  const neighborY = y + offsetY;
                  if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) continue;
                  const offset = (neighborY * width + neighborX) * 4;
                  if (
                    (pixels[offset + 3] ?? 0) > 1 &&
                    pixels[offset] === color[0] &&
                    pixels[offset + 1] === color[1] &&
                    pixels[offset + 2] === color[2]
                  ) {
                    return true;
                  }
                }
              }
              return false;
            };
            const isTightAlphaBoundaryDifference = (
              expected: Uint8ClampedArray,
              materialized: Uint8ClampedArray,
              pixel: number,
              width: number,
              height: number
            ) => {
              const offset = pixel * 4;
              const expectedAlpha = expected[offset + 3] ?? 0;
              const materializedAlpha = materialized[offset + 3] ?? 0;
              const sameColor =
                expected[offset] === materialized[offset] &&
                expected[offset + 1] === materialized[offset + 1] &&
                expected[offset + 2] === materialized[offset + 2];
              if (expectedAlpha > 0 && expectedAlpha < 255 && materializedAlpha > 0 && materializedAlpha < 255) {
                return (
                  sameColor &&
                  isFrameAlphaBoundaryPixel(expected, pixel, width, height) &&
                  isFrameAlphaBoundaryPixel(materialized, pixel, width, height)
                );
              }
              const isOneAlphaSliver =
                (expectedAlpha === 0 && materializedAlpha === 1) || (expectedAlpha === 1 && materializedAlpha === 0);
              if (!isOneAlphaSliver) return false;
              const colorSource = expectedAlpha === 1 ? expected : materialized;
              const color: [number, number, number] = [
                colorSource[offset] ?? 0,
                colorSource[offset + 1] ?? 0,
                colorSource[offset + 2] ?? 0,
              ];
              return (
                isFrameAlphaBoundaryPixel(colorSource, pixel, width, height) &&
                hasAdjacentAlphaColor(expected, pixel, width, height, color) &&
                hasAdjacentAlphaColor(materialized, pixel, width, height, color)
              );
            };
            const alphaNeighborhood = (
              pixels: Uint8ClampedArray,
              x: number,
              y: number,
              width: number,
              height: number
            ) => {
              const values: (number | null)[] = [];
              for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
                for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
                  const sampleX = x + offsetX;
                  const sampleY = y + offsetY;
                  values.push(
                    sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height
                      ? null
                      : (pixels[(sampleY * width + sampleX) * 4 + 3] ?? 0)
                  );
                }
              }
              return values;
            };
            const compareTightPixels = (expectedBytes: Uint8ClampedArray, materializedBytes: Uint8ClampedArray) => {
              let diffCount = 0;
              let tightDifferingPixels = 0;
              let tightNonEdgeDifferingPixels = 0;
              let lastTightDifferingPixel = -1;
              const diffSamples: CropParityTightPixelSample[] = [];
              // Canvas readback exposes unpremultiplied channels; compare their composited byte representation.
              for (let byte = 0; byte < Math.max(expectedBytes.length, materializedBytes.length); byte += 1) {
                const legacy = expectedBytes[byte] ?? null;
                const durable = materializedBytes[byte] ?? null;
                const pixel = Math.floor(byte / 4);
                const alphaByte = pixel * 4 + 3;
                const legacyAlpha = expectedBytes[alphaByte] ?? null;
                const durableAlpha = materializedBytes[alphaByte] ?? null;
                const legacyPremultiplied =
                  legacy === null || legacyAlpha === null || byte % 4 === 3
                    ? legacy
                    : Math.round((legacy * legacyAlpha) / 255);
                const durablePremultiplied =
                  durable === null || durableAlpha === null || byte % 4 === 3
                    ? durable
                    : Math.round((durable * durableAlpha) / 255);
                if (legacyPremultiplied === durablePremultiplied) continue;
                diffCount += 1;
                if (pixel !== lastTightDifferingPixel) {
                  tightDifferingPixels += 1;
                  if (
                    !isTightAlphaBoundaryDifference(
                      expectedBytes,
                      materializedBytes,
                      pixel,
                      expectedBounds.width,
                      expectedBounds.height
                    )
                  ) {
                    tightNonEdgeDifferingPixels += 1;
                  }
                  lastTightDifferingPixel = pixel;
                }
                if (diffSamples.length < 8) {
                  const x = pixel % expectedBounds.width;
                  const y = Math.floor(pixel / expectedBounds.width);
                  diffSamples.push({
                    x,
                    y,
                    documentX: expectedBounds.x + x,
                    documentY: expectedBounds.y + y,
                    channel: frameChannels[byte % 4],
                    legacy,
                    durable,
                    legacyPremultiplied,
                    durablePremultiplied,
                    expectedAlpha: legacyAlpha,
                    materializedAlpha: durableAlpha,
                    expectedAlphaNeighborhood: alphaNeighborhood(
                      expectedBytes,
                      x,
                      y,
                      expectedBounds.width,
                      expectedBounds.height
                    ),
                    materializedAlphaNeighborhood: alphaNeighborhood(
                      materializedBytes,
                      x,
                      y,
                      expectedBounds.width,
                      expectedBounds.height
                    ),
                  });
                }
              }
              return {
                differingBytes: diffCount,
                differingPixels: tightDifferingPixels,
                nonEdgeDifferingPixels: tightNonEdgeDifferingPixels,
                differingSamples: diffSamples,
              };
            };
            const legacyTightPixels = legacyTightSurfaces.htmlContext.getImageData(
              0,
              0,
              expectedBounds.width,
              expectedBounds.height
            ).data;
            const durableTightPixels = durableTightSurfaces.htmlContext.getImageData(
              0,
              0,
              expectedBounds.width,
              expectedBounds.height
            ).data;
            const legacyOffscreenTightPixels = legacyTightSurfaces.offscreenContext.getImageData(
              0,
              0,
              expectedBounds.width,
              expectedBounds.height
            ).data;
            const durableOffscreenTightPixels = durableTightSurfaces.offscreenContext.getImageData(
              0,
              0,
              expectedBounds.width,
              expectedBounds.height
            ).data;
            const legacyRawFramePixels = legacyRawFrameSurfaces.htmlContext.getImageData(
              0,
              0,
              frameSize.width,
              frameSize.height
            ).data;
            const legacyOffscreenRawFramePixels = legacyRawFrameSurfaces.offscreenContext.getImageData(
              0,
              0,
              frameSize.width,
              frameSize.height
            ).data;
            const combineFrameGridPixels = (tightPixels: Uint8ClampedArray, framePixels: Uint8ClampedArray) => {
              const expectedPixels = new Uint8ClampedArray(tightPixels);
              const frameOffsetX = Math.round(expectedBounds.x - frame.x);
              const frameOffsetY = Math.round(expectedBounds.y - frame.y);
              const sourceX = Math.max(0, frameOffsetX);
              const sourceY = Math.max(0, frameOffsetY);
              const destinationX = Math.max(0, -frameOffsetX);
              const destinationY = Math.max(0, -frameOffsetY);
              const copyWidth = Math.max(0, Math.min(frameSize.width - sourceX, expectedBounds.width - destinationX));
              const copyHeight = Math.max(
                0,
                Math.min(frameSize.height - sourceY, expectedBounds.height - destinationY)
              );
              for (let y = 0; y < copyHeight; y += 1) {
                const frameStart = ((sourceY + y) * frameSize.width + sourceX) * 4;
                const tightStart = ((destinationY + y) * expectedBounds.width + destinationX) * 4;
                expectedPixels.set(framePixels.subarray(frameStart, frameStart + copyWidth * 4), tightStart);
              }
              return expectedPixels;
            };
            const legacyHybridTightPixels = combineFrameGridPixels(legacyTightPixels, legacyRawFramePixels);
            const legacyOffscreenHybridTightPixels = combineFrameGridPixels(
              legacyOffscreenTightPixels,
              legacyOffscreenRawFramePixels
            );
            // The tight raster uses frame-grid pixels inside the frame and bounded pixels outside it.
            const compareRawPixels = (expected: Uint8ClampedArray, actual: Uint8ClampedArray) => {
              let rawBitmapDifferingBytes = 0;
              const rawBitmapDifferingSamples: CropParityFramePixelSample[] = [];
              for (let byte = 0; byte < Math.max(expected.length, actual.length); byte += 1) {
                const legacy = expected[byte] ?? null;
                const durable = actual[byte] ?? null;
                if (legacy === durable) continue;
                rawBitmapDifferingBytes += 1;
                if (rawBitmapDifferingSamples.length >= 8) continue;
                const pixel = Math.floor(byte / 4);
                const x = pixel % expectedBounds.width;
                const y = Math.floor(pixel / expectedBounds.width);
                rawBitmapDifferingSamples.push({
                  x,
                  y,
                  documentX: expectedBounds.x + x,
                  documentY: expectedBounds.y + y,
                  channel: frameChannels[byte % 4],
                  legacy,
                  durable,
                });
              }
              return { differingBytes: rawBitmapDifferingBytes, differingSamples: rawBitmapDifferingSamples };
            };
            const downstreamInvertReadbackComparisons = fixture.verifyDownstreamInvertParity
              ? (() => {
                  const invertProcessor = findToolProcessor('invert');
                  if (!invertProcessor) {
                    throw new Error('Unable to find the Invert processor for materialization parity');
                  }
                  const invertRaster = (bitmap: CanvasImageSource) => {
                    const [inverted] = invertProcessor.imageProcessor({
                      bitmap: bitmap as BitmapSource,
                      size: { width: expectedBounds.width, height: expectedBounds.height },
                    })({ toolName: 'invert' });
                    if (!inverted) throw new Error('The Invert processor returned no output raster');
                    return inverted as CanvasImageSource;
                  };
                  const readRaster = (bitmap: CanvasImageSource) => {
                    const surface = document.createElement('canvas');
                    surface.width = expectedBounds.width;
                    surface.height = expectedBounds.height;
                    const context = surface.getContext('2d', { willReadFrequently: true });
                    if (!context) throw new Error('Unable to create the Invert result readback context');
                    context.drawImage(bitmap, 0, 0, expectedBounds.width, expectedBounds.height);
                    return context.getImageData(0, 0, expectedBounds.width, expectedBounds.height).data;
                  };
                  const durableInverted = invertRaster(materializedLayer.bitmap as CanvasImageSource);
                  return {
                    html: compareRawPixels(
                      readRaster(invertRaster(legacyTightSurfaces.htmlContext.canvas)),
                      readRaster(durableInverted)
                    ),
                    offscreen: compareRawPixels(
                      readRaster(invertRaster(legacyTightSurfaces.offscreenContext.canvas as CanvasImageSource)),
                      readRaster(durableInverted)
                    ),
                  };
                })()
              : null;
            const tightBitmapRawComparison = compareRawPixels(legacyHybridTightPixels, durableTightPixels);
            const offscreenTightBitmapRawComparison = compareRawPixels(
              legacyOffscreenHybridTightPixels,
              durableOffscreenTightPixels
            );
            const tightBitmapComparison = compareTightPixels(legacyHybridTightPixels, durableTightPixels);
            const offscreenTightBitmapComparison = compareTightPixels(
              legacyOffscreenHybridTightPixels,
              durableOffscreenTightPixels
            );
            let frameDifferingBytes = 0;
            let frameDifferingPixels = 0;
            let frameNonEdgeDifferingPixels = 0;
            let lastFrameDifferingPixel = -1;
            const frameDifferingSamples: CropParityFramePixelSample[] = [];
            let offscreenFrameDifferingBytes = 0;
            let offscreenFrameDifferingPixels = 0;
            let offscreenFrameNonEdgeDifferingPixels = 0;
            let lastOffscreenFrameDifferingPixel = -1;
            const offscreenFrameDifferingSamples: CropParityFramePixelSample[] = [];
            const frameAlphaNeighborhood = (
              pixels: Uint8ClampedArray,
              pixel: number,
              width: number,
              height: number
            ): CropParityAlphaNeighborhood => {
              const x = pixel % width;
              const y = Math.floor(pixel / width);
              const neighborhood: (number | null)[] = [];
              for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                  const neighborX = x + offsetX;
                  const neighborY = y + offsetY;
                  if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) {
                    neighborhood.push(null);
                    continue;
                  }
                  neighborhood.push(pixels[(neighborY * width + neighborX) * 4 + 3] ?? 0);
                }
              }
              return neighborhood;
            };
            const comparePremultipliedFramePixels = (
              expected: Uint8ClampedArray,
              received: Uint8ClampedArray,
              width = frameSize.width,
              height = frameSize.height,
              originX = frame.x,
              originY = frame.y
            ) => {
              const expectedLength = width * height * 4;
              if (expected.length !== expectedLength || received.length !== expectedLength) {
                throw new Error(
                  `Premultiplied frame comparison has ${expected.length}/${received.length} bytes; expected ${expectedLength} for ${width}x${height}`
                );
              }
              let premultipliedDifferingBytes = 0;
              let premultipliedDifferingPixels = 0;
              let alphaBoundaryDifferingPixels = 0;
              let nonBoundaryDifferingPixels = 0;
              const differingBytesByChannel: Record<CropParityFrameChannel, number> = { r: 0, g: 0, b: 0, a: 0 };
              const premultipliedDifferingSamples: CropParityPremultipliedFramePixelSample[] = [];
              const premultiply = (rgba: CropParityRgba): CropParityRgba => [
                Math.round((rgba[0] * rgba[3]) / 255),
                Math.round((rgba[1] * rgba[3]) / 255),
                Math.round((rgba[2] * rgba[3]) / 255),
                rgba[3],
              ];
              for (let pixel = 0; pixel < width * height; pixel += 1) {
                const offset = pixel * 4;
                const legacyRgba = [
                  expected[offset]!,
                  expected[offset + 1]!,
                  expected[offset + 2]!,
                  expected[offset + 3]!,
                ] as const;
                const durableRgba = [
                  received[offset]!,
                  received[offset + 1]!,
                  received[offset + 2]!,
                  received[offset + 3]!,
                ] as const;
                const legacyPremultipliedRgba = premultiply(legacyRgba);
                const durablePremultipliedRgba = premultiply(durableRgba);
                const differingChannels: CropParityFrameChannel[] = [];
                for (let channelIndex = 0; channelIndex < frameChannels.length; channelIndex += 1) {
                  const channel = frameChannels[channelIndex]!;
                  if (legacyPremultipliedRgba[channelIndex] === durablePremultipliedRgba[channelIndex]) continue;
                  premultipliedDifferingBytes += 1;
                  differingBytesByChannel[channel] += 1;
                  differingChannels.push(channel);
                }
                if (differingChannels.length === 0) continue;

                premultipliedDifferingPixels += 1;
                const legacyAlphaBoundary = isFrameAlphaBoundaryPixel(expected, pixel, width, height);
                const durableAlphaBoundary = isFrameAlphaBoundaryPixel(received, pixel, width, height);
                const alphaBoundaryDifference = legacyAlphaBoundary || durableAlphaBoundary;
                if (alphaBoundaryDifference) alphaBoundaryDifferingPixels += 1;
                else nonBoundaryDifferingPixels += 1;

                if (premultipliedDifferingSamples.length < 8) {
                  const x = pixel % width;
                  const y = Math.floor(pixel / width);
                  premultipliedDifferingSamples.push({
                    x,
                    y,
                    documentX: originX + x,
                    documentY: originY + y,
                    legacyRgba,
                    durableRgba,
                    legacyPremultipliedRgba,
                    durablePremultipliedRgba,
                    differingChannels,
                    legacyAlphaBoundary,
                    durableAlphaBoundary,
                    alphaBoundaryDifference,
                    legacyAlphaNeighborhood: frameAlphaNeighborhood(expected, pixel, width, height),
                    durableAlphaNeighborhood: frameAlphaNeighborhood(received, pixel, width, height),
                  });
                }
              }

              const result = {
                differingBytes: premultipliedDifferingBytes,
                differingPixels: premultipliedDifferingPixels,
                differingBytesByChannel,
                alphaBoundaryDifferingPixels,
                nonBoundaryDifferingPixels,
                differingSamples: premultipliedDifferingSamples,
              };
              if (
                result.alphaBoundaryDifferingPixels + result.nonBoundaryDifferingPixels !== result.differingPixels ||
                Object.values(result.differingBytesByChannel).reduce((total, count) => total + count, 0) !==
                  result.differingBytes
              ) {
                throw new Error('Premultiplied frame comparison accounting is inconsistent');
              }
              return result;
            };
            const syntheticExpected = new Uint8ClampedArray(3 * 3 * 4);
            const syntheticReceived = new Uint8ClampedArray(3 * 3 * 4);
            for (let pixel = 0; pixel < 3 * 3; pixel += 1) {
              const offset = pixel * 4;
              syntheticExpected.set([100, 100, 100, 128], offset);
              syntheticReceived.set([100, 100, 100, 128], offset);
            }
            syntheticReceived.set([101, 101, 100, 128], 0);
            syntheticReceived.set([100, 100, 100, 255], 4);
            syntheticExpected.set([0, 0, 0, 0], 8 * 4);
            syntheticReceived.set([0, 0, 0, 255], 8 * 4);
            const syntheticComparison = comparePremultipliedFramePixels(
              syntheticExpected,
              syntheticReceived,
              3,
              3,
              40,
              -3
            );
            if (
              syntheticComparison.differingBytes !== 7 ||
              syntheticComparison.differingPixels !== 3 ||
              syntheticComparison.differingBytesByChannel.r !== 2 ||
              syntheticComparison.differingBytesByChannel.g !== 2 ||
              syntheticComparison.differingBytesByChannel.b !== 1 ||
              syntheticComparison.differingBytesByChannel.a !== 2 ||
              syntheticComparison.alphaBoundaryDifferingPixels !== 1 ||
              syntheticComparison.nonBoundaryDifferingPixels !== 2 ||
              syntheticComparison.differingSamples.length !== 3 ||
              syntheticComparison.differingSamples[0]?.legacyAlphaBoundary !== false ||
              syntheticComparison.differingSamples[0]?.durableAlphaBoundary !== true ||
              syntheticComparison.differingSamples[0]?.alphaBoundaryDifference !== true ||
              syntheticComparison.differingSamples[0]?.differingChannels.join(',') !== 'r,g' ||
              syntheticComparison.differingSamples[0]?.legacyAlphaNeighborhood[0] !== null ||
              syntheticComparison.differingSamples[0]?.legacyAlphaNeighborhood[5] !== 128 ||
              syntheticComparison.differingSamples[0]?.durableAlphaNeighborhood[5] !== 255 ||
              syntheticComparison.differingSamples[0]?.x !== 0 ||
              syntheticComparison.differingSamples[0]?.y !== 0 ||
              syntheticComparison.differingSamples[0]?.documentX !== 40 ||
              syntheticComparison.differingSamples[0]?.documentY !== -3 ||
              syntheticComparison.differingSamples[1]?.alphaBoundaryDifference !== false ||
              syntheticComparison.differingSamples[1]?.differingChannels.join(',') !== 'r,g,b,a' ||
              syntheticComparison.differingSamples[2]?.alphaBoundaryDifference !== false ||
              syntheticComparison.differingSamples[2]?.differingChannels.join(',') !== 'a'
            ) {
              throw new Error('Premultiplied frame comparison failed its synthetic accounting check');
            }
            for (let byte = 0; byte < legacyFramePixels.length; byte += 1) {
              const legacy = legacyFramePixels[byte] ?? null;
              const durable = durableFramePixels[byte] ?? null;
              const pixel = Math.floor(byte / 4);
              if (legacyOffscreenPixels[byte] !== durableOffscreenPixels[byte]) {
                offscreenFrameDifferingBytes += 1;
                if (pixel !== lastOffscreenFrameDifferingPixel) {
                  offscreenFrameDifferingPixels += 1;
                  if (
                    !isFrameAlphaBoundaryDifference(
                      legacyOffscreenPixels,
                      durableOffscreenPixels,
                      pixel,
                      frameSize.width,
                      frameSize.height
                    )
                  ) {
                    offscreenFrameNonEdgeDifferingPixels += 1;
                  }
                  lastOffscreenFrameDifferingPixel = pixel;
                }
                if (offscreenFrameDifferingSamples.length < 8) {
                  const x = pixel % frameSize.width;
                  const y = Math.floor(pixel / frameSize.width);
                  offscreenFrameDifferingSamples.push({
                    x,
                    y,
                    documentX: frame.x + x,
                    documentY: frame.y + y,
                    channel: frameChannels[byte % 4],
                    legacy: legacyOffscreenPixels[byte] ?? null,
                    durable: durableOffscreenPixels[byte] ?? null,
                  });
                }
              }
              if (legacy === durable) continue;
              frameDifferingBytes += 1;
              if (pixel !== lastFrameDifferingPixel) {
                frameDifferingPixels += 1;
                if (
                  !isFrameAlphaBoundaryDifference(
                    legacyFramePixels,
                    durableFramePixels,
                    pixel,
                    frameSize.width,
                    frameSize.height
                  )
                ) {
                  frameNonEdgeDifferingPixels += 1;
                }
                lastFrameDifferingPixel = pixel;
              }
              if (frameDifferingSamples.length < 8) {
                const x = pixel % frameSize.width;
                const y = Math.floor(pixel / frameSize.width);
                frameDifferingSamples.push({
                  x,
                  y,
                  documentX: frame.x + x,
                  documentY: frame.y + y,
                  channel: frameChannels[byte % 4],
                  legacy,
                  durable,
                });
              }
            }
            const framePremultipliedComparison = comparePremultipliedFramePixels(legacyFramePixels, durableFramePixels);
            const offscreenFramePremultipliedComparison = comparePremultipliedFramePixels(
              legacyOffscreenPixels,
              durableOffscreenPixels
            );
            const opaqueBackdropComparison = fixture.diagnoseOpaqueBackdrop
              ? (() => {
                  const offscreenAvailable = typeof OffscreenCanvas !== 'undefined';
                  const createOpaqueBackdropSurfaces = (label: string) => {
                    const surfaces = createComparisonSurfaces(label, frameSize.width, frameSize.height);
                    const contexts = [surfaces.htmlContext];
                    if (offscreenAvailable) contexts.push(surfaces.offscreenContext as CanvasRenderingContext2D);
                    // Match the fixture's unchanged, fully opaque background layer under the foreground.
                    for (const context of contexts) {
                      context.setTransform(1, 0, 0, 1, 0, 0);
                      context.globalAlpha = 1;
                      context.globalCompositeOperation = 'source-over';
                      context.imageSmoothingEnabled = false;
                      context.clearRect(0, 0, frameSize.width, frameSize.height);
                      context.fillStyle = '#5070a0';
                      context.fillRect(0, 0, frameSize.width, frameSize.height);
                    }
                    return surfaces;
                  };
                  const legacyOpaqueSurfaces = createOpaqueBackdropSurfaces('legacy opaque backdrop');
                  const durableOpaqueSurfaces = createOpaqueBackdropSurfaces('durable opaque backdrop');
                  if (!drawLayer(legacyOpaqueSurfaces.htmlContext, legacyLayer, frame)) {
                    throw new Error(`Legacy renderer refused ${layerId} opaque-backdrop comparison at ${stage}`);
                  }
                  if (
                    offscreenAvailable &&
                    !drawLayer(legacyOpaqueSurfaces.offscreenContext as CanvasRenderingContext2D, legacyLayer, frame)
                  ) {
                    throw new Error(`Legacy renderer refused ${layerId} OffscreenCanvas opaque comparison at ${stage}`);
                  }
                  const durableOpaqueContexts = [durableOpaqueSurfaces.htmlContext];
                  if (offscreenAvailable) {
                    durableOpaqueContexts.push(durableOpaqueSurfaces.offscreenContext as CanvasRenderingContext2D);
                  }
                  for (const context of durableOpaqueContexts) {
                    context.globalAlpha = materializedLayer.opacity;
                    context.globalCompositeOperation = materializedLayer.blendMode;
                    context.drawImage(
                      materializedLayer.bitmap as CanvasImageSource,
                      materializedLayer.bounds.x - frame.x,
                      materializedLayer.bounds.y - frame.y,
                      materializedLayer.bounds.width,
                      materializedLayer.bounds.height
                    );
                  }
                  const compareOpaquePixels = (
                    expected: Uint8ClampedArray,
                    received: Uint8ClampedArray,
                    originX: number,
                    originY: number
                  ): CropParityOpaqueBackdropSurfaceComparison => {
                    const expectedLength = frameSize.width * frameSize.height * 4;
                    if (expected.length !== expectedLength || received.length !== expectedLength) {
                      throw new Error(
                        `Opaque backdrop comparison has ${expected.length}/${received.length} bytes; expected ${expectedLength} for ${frameSize.width}x${frameSize.height}`
                      );
                    }
                    let differingBytes = 0;
                    let differingPixels = 0;
                    const differingBytesByChannel: Record<CropParityFrameChannel, number> = {
                      r: 0,
                      g: 0,
                      b: 0,
                      a: 0,
                    };
                    const differingSamples: CropParityOpaqueBackdropSample[] = [];
                    for (let pixel = 0; pixel < frameSize.width * frameSize.height; pixel += 1) {
                      const offset = pixel * 4;
                      const legacyRgba: CropParityRgba = [
                        expected[offset]!,
                        expected[offset + 1]!,
                        expected[offset + 2]!,
                        expected[offset + 3]!,
                      ];
                      const durableRgba: CropParityRgba = [
                        received[offset]!,
                        received[offset + 1]!,
                        received[offset + 2]!,
                        received[offset + 3]!,
                      ];
                      if (legacyRgba[3] !== 255 || durableRgba[3] !== 255) {
                        throw new Error(`Opaque backdrop did not cover ${layerId} frame pixel ${pixel} at ${stage}`);
                      }
                      const differingChannels = frameChannels.filter(
                        (_, channelIndex) => legacyRgba[channelIndex] !== durableRgba[channelIndex]
                      );
                      if (differingChannels.length === 0) continue;
                      differingPixels += 1;
                      differingBytes += differingChannels.length;
                      for (const channel of differingChannels) differingBytesByChannel[channel] += 1;
                      if (differingSamples.length < 8) {
                        const x = pixel % frameSize.width;
                        const y = Math.floor(pixel / frameSize.width);
                        differingSamples.push({
                          x,
                          y,
                          documentX: originX + x,
                          documentY: originY + y,
                          legacyRgba,
                          durableRgba,
                          differingChannels,
                        });
                      }
                    }
                    if (
                      Object.values(differingBytesByChannel).reduce((total, count) => total + count, 0) !==
                      differingBytes
                    ) {
                      throw new Error('Opaque backdrop comparison accounting is inconsistent');
                    }
                    return { differingBytes, differingPixels, differingBytesByChannel, differingSamples };
                  };
                  const htmlLegacyPixels = legacyOpaqueSurfaces.htmlContext.getImageData(
                    0,
                    0,
                    frameSize.width,
                    frameSize.height
                  ).data;
                  const durableHtmlPixels = durableOpaqueSurfaces.htmlContext.getImageData(
                    0,
                    0,
                    frameSize.width,
                    frameSize.height
                  ).data;
                  const legacyOffscreenPixels = offscreenAvailable
                    ? legacyOpaqueSurfaces.offscreenContext.getImageData(0, 0, frameSize.width, frameSize.height).data
                    : null;
                  const durableOffscreenPixels = offscreenAvailable
                    ? durableOpaqueSurfaces.offscreenContext.getImageData(0, 0, frameSize.width, frameSize.height).data
                    : null;
                  return {
                    backdropColor: '#5070a0' as const,
                    offscreenAvailable,
                    html: compareOpaquePixels(htmlLegacyPixels, durableHtmlPixels, frame.x, frame.y),
                    offscreen:
                      legacyOffscreenPixels && durableOffscreenPixels
                        ? compareOpaquePixels(legacyOffscreenPixels, durableOffscreenPixels, frame.x, frame.y)
                        : null,
                  };
                })()
              : null;
            return {
              layerId,
              stage,
              positions: {
                legacy: legacyLayer.pos,
                durable: durableLayer.snapshot.pos,
              },
              compositing: {
                legacyOpacity: legacyLayer.opacity,
                durableOpacity: materializedLayer.opacity,
                legacyBlendMode: legacyLayer.blendMode,
                durableBlendMode: materializedLayer.blendMode,
              },
              affineTransforms: {
                legacy: legacyLayer.operations
                  .filter(
                    (operation: { kind: string; enabled: boolean; transform: CropParityAffineTransform }) =>
                      operation.kind === 'affine-transform' && operation.enabled
                  )
                  .map((operation: { transform: CropParityAffineTransform }) => operation.transform),
                durable: durableLayer.operations
                  .filter(
                    (operation: { kind: string; transform: CropParityAffineTransform }) =>
                      operation.kind === 'apply-affine-transform'
                  )
                  .map((operation: { transform: CropParityAffineTransform }) => operation.transform),
              },
              expectedBounds,
              materializedBounds: materializedLayer.bounds,
              bitmapSize: {
                width: materializedLayer.bitmap.width,
                height: materializedLayer.bitmap.height,
              },
              frameDifferingBytes,
              framePremultipliedDifferingBytes: framePremultipliedComparison.differingBytes,
              framePremultipliedDifferingPixels: framePremultipliedComparison.differingPixels,
              framePremultipliedDifferingBytesByChannel: framePremultipliedComparison.differingBytesByChannel,
              framePremultipliedAlphaBoundaryDifferingPixels: framePremultipliedComparison.alphaBoundaryDifferingPixels,
              framePremultipliedNonBoundaryDifferingPixels: framePremultipliedComparison.nonBoundaryDifferingPixels,
              framePremultipliedDifferingSamples: framePremultipliedComparison.differingSamples,
              offscreenFrameDifferingBytes,
              offscreenFramePremultipliedDifferingBytes: offscreenFramePremultipliedComparison.differingBytes,
              offscreenFramePremultipliedDifferingPixels: offscreenFramePremultipliedComparison.differingPixels,
              offscreenFramePremultipliedDifferingBytesByChannel:
                offscreenFramePremultipliedComparison.differingBytesByChannel,
              offscreenFramePremultipliedAlphaBoundaryDifferingPixels:
                offscreenFramePremultipliedComparison.alphaBoundaryDifferingPixels,
              offscreenFramePremultipliedNonBoundaryDifferingPixels:
                offscreenFramePremultipliedComparison.nonBoundaryDifferingPixels,
              offscreenFramePremultipliedDifferingSamples: offscreenFramePremultipliedComparison.differingSamples,
              opaqueBackdropComparison,
              frameDifferingPixels,
              frameNonEdgeDifferingPixels,
              offscreenFrameDifferingPixels,
              offscreenFrameNonEdgeDifferingPixels,
              frameDifferingSamples,
              offscreenFrameDifferingSamples,
              tightBitmapRawDifferingBytes: tightBitmapRawComparison.differingBytes,
              tightBitmapRawDifferingSamples: tightBitmapRawComparison.differingSamples,
              downstreamInvertReadbackDifferingBytes: downstreamInvertReadbackComparisons?.html.differingBytes ?? null,
              downstreamInvertReadbackDifferingSamples:
                downstreamInvertReadbackComparisons?.html.differingSamples ?? [],
              offscreenDownstreamInvertReadbackDifferingBytes:
                downstreamInvertReadbackComparisons?.offscreen.differingBytes ?? null,
              offscreenDownstreamInvertReadbackDifferingSamples:
                downstreamInvertReadbackComparisons?.offscreen.differingSamples ?? [],
              offscreenTightBitmapRawDifferingBytes: offscreenTightBitmapRawComparison.differingBytes,
              offscreenTightBitmapRawDifferingSamples: offscreenTightBitmapRawComparison.differingSamples,
              tightBitmapPremultipliedDifferingBytes: tightBitmapComparison.differingBytes,
              tightBitmapDifferingPixels: tightBitmapComparison.differingPixels,
              tightBitmapNonEdgeDifferingPixels: tightBitmapComparison.nonEdgeDifferingPixels,
              offscreenTightBitmapPremultipliedDifferingBytes: offscreenTightBitmapComparison.differingBytes,
              offscreenTightBitmapDifferingPixels: offscreenTightBitmapComparison.differingPixels,
              offscreenTightBitmapNonEdgeDifferingPixels: offscreenTightBitmapComparison.nonEdgeDifferingPixels,
              tightBitmapDifferingSamples: tightBitmapComparison.differingSamples,
              offscreenTightBitmapDifferingSamples: offscreenTightBitmapComparison.differingSamples,
            };
          });
          const projectedOutputParity = fixture.verifyProjectedOutputs
            ? await (async () => {
                const projection = projectDurableRender(replay, {
                  status: 'durable',
                  materializedLayers: composite.layers,
                });
                const projectionCanvas = document.createElement('canvas');
                const projectedLayers = (Object.values(projection.layers) as Layer[]).sort(
                  (left, right) => left.order - right.order
                );
                if (!drawLayersToCanvas(projectionCanvas, projectedLayers, projection.frame)) {
                  throw new Error(`Durable projection renderer refused ${fixture.caseName} at ${stage}`);
                }
                const projectionContext = projectionCanvas.getContext('2d');
                if (!projectionContext) throw new Error(`Durable projection has no 2D context at ${stage}`);
                const projectedPixels = Array.from(
                  projectionContext.getImageData(0, 0, projectionCanvas.width, projectionCanvas.height).data
                ) as number[];
                const compareBytes = (
                  expected: number[],
                  received: number[],
                  width: number,
                  height: number,
                  originX: number,
                  originY: number
                ) => {
                  const expectedLength = width * height * 4;
                  if (expected.length !== expectedLength || received.length !== expectedLength) {
                    throw new Error(
                      `Runtime/export pixel surface at ${stage} has ${expected.length}/${received.length} bytes; expected ${expectedLength} for ${width}x${height}`
                    );
                  }
                  let surfaceDifferingBytes = 0;
                  let surfaceDifferingPixels = 0;
                  let lastSurfaceDifferingPixel = -1;
                  let surfaceMaxChannelDelta = 0;
                  let minX = Number.POSITIVE_INFINITY;
                  let minY = Number.POSITIVE_INFINITY;
                  let maxX = Number.NEGATIVE_INFINITY;
                  let maxY = Number.NEGATIVE_INFINITY;
                  const rgbaChannels = ['r', 'g', 'b', 'a'] as const;
                  const surfaceDifferingSamples: Array<{
                    offset: number;
                    x: number;
                    y: number;
                    documentX: number;
                    documentY: number;
                    expected: number | null;
                    received: number | null;
                    expectedRgba: readonly (number | null)[];
                    receivedRgba: readonly (number | null)[];
                    expectedAlpha: number | null;
                    receivedAlpha: number | null;
                    differingChannels: Array<(typeof rgbaChannels)[number]>;
                  }> = [];
                  const sampleByPixel = new Map<number, (typeof surfaceDifferingSamples)[number]>();
                  const readRgba = (pixels: number[], byteOffset: number) =>
                    Array.from({ length: 4 }, (_, channel) => pixels[byteOffset + channel] ?? null);
                  for (let offset = 0; offset < Math.max(expected.length, received.length); offset += 1) {
                    const expectedByte = expected[offset] ?? null;
                    const receivedByte = received[offset] ?? null;
                    if (expectedByte === receivedByte) continue;
                    surfaceDifferingBytes += 1;
                    const pixel = Math.floor(offset / 4);
                    // Pixel indices identify cell origins; preserve the frame's fractional document origin.
                    const x = pixel % width;
                    const y = Math.floor(pixel / width);
                    if (pixel !== lastSurfaceDifferingPixel) {
                      surfaceDifferingPixels += 1;
                      lastSurfaceDifferingPixel = pixel;
                      minX = Math.min(minX, x);
                      minY = Math.min(minY, y);
                      maxX = Math.max(maxX, x);
                      maxY = Math.max(maxY, y);
                    }
                    surfaceMaxChannelDelta = Math.max(
                      surfaceMaxChannelDelta,
                      expectedByte === null || receivedByte === null ? 255 : Math.abs(expectedByte - receivedByte)
                    );
                    const existingSample = sampleByPixel.get(pixel);
                    if (existingSample) {
                      const channel = rgbaChannels[offset % 4];
                      if (!existingSample.differingChannels.includes(channel)) {
                        existingSample.differingChannels.push(channel);
                      }
                    } else if (surfaceDifferingSamples.length < 8) {
                      const expectedRgba = readRgba(expected, pixel * 4);
                      const receivedRgba = readRgba(received, pixel * 4);
                      const sample = {
                        offset,
                        x,
                        y,
                        documentX: originX + x,
                        documentY: originY + y,
                        expected: expectedByte,
                        received: receivedByte,
                        expectedRgba,
                        receivedRgba,
                        expectedAlpha: expectedRgba[3] ?? null,
                        receivedAlpha: receivedRgba[3] ?? null,
                        differingChannels: [rgbaChannels[offset % 4]],
                      };
                      sampleByPixel.set(pixel, sample);
                      surfaceDifferingSamples.push(sample);
                    }
                  }
                  return {
                    expectedByteLength: expected.length,
                    receivedByteLength: received.length,
                    differingBytes: surfaceDifferingBytes,
                    differingPixels: surfaceDifferingPixels,
                    maxChannelDelta: surfaceMaxChannelDelta,
                    differingBounds:
                      surfaceDifferingPixels === 0
                        ? null
                        : {
                            x: minX,
                            y: minY,
                            documentX: originX + minX,
                            documentY: originY + minY,
                            width: maxX - minX + 1,
                            height: maxY - minY + 1,
                          },
                    differingSamples: surfaceDifferingSamples,
                  };
                };
                const encodeBase64 = (bytes: Uint8Array) => {
                  let binary = '';
                  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                  }
                  return btoa(binary);
                };
                const encodeCanvasPng = async (canvas: HTMLCanvasElement, label: string) => {
                  const blob = await new Promise<Blob | null>((resolve) => {
                    canvas.toBlob(resolve, 'image/png');
                  });
                  if (!blob) throw new Error(`${label} did not encode to PNG at ${stage}`);
                  return encodeBase64(new Uint8Array(await blob.arrayBuffer()));
                };
                const exportRecords = durableExportRecords(replay, composite);
                const legacyExportCanvas = renderExportCanvas(legacyReplay.layers, { width: 64, height: 64 }, frame);
                const durableExportCanvas = renderExportCanvas(
                  exportRecords.layers,
                  exportRecords.size,
                  exportRecords.frame
                );
                const legacyExportContext = legacyExportCanvas.getContext('2d');
                const durableExportContext = durableExportCanvas.getContext('2d');
                if (!legacyExportContext || !durableExportContext) {
                  throw new Error(`Export parity surfaces have no 2D context at ${stage}`);
                }
                const legacyExportPixels = Array.from(
                  legacyExportContext.getImageData(0, 0, legacyExportCanvas.width, legacyExportCanvas.height).data
                ) as number[];
                const durableExportPixels = Array.from(
                  durableExportContext.getImageData(0, 0, durableExportCanvas.width, durableExportCanvas.height).data
                ) as number[];
                const runtimePixelComparison = compareBytes(
                  legacyPixels,
                  projectedPixels,
                  frameSize.width,
                  frameSize.height,
                  frame.x,
                  frame.y
                );
                const exportCanvasPixelComparison = compareBytes(
                  legacyExportPixels,
                  durableExportPixels,
                  frameSize.width,
                  frameSize.height,
                  frame.x,
                  frame.y
                );
                const layerIds = fixture.layers.map(({ id }) => id);
                const projectedLayerRecords = Object.fromEntries(
                  layerIds.map((id) => {
                    const layer = projection.layers[id];
                    const replayLayer = replay.layers[id];
                    const materialized = composite.layers[id];
                    if (!layer || !replayLayer || !materialized) {
                      throw new Error(`Missing durable projection metadata for ${id} at ${stage}`);
                    }
                    return [
                      id,
                      {
                        id: layer.id,
                        name: layer.name,
                        visible: layer.visible,
                        opacity: layer.opacity,
                        blendMode: layer.blendMode,
                        order: layer.order,
                        pos: layer.pos,
                        expectedPos: replayLayer.snapshot.pos,
                        presentationBounds: layer.presentationBounds,
                        expectedPresentationBounds: materialized.bounds,
                        operationsLength: layer.operations.length,
                      },
                    ];
                  })
                );
                const exportLayerRecords = Object.fromEntries(
                  layerIds.map((id) => {
                    const layer = exportRecords.layers[id];
                    const materialized = composite.layers[id];
                    if (!layer || !materialized)
                      throw new Error(`Missing durable export metadata for ${id} at ${stage}`);
                    return [
                      id,
                      {
                        id: layer.id,
                        name: layer.name,
                        visible: layer.visible,
                        opacity: layer.opacity,
                        blendMode: layer.blendMode,
                        order: layer.order,
                        pos: layer.pos,
                        expectedPos: materialized.bounds,
                        presentationBounds: layer.presentationBounds,
                        operationsLength: layer.operations.length,
                      },
                    ];
                  })
                );
                const eligibilityReasons = Object.fromEntries(
                  layerIds.map((id) => {
                    const replayLayer = replay.layers[id];
                    const legacyLayer = legacyReplay.layers[id];
                    const materialized = composite.layers[id];
                    if (!replayLayer || !legacyLayer || !materialized) {
                      throw new Error(`Missing durable export eligibility input for ${id} at ${stage}`);
                    }
                    return [id, durableLayerPresentationMismatch(replayLayer, legacyLayer, materialized.bounds)];
                  })
                );
                const expectedPsdLayerBounds = Object.fromEntries(
                  fixture.layers.map(({ id }) => {
                    const bounds = composite.layers[id]?.bounds;
                    if (!bounds) throw new Error(`Missing materialized PSD bounds for ${id} at ${stage}`);
                    const localX = bounds.x - frame.x;
                    const localY = bounds.y - frame.y;
                    const left = Math.floor(localX);
                    const top = Math.floor(localY);
                    return [
                      id,
                      {
                        left,
                        top,
                        right: Math.ceil(localX + bounds.width),
                        bottom: Math.ceil(localY + bounds.height),
                      },
                    ];
                  })
                );
                const psdPreEncodeLayers = Object.fromEntries(
                  await Promise.all(
                    fixture.layers.map(async ({ id }) => {
                      const legacyLayer = legacyReplay.layers[id];
                      const durableLayer = exportRecords.layers[id];
                      if (!legacyLayer || !durableLayer) {
                        throw new Error(`Missing PSD pre-encode layer ${id} at ${stage}`);
                      }
                      const renderPsdLayerRaster = (layer: (typeof legacyReplay.layers)[string], label: string) => {
                        const presentation = getLayerPresentationBounds(layer);
                        const localX = presentation.x - frame.x;
                        const localY = presentation.y - frame.y;
                        const left = Math.floor(localX);
                        const top = Math.floor(localY);
                        const width = Math.ceil(localX + presentation.width) - left;
                        const height = Math.ceil(localY + presentation.height) - top;
                        const source = layer.tmpCanvas ?? layer.bitmap;
                        const canvas = document.createElement('canvas');
                        canvas.width = source ? width : 1;
                        canvas.height = source ? height : 1;
                        const context = canvas.getContext('2d');
                        if (!context) throw new Error(`${label} PSD pre-encode raster has no 2D context at ${stage}`);
                        // Mirror savePsd's integer-bound rasterization immediately before writePsd().
                        if (
                          source &&
                          !drawLayerSource(context, layer, layer.pos, {
                            x: frame.x + left,
                            y: frame.y + top,
                            width,
                            height,
                          })
                        ) {
                          throw new Error(`${label} PSD pre-encode raster refused ${id} at ${stage}`);
                        }
                        return {
                          bounds: { left, top, right: left + width, bottom: top + height },
                          rasterSize: { width: canvas.width, height: canvas.height },
                          pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) as number[],
                        };
                      };
                      const legacy = renderPsdLayerRaster(legacyLayer, 'Legacy');
                      const durable = renderPsdLayerRaster(durableLayer, 'Durable');
                      const frameGridPadding = 2;
                      const paddedFrameSize = {
                        width: frameSize.width + frameGridPadding * 2,
                        height: frameSize.height + frameGridPadding * 2,
                      };
                      const renderLayerSurfacePixels = (
                        layer: (typeof legacyReplay.layers)[string],
                        label: string,
                        targetFrame: typeof frame,
                        pixelSize: typeof frameSize
                      ) => {
                        const canvas = document.createElement('canvas');
                        canvas.width = pixelSize.width;
                        canvas.height = pixelSize.height;
                        const context = canvas.getContext('2d');
                        if (!context) throw new Error(`${label} PSD diagnostic has no 2D context at ${stage}`);
                        if (!drawLayerSource(context, layer, layer.pos, targetFrame)) {
                          throw new Error(`${label} PSD diagnostic refused ${id} at ${stage}`);
                        }
                        return context.getImageData(0, 0, pixelSize.width, pixelSize.height).data;
                      };
                      const renderFrameLayerPixels = (layer: (typeof legacyReplay.layers)[string], label: string) =>
                        renderLayerSurfacePixels(layer, label, frame, frameSize);
                      const originShiftedTargetFrame = {
                        ...frame,
                        x: frame.x - frameGridPadding,
                        y: frame.y - frameGridPadding,
                      };
                      const renderOriginShiftedFrameLayerPixels = (
                        layer: (typeof legacyReplay.layers)[string],
                        label: string
                      ) => renderLayerSurfacePixels(layer, label, originShiftedTargetFrame, frameSize);
                      const renderExpandedFrameLayerPixels = (
                        layer: (typeof legacyReplay.layers)[string],
                        label: string
                      ) => renderLayerSurfacePixels(layer, label, frame, paddedFrameSize);
                      const renderPaddedFrameLayerPixels = (
                        layer: (typeof legacyReplay.layers)[string],
                        label: string
                      ) => {
                        return renderLayerSurfacePixels(layer, label, originShiftedTargetFrame, paddedFrameSize);
                      };
                      const readPixelRegion = (
                        pixels: Uint8ClampedArray,
                        sourceSize: typeof frameSize,
                        x: number,
                        y: number,
                        width: number,
                        height: number
                      ) => {
                        if (
                          pixels.length !== sourceSize.width * sourceSize.height * 4 ||
                          x < 0 ||
                          y < 0 ||
                          width < 0 ||
                          height < 0 ||
                          x + width > sourceSize.width ||
                          y + height > sourceSize.height
                        ) {
                          throw new Error(
                            `PSD diagnostic pixel region is outside its ${sourceSize.width}x${sourceSize.height} source at ${stage}`
                          );
                        }
                        const region = new Uint8ClampedArray(width * height * 4);
                        for (let row = 0; row < height; row += 1) {
                          const sourceStart = ((y + row) * sourceSize.width + x) * 4;
                          const regionStart = row * width * 4;
                          region.set(pixels.slice(sourceStart, sourceStart + width * 4), regionStart);
                        }
                        return region;
                      };
                      type DiagnosticPixelSurface = {
                        pixels: Uint8ClampedArray;
                        pixelSize: typeof frameSize;
                        originOffset: { x: number; y: number };
                      };
                      const getSharedDocumentRegion = (surfaces: readonly DiagnosticPixelSurface[]) => {
                        const left = Math.max(...surfaces.map(({ originOffset }) => originOffset.x));
                        const top = Math.max(...surfaces.map(({ originOffset }) => originOffset.y));
                        const right = Math.min(
                          ...surfaces.map(({ originOffset, pixelSize }) => originOffset.x + pixelSize.width)
                        );
                        const bottom = Math.min(
                          ...surfaces.map(({ originOffset, pixelSize }) => originOffset.y + pixelSize.height)
                        );
                        return {
                          x: left,
                          y: top,
                          width: Math.max(0, right - left),
                          height: Math.max(0, bottom - top),
                        };
                      };
                      const compareRasterOverlap = (
                        expected: DiagnosticPixelSurface,
                        received: DiagnosticPixelSurface
                      ) => {
                        const region = getSharedDocumentRegion([expected, received]);
                        const comparedPixels = region.width * region.height;
                        const measured = comparedPixels > 0;
                        const expectedOffset = {
                          x: region.x - expected.originOffset.x,
                          y: region.y - expected.originOffset.y,
                        };
                        const receivedOffset = {
                          x: region.x - received.originOffset.x,
                          y: region.y - received.originOffset.y,
                        };
                        return {
                          measurementStatus: measured ? 'measured' : 'empty-region',
                          comparedPixels,
                          documentRegionLocal: region,
                          expectedPixelOffset: expectedOffset,
                          receivedPixelOffset: receivedOffset,
                          expectedExcludedPixels: expected.pixelSize.width * expected.pixelSize.height - comparedPixels,
                          receivedExcludedPixels: received.pixelSize.width * received.pixelSize.height - comparedPixels,
                          pixelComparison: measured
                            ? compareBytes(
                                Array.from(
                                  readPixelRegion(
                                    expected.pixels,
                                    expected.pixelSize,
                                    expectedOffset.x,
                                    expectedOffset.y,
                                    region.width,
                                    region.height
                                  )
                                ),
                                Array.from(
                                  readPixelRegion(
                                    received.pixels,
                                    received.pixelSize,
                                    receivedOffset.x,
                                    receivedOffset.y,
                                    region.width,
                                    region.height
                                  )
                                ),
                                region.width,
                                region.height,
                                frame.x + region.x,
                                frame.y + region.y
                              )
                            : null,
                        };
                      };
                      const cropDiagnosticSurface = (
                        surface: DiagnosticPixelSurface,
                        documentRegion: { x: number; y: number; width: number; height: number }
                      ): DiagnosticPixelSurface => ({
                        pixels: readPixelRegion(
                          surface.pixels,
                          surface.pixelSize,
                          documentRegion.x - surface.originOffset.x,
                          documentRegion.y - surface.originOffset.y,
                          documentRegion.width,
                          documentRegion.height
                        ),
                        pixelSize: { width: documentRegion.width, height: documentRegion.height },
                        originOffset: { x: documentRegion.x, y: documentRegion.y },
                      });
                      const countNonTransparentPixelsOutsideFrame = (
                        pixels: Uint8ClampedArray,
                        pixelSize: typeof frameSize,
                        originOffset: { x: number; y: number } = { x: 0, y: 0 }
                      ) => {
                        if (pixels.length !== pixelSize.width * pixelSize.height * 4) {
                          throw new Error(`Expanded PSD diagnostic has an unexpected byte length at ${stage}`);
                        }
                        let comparedPixels = 0;
                        let nonTransparentPixels = 0;
                        for (let y = 0; y < pixelSize.height; y += 1) {
                          for (let x = 0; x < pixelSize.width; x += 1) {
                            const frameX = x + originOffset.x;
                            const frameY = y + originOffset.y;
                            if (frameX >= 0 && frameX < frameSize.width && frameY >= 0 && frameY < frameSize.height) {
                              continue;
                            }
                            comparedPixels += 1;
                            if (pixels[(y * pixelSize.width + x) * 4 + 3] !== 0) nonTransparentPixels += 1;
                          }
                        }
                        return {
                          measurementStatus: comparedPixels > 0 ? 'measured' : 'empty-region',
                          comparedPixels,
                          nonTransparentPixels,
                        };
                      };
                      const compareOriginExtentInteraction = (
                        baseline: DiagnosticPixelSurface,
                        originOnly: DiagnosticPixelSurface,
                        extentOnly: DiagnosticPixelSurface,
                        combined: DiagnosticPixelSurface
                      ) => {
                        const region = getSharedDocumentRegion([baseline, originOnly, extentOnly, combined]);
                        const comparedPixels = region.width * region.height;
                        let differingBytes = 0;
                        let differingPixels = 0;
                        let maxAbsoluteChannelDelta = 0;
                        const differingSamples: Array<Record<string, unknown>> = [];
                        const pixelOffset = (surface: DiagnosticPixelSurface, x: number, y: number) =>
                          ((y - surface.originOffset.y) * surface.pixelSize.width + x - surface.originOffset.x) * 4;
                        for (let y = region.y; y < region.y + region.height; y += 1) {
                          for (let x = region.x; x < region.x + region.width; x += 1) {
                            const frameOffset = pixelOffset(baseline, x, y);
                            const originOffset = pixelOffset(originOnly, x, y);
                            const extentOffset = pixelOffset(extentOnly, x, y);
                            const combinedOffset = pixelOffset(combined, x, y);
                            const originShiftDelta = [0, 1, 2, 3].map(
                              (channel) =>
                                originOnly.pixels[originOffset + channel]! - baseline.pixels[frameOffset + channel]!
                            );
                            const expandedOriginShiftDelta = [0, 1, 2, 3].map(
                              (channel) =>
                                combined.pixels[combinedOffset + channel]! - extentOnly.pixels[extentOffset + channel]!
                            );
                            const differenceOfDifferences = originShiftDelta.map(
                              (delta, channel) => delta - expandedOriginShiftDelta[channel]!
                            );
                            const changedChannels = differenceOfDifferences.filter((delta) => delta !== 0).length;
                            if (changedChannels === 0) continue;
                            differingBytes += changedChannels;
                            differingPixels += 1;
                            maxAbsoluteChannelDelta = Math.max(
                              maxAbsoluteChannelDelta,
                              ...differenceOfDifferences.map(Math.abs)
                            );
                            if (differingSamples.length < 8) {
                              differingSamples.push({
                                x,
                                y,
                                documentX: frame.x + x,
                                documentY: frame.y + y,
                                originShiftDelta,
                                expandedOriginShiftDelta,
                                differenceOfDifferences,
                              });
                            }
                          }
                        }
                        return {
                          measurementStatus: comparedPixels > 0 ? 'measured' : 'empty-region',
                          comparedPixels,
                          excludedFramePixels: frameSize.width * frameSize.height - comparedPixels,
                          documentRegionLocal: region,
                          differingBytes,
                          differingPixels,
                          maxAbsoluteChannelDelta,
                          differingSamples,
                        };
                      };
                      const compareWidthHeightExtentInteraction = (
                        baseline: DiagnosticPixelSurface,
                        widthOnly: DiagnosticPixelSurface,
                        heightOnly: DiagnosticPixelSurface,
                        bothAxes: DiagnosticPixelSurface
                      ) => {
                        const region = getSharedDocumentRegion([baseline, widthOnly, heightOnly, bothAxes]);
                        const comparedPixels = region.width * region.height;
                        let differingBytes = 0;
                        let differingPixels = 0;
                        let maxAbsoluteChannelDelta = 0;
                        const differingSamples: Array<Record<string, unknown>> = [];
                        const pixelOffset = (surface: DiagnosticPixelSurface, x: number, y: number) =>
                          ((y - surface.originOffset.y) * surface.pixelSize.width + x - surface.originOffset.x) * 4;
                        for (let y = region.y; y < region.y + region.height; y += 1) {
                          for (let x = region.x; x < region.x + region.width; x += 1) {
                            const baselineOffset = pixelOffset(baseline, x, y);
                            const widthOnlyOffset = pixelOffset(widthOnly, x, y);
                            const heightOnlyOffset = pixelOffset(heightOnly, x, y);
                            const bothAxesOffset = pixelOffset(bothAxes, x, y);
                            const widthDelta = [0, 1, 2, 3].map(
                              (channel) =>
                                widthOnly.pixels[widthOnlyOffset + channel]! -
                                baseline.pixels[baselineOffset + channel]!
                            );
                            const heightDelta = [0, 1, 2, 3].map(
                              (channel) =>
                                heightOnly.pixels[heightOnlyOffset + channel]! -
                                baseline.pixels[baselineOffset + channel]!
                            );
                            const bothAxesDelta = [0, 1, 2, 3].map(
                              (channel) =>
                                bothAxes.pixels[bothAxesOffset + channel]! - baseline.pixels[baselineOffset + channel]!
                            );
                            const differenceOfDifferences = bothAxesDelta.map(
                              (delta, channel) => delta - widthDelta[channel]! - heightDelta[channel]!
                            );
                            const changedChannels = differenceOfDifferences.filter((delta) => delta !== 0).length;
                            if (changedChannels === 0) continue;
                            differingBytes += changedChannels;
                            differingPixels += 1;
                            maxAbsoluteChannelDelta = Math.max(
                              maxAbsoluteChannelDelta,
                              ...differenceOfDifferences.map(Math.abs)
                            );
                            if (differingSamples.length < 8) {
                              differingSamples.push({
                                x,
                                y,
                                documentX: frame.x + x,
                                documentY: frame.y + y,
                                widthDelta,
                                heightDelta,
                                bothAxesDelta,
                                differenceOfDifferences,
                              });
                            }
                          }
                        }
                        return {
                          measurementStatus: comparedPixels > 0 ? 'measured' : 'empty-region',
                          comparedPixels,
                          excludedFramePixels: frameSize.width * frameSize.height - comparedPixels,
                          documentRegionLocal: region,
                          differingBytes,
                          differingPixels,
                          maxAbsoluteChannelDelta,
                          differingSamples,
                        };
                      };
                      const cropPaddedFrameInterior = (paddedPixels: Uint8ClampedArray) => {
                        const expectedLength = paddedFrameSize.width * paddedFrameSize.height * 4;
                        if (paddedPixels.length !== expectedLength) {
                          throw new Error(
                            `Padded-frame diagnostic has ${paddedPixels.length} bytes; expected ${expectedLength} for ${paddedFrameSize.width}x${paddedFrameSize.height}`
                          );
                        }
                        const interior = new Uint8ClampedArray(frameSize.width * frameSize.height * 4);
                        for (let y = 0; y < frameSize.height; y += 1) {
                          const paddedStart = ((y + frameGridPadding) * paddedFrameSize.width + frameGridPadding) * 4;
                          const interiorStart = y * frameSize.width * 4;
                          interior.set(
                            paddedPixels.subarray(paddedStart, paddedStart + frameSize.width * 4),
                            interiorStart
                          );
                        }
                        return interior;
                      };
                      const copyFrameGridToLayerRaster = (
                        framePixels: Uint8ClampedArray,
                        bounds: typeof legacy.bounds,
                        rasterSize: typeof legacy.rasterSize,
                        padding = 0
                      ) => {
                        const sourceWidth = frameSize.width + padding * 2;
                        const sourceHeight = frameSize.height + padding * 2;
                        if (framePixels.length !== sourceWidth * sourceHeight * 4) {
                          throw new Error(
                            `Frame-grid copy has ${framePixels.length} bytes; expected ${sourceWidth * sourceHeight * 4} for ${sourceWidth}x${sourceHeight}`
                          );
                        }
                        const copied = new Uint8ClampedArray(rasterSize.width * rasterSize.height * 4);
                        for (let y = 0; y < rasterSize.height; y += 1) {
                          const frameY = y + bounds.top;
                          const sourceY = frameY + padding;
                          if (sourceY < 0 || sourceY >= sourceHeight) continue;
                          for (let x = 0; x < rasterSize.width; x += 1) {
                            const frameX = x + bounds.left;
                            const sourceX = frameX + padding;
                            if (sourceX < 0 || sourceX >= sourceWidth) continue;
                            const frameOffset = (sourceY * sourceWidth + sourceX) * 4;
                            const rasterOffset = (y * rasterSize.width + x) * 4;
                            copied.set(framePixels.subarray(frameOffset, frameOffset + 4), rasterOffset);
                          }
                        }
                        return copied;
                      };
                      const comparePsdRasterRegion = (
                        expectedPixels: ArrayLike<number>,
                        receivedPixels: ArrayLike<number>,
                        bounds: typeof legacy.bounds,
                        rasterSize: typeof legacy.rasterSize,
                        region: 'in-frame' | 'out-of-frame' | 'padding-ring',
                        padding = 0
                      ) => {
                        const expected = Array.from(expectedPixels);
                        const received = Array.from(receivedPixels);
                        let comparedPixels = 0;
                        for (let y = 0; y < rasterSize.height; y += 1) {
                          for (let x = 0; x < rasterSize.width; x += 1) {
                            const frameX = x + bounds.left;
                            const frameY = y + bounds.top;
                            const inFrame =
                              frameX >= 0 && frameX < frameSize.width && frameY >= 0 && frameY < frameSize.height;
                            const inPaddedFrame =
                              frameX >= -padding &&
                              frameX < frameSize.width + padding &&
                              frameY >= -padding &&
                              frameY < frameSize.height + padding;
                            const included =
                              region === 'in-frame'
                                ? inFrame
                                : region === 'out-of-frame'
                                  ? !inFrame
                                  : inPaddedFrame && !inFrame;
                            if (included) {
                              comparedPixels += 1;
                              continue;
                            }
                            const offset = (y * rasterSize.width + x) * 4;
                            expected.fill(0, offset, offset + 4);
                            received.fill(0, offset, offset + 4);
                          }
                        }
                        const measured = comparedPixels > 0;
                        return {
                          measurementStatus: measured ? 'measured' : 'empty-region',
                          comparedPixels,
                          excludedPixels: rasterSize.width * rasterSize.height - comparedPixels,
                          pixelComparison: measured
                            ? compareBytes(
                                expected,
                                received,
                                rasterSize.width,
                                rasterSize.height,
                                frame.x + bounds.left,
                                frame.y + bounds.top
                              )
                            : null,
                        };
                      };
                      const legacyFramePixels = renderFrameLayerPixels(legacyLayer, 'Legacy');
                      const durableFramePixels = renderFrameLayerPixels(durableLayer, 'Durable');
                      const legacyOriginShiftOnlyPixels = renderOriginShiftedFrameLayerPixels(legacyLayer, 'Legacy');
                      const durableOriginShiftOnlyPixels = renderOriginShiftedFrameLayerPixels(durableLayer, 'Durable');
                      const legacyExtentOnlyPixels = renderExpandedFrameLayerPixels(legacyLayer, 'Legacy');
                      const durableExtentOnlyPixels = renderExpandedFrameLayerPixels(durableLayer, 'Durable');
                      const legacyPaddedFramePixels = renderPaddedFrameLayerPixels(legacyLayer, 'Legacy');
                      const durablePaddedFramePixels = renderPaddedFrameLayerPixels(durableLayer, 'Durable');
                      const legacyPaddedFrameInterior = cropPaddedFrameInterior(legacyPaddedFramePixels);
                      const durablePaddedFrameInterior = cropPaddedFrameInterior(durablePaddedFramePixels);
                      const legacyFrameGridCopy = copyFrameGridToLayerRaster(
                        legacyFramePixels,
                        legacy.bounds,
                        legacy.rasterSize
                      );
                      const durableFrameGridCopy = copyFrameGridToLayerRaster(
                        durableFramePixels,
                        durable.bounds,
                        durable.rasterSize
                      );
                      const legacyPaddedFrameGridCopy = copyFrameGridToLayerRaster(
                        legacyPaddedFramePixels,
                        legacy.bounds,
                        legacy.rasterSize,
                        frameGridPadding
                      );
                      const durablePaddedFrameGridCopy = copyFrameGridToLayerRaster(
                        durablePaddedFramePixels,
                        durable.bounds,
                        durable.rasterSize,
                        frameGridPadding
                      );
                      const sameBounds = (['left', 'top', 'right', 'bottom'] as const).every(
                        (key) => legacy.bounds[key] === durable.bounds[key]
                      );
                      const sameRasterSize =
                        legacy.rasterSize.width === durable.rasterSize.width &&
                        legacy.rasterSize.height === durable.rasterSize.height;
                      const psdBoundsControl =
                        sameBounds && sameRasterSize
                          ? (async () => {
                              const psdBoundsOriginOffset = { x: legacy.bounds.left, y: legacy.bounds.top };
                              const psdBoundsTargetFrame = {
                                ...frame,
                                x: frame.x + psdBoundsOriginOffset.x,
                                y: frame.y + psdBoundsOriginOffset.y,
                              };
                              const buildPsdBoundsControl = async (
                                layer: (typeof legacyReplay.layers)[string],
                                label: string,
                                framePixels: Uint8ClampedArray,
                                preEncodePixels: ArrayLike<number>
                              ) => {
                                // Keep the logical target frame fixed. Only its origin and backing size vary.
                                const baseline: DiagnosticPixelSurface = {
                                  pixels: framePixels,
                                  pixelSize: frameSize,
                                  originOffset: { x: 0, y: 0 },
                                };
                                const originOnly: DiagnosticPixelSurface = {
                                  pixels: renderLayerSurfacePixels(layer, label, psdBoundsTargetFrame, frameSize),
                                  pixelSize: frameSize,
                                  originOffset: psdBoundsOriginOffset,
                                };
                                const extentOnly: DiagnosticPixelSurface = {
                                  pixels: renderLayerSurfacePixels(layer, label, frame, legacy.rasterSize),
                                  pixelSize: legacy.rasterSize,
                                  originOffset: { x: 0, y: 0 },
                                };
                                const combined: DiagnosticPixelSurface = {
                                  pixels: renderLayerSurfacePixels(
                                    layer,
                                    label,
                                    psdBoundsTargetFrame,
                                    legacy.rasterSize
                                  ),
                                  pixelSize: legacy.rasterSize,
                                  originOffset: psdBoundsOriginOffset,
                                };
                                const hasExpandedPsdBounds =
                                  legacy.rasterSize.width > frameSize.width &&
                                  legacy.rasterSize.height > frameSize.height;
                                const widthOnlySize = { width: legacy.rasterSize.width, height: frameSize.height };
                                const heightOnlySize = { width: frameSize.width, height: legacy.rasterSize.height };
                                const widthOnly: DiagnosticPixelSurface | null = hasExpandedPsdBounds
                                  ? {
                                      pixels: renderLayerSurfacePixels(layer, label, frame, widthOnlySize),
                                      pixelSize: widthOnlySize,
                                      originOffset: { x: 0, y: 0 },
                                    }
                                  : null;
                                const heightOnly: DiagnosticPixelSurface | null = hasExpandedPsdBounds
                                  ? {
                                      pixels: renderLayerSurfacePixels(layer, label, frame, heightOnlySize),
                                      pixelSize: heightOnlySize,
                                      originOffset: { x: 0, y: 0 },
                                    }
                                  : null;
                                const commonBackingClipControls =
                                  widthOnly && heightOnly
                                    ? (() => {
                                        const renderCommonBackingClip = (
                                          clipSize: typeof frameSize
                                        ): DiagnosticPixelSurface => {
                                          const canvas = document.createElement('canvas');
                                          canvas.width = legacy.rasterSize.width;
                                          canvas.height = legacy.rasterSize.height;
                                          const context = canvas.getContext('2d');
                                          if (!context) {
                                            throw new Error(
                                              `${label} common-backing PSD diagnostic has no 2D context at ${stage}`
                                            );
                                          }
                                          context.beginPath();
                                          context.rect(0, 0, clipSize.width, clipSize.height);
                                          context.clip();
                                          if (!drawLayerSource(context, layer, layer.pos, frame)) {
                                            throw new Error(
                                              `${label} common-backing PSD diagnostic refused ${id} at ${stage}`
                                            );
                                          }
                                          return {
                                            pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
                                            pixelSize: { width: canvas.width, height: canvas.height },
                                            originOffset: { x: 0, y: 0 },
                                          };
                                        };
                                        const originalFrameRegion = {
                                          x: 0,
                                          y: 0,
                                          width: frameSize.width,
                                          height: frameSize.height,
                                        };
                                        const cropToOriginalFrame = (surface: DiagnosticPixelSurface) =>
                                          cropDiagnosticSurface(surface, originalFrameRegion);
                                        const commonBackingSurfaces = {
                                          baseline: renderCommonBackingClip(frameSize),
                                          widthOnly: renderCommonBackingClip(widthOnlySize),
                                          heightOnly: renderCommonBackingClip(heightOnlySize),
                                          combined: renderCommonBackingClip(legacy.rasterSize),
                                        };
                                        const nativeSurfaces = {
                                          baseline,
                                          widthOnly,
                                          heightOnly,
                                          combined,
                                        };
                                        const commonFrameSurfaces = {
                                          baseline: cropToOriginalFrame(commonBackingSurfaces.baseline),
                                          widthOnly: cropToOriginalFrame(commonBackingSurfaces.widthOnly),
                                          heightOnly: cropToOriginalFrame(commonBackingSurfaces.heightOnly),
                                          combined: cropToOriginalFrame(commonBackingSurfaces.combined),
                                        };
                                        return {
                                          surfaces: commonBackingSurfaces,
                                          report: {
                                            backingPixelSize: { ...legacy.rasterSize },
                                            originalFrameComparedPixels: frameSize.width * frameSize.height,
                                            nativeSizeVsCommonBackingClip: {
                                              baseline: compareRasterOverlap(
                                                cropToOriginalFrame(nativeSurfaces.baseline),
                                                commonFrameSurfaces.baseline
                                              ),
                                              widthOnly: compareRasterOverlap(
                                                cropToOriginalFrame(nativeSurfaces.widthOnly),
                                                commonFrameSurfaces.widthOnly
                                              ),
                                              heightOnly: compareRasterOverlap(
                                                cropToOriginalFrame(nativeSurfaces.heightOnly),
                                                commonFrameSurfaces.heightOnly
                                              ),
                                              combined: compareRasterOverlap(
                                                cropToOriginalFrame(nativeSurfaces.combined),
                                                commonFrameSurfaces.combined
                                              ),
                                            },
                                            commonBackingClipVsBaseline: {
                                              widthOnly: compareRasterOverlap(
                                                commonFrameSurfaces.baseline,
                                                commonFrameSurfaces.widthOnly
                                              ),
                                              heightOnly: compareRasterOverlap(
                                                commonFrameSurfaces.baseline,
                                                commonFrameSurfaces.heightOnly
                                              ),
                                              combined: compareRasterOverlap(
                                                commonFrameSurfaces.baseline,
                                                commonFrameSurfaces.combined
                                              ),
                                            },
                                            widthHeightInteraction: compareWidthHeightExtentInteraction(
                                              commonFrameSurfaces.baseline,
                                              commonFrameSurfaces.widthOnly,
                                              commonFrameSurfaces.heightOnly,
                                              commonFrameSurfaces.combined
                                            ),
                                          },
                                        };
                                      })()
                                    : null;
                                const firstDifferenceTraceControls =
                                  stage === 'frame transition 1' &&
                                  id === 'background' &&
                                  Math.abs(frame.x - 7.25) < 1e-9 &&
                                  Math.abs(frame.y - 8.5) < 1e-9 &&
                                  frameSize.width === 51 &&
                                  frameSize.height === 46 &&
                                  legacy.rasterSize.width === 89 &&
                                  legacy.rasterSize.height === 89
                                    ? (async () => {
                                        const oneRowLargerSize = {
                                          width: frameSize.width,
                                          height: frameSize.height + 1,
                                        };
                                        const baselineFrameSurface: DiagnosticPixelSurface = {
                                          pixels: framePixels,
                                          pixelSize: frameSize,
                                          originOffset: { x: 0, y: 0 },
                                        };
                                        const oneRowLargerFrameSurface: DiagnosticPixelSurface = {
                                          pixels: renderLayerSurfacePixels(layer, label, frame, oneRowLargerSize),
                                          pixelSize: oneRowLargerSize,
                                          originOffset: { x: 0, y: 0 },
                                        };
                                        const firstDifferenceSelection = compareRasterOverlap(
                                          baselineFrameSurface,
                                          oneRowLargerFrameSurface
                                        );
                                        const firstDifferingPixel =
                                          firstDifferenceSelection.pixelComparison?.differingSamples[0] ?? null;
                                        const sampleFramePixel = firstDifferingPixel
                                          ? { x: firstDifferingPixel.x, y: firstDifferingPixel.y }
                                          : { x: 0, y: 0 };
                                        const sampleBackingPoint = {
                                          x: sampleFramePixel.x + 0.5,
                                          y: sampleFramePixel.y + 0.5,
                                        };
                                        const traceSourceIds = new WeakMap<object, string>();
                                        let nextTraceSourceId = 1;
                                        const getTraceSourceId = (source: object) => {
                                          let id = traceSourceIds.get(source);
                                          if (!id) {
                                            id = `drawImage-source-${nextTraceSourceId}`;
                                            nextTraceSourceId += 1;
                                            traceSourceIds.set(source, id);
                                          }
                                          return id;
                                        };
                                        const getImageSize = (source: CanvasImageSource) => {
                                          const image = source as CanvasImageSource & {
                                            width?: number;
                                            height?: number;
                                            naturalWidth?: number;
                                            naturalHeight?: number;
                                            videoWidth?: number;
                                            videoHeight?: number;
                                          };
                                          const width = [image.naturalWidth, image.videoWidth, image.width].find(
                                            (value) => typeof value === 'number' && value > 0
                                          );
                                          const height = [image.naturalHeight, image.videoHeight, image.height].find(
                                            (value) => typeof value === 'number' && value > 0
                                          );
                                          return {
                                            width: typeof width === 'number' ? width : 0,
                                            height: typeof height === 'number' ? height : 0,
                                          };
                                        };
                                        const readContextState = (
                                          context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
                                        ) => {
                                          const transform = context.getTransform();
                                          return {
                                            transform: {
                                              a: transform.a,
                                              b: transform.b,
                                              c: transform.c,
                                              d: transform.d,
                                              e: transform.e,
                                              f: transform.f,
                                            },
                                            filter: context.filter,
                                            imageSmoothingEnabled: context.imageSmoothingEnabled,
                                            imageSmoothingQuality: context.imageSmoothingQuality,
                                            globalAlpha: context.globalAlpha,
                                            globalCompositeOperation: context.globalCompositeOperation,
                                            shadowColor: context.shadowColor,
                                            shadowBlur: context.shadowBlur,
                                            shadowOffsetX: context.shadowOffsetX,
                                            shadowOffsetY: context.shadowOffsetY,
                                          };
                                        };
                                        const readSourceNeighborhood = (
                                          source: CanvasImageSource,
                                          sourceCoordinate: { x: number; y: number }
                                        ) => {
                                          const imageSize = getImageSize(source);
                                          if (imageSize.width < 1 || imageSize.height < 1) {
                                            return {
                                              status: 'unavailable',
                                              reason: 'source dimensions are unavailable',
                                            };
                                          }
                                          const fixtureSourceSurface = diagnosticBitmapSourceSurfaces.get(
                                            source as object
                                          );
                                          const sourceWithContext = source as CanvasImageSource & {
                                            getContext?: (
                                              contextId: '2d'
                                            ) => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
                                          };
                                          let sampleSurface: HTMLCanvasElement | OffscreenCanvas;
                                          let sampleMethod: string;
                                          if (fixtureSourceSurface) {
                                            sampleSurface = fixtureSourceSurface;
                                            sampleMethod = 'original-fixture-source-canvas';
                                          } else if (typeof sourceWithContext.getContext === 'function') {
                                            sampleSurface = sourceWithContext as unknown as
                                              HTMLCanvasElement | OffscreenCanvas;
                                            sampleMethod = 'source-canvas-readback';
                                          } else {
                                            const scratch = document.createElement('canvas');
                                            scratch.width = imageSize.width;
                                            scratch.height = imageSize.height;
                                            const scratchContext = scratch.getContext('2d');
                                            if (!scratchContext) {
                                              return {
                                                status: 'unavailable',
                                                reason: 'source sampling context is unavailable',
                                              };
                                            }
                                            scratchContext.setTransform(1, 0, 0, 1, 0, 0);
                                            scratchContext.imageSmoothingEnabled = false;
                                            scratchContext.drawImage(source, 0, 0, imageSize.width, imageSize.height);
                                            sampleSurface = scratch;
                                            sampleMethod = 'one-to-one-source-scratch-readback';
                                          }
                                          const sampleContext = sampleSurface.getContext('2d') as
                                            CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
                                          if (!sampleContext) {
                                            return {
                                              status: 'unavailable',
                                              reason: 'source readback context is unavailable',
                                            };
                                          }
                                          const centerX = Math.floor(sourceCoordinate.x);
                                          const centerY = Math.floor(sourceCoordinate.y);
                                          const left = Math.max(0, centerX - 1);
                                          const top = Math.max(0, centerY - 1);
                                          const right = Math.min(imageSize.width - 1, centerX + 1);
                                          const bottom = Math.min(imageSize.height - 1, centerY + 1);
                                          if (right < left || bottom < top) {
                                            return {
                                              status: 'outside-source',
                                              sampleMethod,
                                              imageSize,
                                              sourceCoordinate,
                                            };
                                          }
                                          const imageData = sampleContext.getImageData(
                                            left,
                                            top,
                                            right - left + 1,
                                            bottom - top + 1
                                          );
                                          const samples = [];
                                          for (let y = top; y <= bottom; y += 1) {
                                            for (let x = left; x <= right; x += 1) {
                                              const offset = ((y - top) * imageData.width + (x - left)) * 4;
                                              samples.push({
                                                x,
                                                y,
                                                rgba: Array.from(imageData.data.slice(offset, offset + 4)),
                                              });
                                            }
                                          }
                                          return {
                                            status: 'measured',
                                            sampleMethod,
                                            imageSize,
                                            sourceCoordinate,
                                            nearestTexel: { x: centerX, y: centerY },
                                            neighborhood: samples,
                                          };
                                        };
                                        const mapBackingPointToDrawImageSource = (
                                          args: readonly unknown[],
                                          state: ReturnType<typeof readContextState>
                                        ) => {
                                          const source = args[0] as CanvasImageSource;
                                          const imageSize = getImageSize(source);
                                          const numericArgs = args.slice(1).map(Number);
                                          let sourceRect: {
                                            x: number;
                                            y: number;
                                            width: number;
                                            height: number;
                                          } | null = null;
                                          let destinationRect: {
                                            x: number;
                                            y: number;
                                            width: number;
                                            height: number;
                                          } | null = null;
                                          if (numericArgs.length === 2) {
                                            sourceRect = { x: 0, y: 0, ...imageSize };
                                            destinationRect = {
                                              x: numericArgs[0] ?? 0,
                                              y: numericArgs[1] ?? 0,
                                              width: imageSize.width,
                                              height: imageSize.height,
                                            };
                                          } else if (numericArgs.length === 4) {
                                            sourceRect = { x: 0, y: 0, ...imageSize };
                                            destinationRect = {
                                              x: numericArgs[0] ?? 0,
                                              y: numericArgs[1] ?? 0,
                                              width: numericArgs[2] ?? 0,
                                              height: numericArgs[3] ?? 0,
                                            };
                                          } else if (numericArgs.length === 8) {
                                            sourceRect = {
                                              x: numericArgs[0] ?? 0,
                                              y: numericArgs[1] ?? 0,
                                              width: numericArgs[2] ?? 0,
                                              height: numericArgs[3] ?? 0,
                                            };
                                            destinationRect = {
                                              x: numericArgs[4] ?? 0,
                                              y: numericArgs[5] ?? 0,
                                              width: numericArgs[6] ?? 0,
                                              height: numericArgs[7] ?? 0,
                                            };
                                          }
                                          const transform = state.transform;
                                          const determinant = transform.a * transform.d - transform.b * transform.c;
                                          if (!sourceRect || !destinationRect || determinant === 0) {
                                            return {
                                              imageSize,
                                              numericArguments: numericArgs,
                                              sourceRect,
                                              destinationRect,
                                              backingPixelCenter: sampleBackingPoint,
                                              userSpacePoint: null,
                                              mapsInsideDestination: false,
                                              sourceCoordinate: null,
                                              sourceNeighborhood: null,
                                            };
                                          }
                                          const deviceX = sampleBackingPoint.x - transform.e;
                                          const deviceY = sampleBackingPoint.y - transform.f;
                                          const userSpacePoint = {
                                            x: (transform.d * deviceX - transform.c * deviceY) / determinant,
                                            y: (-transform.b * deviceX + transform.a * deviceY) / determinant,
                                          };
                                          const mapsInsideDestination =
                                            userSpacePoint.x >=
                                              Math.min(destinationRect.x, destinationRect.x + destinationRect.width) &&
                                            userSpacePoint.x <
                                              Math.max(destinationRect.x, destinationRect.x + destinationRect.width) &&
                                            userSpacePoint.y >=
                                              Math.min(destinationRect.y, destinationRect.y + destinationRect.height) &&
                                            userSpacePoint.y <
                                              Math.max(destinationRect.y, destinationRect.y + destinationRect.height);
                                          const sourceCoordinate = mapsInsideDestination
                                            ? {
                                                x:
                                                  sourceRect.x +
                                                  ((userSpacePoint.x - destinationRect.x) / destinationRect.width) *
                                                    sourceRect.width,
                                                y:
                                                  sourceRect.y +
                                                  ((userSpacePoint.y - destinationRect.y) / destinationRect.height) *
                                                    sourceRect.height,
                                              }
                                            : null;
                                          return {
                                            imageSize,
                                            numericArguments: numericArgs,
                                            sourceRect,
                                            destinationRect,
                                            backingPixelCenter: sampleBackingPoint,
                                            userSpacePoint,
                                            mapsInsideDestination,
                                            sourceCoordinate,
                                            sourceNeighborhood: sourceCoordinate
                                              ? readSourceNeighborhood(source, sourceCoordinate)
                                              : null,
                                          };
                                        };
                                        const createTraceSurface = (
                                          canvasType: 'HTMLCanvas' | 'OffscreenCanvas',
                                          size: { width: number; height: number }
                                        ) => {
                                          const surface: HTMLCanvasElement | OffscreenCanvas =
                                            canvasType === 'HTMLCanvas'
                                              ? document.createElement('canvas')
                                              : new OffscreenCanvas(size.width, size.height);
                                          surface.width = size.width;
                                          surface.height = size.height;
                                          return surface;
                                        };
                                        const captureTraceRun = (
                                          canvasType: 'HTMLCanvas' | 'OffscreenCanvas',
                                          backingSize: { width: number; height: number }
                                        ) => {
                                          const surface = createTraceSurface(canvasType, backingSize);
                                          const context = surface.getContext('2d') as
                                            CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
                                          if (!context) {
                                            throw new Error(
                                              `${canvasType} first-difference trace has no 2D context at ${stage}`
                                            );
                                          }
                                          const drawImageCalls: Array<Record<string, unknown>> = [];
                                          const capturedDrawImageInvocations: Array<{
                                            source: CanvasImageSource;
                                            arguments: unknown[];
                                            contextBeforeDraw: ReturnType<typeof readContextState>;
                                          }> = [];
                                          const proxy = new Proxy(context as CanvasRenderingContext2D, {
                                            get(target, property) {
                                              if (property === 'drawImage') {
                                                return (...args: unknown[]) => {
                                                  const beforeDraw = readContextState(target);
                                                  const image = args[0] as CanvasImageSource;
                                                  const imageObject = image as object;
                                                  const mappedInput = mapBackingPointToDrawImageSource(
                                                    args,
                                                    beforeDraw
                                                  );
                                                  capturedDrawImageInvocations.push({
                                                    source: image,
                                                    arguments: args.slice(1),
                                                    contextBeforeDraw: beforeDraw,
                                                  });
                                                  const drawResult = (
                                                    target.drawImage as unknown as (...callArgs: unknown[]) => void
                                                  ).bind(target)(...args);
                                                  drawImageCalls.push({
                                                    argumentCount: args.length,
                                                    sourceIdentity: getTraceSourceId(imageObject),
                                                    sourceMatchesLayerBitmap:
                                                      imageObject === (layer.bitmap as object | null),
                                                    sourceMatchesLayerTmpCanvas:
                                                      imageObject === (layer.tmpCanvas as object | null),
                                                    sourceConstructor:
                                                      (imageObject as { constructor?: { name?: string } }).constructor
                                                        ?.name ?? null,
                                                    ...mappedInput,
                                                    contextBeforeDraw: beforeDraw,
                                                    contextAfterDraw: readContextState(target),
                                                  });
                                                  return drawResult;
                                                };
                                              }
                                              const value = Reflect.get(target, property, target);
                                              return typeof value === 'function' ? value.bind(target) : value;
                                            },
                                            set(target, property, value) {
                                              return Reflect.set(target, property, value, target);
                                            },
                                          });
                                          const contextBeforeDrawLayerSource = readContextState(context);
                                          const drawLayerSourceResult = drawLayerSource(
                                            proxy as unknown as CanvasRenderingContext2D,
                                            layer,
                                            layer.pos,
                                            frame,
                                            false
                                          );
                                          const contextAfterDrawLayerSource = readContextState(context);
                                          const outputSample = Array.from(
                                            context.getImageData(sampleFramePixel.x, sampleFramePixel.y, 1, 1).data
                                          );
                                          const framePixels = context.getImageData(
                                            0,
                                            0,
                                            frameSize.width,
                                            frameSize.height
                                          ).data;
                                          const copySurface = document.createElement('canvas');
                                          copySurface.width = frameSize.width;
                                          copySurface.height = oneRowLargerSize.height;
                                          const copyContext = copySurface.getContext('2d');
                                          if (!copyContext) {
                                            throw new Error(`Common-size copy control has no 2D context at ${stage}`);
                                          }
                                          copyContext.setTransform(1, 0, 0, 1, 0, 0);
                                          copyContext.filter = 'none';
                                          copyContext.imageSmoothingEnabled = false;
                                          copyContext.globalAlpha = 1;
                                          copyContext.globalCompositeOperation = 'source-over';
                                          copyContext.drawImage(
                                            surface,
                                            0,
                                            0,
                                            backingSize.width,
                                            backingSize.height,
                                            0,
                                            0,
                                            backingSize.width,
                                            backingSize.height
                                          );
                                          const copiedFramePixels = copyContext.getImageData(
                                            0,
                                            0,
                                            frameSize.width,
                                            frameSize.height
                                          ).data;
                                          const copiedSample = Array.from(
                                            copyContext.getImageData(sampleFramePixel.x, sampleFramePixel.y, 1, 1).data
                                          );
                                          return {
                                            report: {
                                              status: drawLayerSourceResult ? 'measured' : 'draw-refused',
                                              canvasType,
                                              canvasBackingSize: { ...backingSize },
                                              layerInput: {
                                                id: layer.id,
                                                pos: layer.pos,
                                                presentationBounds: layer.presentationBounds,
                                                sourceKind: layer.source?.kind ?? null,
                                                bitmapSize: layer.bitmap
                                                  ? getImageSize(layer.bitmap as CanvasImageSource)
                                                  : null,
                                                tmpCanvasSize: layer.tmpCanvas
                                                  ? getImageSize(layer.tmpCanvas as CanvasImageSource)
                                                  : null,
                                                operations: layer.operations.map(
                                                  (operation: Layer['operations'][number]) => ({
                                                    kind: operation.kind,
                                                    enabled: operation.enabled,
                                                    transform:
                                                      operation.kind === 'affine-transform'
                                                        ? operation.transform
                                                        : undefined,
                                                    toolName:
                                                      operation.kind === 'filter' ? operation.args.toolName : undefined,
                                                  })
                                                ),
                                              },
                                              contextBeforeDrawLayerSource,
                                              contextAfterDrawLayerSource,
                                              drawImageCalls,
                                              readbackSample: {
                                                frameLocalPixelCell: sampleFramePixel,
                                                documentPixelCellOrigin: {
                                                  x: frame.x + sampleFramePixel.x,
                                                  y: frame.y + sampleFramePixel.y,
                                                },
                                                documentPixelCenter: {
                                                  x: frame.x + sampleBackingPoint.x,
                                                  y: frame.y + sampleBackingPoint.y,
                                                },
                                                rgba: outputSample,
                                              },
                                              commonSizeCopyControl: {
                                                destinationBackingSize: {
                                                  width: copySurface.width,
                                                  height: copySurface.height,
                                                },
                                                transform: readContextState(copyContext).transform,
                                                sourceRect: {
                                                  x: 0,
                                                  y: 0,
                                                  width: backingSize.width,
                                                  height: backingSize.height,
                                                },
                                                destinationRect: {
                                                  x: 0,
                                                  y: 0,
                                                  width: backingSize.width,
                                                  height: backingSize.height,
                                                },
                                                readbackSample: copiedSample,
                                                originalFrameComparison: compareBytes(
                                                  Array.from(framePixels),
                                                  Array.from(copiedFramePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                            },
                                            framePixels,
                                            capturedDrawImageInvocations,
                                          };
                                        };
                                        const replayCapturedDrawImageCalls = (
                                          canvasType: 'HTMLCanvas' | 'OffscreenCanvas',
                                          backingSize: { width: number; height: number },
                                          invocations: Array<{
                                            source: CanvasImageSource;
                                            arguments: unknown[];
                                            contextBeforeDraw: ReturnType<typeof readContextState>;
                                          }>,
                                          overrides?: readonly {
                                            source: CanvasImageSource;
                                            arguments: unknown[];
                                          }[]
                                        ) => {
                                          const surface = createTraceSurface(canvasType, backingSize);
                                          const context = surface.getContext('2d') as
                                            CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
                                          if (!context) {
                                            throw new Error(
                                              `${canvasType} direct drawImage reproduction has no 2D context at ${stage}`
                                            );
                                          }
                                          for (const [index, invocation] of invocations.entries()) {
                                            const { transform } = invocation.contextBeforeDraw;
                                            context.setTransform(
                                              transform.a,
                                              transform.b,
                                              transform.c,
                                              transform.d,
                                              transform.e,
                                              transform.f
                                            );
                                            context.filter = invocation.contextBeforeDraw.filter;
                                            context.imageSmoothingEnabled =
                                              invocation.contextBeforeDraw.imageSmoothingEnabled;
                                            context.imageSmoothingQuality =
                                              invocation.contextBeforeDraw.imageSmoothingQuality;
                                            context.globalAlpha = invocation.contextBeforeDraw.globalAlpha;
                                            context.globalCompositeOperation =
                                              invocation.contextBeforeDraw.globalCompositeOperation;
                                            context.shadowColor = invocation.contextBeforeDraw.shadowColor;
                                            context.shadowBlur = invocation.contextBeforeDraw.shadowBlur;
                                            context.shadowOffsetX = invocation.contextBeforeDraw.shadowOffsetX;
                                            context.shadowOffsetY = invocation.contextBeforeDraw.shadowOffsetY;
                                            const override = overrides?.[index];
                                            (context.drawImage as unknown as (...callArgs: unknown[]) => void).apply(
                                              context,
                                              [
                                                override?.source ?? invocation.source,
                                                ...(override?.arguments ?? invocation.arguments),
                                              ]
                                            );
                                          }
                                          const framePixels = context.getImageData(
                                            0,
                                            0,
                                            frameSize.width,
                                            frameSize.height
                                          ).data;
                                          return {
                                            report: {
                                              canvasType,
                                              canvasBackingSize: { ...backingSize },
                                              drawImageCallCount: invocations.length,
                                              sampleFrameLocalPixelCell: sampleFramePixel,
                                              sampleRgba: Array.from(
                                                context.getImageData(sampleFramePixel.x, sampleFramePixel.y, 1, 1).data
                                              ),
                                              frameByteLength: framePixels.length,
                                            },
                                            framePixels,
                                          };
                                        };
                                        const readImageBitmapPixels = (
                                          bitmap: ImageBitmap,
                                          imageSize: { width: number; height: number },
                                          label: string
                                        ) => {
                                          const surface = document.createElement('canvas');
                                          surface.width = imageSize.width;
                                          surface.height = imageSize.height;
                                          const context = surface.getContext('2d', { willReadFrequently: true });
                                          if (!context) {
                                            throw new Error(
                                              `${label} ImageBitmap readback has no 2D context at ${stage}`
                                            );
                                          }
                                          context.setTransform(1, 0, 0, 1, 0, 0);
                                          context.filter = 'none';
                                          context.imageSmoothingEnabled = false;
                                          context.globalAlpha = 1;
                                          context.globalCompositeOperation = 'source-over';
                                          context.shadowColor = 'rgba(0, 0, 0, 0)';
                                          context.shadowBlur = 0;
                                          context.shadowOffsetX = 0;
                                          context.shadowOffsetY = 0;
                                          context.drawImage(bitmap, 0, 0, imageSize.width, imageSize.height);
                                          return Array.from(
                                            context.getImageData(0, 0, imageSize.width, imageSize.height).data
                                          );
                                        };
                                        const createTransparentPaddedImageBitmap = async (
                                          source: CanvasImageSource,
                                          padding: number
                                        ) => {
                                          if (!(source instanceof ImageBitmap)) {
                                            throw new Error(
                                              `Padding diagnostic requires the captured ImageBitmap at ${stage}`
                                            );
                                          }
                                          const sourceSize = getImageSize(source);
                                          if (sourceSize.width < 1 || sourceSize.height < 1 || padding !== 1) {
                                            throw new Error(
                                              `Padding diagnostic has invalid source dimensions at ${stage}`
                                            );
                                          }
                                          const paddedSurface = document.createElement('canvas');
                                          paddedSurface.width = sourceSize.width + 2 * padding;
                                          paddedSurface.height = sourceSize.height + 2 * padding;
                                          const paddedContext = paddedSurface.getContext('2d');
                                          if (!paddedContext) {
                                            throw new Error(
                                              `Padding diagnostic has no source-copy context at ${stage}`
                                            );
                                          }
                                          paddedContext.setTransform(1, 0, 0, 1, 0, 0);
                                          paddedContext.filter = 'none';
                                          paddedContext.imageSmoothingEnabled = false;
                                          paddedContext.globalAlpha = 1;
                                          paddedContext.globalCompositeOperation = 'source-over';
                                          paddedContext.shadowColor = 'rgba(0, 0, 0, 0)';
                                          paddedContext.shadowBlur = 0;
                                          paddedContext.shadowOffsetX = 0;
                                          paddedContext.shadowOffsetY = 0;
                                          paddedContext.drawImage(
                                            source,
                                            padding,
                                            padding,
                                            sourceSize.width,
                                            sourceSize.height
                                          );
                                          let paddedBitmap: ImageBitmap | null = null;
                                          try {
                                            paddedBitmap = await createImageBitmap(paddedSurface);
                                            const paddedSize = getImageSize(paddedBitmap);
                                            if (
                                              !(paddedBitmap instanceof ImageBitmap) ||
                                              paddedSize.width !== sourceSize.width + 2 * padding ||
                                              paddedSize.height !== sourceSize.height + 2 * padding
                                            ) {
                                              throw new Error(
                                                `Padding diagnostic produced an invalid ImageBitmap at ${stage}`
                                              );
                                            }
                                            const originalPixels = readImageBitmapPixels(
                                              source,
                                              sourceSize,
                                              'Original'
                                            );
                                            const paddedPixels = readImageBitmapPixels(
                                              paddedBitmap,
                                              paddedSize,
                                              'Padded'
                                            );
                                            const paddedInteriorPixels: number[] = [];
                                            let borderPixelCount = 0;
                                            let borderNonTransparentPixelCount = 0;
                                            for (let y = 0; y < paddedSize.height; y += 1) {
                                              for (let x = 0; x < paddedSize.width; x += 1) {
                                                const isOriginalInterior =
                                                  x >= padding &&
                                                  x < padding + sourceSize.width &&
                                                  y >= padding &&
                                                  y < padding + sourceSize.height;
                                                const byteOffset = (y * paddedSize.width + x) * 4;
                                                if (isOriginalInterior) {
                                                  for (let channel = 0; channel < 4; channel += 1) {
                                                    paddedInteriorPixels.push(paddedPixels[byteOffset + channel]!);
                                                  }
                                                } else {
                                                  borderPixelCount += 1;
                                                  if (paddedPixels[byteOffset + 3] !== 0) {
                                                    borderNonTransparentPixelCount += 1;
                                                  }
                                                }
                                              }
                                            }
                                            return {
                                              bitmap: paddedBitmap,
                                              report: {
                                                originalSourceConstructor:
                                                  (source as { constructor?: { name?: string } }).constructor?.name ??
                                                  null,
                                                paddedSourceConstructor:
                                                  (paddedBitmap as { constructor?: { name?: string } }).constructor
                                                    ?.name ?? null,
                                                originalSourceSize: sourceSize,
                                                paddedSourceSize: paddedSize,
                                                padding,
                                                interiorComparison: compareBytes(
                                                  originalPixels,
                                                  paddedInteriorPixels,
                                                  sourceSize.width,
                                                  sourceSize.height,
                                                  0,
                                                  0
                                                ),
                                                borderPixelCount,
                                                expectedBorderPixelCount:
                                                  paddedSize.width * paddedSize.height -
                                                  sourceSize.width * sourceSize.height,
                                                borderNonTransparentPixelCount,
                                              },
                                            };
                                          } catch (error) {
                                            paddedBitmap?.close();
                                            throw error;
                                          }
                                        };
                                        const createPaddedBitmapWithExtendedEdges = async (
                                          source: CanvasImageSource,
                                          padding: number,
                                          extendedEdges: Array<'top' | 'right' | 'bottom' | 'left'>
                                        ) => {
                                          if (!(source instanceof ImageBitmap)) {
                                            throw new Error(
                                              `Edge-padding diagnostic requires the captured ImageBitmap at ${stage}`
                                            );
                                          }
                                          const sourceSize = getImageSize(source);
                                          if (sourceSize.width < 1 || sourceSize.height < 1 || padding !== 1) {
                                            throw new Error(
                                              `Edge-padding diagnostic has invalid source dimensions at ${stage}`
                                            );
                                          }
                                          const originalPixels = readImageBitmapPixels(
                                            source,
                                            sourceSize,
                                            'Edge-padding original'
                                          );
                                          const paddedSize = {
                                            width: sourceSize.width + padding * 2,
                                            height: sourceSize.height + padding * 2,
                                          };
                                          const extendedEdgeSet = new Set(extendedEdges);
                                          const expectedPaddedPixels = new Uint8ClampedArray(
                                            paddedSize.width * paddedSize.height * 4
                                          );
                                          const expectedBorderPixels: number[] = [];
                                          let extendedBorderPixelCount = 0;
                                          for (let y = 0; y < paddedSize.height; y += 1) {
                                            for (let x = 0; x < paddedSize.width; x += 1) {
                                              const paddedOffset = (y * paddedSize.width + x) * 4;
                                              const isOriginalInterior =
                                                x >= padding &&
                                                x < padding + sourceSize.width &&
                                                y >= padding &&
                                                y < padding + sourceSize.height;
                                              const isLeftBorder = x < padding;
                                              const isRightBorder = x >= padding + sourceSize.width;
                                              const isTopBorder = y < padding;
                                              const isBottomBorder = y >= padding + sourceSize.height;
                                              const isCorner =
                                                (isLeftBorder || isRightBorder) && (isTopBorder || isBottomBorder);
                                              const extendsBorder =
                                                isOriginalInterior ||
                                                (isCorner
                                                  ? (isLeftBorder &&
                                                      isTopBorder &&
                                                      extendedEdgeSet.has('left') &&
                                                      extendedEdgeSet.has('top')) ||
                                                    (isRightBorder &&
                                                      isTopBorder &&
                                                      extendedEdgeSet.has('right') &&
                                                      extendedEdgeSet.has('top')) ||
                                                    (isLeftBorder &&
                                                      isBottomBorder &&
                                                      extendedEdgeSet.has('left') &&
                                                      extendedEdgeSet.has('bottom')) ||
                                                    (isRightBorder &&
                                                      isBottomBorder &&
                                                      extendedEdgeSet.has('right') &&
                                                      extendedEdgeSet.has('bottom'))
                                                  : (isLeftBorder && extendedEdgeSet.has('left')) ||
                                                    (isRightBorder && extendedEdgeSet.has('right')) ||
                                                    (isTopBorder && extendedEdgeSet.has('top')) ||
                                                    (isBottomBorder && extendedEdgeSet.has('bottom')));
                                              if (extendsBorder && !isOriginalInterior) extendedBorderPixelCount += 1;
                                              const sourceX = Math.max(0, Math.min(sourceSize.width - 1, x - padding));
                                              const sourceY = Math.max(0, Math.min(sourceSize.height - 1, y - padding));
                                              const sourceOffset = (sourceY * sourceSize.width + sourceX) * 4;
                                              for (let channel = 0; channel < 4; channel += 1) {
                                                const channelValue = extendsBorder
                                                  ? originalPixels[sourceOffset + channel]!
                                                  : 0;
                                                expectedPaddedPixels[paddedOffset + channel] = channelValue;
                                                if (!isOriginalInterior) expectedBorderPixels.push(channelValue);
                                              }
                                            }
                                          }
                                          const paddedSurface = document.createElement('canvas');
                                          paddedSurface.width = paddedSize.width;
                                          paddedSurface.height = paddedSize.height;
                                          const paddedContext = paddedSurface.getContext('2d', {
                                            willReadFrequently: true,
                                          });
                                          if (!paddedContext) {
                                            throw new Error(
                                              `Edge-padding diagnostic has no padded-surface context at ${stage}`
                                            );
                                          }
                                          paddedContext.setTransform(1, 0, 0, 1, 0, 0);
                                          paddedContext.filter = 'none';
                                          paddedContext.imageSmoothingEnabled = false;
                                          paddedContext.globalAlpha = 1;
                                          paddedContext.globalCompositeOperation = 'source-over';
                                          paddedContext.shadowColor = 'rgba(0, 0, 0, 0)';
                                          paddedContext.shadowBlur = 0;
                                          paddedContext.shadowOffsetX = 0;
                                          paddedContext.shadowOffsetY = 0;
                                          paddedContext.drawImage(
                                            source,
                                            padding,
                                            padding,
                                            sourceSize.width,
                                            sourceSize.height
                                          );
                                          if (extendedEdgeSet.has('top')) {
                                            paddedContext.drawImage(
                                              source,
                                              0,
                                              0,
                                              sourceSize.width,
                                              1,
                                              padding,
                                              0,
                                              sourceSize.width,
                                              1
                                            );
                                          }
                                          if (extendedEdgeSet.has('bottom')) {
                                            paddedContext.drawImage(
                                              source,
                                              0,
                                              sourceSize.height - 1,
                                              sourceSize.width,
                                              1,
                                              padding,
                                              padding + sourceSize.height,
                                              sourceSize.width,
                                              1
                                            );
                                          }
                                          if (extendedEdgeSet.has('left')) {
                                            paddedContext.drawImage(
                                              source,
                                              0,
                                              0,
                                              1,
                                              sourceSize.height,
                                              0,
                                              padding,
                                              1,
                                              sourceSize.height
                                            );
                                          }
                                          if (extendedEdgeSet.has('right')) {
                                            paddedContext.drawImage(
                                              source,
                                              sourceSize.width - 1,
                                              0,
                                              1,
                                              sourceSize.height,
                                              padding + sourceSize.width,
                                              padding,
                                              1,
                                              sourceSize.height
                                            );
                                          }
                                          if (extendedEdgeSet.has('top') && extendedEdgeSet.has('left')) {
                                            paddedContext.drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1);
                                          }
                                          if (extendedEdgeSet.has('top') && extendedEdgeSet.has('right')) {
                                            paddedContext.drawImage(
                                              source,
                                              sourceSize.width - 1,
                                              0,
                                              1,
                                              1,
                                              padding + sourceSize.width,
                                              0,
                                              1,
                                              1
                                            );
                                          }
                                          if (extendedEdgeSet.has('bottom') && extendedEdgeSet.has('left')) {
                                            paddedContext.drawImage(
                                              source,
                                              0,
                                              sourceSize.height - 1,
                                              1,
                                              1,
                                              0,
                                              padding + sourceSize.height,
                                              1,
                                              1
                                            );
                                          }
                                          if (extendedEdgeSet.has('bottom') && extendedEdgeSet.has('right')) {
                                            paddedContext.drawImage(
                                              source,
                                              sourceSize.width - 1,
                                              sourceSize.height - 1,
                                              1,
                                              1,
                                              padding + sourceSize.width,
                                              padding + sourceSize.height,
                                              1,
                                              1
                                            );
                                          }
                                          let paddedBitmap: ImageBitmap | null = null;
                                          try {
                                            paddedBitmap = await createImageBitmap(paddedSurface);
                                            const actualPaddedSize = getImageSize(paddedBitmap);
                                            if (
                                              !(paddedBitmap instanceof ImageBitmap) ||
                                              actualPaddedSize.width !== paddedSize.width ||
                                              actualPaddedSize.height !== paddedSize.height
                                            ) {
                                              throw new Error(
                                                `Edge-padding diagnostic produced an invalid ImageBitmap at ${stage}`
                                              );
                                            }
                                            const actualPaddedPixels = readImageBitmapPixels(
                                              paddedBitmap,
                                              actualPaddedSize,
                                              'Edge-padding padded'
                                            );
                                            const actualInteriorPixels: number[] = [];
                                            const actualBorderPixels: number[] = [];
                                            for (let y = 0; y < actualPaddedSize.height; y += 1) {
                                              for (let x = 0; x < actualPaddedSize.width; x += 1) {
                                                const byteOffset = (y * actualPaddedSize.width + x) * 4;
                                                const isOriginalInterior =
                                                  x >= padding &&
                                                  x < padding + sourceSize.width &&
                                                  y >= padding &&
                                                  y < padding + sourceSize.height;
                                                for (let channel = 0; channel < 4; channel += 1) {
                                                  const channelValue = actualPaddedPixels[byteOffset + channel]!;
                                                  if (isOriginalInterior) actualInteriorPixels.push(channelValue);
                                                  else actualBorderPixels.push(channelValue);
                                                }
                                              }
                                            }
                                            const borderPixelCount =
                                              paddedSize.width * paddedSize.height -
                                              sourceSize.width * sourceSize.height;
                                            return {
                                              bitmap: paddedBitmap,
                                              report: {
                                                originalSourceConstructor:
                                                  (source as { constructor?: { name?: string } }).constructor?.name ??
                                                  null,
                                                paddedSourceConstructor:
                                                  (paddedBitmap as { constructor?: { name?: string } }).constructor
                                                    ?.name ?? null,
                                                originalSourceSize: sourceSize,
                                                paddedSourceSize: actualPaddedSize,
                                                padding,
                                                extendedEdges,
                                                interiorComparison: compareBytes(
                                                  originalPixels,
                                                  actualInteriorPixels,
                                                  sourceSize.width,
                                                  sourceSize.height,
                                                  0,
                                                  0
                                                ),
                                                borderPixelCount,
                                                expectedBorderPixelCount: borderPixelCount,
                                                extendedBorderPixelCount,
                                                transparentBorderPixelCount:
                                                  borderPixelCount - extendedBorderPixelCount,
                                                borderComparison: compareBytes(
                                                  expectedBorderPixels,
                                                  actualBorderPixels,
                                                  borderPixelCount,
                                                  1,
                                                  0,
                                                  0
                                                ),
                                                paddedSurfaceComparison: compareBytes(
                                                  Array.from(expectedPaddedPixels),
                                                  actualPaddedPixels,
                                                  paddedSize.width,
                                                  paddedSize.height,
                                                  0,
                                                  0
                                                ),
                                              },
                                            };
                                          } catch (error) {
                                            paddedBitmap?.close();
                                            throw error;
                                          }
                                        };
                                        const canvasTypes: Array<'HTMLCanvas' | 'OffscreenCanvas'> = ['HTMLCanvas'];
                                        const offscreenCanvasAvailable = typeof OffscreenCanvas !== 'undefined';
                                        if (offscreenCanvasAvailable) canvasTypes.push('OffscreenCanvas');
                                        const traceRuns = canvasTypes.flatMap((canvasType) =>
                                          [frameSize, oneRowLargerSize].map((backingSize) =>
                                            captureTraceRun(canvasType, backingSize)
                                          )
                                        );
                                        const buildTraceReportForCanvasType = async (
                                          canvasType: 'HTMLCanvas' | 'OffscreenCanvas'
                                        ) => {
                                          const baseline = traceRuns.find(
                                            ({ report }) =>
                                              report.canvasType === canvasType &&
                                              report.canvasBackingSize.width === frameSize.width &&
                                              report.canvasBackingSize.height === frameSize.height
                                          );
                                          const oneRowLarger = traceRuns.find(
                                            ({ report }) =>
                                              report.canvasType === canvasType &&
                                              report.canvasBackingSize.width === oneRowLargerSize.width &&
                                              report.canvasBackingSize.height === oneRowLargerSize.height
                                          );
                                          if (!baseline || !oneRowLarger) {
                                            throw new Error(
                                              `${canvasType} first-difference trace pair is incomplete at ${stage}`
                                            );
                                          }
                                          const directBaseline = replayCapturedDrawImageCalls(
                                            canvasType,
                                            frameSize,
                                            baseline.capturedDrawImageInvocations
                                          );
                                          const directOneRowLarger = replayCapturedDrawImageCalls(
                                            canvasType,
                                            oneRowLargerSize,
                                            baseline.capturedDrawImageInvocations
                                          );
                                          if (baseline.capturedDrawImageInvocations.length !== 1) {
                                            throw new Error(
                                              `${canvasType} padding control expected one captured drawImage call at ${stage}`
                                            );
                                          }
                                          const capturedInvocation = baseline.capturedDrawImageInvocations[0]!;
                                          if (capturedInvocation.arguments.length !== 4) {
                                            throw new Error(
                                              `${canvasType} padding control requires the captured five-argument drawImage overload at ${stage}`
                                            );
                                          }
                                          if (
                                            capturedInvocation.arguments.some(
                                              (argument) => typeof argument !== 'number'
                                            )
                                          ) {
                                            throw new Error(
                                              `${canvasType} padding control requires numeric drawImage arguments at ${stage}`
                                            );
                                          }
                                          const originalArguments = capturedInvocation.arguments as number[];
                                          if (!originalArguments.every(Number.isFinite)) {
                                            throw new Error(
                                              `${canvasType} padding control has non-finite drawImage arguments at ${stage}`
                                            );
                                          }
                                          const sourceSize = getImageSize(capturedInvocation.source);
                                          const [dx, dy, dw, dh] = originalArguments;
                                          if (
                                            dx === undefined ||
                                            dy === undefined ||
                                            dw === undefined ||
                                            dh === undefined
                                          ) {
                                            throw new Error(
                                              `${canvasType} padding control has incomplete destination geometry at ${stage}`
                                            );
                                          }
                                          if (dw <= 0 || dh <= 0 || sourceSize.width < 1 || sourceSize.height < 1) {
                                            throw new Error(
                                              `${canvasType} padding control has invalid destination geometry at ${stage}`
                                            );
                                          }
                                          const originalSourceFullRectangleArguments = [
                                            0,
                                            0,
                                            sourceSize.width,
                                            sourceSize.height,
                                            ...originalArguments,
                                          ];
                                          const originalSourceFullRectangleOverride = [
                                            {
                                              source: capturedInvocation.source,
                                              arguments: originalSourceFullRectangleArguments,
                                            },
                                          ];
                                          const originalSourceNineArgumentBaseline = replayCapturedDrawImageCalls(
                                            canvasType,
                                            frameSize,
                                            baseline.capturedDrawImageInvocations,
                                            originalSourceFullRectangleOverride
                                          );
                                          const originalSourceNineArgumentOneRowLarger = replayCapturedDrawImageCalls(
                                            canvasType,
                                            oneRowLargerSize,
                                            baseline.capturedDrawImageInvocations,
                                            originalSourceFullRectangleOverride
                                          );
                                          const originalSourceNineArgumentControl = {
                                            call: {
                                              argumentCount: originalSourceFullRectangleArguments.length + 1,
                                              numericArguments: originalSourceFullRectangleArguments,
                                              sourceRectangle: {
                                                x: 0,
                                                y: 0,
                                                width: sourceSize.width,
                                                height: sourceSize.height,
                                              },
                                              destinationRectangle: { x: dx, y: dy, width: dw, height: dh },
                                            },
                                            baseline: {
                                              ...originalSourceNineArgumentBaseline.report,
                                              comparisonToUnpaddedFiveArgument: compareBytes(
                                                Array.from(directBaseline.framePixels),
                                                Array.from(originalSourceNineArgumentBaseline.framePixels),
                                                frameSize.width,
                                                frameSize.height,
                                                frame.x,
                                                frame.y
                                              ),
                                            },
                                            oneRowLarger: {
                                              ...originalSourceNineArgumentOneRowLarger.report,
                                              comparisonToUnpaddedFiveArgument: compareBytes(
                                                Array.from(directOneRowLarger.framePixels),
                                                Array.from(originalSourceNineArgumentOneRowLarger.framePixels),
                                                frameSize.width,
                                                frameSize.height,
                                                frame.x,
                                                frame.y
                                              ),
                                            },
                                            backingHeightComparison: compareBytes(
                                              Array.from(originalSourceNineArgumentBaseline.framePixels),
                                              Array.from(originalSourceNineArgumentOneRowLarger.framePixels),
                                              frameSize.width,
                                              frameSize.height,
                                              frame.x,
                                              frame.y
                                            ),
                                          };
                                          const padding = 1;
                                          const scaleX = dw / sourceSize.width;
                                          const scaleY = dh / sourceSize.height;
                                          const paddedArguments = [
                                            dx - padding * scaleX,
                                            dy - padding * scaleY,
                                            dw + 2 * padding * scaleX,
                                            dh + 2 * padding * scaleY,
                                          ];
                                          const paddedInteriorArguments = [
                                            padding,
                                            padding,
                                            sourceSize.width,
                                            sourceSize.height,
                                            dx,
                                            dy,
                                            dw,
                                            dh,
                                          ];
                                          const paddedFullSourceArguments = [
                                            0,
                                            0,
                                            sourceSize.width + 2 * padding,
                                            sourceSize.height + 2 * padding,
                                            dx,
                                            dy,
                                            dw,
                                            dh,
                                          ];
                                          const paddedFullSourceMatchedGeometryArguments = [
                                            0,
                                            0,
                                            sourceSize.width + 2 * padding,
                                            sourceSize.height + 2 * padding,
                                            ...paddedArguments,
                                          ];
                                          const mappedOriginalInterior = {
                                            x: paddedArguments[0]! + padding * scaleX,
                                            y: paddedArguments[1]! + padding * scaleY,
                                            width: paddedArguments[2]! - 2 * padding * scaleX,
                                            height: paddedArguments[3]! - 2 * padding * scaleY,
                                          };
                                          const visibleMappingPreserved =
                                            Math.abs(mappedOriginalInterior.x - dx) < 1e-9 &&
                                            Math.abs(mappedOriginalInterior.y - dy) < 1e-9 &&
                                            Math.abs(mappedOriginalInterior.width - dw) < 1e-9 &&
                                            Math.abs(mappedOriginalInterior.height - dh) < 1e-9;
                                          const paddedSource = await createTransparentPaddedImageBitmap(
                                            capturedInvocation.source,
                                            padding
                                          );
                                          let edgeExtendedPaddedSource: Awaited<
                                            ReturnType<typeof createPaddedBitmapWithExtendedEdges>
                                          > | null = null;
                                          let rightEdgeOnlyPaddedSource: Awaited<
                                            ReturnType<typeof createPaddedBitmapWithExtendedEdges>
                                          > | null = null;
                                          let transparentPaddingControl;
                                          try {
                                            const edgeExtendedSource = await createPaddedBitmapWithExtendedEdges(
                                              capturedInvocation.source,
                                              padding,
                                              ['top', 'right', 'bottom', 'left']
                                            );
                                            edgeExtendedPaddedSource = edgeExtendedSource;
                                            const rightEdgeOnlySource = await createPaddedBitmapWithExtendedEdges(
                                              capturedInvocation.source,
                                              padding,
                                              ['right']
                                            );
                                            rightEdgeOnlyPaddedSource = rightEdgeOnlySource;
                                            const paddingOverride = [
                                              { source: paddedSource.bitmap, arguments: paddedArguments },
                                            ];
                                            const paddedBaseline = replayCapturedDrawImageCalls(
                                              canvasType,
                                              frameSize,
                                              baseline.capturedDrawImageInvocations,
                                              paddingOverride
                                            );
                                            const paddedOneRowLarger = replayCapturedDrawImageCalls(
                                              canvasType,
                                              oneRowLargerSize,
                                              baseline.capturedDrawImageInvocations,
                                              paddingOverride
                                            );
                                            const paddedInteriorOverride = [
                                              { source: paddedSource.bitmap, arguments: paddedInteriorArguments },
                                            ];
                                            const paddedInteriorBaseline = replayCapturedDrawImageCalls(
                                              canvasType,
                                              frameSize,
                                              baseline.capturedDrawImageInvocations,
                                              paddedInteriorOverride
                                            );
                                            const paddedInteriorOneRowLarger = replayCapturedDrawImageCalls(
                                              canvasType,
                                              oneRowLargerSize,
                                              baseline.capturedDrawImageInvocations,
                                              paddedInteriorOverride
                                            );
                                            const edgeExtendedInteriorOverride = [
                                              { source: edgeExtendedSource.bitmap, arguments: paddedInteriorArguments },
                                            ];
                                            const edgeExtendedInteriorBaseline = replayCapturedDrawImageCalls(
                                              canvasType,
                                              frameSize,
                                              baseline.capturedDrawImageInvocations,
                                              edgeExtendedInteriorOverride
                                            );
                                            const edgeExtendedInteriorOneRowLarger = replayCapturedDrawImageCalls(
                                              canvasType,
                                              oneRowLargerSize,
                                              baseline.capturedDrawImageInvocations,
                                              edgeExtendedInteriorOverride
                                            );
                                            const rightEdgeOnlyOverride = [
                                              {
                                                source: rightEdgeOnlySource.bitmap,
                                                arguments: paddedInteriorArguments,
                                              },
                                            ];
                                            const rightEdgeOnlyBaseline = replayCapturedDrawImageCalls(
                                              canvasType,
                                              frameSize,
                                              baseline.capturedDrawImageInvocations,
                                              rightEdgeOnlyOverride
                                            );
                                            const rightEdgeOnlyOneRowLarger = replayCapturedDrawImageCalls(
                                              canvasType,
                                              oneRowLargerSize,
                                              baseline.capturedDrawImageInvocations,
                                              rightEdgeOnlyOverride
                                            );
                                            const paddedFullSourceOverride = [
                                              { source: paddedSource.bitmap, arguments: paddedFullSourceArguments },
                                            ];
                                            const paddedFullSourceBaseline = replayCapturedDrawImageCalls(
                                              canvasType,
                                              frameSize,
                                              baseline.capturedDrawImageInvocations,
                                              paddedFullSourceOverride
                                            );
                                            const paddedFullSourceOneRowLarger = replayCapturedDrawImageCalls(
                                              canvasType,
                                              oneRowLargerSize,
                                              baseline.capturedDrawImageInvocations,
                                              paddedFullSourceOverride
                                            );
                                            const paddedFullSourceMatchedGeometryOverride = [
                                              {
                                                source: paddedSource.bitmap,
                                                arguments: paddedFullSourceMatchedGeometryArguments,
                                              },
                                            ];
                                            const paddedFullSourceMatchedGeometryBaseline =
                                              replayCapturedDrawImageCalls(
                                                canvasType,
                                                frameSize,
                                                baseline.capturedDrawImageInvocations,
                                                paddedFullSourceMatchedGeometryOverride
                                              );
                                            const paddedFullSourceMatchedGeometryOneRowLarger =
                                              replayCapturedDrawImageCalls(
                                                canvasType,
                                                oneRowLargerSize,
                                                baseline.capturedDrawImageInvocations,
                                                paddedFullSourceMatchedGeometryOverride
                                              );
                                            transparentPaddingControl = {
                                              source: paddedSource.report,
                                              originalSourceNineArgumentControl,
                                              mapping: {
                                                originalArguments,
                                                sourceSize,
                                                scaleX,
                                                scaleY,
                                                padding,
                                                paddedArguments,
                                                mappedOriginalInterior,
                                                visibleMappingPreserved,
                                              },
                                              baseline: {
                                                ...paddedBaseline.report,
                                                comparisonToUnpadded: compareBytes(
                                                  Array.from(directBaseline.framePixels),
                                                  Array.from(paddedBaseline.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              oneRowLarger: {
                                                ...paddedOneRowLarger.report,
                                                comparisonToUnpadded: compareBytes(
                                                  Array.from(directOneRowLarger.framePixels),
                                                  Array.from(paddedOneRowLarger.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              paddedHeightComparison: compareBytes(
                                                Array.from(paddedBaseline.framePixels),
                                                Array.from(paddedOneRowLarger.framePixels),
                                                frameSize.width,
                                                frameSize.height,
                                                frame.x,
                                                frame.y
                                              ),
                                              paddedInteriorNineArgumentControl: {
                                                call: {
                                                  argumentCount: paddedInteriorArguments.length + 1,
                                                  numericArguments: paddedInteriorArguments,
                                                  sourceRectangle: {
                                                    x: padding,
                                                    y: padding,
                                                    width: sourceSize.width,
                                                    height: sourceSize.height,
                                                  },
                                                  destinationRectangle: { x: dx, y: dy, width: dw, height: dh },
                                                },
                                                baseline: {
                                                  ...paddedInteriorBaseline.report,
                                                  comparisonToUnpadded: compareBytes(
                                                    Array.from(directBaseline.framePixels),
                                                    Array.from(paddedInteriorBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToOriginalSourceNineArgument: compareBytes(
                                                    Array.from(originalSourceNineArgumentBaseline.framePixels),
                                                    Array.from(paddedInteriorBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToFullPaddedFiveArgument: compareBytes(
                                                    Array.from(paddedBaseline.framePixels),
                                                    Array.from(paddedInteriorBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                oneRowLarger: {
                                                  ...paddedInteriorOneRowLarger.report,
                                                  comparisonToUnpadded: compareBytes(
                                                    Array.from(directOneRowLarger.framePixels),
                                                    Array.from(paddedInteriorOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToOriginalSourceNineArgument: compareBytes(
                                                    Array.from(originalSourceNineArgumentOneRowLarger.framePixels),
                                                    Array.from(paddedInteriorOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToFullPaddedFiveArgument: compareBytes(
                                                    Array.from(paddedOneRowLarger.framePixels),
                                                    Array.from(paddedInteriorOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                paddedHeightComparison: compareBytes(
                                                  Array.from(paddedInteriorBaseline.framePixels),
                                                  Array.from(paddedInteriorOneRowLarger.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              edgeExtendedBorderControl: {
                                                source: edgeExtendedSource.report,
                                                call: {
                                                  argumentCount: paddedInteriorArguments.length + 1,
                                                  numericArguments: paddedInteriorArguments,
                                                  sourceRectangle: {
                                                    x: padding,
                                                    y: padding,
                                                    width: sourceSize.width,
                                                    height: sourceSize.height,
                                                  },
                                                  destinationRectangle: { x: dx, y: dy, width: dw, height: dh },
                                                },
                                                baseline: {
                                                  ...edgeExtendedInteriorBaseline.report,
                                                  comparisonToTransparentBorder: compareBytes(
                                                    Array.from(paddedInteriorBaseline.framePixels),
                                                    Array.from(edgeExtendedInteriorBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToOriginalSourceNineArgument: compareBytes(
                                                    Array.from(originalSourceNineArgumentBaseline.framePixels),
                                                    Array.from(edgeExtendedInteriorBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                oneRowLarger: {
                                                  ...edgeExtendedInteriorOneRowLarger.report,
                                                  comparisonToTransparentBorder: compareBytes(
                                                    Array.from(paddedInteriorOneRowLarger.framePixels),
                                                    Array.from(edgeExtendedInteriorOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToOriginalSourceNineArgument: compareBytes(
                                                    Array.from(originalSourceNineArgumentOneRowLarger.framePixels),
                                                    Array.from(edgeExtendedInteriorOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                backingHeightComparison: compareBytes(
                                                  Array.from(edgeExtendedInteriorBaseline.framePixels),
                                                  Array.from(edgeExtendedInteriorOneRowLarger.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              rightEdgeOnlyControl: {
                                                source: rightEdgeOnlySource.report,
                                                call: {
                                                  argumentCount: paddedInteriorArguments.length + 1,
                                                  numericArguments: paddedInteriorArguments,
                                                  sourceRectangle: {
                                                    x: padding,
                                                    y: padding,
                                                    width: sourceSize.width,
                                                    height: sourceSize.height,
                                                  },
                                                  destinationRectangle: { x: dx, y: dy, width: dw, height: dh },
                                                },
                                                baseline: {
                                                  ...rightEdgeOnlyBaseline.report,
                                                  comparisonToTransparentBorder: compareBytes(
                                                    Array.from(paddedInteriorBaseline.framePixels),
                                                    Array.from(rightEdgeOnlyBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToOriginalSourceNineArgument: compareBytes(
                                                    Array.from(originalSourceNineArgumentBaseline.framePixels),
                                                    Array.from(rightEdgeOnlyBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToFullEdgeExtension: compareBytes(
                                                    Array.from(edgeExtendedInteriorBaseline.framePixels),
                                                    Array.from(rightEdgeOnlyBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                oneRowLarger: {
                                                  ...rightEdgeOnlyOneRowLarger.report,
                                                  comparisonToTransparentBorder: compareBytes(
                                                    Array.from(paddedInteriorOneRowLarger.framePixels),
                                                    Array.from(rightEdgeOnlyOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToOriginalSourceNineArgument: compareBytes(
                                                    Array.from(originalSourceNineArgumentOneRowLarger.framePixels),
                                                    Array.from(rightEdgeOnlyOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToFullEdgeExtension: compareBytes(
                                                    Array.from(edgeExtendedInteriorOneRowLarger.framePixels),
                                                    Array.from(rightEdgeOnlyOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                backingHeightComparison: compareBytes(
                                                  Array.from(rightEdgeOnlyBaseline.framePixels),
                                                  Array.from(rightEdgeOnlyOneRowLarger.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              paddedFullSourceNineArgumentControl: {
                                                call: {
                                                  argumentCount: paddedFullSourceArguments.length + 1,
                                                  numericArguments: paddedFullSourceArguments,
                                                  sourceRectangle: {
                                                    x: 0,
                                                    y: 0,
                                                    width: sourceSize.width + 2 * padding,
                                                    height: sourceSize.height + 2 * padding,
                                                  },
                                                  destinationRectangle: { x: dx, y: dy, width: dw, height: dh },
                                                },
                                                baseline: {
                                                  ...paddedFullSourceBaseline.report,
                                                  comparisonToUnpadded: compareBytes(
                                                    Array.from(directBaseline.framePixels),
                                                    Array.from(paddedFullSourceBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToInteriorNineArgument: compareBytes(
                                                    Array.from(paddedInteriorBaseline.framePixels),
                                                    Array.from(paddedFullSourceBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToFullPaddedFiveArgument: compareBytes(
                                                    Array.from(paddedBaseline.framePixels),
                                                    Array.from(paddedFullSourceBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                oneRowLarger: {
                                                  ...paddedFullSourceOneRowLarger.report,
                                                  comparisonToUnpadded: compareBytes(
                                                    Array.from(directOneRowLarger.framePixels),
                                                    Array.from(paddedFullSourceOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToInteriorNineArgument: compareBytes(
                                                    Array.from(paddedInteriorOneRowLarger.framePixels),
                                                    Array.from(paddedFullSourceOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                  comparisonToFullPaddedFiveArgument: compareBytes(
                                                    Array.from(paddedOneRowLarger.framePixels),
                                                    Array.from(paddedFullSourceOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                paddedHeightComparison: compareBytes(
                                                  Array.from(paddedFullSourceBaseline.framePixels),
                                                  Array.from(paddedFullSourceOneRowLarger.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              paddedFullSourceMatchedGeometryNineArgumentControl: {
                                                call: {
                                                  argumentCount: paddedFullSourceMatchedGeometryArguments.length + 1,
                                                  numericArguments: paddedFullSourceMatchedGeometryArguments,
                                                  sourceRectangle: {
                                                    x: 0,
                                                    y: 0,
                                                    width: sourceSize.width + 2 * padding,
                                                    height: sourceSize.height + 2 * padding,
                                                  },
                                                  destinationRectangle: {
                                                    x: paddedArguments[0],
                                                    y: paddedArguments[1],
                                                    width: paddedArguments[2],
                                                    height: paddedArguments[3],
                                                  },
                                                },
                                                baseline: {
                                                  ...paddedFullSourceMatchedGeometryBaseline.report,
                                                  comparisonToFullPaddedFiveArgument: compareBytes(
                                                    Array.from(paddedBaseline.framePixels),
                                                    Array.from(paddedFullSourceMatchedGeometryBaseline.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                oneRowLarger: {
                                                  ...paddedFullSourceMatchedGeometryOneRowLarger.report,
                                                  comparisonToFullPaddedFiveArgument: compareBytes(
                                                    Array.from(paddedOneRowLarger.framePixels),
                                                    Array.from(paddedFullSourceMatchedGeometryOneRowLarger.framePixels),
                                                    frameSize.width,
                                                    frameSize.height,
                                                    frame.x,
                                                    frame.y
                                                  ),
                                                },
                                                paddedHeightComparison: compareBytes(
                                                  Array.from(paddedFullSourceMatchedGeometryBaseline.framePixels),
                                                  Array.from(paddedFullSourceMatchedGeometryOneRowLarger.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                            };
                                          } finally {
                                            rightEdgeOnlyPaddedSource?.bitmap.close();
                                            edgeExtendedPaddedSource?.bitmap.close();
                                            paddedSource.bitmap.close();
                                          }
                                          const callSignature = (calls: Array<Record<string, unknown>>) =>
                                            calls.map((call) => ({
                                              sourceIdentity: call.sourceIdentity,
                                              numericArguments: call.numericArguments,
                                              sourceRect: call.sourceRect,
                                              destinationRect: call.destinationRect,
                                              contextBeforeDraw: call.contextBeforeDraw,
                                            }));
                                          const baselineCalls = baseline.report.drawImageCalls as Array<
                                            Record<string, unknown>
                                          >;
                                          const oneRowLargerCalls = oneRowLarger.report.drawImageCalls as Array<
                                            Record<string, unknown>
                                          >;
                                          const originalFrameComparison = compareBytes(
                                            Array.from(baseline.framePixels),
                                            Array.from(oneRowLarger.framePixels),
                                            frameSize.width,
                                            frameSize.height,
                                            frame.x,
                                            frame.y
                                          );
                                          return {
                                            canvasType,
                                            inputSourceIdentityStable:
                                              JSON.stringify(
                                                baselineCalls.map(({ sourceIdentity }) => sourceIdentity)
                                              ) ===
                                              JSON.stringify(
                                                oneRowLargerCalls.map(({ sourceIdentity }) => sourceIdentity)
                                              ),
                                            drawImageCallSignatureStable:
                                              JSON.stringify(callSignature(baselineCalls)) ===
                                              JSON.stringify(callSignature(oneRowLargerCalls)),
                                            samplePixelComparison: compareBytes(
                                              Array.from(baseline.report.readbackSample.rgba as number[]),
                                              Array.from(oneRowLarger.report.readbackSample.rgba as number[]),
                                              1,
                                              1,
                                              frame.x + sampleFramePixel.x,
                                              frame.y + sampleFramePixel.y
                                            ),
                                            originalFrameComparison,
                                            directDrawImageReproduction: {
                                              baseline: {
                                                ...directBaseline.report,
                                                comparisonToDrawLayerSource: compareBytes(
                                                  Array.from(baseline.framePixels),
                                                  Array.from(directBaseline.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              oneRowLarger: {
                                                ...directOneRowLarger.report,
                                                comparisonToDrawLayerSource: compareBytes(
                                                  Array.from(oneRowLarger.framePixels),
                                                  Array.from(directOneRowLarger.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              },
                                              originalFrameComparison: compareBytes(
                                                Array.from(directBaseline.framePixels),
                                                Array.from(directOneRowLarger.framePixels),
                                                frameSize.width,
                                                frameSize.height,
                                                frame.x,
                                                frame.y
                                              ),
                                            },
                                            transparentPaddingControl,
                                            baseline: baseline.report,
                                            oneRowLarger: oneRowLarger.report,
                                          };
                                        };
                                        const traceReportByCanvasType: Array<
                                          Awaited<ReturnType<typeof buildTraceReportForCanvasType>>
                                        > = [];
                                        for (const canvasType of canvasTypes) {
                                          traceReportByCanvasType.push(await buildTraceReportForCanvasType(canvasType));
                                        }
                                        const htmlOffscreenComparisons = offscreenCanvasAvailable
                                          ? [frameSize, oneRowLargerSize].map((backingSize) => {
                                              const html = traceRuns.find(
                                                ({ report }) =>
                                                  report.canvasType === 'HTMLCanvas' &&
                                                  report.canvasBackingSize.width === backingSize.width &&
                                                  report.canvasBackingSize.height === backingSize.height
                                              );
                                              const offscreen = traceRuns.find(
                                                ({ report }) =>
                                                  report.canvasType === 'OffscreenCanvas' &&
                                                  report.canvasBackingSize.width === backingSize.width &&
                                                  report.canvasBackingSize.height === backingSize.height
                                              );
                                              if (!html || !offscreen) {
                                                throw new Error(`Canvas-type comparison is incomplete at ${stage}`);
                                              }
                                              return {
                                                backingSize,
                                                outputSampleComparison: compareBytes(
                                                  Array.from(html.report.readbackSample.rgba as number[]),
                                                  Array.from(offscreen.report.readbackSample.rgba as number[]),
                                                  1,
                                                  1,
                                                  frame.x + sampleFramePixel.x,
                                                  frame.y + sampleFramePixel.y
                                                ),
                                                originalFrameComparison: compareBytes(
                                                  Array.from(html.framePixels),
                                                  Array.from(offscreen.framePixels),
                                                  frameSize.width,
                                                  frameSize.height,
                                                  frame.x,
                                                  frame.y
                                                ),
                                              };
                                            })
                                          : [];
                                        return {
                                          report: {
                                            target: {
                                              firstDifferenceSelection: {
                                                measurementStatus: firstDifferenceSelection.measurementStatus,
                                                comparedPixels: firstDifferenceSelection.comparedPixels,
                                                differingBytes:
                                                  firstDifferenceSelection.pixelComparison?.differingBytes ?? 0,
                                                status: firstDifferingPixel ? 'found' : 'none',
                                                firstDifferingFrameLocalPixelCell: firstDifferingPixel
                                                  ? { x: firstDifferingPixel.x, y: firstDifferingPixel.y }
                                                  : null,
                                                firstDifferingDocumentPixelCell: firstDifferingPixel
                                                  ? {
                                                      x: firstDifferingPixel.documentX,
                                                      y: firstDifferingPixel.documentY,
                                                    }
                                                  : null,
                                              },
                                              sampleFrameLocalPixelCell: sampleFramePixel,
                                              frameLocalBackingPixelCenter: sampleBackingPoint,
                                              documentPixelCellOrigin: {
                                                x: frame.x + sampleFramePixel.x,
                                                y: frame.y + sampleFramePixel.y,
                                              },
                                              documentPixelCenter: {
                                                x: frame.x + sampleBackingPoint.x,
                                                y: frame.y + sampleBackingPoint.y,
                                              },
                                              baselineBackingSize: frameSize,
                                              oneRowLargerBackingSize: oneRowLargerSize,
                                            },
                                            offscreenCanvasAvailable,
                                            canvasTypeComparisons: traceReportByCanvasType,
                                            htmlOffscreenComparisons,
                                          },
                                        };
                                      })()
                                    : null;
                                const firstDifferenceTraceReport = firstDifferenceTraceControls
                                  ? (await firstDifferenceTraceControls).report
                                  : null;
                                const physicalBackingSizeMatrixControls =
                                  widthOnly && heightOnly
                                    ? (() => {
                                        const heights = Array.from(
                                          new Set([
                                            frameSize.height,
                                            Math.min(legacy.rasterSize.height, frameSize.height + 1),
                                            Math.min(legacy.rasterSize.height, frameSize.height + 5),
                                            legacy.rasterSize.height,
                                          ])
                                        );
                                        const widths = [frameSize.width, legacy.rasterSize.width];
                                        const surfaceBySize = new Map<string, DiagnosticPixelSurface>();
                                        const sizeKey = (width: number, height: number) => `${width}x${height}`;
                                        for (const width of widths) {
                                          for (const height of heights) {
                                            let surface: DiagnosticPixelSurface;
                                            if (width === frameSize.width && height === frameSize.height) {
                                              surface = baseline;
                                            } else if (
                                              width === widthOnlySize.width &&
                                              height === widthOnlySize.height
                                            ) {
                                              surface = widthOnly;
                                            } else if (
                                              width === heightOnlySize.width &&
                                              height === heightOnlySize.height
                                            ) {
                                              surface = heightOnly;
                                            } else if (
                                              width === legacy.rasterSize.width &&
                                              height === legacy.rasterSize.height
                                            ) {
                                              surface = extentOnly;
                                            } else {
                                              surface = {
                                                pixels: renderLayerSurfacePixels(layer, label, frame, {
                                                  width,
                                                  height,
                                                }),
                                                pixelSize: { width, height },
                                                originOffset: { x: 0, y: 0 },
                                              };
                                            }
                                            surfaceBySize.set(sizeKey(width, height), surface);
                                          }
                                        }
                                        const originalFrameRegion = {
                                          x: 0,
                                          y: 0,
                                          width: frameSize.width,
                                          height: frameSize.height,
                                        };
                                        const cropToOriginalFrame = (surface: DiagnosticPixelSurface) =>
                                          cropDiagnosticSurface(surface, originalFrameRegion);
                                        const surfaceAt = (width: number, height: number) => {
                                          const surface = surfaceBySize.get(sizeKey(width, height));
                                          if (!surface) {
                                            throw new Error(
                                              `${label} physical-backing matrix is missing ${width}x${height} at ${stage}`
                                            );
                                          }
                                          return cropToOriginalFrame(surface);
                                        };
                                        const premultiplyFrameSurface = (surface: DiagnosticPixelSurface) => {
                                          const pixels = new Uint8ClampedArray(surface.pixels.length);
                                          for (let offset = 0; offset < surface.pixels.length; offset += 4) {
                                            const alpha = surface.pixels[offset + 3] ?? 0;
                                            pixels[offset] = Math.round(((surface.pixels[offset] ?? 0) * alpha) / 255);
                                            pixels[offset + 1] = Math.round(
                                              ((surface.pixels[offset + 1] ?? 0) * alpha) / 255
                                            );
                                            pixels[offset + 2] = Math.round(
                                              ((surface.pixels[offset + 2] ?? 0) * alpha) / 255
                                            );
                                            pixels[offset + 3] = alpha;
                                          }
                                          return { ...surface, pixels };
                                        };
                                        const compareFrameSurfaces = (
                                          expected: DiagnosticPixelSurface,
                                          received: DiagnosticPixelSurface
                                        ) => ({
                                          raw: compareRasterOverlap(expected, received),
                                          premultiplied: compareRasterOverlap(
                                            premultiplyFrameSurface(expected),
                                            premultiplyFrameSurface(received)
                                          ),
                                        });
                                        const baselineFrame = surfaceAt(frameSize.width, frameSize.height);
                                        return {
                                          report: {
                                            originalFrameComparedPixels: frameSize.width * frameSize.height,
                                            physicalBackingSizes: heights.flatMap((height) =>
                                              widths.map((width) => ({
                                                backingPixelSize: { width, height },
                                                frameRegionVsBaseline: compareFrameSurfaces(
                                                  baselineFrame,
                                                  surfaceAt(width, height)
                                                ),
                                              }))
                                            ),
                                            widthExtensionAtEachHeight: heights.map((height) => ({
                                              backingHeight: height,
                                              width51VsWidth89: compareFrameSurfaces(
                                                surfaceAt(frameSize.width, height),
                                                surfaceAt(legacy.rasterSize.width, height)
                                              ),
                                            })),
                                            widthHeightInteractionAtEachExpandedHeight: heights
                                              .filter((height) => height > frameSize.height)
                                              .map((height) => ({
                                                backingHeight: height,
                                                interaction: compareWidthHeightExtentInteraction(
                                                  baselineFrame,
                                                  surfaceAt(legacy.rasterSize.width, frameSize.height),
                                                  surfaceAt(frameSize.width, height),
                                                  surfaceAt(legacy.rasterSize.width, height)
                                                ),
                                              })),
                                            firstDifferenceTraceControls: firstDifferenceTraceReport,
                                          },
                                        };
                                      })()
                                    : null;
                                const getPairedAddedStripRegion = (
                                  axisOnly: DiagnosticPixelSurface,
                                  axis: 'width' | 'height'
                                ) => {
                                  const sharedRegion = getSharedDocumentRegion([axisOnly, combined]);
                                  const frameEdge = axis === 'width' ? frameSize.width : frameSize.height;
                                  if (axis === 'width') {
                                    const x = Math.max(sharedRegion.x, axisOnly.originOffset.x + frameEdge);
                                    return {
                                      x,
                                      y: sharedRegion.y,
                                      width: Math.max(0, sharedRegion.x + sharedRegion.width - x),
                                      height: sharedRegion.height,
                                    };
                                  }
                                  const y = Math.max(sharedRegion.y, axisOnly.originOffset.y + frameEdge);
                                  return {
                                    x: sharedRegion.x,
                                    y,
                                    width: sharedRegion.width,
                                    height: Math.max(0, sharedRegion.y + sharedRegion.height - y),
                                  };
                                };
                                const buildAxisExtentControl = (
                                  axisOnly: DiagnosticPixelSurface,
                                  axisOnlySize: typeof frameSize,
                                  axis: 'width' | 'height'
                                ) => {
                                  const outsideFrameAlphaPixels = countNonTransparentPixelsOutsideFrame(
                                    axisOnly.pixels,
                                    axisOnly.pixelSize,
                                    axisOnly.originOffset
                                  );
                                  const pairedAddedStripRegion = getPairedAddedStripRegion(axisOnly, axis);
                                  const pairedAddedStripPixels =
                                    pairedAddedStripRegion.width * pairedAddedStripRegion.height;
                                  const addedStripVsPsdBoundsCombined =
                                    pairedAddedStripPixels > 0
                                      ? compareRasterOverlap(
                                          cropDiagnosticSurface(axisOnly, pairedAddedStripRegion),
                                          cropDiagnosticSurface(combined, pairedAddedStripRegion)
                                        )
                                      : {
                                          measurementStatus: 'empty-region',
                                          comparedPixels: 0,
                                          documentRegionLocal: pairedAddedStripRegion,
                                          expectedExcludedPixels: axisOnlySize.width * axisOnlySize.height,
                                          receivedExcludedPixels: legacy.rasterSize.width * legacy.rasterSize.height,
                                          pixelComparison: null,
                                        };
                                  return {
                                    targetOriginDocument: { x: frame.x, y: frame.y },
                                    targetLogicalFrameSize: { width: frame.width, height: frame.height },
                                    pixelSize: axisOnlySize,
                                    addedBackingPixels:
                                      axisOnlySize.width * axisOnlySize.height - frameSize.width * frameSize.height,
                                    outsideFrameAlphaPixels,
                                    frameRegionVsBaseline: compareRasterOverlap(baseline, axisOnly),
                                    sharedDocumentRegionVsPsdBoundsCombined: compareRasterOverlap(axisOnly, combined),
                                    pairedAddedStripRegion,
                                    pairedAddedStripPixels,
                                    unpairedAddedStripPixels:
                                      outsideFrameAlphaPixels.comparedPixels - pairedAddedStripPixels,
                                    pairedAddedStripVsPsdBoundsCombined: addedStripVsPsdBoundsCombined,
                                  };
                                };
                                const combinedVsPreEncode = compareBytes(
                                  Array.from(combined.pixels),
                                  Array.from(preEncodePixels),
                                  legacy.rasterSize.width,
                                  legacy.rasterSize.height,
                                  psdBoundsTargetFrame.x,
                                  psdBoundsTargetFrame.y
                                );
                                if (combinedVsPreEncode.differingBytes !== 0) {
                                  throw new Error(
                                    `${label} PSD-bounds combined control did not reproduce its pre-encode raster at ${stage}`
                                  );
                                }
                                return {
                                  surfaces: {
                                    baseline,
                                    originOnly,
                                    extentOnly,
                                    combined,
                                    widthOnly,
                                    heightOnly,
                                    commonBackingClip: commonBackingClipControls?.surfaces ?? null,
                                  },
                                  report: {
                                    originOnlyControl: {
                                      targetOriginDocument: {
                                        x: psdBoundsTargetFrame.x,
                                        y: psdBoundsTargetFrame.y,
                                      },
                                      targetLogicalFrameSize: { width: frame.width, height: frame.height },
                                      pixelSize: frameSize,
                                      frameRegionVsBaseline: compareRasterOverlap(baseline, originOnly),
                                    },
                                    extentOnlyControl: {
                                      targetOriginDocument: { x: frame.x, y: frame.y },
                                      targetLogicalFrameSize: { width: frame.width, height: frame.height },
                                      pixelSize: legacy.rasterSize,
                                      backingPixelDeltaFromFrame:
                                        legacy.rasterSize.width * legacy.rasterSize.height -
                                        frameSize.width * frameSize.height,
                                      outsideFrameAlphaPixels: countNonTransparentPixelsOutsideFrame(
                                        extentOnly.pixels,
                                        extentOnly.pixelSize,
                                        extentOnly.originOffset
                                      ),
                                      frameRegionVsBaseline: compareRasterOverlap(baseline, extentOnly),
                                    },
                                    combinedControl: {
                                      targetOriginDocument: {
                                        x: psdBoundsTargetFrame.x,
                                        y: psdBoundsTargetFrame.y,
                                      },
                                      targetLogicalFrameSize: { width: frame.width, height: frame.height },
                                      pixelSize: legacy.rasterSize,
                                      outsideFrameAlphaPixels: countNonTransparentPixelsOutsideFrame(
                                        combined.pixels,
                                        combined.pixelSize,
                                        combined.originOffset
                                      ),
                                      frameRegionVsBaseline: compareRasterOverlap(baseline, combined),
                                      originOnlyVsCombinedAtSameOrigin: compareRasterOverlap(originOnly, combined),
                                      extentOnlyVsCombinedAtSharedDocumentCells: compareRasterOverlap(
                                        extentOnly,
                                        combined
                                      ),
                                      exactPreEncodeReproduction: combinedVsPreEncode,
                                    },
                                    originExtentInteraction: compareOriginExtentInteraction(
                                      baseline,
                                      originOnly,
                                      extentOnly,
                                      combined
                                    ),
                                    axisExtentControls:
                                      widthOnly && heightOnly
                                        ? {
                                            widthOnly: buildAxisExtentControl(widthOnly, widthOnlySize, 'width'),
                                            heightOnly: buildAxisExtentControl(heightOnly, heightOnlySize, 'height'),
                                            widthHeightInteraction: compareWidthHeightExtentInteraction(
                                              baseline,
                                              widthOnly,
                                              heightOnly,
                                              combined
                                            ),
                                          }
                                        : null,
                                    commonBackingClipControls: commonBackingClipControls?.report ?? null,
                                    physicalBackingSizeMatrixControls:
                                      physicalBackingSizeMatrixControls?.report ?? null,
                                  },
                                };
                              };
                              const legacyControl = await buildPsdBoundsControl(
                                legacyLayer,
                                'Legacy',
                                legacyFramePixels,
                                legacy.pixels
                              );
                              const durableControl = await buildPsdBoundsControl(
                                durableLayer,
                                'Durable',
                                durableFramePixels,
                                durable.pixels
                              );
                              const axisExtentControlsAvailable =
                                legacyControl.surfaces.widthOnly !== null && legacyControl.surfaces.heightOnly !== null;
                              return {
                                boundsLocalToFrame: legacy.bounds,
                                targetOriginDocument: {
                                  x: psdBoundsTargetFrame.x,
                                  y: psdBoundsTargetFrame.y,
                                },
                                targetLogicalFrameSize: { width: frame.width, height: frame.height },
                                pixelSize: legacy.rasterSize,
                                legacy: legacyControl.report,
                                durable: durableControl.report,
                                legacyVsDurable: {
                                  originOnly: compareBytes(
                                    Array.from(legacyControl.surfaces.originOnly.pixels),
                                    Array.from(durableControl.surfaces.originOnly.pixels),
                                    frameSize.width,
                                    frameSize.height,
                                    psdBoundsTargetFrame.x,
                                    psdBoundsTargetFrame.y
                                  ),
                                  extentOnly: compareBytes(
                                    Array.from(legacyControl.surfaces.extentOnly.pixels),
                                    Array.from(durableControl.surfaces.extentOnly.pixels),
                                    legacy.rasterSize.width,
                                    legacy.rasterSize.height,
                                    frame.x,
                                    frame.y
                                  ),
                                  combined: compareBytes(
                                    Array.from(legacyControl.surfaces.combined.pixels),
                                    Array.from(durableControl.surfaces.combined.pixels),
                                    legacy.rasterSize.width,
                                    legacy.rasterSize.height,
                                    psdBoundsTargetFrame.x,
                                    psdBoundsTargetFrame.y
                                  ),
                                  widthOnly: axisExtentControlsAvailable
                                    ? compareBytes(
                                        Array.from(legacyControl.surfaces.widthOnly!.pixels),
                                        Array.from(durableControl.surfaces.widthOnly!.pixels),
                                        legacyControl.surfaces.widthOnly!.pixelSize.width,
                                        legacyControl.surfaces.widthOnly!.pixelSize.height,
                                        frame.x,
                                        frame.y
                                      )
                                    : null,
                                  heightOnly: axisExtentControlsAvailable
                                    ? compareBytes(
                                        Array.from(legacyControl.surfaces.heightOnly!.pixels),
                                        Array.from(durableControl.surfaces.heightOnly!.pixels),
                                        legacyControl.surfaces.heightOnly!.pixelSize.width,
                                        legacyControl.surfaces.heightOnly!.pixelSize.height,
                                        frame.x,
                                        frame.y
                                      )
                                    : null,
                                },
                              };
                            })()
                          : null;
                      return [
                        id,
                        {
                          legacyBounds: legacy.bounds,
                          durableBounds: durable.bounds,
                          legacyRasterSize: legacy.rasterSize,
                          durableRasterSize: durable.rasterSize,
                          sameBounds,
                          sameRasterSize,
                          psdBoundsControl: await psdBoundsControl,
                          frameSurfaceComparison: compareBytes(
                            Array.from(legacyFramePixels),
                            Array.from(durableFramePixels),
                            frameSize.width,
                            frameSize.height,
                            frame.x,
                            frame.y
                          ),
                          originShiftOnlyControl: {
                            targetOriginDocument: {
                              x: originShiftedTargetFrame.x,
                              y: originShiftedTargetFrame.y,
                            },
                            targetLogicalFrameSize: { width: frame.width, height: frame.height },
                            pixelSize: frameSize,
                            legacyVsDurable: compareBytes(
                              Array.from(legacyOriginShiftOnlyPixels),
                              Array.from(durableOriginShiftOnlyPixels),
                              frameSize.width,
                              frameSize.height,
                              originShiftedTargetFrame.x,
                              originShiftedTargetFrame.y
                            ),
                            originalFrameRegionVsFrameSurface: {
                              legacy: compareRasterOverlap(
                                { pixels: legacyFramePixels, pixelSize: frameSize, originOffset: { x: 0, y: 0 } },
                                {
                                  pixels: legacyOriginShiftOnlyPixels,
                                  pixelSize: frameSize,
                                  originOffset: { x: -frameGridPadding, y: -frameGridPadding },
                                }
                              ),
                              durable: compareRasterOverlap(
                                { pixels: durableFramePixels, pixelSize: frameSize, originOffset: { x: 0, y: 0 } },
                                {
                                  pixels: durableOriginShiftOnlyPixels,
                                  pixelSize: frameSize,
                                  originOffset: { x: -frameGridPadding, y: -frameGridPadding },
                                }
                              ),
                            },
                          },
                          extentOnlyControl: {
                            targetOriginDocument: { x: frame.x, y: frame.y },
                            targetLogicalFrameSize: { width: frame.width, height: frame.height },
                            pixelSize: paddedFrameSize,
                            addedBackingPixels:
                              paddedFrameSize.width * paddedFrameSize.height - frameSize.width * frameSize.height,
                            addedAreaAlphaPixels: {
                              legacy: countNonTransparentPixelsOutsideFrame(legacyExtentOnlyPixels, paddedFrameSize),
                              durable: countNonTransparentPixelsOutsideFrame(durableExtentOnlyPixels, paddedFrameSize),
                            },
                            legacyVsDurable: compareBytes(
                              Array.from(legacyExtentOnlyPixels),
                              Array.from(durableExtentOnlyPixels),
                              paddedFrameSize.width,
                              paddedFrameSize.height,
                              frame.x,
                              frame.y
                            ),
                            originalFrameRegionVsFrameSurface: {
                              legacy: compareRasterOverlap(
                                { pixels: legacyFramePixels, pixelSize: frameSize, originOffset: { x: 0, y: 0 } },
                                {
                                  pixels: legacyExtentOnlyPixels,
                                  pixelSize: paddedFrameSize,
                                  originOffset: { x: 0, y: 0 },
                                }
                              ),
                              durable: compareRasterOverlap(
                                { pixels: durableFramePixels, pixelSize: frameSize, originOffset: { x: 0, y: 0 } },
                                {
                                  pixels: durableExtentOnlyPixels,
                                  pixelSize: paddedFrameSize,
                                  originOffset: { x: 0, y: 0 },
                                }
                              ),
                            },
                          },
                          paddedFrameControl: {
                            paddingPixels: frameGridPadding,
                            targetOriginDocument: {
                              x: frame.x - frameGridPadding,
                              y: frame.y - frameGridPadding,
                            },
                            targetLogicalFrameSize: { width: frame.width, height: frame.height },
                            pixelSize: paddedFrameSize,
                            legacyVsDurable: compareBytes(
                              Array.from(legacyPaddedFramePixels),
                              Array.from(durablePaddedFramePixels),
                              paddedFrameSize.width,
                              paddedFrameSize.height,
                              frame.x - frameGridPadding,
                              frame.y - frameGridPadding
                            ),
                            originalInteriorVsFrameSurface: {
                              legacy: compareBytes(
                                Array.from(legacyFramePixels),
                                Array.from(legacyPaddedFrameInterior),
                                frameSize.width,
                                frameSize.height,
                                frame.x,
                                frame.y
                              ),
                              durable: compareBytes(
                                Array.from(durableFramePixels),
                                Array.from(durablePaddedFrameInterior),
                                frameSize.width,
                                frameSize.height,
                                frame.x,
                                frame.y
                              ),
                            },
                            originExtentInteraction: {
                              channelOrder: ['r', 'g', 'b', 'a'],
                              legacy: compareOriginExtentInteraction(
                                { pixels: legacyFramePixels, pixelSize: frameSize, originOffset: { x: 0, y: 0 } },
                                {
                                  pixels: legacyOriginShiftOnlyPixels,
                                  pixelSize: frameSize,
                                  originOffset: { x: -frameGridPadding, y: -frameGridPadding },
                                },
                                {
                                  pixels: legacyExtentOnlyPixels,
                                  pixelSize: paddedFrameSize,
                                  originOffset: { x: 0, y: 0 },
                                },
                                {
                                  pixels: legacyPaddedFramePixels,
                                  pixelSize: paddedFrameSize,
                                  originOffset: { x: -frameGridPadding, y: -frameGridPadding },
                                }
                              ),
                              durable: compareOriginExtentInteraction(
                                { pixels: durableFramePixels, pixelSize: frameSize, originOffset: { x: 0, y: 0 } },
                                {
                                  pixels: durableOriginShiftOnlyPixels,
                                  pixelSize: frameSize,
                                  originOffset: { x: -frameGridPadding, y: -frameGridPadding },
                                },
                                {
                                  pixels: durableExtentOnlyPixels,
                                  pixelSize: paddedFrameSize,
                                  originOffset: { x: 0, y: 0 },
                                },
                                {
                                  pixels: durablePaddedFramePixels,
                                  pixelSize: paddedFrameSize,
                                  originOffset: { x: -frameGridPadding, y: -frameGridPadding },
                                }
                              ),
                            },
                            frameGridCopyAgainstPreEncode:
                              sameBounds && sameRasterSize
                                ? {
                                    legacy: {
                                      inFrame: comparePsdRasterRegion(
                                        legacyPaddedFrameGridCopy,
                                        legacy.pixels,
                                        legacy.bounds,
                                        legacy.rasterSize,
                                        'in-frame'
                                      ),
                                      paddingRing: comparePsdRasterRegion(
                                        legacyPaddedFrameGridCopy,
                                        legacy.pixels,
                                        legacy.bounds,
                                        legacy.rasterSize,
                                        'padding-ring',
                                        frameGridPadding
                                      ),
                                    },
                                    durable: {
                                      inFrame: comparePsdRasterRegion(
                                        durablePaddedFrameGridCopy,
                                        durable.pixels,
                                        durable.bounds,
                                        durable.rasterSize,
                                        'in-frame'
                                      ),
                                      paddingRing: comparePsdRasterRegion(
                                        durablePaddedFrameGridCopy,
                                        durable.pixels,
                                        durable.bounds,
                                        durable.rasterSize,
                                        'padding-ring',
                                        frameGridPadding
                                      ),
                                    },
                                  }
                                : null,
                          },
                          preEncodeDifferenceByFrameRegion:
                            sameBounds && sameRasterSize
                              ? {
                                  inFrame: comparePsdRasterRegion(
                                    legacy.pixels,
                                    durable.pixels,
                                    legacy.bounds,
                                    legacy.rasterSize,
                                    'in-frame'
                                  ),
                                  outOfFrame: comparePsdRasterRegion(
                                    legacy.pixels,
                                    durable.pixels,
                                    legacy.bounds,
                                    legacy.rasterSize,
                                    'out-of-frame'
                                  ),
                                }
                              : null,
                          frameGridCopyAgainstPreEncode:
                            sameBounds && sameRasterSize
                              ? {
                                  legacy: comparePsdRasterRegion(
                                    legacyFrameGridCopy,
                                    legacy.pixels,
                                    legacy.bounds,
                                    legacy.rasterSize,
                                    'in-frame'
                                  ),
                                  durable: comparePsdRasterRegion(
                                    durableFrameGridCopy,
                                    durable.pixels,
                                    durable.bounds,
                                    durable.rasterSize,
                                    'in-frame'
                                  ),
                                }
                              : null,
                          pixelComparison:
                            sameBounds && sameRasterSize
                              ? compareBytes(
                                  legacy.pixels,
                                  durable.pixels,
                                  legacy.rasterSize.width,
                                  legacy.rasterSize.height,
                                  frame.x + legacy.bounds.left,
                                  frame.y + legacy.bounds.top
                                )
                              : null,
                        },
                      ] as const;
                    })
                  )
                );
                const diagnosticLayerIds = projectedLayers
                  .filter((layer) => layer.opacity !== 1 || layer.blendMode !== 'source-over')
                  .map((layer) => layer.id);
                if (diagnosticLayerIds.length > 1) {
                  throw new Error(
                    `Expected at most one non-default compositing layer for source/backdrop diagnostics at ${stage}, got ${diagnosticLayerIds.length}: ${diagnosticLayerIds.join(', ')}`
                  );
                }
                const diagnosticLayerId = diagnosticLayerIds[0];
                const sourceBackdropSamples = (() => {
                  if (!diagnosticLayerId) return null;
                  const legacyLayer = legacyReplay.layers[diagnosticLayerId];
                  const materializedLayer = composite.layers[diagnosticLayerId];
                  const projectedLayer = projection.layers[diagnosticLayerId];
                  if (!legacyLayer || !materializedLayer || !projectedLayer) {
                    throw new Error(`Missing diagnostic source or backdrop layer ${diagnosticLayerId} at ${stage}`);
                  }
                  const createSampleSurface = (label: string) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = frameSize.width;
                    canvas.height = frameSize.height;
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error(`${label} has no 2D context at ${stage}`);
                    context.setTransform(1, 0, 0, 1, 0, 0);
                    context.globalAlpha = 1;
                    context.globalCompositeOperation = 'source-over';
                    context.imageSmoothingEnabled = false;
                    context.clearRect(0, 0, frameSize.width, frameSize.height);
                    return { canvas, context };
                  };
                  const legacySource = createSampleSurface('Legacy diagnostic source');
                  if (
                    !drawLayer(legacySource.context, { ...legacyLayer, opacity: 1, blendMode: 'source-over' }, frame)
                  ) {
                    throw new Error(`Legacy diagnostic source refused ${diagnosticLayerId} at ${stage}`);
                  }
                  const durableSource = createSampleSurface('Durable diagnostic source');
                  durableSource.context.drawImage(
                    materializedLayer.bitmap as CanvasImageSource,
                    materializedLayer.bounds.x - frame.x,
                    materializedLayer.bounds.y - frame.y,
                    materializedLayer.bounds.width,
                    materializedLayer.bounds.height
                  );
                  const legacyBackdrop = createSampleSurface('Legacy diagnostic backdrop');
                  const legacyBackdropLayers = legacyLayers
                    .filter((layer) => layer.order < legacyLayer.order)
                    .sort((left, right) => left.order - right.order);
                  if (
                    legacyBackdropLayers.length > 0 &&
                    !drawLayersToCanvas(legacyBackdrop.canvas, legacyBackdropLayers, frame)
                  ) {
                    throw new Error(`Legacy diagnostic backdrop refused ${diagnosticLayerId} at ${stage}`);
                  }
                  const durableBackdrop = createSampleSurface('Durable diagnostic backdrop');
                  const durableBackdropLayers = projectedLayers
                    .filter((layer) => layer.order < projectedLayer.order)
                    .sort((left, right) => left.order - right.order);
                  if (
                    durableBackdropLayers.length > 0 &&
                    !drawLayersToCanvas(durableBackdrop.canvas, durableBackdropLayers, frame)
                  ) {
                    throw new Error(`Durable diagnostic backdrop refused ${diagnosticLayerId} at ${stage}`);
                  }
                  const readPixels = (canvas: HTMLCanvasElement) => {
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error(`A diagnostic surface lost its 2D context at ${stage}`);
                    return context.getImageData(0, 0, frameSize.width, frameSize.height).data;
                  };
                  const rgbaAt = (pixels: ArrayLike<number>, x: number, y: number) => {
                    const offset = (y * frameSize.width + x) * 4;
                    return Array.from({ length: 4 }, (_, channel) => pixels[offset + channel] ?? null);
                  };
                  const legacySourcePixels = readPixels(legacySource.canvas);
                  const durableSourcePixels = readPixels(durableSource.canvas);
                  const legacyBackdropPixels = readPixels(legacyBackdrop.canvas);
                  const durableBackdropPixels = readPixels(durableBackdrop.canvas);
                  const enrichSamples = (samples: ReturnType<typeof compareBytes>['differingSamples']) =>
                    samples.map((sample) => ({
                      ...sample,
                      rawSource: {
                        legacyRgba: rgbaAt(legacySourcePixels, sample.x, sample.y),
                        durableRgba: rgbaAt(durableSourcePixels, sample.x, sample.y),
                      },
                      backdropComposite: {
                        legacyRgba: rgbaAt(legacyBackdropPixels, sample.x, sample.y),
                        durableRgba: rgbaAt(durableBackdropPixels, sample.x, sample.y),
                      },
                    }));
                  const expectedBounds = materializedLayerComparisons.find(
                    (comparison) => comparison.layerId === diagnosticLayerId
                  )?.expectedBounds;
                  if (!expectedBounds) {
                    throw new Error(`Missing expected bounds for diagnostic layer ${diagnosticLayerId} at ${stage}`);
                  }
                  return {
                    layerId: diagnosticLayerId,
                    frameDocumentBounds: frame,
                    framePixelBounds: { x: 0, y: 0, width: frameSize.width, height: frameSize.height },
                    sourceLayerBounds: {
                      legacy: expectedBounds,
                      durable: materializedLayer.bounds,
                    },
                    backdropSurfaceBounds: frame,
                    runtime: enrichSamples(runtimePixelComparison.differingSamples),
                    exportCanvas: enrichSamples(exportCanvasPixelComparison.differingSamples),
                  };
                })();
                const legacyPsdBase64 = encodeBase64(
                  new Uint8Array(await savePsd(legacyReplay.layers, { width: 64, height: 64 }, frame))
                );
                const durablePsdBase64 = encodeBase64(
                  new Uint8Array(await savePsd(exportRecords.layers, exportRecords.size, exportRecords.frame))
                );
                return {
                  stage,
                  frame,
                  expectedSize: { width: frameSize.width, height: frameSize.height },
                  runtime: {
                    legacyWidth: legacySurface.width,
                    legacyHeight: legacySurface.height,
                    durableWidth: projectionCanvas.width,
                    durableHeight: projectionCanvas.height,
                    pixelComparison: runtimePixelComparison,
                    layerRecords: projectedLayerRecords,
                  },
                  admission: {
                    eligible: Object.values(eligibilityReasons).every((reason) => reason === null),
                    reasons: eligibilityReasons,
                  },
                  exportCanvas: {
                    legacyWidth: legacyExportCanvas.width,
                    legacyHeight: legacyExportCanvas.height,
                    durableWidth: durableExportCanvas.width,
                    durableHeight: durableExportCanvas.height,
                    pixelComparison: exportCanvasPixelComparison,
                    layerRecords: exportLayerRecords,
                  },
                  png: {
                    legacyBase64: await encodeCanvasPng(legacyExportCanvas, 'Legacy export canvas'),
                    durableBase64: await encodeCanvasPng(durableExportCanvas, 'Durable export canvas'),
                  },
                  psd: {
                    legacyBase64: legacyPsdBase64,
                    durableBase64: durablePsdBase64,
                    expectedLayerBounds: expectedPsdLayerBounds,
                    preEncodeLayers: psdPreEncodeLayers,
                  },
                  surfaceBounds: {
                    frameDocument: frame,
                    framePixels: { x: 0, y: 0, width: frameSize.width, height: frameSize.height },
                    runtime: {
                      document: frame,
                      pixels: { x: 0, y: 0, width: projectionCanvas.width, height: projectionCanvas.height },
                    },
                    exportCanvas: {
                      document: frame,
                      pixels: {
                        x: 0,
                        y: 0,
                        width: durableExportCanvas.width,
                        height: durableExportCanvas.height,
                      },
                    },
                    png: {
                      document: frame,
                      pixels: {
                        x: 0,
                        y: 0,
                        width: durableExportCanvas.width,
                        height: durableExportCanvas.height,
                      },
                    },
                    psdComposite: {
                      document: frame,
                      pixels: { x: 0, y: 0, width: frameSize.width, height: frameSize.height },
                    },
                    psdLayers: expectedPsdLayerBounds,
                  },
                  sourceBackdropSamples,
                };
              })()
            : null;
          return {
            frame,
            durableFrame: composite.frame,
            expectedSize: { width: frameSize.width, height: frameSize.height },
            legacyPixels,
            durablePixels,
            legacyDiffersFromUntransformed: differsFromUntransformed(legacyPixels),
            durableDiffersFromUntransformed: differsFromUntransformed(durablePixels),
            legacyByteLength: legacyPixels.length,
            durableByteLength: durablePixels.length,
            differingBytes,
            differingPixels,
            maxChannelDelta,
            differingSamples,
            materializedBounds,
            materializedLayerComparisons,
            projectedOutputParity,
          };
        } finally {
          composite.release();
        }
      };

      const layerTransformResults = [];
      const differsFromPrevious = (pixels: number[], previous: number[] | null) =>
        previous === null ||
        pixels.length !== previous.length ||
        pixels.some((pixel, index) => pixel !== previous[index]);
      let previousLegacyTransformPixels = untransformedBaselinePixels;
      let previousDurableTransformPixels = untransformedBaselinePixels;
      for (const [index, layerTransform] of layerTransforms.entries()) {
        const result = await compareAtCursor(index + 1, `layer transform ${index + 1}`);
        layerTransformResults.push({
          index: index + 1,
          id: layerTransform.id,
          layerId: layerTransform.layerId,
          frame: result.frame,
          durableFrame: result.durableFrame,
          expectedSize: result.expectedSize,
          differingBytes: result.differingBytes,
          legacyDiffersFromUntransformed: result.legacyDiffersFromUntransformed,
          durableDiffersFromUntransformed: result.durableDiffersFromUntransformed,
          legacyDiffersFromPrevious: differsFromPrevious(result.legacyPixels, previousLegacyTransformPixels),
          durableDiffersFromPrevious: differsFromPrevious(result.durablePixels, previousDurableTransformPixels),
          legacyPixels:
            fixture.verifyProjectedOutputs || fixture.captureRuntimePixels ? result.legacyPixels : undefined,
          durablePixels:
            fixture.verifyProjectedOutputs || fixture.captureRuntimePixels ? result.durablePixels : undefined,
          materializedLayerComparisons: result.materializedLayerComparisons,
          projectedOutputParity: result.projectedOutputParity,
        });
        previousLegacyTransformPixels = result.legacyPixels;
        previousDurableTransformPixels = result.durablePixels;
      }

      const transitionResults = [];
      let finalLegacyPixels: number[] = [];
      let finalDurablePixels: number[] = [];
      let finalMaterializedBounds: Record<string, unknown> = {};
      let finalMaterializedLayerComparisons: CropParityLayerComparison[] = [];
      for (const [index, transition] of transitions.entries()) {
        const legacyIndex = layerTransforms.length + index + 1;
        const result = await compareAtCursor(legacyIndex, `frame transition ${index + 1}`);
        if (
          result.frame.x !== transition.nextFrame.x ||
          result.frame.y !== transition.nextFrame.y ||
          result.frame.width !== transition.nextFrame.width ||
          result.frame.height !== transition.nextFrame.height
        ) {
          throw new Error(`Legacy frame transition ${index + 1} did not reach its requested frame`);
        }
        transitionResults.push({
          index: index + 1,
          angleDegrees: transition.angleDegrees,
          frame: result.frame,
          durableFrame: result.durableFrame,
          expectedSize: result.expectedSize,
          legacyByteLength: result.legacyByteLength,
          durableByteLength: result.durableByteLength,
          differingBytes: result.differingBytes,
          differingPixels: result.differingPixels,
          maxChannelDelta: result.maxChannelDelta,
          differingSamples: result.differingSamples,
          legacyPixels: result.legacyPixels,
          durablePixels: result.durablePixels,
          materializedBounds: result.materializedBounds,
          materializedLayerComparisons: result.materializedLayerComparisons,
          projectedOutputParity: result.projectedOutputParity,
        });
        if (index === transitions.length - 1) {
          finalLegacyPixels = result.legacyPixels;
          finalDurablePixels = result.durablePixels;
          finalMaterializedBounds = result.materializedBounds;
          finalMaterializedLayerComparisons = result.materializedLayerComparisons;
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
        differingPixels: finalTransition.differingPixels,
        maxChannelDelta: finalTransition.maxChannelDelta,
        differingSamples: finalTransition.differingSamples,
        colorPresence,
        materializedBounds: finalMaterializedBounds,
        materializedLayerComparisons: finalMaterializedLayerComparisons,
        layerTransformResults,
        transitionResults,
      };
    } finally {
      registry.shutdown();
    }
  }, caseFixture);
}

let psdImageDataReaderInitialized = false;

function decodePsdCapture(base64: string) {
  if (!psdImageDataReaderInitialized) {
    initializeCanvas(
      () => {
        throw new Error('PSD parity decoding must use ImageData');
      },
      (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' })
    );
    psdImageDataReaderInitialized = true;
  }
  return readPsd(new Uint8Array(Buffer.from(base64, 'base64')), { useImageData: true });
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

    const croppedCanvasBox = await getWorkspaceCanvas(page).boundingBox();
    if (!croppedCanvasBox) throw new Error('the cropped canvas has no measurable bounds');
    const croppedCapture = viewportClip(croppedCanvasBox);
    const observedMasks: Array<{ capture: typeof croppedCapture; document: typeof croppedCapture }> = [];
    await waitForCanvasPixels(page, croppedCapture, async (_screenshot, mask) => {
      observedMasks.push(mask);
      return true;
    });
    const croppedDocumentRect = observedMasks[0]?.document;
    expect(croppedDocumentRect).toBeDefined();
    expect(croppedDocumentRect!.width / croppedDocumentRect!.height).toBeCloseTo(cropped.width / cropped.height, 10);

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
    // Undo restores the crop selection guides over the document. Hide that overlay before the
    // screenshot band assertion so guide lines cannot be mistaken for document ink.
    await clickToolButton(page, 'draw');
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
            if (red < 100 && green > 50 && blue > 150) count += 1;
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
      expect(Number(await rotationHandle.locator('path').getAttribute('stroke-width'))).toBe(1.5);

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

    test('a recrop resize and move keep the crop frame aligned with the zoomed canvas', async ({ page }, testInfo) => {
      await openDocument(page);
      await commitCrop(page);
      const croppedFit = await readFit(page);
      await drawBar(page, croppedFit, 100);

      // Re-entering crop after both a frame change and a pixel edit is the reported path. The
      // previous crop deliberately leaves a non-unit view zoom compensation so the canvas has a
      // transformed view when the crop box grows outside its current frame.
      await clickToolButton(page, 'move');
      const fit = await openCropTool(page);
      await installCropInputProbe(page);
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
      const movedFit = await readFit(page);
      const moveFrom = documentPoint(movedFit, movedFit.documentWidth / 2, 120);
      const moveTo = documentPoint(movedFit, movedFit.documentWidth / 2 + 30, 145);
      await page.mouse.move(moveFrom.x, moveFrom.y);
      await expect(page.locator('.cursor-crop'), 'the crop interior exposes its move cursor').toHaveCSS(
        'cursor',
        'move'
      );
      await page.mouse.down();
      await page.mouse.move(moveTo.x, moveTo.y, { steps: 12 });
      await page.mouse.up();
      await attachCropInputProbe(page, testInfo, 'recrop-move-input-events');

      const movedTop = documentPoint(movedFit, movedFit.documentWidth / 2 + 30, -15);
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
      await installCropInputProbe(page);
      const rotation = await cropRotationGesturePoints(page);
      await page.mouse.move(rotation.start.x, rotation.start.y);
      await expect(surface, 'the expanded corner still exposes the rotation handle').toHaveCSS(
        'cursor',
        /url.*data:image\/svg\+xml/
      );
      await page.mouse.down();
      await page.mouse.move(rotation.end.x, rotation.end.y, { steps: 12 });
      await page.mouse.up();
      await attachCropInputProbe(page, testInfo, 'rotated-recrops-input-events');
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

    test('the crop corner exposes a rotation cursor and dragging it rotates the pending box', async ({
      page,
    }, testInfo) => {
      await openDocument(page);
      const fit = await openCropTool(page);
      await dragOnCanvas(page, fit, { x: CROP_LEFT_X, y: CROP_TOP_Y }, { x: CROP_RIGHT_X, y: CROP_BOTTOM_Y });

      const surface = page.locator('.cursor-crop');
      await installCropInputProbe(page);
      const rotation = await cropRotationGesturePoints(page);
      await page.mouse.move(rotation.start.x, rotation.start.y);
      await expect(surface, 'the rotation hotspot uses the rotate cursor').toHaveCSS(
        'cursor',
        /url.*data:image\/svg\+xml/
      );

      await page.mouse.down();
      await page.mouse.move(rotation.end.x, rotation.end.y, { steps: 12 });
      await page.mouse.up();
      await attachCropInputProbe(page, testInfo, 'crop-corner-rotation-input-events');

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
      await expect(surface, 'the rendered midpoint grip advertises rotation').toHaveCSS(
        'cursor',
        /url.*data:image\/svg\+xml/
      );
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
      await installCropInputProbe(page);
      const rotation = await cropRotationGesturePoints(page);
      await page.mouse.move(rotation.start.x, rotation.start.y);
      await page.mouse.down();
      await page.mouse.move(rotation.end.x, rotation.end.y, { steps: 12 });
      await page.mouse.up();
      await attachCropInputProbe(page, testInfo, 'crop-rotation-input-events');
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
      await expect(page.getByTestId('dev-status-strip')).toHaveAttribute('data-presentation-status', 'legacy-fallback');
      await expect(page.getByTestId('dev-status-strip')).toHaveAttribute(
        'data-durable-fallback-reason',
        'ownership-unproven'
      );
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
      await expect(page.getByTestId('dev-status-strip')).toHaveAttribute(
        'data-durable-fallback-reason',
        'ownership-unproven'
      );
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
        `durable and legacy crop rasters must be byte-identical; ${pixelDifferenceSummary(result)}`
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
        `37-degree multi-layer rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
      ).toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(Object.keys(result.materializedBounds).sort()).toEqual(['background', 'center-patch']);
      expect(result.transitionResults).toHaveLength(1);
    });

    test('a 23-degree fractional crop matches legacy pixels for two positioned raster layers', async ({ page }) => {
      await openDocument(page);

      const result = await compareCropRenderers(page, {
        caseName: '23-degree fractional two-layer crop',
        documentId: 'arbitrary-multilayer-fractional-crop-parity-23',
        materializedLayerIds: ['background', 'center-patch'],
        transitions: [{ angleDegrees: 23, nextFrame: { x: 8.25, y: 9.5, width: 47.75, height: 43.25 } }],
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
      expect(result.transitionResults).toHaveLength(1);
      expect(result.transitionResults[0]?.frame).toEqual({
        x: 8.25,
        y: 9.5,
        width: 47.75,
        height: 43.25,
      });
      expect(result.transitionResults[0]?.durableFrame).toEqual(result.transitionResults[0]?.frame);
      const layerComparisons = result.transitionResults[0]?.materializedLayerComparisons ?? [];
      expect(layerComparisons).toHaveLength(2);
      expect(layerComparisons.map(({ layerId }) => layerId).sort()).toEqual(['background', 'center-patch']);
      for (const comparison of layerComparisons) {
        expect(comparison.materializedBounds).toEqual(comparison.expectedBounds);
        expect(comparison.bitmapSize).toEqual({
          width: comparison.expectedBounds.width,
          height: comparison.expectedBounds.height,
        });
        expect(comparison.frameDifferingPixels, `${comparison.layerId} HTML frame materialization`).toBe(0);
        expect(comparison.offscreenFrameDifferingPixels, `${comparison.layerId} Offscreen frame materialization`).toBe(
          0
        );
        expect(comparison.tightBitmapDifferingPixels, `${comparison.layerId} tight bitmap`).toBe(0);
        expect(comparison.offscreenTightBitmapDifferingPixels, `${comparison.layerId} Offscreen tight bitmap`).toBe(0);
      }
      expect(
        result.differingBytes,
        `23-degree fractional multi-layer rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
      ).toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(Object.keys(result.materializedBounds).sort()).toEqual(['background', 'center-patch']);
    });

    test('a retained layer transform matches legacy before and after a later frame transform', async ({ page }) => {
      await openDocument(page);

      const fixture: CropParityFixture = {
        caseName: 'retained affine followed by frame transform',
        documentId: 'retained-affine-frame-parity',
        materializedLayerIds: ['background', 'foreground'],
        layerTransforms: [
          {
            id: 'retained-affine',
            layerId: 'foreground',
            args: {
              toolName: 'transform',
              rotate: 23,
              mirrorH: false,
              mirrorV: false,
              skewX: 6,
              skewY: -4,
              trapezoid: 0,
              resizeX: 112,
              resizeY: 84,
            },
          },
          {
            id: 'retained-affine-background',
            layerId: 'background',
            args: {
              toolName: 'transform',
              rotate: -11,
              mirrorH: true,
              mirrorV: false,
              skewX: -2,
              skewY: 3,
              trapezoid: 0,
              resizeX: 93,
              resizeY: 107,
            },
          },
        ],
        transitions: [
          { angleDegrees: 37, nextFrame: { x: 8.25, y: 9.5, width: 47.75, height: 43.25 } },
          { angleDegrees: -17, nextFrame: { x: 7.75, y: 8.125, width: 45.6, height: 41.3 } },
        ],
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
            id: 'foreground',
            order: 1,
            pos: { x: 14, y: 18, width: 28, height: 24 },
            fills: [
              { x: 0, y: 0, width: 14, height: 24, color: '#ffff00' },
              { x: 14, y: 0, width: 14, height: 24, color: '#00ff00' },
            ],
          },
        ],
      };
      const result = await compareCropRenderers(page, fixture);
      const untransformedControl = await compareCropRenderers(page, {
        ...fixture,
        caseName: 'untransformed control for retained affine followed by frame transform',
        documentId: 'retained-affine-frame-parity-control',
        layerTransforms: [],
      });

      expect(result.layerTransformResults).toHaveLength(fixture.layerTransforms?.length ?? 0);
      for (const transform of result.layerTransformResults) {
        expect(transform.frame).toEqual({ x: 0, y: 0, width: 64, height: 64 });
        expect(transform.durableFrame).toEqual(transform.frame);
        expect(transform.differingBytes).toBe(0);
        expect(transform.legacyDiffersFromUntransformed).toBe(true);
        expect(transform.durableDiffersFromUntransformed).toBe(true);
        expect(transform.legacyDiffersFromPrevious).toBe(true);
        expect(transform.durableDiffersFromPrevious).toBe(true);
        expect(transform.materializedLayerComparisons).toHaveLength(fixture.materializedLayerIds?.length ?? 0);
        expect(transform.materializedLayerComparisons.map((comparison) => comparison.layerId)).toEqual(
          fixture.materializedLayerIds
        );
      }
      expect(result.transitionResults).toHaveLength(fixture.transitions.length);
      for (const [index, transition] of result.transitionResults.entries()) {
        const controlTransition = untransformedControl.transitionResults[index];
        expect(controlTransition).toBeDefined();
        expect(transition.frame).toEqual(fixture.transitions[index]?.nextFrame);
        expect(transition.durableFrame).toEqual(transition.frame);
        expect(transition.differingBytes).toBe(0);
        expect(transition.legacyPixels).not.toEqual(controlTransition?.legacyPixels);
        expect(transition.durablePixels).not.toEqual(controlTransition?.durablePixels);
        expect(transition.materializedLayerComparisons).toHaveLength(fixture.materializedLayerIds?.length ?? 0);
        expect(transition.materializedLayerComparisons.map((comparison) => comparison.layerId)).toEqual(
          fixture.materializedLayerIds
        );
      }
      const layerComparisons = [
        ...result.layerTransformResults.flatMap((transform) => transform.materializedLayerComparisons),
        ...result.transitionResults.flatMap((transition) => transition.materializedLayerComparisons),
      ];
      expect(layerComparisons).toHaveLength(
        fixture.layers.length * ((fixture.layerTransforms?.length ?? 0) + fixture.transitions.length)
      );
      for (const comparison of layerComparisons) {
        expect(
          comparison.materializedBounds,
          `${comparison.layerId} must use exact frame-aligned legacy bounds`
        ).toEqual(comparison.expectedBounds);
        expect(comparison.bitmapSize).toEqual({
          width: comparison.expectedBounds.width,
          height: comparison.expectedBounds.height,
        });
        expect(
          comparison.frameNonEdgeDifferingPixels,
          `${comparison.layerId} frame raster at ${comparison.stage} differs away from an alpha boundary; samples ${JSON.stringify(comparison.frameDifferingSamples)}`
        ).toBe(0);
        expect(
          comparison.frameDifferingPixels,
          `${comparison.layerId} frame raster at ${comparison.stage} differs; samples ${JSON.stringify(comparison.frameDifferingSamples)}`
        ).toBe(0);
        expect(
          comparison.offscreenFrameNonEdgeDifferingPixels,
          `${comparison.layerId} OffscreenCanvas frame raster at ${comparison.stage} differs away from an alpha boundary; samples ${JSON.stringify(comparison.offscreenFrameDifferingSamples)}`
        ).toBe(0);
        expect(
          comparison.offscreenFrameDifferingPixels,
          `${comparison.layerId} OffscreenCanvas frame raster at ${comparison.stage} differs; samples ${JSON.stringify(comparison.offscreenFrameDifferingSamples)}`
        ).toBe(0);
        expect(
          comparison.tightBitmapNonEdgeDifferingPixels,
          `${comparison.layerId} full tight bitmap at ${comparison.stage} differs outside an alpha boundary with identical RGB values; samples ${JSON.stringify(comparison.tightBitmapDifferingSamples)}`
        ).toBe(0);
        expect(
          comparison.tightBitmapDifferingPixels,
          `${comparison.layerId} full tight bitmap at ${comparison.stage} differs; samples ${JSON.stringify(comparison.tightBitmapDifferingSamples)}`
        ).toBe(0);
        expect(
          comparison.offscreenTightBitmapNonEdgeDifferingPixels,
          `${comparison.layerId} OffscreenCanvas tight bitmap at ${comparison.stage} differs outside an alpha boundary with identical RGB values; samples ${JSON.stringify(comparison.offscreenTightBitmapDifferingSamples)}`
        ).toBe(0);
        expect(
          comparison.offscreenTightBitmapDifferingPixels,
          `${comparison.layerId} OffscreenCanvas tight bitmap at ${comparison.stage} differs; samples ${JSON.stringify(comparison.offscreenTightBitmapDifferingSamples)}`
        ).toBe(0);
      }
      expect(untransformedControl.transitionResults).toHaveLength(fixture.transitions.length);
      for (const [index, transition] of untransformedControl.transitionResults.entries()) {
        expect(transition.frame).toEqual(fixture.transitions[index]?.nextFrame);
        expect(transition.durableFrame).toEqual(transition.frame);
        expect(transition.differingBytes, 'frame-only composite must match legacy exactly').toBe(0);
        expect(transition.materializedLayerComparisons).toHaveLength(fixture.layers.length);
        expect(transition.materializedLayerComparisons.map((comparison) => comparison.layerId)).toEqual(
          fixture.materializedLayerIds
        );
        for (const comparison of transition.materializedLayerComparisons) {
          expect(comparison.materializedBounds).toEqual(comparison.expectedBounds);
          expect(comparison.bitmapSize).toEqual({
            width: comparison.expectedBounds.width,
            height: comparison.expectedBounds.height,
          });
          expect(
            comparison.frameNonEdgeDifferingPixels,
            `frame-only ${comparison.layerId} raster differs away from an alpha boundary; samples ${JSON.stringify(comparison.frameDifferingSamples)}`
          ).toBe(0);
          expect(
            comparison.frameDifferingPixels,
            `frame-only ${comparison.layerId} raster differs; samples ${JSON.stringify(comparison.frameDifferingSamples)}`
          ).toBe(0);
          expect(
            comparison.offscreenFrameNonEdgeDifferingPixels,
            `frame-only ${comparison.layerId} OffscreenCanvas raster differs away from an alpha boundary; samples ${JSON.stringify(comparison.offscreenFrameDifferingSamples)}`
          ).toBe(0);
          expect(
            comparison.offscreenFrameDifferingPixels,
            `frame-only ${comparison.layerId} OffscreenCanvas raster differs; samples ${JSON.stringify(comparison.offscreenFrameDifferingSamples)}`
          ).toBe(0);
          expect(
            comparison.tightBitmapNonEdgeDifferingPixels,
            `frame-only ${comparison.layerId} tight bitmap differs outside an alpha boundary with identical RGB values; samples ${JSON.stringify(comparison.tightBitmapDifferingSamples)}`
          ).toBe(0);
          expect(
            comparison.tightBitmapDifferingPixels,
            `frame-only ${comparison.layerId} full tight bitmap differs; samples ${JSON.stringify(comparison.tightBitmapDifferingSamples)}`
          ).toBe(0);
          expect(
            comparison.offscreenTightBitmapNonEdgeDifferingPixels,
            `frame-only ${comparison.layerId} OffscreenCanvas tight bitmap differs outside an alpha boundary with identical RGB values; samples ${JSON.stringify(comparison.offscreenTightBitmapDifferingSamples)}`
          ).toBe(0);
          expect(
            comparison.offscreenTightBitmapDifferingPixels,
            `frame-only ${comparison.layerId} OffscreenCanvas tight bitmap differs; samples ${JSON.stringify(comparison.offscreenTightBitmapDifferingSamples)}`
          ).toBe(0);
        }
      }
      // This control isolates the retained operation within each renderer; the broader frame-only
      // parity matrix remains open and is not treated as an oracle by this fixture.
      expect(result.legacyPixels).not.toEqual(untransformedControl.legacyPixels);
      expect(result.durablePixels).not.toEqual(untransformedControl.durablePixels);
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(Object.keys(result.materializedBounds).sort()).toEqual(['background', 'foreground']);
    });

    test('an affine raster keeps composite opacity and blend mode exact', async ({ page }, testInfo) => {
      await openDocument(page);

      const fixture: CropParityFixture = {
        caseName: 'affine raster opacity and multiply blend',
        documentId: 'affine-raster-opacity-multiply-parity',
        materializedLayerIds: ['foreground'],
        verifyProjectedOutputs: true,
        layerTransforms: [
          {
            id: 'affine-opacity-multiply',
            layerId: 'foreground',
            args: {
              toolName: 'transform',
              rotate: 23,
              mirrorH: false,
              mirrorV: true,
              skewX: 4,
              skewY: -3,
              trapezoid: 0,
              resizeX: 109,
              resizeY: 91,
            },
          },
        ],
        transitions: [{ angleDegrees: 31, nextFrame: { x: 7.25, y: 8.5, width: 50.75, height: 45.25 } }],
        verifyDownstreamInvertParity: true,
        diagnoseOpaqueBackdrop: true,
        layers: [
          {
            kind: 'raster',
            id: 'background',
            order: 0,
            pos: { x: 0, y: 0, width: 64, height: 64 },
            fills: [{ x: 0, y: 0, width: 64, height: 64, color: '#5070a0' }],
          },
          {
            kind: 'raster',
            id: 'foreground',
            order: 1,
            pos: { x: 12, y: 16, width: 40, height: 32 },
            fills: [
              { x: 0, y: 0, width: 19, height: 32, color: '#e04020' },
              { x: 19, y: 0, width: 21, height: 32, color: '#40d020' },
            ],
            layerOpacity: 0.58,
            blendMode: 'multiply',
          },
        ],
      };
      const result = await compareCropRenderers(page, fixture);
      // Keep the comparison evidence before a strict parity assertion can abort this test.
      const summarizeMaterialization = (comparisons: readonly CropParityLayerComparison[], fixtureStage: string) =>
        comparisons.map((comparison) => ({
          fixtureStage,
          layerId: comparison.layerId,
          stage: comparison.stage,
          positions: comparison.positions,
          compositing: comparison.compositing,
          affineTransforms: comparison.affineTransforms,
          expectedBounds: comparison.expectedBounds,
          materializedBounds: comparison.materializedBounds,
          bitmapSize: comparison.bitmapSize,
          frameDifferingBytes: comparison.frameDifferingBytes,
          framePremultipliedDifferingBytes: comparison.framePremultipliedDifferingBytes,
          framePremultipliedDifferingPixels: comparison.framePremultipliedDifferingPixels,
          framePremultipliedDifferingBytesByChannel: comparison.framePremultipliedDifferingBytesByChannel,
          framePremultipliedAlphaBoundaryDifferingPixels: comparison.framePremultipliedAlphaBoundaryDifferingPixels,
          framePremultipliedNonBoundaryDifferingPixels: comparison.framePremultipliedNonBoundaryDifferingPixels,
          framePremultipliedDifferingSamples: comparison.framePremultipliedDifferingSamples,
          frameDifferingPixels: comparison.frameDifferingPixels,
          frameNonEdgeDifferingPixels: comparison.frameNonEdgeDifferingPixels,
          frameDifferingSamples: comparison.frameDifferingSamples,
          offscreenFrameDifferingBytes: comparison.offscreenFrameDifferingBytes,
          offscreenFramePremultipliedDifferingBytes: comparison.offscreenFramePremultipliedDifferingBytes,
          offscreenFramePremultipliedDifferingPixels: comparison.offscreenFramePremultipliedDifferingPixels,
          offscreenFramePremultipliedDifferingBytesByChannel:
            comparison.offscreenFramePremultipliedDifferingBytesByChannel,
          offscreenFramePremultipliedAlphaBoundaryDifferingPixels:
            comparison.offscreenFramePremultipliedAlphaBoundaryDifferingPixels,
          offscreenFramePremultipliedNonBoundaryDifferingPixels:
            comparison.offscreenFramePremultipliedNonBoundaryDifferingPixels,
          offscreenFramePremultipliedDifferingSamples: comparison.offscreenFramePremultipliedDifferingSamples,
          opaqueBackdropComparison: comparison.opaqueBackdropComparison,
          offscreenFrameDifferingPixels: comparison.offscreenFrameDifferingPixels,
          offscreenFrameNonEdgeDifferingPixels: comparison.offscreenFrameNonEdgeDifferingPixels,
          offscreenFrameDifferingSamples: comparison.offscreenFrameDifferingSamples,
          tightBitmapRawDifferingBytes: comparison.tightBitmapRawDifferingBytes,
          tightBitmapRawDifferingSamples: comparison.tightBitmapRawDifferingSamples,
          tightBitmapPremultipliedDifferingBytes: comparison.tightBitmapPremultipliedDifferingBytes,
          downstreamInvertReadbackDifferingBytes: comparison.downstreamInvertReadbackDifferingBytes,
          downstreamInvertReadbackDifferingSamples: comparison.downstreamInvertReadbackDifferingSamples,
          offscreenDownstreamInvertReadbackDifferingBytes: comparison.offscreenDownstreamInvertReadbackDifferingBytes,
          offscreenDownstreamInvertReadbackDifferingSamples:
            comparison.offscreenDownstreamInvertReadbackDifferingSamples,
          tightBitmapDifferingPixels: comparison.tightBitmapDifferingPixels,
          tightBitmapNonEdgeDifferingPixels: comparison.tightBitmapNonEdgeDifferingPixels,
          tightBitmapDifferingSamples: comparison.tightBitmapDifferingSamples,
          offscreenTightBitmapRawDifferingBytes: comparison.offscreenTightBitmapRawDifferingBytes,
          offscreenTightBitmapRawDifferingSamples: comparison.offscreenTightBitmapRawDifferingSamples,
          offscreenTightBitmapPremultipliedDifferingBytes: comparison.offscreenTightBitmapPremultipliedDifferingBytes,
          offscreenTightBitmapDifferingPixels: comparison.offscreenTightBitmapDifferingPixels,
          offscreenTightBitmapNonEdgeDifferingPixels: comparison.offscreenTightBitmapNonEdgeDifferingPixels,
          offscreenTightBitmapDifferingSamples: comparison.offscreenTightBitmapDifferingSamples,
        }));
      const materializationDiagnostics = [
        ...result.layerTransformResults.flatMap((transform, index) =>
          summarizeMaterialization(transform.materializedLayerComparisons, `affine cursor ${index + 1}`)
        ),
        ...result.transitionResults.flatMap((transition, index) =>
          summarizeMaterialization(transition.materializedLayerComparisons, `frame transition ${index + 1}`)
        ),
      ];
      await testInfo.attach('affine-raster-materialization-diagnostics.json', {
        body: JSON.stringify(materializationDiagnostics, null, 2),
        contentType: 'application/json',
      });
      const adapterDiagnostics = [];
      const withCompositing = (
        caseName: string,
        documentId: string,
        opacity: number,
        blendMode: GlobalCompositeOperation
      ) => ({
        ...fixture,
        caseName,
        documentId,
        verifyProjectedOutputs: false,
        captureRuntimePixels: true,
        verifyDownstreamInvertParity: false,
        diagnoseOpaqueBackdrop: false,
        materializedLayerIds: [],
        layers: fixture.layers.map((layer) =>
          layer.id === 'foreground' ? { ...layer, layerOpacity: opacity, blendMode } : layer
        ),
      });
      const normalComposite = await compareCropRenderers(
        page,
        withCompositing(
          'normal composite control for affine raster opacity and blend',
          'affine-raster-normal',
          1,
          'source-over'
        )
      );
      const opacityOnly = await compareCropRenderers(
        page,
        withCompositing(
          'opacity-only control for affine raster blend',
          'affine-raster-opacity-only',
          0.58,
          'source-over'
        )
      );
      const blendOnly = await compareCropRenderers(
        page,
        withCompositing('blend-only control for affine raster opacity', 'affine-raster-blend-only', 1, 'multiply')
      );

      const comparePixelSurfaces = (
        expected: readonly number[],
        received: readonly number[],
        width: number,
        height: number,
        originX: number,
        originY: number
      ) => {
        const expectedLength = width * height * 4;
        if (expected.length !== expectedLength || received.length !== expectedLength) {
          throw new Error(
            `Control comparison has ${expected.length}/${received.length} bytes; expected ${expectedLength} for ${width}x${height}`
          );
        }
        let differingBytes = 0;
        let differingPixels = 0;
        let lastPixel = -1;
        const samples: Array<{
          x: number;
          y: number;
          documentX: number;
          documentY: number;
          expectedRgba: readonly number[];
          receivedRgba: readonly number[];
          differingChannels: Array<'r' | 'g' | 'b' | 'a'>;
        }> = [];
        const sampleByPixel = new Map<number, (typeof samples)[number]>();
        const channels = ['r', 'g', 'b', 'a'] as const;
        for (let offset = 0; offset < expectedLength; offset += 1) {
          if (expected[offset] === received[offset]) continue;
          differingBytes += 1;
          const pixel = Math.floor(offset / 4);
          const x = pixel % width;
          const y = Math.floor(pixel / width);
          if (pixel !== lastPixel) {
            differingPixels += 1;
            lastPixel = pixel;
          }
          const existing = sampleByPixel.get(pixel);
          if (existing) {
            const channel = channels[offset % 4];
            if (!existing.differingChannels.includes(channel)) existing.differingChannels.push(channel);
          } else if (samples.length < 8) {
            const sample = {
              x,
              y,
              documentX: originX + x,
              documentY: originY + y,
              expectedRgba: Array.from({ length: 4 }, (_, channel) => expected[pixel * 4 + channel] ?? 0),
              receivedRgba: Array.from({ length: 4 }, (_, channel) => received[pixel * 4 + channel] ?? 0),
              differingChannels: [channels[offset % 4]],
            };
            samples.push(sample);
            sampleByPixel.set(pixel, sample);
          }
        }
        return { differingBytes, differingPixels, samples };
      };
      const compareControlAtCursor = (
        reference: {
          frame: CropParityFrame;
          expectedSize: Readonly<{ width: number; height: number }>;
          legacyPixels?: readonly number[];
          durablePixels?: readonly number[];
        },
        control: {
          frame: CropParityFrame;
          expectedSize: Readonly<{ width: number; height: number }>;
          legacyPixels?: readonly number[];
          durablePixels?: readonly number[];
        },
        label: string
      ) => {
        expect(control.frame, `${label} frame`).toEqual(reference.frame);
        if (!reference.legacyPixels || !reference.durablePixels || !control.legacyPixels || !control.durablePixels) {
          throw new Error(`${label} did not return runtime pixels for both renderers`);
        }
        expect(control.expectedSize, `${label} pixel dimensions`).toEqual(reference.expectedSize);
        const { width, height } = reference.expectedSize;
        return {
          frame: reference.frame,
          legacy: comparePixelSurfaces(
            reference.legacyPixels,
            control.legacyPixels,
            width,
            height,
            reference.frame.x,
            reference.frame.y
          ),
          durable: comparePixelSurfaces(
            reference.durablePixels,
            control.durablePixels,
            width,
            height,
            reference.frame.x,
            reference.frame.y
          ),
        };
      };
      const transformedControl = (input: typeof result) => {
        const value = input.layerTransformResults[0];
        if (!value) throw new Error(`${input.caseName} has no affine-cursor output`);
        if (!value.expectedSize) throw new Error(`${input.caseName} has no affine-cursor output dimensions`);
        return value;
      };
      const transitionedControl = (input: typeof result) => {
        const value = input.transitionResults[0];
        if (!value) throw new Error(`${input.caseName} has no fractional-frame output`);
        if (!value.expectedSize) throw new Error(`${input.caseName} has no fractional-frame output dimensions`);
        return value;
      };
      const affineControlComparisons = {
        opacityOnlyVsNormal: compareControlAtCursor(
          transformedControl(normalComposite),
          transformedControl(opacityOnly),
          'affine opacity-only versus normal control'
        ),
        blendOnlyVsNormal: compareControlAtCursor(
          transformedControl(normalComposite),
          transformedControl(blendOnly),
          'affine blend-only versus normal control'
        ),
      };
      const fractionalControlComparisons = {
        opacityOnlyVsNormal: compareControlAtCursor(
          transitionedControl(normalComposite),
          transitionedControl(opacityOnly),
          'fractional-frame opacity-only versus normal control'
        ),
        blendOnlyVsNormal: compareControlAtCursor(
          transitionedControl(normalComposite),
          transitionedControl(blendOnly),
          'fractional-frame blend-only versus normal control'
        ),
      };
      for (const [stage, comparisons] of Object.entries({
        affine: affineControlComparisons,
        fractionalFrame: fractionalControlComparisons,
      })) {
        expect(
          comparisons.opacityOnlyVsNormal.legacy.differingBytes,
          `${stage} opacity changes legacy output`
        ).toBeGreaterThan(0);
        expect(
          comparisons.opacityOnlyVsNormal.durable.differingBytes,
          `${stage} opacity changes durable output`
        ).toBeGreaterThan(0);
        expect(
          comparisons.blendOnlyVsNormal.legacy.differingBytes,
          `${stage} multiply changes legacy output`
        ).toBeGreaterThan(0);
        expect(
          comparisons.blendOnlyVsNormal.durable.differingBytes,
          `${stage} multiply changes durable output`
        ).toBeGreaterThan(0);
      }

      expect(result.layerTransformResults).toHaveLength(1);
      const transformed = result.layerTransformResults[0];
      const assertForegroundMaterialization = (comparisons: readonly CropParityLayerComparison[], stage: string) => {
        expect(comparisons, stage + ' materialized foreground count').toHaveLength(1);
        const comparison = comparisons[0];
        if (!comparison) throw new Error(stage + ' has no foreground materialization comparison');
        expect(comparison.layerId).toBe('foreground');
        expect(comparison.materializedBounds, stage + ' materialized bounds').toEqual(comparison.expectedBounds);
        expect(comparison.bitmapSize, stage + ' bitmap dimensions').toEqual({
          width: comparison.expectedBounds.width,
          height: comparison.expectedBounds.height,
        });
        expect(comparison.compositing, stage + ' opacity and blend metadata').toEqual({
          legacyOpacity: 0.58,
          durableOpacity: 0.58,
          legacyBlendMode: 'multiply',
          durableBlendMode: 'multiply',
        });
        // Canvas ImageData exposes unpremultiplied color. At low alpha, different readback RGB bytes
        // can encode the same rendered pixel. Require exact equality in premultiplied space and
        // after the production Invert processor's returned raster is drawn into a fresh readback
        // canvas. This pins the downstream draw/read boundary; it does not claim raw OffscreenCanvas
        // backing-store identity.
        expect(
          comparison.downstreamInvertReadbackDifferingBytes,
          stage +
            ' Invert readback differs between legacy and durable bitmaps; raw samples ' +
            JSON.stringify({
              htmlRaw: comparison.tightBitmapRawDifferingSamples,
              premultipliedBytes: comparison.tightBitmapPremultipliedDifferingBytes,
              premultiplied: comparison.tightBitmapDifferingSamples,
            })
        ).toBe(0);
        expect(
          comparison.offscreenDownstreamInvertReadbackDifferingBytes,
          stage +
            ' OffscreenCanvas Invert readback differs between legacy and durable bitmaps; raw samples ' +
            JSON.stringify({
              offscreenRawBytes: comparison.offscreenTightBitmapRawDifferingBytes,
              offscreenRaw: comparison.offscreenTightBitmapRawDifferingSamples,
              premultipliedBytes: comparison.offscreenTightBitmapPremultipliedDifferingBytes,
              premultiplied: comparison.offscreenTightBitmapDifferingSamples,
            })
        ).toBe(0);
        expect(
          comparison.tightBitmapPremultipliedDifferingBytes,
          stage + ' isolated tight bitmap differs at ' + JSON.stringify(comparison.tightBitmapDifferingSamples)
        ).toBe(0);
        expect(
          comparison.offscreenTightBitmapPremultipliedDifferingBytes,
          stage +
            ' OffscreenCanvas tight bitmap differs at ' +
            JSON.stringify(comparison.offscreenTightBitmapDifferingSamples)
        ).toBe(0);
      };
      const inspectProjectedOutputParity = async (
        output: Exclude<NonNullable<typeof transformed>['projectedOutputParity'], null>,
        stage: string
      ) => {
        const expectedSize = output.expectedSize;
        const frameBounds = output.surfaceBounds.frameDocument;
        const expectedSurfaceBounds = {
          document: frameBounds,
          pixels: { x: 0, y: 0, width: expectedSize.width, height: expectedSize.height },
        };
        expect(output.surfaceBounds.framePixels, `${stage} frame pixel bounds`).toEqual(expectedSurfaceBounds.pixels);
        expect(output.surfaceBounds.runtime, `${stage} runtime surface bounds`).toEqual(expectedSurfaceBounds);
        expect(output.surfaceBounds.exportCanvas, `${stage} export canvas bounds`).toEqual(expectedSurfaceBounds);
        expect(output.surfaceBounds.png, `${stage} PNG bounds`).toEqual(expectedSurfaceBounds);
        expect(output.surfaceBounds.psdComposite, `${stage} PSD composite bounds`).toEqual(expectedSurfaceBounds);
        expect(output.surfaceBounds.psdLayers, `${stage} PSD layer bounds`).toEqual(output.psd.expectedLayerBounds);
        const assertPixelEvidence = (
          comparison: {
            differingBytes: number;
            differingPixels: number;
            differingBounds: null | {
              x: number;
              y: number;
              documentX: number;
              documentY: number;
              width: number;
              height: number;
            };
            differingSamples: readonly {
              x: number;
              y: number;
              documentX: number;
              documentY: number;
              expectedRgba: readonly (number | null)[];
              receivedRgba: readonly (number | null)[];
              expectedAlpha: number | null;
              receivedAlpha: number | null;
              differingChannels: readonly string[];
            }[];
          },
          label: string,
          origin = { x: frameBounds.x, y: frameBounds.y }
        ) => {
          expect(comparison.differingPixels, `${label} differing pixels`).toBeLessThanOrEqual(
            comparison.differingBytes
          );
          if (comparison.differingPixels === 0) {
            expect(comparison.differingBounds, `${label} has no differing bounds`).toBeNull();
          } else {
            expect(comparison.differingBounds, `${label} has differing bounds`).not.toBeNull();
            expect(comparison.differingBounds?.documentX).toBe(origin.x + comparison.differingBounds!.x);
            expect(comparison.differingBounds?.documentY).toBe(origin.y + comparison.differingBounds!.y);
          }
          for (const sample of comparison.differingSamples) {
            expect(sample.documentX, `${label} sample document x`).toBe(origin.x + sample.x);
            expect(sample.documentY, `${label} sample document y`).toBe(origin.y + sample.y);
            expect(sample.expectedRgba).toHaveLength(4);
            expect(sample.receivedRgba).toHaveLength(4);
            expect(sample.expectedAlpha).toBe(sample.expectedRgba[3] ?? null);
            expect(sample.receivedAlpha).toBe(sample.receivedRgba[3] ?? null);
            expect(sample.differingChannels.length).toBeGreaterThan(0);
          }
        };
        expect(
          { width: output.runtime.legacyWidth, height: output.runtime.legacyHeight },
          `${stage} legacy runtime dimensions`
        ).toEqual(expectedSize);
        expect(
          { width: output.runtime.durableWidth, height: output.runtime.durableHeight },
          `${stage} projected runtime dimensions`
        ).toEqual(expectedSize);
        expect(output.runtime.pixelComparison.expectedByteLength).toBe(expectedSize.width * expectedSize.height * 4);
        expect(output.runtime.pixelComparison.receivedByteLength).toBe(expectedSize.width * expectedSize.height * 4);
        assertPixelEvidence(output.runtime.pixelComparison, `${stage} runtime`);
        expect(Object.keys(output.runtime.layerRecords).sort()).toEqual(['background', 'foreground']);
        for (const id of ['background', 'foreground'] as const) {
          const layer = output.runtime.layerRecords[id];
          expect(layer.pos, `${stage} projected ${id} logical position`).toEqual(layer.expectedPos);
          expect(layer.presentationBounds, `${stage} projected ${id} materialized bounds`).toEqual(
            layer.expectedPresentationBounds
          );
          expect(layer.operationsLength, `${stage} projected ${id} operations`).toBe(0);
        }
        expect(output.runtime.layerRecords.background).toMatchObject({
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          order: 0,
        });
        expect(output.runtime.layerRecords.foreground).toMatchObject({
          visible: true,
          opacity: 0.58,
          blendMode: 'multiply',
          order: 1,
        });

        expect(
          { width: output.exportCanvas.legacyWidth, height: output.exportCanvas.legacyHeight },
          `${stage} legacy export dimensions`
        ).toEqual(expectedSize);
        expect(
          { width: output.exportCanvas.durableWidth, height: output.exportCanvas.durableHeight },
          `${stage} durable export dimensions`
        ).toEqual(expectedSize);
        expect(output.exportCanvas.pixelComparison.expectedByteLength).toBe(
          expectedSize.width * expectedSize.height * 4
        );
        expect(output.exportCanvas.pixelComparison.receivedByteLength).toBe(
          expectedSize.width * expectedSize.height * 4
        );
        assertPixelEvidence(output.exportCanvas.pixelComparison, `${stage} export canvas`);
        expect(Object.keys(output.exportCanvas.layerRecords).sort()).toEqual(['background', 'foreground']);
        for (const id of ['background', 'foreground'] as const) {
          const layer = output.exportCanvas.layerRecords[id];
          expect(layer.pos, `${stage} exported ${id} position`).toEqual(layer.expectedPos);
          expect(layer.presentationBounds, `${stage} exported ${id} presentation bounds`).toBeNull();
          expect(layer.operationsLength, `${stage} exported ${id} operations`).toBe(0);
        }
        expect(output.exportCanvas.layerRecords.background).toMatchObject({
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          order: 0,
        });
        expect(output.exportCanvas.layerRecords.foreground).toMatchObject({
          visible: true,
          opacity: 0.58,
          blendMode: 'multiply',
          order: 1,
        });

        const readPngPixels = async (base64: string) => {
          const decoded = await sharp(Buffer.from(base64, 'base64'))
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          return {
            width: decoded.info.width,
            height: decoded.info.height,
            channels: decoded.info.channels,
            data: decoded.data,
          };
        };
        const compareByteSequences = (
          expected: ArrayLike<number>,
          received: ArrayLike<number>,
          width: number,
          height: number,
          originX: number,
          originY: number
        ) => {
          const expectedLength = width * height * 4;
          if (expected.length !== expectedLength || received.length !== expectedLength) {
            throw new Error(
              `${stage} pixel comparison has ${expected.length}/${received.length} bytes; expected ${expectedLength} for ${width}x${height}`
            );
          }
          let differingBytes = 0;
          let differingPixels = 0;
          let lastDifferingPixel = -1;
          let maxChannelDelta = 0;
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          const differingSamples: Array<{
            offset: number;
            x: number;
            y: number;
            documentX: number;
            documentY: number;
            expected: number | null;
            received: number | null;
            expectedRgba: readonly (number | null)[];
            receivedRgba: readonly (number | null)[];
            expectedAlpha: number | null;
            receivedAlpha: number | null;
            differingChannels: Array<'r' | 'g' | 'b' | 'a'>;
          }> = [];
          const sampleByPixel = new Map<number, (typeof differingSamples)[number]>();
          const channels = ['r', 'g', 'b', 'a'] as const;
          const readRgba = (pixels: ArrayLike<number>, byteOffset: number) =>
            Array.from({ length: 4 }, (_, channel) => pixels[byteOffset + channel] ?? null);
          for (let offset = 0; offset < Math.max(expected.length, received.length); offset += 1) {
            const expectedByte = expected[offset] ?? null;
            const receivedByte = received[offset] ?? null;
            if (expectedByte === receivedByte) continue;
            differingBytes += 1;
            const pixel = Math.floor(offset / 4);
            // Pixel indices identify cell origins; preserve the frame's fractional document origin.
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            if (pixel !== lastDifferingPixel) {
              differingPixels += 1;
              lastDifferingPixel = pixel;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
            maxChannelDelta = Math.max(
              maxChannelDelta,
              expectedByte === null || receivedByte === null ? 255 : Math.abs(expectedByte - receivedByte)
            );
            const existingSample = sampleByPixel.get(pixel);
            if (existingSample) {
              const channel = channels[offset % 4];
              if (!existingSample.differingChannels.includes(channel)) {
                existingSample.differingChannels.push(channel);
              }
            } else if (differingSamples.length < 8) {
              const sampleX = pixel % width;
              const sampleY = Math.floor(pixel / width);
              const expectedRgba = readRgba(expected, pixel * 4);
              const receivedRgba = readRgba(received, pixel * 4);
              const sample = {
                offset,
                x: sampleX,
                y: sampleY,
                documentX: originX + sampleX,
                documentY: originY + sampleY,
                expected: expectedByte,
                received: receivedByte,
                expectedRgba,
                receivedRgba,
                expectedAlpha: expectedRgba[3] ?? null,
                receivedAlpha: receivedRgba[3] ?? null,
                differingChannels: [channels[offset % 4]],
              };
              sampleByPixel.set(pixel, sample);
              differingSamples.push(sample);
            }
          }
          return {
            expectedByteLength: expected.length,
            receivedByteLength: received.length,
            differingBytes,
            differingPixels,
            maxChannelDelta,
            differingBounds:
              differingPixels === 0
                ? null
                : {
                    x: minX,
                    y: minY,
                    documentX: originX + minX,
                    documentY: originY + minY,
                    width: maxX - minX + 1,
                    height: maxY - minY + 1,
                  },
            differingSamples,
          };
        };
        const legacyPng = await readPngPixels(output.png.legacyBase64);
        const durablePng = await readPngPixels(output.png.durableBase64);
        expect(
          { width: legacyPng.width, height: legacyPng.height, channels: legacyPng.channels },
          `${stage} decoded legacy PNG dimensions`
        ).toEqual({ width: expectedSize.width, height: expectedSize.height, channels: 4 });
        expect(
          { width: durablePng.width, height: durablePng.height, channels: durablePng.channels },
          `${stage} decoded durable PNG dimensions`
        ).toEqual({ width: expectedSize.width, height: expectedSize.height, channels: 4 });
        const pngPixelComparison = compareByteSequences(
          legacyPng.data,
          durablePng.data,
          expectedSize.width,
          expectedSize.height,
          frameBounds.x,
          frameBounds.y
        );
        assertPixelEvidence(pngPixelComparison, `${stage} PNG`);

        const legacyPsd = decodePsdCapture(output.psd.legacyBase64);
        const durablePsd = decodePsdCapture(output.psd.durableBase64);
        expect({ width: legacyPsd.width, height: legacyPsd.height }, `${stage} legacy PSD dimensions`).toEqual(
          expectedSize
        );
        expect({ width: durablePsd.width, height: durablePsd.height }, `${stage} durable PSD dimensions`).toEqual(
          expectedSize
        );
        if (!legacyPsd.imageData || !durablePsd.imageData) {
          throw new Error(`${stage} PSD decode returned no composite pixels`);
        }
        const psdCompositePixelComparison = compareByteSequences(
          legacyPsd.imageData.data,
          durablePsd.imageData.data,
          expectedSize.width,
          expectedSize.height,
          frameBounds.x,
          frameBounds.y
        );
        assertPixelEvidence(psdCompositePixelComparison, `${stage} PSD composite`);
        expect(
          legacyPsd.children?.map((layer) => layer.name),
          `${stage} legacy PSD layer order`
        ).toEqual(['background', 'foreground']);
        expect(
          durablePsd.children?.map((layer) => layer.name),
          `${stage} durable PSD layer order`
        ).toEqual(['background', 'foreground']);
        const psdLayerPixelComparisons = {} as Record<
          'background' | 'foreground',
          ReturnType<typeof compareByteSequences>
        >;
        const psdLayerSurfaceBounds = {} as Record<
          'background' | 'foreground',
          Readonly<{
            expected: (typeof output.psd.expectedLayerBounds)['background'];
            legacy: Readonly<{ left: number; top: number; right: number; bottom: number }>;
            durable: Readonly<{ left: number; top: number; right: number; bottom: number }>;
          }>
        >;
        for (const id of ['background', 'foreground'] as const) {
          const legacyLayer = legacyPsd.children?.find((layer) => layer.name === id);
          const durableLayer = durablePsd.children?.find((layer) => layer.name === id);
          if (!legacyLayer || !durableLayer) throw new Error(`${stage} PSD is missing ${id}`);
          const expectedBounds = output.psd.expectedLayerBounds[id];
          const readBounds = (layer: typeof legacyLayer, label: string) => {
            const { left, top, right, bottom } = layer;
            if (
              typeof left !== 'number' ||
              typeof top !== 'number' ||
              typeof right !== 'number' ||
              typeof bottom !== 'number'
            ) {
              throw new Error(`${stage} PSD ${label} has incomplete bounds`);
            }
            return { left, top, right, bottom };
          };
          const legacyBounds = readBounds(legacyLayer, `legacy ${id}`);
          const durableBounds = readBounds(durableLayer, `durable ${id}`);
          psdLayerSurfaceBounds[id] = { expected: expectedBounds, legacy: legacyBounds, durable: durableBounds };
          expect(legacyBounds, `${stage} legacy PSD ${id} bounds`).toEqual(expectedBounds);
          expect(durableBounds, `${stage} durable PSD ${id} bounds`).toEqual(expectedBounds);
          const opacity = id === 'foreground' ? Math.round(0.58 * 255) / 255 : 1;
          const blendMode = id === 'foreground' ? 'multiply' : 'normal';
          expect(
            { hidden: legacyLayer.hidden, opacity: legacyLayer.opacity, blendMode: legacyLayer.blendMode },
            `${stage} legacy PSD ${id} compositing metadata`
          ).toEqual({ hidden: false, opacity, blendMode });
          expect(
            { hidden: durableLayer.hidden, opacity: durableLayer.opacity, blendMode: durableLayer.blendMode },
            `${stage} durable PSD ${id} compositing metadata`
          ).toEqual({ hidden: false, opacity, blendMode });
          if (!legacyLayer.imageData || !durableLayer.imageData) {
            throw new Error(`${stage} PSD decode returned no ${id} layer pixels`);
          }
          expect(
            { width: legacyLayer.imageData.width, height: legacyLayer.imageData.height },
            `${stage} legacy PSD ${id} layer dimensions`
          ).toEqual({
            width: expectedBounds.right - expectedBounds.left,
            height: expectedBounds.bottom - expectedBounds.top,
          });
          expect(
            { width: durableLayer.imageData.width, height: durableLayer.imageData.height },
            `${stage} durable PSD ${id} layer dimensions`
          ).toEqual({
            width: expectedBounds.right - expectedBounds.left,
            height: expectedBounds.bottom - expectedBounds.top,
          });
          psdLayerPixelComparisons[id] = compareByteSequences(
            legacyLayer.imageData.data,
            durableLayer.imageData.data,
            expectedBounds.right - expectedBounds.left,
            expectedBounds.bottom - expectedBounds.top,
            frameBounds.x + expectedBounds.left,
            frameBounds.y + expectedBounds.top
          );
          assertPixelEvidence(psdLayerPixelComparisons[id], `${stage} PSD ${id}`, {
            x: frameBounds.x + expectedBounds.left,
            y: frameBounds.y + expectedBounds.top,
          });
        }
        const psdPreEncodeLayerPixelComparisons = {} as Record<
          'background' | 'foreground',
          ReturnType<typeof compareByteSequences>
        >;
        for (const id of ['background', 'foreground'] as const) {
          const preEncode = output.psd.preEncodeLayers[id];
          if (!preEncode?.pixelComparison) {
            throw new Error(`${stage} PSD ${id} did not produce matching pre-encode layer bounds`);
          }
          const expectedBounds = output.psd.expectedLayerBounds[id];
          expect(preEncode.legacyBounds, `${stage} legacy pre-encode PSD ${id} bounds`).toEqual(expectedBounds);
          expect(preEncode.durableBounds, `${stage} durable pre-encode PSD ${id} bounds`).toEqual(expectedBounds);
          const expectedRasterSize = {
            width: expectedBounds.right - expectedBounds.left,
            height: expectedBounds.bottom - expectedBounds.top,
          };
          expect(preEncode.legacyRasterSize, `${stage} legacy pre-encode PSD ${id} size`).toEqual(expectedRasterSize);
          expect(preEncode.durableRasterSize, `${stage} durable pre-encode PSD ${id} size`).toEqual(expectedRasterSize);
          psdPreEncodeLayerPixelComparisons[id] = preEncode.pixelComparison;
        }
        if (stage === 'fractional frame cursor') {
          const backgroundBoundsControl = output.psd.preEncodeLayers.background.psdBoundsControl;
          if (!backgroundBoundsControl) {
            throw new Error(`${stage} background did not produce PSD-bounds diagnostic controls`);
          }
          const comparedFramePixels = expectedSize.width * expectedSize.height;
          // Keep exploratory clip measurements while gating product parity separately.
          for (const source of ['legacy', 'durable'] as const) {
            const commonBacking = backgroundBoundsControl[source].commonBackingClipControls;
            const physicalBacking = backgroundBoundsControl[source].physicalBackingSizeMatrixControls;
            if (!commonBacking || !physicalBacking) {
              throw new Error(`${stage} ${source} background did not produce backing-size diagnostics`);
            }
            expect(commonBacking.originalFrameComparedPixels, `${source} clip diagnostic frame coverage`).toBe(
              comparedFramePixels
            );
            expect(Object.keys(commonBacking.commonBackingClipVsBaseline).sort()).toEqual([
              'combined',
              'heightOnly',
              'widthOnly',
            ]);
            for (const [clipName, comparison] of Object.entries(commonBacking.commonBackingClipVsBaseline)) {
              expect(comparison.measurementStatus, `${source} ${clipName} clip measurement`).toBe('measured');
              expect(comparison.comparedPixels, `${source} ${clipName} clip coverage`).toBe(comparedFramePixels);
              const pixelComparison = comparison.pixelComparison;
              expect(pixelComparison?.expectedByteLength, `${source} ${clipName} clip expected-byte coverage`).toBe(
                comparedFramePixels * 4
              );
              expect(pixelComparison?.receivedByteLength, `${source} ${clipName} clip received-byte coverage`).toBe(
                comparedFramePixels * 4
              );
              expect(Number.isSafeInteger(pixelComparison?.differingBytes)).toBe(true);
              expect(
                pixelComparison?.differingBytes,
                `${source} ${clipName} clip differing-byte lower bound`
              ).toBeGreaterThanOrEqual(0);
              expect(
                pixelComparison?.differingBytes,
                `${source} ${clipName} clip differing-byte upper bound`
              ).toBeLessThanOrEqual(comparedFramePixels * 4);
            }
            expect(
              commonBacking.widthHeightInteraction.measurementStatus,
              `${source} clip interaction measurement`
            ).toBe('measured');
            expect(commonBacking.widthHeightInteraction.comparedPixels, `${source} clip interaction coverage`).toBe(
              comparedFramePixels
            );
            expect(Number.isSafeInteger(commonBacking.widthHeightInteraction.differingBytes)).toBe(true);
            expect(commonBacking.widthHeightInteraction.differingBytes).toBeGreaterThanOrEqual(0);
            expect(commonBacking.widthHeightInteraction.differingBytes).toBeLessThanOrEqual(comparedFramePixels * 4);
            expect(physicalBacking.originalFrameComparedPixels, `${source} physical-size frame coverage`).toBe(
              comparedFramePixels
            );
            expect(physicalBacking.physicalBackingSizes).toHaveLength(8);
            expect(
              physicalBacking.physicalBackingSizes.map(({ backingPixelSize }) => backingPixelSize),
              `${source} physical-size matrix`
            ).toEqual([46, 47, 51, 89].flatMap((height) => [51, 89].map((width) => ({ width, height }))));
            for (const measurement of physicalBacking.physicalBackingSizes) {
              for (const representation of ['raw', 'premultiplied'] as const) {
                const comparison = measurement.frameRegionVsBaseline[representation];
                const label = `${source} ${measurement.backingPixelSize.width}x${measurement.backingPixelSize.height} ${representation}`;
                expect(comparison.measurementStatus, `${label} measurement`).toBe('measured');
                expect(comparison.comparedPixels, `${label} coverage`).toBe(comparedFramePixels);
              }
            }
            expect(
              physicalBacking.widthExtensionAtEachHeight.map(({ backingHeight }) => backingHeight),
              `${source} width comparisons by height`
            ).toEqual([46, 47, 51, 89]);
            for (const measurement of physicalBacking.widthExtensionAtEachHeight) {
              for (const representation of ['raw', 'premultiplied'] as const) {
                const comparison = measurement.width51VsWidth89[representation];
                const label = `${source} width comparison at height ${measurement.backingHeight} ${representation}`;
                expect(comparison.measurementStatus, `${label} measurement`).toBe('measured');
                expect(comparison.comparedPixels, `${label} coverage`).toBe(comparedFramePixels);
              }
            }
            expect(
              physicalBacking.widthHeightInteractionAtEachExpandedHeight.map(({ backingHeight }) => backingHeight),
              `${source} width-height interactions`
            ).toEqual([47, 51, 89]);
            for (const measurement of physicalBacking.widthHeightInteractionAtEachExpandedHeight) {
              expect(
                measurement.interaction.measurementStatus,
                `${source} interaction at ${measurement.backingHeight}`
              ).toBe('measured');
              expect(
                measurement.interaction.comparedPixels,
                `${source} interaction coverage at ${measurement.backingHeight}`
              ).toBe(comparedFramePixels);
            }
            const firstDifferenceTrace = physicalBacking.firstDifferenceTraceControls;
            if (!firstDifferenceTrace) {
              throw new Error(`${stage} ${source} background did not produce first-difference call traces`);
            }
            expect(firstDifferenceTrace.target.firstDifferenceSelection.measurementStatus).toBe('measured');
            expect(firstDifferenceTrace.target.firstDifferenceSelection.comparedPixels).toBe(comparedFramePixels);
            expect(firstDifferenceTrace.target.baselineBackingSize).toEqual({ width: 51, height: 46 });
            expect(firstDifferenceTrace.target.oneRowLargerBackingSize).toEqual({ width: 51, height: 47 });
            const selectedFirstDifference =
              firstDifferenceTrace.target.firstDifferenceSelection.firstDifferingFrameLocalPixelCell;
            expect(firstDifferenceTrace.target.firstDifferenceSelection.differingBytes > 0).toBe(
              firstDifferenceTrace.target.firstDifferenceSelection.status === 'found'
            );
            expect(firstDifferenceTrace.target.firstDifferenceSelection.status).toBe(
              selectedFirstDifference ? 'found' : 'none'
            );
            expect(firstDifferenceTrace.target.sampleFrameLocalPixelCell).toEqual(
              selectedFirstDifference ?? { x: 0, y: 0 }
            );
            expect(firstDifferenceTrace.canvasTypeComparisons.map(({ canvasType }) => canvasType)).toEqual(
              firstDifferenceTrace.offscreenCanvasAvailable ? ['HTMLCanvas', 'OffscreenCanvas'] : ['HTMLCanvas']
            );
            for (const comparison of firstDifferenceTrace.canvasTypeComparisons) {
              expect(comparison.inputSourceIdentityStable, `${source} ${comparison.canvasType} source identity`).toBe(
                true
              );
              expect(comparison.drawImageCallSignatureStable, `${source} ${comparison.canvasType} draw inputs`).toBe(
                true
              );
              const isFiniteNumber = (value: unknown): value is number =>
                typeof value === 'number' && Number.isFinite(value);
              const isRecord = (value: unknown): value is Record<string, unknown> =>
                typeof value === 'object' && value !== null;
              const originalCapturedCall = comparison.baseline.drawImageCalls[0];
              if (!originalCapturedCall) {
                throw new Error(`${source} ${comparison.canvasType} trace has no captured original call`);
              }
              const originalNumericArguments = originalCapturedCall.numericArguments;
              if (!Array.isArray(originalNumericArguments) || !originalNumericArguments.every(isFiniteNumber)) {
                throw new Error(`${source} ${comparison.canvasType} trace has invalid drawImage arguments`);
              }
              const originalImageSizeCandidate = originalCapturedCall.imageSize;
              if (
                !isRecord(originalImageSizeCandidate) ||
                !isFiniteNumber(originalImageSizeCandidate.width) ||
                !isFiniteNumber(originalImageSizeCandidate.height)
              ) {
                throw new Error(`${source} ${comparison.canvasType} trace has invalid source dimensions`);
              }
              const originalSourceSize = {
                width: originalImageSizeCandidate.width,
                height: originalImageSizeCandidate.height,
              };
              for (const run of [comparison.baseline, comparison.oneRowLarger]) {
                expect(run.drawImageCalls, `${source} ${comparison.canvasType} captured calls`).toHaveLength(1);
                expect(run.drawImageCalls[0].argumentCount).toBe(5);
                expect(run.drawImageCalls[0].sourceConstructor).toBe(originalCapturedCall.sourceConstructor);
                expect(run.drawImageCalls[0].imageSize).toEqual(originalCapturedCall.imageSize);
                expect(run.drawImageCalls[0].numericArguments).toEqual(originalCapturedCall.numericArguments);
              }
              expect(originalCapturedCall.sourceConstructor).toBe('ImageBitmap');
              expect(originalNumericArguments).toHaveLength(4);
              expect(originalNumericArguments.every(Number.isFinite)).toBe(true);
              for (const run of [comparison.baseline, comparison.oneRowLarger]) {
                expect(
                  run.status,
                  `${source} ${run.canvasType} ${run.canvasBackingSize.width}x${run.canvasBackingSize.height}`
                ).toBe('measured');
                expect(run.drawImageCalls.length, `${source} ${run.canvasType} drawImage trace`).toBeGreaterThan(0);
                expect(run.readbackSample.rgba, `${source} ${run.canvasType} readback sample`).toHaveLength(4);
                expect(run.commonSizeCopyControl.originalFrameComparison.expectedByteLength).toBe(
                  comparedFramePixels * 4
                );
                expect(run.commonSizeCopyControl.originalFrameComparison.receivedByteLength).toBe(
                  comparedFramePixels * 4
                );
              }
              if (comparison.canvasType === 'HTMLCanvas') {
                const firstObservedDifference = comparison.originalFrameComparison.differingSamples[0];
                expect(
                  firstObservedDifference ? { x: firstObservedDifference.x, y: firstObservedDifference.y } : null,
                  `${source} first differing frame cell`
                ).toEqual(selectedFirstDifference);
              }
              const directReproduction = comparison.directDrawImageReproduction;
              for (const run of [directReproduction.baseline, directReproduction.oneRowLarger]) {
                expect(run.drawImageCallCount, `${source} direct call count`).toBeGreaterThan(0);
                expect(run.frameByteLength, `${source} direct frame byte coverage`).toBe(comparedFramePixels * 4);
                expect(run.comparisonToDrawLayerSource.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToDrawLayerSource.receivedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToDrawLayerSource.differingBytes, `${source} direct replay fidelity`).toBe(0);
              }
              expect(directReproduction.originalFrameComparison.expectedByteLength).toBe(comparedFramePixels * 4);
              expect(directReproduction.originalFrameComparison.receivedByteLength).toBe(comparedFramePixels * 4);
              expect(directReproduction.originalFrameComparison).toEqual(comparison.originalFrameComparison);
              const transparentPadding = comparison.transparentPaddingControl;
              expect(transparentPadding.source.originalSourceConstructor).toBe('ImageBitmap');
              expect(transparentPadding.source.paddedSourceConstructor).toBe('ImageBitmap');
              const [dx, dy, dw, dh] = originalNumericArguments;
              if (dx === undefined || dy === undefined || dw === undefined || dh === undefined) {
                throw new Error(`${source} ${comparison.canvasType} original draw geometry is incomplete`);
              }
              const paddedDestinationArguments = transparentPadding.mapping.paddedArguments;
              if (!Array.isArray(paddedDestinationArguments) || !paddedDestinationArguments.every(isFiniteNumber)) {
                throw new Error(`${source} ${comparison.canvasType} padded draw geometry is incomplete`);
              }
              const scaleX = dw / originalSourceSize.width;
              const scaleY = dh / originalSourceSize.height;
              expect(transparentPadding.source.originalSourceSize).toEqual(originalSourceSize);
              expect(transparentPadding.source.paddedSourceSize).toEqual({
                width: originalSourceSize.width + 2,
                height: originalSourceSize.height + 2,
              });
              expect(transparentPadding.source.interiorComparison.expectedByteLength).toBe(
                originalSourceSize.width * originalSourceSize.height * 4
              );
              expect(transparentPadding.source.interiorComparison.receivedByteLength).toBe(
                originalSourceSize.width * originalSourceSize.height * 4
              );
              expect(transparentPadding.source.interiorComparison.differingBytes).toBe(0);
              const expectedBorderPixels =
                (originalSourceSize.width + 2) * (originalSourceSize.height + 2) -
                originalSourceSize.width * originalSourceSize.height;
              expect(transparentPadding.source.borderPixelCount).toBe(expectedBorderPixels);
              expect(transparentPadding.source.expectedBorderPixelCount).toBe(expectedBorderPixels);
              expect(transparentPadding.source.borderNonTransparentPixelCount).toBe(0);
              expect(transparentPadding.mapping.originalArguments).toEqual(
                comparison.baseline.drawImageCalls[0].numericArguments
              );
              expect(transparentPadding.mapping.paddedArguments).toEqual([
                dx - scaleX,
                dy - scaleY,
                dw + 2 * scaleX,
                dh + 2 * scaleY,
              ]);
              expect(transparentPadding.mapping.visibleMappingPreserved).toBe(true);
              expect(transparentPadding.mapping.mappedOriginalInterior).toEqual({
                x: dx,
                y: dy,
                width: dw,
                height: dh,
              });
              for (const run of [transparentPadding.baseline, transparentPadding.oneRowLarger]) {
                expect(run.drawImageCallCount).toBe(1);
                expect(run.frameByteLength).toBe(comparedFramePixels * 4);
                expect(run.sampleRgba).toHaveLength(4);
                expect(run.comparisonToUnpadded.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToUnpadded.receivedByteLength).toBe(comparedFramePixels * 4);
              }
              expect(transparentPadding.paddedHeightComparison.expectedByteLength).toBe(comparedFramePixels * 4);
              expect(transparentPadding.paddedHeightComparison.receivedByteLength).toBe(comparedFramePixels * 4);
              const originalSourceNineArgument = transparentPadding.originalSourceNineArgumentControl;
              expect(originalSourceNineArgument.call.argumentCount).toBe(9);
              expect(originalSourceNineArgument.call.sourceRectangle).toEqual({
                x: 0,
                y: 0,
                width: originalSourceSize.width,
                height: originalSourceSize.height,
              });
              expect(originalSourceNineArgument.call.destinationRectangle).toEqual({
                x: dx,
                y: dy,
                width: dw,
                height: dh,
              });
              expect(originalSourceNineArgument.call.numericArguments).toEqual([
                0,
                0,
                originalSourceSize.width,
                originalSourceSize.height,
                dx,
                dy,
                dw,
                dh,
              ]);
              for (const run of [originalSourceNineArgument.baseline, originalSourceNineArgument.oneRowLarger]) {
                expect(run.drawImageCallCount).toBe(1);
                expect(run.frameByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToUnpaddedFiveArgument.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToUnpaddedFiveArgument.receivedByteLength).toBe(comparedFramePixels * 4);
              }
              expect(originalSourceNineArgument.backingHeightComparison.expectedByteLength).toBe(
                comparedFramePixels * 4
              );
              expect(originalSourceNineArgument.backingHeightComparison.receivedByteLength).toBe(
                comparedFramePixels * 4
              );
              const paddedInteriorNineArgument = transparentPadding.paddedInteriorNineArgumentControl;
              expect(paddedInteriorNineArgument.call.argumentCount).toBe(9);
              expect(paddedInteriorNineArgument.call.sourceRectangle).toEqual({
                x: 1,
                y: 1,
                width: originalSourceSize.width,
                height: originalSourceSize.height,
              });
              expect(paddedInteriorNineArgument.call.destinationRectangle).toEqual({
                x: dx,
                y: dy,
                width: dw,
                height: dh,
              });
              expect(paddedInteriorNineArgument.call.numericArguments).toEqual([
                1,
                1,
                originalSourceSize.width,
                originalSourceSize.height,
                dx,
                dy,
                dw,
                dh,
              ]);
              for (const run of [paddedInteriorNineArgument.baseline, paddedInteriorNineArgument.oneRowLarger]) {
                expect(run.drawImageCallCount).toBe(1);
                expect(run.frameByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToUnpadded.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToUnpadded.receivedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToOriginalSourceNineArgument.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToOriginalSourceNineArgument.receivedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToFullPaddedFiveArgument.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToFullPaddedFiveArgument.receivedByteLength).toBe(comparedFramePixels * 4);
              }
              expect(paddedInteriorNineArgument.paddedHeightComparison.expectedByteLength).toBe(
                comparedFramePixels * 4
              );
              expect(paddedInteriorNineArgument.paddedHeightComparison.receivedByteLength).toBe(
                comparedFramePixels * 4
              );
              const edgeExtendedBorderControl = transparentPadding.edgeExtendedBorderControl;
              expect(edgeExtendedBorderControl.source.originalSourceConstructor).toBe('ImageBitmap');
              expect(edgeExtendedBorderControl.source.paddedSourceConstructor).toBe('ImageBitmap');
              expect(edgeExtendedBorderControl.source.originalSourceSize).toEqual(originalSourceSize);
              expect(edgeExtendedBorderControl.source.paddedSourceSize).toEqual({
                width: originalSourceSize.width + 2,
                height: originalSourceSize.height + 2,
              });
              expect(edgeExtendedBorderControl.source.interiorComparison.expectedByteLength).toBe(
                originalSourceSize.width * originalSourceSize.height * 4
              );
              expect(edgeExtendedBorderControl.source.interiorComparison.receivedByteLength).toBe(
                originalSourceSize.width * originalSourceSize.height * 4
              );
              expect(edgeExtendedBorderControl.source.interiorComparison.differingBytes).toBe(0);
              expect(edgeExtendedBorderControl.source.borderPixelCount).toBe(expectedBorderPixels);
              expect(edgeExtendedBorderControl.source.expectedBorderPixelCount).toBe(expectedBorderPixels);
              expect(edgeExtendedBorderControl.source.extendedEdges).toEqual(['top', 'right', 'bottom', 'left']);
              expect(edgeExtendedBorderControl.source.extendedBorderPixelCount).toBe(expectedBorderPixels);
              expect(edgeExtendedBorderControl.source.transparentBorderPixelCount).toBe(0);
              expect(edgeExtendedBorderControl.source.borderComparison.expectedByteLength).toBe(
                expectedBorderPixels * 4
              );
              expect(edgeExtendedBorderControl.source.borderComparison.receivedByteLength).toBe(
                expectedBorderPixels * 4
              );
              expect(edgeExtendedBorderControl.source.borderComparison.differingBytes).toBe(0);
              expect(edgeExtendedBorderControl.source.paddedSurfaceComparison.expectedByteLength).toBe(
                (originalSourceSize.width + 2) * (originalSourceSize.height + 2) * 4
              );
              expect(edgeExtendedBorderControl.source.paddedSurfaceComparison.receivedByteLength).toBe(
                (originalSourceSize.width + 2) * (originalSourceSize.height + 2) * 4
              );
              expect(edgeExtendedBorderControl.source.paddedSurfaceComparison.differingBytes).toBe(0);
              expect(edgeExtendedBorderControl.call.argumentCount).toBe(9);
              expect(edgeExtendedBorderControl.call.sourceRectangle).toEqual(
                paddedInteriorNineArgument.call.sourceRectangle
              );
              expect(edgeExtendedBorderControl.call.destinationRectangle).toEqual(
                paddedInteriorNineArgument.call.destinationRectangle
              );
              expect(edgeExtendedBorderControl.call.numericArguments).toEqual(
                paddedInteriorNineArgument.call.numericArguments
              );
              for (const run of [edgeExtendedBorderControl.baseline, edgeExtendedBorderControl.oneRowLarger]) {
                expect(run.drawImageCallCount).toBe(1);
                expect(run.frameByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToTransparentBorder.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToTransparentBorder.receivedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToOriginalSourceNineArgument.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToOriginalSourceNineArgument.receivedByteLength).toBe(comparedFramePixels * 4);
              }
              expect(edgeExtendedBorderControl.backingHeightComparison.expectedByteLength).toBe(
                comparedFramePixels * 4
              );
              expect(edgeExtendedBorderControl.backingHeightComparison.receivedByteLength).toBe(
                comparedFramePixels * 4
              );
              const rightEdgeOnlyControl = transparentPadding.rightEdgeOnlyControl;
              expect(rightEdgeOnlyControl.source.originalSourceConstructor).toBe('ImageBitmap');
              expect(rightEdgeOnlyControl.source.paddedSourceConstructor).toBe('ImageBitmap');
              expect(rightEdgeOnlyControl.source.originalSourceSize).toEqual(originalSourceSize);
              expect(rightEdgeOnlyControl.source.paddedSourceSize).toEqual({
                width: originalSourceSize.width + 2,
                height: originalSourceSize.height + 2,
              });
              expect(rightEdgeOnlyControl.source.interiorComparison.expectedByteLength).toBe(
                originalSourceSize.width * originalSourceSize.height * 4
              );
              expect(rightEdgeOnlyControl.source.interiorComparison.receivedByteLength).toBe(
                originalSourceSize.width * originalSourceSize.height * 4
              );
              expect(rightEdgeOnlyControl.source.interiorComparison.differingBytes).toBe(0);
              expect(rightEdgeOnlyControl.source.extendedEdges).toEqual(['right']);
              expect(rightEdgeOnlyControl.source.borderPixelCount).toBe(expectedBorderPixels);
              expect(rightEdgeOnlyControl.source.expectedBorderPixelCount).toBe(expectedBorderPixels);
              expect(rightEdgeOnlyControl.source.extendedBorderPixelCount).toBe(originalSourceSize.height);
              expect(rightEdgeOnlyControl.source.transparentBorderPixelCount).toBe(
                expectedBorderPixels - originalSourceSize.height
              );
              expect(rightEdgeOnlyControl.source.borderComparison.expectedByteLength).toBe(expectedBorderPixels * 4);
              expect(rightEdgeOnlyControl.source.borderComparison.receivedByteLength).toBe(expectedBorderPixels * 4);
              expect(rightEdgeOnlyControl.source.borderComparison.differingBytes).toBe(0);
              expect(rightEdgeOnlyControl.source.paddedSurfaceComparison.expectedByteLength).toBe(
                (originalSourceSize.width + 2) * (originalSourceSize.height + 2) * 4
              );
              expect(rightEdgeOnlyControl.source.paddedSurfaceComparison.receivedByteLength).toBe(
                (originalSourceSize.width + 2) * (originalSourceSize.height + 2) * 4
              );
              expect(rightEdgeOnlyControl.source.paddedSurfaceComparison.differingBytes).toBe(0);
              expect(rightEdgeOnlyControl.call.argumentCount).toBe(9);
              expect(rightEdgeOnlyControl.call.sourceRectangle).toEqual(
                paddedInteriorNineArgument.call.sourceRectangle
              );
              expect(rightEdgeOnlyControl.call.destinationRectangle).toEqual(
                paddedInteriorNineArgument.call.destinationRectangle
              );
              expect(rightEdgeOnlyControl.call.numericArguments).toEqual(
                paddedInteriorNineArgument.call.numericArguments
              );
              for (const run of [rightEdgeOnlyControl.baseline, rightEdgeOnlyControl.oneRowLarger]) {
                expect(run.drawImageCallCount).toBe(1);
                expect(run.frameByteLength).toBe(comparedFramePixels * 4);
                for (const comparison of [
                  run.comparisonToTransparentBorder,
                  run.comparisonToOriginalSourceNineArgument,
                  run.comparisonToFullEdgeExtension,
                ]) {
                  expect(comparison.expectedByteLength).toBe(comparedFramePixels * 4);
                  expect(comparison.receivedByteLength).toBe(comparedFramePixels * 4);
                }
              }
              expect(rightEdgeOnlyControl.backingHeightComparison.expectedByteLength).toBe(comparedFramePixels * 4);
              expect(rightEdgeOnlyControl.backingHeightComparison.receivedByteLength).toBe(comparedFramePixels * 4);
              const paddedFullSourceNineArgument = transparentPadding.paddedFullSourceNineArgumentControl;
              expect(paddedFullSourceNineArgument.call.argumentCount).toBe(9);
              expect(paddedFullSourceNineArgument.call.sourceRectangle).toEqual({
                x: 0,
                y: 0,
                width: originalSourceSize.width + 2,
                height: originalSourceSize.height + 2,
              });
              expect(paddedFullSourceNineArgument.call.destinationRectangle).toEqual({
                x: dx,
                y: dy,
                width: dw,
                height: dh,
              });
              expect(paddedFullSourceNineArgument.call.numericArguments).toEqual([
                0,
                0,
                originalSourceSize.width + 2,
                originalSourceSize.height + 2,
                dx,
                dy,
                dw,
                dh,
              ]);
              for (const run of [paddedFullSourceNineArgument.baseline, paddedFullSourceNineArgument.oneRowLarger]) {
                expect(run.drawImageCallCount).toBe(1);
                expect(run.frameByteLength).toBe(comparedFramePixels * 4);
                for (const comparison of [
                  run.comparisonToUnpadded,
                  run.comparisonToInteriorNineArgument,
                  run.comparisonToFullPaddedFiveArgument,
                ]) {
                  expect(comparison.expectedByteLength).toBe(comparedFramePixels * 4);
                  expect(comparison.receivedByteLength).toBe(comparedFramePixels * 4);
                }
              }
              expect(paddedFullSourceNineArgument.paddedHeightComparison.expectedByteLength).toBe(
                comparedFramePixels * 4
              );
              expect(paddedFullSourceNineArgument.paddedHeightComparison.receivedByteLength).toBe(
                comparedFramePixels * 4
              );
              const paddedFullSourceMatchedGeometry =
                transparentPadding.paddedFullSourceMatchedGeometryNineArgumentControl;
              expect(paddedFullSourceMatchedGeometry.call.argumentCount).toBe(9);
              expect(paddedFullSourceMatchedGeometry.call.sourceRectangle).toEqual({
                x: 0,
                y: 0,
                width: originalSourceSize.width + 2,
                height: originalSourceSize.height + 2,
              });
              expect(paddedFullSourceMatchedGeometry.call.destinationRectangle).toEqual({
                x: paddedDestinationArguments[0],
                y: paddedDestinationArguments[1],
                width: paddedDestinationArguments[2],
                height: paddedDestinationArguments[3],
              });
              expect(paddedFullSourceMatchedGeometry.call.numericArguments).toEqual([
                0,
                0,
                originalSourceSize.width + 2,
                originalSourceSize.height + 2,
                ...paddedDestinationArguments,
              ]);
              for (const run of [
                paddedFullSourceMatchedGeometry.baseline,
                paddedFullSourceMatchedGeometry.oneRowLarger,
              ]) {
                expect(run.drawImageCallCount).toBe(1);
                expect(run.frameByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToFullPaddedFiveArgument.expectedByteLength).toBe(comparedFramePixels * 4);
                expect(run.comparisonToFullPaddedFiveArgument.receivedByteLength).toBe(comparedFramePixels * 4);
              }
              expect(paddedFullSourceMatchedGeometry.paddedHeightComparison.expectedByteLength).toBe(
                comparedFramePixels * 4
              );
              expect(paddedFullSourceMatchedGeometry.paddedHeightComparison.receivedByteLength).toBe(
                comparedFramePixels * 4
              );
            }
            expect(firstDifferenceTrace.htmlOffscreenComparisons).toHaveLength(
              firstDifferenceTrace.offscreenCanvasAvailable ? 2 : 0
            );
          }
        }
        const sourceBackdropSamples = output.sourceBackdropSamples;
        if (!sourceBackdropSamples) throw new Error(`${stage} has no source/backdrop samples`);
        expect(sourceBackdropSamples.layerId).toBe('foreground');
        expect(sourceBackdropSamples.frameDocumentBounds).toEqual(frameBounds);
        expect(sourceBackdropSamples.framePixelBounds).toEqual(expectedSurfaceBounds.pixels);
        expect(sourceBackdropSamples.sourceLayerBounds.legacy).toEqual(
          output.runtime.layerRecords.foreground.expectedPresentationBounds
        );
        expect(sourceBackdropSamples.sourceLayerBounds.durable).toEqual(
          output.runtime.layerRecords.foreground.presentationBounds
        );
        expect(sourceBackdropSamples.backdropSurfaceBounds).toEqual(frameBounds);
        for (const surface of ['runtime', 'exportCanvas'] as const) {
          const comparison = output[surface].pixelComparison;
          const samples = sourceBackdropSamples[surface];
          expect(samples.map(({ x, y }) => [x, y])).toEqual(comparison.differingSamples.map(({ x, y }) => [x, y]));
          for (const sample of samples) {
            expect(sample.documentX).toBe(frameBounds.x + sample.x);
            expect(sample.documentY).toBe(frameBounds.y + sample.y);
            expect(sample.rawSource.legacyRgba).toHaveLength(4);
            expect(sample.rawSource.durableRgba).toHaveLength(4);
            expect(sample.backdropComposite.legacyRgba).toHaveLength(4);
            expect(sample.backdropComposite.durableRgba).toHaveLength(4);
          }
        }
        const pixelParity = {
          runtime: output.runtime.pixelComparison,
          exportCanvas: output.exportCanvas.pixelComparison,
          png: pngPixelComparison,
          psdComposite: psdCompositePixelComparison,
          psdLayers: psdLayerPixelComparisons,
          psdPreEncodeLayers: psdPreEncodeLayerPixelComparisons,
        };
        const diagnostics = {
          psdLayerSurfaceBounds,
          psdPreEncodeLayers: output.psd.preEncodeLayers,
          surfaces: output.surfaceBounds,
          sourceBackdropSamples,
        };
        if (output.admission.eligible) {
          expect(pixelParity, `${stage} eligible durable output pixels`).toEqual({
            runtime: expect.objectContaining({ differingBytes: 0 }),
            exportCanvas: expect.objectContaining({ differingBytes: 0 }),
            png: expect.objectContaining({ differingBytes: 0 }),
            psdComposite: expect.objectContaining({ differingBytes: 0 }),
            psdLayers: {
              background: expect.objectContaining({ differingBytes: 0 }),
              foreground: expect.objectContaining({ differingBytes: 0 }),
            },
            psdPreEncodeLayers: {
              background: expect.objectContaining({ differingBytes: 0 }),
              foreground: expect.objectContaining({ differingBytes: 0 }),
            },
          });
        } else {
          expect(output.admission.reasons.foreground).toContain('not pixel-parity approved');
        }
        return { stage, admission: output.admission, pixelParity, diagnostics };
      };
      expect(transformed?.differingBytes, 'affine composite must preserve opacity and blend byte-for-byte').toBe(0);
      if (transformed) {
        assertForegroundMaterialization(transformed.materializedLayerComparisons, 'affine cursor');
        const projectedOutputs = transformed.projectedOutputParity;
        if (!projectedOutputs) throw new Error('Missing projected output parity result at affine cursor');
        adapterDiagnostics.push(await inspectProjectedOutputParity(projectedOutputs, 'affine cursor'));
        expect(projectedOutputs.admission.reasons.foreground).toContain('not pixel-parity approved');
      }
      expect(transformed?.legacyDiffersFromUntransformed).toBe(true);
      expect(transformed?.durableDiffersFromUntransformed).toBe(true);

      expect(result.transitionResults).toHaveLength(1);
      expect(result.transitionResults[0]?.differingBytes, 'frame composite must remain byte-identical').toBe(0);
      const frameTransition = result.transitionResults[0];
      if (frameTransition) {
        assertForegroundMaterialization(frameTransition.materializedLayerComparisons, 'frame transition');
        const projectedOutputs = frameTransition.projectedOutputParity;
        if (!projectedOutputs) throw new Error('Missing projected output parity result at fractional frame cursor');
        adapterDiagnostics.push(await inspectProjectedOutputParity(projectedOutputs, 'fractional frame cursor'));
        expect(projectedOutputs.admission.reasons.foreground).toContain('not pixel-parity approved');
      }
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(result.transitionResults[0]?.legacyPixels).not.toEqual(normalComposite.transitionResults[0]?.legacyPixels);
      expect(result.transitionResults[0]?.durablePixels).not.toEqual(
        normalComposite.transitionResults[0]?.durablePixels
      );
      const summarizeOpaqueBackdrop = (comparisonRun: typeof result, fixtureName: string) => {
        const stages = [
          ...comparisonRun.layerTransformResults.map((output, index) => ({
            stage: `affine cursor ${index + 1}`,
            comparisons: output.materializedLayerComparisons,
          })),
          ...comparisonRun.transitionResults.map((output, index) => ({
            stage: `frame transition ${index + 1}`,
            comparisons: output.materializedLayerComparisons,
          })),
        ];
        return stages.flatMap(({ stage, comparisons }) =>
          comparisons.flatMap(({ layerId, opaqueBackdropComparison }) =>
            opaqueBackdropComparison ? [{ fixtureName, layerId, stage, comparison: opaqueBackdropComparison }] : []
          )
        );
      };
      const opaqueBackdropDiagnostics = [
        ...summarizeOpaqueBackdrop(result, 'opacity plus multiply'),
        ...summarizeOpaqueBackdrop(normalComposite, 'normal composite'),
        ...summarizeOpaqueBackdrop(opacityOnly, 'opacity only'),
        ...summarizeOpaqueBackdrop(blendOnly, 'multiply only'),
      ];
      await testInfo.attach('affine-raster-opaque-backdrop-diagnostics.json', {
        body: JSON.stringify(opaqueBackdropDiagnostics, null, 2),
        contentType: 'application/json',
      });
      console.info(
        `[crop-history] affine opacity/blend backdrop diagnostics: ${JSON.stringify(opaqueBackdropDiagnostics)}`
      );
      await testInfo.attach('affine-raster-opacity-blend-adapter-diagnostics.json', {
        body: JSON.stringify({ adapterDiagnostics, affineControlComparisons, fractionalControlComparisons }, null, 2),
        contentType: 'application/json',
      });
      console.info(
        `[crop-history] affine opacity/blend adapter diagnostics: ${JSON.stringify({ adapterDiagnostics, affineControlComparisons, fractionalControlComparisons })}`
      );
    });

    test('a retained styled text transform matches through a sequence of frame transforms', async ({ page }) => {
      await openDocument(page);

      const fixture: CropParityFixture = {
        caseName: 'retained styled text affine followed by frame sequence',
        documentId: 'retained-styled-text-frame-sequence-parity',
        materializedLayerIds: ['styled-text'],
        layerTransforms: [
          {
            id: 'styled-text-affine',
            layerId: 'styled-text',
            args: {
              toolName: 'transform',
              rotate: 19,
              mirrorH: true,
              mirrorV: false,
              skewX: 4,
              skewY: -2,
              trapezoid: 0,
              resizeX: 108,
              resizeY: 92,
            },
          },
        ],
        transitions: [
          { angleDegrees: -23, nextFrame: { x: 6.25, y: 8.5, width: 49.6, height: 43.25 } },
          { angleDegrees: 11, nextFrame: { x: 7.75, y: 9.125, width: 47.5, height: 41.875 } },
        ],
        layers: [
          {
            kind: 'text',
            id: 'styled-text',
            order: 0,
            pos: { x: 10, y: 14, width: 44, height: 30 },
            textArgs: {
              toolName: 'text',
              align: 'center',
              bold: true,
              color: '#ff00aa',
              fontFamily: 'serif',
              fontSize: 13,
              italic: true,
              lineHeight: 1.25,
              text: 'Frame\nparity',
              rect: { x1: 0, y1: 0, x2: 44, y2: 30 },
              kind: 'paragraph',
            },
          },
        ],
      };

      const result = await compareCropRenderers(page, fixture);
      const untransformedControl = await compareCropRenderers(page, {
        ...fixture,
        caseName: 'untransformed control for retained styled text frame sequence',
        documentId: 'retained-styled-text-frame-sequence-control',
        layerTransforms: [],
      });

      expect(result.layerTransformResults).toHaveLength(1);
      expect(result.layerTransformResults[0]?.frame).toEqual({ x: 0, y: 0, width: 64, height: 64 });
      expect(result.layerTransformResults[0]?.durableFrame).toEqual(result.layerTransformResults[0]?.frame);
      expect(result.layerTransformResults[0]?.differingBytes).toBe(0);
      expect(result.layerTransformResults[0]?.legacyDiffersFromUntransformed).toBe(true);
      expect(result.layerTransformResults[0]?.durableDiffersFromUntransformed).toBe(true);
      expect(result.layerTransformResults[0]?.legacyDiffersFromPrevious).toBe(true);
      expect(result.layerTransformResults[0]?.durableDiffersFromPrevious).toBe(true);
      const textTransformComparisons = result.layerTransformResults[0]?.materializedLayerComparisons ?? [];
      expect(textTransformComparisons).toHaveLength(1);
      expect(textTransformComparisons.map((comparison) => comparison.layerId)).toEqual(['styled-text']);
      for (const comparison of textTransformComparisons) {
        expect(comparison.materializedBounds).toEqual(comparison.expectedBounds);
        expect(comparison.bitmapSize).toEqual({
          width: comparison.expectedBounds.width,
          height: comparison.expectedBounds.height,
        });
        expect(comparison.frameDifferingBytes).toBe(0);
        expectTightBitmapPremultipliedParity(comparison, 'styled text');
      }
      expect(result.transitionResults).toHaveLength(fixture.transitions.length);
      expect(untransformedControl.transitionResults).toHaveLength(fixture.transitions.length);
      for (const [index, transition] of result.transitionResults.entries()) {
        const controlTransition = untransformedControl.transitionResults[index];
        expect(controlTransition).toBeDefined();
        expect(controlTransition?.frame).toEqual(fixture.transitions[index]?.nextFrame);
        expect(controlTransition?.durableFrame).toEqual(controlTransition?.frame);
        expect(controlTransition?.differingBytes).toBe(0);
        expect(transition.frame).toEqual(fixture.transitions[index]?.nextFrame);
        expect(transition.durableFrame).toEqual(transition.frame);
        expect(transition.differingBytes).toBe(0);
        expect(transition.legacyPixels).not.toEqual(controlTransition?.legacyPixels);
        expect(transition.durablePixels).not.toEqual(controlTransition?.durablePixels);
        expect(transition.materializedLayerComparisons).toHaveLength(1);
        expect(controlTransition?.materializedLayerComparisons).toHaveLength(1);
        expect(controlTransition?.materializedLayerComparisons.map((comparison) => comparison.layerId)).toEqual([
          'styled-text',
        ]);
        for (const comparison of controlTransition?.materializedLayerComparisons ?? []) {
          expect(comparison.materializedBounds).toEqual(comparison.expectedBounds);
          expect(comparison.bitmapSize).toEqual({
            width: comparison.expectedBounds.width,
            height: comparison.expectedBounds.height,
          });
          expect(comparison.frameDifferingBytes).toBe(0);
          expectTightBitmapPremultipliedParity(comparison, 'frame-only styled text');
        }
        for (const comparison of transition.materializedLayerComparisons) {
          expect(comparison.materializedBounds).toEqual(comparison.expectedBounds);
          expect(comparison.bitmapSize).toEqual({
            width: comparison.expectedBounds.width,
            height: comparison.expectedBounds.height,
          });
          expect(comparison.frameDifferingBytes).toBe(0);
          expectTightBitmapPremultipliedParity(comparison, 'styled text');
        }
      }
      expect(result.durablePixels).toEqual(result.legacyPixels);
      expect(Object.keys(result.materializedBounds)).toEqual(['styled-text']);
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
      expect(
        result.differingBytes,
        `text-source crop rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
      ).toBe(0);
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
        `paragraph text crop rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
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
      expect(
        result.differingBytes,
        `offset text crop rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
      ).toBe(0);
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
      expect(
        result.differingBytes,
        `blank-source crop rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
      ).toBe(0);
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
        `vector-source crop rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
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
      expect(
        result.differingBytes,
        `paint-source crop rasters must match byte-for-byte; ${pixelDifferenceSummary(result)}`
      ).toBe(0);
      expect(result.durablePixels).toEqual(result.legacyPixels);
    });

    test('multi-step frame transitions retain byte parity across text, vector, blank, and paint sources', async ({
      page,
    }) => {
      await openDocument(page);

      const fixture: CropParityFixture = {
        caseName: 'multi-step mixed-source crop',
        documentId: 'multi-step-mixed-source-crop-pixel-parity',
        materializedLayerIds: ['blank', 'blank-semi', 'vector', 'paint', 'text'],
        layerTransforms: [
          {
            id: 'blank-affine',
            layerId: 'blank',
            args: {
              toolName: 'transform',
              rotate: 13,
              mirrorH: false,
              mirrorV: true,
              skewX: 2,
              skewY: -1,
              trapezoid: 0,
              resizeX: 105,
              resizeY: 90,
            },
          },
          {
            id: 'blank-affine-follow-up',
            layerId: 'blank',
            args: {
              toolName: 'transform',
              rotate: -5,
              mirrorH: true,
              mirrorV: false,
              skewX: -1,
              skewY: 2,
              trapezoid: 0,
              resizeX: 96,
              resizeY: 103,
            },
          },
          {
            id: 'blank-opacity-affine',
            layerId: 'blank-semi',
            args: {
              toolName: 'transform',
              rotate: 9,
              mirrorH: false,
              mirrorV: true,
              skewX: 1,
              skewY: -2,
              trapezoid: 0,
              resizeX: 104,
              resizeY: 94,
            },
          },
          {
            id: 'vector-affine',
            layerId: 'vector',
            args: {
              toolName: 'transform',
              rotate: -9,
              mirrorH: true,
              mirrorV: false,
              skewX: 3,
              skewY: 2,
              trapezoid: 0,
              resizeX: 92,
              resizeY: 108,
            },
          },
          {
            id: 'paint-affine',
            layerId: 'paint',
            args: {
              toolName: 'transform',
              rotate: 17,
              mirrorH: false,
              mirrorV: false,
              skewX: -4,
              skewY: 1,
              trapezoid: 0,
              resizeX: 112,
              resizeY: 84,
            },
          },
          {
            id: 'point-text-affine',
            layerId: 'text',
            args: {
              toolName: 'transform',
              rotate: -6,
              mirrorH: false,
              mirrorV: false,
              skewX: 1,
              skewY: 3,
              trapezoid: 0,
              resizeX: 99,
              resizeY: 106,
            },
          },
        ],
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
            kind: 'blank',
            id: 'blank-semi',
            order: 1,
            pos: { x: 7, y: 8, width: 9, height: 10 },
            color: '#ffff00',
            opacity: 0.45,
          },
          {
            kind: 'vector',
            id: 'vector',
            order: 2,
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
            order: 3,
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
            order: 4,
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
      };
      const integerResult = await compareCropRenderers(page, fixture);

      const assertMixedLayerParity = (comparisons: readonly CropParityLayerComparison[], stage: string) => {
        expect(comparisons, `${stage} materialized layer count`).toHaveLength(5);
        expect(comparisons.map((comparison) => comparison.layerId)).toEqual([
          'blank',
          'blank-semi',
          'vector',
          'paint',
          'text',
        ]);
        for (const comparison of comparisons) {
          expect(comparison.materializedBounds, `${comparison.layerId} bounds at ${stage}`).toEqual(
            comparison.expectedBounds
          );
          expect(comparison.bitmapSize, `${comparison.layerId} bitmap size at ${stage}`).toEqual({
            width: comparison.expectedBounds.width,
            height: comparison.expectedBounds.height,
          });
          expect(
            comparison.frameDifferingBytes,
            `${comparison.layerId} pixels at ${stage} differ at ${JSON.stringify(comparison.frameDifferingSamples)}`
          ).toBe(0);
          expect(
            {
              htmlCanvas: comparison.tightBitmapPremultipliedDifferingBytes,
              offscreenCanvas: comparison.offscreenTightBitmapPremultipliedDifferingBytes,
            },
            `${comparison.layerId} full tight bitmap at ${stage} differs at ${JSON.stringify(comparison.tightBitmapDifferingSamples)}`
          ).toEqual({ htmlCanvas: 0, offscreenCanvas: 0 });
        }
      };

      const assertMixedSourceParity = (result: Awaited<ReturnType<typeof compareCropRenderers>>, context: string) => {
        expect(result.layerTransformResults, context + ' retained affine count').toHaveLength(6);
        for (const transform of result.layerTransformResults) {
          assertMixedLayerParity(transform.materializedLayerComparisons, context + ' retained affine ' + transform.id);
          expect(transform.differingBytes, context + ' retained affine ' + transform.id + ' composite parity').toBe(0);
          expect(transform.legacyDiffersFromUntransformed).toBe(true);
          expect(transform.durableDiffersFromUntransformed).toBe(true);
          expect(transform.legacyDiffersFromPrevious).toBe(true);
          expect(transform.durableDiffersFromPrevious).toBe(true);
        }
        expect(result.transitionResults, context + ' frame transition count').toHaveLength(3);
        for (const transition of result.transitionResults) {
          expect(transition.durableFrame).toEqual(transition.frame);
          const frameSize = getDocumentFrameSize(transition.frame);
          expect(transition.legacyByteLength).toBe(frameSize.width * frameSize.height * 4);
          expect(transition.durableByteLength).toBe(transition.legacyByteLength);
          assertMixedLayerParity(
            transition.materializedLayerComparisons,
            context + ' frame transition ' + transition.index
          );
          expect(
            transition.differingBytes,
            context +
              ' frame transition ' +
              transition.index +
              ' must match byte-for-byte; ' +
              pixelDifferenceSummary(transition)
          ).toBe(0);
        }
        for (const [color, presence] of Object.entries(result.colorPresence)) {
          expect(presence.legacy, context + ' legacy mixed-source crop should contain ' + color).toBe(true);
          expect(presence.durable, context + ' durable mixed-source crop should contain ' + color).toBe(true);
        }
        expect(result.durablePixels, context + ' final composite').toEqual(result.legacyPixels);
        expect(Object.keys(result.materializedBounds).sort()).toEqual([
          'blank',
          'blank-semi',
          'paint',
          'text',
          'vector',
        ]);
      };

      assertMixedSourceParity(integerResult, 'integer frame fixture');
      const fractionalResult = await compareCropRenderers(page, {
        ...fixture,
        caseName: 'fractional multi-step mixed-source crop',
        documentId: 'fractional-multi-step-mixed-source-crop-pixel-parity',
        transitions: [
          { angleDegrees: 37, nextFrame: { x: 4.25, y: 4.5, width: 55.75, height: 55.5 } },
          { angleDegrees: 0, nextFrame: { x: 5.125, y: 6.25, width: 53.5, height: 51.875 } },
          { angleDegrees: -17, nextFrame: { x: 6.75, y: 6.125, width: 49.875, height: 49.5 } },
        ],
      });
      assertMixedSourceParity(fractionalResult, 'fractional frame fixture');
    });
  });
});
