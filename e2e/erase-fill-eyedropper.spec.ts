import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  CANVAS_REDRAW_TIMEOUT_MS,
  type ClipOptions,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  hasDarkPixels,
  hasRedPixels,
  LINE_END_X as STANDARD_LINE_END_X,
  LINE_START_X,
  loadImageData,
  scanPixelsForBounds,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { hexToRgb, setForegroundColor } from './helpers/color-helpers';
import { cssPointToImage, imagePointToCss } from './helpers/screenshot-scale';
import { clickToolButton, expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
/**
 * CONTROL CONTRACT for every bar this spec drives. There are no `data-testid`s in these
 * options bars, by repo convention: each control is a `<label htmlFor>` wrapping its own input,
 * so the accessible name is the label text plus, for the value sliders, the live value suffix —
 * `"Size 40px"`, `"Opacity 100%"` — and the bare label text for a select or a checkbox.
 * Matching the LABEL PART ALONE (`{ name: /^Size/ }`) survives the value suffix changing and
 * needs no knowledge of the input ids; the ids are in the table for the reader, not for the
 * locators.
 *
 * | Bar                     | Control         | Element                       | id                              | Label text        | Accessible name | Range                              |
 * | ----------------------- | --------------- | ----------------------------- | ------------------------------- | ----------------- | --------------- | ---------------------------------- |
 * | Eraser                  | Mode            | `<select>`                    | `eraser-mode`                   | `Mode`            | `Mode`          | brush / pencil / block             |
 * | Eraser                  | Size            | `<input type=range>`          | `eraser-size`                   | `Size 40px`       | `Size 40px`     | 1..500, step 1                     |
 * | Eraser                  | Opacity         | `<input type=range>`          | `eraser-opacity`                | `Opacity 100%`    | `Opacity 100%`  | 0..100, step 1; absent in Block    |
 * | Eraser                  | Hardness        | `<input type=range>`          | `eraser-hardness`               | `Hardness 50%`    | `Hardness 50%`  | 0..100; Brush mode only            |
 * | Eraser                  | Spacing         | `<input type=range>`          | `eraser-spacing`                | `Spacing 25%`     | `Spacing 25%`   | 1..100; Brush mode only            |
 * | Eraser                  | Flow            | `<input type=range>` DISABLED | `eraser-flow`                   | `Flow 100%`       | `Flow 100%`     | 1..100, always disabled            |
 * | Magic Eraser / Bucket   | Tolerance       | `<input type=range>`          | `<tool>-tolerance`              | `Tolerance 32`    | `Tolerance 32`  | 0..255, step 1 (Adobe, not 0..100) |
 * | Magic Eraser / Bucket   | Contiguous      | `<input type=checkbox>`       | `<tool>-contiguous`             | `Contiguous`      | `Contiguous`    | checked                             |
 * | Magic Eraser / Bucket   | Anti-aliased    | `<input type=checkbox>` DISABLED | `<tool>-anti-aliased`         | `Anti-aliased`    | `Anti-aliased`  | checked, always disabled            |
 * | Magic Eraser / Bucket   | Opacity         | `<input type=range>`          | `<tool>-opacity`                | `Opacity 100%`    | `Opacity 100%`  | 0..100, step 1                     |
 * | Eyedropper              | Sample Size     | `<select>`                    | `eyedropper-sample-size`        | `Sample Size`     | `Sample Size`   | 1 / 3 / 5                          |
 * | Eyedropper              | Sample All Layers | `<input type=checkbox>` DISABLED | `eyedropper-sample-all-layers` | `Sample All Layers` | `Sample All Layers` | unchecked, always disabled    |
 * | Draw (test fixture)     | Pen Type        | `<select>`                    | `pen-type`                      | `Pen Type`        | `Pen Type`      | pen / pen-dashed / spray            |
 * | Draw (test fixture)     | Size            | `<input type=range>`          | `size-slider`                   | `Size 10px`       | `Size 10px`     | 0.5..500, step 0.5                  |
 * | Draw (test fixture)     | Opacity         | `<input type=range>`          | `alpha-slider`                  | `Opacity 90%`     | `Opacity 90%`   | 0..1, step 0.01                    |
 *
 * Toolbar placement (`toolbar-mapping.ts`): `eyedropper` is the tile of the `I` family and at the
 * suite's 1280x720 the rail fills its slot, so its seven visible tiles are the first seven of its
 * fifteen groups and the eyedropper — the fifth — is one of them: `clickToolButton(page,
 * 'eyedropper')` selects it directly. Its flyout now exists (the Ruler joined it) but nothing here
 * needs it, because the Eyedropper is its own first entry and a tile click selects that. The other three share ONE
 * flyout whose primary tool is `brush` (six entries: brush, pencil, color-replacement, eraser,
 * magic-eraser, paint-bucket), so `clickToolButton(page, 'brush')` only ever selects the Brush
 * and the other three need `openToolFlyout` + `selectFromFlyout` — through the BRUSH TILE at that
 * window, because the brush group is the SEVENTH of the fifteen and so is the LAST tile the rail
 * shows there: it is on the rail, and `openToolFlyout` long-presses that tile instead of taking
 * its three-dots branch. The fold begins one group further down, at the Clone Stamp (the eighth).
 *
 * Geometry: the app seeds an 800x600 opaque white `Blank 1` base layer on load (there is no
 * file input and no "open image" gesture), so every colour a tool acts on in this spec is
 * painted first with the Draw tool, which commits a NEW layer and leaves it active. That is why
 * the eraser and the two fill tools, which all edit the ACTIVE layer, can see it.
 *
 * Every coordinate below is CANVAS-RELATIVE CSS pixels, matching `drawLine`'s contract, and the
 * canvas box is re-measured immediately before each gesture and each read: the options bar's
 * height changes with the active tool, the main area is a grid row, and a cached box from
 * another tool's bar silently addresses a different pixel. Pixels are read back through
 * `screenshot-scale.ts`, the repo's single scaling rule, so a capture at any device-pixel scale
 * converts correctly without dividing by a DPR.
 */

const BLACK = '#000000';
const RED = '#cc0000';
const GREEN = '#00aa00';

const LINE_Y = 200;

/**
 * How much further right this spec's line runs than the suite's standard test line.
 *
 * The start is the shared `LINE_START_X` and nothing else: the slab begins at the same place
 * everywhere, so importing it is pure coupling and no test moves. The END is the shared
 * `STANDARD_LINE_END_X` plus this extension, and that is a real difference rather than a stale
 * copy — measured, not argued. Setting this spec's end to the shared `LINE_END_X` fails three of
 * its ten tests immediately and by name:
 *
 * - `'the paint bucket fills a contiguous region and not its neighbour'` and `'the magic eraser
 *   erases the clicked region and leaves a neighbour alone'` both read `farSegment` on the far side
 *   of the cut, and a 150..350 line leaves that far segment only 50 units long, so the read lands
 *   on the white base layer and the red assertions see `green` 255 instead of under 100.
 * - `'the paint bucket tolerance control changes which pixels are filled'` times out on its
 *   Tolerance 255 wait: the layer is padded by a full lineWidth past the painted end, so a shorter
 *   line puts the layer's own transparent corner outside the layer, and a flood fill cannot reach
 *   a pixel the layer does not contain.
 *
 * So the end is DERIVED from the shared one rather than declared beside it. Two reasons, and the
 * second is the load-bearing one:
 *
 * 1. A bare private `LINE_END_X = 450` is a second declaration of a name the suite exports with a
 *    different meaning. A reader, or a later row converting coordinates in another spec, can take
 *    the name from here and be 100 units out while every test in the file still passes. That is the
 *    failure this block exists to prevent, and the name is now distinct: `ERASE_LINE_END_X` cannot
 *    be mistaken for the shared constant, and its value is visibly the shared value plus this.
 * 2. Deriving keeps the extension the ONE tunable number. Everything below that is a function of
 *    where the line ends is computed from `ERASE_LINE_END_X` — the clip, the sampling points, the
 *    layer corner — so the geometry moves as one piece instead of as a set of literals that happen
 *    to agree today. The end is also deliberately SENSITISED: changing it fails loudly and names
 *    the tests that depend on it, which is the behaviour a shared constant should have.
 *
 * Every value here is CANVAS-BOX-relative CSS pixels (`[BOX]`), matching `drawLine`, which adds the
 * box with no contain scale. These are not document points; `documentToCanvasOffset` is the forward
 * statement for a caller that wants the document pixel.
 */
const LINE_EXTENSION_X = 100;

/** This spec's own right end. Deliberately NOT named `LINE_END_X`, which the suite also exports. */
const ERASE_LINE_END_X = STANDARD_LINE_END_X + LINE_EXTENSION_X;

/** Draw-tool Size for a slim line (20 image px tall) and for a slab the eraser can be measured inside. */
const SLIM = 20;
const SLAB = 100;

/** Half the slab's rounded cap: how far the stroke reaches PAST a line endpoint. */
const SLAB_CAP = SLAB / 2;

/** How far `pointsBoundingPos` pads the layer beyond the painted slab: a full lineWidth per side. */
const LAYER_PAD = SLAB;

/**
 * The middle of the drawn line, in the units `readPixel` takes.
 *
 * Every read that means "the middle of the drawn line" was the bare literal 300, which is this
 * value and not a coincidence: `LINE_START_X` is 150 and `ERASE_LINE_END_X` is 450. Expressing it
 * as the midpoint means the eleven sites that use it keep meaning the middle of the slab if either
 * end ever moves, instead of eleven identical magic numbers that must all be re-derived by hand —
 * and in the two tests that cut the line in two, it is also where the cut is drawn, so the cut and
 * the read on it are now visibly the same point rather than two literals that happen to agree.
 */
const LINE_CENTRE_X = (LINE_START_X + ERASE_LINE_END_X) / 2;

/**
 * The transparent corner the Tolerance test uses as its canary: outside the PAINTED slab, inside
 * the LAYER.
 *
 * A round cap of `SLAB_CAP` reaches past the line's endpoint, and `pointsBoundingPos` then pads the
 * layer by a full `LAYER_PAD` past that painted end. So the band this point must fall inside runs
 * from `ERASE_LINE_END_X + SLAB_CAP` to `ERASE_LINE_END_X + LAYER_PAD` horizontally, and from
 * `LINE_Y - LAYER_PAD` to `LINE_Y - SLAB_CAP` vertically, and it sits at that band's midpoint — the
 * position least sensitive to either edge.
 *
 * It was the bare literal `{ x: 530, y: 110 }`, a magic number whose only reason to be correct is
 * the private 450; derived, the Tolerance 255 wait that depends on it can no longer silently sample
 * outside the layer when the line's end changes.
 */
const TRANSPARENT_CORNER = {
  x: ERASE_LINE_END_X + (SLAB_CAP + LAYER_PAD) / 2,
  y: LINE_Y - (SLAB_CAP + LAYER_PAD) / 2,
};

type Rgb = { red: number; green: number; blue: number };
type Point = { x: number; y: number };

/** Background: what the composited canvas shows where nothing paints over the white base layer. */
const isBackground = (color: Rgb): boolean => Math.min(color.red, color.green, color.blue) >= 240;
/** The `#cc0000` the Draw tool laid down. */
const isRed = (color: Rgb): boolean => color.red > 150 && color.green < 100 && color.blue < 100;
/**
 * "A fill happened here", stated without naming the colour it used.
 *
 * The tolerance test is about WHICH pixels are inside the region, not about what the fill wrote
 * into them, so it detects the fill by exclusion: the line's own colour and the background are
 * both ruled out, and anything else counts. That keeps the assertion true whether the bucket
 * writes the store's foreground colour or not, so a colour defect is reported by the one test
 * that owns the colour contract instead of leaking into this one.
 */
const isFilled = (color: Rgb): boolean => !isRed(color) && !isBackground(color);
/** Total per-channel distance from the background white: 0 on the background, 765 on black. */
const distanceFromBackground = (color: Rgb): number => 255 - color.red + (255 - color.green) + (255 - color.blue);

/** The workspace canvas's CURRENT CSS box. Never cached across a tool switch; see the header. */
async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('Workspace canvas has no bounding box');
  return box;
}

