import { expect, type BrowserContext, type Page, type TestInfo, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type CssBounds,
  type ImageDataResult,
  type PixelPredicate,
  containFit,
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
 * the foreground swatch and nothing drove the Type tool, its draft rectangle, its edit-mode
 * gate or the layer it commits.
 *
 * **WHAT THIS FILE IS AFTER THE IN-PLACE EDITOR.** Adobe's Type tool puts a caret on the canvas:
 * the box arrives holding a pre-selected placeholder and the keystrokes go to a transparent
 * `div[contenteditable]` laid over it. So every arrangement below is "place a box, type on it,
 * Commit" — there is no `#text-input` to fill and the buttons are `Commit` and `Cancel`. What did
 * NOT change is the half this file exists for: the geometry and the style controls are still
 * measured off the pixels, and the draft's own box is still measured on the tool overlay canvas.
 * `e2e/text-edit.spec.ts` takes the in-place editing itself — caret placement, selection, the
 * commit paths.
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
 * pixels or a Cancel button means a rename in `layer-utils.ts` fails them for a reason
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
 * The Type tool is a one-tool group in `toolbar-mapping.ts:108` (its group is the single
 * entry `[{ label: 'Horizontal Type Tool', name: 'text', shortcut: 'T' }]`), so it never
 * publishes a flyout of its own: a group only does when `group.length > 1`
 * (`SidebarLeft.tsx:604`). Whether it has a TILE is a different question, and at this viewport
 * the answer is no — the rail drops whole rows that do not fit into the three-dots tile
 * (`SidebarLeft.tsx:1002-1017`, planned by `planToolbarOverflow`), and Type is the FOURTEENTH
 * of the fifteen groups while 1280x720 fits SEVEN of them, so at this viewport it is reached
 * through the three-dots flyout. `clickToolButton` has a route for that, but it ends
 * in a click, and the click is a pointer at a coordinate this file does not control.
 *
 * WHY THE KEYBOARD ROUTE, stated because the reason this comment used to give is GONE and
 * saying so is the only way the rest can be trusted. It said the menu was taller than the
 * window and the Type entry was therefore off-screen with nothing to click. The 31 rows and
 * the 1254px were the folded set at a FIVE-row window, which is what this viewport used to
 * show; the rail now fills its whole slot (`TOOLBAR_HEIGHT_BUDGET = 1`,
 * `toolbar-overflow.ts:52`), seven of the fifteen groups fit at 720, and the folded set is
 * the eight groups from the Clone Stamp (the eighth) down, which is 22 rows. The menu is also
 * bounded and scrollable rather than unbounded (`SidebarLeft.tsx:859`, `max-h-[calc(100vh-1rem)]`
 * with `overflow-y-auto`), which is what makes the old claim untrue twice over: measured at
 * 1280x720 those 22 rows at 24.5px each are a 543px menu against a 704px bound, with
 * `scrollHeight === clientHeight` — nothing scrolls, the Type row renders at y 537.5..562,
 * and a plain `click()` on it succeeds.
 *
 * What survives is the property that made the route worth choosing: the row's position is a
 * function of HOW MANY GROUPS THE WINDOW FOLDED, and that count is what the fit planner
 * decides, so it is not a constant this helper can aim at. At 566..631 five rows fit, so the
 * menu carries the 29 rows of groups Crop (the sixth) down — 715px of content at 24.5px a row
 * against a bound of 550..615, so the menu DOES scroll, and at the BOTTOM of that range the
 * Type row, the twenty-third, is clipped by the fold rather than below it. A helper that four
 * tests depend on, in a file
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
  // The bar's own colour swatch, because that is the control every test below drives first and
  // because it is mounted for as long as the tool is selected — the textarea this used to wait on
  // was mounted for the same span and is gone with the in-place editor.
  await expect(page.locator('#text-color'), 'the Text toolbar should be mounted').toBeVisible();
}

/**
 * The in-place editor, as the element the keystrokes go to.
 *
 * `TextEditOverlay` renders a transparent `div[contenteditable]` over the box the gesture just
 * placed, and it is what receives the type: there is no field to fill and no button that submits
 * it, so `page.keyboard.type()` IS the typing. Every arrangement in this file is that plus a
 * Commit, which is what the bar's textarea and `Apply` used to be.
 */
const draftOverlay = (page: Page) => page.getByTestId('text-edit-overlay');

/**
 * The text a freshly placed box arrives holding, copied rather than imported for the reason
 * `DRAW_TOOL_STROKE_WIDTH` documents: nothing under `e2e/` imports app source, so a string the app
 * owns is written out here with its citation. `PLACEHOLDER_TEXT` (`src/tools/text.ts`) is Adobe's
 * wording — "a layer is created immediately, containing placeholder text that previews font, size
 * and colour, and that is pre-selected so typing replaces it".
 *
 * It is what every draft in this file starts as, so it is also the reason the measurements below
 * need `replaceDraftText` rather than an append: a keystroke that did not replace it would measure
 * 'Lorem ipsumHi' instead of 'Hi'.
 */
const PLACEHOLDER = 'Lorem ipsum';

/**
 * `Commit` and `Cancel`, by the names the bar renders them under.
 *
 * Both are rendered whether or not a draft is open, and both are `disabled={!editing}` — so a
 * commit is reachable only while `hasPendingText(toolArgs)` holds, which is the pair's whole job
 * (Adobe: "if you see the Commit button and the Cancel button, the type tool is in edit mode").
 * Addressing them by accessible name is what makes that pair the thing under test rather than a
 * pair of `div`s.
 */
const commitButton = (page: Page) => page.getByRole('button', { name: 'Commit', exact: true });
const cancelButton = (page: Page) => page.getByRole('button', { name: 'Cancel', exact: true });

/**
 * Replaces what the open draft holds, so a keystroke is a whole string rather than an append.
 *
 * Focus first and select second, and both are arrangement rather than any claim about the product.
 * The options bar's controls take focus when they are clicked — every style test changes one
 * between placing the box and typing into it — and a selection cannot be made in an element that
 * is not focused, so `focus()` is what makes the select that follows possible at all.
 * `ControlOrMeta+a` is the browser's own Select-All inside a `contenteditable`; nothing in the app
 * listens for it (`useKeyboardEvents` skips every shortcut whose target is editable, and there is
 * no `a` shortcut), so this is "focus the draft, select what is in it, type over it" — what a user
 * does to retype a layer's contents.
 *
 * The first keystroke lands on the placeholder the box arrived holding, and `PLACEHOLDER_TEXT` is
 * this file's own copy of that string (`PLACEHOLDER` below), so a draft that was never selected
 * would be visible in every measurement downstream as a longer line than the test asked for.
 */
