import { expect, type Page, type TestInfo, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type ClipOptions,
  canvasOffsetToDocument,
  documentToCanvasOffset,
  drawLine,
  getColorAtPoint,
  getDarkPixelBounds,
  getStrokeAnalysis,
  getWorkspaceCanvas,
  loadImageData,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, waitForCanvasPixels } from './helpers/canvas-redraw';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
const THIN_THICKNESS = '4';
const WIDE_THICKNESS = '40';

/**
 * The authored ratio is 40/4 = 10x. Three is asserted, which is a third of that: the tip is
 * authored in document pixels and measured in capture ones, so the measurement also carries
 * the canvas scale and the device pixel ratio, and the ratio is taken on the OUTER bounds of
 * a stroke, where the round caps and the antialiasing add to both ends.
 */
const WIDE_TO_THIN_MIN_RATIO = 3;

const BLUE = '#0000ff';
const STROKE_BLACK = '#000000';

type Point = { x: number; y: number };
type Rect = { from: Point; to: Point };

type Figure = { label: string; toolName: string; slug: string; rect: Rect };

const FIGURES: readonly Figure[] = [
  {
    label: 'Rectangle Tool',
    toolName: 'shape',
    slug: 'rectangle',
    rect: { from: { x: 40, y: 40 }, to: { x: 250, y: 180 } },
  },
  {
    label: 'Ellipse Tool',
    toolName: 'shape',
    slug: 'ellipse',
    rect: { from: { x: 300, y: 40 }, to: { x: 510, y: 180 } },
  },
  { label: 'Line Tool', toolName: 'shape', slug: 'line', rect: { from: { x: 560, y: 40 }, to: { x: 760, y: 180 } } },
  {
    label: 'Triangle Tool',
    toolName: 'shape',
    slug: 'triangle',
    rect: { from: { x: 40, y: 260 }, to: { x: 250, y: 400 } },
  },
  {
    label: 'Polygon Tool',
    toolName: 'shape',
    slug: 'polygon',
    rect: { from: { x: 300, y: 260 }, to: { x: 510, y: 400 } },
  },
];

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

/**
 * The three helpers below — `canvasBox`, `documentClip`, `sampleDocumentPoint` — are
 * deliberately local rather than added to `e2e/helpers/`: nothing in the shared module
 * changes, so no existing spec's behaviour can move underneath a commit that is only
 * adding coverage. `filter-tools.spec.ts` carries byte-identical copies; if one of them is
 * promoted into the shared module, all three go together, because two same-named helpers
 * that differ by a sampling radius is the trap this comment exists to prevent.
 */
async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so the gesture cannot be placed');
  return box;
}

/** A page clip over a rectangle named in DOCUMENT coordinates, with a margin in document units. */
function documentClip(box: BoundingBox, rect: Rect, margin = 20): Required<ClipOptions> {
  const topLeft = documentToCanvasOffset(
    box,
    Math.min(rect.from.x, rect.to.x) - margin,
    Math.min(rect.from.y, rect.to.y) - margin
  );
  const bottomRight = documentToCanvasOffset(
    box,
    Math.max(rect.from.x, rect.to.x) + margin,
    Math.max(rect.from.y, rect.to.y) + margin
  );
  return {
    x: box.x + topLeft.x,
    y: box.y + topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * Samples a DOCUMENT point from a 17 CSS-pixel clip, mapping its center into the actual
 * device-scale screenshot. The box is re-measured per sample because the toolbar changes its
 * height; the inverse mapping verifies the selected capture pixel still names the requested
 * document point within one device pixel.
 */
async function sampleDocumentPoint(
  page: Page,
  documentX: number,
  documentY: number
): Promise<{ red: number; green: number; blue: number } | null> {
  const box = await canvasBox(page);
  const offset = documentToCanvasOffset(box, documentX, documentY);
  const half = 8;
  const documentPointOnPage = { x: box.x + offset.x, y: box.y + offset.y };
  const clip = {
    x: documentPointOnPage.x - half,
    y: documentPointOnPage.y - half,
    width: half * 2 + 1,
    height: half * 2 + 1,
  };
  const screenshot = await page.screenshot({
    clip,
  });
  const image = await loadImageData(screenshot);
  const deviceScale = await page.evaluate(() => window.devicePixelRatio || 1);
  const capturePoint = documentPointToCapturePixel(box, clip, image, { x: documentX, y: documentY }, deviceScale);
  return getColorAtPoint(image, capturePoint.x, capturePoint.y, SAMPLE_RADIUS);
}

async function toolOverlayHasInk(page: Page): Promise<boolean> {
  return page.getByTestId('tool-overlay-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    if (canvas.width === 0 || canvas.height === 0) return false;
    const sample = document.createElement('canvas');
    sample.width = canvas.width;
    sample.height = canvas.height;
    const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) return true;
    sampleCtx.drawImage(canvas, 0, 0);
    const pixels = sampleCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) return true;
    }
    return false;
  });
}

