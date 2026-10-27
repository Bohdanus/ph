import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type ClipOptions,
  canvasRedrawClip,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  loadImageData,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { cssPointToImage } from './helpers/screenshot-scale';
import { clickToolButton, expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

/**
 * Pixel E2E coverage for Brush, Pencil and Color Replacement.
 *
 * Brush and Pencil are checked for drag geometry. Color Replacement follows Photoshop's
 * sample-then-replace gesture: click a source pixel, then drag across pixels to replace it.
 * The test seeds a red brush stroke, samples it and verifies that only the dragged segment
 * changes to the foreground color while an untouched segment remains red.
 */

/** The gesture every test in this file draws: a 200px horizontal line at y=150, box-relative. */
const STROKE_Y = LINE_START_Y;

/** Where the gesture lands inside `CANVAS_REDRAW_CLIP`, which starts at box + (100, 100). */
const CLIP_STROKE_START_X = LINE_START_X - 100;
const CLIP_STROKE_END_X = LINE_END_X - 100;
const CLIP_STROKE_Y = STROKE_Y - 100;

/**
 * The weakest "the tool put ink on the canvas" test that still clears anti-aliasing noise.
 *
 * A pixel counts as ink when its darkest channel drops at least this far below the white
 * document background. Measured peak darkening per tool on the gesture above: Brush 229,
 * Pencil 229, Color Replacement **70**. 32 therefore sits well below even the weakest of
 * them — 38 levels of headroom against the 2 it was originally chosen with — and far above
 * the 1-2 levels a resampled empty canvas drifts by.
 *
 * **Do not raise 32 toward 70.** An earlier version of this comment read "Color
 * Replacement 34. 32 sits below the weakest of them with room to spare", and 34 was the
 * measured peak of a two-dab drag (`drawLine` with no `steps`), not of the gesture this
 * file draws. The real weakest value is 70, so a reader who takes 32 to be a tight
 * threshold would be tightening it against evidence that does not exist. 32 is a
 * deliberate floor, not a measurement-derived limit.
 */
const INK_MIN_DARKENING = 32;

/** Anti-aliased edge: any darkening at all, so the bounding box measures the whole stroke. */
const EDGE_MIN_DARKENING = 2;

/** The solid core of a stroke, as opposed to its anti-aliased rim. Brush and Pencil both peak at 229. */
const CORE_MIN_DARKENING = 20;

/** The document background every unpainted pixel in the clip is. */
const BACKGROUND_CHANNEL = 255;

const darkening = (data: Uint8ClampedArray, index: number): number =>
  BACKGROUND_CHANNEL - Math.min(data[index], data[index + 1], data[index + 2]);

const hasInk = async (screenshot: Buffer): Promise<boolean> => {
  const { data } = await loadImageData(screenshot);
  for (let index = 0; index < data.length; index += 4) {
    if (darkening(data, index) >= INK_MIN_DARKENING) return true;
  }
  return false;
};

interface Stroke {
  /** Bounding box of every anti-aliased inked pixel, in clip coordinates. */
  edge: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** Bounding box of the solid core only. Brush 15x214, Pencil 7x207 on the gesture above. */
  core: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** Count of solid-core pixels: 2957 for Brush, 1226 for Pencil. */
  corePixelCount: number;
}

/** Measures one clip. Returns `null` when the tool left the clip untouched. */
async function measureStroke(screenshot: Buffer): Promise<Stroke | null> {
  const { data, width, height } = await loadImageData(screenshot);

  const box = () => ({ left: width, top: height, right: -1, bottom: -1, width: 0, height: 0 });
  const edge = box();
  const core = box();
  let corePixelCount = 0;

  const grow = (target: { left: number; top: number; right: number; bottom: number }, x: number, y: number) => {
    if (x < target.left) target.left = x;
    if (x > target.right) target.right = x;
    if (y < target.top) target.top = y;
    if (y > target.bottom) target.bottom = y;
  };

  for (let index = 0; index < data.length; index += 4) {
    const delta = darkening(data, index);
    if (delta < EDGE_MIN_DARKENING) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    grow(edge, x, y);
    if (delta < CORE_MIN_DARKENING) continue;
    grow(core, x, y);
    corePixelCount++;
  }

  if (edge.right < 0 || core.right < 0) return null;

  for (const target of [edge, core]) {
    target.width = target.right - target.left + 1;
    target.height = target.bottom - target.top + 1;
  }
  return { edge, core, corePixelCount };
}

/**
 * Selects `tool` from the Brush group flyout, proves the selection took, and returns the
 * workspace canvas box to draw into.
 *
 * The proof is the SELECTION state on the tile that REPRESENTS the tool, not on a tile of its own
 * and not on the tile's text. At 1280x720 a one-column rail shows seven tiles, and the seventh of
 * them IS the Brush group — Brush, Pencil, Color Replacement, Eraser, Magic Eraser and Paint
 * Bucket among them — because the first group the fit folds at that height is Clone Stamp, the
 * eighth. So at the default viewport `tool-button-brush` reports ONE element, not zero, and this
 * helper does not throw before the gesture; it is that tile's own `aria-pressed` that carries the
 * claim. `expectToolSelected` is the assertion for a
 * question about a TOOL: it answers at every window, reading `aria-pressed` off the tool's own
 * tile when the rail still shows
 * one and the tile's lit class off the three-dots tile when it does not. Its label is the tile's own
 * ("More Tools"), which is why the old `verifyPrimaryTool(page, name, label)` — a `toContainText` on
 * that tile — could never pass once the group collapsed, and reading the selection state replaces it
 * rather than weakening it: both facts (the tool is current, the tile is the one on screen) are still
 * pinned.
 */
async function selectPaintTool(page: Page, tool: { name: string; label: string }): Promise<BoundingBox> {
  await openToolFlyout(page, 'brush');
  await selectFromFlyout(page, { toolName: tool.name, label: tool.label });
  await expectToolSelected(page, tool.name);
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error(`selectPaintTool: no bounding box after selecting ${tool.name}`);
  return box;
}

/**
 * The image-space scale of the clip, derived from the decoded capture: device pixels per
 * CSS pixel. Used to convert `measureStroke` results back to CSS pixels so assertions hold
 * at any DPR.
 */
async function imageScale(screenshot: Buffer, clip: Required<ClipOptions>): Promise<number> {
  const { height } = await loadImageData(screenshot);
  return height / clip.height;
}

/** Draws the shared gesture, waits for ink in the clip, then measures that clip. */
async function drawAndMeasure(
  page: Page,
  toolName: string,
  box: BoundingBox
): Promise<{ stroke: Stroke; scale: number }> {
  await drawLine(page, box, LINE_START_X, STROKE_Y, LINE_END_X, LINE_END_Y, { steps: 20 });
  const clip = canvasRedrawClip(box);
  // The measurement below is a one-shot capture, so synchronize with the backing store
  // first or a slow frame silently weakens the assertions.
  await waitForCanvasPixels(page, clip, hasInk, { description: `ink from the ${toolName} stroke` });
  const screenshot = await page.screenshot({ clip });
  const measured = await measureStroke(screenshot);
  if (!measured) throw new Error(`drawAndMeasure: the clip is empty after ${toolName} ink was observed`);
  const scale = await imageScale(screenshot, clip);
  return { stroke: measured, scale };
}

async function readClipPixel(
  screenshot: Buffer,
  clip: Required<ClipOptions>,
  box: BoundingBox,
  point: { x: number; y: number }
) {
  const image = await loadImageData(screenshot);
  const imagePoint = cssPointToImage(image, clip, { x: box.x + point.x, y: box.y + point.y });
  return getColorAtPoint(image, Math.round(imagePoint.x), Math.round(imagePoint.y), 0);
}

const PAINT_TOOLS = [
  { name: 'brush', label: 'Brush Tool' },
  { name: 'pencil', label: 'Pencil Tool' },
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();
});

