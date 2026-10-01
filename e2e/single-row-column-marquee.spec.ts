import { expect, test, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { getRedoButton, getUndoButton } from './helpers/history-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
import { clickToolButton, openToolFlyoutViaRightClick, selectFromFlyout } from './helpers/toolbar-helpers';

/**
 * Pixel-level tests for the two 1-pixel marquee tools.
 *
 * ## Where a committed band is read from
 *
 * The store holds a committed selection's geometry, but nothing publishes it: `grep` for
 * `data-` across `src/` turns up no selection attribute and no debug hook, and the app must
 * not grow one to be testable. Two canvases are painted from the store instead, and both
 * are read here off their OWN BACKING STORE through `getImageData`, exactly as
 * `selection-gestures.spec.ts`'s `committedAntsOutline` reads the ants canvas.
 *
 * - `tool-overlay-canvas` carries `drawSelectionOutline`, so it shows WHERE a committed band
 *   is and HOW BIG it is, with the 4 corner anchors (radius `max(5/scale, 3.5)`) and the
 *   2px dashed stroke painted outside the geometry. That chrome is why this file does NOT
 *   use it to measure size: a 1-document-pixel band paints roughly 9 canvas rows of blue.
 *   It IS used for presence (undo/redo) and for the row/column shape.
 * - `workspace-canvas` is the composited DOCUMENT. Nothing paints the selection into it, so
 *   `Cmd/Ctrl+J` ("layer via copy") is used to materialise the committed band as its own
 *   layer, whose `pos` is `canvasToDocumentPos(snapshot.pos, frame)` — the selection's rect,
 *   verbatim, with a bitmap of exactly `width x height` copied out of the document
 *   (`src/contexts/useSelectionClipboard.ts:89-108`). Hiding the drawn source band leaves
 *   that one layer as the only dark thing on the canvas, so its document-pixel bounds ARE
 *   the committed band's geometry. That is what `expectStrip` asserts, with no tolerance:
 *   `rect.height === 1` cannot come from a 2-pixel band, and `rect.top` cannot come from a
 *   band committed at the press row.
 *
 * Both stores are unscaled and undpi'd, so a `y` of 70 there is document row 70 — no fit
 * arithmetic, and no device-pixel-ratio correction. The published `data-fit-*` attributes
 * are used for the one direction that is unavoidably in CSS px, pointer input.
 *
 * ## The drawn band
 *
 * Every geometry test needs the row (or column) it selects to contain dark pixels, because
 * the band copied into a layer is a copy of the DOCUMENT there, and the document is white.
 * One 400px brush stroke across the full width at row 300 inks rows 100..500, so a click or
 * a drag anywhere in that range copies ink. It is hidden before each measurement; see
 * `commitBandAsLayer`.
 */

interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
  documentWidth: number;
  documentHeight: number;
  rectX: number;
  rectY: number;
}

interface DocRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FIT_ATTRIBUTES = {
  scale: 'data-fit-scale',
  offsetX: 'data-fit-offset-x',
  offsetY: 'data-fit-offset-y',
  documentWidth: 'data-fit-document-width',
  documentHeight: 'data-fit-document-height',
  rectX: 'data-fit-rect-x',
  rectY: 'data-fit-rect-y',
} as const;

/** The seeded blank document, `src/App.tsx:21-26`. Asserted so a resize is not read as a geometry change. */
const DOCUMENT_WIDTH = 800;
const DOCUMENT_HEIGHT = 600;

/**
 * The source band: one 400px stroke of the Draw tool, laid along the axis a test needs.
 *
 * A 400px brush centred on row 300 inks document rows 100..500 across the whole width; the
 * same brush run down column 400 inks columns 200..600 across the whole height. Every press
 * and release in this file is chosen inside that ink, so the band copied into a layer is dark
 * over its whole length — otherwise the copy would be white wherever the document was, and
 * the dark-pixel read would report the inked PART of the band rather than the band.
 */
