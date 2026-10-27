import { expect, type Page, test, type TestInfo } from './fixtures/extended-test';
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
 * accessible names read "Size 10px" and "Opacity 100%". Matching the label part alone
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
const BRUSH_OPACITY_READOUT = 'Opacity 100%';
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

/**
 * `PAINT_PRESETS` (src/tools/brush.ts:144-153) and `CUSTOM_PRESET_LABEL` (`:141`), copied
 * rather than imported, on the same terms as `PAINT_BLEND_MODES` above: nothing under
 * `e2e/` may import from `src/`, and a preset added or retuned in the source fails the
 * equality assertion below instead of going untested.
 *
 * `alpha` is stored 0..1 and rendered as a percentage, so the readout carries the converted
 * value — `Math.round(alpha * 100)` — and the conversion is done here rather than read off a
 * capture, so the numbers below are the source's own.
 */
const PAINT_PRESETS = {
  brush: [
    { label: 'Hard Round', lineWidth: 10, alpha: 1, smoothing: 10 },
    { label: 'Soft Round', lineWidth: 40, alpha: 1, smoothing: 60 },
    { label: 'Marker', lineWidth: 24, alpha: 0.45, smoothing: 25 },
  ],
  pencil: [
    { label: 'Hard Pencil', lineWidth: 3, alpha: 1, smoothing: 10 },
    { label: 'Soft Pencil', lineWidth: 12, alpha: 0.7, smoothing: 50 },
    { label: 'Marker', lineWidth: 24, alpha: 0.45, smoothing: 25 },
  ],
} as const;

