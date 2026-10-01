import { expect, type Page, test } from './fixtures/extended-test';
import { type BoundingBox, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

/**
 * End-to-end coverage for the Single Row Marquee and the Single Column Marquee.
 *
 * WHAT IS ASSERTED, AND AGAINST WHAT
 *   The committed band is read from `tool-overlay-canvas` with `getImageData`, not from a
 *   screenshot, for the reason `e2e/selection-gestures.spec.ts:199` gives and
 *   `e2e/selection-marching-ants.spec.ts:55`: `Main.tsx:150` sizes that canvas to the DOCUMENT
 *   (`resizeCanvas(toolOverlayRef.current, width, height)`), so one backing-store pixel IS one
 *   document pixel and every number below is already in the space `singleRowMarqueeRect` and
 *   `singleColumnMarqueeRect` work in. A screenshot would have to be re-scaled back through the
 *   contain fit to say the same thing, and would composite whatever the document painted under.
 *
 *   The band is painted by `drawSelectionOutline` onto that canvas, which strokes the closed
 *   path with `OUTLINE_LINE_WIDTH` (2, `src/util/selection.ts:23`) DIVIDED by the contain scale
 *   (`selection.ts:181`) so the chrome keeps a constant thickness on screen at any zoom. The
 *   stroke is CENTRED on the path, so it overhangs the band by half a stroke on each side, and
 *   the band's two edges are 1 document pixel apart — close enough that their two strokes
 *   OVERLAP rather than stacking. The painted extent is therefore
 *
 *     band thickness  +  ONE stroke width,   not  +  two
 *
 *   which is what `thicknessOf` divides back out. That stroke is a known constant, not a fudge
 *   factor, and dividing it out is what makes a 40x40 box fail rather than pass: it would
 *   measure about 40, while the band measures about 1.
 *
 *   The stroke is also DASHED — `OUTLINE_DASH_LENGTH` 6 on, `OUTLINE_DASH_GAP` 4 off
 *   (`selection.ts:24-25`), divided by the same scale — so the band is not painted in every
 *   pixel of its span. `SPAN_COVERAGE_FLOOR` is derived from that duty cycle rather than
 *   asserted at a round number, and the span is primarily read from the band's two extreme
 *   cross-axis positions, which the dashes cannot move.
 *
 * WHY THE SCAN IS A WINDOW AND NOT THE WHOLE CANVAS
 *   `drawSelectionOutline` also paints a white anchor disc at every vertex
 *   (`selection.ts:198-209`), radius `SELECTION_ANCHOR_RADIUS` = 5. On a 1-pixel band the four
 *   vertices are 1 document pixel apart, so the anchors swallow the band: measured across the
 *   whole canvas they report a thickness of about 13, not 3.
 *
 *   The anchors are at the two vertical edges and the two horizontal ones, so excluding a
 *   10-pixel frame from the canvas removes all four and leaves only the band's own stroke. Ten
 *   pixels is derived, not chosen: the anchor reaches `SELECTION_ANCHOR_RADIUS + lineWidth/2`
 *   = 5 + 1/scale ≈ 6.2 document px in, so 10 clears it at any scale this suite measures, and
 *   a 40-pixel band in the middle of an 800-pixel document could not reach either inner edge of
 *   the frame. What remains is measured twice, for both claims at once: the extent ALONG the
 *   window's short axis is the band's thickness, and the extent ACROSS its long axis is its
 *   span — and the span check runs at columns 10..12 and 787..789, which a band of any
 *   plausible box width fails.
 *
 * WHY THE COLOUR FILTER EXCLUDES THE FIRST ANCHOR'S BLUE
 *   One anchor is stroked `rgba(0,0,255,1)` (`selection.ts:202`) — blue with a ZERO green
 *   channel — while the outline is `rgba(0,123,255,0.95)`. The filter requires a green channel
 *   of 40..200, so the outline is measured and that anchor is not, without either depending on
 *   the other's radius.
 *
 * WHY NO DOCUMENT COORDINATE IS WRITTEN DOWN IN THIS FILE
 *   `usePointerPosition` publishes the scale and offsets it used as `data-fit-*`
 *   (`FIT_ATTRIBUTES`), and `getLocalCoords` divides the pointer by exactly those
 *   (`usePointerPosition.ts:229`). The press points here are built from that published fit, so
 *   they are page pixels computed the way the app computes them, and each one targets the
 *   CENTRE of a chosen document row or column — which is what makes the tool's `Math.floor`
 *   (`clampPixelIndex`, `src/tools/singleRowColumnMarquee.ts:66`) unambiguous. This is the
 *   warning at `e2e/selection-tools.spec.ts:33` resolved the only way it can be: the fit is
 *   read from the app rather than re-derived from a second copy of the contain arithmetic.
 */

const ROW = 'single-row-marquee';
const COLUMN = 'single-column-marquee';

/** `src/util/canvas.ts:3` sizes the overlay to the document, so its backing store is document px. */
const overlayCanvas = (page: Page) => page.getByTestId('tool-overlay-canvas');

/** `MARQUEE_THICKNESS_PX`, `src/tools/singleRowColumnMarquee.ts:14`. Document pixels. */
const BAND_THICKNESS_PX = 1;

/** `OUTLINE_LINE_WIDTH`, `src/util/selection.ts:23`. Divided by the contain scale when stroked. */
const OUTLINE_LINE_WIDTH = 2;

/**
 * Document pixels of anchor-free frame around the scan window.
 *
 * `SELECTION_ANCHOR_RADIUS` (5, `selection.ts:17`) plus half the stroke is ≈ 6.2 at the scale
 * this suite measures, so 10 clears all four vertex discs. See the header.
 */
const ANCHOR_CLEARANCE_PX = 10;

/**
 * One stroke width in document pixels, as `drawSelectionOutline` draws it.
 *
 * `selection.ts:181` computes `lineWidth = OUTLINE_LINE_WIDTH / scale`, so this is the stroke's
 * own extent in the same space as the pixels being measured. See the header for why the band
 * carries ONE of these rather than two.
 */
const strokeWidth = (scale: number) => OUTLINE_LINE_WIDTH / scale;

/**
 * How much of the band's span the dashes leave painted, as a fraction, with slack.
 *
 * `OUTLINE_DASH_LENGTH` 6 on to `OUTLINE_DASH_GAP` 4 off is a 0.6 duty cycle, so a fully
 * spanning band paints about 60% of its cross-axis positions and a band that stops short of an
 * edge cannot paint the rest. 0.5 is derived from that ratio rather than picked: it is below the
 * duty cycle, so it cannot fail on dash phase, and it is far above the fraction a band of any
 * plausible box width would cover — a 40-pixel band in the middle of an 800-pixel document
 * covers 5%, which is 25 times under this floor.
 */
const SPAN_COVERAGE_FLOOR = 0.5;

/**
 * Slack, in document pixels, between a stroke's measured extent and its nominal one.
 *
 * A canvas stroke is antialiased, so which pixels it owns is decided by a coverage fraction
 * rather than by an edge test, and `data-fit-scale` is itself a float. 1.5 absorbs both while
 * staying far below the thickness of any band this spec compares against.
 */
const STROKE_TOLERANCE_PX = 1.5;

/**
 * The hint sentence the shared bar spells with `row` or with `column`
 * (`SingleRowColumnMarquee.tsx:61`). Matched on the opening clause only: it is the part that
 * names the tool, and matching the whole sentence would make this locator break on any wording
 * change to a bar that has nothing to do with which tool is selected.
 */
const rowBar = (page: Page) => page.getByText('Click to select one row');
const columnBar = (page: Page) => page.getByText('Click to select one column');

/** The contain fit the app computed, as published on the element it measured. */
interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
  rectX: number;
  rectY: number;
  documentWidth: number;
  documentHeight: number;
}

