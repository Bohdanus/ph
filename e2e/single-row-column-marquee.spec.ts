import { expect, type Page, test } from './fixtures/extended-test';
import { type BoundingBox, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { type AntRun, readAntRuns, waitForCommittedAnts } from './helpers/selection-ants';
import { expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

/**
 * End-to-end coverage for the Single Row Marquee and the Single Column Marquee.
 *
 * WHAT IS ASSERTED, AND AGAINST WHAT
 *   A committed band is drawn ONCE, on `selection-ants-canvas`, by `useSelectionMarchingAnts`
 *   (`src/hooks/useSelectionAnts.ts`). `Main.tsx:214` sizes that canvas to the DOCUMENT
 *   (`resizeCanvas(selectionAntsOverlayRef.current, width, height)`), so one backing-store pixel
 *   IS one document pixel and every number below is already in the space
 *   `singleRowMarqueeRect` / `singleColumnMarqueeRect` work in. The reads come from
 *   `e2e/helpers/selection-ants.ts`, which takes them out of `getImageData` rather than a
 *   screenshot for exactly that reason, and that file's header is the reference for what
 *   `readAntRuns` returns.
 *
 *   `tool-overlay-canvas` is no longer where a band can be found, and this spec does not look
 *   there for one. `drawSelectionOutline` is gone, and `SingleRowColumnMarqueeToolArea.tsx:70`
 *   paints `drawMarqueePreview` — the same blue, on the tool overlay — only while a NEW band is
 *   being aimed: `redrawOverlay` (`:191`) full-clears that canvas and repaints only the
 *   preview points it is handed, and `handlePointerUp` (`:400`) hands it none. So "blue on the
 *   tool overlay" now means "a marquee is in flight" and never "a band is committed".
 *
 * HOW A BAND'S EXTENT IS DERIVED FROM THE ANT STROKE
 *   The ants are ONE stroke, centred on the rect's edges, at `LINE_WIDTH`/scale document px
 *   (`useSelectionAnts.ts:149`-`:158`: `const lineWidth = LINE_WIDTH / scale`, then
 *   `setLineDash`), and it is stroked twice, black then white half a dash apart (`:172`-`:179`).
 *   `LINE_WIDTH` is 1 (`useAnts.ts:13`). So a rect whose edges are at `a` and `b` paints, on the
 *   scan-line axis, every line from
 *
 *     floor(a - lineWidth/2)   to   floor(b + lineWidth/2)
 *
 *   which is what `firstPaintedLine` / `lastPaintedLine` below compute and what every geometry
 *   assertion compares against. For a 1-document-pixel band at row 252 at this suite's fit
 *   (`data-fit-scale` 0.97167, so lineWidth/2 = 0.51459) that is scan lines 251..253: two
 *   antialiased fringes and the band's own row. A 40x40 rectangular marquee dragged on the same
 *   document at the same fit measures 42 painted scan lines and 42 painted columns, which is the
 *   comparison number the failure messages carry.
 *
 * WHY THE TWO EXTREMES AND NOT A COUNT
 *   The band's own row is painted by BOTH of the rect's horizontal edges, and the dash pattern
 *   runs along the whole closed path, so the two edges meet it at phases one edge-length apart.
 *   Where the two passes composite disagreeing colours the result is a mid grey, which is
 *   neither of the two the colour test accepts, and that row's coverage collapses. MEASURED, at
 *   this fit: the two fringe rows held 0.915-0.934 coverage throughout, while the band's own row
 *   ranged over 0.033-0.952 — and a column band released at column 600 painted scan lines
 *   {599, 601} on some frames and {599, 600, 601} on others. So the thin axis is asserted as the
 *   FIRST and LAST painted scan line, which are the ant stroke's own extremes and were stable in
 *   every one of those samples, never as how many lines carry paint.
 *
 * WHY THE CROSS AXIS IS READ ACROSS A WHOLE DASH CYCLE
 *   The closed path's two end caps paint the document's first and last column only where a dash
 *   lands on them, and a dash is `DASH_LENGTH`/scale = 6.18 document px long, so on any ONE
 *   frame the outermost column is a property of the dash phase rather than of the band. One ant
 *   cycle is `(DASH_LENGTH + GAP_LENGTH) / SPEED` = 30 frames whatever the scale, which is 500ms
 *   at 60fps and 1000ms at 30fps, so `committedAntsBand` unions the reads over `SPAN_SAMPLES` of
 *   `SPAN_SAMPLE_INTERVAL_MS` — 1.2s, at least one full cycle at either frame rate. The extremes
 *   are then the ones the ants sweep rather than the ones one frame happened to catch. MEASURED
 *   over roughly 280 single-frame reads of both orientations, the extremes were the document's
 *   own 0 and 799 (row band) and 0 and 599 (column band) in every one of them — except one read
 *   in one full run of this spec, which saw 1 where 0 was derived, and that is the whole reason
 *   this read is phase-complete: a single frame is not an instrument for a dashed line's ends.
 *
 * WHY THE FLOOR IS 0.5
 *   `SPAN_COVERAGE_FLOOR` is what says the span has no hole in the middle of it, and it is
 *   derived from the 6/6 duty cycle rather than the old 6/4 one: two 50% passes offset by half a
 *   cycle leave a line fully covered apart from the antialiased seam at each cycle boundary,
 *   where a black tapers off as a white tapers on and the composite is grey. It is measured
 *   against a SINGLE frame, which is where the phase matters: 0.648 at its worst over 70 frames
 *   of a full-span band and 0.933 at its best, against 0.0525 for a 40-pixel band in the middle
 *   of an 800-pixel document. Unioning a whole cycle's frames instead measures the band and the
 *   dashes, not the band.
 *
 * WHY NO DOCUMENT COORDINATE IS WRITTEN DOWN IN THIS FILE
 *   `usePointerPosition` publishes the scale and offsets it used as `data-fit-*`
 *   (`FIT_ATTRIBUTES`), and `getLocalCoords` divides the pointer by exactly those
 *   (`usePointerPosition.ts:229`). The press points here are built from that published fit, so
 *   they are page pixels computed the way the app computes them, and each one targets the
 *   CENTRE of a chosen document row or column — which is what makes the tool's `Math.floor`
 *   (`clampPixelIndex`, `src/tools/singleRowColumnMarquee.ts:85`) unambiguous. This is the
 *   warning at `e2e/selection-tools.spec.ts:33` resolved the only way it can be: the fit is
 *   read from the app rather than re-derived from a second copy of the contain arithmetic.
 */

const ROW = 'single-row-marquee';
const COLUMN = 'single-column-marquee';

/** `MARQUEE_THICKNESS_PX`, `src/tools/singleRowColumnMarquee.ts:14`. Document pixels. */
const BAND_THICKNESS_PX = 1;

/** `LINE_WIDTH`, `src/hooks/useAnts.ts:13`. CSS px, divided by the contain scale when stroked. */
const ANT_LINE_WIDTH = 1;

/** The centred ant stroke's own width, in document pixels. `useSelectionAnts.ts:150`. */
const antStrokeWidth = (scale: number) => ANT_LINE_WIDTH / scale;

/**
 * The first scan line a centred ant stroke of `edge` reaches, clamped to the canvas.
 *
 * `Math.floor`, not a round: the stroke's outer boundary is `edge - lineWidth/2` and a pixel
 * belongs to it when the stroke covers any of it, so the first such pixel is the floor.
 */
const firstPaintedLine = (edge: number, scale: number, extent: number) =>
  Math.min(Math.max(Math.floor(edge - antStrokeWidth(scale) / 2), 0), Math.max(0, extent - 1));

/** The last scan line the same stroke reaches. See `firstPaintedLine`. */
const lastPaintedLine = (edge: number, scale: number, extent: number) =>
  Math.min(Math.max(Math.floor(edge + antStrokeWidth(scale) / 2), 0), Math.max(0, extent - 1));

/**
 * How many scan lines a band of `thickness` document pixels paints at `start`.
 *
 * Computed rather than quoted, so the "a 40-pixel band would paint this many" half of every
 * thickness failure message is arithmetic on the same two helpers the assertion itself uses.
 */
const paintedLineCount = (start: number, thickness: number, scale: number, extent: number) =>
  lastPaintedLine(start + thickness, scale, extent) - firstPaintedLine(start, scale, extent) + 1;

/**
 * How much of the cross axis ONE frame's painted ants cover, as a fraction, over every scan
 * line that frame painted.
 *
 * MEASURED, at this suite's fit: 0.648 at its worst over 70 frames of a full-span band and
 * 0.933 at its best, against 0.0525 for a 40-pixel band in the middle of an 800-pixel document.
 * 0.5 is under the worst measured phase, so it cannot fail on where in the dash cycle a sample
 * lands, and it is nowhere near what a band stopping short of an edge would cover. See the
 * header for why it is read from one frame and the extremes are not.
 */
const SPAN_COVERAGE_FLOOR = 0.5;

/** Frames sampled per cross-axis read, and the pause between them. See the header. */
const SPAN_SAMPLES = 20;
const SPAN_SAMPLE_INTERVAL_MS = 60;

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

/** The rect one of the two tools builds from a press on document `index`. */
interface BandRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The rect `singleRowMarqueeRect` / `singleColumnMarqueeRect` build for `index`, mirrored.
 *
 * `src/tools/singleRowColumnMarquee.ts:101` and `:114`, which is where the thin edge is `index`
 * and the other two span the document. Mirrored rather than imported because the press point
 * below is already built from the app's own published fit, and a test that asserts against the
 * tool's own output cannot fail when the tool is wrong.
 */
function bandRect(fit: Fit, axis: 'row' | 'column', index: number): BandRect {
  return axis === 'row'
    ? { x1: 0, y1: index, x2: fit.documentWidth, y2: index + BAND_THICKNESS_PX }
    : { x1: index, y1: 0, x2: index + BAND_THICKNESS_PX, y2: fit.documentHeight };
}

/** The four scan-line extremes a rect's ant stroke is expected to paint. */
function expectedAntsExtent(fit: Fit, axis: 'row' | 'column', index: number) {
  const rect = bandRect(fit, axis, index);
  const thinExtent = axis === 'row' ? fit.documentHeight : fit.documentWidth;
  const crossExtent = axis === 'row' ? fit.documentWidth : fit.documentHeight;
  const thinStart = axis === 'row' ? rect.y1 : rect.x1;
  const thinEnd = axis === 'row' ? rect.y2 : rect.x2;
  const crossStart = axis === 'row' ? rect.x1 : rect.y1;
  const crossEnd = axis === 'row' ? rect.x2 : rect.y2;

  return {
    first: firstPaintedLine(thinStart, fit.scale, thinExtent),
    last: lastPaintedLine(thinEnd, fit.scale, thinExtent),
    crossFirst: firstPaintedLine(crossStart, fit.scale, crossExtent),
    crossLast: lastPaintedLine(crossEnd, fit.scale, crossExtent),
    crossExtent,
    thinExtent,
    thinStart,
  };
}

/** What one whole-canvas scan of the ants found, in DOCUMENT pixels. */
interface AntsScan {
  /** First and last scan line on the band's thin axis that carried any ant. */
  first: number;
  last: number;
  /** How many scan lines carried anything at all. See the header for why it is not asserted. */
  lines: number;
  /** The painted extremes on the cross axis. */
  crossFirst: number;
  crossLast: number;
  /** Painted cross positions over every painted scan line, as a fraction of the document. */
  coverage: number;
}

/** Folds one scan into a union of scans, which is how the cross-axis extremes are read. */
function unionScan(into: AntsScan, add: AntsScan): AntsScan {
  return {
    first: Math.min(into.first, add.first),
    last: Math.max(into.last, add.last),
    lines: into.lines + add.lines,
    crossFirst: Math.min(into.crossFirst, add.crossFirst),
    crossLast: Math.max(into.crossLast, add.crossLast),
    coverage: Math.max(into.coverage, add.coverage),
  };
}

/** One scan of the whole ants canvas, on the band's thin axis. `null` when it holds no ants. */
async function scanAntsOnce(page: Page, fit: Fit, axis: 'row' | 'column'): Promise<AntsScan | null> {
  const runs: AntRun[][] = await readAntRuns(
    page,
    { x: 0, y: 0, width: fit.documentWidth, height: fit.documentHeight },
    axis
  );
  const crossCount = axis === 'row' ? fit.documentWidth : fit.documentHeight;
  const paintedCross = new Uint8Array(crossCount);
  let lines = 0;
  let first = -1;
  let last = -1;
  let crossFirst = -1;
  let crossLast = -1;

  runs.forEach((lineRuns, line) => {
    if (lineRuns.length === 0) return;
    lines += 1;
    if (first < 0) first = line;
    last = line;
    for (const [from, to] of lineRuns) {
      if (crossFirst < 0) crossFirst = from;
      if (to > crossLast) crossLast = to;
      for (let at = from; at <= to; at += 1) paintedCross[at] = 1;
    }
  });

  if (lines === 0) return null;
  let covered = 0;
  for (const painted of paintedCross) covered += painted;

  return { first, last, lines, crossFirst, crossLast, coverage: covered / crossCount };
}

/**
 * Waits for a band, then reads the ants canvas: the thin axis and the coverage from the first
 * frame that holds one, the cross extremes from every frame over a whole dash cycle.
 *
 * One function so no test can read the two halves at different instants, and so the reason the
 * two halves are read differently is stated once. See the header.
 */
async function committedAntsBand(page: Page, fit: Fit, axis: 'row' | 'column'): Promise<AntsScan> {
  await waitForCommittedAnts(page, 'the committed band on the ants canvas');
  const first = await scanAntsOnce(page, fit, axis);
  if (!first) throw new Error('committedAntsBand: the ants canvas held no band between the wait and the read');

  let swept = first;
  for (let sample = 1; sample < SPAN_SAMPLES; sample += 1) {
    await page.waitForTimeout(SPAN_SAMPLE_INTERVAL_MS);
    const next = await scanAntsOnce(page, fit, axis);
    if (next) swept = unionScan(swept, next);
  }

  return {
    first: first.first,
    last: first.last,
    lines: first.lines,
    crossFirst: swept.crossFirst,
    crossLast: swept.crossLast,
    coverage: first.coverage,
  };
}

/**
 * The four extremes, asserted against the rect the press should have committed.
 *
 * One place, so every test in this file asks the geometry the same way and a failure names both
 * what was measured and what the ant stroke says it should be. The thickness is stated as the two
 * extremes rather than as a count because of the doubled thin row the header describes, and the
 * cross axis is stated as the document's own edges because the path's end caps paint them at any
 * dash phase.
 */
function expectAntsBand(band: AntsScan, fit: Fit, axis: 'row' | 'column', index: number) {
  const expected = expectedAntsExtent(fit, axis, index);
  const where = axis === 'row' ? `row ${index}` : `column ${index}`;
  const forty = paintedLineCount(expected.thinStart, 40, fit.scale, expected.thinExtent);

  expect
    .soft(
      { first: band.first, last: band.last },
      `the band's thin axis is ${band.first}..${band.last} and a ${BAND_THICKNESS_PX}-pixel band at ${where} ` +
        `stroked by a ${antStrokeWidth(fit.scale).toFixed(4)} document px ant reaches ` +
        `${expected.first}..${expected.last} (a 40-pixel band there would paint ${forty} scan lines)`
    )
    .toEqual({ first: expected.first, last: expected.last });

  expect
    .soft(
      { crossFirst: band.crossFirst, crossLast: band.crossLast },
      `the band spans ${band.crossFirst}..${band.crossLast} of ${expected.crossExtent} across, and the ` +
        `ants around ${where} reach ${expected.crossFirst}..${expected.crossLast}`
    )
    .toEqual({ crossFirst: expected.crossFirst, crossLast: expected.crossLast });

  expect
    .soft(
      band.coverage,
      `the ants should paint most of the span, and a band stopping short of an edge cannot (measured ` +
        `worst case 0.648, best 0.933)`
    )
    .toBeGreaterThan(SPAN_COVERAGE_FLOOR);

  return expected;
}

/** Every pixel painted anywhere on the ants canvas — the undo assertion needs all of it. */
async function anyAntsPaint(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLCanvasElement>('[data-testid="selection-ants-canvas"]');
    if (!element) throw new Error('anyAntsPaint: no [data-testid="selection-ants-canvas"] on the page');
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('the selection ants canvas has no 2d context');
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
 * `usePointerPosition` measures `workspace-container` and the gesture is dispatched on the tool
 * area filling that same container. `visual-regression.spec.ts` proves the canvas element and the
 * container coincide; this asserts it for this spec's own measurements, because a silent
 * divergence would place every press on a different pixel while each individual assertion still
 * passed.
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
  //    group that still has a tile: the marquee group is the second of fifteen
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

    const band = await committedAntsBand(page, fit, 'row');
    const readBack = await readFit(page);
    expect.soft(readBack.scale, 'the fit must not have changed between the press and the read').toBe(fit.scale);

    // 2. One document pixel on the thin axis and the whole document on the other, read off the
    //    ants. `expectAntsBand` states all four extremes against the rect the press should have
    //    committed, so "on row 252" and "spans 0..799" are one assertion rather than a special
    //    case per property.
    expectAntsBand(band, fit, 'row', 252);

    // 3. Nothing but that band is on the ants canvas: a second selection's ants, or a leftover
    //    preview, would show up as scan lines outside the three the stroke reaches. This is the
    //    claim a window used to make and the whole canvas now makes instead — with no anchor
    //    discs to exclude, there is nothing left that a frame would have hidden.
    const stray = band.lines - (band.last - band.first + 1);
    expect.soft(stray, `painted scan lines outside the band's own, which spans ${band.first}..${band.last}`).toBe(0);
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

    const band = await committedAntsBand(page, fit, 'column');
    expectAntsBand(band, fit, 'column', 530);
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
  // that is wrong in the same way twice, and each band is re-measured against its own rect, so
  // the pair cannot pass as two 40-pixel boxes the right distance apart.
  test('two presses at different heights commit bands the expected document rows apart', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expect(rowBar(page)).toBeVisible();
    const { fit } = await measure(page);
    const upper = pointOn(fit, 'row', 120, 0.5);
    const lower = pointOn(fit, 'row', 420, 0.5);
    const expectedDelta = documentAxisOf(fit, lower.y, 'row') - documentAxisOf(fit, upper.y, 'row');
    expect.soft(expectedDelta, 'the two presses are 300 document rows apart by construction').toBe(300);

    await page.mouse.click(upper.x, upper.y);
    const first = await committedAntsBand(page, fit, 'row');
    await page.mouse.click(lower.x, lower.y);
    const second = await committedAntsBand(page, fit, 'row');
    const readBack = await readFit(page);
    expect.soft(readBack.scale, 'the fit must not have changed between the two presses').toBe(fit.scale);

    // The SECOND band is the one on screen, so the read of `first` is the reading that proves
    // the first press was not a no-op and the delta is between two real bands.
    const delta = second.first - first.first;
    expect
      .soft(
        Math.abs(delta - expectedDelta),
        `the two bands' first painted scan lines are ${first.first} and ${second.first}, and ` +
          `${expectedDelta} apart is expected`
      )
      .toBeLessThanOrEqual(1);

    for (const [read, row] of [
      [first, 120],
      [second, 420],
    ] as const) {
      expectAntsBand(read, fit, 'row', row);
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

    const band = await committedAntsBand(page, fit, 'column');
    const released = expectedAntsExtent(fit, 'column', 600);
    const pressed = expectedAntsExtent(fit, 'column', 200);
    expectAntsBand(band, fit, 'column', 600);
    // Its own assertion rather than a fold-in: this is what says the drag was AIMED at all, and
    // a band committed from the press would satisfy the line above only if the two columns were
    // close, which the 400-column separation above rules out.
    const releaseError = Math.abs(band.first - released.first);
    const pressError = Math.abs(band.first - pressed.first);
    expect
      .soft(releaseError, `the band's first painted column is ${band.first}, and 600's ants start at ${released.first}`)
      .toBe(0);
    expect
      .soft(pressError, `the band must not be at the press column 200, which is ${pressError} px away`)
      .toBeGreaterThan(releaseError + 20);
  });

  // The same drag under the ROW tool, where it changes only X. The band is the pointer's
  // ABSOLUTE document row rather than a function of the gesture:
  // `SingleRowColumnMarqueeToolArea.tsx:305` re-derives `drag.axis` from `documentPoint.y` on
  // every move frame, so a gesture that never crosses a row boundary leaves it where it was
  // pressed. The column tool's identical gesture is the test above, and between the two the
  // pair pins the axis to the TOOL rather than to the direction the pointer travelled.
  //
  // Broken by: the create arm accumulating a delta instead of reading the pointer's axis, which
  // would carry the band down with the drag; or the row tool reading X, which would commit a
  // COLUMN band at the release column — read through this window that is a band about 600
  // document px thick, so the thickness assertion below is what catches the transposition.
  test('a row drag that changes only X leaves the band on its press row', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expect(rowBar(page)).toBeVisible();
    const { fit } = await measure(page);
    // Both points are built on row 200, so the release cannot be on another row by accident of
    // the arithmetic; only X differs, and by 640 document pixels.
    const press = pointOn(fit, 'row', 200, 0.1);
    const release = pointOn(fit, 'row', 200, 0.9);
    expect.soft(documentAxisOf(fit, press.y, 'row'), 'the press is built to land on its row').toBe(200);
    expect.soft(documentAxisOf(fit, release.y, 'row'), 'the release is on the SAME row, by construction').toBe(200);
    expect
      .soft(Math.abs(release.x - press.x) / fit.scale, 'the gesture must be a real drag, not a click')
      .toBeGreaterThan(100);

    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 12 });
    await page.mouse.up();

    // PORTED FROM MAIN. This test arrived written against the `tool-overlay-canvas` reader, and
    // this branch deleted that reader: the band is stroked on `selection-ants-canvas` now, so the
    // old `readBand`/`committedBand`/`anyOverlayPaint` and the `OUTLINE_LINE_WIDTH` half-stroke
    // arithmetic behind them have no definition here. It is not weakened in the port. Main
    // asserted `thicknessOf(band) <= STROKE_TOLERANCE_PX` and `|band.start - (200 - halfStroke)|
    // <= STROKE_TOLERANCE_PX`; `expectAntsBand` asserts the band's thin axis EQUALS the extremes a
    // centred ant stroke at row 200 reaches, which is a tighter claim than a 1.5px tolerance
    // around a rounded half-stroke. Main's `spanStart <= window.x + 3` / `spanEnd >=
    // window.x + window.width - 4` become exact `crossFirst === 0` / `crossLast === 799`, again
    // tighter, plus the span-coverage floor the old reader never had.
    const band = await committedAntsBand(page, fit, 'row');
    expectAntsBand(band, fit, 'row', 200);
  });

  // A press INSIDE a committed 1-pixel band is a MOVE (`isPressOnActiveBand`,
  // `SingleRowColumnMarqueeToolArea.tsx:279`-`:287`), and it writes exactly ONE history state.
  // `SingleRowColumnMarqueeToolArea.test.tsx:527` covers this against a MOCKED store and counts
  // dispatches, which is a different question: a double commit — the move arm appending on
  // pointerup while the create arm appended on pointerdown — dispatches once per arm but
  // replays into two states, and only the real undo cursor can see that.
  test('a press inside a committed band moves it and appends one history state', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expect(rowBar(page)).toBeVisible();
    const undo = page.getByTestId('undo-button');
    const { fit } = await measure(page);

    const press = pointOn(fit, 'row', 200, 0.5);
    await page.mouse.click(press.x, press.y);
    const first = await committedAntsBand(page, fit, 'row');
    // PORTED FROM MAIN — see the note on the row-drag test above. `committedBand` ->
    // `committedAntsBand`, and the exact-extent assertion replaces main's
    // `|start - (200 - halfStroke)| <= STROKE_TOLERANCE_PX`.
    expectAntsBand(first, fit, 'row', 200);
    await expect(undo, 'the first band is one history state').toBeEnabled();

    // The same press point, so it lands inside the band just committed — the CENTRE of row 200 is
    // the only row of hits unambiguously inside a band one document pixel tall. The drag ends 100
    // rows lower, which is where the move must put it.
    const release = pointOn(fit, 'row', 300, 0.5);
    expect.soft(documentAxisOf(fit, release.y, 'row'), 'the release is built to land on its row').toBe(300);
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 12 });
    await page.mouse.up();

    const moved = await committedAntsBand(page, fit, 'row');
    // PORTED FROM MAIN. `expectAntsBand(..., 300)` is exact where main asserted
    // `|moved.start - (300 - halfStroke)| <= STROKE_TOLERANCE_PX`.
    expectAntsBand(moved, fit, 'row', 300);

    // The count is the point, and it is read off the cursor rather than off a dispatch list: one
    // undo must return the band to row 200 — a create-on-press would have appended a second band
    // there instead — and the second must clear the canvas entirely, which a second state from
    // the move gesture would survive.
    await undo.click();
    await expect
      .poll(
        async () => {
          const band = await scanAntsOnce(page, fit, 'row');

          return band ? band.first : Number.NaN;
        },
        { message: 'one undo to bring the band back to the row it was committed on' }
      )
      .toBe(first.first);
    await undo.click();
    await expect.poll(async () => anyAntsPaint(page), { message: 'the second undo to clear the ants canvas' }).toBe(0);
    await expect(
      undo,
      'the create and the move wrote two history states between them, so the move wrote one'
    ).toBeDisabled();
  });

  // A history state, unlike the eyedropper — `e2e/erase-fill-eyedropper.spec.ts:674` pins the
  // inverse. The seeded document has exactly one entry at cursor 0, so undo is disabled until
  // something commits, and the baseline is asserted BEFORE the gesture so a failure after it
  // names the gesture rather than a precondition nobody checked. The canvas the assertion clears
  // is the ants canvas now, which is where the band's whole visible form lives.
  test('a band records one history state and one undo removes it', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expect(rowBar(page)).toBeVisible();
    const undo = page.getByTestId('undo-button');
    await expect(undo, 'a seeded document has nothing to undo').toBeDisabled();
    expect.soft(await anyAntsPaint(page), 'nothing is selected before the press').toBe(0);

    const { fit } = await measure(page);
    const press = pointOn(fit, 'row', 300, 0.5);
    await page.mouse.click(press.x, press.y);
    const band = await committedAntsBand(page, fit, 'row');
    expect.soft(band.first, 'the press should have committed a band on row 300').toBe(299);
    expect.soft(await anyAntsPaint(page), 'the band is painted on the ants canvas').toBeGreaterThan(0);
    await expect(undo, 'the band is a history state, unlike the eyedropper').toBeEnabled();

    await undo.click();
    await expect
      .poll(async () => anyAntsPaint(page), { message: 'every painted pixel of the band to be undone' })
      .toBe(0);
    // One click reverted the whole gesture and nothing is left: a second entry would still be on
    // the cursor, and a commit per pointer move would have left several. This is what makes
    // "one history state" mean one rather than at least one.
    await expect(undo, 'the band wrote exactly one history state').toBeDisabled();
  });

  // REDO, which the one-state test above stops short of. Undo proves the band was REACHED from a
  // known geometry; it says nothing about the geometry coming BACK, and a replay that restored a
  // band somewhere else — off by the frame origin, or on the wrong row — would pass every undo
  // assertion in this file.
  test('redo brings back the band undo took away, on the row it was committed', async ({ page }) => {
    await selectMarquee(page, ROW, 'Single Row Marquee Tool');
    await expect(rowBar(page)).toBeVisible();
    const { fit } = await measure(page);
    const press = pointOn(fit, 'row', 300, 0.5);
    await page.mouse.click(press.x, press.y);
    // PORTED FROM MAIN — see the row-drag test's note. `BandRead{start,end,spanStart,spanEnd}` maps
    // onto `AntsScan{first,last,crossFirst,crossLast}`, and `anyOverlayPaint` onto `anyAntsPaint`.
    // The poll is two-step on purpose: `scanAntsOnce` is a SINGLE-frame read while
    // `committedAntsBand` is phase-complete (it unions a whole dash cycle, which is the only way to
    // read a dashed line's ENDS), so gating on a single frame and then comparing a single frame
    // against the phase-complete `committed` would be comparing two different instruments. Gate on
    // "ants are painted again", then read with the same instrument the commit was read with.
    const committed = await committedAntsBand(page, fit, 'row');
    const geometry = (band: AntsScan) => ({
      first: band.first,
      last: band.last,
      crossFirst: band.crossFirst,
      crossLast: band.crossLast,
    });

    await page.getByTestId('undo-button').click();
    await expect.poll(async () => anyAntsPaint(page), { message: 'undo to take the band off the ants canvas' }).toBe(0);

    await page.getByTestId('redo-button').click();
    await expect
      .poll(async () => (await scanAntsOnce(page, fit, 'row')) !== null, {
        message: 'redo to repaint the band',
      })
      .toBe(true);
    expect(
      geometry(await committedAntsBand(page, fit, 'row')),
      'redo must repaint the band exactly where it was committed'
    ).toEqual(geometry(committed));
  });
});

