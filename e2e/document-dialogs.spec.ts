import { expect, type Page, test, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  type BoundingBox,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  hasRedPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  loadImageData,
  type ImageDataResult,
  scanPixelsForBounds,
} from './helpers/canvas-helpers';
import { canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
/**
 * CROSS-MODULE COUPLING, and the only one of its kind in the suite: these six symbols
 * come from `e2e/export/helpers.ts`, which the `e2e/export` branch owns. This is the
 * only top-level spec that reaches across into `e2e/export/` for anything.
 *
 * The six are type `ExportFormat`, `exportFormats`, `fillSaveDialog`,
 * `INTEGRATION_TEST_TIMEOUT_MS`, `openSaveDialog` and `submitSaveDialogForDownload`.
 *
 * What it costs, precisely: nothing is restructured here, and nothing in that module
 * knows this file exists — so the price lands entirely on THIS file's compile. Rename,
 * move or reshape any of the six in `e2e/export/helpers.ts` and this import stops
 * resolving, which is a TypeScript error at the import (`npm run tsc`, `tsc -b`'s
 * `tsconfig.e2e.json`) and a Playwright transform error before any test body runs. So
 * the break is loud and early rather than a silently wrong assertion — but it IS a
 * compile break in a file whose owner has no way to see it, so when `e2e/export` moves
 * these helpers, the fix belongs in this import, not in that module.
 */
import {
  type ExportFormat,
  exportFormats,
  fillSaveDialog,
  INTEGRATION_TEST_TIMEOUT_MS,
  openSaveDialog,
  submitSaveDialogForDownload,
} from './export/helpers';

/**
 * A4 at 300 dpi, which is the default DPI, through the arithmetic in
 * `computePixelsFromPreset`: 210mm / 25.4 * 300 = 2480.3, 297mm / 25.4 * 300 = 3507.9,
 * each rounded.
 *
 * METRIC ON PURPOSE, and the narrower claim is the true one. `computePixelsFromPreset`
 * has TWO unit branches, not one: millimetres at `src/constants/imagePresets.ts:42-44`
 * and inches at `:45-47`. So this is not the only branch with a conversion in it — US
 * Letter, which the other test in this file uses, takes the inch branch and converts too.
 * What only a MILLIMETRE preset can reach is the extra step inside the mm branch:
 * `mmToPx` divides by `MM_PER_INCH` (`src/constants/imagePresets.ts:34-36`, constant at
 * `:1`) before multiplying by the DPI. Change that constant and this test fails, while
 * an inch-only test would still pass. That is the whole reason both presets are covered.
 */
const A4_AT_300_DPI = { width: '2480', height: '3508' };

/**
 * The size the app publishes for the current document. A different observable from
 * `documentSize` below, which reads the canvas element's backing store: this is the
 * `totalSize` the store holds and the `Footer` renders
 * (`src/components/Footer/Footer.tsx:8-16`), so it catches a document that was resized
 * on screen while the store still reports the old size.
 */
const dimensionsReadout = (page: Page) => page.locator('footer');

/**
 * The shared `openSaveDialog` only clicks; the two things the dialog's own callers in
 * `main` asserted live here instead, because the imported helper is also used by the two
 * save tests below and those own their preconditions.
 *
 * The File menu is a TOGGLE, so a menu left open by an earlier step would make the button
 * click CLOSE it and the item would never appear — which is why the closed state is
 * asserted rather than assumed. The `confirm()` guard that `openNewImageDialog` handles
 * is deliberately NOT armed here: `DesktopHeader` guards New and Open
 * (`src/components/DesktopHeader/DesktopHeader.tsx:188-189, 216-217`) and not Save, so a
 * dialog handler on this path would be an unconsumed `page.once` waiting to accept
 * something unrelated later in the test.
 */
async function openSaveDialogAndWait(page: Page): Promise<void> {
  const saveItem = page.getByTestId('header-file-save-button');
  await expect(saveItem, 'the File menu is closed before it is opened').toHaveCount(0);
  await openSaveDialog(page);
  await expect(page.getByTestId('save-dialog')).toBeVisible();
}

/**
 * A taller viewport, kept — on a re-derived reason. The comment this replaces named a
 * real need and described it in terms of a page fold and a capture API that no longer
 * behave that way, so both halves of its mechanism were false even though the bump itself
 * still turns out to be load-bearing.
 *
 * WHAT IS FALSE, and was measured rather than assumed. The old comment said the workspace
 * canvas element is 974x963 here and would be 974x840 at 1280x720 with "220px below the
 * fold". Every number in that is wrong:
 *
 *   - The WIDTH is 922, not 974. The suite runs the TWO-COLUMN desktop shell:
 *     `grid-cols-[auto_1fr_250px]` (`src/App.tsx:75`) with a 108px rail (6.75rem), so
 *     1280 - 108 - 250 = 922. 974 is the ONE-COLUMN width (rail 3.5rem = 56px), which
 *     nothing here selects.
 *   - There IS no fold. Measured at 1280x720: the element is 922x583 at page (108, 100)
 *     and `documentElement.scrollHeight` is 720, equal to `clientHeight` and to
 *     `innerHeight` — the page does not overflow at all. The left rail owns its own
 *     scrolling (`min-h-0 overflow-y-auto`, `src/components/SidebarLeft/SidebarLeft.tsx:459`),
 *     so the shell is exactly viewport-tall.
 *   - So the element is not "840 tall with 220 below the fold"; it is 583 tall and
 *     entirely on screen.
 *   - The clip-truncation mechanism is gone. `waitForCanvasPixels` reads through
 *     `page.screenshot` at `e2e/helpers/canvas-helpers.ts:531`, but behind `onScreenClip`
 *     at `:529`, which re-derives the clip every poll and SCROLLS the region into view;
 *     it is not a silent truncation at a fold. The `:380` this comment used to cite is
 *     inside an unrelated red-dominance predicate. Nothing about this file's captures goes
 *     near a fold.
 *
 * WHAT IS TRUE, and is the reason the bump stays: the taller viewport is what leaves bare
 * WORKSPACE BACKDROP above the letterboxed document, and `backdropRange` below can only
 * measure a backdrop where there is backdrop. That is a property of the document's aspect
 * against the ELEMENT's, not of the viewport or any capture API.
 *
 *   At 1280x1100 the element is 922x963, aspect 0.957. The 800x600 boot document is 1.333,
 *   so `object-fit: contain` is WIDTH-limited: it renders 922x691.5 centred, leaving about
 *   136 rows of bare element above it. The top 4% strip (38 rows) lands entirely in that
 *   bare region, which is exactly what the strip is for.
 *
 *   At 1280x720 the element is 922x583, aspect 1.581 — WIDER than the document's 1.333.
 *   The fit flips to HEIGHT-limited: the document renders 777x583 and fills the element's
 *   full height, so there is no bare strip anywhere and the top 4% is ON the document.
 *
 * Measured consequence, and it is a named assertion rather than a subtle one: with the
 * bump dropped, "the background opacity reaches the created document" fails at its
 * `onFill` precondition with 17894 of the strip matching the opaque fill, and the other
 * seven tests pass. So the bump is kept, `onFill` is what enforces it, and if a future
 * layout change takes the bare strip away again this file names that in one line.
 *
 * Nothing else derives a number from 1100: every locator is by test id, the centre sample
 * is the element's midpoint, and the deepest pointer-driven point is box y 450.
 */
test.use({
  viewport: { width: 1280, height: 1100 },
  // PINNED, and this is the fix for a guarantee that used to rest on nothing. The
  // workspace backdrop is the 20px checkerboard the canvas's parent div carries
  // (`chessboard-light` / `chessboard-dark`, chosen from the resolved theme at
  // `src/components/Main/Main.tsx:222`), and the theme resolves through
  // `src/contexts/ThemeContext.tsx:13-22`'s `prefers-color-scheme` fallback whenever
  // `localStorage` has no saved theme — which is every fresh Playwright context. So the
  // colour scheme decides whether the opacity test's direction holds at all, and under
  // dark it inverts. Playwright's own default is `light`, so this run was passing by an
  // inherited value that neither this file nor `playwright.config.ts` ever stated. Stated
  // now, and the opacity test additionally MEASURES the margin the direction depends on
  // rather than trusting the pin: a pinning mistake then fails as a named assertion, not
  // as six unexplained monotonicity failures.
  colorScheme: 'light',
});

/**
 * Per-test budget for the save-dialog tests. Each one drives a full draw, opens the save
 * dialog, encodes the document to JPEG through `canvas.toBlob`, waits for the resulting
 * download and then reads the bytes off disk. That is bound by encoder speed rather than
 * by any one awaited step, which is the same reason the export specs use this value; the
 * quality test does it twice, so it carries the larger of the two budgets.
 */
const SAVE_DIALOG_TEST_TIMEOUT_MS = INTEGRATION_TEST_TIMEOUT_MS;

/**
 * Background colour used throughout: `#3366cc` is (51, 102, 204).
 *
 * A partly transparent background composites as
 * `opacity * colour + (1 - opacity) * backdrop`, so the ONLY thing that makes the opacity
 * assertions directional rather than exact is that the backdrop is above this colour in
 * EVERY channel. `#3366cc` being "below 255 in every channel" is not that condition and
 * never was: it is trivially true of half the RGB cube, and under the dark checkerboard
 * the same three numbers make the order invert.
 *
 * And the backdrop is not one colour to compare against. It is a 20px checkerboard
 * (`src/index.scss:126-137` light: `#fff` plus `#f3f3f3` gradients; `:139-150` dark: `#000`
 * plus `#121212` — the two rules are identical but for those two colours, and both pin
 * `background-size: 20px 20px`), so the composite reads whichever cell a sample lands on.
 * The real precondition is therefore per channel, `backdrop[channel] > colour[channel]`,
 * measured on the real pixels — and the margin that buys is small. On blue, the binding
 * channel, the tightest the two readings can be even with the whole checkboard correct is
 *
 *   0.2 over the dark cell (243)  = 235.2
 *   0.6 over the bright cell (255) = 224.4
 *   worst case                   =  10.8  ->  11 levels
 *
 * The opacity test asserts that 11-level margin rather than quoting it, because "11" is
 * only true of these three opacity values against this colour over this checkerboard.
 */
const BACKGROUND_HEX = '#3366cc';
const BACKGROUND_RGB = { red: 0x33, green: 0x66, blue: 0xcc };

/**
 * Per-channel slack for "the rendered pixel IS this colour". The fill is composited in
 * 8-bit sRGB by the browser, so the only error source is that rounding; a couple of levels
 * covers it and nothing else. An opacity mistake is off by tens of levels, not units.
 */
const EXACT_COLOUR_TOLERANCE = 4;

/** A JPEG always starts with the SOI marker; checked so a size difference cannot come from a broken file. */
const JPEG_SOI = [0xff, 0xd8];

/**
 * Tolerance on the aspect ratio measured from rendered pixels against the aspect ratio of
 * the document. The document is letterboxed into the canvas element with `object-fit:
 * contain`, so each side is `round(size * scale)` for one shared `scale`; the rounding is
 * at most one pixel on a side several hundred pixels long, which is under 0.005 here.
 */
const ASPECT_TOLERANCE = 0.02;

/**
 * Detail strokes, in canvas-box relative coordinates. Enough edges for JPEG quantisation
 * to show. The boot document is 800x600 (`src/App.tsx:20-25`) and is letterboxed into the
 * workspace canvas element, which is 922x963 with its top 100px down the page at this
 * file's 1280x1100 viewport (measured). `object-fit: contain` is width-limited there —
 * 922/800 = 1.1525 against 963/600 = 1.605 — so the document renders 922x691.5 centred,
 * occupying roughly y 136..827 of the box, and x the full width. Every point below sits
 * inside it, and none of them is on an edge the box scales.
 *
 * The 922 is the two-column width; see the `test.use` comment above for why the width was
 * 974 in an earlier revision and what actually makes this viewport necessary.
 */
const DETAIL_STROKES: ReadonlyArray<readonly [number, number, number, number]> = [
  [140, 180, 620, 320],
  [140, 320, 620, 180],
  [140, 400, 620, 220],
  [140, 220, 620, 400],
  [260, 160, 420, 450],
  [180, 450, 660, 450],
];

function formatByLabel(label: string): ExportFormat {
  const found = exportFormats.find((format) => format.label === label);
  if (!found) throw new Error(`exportFormats has no "${label}" entry`);
  return found;
}

const jpegFormat = (): ExportFormat => formatByLabel('JPEG');

/**
 * Opens File > New, accepting the single unsaved-changes prompt that click causes.
 *
 * `page.once` immediately before the click, never a global `page.on('dialog')`: the
 * guard is `confirm()` in `DesktopHeader.tsx`, and a global accept would also swallow
 * every unexpected alert/confirm in the suite, so those surfacing would stop being a
 * load-bearing signal. See the same note at e2e/export/helpers.ts:309-312.
 *
 * The `prompted` flag and the `expect.poll` are what make a NON-firing prompt a failure
 * here instead of a leak. `page.once` is armed unconditionally and depends on this click
 * always producing a `confirm()`: if it ever stops, the handler is still armed, and
 * `once` consumes the NEXT dialog of any kind — a stray alert, an unrelated confirm
 * later in the same test — accepting it. That is the hazard e2e/export/helpers.ts:309-312
 * warns about, arrived at from the other direction. A comment alone would not close it:
 * the flag is polled for, so a missing prompt fails this helper at a named line instead
 * of quietly accepting something else three steps later. The flag is already consumed by
 * the time the dialog is required to be visible, so this cannot mask a late prompt.
 */
async function openNewImageDialog(page: Page): Promise<void> {
  await page.getByTestId('header-file-menu-button').click();
  let prompted = false;
  page.once('dialog', (dialog) => {
    prompted = true;
    void dialog.accept();
  });
  await page.getByTestId('header-file-new-button').click();
  await expect.poll(() => prompted, { message: 'the unsaved-changes prompt was never shown' }).toBe(true);
  await expect(page.getByTestId('new-image-dialog')).toBeVisible();
}

/**
 * Writes `hex` into the New Image background `<input type="color">` through the native
 * value setter plus synthetic input/change events, which is the only way React's
 * "value unchanged" check lets a colour input be driven. Deliberately local: the shared
 * `setForegroundColor` reaches `[data-testid="foreground-color-input"]` only, and that
 * helper is owned elsewhere, so extending it is not this file's call.
 */
async function setBackgroundColor(page: Page, hex: string): Promise<void> {
  const input = page.getByTestId('new-image-background-color-input');
  await expect(input).toBeVisible();
  await input.evaluate((node, value) => {
    const element = node as HTMLInputElement;
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('native value setter not found on HTMLInputElement.prototype');
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
  // The dialog disables the colour input at zero opacity, so a written value that never
  // reached React state would be silently dropped. Reading it back keeps that possibility
  // named here, where it is a setup mistake, rather than inside a pixel assertion.
  await expect(input).toHaveValue(hex);
}

interface DocumentSize {
  width: number;
  height: number;
}

type Rgb = { red: number; green: number; blue: number };

/** The two extremes the 20px workspace checkerboard contributes, per channel. */
interface BackdropRange {
  darkest: Rgb;
  brightest: Rgb;
  /** Pixels in the sampled strip that match the opaque fill, i.e. the document reached it. */
  onFill: number;
}

interface DocumentColourSample {
  /** The document's centre pixel: the fill colour itself, blended with the backdrop. */
  centre: Rgb;
  backdrop: BackdropRange;
}

const CHANNELS: ReadonlyArray<keyof Rgb> = ['red', 'green', 'blue'];

/**
 * The document's pixel dimensions, as the app published them.
 *
 * File > New resolves through `openNewImageDialog` and the header then calls
 * `setBlankImage(data)` (`src/components/DesktopHeader/DesktopHeader.tsx:185`), which is
 * `handleImageCreate(params.size)` (`src/hooks/useApp.ts:77-80`) — `resizeCanvas` on the
 * workspace canvas at `:61-65`. So the canvas element's own `width`/`height` ARE the
 * created document's size, not a copy of what the dialog was showing.
 *
 * NOT exclusive, and measured, because a comment that names one caller as THE caller is
 * the kind that makes a test look covered when it is not: `resizeCanvas` also runs on
 * every composite in `src/contexts/layer-renderer.ts:136`, so neutering the `useApp` call
 * leaves all four New Image dialog tests green — the renderer resizes the same element
 * from the same `size`. That is why the tests below pair this with pixels and why the
 * pixel assertions, not this read, are what carry the file: the DPI test's
 * `documentSize` checks agree with the rendered content only because the aspect assertion
 * that follows them would fail on a stale size.
 */
async function documentSize(page: Page): Promise<DocumentSize> {
  return await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
}

async function workspaceBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('workspace canvas has no bounding box');
  return box;
}

/** A capture of the whole workspace canvas element, via the suite's CDP helper. */
async function captureWorkspace(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
  return await captureCanvasScreenshot(page, await workspaceBox(page), testInfo, name);
}

/**
 * The colour actually rendered at the centre of the document.
 *
 * The document is centred inside its `object-fit: contain` box, so the element's midpoint
 * is inside the document for any document shape; the margins around it are the app's
 * workspace backdrop, which is exactly what a partially transparent background is
 * composited over. A partly transparent read is therefore only interpretable against a
 * measured backdrop, which is why this returns the backdrop's range off the same capture
 * rather than the centre alone.
 */
async function documentColourSample(page: Page, testInfo: TestInfo, name: string): Promise<DocumentColourSample> {
  const shot = await captureWorkspace(page, testInfo, name);
  const image = await loadImageData(shot);
  const centre = await getColorAtPoint(shot, Math.floor(image.width / 2), Math.floor(image.height / 2), 0);
  if (!centre) throw new Error(`${name}: the centre of the workspace canvas rendered no opaque pixel`);
  return { centre, backdrop: await backdropRange(image) };
}

/**
 * The darkest and brightest pixel the workspace backdrop contributes, read from the strip
 * of the capture directly above the letterboxed document — plus a count of any pixel in
 * that strip that could BE the document, so the caller can check it is reading backdrop.
 *
 * Only the TOP strip, because it is the one the centred document is guaranteed to leave
 * bare AT THIS VIEWPORT, and the bottom strip's guarantee is a property of the capture
 * rather than of the layout. Measured at this file's 1280x1100: the element is 922x963 and
 * the 800x600 document renders 922x691.5 centred, so both the top and the bottom 4% are
 * bare checkerboard — light theme darkest 243, brightest 255, which are exactly the two
 * colours `src/index.scss:126-137` mixes. At 1280x720 the element is 922x583 and the same
 * document renders 777x583 filling the element's whole height, so NEITHER strip is bare:
 * that is why the viewport above is bumped, and why this strip only needs the top. The
 * bottom 4% would additionally be below the fold at 720, where it carries no checkerboard
 * at all — measured, solid `rgb(255,255,255)` under a DARK theme, where `chessboard-dark`
 * (`#000` plus `#121212`) cannot produce anything brighter than 18. A range that mixed the
 * two strips would put a 255 in `brightest` and report a margin far worse than the real
 * one.
 *
 * Being above the document is a consequence of the document being smaller than the
 * element, which is not true of an arbitrary document, so `onFill` counts the pixels that
 * match the opaque fill and the caller refuses them. Failing there is the right direction:
 * a strip that had landed on the document would otherwise be measured as backdrop and
 * quietly weaken the margin instead of naming itself.
 */
async function backdropRange(image: ImageDataResult): Promise<BackdropRange> {
  const strip = Math.max(2, Math.floor(image.height * 0.04));
  const darkest: Rgb = { red: 255, green: 255, blue: 255 };
  const brightest: Rgb = { red: 0, green: 0, blue: 0 };
  let onFill = 0;
  let seen = 0;
  for (let y = 0; y < strip; y++) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const pixel: Rgb = { red: image.data[index], green: image.data[index + 1], blue: image.data[index + 2] };
      let isFill = true;
      for (const channel of CHANNELS) {
        darkest[channel] = Math.min(darkest[channel], pixel[channel]);
        brightest[channel] = Math.max(brightest[channel], pixel[channel]);
        if (Math.abs(pixel[channel] - BACKGROUND_RGB[channel]) > EXACT_COLOUR_TOLERANCE) isFill = false;
      }
      if (isFill) onFill += 1;
      seen += 1;
    }
  }
  if (seen === 0) throw new Error('the capture had no pixels to read a backdrop range from');
  return { darkest, brightest, onFill };
}

