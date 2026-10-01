import { expect, test, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas, hasDarkPixels, loadImageData, waitForCanvasPixels } from './helpers/canvas-helpers';
import {
  clickToolButton,
  generateSlug,
  getToolButton,
  hasOwnToolTile,
  openToolFlyout,
  openToolFlyoutViaKeyboard,
  resolveToolTile,
  selectFromFlyout,
  verifyPrimaryTool,
  openToolFlyoutViaRightClick,
  verifyHoverDoesNotOpenFlyout,
} from './helpers/toolbar-helpers';

/**
 * This file is about TILE flyouts, and the rail no longer always has the tile.
 *
 * The left rail is one column by default and fits whole 44px rows into the WHOLE of the slot
 * it has left after its own chrome — a fifth of that slot used to be reserved as headroom, and
 * the fit no longer reserves anything. At an ordinary 1280x720 window it shows seven of the
 * sixteen groups: Move, Marquee, Lasso, Magic Wand, Eyedropper, Crop and Colour. The other nine
 * — the Brush group down to Shape — move into a three-dots tile, so the Brush, Pen, Type and
 * Shape tiles are not on the rail at all, and it takes a window of 1094 for the rail to show
 * all sixteen. That is the product contract and not a defect: a tool is always reachable from
 * exactly one of a tile of its own or the three-dots flyout (`e2e/toolbar-overflow.spec.ts` pins
 * that reachability, `e2e/toolbar-fit.spec.ts` the arithmetic behind how many rows fit). What
 * it means for THIS file is that two questions must not be confused:
 *
 *   - a question about a TILE ("does this tile's flyout paint", "does Escape give focus back
 *     to this tile") needs a tile that EXISTS, and at a short window it may not;
 *   - a question about a TOOL ("is the Shape tool reachable") is true at every window.
 *
 * So the tests below come in three shapes, and each says which one it is:
 *
 *   (a) the TILE tests drive a group from the TOP of the rail. The collapse is a SUFFIX —
 *       the rows that do not fit are the bottom ones, and the top is the last thing to go —
 *       so a first-section group is the most insulated tile in the rail, and nothing about
 *       the fit's arithmetic or the window width has to be pinned here to keep it. Where a
 *       test is about a PICK, that also keeps the promotion claim: picking from a tile's own
 *       flyout rewrites that tile's test id, label and icon to the picked tool
 *       (`SidebarLeft.tsx`), whereas picking from the three-dots menu deliberately does NOT
 *       promote, because a tile that stands for no tool must not adopt one. So a test that
 *       wants a promoted tile to read a new label cannot get there through the overflow
 *       flyout at all, which is what leaves exactly ONE test below needing (b).
 *   (b) `selecting shape from flyout updates primary and patches figure`, and only that one,
 *       grows the window until the rail collapses nothing at all.
 *   (c) two tests — the pen group and the colors group — go the OTHER way and ask for the
 *       three-dots flyout on purpose, because their claim is that a collapsed group still
 *       lists every one of its tools. Their names say "present in flyout", not "on a tile".
 *       The Pen is the fourteenth row and needs a 1044px window for a tile, so an ordinary
 *       window folds it for free; the Colour group is the seventh and an ordinary window shows
 *       it, so its test SHORTENS the window to 600 to keep asking the same question.
 *
 * The fourth thing worth stating once, because several tests below are only meaningful with
 * it: `toBeVisible()` does not test CLIPPING. The rail is `overflow-y-auto`, which makes CSS
 * compute `overflow-x: auto` too, so a flyout laid out beside it and not portalled away
 * stays in the DOM with a non-empty box at the right coordinates and paints nothing. Every
 * geometry assertion here therefore goes through `elementFromPoint`, and every gesture that
 * is about paint goes through REAL `page.mouse` input rather than `dispatchEvent`.
 */

/**
 * The first-section groups these tests drive, and the second entry of the Wand group.
 *
 * `magic-wand` is the workhorse: it is the fourth row of the first section, it has a second
 * entry to pick, and a pick from it PROMOTES the tile (`SidebarLeft.tsx` rewrites the tile's
 * test id, label and icon to the picked tool) — which is what several of the tests below are
 * actually about, and the reason a name like `brush` cannot be used for them any more.
 */
const WAND = 'magic-wand';
const WAND_ALTERNATE = { toolName: 'quick-selection', label: 'Quick Selection Tool' };
/** Three items — the tallest menu on the rail at 720, tied with the Colour group's. */
const LASSO = 'freehand-lasso';
const MARQUEE = 'rectangular-selection';

/**
 * The premise a tile test rests on, asserted rather than assumed.
 *
 * Without it a tile the rail has folded away fails several lines later as "element(s) not
 * found" against a test id that is perfectly correct and simply absent, which reads as a
 * broken selector rather than as a window that is too short. The message names the fix.
 */
const expectTileOnRail = async (page: Page, toolName: string): Promise<void> => {
  // POLLED, not read once. The rail's fit is asynchronous: a viewport change reaches it
  // through a `ResizeObserver`, so for a frame after `setViewportSize` the plan is still the
  // old one and a tile the window has just grown room for has not come back yet. A one-shot
  // `hasOwnToolTile` therefore fails on a window that is about to be correct, which is
  // exactly what happened on the one test here that grows the window deliberately.
  await expect
    .poll(async () => await hasOwnToolTile(page, toolName), {
      message:
        `the rail does not show a "${toolName}" tile at this window, so this test — which is about ` +
        `that TILE's flyout — has no tile to drive. Drive a group from the top of the rail, or grow ` +
        `the window, rather than reaching for the three-dots tile: its menu is a different menu.`,
    })
    .toBe(true);
};

