import { expect, test, type Locator, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { committedAntsOutline, readAntRuns, waitForCommittedAnts, type AntWindow } from './helpers/selection-ants';
import type { CssBox, ImageSize, Point } from './helpers/screenshot-scale';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

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

/**
 * Where the drag tests press, and how far they take it, in document pixels.
 *
 * `POLYGON_INTERIOR` is inside the triangle `POLYGON_ANCHORS` describes and far from all three
 * vertices, which is what makes the press a MOVE rather than a reshape: `PolygonClickToolArea`
 * hit-tests anchors before the selection itself (`:684`), and the anchor grab radius is
 * `SELECTION_ANCHOR_HIT_RADIUS` (8) divided by the contain fit - about 8 document px here,
 * against 93px to the nearest vertex.
 *
 * A press OUTSIDE the committed selection would start a new lasso instead, since
 * `getSelectionAtPoint` (`:681`) is what decides, and the anchor-adding branches below it are
 * reached only once both hit tests miss. It is at least 46 document px inside the contour -
 * the top edge is 47 away and the slanted edges about 46 - so nothing about the press can be
 * read as a different gesture.
 */
const POLYGON_INTERIOR: Point = { x: 340, y: 227 };
const DRAG_DELTA: Point = { x: 30, y: 40 };

/** The band's width along an edge, in document pixels. Ten 12px dash cycles. */
const BAND_WIDTH_PX = 120;

/**
 * How far in from an edge's end a band starts, so the round line joins at a vertex cannot
 * decide what the band contains.
 */
const BAND_INSET_PX = 20;

/** Rows a band spans from the topmost painted row, so the whole `LINE_WIDTH` stroke is inside it. */
const BAND_HEIGHT_PX = 3;

// A band of the ants canvas straddling that top edge, inset 20px from either end so
// the dashes' round line joins at the vertices cannot decide what the band contains.
// Tight on purpose: the dash cycle is 12px, so a band much wider than that would
// average the pattern out and could look stable while the ants are moving.
const BORDER_BAND = { x: 280, y: 179, width: BAND_WIDTH_PX, height: BAND_HEIGHT_PX };

// Six reads spread over half a second, and the arithmetic is in FRAMES, because the
// crawl rate is `SPEED` CSS px per frame (`src/hooks/useAnts.ts:29`). Every quantity
// below is a FRACTION OF THE CYCLE rather than a distance, and that is what makes it the
// same number at every zoom: the offset advances `SPEED / scale` document px while the
// cycle is `(DASH_LENGTH + GAP_LENGTH) / scale` document px, so the ratio is
// `SPEED / (DASH_LENGTH + GAP_LENGTH)` = 0.4 / 12 = 1/30 of a cycle per frame, and one
// whole cycle is 30 frames - half a second at 60fps.
//
//   per interval  110ms ~= 6.6 frames ~= 0.22 cycles
//   whole window     5 intervals ~= 550ms ~= 33 frames ~= 1.10 cycles
//
// Two properties follow, and the constants are chosen for both. No two CONSECUTIVE samples
// are a whole number of cycles apart, so no two can share a phase; and the window spans
// 1.10 cycles rather than a whole number of them, so the last sample cannot repeat the
// first either.
//
// Why phase is visible in the bytes at all, since the contour has no gaps: the black pass
// at `offset` and the white pass at `offset + DASH_LENGTH` interleave into one continuous
// line, so the band's SHAPE does not depend on the phase - only the pixels where a black
// dash ends against a white one do, because those are the pixels the two passes
// antialias into each other. That is the whole of the signal, which is why the band is
// 120px (ten cycles) wide rather than a digest of something larger, and it is also why the
// assertion below is on raw fingerprints with `toBeGreaterThan(1)` and was not relaxed.
//
// This was re-derived rather than inherited because the rate halved. The previous pair
// (5 reads, 90ms) covered 4 intervals ~= 360ms ~= 21.6 frames: 21.6px of travel at the old
// 1 CSS px per frame, which is 1.8 cycles, and 8.6px - 0.72 cycles, under one whole cycle -
// at `SPEED` = 0.4. A window shorter than the pattern's own period is the thing to avoid
// here, so the count went up rather than the tolerance.
const SAMPLE_COUNT = 6;
const SAMPLE_INTERVAL_MS = 110;

/** The one distinct frame a static band must produce across every sample. */
const STATIC_FRAME_COUNT = 1;

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

/** A short, comparable form of a fingerprint, for assertion messages that must show one. */
function fingerprintHead(sample: BandSample): string {
  const bytes = sample.rgba.slice(0, 24).join(',');
  return `[${bytes},...] over ${sample.rgba.length / 4} pixels, ${sample.opaqueCount} painted`;
}

/**
 * Waits until the ants canvas has painted something inside `band`.
 *
 * This is the readiness gate every band-sampling test here needs, and it is also what makes
 * those samples mean anything: an empty band has exactly ONE fingerprint however long it is
 * read for, so a test that sampled an empty band would prove nothing while looking exactly as
 * green as one that sampled a live border. A band placed where the border is not - a wrong
 * guess at the geometry, or a border that never arrived - fails here by name instead.
 */
async function waitForBandToBePainted(page: Page, band: Band, description: string): Promise<void> {
  await expect
    .poll(async () => (await readAntsBand(page, band)).opaqueCount, {
      message: `The marching-ants border should cover ${description}`,
    })
    .toBeGreaterThan(0);
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
 *
 * It is NOT the contain-fit mapping in `e2e/helpers/selection-ants.ts`, and the difference
 * is load-bearing rather than stylistic. That helper maps a document-pixel bounding box onto
 * PAGE coordinates through the ants ELEMENT's own rect, which is what a caller comparing
 * against a drag endpoint or a clip rectangle needs; this one maps onto the coordinates the
 * POINTER is expressed in, which are the ones `getLocalCoords` reads back through
 * `usePointerPosition`'s own `containerRef`. Two different elements measured for two different
 * callers, so both mappings stay.
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

/** The same band, translated by a document-pixel delta. */
function translateBand(band: Band, delta: Point): Band {
  return { ...band, x: band.x + delta.x, y: band.y + delta.y };
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

/**
 * A band straddling the topmost edge the ants canvas is currently painting, found by reading
 * the ants back rather than by predicting where the tool that made them put it.
 *
 * Phase-independent, which is what makes it usable at all. `readAntRuns` reports runs of ant-
 * coloured pixels and the contour is gapless, so a run's EXTENT does not move when the dash
 * phase does - only the blend pixels where the black pass ends against the white pass are
 * excluded by its colour test, which shortens a run by at most a pixel or two at either end.
 * The topmost painted row and that row's overall horizontal extent are therefore properties of
 * the selection's geometry alone.
 *
 * It exists for the marquee test alone. Every other band here is computed from geometry the
 * test chose (`POLYGON_ANCHORS`), while a marquee's rectangle is `useRect`'s own to decide -
 * `adjustFreshPoint` at `useRect.ts:405`-`:420` derives it from `fromCentre` and
 * `constrainToSquare`, which `RectangularSelectionToolArea.tsx:74`-`:75` asks for. Restating
 * that rule would make this a second place to keep in step with the hook, over a detail of the
 * marquee rather than of the ants. Reading the rectangle off the canvas instead means a change
 * to the hook cannot turn this test red for the wrong reason - and the caller still gates on
 * `waitForBandToBePainted`, so a band placed where nothing was drawn fails loudly rather than
 * sampling an empty window.
 */
async function topEdgeBand(page: Page, geometry: DocumentGeometry): Promise<Band> {
  const window: AntWindow = { x: 0, y: 0, width: geometry.image.width, height: geometry.image.height };
  const rowRuns = await readAntRuns(page, window, 'row');

  const top = rowRuns.findIndex((runs) => runs.length > 0);
  if (top === -1) {
    throw new Error(`topEdgeBand: the ants canvas paints nothing in ${JSON.stringify(window)}`);
  }

  const spans = rowRuns[top];
  const left = Math.min(...spans.map(([from]) => from));
  const right = Math.max(...spans.map(([, to]) => to));
  const usable = right - left - BAND_INSET_PX;
  if (usable < BAND_WIDTH_PX) {
    throw new Error(
      `topEdgeBand: the topmost painted row ${window.y + top} spans only ${left}-${right}, ` +
        `too little for a ${BAND_INSET_PX}px inset and a ${BAND_WIDTH_PX}px band`
    );
  }

  // One row starting at the topmost painted row, so the whole `LINE_WIDTH` stroke is inside the
  // band - the same convention `BORDER_BAND` follows for its edge at y=180.
  return { x: left + BAND_INSET_PX, y: Math.max(0, window.y + top), width: BAND_WIDTH_PX, height: BAND_HEIGHT_PX };
}

test.describe('Selection Marching Ants', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  // the dash pattern advances
  test('moves the border of a committed polygon selection', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await selectPolygonalLassoTool(page);
    const geometry = await readDocumentGeometry(page);
    await commitPolygonSelection(page, geometry);

    // Every selection tool draws its committed border with these ants, on this canvas
    // (`SELECTION_INTERACTION_MODES` in `Main.tsx` names all seven modes, and
    // `drawSelectionOutline` is gone from `src/util/selection.ts`), so a non-empty band here is
    // both the readiness gate for the animation and the proof that it is drawing.
    await expect(getAntsCanvas(page)).toBeVisible();
    await waitForBandToBePainted(page, BORDER_BAND, 'part of the committed selection');

    const samples = await sampleAntsBandOverTime(page, BORDER_BAND);
    expect(
      new Set(samples.map(fingerprint)).size,
      'The marching-ants border did not move between samples'
    ).toBeGreaterThan(1);
  });

  // the control: the same read, repeated, must not move on its own
  test('reads identical pixels every time with no selection committed', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await selectPolygonalLassoTool(page);

    const samples = await sampleAntsBandOverTime(page, BORDER_BAND);
    for (const sample of samples) {
      expect(sample.opaqueCount, 'Nothing is committed, so the ants canvas should be empty').toBe(0);
    }
    expect(new Set(samples.map(fingerprint)).size, 'Reading the same band twice should not change it').toBe(
      STATIC_FRAME_COUNT
    );
  });

  // the marquee only recently got ants, and it is the sharpest case for it
  test('animates the border of a committed rectangular marquee selection', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await clickToolButton(page, 'rectangular-selection');
    const geometry = await readDocumentGeometry(page);

    // A diagonal drag of equal steps in both axes, so the committed rectangle is a square
    // whose top edge lands well inside the document whatever the contain fit is. It is 200
    // document px on a side so that the square `topEdgeBand` reads back is long enough for the
    // band whatever the hook does with the drag's centre.
    const press = documentPointToClient(geometry, { x: 250, y: 250 });
    const release = documentPointToClient(geometry, { x: 450, y: 450 });
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 8 });
    await page.mouse.up();

    await waitForCommittedAnts(page, 'a committed border after the marquee drag');
    const band = await topEdgeBand(page, geometry);

    // The canvas this reads is the ants canvas, one layer above the tool overlay. `useRect`
    // still strokes the marquee there but only while the gesture is in flight
    // (`borderMode: 'while-dragging'`, `RectangularSelectionToolArea.tsx:82`), so at rest this
    // border exists ONLY because the marquee's selection now has ants - which is the behaviour
    // change, and what an empty band here would mean.
    await waitForBandToBePainted(page, band, 'the top edge of the committed marquee');

    const samples = await sampleAntsBandOverTime(page, band);
    expect(
      new Set(samples.map(fingerprint)).size,
      `The marquee's marching-ants border did not move between samples (band ${JSON.stringify(band)})`
    ).toBeGreaterThan(1);
  });

  // the freeze: a drag stops the crawl, moves the border, and the crawl resumes on release
  test('holds the border still while a selection is dragged and resumes the crawl on release', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await selectPolygonalLassoTool(page);
    const geometry = await readDocumentGeometry(page);
    await commitPolygonSelection(page, geometry);
    await waitForBandToBePainted(page, BORDER_BAND, 'part of the committed selection');

    const outlineBefore = await committedAntsOutline(page);
    expect(outlineBefore, 'the committed selection should have a border to drag').not.toBeNull();

    const from = documentPointToClient(geometry, POLYGON_INTERIOR);
    const to = documentPointToClient(geometry, {
      x: POLYGON_INTERIOR.x + DRAG_DELTA.x,
      y: POLYGON_INTERIOR.y + DRAG_DELTA.y,
    });

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });

    // The band the border will occupy once the drag has moved it. The pre-drag edge is at y=180
    // and this one is at y=220, so a reading here cannot be the stale contour: the pre-drag edge
    // does not reach these rows at all, and the two slanted edges are 20px clear of the band's
    // x-range by the same inset `BORDER_BAND` uses.
    const draggedBand = translateBand(BORDER_BAND, DRAG_DELTA);
    await waitForBandToBePainted(page, draggedBand, 'the dragged selection');

    // CLAIM ONE, held: the border is stroked on every frame of the drag, and it does not
    // change. `useSelectionAnts.ts` paints first and only skips the offset advance
    // (`:191`, `if (!dragged)`), so "still there" and "not crawling" are two different readings
    // and this takes both.
    const heldSamples = await sampleAntsBandOverTime(page, draggedBand);
    for (const sample of heldSamples) {
      expect(
        sample.opaqueCount,
        'The border must still be painted on every frame of a drag, not merely frozen out of sight'
      ).toBeGreaterThan(0);
    }
    expect(
      new Set(heldSamples.map(fingerprint)).size,
      'The dashes crawled while the drag was held (first sample: ' + fingerprintHead(heldSamples[0]) + ')'
    ).toBe(STATIC_FRAME_COUNT);

    // CLAIM TWO, a separate one: the border MOVED with the pointer. Read in page coordinates,
    // which is what `committedAntsOutline` reports, and compared against the pointer's own page
    // delta - so the assertion is exact and does not have to know the contain fit: the ants are
    // drawn at the dragged geometry, so in page space the border shifts by precisely the
    // distance the pointer travelled.
    const outlineDuring = await committedAntsOutline(page);
    expect(outlineDuring, 'the ants canvas should still hold a border mid-drag').not.toBeNull();
    const moved = {
      x: outlineDuring!.left - outlineBefore!.left,
      y: outlineDuring!.top - outlineBefore!.top,
    };
    const pointerDelta = { x: to.x - from.x, y: to.y - from.y };
    expect(
      Math.abs(moved.x - pointerDelta.x),
      'the border did not follow the pointer horizontally'
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - pointerDelta.y), 'the border did not follow the pointer vertically').toBeLessThanOrEqual(
      1
    );

    await page.mouse.up();

    // CLAIM THREE, after the release: the crawl resumes on the phase it left. Same band, same
    // geometry - the release commits the dragged shape, so the band is not what changes here.
    await waitForBandToBePainted(page, draggedBand, 'the committed selection after the release');
    const releasedSamples = await sampleAntsBandOverTime(page, draggedBand);
    expect(
      new Set(releasedSamples.map(fingerprint)).size,
      'The dashes did not resume crawling after the drag ended (first sample: ' +
        fingerprintHead(releasedSamples[0]) +
        ')'
    ).toBeGreaterThan(1);
  });

  // the border exists, and leaving the selection tools stops the loop
  test('stops animating when a non-selection tool is selected', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await selectPolygonalLassoTool(page);
    const geometry = await readDocumentGeometry(page);
    await commitPolygonSelection(page, geometry);

    await waitForBandToBePainted(page, BORDER_BAND, 'part of the committed selection');

    // Brush, NOT `rectangular-selection`. The ants are now the committed border for every
    // selection tool - all seven modes in `SELECTION_INTERACTION_MODES`, nine tools - so the
    // rectangular marquee has ants of its own and switching to it leaves this test's premise
    // intact for the wrong reason. Only a tool outside that list makes "a non-selection tool has
    // no ants" the thing under test.
    await clickToolButton(page, 'brush');

    // A stopped loop clears the canvas rather than freezing it, so the band goes
    // back to empty and stays there. (`goToTool` also clears the active selection
    // on a tool switch, so this does not isolate the mode gate from the clear -
    // it pins the observable outcome of leaving the selection tools either way.)
    await expect
      .poll(async () => (await readAntsBand(page, BORDER_BAND)).opaqueCount, {
        message: 'The ants canvas should be cleared once the selection tools are left',
      })
      .toBe(0);

    const samples = await sampleAntsBandOverTime(page, BORDER_BAND);
    expect(new Set(samples.map(fingerprint)).size, 'The ants canvas should stop repainting').toBe(STATIC_FRAME_COUNT);
  });
});
