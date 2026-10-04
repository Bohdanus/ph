import type { Page } from '@playwright/test';
import { CANVAS_REDRAW_POLL_INTERVAL_MS, CANVAS_REDRAW_TIMEOUT_MS } from './canvas-helpers';
import type { CssBounds } from './screenshot-scale';

/**
 * Where a committed selection's border is on the page, read off the marching-ants canvas.
 *
 * The result is `CssBounds`, the shape `screenshot-scale.ts` owns: these four edges in CSS page
 * space are the same rectangle the rest of the suite describes, so a second local declaration here
 * would be the structural-typing drift `screenshot-scale.unit.test.ts` exists to catch.
 *
 * A committed polygon's border no longer lives on the tool overlay: it is the animated
 * black/white ants on their own canvas, which the polygon selection tools never clear. So the
 * blue detection in `canvas-helpers` cannot see it — it still sees the DRAFT, which
 * `drawPolygonOverlay` strokes in the same blue, and asserting on that after a commit would
 * prove the draft rather than the selection.
 *
 * This matters most for the FREEHAND lasso, which has no blue outline of its own at all:
 * `drawSelectionOutline` skips `sourceTool` 'freehand-lasso' and 'magic-wand'
 * (`src/util/selection.ts:198`), so a freehand selection is only ever observable here.
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
export const committedAntsOutline = async (page: Page): Promise<CssBounds | null> =>
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
    // (`e2e/helpers/canvas-helpers.ts:148`), written out here so the whole read stays one round trip.
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
export const waitForCommittedAnts = async (page: Page, description: string): Promise<void> => {
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
 * Whether the ants canvas holds NO border at all.
 *
 * The negative counterpart to `committedAntsOutline`, for the case where a selection must be
 * GONE — a cancelled draft, or a tool that stops the animation. Reading absence rather than
 * asserting an outline moved somewhere else is the difference between "the selection went away"
 * and "the selection is somewhere I did not look".
 */
export const hasNoCommittedAnts = async (page: Page): Promise<boolean> => (await committedAntsOutline(page)) === null;
