import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  DEFAULT_LINE_CLIP,
  drawLine,
  getColorAtPoint,
  getDarkPixelBounds,
  getStrokeAnalysis,
  getWorkspaceCanvas,
  hasDarkPixels,
  hasRedPixels,
  isBuffer,
  type ImageDataResult,
  loadImageData,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  measureInk,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { canvasRedrawClip, type CanvasPixelPredicate, waitForCanvasPixels } from './helpers/canvas-redraw';
import { cssPointToImage } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/**
 * Pixel coordinates inside the image `takeLineScreenshot` returns, which crops the
 * canvas to `DEFAULT_LINE_CLIP` (120,120,260,80) measured from the canvas box. The
 * standard test line runs from (150,150) to (350,150) in box coordinates, so in that
 * image it spans x 30..230 on row 30.
 *
 * Three samples along the stroke rather than one: an adjustment that erased the
 * layer, or one that only reached part of it, would pass a single mid-stroke read.
 *
 * Every read below passes `ignoreNearWhite`. That is what makes a `null` result a
 * survival failure rather than a tautology: the document behind the layer is white, so
 * a point where the stroke has been erased samples nothing at all, while a point the
 * stroke still covers samples its pixels.
 */
const STROKE_SAMPLES = [
  { name: 'start', x: 30, y: 30 },
  { name: 'middle', x: 130, y: 30 },
  { name: 'end', x: 225, y: 30 },
] as const;

const STROKE_MIDDLE = STROKE_SAMPLES[1];

/**
 * The CSS-pixel region every `takeLineScreenshot` below is captured over.
 *
 * `takeLineScreenshot` falls back to `DEFAULT_LINE_CLIP`, so the capture is a faithful
 * image of exactly that rect — and `getStrokeAnalysis` needs the rect to derive the
 * capture's scale from the decoded width. The thresholds it compares are authored in
 * CSS pixels; without this the same stroke measured at 2x carries twice the vertical
 * spread and reads as a spray where it is solid.
 */
const LINE_CAPTURE_REGION = { width: DEFAULT_LINE_CLIP.width, height: DEFAULT_LINE_CLIP.height };

/**
 * How far the stroke's ink BOUNDS may move across an adjustment, in capture pixels.
 *
 * One, and the natural value is zero: both captures are `takeLineScreenshot` over the same
 * `DEFAULT_LINE_CLIP` of the same document, so the stroke lands on the same image pixels
 * before and after. Measured on `grayscale(100%)` over a `#cc0000` stroke: left/top/right/
 * bottom all drift by 0, while the ink MASS rises 9.7% — the CSS `grayscale()` matrix is not
 * the 0.299/0.587/0.114 one `measureInk` weights by, so the same mark carries more measured
 * ink after. That is why the invariant is the bounds and not `ink`.
 */
const INK_BOUNDS_TOLERANCE_PX = 1;

/**
 * The four inclusive edges of a capture's ink, or a thrown error when it carries none.
 *
 * `measureInk` is the instrument here rather than `getStrokeAnalysis`, and the reason is
 * measured. A `#cc0000` stroke composites to RGB (210,26,26) over the white document, and
 * `getStrokeAnalysis` classifies a pixel as dark only when all three channels are under 50
 * and as spray only when luminance is over 200 AND saturation under 30. The core satisfies
 * neither, so on this fixture the analyser reports `darkCount: 0` and `pixelCount: 225`
 * against a core of 1643 — it is classifying the pale anti-aliased FRINGE and nothing else,
 * and its `verticalSpread` of 12 is the fringe's row span. That is fine for the Blur tests,
 * which stroke in `#000000` and want a dark core; it is the wrong instrument for a test whose
 * subject is a red stroke's geometry.
 *
 * `measureInk` weights by luma alone against a white page, so it sees the core. All three of
 * the geometry mutations that a surviving layer is supposed to exclude move its bounds:
 * scaling about the middle pushes the far edges out, a translation moves all four, and
 * thinning pulls the top and bottom in.
 */
