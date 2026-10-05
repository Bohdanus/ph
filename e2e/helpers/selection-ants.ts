import type { Page } from '@playwright/test';
import { CANVAS_REDRAW_POLL_INTERVAL_MS, CANVAS_REDRAW_TIMEOUT_MS } from './canvas-helpers';
import type { CssBounds, CssBox } from './screenshot-scale';

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
 * `drawSelectionAnchors` and `findSelectionAnchorAtPoint` both skip `sourceTool`
 * 'freehand-lasso' and 'magic-wand' (`src/util/selection.ts`), so a freehand selection is only
 * ever observable here.
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

/** An inclusive `[from, to]` run of painted ant pixels in DOCUMENT pixels along one scan line. */
export type AntRun = readonly [number, number];

/**
 * A scan window, in DOCUMENT pixels.
 *
 * `CssBox` is the canonical declaration of this shape (`screenshot-scale.ts` — `CssBox`,
 * enforced unique by `screenshot-scale.unit.test.ts`), so it is that type and not a local copy —
 * but read the space note there: `CssBox` names CSS page pixels, and here the same four numbers
 * are DOCUMENT pixels, because the window indexes the ants canvas's backing store and that store
 * is sized to the document. Same shape, different space, stated at the call site — the same
 * asymmetry `cdp-helpers.ts` documents for `ClipOptions`, and the reason a local alias here would
 * have been a second declaration the uniqueness guard exists to forbid.
 */
export type AntWindow = CssBox;

/**
 * The painted ant runs along each scan line of a window, in DOCUMENT pixels.
 *
 * `axis: 'row'` walks the window's rows and reports each row's runs along x; `'column'` walks its
 * columns and reports each column's runs along y. A row band is a single row with one long run and
 * everything around it empty; a column band is a single column of the same. So one primitive
 * answers both the thickness question (how many scan lines carry anything) and the span question
 * (how far the runs reach), and a spec states its own arithmetic over the runs rather than
 * hiding a shape-specific formula in here.
 *
 * RUNS rather than a bitmap: a full-canvas bitmap of an 800x600 document would cross the CDP
 * boundary as 480000 booleans, and this returns a handful of numbers for the same answer. An
 * empty line is `[]`, which is how a scan line outside the border says so.
 */
export const readAntRuns = async (page: Page, window: AntWindow, axis: 'row' | 'column'): Promise<AntRun[][]> =>
  // `page.evaluate` rather than the locator's: the element is looked up inside anyway, and this
  // overload takes its argument type from the value it is handed without a third generic to
  // fight.
  page.evaluate<AntRun[][], { window: CssBox; axis: 'row' | 'column' }>(
    (input) => {
      const w = input.window;
      const scanAxis = input.axis;
      const element = document.querySelector<HTMLCanvasElement>('[data-testid="selection-ants-canvas"]');
      if (!element) throw new Error('readAntRuns: no [data-testid="selection-ants-canvas"] on the page');
      const ctx = element.getContext('2d');
      if (!ctx) throw new Error('the selection ants canvas has no 2d context');

      // Clamped to the backing store rather than trusted: a window that runs off the canvas would
      // otherwise read `getImageData`'s IndexSizeError, which names neither the window nor the
      // canvas and reads like a product bug.
      const x0 = Math.max(0, Math.floor(w.x));
      const y0 = Math.max(0, Math.floor(w.y));
      const x1 = Math.min(element.width, Math.ceil(w.x + w.width));
      const y1 = Math.min(element.height, Math.ceil(w.y + w.height));
      const readWidth = x1 - x0;
      const readHeight = y1 - y0;
      const { data } = ctx.getImageData(x0, y0, readWidth, readHeight);

      const isAnt = (index: number) =>
        data[index + 3] !== 0 &&
        ((data[index] < 64 && data[index + 1] < 64 && data[index + 2] < 64) ||
          (data[index] > 192 && data[index + 1] > 192 && data[index + 2] > 192));

      const lineCount = scanAxis === 'row' ? readHeight : readWidth;
      // `'row'` scans x along each y of the window; `'column'` scans y along each x.
      const runLength = scanAxis === 'row' ? readWidth : readHeight;
      const origin = scanAxis === 'row' ? x0 : y0;
      const runs: [number, number][][] = [];

      for (let line = 0; line < lineCount; line += 1) {
        const lineRuns: [number, number][] = [];
        let runStart = -1;

        for (let at = 0; at < runLength; at += 1) {
          const index = scanAxis === 'row' ? (line * readWidth + at) * 4 : (at * readWidth + line) * 4;
          if (isAnt(index)) {
            if (runStart === -1) runStart = at;
          } else if (runStart !== -1) {
            lineRuns.push([runStart, at - 1]);
            runStart = -1;
          }
        }
        if (runStart !== -1) lineRuns.push([runStart, runLength - 1]);

        // Document pixels, not offsets into the read: a caller comparing a run against
        // `singleRowMarqueeRect`'s output is working in the document's space.
        runs.push(lineRuns.map(([a, b]) => [origin + a, origin + b]));
      }

      return runs;
    },
    { window, axis }
  );
