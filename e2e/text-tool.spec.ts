import { expect, type Page, type TestInfo, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type CssBounds,
  type ImageDataResult,
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
import { imageBoundsToCss } from './helpers/screenshot-scale';

/**
 * The Text tool had no end-to-end coverage: `e2e/color.spec.ts` is a single test about
 * the foreground swatch and nothing drove the Type tool, its draft rectangle, its Apply
 * gate or the layer it commits.
 */

/**
 * The suite default is 30s (`playwright.config.ts:39`). Every test here is a page load,
 * a tool click, a drag and at most one redraw poll, which measures at 1-2s on this
 * host, so 30s was never the binding constraint. 60s is what the two sibling specs that
 * drive the canvas already ask for (`viewport-drawing.spec.ts:17`, `select-move.spec.ts:31`)
 * and it leaves room for a dev-server cold start and font rasterisation on CI's runner.
 */
const TEXT_TOOL_TIMEOUT_MS = 60_000;

/**
 * The rail's measured width, in CSS px.
 *
 * This is the one term in the canvas box's width that is not a constant of the app's design,
 * because it is the `auto` track of `grid-cols-[auto_1fr_250px]` and the rail chooses its own
 * width: 56px in one column, 108px in two, and one column is the default. Reading it is what
 * makes the width below a DERIVATION rather than a second place to update when that default
 * moves — this file's previous comment hard-coded the two-column 108 and was wrong by 52px the
 * day the default changed, with nothing in the suite able to notice, because every drag here is
 * box-relative and simply drew somewhere else in the document.
 */
const railWidth = async (page: Page): Promise<number> => {
  const box = await page.getByTestId('left-sidebar').boundingBox();
  if (!box) throw new Error('text-tool: left rail has no visible width');
  return box.width;
};

/**
 * The right panel's fixed grid track, in CSS px. See {@link expectedCanvasWidth}.
 */
const RIGHT_PANEL_WIDTH = 250;

/**
 * The canvas box width the shell's grid must produce, from the rail actually on screen.
 *
 * `250` is typed because it is a design constant of the shell rather than a per-viewport
 * measurement, and `railWidth` is the part that varies. Asserted against the measured box in
 * `canvasBox` so the two cannot drift apart.
 */
const expectedCanvasWidth = async (page: Page): Promise<number> => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('text-tool: page has no viewport');
  return viewport.width - (await railWidth(page)) - RIGHT_PANEL_WIDTH;
};

/**
 * A dragged draft rectangle in canvas-box coordinates, which is the space `drawLine`'s
 * arguments are in. Named so the two rectangles below are a type rather than two literals that
 * happen to agree, and so a helper that takes one can be called with either.
 */
interface DraftRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The rectangle the draft is dragged out in, in canvas-box coordinates — `drawLine`
 * offsets its arguments by the canvas box, so these are CSS px from the box's top-left
 * (`canvas-helpers.ts:471-478`).
 *
 * The rectangle is in CANVAS-BOX coordinates, so it does not care how wide the box is, and
 * that is why it is written the way it is. What does care is whether the box is wide enough to
 * hold the document at a usable size, and the answer is a property of the RAIL — the one number
 * in that chain that is not a constant of this file. The rail is the leftmost grid track
 * (`grid-cols-[auto_1fr_250px]`, `src/App.tsx:75`), so the canvas box is
 * `viewport - railWidth - 250`, and `railWidth` is 56px in one column and 108px in two. One
 * column is the DEFAULT now, so the box is `1280 - 56 - 250 = 974` wide. The old derivation here
 * read the rail as 108px and got 922, and it was wrong in a way no test would have caught: the
 * drag is box-relative, so it moved to a different part of the document and still drew inside
 * the rectangle the assertions were written about.
 *
 * `railWidth` below therefore measures the rail rather than assuming either value, and
 * `expectedCanvasWidth` is the arithmetic that must hold for `DRAFT_RECT` to be addressing the
 * document. At the suite's 1280x720 that is 974x583 at page (56, 100); the page does NOT
 * overflow, because `documentElement.scrollHeight` is 720, the same as `clientHeight` — the left
 * rail's `min-h-0 overflow-y-auto` owns its own scrolling, so the shell is exactly
 * viewport-tall. The 800x600 starting document (`src/App.tsx:20-25`) letterboxes into that
 * element HEIGHT-limited, at scale 0.97167, rendering 777x583 at box x 98.5..875.5 and all 583
 * rows. So the rectangle below — box x 200..600, y 200..320, i.e. document x 105..516,
 * y 206..329 — is inside the document, with 263 rows of element below it and no fold to clear.
 * (`e2e/OPEN_PROBLEMS.md` holds the layout table.)
 */
const DRAFT_RECT: DraftRect = { x1: 200, y1: 200, x2: 600, y2: 320 };

/**
 * The SECOND rectangle the style tests drag, below `DRAFT_RECT`.
 *
 * Every style test commits the same string twice — once as it renders with a style off, once
 * with it on — into ONE document, and the committed layers are composited together, so a scan
 * of the whole canvas finds both. Measuring the pair therefore needs two places on the canvas
 * rather than two moments in time, and each measurement's crop has to hold exactly one commit.
 *
 * THE ARITHMETIC, because a crop that reached its neighbour's ink would quietly corrupt the
 * comparison and nothing would say so. Every measurement in this file puts a 64px band 17 rows
 * below its rectangle's top and 59 rows above its bottom, and each crop reaches
 * `STYLE_CROP_PAD` = 40 past every edge of the rectangle it is scanning. So for a gap `G`
 * between two rectangles:
 *
 *   - the later commit's ink starts `G + 17` rows below the earlier rectangle's top, and the
 *     earlier crop ends `40` rows below that same edge, so the later ink is outside the earlier
 *     crop when `G + 17 > 40`, i.e. when `G > 23`;
 *   - the earlier commit's ink ends `120 - 59 = 61` rows below the earlier rectangle's top, and
 *     the later crop starts `G - 40` rows below it, so the earlier ink is outside the later
 *     crop when `G - 40 > 61`, i.e. when `G > 101`.
 *
 * The binding half is the second, and at a 40px gap the crops would overlap the first commit's
 * ink by one row. Hence y1 350 rather than 340: 150 is the first value whose crop starts below
 * `DRAFT_RECT`'s ink, and 150 rows of gap leaves 9 rows of daylight on the binding side and
 * 127 on the other. Nothing in the tests asserts that arithmetic — a crop that did reach its
 * neighbour would be measured as a wider, taller band, which the comparisons would report as a
 * difference in the STYLE — so it is recorded here, where a change to the gap or to
 * `STYLE_CROP_PAD` has to be read.
 *
 * It is the same width and height as `DRAFT_RECT` on purpose. The two commits are compared as
 * WIDTHS, so their boxes have to be the same width, or the left inset and the glyph scale
 * would differ between them and the comparison would be measuring the boxes. And it is
 * box-relative for the reason `DRAFT_RECT` is: document y 360..484 is inside the 600-row
 * document, and box y 350..470 is page y 450..570, inside the 720-row window with no scroll.
 */
const SECOND_DRAFT_RECT: DraftRect = { x1: 200, y1: 350, x2: 600, y2: 470 };

/**
 * How far outside a style rectangle the capture each measurement is scanned from reaches, in
 * box-relative CSS px. It has to be strictly larger than `INK_MARGIN`, and the reason is the
 * tripwire the committed-ink test states: a capture no larger than the rectangle it is checked
 * against cannot fail, because the pixels outside it were never in the image. So the crop is
 * 40px wider than the 6px margin it is checked against, on every side — and 40 rather than 7
 * because a crop that only just clears the margin would make a 33px escape invisible while
 * still reading as "the capture covers the rectangle".
 *
 * The upper bound is the other half of the contract, and it is the pair of rectangles that
 * has to clear it rather than this constant: 40 is what makes each crop reach past its own
 * rectangle, and `SECOND_DRAFT_RECT`'s gap is what keeps the two crops from meeting. See that
 * constant for the arithmetic.
 */
const STYLE_CROP_PAD = 40;

/**
 * Underline and Strikethrough are `fillRect`s in the type colour, which makes them the only
 * ink in this tool that is not a glyph — and that is exactly what the row profile can see.
 *
 * A glyph row is mostly gaps, so its red-pixel count falls short of its own column span. A rule
 * spans the line's measured ink width, so its count IS its span. Measured here for 'WAVE' at
 * 64px: the undecorated band's fullest row carries 79 pixels across a span of 170 (0.465), and
 * the decorated band's carries 176 across 176 — 1.0, to the pixel. The two bounds are the
 * discrimination, and neither is a round number: nothing a glyph row does reaches 0.95 (the
 * band with the densest glyph row in this file is 'Wave' at 0.596), and nothing a `fillRect`
 * does falls short of it. A renderer that drew its rules per glyph, or at the wrong weight,
 * would land between them.
 */