async function inkBounds(screenshot: Buffer | ImageDataResult) {
  const profile = await measureInk(screenshot);
  expect(profile, 'The capture carries no ink at all, so there is no geometry to compare').not.toBeNull();
  const { left, top, right, bottom } = profile!;
  return { left, top, right, bottom };
}

/** How far each of the four edges moved, per edge, so a failure names the one that moved. */
function inkDrift(before: { left: number; top: number; right: number; bottom: number }, after: typeof before) {
  return {
    left: after.left - before.left,
    top: after.top - before.top,
    right: after.right - before.right,
    bottom: after.bottom - before.bottom,
  };
}

/**
 * Samples a point given in CSS pixels within the line capture.
 *
 * `STROKE_SAMPLES` is authored in CSS pixels — it is derived from where the line is
 * drawn, and `DEFAULT_LINE_CLIP` is a CSS-pixel rect — while `getColorAtPoint` takes
 * IMAGE pixels. At the suite's default 1x the two are the same number and the mismatch
 * is invisible. At `deviceScaleFactor: 2` `page.screenshot` returns a 520x160 image of
 * a 260x80 clip, so image row 30 is CSS row 15, which is above the stroke entirely:
 * every sample lands on white, `ignoreNearWhite` discards them all, and the helper
 * returns `null`. The result is four tests failing on a suite that is correct — and it
 * is the same class of defect `getStrokeAnalysis` was given a required `region` to
 * fix, in the same file, one commit apart.
 *
 * The conversion is the inverse of the mapping the capture performed, so it is derived
 * from the DECODED image rather than from the emulated ratio: CDP and
 * `page.screenshot` disagree about what ratio means, and the image is the only thing
 * both of them are describing.
 */
async function sampleCssPoint(
  screenshot: Buffer | ImageDataResult,
  cssX: number,
  cssY: number,
  radius: number,
  options?: Parameters<typeof getColorAtPoint>[4]
) {
  const image = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const point = cssPointToImage(
    { width: image.width, height: image.height },
    { x: 0, y: 0, ...LINE_CAPTURE_REGION },
    { x: cssX, y: cssY }
  );
  // `getColorAtPoint` rejects a non-integer coordinate outright, and `cssPointToImage`
  // returns a float by construction. Rounding is right here and truncation would be
  // wrong: the point is a location, not a pixel index, so a fractional answer is
  // expected and nearest is the honest mapping.
  return getColorAtPoint(image, Math.round(point.x), Math.round(point.y), radius, options);
}

/** `#cc0000`, the colour the two Colors tests stroke with: saturated, so a greyscale
 *  or a desaturation of it is a visible change rather than a rounding difference. */
const RED_STROKE = '#cc0000';

/**
 * Black, for the blur test only. The blur is asserted as ink dispersing outwards, and
 * a black stroke is what gives `getDarkPixelBounds` a fully dark core to lose; a
 * saturated red never reads as dark at all once it is composited over the white
 * document.
 */
const BLACK_STROKE = '#000000';

const WHITE = 255;

async function visibleCanvasBox(page: Page): Promise<BoundingBox> {
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'Canvas should have visible coordinates').not.toBeNull();
  return box!;
}

/**
 * Draws the standard line on a fresh page and returns the canvas box.
 *
 * The colour is set AFTER the tool is activated: the draw tool only strokes with the
 * active foreground colour once it is the active tool, and `verifySwatch` proves the
 * store it reads actually holds the value.
 */
async function drawStroke(page: Page, hex: string): Promise<BoundingBox> {
  const box = await visibleCanvasBox(page);
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, hex, true);
  await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  return box;
}

/**
 * Re-measures the canvas box.
 *
 * Opening an adjustment panel reflows the workspace canvas, so a box measured before
 * the panel opened can crop empty canvas and every pixel read below it lands on the
 * white page background.
 */
async function remeasureCanvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  expect(box, 'Canvas should have visible coordinates after opening the panel').not.toBeNull();
  return box!;
}

