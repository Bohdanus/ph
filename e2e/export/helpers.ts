import { type Download, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { initializeCanvas, readPsd } from 'ag-psd';
import sharp from 'sharp';
import {
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_WIDTH,
  documentToCanvasOffset,
  drawLine,
  getWorkspaceCanvas,
  inkHeight,
  INK_LUMA_FLOOR,
  measureInk,
  waitForCanvasRedraw,
} from '../helpers/canvas-helpers';
import { clickToolButton, toggleToolbarLayout } from '../helpers/toolbar-helpers';
import { acceptDiscardPrompt } from '../helpers/discard-prompt';
import { DEFAULT_TEST_TIMEOUT_MS } from '../helpers/timeouts';

/**
 * How a format's exported bytes are checked.
 *
 * `browser-pixels` means the browser decodes the format natively, so the export can be drawn
 * onto a canvas and compared with the canvas it was encoded from. `container` means it
 * cannot, and the bytes are parsed in Node instead — see `exportByteVerifiers`.
 *
 * There is deliberately no 'none'. `comparePixels: false` used to be that value, and it
 * silently exempted TIFF and PSD from every content check: their only assertions were a
 * byte-length floor and a file extension. Measured on the fixture below, a BLANK export is
 * 11,841 bytes as a PNG and 1,921,000 as a TIFF, so a floor of `> 100` cannot see it at all.
 * A format must now name a mechanism, and the invariant test in
 * `__tests__/helpers.unit.test.ts` fails until a verifier exists for each `container` one.
 */
export type ExportVerification = 'browser-pixels' | 'container';

export interface ExportFormat {
  label: string;
  extension: string;
  verification: ExportVerification;
}

/**
 * Upper bound on differing colour channels tolerated when comparing an export
 * against the canvas it was encoded from. The fixture is the seeded 800x600
 * document, so there are 1,440,000 colour channels and 50,000 of them is ~3.5%,
 * wide enough to absorb the re-encoding artifacts (chroma subsampling,
 * dithering) a lossy export necessarily introduces.
 *
 * It is NOT the blank-export oracle, and it cannot be. The fixture's line covers
 * 1,911 of the 480,000 pixels (measured, `INK_LUMA_FLOOR`-relative), so an
 * all-white export differs from its source in roughly 5,700 channels - two orders
 * of magnitude inside this budget - and an export whose pixels are all transparent
 * differs in none at all, because alpha is not a colour channel. What rejects both
 * is `MIN_EXPORT_INK_RATIO`, which COUNTS visible inked pixels rather than
 * differenced ones and so cannot be satisfied by an empty image.
 */
export const CHANGED_CHANNEL_THRESHOLD_GENERAL = 50_000;

/**
 * Tighter bound used for ICO. An icon is inspected at small sizes, so a colour
 * shift that would be a rounding error on a 256x256 image is visible on a
 * 32x32 icon frame; 20,000 is 2.5x stricter than the general threshold to
 * catch those subtle shifts.
 */
export const CHANGED_CHANNEL_THRESHOLD_ICO = 20_000;

/**
 * Per-channel absolute RGB delta below which a channel counts as unchanged.
 * Small enough to catch any visible colour shift, large enough to ignore
 * rounding noise introduced by base64 round-tripping through PNG.
 */
export const CHANNEL_DELTA_TOLERANCE = 40;

/**
 * An export must retain at least 1 / MIN_EXPORT_INK_RATIO of the source's visible inked
 * pixels, and at least one of them outright.
 *
 * The headroom is measured against every format the fixture actually produces, not
 * guessed. Counting pixels the way `measureInk` does (`INK_LUMA_FLOOR` relative, alpha
 * weighted, transparent pixels skipped), the drawn SOURCE canvas carries 1,911 inked
 * pixels of its 480,000, and the exports land within 0.05% of that:
 *
 *   source 1911 | PNG 1911 | JPEG 1911 | WebP 1910 | GIF 1911 | AVIF 1911
 *   SVG 1911 | TIFF 1911
 *
 * The tightest is 1,910, so halving the requirement (an export must keep at least
 * 956) leaves ~2x headroom over the tightest real export, while an export that dropped
 * half the drawing - or all of it, at 0 - fails. `0` is the case that matters: a blank
 * export is 11,841 bytes as a PNG, 1,921,000 as a TIFF and 67,408 as a PSD, and every one
 * of them clears the byte-length floor that used to be the only check these formats had.
 */
export const MIN_EXPORT_INK_RATIO = 2;

/**
 * Budget for a single export download. Encoders such as AVIF and TIFF are much
 * slower than PNG, so this is well above the time a healthy export needs.
 */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Per-test budget covering the full draw, encode, download and pixel
 * comparison sequence, which is only bound by encoder speed rather than by
 * any single awaited step.
 *
 * An alias of `DEFAULT_TEST_TIMEOUT_MS`, not a separate budget: this is the one
 * sequence in the suite that was a routine length all along, and it used to be the
 * ONLY named per-test timeout, which is what left the other 51 call sites inlined.
 * The export specs keep importing it under this name; the value and its rationale now
 * live with the rest in `helpers/timeouts.ts`.
 */
export const INTEGRATION_TEST_TIMEOUT_MS = DEFAULT_TEST_TIMEOUT_MS;

/**
 * Budget for photopea.com to raise its consent modal, load its module graph and paint an
 * editor canvas. A per-step wait on a page this repository does not control, so it is
 * named here with `DOWNLOAD_TIMEOUT_MS` rather than in `helpers/timeouts.ts`, which holds
 * the per-TEST budgets: this one bounds a single wait, and the test that contains it has
 * its own, longer, budget in `THIRD_PARTY_PAGE_TEST_TIMEOUT_MS`.
 */
export const PHOTOPEA_READY_TIMEOUT_MS = 60_000;

export const exportFormats: ExportFormat[] = [
  { label: 'PNG', extension: '.png', verification: 'browser-pixels' },
  { label: 'JPEG', extension: '.jpeg', verification: 'browser-pixels' },
  { label: 'WebP', extension: '.webp', verification: 'browser-pixels' },
  { label: 'TIFF', extension: '.tiff', verification: 'container' },
  { label: 'BMP', extension: '.bmp', verification: 'browser-pixels' },
  { label: 'GIF (static)', extension: '.gif', verification: 'browser-pixels' },
  { label: 'AVIF', extension: '.avif', verification: 'browser-pixels' },
  { label: 'SVG (flattened)', extension: '.svg', verification: 'browser-pixels' },
  { label: 'Photoshop PSD (layers)', extension: '.psd', verification: 'container' },
];

/**
 * The formats the browser decodes natively, and therefore the ones with a committed visual
 * baseline. `visual-regression.spec.ts` iterates this, so the format list above is the
 * single place coverage is decided.
 */
export const browserVerifiedFormats = exportFormats.filter((format) => format.verification === 'browser-pixels');

/**
 * The formats no browser decodes, verified by parsing their bytes in Node instead. See
 * `exportByteVerifiers` and `structured-formats.spec.ts`.
 */
export const containerVerifiedFormats = exportFormats.filter((format) => format.verification === 'container');

export const icoFormat: ExportFormat = { label: 'ICO', extension: '.ico', verification: 'browser-pixels' };

export function mimeType(extension: string | null | undefined): string {
  if (typeof extension !== 'string' || extension.length === 0) {
    return 'application/octet-stream';
  }
  return (
    {
      '.png': 'image/png',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
    }[extension.toLowerCase()] ?? 'application/octet-stream'
  );
}

/**
 * The test line, in DOCUMENT space, at the position the committed export baselines record.
 *
 * These are not round numbers on purpose. The baselines were recorded with the line
 * specified in canvas-relative offsets (`150,150` to `350,150`) against a 974x840 canvas —
 * the overflowing layout, in which the document was fitted at `scale = 1.2175` with a
 * `54.75px` vertical letterbox. Under that mapping those offsets are the document points
 * below. Pinning the document points reproduces the committed pixels exactly, which is what
 * makes this change reviewable: the export is now a function of the document alone, so the
 * shell's layout cannot move it again.
 *
 * Derivation, from `documentToCanvasOffset` inverted at the baseline geometry:
 *
 *   scale  = min(974/800, 840/600) = 1.2175
 *   offsetX = (974 - 800*1.2175)/2  = 0
 *   offsetY = (840 - 600*1.2175)/2  = 54.75
 *   start = ((150 - 0)/1.2175, (150 - 54.75)/1.2175)
 *   end   = ((350 - 0)/1.2175, (150 - 54.75)/1.2175)
 *
 * The 840 is not a guess, and that is the whole reason the `y` below is what it is. A first
 * pass inverted the mapping at a 974x**890** box and landed the line on document row ~58,
 * which left all seven baselines failing by a constant 3824 pixels at a ratio of 0.0080 —
 * a number that reads like a rendering difference and is not one. Decoding the committed
 * `drawing.png` says where the stroke actually is:
 *
 *   committed baseline : rows 73-82, columns 118-291   (centre row 78)
 *   that export        : rows 53-62, columns 119-291   (centre row 55)
 *
 * Two ten-pixel bands, twenty-three rows apart, with per-channel deltas of a whole 229 —
 * a stroke sitting where it was drawn, not a font or a colour-management difference. A
 * 840px letterbox of 54.75 puts row 150 on document row 78.23, which is the committed one.
 * The recorded pixels were right all along and the constant was wrong.
 */
export const EXPORT_LINE_START = { x: 123.203285, y: 78.234086 };
export const EXPORT_LINE_END = { x: 287.474333, y: 78.234086 };

/**
 * The line's midpoint and span in document pixels, derived rather than retyped.
 *
 * `EXPORT_LINE_START` and `EXPORT_LINE_END` are the only place the two endpoints are
 * written down; everything about the mark's expected shape follows from them, so a change
 * to either endpoint cannot leave a second, stale copy of the same numbers behind.
 */
export const EXPORT_LINE_MIDPOINT_X = (EXPORT_LINE_START.x + EXPORT_LINE_END.x) / 2;
export const EXPORT_LINE_SPAN_X = EXPORT_LINE_END.x - EXPORT_LINE_START.x;

/**
 * The drawn tool's default stroke width, in document pixels.
 *
 * Part of the geometry contract rather than a rendering detail: with round caps the ink
 * reaches one half-width past each endpoint, so the ink's column span is
 * `EXPORT_LINE_SPAN_X + EXPORT_STROKE_WIDTH`. A fixture that drew a different width would
 * move the mark's extent and has to be told, not inferred.
 */
export const EXPORT_STROKE_WIDTH = 10;

/** The ink's expected column span: the requested span plus one half-width of cap at each end. */
export const EXPECTED_INK_WIDTH = EXPORT_LINE_SPAN_X + EXPORT_STROKE_WIDTH;

/**
 * How far, in document pixels, the decoded export's ink may sit from where the fixture asked.
 *
 * Every number below is a measured margin over a measured worst case, not a round guess, and
 * each is recorded against the quantity it guards:
 *
 * - `VERTICAL` guards the row the export sits on. The pixel diff already fails a vertical
 *   shift of 0.012 document pixels, so this is not the binding vertical oracle; it is here
 *   because the pixel diff counts PIXELS and a mark that moved vertically while changing
 *   shape can keep the count down. Measured across all seven committed baselines, the
 *   row centroid lands 0.0086 document pixels from `EXPORT_LINE_START.y` on the lossless PNG
 *   the spec compares and 0.034 on the 8-bit-palette GIF, so 0.05 is 1.5x the worst case.
 * - `HORIZONTAL` guards the column, and it is the fix. A 1.0-document-pixel horizontal
 *   shift produced 88 diff pixels and PASSED the 100-pixel budget; this makes it fail. The
 *   budget is larger than `VERTICAL` because the ink's centroid does not sit on the
 *   geometric midpoint: the round caps and the rasteriser's endpoint coverage put it 0.12 to
 *   0.17 document pixels right of centre on every committed baseline. The offset is itself
 *   pinned, by the unit test that anchors this fixture's endpoints to the committed
 *   `drawing.png.png`, so this number is a transfer budget and not a fudge.
 * - `SPAN` guards the mark's length. The ink bounds are whole pixels, so the achievable
 *   precision is one pixel and 0.271 is the measured error.
 */
export const GEOMETRY_TOLERANCE_VERTICAL = 0.05;
export const GEOMETRY_TOLERANCE_HORIZONTAL = 0.25;
export const GEOMETRY_TOLERANCE_SPAN = 1;

/**
 * How far, in document pixels, this run's decoded export may sit from the committed
 * baseline's decoded export.
 *
 * Tighter than either tolerance above, and for a different reason: it has no cap-bias term
 * and no encoder-spread term, because both sides are the same format decoded the same way.
 * What is left is run-to-run rasteriser and encoder noise. This is the assertion that turns
 * the pixel diff's 1.2-document-pixel horizontal blind spot into a 0.05 one.
 */
export const GEOMETRY_TOLERANCE_BASELINE = 0.05;

export interface ExportGeometry {
  centroidX: number;
  centroidY: number;
  inkWidth: number;
  inkHeight: number;
  ink: number;
  spreadX: number;
  spreadY: number;
}

async function measureSignificantInkWidth(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const paper = 255 - INK_LUMA_FLOOR;
  let left = info.width;
  let right = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const index = (y * info.width + x) * 4;
      const alpha = data[index + 3];
      if (alpha === 0) continue;
      const luma = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      const weight = ((paper - luma) * alpha) / 255;
      // Weak lossy-codec halos contribute to the centroid but not to the stroke's span.
      if (weight <= INK_LUMA_FLOOR) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }

  if (right < left) {
    throw new Error('The exported image carries no significant ink: the document under test is blank');
  }
  return right - left + 1;
}