/**
 * The drawn line plus margin, as a page-space clip, measured from the canvas's current box.
 *
 * Derived from the line's own geometry rather than written as `{ x: 120, y: 130, width: 360,
 * height: 140 }`, which is what it used to be. Those four numbers happened to bracket the line
 * exactly, and a clip that stops bracketing it is a clip that has stopped watching the stroke, so
 * nothing here may be a literal: the horizontal extent follows the line's two ends, and the
 * vertical follows the slab's painted height plus clearance. `measureErasedWidth` reads inside this
 * clip, so its windows inherit the same guarantee.
 */
const CLIP_MARGIN_X = 30;
const CLIP_MARGIN_Y = 20;

async function slabClip(page: Page): Promise<Required<ClipOptions>> {
  const box = await canvasBox(page);
  return {
    x: box.x + LINE_START_X - CLIP_MARGIN_X,
    y: box.y + LINE_Y - SLAB_CAP - CLIP_MARGIN_Y,
    width: ERASE_LINE_END_X - LINE_START_X + CLIP_MARGIN_X * 2,
    height: SLAB + CLIP_MARGIN_Y * 2,
  };
}

/** The name the seeded base layer carries in the Layers panel: `layer-utils.ts:160,181`. */
const SEEDED_LAYER = 'Blank 1';

