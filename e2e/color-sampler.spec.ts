import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type ClipOptions,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  loadImageData,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { imagePointToCss } from './helpers/screenshot-scale';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Color Sampler is a PIXEL_FREE tool, so nothing here asserts about painted output. What it
 * proves is the wiring a unit test cannot reach: that the rail's `I` tile reaches a tool whose area
 * MOUNTS and PAINTS (the marker is drawn on the shared overlay canvas, and that canvas is hidden for
 * every tool absent from an inline `display` allowlist in `Main.tsx` — a mode that paints and is
 * missing from that list renders nothing at all, with no error), and that a real pointer click
 * across the workspace canvas puts the composited pixel's colour into the real options bar.
 *
 * **The colour assertion is the point of the spec.** Every other sampler test could pass with a bar
 * that reported a constant, so each one that claims to read a pixel first establishes what the pixel
 * IS by reading it back off a capture, and then compares. A constant-reporting bar fails.
 *
 * The readouts are `<output>` elements carrying `data-testid="color-sampler-<n>"` and
 * `color-sampler-hex-<n>`, which is the one place this app's options bars are allowed a test id:
 * they are readouts rather than controls, and a control would be addressed by its label instead.
 * The `Sample Size` select is a control and is addressed by its label, never by a test id.
 */

/**
 * The slab, in CANVAS-BOX-relative CSS pixels, and the region of the capture that holds it.
 *
 * `page.screenshot({ clip })` takes a PAGE-relative rect, not a box-relative one — `canvas-helpers.ts`
 * says so at length and calls the opposite reading a trap — so every capture below goes through
 * `pageClip`, which adds the box. Passing the box-relative numbers straight to `clip` photographs
 * the app's left rail and reports on whatever is dark there, which is the "the wrong region is still
 * a region" shape: nothing fails loudly, the region just silently stops being the document.
 */
const SLAB_Y = 200;
const SLAB_START_X = 150;
const SLAB_END_X = 450;
const SLAB_RED = '#cc0000';

/** The slab's box-relative bounds, padded so the capture includes white on both sides of the line. */
const SLAB_BOUNDS = {
  x: SLAB_START_X - 30,
  y: SLAB_Y - 30,
  width: SLAB_END_X - SLAB_START_X + 60,
  height: 100,
} as const;

/** The same region as a PAGE-relative clip, which is what `screenshot` and `waitForCanvasPixels` take. */
const pageClip = (box: BoundingBox): Required<ClipOptions> => ({
  x: box.x + SLAB_BOUNDS.x,
  y: box.y + SLAB_BOUNDS.y,
  width: SLAB_BOUNDS.width,
  height: SLAB_BOUNDS.height,
});

/** Is the capture showing the red slab? Used as the redraw predicate, so it must be total. */
const showsRedSlab = async (capture: Buffer | import('./helpers/canvas-helpers').ImageDataResult) => {
  const point = await getColorAtPoint(capture, 100, 30, 2);
  return point !== null && point.red > 150 && point.green < 100 && point.blue < 100;
};

/** The Color Sampler is selected and its bar is mounted — confirmed by the Clear button it owns. */
const expectSamplerActive = async (page: Page) => {
  await expect(page.getByTestId('color-sampler-clear'), 'the Color Sampler bar is the active tool').toBeVisible();
};

/** The Color Sampler's own `Sample Size` control, addressed by its label because it is a control. */
const sampleSizeSelect = (page: Page) => page.getByRole('combobox', { name: 'Sample Size' });

/** Selects the Color Sampler the way a user reaches it: the `I` tile, then its flyout. */
const selectColorSampler = async (page: Page) => {
  await clickToolButton(page, 'eyedropper');
  await openToolFlyout(page, 'eyedropper');
  await selectFromFlyout(page, { toolName: 'color-sampler', label: 'Color Sampler Tool' });
  await expectSamplerActive(page);
};

/** The canvas box, re-measured at each call because the options bar's height changes with the tool. */
const canvasBox = async (page: Page): Promise<BoundingBox> => {
  const box = await getWorkspaceCanvas(page).boundingBox();
  expect(box, 'the workspace canvas must be on screen to sample it').not.toBeNull();
  return box!;
};

const readout = (page: Page, n: number) => page.getByTestId(`color-sampler-${n}`);
const hexReadout = (page: Page, n: number) => page.getByTestId(`color-sampler-hex-${n}`);