/** The item test id the app mints: `tool-flyout-item-<tool name>-<slugified label>`. */
const flyoutItem = (page: Page, toolName: string, label: string) =>
  page.getByTestId(`tool-flyout-item-${toolName}-${generateSlug(label)}`);

/**
 * A window tall enough that the one-column rail collapses NOTHING.
 *
 * Every number here is MEASURED in Chrome against this tree, and the window itself is chosen
 * from them. The rail's chrome is 135px — 8 of `py-2`, the 26px header row and its `mb-1` above
 * the tools box, and the `<hr>`'s 8 + 1 + 8, the 72px colour cluster and 8 of `py-2` again
 * below it. The tools box that `toolbar-fit-store.ts` charges for SEPARATELY has no padding
 * and no border left, so the slot is the tools box, and the tools box starts 138px below the
 * window top and ends 134px above its bottom: the slot is `H - 272`. The budget is the WHOLE
 * of that slot, floored to a whole pixel — it used to be 80% of it, which is what moved every
 * number in the next sentence.
 *
 * Sixteen rows of a 44px tile with fifteen 6px gaps and four 7px section separators is 822px,
 * so the fit collapses nothing at a slot of 822 and nothing above that: a viewport HEIGHT of
 * 1094. The old 80% budget needed a slot of 1027.5 for the same 822, which is the 1300 this
 * constant used to be derived from. `e2e/toolbar-fit.spec.ts` sweeps that boundary from both
 * sides rather than trusting this arithmetic: at 1100 every group has a tile, at 1000 thirteen
 * of the sixteen do.
 *
 * WIDTH carries none of this, and the distinction is the one that was wrong before: the fit reads
 * only the slot's height, so every width from 1024 to 1600 shows the same SEVEN tool tiles, and
 * the same three-dots tile, at 720 tall — eight tiles in all, where the 80% budget left room for
 * six of them. The tablet band is MORE generous rather than less — its header row renders empty,
 * which takes its chrome to 109 — so the same 720px window shows EIGHT tool tiles there, and a
 * 900px window is in that band rather than in the desktop one. What no width does is change the
 * rule: all sixteen groups are on the rail from 1094 tall, and a window under 680 shows fewer
 * than seven.
 *
 * So the height is the only number in this constant that carries weight, and 1500 leaves 406px
 * of slack over the 822 a full grid needs — eight more tool rows, at 50 a row, and 57 for one
 * that opens a section — before the premise would fail. 1400 left 80px under the old budget,
 * which was one row and a bit, and the grid grows every time the toolbar map does; a premise
 * that thin is one routine map change away from failing a test that has nothing to do with the
 * change. Read this as "the rail is not collapsed", never as "the window is this tall": the rule
 * is on the slot, and `e2e/toolbar-fit.spec.ts` owns the arithmetic.
 */
const NO_COLLAPSE = { width: 1280, height: 1500 };

/**
 * The box the shape test drags, in CSS pixels, centred on the canvas.
 *
 * A fixed size rather than a fraction of the canvas, because the app contains the document
 * in the viewport (`usePointerPosition`'s `ContainDimensions`): the image is letterboxed and
 * centred, so the canvas centre is inside the image at every viewport size, while a
 * percentage of the canvas can reach past the image's edge on a very wide one.
 */
const SHAPE_DRAG_WIDTH = 160;
const SHAPE_DRAG_HEIGHT = 120;

/** Half-width of a square patch sampled at a point, in CSS pixels. */
const SAMPLE_HALF_SIZE = 4;

/** `SidebarLeft.tsx`'s long-press threshold; the press below waits comfortably past it. */
const LONG_PRESS_SETTLE_MS = 400;

/** `ToolTooltip.tsx`'s hover threshold, plus slack. */
const TOOLTIP_SETTLE_MS = 400;

/**
 * Long-presses a tile with REAL mouse input.
 *
 * `openToolFlyout` dispatches `pointerdown`/`pointerup` straight at the element, which
 * never goes through hit testing, so it cannot observe whether the thing that opened is
 * actually on screen. The regression these tests cover was invisible to every test that
 * used it: the flyout was laid out and in the DOM, and the canvas was painted over the
 * place it would have appeared.
 */
const longPressWithMouse = async (page: Page, toolName: string): Promise<void> => {
  const button = page.getByTestId(`tool-button-${toolName}`);
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  if (!box) throw new Error(`longPressWithMouse: no box for tool-button-${toolName}`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_SETTLE_MS);
  await page.mouse.up();
  // Move off the tile so the hover tooltip goes away before anything is probed. Both
  // overlays are portalled next to the same anchor, and hovering the tile starts the
  // tooltip's 250ms timer before the press opens the flyout, so the tooltip is on
  // screen for most of the time a flyout is. The tooltip is `pointer-events-none`, so it
  // cannot now intercept a click — but a test that leaves it there is reading the
  // geometry of two overlapping overlays when it means to read one.
  await page.mouse.move(0, 0);
};

/**
 * Reads the geometry of every flyout item in one round trip, because the two failures
 * worth distinguishing are different: an item can be inside the viewport and still not be
 * painted (clipped by an ancestor), or it can be laid out outside it (a menu taller than the
 * window it is anchored in, which is what the three-dots menu is and what no real tile's
 * menu is any more — see the anchoring test below for why).
 *
 * The row's OWN box and its icon's are collected here too, because `rect` is already read
 * for the checks above and the density the flyout is drawn at is the one thing in this file
 * that nothing else measures. They are recorded, not asserted: the reader that consumes them
 * is the anchoring test, which is the only place a menu of the tallest shape the map has is
 * on screen.
 */
