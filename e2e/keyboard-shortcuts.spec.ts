import { expect, type Page, test } from '@playwright/test';
import {
  type BoundingBox,
  drawLine,
  getWorkspaceCanvas,
  hasDarkPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/**
 * `useKeyboardEvents.matchesShortcut` treats `mod` as `(metaKey || ctrlKey)`, so Control
 * satisfies every `mod: true` registration in `AppKeyboardShortcuts` on every platform.
 * Control rather than `Meta` because `Meta+z` is a browser-reserved chord on macOS and a
 * headless Chrome is free to swallow it before the page ever sees it.
 */
const MOD = 'Control';

/**
 * The poll loop's inverse predicate. `waitForCanvasPixels` takes an absolute page clip and
 * a predicate over a fresh capture, so "the stroke is gone" is stated the same way as "the
 * stroke is there" rather than through a fixed sleep after the keystroke.
 */
const hasNoDarkPixels: CanvasPixelPredicate = async (screenshot) => !(await hasDarkPixels(screenshot));

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so strokes cannot be placed');
  return box;
}

/** The standard test line, black, with the wait that proves it reached the backing store. */
async function drawBlackStroke(page: Page, box: BoundingBox): Promise<void> {
  await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  await waitForCanvasRedraw(page, box);
}

const undoButton = (page: Page) => page.getByTestId('undo-button');
const redoButton = (page: Page) => page.getByTestId('redo-button');

