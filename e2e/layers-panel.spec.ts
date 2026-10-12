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
import { clickToolButton, expectToolSelected, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
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

/**
 * The `<span>` holding the layer name, which is the only element `LayersTab` renames.
 *
 * By the test id rather than by the structure around it. `div.flex-1 > span` resolves today
 * and breaks on a cosmetic class rename - `flex-1 min-w-0` is styling, not a contract - with
 * a locator error that reads as a broken spec rather than as a product signal; and a
 * structural selector that ever resolved to two nodes turns every `click()` on it into a
 * strict-mode violation instead of a rename. `LayersTab` publishes `data-testid="layer-name"`
 * on the element itself (`LayersTab.tsx:211`), so this moves when the element moves and not
 * when the styling does.
 */
const layerName = (row: Locator): Locator => row.getByTestId(LAYER_NAME);

/**
 * The row's own resolved background. Read from computed style rather than from its class
 * list, so it follows the styling rather than its spelling.
 *
 * `borderColor` is the channel this is NOT read from, and the reason is worth writing down so
 * that it is not re-derived: `LayersTab.tsx:185`'s `border-transparent` is on EVERY row and it
 * WINS the cascade, so the active row's resolved border is transparent too and the border
 * carries no state at all. Measured on the row the click had just made active — whose class
 * list read `… border border-transparent hover:bg-white/70 dark:hover:bg-gray-700/40 bg-white
 * dark:bg-gray-700/60 border-gray-200 dark:border-gray-600` — `borderTopColor` was
 * `rgba(0, 0, 0, 0)`, identical to every inactive row's. `:187` is the only branch in that
 * class list that names a border colour, and it names one that loses.
 */
const rowFill = (row: Locator): Promise<string> => row.evaluate((node) => getComputedStyle(node).backgroundColor);

/**
 * What `bg-transparent` (`LayersTab.tsx:187`) resolves to, and so — once nothing is hovering
 * the row — the one value a row that is NOT the active layer can report here. The active
 * branch's `bg-white` is opaque, so "not transparent" and "is the active layer" are the same
 * claim read off the resolved value.
 */
const TRANSPARENT_FILL = 'rgba(0, 0, 0, 0)';

/**
 * Whether the pointer is resting on this row, which is what decides whether its resolved
 * background means anything. Read through `:hover` rather than inferred from the fill,
 * because the hover fill is not a value any other state produces: `LayersTab.tsx:186`'s
 * `hover:bg-white/70` is emitted AFTER `:187`'s `bg-white`, so it overrides it, and a row under
 * the pointer computes `oklab(… / 0.7)` whether it is the active layer or not.
 */
const isHovered = (row: Locator): Promise<boolean> => row.evaluate((node) => node.matches(':hover'));

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
 *
 * And then it WAITS for the click to have taken effect, which is the half that matters and
 * the half a bare `click()` cannot give. `setActiveLayer` is a store dispatch, so the
 * selection lands on the render after the click's discrete-event flush, and a gesture
 * driven straight after `click()` can be picked up by the PREVIOUS active layer — which on
 * the eraser is a layer holding no ink where the new gesture is aimed, so not one pixel
 * moves and the gesture is indistinguishable from one that was never aimed anywhere.
 *
 * `other` is a row that must NOT become active, and the wait is for the clicked row to be the
 * opaque one while `other` is the transparent one: `LayersTab`'s own statement of who is
 * active, read rather than guessed. The DIRECTION is load-bearing, which is why this is not
 * "the two rows' fills differ". A click that changed nothing at all leaves the clicked row
 * inactive and the previously-active `other` still active, and those two differ in exactly
 * the shape a successful click produces. Requiring BOTH is what pins the direction;
 * `LayersTab.tsx:113` derives `isActive` from one `activeLayerId`, so `other` going transparent
 * is the same fact as the clicked row going opaque, read from the other side.
 *
 * The poll samples rather than reading once, because it is carrying two waits: the re-render
 * after the dispatch, and the browser applying the pointer's departure from the row.
 */
async function activateRow(row: Locator, other: Locator): Promise<void> {
  await row.click({ position: { x: 48, y: 16 } });
  // Off the row before either fill is read, because Playwright leaves the pointer ON the
  // click point. That is what made the old `rowFill(row) !== rowFill(other)` unsatisfiable
  // as a gate: `hover:bg-white/70` overrode `bg-transparent` on the clicked row, so the two
  // fills differed on the first sample with `setActiveLayer` deleted outright — measured, with
  // `onClick` commented out, the poll passed and the run only failed later on a pixel
  // assertion. The viewport's top-left corner is off every row — the panel is docked to the
  // right edge — and nothing else is being asserted about what is under the pointer.
  await row.page().mouse.move(0, 0);
  await expect
    .poll(
      async () => {
        if (await isHovered(row)) return false;
        const clicked = await rowFill(row);
        const untouched = await rowFill(other);
        return clicked !== TRANSPARENT_FILL && untouched === TRANSPARENT_FILL;
      },
      {
        message: 'the clicked row never became the active layer, so the next gesture would edit the wrong one',
      }
    )
    .toBe(true);
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

    // The rename PATCHED the row that was there. It is the only claim a row count can make
    // from outside: `LayersTab.tsx:90` is the only writer, and it publishes nothing about
    // which record it touched — the row carries `data-testid="layer-row"` but no layer id
    // (`LayersTab.tsx:122-138` puts the element in a ref map, not in the DOM), so an id
    // assertion would need a product change to be available at all.
    //
    // Without this, a rename that ADDED a renamed copy beside the original leaves two rows
    // and this test fully green: `row` is `rows.first()`, a fresh layer gets
    // `maxLayerOrder + 1` and is therefore topmost, and every text assertion below reads
    // the copy.
    await expect(page.getByTestId(LAYER_ROW), 'the rename created a second layer').toHaveCount(2);
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

    const { region, capture, stroke, colorAt, hasBothStrokes, hasRed, hasGreen } = await setup(page);
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

    // WHOSE artwork is that? Everything above is a read of pixels that were already on the
    // canvas before the merge ran, and that is the trap: `mergeAllLayers` derives its raster
    // FROM the canvas it is about to replace (`createImageBitmap(canvasRef.current)`,
    // `useLayer.ts:732`), and `drawLayersToCanvas` is built to leave the last visible canvas
    // intact when a source or processor fails (`layer-renderer.ts:130-137,160-163`). So a
    // merge that publishes one row named `Merged Layer` whose layer never composites leaves
    // the pre-merge composite on the glass, and this test stays green — the assertions above
    // are read against the very pixels the flatten was supposed to replace.
    //
    // Hiding the merged layer is the only read that separates the two: if the merged layer
    // owns the artwork, hiding it takes the artwork with it.
    //
    // Read as "these colours are gone" rather than through `isBare`, because the bare
    // reading has a floor this document sits below: with the merged layer hidden the canvas
    // is fully transparent, so the workspace's `#f3f3f3`/`#fff` CHESSBOARD shows through
    // (`src/index.scss:140`) and `isBare` — which skips only pixels above 250 in every
    // channel — cannot call that nothing painted.
    const mergedRow = rows.first();
    await hideButton(mergedRow).click();
    await expect(showButton(mergedRow), 'the eye now offers to show the merged layer').toBeVisible();
    await waitForCanvasPixels(
      page,
      region,
      async (screenshot) => !(await hasRed(screenshot)) && !(await hasGreen(screenshot)),
      {
        description: 'the merged layer owns the artwork, so hiding it takes the artwork off the canvas',
      }
    );
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
    const clip = canvasRedrawClip(box);
    await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the stroke' });

    // Visibility is a document edit, so it belongs on the timeline. A layer attribute
    // that only lived in component state would pass the pixel test above and be lost on
    // the next undo, which is what this pins.
    const drawn = layerRow(page, 'draw 2');
    // The count the hide's own entry is measured AGAINST, asserted rather than read off a
    // first poll: a count taken before the stroke's entry lands is one low, which would turn
    // "exactly one entry" into "at most one". One stroke is the document entry plus one.
    const historyRows = page.getByTitle(HISTORY_ROW_TITLE);
    await expect(historyRows, 'the document entry plus the stroke').toHaveCount(2);
    const beforeHide = await historyRows.count();

    await hideButton(drawn).click();
    await expect(showButton(drawn)).toBeVisible();
    // And the hide has to have REPAINTED before the undo means anything. Without this the
    // wait at the end is the same predicate as the one above — dark pixels over this clip —
    // and the canvas is still dark from before the hide, so it is satisfied on the first
    // poll and an undo that restored nothing passes. Going bare first is what makes the
    // restored stroke a claim about the undo rather than about the stroke.
    await waitForCanvasPixels(page, clip, hasNoDarkPixels, { description: 'the hidden layer' });
    // ONE history entry, read off the panel's own rows rather than off the undo button.
    // `canUndo()` is `historyIndex > 0` — defined at `src/contexts/useHistory.ts:46-47`, and
    // consumed at `HistoryControls.tsx:46` as `disabled={!canUndo()}`. It is true for one
    // entry and for fifty, so `toBeEnabled()` cannot tell a hide from a hide that appended
    // three — and one undo then lands somewhere else entirely while every assertion here
    // still passes. Every row is counted, not the visible ones: a row the user has toggled
    // off is still on the timeline.
    await expect(historyRows, 'the hide is ONE entry of its own').toHaveCount(beforeHide + 1);
    // And the hide changed the layer's visibility, not the document's layer list.
    await expect(layerRows(page), 'a hide added or removed a layer').toHaveCount(2);

    await page.getByTestId('undo-button').click();
    await expect(hideButton(drawn), 'undo put the layer back on the canvas').toBeVisible();
    await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the restored stroke' });
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
    // Read separately, once per tool, and that re-read is sound — but not for the reason it
    // used to be given. The eraser bar and the draw bar really are different heights, and
    // that is what used to be recorded here as the canvas box MOVING. It does not move: both
    // bars mount in the toolbar row, whose height `TOOLBAR_BASE_CLASS` fixes at 50px, while
    // the canvas sits in the main area, a different row in `App.tsx`. A bar taller than 50px
    // paints over the workspace rather than reflowing it, and painting is not layout — so the
    // two boxes above coincide, and the re-read cannot make a difference on this layout. It
    // is here so that a layout which did let a tool resize the workspace would put the box the
    // finished eraser bar produced under the erase, rather than a stale one aimed at the
    // strokes' own bands.
    const eraserBox = await canvasBox(page);
    const eraserFirst = canvasRedrawClip(eraserBox);
    const eraserSecond = { ...eraserFirst, y: eraserFirst.y + 200 };
    /**
     * Erasing `drawY` pixels below the top of the box the strokes were drawn in. Both
     * erases go through it so the two are aimed the same way, at the same bands the clips
     * above are cut from — which is the whole reason the second erase can be aimed at the
     * SECOND stroke instead of at the first one's band a second time.
     */
    const eraseBand = (drawY: number) =>
      drawLine(page, eraserBox, LINE_START_X, drawY, LINE_END_X, drawY, { steps: 20 });

    // The precondition of the second half, asserted rather than assumed: the band the
    // second erase is about to be aimed at is dark now, so "it went bare" afterwards is a
    // transition and not a state that already held.
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: eraserSecond })), {
        message: 'the second stroke is on its own layer, and it is still there before anything erases it',
      })
      .toBe(true);

    await activateRow(layerRow(page, 'draw 2'), layerRow(page, 'draw 3'));
    await eraseBand(LINE_START_Y);
    // The history row is the observable that the erase was PROCESSED. Without it the pixel
    // check below passes on its first poll, before the app has done anything, and the test
    // is green whether or not `activateRow` worked.
    await expect(historyRows, 'the erase committed an entry on the active layer').toHaveCount(4);
    // The erase went through, on the FIRST stroke: this is the transition the whole test is
    // about, and it can only happen on the layer that holds it.
    await waitForCanvasPixels(page, eraserFirst, hasNoDarkPixels, {
      description: 'the first stroke, erased on the layer that was activated',
    });
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: eraserSecond })), {
        message: 'the second stroke is on the other layer, so erasing the active one must leave it alone',
      })
      .toBe(true);

    // And the SAME GESTURE aimed at the OTHER band. Aimed at `LINE_START_Y` instead — which
    // is where the first erase went — this half could not fail: `draw 3` carries nothing in
    // that band, so whether the row click activated `draw 3`, `draw 2`, or nothing at all,
    // not one pixel moved, and only the history count below was ever live. Aimed at
    // `eraserSecond`, the band goes bare only if the active layer really is the one that
    // holds the second stroke — which is the named claim.
    await activateRow(layerRow(page, 'draw 3'), layerRow(page, 'draw 2'));
    await eraseBand(LINE_START_Y + 200);
    await expect(historyRows, 'and the second erase committed one too').toHaveCount(5);
    await waitForCanvasPixels(page, eraserSecond, hasNoDarkPixels, {
      description: 'the second stroke, erased on the layer that was activated',
    });
    // The first erase's effect is still there: erasing the other layer is not undoing this
    // one. Checked once the transition above has landed, so it is read against the state the
    // second gesture produced rather than against the state before it.
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: eraserFirst })), {
        message: 'the second erase put the first stroke back — it edited the wrong layer',
      })
      .toBe(false);
  });

  test('renaming a layer is one history entry', async ({ page }) => {
    const undo = page.getByTestId('undo-button');
    await expect(undo, 'a freshly opened document has nothing to undo').toBeDisabled();

    // The count the rename is measured AGAINST, asserted rather than read off a first poll.
    // A freshly opened document carries exactly one entry — the open itself
    // (`useApp.ts:120` seeds the timeline with it) — so the precondition is a fact about the
    // panel rather than a zero, and "one entry" below means two rather than "one more than
    // whatever happened to be there".
    const historyRows = page.getByTitle(HISTORY_ROW_TITLE);
    await expect(historyRows, 'the entry the document opens with').toHaveCount(1);
    const beforeRename = await historyRows.count();

    const row = layerRow(page, 'Blank 1');
    await enterRenameMode(row);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Backdrop');
    await page.keyboard.press('Enter');

    await expect(layerRows(page).filter({ hasText: 'Backdrop' })).toHaveCount(1);
    // The rename PATCHED the row that was there rather than publishing a renamed copy beside
    // it. Every other assertion in this test filters on the name, so a document that went
    // from one row to two — `Backdrop` on one of them, `Blank 1` on the other — sails
    // through all of them and the undo below then removes the copy and leaves both names
    // where they were. The row count is the strongest channel available from outside: the
    // row publishes no layer id (`LayersTab.tsx:122-138` keeps the element in a ref map, not
    // in the DOM), so asserting on identity would take a product change to be possible.
    await expect(layerRows(page), 'the rename created a second layer instead of renaming the first').toHaveCount(1);
    // ONE history entry, read off the panel's own rows rather than off the undo button.
    // `canUndo()` is `historyIndex > 0` — defined at `src/contexts/useHistory.ts:46-47`, and
    // consumed at `HistoryControls.tsx:46` as `disabled={!canUndo()}`. It is true for one
    // entry and for fifty: a rename that committed on every keystroke appends eight, the
    // undo button is still enabled, and one undo still restores `Blank 1` — so nothing above
    // would notice. The count is the one-entry claim, and it is the whole claim.
    await expect(historyRows, 'the rename is ONE history entry, not one per keystroke').toHaveCount(beforeRename + 1);

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

  /**
   * A rename that resolves to empty (blank, spaces, or whitespace-only) must be refused: the
   * name stays as-is and no history entry is written. `handleNameChange` in `LayersTab.tsx`
   * guards on `Boolean(trimmed && trimmed !== layers[layerId]?.name)`, so an empty trim is
   * the no-op branch that writes nothing. This pins that guard at the E2E layer rather than
   * relying on the unit assertion alone.
   *
   * The count is measured AGAINST, not just asserted after: a rename that appended entries
   * for the clear, the space, and the Enter would still leave zero new rows if the component
   * never called `updateLayer`, but the count is what says it did not.
   */
  test('blank or whitespace-only rename is rejected and writes nothing to history', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    // First row is the topmost layer. Captured before any rename so the locator survives
    // the name change (or lack thereof, for a refused rename).
    const row = page.getByTestId(LAYER_ROW).first();
    await expect(row).toContainText('draw 2');
    const historyRows = page.getByTitle(HISTORY_ROW_TITLE);
    const beforeRename = await historyRows.count();

    await enterRenameMode(row);
    // Ctrl/Cmd+A then Delete clears the contenteditable span.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');

    await expect(row, 'the row still carries its original name').toContainText('draw 2');
    await expect(row).not.toContainText('Discarded');
    await expect(row.getByTestId(LAYER_NAME)).toHaveAttribute('contenteditable', 'false');
    // No history entry for a refused rename.
    await expect(historyRows, 'a blank rename left no trace on the timeline').toHaveCount(beforeRename);

    // Whitespace-only is the same refusal: trimmed is empty.
    await enterRenameMode(row);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('   ');
    await page.keyboard.press('Enter');

    await expect(row).toContainText('draw 2');
    await expect(historyRows, 'a whitespace rename left no trace on the timeline').toHaveCount(beforeRename);
  });

  /**
   * A rename committed via blur (clicking away from the name span) must commit the same way
   * Enter does and produce the same single history entry. The blur path runs `handleNameChange`
   * through the `onBlur` handler (`LayersTab.tsx:279-281`), which is a different code path than
   * `onKeyDown`'s Enter branch — same destination, different trigger. Pinning both means a
   * regression in one does not pass through the other.
   */
  test('blur commits a valid rename as one history entry', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    // First row is the topmost layer ("draw 2" after one stroke). Captured before rename
    // so the locator survives the name change.
    const row = page.getByTestId(LAYER_ROW).first();
    await expect(row).toContainText('draw 2');
    const historyRows = page.getByTitle(HISTORY_ROW_TITLE);
    const beforeRename = await historyRows.count();

    await enterRenameMode(row);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Sky');
    await expect(row.getByTestId(LAYER_NAME)).toHaveText('Sky');

    // Click the canvas to blur the name span — the blur fires `handleNameChange`.
    // Use evaluate to blur the focused element directly, as a canvas click can be intercepted
    // by pointer-event overlays in some layouts.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });

    await expect(row).toContainText('Sky');
    await expect(row.getByTestId(LAYER_NAME)).toHaveAttribute('contenteditable', 'false');
    // `RENAME_LAYER_ACTION = 'rename'`, matched case-insensitively as the HistoryTab lowercases it.
    await expect(historyRows, 'the blur produced exactly one rename history entry').toHaveCount(beforeRename + 1);
    await expect(historyRows.filter({ hasText: /rename/i })).toHaveCount(1);
  });

  /**
   * Double-clicking a NON-TEXT layer must NOT switch the tool to Text — `enterTextLayer`
   * in `LayersTab.tsx` returns early when `textLayerEditTarget` is null, and that early
   * return is the contract being pinned here. A double-click that silently landed a text
   * cursor would be invisible to the canvas and leave the document in the wrong tool.
   *
   * The draw tool is the page's default (`DEFAULT_TOOL = 'draw'` in `src/util/constants.ts`),
   * and after drawing it stays selected — so "draw is still selected" is the negative
   * assertion that proves nothing happened.
   */
  test('double-clicking a non-text layer does not switch to the Text tool', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    await expect(page.getByTestId(LAYER_ROW)).toHaveCount(2);
    await expectToolSelected(page, 'draw');

    const row = page.getByTestId(LAYER_ROW).first();
    await row.dblclick();

    // The draw tool stays active — double-click was a no-op, not a text-tool entry.
    await expectToolSelected(page, 'draw');
    await expect(page.getByTestId(LAYER_ROW)).toHaveCount(2);
  });

  /**
   * A drawn stroke creates a second layer on top of the bedrock, so `canConvertBackground`
   * (`LayersTab.tsx:110`) is `Object.keys(layers).length === 1` — false — and the button
   * must stay hidden. The sponge-tool spec covers the VISIBILITY of the button on a lone
   * background; this test pins the opposite guard: the button vanishes the moment a second
   * layer exists.
   */
  test('the Layer from Background button is absent when the document has more than one layer', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    // Before any stroke: one layer, bedrock. The button is visible.
    await expect(page.getByTestId('layers-convert-background-button')).toBeVisible();

    await stroke('#ff0000', RED_STROKE);
    await expect(page.getByTestId(LAYER_ROW)).toHaveCount(2);

    // After the stroke: two layers. The button must not be present.
    await expect(page.getByTestId('layers-convert-background-button')).toHaveCount(0);
  });

  /**
   * On a lone bedrock layer the button IS exposed, and clicking it converts the backing
   * image into an editable layer — `convertBedrockLayer` dispatches `NEW_LAYER_ACTION`
   * with a non-bedrock source (`useLayer.ts:1280-1322`), and the undo button wakes up.
   *
   * This is the layers-panel perspective on a route the sponge-tool spec exercises through
   * a tonal tool; here the assertion is scoped to the panel: the button disappears, the
   * undo becomes enabled, and a single history entry lands.
   */
  test('Layer from Background converts a lone bedrock into an editable layer', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const historyRows = page.getByTitle(HISTORY_ROW_TITLE);
    // The document open is the only row on a fresh document.
    await expect(historyRows, 'a fresh document opens with one history row').toHaveCount(1);

    const convert = page.getByTestId('layers-convert-background-button');
    await expect(convert, 'a fresh document exposes the Background conversion route').toBeVisible();

    await convert.click();

    await expect(convert, 'the button is consumed by the conversion').toHaveCount(0);
    await expect(historyRows, 'the conversion appended exactly one history entry').toHaveCount(2);
  });

  /**
   * The trash button calls `e.stopPropagation()` before `handleConfirmRemove`
   * (`LayersTab.tsx:318-321`), so clicking it must NOT also fire the row's `onClick`,
   * which would call `selectLayer` and change which layer is active.
   *
   * The test activates one layer, then clicks trash on the OTHER layer and checks that
   * the first is still active by its resolved `backgroundColor` — `bg-white` for the
   * active row, `bg-transparent` for an inactive one. Reading the fill, not the click,
   * is what makes the assertion hold: if the active layer had changed, the clicked row
   * would be white and the originally-active row would be transparent.
   */
  test('clicking the trash button does not select the layer', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);
    await stroke('#00aa00', GREEN_STROKE);

    const rows = page.getByTestId(LAYER_ROW);
    await expect(rows).toHaveCount(3);

    // draw 3 (green, topmost) is the active layer by default after the second stroke.
    const greenRow = layerRow(page, 'draw 3');
    const redRow = layerRow(page, 'draw 2');
    await activateRow(greenRow, redRow);

    // Click away to clear any hover fill before reading computed styles.
    await page.mouse.move(0, 0);

    // Click trash on the RED row (the one that is NOT active).
    await redRow.getByRole('button', { name: 'Remove layer' }).click();
    await expect(redRow).toHaveCount(0);

    // The green row must still be the active one.
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await rowFill(greenRow)) !== TRANSPARENT_FILL, {
        message: "the active layer did not change after clicking a different row's trash",
      })
      .toBe(true);
  });

  /**
   * Same stop-propagation contract as the trash button applies to the eye: the handler
   * calls `e.stopPropagation()` before `toggleVisibility`, so the row's `onClick` never
   * fires and the active layer is not moved.
   */
  test('clicking the eye button does not select the layer', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);
    await stroke('#00aa00', GREEN_STROKE);

    const rows = page.getByTestId(LAYER_ROW);
    await expect(rows).toHaveCount(3);

    const greenRow = layerRow(page, 'draw 3');
    const redRow = layerRow(page, 'draw 2');
    await activateRow(greenRow, redRow);

    await page.mouse.move(0, 0);

    // Click the eye on the RED row, which must not steal the active layer.
    await redRow.getByRole('button', { name: /^(Hide|Show) layer$/ }).click();

    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await rowFill(greenRow)) !== TRANSPARENT_FILL, {
        message: "the active layer did not change after clicking a different row's eye",
      })
      .toBe(true);
  });

  /**
   * `LayersTab.tsx:292-312` puts `textOverflow: 'ellipsis'`, `maxWidth: '111px'`, and
   * `whiteSpace: 'nowrap'` on the name span for every layer. A name longer than 111px is
   * clipped by the browser, and `scrollWidth > clientWidth` is the one DOM signal that the
   * ellipsis is actually serving its overflow — a name that fits produces no ellipsis and
   * `scrollWidth === clientWidth` regardless of the CSS class.
   */
  test('long layer names are truncated with an ellipsis', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { stroke } = await setup(page);
    await stroke('#ff0000', RED_STROKE);

    // First row is the topmost layer. Captured before rename so the locator survives the name change.
    const row = page.getByTestId(LAYER_ROW).first();
    await expect(row).toContainText('draw 2');
    await enterRenameMode(row);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('AVeryLongLayerNameThatExceedsOneHundredElevenPixelsLimit');
    await page.keyboard.press('Enter');

    const nameSpan = row.getByTestId(LAYER_NAME);
    await expect(nameSpan).toHaveText(/A.*PixelsLimit/);
    const style = await nameSpan.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        textOverflow: computed.textOverflow,
        whiteSpace: computed.whiteSpace,
        maxWidth: computed.maxWidth,
        overflow: computed.overflow,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      };
    });

    expect(style.textOverflow, 'the name span clips overflow with an ellipsis').toBe('ellipsis');
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.maxWidth).toBe('111px');
    expect(style.overflow).toBe('hidden');
    expect(style.scrollWidth, 'the name is genuinely wider than the span').toBeGreaterThan(style.clientWidth);
  });
});

/**
 * Puts a layer row's name into edit mode the way a user does: a click on the name, whose
 * mousedown sets `editingLayerId`, and a second click, which is the browser's own default
 * action of placing a caret inside what is by then a `contentEditable` span. The first click
 * is what enters edit mode; the second is what makes the caret deterministic.
 *
 * Both steps ASSERT their state, which is the reason this exists rather than two bare
 * clicks: `LayersTab.tsx:214-218` enters edit mode on `onMouseDown`, and the second click
 * only lands a caret once React's discrete-event flush has re-rendered the span as
 * `contentEditable`. Without the assertions, a late flush makes `ControlOrMeta+a` select the
 * document, the typed text goes into the body, `Enter` does nothing, and the caller fails
 * several lines later with an unexplained "expected 1, received 0" on the layer count.
 */
async function enterRenameMode(row: Locator): Promise<void> {
  const name = layerName(row);
  await name.click();
  await expect(name).toHaveAttribute('contenteditable', 'true');
  await name.click();
  await expect(name).toBeFocused();
}