type CaptureImage = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
type EdgeProfilePoint = { x: number; y: number; scaleX: number; scaleY: number };

const MAX_EDGE_PROFILE_MAE = 4;

// The 5 CSS-pixel band suppresses isolated AA differences; the test's blur control must exceed this limit.
/** Average edge luminance across a 5 CSS-pixel band, over a 10 CSS-pixel profile. */
function edgeLuminanceProfile(image: CaptureImage, center: EdgeProfilePoint): number[] {
  const xRadius = Math.max(1, Math.round(2.5 * center.scaleX));
  const yRadius = Math.max(1, Math.round(5 * center.scaleY));
  const left = Math.max(0, center.x - xRadius);
  const right = Math.min(image.width - 1, center.x + xRadius);
  const top = Math.max(0, center.y - yRadius);
  const bottom = Math.min(image.height - 1, center.y + yRadius);
  const profile: number[] = [];

  for (let y = top; y <= bottom; y += 1) {
    let luminance = 0;
    let count = 0;
    for (let x = left; x <= right; x += 1) {
      const index = (y * image.width + x) * 4;
      const alpha = image.data[index + 3]! / 255;
      const red = image.data[index]! * alpha + 255 * (1 - alpha);
      const green = image.data[index + 1]! * alpha + 255 * (1 - alpha);
      const blue = image.data[index + 2]! * alpha + 255 * (1 - alpha);
      luminance += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      count += 1;
    }
    profile.push(luminance / count);
  }
  return profile;
}

function meanProfileDifference(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.POSITIVE_INFINITY;
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]!), 0) / left.length;
}

function boxBlurProfile(profile: readonly number[], radius: number): number[] {
  return profile.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(profile.length - 1, index + radius);
    let sum = 0;
    for (let sample = start; sample <= end; sample += 1) sum += profile[sample]!;
    return sum / (end - start + 1);
  });
}

function documentPointToCapturePixel(
  box: BoundingBox,
  clip: Required<ClipOptions>,
  image: CaptureImage,
  documentPoint: Point,
  deviceScale: number
): EdgeProfilePoint {
  const offset = documentToCanvasOffset(box, documentPoint.x, documentPoint.y);
  const pagePoint = { x: box.x + offset.x, y: box.y + offset.y };
  const scaleX = image.width / clip.width;
  const scaleY = image.height / clip.height;
  if (Math.abs(scaleX - deviceScale) > 0.03 || Math.abs(scaleY - deviceScale) > 0.03) {
    throw new Error(`Screenshot scale ${scaleX},${scaleY} does not match the browser's ${deviceScale}x device scale`);
  }
  const x = Math.round((pagePoint.x - clip.x) * scaleX);
  const y = Math.round((pagePoint.y - clip.y) * scaleY);
  if (x < 0 || x >= image.width || y < 0 || y >= image.height || scaleX <= 0 || scaleY <= 0) {
    throw new Error('The document point does not map into its screenshot capture');
  }

  const sampleCenterOnPage = {
    x: clip.x + (x + 0.5) / scaleX,
    y: clip.y + (y + 0.5) / scaleY,
  };
  const mappedDocumentPoint = canvasOffsetToDocument(box, sampleCenterOnPage.x - box.x, sampleCenterOnPage.y - box.y);
  const nextXDocumentPoint = canvasOffsetToDocument(
    box,
    sampleCenterOnPage.x - box.x + 1 / deviceScale,
    sampleCenterOnPage.y - box.y
  );
  const nextYDocumentPoint = canvasOffsetToDocument(
    box,
    sampleCenterOnPage.x - box.x,
    sampleCenterOnPage.y - box.y + 1 / deviceScale
  );
  const pixelResolutionX = Math.abs(nextXDocumentPoint.x - mappedDocumentPoint.x);
  const pixelResolutionY = Math.abs(nextYDocumentPoint.y - mappedDocumentPoint.y);
  if (
    Math.abs(mappedDocumentPoint.x - documentPoint.x) > pixelResolutionX + 1e-6 ||
    Math.abs(mappedDocumentPoint.y - documentPoint.y) > pixelResolutionY + 1e-6
  ) {
    throw new Error(
      `Capture pixel ${x},${y} maps to ${mappedDocumentPoint.x},${mappedDocumentPoint.y}, not ${documentPoint.x},${documentPoint.y}; one-pixel tolerance ${pixelResolutionX},${pixelResolutionY}`
    );
  }

  return { x, y, scaleX, scaleY };
}

