import { expect, type Locator, type Page, test } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

/**
 * Where a pasted layer LANDS, measured off the rendered pixels rather than off the `pos` the
 * layer was created with.
 *
 * WHY THIS FILE EXISTS. `pasteSelectionClipboard` (`src/contexts/useSelectionClipboard.ts`) is the
 * only producer of a layer position that is not copied from somewhere else: it computes a centre.
 * Its unit coverage asserts the arithmetic's own output (`expect(createLayerFromBitmap).toHaveBeen
 * CalledWith({ pos: … })`), which restates the formula — such an assertion passes under either
 * candidate rule, so it could not tell a correct implementation from its own negation. Nothing in
 * `e2e/` reached `pasteSelectionClipboard` at all, so the value the user actually sees had no
 * oracle outside the file that computes it.
 *
 * That gap had a cost. Two commits on 2026-10-04 made OPPOSITE edits to the same two lines —
 * `259f6619` removed `documentFrame.x`/`.y` from `centerPos`, `be71c5c2` restored them — and the
 * argument that settled it was conducted entirely in prose. Each side could restate the other's
 * formula, and the unit tests, pinned to whichever formula shipped, agreed with both.
 *
 * WHAT MAKES THE ASSERTION INDEPENDENT. This spec never computes a candidate position. It copies a
 * solid block, pastes it, finds the block's pixels on the visible canvas, and asserts the block's
 * CENTRE coincides with the visible canvas's centre. That is the geometric statement; the two
 * implementations differ in it by exactly the frame origin, so the test decides between them with
 * neither one's arithmetic appearing anywhere in it.
 *
 * Adobe's rule, which is what the centre assertion encodes: a paste lands in the middle of the
 * VIEWPORT, not the middle of the document. An Adobe expert states it on the Adobe community forum
 * — "If your image is zoomed in on the canvas to any degree, PS will try and center the pasted
 * image in your window, and not the actual image, unless you use shift-ctrl-V" — and the
 * pre-artboard behaviour is the same sentence: pasted "in the middle of the viewed working space".
 * In this app the two rules coincide whenever the frame origin is zero, because the visible canvas
 * IS the document then. They part company as soon as a crop re-anchors the frame, which is why the
 * crop below is load-bearing rather than decoration: it is the only way to reach a state where the
 * two rules disagree at all.
 *
 * THE MUTATION CHECK, and the reason this file is trusted. `259f6619`'s variant of
 * `centerPos` — the frame term dropped — was applied to the source and this spec re-run:
 *
 *   main (`be71c5c2`)  block 40x100 at canvas (280, 200)  -> centre (299.5, 249.5)  off by 0.5  PASS
 *   `259f6619`         block 40x100 at canvas (180, 150)  -> centre (199.5, 199.5)  off by 100.5  FAIL
 *
 * Two things are proved by that pair and neither is visible from a green run alone. The 0.5 is the
 * inclusive-bounds half pixel predicted below, so the shipped rule centres the block. And the
 * mutation fails at the CENTRE ASSERTION with the misplaced block measured and quoted, rather than
 * at a "no ink found" poll — the scan window contains both placements by design, so the test
 * discriminates on where the paste landed instead of on whether it landed at all.
 *
 * WHY THE PIXELS ARE READ WITH `getImageData` AND NOT SCREENSHOTTED. `e2e/selection-marching-ants.spec.ts`
 * records the reason: the workspace canvas's backing store is already in document pixels, so a
 * screenshot "would need a clip in page coordinates, a device-pixel-ratio correction and a decode,
 * none of which belong on a canvas whose backing store is already in document pixels". Screenshoting
 * would also drag in four more moving parts that have each silently corrupted a measurement in this
 * repository before — the contain fit, the letterbox, the window scroll (`screenshot-scale.ts`
 * documents a capture landing 440px from the region the caller measured), and the
 * `captureBeyondViewport` drift in `e2e/OPEN_PROBLEMS.md`. Reading the canvas directly leaves the
 * assertion in the one space where the two candidate rules differ by a whole frame origin, with
 * nothing between the measurement and the pixels.
 *
 * THE MEASUREMENT IS OF THE COMPOSITE, so it cannot be fooled by the layer's own bookkeeping. The
 * workspace canvas holds the flattened document, so what is measured is where the paste ended up
 * ON SCREEN. The marching ants of the still-active selection cannot appear in it: they are drawn on
 * their own element, `selection-ants-canvas`.
 */