/**
 * Opens the app and waits for the seeded blank document to exist AND to be composed.
 *
 * `toBeVisible()` alone is not readiness: the base layer is created from an effect, so the canvas
 * element is on screen before it holds a pixel. The poll reads the composited canvas instead, and
 * it succeeds only once an opaque pixel is there to read.
 *
 * **The pixel poll alone is not readiness either, and this is the defect it hid.** The store
 * starts with `documentId: 'uninitialized'`, `activeLayerId: null` and an empty history
 * (`StoreContext.tsx:307,315,317`); the document only exists once the seed's `REPLACE_DOCUMENT`
 * lands (`setBlankImage()` -> `useLayer.ts:214-230` -> `useLayer.ts:174-199`). `readPixel` cannot
 * tell that state from a ready one: it calls `getColorAtPoint(image, x, y, 0)` with no
 * `ignoreNearWhite`, and that function returns `null` only for a point outside the capture or for
 * a fully transparent one (`canvas-helpers.ts:718`). A WHITE pixel therefore satisfies it, so
 * the poll is a test that a screenshot is non-empty. Measured on this spec, it was satisfied on its
 * FIRST attempt on 20 of 20 runs, 42-154 ms after `goto` resolved.
 *
 * So the wait named the seeded base layer and never looked at it. The seeded layer is read by name
 * out of the Layers panel instead, which is a fact about the document rather than about a capture:
 * a layer row that is in the panel is a layer the store published. The locator is the one
 * `e2e/layers.spec.ts:27-28` already uses, because this panel publishes no `data-testid`.
 *
 * The pixel poll is KEPT, not replaced. The row proves the document exists; the capture proves it
 * is painted. Two waits for two facts, and the second still cannot be satisfied by a page that has
 * not composited.
 */
async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  await expect(
    page.getByTitle('Drag to reorder').filter({ hasText: SEEDED_LAYER }),
    'the seeded Blank 1 base layer to be in the document'
  ).toBeVisible();
  await expect
    .poll(async () => readPixel(page, { x: 400, y: 300 }), { message: 'the blank base layer to be composed' })
    .not.toBeNull();
}

/**
 * Composited colour at a canvas-relative point.
 *
 * A small CSS window around the point is captured, decoded, and its centre pixel is sampled —
 * never a device-pixel assumption, and never a positional canvas locator. A layer's own alpha is
 * NOT readable here: the composite is opaque everywhere, so what comes back is the layer's
 * contribution resolved against the white base layer. That is enough to see a partial erase (15%
 * of black over white leaves a mid grey) and it is stated wherever it is relied on.
 */
async function readPixel(page: Page, point: Point): Promise<Rgb | null> {
  const box = await canvasBox(page);
  const radius = 3;
  const clip: Required<ClipOptions> = {
    x: box.x + point.x - radius,
    y: box.y + point.y - radius,
    width: radius * 2,
    height: radius * 2,
  };
  const image = await loadImageData(await page.screenshot({ clip }));
  // The scaling rule divides by the image's own dimensions, so a zero-sized capture yields NaN
  // coordinates that every sampler then reports as "no pixel" — a silently missing read.
  if (image.width <= 0 || image.height <= 0) {
    throw new Error(`readPixel: empty capture for the window at canvas-relative (${point.x}, ${point.y})`);
  }
  const centre = cssPointToImage(image, clip, { x: clip.x + radius, y: clip.y + radius });
  return getColorAtPoint(image, Math.round(centre.x), Math.round(centre.y), 0);
}

/** Polls one composited pixel until it satisfies `check`, then returns what it saw. */
async function waitForPixel(
  page: Page,
  point: Point,
  check: (color: Rgb) => boolean,
  description: string
): Promise<Rgb> {
  let observed: Rgb | null = null;
  await expect
    .poll(
      async () => {
        observed = await readPixel(page, point);
        return observed !== null && check(observed);
      },
      { message: description, timeout: CANVAS_REDRAW_TIMEOUT_MS, intervals: [CANVAS_REDRAW_POLL_INTERVAL_MS] }
    )
    .toBe(true);
  return observed!;
}