for (const tool of PAINT_TOOLS) {
  test(`${tool.name} commits a stroke that spans the drag gesture`, async ({ page }) => {
    const box = await selectPaintTool(page, tool);
    // Set the foreground the way a user would, and let the helper confirm the swatch took
    // it. The stroke is asserted for geometry only: this tool does not read that colour
    // (see the file header and e2e/OPEN_PROBLEMS.md), so asserting on it would be pinning
    // the defect rather than the behaviour.
    await setForegroundColor(page, '#ff0000', true);

    const { stroke, scale } = await drawAndMeasure(page, tool.name, box);

    // The stroke starts at or before the gesture's start and ends at or after its end, so
    // the tool tracked the whole drag instead of dropping a single mark. Brush measured
    // 43..256 and Pencil 47..253 against a 50..250 gesture, the overshoot being the round
    // line cap plus the anti-aliased rim.
    expect(stroke.edge.left, `${tool.name} stroke should start at the gesture start`).toBeLessThanOrEqual(
      CLIP_STROKE_START_X
    );
    expect(stroke.edge.right, `${tool.name} stroke should reach the gesture end`).toBeGreaterThanOrEqual(
      CLIP_STROKE_END_X
    );
    // A 200px drag, plus the caps, so nothing narrower is the whole stroke.
    expect(stroke.edge.width).toBeGreaterThanOrEqual(LINE_END_X - LINE_START_X);

    // It is a stroke rather than a fill: the clip is 100px tall and the gesture
    // 200px wide, and both tools measured 15px and 7px tall. The assertion is on
    // CSS pixels, so divide the image-space height by the capture scale.
    expect(stroke.edge.height / scale).toBeGreaterThanOrEqual(3);
    expect(stroke.edge.height / scale, `${tool.name} should stroke a line, not flood the clip`).toBeLessThan(30);

    // And it straddles the line the pointer travelled along.
    expect(stroke.edge.top).toBeLessThanOrEqual(CLIP_STROKE_Y);
    expect(stroke.edge.bottom).toBeGreaterThanOrEqual(CLIP_STROKE_Y);
    expect(Math.abs((stroke.edge.top + stroke.edge.bottom) / 2 - CLIP_STROKE_Y)).toBeLessThanOrEqual(5);
  });
}