const SOURCE_BRUSH = 400;
const ROW_BAND_ROW = 300;
const COLUMN_BAND_COLUMN = 400;

/** `STROKE_ANALYSIS.DARK_THRESHOLD` in `e2e/helpers/canvas-helpers.ts`, inlined for the in-page scan. */
const DARK_MAX = 60;

/** The app's selection colour, `rgba(0, 123, 255, ...)`, as thresholds for the in-page scan. */
const SELECTION_BLUE = { redMax: 80, greenMin: 80, blueMin: 180 };

const layerRows = (page: Page) => page.getByTestId('layer-row');
const historyRows = (page: Page) => page.getByTitle('Click to go back to this state');
const selectionHistoryRows = (page: Page) => historyRows(page).filter({ hasText: /^selection/ });
const drawnBandRow = (page: Page) => layerRows(page).filter({ hasText: /^draw \d+$/ });

async function readFit(page: Page): Promise<Fit> {
  const container = page.getByTestId('workspace-container');
  // The fit is published by the mounted tool area's mount effect, which React schedules rather
  // than runs inside the click, so reading once straight after is a race with the scheduler.
  // All nine land in one synchronous block, so the first to exist implies the rest do.
  await expect(container).toHaveAttribute(FIT_ATTRIBUTES.scale, /.+/);

  return container.evaluate((node, attributes) => {
    const read = (name: string): number => {
      const raw = node.getAttribute(name);
      if (raw === null) throw new Error(`the app published no ${name}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} is not a number: ${raw}`);
      return value;
    };
    return {
      scale: read(attributes.scale),
      offsetX: read(attributes.offsetX),
      offsetY: read(attributes.offsetY),
      documentWidth: read(attributes.documentWidth),
      documentHeight: read(attributes.documentHeight),
      rectX: read(attributes.rectX),
      rectY: read(attributes.rectY),
    };
  }, FIT_ATTRIBUTES);
}

/**
 * The client coordinate of a CANVAS point.
 *
 * `usePointerPosition.getLocalCoords` inverts this exactly —
 * `xCss = (clientX - offsetX - rect.x) / scale` — and every term here is the app's own
 * published number, so nothing about the contain fit is re-derived. `documentToCanvasOffset`
 * in `e2e/helpers/canvas-helpers.ts:75-84` computes the same mapping by re-running
 * `containFit` locally; this uses the app's values instead, which is why the assertions here
 * cannot pass on a stale fit.
 */
function clientForCanvasPoint(fit: Fit, x: number, y: number): { x: number; y: number } {
  return { x: fit.rectX + fit.offsetX + x * fit.scale, y: fit.rectY + fit.offsetY + y * fit.scale };
}

async function clickCanvasPoint(page: Page, fit: Fit, x: number, y: number): Promise<void> {
  const point = clientForCanvasPoint(fit, x, y);
  await page.mouse.click(point.x, point.y);
}

