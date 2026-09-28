import { expect, type Page, test } from '@playwright/test';
import {
  type BoundingBox,
  type PixelPredicate,
  drawLine,
  getSelectionBounds,
  getWorkspaceCanvas,
  hasRedPixels,
  loadImageData,
  scanPixelsForBounds,
  STROKE_ANALYSIS,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';

/**
 * The Text tool had no end-to-end coverage: `e2e/color.spec.ts` is a single test about
 * the foreground swatch and nothing drove the Type tool, its draft rectangle, its Apply
 * gate or the layer it commits.
 */

/**
 * The suite default is 30s (`playwright.config.ts:31`). Every test here is a page load,
 * a tool click, a drag and at most one redraw poll, which measures at 1-2s on this
 * host, so 30s was never the binding constraint. 60s is what the two sibling specs that
 * drive the canvas already ask for (`viewport-drawing.spec.ts:17`, `select-move.spec.ts:31`)
 * and it leaves room for a dev-server cold start and font rasterisation on CI's runner.
 */
const TEXT_TOOL_TIMEOUT_MS = 60_000;

/**
 * The rectangle the draft is dragged out in, in canvas-box coordinates. The workspace
 * canvas measures 974x840 at the suite's 1280x720 desktop viewport and the starting
 * document is 800x600 (`App.tsx:16-21`), so this lands well inside the document and
 * inside the visible viewport.
 */
const DRAFT_RECT = { x1: 200, y1: 200, x2: 600, y2: 320 };

/** Interpolated pointer moves for the drag. `useRect` recomputes the rect on pointer-up. */
const DRAFT_DRAG_STEPS = 10;

/**
 * How far outside the dragged rectangle the committed ink may sit, in CSS px, on every
 * side. The rectangle is 400x120 CSS px wide, so any tolerance well inside a tenth of
 * that is a real statement about placement rather than a rounding allowance.
 *
 * It cannot be 0: the glyphs are inset by `TEXT_PADDING` (5 document px,
 * `src/util/constants.ts:3`) plus the font's own side bearing and ascent, and the
 * document is displayed at a contain scale rather than 1:1. Measured on this host with
 * the corrected capture - the whole canvas, mapped onto the canvas box - the ink sits
 * 11 / 20 / 328 / 45 CSS px inside the dragged rectangle on left / top / right / bottom.
 *
 * Left is the binding edge, so the margin has to stay BELOW that 11: at 12 it was the
 * margin rather than a placement change that decided whether the run went red, which is
 * the same as no margin at all. 6 leaves 5px of cushion on the tightest edge against
 * font and rasterisation variation, and is still ~66x tighter than the rectangle is
 * wide, so ink from anywhere else cannot pass on it.
 */
const INK_MARGIN = 6;

/**
 * The clip the presence poll watches. Deliberately not load-bearing: it only has to be
 * wide enough to contain the glyphs wherever the font puts them, and wider than
 * `INK_MARGIN` so that a containment failure is reported by the four comparisons rather
 * than by this poll timing out on an empty region.
 *
 * It also has to stay inside the 720px viewport, because `waitForCanvasPixels` reads
 * through `page.screenshot` (`canvas-helpers.ts:380`) and that truncates a clip at the
 * fold silently - a truncated region reads as "no pixels" rather than as an error. The
 * CDP capture below does not truncate, which is why the two clips differ.
 */
const POLL_MARGIN = 24;

/** The colour the Text toolbar paints with, read from the store's foreground. */
const FOREGROUND = '#ff0000';

/**
 * `createLayerSource` names a tool layer `${toolName} ${maxOrder}` after the tool that
 * produced it (`src/contexts/layer-utils.ts:141-148`, `:167`), and the blank document
 * layer the app starts with is order 1, so the first text layer over it is `text 2`.
 *
 * Asserted as a shape, not as that literal: the order suffix is `maxOrder`, which the
 * layers panel already covers, and pinning it in tests whose subject is a commit's
 * pixels or a Clear button means a rename in `layer-utils.ts` fails them for a reason
 * that has nothing to do with what they are about. Only the test that is about the layer
 * being a text layer at all asserts a name; the others assert row counts.
 */
const TOOL_LAYER_NAME = /^text \d+$/;

/** The blank bedrock layer `App.tsx:16-21` creates on start, named `Blank` at `layer-utils.ts:145`. */
const STARTING_LAYER_NAME = 'Blank 1';

/**
 * Foreground red, as a predicate. These are the constants `hasRedPixels` itself reads,
 * so a pixel that satisfies this one is the same pixel that helper would report: ink in
 * any other colour - black default text, the blue selection outline - cannot match.
 */
const { RED_PIXEL_RED_MIN, RED_PIXEL_GREEN_MAX, RED_PIXEL_BLUE_MAX } = STROKE_ANALYSIS;
const isForegroundInk: PixelPredicate = (red, green, blue, alpha) =>
  alpha !== 0 && red > RED_PIXEL_RED_MIN && green < RED_PIXEL_GREEN_MAX && blue < RED_PIXEL_BLUE_MAX;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The dragged draft rectangle in page CSS coordinates, grown by `margin` on every side. */
function draftRectCss(box: BoundingBox, margin: number): Rect {
  return {
    left: box.x + DRAFT_RECT.x1 - margin,
    top: box.y + DRAFT_RECT.y1 - margin,
    right: box.x + DRAFT_RECT.x2 + margin,
    bottom: box.y + DRAFT_RECT.y2 + margin,
  };
}

function toClip(rect: Rect): { x: number; y: number; width: number; height: number } {
  return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
}

/**
 * The Type tool is a one-tool group in `toolbar-mapping.ts:74`, so `SidebarLeft` gives it
 * a plain `tool-button-text`: a group only publishes a flyout when it holds more than one
 * tool (`SidebarLeft.tsx:143`). `clickToolButton` therefore resolves on its first attempt
 * and no flyout long-press is needed.
 */
async function selectTextTool(page: Page): Promise<void> {
  await clickToolButton(page, 'text');
  await expect(page.locator('#text-input'), 'the Text toolbar should be mounted').toBeVisible();
}

/**
 * `drawLine` is this suite's only pointer-drag primitive; it is named for the stroke it
 * was written for, and the Text tool reads the same down/move/up trio through the
 * `onPointerDown` / `onPointerUp` pair `useRect` spreads onto its tool area.
 */
async function dragDraftRect(page: Page, box: BoundingBox): Promise<void> {
  await drawLine(page, box, DRAFT_RECT.x1, DRAFT_RECT.y1, DRAFT_RECT.x2, DRAFT_RECT.y2, {
    steps: DRAFT_DRAG_STEPS,
  });
}

/**
 * Re-reads the canvas box. Selecting a tool mounts its options toolbar, which can reflow
 * the workspace, so a box measured before the click can be stale - the reason
 * `levels.spec.ts:93-96` re-measures for the same reason.
 */
async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('text-tool: workspace canvas has no visible coordinates');
  return box;
}

