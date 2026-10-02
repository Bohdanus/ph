import { expect, test, type Page } from './fixtures/extended-test';
import {
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  CANVAS_REDRAW_TIMEOUT_MS,
  getDarkPixelBounds,
  getSelectionBounds,
  getWorkspaceCanvas,
  hasDarkPixels,
  loadImageData,
  type BoundingBox,
  type ClipOptions,
  type SelectionBounds,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import {
  clickToolButton,
  openToolFlyoutViaRightClick,
  selectFromFlyout,
  verifyPrimaryTool,
} from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/**
 * Seven pixel-level tests for the five selection tools.
 *
 * ## The viewport is pinned here, and it is pinned on a MEASURED reason
 *
 * `playwright.config.ts` sets no viewport, so this file would inherit
 * `devices['Desktop Chrome']`'s 1280x720. It used to be pinned to get away from a fold: at
 * 1280x720 the canvas element was 974x840 at (56, 100) with its bottom 220px below the edge,
 * the polygonal lasso's third vertex landed at page y=638, and the magic wand's bar region
 * reached y=718 — two pixels of headroom, against a capture API that truncates a clip at the
 * viewport edge SILENTLY, so a region below the fold reads as "clean": a false pass, not a
 * failure.
 *
 * THAT REASON IS GONE, and both halves of it were re-measured rather than assumed. The rail
 * no longer outgrows the viewport — it is `min-h-0 overflow-y-auto` and the tiles COLLAPSE into
 * the three-dots tile instead of pushing the page taller — so the shell is exactly
 * viewport-tall at every desktop size, `documentElement.scrollHeight` equals `clientHeight`,
 * and at 1280x720 the canvas element is 974x583 at (56, 100) with its bottom at 683, entirely
 * on screen. There is no fold to clear and nothing to truncate. The measured headroom at 720 is
 * 118px below the wand's bar region and the lasso vertex lands at y=473.
 *
 * The pin STAYS, on a different and much smaller reason: the two sizes no longer share a fit
 * scale. The box's WIDTH is 974 either way, but at 720 the element is 583 tall and the
 * width-limited fit the document would need (800x600 at 1.2175 is 730.5 rows) no longer fits,
 * so the fit flips to HEIGHT-limited at 0.97167 — where at 1280x1000, with the element 863
 * tall, it stays WIDTH-limited at 1.21750. An earlier version of this header claimed the scale
 * was identical at both sizes "because the box's WIDTH does not change", and that was true
 * then and is false now: the width did not change, the HEIGHT did. `OUTLINE_SLACK_PX` is a
 * CSS-px budget, and pinning the viewport is what makes the scale it is measured against a
 * constant of this file instead of a property of whatever the suite happened to inherit.
 *
 * Nothing else below depends on the choice. Every drag is a FRACTION of the measured canvas box
 * (`boxRect`) and the wand's bar is measured back off the screenshot rather than predicted, so
 * both sizes address the same fractions of the same element; `overlayClip` stays as the guard
 * for the silent-truncation hazard regardless, and is a no-op at `VIEWPORT` — a floor, not a
 * measurement.
 *
 * ## What "these blue pixels are a selection" actually rests on
 *
 * `expectMoveTransformBoxHidden` is one leg of it, and its limits are worth stating, because
 * they are not properties the guard establishes:
 *
 * - The Move tool's transform box is on a DIFFERENT canvas (`rectOverlayRef`,
 *   `MoveToolArea.tsx:87`) and is genuinely excluded, so blue that survives on
 *   `tool-overlay-canvas` while a selection tool is active cannot be a transform box.
 * - `useMarchingAnts` is NOT excluded. `MoveToolArea.tsx:30` runs it on `toolOverlayRef` — the
 *   SAME canvas the rectangular selection's `useRect` paints. The guard is safe there today
 *   only because `useAnts.ts:62,66` strokes the ants black and then white, and neither black
 *   nor white satisfies the blue thresholds below. That is a fact about that file's two
 *   colours, not something this file proves; recolouring the ants blue would let these tests
 *   pass on a transform box. The independent discriminator, used by the marquee tests, is the
 *   mask: a `useRect` selection darkens everything outside its rectangle (`useRect.ts:158-159`)
 *   and a Move transform box does not, because `MoveToolArea` passes `hideBlend: true`
 *   (`MoveToolArea.tsx:83`).
 * - For the two lasso tests the discriminator is GEOMETRY, not canvas and not colour: the
 *   draft and the committed outline are the same canvas in the same blue, and only the closing
 *   edge appearing after Enter tells them apart.
 */

/**
 * The app's selection colour, `rgba(0, 123, 255, ...)` in both
 * `drawSelectionOutline` (`src/util/selection.ts:150`) and `useRect.drawMask`
 * (`src/hooks/useRect.ts:165`). Read explicitly rather than relying on the
 * helper's defaults, so a change to those defaults cannot silently move the
 * threshold this file asserts against.
 */
const SELECTION_COLOR_THRESHOLDS = { redMax: 80, greenMin: 80, blueMin: 180 };

/**
 * How far outside the intended shape a selection-blue pixel may land.
 *
 * Every selection renderer paints outside its own geometry by a known amount:
 *
 * - the marquee fills corner handles of `HANDLE_SIZE / 2` (6) beyond each corner
 *   (`src/hooks/useRect.ts:172-178`) and strokes a 2px line, so its blue reaches ~7px past the
 *   rect;
 * - `drawSelectionOutline` paints a 5px-radius anchor circle with a 2px stroke at each vertex
 *   (`src/util/selection.ts:176-184`), so its blue reaches ~6px past the geometry;
 * - the magic wand's `simplifyClosedPath` can move a vertex by the smoothing tolerance
 *   (1.5 by default) either way, and its flood fill drops the outermost anti-aliased ring.
 *
 * MEASURED rather than argued: dragging a marquee to a known box-relative rectangle and
 * reading the blue back with the clip origin added, the overshoot is 6px on the left and top
 * and 5px on the right and bottom — and it is the SAME at both this file's 1.2175 fit and the
 * 0.9717 fit an inherited 1280x720 gives. The offset is therefore not being scaled by the
 * document-to-CSS fit at all, which is worth stating because an earlier version of this comment
 * argued it from the drag and the outline travelling through the same scale in opposite
 * directions; that argument gives a document-pixel offset as a document-pixel offset only at
 * scale 1, and neither viewport is at scale 1. The measurement is what the number rests on.
 *
 * 10 is above the measured 6 and far below the shortest distance any test here asserts on (a
 * ~290px drag), so it cannot absorb a wrong answer, and the pin is what keeps the 6
 * reproducible.
 */
const OUTLINE_SLACK_PX = 10;

/** Half-extent of the small window used to ask "is there selection blue HERE?". */
const PROBE_HALF_PX = 20;

/** Brush width for the magic wand's target region, and its half-width for the expected bounds. */
const BRUSH_PX = 120;

/**
 * The viewport every test in this file runs at. Set explicitly in `beforeEach` — see the file
 * header for why it cannot be inherited, and for the measurements that justify this size.
 */
const VIEWPORT = { width: 1280, height: 1000 };

/**
 * How many levels any pixel of a "cleared" region is allowed to sit below the same pixel of the
 * region as it was before the selection existed.
 *
 * 0 would be arithmetically right: the region is a static part of a blank document, so a second
 * capture of it is the same capture. 2 covers nothing measurable, and it sits two orders of
 * magnitude below the defect this bounds. `useRect.drawMask` fills `rgba(0, 0, 0, 0.7)`
 * (`useRect.ts:158`) over everything outside the rectangle, which moves a 255-level document
 * pixel to about 76. Measured in this file's own geometry: that region darkens by exactly 179
 * levels while the selection exists, and by exactly 179 levels after the tool switch that
 * deselects it — the second number is the P1. A tolerance of 2 cannot absorb any fraction of
 * either, and neither can a tolerance of 100.
 */
const MAX_DARKENING_LEVELS = 2;

/**
 * The largest drop, in 0-255 levels, at any pixel of `after` relative to the SAME pixel of
 * `before`. Both arguments must be screenshots of the SAME clip taken at two moments, so they
 * are pixel-aligned by construction and no registration step is needed.
 *
 * This is how the marquee's darkening mask is measured without asserting anything about the
 * document's own colours, its size, the fit scale or the letterbox: comparing a region against
 * a capture of itself from before the mask existed makes the check independent of all four.
 * Alpha is deliberately not compared — a capture is opaque everywhere, so an alpha delta would
 * be an artifact rather than a measurement.
 */
const maxDarkening = async (before: Buffer, after: Buffer): Promise<number> => {
  const from = await loadImageData(before);
  const to = await loadImageData(after);
  if (from.width !== to.width || from.height !== to.height) {
    throw new Error(`region changed size between captures: ${from.width}x${from.height} then ${to.width}x${to.height}`);
  }
  let worst = 0;
  for (let index = 0; index < from.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const drop = from.data[index + channel] - to.data[index + channel];
      if (drop > worst) worst = drop;
    }
  }
  return worst;
};