/** The polarity `waitForCanvasPixels` polls on, as a named predicate. */
const isNot =
  (predicate: CanvasPixelPredicate): CanvasPixelPredicate =>
  async (png) =>
    !(await predicate(png));

/**
 * Selects the Colors panel through `Image ▸ Adjustments ▸ Desaturate`.
 *
 * THREE clicks, and the middle one is not optional: `image-menu-adjustments-button` is a
 * `<button aria-haspopup="true">` with no hover handler, so the submenu is unmounted until it
 * is clicked. `color` is an `Image ▸ Adjustments` COMMAND, not a tool — it has no rail tile
 * and no `tools-menu-color-button`, and the `[Colors, Levels, Transform]` flyout that used to
 * hold it is gone from `toolbarMap`. `Desaturate` is the enabled item that selects it, and
 * the slug is `slugifyToolLabel('Desaturate')` (`toolbar-mapping.ts`). It used to be
 * `Photo Filter`, which named a command whose bar this is not: Adobe's Photo Filter is a
 * lens filter with Density and Preserve Luminosity, and the app computes
 * `grayscale(%) sepia(%) saturate(%)`.
 *
 * The other twenty items in that submenu render `disabled`, so this is the one path in and a
 * spec cannot reach the panel any other way.
 */
async function openColorsPanel(page: Page): Promise<void> {
  await page.getByTestId('header-image-menu-button').click();
  await page.getByTestId('image-menu-adjustments-button').click();
  await page.getByTestId('image-menu-adjustments-desaturate-button').click();
}

