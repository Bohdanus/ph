import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type ClipOptions,
  canvasRedrawClip,
  drawLine,
  getWorkspaceCanvas,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  loadImageData,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton, expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

/**
 * Pixel coverage for the three paint tools — Brush, Pencil and Color Replacement — which
 * until now had none: `sidebar-flyout.spec.ts` and `sidebar-keyboard.spec.ts` proved the
 * flyout can *select* them and stopped there, and Color Replacement was not named in any
 * spec at all.
 *
 * All three live in one flyout group. `toolbar-mapping.ts:73-75` lists them as
 * `[Brush Tool / brush, Pencil Tool / pencil, Color Replacement Tool / color-replacement]`,
 * so the group's primary is `brush`, and `openToolFlyout(page, 'brush')` is the address this
 * file gives whether or not that group has a tile of its own. At 1280x720 it does: measured, the
 * Brush group is the SEVENTH of the rail's fifteen groups, so it is the last tile on screen, and
 * the helper takes its own-tile branch and presses that tile. The first group the fit folds at
 * that height is Clone Stamp, the eighth, and the collapse branch — a right-click on the
 * three-dots tile, handing back a menu that carries Brush — is what a window short enough to fold
 * Brush itself gets, and it is the menu `selectFromFlyout` then picks the tool out of either way.
 * The per-item test ids come from the
 * labels `Brush Tool -> brush-tool`, `Pencil Tool -> pencil-tool`,
 * `Color Replacement Tool -> color-replacement-tool`
 * (`SidebarLeft.tsx:970` mints `tool-flyout-item-${name}-${slug}`).
 *
 * `Main.tsx:55` routes all three to `interactionMode === 'draw'`, so the same
 * `DrawToolArea` collects the gesture for each of them, and `toolProcessors.ts:165-193`
 * gives each a real raster processor. Strokes therefore commit, which is what the
 * assertions below measure.
 *
 * ## What these tests deliberately do NOT assert, and why
 *
 * A green run here does **not** mean the foreground colour reaches the stroke. It does
 * not, for any of the three tools, and the defect is recorded in `e2e/OPEN_PROBLEMS.md`:
 *
 * - `SET_COLOR` writes only `state.color` (`src/contexts/StoreContext.tsx:501`). Nothing
 *   copies it into the active tool's args. That copy is a `useEffect` living in each
 *   tool's own options panel — `src/components/ToolbarsRight/Draw/Draw.tsx:29-33` is the
 *   one that makes the Draw tool obey the swatch. Brush, Pencil and Color Replacement are
 *   wired to `PlaceholderTool` (`src/tools/toolsMap.ts:75,80,85`), which renders chips and
 *   no effect, so their `args.color` keeps the hard-coded `'#000000'` from
 *   `src/tools/settings.ts:116,124,132` and `DrawToolArea` strokes with that
 *   (`src/components/Main/DrawToolArea.tsx:23,51,81`).
 * - Measured with the foreground set to `#ff0000` and the swatch verified as `#ff0000`:
 *   the widest channel spread anywhere in the stroke is **0**, i.e. the pixels are exactly
 *   neutral. Brush and Pencil peak at `rgb(0, 0, 0)` — black at their `alpha: 1`
 *   composited over the white document. The Draw tool on the same gesture and the same
 *   swatch measures `rgb(255, 26, 26)`, a channel spread of 229, which is the control that
 *   says the measurement would see red if the red were there.
 *
 * So the ink assertions below are deliberately colour-agnostic: they ask *where* the tool
 * painted, never *what colour*. That keeps them true before and after the colour defect is
 * fixed, instead of pinning today's black pixels.
 *
 * Color Replacement is absent from this file for a second, independent reason, and it is a
 * judgement rather than a technical impossibility. The tool does commit a measurable
 * stroke: at 70 levels of darkening (`rgb(185, 185, 185)`) and 5333 pixels past 32 levels,
 * it is plainly visible, `measureStroke` below sees it, and `getStrokeAnalysis`
 * classifies it as `spray` rather than returning `null`. An assertion that survives the
 * colour fix is therefore available today — every threshold in this file is derived from
 * `255 - min(r, g, b)`, which is colour-invariant, and a drag-tracking box would still
 * hold if the tool were made opaque.
 *
 * What is NOT settled is what the tool is for, and the recorded fix is a decision rather
 * than a code change: `e2e/OPEN_PROBLEMS.md` says to "decide what the tool is for". Color
 * Replacement in Photoshop is a click tool — pick a source colour, then click a target —
 * and under that model a drag does not paint a spanning stroke at all, so a geometry
 * assertion written now would be asserting the wrong interaction. The two concrete fixes
 * the entry offers (drop the `/ 4`, or treat `lineWidth` as a diameter) also disagree with
 * each other about the stroke's size, so a measured size would enshrine one of them. A test
 * that could only say "something is present" would add no defect-detection power either.
 * So the coverage lands when the tool's intended output is decided, and until then the gap
 * is stated in `e2e/OPEN_PROBLEMS.md` rather than filled with a test that guesses.
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

test('selecting a paint tool releases the previously primary tool button', async ({ page }) => {
  // This one test needs the two tools on DIFFERENT tiles and BOTH of them present, so it asks for
  // a window tall enough that nothing collapses. That is a requirement of the claim, not a
  // convenience: the collapse folds a SUFFIX of the rail, and at 1280x720 the seven tiles on
  // screen stop at the Brush group — the SEVENTH of the rail's fifteen — so the fold now separates
  // this pair instead of merging them. `tool-button-brush` is on screen and `tool-button-draw` is
  // not, because Draw is the twelfth group and everything from Clone Stamp (the eighth) down is in
  // the three-dots tile. "Draw is released when Brush is selected" would then fail on a locator
  // that resolves to no element rather than on the behaviour it claims, and the closing
  // `tool-button-brush` check would be the only half of the pair with a tile to read at all.
  //
  // 1400 is deliberately well past the boundary rather than just over it. The whole fifteen-row
  // grid is 765px of content — fifteen 44px tiles, fourteen 6px row gaps, three 7px section
  // rules — and the fit budgets the WHOLE slot now, where it used to take four fifths of it,
  // so the first window height at which nothing collapses is 1037: measured, that is where the
  // slot itself is 765px, the exact height the grid needs. The step off "everything" is not one
  // pixel but two whole rows — at 1036 the fit keeps thirteen tiles and folds the tail, because
  // fourteen tiles is unreachable: fourteen rows plus the three-dots row IS the full fifteen-row
  // grid. A window a few pixels above 1037 would turn this test into a measurement of the
  // boundary rather than of the claim it is making.
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

  // `aria-pressed` is `group.some(tool => tool.name === toolName)` (SidebarLeft.tsx:658),
  // so it moves between groups rather than following one tile: Draw is its own group
  // (toolbar-mapping.ts:102) and Brush a different one, so selecting Brush has to clear Draw.
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
