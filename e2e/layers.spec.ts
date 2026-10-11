import { expect, test } from './fixtures/extended-test';
import {
  type ClipOptions,
  drawLine,
  getColorAtPoint,
  getWorkspaceCanvas,
  loadImageData,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { cssPointToImage } from './helpers/screenshot-scale';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

import { DEFAULT_TEST_TIMEOUT_MS, SEQUENTIAL_LAYER_TEST_TIMEOUT_MS } from './helpers/timeouts';
/** Canvas-relative point where the three strokes cross; used for pixel sampling. */
const LAYER_OVERLAP_X = 300;
const LAYER_OVERLAP_Y = 260;
/**
 * Half-width of the window sampled at the overlap point, in CSS pixels.
 *
 * The same radius `getColorAtPoint` defaults to, and the reason it is named rather than left
 * implicit: the clip is built from it, so the sample window and the captured region are the same
 * size and the clip cannot be narrowed past the window that is averaged inside it.
 */
const OVERLAP_SAMPLE_RADIUS = 5;
/** The tooltip every History row carries, which is the only handle the rows have. */
const HISTORY_ROW_TITLE = 'Click to go back to this state';
/**
 * The product's own spelling of a reorder entry: `REORDER_ACTION = 'reorder layers'`
 * (`src/util/constants.ts`), LOWER CASE. `HistoryTab` renders it through a CSS `capitalize`
 * class, so it only ever APPEARS capitalised - which is why a locator may not be written
 * against the rendered form. Matched case-insensitively for that reason, and deliberately
 * not written as "Reorder Layers": that string is nowhere in `src/`, so it would resolve
 * only through `getByText`'s case-insensitive substring match, and a restyle that dropped
 * the `capitalize` class would turn this into a locator error rather than a product signal.
 */
const REORDER_ENTRY = /reorder layers/i;
/** The product's own spelling of a delete entry: `REMOVE_ACTION = 'remove layer'` (`src/util/constants.ts`). */
const REMOVE_ENTRY = /remove layer/i;

test.describe('Layers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  // layers change order and are deleted sequentially
  test('layers change order and are deleted sequentially', async ({ page }, testInfo) => {
    test.setTimeout(SEQUENTIAL_LAYER_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const layerRows = page.getByTitle('Drag to reorder');
    const layerRow = (name: string) => layerRows.filter({ hasText: name });
    const capture = async (name: string) => {
      return captureCanvasScreenshot(page, box, testInfo, name);
    };
    /**
     * Samples the overlap point from a capture. The CSS point is converted to image pixels
     * with the repo's single scaling rule (screenshot-scale.ts) rather than by dividing by
     * devicePixelRatio, so device-pixel captures stay correct without that assumption.
     */
    const sampleOverlap = async (
      screenshot: Buffer,
      radius?: number,
      options?: { ignoreNearWhite?: boolean; nearWhiteThreshold?: number }
    ) => {
      const image = await loadImageData(screenshot);
      const point = cssPointToImage(image, box, { x: box.x + LAYER_OVERLAP_X, y: box.y + LAYER_OVERLAP_Y });
      return getColorAtPoint(image, Math.round(point.x), Math.round(point.y), radius, options);
    };
    const draw = async (color: string, start: { x: number; y: number }, end: { x: number; y: number }) => {
      await clickToolButton(page, 'draw');
      // verifySwatch asserts the store picked up the color the draw tool will stroke with.
      await setForegroundColor(page, color, true);

      await drawLine(page, box, start.x - box.x, start.y - box.y, end.x - box.x, end.y - box.y, { steps: 15 });
    };
    const moveToTop = async (sourceName: string, targetName: string) => {
      const source = layerRow(sourceName);
      const target = layerRow(targetName);
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      const targetBox = await target.boundingBox();
      if (!targetBox) throw new Error(`Layer row ${targetName} not found`);
      await source.dispatchEvent('dragstart', { dataTransfer });
      await target.dispatchEvent('dragover', { dataTransfer, clientY: targetBox.y + 5 });
      await target.dispatchEvent('drop', { dataTransfer, clientY: targetBox.y + 5 });
      await source.dispatchEvent('dragend', { dataTransfer });
      // The drop is applied asynchronously: the moved layer only reaches the top of the
      // panel list once the reorder lands, so wait on row order instead of a fixed sleep.
      await expect(layerRows.first()).toContainText(sourceName);
    };
    const removeLayer = async (name: string) => {
      const row = layerRow(name);
      await row.getByRole('button', { name: 'Remove layer' }).click();
      await expect(row).toHaveCount(0);
    };
    const removeAndCapture = async (name: string, screenshotName: string) => {
      await removeLayer(name);
      return capture(screenshotName);
    };

    await draw('#000000', { x: box.x + 180, y: box.y + 180 }, { x: box.x + 420, y: box.y + 340 }); // draw 2, bottom
    await draw('#ff0000', { x: box.x + 420, y: box.y + 180 }, { x: box.x + 180, y: box.y + 340 }); // draw 3
    await draw('#00aa00', { x: box.x + 160, y: box.y + 260 }, { x: box.x + 440, y: box.y + 260 }); // draw 4, top

    const initialScreenshot = await capture('layers-initial');
    const initialColor = await sampleOverlap(initialScreenshot);
    expect(initialColor, 'Expected green at overlap point').toBeTruthy();
    expect(initialColor!.green).toBeGreaterThan(initialColor!.red * 1.5);
    expect(initialColor!.green).toBeGreaterThan(initialColor!.blue * 1.5);

    await moveToTop('draw 2', 'draw 4');
    // ONE DRAG IS ONE HISTORY ENTRY, and the COUNT is that claim - not the visibility of a
    // single row. A drag that wrote its entry twice, or wrote one per pointermove, still
    // leaves a reorder row on screen, so `toBeVisible()` on one of them passes and the
    // timeline is silently longer than the gesture that made it. The row is matched by the
    // product's own lowercase string (see `REORDER_ENTRY`), and through the tooltip every
    // History row shares rather than through the rendered text.
    await expect(
      page.getByTitle(HISTORY_ROW_TITLE).filter({ hasText: REORDER_ENTRY }),
      'one drag is one history entry'
    ).toHaveCount(1);
    const blackTopScreenshot = await capture('layers-black-top');
    const blackTopColor = await sampleOverlap(blackTopScreenshot);
    expect(blackTopColor, 'Expected black at overlap point').toBeTruthy();
    expect(blackTopColor!.red).toBeLessThan(70);
    expect(blackTopColor!.green).toBeLessThan(70);
    expect(blackTopColor!.blue).toBeLessThan(70);

    await moveToTop('draw 3', 'draw 2');
    const redTopScreenshot = await capture('layers-red-top');
    const redTopColor = await sampleOverlap(redTopScreenshot);
    expect(redTopColor, 'Expected red at overlap point').toBeTruthy();
    expect(redTopColor!.red).toBeGreaterThan(redTopColor!.green * 1.5);
    expect(redTopColor!.red).toBeGreaterThan(redTopColor!.blue * 1.5);
    expect(redTopColor!.red).toBeGreaterThan(100);

    const removeRedScreenshot = await removeAndCapture('draw 3', 'layers-remove-red');
    const removeRedColor = await sampleOverlap(removeRedScreenshot);
    expect(removeRedColor, 'Expected black after removing red').toBeTruthy();
    expect(removeRedColor!.red).toBeLessThan(70);
    expect(removeRedColor!.green).toBeLessThan(70);
    expect(removeRedColor!.blue).toBeLessThan(70);

    const removeBlackScreenshot = await removeAndCapture('draw 2', 'layers-remove-black');
    const removeBlackColor = await sampleOverlap(removeBlackScreenshot);
    expect(removeBlackColor, 'Expected green after removing black').toBeTruthy();
    expect(removeBlackColor!.green).toBeGreaterThan(removeBlackColor!.red * 1.5);
    expect(removeBlackColor!.green).toBeGreaterThan(removeBlackColor!.blue * 1.5);

    const removeGreenScreenshot = await removeAndCapture('draw 4', 'layers-remove-green');
    const removeGreenColor = await sampleOverlap(removeGreenScreenshot, 5, { ignoreNearWhite: true });
    expect(removeGreenColor).toBeNull();

    // Nothing is read from a capture here, so take none: it would cost a CDP session,
    // a PNG write and an attachment for a screenshot nothing asserts on.
    await removeLayer('Blank 1');
  });

  /**
   * Visibility and order are SEPARATE fields on a layer, and the suite covers each alone -
   * `layers-panel.spec.ts:362` hides a layer and `:387` makes the hide a history entry, while
   * the test above reorders layers three times - but nothing covers what happens when the two
   * are combined. That intersection is where a reordering implementation is most likely to go
   * wrong: a reorder that rebuilds each row from a serialised snapshot, rather than moving the
   * existing layer objects, silently drops a field it does not itself read.
   *
   * So this asserts the interaction in both directions, and each direction is a distinct claim:
   *
   *   - a HIDDEN layer dragged to the top must still be hidden - a snapshot rebuild that loses
   *     `visible` would repaint it, and the overlap point would go from bare to the hidden
   *     layer's own colour;
   *   - a VISIBLE layer hidden AFTER being dragged must stay hidden - the reverse order, which
   *     catches a flag written to the wrong row once rows and layers are out of step.
   *
   * Reading the composite rather than the eye icon is the point: `layers-panel.spec.ts:200`
   * makes the same argument for the single-layer case, and an icon assertion here would read
   * the button the test just clicked rather than the canvas the user looks at.
   */
  test('a layer keeps its hidden state across a reorder', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const layerRows = page.getByTitle('Drag to reorder');
    const layerRow = (name: string) => layerRows.filter({ hasText: name });
    /** The button states the ACTION it will take, so its name is how hidden-ness is read. */
    const visibilityButton = (name: string) => layerRow(name).getByRole('button', { name: /^(Hide|Show) layer$/ });

    /**
     * Waits until the overlap point reads as `matches`, then returns that colour.
     *
     * A poll rather than a capture-then-read, and the difference is the whole reason this test
     * can be trusted: hiding a layer re-renders the panel row and repaints the canvas from the
     * same state change, and those are two different subscribers, so the row's accessible name
     * can already say "Show layer" while the canvas still holds the old composite. Reading the
     * pixel straight after the row assertion is a coin flip on that ordering. Going through
     * `waitForCanvasPixels` also means the assertion is about the value it wants rather than
     * about a frame it happened to catch.
     *
     * The clip is centred on the overlap point, so the centre of the returned image IS that
     * point at any capture scale - no devicePixelRatio assumption, and none of the arithmetic
     * `cssPointToImage` does for the test above, which samples a whole-canvas capture.
     */
    const waitForOverlap = async (
      matches: (colour: { red: number; green: number; blue: number }) => boolean,
      description: string
    ) => {
      const clip: Required<ClipOptions> = {
        x: box.x + LAYER_OVERLAP_X - OVERLAP_SAMPLE_RADIUS,
        y: box.y + LAYER_OVERLAP_Y - OVERLAP_SAMPLE_RADIUS,
        width: OVERLAP_SAMPLE_RADIUS * 2,
        height: OVERLAP_SAMPLE_RADIUS * 2,
      };
      await waitForCanvasPixels(
        page,
        clip,
        async (screenshot) => {
          const image = await loadImageData(screenshot);
          const centre = await getColorAtPoint(image, Math.round(image.width / 2), Math.round(image.height / 2));
          return centre !== null && matches(centre);
        },
        { description }
      );
    };

    const draw = async (color: string, start: { x: number; y: number }, end: { x: number; y: number }) => {
      await clickToolButton(page, 'draw');
      // verifySwatch asserts the store picked up the colour the draw tool will stroke with.
      await setForegroundColor(page, color, true);
      await drawLine(page, box, start.x - box.x, start.y - box.y, end.x - box.x, end.y - box.y, { steps: 15 });
    };
    /** Drops `source` onto `target`, then waits on row ORDER rather than a fixed sleep. */
    const moveToTop = async (sourceName: string, targetName: string) => {
      const source = layerRow(sourceName);
      const target = layerRow(targetName);
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      const targetBox = await target.boundingBox();
      if (!targetBox) throw new Error(`Layer row ${targetName} not found`);
      await source.dispatchEvent('dragstart', { dataTransfer });
      await target.dispatchEvent('dragover', { dataTransfer, clientY: targetBox.y + 5 });
      await target.dispatchEvent('drop', { dataTransfer, clientY: targetBox.y + 5 });
      await source.dispatchEvent('dragend', { dataTransfer });
      await expect(layerRows.first()).toContainText(sourceName);
    };
    /** Toggles a layer's visibility and waits for the row's button to name the next action. */
    const setHidden = async (name: string, hidden: boolean) => {
      await visibilityButton(name).click();
      await expect(
        visibilityButton(name),
        `the ${name} button must offer to ${hidden ? 'show' : 'hide'} the layer`
      ).toHaveAccessibleName(hidden ? 'Show layer' : 'Hide layer');
    };

    // Two layers crossing at the overlap point, so hiding the top one has an unambiguous answer:
    // the stroke BENEATH it takes over. White would also have been a valid answer here, but it
    // would be a weaker one - the bedrock layer is still in the document, so "white" would also
    // be what a bug that erased every layer would produce. Black can only mean "the layer under
    // the hidden one is still composited", which is what is actually being claimed.
    await draw('#000000', { x: box.x + 180, y: box.y + 180 }, { x: box.x + 420, y: box.y + 340 }); // draw 2
    await draw('#00aa00', { x: box.x + 160, y: box.y + 260 }, { x: box.x + 440, y: box.y + 260 }); // draw 3, top

    const isBlack = (colour: { red: number; green: number; blue: number }) =>
      colour.red < 70 && colour.green < 70 && colour.blue < 70;
    const isGreen = (colour: { red: number; green: number; blue: number }) =>
      colour.green > colour.red * 1.5 && colour.green > colour.blue * 1.5;

    // The green layer owns the overlap point before anything is hidden - the premise the rest
    // of the test measures against, and the reading that makes a later green a change.
    await waitForOverlap(isGreen, 'the green stroke to own the overlap point before the hide');

    await setHidden('draw 3', true);
    await waitForOverlap(isBlack, 'hiding the green layer to leave the black one composited at the overlap point');

    // The reorder itself: the hidden green layer is the topmost row, and it is dropped onto the
    // black one beneath it, so a successful reorder changes which row owns the top slot.
    await moveToTop('draw 3', 'draw 2');

    // Both halves again, and both are needed: the NAME proves the row moved, and the composite
    // proves the move did not resurrect the layer.
    await expect(
      visibilityButton('draw 3'),
      'a reorder must not reset the visibility flag on the layer it moved'
    ).toHaveAccessibleName('Show layer');
    await waitForOverlap(
      isBlack,
      'the reordered layer to be painted at the overlap point again, which is what an un-hide looks like'
    );

    // Direction two, on the layer that was hidden: show it, then hide it again now that the
    // rows and the layers have been through a reorder.
    await setHidden('draw 3', false);
    await waitForOverlap(isGreen, 'showing the layer to bring its stroke back to the overlap point');

    await setHidden('draw 3', true);
    await waitForOverlap(isBlack, 'hiding a layer after a reorder to write the flag to the wrong row');
  });

  /**
   * The existing "layers change order and are deleted sequentially" test asserts on pixels
   * after each removal but never checks that the removal landed a row on the timeline. A
   * deletion that published no entry leaves the canvas correct and every pixel assertion green,
   * while the layer is silently un-undoable — which is the regression this pins.
   *
   * `removeLayer` in the test above calls `handleConfirmRemove`, dispatched as `REMOVE_ACTION`
   * (`src/util/constants.ts`), so the row title is the product's own lower-case spelling read
   * through the same case-insensitive filter `REORDER_ENTRY` uses for reorders.
   */
  test('deleting a layer is a history entry of its own', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#ff0000', true);
    await drawLine(page, box, 180, 180, 420, 340, { steps: 15 });

    const layerRows = page.getByTitle('Drag to reorder');
    const drawnRow = layerRows.filter({ hasText: 'draw 2' });

    const historyRows = page.getByTitle(HISTORY_ROW_TITLE);
    await expect(historyRows, 'the document entry plus the stroke').toHaveCount(2);
    const beforeDelete = await historyRows.count();

    await drawnRow.getByRole('button', { name: 'Remove layer' }).click();
    await expect(drawnRow).toHaveCount(0);

    await expect(historyRows, 'deleting a layer is ONE entry of its own, not zero').toHaveCount(beforeDelete + 1);
    await expect(
      historyRows.filter({ hasText: REMOVE_ENTRY }),
      'the entry is titled "remove layer" (REMOVE_ACTION)'
    ).toHaveCount(1);
  });

  /**
   * The panel has TWO drop targets: a row (insert above / below it) and the bottom drop zone
   * (move to the very bottom). `moveToTop` in the first test exercises the row path only, so
   * the bottom zone is a separate drop that must land its own reorder entry and its own order.
   *
   * The bottom zone is the `div.flex-1.min-h-[20px]` that follows `layers-list` in
   * `LayersTab.tsx`. It is addressed by its `min-h-[20px]` class token, which no other
   * element in the panel carries, rather than by position — position is fragile when the
   * `isOverBottom` indicator appears mid-drag and shifts the sibling chain.
   */
  test('dropping a layer on the bottom drop zone sends it to the bottom', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const draw = async (color: string, start: { x: number; y: number }, end: { x: number; y: number }) => {
      await clickToolButton(page, 'draw');
      await setForegroundColor(page, color, true);
      await drawLine(page, box, start.x - box.x, start.y - box.y, end.x - box.x, end.y - box.y, { steps: 15 });
    };

    // draw 2 (bottom of stack), draw 3, draw 4 (top). Panel lists topmost first.
    await draw('#000000', { x: box.x + 180, y: box.y + 180 }, { x: box.x + 420, y: box.y + 340 });
    await draw('#ff0000', { x: box.x + 420, y: box.y + 180 }, { x: box.x + 180, y: box.y + 340 });
    await draw('#00aa00', { x: box.x + 160, y: box.y + 260 }, { x: box.x + 440, y: box.y + 260 });

    const layerRows = page.getByTitle('Drag to reorder');
    expect(await layerRows.allTextContents(), 'expected bedrock plus three strokes').toHaveLength(4);

    // Drag the top layer (draw 4) to the bottom drop zone.
    const source = layerRows.first();
    await expect(source).toContainText('draw 4');

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    // The bottom drop zone's `min-h-[20px]` class is unique in the panel.
    const bottomZone = page.locator('[class*="min-h-\\[20px\\]"]');
    await expect(bottomZone).toBeVisible();

    await source.dispatchEvent('dragstart', { dataTransfer });
    await bottomZone.dispatchEvent('dragover', { dataTransfer });
    await bottomZone.dispatchEvent('drop', { dataTransfer });
    await source.dispatchEvent('dragend', { dataTransfer });

    // The animateMove call in LayersTab uses two 200ms timers, so the row list settles after
    // the animation before the assertion races the DOM.
    await expect(layerRows.last(), 'draw 4 moved to the bottom of the stack').toContainText('draw 4');

    // One drag is one history entry, same rule as the reorder test above.
    await expect(page.getByTitle(HISTORY_ROW_TITLE).filter({ hasText: REORDER_ENTRY })).toHaveCount(1);
  });

  /**
   * Every row, without exception, renders the drag handle so the user can always start a
   * reorder. A row that rendered its name but no handle would be draggable only by accident
   * — through the row itself, which also fires `selectLayer` — and the handle is the only
   * affordance a user can reach reliably.
   *
   * The handle is `DragHandleIcon`, an `aria-hidden` SVG (`DragHandleIcon.tsx:11`), so it is
   * counted by tag rather than by role.
   */
  test('every layer row shows a drag handle', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#ff0000', true);
    await drawLine(page, box, 180, 180, 420, 340, { steps: 15 });

    const rows = page.getByTitle('Drag to reorder');
    const rowCount = await rows.count();
    expect(rowCount, 'a stroke plus the bedrock layer').toBe(2);

    // Each row carries three `aria-hidden` SVGs — DragHandleIcon, EyeIcon, and TrashIcon.
    // Only the DragHandleIcon sits OUTSIDE a button, so count SVGs that have no button ancestor.
    const handleCount = await rows.evaluateAll((nodes) =>
      nodes.reduce((count, row) => {
        const svgs = row.querySelectorAll('svg[aria-hidden="true"]');
        return count + Array.from(svgs).filter((svg) => !svg.closest('button')).length;
      }, 0)
    );
    expect(handleCount, 'every row renders exactly one drag handle').toBe(rowCount);
  });
});