/** A drag given in document coordinates, performed at the box's own contain scale. */
async function dragAcrossDocument(page: Page, from: Point, to: Point): Promise<void> {
  const box = await canvasBox(page);
  const start = documentToCanvasOffset(box, from.x, from.y);
  const end = documentToCanvasOffset(box, to.x, to.y);
  await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: 10 });
}

/** Drags a shape, then waits for its own clip to hold something the background does not. */
async function dragShape(page: Page, rect: Rect, name: string): Promise<void> {
  await dragAcrossDocument(page, rect.from, rect.to);
  await waitForCanvasPixels(page, documentClip(await canvasBox(page), rect), hasPaintedPixel, { description: name });
}

/**
 * Every member of the shape group is named `shape` in the mapping and told apart by its
 * FIGURE, so the flyout item's testid carries `shape` and the slug of the label — not the
 * figure. `selectFromFlyout` is given both because it needs the internal name for the id.
 */
async function selectShape(page: Page, label: string): Promise<void> {
  await openToolFlyout(page, 'shape');
  await selectFromFlyout(page, { toolName: 'shape', label });
}

const thickness = (page: Page) => page.locator('#thickness-slider');
const filledToggle = (page: Page) => page.locator('#filled-toggle');
const dashToggle = (page: Page) => page.locator('#dash-toggle');

/** The measured dark bounds of one shape, from a clip that holds only that shape. */
async function measureShape(page: Page, rect: Rect, name: string): Promise<{ width: number; height: number }> {
  const clip = documentClip(await canvasBox(page), rect);
  await waitForCanvasPixels(page, clip, hasPaintedPixel, { description: name });
  const bounds = await getDarkPixelBounds(await page.screenshot({ clip }));
  expect(bounds, `${name} has to leave something on the canvas`).not.toBeNull();
  return { width: bounds!.width, height: bounds!.height };
}

/** Selects a member of the Shape flyout. */
async function selectFigure(page: Page, figure: { label: string; toolName: string }): Promise<void> {
  await openToolFlyout(page, 'shape');
  await selectFromFlyout(page, { toolName: figure.toolName, label: figure.label });
}

const toolMode = (page: Page) => page.getByRole('combobox', { name: 'Tool mode' });
const cornerRadius = (page: Page) => page.locator('#corner-radius-slider');

/**
 * Captures the toolbar thumbnail separately from the document. The matching names put both
 * images beside each other in the Playwright report, making it possible to compare the preview
 * a user was shown with the figure that their drag actually committed.
 */
async function captureShapeThumbnail(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
  const thumbnail = page.getByRole('region', { name: 'shape tool options' }).locator('canvas');
  await expect(thumbnail, 'the Shape options bar exposes its drawing thumbnail').toBeVisible();
  const box = await thumbnail.boundingBox();
  if (!box) throw new Error('The Shape options thumbnail has no box');
  const screenshot = await page.screenshot({ clip: box });
  await testInfo.attach(`${name}-toolbar-preview`, { body: screenshot, contentType: 'image/png' });
  return screenshot;
}

