import { expect, test, type Locator, type Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import type { CssBox, ImageSize, Point } from './helpers/screenshot-scale';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

// The three anchors of the polygon every test in this file commits, in the ants
// canvas's own backing-store pixels. The canvas is sized to `totalSize`
// (`Main.tsx` `resizeCanvas`), so these are document pixels for the 800x600 blank
// image the app opens with, and the first two make the edge the band samples a
// horizontal 160px line at y=180.
const POLYGON_ANCHORS: Point[] = [
  { x: 260, y: 180 },
  { x: 420, y: 180 },
  { x: 340, y: 320 },
];

// A band of the ants canvas straddling that top edge, inset 20px from either end so
// the dashes' round line joins at the vertices cannot decide what the band contains.
// Tight on purpose: the dash cycle is 12px, so a band much wider than that would
// average the pattern out and could look stable while the ants are moving.
const BORDER_BAND = { x: 280, y: 179, width: 120, height: 3 };

// Five reads spread over most of a second. The dash offset advances one pixel per
// frame and the cycle is 12px, so consecutive reads land on different phases; the
// spread is wide enough that a stalled loop is a real failure rather than an
// unlucky phase.
const SAMPLE_COUNT = 5;
const SAMPLE_INTERVAL_MS = 90;

type Band = { x: number; y: number; width: number; height: number };

interface BandSample {
  /** RGBA bytes of the band, row-major: the whole sample, not a digest of it. */
  rgba: number[];
  /** Pixels in the band with a non-zero alpha, i.e. pixels the border painted. */
  opaqueCount: number;
}

/**
 * The ants canvas, by test id. `canvas-helpers.ts` publishes `getWorkspaceCanvas`
 * for the one canvas the existing specs address; the rule that helper documents -
 * a single-selector locator, never a document index - is why this repeats the
 * lookup rather than falling back to `page.locator('canvas').last()`.
 */
function getAntsCanvas(page: Page): Locator {
  return page.getByTestId('selection-ants-canvas');
}

/**
 * Reads a rectangle of the ants canvas with the canvas's own 2d context.
 *
 * A screenshot cannot express this: it would need a clip in page coordinates, a
 * device-pixel-ratio correction and a decode, none of which belong on a canvas
 * whose backing store is already in document pixels. `getImageData` reads those
 * pixels directly, and the canvas is `pointer-events-none` so it can never be the
 * target of a click.
 */
async function readAntsBand(page: Page, band: Band): Promise<BandSample> {
  return getAntsCanvas(page).evaluate((element, { x, y, width, height }) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('readAntsBand: no HTMLCanvasElement matched [data-testid="selection-ants-canvas"]');
    }
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('Selection ants canvas has no 2d context');

    const { data } = ctx.getImageData(x, y, width, height);
    let opaqueCount = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) opaqueCount += 1;
    }

    return { rgba: Array.from(data), opaqueCount };
  }, band);
}

/** Samples the same band repeatedly, so two samples can be compared byte for byte. */
async function sampleAntsBandOverTime(page: Page, band: Band): Promise<BandSample[]> {
  const samples: BandSample[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    if (index > 0) await page.waitForTimeout(SAMPLE_INTERVAL_MS);
    samples.push(await readAntsBand(page, band));
  }

  return samples;
}

function fingerprint(sample: BandSample): string {
  return sample.rgba.join(',');
}

interface DocumentGeometry {
  /** Bounding rect of the element the app measures pointer positions against. */
  container: CssBox;
  /** The ants canvas's backing store, which is the document's own size. */
  image: ImageSize;
}

/**
 * The contain mapping the app applies, inverted.
 *
 * `usePointerPosition` scales a pointer position into document pixels with
 * `scale = min(container / image)`, centres the image in the leftover space, and
 * divides the remainder out; this is the same rule the other way round, so a
 * click on a `POLYGON_ANCHORS` entry lands on that document pixel. The container
 * is the `<main>` element the store's `containerRef` points at - found by walking
 * up from the ants canvas rather than by indexing the document.
 */
async function readDocumentGeometry(page: Page): Promise<DocumentGeometry> {
  return getAntsCanvas(page).evaluate((element) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('readDocumentGeometry: no HTMLCanvasElement matched [data-testid="selection-ants-canvas"]');
    }
    const container = element.closest('main');
    if (!container) throw new Error('Selection ants canvas has no <main> container');

    const rect = container.getBoundingClientRect();
    return {
      container: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      image: { width: element.width, height: element.height },
    };
  });
}

