import { expect, type Page, test } from './fixtures/extended-test';

import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { clickToolButton, expectToolSelected, hasOwnToolTile, toggleToolbarLayout } from './helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Hand tool and the view transform, measured in a browser.
 *
 * jsdom cannot check any of it: `getBoundingClientRect` is zero for every box there, so the
 * contain fit, the transform, the clamp and the pointer mapping all read as "unmeasurable" and a
 * pan looks like a no-op whether or not it is one. Everything below is about geometry, which is
 * exactly the class of claim this suite exists to make falsifiable.
 *
 * **The transform is read off the DOM rather than off app state.** There is no export the page
 * offers for `{ dx, dy, zoom }`, and reaching into the store would couple the suite to a module
 * graph jsdom already fails on. `style.transform` is what the feature actually produces, so
 * asserting on it asserts the shipped behaviour rather than a copy of the intent.
 *
 * **The identity is asserted as an ABSENCE.** At Fit on Screen `composeTransform` returns `''`, and
 * this is why the whole visual-regression suite still passes. `scale(1)` would be visually
 * identical and would still promote the element to a composited layer, changing how the canvas
 * rasterises — so "the transform attribute is empty" is a stronger and more meaningful claim than
 * "the scale is 1".
 */

/** Read the transient view transform off the rendered `.zoom-container`. */
async function viewTransform(page: Page): Promise<string> {
  return page.locator('.zoom-container').evaluate((node) => (node as HTMLElement).style.transform);
}

/** The scale factor out of a `transform: translate(...) scale(z)` string. */
function scaleOf(transform: string): number {
  const match = /scale\(([-\d.]+)\)/.exec(transform);
  if (match === null) return 1;
  return Number(match[1]);
}

/** The `translate` offsets out of a `transform: translate(xpx, ypx) scale(z)` string. */
function translateOf(transform: string): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform);
  if (match === null) return { x: 0, y: 0 };
  return { x: Number(match[1]), y: Number(match[2]) };
}

const zoomLevel = (page: Page) => page.getByTestId('hand-zoom-level');

/**
 * A document tall enough to leave the viewport at Fit, so there is something to pan to.
 *
 * The app boots with one bedrock background layer, so a blank document is already enough — what
 * matters is the ASPECT. The viewport is wide and short, so a document taller than it is wide has
 * vertical room at Fit, and Adobe's own precondition ("part of the image is out of view") is met.
 */
async function openTallDocument(page: Page): Promise<void> {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();
  // The boot document already carries the bedrock background layer, so the app counts the
  // document as having unsaved work and `File > New` goes through the discard prompt first.
  // Without this the click lands and nothing appears to happen, which is what the first version
  // of this helper did.
  await acceptDiscardPrompt(page);

  const dialog = page.getByTestId('new-image-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('new-image-width-input').fill('1200');
  await page.getByTestId('new-image-height-input').fill('2400');
  await page.getByTestId('new-image-dialog-submit-button').click();
  await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);

  // Give the page back its input focus after the dialog closes.
  //
  // This is NOT an app defect and the state is deceptive: `document.hasFocus()` is `true`,
  // `document.activeElement` is `BODY` and there is one frame, yet a `keyboard.press` delivers
  // nothing to `document` — a capture listener registered there records zero events for every
  // key, tool or shortcut. A single real pointer event restores it and every key works from
  // then on, which is why the assertions that pass in this file are the ones that happen to
  // click a control first.
  //
  // The rail tile is the click: the canvas is `pointer-events-none` so a click aimed at it
  // retries until the test times out, and a click on the workspace container lands on the Draw
  // tool area and starts a stroke. Draw is already the selected tool, so this changes nothing
  // the tests depend on.
  await clickToolButton(page, 'draw');
}

/**
 * Put the tool on the rail as a tile of its own.
 *
 * A double-click cannot be delivered to the three-dots tile — that control opens a menu, and the
 * Hand's tile is folded into it at the two-column rail this viewport uses. So the layout is
 * toggled only when the tile is actually missing, which keeps the assertion about the double-click
 * rather than about the window width, and `expect.poll` covers the reflow.
 */
async function ensureOwnRailTile(page: Page, toolName: string): Promise<void> {
  if (await hasOwnToolTile(page, toolName)) return;
  await toggleToolbarLayout(page);
  await expect.poll(() => hasOwnToolTile(page, toolName)).toBe(true);
}