async function readFit(page: Page): Promise<Fit> {
  const container = page.getByTestId('workspace-container');
  await expect(container, 'the element usePointerPosition measures the contain fit on').toHaveAttribute(
    'data-fit-scale',
    /.+/,
    { timeout: 5_000 }
  );
  const attributes = await container.evaluate((element) =>
    Object.fromEntries(
      [...element.attributes]
        .filter((attribute) => attribute.name.startsWith('data-fit-'))
        .map((attribute) => [attribute.name, attribute.value])
    )
  );
  const num = (key: string) => Number(attributes[`data-fit-${key}`]);

  return {
    scale: num('scale'),
    offsetX: num('offset-x'),
    offsetY: num('offset-y'),
    rectX: num('rect-x'),
    rectY: num('rect-y'),
    documentWidth: num('document-width'),
    documentHeight: num('document-height'),
  };
}

/** What one scan of the overlay found, in DOCUMENT pixels. */
interface BandRead {
  /** The band's own edges along its short axis: `top`/`bottom` for a row, `left`/`right` for a column. */
  start: number;
  end: number;
  /** The farthest the band's outline reaches along the cross axis, and how many columns carry it. */
  spanStart: number;
  spanEnd: number;
  spanPixels: number;
  /** The scan window, so a failure can name the region it was looking at. */
  window: { x: number; y: number; width: number; height: number };
}