const glyphRowFillCeiling = 0.7;
const ruleRowFillFloor = 0.95;

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
 * the whole canvas captured and mapped onto the canvas box — the same capture the test
 * itself takes — the ink for `Hi` sits 9 / 9 / 343 / 67 CSS px inside the dragged
 * rectangle on left / top / right / bottom, identical on three consecutive runs.
 *
 * Left and top are BOTH the binding edge, at 9, so the margin has to stay BELOW that: at
 * 10 it would be the margin rather than a placement change that decided whether the run
 * went red, which is the same as no margin at all. 6 leaves 3px of cushion on the
 * tightest edges, and is still ~66x tighter than the rectangle is wide, so ink from
 * anywhere else on the canvas cannot pass on it.
 *
 * The cushion is 3px rather than the 5px the taller box this margin was first measured
 * against gave, because the element is height-limited here (scale 0.97167) and the glyphs
 * land smaller on screen. Widening the cushion by raising the margin would weaken the
 * assertion rather than stabilise it, so the margin stays at 6 and the thinner cushion is
 * recorded here as what it is. The capture that produced 9/9/343/67 is deterministic
 * here — three runs, identical to the pixel — so the exposure is to font and
 * device-pixel-ratio variation on another host, not to this one.
 */
const INK_MARGIN = 6;

/**
 * The clip the presence poll watches. Deliberately not load-bearing: it only has to be
 * wide enough to contain the glyphs wherever the font puts them, and wider than
 * `INK_MARGIN` so that a containment failure is reported by the four comparisons rather
 * than by this poll timing out on an empty region.
 *
 * It does NOT have to stay inside a viewport, and the reason it used to say so is gone:
 * there is no fold at 1280x720 to truncate anything (see `DRAFT_RECT` above). What is
 * still true is the mechanism — `waitForCanvasPixels` reads through `page.screenshot`
 * (`canvas-helpers.ts:531`) with the clip re-derived on every poll by `onScreenClip`
 * (`canvas-helpers.ts:529`), which is a no-op while the region is in view, so with zero
 * page overflow it is a no-op on every poll. Measured, the clip this margin produces is
 * page x 232..680, y 276..444: inside the 1280x720 page and inside the 974x583 canvas
 * box, with room over. The CDP capture below does not go through either, which is why
 * the two clips differ.
 */
const POLL_MARGIN = 24;

/**
 * The colour the Text tool paints with, which is the tool's OWN setting and not the store's
 * foreground.
 *
 * It used to be read the other way round: this constant was documented as "the colour the Text
 * toolbar paints with, read from the store's foreground", and the test drove it through the
 * sidebar's swatch. That was true until `a12e35c9` made `toolArgs.color` the tool's own setting —
 * `TextToolArea` dropped `color` from its store subscription and from the `renderText` call
 * (`src/components/Main/TextToolArea.tsx:15`, `:58`), and `Text.tsx` stopped mirroring the store's
 * foreground into the args on every render. The seed is still black (`src/tools/settings.ts:87`) and
 * `renderText` still reads `args.color` for `ctx.fillStyle` (`src/tools/text.ts:29`, `:48`), so the
 * text simply committed black. The swatch in the sidebar still turned red, which is what made this
 * look like a rendering failure rather than a stale control.
 *
 * Red is still the right choice, for the reason it was chosen: it is a colour nothing else on this
 * canvas is, so ink can be told apart from the black default and the blue selection outline.
 */
const TEXT_COLOR = '#ff0000';

/**
 * `createLayerSource` names a tool layer `${toolName} ${maxOrder}` after the tool that
 * produced it — the name is composed at `src/contexts/layer-utils.ts:181` from the `tool`
 * arm of `getNameFromSource` (`:155-164`, the return at `:162`) — and the blank document
 * layer the app starts with is order 1, so the first text layer over it is `text 2`.
 *
 * Asserted as a shape, not as that literal: the order suffix is `maxOrder`, which the
 * layers panel already covers, and pinning it in tests whose subject is a commit's
 * pixels or a Clear button means a rename in `layer-utils.ts` fails them for a reason
 * that has nothing to do with what they are about. Only the test that is about the layer
 * being a text layer at all asserts a name; the others assert row counts.
 */
const TOOL_LAYER_NAME = /^text \d+$/;

/**
 * The blank bedrock layer `src/App.tsx:20-25` creates on start, named `Blank` at
 * `src/contexts/layer-utils.ts:160` (the `'blank'` arm's return) with the order appended
 * by the same `:181` composition, which is why this constant carries the ` 1`.
 */
const STARTING_LAYER_NAME = 'Blank 1';

/**
 * Red, as a predicate. These are the constants `hasRedPixels` itself reads, so a pixel that
 * satisfies this one is the same pixel that helper would report: ink in any other colour cannot
 * match — the black default (`src/tools/settings.ts:87`), and the blue selection outline.
 *
 * The black default is worth naming twice over, because it is now the FAILURE colour as well as
 * the unconfigured one. If the colour written into `#text-color` ever stopped reaching the tool's
 * args, the text would commit black and this predicate would find nothing, so a broken colour path
 * is red on this file rather than silently green.
 */
const { RED_PIXEL_RED_MIN, RED_PIXEL_GREEN_MAX, RED_PIXEL_BLUE_MAX } = STROKE_ANALYSIS;
const isRedInk: PixelPredicate = (red, green, blue, alpha) =>
  alpha !== 0 && red > RED_PIXEL_RED_MIN && green < RED_PIXEL_GREEN_MAX && blue < RED_PIXEL_BLUE_MAX;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The dragged draft rectangle in page CSS coordinates, grown by `margin` on every side.
 *
 * `rect` defaults to `DRAFT_RECT` so the four tests that predate the style work call it with
 * two arguments and get the rectangle they were written about; the style tests pass
 * `SECOND_DRAFT_RECT` and get the same rule against the other rectangle, so there is one
 * derivation of "the rectangle plus its margin" rather than two.
 */
function draftRectCss(box: BoundingBox, margin: number, rect: DraftRect = DRAFT_RECT): Rect {
  return {
    left: box.x + rect.x1 - margin,
    top: box.y + rect.y1 - margin,
    right: box.x + rect.x2 + margin,
    bottom: box.y + rect.y2 + margin,
  };
}

function toClip(rect: Rect): { x: number; y: number; width: number; height: number } {
  return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
}

/**
 * The Type tool is a one-tool group in `toolbar-mapping.ts:107` (its group is the single
 * entry `[{ label: 'Horizontal Type Tool', name: 'text', shortcut: 'T' }]`), so it never
 * publishes a flyout of its own: a group only does when `group.length > 1`
 * (`SidebarLeft.tsx:446`). Whether it has a TILE is a different question, and at this viewport
 * the answer is no — the rail collapses trailing groups into the three-dots tile when they
 * would not fit (`SidebarLeft.tsx:80-111`), and Type is in the last section, so at 1280x720 it
 * is reached through the three-dots flyout. `clickToolButton` has a route for that, but it ends
 * in a click, and the click is the part that cannot work here.
 *
 * The three-dots menu is as tall as its contents — 31 items is 1254px against a 720px window —
 * and `AnchoredOverlay` clamps the overlay's POSITION, never its height
 * (`src/components/SidebarLeft/AnchoredOverlay.tsx:88-92`), so the Type entry renders at
 * y 975..1015, off-screen with no scrollbar to reach it. Playwright refuses to click it, and
 * correctly: nothing at that coordinate is there to click. The menu's own `onKeyDown` activates
 * the focused entry with Enter (`SidebarLeft.tsx:578-581`), which is the app's supported way to
 * pick an entry the pointer cannot reach, so that is the route below — and it holds at any
 * viewport, because focus does not require the entry to be on screen.
 */
async function selectTextTool(page: Page): Promise<void> {
  const tile = page.getByTestId('tool-button-text');
  if (await tile.count()) {
    await tile.click();
  } else {
    await page.getByTestId('tool-overflow-tile').click({ button: 'right' });
    const menu = page.getByTestId('tool-flyout-overflow');
    await expect(menu).toBeVisible();
    const item = page.getByTestId('tool-flyout-item-text-horizontal-type-tool');
    await expect(item).toBeAttached();
    await item.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
  }
  await expect(page.locator('#text-input'), 'the Text toolbar should be mounted').toBeVisible();
}

/**
 * `drawLine` is this suite's only pointer-drag primitive; it is named for the stroke it
 * was written for, and the Text tool reads the same down/move/up trio through the
 * `onPointerDown` / `onPointerUp` pair `useRect` spreads onto its tool area.
 *
 * `rect` defaults to `DRAFT_RECT`, so the four tests this file had before the style work call
 * it with two arguments and drag exactly the rectangle their assertions were written about.
 */
async function dragDraftRect(page: Page, box: BoundingBox, rect: DraftRect = DRAFT_RECT): Promise<void> {
  await drawLine(page, box, rect.x1, rect.y1, rect.x2, rect.y2, {
    steps: DRAFT_DRAG_STEPS,
  });
}