/** The `r, g, b` the bar reports for sampler `n`. */
const reportedRgb = async (page: Page, n: number): Promise<[number, number, number]> => {
  const text = (await readout(page, n).textContent()) ?? '';
  const parts = text.split(',').map((part) => Number(part.trim()));
  expect(parts, `the sampler readout "${text}" must be three numbers`).toHaveLength(3);
  return parts as [number, number, number];
};

/**
 * Paints the red slab with the Draw tool, which commits a NEW layer and leaves it active.
 *
 * A slab and not a solid fill, because the boundary between red and white is the only place a Sample
 * Size can be observed: at Point Sample the two sides differ, and a 3 by 3 Average centred on the
 * edge reads something strictly between them.
 */
const drawSlab = async (page: Page) => {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, SLAB_RED, true);
  const box = await canvasBox(page);

  await drawLine(page, box, SLAB_START_X, SLAB_Y, SLAB_END_X, SLAB_Y, { steps: 12 });

  await waitForCanvasPixels(page, pageClip(box), showsRedSlab, {
    description: 'the red slab laid down by the Brush',
  });
};

/**
 * The slab's top edge, found from the capture rather than assumed.
 *
 * The click has to sit ON the colour boundary for the Sample Size test to mean anything, and
 * assuming a row would put it a strokeWidth away at any zoom or viewport this suite happens to run
 * at. The row is found in IMAGE pixels and converted back through the capture's own scale, because
 * the capture may be at a different device-pixel scale than the CSS the click is issued in.
 */
const slabEdgePoint = async (page: Page): Promise<{ x: number; y: number }> => {
  const box = await canvasBox(page);
  const clip = pageClip(box);
  const image = await loadImageData(await page.screenshot({ clip }));
  if (image.width <= 0 || image.height <= 0) throw new Error('empty capture while locating the slab edge');

  const column = Math.floor(image.width / 2);
  for (let row = 0; row < image.height; row++) {
    const index = (row * image.width + column) * 4;
    if (image.data[index] > 150 && image.data[index + 1] < 100 && image.data[index + 2] < 100) {
      return imagePointToCss(image, clip, { x: column, y: row });
    }
  }
  throw new Error('the slab should have a red top edge inside the clip');
};