function scanWindow(fit: Fit, axis: 'row' | 'column') {
  return axis === 'row'
    ? {
        axis,
        x: ANCHOR_CLEARANCE_PX,
        y: 0,
        width: Math.max(1, fit.documentWidth - ANCHOR_CLEARANCE_PX * 2),
        height: fit.documentHeight,
      }
    : {
        axis,
        x: 0,
        y: ANCHOR_CLEARANCE_PX,
        width: fit.documentWidth,
        height: Math.max(1, fit.documentHeight - ANCHOR_CLEARANCE_PX * 2),
      };
}

/**
 * One scan of the overlay, restricted to the anchor-free window.
 *
 * The cross axis is measured as a COUNT as well as a pair of extremes, so "the band reaches
 * this far" is corroborated by "the band is painted across this many columns", which a single
 * stray pixel pair could not fake.
 */
async function readBand(page: Page, fit: Fit, axis: 'row' | 'column'): Promise<BandRead | null> {
  const area = scanWindow(fit, axis);
  return overlayCanvas(page).evaluate((element, view) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('readBand: no [data-testid="tool-overlay-canvas"] on the page');
    }
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('the tool overlay canvas has no 2d context');
    const w = view.width;
    const h = view.height;
    if (view.x < 0 || view.y < 0 || view.x + w > element.width || view.y + h > element.height) {
      throw new Error(
        `readBand: the window ${JSON.stringify(view)} is outside the ${element.width}x${element.height} backing store`
      );
    }
    const { data } = ctx.getImageData(view.x, view.y, w, h);

    // `axis` says which way the band's THICKNESS runs: a row band is 1 pixel tall and spans
    // horizontally, a column band is 1 pixel wide and spans vertically.
    const acrossIsX = view.axis === 'row';
    const acrossCount = acrossIsX ? w : h;
    const thicknessCount = acrossIsX ? h : w;
    const alongExtent = new Int32Array(thicknessCount).fill(-1);
    const acrossSeen = new Uint8Array(acrossCount);
    let acrossPixels = 0;

    for (let a = 0; a < thicknessCount; a += 1) {
      for (let c = 0; c < acrossCount; c += 1) {
        const x = acrossIsX ? c : a;
        const y = acrossIsX ? a : c;
        const index = (y * w + x) * 4;
        // The overlay alone holds this backing store, so the outline's own
        // `rgba(0,123,255,0.95)` is what lands in the pixels; a white anchor disc is rejected by
        // both the green floor and the blue ceiling, and the blue-stroked anchor by the floor.
        if (
          data[index + 3] < 8 ||
          data[index] > 128 ||
          data[index + 1] < 40 ||
          data[index + 1] > 200 ||
          data[index + 2] < 150
        ) {
          continue;
        }
        alongExtent[a] += 1;
        if (!acrossSeen[c]) {
          acrossSeen[c] = 1;
          acrossPixels += 1;
        }
      }
    }

    let first = -1;
    let last = -1;
    for (let a = 0; a < thicknessCount; a += 1) {
      if (alongExtent[a] < 0) continue;
      if (first < 0) first = a;
      last = a;
    }
    if (first < 0) return null;

    let spanFirst = -1;
    let spanLast = -1;
    for (let c = 0; c < acrossCount; c += 1) {
      if (!acrossSeen[c]) continue;
      if (spanFirst < 0) spanFirst = c;
      spanLast = c;
    }

    const spanOrigin = acrossIsX ? view.x : view.y;
    const thicknessOrigin = acrossIsX ? view.y : view.x;

    return {
      start: thicknessOrigin + first,
      end: thicknessOrigin + last,
      spanStart: spanOrigin + spanFirst,
      spanEnd: spanOrigin + spanLast,
      spanPixels: acrossPixels,
      window: { x: view.x, y: view.y, width: w, height: h },
    };
  }, area);
}