const readFlyoutGeometry = async (
  page: Page
): Promise<{
  itemCount: number;
  offscreen: string[];
  unpainted: string[];
  rowHeights: number[];
  iconHeights: number[];
}> =>
  page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    if (!menu) return { itemCount: 0, offscreen: [], unpainted: [], rowHeights: [], iconHeights: [] };

    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    const offscreen: string[] = [];
    const unpainted: string[] = [];
    const rowHeights: number[] = [];
    const iconHeights: number[] = [];

    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const label = item.getAttribute('aria-label') ?? item.textContent ?? 'unknown';

      rowHeights.push(rect.height);
      // The one `<svg>` a row always renders (`IconShell`, at whatever size the row's
      // `[&_svg]:!h-4` forces it to). A row with no icon is not a shape this menu has, so
      // the caller can require one entry per item rather than a smaller array of unknowns.
      const icon = item.querySelector('svg')?.getBoundingClientRect();
      if (icon) iconHeights.push(icon.height);

      if (rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
        offscreen.push(
          `${label} (${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)})`
        );
      }

      // `elementFromPoint` resolves through clipping: it returns whatever is actually
      // painted at that coordinate. A flyout clipped by the rail's scroll container
      // resolves to the canvas underneath it, not to the item.
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!hit || (hit !== item && !item.contains(hit))) {
        unpainted.push(`${label} (hit ${hit?.tagName ?? 'nothing'})`);
      }
    }

    return { itemCount: items.length, offscreen, unpainted, rowHeights, iconHeights };
  });

const readTooltipGeometry = async (
  page: Page
): Promise<{ missing: boolean; offscreen: boolean; unpainted: boolean; text: string }> =>
  page.evaluate(() => {
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    // Reported separately from the geometry: a tooltip that never appeared is a different
    // failure from one that appeared in the wrong place, and folding the two into
    // "offscreen" reports the first as the second.
    if (!tooltip) return { missing: true, offscreen: false, unpainted: false, text: '' };

    const rect = tooltip.getBoundingClientRect();

    // The tooltip is `pointer-events-none`, so it is skipped by hit testing even when it
    // is painted, and `elementFromPoint` would always report whatever is beneath it. The
    // element has to be made hit-testable for the probe to mean anything.
    const previous = tooltip.style.pointerEvents;
    tooltip.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    tooltip.style.pointerEvents = previous;

    return {
      missing: false,
      offscreen: rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight,
      unpainted: !hit || (hit !== tooltip && !tooltip.contains(hit)),
      text: tooltip.textContent ?? '',
    };
  });

/** Fails with the names of the offending items rather than a bare `offscreen: [...]`. */
const expectEveryItemPainted = (geometry: Awaited<ReturnType<typeof readFlyoutGeometry>>): void => {
  expect(geometry.itemCount).toBeGreaterThan(0);
  expect(geometry.offscreen, 'flyout items laid out outside the viewport').toEqual([]);
  expect(geometry.unpainted, 'flyout items whose centre is not painted (clipped by an ancestor)').toEqual([]);
};