/** Creates a document with the given background colour and opacity, and waits for it. */
async function createDocumentWithBackground(
  page: Page,
  testInfo: TestInfo,
  { color, opacity }: { color: string; opacity: number }
): Promise<void> {
  await openNewImageDialog(page);
  await setBackgroundColor(page, color);
  const slider = page.getByTestId('new-image-opacity-input');
  await expect(slider).toBeVisible();
  await slider.fill(String(opacity));
  await page.getByTestId('new-image-dialog-submit-button').click();
  await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await captureWorkspace(page, testInfo, `document-opacity-${String(opacity).replace('.', '-')}`);
}

/** Draws a line and waits for it to reach the backing store. */
async function drawAndWait(page: Page, box: BoundingBox, testInfo: TestInfo, name: string): Promise<void> {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, '#cc0000', true);
  await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'red pixels' });
  await testInfo.attach(name, {
    body: await captureWorkspace(page, testInfo, name),
    contentType: 'image/png',
  });
}

/**
 * Closes the File menu if it is open.
 *
 * Declining the unsaved-changes prompt returns before the menu is closed
 * (`src/components/DesktopHeader/DesktopHeader.tsx:152-157`), so the dropdown is still
 * rendered - and it overlaps the top-left corner of the canvas element's box, which is
 * the region a canvas-clipped capture reads. It has to be dismissed before two captures
 * can be compared, or the comparison measures the dropdown instead of the document. The
 * menu's own test id is the open flag: its items exist only while it is open.
 */