/** Waits for the band's stroke to reach the overlay, then reads it once. */
async function committedBand(page: Page, fit: Fit, axis: 'row' | 'column'): Promise<BandRead> {
  await expect
    .poll(async () => (await readBand(page, fit, axis)) !== null, { message: 'the committed band outline' })
    .toBe(true);
  const read = await readBand(page, fit, axis);
  if (!read) throw new Error('committedBand: the band vanished between the poll and the read');

  return read;
}

/** Paints anywhere on the overlay at all, anchors included — the undo assertion needs all of it. */
async function anyOverlayPaint(page: Page): Promise<number> {
  return overlayCanvas(page).evaluate((element) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('anyOverlayPaint: no [data-testid="tool-overlay-canvas"] on the page');
    }
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('the tool overlay canvas has no 2d context');
    const { data } = ctx.getImageData(0, 0, element.width, element.height);
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) painted += 1;

    return painted;
  });
}

/** Picks one of the marquee group's non-primary tools out of the marquee tile's own flyout. */
async function selectMarquee(page: Page, toolName: string, label: string): Promise<void> {
  await openToolFlyout(page, 'rectangular-selection');
  await selectFromFlyout(page, { toolName, label });
}

/**
 * The canvas box, checked against the element the fit was computed on.
 *
 * `usePointerPosition` measures `workspace-container` (`Main.tsx:369`) and the gesture is
 * dispatched on the tool area filling that same container. `visual-regression.spec.ts` proves
 * the canvas element and the container coincide; this asserts it for this spec's own
 * measurements, because a silent divergence would place every press on a different pixel while
 * each individual assertion still passed.
 */
async function measure(page: Page): Promise<{ box: BoundingBox; fit: Fit }> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('the workspace canvas has no box');
  const container = await page.getByTestId('workspace-container').boundingBox();
  if (!container) throw new Error('the workspace container has no box');
  expect.soft({ x: container.x, y: container.y, width: container.width, height: container.height }).toEqual({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });

  return { box, fit: await readFit(page) };
}

/**
 * A page point at the CENTRE of document `index` on the given axis, and `across` as a fraction
 * of the other one.
 *
 * Built from the app's published fit, so it is a page pixel derived exactly the way the app
 * derives one, and it sits half a document pixel inside its row rather than on its boundary —
 * which is what makes the tool's floor unambiguous for a test that asserts an exact row.
 */