test.describe('SidebarLeft - Flyout Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  test('long-press opens flyout for grouped tools', async ({ page }) => {
    // A first-section group, so the tile exists at the default window (see the file header).
    //
    // This one used to open the BRUSH group's own flyout through `openToolFlyout`, which
    // still passes now — the helper falls back to the three-dots tile and that menu lists the
    // Brush, the Pencil and the Color Replacement just the same. It was therefore passing for
    // a reason it no longer claimed: a GROUP's flyout is what a long press opens, and a menu
    // of thirty tools behind a different tile is not that. The Marquee group keeps the claim
    // and the test honest.
    await expectTileOnRail(page, MARQUEE);
    await openToolFlyout(page, MARQUEE);

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    await expect(flyout).toContainText('Rectangular Marquee Tool');
    await expect(flyout).toContainText('Elliptical Marquee Tool');
  });

  test('short click selects primary tool without opening flyout', async ({ page }) => {
    // The Wand tile is the group's primary and is selected by a plain click; the flyout needs
    // a press, a right-click or a key. Read off the tile, not off the tool — `verifyPrimaryTool`
    // resolves a tile, so with the Brush group folded into the three-dots tile it would read
    // "More Tools" and fail against a correct tile.
    await expectTileOnRail(page, WAND);
    await clickToolButton(page, WAND);

    // Flyout should not be visible
    await expect(page.getByRole('menu')).toBeHidden();

    // Verify primary tool is still the group's own first entry
    await verifyPrimaryTool(page, WAND, 'Magic Wand Tool');
  });

  test('right-click opens flyout for grouped tools', async ({ page }) => {
    // `openToolFlyoutViaRightClick` has no collapse fallback, by design: it asks for ONE NAMED
    // TILE's flyout and the three-dots menu is not that tile's menu. Hence a tile the rail
    // still shows.
    await expectTileOnRail(page, WAND);
    await openToolFlyoutViaRightClick(page, WAND);

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    await expect(flyout).toContainText('Magic Wand Tool');
  });

  test.skip('right-click does not open flyout for single-tool groups', async ({ page }) => {
    // Draw is a single tool (no group)
    //
    // KNOWN SKIP, recorded rather than justified here. The seven-line block this replaced
    // argued from "business value unclear" and cited `dd774cd` — a commit that does not
    // resolve in this checkout (`git cat-file -t dd774cd` is `Not a valid object name`), so
    // the one thing it offered as evidence for why the skip exists pointed at nothing. The
    // entry that does record it is `e2e/OPEN_PROBLEMS.md`, under `## Known-skip tests`, and
    // this is the second of the two `test.skip` declarations it lists.
    const drawButton = page.getByTestId('tool-button-draw');
    await expect(drawButton).toBeVisible();

    await drawButton.click({ button: 'right' });

    // Flyout should not appear
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('hover does not open flyout', async ({ page }) => {
    // `verifyHoverDoesNotOpenFlyout` names a tile and has no collapse fallback, like the
    // right-click helper above.
    await expectTileOnRail(page, WAND);
    await verifyHoverDoesNotOpenFlyout(page, WAND);
  });

  test('selecting from flyout updates primary tool', async ({ page }) => {
    // Open the Wand flyout and select the Quick Selection from it.
    //
    // The tile PROMOTES on a pick: the group keeps its tile and the tile adopts the picked
    // tool's icon, label and test id, so `tool-button-magic-wand` becomes
    // `tool-button-quick-selection` and the second half of this test — clicking the button
    // selects the promoted tool again — is a claim about that tile rather than about a
    // name. A collapsed group cannot demonstrate either half, because a pick from the
    // three-dots tile deliberately does NOT promote.
    await expectTileOnRail(page, WAND);
    await openToolFlyout(page, WAND);
    await selectFromFlyout(page, WAND_ALTERNATE);

    // Verify primary tool is now the Quick Selection
    await verifyPrimaryTool(page, WAND_ALTERNATE.toolName, WAND_ALTERNATE.label);

    // Clicking the button should select it again
    await clickToolButton(page, WAND_ALTERNATE.toolName);
    await verifyPrimaryTool(page, WAND_ALTERNATE.toolName, WAND_ALTERNATE.label);
  });

  test('selecting shape from flyout updates primary and patches figure', async ({ page }) => {
    // The ONE test in this file that cannot be moved to a first-section group, and the reason
    // is in its own name: it is about the SHAPE tile's LABEL. A pick promotes the tile that
    // carried it, so "the tile now reads Ellipse Tool" is only a statement about a tile — and
    // the three-dots tile is explicitly excluded from promotion, because a tile that stands
    // for no tool must not adopt one. Through the overflow flyout the label would stay
    // "More Tools" and the test would be asserting a different thing.
    //
    // So this is the case for giving the rail ROOM: grow the window until nothing collapses,
    // which puts the Shape group's own tile back at the END of the rail. `openToolFlyout` is
    // not enough on its own here — its collapse fallback would open the three-dots menu and
    // the premise guard would not fire, so the growth is asserted rather than assumed.
    await page.setViewportSize(NO_COLLAPSE);
    await expectTileOnRail(page, 'shape');

    // Open the shape flyout (grouped under the 'shape' tile)
    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Ellipse Tool' });

    // Verify the tile itself now shows Ellipse
    await verifyPrimaryTool(page, 'shape', 'Ellipse Tool');

    // Half of the claim is the figure, not the tile: `selectTool` calls
    // `patchToolArgs('shape', { figure })` as well as switching tools. The Shape options panel
    // prints the figure it was handed, so a patch that never landed shows up here as
    // "Rectangle Tool" - the default in `defaultSettings` - instead of "Ellipse Tool".
    await expect(page.getByLabel('Current shape')).toContainText('Ellipse Tool');

    // And the figure creator path, which is what the patch exists for: drag a box and look
    // at what the app commits. A shape is an outline by default, so a rectangle paints the
    // corners of the drag box and an oval curves away from them - the corner of the box sits
    // ~24px clear of the oval's stroke for this drag size, against dead on the rectangle's.
    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    const left = box.x + box.width / 2 - SHAPE_DRAG_WIDTH / 2;
    const top = box.y + box.height / 2 - SHAPE_DRAG_HEIGHT / 2;
    const right = left + SHAPE_DRAG_WIDTH;
    const bottom = top + SHAPE_DRAG_HEIGHT;
    const patch = (centreX: number, centreY: number) => ({
      x: centreX - SAMPLE_HALF_SIZE,
      y: centreY - SAMPLE_HALF_SIZE,
      width: SAMPLE_HALF_SIZE * 2,
      height: SAMPLE_HALF_SIZE * 2,
    });

    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();

    // Positive control first: the midpoint of the bottom edge is the one point an ellipse
    // inscribed in the drag box is guaranteed to touch, so a shape really was committed
    // there. Without it the corner assertions below would also pass on a canvas nothing was
    // ever drawn on.
    await waitForCanvasPixels(page, patch((left + right) / 2, bottom), hasDarkPixels, {
      description: 'the shape outline',
    });

    for (const [label, cornerX, cornerY] of [
      ['top left', left, top],
      ['top right', right, top],
      ['bottom left', left, bottom],
      ['bottom right', right, bottom],
    ] as const) {
      const corner = await loadImageData(await page.screenshot({ clip: patch(cornerX, cornerY) }));
      // `page.screenshot` truncates a clip at the viewport edge SILENTLY and returns a
      // shorter image. The app lays the canvas out taller than the window (the image is
      // contained, not cropped), and this test runs in a window grown to fit the whole rail,
      // so a sample point that drifted past the fold would decode to a small or empty strip -
      // which reads as "no dark pixels here" and turns this negative assertion into a false
      // pass. The size is therefore asserted before the pixels are read.
      expect(`${corner.width}x${corner.height}`, `shape ${label} corner capture, clipped at the viewport edge`).toBe(
        `${SAMPLE_HALF_SIZE * 2}x${SAMPLE_HALF_SIZE * 2}`
      );
      expect(await hasDarkPixels(corner), `shape ${label} corner`).toBe(false);
    }
  });

  test('flyout closes on outside click', async ({ page }) => {
    await expectTileOnRail(page, WAND);
    await openToolFlyout(page, WAND);
    await expect(page.getByRole('menu')).toBeVisible();

    // Click on body (outside flyout)
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('flyout closes on Escape key', async ({ page }) => {
    await expectTileOnRail(page, WAND);
    await openToolFlyout(page, WAND);
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('flyout closes when clicking active grouped tile again', async ({ page }) => {
    // A tile, not a tool. Through the three-dots tile this test used to pass for a reason it
    // did not claim: `clickToolButton('brush')` on a collapsed tool reopens the three-dots
    // menu and picks the Brush out of it, and a pick closes the menu — so "the menu closed"
    // said nothing about the second click on an open tile. The tile's own `onClick` is the
    // thing under test (`SidebarLeft.tsx`: an open grouped tile closes its flyout and
    // returns, without re-selecting), and that branch is only reachable on a tile that has
    // one.
    await expectTileOnRail(page, WAND);
    await openToolFlyout(page, WAND);
    await expect(page.getByRole('menu')).toBeVisible();

    // Click the Wand button again
    await clickToolButton(page, WAND);

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('long-press on different grouped tile switches flyout', async ({ page }) => {
    // Two groups from the first section, because `openToolFlyout` waits on the pressed tile's
    // own `aria-expanded`: a second tile that the rail folded away has no `aria-expanded` to
    // wait on, and a generic "a menu is visible" would be answered instantly by the still-open
    // first menu.
    await expectTileOnRail(page, WAND);
    await expectTileOnRail(page, LASSO);
    await openToolFlyout(page, WAND);
    await expect(page.getByRole('menu', { name: 'Magic Wand Tool tools' })).toBeVisible();

    // Long-press the Lasso tile
    await openToolFlyout(page, LASSO);

    // The Wand flyout should be closed, the Lasso flyout open
    await expect(page.getByRole('menu', { name: 'Magic Wand Tool tools' })).toBeHidden();
    await expect(page.getByRole('menu', { name: 'Lasso Tool tools' })).toBeVisible();
  });

  test('all lasso tools present in flyout', async ({ page }) => {
    await expectTileOnRail(page, LASSO);
    await openToolFlyout(page, LASSO);

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Lasso Tool');
    await expect(flyout).toContainText('Polygonal Lasso Tool');
    await expect(flyout).toContainText('Magnetic Lasso Tool');
  });

  test('all pen tools present in flyout', async ({ page }) => {
    // The ONE kind of test here that is deliberately not about a tile: the Pen group is a
    // collapsed row at an ordinary window, so `openToolFlyout` reaches it through the
    // three-dots tile and the claim under test is the one that has to survive the collapse —
    // that every tool of the group is listed by whichever flyout offers the group, not only
    // the one that tool has no tile for. Growing the window would make this duplicate the
    // tile's own flyout and stop it saying anything about the three-dots menu.
    await openToolFlyout(page, 'pen');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Pen Tool');
    await expect(flyout).toContainText('Freeform Pen Tool');
    await expect(flyout).toContainText('Curvature Pen Tool');
    await expect(flyout).toContainText('Add Anchor Point Tool');
    await expect(flyout).toContainText('Delete Anchor Point Tool');
    await expect(flyout).toContainText('Convert Point Tool');
  });

  test('all colors tools present in flyout', async ({ page }) => {
    // As the pen test above, and for the same reason — its claim is that the group's three
    // entries stay together in ONE menu rather than being split across a tile and a flyout.
    // The Pen is the fourteenth row and needs a 1044px window for a tile of its own, so an
    // ordinary window folds it and the test gets the three-dots menu for free. The Colour
    // group is the SEVENTH, and the whole-slot fit puts a tile there at 720: seven tool tiles
    // stand where the 80% budget left six, and the Colour group is one of them. Left at the
    // default window this would stop being a test of the three-dots menu and become a second
    // tile's own flyout — still passing, for a reason it no longer claims.
    //
    // So the window is shortened to 600, where the rail has room for five tool rows and the
    // three-dots tile, and the premise is ASSERTED rather than assumed, which is `expectTileOnRail`
    // inverted and the reason this cannot drift silently: a rail that grew room for a Colour tile
    // would leave the poll below true forever and fail here instead of quietly changing what the
    // test is about. 600 rather than something just under the 680 the Colour row needs, so that
    // no rounding change in the rail's own chrome can move the boundary past it.
    //
    // The premise of the resize itself is asserted first, for the same reason: nothing else in
    // this file says WHICH group the seventh row is. `e2e/toolbar-fit.spec.ts` pins the count at
    // 720 (seven of sixteen), this pins that the seventh is the Colour — and if the fit ever
    // folds it again, the test below still works and this line is what says the resize is no
    // longer needed.
    await expect(
      getToolButton(page, 'color'),
      'at 1280x720 the seventh visible row is the Colour group, which is why this test has to shorten the window'
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 600 });
    await expect
      .poll(async () => await hasOwnToolTile(page, 'color'), {
        message:
          'the rail has room for a "color" tile at 600px tall, so this test is about that TILE\'s flyout ' +
          `rather than the three-dots one. Shorten the window, or accept that the colour group's three ` +
          `entries are now reachable from a tile and rewrite the test around that.`,
      })
      .toBe(false);
    await openToolFlyout(page, 'color');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Colors');
    await expect(flyout).toContainText('Levels');
    await expect(flyout).toContainText('Transform');
  });

  test('pending long-press cancels on pointer leave', async ({ page }) => {
    // The tile's `onPointerLeave`, so it needs a tile the rail still shows.
    await expectTileOnRail(page, WAND);
    const button = getToolButton(page, WAND);
    await expect(button).toBeVisible();

    await button.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0); // Move away
    await page.mouse.up();

    await expect(page.getByRole('menu')).toBeHidden();

    // Control, and the reason the negative assertion above is worth anything: the same
    // long-press must still open a flyout. It used to sleep 400ms first and hope that was
    // longer than the app's delay, which is a vacuous pass the moment the delay is raised -
    // the assertion would then be taken before the cancelled timer could ever have fired.
    // `openToolFlyout` polls for the menu instead, so a broken long-press fails here rather
    // than passing as "the flyout stayed closed".
    await openToolFlyout(page, WAND);
    await expect(page.getByRole('menu')).toBeVisible();
  });

  // The rail is `overflow-y-auto`, which makes it clip horizontally as well, so the flyout
  // and the tooltip used to be laid out outside it and painted nowhere. `toBeVisible()`
  // cannot see that — it only checks for a non-empty box — which is why every assertion
  // below goes through `elementFromPoint`.
  test('a long-pressed flyout is painted, not clipped by the rail', async ({ page }) => {
    // REAL `page.mouse` input rather than `openToolFlyout`'s `dispatchEvent`, because the
    // point of this test is whether the thing that opened is on screen at all, and an event
    // dispatched straight at the element never goes through hit testing and so cannot see it.
    await expectTileOnRail(page, WAND);
    await longPressWithMouse(page, WAND);

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    expectEveryItemPainted(await readFlyoutGeometry(page));
  });

  test('a long-pressed flyout is anchored to its tile, with the whole menu on screen', async ({ page }) => {
    // This test used to open the SHAPE group's flyout and assert the vertical clamp, on the
    // arithmetic that the shape tile sat near the end of a 720px window and its six-item menu
    // would run past the fold — 254px then, and 153px in this tree (six 24.5px rows, `p-0.5`
    // and a 1px border). That arithmetic no longer describes this rail, and it is worth being
    // precise about why, because "just use a taller window" does not restore it:
    //
    //   - the shape group is a SUFFIX row, so at an ordinary window it has no tile at all;
    //   - growing the window puts the tile back but moves the fold with it.
    //
    // Every constant of that second point is MEASURED in Chrome against this tree, but the reason
    // the clamp is out of reach is not the one it was: there is no reserved fifth of empty slot
    // any more, and the headroom argument does not survive its removal. What replaces it is
    // arithmetic that holds at EVERY height. The first row's top is 138 (100 of shell above the
    // rail, 8 of `py-2`, the 26px header row and its `mb-1`), the in-section pitch is 50 (a 44px
    // tile and a 6px row gap), a section boundary costs 7 more, and the tools box ends 134px above
    // the window bottom. So the room UNDER the deepest visible tile is those 134, plus the
    // three-dots row the fit reserves (50) for as long as a collapse is in play, plus whatever
    // fraction of a row nothing could use — 184px, and never less, because the window has to
    // grow by 50 a row to keep a row visible while the row itself moves 50 down: the leftover
    // cannot shrink with depth. In symbols, with `b` section boundaries crossed, the k-th row's
    // top is `138 + 50(k - 1) + 7b`, the shortest window showing k tool rows is
    // `H >= 316 + 50k + 7b` (the slot is `H - 272` and the fit charges a row for the three-dots
    // tile), and the six-item menu ends at `241 + 50k + 7b` against a padded window bottom of at
    // least `308 + 50k + 7b` — 67px clear, for every k.
    //
    // Leaving the section separators out of that can only help the menu: a boundary costs 7 more,
    // which pushes a tile DOWN but is charged to the fit as well, so it cannot change the sign.
    // The one window tighter than the 67 is the one where nothing collapses, because there the
    // reserved row is not reserved: the full sixteen-row grid is 822 and needs a 1094px window,
    // and at 1094 the Shape tile is the deepest row of the whole map at y=916, its six-item menu
    // ends at 1069, and the padded window ends at 1086. Measured on the real map, and 17px is the
    // closest this rail has come to clamping one of its own menus — which is why the fit should
    // not be given a headroom fraction back.
    //
    // So the clamp is pinned where it is still reachable, and not here: `clampToViewport`'s
    // arithmetic is asserted in jsdom by `AnchoredOverlay.test.tsx`, and the one menu that IS
    // taller than a window — the three-dots menu, which is bounded and scrolls — is pinned
    // end to end by `e2e/toolbar-overflow.spec.ts`.
    //
    // What a browser can still be asked, and what this now asks, is the part that is true at
    // every window: the overlay is placed at its ANCHOR's top edge and every one of its items
    // is inside the window and painted. The Lasso is as tall a menu as the rail shows at 720 —
    // three items, matched by the Colour group and against the Wand's two, and every one of the
    // six-item menus in the map (Brush, Pen, Shape) is a collapsed row there — so it is the
    // closest stand-in for the six-item menu this used to open.
    await expectTileOnRail(page, LASSO);
    const tileTop = await getToolButton(page, LASSO).boundingBox();
    if (!tileTop) throw new Error(`no box for tool-button-${LASSO}`);

    await longPressWithMouse(page, LASSO);

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const geometry = await readFlyoutGeometry(page);
    expect(geometry.itemCount).toBeGreaterThan(1);
    expect(geometry.offscreen, 'flyout items laid out outside the viewport').toEqual([]);
    expect(geometry.unpainted, 'flyout items whose centre is not painted (clipped by an ancestor)').toEqual([]);

    // THE DENSITY OF A FLYOUT ROW, asserted here because nothing in `e2e/` measures a row's own
    // box: every other reference to a `menuitemradio` is focus, a `count()` or a test id. This
    // menu is as tall as any the rail opens at 720 — the taller ones in the map, the Brush,
    // Pen and Shape groups' six, are all on collapsed rows there — and every row of it measures
    // 24.5px in this tree: `py-1` around a 16.5px content box (the 11px label's line box at the
    // inherited 1.5), with a 16px icon because the row's `[&_svg]:!h-4` overrides `IconShell`'s
    // rail-sized `h-7`.
    //
    // The two bounds, and what each one is for, from breaks measured against this tree: putting
    // `py-1.5` back yields a 28.5px row with the icon still at 16, and dropping `[&_svg]:!h-4`
    // yields a 36px row with a 28px icon. 27 therefore rejects both while admitting the measured
    // 24.5 with 2.5px of slack. The icon's EXACT 16 is what pins the load-bearing utility itself,
    // and it is not redundant with the row bound: an 18px icon makes a 26.5px row, which the row
    // bound admits, so a re-sized icon is the one density regression a row-height bound cannot
    // see by construction.
    //
    // The control comes FIRST, and it is not bookkeeping: both bounds are taken over a collected
    // array, and `Math.max()` of an empty array is `-Infinity`, so a read that collected nothing
    // would sail through the row bound as a silent pass — the exact vacuity `AGENTS.md` rules
    // out. Tying both arrays to the item count the two assertions above already established is
    // stronger than a non-empty check: every row, and every row's icon, was measured.
    expect(geometry.rowHeights.length, 'every flyout item reported its own row box').toBe(geometry.itemCount);
    expect(geometry.iconHeights.length, 'every flyout item reported its own icon box').toBe(geometry.itemCount);
    expect(
      Math.max(...geometry.rowHeights),
      'flyout row height: `py-1` around a 16px icon. A regression to the pre-density row (40px measured), ' +
        'to `py-1.5` (28.5px measured), or to a lost `[&_svg]:!h-4` (36px measured) all fail here'
    ).toBeLessThanOrEqual(27);
    expect(
      [...new Set(geometry.iconHeights)],
      'flyout row icon height, the distinct sizes found: 16 is `IconShell`’s `h-7` overridden by ' +
        'the row’s `[&_svg]:!h-4`, which is the utility that makes the row 24.5px instead of 36px'
    ).toEqual([16]);

    // The placement, which the two assertions above cannot distinguish from any other spot on
    // the screen: `AnchoredOverlay` puts the menu at `anchorRect.top` and only clamps it to
    // the viewport padding afterwards, so a tile well below the padding is what says the
    // overlay is still following the TILE rather than the viewport.
    const menuBox = await menu.boundingBox();
    if (!menuBox) throw new Error('no box for the flyout');
    expect(Math.round(menuBox.y), 'the flyout is anchored to the top edge of the tile that opened it').toBe(
      Math.round(tileTop.y)
    );
  });

  test('clicking the menu itself keeps it open, though the menu is no longer inside the tile', async ({ page }) => {
    // The flyout is portalled, so the outside-click handler can no longer ask
    // `group.contains(target)`: a click on the menu's own padding reads as a click on an
    // element outside the tile, and the menu would close under the pointer. It matches
    // `data-toolbar-flyout` instead, which is what this pins. Nothing here is about which
    // group, so it runs on a tile the rail still shows.
    await expectTileOnRail(page, WAND);
    await longPressWithMouse(page, WAND);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    if (!box) throw new Error('no box for the flyout');

    // The claim is a click that lands on the MENU and NOT on one of its items, so the point is
    // derived from the menu's OWN padding and border rather than written down. It used to be a
    // hardcoded 2px from the border box, which was inside the old `p-1.5`; the menu is `p-0.5`
    // now, so that point sits 1px from the first item — one padding change away from picking a
    // tool, which closes the menu and fails this test for a reason that has nothing to do with
    // what it claims. The CENTRE of the padding band cannot be that, and reading the band off
    // the menu means the next density change moves the probe with it instead of past it.
    const inset = await menu.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        horizontal: Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft) / 2,
        vertical: Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop) / 2,
        padding: Number.parseFloat(style.paddingLeft),
      };
    });
    // A menu with no padding has no padding to probe, and the point below would land on the
    // border — or on an item, which is the failure this whole test would then misreport.
    if (!(inset.padding > 0)) {
      throw new Error(
        `the flyout has ${inset.padding}px of horizontal padding, so this test has no menu-owned point to click`
      );
    }
    const probe = { x: box.x + inset.horizontal, y: box.y + inset.vertical };

    // The control, and the reason the derived point cannot drift silently: the click has to land
    // inside the menu and outside every item, or the assertion below is measuring a pick.
    const landing = await menu.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      const items = Array.from(element.querySelectorAll('[role="menuitemradio"]'));
      return {
        tag: hit?.tagName ?? 'nothing',
        insideMenu: hit !== null && element.contains(hit),
        onItem: hit !== null && items.some((item) => item === hit || item.contains(hit)),
      };
    }, probe);
    expect(landing.insideMenu, `the probe point is inside the menu (it hit ${landing.tag})`).toBe(true);
    expect(
      landing.onItem,
      'the probe point is on a menu item, so the click below would pick a tool rather than test the menu'
    ).toBe(false);

    await page.mouse.click(probe.x, probe.y);

    await expect(menu).toBeVisible();
  });

  test('a right-clicked flyout is painted too', async ({ page }) => {
    // Right-click rather than the long press above, because it needs no timer: the
    // `pointerup` that follows can cancel a press the app has not opened yet. The helper
    // names a tile, so the tile is one the rail still shows.
    await expectTileOnRail(page, WAND);
    await openToolFlyoutViaRightClick(page, WAND);

    await expect(page.getByRole('menu')).toBeVisible();
    expectEveryItemPainted(await readFlyoutGeometry(page));
  });

  test('a right-clicked flyout still takes clicks once the hover tooltip has appeared', async ({ page }) => {
    // A right-click opens the flyout at once and the hover tooltip 250ms later, so the
    // tooltip is the overlay portalled last. When the portal wrapper was a hit target, its
    // shrink-wrapped box sat over the first flyout item, `locator.click()` timed out on it,
    // and the outside-click handler read the click as outside the group — the menu closed
    // with nothing selected.
    //
    // The pick PROMOTES the tile, so the assertion at the end is that the tile the menu came
    // out of now reads the picked tool: a menu that closed with nothing selected would leave
    // it reading "Magic Wand Tool" and fail there, which is the half of the old shape-based
    // version that made this worth pinning.
    await expectTileOnRail(page, WAND);
    await openToolFlyoutViaRightClick(page, WAND);
    await getToolButton(page, WAND).hover();
    // Well past `ToolTooltip`'s 250ms threshold, so the tooltip is definitely on screen.
    await page.waitForTimeout(600);
    await expect(page.getByRole('tooltip')).toBeVisible();

    await flyoutItem(page, WAND_ALTERNATE.toolName, WAND_ALTERNATE.label).click();

    await expect(page.getByRole('menu')).toBeHidden();
    await expect(getToolButton(page, WAND_ALTERNATE.toolName)).toHaveAttribute('aria-label', WAND_ALTERNATE.label);
  });

  test('Tab closes an open flyout, with focus on the tile or inside the menu', async ({ page }) => {
    await expectTileOnRail(page, WAND);
    const button = getToolButton(page, WAND);
    await expect(button).toBeVisible();

    // Focus is set explicitly rather than left to the browser as a side effect of
    // mousedown: this test is about what Tab does from each of the two places focus can
    // be, so it has to be in one of them rather than usually in one of them.
    await button.focus();
    await longPressWithMouse(page, WAND);
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(button).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toBeHidden();

    // ArrowDown is what moves focus into the menu; from there Tab leaves it.
    await button.press('ArrowDown');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitemradio').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('crossing the tablet boundary closes the flyout instead of reopening it', async ({ page }) => {
    // The two layouts number the same groups differently, so a stale `openGroup` matches
    // nothing at the boundary and matches again on the way back — the menu reappearing with
    // nothing the user did to open it. This is the one way the anchor can be left detached:
    // the open tile is not closed, it is unmounted.
    //
    // A tile the rail shows on BOTH sides of the boundary, so what is being crossed is the
    // LAYOUT and not the collapse. (Through the three-dots tile the crossing would also
    // change which groups are folded away, and the test could no longer tell the two apart.)
    await expectTileOnRail(page, WAND);
    await openToolFlyout(page, WAND);
    await expect(page.getByRole('menu')).toBeVisible();

    await page.setViewportSize({ width: 900, height: 720 });
    await expect(page.getByRole('menu')).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByTestId('left-sidebar')).toBeVisible();
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('crossing into mobile closes the flyout, which the rail hiding cannot do on its own', async ({ page }) => {
    // Below `md` the rail is `display: none` rather than restyled, and the portal escapes
    // that — so nothing about the menu's own placement stops it. Its anchor's box is zeroed
    // by the hiding, which the clamp turns into the viewport's top-left corner, leaving a
    // menu painted and clickable over a mobile shell with no tile under it.
    await expectTileOnRail(page, WAND);
    await openToolFlyout(page, WAND);
    await expect(page.getByRole('menu')).toBeVisible();

    await page.setViewportSize({ width: 600, height: 720 });

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('Escape hands focus back to the tile that opened the menu', async ({ page }) => {
    // Opened from the KEYBOARD and with focus moved into the menu, deliberately. A long press
    // with a real mouse leaves focus on the tile already, so a test set up that way would
    // pass with or without the restore and would be measuring nothing. The menu is portalled
    // into `document.body`, so unmounting it takes the focused item with it: measured without
    // the restore, focus landed on `document.body` and the next Tab restarted at the
    // document's first tabbable — 16 tab stops before the rail.
    //
    // The restore is to the TILE, so this needs one: `openToolFlyoutViaKeyboard` names a tile
    // and has no collapse fallback, and the three-dots tile would make the final assertion
    // read a tile that is not the one that opened the menu.
    await expectTileOnRail(page, WAND);
    const button = getToolButton(page, WAND);
    await expect(button).toBeVisible();
    await openToolFlyoutViaKeyboard(page, WAND);
    await expect(page.getByRole('menuitemradio').first()).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('menu')).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('picking an item with the mouse does not move focus back to the tile', async ({ page }) => {
    // The restore is for the KEYBOARD's close. A mouse pick has already focused the item the
    // user clicked, and taking focus back to the tile would arm ToolTooltip's 250ms focus
    // timer — so a tooltip would paint over a selection the mouse user never asked to see.
    //
    // A pick PROMOTES, so the tile that opened this menu is afterwards addressed as
    // `tool-button-quick-selection`. The locator is resolved rather than written down, for
    // the reason that matters here: a `not.toBeFocused()` against the id the tile HAD when it
    // opened matches nothing once the id has changed, and passes for that reason alone
    // instead of because focus is elsewhere. The `toBeVisible()` in front of it is the
    // control — it fails on a locator that resolved to zero elements, so the negative
    // assertion can only mean "focus is not on that tile".
    await expectTileOnRail(page, WAND);
    await openToolFlyoutViaRightClick(page, WAND);
    const item = flyoutItem(page, WAND_ALTERNATE.toolName, WAND_ALTERNATE.label);
    await item.click();

    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.getByRole('tooltip')).toBeHidden();
    const tile = await resolveToolTile(page, WAND_ALTERNATE.toolName);
    await expect(tile, 'the tile that opened the menu, promoted to the tool that was picked').toBeVisible();
    await expect(tile).not.toBeFocused();
  });

  test('a hovered tool tooltip is painted, not clipped by the rail', async ({ page }) => {
    // A tile the rail still shows, and the first-section one the collapse reaches last.
    await expectTileOnRail(page, WAND);
    const button = getToolButton(page, WAND);
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    if (!box) throw new Error(`no box for tool-button-${WAND}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(TOOLTIP_SETTLE_MS);

    const geometry = await readTooltipGeometry(page);
    expect(geometry.missing, 'no tooltip appeared within its hover threshold').toBe(false);
    expect(geometry.text).toContain('Magic Wand Tool');
    expect(geometry.offscreen, 'tooltip laid out outside the viewport').toBe(false);
    expect(geometry.unpainted, 'tooltip is laid out but not painted (clipped by an ancestor)').toBe(false);
  });
});