async function closeFileMenu(page: Page): Promise<void> {
  const newItem = page.getByTestId('header-file-new-button');
  if ((await newItem.count()) === 0) return;
  await page.getByTestId('header-file-menu-button').click();
  await expect(newItem).toHaveCount(0);
}

/** Compares two captures pixel by pixel. Zero differing pixels is the whole claim. */
function expectIdenticalPixels(actual: ImageDataResult, expected: ImageDataResult, message: string): void {
  expect(actual.width, `${message}: capture widths differ`).toBe(expected.width);
  expect(actual.height, `${message}: capture heights differ`).toBe(expected.height);
  let differing = 0;
  for (let index = 0; index < expected.data.length; index += 4) {
    if (
      actual.data[index] !== expected.data[index] ||
      actual.data[index + 1] !== expected.data[index + 1] ||
      actual.data[index + 2] !== expected.data[index + 2] ||
      actual.data[index + 3] !== expected.data[index + 3]
    ) {
      differing += 1;
    }
  }
  expect(differing, `${message}: ${differing} pixel(s) differ between the two captures`).toBe(0);
}

test.describe('New Image dialog', () => {
  test('the background colour reaches the created document', async ({ page }, testInfo) => {
    await page.goto('/');
    await createDocumentWithBackground(page, testInfo, { color: BACKGROUND_HEX, opacity: 1 });

    // At opacity 1 the blank layer is an opaque fill, so the document's centre pixel IS
    // the colour that was chosen - not a blend, and not a read of the input.
    const { centre } = await documentColourSample(page, testInfo, 'document-background-opaque');
    expect(
      Math.abs(centre.red - BACKGROUND_RGB.red),
      `document background red: got ${centre.red}, want ${BACKGROUND_RGB.red} (#${BACKGROUND_HEX} at opacity 1)`
    ).toBeLessThanOrEqual(EXACT_COLOUR_TOLERANCE);
    expect(
      Math.abs(centre.green - BACKGROUND_RGB.green),
      `document background green: got ${centre.green}, want ${BACKGROUND_RGB.green} (#${BACKGROUND_HEX} at opacity 1)`
    ).toBeLessThanOrEqual(EXACT_COLOUR_TOLERANCE);
    expect(
      Math.abs(centre.blue - BACKGROUND_RGB.blue),
      `document background blue: got ${centre.blue}, want ${BACKGROUND_RGB.blue} (#${BACKGROUND_HEX} at opacity 1)`
    ).toBeLessThanOrEqual(EXACT_COLOUR_TOLERANCE);
  });

  test('the background opacity reaches the created document', async ({ page }, testInfo) => {
    await page.goto('/');
    await createDocumentWithBackground(page, testInfo, { color: BACKGROUND_HEX, opacity: 1 });
    const atOne = await documentColourSample(page, testInfo, 'opacity-1');

    await createDocumentWithBackground(page, testInfo, { color: BACKGROUND_HEX, opacity: 0.6 });
    const atSixTenths = await documentColourSample(page, testInfo, 'opacity-0-6');

    await createDocumentWithBackground(page, testInfo, { color: BACKGROUND_HEX, opacity: 0.2 });
    const atOneFifth = await documentColourSample(page, testInfo, 'opacity-0-2');

    // ---- The precondition, asserted before it is relied on ----
    //
    // The blank layer is filled with `globalAlpha = opacity` over a cleared canvas
    // (`src/contexts/layer-utils.ts:205-215`, the `globalAlpha` assignment at `:212`),
    // so a partly transparent background lands on the canvas as
    // `opacity * colour + (1 - opacity) * backdrop` with real alpha, and the page then
    // resolves that over whatever is behind the canvas. Everything the two direction checks
    // below assume is in these two blocks; without them the assertions are unfalsifiable
    // claims about an unmeasured composite.
    //
    // (1) Per channel, the backdrop has to be ABOVE the fill colour. That is the whole
    // precondition, and "#3366cc is below 255 in every channel" does not state it - the
    // backdrop is the 20px checkerboard, so it is measured here on the real pixels, off
    // the same capture, and the failure message names the number that broke it.
    const { darkest, brightest, onFill } = atOne.backdrop;
    expect(
      onFill,
      `${onFill} of the top 4% of the capture is the opaque #${BACKGROUND_HEX} fill, so the strip read as ` +
        `the workspace backdrop is on the document. The 800x600 document is letterboxed into the 922x963 ` +
        `element and centred, which leaves about 136 rows above it, so this says the letterbox changed ` +
        `and the backdrop is no longer being measured where it is claimed to be.`
    ).toBe(0);
    for (const channel of CHANNELS) {
      expect(
        darkest[channel] - BACKGROUND_RGB[channel],
        `the workspace backdrop's darkest ${channel} is ${darkest[channel]} and #${BACKGROUND_HEX} is ` +
          `${BACKGROUND_RGB[channel]}, so lowering the opacity can only move ${channel} UP while the ` +
          `backdrop stays above the fill colour in EVERY channel. The backdrop is the 20px checkerboard, ` +
          `not a flat colour: light is #fff plus #f3f3f3 and dark is #000 plus #121212, and a dark ` +
          `theme inverts this order instead.`
      ).toBeGreaterThan(0);
    }

    // (2) The margin, not just its sign. Lowering the opacity is compared STRICTLY, so
    // the two readings only have to differ by a single level - but the tightest they can
    // be with the whole checkerboard correct is the opacity-0.2 sample on the DARKEST
    // cell and the opacity-0.6 sample on the BRIGHTEST one. That is 10.8 levels on blue
    // in the light theme, i.e. 11: the guarantee is thin, and it is only worth anything
    // because it is computed here from the measured cells rather than assumed. Measured
    // cells, light: darkest (243,243,243) brightest (255,255,255). Under the dark
    // checkerboard the same computation is -88.8 on blue, which is the same failure as
    // (1) stated as the quantity it actually is.
    for (const channel of CHANNELS) {
      const tightest =
        0.2 * BACKGROUND_RGB[channel] +
        0.8 * darkest[channel] -
        (0.6 * BACKGROUND_RGB[channel] + 0.4 * brightest[channel]);
      expect(
        tightest,
        `the closest the ${channel} readings can be is ${tightest.toFixed(1)} levels apart (opacity 0.2 ` +
          `over the darkest cell ${darkest[channel]} against opacity 0.6 over the brightest cell ` +
          `${brightest[channel]}), which is not enough separation to order them strictly`
      ).toBeGreaterThan(0);
    }

    // ---- The claim, which the two blocks above earn ----
    //
    // With the backdrop above the fill colour per channel, lowering the opacity raises
    // every channel, and it raises it by strictly less each time. A slider that changed
    // nothing, or that reached the layer but not the canvas, breaks one of the two.
    for (const channel of CHANNELS) {
      expect(
        atSixTenths.centre[channel],
        `${channel} at opacity 0.6 (${atSixTenths.centre[channel]}) should sit between opacity 0.2 ` +
          `(${atOneFifth.centre[channel]}) and opacity 1 (${atOne.centre[channel]})`
      ).toBeGreaterThan(atOne.centre[channel]);
      expect(
        atOneFifth.centre[channel],
        `${channel} at opacity 0.2 (${atOneFifth.centre[channel]}) should be lighter than opacity 0.6 ` +
          `(${atSixTenths.centre[channel]})`
      ).toBeGreaterThan(atSixTenths.centre[channel]);
    }
  });

  test('the preset and the DPI size the created document', async ({ page }, testInfo) => {
    await page.goto('/');
    // The dialog's state is component state, so a reopened dialog is back at the
    // defaults: the colour is re-set every time, or the second document would be white
    // and there would be nothing left to measure on the canvas.
    const createFromPreset = async (dpi: string): Promise<void> => {
      await openNewImageDialog(page);
      await setBackgroundColor(page, BACKGROUND_HEX);
      await page.getByTestId('new-image-preset-select').selectOption('us-letter');
      await page.getByTestId('new-image-dpi-input').fill(dpi);
      await page.getByTestId('new-image-dialog-submit-button').click();
      await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    };

    // US Letter is 8.5 x 11 inches, so 300 DPI is 2550 x 3300 pixels and 150 DPI is
    // half that in each axis. Read back from the document, not from the inputs.
    await createFromPreset('300');
    const at300 = await documentSize(page);
    expect(at300, `document at 300 DPI: got ${at300.width}x${at300.height}, want 2550x3300`).toEqual({
      width: 2550,
      height: 3300,
    });

    await createFromPreset('150');
    const at150 = await documentSize(page);
    expect(at150, `document at 150 DPI: got ${at150.width}x${at150.height}, want 1275x1650`).toEqual({
      width: 1275,
      height: 1650,
    });

    // The numbers above are DOM state. The pixels have to agree: the document is
    // letterboxed into the canvas element with `object-fit: contain`, so the rendered
    // content's aspect ratio is the document's aspect ratio scaled by one shared factor.
    // The colour predicate is a channel comparison, so it separates the blue document
    // from any neutral backdrop square.
    const capture = await captureWorkspace(page, testInfo, 'document-preset-dpi-150');
    const image = await loadImageData(capture);
    const bounds = await scanPixelsForBounds(image, (r, g, b) => b > r + 40 && b > g + 40);
    expect(bounds.found, 'the created document is not visible anywhere on the canvas').toBe(true);
    const renderedWidth = bounds.right - bounds.left + 1;
    const renderedHeight = bounds.bottom - bounds.top + 1;
    const renderedAspect = renderedWidth / renderedHeight;
    const documentAspect = at150.width / at150.height;
    expect(
      Math.abs(renderedAspect - documentAspect),
      `rendered content is ${renderedWidth}x${renderedHeight} (aspect ${renderedAspect.toFixed(4)}), ` +
        `but the document is ${at150.width}x${at150.height} (aspect ${documentAspect.toFixed(4)})`
    ).toBeLessThan(ASPECT_TOLERANCE);
  });

  test('Cancel and Escape close the dialog without creating a document', async ({ page }, testInfo) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const before = await loadImageData(await captureWorkspace(page, testInfo, 'before-close'));
    const sizeBefore = await documentSize(page);

    // Propose a document that is a different colour, a different size and a different
    // aspect ratio, so "nothing happened" is a claim about the document and not only
    // about the dialog being on screen.
    await openNewImageDialog(page);
    await setBackgroundColor(page, BACKGROUND_HEX);
    await page.getByTestId('new-image-opacity-input').fill('0.25');
    await page.getByTestId('new-image-width-input').fill('321');
    await page.getByTestId('new-image-height-input').fill('654');
    await page.getByTestId('new-image-dialog-cancel-button').click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    expect(await documentSize(page), 'Cancel changed the document size').toEqual(sizeBefore);
    expectIdenticalPixels(
      await loadImageData(await captureWorkspace(page, testInfo, 'after-cancel')),
      before,
      'Cancel must leave the document untouched'
    );

    await openNewImageDialog(page);
    await setBackgroundColor(page, BACKGROUND_HEX);
    await page.getByTestId('new-image-opacity-input').fill('0.25');
    await page.getByTestId('new-image-width-input').fill('321');
    await page.getByTestId('new-image-height-input').fill('654');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    expect(await documentSize(page), 'Escape changed the document size').toEqual(sizeBefore);
    expectIdenticalPixels(
      await loadImageData(await captureWorkspace(page, testInfo, 'after-escape')),
      before,
      'Escape must leave the document untouched'
    );

    // History is the other half of "nothing happened", and the pixel comparison above
    // cannot see it: a document replaced without an undo entry would leave a canvas this
    // test would still call untouched. The blank boot document has nothing to undo and
    // neither dismissal may have added anything — the button is `disabled={!canUndo()}`
    // (`src/components/HistoryControls/HistoryControls.tsx:49-50`).
    await expect(page.getByTestId('undo-button'), 'cancel or Escape left a history entry behind').toBeDisabled();
  });

  test('a metric preset computes its pixel size from the DPI field', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await openNewImageDialog(page);

    await page.getByTestId('new-image-preset-select').selectOption('a4');
    // The DPI field only exists for a preset measured in something other than pixels,
    // which is itself part of the contract: a Custom document has no DPI to change.
    await expect(page.getByTestId('new-image-dpi-input')).toHaveValue('300');
    await expect(page.getByTestId('new-image-width-input')).toHaveValue(A4_AT_300_DPI.width);
    await expect(page.getByTestId('new-image-height-input')).toHaveValue(A4_AT_300_DPI.height);

    // Doubling the DPI must double the pixel size, or the field is decorative.
    await page.getByTestId('new-image-dpi-input').fill('600');
    await expect(page.getByTestId('new-image-width-input')).toHaveValue('4961');
    await expect(page.getByTestId('new-image-height-input')).toHaveValue('7016');
  });

  test('an imperial preset uses inches, and Custom has no DPI field at all', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await openNewImageDialog(page);

    await page.getByTestId('new-image-preset-select').selectOption('photo-4x6');
    await expect(page.getByTestId('new-image-width-input')).toHaveValue('1200');
    await expect(page.getByTestId('new-image-height-input')).toHaveValue('1800');

    await page.getByTestId('new-image-preset-select').selectOption('custom');
    await expect(page.getByTestId('new-image-dpi-input'), 'a pixel document has no DPI').toHaveCount(0);
    // Custom is where the fields are free, and picking a preset then editing one of them
    // has to put the dialog back on Custom rather than leave a preset label over a
    // width the preset never asked for.
    await page.getByTestId('new-image-preset-select').selectOption('a5');
    await page.getByTestId('new-image-width-input').fill('500');
    await expect(page.getByTestId('new-image-preset-select')).toHaveValue('custom');
  });

  test('a width outside the accepted range is refused by the browser, not by a message', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await openNewImageDialog(page);
    const width = page.getByTestId('new-image-width-input');
    const submit = page.getByTestId('new-image-dialog-submit-button');

    // The WIDTH FIELD clamps nothing itself: `min`, `max` and `required` on the input are
    // the whole of its validation, and only a browser enforces those. The dialog does
    // clamp elsewhere — the preset and DPI paths both go through
    // `Math.min(10000, Math.max(1, w))` — but neither is on this path, which is why
    // typing past the bound is refused rather than quietly capped. This has to be a
    // browser test: jsdom exposes `validity`, so the property assertions here would pass
    // under jsdom, but it does not BLOCK a form submit the way a browser does, and the
    // refusal is the thing being pinned.
    await width.fill('0');
    await submit.click();
    await expect(page.getByTestId('new-image-dialog'), 'the dialog stays open').toBeVisible();
    await expect(width, 'the browser, not the app, is what refuses the value').toHaveJSProperty(
      'validity.rangeUnderflow',
      true
    );

    await width.fill('10001');
    await submit.click();
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();
    await expect(width).toHaveJSProperty('validity.rangeOverflow', true);

    await width.fill('');
    await submit.click();
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();
    // Clearing the field does not leave it empty: `parseInt('') || 0` puts a literal 0
    // back into a controlled input, so `required` can never be the rule that fires and
    // `min` is the whole of the lower bound.
    await expect(width).toHaveValue('0');
    await expect(width).toHaveJSProperty('validity.rangeUnderflow', true);
    await expect(width, 'the field is never empty, so `required` never fires').not.toHaveJSProperty(
      'validity.valueMissing',
      true
    );

    // A legal size goes through, which is what makes the two refusals above refusals
    // rather than a dialog that simply never submits.
    await width.fill('640');
    await page.getByTestId('new-image-height-input').fill('480');
    await submit.click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await expect(dimensionsReadout(page)).toContainText('Dimensions: 640 × 480 px');
  });

  test('the footer readout follows the document the dialog created', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await expect(dimensionsReadout(page), 'the blank document already has a size').toContainText(
      'Dimensions: 800 × 600 px'
    );

    await openNewImageDialog(page);
    await page.getByTestId('new-image-preset-select').selectOption('a4');
    await page.getByTestId('new-image-dialog-submit-button').click();

    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await expect(dimensionsReadout(page)).toContainText(
      `Dimensions: ${A4_AT_300_DPI.width} × ${A4_AT_300_DPI.height} px`
    );
  });
});