test.describe('Colors adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('grayscale at 100 turns the red stroke neutral without destroying it', async ({ page }, testInfo) => {
    const box = await drawStroke(page, RED_STROKE);
    const before = await takeLineScreenshot(page, box, 'colors-before', testInfo);
    expect(await hasRedPixels(before), 'The stroke should be red before the adjustment').toBe(true);
    const beforeBounds = await inkBounds(before);

    await openColorsPanel(page);
    const panelBox = await remeasureCanvasBox(page);

    // The panel's discard can only remove a live preview, so it is disabled until one
    // exists. That makes it a readout of the preview lifecycle, not just a button.
    const reset = page.getByTestId('undo-button-reset');
    await expect(reset, 'Reset is gated on a live preview, and there is none yet').toBeDisabled();

    const grayscale = page.getByRole('slider', { name: /Grayscale/ });
    await expect(grayscale).toBeVisible();
    await grayscale.fill('100');
    await expect(grayscale).toHaveValue('100');
    await expect(reset, 'Moving the slider creates the live preview Reset is gated on').toBeEnabled();

    // The pre-state has red pixels and the post-state cannot, so this poll is a real
    // wait for the repaint rather than a sleep.
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasRedPixels), {
      description: 'the stroke to stop being red',
    });

    const after = await takeLineScreenshot(page, panelBox, 'colors-grayscale-100', testInfo);
    expect(await hasRedPixels(after), 'grayscale(100%) must leave no red pixel in the stroke').toBe(false);

    // EXACT AND CALIBRATION-FREE. `grayscale(100%)` replaces every channel with the
    // pixel's own luminance, so a neutral stroke is guaranteed whatever colour space
    // the canvas filter is evaluated in - and the document behind it is white, so
    // compositing two neutrals over each other stays neutral. Red, green and blue must
    // come out equal, not merely close.
    //
    // The same three reads are the survival check, and they are the only colour check in
    // this file that can be: each one is a non-null answer from the middle of the stroke
    // BODY, so an adjustment that emptied the layer samples the white document and returns
    // null. What they cannot see is GEOMETRY — three points on one row still read the same
    // colour if the layer was scaled about its middle, shifted, or thinned — so the four ink
    // edges are compared below.
    const samples = await Promise.all(
      STROKE_SAMPLES.map(async ({ name, x, y }) => {
        const sampled = await sampleCssPoint(after, x, y, 5, { ignoreNearWhite: true });
        expect(sampled, `grayscale(100%) left no ink at the ${name} of the stroke`).not.toBeNull();
        return { name, ...sampled! };
      })
    );
    for (const { name, red, green, blue } of samples) {
      expect({ at: name, red, green, blue }, `grayscale(100%) must neutralise the ${name} of the stroke`).toEqual({
        at: name,
        red,
        green: red,
        blue: red,
      });
    }

    // THE SHAPE, and it is the only assertion here that the adjustment is not allowed to
    // move. The three samples above pass for a layer that was scaled about its middle,
    // translated, or thinned, because a red stroke neutralised in place still reads grey
    // at all three of them; the ink's four edges do not survive any of the three.
    const afterBounds = await inkBounds(after);
    const drift = inkDrift(beforeBounds, afterBounds);
    expect
      .soft(
        Math.max(...Object.values(drift).map(Math.abs)) <= INK_BOUNDS_TOLERANCE_PX,
        `grayscale(100%) must leave the stroke where it was, and the four edges moved by ${JSON.stringify(drift)}`
      )
      .toBe(true);

    // Reset discards the uncommitted preview: the stroke comes back red and the button
    // goes back to disabled, because there is no preview left for it to remove.
    await reset.click();
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), hasRedPixels, {
      description: 'the red stroke to come back after Reset',
    });
    await expect(reset, 'Reset has nothing left to discard once the preview is gone').toBeDisabled();
  });

  test('saturation at -100 desaturates the red stroke without destroying it', async ({ page }, testInfo) => {
    const box = await drawStroke(page, RED_STROKE);
    const before = await takeLineScreenshot(page, box, 'colors-before-saturation', testInfo);
    expect(await hasRedPixels(before), 'The stroke should be red before the adjustment').toBe(true);
    const beforeBounds = await inkBounds(before);

    await openColorsPanel(page);
    const panelBox = await remeasureCanvasBox(page);

    const saturation = page.getByRole('slider', { name: /Saturation/ });
    await expect(saturation).toBeVisible();
    await saturation.fill('-100');
    await expect(saturation).toHaveValue('-100');

    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasRedPixels), {
      description: 'the stroke to be desaturated',
    });

    const after = await takeLineScreenshot(page, panelBox, 'colors-saturation-minus-100', testInfo);
    expect(await hasRedPixels(after), 'saturate(0%) must leave no red pixel in the stroke').toBe(false);

    // EXACT AND CALIBRATION-FREE, for the same reason as grayscale above: zero
    // saturation is a mix with the pixel's own luminance, so all three channels have to
    // come out equal. The non-null read of each sample is the survival check, and it is
    // the same one the grayscale test makes for the reason given there.
    for (const { name, x, y } of STROKE_SAMPLES) {
      const sampled = await sampleCssPoint(after, x, y, 5, { ignoreNearWhite: true });
      expect(sampled, `saturate(0%) left no ink at the ${name} of the stroke`).not.toBeNull();
      expect(sampled!.red, `saturate(0%) must neutralise the ${name} of the stroke`).toBe(sampled!.green);
      expect(sampled!.blue, `saturate(0%) must neutralise the ${name} of the stroke`).toBe(sampled!.red);
    }

    // The same one shape assertion the grayscale test makes, over the same four ink edges
    // and for the same reason: three samples on a single row still read the same colour if
    // the layer was scaled about its middle, translated, or thinned.
    const afterBounds = await inkBounds(after);
    const drift = inkDrift(beforeBounds, afterBounds);
    expect
      .soft(
        Math.max(...Object.values(drift).map(Math.abs)) <= INK_BOUNDS_TOLERANCE_PX,
        `saturate(0%) must leave the stroke where it was, and the four edges moved by ${JSON.stringify(drift)}`
      )
      .toBe(true);
  });
});

