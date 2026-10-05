import { expect, test, type Page } from './fixtures/extended-test';
import {
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
import { committedAntsOutline, waitForCommittedAnts } from './helpers/selection-ants';
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
 *   `MoveToolArea.tsx:126`) and is genuinely excluded, so blue that survives on
 *   `tool-overlay-canvas` while a selection tool is active cannot be a transform box.
 * - `useMarchingAnts` is NOT excluded. `MoveToolArea.tsx:32` runs it on `toolOverlayRef` — the
 *   SAME canvas the rectangular selection's `useRect` paints. The guard is safe there today
 *   only because `useAnts.ts:92,96` strokes the ants black and then white, and neither black
 *   nor white satisfies the blue thresholds below. That is a fact about that file's two
 *   colours, not something this file proves; recolouring the ants blue would let these tests
 *   pass on a transform box. The independent discriminator, used by the marquee tests, is the
 *   mask: a `useRect` selection darkens everything outside its rectangle (`useRect.ts:302-306`)
 *   and a Move transform box does not, because `MoveToolArea` passes `hideBlend: true`
 *   (`MoveToolArea.tsx:122`).
 * - A marquee's own `#007bff` dashed border no longer contributes to that question at all:
 *   `borderMode` gates it to `'while-dragging'` (`useRect.ts:319`), so at rest the only blue a
 *   rectangular marquee leaves on the tool overlay is its four corner handles
 *   (`useRect.ts:331-337`).
 * - For the two lasso tests the discriminator is CANVAS, which it used not to be: the draft is
 *   the blue open path on the tool overlay, and a committed selection's border is the ants on
 *   `selection-ants-canvas` (`src/hooks/useSelectionAnts.ts`), in black and white. Geometry is
 *   the second discriminator, inside the draft itself — `p2 -> p0` reaches the tool overlay only
 *   once `closePath` is set (`PolygonClickToolArea.tsx:100-102`), which the Enter test proves
 *   absent before it presses the key.
 */

/**
 * The app's selection colour, `rgb(0, 123, 255)` — written `#007bff` by `useRect.drawMask`, for
 * the corner handles (`src/hooks/useRect.ts:333`) and for the marquee's own dashed border while a
 * drag is in flight (`src/hooks/useRect.ts:320`), and written `rgba(0,123,255,...)` by the tool
 * areas' transient drag previews (`EllipticalSelectionToolArea.tsx:70`,
 * `QuickSelectionToolArea.tsx:72`, `SingleRowColumnMarqueeToolArea.tsx:80`). It is no longer the
 * colour of any COMMITTED border: those are the ants' black and white. Read explicitly rather
 * than relying on the helper's defaults, so a change to those defaults cannot silently move the
 * threshold this file asserts against.
 */
const SELECTION_COLOR_THRESHOLDS = { redMax: 80, greenMin: 80, blueMin: 180 };