test('color replacement samples a source with a click and replaces the dragged segment', async ({ page }) => {
  const sourceBox = await selectPaintTool(page, { name: 'brush', label: 'Brush Tool' });
  await setForegroundColor(page, '#ff0000', true);
  const brushSize = page.getByRole('slider', { name: /^Size/ });
  await brushSize.fill('30');
  await expect(brushSize).toHaveValue('30');
  await drawLine(page, sourceBox, LINE_START_X, STROKE_Y, LINE_END_X, LINE_END_Y, { steps: 16 });

  const sourceClip = canvasRedrawClip(sourceBox);
  await waitForCanvasPixels(
    page,
    sourceClip,
    async (screenshot) => {
      const color = await readClipPixel(screenshot, sourceClip, sourceBox, { x: 250, y: STROKE_Y });
      return color !== null && color.red > 220 && color.green < 40 && color.blue < 40;
    },
    { description: 'the red source stroke' }
  );

  await openToolFlyout(page, 'brush');
  await selectFromFlyout(page, { toolName: 'color-replacement', label: 'Color Replacement Tool' });
  await expectToolSelected(page, 'color-replacement');
  const replacementBox = await getWorkspaceCanvas(page).boundingBox();
  if (!replacementBox) throw new Error('color replacement test: no canvas bounding box after selecting the tool');

  await setForegroundColor(page, '#00ff00', true);
  const samplePoint = { x: 250, y: STROKE_Y };
  await page.mouse.click(replacementBox.x + samplePoint.x, replacementBox.y + samplePoint.y);
  await expect(page.getByText('Sampled rgb(255, 0, 0)')).toBeVisible();
  await page.locator('#color-replacement-limits').selectOption('discontinuous');
  const replacementSize = page.getByRole('slider', { name: /^Size/ });
  await replacementSize.fill('30');
  await expect(replacementSize).toHaveValue('30');

  const replacementClip = canvasRedrawClip(replacementBox);
  await drawLine(page, replacementBox, 220, STROKE_Y, 280, STROKE_Y, { steps: 12 });
  await waitForCanvasPixels(
    page,
    replacementClip,
    async (screenshot) => {
      const replaced = await readClipPixel(screenshot, replacementClip, replacementBox, samplePoint);
      const untouched = await readClipPixel(screenshot, replacementClip, replacementBox, { x: 170, y: STROKE_Y });
      return (
        replaced !== null &&
        replaced.green > replaced.red + 40 &&
        replaced.blue < 40 &&
        untouched !== null &&
        untouched.red > 220 &&
        untouched.green < 40 &&
        untouched.blue < 40
      );
    },
    { description: 'only the dragged red segment to be replaced with the foreground color' }
  );
});