/** Press, move, release. The marquee commits from the POINTERUP event, so `to` is the release point. */
async function dragCanvasPoints(
  page: Page,
  fit: Fit,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  const start = clientForCanvasPoint(fit, from.x, from.y);
  const end = clientForCanvasPoint(fit, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** One brush stroke of the Draw tool along a canvas-space segment. */
async function drawBand(
  page: Page,
  fit: Fit,
  from: { x: number; y: number },
  to: { x: number; y: number },
  brush: number = SOURCE_BRUSH
): Promise<void> {
  await clickToolButton(page, 'draw');
  await page.locator('#size-slider').fill(String(brush));
  await dragCanvasPoints(page, fit, from, to);
}

/** The seeded 800x600 document, with a band of ink across document rows 100..500. */
async function openDocumentWithRowBand(page: Page): Promise<Fit> {
  const fit = await openDocument(page);
  await drawBand(page, fit, { x: 0, y: ROW_BAND_ROW }, { x: DOCUMENT_WIDTH, y: ROW_BAND_ROW });
  return fit;
}

/** The same document with a band down columns 200..600 instead, for the column tests. */
async function openDocumentWithColumnBand(page: Page): Promise<Fit> {
  const fit = await openDocument(page);
  await drawBand(page, fit, { x: COLUMN_BAND_COLUMN, y: 0 }, { x: COLUMN_BAND_COLUMN, y: DOCUMENT_HEIGHT });
  return fit;
}

async function selectMarqueeTool(page: Page, toolName: 'single-row-marquee' | 'single-column-marquee'): Promise<void> {
  await openToolFlyoutViaRightClick(page, 'rectangular-selection');
  await selectFromFlyout(page, {
    toolName,
    label: toolName === 'single-row-marquee' ? 'Single Row Marquee Tool' : 'Single Column Marquee Tool',
  });
}

async function openDocument(page: Page): Promise<Fit> {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  const fit = await readFit(page);
  expect({ width: fit.documentWidth, height: fit.documentHeight }, 'the seeded document is 800x600').toEqual({
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
  });

  return fit;
}

/** Document-pixel bounds of every non-transparent dark pixel on the composited document. */
async function readWorkspaceDarkRect(page: Page): Promise<DocRect | null> {
  return getWorkspaceCanvas(page).evaluate((element, darkMax) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('readWorkspaceDarkRect: [data-testid="workspace-canvas"] is not a canvas');
    }
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('readWorkspaceDarkRect: the workspace canvas has no 2d context');

    const { data, width } = ctx.getImageData(0, 0, element.width, element.height);
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let darkPixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) continue;
      if (data[index] >= darkMax || data[index + 1] >= darkMax || data[index + 2] >= darkMax) continue;
      const pixel = index / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      darkPixels += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }

    if (darkPixels === 0) return null;
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }, DARK_MAX);
}

/** Document-pixel bounds of the committed selection outline on the tool overlay. */
async function readOverlayBlueRect(page: Page): Promise<DocRect | null> {
  return page.getByTestId('tool-overlay-canvas').evaluate((element, thresholds) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('readOverlayBlueRect: [data-testid="tool-overlay-canvas"] is not a canvas');
    }
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('readOverlayBlueRect: the tool overlay has no 2d context');

    const { data, width } = ctx.getImageData(0, 0, element.width, element.height);
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let bluePixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) continue;
      const isSelectionBlue =
        data[index] <= thresholds.redMax &&
        data[index + 1] >= thresholds.greenMin &&
        data[index + 2] >= thresholds.blueMin;
      if (!isSelectionBlue) continue;
      const pixel = index / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      bluePixels += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }

    if (bluePixels === 0) return null;
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }, SELECTION_BLUE);
}

/**
 * Materialise the committed selection as its own layer and hide the band it was copied from,
 * so `readWorkspaceDarkRect` returns that layer's bounds and nothing else.
 *
 * `Cmd/Ctrl+J` is the app's own "layer via copy"
 * (`src/components/Common/AppKeyboardShortcuts.tsx:335-352` -> `useSelectionClipboard.ts:89`),
 * and it is the only route that puts a layer at the SELECTION's rect: `Paste` re-centres the
 * clipboard bitmap instead, which would throw away the very thing being asserted.
 */
async function commitBandAsLayer(page: Page): Promise<void> {
  const layersBefore = await layerRows(page).count();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(layerRows(page), 'Cmd/Ctrl+J pasted the committed band as a layer of its own').toHaveCount(
    layersBefore + 1
  );

  const sources = drawnBandRow(page);
  expect(
    await sources.count(),
    'the layer the band was copied out of is present, so nothing tells the copy from its source'
  ).toBeGreaterThan(0);
  for (const source of await sources.all()) {
    await source.getByRole('button', { name: 'Hide layer' }).click();
  }
}