test.describe('the Hand tool', () => {
  test("is the rail's last tile, and H selects it", async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);

    // The tile exists and is a singleton, not a flyout: Adobe pairs Hand with Zoom in one
    // flyout, and this rail has no Zoom to pair it with, so a flyout entry would put a tile on
    // screen for a tool that cannot be selected.
    //
    // `hasOwnToolTile` rather than a plain visibility check, because the rail is TWO columns at
    // this viewport and the Hand is the LAST tile — so it may be folded into the three-dots tile.
    // A test that asserted its own tile unconditionally would be a test of the window height.
    await ensureOwnRailTile(page, 'hand');
    await expectToolSelected(page, 'hand', false);

    await page.keyboard.press('h');

    await expectToolSelected(page, 'hand');
  });

  test('stays selected until another tool is chosen', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');
    await expectToolSelected(page, 'hand');

    await ensureOwnRailTile(page, 'hand');
    await clickToolButton(page, 'draw');

    await expectToolSelected(page, 'hand', false);
    await expectToolSelected(page, 'draw');
  });

  test('double-clicking the tile fits the view', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');

    await page.keyboard.press('Control+=');
    expect(scaleOf(await viewTransform(page))).toBeGreaterThan(1);

    // Adobe: "Fit on Screen — Double-click on Hand tool".
    await ensureOwnRailTile(page, 'hand');
    await page.getByTestId('tool-button-hand').dblclick();

    // The identity is an EMPTY transform, not `scale(1)`.
    await expect.poll(async () => viewTransform(page)).toBe('');
  });

  test('double-clicking any other tile does not throw away the zoom', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');
    await page.keyboard.press('Control+=');

    const zoomed = await viewTransform(page);
    await ensureOwnRailTile(page, 'reposition');
    await page.getByTestId('tool-button-reposition').dblclick();

    // The command is defined over a view only the Hand navigates, so it is named rather than
    // general: double-clicking the Move tool must not silently reset the user's zoom.
    expect(await viewTransform(page)).toBe(zoomed);
  });
});

test.describe('panning the canvas', () => {
  test('a drag moves the view and leaves the zoom alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);

    // Reach a zoom at which the document overflows, or there is nothing to pan to: at Fit on
    // Screen the clamp pins the offset to zero on every axis, which is Adobe's precondition
    // rather than a defect.
    await page.keyboard.press('h');
    await page.keyboard.press('Control+=');
    const zoomBefore = scaleOf(await viewTransform(page));

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 60, { steps: 10 });
    await page.mouse.up();

    const transform = await viewTransform(page);
    expect(translateOf(transform).y).toBeLessThan(0);
    expect(scaleOf(transform)).toBe(zoomBefore);
  });

  test('the image can be dragged out of the window, and Fit On Screen brings it back', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');
    await page.keyboard.press('Control+=');

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    // A drag far longer than the container in every direction. Adobe does not hold the image
    // inside the window either, so this is allowed to leave the document out of sight — and the
    // second half is the part that has to work BECAUSE of that: the recovery path.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 4000, box.y - 4000, { steps: 20 });
    await page.mouse.up();

    const { x, y } = translateOf(await viewTransform(page));
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    // It really did travel: the offsets are far larger than the container could have allowed.
    expect(Math.abs(x)).toBeGreaterThan(box.width);
    expect(Math.abs(y)).toBeGreaterThan(box.height);

    await page.keyboard.press('Control+0');
    await expect.poll(async () => viewTransform(page)).toBe('');
  });

  test('a drag at Fit on Screen moves the image, and it stays moved', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');

    // Fit on Screen and the identity transform, so the starting state is the one this test needs.
    expect(await viewTransform(page)).toBe('');

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 120, { steps: 10 });
    await page.mouse.up();

    // This is the behaviour the clamp used to forbid. Adobe scopes the Hand to the zoomed case
    // because that is when panning is USEFUL, not because it is refused when it is not — and the
    // old expectation (`toBe('')`) made a drag at the zoom a user meets first look broken.
    const { y } = translateOf(await viewTransform(page));
    expect(y).toBeCloseTo(-120, 0);

    // And it is still there after the button is up: the release commits the position rather than
    // dropping it.
    await page.waitForTimeout(150);
    expect(translateOf(await viewTransform(page)).y).toBeCloseTo(-120, 0);
  });

  test('changes no pixel of the document', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');

    const canvas = getWorkspaceCanvas(page);
    const widthBefore = await canvas.getAttribute('width');
    const heightBefore = await canvas.getAttribute('height');
    const pixelsBefore = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());

    const box = await canvas.boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 10 });
    await page.mouse.up();

    // The Hand writes no pixel: it is in `PIXEL_FREE_TOOLS`, so it has no processor, no history
    // state and nothing to undo. A changed canvas would mean it rasterized something.
    const layerRows = await page.getByTestId('layer-row').count();
    expect(layerRows).toBe(1);

    // Compare the backing-store pixels rather than a screenshot of the transformed element.
    // Panning changes CSS presentation but must leave the actual raster byte-for-byte intact.
    const pixelsAfter = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
    expect(pixelsAfter).toBe(pixelsBefore);
    expect(await canvas.getAttribute('width')).toBe(widthBefore);
    expect(await canvas.getAttribute('height')).toBe(heightBefore);
  });
});