/** The foreground swatch's computed background, read per channel rather than as a formatted string. */
async function readSwatch(page: Page): Promise<Rgb | null> {
  const computed = await page
    .getByTestId('foreground-color-swatch')
    .evaluate((node) => window.getComputedStyle(node).backgroundColor);
  const channels = computed.match(/-?\d+(?:\.\d+)?/g);
  if (!channels || channels.length < 3) return null;
  return {
    red: Math.round(Number(channels[0])),
    green: Math.round(Number(channels[1])),
    blue: Math.round(Number(channels[2])),
  };
}

/** Largest per-channel disagreement between the swatch and an expected colour. */
async function swatchDelta(page: Page, expected: Rgb): Promise<number> {
  const swatch = await readSwatch(page);
  if (!swatch) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(swatch.red - expected.red),
    Math.abs(swatch.green - expected.green),
    Math.abs(swatch.blue - expected.blue)
  );
}

/**
 * Selects one of the three eraser-family tools out of the six-item `brush` flyout.
 *
 * `from` is the tile that currently owns the group, because the tile's `data-testid` follows its
 * CURRENT primary tool (`SidebarLeft.tsx:238`). It is `brush` until one of the family is chosen,
 * and that chosen tool's own name afterwards: the flyout is only reachable again from whichever
 * tile currently leads it.
 *
 * At 1280x720 that tile IS on the rail: the rail folds a SUFFIX, the brush group is the SEVENTH
 * of the fifteen, and seven tiles fit at that window, so the Brush is the LAST of them. This
 * helper's `openToolFlyout` therefore reaches the flyout by long-pressing the Brush's own tile
 * rather than through its collapse branch, and the selection is proved on `aria-pressed` of that
 * tile. The fold begins at the Clone Stamp (the eighth), and it is the three-dots tile that
 * stands for a collapsed tool and nothing else.
 *
 * That tile is read as SELECTION STATE, not as an accessible name, and `expectToolSelected` picks
 * the right channel for whichever of the two kinds of tile it is handed. It is the Brush's own
 * tile on this spec's path; the three-dots tile is the helper's other branch, and it deliberately
 * renders NO `aria-pressed` (`SidebarLeft.tsx:635` — a control that opens a menu must
 * not also claim to be a pressed toggle for a tool the user cannot see), so what it does still
 * render for the selected member of the collapsed set is the lit class
 * `TOOL_BUTTON_ACTIVE_CLASS`, painted off the same `group.some(tool => tool.name === toolName)`
 * predicate the attribute used to expose. Its failure message therefore names the tool by slug;
 * `label` remains what the flyout item itself is matched on.
 *
 * `verifyPrimaryTool` cannot answer the same question for a different reason: it asserts a tile's
 * ACCESSIBLE NAME, and the tile standing for a collapsed tool is the three-dots tile, whose name
 * is "More Tools" and never the tool's label. It now says exactly that when a tool has no tile of
 * its own, instead of failing on an empty text content. The eyedropper tests below do NOT share
 * that reason: the eyedropper is the fifth of the fifteen and the fifth of the seven the rail
 * shows at 720, so it has a tile of its own and the helper selects it directly. They confirm the
 * selection through the eyedropper's own options bar all the same, because that is the one
 * element in the document driven by `toolName` itself.
 */
async function selectBrushFamilyTool(page: Page, from: string, toolName: string, label: string): Promise<void> {
  await openToolFlyout(page, from);
  await selectFromFlyout(page, { toolName, label });
  await expectToolSelected(page, toolName);
}

/**
 * Paints a straight line of `color` at `size` with the Draw tool and waits for it to reach the
 * backing store. The Draw tool's Opacity is pinned to 1 because its seeded 0.9 would composite
 * the stroke against the white base layer and every colour assertion below would then be
 * reading a blend rather than the colour that was asked for.
 */
async function drawSlab(
  page: Page,
  color: string,
  size: number,
  wait: (screenshot: Buffer) => Promise<boolean>
): Promise<void> {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, color, true);
  const sizeSlider = page.getByRole('slider', { name: /^Size/ });
  await expect(sizeSlider).toBeVisible();
  await sizeSlider.fill(String(size));
  await expect(sizeSlider).toHaveValue(String(size));
  await page.getByRole('slider', { name: /^Opacity/ }).fill('1');
  await drawLine(page, await canvasBox(page), LINE_START_X, LINE_Y, ERASE_LINE_END_X, LINE_Y, { steps: 8 });

  // The commit is asserted BEFORE the pixels, and that order is the whole point of it.
  //
  // The gesture commits from `handlePointerUp` and nothing else: `DrawToolArea.tsx:110-143` is the
  // only writer, and it is reached only when `isPointerUpValid` agrees, which refuses on a
  // non-primary button or a foreign pointer id (`usePointerPosition.ts:149,151`). Every earlier
  // action in this function reports success either way — the sliders hold the values that were
  // asked for, the mouse moved, the release was dispatched — so a refused gesture is
  // indistinguishable from a slow one, and it surfaces as the bare
  // `Canvas did not render the #cc0000 line within 10000ms` from `canvas-helpers.ts:536` after
  // polling for ten seconds against a canvas that was never going to change.
  //
  // A committed stroke is a history entry, and a seeded document has exactly one entry at cursor 0,
  // so `undo` is disabled before the draw and enabled after it. The eyedropper test below already
  // reads that same button to prove the INVERSE — that a click added no entry, in the assertion
  // that says so — so this is the repo's own instrument, used for the other half of the fact. With
  // this assertion first, a dropped commit names itself in the default expect timeout; with only
  // the pixel poll, it can only ever report that nothing appeared.
  await expect(
    page.getByTestId('undo-button'),
    `the ${color} stroke to commit one history entry; a gesture the pointer validators refused leaves no entry and no pixels`
  ).toBeEnabled();

  await waitForCanvasPixels(page, await slabClip(page), wait, { description: `the ${color} line` });
}