test.describe('Shape tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await selectShape(page, 'Rectangle Tool');
    // The foreground is the stroke, and it is set after the tool is active: the shape bar
    // mirrors the store's colour into the tool args, so the order is what puts it there.
    await setForegroundColor(page, STROKE_BLACK, true);
  });

  test('the drawn rectangle keeps the drag aspect ratio, and Shift constrains it to a square', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    // The drags are 300x140 and 300x300 in DOCUMENT units, and the contain fit is not
    // square, so a screen-space ratio would not survive the scale. The two shapes sit apart
    // so each clip holds exactly one of them.
    const plain: Rect = { from: { x: 40, y: 40 }, to: { x: 340, y: 180 } };
    const constrained: Rect = { from: { x: 430, y: 40 }, to: { x: 730, y: 180 } };
    // The constrained shape is measured over a region that holds its whole possible extent.
    // Shift keeps the drag's quadrant and snaps the LONGER axis, so a 300x140 drag becomes a
    // 300x300 square hanging BELOW the drag — clipping to the drag's own rect would cut its
    // bottom two thirds off and measure a shape that is not the one on the canvas.
    const constrainedExtent: Rect = { from: { x: 410, y: 20 }, to: { x: 750, y: 360 } };

    await dragShape(page, plain, 'the unconstrained rectangle');
    const drawn = await measureShape(page, plain, 'the unconstrained rectangle');
    expect(
      drawn.width / drawn.height,
      `expected about 2.14, measured ${drawn.width}x${drawn.height} in capture pixels`
    ).toBeGreaterThan(1.9);
    expect(drawn.width / drawn.height).toBeLessThan(2.35);

    // Shift is read on the RELEASE event, so it has to still be held at pointerup.
    await page.keyboard.down('Shift');
    await dragShape(page, constrained, 'the Shift-constrained rectangle');
    await page.keyboard.up('Shift');
    const squared = await measureShape(page, constrainedExtent, 'the Shift-constrained rectangle');
    expect(
      Math.abs(squared.width - squared.height) / Math.max(squared.width, squared.height),
      `a Shift-constrained rectangle must be a square, measured ${squared.width}x${squared.height}`
    ).toBeLessThan(0.08);
  });

  test.describe('Retina backing store', () => {
    test.use({ deviceScaleFactor: 2 });

    test('the committed shape preserves the live preview edge quality', async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const rect: Rect = { from: { x: 90, y: 100 }, to: { x: 290, y: 250 } };
      const edgePoint = { x: (rect.from.x + rect.to.x) / 2, y: rect.from.y };
      const outsidePoint = { x: edgePoint.x, y: rect.from.y - 16 };
      const deviceScale = await page.evaluate(() => window.devicePixelRatio || 1);
      const box = await canvasBox(page);
      const start = documentToCanvasOffset(box, rect.from.x, rect.from.y);
      const end = documentToCanvasOffset(box, rect.to.x, rect.to.y);
      const clip = documentClip(box, rect, 32);
      const layerRows = page.getByTestId('layer-row');
      const historyRows = page.getByTitle('Click to go back to this state');
      const startingLayerCount = await layerRows.count();
      const startingHistoryCount = await historyRows.count();

      await page.mouse.move(box.x + start.x, box.y + start.y);
      await page.mouse.down();
      await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 8 });
      await waitForCanvasPixels(page, clip, hasPaintedPixel, { description: 'the live vector preview' });
      await expect.poll(() => toolOverlayHasInk(page)).toBe(true);
      const previewScreenshot = await page.screenshot({ clip });
      const preview = await loadImageData(previewScreenshot);

      await page.mouse.up();
      await expect(layerRows, 'the committed shape adds a layer row').toHaveCount(startingLayerCount + 1);
      await expect(historyRows, 'the committed shape adds a history state').toHaveCount(startingHistoryCount + 1);
      await expect
        .poll(() => toolOverlayHasInk(page), {
          message: 'the whole Shape preview overlay is cleared after commit',
        })
        .toBe(false);

      const edgeColor = await sampleDocumentPoint(page, edgePoint.x, edgePoint.y);
      const outsideColor = await sampleDocumentPoint(page, outsidePoint.x, outsidePoint.y);
      expect(edgeColor, 'the expected top edge is painted in the committed document').not.toBeNull();
      expect(Math.min(edgeColor!.red, edgeColor!.green, edgeColor!.blue)).toBeLessThan(250);
      expect(outsideColor, 'the point outside the expected rectangle remains background').not.toBeNull();
      expect(Math.min(outsideColor!.red, outsideColor!.green, outsideColor!.blue)).toBeGreaterThan(250);

      const committedScreenshot = await page.screenshot({ clip });
      const committed = await loadImageData(committedScreenshot);

      expect([committed.width, committed.height]).toEqual([preview.width, preview.height]);
      const previewBounds = await getDarkPixelBounds(previewScreenshot);
      const committedBounds = await getDarkPixelBounds(committedScreenshot);
      expect(previewBounds, 'the live preview has measurable rectangle edges').not.toBeNull();
      expect(committedBounds, 'the committed shape has measurable rectangle edges').not.toBeNull();
      const previewEdges = {
        left: previewBounds!.left,
        top: previewBounds!.top,
        right: previewBounds!.right,
        bottom: previewBounds!.bottom,
      };
      const committedEdges = {
        left: committedBounds!.left,
        top: committedBounds!.top,
        right: committedBounds!.right,
        bottom: committedBounds!.bottom,
      };
      const maxEdgeDisplacement = Math.max(
        Math.abs(previewEdges.left - committedEdges.left),
        Math.abs(previewEdges.top - committedEdges.top),
        Math.abs(previewEdges.right - committedEdges.right),
        Math.abs(previewEdges.bottom - committedEdges.bottom)
      );
      expect(
        maxEdgeDisplacement,
        'sparse antialias rounding is allowed, but displaced edges are not'
      ).toBeLessThanOrEqual(1);

      const previewEdgePoint = documentPointToCapturePixel(box, clip, preview, edgePoint, deviceScale);
      const committedEdgePoint = documentPointToCapturePixel(box, clip, committed, edgePoint, deviceScale);
      const previewProfile = edgeLuminanceProfile(preview, previewEdgePoint);
      const committedProfile = edgeLuminanceProfile(committed, committedEdgePoint);
      const edgeProfileMae = meanProfileDifference(previewProfile, committedProfile);
      expect(
        edgeProfileMae,
        'the top-edge luminance profile should allow sparse antialias rounding but reject visible softness'
      ).toBeLessThanOrEqual(MAX_EDGE_PROFILE_MAE);

      const oneCssPixelBlurRadius = Math.max(1, Math.round(previewEdgePoint.scaleY));
      const blurSensitivity = meanProfileDifference(
        previewProfile,
        boxBlurProfile(previewProfile, oneCssPixelBlurRadius)
      );
      expect(blurSensitivity, 'the edge-profile tolerance must reject a one-CSS-pixel blur').toBeGreaterThan(
        MAX_EDGE_PROFILE_MAE
      );
    });
  });

  test('a thicker tip lays down a proportionally thicker band', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectShape(page, 'Line Tool');
    const thin: Rect = { from: { x: 40, y: 120 }, to: { x: 340, y: 120 } };
    const wide: Rect = { from: { x: 40, y: 420 }, to: { x: 340, y: 420 } };

    await thickness(page).fill(THIN_THICKNESS);
    await dragShape(page, thin, 'the thin line');
    const thinBounds = await measureShape(page, thin, 'the thin line');

    await thickness(page).fill(WIDE_THICKNESS);
    await dragShape(page, wide, 'the wide line');
    const wideBounds = await measureShape(page, wide, 'the wide line');

    expect(
      wideBounds.height,
      `a ${WIDE_THICKNESS}px tip measures ${wideBounds.height} against the ${THIN_THICKNESS}px tip's ${thinBounds.height}`
    ).toBeGreaterThan(thinBounds.height * WIDE_TO_THIN_MIN_RATIO);
  });

  test('the Dash toggle turns a solid line into segments', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectShape(page, 'Line Tool');
    const solid: Rect = { from: { x: 40, y: 120 }, to: { x: 340, y: 120 } };
    const dashed: Rect = { from: { x: 40, y: 420 }, to: { x: 340, y: 420 } };

    await dragShape(page, solid, 'the solid line');
    const solidClip = documentClip(await canvasBox(page), solid, 10);
    // The clip is the region the capture was taken over, so the classifier can measure the
    // capture's scale from it. `page.screenshot` defaults to `scale: 'device'`, which is 2x
    // on a HiDPI host, and a threshold authored in CSS pixels would otherwise be compared
    // against twice as many columns.
    const solidAnalysis = await getStrokeAnalysis(await page.screenshot({ clip: solidClip }), solidClip);
    expect(solidAnalysis, 'the solid line has to be analysable').not.toBeNull();
    expect(solidAnalysis!.type, 'an undashed line is one segment').toBe('solid');
    expect(solidAnalysis!.segments).toBe(1);

    await dashToggle(page).check();
    await expect(dashToggle(page)).toBeChecked();
    await dragShape(page, dashed, 'the dashed line');
    const dashedClip = documentClip(await canvasBox(page), dashed, 10);
    const dashedAnalysis = await getStrokeAnalysis(await page.screenshot({ clip: dashedClip }), dashedClip);
    expect(dashedAnalysis, 'the dashed line has to be analysable').not.toBeNull();
    // The dash and gap seed at 10/10, so a 300-unit drag is around fifteen marks.
    expect(dashedAnalysis!.type, 'the gaps are what make it dashed').toBe('dashed');
    expect(dashedAnalysis!.segments, 'a dashed line is many segments').toBeGreaterThan(2);
  });

  test('the Filled checkbox paints the interior, and leaving it alone does not', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    // A filled shape paints with the BACKGROUND colour, so the interior is only observable
    // once the background is something other than the white the canvas already is.
    await page.getByTestId('background-color-input').fill(BLUE);
    await expect(page.getByTestId('background-color-input')).toHaveValue(BLUE);

    const hollow: Rect = { from: { x: 40, y: 60 }, to: { x: 340, y: 300 } };
    const filled: Rect = { from: { x: 430, y: 60 }, to: { x: 730, y: 300 } };
    const centreOf = (rect: Rect): Point => ({
      x: (rect.from.x + rect.to.x) / 2,
      y: (rect.from.y + rect.to.y) / 2,
    });

    await dragShape(page, hollow, 'the outlined rectangle');
    const interior = await sampleDocumentPoint(page, centreOf(hollow).x, centreOf(hollow).y);
    expect(interior, 'the interior has to be reachable to be sampled').toBeTruthy();
    expect(
      interior!.red,
      `an unfilled shape leaves its interior alone, read ${JSON.stringify(interior)}`
    ).toBeGreaterThan(240);

    await filledToggle(page).check();
    await expect(filledToggle(page)).toBeChecked();
    await dragShape(page, filled, 'the filled rectangle');
    const centre = centreOf(filled);
    await expect
      .poll(
        async () => {
          const sample = await sampleDocumentPoint(page, centre.x, centre.y);
          return sample ? sample.blue : 0;
        },
        { message: 'the background colour has to reach the interior of the shape' }
      )
      .toBeGreaterThan(200);
    const painted = await sampleDocumentPoint(page, centre.x, centre.y);
    expect(painted!.red, 'a blue interior is not red').toBeLessThan(80);
  });

  test('an oval is inscribed in its drag, so the drag corner is outside the shape', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    // Both figures are drawn from the SAME shape of drag, so the only thing deciding whether
    // the corner is painted is what the geometry does with it: a rectangle's corner sits on
    // its own stroke, an oval's corner is outside the curve. They are drawn in different
    // places because each shape is a layer of its own and the earlier one would still be
    // under the later one at the very point being compared.
    const rectangle: Rect = { from: { x: 40, y: 100 }, to: { x: 340, y: 340 } };
    const oval: Rect = { from: { x: 440, y: 100 }, to: { x: 740, y: 340 } };
    // A 20px stroke is 10 document units across, so a sample 5 units in from the corner sits
    // well inside it. At the 5px seed a 5x5 sample window straddles the stroke's outer edge
    // and averages the corner against the background it is supposed to be contrasted with.
    await thickness(page).fill('20');
    const cornerOf = (rect: Rect): Point => ({ x: rect.from.x + 5, y: rect.from.y + 5 });

    await dragShape(page, rectangle, 'the rectangle');
    const corner = await sampleDocumentPoint(page, cornerOf(rectangle).x, cornerOf(rectangle).y);
    expect(corner, 'the corner has to be reachable to be sampled').toBeTruthy();
    expect(corner!.red, `a rectangle's corner is on its own stroke, read ${JSON.stringify(corner)}`).toBeLessThan(120);

    await selectShape(page, 'Ellipse Tool');
    await dragShape(page, oval, 'the oval');
    const ovalCorner = await sampleDocumentPoint(page, cornerOf(oval).x, cornerOf(oval).y);
    expect(ovalCorner, 'the corner has to be reachable to be sampled').toBeTruthy();
    expect(
      ovalCorner!.red,
      `an oval's corner is outside the curve, read ${JSON.stringify(ovalCorner)}`
    ).toBeGreaterThan(240);
  });

  test('the Star tool selects from the flyout, shows Star Ratio control, and draws a star', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectShape(page, 'Star Tool');

    // Verify Star Ratio / Indent control is present
    const starRatioSlider = page.locator('#star-ratio-slider');
    await expect(starRatioSlider).toBeVisible();
    await expect(starRatioSlider).toHaveAttribute('aria-label', 'Star Ratio');
    // Default value is 50%
    await expect(starRatioSlider).toHaveValue('50');

    // Change the Star Ratio and verify it updates
    await starRatioSlider.fill('75');
    await expect(starRatioSlider).toHaveValue('75');

    // Draw a star
    const star: Rect = { from: { x: 40, y: 40 }, to: { x: 340, y: 300 } };
    await dragShape(page, star, 'the star');

    // Measure the drawn star - it should have visible pixels
    const bounds = await measureShape(page, star, 'the star');
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  test('Rectangle Path mode thumbnail matches its rounded unfilled result', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const before = await captureShapeThumbnail(page, testInfo, 'shape-rectangle-default');

    await toolMode(page).selectOption('path');
    await cornerRadius(page).fill('54');
    await thickness(page).fill('20');
    await filledToggle(page).check();
    await page.locator('#alpha-slider').fill('0.5');
    await expect(toolMode(page)).toHaveValue('path');
    await expect(cornerRadius(page)).toHaveValue('54');
    await expect(filledToggle(page)).toBeChecked();
    await expect(page.locator('#alpha-slider')).toHaveValue('0.5');

    const configured = await captureShapeThumbnail(page, testInfo, 'shape-rectangle-path-rounded');
    expect(configured, 'changing the Shape settings must redraw the toolbar thumbnail').not.toEqual(before);

    const rectangle: Rect = { from: { x: 40, y: 80 }, to: { x: 340, y: 280 } };
    await dragShape(page, rectangle, 'the rounded Path-mode rectangle');
    const canvas = await canvasBox(page);
    await captureCanvasScreenshot(
      page,
      canvas,
      testInfo,
      'shape-rectangle-path-rounded-document',
      documentClip(canvas, rectangle)
    );

    const roundedCorner = await sampleDocumentPoint(page, 45, 85);
    const topStroke = await sampleDocumentPoint(page, 190, 85);
    const interior = await sampleDocumentPoint(page, 190, 180);
    expect(roundedCorner, 'the rounded corner is reachable').toBeTruthy();
    expect(topStroke, 'the top stroke is reachable').toBeTruthy();
    expect(interior, 'the rectangle interior is reachable').toBeTruthy();
    expect(
      roundedCorner!.red,
      'a 54px radius leaves the drag-box corner substantially lighter than the top stroke'
    ).toBeGreaterThan(topStroke!.red + 40);
    expect(interior!.red, 'Path mode suppresses the fill, just as the thumbnail shows').toBeGreaterThan(220);
  });

  test('all figures preview during one held drag and remain after release', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    for (const figure of FIGURES) {
      // Each gesture starts with one pointerdown and ends with one pointerup. The capture
      // between them proves the user can see the figure before deciding where to release.
      await selectFigure(page, figure);
      await captureShapeThumbnail(page, testInfo, `shape-${figure.slug}`);
      const box = await canvasBox(page);
      const clip = documentClip(box, figure.rect, 12);
      const baseline = await page.screenshot({ clip });
      const start = documentToCanvasOffset(box, figure.rect.from.x, figure.rect.from.y);
      const end = documentToCanvasOffset(box, figure.rect.to.x, figure.rect.to.y);

      await page.mouse.move(box.x + start.x, box.y + start.y);
      await page.mouse.down();
      await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 10 });

      await expect
        .poll(() => regionChanged(page, clip, baseline), { message: `${figure.label} is visible before pointerup` })
        .toBe(true);
      await captureCanvasScreenshot(page, box, testInfo, `shape-${figure.slug}-preview`, clip);

      await page.mouse.up();
      await expect
        .poll(() => regionChanged(page, clip, baseline), { message: `${figure.label} remains visible after pointerup` })
        .toBe(true);
      await captureCanvasScreenshot(page, box, testInfo, `shape-${figure.slug}-committed`, clip);
    }
  });
});