/**
 * Decode an exported image and report where its ink is, in DOCUMENT pixels.
 *
 * The export is the flattened document at the document's own resolution — an 800x600
 * document exports as an 800x600 image — so image pixels ARE document pixels and no
 * contain-fit inversion is needed. That is worth stating because the tempting alternative is
 * to convert the export back through the fit, and doing so would be a second, unverified
 * mapping layered on top of the one under test.
 */
export async function readExportGeometry(image: Buffer): Promise<ExportGeometry> {
  const profile = await measureInk(image);
  if (!profile) {
    throw new Error('The exported image carries no ink: the document under test is blank');
  }
  expect(
    profile.imageWidth,
    'the export is the document at the document resolution, so image pixels are document pixels'
  ).toBe(DEFAULT_DOCUMENT_WIDTH);
  expect(profile.imageHeight).toBe(DEFAULT_DOCUMENT_HEIGHT);
  return {
    centroidX: profile.centroidX,
    centroidY: profile.centroidY,
    inkWidth: await measureSignificantInkWidth(image),
    inkHeight: inkHeight(profile),
    ink: profile.ink,
    spreadX: profile.spreadX,
    spreadY: profile.spreadY,
  };
}

/**
 * Assert that an exported image's ink is where `EXPORT_LINE_*` said it would be, and that
 * it has not drifted from the committed baseline that encodes the same claim.
 *
 * IN ADDITION TO the pixel diff, not instead of it. The two guard different failures: the
 * pixel diff catches any change in the exported image at all, and this catches the specific
 * class the pixel diff is blind to on one axis — a mark that moved sideways, or resized,
 * or vanished, without moving enough pixels to exhaust the budget.
 */