/** Desktop band, so the shell mounts the desktop layout and the workspace canvas is the editor's. */
test.use({ viewport: { width: 1280, height: 900 } });

/** The crop rectangle, in canvas pixels on the opening document. */
const CROP_FROM = { x: 100, y: 50 };
const CROP_TO = { x: 700, y: 550 };

/**
 * The frame that crop commits: the origin is `CROP_FROM` and the extent is the difference.
 *
 * Both are exact rather than rounded — `applyDocumentCrop` normalises the gesture with
 * `sortRoundRect`, which rounds each edge once, and `documentFrameSize` ceils the extent — so the
 * numbers below are whole and the arithmetic on them is not carrying error. The ORIGIN is the part
 * this file exists for: it is non-zero, and that is the only reason the two candidate rules
 * disagree. It is asserted to be reachable rather than assumed, by the mutation check this file's
 * comment below requires: running this spec against `259f6619` must FAIL, and the only thing that
 * implementation changes is the frame term.
 */
const CROP_WIDTH = CROP_TO.x - CROP_FROM.x;
const CROP_HEIGHT = CROP_TO.y - CROP_FROM.y;

/**
 * The slab of ink the marquee copies out of, and the brush that lays it.
 *
 * 120 wide, which is a slab rather than a line, and it has to be: the marquee copies a RECTANGLE
 * out of it, and the pasted block must be solid for a bounding box to mean anything. A thin line
 * would leave the copy mostly paper and the block's edges would be antialiasing rather than ink.
 *
 * It is also kept NARROW on purpose — the drag runs at `SLAB_X` 60, so at a radius of 60 the ink
 * stops at canvas x 120 and the scan region can start to the right of it. A wider slab would reach
 * into the window and the bounds would span the slab and the paste together, making the measured
 * centre a property of where this file drew its ink. See `SCAN_FROM_X` for what the window has to
 * contain.
 */
const BRUSH_SIZE = 120;
const SLAB_X = 60;
const SLAB_TOP = 150;
const SLAB_BOTTOM = 350;

/**
 * The marquee, as a press and a release.
 *
 * The press is the CENTRE of the rectangle this file would get under `fromCentre` and the release one
 * of its corners, so the pair reads either way: `fromCentre` gives `MARQUEE_CENTRE ± (20, 50)`,
 * press-to-corner gives the 40x100 sub-rectangle of that. It MEASURED as press-to-corner — the
 * pasted block came back 40x100 — so `RectangularSelectionToolArea` is not applying the
 * `fromCentre` it is passed here. That is why nothing below asserts a copied SIZE: the placement
 * assertion is a centre, and a centre holds under either reading. The region is well inside the
 * slab either way, which is what the slab's size is for.
 */
const MARQUEE_CENTRE = { x: 60, y: 250 };
const MARQUEE_CORNER = { x: 100, y: 350 };

/**
 * Where the scan starts, in canvas pixels on the cropped document.
 *
 * It has to clear the slab, which reaches canvas x 120, and it has to contain BOTH placements the
 * two candidate rules produce — and that second half is what makes this a real oracle rather than a
 * change detector. A 40x100 block centred in the viewport lands at canvas x 280; the same block
 * with the frame term dropped lands at canvas x 180. A window starting past 320 would find the
 * first and not the second, and the test would then fail on the block being MISSING rather than on
 * its being off-centre — which detects the regression, but reports it as an absence and proves
 * nothing about the centre. Starting at 140 puts both inside, so the block is measured either way
 * and the CENTRE is what fails. The margin over the slab is 20 canvas px, comfortably past the
 * antialiased few pixels of the stroke's edge that still read as ink.
 */
