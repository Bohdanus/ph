import { expect, type Dialog, type Page, test, type TestInfo, useAppDefaultTheme } from './fixtures/extended-test';
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
import {
  acceptDiscardPrompt,
  declineDiscardPrompt,
  discardPromptMessage,
  expectNoDiscardPrompt,
} from './helpers/discard-prompt';
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
 * asserted rather than assumed. The unsaved-changes guard that `openNewImageDialog` handles
 * is deliberately NOT answered here: `DesktopHeader` guards New and Open and not Save
 * (`src/components/DesktopHeader/DesktopHeader.tsx`, the two `confirmDiscard(...)` calls
 * under the New and Open items), so the document in these save tests is irrelevant to it
 * and answering it would be answering something the test never asked for.
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
 * WHAT IS FALSE, and was measured rather than assumed. An earlier version of this comment
 * described a 108px two-column rail — `grid-cols-[auto_1fr_250px]` (`src/App.tsx:75`) with
 * `1280 - 108 - 250 = 922` — and every number derived from it. The rail is 56px in the
 * one-column default now, so the element is 974 wide, and the derived fit, the rendered
 * document and the count of bare rows above it all moved with it. Nothing caught that: the
 * assertions below read PIXELS, and a stale explanation of a passing measurement is not a
 * failing test.
 *
 * The other two halves of that comment are still false, for the same reason and by the same
 * measurement. There is no fold: `documentElement.scrollHeight` is 720 at 1280x720, equal to
 * `clientHeight` and to `innerHeight`, because the left rail owns its own scrolling
 * (`min-h-0 overflow-y-auto`, `src/components/SidebarLeft/SidebarLeft.tsx:335`) and the tiles
 * collapse rather than pushing the page taller. And the clip-truncation mechanism is gone:
 * `waitForCanvasPixels` reads through `page.screenshot` at
 * `e2e/helpers/canvas-helpers.ts:531`, but behind `onScreenClip` at `:529`, which re-derives
 * the clip every poll and SCROLLS the region into view; it is not a silent truncation at a
 * fold. Nothing about this file's captures goes near a fold.
 *
 * WHAT IS TRUE, and is the reason the bump stays: the taller viewport is what leaves bare
 * WORKSPACE BACKDROP above the letterboxed document, and `backdropRange` below can only
 * measure a backdrop where there is backdrop. That is a property of the document's aspect
 * against the ELEMENT's, not of the viewport or any capture API — and it is now asserted from
 * the measured rail rather than argued in prose, because an argument in a comment is exactly
 * what went stale here.
 *
 *   At 1280x1100 the element measures 974x963, aspect 1.011. The 800x600 boot document is
 *   1.333, so `object-fit: contain` is WIDTH-limited at 1.2175: it renders 974x730.5 centred,
 *   leaving about 116 rows of bare element above it. The top 4% strip (38 rows) lands entirely
 *   in that bare region, which is exactly what the strip is for. Measured by
 *   {@link letterboxFit}, and asserted there rather than here.
 *
 *   At 1280x720 the element measures 974x583, aspect 1.671 — WIDER than the document's 1.333.
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
  // THE THEME IS NOT PINNED HERE ANY MORE, and that is a deletion rather than a
  // demotion. `colorScheme: 'light'` stood in this block for a real dependency: the
  // workspace backdrop is the 20px checkerboard the canvas's parent div carries
  // (`chessboard-light` / `chessboard-dark`, picked from the resolved theme at
  // `src/components/Main/Main.tsx:263`), so the colour scheme decided whether the
  // opacity test's direction held at all — under dark it inverts, because the dark rule
  // paints `#000` and `#121212` where the light one paints `#fff` and `#f3f3f3`
  // (`src/index.scss:140-151` against `:153-164`).
  //
  // It stopped being able to decide that when `src/contexts/ThemeContext.tsx:20` replaced
  // the `prefers-color-scheme` fallback with a hard-coded `DEFAULT_THEME` of `dark`. The
  // media query this option sets now reaches no code at all, so leaving it here would
  // have been a comment claiming to pin the theme while pinning nothing — and the worst
  // version of that, because the app's default is now DARK and this file's pixel
  // arithmetic needs light, so a reader would take the line at face value and believe the
  // backdrop was accounted for.
  //
  // It is pinned in `e2e/fixtures/extended-test.ts`, which every spec's `test` comes from,
  // and whose header comment says why the suite is light at all and what silently passes
  // if it is not. The measurement is still here rather than delegated to the pin: the
  // opacity test reads the real backdrop off the real pixels and asserts the margin the
  // direction depends on, so a pinning mistake fails as a named assertion instead of as
  // six unexplained monotonicity failures.
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
 * (`src/index.scss:140-151` light: `#fff` plus `#f3f3f3` gradients; `:153-164` dark: `#000`
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

/** Fraction of the capture the backdrop strip occupies. See {@link backdropRange}. */
const BACKDROP_STRIP_FRACTION = 0.04;

/**
 * Detail strokes, in canvas-box relative coordinates. Enough edges for JPEG quantisation
 * to show. The boot document is 800x600 (`src/App.tsx:20-25`) and is letterboxed into the
 * workspace canvas element, which at this file's 1280x1100 measures 974x963 with its top 100px
 * down the page. `object-fit: contain` is width-limited there — 974/800 = 1.2175 against
 * 963/600 = 1.605 — so the document renders 974x730.5 centred, occupying roughly y 116..847 of
 * the box, and x the full width. Every point below sits inside it, and none of them is on an
 * edge the box scales.
 *
 * The width is 974 because the rail is 56px in the one-column default, not the 922 this comment
 * used to derive from a 108px two-column rail; see {@link letterboxFit}, which measures it.
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
 * Opens File > New, answering the unsaved-changes prompt that click raises.
 *
 * THE PROMPT IS ANSWERED, NOT DISMISSED, and that is the whole point of the helper rather
 * than a detail of it. The app boots with a dirty document — the blank boot layer is
 * created with `hasUnsavedChanges: true` (`src/contexts/useLayer.ts:290-293`), so this
 * prompt appears on EVERY `openNewImageDialog` in this file, not only in the two tests
 * named after the guard.
 *
 * While the guard was the browser's native `confirm()`, a spec that installed no
 * `page.on('dialog')` handler got it AUTO-DISMISSED, so every one of those clicks was a
 * silent no-op and none of them could tell "the guard declined" from "the menu item is
 * broken". `acceptDiscardPrompt` waits for the prompt to be on screen before answering, so
 * a guard that stopped firing fails here at a named line instead of leaving the New Image
 * dialog unopened, which is what makes the eight tests below able to say anything about
 * the dialog at all.
 */
async function openNewImageDialog(page: Page): Promise<void> {
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();
  await acceptDiscardPrompt(page);
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
 * from the same `size`. The tests below pair this read with rendered pixels, while the
 * actual `handleImageCreate()` resize call is pinned independently by
 * `it('resizes the workspace canvas in handleImageCreate when creating a blank image')`
 * in `useApp.document-reset.test.tsx`, where layer rendering is stubbed so it cannot resize
 * the same canvas and mask a missing call. This E2E read confirms the resulting document
 * state alongside the rendered-pixel checks.
 */
async function documentSize(page: Page): Promise<DocumentSize> {
  return await getWorkspaceCanvas(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const dpr = window.devicePixelRatio;
    return { width: canvas.width / dpr, height: canvas.height / dpr };
  });
}

/**
 * Where the document lands inside the canvas element, in that element's own coordinates.
 *
 * DERIVED, and that is the whole point of it. The element's WIDTH is not a constant: it is the
 * `1fr` track of `grid-cols-[auto_1fr_250px]` (`src/App.tsx:75`), so it is
 * `viewport - railWidth - 250` and the rail picks its own width — 56px in one column, 108px in
 * two, with one column the default. This file's comments used to carry the two-column
 * arithmetic (1280 - 108 - 250 = 922) and a matching "about 136 rows" of bare element above the
 * document, and both went stale silently the day the default changed, because nothing here
 * asserts WHY the strip is bare: `onFill` only counts pixels, and a wrong explanation of them
 * is not a failing test. Reading the box and computing the fit puts the number the failure
 * message quotes on the same footing as the assertion that produced it.
 */
const letterboxFit = async (page: Page) => {
  const box = await workspaceBox(page);
  const document = await documentSize(page);

  // `object-fit: contain` is the smaller of the two ratios; the unused axis is letterboxed.
  const scale = Math.min(box.width / document.width, box.height / document.height);
  return {
    box,
    document,
    scale,
    /** Rows of BARE element above the document — zero when the fit is height-limited. */
    bareAbove: (box.height - document.height * scale) / 2,
  };
};

/** The `onFill` failure message, with the geometry measured rather than remembered. */
const letterboxDescription = (fit: Awaited<ReturnType<typeof letterboxFit>>) =>
  `the ${fit.document.width}x${fit.document.height} document is letterboxed into the ` +
  `${Math.round(fit.box.width)}x${Math.round(fit.box.height)} element and centred, which leaves ` +
  `about ${Math.round(fit.bareAbove)} rows above it at a fit scale of ${fit.scale.toFixed(5)}`;

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
 * rather than of the layout. Measured at this file's 1280x1100: the element is 974x963 and
 * the 800x600 document renders 974x730.5 centred, so both the top and the bottom 4% are
 * bare checkerboard — light theme darkest 243, brightest 255, which are exactly the two
 * colours `src/index.scss:140-151` mixes. At 1280x720 the element is 974x583 and the same
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
 * quietly weaken the margin instead of naming itself. The caller also measures the bare
 * band from the rail ({@link letterboxFit}) and asserts the strip fits inside it, so the
 * layout fact this comment states is checked rather than believed.
 */
async function backdropRange(image: ImageDataResult): Promise<BackdropRange> {
  const strip = Math.max(2, Math.floor(image.height * BACKDROP_STRIP_FRACTION));
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
 * Asserts the File menu is not left hanging, which is a claim and used to be a cleanup.
 *
 * Activating an item now closes the dropdown FIRST and unconditionally, before the guard is
 * even asked (`src/components/DesktopHeader/DesktopHeader.tsx`, `setOpenMenu(null)` ahead of
 * `confirmDiscard`). It used to sit after the action, which left the decline path — the one
 * branch that returns early — with the dropdown still rendered, overlapping the top-left
 * corner of the canvas element's box, which is the region every canvas-clipped capture in
 * this file reads. Two captures compared across a hanging dropdown measure the dropdown
 * instead of the document.
 *
 * So this is an assertion rather than a click that repairs the state: the dropdown is gone
 * before the pixels are compared, and a menu that stopped closing fails here instead of
 * quietly poisoning the comparison. The menu's own item is the open flag — the items exist
 * only while the menu is open.
 */
async function expectFileMenuClosed(page: Page): Promise<void> {
  await expect(
    page.getByTestId('header-file-new-button'),
    'the File menu is left hanging over the top-left of the canvas, where every capture in this file reads'
  ).toHaveCount(0);
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
    // The strip has to be ABOVE the document for the whole block to mean anything, and that is
    // a property of the ELEMENT's aspect against the document's — so it is measured from the
    // rail rather than assumed, and asserted rather than left to the prose. `onFill` below is
    // still the real check: this one says which layout change took the bare band away, and that
    // one catches a strip that landed on the document for any other reason.
    const fit = await letterboxFit(page);
    expect(
      Math.max(2, Math.floor(fit.box.height * BACKDROP_STRIP_FRACTION)),
      `the top ${BACKDROP_STRIP_FRACTION * 100}% strip does not fit above the document, so the range ` +
        `below would be measured off the document itself. ${letterboxDescription(fit)}`
    ).toBeLessThanOrEqual(fit.bareAbove);
    expect(
      onFill,
      `${onFill} of the top 4% of the capture is the opaque #${BACKGROUND_HEX} fill, so the strip read as ` +
        `the workspace backdrop is on the document. ${letterboxDescription(fit)} — the letterbox changed, ` +
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
  test('declining the prompt leaves the document alone and stops the dialog opening', async ({ page }, testInfo) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await workspaceBox(page);
    await drawAndWait(page, box, testInfo, 'guard-decline-drawn');
    const before = await loadImageData(await captureWorkspace(page, testInfo, 'guard-decline-before'));

    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    // The copy and the button label are the decision being asked, and both are pinned here
    // rather than only at the helper: they are what tells a DECLINE apart from any other
    // dismissal of this modal — its header ×, its backdrop and Escape all take the same
    // branch, and this test is about cancelling a document replacement.
    await expect(discardPromptMessage(page)).toHaveText('Discard unsaved changes and start a new image?');
    await expect(page.getByTestId('confirm-dialog-confirm-button')).toHaveText('Discard');
    // Waiting for the prompt to be ON SCREEN and then waiting for it to leave is what makes
    // the absence below a decision the app made rather than a dialog that had not appeared
    // yet — the same reason the old `page.once` handler polled a `prompted` flag.
    await declineDiscardPrompt(page);
    await expectNoDiscardPrompt(page);

    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await expectFileMenuClosed(page);
    expectIdenticalPixels(
      await loadImageData(await captureWorkspace(page, testInfo, 'guard-decline-after')),
      before,
      'declining the prompt must leave the drawing untouched'
    );

    // The same click DOES open the dialog when the prompt is accepted, so the count above
    // cannot be satisfied by a File > New that never worked at all — and it also proves the
    // guard really is the only thing standing in the way, because this is the identical
    // sequence with one button changed.
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await acceptDiscardPrompt(page);
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

    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await expect(discardPromptMessage(page)).toHaveText('Discard unsaved changes and start a new image?');
    // Answered in place, and the prompt is asserted to be GONE before the dialog it gates is
    // asserted to be on screen — so the dialog below cannot have opened before the guard
    // ran, which is the failure this test exists to rule out.
    await acceptDiscardPrompt(page);
    await expectNoDiscardPrompt(page);
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();

    // Cancelling the dialog that the accepted prompt opened must put the still-dirty
    // document back exactly as it was - the prompt already ran, and the dialog is the
    // only remaining step before the document would be replaced.
    await page.getByTestId('new-image-dialog-cancel-button').click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await expectFileMenuClosed(page);
    expectIdenticalPixels(
      await loadImageData(await captureWorkspace(page, testInfo, 'guard-accept-after')),
      before,
      'cancelling after an accepted prompt must leave the drawing untouched'
    );
  });
});

/**
 * The unload guard: the other half of the same change, and the one half that CANNOT be the
 * app's modal.
 *
 * `beforeunload` is the one guard the browser owns. The handler at
 * `src/contexts/UnsavedChangesContext.tsx:99-109` can only decide whether to set
 * `returnValue` at all — the dialog, its wording and its two buttons are Chromium's, and
 * Chrome, Safari and Firefox each word it differently. So it has to be observed through
 * `page.on('dialog')` rather than through `e2e/helpers/discard-prompt.ts`, and this file
 * mixing the two is a fact about the platform rather than an inconsistency in the tests.
 *
 * WHAT PLAYWRIGHT DOES WITH IT, measured in the installed client rather than recalled,
 * because the whole describe depends on it. With no `dialog` listener registered, the client
 * ACCEPTS a `beforeunload` and dismisses everything else
 * (`node_modules/playwright-core/lib/coreBundle.js`: the `browserContext` channel's `dialog`
 * handler branches on `dialogObject.type() === "beforeunload"`, and `Dialog._close()` does
 * the same). A dismissed `beforeunload` is an unload that was REFUSED, but an auto-ACCEPTED
 * one is an unload that happened without anybody asking — silently. So:
 *
 *   - "the guard fired" is only observable with a listener installed, because without one the
 *     dialog never surfaces and the reload goes through; and
 *   - a listener that DISMISSES makes a fired guard STOP the navigation, which is the only
 *     honest way to prove the no-dialog case below. With no listener, a guard that fired and a
 *     document that was clean would both end in a completed reload and be indistinguishable.
 *
 *   MEASURED, and it is not a rejection: Chromium reports the cancelled navigation as an
 *   aborted one and the pending `page.reload()` then settles NEITHER way — it sits in
 *   Playwright's "waiting for navigation until load" until the test budget runs out. Both
 *   tests below are written against what is observable instead: the dialog, the page it left
 *   behind, and whether the next navigation still works.
 *
 * The bare `page.reload()` calls elsewhere in this suite (the two theme tests at the bottom
 * of the file) are on documents the app booted dirty, and they still pass for exactly the
 * reason above: the auto-accept lets the navigation complete, and silently discards the
 * drawing they were not testing. Their subject is the theme, not the unload.
 */
test.describe('unload guard on a document with unsaved work', () => {
  test('reloading a document with unsaved work fires a beforeunload dialog, and dismissing it keeps the drawing', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    const box = await workspaceBox(page);
    // Drawn first, and not incidentally: a boot document is dirty on its own, but Chromium
    // only shows the prompt for a document the user has interacted with, so the draw is what
    // supplies the activation as well as the work.
    await drawAndWait(page, box, testInfo, 'unload-dirty-drawn');
    const before = await loadImageData(await captureWorkspace(page, testInfo, 'unload-dirty-before'));

    // The listener CAPTURES the dialog rather than answering it, and both halves matter. It
    // has to exist at all, or Playwright auto-accepts the unload and the reload below sails
    // through on a page whose guard does not exist — the test would pass against the very
    // thing it is checking for. And capturing rather than accepting in place keeps this
    // distinct from the clean-document case: an in-place accept lets the navigation through.
    let unloadPrompt: Dialog | undefined;
    page.once('dialog', (dialog) => {
      unloadPrompt = dialog;
    });

    // The reload is deliberately NOT awaited, and that is a measured property of the
    // platform rather than a convenience. Chromium reports the cancelled main-frame
    // navigation, and then nothing further happens: the `reload()` call settles neither as a
    // resolution nor as a rejection, so awaiting it spends the whole test budget inside
    // Playwright's "waiting for navigation until load" and asserts nothing at all. Measured
    // on the run that produced this file — an `expect(reloading).rejects` against the abort
    // message times out at 30s rather than passing. The claim below is therefore made about
    // the PAGE, which is the thing the user would see.
    void page.reload().catch(() => undefined);
    await expect
      .poll(() => unloadPrompt !== undefined, {
        message:
          'no beforeunload dialog fired, so the app let the unload through without asking and a reload destroyed the drawing',
      })
      .toBe(true);
    expect(unloadPrompt?.type(), 'the browser supplies this dialog, so it is a native one').toBe('beforeunload');

    await unloadPrompt?.dismiss();

    // Same page, same drawing. The capture is clipped to the workspace canvas element, so a
    // File dropdown hanging over its top-left corner would be measured here rather than
    // ignored — which is why the menu is asserted closed before the pixels are read, not
    // after. And undo still has the stroke on it, which is the half of "nothing happened"
    // a canvas capture cannot see.
    await expectFileMenuClosed(page);
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await expect(
      page.getByTestId('undo-button'),
      'the refused unload dropped the drawing off the history'
    ).toBeEnabled();
    expectIdenticalPixels(
      await loadImageData(await captureWorkspace(page, testInfo, 'unload-dirty-after')),
      before,
      'dismissing the unload prompt must leave the drawing untouched'
    );

    // The refusal left the app able to navigate, which is what separates "the unload was
    // declined" from "the page is wedged". This reload has no listener left on it — the
    // `once` above is spent — so Playwright auto-accepts the unload and the navigation runs,
    // and it lands on a fresh boot document: the drawing is gone, which is the same thing
    // the refused reload above did NOT do.
    await page.reload();
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await expect(dimensionsReadout(page)).toContainText('Dimensions: 800 × 600 px');
    await expect(page.getByTestId('undo-button'), 'the reloaded document is a fresh one').toBeDisabled();
  });

  test('a document saved to disk reloads with no unload prompt, and the app comes back usable', async ({
    page,
  }, testInfo) => {
    test.setTimeout(SAVE_DIALOG_TEST_TIMEOUT_MS);
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    const box = await workspaceBox(page);
    await drawAndWait(page, box, testInfo, 'unload-clean-drawn');

    // File > Save is the route to clean, and it is the ONLY one of the two replacements the
    // app offers. `handleImageSave` dispatches `{ fileName, hasUnsavedChanges: false }`
    // (`src/hooks/useApp.ts:68-72`), which clears the store term of `hasDiscardableWork`, and
    // a completed drag leaves the other two empty — no unplaced text, no preview transaction.
    // File > New would NOT do this: a blank document is created with
    // `hasUnsavedChanges: true` (`src/contexts/useLayer.ts:290-293`), so a freshly created
    // document is dirty again and would be guarded immediately.
    await openSaveDialog(page);
    await fillSaveDialog(page, 'clean-before-reload', 'PNG');
    const download = await submitSaveDialogForDownload(page, formatByLabel('PNG'));
    await download.delete();
    await expect(page.getByTestId('save-dialog')).toHaveCount(0);
    await expectFileMenuClosed(page);

    // The guard's own reading of "clean", OBSERVED rather than assumed, and through the same
    // `isDocumentDirty()` the unload handler reads: a clean document opens the New Image
    // dialog directly, with no prompt in between. Ordered so the prompt is checked after the
    // click has had a chance to raise one — a bare `toHaveCount(0)` would pass on the first
    // poll of a prompt that had not mounted yet.
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await expect(
      page.getByTestId('new-image-dialog'),
      'File > Save did not clear the document: the guard is still up, so the click reached nothing'
    ).toBeVisible();
    await expectNoDiscardPrompt(page);
    await page.getByTestId('new-image-dialog-close-button').click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);

    // The dismissing listener, whose only job is to make a fired guard FAIL this test rather
    // than be swallowed by the auto-accept described at the top of this describe. The claim
    // below is NOT "the handler was never called" — that is unobservable from a spec, because
    // an auto-accept and a real answer look identical from here. The claim is that the
    // navigation COMPLETED, and this listener is what makes that outcome mean something.
    page.on('dialog', (dialog) => {
      void dialog.dismiss();
    });

    // The marker is the proof that the reload really RELOADED rather than leaving the page
    // as it was: it lives on the old `window`, so only a fresh document can lose it.
    await page.evaluate(() => {
      (window as unknown as { reloadProbe?: string }).reloadProbe = 'set-before-reload';
    });

    await page.reload();

    expect(
      await page.evaluate(() => (window as unknown as { reloadProbe?: string }).reloadProbe),
      'the reload did not navigate, which is what an unload prompt answered by dismissal looks like'
    ).toBeUndefined();
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    // A fresh boot document — 800x600, empty, nothing to undo — so this also says the drawn
    // document is gone rather than that the old page is still on screen behind the assertions.
    await expect(dimensionsReadout(page)).toContainText('Dimensions: 800 × 600 px');
    await expect(page.getByTestId('undo-button'), 'the fresh document has nothing to undo').toBeDisabled();
    // Usable: the File menu opens and the items behind it are there.
    await page.getByTestId('header-file-menu-button').click();
    await expect(page.getByTestId('header-file-save-button')).toBeVisible();
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
    // runs (`src/components/SaveDialog/SaveDialog.tsx:22`) and the dialog is unmounted
    // only by the `finally` in `handleImageSave`
    // (`src/contexts/useFile.tsx:133-136`), which runs AFTER `downloadBlob` /
    // `saveImageToDisk` has already been dispatched (`src/contexts/useFile.tsx:123,125`).
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

  // Starts LIGHT because the shared `test` pins `localStorage.theme` to `light` before
  // the app's first statement — see the `pinnedTheme` fixture in
  // `e2e/fixtures/extended-test.ts`. That is a property of the oracle and not of the app:
  // with nothing stored the app is DARK, which is what the next test asserts. Stating it
  // here means this file no longer depends on a `test.use` line that was removed.
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

/**
 * The other half of the toggle test above, and the only test in the suite that runs with
 * the pin RELEASED.
 *
 * WHY IT EXISTS. `src/contexts/ThemeContext.tsx:20` makes `dark` the default for a
 * visitor with no stored preference, and that replaced a `prefers-color-scheme` fallback
 * — so the app's default is a decision in the source, not an accident of the OS, and
 * nothing else in this suite can see it. Every other spec runs pinned light (see the
 * `pinnedTheme` fixture in `e2e/fixtures/extended-test.ts`), which is correct for the
 * pixel arithmetic and means a flip of the default would break tests LOUDLY: measured
 * with that pin's write neutered and a full headless suite run, **11 failed, 3 skipped,
 * 337 passed**. But a flip BACK, or a change of the default's shape, would be silent
 * everywhere else, because the loud ones are the ones that name a colour in an assertion.
 *
 * WHAT IT ASSERTS, and what it does not: the `dark` class on `<html>` and `dark` in
 * `localStorage`. Not rendering. A `dark:` Tailwind variant that stopped applying
 * leaves both of those true, so this test is a declaration about `DEFAULT_THEME` and must
 * not be read as dark-mode coverage — `e2e/accessibility.spec.ts` runs under the light
 * pin and provides no dark-theme axe result. Dark contrast remains unmeasured by that gate.
 *
 * WHAT IT DOES NOT DO. It does not weaken or parametrise the pin. `useAppDefaultTheme`
 * turns the pin off for this tab and removes the stored value in the same step, then the
 * reload makes the app resolve with nothing stored — the one condition the default is
 * about. A test that merely cleared `localStorage` and reloaded would measure the pin,
 * because the init script writes `light` back on every navigation; that is why the
 * release is a flag in `sessionStorage` and why the helper removes the key too.
 */
test('with nothing stored the document starts dark', async ({ page }) => {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  await useAppDefaultTheme(page);
  // `ThemeProvider` read the stored value once, in its `useState` initializer, and nothing
  // since has asked it again — a reload is the only way to make the app resolve with an
  // empty `localStorage`.
  await page.reload();
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  const root = page.locator('html');
  await expect(root, 'DEFAULT_THEME is dark, and it is applied as a class on <html>').toHaveClass(/\bdark\b/);
  await expect(root).not.toHaveClass(/\blight\b/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('theme')), {
      message: 'the resolved default is written back to storage, so the next load is not a default load',
    })
    .toBe('dark');
});
