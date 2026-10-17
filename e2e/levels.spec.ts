import { expect, type Page, test, type TestInfo } from './fixtures/extended-test';
import {
  type BoundingBox,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  CANVAS_REDRAW_TIMEOUT_MS,
  DEFAULT_LINE_CLIP,
  type DominantColor,
  drawLine,
  dominantRed,
  getColorAtPoint,
  getWorkspaceCanvas,
  hasDarkPixels,
  hasRedPixels,
  type ImageDataResult,
  isBuffer,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  loadImageData,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { cssPointToImage } from './helpers/screenshot-scale';
import { canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/** `#cc0000`, the colour every spec here strokes with. */
const STROKE_COLOR = '#cc0000';

/**
 * The centre of the stroke in the image `takeLineScreenshot` returns, which crops the
 * canvas to `DEFAULT_LINE_CLIP` (120,120,260,80) measured from the canvas box. The
 * standard test line runs (150,150)->(350,150) in box coordinates, so in that image it
 * spans x 30..230 on row 30 and (130,30) is the middle of the line.
 */
const STROKE_MIDDLE = { x: 130, y: 30 } as const;

/**
 * Samples a point given in CSS pixels within the line capture.
 *
 * `STROKE_MIDDLE` is CSS — it is derived from where `drawLine` puts the stroke and from
 * `DEFAULT_LINE_CLIP`, which is a CSS-pixel rect — while `getColorAtPoint` takes IMAGE
 * pixels. At the suite's 1x the two are the same number and the mismatch cannot be
 * seen. At `deviceScaleFactor: 2`, `page.screenshot` returns a 520x160 image of a
 * 260x80 clip, so image row 30 is CSS row 15: above the stroke, which the measurements
 * put at CSS rows 25..35. Every sampled pixel is white, `ignoreNearWhite` discards
 * them, and the helper returns `null` — a correct suite failing four tests. This is the
 * same class of defect `getStrokeAnalysis` was given a required `region` to fix.
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
    { x: 0, y: 0, width: DEFAULT_LINE_CLIP.width, height: DEFAULT_LINE_CLIP.height },
    { x: cssX, y: cssY }
  );
  // `getColorAtPoint` rejects a non-integer coordinate outright, and `cssPointToImage`
  // returns a float by construction. The point is a location rather than a pixel index,
  // so a fractional answer is expected and nearest is the honest mapping.
  return getColorAtPoint(image, Math.round(point.x), Math.round(point.y), radius, options);
}

async function waitForRedStroke(page: Page, box: BoundingBox): Promise<void> {
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'red pixels' });
}

/**
 * Polls the dominant red of the line clip until `isSettled` accepts the reading, and
 * returns that reading.
 *
 * Two different things are being waited for, and the caller states the second one:
 *
 * - That the stroke is still there. A null reading is never settled, so a line that
 *   disappeared fails this poll instead of satisfying it — which is what a bare
 *   `toBeTruthy()` on the value would have let through once a predicate existed.
 * - That the adjustment has repainted. Brightness and contrast go through a
 *   `requestAnimationFrame` and a layer preview, so a single screenshot taken
 *   immediately after `fill()` can land on the pre-repaint frame. That is why this
 *   polls instead of sampling once.
 *
 * `isSettled` states what the reading has to be, and the caller states it as a
 * DIRECTION the adjustment must move the reading plus the measured value it settles on.
 * Polling `toBe(expectedRed)` on its own is main's shape and it is worse in one specific
 * way: it reports the pre-repaint frame as the answer, so a red reads `expected 141,
 * received 204` — the very number the wait was there to skip. Polling the predicate
 * absorbs that frame, and because the predicate is a conjunction, a frame that is
 * darker than the original but short of the measured value keeps polling rather than
 * being accepted as settled.
 *
 * `name` is the attachment BASE, and every attempt appends its index. A constant name
 * wrote the same `outputDir` path N times and gave N attachments one name, so a
 * failing poll left only the last frame behind — the one least likely to explain
 * anything — and every attempt re-encoded the same path.
 */
async function readRedLine(
  page: Page,
  box: BoundingBox,
  name: string,
  testInfo: TestInfo,
  isSettled: (observed: DominantColor) => boolean,
  failureMessage: string
): Promise<DominantColor> {
  let observed: DominantColor | null = null;
  let attempt = 0;
  await expect
    .poll(
      async () => {
        attempt += 1;
        observed = await dominantRed(await takeLineScreenshot(page, box, `${name}-attempt-${attempt}`, testInfo));
        return observed !== null && isSettled(observed);
      },
      {
        message: failureMessage,
        timeout: CANVAS_REDRAW_TIMEOUT_MS,
        intervals: [CANVAS_REDRAW_POLL_INTERVAL_MS],
      }
    )
    .toBe(true);
  return observed!;
}

/**
 * The dominant red measured for `#cc0000` at brightness `-20`, which emits
 * `brightness(86.67%)` — the proportionate factor `1 - 20/150`.
 *
 * The one thing that is NOT being asserted is a prediction of what Chrome does with
 * that percentage - the repo documents nothing about the colour space canvas 2D
 * evaluates filters in, and guessing one is how a pin ends up asserting a lie. The
 * number is what this suite measured on this app, checked stable across repeated
 * retries-0 runs. If the exposure curve in `buildLevelsFilter` ever changes, this is
 * supposed to fail.
 *
 * The arithmetic that predicts it, kept because it is checkable and because the pin is
 * otherwise a bare number: the stroke's own red is 204, `brightness(86.67%)` scales the
 * LAYER to `204 * 0.8667 = 176.81`, and the stroke composites at the draw tool's
 * `alpha: 0.9` over a white document, so the screenshot reads
 * `0.9 * 176.81 + 0.1 * 255 = 184.63`, i.e. 185. The same model reproduces the
 * measurement this replaced — at the old `brightness(62.83%)` it gives 141 — which is
 * what makes it more than a fit to one run.
 */
const MEASURED_BRIGHTNESS_MINUS_20_RED = 185;

/**
 * The composed red of the UNADJUSTED stroke, which is what makes the two direction
 * assertions below mean anything.
 *
 * `original.red` is the left-hand side of "the red must fall" and "the red must rise".
 * Read without a check, it is whatever the clip happened to contain, so a stroke in the
 * wrong colour, a partial stroke, or a clip that landed on something else entirely
 * satisfies both directions — the comparison would be a line against itself.
 *
 * `#cc0000` at the draw tool's `alpha: 0.9` (`src/tools/settings.ts`) over a white
 * document composites to `0.9 * 204 + 0.1 * 255 = 209.16`, and this is a TOLERANCE
 * around that composition, not a pin on it. Measured on this host: 209 on a 1x capture
 * and 210 on a 2x one, byte-identical code. `dominantRed` buckets exact colours, so
 * the reading moves by one when the capture's scale changes the anti-aliased edge
 * population — which is the whole reason `getStrokeAnalysis` was given a required
 * `region` rather than an assumed scale. An exact pin here is how this file failed at
 * `deviceScaleFactor: 2` before the band was written.
 */
const UNADJUSTED_STROKE_RED = 209;
const UNADJUSTED_STROKE_RED_TOLERANCE = 2;

/**
 * The dominant red measured for `#cc0000` at contrast `50`, which emits
 * `contrast(150%)` — the proportionate factor `1 + 50/100`.
 *
 * **This value is the point of the whole change, so it is not clamped.** `contrast()` is
 * anchored at mid grey and clamps, so it clips every channel above `127.5 + 127.5 / f`. At
 * `f = 1.5` that knee is 212.5, and the stroke's red of 204 sits below it — so nothing
 * clips, and the measured red is the layer's own remapped value carried through the
 * stroke's `0.9` alpha: `(204 - 127.5) * 1.5 + 127.5 = 242.25`, then
 * `0.9 * 242.25 + 0.1 * 255 = 243.53`, i.e. 244.
 *
 * The pin this replaces was the opposite: the old exponential emitted `contrast(325.39%)`,
 * whose knee of 166.7 put 204 well past it, so the reading was `255` and proved only that
 * the channel saturated. It could not tell a clipped highlight from a curve that preserved
 * one. A reading of 244 is a tonal value, so it is evidence.
 */
const MEASURED_CONTRAST_50_RED = 244;

/**
 * The stroke's core at brightness `-150`, which emits `brightness(0%)` because the
 * proportionate factor `1 - 150/150` is exactly zero.
 *
 * Multiplying every channel by zero is exact in any colour space, in any evaluation
 * order, and with or without anti-aliasing, so the layer's own pixels become (0,0,0)
 * whatever the filter does. What reaches the screenshot is the document showing through
 * the stroke's 0.9 alpha, so the composited core is neutral rather than literally black.
 *
 * `-150` is where `brightness(0%)` lives now, and it is a different number than it was:
 * under the removed exponential that endpoint was `-100`, whose factor re-anchored to
 * zero only because of the floor term. Nothing about the measured core changed with it.
 */
const MEASURED_BRIGHTNESS_MINUS_150_CORE = { red: 26, green: 26, blue: 26 };

/** Re-measures the canvas box after an adjustment panel has opened. */
async function remeasureCanvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  expect(box, 'Canvas should have visible coordinates after opening Levels').not.toBeNull();
  return box!;
}

/**
 * Selects the Levels panel through `Image ▸ Adjustments ▸ Brightness/Contrast`.
 *
 * THREE clicks, and the middle one is not optional: `image-menu-adjustments-button` is a
 * `<button aria-haspopup="true">` with no hover handler, so the submenu is unmounted until it
 * is clicked. `levels` is an `Image ▸ Adjustments` COMMAND, not a tool — it has no rail tile
 * and no `tools-menu-levels-button`, and the `[Colors, Levels, Transform]` flyout that used to
 * hold it is gone from `toolbarMap`.
 *
 * NOT `image-menu-adjustments-levels-button`. That button exists, it carries the label
 * `Levels`, and it is `disabled` — the real `Levels` adjustment is unbuilt, so the item
 * carrying that name selects nothing. `Brightness/Contrast` is the enabled item that mounts
 * the `levels` panel these specs drive, and the slug is `slugifyToolLabel('Brightness/Contrast')`
 * (`toolbar-mapping.ts`), i.e. the `/` collapsed to one `-`.
 */
async function openLevelsTool(page: Page): Promise<void> {
  await page.getByTestId('header-image-menu-button').click();
  await page.getByTestId('image-menu-adjustments-button').click();
  await page.getByTestId('image-menu-adjustments-brightness-contrast-button').click();
}

// The Levels sliders are labelled by a <label for> plus a live value suffix, so their
// accessible names read "Brightness 0%" and "Contrast 0%" — `defaultSettings.levels`
// is `{ brightness: 0, contrast: 0 }` and a fresh context starts there. Matching the
// label part alone survives the value suffix changing and needs no knowledge of the
// slider ids.
test.describe('Levels adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // changes red line via brightness
  test('changes red line via brightness', async ({ page }, testInfo) => {
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    // Select Draw tool and draw a line
    await clickToolButton(page, 'draw');
    // The draw tool only strokes with the active foreground color once it is the active
    // tool, so the color has to be set after activation; verifySwatch then proves the
    // store the draw tool reads actually holds it.
    // SET COLOR via native setter (triggers React onChange)
    // This bypasses React's "value unchanged" check and reaches delegated listeners
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    // Image ▸ Adjustments ▸ Brightness/Contrast is the item that selects the Levels panel.
    await openLevelsTool(page);

    const brightness = page.getByRole('slider', { name: /Brightness/ });
    await expect(brightness).toBeVisible();

    // ONE clip rect for both readings, and it is measured AFTER the panel opens. The
    // panel changes the options bar, which moves the canvas, so a rect measured before
    // it opened describes a different region of the page. The old order took the
    // "before" reading through the old rect and the "after" reading through the new
    // one and then asserted only that the two reds DIFFERED — which any two regions
    // of the page satisfy. Re-reading the unmodified line through the final geometry
    // is the only way to get a like-for-like pair: the pre-change colour is not
    // recoverable after the fact.
    const adjustedBox = await remeasureCanvasBox(page);

    const original = await readRedLine(
      page,
      adjustedBox,
      'levels-original',
      testInfo,
      () => true,
      'Red line not found on the original stroke through the post-open geometry'
    );
    // Without this, both direction assertions compare a reading against itself.
    expect(
      Math.abs(original.red - UNADJUSTED_STROKE_RED),
      'the unadjusted stroke is not the red the direction assertions are measured against'
    ).toBeLessThanOrEqual(UNADJUSTED_STROKE_RED_TOLERANCE);

    await brightness.fill('-20');
    await expect(brightness).toHaveValue('-20');

    // Brightness -20 is `brightness(86.67%)` on the layer — `buildLevelsFilter` feeds the
    // signed slider through the proportionate factor `1 - 20/150` — so every channel is
    // scaled down and the line's red must DROP. A direction, not a difference: "the two
    // numbers are not equal" was satisfied by any pair of differently-sampled pixels
    // and by an adjustment that moved the line the wrong way.
    const afterBrightness = await readRedLine(
      page,
      adjustedBox,
      'levels-brightness',
      testInfo,
      (observed) => observed.red < original.red && observed.red === MEASURED_BRIGHTNESS_MINUS_20_RED,
      'Brightness -20 must darken the line to the red it is measured to produce: no reading through the same clip rect ever came back darker AND on 185'
    );
    expect(afterBrightness.red, 'brightness -20 makes the line darker, not lighter').toBeLessThan(original.red);
    expect(afterBrightness.red, 'brightness -20 is measured to produce this red').toBe(
      MEASURED_BRIGHTNESS_MINUS_20_RED
    );
  });

  // changes red line via contrast
  test('changes red line via contrast', async ({ page }, testInfo) => {
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    // Select Draw tool and draw a line
    await clickToolButton(page, 'draw');
    // See the brightness test: the color is set after the tool is active, and
    // verifySwatch asserts the store the draw tool strokes with kept it.
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    // Image ▸ Adjustments ▸ Brightness/Contrast is the item that selects the Levels panel.
    await openLevelsTool(page);

    const contrast = page.getByRole('slider', { name: /Contrast/ });
    await expect(contrast).toBeVisible();

    // See the brightness test: one clip rect for both readings, measured after the
    // panel opened, with the pre-change reading re-taken through it.
    const adjustedBox = await remeasureCanvasBox(page);

    const original = await readRedLine(
      page,
      adjustedBox,
      'levels-original-contrast',
      testInfo,
      () => true,
      'Red line not found on the original stroke through the post-open geometry'
    );
    // Without this, both direction assertions compare a reading against itself.
    expect(
      Math.abs(original.red - UNADJUSTED_STROKE_RED),
      'the unadjusted stroke is not the red the direction assertions are measured against'
    ).toBeLessThanOrEqual(UNADJUSTED_STROKE_RED_TOLERANCE);

    // 0 is the default, so this is a real change rather than a re-set of the value
    // the panel arrived with — which is what the old body did not establish.
    await contrast.fill('50');
    await expect(contrast).toHaveValue('50');

    // Contrast +50 is `contrast(150%)` — the proportionate factor `1 + 50/100` — which pushes
    // the line's red up WITHOUT clipping it: the knee at 212.5 is above this stroke's 204,
    // so the reading is a tonal value rather than a saturated one. That is the difference
    // this assertion exists to catch. The old curve emitted `contrast(325.39%)`, whose knee
    // of 166.7 put 204 past the clamp, and the reading was `255` — a pass that proved only
    // that the channel saturated, which a curve destroying its highlights also produces.
    const afterContrast = await readRedLine(
      page,
      adjustedBox,
      'levels-contrast',
      testInfo,
      (observed) => observed.red > original.red && observed.red === MEASURED_CONTRAST_50_RED,
      'Contrast +50 must brighten the line to the red it is measured to produce: no reading through the same clip rect ever came back brighter AND on 244'
    );
    expect(afterContrast.red, 'contrast +50 makes the line more contrasty, so its red rises').toBeGreaterThan(
      original.red
    );
    expect(afterContrast.red, 'contrast 50 is measured to produce this red').toBe(MEASURED_CONTRAST_50_RED);
  });

  // brightness -150 emits brightness(0%), which is exact in every colour space
  test('darkens the red stroke to neutral black at brightness -150', async ({ page }, testInfo) => {
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    const original = await takeLineScreenshot(page, box!, 'levels-minus-100-original', testInfo);
    expect(await hasRedPixels(original), 'The stroke should be red before the adjustment').toBe(true);
    // `hasDarkPixels` needs all three channels under 60, and no pixel of this stroke
    // ever is: even its darkest green and blue ride on a red channel above 200. So the
    // state waited for below cannot have existed before the slider moved.
    expect(await hasDarkPixels(original), 'The unadjusted stroke should have no dark pixel').toBe(false);

    await openLevelsTool(page);
    const adjustedBox = await remeasureCanvasBox(page);

    const brightness = page.getByRole('slider', { name: /Brightness/ });
    await expect(brightness).toBeVisible();
    await brightness.fill('-150');
    await expect(brightness).toHaveValue('-150');

    // A genuine wait for the repaint: the state being waited for did not exist before
    // the slider moved.
    await waitForCanvasPixels(page, canvasRedrawClip(adjustedBox), hasDarkPixels, {
      description: 'the stroke darkened at brightness -150',
    });

    const after = await takeLineScreenshot(page, adjustedBox, 'levels-minus-100', testInfo);
    expect(await hasDarkPixels(after), 'brightness(0%) must leave the stroke dark').toBe(true);
    expect(await hasRedPixels(after), 'brightness(0%) must leave no red pixel behind').toBe(false);

    // `brightness(0%)` multiplies every channel by zero, so the layer's own pixels are
    // (0,0,0) whatever colour space the filter is evaluated in. What the screenshot
    // sees is the white document composited through the stroke's 0.9 alpha, which is a
    // neutral grey and identical in all three channels.
    const core = await sampleCssPoint(after, STROKE_MIDDLE.x, STROKE_MIDDLE.y, 0, { ignoreNearWhite: true });
    expect(core, 'brightness(0%) left no ink at the middle of the stroke').not.toBeNull();
    expect(core, 'brightness(0%) must drive all three channels of the stroke to the same value').toEqual(
      MEASURED_BRIGHTNESS_MINUS_150_CORE
    );
  });

  // Default settings must not touch the stroke: opening the panel without moving a slider
  // leaves the dominant red exactly where it was.
  test('default is a no-op', async ({ page }, testInfo) => {
    test.setTimeout(CANVAS_REDRAW_TIMEOUT_MS + 5000);
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    const before = await dominantRed(await takeLineScreenshot(page, box!, 'levels-default-before', testInfo));
    expect(before, 'the stroke should be present before opening Levels').not.toBeNull();

    await openLevelsTool(page);
    const adjustedBox = await remeasureCanvasBox(page);

    const after = await readRedLine(
      page,
      adjustedBox,
      'levels-default-after',
      testInfo,
      () => true,
      'Red line not found after opening Levels without moving a slider'
    );

    expect(after.red, 'opening Levels must not change the dominant red').toBe(before!.red);
  });

  // Brightness at its maximum travel drives the stroke brighter than the original.
  test('brightness +150 brightens the stroke', async ({ page }, testInfo) => {
    test.setTimeout(CANVAS_REDRAW_TIMEOUT_MS + 5000);
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    await openLevelsTool(page);
    const adjustedBox = await remeasureCanvasBox(page);

    const brightness = page.getByRole('slider', { name: /Brightness/ });
    await expect(brightness).toBeVisible();

    const original = await readRedLine(
      page,
      adjustedBox,
      'levels-original-brightness-150',
      testInfo,
      () => true,
      'Red line not found on the original stroke through the post-open geometry'
    );
    expect(
      Math.abs(original.red - UNADJUSTED_STROKE_RED),
      'the unadjusted stroke is not the red the direction assertions are measured against'
    ).toBeLessThanOrEqual(UNADJUSTED_STROKE_RED_TOLERANCE);

    await brightness.fill('150');
    await expect(brightness).toHaveValue('150');

    const after = await readRedLine(
      page,
      adjustedBox,
      'levels-brightness-150',
      testInfo,
      (observed) => observed.red > original.red && observed.red === 255,
      'Brightness +150 must drive the red channel to clipped white'
    );
    expect(after.red, 'brightness +150 makes the line brighter, not darker').toBeGreaterThan(original.red);
    expect(after.red, 'brightness +150 clips the red channel to 255').toBe(255);
  });

  // Contrast at its minimum compresses the stroke toward mid-grey.
  test('contrast -50 compresses toward mid-grey', async ({ page }, testInfo) => {
    test.setTimeout(CANVAS_REDRAW_TIMEOUT_MS + 5000);
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    await openLevelsTool(page);
    const adjustedBox = await remeasureCanvasBox(page);

    const contrast = page.getByRole('slider', { name: /Contrast/ });
    await expect(contrast).toBeVisible();

    const original = await readRedLine(
      page,
      adjustedBox,
      'levels-original-contrast-minus-50',
      testInfo,
      () => true,
      'Red line not found on the original stroke through the post-open geometry'
    );
    expect(
      Math.abs(original.red - UNADJUSTED_STROKE_RED),
      'the unadjusted stroke is not the red the direction assertions are measured against'
    ).toBeLessThanOrEqual(UNADJUSTED_STROKE_RED_TOLERANCE);

    await contrast.fill('-50');
    await expect(contrast).toHaveValue('-50');

    const after = await readRedLine(
      page,
      adjustedBox,
      'levels-contrast-minus-50',
      testInfo,
      (observed) => observed.red < original.red && observed.red > 0,
      'Contrast -50 must drop the red toward mid-grey without reaching black'
    );
    expect(after.red, 'contrast -50 makes the line darker').toBeLessThan(original.red);
    expect(after.red, 'contrast -50 keeps the red above 0').toBeGreaterThan(0);
  });

  // Combined brightness + contrast clips the channel to white.
  test('brightness +75 and contrast +50 combined clip to white', async ({ page }, testInfo) => {
    test.setTimeout(CANVAS_REDRAW_TIMEOUT_MS + 5000);
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    await openLevelsTool(page);
    const adjustedBox = await remeasureCanvasBox(page);

    const brightness = page.getByRole('slider', { name: /Brightness/ });
    const contrast = page.getByRole('slider', { name: /Contrast/ });
    await expect(brightness).toBeVisible();
    await expect(contrast).toBeVisible();

    const original = await readRedLine(
      page,
      adjustedBox,
      'levels-original-combined',
      testInfo,
      () => true,
      'Red line not found on the original stroke through the post-open geometry'
    );
    expect(
      Math.abs(original.red - UNADJUSTED_STROKE_RED),
      'the unadjusted stroke is not the red the direction assertions are measured against'
    ).toBeLessThanOrEqual(UNADJUSTED_STROKE_RED_TOLERANCE);

    await brightness.fill('75');
    await expect(brightness).toHaveValue('75');
    await contrast.fill('50');
    await expect(contrast).toHaveValue('50');

    const after = await readRedLine(
      page,
      adjustedBox,
      'levels-combined',
      testInfo,
      (observed) => observed.red > original.red && observed.red === 255,
      'Brightness +75 and Contrast +50 must clip the red channel to 255'
    );
    expect(after.red, 'combined adjustment drives the red to clipped white').toBe(255);
  });
});