const SCAN_FROM_X = 140;
const SCAN_FROM_Y = 0;

/** The opening document, from `DEFAULT_BLANK_IMAGE` in `src/App.tsx`. Asserted, not assumed. */
const OPENING_DOCUMENT = { width: 800, height: 600 };

/**
 * Ink, as a ceiling on the RGB SUM rather than per channel.
 *
 * `App.tsx`'s `DEFAULT_BLANK_IMAGE` opens the document opaque white, so paper sums to 765. The
 * draw pen is `alpha: 0.9`, so the slab is 90% black over that paper at about 26 per channel and
 * sums to about 78. A ceiling of 240 is therefore more than wide enough to catch every ink pixel
 * and nowhere near the paper — a per-channel threshold would have had to encode the same two facts
 * three times over.
 */
const INK_SUM_CEILING = 240;

/**
 * How far the measured centre may sit from the canvas centre, in CANVAS pixels.
 *
 * A half pixel, and it is not slack: it is exactly the disagreement the measurement owes to
 * `right`/`bottom` being inclusive indices. A block whose left edge is at `P` and which is `W`
 * pixels wide measures back as spanning `P` through `P + W - 1`, so its measured centre is
 * `P + (W - 1) / 2` while the true centre of the canvas is `width / 2`. Wherever `P` can be
 * `(width - W) / 2` — that is, wherever the centred placement is a whole number of pixels — those
 * differ by exactly half a pixel, for every such `W`. Half a pixel is therefore the floor for any
 * placement the app can actually produce, and zero would fail on a correct paste. Where `width` and
 * `W` differ in parity the centred `P` is not an integer, no placement sits at it, and the error
 * is smaller — so this is the worst case, not a universal one.
 *
 * This block's own first draft said one, from the first commit that added this file, while the two
 * assertions below have always enforced `0.5` and no constant was ever declared — so the comment
 * and the code contradicted each other from birth, and "a hundred times the tolerance" only worked
 * for the value the code was not using. `0.5` is what the arithmetic above gives, so that is what
 * is declared here and what both assertions read.
 */
const CENTRE_TOLERANCE_CANVAS_PX = 0.5;

/** The contain fit the app publishes for the CURRENT document, from `usePointerPosition`. */
interface Fit {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly rectX: number;
  readonly rectY: number;
}

interface PagePoint {
  readonly x: number;
  readonly y: number;
}

interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface InkBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly found: boolean;
  /** How many ink pixels the scan found, which is what proves the block is solid rather than hollow. */
  readonly count: number;
}

/**
 * The app's own contain fit, READ rather than re-derived.
 *
 * `documentToCanvasOffset`'s JSDoc in `canvas-helpers.ts` is the argument for this: a helper that
 * recomputed the fit would drift from `getLocalCoords` silently, and every gesture below would
 * become a plausible gesture somewhere else. `data-fit-rect-x`/`-y` come from
 * `getBoundingClientRect()`, so they are VIEWPORT-relative — the same space `page.mouse.move` takes
 * — and that is why the fit is re-read immediately before each gesture instead of once up front:
 * `preservingScroll` in `toolbar-helpers.ts` scrolls before an interaction, and a fit read before a
 * scroll names a point the pointer no longer visits.
 */