async function replaceDraftText(page: Page, text: string): Promise<void> {
  await expect(draftOverlay(page), 'a draft is open, so there is something to type into').toBeVisible();
  await draftOverlay(page).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

/**
 * Replaces the draft's contents with a string that BREAKS ITS LINES, through the clipboard.
 *
 * **This is a stand-in for a product defect, and the overflow test is the only caller.** Every
 * other arrangement in this file goes through {@link replaceDraftText} and types character by
 * character, which is what puts the type into the draft one keystroke at a time. A line break
 * cannot be typed at all today: `TextEditOverlay` preventDefaults `Enter` and inserts the newline
 * itself, and `insertPlainTextAtCaret` leaves the selection AFTER the inserted text node —
 * `range.setStartAfter(node)` on a container, which is (host, childCount) rather than an offset
 * inside the text — and the next keystroke then lands at the end of the PREVIOUS line. Measured
 * keystroke by keystroke: `I`, `Enter` -> `'I\n'`, `I` -> `'II\n'`, `Enter` -> `'II\n\n'`, `I` ->
 * `'II\nI'`. Two of the three lines are in the wrong order, a 60 ms pause changes nothing, and a
 * user typing by hand walks the same path.
 *
 * `Input.insertText` is not a way round it either: Chrome inserts the newline as a MARKUP
 * boundary rather than as a character, so `handleInput`'s flattening to `textContent` drops it and
 * `'I\nI\nI'` arrives as `'III'` on one line — which is a single line, so it never overflows
 * anything and the test's second state never happens.
 *
 * The clipboard is what does carry the newline as a character: `handlePaste` takes
 * `text/plain` verbatim, so the draft holds three hard-broken lines and `layoutText` lays out
 * three lines, which is the state the overflow test is about. Nothing about the box, the
 * indicator or the commit changes — only the route the three lines arrived by.
 */
async function replaceDraftLines(page: Page, context: BrowserContext, text: string): Promise<void> {
  await expect(draftOverlay(page), 'a draft is open, so there is something to type into').toBeVisible();
  await draftOverlay(page).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press('ControlOrMeta+v');
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
 * `<input id="text-color" type="color">`, whose `onChange` is `handleColorChange` and which writes
 * `toolArgs.color`. That is the value `renderText` fills with and the value `applyText` commits
 * (it passes the current `toolArgs` to `createLayerFromTool`), so this is the input whose
 * value the red pixels downstream are made of. It is also what a user touches: the swatch is in the
 * options bar, and `beforeEach` has already selected the Text tool, so it is mounted — and it is
 * still mounted while a draft is open, because the in-place editor took the TEXT FIELD away and
 * left every style control where it was.
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
 * after selecting the Text tool, because the tool's options do not mount anywhere near it.
 * `ToolbarHorizontal` renders `<ToolComponent key={toolName} />` in the TOOLBAR row, inside
 * `TOOLBAR_BASE_CLASS`, which fixes that strip at `h-[50px]`, and `App.tsx` declares the
 * toolbar row and the canvas's main area as two different rows — so the box is the main area
 * whichever tool is selected, and no tool choice can resize it. The left rail is
 * `toolbarWidth`, which the viewport decides and the tool does not, and it scrolls inside its
 * own box. So this re-read is not load-bearing for the tool click;
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
 * How far the band's left edge moves between its own first row and four fifths of the way down
 * it, in crop px. Negative is a rightward lean, zero is an upright band, and it is a statement
 * about the SHAPE of the band rather than about its metrics — the property `bandEnds`'s `lean`
 * was after, measured somewhere the band actually has a left edge.
 *
 * **WHY IT IS NOT `bandEnds`'s `lean`, which still exists and is still the right figure for what
 * it is used for.** `bandEnds` takes the first and last rows that carry ANY ink, and the last such
 * row is not always part of the letterforms. A round letter overshoots the baseline by a fraction
 * of an em — the `d` of `'Mild'` does, and Arial's does it deliberately — so it is often the only
 * ink in the band's final row, four pixels of curve where the flat-bottomed letters beside it have
 * already faded below the coverage `isRedInk` admits. Measured here: the upright band's last row
 * holds 31 px spanning the whole word, and one rasterisation phase later the same band's last row
 * holds 4 px at the `d`, which puts `lean` at +87 — the overshoot row's position, not the band's.
 *
 * Four fifths is inside the letterforms for every band this file measures (the smallest is a
 * single 64px line, 45 rows tall, so the row read is 9 rows below the cap line and 36 above the
 * baseline), and it is a FRACTION of the band's own extent rather than a count, so it needs no
 * threshold and no knowledge of the font: a band that leans moves its edge by the same pixels
 * wherever in the letterforms the two rows are sampled.
 */
function bandLean(rows: RowInk[]): number {
  const { firstRow, lastRow } = bandEnds(rows);
  if (firstRow < 0) return 0;
  const deep = rows[Math.round(firstRow + (lastRow - firstRow) * 0.8)];
  if (!deep || deep.count === 0) return 0;
  return deep.left - rows[firstRow].left;
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
  /** {@link bandLean}: the band's shape, sampled inside the letterforms rather than at its edge. */
  lean: number;
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
  expect(ink.found, `no red pixels in the ${name} rectangle after Commit`).toBe(true);

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
    lean: bandLean(rows),
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
 * was measured against (`TextEditOverlay`'s `publish()`).
 *
 * One document rather than one page per variant, because the styles are the tool's OWN
 * settings and they persist: a second `page.goto` would not reset them, so a test that wanted
 * the unstyled rendering measured after the styled one would have to clear every toggle by
 * hand and would silently compare against whatever it failed to clear.
 *
 * The `apply` between the drag and the typing is also what makes `replaceDraftText` focus the
 * overlay rather than assume it still has focus: a style toggle, a tracking slider and the font
 * size field all take it when they are clicked.
 */
async function commitStyledSeries(
  page: Page,
  testInfo: TestInfo,
  box: BoundingBox,
  text: string,
  variants: { name: string; rect: DraftRect; apply: () => Promise<void> }[]
): Promise<InkMeasurement[]> {
  const commit = commitButton(page);

  await setTextToolColor(page, TEXT_COLOR);
  const measured: InkMeasurement[] = [];
  for (const [index, variant] of variants.entries()) {
    await dragDraftRect(page, box, variant.rect);
    if (index > 0) await variant.apply();
    await replaceDraftText(page, text);
    await commit.click();
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

/* -------------------------------------------------------------------------------------------------
 * The two kinds of type, and the box each of them grows.
 *
 * Everything below measures the DRAFT, before Commit, and reads two things off one capture: the
 * BOX, which `useRect` paints on the tool overlay (it draws the outline and the four handles from
 * `rectUnsortedRef`, and the effect re-points that ref at `initialRect` — which is `args.rect`, the
 * box `calculateNewRect` just recomputed — on every commit), in `#007bff`; and the TYPE, which is
 * no longer on that canvas at all. Since the in-place editor the ink belongs to
 * `TextEditOverlay`, a transparent `div[contenteditable]` laid exactly over the box and painted in
 * the tool's own colour — `TextToolArea`'s `redrawDraftChrome` draws the box's CHROME and
 * deliberately no longer calls `renderText`, so the two renderers can never disagree about the same
 * string.
 *
 * Both are still in the same pixels for a screenshot: the capture is of the canvas BOX, and the
 * overlay is positioned inside that box from the same contain fit and the same `args.rect` the
 * frame is stroked from. So "red ink for the type, `#007bff` for the box" survives as a pair of
 * DISJOINT colours in one image, which is the only thing the two predicates below depend on — not
 * which renderer laid them down.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The selection blue, as a predicate: the same three constants `getSelectionBounds` reads, so a
 * pixel this matches is the same pixel that helper reports (`canvas-helpers.ts:755-788`).
 *
 * It cannot be confused with the type's own red (`isRedInk` above), because the frame's red
 * channel is 0 against the ink's 180+, and it cannot be confused with the `rgba(0, 0, 0, 0.7)`
 * dim `drawMask` lays over everything outside the box (`useRect.ts:205-211`): that dims white to
 * RGB 76,76,76, whose green channel is below `SELECTION_GREEN_MIN`.
 */
const isDraftFrame: PixelPredicate = (red, green, blue, alpha) =>
  alpha !== 0 &&
  red <= STROKE_ANALYSIS.SELECTION_RED_MAX &&
  green >= STROKE_ANALYSIS.SELECTION_GREEN_MIN &&
  blue >= STROKE_ANALYSIS.SELECTION_BLUE_MIN;

/**
 * How far outside the box the frame's blue reaches, in DOCUMENT px, on every side.
 *
 * The outline is centred on the box edge, while each handle is an `HANDLE_SIZE / scale` square
 * drawn OUTSIDE its corner (`useRect.ts`). The scan includes the one-pixel outline overhang beside
 * the 12px handle, so this derived frame margin is 13 document px. `HANDLE_SIZE` is 12
 * (`src/util/constants.ts`).
 *
 * It is used only as a DERIVATION of where the box's own edge is from where the blue stops, never
 * as a tolerance, so it does not widen any margin in this file.
 */
const FRAME_OVERHANG_DOC_PX = 13;

/**
 * `TEXT_PADDING`, copied rather than imported for the reason `DRAW_TOOL_STROKE_WIDTH` documents:
 * nothing under `e2e/` imports app source (`vitest.e2e.config.ts` records the boundary), so a
 * number the app owns is written out here with its citation.
 */
const TEXT_PADDING_DOC_PX = 5; // src/util/constants.ts:3

/**
 * The overflow icon's edge, in document px — `OVERFLOW_INDICATOR_PX`
 * (`src/tools/text.ts:471`). Named there as a reconstruction, so this is a copy of the app's own
 * choice rather than an Adobe figure, and the assertions that use it are about the icon's
 * POSITION in the box's corner and about its being absent, not about how it looks.
 */
const OVERFLOW_INDICATOR_DOC_PX = 8;

/**
 * The whole canvas box, as a screenshot clip.
 *
 * A clip over the box rather than over a rectangle is what makes the two scans below
 * unconditional: a crop can only report the ink inside itself, so `measureDraft` photographs the
 * whole canvas and maps the bounds back onto the box, the same argument the committed-ink test
 * makes at length (`:891-901`).
 */
function canvasBoxClip(box: BoundingBox): Required<{ x: number; y: number; width: number; height: number }> {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * What one draft reads: the type's ink and the box it is laid out in, both in page CSS px.
 *
 * The capture is the whole canvas box, so every figure below is a bound over everything on it
 * rather than over a crop, and both scans are run on the same decoded image — the two colours are
 * disjoint, so the pair cannot be double-counted. The ink is the DOM overlay's and the frame is
 * the canvas's; the capture cannot tell them apart and does not need to, because it takes both.
 */
interface DraftMeasurement {
  ink: CssBounds;
  frame: CssBounds;
  /** Device pixels per CSS pixel of the capture, which is what makes the two comparable. */
  scale: { x: number; y: number };
}

/**
 * Takes the caret off the draft's type without closing the draft, so a measurement of ink is a
 * measurement of ink.
 *
 * The overlay sets `caretColor` to the tool's own colour, which is the colour the type is painted
 * in, so a screenshot taken with the draft focused carries a one-pixel vertical bar as tall as the
 * LINE BOX — which is taller than the glyphs, and reaches below the deepest descender of the last
 * line. That is ink this file would then measure as if it were type: `expectInkInsideFrame` would
 * report the draft's ink escaping the bottom of a box that is perfectly correct.
 *
 * Focus is the whole mechanism, and the draft survives it because `TextEditOverlay` deliberately
 * does NOT commit on blur — Adobe lets a user reach for the Size field mid-edit, and this takes
 * that one step further onto the button the next click goes to anyway.
 */
async function dismissDraftCaret(page: Page): Promise<void> {
  await commitButton(page).focus();
}

/** Waits for the draft's ink anywhere on the canvas, then measures the ink and the box. */
async function measureDraft(page: Page, testInfo: TestInfo, box: BoundingBox, name: string): Promise<DraftMeasurement> {
  await dismissDraftCaret(page);
  const capture = await captureCanvasScreenshot(page, box, testInfo, name);
  const image = await loadImageData(capture);
  const ink = await scanPixelsForBounds(image, isRedInk);
  const frame = await scanPixelsForBounds(image, isDraftFrame);
  expect(ink.found, `no red type on the canvas in ${name}`).toBe(true);
  expect(frame.found, `no draft frame on the canvas in ${name}`).toBe(true);

  const extent = { width: image.width, height: image.height };
  return {
    ink: imageBoundsToCss(extent, box, ink),
    frame: imageBoundsToCss(extent, box, frame),
    scale: { x: image.width / box.width, y: image.height / box.height },
  };
}

/**
 * The width of the committed layer's ink, in CSS px, measured over the WHOLE canvas.
 *
 * `measureInk` cannot do this job for a point box: it crops to a dragged rectangle, and a point
 * box has no dragged rectangle to crop to — its extent is derived from the string. So the crop is
 * the canvas, which is the same thing `measureInk` does when it is handed no clip, and it is
 * sound here because a point box is committed into a document whose only other layer is the blank
 * bedrock: the whole canvas holds the one line of type and nothing else.
 *
 * The reason this measures the LAYER rather than the draft is in the point test that calls it.
 */
async function measureCommittedInkWidth(
  page: Page,
  testInfo: TestInfo,
  box: BoundingBox,
  name: string
): Promise<number> {
  const capture = await captureCanvasScreenshot(page, box, testInfo, name);
  const image = await loadImageData(capture);
  const ink = await scanPixelsForBounds(image, isRedInk);
  expect(ink.found, `no red pixels anywhere on the canvas in ${name}`).toBe(true);
  const css = imageBoundsToCss({ width: image.width, height: image.height }, box, ink);
  return css.right - css.left;
}

/**
 * The type's own size, read off the bar rather than assumed.
 *
 * Both fields are CONTROLLED inputs (`Text.tsx:159` and `:177-182`), so what they read is what
 * `resolveTextStyle` hands the renderer, and reading them keeps the line-step arithmetic below a
 * derivation instead of a copy of the seed in `src/tools/settings.ts:86-88`. Neither is set by
 * these three tests, so a change to the default moves the measurement rather than breaking it.
 */
async function typeMetrics(page: Page): Promise<{ fontSize: number; lineHeight: number }> {
  const fontSize = Number(await page.locator('#font-size-input').inputValue());
  const lineHeight = Number(await page.locator('#line-height-slider').inputValue());
  expect(Number.isFinite(fontSize) && fontSize > 0, `#font-size-input reads "${fontSize}"`).toBe(true);
  expect(Number.isFinite(lineHeight) && lineHeight > 0, `#line-height-slider reads "${lineHeight}"`).toBe(true);
  return { fontSize, lineHeight };
}

/**
 * One baseline-to-baseline step ON SCREEN, in CSS px.
 *
 * `renderText` steps the baseline by `fontSize * lineHeight` in DOCUMENT px
 * (`src/tools/text.ts:519`, `:537`), and the document is displayed at a contain scale rather than
 * 1:1 (`canvas-helpers.ts:91-99`), so the step is that product times the fit's own scale. This is
 * the figure the "one line or more than one line" comparisons below are made against: a single
 * line's ink is always shorter than a line box, and two lines' ink is always longer than one.
 */
const lineStepOnScreen = (metrics: { fontSize: number; lineHeight: number }, fit: { scale: number }): number =>
  metrics.fontSize * metrics.lineHeight * fit.scale;

/**
 * The four containment comparisons against the box the frame is drawn around, on the same
 * `INK_MARGIN` every other containment assertion in this file uses, and for the same reason: the
 * margin is a statement about placement, and it is not widened here.
 *
 * The box is taken from the measured frame rather than from the dragged rectangle because the two
 * are not the same thing for a paragraph — its height is content-derived
 * (`src/util/rect.ts:157-161`) — and because the frame is what the user is shown.
 */
function expectInkInsideFrame(draft: DraftMeasurement, label: string) {
  const allowed = {
    left: draft.frame.left + INK_MARGIN,
    top: draft.frame.top + INK_MARGIN,
    right: draft.frame.right - INK_MARGIN,
    bottom: draft.frame.bottom - INK_MARGIN,
  };
  expect.soft(draft.ink.left, `${label}: ink escaped the left of the box`).toBeGreaterThanOrEqual(allowed.left);
  expect.soft(draft.ink.top, `${label}: ink escaped the top of the box`).toBeGreaterThanOrEqual(allowed.top);
  expect.soft(draft.ink.right, `${label}: ink escaped the right of the box`).toBeLessThanOrEqual(allowed.right);
  expect.soft(draft.ink.bottom, `${label}: ink escaped the bottom of the box`).toBeLessThanOrEqual(allowed.bottom);
}

/** The width of a measured span, which `CssBounds` carries as a pair of edges rather than a size. */
const spanWidth = (bounds: CssBounds): number => bounds.right - bounds.left;
const spanHeight = (bounds: CssBounds): number => bounds.bottom - bounds.top;

/**
 * Red ink inside a page-CSS region, and `null` when the region holds none.
 *
 * `page.screenshot({ clip })` takes VIEWPORT coordinates and adds the scroll offset itself
 * (`screenshot-scale.ts:118-123`), which is the space every box in this file is already in at
 * scroll 0 — the committed-ink test's own tripwire, restated: this region is derived from a
 * measured frame rather than from anything assumed about where the page sits.
 */
async function colourBoundsIn(page: Page, region: Rect, predicate: PixelPredicate): Promise<CssBounds | null> {
  const image = await loadImageData(await page.screenshot({ clip: toClip(region) }));
  const bounds = await scanPixelsForBounds(image, predicate);
  if (!bounds.found) return null;
  return imageBoundsToCss(
    { width: image.width, height: image.height },
    { x: region.left, y: region.top, width: region.right - region.left, height: region.bottom - region.top },
    bounds
  );
}

async function redBoundsIn(page: Page, region: Rect): Promise<CssBounds | null> {
  return colourBoundsIn(page, region, isRedInk);
}

/** The same read for the box: where `#007bff` is inside a region. */
async function blueBoundsIn(page: Page, region: Rect): Promise<CssBounds | null> {
  return colourBoundsIn(page, region, isDraftFrame);
}

/**
 * The string the paragraph tests lay out, chosen off the geometry rather than off taste.
 *
 * The dragged box is 400 CSS px wide, which is 411 document px at this viewport's 0.97167 fit,
 * and the wrap width a paragraph box offers its text is the box less the padding on both sides
 * (`textWrapWidth`, `src/tools/text.ts:374-376`) — 401 document px. At 64px Arial those seven
 * words measure about 1078 document px with their spaces, which is 2.7 line widths: the greedy
 * breaker fills the first line to 386, cannot fit `inside` after it and breaks there, fits
 * `inside the` on the second, and puts `dragged box` on the third. Three lines, and the third is
 * not a runt of one short word, which is what keeps the ink's bottom edge clear of the box's.
 */
const PARAGRAPH_TEXT = 'wrap this text inside the dragged box';

/**
 * One line, and more words than the placeholder — see the point test for why the count matters.
 *
 * **THE STRING IS LONGER THAN `PLACEHOLDER_TEXT` ON PURPOSE, and that is a stand-in for a product
 * defect rather than a preference.** A point box is born holding Adobe's placeholder, and
 * `calculateNewRect`'s point arm only ever GROWS a box: `if (requiredWidth > currentWidth)`, with
 * nothing for the case where the new text is NARROWER. So a point box is now stuck at the
 * placeholder's width for the whole of its life: measured here, typing `'one line only'` (which
 * measures 359 document px at 64px Arial) leaves a box 380 document px wide with 11 px of blank
 * right margin, and the same shape appears in every draft a user sees. Adobe's rule is the other
 * way round — "each line of type is independent... the line expands or shrinks as you edit it"
 * (https://helpx.adobe.com/photoshop/using/creating-type.html), and `calculateNewRect`'s own
 * comment quotes it above the arm that does not implement it.
 *
 * So this string is long enough that the box has to grow to it, which is the half of the claim
 * that works, and the point test's own bounds still pin the growth exactly — `boxWidth` is
 * `inkWidth` plus its own padding and the frame's overhang, to within 4 CSS px. What is not
 * covered while the arm is one-directional is the shrinking half, which is why the test measures
 * the committed line rather than the draft's: the draft's ink is the DOM's, and the box is
 * `measureText`'s, and on a box that has outgrown its text those two are 11 document px apart by
 * construction.
 */
const POINT_TEXT = 'one line only here';

/** Where a point-type draft is placed, in canvas-box coordinates. A press, not a drag. */
// Keep the point well inside the contained document rather than in its left letterbox. The text
// layer origin is intentionally clamped to the document, so a click too close to an edge cannot
// remain perfectly centred once the full line would extend beyond that edge.
const CLICK_POINT = { x: 450, y: 300 };

/**
 * The rectangle the overflow test drags, low in the canvas box so that the text can outgrow it
 * without leaving the document.
 *
 * 400 CSS px wide and 160 tall, at box y 400..560 — inside the 583-row box with 23 rows below
 * it, and inside the 720-row window as page y 500..660. The height is the point: a box 165
 * document px tall holds two lines (2 x 76.8 = 153.6) and not three (240.4), so one line fits
 * and three do not, which is what lets the test watch the same gesture move between the two
 * states without clearing anything.
 */
const OVERFLOW_RECT: DraftRect = { x1: 200, y1: 400, x2: 600, y2: 560 };

/**
 * Three lines of one character each, so that the only ink anywhere in the box is a single narrow
 * stripe at its top-LEFT.
 *
 * That is what makes the icon findable without a fragile pixel guess: the icon lives in the
 * box's bottom-RIGHT corner, and a 17px-wide 'I' at the top-left of a 400px box cannot reach it.
 * `'I\nI\nI'` is three lines under the greedy breaker because `\n` is a hard break the renderer
 * splits on itself (`layoutText`, `src/tools/text.ts:453-457`) — the wrap width never enters it.
 */
const OVERFLOW_TEXT = 'I\nI\nI';

/** The one line that fits {@link OVERFLOW_RECT} at this type size. */
const FITS_TEXT = 'I';

test.describe('Text tool', () => {
  test.describe.configure({ timeout: TEXT_TOOL_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await selectTextTool(page);
  });

  /**
   * With no draft open there is NO TEXT FIELD AT ALL, and the pair is rendered but closed.
   *
   * This is the truth that replaced the old `'Apply stays disabled without text, and dragging a
   * rectangle does not change that'`, and it is a stronger claim rather than a rearranged one.
   * That test asked whether a button was enabled, which is a statement about a control; this asks
   * whether the app has a SECOND PLACE TO PUT THE TYPE, which is what in-place editing removed.
   * There is no `#text-input` to assert the value of any more, because there is no element at all —
   * a bar that had kept a hidden textarea would pass every button assertion below and still hold a
   * second copy of the draft.
   */
  test('with no draft open there is no text field, and Commit and Cancel are absent', async ({ page }) => {
    const commit = commitButton(page);
    const cancel = cancelButton(page);

    // The bar is the Text tool's own, and the tool is selected by `beforeEach`, so what follows is
    // about a bar that is fully mounted rather than one that failed to render.
    await expect(page.locator('#text-color'), 'the Text toolbar should be mounted').toBeVisible();

    // Set rather than absence, because `toHaveCount(0)` passes for a bar that rendered nothing at
    // all and would then be satisfied by the tool failing to mount.
    await expect(page.locator('#text-input'), 'the options bar still carries a text field').toHaveCount(0);
    await expect(page.locator('textarea'), 'the options bar replaced the field with another one').toHaveCount(0);

    await expect(commit, 'Commit appears only while editing').toHaveCount(0);
    await expect(cancel, 'Cancel appears only while editing').toHaveCount(0);
  });

  /**
   * A drag is all it takes: the box arrives holding the placeholder and both buttons open at once.
   *
   * The old test's whole argument was that a rectangle alone did not enable `Apply` and that only
   * text did, with a long note about `disabled={!text || !rect}` and the `calculateNewRect`
   * substitution that made the second half of that gate unreachable. All of it described a bar
   * whose text could be empty, and that bar is gone: the box is born holding `PLACEHOLDER_TEXT`, so
   * `hasPendingText` is true the moment the gesture ends and there is no state in which a draft is
   * open and the pair is closed.
   *
   * What replaces the deleted pin is the claim that is now the interesting one — the draft is not
   * a box awaiting words, it is a box ALREADY HOLDING Adobe's placeholder, pre-selected so typing
   * replaces it. So `Commit` and `Cancel` are enabled on a drag with nothing typed at all, and the
   * type that will be committed is there before the first keystroke.
   */
  test('a drag opens a draft already holding the placeholder, and both buttons are enabled at once', async ({
    page,
  }) => {
    const commit = commitButton(page);
    const cancel = cancelButton(page);
    const box = await canvasBox(page);

    // A box on the canvas is what "a draft is open" means here, and waiting for it is what makes
    // the enabled assertions mean more than "the drag never reached the tool area": `useRect` paints
    // the outline and the four handles in `#007bff` as the pointer travels, which is inside
    // `getSelectionBounds`' thresholds, so the wait fails if the pointer events went nowhere. The
    // clip is grown by `INK_MARGIN` so a partially drawn outline is not read as a missing one.
    //
    // What it does NOT prove, stated because it used to be easy to assume: that anything was
    // committed. The stroke is painted on every pointer-move, before the release, so the live draft
    // satisfies it. What proves the draft is real is the type inside it, asserted immediately below.
    await dragDraftRect(page, box);
    await waitForCanvasPixels(
      page,
      toClip(draftRectCss(box, INK_MARGIN)),
      async (png) => {
        return (await getSelectionBounds(png)) !== null;
      },
      { description: 'the draft rectangle outline' }
    );

    // The draft exists, and it holds Adobe's placeholder: "a layer is created immediately,
    // containing placeholder text that previews font, size and colour, and that is pre-selected so
    // typing replaces it". The SELECTION half of that sentence belongs to `e2e/text-edit.spec.ts`;
    // what is asserted here is the half that opens the gate — there is text in the box the instant
    // the gesture ends, with no keystroke at all.
    await expect(draftOverlay(page), 'a drag placed no editable box on the canvas').toBeVisible();
    await expect(draftOverlay(page), 'the draft arrived empty rather than holding the placeholder').toHaveText(
      PLACEHOLDER
    );

    await expect(commit, 'Commit is closed on a draft that already holds text').toBeEnabled();
    await expect(cancel, 'Cancel is closed on a draft that already holds text').toBeEnabled();

    // And no keystroke is needed to reach a commit: one click on the button is the whole of it,
    // which is what the `Apply`-after-`fill` arrangement could not say.
    await commit.click();
    await expect(draftOverlay(page), 'the draft outlived its commit').toHaveCount(0);
    await expect(page.getByTitle('Drag to reorder'), 'a committed draft created nothing').toHaveCount(2);
  });

  test('committing a draft adds a text layer to the layers panel', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const commit = commitButton(page);
    const box = await canvasBox(page);

    await expect(layerRows).toHaveText([STARTING_LAYER_NAME]);

    await dragDraftRect(page, box);
    await replaceDraftText(page, 'Hello');
    await commit.click();

    // A second row, topmost first, and it is a text layer. This is the one test whose
    // subject is the layer itself, so it is the one that asserts the generated name; the
    // commit's pixels and the Cancel button assert row counts instead.
    await expect(layerRows).toHaveCount(2);
    await expect(layerRows.nth(0)).toHaveText(TOOL_LAYER_NAME);
    await expect(layerRows.nth(1)).toHaveText(STARTING_LAYER_NAME);
  });

  test('committed text reaches the canvas as foreground pixels inside the dragged rectangle', async ({
    page,
  }, testInfo) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const commit = commitButton(page);
    const box = await canvasBox(page);

    // The colour goes in through the Text bar's own swatch, because that is what a user edits and
    // what the commit reads. It used to go in through the sidebar's foreground swatch instead, and
    // that stopped working when `a12e35c9` moved `toolArgs.color` off the store — see TEXT_COLOR.
    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box);
    await replaceDraftText(page, 'Hi');
    await commit.click();

    // The commit empties the draft, and with it the editor. That is what makes the pixel read
    // below a statement about the document rather than about the live preview: while the draft is
    // open its type is on screen in the same red, painted by `TextEditOverlay` over the same box,
    // so red pixels would not yet prove anything reached the layer. With the draft closed the
    // overlay is unmounted, and the only red on the canvas is the committed layer — which is why
    // this waits for the overlay's ABSENCE rather than for a field's empty value: the field the
    // old arrangement emptied no longer exists, and an in-place editor that stayed mounted after a
    // commit would leave a second copy of the type on the canvas over the layer's own.
    await expect(draftOverlay(page), 'the draft outlived its commit').toHaveCount(0);
    await expect(commit).toHaveCount(0);
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
    expect(ink.found, 'no red pixels anywhere on the canvas after Commit').toBe(true);

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

  test('Cancel discards the draft without committing a layer', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const commit = commitButton(page);
    const cancel = cancelButton(page);
    const box = await canvasBox(page);

    await dragDraftRect(page, box);
    await replaceDraftText(page, 'Discarded');
    await expect(commit).toBeEnabled();
    await expect(cancel).toBeEnabled();

    await cancel.click();

    // The draft is gone rather than emptied, which is the whole difference between this button and
    // Commit now: there is no field whose value could be read back, so the claim is that the
    // editor is UNMOUNTED and the pair is closed again — the two halves of `hasPendingText`, which
    // is one predicate the bar and the canvas both derive edit mode from.
    await expect(draftOverlay(page), 'Cancel left the draft open').toHaveCount(0);
    await expect(commit).toHaveCount(0);
    await expect(cancel).toHaveCount(0);
    await expect(layerRows).toHaveCount(1);

    // The unchanged row count above is only worth something if the panel does still
    // respond, so the same draft is rebuilt and really committed: the count goes to 2,
    // because Cancel created nothing.
    await dragDraftRect(page, box);
    await replaceDraftText(page, 'Kept');
    await expect(commit).toBeEnabled();
    await commit.click();

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
    //   unweighted  105 x 45 CSS px, 2038 red pixels, fullest row 72 in a span of 106 (0.557)
    //   bold        116 x 45 CSS px, 2996 red pixels, fullest row 71 in a span of 117 (0.684)
    // The width ratio is asserted at 1.05 against a measured 1.105.
    expect(bold.width, 'bold did not widen the ink').toBeGreaterThan(plain.width * 1.05);
    // The count is the half with the real margin: a weight change is a STEM change, and 1.47x
    // the ink is what that looks like. It is a raw capture-pixel count, so it is only ever
    // compared against another count taken from the same-shaped crop of the same canvas.
    expect(bold.pixelCount, 'bold did not put down more ink').toBeGreaterThan(plain.pixelCount * 1.3);
    // Shape, not just mass: the fullest row of a band is fuller when its stems are thicker.
    // Every undecorated band in this file measures between 0.32 and 0.60 here, because a glyph
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
    // 'Mild' goes 105 -> 112 CSS px on width (+6.7%, asserted at 1.02 so that a face whose
    // advances are identical still has a margin) and 2038 -> 2028 red pixels (-0.5%). The ink
    // COUNT is the same story — an oblique face of the same weight puts down the same ink.
    //
    // What does separate them is the SHAPE of the band, and it is measured from the row
    // profile: `lean` is how far to the right the band's left edge has moved four fifths of the
    // way down it. A rightward lean carries its top rows rightward, so the lean goes negative;
    // an upright band has a vertical left edge and the lean is zero.
    //
    // It is `bandLean` and not `ends.lean` — the difference is the shape of the measurement, not
    // the shape of the claim, and `bandLean` documents it: the row `ends` reads as the band's
    // bottom is the `d`'s baseline overshoot rather than the feet of the letters beside it, so
    // `ends.lean` reports where an overshoot sits in the word instead of where the band leans.
    // Measured on this host, the upright band's lean is -1 and the italic's -8, the M's cap
    // overhanging its foot by 0.13em at 64px.
    expect(plain.lean, 'the upright band leans, so the comparison below is measuring the font').toBeGreaterThanOrEqual(
      -1
    );
    // Asserted at -4 against a measured -8. This is the comparison carrying the test; the width
    // below is the loose half.
    expect(italic.lean, 'the italic band does not lean').toBeLessThanOrEqual(-4);
    expect(italic.width, 'the italic face did not even change the advance').toBeGreaterThan(plain.width * 1.02);
    expect(Math.abs(italic.height - plain.height), 'the band changed height').toBeLessThanOrEqual(1);

    // A slant carries the band's TOP rows rightward while its feet stay put, so the topmost
    // ink row starts further right than the upright band's does: measured column 50 upright
    // and 57 italic in their own crops, a 7px move. It is a second reading of the same
    // overhang, taken from the row the other probe deliberately does not trust the bottom of,
    // and it is the one that survives a font whose italic has a different left side bearing from
    // its upright — the band's own left edge does not move at all for 'Mild', because the foot of
    // the slanted 'M' lands where the upright one's does.
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
    // from page x 433 to 508 — 75px, against the 76.8 the arithmetic above predicts. The
    // threshold is 1.3 against a measured 1.44.
    expect(tracked.width, 'tracking did not widen the ink').toBeGreaterThan(plain.width * 1.3);
    // Tracking is spacing, not weight: measured 2804 red pixels untracked and 2859 tracked,
    // +2%. The same four letters with the same stems are still there, further apart.
    expect(tracked.pixelCount, 'tracking changed the amount of ink, not only its extent').toBeLessThan(
      plain.pixelCount * 1.1
    );
    // The LEFT edge is the part that makes it inter-glyph spacing rather than a shift or a
    // leading gap: `letterSpacing` adds to every character's advance INCLUDING the last one, so
    // the first glyph does not move (`src/tools/text.ts:235-236`). Measured 262 -> 262 page x, and
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
    const fit = containFit(box);
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
    // undecorated band occupies rows 56..100 of its crop and the underlined one 56..108, with
    // the solid run at row 106.
    expect(underlined.fullest.index, 'the underline did not land below the glyph band').toBeGreaterThan(
      plain.ends.lastRow
    );
    // And the band really is taller for it: 8 rows, and 8 CSS px of clearance from the
    // rectangle's bottom edge given away (60 -> 52). Asserted at 5 against a measured 8.
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

    // WHERE the rule starts on the left, stated against the two things it could be instead.
    //
    // The origin itself first, because it is the claim and it is a DERIVED position rather than
    // another reading of the ink: `renderTextInto` starts a line at `rect.x1 + TEXT_PADDING` and
    // the rule is a `fillRect` from that same `x`, so the rule's left edge belongs exactly
    // `TEXT_PADDING` inside the rectangle, up to the pixel the downscale rounds it by. Measured
    // 5 CSS px against a derived 4.86.
    expect(
      Math.abs(underlined.inset.left - TEXT_PADDING_DOC_PX * fit.scale),
      'the rule did not start at the line origin'
    ).toBeLessThanOrEqual(1);
    // And not inside the glyph run's own left bearing, which is what a rule drawn from the ink's
    // left edge instead of the origin would look like: Arial's `W` is very nearly flush with its
    // origin, so the two edges are a pixel apart EITHER WAY once the band is rasterised at a
    // subpixel phase and downscaled — measured +1 and -1 on the two arrangements this has run in.
    // The bound is a pixel for that reason; a one-sided comparison of the two would be a claim
    // about which phase the commit landed in rather than about where the rule was drawn.
    expect(
      Math.abs(underlined.inset.left - plain.inset.left),
      'the rule did not start at the line origin'
    ).toBeLessThanOrEqual(1);

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
    // undecorated band runs rows 56..100 of its crop and the solid run's TOP row is 83, i.e. 17
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
    // thick, 704 capture pixels of it, and the band's ink rises by 444 once the glyphs already
    // standing on that row are counted — 2804 to 3248, +15.8%. Asserted at 200, which is a
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
        // "small caps" commit came out 121 x 30, byte for byte the all-caps band. The renderer
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
    //   all caps     121 x 30 CSS px, 30px below it, 1342 red pixels
    //   small caps   139 x 44 CSS px, 17px below it, 1871 red pixels
    // All Caps shrinks the WHOLE band, which is the synthesised-capitals factor: 30/44 = 0.682
    // against the 0.703125 the renderer records in `src/tools/text.ts:203-206`. Asserted at
    // 0.85 against a measured 0.682, and on width at 0.9 against a measured 0.796.
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
    // The heights differ by 14 CSS px, 44 against 30; asserted as a ratio at 1.25 against a
    // measured 1.47, because the difference has to survive a host whose capture is 2x.
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
   * `handleFontSizeCommit` is `Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, requested))` in
   * `Text.tsx`, so committing above the maximum CLAMPS and committing below the minimum clamps
   * too. Adobe's bound is on the field — `CharacterStyle.size` is `0.01..1296` "in pixels for
   * a 72ppi document" (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle)
   * — and `min`/`max` on a number input do not stop a value being typed, they only mark it
   * `:invalid`, so the clamp in the commit is the rule rather than a duplicate of the
   * attribute. Which of the two it is matters: a refusal would leave the field at 5000 and put
   * nothing in `toolArgs`, and this test is what says which of those the app does.
   *
   * The field commits on blur or Enter rather than per keystroke, so EVERY `fill` of a size in
   * this test is followed by an explicit `press('Enter')` before the value is asserted on.
   * `fill` dispatches an `input` event and nothing else — the field keeps the draft it was
   * handed, and `toolArgs` still holds the size published before it — so without the commit
   * these assertions would be reading the draft rather than the style.
   *
   * After the commit the field reads what the renderer will draw with: it is
   * `value={fontSizeDraft ?? String(style.fontSize)}`, so dropping the draft puts the published
   * size back in the control. That is why the field is the evidence rather than a proxy for it.
   * The pixels then carry what the field cannot, and the arithmetic is worth setting out because
   * the two sizes are so far apart.
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
    // 1296, which is the value `toolArgs.fontSize` now holds. Enter is what makes it come back —
    // `fill` alone leaves 5000 sitting in the field as an uncommitted draft.
    await size.fill('5000');
    await size.press('Enter');
    await expect(size, 'a size above the Adobe maximum was not clamped').toHaveValue('1296');
    // The lower bound, from both directions: a zero and a negative size are both outside the range,
    // so the commit's `Math.max` is what each of these lands on.
    await size.fill('0');
    await size.press('Enter');
    await expect(size, 'a zero size was not clamped up to the Adobe minimum').toHaveValue('0.01');
    await size.fill('-40');
    await size.press('Enter');
    await expect(size, 'a negative size was not clamped up to the Adobe minimum').toHaveValue('0.01');

    // And a value inside the range is taken, so the field is not simply refusing everything:
    // this is what the commits below are measured at.
    await size.fill('32');
    await size.press('Enter');
    await expect(size, 'a size inside the range was not taken').toHaveValue('32');

    // An EMPTIED field, and this comment used to claim it was unreachable. It is reachable — and
    // the old reasoning was wrong by one operator: `Number('')` is `0`, not `NaN`, so the commit's
    // `Number.isFinite` guard ADMITTED it and the clamp turned a size the user was halfway through
    // retyping into 0.01. `fill` cannot produce that state on its own; pressing BACKSPACE can, and a
    // two-digit size cannot be typed from scratch without passing through empty.
    //
    // The field publishes nothing while empty, and while the draft is in the field the field SHOWS
    // that draft rather than the published size — that is what a draft is, and it is the assertion
    // below. What proves nothing was published is the blur after it: the last good value, 32 from
    // immediately above, is still standing. Under the old guard this read 0.01.
    await size.fill('');
    await expect(size, 'an empty draft was resolved into a size before the edit ended').toHaveValue('');
    // The blur is the commit, and for an empty draft it publishes NOTHING: `handleFontSizeCommit`
    // returns on the empty string, so the restore below is React dropping the draft and the
    // controlled `value={fontSizeDraft ?? String(style.fontSize)}` showing the published size again.
    // That is the whole of the evidence that an abandoned retyping did not become 0.01.
    await size.blur();
    await expect(size, 'blurring a cleared field changed the size it had already published').toHaveValue('32');

    // Half the size is half the ink, which is the pixel statement that the clamped value above
    // is the one the renderer drew with rather than a number sitting in a field. Measured at
    // 64px: 'X' is 39 x 44 CSS px with 629 red pixels; at 32px, 19 x 21 with 150 — 0.487 and
    // 0.477 of the width and the height, and 0.238 of the ink, against the 0.25 that halving
    // the size in both axes predicts. Asserted at 0.6 on the extents against a measured 0.48.
    // Committed here for the same reason as the field assertions above: a `fill` with no commit leaves
    // the published size at 32, and the second series commit would then be measured against the same
    // 32px as the first and every ratio below would be a comparison of a thing with itself.
    const [small, large] = await commitStyledSeries(page, testInfo, box, 'X', [
      { name: 'text-size-32', rect: DRAFT_RECT, apply: async () => undefined },
      {
        name: 'text-size-64',
        rect: SECOND_DRAFT_RECT,
        apply: async () => {
          await size.fill('64');
          await size.press('Enter');
        },
      },
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
    const commit = commitButton(page);
    const box = await canvasBox(page);

    // The same commit the clamp test makes, and for the same reason: the commit is what puts 1296 in
    // `toolArgs`, and this test's whole claim is that the text below was laid out with it.
    await size.fill('5000');
    await size.press('Enter');
    await expect(size, 'a size above the Adobe maximum was not clamped').toHaveValue('1296');
    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box, DRAFT_RECT);
    await replaceDraftText(page, 'X');
    await commit.click();

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

  /**
   * A drag places PARAGRAPH type: the lines wrap to the width that was dragged, and the box keeps
   * that width and grows its HEIGHT instead.
   *
   * Adobe's own words for the pair are the spec: `PARAGRAPHTEXT` is "Text that wraps within a
   * bounding box" and `POINTTEXT` is "Text that does not wrap"
   * (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/textitem). The app
   * decides between them on the gesture alone: a press whose POINTER travels more than
   * `POINT_TYPE_MAX_DRAG_PX` on either axis is a drag, so a 400x120 press is a drag on both
   * axes and the box it produces is a paragraph box whatever else is true.
   *
   * Three assertions, and each one fails on a specific way the wrapping could be absent:
   *
   *   1. the ink is TALLER THAN ONE LINE BOX — which is what "wrapped" means, stated in the
   *      renderer's own units (`lineStepOnScreen` is the baseline step), so it is
   *      a comparison of two measured figures rather than a constant;
   *   2. the ink stays inside the dragged WIDTH — the wrap width is the box less the padding on
   *      both sides (`textWrapWidth`), so the widest line must end short of
   *      the right edge, and the four comparisons on the width are what say it did;
   *   3. the BOX kept that width — which is the load-bearing half, and the one a point-type
   *      growth cannot satisfy. `calculateNewRect` grows a paragraph box only in height
   *      (`rect.ts:152-161`), so an implementation that grew the width instead would put the
   *      whole 1078px string in one line and widen the box to hold it: past this canvas box, in
   *      fact, which is why the bound below is a ratio rather than an equality.
   */
  test('a drag places paragraph type: the type wraps to the dragged width and the box keeps that width', async ({
    page,
  }, testInfo) => {
    const box = await canvasBox(page);
    const fit = containFit(box);
    const metrics = await typeMetrics(page);
    const step = lineStepOnScreen(metrics, fit);

    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box, DRAFT_RECT);
    await replaceDraftText(page, PARAGRAPH_TEXT);

    // The wait is for the draft's own repaint and nothing else: nothing red is on the canvas
    // before this (the keystrokes are the first ink of the session and no layer has been
    // committed), so the poll cannot be satisfied by a previous state. What it waits for is the
    // LIVE DRAFT — `TextEditOverlay` republishes through `calculateNewRect` on every keystroke, so
    // the box is re-measured and re-painted as the string grows — which is why the measurement
    // below is about the draft's box and not about a committed layer.
    await waitForCanvasPixels(page, canvasBoxClip(box), hasRedPixels, { description: 'the draft type on the overlay' });

    const draft = await measureDraft(page, testInfo, box, 'text-paragraph-draft');
    const draggedWidth = DRAFT_RECT.x2 - DRAFT_RECT.x1;

    // 1. MORE THAN ONE LINE BOX OF INK. A single line's ink is always shorter than the line box
    // it is laid out in, and two lines' ink is always longer than one, so this is the comparison
    // that separates "wrapped" from "not wrapped" without naming a font or a glyph. Measured on
    // this host: the step is 74.6 CSS px at 64px/1.2 through the 0.97167 fit, the capture's three
    // bands of this string stand 64, 46 and 58 px, and the ink spans 205 — so the assertion has
    // room on the side it must not fail (no single band reaches 75) and a wide margin on the side
    // it must (three bands reach 205).
    expect(spanHeight(draft.ink), 'the draft type is one line tall, so nothing wrapped').toBeGreaterThan(step);

    // 2. INSIDE THE DRAGGED WIDTH, which is what the wrap width promises: a line that fits is at
    // most `boxWidth - 2 * TEXT_PADDING` wide, so no line may reach the right edge. The bottom
    // edge is deliberately NOT compared against the dragged rectangle — a paragraph box grows
    // downward to hold its lines, so the bottom boundary is the box, which is the next assertion.
    const allowed = draftRectCss(box, INK_MARGIN, DRAFT_RECT);
    expect
      .soft(draft.ink.left, 'the wrapped type escaped the left of the dragged width')
      .toBeGreaterThanOrEqual(allowed.left);
    expect
      .soft(draft.ink.top, 'the wrapped type escaped above the dragged rectangle')
      .toBeGreaterThanOrEqual(allowed.top);
    expect
      .soft(draft.ink.right, 'the wrapped type escaped the right of the dragged width')
      .toBeLessThanOrEqual(allowed.right);
    // And the line STOPS SHORT rather than merely landing inside the margin above: the wrap width
    // is the box less the padding on both sides, so the widest line's ink must end short of the
    // box's own right edge. Measured on this host at 30 CSS px of clearance, asserted at 2 —
    // a comparison that is a statement about a break, not about a rounding: the greedy breaker
    // leaves the next word on the next line, and the widest line therefore stops short by that
    // word's width as well as by the padding.
    expect(
      box.x + DRAFT_RECT.x2 - draft.ink.right,
      'the widest wrapped line ran to the edge of the box rather than stopping inside it'
    ).toBeGreaterThanOrEqual(2);

    // 3. THE BOX KEPT THAT WIDTH. The tight form first, because it is the one that carries the
    // claim: the frame is the box plus `2 * FRAME_OVERHANG_DOC_PX` document px of its own paint,
    // so its width is a DERIVATION of the dragged width and not a constant that could drift.
    // Measured 411 CSS px against a derived 413.6, so the 4 is a rounding allowance and not slack.
    expect(
      Math.abs(spanWidth(draft.frame) - (draggedWidth + 2 * FRAME_OVERHANG_DOC_PX * fit.scale)),
      'the paragraph box did not keep the width that was dragged'
    ).toBeLessThanOrEqual(4);
    // And the loose form, which is what actually fails without wrapping: a box that grew to the
    // text would be about 1042 CSS px wide — the string measures 1042 in the 64px Arial context
    // — which is wider than this 974px canvas box, so the growth would be 2.5x outside this bound
    // rather than a few pixels outside it.
    expect(spanWidth(draft.frame), 'the paragraph box grew to fit the whole string').toBeLessThanOrEqual(
      draggedWidth * 1.1
    );

    // And the ink is inside the box it was laid out in. This is `expect.soft`, so the wrapping
    // claims above are reported even when this one fails — which, on the same defect, it does: the
    // ink runs 39 CSS px below a box that was sized for one line.
    expectInkInsideFrame(draft, 'the wrapped paragraph draft');

    // The complement, and it is the other half of `calculateNewRect`'s paragraph branch: the box
    // grew in HEIGHT, because three lines do not fit in the 120 rows that were dragged.
    //
    // This assertion was RED until the measuring functions started styling the context they measure
    // on. `getTextWidth` applied the style and `getTextLineCount` did not, so a paragraph box's WIDTH
    // came out right and its HEIGHT did not — and the workspace canvas it was handed carries
    // `10px sans-serif` for the whole session: read off the live page in that run, it measured this
    // string at 162.9px where the tool overlay measured 1042.4px at `64px Arial`. The wrapped line
    // count came back as 1, the box never grew, and the committed layer carried ONE band of ink
    // instead of three, because the layer's own canvas is the box the type was laid out in.
    //
    // It is stated as a property — the box grew — rather than as a line count, so it does not care
    // how many lines the string takes.
    //
    // The FRAME's own overhang has to come off before the comparison, or the assertion cannot fail:
    // `useRect`'s `drawMask` strokes a 2px outline centred on each edge and paints corner handles
    // `HANDLE_SIZE` out from each corner on every call, unconditionally — which is the
    // `FRAME_OVERHANG_DOC_PX` this file already carries. That is 13 document px per edge, about
    // 13.6 CSS px at this fit, so an UNGROWN 120px box already measures 133.6 and cleared a bare
    // `> 120`. The first version of this assertion did exactly that and its comment claimed it would
    // catch the regression; it would not have. Subtracting the overhang puts the un-grown box at the
    // boundary and the grown one well above it.
    const overhangCss = 2 * FRAME_OVERHANG_DOC_PX * containFit(box).scale;
    expect(
      spanHeight(draft.frame) - overhangCss,
      'the paragraph box did not grow downward to hold its wrapped lines'
    ).toBeGreaterThan(DRAFT_RECT.y2 - DRAFT_RECT.y1);
  });

  /**
   * A click places POINT type: nothing wraps, and the box grows sideways to hold the whole line.
   *
   * The same gesture, the other side of the threshold: a press whose pointer travels no more than
   * `POINT_TYPE_MAX_DRAG_PX` on EITHER axis collapses
   * its rect to a point and is laid out as point type, for which the renderer offers its text an
   * infinite width (`renderText`, `src/tools/text.ts:533`) and the box grows to the measured
   * string (`src/util/rect.ts:162-181`). Both halves of that are asserted here, and they are
   * asserted against the two different things that could go wrong:
   *
   *   1. the ink is no taller than ONE LINE BOX — the no-wrap claim. Had this press been read as
   *      a drag it would have been a paragraph box of the drag's width, and three words that do
   *      not fit it would have become three lines, i.e. an ink about 3x taller than the step.
   *   2. the BOX is as wide as the line plus its own padding — the grew-to-fit claim, and the one
   *      that fails outright against a box that stayed collapsed at the click point. The click's rect is collapsed
   *      to zero width, and a point box that never grew would measure about 14 CSS px of frame
   *      around nothing, against the 512 CSS px of frame measured around the 486 CSS px line here.
   *
   * **WHY CLAIM 2 IS MEASURED ON THE LAYER AND CLAIM 1 ON THE DRAFT**, which is the one arrangement
   * change in this test. The draft's ink is `TextEditOverlay`'s and the draft's box is
   * `calculateNewRect`'s, and those two are not required to agree about how wide a string is: the
   * box is sized from a canvas `measureText` and the DOM lays the same string out with
   * `font-kerning: auto` while Canvas 2D draws with kerning off, so a draft's ink and a draft's box
   * can differ by several CSS px on a string that is nothing but kerning pairs. So a claim of the
   * form "the box is the line plus its padding" cannot be asked of the draft without asserting
   * whatever that gap happens to be. The box is the canvas's arithmetic and the line is the canvas's
   * rendering, so claim 2 puts both on the canvas: it commits the draft and measures the LAYER's ink
   * against the DRAFT's frame, which is the frame of the very box that was committed. The layout
   * disagreement itself is `e2e/text-edit.spec.ts`'s subject, not this file's.
   */
  test('a click places point type: the line does not wrap and the box grows to fit it', async ({ page }, testInfo) => {
    const box = await canvasBox(page);
    const fit = containFit(box);
    const metrics = await typeMetrics(page);
    const step = lineStepOnScreen(metrics, fit);

    await setTextToolColor(page, TEXT_COLOR);

    // A press, not a drag. `page.mouse.click` moves, presses and releases at ONE coordinate, so
    // `useRect`'s rect is zero-width and zero-height and the pointer's travel is nil. Nothing
    // else in the gesture is load-bearing: the threshold is 3 CSS px, so a press that travelled
    // 4 on either axis would be a paragraph press and this test would be measuring the wrong box.
    //
    // And that press is the WHOLE of placing type now: the box it leaves behind is already an
    // editable draft holding the placeholder, so the type below is typed onto the canvas rather
    // than into a field the gesture never touched.
    await page.mouse.click(box.x + CLICK_POINT.x, box.y + CLICK_POINT.y);
    const placed = await draftOverlay(page).boundingBox();
    expect(placed, 'the click did not create a measurable point-text box').not.toBeNull();
    expect(
      Math.abs(placed!.x + placed!.width / 2 - (box.x + CLICK_POINT.x)),
      'the placeholder box is not centred on the click'
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(placed!.y + placed!.height / 2 - (box.y + CLICK_POINT.y)),
      'the placeholder box is not vertically centred on the click'
    ).toBeLessThanOrEqual(3);
    await replaceDraftText(page, POINT_TEXT);

    await waitForCanvasPixels(page, canvasBoxClip(box), hasRedPixels, { description: 'the point draft type' });

    const draft = await measureDraft(page, testInfo, box, 'text-point-draft');
    const boxWidth = spanWidth(draft.frame);

    // 1. ONE LINE, against the same line-box figure the paragraph test uses, so the two tests are
    // read against one scale. Measured: this string stands 57 CSS px tall against a 74.6px step,
    // and an ink that had wrapped would be at least two of those bands deep.
    expect(spanHeight(draft.ink), 'the point draft wrapped onto a second line').toBeLessThanOrEqual(step);

    // And it is inside the box it was laid out in, which is the draft's own claim and the draft's
    // own ink — soft, so that the two width comparisons below are still reported if it fails.
    expectInkInsideFrame(draft, 'the point draft');

    // The box grows equally around the click, so its centre remains at the placement coordinate.
    expect(
      Math.abs((draft.frame.left + draft.frame.right) / 2 - (box.x + CLICK_POINT.x)),
      'the point box is not centred on the click'
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs((draft.frame.top + draft.frame.bottom) / 2 - (box.y + CLICK_POINT.y)),
      'the point box is not vertically centred on the click'
    ).toBeLessThanOrEqual(3);

    // 2. THE BOX GREW TO FIT, on the committed line. The frame measured above IS the frame of the
    // box this commit writes, and the line below is that box's own rendering of the string, so the
    // two figures are the canvas's arithmetic and the canvas's arithmetic.
    await commitButton(page).click();
    const inkWidth = await measureCommittedInkWidth(page, testInfo, box, 'text-point-commit');
    // The derived figure is what the arithmetic says it must be: the point box is `TEXT_PADDING`
    // wider than the ink on each side (`rect.ts`, the point arm), and the frame is
    // `FRAME_OVERHANG_DOC_PX` wider than the box on each side. Measured 26 CSS px against a
    // derived 23.3, so the 4 is a rounding allowance on a figure whose failure mode is a frame
    // 350 px narrower.
    const paddingAndFrame = (2 * TEXT_PADDING_DOC_PX + 2 * FRAME_OVERHANG_DOC_PX) * fit.scale;
    expect(boxWidth - inkWidth, 'the point box is not the line plus its padding').toBeGreaterThanOrEqual(
      paddingAndFrame - 4
    );
    // CSS-pixel bounds are rounded from the device-pixel screenshot, so allow one extra pixel on
    // the upper edge while keeping the lower bound tight enough to reject a collapsed or grow-only box.
    expect(boxWidth - inkWidth, 'the point box is much wider than the line it holds').toBeLessThanOrEqual(
      paddingAndFrame + 5
    );
    // The same claim without the arithmetic above: a box still collapsed at the click point is
    // about 14 CSS px wide, which is a fortieth of the 512 measured here, and one that grew
    // without bound would be 900 — so both wrong answers are outside the band this pair admits.
    expect(boxWidth, 'the point box did not grow off the click point').toBeGreaterThan(100);
    expect(boxWidth, 'the point box is wider than the line it grew to fit').toBeLessThanOrEqual(inkWidth * 1.2);
  });

  /**
   * Adobe's overflow icon: "If you enter more text that can fit within a paragraph boundary…, a
   * small box or circle containing a plus symbol (+) appears in place of a handle in the corner of
   * the boundary" (https://helpx.adobe.com/photoshop/using/creating-type.html). The app draws it
   * as a stroked square with a plus, `OVERFLOW_INDICATOR_PX` document px on a side, in the
   * bottom-right corner, and only ever on the DRAFT's overlay: `drawOverflowIndicator` draws it,
   * `TextToolArea`'s `redrawDraftChrome` is the one caller that reaches for it (after asking
   * `layoutText` the overflow question, rather than `renderText`, which would draw the ink it has
   * stopped drawing), and the layer creator never calls it at all.
   *
   * WHERE THE OVERFLOW COMES FROM, and it is not obvious enough to leave out: `layoutText` calls a
   * draft overflowing when its lines need more height than the box has (`text.ts:459`), and
   * `calculateNewRect` grows a paragraph box to exactly that height (`rect.ts:157-161`) — so a box
   * inside the document never overflows, and the one state that does is a box the document edge
   * clamped (`trimRect2`, `rect.ts:192`). Hence {@link OVERFLOW_RECT} low in the canvas: three
   * hard-broken lines need 240 document px and the rectangle gives 165, the box grows, the clamp
   * stops it, and the type is then taller than the box it is in.
   *
   * THREE STATES OF ONE GESTURE, which is what makes "only while" a claim rather than a caption:
   * a line that fits has no icon, three lines that do not have one, and the committed layer never
   * carries one at all.
   */
  test('the overflow icon is on the draft overlay only while the type outgrows the box', async ({ page, context }) => {
    const commit = commitButton(page);
    const box = await canvasBox(page);
    const fit = containFit(box);

    // The document's bottom edge, on screen. This is the one assumption the icon's position rests
    // on — that the contain fit is height-limited and so maps document y 600 to the canvas box's
    // own bottom row — and it is asserted rather than assumed, so a layout that letterboxes
    // vertically turns this test red instead of quietly measuring a region 8px away.
    expect(
      Math.abs(fit.offsetY),
      'the contain fit letterboxes the document vertically, so its bottom edge is not the canvas bottom'
    ).toBeLessThanOrEqual(1);

    // A strip of canvas BELOW the rectangle that was dragged and inside the document: the box's
    // bottom edge is inside it while the type outgrows the box, and above it while it does not.
    // That is the wait between the two states, and it is a wait rather than a timeout because the
    // frame is what moves.
    const documentEdgeStrip: Rect = {
      left: box.x + OVERFLOW_RECT.x1 - 20,
      top: box.y + OVERFLOW_RECT.y2 + 12,
      right: box.x + OVERFLOW_RECT.x2 + 20,
      bottom: box.y + box.height,
    };
    const waitForBoxAtDocumentEdge = () =>
      waitForCanvasPixels(page, toClip(documentEdgeStrip), async (png) => (await getSelectionBounds(png)) !== null, {
        description: 'the paragraph box reaching the bottom edge of the document',
      });

    // Where the icon has to be, derived from the code that draws it rather than measured off a
    // previous run: `x2 - TEXT_PADDING - OVERFLOW_INDICATOR_PX` from the box's right edge, and
    // `y2 - TEXT_PADDING - OVERFLOW_INDICATOR_PX` from its bottom, which the clamp put on the
    // document's bottom edge. The region is the derived centre plus 16 CSS px, which is twice the
    // icon's own size — slack enough that a two-pixel error in any term of the derivation cannot
    // turn into a miss, and tight enough that an icon anywhere else is not found by it.
    const iconCentre = {
      x: box.x + OVERFLOW_RECT.x2 - (TEXT_PADDING_DOC_PX + OVERFLOW_INDICATOR_DOC_PX / 2) * fit.scale,
      y: box.y + box.height - (TEXT_PADDING_DOC_PX + OVERFLOW_INDICATOR_DOC_PX / 2) * fit.scale,
    };
    const iconRegion: Rect = {
      left: iconCentre.x - 16,
      top: iconCentre.y - 16,
      right: iconCentre.x + 16,
      bottom: Math.min(box.y + box.height, iconCentre.y + 16),
    };

    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box, OVERFLOW_RECT);

    // STATE A — one line, which fits: no icon. The wait is for the ink itself, so the assertion
    // that follows is about a painted draft rather than about an empty canvas.
    await replaceDraftText(page, FITS_TEXT);
    await waitForCanvasPixels(page, canvasBoxClip(box), hasRedPixels, {
      description: 'the type of the draft that fits inside its box',
    });
    expect(
      await redBoundsIn(page, iconRegion),
      'the fitting draft already carries an overflow icon, so the icon is not reporting an overflow'
    ).toBeNull();

    // STATE B — three hard-broken lines, which do not: the box grows to the document's bottom
    // edge and the icon appears in its bottom-right corner.
    await replaceDraftLines(page, context, OVERFLOW_TEXT);
    await waitForBoxAtDocumentEdge();

    const icon = await redBoundsIn(page, iconRegion);
    expect(icon, 'no overflow icon while the type outgrows its box').not.toBeNull();
    // The icon is not "some red pixels in the region": it is an OUTLINE of the size the renderer
    // draws, in a corner no glyph in this test can reach (see OVERFLOW_TEXT). Measured here at
    // 8.0 x 8.25 CSS px against a derived 7.8, and asserted at 2 — the stroke is centred on the
    // drawn square, so the rasterised bound lands within a pixel of the nominal size either way,
    // and the region's 32 x 25 px is four times the icon, so nothing else could produce these
    // two numbers.
    expect(
      Math.abs(spanWidth(icon!) - OVERFLOW_INDICATOR_DOC_PX * fit.scale),
      'what is in the corner is not the size of the overflow icon'
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(spanHeight(icon!) - OVERFLOW_INDICATOR_DOC_PX * fit.scale),
      'what is in the corner is not the shape of the overflow icon'
    ).toBeLessThanOrEqual(2);
    // And it is in THAT corner, not merely inside the region: the centre of what was found is
    // measured 1.0 CSS px right of and 0.5 px below the point the arithmetic above names, and the
    // bound is 3. The whole box is 400 x 180 CSS px here, so a misplaced icon is 100s away.
    expect(
      Math.abs((icon!.left + icon!.right) / 2 - iconCentre.x),
      'the overflow icon is not in the right-hand side of the box'
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs((icon!.top + icon!.bottom) / 2 - iconCentre.y),
      'the overflow icon is not in the bottom of the box'
    ).toBeLessThanOrEqual(3);

    // STATE C — back to the one line that fits, so nothing outgrows the box any more and the icon
    // goes with it. THE WAIT IS ON THE ICON, and that is not a convenience: a box never shrinks
    // (`calculateNewRect` only ever grows, `rect.ts:159-161`), so the frame the overflow grew is
    // still there after the text shrinks and a wait on the frame would wait for a repaint that
    // never comes. The next two assertions say so, rather than leaving it as an assumption.
    await replaceDraftText(page, FITS_TEXT);
    await expect
      .poll(() => redBoundsIn(page, iconRegion), {
        message: 'the overflow icon leaving the corner of the box',
        timeout: 10_000,
      })
      .toBeNull();
    expect(
      await redBoundsIn(page, iconRegion),
      'the overflow icon survived the type going back inside its box'
    ).toBeNull();
    // The box really is still where the overflow left it, which is the rule the wait above had to
    // be written around: the frame is on the document's bottom edge and stays there.
    expect(
      await blueBoundsIn(page, documentEdgeStrip),
      'the box shrank back instead of keeping the height the overflow grew it to'
    ).not.toBeNull();

    // STATE D — and it is never IN the image. The overflowing type is committed, so the layer's
    // own canvas is what is on the screen, and the same region that held the icon must hold no
    // ink at all: `renderText` is called without `overflowIndicator` from the creator
    // (`src/tools/text.ts:611`), and baking the icon into the layer would paint a box-and-plus
    // into the user's photograph.
    await replaceDraftLines(page, context, OVERFLOW_TEXT);
    await expect
      .poll(() => redBoundsIn(page, iconRegion), {
        message: 'the overflow icon coming back with the third line',
        timeout: 10_000,
      })
      .not.toBeNull();
    await commit.click();
    await expect(draftOverlay(page), 'the draft outlived its commit').toHaveCount(0);
    await waitForCanvasPixels(page, canvasBoxClip(box), hasRedPixels, {
      description: 'the committed text layer',
    });
    expect(await redBoundsIn(page, iconRegion), 'the overflow icon was baked into the committed layer').toBeNull();
  });

  /**
   * Center alignment: the committed ink's left and right insets are balanced,
   * unlike left or right alignment where one inset is small and the other is large.
   *
   * `renderTextInto` resolves `'center'` to
   * `boxLeft + (boxRight - boxLeft - width) / 2`, so the first glyph starts midway
   * between the rectangle's left edge and the right edge minus the ink width. The
   * `inset` field measures how far INSIDE the rectangle each edge of the ink sits,
   * so for a centered band `inset.left` and `inset.right` are equal by construction.
   */
  test('center alignment centers the committed ink within the dragged rectangle', async ({ page }, testInfo) => {
    const box = await canvasBox(page);
    const alignSelect = page.locator('#align-select');
    const [left, center] = await commitStyledSeries(page, testInfo, box, 'WAVE', [
      { name: 'text-align-left', rect: DRAFT_RECT, apply: async () => undefined },
      {
        name: 'text-align-center',
        rect: SECOND_DRAFT_RECT,
        apply: async () => {
          await expect(alignSelect, 'alignment is not enabled on a paragraph draft').toBeEnabled();
          await alignSelect.selectOption({ value: 'center' });
          await expect(alignSelect).toHaveValue('center');
        },
      },
    ]);

    // Left-aligned (baseline): the ink hugs the left edge and recedes from the right.
    expect(left.inset.left, 'left-aligned text did not start near the left edge').toBeLessThan(20);
    expect(left.inset.right, 'left-aligned text did not reach away from the right edge').toBeGreaterThan(50);

    // Center-aligned: balanced insets — left and right distances are roughly equal.
    expect(
      Math.abs(center.inset.left - center.inset.right),
      'center-aligned text is not centered in the rectangle'
    ).toBeLessThan(15);
    // And the center commit's left inset is larger than the left-aligned one's,
    // because centering moves the first glyph away from the left edge.
    expect(
      center.inset.left - left.inset.left,
      'center alignment did not move the ink away from the left edge'
    ).toBeGreaterThan(20);

    expectInkInsideRect(left, box, DRAFT_RECT, 'the left-aligned commit');
    expectInkInsideRect(center, box, SECOND_DRAFT_RECT, 'the center-aligned commit');
  });

  /**
   * Zero line height stacks every line on the first baseline, collapsing three
   * wrapped lines to a single-line band of ink.
   *
   * `resolveTextStyle` accepts 0 as finite and drawable — its own comment states
   * the case directly. The line-height slider is a range input whose `min` is
   * `MIN_LINE_HEIGHT` (0.5), so the browser sanitizes any value below 0.5 and the
   * handler never sees 0 through the control. The bypass invokes the handler
   * directly via the React fiber, feeding it `{ target: { value: '0' } }` — the
   * exact shape `handleLineHeightChange` reads.
   */
  test('zero line height stacks all lines on one baseline', async ({ page, context }, testInfo) => {
    const box = await canvasBox(page);
    const lineHeightReadout = page.locator('label[for="line-height-slider"] span[aria-hidden="true"]');

    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box, DRAFT_RECT);

    // Invoke the handler directly via the React fiber to bypass the slider's min.
    await page.evaluate(() => {
      const slider = document.querySelector('#line-height-slider');
      if (!slider) throw new Error('zero LH: no line-height slider mounted');
      const fiberKey = Object.keys(slider).find((k) => k.startsWith('__reactFiber'));
      if (!fiberKey) throw new Error('zero LH: no React fiber found on slider');
      const fiber = (slider as unknown as Record<string, unknown>)[fiberKey] as unknown;
      const onChange = (fiber as { memoizedProps?: unknown })?.memoizedProps;
      const handler = (onChange as { onChange?: (event: { target: { value: string } }) => void })?.onChange;
      if (!handler) throw new Error('zero LH: no onChange handler in memoizedProps');
      handler({ target: { value: '0' } });
    });

    // The readout shows style.lineHeight.toFixed(1); '0.0' confirms the state is zero.
    await expect(lineHeightReadout, 'line height was not set to zero').toHaveText('0.0');

    // 'I\nI\nI' — three hard breaks, always three lines regardless of wrap width.
    await replaceDraftLines(page, context, 'I\nI\nI');
    await commitButton(page).click();

    // Wait for the committed ink, then measure the band height over the whole canvas.
    await waitForCanvasPixels(page, toClip(draftRectCss(box, POLL_MARGIN)), hasRedPixels, {
      description: 'red text pixels from the zero line-height commit',
    });
    const capture = await captureCanvasScreenshot(page, box, testInfo, 'text-zero-line-height');
    const image = await loadImageData(capture);
    const ink = await scanPixelsForBounds(image, isRedInk);
    expect(ink.found, 'no red pixels found for the zero line-height commit').toBe(true);
    const css = imageBoundsToCss({ width: image.width, height: image.height }, box, ink);

    // At 64px Arial, a single glyph row is about 44 CSS px tall. With three lines
    // stacked on one baseline (zero leading), the band cannot exceed a single line.
    // With any positive leading, three lines would be at least ~120px tall.
    expect(css.bottom - css.top, 'zero line height did not collapse the band to a single baseline').toBeLessThan(60);
  });

  /**
   * The Adobe minimum font size (0.01) commits a layer but renders ink too small to
   * clear the red-pixel threshold, proving the clamp reaches the renderer and not just
   * the field.
   *
   * `handleFontSizeCommit` clamps to `[FONT_SIZE_MIN, FONT_SIZE_MAX]`, so 0 clamps to
   * 0.01. That value is finite and accepted by `resolveTextStyle`, which passes it to
   * `renderText` — but 0.01px at the document's scale is a sub-pixel quantity, so
   * `fillText` draws nothing a pixel predicate that requires red > 180 can see.
   */
  test('the Adobe minimum font size commits a layer but renders ink below the red threshold', async ({
    page,
  }, testInfo) => {
    const size = page.locator('#font-size-input');
    const commit = commitButton(page);
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    // Clamp to the Adobe minimum: 0 → 0.01.
    await size.fill('0');
    await size.press('Enter');
    await expect(size, 'a zero size was not clamped to the Adobe minimum').toHaveValue('0.01');

    await setTextToolColor(page, TEXT_COLOR);
    await dragDraftRect(page, box, DRAFT_RECT);
    await replaceDraftText(page, 'X');
    await commit.click();

    // A layer IS created — 0.01 is a valid size, not a refusal.
    await expect(layerRows, 'the minimum font size created no layer').toHaveCount(2);
    await expect(layerRows.nth(0), 'the committed layer is not a text layer').toHaveText(TOOL_LAYER_NAME);

    // But the ink is too small to clear the red pixel threshold.
    const capture = await captureCanvasScreenshot(page, box, testInfo, 'text-size-min');
    const image = await loadImageData(capture);
    const ink = await scanPixelsForBounds(image, isRedInk);
    expect(ink.found, 'a 0.01px font rendered red ink above the isRedInk threshold').toBe(false);
  });
});
