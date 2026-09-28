import { expect, type Page, test, type TestInfo } from '@playwright/test';
import {
  type BoundingBox,
  type ClipOptions,
  drawLine,
  getColorAtPoint,
  getDarkPixelBounds,
  getWorkspaceCanvas,
  hasDarkPixels,
  loadImageData,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

/**
 * The paint controls are labelled by a `<label for>` plus a live value suffix, so their
 * accessible names read "Size 10px" and "Opacity 90%". Matching the label part alone
 * survives the value suffix changing as the slider moves, and needs no knowledge of the
 * control ids - the same rule `levels.spec.ts` follows for its own sliders.
 */
const sizeSlider = (page: Page) => page.getByRole('slider', { name: /^Size/ });
const opacitySlider = (page: Page) => page.getByRole('slider', { name: /^Opacity/ });
const smoothingSlider = (page: Page) => page.getByRole('slider', { name: /^Smoothing/ });
const modeSelect = (page: Page) => page.getByRole('combobox', { name: 'Mode', exact: true });
const presetSelect = (page: Page) => page.getByRole('combobox', { name: 'Brush Preset', exact: true });

/** Seeded readouts: `defaultSettings.brush` and `defaultSettings.pencil` in src/tools/settings.ts. */
const BRUSH_SIZE_READOUT = 'Size 10px';
const BRUSH_OPACITY_READOUT = 'Opacity 90%';
const BRUSH_SMOOTHING_READOUT = 'Smoothing 10%';
const PENCIL_SIZE_READOUT = 'Size 3px';

/**
 * The label -> value pairing of `PAINT_BLEND_MODES` (src/tools/brush.ts), copied rather
 * than imported: nothing under `e2e/` may import from `src/`. The copy is deliberate, in
 * the same spirit as `generateSlug` in toolbar-helpers.ts duplicating `slugifyToolLabel` -
 * a mode added to the source list fails the equality assertion below instead of silently
 * going untested.
 */
const PAINT_BLEND_MODES = [
  { label: 'Normal', value: 'source-over' },
  { label: 'Darken', value: 'darken' },
  { label: 'Multiply', value: 'multiply' },
  { label: 'Color Burn', value: 'color-burn' },
  { label: 'Lighten', value: 'lighten' },
  { label: 'Screen', value: 'screen' },
  { label: 'Color Dodge', value: 'color-dodge' },
  { label: 'Overlay', value: 'overlay' },
  { label: 'Soft Light', value: 'soft-light' },
  { label: 'Hard Light', value: 'hard-light' },
  { label: 'Difference', value: 'difference' },
  { label: 'Exclusion', value: 'exclusion' },
  { label: 'Hue', value: 'hue' },
  { label: 'Saturation', value: 'saturation' },
  { label: 'Color', value: 'color' },
  { label: 'Luminosity', value: 'luminosity' },
] as const;

const THIN_SIZE = '4';
const WIDE_SIZE = '60';
const FAINT_OPACITY = '15';
const SOLID_OPACITY = '100';

const STROKE_START_X = 150;
const STROKE_END_X = 400;
const STROKE_STEPS = 20;

/** Rows are a fraction of the canvas box, so the two strokes never share a clip at any viewport. */
const THIN_ROW = 0.3;
const WIDE_ROW = 0.7;
const CLIP_X = 120;
const CLIP_WIDTH = 320;
/** A 4px tip fits in +/-40 of its row; a 60px one needs +/-80. */
const THIN_CLIP_HEIGHT = 80;
const WIDE_CLIP_HEIGHT = 160;

/**
 * The captured height of a 60px tip against a 4px one, as a ratio rather than a pixel
 * count. The tip is authored in image pixels but measured in capture pixels, so its
 * apparent width also carries the canvas scale and the host's device pixel ratio; a ratio
 * holds wherever that lands, and 15x of headroom still fails loudly if the Size control
 * stops reaching the raster.
 */
const WIDE_TO_THIN_MIN_RATIO = 3;

/** Radius of the window `hasPaintedCentre` samples, in capture pixels. */
const CENTRE_SAMPLE_RADIUS = 5;

/** Brush is its group's primary tool, so a plain click selects it without opening the flyout. */
async function selectBrush(page: Page): Promise<void> {
  await clickToolButton(page, 'brush');
}

/** The pencil is a secondary tool in the same group, so it comes out of the flyout. */
async function selectPencil(page: Page): Promise<void> {
  await openToolFlyout(page, 'brush');
  await selectFromFlyout(page, { toolName: 'pencil', label: 'Pencil Tool' });
}

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so strokes cannot be placed');
  return box;
}

function rowY(box: BoundingBox, row: number): number {
  return Math.round(box.height * row);
}