/**
 * Writes the colour through the control that owns it: the Text bar's own swatch,
 * `<input id="text-color" type="color">` (`src/components/ToolbarsRight/Text/Text.tsx:184`), whose
 * `onChange` is `handleColorChange` (`Text.tsx:79-81`) and which writes `toolArgs.color`. That is
 * the value `renderText` fills with (`src/tools/text.ts:29`, `:48`) and the value `applyText` commits
 * (`Text.tsx:100` passes the current `toolArgs` to `createLayerFromTool`), so this is the input whose
 * value the red pixels downstream are made of. It is also what a user touches: the swatch is in the
 * options bar, and `beforeEach` has already selected the Text tool, so it is mounted.
 *
 * A local copy of `setForegroundColor`'s injection rather than a call to it, because that helper is
 * pinned to the sidebar's two testids and generalising it means editing `e2e/helpers/color-helpers.ts`,
 * which is shared and owned elsewhere. What is copied is the part that is load-bearing: the native
 * `value` setter is taken off `HTMLInputElement.prototype` rather than assigned to `input.value`,
 * because React installs its own instance-level setter that keeps its value tracker in step, so the
 * assignment would leave `onChange` unfired and the colour would silently stay black.
 *
 * What the readback below does and does not prove. It DOES catch a value the input refused — a
 * colour input sanitises an invalid value to `#000000` rather than rejecting it, so a typo in
 * `TEXT_COLOR` fails here instead of 10s later as an unexplained missing-ink timeout. It does NOT
 * prove React state took the change, because it reads the same element it wrote: a change React
 * ignored would leave the DOM value alone and still read red. That case is caught by the ink
 * assertions, which is why a broken colour path goes red here instead of passing quietly.
 */
async function setTextToolColor(page: Page, hex: string): Promise<void> {
  await page.evaluate((color) => {
    const input = document.querySelector<HTMLInputElement>('#text-color');
    if (!(input instanceof window.HTMLInputElement)) {
      throw new Error('setTextToolColor: no HTMLInputElement matched #text-color; is the Text toolbar mounted?');
    }
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (!descriptor || !descriptor.set) {
      throw new Error('Native value setter not found on HTMLInputElement.prototype');
    }
    descriptor.set.call(input, color);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);

  await expect(page.locator('#text-color'), "the Text bar's own swatch did not take the colour under test").toHaveValue(
    hex
  );
}

/**
 * Re-reads the canvas box, after the tool is selected, and checks its width against the shell.
 *
 * Every test in this file calls this AFTER `selectTextTool` has run, which is the only
 * order that makes a stale box possible: the draft drag is expressed in canvas-box
 * coordinates, so a box read before the tool click would address different pixels if the
 * click reflowed the workspace. Measured, it does not — the box is the same size before and
 * after selecting the Text tool, because the tool's options mount in the RIGHT sidebar and the
 * left rail scrolls inside its own box. So this re-read is not load-bearing for the tool click;
 * it is here so that a reflow which did change the box could not make the drag quietly address
 * a different pixel, and it is the reason nothing here caches a box across the tool click.
 *
 * The width assertion is the other half. `DRAFT_RECT` is box-relative and so never pins an
 * absolute width, which means a rail that changed width would move the drag to a different part
 * of the document and every test here would still pass — that is exactly what happened when the
 * default column count changed and this file's comments kept claiming 922. Deriving the expected
 * width from the rail actually on screen is what turns the assumption into something a change
 * has to answer for.
 */
async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('text-tool: workspace canvas has no visible coordinates');
  expect(Math.round(box.width), 'the canvas box is the 1fr track between the measured rail and the right panel').toBe(
    await expectedCanvasWidth(page)
  );
  return box;
}

/**
 * The crop of a capture a measurement is scanned from: the box-relative rectangle grown by
 * `STYLE_CROP_PAD` on every side, expressed in the CAPTURE's own pixels.
 *
 * The scale is derived from the decoded image rather than from `devicePixelRatio`, for the
 * reason `imageBoundsToCss` documents: CDP captures at Chrome's surface scale, which is not
 * the emulated ratio, and the committed-ink test's four capture assertions exist to keep a
 * caller from assuming otherwise. The clamp to the image is the same fact applied: a crop that
 * ran off the edge of the capture would slice out of range, and the numbers would be silently
 * short rather than loud.
 */
function cropWindow(
  image: ImageDataResult,
  box: BoundingBox,
  rect: DraftRect
): { left: number; top: number; width: number; height: number } {
  const scaleX = image.width / box.width;
  const scaleY = image.height / box.height;
  const left = Math.max(0, Math.floor((rect.x1 - STYLE_CROP_PAD) * scaleX));
  const top = Math.max(0, Math.floor((rect.y1 - STYLE_CROP_PAD) * scaleY));
  const right = Math.min(image.width, Math.ceil((rect.x2 + STYLE_CROP_PAD) * scaleX));
  const bottom = Math.min(image.height, Math.ceil((rect.y2 + STYLE_CROP_PAD) * scaleY));
  return { left, top, width: right - left, height: bottom - top };
}

/** A rectangular slice of a capture, as an `ImageDataResult` the shared scanner can read. */
function cropImage(image: ImageDataResult, window: { left: number; top: number; width: number; height: number }) {
  const { left, top, width, height } = window;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((top + row) * image.width + left) * 4;
    data.set(image.data.subarray(start, start + width * 4), row * width * 4);
  }
  return { width, height, data };
}

/**
 * What one row of a crop carries: how many pixels matched, and where the first and last of
 * them were.
 *
 * The pair is the measurement a decoration turns on. A glyph row is mostly gaps — the space
 * between letters, the counter inside an `A`, the two valleys of a `W` — so its count is well
 * short of its own span. A rule drawn with `fillRect` across the line's measured ink width is
 * one unbroken run, so its count IS its span. `count / span` therefore separates "a
 * decoration was drawn here" from "a letter happened to be dense at this row" without
 * naming a font, a size, or a capture resolution: all three cancel in the ratio.
 *
 * `left` and `right` are the crop's own columns, and the gap between the first and last
 * occupied ROWS of a leaning band is what a slant is: a rightward lean starts further right at
 * the top than at the bottom, an upright band starts at the same column in both.
 */
interface RowInk {
  count: number;
  span: number;
  left: number;
  right: number;
}

/** Per-row ink profile of a crop, in the crop's own pixels. Row 0 is its top row. */
function rowInkProfile(image: ImageDataResult, predicate: PixelPredicate): RowInk[] {
  const rows: RowInk[] = [];
  for (let y = 0; y < image.height; y++) {
    let count = 0;
    let left = -1;
    let right = -1;
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      if (!predicate(image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3])) {
        continue;
      }
      count++;
      if (left < 0) left = x;
      right = x;
    }
    rows.push({ count, span: count === 0 ? 0 : right - left + 1, left, right });
  }
  return rows;
}

/** The fullest row in a profile, and the fill ratio that decides whether it is a solid run. */
function fullestRow(rows: RowInk[]): { index: number; count: number; span: number; fill: number } {
  let best = { index: -1, count: 0, span: 0, fill: 0 };
  rows.forEach((row, index) => {
    const fill = row.span === 0 ? 0 : row.count / row.span;
    if (row.count > best.count) best = { index, count: row.count, span: row.span, fill };
  });
  return best;
}

/**
 * The first and the last row of a profile that carry any ink, and where each starts.
 *
 * The lean of a band is the difference between the two `left` figures: a rightward slant
 * carries its top rows to the right of its bottom rows, an upright one starts both at the
 * same column. It is a statement about the SHAPE of the band rather than about its metrics,
 * which is why it survives a font whose italic happens to share the upright's advances — a
 * width comparison does not, and Arial's nearly does.
 */
function bandEnds(rows: RowInk[]): {
  firstRow: number;
  lastRow: number;
  firstLeft: number;
  lastLeft: number;
  lean: number;
} {
  let firstRow = -1;
  let lastRow = -1;
  let firstLeft = 0;
  let lastLeft = 0;
  rows.forEach((row, index) => {
    if (row.count === 0) return;
    if (firstRow < 0) {
      firstRow = index;
      firstLeft = row.left;
    }
    lastRow = index;
    lastLeft = row.left;
  });
  return { firstRow, lastRow, firstLeft, lastLeft, lean: firstRow < 0 ? 0 : lastLeft - firstLeft };
}

/**
 * One commit's ink, measured: where it is in page CSS, how big it is, and what its rows carry.
 *
 * `css` comes from `imageBoundsToCss` against the WHOLE canvas box, not against the crop, so
 * the numbers are page coordinates that can be compared with `draftRectCss` and with the other
 * commit's — the crop only decides which pixels were eligible to be found.
 */
interface InkMeasurement {
  css: CssBounds;
  width: number;
  height: number;
  /**
   * How far inside its OWN rectangle the ink sits, per edge, positive meaning inside. This is
   * the figure that compares two commits against each other: `css` is in page coordinates, so
   * two commits in two different rectangles are two different page positions and subtracting
   * them would measure the rectangles rather than the text.
   */
  inset: { left: number; top: number; right: number; bottom: number };
  /** Red pixels in the crop, a raw image count. Used only against another count of the same capture shape. */
  pixelCount: number;
  fullest: ReturnType<typeof fullestRow>;
  ends: ReturnType<typeof bandEnds>;
  /** The crop the scan was taken from, in CAPTURE pixels. */
  window: { left: number; top: number; width: number; height: number };
  /** Device pixels per CSS pixel on each axis of the capture, which is what makes the two comparable. */
  scale: { x: number; y: number };
}

