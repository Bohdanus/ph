import { expect, type Page, test } from './fixtures/extended-test';
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
 * The Type tool is a one-tool group in `toolbar-mapping.ts:108` (its group is the single
 * entry `[{ label: 'Horizontal Type Tool', name: 'text', shortcut: 'T' }]`), so it never
 * publishes a flyout of its own: a group only does when `group.length > 1`
 * (`SidebarLeft.tsx:604`). Whether it has a TILE is a different question, and at this viewport
 * the answer is no — the rail drops whole rows that do not fit into the three-dots tile
 * (`SidebarLeft.tsx:1002-1017`, planned by `planToolbarOverflow`), and Type is the FIFTEENTH
 * of the sixteen groups while 1280x720 fits SEVEN of them, so at this viewport it is reached
 * through the three-dots flyout. `clickToolButton` has a route for that, but it ends
 * in a click, and the click is a pointer at a coordinate this file does not control.
 *
 * WHY THE KEYBOARD ROUTE, stated because the reason this comment used to give is GONE and
 * saying so is the only way the rest can be trusted. It said the menu was taller than the
 * window and the Type entry was therefore off-screen with nothing to click. The 31 rows and
 * the 1254px were the folded set at a FIVE-row window, which is what this viewport used to
 * show; the rail now fills its whole slot (`TOOLBAR_HEIGHT_BUDGET = 1`,
 * `toolbar-overflow.ts:43`), seven of the sixteen groups fit at 720, and the folded set is
 * the nine groups from Brush (the eighth) down, which is 27 rows. The menu is also bounded
 * and scrollable rather than unbounded (`SidebarLeft.tsx:859`, `max-h-[calc(100vh-1rem)]`
 * with `overflow-y-auto`), which is what makes the old claim untrue twice over: measured at
 * 1280x720 those 27 rows at 24.5px each are a 666px menu against a 704px bound, with
 * `scrollHeight === clientHeight` — nothing scrolls, the Type row renders at y 537..561.5,
 * and a plain `click()` on it succeeds.
 *
 * What survives is the property that made the route worth choosing: the row's position is a
 * function of HOW MANY GROUPS THE WINDOW FOLDED, and that count is what the fit planner
 * decides, so it is not a constant this helper can aim at. At 566..622 five rows fit, so the
 * menu carries the 31 rows of groups Crop (the sixth) down — about 764px at 24.5px a row
 * against a bound of 550..606 — and the Type row, the twenty-fifth, lands at or below the fold
 * of a menu the rail scrolls. A helper that four tests depend on, in a file
 * whose whole subject is a tool the rail cannot show, should not have its route change with a
 * planner constant in another file. The menu's own `onKeyDown` activates the focused entry
 * with Enter (`SidebarLeft.tsx:887-901`), which is the app's supported way to pick an entry,
 * and it holds at any viewport, because focus does not require the entry to be on screen.
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
 */
async function dragDraftRect(page: Page, box: BoundingBox): Promise<void> {
  await drawLine(page, box, DRAFT_RECT.x1, DRAFT_RECT.y1, DRAFT_RECT.x2, DRAFT_RECT.y2, {
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
});