export async function assertExportGeometry(
  exported: Buffer,
  baseline: Buffer,
  label: string
): Promise<{ actual: ExportGeometry; baseline: ExportGeometry }> {
  const actual = await readExportGeometry(exported);
  const expected = await readExportGeometry(baseline);

  const failures: string[] = [];
  const check = (name: string, actualValue: number, expectedValue: number, tolerance: number) => {
    const delta = Math.abs(actualValue - expectedValue);
    if (delta > tolerance) {
      failures.push(`${name}: ${actualValue.toFixed(4)} vs ${expectedValue.toFixed(4)} (off by ${delta.toFixed(4)})`);
    }
  };

  // Absolute: the document points the fixture asked for, on BOTH axes.
  check('ink centroid row vs EXPORT_LINE_START.y', actual.centroidY, EXPORT_LINE_START.y, GEOMETRY_TOLERANCE_VERTICAL);
  check(
    'ink centroid column vs the requested midpoint',
    actual.centroidX,
    EXPORT_LINE_MIDPOINT_X,
    GEOMETRY_TOLERANCE_HORIZONTAL
  );
  check(
    'ink column span vs the requested span plus caps',
    actual.inkWidth,
    EXPECTED_INK_WIDTH,
    GEOMETRY_TOLERANCE_SPAN
  );

  // Relative: this run against the artifact that already encodes the same claim, on BOTH
  // axes, with no cap bias and no cross-format spread in the budget.
  check(
    'ink centroid row vs the committed baseline',
    actual.centroidY,
    expected.centroidY,
    GEOMETRY_TOLERANCE_BASELINE
  );
  check(
    'ink centroid column vs the committed baseline',
    actual.centroidX,
    expected.centroidX,
    GEOMETRY_TOLERANCE_BASELINE
  );
  check('ink column span vs the committed baseline', actual.inkWidth, expected.inkWidth, GEOMETRY_TOLERANCE_BASELINE);

  expect(failures, `Export geometry mismatch for ${label}`).toEqual([]);
  return { actual, baseline: expected };
}

/**
 * Prepares the per-test directory the export is saved into.
 *
 * Both entry points that save a download need this, and the ICO flow needs it without
 * drawing anything: `ico.spec.ts` used to build the path by hand and `mkdir` it, so a
 * directory left over from a previous attempt in the same `outputDir` was reused and a
 * stale download could satisfy a read. `setupExportTest` already cleared it with `rm`;
 * this is that `rm` in one place.
 */
export async function prepareExportDownloadDirectory(testInfo: TestInfo): Promise<string> {
  const downloadDirectory = path.join(testInfo.outputDir, 'exports');
  await rm(downloadDirectory, { recursive: true, force: true });
  await mkdir(downloadDirectory, { recursive: true });
  return downloadDirectory;
}

/**
 * How the left toolbar's layout is set before the line is drawn.
 *
 * The toggle is a desktop-only control: `SidebarLeft` renders it behind `!isTablet`, so it
 * does not exist below the `lg` breakpoint (1024px) and `toggled` is only reachable above it.
 * The layout-independence test relies on that — it applies `toggled` only at widths where the
 * control is present, and asserts its absence below `lg` rather than silently skipping.
 */
export type ToolbarLayout = 'default' | 'toggled';

export interface SetupExportTestOptions {
  /** Which left-toolbar layout to draw in. Defaults to `default`. */
  toolbarLayout?: ToolbarLayout;
}

export async function setupExportTest(
  page: Page,
  testInfo: TestInfo,
  options: SetupExportTestOptions = {}
): Promise<{
  box: { x: number; y: number; width: number; height: number };
  documentSize: { width: number; height: number };
  sourceDataUrl: string;
  downloadDirectory: string;
}> {
  const downloadDirectory = await prepareExportDownloadDirectory(testInfo);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();

  // BEFORE the box is read. The toggle restyles the left rail, which resizes the grid area the
  // canvas fills, so a box measured before it would map the document line into a canvas that no
  // longer exists — and the mapping would be wrong by the rail's width rather than by a
  // rounding, which is exactly the class of error this helper exists to remove.
  if (options.toolbarLayout === 'toggled') {
    await toggleToolbarLayout(page);
  }

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  // The document size, READ rather than assumed. `documentToCanvasOffset` used to divide by
  // a hardcoded 800x600, so a document opened at any other size would have been drawn
  // somewhere the app never looks and the export would silently not be the line the
  // constants describe. The backing store carries the truth (it is the document's own
  // resolution, which is also why the exported image is 1:1 with document pixels).
  const backingStore = await canvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    return { width: node.width, height: node.height };
  });
  const documentSize = { width: backingStore.width, height: backingStore.height };

  // The line is specified in document coordinates and mapped into this canvas, so the
  // document it marks — and therefore the exported image — is the same whatever the shell
  // does with the space around it. See `documentToCanvasOffset` for why the box-relative
  // form could not be used here.
  const start = documentToCanvasOffset(box, EXPORT_LINE_START.x, EXPORT_LINE_START.y, documentSize);
  const end = documentToCanvasOffset(box, EXPORT_LINE_END.x, EXPORT_LINE_END.y, documentSize);

  await clickToolButton(page, 'draw');
  await drawLine(page, box, start.x, start.y, end.x, end.y);

  // The redraw clip has to be derived from the mapped line as well. The shared
  // `CANVAS_REDRAW_CLIP` is a fixed region of the canvas box, and at any canvas size other
  // than the one it was chosen for it does not cover the line — so waiting on it would pass
  // without ever confirming the stroke reached the backing store.
  //
  // The clip is in PAGE coordinates: `buildClip` takes an explicit clip as given, and only
  // its own default (`canvasRedrawClip`) adds the box origin. Passing canvas-relative
  // offsets here would poll the wrong region — and worse, it can poll a region that is
  // legitimately dark for another reason and so report success without the stroke ever
  // having reached the backing store.
  await waitForCanvasRedraw(page, box, {
    clip: {
      x: box.x + Math.floor(start.x) - 20,
      y: box.y + Math.floor(start.y) - 20,
      width: Math.ceil(end.x - start.x) + 40,
      height: 40,
    },
  });

  const sourceDataUrl = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));

  return { box, documentSize, sourceDataUrl, downloadDirectory };
}

/** Opens the File menu and clicks Save, leaving the Save File As... dialog open. */
export async function openSaveDialog(page: Page): Promise<void> {
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-save-button').click();
}

/**
 * Asserts the save dialog has unmounted.
 *
 * The locator is the dialog's testid, never its title. The title is an implicit
 * `<h3>`, so `getByRole('heading', { name: 'Save File As...' })` matches the dialog
 * only while that element is both a heading and spelled exactly this. Render the
 * title as a `<div>`, or reword it to "Save As…", and the locator matches nothing —
 * `toHaveCount(0)` then passes forever with the dialog still on screen, and the
 * export flow would never notice. A testid is a contract this file is asserting on;
 * a heading's accessible name is a rendering decision somebody can make freely.
 *
 * `e2e/document-dialogs.spec.ts` asserts the same thing the same way.
 */
async function expectSaveDialogClosed(page: Page): Promise<void> {
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
}

/** Fills the filename and selects `formatLabel` in an already-open save dialog. */
export async function fillSaveDialog(page: Page, filename: string, formatLabel: string): Promise<void> {
  await page.getByTestId('save-dialog-filename-input').fill(filename);
  await page.getByTestId('save-dialog-format-select').selectOption({ label: formatLabel });
}

/**
 * Submits the save dialog and resolves once the download completes, asserting
 * that the browser reported no failure and that the saved file carries the
 * expected extension.
 */
export async function submitSaveDialogForDownload(
  page: Page,
  format: ExportFormat,
  { timeoutMs = DOWNLOAD_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: timeoutMs }),
    page.getByTestId('save-dialog-submit-button').click(),
  ]);
  expect(await download.failure(), `${format.label}: download failed`).toBeNull();
  expect(path.extname(download.suggestedFilename()).toLowerCase()).toBe(format.extension);
  return download;
}

