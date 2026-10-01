import { expect, test, type Locator, type Page, type TestInfo } from './fixtures/extended-test';
import {
  type BoundingBox,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  hasDarkPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  loadImageData,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { cssPointToImage, type CssBox, type Point } from './helpers/screenshot-scale';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Layers panel of the right sidebar. `e2e/layers.spec.ts` owns reorder-by-drag and
 * deleting layers, so nothing here repeats those — with one exception. That spec's last
 * act is to remove the final layer (`e2e/layers.spec.ts:123`) and it asserts nothing
 * afterwards, so the panel state that leaves is pinned here instead.
 *
 * Every colour assertion below reads PIXELS off the composited canvas rather than the
 * DOM. `SidebarRight.tsx` mounts the History and the Layers panel into ONE `<aside>` and
 * both emit bare `<li>` rows, so a DOM-only locator for "a layer row" cannot exist today
 * without a tooltip string standing in for a landmark. That is what `layer-row` fixes, and
 * `finds layer rows without matching History rows` is the regression guard for it.
 */

/** Labels of the Layers panel controls a spec legitimately drives. */
const HIDE_LAYER = 'Hide layer';
const SHOW_LAYER = 'Show layer';
/** The History panel's row tooltip. It is the only handle the History `<li>`s have. */
const HISTORY_ROW_TITLE = 'Click to go back to this state';

/** Test ids published by `LayersTab.tsx`. */
const LAYERS_LIST = 'layers-list';
const LAYER_ROW = 'layer-row';
const LAYER_NAME = 'layer-name';

/**
 * Two horizontal strokes on separate layers, far enough apart vertically that sampling
 * either one never reads the other. Box-relative, inside the same region
 * `e2e/layers.spec.ts` draws in and inside the part of the canvas the viewport shows.
 */
const RED_STROKE = { from: { x: 180, y: 200 }, to: { x: 440, y: 200 } };
const RED_SAMPLE = { x: 310, y: 200 };
const GREEN_STROKE = { from: { x: 180, y: 320 }, to: { x: 440, y: 320 } };
const GREEN_SAMPLE = { x: 310, y: 320 };

/**
 * The draw tool's default 3px stroke renders ~3.6 capture pixels wide, so the sample
 * window has to stay inside it. Radius 1 is a 3x3 window, which sits entirely in the
 * stroke's solid core at every row across the stroke; a wider window averages the white
 * bedrock in and erases the margin the two predicates below rely on. Measured on this
 * renderer: (255, 26, 26) for the red stroke and (26, 179, 26) for the green one.
 */
const STROKE_SAMPLE_RADIUS = 1;
/**
 * The window used to prove a colour is ABSENT. It is wider on purpose - a leftover
 * anti-aliased edge pixel is the only thing it can catch - and it skips near-white so
 * the white bedrock reads as "nothing painted here" rather than as white paint. Same
 * pattern as the delete case in `e2e/layers.spec.ts`.
 */
const ABSENCE_SAMPLE_RADIUS = 5;

type Rgb = { red: number; green: number; blue: number };

const isRed = (color: Rgb | null): boolean =>
  color !== null && color.red > 180 && color.green < 120 && color.blue < 120;

const isGreen = (color: Rgb | null): boolean =>
  color !== null && color.green > 120 && color.red < 120 && color.blue < 120;

const hasNoDarkPixels: CanvasPixelPredicate = async (screenshot) => !(await hasDarkPixels(screenshot));

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so strokes cannot be placed');
  return box;
}

const layerRows = (page: Page): Locator => page.getByTitle('Drag to reorder');
const layerRow = (page: Page, name: string): Locator => layerRows(page).filter({ hasText: name });

/**
 * The eye, by the label `LayersTab` mints from the layer's own `visible` flag, so the
 * locator names the state it is about to change and the two are the same fact read twice.
 */
const hideButton = (row: Locator): Locator => row.getByRole('button', { name: 'Hide layer' });
const showButton = (row: Locator): Locator => row.getByRole('button', { name: 'Show layer' });

/** The `<span>` holding the layer name, which is the only element `LayersTab` renames. */
const layerName = (row: Locator): Locator => row.locator('div.flex-1 > span');

/**
 * Clicks the row itself rather than anything inside it. `setActiveLayer` hangs off the
 * row's `onClick`, and the three things that sit on the row all intercept it: the eye and
 * the trash stop propagation explicitly, and the name span stops it unconditionally so
 * that a click inside an open rename does not also change the selection.
 *
 * The point clicked is the drag handle — `px-2` padding (8px), then the 24px eye, then an
 * 8px gap puts it at 40..56 — which is a real element inside the row and has no handler of
 * its own, so the event reaches the row. Its left-hand geometry is fixed by the row's own
 * classes, so it does not move when the panel is resized.
 */
