import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { drawLine, getColorAtPoint, getWorkspaceCanvas, loadImageData } from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { cssPointToImage, type CssBox, type Point } from './helpers/screenshot-scale';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/**
 * The Layers panel of the right sidebar. `e2e/layers.spec.ts` owns reorder-by-drag and
 * delete, so nothing here repeats those.
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
    const canvasBox = await getWorkspaceCanvas(page).boundingBox();
    if (!canvasBox) throw new Error('Workspace canvas has no bounding box');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Page has no viewport size');

    /**
     * The canvas ELEMENT box is taller than the viewport - the main column scrolls - so the
     * two capture paths disagree about it. `page.screenshot({clip})` comes back clipped to
     * the viewport, while the CDP helper returns the whole clipped rect. Both captures are
     * therefore pinned to the same rect, the part of the canvas the viewport actually shows,
     * and that rect is the one the coordinates below are mapped onto. Without this the two
     * samplers read different rows of the same stroke and every colour assertion misses.
     */
    const region: CssBox = {
      x: Math.max(canvasBox.x, 0),
      y: Math.max(canvasBox.y, 0),
      width: Math.min(canvasBox.x + canvasBox.width, viewport.width) - Math.max(canvasBox.x, 0),
      height: Math.min(canvasBox.y + canvasBox.height, viewport.height) - Math.max(canvasBox.y, 0),
    };

    /** Screenshot of `region`, captured and attached by the CDP helper. */
    const capture = (name: string, testInfo: TestInfo) => captureCanvasScreenshot(page, region, testInfo, name);

    const stroke = async (color: string, line: { from: Point; to: Point }) => {
      await clickToolButton(page, 'draw');
      // verifySwatch asserts the store picked up the colour the draw tool will stroke with.
      await setForegroundColor(page, color, true);
      await drawLine(page, canvasBox, line.from.x, line.from.y, line.to.x, line.to.y, { steps: 15 });
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
    test.setTimeout(60_000);

    const { region, capture, stroke, colorAt, isBare, hasRed, hasBothStrokes, greenIsGone } = await setup(page);
    const layerRows = page.getByTestId(LAYER_ROW);

    await stroke('#ff0000', RED_STROKE);
    await stroke('#00aa00', GREEN_STROKE);
    // The bedrock blank layer plus one layer per stroke.
    await expect(layerRows).toHaveCount(3);
    // The panel lists the topmost layer first, so the green stroke owns the first row.
    const greenRow = layerRows.first();
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
    test.setTimeout(60_000);

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
    test.setTimeout(60_000);

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
    test.setTimeout(60_000);

    const { region, capture, stroke, colorAt, hasBothStrokes } = await setup(page);
    const layerRows = page.getByTestId(LAYER_ROW);

    await stroke('#ff0000', RED_STROKE);
    await stroke('#00aa00', GREEN_STROKE);
    await expect(layerRows).toHaveCount(3);
    await waitForCanvasPixels(page, region, hasBothStrokes, { description: 'both strokes composited before merging' });

    await clickToolButton(page, 'reposition');
    await page.getByRole('button', { name: 'Merge all' }).click();

    await expect(layerRows).toHaveCount(1);
    // The app names a flattened document "Merged Layer" plus its order suffix, so the row
    // is matched on the prefix rather than on a string that also encodes the layer count.
    await expect(layerRows.first().getByTestId(LAYER_NAME)).toHaveText(/^Merged Layer/);

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
    test.setTimeout(60_000);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    const layersList = page.getByTestId(LAYERS_LIST);
    const layerRows = page.getByTestId(LAYER_ROW);
    const historyRows = page.locator(`li[title="${HISTORY_ROW_TITLE}"]`);

    // One stroke -> the bedrock blank layer plus the drawn one.
    await expect(layerRows).toHaveCount(2);
    // The guard is only meaningful while the History panel actually has rows.
    expect(await historyRows.count(), 'the History panel rendered no rows').toBeGreaterThan(0);

    // Both panels really are one aside holding two lists of bare <li>.
    const sharedAside = page.locator('aside').filter({ has: layersList }).filter({ has: historyRows.first() });
    await expect(sharedAside).toHaveCount(1);

    // So a role-based list-item locator inside that aside is ambiguous, and the layer test
    // id is what tells the two apart. Every other panel's rows are outside the aside, which
    // is why the ambiguous count is taken from the aside rather than from the page.
    const layerRowCount = await layerRows.count();
    const historyRowCount = await historyRows.count();
    expect(await sharedAside.getByRole('listitem').count()).toBe(layerRowCount + historyRowCount);
    expect(await sharedAside.getByRole('listitem').count()).toBeGreaterThan(layerRowCount);
    await expect(layersList.getByTestId(LAYER_ROW)).toHaveCount(layerRowCount);
    expect(
      await historyRows.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.testid ?? null))
    ).not.toContain(LAYER_ROW);

    const layerTestIds = await layerRows.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.testid ?? null)
    );
    expect(layerTestIds).toEqual([LAYER_ROW, LAYER_ROW]);
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