/**
 * Why an export failed to match its source canvas.
 *
 * `context-unavailable` is the browser refusing a `2d` context for the comparison
 * canvases — an environment failure, not a rendering one. Reporting it as
 * `pixels-differ` destroys the only information that would have identified it.
 *
 * `export-blank` is the independent oracle, and it is checked first because it is the
 * more specific diagnosis: an export carrying no drawing at all also fails the colour
 * budget, but naming that as a pixel mismatch would bury the real cause.
 */
export type PixelComparisonFailure = 'context-unavailable' | 'pixels-differ' | 'export-blank';

export type PixelComparisonResult = { ok: true } | { ok: false; reason: PixelComparisonFailure; detail?: string };

const PIXEL_COMPARISON_FAILURE_MESSAGES: Record<PixelComparisonFailure, string> = {
  'context-unavailable': 'the browser provided no 2d canvas context to compare the export against',
  'pixels-differ': 'pixels differ too much from source',
  'export-blank': 'the export carries none of the drawing',
};

function pixelComparisonFailureMessage(label: string, reason: PixelComparisonFailure, detail?: string): string {
  return `${label}: ${PIXEL_COMPARISON_FAILURE_MESSAGES[reason]}${detail ? ` (${detail})` : ''}`;
}

/**
 * Everything the in-browser oracle needs. Every threshold travels as a field rather than
 * being read from module scope: `page.evaluate` serialises this function's source, so a
 * reference to a module constant would be an undefined free variable in the page, and a
 * second literal copy of each threshold is exactly how the two budgets drift apart.
 */
export interface ExportPixelPayload {
  source: string;
  exported: string;
  mime: string;
  threshold: number;
  tolerance: number;
  lumaFloor: number;
  minInkRatio: number;
}

/** Builds the payload for `compareExportToSource`, so no caller can omit a threshold. */
export function exportPixelPayload(
  source: string,
  exported: string,
  extension: string,
  threshold: number
): ExportPixelPayload {
  return {
    source,
    exported,
    mime: mimeType(extension),
    threshold,
    tolerance: CHANNEL_DELTA_TOLERANCE,
    lumaFloor: INK_LUMA_FLOOR,
    minInkRatio: MIN_EXPORT_INK_RATIO,
  };
}

/**
 * The one oracle for every browser-decodable export, ICO included.
 *
 * Two checks, in this order, because they answer different questions:
 *
 * 1. Does the export carry the drawing? COUNTED, not differenced. A pixel is inked when
 *    it is not fully transparent and carries any `INK_LUMA_FLOOR`-relative darkness -
 *    the rule `measureInk` uses, reproduced here because `page.evaluate` cannot import
 *    it. An all-white export, and an all-transparent one whose RGB matches perfectly
 *    after compositing, both count zero and fail here.
 * 2. Does it match its source? The differing-channel budget, unchanged, for the
 *    re-encoding noise a lossy format necessarily introduces.
 */
export async function compareExportToSource({
  source,
  exported,
  mime,
  threshold,
  tolerance,
  lumaFloor,
  minInkRatio,
}: ExportPixelPayload): Promise<PixelComparisonResult> {
  const loadImage = (data: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Browser cannot decode exported image'));
      image.src = data;
    });
  const sourceImage = await loadImage(source);
  const exportedImage = await loadImage(`data:${mime};base64,${exported}`);
  const sourceCanvas = document.createElement('canvas');
  const exportedCanvas = document.createElement('canvas');
  sourceCanvas.width = exportedCanvas.width = sourceImage.width;
  sourceCanvas.height = exportedCanvas.height = sourceImage.height;
  const sourceContext = sourceCanvas.getContext('2d');
  const exportedContext = exportedCanvas.getContext('2d');
  if (!sourceContext || !exportedContext) return { ok: false, reason: 'context-unavailable' };
  sourceContext.drawImage(sourceImage, 0, 0);
  exportedContext.drawImage(exportedImage, 0, 0, sourceImage.width, sourceImage.height);
  const original = sourceContext.getImageData(0, 0, sourceImage.width, sourceImage.height).data;
  const actual = exportedContext.getImageData(0, 0, sourceImage.width, sourceImage.height).data;

  // `measureInk`'s rule, in the page. `alpha === 0` skips, `weight <= 0` skips, and
  // luma below `255 - lumaFloor` is ink - see `INK_LUMA_FLOOR` in canvas-helpers for why
  // the floor is 8 and not 0.
  const paper = 255 - lumaFloor;
  const countInk = (data: Uint8ClampedArray): number => {
    let inked = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha === 0) continue;
      const luma = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      if ((paper - luma) * alpha <= 0) continue;
      inked += 1;
    }
    return inked;
  };

  const sourceInk = countInk(original);
  const exportedInk = countInk(actual);
  if (exportedInk === 0 || exportedInk * minInkRatio < sourceInk) {
    return {
      ok: false,
      reason: 'export-blank',
      detail: `${exportedInk} inked pixels against the source's ${sourceInk} of ${sourceImage.width}x${sourceImage.height}`,
    };
  }

  let changedChannels = 0;
  for (let index = 0; index < original.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(original[index + channel] - actual[index + channel]) > tolerance) changedChannels += 1;
    }
  }
  return changedChannels < threshold ? { ok: true } : { ok: false, reason: 'pixels-differ' };
}

/**
 * Runs the in-browser oracle and fails the test with a reason that names the format, and
 * attaches the bytes it compared so the failure is diagnosable from the report.
 */
export async function verifyExportPixelsInBrowser(
  page: Page,
  format: ExportFormat,
  file: Buffer,
  sourceDataUrl: string,
  threshold: number,
  testInfo: TestInfo
): Promise<void> {
  const payload = exportPixelPayload(sourceDataUrl, file.toString('base64'), format.extension, threshold);
  const comparison = await page.evaluate<PixelComparisonResult, ExportPixelPayload>(compareExportToSource, payload);
  if (!comparison.ok) {
    // The bytes the comparison actually ran on, so the failure can be diagnosed from
    // the report instead of reconstructed.
    await testInfo.attach(`${format.label}-pixel-comparison-failed`, {
      body: file,
      contentType: mimeType(format.extension),
    });
  }
  expect(
    comparison.ok,
    comparison.ok ? '' : pixelComparisonFailureMessage(format.label, comparison.reason, comparison.detail)
  ).toBe(true);
}

/** What a container verifier is given: the format it must name in its failures, and the source. */
export interface ExportByteVerification {
  label: string;
  /**
   * The canvas the export was encoded from, as a data URL. Only the formats whose raster a
   * decoder can reach use it; the PSD's pixels live in a layer structure sharp cannot read
   * (measured: `sharp` answers `Input buffer contains unsupported image format` for a real
   * 68,406-byte export), so its verifier checks that structure instead.
   */
  sourceDataUrl: string;
}

export type ExportByteVerifier = (file: Buffer, context: ExportByteVerification) => Promise<void>;

/** Byte-order marks a TIFF may carry. Both are legal; anything else is not a TIFF. */
const TIFF_BYTE_ORDER_MARKS = [Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.from([0x4d, 0x4d, 0x00, 0x2a])];

/**
 * Fewer entries than this and the directory cannot describe a decodable image. The
 * exporter writes 17 (measured on a real 1,921,000-byte TIFF); the floor only has to
 * separate "an image" from "an empty file that happens to start with the right four bytes".
 */
const TIFF_MINIMUM_IFD_ENTRIES = 5;

/** The tags without which an IFD does not describe a raster. A real export carries all four. */
const TIFF_IMAGE_TAGS: Array<[string, number]> = [
  ['ImageWidth', 0x0100],
  ['ImageLength', 0x0101],
  ['SamplesPerPixel', 0x0115],
  ['StripByteCounts', 0x0117],
];

const PSD_SIGNATURE = '8BPS';
const PSD_VERSION = 1;