/**
 * Waits for red ink in a rectangle, then measures it.
 *
 * The wait is the same `waitForCanvasPixels` the committed-ink test uses, over a clip grown by
 * `POLL_MARGIN` because that clip is deliberately non-load-bearing: it only has to be wide
 * enough to hold the glyphs wherever the font puts them, so a containment failure is reported
 * by the comparisons and not by this poll timing out on an empty region. Without it the
 * capture below would race the composite, and a capture that lands early reads as an empty
 * crop — a measurement of nothing, which is the one answer a measurement must never give.
 *
 * This measures a commit whose ink belongs to the rectangle it was dragged in, which is not
 * true of every commit: a commit at the font size maximum paints a band covering a third of
 * the document, well outside any crop of the rectangle, and that one test scans the whole
 * canvas instead — for the reason its own comment gives.
 */
async function measureInk(
  page: Page,
  testInfo: TestInfo,
  box: BoundingBox,
  rect: DraftRect,
  name: string
): Promise<InkMeasurement> {
  await waitForCanvasPixels(page, toClip(draftRectCss(box, POLL_MARGIN, rect)), hasRedPixels, {
    description: `red text pixels in the ${name} rectangle`,
  });

  const capture = await captureCanvasScreenshot(page, box, testInfo, name);
  const image = await loadImageData(capture);
  const window = cropWindow(image, box, rect);
  const crop = cropImage(image, window);
  const ink = await scanPixelsForBounds(crop, isRedInk);
  expect(ink.found, `no red pixels in the ${name} rectangle after Apply`).toBe(true);

  // The scan ran on the CROP, so its bounds are the crop's own columns and rows. They are
  // carried back onto the full capture before being mapped onto the box, because
  // `imageBoundsToCss` maps whatever indices it is given as if they were the capture's. Mapped
  // straight from the crop, every number below would be scaled by the crop's share of the
  // canvas — a 480x200 window out of 974x583 is 1.9x on the rows — and the four containment
  // comparisons would be checking a rectangle that is nowhere near the one that was dragged.
  const css = imageBoundsToCss({ width: image.width, height: image.height }, box, {
    left: window.left + ink.left,
    top: window.top + ink.top,
    right: window.left + ink.right,
    bottom: window.top + ink.bottom,
  });
  const rows = rowInkProfile(crop, isRedInk);
  return {
    css,
    width: css.right - css.left,
    height: css.bottom - css.top,
    inset: {
      left: css.left - (box.x + rect.x1),
      top: css.top - (box.y + rect.y1),
      right: box.x + rect.x2 - css.right,
      bottom: box.y + rect.y2 - css.bottom,
    },
    pixelCount: rows.reduce((total, row) => total + row.count, 0),
    fullest: fullestRow(rows),
    ends: bandEnds(rows),
    window,
    scale: { x: image.width / box.width, y: image.height / box.height },
  };
}

/**
 * The four containment comparisons, run against whichever rectangle was dragged, and the
 * tripwire that says they can fail.
 *
 * The same four the committed-ink test makes, kept as one function so the style tests inherit
 * the assertion that a rendering change has to keep satisfying rather than re-deriving a
 * looser version of it. `expect.soft` for the same reason: a run that gets three of the four
 * edges wrong is more informative than one that stops at the first.
 *
 * The tripwire is the committed-ink test's, restated in the terms these measurements have. A
 * capture no larger than the rectangle it is checked against cannot fail, because the pixels
 * outside it were never in the image — so the crop is compared against the region actually
 * being asserted, which is the rectangle plus `INK_MARGIN`. The crop is 40px of margin where
 * the assertion allows 6, so the two are 34px apart on every side; if this ever goes off, widen
 * the capture rather than narrow the margin.
 */
function expectInkInsideRect(measurement: InkMeasurement, box: BoundingBox, rect: DraftRect, label: string) {
  const allowed = draftRectCss(box, INK_MARGIN, rect);
  const { css } = measurement;
  // Both figures in CSS px, the crop's by dividing out the capture's own scale rather than by
  // `devicePixelRatio` — the reason `imageBoundsToCss` documents, and the reason the
  // committed-ink test pins the capture's scale separately.
  expect(
    measurement.window.width / measurement.scale.x,
    `${label}: the capture is not larger than the rectangle it is checked against`
  ).toBeGreaterThan(allowed.right - allowed.left);
  expect.soft(css.left, `${label}: ink escaped the left of the dragged rectangle`).toBeGreaterThanOrEqual(allowed.left);
  expect.soft(css.top, `${label}: ink escaped the top of the dragged rectangle`).toBeGreaterThanOrEqual(allowed.top);
  expect.soft(css.right, `${label}: ink escaped the right of the dragged rectangle`).toBeLessThanOrEqual(allowed.right);
  expect
    .soft(css.bottom, `${label}: ink escaped the bottom of the dragged rectangle`)
    .toBeLessThanOrEqual(allowed.bottom);
}

/**
 * The three rectangles the caps test commits into, top to bottom.
 *
 * They are separate from `DRAFT_RECT` and `SECOND_DRAFT_RECT` because this is the one test
 * that needs THREE commits, and three 120-tall rectangles with the 40px isolation the crops
 * require do not fit beside the pair those two already occupy — 3 x 120 + 2 x 40 = 440 rows,
 * which fits the 583-row box only from near its top.
 *
 * The isolation arithmetic, because it is what makes each crop hold exactly one commit. With
 * the ink measured 17 rows below a rectangle's top and 59 rows above its bottom (the numbers
 * every measurement in this file agrees on), a crop that reaches `rect.y2 + 40` cannot reach
 * the next commit's ink as long as `next.y1 + 17 > y2 + 40`, i.e. as long as the gap between
 * two rectangles is more than 23 rows. The gap here is 40, so each crop has 17 rows of
 * daylight above the next commit's ink — and the assertion is not that the daylight exists but
 * that the two measurements do not share a row, which is what would happen if a crop ever did
 * reach its neighbour.
 */
const CAPS_RECTS: { plain: DraftRect; allCaps: DraftRect; smallCaps: DraftRect } = {
  plain: { x1: 200, y1: 60, x2: 600, y2: 180 },
  allCaps: { x1: 200, y1: 220, x2: 600, y2: 340 },
  smallCaps: { x1: 200, y1: 380, x2: 600, y2: 500 },
};

/**
 * Commits the same string once per variant into ONE document and measures every commit against
 * its own rectangle.
 *
 * `variants[0]` is the baseline: whatever style the test set up before calling is already in
 * the tool's args, and the first commit is made with `variants[0].apply` NOT run. Every later
 * entry runs its `apply` after its own drag and before its text is typed — the order a user
 * works in, and the order the app's `publishStyle` is written for, since typing calls
 * `calculateNewRect` with the style already in `toolArgs` and commits the box the styled text
 * was measured against (`Text.tsx:45-48`).
 *
 * One document rather than one page per variant, because the styles are the tool's OWN
 * settings and they persist: a second `page.goto` would not reset them, so a test that wanted
 * the unstyled rendering measured after the styled one would have to clear every toggle by
 * hand and would silently compare against whatever it failed to clear.
 */
async function commitStyledSeries(
  page: Page,
  testInfo: TestInfo,
  box: BoundingBox,
  text: string,
  variants: { name: string; rect: DraftRect; apply: () => Promise<void> }[]
): Promise<InkMeasurement[]> {
  const input = page.locator('#text-input');
  const apply = page.getByRole('button', { name: 'Apply' });

  await setTextToolColor(page, TEXT_COLOR);
  const measured: InkMeasurement[] = [];
  for (const [index, variant] of variants.entries()) {
    await dragDraftRect(page, box, variant.rect);
    if (index > 0) await variant.apply();
    await input.fill(text);
    await apply.click();
    measured.push(await measureInk(page, testInfo, box, variant.rect, variant.name));
  }
  return measured;
}

/**
 * A toggle in the options bar, addressed the way a screen reader finds it.
 *
 * The accessible name is the point: these six buttons are labelled `Bold`, `Italic`, `All
 * Caps`, `Small Caps`, `Underline` and `Strikethrough` because the glyph inside them — a `B`,
 * an `I`, an `Aa` — tells a screen reader nothing (`Text.tsx:243-248`). Addressing them by
 * `#text-bold` would pass whether or not that label existed, so it is not what the style tests
 * click.
 */