test.describe('Keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // The rail only renders once the store has a document, and every shortcut in
    // `AppKeyboardShortcuts` is registered with `enabled: hasImage`, so this is the
    // precondition for the whole file.
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test.describe('undo and redo', () => {
    test.describe.configure({ timeout: 60_000 });

    test('mod+Z removes the stroke and mod+Shift+Z puts it back', async ({ page }) => {
      const box = await canvasBox(page);
      const clip = canvasRedrawClip(box);

      await clickToolButton(page, 'draw');
      await setForegroundColor(page, '#000000', true);
      await drawBlackStroke(page, box);

      await expect(undoButton(page), 'a committed stroke is one history entry').toBeEnabled();
      await expect(redoButton(page), 'nothing has been undone, so there is nothing to redo').toBeDisabled();

      await page.keyboard.press(`${MOD}+z`);
      await waitForCanvasPixels(page, clip, hasNoDarkPixels, { description: 'the undone stroke' });
      await expect(undoButton(page), 'the stroke was the only entry on the timeline').toBeDisabled();
      await expect(redoButton(page), 'undoing the last entry is what makes redo available').toBeEnabled();

      await page.keyboard.press(`${MOD}+Shift+z`);
      await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the redone stroke' });
      await expect(redoButton(page), 'the timeline is back at its tip').toBeDisabled();
      await expect(undoButton(page)).toBeEnabled();
    });

    test('mod+Y redoes what mod+Z undid', async ({ page }) => {
      const box = await canvasBox(page);
      const clip = canvasRedrawClip(box);

      await clickToolButton(page, 'draw');
      await setForegroundColor(page, '#000000', true);
      await drawBlackStroke(page, box);

      await page.keyboard.press(`${MOD}+z`);
      await waitForCanvasPixels(page, clip, hasNoDarkPixels, { description: 'the undone stroke' });
      await expect(redoButton(page)).toBeEnabled();

      // `AppKeyboardShortcuts` registers mod+Y separately from mod+Shift+Z, so it is a
      // second registration and not an alias: it can break without the other one noticing.
      await page.keyboard.press(`${MOD}+y`);
      await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the redone stroke' });
      await expect(redoButton(page)).toBeDisabled();
    });

    test('mod+Z unwinds one stroke at a time, and leaves the other on the canvas', async ({ page }) => {
      const box = await canvasBox(page);
      const base = canvasRedrawClip(box);
      // Two strokes 200px apart, each with a clip that contains its own row and excludes
      // the other, so "the first stroke survived" is a statement about pixels and not
      // about a region that happens to hold both.
      const firstClip = base;
      const secondClip = { ...base, y: base.y + 200 };

      await clickToolButton(page, 'draw');
      await setForegroundColor(page, '#000000', true);
      await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
      await waitForCanvasPixels(page, firstClip, hasDarkPixels, { description: 'the first stroke' });

      await drawLine(page, box, LINE_START_X, LINE_START_Y + 200, LINE_END_X, LINE_START_Y + 200);
      await waitForCanvasPixels(page, secondClip, hasDarkPixels, { description: 'the second stroke' });

      await page.keyboard.press(`${MOD}+z`);
      await waitForCanvasPixels(page, secondClip, hasNoDarkPixels, { description: 'the undone second stroke' });
      await expect
        .poll(async () => hasDarkPixels(await page.screenshot({ clip: firstClip })), {
          message: 'the first stroke must survive an undo of the second one',
        })
        .toBe(true);
      await expect(undoButton(page), 'one entry is left to undo').toBeEnabled();

      await page.keyboard.press(`${MOD}+z`);
      await waitForCanvasPixels(page, firstClip, hasNoDarkPixels, { description: 'the undone first stroke' });
      await expect(undoButton(page)).toBeDisabled();
    });
  });

  test.describe('tool shortcuts', () => {
    /**
     * Every row names a tile that holds exactly one tool, so `aria-pressed` on it states
     * exactly which tool is active. A grouped tile cannot be used this way: `SidebarLeft`
     * computes `group.some((tool) => tool.name === toolName)`, so the tile reads pressed
     * for every member of the group.
     */
    const SINGLE_TOOL_SHORTCUTS = [
      { key: 'v', testId: 'tool-button-reposition' },
      { key: 'c', testId: 'tool-button-crop' },
      { key: 't', testId: 'tool-button-text' },
      { key: 's', testId: 'tool-button-clone-stamp' },
    ] as const;

    for (const { key, testId } of SINGLE_TOOL_SHORTCUTS) {
      test(`${key.toUpperCase()} selects ${testId.replace('tool-button-', '')}`, async ({ page }) => {
        await page.keyboard.press(key);
        await expect(page.getByTestId(testId)).toHaveAttribute('aria-pressed', 'true');
      });
    }

    test('E selects the eraser, and the brush tile is the one that lights for it', async ({ page }) => {
      // The eraser is a secondary member of the brush group, so the tile it lights is the
      // brush's. Asserting the tile alone would pass for the brush too, which is why the
      // eraser bar's own control is the assertion that carries the meaning here.
      await page.keyboard.press('e');
      await expect(page.getByTestId('tool-button-brush')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#eraser-mode')).toBeVisible();
      await expect(page.locator('#brush-size'), 'the paint bar is not the one on screen').toHaveCount(0);
    });

    test('B selects the brush, and Shift+B cycles the whole brush family and wraps', async ({ page }) => {
      // The cycle is `brush -> pencil -> color-replacement -> eraser -> brush`
      // (`brushGroup` in AppKeyboardShortcuts). The paint bar mints its control ids from
      // the tool name (`${toolName}-size`), and the placeholder and the eraser each render
      // a different bar again, so every step of the cycle has its own observable and the
      // wrap is proved rather than assumed.
      await page.keyboard.press('b');
      await expect(page.locator('#brush-size')).toBeVisible();

      await page.keyboard.press('Shift+b');
      await expect(page.locator('#pencil-size'), 'brush -> pencil').toBeVisible();
      await expect(page.locator('#brush-size')).toHaveCount(0);

      await page.keyboard.press('Shift+b');
      await expect(
        page.getByText('Color Replacement Tool', { exact: true }),
        'pencil -> color replacement'
      ).toBeVisible();
      await expect(page.locator('#pencil-size')).toHaveCount(0);

      await page.keyboard.press('Shift+b');
      await expect(page.locator('#eraser-mode'), 'color replacement -> eraser').toBeVisible();

      await page.keyboard.press('Shift+b');
      await expect(page.locator('#brush-size'), 'the cycle wraps back to the brush').toBeVisible();
    });

    test('G selects the paint bucket and Shift+G the gradient', async ({ page }) => {
      await page.keyboard.press('g');
      await expect(page.locator('#paint-bucket-fill')).toBeVisible();

      await page.keyboard.press('Shift+g');
      await expect(page.locator('#gradient-type'), 'paint bucket -> gradient').toBeVisible();
      await expect(page.locator('#paint-bucket-fill')).toHaveCount(0);
    });

    test('O selects dodge and Shift+O burn, and the shared bar names the active one', async ({ page }) => {
      // Dodge and burn share ONE options bar (`toolsMap.ts`), so the bar looks the same for
      // both. `Tonal.tsx` mints its ids from `useStore().toolName`, which makes the id the
      // only thing in the document that says which of the two is active.
      await page.keyboard.press('o');
      await expect(page.locator('#dodge-range')).toBeVisible();
      await expect(page.locator('#burn-range')).toHaveCount(0);

      await page.keyboard.press('Shift+o');
      await expect(page.locator('#burn-range'), 'dodge -> burn').toBeVisible();
      await expect(page.locator('#dodge-range')).toHaveCount(0);
    });

    test('P selects the pen family and Shift+P walks it, one placeholder title per tool', async ({ page }) => {
      // All three members render the same `PlaceholderTool`, and its `title` is the tool's
      // own name, so the title is the only thing in the bar that says which one is up. It
      // is read from inside the placeholder rather than off the page: the tile's icon
      // carries an SVG `<title>` with the same text, so an unscoped `getByText` matches
      // both and the tile's copy never changes as the family cycles.
      const placeholder = page.locator('div.border-dashed').first();

      await page.keyboard.press('p');
      await expect(placeholder.getByText('Pen Tool', { exact: true })).toBeVisible();

      await page.keyboard.press('Shift+p');
      await expect(placeholder.getByText('Freeform Pen Tool', { exact: true })).toBeVisible();
      await expect(placeholder.getByText('Pen Tool', { exact: true })).toHaveCount(0);

      await page.keyboard.press('Shift+p');
      await expect(placeholder.getByText('Curvature Pen Tool', { exact: true })).toBeVisible();
    });

    test('L selects the freehand lasso, and Shift+L walks the family', async ({ page }) => {
      // The three lasso bars share their control set and differ only in the one-line
      // usage hint each renders, so that hint is what says which tool is up. The family
      // also has to be left behind: two members with the same hint would let a shortcut
      // that never fired still pass, which is why all three are named.
      await page.keyboard.press('l');
      await expect(page.getByText('Drag around the object; the path closes automatically.')).toBeVisible();

      await page.keyboard.press('Shift+l');
      await expect(page.getByText('Right-click also finishes the selection')).toBeVisible();
      await expect(page.getByText('Drag around the object; the path closes automatically.')).toHaveCount(0);

      await page.keyboard.press('Shift+l');
      await expect(page.getByLabel('Feather Magnetic Lasso settings information')).toBeVisible();
      await expect(page.getByText('Right-click also finishes the selection')).toHaveCount(0);
    });

    test('U selects the shape tool and Shift+U cycles the figure, oval included', async ({ page }) => {
      // This pins the bug the source comment at `selectShapeTool` records: matching the
      // display name "ellipse" against the stored figure "oval" made `indexOf` return -1,
      // so Shift+U from the ellipse wrapped back to the rectangle instead of advancing.
      // The figure is read off the bar's own `aria-label="Current shape"` readout, which
      // is the one place the stored `figure` is in the document.
      const figure = page.locator('[aria-label="Current shape"]');

      await page.keyboard.press('u');
      await expect(figure).toContainText('Rectangle');

      await page.keyboard.press('Shift+u');
      await expect(figure, 'rectangle -> ellipse').toContainText('Ellipse');

      await page.keyboard.press('Shift+u');
      await expect(figure, 'ellipse -> line, not back to the rectangle').toContainText('Line');

      await page.keyboard.press('Shift+u');
      await expect(
        page.locator('div.border-dashed').first().getByText('Custom Shape Tool', { exact: true }),
        'line -> custom shape'
      ).toBeVisible();
    });
  });

  test.describe('input guards', () => {
    test('a tool shortcut is ignored while a number field in the New Image dialog has focus', async ({ page }) => {
      // `isEditableTarget` is the only thing standing between a keystroke aimed at a field
      // and a tool switch, and the dialog additionally stops propagation at the capture
      // phase. A regression in either layer shows up here: the digits must reach the
      // field AND neither `V` nor `T` may have selected a tool.
      await clickToolButton(page, 'draw');
      await expect(page.getByTestId('tool-button-draw')).toHaveAttribute('aria-pressed', 'true');

      // A `confirm()` before the dialog only exists while the document has unsaved
      // changes; accepting it makes the test say nothing about whether it appeared.
      page.on('dialog', (dialog) => void dialog.accept());
      await page.getByTestId('header-file-menu-button').click();
      await page.getByTestId('header-file-new-button').click();

      const width = page.getByTestId('new-image-width-input');
      await expect(width).toBeVisible();
      await width.fill('123');
      await expect(width, 'the digits belong to the field').toHaveValue('123');

      await page.keyboard.press('v');
      await expect(width, 'V typed into the field changes nothing about it').toHaveValue('123');
      await expect(page.getByTestId('tool-button-draw'), 'no tool switched while the field had focus').toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(page.getByTestId('tool-button-reposition')).toHaveAttribute('aria-pressed', 'false');
    });

    test('a tool shortcut is ignored while a layer name is being edited', async ({ page }) => {
      await page.keyboard.press('t');
      await expect(page.getByTestId('tool-button-text')).toHaveAttribute('aria-pressed', 'true');

      // `LayersTab` mints the name span without `contenteditable` until a mousedown
      // flips it, and that flip does not focus: the first click enters edit mode and the
      // second is what the browser focuses.
      const row = page.getByTitle('Drag to reorder').first();
      const name = row.locator('div.flex-1 > span');
      await name.click();
      await name.click();
      await page.keyboard.type('v');

      await expect(name, 'the letter belongs to the name').toContainText('v');
      await expect(page.getByTestId('tool-button-text'), 'V did not reach the reposition shortcut').toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(page.getByTestId('tool-button-reposition')).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