function pointOn(fit: Fit, axis: 'row' | 'column', index: number, across: number) {
  const documentWidth = fit.documentWidth;
  const documentHeight = fit.documentHeight;
  const half = 0.5;
  return {
    x: fit.rectX + fit.offsetX + (axis === 'column' ? index + half : across * documentWidth) * fit.scale,
    y: fit.rectY + fit.offsetY + (axis === 'row' ? index + half : across * documentHeight) * fit.scale,
  };
}

/** The document row/column a press at page `coordinate` floors to, per the app's own arithmetic. */
function documentAxisOf(fit: Fit, coordinate: number, axis: 'row' | 'column'): number {
  const offset = axis === 'row' ? fit.offsetY : fit.offsetX;
  const origin = axis === 'row' ? fit.rectY : fit.rectX;
  const index = Math.floor((coordinate - offset - origin) / fit.scale);
  const extent = axis === 'row' ? fit.documentHeight : fit.documentWidth;
  expect(index, `the press at page ${coordinate} should land inside the document`).toBeGreaterThanOrEqual(0);
  expect(index, `the press at page ${coordinate} should land inside the document`).toBeLessThanOrEqual(extent - 1);

  return index;
}

/**
 * The band's own thickness, with `drawSelectionOutline`'s stroke divided back out.
 *
 * Stated as one function so every test in this file asks the geometry the same way, and so the
 * "what a 40x40 box would measure" number in the failure message is computed rather than
 * asserted about.
 */
function thicknessOf(read: BandRead, scale: number) {
  return read.end - read.start + 1 - strokeWidth(scale);
}

const asFortyByForty = (scale: number) => 40 - strokeWidth(scale);

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();
}