/**
 * How far outside the intended shape a selection-blue pixel may land.
 *
 * Each reading in this file paints outside its own geometry by a known amount, and each amount is
 * attributed here rather than lumped together — the sources changed under this file, and an
 * unattributed overshoot cannot be re-derived when they change again.
 *
 * - A RECTANGULAR marquee at rest paints its four corner handles and NOTHING else: its own dashed
 *   border is gated behind `borderMode: 'while-dragging'` (`src/hooks/useRect.ts:319`) and
 *   `RectangularSelectionToolArea` calls no anchor painter, so `useRect`'s handle fills
 *   (`src/hooks/useRect.ts:331-337`) are the whole of the blue. `HANDLE_SIZE` is 12
 *   (`src/util/constants.ts:1`) and is divided by the contain fit before it reaches the context, so
 *   a handle reaches `HANDLE_SIZE / scale / 2` beyond its corner — 4.93 document px at this file's
 *   fit, which pixel quantisation turns into 5 document px on the leading edges and 4 on the
 *   trailing ones.
 * - The ANTS reads carry no handles and no anchors, so their only overshoot is the stroke's own
 *   half-width, `LINE_WIDTH / scale` (`src/hooks/useAnts.ts:13,88`) — under 1 CSS px either side.
 *   The anchor dots are painted on the tool overlay (`drawSelectionAnchors`,
 *   `src/util/selection.ts:146`), never on the ants canvas, so they cannot reach a
 *   `committedAntsOutline` reading.
 * - The magic wand's `simplifyClosedPath` (`src/util/magicWand.ts:178`) can move a vertex by the
 *   smoothing tolerance (1.5 by default) either way, and its flood fill drops the outermost
 *   anti-aliased ring.
 *
 * MEASURED and then DERIVED, because the two agree only when both are right: dragging a marquee
 * to a known box-relative rectangle and reading the blue back with the clip origin added gives an
 * overshoot of 6px on the left and top and 5px on the right and bottom. Multiplying the handle
 * arithmetic above by this file's 1.2175 fit gives 5 x 1.2175 = 6.09 and 4 x 1.2175 = 4.87 — the
 * measured pair — and the derivation also accounts for the ASYMMETRY, which leading/trailing pixel
 * rounding does and a symmetric 2px stroke did not. The same arithmetic at the 0.9717 fit an
 * inherited 1280x720 gives yields 6 and 5 document px, i.e. 5.83 and 4.86 CSS px, which is why the
 * pair came out the same at both sizes. An earlier version of this comment rested the number on
 * the measurement alone and concluded the offset was not scaled by the document-to-CSS fit at all;
 * the offset IS scaled, in document px, and only the CSS-px pair it happens to produce is
 * fit-independent. The measurement is what the number rests on; the arithmetic is what says which
 * pixel it is.
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
 * (`useRect.ts:302`) over everything outside the rectangle, which moves a 255-level document
 * pixel to about 76. Measured in this file's own geometry: that region darkens by exactly 179
 * levels while the selection exists, and by at most 2 after the tool switch that deselects it.
 * That second number used to be another 179 — the P1 this constant was written against — and what
 * closed it is the unmount cleanup in `useRect` (`useRect.ts:152-174`), because the overlay
 * canvas outlives the tool area that painted it. A tolerance of 2 cannot absorb any fraction of
 * the 179, and neither can a tolerance of 100.
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
 * `HANDLE_SIZE` (`src/util/constants.ts`), copied rather than imported because nothing under
 * `e2e/` may import from `src/` — `paint-options.spec.ts` states the rule and `text-edit.spec.ts`
 * follows it for `PLACEHOLDER_TEXT`. There is no runtime channel to equality-check a constant
 * against, so a change to the source has to change this copy with it.
 */
const HANDLE_SIZE = 12;

/**
 * The tool overlay's selection chrome at REST, as a rect to compare a `selectionBlue` read against.
 *
 * `selectionBlue` screenshots the tool overlay for `#007bff`, and what is on that overlay once a
 * marquee has been committed is `useRect`'s four corner HANDLES, not a border:
 * `borderMode: 'while-dragging'` keeps the dashed stroke for the drag the ants stood down for and
 * drops it when the gesture closes, because the committed border is the marching ants on
 * `selection-ants-canvas` and two outlines of one selection is worse than either.
 *
 * `useRect` draws each handle as `fillRect(x - h1, y - h1, h1, h1)` and so on (`useRect.ts` —
 * `drawMask()`), with `h1` being `HANDLE_SIZE / scale`. The handles therefore sit OUTSIDE every
 * corner rather than inside it, and the box they bound is the committed rect grown by
 * `HANDLE_SIZE` on all four sides — not the rect itself. Asserting the handle box against the bare
 * rect fails on the two containment edges by exactly that margin, which is why this grows the
 * expectation instead of leaving `OUTLINE_SLACK_PX` to absorb it: the allowance is a measured
 * geometry, not a tolerance, and folding it into the slack would hide the same 2px on any future
 * regression.
 */