/**
 * Whether a region changed at all, as a byte-for-byte screenshot comparison against a
 * baseline captured earlier.
 *
 * This replaced an absolute "is anything dark here" predicate, which cannot work in this app:
 * the theme defaults to dark (`b6a15214`), so an empty workspace is already near-black, and a
 * black stroke on a white document is not the only way to be dark. A difference needs no
 * knowledge of the palette, the theme, the document's contents or the stroke padding
 * `shapeGeometryBounds` adds — it only needs the two moments to differ or not.
 *
 * Both moments must be captured with the dialog CLOSED, because the open dialog paints a
 * `bg-black bg-opacity-25` backdrop over the whole viewport and dims every pixel under it.
 */
const regionChanged = async (page: Page, clip: Required<ClipOptions>, baseline: Buffer): Promise<boolean> =>
  !(await page.screenshot({ clip })).equals(baseline);

/**
 * A bare click on the canvas, which Adobe answers with the `Create <Figure>` dialog rather
 * than a drag: "Click on the canvas to bring up the Create Rectangle dialog"
 * (https://helpx.adobe.com/photoshop/using/modify-shapes.html).
 *
 * These live in their own `describe` with their own `beforeEach` because the bare click
 * REPLACES the drag: the rect helpers above wait for painted pixels, and there are none until
 * the dialog is answered.
 */