test.describe('the spring-loaded Hand', () => {
  test('Space held over another tool pans, and Space released restores that tool', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);

    // `V`, not `clickToolButton`: at the two-column rail `draw` lives in the three-dots tile, so
    // clicking it opens a flyout — and an open flyout OWNS the keyboard by design
    // (`SidebarLeft` claims the key capture, because `PanelGroup` and the rail both read `Space`
    // themselves). That would make this test prove the flyout gate instead of the spring-loaded
    // Hand. The Move tool is on the rail, so `V` selects a non-Hand tool without a flyout.
    await page.keyboard.press('v');
    await page.keyboard.press('Control+=');

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.keyboard.down('Space');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 70, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    expect(translateOf(await viewTransform(page)).y).toBeLessThan(0);

    // Temporary means temporary: the selected tool never moved, so the rail's pressed tile is
    // still the Move.
    await ensureOwnRailTile(page, 'hand');
    await expectToolSelected(page, 'reposition');
    await expectToolSelected(page, 'hand', false);
  });

  test('Space held during a paint gesture preserves the stroke', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await clickToolButton(page, 'draw');
    const layerRowsBefore = await page.getByTestId('layer-row').count();

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    const cy = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width / 2, cy);
    await page.mouse.down();
    await page.keyboard.down('Space');
    await page.mouse.move(box.x + box.width / 2, cy - 100, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    // The temporary Hand cannot replace a tool while its document gesture owns the pointer.
    // The stroke must finish on its original surface instead of being lost during a tool swap.
    expect(await viewTransform(page)).toBe('');
    await expect(page.getByTestId('layer-row')).toHaveCount(layerRowsBefore + 1);
  });

  test('a Space keyup with no matching keydown leaves nothing stuck', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('Space');

    // Harmless by construction — disarming a state that was never armed is a no-op — and
    // asserted because it is the asymmetry the whole spring-loaded design rests on.
    await ensureOwnRailTile(page, 'hand');
    await expectToolSelected(page, 'hand', false);
  });
});

test.describe('the view commands', () => {
  test('Ctrl+0 fits and Ctrl+1 reaches 100 per cent', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');

    const fitPercent = Number((await zoomLevel(page).textContent())?.replace('%', '') ?? '');

    await page.keyboard.press('Control+1');
    await expect.poll(async () => Number((await zoomLevel(page).textContent())?.replace('%', '') ?? '')).toBe(100);
    expect(scaleOf(await viewTransform(page))).toBeGreaterThan(fitPercent / 100);

    await page.keyboard.press('Control+0');
    await expect.poll(async () => viewTransform(page)).toBe('');
  });

  test('the options bar steps the zoom and reports it against actual pixels', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');

    const before = Number((await zoomLevel(page).textContent())?.replace('%', '') ?? '');

    await page.getByTestId('hand-zoom-in').click();

    // The percentage is against ACTUAL PIXELS, not against the fit: a document fitted into a
    // short viewport reads well under 100% at Fit, and printing the raw multiplier would read
    // 100% there and be wrong.
    await expect
      .poll(async () => Number((await zoomLevel(page).textContent())?.replace('%', '') ?? ''))
      .toBeGreaterThan(before);

    await page.getByTestId('hand-fit-on-screen').click();
    await expect.poll(async () => viewTransform(page)).toBe('');
  });

  test('a wheel over the canvas pans without scrolling the page', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');
    await page.keyboard.press('Control+=');

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    const workspace = page.getByTestId('workspace-container');
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const workspaceScrollBefore = await workspace.evaluate((node) => node.scrollTop);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);

    // The listener is attached directly with `{ passive: false }`; a React `onWheel` could not
    // cancel the default, and `Ctrl+wheel` would zoom the PAGE. `consolePolice` fails this test
    // if the browser logged the passive-cancel warning.
    await expect.poll(async () => translateOf(await viewTransform(page)).y).toBeLessThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect(await workspace.evaluate((node) => node.scrollTop)).toBe(workspaceScrollBefore);
  });

  test('Ctrl and a wheel zoom at the pointer instead of zooming the page', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    const before = scaleOf(await viewTransform(page));
    const pageZoomBefore = await page.evaluate(() => window.devicePixelRatio);

    await page.keyboard.down('Control');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');

    await expect.poll(async () => scaleOf(await viewTransform(page))).toBeGreaterThan(before);
    // The browser's own Ctrl+wheel page zoom must not have fired.
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(pageZoomBefore);
  });
});

test.describe('the view survives the document it belongs to', () => {
  test("a new document opens fitted, rather than inheriting the last one's zoom", async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openTallDocument(page);
    await page.keyboard.press('h');
    await page.keyboard.press('Control+=');
    expect(await viewTransform(page)).not.toBe('');

    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    // The same guard as in `openTallDocument`: the first document now has unsaved work, so
    // `File > New` prompts before it reaches the dialog.
    await acceptDiscardPrompt(page);
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();
    await page.getByTestId('new-image-dialog-submit-button').click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // `fitScale` belongs to the old document's dimensions, so carrying a zoom multiplier across
    // would open the next document at an arbitrary magnification of the last one's fit.
    await expect.poll(async () => viewTransform(page)).toBe('');
  });
});