/** Drags a stroke between two canvas-relative points with the CURRENT tool. */
async function stroke(page: Page, from: Point, to: Point, steps = 6): Promise<void> {
  await drawLine(page, await canvasBox(page), from.x, from.y, to.x, to.y, { steps });
}

/** Clicks a canvas-relative point with the CURRENT tool. */
async function clickAt(page: Page, point: Point): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

/** Width in capture pixels of the erased slot centred on `centreX`, or null when nothing is erased yet. */
async function measureErasedWidth(page: Page, centreX: number): Promise<number | null> {
  const box = await canvasBox(page);
  const window: Required<ClipOptions> = {
    x: box.x + centreX - 75,
    y: box.y + LINE_Y - 40,
    width: 150,
    height: 80,
  };
  const image = await loadImageData(await page.screenshot({ clip: window }));
  if (image.width <= 0 || image.height <= 0) {
    throw new Error(`measureErasedWidth: empty capture for the window centred on x=${centreX}`);
  }
  // The window lies wholly inside the black slab, so the only background-coloured pixels in it
  // are the erased ones.
  const bounds = await scanPixelsForBounds(
    image,
    (red, green, blue, alpha) => alpha !== 0 && red >= 240 && green >= 240 && blue >= 240
  );
  if (!bounds.found) return null;
  return bounds.right - bounds.left + 1;
}