/**
 * The drawn document is a bedrock blank layer plus the stroke layer the draw tool adds, so
 * a PSD that has lost either of them has lost the drawing. A real export declares exactly
 * two (measured).
 */
const PSD_MINIMUM_LAYERS = 2;

/**
 * Name the draw tool gives the stroke layer. `createLayerSource` in
 * `src/contexts/layer-utils.ts` names a layer `<source> <maxOrder>`, and this is the
 * second layer of the workspace document. A real export's layer table reads
 * `["Blank 1", "draw 2"]` (measured), and only the name check can tell "the layers were
 * written" from "the right layers were written".
 */
const PSD_DRAWING_LAYER_NAME = 'draw 2';

function containerFailure(label: string, detail: string): Error {
  return new Error(`${label}: ${detail}`);
}

function decodeDataUrl(label: string, dataUrl: string): Buffer {
  const marker = dataUrl.indexOf(',');
  if (marker === -1) throw containerFailure(label, 'the source canvas data URL has no base64 payload');
  return Buffer.from(dataUrl.slice(marker + 1), 'base64');
}

interface VisibleInk {
  width: number;
  height: number;
  ink: number;
}

/**
 * Counts a decodable image's inked pixels, by `measureInk`'s own rule.
 *
 * There is deliberately no second definition of "this image carries a mark" in this
 * repository: `readExportGeometry` already rejects a blank export by the `null`
 * `measureInk` returns, and this is the same predicate applied to a format the browser
 * cannot decode. `pixelCount` is the count, so both sides of the comparison below are
 * counted the same way.
 */
async function measureVisibleInk(file: Buffer, subject: string, label: string): Promise<VisibleInk> {
  let profile: Awaited<ReturnType<typeof measureInk>>;
  let metadata: { width?: number; height?: number };
  try {
    metadata = await sharp(file).metadata();
    profile = await measureInk(file);
  } catch (error) {
    throw containerFailure(label, `${subject} could not be decoded as an image (${(error as Error).message})`);
  }
  const { width, height } = metadata;
  if (width === undefined || height === undefined) {
    throw containerFailure(label, `${subject} decoded without reporting its dimensions`);
  }
  return { width, height, ink: profile?.pixelCount ?? 0 };
}

/**
 * The Node-side form of the `export-blank` oracle: the export must decode to the source's
 * dimensions and must carry the drawing. A TIFF of blank canvas, or of the wrong size, is
 * structurally perfect and fails here.
 */
async function assertExportCarriesDrawing(
  label: string,
  file: Buffer,
  sourceDataUrl: string,
  subject: string
): Promise<void> {
  const source = await measureVisibleInk(decodeDataUrl(label, sourceDataUrl), 'the source canvas', label);
  const exported = await measureVisibleInk(file, subject, label);
  if (exported.width !== source.width || exported.height !== source.height) {
    throw containerFailure(
      label,
      `${subject} decodes to ${exported.width}x${exported.height}, not the source canvas's ${source.width}x${source.height}`
    );
  }
  if (exported.ink === 0 || exported.ink * MIN_EXPORT_INK_RATIO < source.ink) {
    throw containerFailure(
      label,
      `${subject} carries ${exported.ink} inked pixels against the source's ${source.ink} of ${source.width}x${source.height}`
    );
  }
}

/**
 * Parses a TIFF far enough to know it describes an image, then decodes the raster and
 * applies the same drawing oracle the browser-side formats get.
 *
 * The header walk is what a byte-length floor could never reach: the exporter's
 * `comparePixels: false` used to exempt TIFF from every check, so an all-white
 * 1,921,000-byte TIFF passed, and so did a file with the right extension and no IFD at all.
 */
async function verifyTiffExport(file: Buffer, { label, sourceDataUrl }: ExportByteVerification): Promise<void> {
  const mark = file.subarray(0, 4);
  if (file.length < 8 || !TIFF_BYTE_ORDER_MARKS.some((candidate) => candidate.equals(mark))) {
    throw containerFailure(
      label,
      `is not a TIFF: expected the II*\\0 or MM\\0* byte-order mark, read ${mark.toString('hex') || '<empty>'}`
    );
  }
  const littleEndian = mark[0] === 0x49;
  const u16 = (offset: number) => (littleEndian ? file.readUInt16LE(offset) : file.readUInt16BE(offset));
  const u32 = (offset: number) => (littleEndian ? file.readUInt32LE(offset) : file.readUInt32BE(offset));

  const ifdOffset = u32(4);
  if (ifdOffset < 8 || ifdOffset + 2 > file.length) {
    throw containerFailure(label, `declares its first IFD at byte ${ifdOffset}, outside the ${file.length}-byte file`);
  }
  const entryCount = u16(ifdOffset);
  if (entryCount < TIFF_MINIMUM_IFD_ENTRIES) {
    throw containerFailure(
      label,
      `declares ${entryCount} IFD entries, fewer than the ${TIFF_MINIMUM_IFD_ENTRIES} a decodable image needs`
    );
  }
  if (ifdOffset + 2 + entryCount * 12 + 4 > file.length) {
    throw containerFailure(
      label,
      `declares ${entryCount} IFD entries, which do not fit in the ${file.length}-byte file`
    );
  }
  const declared = new Set<number>();
  for (let index = 0; index < entryCount; index += 1) {
    declared.add(u16(ifdOffset + 2 + index * 12));
  }
  const missing = TIFF_IMAGE_TAGS.filter(([, tag]) => !declared.has(tag)).map(([name]) => name);
  if (missing.length > 0) {
    throw containerFailure(label, `its IFD is missing the ${missing.join(', ')} tag`);
  }

  await assertExportCarriesDrawing(label, file, sourceDataUrl, 'the TIFF raster');
}

interface PsdLayerRecord {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  channelLengths: number[];
}

/**
 * Walks the layer records of the layer-info section.
 *
 * A record is 34 bytes plus six per channel plus 12, and the name sits inside its extra data
 * behind two length-prefixed blocks — so a record's own size cannot be read off a fixed
 * stride, and a corrupt length has to be rejected rather than walked off the end of the
 * buffer. Every step is bounds-checked against the file for that reason.
 */
function readPsdLayerRecords(file: Buffer, firstRecordAt: number, count: number, label: string): PsdLayerRecord[] {
  const records: PsdLayerRecord[] = [];
  let at = firstRecordAt;
  for (let index = 0; index < count; index += 1) {
    if (at + 18 > file.length) {
      throw containerFailure(
        label,
        `layer record ${index} starts at byte ${at}, past the end of the ${file.length}-byte file`
      );
    }
    const channelCount = file.readUInt16BE(at + 16);
    const channelsAt = at + 18;
    const extraLengthAt = channelsAt + channelCount * 6 + 12;
    if (extraLengthAt + 4 > file.length) {
      throw containerFailure(
        label,
        `layer record ${index} declares ${channelCount} channels, which do not fit in the file`
      );
    }
    const channelLengths: number[] = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      channelLengths.push(file.readUInt32BE(channelsAt + channel * 6 + 2));
    }
    const extraAt = extraLengthAt + 4;
    const extraLength = file.readUInt32BE(extraLengthAt);
    if (extraAt + extraLength > file.length) {
      throw containerFailure(
        label,
        `layer record ${index} declares ${extraLength} bytes of extra data, past the end of the ${file.length}-byte file`
      );
    }
    const maskLength = file.readUInt32BE(extraAt);
    const nameLengthAt = extraAt + 8 + maskLength + file.readUInt32BE(extraAt + 4 + maskLength);
    if (nameLengthAt + 1 > file.length) {
      throw containerFailure(label, `layer record ${index} is truncated inside its extra data`);
    }
    const nameLength = file[nameLengthAt];
    if (nameLengthAt + 1 + nameLength > file.length) {
      throw containerFailure(label, `layer record ${index} declares a ${nameLength}-byte name that runs past the file`);
    }
    records.push({
      name: file.subarray(nameLengthAt + 1, nameLengthAt + 1 + nameLength).toString('utf8'),
      top: file.readInt32BE(at),
      left: file.readInt32BE(at + 4),
      bottom: file.readInt32BE(at + 8),
      right: file.readInt32BE(at + 12),
      channelLengths,
    });
    at = extraAt + extraLength;
  }
  return records;
}

