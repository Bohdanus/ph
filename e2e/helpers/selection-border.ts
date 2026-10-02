import type { Page } from '@playwright/test';
import { CANVAS_REDRAW_POLL_INTERVAL_MS, CANVAS_REDRAW_TIMEOUT_MS } from './canvas-helpers';
import type { CssBox } from './screenshot-scale';

/**
 * Reading the selection border out of the live canvases.
 *
 * ## The border is on its own canvas, and always was
 *
 * `useSelectionMarchingAnts` (`src/hooks/useSelectionAnts.ts`) paints every committed selection's
 * border — black and white dashes, animated — onto `selectionAntsOverlayRef`, which is
 * `[data-testid="selection-ants-canvas"]`. It is a canvas of its own rather than the tool overlay
 * because the polygon tool areas full-clear the tool overlay before every repaint. Since the ants
 * became the border for EVERY selection tool, this canvas is now the only place a committed
 * selection's outline exists: `drawSelectionOutline` is gone, and the rectangular marquee's own
 * `useRect` stroke is gated behind `borderMode: 'while-dragging'`, so it paints only the marquee
 * being dragged and never a committed selection at rest.
 *
 * The consequence for a spec is that "where is the committed selection drawn" has ONE answer for
 * all nine selection tools, and any spec still reaching for `tool-overlay-canvas` blue is reading
 * a draft preview or nothing at all.
 *
 * ## Both reads come out of `getImageData`, never a screenshot
 *
 * `Main.tsx` sizes these canvases to the DOCUMENT, so one backing-store pixel is one document
 * pixel and every number is already in the space the selection geometry works in. A screenshot
 * would have to be re-scaled back through the contain fit to say the same thing, and would
 * composite whatever the document painted underneath. `getWorkspaceCanvas` and friends in
 * `canvas-helpers` document the rest.
 *
 * ## The colour test is deliberate, and narrow
 *
 * Both ant colours are opaque, so alpha alone would accept any future overlay painted on this
 * canvas. Requiring one of the two the loop actually paints — `ANT_STROKE_COLOR`/`ANT_GAP_COLOR`
 * in `src/hooks/useSelectionAnts.ts` — is what keeps this a test of the ants rather than of
 * whatever else might share the surface. It is duplicated inside the `evaluate` callbacks below
 * on purpose: a browser-side closure cannot see a module import.
 */

/** An inclusive `[from, to]` run of painted ant pixels in DOCUMENT pixels along one scan line. */
export type AntRun = readonly [number, number];

/**
 * A scan window, in DOCUMENT pixels.
 *
 * `CssBox` is the canonical declaration of this shape (`screenshot-scale.ts:62`, enforced
 * unique by `screenshot-scale.unit.test.ts`), so it is that type and not a local copy — but
 * read the space note there: `CssBox` names CSS page pixels, and here the same four numbers are
 * DOCUMENT pixels, because the window indexes the ants canvas's backing store and that store is
 * sized to the document. Same shape, different space, stated at the call site — the same
 * asymmetry `cdp-helpers.ts` documents for `ClipOptions`, and the reason a local alias here
 * would have been a second declaration the uniqueness guard exists to forbid.
 */
export type AntWindow = CssBox;

const ANTS_CANVAS = 'selection-ants-canvas';

const antsCanvas = (page: Page) => page.getByTestId(ANTS_CANVAS);

/**
 * The bounding box of the committed selection's border, in PAGE coordinates, or `null` when the
 * canvas holds no ants.
 *
 * Page coordinates because that is what a drag's endpoints and a clip rectangle are written in;
 * the mapping out of the backing store is `object-contain` letterboxing in BOTH axes, applied
 * here rather than in each caller so two specs cannot drift on it. The element's own bounding rect
 * is the input to that mapping, not `workspaceBox()`, because the element being measured is the
 * element being mapped.
 */
export const committedAntsOutline = async (
  page: Page
): Promise<{ left: number; top: number; right: number; bottom: number } | null> =>
  antsCanvas(page).evaluate((element) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error(`committedAntsOutline: no [data-testid="${element.getAttribute('data-testid')}"]`);
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
 * Resolves once the ants canvas holds a border, and throws with the last reading in the message.
 *
 * This polls `committedAntsOutline` directly rather than going through `waitForCanvasPixels`,
 * because that loop takes its reading from a screenshot and the point of this read is that a
 * screenshot is the wrong instrument here.
 *
 * The error is kept and reported at the end because a read that throws every tick and a read that
 * returns null forever are different failures, and the timeout message must say which.
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