test.describe('Eraser, fill tools and eyedropper', () => {
  // eraser: a stroke must actually cut the pixels out of the layer it is editing
  test('the eraser cuts transparency out of the active layer', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, BLACK, SLIM, hasDarkPixels);

    await selectBrushFamilyTool(page, 'brush', 'eraser', 'Eraser Tool');
    await page.getByRole('slider', { name: /^Size/ }).fill('60');
    // A 60px tip straddling a 20px line erases every dark pixel the line owns.
    await stroke(page, { x: LINE_START_X, y: LINE_Y }, { x: ERASE_LINE_END_X, y: LINE_Y }, 12);
    await waitForCanvasPixels(page, await slabClip(page), async (screenshot) => !(await hasDarkPixels(screenshot)), {
      description: 'no dark pixels left under the eraser stroke',
    });

    const erased = await readPixel(page, { x: LINE_CENTRE_X, y: LINE_Y });
    expect(erased, 'nothing readable at the centre of the erased band').not.toBeNull();
    expect(
      Math.min(erased!.red, erased!.green, erased!.blue),
      'the eraser must leave the background showing, not paint over the line'
    ).toBeGreaterThan(240);
  });

  // eraser: one history state per stroke, not per pointer event
  test('the eraser stroke is one history entry', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, BLACK, SLIM, hasDarkPixels);

    await selectBrushFamilyTool(page, 'brush', 'eraser', 'Eraser Tool');
    // 20 interpolated moves, so a commit per pointer event would be 20 entries.
    await stroke(page, { x: LINE_START_X, y: LINE_Y }, { x: ERASE_LINE_END_X, y: LINE_Y }, 20);
    await waitForCanvasPixels(page, await slabClip(page), async (screenshot) => !(await hasDarkPixels(screenshot)), {
      description: 'the eraser stroke to land',
    });

    const undo = page.getByTestId('undo-button');
    await expect(undo).toBeEnabled();
    // One click reverts the WHOLE stroke, which is the claim: an entry per pointer event would
    // leave the earlier moves still erased.
    await undo.click();
    await waitForCanvasPixels(page, await slabClip(page), hasDarkPixels, {
      description: 'the whole stroke restored by a single undo',
    });
    const restored = await readPixel(page, { x: LINE_CENTRE_X, y: LINE_Y });
    expect(Math.min(restored!.red, restored!.green, restored!.blue), 'the line should be back').toBeLessThan(60);

    // And nothing is left to undo, so the stroke wrote exactly one entry on top of the draw's.
    await undo.click();
    await expect(undo).toBeDisabled();
    await waitForCanvasPixels(page, await slabClip(page), async (screenshot) => !(await hasDarkPixels(screenshot)), {
      description: 'the drawn line removed by the second undo',
    });
  });

  // eraser: the Brush mode is a stamped soft tip now, so all three are offered and all three work
  test('the eraser mode select offers all three Photoshop modes, and the select is live', async ({ page }) => {
    await openWorkspace(page);
    await selectBrushFamilyTool(page, 'brush', 'eraser', 'Eraser Tool');

    const mode = page.getByRole('combobox', { name: 'Mode' });
    await expect(mode).toBeVisible();
    // The seeded default is Brush, because a soft tip is what Photoshop's eraser opens on and a
    // hard first stroke is the defect this replaced.
    await expect(mode).toHaveValue('brush');

    const brushOption = mode.locator('option[value="brush"]');
    await expect(brushOption).toHaveText('Brush');
    // `toBeDisabled()` is deliberately NOT used on the option. This repo wraps every control in
    // its own `<label>`, and Playwright's `disabled` state retargets an element that is not a
    // form control up to `label.control` — so an `<option>` inside a label-wrapped `<select>` is
    // reported against the SELECT, which is enabled, no matter what the option carries. The
    // attribute plus the enabled set is the same fact read through a channel that is not
    // retargeted, and it is what a user can actually do. See e2e/OPEN_PROBLEMS.md.
    await expect(brushOption).not.toHaveAttribute('disabled', '');
    const selectable = await mode
      .locator('option')
      .evaluateAll((nodes) =>
        nodes.filter((node) => !(node as HTMLOptionElement).disabled).map((node) => (node as HTMLOptionElement).value)
      );
    expect(selectable, 'all three Photoshop modes may be offered').toEqual(['brush', 'pencil', 'block']);

    // The select is live rather than decorative: Adobe drops Opacity from Block mode entirely,
    // so a select that only rendered options would fail here.
    const opacity = page.getByRole('slider', { name: /^Opacity/ });
    await expect(opacity).toBeVisible();
    await mode.selectOption('block');
    await expect(opacity).toHaveCount(0);
    await mode.selectOption('pencil');
    await expect(opacity).toBeVisible();
  });

  // eraser: Size must change the rendered tip, not only the readout
  test('the eraser size control changes the width of the erased region', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, BLACK, SLAB, hasDarkPixels);

    await selectBrushFamilyTool(page, 'brush', 'eraser', 'Eraser Tool');
    const size = page.getByRole('slider', { name: /^Size/ });
    // Two vertical strokes, so the erased slot's WIDTH is the tip size. They sit in the same
    // slab on different columns, and each is measured in a window that sees only its own slot.
    await size.fill('20');
    await stroke(page, { x: 200, y: LINE_Y - 20 }, { x: 200, y: LINE_Y + 20 });
    await size.fill('90');
    await stroke(page, { x: 380, y: LINE_Y - 20 }, { x: 380, y: LINE_Y + 20 });
    await expect(size).toHaveValue('90');

    await expect
      .poll(
        async () => {
          const narrow = await measureErasedWidth(page, 225);
          const wide = await measureErasedWidth(page, 395);
          return narrow !== null && wide !== null && wide > narrow * 2;
        },
        {
          message: 'the two erased slots to differ in width',
          timeout: CANVAS_REDRAW_TIMEOUT_MS,
          intervals: [CANVAS_REDRAW_POLL_INTERVAL_MS],
        }
      )
      .toBe(true);

    const narrow = await measureErasedWidth(page, 225);
    const wide = await measureErasedWidth(page, 395);
    expect(narrow, 'the Size 20 stroke left no erased slot').not.toBeNull();
    expect(wide, 'the Size 90 stroke left no erased slot').not.toBeNull();
    expect(wide!, 'a larger Size must erase a proportionally wider slot').toBeGreaterThan(narrow! * 2);
  });

  // eraser: Opacity must reach the composited pixels, not only the readout
  test('the eraser opacity control reaches the pixels', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, BLACK, SLAB, hasDarkPixels);

    await selectBrushFamilyTool(page, 'brush', 'eraser', 'Eraser Tool');
    await page.getByRole('slider', { name: /^Size/ }).fill('30');
    const opacity = page.getByRole('slider', { name: /^Opacity/ });
    await expect(opacity).toHaveValue('100');

    // Two bands of the same slab, each stroked end to end and each read at its MIDDLE.
    //
    // The bands are named so the reads below are the midpoints rather than the numbers the strokes
    // happened to be written with. Both reads used to sit on a band's first column — 15px from the
    // point where the 30px tip's coverage ramps up — which is the least representative pixel of a
    // band: a defect that erased only the edges, or only the interior, is invisible at the edge and
    // fatal in the middle. Reading the middle cannot pass while the band is partly wrong.
    //
    // The full band's far end is 440, which needs this spec's longer line: with the shared
    // `LINE_END_X` the slab's painted right end is 400 and the band would run off the slab into the
    // white base layer, making the strongest assertion here — that 100% removes the colour entirely
    // — a statement about the background it was supposed to be erasing.
    const partialBand = { from: 200, to: 260 };
    const fullBand = { from: 380, to: 440 };
    const partialMiddle = (partialBand.from + partialBand.to) / 2;
    const fullMiddle = (fullBand.from + fullBand.to) / 2;

    await opacity.fill('15');
    await expect(opacity).toHaveValue('15');
    await stroke(page, { x: partialBand.from, y: LINE_Y }, { x: partialBand.to, y: LINE_Y }, 4);
    await opacity.fill('100');
    await expect(opacity).toHaveValue('100');
    await stroke(page, { x: fullBand.from, y: LINE_Y }, { x: fullBand.to, y: LINE_Y }, 4);

    await waitForPixel(page, { x: fullMiddle, y: LINE_Y }, isBackground, 'the 100% stroke removing the slab colour');
    await waitForPixel(
      page,
      { x: partialMiddle, y: LINE_Y },
      (color) => color.green > 15,
      'the 15% stroke lightening the slab'
    );

    // A layer's own alpha is not readable from a composite — the read resolves it against the
    // opaque white base layer. That is enough here and is the strongest available statement:
    // 15% of a black slab over white leaves ~38/255, so the region is partially visible, while
    // 100% leaves the untouched base layer's 255. What is NOT assertable is the raw alpha byte.
    const partial = (await readPixel(page, { x: partialMiddle, y: LINE_Y }))!;
    const full = (await readPixel(page, { x: fullMiddle, y: LINE_Y }))!;
    const untouched = (await readPixel(page, { x: LINE_CENTRE_X, y: LINE_Y }))!;
    expect(untouched.green, 'the slab should still be untouched black between the two strokes').toBeLessThan(20);
    expect(partial.green, '15% opacity must lighten the stroke without removing it').toBeGreaterThan(untouched.green);
    expect(partial.green, '15% opacity must leave the region visible, not erased').toBeLessThan(full.green);
    expect(full.green, '100% opacity must remove the region entirely').toBeGreaterThan(240);
  });

  // paint bucket: Contiguous must bound the fill to the clicked region
  test('the paint bucket fills a contiguous region and not its neighbour', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, RED, SLIM, hasRedPixels);

    // Cut the line in two so the far segment is a neighbour of the same colour that the flood
    // cannot reach across the gap. A neighbour of a DIFFERENT colour only tests tolerance; this
    // one is what makes Contiguous do real work, because a non-contiguous fill takes it too.
    await selectBrushFamilyTool(page, 'brush', 'eraser', 'Eraser Tool');
    await page.getByRole('slider', { name: /^Size/ }).fill('30');
    await stroke(page, { x: LINE_CENTRE_X, y: LINE_Y - 50 }, { x: LINE_CENTRE_X, y: LINE_Y + 50 });
    await waitForPixel(page, { x: LINE_CENTRE_X, y: LINE_Y }, isBackground, 'the eraser cutting the line in two');

    await selectBrushFamilyTool(page, 'eraser', 'paint-bucket', 'Paint Bucket Tool');
    await setForegroundColor(page, GREEN, true);
    const tolerance = page.getByRole('slider', { name: /^Tolerance/ });
    await tolerance.fill('0');
    await expect(tolerance).toHaveValue('0');
    await clickAt(page, { x: 200, y: LINE_Y });

    // Wait for the region to have left the line's colour at all, so a fill that happens in the
    // WRONG colour fails on the colour assertion below instead of on a timeout here.
    await waitForPixel(
      page,
      { x: 200, y: LINE_Y },
      (color) => !isRed(color),
      'the clicked segment to leave the line colour'
    );
    const filled = (await readPixel(page, { x: 200, y: LINE_Y }))!;
    const farSegment = (await readPixel(page, { x: 400, y: LINE_Y }))!;
    const acrossTheCut = (await readPixel(page, { x: LINE_CENTRE_X, y: LINE_Y }))!;
    const foreground = hexToRgb(GREEN);
    expect(
      Math.max(
        Math.abs(filled.red - foreground.r),
        Math.abs(filled.green - foreground.g),
        Math.abs(filled.blue - foreground.b)
      ),
      `the clicked segment must carry the foreground colour ${GREEN}, not the fill tool's own seeded default (got ${filled.red},${filled.green},${filled.blue})`
    ).toBeLessThanOrEqual(8);
    expect(farSegment.red, 'the same-coloured segment beyond the cut must not be filled').toBeGreaterThan(150);
    expect(farSegment.green).toBeLessThan(100);
    expect(
      Math.min(acrossTheCut.red, acrossTheCut.green, acrossTheCut.blue),
      'the transparent surround next to the fill must be left alone at Tolerance 0'
    ).toBeGreaterThan(240);
  });

  // paint bucket: Tolerance must decide which pixels are inside the region
  test('the paint bucket tolerance control changes which pixels are filled', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    // A 100px slab: `pointsBoundingPos` pads the layer by a full lineWidth on every side, so the
    // layer's corners stay transparent where the round cap never reached.
    await drawSlab(page, RED, SLAB, hasRedPixels);
    // The canary point is derived, not written: `TRANSPARENT_CORNER` states which two bounds it
    // has to fall between and why. The literal it replaces was correct only because the line's end
    // was 450, and a shorter line silently moved this point outside the layer — where no fill can
    // ever reach it and the Tolerance 255 wait times out instead of failing on its own assertion.
    const corner = TRANSPARENT_CORNER;
    const seed = { x: LINE_CENTRE_X, y: LINE_Y };
    const before = (await readPixel(page, corner))!;
    expect(
      Math.min(before.red, before.green, before.blue),
      'the layer corner must start out as the untouched transparent surround'
    ).toBeGreaterThan(240);

    await selectBrushFamilyTool(page, 'brush', 'paint-bucket', 'Paint Bucket Tool');
    await setForegroundColor(page, GREEN, true);
    const tolerance = page.getByRole('slider', { name: /^Tolerance/ });
    await tolerance.fill('0');
    await expect(tolerance).toHaveValue('0');
    await clickAt(page, seed);
    await waitForPixel(page, seed, isFilled, 'the Tolerance 0 fill');
    const afterNarrow = (await readPixel(page, corner))!;
    expect(
      Math.min(afterNarrow.red, afterNarrow.green, afterNarrow.blue),
      'Tolerance 0 must stay inside the exact-match region'
    ).toBeGreaterThan(240);

    // Put the line back so the high-tolerance fill sees the same image.
    await page.getByTestId('undo-button').click();
    await waitForPixel(page, seed, isRed, 'the Tolerance 0 fill undone');

    await tolerance.fill('255');
    await expect(tolerance).toHaveValue('255');
    await clickAt(page, seed);
    await waitForPixel(page, corner, isFilled, 'the Tolerance 255 fill reaching the layer corner');
    const afterWide = (await readPixel(page, corner))!;
    expect(
      distanceFromBackground(afterWide),
      'a wider tolerance must reach pixels the narrow one left alone'
    ).toBeGreaterThan(distanceFromBackground(afterNarrow));
  });

  // magic eraser: same gesture and same region as the bucket, opposite output
  test('the magic eraser erases the clicked region and leaves a neighbour alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, RED, SLIM, hasRedPixels);

    await selectBrushFamilyTool(page, 'brush', 'eraser', 'Eraser Tool');
    await page.getByRole('slider', { name: /^Size/ }).fill('30');
    await stroke(page, { x: LINE_CENTRE_X, y: LINE_Y - 50 }, { x: LINE_CENTRE_X, y: LINE_Y + 50 });
    await waitForPixel(page, { x: LINE_CENTRE_X, y: LINE_Y }, isBackground, 'the eraser cutting the line in two');

    await selectBrushFamilyTool(page, 'eraser', 'magic-eraser', 'Magic Eraser Tool');
    const tolerance = page.getByRole('slider', { name: /^Tolerance/ });
    await tolerance.fill('0');
    await expect(tolerance).toHaveValue('0');
    await clickAt(page, { x: 200, y: LINE_Y });

    // Opposite of the bucket above, on the same pixels: the region loses alpha instead of
    // taking the foreground colour, so the base layer shows through as background.
    await waitForPixel(page, { x: 200, y: LINE_Y }, isBackground, 'the magic eraser clearing the clicked segment');
    const cleared = (await readPixel(page, { x: 200, y: LINE_Y }))!;
    const farSegment = (await readPixel(page, { x: 400, y: LINE_Y }))!;
    expect(
      Math.min(cleared.red, cleared.green, cleared.blue),
      'the clicked region must lose its colour'
    ).toBeGreaterThan(240);
    expect(farSegment.red, 'the same-coloured segment beyond the cut must survive').toBeGreaterThan(150);
    expect(farSegment.green).toBeLessThan(100);
  });

  // eyedropper: sets the foreground and records no history state at all
  test('the eyedropper sets the foreground colour and records no history state', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, RED, SLAB, hasRedPixels);

    // The eyedropper tile's own click selects it, so this fixture opens no flyout — and it has a
    // tile of its own here too: the rail fills its slot, so the seven tiles at the suite's 1280x720
    // are its first seven groups and the eyedropper is the fifth. So the bar below is confirmed
    // because it is the element the tool itself drives, not because the tile is missing: the
    // three-dots tile stands for nothing here. That the tile is on the rail is
    // `e2e/selection-tools.spec.ts`'s claim to own, so it is linked rather than restated.
    await clickToolButton(page, 'eyedropper');
    await expect(
      page.getByRole('combobox', { name: 'Sample Size' }),
      'the eyedropper is the active tool'
    ).toBeVisible();

    const target = (await readPixel(page, { x: LINE_CENTRE_X, y: LINE_Y }))!;
    expect(target.red, 'the sample target must be the red the Draw tool laid down').toBeGreaterThan(180);
    expect(target.green).toBeLessThan(100);
    expect(target.blue).toBeLessThan(100);

    // Move the foreground off the sample colour BEFORE the click. The Draw tool above set it to
    // exactly the colour under the cursor, so without this the poll below would be satisfied by
    // the pre-existing swatch and a totally dead eyedropper would pass it.
    await setForegroundColor(page, '#010101', true);
    const before = await swatchDelta(page, target);
    expect(before, 'the swatch must not already be showing the colour under the cursor').toBeGreaterThan(50);

    await clickAt(page, { x: LINE_CENTRE_X, y: LINE_Y });
    await expect
      .poll(async () => swatchDelta(page, target), {
        message: 'the foreground swatch to show the colour under the eyedropper',
        timeout: 5_000,
      })
      .toBeLessThanOrEqual(8);

    // Adobe's rule is that a history state comes from a change to PIXELS, and sampling changes
    // only the application foreground colour. The draw above did write one entry, so one undo
    // consuming it and leaving nothing behind is the absence of a state — not a history feature
    // that never fired. The button is asserted BEFORE the pixels so a history that grew reports
    // itself, rather than showing up as a canvas that stayed put.
    const undo = page.getByTestId('undo-button');
    await undo.click();
    await expect(undo, 'the eyedropper click must not have added a history state').toBeDisabled();
    await waitForCanvasPixels(page, await slabClip(page), async (screenshot) => !(await hasRedPixels(screenshot)), {
      description: 'the drawn line removed by undo',
    });
  });

  // eyedropper: Sample Size must average the block, not copy the centre pixel
  test('the eyedropper sample size averages the clicked block', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await openWorkspace(page);
    await drawSlab(page, RED, SLAB, hasRedPixels);

    // Selection is confirmed by the combobox below, which is the eyedropper's own bar, and the
    // tile the helper clicked is that tool's own tile at this window rather than the three-dots
    // tile — for the reason given in the sibling test.
    await clickToolButton(page, 'eyedropper');
    const sampleSize = page.getByRole('combobox', { name: 'Sample Size' });
    await expect(sampleSize, 'the eyedropper is the active tool').toBeVisible();
    await expect(sampleSize).toHaveValue('1');

    // Find the slab's top edge from the capture itself rather than assuming where the line
    // landed, so the click sits ON the colour boundary and the 3x3 window straddles it.
    const clip = await slabClip(page);
    const image = await loadImageData(await page.screenshot({ clip }));
    if (image.width <= 0 || image.height <= 0) throw new Error('empty capture while locating the slab edge');
    const column = Math.floor(image.width / 2);
    let edgeRow = -1;
    for (let row = 0; row < image.height; row++) {
      const index = (row * image.width + column) * 4;
      if (image.data[index] > 150 && image.data[index + 1] < 100 && image.data[index + 2] < 100) {
        edgeRow = row;
        break;
      }
    }
    expect(edgeRow, 'the slab should have a red top edge inside the clip').toBeGreaterThanOrEqual(0);
    const target = imagePointToCss(image, clip, { x: column, y: edgeRow });

    await setForegroundColor(page, '#010101', true);
    await page.mouse.click(target.x, target.y);
    await expect
      .poll(async () => swatchDelta(page, { red: 204, green: 0, blue: 0 }), {
        message: 'the Point Sample to read the pure red under the cursor',
        timeout: 5_000,
      })
      .toBeLessThanOrEqual(8);
    const pointSample = (await readSwatch(page))!;

    await sampleSize.selectOption('3');
    await expect(sampleSize).toHaveValue('3');
    // Reset the swatch so the poll below cannot be satisfied by the previous sample.
    await setForegroundColor(page, '#010101', true);
    await page.mouse.click(target.x, target.y);
    await expect
      .poll(async () => swatchDelta(page, { red: 204, green: 0, blue: 0 }), {
        message: 'the 3 by 3 Average to differ from the Point Sample',
        timeout: 5_000,
      })
      .toBeGreaterThan(30);
    const averaged = (await readSwatch(page))!;

    // The tool floors the sampled coordinate, so the click may land on the last background row
    // or the first red row; which one flips the SIGN of the difference but not its size. The
    // assertion is therefore on the magnitude, and the second one pins the meaning: an averaged
    // sample is strictly between the slab colour and the background, never a copy of either.
    expect(
      Math.abs(averaged.green - pointSample.green),
      `3 by 3 Average (${averaged.green}) must differ from Point Sample (${pointSample.green}) on the same pixel`
    ).toBeGreaterThan(30);
    expect(averaged.green, 'the average must mix the two sides of the boundary').toBeGreaterThan(20);
    expect(averaged.green).toBeLessThan(235);
  });
});