test.describe('Text tool', () => {
  test.describe.configure({ timeout: TEXT_TOOL_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await selectTextTool(page);
  });

  test('Apply stays disabled without text, and dragging a rectangle does not change that', async ({ page }) => {
    const input = page.locator('#text-input');
    const apply = page.getByRole('button', { name: 'Apply' });
    const box = await canvasBox(page);

    // Neither input: no rectangle dragged and no text typed.
    await expect(apply).toBeDisabled();

    // A rectangle on its own does not enable it. The selection outline is what makes
    // this half mean something: without it, `toBeDisabled()` would also pass when the
    // drag never registered, so the assertion would be about a drag that did not happen
    // rather than about the gate. The wait clip is grown by `INK_MARGIN` because the
    // outline is stroked along the rectangle's own edge (`drawSelectionOutline`).
    await dragDraftRect(page, box);
    await waitForCanvasPixels(
      page,
      toClip(draftRectCss(box, INK_MARGIN)),
      async (png) => {
        return (await getSelectionBounds(png)) !== null;
      },
      { description: 'the draft rectangle outline' }
    );

    await expect(apply).toBeDisabled();

    // Text is what lifts it. Typed after the drag, never instead of it: `!rect` is not
    // reachable from this toolbar at all, because `calculateNewRect` manufactures a
    // rectangle from its null placeholder on every keystroke (`src/util/rect.ts:123`), so
    // Apply enables on text alone. That is the open problem recorded in
    // `e2e/OPEN_PROBLEMS.md`, and typing without a drag here would pin the behaviour the
    // entry questions - so this test keeps the drag-then-type order and a fix to the gate
    // leaves it green.
    await input.fill('Applied');
    await expect(apply).toBeEnabled();
  });

  test('committing a draft adds a text layer to the layers panel', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const input = page.locator('#text-input');
    const apply = page.getByRole('button', { name: 'Apply' });
    const box = await canvasBox(page);

    await expect(layerRows).toHaveText([STARTING_LAYER_NAME]);

    await dragDraftRect(page, box);
    await input.fill('Hello');
    await apply.click();

    // A second row, topmost first, and it is a text layer. This is the one test whose
    // subject is the layer itself, so it is the one that asserts the generated name; the
    // commit's pixels and the Clear button assert row counts instead.
    await expect(layerRows).toHaveCount(2);
    await expect(layerRows.nth(0)).toHaveText(TOOL_LAYER_NAME);
    await expect(layerRows.nth(1)).toHaveText(STARTING_LAYER_NAME);
  });

  test('committed text reaches the canvas as foreground pixels inside the dragged rectangle', async ({
    page,
  }, testInfo) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const input = page.locator('#text-input');
    const apply = page.getByRole('button', { name: 'Apply' });
    const box = await canvasBox(page);

    await setForegroundColor(page, FOREGROUND, true);
    await dragDraftRect(page, box);
    await input.fill('Hi');
    await apply.click();

    // The commit empties the draft (`Text.tsx:86`). That is what makes the pixel read
    // below a statement about the document rather than about the live preview: while the
    // draft is non-empty the tool overlay repaints the same glyphs on every keystroke
    // (`TextToolArea.tsx:46-50` -> `redrawText` -> `renderText`), so red pixels on screen
    // would not yet prove anything reached the layer. With the draft gone the overlay
    // draws nothing, and the only red on the canvas is the committed layer.
    await expect(input).toHaveValue('');
    await expect(apply).toBeDisabled();
    await expect(layerRows).toHaveCount(2);

    await waitForCanvasPixels(page, toClip(draftRectCss(box, POLL_MARGIN)), hasRedPixels, {
      description: 'red text pixels',
    });

    // The whole canvas is captured, not the asserted rectangle, and the image is mapped
    // onto the canvas box. That is the difference between an assertion that can fail and
    // one that cannot: capture the rectangle and map it onto itself and every pixel the
    // scan can see is inside it by construction, so all four comparisons below hold
    // whatever the app did. Capturing the canvas makes the ink bounds unconditional, so
    // ink anywhere else on it - a different origin, a shifted baseline - lands outside
    // the rectangle and turns the run red. `viewport-drawing.spec.ts:61-69` is the same
    // pattern: capture an element, map with that element's box.
    //
    // `box` is `captureCanvasScreenshot`'s fallback for when no clip is passed
    // (`cdp-helpers.ts:52-57`); no clip is passed here, so the fallback IS the capture.
    const capture = await captureCanvasScreenshot(page, box, testInfo, 'text-committed');
    const image = await loadImageData(capture);
    const ink = await scanPixelsForBounds(image, isForegroundInk);
    expect(ink.found, 'no foreground-red pixels anywhere on the canvas after Apply').toBe(true);

    // The capture really is the whole canvas box and not a clipped fragment of it, since
    // the mapping below divides by this box's extent.
    //
    // The property asserted is the one that holds in every mode: the capture is exactly
    // the requested rect at one integral scale shared by both axes. It is deliberately
    // NOT `image.width === box.width * devicePixelRatio`. CDP's `Page.captureScreenshot`
    // bypasses Playwright's device emulation and captures at Chrome's own surface
    // scale — measured in `cdp-helpers.spec.ts`, a 240x160 CSS clip decodes to 480x320
    // while `window.devicePixelRatio` reports 1, and sweeping `deviceScaleFactor` over
    // 1, 2 and 3 produced the same 480. So the DPR form failed in one mode and passed
    // in the other for byte-identical code, which is what `getDevicePixelRatio` was
    // deleted for.
    const captureScaleX = image.width / box.width;
    expect(
      Math.abs(image.height / box.height - captureScaleX),
      'the capture is not the canvas box at one scale on both axes'
    ).toBeLessThanOrEqual(0.01);
    expect(Number.isInteger(captureScaleX), 'the capture scale is not integral').toBe(true);
    expect(captureScaleX, 'the capture is smaller than the CSS rect it claims to cover').toBeGreaterThanOrEqual(1);
    // A capture no larger than the box cannot be the box, so this is also what rules
    // out a fragment: a 120x80 clip of a 240x160 canvas shares its scale with the
    // whole-canvas capture, and only the extent tells them apart.
    expect(image.width, 'the capture is not the full width of the canvas box').toBeGreaterThan(box.width * 0.9);
    expect(image.height, 'the capture is not the full height of the canvas box').toBeGreaterThan(box.height * 0.9);

    // Presence of ink, not its shape: glyph rasterisation is antialiased and
    // font-dependent, so the assertion is that the ink is confined to the rectangle the
    // user dragged, not how much of it there is or which letters it spells.
    //
    // `imageBoundsToCss` divides by the box extent rather than by devicePixelRatio, which
    // is what keeps this correct at any capture resolution - but only if the box it is
    // given is the box that was captured.
    const inkCss = imageBoundsToCss({ width: image.width, height: image.height }, box, ink);

    // Tripwire against the mistake this test just stopped making. A capture no larger than
    // the rectangle it is checked against cannot fail, because the pixels outside it are
    // never in the image. If this ever goes off, widen the capture - do not narrow the
    // margin.
    const rect = draftRectCss(box, INK_MARGIN);
    expect(box.width * box.height, 'the capture must cover strictly more than the asserted rectangle').toBeGreaterThan(
      (rect.right - rect.left) * (rect.bottom - rect.top)
    );

    expect.soft(inkCss.left, 'ink escaped the left of the dragged rectangle').toBeGreaterThanOrEqual(rect.left);
    expect.soft(inkCss.top, 'ink escaped the top of the dragged rectangle').toBeGreaterThanOrEqual(rect.top);
    expect.soft(inkCss.right, 'ink escaped the right of the dragged rectangle').toBeLessThanOrEqual(rect.right);
    expect.soft(inkCss.bottom, 'ink escaped the bottom of the dragged rectangle').toBeLessThanOrEqual(rect.bottom);
  });

  test('Clear discards the draft without committing a layer', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const input = page.locator('#text-input');
    const apply = page.getByRole('button', { name: 'Apply' });
    const clear = page.getByRole('button', { name: 'Clear' });
    const box = await canvasBox(page);

    await dragDraftRect(page, box);
    await input.fill('Discarded');
    await expect(apply).toBeEnabled();
    await expect(clear).toBeEnabled();

    await clear.click();

    await expect(input).toHaveValue('');
    await expect(apply).toBeDisabled();
    await expect(clear).toBeDisabled();
    await expect(layerRows).toHaveCount(1);

    // The unchanged row count above is only worth something if the panel does still
    // respond, so the same draft is rebuilt and really applied: the count goes to 2,
    // because Clear created nothing.
    await dragDraftRect(page, box);
    await input.fill('Kept');
    await expect(apply).toBeEnabled();
    await apply.click();

    await expect(layerRows).toHaveCount(2);
  });
});