test.describe('Single row and single column marquee', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  // 1. Reachable from the rail: the marquee tile's own flyout.
  //
  //    NOT `clickToolButton`, and the reason is a layout fact rather than a preference. That
  //    helper resolves a tool through a tile of its OWN name and, failing that, through the
  //    three-dots overflow (`toolbar-helpers.ts:189-217`). Neither route reaches a member of a
  //    group that still has a tile: the marquee group is the second of sixteen
  //    (`toolbar-mapping.ts:41`), the collapse is a SUFFIX, and at the suite's 1280x720 window
  //    the rail keeps the marquee tile as `tool-button-rectangular-selection` — so the two
  //    1-pixel tools have no tile of their own AND are not among the collapsed tools. The
  //    overflow branch then opens a flyout that does not contain them and fails on a locator
  //    for an element that is not the one that is missing.
  test('the single row marquee is selectable from the marquee flyout and commits a 1-pixel band', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expectToolSelected(page, ROW);
    // The bar's own sentence is per-tool: the two 1-pixel tools share one component
    // (`SingleRowColumnMarquee.tsx:33`) and differ only in this word, so it is what says which of
    // the two is up. The tile alone cannot — `SidebarLeft` lights a group tile for any member of
    // it, which `toolbar-helpers.ts:487` records.
    await expect(rowBar(page), 'the single row bar is on screen').toBeVisible();
    await expect(columnBar(page)).toHaveCount(0);

    const { fit } = await measure(page);
    const press = pointOn(fit, 'row', 252, 0.5);
    expect.soft(documentAxisOf(fit, press.y, 'row'), 'the press is built to land on its row').toBe(252);
    await page.mouse.click(press.x, press.y);

    const band = await committedBand(page, fit, 'row');
    const readBack = await readFit(page);
    expect.soft(readBack.scale, 'the fit must not have changed between the press and the read').toBe(fit.scale);

    // 2. Exactly 1 document pixel tall, with the outline's own stroke divided back out.
    const thickness = thicknessOf(band, fit.scale);
    expect
      .soft(
        Math.abs(thickness - BAND_THICKNESS_PX),
        `the band's own thickness is ${thickness.toFixed(2)} document px, against a required ${BAND_THICKNESS_PX} ` +
          `(a 40x40 box would measure ${asFortyByForty(fit.scale).toFixed(2)})`
      )
      .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);

    // 3. Spans the full document width. The scan's cross axis is the window's 780 columns, and
    //    the band's stroke is measured across all of them; a box of any plausible width stops
    //    hundreds of columns short of both inner edges.
    expect
      .soft(band.spanStart, 'a row band reaches the left of the document')
      .toBeLessThanOrEqual(scanWindow(fit, 'row').x + 3);
    expect
      .soft(band.spanEnd, 'a row band reaches the right of the document')
      .toBeGreaterThanOrEqual(scanWindow(fit, 'row').x + scanWindow(fit, 'row').width - 4);
    expect
      .soft(
        band.spanPixels / scanWindow(fit, 'row').width,
        'the dashes should paint most of the window, which a band stopping short of an edge cannot'
      )
      .toBeGreaterThan(SPAN_COVERAGE_FLOOR);

    // 4. On the row under the press. The stroke is centred on the band's top edge, so the
    //    painted top sits half a stroke above the row it belongs to.
    const halfStroke = OUTLINE_LINE_WIDTH / 2 / fit.scale;
    expect
      .soft(
        Math.abs(band.start - (252 - halfStroke)),
        `the band should be on row 252, and its painted top edge is ${band.start}`
      )
      .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);
  });

  test('the single column marquee is selectable from the marquee flyout and commits a 1-pixel band', async ({
    page,
  }) => {
    await selectMarquee(page, COLUMN, 'Single Column Marquee Tool');
    await expectToolSelected(page, COLUMN);
    await expect(columnBar(page), 'the single column bar is on screen').toBeVisible();
    await expect(rowBar(page)).toHaveCount(0);

    const { fit } = await measure(page);
    const press = pointOn(fit, 'column', 530, 0.5);
    expect.soft(documentAxisOf(fit, press.x, 'column'), 'the press is built to land on its column').toBe(530);
    await page.mouse.click(press.x, press.y);

    const band = await committedBand(page, fit, 'column');
    const thickness = thicknessOf(band, fit.scale);
    expect
      .soft(
        Math.abs(thickness - BAND_THICKNESS_PX),
        `the band's own thickness is ${thickness.toFixed(2)} document px, against a required ${BAND_THICKNESS_PX} ` +
          `(a 40x40 box would measure ${asFortyByForty(fit.scale).toFixed(2)})`
      )
      .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);

    const window = scanWindow(fit, 'column');
    expect.soft(band.spanStart, 'a column band reaches the top of the document').toBeLessThanOrEqual(window.y + 3);
    expect
      .soft(band.spanEnd, 'a column band reaches the bottom of the document')
      .toBeGreaterThanOrEqual(window.y + window.height - 4);
    expect
      .soft(band.spanPixels / window.height, 'the dashes should paint most of the window')
      .toBeGreaterThan(SPAN_COVERAGE_FLOOR);

    const halfStroke = OUTLINE_LINE_WIDTH / 2 / fit.scale;
    expect
      .soft(
        Math.abs(band.start - (530 - halfStroke)),
        `the band should be on column 530, and its painted left edge is ${band.start}`
      )
      .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);
  });

  // Shift+M walks the marquee group in its declared order (`AppKeyboardShortcuts.tsx:40`), and
  // each step is identified by a control unique to that tool's own options bar — the convention
  // `keyboard-shortcuts.spec.ts:162` follows, because the tile is group-level and cannot say
  // which member is up.
  test('M selects the rectangular marquee and Shift+M walks the group to the row and column bands', async ({
    page,
  }) => {
    await page.keyboard.press('m');
    await expect(
      page.getByText('Draw a rectangle and copy selected bitmap area.'),
      'M lands on the rectangular marquee'
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Style' })).toHaveCount(0);
    await expect(rowBar(page)).toHaveCount(0);
    await expect(columnBar(page)).toHaveCount(0);

    await page.keyboard.press('Shift+m');
    await expect(page.getByRole('combobox', { name: 'Style' }), 'rectangular -> elliptical').toBeVisible();

    await page.keyboard.press('Shift+m');
    await expect(
      page.getByRole('combobox', { name: 'Style' }),
      'the elliptical bar must be gone for the row bar'
    ).toHaveCount(0);
    await expect(rowBar(page), 'elliptical -> single row').toBeVisible();
    await expect(columnBar(page)).toHaveCount(0);

    await page.keyboard.press('Shift+m');
    await expect(rowBar(page), 'the row bar must be gone for the column bar').toHaveCount(0);
    await expect(columnBar(page), 'single row -> single column').toBeVisible();

    await page.keyboard.press('Shift+m');
    await expect(columnBar(page), 'the cycle wraps back to the group tile').toHaveCount(0);
    await expect(page.getByText('Draw a rectangle and copy selected bitmap area.'), 'the cycle wraps').toBeVisible();
  });

  test('the marquee flyout lists both 1-pixel tools by label', async ({ page }) => {
    await openToolFlyout(page, 'rectangular-selection');
    await expect(page.getByTestId(`tool-flyout-item-${ROW}-single-row-marquee-tool`)).toBeVisible();
    await expect(page.getByTestId(`tool-flyout-item-${COLUMN}-single-column-marquee-tool`)).toBeVisible();
    await selectFromFlyout(page, { toolName: ROW, label: 'Single Row Marquee Tool' });
    await expect(rowBar(page), 'the row tool was selected from the marquee flyout').toBeVisible();
  });

  // Two presses at clearly different rows must land on two different rows, by the delta the fit
  // predicts. Stated as a DELTA as well as an absolute, so it cannot be satisfied by a band
  // that is wrong in the same way twice, and each band is re-measured for thickness, so the
  // pair cannot pass as two 40-pixel boxes the right distance apart.
  test('two presses at different heights commit bands the expected document rows apart', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expect(rowBar(page)).toBeVisible();
    const { fit } = await measure(page);
    const upper = pointOn(fit, 'row', 120, 0.5);
    const lower = pointOn(fit, 'row', 420, 0.5);
    const expectedDelta = documentAxisOf(fit, lower.y, 'row') - documentAxisOf(fit, upper.y, 'row');
    expect.soft(expectedDelta, 'the two presses are 300 document rows apart by construction').toBe(300);

    await page.mouse.click(upper.x, upper.y);
    const first = await committedBand(page, fit, 'row');
    await page.mouse.click(lower.x, lower.y);
    const second = await committedBand(page, fit, 'row');
    const readBack = await readFit(page);
    expect.soft(readBack.scale, 'the fit must not have changed between the two presses').toBe(fit.scale);

    // The SECOND band is the one on screen, so the read of `first` is the reading that proves
    // the first press was not a no-op and the delta is between two real bands.
    const delta = second.start - first.start;
    expect
      .soft(
        Math.abs(delta - expectedDelta),
        `the two bands are ${delta} document px apart, and ${expectedDelta} is expected`
      )
      .toBeLessThanOrEqual(1);

    for (const [name, read, row] of [
      ['first', first, 120],
      ['second', second, 420],
    ] as const) {
      expect
        .soft(
          Math.abs(thicknessOf(read, fit.scale) - BAND_THICKNESS_PX),
          `the ${name} band is ${thicknessOf(read, fit.scale).toFixed(2)} document px thick`
        )
        .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);
      const halfStroke = OUTLINE_LINE_WIDTH / 2 / fit.scale;
      expect
        .soft(
          Math.abs(read.start - (row - halfStroke)),
          `the ${name} band should be on row ${row}, its top edge is ${read.start}`
        )
        .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);
    }
  });

  // The drag aims, and it commits on the RELEASE position — Adobe's own wording for the gesture
  // (`helpx.adobe.com/photoshop/using/selecting-marquee-tools.html`, cited at
  // `SingleRowColumnMarqueeToolArea.tsx:249`). A press-then-release at one point is the sibling
  // test above, so between them the two positions cannot be confused.
  test('a drag commits the band at the release position, not the press position', async ({ page }) => {
    await selectMarquee(page, COLUMN, 'Single Column Marquee Tool');
    await expect(columnBar(page)).toBeVisible();
    const { fit } = await measure(page);
    const press = pointOn(fit, 'column', 200, 0.5);
    const release = pointOn(fit, 'column', 600, 0.5);
    expect.soft(documentAxisOf(fit, press.x, 'column'), 'the press is built to land on its column').toBe(200);
    expect.soft(documentAxisOf(fit, release.x, 'column'), 'the release is built to land on its column').toBe(600);

    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 12 });
    await page.mouse.up();

    const band = await committedBand(page, fit, 'column');
    const halfStroke = OUTLINE_LINE_WIDTH / 2 / fit.scale;
    const releaseError = Math.abs(band.start - (600 - halfStroke));
    const pressError = Math.abs(band.start - (200 - halfStroke));
    expect
      .soft(
        thicknessOf(band, fit.scale),
        `a dragged band is ${thicknessOf(band, fit.scale).toFixed(2)} document px wide`
      )
      .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);
    expect
      .soft(releaseError, `the band sits at painted left edge ${band.start}, and the release column is 600`)
      .toBeLessThanOrEqual(STROKE_TOLERANCE_PX);
    // Its own assertion rather than a fold-in: this is what says the drag was AIMED at all, and
    // a band committed from the press would satisfy the line above only if the two columns were
    // close, which the 400-column separation above rules out.
    expect
      .soft(pressError, `the band must not be at the press column 200, which is ${pressError} px away`)
      .toBeGreaterThan(releaseError + 20);
  });

  // A history state, unlike the eyedropper — `e2e/erase-fill-eyedropper.spec.ts:674` pins the
  // inverse. The seeded document has exactly one entry at cursor 0, so undo is disabled until
  // something commits, and the baseline is asserted BEFORE the gesture so a failure after it
  // names the gesture rather than a precondition nobody checked.
  test('a band records one history state and one undo removes it', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expect(rowBar(page)).toBeVisible();
    const undo = page.getByTestId('undo-button');
    await expect(undo, 'a seeded document has nothing to undo').toBeDisabled();

    const { fit } = await measure(page);
    const press = pointOn(fit, 'row', 300, 0.5);
    await page.mouse.click(press.x, press.y);
    expect((await committedBand(page, fit, 'row')).start, 'the press should have committed a band').toBeGreaterThan(0);
    await expect(undo, 'the band is a history state, unlike the eyedropper').toBeEnabled();

    await undo.click();
    await expect
      .poll(async () => anyOverlayPaint(page), { message: 'every painted pixel of the band to be undone' })
      .toBe(0);
    // One click reverted the whole gesture and nothing is left: a second entry would still be on
    // the cursor, and a commit per pointer move would have left several. This is what makes
    // "one history state" mean one rather than at least one.
    await expect(undo, 'the band wrote exactly one history state').toBeDisabled();
  });
});

test.describe('The seeded document the geometry is read from', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  // The 800x600 default is the one number every geometry assertion above is scaled against, so it
  // is read from the app rather than trusted: a change to the seeded size would otherwise move
  // the target of "the full document span" without any test failing on it directly.
  test('the fit reports the seeded document size the geometry assertions assume', async ({ page }) => {
    const fit = await readFit(page);
    expect(fit.documentWidth).toBe(800);
    expect(fit.documentHeight).toBe(600);
    expect(fit.scale, 'a contain fit is never zero').toBeGreaterThan(0);
    expect
      .soft(
        { ...scanWindow(fit, 'row'), axis: undefined },
        'the row window must leave room for the anchors to be excluded'
      )
      .toEqual({ axis: undefined, x: 10, y: 0, width: 780, height: 600 });
  });
});