/**
 * Parses a PSD far enough to know it carries the document, not just a header.
 *
 * Two passes, because a PSD's structure and its pixels are separate claims. The first reads
 * the bytes directly — the signature (which is also the byte order: every multi-byte field
 * is big-endian), a real layer and mask section, at least the two layers the drawn document
 * has, and the stroke layer by name, inside the document, with pixels in it. The second
 * decodes the layer rasters AND the flat composite and applies the same ink oracle the
 * browser-decoded formats get, through `measureInk`, so a PSD whose layers are present and
 * named but blank is rejected too — and so is one whose layers hold the drawing while the
 * composite a reader renders first is empty.
 *
 * A PSD with a broken layer table fails the signature or the section length, a PSD with its
 * layers flattened away fails the count, a PSD with the layers renamed fails the name check,
 * a PSD whose layers are named but empty fails the last two, and a PSD whose composite is
 * blank or absent fails the oracle itself.
 */
async function verifyPsdExport(file: Buffer, { label, sourceDataUrl }: ExportByteVerification): Promise<void> {
  const requireBytes = (bytes: number, what: string): void => {
    if (file.length < bytes) {
      throw containerFailure(label, `is ${file.length} bytes, too short to hold ${what}`);
    }
  };
  requireBytes(26, 'a PSD header');
  const signature = file.subarray(0, 4).toString('latin1');
  if (signature !== PSD_SIGNATURE) {
    throw containerFailure(
      label,
      `does not start with the ${PSD_SIGNATURE} signature (read ${signature || '<empty>'})`
    );
  }
  const version = file.readUInt16BE(4);
  if (version !== PSD_VERSION) {
    throw containerFailure(label, `declares PSD version ${version}, not ${PSD_VERSION}`);
  }
  const channels = file.readUInt16BE(12);
  if (channels < 1) {
    throw containerFailure(label, `declares ${channels} channels`);
  }
  const height = file.readUInt32BE(14);
  const width = file.readUInt32BE(18);
  if (width < 1 || height < 1) {
    throw containerFailure(label, `declares a ${width}x${height} document`);
  }

  const resourcesAt = 30 + file.readUInt32BE(26);
  requireBytes(resourcesAt + 4, 'an image resource length');
  const layerMaskAt = resourcesAt + 4 + file.readUInt32BE(resourcesAt);
  requireBytes(layerMaskAt + 4, 'a layer and mask section length');
  const layerMaskLength = file.readUInt32BE(layerMaskAt);
  if (layerMaskLength === 0) {
    throw containerFailure(label, 'carries no layer and mask section');
  }
  requireBytes(layerMaskAt + 4 + layerMaskLength, 'the layer and mask section it declares');
  const layerInfoAt = layerMaskAt + 4;
  requireBytes(layerInfoAt + 6, 'a layer count');
  const layerCount = Math.abs(file.readInt16BE(layerInfoAt + 4));
  if (layerCount < PSD_MINIMUM_LAYERS) {
    throw containerFailure(
      label,
      `declares ${layerCount} layers, fewer than the ${PSD_MINIMUM_LAYERS} the drawn document has`
    );
  }

  const layers = readPsdLayerRecords(file, layerInfoAt + 6, layerCount, label);
  const drawing = layers.find((layer) => layer.name === PSD_DRAWING_LAYER_NAME);
  if (!drawing) {
    throw containerFailure(
      label,
      `has no layer named ${JSON.stringify(PSD_DRAWING_LAYER_NAME)}; its layers are ${layers
        .map((layer) => JSON.stringify(layer.name))
        .join(', ')}`
    );
  }
  const layerWidth = drawing.right - drawing.left;
  const layerHeight = drawing.bottom - drawing.top;
  if (layerWidth <= 0 || layerHeight <= 0) {
    throw containerFailure(
      label,
      `layer ${JSON.stringify(PSD_DRAWING_LAYER_NAME)} has a degenerate ${layerWidth}x${layerHeight} rectangle`
    );
  }
  if (drawing.left < 0 || drawing.top < 0 || drawing.right > width || drawing.bottom > height) {
    throw containerFailure(
      label,
      `layer ${JSON.stringify(PSD_DRAWING_LAYER_NAME)} spans (${drawing.left},${drawing.top})-(${drawing.right},${drawing.bottom}), outside the ${width}x${height} document`
    );
  }
  if (drawing.channelLengths.length === 0 || drawing.channelLengths.every((length) => length === 0)) {
    throw containerFailure(label, `layer ${JSON.stringify(PSD_DRAWING_LAYER_NAME)} carries no channel image data`);
  }

  await assertPsdCarriesDrawing(label, file, sourceDataUrl);
}

/**
 * `ag-psd` builds its `ImageData` through a canvas it asks the host for, and there is no
 * canvas in a Node test worker. It is given one here, once and for the whole process: on the
 * READ path `ag-psd` only ever calls `createImageData`, and the result is consumed as
 * `{width, height, data}` — which is exactly `ImageDataResult`, so the decoded rasters go
 * straight into `measureInk` and there is still only ONE definition of what counts as ink.
 */
let psdCanvasInitialised = false;

function initializePsdCanvas(): void {
  if (psdCanvasInitialised) return;
  initializeCanvas(
    // Never called on the read path — `createImageData` below is what gets used — but
    // `initializeCanvas` insists on an `HTMLCanvasElement`, so the shim is cast to the
    // declared factory type rather than widening ag-psd's own.
    ((width: number, height: number) => ({ width, height }) as unknown as HTMLCanvasElement) as (
      width: number,
      height: number
    ) => HTMLCanvasElement,
    (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb' as const,
    })
  );
  psdCanvasInitialised = true;
}

interface DecodedPsdLayer {
  name: string;
  imageData: { width: number; height: number; data: Uint8ClampedArray } | undefined;
}

/**
 * The drawing oracle, applied to a PSD's layers AND to its flat composite.
 *
 * Two claims, and the composite is the one that used to be missing. The layer rasters prove the
 * file is a layered document; the composite proves it is a picture of THIS document. The
 * exporter writes the composite itself — `writePsd({ ...size, canvas, children }, ...)` in
 * `src/contexts/psd-utils.ts`, where `canvas` is the flattened document — so the two are
 * independent claims about the same bytes, and a PSD can satisfy one while failing the other.
 *
 * Reading only the layers accepts a PSD whose layers hold the drawing and whose composite is
 * blank, which is the same false green one level down from the guard's own: every check above
 * passes, the layer table is structurally perfect, and the file opens as an empty image in
 * anything that renders the composite. The composite is what Photoshop and every other reader
 * shows first, so it is the one that has to carry the drawing.
 */