/** The select's empty value, which `Paint.tsx:159` renders as the Custom option. */
const CUSTOM = '';

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

    // The seeded bar is a NAMED tip, not a hand-tuned one: `matchPaintPreset` reads the
    // live args back and the picker must show `Hard Round` on a fresh document rather than
    // the `Custom` row (HANDOFF §183). This is the assertion the unit suite cannot reach:
    // it runs the derivation through the real bar, not through `defaultSettings` directly.
    await expect(presetSelect(page), 'a freshly seeded brush bar reads as its opening preset').toHaveValue(
      PAINT_PRESETS.brush[0].label
    );

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

    // And its own opening tip: the pencil bar must not read as the brush's `Hard Round`
    // or as Custom on a fresh document, for the same reason the brush assertion above does.
    await expect(presetSelect(page), 'a freshly seeded pencil bar reads as its own opening preset').toHaveValue(
      PAINT_PRESETS.pencil[0].label
    );
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

  /**
   * SELECTING A PRESET, which nothing in the suite did: the two tests above only assert the
   * select is visible, and every other paint test moves the sliders directly. So the whole
   * preset mechanism — the option list, the four-field write in `handlePresetChange`, and the
   * `matchPaintPreset` derivation that decides what the select reads back — was untested
   * end-to-end, and each of those three is a place a regression could hide.
   *
   * The bar's own readouts are the assertion surface, not the `value` attributes. `Paint.tsx`
   * renders each live value INSIDE its `<label>`, so the accessible name is the text a user
   * reads; a select that held the right `value` while the sliders behind it stayed wrong
   * would pass a `value` assertion and fail this one.
   */
  test('each preset writes every one of its four values into the bar', async ({ page }) => {
    await selectBrush(page);
    const preset = presetSelect(page);

    // The option list is asserted as a whole, in order, against the source list: a preset
    // dropped from `PAINT_PRESETS` and a stale option left behind in the markup both show
    // up here rather than as a selectOption that quietly matched nothing.
    const options = await preset
      .locator('option')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ value: (node as HTMLOptionElement).value, label: node.textContent ?? '' }))
      );
    expect(options, 'the preset select must offer Custom first, then the brush presets in source order').toEqual([
      { value: CUSTOM, label: 'Custom' },
      ...PAINT_PRESETS.brush.map((entry) => ({ value: entry.label, label: entry.label })),
    ]);

    // Mark the settings as Custom first, so each selection below has to be an actual write
    // rather than a no-op that happens to match the seeded defaults.
    await sizeSlider(page).fill('37');
    await expect(preset, 'a size no preset carries must read as Custom').toHaveValue(CUSTOM);

    // A blend mode no preset carries, for the same reason: the per-preset assertion below reads
    // the mode as 'source-over', and the bar seeds on that value, so left alone the assertion
    // would pass on a `handlePresetChange` that never wrote the field at all. Every preset
    // declares blendMode 'source-over' (`src/tools/brush.ts:145`-`:147` and `:150`-`:152`), so
    // Multiply here has to be normalised away by the selection.
    await modeSelect(page).selectOption({ label: 'Multiply' });
    await expect(modeSelect(page), 'the mode must be off Normal before a preset is chosen').toHaveValue('multiply');

    for (const entry of PAINT_PRESETS.brush) {
      await preset.selectOption(entry.label);

      await expect(sizeSlider(page), `${entry.label} must carry its own line width`).toHaveAccessibleName(
        `Size ${entry.lineWidth}px`
      );
      await expect(opacitySlider(page), `${entry.label} must carry its own alpha`).toHaveAccessibleName(
        `Opacity ${Math.round(entry.alpha * 100)}%`
      );
      await expect(smoothingSlider(page), `${entry.label} must carry its own smoothing`).toHaveAccessibleName(
        `Smoothing ${entry.smoothing}%`
      );
      // Every preset declares blendMode 'source-over', so this is where a preset that stopped
      // normalising the mode would be caught - and it can only be caught because of the
      // Multiply above.
      await expect(modeSelect(page), `${entry.label} must leave the mode on Normal`).toHaveValue('source-over');
    }
  });

  /**
   * The DERIVATION, which is the half of the preset mechanism a selection test cannot reach:
   * `matchPaintPreset` (`src/tools/brush.ts:159`) reads the live args back and names the
   * matching preset, or Custom when none matches. So the select's displayed value is a
   * function of the sliders, and the two directions of that function are separate claims:
   *
   *   - settings that EQUAL a preset read back as that preset's name, not as Custom;
   *   - a single field moved off a preset reads back as Custom.
   *
   * Both are asserted here because a `matchPaintPreset` that always returned the label, or
   * always returned Custom, satisfies either assertion alone.
   */
  test('the preset select names the settings that match one and Custom once they differ', async ({ page }) => {
    await selectBrush(page);
    const preset = presetSelect(page);
    const [hardRound] = PAINT_PRESETS.brush;

    // Direction one: re-selecting the preset restores every field, which is what makes the
    // select read back as that preset rather than as Custom.
    await preset.selectOption('Soft Round');
    await expect(preset).toHaveValue('Soft Round');
    await preset.selectOption(hardRound.label);

    await expect(sizeSlider(page)).toHaveAccessibleName(`Size ${hardRound.lineWidth}px`);
    await expect(opacitySlider(page)).toHaveAccessibleName(`Opacity ${Math.round(hardRound.alpha * 100)}%`);
    await expect(smoothingSlider(page)).toHaveAccessibleName(`Smoothing ${hardRound.smoothing}%`);
    await expect(preset, 'settings that match a preset must be NAMED by it, not reported as Custom').toHaveValue(
      hardRound.label
    );

    // Direction two: one field off the preset is enough. Smoothing is the field chosen
    // because `Hard Round` carries the seeded Photoshop value, so any move at all leaves
    // the preset.
    await smoothingSlider(page).fill('5');
    await expect(preset, 'one field off a preset must read as Custom').toHaveValue(CUSTOM);

    // And the value is still Custom after the write settles, which is the claim a reader of
    // the select would make: this is not a transient state on the way back to the label.
    await smoothingSlider(page).fill(`${hardRound.smoothing}`);
    await expect(preset, 'restoring the field restores the name').toHaveValue(hardRound.label);

    // Direction two again, on the FOURTH field. `matchPaintPreset` compares `blendMode` with
    // `===` alongside the three numbers, so the Mode counts: a derivation that ignored it would
    // satisfy every assertion above and this one is what catches that.
    await modeSelect(page).selectOption({ label: 'Multiply' });
    await expect(
      preset,
      'matchPaintPreset compares blendMode too, so a Mode change alone must also read as Custom'
    ).toHaveValue(CUSTOM);

    // And Custom is INERT rather than a way to clear the bar. `handlePresetChange` looks the
    // selection up in `PAINT_PRESETS[toolName]` and returns early when it finds nothing
    // (`src/components/ToolbarsRight/Paint/Paint.tsx`), and the empty value IS the Custom
    // option — so choosing it must write nothing at all. `Marker` is the destination because a
    // preset has to be applied first for there to be something there to refuse to change.
    await preset.selectOption('Marker');
    await expect(sizeSlider(page), 'Marker writes its own width').toHaveAccessibleName(
      `Size ${PAINT_PRESETS.brush[2].lineWidth}px`
    );
    await preset.selectOption(CUSTOM);
    await expect(sizeSlider(page), 'selecting Custom must not move the sliders').toHaveAccessibleName(
      `Size ${PAINT_PRESETS.brush[2].lineWidth}px`
    );
    await expect(preset, 'and it must not rename the bar either').toHaveValue('Marker');
  });

  /**
   * The two tools carry INDEPENDENT preset lists, and `Marker` is the one label they share.
   *
   * `PAINT_PRESETS` is keyed by tool name and `handlePresetChange` looks the selection up in
   * `PAINT_PRESETS[toolName]`, so a lookup that ignored the key would let the pencil's Marker
   * write the brush's Marker — which happens to be the same four numbers, and would therefore
   * pass any assertion about Marker's values alone. The discriminating pair is the FIRST
   * preset on each bar: `Hard Round` at 10px and `Hard Pencil` at 3px are different labels on
   * different lists, so an option surviving a tool switch is visible here.
   */
  test('the brush and the pencil carry their own presets', async ({ page }) => {
    await selectBrush(page);
    await expect(presetSelect(page), 'the brush bar must not offer a pencil preset').not.toHaveValue('Hard Pencil');
    const brushLabels = await presetSelect(page)
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    expect(brushLabels, 'the brush bar lists the brush presets').toEqual([
      CUSTOM,
      ...PAINT_PRESETS.brush.map((entry) => entry.label),
    ]);

    await selectPencil(page);
    const pencilLabels = await presetSelect(page)
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    expect(pencilLabels, 'the pencil bar lists the pencil presets, and Marker is the one they share').toEqual([
      CUSTOM,
      ...PAINT_PRESETS.pencil.map((entry) => entry.label),
    ]);

    // The shared label, read off each bar in turn. Equal numbers here are the source's, and
    // a key-blind lookup would produce the same result — so what this proves is that the
    // control survives the switch rather than which preset it wrote.
    await presetSelect(page).selectOption('Marker');
    await expect(sizeSlider(page), 'Marker writes its own width on the pencil bar').toHaveAccessibleName(
      `Size ${PAINT_PRESETS.pencil[2].lineWidth}px`
    );

    // The pencil bar's FIRST preset, which the Marker switch above cannot discriminate: brush
    // Marker and pencil Marker carry identical numbers, so a key-blind lookup writes the same
    // readout either way. `Hard Pencil` is 3px and exists only on the pencil list.
    await presetSelect(page).selectOption('Hard Pencil');
    await expect(sizeSlider(page), 'Hard Pencil writes its own width on the pencil bar').toHaveAccessibleName(
      `Size ${PAINT_PRESETS.pencil[0].lineWidth}px`
    );

    // Back to the brush THROUGH THE FLYOUT, which is not redundancy but necessity: once the
    // pencil is active its group is the one with the tile, so `tool-button-brush` is gone from
    // the rail and `clickToolButton` has no brush to click. Measured rather than assumed —
    // a probe found the brush tile at 1 before the switch and 0 after it.
    await openToolFlyout(page, 'pencil');
    await selectFromFlyout(page, { toolName: 'brush', label: 'Brush Tool' });

    await presetSelect(page).selectOption('Marker');
    await expect(sizeSlider(page), 'and its own on the brush bar').toHaveAccessibleName(
      `Size ${PAINT_PRESETS.brush[2].lineWidth}px`
    );

    // The brush bar's first preset, so the pair with `Hard Pencil` above is the real
    // discriminator between the two lists rather than the label they share.
    await presetSelect(page).selectOption('Hard Round');
    await expect(sizeSlider(page), 'and the brush bar must write its own first preset').toHaveAccessibleName(
      `Size ${PAINT_PRESETS.brush[0].lineWidth}px`
    );
  });
});