async function activateRow(row: Locator): Promise<void> {
  await row.click({ position: { x: 48, y: 16 } });
}

test.describe('Layers panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  /**
   * Everything the five tests share: a stroke that lands on its own new layer (the Draw
   * tool area calls `createLayerFromTool` per stroke, `DrawToolArea.tsx:87`), and a pixel
   * reader that maps a canvas-relative point onto capture pixels with the repo's single
   * scaling rule rather than by dividing by devicePixelRatio.
   */
  const setup = async (page: Page) => {
    const box = await getWorkspaceCanvas(page).boundingBox();
    if (!box) throw new Error('Workspace canvas has no bounding box');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Page has no viewport size');

    /**
     * Both captures are pinned to ONE rect, because the two capture paths disagree about any
     * part of the canvas that leaves the viewport: `page.screenshot({clip})` comes back
     * clipped to the viewport, while the CDP helper returns the whole clipped rect. A rect
     * only one of them honours is a rect where the two samplers read different rows of the
     * same stroke and every colour assertion misses, so the coordinates below are mapped
     * onto the INTERSECTION of the canvas box and the viewport rather than onto the box.
     *
     * That intersection is the canvas box itself, and the reason is worth recording because
     * the claim it replaced was wrong: `html`, `body` and `#root` are all `height: 100%`
     * (`src/index.scss:58`), and `<main>` is a `1fr` grid item carrying `overflow-y-auto`
     * whose only child with a document open is `absolute h-full w-full`
     * (`src/components/Main/Main.tsx:230`). The document does not scroll, and the canvas
     * element cannot leave the viewport. The clamp stays because it is free while it is the
     * identity and the file still has to be right if that stops holding - `.zoom-container`
     * carries a commented-out `transform: scale(zoom)` (`Main.tsx:236`) that would put the
     * element box outside the viewport again.
     */
    const region: CssBox = {
      x: Math.max(box.x, 0),
      y: Math.max(box.y, 0),
      width: Math.min(box.x + box.width, viewport.width) - Math.max(box.x, 0),
      height: Math.min(box.y + box.height, viewport.height) - Math.max(box.y, 0),
    };

    /** Screenshot of `region`, captured and attached by the CDP helper. */
    const capture = (name: string, testInfo: TestInfo) => captureCanvasScreenshot(page, region, testInfo, name);

    const stroke = async (color: string, line: { from: Point; to: Point }) => {
      await clickToolButton(page, 'draw');
      // verifySwatch asserts the store picked up the colour the draw tool will stroke with.
      await setForegroundColor(page, color, true);
      await drawLine(page, box, line.from.x, line.from.y, line.to.x, line.to.y, { steps: 15 });
    };

    /** Reads a canvas-relative point out of a capture of `region`. */
    const colorAt = async (screenshot: Buffer, point: Point, radius?: number): Promise<Rgb | null> => {
      const image = await loadImageData(screenshot);
      const imagePoint = cssPointToImage(image, region, { x: region.x + point.x, y: region.y + point.y });
      return getColorAtPoint(image, Math.round(imagePoint.x), Math.round(imagePoint.y), radius);
    };

    /** Whether nothing but the white bedrock is painted at a canvas-relative point. */
    const isBare = async (screenshot: Buffer, point: Point): Promise<boolean> => {
      const image = await loadImageData(screenshot);
      const imagePoint = cssPointToImage(image, region, { x: region.x + point.x, y: region.y + point.y });
      const color = await getColorAtPoint(
        image,
        Math.round(imagePoint.x),
        Math.round(imagePoint.y),
        ABSENCE_SAMPLE_RADIUS,
        { ignoreNearWhite: true }
      );
      return color === null;
    };

    const hasRed = async (screenshot: Buffer) => isRed(await colorAt(screenshot, RED_SAMPLE, STROKE_SAMPLE_RADIUS));
    const hasGreen = async (screenshot: Buffer) =>
      isGreen(await colorAt(screenshot, GREEN_SAMPLE, STROKE_SAMPLE_RADIUS));
    const hasBothStrokes = async (screenshot: Buffer) => (await hasRed(screenshot)) && (await hasGreen(screenshot));
    const greenIsGone = (screenshot: Buffer) => isBare(screenshot, GREEN_SAMPLE);

    return { region, capture, stroke, colorAt, isBare, hasRed, hasGreen, hasBothStrokes, greenIsGone };
  };

  /**
   * HEADLINE. A layer row's visibility button changes what the compositor paints: the
   * hidden layer's pixels leave the canvas, the visible layer's stay. A DOM assertion on
   * the eye icon cannot see that, so both halves of the claim are read off the canvas.
   */
  test('hiding a layer removes its pixels from the composited canvas', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { region, capture, stroke, colorAt, isBare, hasRed, hasBothStrokes, greenIsGone } = await setup(page);
    const rows = page.getByTestId(LAYER_ROW);

    await stroke('#ff0000', RED_STROKE);
    await stroke('#00aa00', GREEN_STROKE);
    // The bedrock blank layer plus one layer per stroke.
    await expect(rows).toHaveCount(3);
    // The panel lists the topmost layer first, so the green stroke owns the first row.
    const greenRow = rows.first();
    await expect(greenRow).toContainText('draw 3');
    await expect(greenRow.getByRole('button', { name: HIDE_LAYER })).toBeVisible();

    await waitForCanvasPixels(page, region, hasBothStrokes, { description: 'both strokes composited' });
    const beforeHide = await capture('layers-panel-both-visible', testInfo);
    expect(isRed(await colorAt(beforeHide, RED_SAMPLE, STROKE_SAMPLE_RADIUS))).toBe(true);
    expect(isGreen(await colorAt(beforeHide, GREEN_SAMPLE, STROKE_SAMPLE_RADIUS))).toBe(true);

    await greenRow.getByRole('button', { name: HIDE_LAYER }).click();
    await expect(greenRow.getByRole('button', { name: SHOW_LAYER })).toBeVisible();

    await waitForCanvasPixels(
      page,
      region,
      async (screenshot) => (await greenIsGone(screenshot)) && (await hasRed(screenshot)),
      { description: 'the hidden layer out of the composite and the visible one still in it' }
    );
    const afterHide = await capture('layers-panel-green-hidden', testInfo);
    expect(await isBare(afterHide, GREEN_SAMPLE), 'the hidden layer is still painted at its own stroke').toBe(true);
    expect(
      isRed(await colorAt(afterHide, RED_SAMPLE, STROKE_SAMPLE_RADIUS)),
      'hiding one layer erased the other layer too'
    ).toBe(true);
  });

  test('renaming a layer commits the new name when Enter is pressed', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    // The topmost row is the layer just drawn. Its name is asserted before the rename,
    // because after it the row no longer contains the text this locator would filter on.
    const row = page.getByTestId(LAYER_ROW).first();
    await expect(page.getByTestId(LAYER_ROW)).toHaveCount(2);
    await expect(row).toContainText('draw 2');

    await enterRenameMode(row);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Sky');
    // Names the whole typed text, so a caret that never reached the editable fails here
    // with a readable message instead of surfacing as an unexplained commit failure.
    await expect(row.getByTestId(LAYER_NAME)).toHaveText('Sky');

    await page.keyboard.press('Enter');

    await expect(row).toContainText('Sky');
    await expect(row).not.toContainText('draw 2');
    await expect(row.getByTestId(LAYER_NAME)).toHaveAttribute('contenteditable', 'false');
  });

  test('abandoning a rename with Escape keeps the original name', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    const row = page.getByTestId(LAYER_ROW).first();
    await expect(page.getByTestId(LAYER_ROW)).toHaveCount(2);
    await expect(row).toContainText('draw 2');

    await enterRenameMode(row);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Discarded');
    await expect(row.getByTestId(LAYER_NAME)).toHaveText('Discarded');

    await page.keyboard.press('Escape');

    await expect(row).toContainText('draw 2');
    await expect(row).not.toContainText('Discarded');
    await expect(row.getByTestId(LAYER_NAME)).toHaveAttribute('contenteditable', 'false');
  });

  test('Merge all collapses the document to one layer and keeps the artwork', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { region, capture, stroke, colorAt, hasBothStrokes } = await setup(page);
    const rows = page.getByTestId(LAYER_ROW);

    await stroke('#ff0000', RED_STROKE);
    await stroke('#00aa00', GREEN_STROKE);
    await expect(rows).toHaveCount(3);
    await waitForCanvasPixels(page, region, hasBothStrokes, { description: 'both strokes composited before merging' });

    await clickToolButton(page, 'reposition');
    await page.getByRole('button', { name: 'Merge all' }).click();

    await expect(rows).toHaveCount(1);
    // The app names a flattened document "Merged Layer" plus its order suffix, so the row
    // is matched on the prefix rather than on a string that also encodes the layer count.
    await expect(rows.first().getByTestId(LAYER_NAME)).toHaveText(/^Merged Layer/);

    // One row is a claim about the panel. The artwork surviving the flatten is the claim
    // that matters, and only a pixel read can make it.
    await waitForCanvasPixels(page, region, hasBothStrokes, {
      description: 'the merged layer repainted both strokes',
    });
    const merged = await capture('layers-panel-merged', testInfo);
    expect(isRed(await colorAt(merged, RED_SAMPLE, STROKE_SAMPLE_RADIUS))).toBe(true);
    expect(isGreen(await colorAt(merged, GREEN_SAMPLE, STROKE_SAMPLE_RADIUS))).toBe(true);
  });

  /**
   * The scoping fix itself. `SidebarRight.tsx` renders the History and the Layers panel
   * into one `<aside>` and both emit bare `<li>` rows, so a role-based locator for a list
   * item inside that aside cannot separate them, and every existing spec escapes the
   * collision only through a differing tooltip string. This pins the shape that made that
   * necessary, and pins the test id that replaces it.
   */
  test('finds layer rows without matching History rows', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    const layersList = page.getByTestId(LAYERS_LIST);
    const rows = page.getByTestId(LAYER_ROW);
    const historyRows = page.locator(`li[title="${HISTORY_ROW_TITLE}"]`);

    // One stroke -> the bedrock blank layer plus the drawn one.
    await expect(rows).toHaveCount(2);
    // The guard is only meaningful while the History panel actually has rows.
    expect(await historyRows.count(), 'the History panel rendered no rows').toBeGreaterThan(0);

    // Both panels really are one aside holding two lists of bare <li>.
    const sharedAside = page.locator('aside').filter({ has: layersList }).filter({ has: historyRows.first() });
    await expect(sharedAside).toHaveCount(1);

    // So a role-based list-item locator inside that aside is ambiguous, and the layer test
    // id is what tells the two apart. Every other panel's rows are outside the aside, which
    // is why the ambiguous count is taken from the aside rather than from the page.
    const layerRowCount = await rows.count();
    const historyRowCount = await historyRows.count();
    expect(await sharedAside.getByRole('listitem').count()).toBe(layerRowCount + historyRowCount);
    expect(await sharedAside.getByRole('listitem').count()).toBeGreaterThan(layerRowCount);
    await expect(layersList.getByTestId(LAYER_ROW)).toHaveCount(layerRowCount);
    expect(
      await historyRows.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.testid ?? null))
    ).not.toContain(LAYER_ROW);

    const layerTestIds = await rows.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.testid ?? null)
    );
    expect(layerTestIds).toEqual([LAYER_ROW, LAYER_ROW]);
  });

  test('the eye takes a layer off the canvas and puts it back', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const box = await canvasBox(page);
    const clip = canvasRedrawClip(box);

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the stroke' });

    // One draw commits one layer on top of the bedrock one, so the stroke has a row of
    // its own and hiding it leaves the bedrock layer, which is white, showing through.
    const drawn = layerRow(page, 'draw 2');
    await expect(drawn).toBeVisible();
    await expect(hideButton(drawn), 'the label states the action, not the state').toBeVisible();

    await hideButton(drawn).click();
    await expect(showButton(drawn), 'the eye now offers to show it').toBeVisible();
    await waitForCanvasPixels(page, clip, hasNoDarkPixels, { description: 'the hidden layer' });

    await showButton(drawn).click();
    await expect(hideButton(drawn)).toBeVisible();
    await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the shown layer' });
  });

  test('hiding a layer is a history entry of its own', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForCanvasPixels(page, canvasRedrawClip(box), hasDarkPixels, { description: 'the stroke' });

    // Visibility is a document edit, so it belongs on the timeline. A layer attribute
    // that only lived in component state would pass the pixel test above and be lost on
    // the next undo, which is what this pins.
    const drawn = layerRow(page, 'draw 2');
    await hideButton(drawn).click();
    await expect(showButton(drawn)).toBeVisible();
    await expect(page.getByTestId('undo-button')).toBeEnabled();

    await page.getByTestId('undo-button').click();
    await expect(hideButton(drawn), 'undo put the layer back on the canvas').toBeVisible();
    await waitForCanvasPixels(page, canvasRedrawClip(box), hasDarkPixels, { description: 'the restored stroke' });
  });

  test('clicking a row makes that layer the one the next tool gesture edits', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    const drawBox = await canvasBox(page);
    // Two strokes 200px apart, on two layers. A single stroke on one layer would make the
    // first half of this test unfalsifiable: erasing the layer that holds nothing changes no
    // pixel, so "the pixels did not change" is also what "nothing happened at all" looks
    // like. A second layer, and a history row to prove the gesture was processed, are what
    // make the negative half mean something.
    await drawLine(page, drawBox, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
    const firstClip = canvasRedrawClip(drawBox);
    await waitForCanvasPixels(page, firstClip, hasDarkPixels, { description: 'the first stroke' });
    await drawLine(page, drawBox, LINE_START_X, LINE_START_Y + 200, LINE_END_X, LINE_START_Y + 200);
    const secondClip = { ...firstClip, y: firstClip.y + 200 };
    await waitForCanvasPixels(page, secondClip, hasDarkPixels, { description: 'the second stroke' });
    // Every history row, not just the draw ones: an eraser commit is titled after the
    // eraser, and the count is what says the gesture was processed at all.
    const historyRows = page.getByTitle('Click to go back to this state');
    await expect(historyRows, 'the document entry plus one per stroke').toHaveCount(3);

    // The eraser edits the ACTIVE layer in place, so it is the tool that makes
    // `setActiveLayer` observable. The draw tool could not: it commits a new layer every
    // time and never touches the one that was active. It is a secondary member of the brush
    // group, so it comes out of the flyout.
    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'eraser', label: 'Eraser Tool' });
    // The eraser bar is a different height from the draw bar, so the canvas box moves.
    // Measuring it once and reusing it is the defect `e2e/OPEN_PROBLEMS.md` records.
    const eraserBox = await canvasBox(page);
    const eraserFirst = canvasRedrawClip(eraserBox);
    const eraserSecond = { ...eraserFirst, y: eraserFirst.y + 200 };

    await activateRow(layerRow(page, 'draw 2'));
    await drawLine(page, eraserBox, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y, { steps: 20 });
    // The history row is the observable that the erase was PROCESSED. Without it the pixel
    // check below passes on its first poll, before the app has done anything, and the test
    // is green whether or not `activateRow` worked.
    await expect(historyRows, 'the erase committed an entry on the active layer').toHaveCount(4);
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: eraserSecond })), {
        message: 'the second stroke is on the other layer, so erasing the active one must leave it alone',
      })
      .toBe(true);

    await activateRow(layerRow(page, 'draw 3'));
    await drawLine(page, eraserBox, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y, { steps: 20 });
    await expect(historyRows, 'and the second erase committed one too').toHaveCount(5);
    await waitForCanvasPixels(page, eraserFirst, hasNoDarkPixels, {
      description: 'the erased stroke, on the layer that is active now',
    });
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: eraserSecond })), {
        message: 'the other layer is untouched by both erases',
      })
      .toBe(true);
  });

  test('renaming a layer is one history entry', async ({ page }) => {
    const undo = page.getByTestId('undo-button');
    await expect(undo, 'a freshly opened document has nothing to undo').toBeDisabled();

    const name = layerName(layerRow(page, 'Blank 1'));
    await name.click();
    await name.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Backdrop');
    await page.keyboard.press('Enter');

    await expect(layerRows(page).filter({ hasText: 'Backdrop' })).toHaveCount(1);
    await expect(undo, 'the rename is a document edit').toBeEnabled();

    await undo.click();
    await expect(layerRows(page).filter({ hasText: 'Blank 1' })).toHaveCount(1);
    await expect(layerRows(page).filter({ hasText: 'Backdrop' })).toHaveCount(0);
  });

  test('removing the last layer shows the panel empty state', async ({ page }) => {
    await expect(layerRow(page, 'Blank 1')).toBeVisible();
    await layerRow(page, 'Blank 1').getByRole('button', { name: 'Remove layer' }).click();
    await expect(layerRows(page)).toHaveCount(0);
    await expect(page.getByText('No layers yet.')).toBeVisible();
  });
});

/**
 * Puts a layer row's name into edit mode the way a user does: a click on the name, whose
 * mousedown sets `editingLayerId`, and a second click, which is the browser's own default
 * action of placing a caret inside what is by then a `contentEditable` span. The first click
 * is what enters edit mode; the second is what makes the caret deterministic.
 */
async function enterRenameMode(row: Locator): Promise<void> {
  const name = row.getByTestId(LAYER_NAME);
  await name.click();
  await expect(name).toHaveAttribute('contenteditable', 'true');
  await name.click();
  await expect(name).toBeFocused();
}