function documentPointToClient({ container, image }: DocumentGeometry, point: Point): Point {
  if (image.width === 0 || image.height === 0) {
    throw new Error(`Cannot map a document point onto a ${image.width}x${image.height} image`);
  }

  const scale = Math.min(container.width / image.width, container.height / image.height);
  const offsetX = (container.width - image.width * scale) / 2;
  const offsetY = (container.height - image.height * scale) / 2;

  return { x: container.x + offsetX + point.x * scale, y: container.y + offsetY + point.y * scale };
}

/** Long-presses the lasso group and picks the polygonal lasso out of the flyout. */
async function selectPolygonalLassoTool(page: Page): Promise<void> {
  await openToolFlyout(page, 'freehand-lasso');
  await selectFromFlyout(page, { toolName: 'polygonal-lasso', label: 'Polygonal Lasso Tool' });
}

/**
 * Clicks the three anchors and closes the polygon with Enter.
 *
 * Enter is the one close route that cannot be confused with the click that placed
 * the anchor: clicking near the first anchor to close would also be a candidate
 * double click, and the anchors are 160px apart, so nothing else is close enough
 * to trigger one.
 */
async function commitPolygonSelection(page: Page, geometry: DocumentGeometry): Promise<void> {
  for (const anchor of POLYGON_ANCHORS) {
    const client = documentPointToClient(geometry, anchor);
    await page.mouse.click(client.x, client.y);
  }
  await page.keyboard.press('Enter');
}

test.describe('Selection Marching Ants', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  // the dash pattern advances
  test('moves the border of a committed polygon selection', async ({ page }) => {
    test.setTimeout(60_000);

    await selectPolygonalLassoTool(page);
    const geometry = await readDocumentGeometry(page);
    await commitPolygonSelection(page, geometry);

    // The border is on its own canvas and only in a polygon mode, so this is both
    // the readiness gate for the animation and the proof that it is drawing.
    await expect(getAntsCanvas(page)).toBeVisible();
    await expect
      .poll(async () => (await readAntsBand(page, BORDER_BAND)).opaqueCount, {
        message: 'The marching-ants border should cover part of the committed selection',
      })
      .toBeGreaterThan(0);

    const samples = await sampleAntsBandOverTime(page, BORDER_BAND);
    expect(
      new Set(samples.map(fingerprint)).size,
      'The marching-ants border did not move between samples'
    ).toBeGreaterThan(1);
  });

  // the control: the same read, repeated, must not move on its own
  test('reads identical pixels every time with no selection committed', async ({ page }) => {
    test.setTimeout(60_000);

    await selectPolygonalLassoTool(page);

    const samples = await sampleAntsBandOverTime(page, BORDER_BAND);
    for (const sample of samples) {
      expect(sample.opaqueCount, 'Nothing is committed, so the ants canvas should be empty').toBe(0);
    }
    expect(new Set(samples.map(fingerprint)).size, 'Reading the same band twice should not change it').toBe(1);
  });

  // the border exists, and leaving the polygon mode stops the loop
  test('stops animating when a non-polygon tool is selected', async ({ page }) => {
    test.setTimeout(60_000);

    await selectPolygonalLassoTool(page);
    const geometry = await readDocumentGeometry(page);
    await commitPolygonSelection(page, geometry);

    await expect
      .poll(async () => (await readAntsBand(page, BORDER_BAND)).opaqueCount, {
        message: 'The marching-ants border should cover part of the committed selection',
      })
      .toBeGreaterThan(0);

    await clickToolButton(page, 'rectangular-selection');

    // A stopped loop clears the canvas rather than freezing it, so the band goes
    // back to empty and stays there. (`goToTool` also clears the active selection
    // on a tool switch, so this does not isolate the mode gate from the clear -
    // it pins the observable outcome of leaving the polygon mode either way.)
    await expect
      .poll(async () => (await readAntsBand(page, BORDER_BAND)).opaqueCount, {
        message: 'The ants canvas should be cleared once the polygon mode is left',
      })
      .toBe(0);

    const samples = await sampleAntsBandOverTime(page, BORDER_BAND);
    expect(new Set(samples.map(fingerprint)).size, 'The ants canvas should stop repainting').toBe(1);
  });
});
