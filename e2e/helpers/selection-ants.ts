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
 * `drawSelectionOutline` skips `sourceTool` 'freehand-lasso' and 'magic-wand'
 * (`src/util/selection.ts:198`), so a freehand selection is only ever observable here.
 *
 * The read is `getImageData` on the canvas's own context rather than a screenshot, for the same
 * reason `e2e/selection-marching-ants.spec.ts` does it that way: this reads the ants without a
 * page-coordinate clip and without compositing the document underneath. The backing store can be
 * scaled by the device-pixel ratio, so the bounds below map those backing pixels back to CSS page
 * space using the canvas element's own dimensions.
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

/**
 * Wait until the ants canvas holds NO border (selection is cleared).
 */
export const waitForNoCommittedAnts = async (page: Page, description: string): Promise<void> => {
  const deadline = Date.now() + CANVAS_REDRAW_TIMEOUT_MS;
  let last: unknown = null;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      last = await committedAntsOutline(page);
      lastError = null;
      if (last === null) return;
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

/** An inclusive `[from, to]` run of painted ant pixels in DOCUMENT pixels along one scan line. */
export type AntRun = readonly [number, number];

/**
 * A scan window, in DOCUMENT pixels.
 *
 * `CssBox` is the canonical declaration of this shape (`screenshot-scale.ts` — `CssBox`,
 * enforced unique by `screenshot-scale.unit.test.ts`), so it is that type and not a local copy —
 * but read the space note there: `CssBox` names CSS page pixels, and here the same four numbers
 * are DOCUMENT pixels. `readAntRuns` uses the workspace's published document extent and maps them
 * through the canvas's `data-hidpi-ratio` before reading its backing store, then returns
 * document-pixel coordinates. Same shape, different space, stated at the call site — the same
 * asymmetry `cdp-helpers.ts` documents for `ClipOptions`, and the reason a local alias here would
 * have been a second declaration the uniqueness guard exists to forbid.
 */
export type AntWindow = CssBox;

/**
 * The painted ant runs along each scan line of a window, in DOCUMENT pixels. A HiDPI backing
 * pixel is folded into each document pixel it overlaps, so callers get the same coordinate space
 * at every device-pixel ratio.
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

      const scale = Number(element.getAttribute('data-hidpi-ratio') ?? 1);
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(
          `readAntRuns: invalid data-hidpi-ratio ${JSON.stringify(element.getAttribute('data-hidpi-ratio'))}`
        );
      }

      // Use the ratio's shortest decimal form as a rational. Float division can put an exact
      // backing-pixel boundary just past a document boundary (21 / 1.4 is 15.000000000000002),
      // which would incorrectly mark the next document row or column as painted.
      const ratioParts = scale.toString().toLowerCase().split('e');
      const coefficient = ratioParts[0] ?? '1';
      const exponent = Number(ratioParts[1] ?? '0');
      const coefficientParts = coefficient.split('.');
      const fractionalDigits = coefficientParts[1] ?? '';
      let ratioNumerator = BigInt(`${coefficientParts[0] ?? '1'}${fractionalDigits}`);
      let ratioDenominator = 10n ** BigInt(fractionalDigits.length);
      if (exponent > 0) ratioNumerator *= 10n ** BigInt(exponent);
      if (exponent < 0) ratioDenominator *= 10n ** BigInt(-exponent);
      let divisorLeft = ratioNumerator;
      let divisorRight = ratioDenominator;
      while (divisorRight !== 0n) {
        const remainder = divisorLeft % divisorRight;
        divisorLeft = divisorRight;
        divisorRight = remainder;
      }
      ratioNumerator /= divisorLeft;
      ratioDenominator /= divisorLeft;

      const floorDocumentBoundary = (backing: number) => Number((BigInt(backing) * ratioDenominator) / ratioNumerator);
      const ceilDocumentBoundary = (backing: number) => {
        const scaledBacking = BigInt(backing) * ratioDenominator;
        return Number((scaledBacking + ratioNumerator - 1n) / ratioNumerator);
      };
      const floorBackingBoundary = (document: number) => Number((BigInt(document) * ratioNumerator) / ratioDenominator);
      const ceilBackingBoundary = (document: number) => {
        const scaledDocument = BigInt(document) * ratioNumerator;
        return Number((scaledDocument + ratioDenominator - 1n) / ratioDenominator);
      };

      // The backing dimensions are rounded after scaling, so they cannot always identify the
      // original document extent (for example 3 pixels at 0.5x becomes 2 backing pixels). Read
      // the exact logical size published by the same workspace fit used by the pointer tools.
      const workspace = document.querySelector<HTMLElement>('[data-testid="workspace-container"]');
      if (!workspace) throw new Error('readAntRuns: no [data-testid="workspace-container"] on the page');
      const documentWidthAttribute = workspace.getAttribute('data-fit-document-width');
      const documentHeightAttribute = workspace.getAttribute('data-fit-document-height');
      const documentWidth = Number(documentWidthAttribute);
      const documentHeight = Number(documentHeightAttribute);
      if (
        documentWidthAttribute === null ||
        documentHeightAttribute === null ||
        !Number.isFinite(documentWidth) ||
        !Number.isFinite(documentHeight) ||
        documentWidth < 0 ||
        documentHeight < 0
      ) {
        throw new Error('readAntRuns: workspace has invalid document dimensions');
      }
      const x0 = Math.min(Math.max(Math.floor(w.x), 0), documentWidth);
      const y0 = Math.min(Math.max(Math.floor(w.y), 0), documentHeight);
      const x1 = Math.min(Math.max(Math.ceil(w.x + w.width), x0), documentWidth);
      const y1 = Math.min(Math.max(Math.ceil(w.y + w.height), y0), documentHeight);
      const backingX0 = Math.min(element.width, floorBackingBoundary(x0));
      const backingY0 = Math.min(element.height, floorBackingBoundary(y0));
      const backingX1 = Math.max(backingX0, Math.min(element.width, ceilBackingBoundary(x1)));
      const backingY1 = Math.max(backingY0, Math.min(element.height, ceilBackingBoundary(y1)));
      const readWidth = backingX1 - backingX0;
      const readHeight = backingY1 - backingY0;
      if (readWidth <= 0 || readHeight <= 0) return [];
      const { data } = ctx.getImageData(backingX0, backingY0, readWidth, readHeight);

      const isAnt = (index: number) =>
        data[index + 3] !== 0 &&
        ((data[index] < 64 && data[index + 1] < 64 && data[index + 2] < 64) ||
          (data[index] > 192 && data[index + 1] > 192 && data[index + 2] > 192));

      const documentXStarts = new Uint32Array(readWidth);
      const documentXEnds = new Uint32Array(readWidth);
      for (let offset = 0; offset < readWidth; offset += 1) {
        const backingX = backingX0 + offset;
        documentXStarts[offset] = Math.max(x0, floorDocumentBoundary(backingX));
        documentXEnds[offset] = Math.min(x1, ceilDocumentBoundary(backingX + 1));
      }
      const documentYStarts = new Uint32Array(readHeight);
      const documentYEnds = new Uint32Array(readHeight);
      for (let offset = 0; offset < readHeight; offset += 1) {
        const backingY = backingY0 + offset;
        documentYStarts[offset] = Math.max(y0, floorDocumentBoundary(backingY));
        documentYEnds[offset] = Math.min(y1, ceilDocumentBoundary(backingY + 1));
      }

      const lineCount = scanAxis === 'row' ? y1 - y0 : x1 - x0;
      // `'row'` scans x along each document y; `'column'` scans y along each document x.
      const runLength = scanAxis === 'row' ? x1 - x0 : y1 - y0;
      const origin = scanAxis === 'row' ? x0 : y0;
      const paintedLines = Array.from({ length: lineCount }, () => new Uint8Array(runLength));

      // A backing pixel represents the document-space rectangle its pixel covers. Mark every
      // document pixel overlapped by ant paint, then form runs in that logical grid. This also
      // handles fractional ratios where a backing pixel can straddle a document-pixel boundary.
      for (let backingY = backingY0; backingY < backingY1; backingY += 1) {
        const documentY0 = documentYStarts[backingY - backingY0]!;
        const documentY1 = documentYEnds[backingY - backingY0]!;
        for (let backingX = backingX0; backingX < backingX1; backingX += 1) {
          const index = ((backingY - backingY0) * readWidth + backingX - backingX0) * 4;
          if (!isAnt(index)) continue;
          const documentX0 = documentXStarts[backingX - backingX0]!;
          const documentX1 = documentXEnds[backingX - backingX0]!;
          for (let documentY = documentY0; documentY < documentY1; documentY += 1) {
            for (let documentX = documentX0; documentX < documentX1; documentX += 1) {
              const line = scanAxis === 'row' ? documentY - y0 : documentX - x0;
              const at = scanAxis === 'row' ? documentX - x0 : documentY - y0;
              paintedLines[line]![at] = 1;
            }
          }
        }
      }

      const runs: [number, number][][] = paintedLines.map((painted) => {
        const lineRuns: [number, number][] = [];
        let runStart = -1;
        for (let at = 0; at < runLength; at += 1) {
          if (painted[at] === 1) {
            if (runStart === -1) runStart = at;
          } else if (runStart !== -1) {
            lineRuns.push([origin + runStart, origin + at - 1]);
            runStart = -1;
          }
        }
        if (runStart !== -1) lineRuns.push([origin + runStart, origin + runLength - 1]);
        return lineRuns;
      });

      return runs;
    },
    { window, axis }
  );