type Rect = { x: number; y: number; width: number; height: number };

const selectionBlue = async (page: Page, clip: Required<ClipOptions>): Promise<SelectionBounds | null> =>
  getSelectionBounds(await page.screenshot({ clip }), SELECTION_COLOR_THRESHOLDS);

/** Resolves once selection blue is inside `clip`. The suite's single poll loop. */
const waitForSelectionBlue = (page: Page, clip: Required<ClipOptions>, description: string) =>
  waitForCanvasPixels(page, clip, async (png) => (await getSelectionBounds(png, SELECTION_COLOR_THRESHOLDS)) !== null, {
    description,
  });

/** Resolves once selection blue has left `clip`. Same poll loop, negated predicate. */
const waitForNoSelectionBlue = (page: Page, clip: Required<ClipOptions>, description: string) =>
  waitForCanvasPixels(page, clip, async (png) => (await getSelectionBounds(png, SELECTION_COLOR_THRESHOLDS)) === null, {
    description,
  });

/**
 * Where a committed selection's border is on the page, read off the marching-ants canvas.
 *
 * A committed polygon's border no longer lives on the tool overlay: it is the animated
 * black/white ants on their own canvas, which the polygon selection tools never clear. So the
 * blue detection above cannot see it — it still sees the DRAFT, which `drawPolygonOverlay`
 * strokes in the same blue, and asserting on it after a commit would prove the draft rather than
 * the selection.
 *
 * The read is `getImageData` on the canvas's own context rather than a screenshot, for the same
 * reason `e2e/selection-marching-ants.spec.ts` does it that way: this canvas's backing store is
 * already in document pixels, so a screenshot would need a page-coordinate clip and a
 * device-pixel-ratio correction to describe the same pixels, and it would composite whatever the
 * document painted underneath.
 *
 * The element's own bounding rect is what maps the two spaces, and it is read here rather than
 * derived from `workspaceBox()`: the element is the thing being measured, so the mapping cannot
 * drift from it. The canvas is `object-contain`, so that mapping is a scale plus a centring
 * offset in both axes, not a scale alone.
 */