async function assertPsdCarriesDrawing(label: string, file: Buffer, sourceDataUrl: string): Promise<void> {
  initializePsdCanvas();
  let decoded: {
    width: number;
    height: number;
    imageData?: { width: number; height: number; data: Uint8ClampedArray };
    children?: DecodedPsdLayer[];
  };
  try {
    decoded = readPsd(new Uint8Array(file), {
      useImageData: true,
      skipCompositeImageData: false,
    }) as unknown as typeof decoded;
  } catch (error) {
    throw containerFailure(label, `its layers could not be decoded (${(error as Error).message})`);
  }
  const layers = decoded.children ?? [];
  const rasters = layers.filter(
    (layer): layer is DecodedPsdLayer & { imageData: NonNullable<DecodedPsdLayer['imageData']> } =>
      Boolean(layer.imageData)
  );
  if (rasters.length !== layers.length) {
    throw containerFailure(
      label,
      `${layers.length - rasters.length} of its ${layers.length} layers carry no decoded raster`
    );
  }

  // The document size, so a PSD that declares the right header but decodes to something
  // else is caught the same way a TIFF of the wrong size is.
  const source = await measureVisibleInk(decodeDataUrl(label, sourceDataUrl), 'the source canvas', label);
  if (decoded.width !== source.width || decoded.height !== source.height) {
    throw containerFailure(
      label,
      `decodes to ${decoded.width}x${decoded.height}, not the source canvas's ${source.width}x${source.height}`
    );
  }

  let inked = 0;
  for (const layer of rasters) {
    const profile = await measureInk(layer.imageData);
    inked += profile?.pixelCount ?? 0;
  }
  if (inked === 0 || inked * MIN_EXPORT_INK_RATIO < source.ink) {
    throw containerFailure(
      label,
      `its layers carry ${inked} inked pixels against the source's ${source.ink} of ${source.width}x${source.height}`
    );
  }

  // The flat composite, which is the document a reader renders before it touches a layer. A PSD
  // carrying no composite at all is rejected rather than waved through, because the layers
  // passing above is then the only evidence there is and it is the wrong evidence.
  const composite = decoded.imageData;
  if (!composite) {
    throw containerFailure(label, 'carries no flat composite, so there is no picture of the document to open');
  }
  const composited = (await measureInk(composite))?.pixelCount ?? 0;
  if (composited === 0 || composited * MIN_EXPORT_INK_RATIO < source.ink) {
    throw containerFailure(
      label,
      `its flat composite carries ${composited} inked pixels against the source's ${source.ink} of ${source.width}x${source.height}`
    );
  }
}

/**
 * The container verifiers, keyed by extension.
 *
 * Null-prototype because it is read by a string that comes from the format table, and a
 * key like `'constructor'` must not resolve to something inherited.
 */
export const exportByteVerifiers: Record<string, ExportByteVerifier> = Object.assign(
  Object.create(null) as Record<string, ExportByteVerifier>,
  {
    '.tiff': verifyTiffExport,
    '.psd': verifyPsdExport,
  }
);

/**
 * Verifies a format the browser cannot decode, by dispatching to its registered verifier.
 * Throws rather than skipping, so a format marked `container` with no verifier fails the
 * run instead of quietly reverting to the byte-length floor this replaced.
 */
export async function verifyExportContainer(format: ExportFormat, file: Buffer, sourceDataUrl: string): Promise<void> {
  const verifier = exportByteVerifiers[format.extension];
  if (!verifier) {
    throw containerFailure(format.label, `no container verifier is registered for ${format.extension}`);
  }
  await verifier(file, { label: format.label, sourceDataUrl });
}

export async function exportAndVerify(
  page: Page,
  format: ExportFormat,
  sourceDataUrl: string,
  downloadDirectory: string,
  testInfo: TestInfo
): Promise<string> {
  await openSaveDialog(page);
  await fillSaveDialog(page, 'drawing', format.label);

  const download = await submitSaveDialogForDownload(page, format);

  const target = path.join(downloadDirectory, path.basename(download.suggestedFilename()));
  await download.saveAs(target);
  await expectSaveDialogClosed(page);

  const file = await readFile(target);
  expect(file.byteLength, `${format.label} file should not be empty`).toBeGreaterThan(100);

  if (format.verification === 'container') {
    await verifyExportContainer(format, file, sourceDataUrl);
  } else {
    await verifyExportPixelsInBrowser(page, format, file, sourceDataUrl, CHANGED_CHANNEL_THRESHOLD_GENERAL, testInfo);
  }

  return target;
}

/**
 * The icon's stroke, in DOCUMENT pixels of the 256x256 icon document.
 *
 * It used to be in CANVAS-BOX offsets, which is a different thing: the canvas box is
 * 974x583 at a 1280x720 window while the icon document is 256x256, and the app's own
 * published fit is `scale = 2.27734375, offsetX = 195.5, offsetY = 0`. A box offset of 60
 * is therefore document `x = (60 - 195.5) / 2.27734375 = -59.50`, and one of 196 is
 * `x = +0.22` - the whole stroke sat 59.5 document pixels to the LEFT of the document's
 * left edge, and the 256x256 export it produced carried 63 inked pixels instead of 1,446.
 *
 * Read as document points and mapped through `documentToCanvasOffset` - the same
 * conversion `setupExportTest` applies to `EXPORT_LINE_START`/`EXPORT_LINE_END` - the same
 * numbers describe a stroke that is on the icon, and the source canvas then carries 1,446
 * inked pixels. The ICO oracle compares the export against that source, so the two sides
 * agree either way; only the document-space reading makes the mark mean anything.
 */
export const ICON_STROKE = { startX: 60, centerY: 128, endX: 196, steps: 10 } as const;

/** The document `setupIcoTest` opens, read from the dialog rather than assumed. */
const ICON_DOCUMENT_SIZE = { width: 256, height: 256 } as const;

export async function setupIcoTest(page: Page): Promise<string> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('header-file-menu-button').click();
  // `File > New` asks before discarding a document that has unsaved changes, and
  // `src/App.tsx` seeds a blank document on boot, so `hasUnsavedChanges` is
  // already true on a freshly loaded page and the prompt is shown from the very
  // first click.
  //
  // That prompt used to be a native `confirm()` and needed `page.once('dialog', …)`
  // here. It is now the app's own modal (`src/components/ConfirmDialog`), so answering
  // it is an ordinary click — and a STRONGER pin than the handler was: `acceptDiscardPrompt`
  // waits for the prompt to appear before answering it, so this helper cannot hang on the
  // first fill because New was declined, and it fails with a message naming the prompt
  // when the menu item itself is broken.
  //
  // No native dialog handler is installed here, deliberately. The scoping in the `once`
  // this replaced existed so that an UNEXPECTED prompt would surface rather than be
  // swallowed, and that intent is kept by not handling dialogs at all: Playwright
  // auto-dismisses an unhandled `confirm()`, which the app reads as "declined", so a
  // surprise native prompt on this path cannot be accepted away by anything and stops the
  // flow at the very next step instead. A blanket `page.on('dialog', …)` in a fixture or
  // in `global-setup.ts` is the thing that would swallow it, and it is still not done.
  // (One native prompt does still exist — the PSD import-limitations question at
  // `src/hooks/useApp.ts:87` — and no export spec reaches it, because `verifyPsdInPhotopea`
  // hands its file to Photopea rather than to this app.)
  await page.getByTestId('header-file-new-button').click();
  await acceptDiscardPrompt(page);
  await page.getByTestId('new-image-width-input').fill(String(ICON_DOCUMENT_SIZE.width));
  await page.getByTestId('new-image-height-input').fill(String(ICON_DOCUMENT_SIZE.height));
  await page.getByTestId('new-image-dialog-submit-button').click();

  const iconCanvas = getWorkspaceCanvas(page);
  await expect(iconCanvas).toBeVisible();
  const iconBox = await iconCanvas.boundingBox();
  if (!iconBox) throw new Error('ICO canvas not found');
  // The document size, READ rather than assumed, for the same reason `setupExportTest`
  // reads it: `documentToCanvasOffset` divides by it, so a document opened at any other
  // size would put the stroke somewhere the app never looks.
  const documentSize = await iconCanvas.evaluate((element) => {
    const node = element as HTMLCanvasElement;
    return { width: node.width, height: node.height };
  });
  const start = documentToCanvasOffset(iconBox, ICON_STROKE.startX, ICON_STROKE.centerY, documentSize);
  const end = documentToCanvasOffset(iconBox, ICON_STROKE.endX, ICON_STROKE.centerY, documentSize);

  await clickToolButton(page, 'draw');
  await page.mouse.move(iconBox.x + start.x, iconBox.y + start.y);
  await page.mouse.down();
  await page.mouse.move(iconBox.x + end.x, iconBox.y + end.y, { steps: ICON_STROKE.steps });
  await page.mouse.up();
  // A clip derived from the MAPPED stroke, in PAGE coordinates for the same reason
  // `setupExportTest` says it is: the shared `CANVAS_REDRAW_CLIP` is a fixed region of a
  // 974x583 box and does not cover a stroke at box row 291, so waiting on it would poll
  // a region the stroke never touched and could report success without it having reached
  // the backing store.
  await waitForCanvasRedraw(page, iconBox, {
    clip: {
      x: iconBox.x + Math.floor(start.x) - 20,
      y: iconBox.y + Math.floor(start.y) - 20,
      width: Math.ceil(end.x - start.x) + 40,
      height: 40,
    },
  });

  return await iconCanvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
}

