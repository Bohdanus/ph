import { expect, type Page, test } from './fixtures/extended-test';

import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import {
  clickToolButton,
  expectToolSelected,
  hasOwnToolTile,
  openToolFlyoutViaRightClick,
  toggleToolbarLayout,
} from './helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
import { fillSaveDialog, openSaveDialog, submitSaveDialogForDownload, type ExportFormat } from './export/helpers';

/**
 * Rotate View, measured in a browser.
 *
 * The one test that earns the tool is *"a tilted view exports the same image"*. Everything else
 * here could be true of a tool that silently rotated the document: the angle field would still
 * read 30°, Reset View would still zero it, the canvas would still tilt. Adobe's sentence is that
 * the tool "changes the angle at which you view the canvas, but it does not rotate or transform
 * the actual image", and only comparing the EXPORT before and after can hold this app to it.
 *
 * The transform is read off `.zoom-container`, which is what the feature produces; the angle is
 * read off the options bar's field, which is what the user sees. Asserting both is the point —
 * a view that tilts without the number moving is the failure the snapshot test caught in jsdom.
 */

/** Read the transient view transform off the rendered `.zoom-container`. */
async function viewTransform(page: Page): Promise<string> {
  return page.locator('.zoom-container').evaluate((node) => (node as HTMLElement).style.transform);
}

/** The `rotate(θdeg)` term out of a transform string, or 0. */
function rotationOf(transform: string): number {
  const match = /rotate\((-?[\d.]+)deg\)/.exec(transform);
  if (match === null) return 0;
  return Number(match[1]);
}

/** The angle the options bar is displaying. */
async function displayedAngle(page: Page): Promise<number> {
  return Number((await page.getByTestId('rotate-view-angle').inputValue()) || '0');
}

/**
 * A document with a size, and the focus the keyboard needs afterwards.
 *
 * The click on the rail tile at the end is not optional. After a modal dialog closes, key events
 * stop reaching the page even though `document.hasFocus()` is `true` and `activeElement` is
 * `BODY`; a single real pointer event restores it. The Hand spec documents this at length, and
 * without it every `keyboard.press` in a document-creating test is silently dropped.
 */
async function openDocument(page: Page): Promise<void> {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();
  await acceptDiscardPrompt(page);
  await expect(page.getByTestId('new-image-dialog')).toBeVisible();
  await page.getByTestId('new-image-width-input').fill('800');
  await page.getByTestId('new-image-height-input').fill('600');
  await page.getByTestId('new-image-dialog-submit-button').click();
  await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
  await clickToolButton(page, 'draw');
}

async function ensureOwnRailTile(page: Page, toolName: string): Promise<void> {
  if (await hasOwnToolTile(page, toolName)) return;
  await toggleToolbarLayout(page);
  await expect.poll(() => hasOwnToolTile(page, toolName)).toBe(true);
}