const committedAntsOutline = async (
  page: Page
): Promise<{ left: number; top: number; right: number; bottom: number } | null> =>
  page.getByTestId('selection-ants-canvas').evaluate((element) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('committedAntsOutline: no [data-testid="selection-ants-canvas"] on the page');
    }
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('the selection ants canvas has no 2d context');

    const { data } = ctx.getImageData(0, 0, element.width, element.height);
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let antPixels = 0;

    for (let y = 0; y < element.height; y += 1) {
      for (let x = 0; x < element.width; x += 1) {
        const index = (y * element.width + x) * 4;
        if (data[index + 3] === 0) continue;
        // Both ant colours are opaque, so alpha alone would accept any future overlay. Requiring
        // one of the two the loop actually paints keeps this a test of the ants.
        const isAnt =
          (data[index] < 64 && data[index + 1] < 64 && data[index + 2] < 64) ||
          (data[index] > 192 && data[index + 1] > 192 && data[index + 2] > 192);
        if (!isAnt) continue;
        antPixels += 1;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }

    if (antPixels === 0) return null;

    const rect = element.getBoundingClientRect();
    // The canvas is `object-contain` inside a box that is not its aspect ratio, so the backing
    // store is letterboxed in both axes and document pixels map to page pixels through a scale AND
    // a centring offset. The scale-plus-offset arithmetic is `containFit`'s rule
    // (`e2e/helpers/canvas-helpers.ts:91`), written out here so the whole read stays one round trip.
    // It is applied to this element's own rect rather than to `workspaceBox()` because the element
    // being measured is the one being mapped, so the two cannot drift apart.
    const scale = Math.min(rect.width / element.width, rect.height / element.height);
    const offsetX = (rect.width - element.width * scale) / 2;
    const offsetY = (rect.height - element.height * scale) / 2;

    return {
      left: rect.left + offsetX + left * scale,
      top: rect.top + offsetY + top * scale,
      right: rect.left + offsetX + right * scale,
      bottom: rect.top + offsetY + bottom * scale,
    };
  });

