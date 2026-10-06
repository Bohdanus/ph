import { expect, test, type Page } from './fixtures/extended-test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import {
  dominantRed,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  hasRedPixels,
  loadImageData,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  type BoundingBox,
  type CanvasPixelPredicate,
  type ClipOptions,
} from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import {
  fillSaveDialog,
  INTEGRATION_TEST_TIMEOUT_MS,
  openSaveDialog,
  submitSaveDialogForDownload,
  type ExportFormat,
} from './export/helpers';

/**
 * The committed fixture, relative to `testInfo.config.rootDir` (Playwright's
 * `testDir`, this repository's `e2e/`). `e2e/fixtures/README.md` records how the
 * pixels below are produced and how to re-derive them.
 */
const FIXTURE_PATH_FROM_ROOT = 'fixtures/split-half-red-blue.png';
/** 64x64: the image's pixel size becomes the opened document's size (src/hooks/useApp.ts:143-147). */
const FIXTURE_DOCUMENT_SIZE = 64;
/** Columns [0, 31] of the fixture: rgb(255, 0, 0), alpha 255. */
const FIXTURE_LEFT_RGB = { red: 255, green: 0, blue: 0 };
/** Columns [32, 63] of the fixture: rgb(0, 0, 255), alpha 255. */
const FIXTURE_RIGHT_RGB = { red: 0, green: 0, blue: 255 };

/**
 * Sampling radius, in image pixels, for the fixture's exact-colour reads. The
 * halves meet at the document's horizontal midpoint; every point asserted here is
 * at least a tenth of the document width away from it, and the measured captures
 * return the same values at radius 1 and radius 3, so the exact-value assertion is
 * not resting on a single pixel.
 */
const FIXTURE_SAMPLE_RADIUS = 2;

/** Relative positions inside the opened document, as fractions of its own width. */
const FIXTURE_LEFT_SAMPLE_X = 0.25;
const FIXTURE_LEFT_NEAR_SPLIT_X = 0.4;
const FIXTURE_RIGHT_NEAR_SPLIT_X = 0.6;
const FIXTURE_RIGHT_SAMPLE_X = 0.75;
/** Vertical centre, where the fixture is solid across the whole row. */
const FIXTURE_SAMPLE_Y = 0.5;

/**
 * Where the fixture's two halves meet, as a fraction of the document's width. The
 * fixture is a 64px image split at column 32, so the true value is exactly 0.5. The
 * band is a rasterisation allowance, not a tolerance on the claim: only the one or
 * two columns straddling the boundary are blended, and both edges of that boundary
 * still have to sit within 2% of the midpoint.
 */
const FIXTURE_SPLIT_BAND = { min: 0.48, max: 0.52 } as const;

/** `exportAndVerify`'s budget, reused because this spec is bound by the same encoders plus a reload. */
const ROUNDTRIP_TEST_TIMEOUT_MS = INTEGRATION_TEST_TIMEOUT_MS;

const PNG_FORMAT: ExportFormat = { label: 'PNG', extension: '.png', verification: 'browser-pixels' };

/** The stroke colour the round trip puts on the canvas and reads back. */
const STROKE_HEX = '#ff0000';

interface Rgb {
  red: number;
  green: number;
  blue: number;
}

function isExactly(actual: Rgb | null, expected: Rgb): boolean {
  return (
    actual !== null && actual.red === expected.red && actual.green === expected.green && actual.blue === expected.blue
  );
}

/**
 * Where an opened document's own pixels land inside the workspace canvas's CSS box.
 *
 * The canvas element is `h-full w-full object-contain` (src/components/Main/Main.tsx:177)
 * over a backing store resized to the document's own pixel size
 * (src/hooks/useApp.ts:62-64, reached from `setImageFromUpload`). A replaced element
 * with `object-contain` scales its content to fit and centres it, so the document is
 * scaled by `min(box.w / doc.w, box.h / doc.h)` and letterboxed on the slack axis.
 *
 * This is what makes the fixture's halves addressable at all. It is used to aim the
 * capture and the poll, not to decide what the pixels are: every read below is a
 * fraction of the captured rect, and `measureFixtureSplit` measures the colour change
 * from the pixels. So an error in this arithmetic can move where the reads are taken
 * but cannot invent a passing result - the exact values and the 0.5 split are the
 * claims, and neither is derived from this function.
 */
