import { expect, type Page, test } from './fixtures/extended-test';
import { getWorkspaceCanvas, loadImageData } from './helpers/canvas-helpers';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';

test.describe('focus tool gestures', () => {
  test.describe.configure({ timeout: PAINT_TOOLS_TEST_TIMEOUT_MS });

  const drawLine = async (page: Page) => {
    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Workspace canvas is not measurable');
    await clickToolButton(page, 'draw');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const { data } = await loadImageData(await page.screenshot({ clip: box }));
        return data.some((value, index) => index % 4 !== 3 && value < 200);
      })
      .toBe(true);
    return box;
  };

  const changedPixels = (before: Uint8ClampedArray, after: Uint8ClampedArray): number => {
    let changed = 0;
    for (let index = 0; index < before.length; index += 4) {
      if (
        before[index] !== after[index] ||
        before[index + 1] !== after[index + 1] ||
        before[index + 2] !== after[index + 2]
      ) {
        changed += 1;
      }
    }
    return changed;
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('Blur changes pixels when painted over a line', async ({ page }) => {
    const box = await drawLine(page);
    await clickToolButton(page, 'blur');
    const radius = page.getByRole('slider', { name: /radius/i });
    await radius.fill('12');
    await expect(radius).toHaveValue('12');
    const before = (await loadImageData(await page.screenshot({ clip: box }))).data;

    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(async () => changedPixels(before, (await loadImageData(await page.screenshot({ clip: box }))).data))
      .toBeGreaterThan(0);
  });

  test('Sharpen changes pixels when painted over a line', async ({ page }) => {
    const box = await drawLine(page);
    await openToolFlyout(page, 'blur');
    await selectFromFlyout(page, { toolName: 'sharpen', label: 'Sharpen Tool' });
    await page.getByRole('slider', { name: 'Amount' }).fill('100');
    await page.getByRole('slider', { name: 'Radius' }).fill('2');
    const before = (await loadImageData(await page.screenshot({ clip: box }))).data;

    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(async () => changedPixels(before, (await loadImageData(await page.screenshot({ clip: box }))).data))
      .toBeGreaterThan(0);
  });

  test('Smudge widens a tight layer into the stroke footprint', async ({ page }) => {
    const box = await drawLine(page);
    await openToolFlyout(page, 'blur');
    await selectFromFlyout(page, { toolName: 'smudge', label: 'Smudge Tool' });
    await page.getByRole('slider', { name: 'Strength' }).fill('100');

    const clip = {
      x: Math.round(box.x + box.width * 0.68),
      y: Math.round(box.y + box.height * 0.5 - 24),
      width: Math.round(box.width * 0.25),
      height: 48,
    };
    const before = (await loadImageData(await page.screenshot({ clip }))).data;
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 16 });
    await expect
      .poll(async () => changedPixels(before, (await loadImageData(await page.screenshot({ clip }))).data))
      .toBeGreaterThan(0);
    await page.mouse.up();

    await expect
      .poll(async () => {
        const { data } = await loadImageData(await page.screenshot({ clip }));
        return changedPixels(before, data);
      })
      .toBeGreaterThan(0);
  });
});