/** Clip around one stroke row, in page coordinates like every other clip in the suite. */
function rowClip(box: BoundingBox, row: number, height: number): Required<ClipOptions> {
  return {
    x: box.x + CLIP_X,
    y: box.y + rowY(box, row) - Math.round(height / 2),
    width: CLIP_WIDTH,
    height,
  };
}

/**
 * A 15% stroke is nowhere near the dark threshold, so `hasDarkPixels` can never observe
 * it and would time out on it. Poll the middle of the clip for a pixel that is no longer
 * near-white instead: that is the stroke reaching the backing store, which is the only
 * event the dark-pixel wait would have been waiting for.
 */
const hasPaintedCentre: CanvasPixelPredicate = async (screenshot) => {
  const { width, height } = await loadImageData(screenshot);
  const centre = await getColorAtPoint(
    screenshot,
    Math.round(width / 2),
    Math.round(height / 2),
    CENTRE_SAMPLE_RADIUS,
    { ignoreNearWhite: true }
  );
  return centre !== null;
};

/**
 * Waits for the stroke to reach the backing store, then measures its height in capture
 * pixels. The capture is a one-shot read, so the wait has to come first or a slow frame
 * silently weakens the measurement.
 */
async function measureStrokeHeight(
  page: Page,
  box: BoundingBox,
  testInfo: TestInfo,
  name: string,
  clip: Required<ClipOptions>
): Promise<number> {
  await waitForCanvasPixels(page, clip, hasDarkPixels, { description: `the ${name} stroke` });
  const bounds = await getDarkPixelBounds(await takeLineScreenshot(page, box, name, testInfo, clip));
  if (!bounds) throw new Error(`${name}: getDarkPixelBounds found no dark pixels, so the stroke height is unmeasured`);
  return bounds.height;
}