function documentContentRect(box: BoundingBox, documentSize: number): Required<ClipOptions> {
  const scale = Math.min(box.width / documentSize, box.height / documentSize);
  const width = documentSize * scale;
  const height = documentSize * scale;
  return {
    x: Math.round(box.x + (box.width - width) / 2),
    y: Math.round(box.y + (box.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Clips `rect` to whole device-independent pixels; `page.screenshot` needs integers. */
function integralClip(rect: Required<ClipOptions>): Required<ClipOptions> {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  return {
    x,
    y,
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

/** Reads the fixture's colour at a fractional position inside a capture of its content rect. */
async function sampleFixtureColor(capture: Buffer, fractionX: number, fractionY: number): Promise<Rgb | null> {
  const image = await loadImageData(capture);
  return getColorAtPoint(
    image,
    Math.round(image.width * fractionX),
    Math.round(image.height * fractionY),
    FIXTURE_SAMPLE_RADIUS
  );
}

/**
 * True once BOTH fixture halves are on the canvas at their exact RGB values. Polled
 * by `waitForCanvasPixels` so the assertion never races the repaint.
 */
const fixtureHalvesRendered: CanvasPixelPredicate = async (capture) => {
  return (
    isExactly(await sampleFixtureColor(capture, FIXTURE_LEFT_SAMPLE_X, FIXTURE_SAMPLE_Y), FIXTURE_LEFT_RGB) &&
    isExactly(await sampleFixtureColor(capture, FIXTURE_RIGHT_SAMPLE_X, FIXTURE_SAMPLE_Y), FIXTURE_RIGHT_RGB)
  );
};

/**
 * Where the two fixture halves meet, as a fraction of the capture's width, measured
 * from the pixels rather than from `documentContentRect`.
 *
 * The fixture changes colour at column 32 of 64, so this is the strongest thing the
 * open path can be asked for: a scale, a flip or a half-and-half mistake anywhere
 * between decoding the file and compositing it moves this number. It reads the exact
 * RGB values only, so a resampling-blended boundary column is simply not a match and
 * the two exact runs it returns bracket the real transition.
 *
 * It is deliberately not a check on where the document sits inside the canvas box. That
 * is `object-contain` layout, and a fractional read is invariant to it: the same test
 * passes whether the document is letterboxed or fills the box, because a uniform scale
 * of a 50/50 split is still a 50/50 split. Asserting the letterbox here would pin CSS
 * the suite does not otherwise cover, and a margin probe was tried and removed - it
 * passed for the wrong reason as soon as the margin width was computed rather than
 * assumed.
 */
async function measureFixtureSplit(capture: Buffer): Promise<number> {
  const image = await loadImageData(capture);
  const row = Math.round(image.height * FIXTURE_SAMPLE_Y);
  let lastLeft = -1;
  let firstRight = -1;
  for (let x = 0; x < image.width; x += 1) {
    const color = await getColorAtPoint(image, x, row, 0);
    if (isExactly(color, FIXTURE_LEFT_RGB)) {
      lastLeft = x;
    } else if (isExactly(color, FIXTURE_RIGHT_RGB) && firstRight === -1) {
      firstRight = x;
    }
  }
  if (lastLeft === -1 || firstRight === -1) {
    // Both halves are already asserted exactly elsewhere; reaching here means the
    // scan's single-pixel reads disagree with the sampled ones, which is a defect in
    // the measurement rather than in the render.
    throw new Error(
      `split scan found no exact runs: lastLeft=${lastLeft}, firstRight=${firstRight} in ${image.width}x${image.height}`
    );
  }
  return (lastLeft + firstRight) / 2 / image.width;
}

/** The dominant red-dominant colour of a capture, asserted to exist before it is compared. */
async function requireDominantRed(capture: Buffer, label: string) {
  const color = await dominantRed(capture);
  expect(color, `${label}: expected a red-dominant stroke on the canvas`).not.toBeNull();
  return color!;
}

/**
 * Opens `filePath` through the real `File > Open` path.
 *
 * Two things have to be true before the file can be handed over, and neither is
 * optional:
 *
 * - `openLoadImageDialog` stores a resolver and THEN clicks the hidden input
 *   (src/contexts/useFile.tsx:101-107). The input's `change` handler resolves that
 *   promise (src/contexts/useFile.tsx:78-81), and it is the promise's consumer that
 *   calls `setImageFromUpload` (src/components/DesktopHeader/DesktopHeader.tsx:250-251).
 *   Setting the input's files with nobody waiting therefore loads the file and throws
 *   the result away, so the button click is part of the mechanism, not a convenience.
 * - The menu item asks before discarding the current document, and `src/App.tsx:38`
 *   seeds a blank document on boot, so the prompt is shown on the very first click of
 *   a fresh page — and on the click after the `page.reload()` below, for the same
 *   reason. It is answered with `acceptDiscardPrompt`, which WAITS for the prompt
 *   before answering it. The `page.once('dialog')` this used to install was not
 *   equivalent: Playwright auto-dismisses a dialog nobody is listening for, so a
 *   handler that never fired and a guard that declined looked identical to the line
 *   after it, and this file's claims all sit downstream of that.
 *
 * The answer lands BEFORE the file chooser is awaited, and that ordering is the
 * mechanism: `openLoadImageDialog` is only reached once the guard resolves
 * (`confirmDiscard` at src/components/DesktopHeader/DesktopHeader.tsx:249), so the
 * `filechooser` event registered first is the one the discard releases. Nothing opens a
 * native dialog on this path any more, which is why the `page.reload()` below needs no
 * handler for the app's `beforeunload` guard: with no `dialog` listener registered,
 * Playwright ACCEPTS a `beforeunload` dialog and dismisses every other type
 * (`playwright-core/lib/coreBundle.js`, `DialogManager`'s no-listener branch), so the
 * navigation proceeds. Installing a handler inverts that — `dismiss()` on a `beforeunload`
 * is what refuses the navigation, which is the mechanism `document-dialogs.spec.ts` uses
 * to prove the unload prompt fires at all.
 *
 * The file then arrives through Playwright's `filechooser` event, which is what the
 * programmatic `.click()` on a `display:none` input raises. Verified on this host: the
 * event fires, and `setInputFiles` on the same input is an equivalent second route.
 */
async function openDocumentViaFileMenu(page: Page, filePath: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-open-button').click();
  await acceptDiscardPrompt(page);
  const fileChooser = await chooser;
  await fileChooser.setFiles(filePath);
}

test.describe('File round trip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test("opening a file puts that file's own pixels on the canvas", async ({ page }, testInfo) => {
    test.setTimeout(ROUNDTRIP_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await openDocumentViaFileMenu(page, path.join(testInfo.config.rootDir, FIXTURE_PATH_FROM_ROOT));

    const content = integralClip(documentContentRect(box, FIXTURE_DOCUMENT_SIZE));
    await waitForCanvasPixels(page, content, fixtureHalvesRendered, {
      description: "the fixture's red and blue halves at their exact values",
    });

    const capture = await captureCanvasScreenshot(page, box, testInfo, 'file-roundtrip-opened', content);
    const image = await loadImageData(capture);
    expect(image.width, 'the content clip should be the whole opened document').toBe(content.width);
    expect(image.height, 'the content clip should be the whole opened document').toBe(content.height);

    // The document's own halves, at four positions that straddle the 32/64 split
    // without landing on it. Exact equality is the assertion: not "reddish", the
    // fixture's own bytes.
    expect(
      isExactly(await sampleFixtureColor(capture, FIXTURE_LEFT_SAMPLE_X, FIXTURE_SAMPLE_Y), FIXTURE_LEFT_RGB),
      'left quarter of the opened document should be exactly rgb(255, 0, 0)'
    ).toBe(true);
    expect(
      isExactly(await sampleFixtureColor(capture, FIXTURE_LEFT_NEAR_SPLIT_X, FIXTURE_SAMPLE_Y), FIXTURE_LEFT_RGB),
      '40% across the opened document should still be exactly rgb(255, 0, 0)'
    ).toBe(true);
    expect(
      isExactly(await sampleFixtureColor(capture, FIXTURE_RIGHT_NEAR_SPLIT_X, FIXTURE_SAMPLE_Y), FIXTURE_RIGHT_RGB),
      '60% across the opened document should already be exactly rgb(0, 0, 255)'
    ).toBe(true);
    expect(
      isExactly(await sampleFixtureColor(capture, FIXTURE_RIGHT_SAMPLE_X, FIXTURE_SAMPLE_Y), FIXTURE_RIGHT_RGB),
      'right quarter of the opened document should be exactly rgb(0, 0, 255)'
    ).toBe(true);

    const split = await measureFixtureSplit(capture);
    expect(
      split,
      `the colour change should sit at the document's midpoint; measured ${split.toFixed(4)} across`
    ).toBeGreaterThan(FIXTURE_SPLIT_BAND.min);
    expect(
      split,
      `the colour change should sit at the document's midpoint; measured ${split.toFixed(4)} across`
    ).toBeLessThan(FIXTURE_SPLIT_BAND.max);
  });

  test('a PNG this app saves re-imports to the same pixels', async ({ page }, testInfo) => {
    test.setTimeout(ROUNDTRIP_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await clickToolButton(page, 'draw');
    // verifySwatch asserts the store took the colour before the stroke is drawn with it.
    await setForegroundColor(page, STROKE_HEX, true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'the red stroke' });

    const beforeCapture = await captureCanvasScreenshot(page, box, testInfo, 'file-roundtrip-before-save');
    const before = await requireDominantRed(beforeCapture, 'before save');

    await openSaveDialog(page);
    await fillSaveDialog(page, 'roundtrip', PNG_FORMAT.label);

    /**
     * The locator the absence below is stated with, resolved POSITIVELY first, while the dialog
     * is still on screen.
     *
     * `SaveDialog` renders its title as an `<h2 id="save-dialog-title">`, and that `<h2>` is the
     * dialog's `aria-labelledby` target, so while the dialog is open this locator names exactly
     * one visible element. That is the whole reason the absence below is worth reading: it is
     * the SAME locator in the SAME test, one step earlier, in the state where the element
     * exists. A bare `toHaveCount(0)` on an unproven locator cannot tell "the dialog closed"
     * from "this app never mints that name" — reword the title, demote the `<h2>` to a `<div>`,
     * or drop the heading, and the absence keeps passing forever while the dialog stays on
     * screen. These two lines go red instead.
     *
     * Count before visibility, the way `e2e/accessibility.spec.ts` resolves every scan scope:
     * one element, and that element visible.
     */
    const saveDialogTitle = page.getByRole('heading', { name: 'Save File As...' });
    await expect(
      saveDialogTitle,
      'the open Save dialog is titled by a heading carrying this accessible name'
    ).toHaveCount(1);
    await expect(saveDialogTitle, 'and that heading is on screen, not merely in the DOM').toBeVisible();

    const download = await submitSaveDialogForDownload(page, PNG_FORMAT);
    const savedPath = path.join(testInfo.outputDir, path.basename(download.suggestedFilename()));
    await download.saveAs(savedPath);
    await expect(saveDialogTitle, 'the Save dialog unmounted once the download completed').toHaveCount(0);
    const savedBytes = await readFile(savedPath);
    expect(savedBytes.byteLength, 'the saved PNG should not be empty').toBeGreaterThan(100);

    // The control: reloading really does discard the document, so the pixels that
    // appear below came from the file and not from a canvas that was never cleared.
    // Nothing has to answer an unload prompt here, because this document is CLEAN: the
    // save above dispatched `hasUnsavedChanges: false` (`src/hooks/useApp.ts:70`), which is
    // the one path that makes the `beforeunload` guard silent, and the same reason `File >
    // New` would not prompt here. Were it dirty, this reload would still need no handler —
    // an unregistered `beforeunload` is accepted, so the navigation proceeds. The in-app
    // prompt is a different event and does need an answer, which is what
    // `openDocumentViaFileMenu` gives it below.
    await page.reload();
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    const reloadedCapture = await captureCanvasScreenshot(page, box, testInfo, 'file-roundtrip-after-reload');
    expect(await hasRedPixels(reloadedCapture), 'reloading should have discarded the drawn stroke').toBe(false);

    await openDocumentViaFileMenu(page, savedPath);
    const reopenedBox = await getWorkspaceCanvas(page).boundingBox();
    if (!reopenedBox) throw new Error('Canvas not found after reopening the saved file');
    await waitForCanvasPixels(page, canvasRedrawClip(reopenedBox), hasRedPixels, {
      description: 'the stroke carried back in by the saved file',
    });

    const afterCapture = await captureCanvasScreenshot(page, reopenedBox, testInfo, 'file-roundtrip-after-reopen');
    const after = await requireDominantRed(afterCapture, 'after reopening the saved file');
    expect(after, 'the stroke should come back in the colour it was drawn').toEqual({
      red: before.red,
      green: before.green,
      blue: before.blue,
      count: before.count,
    });
    expect(after.red, 'the reopened stroke should be the red that was drawn').toBeGreaterThan(180);
    expect(after.green, 'the reopened stroke should be the red that was drawn').toBeLessThan(100);
    expect(after.blue, 'the reopened stroke should be the red that was drawn').toBeLessThan(100);
  });

  test('the open input accepts every format loadDocumentFile can open', async ({ page }) => {
    test.setTimeout(ROUNDTRIP_TEST_TIMEOUT_MS);

    const input = page.getByTestId('file-open-input');
    await expect(input).toHaveCount(1);
    await expect(input).toHaveAttribute('type', 'file');
    const accept = (await input.getAttribute('accept')) ?? '';

    /**
     * Every extension `loadDocumentFile` (src/contexts/image-load-save-utils.ts:68-97)
     * can open, with the line of the branch that claims it. `image/*` in the table means
     * the branch matches on a MIME type or a magic signature rather than a suffix, so the
     * picker covers it through the wildcard rather than through a named extension.
     */
    const supported: ReadonlyArray<{ extension: string; branch: string; wildcardOnly: boolean }> = [
      {
        extension: '.psd',
        branch: 'image-load-save-utils.ts:70 (PSD, `8BPS` / image/vnd.adobe.photoshop)',
        wildcardOnly: false,
      },
      { extension: '.tif', branch: 'image-load-save-utils.ts:74 (TIFF, via isTiffFile)', wildcardOnly: false },
      { extension: '.tiff', branch: 'image-load-save-utils.ts:74 (TIFF, via isTiffFile)', wildcardOnly: false },
      { extension: '.bmp', branch: 'image-load-save-utils.ts:78 (BMP, via isBmpFile)', wildcardOnly: false },
      { extension: '.avif', branch: 'image-load-save-utils.ts:82 (AVIF, via isAvifFile)', wildcardOnly: false },
      { extension: '.ico', branch: 'image-load-save-utils.ts:86 (ICO, via isIcoFile)', wildcardOnly: false },
      { extension: '.gif', branch: 'image-load-save-utils.ts:90 (GIF, via isGifFile)', wildcardOnly: false },
      { extension: '.svg', branch: 'image-load-save-utils.ts:93 (SVG, via isSvgFile)', wildcardOnly: false },
      // The fallback at :96 reaches `loadImageFile`, which accepts anything whose type
      // starts with `image/`, or whose name matches BROWSER_IMAGE_EXTENSIONS
      // (image-load-save-utils.ts:7). Nothing in that list is named in `accept`, so the
      // picker reaches them through `image/*` alone - which is why it has to be there.
      {
        extension: '.png',
        branch: 'image-load-save-utils.ts:96 fallback + :7 BROWSER_IMAGE_EXTENSIONS',
        wildcardOnly: true,
      },
      {
        extension: '.jpg',
        branch: 'image-load-save-utils.ts:96 fallback + :7 BROWSER_IMAGE_EXTENSIONS',
        wildcardOnly: true,
      },
      {
        extension: '.jpeg',
        branch: 'image-load-save-utils.ts:96 fallback + :7 BROWSER_IMAGE_EXTENSIONS',
        wildcardOnly: true,
      },
      {
        extension: '.webp',
        branch: 'image-load-save-utils.ts:96 fallback + :7 BROWSER_IMAGE_EXTENSIONS',
        wildcardOnly: true,
      },
    ];

    // `accept` is a comma-separated list of exact extensions, MIME types and wildcards.
    const tokens = accept
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0);
    expect(tokens.length, `accept should be a non-empty list, got ${JSON.stringify(accept)}`).toBeGreaterThan(0);

    for (const { extension, branch, wildcardOnly } of supported) {
      if (wildcardOnly) {
        // Nothing in the fallback's suffix list is named in `accept`, so the picker
        // reaches these through the wildcard and only through the wildcard. A
        // picker that listed every exotic suffix but not `image/*` would hide the
        // formats most people actually open.
        expect(
          tokens,
          `${extension} is only reachable through a wildcard and ${branch} is the branch that opens it`
        ).toContain('image/*');
      } else {
        expect(tokens, `accept is missing ${extension}, which ${branch} can open`).toContain(extension);
      }
    }

    // The other direction: a suffix the picker offers that the app cannot open is a
    // filter that lies to the user. Every non-wildcard token must be claimed by a branch.
    const claimed = new Set(supported.map(({ extension }) => extension));
    for (const token of tokens) {
      if (token.includes('/')) continue;
      expect(claimed.has(token), `accept offers ${token}, which no loadDocumentFile branch opens`).toBe(true);
    }
  });
});