/** Poll until the composited document carries dark pixels, then assert their bounds exactly. */
async function expectStrip(page: Page, expected: DocRect, description: string): Promise<void> {
  await expect
    .poll(async () => (await readWorkspaceDarkRect(page)) !== null, {
      message: `no dark pixels on the composited document: ${description}`,
      timeout: 10_000,
    })
    .toBe(true);

  expect(await readWorkspaceDarkRect(page), description).toEqual(expected);
}

test.describe('Single Row and Single Column Marquee', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
  });

  /**
   * REACHABILITY. The two tools are members of the Rectangular Marquee tile's flyout, so a
   * broken entry point is a silent absence: nothing else in this file would fail, because
   * every other test drives the tool through the same flyout and would report a missing item
   * rather than the missing tool.
   *
   * Broken by: dropping either entry from `toolbarMap`'s marquee group in
   * `toolbar-mapping.ts`, or pointing its flyout entry at a tool with no options bar.
   */
  test('the marquee flyout reaches the Single Row Marquee and its options bar says row', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await selectMarqueeTool(page, 'single-row-marquee');

    await expect(
      page.getByText('Click or drag to select one row, then copy the selected bitmap line.'),
      'the Single Row Marquee options bar is rendered'
    ).toBeVisible();
    await expect(
      page.getByText('Click or drag to select one column, then copy the selected bitmap line.'),
      "the Single Row Marquee's bar must not be the column sentence"
    ).toHaveCount(0);
  });

  /**
   * The transpose of the test above, and the only thing that proves the options bar READS
   * `toolName` rather than shipping one sentence for both tools.
   *
   * Broken by: a bar that renders the row sentence for every member of the group, which would
   * leave every geometry test in this file green because they drive the tools by name.
   */
  test('the marquee flyout reaches the Single Column Marquee and its options bar says column', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await selectMarqueeTool(page, 'single-column-marquee');

    await expect(
      page.getByText('Click or drag to select one column, then copy the selected bitmap line.'),
      'the Single Column Marquee options bar is rendered'
    ).toBeVisible();
    await expect(
      page.getByText('Click or drag to select one row, then copy the selected bitmap line.'),
      "the Single Column Marquee's bar must not be the row sentence"
    ).toHaveCount(0);
  });

  /**
   * A PRESS commits the band at the press row, one document pixel tall and as wide as the
   * whole document — the geometry `singleRowMarqueeRect` builds at
   * `src/tools/singleRowColumnMarquee.ts:78-82`.
   *
   * `height: 1` is the load-bearing half and cannot come from the chrome: the outline on the
   * tool overlay paints about 9 rows for a 1-pixel band, which is why the size is read off the
   * pasted LAYER instead. A band built from a press rect, from the drag rect, or clamped to
   * anything but one row would all report a different height.
   *
   * Broken by: `MARQUEE_THICKNESS_PX` changing, `clampPixelIndex` rounding or clamping
   * differently, or the rect losing its `x1: 0 / x2: imageSize.width` span.
   */
  test('a press commits a one-document-pixel band as wide as the document', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const fit = await openDocumentWithRowBand(page);
    await selectMarqueeTool(page, 'single-row-marquee');

    const pressedRow = 200;
    await clickCanvasPoint(page, fit, 400, pressedRow);
    await commitBandAsLayer(page);

    await expectStrip(
      page,
      { x: 0, y: pressedRow, width: DOCUMENT_WIDTH, height: 1 },
      'a press on row 200 commits exactly that row, one pixel tall and the full document wide'
    );
  });

  /**
   * A DRAG commits at the RELEASE row, not the press row. The two are 250 document rows
   * apart here, which is far outside anything the outline's own chrome could absorb.
   *
   * Broken by: `rectForDrag` reading the press axis instead of the release event's, or
   * `handlePointerUp` committing from a stale draft rect.
   */
  test('a drag commits the band at the release row, not the press row', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const fit = await openDocumentWithRowBand(page);
    await selectMarqueeTool(page, 'single-row-marquee');

    const pressRow = 200;
    const releaseRow = 450;
    await dragCanvasPoints(page, fit, { x: 400, y: pressRow }, { x: 400, y: releaseRow });
    await commitBandAsLayer(page);

    await expectStrip(
      page,
      { x: 0, y: releaseRow, width: DOCUMENT_WIDTH, height: 1 },
      `a drag from row ${pressRow} to row ${releaseRow} commits the RELEASE row`
    );
  });

  /**
   * ROW TOOL, HORIZONTAL DRAG. A drag that changes only X leaves the band on its press row,
   * because `pointerAxis` reads Y (`SingleRowColumnMarqueeToolArea.tsx:117-120`) and a row
   * band spans the whole document, so there is no X for it to move along.
   *
   * Broken by: an axis mix-up that reads X for the row tool — the band would become a COLUMN
   * at x=600, which reports `width: 1, height: 600` and fails on both counts.
   */
  test('a drag that changes only X leaves the row band on its press row', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const fit = await openDocumentWithRowBand(page);
    await selectMarqueeTool(page, 'single-row-marquee');

    const pressRow = 200;
    await dragCanvasPoints(page, fit, { x: 150, y: pressRow }, { x: 650, y: pressRow });
    await commitBandAsLayer(page);

    await expectStrip(
      page,
      { x: 0, y: pressRow, width: DOCUMENT_WIDTH, height: 1 },
      'a 500px horizontal drag leaves a full-width row band on its press row'
    );
  });

  /**
   * COLUMN TOOL, HORIZONTAL DRAG. The same gesture under the column tool DOES move the band,
   * to the release column, one document pixel wide and as tall as the document. Paired with
   * the test above, this is the pair that pins the axis to the tool rather than to the
   * gesture.
   *
   * Broken by: the column tool reading Y, or a shared axis helper that both tools call with
   * the wrong component. The band's `height: 600` also fails if the column tool kept the
   * row band it inherited from the Rectangular Marquee.
   */
  test('a drag that changes only X moves the column band to the release column', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const fit = await openDocumentWithColumnBand(page);
    await selectMarqueeTool(page, 'single-column-marquee');

    const releaseColumn = 550;
    await dragCanvasPoints(page, fit, { x: 300, y: 200 }, { x: releaseColumn, y: 200 });
    await commitBandAsLayer(page);

    await expectStrip(
      page,
      { x: releaseColumn, y: 0, width: 1, height: DOCUMENT_HEIGHT },
      'a 250px horizontal drag moves a column band to the release column, one pixel wide and the full document tall'
    );
  });

  /**
   * COLUMN TOOL, VERTICAL DRAG. The mirror of the row tool's horizontal-drag test: a gesture
   * that changes only Y must leave a column band where it was.
   *
   * Broken by: an axis mix-up that reads Y for the column tool — the band would become a ROW
   * at y=450, reporting `width: 800, height: 1`.
   */
  test('a drag that changes only Y leaves the column band on its press column', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const fit = await openDocumentWithColumnBand(page);
    await selectMarqueeTool(page, 'single-column-marquee');

    const pressColumn = 300;
    await dragCanvasPoints(page, fit, { x: pressColumn, y: 200 }, { x: pressColumn, y: 450 });
    await commitBandAsLayer(page);

    await expectStrip(
      page,
      { x: pressColumn, y: 0, width: 1, height: DOCUMENT_HEIGHT },
      'a 250px vertical drag leaves a column band on its press column'
    );
  });

  /**
   * A press INSIDE the committed band is a move, not a second selection, and it appends
   * exactly one history entry. The press is at row 200.5 because `isPressOnActiveBand`
   * (`SingleRowColumnMarqueeToolArea.tsx:179-188`) is a point-in-polygon test against the
   * band's four corners, and the band is one document pixel tall: 200.5 is the only row of
   * hits that is unambiguously inside it.
   *
   * The band is read at its NEW row, which is what "moved" means, and the history is counted
   * before and after, which is what "committed once" means. A create-on-press instead of a
   * move would report the same strip and the same count, so the count is what rules out the
   * DOUBLE commit: `handlePointerUp` appending a band and `commitSelection` appending another
   * gives two entries and fails here.
   *
   * Broken by: `isSingleRowOrColumnMarqueeRect` narrowing until no press is ever "inside",
   * or the move arm committing on pointerup as well as on pointermove.
   */
  test('a press inside the band moves it, and the move appends one history entry', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const fit = await openDocumentWithRowBand(page);
    await selectMarqueeTool(page, 'single-row-marquee');

    const pressRow = 200;
    await clickCanvasPoint(page, fit, 400, pressRow);
    await expect
      .poll(async () => (await readOverlayBlueRect(page)) !== null, {
        message: 'the press committed a band',
        timeout: 10_000,
      })
      .toBe(true);
    const entriesAfterPress = await selectionHistoryRows(page).count();
    expect(entriesAfterPress, 'the press committed exactly one selection entry').toBe(1);

    const movedToRow = pressRow + 60;
    await dragCanvasPoints(page, fit, { x: 400, y: pressRow + 0.5 }, { x: 400, y: movedToRow + 0.5 });
    await commitBandAsLayer(page);

    await expectStrip(
      page,
      { x: 0, y: movedToRow, width: DOCUMENT_WIDTH, height: 1 },
      `pressing inside the band and dragging to row ${movedToRow} MOVES the band there`
    );
    expect(await selectionHistoryRows(page).count(), 'the move appended exactly one selection entry, not two').toBe(
      entriesAfterPress + 1
    );
  });

  /**
   * THE REGRESSION CASE: a document whose frame origin is NOT (0, 0).
   *
   * `pointerAxis` converts the pointer into DOCUMENT space with `canvasToDocumentPoint`
   * (`SingleRowColumnMarqueeToolArea.tsx:117-120`) and `createCommittedRectangleSelection`
   * performs no conversion of its own, so the rect is already document space and must be
   * committed verbatim. Re-adding `documentFrame` in that rect converts twice and lands the
   * band one frame away from the press. The unit tests cannot see it because their fixture
   * pins `documentFrame: null` (`SingleRowColumnMarqueeToolArea.test.tsx`).
   *
   * A crop is what produces a non-zero origin: `applyDocumentCrop` builds the next frame with
   * `canvasRectToDocumentFrame` (`src/contexts/useLayer.ts:697-725`), which ADDS the crop
   * rect's canvas origin to the current frame. Cropping canvas (0, 50) to (400, 550) leaves
   * `documentFrame = { x: 0, y: 50, width: 400, height: 500 }` and a 400x500 document: an
   * origin non-zero on the axis the bug corrupts, with no horizontal offset to disentangle
   * from the copy path's own edge trim.
   *
   * TWO thin bands are inked before the crop, not one thick one. The crop window has to
   * contain white rows, or the shift below cannot be measured at all; and the second band is
   * exactly one frame lower than the first, which is where the BUG would commit. So the
   * failure is a band MISPLACED by one frame and still visible, with the expected value
   * naming the row — not a band that vanished into white and reported as no ink at all.
   *
   * The bands are also what proves the frame origin is non-zero: their measured extent before
   * the crop is compared against the extent after it, and the vertical edges differ by
   * exactly 50 rows, the crop's origin. A frame at the origin would not move them at all and
   * the bug would be invisible.
   *
   * Broken by: exactly the double conversion described above, and by nothing else this
   * document shape can reach. A band built in canvas space instead of document space would be
   * clamped to document row 0 and reported as a one-pixel strip at canvas row 0, which fails
   * the strip read too.
   */
  test('on a document cropped away from the canvas origin, a click commits the band under the pointer', async ({
    page,
  }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const cropOrigin = { x: 0, y: 50 };
    const cropSize = { width: 400, height: 500 };
    const inkBrush = 40;
    const clickedRowBeforeCrop = 250;
    const frameLowerRowBeforeCrop = 300;

    let fit = await openDocument(page);
    await drawBand(
      page,
      fit,
      { x: 0, y: clickedRowBeforeCrop },
      { x: DOCUMENT_WIDTH, y: clickedRowBeforeCrop },
      inkBrush
    );
    await drawBand(
      page,
      fit,
      { x: 0, y: frameLowerRowBeforeCrop },
      { x: DOCUMENT_WIDTH, y: frameLowerRowBeforeCrop },
      inkBrush
    );

    await expect
      .poll(async () => (await readWorkspaceDarkRect(page)) !== null, {
        message: 'both bands are on the document',
        timeout: 10_000,
      })
      .toBe(true);
    const inkBeforeCrop = (await readWorkspaceDarkRect(page)) as DocRect;

    await clickToolButton(page, 'crop');
    await dragCanvasPoints(page, fit, cropOrigin, {
      x: cropOrigin.x + cropSize.width,
      y: cropOrigin.y + cropSize.height,
    });
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    fit = await readFit(page);
    expect(
      { width: fit.documentWidth, height: fit.documentHeight },
      'the crop left a 400x500 document whose frame origin is no longer (0, 0)'
    ).toEqual({ width: cropSize.width, height: cropSize.height });

    await expectStrip(
      page,
      {
        x: 0,
        y: inkBeforeCrop.y - cropOrigin.y,
        width: cropSize.width,
        height: inkBeforeCrop.height,
      },
      'the bands sit 50 rows lower than they were drawn, so the frame origin is (0, 50)'
    );

    await selectMarqueeTool(page, 'single-row-marquee');
    const clickedRow = clickedRowBeforeCrop - cropOrigin.y;
    await clickCanvasPoint(page, fit, 100, clickedRow);
    await commitBandAsLayer(page);

    await expectStrip(
      page,
      { x: 0, y: clickedRow, width: cropSize.width, height: 1 },
      `a click on canvas row ${clickedRow} commits THAT row, not one frame below it`
    );
  });

  /**
   * UNDO/REDO over the real `commit: 'selection'` history path.
   *
   * The committed band is read off the tool overlay here rather than off a pasted layer,
   * because a layer copy would add its own history entry and make the two Undo presses mean
   * something else. Undo removes the outline; Redo puts the SAME band back, which is what
   * says the replay restored the geometry rather than merely some selection.
   *
   * Broken by: `resetHistoryTo` not restoring `selections`, or restoring them inactive, which
   * is the state `drawSelectionOutline` returns early on.
   */
  test('undo takes the committed band away and redo brings the same band back', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const fit = await openDocumentWithRowBand(page);
    await selectMarqueeTool(page, 'single-row-marquee');

    const pressedRow = 200;
    await clickCanvasPoint(page, fit, 400, pressedRow);
    await expect
      .poll(async () => (await readOverlayBlueRect(page)) !== null, {
        message: 'the press committed a band',
        timeout: 10_000,
      })
      .toBe(true);
    const committed = await readOverlayBlueRect(page);
    expect(committed, 'the committed band spans the document').not.toBeNull();
    expect(committed?.width, 'a row band spans the whole document width').toBeGreaterThan(DOCUMENT_WIDTH - 12);

    await getUndoButton(page).click();
    await expect
      .poll(async () => (await readOverlayBlueRect(page)) === null, {
        message: 'undo removed the committed band',
        timeout: 10_000,
      })
      .toBe(true);

    await getRedoButton(page).click();
    await expect
      .poll(async () => (await readOverlayBlueRect(page)) !== null, {
        message: 'redo restored the committed band',
        timeout: 10_000,
      })
      .toBe(true);
    expect(
      await readOverlayBlueRect(page),
      'redo restored the band where it was committed, not somewhere else'
    ).toEqual(committed);
  });
});
