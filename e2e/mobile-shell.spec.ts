import { expect, type Page, test } from './fixtures/extended-test';
import { drawLine, getWorkspaceCanvas } from './helpers/canvas-helpers';

/**
 * Below 768 CSS pixels the mobile chrome is shown and the desktop chrome is hidden —
 * `MobileShell` stays MOUNTED at every width and is hidden with `md:hidden`, so nothing is
 * torn down at the boundary. `MOBILE_MEDIA_QUERY` states that boundary as `(width < 768px)`
 * so the JS check and the query Tailwind emits are the same string. 390x844 is the
 * reference phone size, well clear of the boundary, so a test cannot drift into the tablet
 * band by rounding.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** The file menu's `confirm()` guard fires for any of these on a dirty document. */
async function acceptConfirmations(page: Page): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
}

const mobileHeader = (page: Page) => page.getByTestId('mobile-header');
const bottomBar = (page: Page) => page.getByTestId('mobile-bottom-bar');

test.describe('Mobile shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    // The desktop chrome is hidden rather than unmounted below `md`, so the absence of the
    // left rail is a statement about the stylesheet, not about React having torn it down.
    await expect(page.getByTestId('left-sidebar')).toBeHidden();
    await expect(mobileHeader(page)).toBeVisible();
  });

  test('the shell replaces the desktop chrome, and hides the footer with the rest of it', async ({ page }) => {
    // The shell's own contract: it renders no canvas of its own, so `Main` is still the one
    // drawing. The footer's dimensions readout is `max-md:hidden`, so a phone cannot see it
    // — and asserting its text while it is `display: none` would pass on content no user
    // can reach, which is why the assertion is that it is hidden.
    await expect(getWorkspaceCanvas(page), 'the canvas is the desktop Main, still mounted').toBeVisible();
    await expect(bottomBar(page)).toBeVisible();
    await expect(page.locator('footer'), 'the dimensions readout is desktop-only below md').toBeHidden();
  });

  test('the bottom bar selects a tool, and marks exactly the active group', async ({ page }) => {
    const options = page.getByTestId('mobile-tool-options-toggle');
    await expect(options, 'no options panel over the canvas on first paint').toHaveAttribute('aria-expanded', 'false');

    // A group tile is one button whose `aria-pressed` is computed from the whole group, so
    // pressing it and reading it back is the shell's own contract rather than a class name.
    // The tile's accessible name is its group's FIRST tool label, while the caption on the
    // tile is the primary's label with the ` Tool` suffix stripped. Reading the name rather
    // than the text is what keeps this a statement about the group and not about the caption.
    const drawTile = bottomBar(page).getByRole('button', { name: 'Draw Tool' });
    await drawTile.click();
    await expect(drawTile).toHaveAttribute('aria-pressed', 'true');
    // The options panel belongs to the tool, and it only opens when it is asked for: a tile
    // selecting its own tool is a different concern, and conflating them was the bug the
    // source comment on the toggle records.
    await expect(options).toHaveAttribute('aria-expanded', 'false');

    const moveTile = bottomBar(page).getByRole('button', { name: 'Move Tool' });
    await expect(moveTile, 'only one group is active at a time').toHaveAttribute('aria-pressed', 'false');
    await moveTile.click();
    await expect(moveTile).toHaveAttribute('aria-pressed', 'true');
    await expect(drawTile).toHaveAttribute('aria-pressed', 'false');
  });

  test('the options sheet carries the group picker, and it selects a sibling tool', async ({ page }) => {
    const toggle = page.getByTestId('mobile-tool-options-toggle');
    await bottomBar(page).getByRole('button', { name: 'Brush Tool' }).click();
    await toggle.click();

    // The sheet's outer div is rendered whether or not the sheet is open — only its content
    // is gated on `isOpen` — so `mobile-tool-sheet` being visible says nothing and is not
    // asserted. The content is the assertion.
    const sheet = page.getByTestId('mobile-tool-sheet');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The bottom bar holds one tile per GROUP, so a five-member group is otherwise
    // unreachable on a phone. The sheet is the only place the other members exist.
    const picker = sheet.getByRole('group', { name: 'Brush tools' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Brush Tool' })).toHaveAttribute('aria-pressed', 'true');

    await picker.getByRole('button', { name: 'Pencil Tool' }).click();
    await expect(picker.getByRole('button', { name: 'Pencil Tool' })).toHaveAttribute('aria-pressed', 'true');
    // The bar's own tile lights for the whole group, so it is the pressed member of the
    // picker, not the tile, that says which tool within the group is now active.
    await expect(bottomBar(page).getByRole('button', { name: 'Brush Tool' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet).toContainText('pencil Options');

    await toggle.click();
    await expect(sheet.getByRole('group', { name: 'Brush tools' })).toBeHidden();
  });

  test('the navigation drawer carries the file commands the header no longer shows', async ({ page }) => {
    await acceptConfirmations(page);
    await page.getByTestId('mobile-menu-button').click();
    const drawer = page.getByRole('dialog', { name: 'Mobile Navigation Menu' });
    await expect(drawer).toBeVisible();

    // Every one of these is a header command the mobile header has no room for, so the
    // drawer is the only place they can be reached at this width.
    for (const id of [
      'mobile-menu-new-button',
      'mobile-menu-open-button',
      'mobile-menu-save-button',
      'mobile-menu-theme-button',
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    await page.getByTestId('mobile-menu-new-button').click();
    await expect(page.getByTestId('new-image-dialog'), 'New reaches the same dialog it does on desktop').toBeVisible();
  });

  test('the theme toggle in the drawer moves the document, as it does from the header', async ({ page }) => {
    const root = page.locator('html');
    // Starts LIGHT because the shared `test` pins `localStorage.theme` to `light` before
    // the app's first statement — the `pinnedTheme` fixture in
    // `e2e/fixtures/extended-test.ts`, and the reason every spec is. The app's own
    // default with nothing stored is DARK, which is a separate test's claim
    // (`e2e/document-dialogs.spec.ts`); asserting a light start here without that would
    // pin the app's default rather than the suite's.
    await expect(root).toHaveClass(/\blight\b/);
    await page.getByTestId('mobile-menu-button').click();
    await page.getByTestId('mobile-menu-theme-button').click();
    // The stored value first: it is the semantic signal and the one that survives a reload,
    // while the class is the rendered consequence of it.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
    await expect(root).toHaveClass(/\bdark\b/);
  });

  test('the layers drawer hides a layer, and the header badge counts the layers', async ({ page }) => {
    const toggle = page.getByTestId('mobile-layers-toggle-button');
    await expect(toggle, 'one layer is too few for a badge to be worth drawing').toContainText('📑');

    await toggle.click();
    const drawer = page.getByTestId('mobile-layers-drawer');
    await expect(drawer).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // The drawer has two tabs, and the history tab is the other half of the same surface the
    // desktop right-hand panel shows.
    await page.getByTestId('mobile-tab-history').click();
    await expect(page.getByRole('list', { name: 'History' })).toBeVisible();
    await page.getByTestId('mobile-tab-layers').click();
    await expect(page.getByRole('list', { name: 'Layers' })).toBeVisible();

    const hide = page.getByRole('button', { name: 'Hide Blank 1' });
    await expect(hide).toBeVisible();
    await hide.click();
    await expect(page.getByRole('button', { name: 'Show Blank 1' })).toBeVisible();

    // The badge is the header's only statement about the stack, and it counts layers rather
    // than visible ones, so adding a second is what makes it appear at all.
    await page.getByTestId('mobile-add-layer-button').click();
    await expect(toggle).toContainText('2');
  });

  test('the header undo and redo mirror the desktop buttons', async ({ page }) => {
    const undo = page.getByTestId('mobile-undo-button');
    const redo = page.getByTestId('mobile-redo-button');
    await expect(undo, 'a fresh document has nothing to undo').toBeDisabled();
    await expect(redo).toBeDisabled();

    await bottomBar(page).getByRole('button', { name: 'Draw Tool' }).click();
    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The workspace canvas has no box on a phone');
    await drawLine(page, box, 60, 100, 200, 100);

    await expect(undo, 'the stroke is a history entry the header can reach').toBeEnabled();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(redo).toBeDisabled();
  });
});