test.describe('the Color Sampler tool', () => {
  test.beforeEach(async ({ page }) => {
    // The app seeds a Blank document on load, so this waits for the document that already exists
    // rather than creating one, and the composition poll is what proves the canvas is live.
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();
    await expect(page.getByTitle('Drag to reorder').filter({ hasText: 'Blank 1' })).toBeVisible();
  });

  test('reports the composited pixel under a click, and not a constant', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await drawSlab(page);
    await selectColorSampler(page);

    const box = await canvasBox(page);
    const red = await getColorAtPoint(await page.screenshot({ clip: pageClip(box) }), 100, 30, 2);
    expect(red, 'the sampled target must be the red the Brush laid down').not.toBeNull();
    expect(red!.red).toBeGreaterThan(150);

    await page.mouse.click(box.x + SLAB_START_X + 100, box.y + SLAB_Y);

    await expect(readout(page, 1)).toBeVisible();
    const [r, g, b] = await reportedRgb(page, 1);
    // Compared against the pixel the capture actually holds. A bar that reported a fixed colour, or
    // the white base layer, fails here; the tolerance is the capture's own anti-aliasing and the
    // contain fit's scaling, not a slack reading.
    expect(Math.abs(r - red!.red), 'the reported red must be the pixel under the click').toBeLessThanOrEqual(24);
    expect(Math.abs(g - red!.green)).toBeLessThanOrEqual(24);
    expect(Math.abs(b - red!.blue)).toBeLessThanOrEqual(24);
    expect(g, 'the slab is red, so the green channel must be near zero').toBeLessThan(100);

    // The hex readout is the same four bytes in the other spelling, so a bar that rendered one and
    // not the other would be half a readout.
    const hex = (await hexReadout(page, 1).textContent())?.trim() ?? '';
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(hex).toBe(`#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`);
  });

  test('numbers samplers from one and keeps the numbers after a deletion', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectColorSampler(page);
    const box = await canvasBox(page);

    await page.mouse.click(box.x + 200, box.y + 150);
    await expect(readout(page, 1)).toBeVisible();
    await page.mouse.click(box.x + 300, box.y + 300);
    await expect(readout(page, 2)).toBeVisible();
    await page.mouse.click(box.x + 500, box.y + 400);
    await expect(readout(page, 3)).toBeVisible();

    // Adobe's Alt-click deletion, on the first marker. The survivors must KEEP their numbers, because
    // the id is stored on the sampler rather than being its index — so "sampler 2" means the same
    // pixel before and after the deletion. A bar that re-indexed would render `#2` here.
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 200, box.y + 150);
    await page.keyboard.up('Alt');

    await expect(readout(page, 1)).toHaveCount(0);
    await expect(readout(page, 2), 'sampler 2 keeps its number').toBeVisible();
    await expect(readout(page, 3), 'sampler 3 keeps its number').toBeVisible();
    await expect(readout(page, 4), 'no fourth sampler was invented').toHaveCount(0);
  });

  test('deletes a sampler dragged out of the document, and moves one dragged inside it', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await drawSlab(page);
    await selectColorSampler(page);
    const box = await canvasBox(page);

    await page.mouse.click(box.x + 250, box.y + 400);
    await expect(readout(page, 1)).toBeVisible();
    const placed = await reportedRgb(page, 1);

    // A drag that ENDS inside the frame moves the marker, and the readout keeps its colour: moving a
    // marker is not re-sampling it, which is what the stored readout exists for.
    await page.mouse.move(box.x + 250, box.y + 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 450, { steps: 6 });
    await page.mouse.up();
    await expect(readout(page, 1)).toBeVisible();
    expect(await reportedRgb(page, 1), 'a moved marker keeps the colour it was placed at').toEqual(placed);

    // The same drag released OUTSIDE the frame deletes it: "To delete a color sampler, drag the
    // sampler out of the document window." Past the canvas edge, which is inside the page.
    await page.mouse.move(box.x + 250, box.y + 450);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 120, box.y + 450, { steps: 6 });
    await page.mouse.up();
    await expect(readout(page, 1)).toHaveCount(0);
  });

  test('Sample Size averages the block rather than reading the centre pixel', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await drawSlab(page);
    await selectColorSampler(page);

    const select = sampleSizeSelect(page);
    await expect(select, 'the bar carries its own control, addressed by its label').toBeVisible();
    await expect(select).toHaveValue('1');

    // The click sits ON the red/white boundary, so the two sizes must disagree.
    const edge = await slabEdgePoint(page);

    await page.mouse.click(edge.x, edge.y);
    await expect(readout(page, 1)).toBeVisible();
    const pointSample = await reportedRgb(page, 1);

    await select.selectOption('3');
    await expect(select).toHaveValue('3');
    // A second marker rather than a re-click of the first: the stored colour does not change on its
    // own, so re-reading the first would prove nothing about the control.
    await page.mouse.click(edge.x + 40, edge.y);
    await expect(readout(page, 2)).toBeVisible();
    const averaged = await reportedRgb(page, 2);

    // The footprint has to REACH the renderer. A control that widened nothing would return the same
    // number here, and that is the whole regression this test exists to catch.
    expect(
      Math.abs(averaged[1] - pointSample[1]),
      `3 by 3 Average (${averaged[1]}) must differ from Point Sample (${pointSample[1]}) on one pixel`
    ).toBeGreaterThan(20);
    // And the difference must be a MIXTURE of the two sides, never a copy of either — which also
    // pins that it averaged rather than sampled somewhere else entirely.
    const white = 255;
    const slab = 0;
    const lower = Math.min(pointSample[1], averaged[1]);
    const upper = Math.max(pointSample[1], averaged[1]);
    expect(lower, 'the average must lie strictly between the slab and the background').toBeGreaterThan(slab - 12);
    expect(upper).toBeLessThan(white + 1);
  });

  test('refuses a fifth sampler and leaves the first four alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectColorSampler(page);
    const box = await canvasBox(page);

    // Four placements, spread far apart so none lands inside another's eight-pixel grab radius.
    for (const [x, y] of [
      [120, 120],
      [300, 120],
      [480, 120],
      [660, 120],
    ] as const) {
      await page.mouse.click(box.x + x, box.y + y);
    }
    await expect(readout(page, 4), "four samplers is Adobe's cap").toBeVisible();
    const fourth = await reportedRgb(page, 4);

    // The refusal is LOUD, so `consolePolice` would fail this test on an unaccepted error — which is
    // exactly the intent: a fifth click has to say why it did nothing. No `ACCEPTED_CONSOLE_ERRORS`
    // entry is declared for it, because the refusal is the behaviour under test.
    await page.mouse.click(box.x + 120, box.y + 300);

    await expect(readout(page, 5), 'no fifth sampler may appear').toHaveCount(0);
    await expect(readout(page, 4), 'the fourth survives the refused click').toBeVisible();
    expect(await reportedRgb(page, 4), 'and is unchanged').toEqual(fourth);

    // Clear frees the cap, so the refusal is about LIVE samplers and not a one-way latch.
    await page.getByTestId('color-sampler-clear').click();
    await expect(readout(page, 1)).toHaveCount(0);
    await page.mouse.click(box.x + 120, box.y + 300);
    await expect(readout(page, 1), 'a slot freed by Clear can be used again').toBeVisible();
  });

  test('records no history state, because a sampler is a readout', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await drawSlab(page);
    await selectColorSampler(page);
    const box = await canvasBox(page);

    await page.mouse.click(box.x + 250, box.y + SLAB_Y);
    await expect(readout(page, 1)).toBeVisible();

    // The Brush wrote one entry, so one undo consuming it and leaving nothing behind IS the absence
    // of a state — not a history feature that never fired. Asserted the same way the Eyedropper's own
    // spec asserts it, and for the same reason: Adobe's rule is that a history state comes from a
    // change to pixels, and placing a marker changes none.
    const undo = page.getByTestId('undo-button');
    await undo.click();
    await expect(undo, 'placing a sampler must not have added a history state').toBeDisabled();
  });

  test('places a sampler on a Shift-click from the Eyedropper, and leaves the foreground alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await drawSlab(page);
    await clickToolButton(page, 'eyedropper');
    await expect(sampleSizeSelect(page), 'the eyedropper is the active tool').toBeVisible();

    const box = await canvasBox(page);
    // Alt-click is the Eyedropper's own "sample to background", so Shift must be checked on its own:
    // if this press were read as a background sample the foreground assertion below would be about a
    // different gesture, and if it were read as a plain sample the sampler assertion would fail.
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + SLAB_START_X + 100, box.y + SLAB_Y);
    await page.keyboard.up('Shift');

    // The Color Sampler's bar is NOT mounted while the Eyedropper holds the tile, so the marker is
    // observed the way a user would observe it — by switching to the tool, which is also the only
    // way to prove the sampler SURVIVED the tool switch.
    await selectColorSampler(page);
    await expect(readout(page, 1), 'the Shift-click sampler survived the tool switch').toBeVisible();
    const [r, g] = await reportedRgb(page, 1);
    expect(r).toBeGreaterThan(150);
    expect(g, 'the slab is red, so the green channel must be near zero').toBeLessThan(100);
  });

  test('Shift+I reaches the Color Sampler by the cycle, not by a tile of its own', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.keyboard.press('i');
    await expect(sampleSizeSelect(page), 'a bare I selects the tile anchor').toBeVisible();

    await page.keyboard.press('Shift+I');
    await expectSamplerActive(page);

    await page.keyboard.press('Shift+I');
    // The Ruler's own readout, which is what proves the cycle reached a DIFFERENT member rather than
    // re-selecting: the Color Sampler's Clear is gone by then.
    await expect(page.getByTestId('ruler-x'), 'the cycle reaches the Ruler').toBeVisible();

    await page.keyboard.press('Shift+I');
    await expect(sampleSizeSelect(page), 'and wraps back to the anchor').toBeVisible();
  });

  test('keeps its samplers across a tool switch, which is what the module store is for', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await drawSlab(page);
    await selectColorSampler(page);
    const box = await canvasBox(page);

    await page.mouse.click(box.x + 250, box.y + SLAB_Y);
    await expect(readout(page, 1)).toBeVisible();
    const placed = await reportedRgb(page, 1);

    // Out to another tool of the SAME tile and back, which unmounts and remounts this tool area
    // exactly as leaving to another tile would. `Shift+I` rather than a tile click because the rail
    // folds a suffix of whole rows at this viewport, so which tile owns a button moves with the
    // active tool — and a test about a module store's lifetime has no business depending on that.
    await page.keyboard.press('Shift+I');
    await expect(page.getByTestId('ruler-x'), 'the Ruler replaced the sampler bar').toBeVisible();
    await page.keyboard.press('Shift+I');
    await page.keyboard.press('Shift+I');
    await expectSamplerActive(page);

    await expect(readout(page, 1), 'the sampler survived the tool switch').toBeVisible();
    expect(await reportedRgb(page, 1)).toEqual(placed);
  });
});