function styleToggle(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true });
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

    // A rectangle on its own does not enable it. Something has to make this half mean
    // more than "the drag never registered, and the gate is still closed for that
    // reason", and this wait is it: the live draft rectangle `useRect` paints as it drags
    // (`src/hooks/useRect.ts:178-233` — the stroke at `:210-214` in `#007bff`, the four
    // handles at `:218-224`), which is inside `getSelectionBounds`' thresholds, puts
    // selection-blue pixels in the dragged region, so the wait fails if the pointer events
    // never reached the tool area. The wait clip is grown by `INK_MARGIN` so a partially
    // drawn outline is not read as a missing one.
    //
    // What it does NOT prove, stated because it is easy to assume: that the rectangle was
    // COMMITTED. The stroke above is painted on every pointer-move, before the drag ends,
    // so it is satisfied by the live draft alone. Measured: neutering the outline (stroke
    // and handles) leaves this wait green, and so does skipping the `onChangeEnd` call at
    // `useRect.ts:430` — the live draft satisfies the wait in both cases.
    //
    // What DOES prove the drag committed is the pixel test's four comparisons, and it is
    // worth saying how, because it is indirect and was measured rather than assumed.
    // Disabling that `onChangeEnd` call leaves the tool's `rect` null, so the same
    // `calculateNewRect` substitution described below manufactures the origin rect, the
    // commit lands at the canvas's top-left corner, and the ink-containment test goes red
    // on `ink escaped the left of the dragged rectangle`. So a drag that commits nothing
    // cannot pass this file — just not at the line a reader would guess.
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

    // Text is what lifts it. Typed after the drag, never instead of it.
    //
    // WHY THE ORDER MATTERS, and it is a KNOWN BUG, not a stylistic choice. The Apply
    // button is gated on `disabled={!text || !rect}` (`Text.tsx:210`), so `rect` being
    // non-null is half the gate — but `rect` is never allowed to be null once text exists.
    // `calculateNewRect` opens with `const rect = newArgs.rect ?? { x1: 0, y1: 0, x2: 0, y2: 0 }`
    // (`src/util/rect.ts:123`), and `handleTextChange` (`Text.tsx:37-42`) calls exactly that
    // on every keystroke. So typing with NO rectangle dragged manufactures a degenerate rect
    // at the origin, `!rect` is unreachable from this toolbar at all today, and Apply enables
    // on text alone — committing ink at (0,0). That is the open problem recorded in
    // `e2e/OPEN_PROBLEMS.md`, and a test that typed without a drag would PIN that behaviour
    // rather than catch it.
    //
    // Verified against the fix that entry asks for, because the order above is only worth
    // anything if it survives it: with `rect.ts:123` no longer substituting the placeholder,
    // `!rect` becomes reachable and the gate is a real gate, and all four tests in this file
    // stay green — every one of them drags before it types, so none of them depends on the
    // bug.
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

    // The colour goes in through the Text bar's own swatch, because that is what a user edits and
    // what the commit reads. It used to go in through the sidebar's foreground swatch instead, and
    // that stopped working when `a12e35c9` moved `toolArgs.color` off the store — see TEXT_COLOR.
    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box);
    await input.fill('Hi');
    await apply.click();

    // The commit empties the draft (`Text.tsx:86`). That is what makes the pixel read
    // below a statement about the document rather than about the live preview: while the
    // draft is non-empty the tool overlay repaints the same glyphs on every keystroke
    // (`TextToolArea.tsx:45-49` -> `redrawText` at `:51` -> `renderText`), so red pixels on screen
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
    // (`cdp-helpers.ts:67-72`); no clip is passed here, so the fallback IS the capture.
    const capture = await captureCanvasScreenshot(page, box, testInfo, 'text-committed');
    const image = await loadImageData(capture);
    const ink = await scanPixelsForBounds(image, isRedInk);
    expect(ink.found, 'no red pixels anywhere on the canvas after Apply').toBe(true);

    // The capture really is the whole canvas box and not a clipped fragment of it, since
    // the mapping below divides by this box's extent.
    //
    // The property asserted is the one that holds in every mode: the capture is exactly
    // the requested rect at one integral scale shared by both axes. It is deliberately
    // NOT `image.width === box.width * devicePixelRatio`. CDP's `Page.captureScreenshot`
    // bypasses Playwright's device emulation and captures at Chrome's own surface
    // scale, so the emulated ratio and the capture scale are not the same quantity.
    // The two modes that expose it are named here because "it is wrong" is not
    // reproducible without them: at an emulated `deviceScaleFactor: 2` CDP stayed at 1x
    // while `window.devicePixelRatio` reported 2, and headed on a HiDPI host CDP was 2x
    // while the ratio reported 1. Both make the DPR form red for a capture that is
    // correct, which is what `getDevicePixelRatio` was deleted for. See
    // `cdp-helpers.spec.ts` for the same measurement and `playwright.config.ts` for the
    // headed/headless split.
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

  /**
   * The six style toggles, and what their state is FOR.
   *
   * This is the cheap DOM-level half of the style coverage, and it is here because the pixel
   * tests below cannot see the state at all: every one of them reads a committed layer, by
   * which point the toggle has done its work and nothing on the canvas says whether the button
   * is still pressed. What makes this worth asserting is that `aria-pressed` is the ONLY
   * statement of state the control makes. The class list (`TOGGLE_BUTTON_ACTIVE`) is how the
   * state is shown to a sighted user and it is not an interface, so a bar that painted all six
   * as active would look correct, pass every pixel test in this file, and be wrong to a screen
   * reader. Independence is therefore the assertion, not the individual flip: one toggle
   * moving the others is the failure this catches.
   */
  test('the style toggles expose an accessible name and their state through aria-pressed', async ({ page }) => {
    const toggles = [
      { name: 'Bold', id: '#text-bold' },
      { name: 'Italic', id: '#text-italic' },
      { name: 'All Caps', id: '#text-all-caps' },
      { name: 'Small Caps', id: '#text-small-caps' },
      { name: 'Underline', id: '#text-underline' },
      { name: 'Strikethrough', id: '#text-strikethrough' },
    ];

    // The control the renderer reads is the control the accessible name finds, so the two are
    // asserted to be the same element. Checking the name on the id catches a label that moved
    // onto a wrapper or onto a sibling button, which `getByRole` alone would report as "no
    // such control" further down with a much less useful message.
    for (const toggle of toggles) {
      await expect(page.locator(toggle.id), `${toggle.id} carries the accessible name`).toHaveAttribute(
        'aria-label',
        toggle.name
      );
    }

    // No rectangle has been dragged at this point, so every click here runs `publishStyle`
    // with `rect` null — `calculateNewRect` returns null for that (`src/util/rect.ts:129`) and
    // the bar falls back to the rect it had. ConsolePolice is what turns a throw or a React
    // warning on that path into a red run.
    for (const toggle of toggles) {
      const button = styleToggle(page, toggle.name);
      await expect(button, `${toggle.name} starts unpressed`).toHaveAttribute('aria-pressed', 'false');

      await button.click();
      await expect(button, `${toggle.name} did not report itself pressed`).toHaveAttribute('aria-pressed', 'true');

      for (const other of toggles.filter((candidate) => candidate.name !== toggle.name)) {
        await expect(
          styleToggle(page, other.name),
          `${other.name} moved when ${toggle.name} was pressed`
        ).toHaveAttribute('aria-pressed', 'false');
      }

      await button.click();
      await expect(button, `${toggle.name} did not clear`).toHaveAttribute('aria-pressed', 'false');
    }
  });

  /**
   * Bold and Italic change the GLYPHS. This is a regression test, and the defect it pins is
   * worth stating because the old code passed a weaker version of it.
   *
   * `fontShorthand` used to build `ctx.font` as `${italic}${bold}${size}px ${family}`, which
   * for the two toggles produced strings like `64px bold Arial`. The CSS font shorthand
   * requires style and weight BEFORE the size, so the grammar reads `64px` as the size, finds
   * `bold` where a family name belongs and rejects the whole declaration. Chrome does not
   * throw on a rejected `ctx.font`: it silently keeps the PREVIOUS font. Measured on this
   * host, `64px bold Arial` and `64px italic Arial` rendered pixel-identically to the serif
   * fallback — so the two buttons swapped the typeface and the assertion that passed was a
   * caption saying a serif fallback, which is a description of the bug.
   *
   * What replaces it: the two commits below are measured against each other, and the old
   * behaviour fails every comparison in both tests because it made the two renders identical.
   */
  test('Bold weights the glyphs instead of swapping the typeface', async ({ page }, testInfo) => {
    const box = await canvasBox(page);
    // The string is chosen off the measurement, not off taste. Bold widens a glyph by however
    // much wider its stems are, and in Arial that varies enormously by letter: 'WAVE' goes
    // 171 -> 175 CSS px (+2.3%), because W and V barely change, while 'Mild' goes 105 -> 116
    // (+10.5%) on 'i', 'l' and 'd'. A width assertion written against 'WAVE' would have been a
    // four-pixel claim with a zero-pixel margin, which is a coin flip on another host; against
    // 'Mild' the same assertion has eleven pixels of room.
    const [plain, bold] = await commitStyledSeries(page, testInfo, box, 'Mild', [
      { name: 'text-unweighted', rect: DRAFT_RECT, apply: async () => undefined },
      { name: 'text-weighted', rect: SECOND_DRAFT_RECT, apply: async () => styleToggle(page, 'Bold').click() },
    ]);

    // Measured on this host, same capture and the same 1:1 scale for both:
    //   unweighted  105 x 44 CSS px, 2034 red pixels, fullest row 59 in a span of 106 (0.557)
    //   bold        116 x 44 CSS px, 3023 red pixels, fullest row 81 in a span of 117 (0.692)
    // The width ratio is asserted at 1.05 against a measured 1.105.
    expect(bold.width, 'bold did not widen the ink').toBeGreaterThan(plain.width * 1.05);
    // The count is the half with the real margin: a weight change is a STEM change, and 1.49x
    // the ink is what that looks like. It is a raw capture-pixel count, so it is only ever
    // compared against another count taken from the same-shaped crop of the same canvas.
    expect(bold.pixelCount, 'bold did not put down more ink').toBeGreaterThan(plain.pixelCount * 1.3);
    // Shape, not just mass: the fullest row of a band is fuller when its stems are thicker.
    // Every undecorated band in this file measures between 0.44 and 0.60 here, because a glyph
    // row is mostly gaps — the counter in an 'A', the valleys of an 'M' — so 0.7 is a real
    // bound on "no glyph row fills its own span" rather than a round number.
    expect(
      plain.fullest.fill,
      'a glyph row filled its whole span, so the count above proves nothing'
    ).toBeLessThanOrEqual(0.7);
    expect(bold.fullest.fill, 'the bold band is not denser row-for-row').toBeGreaterThan(plain.fullest.fill);
    // The height is the control: a weight change must not move the band vertically, so a
    // difference here would mean the two commits were not measuring the same thing.
    expect(Math.abs(bold.height - plain.height), 'the band changed height').toBeLessThanOrEqual(1);

    expectInkInsideRect(plain, box, DRAFT_RECT, 'the unweighted commit');
    expectInkInsideRect(bold, box, SECOND_DRAFT_RECT, 'the bold commit');
  });

  test('Italic leans the band instead of swapping the typeface', async ({ page }, testInfo) => {
    const box = await canvasBox(page);
    const [plain, italic] = await commitStyledSeries(page, testInfo, box, 'Mild', [
      { name: 'text-upright', rect: DRAFT_RECT, apply: async () => undefined },
      { name: 'text-leaning', rect: SECOND_DRAFT_RECT, apply: async () => styleToggle(page, 'Italic').click() },
    ]);

    // A width comparison is NOT the discriminator for italic, and the measurement says why:
    // Arial's italic is a separate font whose advances barely differ from the upright's, so
    // 'Mild' goes 105 -> 113 CSS px on width (+7.6%, asserted at 1.02 so that a face whose
    // advances are identical still has a margin) and 2034 -> 2042 red pixels (+0.4%). The ink
    // COUNT is the same story — an oblique face of the same weight puts down the same ink.
    //
    // What does separate them is the SHAPE of the band, and it is measured from the row
    // profile: `ends.lean` is how far to the right the band's BOTTOM row starts relative to
    // its TOP row. A rightward lean carries its top rows rightward, so the lean goes negative;
    // an upright band starts both at the same column. Measured here, the upright 'Mild' runs
    // from column 46 at the top to 47 at the bottom (lean +1, i.e. level within a pixel of
    // rasterisation) and the italic from 55 to 46 (lean -9, the M's top overhanging its foot).
    expect(
      plain.ends.lean,
      'the upright band leans, so the comparison below is measuring the font'
    ).toBeGreaterThanOrEqual(-1);
    // Asserted at -4 against a measured -9, which is 0.14em of overhang at 64px. This is the
    // comparison carrying the test; the width below is the loose half.
    expect(italic.ends.lean, 'the italic band does not lean').toBeLessThanOrEqual(-4);
    expect(italic.width, 'the italic face did not even change the advance').toBeGreaterThan(plain.width * 1.02);
    expect(Math.abs(italic.height - plain.height), 'the band changed height').toBeLessThanOrEqual(1);

    // A slant carries the band's TOP rows rightward while its feet stay put, so the topmost
    // ink row starts further right than the upright band's does: measured column 46 upright
    // and 55 italic in their own crops, a 9px move. It is a second reading of the same
    // overhang, and it is the one that survives a font whose italic has a different left side
    // bearing from its upright — the band's own left edge does not move at all for 'Mild'
    // (measured 262 page x either way), because the foot of the slanted 'M' lands where the
    // upright one's does.
    expect(
      italic.ends.firstLeft - plain.ends.firstLeft,
      'the leaning band did not overhang to the right'
    ).toBeGreaterThanOrEqual(5);

    expectInkInsideRect(plain, box, DRAFT_RECT, 'the upright commit');
    expectInkInsideRect(italic, box, SECOND_DRAFT_RECT, 'the italic commit');
  });

  /**
   * Tracking is the assertion with the most teeth in this file, because it is the one control
   * whose effect is a pure function of a number: more tracking, more ink, and the relationship
   * is stated in the unit Adobe states it in.
   *
   * `trackingPx` is `(tracking / 1000) * fontSize`, so 400 at 64px is 25.6 CSS px added to
   * every inter-glyph gap. 'WAVE' has three of them, so the band should grow by 76.8 px — and
   * it does, which is what makes the ratio below a statement about tracking rather than about
   * the font.
   */
  test('Tracking widens the ink and keeps it inside the dragged rectangle', async ({ page }, testInfo) => {
    const box = await canvasBox(page);
    const [plain, tracked] = await commitStyledSeries(page, testInfo, box, 'WAVE', [
      { name: 'text-untracked', rect: DRAFT_RECT, apply: async () => undefined },
      {
        name: 'text-tracked',
        rect: SECOND_DRAFT_RECT,
        apply: async () => page.locator('#tracking-slider').fill('400'),
      },
    ]);

    // Measured: 171 CSS px wide untracked, 246 tracked (+43.9%), and the right edge moves
    // from page x 430 to 506 — 76px, against the 76.8 the arithmetic above predicts. The
    // threshold is 1.3 against a measured 1.44.
    expect(tracked.width, 'tracking did not widen the ink').toBeGreaterThan(plain.width * 1.3);
    // Tracking is spacing, not weight: measured 2809 red pixels untracked and 2864 tracked,
    // +2%. The same four letters with the same stems are still there, further apart.
    expect(tracked.pixelCount, 'tracking changed the amount of ink, not only its extent').toBeLessThan(
      plain.pixelCount * 1.1
    );
    // The LEFT edge is the part that makes it inter-glyph spacing rather than a shift or a
    // leading gap: `letterSpacing` adds to every character's advance INCLUDING the last one, so
    // the first glyph does not move (`src/tools/text.ts:235-236`). Measured 259 -> 260 page x, one pixel of antialiasing, so
    // the bound is 2.
    expect(Math.abs(tracked.inset.left - plain.inset.left), 'tracking moved the first glyph').toBeLessThanOrEqual(2);
    // The band is not resized vertically by horizontal spacing.
    expect(Math.abs(tracked.height - plain.height), 'tracking changed the band height').toBeLessThanOrEqual(1);

    // The containment check is what makes this a placement test rather than a width test. The
    // tracked band is 246 CSS px inside a 400px rectangle, so it fits — but only because
    // `calculateNewRect` grows the committed rectangle to the measured text when the text
    // outgrows the dragged one (`src/util/rect.ts:145-160`), and only because 246 + 2 x
    // TEXT_PADDING is still under the 402px that was dragged. A tracking value far enough
    // right would push the text past the rectangle's right edge, and these four comparisons are
    // what would report it.
    expectInkInsideRect(plain, box, DRAFT_RECT, 'the untracked commit');
    expectInkInsideRect(tracked, box, SECOND_DRAFT_RECT, 'the tracked commit');
  });

  test('Underline adds a solid run of ink below the glyph band', async ({ page }, testInfo) => {
    const box = await canvasBox(page);
    const [plain, underlined] = await commitStyledSeries(page, testInfo, box, 'WAVE', [
      { name: 'text-not-underlined', rect: DRAFT_RECT, apply: async () => undefined },
      {
        name: 'text-underlined',
        rect: SECOND_DRAFT_RECT,
        apply: async () => styleToggle(page, 'Underline').click(),
      },
    ]);

    // WHERE the run is, not merely that there is one. The renderer puts the rule at
    // `UNDERLINE_BELOW_BASELINE_EM * fontSize` below the baseline (`src/tools/text.ts:300`,
    // `:322-324`), and the baseline is the bottom of a band with no descenders, so the rule
    // must land BELOW the undecorated band's last row rather than inside it. Measured: the
    // undecorated band occupies rows 57..101 of its crop and the underlined one 57..108, with
    // the solid run at row 106.
    expect(underlined.fullest.index, 'the underline did not land below the glyph band').toBeGreaterThan(
      plain.ends.lastRow
    );
    // And the band really is taller for it: 7 rows, and 7 CSS px of clearance from the
    // rectangle's bottom edge given away (59 -> 52). Asserted at 5 against a measured 7.
    expect(underlined.ends.lastRow - plain.ends.lastRow, 'the underline added no rows').toBeGreaterThanOrEqual(5);
    expect(
      plain.inset.bottom - underlined.inset.bottom,
      'the underline did not reach further down'
    ).toBeGreaterThanOrEqual(5);

    // The run is a rule and not a dense letter.
    expect(underlined.fullest.fill, 'the rule is not a solid run').toBeGreaterThanOrEqual(ruleRowFillFloor);
    expect(
      plain.fullest.fill,
      'a glyph row filled its whole span, so the run above proves nothing'
    ).toBeLessThanOrEqual(glyphRowFillCeiling);
    // The rule is drawn across the line's measured INK WIDTH, so it reaches past the last
    // glyph's own right edge by that glyph's right side bearing — measured 5 CSS px further
    // right than the glyphs' ink for Arial's 'E', and 1px further right at the left, where the
    // rule starts at the line's origin and the 'W' does not. `inset` is a distance INSIDE the
    // rectangle, so reaching further right makes it SMALLER: the subtraction runs the other way
    // from the comparisons above for that reason, and the sign is the whole assertion.
    expect(plain.inset.right - underlined.inset.right, 'the rule did not reach the line width').toBeGreaterThanOrEqual(
      3
    );
    expect(
      underlined.inset.left - plain.inset.left,
      'the rule did not start at the line origin'
    ).toBeGreaterThanOrEqual(0);

    // The rule is 4 CSS px thick at 64px (`decorationThickness` is `fontSize / 16`, rounded) and
    // sits 0.1em below the baseline, which is 6.4px — so the deepest ink is inside the
    // rectangle the user dragged rather than below it.
    expectInkInsideRect(plain, box, DRAFT_RECT, 'the undecorated commit');
    expectInkInsideRect(underlined, box, SECOND_DRAFT_RECT, 'the underlined commit');
  });

  test('Strikethrough adds a solid run through the glyph band', async ({ page }, testInfo) => {
    const box = await canvasBox(page);
    const [plain, struck] = await commitStyledSeries(page, testInfo, box, 'WAVE', [
      { name: 'text-not-struck', rect: DRAFT_RECT, apply: async () => undefined },
      {
        name: 'text-struck',
        rect: SECOND_DRAFT_RECT,
        apply: async () => styleToggle(page, 'Strikethrough').click(),
      },
    ]);

    // The mirror image of the underline, and the reason these are two tests: the renderer puts
    // the strikethrough at `baseline - xHeightHalf` (`src/tools/text.ts:301`, `:325-327`),
    // which is INSIDE the glyph band — through the middle of the letters, not below them. So
    // the run's row has to be strictly between the band's first and last rows. Measured: the
    // undecorated band runs rows 57..101 of its crop and the solid run's TOP row is 83, i.e. 18
    // rows above the baseline the band sits on. That is the x-height's half (0.518em / 2 =
    // 16.6 CSS px at 64px) plus half the rule's 4px thickness, which is where
    // `Math.round(baseline - strikeAbove - thickness / 2)` puts the rule's first row.
    expect(struck.fullest.index, 'the strikethrough is not inside the glyph band').toBeGreaterThan(plain.ends.firstRow);
    expect(struck.fullest.index, 'the strikethrough is not inside the glyph band').toBeLessThan(plain.ends.lastRow);
    // Which is also why this band is NOT taller than the plain one: 44 CSS px either way.
    // Asserted so that a rule drawn below the baseline, where the underline's goes, cannot
    // pass as a strikethrough.
    expect(Math.abs(struck.height - plain.height), 'the strikethrough moved the band').toBeLessThanOrEqual(1);

    expect(struck.fullest.fill, 'the rule is not a solid run').toBeGreaterThanOrEqual(ruleRowFillFloor);
    expect(
      plain.fullest.fill,
      'a glyph row filled its whole span, so the run above proves nothing'
    ).toBeLessThanOrEqual(glyphRowFillCeiling);
    // The same line-width claim as the underline's, and the same sign: 5 CSS px further right
    // than the glyphs' own ink, because the rule spans the measured advance and the last glyph
    // stops short of it. Asserted at 3 against a measured 5.
    expect(plain.inset.right - struck.inset.right, 'the rule did not reach the line width').toBeGreaterThanOrEqual(3);
    // The mass of it, as a cross-check on the row profile: the rule is 176 CSS px long and 4
    // thick, 704 capture pixels of it, and the band's ink rises by 440 once the glyphs already
    // standing on that row are counted — 2809 to 3249, +15.7%. Asserted at 200, which is a
    // fraction of the rule's own area and far more than a rasterisation wobble.
    expect(struck.pixelCount - plain.pixelCount, 'the rule added no ink').toBeGreaterThan(200);

    expectInkInsideRect(plain, box, DRAFT_RECT, 'the undecorated commit');
    expectInkInsideRect(struck, box, SECOND_DRAFT_RECT, 'the struck commit');
  });

  /**
   * All Caps and Small Caps are two different renderings of the same mixed-case string, and
   * this is the test that holds them apart.
   *
   * Three commits, because "each differs from plain" is a weaker statement than it looks: an
   * implementation that answered both toggles with `all-small-caps` would satisfy a two-commit
   * test twice over. So the two decorated bands are also compared with EACH OTHER, which is
   * only possible with all three on the canvas at once.
   *
   * What Chrome does, and the measurements below are of it rather than of the code's intent:
   * Arial carries no real small capitals, so `fontVariantCaps` synthesises them by SCALING.
   * 'all-small-caps' scales every character — including the ones already typed as capitals —
   * by 0.703 of the type size, so 'Wave' and 'WAVE' render identically and the band shrinks.
   * 'small-caps' leaves the capitals alone and scales only the lowercase, which is Adobe's
   * documented rule ("if the font does not include small caps, Photoshop generates faux small
   * caps", https://helpx.adobe.com/photoshop/using/formatting-characters.html).
   */
  test('All Caps and Small Caps each change the rendering, and differently from each other', async ({
    page,
  }, testInfo) => {
    const box = await canvasBox(page);
    const [plain, allCaps, smallCaps] = await commitStyledSeries(page, testInfo, box, 'Wave', [
      { name: 'text-mixed-case', rect: CAPS_RECTS.plain, apply: async () => undefined },
      {
        name: 'text-all-caps',
        rect: CAPS_RECTS.allCaps,
        apply: async () => styleToggle(page, 'All Caps').click(),
      },
      {
        name: 'text-small-caps',
        rect: CAPS_RECTS.smallCaps,
        // All Caps is cleared FIRST, and that is the code's rule rather than a preference:
        // `applyTextStyle` resolves the pair as `allCaps ? 'all-small-caps' : smallCaps ?
        // 'small-caps' : 'normal'` (`src/tools/text.ts:206`), so the two are separate booleans
        // that are NOT independent in effect — with both pressed, All Caps wins and Small Caps
        // renders nothing at all. Measured before this was written: with All Caps left on, the
        // "small caps" commit came out 121 x 31, byte for byte the all-caps band. The renderer
        // would be more defensible refusing the second press, as Photoshop's Character panel
        // does by making them radio buttons; that is a behaviour question for the operator and
        // not something this file decides, so what it does is drive the sequence the code
        // actually honours.
        apply: async () => {
          await styleToggle(page, 'All Caps').click();
          await expect(styleToggle(page, 'All Caps')).toHaveAttribute('aria-pressed', 'false');
          await styleToggle(page, 'Small Caps').click();
        },
      },
    ]);

    // Measured on this host, all three at 64px:
    //   plain        152 x 44 CSS px, 17px below the rectangle's top
    //   all caps     121 x 31 CSS px, 30px below it, 1390 red pixels
    //   small caps   139 x 44 CSS px, 17px below it, 1882 red pixels
    // All Caps shrinks the WHOLE band, which is the synthesised-capitals factor: 31/44 = 0.705
    // against the 0.703125 the renderer records in `src/tools/text.ts:203-206`. Asserted at
    // 0.85 against a measured 0.705, and on width at 0.9 against a measured 0.796.
    expect(allCaps.height, 'All Caps did not scale the band down').toBeLessThanOrEqual(plain.height * 0.85);
    expect(allCaps.width, 'All Caps did not change the width').toBeLessThan(plain.width * 0.9);
    expect(allCaps.inset.top - plain.inset.top, "All Caps' band did not move down the baseline").toBeGreaterThanOrEqual(
      8
    );

    // Small Caps does NOT move the top: 'W' is a capital the synthesiser leaves alone, so it is
    // still the tallest thing in the band and the cap top is where it was — 17px below the
    // rectangle's top, identical to the plain band. One pixel of allowance on a comparison
    // between two separate commits.
    expect(Math.abs(smallCaps.inset.top - plain.inset.top), 'Small Caps moved the band').toBeLessThanOrEqual(1);
    // The lowercase becomes narrower small capitals, so the band narrows but does not shrink:
    // 139/152 = 0.914, asserted at 0.95.
    expect(smallCaps.width, 'Small Caps did not narrow the lowercase').toBeLessThanOrEqual(plain.width * 0.95);

    // And the two are not the same rendering, which is the whole reason they are two booleans.
    // The heights differ by 13 CSS px, 44 against 31; asserted as a ratio at 1.25 against a
    // measured 1.42, because the difference has to survive a host whose capture is 2x.
    expect(smallCaps.height, 'Small Caps shrank the band, so it is not distinguishable from All Caps').toBeGreaterThan(
      allCaps.height * 1.25
    );

    // `fontVariantCaps` is assigned AFTER `ctx.font` on purpose — assigning the font resets the
    // variant to 'normal' on Chrome 154, which is what the comment at `src/tools/text.ts:179`
    // is about, with the two assignments at `:192` and `:206` — so a renderer that got that
    // order wrong would render all three bands at 152 x 44 and fail every comparison above.
    expectInkInsideRect(plain, box, CAPS_RECTS.plain, 'the mixed-case commit');
    expectInkInsideRect(allCaps, box, CAPS_RECTS.allCaps, 'the all-caps commit');
    expectInkInsideRect(smallCaps, box, CAPS_RECTS.smallCaps, 'the small-caps commit');
  });

  /**
   * The font-size field clamps, and the clamp is visible in the field rather than in a refusal.
   *
   * `handleFontSizeChange` is `Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, requested))`
   * (`Text.tsx:54-62`), so typing above the maximum CLAMPS and typing below the minimum clamps
   * too. Adobe's bound is on the field — `CharacterStyle.size` is `0.01..1296` "in pixels for
   * a 72ppi document" (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle)
   * — and `min`/`max` on a number input do not stop a value being typed, they only mark it
   * `:invalid`, so the clamp in the handler is the rule rather than a duplicate of the
   * attribute. Which of the two it is matters: a refusal would leave the field at 5000 and put
   * nothing in `toolArgs`, and this test is what says which of those the app does.
   *
   * The field is a CONTROLLED input — `value={style.fontSize}` with no local state — so what it
   * reads IS what the renderer will draw with, and that is why the field is the evidence rather
   * than a proxy for it. The pixels then carry what the field cannot, and the arithmetic is
   * worth setting out because the two sizes are so far apart.
   *
   * `renderText` puts a line's baseline at `rect.y1 + TEXT_PADDING + ascent`
   * (`src/tools/text.ts:308`) and the cap top a cap height above that, and only the last two of
   * those terms depend on the type size.
   * Measured rather than assumed: at 1296 the cap top of the committed 'X' lands at document
   * y 456 with the rectangle's top at 206, so that difference is 250 document rows at 1296px of
   * type, or 0.19em — which is Arial's 0.90625em ascent (`src/tools/text.ts:219`) less its cap
   * height. At 5000 the same term is 950 rows, putting the cap top at document y 1161: 561 rows
   * past the end of a 600-row document, so a commit at 5000 would put NOTHING on the canvas.
   * That is why the band the next test measures is evidence about the SIZE and not only about
   * the field.
   */
  test('the font-size field clamps to the Adobe range at both ends, and still sizes the text', async ({
    page,
  }, testInfo) => {
    const size = page.locator('#font-size-input');
    const box = await canvasBox(page);

    // The upper bound, and it is a clamp rather than a refusal: the field comes back reading
    // 1296, which is the value `toolArgs.fontSize` now holds.
    await size.fill('5000');
    await expect(size, 'a size above the Adobe maximum was not clamped').toHaveValue('1296');
    // The lower bound, from both directions. A cleared field reads as 0, and a negative one is
    // equally outside the range, so the handler's `Math.max` is what both of these land on.
    // Its other half — `if (!Number.isFinite(requested)) return` — is what keeps a cleared
    // field from becoming a 0px font, and it is not reachable through `fill`, which cannot
    // produce a value the number input will not accept.
    await size.fill('0');
    await expect(size, 'a zero size was not clamped up to the Adobe minimum').toHaveValue('0.01');
    await size.fill('-40');
    await expect(size, 'a negative size was not clamped up to the Adobe minimum').toHaveValue('0.01');
    // And a value inside the range is taken, so the field is not simply refusing everything:
    // this is what the commits below are measured at.
    await size.fill('32');
    await expect(size, 'a size inside the range was not taken').toHaveValue('32');

    // Half the size is half the ink, which is the pixel statement that the clamped value above
    // is the one the renderer drew with rather than a number sitting in a field. Measured at
    // 64px: 'X' is 39 x 44 CSS px with 629 red pixels; at 32px, 19 x 21 with 150 — 0.487 and
    // 0.477 of the width and the height, and 0.238 of the ink, against the 0.25 that halving
    // the size in both axes predicts. Asserted at 0.6 on the extents against a measured 0.48.
    const [small, large] = await commitStyledSeries(page, testInfo, box, 'X', [
      { name: 'text-size-32', rect: DRAFT_RECT, apply: async () => undefined },
      { name: 'text-size-64', rect: SECOND_DRAFT_RECT, apply: async () => size.fill('64') },
    ]);
    expect(small.width, 'halving the size did not halve the width').toBeLessThanOrEqual(large.width * 0.6);
    expect(small.height, 'halving the size did not halve the height').toBeLessThanOrEqual(large.height * 0.6);
    expect(small.pixelCount, 'halving the size did not quarter the ink').toBeLessThanOrEqual(large.pixelCount * 0.4);

    // Containment is asserted against the rectangles for the two in-range commits and
    // deliberately NOT against one for a clamped-to-maximum commit. The reason is the
    // `trimRect2` clamp above: the rectangle that gets committed at 1296 is the document, not
    // the one the user dragged, so asserting the dragged one here would be asserting that the
    // tool refuses to lay type out larger than the box it was drawn in — which is the app
    // growing the box to fit the text, as it is supposed to.
    expectInkInsideRect(small, box, DRAFT_RECT, 'the 32px commit');
    expectInkInsideRect(large, box, SECOND_DRAFT_RECT, 'the 64px commit');
  });

  test('a size at the Adobe maximum commits ink that reaches the bottom of the document', async ({
    page,
  }, testInfo) => {
    const size = page.locator('#font-size-input');
    const input = page.locator('#text-input');
    const apply = page.getByRole('button', { name: 'Apply' });
    const box = await canvasBox(page);

    await size.fill('5000');
    await expect(size, 'a size above the Adobe maximum was not clamped').toHaveValue('1296');
    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box, DRAFT_RECT);
    await input.fill('X');
    await apply.click();

    // THE WHOLE CANVAS, not a crop of the rectangle, and that is the whole difference between
    // this measurement and a real one. At 1296 the band's top sits 243 box rows BELOW the top of
    // the rectangle that was dragged — box row 443 against 200 — so a crop of that rectangle at
    // `STYLE_CROP_PAD` would find none of it at all and report no ink. The first version of this
    // test widened the crop to 200 rows instead and read a height of 76, which was the band
    // clipped at box row 520 rather than measured. The wait clip widens to the canvas for the
    // same reason: a poll watching the dragged rectangle times out on ink it is looking past.
    await waitForCanvasPixels(
      page,
      toClip({ left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }),
      hasRedPixels,
      { description: 'the red band a maximum-size commit paints' }
    );
    const capture = await captureCanvasScreenshot(page, box, testInfo, 'text-size-max');
    const image = await loadImageData(capture);
    const ink = await scanPixelsForBounds(image, isRedInk);

    // The claim the field assertion in the test above cannot make on its own: the tool is
    // drawing at 1296 and not at the 5000 that was typed. At 5000 the cap top would land at
    // document y 1161 — 561 rows past the end of a 600-row document, by the rate that test's
    // comment derives — so the commit would put NOTHING on the canvas, and this `found` is the
    // assertion that fails if the clamp is ever removed.
    //
    // Measured: a 139 CSS px band, running from document y 456 down to the document's own
    // bottom edge at 600 — 144 of its 600 rows, and the band's bottom IS the document's bottom,
    // which is what the second comparison below says.
    expect(ink.found, 'a commit at the Adobe maximum put no ink on the canvas at all').toBe(true);
    const css = imageBoundsToCss({ width: image.width, height: image.height }, box, ink);
    expect(css.bottom - css.top, 'the clamped maximum did not lay out large type').toBeGreaterThan(100);
    // Reaching the bottom edge is what the test's name claims, and the canvas box IS the
    // document's height here — the contain fit is height-limited, 583 box rows for 600 document
    // rows, with no letterbox on that axis — so the band's bottom row is the box's bottom row,
    // to within a pixel of capture rounding.
    expect(css.bottom, 'the band stopped short of the bottom of the document').toBeGreaterThanOrEqual(
      box.y + box.height - 2
    );
    expect(css.right, 'ink ran off the right of the canvas').toBeLessThanOrEqual(box.x + box.width);
    expect(css.left, 'ink ran off the left of the canvas').toBeGreaterThanOrEqual(box.x);
  });
});