test.describe('Shape click dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await selectShape(page, 'Rectangle Tool');
    await setForegroundColor(page, STROKE_BLACK, true);
    await thickness(page).fill('20');
  });

  /** A press and release at one point, which is what makes the gesture a click. */
  async function clickDocument(page: Page, at: Point): Promise<void> {
    const box = await canvasBox(page);
    const offset = documentToCanvasOffset(box, at.x, at.y);
    await page.mouse.move(box.x + offset.x, box.y + offset.y);
    await page.mouse.down();
    await page.mouse.up();
  }

  const dialog = (page: Page) => page.getByTestId('create-shape-dialog');

  test('a click opens the Create Rectangle dialog and commits nothing until it is answered', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const box = await canvasBox(page);
    // The region the dialog's default 100x100 will land in, off the click point.
    const region = documentClip(box, { from: { x: 40, y: 40 }, to: { x: 140, y: 140 } }, 0);
    const baseline = await page.screenshot({ clip: region });

    await clickDocument(page, { x: 40, y: 40 });

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: 'Create Rectangle' })).toBeVisible();

    // Closed again before the comparison, because the open dialog's backdrop dims the whole
    // viewport and every pixel under it — the assertion would then be measuring the backdrop.
    await dialog(page).getByTestId('create-shape-dialog-cancel-button').click();
    await expect(dialog(page)).toHaveCount(0);

    expect(await regionChanged(page, region, baseline)).toBe(false);
  });

  test('the dialog draws a shape of the size it is given, at the clicked point', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const box = await canvasBox(page);
    const origin: Point = { x: 40, y: 40 };
    const extent: Rect = { from: origin, to: { x: 240, y: 190 } };
    const region = documentClip(box, extent, 20);
    const baseline = await page.screenshot({ clip: region });

    await clickDocument(page, origin);
    await dialog(page).getByTestId('create-shape-width-input').fill('200');
    await dialog(page).getByTestId('create-shape-height-input').fill('150');
    await dialog(page).getByTestId('create-shape-dialog-submit-button').click();

    await expect(dialog(page)).toHaveCount(0);
    expect(
      await regionChanged(page, region, baseline),
      'the committed shape has to have painted into the clicked region'
    ).toBe(true);
  });

  test('cancelling the dialog commits nothing at all', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const box = await canvasBox(page);
    const region = documentClip(box, { from: { x: 40, y: 40 }, to: { x: 140, y: 140 } }, 0);
    const baseline = await page.screenshot({ clip: region });

    await clickDocument(page, { x: 40, y: 40 });
    await dialog(page).getByTestId('create-shape-dialog-cancel-button').click();

    await expect(dialog(page)).toHaveCount(0);
    expect(await regionChanged(page, region, baseline)).toBe(false);
  });

  test('Escape closes the dialog and commits nothing', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const box = await canvasBox(page);
    const region = documentClip(box, { from: { x: 40, y: 40 }, to: { x: 140, y: 140 } }, 0);
    const baseline = await page.screenshot({ clip: region });

    await clickDocument(page, { x: 40, y: 40 });
    await dialog(page).getByTestId('create-shape-width-input').press('Escape');

    await expect(dialog(page)).toHaveCount(0);
    expect(await regionChanged(page, region, baseline)).toBe(false);
  });

  // The Line is the documented exception: Adobe names drag-and-release only, and never a
  // Create Line dialog (https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html).
  // The refusal reaches the console on purpose, which is what the ACCEPTED_CONSOLE_ERRORS
  // entry for it exists to declare.
  test('the Line tool opens no dialog on a click, because Adobe documents none', async ({ page }) => {
    await selectShape(page, 'Line Tool');
    await clickDocument(page, { x: 40, y: 40 });

    await expect(dialog(page)).toHaveCount(0);
  });

  test('a native browser dialog never opens on the click route', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    // Registered with `once` and asserted as absent rather than auto-dismissed: a stray
    // `prompt()` silently absorbed by Playwright is exactly the defect this pins, and this
    // file's own comment on the export helpers records why `once` beats `on` here.
    let nativeDialog = false;
    page.once('dialog', async (d) => {
      nativeDialog = true;
      await d.dismiss().catch(() => undefined);
    });

    await clickDocument(page, { x: 40, y: 40 });
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByTestId('create-shape-dialog-submit-button').click();
    await expect(dialog(page)).toHaveCount(0);

    expect(nativeDialog, 'a window.prompt or window.alert fired on the click route').toBe(false);
  });
});