export async function exportIcoAndVerify(
  page: Page,
  sourceDataUrl: string,
  downloadDirectory: string,
  testInfo: TestInfo
): Promise<string> {
  await openSaveDialog(page);
  await fillSaveDialog(page, 'drawing-icon', 'ICO');
  const iconDownload = await submitSaveDialogForDownload(page, icoFormat);
  const iconTarget = path.join(downloadDirectory, path.basename(iconDownload.suggestedFilename()));
  await iconDownload.saveAs(iconTarget);
  // `exportAndVerify` proves the dialog unmounted before it compares pixels, and this
  // function does the same job for the ICO path, so the download alone must not be
  // taken as proof that the save completed and the dialog went with it.
  await expectSaveDialogClosed(page);

  const iconFile = await readFile(iconTarget);
  expect(iconFile.byteLength, 'ICO file should not be empty').toBeGreaterThan(100);
  await verifyExportPixelsInBrowser(page, icoFormat, iconFile, sourceDataUrl, CHANGED_CHANNEL_THRESHOLD_ICO, testInfo);

  return iconTarget;
}

export async function waitForPhotopeaReady(page: Page): Promise<void> {
  // Wait for editor canvas (>100x100)
  await page.waitForFunction(
    () => {
      const canvases = document.querySelectorAll('canvas');
      return Array.from(canvases).some((c) => c.width > 100 && c.height > 100);
    },
    undefined,
    { timeout: PHOTOPEA_READY_TIMEOUT_MS }
  );

  // Wait for internal API (best effort)
  await page
    .waitForFunction(
      () => {
        const photopeaWindow = window as Window & { pea?: unknown };
        return !!photopeaWindow.pea || !!document.querySelector('[data-name="app"]');
      },
      undefined,
      { timeout: 10_000 }
    )
    .catch(() => {
      // Canvas check is sufficient if API not exposed
    });
}

/** How long the uploaded document is given to appear in the Photopea editor. */
const PHOTOPEA_DOCUMENT_TIMEOUT_MS = 30_000;

/**
 * The document size recorded in a PSD's own header, or `null` when the bytes are not
 * a PSD. The offsets are the Adobe format's: a 4-byte `8BPS` signature, a 2-byte
 * version, six reserved bytes, a 2-byte channel count, then height and width as
 * big-endian uint32. `src/contexts/__tests__/psd-utils.stub.test.ts` builds its
 * fixtures the same way.
 */
function readPsdDocumentSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 22) return null;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0) !== 0x38425053) return null; // '8BPS'
  return { width: header.getUint32(18), height: header.getUint32(14) };
}

/**
 * Opens `psdPath` in Photopea and proves the document on screen is that file.
 *
 * ## Why the oracle is not `page.locator('body')`
 *
 * photopea.com is a third-party page, not ours. `'drawing'` is a common substring
 * there — menu chrome, an advertisement, a file name in a recent-files list — so a
 * whole-page substring match passes with nothing loaded at all, and it would go on
 * passing if the upload silently did nothing. Two properties of the uploaded file
 * are asserted instead:
 *
 * 1. an element whose **entire** text is the document name — an exact, whole-element
 *    match, so a label that merely contains the name cannot satisfy it. The name is
 *    derived from the path rather than from the name the export dialog was filled
 *    with, so a renamed export fails loudly;
 * 2. a canvas whose **backing store is exactly the width and height in the PSD
 *    header**, read from the file this function was handed. The expected size follows
 *    the document instead of being hard-coded here, and the same query style is the
 *    one `waitForPhotopeaReady` already relies on.
 *
 * **Check 2 is the load-bearing one, and check 1 is not.** An earlier version of this
 * comment claimed neither was reachable without the file having opened, which over-credited
 * check 1: `getByText` matches on text content regardless of visibility, and
 * `not.toHaveCount(0)` is a match-count assertion, so a HIDDEN recent-files row or a
 * pre-open filename field carrying the name satisfies it exactly as a visible one would.
 * Check 1 proves the name is *rendered somewhere*, not that the document is open — so the
 * guarantee it used to be described as giving ("verifying a file nobody opened") is not one
 * it gives on its own. Check 2 is what carries that: a backing store of exactly the
 * document's dimensions does not arise without the file having been parsed. Read the two as
 * one strong check and one weak corroboration — and note check 2 has the same visibility
 * blind spot, since it queries every canvas on the page including hidden ones, so neither
 * alone is a proof and the pair together is a strong prior. Making either visibility-aware is
 * a real improvement, and unverifiable while this spec is skipped, so it belongs with the
 * re-enable work below rather than in a change nobody can run.
 *
 * The file input is asserted to be **unique**. `.first()` was removed from that
 * locator: it caps the match set at one element, so `toHaveCount(1)` on the result
 * could only ever distinguish _zero_ from _one_, which is the opposite of the point.
 *
 * ## Why the PSD test in `photopea.spec.ts` is skipped
 *
 * Photopea loads its consent modal asynchronously *after* "Start using Photopea" and
 * before the editor is ready. The timing is non-deterministic — sometimes immediate,
 * sometimes five to ten seconds — and the file input is not interactable while the
 * modal is present, so the upload cannot be driven from the test side.
 *
 * Already tried and failed: a "Do not consent" button (sometimes present, sometimes
 * not), "Consent"/"Accept all" buttons (the modal arrives too late for them), several
 * wait strategies (`waitForSelector`, `waitForFunction`, polling), and driving
 * Photopea's iframe API directly, which runs into cross-origin restrictions and
 * Photopea's own initialisation sequence.
 *
 * Re-enable it by implementing one of the following in this function. The first is
 * the one that is now open: **`ag-psd@^31.0.2` is a root dependency of this
 * repository** (`package.json`), so the exported PSD can be read back and asserted
 * locally — dimensions, layer count, layer names — with no browser and no third party
 * at all. Earlier notes on this skip rested on there being no PSD library available;
 * that premise is no longer true. The remaining options are the Photopea API directly
 * once it stabilises, robust consent handling with retries, or a browser context with
 * pre-accepted cookies.
 */
export async function verifyPsdInPhotopea(page: Page, psdPath: string): Promise<void> {
  const documentSize = readPsdDocumentSize(await readFile(psdPath));
  if (!documentSize) {
    throw new Error(`Not a PSD: ${psdPath}`);
  }

  await page.goto('https://www.photopea.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: 'Start using Photopea' }).first().click();

  await waitForPhotopeaReady(page);

  const input = page.locator('input[type="file"]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles(psdPath);

  const expectedDocumentName = path.basename(psdPath, path.extname(psdPath));
  await expect(page.getByText(expectedDocumentName, { exact: true })).not.toHaveCount(0, {
    timeout: PHOTOPEA_DOCUMENT_TIMEOUT_MS,
  });

  await page.waitForFunction(
    ({ width, height }: { width: number; height: number }) =>
      Array.from(document.querySelectorAll('canvas')).some(
        (canvas) => canvas.width === width && canvas.height === height
      ),
    documentSize,
    { timeout: PHOTOPEA_DOCUMENT_TIMEOUT_MS }
  );
}
