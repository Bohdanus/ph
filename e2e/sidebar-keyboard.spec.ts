import { expect, type Page, test } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import {
  getToolButton,
  navigateAndSelectInFlyout,
  openToolFlyoutViaKeyboard,
  verifyPrimaryTool,
} from './helpers/toolbar-helpers';

// The Enter tests below used to race on `expect(page.getByRole('menu')).toBeHidden()`.
// Root cause, since fixed: the app focuses the first flyout item from a
// `requestAnimationFrame` callback, while the opener waited only for the menu to
// become visible. A keypress landing in that one-frame gap is handled by the tool
// button again, which re-opens the flyout instead of activating an item - so Enter
// left it open. `openToolFlyoutViaKeyboard` now waits for the focus to land, which is
// what makes these deterministic. See e2e/OPEN_PROBLEMS.md.

/**
 * The grouped tile every flyout test here drives, and why this one.
 *
 * The rail folds a SUFFIX of its rows into the three-dots tile, so the groups high on it
 * are the last to go: the Lasso is the third row of the first section — group 3 of the 15
 * in `toolbar-mapping.ts` — and still has a tile of its own, while the Clone Stamp, group 8
 * and the FIRST one the fit drops at this viewport, does not. The Lasso is preferred to
 * growing the viewport, because every test below is about a GROUPED TILE's flyout rather
 * than about the Lasso or the Clone Stamp specifically — and the height that brings
 * `clone-stamp` back is not the height at which EVERY group is shown, so growing the
 * viewport would not even buy the tile back: it is a different fit, and one tall enough
 * for the whole map would pin a viewport number to mean "everything fits", which is the
 * assumption this branch stopped making.
 *
 * Measured at the suite's 1280x720: the rail shows Move, Rectangular Marquee, Lasso, Magic
 * Wand, Eyedropper, Crop, Brush and the three-dots tile — SEVEN tool tiles of fifteen
 * groups, so the fold begins at the Clone Stamp. Seven is a count of this fit, not a
 * constant of the viewport: the fit spends the WHOLE slot on whole rows where it used to
 * hold a fifth back as headroom, and the command-only Color group that used to sit between
 * Crop and Brush has since left the rail entirely, so what the fold first takes moved twice
 * — from Crop to the Brush with the headroom, and on to the Clone Stamp with the group.
 * The Lasso's own tile survives either way, so the seven is what keeps the sentence above
 * checkable instead of a remembered measurement.
 *
 * Three items in the group rather than two, which is why not the Rectangular Marquee:
 * `ArrowUp wraps to last item` reads a two-item menu's "last" as indistinguishable from
 * "moved one", and the wrap is that test's whole subject.
 */
const GROUPED_TILE = 'freehand-lasso';

/** The Lasso group's second entry, which is what one ArrowDown from the first lands on. */
const SECOND_IN_LASSO = { toolName: 'polygonal-lasso', label: 'Polygonal Lasso Tool' } as const;

/**
 * Opens {@link GROUPED_TILE}'s flyout by keyboard, having first proved the tile is on the rail.
 *
 * `openToolFlyoutViaKeyboard` addresses the tool's own test id and asserts it visible, which
 * is the right contract for a caller that has already established the tile exists. Here the
 * tile's existence IS the thing that varies with the window, so it is asserted separately and
 * with a reason: `getByTestId` reports zero elements rather than failing, so a collapsed tile
 * would otherwise surface as "element(s) not found" against an id that is correct and simply
 * not rendered, which reads as a missing tool rather than as a window that is too short.
 */
async function openGroupedTileFlyout(
  page: Page,
  key: 'ArrowDown' | 'ArrowUp' | 'Enter' | ' ' = 'ArrowDown'
): Promise<void> {
  await expect(
    getToolButton(page, GROUPED_TILE),
    `${GROUPED_TILE} is high enough on the rail to still have a tile of its own, and a tile is what has a flyout`
  ).toBeVisible();
  await openToolFlyoutViaKeyboard(page, GROUPED_TILE, key);
}

test.describe('SidebarLeft - Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  test('ArrowDown opens flyout on grouped tool', async ({ page }) => {
    await openGroupedTileFlyout(page, 'ArrowDown');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('Enter opens flyout on grouped tool', async ({ page }) => {
    await openGroupedTileFlyout(page, 'Enter');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('Space opens flyout on grouped tool', async ({ page }) => {
    await openGroupedTileFlyout(page, ' ');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('ArrowUp opens flyout on grouped tool', async ({ page }) => {
    await openGroupedTileFlyout(page, 'ArrowUp');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('keyboard does not open flyout on single-tool groups', async ({ page }) => {
    // The Move group, and the reason it is not the Draw group this test used to drive. A
    // collapsed single-tool group is a row of the three-dots tile's flyout, and that tile
    // HAS a flyout — so pressing the same keys on it would have opened one and asserted the
    // exact opposite of what the test says, or, had the tile itself been addressed as
    // `tool-button-draw`, failed on a test id that is correct and simply not rendered. Move
    // is a genuine single-tool group (`toolbar-mapping.ts` lists Move on its own) and is the
    // FIRST row, which is the last thing a suffix collapse can take.
    const moveButton = getToolButton(page, 'reposition');
    await expect(
      moveButton,
      'the Move group is one tool and is the first row, so its own tile is on the rail — and `tool-button-*` is never the three-dots tile, which mints `tool-overflow-tile` precisely so the two cannot be confused'
    ).toBeVisible();

    await moveButton.focus();
    await moveButton.press('ArrowDown');
    await moveButton.press('Enter');

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('ArrowDown navigates flyout items', async ({ page }) => {
    await openGroupedTileFlyout(page);

    const items = page.getByRole('menuitemradio');
    await expect(items.first()).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
  });

  test('ArrowUp wraps to last item', async ({ page }) => {
    await openGroupedTileFlyout(page);

    const items = page.getByRole('menuitemradio');
    await expect(items.first()).toBeFocused();

    await page.keyboard.press('ArrowUp');
    const count = await items.count();
    await expect(items.nth(count - 1)).toBeFocused();
  });

  test('Enter activates focused flyout item', async ({ page }) => {
    await openGroupedTileFlyout(page);

    // Navigate to the second item of the group and pick it.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menu')).toBeHidden();
    await verifyPrimaryTool(page, SECOND_IN_LASSO.toolName, SECOND_IN_LASSO.label);
  });

  test('full keyboard flow: open, navigate, select', async ({ page }) => {
    // Open flyout with keyboard
    await openGroupedTileFlyout(page, 'ArrowDown');

    // Navigate to the second item and select. `navigateAndSelectInFlyout` finds the index by
    // asking the open menu for each item's `data-testid`, so the flow does not depend on the
    // pick happening to sit at index 1 of whichever group it is.
    await navigateAndSelectInFlyout(page, SECOND_IN_LASSO.toolName, SECOND_IN_LASSO.label);

    // The tile becomes the tool the flyout chose, `SidebarLeft` re-keys the group button on
    // `primaryTool.name`, so this is the assertion that the selection actually landed. Before
    // it, the test asserted only that the menu closed — which any wrong pick also satisfies.
    await verifyPrimaryTool(page, SECOND_IN_LASSO.toolName, SECOND_IN_LASSO.label);
  });
});