test.describe('unsaved-changes guard on File > New', () => {
  test('dismissing the prompt leaves the document alone and stops the dialog opening', async ({ page }, testInfo) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await workspaceBox(page);
    await drawAndWait(page, box, testInfo, 'guard-dismiss-drawn');
    const before = await loadImageData(await captureWorkspace(page, testInfo, 'guard-dismiss-before'));

    let prompted = false;
    page.once('dialog', (dialog) => {
      prompted = true;
      void dialog.dismiss();
    });
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    // Wait for the prompt to actually be answered, so the absence below is a decision
    // the app made rather than a dialog that had not appeared yet.
    await expect.poll(() => prompted, { message: 'the unsaved-changes prompt was never shown' }).toBe(true);
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await closeFileMenu(page);
    expectIdenticalPixels(
      await loadImageData(await captureWorkspace(page, testInfo, 'guard-dismiss-after')),
      before,
      'dismissing the prompt must leave the drawing untouched'
    );

    // The same click DOES open the dialog when the prompt is accepted, so the count
    // above cannot be satisfied by a File > New that never worked at all.
    await page.getByTestId('header-file-menu-button').click();
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.getByTestId('header-file-new-button').click();
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();
    await page.getByTestId('new-image-dialog-close-button').click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
  });

  test('accepting the prompt opens the New Image dialog and the document survives a cancel', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await workspaceBox(page);
    await drawAndWait(page, box, testInfo, 'guard-accept-drawn');
    const before = await loadImageData(await captureWorkspace(page, testInfo, 'guard-accept-before'));

    let prompted = false;
    page.once('dialog', (dialog) => {
      prompted = true;
      void dialog.accept();
    });
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await expect.poll(() => prompted, { message: 'the unsaved-changes prompt was never shown' }).toBe(true);
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();

    // Cancelling the dialog that the accepted prompt opened must put the still-dirty
    // document back exactly as it was - the prompt already ran, and the dialog is the
    // only remaining step before the document would be replaced.
    await page.getByTestId('new-image-dialog-cancel-button').click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await closeFileMenu(page);
    expectIdenticalPixels(
      await loadImageData(await captureWorkspace(page, testInfo, 'guard-accept-after')),
      before,
      'cancelling after an accepted prompt must leave the drawing untouched'
    );
  });
});