async function readFit(page: Page): Promise<Fit> {
  const container = page.getByTestId('workspace-container');
  await expect(container, 'the tool area publishes the contain fit').toHaveAttribute('data-fit-scale', /.+/);
  return await container.evaluate((node) => {
    const read = (name: string) => {
      const raw = node.getAttribute(name);
      if (raw === null) throw new Error(`the app published no ${name}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} is not a number: ${raw}`);
      return value;
    };
    return {
      scale: read('data-fit-scale'),
      offsetX: read('data-fit-offset-x'),
      offsetY: read('data-fit-offset-y'),
      documentWidth: read('data-fit-document-width'),
      documentHeight: read('data-fit-document-height'),
      rectX: read('data-fit-rect-x'),
      rectY: read('data-fit-rect-y'),
    };
  });
}

/** A CANVAS-space point as a viewport point: `offset + canvas * scale`, plus the element's origin. */
function canvasPoint(fit: Fit, canvasX: number, canvasY: number): PagePoint {
  return {
    x: fit.rectX + fit.offsetX + canvasX * fit.scale,
    y: fit.rectY + fit.offsetY + canvasY * fit.scale,
  };
}

async function openDocument(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page), 'the app mounted a document canvas').toBeVisible();
}

/** The canvas element's backing store, which is the frame's extent — the visible canvas, in its own pixels. */
async function backingStore(locator: Locator): Promise<{ width: number; height: number }> {
  return await locator.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
}

/** Presses, drags and releases across the canvas between two canvas-space points. */
async function dragOnCanvas(page: Page, fit: Fit, from: PagePoint, to: PagePoint): Promise<void> {
  const start = canvasPoint(fit, from.x, from.y);
  const end = canvasPoint(fit, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
}

/**
 * Commits the crop, and asserts the frame it produced.
 *
 * The size assertions are the file's anti-vacuity guard on its own arithmetic: every conversion
 * below divides by the fit's scale and every expected centre is half the backing store, so a crop
 * that did not commit the extent this file predicts would make the whole file agree with itself
 * about the wrong canvas. The ORIGIN cannot be read from the page — `usePointerPosition` publishes
 * the fit but not the frame — so its non-zero-ness is established by the mutation check instead,
 * which this file's header requires and which is the only thing that can distinguish "centred in
 * the viewport" from "centred in the document" when both are expressed as "centred in the canvas".
 */
async function commitCrop(page: Page): Promise<Fit> {
  await clickToolButton(page, 'crop');
  await expect(page.locator('.cursor-crop'), 'the crop gesture surface is mounted').toBeVisible();
  const fit = await readFit(page);

  await dragOnCanvas(page, fit, CROP_FROM, CROP_TO);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();

  const after = await readFit(page);
  const backing = await backingStore(getWorkspaceCanvas(page));
  const context =
    `the crop was dragged over canvas (${CROP_FROM.x}, ${CROP_FROM.y})-(${CROP_TO.x}, ${CROP_TO.y}), which ` +
    `commits frame {x: ${CROP_FROM.x}, y: ${CROP_FROM.y}, width: ${CROP_WIDTH}, height: ${CROP_HEIGHT}} — a ` +
    `NON-ZERO origin, which is the only reason the two candidate rules differ at all. The canvas backing ` +
    `store is ${backing.width}x${backing.height} and the app re-fitted a ${after.documentWidth}x` +
    `${after.documentHeight} document.`;

  expect(backing.width, `the visible canvas is the frame's extent. ${context}`).toBe(CROP_WIDTH);
  expect(backing.height, `the visible canvas is the frame's extent. ${context}`).toBe(CROP_HEIGHT);
  expect(after.documentWidth, `the app re-fitted the cropped document. ${context}`).toBe(CROP_WIDTH);
  expect(after.documentHeight).toBe(CROP_HEIGHT);
  return after;
}

/**
 * Lays the slab of ink down.
 *
 * The size slider is filled rather than nudged because `defaultSettings.draw`'s pen is 10 wide, and
 * 10 pixels of stroke leaves the copied rectangle mostly paper — the pasted block's bounds would
 * then be antialiasing rather than a measured edge.
 */
async function drawSlab(page: Page): Promise<void> {
  await clickToolButton(page, 'draw');
  await page.locator('#size-slider').fill(String(BRUSH_SIZE));
  await setForegroundColor(page, '#000000', true);

  const fit = await readFit(page);
  await dragOnCanvas(page, fit, { x: SLAB_X, y: SLAB_TOP }, { x: SLAB_X, y: SLAB_BOTTOM });
}

/** Selects the slab region and copies it. `Mod+C` is registered in `AppKeyboardShortcuts` under `hasImage`. */
async function copySlabRegion(page: Page): Promise<void> {
  await clickToolButton(page, 'rectangular-selection');
  const fit = await readFit(page);
  await dragOnCanvas(page, fit, MARQUEE_CENTRE, MARQUEE_CORNER);
  await page.keyboard.press('Meta+C');
}

/** `Mod+V`, the same registration and the same `hasImage` gate. `useKeyDownShortcut` accepts either Meta or Ctrl for `mod`. */
async function pasteClipboard(page: Page): Promise<void> {
  await page.keyboard.press('Meta+V');
}

/**
 * The bounding box of ink inside a region of the visible canvas, in CANVAS pixels.
 *
 * `getImageData` reads the backing store directly, so this is the composite as the renderer left
 * it — no clip, no device-pixel ratio, no letterbox. The returned edges are ABSOLUTE canvas
 * coordinates, so a caller never has to know the region was a sub-rectangle.
 *
 * Chromium logs a "multiple readback operations using getImageData" WARNING on a canvas whose
 * context was created without `willReadFrequently`. That is a warning, and `consolePolice` fails on
 * console ERRORS only — `assertClean` collects warnings into the report and does not assert on them
 * — so the app's own context can be read here without an `ACCEPTED_CONSOLE_ERRORS` entry. The flag
 * cannot be supplied anyway: `getContext('2d')` returns the context the app already created.
 */
async function inkBounds(locator: Locator, region: Region): Promise<InkBounds> {
  return await locator.evaluate((node, area: Region) => {
    const canvas = node as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('the workspace canvas has no 2d context');

    const { data } = ctx.getImageData(area.x, area.y, area.width, area.height);
    let left = area.width;
    let top = area.height;
    let right = -1;
    let bottom = -1;
    let count = 0;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] >= 240) continue;
      count += 1;
      const pixel = index / 4;
      const x = pixel % area.width;
      const y = Math.floor(pixel / area.width);
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }

    return {
      left: area.x + left,
      top: area.y + top,
      right: area.x + right,
      bottom: area.y + bottom,
      found: count > 0,
      count,
    };
  }, region);
}