test.describe('Blur adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('a non-zero radius disperses the stroke off its hard edge', async ({ page }, testInfo) => {
    const box = await drawStroke(page, BLACK_STROKE);
    const before = await takeLineScreenshot(page, box, 'blur-before', testInfo);
    const beforeBounds = await getDarkPixelBounds(before);
    expect(beforeBounds, 'The black stroke should have a fully dark core before the adjustment').not.toBeNull();
    expect(beforeBounds!.height, 'The unblurred stroke should have a hard, finite edge').toBeGreaterThan(0);
    const beforeAnalysis = await getStrokeAnalysis(before, LINE_CAPTURE_REGION);
    expect(beforeAnalysis, 'The stroke should be visible to stroke analysis').not.toBeNull();
    expect(beforeAnalysis!.type, 'The unblurred stroke should read as solid').toBe('solid');
    const beforeMiddle = await sampleCssPoint(before, STROKE_MIDDLE.x, STROKE_MIDDLE.y, 5, {
      ignoreNearWhite: true,
    });
    expect(beforeMiddle, 'The stroke should be inked at its middle before the adjustment').not.toBeNull();

    // `blur` is a singleton toolbar button, not a flyout group, so it is clicked
    // directly rather than reached through a long-press flyout.
    await clickToolButton(page, 'blur');
    const panelBox = await remeasureCanvasBox(page);

    const reset = page.getByTestId('undo-button-reset');
    await expect(reset, 'Reset is gated on a live preview, and there is none yet').toBeDisabled();

    const radius = page.getByRole('slider', { name: /Blur Radius/ });
    await expect(radius).toBeVisible();
    await radius.fill('10');
    await expect(radius).toHaveValue('10');
    await expect(reset, 'Moving the slider creates the live preview Reset is gated on').toBeEnabled();

    // The pre-state has a fully dark core and the blurred state has none, so this poll
    // is a real wait for the repaint rather than a sleep.
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasDarkPixels), {
      description: 'the stroke to lose its fully dark core',
    });

    const after = await takeLineScreenshot(page, panelBox, 'blur-radius-10', testInfo);

    // DIRECTIONAL, NOT A MAGIC NUMBER. The exact spread of a CSS `blur()` is
    // implementation defined, so nothing here pins one. What is asserted is the
    // direction the ink moves in: a blur pushes the stroke's own pixels outwards, so
    // the core that was dark enough to have bounds is gone, the soft edge covers more
    // rows, and the stroke's own value is lifted towards the white document behind it.
    expect(
      await getDarkPixelBounds(after),
      `The fully dark core the unblurred stroke had (${beforeBounds!.height}px tall) is dispersed by the blur`
    ).toBeNull();

    const afterAnalysis = await getStrokeAnalysis(after, LINE_CAPTURE_REGION);
    expect(afterAnalysis, 'The blurred stroke should still be visible to stroke analysis').not.toBeNull();
    expect(
      afterAnalysis!.verticalSpread,
      `The blurred stroke should cover more rows than the unblurred one (${beforeAnalysis!.verticalSpread})`
    ).toBeGreaterThan(beforeAnalysis!.verticalSpread);
    expect(afterAnalysis!.type, 'The spread soft edge is what the analyser classifies as spray').toBe('spray');

    // ...and the artwork survived: the ink is still there, just spread out and lighter.
    // A blur cannot add ink, so the stroke's value rises towards - never above - the
    // white of the document behind it.
    for (const { name, x, y } of STROKE_SAMPLES) {
      const sampled = await sampleCssPoint(after, x, y, 5, { ignoreNearWhite: true });
      expect(sampled, `The blur erased the stroke at the ${name} of it`).not.toBeNull();
      expect(sampled!.red, `A blur lifts the stroke's value towards the background, not above it`).toBeLessThan(WHITE);
    }
    const afterMiddle = await sampleCssPoint(after, STROKE_MIDDLE.x, STROKE_MIDDLE.y, 5, { ignoreNearWhite: true });
    expect(
      afterMiddle!.red,
      `The middle of the stroke read ${beforeMiddle!.red} before the blur, and a blur can only disperse its ink outwards`
    ).toBeGreaterThan(beforeMiddle!.red);
  });
});