test.describe('Save dialog', () => {
  test('the JPEG quality setting changes the exported bytes', async ({ page }, testInfo) => {
    test.setTimeout(SAVE_DIALOG_TEST_TIMEOUT_MS);
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await workspaceBox(page);

    // A flat background quantises almost identically at any quality. Several strokes
    // give the encoder edges to throw away, which is what the slider actually controls.
    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#cc0000', true);
    for (const [x1, y1, x2, y2] of DETAIL_STROKES) {
      await drawLine(page, box, x1, y1, x2, y2, { steps: 24 });
    }
    await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'red pixels' });

    const format = jpegFormat();
    const bytesForQuality = async (fileName: string, quality: string): Promise<Buffer> => {
      await openSaveDialog(page);
      await fillSaveDialog(page, fileName, format.label);
      const slider = page.getByTestId('save-dialog-jpeg-quality');
      await expect(slider, `the JPEG quality slider is not offered for ${format.label}`).toBeVisible();
      await slider.fill(quality);
      const download = await submitSaveDialogForDownload(page, format);
      const target = testInfo.outputPath(`${fileName}${format.extension}`);
      await download.saveAs(target);
      await expect(page.getByTestId('save-dialog')).toHaveCount(0);
      return await readFile(target);
    };

    const low = await bytesForQuality('quality-10', '0.1');
    const high = await bytesForQuality('quality-100', '1');

    // Both are real JPEGs, so a size difference below is a compression difference and
    // not one truncated or mis-encoded file.
    expect([...low.subarray(0, 2)], 'the quality-0.1 export is not a JPEG').toEqual(JPEG_SOI);
    expect([...high.subarray(0, 2)], 'the quality-1 export is not a JPEG').toEqual(JPEG_SOI);
    expect(
      low.byteLength,
      `quality 0.1 produced ${low.byteLength} bytes, quality 1 produced ${high.byteLength}`
    ).not.toBe(high.byteLength);
    // Directional, so a single dropped quality value cannot satisfy it: fewer bits kept
    // per block has to mean fewer bytes.
    expect(
      low.byteLength,
      `quality 0.1 (${low.byteLength} bytes) should be smaller than quality 1 (${high.byteLength} bytes)`
    ).toBeLessThan(high.byteLength);
  });

  test('Cancel closes the save dialog without producing a download', async ({ page }, testInfo) => {
    test.setTimeout(SAVE_DIALOG_TEST_TIMEOUT_MS);
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await workspaceBox(page);
    await drawAndWait(page, box, testInfo, 'save-cancel-drawn');

    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });

    await openSaveDialog(page);
    await fillSaveDialog(page, 'cancelled', 'JPEG');
    await page.getByTestId('save-dialog-cancel-button').click();
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);
    // The counter is read only AFTER the dialog has closed, and that ordering is the
    // gate — not a timing allowance, and not "two round trips". In the regression this
    // catches, Cancel wired to `handleSave` would not close the dialog at all: `onSave`
    // runs (`src/components/SaveDialog/SaveDialog.tsx:31`) and the dialog is unmounted
    // only by the `finally` in `handleImageSave`
    // (`src/contexts/useFile.tsx:135-138`), which runs AFTER `downloadBlob` /
    // `saveImageToDisk` has already been dispatched (`src/contexts/useFile.tsx:124,126`).
    // So the download is dispatched BEFORE the dialog closes, always, and waiting for the
    // close cannot be what observes it — it only guarantees the count has settled. What
    // observes it is that the listener is registered before the click and read after the
    // close, with nothing in between able to absorb the event.
    expect(downloads, 'cancelling the save dialog started a download').toBe(0);

    // The listener is live, so the zero above means "no download" and not "no listener".
    await openSaveDialog(page);
    await fillSaveDialog(page, 'actually-saved', 'PNG');
    await submitSaveDialogForDownload(page, formatByLabel('PNG'));
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);
    expect(downloads, 'saving the document did not fire a download, so the cancel assertion proves nothing').toBe(1);
  });

  test('Save is refused while the filename is blank, and offered again once it is not', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await openSaveDialogAndWait(page);
    const filename = page.getByTestId('save-dialog-filename-input');
    const submit = page.getByTestId('save-dialog-submit-button');

    await filename.fill('');
    await expect(submit).toBeDisabled();
    // Whitespace is not a filename either, and `!fileName.trim()` is the whole test.
    await filename.fill('   ');
    await expect(submit, 'whitespace only is still blank').toBeDisabled();

    await filename.fill('shot');
    await expect(submit).toBeEnabled();
  });

  test('only JPEG offers a quality control, and only PSD carries the layer caveat', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await openSaveDialogAndWait(page);
    const format = page.getByTestId('save-dialog-format-select');
    const quality = page.getByTestId('save-dialog-jpeg-quality');
    const caveat = page.getByText(/Photoshop groups, editable text, masks/);

    await expect(quality, 'PNG is lossless and has nothing to configure').toHaveCount(0);
    await expect(caveat).toHaveCount(0);

    await format.selectOption('image/jpeg');
    await expect(quality).toBeVisible();
    await expect(caveat).toHaveCount(0);

    await format.selectOption('psd');
    await expect(quality, 'PSD is not JPEG').toHaveCount(0);
    await expect(caveat).toBeVisible();
  });

  test('Escape and Cancel both close the dialog, and the backdrop does too', async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await openSaveDialogAndWait(page);
    await page.getByTestId('save-dialog-cancel-button').click();
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    await openSaveDialogAndWait(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);

    await openSaveDialogAndWait(page);
    // The backdrop is a `fixed inset-0` div that is a SIBLING of the panel
    // (`src/components/SaveDialog/SaveDialog.tsx:46-50`), so its own top-left corner is
    // backdrop and nothing else — the offset is not decoration.
    await page.getByTestId('save-dialog-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);
  });
});

/**
 * Not a dialog test, and it is here because the dialogs file is where `main` grew it. The
 * whole document is restyled from one class on `<html>`, and the option bar's own controls
 * are what a user would notice going wrong, so nothing about it is specific to a dialog.
 */
test('the theme toggle switches the whole document between light and dark', async ({ page }) => {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  const root = page.locator('html');
  const toggle = page.getByTestId('theme-toggle-button');

  // The `prefers-color-scheme` fallback in `src/contexts/ThemeContext.tsx:13-22` resolves
  // from whatever scheme the context was given, and this file PINS it to `light` in the
  // `test.use` above — so the starting class is stated rather than inherited.
  await expect(root).toHaveClass(/\blight\b/);

  await toggle.click();
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(root).not.toHaveClass(/\blight\b/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

  // The choice survives a reload, which is the only part of it a single click cannot show.
  await page.reload();
  await expect(root).toHaveClass(/\bdark\b/);

  await page.getByTestId('theme-toggle-button').click();
  await expect(root).toHaveClass(/\blight\b/);
  await expect(root).not.toHaveClass(/\bdark\b/);
});
