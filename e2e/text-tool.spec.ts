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
 * The suite default is 30s (`playwright.config.ts:32`). Every test here is a page load,
 * a tool click, a drag and at most one redraw poll, which measures at 1-2s on this
 * host, so 30s was never the binding constraint. 60s is what the two sibling specs that
 * drive the canvas already ask for (`layers.spec.ts:21`, `viewport-drawing.spec.ts:17`)
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
 * The committed glyphs sit inside the dragged rectangle, inset from it by
 * `TEXT_PADDING` (5 document px, `src/util/constants.ts:3`) plus the glyph's own side
 * bearing, and the document is displayed at a contain scale rather than 1:1. Twelve CSS
 * pixels of slack on every side is the honest tolerance for "inside the rectangle the
 * user dragged" - wide enough to absorb the scale and the bearing, and still far tighter
 * than the 400x120 rectangle, so it cannot pass on ink from anywhere else.
 */
const INK_MARGIN = 12;

/** The colour the Text toolbar paints with, read from the store's foreground. */
const FOREGROUND = '#ff0000';

/**
 * `createLayerSource` names a tool layer `${toolName} ${maxOrder}` after the tool that
 * produced it (`src/contexts/layer-utils.ts:141-148`, `:167`), and the blank document
 * layer the app starts with is order 1, so the first text layer over it is `text 2`.
 * Measured on a real run, not assumed.
 */
const FIRST_TEXT_LAYER_NAME = 'text 2';

/** The blank bedrock layer `App.tsx:16-21` creates on start, named at `layer-utils.ts:146`. */
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

  test('Apply needs text as well as a rectangle, so a drag alone leaves it disabled', async ({ page }) => {
    const input = page.locator('#text-input');
    const apply = page.getByRole('button', { name: 'Apply' });
    const box = await canvasBox(page);

    // Neither input: no rectangle dragged and no text typed.
    await expect(apply).toBeDisabled();

    // A rectangle on its own does not enable it. The selection outline is what makes
    // this half mean something: without it, `toBeDisabled()` would also pass when the
    // drag never registered and `!rect` was the reason, which is the other half of
    // `disabled={!text || !rect}` and not the one under test here.
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

    // Text is what lifts it.
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

    await expect(layerRows).toHaveText([FIRST_TEXT_LAYER_NAME, STARTING_LAYER_NAME]);
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
    // (`TextToolArea.tsx:46-61`), so red pixels on screen would not yet prove anything
    // reached the layer. With the draft gone, the only red in this region is committed
    // document content.
    await expect(input).toHaveValue('');
    await expect(apply).toBeDisabled();
    await expect(layerRows).toHaveText([FIRST_TEXT_LAYER_NAME, STARTING_LAYER_NAME]);

    const clip = toClip(draftRectCss(box, INK_MARGIN));
    await waitForCanvasPixels(page, clip, hasRedPixels, { description: 'red text pixels' });

    const capture = await captureCanvasScreenshot(page, box, testInfo, 'text-committed', clip);
    const image = await loadImageData(capture);
    const ink = await scanPixelsForBounds(image, isForegroundInk);
    expect(ink.found, 'no foreground-red pixels in the dragged rectangle after Apply').toBe(true);

    // Presence of ink, not its shape: glyph rasterisation is antialiased and
    // font-dependent, so the assertion is that the ink is confined to the rectangle the
    // user dragged, not how much of it there is or which letters it spells.
    //
    // The capture is of `clip`, not of the whole canvas, so `clip` is the box the image
    // pixels have to be projected onto - the canvas box would place them somewhere else
    // entirely. `imageBoundsToCss` divides by the box extent rather than by
    // devicePixelRatio, which is what keeps this correct at any capture resolution.
    const inkCss = imageBoundsToCss({ width: image.width, height: image.height }, clip, ink);
    const rect = draftRectCss(box, INK_MARGIN);
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
    await expect(layerRows).toHaveText([STARTING_LAYER_NAME]);

    // The unchanged row set above is only worth something if the panel does still
    // respond, so the same draft is rebuilt and really applied: one row is added, and it
    // is the first text layer again because Clear created nothing.
    await dragDraftRect(page, box);
    await input.fill('Kept');
    await expect(apply).toBeEnabled();
    await apply.click();

    await expect(layerRows).toHaveText([FIRST_TEXT_LAYER_NAME, STARTING_LAYER_NAME]);
  });
});