/** Press, move around the canvas centre, release. Used to tilt and to pan in one gesture shape. */
async function dragAboutCentre(
  page: Page,
  fromAngle: number,
  toAngle: number,
  radius = 160,
  direction: 'shortest' | 'literal' = 'shortest'
) {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (box === null) throw new Error('workspace canvas has no box');

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const at = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x: cx + Math.cos(radians) * radius, y: cy + Math.sin(radians) * radius };
  };

  const start = at(fromAngle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  let delta = toAngle - fromAngle;
  if (direction === 'shortest') delta = ((((delta + 180) % 360) + 360) % 360) - 180;
  const steps = Math.max(12, Math.ceil(Math.abs(delta) / 6));
  for (let index = 1; index <= steps; index += 1) {
    const point = at(fromAngle + (delta * index) / steps);
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
}

test.describe('Rotate View', () => {
  test('R selects it, and it is the Hand tile own flyout', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await ensureOwnRailTile(page, 'hand');

    // Adobe's own page prints `R` beside the tool, so this letter is Adobe-table confirmed rather
    // than inherited from a shortcut sheet the way several others in this app are.
    await page.keyboard.press('r');

    // Rotate View shares Hand's visible rail tile. The options bar identifies the nested tool;
    // the tile itself exposes selection only at group level.
    await expectToolSelected(page, 'hand');
    // And its options bar is the rotate one, not a leftover from the tool it replaced.
    await expect(page.getByTestId('rotate-view-reset')).toBeVisible();
    await expect(page.getByTestId('rotate-view-angle')).toBeVisible();
  });

  test('Shift+H cycles between the Hand and Rotate View, which share one tile', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await ensureOwnRailTile(page, 'hand');
    await page.keyboard.press('r');
    await expectToolSelected(page, 'hand');
    await expect(page.getByTestId('rotate-view-angle')).toBeVisible();

    await page.keyboard.press('Shift+H');

    // The mitigation for the cost of a flyout: a plain click on the shared tile opens the menu
    // rather than selecting the Hand, so `Shift+H` is the keyboard way across.
    await expectToolSelected(page, 'hand');
    await expect(page.getByTestId('hand-zoom-level')).toBeVisible();
  });

  test('a drag tilts the view and the angle field follows it', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    // Upright to begin with, and no transform at all — the identity writes nothing, which is what
    // keeps every visual baseline in the suite valid.
    expect(await viewTransform(page)).toBe('');
    expect(await displayedAngle(page)).toBe(0);

    await dragAboutCentre(page, 0, 90);

    const transform = await viewTransform(page);
    expect(rotationOf(transform)).toBeGreaterThan(60);
    expect(await displayedAngle(page)).toBeGreaterThan(60);
  });

  test('the drag is relative, so a second one continues from the first', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    await dragAboutCentre(page, 0, 30);
    const afterFirst = await displayedAngle(page);
    expect(afterFirst).toBeGreaterThan(20);

    await dragAboutCentre(page, 90, 150);

    // An absolute implementation would snap back to the second drag's own angle and lose the
    // first, which is the jump-at-the-start-of-the-drag this behaviour exists to avoid.
    expect(await displayedAngle(page)).toBeGreaterThan(afterFirst + 50);
  });

  test('a drag across the angle boundary follows the shorter rotation', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    await dragAboutCentre(page, 179, -179);

    const rotation = await displayedAngle(page);
    expect(rotation).toBeGreaterThan(0);
    expect(rotation).toBeLessThan(5);
  });

  test('rotation keeps its direction after the drag passes 180 degrees', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    await dragAboutCentre(page, 10, 250, 160, 'literal');

    const rotation = await displayedAngle(page);
    expect(rotation).toBeGreaterThan(230);
    expect(rotation).toBeLessThan(250);
  });

  test('the final pointer-up coordinate is included when no pointer-move arrives there', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    const area = page.getByTestId('rotate-view-tool-area');
    const box = await area.boundingBox();
    if (box === null) throw new Error('Rotate View surface has no box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const radius = Math.min(box.width, box.height) * 0.28;

    await page.mouse.move(cx + radius, cy);
    await page.mouse.down();
    // Chromium's mouse pointer uses id 1. Dispatching the final sample directly exercises
    // pointer-up input that is absent from the move stream.
    await area.dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: cx,
      clientY: cy + radius,
    });
    await page.mouse.up();

    expect(await displayedAngle(page)).toBeGreaterThan(80);
    expect(await displayedAngle(page)).toBeLessThan(100);
  });

  test('Shift snaps a drag to 15°', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.keyboard.down('Shift');
    await dragAboutCentre(page, 0, 37);
    await page.keyboard.up('Shift');

    // 37 is nearer 30 than 45, and the snap is third-party sourced so this is the app's own
    // behaviour being pinned rather than an Adobe claim.
    const snapped = await displayedAngle(page);
    expect(snapped % 15).toBe(0);
    expect(Math.abs(snapped)).toBeLessThanOrEqual(30);
    expect(cx).toBeGreaterThan(0);
    expect(cy).toBeGreaterThan(0);
  });

  test('typing an angle tilts the view to it, and an unsnapped one is taken as typed', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    await page.getByTestId('rotate-view-angle').fill('37');

    await expect.poll(async () => rotationOf(await viewTransform(page))).toBeCloseTo(37, 0);

    // An angle typed into the field is NOT snapped: the `Shift` snap is a drag modifier, and a
    // typed 37 that became 30 would be a field that cannot express what it displays.
    expect(await displayedAngle(page)).toBeCloseTo(37, 0);
  });

  test('an angle past the range is brought back inside it rather than refused', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    await page.getByTestId('rotate-view-angle').fill('900');

    // The field's range is a judgement call, not an Adobe value, and the consequence is that
    // something has to happen at the edge. Bounded beats unbounded here: an unbounded field lets
    // a typed 3600 produce an orientation indistinguishable from 0 while the number disagrees
    // with the screen.
    await expect.poll(async () => Math.abs(await displayedAngle(page))).toBeLessThanOrEqual(180);
  });

  test('Reset View returns to upright and leaves the framing alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    await page.keyboard.press('r');

    // Zoom and pan first, so the assertion can be that Reset touches the ANGLE and not them.
    await page.keyboard.press('Control+1');
    await page.keyboard.press('h');
    await dragAboutCentre(page, 0, -60);
    await page.keyboard.press('r');
    await page.getByTestId('rotate-view-angle').fill('45');

    await expect.poll(async () => rotationOf(await viewTransform(page))).toBeCloseTo(45, 0);
    const tilted = await viewTransform(page);
    expect(rotationOf(tilted)).toBeGreaterThan(0);
    expect(tilted).toContain('translate(');

    await page.getByTestId('rotate-view-reset').click();

    // Adobe says Reset View returns to "normal orientation" — the angle. A control that also
    // re-fitted and re-centred would be a second command wearing this one's name, and would
    // throw away a pan the user had positioned deliberately.
    await expect.poll(async () => rotationOf(await viewTransform(page))).toBe(0);
    expect(rotationOf(await viewTransform(page))).toBe(0);
    expect(await displayedAngle(page)).toBe(0);
    expect(await viewTransform(page)).toContain('translate(');
    expect(await viewTransform(page)).not.toContain('scale(1)');
  });

  test('a tilted view exports the same image', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);

    // Draw something, so the export has content that a rotation would visibly distort if it
    // leaked into the document.
    await clickToolButton(page, 'draw');
    const box = await getWorkspaceCanvas(page).boundingBox();
    if (box === null) throw new Error('workspace canvas has no box');

    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, { steps: 12 });
    await page.mouse.up();

    const upright = await exportDigest(page);
    expect(upright.byteLength).toBeGreaterThan(0);

    // Tilt it hard, well past anything a snap would land on.
    await ensureOwnRailTile(page, 'hand');
    await page.getByTestId('tool-button-hand').click();
    await page.keyboard.press('r');
    await page.getByTestId('rotate-view-angle').fill('38');
    await expect.poll(async () => rotationOf(await viewTransform(page))).toBeCloseTo(38, 0);

    const tilted = await exportDigest(page);

    // THE assertion. Adobe: the tool "does not rotate or transform the actual image". A tool that
    // rotated the document would still tilt the canvas and still read 38° in the field, so nothing
    // above this line could tell the two apart.
    expect(tilted.equals(upright)).toBe(true);
  });

  test('a tilted view leaves the document geometry alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);
    const before = await layerCount(page);

    await page.keyboard.press('r');
    await dragAboutCentre(page, 0, 90);

    // `rotate-view` is in `PIXEL_FREE_TOOLS`, so it has no processor, no history entry and
    // nothing to undo — and the Undo button staying disabled is the cheapest way to see that.
    expect(await layerCount(page)).toBe(before);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('the Hand and Rotate View share one tile, so the rail gains no row', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await openDocument(page);

    // One tile, one group. This is why the fold edge pinned in `e2e/toolbar-fit.spec.ts` is still
    // 1087: a separate Rotate View tile would have made the rail seventeen groups and moved it.
    await ensureOwnRailTile(page, 'hand');
    const handTile = page.getByTestId('tool-button-hand');
    await expect(handTile).toHaveCount(1);
    await expect(page.getByTestId('tool-button-rotate-view')).toHaveCount(0);

    // The flyout carries it.
    await openToolFlyoutViaRightClick(page, 'hand');
    await expect(page.getByRole('menuitemradio', { name: /Rotate View/ })).toBeVisible();
  });
});

const PNG_FORMAT: ExportFormat = { label: 'PNG', extension: '.png', verification: 'browser-pixels' };

/** The bytes produced by the app's real PNG download path. */
async function exportDigest(page: Page): Promise<Buffer> {
  await openSaveDialog(page);
  await fillSaveDialog(page, 'rotate-view-proof', PNG_FORMAT.label);
  const download = await submitSaveDialogForDownload(page, PNG_FORMAT);
  const stream = await download.createReadStream();
  if (stream === null) throw new Error('PNG export did not provide a readable stream');

  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The number of rows in the Layers panel. */
async function layerCount(page: Page): Promise<number> {
  return page.getByTestId('layer-row').count();
}
