import { expect, type Page, test } from './fixtures/extended-test';
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
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { clickToolButton, expectToolSelected } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
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
    test.describe.configure({ timeout: DEFAULT_TEST_TIMEOUT_MS });

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
     * Every row names a GROUP that holds exactly one tool, so the tile representing it is
     * the only one that can light. A multi-tool group cannot be used this way: `SidebarLeft`
     * computes `group.some((tool) => tool.name === toolName)`, so the tile reads pressed
     * for every member of the group.
     *
     * The tile is RESOLVED rather than addressed, which is the whole difference between this
     * test and the version from before the rail learned to fold itself away. TWO of these four
     * tools are rows of the three-dots tile's flyout at the suite's viewport and have no tile
     * of their own to address: Text and Clone Stamp, the fourteenth and eighth of the fifteen
     * groups in `toolbar-mapping.ts`. The other two are among the seven rows the rail keeps at
     * 1280x720 — Move is the first group and Crop the sixth — so they are addressed directly
     * whatever the window. Crop used to be folded at this viewport; the rail now fills its
     * whole slot with whole rows (`TOOLBAR_HEIGHT_BUDGET = 1`, `toolbar-overflow.ts:52`) and
     * keeps seven of the fifteen groups here, which is why the count moved from three to two.
     * Resolution keeps the question identical at every window because the app answers it
     * identically at every window: the three-dots tile paints its lit state from the same
     * `group.some(...)` predicate over the collapsed set, which is the channel
     * `expectToolSelected` reads for a tool with no tile of its own. (It deliberately renders
     * NO `aria-pressed` — `SidebarLeft.tsx:658`, which is why that helper reads the class and
     * not the attribute; the sentence here used to say the attribute, and named a mechanism
     * the tile does not have.) The addressed version did not fail HERE —
     * `getByTestId` reports zero elements rather than failing — so the absence surfaced one
     * line later as "element(s) not found" against a test id that was correct and simply not
     * rendered.
     *
     * WHICH IS NOT ENOUGH ON ITS OWN, and the `bar` column is why. The three-dots tile
     * answers "is SOME tool of the collapsed set selected", so at a window where the rail
     * has folded anything it is lit for a large fraction of the tool list — and measured at
     * 1280x720 it is ALREADY lit on load, because the app starts on a tool that has been
     * folded away. Asserting only the resolved tile would have made `T` and `S` pass
     * with the shortcut deleted, which is why the tile alone is not what is asserted here.
     * `bar` is a control of that tool's own options bar, and the bar is the one thing in the
     * document that is driven by `toolName` itself: each row's control is absent before the
     * keystroke and present after, so the row says WHICH tool is up — which for `T` and `S` is
     * the entire question, since neither has a tile that can answer it. The tile assertion is
     * kept anyway, because it pins the reachability contract this branch is about — a tool
     * the rail could not show is still represented, and the tile standing for it lights.
     */
    const SINGLE_TOOL_SHORTCUTS = [
      { key: 'v', tool: 'reposition', bar: '[data-testid="reposition-hint-text"]' },
      { key: 'c', tool: 'crop', bar: '#aspect-ratio' },
      { key: 't', tool: 'text', bar: '#text-input' },
      { key: 's', tool: 'clone-stamp', bar: '#clone-stamp-size' },
    ] as const;

    for (const { key, tool, bar } of SINGLE_TOOL_SHORTCUTS) {
      test(`${key.toUpperCase()} selects ${tool}`, async ({ page }) => {
        await page.keyboard.press(key);
        await expectToolSelected(page, tool);
        await expect(page.locator(bar), 'the tile is lit for a tool of its own, not a neighbour of one').toBeVisible();
      });
    }

    test('E selects the eraser, and the brush tile is the one that lights for it', async ({ page }) => {
      // The eraser is a secondary member of the brush group, so the tile it lights is the
      // brush's. Asserting the tile alone would pass for the brush too, which is why the
      // eraser bar's own control is the assertion that carries the meaning here.
      //
      // WHICH tile that is depends on the window, and the rule is the same either way: the
      // brush group keeps a tile of its own while the rail can show it, and becomes a row of
      // the three-dots tile's flyout once it cannot. At the suite's viewport it is already
      // the latter, so this resolves the tile rather than assuming the brush's own.
      //
      // `V` first, and that keystroke is part of the test rather than setup. The rail starts
      // on a tool that has been folded away, so the tile that represents the brush group is
      // ALREADY lit when the test begins and pressing `E` cannot make it change state — the
      // light would prove nothing. Selecting the Move tool first puts the rail in a state
      // where that tile is dark, which is what turns "this tile lit" back into the
      // observation it was before the collapse: a tile that was not lit lights for a member
      // of the brush group that is not the group's own identity.
      await page.keyboard.press('v');
      await expectToolSelected(page, 'brush', false);

      await page.keyboard.press('e');
      await expectToolSelected(page, 'brush');
      await expect(page.locator('#eraser-mode')).toBeVisible();
      await expect(page.locator('#brush-size'), 'the paint bar is not the one on screen').toHaveCount(0);
    });

    test('B selects the brush, and Shift+B cycles the whole brush family and wraps', async ({ page }) => {
      // The cycle is `brush -> pencil -> color-replacement -> eraser -> brush`
      // (`brushGroup` in AppKeyboardShortcuts). The paint bar mints its control ids from
      // the tool name (`${toolName}-size`), and Color Replacement and the Eraser each render
      // a real bar of their own (`color-replacement-*` / `eraser-*` ids), so every step of the
      // cycle has its own observable and the wrap is proved rather than assumed.
      await page.keyboard.press('b');
      await expect(page.locator('#brush-size')).toBeVisible();

      await page.keyboard.press('Shift+b');
      await expect(page.locator('#pencil-size'), 'brush -> pencil').toBeVisible();
      await expect(page.locator('#brush-size')).toHaveCount(0);

      await page.keyboard.press('Shift+b');
      await expect(page.locator('#color-replacement-limits'), 'pencil -> color replacement').toBeVisible();
      // It is a real bar, not a `PlaceholderTool` card: `toolsMap` wires it to
      // `ToolbarsRight/ColorReplacement/ColorReplacement.tsx`, so no TODO card is on screen.
      // This assertion is what the old title-text match stood in for, and it is the one that
      // fails if the tool is ever re-wired to the placeholder — a title match would still
      // pass, because the placeholder renders that exact title.
      await expect(page.locator('div.border-dashed'), 'no placeholder card on the active bar').toHaveCount(0);
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

    test('U selects the shape tool and Shift+U walks the whole shapes flyout and closes it', async ({ page }) => {
      // The cycle IS the rail's shapes flyout, and it CLOSES: the press after Custom Shape
      // returns to the Rectangle. That last step is the one worth driving from the browser,
      // because the Custom Shape tool carries its own tool name rather than a figure, so it is
      // the only entry whose position cannot come from the stored `figure`. This pins three
      // defects at once: matching the display name "ellipse" against the stored figure "oval"
      // made `indexOf` return -1, so Shift+U from the ellipse wrapped back to the rectangle;
      // the Triangle and the Polygon were absent from the cycle list, so Shift+U from either of
      // them also restarted at the rectangle; and the Custom Shape tool resolved to -1 as well,
      // which closed the cycle over five entries and lost the rectangle from it for good. The
      // five figures are read off the bar's own `aria-label="Current shape"` readout, which is
      // the one place the stored `figure` is in the document; the Custom Shape tool has its own
      // bar, so it is named off the placeholder panel instead.
      const figure = page.locator('[aria-label="Current shape"]');
      const customShape = page.locator('div.border-dashed').first().getByText('Custom Shape Tool', { exact: true });

      await page.keyboard.press('u');
      await expect(figure).toContainText('Rectangle');

      const expectedFigures = [
        { label: 'Ellipse', key: 'rectangle -> ellipse, not back to the rectangle' },
        { label: 'Line', key: 'ellipse -> line, not back to the rectangle' },
        { label: 'Triangle', key: 'line -> triangle, which the old cycle skipped' },
        { label: 'Polygon', key: 'triangle -> polygon, which the old cycle also skipped' },
      ];

      for (const step of expectedFigures) {
        await page.keyboard.press('Shift+u');
        await expect(figure, step.key).toContainText(step.label);
      }

      await page.keyboard.press('Shift+u');
      await expect(customShape, 'polygon -> custom shape, the sixth and last entry of the group').toBeVisible();

      await page.keyboard.press('Shift+u');
      await expect(figure, 'custom shape -> rectangle, the step that closes the group').toContainText('Rectangle');
      await expect(customShape).toHaveCount(0);
    });
  });

  test.describe('input guards', () => {
    test('a tool shortcut is ignored while a number field in the New Image dialog has focus', async ({ page }) => {
      // `isEditableTarget` is the only thing standing between a keystroke aimed at a field
      // and a tool switch, and the dialog additionally stops propagation at the capture
      // phase. A regression in either layer shows up here: the digits must reach the
      // field AND neither `V` nor `T` may have selected a tool.
      await clickToolButton(page, 'draw');
      // The Draw group is a row of the three-dots flyout at this window, so the tile that
      // represents it is resolved, not addressed. The Move assertion is resolved for the
      // same reason and NOT merely for symmetry: it names the tool `V` would have selected,
      // which is a question about a tool, and that is the question the guard is about.
      //
      // The two resolved tiles can never be the same element, so the pair is not one tile
      // asserting both halves of a single fact. The collapse is a SUFFIX of the rail's rows
      // (`fittedThrough` in `toolbar-overflow.ts`), so a tile below a collapsed row is
      // collapsed too — and Move is the first row, which is the last thing a suffix reaches.
      await expectToolSelected(page, 'draw');
      // …and the Draw bar, because that tile was ALREADY lit before the click: the rail
      // starts on a tool the window folded away, so `aria-pressed` on the three-dots tile
      // cannot tell this precondition from the app's opening state. The bar is driven by
      // `toolName` itself and is absent until the click lands.
      await expect(
        page.locator('#pen-type'),
        'the Draw tool is the one selected, not merely some collapsed tool'
      ).toBeVisible();

      // Reaching the New Image dialog at all takes two answers, and both are asserted
      // rather than assumed. The guard in front of it — the app's own modal now, at
      // `src/components/ConfirmDialog` — only appears while the document has unsaved
      // changes, and the app boots with one, so `acceptDiscardPrompt` WAITS for the
      // prompt before clicking Discard. The `page.on('dialog', …)` that used to be here
      // made this test say nothing about whether it appeared, because it accepted any
      // dialog it was shown and Playwright auto-dismisses one it is not; answering the
      // prompt is what makes "the New Image dialog is on screen" mean "the menu item and
      // the guard both work", rather than "nothing was asked and nothing blocked it".
      await page.getByTestId('header-file-menu-button').click();
      await page.getByTestId('header-file-new-button').click();
      await acceptDiscardPrompt(page);

      const width = page.getByTestId('new-image-width-input');
      await expect(width).toBeVisible();
      await width.fill('123');
      await expect(width, 'the digits belong to the field').toHaveValue('123');

      await page.keyboard.press('v');
      await expect(width, 'V typed into the field changes nothing about it').toHaveValue('123');
      await expectToolSelected(page, 'draw');
      await expectToolSelected(page, 'reposition', false);
    });

    test('a tool shortcut is ignored while a layer name is being edited', async ({ page }) => {
      await page.keyboard.press('t');
      // Resolved, for the reason the first guard above states: the Type tool has no tile of
      // its own at this window, and `V` is what this test proves did not reach the shortcut.
      // The Move assertion is the other half of the same fact and cannot be the same
      // element, for the same suffix reason.
      await expectToolSelected(page, 'text');
      // The bar, for the same reason the Draw guard above states it: the three-dots tile
      // was already lit when this test began, so the tile cannot establish that `T` did
      // anything. What makes the rest of the test meaningful is the PAIR below — the tile
      // still lit and the Move tile still dark after `V` was typed — and `V` reaching the
      // shortcut would flip both, so neither assertion is satisfied by the opening state.
      await expect(page.locator('#text-input'), 'the Type tool is the one selected').toBeVisible();

      // `LayersTab` mints the name span without `contenteditable` until a mousedown
      // flips it, and that flip does not focus: the first click enters edit mode and the
      // second is what the browser focuses.
      const row = page.getByTitle('Drag to reorder').first();
      const name = row.locator('div.flex-1 > span');
      await name.click();
      await name.click();
      await page.keyboard.type('v');

      await expect(name, 'the letter belongs to the name').toContainText('v');
      await expectToolSelected(page, 'text');
      await expectToolSelected(page, 'reposition', false);
    });
  });
});