test.describe('Brush and Pencil options bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // The bar only renders once the store has an image, which is what this proves.
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  // brush tool
  test('brush tool exposes the Photoshop paint controls', async ({ page }) => {
    await selectBrush(page);

    await expect(presetSelect(page)).toBeVisible();
    await expect(sizeSlider(page)).toBeVisible();
    await expect(modeSelect(page)).toBeVisible();
    await expect(opacitySlider(page)).toBeVisible();
    await expect(smoothingSlider(page)).toBeVisible();

    // The readouts are the label text, so this asserts the seeded defaults reached both
    // the control and the text a user reads next to it.
    await expect(sizeSlider(page), 'the brush seeds its own Size default').toHaveAccessibleName(BRUSH_SIZE_READOUT);
    await expect(opacitySlider(page), 'the brush seeds its own Opacity default').toHaveAccessibleName(
      BRUSH_OPACITY_READOUT
    );
    await expect(smoothingSlider(page), 'the brush seeds the Photoshop Smoothing default').toHaveAccessibleName(
      BRUSH_SMOOTHING_READOUT
    );
    await expect(modeSelect(page), 'the brush seeds Normal').toHaveValue('source-over');

    // A regression to a placeholder bar would swap the controls above for a TODO badge,
    // so pin that no placeholder text is on the page while the brush is selected.
    await expect(page.getByText('TODO'), 'the paint bar must not render placeholder text').toHaveCount(0);
  });

  // pencil tool
  test('pencil tool exposes the same paint controls', async ({ page }) => {
    await selectPencil(page);

    await expect(presetSelect(page)).toBeVisible();
    await expect(sizeSlider(page)).toBeVisible();
    await expect(modeSelect(page)).toBeVisible();
    await expect(opacitySlider(page)).toBeVisible();
    await expect(smoothingSlider(page)).toBeVisible();

    // The pencil's own seeded default, not the brush's 10px: this is what proves the two
    // tools carry independent settings rather than one shared bar state.
    await expect(sizeSlider(page), 'the pencil seeds its own Size default').toHaveAccessibleName(PENCIL_SIZE_READOUT);
  });

  // brush tool
  test('a larger brush size lays down a wider stroke', async ({ page }, testInfo) => {
    await selectBrush(page);
    const box = await canvasBox(page);

    const thinRow = rowY(box, THIN_ROW);
    const thinClip = rowClip(box, THIN_ROW, THIN_CLIP_HEIGHT);
    await sizeSlider(page).fill(THIN_SIZE);
    await drawLine(page, box, STROKE_START_X, thinRow, STROKE_END_X, thinRow, { steps: STROKE_STEPS });
    const thinHeight = await measureStrokeHeight(page, box, testInfo, 'brush-size-4', thinClip);

    const wideRow = rowY(box, WIDE_ROW);
    const wideClip = rowClip(box, WIDE_ROW, WIDE_CLIP_HEIGHT);
    await sizeSlider(page).fill(WIDE_SIZE);
    await drawLine(page, box, STROKE_START_X, wideRow, STROKE_END_X, wideRow, { steps: STROKE_STEPS });
    const wideHeight = await measureStrokeHeight(page, box, testInfo, 'brush-size-60', wideClip);

    expect(
      wideHeight,
      `a ${WIDE_SIZE}px tip measures ${wideHeight}px against the ${THIN_SIZE}px tip's ${thinHeight}px`
    ).toBeGreaterThan(thinHeight * WIDE_TO_THIN_MIN_RATIO);
  });

  // brush tool
  test('a low opacity stroke leaves no dark pixels behind', async ({ page }, testInfo) => {
    await selectBrush(page);
    const box = await canvasBox(page);

    const faintRow = rowY(box, THIN_ROW);
    const faintClip = rowClip(box, THIN_ROW, THIN_CLIP_HEIGHT);
    await opacitySlider(page).fill(FAINT_OPACITY);
    await drawLine(page, box, STROKE_START_X, faintRow, STROKE_END_X, faintRow, { steps: STROKE_STEPS });
    await waitForCanvasPixels(page, faintClip, hasPaintedCentre, {
      description: `a non-background pixel from the ${FAINT_OPACITY}% stroke`,
    });
    const faint = await takeLineScreenshot(page, box, 'brush-opacity-15', testInfo, faintClip);
    expect(
      await hasDarkPixels(faint),
      `a ${FAINT_OPACITY}% black stroke over white stays well above the dark threshold`
    ).toBe(false);

    const solidRow = rowY(box, WIDE_ROW);
    const solidClip = rowClip(box, WIDE_ROW, WIDE_CLIP_HEIGHT);
    await opacitySlider(page).fill(SOLID_OPACITY);
    await drawLine(page, box, STROKE_START_X, solidRow, STROKE_END_X, solidRow, { steps: STROKE_STEPS });
    await waitForCanvasPixels(page, solidClip, hasDarkPixels, { description: `the ${SOLID_OPACITY}% stroke` });
    const solid = await takeLineScreenshot(page, box, 'brush-opacity-100', testInfo, solidClip);
    expect(await hasDarkPixels(solid), `a ${SOLID_OPACITY}% black stroke must lay down dark pixels`).toBe(true);
  });

  // brush tool
  test('the paint settings survive a switch to another tool and back', async ({ page }) => {
    await selectBrush(page);

    const size = '77';
    const opacity = '42';
    const smoothing = '63';
    await sizeSlider(page).fill(size);
    await opacitySlider(page).fill(opacity);
    await smoothingSlider(page).fill(smoothing);
    await modeSelect(page).selectOption({ label: 'Multiply' });

    // The persistence contract src/util/settings.ts provides: without it the bar
    // re-seeds from `{ toolName }` on the way back and every control silently resets.
    await clickToolButton(page, 'reposition');
    // The bar unmounts with the tool, so this pins that the round trip below really
    // re-mounted it rather than asserting against a bar that never went away.
    await expect(sizeSlider(page), 'the paint bar unmounts with the tool').toBeHidden();
    await selectBrush(page);

    await expect(sizeSlider(page), 'Size must survive the tool switch').toHaveValue(size);
    await expect(opacitySlider(page), 'Opacity must survive the tool switch').toHaveValue(opacity);
    await expect(smoothingSlider(page), 'Smoothing must survive the tool switch').toHaveValue(smoothing);
    await expect(modeSelect(page), 'Mode must survive the tool switch').toHaveValue('multiply');

    // The readouts are the other half of the contract: the value a user reads has to
    // follow the control, not only the control's own state.
    await expect(sizeSlider(page), 'the Size readout must follow the control').toHaveAccessibleName(`Size ${size}px`);
    await expect(opacitySlider(page), 'the Opacity readout must follow the control').toHaveAccessibleName(
      `Opacity ${opacity}%`
    );
    await expect(smoothingSlider(page), 'the Smoothing readout must follow the control').toHaveAccessibleName(
      `Smoothing ${smoothing}%`
    );
  });

  // brush tool
  test('every listed blend mode is selectable on the brush bar', async ({ page }) => {
    await selectBrush(page);

    const mode = modeSelect(page);
    await expect(mode).toBeVisible();

    const rendered = await mode.locator('option').evaluateAll((options) =>
      options.map((option) => ({
        label: option.textContent ?? '',
        value: (option as HTMLOptionElement).value,
      }))
    );
    expect(rendered, 'the Mode select must expose exactly the blend modes the paint tools define, in order').toEqual(
      PAINT_BLEND_MODES
    );

    for (const { label, value } of PAINT_BLEND_MODES) {
      await mode.selectOption({ label });
      await expect(mode, `Mode must read ${value} after selecting "${label}"`).toHaveValue(value);
    }

    await mode.selectOption({ label: 'Normal' });
    await expect(mode, 'the bar is left on Normal').toHaveValue('source-over');
  });
});