test('selecting a paint tool releases the previously primary tool button', async ({ page }) => {
  // This test needs both tools on visible, separate tiles; use a tall viewport so toolbar
  // overflow does not hide either control. Avoid depending on total group counts or ordinals:
  // the fit can change as the mapped roster evolves.
  //
  // 1400 is deliberately well past the fold boundary. This test checks selected-state behavior
  // with both primary buttons present, not the exact number of groups that fit at a breakpoint.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  await clickToolButton(page, 'draw');
  // Asserted on the tool's OWN tile, which is the only element that can carry this claim: the
  // test has just guaranteed the rail is showing one.
  const drawButton = page.getByTestId('tool-button-draw');
  await expect(drawButton, 'Draw should be the active tool before the switch').toHaveAttribute('aria-pressed', 'true');

  await openToolFlyout(page, 'brush');
  await selectFromFlyout(page, { toolName: 'brush', label: 'Brush Tool' });

  // `aria-pressed` follows whether the active group contains the tool, so selecting Brush's
  // group must clear Draw's separate selected state.
  await expect(drawButton, 'Draw must not stay pressed after a different tool group takes over').toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(page.getByTestId('tool-button-brush')).toHaveAttribute('aria-pressed', 'true');
});

test('brush lays a measurably wider stroke than pencil for the same gesture', async ({ page }) => {
  const measure = async (tool: { name: string; label: string }): Promise<Stroke> => {
    const box = await selectPaintTool(page, tool);
    await setForegroundColor(page, '#ff0000', true);
    const { stroke } = await drawAndMeasure(page, tool.name, box);
    return stroke;
  };

  // A fresh document per tool: the option panel reflows the workspace, and a box measured
  // before the other tool was selected can clip empty canvas.
  await page.goto('/');
  const brush = await measure({ name: 'brush', label: 'Brush Tool' });
  await page.goto('/');
  const pencil = await measure({ name: 'pencil', label: 'Pencil Tool' });

  // Measured on this document: Brush 15px tall over 2957 core pixels, Pencil 7px tall over
  // 1226 — ratios of 2.14 and 2.41. The cause is `lineWidth` in `defaultSettings`
  // (src/tools/settings.ts:118 is 10, :126 is 3), so the gap is structural rather than
  // incidental; 1.5 is the floor that still fails if the two tools converge.
  expect(brush.core.height).toBeGreaterThan(pencil.core.height);
  expect(brush.core.height / pencil.core.height).toBeGreaterThan(1.5);
  expect(brush.corePixelCount / pencil.corePixelCount).toBeGreaterThan(1.5);
});