/** The paper colour at one canvas pixel, so the ink ceiling below is measured against something. */
async function pixelAt(
  locator: Locator,
  x: number,
  y: number
): Promise<{ r: number; g: number; b: number; a: number }> {
  return await locator.evaluate(
    (node, at: { x: number; y: number }) => {
      const canvas = node as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('the workspace canvas has no 2d context');
      const d = ctx.getImageData(at.x, at.y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    { x, y }
  );
}

test.describe('Paste placement', () => {
  // The navigation is in the test body rather than a `beforeEach`, and that is deliberate rather
  // than incidental. `timeouts.unit.test.ts` guards "a NEW spec arriving in exactly the shape that
  // produced a 30s `beforeEach` timeout": a spec that navigates from a before hook must name a
  // per-test budget or be recorded in `UNBUDGETED_NAVIGATORS`, a list whose every entry is a
  // judgment about that file's observed flake history. With one test the hook is pure indirection,
  // so it is not worth either a shared registry edit or a per-test budget. A second test added here
  // should reintroduce the hook AND register the file, which is the flow the guard exists to force.
  test('a pasted layer is centred in the visible canvas of a cropped document', async ({ page }) => {
    await openDocument(page);

    const opening = await backingStore(getWorkspaceCanvas(page));
    expect(
      opening,
      `the app opens DEFAULT_BLANK_IMAGE from src/App.tsx at ${OPENING_DOCUMENT.width}x${OPENING_DOCUMENT.height}, so the gestures below are placed against that document`
    ).toEqual(OPENING_DOCUMENT);

    await commitCrop(page);
    await drawSlab(page);
    await copySlabRegion(page);
    await pasteClipboard(page);

    const canvas = getWorkspaceCanvas(page);
    const size = await backingStore(canvas);
    const scan: Region = {
      x: SCAN_FROM_X,
      y: SCAN_FROM_Y,
      width: size.width - SCAN_FROM_X,
      height: size.height,
    };

    // The paper this file's ink ceiling depends on, measured rather than assumed. If the document
    // were transparent the ceiling would match the empty canvas and the scan would report the whole
    // region as ink, which would make the bounds below describe the clip rather than the paste.
    const paper = await pixelAt(canvas, scan.x + 2, scan.y + 2);
    expect(
      paper.r + paper.g + paper.b,
      `the scan region starts on opaque white paper, because the ink ceiling of ${INK_SUM_CEILING} separates a slab (about 78) from paper (765) and nothing else`
    ).toBeGreaterThan(INK_SUM_CEILING);

    // `pasteSelectionClipboard` is async — it awaits `createLayerFromBitmap` — so the canvas is
    // read under a poll rather than once. A single read would race the commit and report no ink.
    await expect
      .poll(async () => (await inkBounds(canvas, scan)).found, {
        message: 'the pasted block was inked into the right of the visible canvas',
        timeout: 10_000,
      })
      .toBe(true);

    const bounds = await inkBounds(canvas, scan);
    const width = bounds.right - bounds.left + 1;
    const height = bounds.bottom - bounds.top + 1;
    const centre = { x: bounds.left + (width - 1) / 2, y: bounds.top + (height - 1) / 2 };
    const expected = { x: size.width / 2, y: size.height / 2 };
    const detail =
      `the pasted block measures ${width}x${height} canvas px with its top-left at (${bounds.left}, ` +
      `${bounds.top}), so its centre is (${centre.x}, ${centre.y}) on a ${size.width}x${size.height} visible ` +
      `canvas whose centre is (${expected.x}, ${expected.y}). The frame origin is ` +
      `(${CROP_FROM.x}, ${CROP_FROM.y}): centring in the viewport puts the block there, and centring in ` +
      `the document instead puts it a whole frame origin away.`;

    expect(
      Math.abs(centre.x - expected.x),
      `the pasted block is not horizontally centred in the visible canvas. ${detail}`
    ).toBeLessThanOrEqual(CENTRE_TOLERANCE_CANVAS_PX);
    expect(
      Math.abs(centre.y - expected.y),
      `the pasted block is not vertically centred in the visible canvas. ${detail}`
    ).toBeLessThanOrEqual(CENTRE_TOLERANCE_CANVAS_PX);

    // The block must be the SOLID rectangle the marquee copied, judged by how completely it fills
    // its own bounding box rather than by how big it is. A centre is a weak thing on its own: two
    // thin marks at symmetric offsets share a centre without being a paste, and a size floor would
    // not catch that. Density does, and it is independent of whether the marquee honoured the
    // `fromCentre` it was passed — which it does not on this path, so the copied rectangle is the
    // 40x100 press-to-corner one and any hard-coded expectation of 80x200 would fail for a reason
    // that has nothing to do with placement. The margin is a tenth because the block's outermost
    // row and column are composited against paper and are the only pixels that can round.
    const density = bounds.count / (width * height);
    expect(
      density,
      `the pasted block fills its own bounding box, so its bounds are a rectangle rather than two ` +
        `marks sharing a centre. It holds ${bounds.count} ink pixels in ${width}x${height}. ${detail}`
    ).toBeGreaterThan(0.9);
  });
});