const overlayChromeAtRest = (box: BoundingBox, rect: Rect): Required<ClipOptions> => {
  const page = toPage(box, rect);
  return {
    x: page.x - HANDLE_SIZE,
    y: page.y - HANDLE_SIZE,
    width: page.width + HANDLE_SIZE * 2,
    height: page.height + HANDLE_SIZE * 2,
  };
};

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
 * "Selection border" rather than "selection blue": every committed selection's border is the ants
 * on their own canvas, and those readings arrive by a different route than a screenshot of the
 * tool overlay, so the name says what is being compared rather than which colour happened to be
 * on the surface that carried it.
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
 * (`src/components/Main/MoveToolArea.tsx:126`) and `toolOverlayRef` for
 * `RectangularSelectionToolArea` (`src/components/Main/RectangularSelectionToolArea.tsx:70`), and
 * `Main.tsx:369` displays `rectOverlayRef` only while `interactionMode === 'reposition'`.
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
    // What this reads at rest is narrower than the test's name sounds, and that is a property of
    // the app rather than a choice made here. `borderMode: 'while-dragging'` (`useRect.ts:319`)
    // keeps the dashed border for the drag the ants stood down for and drops it once the gesture
    // closes, so the committed BORDER is the ants on `selection-ants-canvas`
    // (`src/hooks/useSelectionAnts.ts`) and the blue left on the tool overlay is `useRect`'s four
    // corner handles (`useRect.ts:331-337`). The assertion is therefore "a marquee drag left a
    // selection where the drag was", which is this test's intent and which the handles prove — and
    // it would still pass if the ants were switched off entirely. Asserting the border itself needs
    // `committedAntsOutline`, which the wand and the polygon below already use.
    expectOutlineAround(await selectionBlue(page, clip), clip, overlayChromeAtRest(box, dragged));
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
    expectOutlineAround(await selectionBlue(page, clip), clip, overlayChromeAtRest(box, dragged));

    const clearButton = page.getByRole('button', { name: 'Clear', exact: true });
    await expect(clearButton).toBeEnabled();
    await clearButton.click();
    // The button going disabled is the store-level effect. Waiting for it means the first
    // screenshot of the poll below is taken after React has already dropped the selection, so
    // "the outline is gone" cannot pass by being sampled before the click landed.
    await expect(clearButton).toBeDisabled();

    await waitForNoSelectionBlue(page, clip, 'the selection outline to be gone after Clear');
  });

  // Two separate assertions because they were two separate halves of one defect: the tool switch
  // deselects, and the marquee's outline AND its 70% darkening mask both survived it, so a fix
  // that cleared only the outline would have left the whole document dimmed outside the rectangle
  // with nothing here noticing. This was RED on purpose then, pinned to a P1 in
  // e2e/OPEN_PROBLEMS.md; that entry is gone and the test is GREEN, because `useRect`'s unmount
  // cleanup (`useRect.ts:152-174`) clears the overlay canvas that outlives the tool area. The
  // split is kept because the fix could still have been half a fix, and in the defective state the
  // mask poll is the leg that fails — which is why it runs first.
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
    expectOutlineAround(await selectionBlue(page, clip), clip, overlayChromeAtRest(box, dragged));

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
    expectOutlineAround(await selectionBlue(page, clip), clip, overlayChromeAtRest(box, dragged));
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

    // The committed border is the ants, in black and white, on
    // `selection-ants-canvas` (`src/hooks/useSelectionAnts.ts`) — for the wand exactly as for
    // every other selection tool, because it is in `Main.tsx`'s `SELECTION_INTERACTION_MODES`.
    // Nothing paints a committed selection's border on the tool overlay any more: the static
    // `rgba(0,123,255,0.95)` 2px 6/4 dashed outline is gone from the tool areas, and the marquee's
    // own `useRect` stroke is gated to `'while-dragging'` (`useRect.ts:319`), so the blue those
    // areas write is a transient drag preview that survives release not at all. So the geometry
    // below is read off the ants canvas in DOCUMENT pixels and mapped back through the contain fit,
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
    // not the tool overlay's blue — so this is the only reading that can tell a committed polygon
    // from the draft the wait above was watching. A blue reading here would fail rather than pass
    // for the wrong reason, and it is worth saying what blue is left: the draft is gone, but the
    // committed selection's anchors are not, and `drawSelectionAnchors` strokes the first one
    // `rgba(0,123,255,1)` while every other anchor is stroked black (`src/util/selection.ts:174-182`)
    // — so a blue reading would see one disc, and a 10px disc is not the polygon's bounds.
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
