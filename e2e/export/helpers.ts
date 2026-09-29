import { type Download, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_WIDTH,
  documentToCanvasOffset,
  drawLine,
  getWorkspaceCanvas,
  inkHeight,
  inkWidth,
  measureInk,
  waitForCanvasRedraw,
} from '../helpers/canvas-helpers';
import { clickToolButton } from '../helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from '../helpers/timeouts';

export interface ExportFormat {
  label: string;
  extension: string;
  comparePixels: boolean;
}

/**
 * Upper bound on differing colour channels tolerated when comparing an export
 * against the canvas it was encoded from. 50,000 channels is ~1.5% of the
 * 196,608 channels on a 256x256 image, which is wide enough to absorb lossy
 * re-encoding artifacts (chroma subsampling, dithering) without masking a
 * genuinely wrong or empty export.
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
  { label: 'PNG', extension: '.png', comparePixels: true },
  { label: 'JPEG', extension: '.jpeg', comparePixels: true },
  { label: 'WebP', extension: '.webp', comparePixels: true },
  { label: 'TIFF', extension: '.tiff', comparePixels: false },
  { label: 'BMP', extension: '.bmp', comparePixels: true },
  { label: 'GIF (static)', extension: '.gif', comparePixels: true },
  { label: 'AVIF', extension: '.avif', comparePixels: true },
  { label: 'SVG (flattened)', extension: '.svg', comparePixels: true },
  { label: 'Photoshop PSD (layers)', extension: '.psd', comparePixels: false },
];

export const icoFormat: ExportFormat = { label: 'ICO', extension: '.ico', comparePixels: true };

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
    inkWidth: inkWidth(profile),
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

export async function setupExportTest(
  page: Page,
  testInfo: TestInfo
): Promise<{
  box: { x: number; y: number; width: number; height: number };
  documentSize: { width: number; height: number };
  sourceDataUrl: string;
  downloadDirectory: string;
}> {
  const downloadDirectory = path.join(testInfo.outputDir, 'exports');
  await rm(downloadDirectory, { recursive: true, force: true });
  await mkdir(downloadDirectory, { recursive: true });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
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
 */
export type PixelComparisonFailure = 'context-unavailable' | 'pixels-differ';

export type PixelComparisonResult = { ok: true } | { ok: false; reason: PixelComparisonFailure };

const PIXEL_COMPARISON_FAILURE_MESSAGES: Record<PixelComparisonFailure, string> = {
  'context-unavailable': 'the browser provided no 2d canvas context to compare the export against',
  'pixels-differ': 'pixels differ too much from source',
};

function pixelComparisonFailureMessage(label: string, reason: PixelComparisonFailure): string {
  return `${label}: ${PIXEL_COMPARISON_FAILURE_MESSAGES[reason]}`;
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

  if (format.comparePixels) {
    const payload = {
      source: sourceDataUrl,
      exported: file.toString('base64'),
      mime: mimeType(format.extension),
      threshold: CHANGED_CHANNEL_THRESHOLD_GENERAL,
      tolerance: CHANNEL_DELTA_TOLERANCE,
    };
    const comparison = await page.evaluate<PixelComparisonResult, typeof payload>(
      async ({ source, exported, mime, threshold, tolerance }) => {
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
        let changedChannels = 0;
        for (let index = 0; index < original.length; index += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            if (Math.abs(original[index + channel] - actual[index + channel]) > tolerance) changedChannels += 1;
          }
        }
        return changedChannels < threshold ? { ok: true } : { ok: false, reason: 'pixels-differ' };
      },
      payload
    );
    if (!comparison.ok) {
      // The bytes the comparison actually ran on, so the failure can be diagnosed from
      // the report instead of reconstructed.
      await testInfo.attach(`${format.label}-pixel-comparison-failed`, {
        body: file,
        contentType: mimeType(format.extension),
      });
    }
    expect(comparison.ok, comparison.ok ? '' : pixelComparisonFailureMessage(format.label, comparison.reason)).toBe(
      true
    );
  }

  return target;
}