test.describe('The seeded document the geometry is read from', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  // The 800x600 default is the one number every geometry assertion above is scaled against, so it
  // is read from the app rather than trusted: a change to the seeded size would otherwise move
  // the target of "the full document span" without any test failing on it directly. The second
  // half pins the derived stroke arithmetic itself, because every extent in this file is
  // `floor(edge +/- antStrokeWidth(scale)/2)` and that expression is where a wrong scale would
  // show up first.
  test('the fit reports the seeded document size the geometry assertions assume', async ({ page }) => {
    const fit = await readFit(page);
    expect(fit.documentWidth).toBe(800);
    expect(fit.documentHeight).toBe(600);
    expect(fit.scale, 'a contain fit is never zero').toBeGreaterThan(0);
    expect
      .soft(bandRect(fit, 'row', 252), 'a row band is the whole document width by one document pixel')
      .toEqual({ x1: 0, y1: 252, x2: 800, y2: 253 });
    expect
      .soft(expectedAntsExtent(fit, 'row', 252), 'the ants around row 252 reach these scan lines and columns')
      .toEqual({
        first: 251,
        last: 253,
        crossFirst: 0,
        crossLast: 799,
        crossExtent: 800,
        thinExtent: 600,
        thinStart: 252,
      });
    expect
      .soft(
        paintedLineCount(252, 1, fit.scale, 600),
        'and a 1-pixel band paints three scan lines where a 40-pixel one paints far more'
      )
      .toBe(3);
  });
});