/**
 * Resolves once the ants canvas holds a border.
 *
 * This polls `committedAntsOutline` directly rather than going through `waitForCanvasPixels`,
 * because that loop takes its reading from a screenshot and the point of this read is that a
 * screenshot is the wrong instrument here.
 */
const waitForCommittedAnts = async (page: Page, description: string): Promise<void> => {
  const deadline = Date.now() + CANVAS_REDRAW_TIMEOUT_MS;
  let last: unknown = null;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      last = await committedAntsOutline(page);
      lastError = null;
      if (last !== null) return;
    } catch (error) {
      // Kept, and reported at the end, because a read that throws every tick and a read that
      // returns null forever are different failures and the timeout message must say which.
      lastError = error;
    }
    await page.waitForTimeout(CANVAS_REDRAW_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${description} (last read: ${JSON.stringify(last)}, ` +
      `last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`
  );
};

/**
 * The tool overlay, intersected with the viewport.
 *
 * `page.screenshot({ clip })` cannot capture below the fold, and it truncates there SILENTLY —
 * no error, no warning — so an unclipped overlay clip would be silently cut short and every
 * assertion over its lower part would read as "clean". That is a false PASS, not a failure, so
 * the intersection stays even though `VIEWPORT` is tall enough for it to be a no-op here: it
 * is the floor under every clip in this file, not a measurement of the current layout.
 */
const overlayClip = async (page: Page, box: BoundingBox): Promise<Required<ClipOptions>> => {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const width = Math.min(box.width, viewport.width - box.x);
  const height = Math.min(box.height, viewport.height - box.y);
  return { x: box.x, y: box.y, width, height };
};

/** A `PROBE_HALF_PX` window centred on a box-relative point, inside the overlay. */
const probeClip = (overlay: Required<ClipOptions>, cx: number, cy: number): Required<ClipOptions> => ({
  x: Math.max(overlay.x, Math.min(overlay.x + cx, overlay.x + overlay.width) - PROBE_HALF_PX),
  y: Math.max(overlay.y, Math.min(overlay.y + cy, overlay.y + overlay.height) - PROBE_HALF_PX),
  width: PROBE_HALF_PX * 2,
  height: PROBE_HALF_PX * 2,
});

/** A box-relative region, clipped to the overlay so it never runs off the captured area. */
const regionClip = (overlay: Required<ClipOptions>, rect: Rect): Required<ClipOptions> => {
  const x = Math.max(overlay.x, overlay.x + rect.x);
  const y = Math.max(overlay.y, overlay.y + rect.y);
  return {
    x,
    y,
    width: Math.min(overlay.x + overlay.width, overlay.x + rect.x + rect.width) - x,
    height: Math.min(overlay.y + overlay.height, overlay.y + rect.y + rect.height) - y,
  };
};

const workspaceBox = async (page: Page): Promise<BoundingBox> => {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('Workspace canvas has no bounding box');
  return box;
};

/** Press, move and release between two box-relative points. */
const dragOnCanvas = async (
  page: Page,
  box: BoundingBox,
  from: { x: number; y: number },
  to: { x: number; y: number }
) => {
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
};

/** A rectangle given as fractions of the canvas box, in the box's own coordinates. */
const boxRect = (box: BoundingBox, left: number, top: number, right: number, bottom: number): Rect => ({
  x: Math.round(box.width * left),
  y: Math.round(box.height * top),
  width: Math.round(box.width * right) - Math.round(box.width * left),
  height: Math.round(box.height * bottom) - Math.round(box.height * top),
});

/**
 * The same rectangle in the page coordinates `getSelectionBounds` reports in, once `clip`'s own
 * origin is added back. Every expected value goes through this: the drags above are expressed
 * relative to the canvas box, and mixing the two frames silently moves every bound by the box
 * origin.
 */
const toPage = (box: BoundingBox, rect: Rect): Required<ClipOptions> => ({
  x: box.x + rect.x,
  y: box.y + rect.y,
  width: rect.width,
  height: rect.height,
});

/**
 * `expectOutlineAround` adds a clip origin to the bounds it is given. A screenshot read is
 * clip-relative, so it passes the clip it captured; the ants read is already in page coordinates,
 * so it passes a zero origin. Saying that explicitly keeps the two coordinate spaces from being
 * mixed in a reader's head, which is the mistake the clip argument exists to prevent.
 */
const ORIGIN_CLIP: Required<ClipOptions> = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Asserts that the selection border found in `clip` outlines `expected`, both in page coordinates.
 *
 * "Selection border" rather than "selection blue": a committed polygon's border is the ants on
 * their own canvas, and those two readings arrive by different routes, so the name says what is
 * being compared rather than which colour happened to be on the surface that carried it.
 */
const expectOutlineAround = (
  // Only the four edges are read here, so this asks for only the four edges: the ants read has no
  // `imageWidth`/`centerX` to offer, and a parameter that required fields it never uses would be
  // padding the read with values computed for a different purpose.
  found: Pick<SelectionBounds, 'left' | 'top' | 'right' | 'bottom'> | null,
  clip: Required<ClipOptions>,
  expected: Required<ClipOptions>,
  slackPx = OUTLINE_SLACK_PX
) => {
  const report = {
    expected,
    found: found && { ...found, left: found.left + clip.x, top: found.top + clip.y },
  };
  expect(found, `no selection border pixels found (${JSON.stringify(report)})`).not.toBeNull();
  const outline = found!;
  const edges = {
    left: outline.left + clip.x,
    top: outline.top + clip.y,
    right: outline.right + clip.x,
    bottom: outline.bottom + clip.y,
  };
  expect(
    edges.left,
    `selection outline left of the dragged region (${JSON.stringify({ ...report, edges })})`
  ).toBeGreaterThanOrEqual(expected.x - slackPx);
  expect(
    edges.top,
    `selection outline top of the dragged region (${JSON.stringify({ ...report, edges })})`
  ).toBeGreaterThanOrEqual(expected.y - slackPx);
  expect(
    edges.right,
    `selection outline right of the dragged region (${JSON.stringify({ ...report, edges })})`
  ).toBeLessThanOrEqual(expected.x + expected.width + slackPx);
  expect(
    edges.bottom,
    `selection outline bottom of the dragged region (${JSON.stringify({ ...report, edges })})`
  ).toBeLessThanOrEqual(expected.y + expected.height + slackPx);
};

/**
 * The Move tool's transform box is drawn in the same `#007bff` as a selection, by the same
 * `useRect.drawMask`, so the two are indistinguishable by colour alone. They are, however, drawn
 * on DIFFERENT canvases: `useRect`'s `overlayRef` is `rectOverlayRef` for `MoveToolArea`
 * (`src/components/Main/MoveToolArea.tsx:87`) and `toolOverlayRef` for
 * `RectangularSelectionToolArea` (`src/components/Main/RectangularSelectionToolArea.tsx:45`), and
 * `Main.tsx:199-205` displays `rectOverlayRef` only while `interactionMode === 'reposition'`.
 *
 * So this assertion is what makes "these pixels are a selection, not a Move transform box" a
 * checked fact instead of an assumption about which tool the test happened to leave selected.
 * Every selection test calls it before it reads a pixel.
 */
const expectMoveTransformBoxHidden = async (page: Page) => {
  await expect(
    page.getByTestId('rect-overlay-canvas'),
    'the Move tool overlay must not be displayed while a selection tool is active'
  ).toBeHidden();
};

/** Selects the polygonal lasso out of the shared lasso flyout. */
const selectPolygonalLasso = async (page: Page) => {
  await openToolFlyoutViaRightClick(page, 'freehand-lasso');
  await selectFromFlyout(page, { toolName: 'polygonal-lasso', label: 'Polygonal Lasso Tool' });
  await verifyPrimaryTool(page, 'polygonal-lasso', 'Polygonal Lasso Tool');
  await expectMoveTransformBoxHidden(page);
};

test.describe('Selection tools', () => {
  test.beforeEach(async ({ page }) => {
    // Before the navigation, so the app lays out once at the pinned size and every measurement
    // below is taken against that layout rather than against a resize mid-test.
    await page.setViewportSize(VIEWPORT);
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('marquee drag leaves a selection outline at the dragged rectangle', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = await overlayClip(page, box);

    await clickToolButton(page, 'rectangular-selection');
    await expect(page.getByTestId('tool-overlay-canvas')).toBeVisible();
    await expectMoveTransformBoxHidden(page);

    const dragged = boxRect(box, 0.3, 0.32, 0.6, 0.64);
    await dragOnCanvas(
      page,
      box,
      { x: dragged.x, y: dragged.y },
      { x: dragged.x + dragged.width, y: dragged.y + dragged.height }
    );

    await waitForSelectionBlue(page, clip, 'a selection outline after the marquee drag');
    expectOutlineAround(await selectionBlue(page, clip), clip, toPage(box, dragged));
  });

  test('Clear removes the selection outline', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = await overlayClip(page, box);

    await clickToolButton(page, 'rectangular-selection');
    await expectMoveTransformBoxHidden(page);

    const dragged = boxRect(box, 0.32, 0.34, 0.58, 0.62);
    await dragOnCanvas(
      page,
      box,
      { x: dragged.x, y: dragged.y },
      { x: dragged.x + dragged.width, y: dragged.y + dragged.height }
    );
    await waitForSelectionBlue(page, clip, 'a selection outline before Clear');
    expectOutlineAround(await selectionBlue(page, clip), clip, toPage(box, dragged));

    const clearButton = page.getByRole('button', { name: 'Clear', exact: true });
    await expect(clearButton).toBeEnabled();
    await clearButton.click();
    // The button going disabled is the store-level effect. Waiting for it means the first
    // screenshot of the poll below is taken after React has already dropped the selection, so
    // "the outline is gone" cannot pass by being sampled before the click landed.
    await expect(clearButton).toBeDisabled();

    await waitForNoSelectionBlue(page, clip, 'the selection outline to be gone after Clear');
  });

  // RED on purpose. Documents the P1 in e2e/OPEN_PROBLEMS.md: the tool switch deselects, and
  // the marquee's outline AND its 70% darkening mask both survive it. Two separate assertions
  // because they are two separate halves of the defect, and a fix that only cleared the outline
  // would leave the whole document dimmed outside the rectangle with nothing here noticing.
  test('switching to another tool removes the selection outline and its darkening mask', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = await overlayClip(page, box);

    await clickToolButton(page, 'rectangular-selection');
    await expectMoveTransformBoxHidden(page);

    // The region the darkening mask covered and the outline did not: outside `dragged` on x, in
    // its vertical band, and far enough inside the canvas box to be over document pixels rather
    // than the workspace backdrop outside the letterbox. Captured before the drag, while nothing
    // is masked, so it is the undimmed value both later comparisons are made against.
    const outsideMarquee = regionClip(clip, boxRect(box, 0.06, 0.42, 0.2, 0.5));
    const undimmed = await page.screenshot({ clip: outsideMarquee });

    const dragged = boxRect(box, 0.3, 0.32, 0.58, 0.6);
    await dragOnCanvas(
      page,
      box,
      { x: dragged.x, y: dragged.y },
      { x: dragged.x + dragged.width, y: dragged.y + dragged.height }
    );
    await waitForSelectionBlue(page, clip, 'a selection outline before the tool switch');
    expectOutlineAround(await selectionBlue(page, clip), clip, toPage(box, dragged));

    // This is what makes the "and its darkening mask" half of the test non-vacuous: it proves
    // the region WAS inside the mask, so a later "the mask is gone" cannot pass because the
    // region was never covered. Without it, a refactor that moved the marquee or the region
    // would turn the whole test into a green no-op.
    const masked = await page.screenshot({ clip: outsideMarquee });
    expect(
      await maxDarkening(undimmed, masked),
      'the marquee mask darkened the region beside the outline while the selection existed'
    ).toBeGreaterThan(50);

    // Draw, not Move: the Draw tool keeps the tool overlay displayed and has no transform box of
    // its own, so the only thing that can stop being blue in this clip is the deselect.
    await clickToolButton(page, 'draw');
    await expect(page.getByTestId('tool-overlay-canvas')).toBeVisible();
    await expectMoveTransformBoxHidden(page);

    // Mask FIRST, so in the defective state the failure names the mask rather than the outline.
    // The order changes nothing for a correct fix — both polls must pass — but it is what makes
    // this assertion demonstrably load-bearing today: it is the one that fails.
    await waitForCanvasPixels(
      page,
      outsideMarquee,
      async (png) => (await maxDarkening(undimmed, png)) <= MAX_DARKENING_LEVELS,
      { description: 'the selection darkening mask to be gone after the tool switch' }
    );

    await waitForNoSelectionBlue(page, clip, 'the selection outline to be gone after the tool switch');
  });

  test('Copy and Clear are enabled only while a selection exists', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = await overlayClip(page, box);

    await clickToolButton(page, 'rectangular-selection');
    await expectMoveTransformBoxHidden(page);

    const copyButton = page.getByRole('button', { name: 'Copy', exact: true });
    const clearButton = page.getByRole('button', { name: 'Clear', exact: true });
    await expect(copyButton, 'Copy with no selection').toBeDisabled();
    await expect(clearButton, 'Clear with no selection').toBeDisabled();
    await waitForNoSelectionBlue(page, clip, 'no selection outline before any drag');

    const dragged = boxRect(box, 0.3, 0.32, 0.58, 0.6);
    await dragOnCanvas(
      page,
      box,
      { x: dragged.x, y: dragged.y },
      { x: dragged.x + dragged.width, y: dragged.y + dragged.height }
    );

    await waitForSelectionBlue(page, clip, 'a selection outline after the marquee drag');
    expectOutlineAround(await selectionBlue(page, clip), clip, toPage(box, dragged));
    await expect(copyButton, 'Copy with a committed selection').toBeEnabled();
    await expect(clearButton, 'Clear with a committed selection').toBeEnabled();

    await clearButton.click();
    await expect(clearButton).toBeDisabled();
    await expect(copyButton).toBeDisabled();
    await waitForNoSelectionBlue(page, clip, 'the selection outline to be gone after Clear');
  });

  test('magic wand click outlines the region under the cursor', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = await overlayClip(page, box);
    const stroke = {
      from: { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.45) },
      to: { x: Math.round(box.width * 0.6), y: Math.round(box.height * 0.45) },
    };

    // A flat region to click into: one opaque horizontal stroke at a 120px brush is a solid bar.
    // The draw tool is used rather than a filled shape because a filled shape's fill colour is
    // open product design, not a defect with a known answer - see e2e/OPEN_PROBLEMS.md.
    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await page.locator('#size-slider').fill(String(BRUSH_PX));
    await page.locator('#alpha-slider').fill('1');
    await expect(page.locator('#size-slider')).toHaveValue(String(BRUSH_PX));
    await expect(page.locator('#alpha-slider')).toHaveValue('1');
    await dragOnCanvas(page, box, stroke.from, stroke.to);

    const barMidpoint = { x: (stroke.from.x + stroke.to.x) / 2, y: stroke.from.y };
    await waitForCanvasPixels(page, probeClip(clip, barMidpoint.x, barMidpoint.y), hasDarkPixels, {
      description: 'the painted bar on the workspace canvas',
    });

    // The bar is MEASURED, not predicted. The brush width is a canvas line width, so it is in
    // document pixels, and the document is fitted into the canvas box by a scale that depends on
    // the viewport (measured at this file's pinned size as an 800x600 document in a 974x863
    // box, i.e. 1.2175, width-limited). Predicting the bar's CSS height from BRUSH_PX would
    // bake that scale in and break at any other viewport, so the painted pixels are read back
    // instead. The only geometry asserted directly is the bar's horizontal centre, which a
    // round-capped stroke puts on the stroke's midpoint at any scale.
    const barRegion = regionClip(clip, {
      x: stroke.from.x - BRUSH_PX * 2,
      y: stroke.from.y - BRUSH_PX * 2,
      width: stroke.to.x - stroke.from.x + BRUSH_PX * 4,
      height: BRUSH_PX * 4,
    });
    const painted = await getDarkPixelBounds(await page.screenshot({ clip: barRegion }));
    if (!painted) throw new Error(`No dark pixels painted in the bar region ${JSON.stringify(barRegion)}`);
    // `PixelBounds` is inclusive on both edges, so a bar of odd width has its centre half a pixel
    // out. One pixel of slack covers that quantisation and nothing else.
    const barCentreOffset = Math.abs(painted.left + painted.width / 2 + barRegion.x - (box.x + barMidpoint.x));
    expect(barCentreOffset, 'painted bar centre vs the stroke midpoint').toBeLessThanOrEqual(1);

    await clickToolButton(page, 'magic-wand');
    await expect(page.locator('#magic-wand-tolerance')).toBeVisible();
    await expect(page.locator('#magic-wand-smoothing')).toBeVisible();
    await expectMoveTransformBoxHidden(page);
    await waitForNoSelectionBlue(page, clip, 'no selection outline before the wand click');

    await page.mouse.click(box.x + barMidpoint.x, box.y + barMidpoint.y);

    // The committed border is the ants, not the blue: `drawSelectionOutline` keeps the dashed
    // blue stroke for the selection tools that stay on the tool overlay (the elliptical and quick
    // selections), while the polygon's border moved to the marching-ants canvas. So the geometry
    // below is read off that canvas in DOCUMENT pixels and mapped back through the contain fit,
    // which is the same mapping the click itself went through — predicting it from the CSS box
    // instead would bake this file's viewport into the assertion.
    await waitForCommittedAnts(page, 'a committed selection border after the wand click');
    expectOutlineAround(await committedAntsOutline(page), ORIGIN_CLIP, {
      x: barRegion.x + painted.left,
      y: barRegion.y + painted.top,
      width: painted.right - painted.left,
      height: painted.bottom - painted.top,
    });

    // The flood fill's own count, reported by the tool, as a CROSS-CHECK against the outline
    // above and not as a statement about the count. It is a lower bound: an outline exists, so
    // the tool cannot be reporting zero selected pixels, and those are two independent surfaces
    // reporting the same gesture. It asserts nothing about the VALUE — that number counts
    // DOCUMENT pixels while the drag is in CSS pixels, and the two are joined by a fit scale
    // that depends on the viewport, so the geometry assertion is what carries this test.
    const report = page.getByText(/\d[\d,]*\s*pixels selected/);
    await expect(report).toBeVisible();
    const reported = Number.parseInt((await report.innerText()).replace(/\D/g, ''), 10);
    expect(reported, 'the wand reports a non-zero count alongside the outline it drew').toBeGreaterThan(0);
  });

  test('Enter closes a polygonal lasso and strokes its final edge', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = await overlayClip(page, box);
    await selectPolygonalLasso(page);

    const p0 = { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.3) };
    const p1 = { x: Math.round(box.width * 0.6), y: Math.round(box.height * 0.36) };
    const p2 = { x: Math.round(box.width * 0.36), y: Math.round(box.height * 0.64) };
    for (const point of [p0, p1, p2]) {
      await page.mouse.click(box.x + point.x, box.y + point.y);
    }

    // The draft is stroked as an OPEN path, so p2->p0 reaches the overlay only once the selection
    // is committed. Proving it is absent first is what stops this passing on the draft alone.
    const closingEdgeClip = probeClip(clip, (p2.x + p0.x) / 2, (p2.y + p0.y) / 2);
    await waitForSelectionBlue(page, clip, 'the open draft polyline');
    expect(await selectionBlue(page, closingEdgeClip), 'the closing edge is stroked before Enter').toBeNull();

    await page.keyboard.press('Enter');

    // The closing edge appears as the COMMITTED border, which is the ants on their own canvas and
    // not the tool overlay's blue — so this is the only reading that can tell a committed
    // polygon from the draft the wait above was watching. The draft itself is gone by now, so a
    // blue reading here would fail rather than pass for the wrong reason.
    await waitForCommittedAnts(page, 'the committed border closing the polygon');
    expectOutlineAround(await committedAntsOutline(page), ORIGIN_CLIP, {
      x: box.x + Math.min(p0.x, p1.x, p2.x),
      y: box.y + Math.min(p0.y, p1.y, p2.y),
      width: Math.max(p0.x, p1.x, p2.x) - Math.min(p0.x, p1.x, p2.x),
      height: Math.max(p0.y, p1.y, p2.y) - Math.min(p0.y, p1.y, p2.y),
    });
  });

  test('Escape cancels a polygonal lasso and leaves no outline', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = await overlayClip(page, box);
    await selectPolygonalLasso(page);

    const p0 = { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.3) };
    const p1 = { x: Math.round(box.width * 0.6), y: Math.round(box.height * 0.36) };
    const p2 = { x: Math.round(box.width * 0.36), y: Math.round(box.height * 0.64) };
    for (const point of [p0, p1, p2]) {
      await page.mouse.click(box.x + point.x, box.y + point.y);
    }
    await waitForSelectionBlue(page, clip, 'the open draft polyline before Escape');

    await page.keyboard.press('Escape');

    await waitForNoSelectionBlue(page, clip, 'the outline to be gone after Escape');
  });
});