/** Stroke drawn across the new icon canvas, in offsets from its box origin. */
export const ICON_STROKE = { startX: 60, centerY: 128, endX: 196, steps: 10 } as const;

export async function setupIcoTest(page: Page): Promise<string> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('header-file-menu-button').click();
  // `File > New` in `src/components/DesktopHeader/DesktopHeader.tsx` asks
  // `confirm()` before discarding a document that has unsaved changes, and
  // `src/App.tsx` seeds a blank document on boot, so `hasUnsavedChanges` is
  // already true on a freshly loaded page and the prompt is shown from the very
  // first click. Playwright auto-dismisses dialogs that have no handler, which
  // the guard reads as "declined" — the New Image dialog would then never open
  // and this helper would hang on the first input. Accept the single prompt this
  // helper causes. `once` keeps the handler scoped to the one dialog: a global
  // accept in a fixture or in `global-setup.ts` would silently swallow every
  // unexpected `alert`/`confirm` in the suite, and those surfacing is a
  // load-bearing signal.
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByTestId('header-file-new-button').click();
  await page.getByTestId('new-image-width-input').fill('256');
  await page.getByTestId('new-image-height-input').fill('256');
  await page.getByTestId('new-image-dialog-submit-button').click();

  const iconCanvas = getWorkspaceCanvas(page);
  await expect(iconCanvas).toBeVisible();
  const iconBox = await iconCanvas.boundingBox();
  if (!iconBox) throw new Error('ICO canvas not found');
  await clickToolButton(page, 'draw');
  await page.mouse.move(iconBox.x + ICON_STROKE.startX, iconBox.y + ICON_STROKE.centerY);
  await page.mouse.down();
  await page.mouse.move(iconBox.x + ICON_STROKE.endX, iconBox.y + ICON_STROKE.centerY, { steps: ICON_STROKE.steps });
  await page.mouse.up();
  await waitForCanvasRedraw(page, iconBox);

  return await iconCanvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
}

export async function exportIcoAndVerify(
  page: Page,
  sourceDataUrl: string,
  downloadDirectory: string
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
  const iconPayload = {
    source: sourceDataUrl,
    exported: iconFile.toString('base64'),
    threshold: CHANGED_CHANNEL_THRESHOLD_ICO,
    tolerance: CHANNEL_DELTA_TOLERANCE,
  };
  const iconComparison = await page.evaluate<PixelComparisonResult, typeof iconPayload>(
    async ({ source, exported, threshold, tolerance }) => {
      const loadImage = (data: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Browser cannot decode ICO'));
          image.src = data;
        });
      const sourceImage = await loadImage(source);
      const iconImage = await loadImage(`data:image/x-icon;base64,${exported}`);
      const sourceCanvas = document.createElement('canvas');
      const iconCanvas = document.createElement('canvas');
      sourceCanvas.width = iconCanvas.width = sourceImage.width;
      sourceCanvas.height = iconCanvas.height = sourceImage.height;
      const sourceContext = sourceCanvas.getContext('2d');
      const iconContext = iconCanvas.getContext('2d');
      if (!sourceContext || !iconContext) return { ok: false, reason: 'context-unavailable' };
      sourceContext.drawImage(sourceImage, 0, 0);
      iconContext.drawImage(iconImage, 0, 0, sourceImage.width, sourceImage.height);
      const sourcePixels = sourceContext.getImageData(0, 0, sourceImage.width, sourceImage.height).data;
      const iconPixels = iconContext.getImageData(0, 0, sourceImage.width, sourceImage.height).data;
      let changedChannels = 0;
      for (let index = 0; index < sourcePixels.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          if (Math.abs(sourcePixels[index + channel] - iconPixels[index + channel]) > tolerance) changedChannels += 1;
        }
      }
      return changedChannels < threshold ? { ok: true } : { ok: false, reason: 'pixels-differ' };
    },
    iconPayload
  );
  expect(
    iconComparison.ok,
    iconComparison.ok ? '' : pixelComparisonFailureMessage(icoFormat.label, iconComparison.reason)
  ).toBe(true);

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
